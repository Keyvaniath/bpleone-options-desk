/* ===========================================
   BPLEONE — Multi-horizon ensemble with regime-aware routing
   ---
   Three logistic regression models trained in parallel on different
   time horizons:
     - short  (1-day  forward outcome)
     - mid    (5-day  forward outcome)
     - long   (20-day forward outcome)

   A regime detector classifies the current market into one of three
   states using VIX level + SPY trend. For every prediction we keep a
   per-(regime × horizon) accuracy log and produce an ensemble probability
   weighted by recent regime performance.

   This is real meta-learning: the system discovers automatically which
   horizon performs best in which regime, without hard-coding.
   =========================================== */

(function () {
  const HORIZONS = ['short', 'mid', 'long'];
  const HORIZON_DAYS = { short: 1, mid: 5, long: 20 };

  const REGIMES = ['trending_bull', 'choppy', 'volatile_bear'];

  // -------- Regime detection --------
  // Inputs:
  //   VIX (or VXX as proxy) — fear gauge
  //   SPY change% today + recent (signed momentum)
  // Output: one of REGIMES
  function detectRegime() {
    if (typeof QUOTES === 'undefined') return { name: 'choppy', vix: null, spyChg: null, reason: 'no-quotes' };
    const vix = QUOTES.VIX && QUOTES.VIX.priceSource && QUOTES.VIX.priceSource !== 'stale-seed' ? QUOTES.VIX.last : null;
    const vxx = QUOTES.VXX && QUOTES.VXX.priceSource && QUOTES.VXX.priceSource !== 'stale-seed' ? QUOTES.VXX.last : null;
    const vixProxy = vix != null ? vix : (vxx != null ? vxx * 0.55 + 5 : null);  // VXX is roughly 0.55×VIX + offset
    const spy = QUOTES.SPY && QUOTES.SPY.priceSource && QUOTES.SPY.priceSource !== 'stale-seed' ? QUOTES.SPY : null;
    const spyChg = spy ? (spy.changePct || 0) : null;

    // If we don't have real data, default to 'choppy' (most conservative)
    if (vixProxy == null || spyChg == null) {
      return { name: 'choppy', vix: vixProxy, spyChg: spyChg, reason: 'insufficient-data' };
    }

    let regime;
    if (vixProxy < 18 && spyChg > 0) regime = 'trending_bull';
    else if (vixProxy > 25 || spyChg < -1.5) regime = 'volatile_bear';
    else regime = 'choppy';

    return { name: regime, vix: vixProxy, spyChg, reason: 'computed' };
  }

  // -------- Per-horizon model store --------
  const HorizonStore = {
    key(horizon) { return 'bpleone_model_h_' + horizon + '_v1'; },
    load(horizon) {
      if (typeof Model === 'undefined') return null;
      try {
        const raw = localStorage.getItem(this.key(horizon));
        const m = new Model();
        if (raw) {
          const data = JSON.parse(raw);
          if (data && data.weights) m.deserialize(data);
        }
        return m;
      } catch (e) { return new Model(); }
    },
    save(horizon, model) {
      try { localStorage.setItem(this.key(horizon), JSON.stringify(model.serialize())); } catch (e) {}
    }
  };

  // -------- Per-(regime,horizon) performance log --------
  const PERF_KEY = 'bpleone_ensemble_perf_v1';
  function loadPerf() { try { return JSON.parse(localStorage.getItem(PERF_KEY) || '{}'); } catch (e) { return {}; } }
  function savePerf(p) { try { localStorage.setItem(PERF_KEY, JSON.stringify(p)); } catch (e) {} }

  function recordOutcome(regime, horizon, correct, predProb) {
    const perf = loadPerf();
    const key = regime + ':' + horizon;
    if (!perf[key]) perf[key] = { n: 0, hits: 0, recent: [] };
    perf[key].n++;
    if (correct) perf[key].hits++;
    perf[key].recent.push({ correct, predProb, ts: Date.now() });
    if (perf[key].recent.length > 50) perf[key].recent.shift();
    savePerf(perf);
  }

  function regimeHorizonAcc(regime, horizon) {
    const perf = loadPerf();
    const key = regime + ':' + horizon;
    const cell = perf[key];
    if (!cell || cell.n < 5) return null;
    const recent = cell.recent.slice(-30);
    return recent.length >= 5 ? recent.filter(r => r.correct).length / recent.length : null;
  }

  // -------- Ensemble prediction --------
  // Returns: { prob, byHorizon: {short, mid, long}, regime, weights: {short, mid, long}, accuracies: {short, mid, long} }
  function predictEnsemble(features) {
    if (!features || !Array.isArray(features)) return null;
    const regime = detectRegime();
    const byHorizon = {};
    const weights = {};
    const accuracies = {};

    HORIZONS.forEach(h => {
      const m = HorizonStore.load(h);
      if (!m) { byHorizon[h] = 0.5; weights[h] = 0; accuracies[h] = null; return; }
      const pred = m.predict(features);
      byHorizon[h] = pred.prob;
      accuracies[h] = regimeHorizonAcc(regime.name, h);
    });

    // Weight by per-regime accuracy. If no history yet, equal weight.
    // Use (acc - 0.5) so a 50%-accurate model gets zero weight (no edge).
    const weightSum = HORIZONS.reduce((sum, h) => {
      const a = accuracies[h];
      if (a == null) { weights[h] = 1 / 3; return sum + 1 / 3; }
      const edge = Math.max(0, a - 0.5);
      weights[h] = edge;
      return sum + edge;
    }, 0);

    if (weightSum === 0) {
      HORIZONS.forEach(h => weights[h] = 1 / 3);
    } else {
      HORIZONS.forEach(h => weights[h] /= weightSum);
    }

    const prob = HORIZONS.reduce((s, h) => s + byHorizon[h] * weights[h], 0);

    return { prob, byHorizon, regime, weights, accuracies };
  }

  function trainHorizon(horizon, features, label, sampleWeight) {
    if (!HORIZONS.includes(horizon)) return null;
    // Pass 203: guard against malformed feature vectors. Caller is supposed to
    // pass FEATURES.length-element array but a stale-schema journal entry or
    // bad upstream caller could pass [] or wrong length — train() would silently
    // loop over a partial range, leaving the upper weights of the per-horizon
    // model un-updated forever.
    const expectedLen = (typeof window !== 'undefined' && window.FEATURES) ? window.FEATURES.length : 22;
    if (!Array.isArray(features) || features.length !== expectedLen) return null;
    if (typeof label !== 'number' || !Number.isFinite(label)) return null;
    const model = HorizonStore.load(horizon);
    if (!model) return null;
    // Model.train returns { loss }. We optionally scale loss-adjusted update by
    // sampleWeight which is used for reward shaping (bigger wins/losses train harder).
    const w = typeof sampleWeight === 'number' && sampleWeight > 0 ? Math.min(5, sampleWeight) : 1.0;
    // Label smoothing — prevents overconfidence by training on y=0.025/0.975
    // instead of hard 0/1. Per-horizon models benefit equally.
    const trainLabel = (typeof window !== 'undefined' && window.LabelSmoothing && window.LabelSmoothing.enabled())
      ? window.LabelSmoothing.smooth(label) : label;
    let totalLoss = 0;
    for (let r = 0; r < w; r++) {
      // Repeat the SGD step `w` times rounded down + a fractional final step
      if (r < Math.floor(w)) {
        const { loss } = model.train(features, trainLabel);
        totalLoss += loss;
      } else {
        // Fractional partial-step: scale via a temporary LR change
        const origLR = model.lr;
        model.lr = origLR * (w - Math.floor(w));
        const { loss } = model.train(features, trainLabel);
        totalLoss += loss * (w - Math.floor(w));
        model.lr = origLR;
      }
    }
    model.n_trained = (model.n_trained || 0) + 1;
    HorizonStore.save(horizon, model);
    return { loss: totalLoss / Math.max(1, w), weight: w };
  }

  // -------- Summary for dashboard --------
  function summary() {
    const regime = detectRegime();
    const perf = loadPerf();
    const cells = {};
    REGIMES.forEach(r => {
      cells[r] = {};
      HORIZONS.forEach(h => {
        const c = perf[r + ':' + h];
        cells[r][h] = c ? { n: c.n, acc: c.n > 0 ? c.hits / c.n : 0, recentAcc: regimeHorizonAcc(r, h) } : { n: 0, acc: 0, recentAcc: null };
      });
    });
    const models = {};
    HORIZONS.forEach(h => {
      const m = HorizonStore.load(h);
      models[h] = m ? {
        n_trained: m.n_trained || 0,
        weightSum: m.weights ? m.weights.reduce((a, b) => a + Math.abs(b), 0) : 0
      } : null;
    });
    return { currentRegime: regime, cells, models };
  }

  window.MultiHorizon = {
    HORIZONS,
    REGIMES,
    HORIZON_DAYS,
    detectRegime,
    predictEnsemble,
    trainHorizon,
    recordOutcome,
    regimeHorizonAcc,
    HorizonStore,
    summary
  };
})();
