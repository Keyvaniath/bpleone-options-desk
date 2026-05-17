/* ===========================================
   BPLEONE — Mixup Augmentation
   ---
   Mixup (Zhang et al. 2018) generates synthetic training examples by
   linearly interpolating between pairs of real examples:

     x_mix = λ * x_a + (1-λ) * x_b
     y_mix = λ * y_a + (1-λ) * y_b

   Where λ ~ Beta(α, α) — typically α=0.2 produces λ near 0 or 1 (modest
   interpolation) while α=1.0 produces uniform [0,1] (heavy interpolation).

   Effect: forces the model to learn smooth, linear decision boundaries
   between training points. Empirically reduces overfitting and improves
   robustness to small input perturbations. Complements label smoothing.

   Implementation: takes the batch of newly-resolved rows from the
   continuous-learner, randomly pairs them, and produces K synthetic rows
   that get trained on as extra steps.

   Disabled by default — opt-in via dashboard since it doubles compute.

   Exposes:
     Mixup.generate(rows, k?) → array of synthetic { features, label, weight } rows
     Mixup.enabled() / .setEnabled(bool)
     Mixup.alpha() / .setAlpha(α)
     Mixup.stats()
   =========================================== */

(function () {
  const KEY = 'bpleone_mixup_v1';
  const DEFAULT_ALPHA = 0.2;
  const MIN_ALPHA = 0.01;
  const MAX_ALPHA = 5.0;

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      const s = j ? JSON.parse(j) : null;
      if (!s) return defaultState();
      if (typeof s.alpha !== 'number') s.alpha = DEFAULT_ALPHA;
      if (typeof s.enabled !== 'boolean') s.enabled = false;
      if (typeof s.generatedCount !== 'number') s.generatedCount = 0;
      return s;
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return { alpha: DEFAULT_ALPHA, enabled: false, generatedCount: 0, lastTs: 0 };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Sample from Beta(α, α) using the gamma-method approximation.
  // For symmetric Beta (α == β), we can use:
  //   u ~ U(0,1); λ = sin²(π × u / 2) gives roughly Beta-like shape for α ~ 0.5
  // Simpler: sample two Gammas via Marsaglia & Tsang, divide.
  function sampleBeta(alpha) {
    if (alpha <= 0) return 0.5;
    // For our use case (α typically in [0.1, 1.0]), use simple inverse method:
    //   Beta(α, α) has CDF that's symmetric around 0.5.
    //   Use shape-aware sampling: u^(1/α) trick works for small α.
    // For accuracy across α range, fall back to gamma-gamma method.
    const x = gamma(alpha);
    const y = gamma(alpha);
    return x / (x + y);
  }

  // Marsaglia & Tsang's gamma sampler for shape >= 1.
  // For shape < 1, boost via Stuart's theorem: Γ(α) = Γ(α+1) × U^(1/α)
  function gamma(shape) {
    if (shape < 1) {
      const u = Math.random();
      return gamma(shape + 1) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1/3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x, v;
      do {
        x = randn();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  // Standard normal via Box-Muller
  function randn() {
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function generate(rows, k) {
    if (!Array.isArray(rows) || rows.length < 2) return [];
    const state = load();
    if (!state.enabled) return [];
    if (!k) k = Math.max(1, Math.floor(rows.length / 2));

    const synthetic = [];
    for (let i = 0; i < k; i++) {
      const aIdx = Math.floor(Math.random() * rows.length);
      let bIdx = Math.floor(Math.random() * rows.length);
      while (bIdx === aIdx && rows.length > 1) bIdx = Math.floor(Math.random() * rows.length);
      const a = rows[aIdx];
      const b = rows[bIdx];
      if (!a.features || !b.features || a.features.length !== b.features.length) continue;

      const lambda = sampleBeta(state.alpha);
      const features = new Array(a.features.length);
      for (let j = 0; j < a.features.length; j++) {
        features[j] = lambda * a.features[j] + (1 - lambda) * b.features[j];
      }
      const label = lambda * a.label + (1 - lambda) * b.label;
      const weight = ((a.weight || 1) * lambda + (b.weight || 1) * (1 - lambda)) * 0.5; // discount synthetic samples
      synthetic.push({ features, label, weight, lambda, source: 'mixup' });
    }

    state.generatedCount += synthetic.length;
    state.lastTs = Date.now();
    save(state);
    return synthetic;
  }

  function enabled() { return load().enabled; }
  function setEnabled(b) {
    const state = load();
    state.enabled = !!b;
    save(state);
  }
  function alpha() { return load().alpha; }
  function setAlpha(a) {
    const clamped = Math.max(MIN_ALPHA, Math.min(MAX_ALPHA, a));
    const state = load();
    state.alpha = clamped;
    save(state);
  }

  function stats() {
    const state = load();
    return {
      enabled: state.enabled,
      alpha: state.alpha,
      generatedCount: state.generatedCount,
      lastTs: state.lastTs,
      min: MIN_ALPHA,
      max: MAX_ALPHA,
      defaultAlpha: DEFAULT_ALPHA
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.Mixup = {
    generate,
    enabled,
    setEnabled,
    alpha,
    setAlpha,
    stats,
    reset,
    _sampleBeta: sampleBeta,
    DEFAULT_ALPHA,
    MIN_ALPHA,
    MAX_ALPHA
  };
})();
