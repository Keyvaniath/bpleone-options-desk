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
};

const MAX_JOURNAL = 12000;
const HORIZON_HOURS = { short: 24, mid: 120, long: 480 }; // 1d / 5d / 20d

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
  // gradient descent — same shape as js/model.js's Adam-lite
  for (let i = 0; i < 22; i++) {
    model.weights[i] -= model.lr * err * (features[i] || 0);
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
  // 0-21: subset of the browser's feature vector. The server runs a
  // simpler model — browser pages can supply richer features via /brain/inject.
  f[0] = clamp(50 / 100, 0, 1);                                  // RSI placeholder
  f[1] = clamp(range * 100, 0, 1);                               // intraday range %
  f[5] = clamp((changePct + 5) / 10, 0, 1);                      // change% normalized
  f[18] = clamp((marketSnap.vix - 10) / 40, 0, 1);               // VIX
  f[20] = clamp((etHour() - 9.5) / (16 - 9.5), 0, 1);            // ET hour-of-session
  f[21] = 1;                                                     // bias
  return f;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
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

// Server-side bootstrap that browsers can't do (no CORS)
async function fetchFinnhubCandles(env, sym, days) {
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

// ============================================================
// Tick handler — runs every minute on cron
// ============================================================
async function tick(env) {
  const startTs = Date.now();
  const [journal, model, lastTick] = await Promise.all([
    kvGet(env, KV_KEYS.JOURNAL, []),
    kvGet(env, KV_KEYS.MODEL, newModel()),
    kvGet(env, KV_KEYS.LAST_TICK, { ts: 0, syms_updated: 0, errors: 0 })
  ]);

  // Fetch all quotes in parallel
  const quotePromises = UNIVERSE.map(s => fetchFinnhubQuote(env, s));
  const quotes = await Promise.all(quotePromises);
  const byMap = {};
  let okCount = 0, errCount = 0;
  for (let i = 0; i < UNIVERSE.length; i++) {
    if (quotes[i]) { byMap[UNIVERSE[i]] = quotes[i]; okCount++; }
    else errCount++;
  }
  const vix = (byMap.VIX && byMap.VIX.last) || 18;

  // Capture: one entry per symbol with valid quote
  let captured = 0;
  for (const sym of UNIVERSE) {
    const q = byMap[sym];
    if (!q) continue;
    // 5-min cooldown per symbol (don't capture too often)
    const lastCap = journal.filter(e => e.sym === sym).slice(-1)[0];
    if (lastCap && (Date.now() - lastCap.ts) < 5 * 60 * 1000) continue;
    const features = extractFeatures(q, { vix });
    const p = predict(model, features);
    journal.push({
      id: 'w-' + Date.now() + '-' + sym + '-' + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      sym,
      entryPx: q.last,
      features,
      predProb: p,
      priceSource: 'finnhub-worker',
      regime: vix > 25 ? 'volatile_bear' : (q.changePct > 0 ? 'trending_bull' : 'choppy'),
      resolved: { short: false, mid: false, long: false }
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
      if (outcome !== 'flat' && horizon === 'short') {
        // Train on short-horizon outcomes only (matches browser-side design)
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

  // Persist
  await Promise.all([
    kvPut(env, KV_KEYS.JOURNAL, journal),
    kvPut(env, KV_KEYS.MODEL, model),
    kvPut(env, KV_KEYS.LAST_TICK, {
      ts: Date.now(),
      syms_updated: okCount,
      errors: errCount,
      captured,
      resolved,
      trained,
      durationMs: Date.now() - startTs
    })
  ]);

  return { ok: true, captured, resolved, trained, syms: okCount, errors: errCount };
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

  if (path === '/brain/health' || path === '/healthz') {
    const lt = await kvGet(env, KV_KEYS.LAST_TICK, { ts: 0 });
    const ageS = lt.ts ? Math.floor((Date.now() - lt.ts) / 1000) : null;
    return json({
      ok: true,
      lastTickAgo: ageS,
      lastTick: lt,
      healthy: ageS != null && ageS < 180
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
    const n = Math.min(2000, parseInt(url.searchParams.get('n') || '200', 10));
    const journal = await kvGet(env, KV_KEYS.JOURNAL, []);
    return json({ journal: journal.slice(-n), total: journal.length });
  }

  if (path === '/brain/model') {
    const model = await kvGet(env, KV_KEYS.MODEL, newModel());
    return json(model);
  }

  if (path === '/brain/bootstrap' && request.method === 'POST') {
    // Auth check
    const auth = request.headers.get('Authorization') || '';
    if (auth !== 'Bearer ' + env.ADMIN_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }
    // Pull 250 days of historical bars for each symbol, train on them
    const result = await runBootstrap(env);
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

  return json({ error: 'not found', paths: ['/brain/health', '/brain/state', '/brain/journal', '/brain/model', '/brain/bootstrap (POST)', '/brain/tick (POST)'] }, 404);
}

async function runBootstrap(env) {
  const model = await kvGet(env, KV_KEYS.MODEL, newModel());
  const trainingExamples = [];
  let symbolsFetched = 0;
  const errors = [];

  for (const sym of UNIVERSE) {
    const bars = await fetchFinnhubCandles(env, sym, 250);
    if (!bars || bars.length < 20) {
      errors.push({ sym, reason: 'no-bars' });
      continue;
    }
    symbolsFetched++;
    // Build (features, label) pairs from consecutive bars
    for (let i = 20; i < bars.length - 1; i++) {
      const today = bars[i];
      const tomorrow = bars[i + 1];
      const ret = (tomorrow.close - today.close) / today.close;
      const label = ret > 0.003 ? 1 : (ret < -0.003 ? 0 : null);
      if (label === null) continue;
      const fakeQ = {
        symbol: sym,
        last: today.close,
        dayHigh: today.high,
        dayLow: today.low,
        changePct: i > 0 ? ((today.close - bars[i-1].close) / bars[i-1].close) * 100 : 0,
      };
      const features = extractFeatures(fakeQ, { vix: 18 });
      trainingExamples.push({ features, label });
    }
  }

  // Train all examples
  let lossSum = 0;
  for (const ex of trainingExamples) {
    const { loss } = trainStep(model, ex.features, ex.label);
    lossSum += loss;
  }

  await kvPut(env, KV_KEYS.MODEL, model);

  return {
    ok: true,
    symbolsFetched,
    trainingExamples: trainingExamples.length,
    errors: errors.length,
    avgLoss: trainingExamples.length ? lossSum / trainingExamples.length : null,
    final_n_trained: model.n_trained
  };
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
  }
};
