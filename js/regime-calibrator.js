/* ===========================================
   BPLEONE — Regime-Stratified Calibrator
   ---
   A single Platt scaler averages calibration across all market regimes.
   But a model that's well-calibrated in calm markets (when it says 70%
   it really wins 70%) is often overconfident in high-vol markets (when
   it says 70% it only wins 55%).

   Solution: maintain a separate Platt scaler PER REGIME, dispatch based
   on current market conditions at predict time. Falls back to the global
   calibrator when a regime has too few samples.

   Regimes:
     'bull'      — SPY day chg > +0.5%, VIX < 18
     'bear'      — SPY day chg < -0.5%, VIX < 25
     'chop'      — |SPY day chg| < 0.5%, VIX < 22
     'high-vol'  — VIX >= 22 OR |SPY day chg| > 1.5%
     'mixed'     — everything else (fallback)

   Exposes:
     RegimeCalibrator.recordPair(rawProb, win, regime)
     RegimeCalibrator.calibrate(rawProb, regime) → calibratedProb
     RegimeCalibrator.classifyRegime() → 'bull' | 'bear' | 'chop' | 'high-vol' | 'mixed'
     RegimeCalibrator.stats() → per-regime { n, fitted, a, b }
     RegimeCalibrator.fitAll()
   =========================================== */

(function () {
  const KEY_PREFIX = 'bpleone_regime_calib_v1_';
  const REGIMES = ['bull', 'bear', 'chop', 'high-vol', 'mixed'];
  const MAX_PAIRS = 2000;
  const MIN_PAIRS_TO_FIT = 30;

  function loadPairs(regime) {
    if (typeof localStorage === 'undefined') return [];
    try {
      const j = localStorage.getItem(KEY_PREFIX + 'pairs_' + regime);
      return j ? JSON.parse(j) : [];
    } catch (e) { return []; }
  }

  function savePairs(regime, pairs) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(KEY_PREFIX + 'pairs_' + regime, JSON.stringify(pairs.slice(-MAX_PAIRS)));
    } catch (e) {}
  }

  function loadParams(regime) {
    if (typeof localStorage === 'undefined') return null;
    try {
      const j = localStorage.getItem(KEY_PREFIX + 'params_' + regime);
      return j ? JSON.parse(j) : null;
    } catch (e) { return null; }
  }

  function saveParams(regime, params) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(KEY_PREFIX + 'params_' + regime, JSON.stringify(params));
    } catch (e) {}
  }

  function sigmoid(z) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))); }
  function logit(p) {
    const eps = 1e-6;
    const c = Math.max(eps, Math.min(1 - eps, p));
    return Math.log(c / (1 - c));
  }

  // Classify current market regime from SPY day change + VIX
  function classifyRegime(spyChg, vix) {
    // Try to read live snapshot if not provided
    if (spyChg == null || vix == null) {
      if (typeof QUOTES !== 'undefined') {
        if (spyChg == null && QUOTES.SPY) spyChg = QUOTES.SPY.changePct;
        if (vix == null && QUOTES.VIX) vix = QUOTES.VIX.last;
      }
    }
    if (spyChg == null) spyChg = 0;
    if (vix == null) vix = 18;

    if (vix >= 22 || Math.abs(spyChg) > 1.5) return 'high-vol';
    if (spyChg > 0.5 && vix < 18) return 'bull';
    if (spyChg < -0.5 && vix < 25) return 'bear';
    if (Math.abs(spyChg) < 0.5 && vix < 22) return 'chop';
    return 'mixed';
  }

  // Audit pass 80: CRITICAL — MultiHorizon.detectRegime() returns the names
  // 'trending_bull' / 'choppy' / 'volatile_bear'. continuous-learner passes
  // those into RegimeCalibrator.recordPair(p, w, entry.regime). But this
  // module's REGIMES are 'bull','bear','chop','high-vol','mixed' — none of
  // MultiHorizon's names matched, so EVERY pair was being bucketed as
  // 'mixed' (the fallback). Per-regime calibration was completely inert;
  // unified-predictor's per-regime lookup always missed and fell back to
  // global Platt. Fix: normalize MultiHorizon's names to ours.
  function normalizeRegime(regime) {
    if (!regime) return null;
    if (REGIMES.indexOf(regime) !== -1) return regime;  // already valid
    // MultiHorizon → RegimeCalibrator
    if (regime === 'trending_bull') return 'bull';
    if (regime === 'choppy') return 'chop';
    if (regime === 'volatile_bear') return 'bear';
    // Legacy: also accept some plausible variants
    if (regime === 'high_vol' || regime === 'high vol') return 'high-vol';
    return 'mixed';
  }

  function recordPair(rawProb, win, regime) {
    if (typeof rawProb !== 'number' || (win !== 0 && win !== 1)) return;
    regime = normalizeRegime(regime) || classifyRegime();
    if (REGIMES.indexOf(regime) === -1) regime = 'mixed';
    const pairs = loadPairs(regime);
    pairs.push({ p: +rawProb.toFixed(4), w: win, ts: Date.now() });
    savePairs(regime, pairs);
  }

  // Platt fit on per-regime pair set
  function fitRegime(regime, opts) {
    opts = opts || {};
    const pairs = loadPairs(regime);
    if (pairs.length < MIN_PAIRS_TO_FIT) return null;
    const data = pairs.slice(-1000).map(p => ({ x: logit(p.p), y: p.w }));
    let a = 1.0, b = 0.0;
    const lr = 0.05;
    const epochs = opts.epochs || 150;
    for (let epoch = 0; epoch < epochs; epoch++) {
      let gradA = 0, gradB = 0;
      data.forEach(({ x, y }) => {
        const p = sigmoid(a * x + b);
        const e = p - y;
        gradA += e * x;
        gradB += e;
      });
      a -= lr * gradA / data.length;
      b -= lr * gradB / data.length;
    }
    const params = { a, b, fittedAt: Date.now(), n: pairs.length, regime };
    saveParams(regime, params);
    return params;
  }

  function fitAll() {
    const result = {};
    for (const r of REGIMES) {
      result[r] = fitRegime(r);
    }
    return result;
  }

  // Apply per-regime calibration. If no params for this regime, falls back
  // to the global Calibrator, then identity.
  function calibrate(rawProb, regime) {
    regime = normalizeRegime(regime) || classifyRegime();   // pass 80
    if (REGIMES.indexOf(regime) === -1) regime = 'mixed';
    const params = loadParams(regime);
    if (params && typeof params.a === 'number') {
      return sigmoid(params.a * logit(rawProb) + params.b);
    }
    // Fallback chain: global Calibrator → identity
    if (typeof Calibrator !== 'undefined') {
      try {
        const g = Calibrator._loadParams();
        if (g) return Calibrator.calibrate(rawProb);
      } catch (e) {}
    }
    return rawProb;
  }

  function stats() {
    const out = {};
    for (const r of REGIMES) {
      const pairs = loadPairs(r);
      const params = loadParams(r);
      out[r] = {
        n: pairs.length,
        fitted: !!params,
        a: params ? params.a : null,
        b: params ? params.b : null,
        fittedAt: params ? params.fittedAt : null,
        ready: pairs.length >= MIN_PAIRS_TO_FIT
      };
    }
    return out;
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    for (const r of REGIMES) {
      localStorage.removeItem(KEY_PREFIX + 'pairs_' + r);
      localStorage.removeItem(KEY_PREFIX + 'params_' + r);
    }
  }

  // Auto-fit loop — every 10 minutes, refit each regime that has new samples
  let _lastFitTs = 0;
  function _autoFit() {
    try {
      if (Date.now() - _lastFitTs < 9 * 60 * 1000) return;
      fitAll();
      _lastFitTs = Date.now();
    } catch (e) {}
  }

  function start() {
    if (typeof window === 'undefined') return;
    if (window._regimeCalibInterval) return;
    window._regimeCalibInterval = setInterval(_autoFit, 60 * 1000);
  }

  window.RegimeCalibrator = {
    recordPair,
    calibrate,
    classifyRegime,
    fitRegime,
    fitAll,
    stats,
    reset,
    start,
    REGIMES,
    MIN_PAIRS_TO_FIT
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(start, 3000);
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(start, 3000));
    }
  }
})();
