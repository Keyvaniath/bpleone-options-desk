/* ===========================================
   BPLEONE — Reliability Diagram Builder
   ---
   The gold-standard calibration visualization. Bins predictions by
   predicted probability (e.g. [0.0-0.1], [0.1-0.2], ..., [0.9-1.0])
   and shows the actual win rate within each bin.

   For a perfectly-calibrated model, the actual win rate should equal
   the bin center: when the model says "60%" the actual win rate IS
   60%. Deviations show miscalibration:
     - Bin actual > predicted → model is under-confident in this range
     - Bin actual < predicted → model is over-confident in this range

   Also computes Expected Calibration Error (ECE):
     ECE = Σ (n_bin / N) × |actual_bin - predicted_bin|

   Lower ECE = better calibration. Below 0.05 is excellent.

   Exposes:
     ReliabilityDiagram.recordPair(predicted, actual)
     ReliabilityDiagram.buckets(nBins=10) → array of bucket stats
     ReliabilityDiagram.ece(nBins=10) → expected calibration error
     ReliabilityDiagram.stats()
     ReliabilityDiagram.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_reliability_v1';
  const MAX_PAIRS = 2000;

  function load() {
    if (typeof localStorage === 'undefined') return { pairs: [] };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { pairs: [] };
    } catch (e) { return { pairs: [] }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function recordPair(predicted, actual) {
    if (typeof predicted !== 'number' || (actual !== 0 && actual !== 1)) return;
    if (predicted < 0 || predicted > 1) return;
    const state = load();
    state.pairs.push({ p: +predicted.toFixed(4), y: actual });
    if (state.pairs.length > MAX_PAIRS) state.pairs = state.pairs.slice(-MAX_PAIRS);
    save(state);
  }

  function buckets(nBins) {
    if (!nBins) nBins = 10;
    const state = load();
    const pairs = state.pairs;
    const out = [];
    for (let i = 0; i < nBins; i++) {
      const lo = i / nBins;
      const hi = (i + 1) / nBins;
      // The last bucket is inclusive on both ends to capture p=1.0
      const isLast = (i === nBins - 1);
      const inBin = pairs.filter(p => p.p >= lo && (isLast ? p.p <= hi : p.p < hi));
      const n = inBin.length;
      if (n === 0) {
        out.push({ binStart: lo, binEnd: hi, n: 0, meanPredicted: null, actualWinRate: null, gap: null });
        continue;
      }
      const meanPredicted = inBin.reduce((s, p) => s + p.p, 0) / n;
      const actualWinRate = inBin.reduce((s, p) => s + p.y, 0) / n;
      out.push({
        binStart: lo,
        binEnd: hi,
        n,
        meanPredicted,
        actualWinRate,
        gap: actualWinRate - meanPredicted // + = under-confident; - = over-confident
      });
    }
    return out;
  }

  function ece(nBins) {
    if (!nBins) nBins = 10;
    const state = load();
    const N = state.pairs.length;
    if (N === 0) return null;
    const bins = buckets(nBins);
    let sum = 0;
    for (const b of bins) {
      if (b.n === 0) continue;
      sum += (b.n / N) * Math.abs(b.actualWinRate - b.meanPredicted);
    }
    return sum;
  }

  function stats() {
    const state = load();
    return {
      n: state.pairs.length,
      maxPairs: MAX_PAIRS,
      ece10: ece(10),
      ece20: ece(20)
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.ReliabilityDiagram = {
    recordPair,
    buckets,
    ece,
    stats,
    reset,
    MAX_PAIRS
  };
})();
