/* ===========================================
   BPLEONE — Per-Module Performance Attribution
   ---
   The brain has 5 base learners (model, ensemble, bootstrap, k-NN, SWA).
   The Meta-Stacker learns to blend them, but Brandon needs to see WHICH
   modules are actually carrying weight. This module records each
   module's prediction vs the actual outcome on every resolution and
   produces a rolling-window leaderboard.

   Metrics per module (rolling N=100):
     - accuracy:        % times the module's direction matched truth
     - logLoss:         mean -log(p_true) (lower is better)
     - brier:           mean (p - y)^2 (lower is better)
     - agreementWithFinal: % times the module agreed with the final blended prediction
     - contributionDelta:  module_acc - average_acc — positive means it pulls weight

   Exposes:
     ModuleAttribution.recordResolution(basePreds, blendedProb, label)
     ModuleAttribution.stats(window=100) → { perModule: {...}, leaderboard: [...] }
     ModuleAttribution.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_module_attr_v1';
  const BASE_NAMES = ['model', 'ensemble', 'bootstrap', 'knn', 'swa'];
  const DEFAULT_WINDOW = 100;
  const MAX_LOG = 500;

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

  function recordResolution(basePreds, blendedProb, label) {
    if (!basePreds || (label !== 0 && label !== 1)) return;
    if (typeof blendedProb !== 'number') return;
    const state = load();
    const row = { y: label, b: +blendedProb.toFixed(4), t: Date.now() };
    for (const name of BASE_NAMES) {
      const p = basePreds[name];
      row[name] = (typeof p === 'number') ? +p.toFixed(4) : null;
    }
    state.log.push(row);
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save(state);
  }

  function computeModuleStats(rows, name) {
    let n = 0, correct = 0, logLossSum = 0, brierSum = 0, agreeFinal = 0;
    for (const r of rows) {
      const p = r[name];
      if (p == null) continue;
      n++;
      const dir = p >= 0.5 ? 1 : 0;
      if (dir === r.y) correct++;
      const truthP = (r.y === 1) ? p : 1 - p;
      logLossSum += -Math.log(Math.max(1e-9, truthP));
      brierSum += (p - r.y) * (p - r.y);
      const finalDir = r.b >= 0.5 ? 1 : 0;
      if (dir === finalDir) agreeFinal++;
    }
    if (n === 0) {
      return { n: 0, accuracy: null, logLoss: null, brier: null, agreementWithFinal: null };
    }
    return {
      n,
      accuracy: correct / n,
      logLoss: logLossSum / n,
      brier: brierSum / n,
      agreementWithFinal: agreeFinal / n
    };
  }

  function stats(window) {
    if (!window) window = DEFAULT_WINDOW;
    const state = load();
    const rows = state.log.slice(-window);
    const perModule = {};
    let avgAcc = 0, accCount = 0;
    for (const name of BASE_NAMES) {
      const s = computeModuleStats(rows, name);
      perModule[name] = s;
      if (s.accuracy != null) { avgAcc += s.accuracy; accCount++; }
    }
    avgAcc = accCount > 0 ? avgAcc / accCount : null;
    // Final-blend baseline
    const finalStats = computeModuleStats(rows.map(r => ({ ...r, _f: r.b })), '_f');
    // Compute contribution delta and build leaderboard
    const leaderboard = [];
    for (const name of BASE_NAMES) {
      const s = perModule[name];
      const delta = (avgAcc != null && s.accuracy != null) ? s.accuracy - avgAcc : null;
      perModule[name].contributionDelta = delta;
      leaderboard.push({
        module: name,
        accuracy: s.accuracy,
        logLoss: s.logLoss,
        brier: s.brier,
        contributionDelta: delta,
        n: s.n
      });
    }
    leaderboard.sort((a, b) => {
      if (a.accuracy == null) return 1;
      if (b.accuracy == null) return -1;
      return b.accuracy - a.accuracy;
    });
    return {
      perModule,
      leaderboard,
      finalBlend: { accuracy: finalStats.accuracy, logLoss: finalStats.logLoss, brier: finalStats.brier, n: finalStats.n },
      avgAccuracy: avgAcc,
      totalRows: rows.length,
      windowSize: window
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.ModuleAttribution = {
    recordResolution,
    stats,
    reset,
    BASE_NAMES
  };
})();
