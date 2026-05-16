/* Headless test for js/confidence-penalty.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'confidence-penalty.js'), 'utf8');
eval(src);
const CP = global.window.ConfidencePenalty;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof CP.gradAdjustment === 'function' && typeof CP.setBeta === 'function');

// T2: Default β
CP.reset();
t('T2 default beta', CP.beta() === CP.DEFAULT_BETA);

// T3: gradAdjustment at p=0.5 → 0 (no push). Note: enable first since
// default is now disabled.
CP.reset();
CP.setEnabled(true);
t('T3 p=0.5 → adjustment 0', Math.abs(CP.gradAdjustment(0.5)) < 1e-9);

// T4: gradAdjustment at p > 0.5 → positive (pushes p down)
const adj4 = CP.gradAdjustment(0.8);
t('T4 p>0.5 → positive adj', adj4 > 0, 'adj=' + adj4);

// T5: gradAdjustment at p < 0.5 → negative (pushes p up)
const adj5 = CP.gradAdjustment(0.2);
t('T5 p<0.5 → negative adj', adj5 < 0, 'adj=' + adj5);

// T6: Symmetry: gradAdjustment(0.8) + gradAdjustment(0.2) ≈ 0
const adj6 = CP.gradAdjustment(0.8) + CP.gradAdjustment(0.2);
t('T6 symmetric around 0.5', Math.abs(adj6) < 1e-9);

// T7: Scale with β
CP.reset();
CP.setEnabled(true);
CP.setBeta(0.10);
const adj7 = CP.gradAdjustment(0.8);
// With β=0.10, p=0.8: adj = 0.10 × (0.8 - 0.5) = 0.03
t('T7 scaled with beta', Math.abs(adj7 - 0.03) < 1e-9, 'adj=' + adj7);

// T8: β=0 → no adjustment
CP.reset();
CP.setEnabled(true);
CP.setBeta(0);
t('T8 beta=0 → adj=0', CP.gradAdjustment(0.9) === 0);

// T9: Disabled → adj=0
CP.reset();
CP.setEnabled(false);
t('T9 disabled → adj=0', CP.gradAdjustment(0.9) === 0);

// T10: β bounds
CP.reset();
CP.setBeta(10);
t('T10a clamped above', CP.beta() === CP.MAX_BETA);

CP.setBeta(-1);
t('T10b clamped below', CP.beta() === CP.MIN_BETA);

// T11: Invalid input (with module enabled)
CP.reset();
CP.setEnabled(true);
t('T11 invalid p → 0', CP.gradAdjustment(null) === 0 && CP.gradAdjustment('bad') === 0);

// T12: Counter
CP.reset();
CP.setEnabled(true);
CP.gradAdjustment(0.6);
CP.gradAdjustment(0.4);
t('T12 counter', CP.stats().appliedCount === 2);

// T13: Default state is disabled (safety default)
CP.reset();
t('T13 default disabled', CP.enabled() === false);
t('T13b default disabled returns 0', CP.gradAdjustment(0.9) === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
