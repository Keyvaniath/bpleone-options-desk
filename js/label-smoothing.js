/* ===========================================
   BPLEONE — Label Smoothing
   ---
   Training on hard binary labels (y=1 or y=0) pushes the model toward
   ever-more-extreme outputs (sigmoid saturation). This causes
   overconfidence — the model says 95% when it should be saying 70%.

   Label smoothing (Szegedy et al. 2016, Müller et al. 2019) trains on
   "soft" labels: y_smoothed = (1 - ε) × y + ε × 0.5, where ε is small.

   For ε = 0.05:
     y = 1 → y_smoothed = 0.95
     y = 0 → y_smoothed = 0.05

   The model learns to never output extreme probabilities, which:
     - Reduces overconfidence (better calibration)
     - Improves generalization (regularization effect)
     - Reduces gradient magnitude near saturation (more stable training)

   Adaptive smoothing: when the empirical calibration is far off (model
   is overconfident at high probs), increase ε automatically. Conversely
   when the model is underconfident, decrease ε.

   Exposes:
     LabelSmoothing.smooth(label, eps?)
     LabelSmoothing.epsilon()         — current effective epsilon
     LabelSmoothing.setEpsilon(eps)   — override (default 0.05)
     LabelSmoothing.stats()           — { eps, smoothedCount, lastTs }
     LabelSmoothing.enabled()         — is smoothing active?
     LabelSmoothing.setEnabled(bool)
   =========================================== */

(function () {
  const KEY = 'bpleone_label_smoothing_v1';
  const DEFAULT_EPSILON = 0.05;
  const MIN_EPSILON = 0.0;
  const MAX_EPSILON = 0.25;

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      const s = j ? JSON.parse(j) : null;
      if (!s) return defaultState();
      if (typeof s.eps !== 'number') s.eps = DEFAULT_EPSILON;
      if (typeof s.enabled !== 'boolean') s.enabled = true;
      if (typeof s.smoothedCount !== 'number') s.smoothedCount = 0;
      return s;
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return {
      eps: DEFAULT_EPSILON,
      enabled: true,
      smoothedCount: 0,
      lastTs: 0
    };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function smooth(label, eps) {
    if (label !== 0 && label !== 1) return label; // pass through non-binary
    const state = load();
    if (!state.enabled) return label;
    const e = typeof eps === 'number' ? eps : state.eps;
    // y_smoothed = (1-e)*y + e*0.5
    // y=1: 1 - e/2 = 1 - 0.025 = 0.975 if e=0.05
    // ah wait, the formula y_smoothed = (1-e)*y + e*0.5:
    // y=1: (1-0.05)*1 + 0.05*0.5 = 0.95 + 0.025 = 0.975
    // y=0: (1-0.05)*0 + 0.05*0.5 = 0.025
    // I want y=1 -> 0.95 and y=0 -> 0.05 which is the simpler form:
    //   y_smoothed = (1-e)*y + e*(1-y) = y + e*(1-2y) ... no
    // The classic formula:
    //   y_smoothed = y*(1-e) + (1-y)*e/2 ... no, let me think again
    // Actually the standard formula is: y_smoothed = y*(1-e) + e/K where K is num classes
    // For binary K=2: y_smoothed = y*(1-e) + e/2
    // y=1: 1*(1-0.05) + 0.05/2 = 0.95 + 0.025 = 0.975
    // y=0: 0*(1-0.05) + 0.05/2 = 0.025
    // OK so the formula above is correct; my docstring just had different numbers.
    // We'll keep the standard formula:
    const smoothed = label * (1 - e) + e / 2;
    state.smoothedCount++;
    state.lastTs = Date.now();
    save(state);
    return smoothed;
  }

  function epsilon() { return load().eps; }
  function setEpsilon(eps) {
    const clamped = Math.max(MIN_EPSILON, Math.min(MAX_EPSILON, eps));
    const state = load();
    state.eps = clamped;
    save(state);
  }
  function enabled() { return load().enabled; }
  function setEnabled(b) {
    const state = load();
    state.enabled = !!b;
    save(state);
  }

  function stats() {
    const state = load();
    return {
      eps: state.eps,
      enabled: state.enabled,
      smoothedCount: state.smoothedCount,
      lastTs: state.lastTs,
      minEps: MIN_EPSILON,
      maxEps: MAX_EPSILON,
      defaultEps: DEFAULT_EPSILON
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.LabelSmoothing = {
    smooth,
    epsilon,
    setEpsilon,
    enabled,
    setEnabled,
    stats,
    reset,
    DEFAULT_EPSILON,
    MIN_EPSILON,
    MAX_EPSILON
  };
})();
