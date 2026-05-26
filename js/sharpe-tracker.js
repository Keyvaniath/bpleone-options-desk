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

   We also annualize via sqrt(N), where N = periods per year.
   Audit pass 67: was 23400 (assuming 10-min returns) but every caller
   (continuous-learner short horizon = 24h, historical-bootstrap = next-day
   close) feeds DAILY returns. That over-reported annSharpe by ~9.6× and
   pushed everything into "world-class" tier. Default is now 252 (trading
   days per year). Callers feeding different cadence can pass periodsPerYear
   explicitly to score().

   Tier targets (annualized):
     > 1.0  → professional grade
     > 2.0  → exceptional
     < 0.5  → not worth running

   Exposes:
     SharpeTracker.record(signedReturn)
     SharpeTracker.score(window=200, periodsPerYear=252) → { sharpe, annSharpe, mean, std, n }
     SharpeTracker.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_sharpe_v1';
  const MAX_LOG = 500;
  const DEFAULT_WINDOW = 200;
  // Pass 218h: post-pass-218 the brain trains on MID (5-day) horizon
  // resolutions, so SharpeTracker.record() is being fed 5-day signed returns,
  // not 1-day. Annualization factor is sqrt(periodsPerYear); going from
  // 252 (daily) -> 50 (5-day) drops sqrt(252)/sqrt(50) = 2.24× over-report.
  // Was 252 (correct for the pre-pass-218 daily-resolution era). Callers
  // can still override via score(window, periodsPerYear) for ad-hoc analysis.
  const DEFAULT_PERIODS_PER_YEAR = 50; // ~50 non-overlapping 5-day windows per year

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
