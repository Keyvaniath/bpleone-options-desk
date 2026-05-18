/* ===========================================
   BPLEONE — Historical Bootstrap Trainer
   ---
   Problem: the brain learns only from going-forward live ticks. It takes
   WEEKS for BSS to become meaningful because we accumulate trades slowly.

   Fix: on first visit (or manual trigger), fetch 30+ days of daily OHLC
   bars from Stooq for every symbol, reconstruct features and outcomes
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

   Stooq historical CSV format:
     https://stooq.com/q/d/l/?s=SPY.US&i=d
     -> Date,Open,High,Low,Close,Volume

   Runs ONCE per browser (gated by localStorage flag). Manual trigger
   available via HistoricalBootstrap.run({ force: true }).

   Exposes:
     HistoricalBootstrap.run(opts?) → { fetched, trained, errors }
     HistoricalBootstrap.status() → progress + completion state
     HistoricalBootstrap.reset() — clear the flag so it runs again
   =========================================== */

(function () {
  const STATE_KEY = 'bpleone_hist_bootstrap_v1';
  const BOOTSTRAP_DAYS = 60;       // pull ~60 days of bars per symbol
  const FETCH_DELAY_MS = 300;      // 300ms between Stooq requests = ~3 req/sec
  const STOOQ_HOST = 'stooq.com';

  // Symbol → Stooq ticker (Stooq uses lowercase suffixes)
  const STOOQ_MAP = {
    SPY: 'spy.us', QQQ: 'qqq.us', IWM: 'iwm.us', DIA: 'dia.us',
    AAPL: 'aapl.us', MSFT: 'msft.us', GOOGL: 'googl.us', META: 'meta.us', AMZN: 'amzn.us',
    NVDA: 'nvda.us', AMD: 'amd.us', SMCI: 'smci.us',
    TSLA: 'tsla.us', PLTR: 'pltr.us', CRM: 'crm.us', SHOP: 'shop.us',
    COIN: 'coin.us',
    XLE: 'xle.us', GLD: 'gld.us', SLV: 'slv.us',
    BABA: 'baba.us', UBER: 'uber.us',
    VIX: '^vix', BTC: 'btcusd', ETH: 'ethusd'
  };

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

  // Fetch CSV: Date,Open,High,Low,Close,Volume — daily bars
  async function fetchHistorical(stooqSym) {
    const url = 'https://' + STOOQ_HOST + '/q/d/l/?s=' + encodeURIComponent(stooqSym) + '&i=d';
    const startTs = Date.now();
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeoutId = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
      const res = await fetch(url, { method: 'GET', cache: 'no-cache', signal: ctrl ? ctrl.signal : undefined });
      if (timeoutId) clearTimeout(timeoutId);
      if (typeof window.DataReliability !== 'undefined') {
        window.DataReliability.recordFetch('stooq-hist', res.ok, Date.now() - startTs);
      }
      if (!res.ok) return null;
      const text = await res.text();
      return parseCsv(text);
    } catch (e) {
      if (typeof window.DataReliability !== 'undefined') {
        window.DataReliability.recordFetch('stooq-hist', false, Date.now() - startTs);
      }
      return null;
    }
  }

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 5) continue;
      const date = cols[0];
      const open = parseFloat(cols[1]);
      const high = parseFloat(cols[2]);
      const low = parseFloat(cols[3]);
      const close = parseFloat(cols[4]);
      const volume = parseInt(cols[5]) || 0;
      if (!isFinite(close) || close <= 0) continue;
      out.push({ date, open, high, low, close, volume });
    }
    return out;
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
    f[14] = idx >= 1 && Math.sign(ret) !== Math.sign((prev.close - (bars[idx-2] ? bars[idx-2].close : prev.close)) / Math.max(0.01, (bars[idx-2] ? bars[idx-2].close : prev.close))) ? 1 : 0; // is_reversion
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
    state.runningAt = Date.now();
    save(state);

    // Need ModelStore + FeatureExtractor + BrierSkill etc to be loaded
    if (typeof window === 'undefined') return { error: 'no-window' };
    const ModelStore = window.ModelStore;
    if (!ModelStore) {
      state.runningAt = 0;
      save(state);
      return { error: 'ModelStore not loaded' };
    }
    const model = ModelStore.load();
    if (!model || typeof model.train !== 'function') {
      state.runningAt = 0;
      save(state);
      return { error: 'Model not available' };
    }

    // Fetch SPY first for market context
    const spyBars = await fetchHistorical(STOOQ_MAP.SPY);
    await new Promise(r => setTimeout(r, FETCH_DELAY_MS));

    // Persist SPY bars for the Brain-vs-SPY benchmark module. Lightweight
    // (60 bars × {ts, close}) so it fits comfortably in localStorage.
    try {
      if (spyBars && spyBars.length > 0) {
        const compact = spyBars.map(b => ({ ts: b.ts || (b.date ? new Date(b.date).getTime() : Date.now()), close: b.close }));
        localStorage.setItem('bpleone_spy_history_v1', JSON.stringify(compact));
      }
    } catch (e) {}

    let symbolsFetched = 0, trainingExamples = 0, errors = [];

    for (const [sym, stooqSym] of Object.entries(STOOQ_MAP)) {
      try {
        const bars = (sym === 'SPY') ? spyBars : await fetchHistorical(stooqSym);
        if (sym !== 'SPY') await new Promise(r => setTimeout(r, FETCH_DELAY_MS));
        if (!bars || bars.length < 20) {
          errors.push({ sym, reason: 'insufficient-data' });
          continue;
        }
        symbolsFetched++;
        const recent = bars.slice(-BOOTSTRAP_DAYS);
        // Need next-day close for outcome, so iterate up to recent.length - 1
        for (let i = 14; i < recent.length - 1; i++) {
          const features = featuresFromBar(recent, i, spyBars, spyBars ? Math.max(0, spyBars.length - recent.length + i) : -1);
          if (!features) continue;
          const next = recent[i + 1];
          const ret = (next.close - recent[i].close) / recent[i].close;
          // Outcome label: predicted-LONG wins if ret > 0.3% (matches HORIZON_MIN_MOVE.short)
          const label = ret > 0.003 ? 1 : (ret < -0.003 ? 0 : null);
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
    state.lastRunResult = { symbolsFetched, trainingExamples, errorCount: errors.length };
    save(state);

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

  window.HistoricalBootstrap = { run, status, reset, autoTrigger };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      autoTrigger();
    } else {
      document.addEventListener('DOMContentLoaded', autoTrigger);
    }
  }
})();
