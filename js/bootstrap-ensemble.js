/* ===========================================
   BPLEONE — Online bootstrap ensemble (bagging)
   ---
   MC Dropout estimates uncertainty by perturbing features. Bootstrap
   estimates uncertainty by training K=5 SEPARATE models, each on a
   different stochastic view of the data. At prediction time, ask all
   5 and look at the spread.

   This is more rigorous than MC Dropout because the models actually
   disagree if the training signal is weak — not just if the features
   are noisy.

   Storage strategy ("online bagging"):
     For every training sample, randomly include in each of K models
     with probability INCLUSION_PROB (0.6). Each model thus sees ~60%
     of training data, sampled with replacement-like variance.

     We don't store the K training subsets — each model just trains
     incrementally as samples arrive.

   Per-model storage: bpleone_bootstrap_model_k_v1 (one per k)

   Exposes:
     BootstrapEnsemble.train(features, label, weight)  — fed by continuous-learner
     BootstrapEnsemble.predict(features) → { mean, std, p5, p95, predictions }
     BootstrapEnsemble.summary() → models[] with stats
   =========================================== */

(function () {
  const K = 5;                  // number of bootstrap models
  const INCLUSION_PROB = 0.6;   // each sample included in each model w/ p=0.6
  const KEY_PREFIX = 'bpleone_bootstrap_model_k_';

  function loadModel(k) {
    const Mctor = (typeof window !== 'undefined' && window.Model) || (typeof Model !== 'undefined' ? Model : null);
    if (!Mctor) return null;
    try {
      const raw = localStorage.getItem(KEY_PREFIX + k + '_v1');
      const m = new Mctor();
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.weights) m.deserialize(data);
      }
      return m;
    } catch (e) { return new Mctor(); }
  }

  function saveModel(k, model) {
    try { localStorage.setItem(KEY_PREFIX + k + '_v1', JSON.stringify(model.serialize())); } catch (e) {}
  }

  // Deterministic include/exclude from a sample by seeding from features
  // so the same sample makes the same decisions across calls (avoids
  // double-training in re-runs).
  function hashSeed(features) {
    let h = 0x12345;
    for (let i = 0; i < features.length; i++) {
      h = ((h << 5) - h + Math.floor((features[i] || 0) * 10000)) | 0;
    }
    return h;
  }

  // Train all K models with online bagging — each sample included in
  // each model with probability INCLUSION_PROB.
  function train(features, label, sampleWeight) {
    if (!features || typeof label === 'undefined') return null;
    const w = typeof sampleWeight === 'number' ? sampleWeight : 1.0;
    const seed = hashSeed(features);
    let trainedCount = 0;
    const losses = [];
    for (let k = 0; k < K; k++) {
      // Use Math.random() so each call has independent inclusion across all K
      if (Math.random() < INCLUSION_PROB) {
        const m = loadModel(k);
        if (!m) continue;
        // Apply sample weight by repeating the update
        const reps = Math.max(1, Math.min(4, Math.round(w)));
        let totalLoss = 0;
        for (let r = 0; r < reps; r++) {
          const result = m.train(features, label);
          totalLoss += result.loss;
        }
        saveModel(k, m);
        losses.push(totalLoss / reps);
        trainedCount++;
      }
    }
    return { trainedCount, avgLoss: losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0 };
  }

  // Predict with all K models, return ensemble stats
  function predict(features) {
    if (!features || !Array.isArray(features)) return null;
    const predictions = [];
    for (let k = 0; k < K; k++) {
      const m = loadModel(k);
      if (!m) continue;
      const p = m.predict(features);
      predictions.push(p.prob);
    }
    if (predictions.length === 0) return { mean: 0.5, std: 0, p5: 0.5, p95: 0.5, predictions: [] };
    predictions.sort((a, b) => a - b);
    const mean = predictions.reduce((s, v) => s + v, 0) / predictions.length;
    const variance = predictions.reduce((s, v) => s + (v - mean) ** 2, 0) / predictions.length;
    const std = Math.sqrt(variance);
    const p5 = predictions[Math.floor(0.05 * predictions.length)] || predictions[0];
    const p95 = predictions[Math.floor(0.95 * predictions.length)] || predictions[predictions.length - 1];
    return { mean, std, p5, p95, predictions, k: predictions.length };
  }

  // Same confidence categorization as Bayesian dropout for consistency
  function categorize(uncertainty) {
    if (!uncertainty || uncertainty.std == null) return 'unknown';
    if (uncertainty.std < 0.03) return 'high';
    if (uncertainty.std < 0.06) return 'medium';
    if (uncertainty.std < 0.10) return 'low';
    return 'very-low';
  }

  function summary() {
    const models = [];
    for (let k = 0; k < K; k++) {
      const m = loadModel(k);
      if (!m) { models.push(null); continue; }
      models.push({
        k,
        n_trained: m.n_trained || 0,
        weightSum: m.weights ? m.weights.reduce((a, b) => a + Math.abs(b), 0) : 0
      });
    }
    return { K, INCLUSION_PROB, models };
  }

  function reset() {
    for (let k = 0; k < K; k++) {
      try { localStorage.removeItem(KEY_PREFIX + k + '_v1'); } catch (e) {}
    }
  }

  window.BootstrapEnsemble = {
    train,
    predict,
    categorize,
    summary,
    reset,
    K,
    INCLUSION_PROB
  };
})();
