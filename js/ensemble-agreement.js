/* ===========================================
   BPLEONE — Ensemble agreement scorer
   ---
   When the multi-horizon ensemble (short/mid/long) AND the bootstrap
   ensemble (K=5 random subsets) AND the Bayesian dropout estimates all
   agree on direction, the prediction is robust. When they disagree, the
   prediction is fragile regardless of stated probability.

   Combines three independent uncertainty sources into one composite
   agreement score [0, 1]:
     - 1.0 = all signals point the same direction with similar magnitude
     - 0.5 = mixed signals
     - 0.0 = full disagreement (some say up, some say down)

   Used by brain-bet to amplify confidence on high-agreement picks and
   shrink size on low-agreement ones.

   Math:
     direction_agreement = pct of estimators on the majority side
     magnitude_agreement = 1 - (max_std across estimators / 0.20)
     score = (direction_agreement + magnitude_agreement) / 2

   Exposes:
     EnsembleAgreement.compute(features, model)
       → { score, byMethod, directionAgreement, magnitudeAgreement }
   =========================================== */

(function () {
  function direction(prob) { return prob >= 0.5 ? 'up' : 'down'; }

  // Combine probability estimates from multiple sources, return agreement
  function fromProbs(probs) {
    if (!probs || probs.length === 0) return null;
    const dirs = probs.map(direction);
    const upCount = dirs.filter(d => d === 'up').length;
    const dirAgree = Math.max(upCount, dirs.length - upCount) / dirs.length;
    const mean = probs.reduce((s, p) => s + p, 0) / probs.length;
    const variance = probs.reduce((s, p) => s + (p - mean) * (p - mean), 0) / probs.length;
    const std = Math.sqrt(variance);
    // Magnitude agreement: low std = high agreement. Reference: 0.20 std = full disagreement
    const magAgree = Math.max(0, 1 - std / 0.20);
    const score = (dirAgree + magAgree) / 2;
    return { score, dirAgree, magAgree, mean, std, n: probs.length };
  }

  function compute(features, model) {
    if (!features || !model) return null;
    const byMethod = {};

    // 1) Multi-horizon ensemble (3 estimators: short, mid, long)
    if (typeof MultiHorizon !== 'undefined') {
      try {
        const ens = MultiHorizon.predictEnsemble(features);
        byMethod.multihorizon = {
          probs: [ens.byHorizon.short, ens.byHorizon.mid, ens.byHorizon.long],
          weights: ens.weights
        };
      } catch (e) {}
    }

    // 2) Bootstrap ensemble (K=5 estimators)
    if (typeof BootstrapEnsemble !== 'undefined') {
      try {
        const boot = BootstrapEnsemble.predict(features);
        byMethod.bootstrap = { probs: boot.predictions || [], mean: boot.mean, std: boot.std };
      } catch (e) {}
    }

    // 3) MC Dropout (20 sample estimators)
    if (typeof BayesianDropout !== 'undefined') {
      try {
        const drop = BayesianDropout.predict(model, features);
        byMethod.dropout = { probs: drop.samples || [], mean: drop.mean, std: drop.std };
      } catch (e) {}
    }

    // Aggregate: pool all probability estimates across all methods
    const allProbs = [];
    Object.values(byMethod).forEach(m => {
      if (m.probs && Array.isArray(m.probs)) allProbs.push(...m.probs);
    });
    if (allProbs.length === 0) {
      // Fall back to single model prediction
      try {
        const p = model.predict(features).prob;
        allProbs.push(p);
      } catch (e) {}
    }
    const agg = fromProbs(allProbs);

    // Also compute direction agreement across the METHODS (not individual estimators)
    // i.e., does multi-horizon, bootstrap, and dropout all agree on direction?
    const methodDirs = [];
    Object.values(byMethod).forEach(m => {
      const meanProb = m.mean != null ? m.mean : (m.probs && m.probs.length > 0 ? m.probs.reduce((s, p) => s + p, 0) / m.probs.length : null);
      if (meanProb != null) methodDirs.push(direction(meanProb));
    });
    const methodUpCount = methodDirs.filter(d => d === 'up').length;
    const methodAgreement = methodDirs.length > 0
      ? Math.max(methodUpCount, methodDirs.length - methodUpCount) / methodDirs.length
      : 0;

    return {
      score: agg ? agg.score : 0.5,
      directionAgreement: agg ? agg.dirAgree : 0.5,
      magnitudeAgreement: agg ? agg.magAgree : 0.5,
      methodAgreement,
      methodCount: methodDirs.length,
      meanProb: agg ? agg.mean : 0.5,
      pooledStd: agg ? agg.std : 0,
      byMethod
    };
  }

  // Categorize an agreement score.
  // Audit pass 53: was lowercase ('strong'/'moderate'/...) but THREE callers
  // (confidence-kelly.js, trade-trust-score.js, brain-bet.html) compared
  // against UPPERCASE ('STRONG'/'MODERATE'/...) — every case-sensitive check
  // silently failed and the agreement-based size adjustments + colors never
  // fired. Returning UPPERCASE here matches the existing call sites.
  function categorize(score) {
    if (score == null) return 'UNKNOWN';
    if (score >= 0.85) return 'STRONG';
    if (score >= 0.65) return 'MODERATE';
    if (score >= 0.45) return 'MIXED';
    return 'FRAGMENTED';
  }

  // Multiplier for downstream sizing: amplify when all agree, shrink when split
  function sizeMultiplier(score) {
    if (score == null) return 1.0;
    if (score >= 0.85) return 1.10;  // small amplification for strong agreement
    if (score >= 0.65) return 1.00;
    if (score >= 0.45) return 0.75;
    return 0.40;
  }

  window.EnsembleAgreement = {
    compute,
    fromProbs,
    categorize,
    sizeMultiplier
  };
})();
