/* ===========================================
   BPLEONE — Per-Symbol Sharpe Tracker
   ---
   Same idea as SymbolSkill (per-symbol BSS) but for risk-adjusted return.
   For each resolution, captures the signed return (+if predicted direction
   matched outcome, -if it didn't) per symbol and produces a leaderboard.

   Per-symbol Sharpe answers: which symbols actually MADE MONEY (vs which
   were just statistically correct).

   Exposes:
     SymbolSharpe.record(symbol, signedReturn)
     SymbolSharpe.stats(symbol?, window=100) → per-symbol Sharpe or all
     SymbolSharpe.leaderboard(window=100) → sorted by annSharpe
     SymbolSharpe.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_symbol_sharpe_v1';
  const MAX_PER_SYMBOL = 200;
  const DEFAULT_WINDOW = 100;
  const MIN_TO_SCORE = 10;
  // Audit pass 68: same fix as SharpeTracker pass 67. Was 23400 (10-min
  // periods) but callers (continuous-learner short horizon, historical-
  // bootstrap) feed DAILY returns. Changed to 252 (trading days/year) so
  // annSharpe is reported on the right scale.
  const PERIODS_PER_YEAR = 252;

  function load() {
    if (typeof localStorage === 'undefined') return { bySymbol: {} };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { bySymbol: {} };
    } catch (e) { return { bySymbol: {} }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function record(symbol, signedReturn) {
    if (!symbol || typeof signedReturn !== 'number' || !isFinite(signedReturn)) return;
    const clipped = Math.max(-0.5, Math.min(0.5, signedReturn));
    const state = load();
    if (!state.bySymbol[symbol]) state.bySymbol[symbol] = [];
    state.bySymbol[symbol].push({ r: +clipped.toFixed(6), t: Date.now() });
    if (state.bySymbol[symbol].length > MAX_PER_SYMBOL) {
      state.bySymbol[symbol] = state.bySymbol[symbol].slice(-MAX_PER_SYMBOL);
    }
    save(state);
  }

  function computeSharpe(rows) {
    const n = rows.length;
    if (n < MIN_TO_SCORE) return { n, sharpe: null, annSharpe: null, mean: null, std: null, ready: false };
    const rs = rows.map(r => r.r);
    const mean = rs.reduce((s, v) => s + v, 0) / n;
    const variance = rs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, n - 1);
    const std = Math.sqrt(variance);
    const sharpe = std > 1e-10 ? mean / std : 0;
    const annSharpe = sharpe * Math.sqrt(PERIODS_PER_YEAR);
    return { n, sharpe, annSharpe, mean, std, ready: true };
  }

  function stats(symbol, window) {
    if (!window) window = DEFAULT_WINDOW;
    const state = load();
    if (symbol) {
      const rows = (state.bySymbol[symbol] || []).slice(-window);
      return computeSharpe(rows);
    }
    const out = {};
    for (const sym in state.bySymbol) {
      const rows = state.bySymbol[sym].slice(-window);
      out[sym] = computeSharpe(rows);
    }
    return out;
  }

  function leaderboard(window) {
    if (!window) window = DEFAULT_WINDOW;
    const all = stats(null, window);
    const out = [];
    for (const sym in all) {
      out.push({ symbol: sym, ...all[sym] });
    }
    out.sort((a, b) => {
      if (a.annSharpe == null) return 1;
      if (b.annSharpe == null) return -1;
      return b.annSharpe - a.annSharpe;
    });
    return out;
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.SymbolSharpe = {
    record,
    stats,
    leaderboard,
    reset,
    MIN_TO_SCORE,
    MAX_PER_SYMBOL,
    PERIODS_PER_YEAR
  };
})();
