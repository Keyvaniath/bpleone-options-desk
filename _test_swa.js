/* Headless test for js/swa.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'swa.js'), 'utf8');
eval(src);
const S = global.window.SWA;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API exists
t('T1 API present', typeof S.snapshot === 'function' && typeof S.predict === 'function' && typeof S.divergence === 'function');

// T2: Empty state
S.reset();
t('T2 not-ready before snapshots', S.stats().ready === false && S.stats().nSnapshots === 0);
t('T2b predict returns null before snapshots', S.predict([0.1, 0.2, 0.3]) === null);

// T3: Single snapshot doesn't make it ready (need MIN_SNAPSHOTS = 5)
S.reset();
const model1 = { weights: [0.1, 0.2, 0.3, 0.4], lastTrainTs: 1 };
const n1 = S.snapshot(model1);
t('T3 snapshot counts', n1 === 1 && S.stats().nSnapshots === 1 && S.stats().ready === false);

// T4: After 5 snapshots, weights are averaged correctly
S.reset();
const modelsA = [
  { weights: [0.1, 0.2, 0.3, 0.4] },
  { weights: [0.2, 0.3, 0.4, 0.5] },
  { weights: [0.3, 0.4, 0.5, 0.6] },
  { weights: [0.4, 0.5, 0.6, 0.7] },
  { weights: [0.5, 0.6, 0.7, 0.8] }
];
modelsA.forEach(m => S.snapshot(m));
const w = S.weights();
const expected = [0.3, 0.4, 0.5, 0.6];
const wclose = w.every((wi, i) => Math.abs(wi - expected[i]) < 1e-9);
t('T4 5 snapshots average correctly', wclose, 'got [' + w.map(x => x.toFixed(3)).join(',') + ']');

// T5: Running average update is correct (mathematical invariant)
S.reset();
S.snapshot({ weights: [0.0] });   // n=1, avg=0.0
S.snapshot({ weights: [10.0] });  // n=2, avg=5.0
S.snapshot({ weights: [20.0] });  // n=3, avg=10.0
const wRA = S.weights();
t('T5 running average math correct', Math.abs(wRA[0] - 10.0) < 1e-9, 'got ' + wRA[0]);

// T6: Predict works after MIN_SNAPSHOTS
S.reset();
for (let i = 0; i < 6; i++) {
  S.snapshot({ weights: [0.5, -0.5, 1.0, 0.0] });
}
const pred = S.predict([1, 1, 0.5, 1]);
// z = 0.5*1 + -0.5*1 + 1.0*0.5 + 0.0*1 = 0.5, sigmoid(0.5) ≈ 0.6225
t('T6 predict with averaged weights', pred && Math.abs(pred.prob - 0.6225) < 0.001, 'prob=' + (pred ? pred.prob : 'null'));

// T7: Divergence measures distance correctly
S.reset();
for (let i = 0; i < 5; i++) {
  S.snapshot({ weights: [1.0, 1.0, 1.0, 1.0] });
}
const div = S.divergence({ weights: [1.0, 1.0, 1.0, 1.0] });
t('T7 divergence zero when model matches SWA', div === 0, 'div=' + div);

const div2 = S.divergence({ weights: [2.0, 2.0, 2.0, 2.0] });
const expectedDiv = Math.sqrt(4 * 1 * 1); // 2 for each of 4 dims, distance √4 = 2
t('T7b divergence Euclidean distance', Math.abs(div2 - expectedDiv) < 1e-9, 'div=' + div2 + ' expected=' + expectedDiv);

// T8: Weight-shape mismatch causes reset (handles model schema changes)
S.reset();
S.snapshot({ weights: [1, 2, 3] });
S.snapshot({ weights: [4, 5, 6] });
const before = S.weights();
t('T8a 3-weight average', before && before.length === 3);
S.snapshot({ weights: [10, 20, 30, 40] }); // different length
const after = S.weights();
t('T8b shape mismatch resets SWA', after.length === 4 && after[0] === 10 && S.stats().nSnapshots === 1);

// T9: Bias-correction over many snapshots — invariant: if all snapshots are identical w*, avg = w*
S.reset();
const wstar = [0.7, -0.3, 1.2, 0.0];
for (let i = 0; i < 50; i++) {
  S.snapshot({ weights: wstar });
}
const wfinal = S.weights();
const ok = wfinal.every((wi, i) => Math.abs(wi - wstar[i]) < 1e-9);
t('T9 stable weights → stable average', ok, 'got [' + wfinal.map(x => x.toFixed(4)).join(',') + ']');

// T10: Invalid input handling
S.reset();
const r1 = S.snapshot(null);
const r2 = S.snapshot({ weights: [] });
const r3 = S.snapshot({});
t('T10 invalid inputs rejected', r1 === null && r2 === null && r3 === null && S.stats().nSnapshots === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
