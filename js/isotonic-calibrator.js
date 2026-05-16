/* ===========================================
   BPLEONE — Isotonic Calibration
   ---
   Platt scaling fits a sigmoid: p_cal = sigmoid(a × logit(p_raw) + b).
   That works when the calibration curve is roughly sigmoidal, but if
   the curve is bumpy or has flat regions, Platt can't capture it.

   Isotonic regression is non-parametric: it fits an arbitrary
   monotonic step function to the (predicted, actual) pairs. More
   flexible than Platt but needs more data to avoid overfitting.

   Algorithm: Pool Adjacent Violators (PAV) on sorted-by-predicted pairs.
     1. Sort pairs by raw_prob ascending
     2. Compute running averages of actual labels
     3. Where averages violate monotonicity, pool adjacent groups
     4. Result is a piecewise-constant monotone non-decreasing function

   At inference, find the bracket containing rawProb, return its level.

   Exposes:
     IsotonicCalibrator.recordPair(rawProb, win)
     IsotonicCalibrator.fit() → { fitted, nBins }
     IsotonicCalibrator.calibrate(rawProb) → calibratedProb
     IsotonicCalibrator.stats()
     IsotonicCalibrator.reset()
   =========================================== */

(function () {
  const PAIRS_KEY = 'bpleone_isotonic_pairs_v1';
  const MODEL_KEY = 'bpleone_isotonic_model_v1';
  const MAX_PAIRS = 2000;
  const MIN_PAIRS_TO_FIT = 50;

  function loadPairs() {
    if (typeof localStorage === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(PAIRS_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function savePairs(p) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(PAIRS_KEY, JSON.stringify(p.slice(-MAX_PAIRS))); }
    catch (e) {}
  }
  function loadModel() {
    if (typeof localStorage === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem(MODEL_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function saveModel(m) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(MODEL_KEY, JSON.stringify(m)); }
    catch (e) {}
  }

  function recordPair(rawProb, win) {
    if (typeof rawProb !== 'number' || (win !== 0 && win !== 1)) return;
    if (rawProb < 0 || rawProb > 1) return;
    const pairs = loadPairs();
    pairs.push({ p: +rawProb.toFixed(4), w: win });
    savePairs(pairs);
  }

  // Pool Adjacent Violators (PAV) algorithm
  function pav(pairs) {
    if (pairs.length === 0) return [];
    const sorted = pairs.slice().sort((a, b) => a.p - b.p);
    // Initialize each point as its own block with weight 1
    const blocks = sorted.map(p => ({ x: p.p, y: p.w, w: 1, xMin: p.p, xMax: p.p }));
    let i = 0;
    while (i < blocks.length - 1) {
      if (blocks[i].y > blocks[i + 1].y) {
        // Violation — merge
        const a = blocks[i], b = blocks[i + 1];
        const merged = {
          x: (a.x * a.w + b.x * b.w) / (a.w + b.w),
          y: (a.y * a.w + b.y * b.w) / (a.w + b.w),
          w: a.w + b.w,
          xMin: Math.min(a.xMin, b.xMin),
          xMax: Math.max(a.xMax, b.xMax)
        };
        blocks.splice(i, 2, merged);
        if (i > 0) i--;
      } else {
        i++;
      }
    }
    return blocks;
  }

  function fit() {
    const pairs = loadPairs();
    if (pairs.length < MIN_PAIRS_TO_FIT) {
      return { fitted: false, n: pairs.length };
    }
    const blocks = pav(pairs);
    saveModel({ blocks, fittedAt: Date.now(), n: pairs.length });
    return { fitted: true, n: pairs.length, nBins: blocks.length };
  }

  function calibrate(rawProb) {
    if (typeof rawProb !== 'number' || rawProb < 0 || rawProb > 1) return rawProb;
    const model = loadModel();
    if (!model || !model.blocks || model.blocks.length === 0) {
      // No model fit yet — return raw
      return rawProb;
    }
    const blocks = model.blocks;
    // Find the block that contains rawProb
    // If rawProb < first block's xMin → return first block's y (clamp)
    if (rawProb <= blocks[0].xMax) return blocks[0].y;
    if (rawProb >= blocks[blocks.length - 1].xMin) return blocks[blocks.length - 1].y;
    for (let i = 0; i < blocks.length; i++) {
      if (rawProb >= blocks[i].xMin && rawProb <= blocks[i].xMax) {
        return blocks[i].y;
      }
    }
    // Interpolate between blocks if rawProb is between two blocks
    for (let i = 0; i < blocks.length - 1; i++) {
      if (rawProb > blocks[i].xMax && rawProb < blocks[i + 1].xMin) {
        const t = (rawProb - blocks[i].xMax) / (blocks[i + 1].xMin - blocks[i].xMax);
        return blocks[i].y + t * (blocks[i + 1].y - blocks[i].y);
      }
    }
    return rawProb;
  }

  function stats() {
    const pairs = loadPairs();
    const model = loadModel();
    return {
      n: pairs.length,
      fitted: !!model,
      nBins: model && model.blocks ? model.blocks.length : 0,
      fittedAt: model ? model.fittedAt : null,
      minToFit: MIN_PAIRS_TO_FIT
    };
  }

  function getBins() {
    const model = loadModel();
    return model && model.blocks ? model.blocks.slice() : [];
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(PAIRS_KEY);
    localStorage.removeItem(MODEL_KEY);
  }

  window.IsotonicCalibrator = {
    recordPair,
    fit,
    calibrate,
    stats,
    getBins,
    reset,
    MIN_PAIRS_TO_FIT,
    _pav: pav
  };
})();
