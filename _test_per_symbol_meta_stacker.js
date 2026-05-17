/* Headless test for js/per-symbol-meta-stacker.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'per-symbol-meta-stacker.js'), 'utf8');
eval(src);
const PMS = global.window.PerSymbolMetaStacker;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof PMS.predict === 'function' && typeof PMS.train === 'function');

// T2: Cold start
PMS.reset();
const p2 = PMS.predict('SPY', { model: 0.6, ensemble: 0.55 });
t('T2 cold start with no global → null', p2 === null);

// T3: Cold start falls through to global MetaStacker if available
global.window.MetaStacker = {
  predict: (bp) => ({ prob: 0.7, weights: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] })
};
PMS.reset();
const p3 = PMS.predict('SPY', { model: 0.6 });
t('T3 cold start falls back to global', p3 != null && p3.source === 'global' && p3.prob === 0.7);
delete global.window.MetaStacker;

// T4: Train increments counter
PMS.reset();
PMS.train('SPY', { model: 0.6, ensemble: 0.55, bootstrap: 0.62, knn: 0.58, swa: 0.6 }, 1);
const s4 = PMS.stats('SPY');
t('T4 train increments counter', s4.nTrained === 1);

// T5: Invalid input
PMS.reset();
PMS.train(null, { model: 0.5 }, 1);
PMS.train('SPY', null, 1);
PMS.train('SPY', { model: 0.5 }, 0.5);
t('T5 invalid rejected', PMS.stats('SPY').nTrained === 0);

// T6: Separate per-symbol state
PMS.reset();
PMS.train('SPY', { model: 0.7 }, 1);
PMS.train('NVDA', { model: 0.3 }, 0);
PMS.train('NVDA', { model: 0.3 }, 0);
t('T6 separate state', PMS.stats('SPY').nTrained === 1 && PMS.stats('NVDA').nTrained === 2);

// T7: After MIN_TRAINED, predict uses per-symbol weights
PMS.reset();
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
for (let i = 0; i < 40; i++) {
  const trueP = rng();
  const y = rng() < trueP ? 1 : 0;
  PMS.train('SPY', { model: trueP, ensemble: 0.5, bootstrap: 0.5, knn: 0.5, swa: 0.5 }, y);
}
const p7 = PMS.predict('SPY', { model: 0.7, ensemble: 0.5, bootstrap: 0.5, knn: 0.5, swa: 0.5 });
t('T7 per-symbol predict ready', p7 !== null && p7.source === 'per-symbol' && p7.prob >= 0 && p7.prob <= 1);

// T8: Different symbols develop different weights
PMS.reset();
// Train SPY where 'model' is the dominant predictor
for (let i = 0; i < 50; i++) {
  const trueP = rng();
  PMS.train('SPY', { model: trueP, ensemble: 0.5, bootstrap: 0.5, knn: 0.5, swa: 0.5 }, rng() < trueP ? 1 : 0);
}
// Train NVDA where 'ensemble' is the dominant predictor
for (let i = 0; i < 50; i++) {
  const trueP = rng();
  PMS.train('NVDA', { model: 0.5, ensemble: trueP, bootstrap: 0.5, knn: 0.5, swa: 0.5 }, rng() < trueP ? 1 : 0);
}
const spyW = PMS.stats('SPY').weightsByName;
const nvdaW = PMS.stats('NVDA').weightsByName;
t('T8 different symbols have different weights', spyW.model !== nvdaW.model, 'spy.model=' + spyW.model.toFixed(3) + ' nvda.model=' + nvdaW.model.toFixed(3));

// T9: Leaderboard sorted by training count
PMS.reset();
for (let i = 0; i < 20; i++) PMS.train('SPY', { model: 0.5 }, i % 2);
for (let i = 0; i < 10; i++) PMS.train('NVDA', { model: 0.5 }, i % 2);
const lb = PMS.leaderboard();
t('T9 leaderboard sorted desc', lb[0].symbol === 'SPY' && lb[0].nTrained > lb[1].nTrained);

// T10: stats() with no arg returns object of all symbols
const all = PMS.stats();
t('T10 stats() returns all', typeof all === 'object' && 'SPY' in all && 'NVDA' in all);

// T11: reset single symbol
PMS.reset('SPY');
t('T11 reset single symbol', PMS.stats('SPY').nTrained === 0 && PMS.stats('NVDA').nTrained === 10);

// T12: reset all
PMS.reset();
t('T12 reset all', Object.keys(PMS.stats()).length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
