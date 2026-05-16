/* Headless test for js/hindsight-replay.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'hindsight-replay.js'), 'utf8');
eval(src);
const HR = global.window.HindsightReplay;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API present
t('T1 API present', typeof HR.record === 'function' && typeof HR.triggerReplay === 'function');

// T2: Empty pool
HR.reset();
t('T2 empty', HR.stats().poolSize === 0);

// T3: Confident-and-wrong → recorded
HR.reset();
const recorded = HR.record([0.1, 0.2, 0.3], 0.85, 0, 'NVDA'); // pred LONG (>0.5), actual LOSS
t('T3 confident wrong → recorded', recorded === true && HR.stats().poolSize === 1);

// T4: Confident-and-right → NOT recorded (not hindsight worthy)
HR.reset();
HR.record([0.1, 0.2], 0.85, 1, 'NVDA'); // pred LONG, actual WIN
t('T4 confident right → skipped', HR.stats().poolSize === 0);

// T5: Unconfident wrong (near 50%) → NOT recorded
HR.reset();
HR.record([0.1, 0.2], 0.55, 0, 'NVDA'); // |0.55-0.5| = 0.05 < 0.20
t('T5 unconfident wrong → skipped', HR.stats().poolSize === 0);

// T6: Unconfident right → NOT recorded
HR.reset();
HR.record([0.1, 0.2], 0.55, 1, 'NVDA');
t('T6 unconfident right → skipped', HR.stats().poolSize === 0);

// T7: Invalid input
HR.reset();
t('T7a empty features', HR.record([], 0.85, 0) === false);
t('T7b null features', HR.record(null, 0.85, 0) === false);
t('T7c bad prob', HR.record([1, 2], 'bad', 0) === false);
t('T7d non-binary label', HR.record([1, 2], 0.85, 0.5) === false);

// T8: FIFO cap
HR.reset();
for (let i = 0; i < 150; i++) HR.record([i], 0.85, 0);
t('T8 FIFO cap', HR.stats().poolSize === HR.MAX_POOL);

// T9: triggerReplay calls model.train
HR.reset();
HR.record([0.1, 0.2], 0.90, 0);
HR.record([0.3, 0.4], 0.85, 0);
HR.record([0.5, 0.6], 0.15, 1);
let trainCalls = 0;
const fakeModel = {
  lr: 0.05,
  train: (x, y) => { trainCalls++; return { loss: 0.5 }; }
};
const r9 = HR.triggerReplay(fakeModel, 5);
t('T9 replay called model.train', trainCalls === 3 && r9.replayed === 3);

// T10: Pool preview returns most recent
HR.reset();
HR.record([1], 0.85, 0, 'AAPL');
HR.record([2], 0.90, 0, 'MSFT');
HR.record([3], 0.10, 1, 'GOOG');
const preview = HR.poolPreview(2);
t('T10 preview returns newest first', preview[0].sym === 'GOOG' && preview[1].sym === 'MSFT');

// T11: Mistake size computed
const mistake = preview[0].mistakeSize;
// p=0.10, y=1 → mistakeSize = |0.10-1| = 0.90
t('T11 mistake size computed', Math.abs(mistake - 0.90) < 1e-9);

// T12: triggerReplay with no model
const r12 = HR.triggerReplay(null);
t('T12 null model → null', r12 === null);

// T13: triggerReplay with empty pool
HR.reset();
const r13 = HR.triggerReplay(fakeModel);
t('T13 empty pool → replayed=0', r13.replayed === 0);

// T14: LR restored after replay
HR.reset();
HR.record([0.1], 0.85, 0);
const lrBefore = fakeModel.lr;
HR.triggerReplay(fakeModel, 1);
t('T14 LR restored after replay', fakeModel.lr === lrBefore);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
