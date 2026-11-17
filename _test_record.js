// _test_record.js — unit tests for worker/src/record.js (worker pass-329: the live record by week; pass-331: chance rate).
// Run: node _test_record.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'record.js'), 'utf8').replace(/^export (const|function)/gm, '$1');
const R = new Function(src + '\nreturn { weekOf, gradedOutcome, recordByWeek, recordByDay, corr, DAY_MIN_CALLS };')();
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

// chance rate (worker pass-331): the brain's own up/down mix assigned at random
// week 1: called up 2/3, rose 1/3 -> chance = 2/3*1/3 + 1/3*2/3 = 4/9; hit 2/3 -> skill +2/9
ok(Math.abs(w1.chance_rate - 4 / 9) < 1e-3 && Math.abs(w1.skill - 2 / 9) < 1e-3, 'week 1: chance 4/9, skill +2/9');
// week 2: called up 1/2, rose 1/2 -> chance 1/2; hit 0 -> skill -1/2
ok(Math.abs(w2.chance_rate - 0.5) < 1e-3 && Math.abs(w2.skill + 0.5) < 1e-3, 'week 2: chance 1/2, skill -1/2');
ok(out.total.weeks_beat_chance === 1, 'one of two full weeks beat chance');
ok(Math.abs(out.total.mean_weekly_skill - (2 / 9 - 0.5) / 2) < 1e-3, 'mean weekly skill over full weeks');
// calling up every time has skill 0 by construction, whatever the market did
const AU = [];
for (let i = 0; i < 20; i++) AU.push({ dayKey: 20261102, predProb: 0.6, resolved: { mid: i < 7 ? 'correct' : 'wrong' } });
const au = R.recordByWeek(AU).rows[0];
ok(au.chance_rate === au.up_rate && au.skill === 0 && au.hit_rate === au.up_rate, 'an always-up caller scores exactly chance (skill 0)');
// a caller that always gets the direction right in a mixed week has positive skill
const PF = [];
for (let i = 0; i < 20; i++) PF.push({ dayKey: 20261102, predProb: i < 12 ? 0.7 : 0.3, resolved: { mid: 'correct' } });
const pf = R.recordByWeek(PF).rows[0];
ok(pf.hit_rate === 1 && Math.abs(pf.chance_rate - (0.6 * 0.6 + 0.4 * 0.4)) < 1e-4 && pf.skill > 0.4, 'a perfect caller: hit 100%, chance 52%, skill +48 points');
ok(R.recordByWeek([]).total.chance_rate === null && R.recordByWeek([]).total.mean_weekly_skill === null, 'empty record: no chance rate, no mean skill');

// by day (worker pass-332): timing vs selection, one-sided days, undated calls left out
{
  const J2 = [];
  // day A (Mon 11/2): 20 calls, all UP; 15 rose -> one-sided; perfect within-day ranking (higher p = rose)
  for (let i = 0; i < 20; i++) J2.push({ dayKey: 20261102, predProb: 0.55 + i * 0.01, resolved: { mid: i >= 5 ? 'correct' : 'wrong' } });
  // day B (Tue 11/3): 20 calls, 10 UP / 10 DOWN, every call right
  for (let i = 0; i < 20; i++) J2.push({ dayKey: 20261103, predProb: i < 10 ? 0.7 : 0.3, resolved: { mid: 'correct' } });
  // day C (Wed 11/4): only 5 graded calls -> partial, left out of the summary
  for (let i = 0; i < 5; i++) J2.push({ dayKey: 20261104, predProb: 0.6, resolved: { mid: 'correct' } });
  J2.push({ predProb: 0.6, resolved: { mid: 'correct' } });              // undated (pre-dayKey era)
  J2.push({ dayKey: 20261102, predProb: 0.6, resolved: { mid: 'flat' } }); // flat: not graded
  const d = R.recordByDay(J2);
  ok(d.rows.length === 3 && d.rows[2].partial === true && d.rows[0].partial === false, 'three days; the 5-call day is partial');
  ok(d.summary.days === 2 && d.summary.calls === 40 && d.summary.undated === 1, 'summary counts full days and the undated call');
  ok(d.summary.one_sided_days === 1, 'an all-UP day is one-sided; a 50/50 day is not');
  ok(d.rows[0].called_up === 1 && d.rows[0].up_rate === 0.75 && d.rows[0].hit_rate === 0.75 && d.rows[0].chance_rate === 0.75 && d.rows[0].skill === 0, 'day A: calling everything UP scores exactly chance');
  ok(d.rows[0].rank_corr > 0.5, 'day A: higher-rated names rose, so the within-day rank correlation is positive');
  ok(d.rows[1].skill === 0.5 && d.rows[1].rank_corr === 1, 'day B: all right with a 50/50 mix = +50 points over chance, rank corr 1');
  ok(Math.abs(d.summary.selection_skill - 0.25) < 1e-9 && d.summary.selection_skill_se === null, 'selection skill averages the WEEK (one week here, so no error yet)');
  ok(d.summary.weeks === 1, 'errors are taken across weeks, not days');
  ok(R.corr([1, 2, 3], [2, 4, 6]) === 1 && R.corr([1, 2, 3], [3, 2, 1]) === -1 && R.corr([1, 1, 1], [1, 2, 3]) === null && R.corr([1, 2], [1, 2]) === null, 'corr: +1, -1, null on zero variance or n < 3');
  ok(R.recordByDay([]).summary.days === 0 && R.recordByDay(null).summary.timing_corr === null, 'empty journal: empty summary');
}

// route wiring
ok(/import \{ weekOf, recordByWeek, recordByDay \} from '\.\/record\.js';/.test(idx), 'index.js imports record.js');
ok(/rec\.by_day = recordByDay\(journal\);/.test(idx), '/brain/record carries the by-day split (worker pass-332)');
ok(/if \(path === '\/brain\/record'\)/.test(idx) && /recordByWeek\(journal\)/.test(idx), '/brain/record is served from the journal');
ok(/caches\.default/.test(idx.slice(idx.indexOf("if (path === '/brain/record')"), idx.indexOf("if (path === '/brain/record')") + 1500)), '/brain/record is edge-cached (never recomputed per visitor)');

// journal archive (worker pass-330): the oldest graded calls past the cap are archived by month, never deleted
const gsrc = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'grading.js'), 'utf8').replace(/^export (const|function|async function)/gm, '$1');
const G = new Function(gsrc + '\nreturn { splitForCap, archiveBuckets, appendUnique };')();
const Jn = [];
for (let i = 0; i < 12; i++) Jn.push({ id: 'w-' + i, ts: 1790000000000 + i * 86400000, sym: 'S' + (i % 3), dayKey: i < 6 ? 20261030 : 20261102, features: [1, 2], resolved: { mid: 'correct' } });
const sp = G.splitForCap(Jn, 5);
ok(sp.kept.length === 5 && sp.dropped.length === 7 && sp.kept[0].id === 'w-7', 'the cap keeps the newest calls and hands the oldest to the archive');
const bk = G.archiveBuckets('journal', sp.dropped);
ok(Object.keys(bk).sort().join() === 'archive_journal_202610,archive_journal_202611' && bk.archive_journal_202610.length === 6, 'archived by the month of the call (dayKey)');
const again = G.appendUnique(bk.archive_journal_202610, bk.archive_journal_202610.concat(bk.archive_journal_202611));
ok(again.length === 7, 'an interrupted archive pass that repeats does not duplicate calls');
ok(/const JOURNAL_TRIM_BATCH = 1000;/.test(idx) && /if \(journal\.length > MAX_JOURNAL \+ JOURNAL_TRIM_BATCH\) \{\s*const kept = await capAndArchive\(env, 'journal', journal, MAX_JOURNAL\);/.test(idx), 'the tick archives the journal overflow in batches instead of splicing it away');
ok(!/journal\.splice\(0, journal\.length - MAX_JOURNAL\)/.test(idx), 'no plain delete of the oldest journal calls remains');
ok(/\['flow', 'confluence', 'radar', 'journal'\]\.indexOf\(name\)/.test(idx), '/brain/archive serves the journal archive');

// batched history (worker pass-331)
const hb = idx.slice(idx.indexOf("if (path === '/brain/history')"), idx.indexOf("if (path === '/brain/history')") + 3200);
ok(/url\.searchParams\.get\('syms'\)/.test(hb) && /HISTORY_BATCH_MAX/.test(hb), '/brain/history accepts ?syms= (capped batch)');
ok(/HISTORY_BATCH_FETCHES/.test(hb) && /deferred/.test(hb), 'a batch fetches at most HISTORY_BATCH_FETCHES cold names and defers the rest');
ok(/if \(complete && Object\.keys\(histories\)\.length\) ctx\.waitUntil\(cache\.put/.test(hb), 'only a complete batch is edge-cached (never a partial or failed one)');
ok(/if \(UNIVERSE\.includes\(sym\)\)/.test(idx.slice(idx.indexOf('async function historyFor'), idx.indexOf('async function historyFor') + 1500)), 'history KV writes stay limited to UNIVERSE symbols (pass-305 write-budget guard)');
ok(/return json\(\{ error: 'no history for ' \+ sym, sym \}, 404\)/.test(hb), 'single-symbol miss is still a 404');
ok(/called_up: \+\(calledUp \/ pairs\.length\)\.toFixed\(4\)/.test(idx), 'the calibration log row records called_up');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('record: all checks pass');
