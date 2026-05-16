/* Headless test for js/brier-skill.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'brier-skill.js'), 'utf8');
eval(src);
const BS = global.window.BrierSkill;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof BS.record === 'function' && typeof BS.score === 'function' && typeof BS.tier === 'function');

// T2: Empty state
BS.reset();
const empty = BS.score();
t('T2 empty score', empty.ready === false && empty.n === 0);

// T3: Need >=10 samples
BS.reset();
for (let i = 0; i < 5; i++) BS.record(0.5, i % 2);
t('T3 not-ready below 10', BS.score().ready === false);

// T4: Invalid input
BS.reset();
BS.record(null, 1);
BS.record(0.5, 0.5);
BS.record(-0.1, 1);
BS.record(1.5, 0);
BS.record('bad', 1);
t('T4 invalid rejected', BS.score().n === 0);

// T5: Brier math correctness
BS.reset();
// 10 records: p=0.7, all wins → Brier = (0.7-1)^2 = 0.09
for (let i = 0; i < 10; i++) BS.record(0.7, 1);
const s5 = BS.score();
t('T5a Brier ≈ 0.09', Math.abs(s5.brier - 0.09) < 1e-9, 'brier=' + s5.brier);
// Baseline: base rate = 1.0, so baseline brier = 0
t('T5b baseline correct', s5.baseline === 0, 'baseline=' + s5.baseline);

// T6: Perfect model
BS.reset();
for (let i = 0; i < 20; i++) BS.record(i % 2 === 0 ? 1.0 : 0.0, i % 2 === 0 ? 1 : 0);
const s6 = BS.score();
t('T6 perfect model → brier 0', s6.brier === 0);
// Baseline: base rate = 0.5, brier_baseline = (0.5)^2 = 0.25
t('T6b baseline = 0.25', Math.abs(s6.baseline - 0.25) < 1e-9);
t('T6c skill = 1.0', s6.skill === 1.0);

// T7: No-info model — always predicts 0.5
BS.reset();
for (let i = 0; i < 20; i++) BS.record(0.5, i % 2);
const s7 = BS.score();
// Brier: (0.5-0)^2 + (0.5-1)^2 = 0.25 + 0.25, mean = 0.25
// Baseline: base rate 0.5 → (0.5 - y)^2 = 0.25 for all → mean 0.25
// Skill = 1 - 0.25/0.25 = 0
t('T7 no-info model → skill ≈ 0', Math.abs(s7.skill) < 1e-9, 'skill=' + s7.skill);

// T8: Bad model (worse than baseline)
BS.reset();
// Always predict 0.9 but actual is 50/50
for (let i = 0; i < 20; i++) BS.record(0.9, i % 2);
const s8 = BS.score();
// Brier: (0.9-0)^2 = 0.81 half the time, (0.9-1)^2 = 0.01 half the time
// Mean = (0.81 + 0.01) / 2 = 0.41
// Baseline: 0.25
// Skill = 1 - 0.41/0.25 = 1 - 1.64 = -0.64
t('T8 overconfident model → negative skill', s8.skill < 0, 'skill=' + s8.skill);

// T9: Tier classifications
t('T9a tier broken', BS.tier(-0.1) === 'broken');
t('T9b tier weak', BS.tier(0.03) === 'weak');
t('T9c tier fair', BS.tier(0.08) === 'fair');
t('T9d tier useful', BS.tier(0.15) === 'useful');
t('T9e tier strong', BS.tier(0.25) === 'strong');
t('T9f tier excellent', BS.tier(0.35) === 'excellent');

// T10: Useful skill model
BS.reset();
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
// Model that's mostly correct (positive skill)
for (let i = 0; i < 100; i++) {
  const trueP = rng();
  const predicted = Math.max(0.05, Math.min(0.95, trueP + (rng() - 0.5) * 0.15));
  const win = rng() < trueP ? 1 : 0;
  BS.record(predicted, win);
}
const s10 = BS.score();
t('T10a model has positive skill', s10.skill > 0, 'skill=' + s10.skill);
t('T10b skill tier valid', ['weak', 'fair', 'useful', 'strong', 'excellent'].indexOf(BS.tier(s10.skill)) !== -1);

// T11: FIFO cap
BS.reset();
for (let i = 0; i < 600; i++) BS.record(0.5, i % 2);
t('T11 FIFO cap', BS.score().n === 200);

// T12: Window respected
BS.reset();
// First 100: perfect
for (let i = 0; i < 100; i++) BS.record(1.0, 1);
// Last 100: random (0.5 predictions)
for (let i = 0; i < 100; i++) BS.record(0.5, i % 2);
// Score with window 100 — should see only the random portion (skill ≈ 0)
const s12 = BS.score(100);
t('T12 window respected', Math.abs(s12.skill) < 0.05, 'skill in last 100=' + s12.skill);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
