/* ===========================================
   BPLEONE — Active Learning by Uncertainty
   ---
   Classical training treats every example equally. But that's wasteful:
   the model already gets most predictions in the 0.20/0.80 range right.
   The examples that actually teach the model the most are the ones it
   was uncertain about — examples near the decision boundary, or with
   high MC-dropout variance, or with bootstrap disagreement.

   This module computes a per-example sample-weight multiplier in
   [1.0, 3.0] from three uncertainty signals:

     1. Decision-boundary distance: |p - 0.5| small → multiplier ↑
     2. MC dropout std (Bayesian uncertainty): high std → multiplier ↑
     3. Bootstrap divergence: high std → multiplier ↑

   When a resolution arrives, continuous-learner multiplies its standard
   sampleWeight by this active-learning multiplier before feeding to
   Model.train(). Result: the model learns more from the examples it
   needed to learn from, less from "easy" examples it already had right.

   Reference: Settles 2009 ("Active Learning Literature Survey")

   Exposes:
     ActiveLearning.computeMultiplier(entry) → number in [1.0, 3.0]
     ActiveLearning.record(mult, label, predProb)
     ActiveLearning.stats() → { n, avgMult, distribution, gainSignal }
     ActiveLearning.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_active_learning_v1';
  const MAX_LOG = 1000;

  // Clamp range — keep multipliers reasonable
  const MIN_MULT = 1.0;
  const MAX_MULT = 3.0;

  function load() {
    if (typeof localStorage === 'undefined') return { log: [] };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { log: [] };
    } catch (e) { return { log: [] }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Compute sample-weight multiplier from a journal entry's stored
  // uncertainty signals. All inputs optional — falls back to 1.0 if missing.
  function computeMultiplier(entry) {
    if (!entry) return 1.0;

    // Signal 1: Decision-boundary distance — uncertainty peaks at 0.5
    // distance ∈ [0, 0.5], normalize to [0, 1] where 1 = at boundary
    let boundaryScore = 0;
    if (typeof entry.predProb === 'number') {
      boundaryScore = 1 - 2 * Math.abs(entry.predProb - 0.5); // 1 at p=0.5, 0 at p=0 or 1
    }

    // Signal 2: MC dropout uncertainty (std typically in [0, 0.25])
    let dropoutScore = 0;
    if (typeof entry.uncertaintyStd === 'number') {
      dropoutScore = Math.min(1, entry.uncertaintyStd / 0.15); // 0.15 std → score 1
    }

    // Signal 3: Bootstrap disagreement (std typically in [0, 0.2])
    let bootstrapScore = 0;
    if (typeof entry.bootstrapStd === 'number') {
      bootstrapScore = Math.min(1, entry.bootstrapStd / 0.12); // 0.12 std → score 1
    }

    // Average of available signals — only count signals that were actually present
    let totalSignal = 0;
    let count = 0;
    if (typeof entry.predProb === 'number') { totalSignal += boundaryScore; count++; }
    if (typeof entry.uncertaintyStd === 'number') { totalSignal += dropoutScore; count++; }
    if (typeof entry.bootstrapStd === 'number') { totalSignal += bootstrapScore; count++; }
    if (count === 0) return 1.0;
    const avgSignal = totalSignal / count; // in [0, 1]

    // Map signal in [0, 1] to multiplier in [MIN_MULT, MAX_MULT]
    const mult = MIN_MULT + (MAX_MULT - MIN_MULT) * avgSignal;
    return Math.max(MIN_MULT, Math.min(MAX_MULT, mult));
  }

  function record(mult, label, predProb) {
    if (typeof mult !== 'number' || (label !== 0 && label !== 1)) return;
    const state = load();
    state.log.push({ m: +mult.toFixed(3), y: label, p: typeof predProb === 'number' ? +predProb.toFixed(4) : null, t: Date.now() });
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save(state);
  }

  function stats() {
    const state = load();
    if (!state.log || state.log.length === 0) {
      return { n: 0, avgMult: null, distribution: null, gainSignal: null };
    }
    const log = state.log;
    const avgMult = log.reduce((s, r) => s + r.m, 0) / log.length;

    // Distribution of multipliers (4 buckets)
    const buckets = { low: 0, midLow: 0, midHigh: 0, high: 0 };
    log.forEach(r => {
      if (r.m < 1.5) buckets.low++;
      else if (r.m < 2.0) buckets.midLow++;
      else if (r.m < 2.5) buckets.midHigh++;
      else buckets.high++;
    });

    // Gain signal: did high-mult examples improve the model more?
    // Heuristic: compare average prediction error on high-mult vs low-mult
    const high = log.filter(r => r.m >= 2.0);
    const low = log.filter(r => r.m < 1.5);
    const avgErrHigh = high.length > 0 ? high.reduce((s, r) => s + Math.abs(r.y - (r.p != null ? r.p : 0.5)), 0) / high.length : null;
    const avgErrLow = low.length > 0 ? low.reduce((s, r) => s + Math.abs(r.y - (r.p != null ? r.p : 0.5)), 0) / low.length : null;

    return {
      n: log.length,
      avgMult,
      distribution: buckets,
      gainSignal: (avgErrHigh != null && avgErrLow != null) ? { high: avgErrHigh, low: avgErrLow } : null
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.ActiveLearning = {
    computeMultiplier,
    record,
    stats,
    reset,
    MIN_MULT,
    MAX_MULT
  };
})();
