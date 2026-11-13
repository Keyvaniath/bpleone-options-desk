// _test_dead_keys.js — pass 344: no page may read a browser-storage key that nothing writes.
// Found 11/13: 28 brain-stats pages read 'bpleone_train_v1' (never written: 0% / F / empty for every visitor),
// brain-proof read 'bpleone_acc_log_v1' (the learner writes 'bpleone_rolling_acc_v1'), and Day-Trader PRO read
// 'bpleone_session_pnl_v1' (never written: "+$0.00 · 0 trades" forever).
// A key counts as written when a setItem call names it literally, or when it is held in a variable (it appears
// outside getItem/removeItem calls). Run: node _test_dead_keys.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const root = __dirname;
// Flags a person sets by hand on purpose (documented in analytics.html / live.js / demo-fab.js).
const MANUAL_FLAGS = ['bpleone_no_track', 'bpleone_demo_mode'];

const files = fs.readdirSync(root).filter(f => f.endsWith('.html') && !f.startsWith('_')).map(f => path.join(root, f))
  .concat(fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => path.join(root, 'js', f)));
const src = {};
for (const f of files) src[f] = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const all = Object.values(src).join('\n');

const reads = {};
const readRe = /getItem\(\s*['"](bpleone_[A-Za-z0-9_]+)['"]/g;
for (const [f, t] of Object.entries(src)) {
  let m;
  while ((m = readRe.exec(t))) (reads[m[1]] = reads[m[1]] || new Set()).add(path.basename(f));
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dead = [];
for (const k of Object.keys(reads)) {
  if (MANUAL_FLAGS.includes(k)) continue;
  if (new RegExp("setItem\\(\\s*['\"]" + esc(k) + "['\"]").test(all)) continue;
  const occ = all.split("'" + k + "'").length - 1 + all.split('"' + k + '"').length - 1;
  const getOcc = (all.match(new RegExp("(getItem|removeItem)\\(\\s*['\"]" + esc(k) + "['\"]", 'g')) || []).length;
  if (occ > getOcc) continue;
  dead.push(k + ' (read by ' + [...reads[k]].join(', ') + ')');
}
let fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('FAIL: ' + m); } }
ok(Object.keys(reads).length > 30, 'scanner found the storage reads (' + Object.keys(reads).length + ')');
ok(dead.length === 0, 'every key a page reads is written somewhere' + (dead.length ? ': ' + dead.join('; ') : ''));
ok(/getItem\('bpleone_rolling_acc_v1'\)/.test(fs.readFileSync(path.join(root, 'brain-proof.html'), 'utf8')), "brain-proof cross-checks against the learner's real accuracy log");
ok(/getItem\('bpleone_journal_pro_v1'\)/.test(fs.readFileSync(path.join(root, 'day-trader-pro.html'), 'utf8')), "Day-Trader PRO's session P&L reads the trade journal");
console.log(fails ? fails + ' dead-key test(s) FAILED' : 'dead keys: all tests passed (' + Object.keys(reads).length + ' keys read)');
process.exit(fails ? 1 : 0);
