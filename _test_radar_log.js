// _test_radar_log.js — unit tests for worker/src/radar.js (pass-317 radar call ledger).
// Run: node _test_radar_log.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'radar.js'), 'utf8')
  .replace(/^export (const|function)/gm, '$1');
const names = ['RADAR_SET', 'RADAR_GROUP', 'FAIR_STRADDLE_CONTAINMENT', 'etDateStr', 'barsToDaily', 'pivots', 'atr14',
  'impliedMoves', 'buildCall', 'fillOutcomes', 'leanStats', 'rangeStats', 'levelStats', 'radarStats'];
const R = new Function(src + '\nreturn {' + names.join(',') + '};')();

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-6);

// --- universe: SPY first (it decides the trading day), semis + tech grouped
ok(R.RADAR_SET[0] === 'SPY', 'SPY must be first');
ok(R.RADAR_SET.every(s => R.RADAR_GROUP[s]), 'every radar name has a group');
ok(R.RADAR_SET.filter(s => R.RADAR_GROUP[s] === 'semis').length >= 12, 'semis coverage');

// --- ET dates from Yahoo session timestamps (13:30 UTC open)
const ts = d => Date.parse(d + 'T13:30:00Z');
ok(R.etDateStr(ts('2026-10-19')) === '2026-10-19', 'etDateStr maps the session open to its ET date');
const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26'];
const rows = days.map((d, i) => ({ ts: ts(d), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }));
const daily = R.barsToDaily(rows.concat([{ ts: ts('2026-10-26') + 3600e3, open: 1, high: 1, low: 1, close: 111.5 }]));
ok(daily.length === days.length && daily[daily.length - 1].c === 111.5, 'barsToDaily: one row per ET date, latest wins');

// --- pivots
const pv = R.pivots({ h: 110, l: 100, c: 106 });
ok(near(pv.P, 105.33, 0.01) && near(pv.R1, 110.67, 0.01) && near(pv.S1, 100.67, 0.01), 'floor-trader pivots');

// --- implied moves: next listed expiry after the session + the 2-6 day row
const C = [];
function add(e, k, cm, pm) { C.push({ expiration: e, strike: k, type: 'call', bid: cm - 0.05, ask: cm + 0.05, mid: cm, iv: 0.2 },
                                    { expiration: e, strike: k, type: 'put', bid: pm - 0.05, ask: pm + 0.05, mid: pm, iv: 0.22 }); }
add('2026-10-19', 106, 0.5, 0.5);                 // today's expiry: must be skipped after the close
add('2026-10-20', 105, 1.6, 0.9); add('2026-10-20', 106, 1.0, 1.0); add('2026-10-20', 107, 0.6, 1.5);
add('2026-10-23', 106, 2.0, 1.9);
add('2026-10-30', 106, 3.0, 2.9);
const im = R.impliedMoves({ contracts: C }, 106.2, '2026-10-19');
ok(im.next && im.next.e === '2026-10-20' && im.next.atm === 106 && near(im.next.pct, 2.0 / 106.2, 1e-4), 'next-expiry straddle at the strike nearest the close');
ok(im.week && im.week.e === '2026-10-23' && im.week.dte === 4 && near(im.week.pct, 3.9 / 106.2, 1e-4), 'week straddle = first expiry 2-6 days out');

// --- buildCall: only on a completed session; lean only when the brain row is fresh
const d6 = daily.slice(0, 6);                                    // last bar 2026-10-19
const sig = { predProb: 0.4344, predProbModel: 0.61, signal: 'HOLD', reason: 'no play: live calibration says the direction signal is uninformative' };
const rec = R.buildCall('SPY', d6, { contracts: C }, sig, '2026-10-19', true);
ok(rec && rec.d === '2026-10-19' && rec.c === 106 && rec.p === 0.4344 && rec.pm === 0.61 && rec.np === true, 'buildCall logs the lean as displayed + the model prob + NO PLAY flag');
ok(rec.e1 === '2026-10-20' && rec.e5 === '2026-10-23' && rec.R1 > rec.P && rec.S1 < rec.P, 'buildCall carries implied moves + pivots');
ok(R.buildCall('SPY', d6, { contracts: C }, sig, '2026-10-20', true) === null, 'no bar for the day (holiday / gap) -> no call');
ok(R.buildCall('SMH', d6, { contracts: C }, null, '2026-10-19', true).p === null, 'no brain row -> no lean, range calls still logged');
ok(R.buildCall('SPY', d6, { contracts: C }, sig, '2026-10-19', false).p === null, 'stale signals -> no lean');

// --- outcomes fill from later bars; done only when every horizon is in
const recs = [rec];
R.fillOutcomes(recs, daily.slice(0, 7));                         // through 10/20
ok(rec.o1 && rec.o1.d === '2026-10-20' && rec.x1 && rec.x1.d === '2026-10-20' && !rec.o5 && !rec.done, 'next session + next-expiry close filled');
R.fillOutcomes(recs, daily);                                     // through 10/26
ok(rec.o5 && rec.o5.d === '2026-10-26' && rec.x5 && rec.x5.d === '2026-10-23' && rec.done, '5th session + week-expiry close filled, done');

// --- lean grading: drift null + overlap correction
function mk(s, d, p, c0, c5) { return { s, d, g: 'semis', p, c: c0, o5: { d, c: c5 } }; }
const L = R.leanStats([
  mk('NVDA', '2026-09-01', 0.6, 100, 105), mk('NVDA', '2026-09-02', 0.6, 100, 104), mk('NVDA', '2026-09-03', 0.6, 100, 99),
  mk('NVDA', '2026-09-20', 0.6, 100, 101), mk('AMD', '2026-09-01', 0.4, 100, 98), mk('AMD', '2026-09-02', 0.4, 100, 103)
]);
ok(L.n === 6 && L.hits === 4 && near(L.hit_rate, 4 / 6, 1e-4), 'lean hits');
ok(L.n_eff === 3, 'overlapping same-name same-direction calls collapse (NVDA 9/1-9/3 = 1, NVDA 9/20 = 1, AMD = 1)');
ok(near(L.up_rate, 4 / 6, 1e-4) && L.beats_drift_95 === false, 'drift null computed; tiny n never "beats drift"');

// --- range grading vs a fair straddle
const rs = R.rangeStats([{ c: 100, m1: 0.02, x1: { c: 101 } }, { c: 100, m1: 0.02, x1: { c: 103 } }, { c: 100, m1: 0.02, x1: { c: 98.5 } }], 1);
ok(rs.n === 3 && near(rs.contained_rate, 2 / 3, 1e-4) && rs.expected_if_fair === R.FAIR_STRADDLE_CONTAINMENT, 'containment vs the fair-straddle benchmark');

// --- the whole report
const st = R.radarStats([rec], 'SPY', 5);
ok(st.days === 1 && st.recent.length === 1 && st.verdict.ready === false && /Accruing/.test(st.verdict.headline), 'radarStats accrues honestly');
ok(st.groups.index.calls === 1 && st.symbols.SPY.calls === 1, 'group + symbol tables');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('radar log: all tests passed');
