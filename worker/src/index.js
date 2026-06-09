/* ===========================================
   BPLEONE Brain Worker — 24/7 server-side brain
   ---
   Runs on Cloudflare Workers. The free plan gives:
     - 100,000 requests/day
     - 10ms CPU/request
     - Cron triggers (we use one every minute)
     - KV storage for state (1GB free)

   The worker:
     1. Every minute (cron): polls Finnhub for all 47 symbols' current prices,
        runs the capture/resolve/train loop, persists state in KV.
     2. Every page-load (HTTP fetch): browser pages call /brain/state and get
        the latest journal + model snapshot. No local capture needed.

   This solves the "brain only awake when tab open" architectural limit.
   The brain runs in Cloudflare's edge 24/7. Browser pages become viewers.

   Endpoints:
     GET  /brain/state            → full snapshot (journal, model, lastTick)
     GET  /brain/journal?n=200    → recent journal entries
     GET  /brain/model            → current model weights + n_trained
     POST /brain/inject           → admin: inject test prediction (auth required)
     GET  /brain/health           → readyz/livez for uptime monitoring
     GET  /brain/bootstrap        → triggers one-time historical bootstrap

   Deploy:
     cd worker
     npm install -g wrangler
     wrangler login
     wrangler kv:namespace create BRAIN_KV
     # paste returned ID into wrangler.toml
     wrangler secret put FINNHUB_API_KEY
     wrangler secret put ADMIN_TOKEN
     wrangler deploy
   =========================================== */

// Pass 200: version stamp so brain-proof.html + worker-setup.html can detect
// when the deployed worker is behind the repo source. Bump on every meaningful
// behavior change. Read via /brain/health → worker_version field.
const WORKER_VERSION = 'pass-282';

const UNIVERSE = [
  'SPY','QQQ','IWM','DIA','AAPL','NVDA','TSLA','MSFT','META','AMZN','GOOGL','AMD',
  'VIX','GLD','TLT','USO','SMCI','PLTR','COIN','MARA','RIVN','XLE','BABA','SHOP',
  'CRM','UBER','SLV','UNG','DBA','FXI','MCHI','EWJ','EWG','EWU','INDA','EWZ','EWY',
  'EWT','EEM','EFA','VEA','VWO','UUP','FXE','FXY','FXB','FXC','FXA','FXF','SHY',
  'IEF','TBT','HYG','LQD','TIP','VXX','UVXY','VNQ','NFLX','ORCL','AVGO','MU',
  'JPM','BAC','GS','XLF','XLK','XLV','XLY','XLP','XLI','XLU','XLC','XLB','XLRE'
];

const KV_KEYS = {
  JOURNAL: 'journal_v1',          // array of prediction entries
  MODEL: 'model_v1',              // { weights, n_trained, lr, version }
  LAST_TICK: 'last_tick_v1',      // { ts, syms_updated, errors }
  ACC_LOG: 'acc_log_v1',          // rolling accuracy log
  WEIGHT_LEDGER: 'weight_ledger_v1',
  HELDOUT: 'heldout_test_v1',     // out-of-sample test pairs from bootstrap
  METRICS_CACHE: 'metrics_cache_v1',
  BARS_HISTORY: 'bars_history_v1', // pass 193: per-symbol rolling bar history
  PLATT: 'platt_v1',               // pass 213: Platt calibration {a, b, fittedAt, n}
  CLEAR_FLAG: 'journal_clear_flag_v1', // pass 221: tick-coordinated journal wipe
  CHAMPIONS: 'champions_v1',       // pass 222: champion/challenger leaderboard
  AUTO_BOOTSTRAP_TS: 'auto_bootstrap_ts_v1', // pass 228: last autonomous bootstrap time
  SIGNALS: 'signals_v1',           // pass 231: unusual-volume + conviction scanner snapshot
  CONSTRAINTS: 'broadcast_constraints_v1', // pass 258: editable noise-control constraints for broadcasts
  RESEARCH: 'research_v1',          // pass 264: what the features CAN predict (volatility / dense direction)
  ANALYTICS: 'analytics_v1',        // pass 268: first-party usage analytics (anon page views + events)
};

// Pass 218: bumped from 12,000 → 35,000. Live training triggers on the
// MID (5-day) horizon now to match the bootstrap label scheme, which means
// each capture lives in the journal for 5+ days before becoming
// resolution-eligible. At ~4,600 captures/day during market hours, we
// need at least 5 × 4,600 = 23,000 entries of headroom; 35,000 gives a
// comfortable buffer for high-activity days and accounts for the rotating
// 12-syms-per-minute capture cadence.
const MAX_JOURNAL = 35000;
// Pass 226: horizons in CALENDAR hours, sized so the effective TRADING-day
// window matches the bootstrap labels (daily bars = trading days, FWD_DAYS=5).
// mid was 120h (5 calendar days) — but weekends plus the market-hours resolve
// gate made that only ~3 trading days for a mid-week entry, feeding the live
// model outcomes from a SHORTER horizon than it was bootstrapped on (a milder
// repeat of the pass-218 horizon bug). 7 calendar days = exactly 5 weekdays for
// ANY entry day-of-week, so mid=168 gives a consistent ~5-trading-day resolve.
// long likewise: 20 trading days = 4 weeks = 28 calendar days = 672h.
const HORIZON_HOURS = { short: 24, mid: 168, long: 672 }; // ~1 / ~5 / ~20 TRADING days

// ============================================================
// Logistic model (server-side mirror of js/model.js)
// ============================================================
function sigmoid(x) {
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}
function newModel() {
  return {
    weights: new Array(22).fill(0),
    bias: 0,
    n_trained: 0,
    lr: 0.05,
    l2: 0.025,          // pass 222: per-model L2; champion's value persists
    version: 1
  };
}
function predict(model, features) {
  let z = model.bias;
  for (let i = 0; i < 22; i++) z += (model.weights[i] || 0) * (features[i] || 0);
  return sigmoid(z);
}
function trainStep(model, features, label) {
  const p = predict(model, features);
  const err = p - label;
  // Pass 207: L2 weight decay. Without this the 5-epoch multi-pass training
  // (~42k SGD steps) grew weights unbounded — sigmoid outputs piled up near
  // 0 and 1 producing CONFIDENT WRONG predictions, blowing Brier (0.287 vs
  // 0.25 baseline) and avg log-loss (3.56 — ~7x calibrated baseline of 0.5).
  // Even with 55% raw accuracy on random-split the BSS was -0.147.
  // L2=0.001 keeps weights bounded; the bias term and features[21] (the
  // constant-1 bias column) are exempt from decay so the intercept is free
  // to absorb the class prior. Matches the browser model.js pattern.
  // Pass 212: bumped L2 0.015 → 0.025. Pass 211 produced a real
  // walk-forward edge (52.9% accuracy, +2.9pp above random) but still
  // overconfident — Brier 0.269 vs 0.25 baseline. The model's predictions
  // were ~65-70% confident when reality only justifies ~55%. Stronger
  // weight decay pulls peaked sigmoids back toward 0.5, lowering Brier
  // (better calibration) without losing the directional edge already
  // captured in the sign of the prediction.
  // Pass 222: L2 is now read from the model itself (model.l2) so different
  // champion/challenger configs can train with different regularization.
  // Falls back to 0.025 (the pass-212 default) for older saved models that
  // predate the model.l2 field. The CHAMPION's l2 persists in KV, so the
  // live tick automatically trains with whatever L2 won the last competition.
  const L2 = (typeof model.l2 === 'number' && model.l2 >= 0) ? model.l2 : 0.025;
  for (let i = 0; i < 22; i++) {
    const decay = (i === 21) ? 0 : L2 * model.weights[i];
    model.weights[i] -= model.lr * (err * (features[i] || 0) + decay);
  }
  model.bias -= model.lr * err;
  model.n_trained = (model.n_trained || 0) + 1;
  return { loss: -label * Math.log(Math.max(1e-9, p)) - (1 - label) * Math.log(Math.max(1e-9, 1 - p)) };
}

// ============================================================
// Feature extraction (minimal — server has fewer signals than browser)
// ============================================================
function extractFeatures(quote, marketSnap) {
  const f = new Array(22).fill(0.5);
  if (!quote || !quote.last) return f;
  const changePct = quote.changePct || 0;
  const range = (quote.dayHigh && quote.dayLow) ? (quote.dayHigh - quote.dayLow) / quote.last : 0;
  f[0] = clamp(50 / 100, 0, 1);
  f[1] = clamp(range * 100, 0, 1);
  f[5] = clamp((changePct + 5) / 10, 0, 1);
  f[18] = clamp((marketSnap.vix - 10) / 40, 0, 1);
  f[20] = clamp((etHour() - 9.5) / (16 - 9.5), 0, 1);
  f[21] = 1;
  return f;
}

// Pass 193: rich feature extractor that uses recent bar history.
// Returns the SAME 12+ features the bootstrap trains on, so live predictions
// match the model's training distribution. If history is too short, falls
// back to extractFeatures and produces neutral 0.5s.
function extractRichFeatures(quote, history, marketSnap) {
  if (!history || history.length < 14) return extractFeatures(quote, marketSnap);
  const f = new Array(22).fill(0.5);
  const bars = history;  // array of {ts, close, open, high, low, volume}
  const i = bars.length - 1;
  const today = bars[i];
  // RSI(14)
  let gains = 0, losses = 0;
  for (let k = i - 13; k <= i; k++) {
    if (k <= 0) continue;
    const d = bars[k].close - bars[k-1].close;
    if (d > 0) gains += d; else losses -= d;
  }
  const rs = (gains + losses) > 0 ? gains / (gains + losses) : 0.5;
  f[0] = clamp(rs, 0, 1);
  // Intraday range
  f[1] = clamp(((today.high - today.low) / today.close) * 50, 0, 1);
  // ATR%
  let atrSum = 0;
  for (let k = i - 13; k <= i; k++) atrSum += (bars[k].high - bars[k].low) / bars[k].close;
  f[2] = clamp((atrSum / 14) * 100, 0, 1);
  // Change%
  if (i > 0) {
    const chg = (today.close - bars[i-1].close) / bars[i-1].close;
    f[5] = clamp((chg + 0.05) / 0.10, 0, 1);
  }
  // 5-day momentum
  if (i >= 5) {
    const mom5 = (today.close - bars[i-5].close) / bars[i-5].close;
    f[3] = clamp((mom5 + 0.10) / 0.20, 0, 1);
  }
  // 20-day momentum (or less if not enough history)
  if (i >= 20) {
    const mom20 = (today.close - bars[i-20].close) / bars[i-20].close;
    f[4] = clamp((mom20 + 0.20) / 0.40, 0, 1);
  }
  // Volume vs avg(14)
  let volSum = 0;
  for (let k = i - 13; k <= i; k++) volSum += bars[k].volume || 0;
  const avgVol = volSum / 14;
  const rvol = avgVol > 0 ? (today.volume || 0) / avgVol : 1;
  f[6] = clamp(rvol / 3, 0, 1);
  // Position in 14-day H/L range
  let hi14 = -Infinity, lo14 = Infinity;
  for (let k = i - 13; k <= i; k++) {
    if (bars[k].high > hi14) hi14 = bars[k].high;
    if (bars[k].low < lo14) lo14 = bars[k].low;
  }
  if (hi14 > lo14) f[7] = (today.close - lo14) / (hi14 - lo14);
  // Distance from 14-day SMA
  let sma14 = 0;
  for (let k = i - 13; k <= i; k++) sma14 += bars[k].close;
  sma14 /= 14;
  f[8] = clamp(((today.close - sma14) / sma14 + 0.10) / 0.20, 0, 1);
  // VIX
  f[18] = clamp((marketSnap.vix - 10) / 40, 0, 1);
  // Day-of-week + ET hour
  f[19] = (new Date(today.ts).getUTCDay() % 5) / 5;
  f[20] = clamp((etHour() - 9.5) / (16 - 9.5), 0, 1);
  addStabilityFeatures(f, bars, i);  // pass 261: f[9]-f[14] (shared with bootstrap — no skew)
  f[21] = 1;
  return f;
}
// Pass 197: NaN-safe clamp. If v is NaN or Infinity (e.g. div-by-zero in a
// feature calc), return the midpoint instead of propagating poison. All current
// callers use [0,1] so the neutral 0.5 is correct. Previously NaN survived
// clamp() and was only quietly zeroed out by `features[i] || 0` in predict()
// and trainStep() — works but obscures bugs and breaks any downstream callers
// that don't repeat the `|| 0` guard.
function clamp(v, lo, hi) {
  if (!isFinite(v)) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, v));
}

// Pass 261 (edge stability — more signal): extra features in previously-unused
// slots f[9]-f[14]. CRITICAL: this is the SINGLE source of truth, called by BOTH
// the bootstrap feature builder (richFeatures) and the live-tick builder
// (extractRichFeatures), so there is ZERO train/serve skew (the two used to drift
// — e.g. the tick set f[18]/f[20] that the bootstrap left neutral). Each feature
// self-guards on lookback; unmet ones stay at the neutral 0.5 default. All operate
// on a `bars` array of {close,high,low,volume} and an index `i` (the current bar).
function addStabilityFeatures(f, bars, i) {
  const today = bars[i];
  if (!today) return;
  // f[9]: distance from the 50-day SMA — longer-term trend context
  if (i >= 50) {
    let s = 0; for (let k = i - 49; k <= i; k++) s += bars[k].close; s /= 50;
    f[9] = clamp(((today.close - s) / s + 0.15) / 0.30, 0, 1);
    // f[10]: position within the 50-day high/low range (0 = at lows, 1 = at highs)
    let hi = -Infinity, lo = Infinity;
    for (let k = i - 49; k <= i; k++) { if (bars[k].high > hi) hi = bars[k].high; if (bars[k].low < lo) lo = bars[k].low; }
    if (hi > lo) f[10] = clamp((today.close - lo) / (hi - lo), 0, 1);
  }
  // f[11]: momentum divergence — 5-day minus 20-day return (accel vs decel)
  if (i >= 20) {
    const mom5 = (today.close - bars[i - 5].close) / bars[i - 5].close;
    const mom20 = (today.close - bars[i - 20].close) / bars[i - 20].close;
    f[11] = clamp(((mom5 - mom20) + 0.10) / 0.20, 0, 1);
    // f[14]: volatility regime — 5-day ATR% vs 20-day ATR% (expansion/contraction)
    let a5 = 0, a20 = 0;
    for (let k = i - 4; k <= i; k++) a5 += (bars[k].high - bars[k].low) / bars[k].close;
    for (let k = i - 19; k <= i; k++) a20 += (bars[k].high - bars[k].low) / bars[k].close;
    a5 /= 5; a20 /= 20;
    f[14] = a20 > 0 ? clamp((a5 / a20) / 2, 0, 1) : 0.5;
  }
  // f[12]: 10-day momentum (mid-horizon)
  if (i >= 10) {
    const mom10 = (today.close - bars[i - 10].close) / bars[i - 10].close;
    f[12] = clamp((mom10 + 0.15) / 0.30, 0, 1);
  }
  // f[13]: fraction of up-days over the last 14 sessions (trend persistence)
  if (i >= 14) {
    let up = 0; for (let k = i - 13; k <= i; k++) { if (bars[k - 1] && bars[k].close > bars[k - 1].close) up++; }
    f[13] = up / 14;
  }
}

// Pass 213: Platt scaling — sigmoid post-calibration applied to raw model
// outputs. Maps an overconfident raw probability through y = sigmoid(a*logit(p) + b)
// where (a, b) are fit on a calibration set. With a < 1 it pulls peaked outputs
// toward 0.5; with b ≠ 0 it shifts the decision boundary off 50/50.
function plattLogit(p) {
  const eps = 1e-6;
  const c = Math.max(eps, Math.min(1 - eps, p));
  return Math.log(c / (1 - c));
}
function applyPlatt(rawProb, platt) {
  // Pass 214: bail if Platt was rejected at fit time (a < 0.2 inversion guard)
  // or if any required field is missing/non-finite. Returns raw probability —
  // the brain's directional edge is preserved when calibration data was bad.
  if (!platt || platt.rejected) return rawProb;
  if (typeof platt.a !== 'number' || typeof platt.b !== 'number') return rawProb;
  if (!isFinite(platt.a) || !isFinite(platt.b)) return rawProb;
  if (platt.a < 0.2) return rawProb;  // belt-and-suspenders if stored Platt is stale
  if (!isFinite(rawProb)) return 0.5;
  const z = platt.a * plattLogit(rawProb) + platt.b;
  return sigmoid(z);
}

// Pass 234: per-symbol recalibration bias. The heavily-regularized global model
// differentiates weakly between symbols (every prediction pulled toward ~0.5),
// so the scanner rarely crosses BUY/SELL. This learns a small per-symbol LOGIT
// shift = logit(symbol's actual up-rate) - logit(symbol's mean predicted prob),
// shrunk hard by sample count and capped, so each symbol's AVERAGE prediction
// matches its own historical 5-day base rate. It's an honest recalibration (not
// a fabricated signal) and is GUARDED in runBootstrap — kept only if it doesn't
// worsen held-back walk-forward Brier. Increases signal flow without abandoning
// the regularization that made the edge honest.
function computeSymBias(model, examples) {
  const K = 40, CAP = 0.4, agg = {};
  for (const ex of examples) {
    const s = ex && ex.sym; if (!s) continue;
    if (!agg[s]) agg[s] = { n: 0, sumY: 0, sumP: 0 };
    agg[s].n++; agg[s].sumY += ex.label; agg[s].sumP += predict(model, ex.features);
  }
  const bias = {};
  for (const s in agg) {
    const a = agg[s];
    if (a.n < 10) continue;  // too few samples to recalibrate
    let b = (plattLogit(a.sumY / a.n) - plattLogit(a.sumP / a.n)) * (a.n / (a.n + K));
    b = Math.max(-CAP, Math.min(CAP, b));
    if (Math.abs(b) > 0.02) bias[s] = +b.toFixed(4);  // skip negligible
  }
  return bias;
}
function applySymBias(p, sym, model) {
  const b = model && model.symBias && model.symBias[sym];
  if (!b || !isFinite(p)) return p;
  return sigmoid(plattLogit(p) + b);
}

function fitPlatt(pairs) {
  // Need at least ~30 pairs to estimate two parameters with any stability.
  if (!Array.isArray(pairs) || pairs.length < 30) return null;
  const data = pairs
    .filter(it => it && typeof it.p === 'number' && Number.isFinite(it.p)
             && typeof it.y === 'number' && Number.isFinite(it.y))
    .map(it => ({ x: plattLogit(it.p), y: it.y }));
  if (data.length < 30) return null;
  let a = 1.0, b = 0.0;
  const lr = 0.05;
  const epochs = 200;
  for (let epoch = 0; epoch < epochs; epoch++) {
    let gradA = 0, gradB = 0;
    for (const { x, y } of data) {
      const pHat = sigmoid(a * x + b);
      const err = pHat - y;
      gradA += err * x;
      gradB += err;
    }
    a -= lr * (gradA / data.length);
    b -= lr * (gradB / data.length);
  }
  // Pass 214 (CRITICAL guard): refuse Platt if a < 0.2. A reasonable
  // calibration should compress the raw probability toward 0.5 (a in
  // [0.4, 1.0]) or leave it alone. a <= 0 means the fit decided to
  // INVERT the model's directional sign — that happens when the
  // calibration set's regime is anti-correlated with the rest of the
  // data (short-timescale regime shift). Applying it production would
  // destroy whatever directional edge the raw model has.
  // Pass 213 bootstrap exposed this: raw walk_forward acc was 52.93%
  // but calibrated dropped to 48.9% because Platt fit a=-0.777.
  // Better to ship NO calibration than wrong-direction calibration.
  if (a < 0.2) {
    return { rejected: true, reason: 'inverted-or-weak', fittedA: a, fittedB: b, n: data.length };
  }
  return { a, b, fittedAt: Date.now(), n: data.length };
}

// Standard normal CDF via Abramowitz-Stegun approximation. Used for the
// p-value calculation in /brain/metrics.
function normalCdf(z) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}
function etHour() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false, hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date());
  let h = 0, m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
    if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  return h + m / 60;
}

// ============================================================
// KV helpers
// ============================================================
async function kvGet(env, key, fallback) {
  try {
    const raw = await env.BRAIN_KV.get(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
async function kvPut(env, key, value) {
  try { await env.BRAIN_KV.put(key, JSON.stringify(value)); } catch (e) {}
}
async function kvPutTTL(env, key, value, ttlSec) {
  try { await env.BRAIN_KV.put(key, JSON.stringify(value), { expirationTtl: ttlSec }); } catch (e) {}
}
async function kvDelete(env, key) {
  try { await env.BRAIN_KV.delete(key); } catch (e) {}
}

// ============================================================
// First-party usage analytics (privacy-light: anon id + page + event).
// One rolling KV blob; read-modify-write is approximate under heavy concurrency
// but exact enough for early-stage "what do users actually do" learning.
// ============================================================
function capObj(o, n) {
  const k = Object.keys(o || {});
  if (k.length <= n) return o;
  const out = {}; k.sort((x, y) => (o[y] - o[x])).slice(0, n).forEach(key => out[key] = o[key]);
  return out;
}
function capDays(o, n) {
  const k = Object.keys(o || {}).sort();
  if (k.length <= n) return o;
  const out = {}; k.slice(-n).forEach(key => out[key] = o[key]);
  return out;
}
async function recordTrack(env, b) {
  try {
    const a = (await kvGet(env, KV_KEYS.ANALYTICS, null)) ||
      { total: 0, pageviews: 0, new_users: 0, pages: {}, events: {}, days: {}, refs: {}, uniq: {}, recent: [], since: Date.now() };
    a.total = (a.total || 0) + 1;
    const ev = String(b.event || 'pageview').slice(0, 40);
    if (ev === 'pageview') a.pageviews = (a.pageviews || 0) + 1;
    a.events[ev] = (a.events[ev] || 0) + 1;
    const page = String(b.page || '/').slice(0, 80);
    a.pages[page] = (a.pages[page] || 0) + 1;
    if (b.ref) { const r = String(b.ref).slice(0, 60); a.refs[r] = (a.refs[r] || 0) + 1; }
    const day = new Date(b.ts || Date.now()).toISOString().slice(0, 10);
    a.days[day] = (a.days[day] || 0) + 1;
    if (b.anon) { if (!a.uniq) a.uniq = {}; a.uniq[String(b.anon).slice(0, 40)] = b.ts || Date.now(); }
    if (b.nu) a.new_users = (a.new_users || 0) + 1;
    if (ev === 'feedback' && b.props) {
      a.feedback = a.feedback || [];
      a.feedback.push({ r: String(b.props.rating || '').slice(0, 8), t: String(b.props.text || '').slice(0, 500), em: String(b.props.email || '').slice(0, 120), p: page, ts: b.ts || Date.now() });
      if (a.feedback.length > 100) a.feedback = a.feedback.slice(-100);
    }
    a.recent = a.recent || [];
    a.recent.push({ e: ev, p: page, r: b.ref || '', t: b.ts || Date.now() });
    if (a.recent.length > 60) a.recent = a.recent.slice(-60);
    a.pages = capObj(a.pages, 120); a.refs = capObj(a.refs, 80);
    a.events = capObj(a.events, 60); a.days = capDays(a.days, 90); a.uniq = capObj(a.uniq, 3000);
    a.updatedAt = Date.now();
    await kvPut(env, KV_KEYS.ANALYTICS, a);
  } catch (e) {}
}

// ============================================================
// Pass 240: customer auth (email + password). Cost = $0 (Cloudflare free tier).
// Passwords are NEVER stored plaintext — PBKDF2-HMAC-SHA256, 100k iterations,
// per-user random salt, hash stored as hex. Sessions are cryptographically
// random bearer tokens kept in KV with a TTL. HTTPS only (Cloudflare). This is
// a customer-facing signup system; it does not gate content (everything stays
// free), it enables saved watchlists / alerts / "my account".
// ============================================================
function bufToHex(buf) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
function randomHex(nBytes) {
  const a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return bufToHex(a.buffer);
}
async function pbkdf2Hash(password, saltHex) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return bufToHex(bits);
}
// Constant-time string compare so a timing side-channel can't leak the hash.
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function normEmail(e) { return String(e || '').trim().toLowerCase(); }
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254; }
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

async function getSessionEmail(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const sess = await kvGet(env, 'session:' + m[1], null);
  if (!sess || !sess.email) return null;
  return sess.email;
}

// ============================================================
// Finnhub fetcher
// ============================================================
async function fetchFinnhubQuote(env, sym) {
  // Convert crypto to Binance proxy
  const fhSym = sym === 'BTC' ? 'BINANCE:BTCUSDT' : sym === 'ETH' ? 'BINANCE:ETHUSDT' : sym;
  const url = 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(fhSym) + '&token=' + encodeURIComponent(env.FINNHUB_API_KEY);
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    if (typeof j.c !== 'number' || j.c <= 0) return null;
    return {
      symbol: sym,
      last: j.c,
      prevClose: j.pc,
      dayHigh: j.h,
      dayLow: j.l,
      dayOpen: j.o,
      changePct: j.pc ? ((j.c - j.pc) / j.pc) * 100 : 0,
      ts: Date.now(),
      priceSource: 'finnhub',
      liveAt: Date.now()
    };
  } catch (e) {
    return null;
  }
}

// ============================================================
// Pass 248: REAL news + insider feeds (free tier, no per-customer key).
// The worker holds the Finnhub key as a secret, so these work for every
// visitor without anyone pasting a key into the browser. Both endpoints are
// on Finnhub's FREE tier (general/company news + SEC Form 3/4/5 insider
// transactions). Responses are edge-cached via caches.default (see routes),
// which costs ZERO KV writes and shields the 60-call/min rate limit.
// ============================================================
function normalizeNewsItem(n) {
  return {
    headline: String(n.headline || ''),
    summary: String(n.summary || ''),
    source: String(n.source || ''),
    url: String(n.url || ''),
    // Finnhub returns datetime in SECONDS; the browser pages expect ms.
    datetime: (Number(n.datetime) || 0) * 1000,
    related: String(n.related || ''),
    category: String(n.category || ''),
    image: String(n.image || '')
  };
}

async function fetchFinnhubNews(env, category) {
  if (!env.FINNHUB_API_KEY) return null;
  const cat = ['general', 'forex', 'crypto', 'merger'].includes(category) ? category : 'general';
  const url = 'https://finnhub.io/api/v1/news?category=' + cat + '&token=' + encodeURIComponent(env.FINNHUB_API_KEY);
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j)) return null;
    return j.filter(n => n && n.headline && n.url).slice(0, 80).map(normalizeNewsItem);
  } catch (e) { return null; }
}

async function fetchFinnhubCompanyNews(env, sym, days) {
  if (!env.FINNHUB_API_KEY) return null;
  const now = Date.now();
  const toStr = new Date(now).toISOString().slice(0, 10);
  const fromStr = new Date(now - (days || 14) * 86400000).toISOString().slice(0, 10);
  const url = 'https://finnhub.io/api/v1/company-news?symbol=' + encodeURIComponent(sym) +
    '&from=' + fromStr + '&to=' + toStr + '&token=' + encodeURIComponent(env.FINNHUB_API_KEY);
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j)) return null;
    return j.filter(n => n && n.headline && n.url).slice(0, 80).map(normalizeNewsItem);
  } catch (e) { return null; }
}

// SEC Form 3/4/5 insider transactions via Finnhub (free tier). transactionCode:
// P = open-market purchase, S = open-market sale, A = grant/award, M = option
// exercise, G = gift, F = tax withholding. We surface buy/sell by the sign of
// `change` (shares delta) and compute an approximate USD value.
async function fetchFinnhubInsider(env, sym) {
  if (!env.FINNHUB_API_KEY) return null;
  const url = 'https://finnhub.io/api/v1/stock/insider-transactions?symbol=' +
    encodeURIComponent(sym) + '&token=' + encodeURIComponent(env.FINNHUB_API_KEY);
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const data = j && Array.isArray(j.data) ? j.data : [];
    return data.map(d => {
      const change = Number(d.change) || 0;
      const price = Number(d.transactionPrice) || 0;
      const code = String(d.transactionCode || '');
      return {
        name: String(d.name || ''),
        share: Number(d.share) || 0,        // shares held after the transaction
        change,                              // + = acquired, - = disposed
        filingDate: String(d.filingDate || ''),
        transactionDate: String(d.transactionDate || ''),
        transactionCode: code,
        transactionPrice: price,
        value: Math.round(Math.abs(change) * price),
        side: change > 0 ? 'BUY' : change < 0 ? 'SELL' : 'FLAT',
        openMarket: code === 'P' || code === 'S'   // P/S are the high-signal open-market trades
      };
    }).sort((a, b) => (b.filingDate || '').localeCompare(a.filingDate || '')).slice(0, 100);
  } catch (e) { return null; }
}

// Pass 230: live quote from Yahoo's v8 chart — returns the same shape as
// fetchFinnhubQuote PLUS real volume. Finnhub's /quote endpoint has no volume
// field, so before this the live RVOL feature (f[6]) was always fed 0 even
// though the model trains on real volume from Yahoo history — a dead signal in
// production. Yahoo's in-progress daily bar carries today's cumulative volume
// (and is already the reliable historical source from this Worker).
async function fetchYahooQuote(sym) {
  let yhSym = sym;
  if (sym === 'BTC') yhSym = 'BTC-USD';
  else if (sym === 'ETH') yhSym = 'ETH-USD';
  else if (sym === 'VIX') yhSym = '^VIX';
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yhSym) + '?range=5d&interval=1d';
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    if (!r.ok) return null;
    const j = await r.json();
    const result = j && j.chart && j.chart.result && j.chart.result[0];
    if (!result || !result.timestamp) return null;
    const meta = result.meta || {};
    const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
    if (!q || !Array.isArray(q.close)) return null;
    // Last non-null bar = today's in-progress session during market hours.
    let i = q.close.length - 1;
    while (i >= 0 && (q.close[i] == null || !isFinite(q.close[i]))) i--;
    if (i < 0) return null;
    const last = (typeof meta.regularMarketPrice === 'number' && meta.regularMarketPrice > 0)
      ? meta.regularMarketPrice : q.close[i];
    if (typeof last !== 'number' || last <= 0) return null;
    // prevClose must be YESTERDAY's close (the prior daily bar) for a true DAILY
    // change%. meta.chartPreviousClose is the close BEFORE the whole 5-day window
    // (~6 trading days stale), which was inflating change into a multi-day move —
    // SMCI showed -20.8% and NVDA -8.9% when the real daily moves were ~-11% / -2.4%.
    // Prefer the prior daily bar; fall back to chartPreviousClose only if it's absent.
    const prevClose = (i > 0 && typeof q.close[i - 1] === 'number' && q.close[i - 1] > 0)
      ? q.close[i - 1]
      : ((typeof meta.chartPreviousClose === 'number' && meta.chartPreviousClose > 0) ? meta.chartPreviousClose : last);
    const volume = (typeof meta.regularMarketVolume === 'number' && meta.regularMarketVolume > 0)
      ? meta.regularMarketVolume : (q.volume[i] || 0);
    return {
      symbol: sym,
      last,
      prevClose,
      dayHigh: q.high[i] || last,
      dayLow: q.low[i] || last,
      dayOpen: q.open[i] || last,
      volume,                          // ← the whole point: real live volume
      changePct: prevClose ? ((last - prevClose) / prevClose) * 100 : 0,
      ts: Date.now(),
      priceSource: 'yahoo',
      liveAt: Date.now()
    };
  } catch (e) {
    return null;
  }
}

// Pass 230: live-quote resolver. Yahoo first (reliable from this Worker AND
// carries volume), Finnhub as a price-only fallback so a Yahoo hiccup never
// blanks the tick. The fallback path still has volume=0, but that's strictly
// better than the prior Finnhub-only path that NEVER had volume.
async function fetchLiveQuote(env, sym) {
  const y = await fetchYahooQuote(sym);
  if (y && typeof y.last === 'number' && y.last > 0) return y;
  return await fetchFinnhubQuote(env, sym);
}

// Server-side historical fetcher. Tries Stooq first (free, no auth, no CORS
// here because we're server-side). Falls back to Finnhub /stock/candle if a
// paid Finnhub plan is configured. Pass 188: Finnhub free tier returns 403
// on /stock/candle, verified live. Stooq works fine from a server.
const STOOQ_MAP = {
  SPY:'spy.us', QQQ:'qqq.us', IWM:'iwm.us', DIA:'dia.us',
  AAPL:'aapl.us', NVDA:'nvda.us', TSLA:'tsla.us', MSFT:'msft.us',
  META:'meta.us', AMZN:'amzn.us', GOOGL:'googl.us', AMD:'amd.us',
  BTC:'btcusd', ETH:'ethusd', VIX:'^vix',
  GLD:'gld.us', TLT:'tlt.us', USO:'uso.us', SMCI:'smci.us',
  PLTR:'pltr.us', COIN:'coin.us', MARA:'mara.us', RIVN:'rivn.us',
  XLE:'xle.us', BABA:'baba.us', SHOP:'shop.us', CRM:'crm.us', UBER:'uber.us',
  SLV:'slv.us', UNG:'ung.us', DBA:'dba.us',
  FXI:'fxi.us', MCHI:'mchi.us', EWJ:'ewj.us', EWG:'ewg.us', EWU:'ewu.us',
  INDA:'inda.us', EWZ:'ewz.us', EWY:'ewy.us', EWT:'ewt.us',
  EEM:'eem.us', EFA:'efa.us', VEA:'vea.us', VWO:'vwo.us',
  UUP:'uup.us', FXE:'fxe.us', FXY:'fxy.us', FXB:'fxb.us', FXC:'fxc.us',
  FXA:'fxa.us', FXF:'fxf.us', SHY:'shy.us', IEF:'ief.us', TBT:'tbt.us',
  HYG:'hyg.us', LQD:'lqd.us', TIP:'tip.us', VXX:'vxx.us', UVXY:'uvxy.us',
  VNQ:'vnq.us', NFLX:'nflx.us', ORCL:'orcl.us', AVGO:'avgo.us', MU:'mu.us',
  JPM:'jpm.us', BAC:'bac.us', GS:'gs.us', XLF:'xlf.us', XLK:'xlk.us',
  XLV:'xlv.us', XLY:'xly.us', XLP:'xlp.us', XLI:'xli.us', XLU:'xlu.us',
  XLC:'xlc.us', XLB:'xlb.us', XLRE:'xlre.us'
};

async function fetchStooqHistorical(sym, days) {
  const stooqSym = STOOQ_MAP[sym];
  if (!stooqSym) return null;
  const url = 'https://stooq.com/q/d/l/?s=' + encodeURIComponent(stooqSym) + '&i=d';
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bpleone-brain/1.0)' }
    });
    if (!r.ok) return null;
    const text = await r.text();
    if (text.length < 50 || !text.includes('Date,Open')) return null;
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const out = [];
    const start = Math.max(1, lines.length - days);
    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 5) continue;
      const close = parseFloat(cols[4]);
      if (!isFinite(close) || close <= 0) continue;
      out.push({
        ts: new Date(cols[0]).getTime(),
        close,
        open: parseFloat(cols[1]) || close,
        high: parseFloat(cols[2]) || close,
        low: parseFloat(cols[3]) || close,
        volume: parseInt(cols[5]) || 0
      });
    }
    return out.length > 0 ? out : null;
  } catch (e) {
    return null;
  }
}

// Pass 189: Yahoo Finance v8 chart API. Works from Cloudflare Workers
// (server-side, no CORS), no auth required, generous rate limits.
// PRIMARY historical fetcher — Stooq + Finnhub are fallbacks.
async function fetchYahooHistorical(sym, days) {
  // Yahoo uses ticker symbols mostly as-is, except crypto needs -USD suffix
  let yhSym = sym;
  if (sym === 'BTC') yhSym = 'BTC-USD';
  else if (sym === 'ETH') yhSym = 'ETH-USD';
  else if (sym === 'VIX') yhSym = '^VIX';
  const rangeStr = days > 365 ? '5y' : (days > 90 ? '1y' : (days > 30 ? '3mo' : '1mo'));
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yhSym) + '?range=' + rangeStr + '&interval=1d';
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    if (!r.ok) return null;
    const j = await r.json();
    const result = j && j.chart && j.chart.result && j.chart.result[0];
    if (!result || !result.timestamp) return null;
    const ts = result.timestamp;
    const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
    if (!quote || !quote.close) return null;
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      const c = quote.close[i];
      if (c == null || !isFinite(c) || c <= 0) continue;
      out.push({
        ts: ts[i] * 1000,
        close: c,
        open: quote.open[i] || c,
        high: quote.high[i] || c,
        low: quote.low[i] || c,
        volume: quote.volume[i] || 0
      });
    }
    return out.length > 0 ? out.slice(-days) : null;
  } catch (e) {
    return null;
  }
}

async function fetchFinnhubCandles(env, sym, days) {
  // Only useful on paid Finnhub plans. Free tier returns 403.
  if (!env.FINNHUB_API_KEY) return null;
  const fhSym = sym === 'BTC' ? 'BINANCE:BTCUSDT' : sym === 'ETH' ? 'BINANCE:ETHUSDT' : sym;
  const now = Math.floor(Date.now() / 1000);
  const from = now - days * 86400;
  const url = 'https://finnhub.io/api/v1/stock/candle?symbol=' + encodeURIComponent(fhSym) + '&resolution=D&from=' + from + '&to=' + now + '&token=' + encodeURIComponent(env.FINNHUB_API_KEY);
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    if (j.s !== 'ok' || !Array.isArray(j.c)) return null;
    return j.c.map((c, i) => ({
      ts: j.t[i] * 1000,
      close: c,
      open: j.o[i] || c,
      high: j.h[i] || c,
      low: j.l[i] || c,
      volume: j.v[i] || 0
    }));
  } catch (e) {
    return null;
  }
}

// Try Yahoo first (most reliable from Cloudflare Workers, no auth, no CORS
// issue here because we're server-side). Falls back to Stooq, then Finnhub.
async function fetchHistoricalBars(env, sym, days) {
  const yahooResult = await fetchYahooHistorical(sym, days);
  if (yahooResult && yahooResult.length > 0) return yahooResult;
  const stooqResult = await fetchStooqHistorical(sym, days);
  if (stooqResult && stooqResult.length > 0) return stooqResult;
  return await fetchFinnhubCandles(env, sym, days);
}

// Pass 209: market-hours check. US equity regular session is 9:30am - 4:00pm ET,
// Mon-Fri. Outside that window, Finnhub quotes barely move (post-market trades on
// some names but most symbols are flat). The cron tick was firing 1,440 times/day
// regardless, doing 4 KV reads + 3-4 KV writes + 12 Finnhub calls + a full
// 12,000-entry journal parse/serialize each time. ~70% of those ticks ran during
// closed market and accomplished nothing. Pre-market and after-hours allowance
// is kept narrow (8am-5pm ET) since we mostly care about regular-session data.
function isMarketLikelyOpen() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour12: false, hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date());
  let dow = '', hh = 0, mm = 0;
  for (const p of parts) {
    if (p.type === 'weekday') dow = p.value;
    if (p.type === 'hour') hh = parseInt(p.value, 10) % 24;
    if (p.type === 'minute') mm = parseInt(p.value, 10);
  }
  if (dow === 'Sat' || dow === 'Sun') return false;
  const t = hh + mm / 60;
  // 8:00am ET (pre-market activity starts) to 5:00pm ET (post-market close)
  return t >= 8 && t < 17;
}

// ============================================================
// Tick handler — runs every minute on cron
// ============================================================
// Pass 231: unusual-volume + brain-conviction signal for the scanner. This is
// the equity-side "whale proxy": institutional accumulation/distribution shows
// up as relative-volume (RVOL) surges, and we pair that with the brain's
// 5-day directional conviction to emit a plain BUY / SELL / WATCH / HOLD call.
// RVOL is time-of-day normalized: today's cumulative volume is projected to a
// full session (vol / fraction-of-day-elapsed) before comparing to the trailing
// average, so "2x normal by 11am" isn't undercounted. NOTE: this is volume +
// price action on free data, NOT options-flow whale prints (those need a paid
// OPRA feed). It's the real, honest TA version of unusual activity.
function computeSignal(sym, q, history, predProb, dayKey) {
  const prior = (Array.isArray(history) ? history : [])
    .filter(b => b.dayKey !== dayKey && (b.volume || 0) > 0).slice(-20);
  let rvol = null;
  if (prior.length >= 5) {
    const avgVol = prior.reduce((s, b) => s + (b.volume || 0), 0) / prior.length;
    const curVol = q.volume || 0;
    if (avgVol > 0 && curVol > 0) {
      const frac = Math.max(0.1, Math.min(1, (etHour() - 9.5) / 6.5));  // fraction of RTH elapsed
      rvol = (curVol / frac) / avgVol;
    }
  }
  const conviction = Math.abs(predProb - 0.5) * 2;   // 0..1
  const strongUp = predProb >= 0.55;
  const strongDown = predProb <= 0.45;
  const rv = rvol || 0;
  let signal = 'HOLD', reason = 'no edge';
  if (strongUp && rv >= 1.5) { signal = 'BUY'; reason = rv.toFixed(1) + '× normal volume + brain ' + Math.round(predProb * 100) + '% up (accumulation)'; }
  else if (strongDown && rv >= 1.5) { signal = 'SELL'; reason = rv.toFixed(1) + '× normal volume + brain ' + Math.round((1 - predProb) * 100) + '% down (distribution)'; }
  else if (rv >= 2.5) { signal = 'WATCH'; reason = rv.toFixed(1) + '× normal volume, direction unclear (' + Math.round(predProb * 100) + '% up)'; }
  else if (strongUp) { signal = 'LEAN BUY'; reason = 'brain ' + Math.round(predProb * 100) + '% up, volume normal'; }
  else if (strongDown) { signal = 'LEAN SELL'; reason = 'brain ' + Math.round((1 - predProb) * 100) + '% down, volume normal'; }
  const rank = conviction * Math.min(rv || 1, 5);    // alpha rank = conviction x unusualness

  // Pass 241: "large trades before close" detector. In the final trading hour
  // (>= 3pm ET) heavy projected volume means big size is still hitting the tape
  // late in the session — the free-data proxy for institutional positioning
  // into the close (the honest equivalent of an MOC/closing-imbalance read).
  // intoClose fires when power-hour RVOL is unusually high; direction comes from
  // the day's move (price up into heavy volume = accumulation; down = distribution).
  const h = etHour();
  const powerHour = h >= 15 && h < 16.25;   // 3:00-4:15pm ET (incl. a little post-close slack)
  let intoClose = false, closeNote = null;
  if (powerHour && rv >= 2) {
    intoClose = true;
    const chg = q.changePct || 0;
    const dir = chg >= 0.3 ? 'accumulation (price up into heavy close volume)'
              : chg <= -0.3 ? 'distribution (price down into heavy close volume)'
              : 'churning (heavy close volume, flat price)';
    closeNote = rv.toFixed(1) + '× normal volume in the final hour — ' + dir;
  }

  return {
    sym, last: q.last, changePct: +(q.changePct || 0).toFixed(2),
    rvol: rvol != null ? +rvol.toFixed(2) : null,
    predProb: +predProb.toFixed(4), dirUp: predProb >= 0.5,
    conviction: +conviction.toFixed(3), signal, reason,
    rank: +rank.toFixed(4),
    powerHour, intoClose, closeNote,   // pass 241: large-trades-before-close
    ts: Date.now()
  };
}

async function tick(env) {
  const startTs = Date.now();

  // Pass 221: honor a pending journal-clear FIRST, before the market-hours
  // gate. The bootstrap can't reliably clear the journal itself — a
  // concurrent cron tick reads the old journal into memory before the
  // bootstrap's write commits, then overwrites it on save (KV last-write-
  // wins). So the bootstrap sets a flag and we apply it here. Doing this
  // ABOVE the market gate means an off-hours clear request still gets
  // honored within ~60s instead of waiting for the next market open.
  const clearFlag = await kvGet(env, KV_KEYS.CLEAR_FLAG, null);
  if (clearFlag) {
    await kvPut(env, KV_KEYS.JOURNAL, []);
    await kvPut(env, KV_KEYS.CLEAR_FLAG, null);  // consume the flag
  }

  // Pass 209: market-hours early exit. Saves ~70% of daily cost.
  // We still record a lastTick stamp so brain-proof's "lastTickAgo" doesn't
  // show "never" overnight, but skip the heavy reads/writes/Finnhub calls.
  if (!isMarketLikelyOpen()) {
    // Pass 244 (KV BUDGET — self-sustaining on free tier): the cron fires every
    // minute, but writing LAST_TICK every minute while the market is CLOSED
    // burned ~900 writes/day off-hours + ~2,880/weekend — blowing past the free
    // KV cap of 1,000 writes/day, after which writes silently fail and the brain
    // stops persisting. Nothing changes off-hours, so only refresh the heartbeat
    // twice an hour (at :00 and :30). Cuts off-hours writes ~900 -> ~48/day.
    const minNow = new Date().getUTCMinutes();
    if (minNow % 30 === 0 || clearFlag) {
      await kvPut(env, KV_KEYS.LAST_TICK, {
        ts: Date.now(), syms_updated: 0, errors: 0, captured: 0, resolved: 0, trained: 0,
        durationMs: Date.now() - startTs, skipped_market_closed: true, journal_cleared: !!clearFlag
      });
    }
    return { ok: true, skipped: 'market-closed', journal_cleared: !!clearFlag };
  }

  let [journal, model, lastTick, barsHistory, platt, signalsSnap] = await Promise.all([
    kvGet(env, KV_KEYS.JOURNAL, []),  // re-read: reflects the clear above if it fired
    kvGet(env, KV_KEYS.MODEL, newModel()),
    kvGet(env, KV_KEYS.LAST_TICK, { ts: 0, syms_updated: 0, errors: 0 }),
    kvGet(env, KV_KEYS.BARS_HISTORY, {}),  // pass 193: per-sym recent bars
    kvGet(env, KV_KEYS.PLATT, null),      // pass 213: Platt calibration params
    kvGet(env, KV_KEYS.SIGNALS, { updatedAt: 0, signals: {} })  // pass 231: scanner snapshot
  ]);
  const signalsMap = (signalsSnap && signalsSnap.signals) ? signalsSnap.signals : {};
  const journalClearedThisTick = !!clearFlag;

  // Pass 188: rotate through universe over multiple ticks to stay under
  // Finnhub free tier's 60-calls/min rate limit. Browser pages may also be
  // calling Finnhub, so we conservatively fetch 12 symbols per minute = 720
  // calls/hour, leaving headroom for browser usage.
  const tickIndex = Math.floor(Date.now() / 60000) % Math.ceil(UNIVERSE.length / 12);
  const start = tickIndex * 12;
  const slice = UNIVERSE.slice(start, start + 12);

  // Fetch the slice in parallel (pass 230: Yahoo-primary so we get real volume)
  const quotePromises = slice.map(s => fetchLiveQuote(env, s));
  const quotes = await Promise.all(quotePromises);
  const byMap = {};
  let okCount = 0, errCount = 0;
  for (let i = 0; i < slice.length; i++) {
    if (quotes[i]) { byMap[slice[i]] = quotes[i]; okCount++; }
    else errCount++;
  }
  const vix = (byMap.VIX && byMap.VIX.last) || 18;

  // Pass 193: update per-symbol bar history. New "bar" added when the
  // current ET day differs from the last stored bar's day. Within the same
  // day, we just update the latest bar's close/high/low/volume.
  function todayET() {
    const d = new Date();
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return et.getUTCFullYear() * 10000 + (et.getUTCMonth() + 1) * 100 + et.getUTCDate();
  }
  const dayKey = todayET();

  // Capture: one entry per symbol with valid quote (only this tick's slice)
  let captured = 0;
  // Pass 209: only persist BARS_HISTORY when a brand-new day-bar gets pushed.
  // Intraday updates (close/high/low changing within today's bar) still happen
  // in-memory for THIS tick's predictions but don't trigger a fresh KV write.
  // The features for the next tick are reconstructed from the live quote +
  // last-saved bars, so we don't lose any signal — just stop paying for a
  // 17,000-element BARS_HISTORY KV write 1,400 times/day.
  let barsHistoryDirty = false;
  for (const sym of slice) {
    const q = byMap[sym];
    if (!q) continue;
    // Pass 226: capture at most ONCE PER SYMBOL PER ET TRADING DAY (was a
    // 5-minute window). This brain predicts a 5-TRADING-day forward move
    // (bootstrap FWD_DAYS=5 on daily bars), so capturing the same symbol every
    // ~6 minutes produced ~90 near-identical rows/day that ALL resolve to the
    // SAME 5-day outcome — i.e. the live trainer saw a single (symbol, week)
    // observation ~90x, massively overweighting whichever names moved that
    // week, and flooding the 35k journal so it held only ~5 days before
    // eviction (too short for the 5-day horizon to even resolve safely). One
    // capture per ET day matches the daily-bar cadence the model was
    // bootstrapped on, makes each live sample a genuinely independent
    // observation, and lets the journal hold ~a year of history.
    // Pass 230: update bar history EVERY tick (tracks today's GROWING volume +
    // intraday high/low). This MUST run before the once-per-day capture guard
    // below — otherwise the day-bar would freeze at first-capture-time volume
    // and the unusual-volume scanner would never see intraday accumulation.
    if (!barsHistory[sym]) barsHistory[sym] = [];
    const history = barsHistory[sym];
    const lastBar = history.length > 0 ? history[history.length - 1] : null;
    if (lastBar && lastBar.dayKey === dayKey) {
      // Same day — update existing bar in memory only; do NOT mark dirty
      lastBar.close = q.last;
      if (q.dayHigh && q.dayHigh > lastBar.high) lastBar.high = q.dayHigh;
      if (q.dayLow && q.dayLow < lastBar.low) lastBar.low = q.dayLow;
      lastBar.volume = q.volume || lastBar.volume || 0;
    } else {
      // New day — push a new bar; this changes the persistent shape so flush
      history.push({
        ts: Date.now(),
        dayKey,
        open: q.dayOpen || q.last,
        high: q.dayHigh || q.last,
        low: q.dayLow || q.last,
        close: q.last,
        volume: q.volume || 0
      });
      // Cap history at 40 bars per symbol (enough for 20-day momentum)
      if (history.length > 40) history.splice(0, history.length - 40);
      barsHistoryDirty = true;
    }

    // Pass 231: compute features + calibrated prob for EVERY in-slice symbol
    // every tick, and refresh its scanner signal — so the unusual-volume scanner
    // stays intraday-fresh (each symbol updates as it rotates, ~every 6 min).
    // These are reused for the once-per-day journal capture below (no recompute).
    const features = extractRichFeatures(q, history, { vix });
    const rawP = predict(model, features);                 // pure global model output
    const adjP = applySymBias(rawP, sym, model);            // pass 234: per-symbol recalibration
    const p = applyPlatt(adjP, platt);                      // pass 213: global calibration -> final
    signalsMap[sym] = computeSignal(sym, q, history, p, dayKey);

    // Pass 226/230: capture ONE journal entry per symbol per ET trading day,
    // taken LATE in the session (>= 3pm ET) so the snapshot's price, volume
    // (RVOL) and intraday range match the near-complete daily bar the model was
    // bootstrapped on (the bootstrap enters at each day's CLOSE). Capturing at
    // the 8am pre-market open gave a thin pre-market price and ~0 volume — a
    // train/serve skew on top of a bad entry. Bars (above) still update all day.
    const lastCap = journal.filter(e => e.sym === sym).slice(-1)[0];
    if (lastCap && lastCap.dayKey === dayKey) continue;  // already captured today
    if (etHour() < 15) continue;                          // wait for the near-close snapshot

    journal.push({
      id: 'w-' + Date.now() + '-' + sym + '-' + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      sym,
      entryPx: q.last,
      features,
      predProb: p,           // calibrated (Platt-applied) prob — trade on this
      predProbRaw: rawP,     // raw model output — for diagnostics
      plattApplied: !!platt && typeof platt.a === 'number',
      priceSource: (q.priceSource || 'finnhub') + '-worker',  // pass 230: yahoo or finnhub
      regime: vix > 25 ? 'volatile_bear' : (q.changePct > 0 ? 'trending_bull' : 'choppy'),
      resolved: { short: false, mid: false, long: false },
      dayKey,                          // pass 226: ET trading day, for once-per-day dedup
      bars_in_history: history.length  // for debugging
    });
    captured++;
  }

  // Resolve: any entry where (now - ts) >= horizon, and we have current price
  let resolved = 0, trained = 0;
  const HORIZON_MIN_MOVE = { short: 0.003, mid: 0, long: 0.03 };  // pass 264: mid (5d) -> DENSE label (every move trains on its real direction). Backtest showed dense direction (52.4%) beats the +-1% threshold (45.5%). Must match the bootstrap LABEL_THRESHOLD below.
  for (const entry of journal) {
    if (!entry.resolved) entry.resolved = { short: false, mid: false, long: false };
    ['short', 'mid', 'long'].forEach(horizon => {
      if (entry.resolved[horizon]) return;
      const ageH = (Date.now() - entry.ts) / 3600000;
      if (ageH < HORIZON_HOURS[horizon]) return;
      const cur = byMap[entry.sym];
      if (!cur) return;
      const ret = (cur.last - entry.entryPx) / entry.entryPx;
      const predUp = entry.predProb >= 0.5;
      const wentUp = ret > HORIZON_MIN_MOVE[horizon];
      const wentDown = ret < -HORIZON_MIN_MOVE[horizon];
      let outcome;
      if (Math.abs(ret) < HORIZON_MIN_MOVE[horizon]) outcome = 'flat';
      else if ((predUp && wentUp) || (!predUp && wentDown)) outcome = 'correct';
      else outcome = 'wrong';
      entry.resolved[horizon] = outcome;
      // Pass 218 (CRITICAL): train on MID (5-day) horizon outcomes, not SHORT.
      // The bootstrap labels are 5-day forward direction at ±1pp threshold
      // (pass 206). Training the live loop on 1-day outcomes was producing a
      // 1-day-direction model that disagreed with the 5-day-direction model
      // the bootstrap fit. Two heads on different time horizons fighting each
      // other on every capture/resolve cycle. Now both speak the same
      // language: 5-day direction at ±1pp (HORIZON_MIN_MOVE.mid = 0.01).
      if (outcome !== 'flat' && horizon === 'mid') {
        const label = outcome === 'correct' ? (predUp ? 1 : 0) : (predUp ? 0 : 1);
        trainStep(model, entry.features, label);
        trained++;
      }
      resolved++;
    });
  }

  // Trim journal
  if (journal.length > MAX_JOURNAL) {
    journal.splice(0, journal.length - MAX_JOURNAL);
  }

  // Pass 190 (CRITICAL race fix): only persist the model if we actually
  // trained on resolutions. Otherwise the cron tick could overwrite a
  // freshly-bootstrapped model (n_trained=8562) with a stale in-memory copy
  // due to Cloudflare KV's eventual-consistency window.
  //
  // Pass 209 (cost): only persist BARS_HISTORY when barsHistoryDirty
  // (i.e., a new day-bar was pushed). Intraday close-updates stay in
  // memory and are reconstructed from the live Finnhub quote next tick.
  // Saves ~1,400 large-payload writes/day during market hours.
  // Pass 244 (KV BUDGET): the cron runs every minute, but we don't need to
  // PERSIST every minute. Free-tier KV is 1,000 writes/day; writing JOURNAL +
  // LAST_TICK + SIGNALS every minute = ~1,620/day in market hours alone. So:
  //   - JOURNAL: only when its contents actually changed (capture/resolve/train).
  //   - LAST_TICK: heartbeat — every 2 min (or whenever something changed). The
  //     /brain/health "healthy" gate is ageS < 180s, so 2-min cadence is safe.
  //   - SIGNALS: every 3 min (the scanner is a ~15-min-delayed product; the
  //     browser polls it every 25s and tolerates 3-min-old snapshots).
  // Data is never lost: any tick that captures/resolves/trains writes JOURNAL.
  const minNow = Math.floor(Date.now() / 60000);
  const changed = (captured > 0 || resolved > 0 || trained > 0);
  const writes = [];
  if (changed) writes.push(kvPut(env, KV_KEYS.JOURNAL, journal));
  if (changed || minNow % 2 === 0) {
    writes.push(kvPut(env, KV_KEYS.LAST_TICK, {
      ts: Date.now(), syms_updated: okCount, errors: errCount,
      captured, resolved, trained, durationMs: Date.now() - startTs,
      skipped_model_write: trained === 0, skipped_bars_write: !barsHistoryDirty,
      journalTotal: journal.length
    }));
  }
  if (barsHistoryDirty) writes.push(kvPut(env, KV_KEYS.BARS_HISTORY, barsHistory));
  if (trained > 0) writes.push(kvPut(env, KV_KEYS.MODEL, model));
  if (minNow % 3 === 0) writes.push(kvPut(env, KV_KEYS.SIGNALS, { updatedAt: Date.now(), signals: signalsMap }));
  if (writes.length) await Promise.all(writes);

  return { ok: true, captured, resolved, trained, syms: okCount, errors: errCount, signals: Object.keys(signalsMap).length };
}

// ============================================================
// HTTP handler — serves brain state to browser pages
// ============================================================
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

async function handleRequest(request, env, ctx) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(request.url);
  const path = url.pathname;

  // ===== Pass 240: customer auth routes =====
  if (path === '/auth/register' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const email = normEmail(body && body.email);
    const password = String((body && body.password) || '');
    if (!validEmail(email)) return json({ error: 'invalid email' }, 400);
    if (password.length < 8) return json({ error: 'password must be at least 8 characters' }, 400);
    const existing = await kvGet(env, 'user:' + email, null);
    if (existing) return json({ error: 'account already exists — try logging in' }, 409);
    const salt = randomHex(16);
    const hash = await pbkdf2Hash(password, salt);
    const user = { email, salt, hash, createdAt: Date.now() };
    await kvPut(env, 'user:' + email, user);
    const token = randomHex(32);
    await kvPutTTL(env, 'session:' + token, { email, createdAt: Date.now() }, SESSION_TTL_SEC);
    return json({ ok: true, token, email });
  }

  if (path === '/auth/login' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const email = normEmail(body && body.email);
    const password = String((body && body.password) || '');
    if (!validEmail(email) || !password) return json({ error: 'email and password required' }, 400);
    // Per-email throttle: max 8 failed attempts / 15 min (brute-force guard).
    const tkey = 'auththrottle:' + email;
    const tries = (await kvGet(env, tkey, 0)) || 0;
    if (tries >= 8) return json({ error: 'too many attempts — wait 15 minutes' }, 429);
    const user = await kvGet(env, 'user:' + email, null);
    let okPw = false;
    if (user && user.salt && user.hash) {
      const h = await pbkdf2Hash(password, user.salt);
      okPw = timingSafeEqualHex(h, user.hash);
    }
    if (!user || !okPw) {
      await kvPutTTL(env, tkey, tries + 1, 900);
      return json({ error: 'invalid email or password' }, 401);
    }
    await kvDelete(env, tkey);
    const token = randomHex(32);
    await kvPutTTL(env, 'session:' + token, { email, createdAt: Date.now() }, SESSION_TTL_SEC);
    return json({ ok: true, token, email });
  }

  if (path === '/auth/me') {
    const email = await getSessionEmail(env, request);
    if (!email) return json({ authenticated: false }, 200);
    const user = await kvGet(env, 'user:' + email, null);
    return json({ authenticated: true, email, createdAt: user ? user.createdAt : null, prefs: (user && user.prefs) || {} });
  }

  if (path === '/auth/logout' && request.method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) await kvDelete(env, 'session:' + m[1]);
    return json({ ok: true });
  }

  if (path === '/auth/prefs' && request.method === 'POST') {
    // Save per-user preferences (watchlist, alert settings). Auth required.
    const email = await getSessionEmail(env, request);
    if (!email) return json({ error: 'not authenticated' }, 401);
    let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const user = await kvGet(env, 'user:' + email, null);
    if (!user) return json({ error: 'user not found' }, 404);
    user.prefs = (body && typeof body.prefs === 'object') ? body.prefs : {};
    user.prefsUpdatedAt = Date.now();
    await kvPut(env, 'user:' + email, user);
    return json({ ok: true, prefs: user.prefs });
  }

  // ===== Pass 268: first-party usage analytics (anon, privacy-light) =====
  if (path === '/track' && request.method === 'POST') {
    let b; try { b = await request.json(); } catch (e) { try { b = JSON.parse(await request.text()); } catch (e2) { b = null; } }
    if (!b || !b.event) return json({ ok: false }, 200);
    ctx.waitUntil(recordTrack(env, b));
    return json({ ok: true });
  }
  if (path === '/track/stats') {
    const a = await kvGet(env, KV_KEYS.ANALYTICS, null);
    if (!a) return json({ ok: true, empty: true, total: 0, unique: 0, new_users: 0, pageviews: 0, pages: {}, events: {}, days: {}, refs: {}, recent: [] });
    return json({
      ok: true, total: a.total || 0, pageviews: a.pageviews || 0,
      unique: a.uniq ? Object.keys(a.uniq).length : 0, new_users: a.new_users || 0,
      pages: a.pages || {}, events: a.events || {}, days: a.days || {}, refs: a.refs || {},
      feedback: (a.feedback || []).slice(-50),
      recent: (a.recent || []).slice(-50), since: a.since || null, updatedAt: a.updatedAt || null
    });
  }

  if (path === '/brain/health' || path === '/healthz') {
    const [lt, autoTs, model, platt, sigSnap] = await Promise.all([
      kvGet(env, KV_KEYS.LAST_TICK, { ts: 0 }),
      kvGet(env, KV_KEYS.AUTO_BOOTSTRAP_TS, 0),   // pass 229: autonomous bootstrap observability
      kvGet(env, KV_KEYS.MODEL, null),            // pass 233: expose trained count for liveness UI
      kvGet(env, KV_KEYS.PLATT, null),            // pass 258: calibration self-audit
      kvGet(env, KV_KEYS.SIGNALS, { updatedAt: 0, signals: {} }) // pass 258: scanner freshness self-audit
    ]);
    const ageS = lt.ts ? Math.floor((Date.now() - lt.ts) / 1000) : null;
    const marketOpen = isMarketLikelyOpen();
    const trained = model && typeof model.n_trained === 'number' ? model.n_trained : 0;
    // Pass 251: market-aware self-sustaining check. Off-hours the heartbeat is
    // throttled to ~30 min (pass 244 cost fix), so a large lastTickAgo at night
    // or on weekends is NORMAL — not a failure. The uptime monitor watches
    // self_sustaining (NOT the strict `healthy` flag) to avoid nightly false alarms.
    const tickFresh = ageS != null && (marketOpen ? ageS < 300 : ageS < 2400);
    const issues = [];
    if (ageS == null) issues.push('no cron tick recorded yet — worker may not be deployed/scheduled');
    else if (!tickFresh) issues.push('last tick ' + ageS + 's ago — cron may be stalled');
    if (trained <= 0) issues.push('model missing or untrained — watchdog will auto-recover within ~3h');
    const selfSustaining = tickFresh && trained > 0;
    // Pass 258: structured self-audit — the brain checks its own vitals every time
    // this is polled (and the GitHub uptime monitor reads it). Each check is a
    // named pass/fail with a human detail, so a problem is legible, not a mystery.
    const audit = [];
    const chk = (check, pass, detail) => audit.push({ check, pass: !!pass, detail: detail || '' });
    const weightsFinite = !!(model && Array.isArray(model.weights) && model.weights.length > 0 && model.weights.every(w => Number.isFinite(w)));
    const sigCount = Object.keys((sigSnap && sigSnap.signals) || {}).length;
    const sigAgeMin = sigSnap && sigSnap.updatedAt ? Math.round((Date.now() - sigSnap.updatedAt) / 60000) : null;
    const calA = platt && typeof platt.a === 'number' ? platt.a : null;
    chk('cron_tick_fresh', tickFresh, ageS == null ? 'no tick recorded' : ageS + 's ago (' + (marketOpen ? 'market open' : 'off-hours') + ')');
    chk('model_trained', trained > 0, trained.toLocaleString() + ' examples');
    chk('model_weights_finite', weightsFinite, weightsFinite ? (model.weights.length + ' weights, all finite') : 'weights missing or non-finite');
    chk('calibration_not_inverted', calA == null || calA >= 0.2, calA == null ? 'using raw probabilities (no Platt fit yet — fine)' : 'Platt a=' + calA.toFixed(3) + (calA >= 0.2 ? ' (healthy)' : ' (REJECTED — would invert)'));
    chk('scanner_signals_present', sigCount >= 8, sigCount + ' symbols scored' + (sigAgeMin != null ? ', ' + sigAgeMin + 'm old' : ''));
    const auditPass = audit.every(a => a.pass);
    return json({
      ok: true,
      lastTickAgo: ageS,
      lastTick: lt,
      healthy: ageS != null && ageS < 180,           // strict (market-hours) — kept for back-compat
      self_sustaining: selfSustaining,                 // pass 251: market-aware — MONITOR THIS, not `healthy`
      audit,                                           // pass 258: structured self-audit checks
      audit_pass: auditPass,                           // pass 258: true only if every check passes
      issues,                                          // pass 251: human-readable problems (empty array = all good)
      worker_version: WORKER_VERSION,  // pass 200
      auto_bootstrap_ts: autoTs || 0,  // pass 229
      auto_bootstrap_ago_h: autoTs ? +((Date.now() - autoTs) / 3600000).toFixed(2) : null,
      // Pass 233: data-liveness summary for the scanner status bar
      model_trained: trained,
      journal_total: typeof lt.journalTotal === 'number' ? lt.journalTotal : null,
      market_open: marketOpen,
      data_source: 'yahoo-live (~15m delayed)'
    });
  }

  if (path === '/brain/state') {
    const [journal, model, lastTick] = await Promise.all([
      kvGet(env, KV_KEYS.JOURNAL, []),
      kvGet(env, KV_KEYS.MODEL, newModel()),
      kvGet(env, KV_KEYS.LAST_TICK, {})
    ]);
    return json({
      journal: journal.slice(-500),  // last 500 entries (full would be too big per request)
      journalTotal: journal.length,
      model: { n_trained: model.n_trained, version: model.version, weights: model.weights, bias: model.bias },
      lastTick
    });
  }

  if (path === '/brain/journal') {
    // Pass 201: validate n more carefully. parseInt('garbage') → NaN, then
    // Math.min(2000, NaN) → NaN, then journal.slice(-NaN) → entire journal.
    // Coerce to a sane positive int between 1 and 2000.
    const nRaw = parseInt(url.searchParams.get('n') || '200', 10);
    const n = Math.min(2000, Math.max(1, Number.isFinite(nRaw) ? nRaw : 200));
    const journal = await kvGet(env, KV_KEYS.JOURNAL, []);
    return json({ journal: journal.slice(-n), total: journal.length });
  }

  if (path === '/brain/model') {
    const model = await kvGet(env, KV_KEYS.MODEL, newModel());
    return json(model);
  }

  if (path === '/brain/champions') {
    // Pass 222: champion/challenger leaderboard from the last bootstrap.
    const champs = await kvGet(env, KV_KEYS.CHAMPIONS, null);
    if (!champs) return json({ error: 'no champion data yet — run /brain/bootstrap', leaderboard: [] });
    return json(champs);
  }

  if (path === '/brain/learning') {
    // Pass 238: honest, human-readable training status. Answers "is the brain
    // training, and how would I know?" The brain learns in TWO stages:
    //   1) FOUNDATION — historical bootstrap (model.n_trained gradient steps).
    //   2) LIVE SELF-LEARNING — each daily prediction is scored against the
    //      actual 5-trading-day (7 calendar day) outcome, then trained on.
    // This reports both, plus a 1-DAY "early read" (short-horizon directional
    // accuracy) as a leading indicator so you get feedback in ~1 day instead
    // of waiting the full 7 for the first 5-day resolution.
    const [model, journal, champs] = await Promise.all([
      kvGet(env, KV_KEYS.MODEL, newModel()),
      kvGet(env, KV_KEYS.JOURNAL, []),
      kvGet(env, KV_KEYS.CHAMPIONS, null)
    ]);
    const now = Date.now();
    const clean = journal.filter(e => typeof e.dayKey === 'number');  // post-pass-226 captures
    let shortN = 0, shortHit = 0, midN = 0, midHit = 0, oldestCleanMs = 0;
    for (const e of clean) {
      const age = now - (e.ts || now);
      if (age > oldestCleanMs) oldestCleanMs = age;
      const r = e.resolved || {};
      if (r.short && r.short !== false && r.short !== 'flat') { shortN++; if (r.short === 'correct') shortHit++; }
      if (r.mid && r.mid !== false && r.mid !== 'flat') { midN++; if (r.mid === 'correct') midHit++; }
    }
    const oldestDays = oldestCleanMs / 86400000;
    const daysToFirstMid = Math.max(0, +(HORIZON_HOURS.mid / 24 - oldestDays).toFixed(1));
    return json({
      // Stage 1 — foundation (historical)
      foundation_trained: model.n_trained || 0,
      foundation_l2: model.l2,
      sym_bias_symbols: model.symBias ? Object.keys(model.symBias).length : 0,
      last_champion: champs ? champs.champion : null,
      // Stage 2 — live self-learning
      live_captures_clean: clean.length,
      live_captures_total: journal.length,
      mid_resolved: midN,
      mid_accuracy: midN > 0 ? +(midHit / midN).toFixed(4) : null,
      mid_learning_active: midN > 0,
      days_to_first_mid_resolution: daysToFirstMid,
      oldest_capture_days: +oldestDays.toFixed(1),
      // Early read — 1-day directional accuracy (leading indicator, NOT trained on)
      early_read_1d_resolved: shortN,
      early_read_1d_accuracy: shortN > 0 ? +(shortHit / shortN).toFixed(4) : null,
      // Signal pipeline explainer
      how_it_signals: 'model weights -> predProb per symbol -> cross-sectional rank -> BUY/SELL/WATCH on /brain/signals',
      worker_version: WORKER_VERSION
    });
  }

  if (path === '/brain/signals') {
    // Pass 231/236: CROSS-SECTIONAL relative-strength scanner. The cron tick
    // stores each symbol's absolute predProb + RVOL; here we rank every name
    // against the CURRENT universe instead of an absolute 0.5 line. Why: the
    // absolute P(up) drifts with the market regime — in a down tape every name
    // clusters bearish, so absolute BUY/SELL thresholds collapse to "all SELL"
    // (and "all HOLD" in a flat tape). Ranking each name vs its peers always
    // yields a balanced, actionable long/short list. We still surface the
    // absolute P(up) per row AND an overall regime read, so it stays honest:
    // a relative "BUY" in a bearish tape is the STRONGEST name, not a promise
    // it rises — the regime banner tells you whether to favor longs or cash.
    const snap = await kvGet(env, KV_KEYS.SIGNALS, { updatedAt: 0, signals: {} });
    let arr = Object.values(snap.signals || {})
      .filter(s => s && (Date.now() - (s.ts || 0)) < 4 * 24 * 60 * 60 * 1000);  // ~4d retention

    const withProb = arr.filter(s => typeof s.predProb === 'number');
    const n = withProb.length;
    const sorted = withProb.map(s => s.predProb).sort((a, b) => a - b);
    const universeMean = n ? sorted.reduce((a, b) => a + b, 0) / n : 0.5;
    const regime = n < 8 ? 'unknown' : (universeMean >= 0.52 ? 'bullish' : universeMean <= 0.48 ? 'bearish' : 'neutral');
    if (n >= 8) {
      for (const s of withProb) {
        let below = 0; for (const q of sorted) { if (q < s.predProb) below++; }
        const rank = n > 1 ? below / (n - 1) : 0.5;   // 0 = weakest .. 1 = strongest in universe
        s.rel_rank = +rank.toFixed(3);
        s.rel_excess = +(s.predProb - universeMean).toFixed(4);
        const rv = s.rvol || 0;
        const volNote = rv >= 1.5 ? ' + ' + rv.toFixed(1) + '× volume' : '';
        // Rank drives the call (cross-sectional); volume is a conviction modifier.
        if (rank >= 0.85) { s.signal = 'BUY'; s.reason = 'top ' + Math.max(1, Math.round((1 - rank) * 100)) + '% relative strength' + volNote; }
        else if (rank <= 0.15) { s.signal = 'SELL'; s.reason = 'bottom ' + Math.max(1, Math.round(rank * 100)) + '% relative strength' + volNote; }
        else if (rv >= 2.5) { s.signal = 'WATCH'; s.reason = rv.toFixed(1) + '× volume surge, mid-pack strength'; }
        else if (rank >= 0.70) { s.signal = 'LEAN BUY'; s.reason = 'upper-third relative strength' + volNote; }
        else if (rank <= 0.30) { s.signal = 'LEAN SELL'; s.reason = 'lower-third relative strength' + volNote; }
        else { s.signal = 'HOLD'; s.reason = 'mid-pack relative strength'; }
        // Sort key: distance from the pack x a volume boost (so volume-confirmed extremes rank first).
        s.rank = +(Math.abs(rank - 0.5) * 2 * (1 + Math.min(rv || 1, 4) / 4)).toFixed(4);
      }
    }
    const wantSignal = (url.searchParams.get('signal') || '').toUpperCase();
    if (wantSignal) arr = arr.filter(s => s.signal === wantSignal);
    const minRvol = parseFloat(url.searchParams.get('min_rvol') || '0');
    if (minRvol > 0) arr = arr.filter(s => (s.rvol || 0) >= minRvol);
    const order = { BUY: 0, SELL: 1, WATCH: 2, 'LEAN BUY': 3, 'LEAN SELL': 4, HOLD: 5 };
    arr.sort((a, b) => ((order[a.signal] ?? 9) - (order[b.signal] ?? 9)) || ((b.rank || 0) - (a.rank || 0)));
    const counts = arr.reduce((m, s) => { m[s.signal] = (m[s.signal] || 0) + 1; return m; }, {});
    // Pass 241: large-trades-before-close — names with unusual volume in the
    // final trading hour, ranked by RVOL (most institutional-looking first).
    const intoClose = arr.filter(s => s.intoClose).sort((a, b) => (b.rvol || 0) - (a.rvol || 0));
    return json({
      updatedAt: snap.updatedAt || 0,
      ageSec: snap.updatedAt ? Math.floor((Date.now() - snap.updatedAt) / 1000) : null,
      into_close_count: intoClose.length,
      into_close: intoClose.slice(0, 20),
      count: arr.length,
      counts,
      regime,                                          // pass 236: bullish / neutral / bearish
      universe_mean_prob: +universeMean.toFixed(4),    // avg 5d P(up) across the scanned universe
      note: 'Cross-sectional relative strength: each name ranked vs the current universe (regime-robust). Absolute P(up 5d) shown per row. Unusual VOLUME + brain conviction; free-data TA proxy, NOT options-flow whale prints.',
      signals: arr
    });
  }

  // ===== Pass 280: REAL quotes for the FULL displayed universe =====
  // Browser pages were showing stale SEED prices for any symbol outside the ~24
  // ranked signals (e.g. SMCI showed a months-old ~$51 instead of the real ~$40).
  // This serves real Yahoo prices for any requested symbol so the browser can
  // replace every seed with a real, delayed price. 60s-cached in KV so a flood of
  // browser polls can't hammer Yahoo or blow the Workers subrequest budget.
  if (path === '/brain/quotes') {
    const reqRaw = (url.searchParams.get('syms') || '').toUpperCase();
    let req = reqRaw ? reqRaw.split(',').map(s => s.trim()).filter(Boolean) : UNIVERSE.slice();
    req = [...new Set(req)].filter(s => UNIVERSE.includes(s) || STOOQ_MAP[s]);
    const CACHE_KEY = 'live_quotes_cache_v1';
    let cache = {};
    try { const raw = await env.BRAIN_KV.get(CACHE_KEY); if (raw) cache = JSON.parse(raw) || {}; } catch (e) {}
    const now = Date.now();
    const q = (cache && cache.quotes) ? cache.quotes : {};
    const fresh = cache.updatedAt && (now - cache.updatedAt < 60000);
    // Fetch the requested symbols that are missing (or, if the cache is stale, all
    // of them) — capped at 24/request to stay under the free-tier subrequest limit.
    const need = (fresh ? req.filter(s => !q[s]) : req).slice(0, 24);
    if (need.length) {
      const fetched = await Promise.all(need.map(s => fetchYahooQuote(s).catch(() => null)));
      fetched.forEach((r, i) => {
        if (r && typeof r.last === 'number' && r.last > 0) {
          q[need[i]] = { last: r.last, prevClose: r.prevClose, changePct: r.changePct, volume: r.volume, dayHigh: r.dayHigh, dayLow: r.dayLow, ts: r.ts };
        }
      });
      try { await env.BRAIN_KV.put(CACHE_KEY, JSON.stringify({ updatedAt: now, quotes: q }), { expirationTtl: 900 }); } catch (e) {}
    }
    const out = {};
    req.forEach(s => { if (q[s]) out[s] = q[s]; });
    return json({ updatedAt: (cache.updatedAt || now), count: Object.keys(out).length, quotes: out });
  }

  // ===== Pass 282: REAL daily OHLC bars (for sector RS, breadth, TA, pivots) =====
  // Serves the per-symbol bar history the cron already maintains in KV - no new
  // fetches, no added cost. Lets pages compute REAL week/month performance, moving
  // averages, RSI / pivots / candle patterns instead of synthesizing them.
  if (path === '/brain/bars') {
    const reqRaw = (url.searchParams.get('syms') || url.searchParams.get('sym') || '').toUpperCase();
    let reqB = reqRaw ? reqRaw.split(',').map(s => s.trim()).filter(Boolean) : UNIVERSE.slice();
    reqB = [...new Set(reqB)];
    const daysB = Math.min(40, Math.max(2, parseInt(url.searchParams.get('days') || '40', 10) || 40));
    const barsHistory = await kvGet(env, KV_KEYS.BARS_HISTORY, {});
    const outB = {};
    for (const sym of reqB) {
      const h = barsHistory[sym];
      if (Array.isArray(h) && h.length) {
        outB[sym] = h.slice(-daysB).map(b => ({ ts: b.ts, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
      }
    }
    return json({ count: Object.keys(outB).length, days: daysB, bars: outB });
  }

  // ===== Pass 248: REAL news feed (Finnhub via worker key — free for all) =====
  if (path === '/brain/news') {
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    const sym = (url.searchParams.get('symbol') || '').toUpperCase().trim();
    const category = (url.searchParams.get('category') || 'general').toLowerCase();
    let items;
    if (sym) items = await fetchFinnhubCompanyNews(env, sym, 14);
    else items = await fetchFinnhubNews(env, category);
    const resp = json({
      ok: Array.isArray(items),
      source: 'finnhub',
      symbol: sym || null,
      category: sym ? null : category,
      count: Array.isArray(items) ? items.length : 0,
      items: items || [],
      note: Array.isArray(items) ? undefined : 'finnhub returned no data (key missing/invalid or rate-limited)'
    });
    // Edge-cache 5 min: news doesn't change every second, and this shields the
    // 60-call/min free limit no matter how many customers hit it.
    resp.headers.set('Cache-Control', 'public, max-age=300');
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  }

  // ===== Pass 248: REAL insider transactions (SEC Form 3/4/5 via Finnhub) =====
  if (path === '/brain/insider') {
    const sym = (url.searchParams.get('symbol') || '').toUpperCase().trim();
    if (!sym) return json({ ok: false, error: 'symbol required (e.g. ?symbol=NVDA)' }, 400);
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    const txns = await fetchFinnhubInsider(env, sym);
    const arr = Array.isArray(txns) ? txns : [];
    const buys = arr.filter(t => t.side === 'BUY');
    const sells = arr.filter(t => t.side === 'SELL');
    const openMarket = arr.filter(t => t.openMarket);
    const resp = json({
      ok: Array.isArray(txns),
      source: 'finnhub/sec-form4',
      symbol: sym,
      count: arr.length,
      buy_count: buys.length,
      sell_count: sells.length,
      open_market_count: openMarket.length,
      net_open_market_value: openMarket.reduce((s, t) => s + (t.side === 'BUY' ? t.value : -t.value), 0),
      transactions: arr,
      note: Array.isArray(txns)
        ? 'SEC Form 3/4/5 filings. Open-market P (buy) / S (sell) carry the signal; A/M/G/F are grants, exercises, gifts, tax-withholding.'
        : 'finnhub returned no insider data (key missing/invalid or symbol unsupported)'
    });
    // Insider filings update slowly (legal lag) — cache 1h.
    resp.headers.set('Cache-Control', 'public, max-age=3600');
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  }

  // ===== Pass 248: aggregated market-wide insider feed (one cached call) =====
  // The browser "Insider Trades Live" page wants a cross-symbol feed; rather
  // than fan out 16 calls from every visitor's browser, the worker assembles
  // it once, computes buy-clusters, and edge-caches the whole thing for 1h.
  if (path === '/brain/insider-feed') {
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    const DEFAULT_BASKET = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'AMD', 'PLTR', 'COIN', 'AVGO', 'JPM', 'GS', 'DIS', 'NFLX', 'UBER'];
    const reqSyms = (url.searchParams.get('symbols') || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
    const syms = (reqSyms.length ? reqSyms : DEFAULT_BASKET).slice(0, 20);
    const results = await Promise.all(syms.map(s =>
      fetchFinnhubInsider(env, s).then(t => ({ sym: s, txns: t })).catch(() => ({ sym: s, txns: null }))
    ));
    let all = [];
    for (const r of results) {
      if (!Array.isArray(r.txns)) continue;
      r.txns.slice(0, 12).forEach(t => all.push(Object.assign({}, t, { sym: r.sym })));   // most-recent 12 per symbol
    }
    all.sort((a, b) => (b.filingDate || '').localeCompare(a.filingDate || ''));
    all = all.slice(0, 150);
    // Buy clusters: a symbol with >=2 distinct insiders making OPEN-MARKET buys
    // is the classic bullish tell (multiple insiders putting cash in at once).
    const clusterBuys = all.filter(t => t.side === 'BUY' && t.openMarket);
    const bySym = {};
    clusterBuys.forEach(t => {
      const c = (bySym[t.sym] = bySym[t.sym] || { sym: t.sym, buyers: new Set(), value: 0, count: 0 });
      c.buyers.add(t.name); c.value += t.value; c.count++;
    });
    const clusters = Object.values(bySym)
      .filter(c => c.buyers.size >= 2)
      .map(c => ({ sym: c.sym, buyers: c.buyers.size, count: c.count, value: c.value }))
      .sort((a, b) => b.value - a.value);
    const buys = all.filter(t => t.side === 'BUY');
    const sells = all.filter(t => t.side === 'SELL');
    const okSyms = results.filter(r => Array.isArray(r.txns)).length;
    const resp = json({
      ok: all.length > 0,
      source: 'finnhub/sec-form4',
      symbols: syms,
      symbols_with_data: okSyms,
      count: all.length,
      buy_count: buys.length,
      sell_count: sells.length,
      buy_value: buys.reduce((s, t) => s + t.value, 0),
      sell_value: sells.reduce((s, t) => s + t.value, 0),
      clusters,
      transactions: all,
      note: 'Real SEC Form 3/4/5 across a liquid basket. Open-market P (buy) / S (sell) carry the signal; A/M/G/F are grants/exercises/gifts/tax.'
    });
    resp.headers.set('Cache-Control', 'public, max-age=3600');
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  }

  // ===== Pass 252: live edge scorecard — the receipt =====
  if (path === '/brain/confluence-score') {
    const log = await kvGet(env, 'confluence_log_v1', []);
    const resolved = log.filter(e => e && e.resolved && typeof e.ret === 'number');
    // Grade a leg: dirFn(e) -> +1 (bullish call) / -1 (bearish call) / 0 (no call).
    // A call is a HIT if the realized 5-day move went the called direction.
    function score(entries, dirFn) {
      const calls = entries.map(e => ({ dir: dirFn(e), ret: e.ret })).filter(c => c.dir !== 0);
      const n = calls.length;
      const hits = calls.filter(c => (c.dir > 0 && c.ret > 0) || (c.dir < 0 && c.ret < 0)).length;
      // Directional return: + when the move went our way. Mean across calls.
      const avgDirRet = n ? calls.reduce((a, c) => a + c.ret * c.dir, 0) / n : null;
      // One-sided z vs a 50% coin flip (binomial normal approx).
      const z = n >= 5 ? (hits - n * 0.5) / Math.sqrt(n * 0.25) : null;
      return {
        n, hits,
        hit_rate: n ? +(hits / n).toFixed(4) : null,
        avg_directional_ret_pct: avgDirRet != null ? +avgDirRet.toFixed(3) : null,
        z_score: z != null ? +z.toFixed(2) : null,
        beats_coin_flip_95: z != null && z > 1.64
      };
    }
    const confDir = e => (e.brainDir !== 0 && e.insDir !== 0 && Math.sign(e.brainDir) === Math.sign(e.insDir)) ? e.brainDir : 0;
    // Pass 254: ALPHA (high-conviction) + POTD (single best per day) subsets.
    // These are what we BROADCAST + grade; the full 72-name universe is just
    // background training noise (the brain is often "bearish on everything").
    const convOf = e => Math.abs((e.predProb || 0.5) - 0.5);
    const byDayR = {};
    resolved.forEach(e => { (byDayR[e.dayKey] = byDayR[e.dayKey] || []).push(e); });
    const potdResolved = [], alphaResolved = [];
    Object.values(byDayR).forEach(day => {
      const s = day.slice().sort((a, b) => convOf(b) - convOf(a));
      if (s[0]) potdResolved.push(s[0]);          // single highest-conviction call that day
      s.slice(0, 8).forEach(e => alphaResolved.push(e));  // top-8 conviction = the "alpha" set
    });
    const pending = log.filter(e => e && !e.resolved);
    const oldestPendingTs = pending.reduce((m, e) => Math.min(m, e.ts || Infinity), Infinity);
    const daysToFirst = (resolved.length === 0 && isFinite(oldestPendingTs))
      ? Math.max(0, Math.ceil((oldestPendingTs + 7 * 86400000 - Date.now()) / 86400000)) : 0;
    const brainLeg = score(resolved, e => e.brainDir);
    const insiderLeg = score(resolved, e => e.insDir);
    const confluenceLeg = score(resolved, confDir);
    const potdLeg = score(potdResolved, e => e.brainDir);
    const alphaLeg = score(alphaResolved, e => e.brainDir);
    // Pass 262: self-computing VERDICT on whether fusing signals (brain + insider
    // AGREEMENT) is worth it — the real test of whether paying for richer flow data
    // would pay off. Reports itself in plain English the moment there are enough
    // graded confluence calls; no external scheduler needed (the worker grades 24/7).
    const VERDICT_MIN_N = 20;
    const vpct = x => (x == null ? 'n/a' : (x * 100).toFixed(1) + '%');
    let verdict;
    if (confluenceLeg.n < VERDICT_MIN_N) {
      verdict = {
        ready: false,
        graded: confluenceLeg.n,
        need: VERDICT_MIN_N,
        headline: 'Confluence forward-test still accruing — ' + confluenceLeg.n + ' of ' + VERDICT_MIN_N + ' confluence calls graded. No verdict yet; it fills in over the coming weeks (each call grades 5 trading days after it is made).'
      };
    } else {
      const cHit = confluenceLeg.hit_rate, bHit = (brainLeg.n >= 10) ? brainLeg.hit_rate : null;
      const beatsCoin = !!confluenceLeg.beats_coin_flip_95;
      const beatsBrain = (bHit != null) ? (cHit > bHit) : null;   // confluence stronger than brain-only?
      const worthIt = beatsCoin && beatsBrain === true;
      verdict = {
        ready: true,
        n: confluenceLeg.n,
        confluence_hit_rate: cHit,
        brain_hit_rate: bHit,
        confluence_beats_coin_flip_95: beatsCoin,
        confluence_beats_brain_only: beatsBrain,
        fusing_worth_it: worthIt,
        headline: worthIt
          ? 'YES — fusing signals adds edge. Confluence (brain + insiders agree) hits ' + vpct(cHit) + ' over ' + confluenceLeg.n + ' graded calls, beats a coin flip at 95%, AND beats brain-only (' + vpct(bHit) + '). Paying for richer flow data is justified by this evidence.'
          : (beatsCoin
            ? 'PARTIAL — confluence beats a coin flip (' + vpct(cHit) + ', n=' + confluenceLeg.n + ') but does NOT clearly beat brain-only (' + vpct(bHit) + '), so fusing adds little on its own. Paying for flow data is not yet justified.'
            : 'NO — confluence does not beat a coin flip (' + vpct(cHit) + ', n=' + confluenceLeg.n + '). On this evidence, fusing these signals is not worth it and paying for flow data would not be justified.')
      };
    }
    return json({
      ok: true,
      total_logged: log.length,
      graded: resolved.length,
      pending: pending.length,
      days_to_first_grade: daysToFirst,
      verdict,                                          // pass 262: the plain-English answer (self-computing)
      potd: potdLeg,     // pass 254: Pick-of-the-Day record (broadcast)
      alpha: alphaLeg,   // pass 254: high-conviction record (broadcast)
      brain: brainLeg,   // full universe (background training)
      insider: insiderLeg,
      confluence: confluenceLeg,
      // Pass 253: per-trade resolved calls so the Money Made page can show a REAL
      // dollar track record from the 24/7 worker (not the tab-only browser brain).
      recent_resolved: resolved.slice(-80).reverse().map(e => ({
        sym: e.sym, ts: e.ts, dayKey: e.dayKey,
        dir: e.brainDir, ret: e.ret, predProb: e.predProb,
        conf: (e.brainDir !== 0 && e.insDir !== 0 && Math.sign(e.brainDir) === Math.sign(e.insDir))
      })),
      note: 'Live FORWARD test: each daily directional call graded against the real 5-trading-day move. Hit = direction correct. beats_coin_flip_95 = one-sided z>1.64. Small N early — this fills out over weeks. The brain’s BACKtested edge is in /brain/metrics.'
    });
  }

  // ===== Pass 254: today's broadcast picks — the single Pick of the Day + the
  // high-conviction Alpha list (from the live signal universe, ranked by how far
  // the brain's 5-day P(up) is from a coin flip). This is the public face; the
  // full universe stays in the background. =====
  if (path === '/brain/picks') {
    const [snap, constraints] = await Promise.all([
      kvGet(env, KV_KEYS.SIGNALS, { updatedAt: 0, signals: {} }),
      loadConstraints(env)
    ]);
    const allSigs = Object.values(snap.signals || {})
      .filter(s => s && typeof s.predProb === 'number' && s.last > 0)
      .filter(s => (Date.now() - (s.ts || 0)) < 4 * 24 * 60 * 60 * 1000);
    // Pass 258: gate broadcasts through the editable constraints (noise control).
    // The brain still SCORES + TRAINS on the whole universe; constraints only
    // decide what we surface as a pick.
    const sigs = applyConstraints(allSigs, constraints);
    sigs.forEach(s => { s._conv = Math.abs(s.predProb - 0.5); });
    sigs.sort((a, b) => b._conv - a._conv);
    const fmt = s => ({
      sym: s.sym,
      last: s.last,
      predProb: +s.predProb.toFixed(4),
      dir: s.predProb >= 0.5 ? 'UP' : 'DOWN',
      conviction: +(s._conv * 2).toFixed(3),   // 0..1 (0 = coin flip, 1 = certain)
      pct_up: Math.round(s.predProb * 100),
      changePct: s.changePct != null ? +(+s.changePct).toFixed(2) : null,
      rvol: s.rvol != null ? +(+s.rvol).toFixed(2) : null,
      signal: s.signal || null,
      reason: s.reason || null
    });
    const alpha = sigs.filter(s => (s._conv * 2) >= constraints.min_conviction).slice(0, constraints.alpha_max).map(fmt);
    // Pick of the Day = highest-conviction constraint-passing call, but only if it
    // clears potd_min_conviction (so a flat tape doesn't force a junk pick).
    const potdSig = sigs.length && (sigs[0]._conv * 2) >= constraints.potd_min_conviction ? sigs[0] : null;
    // Best Long = the single most bullish constraint-passing name, so there is
    // ALWAYS an actionable long even when the top-conviction pick is a DOWN call.
    // `weak` flags that even the best lean is below the 0.52 UP threshold.
    const longs = sigs.slice().sort((a, b) => b.predProb - a.predProb);
    const bestLongSig = longs.length ? longs[0] : null;
    const best_long = bestLongSig
      ? Object.assign(fmt(bestLongSig), { weak: bestLongSig.predProb < 0.52 })
      : null;
    return json({
      ok: true,
      updatedAt: snap.updatedAt || 0,
      ageSec: snap.updatedAt ? Math.floor((Date.now() - snap.updatedAt) / 1000) : null,
      universe_scored: allSigs.length,        // how many names the brain scored
      universe_size: sigs.length,             // how many passed the constraints (broadcastable)
      filtered_out: allSigs.length - sigs.length, // noise removed by constraints
      constraints,                            // the constraints in force (transparency)
      pick_of_day: potdSig ? fmt(potdSig) : null,
      best_long,
      alpha,
      note: 'Pick of the Day = the brain’s single highest-conviction 5-day call among names that pass your constraints (can be UP or DOWN). Best Long = the single most bullish passing name (weak=true means no real long edge today). Alpha = top passing leans. Constraints are editable at /brain/constraints; the brain still trains on the FULL universe — constraints only govern what gets broadcast. Records are in /brain/confluence-score; which conditions actually carry edge is in /brain/segments.'
    });
  }

  if (path === '/brain/constraints') {
    // Pass 258: read (public) or update (admin) the broadcast noise-control
    // constraints. GET is open so the website + anyone can see exactly what
    // filters are in force (transparency). POST requires the admin token.
    if (request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      if (auth !== 'Bearer ' + env.ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);
      let patch;
      try { patch = await request.json(); } catch (e) { return json({ error: 'invalid JSON body' }, 400); }
      if (url.searchParams.get('reset') === '1') {
        const fresh = defaultConstraints();
        fresh.updatedAt = Date.now();
        fresh.updatedBy = 'reset';
        await kvPut(env, KV_KEYS.CONSTRAINTS, fresh);
        return json({ ok: true, reset: true, constraints: fresh });
      }
      const current = await loadConstraints(env);
      const next = sanitizeConstraints(patch || {}, current);
      next.updatedAt = Date.now();
      next.updatedBy = 'admin';
      await kvPut(env, KV_KEYS.CONSTRAINTS, next);
      return json({ ok: true, constraints: next });
    }
    const c = await loadConstraints(env);
    return json({ ok: true, constraints: c, defaults: defaultConstraints(), universe: UNIVERSE, note: 'Edit these at constraints.html. They govern what becomes a Pick of the Day / Alpha / Best Long. The brain trains on the full universe regardless; this is purely noise control on what gets surfaced.' });
  }

  if (path === '/brain/segments') {
    // Pass 258: which conditions actually carry edge — the brain's learned map of
    // signal vs noise. Two views: (1) live = the graded forward record (accrues
    // over weeks, same log the Edge Scorecard uses); (2) backtest = the held-out
    // test pairs (thousands, available now) bucketed by conviction.
    const [log, heldoutRaw] = await Promise.all([
      kvGet(env, 'confluence_log_v1', []),
      kvGet(env, KV_KEYS.HELDOUT, [])
    ]);
    const liveSeg = confluenceSegments(log);
    return json(Object.assign({ ok: true, live: liveSeg, backtest: backtestSegments(heldoutRaw) }, liveSeg));
  }

  if (path === '/brain/research') {
    // Pass 264: what the features CAN predict — the "hunt for real signal" result.
    const r = await kvGet(env, KV_KEYS.RESEARCH, null);
    return json(r ? Object.assign({ ok: true }, r) : { ok: false, note: 'no research yet — computed on the next bootstrap' });
  }

  if (path === '/brain/digest-now' && request.method === 'POST') {
    // Pass 257: force-send today's Pick of the Day to the configured Discord
    // webhook RIGHT NOW (bypasses the morning/once-a-day gates). Lets Brandon
    // confirm his webhook works without waiting until 9am. Admin-token gated.
    const auth = request.headers.get('Authorization') || '';
    if (auth !== 'Bearer ' + env.ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);
    const webhook = (env.DISCORD_WEBHOOK_URL || '').trim();
    if (!isDiscordWebhook(webhook)) {
      return json({ ok: false, error: 'DISCORD_WEBHOOK_URL secret not set or invalid. Run: cd worker && npx wrangler secret put DISCORD_WEBHOOK_URL --config wrangler.toml' }, 400);
    }
    const snap = await kvGet(env, KV_KEYS.SIGNALS, { signals: {} });
    const picks = digestPicksFromSnap(snap);
    if (!picks) return json({ ok: false, error: 'not enough fresh signals to build a pick yet (need >=8)' }, 503);
    const res = await postDiscordDigest(env, picks);
    return json({ ok: res.ok, status: res.status || null, potd: picks.potd.sym, best_long: picks.bestLong.sym, note: res.ok ? 'posted to Discord' : 'discord post failed' });
  }

  if (path === '/brain/predict') {
    // Pass 217: ad-hoc prediction for any symbol — useful for browser pages
    // that want a live calibrated probability WITHOUT waiting for the next
    // cron tick to capture it. Pulls fresh Finnhub quote, uses stored bar
    // history for the rich features, applies the current model + Platt.
    // Returns BOTH raw and calibrated probabilities so the caller can pick.
    const sym = (url.searchParams.get('sym') || '').toUpperCase().trim();
    if (!sym) return json({ error: 'missing ?sym=X' }, 400);
    if (!UNIVERSE.includes(sym)) return json({ error: 'symbol not in universe', sym, universe_size: UNIVERSE.length }, 404);
    const [model, barsHistory, platt] = await Promise.all([
      kvGet(env, KV_KEYS.MODEL, newModel()),
      kvGet(env, KV_KEYS.BARS_HISTORY, {}),
      kvGet(env, KV_KEYS.PLATT, null)
    ]);
    const quote = await fetchLiveQuote(env, sym);  // pass 234: Yahoo-primary (carries volume)
    if (!quote) return json({ error: 'live quote unavailable', sym }, 503);
    // Snapshot vix from KV's bar history if available, else default
    const vixBars = barsHistory.VIX;
    const vix = (vixBars && vixBars.length > 0) ? vixBars[vixBars.length - 1].close : 18;
    const history = barsHistory[sym] || [];
    const features = extractRichFeatures(quote, history, { vix });
    const rawProb = predict(model, features);
    const adjProb = applySymBias(rawProb, sym, model);  // pass 234: per-symbol recalibration
    const calibratedProb = applyPlatt(adjProb, platt);
    const conviction = Math.max(calibratedProb, 1 - calibratedProb);
    const direction = calibratedProb >= 0.5 ? 'LONG' : 'SHORT';
    return json({
      sym,
      quote: { last: quote.last, prevClose: quote.prevClose, changePct: quote.changePct, ts: quote.ts },
      predProb: calibratedProb,
      predProbRaw: rawProb,
      plattApplied: !!platt && !platt.rejected && typeof platt.a === 'number' && platt.a >= 0.2,
      conviction,
      direction,
      features,
      bars_in_history: history.length,
      vix,
      model_n_trained: model.n_trained,
      worker_version: WORKER_VERSION
    });
  }

  if (path === '/brain/symbols') {
    // Pass 194: per-symbol breakdown — which symbols brain is good/bad at.
    // Pass 215 (precision): COMBINE both random_split AND walk_forward
    // heldout sets. Each split is ~1,100 examples / ~71 symbols ≈ ~15 per sym,
    // which is too noisy for per-symbol BSS to mean anything (a single
    // 3-for-3 lucky streak gives BSS=+0.5). Combining doubles per-symbol n
    // to ~30 which is the minimum for stable directional inference.
    // Also adds Wilson-interval-style CI on accuracy and exposes `stable`
    // flag (n >= MIN_N_STABLE) so the UI can filter out noise rows.
    const MIN_N_STABLE = 10;  // below this, per-sym stats are noise
    const heldoutRaw = await kvGet(env, KV_KEYS.HELDOUT, []);
    const journal = await kvGet(env, KV_KEYS.JOURNAL, []);
    let pairs;
    if (Array.isArray(heldoutRaw)) {
      pairs = heldoutRaw;
    } else {
      const rs = Array.isArray(heldoutRaw.random_split) ? heldoutRaw.random_split : [];
      const wf = Array.isArray(heldoutRaw.walk_forward) ? heldoutRaw.walk_forward : [];
      pairs = rs.concat(wf);
    }
    const bySym = {};
    for (const item of pairs) {
      if (!item || typeof item !== 'object') continue;
      const { p, y, sym } = item;
      if (!sym) continue;
      if (typeof p !== 'number' || typeof y !== 'number') continue;
      if (!Number.isFinite(p) || !Number.isFinite(y)) continue;
      if (!bySym[sym]) bySym[sym] = { n: 0, correct: 0, brierSum: 0 };
      bySym[sym].n++;
      if ((p >= 0.5 ? 1 : 0) === y) bySym[sym].correct++;
      bySym[sym].brierSum += (p - y) * (p - y);
    }
    // Pass 218k/227: per-symbol live stats key on MID resolution (5d) ONLY —
    // that's the horizon the brain trains and predicts on (pass 218/226). The
    // pre-227 code fell back to SHORT (1d) "for legacy entries", but in practice
    // that fired for EVERY entry younger than the 5d horizon (short resolves at
    // 24h, mid at 168h), silently reporting 1-day outcomes and mixing horizons
    // in one accuracy number. Mid-only keeps it honest; entries with no mid
    // resolution yet are simply excluded until they mature. Skip 'flat'.
    function liveOutcomeOf(e) {
      if (!e || !e.resolved || typeof e.resolved !== 'object') return null;
      const o = e.resolved.mid;
      if (!o || o === false || o === 'flat') return null;
      return o;
    }
    const live = (Array.isArray(journal) ? journal : []).filter(e => liveOutcomeOf(e));
    const liveBySym = {};
    for (const e of live) {
      if (!liveBySym[e.sym]) liveBySym[e.sym] = { n: 0, correct: 0 };
      liveBySym[e.sym].n++;
      if (liveOutcomeOf(e) === 'correct') liveBySym[e.sym].correct++;
    }
    // Wilson 95% lower-bound on accuracy. For symbols with small n, the
    // lower bound is dramatically below the point estimate — gives the UI
    // a way to rank by "conservatively edge-positive" instead of by raw
    // BSS where a 3-for-3 streak looks identical to a 30-for-40 record.
    function wilsonLower(correct, n) {
      if (n === 0) return 0;
      const p = correct / n;
      const z = 1.96;  // 95% CI
      const denom = 1 + (z * z) / n;
      const center = p + (z * z) / (2 * n);
      const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
      return Math.max(0, (center - margin) / denom);
    }
    const rows = Object.entries(bySym).map(([sym, v]) => ({
      sym,
      heldout_n: v.n,
      heldout_acc: +(v.correct / v.n).toFixed(4),
      heldout_acc_lower95: +wilsonLower(v.correct, v.n).toFixed(4),
      heldout_bss: +(1 - (v.brierSum / v.n) / 0.25).toFixed(4),
      stable: v.n >= MIN_N_STABLE,  // pass 215: trustworthy sample size flag
      live_n: liveBySym[sym] ? liveBySym[sym].n : 0,
      live_acc: liveBySym[sym] && liveBySym[sym].n > 0 ? +(liveBySym[sym].correct / liveBySym[sym].n).toFixed(4) : null
    })).sort((a, b) => b.heldout_bss - a.heldout_bss);
    const stableCount = rows.filter(r => r.stable).length;
    return json({
      symbols: rows,
      total: rows.length,
      stable_count: stableCount,
      min_n_stable: MIN_N_STABLE,
      note: 'BSS is noise-dominated for symbols with n < ' + MIN_N_STABLE + '. UI should sort/filter by `stable` flag.'
    });
  }

  if (path === '/brain/metrics') {
    // Pass 191-192: real signal-vs-noise metrics from BOTH random-split
    // held-out (stationary upper bound) AND walk-forward (honest trading test).
    const heldoutRaw = await kvGet(env, KV_KEYS.HELDOUT, []);
    const journal = await kvGet(env, KV_KEYS.JOURNAL, []);
    // Backwards-compat: pass 191 stored a flat array; pass 192 stores
    // { random_split, walk_forward }.
    const heldout = Array.isArray(heldoutRaw) ? heldoutRaw : (heldoutRaw.random_split || []);
    const walkForwardSet = !Array.isArray(heldoutRaw) ? (heldoutRaw.walk_forward || []) : [];

    function computeMetrics(pairs) {
      // Pass 201: filter out malformed entries (null, non-numeric p/y) before
      // computing — destructure-null would throw, NaN p/y would poison brier.
      const valid = (Array.isArray(pairs) ? pairs : []).filter(it =>
        it && typeof it === 'object' &&
        typeof it.p === 'number' && Number.isFinite(it.p) &&
        typeof it.y === 'number' && Number.isFinite(it.y));
      if (valid.length === 0) return null;
      let correct = 0, brierSum = 0;
      const bins = Array(10).fill(0).map(() => ({ n: 0, sum_y: 0, sum_p: 0 }));
      for (const { p, y } of valid) {
        if ((p >= 0.5 ? 1 : 0) === y) correct++;
        brierSum += (p - y) * (p - y);
        const bin = Math.min(9, Math.floor(p * 10));
        bins[bin].n++;
        bins[bin].sum_y += y;
        bins[bin].sum_p += p;
      }
      const brier = brierSum / valid.length;
      const bss = 1 - (brier / 0.25);
      let ece = 0;
      for (const b of bins) {
        if (b.n === 0) continue;
        const actualRate = b.sum_y / b.n;
        const meanProb = b.sum_p / b.n;
        ece += (b.n / valid.length) * Math.abs(actualRate - meanProb);
      }
      const acc = correct / valid.length;
      const z = (acc - 0.5) / Math.sqrt(0.25 / valid.length);
      const pValue = 2 * (1 - normalCdf(Math.abs(z)));
      // Pass 266 (honest skill vs drift): the relevant baseline is NOT a coin flip,
      // it's "always predict the majority direction" (the drift base rate). Dense
      // direction can score 54% just by riding an up-market. skill_above_base is the
      // accuracy MINUS that naive baseline — that's the real timing edge. We test
      // significance against the base rate, not 0.5, so beta is not sold as alpha.
      const meanY = valid.reduce((s, it) => s + it.y, 0) / valid.length;
      const baseRate = Math.max(meanY, 1 - meanY);
      const skill = acc - baseRate;
      const zBase = Math.sqrt(baseRate * (1 - baseRate) / valid.length) > 0
        ? skill / Math.sqrt(baseRate * (1 - baseRate) / valid.length) : 0;
      const pBase = 2 * (1 - normalCdf(Math.abs(zBase)));
      return {
        n: valid.length,
        accuracy: +acc.toFixed(4),
        base_rate: +baseRate.toFixed(4),               // pass 266: naive "predict the drift" accuracy
        skill_above_base: +skill.toFixed(4),           // pass 266: real timing edge = accuracy - base_rate
        beats_base_rate_95: pBase < 0.05 && skill > 0, // pass 266: is the edge above drift, not just above a coin flip?
        brier: +brier.toFixed(4),
        bss: +bss.toFixed(4),
        ece: +ece.toFixed(4),
        z_score: +z.toFixed(3),
        p_value: +pValue.toFixed(4),
        significant: pValue < 0.05,
        verdict: skill > 0.02 && pBase < 0.05 ? 'REAL SIGNAL (beats drift)' : (skill > 0 ? 'MOSTLY DRIFT (little timing edge)' : 'BELOW BASELINE')
      };
    }

    const randomMetrics = computeMetrics(heldout);
    const walkForwardMetrics = computeMetrics(walkForwardSet);

    // ---- Live journal metrics (from resolved captures) ----
    // Pass 218k: prefer MID (5d) resolution since the brain trains on that
    // post-pass-218. Fall back to SHORT for legacy entries. Skip 'flat'.
    // Pass 227: MID (5d) only — the trained/predicted horizon. Was mid||short,
    // which reported 1-day outcomes for any entry younger than the 5d horizon,
    // mixing horizons in the live accuracy number. Honest = 5d-only.
    function liveResolvedOutcome(e) {
      if (!e || !e.resolved || typeof e.resolved !== 'object') return null;
      const o = e.resolved.mid;
      if (!o || o === false || o === 'flat') return null;
      return o;
    }
    const resolved = journal.filter(e => liveResolvedOutcome(e));
    let liveMetrics = null;
    if (resolved.length > 0) {
      let correct = 0, brierSum = 0;
      for (const e of resolved) {
        const outcome = liveResolvedOutcome(e);
        if (outcome === 'correct') correct++;
        const y = outcome === 'correct' ? (e.predProb >= 0.5 ? 1 : 0) : (e.predProb >= 0.5 ? 0 : 1);
        brierSum += (e.predProb - y) * (e.predProb - y);
      }
      const total = resolved.length;
      const acc = correct / total;
      const brier = brierSum / total;
      liveMetrics = {
        n: total,
        accuracy: +acc.toFixed(4),
        brier: +brier.toFixed(4),
        bss: +(1 - brier / 0.25).toFixed(4),
        captures_pending: journal.length - total
      };
    }

    return json({
      heldout_test: randomMetrics,           // random 80/20 split (stationary estimate)
      walk_forward_test: walkForwardMetrics, // time-ordered split (honest trading test)
      live_resolved: liveMetrics,
      total_captures: journal.length,
      timestamp: Date.now()
    });
  }

  if (path === '/brain/debug/fetch') {
    // No auth — only returns metadata, useful for debugging which sources work
    const sym = url.searchParams.get('sym') || 'AAPL';
    const results = {};
    // Test each source independently
    try {
      const yh = await fetchYahooHistorical(sym, 250);
      results.yahoo = { ok: !!yh, count: yh ? yh.length : 0, first: yh ? yh[0] : null };
    } catch (e) { results.yahoo = { error: String(e) }; }
    try {
      const sq = await fetchStooqHistorical(sym, 250);
      results.stooq = { ok: !!sq, count: sq ? sq.length : 0, first: sq ? sq[0] : null };
    } catch (e) { results.stooq = { error: String(e) }; }
    // Pass 230: verify the LIVE quote carries volume (the whole point of the
    // Yahoo switch — Finnhub /quote never had it, so live RVOL was always 0).
    try {
      const lq = await fetchYahooQuote(sym);
      results.live_quote = lq ? { last: lq.last, volume: lq.volume, has_volume: (lq.volume || 0) > 0, source: lq.priceSource } : { ok: false };
    } catch (e) { results.live_quote = { error: String(e) }; }
    // Pass 246: probe Finnhub too, so we can compare which source is ACCURATE.
    try {
      const fq = await fetchFinnhubQuote(env, sym);
      results.finnhub_quote = fq ? { last: fq.last, prevClose: fq.prevClose, changePct: fq.changePct } : { ok: false, note: 'finnhub returned null (key missing/invalid or symbol unsupported)' };
    } catch (e) { results.finnhub_quote = { error: String(e) }; }
    // Raw Yahoo response status check
    try {
      let yhSym = sym;
      if (sym === 'BTC') yhSym = 'BTC-USD';
      else if (sym === 'ETH') yhSym = 'ETH-USD';
      else if (sym === 'VIX') yhSym = '^VIX';
      const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yhSym) + '?range=1y&interval=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      results.yahoo_raw_status = r.status;
      results.yahoo_raw_body_first200 = (await r.text()).slice(0, 200);
    } catch (e) { results.yahoo_raw_status = 'err:' + e.message; }
    return json(results);
  }

  if (path === '/brain/bootstrap' && request.method === 'POST') {
    // Auth check
    const auth = request.headers.get('Authorization') || '';
    if (auth !== 'Bearer ' + env.ADMIN_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }
    // Pass 218n: optional ?clear=1 wipes the JOURNAL before bootstrap. Useful
    // after a botched calibration period — the existing journal entries have
    // predProb from a corrupted model and would still get resolved + trained
    // on (using their bad predProb to determine direction). Clearing forces
    // a fresh start: new model + fresh journal + fresh Platt fit. Safe
    // because the BARS_HISTORY (needed for live richFeatures) and HELDOUT
    // (used by /brain/metrics) are preserved; only the live capture log
    // gets wiped.
    let journalClearRequested = false;
    if (url.searchParams.get('clear') === '1') {
      // Pass 221: don't write JOURNAL=[] directly — a concurrent cron tick
      // races us and overwrites it (KV last-write-wins). Instead set a flag
      // that the next tick honors inside its own atomic read-modify-write.
      // Also write [] now as a best-effort head start; the flag guarantees
      // the wipe even if this write loses the race.
      await kvPut(env, KV_KEYS.JOURNAL, []);
      await kvPut(env, KV_KEYS.CLEAR_FLAG, { requestedAt: Date.now() });
      journalClearRequested = true;
    }
    // Pull 250 days of historical bars for each symbol, train on them
    const result = await runBootstrap(env);
    result.journal_clear_requested = journalClearRequested;
    result.journal_clear_note = journalClearRequested
      ? 'Journal wipe flagged — the next cron tick (<=60s) applies it atomically.'
      : undefined;
    return json(result);
  }

  if (path === '/brain/tick' && request.method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    if (auth !== 'Bearer ' + env.ADMIN_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }
    const r = await tick(env);
    return json(r);
  }

  return json({ error: 'not found', paths: ['/brain/health', '/brain/state', '/brain/journal', '/brain/model', '/brain/metrics', '/brain/symbols', '/brain/champions', '/brain/learning', '/brain/signals', '/brain/predict?sym=X', '/brain/debug/fetch?sym=X', '/brain/bootstrap (POST)', '/brain/tick (POST)', '/auth/register (POST)', '/auth/login (POST)', '/auth/me', '/auth/logout (POST)', '/auth/prefs (POST)'] }, 404);
}

async function runBootstrap(env) {
  // Pass 208 (CRITICAL): start from a fresh model EVERY bootstrap call.
  // Previously this loaded the existing KV model and trained on top of it,
  // so successive bootstraps accumulated weights from prior runs — each
  // bootstrap was actually "5 more epochs on top of whatever was there".
  // The random-split BSS was measuring "did the latest fine-tune help"
  // not "does the model have signal from scratch". The wfModel above
  // was already fresh per call; only the main model leaked.
  // Result of the bug: pass 207's L2=0.001 looked like it had no effect
  // because the model was stuck at the pre-L2 equilibrium.
  const model = newModel();
  const trainingExamples = [];
  const researchExamples = [];  // pass 264: every bar + its raw 5d return, for the signal-research backtest
  let symbolsFetched = 0;
  const errors = [];
  // Pass 193: seed per-sym bar history so live tick has the same context
  // the bootstrap trained on. Each symbol's last 40 bars stored.
  const barsHistory = {};

  // Pass 191: richer feature extractor for bootstrap. Uses 14 historical
  // bars of context to compute real TA indicators (RSI, ATR, momentum,
  // range position, SMA distance) instead of mostly-constant features.
  function richFeatures(bars, i) {
    const f = new Array(22).fill(0.5);
    if (i < 14) return f;
    const today = bars[i];
    let gains = 0, losses = 0;
    for (let k = i - 13; k <= i; k++) {
      const d = bars[k].close - bars[k-1].close;
      if (d > 0) gains += d; else losses -= d;
    }
    const rs = (gains + losses) > 0 ? gains / (gains + losses) : 0.5;
    f[0] = clamp(rs, 0, 1);
    f[1] = clamp(((today.high - today.low) / today.close) * 50, 0, 1);
    let atrSum = 0;
    for (let k = i - 13; k <= i; k++) atrSum += (bars[k].high - bars[k].low) / bars[k].close;
    f[2] = clamp((atrSum / 14) * 100, 0, 1);
    const chg = (today.close - bars[i-1].close) / bars[i-1].close;
    f[5] = clamp((chg + 0.05) / 0.10, 0, 1);
    if (i >= 5) {
      const mom5 = (today.close - bars[i-5].close) / bars[i-5].close;
      f[3] = clamp((mom5 + 0.10) / 0.20, 0, 1);
    }
    if (i >= 20) {
      const mom20 = (today.close - bars[i-20].close) / bars[i-20].close;
      f[4] = clamp((mom20 + 0.20) / 0.40, 0, 1);
    }
    let volSum = 0;
    for (let k = i - 13; k <= i; k++) volSum += bars[k].volume || 0;
    const avgVol = volSum / 14;
    const rvol = avgVol > 0 ? (today.volume || 0) / avgVol : 1;
    f[6] = clamp(rvol / 3, 0, 1);
    let hi14 = -Infinity, lo14 = Infinity;
    for (let k = i - 13; k <= i; k++) {
      if (bars[k].high > hi14) hi14 = bars[k].high;
      if (bars[k].low < lo14) lo14 = bars[k].low;
    }
    if (hi14 > lo14) f[7] = (today.close - lo14) / (hi14 - lo14);
    let sma14 = 0;
    for (let k = i - 13; k <= i; k++) sma14 += bars[k].close;
    sma14 /= 14;
    f[8] = clamp(((today.close - sma14) / sma14 + 0.10) / 0.20, 0, 1);
    const dow = new Date(today.ts).getUTCDay();
    f[19] = (dow % 5) / 5;
    addStabilityFeatures(f, bars, i);  // pass 261: f[9]-f[14] (shared with live tick — no skew)
    f[21] = 1;
    return f;
  }

  // Pass 211: still fetch 250 bars (so richFeatures has 14-day RSI lookback
  // even for the oldest training example) but only TRAIN on the most recent
  // BOOTSTRAP_DAYS of them. Pass 210's walk-forward verdict was -0.449
  // because training on bars 9 months old produces a model fit to a
  // bygone regime — recent 50 days are out-of-distribution. Restricting to
  // the most recent 120 days means walk-forward train ≈ months 2-5 prior
  // and walk-forward test ≈ the last month, both of which should share
  // closer regime characteristics. If THIS still fails, the conclusion is
  // definitive: the features genuinely don't predict 5d direction even
  // when training distribution matches test distribution.
  const BOOTSTRAP_DAYS = 120;
  for (const sym of UNIVERSE) {
    const bars = await fetchHistoricalBars(env, sym, 250);
    if (!bars || bars.length < 30) {
      errors.push({ sym, reason: 'no-bars' });
      continue;
    }
    symbolsFetched++;
    // Pass 193: seed bar history for this symbol with the last 40 bars
    barsHistory[sym] = bars.slice(-40).map(b => ({
      ts: b.ts,
      dayKey: new Date(b.ts).getUTCFullYear() * 10000 + (new Date(b.ts).getUTCMonth() + 1) * 100 + new Date(b.ts).getUTCDate(),
      open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume
    }));
    // Pass 206: pivot the prediction problem to a tractable one.
    // OLD: predict next-day direction at ±0.3% threshold. On liquid stocks
    //      this is famously near-random — most days are noise around the
    //      mean, and a 30bp threshold barely separates signal from drift.
    //      Result: heldout_bss ≈ 0 (no edge).
    // NEW: predict 5-day forward direction at ±1% threshold. Standard
    //      swing-trade horizon. Trend persistence is materially stronger
    //      at 5d than 1d, and a 1% threshold filters out random-walk
    //      noise. Labels are sparser (fewer days qualify) but each one
    //      carries real directional information for the brain to learn.
    const FWD_DAYS = 5;
    const LABEL_THRESHOLD = 0;  // pass 264: DENSE 5d direction (every day, up vs down). Backtest: dense 52.4% vs +-1% 45.5% on the same features. Matches HORIZON_MIN_MOVE.mid above (live tick) so no train/serve skew.
    // Pass 211: training loop starts at max(20, bars.length - BOOTSTRAP_DAYS)
    // instead of 20. Still need i >= 14 for richFeatures' RSI lookback;
    // 20 is the safe floor. Older bars still feed richFeatures via the
    // moving-window indices, just don't become training examples themselves.
    const trainStart = Math.max(20, bars.length - BOOTSTRAP_DAYS);
    for (let i = trainStart; i < bars.length - FWD_DAYS; i++) {
      const today = bars[i];
      const future = bars[i + FWD_DAYS];
      const ret = (future.close - today.close) / today.close;
      const features = richFeatures(bars, i);
      researchExamples.push({ features, ret, ts: today.ts });   // pass 264: keep EVERY bar + raw return
      const label = ret > LABEL_THRESHOLD ? 1 : (ret < -LABEL_THRESHOLD ? 0 : null);
      if (label === null) continue;
      trainingExamples.push({ features, label, sym, ts: today.ts });
    }
  }

  // Pass 191: 80/20 split for proper held-out test. Shuffle deterministically
  // so the split is reproducible, train on the first 80%, then evaluate the
  // trained model's predictions on the last 20% (which the model never saw).
  // Store those (predProb, label) pairs in KV for /brain/metrics.
  function seedShuffle(arr, seed) {
    let s = seed;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const j = Math.floor((s / 233280) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // Pass 192: TWO splits — random (leaks future) and time-ordered (honest).
  // Random gives the "stationary data" upper-bound estimate.
  // Time-ordered (train on past, test on future) is the honest trading test.
  const shuffled = seedShuffle(trainingExamples, 42);
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const trainSet = shuffled.slice(0, splitIdx);
  const testSet = shuffled.slice(splitIdx);

  // Time-ordered split for walk-forward validation
  const timeSorted = trainingExamples.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const wfSplitIdx = Math.floor(timeSorted.length * 0.8);
  const wfTrainSet = timeSorted.slice(0, wfSplitIdx);
  const wfTestSet = timeSorted.slice(wfSplitIdx);

  // ============================================================
  // Pass 222: CHAMPION / CHALLENGER competition.
  // The brain no longer trains one fixed config — it trains several model
  // variants (different L2 + epochs), races them on a held-out VALIDATION
  // slice, and promotes the winner as champion. The champion's hyperparams
  // (esp. l2) persist into the saved model so the live tick keeps training
  // with whatever config last won. This is genuine autonomous experimentation:
  // each bootstrap the brain "tries new things" and keeps what works.
  //
  // Honest evaluation: wfTestSet (the last 20% of time, never trained on) is
  // split in half. The FIRST half is the VALIDATION set used to PICK the
  // champion. The SECOND half (wfFinalTest, below) is reported as the
  // champion's honest out-of-sample BSS — never used for selection, so no
  // optimism bias in the headline number.
  const CONFIGS = [
    { name: 'A_balanced', l2: 0.025, epochs: 2 },  // pass-212 baseline
    { name: 'B_light',    l2: 0.010, epochs: 2 },  // less regularization
    { name: 'C_heavy',    l2: 0.050, epochs: 3 },  // more reg + an extra pass
    { name: 'D_deep',     l2: 0.015, epochs: 4 },  // light reg, more epochs
  ];
  // Pass 223: STRIDED validation split (was contiguous first-half/second-half).
  // The pass-222 contiguous split put the entire selection burden on ONE
  // temporal slice. In the first live run that slice (first half of the
  // out-of-sample window) scored 59% while the held-back second half scored
  // 47% — the two halves were simply in different market regimes, so the
  // champion was being picked on whichever regime happened to land first, and
  // the honest final number was pessimistically locked to the last (harder)
  // regime. Strided assignment (even indices -> validation, odd -> final test)
  // makes BOTH sets span the entire out-of-sample period, so champion
  // selection is no longer hostage to a single regime and the honest final
  // number is representative. The sets remain disjoint SAMPLES, so the final
  // report is still selection-free (no leakage). The strict forward-walk
  // metric (wfBss, below) is untouched and still trains-on-past/tests-on-future.
  const wfVal = wfTestSet.filter((_, i) => i % 2 === 0);
  const wfFinalTest = wfTestSet.filter((_, i) => i % 2 === 1);

  function trainConfigModel(cfg, examples) {
    const m = newModel();
    m.l2 = cfg.l2;
    for (let epoch = 0; epoch < cfg.epochs; epoch++) {
      const epochSet = seedShuffle(examples, 1000 + epoch * 7);
      for (const ex of epochSet) trainStep(m, ex.features, ex.label);
    }
    return m;
  }
  function scoreModel(m, pairs) {
    if (!pairs || pairs.length === 0) return { acc: null, brier: null, bss: null, n: 0 };
    let correct = 0, brierSum = 0;
    for (const ex of pairs) {
      const p = predict(m, ex.features);
      if ((p >= 0.5 ? 1 : 0) === ex.label) correct++;
      brierSum += (p - ex.label) * (p - ex.label);
    }
    const n = pairs.length;
    const brier = brierSum / n;
    return { acc: +(correct / n).toFixed(4), brier: +brier.toFixed(4), bss: +(1 - brier / 0.25).toFixed(4), n };
  }

  // Pass 261 (edge stability): pick the champion via FORWARD-CHAINING time-series
  // cross-validation over the ENTIRE training window, pooling every out-of-sample
  // CV prediction into one large, regime-spanning selection sample. Selecting on a
  // single ~551-example validation slice did not transfer (the same model scored
  // 44% on one out-of-sample slice and 58% on another). Pooling thousands of
  // honest train-on-past / test-on-future predictions across folds gives a robust
  // config choice that actually generalizes. The last-20% wfTestSet stays the
  // honest, selection-free reported metric (selection only touches wfTrainSet).
  const K_FOLDS = 5;
  function cvScoreConfig(cfg, examples) {
    const n = examples.length;
    const foldSize = Math.floor(n / K_FOLDS);
    if (foldSize < 30) {
      // too little data for CV — fall back to a single 80/20 forward score
      const cut = Math.floor(n * 0.8);
      return scoreModel(trainConfigModel(cfg, examples.slice(0, cut)), examples.slice(cut));
    }
    let correct = 0, brierSum = 0, total = 0;
    // folds 1..K-1 are each a test window; train only on the strictly-earlier folds.
    for (let k = 1; k < K_FOLDS; k++) {
      const trainPart = examples.slice(0, k * foldSize);
      const testPart = examples.slice(k * foldSize, (k + 1) * foldSize);
      const m = trainConfigModel(cfg, trainPart);
      for (const ex of testPart) {
        const p = predict(m, ex.features);
        if ((p >= 0.5 ? 1 : 0) === ex.label) correct++;
        brierSum += (p - ex.label) * (p - ex.label);
        total++;
      }
    }
    if (!total) return { acc: null, brier: null, bss: null, n: 0 };
    const brier = brierSum / total;
    return { acc: +(correct / total).toFixed(4), brier: +brier.toFixed(4), bss: +(1 - brier / 0.25).toFixed(4), n: total };
  }
  // Race every config: CV score selects the champion; the model is then trained on
  // the full training window for deployment + the honest last-20% test.
  const contenders = CONFIGS.map(cfg => {
    const val = cvScoreConfig(cfg, wfTrainSet);   // robust, pooled out-of-sample CV
    const m = trainConfigModel(cfg, wfTrainSet);
    return { cfg, model: m, val };
  });
  // Pass 260 (CRITICAL — the edge-killer): champion = highest validation
  // DIRECTIONAL ACCURACY, with BSS as the tiebreaker. Selecting on BSS alone once
  // crowned a model with 47.9% accuracy (well-calibrated but barely a coin flip)
  // over two 58%-accuracy contenders — tanking the live edge 53% -> 47%. For a
  // directional UP/DOWN signal whose probabilities are re-calibrated by the Platt
  // layer AFTER selection, accuracy is the metric that determines whether calls go
  // the right way (and it is exactly what the proof page reports). BSS breaks near
  // ties so calibration still matters at the margin.
  const accOf = c => (c.val.acc == null ? -Infinity : c.val.acc);
  const bssOf = c => (c.val.bss == null ? -Infinity : c.val.bss);
  contenders.sort((a, b) => {
    const da = accOf(b) - accOf(a);
    if (Math.abs(da) > 1e-9) return da;
    return bssOf(b) - bssOf(a);
  });
  const champion = contenders[0];
  const championFinal = scoreModel(champion.model, wfFinalTest);  // honest, selection-free
  const leaderboard = contenders.map(c => ({
    name: c.cfg.name, l2: c.cfg.l2, epochs: c.cfg.epochs,
    val_bss: c.val.bss, val_acc: c.val.acc, val_n: c.val.n,
    is_champion: c === champion
  }));

  // Pass 222: the PRODUCTION model is the champion CONFIG retrained on the
  // random-split trainSet (the existing 80% used for the random-split
  // heldout test below). Same config that won the time-ordered competition,
  // trained on the larger random-split sample for the live model.
  const N_EPOCHS = champion.cfg.epochs;
  model.l2 = champion.cfg.l2;   // so the live tick trains with the champion's L2
  let lossSum = 0;
  let totalSteps = 0;
  for (let epoch = 0; epoch < N_EPOCHS; epoch++) {
    const epochSet = seedShuffle(trainSet, 42 + epoch);
    for (const ex of epochSet) {
      const { loss } = trainStep(model, ex.features, ex.label);
      lossSum += loss;
      totalSteps++;
    }
  }

  // Test phase — predict on held-out, store pairs for metrics
  const heldout = [];
  let testCorrect = 0;
  let brierSum = 0;
  for (const ex of testSet) {
    const p = predict(model, ex.features);
    heldout.push({ p, y: ex.label, sym: ex.sym });
    if ((p >= 0.5 ? 1 : 0) === ex.label) testCorrect++;
    brierSum += (p - ex.label) * (p - ex.label);
  }
  const testAcc = testSet.length > 0 ? testCorrect / testSet.length : null;
  const brier = testSet.length > 0 ? brierSum / testSet.length : null;
  // Baseline Brier: always predict 0.5 → (0.5 - y)^2 = 0.25 for binary
  const brierBaseline = 0.25;
  const bss = brier != null ? 1 - (brier / brierBaseline) : null;

  // Pass 192: run a SEPARATE walk-forward test on time-ordered split.
  // Train a fresh model on wfTrainSet, test on wfTestSet.
  // This is the honest "trained on past, predicting future" test.
  //
  // Pass 197: train with N_EPOCHS=5 too (was 1). Previously the random-split
  // test reported BSS from a 5-epoch model and the walk-forward test reported
  // BSS from a 1-epoch model — apples-to-oranges. Now both use identical
  // training procedure so the two BSS values are directly comparable, and
  // walk-forward properly reflects how the production model behaves on
  // unseen future data.
  // Pass 222: wfModel uses the CHAMPION config (same L2 the production model
  // will run), so the walk-forward metrics reflect the deployed champion.
  const wfModel = newModel();
  wfModel.l2 = champion.cfg.l2;
  for (let epoch = 0; epoch < N_EPOCHS; epoch++) {
    const wfEpochSet = seedShuffle(wfTrainSet, 142 + epoch);
    for (const ex of wfEpochSet) trainStep(wfModel, ex.features, ex.label);
  }
  // Pass 234: candidate per-symbol bias from the wf TRAIN set (past), evaluated
  // on the wf TEST set (future) — honest, no leakage. We compute BOTH raw and
  // bias-adjusted predictions, decide whether to keep the bias (guard), then
  // build walkForward from the KEPT prediction so Platt (fit downstream from
  // walkForward) calibrates the SAME distribution production uses. Pass 234b:
  // this is the fix for double-calibration — earlier Platt was fit on raw
  // outputs but applied after symBias live, stacking two base-rate shifts and
  // pushing every symbol bearish (~0.35). Now the chain raw->symBias->Platt is
  // consistent end to end.
  const candidateSymBias = computeSymBias(wfModel, wfTrainSet);
  const biasProbe = { symBias: candidateSymBias };
  const wfRows = [];
  let wfCorrect = 0, wfBrierSum = 0, wfBiasedCorrect = 0, wfBiasedBrierSum = 0;
  for (const ex of wfTestSet) {
    const p = predict(wfModel, ex.features);
    const pB = applySymBias(p, ex.sym, biasProbe);
    wfRows.push({ p, pB, y: ex.label, sym: ex.sym, ts: ex.ts });
    if ((p >= 0.5 ? 1 : 0) === ex.label) wfCorrect++;
    wfBrierSum += (p - ex.label) * (p - ex.label);
    if ((pB >= 0.5 ? 1 : 0) === ex.label) wfBiasedCorrect++;
    wfBiasedBrierSum += (pB - ex.label) * (pB - ex.label);
  }
  const rawWfBrier = wfTestSet.length > 0 ? wfBrierSum / wfTestSet.length : null;
  const wfBiasedBrier = wfTestSet.length > 0 ? wfBiasedBrierSum / wfTestSet.length : null;
  // GUARD: keep the per-symbol bias only if it doesn't worsen held-back Brier
  // (same discipline as the pass-220 Platt guard). Otherwise ship none.
  const symBiasCount = Object.keys(candidateSymBias).length;
  const symBiasKept = symBiasCount > 0 && wfBiasedBrier != null && rawWfBrier != null && wfBiasedBrier <= rawWfBrier + 1e-9;
  model.symBias = symBiasKept ? candidateSymBias : {};
  // walkForward = the production-chain prediction (raw -> symBias if kept).
  const walkForward = wfRows.map(r => ({ p: symBiasKept ? r.pB : r.p, y: r.y, sym: r.sym, ts: r.ts }));
  const wfAcc = wfTestSet.length > 0 ? (symBiasKept ? wfBiasedCorrect : wfCorrect) / wfTestSet.length : null;
  const wfBrier = symBiasKept ? wfBiasedBrier : rawWfBrier;
  const wfBss = wfBrier != null ? 1 - (wfBrier / 0.25) : null;
  const wfBiasedAcc = wfTestSet.length > 0 ? wfBiasedCorrect / wfTestSet.length : null;

  // Pass 213: Platt calibration. Walk-forward is split in half — first 50%
  // (time-earlier) becomes the CALIBRATION set used to fit Platt (a, b);
  // last 50% becomes the FINAL TEST set on which calibrated metrics are
  // reported. This keeps the calibration honest — no train-on-test leakage.
  // Platt also gets persisted to KV so live tick can apply it to new
  // predictions before journaling. Live consumers (brain-proof, brain-bet,
  // etc.) read `predProb` which is the calibrated probability.
  // Pass 224: STRIDED calibration split (was contiguous), mirroring pass-223's
  // champion split. Fitting Platt on the first contiguous half and testing the
  // keep/reject guard on the second half made BOTH hostage to a single regime
  // (the same 59%/47% split that fooled champion selection). Strided assignment
  // makes the Platt fit span every regime and the improvement guard's decision
  // representative — while the two sets stay disjoint (no train-on-test leak).
  const calibSet = walkForward.filter((_, i) => i % 2 === 0);
  const finalTestSet = walkForward.filter((_, i) => i % 2 === 1);
  let platt = fitPlatt(calibSet);

  // Apply candidate Platt to the held-back final test set and measure.
  // Pass 224: also track RAW directional correctness on this same set, so the
  // calibrated-vs-raw comparison reported below is apples-to-apples.
  let wfCalCorrect = 0, wfCalBrierSum = 0, rawBrierSum = 0, rawFinalCorrect = 0;
  for (const pair of finalTestSet) {
    const pCal = applyPlatt(pair.p, platt);
    if ((pCal >= 0.5 ? 1 : 0) === pair.y) wfCalCorrect++;
    if ((pair.p >= 0.5 ? 1 : 0) === pair.y) rawFinalCorrect++;
    wfCalBrierSum += (pCal - pair.y) * (pCal - pair.y);
    rawBrierSum += (pair.p - pair.y) * (pair.p - pair.y);  // raw, for comparison
  }
  let wfCalAcc = finalTestSet.length > 0 ? wfCalCorrect / finalTestSet.length : null;
  let wfCalBrier = finalTestSet.length > 0 ? wfCalBrierSum / finalTestSet.length : null;
  let wfCalBss = wfCalBrier != null ? 1 - (wfCalBrier / 0.25) : null;
  const rawFinalBrier = finalTestSet.length > 0 ? rawBrierSum / finalTestSet.length : null;
  const rawFinalAcc = finalTestSet.length > 0 ? rawFinalCorrect / finalTestSet.length : null;
  const rawFinalBss = rawFinalBrier != null ? 1 - (rawFinalBrier / 0.25) : null;

  // Pass 220 (smarter guard): only KEEP the Platt fit if it actually improves
  // the held-back final-test Brier vs raw. Pass 214 rejected inversions
  // (a < 0.2), but a "valid" fit (a≈1, b≠0) can still HURT on regime-shifting
  // data — the May-27 bootstrap showed a=1.03/b=0.22 dropping walk-forward
  // accuracy from 51.7% (raw) to 47.2% (calibrated). Calibration should never
  // make the held-back test WORSE. If it does, reject and ship identity.
  if (platt && !platt.rejected && rawFinalBrier != null && wfCalBrier != null
      && wfCalBrier >= rawFinalBrier) {
    platt = {
      rejected: true,
      reason: 'no-improvement-on-final-test',
      fittedA: platt.a, fittedB: platt.b, n: platt.n,
      raw_final_brier: +rawFinalBrier.toFixed(4),
      calibrated_final_brier: +wfCalBrier.toFixed(4),
      fittedAt: Date.now()
    };
    // Recompute "calibrated" metrics as identity on the SAME final-test set
    // (since we're shipping raw): they equal the raw-final-test metrics. Pass
    // 224: use rawFinalAcc (this set), not wfAcc (the full set) — apples-to-apples.
    wfCalAcc = rawFinalAcc;
    wfCalBrier = rawFinalBrier;
    wfCalBss = rawFinalBss;
  }

  // Pass 222: persist the champion/challenger leaderboard for /brain/champions
  // and the brain-proof UI. Records which config won, its honest held-back
  // BSS, and the full field so you can see the competition each bootstrap.
  // Pass 260 (CRITICAL — protect the edge): do NOT let a bad-regime re-bootstrap
  // overwrite a good live model. The weekly re-competition once tanked the
  // walk-forward edge 53% -> 47% by deploying "the best of a bad batch" with no
  // comparison to the deployed model. Compare the new champion's walk-forward
  // accuracy to the incumbent's; only promote if it is at least as good (within a
  // small noise tolerance — a thin edge is noisy, so allow legit regime updates
  // within 1.5pp but reject clear drops). BARS_HISTORY (raw data) + the champion
  // leaderboard always update for observability; MODEL/HELDOUT/PLATT only on promote.
  // Pass 264: SIGNAL RESEARCH — what CAN these features predict? Direction is
  // ~random, so test alternative targets on the SAME features with an honest
  // time-ordered split: (a) VOLATILITY — will |5d move| exceed the median?
  // (tradeable via straddles); (b) DENSE DIRECTION — up vs down at a 0% threshold
  // (more samples than the +-1% training label). acc well above 0.50 = a real,
  // tradeable signal the brain should be pointed at instead of forcing direction.
  function researchScore(examples, labelFn) {
    const data = [];
    for (const e of examples) { const y = labelFn(e); if (y === 0 || y === 1) data.push({ f: e.features, y }); }
    if (data.length < 100) return { n: data.length, acc: null };
    const cut = Math.floor(data.length * 0.8);
    const tr = data.slice(0, cut), te = data.slice(cut);   // time-ordered (examples pre-sorted by ts)
    const rm = newModel(); rm.l2 = 0.02;
    for (let ep = 0; ep < 3; ep++) for (const d of tr) trainStep(rm, d.f, d.y);
    let correct = 0;
    for (const d of te) if (((predict(rm, d.f) >= 0.5) ? 1 : 0) === d.y) correct++;
    return { n: data.length, test_n: te.length, acc: te.length ? +(correct / te.length).toFixed(4) : null };
  }
  researchExamples.sort((a, b) => (a.ts || 0) - (b.ts || 0));   // honest time order for the split
  const absR = researchExamples.map(e => Math.abs(e.ret)).sort((a, b) => a - b);
  const medAbs = absR.length ? absR[Math.floor(absR.length / 2)] : 0;
  // Pass 265: base-rate honesty check. Dense direction can be inflated by market
  // drift — if up-days outnumber down-days, "always predict up" beats 50% with no
  // skill. So we report the test-window up-rate and the SKILL ABOVE that naive
  // baseline. Skill > 0 means the model is doing more than riding the drift.
  const dirCut = Math.floor(researchExamples.length * 0.8);
  const testEx = researchExamples.slice(dirCut);
  const upRate = testEx.length ? testEx.filter(e => e.ret > 0).length / testEx.length : null;
  const naiveBase = upRate != null ? Math.max(upRate, 1 - upRate) : null;
  const denseRes = researchScore(researchExamples, e => e.ret > 0 ? 1 : (e.ret < 0 ? 0 : null));
  const research = {
    fittedAt: Date.now(),
    median_abs_5d_move_pct: +(medAbs * 100).toFixed(2),
    volatility: researchScore(researchExamples, e => Math.abs(e.ret) > medAbs ? 1 : 0),
    direction_dense: denseRes,
    test_up_rate: upRate != null ? +upRate.toFixed(4) : null,
    naive_base_rate: naiveBase != null ? +naiveBase.toFixed(4) : null,
    direction_skill_above_base: (naiveBase != null && denseRes.acc != null) ? +(denseRes.acc - naiveBase).toFixed(4) : null,
    direction_1pp_walk_forward_acc: (typeof wfAcc === 'number' && isFinite(wfAcc)) ? +wfAcc.toFixed(4) : null,
    note: 'What the SAME features predict, honest time-ordered split. direction_dense = up vs down at 0% threshold; direction_skill_above_base subtracts the naive "always predict the majority direction" baseline (naive_base_rate) so drift is not mistaken for skill. volatility = will the 5-day move be big? Backtest evidence, not a live forward test.'
  };
  const prevChamps = await kvGet(env, KV_KEYS.CHAMPIONS, null);
  const incumbentWf = prevChamps && typeof prevChamps.champion_wf_acc === 'number' ? prevChamps.champion_wf_acc : null;
  const newWf = (typeof wfAcc === 'number' && isFinite(wfAcc)) ? wfAcc : null;
  const PROMOTE_TOL = 0.015;
  let promote = true, promoteReason = 'no incumbent baseline — deploying';
  if (incumbentWf != null && newWf != null) {
    if (newWf >= incumbentWf - PROMOTE_TOL) { promote = true; promoteReason = 'new wf ' + newWf.toFixed(4) + ' >= incumbent ' + incumbentWf.toFixed(4) + ' - tol'; }
    else { promote = false; promoteReason = 'KEPT incumbent: new wf ' + newWf.toFixed(4) + ' worse than incumbent ' + incumbentWf.toFixed(4); }
  }
  const championRecord = {
    fittedAt: Date.now(),
    champion: champion.cfg.name,
    champion_l2: champion.cfg.l2,
    champion_epochs: champion.cfg.epochs,
    champion_val_bss: champion.val.bss,
    champion_final_bss: championFinal.bss,       // honest, never used for selection
    champion_final_acc: championFinal.acc,
    champion_final_n: championFinal.n,
    champion_wf_acc: promote ? newWf : incumbentWf,   // pass 260: the DEPLOYED model's walk-forward acc
    candidate_wf_acc: newWf,                          // pass 260: what this run produced
    promoted: promote,                                // pass 260
    promote_reason: promoteReason,                    // pass 260
    leaderboard,
    note: 'Champion picked by pooled forward-chaining CV accuracy over the whole training window (robust/transferable); promotion guarded by walk-forward acc vs the deployed model so a bad-regime re-bootstrap cannot regress the live edge.'
  };

  const writes = [
    kvPut(env, KV_KEYS.BARS_HISTORY, barsHistory),   // pass 193: raw data, model-independent
    kvPut(env, KV_KEYS.CHAMPIONS, championRecord),    // pass 222/260
    kvPut(env, KV_KEYS.RESEARCH, research)            // pass 264: signal-research backtest
  ];
  if (promote) {
    writes.push(kvPut(env, KV_KEYS.MODEL, model));
    writes.push(kvPut(env, KV_KEYS.HELDOUT, { random_split: heldout, walk_forward: walkForward }));
    writes.push(kvPut(env, KV_KEYS.PLATT, platt));   // pass 213/220
  }
  await Promise.all(writes);

  return {
    ok: true,
    symbolsFetched,
    trainingExamples: trainingExamples.length,
    trainSize: trainSet.length,
    testSize: testSet.length,
    errors: errors.length,
    // Pass 225: divide by totalSteps (N_EPOCHS * trainSet.length), not
    // trainSet.length. lossSum accumulates over every epoch, so dividing by one
    // epoch's example count inflated avgLoss by the epoch count — which made it
    // jump 1.43 -> 2.15 when champion C_heavy (3 epochs) won vs the old fixed
    // 2-epoch config, despite identical true per-example loss (~0.72). With the
    // champion's epochs now variable (2/3/4), this is the difference between a
    // comparable metric and one that swings purely on epoch count.
    avgLoss: totalSteps ? lossSum / totalSteps : null,
    final_n_trained: model.n_trained,
    // Pass 222: champion/challenger results
    champion: champion.cfg.name,
    champion_config: { l2: champion.cfg.l2, epochs: champion.cfg.epochs },
    champion_final_bss: championFinal.bss,
    champion_final_acc: championFinal.acc,
    leaderboard,
    heldout_test_accuracy: testAcc,
    heldout_brier: brier,
    heldout_bss: bss,
    walk_forward_accuracy: wfAcc,
    walk_forward_brier: wfBrier,
    walk_forward_bss: wfBss,
    // Pass 213: Platt-calibrated walk-forward metrics on the held-back
    // 50% final test set. If wfCalBss > wfBss, Platt is reducing Brier
    // (better calibration) without sacrificing directional accuracy.
    platt: platt,
    platt_calib_n: calibSet.length,
    walk_forward_calibrated_accuracy: wfCalAcc,
    walk_forward_calibrated_brier: wfCalBrier,
    walk_forward_calibrated_bss: wfCalBss,
    // Pass 224: RAW metrics on the SAME held-back final-test set the calibrated
    // metrics use (NOT the full wfTestSet that walk_forward_* report on) — so
    // calibrated-vs-raw is a fair, same-set comparison. If calibrated_bss >
    // raw_final_bss, Platt genuinely helped on its own held-back data.
    walk_forward_raw_final_accuracy: rawFinalAcc,
    walk_forward_raw_final_brier: rawFinalBrier != null ? +rawFinalBrier.toFixed(4) : null,
    walk_forward_raw_final_bss: rawFinalBss != null ? +rawFinalBss.toFixed(4) : null,
    walk_forward_final_test_n: finalTestSet.length,
    // Pass 234: per-symbol recalibration bias (guarded)
    sym_bias_count: symBiasKept ? symBiasCount : 0,
    sym_bias_candidates: symBiasCount,
    sym_bias_kept: symBiasKept,
    walk_forward_biased_accuracy: wfBiasedAcc,
    walk_forward_biased_brier: wfBiasedBrier != null ? +wfBiasedBrier.toFixed(4) : null,
    is_real_signal: bss != null && bss > 0.02,
    is_real_signal_walk_forward: wfBss != null && wfBss > 0.02,
    is_real_signal_calibrated: wfCalBss != null && wfCalBss > 0.02
  };
}

// Pass 228/229: autonomous weekly champion re-competition. The champion/
// challenger bootstrap previously ran ONLY on a manual POST — so the brain only
// "tried new things" when Brandon triggered it. This re-runs the full bootstrap
// (re-fetch history, re-race the 4 configs, re-fit Platt, promote a fresh
// champion) every ~7 days so the brain keeps adapting to regime shifts on its
// own.
//
// Pass 229: call runBootstrap(env) INLINE rather than via a self-subrequest to
// /brain/bootstrap. A Worker fetching its own workers.dev URL is unreliable
// (same-script subrequest routing), and pass-228's self-fetch silently never
// fired. Inline reuses the exact audited bootstrap path with no URL/token
// dependency. The KV timestamp is claimed BEFORE the run so the next 60s tick
// can't double-fire mid-run; on failure the claim is ROLLED BACK so a transient
// error retries next tick instead of waiting a full week.
const AUTO_BOOTSTRAP_INTERVAL_MS = 7 * 24 * 3600 * 1000;
const RECOVERY_COOLDOWN_MS = 3 * 3600 * 1000;  // pass 251: at most one recovery attempt / 3h
const EDGE_RECOVERY_COOLDOWN_MS = 20 * 3600 * 1000;  // pass 260: ~daily re-bootstrap while the edge is below a coin flip (the 120-day window shifts each day, giving a genuinely fresh shot; re-running within a day would just repeat the same fit)
async function maybeAutoBootstrap(env) {
  let claimed = false, prev = 0;
  try {
    // Pass 251 self-healing watchdog: if the model is ever missing or untrained
    // (a bad deploy, a wiped/corrupted KV value), recover IMMEDIATELY instead of
    // waiting up to 7 days for the scheduled re-competition. Throttled to every
    // 3h via a dedicated cooldown so a persistent failure can't spam bootstraps
    // (and the Yahoo rate limit) every minute.
    const model = await kvGet(env, KV_KEYS.MODEL, null);
    const needsRecovery = !model || !(model.n_trained > 0);
    if (needsRecovery) {
      const recTs = await kvGet(env, 'recovery_ts_v1', 0);
      if (Date.now() - (recTs || 0) < RECOVERY_COOLDOWN_MS) return;
      await kvPut(env, 'recovery_ts_v1', Date.now());  // claim before running
      await runBootstrap(env);
      return;
    }
    // Pass 260: ACTIVE edge recovery. If the DEPLOYED model is below a coin flip on
    // walk-forward, actively re-bootstrap (~daily). The promotion guard in
    // runBootstrap ensures only a BETTER model deploys, so this ratchets the edge
    // back up as the 120-day window shifts, and stops on its own once we clear 50%.
    const champs = await kvGet(env, KV_KEYS.CHAMPIONS, null);
    // Prefer the new champion_wf_acc; fall back to champion_final_acc (the honest
    // held-back accuracy present on older records) so recovery arms immediately.
    const deployedWf = champs && typeof champs.champion_wf_acc === 'number' ? champs.champion_wf_acc
                     : (champs && typeof champs.champion_final_acc === 'number' ? champs.champion_final_acc : null);
    if (deployedWf != null && deployedWf < 0.50) {
      const edgeTs = await kvGet(env, 'edge_recovery_ts_v1', 0);
      if (Date.now() - (edgeTs || 0) < EDGE_RECOVERY_COOLDOWN_MS) return;
      await kvPut(env, 'edge_recovery_ts_v1', Date.now());  // claim before running
      await runBootstrap(env);
      return;
    }
    prev = await kvGet(env, KV_KEYS.AUTO_BOOTSTRAP_TS, 0);
    if (Date.now() - (prev || 0) < AUTO_BOOTSTRAP_INTERVAL_MS) return;
    await kvPut(env, KV_KEYS.AUTO_BOOTSTRAP_TS, Date.now());  // claim before running
    claimed = true;
    await runBootstrap(env);  // same path as the manual POST
  } catch (e) {
    if (claimed) { try { await kvPut(env, KV_KEYS.AUTO_BOOTSTRAP_TS, prev); } catch (e2) {} }
  }
}

// ============================================================
// Pass 252 — EDGE SCORECARD (the receipt). A live FORWARD test: each trading
// day we snapshot every brain/insider directional call + its entry price, then
// 5 trading days (~7 calendar days) later grade it against the REAL move. The
// /brain/confluence-score endpoint reports the hit-rate vs a coin flip, split by
// brain-only / insider-only / confluence (both agree). This is what tells us
// whether the signals actually beat random in the wild — and whether paying for
// options-flow data would add edge. Self-contained + gated like the watchdog so
// it never burdens the core tick (1 KV write/day to snapshot; resolution capped
// at 6 Yahoo fetches/tick).
// ============================================================
function etDayKeyNow() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getUTCFullYear() * 10000 + (et.getUTCMonth() + 1) * 100 + et.getUTCDate();
}

// Net open-market insider direction per symbol across a liquid basket (once/day).
async function insiderBiasMap(env) {
  // Pass 263: widened 16 -> 25 names (every individual stock in the universe that
  // actually has SEC insiders; ETFs are funds with none, so they're skipped). More
  // names => more days the brain and insiders can AGREE => the confluence forward-test
  // (and its coin-flip verdict) accrues in weeks instead of months. Cost is one extra
  // Finnhub insider fetch per added name, once per ET weekday.
  const BASKET = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'AMD', 'PLTR', 'COIN', 'AVGO', 'JPM', 'GS', 'DIS', 'NFLX', 'UBER', 'SMCI', 'MARA', 'RIVN', 'BABA', 'SHOP', 'CRM', 'ORCL', 'MU', 'BAC'];
  const map = {};
  const results = await Promise.all(BASKET.map(s =>
    fetchFinnhubInsider(env, s).then(t => ({ s, t })).catch(() => ({ s, t: null }))
  ));
  for (const r of results) {
    if (!Array.isArray(r.t)) continue;
    let buy = 0, sell = 0;
    for (const x of r.t) {
      if (!x.openMarket) continue;
      if (x.side === 'BUY') buy += x.value || 0;
      else if (x.side === 'SELL') sell += x.value || 0;
    }
    const net = buy - sell;
    map[r.s] = net > 0 ? 1 : net < 0 ? -1 : 0;
  }
  return map;
}

// ============================================================
// Pass 257: daily delivery of the Pick of the Day to Discord
// ============================================================
// Webhook URL comes from the DISCORD_WEBHOOK_URL secret (Brandon sets it via
// `wrangler secret put DISCORD_WEBHOOK_URL`). If absent, every function here is a
// silent no-op, so the worker is safe to deploy before the secret exists.
function isDiscordWebhook(u) {
  return typeof u === 'string' && /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\//.test(u.trim());
}

// Pick of the Day + Best Long from the current finalized signals snapshot.
// Mirrors the /brain/picks logic so the Discord post and the website agree.
function digestPicksFromSnap(snap) {
  const sigs = Object.values((snap && snap.signals) || {})
    .filter(s => s && typeof s.predProb === 'number' && s.last > 0);
  if (sigs.length < 8) return null;
  sigs.forEach(s => { s._conv = Math.abs(s.predProb - 0.5); });
  const potd = sigs.slice().sort((a, b) => b._conv - a._conv)[0];
  const bestLong = sigs.slice().sort((a, b) => b.predProb - a.predProb)[0];
  return { potd, bestLong, count: sigs.length };
}

function digestDirWord(s) {
  return s.predProb >= 0.52 ? 'LONG' : s.predProb <= 0.48 ? 'SHORT' : 'NEUTRAL';
}

async function postDiscordDigest(env, picks) {
  const webhook = (env.DISCORD_WEBHOOK_URL || '').trim();
  if (!isDiscordWebhook(webhook) || !picks) return { ok: false, reason: 'no_webhook_or_picks' };
  const { potd, bestLong } = picks;
  const pct = s => Math.round(s.predProb * 100);
  const dateLabel = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
  const fields = [{
    name: 'Pick of the Day',
    value: '**' + potd.sym + '** — ' + digestDirWord(potd) + '  (P up ' + pct(potd) + '%, conviction ' + (potd._conv * 2).toFixed(2) + ', entry $' + (+potd.last).toFixed(2) + ')',
    inline: false
  }];
  // Only show Best Long separately when the POTD is not already a long.
  if (bestLong.sym !== potd.sym || digestDirWord(potd) !== 'LONG') {
    const weak = bestLong.predProb < 0.52;
    fields.push({
      name: 'Best Long',
      value: '**' + bestLong.sym + '** — P up ' + pct(bestLong) + '%' + (weak ? '  (weak: no strong long edge today)' : '  (entry $' + (+bestLong.last).toFixed(2) + ')'),
      inline: false
    });
  }
  const body = {
    username: 'bpleone / trade',
    embeds: [{
      title: 'Brain Pick — ' + dateLabel,
      description: 'The 24/7 brain’s highest-conviction 5-day call. Full track record + today’s shortlist at the link.',
      url: 'https://options.bpleone.com/pick-of-day.html',
      color: 0x10b981,
      fields,
      footer: { text: 'bpleone / trade — calibrated 5-day model. Educational, not financial advice.' }
    }]
  };
  try {
    const resp = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: resp.ok || resp.status === 204, status: resp.status };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: String((e && e.message) || e) };
  }
}

async function maybeDailyDigest(env) {
  try {
    if (!isDiscordWebhook((env.DISCORD_WEBHOOK_URL || '').trim())) return;   // not configured -> no-op
    const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const etDow = nowEt.getUTCDay();
    const etHour = nowEt.getUTCHours();
    if (etDow < 1 || etDow > 5) return;             // weekdays only
    if (etHour < 9 || etHour >= 12) return;         // morning window (~9:00-11:59 ET)
    const dayKey = etDayKeyNow();
    const sentDay = await kvGet(env, 'discord_potd_day_v1', 0);
    if (sentDay === dayKey) return;                 // already delivered today
    const snap = await kvGet(env, KV_KEYS.SIGNALS, { signals: {} });
    const sigFresh = snap.updatedAt && (Date.now() - snap.updatedAt) < 6 * 3600 * 1000;
    if (!sigFresh) return;                          // wait for a fresh snapshot
    const picks = digestPicksFromSnap(snap);
    if (!picks) return;                             // not enough signals yet
    const res = await postDiscordDigest(env, picks);
    if (res.ok) await kvPut(env, 'discord_potd_day_v1', dayKey);  // mark sent only on success
  } catch (e) { /* never let delivery break the cron */ }
}

// ============================================================
// Pass 258: broadcast constraints (noise control) + segmented learning
// ============================================================
// The brain SCORES the whole universe every tick, but most of those calls are
// low-conviction noise we don't want to broadcast. These constraints gate what
// becomes a Pick of the Day / Alpha / Best Long. They live in KV so Brandon can
// edit them from constraints.html without a redeploy. The brain keeps learning
// on the FULL universe (training is untouched) — constraints only govern what we
// surface. /brain/segments then measures which conditions actually carry edge so
// the constraints can be tuned from evidence, not vibes.
function defaultConstraints() {
  return {
    min_conviction: 0.05,        // Alpha floor: conviction = |P(up)-0.5|*2 must be >= this
    potd_min_conviction: 0.0,    // Pick of the Day floor (0 = always show the single best call)
    min_rvol: 0,                 // relative-volume floor (0 = off). e.g. 1.5 = only unusually active names
    min_price: 3,                // skip sub-$3 names (illiquid / not optionable)
    max_price: 100000,           // upper price guard (off by default)
    exclude_symbols: [],         // blocklist: never broadcast these
    focus_symbols: [],           // if non-empty, ONLY these symbols are eligible (a focus universe)
    alpha_max: 8,                // size of the Alpha shortlist
    long_only: false,            // environmental gate: suppress SHORT calls, surface longs only
    require_changepct_agree: false, // only broadcast when today's move agrees with the call direction
    updatedAt: 0,
    updatedBy: 'default',
    note: ''
  };
}

async function loadConstraints(env) {
  const stored = await kvGet(env, KV_KEYS.CONSTRAINTS, null);
  if (!stored || typeof stored !== 'object') return defaultConstraints();
  return Object.assign(defaultConstraints(), stored);
}

// Coerce + clamp an incoming constraints patch so a bad POST can never wedge the
// scanner (e.g. min_conviction=5 would hide every pick). Returns a clean object.
function sanitizeConstraints(patch, base) {
  const c = Object.assign({}, base || defaultConstraints());
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  if ('min_conviction' in patch) c.min_conviction = num(patch.min_conviction, 0, 1, c.min_conviction);
  if ('potd_min_conviction' in patch) c.potd_min_conviction = num(patch.potd_min_conviction, 0, 1, c.potd_min_conviction);
  if ('min_rvol' in patch) c.min_rvol = num(patch.min_rvol, 0, 20, c.min_rvol);
  if ('min_price' in patch) c.min_price = num(patch.min_price, 0, 100000, c.min_price);
  if ('max_price' in patch) c.max_price = num(patch.max_price, 1, 1000000, c.max_price);
  if ('alpha_max' in patch) c.alpha_max = Math.round(num(patch.alpha_max, 1, 25, c.alpha_max));
  if ('long_only' in patch) c.long_only = !!patch.long_only;
  if ('require_changepct_agree' in patch) c.require_changepct_agree = !!patch.require_changepct_agree;
  if ('exclude_symbols' in patch && Array.isArray(patch.exclude_symbols)) c.exclude_symbols = patch.exclude_symbols.map(s => String(s || '').toUpperCase().trim()).filter(Boolean).slice(0, 80);
  if ('focus_symbols' in patch && Array.isArray(patch.focus_symbols)) c.focus_symbols = patch.focus_symbols.map(s => String(s || '').toUpperCase().trim()).filter(Boolean).slice(0, 80);
  if ('note' in patch) c.note = String(patch.note || '').slice(0, 200);
  return c;
}

// Filter raw signals down to the constraint-passing (broadcastable) set.
function applyConstraints(sigs, c) {
  const ex = new Set((c.exclude_symbols || []));
  const focus = (c.focus_symbols || []);
  const focusSet = focus.length ? new Set(focus) : null;
  return sigs.filter(s => {
    if (!s || typeof s.predProb !== 'number' || !(s.last > 0)) return false;
    const sym = String(s.sym || '').toUpperCase();
    if (ex.has(sym)) return false;
    if (focusSet && !focusSet.has(sym)) return false;
    if (c.min_price && s.last < c.min_price) return false;
    if (c.max_price && s.last > c.max_price) return false;
    if (c.min_rvol && (s.rvol == null || s.rvol < c.min_rvol)) return false;
    if (c.long_only && s.predProb < 0.5) return false;
    if (c.require_changepct_agree && s.changePct != null) {
      const dirUp = s.predProb >= 0.5;
      if (dirUp && s.changePct < 0) return false;
      if (!dirUp && s.changePct > 0) return false;
    }
    return true;
  });
}

// Segmented learning: bucket RESOLVED graded calls by conviction + direction and
// report hit-rate per bucket. This is how the brain "learns" which conditions
// carry signal vs noise — e.g. if conviction>=0.2 hits 58% but 0-0.1 hits 50%,
// the evidence says raise min_conviction. Reads the same confluence_log the Edge
// Scorecard grades, so it's the honest forward record, not a backtest.
function confluenceSegments(log) {
  const resolved = (log || []).filter(e => e && e.resolved && typeof e.ret === 'number' && (e.brainDir === 1 || e.brainDir === -1));
  const mk = (label) => ({ label, n: 0, hits: 0, sumRet: 0 });
  const add = (b, e) => {
    b.n++;
    const correct = (e.brainDir > 0 && e.ret > 0) || (e.brainDir < 0 && e.ret < 0);
    if (correct) b.hits++;
    b.sumRet += (e.brainDir > 0 ? e.ret : -e.ret); // directional return
  };
  const convBuckets = [mk('0.00-0.10'), mk('0.10-0.20'), mk('0.20-0.30'), mk('0.30+')];
  const dirBuckets = { long: mk('long (UP calls)'), short: mk('short (DOWN calls)') };
  for (const e of resolved) {
    const conv = Math.abs(e.predProb - 0.5) * 2;
    const bi = conv >= 0.30 ? 3 : conv >= 0.20 ? 2 : conv >= 0.10 ? 1 : 0;
    add(convBuckets[bi], e);
    add(e.brainDir > 0 ? dirBuckets.long : dirBuckets.short, e);
  }
  const finalize = b => ({
    label: b.label,
    n: b.n,
    hit_rate: b.n ? +(b.hits / b.n).toFixed(3) : null,
    avg_directional_ret_pct: b.n ? +(b.sumRet / b.n).toFixed(3) : null
  });
  // Evidence-based suggestion: the lowest conviction bucket that still clears 52%
  // with a meaningful sample. That floor is what min_conviction "should" be.
  let suggestedMinConv = null;
  const edges = [0, 0.10, 0.20, 0.30];
  for (let i = 0; i < convBuckets.length; i++) {
    const b = convBuckets[i];
    if (b.n >= 10 && (b.hits / b.n) >= 0.52) { suggestedMinConv = edges[i]; break; }
  }
  return {
    total_resolved: resolved.length,
    by_conviction: convBuckets.map(finalize),
    by_direction: [finalize(dirBuckets.long), finalize(dirBuckets.short)],
    suggested_min_conviction: suggestedMinConv,
    note: 'Hit-rate of graded 5-day calls, split by how confident the brain was and which way it leaned. This is what the brain has LEARNED about where its edge actually is. suggested_min_conviction = the lowest confidence band that still beats 52% with n>=10.'
  };
}

// Backtest version of the segment analysis: bucket the held-out test pairs
// (thousands of out-of-sample examples from the bootstrap) by conviction so the
// "edge by confidence band" evidence is populated TODAY, before the live forward
// log matures. Pairs are { p: predProb, y: 0|1 label }.
function backtestSegments(heldoutRaw) {
  let pairs = [];
  if (Array.isArray(heldoutRaw)) pairs = heldoutRaw;
  else if (heldoutRaw && typeof heldoutRaw === 'object') pairs = (heldoutRaw.random_split || []).concat(heldoutRaw.walk_forward || []);
  pairs = pairs.filter(e => e && typeof e.p === 'number' && (e.y === 0 || e.y === 1));
  const mk = label => ({ label, n: 0, hits: 0 });
  const buckets = [mk('0.00-0.10'), mk('0.10-0.20'), mk('0.20-0.30'), mk('0.30+')];
  for (const e of pairs) {
    const conv = Math.abs(e.p - 0.5) * 2;
    const bi = conv >= 0.30 ? 3 : conv >= 0.20 ? 2 : conv >= 0.10 ? 1 : 0;
    const b = buckets[bi];
    b.n++;
    if ((e.p >= 0.5 && e.y === 1) || (e.p < 0.5 && e.y === 0)) b.hits++;
  }
  return {
    total: pairs.length,
    by_conviction: buckets.map(b => ({ label: b.label, n: b.n, hit_rate: b.n ? +(b.hits / b.n).toFixed(3) : null }))
  };
}

async function maybeConfluenceScorecard(env) {
  try {
    const dayKey = etDayKeyNow();
    // ---- SNAPSHOT once per ET WEEKDAY, using the day's finalized signals (an
    // end-of-day entry — same cadence as the brain's daily capture). Gated on
    // signal freshness rather than exact market-open so it reliably fires once a
    // day (including just after the close) and never on weekends.
    const etDow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getUTCDay();
    const isWeekday = etDow >= 1 && etDow <= 5;
    const snapDay = await kvGet(env, 'confluence_snap_day_v1', 0);
    if (snapDay !== dayKey && isWeekday) {
      const snap = await kvGet(env, KV_KEYS.SIGNALS, { signals: {} });
      const sigFresh = snap.updatedAt && (Date.now() - snap.updatedAt) < 12 * 3600 * 1000;
      const signals = Object.values(snap.signals || {}).filter(s => s && typeof s.predProb === 'number' && s.last > 0);
      if (sigFresh && signals.length >= 8) {
        const insMap = await insiderBiasMap(env);
        const log = await kvGet(env, 'confluence_log_v1', []);
        for (const s of signals) {
          const brainDir = s.predProb >= 0.52 ? 1 : s.predProb <= 0.48 ? -1 : 0;
          const insDir = insMap[s.sym] || 0;
          if (brainDir === 0 && insDir === 0) continue;     // no call to grade
          log.push({ dayKey, ts: Date.now(), sym: s.sym, entry: s.last, brainDir, insDir, predProb: +s.predProb.toFixed(4), resolved: false });
        }
        await kvPut(env, 'confluence_log_v1', log.slice(-4000));  // cap to bound KV size
        await kvPut(env, 'confluence_snap_day_v1', dayKey);
        return;  // don't also resolve this tick — bound the work
      }
    }
    // ---- RESOLVE (bounded): grade calls that are >= 5 trading days (~7 calendar) old.
    const log = await kvGet(env, 'confluence_log_v1', []);
    const now = Date.now();
    let resolvedCount = 0, dirty = false;
    for (const e of log) {
      if (e.resolved || (now - e.ts) < 7 * 86400000) continue;
      if (resolvedCount >= 6) break;                        // cap Yahoo fetches/tick
      const q = await fetchYahooQuote(e.sym);
      resolvedCount++;
      if (!q || !q.last) continue;
      e.exit = +q.last.toFixed(2);
      e.ret = +(((q.last - e.entry) / e.entry) * 100).toFixed(3);  // 5-day % move
      e.resolved = true;
      dirty = true;
    }
    if (dirty) await kvPut(env, 'confluence_log_v1', log);
  } catch (e) { /* never let the scorecard break the cron */ }
}

// ============================================================
// Cloudflare entry points
// ============================================================
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    // Cron-triggered tick — runs every minute
    ctx.waitUntil(tick(env));
    // Pass 228: weekly autonomous champion re-competition (gated; see above)
    ctx.waitUntil(maybeAutoBootstrap(env));
    // Pass 252: live edge scorecard — snapshot daily, grade at 5 days
    ctx.waitUntil(maybeConfluenceScorecard(env));
    // Pass 257: daily delivery — post Pick of the Day to Discord (weekday AM, once)
    ctx.waitUntil(maybeDailyDigest(env));
  }
};
