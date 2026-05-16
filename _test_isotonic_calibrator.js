/* Headless test for js/isotonic-calibrator.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'isotonic-calibrator.js'), 'utf8');
eval(src);
const IC = global.window.IsotonicCalibrator;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof IC.recordPair === 'function' && typeof IC.fit === 'function' && typeof IC.calibrate === 'function');

// T2: Empty stats
IC.reset();
t('T2 empty stats', IC.stats().n === 0 && IC.stats().fitted === false);

// T3: Below MIN_PAIRS_TO_FIT → fit returns false
IC.reset();
for (let i = 0; i < 10; i++) IC.recordPair(0.5, 1);
const r3 = IC.fit();
t('T3 below threshold → no fit', r3.fitted === false);

// T4: PAV algorithm correctness — sorted no violation
IC.reset();
const pairs4 = [
  { p: 0.1, w: 0 }, { p: 0.2, w: 0 }, { p: 0.5, w: 1 }, { p: 0.8, w: 1 }
];
const blocks4 = IC._pav(pairs4);
t('T4 monotonic input → no merging', blocks4.length === pairs4.length);

// T5: PAV with violation pools adjacent
const pairs5 = [
  { p: 0.1, w: 1 }, { p: 0.2, w: 0 }
];
const blocks5 = IC._pav(pairs5);
// p=0.1 has w=1, p=0.2 has w=0 — that's a violation (higher p should have ≥ w)
// PAV should merge them: avg y = 0.5
t('T5 violation merged', blocks5.length === 1 && blocks5[0].y === 0.5);

// T6: Fit with enough data
IC.reset();
// Generate 100 calibration pairs from a sigmoid-like distribution
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
for (let i = 0; i < 100; i++) {
  const p = rng();
  // True prob increases with p, but with noise
  const actualP = 1 / (1 + Math.exp(-3 * (p - 0.5))); // S-curve
  const win = rng() < actualP ? 1 : 0;
  IC.recordPair(p, win);
}
const r6 = IC.fit();
t('T6 fit succeeded', r6.fitted === true && r6.nBins > 0, 'nBins=' + r6.nBins);

// T7: Calibrated probability is monotonic in raw prob
const c0 = IC.calibrate(0.1);
const c5 = IC.calibrate(0.5);
const c9 = IC.calibrate(0.9);
t('T7 calibration monotonic', c0 <= c5 && c5 <= c9, 'c0=' + c0 + ' c5=' + c5 + ' c9=' + c9);

// T8: Calibration in [0, 1]
t('T8a c0 in range', c0 >= 0 && c0 <= 1);
t('T8b c5 in range', c5 >= 0 && c5 <= 1);
t('T8c c9 in range', c9 >= 0 && c9 <= 1);

// T9: Invalid input
IC.reset();
IC.recordPair(null, 1);
IC.recordPair(0.5, 0.5);
IC.recordPair(-0.1, 1);
IC.recordPair(1.5, 0);
t('T9 invalid rejected', IC.stats().n === 0);

// T10: Without model fit, calibrate returns raw
IC.reset();
IC.recordPair(0.5, 1);
t('T10 no model → returns raw', IC.calibrate(0.7) === 0.7);

// T11: FIFO cap
IC.reset();
for (let i = 0; i < 2500; i++) IC.recordPair(rng(), i % 2);
t('T11 FIFO cap', IC.stats().n === 2000);

// T12: Bins can be retrieved
IC.fit();
const bins = IC.getBins();
t('T12 getBins returns array', Array.isArray(bins) && bins.length > 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
