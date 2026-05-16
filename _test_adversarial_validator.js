/* Headless test for js/adversarial-validator.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'adversarial-validator.js'), 'utf8');
eval(src);
const AV = global.window.AdversarialValidator;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API present
t('T1 API present', typeof AV.captureFeature === 'function' && typeof AV.fit === 'function' && typeof AV.score === 'function');

// T2: Empty state
AV.reset();
t('T2 empty score', AV.score().poolSize === 0);

// T3: capture works (timestamp will be 'now')
AV.reset();
AV.captureFeature([0.1, 0.2, 0.3, 0.4]);
t('T3 capture', AV.score().poolSize === 1);

// T4: Invalid input
AV.reset();
AV.captureFeature(null);
AV.captureFeature([]);
t('T4 invalid rejected', AV.score().poolSize === 0);

// T5: FIFO cap
AV.reset();
for (let i = 0; i < 600; i++) AV.captureFeature([i, i*2]);
t('T5 FIFO cap', AV.score().poolSize === 500);

// T6: Fit requires old + recent
AV.reset();
// Add 100 "recent" features
for (let i = 0; i < 100; i++) AV.captureFeature([Math.random(), Math.random()]);
const res6 = AV.fit();
t('T6 fit fails without old samples', res6.fitted === false, 'got fitted=' + res6.fitted);

// T7: Fit with both pools, same distribution → AUC near 0.5
// Need to manipulate localStorage directly to inject old timestamps
AV.reset();
const oldTs = Date.now() - 48 * 3600 * 1000; // 48h ago
const recentTs = Date.now() - 30 * 60 * 1000; // 30min ago
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
const state = { pool: [], weights: null, lastFitAt: 0, lastAuc: null };
for (let i = 0; i < 80; i++) {
  state.pool.push({ x: [rng(), rng(), rng(), rng()], t: oldTs + i * 1000 });
}
for (let i = 0; i < 80; i++) {
  state.pool.push({ x: [rng(), rng(), rng(), rng()], t: recentTs + i * 1000 });
}
global.localStorage.setItem('bpleone_advval_v1', JSON.stringify(state));
const res7 = AV.fit();
t('T7a fit succeeded', res7.fitted === true, 'got fitted=' + res7.fitted);
t('T7b same dist → AUC ≈ 0.5',
   res7.auc > 0.3 && res7.auc < 0.7,
   'auc=' + (res7.auc != null ? res7.auc.toFixed(3) : 'null'));

// T8: Fit with shifted distribution → high AUC
const state2 = { pool: [], weights: null, lastFitAt: 0, lastAuc: null };
// Old: features near 0
for (let i = 0; i < 80; i++) {
  state2.pool.push({ x: [rng() * 0.2, rng() * 0.2, rng() * 0.2, rng() * 0.2], t: oldTs + i * 1000 });
}
// Recent: features near 1
for (let i = 0; i < 80; i++) {
  state2.pool.push({ x: [0.8 + rng() * 0.2, 0.8 + rng() * 0.2, 0.8 + rng() * 0.2, 0.8 + rng() * 0.2], t: recentTs + i * 1000 });
}
global.localStorage.setItem('bpleone_advval_v1', JSON.stringify(state2));
const res8 = AV.fit();
t('T8a shifted fit succeeded', res8.fitted === true);
t('T8b shifted dist → high AUC', res8.auc > 0.85, 'auc=' + (res8.auc != null ? res8.auc.toFixed(3) : 'null'));
t('T8c shifted=true', res8.shifted === true);

// T9: Predict returns adv score
const pred = AV.predict([0.9, 0.9, 0.9, 0.9]);
t('T9 predict returns 0..1', pred != null && pred >= 0 && pred <= 1, 'pred=' + pred);

// T10: AUC computed correctly — verify with known data
const scores = [
  { p: 0.9, y: 1 }, { p: 0.8, y: 1 }, { p: 0.7, y: 0 }, { p: 0.6, y: 0 }
];
// Manually: y=1 scores are 0.9, 0.8; y=0 are 0.7, 0.6
// All y=1 > all y=0 → AUC = 1.0
// (We test indirectly through fit, but for confidence:)
// T10 is just structural — that the AUC field exists and is numeric
t('T10 auc is numeric', typeof res8.auc === 'number' && isFinite(res8.auc));

// T11: SHIFT_AUC_THRESHOLD makes sense
t('T11 shift threshold in valid range', AV.SHIFT_AUC_THRESHOLD > 0.5 && AV.SHIFT_AUC_THRESHOLD < 1.0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
