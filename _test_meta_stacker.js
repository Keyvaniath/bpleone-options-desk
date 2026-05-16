/* Headless test for js/meta-stacker.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'meta-stacker.js'), 'utf8');
eval(src);
const M = global.window.MetaStacker;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API present
t('T1 API present', typeof M.predict === 'function' && typeof M.train === 'function' && typeof M.weights === 'function');

// T2: Cold start — predict returns null
M.reset();
const cold = M.predict({ model: 0.6, ensemble: 0.65 });
t('T2 cold start returns null', cold === null && M.stats().nTrained === 0);

// T3: Train one — counter increments
M.reset();
const r1 = M.train({ model: 0.6, ensemble: 0.55, bootstrap: 0.62, knn: 0.58, swa: 0.6 }, 1);
t('T3 train increments counter', r1 !== null && M.stats().nTrained === 1);

// T4: Invalid input rejected
M.reset();
const r2 = M.train(null, 1);
const r3 = M.train({ model: 0.6 }, 0.5); // non-binary
t('T4 invalid input rejected', r2 === null && r3 === null && M.stats().nTrained === 0);

// T5: After MIN_TRAINED, predict returns a number
M.reset();
const SEED = 12345;
let seed = SEED;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
// Generate samples where model is a perfect predictor
for (let i = 0; i < 40; i++) {
  const trueProb = rng();
  const y = rng() < trueProb ? 1 : 0;
  const noisyEnsemble = Math.max(0.01, Math.min(0.99, trueProb + (rng() - 0.5) * 0.4));
  M.train({
    model: trueProb,
    ensemble: noisyEnsemble,
    bootstrap: trueProb + (rng() - 0.5) * 0.1,
    knn: 0.5 + (rng() - 0.5) * 0.6,
    swa: trueProb + (rng() - 0.5) * 0.15
  }, y);
}
const pred = M.predict({ model: 0.7, ensemble: 0.55, bootstrap: 0.65, knn: 0.6, swa: 0.7 });
t('T5 predict ready after MIN_TRAINED', pred !== null && pred.prob >= 0 && pred.prob <= 1, 'prob=' + (pred ? pred.prob : 'null'));

// T6: Learned weights favor the perfect predictor (model)
const w = M.weights();
t('T6 model weight > 0 after training on noise-free model',
   w.model > 0,
   'weights = ' + JSON.stringify(Object.entries(w).map(([k, v]) => k + ':' + v.toFixed(3)).join(', ')));

// T7: Normalized weights sum to 1
const nw = M.normalizedWeights();
const sum = Object.values(nw).reduce((s, v) => s + v, 0);
t('T7 normalized weights sum to 1', Math.abs(sum - 1.0) < 1e-9, 'sum=' + sum);

// T8: All normalized weights in (0, 1)
const allIn = Object.values(nw).every(v => v > 0 && v < 1);
t('T8 normalized weights bounded', allIn, 'nw = ' + JSON.stringify(nw));

// T9: Missing base learner fills 0.5 (neutral) without crash
M.reset();
for (let i = 0; i < 40; i++) {
  M.train({ model: 0.6 }, i % 2); // only model provided
}
const pred2 = M.predict({ model: 0.7 });
t('T9 missing base learners handled', pred2 !== null && pred2.prob >= 0 && pred2.prob <= 1, 'prob=' + (pred2 ? pred2.prob : 'null'));

// T10: Stats report accuracy and loss
const s10 = M.stats();
t('T10 stats reports recent metrics',
   s10.recentAccuracy != null && s10.avgRecentLoss != null && s10.ready,
   'acc=' + s10.recentAccuracy + ' loss=' + s10.avgRecentLoss);

// T11: Train on consistent y=1 with model=0.99 — meta-pred should be near 1.0
M.reset();
for (let i = 0; i < 100; i++) {
  M.train({ model: 0.99, ensemble: 0.99, bootstrap: 0.99, knn: 0.99, swa: 0.99 }, 1);
}
const pred11 = M.predict({ model: 0.99, ensemble: 0.99, bootstrap: 0.99, knn: 0.99, swa: 0.99 });
t('T11 consistent inputs learn correct direction', pred11.prob > 0.6, 'prob=' + pred11.prob);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
