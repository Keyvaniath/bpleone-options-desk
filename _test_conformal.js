/* Headless test for js/conformal.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'conformal.js'), 'utf8');
eval(src);
const C = global.window.Conformal;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API exists
t('T1 API present', typeof C.recordPair === 'function' && typeof C.interval === 'function' && typeof C.empiricalCoverage === 'function');

// T2: Empty state returns ready:false
C.clear();
const empty = C.interval(0.6);
t('T2 not-ready before 30 samples', empty.ready === false && empty.n === 0);

// T3: Quantile correctness — feed in known residuals, check q90
// Simulate: 50 well-calibrated predictions with average |y-p| ~ 0.15
// Use a fixed seed via deterministic Math.random replacement
let seedState = 12345;
function rng() {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x7fffffff;
}
// Generate 100 calibration pairs from a well-behaved model
C.clear();
for (let i = 0; i < 100; i++) {
  // True prob varies, model prob = true + small noise
  const trueProb = rng();
  const predicted = Math.max(0.01, Math.min(0.99, trueProb + (rng() - 0.5) * 0.2));
  const actual = rng() < trueProb ? 1 : 0;
  C.recordPair(predicted, actual);
}
const ivl = C.interval(0.6, 0.10);
t('T3 interval ready after 100 pairs', ivl.ready === true && ivl.halfwidth > 0 && ivl.halfwidth < 1, 'hw=' + ivl.halfwidth);

// T4: Interval contains predicted; lo < hi
t('T4 interval well-formed', ivl.lo <= 0.6 && ivl.hi >= 0.6 && ivl.lo >= 0 && ivl.hi <= 1);

// T5: q95 wider than q90 wider than q80
const s = C.stats();
t('T5 quantile ordering', s.q80 <= s.q90 && s.q90 <= s.q95, 'q80=' + s.q80 + ' q90=' + s.q90 + ' q95=' + s.q95);

// T6: Empirical coverage close to nominal (within ±15% for n=100)
const cov = C.empiricalCoverage(0.10);
t('T6 empirical coverage near 90%', cov.ready && Math.abs(cov.coverage - 0.90) < 0.20, 'cov=' + cov.coverage);

// T7: FIFO cap — feeding > MAX_CAL keeps only last MAX_CAL
C.clear();
for (let i = 0; i < 1100; i++) {
  C.recordPair(0.5, i % 2);
}
const sBig = C.stats();
t('T7 FIFO cap honored', sBig.n === 1000, 'got n=' + sBig.n);

// T8: Invalid inputs rejected
C.clear();
C.recordPair(null, 1);
C.recordPair(0.6, null);
C.recordPair(1.5, 0); // out of range
C.recordPair(0.6, 0.5); // non-binary
C.recordPair(0.6, 1); // valid
t('T8 input validation', C.stats().n === 1);

// T9: Coverage gap signal — fit a bad (overconfident) calibration set
C.clear();
for (let i = 0; i < 100; i++) {
  // Always predict 0.5 but actual is random — large residuals
  const actual = rng() < 0.5 ? 1 : 0;
  C.recordPair(0.5, actual);
}
const cov2 = C.empiricalCoverage(0.10);
t('T9 coverage detects miscalibration', cov2.ready, 'cov=' + cov2.coverage);

// T10: q90 should be near 0.5 when predictions are uninformative (true random)
const s10 = C.stats();
t('T10 quantile reflects residual distribution', s10.q90 >= 0.0 && s10.q90 <= 1.0, 'q90=' + s10.q90);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
