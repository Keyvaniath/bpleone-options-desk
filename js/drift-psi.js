/* ===========================================
   BPLEONE — Population Stability Index (PSI) drift detection
   ---
   PSI compares the distribution of a recent window of feature vectors
   against a historical baseline. It catches regime shifts BEFORE accuracy
   collapses (a leading indicator), unlike the rolling-accuracy drift
   detector which only triggers after predictions fail.

   Math:
     For each feature, bin the historical population into 10 deciles.
     Then bin the recent window using the SAME edges.
     PSI = Σ ((recent_pct - hist_pct) * ln(recent_pct / hist_pct))

   Interpretation (industry standard):
     PSI < 0.10       Stable population
     0.10-0.25        Minor shift — monitor closely
     PSI > 0.25       Major shift — model should retrain

   This module exposes:
     PSIDrift.snapshot()        — snapshot current historical distribution
     PSIDrift.computeRecent(n)  — compute PSI vs current snapshot on last N captures
     PSIDrift.summary()         — overall + per-feature PSI + drift history
     PSIDrift.maybeAutoFire()   — fire 'concept-drift' event if PSI > 0.25
   =========================================== */

(function () {
  const SNAPSHOT_KEY = 'bpleone_psi_snapshot_v1';   // historical decile edges + counts
  const HISTORY_KEY = 'bpleone_psi_history_v1';     // [{ts, psi, perFeature, recentN}, ...]
  const N_FEATURES = 22;
  const N_BINS = 10;
  const MIN_HIST = 100;       // need 100 historical observations before snapshotting
  const MIN_RECENT = 30;      // need 30 recent observations for valid PSI
  const RECENT_WINDOW = 100;  // compare last N captures
  const PSI_MINOR = 0.10;
  const PSI_MAJOR = 0.25;
  const SNAPSHOT_TTL = 7 * 24 * 3600 * 1000;  // re-snapshot weekly

  function loadJournal() {
    try { return JSON.parse(localStorage.getItem('bpleone_pred_journal_v1') || '[]'); } catch (e) { return []; }
  }
  function loadSnapshot() {
    try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveSnapshot(s) { try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s)); } catch (e) {} }
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveHistory(h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-500))); } catch (e) {} }

  // -------- Compute decile edges from sorted values --------
  function computeEdges(values, nBins) {
    if (values.length === 0) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const edges = [];
    for (let i = 1; i < nBins; i++) {
      const idx = Math.floor((i / nBins) * sorted.length);
      edges.push(sorted[Math.min(idx, sorted.length - 1)]);
    }
    return edges;
  }

  function binIndex(value, edges) {
    for (let i = 0; i < edges.length; i++) {
      if (value < edges[i]) return i;
    }
    return edges.length;
  }

  function binDistribution(values, edges) {
    const counts = new Array(edges.length + 1).fill(0);
    values.forEach(v => { counts[binIndex(v, edges)]++; });
    const total = values.length;
    return counts.map(c => total > 0 ? c / total : 0);
  }

  // -------- Snapshot historical distribution --------
  // Pulls all features from the prediction journal and creates a baseline
  // distribution per feature. Stored for future PSI comparisons.
  function snapshot() {
    const journal = loadJournal();
    const allFeatures = journal.filter(e => Array.isArray(e.features) && e.features.length === N_FEATURES);
    if (allFeatures.length < MIN_HIST) return { ok: false, reason: 'need-more-data', haveN: allFeatures.length, needN: MIN_HIST };

    const perFeature = [];
    for (let f = 0; f < N_FEATURES; f++) {
      const values = allFeatures.map(e => e.features[f]).filter(v => isFinite(v));
      const edges = computeEdges(values, N_BINS);
      const dist = binDistribution(values, edges);
      perFeature.push({ idx: f, edges, dist, n: values.length });
    }

    const snap = {
      ts: Date.now(),
      n: allFeatures.length,
      perFeature
    };
    saveSnapshot(snap);
    return { ok: true, snap };
  }

  // -------- Auto-snapshot if needed --------
  function ensureSnapshot() {
    const cur = loadSnapshot();
    if (!cur) return snapshot();
    if (Date.now() - cur.ts > SNAPSHOT_TTL) return snapshot();
    return { ok: true, snap: cur, cached: true };
  }

  // -------- Compute PSI on recent captures --------
  function psiBin(recent, hist) {
    // PSI(bin) = (recent - hist) * ln(recent / hist)
    // Smoothing: floor each at 1e-4 to avoid -Inf
    const eps = 1e-4;
    const r = Math.max(eps, recent);
    const h = Math.max(eps, hist);
    return (r - h) * Math.log(r / h);
  }

  function computeRecent(n) {
    n = n || RECENT_WINDOW;
    const snapResult = ensureSnapshot();
    if (!snapResult.ok) return { ok: false, reason: snapResult.reason || 'no-snapshot' };
    const snap = snapResult.snap;
    const journal = loadJournal();
    const recent = journal.slice(-n).filter(e => Array.isArray(e.features) && e.features.length === N_FEATURES);
    if (recent.length < MIN_RECENT) return { ok: false, reason: 'need-more-recent', haveN: recent.length, needN: MIN_RECENT };

    const perFeature = [];
    let totalPsi = 0;
    for (let f = 0; f < N_FEATURES; f++) {
      const histPerFeature = snap.perFeature[f];
      const recentValues = recent.map(e => e.features[f]).filter(v => isFinite(v));
      const recentDist = binDistribution(recentValues, histPerFeature.edges);
      let psi = 0;
      for (let b = 0; b < histPerFeature.dist.length; b++) {
        psi += psiBin(recentDist[b], histPerFeature.dist[b]);
      }
      perFeature.push({ idx: f, psi, recentDist, histDist: histPerFeature.dist });
      totalPsi += psi;
    }
    const meanPsi = totalPsi / N_FEATURES;
    const status = meanPsi > PSI_MAJOR ? 'major' : meanPsi > PSI_MINOR ? 'minor' : 'stable';

    const result = {
      ok: true,
      ts: Date.now(),
      psi: meanPsi,
      perFeature,
      status,
      recentN: recent.length,
      snapTs: snap.ts,
      snapN: snap.n
    };
    // Log to history
    const history = loadHistory();
    history.push({ ts: result.ts, psi: meanPsi, recentN: recent.length, status });
    saveHistory(history);
    return result;
  }

  function maybeAutoFire() {
    const r = computeRecent();
    if (!r.ok) return null;
    if (r.psi > PSI_MAJOR) {
      // Fire concept-drift event with PSI detail
      try {
        window.dispatchEvent(new CustomEvent('bpleone:concept-drift', {
          detail: { source: 'PSI', psi: r.psi, status: r.status, perFeature: r.perFeature.map(f => ({ idx: f.idx, psi: f.psi })) }
        }));
      } catch (e) {}
      // Also tag the brain-loop state so the trainer adapts
      try {
        const state = JSON.parse(localStorage.getItem('bpleone_cont_state_v1') || '{}');
        state.driftAdapting = true;
        state.driftStartedAt = Date.now();
        state.driftSource = 'PSI';
        state.driftPsi = r.psi;
        localStorage.setItem('bpleone_cont_state_v1', JSON.stringify(state));
      } catch (e) {}
      return r;
    }
    return r;
  }

  function summary() {
    const snap = loadSnapshot();
    const history = loadHistory();
    const r = computeRecent();
    return {
      snapshot: snap ? { ts: snap.ts, n: snap.n, ageHours: (Date.now() - snap.ts) / 3600000 } : null,
      current: r.ok ? r : null,
      history: history.slice(-50),
      thresholds: { minor: PSI_MINOR, major: PSI_MAJOR }
    };
  }

  // Schedule background check every 5 min
  let timer = null;
  function start() {
    if (timer) return;
    setTimeout(maybeAutoFire, 30000);  // first check after 30s
    timer = setInterval(maybeAutoFire, 5 * 60 * 1000);  // then every 5min
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  // Audit pass 76 — CRITICAL: 5 callers (trade-trust-score, brain-coach,
  // daily-card, brain-mobile, brain-truth) read window.DriftPSI.status()
  // but the module previously exposed window.PSIDrift.summary() — a complete
  // name mismatch. Every drift-aware safety check silently no-op'd, so the
  // entire concept-drift protection chain was inert. Fix in two parts:
  //   (a) add a flat status() that returns { psi, status } so the existing
  //       `typeof psi.psi === 'number'` checks succeed.
  //   (b) expose under BOTH PSIDrift (legacy in-repo correct callers like
  //       feature-drift.html, brain-daily-report.html) and DriftPSI (the
  //       name 5 callers were already using).
  function status() {
    try {
      const r = computeRecent();
      if (!r || !r.ok) return null;
      return { psi: r.psi, status: r.status, recentN: r.recentN, snapTs: r.snapTs };
    } catch (e) { return null; }
  }

  const api = {
    snapshot,
    ensureSnapshot,
    computeRecent,
    maybeAutoFire,
    summary,
    status,        // pass 76
    start,
    stop,
    PSI_MINOR,
    PSI_MAJOR
  };
  window.PSIDrift = api;
  window.DriftPSI = api;   // pass 76: alias so the 5 mismatched callers wake up

  // Auto-start in browser
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(start, 15000));
  }
})();
