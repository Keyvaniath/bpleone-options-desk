/* Headless test for js/sample-decay.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'sample-decay.js'), 'utf8');
eval(src);
const SD = global.window.SampleDecay;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof SD.multiplier === 'function' && typeof SD.setHalfLife === 'function');

// T2: Age 0 → multiplier 1
SD.reset();
t('T2 age 0 → mult 1', SD.multiplier(0) === 1.0);

// T3: Age = halfLife → multiplier 0.5
SD.reset();
t('T3 age 7 days → mult 0.5', Math.abs(SD.multiplier(7) - 0.5) < 1e-9);

// T4: Age = 2*halfLife → multiplier 0.25
SD.reset();
t('T4 age 14 days → mult 0.25', Math.abs(SD.multiplier(14) - 0.25) < 1e-9);

// T5: Custom half-life
SD.reset();
SD.setHalfLife(14);
t('T5 hl=14, age 14 → mult 0.5', Math.abs(SD.multiplier(14) - 0.5) < 1e-9);

// T6: Disabled → returns 1.0
SD.reset();
SD.setEnabled(false);
t('T6 disabled → mult 1', SD.multiplier(100) === 1.0);
SD.setEnabled(true);

// T7: Timestamp input
SD.reset();
const now = Date.now();
const sevenDaysAgo = now - 7 * 86400000;
t('T7 timestamp 7 days ago → mult ~0.5', Math.abs(SD.multiplier(sevenDaysAgo) - 0.5) < 1e-3);

// T8: Invalid input
SD.reset();
t('T8a null → 1', SD.multiplier(null) === 1.0);
t('T8b NaN → 1', SD.multiplier(NaN) === 1.0);
t('T8c Infinity → 1', SD.multiplier(Infinity) === 1.0);

// T9: Negative age clamped to 0
SD.reset();
t('T9 negative age → mult 1', SD.multiplier(-1) === 1.0);

// T10: setHalfLife bounds
SD.reset();
SD.setHalfLife(0);
t('T10a hl clamped above min', SD.halfLife() === SD.MIN_HALFLIFE);

SD.setHalfLife(1000);
t('T10b hl clamped below max', SD.halfLife() === SD.MAX_HALFLIFE);

// T11: Multiplier monotonic decreasing
SD.reset();
SD.setHalfLife(7);
const m0 = SD.multiplier(0);
const m7 = SD.multiplier(7);
const m14 = SD.multiplier(14);
const m30 = SD.multiplier(30);
t('T11 monotonic decreasing', m0 > m7 && m7 > m14 && m14 > m30);

// T12: Counter increments
SD.reset();
SD.multiplier(0);
SD.multiplier(7);
SD.multiplier(14);
t('T12 counter', SD.stats().appliedCount === 3);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
