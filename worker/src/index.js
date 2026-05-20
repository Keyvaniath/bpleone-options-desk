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
  HELDOUT: 'heldout_test_v1',     // out-of-sample test pairs from bootstrap
  METRICS_CACHE: 'metrics_cache_v1',
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

  // Pass 188: rotate through universe over multiple ticks to stay under
  // Finnhub free tier's 60-calls/min rate limit. Browser pages may also be
  // calling Finnhub, so we conservatively fetch 12 symbols per minute = 720
  // calls/hour, leaving headroom for browser usage.
  const tickIndex = Math.floor(Date.now() / 60000) % Math.ceil(UNIVERSE.length / 12);
  const start = tickIndex * 12;
  const slice = UNIVERSE.slice(start, start + 12);

  // Fetch the slice in parallel
  const quotePromises = slice.map(s => fetchFinnhubQuote(env, s));
  const quotes = await Promise.all(quotePromises);
  const byMap = {};
  let okCount = 0, errCount = 0;
  for (let i = 0; i < slice.length; i++) {
    if (quotes[i]) { byMap[slice[i]] = quotes[i]; okCount++; }
    else errCount++;
  }
  const vix = (byMap.VIX && byMap.VIX.last) || 18;

  // Capture: one entry per symbol with valid quote (only this tick's slice)
  let captured = 0;
  for (const sym of slice) {
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

  // Pass 190 (CRITICAL race fix): only persist the model if we actually
  // trained on resolutions. Otherwise the cron tick could overwrite a
  // freshly-bootstrapped model (n_trained=8562) with a stale in-memory copy
  // due to Cloudflare KV's eventual-consistency window.
  const writes = [
    kvPut(env, KV_KEYS.JOURNAL, journal),
    kvPut(env, KV_KEYS.LAST_TICK, {
      ts: Date.now(),
      syms_updated: okCount,
      errors: errCount,
      captured,
      resolved,
      trained,
      durationMs: Date.now() - startTs,
      skipped_model_write: trained === 0
    })
  ];
  if (trained > 0) {
    writes.push(kvPut(env, KV_KEYS.MODEL, model));
  }
  await Promise.all(writes);

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

  if (path === '/brain/metrics') {
    // Pass 191: real signal-vs-noise metrics from the held-out test set
    // and the live resolved journal. No auth required (read-only).
    const heldout = await kvGet(env, KV_KEYS.HELDOUT, []);
    const journal = await kvGet(env, KV_KEYS.JOURNAL, []);

    // ---- Held-out test metrics (from bootstrap split) ----
    let testMetrics = null;
    if (heldout.length > 0) {
      let correct = 0, brierSum = 0;
      const bins = Array(10).fill(0).map(() => ({ n: 0, sum_y: 0, sum_p: 0 }));
      for (const { p, y } of heldout) {
        if ((p >= 0.5 ? 1 : 0) === y) correct++;
        brierSum += (p - y) * (p - y);
        const bin = Math.min(9, Math.floor(p * 10));
        bins[bin].n++;
        bins[bin].sum_y += y;
        bins[bin].sum_p += p;
      }
      const brier = brierSum / heldout.length;
      const bss = 1 - (brier / 0.25);
      // ECE (expected calibration error)
      let ece = 0;
      for (const b of bins) {
        if (b.n === 0) continue;
        const actualRate = b.sum_y / b.n;
        const meanProb = b.sum_p / b.n;
        ece += (b.n / heldout.length) * Math.abs(actualRate - meanProb);
      }
      // Binomial test vs 50% (Wald approximation for large n)
      const acc = correct / heldout.length;
      const z = (acc - 0.5) / Math.sqrt(0.25 / heldout.length);
      // Two-sided p-value via normal CDF approximation
      const pValue = 2 * (1 - normalCdf(Math.abs(z)));
      testMetrics = {
        n: heldout.length,
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

    // ---- Live journal metrics (from resolved captures) ----
    const resolved = journal.filter(e => e.resolved && typeof e.resolved === 'object' && e.resolved.short && e.resolved.short !== false);
    let liveMetrics = null;
    if (resolved.length > 0) {
      let correct = 0, brierSum = 0;
      for (const e of resolved) {
        if (e.resolved.short === 'correct') correct++;
        const y = e.resolved.short === 'correct' ? (e.predProb >= 0.5 ? 1 : 0) : (e.predProb >= 0.5 ? 0 : 1);
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
      heldout_test: testMetrics,
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

  return json({ error: 'not found', paths: ['/brain/health', '/brain/state', '/brain/journal', '/brain/model', '/brain/metrics', '/brain/debug/fetch?sym=X', '/brain/bootstrap (POST)', '/brain/tick (POST)'] }, 404);
}

async function runBootstrap(env) {
  const model = await kvGet(env, KV_KEYS.MODEL, newModel());
  const trainingExamples = [];
  let symbolsFetched = 0;
  const errors = [];

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

  for (const sym of UNIVERSE) {
    const bars = await fetchHistoricalBars(env, sym, 250);
    if (!bars || bars.length < 30) {
      errors.push({ sym, reason: 'no-bars' });
      continue;
    }
    symbolsFetched++;
    for (let i = 20; i < bars.length - 1; i++) {
      const today = bars[i];
      const tomorrow = bars[i + 1];
      const ret = (tomorrow.close - today.close) / today.close;
      const label = ret > 0.003 ? 1 : (ret < -0.003 ? 0 : null);
      if (label === null) continue;
      const features = richFeatures(bars, i);
      trainingExamples.push({ features, label, sym });
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
  const shuffled = seedShuffle(trainingExamples, 42);
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const trainSet = shuffled.slice(0, splitIdx);
  const testSet = shuffled.slice(splitIdx);

  // Train phase
  let lossSum = 0;
  for (const ex of trainSet) {
    const { loss } = trainStep(model, ex.features, ex.label);
    lossSum += loss;
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

  await Promise.all([
    kvPut(env, KV_KEYS.MODEL, model),
    kvPut(env, KV_KEYS.HELDOUT, heldout)
  ]);

  return {
    ok: true,
    symbolsFetched,
    trainingExamples: trainingExamples.length,
    trainSize: trainSet.length,
    testSize: testSet.length,
    errors: errors.length,
    avgLoss: trainSet.length ? lossSum / trainSet.length : null,
    final_n_trained: model.n_trained,
    heldout_test_accuracy: testAcc,
    heldout_brier: brier,
    heldout_bss: bss,
    is_real_signal: bss != null && bss > 0.02
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
