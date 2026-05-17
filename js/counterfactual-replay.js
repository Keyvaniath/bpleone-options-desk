/* ===========================================
   BPLEONE — Counterfactual Replay (Feature Robustness)
   ---
   For each resolved trade, perturb each feature by ±EPSILON and re-predict
   to measure how brittle the prediction was. If a tiny feature change
   flips the prediction direction, the prediction is on a knife edge —
   we should be much less confident in those.

   Algorithm:
     1. Take features and current model
     2. For each feature i, create variants:
          features_minus = features with f[i] *= (1 - EPS)
          features_plus  = features with f[i] *= (1 + EPS)
     3. Predict on all 2N+1 variants (original + 2 perturbations per feature)
     4. Compute robustness = 1 - max_deviation_from_original / 0.5
        (1.0 = no change at all from perturbations; 0.0 = predictions flipped to extremes)
     5. Track distribution of robustness scores
     6. Surface brittle predictions (robustness < 0.7) for review

   Doesn't directly modify training — just measures. Use the brittleness
   distribution to decide if regularization should be increased.

   Exposes:
     CounterfactualReplay.measure(model, features) → { robustness, maxDev, perturbedDir }
     CounterfactualReplay.record(robustness)
     CounterfactualReplay.stats(window=200) → { mean, p25, p75, brittlePct, fragileCount }
     CounterfactualReplay.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_counterfactual_v1';
  const EPSILON = 0.10;          // perturb by ±10%
  const FRAGILE_THRESHOLD = 0.7;
  const MAX_LOG = 500;

  function load() {
    if (typeof localStorage === 'undefined') return { scores: [] };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { scores: [] };
    } catch (e) { return { scores: [] }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function measure(model, features) {
    if (!model || typeof model.predict !== 'function') return null;
    if (!Array.isArray(features) || features.length === 0) return null;
    const baseline = model.predict(features);
    if (!baseline || baseline.prob == null) return null;
    const baseProb = baseline.prob;
    const baseDir = baseProb >= 0.5 ? 1 : 0;

    let maxDev = 0;
    let flipCount = 0;
    let n = 0;
    for (let i = 0; i < features.length; i++) {
      // Skip bias feature (last index typically = 1.0)
      if (i === features.length - 1 && features[i] === 1.0) continue;
      for (const sign of [-1, 1]) {
        const perturbed = features.slice();
        perturbed[i] = features[i] * (1 + sign * EPSILON);
        try {
          const p = model.predict(perturbed);
          if (p && p.prob != null) {
            const dev = Math.abs(p.prob - baseProb);
            if (dev > maxDev) maxDev = dev;
            if ((p.prob >= 0.5 ? 1 : 0) !== baseDir) flipCount++;
            n++;
          }
        } catch (e) {}
      }
    }
    // Robustness: 1.0 = no change; 0.0 = max possible swing
    const robustness = Math.max(0, 1 - maxDev / 0.5);
    return {
      baseProb,
      maxDev,
      flipCount,
      perturbationsRun: n,
      robustness
    };
  }

  function record(robustness) {
    if (typeof robustness !== 'number' || robustness < 0 || robustness > 1) return;
    const state = load();
    state.scores.push({ r: +robustness.toFixed(4), t: Date.now() });
    if (state.scores.length > MAX_LOG) state.scores = state.scores.slice(-MAX_LOG);
    save(state);
  }

  function stats(window) {
    if (!window) window = 200;
    const state = load();
    const recent = state.scores.slice(-window);
    const n = recent.length;
    if (n === 0) return { n: 0, mean: null, p25: null, p75: null, brittlePct: null, ready: false };
    const vals = recent.map(r => r.r).sort((a, b) => a - b);
    const mean = vals.reduce((s, v) => s + v, 0) / n;
    const p25 = vals[Math.floor(n * 0.25)] || vals[0];
    const p75 = vals[Math.floor(n * 0.75)] || vals[n - 1];
    const brittleCount = vals.filter(v => v < FRAGILE_THRESHOLD).length;
    return {
      n,
      mean,
      p25,
      p75,
      min: vals[0],
      max: vals[n - 1],
      brittleCount,
      brittlePct: brittleCount / n,
      ready: true
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.CounterfactualReplay = {
    measure,
    record,
    stats,
    reset,
    EPSILON,
    FRAGILE_THRESHOLD,
    MAX_LOG
  };
})();
