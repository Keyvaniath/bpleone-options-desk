/* Headless test for js/label-smoothing.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'label-smoothing.js'), 'utf8');
eval(src);
const LS = global.window.LabelSmoothing;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof LS.smooth === 'function' && typeof LS.epsilon === 'function');

// T2: Default smoothing for y=1 with eps=0.05 → 0.975
LS.reset();
const s2a = LS.smooth(1);
t('T2a y=1 → 0.975', Math.abs(s2a - 0.975) < 1e-9, 's2a=' + s2a);

const s2b = LS.smooth(0);
t('T2b y=0 → 0.025', Math.abs(s2b - 0.025) < 1e-9, 's2b=' + s2b);

// T3: Custom eps
LS.reset();
const s3a = LS.smooth(1, 0.10);
t('T3a y=1, eps=0.10 → 0.95', Math.abs(s3a - 0.95) < 1e-9);

const s3b = LS.smooth(0, 0.20);
t('T3b y=0, eps=0.20 → 0.10', Math.abs(s3b - 0.10) < 1e-9);

// T4: Disabled passes through
LS.reset();
LS.setEnabled(false);
t('T4a disabled y=1 → 1', LS.smooth(1) === 1);
t('T4b disabled y=0 → 0', LS.smooth(0) === 0);
LS.setEnabled(true);

// T5: Non-binary passes through
LS.reset();
t('T5 non-binary passes through', LS.smooth(0.5) === 0.5);

// T6: Counter increments
LS.reset();
LS.smooth(1);
LS.smooth(0);
LS.smooth(1);
t('T6 smoothing counter', LS.stats().smoothedCount === 3);

// T7: setEpsilon bound
LS.reset();
LS.setEpsilon(2.0);
t('T7a eps clamped above', LS.epsilon() === LS.MAX_EPSILON);

LS.setEpsilon(-0.5);
t('T7b eps clamped below', LS.epsilon() === LS.MIN_EPSILON);

// T8: Persistence — set epsilon then check stats
LS.reset();
LS.setEpsilon(0.10);
t('T8 epsilon persists', LS.stats().eps === 0.10);

// T9: When eps=0, no smoothing
LS.reset();
LS.setEpsilon(0);
const s9a = LS.smooth(1);
const s9b = LS.smooth(0);
t('T9 eps=0 preserves labels', s9a === 1 && s9b === 0);

// T10: Default state
LS.reset();
const s10 = LS.stats();
t('T10 default state', s10.eps === LS.DEFAULT_EPSILON && s10.enabled === true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
