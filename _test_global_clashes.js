// _test_global_clashes.js — pass 341 (page smoke sweep 11/11). Every page shares ONE global scope with the js files
// it loads (explicit <script src> plus the modules live.js lazy-loads). Two top-level const/let/class declarations of
// the same name are a SyntaxError that kills a whole script: model-what-if's 'const FEATURES' vs model.js left that
// page dead. Fails on any clash. Run: node _test_global_clashes.js
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
function topDecls(code) {
  const out = [];
  const lines = code.split(/\r?\n/);
  for (const ln of lines) {
    let m;
    if ((m = /^(const|let|class|var|function|async function)\s+([A-Za-z_$][\w$]*)/.exec(ln))) out.push({ kind: m[1].replace('async ', ''), name: m[2] });
    else if ((m = /^(const|let|var)\s*\{([^}]*)\}\s*=/.exec(ln))) m[2].split(',').forEach(x => { const n = x.split(':').pop().trim(); if (n) out.push({ kind: m[1], name: n }); });
  }
  return out;
}
const live = read('js/live.js');
const lazy = new Set([...live.matchAll(/'js\/([\w.-]+\.js)\?v=/g)].map(m => 'js/' + m[1]));
const jsDecls = {};
for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))) jsDecls['js/' + f] = topDecls(read('js/' + f));
const lexical = k => k === 'const' || k === 'let' || k === 'class';
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !f.startsWith('_'));
const problems = [];
for (const p of pages) {
  const h = read(p);
  const srcs = [...h.matchAll(/<script[^>]+src="(js\/[\w.-]+\.js)/g)].map(m => m[1]);
  const loadsLive = srcs.includes('js/live.js');
  const files = new Set(srcs.concat(loadsLive ? [...lazy] : []));
  const inline = [...h.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="(?:application\/ld\+json|module)")[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  const mine = topDecls(inline);
  const seen = {};
  for (const f of files) for (const d of (jsDecls[f] || [])) (seen[d.name] = seen[d.name] || []).push({ f, kind: d.kind });
  // inline vs files
  for (const d of mine) {
    for (const o of (seen[d.name] || [])) {
      if (lexical(d.kind) || lexical(o.kind)) problems.push(p + ': inline ' + d.kind + ' ' + d.name + ' vs ' + o.f + ' ' + o.kind + (lazy.has(o.f) && !srcs.includes(o.f) ? ' (lazy)' : ''));
    }
  }
  // inline vs inline (two script blocks)
  const blocks = [...h.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="(?:application\/ld\+json|module)")[^>]*>([\s\S]*?)<\/script>/g)].map(m => topDecls(m[1]));
  const bySeen = {};
  blocks.forEach((b, i) => b.forEach(d => { (bySeen[d.name] = bySeen[d.name] || []).push({ i, kind: d.kind }); }));
  for (const [n, arr] of Object.entries(bySeen)) {
    const blocksWith = new Set(arr.map(a => a.i));
    if (blocksWith.size > 1 && arr.some(a => lexical(a.kind))) problems.push(p + ': two inline blocks declare ' + n);
  }
}
// file vs file among the lazy set + common explicit set
const common = ['js/data-provider.js', 'js/ai-client.js', 'js/app.js', 'js/notify.js', 'js/live.js'];
const all = [...new Set(common.concat([...lazy]))];
const fileSeen = {};
for (const f of all) for (const d of (jsDecls[f] || [])) (fileSeen[d.name] = fileSeen[d.name] || []).push({ f, kind: d.kind });
for (const [n, arr] of Object.entries(fileSeen)) if (arr.length > 1 && arr.some(a => lexical(a.kind))) problems.push('MODULES: ' + n + ' declared in ' + arr.map(a => a.f + ' ' + a.kind).join(', '));
console.log('lazy modules:', lazy.size, '· pages:', pages.length, '· clashes:', problems.length);
problems.forEach(x => console.log('  ' + x));
process.exit(problems.length ? 1 : 0);
