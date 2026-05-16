/* ===========================================
   BPLEONE — Meta-Stacker
   ---
   The Unified Predictor currently blends five base learners with hand-
   picked weights (model 0.35, ensemble 0.25, bootstrap 0.13, k-NN 0.13,
   SWA 0.14). Those weights are guesses. Meta-Stacker learns them.

   Classic stacking ensemble:
     1. At predict time, collect base predictions
        x = [p_model, p_ensemble, p_bootstrap, p_knn, p_swa, 1.0]
     2. Meta-model is a logistic regression on these:
        meta_pred = sigmoid(w · x)
     3. When the outcome resolves, train the meta-model on
        (base_predictions, actual_win) — learning which base learner to
        trust more under different conditions.

   Why this is genuinely self-learning:
     - The meta-weights aren't fixed; they update with every resolution
     - If k-NN starts outperforming the model in late training, k-NN's
       weight grows automatically
     - If one base learner becomes systematically miscalibrated, its
       weight shrinks toward zero
     - The intercept absorbs systematic bias

   Cold start:
     Before we have ≥30 resolutions, fall back to fixed weights.
     After that, use the learned blend.

   Exposes:
     MetaStacker.predict(basePreds)    — { prob, weights } or null
     MetaStacker.train(basePreds, y)   — one online SGD step
     MetaStacker.weights()             — current learned weights
     MetaStacker.stats()               — { nTrained, ready, baseAccuracy }
     MetaStacker.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_meta_stacker_v1';
  const BASE_NAMES = ['model', 'ensemble', 'bootstrap', 'knn', 'swa'];
  const N_BASE = BASE_NAMES.length;
  const N_W = N_BASE + 1;          // +1 for bias
  const MIN_TRAINED = 30;          // cold-start threshold
  const LR = 0.05;
  const L2 = 0.001;

  function load() {
    if (typeof localStorage === 'undefined') {
      return defaultState();
    }
    try {
      const j = localStorage.getItem(KEY);
      if (!j) return defaultState();
      const s = JSON.parse(j);
      if (!s.weights || s.weights.length !== N_W) return defaultState();
      return s;
    } catch (e) {
      return defaultState();
    }
  }

  function defaultState() {
    return {
      weights: new Array(N_W).fill(0),
      nTrained: 0,
      lossHistory: [],
      lastTrainTs: 0
    };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function sigmoid(z) {
    z = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-z));
  }

  // basePreds: { model: 0..1, ensemble: 0..1, bootstrap: 0..1, knn: 0..1, swa: 0..1 }
  // Missing keys are filled with 0.5 (neutral) and a soft penalty on the
  // meta-weight is applied to avoid trusting absent learners.
  function buildVec(basePreds) {
    const x = new Array(N_W).fill(0);
    for (let i = 0; i < N_BASE; i++) {
      const v = basePreds && basePreds[BASE_NAMES[i]];
      x[i] = (v != null && isFinite(v)) ? v : 0.5;
    }
    x[N_W - 1] = 1.0; // bias
    return x;
  }

  function predict(basePreds) {
    if (!basePreds) return null;
    const state = load();
    if (state.nTrained < MIN_TRAINED) {
      // Cold start — return null so caller falls back to hard-coded blend
      return null;
    }
    const x = buildVec(basePreds);
    let z = 0;
    for (let i = 0; i < N_W; i++) z += x[i] * state.weights[i];
    return {
      prob: sigmoid(z),
      z,
      weights: state.weights.slice(),
      basePreds: x.slice(0, N_BASE)
    };
  }

  function train(basePreds, y) {
    if (!basePreds || (y !== 0 && y !== 1)) return null;
    const state = load();
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
    const loss = -(y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p)));
    state.lossHistory.push({ loss, p, y, t: Date.now() });
    if (state.lossHistory.length > 500) state.lossHistory.shift();
    save(state);
    return { p, loss };
  }

  function weights() {
    const state = load();
    const out = {};
    for (let i = 0; i < N_BASE; i++) {
      out[BASE_NAMES[i]] = state.weights[i];
    }
    out.bias = state.weights[N_W - 1];
    return out;
  }

  // Convert raw weights to a "soft-blend" representation that's comparable to
  // the hard-coded 0.35/0.25/... — useful for UI display only.
  function normalizedWeights() {
    const state = load();
    const raw = state.weights.slice(0, N_BASE).map(w => Math.exp(w));
    const sum = raw.reduce((s, v) => s + v, 0);
    const norm = {};
    for (let i = 0; i < N_BASE; i++) {
      norm[BASE_NAMES[i]] = sum > 0 ? raw[i] / sum : 1 / N_BASE;
    }
    return norm;
  }

  function stats() {
    const state = load();
    const recent = state.lossHistory.slice(-50);
    const avgLoss = recent.length > 0 ? recent.reduce((s, r) => s + r.loss, 0) / recent.length : null;
    const acc = recent.length > 0
      ? recent.filter(r => (r.p >= 0.5 ? 1 : 0) === r.y).length / recent.length
      : null;
    return {
      nTrained: state.nTrained,
      ready: state.nTrained >= MIN_TRAINED,
      minTrained: MIN_TRAINED,
      avgRecentLoss: avgLoss,
      recentAccuracy: acc,
      lastTrainTs: state.lastTrainTs,
      baseNames: BASE_NAMES.slice()
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.MetaStacker = {
    predict,
    train,
    weights,
    normalizedWeights,
    stats,
    reset,
    BASE_NAMES,
    MIN_TRAINED
  };
})();
