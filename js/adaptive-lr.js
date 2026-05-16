/* ===========================================
   BPLEONE — Drift-Adaptive Learning Rate
   ---
   Adam adapts per-parameter step sizes, but the global learning rate is
   fixed at this.lr = 0.05. When the market regime shifts (concept drift),
   a higher LR helps the model adapt faster. When loss has settled, a
   lower LR allows fine-tuning. This module dynamically adjusts model.lr
   based on the slope of recent loss.

   Algorithm:
     1. Periodically read model.lossHistory (already maintained by Model)
     2. Take the last 30 losses
     3. Fit a simple linear regression: loss_t = a + b × t
     4. If slope b > +threshold: loss is rising → drift detected → lr *= 1.10
        If slope b < -threshold: loss is falling → converging → lr *= 0.97
        Otherwise: no change
     5. Bound lr ∈ [0.01, 0.10]

   Exposes:
     AdaptiveLR.update()                 — one tuning step (auto-called every 5 min)
     AdaptiveLR.stats()                  — { lr, slope, lastUpdateTs, history }
     AdaptiveLR.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_adaptive_lr_v1';
  const WINDOW = 30;
  const MIN_LOSSES = 15;
  const SLOPE_UP_THRESHOLD = 0.001;     // rising loss
  const SLOPE_DOWN_THRESHOLD = -0.0008; // falling loss
  const LR_UP_FACTOR = 1.10;
  const LR_DOWN_FACTOR = 0.97;
  const LR_MIN = 0.01;
  const LR_MAX = 0.10;
  const MAX_HISTORY = 200;

  function load() {
    if (typeof localStorage === 'undefined') return { history: [], lastUpdateTs: 0 };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { history: [], lastUpdateTs: 0 };
    } catch (e) { return { history: [], lastUpdateTs: 0 }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Simple linear regression slope of y values (indices 0..n-1 as x)
  function slope(ys) {
    const n = ys.length;
    if (n < 2) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += ys[i];
      sumXY += i * ys[i];
      sumXX += i * i;
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    const num = sumXY - n * meanX * meanY;
    const den = sumXX - n * meanX * meanX;
    if (den === 0) return 0;
    return num / den;
  }

  function update() {
    if (typeof window === 'undefined') return null;
    const MS = window.ModelStore;
    if (!MS) return null;
    let model;
    try { model = MS.load(); } catch (e) { return null; }
    if (!model || !model.lossHistory || model.lossHistory.length < MIN_LOSSES) {
      return { skipped: true, reason: 'not enough loss samples' };
    }
    const recent = model.lossHistory.slice(-WINDOW).map(h => h.loss);
    const s = slope(recent);
    const currentLr = model.lr;
    let newLr = currentLr;
    let direction = 'unchanged';
    if (s > SLOPE_UP_THRESHOLD) {
      newLr = Math.min(LR_MAX, currentLr * LR_UP_FACTOR);
      direction = 'up';
    } else if (s < SLOPE_DOWN_THRESHOLD) {
      newLr = Math.max(LR_MIN, currentLr * LR_DOWN_FACTOR);
      direction = 'down';
    }
    if (newLr !== currentLr) {
      model.lr = newLr;
      try { MS.save(model); } catch (e) {}
    }
    const state = load();
    state.history.push({ t: Date.now(), slope: s, lrOld: currentLr, lrNew: newLr, direction });
    if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
    state.lastUpdateTs = Date.now();
    save(state);
    return { fitted: true, slope: s, lrOld: currentLr, lrNew: newLr, direction };
  }

  function stats() {
    const state = load();
    let model = null;
    if (typeof window !== 'undefined' && window.ModelStore) {
      try { model = window.ModelStore.load(); } catch (e) {}
    }
    return {
      currentLr: model ? model.lr : null,
      lastUpdateTs: state.lastUpdateTs,
      historyCount: state.history.length,
      recentHistory: state.history.slice(-20),
      minLr: LR_MIN,
      maxLr: LR_MAX,
      slopeUpThreshold: SLOPE_UP_THRESHOLD,
      slopeDownThreshold: SLOPE_DOWN_THRESHOLD
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  function start() {
    if (typeof window === 'undefined') return;
    if (window._adaptiveLrInterval) return;
    window._adaptiveLrInterval = setInterval(update, 5 * 60 * 1000); // every 5 min
  }

  window.AdaptiveLR = {
    update,
    stats,
    reset,
    start,
    _slope: slope
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(start, 8000);
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(start, 8000));
    }
  }
})();
