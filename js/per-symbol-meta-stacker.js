/* ===========================================
   BPLEONE — Per-Symbol Meta-Stacker
   ---
   Same idea as MetaStacker (learns the optimal weighted blend of base
   learners) but tracks SEPARATE weights per symbol.

   Why: NVDA's optimal blend might be 50% model + 30% k-NN + 20% SWA
   while SPY's optimal blend is 30% model + 50% multi-horizon + 20% SWA.
   The global MetaStacker averages these and is suboptimal for both.

   Storage per symbol: ~7 floats (6 weights + bias × 4 bytes ≈ 28 bytes).
   For 24 symbols that's ~700 bytes total. Trivial.

   Fallback chain at predict time:
     1. If symbol has ≥ MIN_TRAINED → use symbol's own meta-weights
     2. Else if global MetaStacker ready → use global weights
     3. Else → caller falls back to hard-coded weights

   Exposes:
     PerSymbolMetaStacker.predict(symbol, basePreds) → { prob, weights, source }
     PerSymbolMetaStacker.train(symbol, basePreds, y)
     PerSymbolMetaStacker.stats(symbol?) → per-symbol or all
     PerSymbolMetaStacker.leaderboard() → symbols ranked by training count
     PerSymbolMetaStacker.reset(symbol?)
   =========================================== */

(function () {
  const KEY_PREFIX = 'bpleone_per_sym_meta_v1_';
  const SUMMARY_KEY = 'bpleone_per_sym_meta_index_v1';
  const BASE_NAMES = ['model', 'ensemble', 'bootstrap', 'knn', 'swa'];
  const N_BASE = BASE_NAMES.length;
  const N_W = N_BASE + 1; // +1 for bias
  const MIN_TRAINED = 30;
  const LR = 0.05;
  const L2 = 0.001;

  function loadIndex() {
    if (typeof localStorage === 'undefined') return {};
    try {
      const j = localStorage.getItem(SUMMARY_KEY);
      return j ? JSON.parse(j) : {};
    } catch (e) { return {}; }
  }

  function saveIndex(idx) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(SUMMARY_KEY, JSON.stringify(idx)); } catch (e) {}
  }

  function loadSym(symbol) {
    if (typeof localStorage === 'undefined') return defaultSym();
    try {
      const j = localStorage.getItem(KEY_PREFIX + symbol);
      if (!j) return defaultSym();
      const s = JSON.parse(j);
      if (!s.weights || s.weights.length !== N_W) return defaultSym();
      return s;
    } catch (e) { return defaultSym(); }
  }

  function defaultSym() {
    return { weights: new Array(N_W).fill(0), nTrained: 0, lastTrainTs: 0 };
  }

  function saveSym(symbol, state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY_PREFIX + symbol, JSON.stringify(state)); } catch (e) {}
    // Maintain index of known symbols
    const idx = loadIndex();
    idx[symbol] = { nTrained: state.nTrained, lastTrainTs: state.lastTrainTs };
    saveIndex(idx);
  }

  function sigmoid(z) { z = Math.max(-30, Math.min(30, z)); return 1 / (1 + Math.exp(-z)); }

  function buildVec(basePreds) {
    const x = new Array(N_W).fill(0);
    for (let i = 0; i < N_BASE; i++) {
      const v = basePreds && basePreds[BASE_NAMES[i]];
      x[i] = (v != null && isFinite(v)) ? v : 0.5;
    }
    x[N_W - 1] = 1.0;
    return x;
  }

  function predict(symbol, basePreds) {
    if (!symbol || !basePreds) return null;
    const state = loadSym(symbol);
    if (state.nTrained < MIN_TRAINED) {
      // Cold start — try global MetaStacker as fallback
      if (typeof window !== 'undefined' && window.MetaStacker) {
        try {
          const global = window.MetaStacker.predict(basePreds);
          if (global) return { prob: global.prob, weights: global.weights, source: 'global', nTrained: state.nTrained };
        } catch (e) {}
      }
      return null;
    }
    const x = buildVec(basePreds);
    let z = 0;
    for (let i = 0; i < N_W; i++) z += x[i] * state.weights[i];
    return { prob: sigmoid(z), z, weights: state.weights.slice(), source: 'per-symbol', nTrained: state.nTrained };
  }

  function train(symbol, basePreds, y) {
    if (!symbol || !basePreds || (y !== 0 && y !== 1)) return null;
    const state = loadSym(symbol);
    const x = buildVec(basePreds);
    let z = 0;
    for (let i = 0; i < N_W; i++) z += x[i] * state.weights[i];
    const p = sigmoid(z);
    const err = p - y;
    for (let i = 0; i < N_W; i++) {
      const decay = (i === N_W - 1) ? 0 : L2 * state.weights[i];
      state.weights[i] -= LR * (err * x[i] + decay);
    }
    state.nTrained++;
    state.lastTrainTs = Date.now();
    saveSym(symbol, state);
    return { p, nTrained: state.nTrained };
  }

  function stats(symbol) {
    if (symbol) {
      const s = loadSym(symbol);
      return {
        symbol,
        nTrained: s.nTrained,
        ready: s.nTrained >= MIN_TRAINED,
        weights: s.weights.slice(),
        lastTrainTs: s.lastTrainTs,
        weightsByName: Object.fromEntries(BASE_NAMES.map((n, i) => [n, s.weights[i]]).concat([['bias', s.weights[N_W - 1]]]))
      };
    }
    const idx = loadIndex();
    const out = {};
    for (const sym in idx) {
      out[sym] = { nTrained: idx[sym].nTrained, ready: idx[sym].nTrained >= MIN_TRAINED, lastTrainTs: idx[sym].lastTrainTs };
    }
    return out;
  }

  function leaderboard() {
    const all = stats();
    const out = [];
    for (const sym in all) out.push({ symbol: sym, ...all[sym] });
    out.sort((a, b) => b.nTrained - a.nTrained);
    return out;
  }

  function reset(symbol) {
    if (typeof localStorage === 'undefined') return;
    if (symbol) {
      localStorage.removeItem(KEY_PREFIX + symbol);
      const idx = loadIndex();
      delete idx[symbol];
      saveIndex(idx);
    } else {
      const idx = loadIndex();
      for (const sym in idx) localStorage.removeItem(KEY_PREFIX + sym);
      localStorage.removeItem(SUMMARY_KEY);
    }
  }

  window.PerSymbolMetaStacker = {
    predict,
    train,
    stats,
    leaderboard,
    reset,
    BASE_NAMES,
    MIN_TRAINED
  };
})();
