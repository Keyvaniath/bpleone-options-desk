/* ===========================================
   BPLEONE — Bayesian uncertainty via Monte Carlo Dropout
   ---
   The raw model outputs a single number ("70% confident"). What it
   doesn't tell you: how confident is the model IN that 70%? Could be
   70% ± 2% (high confidence) or 70% ± 15% (basically a coin flip
   disguised as a number).

   MC Dropout is a cheap, well-established Bayesian approximation:
     1. At inference time, randomly zero out a fraction of features
     2. Run the prediction with the dropout mask applied
     3. Repeat N times with different random masks
     4. Mean of samples = predicted probability
     5. Standard deviation = uncertainty

   The intuition: if removing 20% of features barely moves the
   prediction, the model is robust = high confidence. If removing
   different 20% subsets produces wildly different predictions, the
   model is fragile = low confidence.

   Result usage:
     - brain-bet shows "70% ± 5%" instead of just "70%"
     - sizing-advisor reduces position size when uncertainty is high
     - risk-aware traders can filter for low-uncertainty calls only

   Exposes:
     BayesianDropout.predict(model, features, opts)
       → { mean, std, p5, p95, samples, oodAdjusted }
   =========================================== */

(function () {
  const N_SAMPLES = 20;         // 20 MC samples per prediction
  const DROPOUT_RATE = 0.20;    // 20% feature dropout
  const RNG_SEED = 12345;

  // Deterministic PRNG so dropout is reproducible per (features, model)
  // hash. This makes the uncertainty stable rather than jittering on
  // each call.
  function hashSeed(features) {
    let h = RNG_SEED;
    for (let i = 0; i < features.length; i++) {
      const v = Math.floor((features[i] || 0) * 10000);
      h = ((h << 5) - h + v) | 0;
    }
    return h;
  }

  function seededRandom(state) {
    state.s = (state.s * 1664525 + 1013904223) | 0;
    return ((state.s >>> 0) / 4294967296);
  }

  function sigmoid(z) {
    z = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-z));
  }

  // Compute prediction with a specific feature dropout mask
  function predictMasked(weights, features, mask) {
    if (!weights || !features) return 0.5;
    let z = 0;
    for (let i = 0; i < features.length; i++) {
      if (!mask[i]) continue;
      z += (weights[i] || 0) * features[i];
    }
    return sigmoid(z);
  }

  // MC Dropout prediction with uncertainty
  function predict(model, features, opts) {
    opts = opts || {};
    const N = opts.nSamples || N_SAMPLES;
    const rate = opts.dropoutRate || DROPOUT_RATE;
    if (!model || !model.weights || !Array.isArray(features) || features.length === 0) {
      return { mean: 0.5, std: 0, p5: 0.5, p95: 0.5, samples: [] };
    }

    const rng = { s: hashSeed(features) };
    const samples = [];
    for (let i = 0; i < N; i++) {
      const mask = features.map(() => seededRandom(rng) > rate);
      // Ensure bias term (last weight) stays on
      mask[mask.length - 1] = true;
      const p = predictMasked(model.weights, features, mask);
      samples.push(p);
    }

    samples.sort((a, b) => a - b);
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance = samples.reduce((s, v) => s + (v - mean) * (v - mean), 0) / samples.length;
    const std = Math.sqrt(variance);
    // Audit pass 48: previously used Math.floor(q * N) which for N=20 returned
    // samples[1] for p5 (actually the ~10th percentile) and samples[19] for p95
    // (the max), inflating interval width. Switch to linear-interpolated quantile.
    const quantile = (q) => {
      const idx = q * (samples.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      if (lo === hi) return samples[lo];
      const t = idx - lo;
      return samples[lo] * (1 - t) + samples[hi] * t;
    };
    const p5 = quantile(0.05);
    const p95 = quantile(0.95);

    return { mean, std, p5, p95, samples, n: N, dropoutRate: rate };
  }

  // Confidence categorization based on std
  // For probabilities in [0, 1], std < 0.03 is very tight, 0.10+ is wide
  function categorize(uncertainty) {
    if (!uncertainty || uncertainty.std == null) return 'unknown';
    if (uncertainty.std < 0.03) return 'high';      // <3pp std = high confidence
    if (uncertainty.std < 0.06) return 'medium';
    if (uncertainty.std < 0.10) return 'low';
    return 'very-low';
  }

  // Size adjustment: when uncertainty is high, reduce position size
  // Returns multiplier in [0.25, 1.0]
  function sizeMultiplier(uncertainty) {
    const cat = categorize(uncertainty);
    if (cat === 'high') return 1.0;
    if (cat === 'medium') return 0.75;
    if (cat === 'low') return 0.50;
    if (cat === 'very-low') return 0.25;
    return 0.50;
  }

  window.BayesianDropout = {
    predict,
    categorize,
    sizeMultiplier,
    N_SAMPLES,
    DROPOUT_RATE
  };
})();
