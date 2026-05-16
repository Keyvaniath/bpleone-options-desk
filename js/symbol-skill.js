/* ===========================================
   BPLEONE — Per-Symbol Brier Skill Tracker
   ---
   The global Brier Skill Score (js/brier-skill.js) tells us if the brain
   is learning overall. But per-symbol BSS tells us WHICH SYMBOLS the
   brain has real edge on.

   For each symbol, maintain a rolling pool of (predicted, actual) pairs
   and compute Brier + Brier Skill Score.

   Exposes:
     SymbolSkill.record(symbol, predictedProb, actualWin)
     SymbolSkill.stats(symbol?, window=100) → per-symbol BSS or all
     SymbolSkill.leaderboard(window=100) → sorted by skill
     SymbolSkill.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_symbol_skill_v1';
  const MAX_PER_SYMBOL = 200;
  const DEFAULT_WINDOW = 100;
  const MIN_TO_SCORE = 10;

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

  function record(symbol, predictedProb, actualWin) {
    if (!symbol || typeof predictedProb !== 'number') return;
    if (actualWin !== 0 && actualWin !== 1) return;
    if (predictedProb < 0 || predictedProb > 1) return;
    const state = load();
    if (!state.bySymbol[symbol]) state.bySymbol[symbol] = [];
    state.bySymbol[symbol].push({ p: +predictedProb.toFixed(4), y: actualWin, t: Date.now() });
    if (state.bySymbol[symbol].length > MAX_PER_SYMBOL) {
      state.bySymbol[symbol] = state.bySymbol[symbol].slice(-MAX_PER_SYMBOL);
    }
    save(state);
  }

  function computeBSS(rows) {
    const n = rows.length;
    if (n < MIN_TO_SCORE) return { n, skill: null, brier: null, baseline: null, baseRate: null, ready: false };
    const baseRate = rows.reduce((s, r) => s + r.y, 0) / n;
    let brierModel = 0, brierBaseline = 0;
    for (const r of rows) {
      brierModel += (r.p - r.y) * (r.p - r.y);
      brierBaseline += (baseRate - r.y) * (baseRate - r.y);
    }
    brierModel /= n;
    brierBaseline /= n;
    const skill = brierBaseline > 0 ? (1 - brierModel / brierBaseline) : 0;
    return { n, skill, brier: brierModel, baseline: brierBaseline, baseRate, ready: true };
  }

  function stats(symbol, window) {
    if (!window) window = DEFAULT_WINDOW;
    const state = load();
    if (symbol) {
      const rows = (state.bySymbol[symbol] || []).slice(-window);
      return computeBSS(rows);
    }
    // All symbols
    const out = {};
    for (const sym in state.bySymbol) {
      const rows = state.bySymbol[sym].slice(-window);
      out[sym] = computeBSS(rows);
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
      if (a.skill == null) return 1;
      if (b.skill == null) return -1;
      return b.skill - a.skill;
    });
    return out;
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.SymbolSkill = {
    record,
    stats,
    leaderboard,
    reset,
    MIN_TO_SCORE,
    MAX_PER_SYMBOL
  };
})();
