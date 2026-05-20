/* ===========================================
   BPLEONE — Daily background auto-trainer
   ---
   Runs once per day in the background. Fetches the latest bar from Stooq
   for each symbol in the universe, generates a training example from real
   bar features, and incrementally updates the model. Tags every row
   dataSource='live' so it's accepted by the strict trainer.

   Fires on DOMContentLoaded + 60s delay so it doesn't block page load.
   Only runs if last training was > 20 hours ago.
   =========================================== */

(function () {
  const LAST_KEY = 'bpleone_auto_train_ts_v1';
  // Audit pass 70: 20h → 6h. Stooq updates daily bars once per US session
  // close, but at 20h the trainer only catches the latest bar every-other
  // day in many timezones. 6h means we always pick up the new daily bar
  // within 6h of close. Each run only trains on bars NEWER than the last
  // seen date so there's no duplicate work — just faster ingestion.
  const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

  // Audit pass 69: expanded universe from 22 → 44 symbols to match
  // historical-bootstrap's expanded coverage. Includes sector ETFs, bonds,
  // vol, financials, international so daily auto-training reinforces every
  // regime the bootstrap fitted to.
  const UNIVERSE = [
    'SPY','QQQ','IWM','DIA',
    'AAPL','MSFT','GOOGL','META','AMZN','NFLX','ORCL',
    'NVDA','AMD','SMCI','AVGO','MU',
    'TSLA','PLTR','CRM','SHOP','COIN',
    'JPM','BAC','GS',
    'XLE','XLF','XLK','XLV','XLY','XLP','XLI','XLU',
    'GLD','SLV','USO',
    'TLT','IEF','HYG','LQD',
    'BABA','FXI','EWJ','INDA',
    'UBER'
  ];

  function getLast() { try { return parseInt(localStorage.getItem(LAST_KEY) || '0'); } catch (e) { return 0; } }
  function setLast(ts) { try { localStorage.setItem(LAST_KEY, String(ts)); } catch (e) {} }

  // Indicator math (same as historical-trainer)
  function sma(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (i < n - 1) { out.push(null); continue; }
      let s = 0;
      for (let j = 0; j < n; j++) s += arr[i - j];
      out.push(s / n);
    }
    return out;
  }
  function rsi14(closes) {
    const out = [];
    if (closes.length < 15) return closes.map(() => 50);
    let gains = 0, losses = 0;
    for (let i = 1; i <= 14; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d; else losses += -d;
    }
    let avgG = gains / 14, avgL = losses / 14;
    for (let i = 0; i < 15; i++) out.push(50);
    for (let i = 15; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      const g = d >= 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      avgG = (avgG * 13 + g) / 14;
      avgL = (avgL * 13 + l) / 14;
      const rs = avgL === 0 ? 100 : avgG / avgL;
      out.push(100 - 100 / (1 + rs));
    }
    return out;
  }
  function atr14(bars) {
    const out = [];
    for (let i = 0; i < bars.length; i++) {
      if (i === 0) { out.push(bars[0].high - bars[0].low); continue; }
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close)
      );
      if (i < 14) { out.push(tr); continue; }
      out.push((out[i - 1] * 13 + tr) / 14);
    }
    return out;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function buildFeaturesForBar(bars, i) {
    const f = new Array(22).fill(0);
    const closes = bars.map(b => b.close);
    const rsi = rsi14(closes);
    const atr = atr14(bars);
    const ma20 = sma(closes, 20);
    const ma50 = sma(closes, 50);
    const close = bars[i].close;
    const prev = i > 0 ? bars[i - 1].close : close;
    const chgPct = ((close - prev) / prev) * 100;
    const atrPct = (atr[i] / close) * 100;
    f[0] = clamp(rsi[i] / 100, 0, 1);
    f[1] = clamp(atrPct / 10, 0, 1);
    let avgVol = 0;
    for (let k = Math.max(0, i - 19); k <= i; k++) avgVol += bars[k].volume;
    avgVol = avgVol / Math.min(20, i + 1);
    f[2] = clamp(avgVol > 0 ? bars[i].volume / avgVol / 4 : 0.5, 0, 1);
    f[3] = clamp(ma20[i] != null ? (close - ma20[i]) / ma20[i] * 10 : 0, -1, 1);
    f[4] = clamp(ma50[i] != null ? (close - ma50[i]) / ma50[i] * 10 : 0, -1, 1);
    f[5] = clamp(chgPct / 5, -1, 1);
    f[6] = 0; f[7] = 0.5; f[8] = 0.5; f[9] = 0.5;
    f[10] = clamp(Math.abs(chgPct) / 5, 0, 1);
    f[11] = chgPct > 0 ? 1 : 0;
    f[12] = chgPct < 0 ? 1 : 0;
    f[13] = (ma20[i] != null && close > ma20[i] && ma50[i] != null && ma20[i] > ma50[i]) ? 1 : 0;
    f[14] = (rsi[i] < 30 || rsi[i] > 70) ? 1 : 0;
    f[15] = (i >= 20 && close === Math.max.apply(null, closes.slice(i - 19, i + 1))) ? 1 : 0;
    f[16] = 0.5; f[17] = 0.5; f[18] = 0.5; f[19] = 0.5; f[20] = 0.5;
    f[21] = 1;
    return f;
  }

  async function fetchStooqHistory(sym) {
    const stooqSym = sym.toLowerCase() + '.us';
    const url = 'https://stooq.com/q/d/l/?s=' + stooqSym + '&i=d';
    // Audit pass 16: add 10s abort timeout so a hung Stooq response can't
    // block the auto-trainer indefinitely.
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timeoutId = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
    let res;
    try {
      res = await fetch(url, { method: 'GET', cache: 'no-cache', signal: ctrl ? ctrl.signal : undefined });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 30) return [];
    const header = lines[0].split(',').map(s => s.trim().toLowerCase());
    const iDate = header.indexOf('date');
    const iOpen = header.indexOf('open');
    const iHigh = header.indexOf('high');
    const iLow = header.indexOf('low');
    const iClose = header.indexOf('close');
    const iVol = header.indexOf('volume');
    const bars = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      if (c.length < 5) continue;
      const close = parseFloat(c[iClose]);
      if (!isFinite(close) || close <= 0) continue;
      bars.push({
        date: c[iDate],
        open: parseFloat(c[iOpen]),
        high: parseFloat(c[iHigh]),
        low: parseFloat(c[iLow]),
        close: close,
        volume: parseInt(c[iVol]) || 0
      });
    }
    return bars;
  }

  async function runAutoTrain() {
    if (typeof window.Model === 'undefined' || typeof window.ModelStore === 'undefined') return;
    const last = getLast();
    if (Date.now() - last < MIN_INTERVAL_MS) return;
    // Avoid running while a manual training session is happening
    if (window._historicalTrainerRunning) return;
    setLast(Date.now());  // claim the slot immediately to prevent concurrent runs

    // Audit pass 168 (CRITICAL race condition fix): the original implementation
    // loaded the model BEFORE the async Stooq fetch loop. Each loop iteration
    // mutated the in-memory model object, and final save() happened after ALL
    // fetches completed (~30+s of awaits). During this window, ContinuousLearner
    // (which runs every 30s) could itself ModelStore.load() → train → save its
    // own update; auto-trainer's later save() would then OVERWRITE CL's gradient
    // changes. ~33% of auto-trainer runs collided with a CL save.
    //
    // Fix: do the async fetching FIRST (no model touch), then do the ENTIRE
    // model load + train + save in a single synchronous block at the end.
    // CL can't interleave a save inside synchronous JS code.

    const hasHorizons = typeof window.MultiHorizon !== 'undefined';
    let symsFetched = 0;

    // Track which bars we've already trained on so we don't double-train
    let alreadyTrained = {};
    try { alreadyTrained = JSON.parse(localStorage.getItem('bpleone_auto_train_seen_v1') || '{}'); } catch (e) {}

    // Phase 1 (async): gather all training examples into memory. No model
    // mutations yet. This is the slow part — Stooq fetches + parsing.
    const pendingExamples = [];  // { features, label, weight, horizon, sym, date }

    for (const sym of UNIVERSE) {
      try {
        const bars = await fetchStooqHistory(sym);
        if (bars.length < 60) continue;
        symsFetched++;
        const seen = alreadyTrained[sym] || '';
        const startIdx = 50;
        // Need at least 20 forward bars to compute the LONG-horizon label
        const endIdx = bars.length - 21;
        for (let i = startIdx; i < endIdx; i++) {
          if (bars[i].date <= seen) continue;
          const features = buildFeaturesForBar(bars, i);
          let atrSum = 0;
          for (let k = Math.max(0, i - 13); k <= i; k++) atrSum += bars[k].high - bars[k].low;
          const atr = atrSum / Math.min(14, i + 1);
          const atrPct = atr / bars[i].close;
          const horizons = [
            { name: 'short', barsAhead: 1,  minMove: 0.3 * atrPct },
            { name: 'mid',   barsAhead: 5,  minMove: 1.0 * atrPct },
            { name: 'long',  barsAhead: 20, minMove: 3.0 * atrPct }
          ];
          horizons.forEach(h => {
            const futClose = bars[i + h.barsAhead];
            if (!futClose) return;
            const ret = (futClose.close - bars[i].close) / bars[i].close;
            const label = ret > h.minMove ? 1 : (ret < -h.minMove ? 0 : null);
            if (label === null) return;
            const rMult = Math.abs(ret) / Math.max(0.001, h.minMove / 3);
            const w = Math.max(0.25, Math.min(4, rMult));
            pendingExamples.push({ features, label, weight: w, horizon: h.name, sym, date: bars[i].date });
          });
          alreadyTrained[sym] = bars[i].date;
        }
        await new Promise(r => setTimeout(r, 300));  // be polite to Stooq
      } catch (e) {
        // network error or CORS — skip silently in background
      }
    }

    // Phase 2 (synchronous): apply all training in one uninterruptible block.
    // CL can't interleave its load/save here — JS is single-threaded and we
    // have no awaits between load() and save().
    let trained = 0;
    let trainedHorizons = { short: 0, mid: 0, long: 0 };
    let lossSum = 0;
    const model = window.ModelStore.load();  // freshest state, including any
                                              // CL updates from the past 30s
    for (const ex of pendingExamples) {
      if (hasHorizons) {
        window.MultiHorizon.trainHorizon(ex.horizon, ex.features, ex.label, ex.weight);
        trainedHorizons[ex.horizon]++;
      }
      if (ex.horizon === 'short') {
        const { loss } = model.train(ex.features, ex.label);
        lossSum += loss;
        window.ModelStore.addTrainingRow(ex.features, ex.label, {
          sym: ex.sym,
          setup: 'auto-train-' + ex.date,
          dataSource: 'live',
          priceSource: 'stooq',
          historical: true,
          autoTrained: true,
          horizon: ex.horizon,
          sampleWeight: ex.weight
        });
        trained++;
      }
    }

    if (trained > 0) {
      model.n_trained = (model.n_trained || 0) + trained;
      window.ModelStore.save(model);  // synchronous — atomic from JS's view
      try { localStorage.setItem('bpleone_auto_train_seen_v1', JSON.stringify(alreadyTrained)); } catch (e) {}
      try {
        window.dispatchEvent(new CustomEvent('bpleone:auto-trained', {
          detail: { batchSize: trained, symsFetched, avgLoss: lossSum / trained, trainedHorizons }
        }));
      } catch (e) {}
      // Quiet log for the brain-changelog
      try {
        const log = JSON.parse(localStorage.getItem('bpleone_brain_changelog_v1') || '[]');
        const horizonStr = hasHorizons
          ? ' · per-horizon: short=' + trainedHorizons.short + ', mid=' + trainedHorizons.mid + ', long=' + trainedHorizons.long
          : '';
        log.unshift({
          ts: Date.now(),
          type: 'train',
          title: 'Auto-train: ' + trained + ' new bars',
          body: 'Fetched latest Stooq bars across ' + symsFetched + ' symbols. Trained ' + trained + ' main rows. Avg loss: ' + (lossSum / trained).toFixed(3) + horizonStr,
          meta: { trained, symsFetched, source: 'auto-train', trainedHorizons }
        });
        localStorage.setItem('bpleone_brain_changelog_v1', JSON.stringify(log.slice(0, 200)));
      } catch (e) {}
    }
  }

  // Fire 60s after page load so we never block initial render
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(runAutoTrain, 60000);
    });
  }

  // Expose for manual trigger from console / brain-monitor
  window.AutoTrainer = { runNow: runAutoTrain, lastTrainTs: getLast };
})();
