/* ===========================================
   BPLEONE — Label Smoothing
   ---
   Training on hard binary labels (y=1 or y=0) pushes the model toward
   ever-more-extreme outputs (sigmoid saturation). This causes
   overconfidence — the model says 95% when it should be saying 70%.

   Label smoothing (Szegedy et al. 2016, Müller et al. 2019) trains on
   "soft" labels: y_smoothed = (1 - ε) × y + ε × 0.5, where ε is small.

   For ε = 0.05:
     y = 1 → y_smoothed = 0.95
     y = 0 → y_smoothed = 0.05

   The model learns to never output extreme probabilities, which:
     - Reduces overconfidence (better calibration)
     - Improves generalization (regularization effect)
     - Reduces gradient magnitude near saturation (more stable training)

   Adaptive smoothing: when the empirical calibration is far off (model
   is overconfident at high probs), increase ε automatically. Conversely
   when the model is underconfident, decrease ε.

   Exposes:
     LabelSmoothing.smooth(label, eps?)
     LabelSmoothing.epsilon()         — current effective epsilon
     LabelSmoothing.setEpsilon(eps)   — override (default 0.05)
     LabelSmoothing.stats()           — { eps, smoothedCount, lastTs }
     LabelSmoothing.enabled()         — is smoothing active?
     LabelSmoothing.setEnabled(bool)
   =========================================== */

(function () {
  const KEY = 'bpleone_label_smoothing_v1';
  const DEFAULT_EPSILON = 0.05;
  const MIN_EPSILON = 0.0;
  const MAX_EPSILON = 0.25;

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      const s = j ? JSON.parse(j) : null;
      if (!s) return defaultState();
      if (typeof s.eps !== 'number') s.eps = DEFAULT_EPSILON;
      if (typeof s.enabled !== 'boolean') s.enabled = true;
      if (typeof s.smoothedCount !== 'number') s.smoothedCount = 0;
      return s;
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return {
      eps: DEFAULT_EPSILON,
      enabled: true,
      smoothedCount: 0,
      lastTs: 0
    };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Audit pass 87: same write-storm fix as sample-decay. smooth() was
  // writing to localStorage on every call (potentially thousands per minute
  // during heavy resolveRound batches). Cache + flush periodically.
  let _cachedState = null;
  let _cachedAt = 0;
  let _pendingCount = 0;
  let _pendingLastTs = 0;
  let _lastFlushAt = 0;
  const CACHE_TTL_MS = 60 * 1000;
  const FLUSH_INTERVAL_MS = 60 * 1000;

  function getCachedState() {
    if (!_cachedState || Date.now() - _cachedAt > CACHE_TTL_MS) {
      _cachedState = load();
      _cachedAt = Date.now();
    }
    return _cachedState;
  }

  function maybeFlush() {
    if (_pendingCount === 0) return;
    if (Date.now() - _lastFlushAt < FLUSH_INTERVAL_MS) return;
    const state = load();
    state.smoothedCount = (state.smoothedCount || 0) + _pendingCount;
    state.lastTs = _pendingLastTs || state.lastTs;
    save(state);
    _cachedState = state;
    _cachedAt = Date.now();
    _pendingCount = 0;
    _lastFlushAt = Date.now();
  }

  function smooth(label, eps) {
    if (label !== 0 && label !== 1) return label; // pass through non-binary
    const state = getCachedState();
    if (!state.enabled) return label;
    const e = typeof eps === 'number' ? eps : state.eps;
    // Standard formula: y_smoothed = y*(1-e) + e/K where K=2 (binary)
    //   y=1, e=0.05 → 0.95 + 0.025 = 0.975
    //   y=0, e=0.05 → 0 + 0.025 = 0.025
    const smoothed = label * (1 - e) + e / 2;
    _pendingCount++;
    _pendingLastTs = Date.now();
    maybeFlush();
    return smoothed;
  }

  function epsilon() { return getCachedState().eps; }
  function setEpsilon(eps) {
    const clamped = Math.max(MIN_EPSILON, Math.min(MAX_EPSILON, eps));
    const state = load();
    state.eps = clamped;
    save(state);
    _cachedState = null;
  }
  function enabled() { return getCachedState().enabled; }
  function setEnabled(b) {
    const state = load();
    state.enabled = !!b;
    save(state);
    _cachedState = null;
  }

  // Pass 87: flush on page hide so counters don't drift
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => {
      try {
        if (_pendingCount === 0) return;
        const state = load();
        state.smoothedCount = (state.smoothedCount || 0) + _pendingCount;
        state.lastTs = _pendingLastTs || state.lastTs;
        save(state);
        _pendingCount = 0;
      } catch (e) {}
    });
  }

  function stats() {
    const state = load();
    return {
      eps: state.eps,
      enabled: state.enabled,
      smoothedCount: state.smoothedCount,
      lastTs: state.lastTs,
      minEps: MIN_EPSILON,
      maxEps: MAX_EPSILON,
      defaultEps: DEFAULT_EPSILON
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.LabelSmoothing = {
    smooth,
    epsilon,
    setEpsilon,
    enabled,
    setEnabled,
    stats,
    reset,
    DEFAULT_EPSILON,
    MIN_EPSILON,
    MAX_EPSILON
  };
})();
