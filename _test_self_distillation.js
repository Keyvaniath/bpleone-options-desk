/* Headless test for js/self-distillation.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'self-distillation.js'), 'utf8');
eval(src);
const SD = global.window.SelfDistillation;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof SD.distillStep === 'function' && typeof SD.alpha === 'function');

// T2: Disabled by default
SD.reset();
t('T2 disabled by default', SD.enabled() === false);

// T3: When disabled, distillStep returns null
let trainCalls = 0;
const fakeModel = { train: () => { trainCalls++; return { loss: 0.5 }; } };
const result3 = SD.distillStep(fakeModel, [0.1, 0.2], 1);
t('T3 disabled → no-op', result3 === null && trainCalls === 0);

// T4: Enable + no SWA → still null
SD.setEnabled(true);
delete global.window.SWA;
const result4 = SD.distillStep(fakeModel, [0.1, 0.2], 1);
t('T4 no SWA → null', result4 === null);

// T5: Enable + SWA not ready → null
global.window.SWA = { predict: () => null };
const result5 = SD.distillStep(fakeModel, [0.1, 0.2], 1);
t('T5 SWA not ready → null', result5 === null);

// T6: Enable + SWA ready + valid → trains
global.window.SWA = { predict: () => ({ prob: 0.7 }) };
trainCalls = 0;
const result6 = SD.distillStep(fakeModel, [0.1, 0.2], 1);
// With alpha=0.3, soft = 0.3*0.7 + 0.7*1 = 0.21 + 0.7 = 0.91
t('T6 trains with soft target', result6 != null && Math.abs(result6.softTarget - 0.91) < 1e-9 && trainCalls === 1);

// T7: Alpha override works
const result7 = SD.distillStep(fakeModel, [0.1, 0.2], 0, 0.5);
// With alpha=0.5, soft = 0.5*0.7 + 0.5*0 = 0.35
t('T7 alpha override', Math.abs(result7.softTarget - 0.35) < 1e-9);

// T8: Counter increments
const s8 = SD.stats();
t('T8 counter incremented', s8.stepCount === 2);

// T9: Alpha bounds
SD.setAlpha(2.0);
t('T9a clamped above', SD.alpha() === SD.MAX_ALPHA);
SD.setAlpha(-0.5);
t('T9b clamped below', SD.alpha() === SD.MIN_ALPHA);

// T10: Invalid inputs
SD.reset();
SD.setEnabled(true);
trainCalls = 0;
t('T10a null features', SD.distillStep(fakeModel, null, 1) === null);
t('T10b bad label', SD.distillStep(fakeModel, [0.1], 0.5) === null);
t('T10c no model', SD.distillStep(null, [0.1], 1) === null);
t('T10d no model.train', SD.distillStep({}, [0.1], 1) === null);

// T11: Persistence — enable, set alpha, reload state
SD.reset();
SD.setEnabled(true);
SD.setAlpha(0.45);
const s11 = SD.stats();
t('T11 state persists', s11.enabled === true && s11.alpha === 0.45);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
