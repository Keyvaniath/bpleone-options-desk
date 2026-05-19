/* ===========================================
   BPLEONE — Stochastic Weight Averaging (SWA)
   ---
   Adam converges to a sharp local minimum that often generalizes worse
   than nearby flatter minima. SWA improves generalization by averaging
   weight snapshots from late training, which sits the model in a flatter
   region of the loss landscape.

   Algorithm (Izmailov et al. 2018):
     1. At each polling tick (every N training steps), snapshot model.weights
     2. Maintain running average:
          swa_w_new = (n*swa_w_old + new_w) / (n+1)
     3. For inference, use swa_w instead of latest weights — flatter minimum
        usually means better out-of-sample accuracy
     4. Compare SWA prediction vs latest prediction; if they diverge sharply
        the model is in a noisy region — useful uncertainty signal

   Why this is essentially free:
     - One vector add + scalar divide per snapshot (22 floats)
     - No additional gradient passes
     - Storage: 1 extra weight vector in localStorage
     - Just yields better generalization

   Exposes:
     SWA.snapshot(model)                — capture current weights into the average
     SWA.predict(features)              — predict using averaged weights
     SWA.divergence(model)              — L2 distance between SWA and current weights
     SWA.weights()                      — current SWA weight vector
     SWA.reset()
     SWA.stats() → { nSnapshots, divergence, lastSnapshotTs }
   =========================================== */

(function () {
  const KEY = 'bpleone_swa_v1';
  const MIN_SNAPSHOTS = 5; // below this, predict() defers to model (cold start)
  // Audit pass 81: cap the effective sample size. Pure running average with
  // no cap means new snapshots get diluted (1/n weight) — after a few weeks
  // SWA stops responding to genuine training. Cap at 200: once n hits 200,
  // each new snapshot gets ~1/200 weight (EMA-like, half-life ~140 snapshots).
  const N_EFF_CAP = 200;

  function load() {
    if (typeof localStorage === 'undefined') return null;
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : null;
    } catch (e) { return null; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Capture current model.weights into the SWA running average
  function snapshot(model) {
    if (!model || !model.weights || model.weights.length === 0) return null;
    const w = model.weights.slice();
    const state = load() || { swa: w.slice(), n: 0, lastTs: 0 };
    if (state.swa.length !== w.length) {
      // Weight vector changed shape — restart
      state.swa = w.slice();
      state.n = 0;
    }
    // Running average: swa = (n*swa + w) / (n+1)
    // Pass 81: cap n at N_EFF_CAP so old snapshots don't dilute new ones forever.
    const n = Math.min(state.n, N_EFF_CAP);
    for (let i = 0; i < w.length; i++) {
      state.swa[i] = (n * state.swa[i] + w[i]) / (n + 1);
    }
    state.n = state.n + 1;   // still track raw count for stats / divergence
    state.lastTs = Date.now();
    save(state);
    return state.n;
  }

  function sigmoid(z) {
    z = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-z));
  }

  // Predict using averaged weights. Returns null if not enough snapshots.
  function predict(features) {
    if (!features) return null;
    const state = load();
    if (!state || state.n < MIN_SNAPSHOTS) return null;
    if (state.swa.length !== features.length) return null;
    let z = 0;
    for (let i = 0; i < features.length; i++) {
      z += features[i] * state.swa[i];
    }
    return { prob: sigmoid(z), z, nSnapshots: state.n };
  }

  // L2 distance between SWA average and current model weights — when this
  // is small the model is "settled"; when large the model is still drifting.
  function divergence(model) {
    if (!model || !model.weights) return null;
    const state = load();
    if (!state || state.n < MIN_SNAPSHOTS) return null;
    if (state.swa.length !== model.weights.length) return null;
    let sum = 0;
    for (let i = 0; i < model.weights.length; i++) {
      const d = state.swa[i] - model.weights[i];
      sum += d * d;
    }
    return Math.sqrt(sum);
  }

  function weights() {
    const state = load();
    return state ? state.swa.slice() : null;
  }

  function stats() {
    const state = load();
    if (!state) return { nSnapshots: 0, ready: false };
    return {
      nSnapshots: state.n,
      ready: state.n >= MIN_SNAPSHOTS,
      lastSnapshotTs: state.lastTs,
      minSnapshots: MIN_SNAPSHOTS
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  // Auto-snapshot loop — every 60s, if ModelStore is loaded and the model
  // has new training since the last snapshot, capture it.
  let _autoLastTrainTs = 0;
  function _autoSnapshot() {
    try {
      if (typeof window === 'undefined') return;
      const MS = window.ModelStore;
      if (!MS) return;
      const model = MS.load();
      if (!model || !model.weights) return;
      if (model.lastTrainTs <= _autoLastTrainTs) return;  // no new training
      snapshot(model);
      _autoLastTrainTs = model.lastTrainTs;
    } catch (e) {}
  }

  function start() {
    if (typeof window === 'undefined') return;
    if (window._swaInterval) return;
    window._swaInterval = setInterval(_autoSnapshot, 60 * 1000);
  }

  window.SWA = { snapshot, predict, divergence, weights, stats, reset, start, MIN_SNAPSHOTS };

  // Start the background snapshot loop when DOM ready
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(start, 2000);
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(start, 2000));
    }
  }
})();
