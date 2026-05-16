/* Headless test for js/hourly-perf.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'hourly-perf.js'), 'utf8');
eval(src);
const HP = global.window.HourlyPerf;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof HP.recordResolution === 'function' && typeof HP.currentBucket === 'function' && typeof HP.sizeMultiplier === 'function');

// T2: Bucket boundaries
t('T2a open bucket', HP._bucketForMin(580) === 'open');
t('T2b mid-am bucket', HP._bucketForMin(660) === 'mid-am');
t('T2c lunch bucket', HP._bucketForMin(780) === 'lunch');
t('T2d mid-pm bucket', HP._bucketForMin(870) === 'mid-pm');
t('T2e close bucket', HP._bucketForMin(945) === 'close');
t('T2f after-hours below', HP._bucketForMin(500) === 'after-hours');
t('T2g after-hours above', HP._bucketForMin(990) === 'after-hours');

// T3: Empty stats
HP.reset();
const empty = HP.stats();
t('T3 empty perBucket', empty.total === 0 && empty.perBucket.open.n === 0);

// T4: Record + bucketed correctly
HP.reset();
// 11:00 ET = 16:00 UTC in winter (EST = UTC-5) → mid-am bucket [630, 720)
const d = new Date('2025-01-15T16:00:00Z');
HP.recordResolution(0.7, 1, d.getTime());
const s4 = HP.stats();
t('T4 records to correct bucket', s4.perBucket['mid-am'].n === 1, 'mid-am n=' + s4.perBucket['mid-am'].n);

// T5: Invalid inputs rejected
HP.reset();
HP.recordResolution(null, 1, Date.now());
HP.recordResolution(0.5, 0.5, Date.now());
HP.recordResolution('bad', 1, Date.now());
t('T5 invalid inputs rejected', HP.stats().total === 0);

// T6: Bucket-specific accuracy
HP.reset();
// Mid-AM: 20 perfect calls within the [10:30, 12:00) window
// 16:00 UTC = 11:00 ET in EST. Add 0-19 sec to stay in same minute.
const midAM = new Date('2025-01-15T16:00:00Z').getTime();
for (let i = 0; i < 20; i++) {
  HP.recordResolution(0.9, 1, midAM + i * 1000);
}
// Close hour: 20 wrong calls within [15:30, 16:00) window
// 20:35 UTC = 15:35 ET. Add 0-19 sec to stay in same minute.
const closeHr = new Date('2025-01-15T20:35:00Z').getTime();
for (let i = 0; i < 20; i++) {
  HP.recordResolution(0.9, 0, closeHr + i * 1000);
}
const s6 = HP.stats();
t('T6a mid-am accuracy 100%', s6.perBucket['mid-am'].accuracy === 1.0);
t('T6b close accuracy 0%', s6.perBucket['close'].accuracy === 0.0);

// T7: Size multiplier reflects accuracy
const mWin = HP.sizeMultiplier('mid-am');
const mLose = HP.sizeMultiplier('close');
t('T7a high-edge bucket gets boost', mWin > 1.0, 'mWin=' + mWin);
t('T7b low-edge bucket gets penalty', mLose < 1.0, 'mLose=' + mLose);

// T8: Size multiplier bounded
t('T8a mult bounded above', mWin <= 1.2);
t('T8b mult bounded below', mLose >= 0.5);

// T9: Insufficient data → mult = 1.0
HP.reset();
HP.recordResolution(0.7, 1, midAM);
t('T9 insufficient data returns 1.0', HP.sizeMultiplier('mid-am') === 1.0);

// T10: FIFO cap (MAX_LOG = 1000)
HP.reset();
for (let i = 0; i < 1100; i++) {
  HP.recordResolution(0.5, 1, Date.now());
}
t('T10 FIFO cap honored', HP.stats().total === 1000);

// T11: Edge metric computed correctly
HP.reset();
// 30 records all at 16:00 UTC = 11:00 ET (mid-am bucket), 21 wins (70% accuracy)
const t11 = new Date('2025-01-15T16:00:00Z').getTime();
for (let i = 0; i < 30; i++) {
  HP.recordResolution(0.7, i < 21 ? 1 : 0, t11 + i * 1000);
}
const s11 = HP.stats();
t('T11 edge = accuracy - 0.5', Math.abs(s11.perBucket['mid-am'].edge - 0.20) < 1e-9, 'edge=' + s11.perBucket['mid-am'].edge);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
