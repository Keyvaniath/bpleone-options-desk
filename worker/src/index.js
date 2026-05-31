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
const WORKER_VERSION = 'pass-244';

const UNIVERSE = [
  'SPY','QQQ','IWM','DIA','AAPL','NVDA','TSLA','MSFT','META','AMZN','GOOGL','AMD',
  'VIX','GLD','TLT','USO','SMCI','PLTR','COIN','MARA','RIVN','XLE','BABA','SHOP',
  'CRM','UBER','SLV','UNG','DBA','FXI','MCHI','EWJ','EWG','EWU','INDA','EWZ','EWY',
  'EWT','EEM','EFA','VEA','VWO','UUP','FXE','FXY','FXB','FXC','FXA','FXF','SHY',
  'IEF','TBT','HYG','LQD','TIP','VXX','UVXY','VNQ','NFLX','ORCL','AVGO','MU',
  'JPM','BAC','GS','XLF','XLK','XLV','XLY','XLP','XLI','XLU'
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
    const prevClose = (typeof meta.chartPreviousClose === 'number' && meta.chartPreviousClose > 0)
      ? meta.chartPreviousClose : (i > 0 && q.close[i - 1] ? q.close[i - 1] : last);
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
  XLV:'xlv.us', XLY:'xly.us', XLP:'xlp.us', XLI:'xli.us', XLU:'xlu.us'
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
  const HORIZON_MIN_MOVE = { short: 0.003, mid: 0.01, long: 0.03 };
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

  if (path === '/brain/health' || path === '/healthz') {
    const [lt, autoTs, model] = await Promise.all([
      kvGet(env, KV_KEYS.LAST_TICK, { ts: 0 }),
      kvGet(env, KV_KEYS.AUTO_BOOTSTRAP_TS, 0),   // pass 229: autonomous bootstrap observability
      kvGet(env, KV_KEYS.MODEL, null)             // pass 233: expose trained count for liveness UI
    ]);
    const ageS = lt.ts ? Math.floor((Date.now() - lt.ts) / 1000) : null;
    return json({
      ok: true,
      lastTickAgo: ageS,
      lastTick: lt,
      healthy: ageS != null && ageS < 180,
      worker_version: WORKER_VERSION,  // pass 200
      auto_bootstrap_ts: autoTs || 0,  // pass 229
      auto_bootstrap_ago_h: autoTs ? +((Date.now() - autoTs) / 3600000).toFixed(2) : null,
      // Pass 233: data-liveness summary for the scanner status bar
      model_trained: model && typeof model.n_trained === 'number' ? model.n_trained : 0,
      journal_total: typeof lt.journalTotal === 'number' ? lt.journalTotal : null,
      market_open: isMarketLikelyOpen(),
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
      return {
        n: valid.length,
        accuracy: +acc.toFixed(4),
        brier: +brier.toFixed(4),
        bss: +bss.toFixed(4),
        ece: +ece.toFixed(4),
        z_score: +z.toFixed(3),
        p_value: +pValue.toFixed(4),
        significant: pValue < 0.05,
        verdict: bss > 0.05 ? 'REAL SIGNAL' : (bss > 0 ? 'WEAK SIGNAL' : 'BELOW BASELINE')
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
    const LABEL_THRESHOLD = 0.01;
    // Pass 211: training loop starts at max(20, bars.length - BOOTSTRAP_DAYS)
    // instead of 20. Still need i >= 14 for richFeatures' RSI lookback;
    // 20 is the safe floor. Older bars still feed richFeatures via the
    // moving-window indices, just don't become training examples themselves.
    const trainStart = Math.max(20, bars.length - BOOTSTRAP_DAYS);
    for (let i = trainStart; i < bars.length - FWD_DAYS; i++) {
      const today = bars[i];
      const future = bars[i + FWD_DAYS];
      const ret = (future.close - today.close) / today.close;
      const label = ret > LABEL_THRESHOLD ? 1 : (ret < -LABEL_THRESHOLD ? 0 : null);
      if (label === null) continue;
      const features = richFeatures(bars, i);
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

  // Race every config on wfTrainSet → score on the validation slice.
  const contenders = CONFIGS.map(cfg => {
    const m = trainConfigModel(cfg, wfTrainSet);
    const val = scoreModel(m, wfVal);
    return { cfg, model: m, val };
  });
  // Champion = highest validation BSS (most edge on data it never trained on).
  contenders.sort((a, b) => (b.val.bss == null ? -Infinity : b.val.bss) - (a.val.bss == null ? -Infinity : a.val.bss));
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
  const championRecord = {
    fittedAt: Date.now(),
    champion: champion.cfg.name,
    champion_l2: champion.cfg.l2,
    champion_epochs: champion.cfg.epochs,
    champion_val_bss: champion.val.bss,
    champion_final_bss: championFinal.bss,       // honest, never used for selection
    champion_final_acc: championFinal.acc,
    champion_final_n: championFinal.n,
    leaderboard,
    note: 'Champion picked by validation BSS over a strided (regime-spanning) validation slice; champion_final_* is on a disjoint, selection-free held-back slice.'
  };

  await Promise.all([
    kvPut(env, KV_KEYS.MODEL, model),
    kvPut(env, KV_KEYS.HELDOUT, { random_split: heldout, walk_forward: walkForward }),
    kvPut(env, KV_KEYS.BARS_HISTORY, barsHistory),  // pass 193
    kvPut(env, KV_KEYS.PLATT, platt),              // pass 213/220
    kvPut(env, KV_KEYS.CHAMPIONS, championRecord)  // pass 222
  ]);

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
async function maybeAutoBootstrap(env) {
  let claimed = false, prev = 0;
  try {
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
  }
};
