/* Headless test for js/dow-perf.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'dow-perf.js'), 'utf8');
eval(src);
const DP = global.window.DowPerf;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof DP.recordResolution === 'function' && typeof DP.sizeMultiplier === 'function');

// T2: Days list
t('T2 days length 7', DP.DAYS.length === 7);

// T3: Empty
DP.reset();
const empty = DP.stats();
t('T3 empty stats', empty.total === 0 && empty.perDay.MON.n === 0);

// T4: Invalid input rejected
DP.reset();
DP.recordResolution(null, 1);
DP.recordResolution(0.5, 0.5);
DP.recordResolution('bad', 1);
t('T4 invalid rejected', DP.stats().total === 0);

// T5: Record on a known Monday timestamp (2025-01-13 is a Monday)
DP.reset();
const mon = new Date('2025-01-13T15:00:00Z').getTime(); // 10:00 ET Monday
DP.recordResolution(0.7, 1, mon);
const s5 = DP.stats();
t('T5 records to Monday', s5.perDay.MON.n === 1, 'MON n=' + s5.perDay.MON.n);

// T6: Per-day stratification
DP.reset();
// 25 wins on Monday
const monBase = new Date('2025-01-13T15:00:00Z').getTime();
for (let i = 0; i < 25; i++) DP.recordResolution(0.9, 1, monBase + i * 1000);
// 25 losses on Friday (2025-01-17 is a Friday)
const friBase = new Date('2025-01-17T15:00:00Z').getTime();
for (let i = 0; i < 25; i++) DP.recordResolution(0.9, 0, friBase + i * 1000);
const s6 = DP.stats();
t('T6a Monday 100% accuracy', s6.perDay.MON.accuracy === 1.0);
t('T6b Friday 0% accuracy', s6.perDay.FRI.accuracy === 0.0);

// T7: Size multiplier reflects edge
const monMult = DP.sizeMultiplier('MON');
const friMult = DP.sizeMultiplier('FRI');
t('T7a Monday boosted', monMult > 1.0, 'monMult=' + monMult);
t('T7b Friday reduced', friMult < 1.0, 'friMult=' + friMult);

// T8: Multiplier bounded
t('T8a bounded above', monMult <= 1.2);
t('T8b bounded below', friMult >= 0.5);

// T9: Below threshold returns 1.0
DP.reset();
DP.recordResolution(0.9, 1, monBase);
t('T9 insufficient data → 1.0', DP.sizeMultiplier('MON') === 1.0);

// T10: FIFO cap
DP.reset();
for (let i = 0; i < 1100; i++) DP.recordResolution(0.5, 1, Date.now());
t('T10 FIFO cap', DP.stats().total === 1000);

// T11: Edge math
DP.reset();
// 30 records, 21 correct (70%)
const wedBase = new Date('2025-01-15T15:00:00Z').getTime(); // Wed
for (let i = 0; i < 30; i++) DP.recordResolution(0.7, i < 21 ? 1 : 0, wedBase + i * 1000);
t('T11 edge math', Math.abs(DP.stats().perDay.WED.edge - 0.20) < 1e-9);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
