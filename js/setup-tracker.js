/* ===========================================
   BPLEONE — Per-Setup Performance Tracker
   ---
   The feature vector includes one-hot setup encodings (indices 11-15):
     is_bull_setup, is_bear_setup, is_momentum, is_reversion, is_breakout

   This module tracks resolution outcomes stratified by setup type so
   we can answer: which setup types is the brain strongest at?

   Each resolution captures the setup flag from the original prediction's
   features, then this module rolls up accuracy, Brier, win rate, and
   sample size per setup.

   Exposes:
     SetupTracker.record(setupType, predictedProb, actualWin)
     SetupTracker.fromFeatures(features) — extract setup tag string
     SetupTracker.stats(window=200) → { perSetup: {...}, leaderboard: [...] }
     SetupTracker.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_setup_tracker_v1';
  const MAX_LOG = 500;
  const DEFAULT_WINDOW = 200;
  const SETUP_NAMES = ['bull', 'bear', 'momentum', 'reversion', 'breakout', 'mixed'];

  // Feature indices (matching FEATURES in model.js)
  const IDX_BULL = 11;
  const IDX_BEAR = 12;
  const IDX_MOMENTUM = 13;
  const IDX_REVERSION = 14;
  const IDX_BREAKOUT = 15;

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

  // Decide the primary setup tag from a feature vector by looking at which
  // setup flag is set. Returns 'mixed' if multiple are set or none.
  function fromFeatures(features) {
    if (!features || features.length < 16) return 'mixed';
    const tags = [];
    if (features[IDX_BULL] > 0.5) tags.push('bull');
    if (features[IDX_BEAR] > 0.5) tags.push('bear');
    if (features[IDX_MOMENTUM] > 0.5) tags.push('momentum');
    if (features[IDX_REVERSION] > 0.5) tags.push('reversion');
    if (features[IDX_BREAKOUT] > 0.5) tags.push('breakout');
    if (tags.length === 1) return tags[0];
    return 'mixed';
  }

  function record(setupType, predictedProb, actualWin) {
    if (!setupType || typeof predictedProb !== 'number') return;
    if (actualWin !== 0 && actualWin !== 1) return;
    if (SETUP_NAMES.indexOf(setupType) === -1) setupType = 'mixed';
    const state = load();
    state.log.push({ s: setupType, p: +predictedProb.toFixed(4), y: actualWin, t: Date.now() });
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save(state);
  }

  function computeSetupStats(rows, setup) {
    const r = rows.filter(x => x.s === setup);
    if (r.length === 0) {
      return { n: 0, accuracy: null, brier: null, winRate: null, edge: null };
    }
    let correct = 0, brierSum = 0, wins = 0;
    for (const row of r) {
      const dir = row.p >= 0.5 ? 1 : 0;
      if (dir === row.y) correct++;
      brierSum += (row.p - row.y) * (row.p - row.y);
      if (row.y === 1) wins++;
    }
    const acc = correct / r.length;
    return {
      n: r.length,
      accuracy: acc,
      brier: brierSum / r.length,
      winRate: wins / r.length,
      edge: acc - 0.5
    };
  }

  function stats(window) {
    if (!window) window = DEFAULT_WINDOW;
    const state = load();
    const rows = state.log.slice(-window);
    const perSetup = {};
    const leaderboard = [];
    for (const s of SETUP_NAMES) {
      const stats = computeSetupStats(rows, s);
      perSetup[s] = stats;
      leaderboard.push({ setup: s, ...stats });
    }
    leaderboard.sort((a, b) => {
      if (a.accuracy == null) return 1;
      if (b.accuracy == null) return -1;
      return b.accuracy - a.accuracy;
    });
    return { perSetup, leaderboard, totalRows: rows.length, windowSize: window };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.SetupTracker = {
    record,
    fromFeatures,
    stats,
    reset,
    SETUP_NAMES
  };
})();
