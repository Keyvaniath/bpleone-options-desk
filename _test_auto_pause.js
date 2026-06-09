/* Headless test for js/auto-pause.js */
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
global.document = { readyState: 'complete', addEventListener: () => {}, dispatchEvent: () => {} };

const src = fs.readFileSync(path.join(__dirname, 'js', 'auto-pause.js'), 'utf8');
eval(src);
const AP = global.window.AutoPause;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof AP.isPaused === 'function' && typeof AP.check === 'function');

// T2: Initial state ACTIVE
AP.reset();
t('T2 initial active', AP.state() === 'ACTIVE' && AP.isPaused() === false);

// T3: Without TradeTrust, check returns current state unchanged
delete global.window.TradeTrust;
AP.reset();
const s3 = AP.check();
t('T3 no TradeTrust → stays current', s3 === 'ACTIVE');

// Pass-98 safety guards: pausing requires (a) BrierSkill resolutions n >= 20
// (never pause on cold start) and (b) 3 consecutive below-threshold checks.
// Mock enough resolutions so the data gate opens, and assert the guards too.
global.window.BrierSkill = { score: () => ({ n: 100 }) };

// T4a: data gate — with too few resolutions, low trust must NOT pause
AP.reset();
global.window.BrierSkill = { score: () => ({ n: 5 }) };
global.window.TradeTrust = { score: () => ({ score: 25 }) };
AP.check(); AP.check(); AP.check();
t('T4a no pause without enough resolutions', AP.state() === 'ACTIVE');

// T4b: consecutive gate — ONE low check must NOT pause
AP.reset();
global.window.BrierSkill = { score: () => ({ n: 100 }) };
const s4single = AP.check();
t('T4b single low check stays active', s4single === 'ACTIVE');

// T4: Trust < 40 for 3 consecutive checks → PAUSED
AP.check();
const s4 = AP.check();
t('T4 low trust x3 → paused', s4 === 'PAUSED' && AP.isPaused() === true, 'got ' + s4);

// T5: From paused, trust 40-60 → COOLDOWN
global.window.TradeTrust = {
  score: () => ({ score: 50 })
};
const s5 = AP.check();
t('T5 paused → cooldown at 40-60', s5 === 'COOLDOWN' && AP.isPaused() === false);

// T6: From cooldown, trust >= 60 → ACTIVE
global.window.TradeTrust = {
  score: () => ({ score: 80 })
};
const s6 = AP.check();
t('T6 cooldown → active at >=60', s6 === 'ACTIVE');

// T7: From active back to active (high score, no change)
const s7 = AP.check();
t('T7 stays active', s7 === 'ACTIVE');

// T8: From cooldown back to PAUSED if drops again (3 consecutive low checks)
AP.reset();
global.window.TradeTrust = { score: () => ({ score: 25 }) };
AP.check(); AP.check(); AP.check(); // ACTIVE -> PAUSED after 3 low
global.window.TradeTrust = { score: () => ({ score: 50 }) };
AP.check(); // PAUSED -> COOLDOWN
// now in cooldown; dropping again needs 3 consecutive below-threshold checks
global.window.TradeTrust = { score: () => ({ score: 30 }) };
AP.check(); AP.check();
const s8 = AP.check();
t('T8 cooldown → paused on drop x3', s8 === 'PAUSED', 'got ' + s8);

// T9: History tracks transitions
const hist = AP.history();
t('T9 history non-empty', hist.length > 0);
t('T9b history has from/to', hist.length > 0 && hist[0].from && hist[0].to);

// T10: Hysteresis — at 45 in active state, stays active (above pause threshold)
AP.reset();
global.window.TradeTrust = { score: () => ({ score: 45 }) };
const s10 = AP.check();
t('T10 stays active above pause threshold', s10 === 'ACTIVE');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
