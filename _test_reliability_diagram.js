/* Headless test for js/reliability-diagram.js */
const fs = require('fs');
const path = require('path');

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { for (const k in store) delete store[k]; }
};
global.window = {};

const src = fs.readFileSync(path.join(__dirname, 'js', 'reliability-diagram.js'), 'utf8');
eval(src);
const RD = global.window.ReliabilityDiagram;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof RD.recordPair === 'function' && typeof RD.buckets === 'function' && typeof RD.ece === 'function');

// T2: Empty
RD.reset();
t('T2a empty n=0', RD.stats().n === 0);
t('T2b empty ECE null', RD.ece() === null);

// T3: Record + invalid
RD.reset();
RD.recordPair(0.5, 1);
RD.recordPair(null, 1);
RD.recordPair(0.5, 0.5);
RD.recordPair(-0.1, 1);
RD.recordPair(1.5, 0);
t('T3 invalid rejected, valid kept', RD.stats().n === 1);

// T4: Buckets cover [0,1]
RD.reset();
RD.recordPair(0.5, 1);
const bins = RD.buckets(10);
t('T4a 10 bins', bins.length === 10);
t('T4b first bin 0-0.1', bins[0].binStart === 0 && Math.abs(bins[0].binEnd - 0.1) < 1e-9);
t('T4c last bin 0.9-1.0', Math.abs(bins[9].binStart - 0.9) < 1e-9 && bins[9].binEnd === 1.0);

// T5: Perfectly calibrated model → ECE near 0
RD.reset();
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
for (let i = 0; i < 500; i++) {
  const p = rng();
  const win = rng() < p ? 1 : 0; // perfectly calibrated by construction
  RD.recordPair(p, win);
}
const ece5 = RD.ece(10);
t('T5 calibrated model → low ECE', ece5 < 0.10, 'ECE=' + ece5);

// T6: Over-confident model → high ECE
RD.reset();
for (let i = 0; i < 200; i++) {
  // Always predict 0.9 but actual is only 50%
  const win = rng() < 0.5 ? 1 : 0;
  RD.recordPair(0.9, win);
}
const ece6 = RD.ece(10);
t('T6 overconfident → high ECE', ece6 > 0.30, 'ECE=' + ece6);

// T7: Bins have actual win rate close to mean predicted for calibrated case
RD.reset();
for (let i = 0; i < 500; i++) {
  const p = rng();
  const win = rng() < p ? 1 : 0;
  RD.recordPair(p, win);
}
const bins7 = RD.buckets(10);
// Find a bin with enough samples and check actual ~ predicted
const bigBin = bins7.find(b => b.n >= 30);
t('T7 calibrated bin actual ≈ predicted',
   Math.abs(bigBin.actualWinRate - bigBin.meanPredicted) < 0.2,
   'gap=' + (bigBin.actualWinRate - bigBin.meanPredicted));

// T8: Bin gap sign correct
// Under-confident: predict 0.3 but actually win 0.6 → gap positive
RD.reset();
for (let i = 0; i < 100; i++) {
  RD.recordPair(0.3, rng() < 0.6 ? 1 : 0);
}
const bins8 = RD.buckets(10);
const underconfBin = bins8.find(b => b.binStart === 0.3);
t('T8 under-confident bin → positive gap', underconfBin.gap > 0.1, 'gap=' + underconfBin.gap);

// T9: FIFO cap
RD.reset();
for (let i = 0; i < 2500; i++) RD.recordPair(rng(), i % 2);
t('T9 FIFO cap', RD.stats().n === RD.MAX_PAIRS);

// T10: ECE always in [0, 1]
const ece10 = RD.ece();
t('T10 ECE in valid range', ece10 >= 0 && ece10 <= 1, 'ECE=' + ece10);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
