/* Headless test for js/prediction-histogram.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'prediction-histogram.js'), 'utf8');
eval(src);
const PH = global.window.PredictionHistogram;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof PH.record === 'function' && typeof PH.stats === 'function');

// T2: Empty
PH.reset();
t('T2 empty', PH.stats().ready === false);

// T3: Invalid rejected
PH.reset();
PH.record(null);
PH.record(-0.1);
PH.record(1.5);
PH.record('bad');
t('T3 invalid rejected', PH.stats().n === 0);

// T4: Record + mean
PH.reset();
[0.3, 0.5, 0.7].forEach(p => PH.record(p));
const s4 = PH.stats();
t('T4 mean computed', Math.abs(s4.meanProb - 0.5) < 1e-9);

// T5: Confident vs muddy
PH.reset();
// 5 confident (3 long > 0.75, 2 short < 0.25) + 5 muddy (around 0.5)
[0.85, 0.90, 0.80, 0.10, 0.20].forEach(p => PH.record(p)); // confident
[0.48, 0.50, 0.52, 0.46, 0.54].forEach(p => PH.record(p)); // muddy
const s5 = PH.stats();
t('T5a confident pct', Math.abs(s5.confidentPct - 0.5) < 1e-9);
t('T5b muddy pct', Math.abs(s5.muddyPct - 0.5) < 1e-9);

// T6: Long/short bias
PH.reset();
[0.7, 0.6, 0.8, 0.65, 0.75].forEach(p => PH.record(p)); // all long
const s6 = PH.stats();
t('T6a long pct', s6.longPct === 1.0);
t('T6b short pct', s6.shortPct === 0.0);

// T7: Buckets cover [0, 1] and sum to total
PH.reset();
for (let i = 0; i < 100; i++) PH.record(Math.random());
const bins = PH.buckets(10);
const total = bins.reduce((s, b) => s + b.count, 0);
t('T7 buckets sum to total', total === PH.stats().n);

// T8: Buckets are 10 even bins
t('T8 ten bins', bins.length === 10 && bins[0].binStart === 0 && bins[9].binEnd === 1);

// T9: FIFO cap
PH.reset();
for (let i = 0; i < 1500; i++) PH.record(0.5);
t('T9 FIFO cap', PH.stats().n === 1000);

// T10: Std computed correctly
PH.reset();
// 0.0, 0.5, 1.0 → mean 0.5, std with sample n-1 = sqrt((0.5^2 + 0 + 0.5^2)/2) = sqrt(0.25) = 0.5
PH.record(0.0); PH.record(0.5); PH.record(1.0);
const s10 = PH.stats();
t('T10 std math', Math.abs(s10.stdProb - 0.5) < 1e-9);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
