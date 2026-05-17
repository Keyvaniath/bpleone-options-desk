/* ===========================================
   BPLEONE — Prediction Probability Histogram
   ---
   Tracks the distribution of the brain's recent predicted probabilities.
   Tells Brandon if the brain is differentiating between trades or if
   everything is bunching up at the 0.50 boundary (brain isn't sure
   about anything).

   Healthy distribution: spread across [0.20, 0.80] with some confident
   predictions at both tails.
   Unhealthy: 90% of predictions in [0.45, 0.55] — brain is just outputting
   "I don't know" for everything.

   Exposes:
     PredictionHistogram.record(prob)
     PredictionHistogram.buckets(nBins=10) → array of bin counts
     PredictionHistogram.stats() → { n, meanProb, stdProb, confidentPct,
                                      muddyPct, distribution }
     PredictionHistogram.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_pred_histogram_v1';
  const MAX_LOG = 1000;

  function load() {
    if (typeof localStorage === 'undefined') return { probs: [] };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { probs: [] };
    } catch (e) { return { probs: [] }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function record(prob) {
    if (typeof prob !== 'number' || prob < 0 || prob > 1) return;
    const state = load();
    state.probs.push(+prob.toFixed(4));
    if (state.probs.length > MAX_LOG) state.probs = state.probs.slice(-MAX_LOG);
    save(state);
  }

  function buckets(nBins) {
    if (!nBins) nBins = 10;
    const state = load();
    const probs = state.probs;
    const out = [];
    for (let i = 0; i < nBins; i++) {
      const lo = i / nBins;
      const hi = (i + 1) / nBins;
      const isLast = (i === nBins - 1);
      const count = probs.filter(p => p >= lo && (isLast ? p <= hi : p < hi)).length;
      out.push({ binStart: lo, binEnd: hi, count });
    }
    return out;
  }

  function stats() {
    const state = load();
    const probs = state.probs;
    const n = probs.length;
    if (n === 0) {
      return { n, meanProb: null, stdProb: null, confidentPct: null, muddyPct: null, ready: false };
    }
    const meanProb = probs.reduce((s, v) => s + v, 0) / n;
    const variance = probs.reduce((s, v) => s + (v - meanProb) * (v - meanProb), 0) / Math.max(1, n - 1);
    const stdProb = Math.sqrt(variance);
    // Confident = |p - 0.5| > 0.25 → p > 0.75 or p < 0.25
    const confidentPct = probs.filter(p => Math.abs(p - 0.5) > 0.25).length / n;
    // Muddy = |p - 0.5| < 0.05 → p in [0.45, 0.55]
    const muddyPct = probs.filter(p => Math.abs(p - 0.5) < 0.05).length / n;
    // Long bias
    const longPct = probs.filter(p => p > 0.55).length / n;
    const shortPct = probs.filter(p => p < 0.45).length / n;
    return {
      n,
      meanProb,
      stdProb,
      confidentPct,
      muddyPct,
      longPct,
      shortPct,
      distribution: buckets(10),
      ready: true
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.PredictionHistogram = {
    record,
    buckets,
    stats,
    reset
  };
})();
