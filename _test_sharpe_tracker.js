/* Headless test for js/sharpe-tracker.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'sharpe-tracker.js'), 'utf8');
eval(src);
const ST = global.window.SharpeTracker;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof ST.record === 'function' && typeof ST.score === 'function');

// T2: Empty
ST.reset();
t('T2 empty', ST.score().ready === false);

// T3: < 10 → not ready
ST.reset();
for (let i = 0; i < 5; i++) ST.record(0.001);
t('T3 below 10 not ready', ST.score().ready === false);

// T4: Invalid input
ST.reset();
ST.record('bad');
ST.record(null);
ST.record(NaN);
ST.record(Infinity);
t('T4 invalid rejected', ST.score().n === 0);

// T5: Returns clipped to ±0.5
ST.reset();
for (let i = 0; i < 10; i++) ST.record(2.0); // capped to 0.5
const s5 = ST.score();
t('T5 returns clipped', Math.abs(s5.mean - 0.5) < 1e-9, 'mean=' + s5.mean);

// T6: Sharpe math — constant returns → infinite Sharpe (we use 0 when std=0)
ST.reset();
for (let i = 0; i < 20; i++) ST.record(0.005);
const s6 = ST.score();
t('T6 constant returns → mean correct', Math.abs(s6.mean - 0.005) < 1e-9);
t('T6b zero variance → sharpe 0 by definition', s6.sharpe === 0);

// T7: Sharpe positive when mean > 0
ST.reset();
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
for (let i = 0; i < 100; i++) {
  // Returns centered around 0.005 with std ~0.01
  ST.record(0.005 + (rng() - 0.5) * 0.02);
}
const s7 = ST.score();
t('T7 positive mean → positive sharpe', s7.sharpe > 0, 'sharpe=' + s7.sharpe);

// T8: Annualized sharpe scales with sqrt(N periods)
const ratio = s7.annSharpe / s7.sharpe;
const expected = Math.sqrt(s7.periodsPerYear);
t('T8 annualized scales correctly', Math.abs(ratio - expected) < 1e-6, 'ratio=' + ratio + ' expected=' + expected);

// T9: Tiers
t('T9a tier losing', ST.tier(-0.1) === 'losing');
t('T9b tier weak', ST.tier(0.3) === 'weak');
t('T9c tier fair', ST.tier(0.8) === 'fair');
t('T9d tier good', ST.tier(1.2) === 'good');
t('T9e tier excellent', ST.tier(2.0) === 'excellent');
t('T9f tier world-class', ST.tier(3.0) === 'world-class');

// T10: Negative returns → negative sharpe
ST.reset();
for (let i = 0; i < 30; i++) ST.record(-0.005 + (rng() - 0.5) * 0.01);
t('T10 losing strategy → negative sharpe', ST.score().sharpe < 0);

// T11: FIFO cap
ST.reset();
for (let i = 0; i < 600; i++) ST.record(0.001 * (i % 3 - 1));
t('T11 FIFO cap', ST.score().n === 200);

// T12: Std math
ST.reset();
// values: 0, 1, 2 → mean=1, std = sqrt(1) = 1 (with sample n-1 correction)
ST.record(0); ST.record(0.01); ST.record(0.02);
// repeat to get to 10
for (let i = 0; i < 7; i++) { ST.record(0); ST.record(0.01); ST.record(0.02); }
// 24 samples, mean = 0.01, std ≈ 0.0083 (sample std with n-1)
const s12 = ST.score();
t('T12 mean correct', Math.abs(s12.mean - 0.01) < 1e-9, 'mean=' + s12.mean);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
