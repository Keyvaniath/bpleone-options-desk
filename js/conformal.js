/* ===========================================
   BPLEONE — Split Conformal Prediction
   ---
   MC Dropout gives uncertainty intervals, but they're heuristic — there's
   no guarantee that "90% interval" actually contains the true probability
   90% of the time. Conformal Prediction fixes this with a distribution-free
   coverage guarantee.

   Algorithm (split conformal, regression-style):
     1. Maintain a calibration pool of (predicted, actual) pairs from
        resolved trades.
     2. Score each pair by residual:  s_i = |y_i - p_i|.
     3. For desired miscoverage α (e.g. 0.10 = 90% coverage), find
        q = the ceil((n+1)(1-α))/n quantile of {s_i}.
     4. For a new prediction p, the interval [p - q, p + q] is guaranteed
        (under exchangeability) to contain the true probability with
        probability ≥ 1-α.

   Why this matters:
     - Rigorous coverage: no distributional assumptions
     - Complement to MC dropout: we can compare dropout intervals to
       conformal intervals; if dropout is much tighter, dropout is
       over-confident
     - Empirical coverage tracking: store every (p, y, q) tuple; the
       fraction of times |y - p| <= q is the actual coverage. If we say
       "90%" but get 70%, we know our model is overconfident.

   Exposes:
     Conformal.recordPair(predicted, actual)
     Conformal.interval(predicted, alpha=0.10) → { lo, hi, halfwidth, ready, n }
     Conformal.empiricalCoverage(alpha=0.10) → { coverage, target, n, q }
     Conformal.stats() → { n, q80, q90, q95 }
     Conformal.clear()
   =========================================== */

(function () {
  const KEY = 'bpleone_conformal_v1';
  const MAX_CAL = 1000;       // FIFO cap on calibration set
  const MIN_FOR_INTERVAL = 30; // need ≥30 residuals before producing intervals

  function load() {
    if (typeof localStorage === 'undefined') return { scores: [], log: [] };
    try {
      const j = localStorage.getItem(KEY);
      const s = j ? JSON.parse(j) : { scores: [], log: [] };
      if (!s.scores) s.scores = [];
      if (!s.log) s.log = [];
      return s;
    } catch (e) {
      return { scores: [], log: [] };
    }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function recordPair(predicted, actual) {
    if (predicted == null || actual == null) return;
    if (predicted < 0 || predicted > 1) return;
    if (actual !== 0 && actual !== 1) return;
    const state = load();
    const score = Math.abs(actual - predicted);
    state.scores.push(score);
    state.log.push({ p: predicted, y: actual, s: score, t: Date.now() });
    if (state.scores.length > MAX_CAL) {
      state.scores = state.scores.slice(-MAX_CAL);
      state.log = state.log.slice(-MAX_CAL);
    }
    save(state);
  }

  // Conformal quantile with finite-sample correction:
  //   index = ceil((n+1)(1-α)) - 1   (0-based)
  // Capped at n-1 when (n+1)(1-α) > n.
  function quantile(scores, alpha) {
    if (!scores || scores.length === 0) return null;
    const sorted = [...scores].sort((a, b) => a - b);
    const n = sorted.length;
    let idx = Math.ceil((n + 1) * (1 - alpha)) - 1;
    if (idx < 0) idx = 0;
    if (idx > n - 1) idx = n - 1;
    return sorted[idx];
  }

  function interval(predicted, alpha) {
    if (alpha == null) alpha = 0.10;
    const state = load();
    if (state.scores.length < MIN_FOR_INTERVAL) {
      return { lo: null, hi: null, halfwidth: null, ready: false, n: state.scores.length };
    }
    const q = quantile(state.scores, alpha);
    return {
      lo: Math.max(0, predicted - q),
      hi: Math.min(1, predicted + q),
      halfwidth: q,
      ready: true,
      n: state.scores.length,
      alpha
    };
  }

  // Fraction of (p, y) pairs where |y - p| <= q. Should equal 1-α
  // under correct calibration. If it's less, the model is overconfident.
  function empiricalCoverage(alpha) {
    if (alpha == null) alpha = 0.10;
    const state = load();
    if (state.log.length < MIN_FOR_INTERVAL) {
      return { coverage: null, n: state.log.length, ready: false };
    }
    const q = quantile(state.scores, alpha);
    if (q == null) return { coverage: null, n: 0, ready: false };
    let hits = 0;
    for (const r of state.log) {
      if (Math.abs(r.y - r.p) <= q) hits++;
    }
    return {
      coverage: hits / state.log.length,
      target: 1 - alpha,
      gap: (hits / state.log.length) - (1 - alpha),
      n: state.log.length,
      q,
      ready: true
    };
  }

  function stats() {
    const state = load();
    return {
      n: state.scores.length,
      q80: quantile(state.scores, 0.20),
      q90: quantile(state.scores, 0.10),
      q95: quantile(state.scores, 0.05)
    };
  }

  function clear() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.Conformal = { recordPair, interval, empiricalCoverage, stats, clear, MIN_FOR_INTERVAL };
})();
