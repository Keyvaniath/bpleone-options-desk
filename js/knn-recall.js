/* ===========================================
   BPLEONE — k-NN recall (non-parametric memory)
   ---
   The logistic-regression model is parametric: it compresses everything
   it has learned into 22 weights. That's elegant but throws away the
   memory of specific past examples.

   k-NN recall complements this with non-parametric memory: for every new
   prediction, find the K=10 most-similar past resolved predictions and
   look at their realized outcomes. If those K neighbors won 8/10, the
   k-NN gives 80% probability.

   Blend: final_prob = α × model_prob + (1-α) × knn_prob
   Default α = 0.7 (model dominates, memory provides a sanity check).

   This catches situations where the global model has averaged over too
   many regimes but a specific pattern has clear historical signal.

   Distance metric: weighted Euclidean. Each feature can have a different
   weight (we use FeatureImportance multipliers if available, else 1.0).

   Exposes:
     KNNRecall.predict(features, opts) → { prob, n, neighbors, blendedWith }
     KNNRecall.blend(modelProb, features, alpha) → blended probability
   =========================================== */

(function () {
  const K = 10;
  const MIN_NEIGHBORS_FOR_BLEND = 5;  // need 5+ matches before trusting k-NN
  const DEFAULT_ALPHA = 0.7;          // weight on parametric model

  function loadJournal() {
    try { return JSON.parse(localStorage.getItem('bpleone_pred_journal_v1') || '[]'); } catch (e) { return []; }
  }

  function isShortResolved(e) {
    if (!e.resolved) return false;
    if (typeof e.resolved === 'boolean') return e.resolved;
    return !!e.resolved.short;
  }

  // Get featureWeights from FeatureImportance if available
  function featureWeights() {
    if (typeof window === 'undefined' || !window.FeatureImportance) {
      return Array(22).fill(1.0);
    }
    const w = Array(22).fill(1.0);
    for (let i = 0; i < 22; i++) {
      try { w[i] = window.FeatureImportance.lrMultiplier(i) || 1.0; } catch (e) {}
    }
    return w;
  }

  function weightedDistance(a, b, weights) {
    const n = Math.min(a.length, b.length);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const diff = a[i] - b[i];
      s += weights[i] * diff * diff;
    }
    return Math.sqrt(s);
  }

  function predict(features, opts) {
    opts = opts || {};
    const k = opts.K || K;
    if (!features || features.length === 0) return null;

    const journal = loadJournal();
    // Only use entries that have been resolved with a non-flat outcome
    const candidates = journal.filter(e => {
      if (!isShortResolved(e)) return false;
      if (e.outcome !== 'correct' && e.outcome !== 'wrong') return false;
      return Array.isArray(e.features) && e.features.length === features.length;
    });

    if (candidates.length < MIN_NEIGHBORS_FOR_BLEND) {
      return { prob: null, n: candidates.length, neighbors: [], reason: 'insufficient-history' };
    }

    const weights = featureWeights();
    const scored = candidates.map(c => {
      const d = weightedDistance(features, c.features, weights);
      return { entry: c, distance: d };
    });
    scored.sort((a, b) => a.distance - b.distance);
    const topK = scored.slice(0, k);

    // For k-NN probability: inverse-distance weighted vote
    let totalWeight = 0;
    let weightedWins = 0;
    topK.forEach(n => {
      const w = 1 / Math.max(0.001, n.distance);
      totalWeight += w;
      // Convert outcome to direction-matching win/loss
      // entry.predProb indicated direction; outcome tells if that direction was right
      const wasRightDirection = n.entry.outcome === 'correct';
      const predUp = (n.entry.predProb || 0.5) >= 0.5;
      // If neighbor predicted UP and was right → up-vote
      // If neighbor predicted DOWN and was right → down-vote
      // For our prediction (which would also be UP if features are similar),
      // we want to know: "of similar past situations, what fraction won when predicting like this?"
      if (wasRightDirection) weightedWins += w;
    });

    const prob = weightedWins / totalWeight;
    return {
      prob,
      n: topK.length,
      neighbors: topK.map(n => ({
        sym: n.entry.sym,
        ts: n.entry.ts,
        distance: n.distance,
        outcome: n.entry.outcome,
        predProb: n.entry.predProb
      })),
      reason: 'ok'
    };
  }

  function blend(modelProb, features, alpha) {
    if (modelProb == null) return null;
    const a = alpha != null ? alpha : DEFAULT_ALPHA;
    const r = predict(features);
    if (!r || r.prob == null) return modelProb;
    return a * modelProb + (1 - a) * r.prob;
  }

  function summary() {
    const journal = loadJournal();
    const resolved = journal.filter(e => isShortResolved(e) && (e.outcome === 'correct' || e.outcome === 'wrong'));
    return {
      historySize: resolved.length,
      ready: resolved.length >= MIN_NEIGHBORS_FOR_BLEND,
      K: K,
      defaultAlpha: DEFAULT_ALPHA,
      featuresLen: 22
    };
  }

  window.KNNRecall = {
    predict,
    blend,
    summary,
    K,
    DEFAULT_ALPHA
  };
})();
