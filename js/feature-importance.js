/* ===========================================
   BPLEONE — Auto feature pruning & boosting via alpha map
   ---
   The continuous-learner already populates bpleone_feature_alpha_v1 with
   per-feature (wins, losses, sumContribWin, sumContribLoss, n) on every
   resolved prediction. This module turns that data into a per-feature
   learning-rate multiplier:

     alpha_score = avgContribWin - avgContribLoss
     |alpha_score| > threshold → boost (high-signal feature)
     |alpha_score| ≈ 0           → reduce (noise feature)

   The Model.train function reads window.FeatureImportance.lrMultiplier(i)
   for every feature i and scales the SGD step accordingly. Result:
   over time, predictive features get larger updates and noise features
   stop polluting the weights — automatic feature selection without
   any change to the feature pipeline.

   Math:
     multiplier = clamp(1.0 + ALPHA_SCALE × alpha_score, MIN_MULT, MAX_MULT)
   where ALPHA_SCALE controls aggressiveness. With alpha_score in
   roughly ±0.1, multipliers land in [0.2, 1.8] before clamping.

   Cache: refresh every 60 seconds; never block training.
   =========================================== */

(function () {
  const ALPHA_KEY = 'bpleone_feature_alpha_v1';
  const MIN_MULT = 0.2;            // floor — never zero (don't permanently disable)
  const MAX_MULT = 2.0;             // ceiling — avoid runaway updates
  const ALPHA_SCALE = 4.0;          // sensitivity. higher = more aggressive pruning
  const MIN_N_FOR_BOOSTING = 20;    // need enough samples per feature before adjusting
  const CACHE_TTL_MS = 60 * 1000;   // recompute multipliers once per minute

  let cache = null;
  let cacheTs = 0;

  function loadAlpha() {
    try { return JSON.parse(localStorage.getItem(ALPHA_KEY) || '{}'); } catch (e) { return {}; }
  }

  // Compute alpha_score and multiplier per feature
  function refreshCache() {
    const alpha = loadAlpha();
    const features = alpha.features || {};
    const result = {};
    for (let i = 0; i < 22; i++) {
      const f = features['f' + i];
      if (!f || f.n < MIN_N_FOR_BOOSTING) {
        result[i] = 1.0;  // neutral until enough data
        continue;
      }
      const avgWin = f.wins > 0 ? f.sumContribWin / f.wins : 0;
      const avgLoss = f.losses > 0 ? f.sumContribLoss / f.losses : 0;
      const alphaScore = avgWin - avgLoss;  // higher = more discriminating
      const mult = 1.0 + ALPHA_SCALE * alphaScore;
      result[i] = Math.max(MIN_MULT, Math.min(MAX_MULT, mult));
    }
    cache = result;
    cacheTs = Date.now();
    return result;
  }

  function lrMultiplier(featureIdx) {
    if (!cache || Date.now() - cacheTs > CACHE_TTL_MS) refreshCache();
    return (cache && cache[featureIdx]) != null ? cache[featureIdx] : 1.0;
  }

  // Summary for the dashboard
  function summary() {
    const alpha = loadAlpha();
    const features = alpha.features || {};
    if (!cache) refreshCache();
    const out = [];
    for (let i = 0; i < 22; i++) {
      const f = features['f' + i] || { n: 0, wins: 0, losses: 0, sumContribWin: 0, sumContribLoss: 0 };
      const avgWin = f.wins > 0 ? f.sumContribWin / f.wins : 0;
      const avgLoss = f.losses > 0 ? f.sumContribLoss / f.losses : 0;
      const alphaScore = avgWin - avgLoss;
      out.push({
        idx: i,
        n: f.n,
        wins: f.wins,
        losses: f.losses,
        avgWin,
        avgLoss,
        alphaScore,
        mult: cache[i] != null ? cache[i] : 1.0,
        status: cache[i] >= 1.3 ? 'boosted' : cache[i] <= 0.7 ? 'pruned' : 'neutral'
      });
    }
    return out;
  }

  // Recompute on demand
  function recompute() {
    cache = null;
    return refreshCache();
  }

  window.FeatureImportance = {
    lrMultiplier,
    summary,
    recompute,
    refreshCache,
    MIN_MULT,
    MAX_MULT,
    ALPHA_SCALE,
    MIN_N_FOR_BOOSTING
  };

  // Background refresh every minute
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(refreshCache, 5000);
      setInterval(refreshCache, CACHE_TTL_MS);
    });
  }
})();
