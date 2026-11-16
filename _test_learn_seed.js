// _test_learn_seed.js — pass 347: js/learn.js purges the synthetic seed a browser may still hold.
// Before it was disabled, Learn.seedIfEmpty() wrote 240 Math.random trades ('t_seed_' ids) rigged so "good" setups won
// more often, and every setup weight, per-symbol weight and conditional factor was fit to them. Brandon's own browser
// still held 240 seeded trades and 0 real ones on 11/16. Run: node _test_learn_seed.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('FAIL: ' + m); } }

function loadLearn(initial) {
  const store = Object.assign({}, initial);
  const ctx = { console, Date, Math, JSON, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'learn.js'), 'utf8'), ctx);
  return { Learn: ctx.Learn, store };
}

const seeded = [];
for (let i = 0; i < 240; i++) seeded.push({ id: 't_seed_' + i, ts: 1e12 + i, symbol: 'NVDA', setup: i % 2 ? 'bull-flag' : 'gamma-squeeze', sector: 'Tech', bias: 'bull', result: i % 3 ? 'win' : 'loss', R: i % 3 ? 2 : -0.8, holdDays: 3 });
const real = { id: 't_1700000000000_abcde', ts: 1.7e12, symbol: 'AAPL', setup: 'macd-cross', bias: 'bull', result: 'loss', R: -1, holdDays: 2 };
const poisoned = { version: 1, trades: seeded.concat([real]), signals: [], counters: {},
  weights: { 'macd-cross': 1.0, '50ma-reclaim': 1.0, 'bull-flag': 1.42, 'cup-handle': 1.0, 'unusual-call': 1.0, 'unusual-put': 1.0, '52w-break': 1.0, 'rsi-divergence': 1.0, 'volume-breakout': 1.0, 'gamma-squeeze': 1.37, 'sweep': 1.0, 'block': 1.0 },
  symbolWeights: { NVDA: { 'bull-flag': { w: 1.5, n: 120 } } }, conditional: { 'bull-flag': { sector: { Tech: 1.3 } } } };

const { Learn, store } = loadLearn({ bpleone_learn_v1: JSON.stringify(poisoned) });
const after = JSON.parse(store.bpleone_learn_v1);
ok(after.trades.length === 1 && after.trades[0].id === real.id, 'every t_seed_ trade is purged, the real trade stays (got ' + after.trades.length + ')');
ok(after.weights['bull-flag'] === 1 && after.weights['gamma-squeeze'] === 1, 'setup weights fit to the seed are reset');
ok(!after.symbolWeights || !after.symbolWeights.NVDA, 'per-symbol weights fit to the seed are dropped');
ok(after.conditional && !after.conditional['bull-flag'], 'conditional factors fit to the seed are dropped');
ok(after.seedPurged && after.seedPurged.removed === 240, 'the purge is recorded with its count');
ok(Learn.weightFor('bull-flag', { symbol: 'NVDA' }) === 1, 'weightFor no longer returns a seed-trained weight');
ok(typeof Learn.seedIfEmpty === 'undefined' && !/function seedIfEmpty/.test(fs.readFileSync(path.join(__dirname, 'js', 'learn.js'), 'utf8')), 'the seeding function is gone');

const clean = { version: 1, trades: [real], signals: [], counters: {}, weights: Object.assign({}, poisoned.weights, { 'bull-flag': 1, 'gamma-squeeze': 1 }) };
const c2 = loadLearn({ bpleone_learn_v1: JSON.stringify(clean) });
ok(!JSON.parse(c2.store.bpleone_learn_v1).seedPurged, 'a clean store is left alone');
const c3 = loadLearn({});
ok(!c3.store.bpleone_learn_v1 || JSON.parse(c3.store.bpleone_learn_v1).trades.length === 0, 'an empty browser gets no trades');

console.log(fails ? fails + ' learn-seed test(s) FAILED' : 'learn seed purge: all tests passed');
process.exit(fails ? 1 : 0);
