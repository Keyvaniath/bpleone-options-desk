/* Headless test for js/counterfactual-replay.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'counterfactual-replay.js'), 'utf8');
eval(src);
const CR = global.window.CounterfactualReplay;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof CR.measure === 'function' && typeof CR.record === 'function');

// T2: Robust prediction (zero weights everywhere) → robustness = 1.0
const robustModel = { predict: () => ({ prob: 0.5 }) };
const r2 = CR.measure(robustModel, [0.1, 0.2, 0.3, 1.0]);
t('T2 fully robust model → robustness 1', r2 != null && r2.robustness === 1.0);

// T3: Brittle prediction (output flips on every perturbation)
let callCount = 0;
const brittleModel = {
  predict: (x) => {
    callCount++;
    // Random-ish responses make robustness low
    return { prob: callCount % 2 === 0 ? 0.9 : 0.1 };
  }
};
const r3 = CR.measure(brittleModel, [0.1, 0.2, 0.3, 1.0]);
t('T3 brittle model → low robustness', r3.robustness < 0.5, 'robustness=' + r3.robustness);

// T4: Skips bias feature (last index = 1.0)
let lastFeatures = null;
const trackingModel = {
  predict: (x) => { lastFeatures = x; return { prob: 0.5 }; }
};
CR.measure(trackingModel, [0.1, 0.2, 1.0]);
// The bias feature (index 2, value 1.0) should NOT have been perturbed
// We can check that lastFeatures (the last call) doesn't have an altered bias
t('T4 bias skipped', lastFeatures[lastFeatures.length - 1] === 1.0);

// T5: Invalid inputs
t('T5a no model', CR.measure(null, [0.1]) === null);
t('T5b no features', CR.measure(robustModel, null) === null);
t('T5c empty features', CR.measure(robustModel, []) === null);
t('T5d model without predict', CR.measure({}, [0.1]) === null);

// T6: Record + stats
CR.reset();
CR.record(0.9);
CR.record(0.5);
CR.record(0.3);
CR.record(0.95);
CR.record(0.8);
for (let i = 0; i < 10; i++) CR.record(0.85);
const s6 = CR.stats();
t('T6 stats computed', s6.ready && s6.mean != null && s6.brittleCount === 2, 'brittle=' + s6.brittleCount);

// T7: Invalid record rejected
CR.reset();
CR.record(null);
CR.record(-0.1);
CR.record(1.5);
CR.record('bad');
t('T7 invalid record rejected', CR.stats().n === 0);

// T8: FIFO cap
CR.reset();
for (let i = 0; i < 600; i++) CR.record(0.5);
t('T8 FIFO cap', CR.stats(1000).n === CR.MAX_LOG);

// T9: Brittle threshold
CR.reset();
[0.9, 0.5, 0.85, 0.3, 0.75, 0.6].forEach(r => CR.record(r));
const s9 = CR.stats();
// FRAGILE_THRESHOLD = 0.7: 0.5, 0.3, 0.6 = 3 brittle out of 6
t('T9 brittle count correct', s9.brittleCount === 3, 'brittle=' + s9.brittleCount);

// T10: p25 / p75 reasonable
CR.reset();
for (let i = 0; i < 100; i++) CR.record(i / 100);
const s10 = CR.stats();
t('T10 p25 < mean < p75', s10.p25 < s10.mean && s10.mean < s10.p75);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
