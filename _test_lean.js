// _test_lean.js — worker pass-333/334: worker/src/lean.js (why the brain leans the way it does; the market echo; the
// pre-registered pass-333 test). Run: node _test_lean.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'lean.js'), 'utf8').replace(/^export (const|function)/gm, '$1');
const L = new Function(src + '\nreturn { leanToday, echoByLag, echoTest, FEATURE_LABELS, CHANGE_DAY };')();
const idx = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'index.js'), 'utf8');

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }

let seed = 5;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const dayKeys = [];
for (let d = new Date(Date.UTC(2026, 7, 3)); dayKeys.length < 70; d = new Date(d.getTime() + 864e5)) {
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
  dayKeys.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate());
}
const model = { weights: Array.from({ length: 22 }, (_, i) => (i === 21 ? 0 : (rnd() - 0.5))), bias: -0.2 };

// 1. leanToday: the per-input terms add up EXACTLY to the shift in the average raw score
{
  const J = [];
  dayKeys.forEach((k, di) => {
    for (let n = 0; n < 25; n++) {
      const f = Array.from({ length: 22 }, (_, i) => (i === 21 ? 1 : i >= 15 && i !== 19 ? 0.5 : rnd() + (di === dayKeys.length - 1 && i === 3 ? 0.3 : 0)));
      J.push({ dayKey: k, features: f, predProb: rnd(), resolved: {} });
    }
  });
  const r = L.leanToday(J, model);
  ok(r.ok && r.day === String(dayKeys[dayKeys.length - 1]) && r.calls === 25 && r.baseline.days === 60, 'today = the last full day; baseline = the previous 60 days');
  const named = r.drivers.reduce((a, d) => a + d.contribution, 0);
  ok(Math.abs(named - r.logit_shift) < 2e-3, 'named drivers add up to the shift (constant inputs contribute 0): ' + named.toFixed(4) + ' vs ' + r.logit_shift);
  ok(r.drivers[0].k === 3, 'the input moved today (f3, +0.3) is the top driver');
  ok(r.drivers.every(d => L.FEATURE_LABELS[d.k]) && !r.drivers.some(d => [15, 16, 17, 18, 20, 21].includes(d.k)), 'unused / neutral inputs are not listed as drivers');
  ok(r.published && r.published.p10 <= r.published.median && r.published.median <= r.published.p90, 'published-probability spread is ordered');
  ok(L.leanToday(J, null).ok === false && L.leanToday([], model).ok === false, 'no model or no days: not ok, with a reason');
}

// 2. echoByLag finds a lag-6 echo when the lean copies the outcome 6 days earlier, and none otherwise
{
  const rose = dayKeys.map(() => rnd());
  const mk = copyLag => {
    const J = [];
    dayKeys.forEach((k, di) => {
      const upShare = copyLag && di >= copyLag ? rose[di - copyLag] : rnd();
      for (let n = 0; n < 30; n++) {
        const up = n < Math.round(upShare * 30);
        const r = n < Math.round(rose[di] * 30);   // whether this name rose
        J.push({ dayKey: k, predProb: up ? 0.6 : 0.4, resolved: { mid: up === r ? 'correct' : 'wrong' } });
      }
    });
    return J;
  };
  const withEcho = L.echoByLag(mk(6), [5, 6, 7]);
  ok(withEcho[6].r > 0.95 && withEcho[6].days === dayKeys.length - 6, 'a lean that copies the outcome 6 days back: echo at lag 6 ~ 1 (' + withEcho[6].r + ')');
  const none = L.echoByLag(mk(0), [6]);
  ok(Math.abs(none[6].r) < 0.35, 'an independent lean: echo near 0 (' + none[6].r + ')');
  const since = L.echoByLag(mk(6), [6], 20, dayKeys[50]);
  ok(since[6].days === dayKeys.length - 50, 'since: only days on or after it count');
}

// 3. echoTest: running before 40 post-change days; pass / fail on the lag-6 echo
{
  ok(L.CHANGE_DAY === 20261117, 'the change day is the first full day after the pass-333 deploy');
  const post = [];
  for (let d = new Date(Date.UTC(2026, 10, 9)); post.length < 52; d = new Date(d.getTime() + 864e5)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    post.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate());
  }
  const rose = post.map(() => rnd());
  const mk = (copy, nDays) => {
    const J = [];
    post.slice(0, nDays).forEach((k, di) => {
      const upShare = copy && di >= 6 ? rose[di - 6] : rnd();
      for (let n = 0; n < 30; n++) {
        const up = n < Math.round(upShare * 30), r = n < Math.round(rose[di] * 30);
        J.push({ dayKey: k, predProb: up ? 0.6 : 0.4, resolved: { mid: up === r ? 'correct' : 'wrong' } });
      }
    });
    return J;
  };
  const early = L.echoTest(mk(false, 20));
  ok(early.verdict === 'running' && early.days < 40, 'fewer than 40 post-change days: running');
  const passed = L.echoTest(mk(false, 52));
  ok(passed.ready && passed.days === 40 && passed.verdict === (passed.echo_lag6 < 0.25 ? 'pass' : 'fail'), 'at 40 days the verdict follows the lag-6 echo (' + passed.echo_lag6 + ' -> ' + passed.verdict + ')');
  const failed = L.echoTest(mk(true, 52));
  ok(failed.ready && failed.verdict === 'fail', 'a lean that still copies last week fails (' + failed.echo_lag6 + ')');
}

ok(/import \{ leanToday, echoByLag(, echoTest)? \} from '\.\/lean\.js';/.test(idx) && /if \(path === '\/brain\/lean'\)/.test(idx), '/brain/lean serves the lean and the echo (echo_test is wired with the next Worker deploy)');
if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('lean: all checks pass');
