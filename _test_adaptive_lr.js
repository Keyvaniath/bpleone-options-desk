/* Headless test for js/adaptive-lr.js */
const fs = require('fs');
const path = require('path');

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { for (const k in store) delete store[k]; }
};

// Mock ModelStore — minimal interface used by AdaptiveLR
const fakeModel = { lr: 0.05, lossHistory: [] };
global.window = {
  ModelStore: {
    load: () => fakeModel,
    save: (m) => { Object.assign(fakeModel, m); }
  }
};
global.document = { readyState: 'complete', addEventListener: () => {} };

const src = fs.readFileSync(path.join(__dirname, 'js', 'adaptive-lr.js'), 'utf8');
eval(src);
const AL = global.window.AdaptiveLR;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof AL.update === 'function' && typeof AL.stats === 'function');

// T2: Skip when not enough samples
AL.reset();
fakeModel.lossHistory = [];
const r2 = AL.update();
t('T2 skip with no losses', r2.skipped === true);

// T3: With < MIN_LOSSES, still skip
AL.reset();
fakeModel.lossHistory = [
  { loss: 0.5 }, { loss: 0.5 }, { loss: 0.5 }
];
const r3 = AL.update();
t('T3 skip with too few losses', r3.skipped === true);

// T4: Slope math correctness
const flat = AL._slope([1, 1, 1, 1, 1]);
t('T4a flat slope = 0', Math.abs(flat) < 1e-9, 'slope=' + flat);

const rising = AL._slope([0, 1, 2, 3, 4]);
t('T4b rising slope = 1', Math.abs(rising - 1.0) < 1e-9, 'slope=' + rising);

const falling = AL._slope([4, 3, 2, 1, 0]);
t('T4c falling slope = -1', Math.abs(falling - (-1.0)) < 1e-9, 'slope=' + falling);

// T5: Rising loss → LR up
AL.reset();
fakeModel.lr = 0.05;
const losses5 = [];
for (let i = 0; i < 30; i++) losses5.push({ loss: 0.40 + i * 0.005 }); // rising by 0.005/step
fakeModel.lossHistory = losses5;
const r5 = AL.update();
t('T5a rising loss detected', r5.direction === 'up', 'dir=' + r5.direction);
t('T5b LR went up', r5.lrNew > r5.lrOld, 'lr ' + r5.lrOld + ' → ' + r5.lrNew);

// T6: Falling loss → LR down
AL.reset();
fakeModel.lr = 0.05;
const losses6 = [];
for (let i = 0; i < 30; i++) losses6.push({ loss: 0.40 - i * 0.005 });
fakeModel.lossHistory = losses6;
const r6 = AL.update();
t('T6a falling loss detected', r6.direction === 'down', 'dir=' + r6.direction);
t('T6b LR went down', r6.lrNew < r6.lrOld, 'lr ' + r6.lrOld + ' → ' + r6.lrNew);

// T7: Flat loss → no change
AL.reset();
fakeModel.lr = 0.05;
const losses7 = new Array(30).fill({ loss: 0.45 });
fakeModel.lossHistory = losses7;
const r7 = AL.update();
t('T7 flat loss → no change', r7.direction === 'unchanged' && r7.lrOld === r7.lrNew);

// T8: LR bounded above
AL.reset();
fakeModel.lr = 0.09; // close to max 0.10
const losses8 = [];
for (let i = 0; i < 30; i++) losses8.push({ loss: 0.30 + i * 0.020 }); // strong rise
fakeModel.lossHistory = losses8;
let r8 = AL.update();
let attempts = 0;
while (r8.direction === 'up' && r8.lrNew < AL.stats().maxLr && attempts < 5) {
  fakeModel.lr = r8.lrNew;
  fakeModel.lossHistory = losses8;
  r8 = AL.update();
  attempts++;
}
t('T8 LR bounded above at maxLr', fakeModel.lr <= AL.stats().maxLr + 1e-9, 'final lr=' + fakeModel.lr);

// T9: LR bounded below at minLr
AL.reset();
fakeModel.lr = 0.011; // close to min 0.01
const losses9 = [];
for (let i = 0; i < 30; i++) losses9.push({ loss: 0.50 - i * 0.015 });
fakeModel.lossHistory = losses9;
let r9 = AL.update();
attempts = 0;
while (r9.direction === 'down' && r9.lrNew > AL.stats().minLr && attempts < 10) {
  fakeModel.lr = r9.lrNew;
  fakeModel.lossHistory = losses9;
  r9 = AL.update();
  attempts++;
}
t('T9 LR bounded below at minLr', fakeModel.lr >= AL.stats().minLr - 1e-9, 'final lr=' + fakeModel.lr);

// T10: History tracked
AL.reset();
fakeModel.lossHistory = losses5;
AL.update();
AL.update();
const s10 = AL.stats();
t('T10 history grows', s10.recentHistory.length >= 2);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
