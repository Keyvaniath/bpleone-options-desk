/* Headless test for js/module-attribution.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'module-attribution.js'), 'utf8');
eval(src);
const MA = global.window.ModuleAttribution;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof MA.recordResolution === 'function' && typeof MA.stats === 'function');

// T2: Empty state — all metrics null
MA.reset();
const empty = MA.stats();
t('T2 empty stats', empty.perModule.model.accuracy === null && empty.totalRows === 0);

// T3: Record one — counter increments
MA.reset();
MA.recordResolution({ model: 0.7, ensemble: 0.65, bootstrap: 0.72, knn: 0.6, swa: 0.68 }, 0.69, 1);
const s3 = MA.stats();
t('T3 single recording', s3.totalRows === 1 && s3.perModule.model.n === 1 && s3.perModule.model.accuracy === 1.0);

// T4: Invalid rejected
MA.reset();
MA.recordResolution(null, 0.6, 1);
MA.recordResolution({}, 0.6, 0.5);
MA.recordResolution({ model: 0.7 }, 'bad', 1);
t('T4 invalid records rejected', MA.stats().totalRows === 0);

// T5: Module with all wins → 100% accuracy
MA.reset();
for (let i = 0; i < 20; i++) {
  // Model is perfect; ensemble is wrong
  MA.recordResolution({ model: 0.9, ensemble: 0.1, bootstrap: 0.7, knn: 0.6, swa: 0.5 }, 0.6, 1);
}
const s5 = MA.stats();
t('T5a model 100% accuracy', s5.perModule.model.accuracy === 1.0);
t('T5b ensemble 0% accuracy', s5.perModule.ensemble.accuracy === 0.0);

// T6: Log loss correctly computed (model says 0.9, actual 1 → -log(0.9) ≈ 0.105)
const expectedLogLoss = -Math.log(0.9);
t('T6 log loss correct', Math.abs(s5.perModule.model.logLoss - expectedLogLoss) < 0.001,
   'got ' + s5.perModule.model.logLoss + ' expected ' + expectedLogLoss);

// T7: Brier score (0.9 vs 1 → (0.9-1)^2 = 0.01)
t('T7 brier score correct', Math.abs(s5.perModule.model.brier - 0.01) < 1e-9, 'brier=' + s5.perModule.model.brier);

// T8: Agreement with final
t('T8 agreement with final',
   s5.perModule.model.agreementWithFinal === 1.0 &&
   s5.perModule.ensemble.agreementWithFinal === 0.0);

// T9: Leaderboard sorted by accuracy desc
const ranks = s5.leaderboard.map(r => r.module);
t('T9 leaderboard sort', ranks[0] === 'model' && ranks[ranks.length - 1] === 'ensemble',
   'leaderboard order = ' + ranks.join(' > '));

// T10: Contribution delta — model is well above avg, ensemble below
t('T10a model delta positive', s5.perModule.model.contributionDelta > 0);
t('T10b ensemble delta negative', s5.perModule.ensemble.contributionDelta < 0);

// T11: Missing modules tracked correctly
MA.reset();
for (let i = 0; i < 10; i++) {
  MA.recordResolution({ model: 0.7 }, 0.7, 1); // only model
}
const s11 = MA.stats();
t('T11 missing modules report n=0',
   s11.perModule.knn.n === 0 && s11.perModule.swa.n === 0 && s11.perModule.model.n === 10);

// T12: Window respected
MA.reset();
for (let i = 0; i < 50; i++) {
  MA.recordResolution({ model: 0.8 }, 0.8, 1);
}
for (let i = 0; i < 50; i++) {
  MA.recordResolution({ model: 0.2 }, 0.2, 1);
}
const s12 = MA.stats(50);
// Last 50 all have predProb 0.2, actual 1 — model wrong on all
t('T12 windowing applied', s12.perModule.model.accuracy === 0.0, 'got ' + s12.perModule.model.accuracy);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
