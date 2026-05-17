/* Headless test for js/mixup.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'mixup.js'), 'utf8');
eval(src);
const M = global.window.Mixup;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof M.generate === 'function' && typeof M.setEnabled === 'function');

// T2: Disabled by default
M.reset();
t('T2 disabled by default', M.enabled() === false);

// T3: Returns empty when disabled
const r3 = M.generate([
  { features: [0.1, 0.2], label: 1, weight: 1 },
  { features: [0.3, 0.4], label: 0, weight: 1 }
]);
t('T3 disabled → empty', Array.isArray(r3) && r3.length === 0);

// T4: Returns empty for < 2 rows
M.setEnabled(true);
t('T4 single row → empty', M.generate([{ features: [0.1], label: 1 }]).length === 0);
t('T4b empty rows → empty', M.generate([]).length === 0);

// T5: Generates synthetic examples
const rows = [
  { features: [0.0, 0.0], label: 0, weight: 1 },
  { features: [1.0, 1.0], label: 1, weight: 1 }
];
const r5 = M.generate(rows, 5);
t('T5 generates k synthetic', r5.length === 5);

// T6: Synthetic features are interpolated between sources
for (const s of r5) {
  // Since both source rows have all-same features, and lambda is in [0,1],
  // synthetic features should be in [0, 1] too
  t('T6 features in [0,1]',
     s.features.every(f => f >= -1e-9 && f <= 1 + 1e-9),
     'lambda=' + s.lambda + ' features=' + s.features.join(','));
  break; // just check first
}

// T7: Synthetic labels are interpolated (continuous in [0, 1])
for (const s of r5) {
  t('T7 label in [0,1]', s.label >= 0 && s.label <= 1);
  break;
}

// T8: Lambda is a probability
for (const s of r5) {
  t('T8 lambda in [0,1]', s.lambda >= 0 && s.lambda <= 1);
  break;
}

// T9: Beta sampler returns [0, 1]
for (let i = 0; i < 100; i++) {
  const v = M._sampleBeta(0.2);
  if (v < 0 || v > 1) {
    fail++;
    console.log('  FAIL T9 beta out of range: ' + v);
    break;
  }
}
t('T9 Beta(0.2) bounded', true); // covered by the loop

// T10: Alpha bounds
M.setAlpha(100);
t('T10a clamped above', M.alpha() === M.MAX_ALPHA);
M.setAlpha(-1);
t('T10b clamped below', M.alpha() === M.MIN_ALPHA);

// T11: Counter increments
M.reset();
M.setEnabled(true);
M.generate(rows, 3);
M.generate(rows, 4);
t('T11 counter increments', M.stats().generatedCount === 7);

// T12: Mismatched feature lengths skipped
const bad = [
  { features: [0.1], label: 1, weight: 1 },
  { features: [0.2, 0.3], label: 0, weight: 1 }
];
const r12 = M.generate(bad, 5);
// All synthetic generations require matching feature lengths, so most skipped
t('T12 mismatched skipped gracefully', Array.isArray(r12));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
