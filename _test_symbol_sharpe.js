/* Headless test for js/symbol-sharpe.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'symbol-sharpe.js'), 'utf8');
eval(src);
const SS = global.window.SymbolSharpe;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof SS.record === 'function' && typeof SS.leaderboard === 'function');

// T2: Empty
SS.reset();
t('T2 empty', Object.keys(SS.stats()).length === 0);

// T3: Invalid input
SS.reset();
SS.record(null, 0.001);
SS.record('SPY', 'bad');
SS.record('SPY', NaN);
SS.record('SPY', Infinity);
t('T3 invalid rejected', SS.stats('SPY').n === 0);

// T4: Record per symbol
SS.reset();
SS.record('SPY', 0.002);
SS.record('NVDA', -0.001);
SS.record('SPY', 0.003);
t('T4 per-symbol isolation', SS.stats('SPY').n === 2 && SS.stats('NVDA').n === 1);

// T5: Returns clipped to ±0.5
SS.reset();
for (let i = 0; i < 15; i++) SS.record('SPY', 2.0);
const s5 = SS.stats('SPY');
t('T5 clipped', Math.abs(s5.mean - 0.5) < 1e-9);

// T6: Below MIN_TO_SCORE → not ready
SS.reset();
for (let i = 0; i < 5; i++) SS.record('SPY', 0.001);
t('T6 below min → not ready', SS.stats('SPY').ready === false);

// T7: Sharpe positive when mean > 0
SS.reset();
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
for (let i = 0; i < 100; i++) {
  SS.record('SPY', 0.005 + (rng() - 0.5) * 0.02);
}
t('T7 positive Sharpe', SS.stats('SPY').sharpe > 0);

// T8: Annualization correct
const s8 = SS.stats('SPY');
const ratio = s8.annSharpe / s8.sharpe;
t('T8 annualization scales correctly', Math.abs(ratio - Math.sqrt(SS.PERIODS_PER_YEAR)) < 1e-6);

// T9: Leaderboard sorted desc
SS.reset();
// SPY: positive mean
for (let i = 0; i < 50; i++) SS.record('SPY', 0.005 + (rng() - 0.5) * 0.01);
// AMD: negative mean
for (let i = 0; i < 50; i++) SS.record('AMD', -0.003 + (rng() - 0.5) * 0.01);
const lb = SS.leaderboard();
t('T9 SPY before AMD', lb[0].symbol === 'SPY' && lb[1].symbol === 'AMD');

// T10: FIFO cap per symbol
SS.reset();
for (let i = 0; i < 300; i++) SS.record('TSLA', 0.001 * (i % 3 - 1));
t('T10 FIFO cap per symbol', SS.stats('TSLA', 500).n === SS.MAX_PER_SYMBOL);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
