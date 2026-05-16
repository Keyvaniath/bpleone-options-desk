/* Headless test for js/trade-trust-score.js */
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
// Defer setup of dependent modules

const src = fs.readFileSync(path.join(__dirname, 'js', 'trade-trust-score.js'), 'utf8');
eval(src);
const TT = global.window.TradeTrust;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof TT.score === 'function' && typeof TT.tierOf === 'function');

// T2: All modules absent → no penalties, score = 100
const s2 = TT.score();
t('T2 no modules → score 100', s2.score === 100 && s2.penalties.length === 0);

// T3: Tier classification
t('T3a green', TT.tierOf(95).tier === 'green');
t('T3b amber', TT.tierOf(80).tier === 'amber');
t('T3c caution', TT.tierOf(65).tier === 'caution');
t('T3d warn', TT.tierOf(50).tier === 'warn');
t('T3e danger', TT.tierOf(30).tier === 'danger');

// T4: Add a BSS module that returns negative skill
global.window.BrierSkill = {
  score: () => ({ skill: -0.05, ready: true })
};
const s4 = TT.score();
t('T4 negative BSS → -25', s4.score === 75 && s4.penalties.some(p => p.name === 'BSS < 0'));

// T5: Add Sharpe < 0
global.window.SharpeTracker = {
  score: () => ({ annSharpe: -0.3, ready: true })
};
const s5 = TT.score();
// Now BSS -25, Sharpe -25 → 50
t('T5 negative Sharpe → -25', s5.score === 50);

// T6: Add drawdown deep losing
global.window.DrawdownProtector = {
  stats: () => ({ currentStreak: -6 })
};
const s6 = TT.score();
// BSS -25, Sharpe -25, drawdown -25 → 25
t('T6 deep losing streak → -25', s6.score === 25);

// T7: Add covariate shift
global.window.AdversarialValidator = {
  score: () => ({ shifted: true, lastAuc: 0.85 })
};
const s7 = TT.score();
// 100 -25 -25 -25 -25 = 0, clamped at 0
t('T7 score clamped at 0', s7.score === 0);

// T8: Components passed in — agreement FRAGMENTED + wide conformal
delete global.window.BrierSkill;
delete global.window.SharpeTracker;
delete global.window.DrawdownProtector;
delete global.window.AdversarialValidator;
const s8 = TT.score({ agreementTier: 'FRAGMENTED', conformalHalfwidth: 0.30 });
// -10 (FRAGMENTED) -15 (wide conformal) = 75
t('T8 components passed', s8.score === 75 && s8.penalties.length === 2);

// T9: Good state from passed components — score 100
const s9 = TT.score({ agreementTier: 'STRONG', conformalHalfwidth: 0.10 });
t('T9 clean state', s9.score === 100);

// T10: All factors recorded
global.window.BrierSkill = {
  score: () => ({ skill: 0.18, ready: true })
};
const s10 = TT.score();
t('T10 factor recorded', s10.factors.bss === 0.18);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
