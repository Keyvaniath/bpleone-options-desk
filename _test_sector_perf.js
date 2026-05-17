/* Headless test for js/sector-perf.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'sector-perf.js'), 'utf8');
eval(src);
const SP = global.window.SectorPerf;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof SP.record === 'function' && typeof SP.leaderboard === 'function');

// T2: Sector mapping
t('T2a NVDA → semi', SP.sectorOf('NVDA') === 'semi');
t('T2b SPY → index', SP.sectorOf('SPY') === 'index');
t('T2c unknown → other', SP.sectorOf('UNKNOWN') === 'other');

// T3: Empty
SP.reset();
t('T3 empty', Object.keys(SP.stats()).length === 0);

// T4: Records into correct sector
SP.reset();
SP.record('NVDA', 0.7, 1, 0.005);
SP.record('AMD', 0.6, 1, 0.003);
SP.record('SPY', 0.5, 0, 0);
const s4 = SP.stats();
t('T4a semi has 2', s4.semi.n === 2);
t('T4b index has 1', s4.index.n === 1);

// T5: Invalid rejected
SP.reset();
SP.record(null, 0.5, 1);
SP.record('NVDA', 'bad', 1);
SP.record('NVDA', 0.5, 0.5);
t('T5 invalid rejected', Object.keys(SP.stats()).length === 0);

// T6: BSS computation per sector
SP.reset();
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
for (let i = 0; i < 30; i++) {
  const p = 0.4 + rng() * 0.4;
  const win = rng() < p ? 1 : 0;
  SP.record('NVDA', p, win, 0.005);
}
const s6 = SP.stats('semi');
t('T6a semi BSS ready', s6.ready && s6.skill != null);
t('T6b semi Sharpe ready', s6.annSharpe != null);

// T7: Size multiplier honors edge
SP.reset();
// Force high-accuracy semi sector
for (let i = 0; i < 30; i++) SP.record('NVDA', 0.9, 1, 0.005); // all correct LONG predictions
const mult7 = SP.sizeMultiplier('semi');
t('T7 high-edge sector → multiplier > 1', mult7 > 1.0, 'mult=' + mult7);

// T8: Multiplier bounded
SP.reset();
for (let i = 0; i < 30; i++) SP.record('NVDA', 0.9, 0, -0.01); // all wrong
const mult8 = SP.sizeMultiplier('semi');
t('T8a multiplier bounded above', mult7 <= 1.2);
t('T8b multiplier bounded below', mult8 >= 0.5);

// T9: Leaderboard sorted by skill
SP.reset();
// semi: high BSS
for (let i = 0; i < 30; i++) SP.record('NVDA', 0.85, 1, 0.01);
// crypto: random
for (let i = 0; i < 30; i++) SP.record('BTC', 0.5, i % 2, 0);
const lb = SP.leaderboard();
t('T9 leaderboard sorted', lb[0].sector === 'semi' || lb[0].skill >= (lb[1] ? lb[1].skill : -Infinity));

// T10: Insufficient data → mult = 1.0
SP.reset();
SP.record('NVDA', 0.7, 1, 0.005);
t('T10 insufficient → mult 1.0', SP.sizeMultiplier('semi') === 1.0);

// T11: FIFO cap per sector
SP.reset();
for (let i = 0; i < 700; i++) SP.record('NVDA', 0.5, i % 2, 0);
t('T11 FIFO cap', SP.stats('semi', 1000).n === 500);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
