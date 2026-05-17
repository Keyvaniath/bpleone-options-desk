/* ===========================================
   BPLEONE — Prediction Volume + Resolution Latency Tracker
   ---
   Diagnostic for "is the brain actually running?" Tracks how many
   predictions are made per hour and how long they take to resolve.

   If volume drops to zero, the continuous-learner has stopped. If
   resolution latency grows beyond expected horizon (~10min for short),
   resolutions are silently failing.

   Exposes:
     VolumeTracker.recordPrediction(timestamp)
     VolumeTracker.recordResolution(predictionTs, resolutionTs)
     VolumeTracker.stats() → { predictionsLastHour, resolutionsLastHour,
                                avgLatencyMs, latencyP95Ms, ready }
     VolumeTracker.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_volume_tracker_v1';
  const MAX_LOG = 2000;
  const HOUR_MS = 60 * 60 * 1000;

  function load() {
    if (typeof localStorage === 'undefined') return { preds: [], resolutions: [] };
    try {
      const j = localStorage.getItem(KEY);
      const s = j ? JSON.parse(j) : null;
      if (!s) return { preds: [], resolutions: [] };
      if (!s.preds) s.preds = [];
      if (!s.resolutions) s.resolutions = [];
      return s;
    } catch (e) { return { preds: [], resolutions: [] }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function recordPrediction(ts) {
    if (!ts) ts = Date.now();
    const state = load();
    state.preds.push(ts);
    if (state.preds.length > MAX_LOG) state.preds = state.preds.slice(-MAX_LOG);
    save(state);
  }

  function recordResolution(predictionTs, resolutionTs) {
    if (!predictionTs) return;
    if (!resolutionTs) resolutionTs = Date.now();
    const latency = resolutionTs - predictionTs;
    if (latency < 0 || latency > 30 * 24 * HOUR_MS) return; // sanity bounds
    const state = load();
    state.resolutions.push({ predTs: predictionTs, resTs: resolutionTs, latency });
    if (state.resolutions.length > MAX_LOG) state.resolutions = state.resolutions.slice(-MAX_LOG);
    save(state);
  }

  function stats() {
    const state = load();
    const now = Date.now();
    const cutoff = now - HOUR_MS;

    const predsLastHour = state.preds.filter(t => t >= cutoff).length;
    const resInLastHour = state.resolutions.filter(r => r.resTs >= cutoff);
    const resolutionsLastHour = resInLastHour.length;

    // Latency on the last 100 resolutions
    const recent = state.resolutions.slice(-100);
    let avgLatency = null, p95Latency = null;
    if (recent.length > 0) {
      const lats = recent.map(r => r.latency).sort((a, b) => a - b);
      avgLatency = lats.reduce((s, v) => s + v, 0) / lats.length;
      p95Latency = lats[Math.floor(lats.length * 0.95)] || lats[lats.length - 1];
    }

    // Stale-pred check: any predictions made > 24h ago that never resolved
    const dayAgo = now - 24 * HOUR_MS;
    const predsBeforeDayAgo = state.preds.filter(t => t < dayAgo).length;
    const resolvedBeforeDayAgo = state.resolutions.filter(r => r.predTs < dayAgo).length;
    const unresolvedOlderThan24h = Math.max(0, predsBeforeDayAgo - resolvedBeforeDayAgo);

    return {
      predictionsLastHour: predsLastHour,
      resolutionsLastHour,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
      avgLatencyMin: avgLatency != null ? avgLatency / 60000 : null,
      p95LatencyMin: p95Latency != null ? p95Latency / 60000 : null,
      totalPredictions: state.preds.length,
      totalResolutions: state.resolutions.length,
      unresolvedOlderThan24h,
      ready: state.preds.length > 0 || state.resolutions.length > 0
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.VolumeTracker = {
    recordPrediction,
    recordResolution,
    stats,
    reset,
    MAX_LOG
  };
})();
