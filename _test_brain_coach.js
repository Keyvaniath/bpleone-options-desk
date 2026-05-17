/* Headless test for js/brain-coach.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'brain-coach.js'), 'utf8');
eval(src);
const BC = global.window.BrainCoach;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof BC.summary === 'function');

// T2: With no modules at all → warming-up message
delete global.window.BrierSkill;
delete global.window.SharpeTracker;
delete global.window.DriftPSI;
delete global.window.AdversarialValidator;
delete global.window.DrawdownProtector;
delete global.window.ReliabilityDiagram;
delete global.window.TradeTrust;
delete global.window.HourlyPerf;
const s2 = BC.summary();
t('T2 empty state has headline', typeof s2.headline === 'string' && s2.headline.length > 0);
t('T2b no alerts when no data', s2.alertCount === 0);

// T3: Strong BSS → good diagnosis
global.window.BrierSkill = { score: () => ({ skill: 0.25, ready: true }) };
const s3 = BC.summary();
t('T3 strong BSS adds good diagnosis', s3.diagnosis.some(d => d.kind === 'good' && d.text.includes('Strong')));

// T4: Negative BSS → alert + advice
global.window.BrierSkill = { score: () => ({ skill: -0.10, ready: true }) };
const s4 = BC.summary();
t('T4a negative BSS triggers alert', s4.alertCount > 0);
t('T4b advice includes stop-trading message', s4.advice.some(a => a.text.toLowerCase().includes('stop') || a.text.toLowerCase().includes('reduce')));

// T5: Good Sharpe
global.window.BrierSkill = { score: () => ({ skill: 0.20, ready: true }) };
global.window.SharpeTracker = { score: () => ({ annSharpe: 1.8, ready: true }) };
const s5 = BC.summary();
t('T5 good Sharpe → good diagnosis', s5.diagnosis.some(d => d.text.includes('Excellent') || d.text.includes('Good')));

// T6: Losing Sharpe → alert
global.window.SharpeTracker = { score: () => ({ annSharpe: -0.5, ready: true }) };
const s6 = BC.summary();
t('T6 losing Sharpe triggers alert', s6.alertCount > 0);

// T7: Drift PSI triggers warning
global.window.SharpeTracker = { score: () => ({ annSharpe: 1.5, ready: true }) };
global.window.DriftPSI = { status: () => ({ psi: 0.30 }) };
const s7 = BC.summary();
t('T7 drift triggers alert', s7.alertCount > 0);

// T8: Covariate shift
delete global.window.DriftPSI;
global.window.AdversarialValidator = { score: () => ({ shifted: true, lastAuc: 0.85 }) };
const s8 = BC.summary();
t('T8 covariate shift alerts', s8.alertCount > 0);

// T9: Deep losing streak
delete global.window.AdversarialValidator;
global.window.DrawdownProtector = { stats: () => ({ currentStreak: -6, sizeMultiplier: 0.4, n: 50 }) };
const s9 = BC.summary();
t('T9 deep streak alerts', s9.alertCount > 0 && s9.advice.some(a => a.text.toLowerCase().includes('break')));

// T10: Trust low → DO NOT TRADE
delete global.window.DrawdownProtector;
global.window.TradeTrust = { score: () => ({ score: 25 }) };
const s10 = BC.summary();
t('T10 low trust alerts', s10.alertCount > 0);

// T11: All healthy → green headline
delete global.window.TradeTrust;
global.window.BrierSkill = { score: () => ({ skill: 0.20, ready: true }) };
global.window.SharpeTracker = { score: () => ({ annSharpe: 1.5, ready: true }) };
global.window.TradeTrust = { score: () => ({ score: 95 }) };
const s11 = BC.summary();
t('T11 healthy state has positive headline', s11.headline.toLowerCase().includes('healthy'));

// T12: Health score in [0, 100]
t('T12 health score in range', s11.healthScore >= 0 && s11.healthScore <= 100);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
