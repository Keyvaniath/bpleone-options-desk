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

// T4: Trust < 40 → transitions to PAUSED
AP.reset();
global.window.TradeTrust = {
  score: () => ({ score: 25 })
};
const s4 = AP.check();
t('T4 low trust → paused', s4 === 'PAUSED' && AP.isPaused() === true);

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

// T8: From cooldown back to PAUSED if drops again
AP.reset();
global.window.TradeTrust = { score: () => ({ score: 25 }) };
AP.check();
global.window.TradeTrust = { score: () => ({ score: 50 }) };
AP.check();
// now in cooldown
global.window.TradeTrust = { score: () => ({ score: 30 }) };
const s8 = AP.check();
t('T8 cooldown → paused on drop', s8 === 'PAUSED');

// T9: History tracks transitions
const hist = AP.history();
t('T9 history non-empty', hist.length > 0);
t('T9b history has from/to', hist[0].from && hist[0].to);

// T10: Hysteresis — at 45 in active state, stays active (above pause threshold)
AP.reset();
global.window.TradeTrust = { score: () => ({ score: 45 }) };
const s10 = AP.check();
t('T10 stays active above pause threshold', s10 === 'ACTIVE');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
