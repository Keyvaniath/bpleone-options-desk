/* Headless test for js/drawdown-protector.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'drawdown-protector.js'), 'utf8');
eval(src);
const DP = global.window.DrawdownProtector;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API present
t('T1 API present', typeof DP.record === 'function' && typeof DP.sizeMultiplier === 'function' && typeof DP.currentStreak === 'function');

// T2: Empty state
DP.reset();
t('T2 empty stats', DP.currentStreak() === 0 && DP.sizeMultiplier() === 1.0);

// T3: Single win → streak +1
DP.reset();
DP.record(1);
t('T3 single win streak', DP.currentStreak() === 1);

// T4: Single loss → streak -1
DP.reset();
DP.record(0);
t('T4 single loss streak', DP.currentStreak() === -1);

// T5: 3 consecutive losses → multiplier 0.65
DP.reset();
DP.record(0); DP.record(0); DP.record(0);
t('T5a 3-loss streak', DP.currentStreak() === -3);
t('T5b 3-loss multiplier', DP.sizeMultiplier() === 0.65);

// T6: 5 consecutive losses → multiplier 0.40
DP.reset();
for (let i = 0; i < 5; i++) DP.record(0);
t('T6 5-loss multiplier 0.40', DP.sizeMultiplier() === 0.40);

// T7: Win after losing streak resets the streak
DP.reset();
DP.record(0); DP.record(0); DP.record(0); DP.record(1);
t('T7 win breaks streak', DP.currentStreak() === 1 && DP.sizeMultiplier() === 1.0);

// T8: 7-win streak → anti-overconfidence multiplier 0.80
DP.reset();
for (let i = 0; i < 7; i++) DP.record(1);
t('T8 7-win streak multiplier 0.80', DP.sizeMultiplier() === 0.80);

// T9: Invalid input ignored
DP.reset();
DP.record(null);
DP.record('bad');
DP.record(0.5);
t('T9 invalid input ignored', DP.stats().n === 0);

// T10: FIFO cap
DP.reset();
for (let i = 0; i < 250; i++) DP.record(i % 2);
t('T10 FIFO cap honored', DP.stats().n === 200);

// T11: Max streak detection
DP.reset();
// 4 wins, then 6 losses, then 2 wins
for (let i = 0; i < 4; i++) DP.record(1);
for (let i = 0; i < 6; i++) DP.record(0);
for (let i = 0; i < 2; i++) DP.record(1);
const s11 = DP.stats();
t('T11a max win streak', s11.maxWinStreak === 4);
t('T11b max lose streak', s11.maxLoseStreak === 6);
t('T11c current streak +2', s11.currentStreak === 2);

// T12: Win rate
DP.reset();
for (let i = 0; i < 10; i++) DP.record(i < 7 ? 1 : 0);
t('T12 win rate', DP.stats().winRate === 0.7);

// T13: Reasoning strings
DP.reset();
for (let i = 0; i < 5; i++) DP.record(0);
const r13a = DP.reasoning();
t('T13a heavy tilt reasoning', r13a.includes('Cold streak') || r13a.includes('tilt'));

DP.reset();
for (let i = 0; i < 4; i++) DP.record(1);
const r13b = DP.reasoning();
t('T13b winning streak reasoning', r13b.includes('Winning'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
