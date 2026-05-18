/* ===========================================
   BPLEONE — Probability calibration via Platt scaling
   ---
   The raw logistic-regression probability is rarely well-calibrated.
   A model might output 70% confident and actually win 50% of the time
   (overconfident), or output 55% and actually win 70% (underconfident).

   This module fits a sigmoid mapping P_calibrated = sigmoid(a × P_raw + b)
   to the observed (predicted, actual) pairs. After calibration, when the
   model says 70%, it should actually win ~70% of the time — within the
   noise of the sample size.

   Exposes:
     Calibrator.recordPair(rawProb, actualWin)  — add a labeled pair
     Calibrator.fit()                           — re-fit a,b from history
     Calibrator.calibrate(rawProb)              — map raw → calibrated
     Calibrator.reliability()                   — bin table for the chart
     Calibrator.metrics()                       — Brier score + ECE
   =========================================== */

(function () {
  const PAIRS_KEY = 'bpleone_calib_pairs_v1';  // [{ rawProb, win, ts }, ...]
  const PARAMS_KEY = 'bpleone_calib_params_v1'; // { a, b, fittedAt, n }
  const MAX_PAIRS = 5000;
  const MIN_PAIRS_TO_FIT = 30;

  function loadPairs() { try { return JSON.parse(localStorage.getItem(PAIRS_KEY) || '[]'); } catch (e) { return []; } }
  function savePairs(p) { try { localStorage.setItem(PAIRS_KEY, JSON.stringify(p.slice(-MAX_PAIRS))); } catch (e) {} }
  function loadParams() { try { return JSON.parse(localStorage.getItem(PARAMS_KEY) || 'null'); } catch (e) { return null; } }
  function saveParams(p) { try { localStorage.setItem(PARAMS_KEY, JSON.stringify(p)); } catch (e) {} }

  function sigmoid(z) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))); }
  function logit(p) {
    const eps = 1e-6;
    const c = Math.max(eps, Math.min(1 - eps, p));
    return Math.log(c / (1 - c));
  }

  function recordPair(rawProb, win) {
    if (typeof rawProb !== 'number' || (win !== 0 && win !== 1)) return;
    const pairs = loadPairs();
    pairs.push({ p: +rawProb.toFixed(4), w: win, ts: Date.now() });
    savePairs(pairs);
  }

  // -------- Platt scaling fit via gradient descent --------
  // Minimize log-loss: -sum(w × log(p̂) + (1-w) × log(1-p̂))
  // where p̂ = sigmoid(a × x + b), x = logit(raw)
  function fit(opts) {
    opts = opts || {};
    const pairs = loadPairs();
    if (pairs.length < MIN_PAIRS_TO_FIT) return null;
    // Use last 1000 pairs for the fit (recency bias)
    const data = pairs.slice(-1000).map(p => ({ x: logit(p.p), y: p.w }));
    let a = 1.0, b = 0.0;
    const lr = 0.05;
    const epochs = opts.epochs || 200;
    for (let epoch = 0; epoch < epochs; epoch++) {
      let gradA = 0, gradB = 0;
      data.forEach(({ x, y }) => {
        const pHat = sigmoid(a * x + b);
        const err = pHat - y;
        gradA += err * x;
        gradB += err;
      });
      gradA /= data.length;
      gradB /= data.length;
      a -= lr * gradA;
      b -= lr * gradB;
    }
    const params = { a, b, fittedAt: Date.now(), n: data.length };
    saveParams(params);
    return params;
  }

  function calibrate(rawProb) {
    const params = loadParams();
    if (!params) return rawProb;  // identity until fitted
    const x = logit(rawProb);
    return sigmoid(params.a * x + params.b);
  }

  // -------- Reliability bins for the chart --------
  function reliability(nBins) {
    nBins = nBins || 10;
    const pairs = loadPairs();
    const bins = [];
    for (let i = 0; i < nBins; i++) {
      const lo = i / nBins;
      const hi = (i + 1) / nBins;
      const inBin = pairs.filter(p => p.p >= lo && p.p < (i === nBins - 1 ? hi + 0.001 : hi));
      const n = inBin.length;
      const wins = inBin.filter(p => p.w === 1).length;
      const avgRaw = n > 0 ? inBin.reduce((s, p) => s + p.p, 0) / n : (lo + hi) / 2;
      bins.push({
        lo, hi,
        center: (lo + hi) / 2,
        n,
        actualWinRate: n > 0 ? wins / n : null,
        avgRawProb: avgRaw,
        calibratedAvg: calibrate(avgRaw)
      });
    }
    return bins;
  }

  // -------- Metrics --------
  // Brier score: mean squared error of raw probabilities
  // ECE: expected calibration error — weighted average bin deviation
  function metrics() {
    const pairs = loadPairs();
    if (pairs.length === 0) return { n: 0, brier: null, ece: null, calibratedBrier: null, calibratedEce: null };
    let brier = 0, calBrier = 0;
    pairs.forEach(p => {
      brier += (p.p - p.w) ** 2;
      calBrier += (calibrate(p.p) - p.w) ** 2;
    });
    brier /= pairs.length;
    calBrier /= pairs.length;

    const bins = reliability(10);
    let ece = 0, eceCal = 0;
    bins.forEach(b => {
      if (b.actualWinRate == null || b.n === 0) return;
      ece += (b.n / pairs.length) * Math.abs(b.avgRawProb - b.actualWinRate);
      eceCal += (b.n / pairs.length) * Math.abs(b.calibratedAvg - b.actualWinRate);
    });
    return {
      n: pairs.length,
      brier: brier,
      ece: ece,
      calibratedBrier: calBrier,
      calibratedEce: eceCal,
      params: loadParams()
    };
  }

  // -------- Auto re-fit on a cadence --------
  // Refit every 50 new pairs or once per hour, whichever comes first.
  let lastFitN = 0;
  let lastFitAt = 0;
  function maybeFit() {
    const pairs = loadPairs();
    const params = loadParams();
    if (pairs.length < MIN_PAIRS_TO_FIT) return false;
    const since = Date.now() - lastFitAt;
    const newPairs = pairs.length - lastFitN;
    // Audit pass 45: on first fit (no params yet), MIN_PAIRS_TO_FIT should be
    // sufficient to trigger. Previously the 50-new-pairs threshold combined
    // with lastFitN=0 meant first-fit didn't fire until pairs.length >= 50,
    // even though MIN_PAIRS_TO_FIT was stated as 30. That delayed calibration
    // by 20 extra pairs on a cold start.
    if (!params || newPairs >= 50 || (params && since > 60 * 60 * 1000)) {
      const result = fit();
      if (result) {
        lastFitN = pairs.length;
        lastFitAt = Date.now();
        try {
          window.dispatchEvent(new CustomEvent('bpleone:calibration-fit', { detail: { params: result, n: result.n } }));
        } catch (e) {}
        return true;
      }
    }
    return false;
  }

  window.Calibrator = {
    recordPair,
    fit,
    calibrate,
    reliability,
    metrics,
    maybeFit,
    _loadPairs: loadPairs,
    _loadParams: loadParams
  };
})();
