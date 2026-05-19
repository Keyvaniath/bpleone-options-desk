/* ===========================================
   BPLEONE — Out-of-distribution / outlier detector
   ---
   The model is trained on a finite slice of feature vectors. If a new
   prediction is requested on a feature vector outside that slice (e.g.,
   during a black-swan day with extreme VIX or unprecedented gap), the
   model extrapolates confidently into nonsense.

   This module maintains running mean/std for each of the 22 features
   using Welford's online algorithm. For every new prediction, the
   detector computes per-feature z-scores. If too many features are
   >Z_THRESHOLD standard deviations from the training mean, the input
   is flagged "out of distribution" and the caller can either:
     - skip the trade entirely
     - reduce confidence (push prob toward 0.5)
     - flag it for human review

   Exposes:
     OutlierDetector.update(features)         — add a vector to the stats
     OutlierDetector.oodScore(features)       — 0-1 (0 in-dist, 1 fully OOD)
     OutlierDetector.featureStats()           — per-feature mean/std/n
     OutlierDetector.recentOodRatio(hours)    — running OOD ratio
   =========================================== */

(function () {
  const STATS_KEY = 'bpleone_feature_stats_v1';
  const LOG_KEY = 'bpleone_ood_log_v1';
  const N_FEATURES = 22;
  const Z_THRESHOLD = 3.0;     // sigma threshold for flagging a single feature
  const OOD_RATIO_TRIGGER = 0.4;  // if 40%+ features are >Z_THRESHOLD, mark OOD
  const MIN_N_FOR_STATS = 30;  // need 30 observations before stats are reliable

  function loadStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveStats(s) { try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {} }
  function loadLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveLog(l) { try { localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(-500))); } catch (e) {} }

  function emptyStats() {
    return {
      n: 0,
      // Per-feature: mean (running), m2 (sum of squared deviations), min, max
      f: Array.from({ length: N_FEATURES }, () => ({ mean: 0, m2: 0, min: Infinity, max: -Infinity }))
    };
  }

  // Audit pass 78 (fix #5): pure Welford weighs every observation equally —
  // after months of running, the mean/std lag the actual regime and OOD
  // detection silently goes blind to genuine shifts. Switched to EMA-Welford:
  // recent observations get more weight via an effective-sample-size cap.
  // Once n >= EMA_CAP, we treat the running sample size as fixed at EMA_CAP
  // so each new sample is weighted ~1/EMA_CAP regardless of how long we've
  // been running. Equivalent to an EMA with half-life ~ EMA_CAP × ln(2).
  // With EMA_CAP=500 and ~138 captures/hour during RTH, half-life ≈ 2.5 hours.
  // Long enough to be stable, short enough to catch real regime change.
  const EMA_CAP = 500;

  function update(features) {
    if (!Array.isArray(features) || features.length !== N_FEATURES) return null;
    let stats = loadStats() || emptyStats();
    stats.n++;
    // Effective n for weighting: capped so older samples decay out
    const nEff = Math.min(stats.n, EMA_CAP);
    for (let i = 0; i < N_FEATURES; i++) {
      const x = features[i];
      if (!isFinite(x)) continue;
      const f = stats.f[i];
      const delta = x - f.mean;
      f.mean += delta / nEff;
      const delta2 = x - f.mean;
      f.m2 += delta * delta2;
      // Decay m2 toward the new variance contribution once at cap
      if (stats.n > EMA_CAP) {
        // Scale m2 by (EMA_CAP-1)/EMA_CAP so the effective denominator stays bounded
        f.m2 *= (EMA_CAP - 1) / EMA_CAP;
      }
      if (x < f.min) f.min = x;
      if (x > f.max) f.max = x;
    }
    saveStats(stats);
    return stats;
  }

  function variance(f, n) {
    // For variance we always divide by min(n, EMA_CAP) - 1 so the std reflects
    // the effective recent-window dispersion, not all-time.
    const nEff = Math.min(n, EMA_CAP);
    return nEff > 1 ? f.m2 / (nEff - 1) : 0;
  }
  function std(f, n) {
    const v = variance(f, n);
    return Math.sqrt(Math.max(0, v));
  }

  // Per-feature z-score and OOD flag
  function zScores(features) {
    const stats = loadStats();
    if (!stats || stats.n < MIN_N_FOR_STATS) {
      return { ready: false, n: stats ? stats.n : 0, perFeature: null, oodRatio: 0, isOod: false };
    }
    const perFeature = [];
    let oodCount = 0;
    for (let i = 0; i < N_FEATURES; i++) {
      const x = features[i];
      const f = stats.f[i];
      // Audit pass 63: defend against undefined x (short feature array) and
      // missing f (schema-mismatched saved stats). Either case used to compute
      // NaN z-scores that propagated into oodScore.
      if (!f || !isFinite(x)) { perFeature.push({ idx: i, value: x, mean: f && f.mean, std: 0, z: 0, flagged: false }); continue; }
      const s = std(f, stats.n);
      const z = s > 0 ? (x - f.mean) / s : 0;
      const flagged = Math.abs(z) > Z_THRESHOLD;
      if (flagged) oodCount++;
      perFeature.push({ idx: i, value: x, mean: f.mean, std: s, z: z, flagged });
    }
    const oodRatio = oodCount / N_FEATURES;
    return {
      ready: true,
      n: stats.n,
      perFeature,
      oodCount,
      oodRatio,
      isOod: oodRatio >= OOD_RATIO_TRIGGER
    };
  }

  // Continuous score in [0, 1]: how far from in-distribution is this?
  // Uses max(|z|) and oodRatio.
  function oodScore(features) {
    const z = zScores(features);
    if (!z.ready) return 0.5;  // unknown
    const maxZ = z.perFeature.reduce((m, f) => Math.max(m, Math.abs(f.z)), 0);
    // Audit pass 63: comment used to claim "|z|=3 → 0.5" but the formula
    // gives (3-1.5)/4.5 = 0.33. Corrected the comment to match the actual math.
    // Map max-z to [0, 1]: |z|≤1.5 → 0, |z|=3 → 0.33, |z|=6 → 1.0
    const zScore = Math.min(1, Math.max(0, (maxZ - 1.5) / 4.5));
    return Math.max(zScore, z.oodRatio);
  }

  // Log a prediction with its OOD score
  function logPrediction(features, predProb) {
    const score = oodScore(features);
    const log = loadLog();
    log.push({ ts: Date.now(), oodScore: score, predProb: predProb });
    saveLog(log);
    return score;
  }

  function recentOodRatio(hours) {
    hours = hours || 24;
    const cutoff = Date.now() - hours * 3600 * 1000;
    const log = loadLog().filter(e => e.ts >= cutoff);
    if (log.length === 0) return null;
    return log.filter(e => e.oodScore >= 0.5).length / log.length;
  }

  function featureStats() {
    const stats = loadStats();
    if (!stats) return null;
    return {
      n: stats.n,
      ready: stats.n >= MIN_N_FOR_STATS,
      perFeature: stats.f.map((f, i) => ({
        idx: i,
        mean: f.mean,
        std: std(f, stats.n),
        min: f.min === Infinity ? null : f.min,
        max: f.max === -Infinity ? null : f.max
      }))
    };
  }

  // Reset all tracked stats (e.g., after regime change)
  function reset() {
    try { localStorage.removeItem(STATS_KEY); } catch (e) {}
    try { localStorage.removeItem(LOG_KEY); } catch (e) {}
  }

  window.OutlierDetector = {
    update,
    oodScore,
    zScores,
    featureStats,
    logPrediction,
    recentOodRatio,
    reset,
    Z_THRESHOLD,
    OOD_RATIO_TRIGGER,
    MIN_N_FOR_STATS
  };
})();
