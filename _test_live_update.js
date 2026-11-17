// _test_live_update.js — worker pass-333: the live update learns what separates names WITHIN a graded week, not the
// week's market direction. Pulls predict, trainStep and trainStepErr out of worker/src/index.js as source and
// simulates batches like the tick's (about a dozen calls made on the same day, graded together a week later).
// Before pass-333 each call's own error was used, so a week where most names rose pushed the bias and every weight
// toward UP: on 11/16 the brain's daily up-share correlated +0.66 with the share that rose in the batch graded just
// before it. Run: node _test_live_update.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'index.js'), 'utf8');

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }
function grab(header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('not found: ' + header);
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) break; } }
  return src.slice(i, j + 1);
}
const F = new Function(['function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }', grab('function predict(model, features) {'),
  grab('function trainStep(model, features, label) {'), grab('function trainStepErr(model, features, err) {')].join('\n') +
  '\nreturn { predict, trainStep, trainStepErr };')();

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const feats = () => { const f = new Array(22).fill(0.5); for (let i = 0; i < 15; i++) f[i] = rnd(); f[19] = 0.4; f[21] = 1; return f; };
const fresh = () => ({ weights: Array.from({ length: 22 }, (_, i) => (i === 21 ? 0 : (rnd() - 0.5) * 0.4)), bias: -0.1, lr: 0.05, l2: 0.01 });
const clone = m => JSON.parse(JSON.stringify(m));
// The tick's rule (worker/src/index.js, pass-333): errors measured against the batch mean.
function liveStep(model, batch) {
  if (batch.length < 3) return 0;
  const errs = batch.map(it => F.predict(model, it.f) - it.y);
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  batch.forEach((it, i) => F.trainStepErr(model, it.f, errs[i] - mean));
  return batch.length;
}
function oldStep(model, batch) { batch.forEach(it => F.trainStep(model, it.f, it.y)); return batch.length; }
const meanScore = (m, probe) => probe.reduce((a, f) => a + F.predict(m, f), 0) / probe.length;

// 1. A week where every name rose: the old step moves the bias up; the new one leaves it where it was.
{
  const m0 = fresh(), mOld = clone(m0), mNew = clone(m0);
  const batch = Array.from({ length: 12 }, () => ({ f: feats(), y: 1 }));
  oldStep(mOld, batch); liveStep(mNew, batch);
  ok(mOld.bias - m0.bias > 0.2, 'old step: an all-up week raises the bias (got ' + (mOld.bias - m0.bias).toFixed(3) + ')');
  ok(Math.abs(mNew.bias - m0.bias) < 1e-12, 'new step: the bias does not move (demeaned errors sum to zero)');
  const constInputs = [15, 16, 17, 18, 20];
  const drift = constInputs.map(i => Math.abs((mNew.weights[i] - m0.weights[i] * Math.pow(1 - m0.lr * m0.l2, 12))));
  ok(drift.every(d => d < 1e-5), 'new step: inputs held constant at 0.5 change only by weight decay (no bias channel)');
  ok(Math.abs(mNew.weights[21] - m0.weights[21]) < 1e-12, 'new step: the constant-1 column does not move');
}

// 2. The echo: alternate all-up and all-down weeks. The old step swings the average call with each week; the new does not.
{
  const probe = Array.from({ length: 80 }, feats);
  const mOld = fresh(), mNew = clone(mOld);
  const swOld = [], swNew = [];
  for (let wk = 0; wk < 12; wk++) {
    const y = wk % 2 ? 0 : 1;
    const batch = Array.from({ length: 12 }, () => ({ f: feats(), y: rnd() < 0.85 ? y : 1 - y }));
    const bo = meanScore(mOld, probe), bn = meanScore(mNew, probe);
    oldStep(mOld, batch); liveStep(mNew, batch);
    swOld.push(Math.abs(meanScore(mOld, probe) - bo)); swNew.push(Math.abs(meanScore(mNew, probe) - bn));
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  ok(avg(swOld) > 0.05, 'old step: one week moves the average call by ' + (avg(swOld) * 100).toFixed(1) + ' points');
  ok(avg(swNew) < avg(swOld) / 4, 'new step: one week moves it by ' + (avg(swNew) * 100).toFixed(1) + ' points (under a quarter of the old)');
}

// 3. It still learns a real within-week difference: names with a high f3 rise more often, whatever the week did.
{
  const m = fresh(); m.weights[3] = 0;
  for (let wk = 0; wk < 300; wk++) {
    const market = rnd() < 0.5 ? 0.25 : -0.25;   // every week has its own market direction
    const batch = Array.from({ length: 12 }, () => { const f = feats(); const p = 0.5 + market + 0.3 * (f[3] - 0.5); return { f, y: rnd() < p ? 1 : 0 }; });
    liveStep(m, batch);
  }
  ok(m.weights[3] > 0.3, 'new step: learns the within-week signal on f3 (weight ' + m.weights[3].toFixed(2) + ')');
}

// 4. Small batches teach nothing; wiring in the tick
ok(liveStep(fresh(), [{ f: feats(), y: 1 }, { f: feats(), y: 0 }]) === 0, 'a batch under 3 calls is not learned from');
ok(/const LIVE_BATCH_MIN = 3;/.test(src) && /if \(liveBatch\.length >= LIVE_BATCH_MIN\) \{/.test(src) && /trainStepErr\(model, it\.f, errs\[i\] - meanErr\)/.test(src), 'the tick learns from its graded batch with demeaned errors');
ok(!/trainStep\(model, entry\.features, label\)/.test(src), 'the per-call live step (the echo source) is gone');
ok(/const LIVE_BARS = 60;/.test(src) && (src.match(/LIVE_BARS\)/g) || []).length >= 3, 'live bar history keeps 60 bars (seed, backfill and cap)');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('live update: all checks pass');
