/* ===========================================
   BPLEONE — Calibration View
   ---
   For each 10% conviction bucket (50-60, 60-70, ...), computes:
     - Predicted probability (midpoint)
     - Actual hit rate over resolved trades
     - Sample size

   A well-calibrated brain has actual ≈ predicted across all buckets.

   Exposes:
     CalibrationView.compute(opts?) -> [{ bucket, predicted, actual, n }]
     CalibrationView.brierScore() -> mean (predicted - actual)^2
     CalibrationView.eceCalibrationError() -> expected calibration error
   =========================================== */

(function () {
  const JOURNAL_KEY = 'bpleone_pred_journal_v1';

  function loadResolved() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const journal = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
      return journal.filter(e => {
        if (!e || typeof e.predProb !== 'number' || typeof e.realizedRet !== 'number') return false;
        const r = e.resolved;
        return r && (r === true || (r.short && r.short !== false && r.short !== 'flat'));
      });
    } catch (e) { return []; }
  }

  function bucketsFor(conv) {
    // 10 buckets: 0-10, 10-20, ..., 90-100
    return Math.min(9, Math.floor(conv * 10));
  }

  function compute(opts) {
    opts = opts || {};
    const entries = loadResolved();
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      idx: i, low: i * 0.10, high: (i + 1) * 0.10, mid: i * 0.10 + 0.05,
      n: 0, wins: 0
    }));
    for (const e of entries) {
      const conv = e.predProb;
      // Predicted win = LONG if conv>=0.5, SHORT if <0.5
      const predictedDir = conv >= 0.5 ? +1 : -1;
      const realizedDir = e.realizedRet >= 0.003 ? +1 : (e.realizedRet <= -0.003 ? -1 : 0);
      if (realizedDir === 0) continue;   // flat
      const win = predictedDir === realizedDir;
      // Bucket by max(conv, 1-conv) (the brain's confidence in either direction)
      const confidence = Math.max(conv, 1 - conv);
      const b = bucketsFor(confidence);
      buckets[b].n++;
      if (win) buckets[b].wins++;
    }
    buckets.forEach(b => {
      b.actual = b.n > 0 ? b.wins / b.n : null;
      b.predicted = b.mid;
      b.error = b.actual != null ? b.actual - b.predicted : null;
    });
    return buckets.filter(b => b.idx >= 5);   // we only really care about 50-100% confidence buckets
  }

  function brierScore() {
    const entries = loadResolved();
    if (entries.length === 0) return null;
    let sum = 0;
    let n = 0;
    for (const e of entries) {
      const predictedDir = e.predProb >= 0.5 ? 1 : 0;
      const conf = e.predProb;
      // Use raw probability as the predicted prob of "model thinks LONG wins"
      const actualUp = e.realizedRet > 0.003 ? 1 : (e.realizedRet < -0.003 ? 0 : null);
      if (actualUp === null) continue;
      // Brier for "P(up)" prediction
      const p = e.predProb;
      sum += (p - actualUp) * (p - actualUp);
      n++;
    }
    return n > 0 ? +(sum / n).toFixed(4) : null;
  }

  function ece() {
    const bs = compute();
    let total = 0, weighted = 0;
    for (const b of bs) {
      if (b.actual == null) continue;
      const diff = Math.abs(b.actual - b.predicted);
      weighted += diff * b.n;
      total += b.n;
    }
    return total > 0 ? +(weighted / total).toFixed(4) : null;
  }

  window.CalibrationView = { compute, brierScore, ece };
})();
