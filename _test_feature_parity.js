// _test_feature_parity.js — worker pass-332: the live tick and the bootstrap build the SAME 22 inputs from the same
// bars. Pulls extractRichFeatures (live), richFeatures (bootstrap, nested in the bootstrap function) and their shared
// helpers out of worker/src/index.js as source, runs both on random bar histories, and compares every slot.
// Before pass-332 the live path set f[18] (VIX) and f[20] (time of day) while the bootstrap left them at 0.5.
// Run: node _test_feature_parity.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'index.js'), 'utf8');

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }

// Slice a function out by its header and brace matching.
function grab(header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('not found: ' + header);
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, j + 1);
}
const code = [
  grab('function clamp(v, lo, hi) {'),
  grab('function addStabilityFeatures(f, bars, i) {'),
  grab('function extractFeatures(quote, marketSnap) {'),
  grab('function extractRichFeatures(quote, history, marketSnap) {'),
  grab('function richFeatures(bars, i) {')
].join('\n');
let hour = 15.5;
const F = new Function('etHour', code + '\nreturn { extractRichFeatures, richFeatures };')(() => hour);

// Deterministic pseudo-random bars (a test fixture, not data).
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
function series(n) {
  const out = [];
  let px = 50 + rnd() * 200;
  const t0 = Date.UTC(2026, 0, 5, 14, 30);
  for (let k = 0; k < n; k++) {
    const o = px * (1 + (rnd() - 0.5) * 0.02);
    const c = o * (1 + (rnd() - 0.5) * 0.04);
    out.push({ ts: t0 + k * 86400000, open: o, high: Math.max(o, c) * (1 + rnd() * 0.01), low: Math.min(o, c) * (1 - rnd() * 0.01), close: c, volume: Math.round(1e6 * (0.5 + rnd())) });
    px = c;
  }
  return out;
}

let compared = 0;
// 15+ bars: the full rich path in both (the bootstrap needs i >= 14; it only TRAINS from i >= 20).
for (const n of [15, 16, 21, 30, 40, 55, 80]) {
  for (let rep = 0; rep < 5; rep++) {
    const bars = series(n);
    const i = bars.length - 1;
    const q = { last: bars[i].close, changePct: 0, dayHigh: bars[i].high, dayLow: bars[i].low };
    for (const vix of [12, 18, 35]) {
      for (const h of [9.6, 12, 15.2, 15.9]) {
        hour = h;
        const live = F.extractRichFeatures(q, bars, { vix });
        const train = F.richFeatures(bars, i);
        const diff = live.map((v, k) => Math.abs(v - train[k]) > 1e-12 ? k : -1).filter(k => k >= 0);
        compared++;
        if (diff.length) { ok(false, 'n=' + n + ' vix=' + vix + ' hour=' + h + ': slots differ ' + diff.join(',')); break; }
      }
    }
  }
}
ok(compared > 300, 'compared ' + compared + ' (bars, vix, hour) cases');

// Under 15 bars the live path falls back to the quote-only vector: neutral except range and change, on the same
// scales as the rich path, with VIX and time of day neutral.
{
  const bars = series(14), i = 13;
  const q = { last: bars[i].close, changePct: 1.5, dayHigh: bars[i].high, dayLow: bars[i].low };
  hour = 15.7;
  const fb = F.extractRichFeatures(q, bars, { vix: 30 });
  const range = (q.dayHigh - q.dayLow) / q.last;
  ok(Math.abs(fb[1] - Math.min(1, range * 50)) < 1e-12, 'fallback f[1] uses the rich scale (range * 50)');
  ok(Math.abs(fb[5] - (1.5 + 5) / 10) < 1e-12, 'fallback f[5] = the same change mapping');
  ok(fb[18] === 0.5 && fb[20] === 0.5 && fb[21] === 1, 'fallback keeps VIX and time of day neutral, bias input 1');
  ok(fb.filter((v, k) => ![1, 5, 21].includes(k)).every(v => v === 0.5), 'fallback: every other input neutral');
}

// Static guards
ok(!/f\[18\] = clamp\(\(marketSnap\.vix/.test(src), 'no live path writes VIX into f[18] (the bootstrap never trains on it)');
ok(!/f\[20\] = clamp\(\(etHour\(\)/.test(src), 'no live path writes time of day into f[20] (daily bars have none)');
ok(/addStabilityFeatures\(f, bars, i\);  \/\/ pass 261: f\[9\]-f\[14\] \(shared with bootstrap/.test(src) && /addStabilityFeatures\(f, bars, i\);  \/\/ pass 261: f\[9\]-f\[14\] \(shared with live tick/.test(src), 'both paths call the shared stability features');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('feature parity: live and bootstrap inputs match on ' + compared + ' cases');
