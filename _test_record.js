// _test_record.js — unit tests for worker/src/record.js (worker pass-329: the live record by week).
// Run: node _test_record.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'record.js'), 'utf8').replace(/^export (const|function)/gm, '$1');
const R = new Function(src + '\nreturn { weekOf, gradedOutcome, recordByWeek };')();
const idx = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'index.js'), 'utf8');

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }

// weekOf: Monday of the ET calendar week
ok(R.weekOf(20261116) === 20261116, 'a Monday is its own week');
ok(R.weekOf(20261120) === 20261116, 'Friday maps to its Monday');
ok(R.weekOf(20261122) === 20261116, 'Sunday belongs to the week that started Monday');
ok(R.weekOf(20260101) === 20251229, 'week crossing a year boundary');
ok(R.weekOf(20240301) === 20240226, 'leap-year February');
ok(R.weekOf('garbage') === null && R.weekOf(0) === null, 'bad day keys give null');

// grading rule = /brain/metrics live_resolved: only correct/wrong count
ok(R.gradedOutcome({ resolved: { mid: 'correct' } }) === 'correct', 'correct counts');
ok(R.gradedOutcome({ resolved: { mid: 'flat' } }) === null, 'flat is left out');
ok(R.gradedOutcome({ resolved: { mid: false } }) === null, 'pending is left out');
ok(R.gradedOutcome({}) === null, 'no resolved object is left out');

const J = [
  // week of 11/9: 3 graded calls
  { dayKey: 20261109, predProb: 0.7, resolved: { mid: 'correct' } },  // called up, rose
  { dayKey: 20261110, predProb: 0.6, resolved: { mid: 'wrong' } },    // called up, fell
  { dayKey: 20261112, predProb: 0.3, resolved: { mid: 'correct' } },  // called down, fell
  { dayKey: 20261112, predProb: 0.4, resolved: { mid: 'flat' } },     // left out
  { dayKey: 20261113, predProb: 0.8, resolved: { mid: false } },      // pending, left out
  // week of 11/16: 2 graded calls
  { dayKey: 20261116, predProb: 0.55, resolved: { mid: 'wrong' } },   // called up, fell
  { dayKey: 20261117, predProb: 0.45, resolved: { mid: 'wrong' } },   // called down, rose
  { dayKey: 20261117, predProb: NaN, resolved: { mid: 'correct' } }   // bad prob, left out
];
const out = R.recordByWeek(J);
ok(out.rows.length === 2 && out.rows[0].week === '20261109' && out.rows[1].week === '20261116', 'two weeks, oldest first');
const w1 = out.rows[0], w2 = out.rows[1];
ok(w1.n === 3 && Math.abs(w1.hit_rate - 2 / 3) < 1e-3, 'week 1: 2 of 3 right');
ok(Math.abs(w1.up_rate - 1 / 3) < 1e-3, 'week 1: one of three names rose (always-up would hit 1/3)');
ok(Math.abs(w1.called_up - 2 / 3) < 1e-3, 'week 1: two of three calls said up');
const b1 = ((0.7 - 1) ** 2 + (0.6 - 0) ** 2 + (0.3 - 0) ** 2) / 3;
ok(Math.abs(w1.brier - b1) < 1e-3, 'week 1 Brier uses the outcome "rose"');
ok(w2.n === 2 && w2.hit_rate === 0 && w2.up_rate === 0.5, 'week 2: 0 of 2 right, one rose');
ok(out.total.n === 5 && Math.abs(out.total.hit_rate - 0.4) < 1e-9, 'total: 2 of 5 right');
ok(out.total.weeks === 2 && out.total.weeks_beat_always_up === 1, 'week 1 beat always-up (2/3 > 1/3); week 2 did not');
ok(out.rows.every(r => r.partial === false), 'weeks of 3 and 2 calls: neither under half the median (3)');
const P = [];
for (let d = 0; d < 5; d++) for (let i = 0; i < 10; i++) P.push({ dayKey: 20261102 + d, predProb: 0.6, resolved: { mid: i < 6 ? 'correct' : 'wrong' } });
for (let i = 0; i < 10; i++) P.push({ dayKey: 20261109, predProb: 0.6, resolved: { mid: 'correct' } });
const po = R.recordByWeek(P);
ok(po.rows[1].partial === true && po.rows[0].partial === false, 'a week with one graded day (10 vs 50 calls) is partial');
ok(po.total.full_weeks === 1 && po.total.weeks_beat_always_up === 0, 'the partial week (100% hit) is left out of the tally');
ok(!('weeks_beat_majority' in out.total), 'no hindsight baseline (each week majority direction) is reported');
ok(R.recordByWeek([]).rows.length === 0 && R.recordByWeek(null).total.n === 0, 'empty journal gives an empty record');

// route wiring
ok(/import \{ weekOf, recordByWeek \} from '\.\/record\.js';/.test(idx), 'index.js imports record.js');
ok(/if \(path === '\/brain\/record'\)/.test(idx) && /recordByWeek\(journal\)/.test(idx), '/brain/record is served from the journal');
ok(/caches\.default/.test(idx.slice(idx.indexOf("if (path === '/brain/record')"), idx.indexOf("if (path === '/brain/record')") + 1500)), '/brain/record is edge-cached (never recomputed per visitor)');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('record: all checks pass');
