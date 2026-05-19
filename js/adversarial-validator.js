/* ===========================================
   BPLEONE — Adversarial Validation (Covariate Shift Detection)
   ---
   DriftPSI measures whether the OUTPUT distribution has shifted (concept
   drift). This module measures whether the INPUT distribution has shifted
   (covariate shift) — a different problem.

   Algorithm (Kaggle-style adversarial validation):
     1. Maintain two pools: "old" features (>24h ago) and "recent" (<2h)
     2. Label old as 0, recent as 1
     3. Train a logistic regression to predict this label
     4. Measure AUC on a held-out split
     5. AUC ≈ 0.5 → no shift; AUC near 1.0 → strong shift

   If a strong shift is detected, the brain can:
     - Fire a 'bpleone:covariate-shift' event
     - Scale predictions toward 0.5 (under uncertainty)
     - Force a model retrain on more recent data

   We use a tiny SGD logistic regression with the same feature dimension
   as the main model (FEATURES.length = 22). Cheap to train.

   Exposes:
     AdversarialValidator.captureFeature(features)
     AdversarialValidator.fit()                  — train the adv classifier
     AdversarialValidator.score()                — { auc, shifted, n_old, n_recent }
     AdversarialValidator.predict(features)      — returns adv-score (0..1)
     AdversarialValidator.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_advval_v1';
  // Audit pass 79: was 500. With continuous-learner now capturing ~138/hr
  // during RTH (~900/day), a 500-entry pool only holds the last ~13 hours.
  // OLD_THRESHOLD_MS requires entries 24h+ old — they get trimmed before
  // they age in. Result: fit() ALWAYS returned `{ fitted: false }` and
  // covariate-shift detection silently never fired across the whole site.
  // Bumped to 5000 (~5.5 days @ 900/day) — plenty of headroom on both sides
  // of the 24h boundary. Storage cost: 5000 × ~22 floats × ~8B ≈ 880KB.
  const MAX_POOL = 5000;
  const OLD_THRESHOLD_MS = 24 * 3600 * 1000;     // 24h+
  const RECENT_THRESHOLD_MS = 2 * 3600 * 1000;   // <2h
  const MIN_POOL_TO_FIT = 30;                    // need 30 in each side
  const SHIFT_AUC_THRESHOLD = 0.70;              // above this = significant shift

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : defaultState();
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return { pool: [], weights: null, lastFitAt: 0, lastAuc: null };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function sigmoid(z) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))); }

  function captureFeature(features) {
    if (!features || features.length === 0) return;
    const state = load();
    state.pool.push({ x: features.slice(), t: Date.now() });
    if (state.pool.length > MAX_POOL) state.pool = state.pool.slice(-MAX_POOL);
    save(state);
  }

  // Train adversarial classifier on (old=0, recent=1)
  function fit(opts) {
    opts = opts || {};
    const state = load();
    const now = Date.now();
    const old = state.pool.filter(p => (now - p.t) > OLD_THRESHOLD_MS);
    const recent = state.pool.filter(p => (now - p.t) < RECENT_THRESHOLD_MS);
    if (old.length < MIN_POOL_TO_FIT || recent.length < MIN_POOL_TO_FIT) {
      return { fitted: false, n_old: old.length, n_recent: recent.length };
    }
    // Build labeled dataset
    const data = [];
    old.forEach(p => data.push({ x: p.x, y: 0 }));
    recent.forEach(p => data.push({ x: p.x, y: 1 }));
    // Shuffle deterministically
    let seed = 12345;
    function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (let i = data.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [data[i], data[j]] = [data[j], data[i]];
    }
    // 70/30 train/test split
    const splitIdx = Math.floor(data.length * 0.7);
    const train = data.slice(0, splitIdx);
    const test = data.slice(splitIdx);
    if (train.length === 0 || test.length === 0) {
      return { fitted: false, n_old: old.length, n_recent: recent.length };
    }
    // Train logistic regression with SGD
    const dim = train[0].x.length;
    const w = new Array(dim + 1).fill(0); // +1 for bias
    const lr = 0.05;
    const epochs = opts.epochs || 60;
    for (let epoch = 0; epoch < epochs; epoch++) {
      for (const row of train) {
        let z = w[dim]; // bias
        for (let i = 0; i < dim; i++) z += row.x[i] * w[i];
        const p = sigmoid(z);
        const err = p - row.y;
        for (let i = 0; i < dim; i++) {
          w[i] -= lr * err * row.x[i];
        }
        w[dim] -= lr * err;
      }
    }
    // Compute AUC on test set
    const scores = test.map(row => {
      let z = w[dim];
      for (let i = 0; i < dim; i++) z += row.x[i] * w[i];
      return { p: sigmoid(z), y: row.y };
    });
    const auc = computeAuc(scores);
    state.weights = w;
    state.lastFitAt = now;
    state.lastAuc = auc;
    save(state);
    // Audit pass 79: symmetric shift detection. AUC near 1.0 = strong shift
    // (recent is easy to distinguish from old); AUC near 0.0 also = strong
    // shift but with the classifier-convention flipped (rare with proper
    // labeling but defensive). Both ends mean covariate shift; only the
    // middle (~0.5) means no shift.
    const shiftMag = Math.abs(auc - 0.5);
    return {
      fitted: true,
      auc,
      shiftMag,
      shifted: shiftMag > (SHIFT_AUC_THRESHOLD - 0.5),
      n_old: old.length,
      n_recent: recent.length,
      n_test: test.length
    };
  }

  // AUC of a binary classifier (Mann-Whitney form)
  function computeAuc(scores) {
    if (!scores || scores.length === 0) return 0.5;
    const pos = scores.filter(s => s.y === 1).map(s => s.p);
    const neg = scores.filter(s => s.y === 0).map(s => s.p);
    if (pos.length === 0 || neg.length === 0) return 0.5;
    let count = 0;
    for (const p of pos) {
      for (const n of neg) {
        if (p > n) count++;
        else if (p === n) count += 0.5;
      }
    }
    return count / (pos.length * neg.length);
  }

  function score() {
    const state = load();
    const auc = state.lastAuc;
    const shiftMag = auc != null ? Math.abs(auc - 0.5) : null;
    return {
      lastAuc: auc,
      shiftMag,
      // Pass 79: symmetric — both auc>0.7 and auc<0.3 indicate shift.
      shifted: shiftMag != null && shiftMag > (SHIFT_AUC_THRESHOLD - 0.5),
      lastFitAt: state.lastFitAt,
      poolSize: state.pool.length,
      hasWeights: !!state.weights,
      shiftThreshold: SHIFT_AUC_THRESHOLD
    };
  }

  function predict(features) {
    if (!features) return null;
    const state = load();
    if (!state.weights) return null;
    const w = state.weights;
    if (w.length !== features.length + 1) return null;
    let z = w[features.length]; // bias
    for (let i = 0; i < features.length; i++) z += features[i] * w[i];
    return sigmoid(z);
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  // Auto-fit loop: refit every 30 minutes
  let _lastAutoFitTs = 0;
  function _autoFit() {
    try {
      if (Date.now() - _lastAutoFitTs < 29 * 60 * 1000) return;
      const res = fit();
      if (res.fitted) {
        _lastAutoFitTs = Date.now();
        if (res.shifted && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('bpleone:covariate-shift', { detail: res }));
        }
      }
    } catch (e) {}
  }

  function start() {
    if (typeof window === 'undefined') return;
    if (window._advValInterval) return;
    window._advValInterval = setInterval(_autoFit, 5 * 60 * 1000);
  }

  window.AdversarialValidator = {
    captureFeature,
    fit,
    score,
    predict,
    reset,
    start,
    OLD_THRESHOLD_MS,
    RECENT_THRESHOLD_MS,
    SHIFT_AUC_THRESHOLD
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(start, 5000);
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(start, 5000));
    }
  }
})();
