/* ===========================================
   BPLEONE — Sharpe Ratio of Predictions
   ---
   Brier Skill says "is the brain learning?" Sharpe says "is it making
   money?" Two different questions.

   For each resolved prediction:
     direction = LONG if predProb >= 0.5 else SHORT
     signedReturn = (q.last - entry.px) / entry.px      (if LONG)
                  = -(q.last - entry.px) / entry.px     (if SHORT)
     i.e. "what would a unit bet in the predicted direction have earned?"

   Sharpe = mean(signedReturn) / std(signedReturn)

   We also annualize. The short horizon is roughly 10 minutes ≈ 23,400 such
   periods per trading year (252 days × 6.5h × 60min / 10min). Annualized
   Sharpe = raw_sharpe × sqrt(N).

   Tier targets (annualized):
     > 1.0  → professional grade
     > 2.0  → exceptional
     < 0.5  → not worth running

   Exposes:
     SharpeTracker.record(signedReturn)
     SharpeTracker.score(window=200, periodsPerYear=23400) → { sharpe, annSharpe, mean, std, n }
     SharpeTracker.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_sharpe_v1';
  const MAX_LOG = 500;
  const DEFAULT_WINDOW = 200;
  const DEFAULT_PERIODS_PER_YEAR = 23400; // 252 * 6.5 * 60 / 10 — 10-min periods

  function load() {
    if (typeof localStorage === 'undefined') return { log: [] };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { log: [] };
    } catch (e) { return { log: [] }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function record(signedReturn) {
    if (typeof signedReturn !== 'number' || !isFinite(signedReturn)) return;
    // Clip extreme values to avoid std blow-up from data errors
    const clipped = Math.max(-0.5, Math.min(0.5, signedReturn));
    const state = load();
    state.log.push({ r: +clipped.toFixed(6), t: Date.now() });
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save(state);
  }

  function score(window, periodsPerYear) {
    if (!window) window = DEFAULT_WINDOW;
    if (!periodsPerYear) periodsPerYear = DEFAULT_PERIODS_PER_YEAR;
    const state = load();
    const rows = state.log.slice(-window);
    const n = rows.length;
    if (n < 10) {
      return { sharpe: null, annSharpe: null, mean: null, std: null, n, ready: false };
    }
    const rs = rows.map(r => r.r);
    const mean = rs.reduce((s, v) => s + v, 0) / n;
    const variance = rs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, n - 1);
    const std = Math.sqrt(variance);
    // Use 1e-10 floor instead of 0 to avoid float-precision blowups when
    // all returns are effectively identical (e.g. tightly clamped seed data)
    const sharpe = std > 1e-10 ? mean / std : 0;
    const annSharpe = sharpe * Math.sqrt(periodsPerYear);
    return {
      sharpe,
      annSharpe,
      mean,
      std,
      n,
      periodsPerYear,
      ready: true
    };
  }

  function tier(annSharpe) {
    if (annSharpe == null) return 'idle';
    if (annSharpe < 0) return 'losing';
    if (annSharpe < 0.5) return 'weak';
    if (annSharpe < 1.0) return 'fair';
    if (annSharpe < 1.5) return 'good';
    if (annSharpe < 2.5) return 'excellent';
    return 'world-class';
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.SharpeTracker = {
    record,
    score,
    tier,
    reset,
    DEFAULT_WINDOW,
    DEFAULT_PERIODS_PER_YEAR
  };
})();
