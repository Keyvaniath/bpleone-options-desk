/* Headless test for js/symbol-skill.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'symbol-skill.js'), 'utf8');
eval(src);
const SS = global.window.SymbolSkill;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof SS.record === 'function' && typeof SS.stats === 'function' && typeof SS.leaderboard === 'function');

// T2: Empty
SS.reset();
const empty = SS.stats();
t('T2 empty', Object.keys(empty).length === 0);

// T3: Record per symbol
SS.reset();
SS.record('SPY', 0.7, 1);
SS.record('NVDA', 0.6, 0);
SS.record('SPY', 0.65, 1);
const s3 = SS.stats('SPY');
t('T3 SPY has 2 records', s3.n === 2);

// T4: Invalid rejected
SS.reset();
SS.record('SPY', null, 1);
SS.record('SPY', 0.5, 0.5);
SS.record(null, 0.5, 1);
SS.record('SPY', -0.1, 1);
t('T4 invalid rejected', SS.stats('SPY').n === 0);

// T5: BSS computation correctness
SS.reset();
// 15 records: predicted 0.7, all wins → BSS calc
for (let i = 0; i < 15; i++) SS.record('SPY', 0.7, 1);
const s5 = SS.stats('SPY');
// brier = (0.7-1)^2 = 0.09
// baseline = (1-1)^2 = 0 (all wins, base rate = 1.0)
// skill = 1 - 0.09/0 → fallback 0
t('T5a SPY brier=0.09', Math.abs(s5.brier - 0.09) < 1e-9);
t('T5b SPY base rate = 1', Math.abs(s5.baseRate - 1.0) < 1e-9);
t('T5c SPY skill = 0 (no var in baseline)', s5.skill === 0);

// T6: Mixed outcomes give nontrivial BSS
SS.reset();
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
for (let i = 0; i < 50; i++) {
  const p = 0.4 + rng() * 0.4;
  const win = rng() < p ? 1 : 0;
  SS.record('NVDA', p, win);
}
const s6 = SS.stats('NVDA');
t('T6 NVDA skill computed', s6.skill !== null && s6.skill > -1 && s6.skill < 1, 'skill=' + s6.skill);

// T7: Less than MIN_TO_SCORE → not ready
SS.reset();
for (let i = 0; i < 5; i++) SS.record('AMD', 0.5, 1);
t('T7 below min → not ready', SS.stats('AMD').ready === false);

// T8: Leaderboard sorted by skill
SS.reset();
// SPY: 30 records with mixed outcomes, 70% accuracy → positive skill
for (let i = 0; i < 30; i++) SS.record('SPY', 0.7, i < 21 ? 1 : 0);
// AMD: 30 records mostly random
for (let i = 0; i < 30; i++) SS.record('AMD', 0.5, i % 2);
const lb = SS.leaderboard();
t('T8 leaderboard contains both symbols', lb.length === 2);

// T9: All-symbol stats returns object with all symbols
const all = SS.stats();
t('T9 all stats includes both', all.SPY != null && all.AMD != null);

// T10: FIFO cap per symbol — verify with explicit large window > cap
SS.reset();
for (let i = 0; i < 300; i++) SS.record('TSLA', 0.5, i % 2);
// Use window larger than MAX_PER_SYMBOL to see actual storage
t('T10 FIFO cap per symbol', SS.stats('TSLA', 500).n === SS.MAX_PER_SYMBOL);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
