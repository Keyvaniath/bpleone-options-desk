// _test_chart_boxes.js (pass 349): a fill-parent Chart.js chart (responsive + maintainAspectRatio:false) must sit
// in a fixed-height box, or it grows without limit (86 measured did, 9,000-62,000px within seconds; all 138 on 98 pages are boxed).
// Static check: on every page that uses maintainAspectRatio:false, each <canvas id> must be inside
//   - a <div data-fix="pass349" style="position:relative;height:Npx;"> box, or
//   - a .chart-container (style.css gives it a height), or
//   - a parent div whose inline style or page class sets a px height,
// or be on the allowlist below: canvases the 11/16 browser sweep measured as stable (their parent's height comes
// from layout the static check cannot see). A NEW canvas that fails all of these fails this test; box it, or run
//   PROBE=_sweep/probes/runaway-canvas.js node _sweep/page-sweep.js . out.json <page>
// and add it here only if the sweep shows it stable.
// Run: node _test_chart_boxes.js
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const ALLOW = new Set(require('./_sweep/stable-canvases.json'));

const bad = [];
let checked = 0;
for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (!/maintainAspectRatio\s*:\s*false/.test(s)) continue;
  const fixed = new Set([...s.matchAll(/\.([\w-]+)\s*\{[^}]*\bheight\s*:\s*\d+px/g)].map(m => m[1]));
  fixed.add('chart-container');
  for (const m of s.matchAll(/<canvas\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    checked++;
    const id = m[1], key = f.replace(/\.html$/, '') + '#' + id;
    const before = s.slice(Math.max(0, m.index - 400), m.index);
    const opens = [...before.matchAll(/<div\b([^>]*)>/g)];
    const attrs = opens.length ? opens[opens.length - 1][1] : '';
    const cls = (/class="([^"]*)"/.exec(attrs) || [])[1] || '';
    const style = (/style="([^"]*)"/.exec(attrs) || [])[1] || '';
    const ok = /data-fix="pass349"/.test(attrs)
      || /(^|;)\s*(height|min-height)\s*:/.test(style)
      || cls.split(/\s+/).some(c => fixed.has(c))
      || ALLOW.has(key);
    if (!ok) bad.push(key);
  }
}
if (bad.length) {
  console.log('FAIL: ' + bad.length + ' fill-parent chart canvas(es) without a fixed-height box:\n  ' + bad.join('\n  '));
  process.exit(1);
}
console.log('chart boxes: all ' + checked + ' canvases on fill-parent chart pages are boxed or measured stable');
