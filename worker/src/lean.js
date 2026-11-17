// lean.js — why the brain leans the way it does today (worker pass-333). Pure; the /brain/lean route lives in index.js.
//
// The 11/16 by-day record showed that on about half of graded days the brain calls 90%+ of its names the same way: it
// is mostly reading the whole market, and nothing on the site said why. The model is logistic, so its score for a
// call is the log-odds z = w . x + b on the call's 22 inputs. Averaged over a day's calls, the gap between today and
// an average recent day splits EXACTLY into one term per input:
//     mean z(today) - mean z(baseline) = sum_k w_k * (mean x_k(today) - mean x_k(baseline))
// so each input's term says how much it moved today's call up or down compared with the previous 60 days. It uses
// the model's CURRENT weights on the journaled inputs (the weights at capture time may differ slightly) and explains
// the raw model score, before the per-symbol and calibration layers. It is a description of the call, not evidence
// that the call is right: the live record says it is not (no timing or picking skill on 11/16).

export const FEATURE_LABELS = [
  'Share of the 14-day move that was up (RSI-like)',
  'Today’s high-low range',
  'Average daily range, 14 days (ATR %)',
  '5-day return',
  '20-day return',
  'Today’s change',
  'Volume vs its 14-day average',
  'Position in the 14-day high-low range',
  'Distance from the 14-day average',
  'Distance from the 50-day average',
  'Position in the 50-day high-low range',
  '5-day minus 20-day return',
  '10-day return',
  'Share of up days, last 14',
  'Recent range vs 20-day range',
  null, null, null,           // f15-f17: unused, held at 0.5
  null,                       // f18: VIX, held at 0.5 since pass-332 (the bootstrap never trains on it)
  'Day of the week',
  null,                       // f20: time of day, held at 0.5 since pass-332
  null                        // f21: the constant bias input
];
export const LEAN_MIN_CALLS = 20;

// The echo: correlation, across days, of the share of names the brain called UP with the share of names that ROSE
// among calls made `lag` sessions earlier. At lag ~6 those are the calls graded (and, before pass-333, trained on)
// just before the day's calls are made. On 11/16 it was +0.66 at lag 6 (118 days): the brain's market-wide lean was
// mostly an echo of the last graded week's market direction, pushed in by the live update step. Pass-333 measures
// errors against the batch mean, which removes that channel; this number is how the change is checked.
export function echoByLag(journal, lags, minCalls) {
  const min = minCalls || LEAN_MIN_CALLS;
  const D = new Map();
  for (const e of journal || []) {
    const k = Number(e && e.dayKey);
    if (!(k > 19000101) || typeof e.predProb !== 'number') continue;
    let d = D.get(k); if (!d) { d = { n: 0, up: 0, g: 0, rose: 0 }; D.set(k, d); }
    d.n++; const up = e.predProb >= 0.5; if (up) d.up++;
    const o = e.resolved && e.resolved.mid;
    if (o === 'correct' || o === 'wrong') { d.g++; if ((up && o === 'correct') || (!up && o === 'wrong')) d.rose++; }
  }
  const days = [...D.keys()].filter(k => D.get(k).n >= min).sort((a, b) => a - b);
  const out = {};
  for (const lag of lags || [4, 5, 6, 7, 8]) {
    const x = [], y = [];
    for (let i = lag; i < days.length; i++) {
      const prev = D.get(days[i - lag]);
      if (prev.g < min) continue;
      x.push(D.get(days[i]).up / D.get(days[i]).n); y.push(prev.rose / prev.g);
    }
    const n = x.length;
    let r = null;
    if (n >= 10) {
      const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
      r = sxx > 0 && syy > 0 ? Math.round(sxy / Math.sqrt(sxx * syy) * 1000) / 1000 : null;
    }
    out[lag] = { r, days: n };
  }
  return out;
}
export const LEAN_BASELINE_DAYS = 60;

export function leanToday(journal, model, opts) {
  const minCalls = (opts && opts.minCalls) || LEAN_MIN_CALLS;
  const baseDays = (opts && opts.baselineDays) || LEAN_BASELINE_DAYS;
  const w = model && Array.isArray(model.weights) ? model.weights : null;
  if (!w) return { ok: false, reason: 'no model weights' };
  const b = typeof model.bias === 'number' ? model.bias : 0;
  const K = w.length;
  const days = new Map();
  for (const e of journal || []) {
    const k = Number(e && e.dayKey);
    if (!(k > 19000101) || !Array.isArray(e.features) || e.features.length < K || typeof e.predProb !== 'number') continue;
    let d = days.get(k);
    if (!d) { d = { n: 0, up: 0, sum: new Array(K).fill(0), z: 0, p: [] }; days.set(k, d); }
    d.p.push(e.predProb);
    let z = b;
    for (let i = 0; i < K; i++) { const x = Number(e.features[i]) || 0; d.sum[i] += x; z += w[i] * x; }
    d.n++; d.z += z; if (e.predProb >= 0.5) d.up++;
  }
  const keys = [...days.keys()].filter(k => days.get(k).n >= minCalls).sort((a, c) => a - c);
  if (keys.length < 2) return { ok: false, reason: 'fewer than two full days of calls with inputs' };
  const today = keys[keys.length - 1];
  const base = keys.slice(Math.max(0, keys.length - 1 - baseDays), keys.length - 1);
  const T = days.get(today);
  const B = { n: 0, up: 0, sum: new Array(K).fill(0), z: 0 };
  base.forEach(k => { const d = days.get(k); B.n += d.n; B.up += d.up; B.z += d.z; for (let i = 0; i < K; i++) B.sum[i] += d.sum[i]; });
  const r4 = v => Math.round(v * 10000) / 10000;
  const sig = z => 1 / (1 + Math.exp(-z));
  const drivers = [];
  let shift = 0;
  for (let i = 0; i < K; i++) {
    const xt = T.sum[i] / T.n, xb = B.sum[i] / B.n, c = w[i] * (xt - xb);
    shift += c;
    if (FEATURE_LABELS[i]) drivers.push({ k: i, name: FEATURE_LABELS[i], today: r4(xt), baseline: r4(xb), weight: r4(w[i]), contribution: r4(c) });
  }
  drivers.sort((a, c) => Math.abs(c.contribution) - Math.abs(a.contribution));
  const zt = T.z / T.n, zb = B.z / B.n;
  // How far apart the day's names are: the published probabilities (after the per-symbol and calibration layers).
  // When they bunch around the 0.5 line, a small shift common to all names flips nearly all of them at once.
  const q = (arr, f) => { const s = arr.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : null; };
  const near = (arr, eps) => arr.filter(p => Math.abs(p - 0.5) <= eps).length / arr.length;
  const spread = p => ({ p10: r4(q(p, 0.1)), median: r4(q(p, 0.5)), p90: r4(q(p, 0.9)), within_5pts_of_line: r4(near(p, 0.05)) });
  const baseMedians = base.map(k => q(days.get(k).p, 0.5));
  const baseIqr = base.map(k => q(days.get(k).p, 0.9) - q(days.get(k).p, 0.1));
  const mid = arr => q(arr, 0.5);
  return {
    ok: true,
    day: String(today),
    calls: T.n,
    called_up: r4(T.up / T.n),
    mean_score: r4(sig(zt)),                       // the raw model score of the average call today
    baseline: { days: base.length, first: String(base[0]), calls: B.n, called_up: r4(B.up / B.n), mean_score: r4(sig(zb)) },
    logit_shift: r4(zt - zb),                       // = sum of the contributions (exact for a linear score)
    published: Object.assign(spread(T.p), { baseline_median: r4(mid(baseMedians)), baseline_p10_p90_width: r4(mid(baseIqr)),
      daily_median_range: [r4(Math.min(...baseMedians)), r4(Math.max(...baseMedians))] }),
    drivers,
    series: keys.slice(-30).map(k => ({ day: String(k), calls: days.get(k).n, called_up: r4(days.get(k).up / days.get(k).n) }))
  };
}
