/* Headless test for js/setup-tracker.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'setup-tracker.js'), 'utf8');
eval(src);
const ST = global.window.SetupTracker;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof ST.record === 'function' && typeof ST.fromFeatures === 'function' && typeof ST.stats === 'function');

// T2: fromFeatures — bull setup
const bullFeat = new Array(22).fill(0);
bullFeat[11] = 1;  // is_bull_setup
t('T2a bull setup', ST.fromFeatures(bullFeat) === 'bull');

const bearFeat = new Array(22).fill(0);
bearFeat[12] = 1;
t('T2b bear setup', ST.fromFeatures(bearFeat) === 'bear');

const momFeat = new Array(22).fill(0);
momFeat[13] = 1;
t('T2c momentum setup', ST.fromFeatures(momFeat) === 'momentum');

const breakFeat = new Array(22).fill(0);
breakFeat[15] = 1;
t('T2d breakout setup', ST.fromFeatures(breakFeat) === 'breakout');

// T3: Multiple flags → mixed
const mixedFeat = new Array(22).fill(0);
mixedFeat[11] = 1;
mixedFeat[13] = 1;
t('T3 multiple flags → mixed', ST.fromFeatures(mixedFeat) === 'mixed');

// T4: No flags → mixed
const noneFeat = new Array(22).fill(0);
t('T4 no flags → mixed', ST.fromFeatures(noneFeat) === 'mixed');

// T5: Short feature vector → mixed
t('T5 short vector → mixed', ST.fromFeatures([1, 0]) === 'mixed');

// T6: Empty state
ST.reset();
const empty = ST.stats();
t('T6 empty stats', empty.totalRows === 0 && empty.perSetup.bull.n === 0);

// T7: Record + stats
ST.reset();
ST.record('bull', 0.7, 1);
ST.record('bull', 0.6, 1);
ST.record('bear', 0.4, 0);  // pred LONG since 0.4 < 0.5 means SHORT, label 0 means LONG won, so prediction was correct? actually dir = 0 < 0.5 so SHORT; y=0 → wrong direction. Skip.
const s7 = ST.stats();
t('T7a bull n', s7.perSetup.bull.n === 2);
t('T7b bull accuracy 100%', s7.perSetup.bull.accuracy === 1.0);

// T8: Invalid rejected
ST.reset();
ST.record(null, 0.5, 1);
ST.record('bull', 'bad', 1);
ST.record('bull', 0.5, 0.5);  // non-binary
ST.record('unknown', 0.5, 1); // mapped to mixed
const s8 = ST.stats();
t('T8 invalid rejected', s8.totalRows === 1 && s8.perSetup.mixed.n === 1);

// T9: Leaderboard sort
ST.reset();
// Bull: 90% accuracy
for (let i = 0; i < 10; i++) ST.record('bull', 0.8, i < 9 ? 1 : 0);
// Bear: 50% accuracy
for (let i = 0; i < 10; i++) ST.record('bear', 0.6, i % 2);
// Momentum: 70% accuracy
for (let i = 0; i < 10; i++) ST.record('momentum', 0.7, i < 7 ? 1 : 0);
const s9 = ST.stats();
const order = s9.leaderboard.filter(r => r.accuracy != null).map(r => r.setup);
t('T9 leaderboard top is bull', order[0] === 'bull', 'order=' + order.join(' > '));

// T10: Brier math
ST.reset();
// 10 records: predicted 0.7, all wins → brier = (0.7-1)^2 = 0.09
for (let i = 0; i < 10; i++) ST.record('bull', 0.7, 1);
const s10 = ST.stats();
t('T10 brier math', Math.abs(s10.perSetup.bull.brier - 0.09) < 1e-9, 'brier=' + s10.perSetup.bull.brier);

// T11: Win rate
ST.reset();
for (let i = 0; i < 10; i++) ST.record('bull', 0.5, i < 7 ? 1 : 0);
t('T11 win rate', ST.stats().perSetup.bull.winRate === 0.7);

// T12: FIFO cap
ST.reset();
for (let i = 0; i < 600; i++) ST.record('bull', 0.5, i % 2);
t('T12 FIFO cap', ST.stats().totalRows === 200);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
