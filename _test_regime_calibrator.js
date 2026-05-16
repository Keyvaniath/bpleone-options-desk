/* Headless test for js/regime-calibrator.js */
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
global.document = { readyState: 'complete', addEventListener: () => {}, dispatchEvent: () => {} };

const src = fs.readFileSync(path.join(__dirname, 'js', 'regime-calibrator.js'), 'utf8');
eval(src);
const RC = global.window.RegimeCalibrator;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof RC.recordPair === 'function' && typeof RC.calibrate === 'function' && typeof RC.classifyRegime === 'function');

// T2: Regime classification by VIX
t('T2a high-vol regime via VIX', RC.classifyRegime(0.2, 25) === 'high-vol');
t('T2b high-vol regime via SPY swing', RC.classifyRegime(2.0, 18) === 'high-vol');
t('T2c bull regime', RC.classifyRegime(0.8, 15) === 'bull');
t('T2d bear regime', RC.classifyRegime(-0.8, 20) === 'bear');
t('T2e chop regime', RC.classifyRegime(0.1, 16) === 'chop');

// T3: Recording — different regimes go to different pools
RC.reset();
RC.recordPair(0.6, 1, 'bull');
RC.recordPair(0.6, 1, 'bear');
RC.recordPair(0.6, 0, 'high-vol');
const s = RC.stats();
t('T3 separate pools per regime', s.bull.n === 1 && s.bear.n === 1 && s['high-vol'].n === 1 && s.chop.n === 0);

// T4: Invalid input rejected
RC.reset();
RC.recordPair('bad', 1, 'bull');
RC.recordPair(0.6, 0.5, 'bull');  // non-binary
RC.recordPair(0.6, 1, 'unknown-regime'); // unknown maps to mixed
const s4 = RC.stats();
t('T4a invalid prob/win rejected', s4.bull.n === 0);
t('T4b unknown regime → mixed', s4.mixed.n === 1);

// T5: Calibration before fit returns raw prob (or global)
RC.reset();
const c = RC.calibrate(0.7, 'bull');
t('T5 calibrate without fit returns input', Math.abs(c - 0.7) < 1e-6);

// T6: Fit produces params after MIN_PAIRS_TO_FIT
RC.reset();
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
// In bull regime, simulate slight overconfidence: model predicts X, actual win rate is X*0.85
for (let i = 0; i < 100; i++) {
  const p = 0.3 + rng() * 0.5; // p in [0.3, 0.8]
  const actualP = p * 0.85;
  const win = rng() < actualP ? 1 : 0;
  RC.recordPair(p, win, 'bull');
}
const fitted = RC.fitRegime('bull');
t('T6 fit returns params', fitted !== null && typeof fitted.a === 'number' && typeof fitted.b === 'number', 'a=' + (fitted ? fitted.a : 'null') + ' b=' + (fitted ? fitted.b : 'null'));

// T7: After fit, calibration shifts overconfident predictions down
const calibrated = RC.calibrate(0.7, 'bull');
t('T7 overconfident input gets pulled down', calibrated < 0.7, 'cal=' + calibrated);

// T8: Different regimes produce different calibrations even with same input
RC.reset();
// Bull: well-calibrated
for (let i = 0; i < 60; i++) {
  const p = 0.3 + rng() * 0.5;
  const win = rng() < p ? 1 : 0;
  RC.recordPair(p, win, 'bull');
}
// High-vol: heavy overconfidence (model 70% → actual 40%)
for (let i = 0; i < 60; i++) {
  const p = 0.3 + rng() * 0.5;
  const win = rng() < (p * 0.55) ? 1 : 0;
  RC.recordPair(p, win, 'high-vol');
}
RC.fitAll();
const cBull = RC.calibrate(0.7, 'bull');
const cHV = RC.calibrate(0.7, 'high-vol');
t('T8 different regimes → different calibration', Math.abs(cBull - cHV) > 0.02, 'bull=' + cBull + ' hv=' + cHV);

// T9: All-regime stats reports correctly
const s9 = RC.stats();
const fittedCount = Object.values(s9).filter(r => r.fitted).length;
t('T9 stats reports fitted regimes', fittedCount >= 2, 'fitted = ' + fittedCount);

// T10: Less-than-MIN_PAIRS regime returns null from fit
RC.reset();
RC.recordPair(0.5, 1, 'chop');
const noFit = RC.fitRegime('chop');
t('T10 below-min regime fit returns null', noFit === null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
