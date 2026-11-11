/* ===========================================
   BPLEONE — Historical Bootstrap Trainer
   ---
   Problem: the brain learns only from going-forward live ticks. It takes
   WEEKS for BSS to become meaningful because we accumulate trades slowly.

   Fix: on first visit (or manual trigger), fetch daily OHLC bars for
   every symbol, reconstruct features and outcomes
   from those bars, and pre-train ModelStore + Calibrator + BSS + Sharpe
   etc. before live trading even begins.

   For each (symbol, day) pair:
     1. Build features from the daily bar + market context (SPY return, etc)
     2. Outcome = (next day's close > today's close) ? 1 : 0
     3. Feed (features, outcome) to the brain via the same training paths
        that continuous-learner uses

   This gives the brain ~30 days × 22 symbols = ~660 real training
   examples on day one. BSS converges within minutes of opening the site,
   not weeks.

   Sources (audit 2026-11-11, pass 339; a browser can never read Stooq):
     1. Finnhub /stock/candle, only for a key that passed a one-call probe
        (a free key gets 403: the endpoint is parked for 7 days);
     2. the Worker's /brain/bars: real daily OHLCV for every equity in one
        request (~40 finished sessions);
     3. Coinbase daily candles for BTC/ETH.

   Runs ONCE per browser (gated by localStorage flag). Manual trigger
   available via HistoricalBootstrap.run({ force: true }).

   Exposes:
     HistoricalBootstrap.run(opts?) → { fetched, trained, errors }
     HistoricalBootstrap.status() → progress + completion state
     HistoricalBootstrap.reset() — clear the flag so it runs again
   =========================================== */

(function () {
  // Audit pass 69: bump state key to v2 so existing browsers re-run bootstrap
  // with the deeper 250-day window + expanded universe. Old v1 entries stay
  // in localStorage (unused) until a future cleanup.
  const STATE_KEY = 'bpleone_hist_bootstrap_v2';
  // Audit pass 69: 60 → 250 (~1 trading year). Bumps training examples per
  // symbol from ~46 (60 days minus warmup + look-ahead) to ~236, so total
  // examples grow from ~660 → ~11,000 across the expanded universe below.
  const BOOTSTRAP_DAYS = 250;

  // Audit pass 69: expanded from 25 → 47 symbols across sectors, factors,
  // bonds, vol, international, and crypto so the brain sees a wide regime
  // surface during bootstrap. Bonds + vol + dollar are especially helpful
  // for the regime classifier. (Pass 339: was a Stooq ticker map; every
  // equity here is in the Worker UNIVERSE, so /brain/bars serves them all.)
  const SYMBOLS = [
    'SPY', 'QQQ', 'IWM', 'DIA',                                   // broad indices
    'AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'NFLX', 'ORCL',      // mega-tech
    'NVDA', 'AMD', 'SMCI', 'AVGO', 'MU',                          // semis
    'TSLA', 'PLTR', 'CRM', 'SHOP', 'COIN',                        // software / growth
    'JPM', 'BAC', 'GS',                                           // financials
    'XLE', 'XLF', 'XLK', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU',       // sector ETFs
    'GLD', 'SLV', 'USO',                                          // commodities + metals
    'TLT', 'IEF', 'HYG', 'LQD',                                   // bonds + rates
    'VIX', 'VXX',                                                 // volatility
    'BABA', 'FXI', 'EWJ', 'INDA',                                 // international
    'UBER',                                                       // gig / consumer
    'BTC', 'ETH'                                                  // crypto (Coinbase)
  ];

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(STATE_KEY);
      return j ? JSON.parse(j) : defaultState();
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return {
      completed: false,
      runningAt: 0,
      lastRunAt: 0,
      lastRunResult: null,
      symbolsFetched: 0,
      trainingExamples: 0
    };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Audit 2026-11-11 (pass 339): the browser can read neither of the old history sources. Stooq sends no CORS
  // headers ("Failed to fetch" from options.bpleone.com, checked live; pass 177 saw 48 of 48 fail), and Finnhub's
  // /stock/candle is a paid endpoint (a free key gets 403). Every run fired ~48 failed Stooq requests, plus ~48
  // refused Finnhub calls for a keyed visitor that spent the same 60-a-minute budget the quote feed needs, and
  // WeeklyRefresh retried the whole run every hour because it never trained a row. Sources now, in order:
  //   1. Finnhub /stock/candle, only for a key whose first call succeeded (401/403 parks the endpoint 7 days;
  //      429 stops the run), paced 1.1 s a call;
  //   2. the Worker's /brain/bars: real daily OHLCV for every equity in ONE request (about 40 sessions; an
  //      unfinished bar for today is dropped);
  //   3. Coinbase daily candles for BTC/ETH (public, CORS-enabled; today's open candle is dropped).
  const FH_CANDLE_KEY = 'bpleone_fh_candle_v1';
  const FH_CANDLE_PARK_MS = 7 * 24 * 3600 * 1000;
  const FH_PACE_MS = 1100;
  const DEFAULT_WORKER = 'https://bpleone-brain-worker.brandonpleone.workers.dev';
  const COINBASE_PAIRS = { BTC: 'BTC-USD', ETH: 'ETH-USD' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getFinnhubKey() {
    try {
      const raw = localStorage.getItem('bpleone_data_v1');
      if (!raw) return null;
      const c = JSON.parse(raw);
      return (c && c.provider === 'finnhub' && c.apiKey) ? c.apiKey : null;
    } catch (e) { return null; }
  }

  function candleParked() {
    try {
      const j = JSON.parse(localStorage.getItem(FH_CANDLE_KEY) || 'null');
      return !!(j && j.deniedAt && Date.now() - j.deniedAt < FH_CANDLE_PARK_MS);
    } catch (e) { return false; }
  }
  function parkCandle(status) {
    try { localStorage.setItem(FH_CANDLE_KEY, JSON.stringify({ deniedAt: Date.now(), status })); } catch (e) {}
  }
  // True when a Finnhub key is saved and its candle access has not been refused in the last 7 days.
  function candleAccess() { return !!getFinnhubKey() && !candleParked(); }

  function recordFetch(src, ok, t0) {
    try { if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch(src, ok, Date.now() - t0); } catch (e) {}
  }

  async function timedFetch(url, ms) {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timeoutId = ctrl ? setTimeout(() => ctrl.abort(), ms || 10000) : null;
    try {
      return await fetch(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // ET calendar day (YYYY-MM-DD) of a timestamp: bars are ET sessions.
  function etDay(ts) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ts)); }
    catch (e) { return new Date(ts).toISOString().slice(0, 10); }
  }

  // Bars for one symbol from Finnhub /stock/candle; null when it has no data; 'stop' when Finnhub refused
  // (401/403: parked for 7 days; 429: rate limit) or no key is usable, so the caller makes no further calls.
  // One pace for every candle call on the page (this module and auto-trainer.js share this function), so two
  // trainers running back to back never put more than ~55 calls in a minute.
  let lastCandleAt = 0;
  async function fetchFinnhubHistorical(sym, days) {
    const key = getFinnhubKey();
    if (!key || candleParked()) return 'stop';
    const wait = lastCandleAt + FH_PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCandleAt = Date.now();
    days = days || 250;
    const now = Math.floor(Date.now() / 1000);
    const from = now - Math.ceil(days * 1.5) * 86400;   // calendar days for ~`days` sessions
    const fhSym = sym === 'BTC' ? 'BINANCE:BTCUSDT' : sym === 'ETH' ? 'BINANCE:ETHUSDT' : sym;
    const url = 'https://finnhub.io/api/v1/stock/candle?symbol=' + encodeURIComponent(fhSym) + '&resolution=D&from=' + from + '&to=' + now + '&token=' + encodeURIComponent(key);
    const t0 = Date.now();
    try {
      const res = await timedFetch(url, 10000);
      recordFetch('finnhub-hist', res.ok, t0);
      if (res.status === 401 || res.status === 403) { parkCandle(res.status); return 'stop'; }
      if (res.status === 429) return 'stop';
      if (!res.ok) return null;
      const j = await res.json();
      if (j.s !== 'ok' || !Array.isArray(j.c) || j.c.length === 0) return null;
      // Finnhub format: { c:[closes], h:[highs], l:[lows], o:[opens], t:[timestamps], v:[volumes] }
      const out = [];
      const today = etDay(Date.now());
      for (let i = 0; i < j.c.length; i++) {
        const o = j.o[i], h = j.h[i], l = j.l[i], c = j.c[i];
        if (!(c > 0 && o > 0 && h > 0 && l > 0)) continue;   // never fill a missing field with another one
        const ts = j.t[i] * 1000;
        if (etDay(ts) === today) continue;                   // today's bar is not a finished session
        out.push({ date: etDay(ts), ts, open: o, high: h, low: l, close: c, volume: j.v[i] || 0 });
      }
      return out.slice(-days);
    } catch (e) {
      recordFetch('finnhub-hist', false, t0);
      return null;
    }
  }

  function workerUrl() {
    try {
      if (window.WorkerBridge && typeof window.WorkerBridge.getUrl === 'function') {
        const u = window.WorkerBridge.getUrl();
        if (u && /^https:\/\//.test(u)) return u.replace(/\/$/, '');
      }
    } catch (e) {}
    return DEFAULT_WORKER;
  }

  // Real daily OHLCV for many equities in one request. Drops today's bar unless the Worker has finalized it
  // (fin=1): before the evening finalize it is a morning snapshot overlaid with a delayed quote.
  async function fetchWorkerBars(syms) {
    const out = {};
    if (!syms.length) return out;
    const t0 = Date.now();
    try {
      const res = await timedFetch(workerUrl() + '/brain/bars?days=40&syms=' + syms.join(','), 15000);
      recordFetch('worker-bars', res.ok, t0);
      if (!res.ok) return out;
      const j = await res.json();
      const all = (j && j.bars) || {};
      const today = etDay(Date.now());
      for (const sym of syms) {
        const rows = Array.isArray(all[sym]) ? all[sym] : [];
        const bars = [];
        for (const b of rows) {
          if (!b || !(b.c > 0 && b.o > 0 && b.h > 0 && b.l > 0) || !b.ts) continue;
          if (etDay(b.ts) === today && !b.fin) continue;
          bars.push({ date: etDay(b.ts), ts: b.ts, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v || 0 });
        }
        if (bars.length) out[sym] = bars;
      }
    } catch (e) {
      recordFetch('worker-bars', false, t0);
    }
    return out;
  }

  // Coinbase daily candles: [[time, low, high, open, close, volume], ...], newest first, up to 300.
  async function fetchCoinbaseDaily(sym) {
    const pair = COINBASE_PAIRS[sym];
    if (!pair) return null;
    const t0 = Date.now();
    try {
      const res = await timedFetch('https://api.exchange.coinbase.com/products/' + pair + '/candles?granularity=86400', 10000);
      recordFetch('coinbase-hist', res.ok, t0);
      if (!res.ok) return null;
      const rows = await res.json();
      if (!Array.isArray(rows)) return null;
      const todayUtc = new Date().toISOString().slice(0, 10);   // Coinbase days are UTC
      return rows
        .filter(r => Array.isArray(r) && r[1] > 0 && r[2] > 0 && r[3] > 0 && r[4] > 0)
        .map(r => ({ date: new Date(r[0] * 1000).toISOString().slice(0, 10), ts: r[0] * 1000, open: r[3], high: r[2], low: r[1], close: r[4], volume: r[5] || 0 }))
        .filter(b => b.date !== todayUtc)
        .sort((a, b) => a.ts - b.ts);
    } catch (e) {
      recordFetch('coinbase-hist', false, t0);
      return null;
    }
  }

  // Every symbol's history, fetched up front. Returns { bars: {SYM: [...]}, sources: {SYM: 'finnhub-candle' |
  // 'worker-bars' | 'coinbase'}, requests }.
  async function fetchAllHistory(syms) {
    const bars = {}, sources = {};
    let requests = 0;
    if (candleAccess()) {
      for (let k = 0; k < syms.length; k++) {
        const r = await fetchFinnhubHistorical(syms[k], BOOTSTRAP_DAYS);
        requests++;
        if (r === 'stop') break;
        if (r && r.length) { bars[syms[k]] = r; sources[syms[k]] = 'finnhub-candle'; }   // paced inside the fetch
      }
    }
    const missing = syms.filter(s => !bars[s] && !COINBASE_PAIRS[s]);
    if (missing.length) {
      const wb = await fetchWorkerBars(missing);
      requests++;
      for (const s of Object.keys(wb)) { bars[s] = wb[s]; sources[s] = 'worker-bars'; }
    }
    for (const s of syms) {
      if (bars[s] || !COINBASE_PAIRS[s]) continue;
      const cb = await fetchCoinbaseDaily(s);
      requests++;
      if (cb && cb.length) { bars[s] = cb; sources[s] = 'coinbase'; }
    }
    return { bars, sources, requests };
  }

  // RSI(14) from a series of closes
  function rsi14(closes, idx) {
    if (idx < 14) return 50;
    let gains = 0, losses = 0;
    for (let i = idx - 13; i <= idx; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / 14, avgLoss = losses / 14;
    // Audit pass 44: flat-price case (avgGain=0 AND avgLoss=0) used to return
    // 100 here because the avgLoss===0 branch caught it first. RSI=100 is
    // wrong for a stalled tape — the correct neutral is 50.
    if (avgGain === 0 && avgLoss === 0) return 50;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // ATR% rough proxy: 14-day average daily range / close
  function atrPct(bars, idx) {
    if (idx < 14) return 1.5;
    let sumRange = 0;
    for (let i = idx - 13; i <= idx; i++) {
      sumRange += (bars[i].high - bars[i].low);
    }
    const avgRange = sumRange / 14;
    return bars[idx].close > 0 ? (avgRange / bars[idx].close) * 100 : 1.5;
  }

  // % distance from N-day SMA
  function distPctFromSMA(closes, idx, n) {
    if (idx < n - 1) return 0;
    let sum = 0;
    for (let i = idx - n + 1; i <= idx; i++) sum += closes[i];
    const sma = sum / n;
    return sma > 0 ? ((closes[idx] - sma) / sma) * 100 : 0;
  }

  // Build a 22-feature vector from a historical bar
  function featuresFromBar(bars, idx, spyBars, spyIdx) {
    if (idx < 1 || idx >= bars.length) return null;
    const closes = bars.map(b => b.close);
    const spyCloses = spyBars ? spyBars.map(b => b.close) : null;
    const bar = bars[idx];
    const prev = bars[idx - 1];

    const f = new Array(22).fill(0);
    f[0] = Math.max(0, Math.min(1, rsi14(closes, idx) / 100));
    f[1] = Math.max(0, Math.min(1, atrPct(bars, idx) / 10));
    f[2] = Math.max(0, Math.min(1, (bar.volume / Math.max(1, prev.volume * 1.5))));
    f[3] = Math.max(-1, Math.min(1, distPctFromSMA(closes, idx, 50) / 10));
    f[4] = Math.max(-1, Math.min(1, distPctFromSMA(closes, idx, 200) / 20));
    if (spyCloses && spyIdx > 0 && spyIdx < spyBars.length) {
      const spyChg = (spyCloses[spyIdx] - spyCloses[spyIdx - 1]) / spyCloses[spyIdx - 1] * 100;
      f[5] = Math.max(-1, Math.min(1, spyChg / 5));
    }
    f[6] = f[5]; // sector strength proxy — use SPY for now (would need sector mapping for accuracy)
    f[7] = 0.5;  // beta — unknown without per-symbol calibration, use neutral
    f[8] = 0.5;  // spread bps proxy — no intraday data, use neutral
    f[9] = 0.5;  // iv percentile proxy — needs options data
    f[10] = 0.33; // severity baseline (normalized to 1/3 since 1 is typical)
    // Setup flags — derive from price action
    const ret = (bar.close - prev.close) / prev.close;
    f[11] = ret > 0.01 ? 1 : 0;       // is_bull_setup
    f[12] = ret < -0.01 ? 1 : 0;      // is_bear_setup
    f[13] = Math.abs(ret) > 0.015 ? 1 : 0; // is_momentum
    // Audit pass 44: was `idx >= 1` but the next line accesses bars[idx-2].
    // At idx=1, bars[idx-2] is undefined → fell back to prev.close → prevRet=0
    // → sign(0)=0 ≠ sign(ret) almost always → false reversion=1 at every idx=1.
    // Require idx >= 2 so we actually have a 2-day prior close.
    if (idx >= 2) {
      const prevPrev = bars[idx - 2].close;
      const prevRet = prevPrev > 0 ? (prev.close - prevPrev) / prevPrev : 0;
      f[14] = (Math.sign(ret) !== 0 && Math.sign(prevRet) !== 0 && Math.sign(ret) !== Math.sign(prevRet)) ? 1 : 0;
    } else {
      f[14] = 0;
    }
    f[15] = idx >= 20 && bar.close > Math.max(...closes.slice(Math.max(0, idx-20), idx)) ? 1 : 0; // is_breakout
    f[16] = 0.5; // brain weight neutral
    f[17] = 0.5; // regime score neutral
    f[18] = 0.5; // vix neutral
    f[19] = 0;   // coincident count zero historical
    f[20] = 0.5; // hour neutral
    f[21] = 1;   // bias
    return f;
  }

  async function run(opts) {
    opts = opts || {};
    const state = load();
    if (state.completed && !opts.force) {
      return { skipped: true, reason: 'already-completed', state };
    }
    if (state.runningAt && Date.now() - state.runningAt < 5 * 60 * 1000) {
      return { skipped: true, reason: 'already-running', state };
    }
    // Pass 339: never overlap the auto-trainer (even when forced). It already defers to this run; without the
    // reverse check the two could train the same model at once (the pass-168 race) and, with a Finnhub key,
    // run two paced candle loops side by side at twice the per-minute budget.
    if (typeof window !== 'undefined' && window._autoTrainerRunning) {
      return { skipped: true, reason: 'auto-trainer-running', state };
    }
    // Pass 199: defer when WorkerBridge is the authoritative brain. The
    // Cloudflare Worker's /brain/bootstrap endpoint already trained on 250-day
    // Yahoo Finance history server-side; running this browser-side bootstrap
    // again would (a) re-train the worker-mirrored model with stale Stooq
    // data, (b) get overwritten by next syncFromWorker anyway, (c) trip an
    // OOD detector that compares live features to "bootstrap distribution".
    // Skip silently — caller can pass opts.force = true to override.
    if (!opts.force && typeof window !== 'undefined' && window.WorkerBridge &&
        typeof window.WorkerBridge.isEnabled === 'function' &&
        window.WorkerBridge.isEnabled()) {
      return { skipped: true, reason: 'worker-bridge-authoritative', state };
    }
    state.runningAt = Date.now();
    save(state);

    // Audit pass 169: claim the global model-training lock so continuous-learner
    // skips its save() during this multi-minute run. Auto-trainer already
    // reads this flag (line 169). Without setting it here, CL's 30s-tick saves
    // would silently overwrite each per-symbol training increment.
    window._historicalTrainerRunning = true;

    // Need ModelStore + FeatureExtractor + BrierSkill etc to be loaded
    if (typeof window === 'undefined') return { error: 'no-window' };
    const ModelStore = window.ModelStore;
    if (!ModelStore) {
      state.runningAt = 0;
      save(state);
      window._historicalTrainerRunning = false;
      return { error: 'ModelStore not loaded' };
    }
    const model = ModelStore.load();
    if (!model || typeof model.train !== 'function') {
      state.runningAt = 0;
      save(state);
      window._historicalTrainerRunning = false;
      return { error: 'Model not available' };
    }

    // Pass 339: fetch every symbol's history up front (one Worker request on the zero-key path), then train.
    const hist = await fetchAllHistory(SYMBOLS);
    const spyBars = hist.bars.SPY || null;

    // Persist SPY bars for the Brain-vs-SPY benchmark module. Lightweight
    // (60 bars × {ts, close}) so it fits comfortably in localStorage.
    try {
      if (spyBars && spyBars.length > 0) {
        const compact = spyBars.map(b => ({ ts: b.ts || (b.date ? new Date(b.date).getTime() : Date.now()), close: b.close }));
        localStorage.setItem('bpleone_spy_history_v1', JSON.stringify(compact));
      }
    } catch (e) {}

    let symbolsFetched = 0, trainingExamples = 0, errors = [];

    for (const sym of SYMBOLS) {
      try {
        let bars = hist.bars[sym];
        // Crypto trades every day: keep no more bars than SPY has, so the SPY-context offset stays >= 0.
        if (bars && COINBASE_PAIRS[sym] && spyBars) bars = bars.slice(-spyBars.length);
        if (!bars || bars.length < 20) {
          errors.push({ sym, reason: 'insufficient-data' });
          continue;
        }
        symbolsFetched++;
        const recent = bars.slice(-BOOTSTRAP_DAYS);
        // Pass 218m: predict 5-day forward direction at +/- 1pp threshold
        // (matches worker bootstrap from pass 206 and live training horizon
        // from pass 218). Was 1-day +/- 0.3pp which is famously near-random
        // on liquid stocks and conflicts with everything else in the system.
        // FWD_DAYS=5 so we iterate up to recent.length - FWD_DAYS.
        const FWD_DAYS = 5;
        const LABEL_THRESHOLD = 0.01;
        for (let i = 14; i < recent.length - FWD_DAYS; i++) {
          const features = featuresFromBar(recent, i, spyBars, spyBars ? Math.max(0, spyBars.length - recent.length + i) : -1);
          if (!features) continue;
          const future = recent[i + FWD_DAYS];
          const ret = (future.close - recent[i].close) / recent[i].close;
          const label = ret > LABEL_THRESHOLD ? 1 : (ret < -LABEL_THRESHOLD ? 0 : null);
          if (label === null) continue;

          // Run the model's prediction BEFORE training to feed BSS/Sharpe correctly
          let predProb = 0.5;
          try {
            const pred = model.predict(features);
            if (pred && typeof pred.prob === 'number') predProb = pred.prob;
          } catch (e) {}

          // Train the model
          try {
            model.train(features, label);
          } catch (e) {}

          // Also feed all the learning modules so they bootstrap too
          try {
            if (window.Calibrator) window.Calibrator.recordPair(predProb, label);
          } catch (e) {}
          try {
            if (window.IsotonicCalibrator) window.IsotonicCalibrator.recordPair(predProb, label);
          } catch (e) {}
          try {
            if (window.RegimeCalibrator) window.RegimeCalibrator.recordPair(predProb, label, 'mixed');
          } catch (e) {}
          try {
            if (window.BrierSkill) window.BrierSkill.record(predProb, label);
          } catch (e) {}
          try {
            if (window.SharpeTracker) {
              const predUp = predProb >= 0.5;
              const signedRet = predUp ? ret : -ret;
              window.SharpeTracker.record(signedRet);
            }
          } catch (e) {}
          try {
            if (window.SymbolSkill) window.SymbolSkill.record(sym, predProb, label);
          } catch (e) {}
          try {
            if (window.SymbolSharpe) {
              const predUp = predProb >= 0.5;
              window.SymbolSharpe.record(sym, predUp ? ret : -ret);
            }
          } catch (e) {}
          try {
            if (window.SectorPerf) {
              const predUp = predProb >= 0.5;
              window.SectorPerf.record(sym, predProb, label, predUp ? ret : -ret);
            }
          } catch (e) {}
          try {
            if (window.ReliabilityDiagram) window.ReliabilityDiagram.recordPair(predProb, label);
          } catch (e) {}
          try {
            if (window.PredictionHistogram) window.PredictionHistogram.record(predProb);
          } catch (e) {}
          try {
            if (window.SymbolBias) window.SymbolBias.update(sym, label, predProb);
          } catch (e) {}

          trainingExamples++;
        }
      } catch (e) {
        errors.push({ sym, reason: e.message });
      }
    }

    // Persist the trained model
    try { ModelStore.save(model); } catch (e) {}

    // Fit calibrators
    try { if (window.Calibrator && window.Calibrator.fit) window.Calibrator.fit(); } catch (e) {}
    try { if (window.IsotonicCalibrator && window.IsotonicCalibrator.fit) window.IsotonicCalibrator.fit(); } catch (e) {}
    try { if (window.RegimeCalibrator && window.RegimeCalibrator.fitAll) window.RegimeCalibrator.fitAll(); } catch (e) {}

    state.completed = true;
    state.runningAt = 0;
    state.lastRunAt = Date.now();
    state.symbolsFetched = symbolsFetched;
    state.trainingExamples = trainingExamples;
    const sourceCounts = {};
    Object.values(hist.sources).forEach(src => { sourceCounts[src] = (sourceCounts[src] || 0) + 1; });
    state.lastRunResult = { symbolsFetched, trainingExamples, errorCount: errors.length, sources: sourceCounts, requests: hist.requests };
    save(state);
    // Release the model-training lock so continuous-learner can resume saving.
    window._historicalTrainerRunning = false;

    // Notify subscribers
    try {
      window.dispatchEvent(new CustomEvent('bpleone:hist-bootstrap-done', {
        detail: { symbolsFetched, trainingExamples, errors: errors.length }
      }));
    } catch (e) {}

    // Audit pass 21: return both naming conventions so WeeklyRefresh +
    // historical-bootstrap.html dashboards both work. Previously WeeklyRefresh
    // looked for result.trainingExamples but we only returned result.trained,
    // so it never recorded a successful refresh.
    return {
      fetched: symbolsFetched,
      trained: trainingExamples,
      symbolsFetched,
      trainingExamples,
      sources: sourceCounts,
      requests: hist.requests,
      errors
    };
  }

  function status() {
    return load();
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STATE_KEY);
  }

  // Auto-trigger on first visit: 8s after DOMContentLoaded, gives other
  // brain modules time to load
  function autoTrigger() {
    if (typeof document === 'undefined') return;
    setTimeout(() => {
      const s = load();
      if (!s.completed) run().catch(() => {});
    }, 8000);
  }

  // fetchCandles/candleAccess are shared with auto-trainer.js (the one place it can get 60+ sessions of OHLCV).
  window.HistoricalBootstrap = { run, status, reset, autoTrigger, fetchCandles: fetchFinnhubHistorical, candleAccess, SYMBOLS };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      autoTrigger();
    } else {
      document.addEventListener('DOMContentLoaded', autoTrigger);
    }
  }
})();
