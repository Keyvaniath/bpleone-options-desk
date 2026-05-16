/* Headless test for js/active-learning.js */
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

const src = fs.readFileSync(path.join(__dirname, 'js', 'active-learning.js'), 'utf8');
eval(src);
const AL = global.window.ActiveLearning;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof AL.computeMultiplier === 'function' && typeof AL.record === 'function' && typeof AL.stats === 'function');

// T2: Empty entry → multiplier 1.0
t('T2 empty entry returns 1.0', AL.computeMultiplier({}) === 1.0);
t('T2b null entry returns 1.0', AL.computeMultiplier(null) === 1.0);

// T3: Far from boundary → low multiplier (relative to muddy case)
const confident = AL.computeMultiplier({ predProb: 0.90 });
t('T3 confident prediction has low mult', confident <= 1.5, 'mult=' + confident);

// T4: At boundary → high multiplier
const muddy = AL.computeMultiplier({ predProb: 0.50 });
t('T4 boundary prediction has high mult', muddy > 2.5, 'mult=' + muddy);

// T5: Multipliers bounded
const r1 = AL.computeMultiplier({ predProb: 1.0, uncertaintyStd: 1.0, bootstrapStd: 1.0 });
const r2 = AL.computeMultiplier({ predProb: 0.5, uncertaintyStd: 0, bootstrapStd: 0 });
t('T5a multiplier bounded above', r1 <= AL.MAX_MULT);
t('T5b multiplier bounded below', r2 >= AL.MIN_MULT);

// T6: All three signals combine
const allSignals = AL.computeMultiplier({ predProb: 0.5, uncertaintyStd: 0.15, bootstrapStd: 0.12 });
t('T6 all three signals max out near MAX_MULT', allSignals > 2.7, 'mult=' + allSignals);

// T7: Recording works
AL.reset();
AL.record(2.5, 1, 0.45);
AL.record(1.2, 0, 0.85);
t('T7 record + stats', AL.stats().n === 2);

// T8: Invalid records rejected
AL.reset();
AL.record(null, 1, 0.5);
AL.record(2.0, 0.5, 0.5);   // non-binary
AL.record('bad', 1, 0.5);
t('T8 invalid records rejected', AL.stats().n === 0);

// T9: Distribution buckets sum to total
AL.reset();
const probs = [0.5, 0.5, 0.5, 0.9, 0.85, 0.1];  // 3 muddy, 3 confident
probs.forEach((p, i) => {
  const m = AL.computeMultiplier({ predProb: p });
  AL.record(m, i % 2, p);
});
const s9 = AL.stats();
const totalBuckets = (s9.distribution.low || 0) + (s9.distribution.midLow || 0) + (s9.distribution.midHigh || 0) + (s9.distribution.high || 0);
t('T9 distribution sums to total', totalBuckets === s9.n);

// T10: Gain signal — high-mult examples should have higher pred error
// (because they're the uncertain ones; that's the whole point)
AL.reset();
// 30 muddy examples, mostly wrong
for (let i = 0; i < 30; i++) {
  const p = 0.5 + (Math.random() - 0.5) * 0.05;
  const m = AL.computeMultiplier({ predProb: p });
  AL.record(m, i % 2, p);  // alternating outcomes
}
// 30 confident examples, mostly correct
for (let i = 0; i < 30; i++) {
  const p = 0.9;
  const m = AL.computeMultiplier({ predProb: p });
  AL.record(m, 1, p);  // all wins (matches confident long)
}
const s10 = AL.stats();
t('T10 gain signal computed', s10.gainSignal != null && s10.gainSignal.high > s10.gainSignal.low,
   'high=' + (s10.gainSignal ? s10.gainSignal.high : 'null') + ' low=' + (s10.gainSignal ? s10.gainSignal.low : 'null'));

// T11: Realistic combination — moderate uncertainty
const realistic = AL.computeMultiplier({ predProb: 0.65, uncertaintyStd: 0.08, bootstrapStd: 0.05 });
t('T11 realistic input → mid multiplier', realistic >= 1.3 && realistic <= 2.3, 'mult=' + realistic);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
