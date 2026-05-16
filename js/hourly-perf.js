/* ===========================================
   BPLEONE — Hour-of-Session Performance Tracker
   ---
   Markets behave differently across the trading day:
     - 09:30–10:30 ET: Open volatility — emotional opening flow
     - 10:30–12:00 ET: Trend establishment — informed money positions
     - 12:00–14:00 ET: Lunch lull — thin liquidity, choppy
     - 14:00–15:30 ET: Algo positioning — institutions adjust
     - 15:30–16:00 ET: Close auction — heavy MOC flow

   The brain's prediction accuracy almost certainly varies across these
   buckets. This module tracks it. If midday-chop accuracy is +6pp above
   random while close-hour is +1pp, the size multiplier for close-hour
   predictions should shrink.

   Exposes:
     HourlyPerf.recordResolution(predictedProb, label, ts)
     HourlyPerf.currentBucket() → 'open' | 'mid-am' | 'lunch' | 'mid-pm' | 'close' | 'after-hours'
     HourlyPerf.sizeMultiplier(bucket?) → number in [0.5, 1.2]
     HourlyPerf.stats() → { perBucket: {...}, currentBucket, currentMult }
     HourlyPerf.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_hourly_perf_v1';
  const MAX_LOG = 1000;

  // Bucket boundaries in ET minutes-from-midnight
  // Open: 9:30 = 570, Mid-AM: 10:30 = 630, Lunch: 12:00 = 720,
  // Mid-PM: 14:00 = 840, Close: 15:30 = 930, End: 16:00 = 960
  const BUCKETS = [
    { id: 'open',        start: 570, end: 630, label: '9:30–10:30',  emoji: '🌅' },
    { id: 'mid-am',      start: 630, end: 720, label: '10:30–12:00', emoji: '☕' },
    { id: 'lunch',       start: 720, end: 840, label: '12:00–14:00', emoji: '🥪' },
    { id: 'mid-pm',      start: 840, end: 930, label: '14:00–15:30', emoji: '📈' },
    { id: 'close',       start: 930, end: 960, label: '15:30–16:00', emoji: '🔔' },
    { id: 'after-hours', start: 0,   end: 1440, label: 'Outside RTH', emoji: '🌙' }
  ];

  function load() {
    if (typeof localStorage === 'undefined') return { log: [] };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { log: [] };
    } catch (e) { return { log: [] }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Convert UTC timestamp ms → minutes from midnight America/New_York
  function tsToETMin(ts) {
    if (!ts) ts = Date.now();
    // Use the browser's Intl.DateTimeFormat for the America/New_York TZ
    try {
      const dt = new Date(ts);
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      }).formatToParts(dt);
      let hh = 0, mm = 0;
      for (const p of parts) {
        if (p.type === 'hour') hh = parseInt(p.value, 10) % 24;
        if (p.type === 'minute') mm = parseInt(p.value, 10);
      }
      return hh * 60 + mm;
    } catch (e) {
      // Fallback: use UTC and subtract 5 hours (rough EST approximation)
      const d = new Date(ts);
      const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
      return (utcMin - 300 + 1440) % 1440;
    }
  }

  function bucketForMin(etMin) {
    if (etMin >= 570 && etMin < 630) return 'open';
    if (etMin >= 630 && etMin < 720) return 'mid-am';
    if (etMin >= 720 && etMin < 840) return 'lunch';
    if (etMin >= 840 && etMin < 930) return 'mid-pm';
    if (etMin >= 930 && etMin < 960) return 'close';
    return 'after-hours';
  }

  function currentBucket() {
    return bucketForMin(tsToETMin(Date.now()));
  }

  function recordResolution(predictedProb, label, ts) {
    if (typeof predictedProb !== 'number' || (label !== 0 && label !== 1)) return;
    if (!ts) ts = Date.now();
    const state = load();
    const bucket = bucketForMin(tsToETMin(ts));
    state.log.push({ b: bucket, p: +predictedProb.toFixed(4), y: label, t: ts });
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save(state);
  }

  function computeBucketStats(rows, bucket) {
    const r = rows.filter(x => x.b === bucket);
    if (r.length === 0) {
      return { n: 0, accuracy: null, logLoss: null, edge: null };
    }
    let correct = 0, logLossSum = 0;
    for (const row of r) {
      const dir = row.p >= 0.5 ? 1 : 0;
      if (dir === row.y) correct++;
      const truthP = row.y === 1 ? row.p : 1 - row.p;
      logLossSum += -Math.log(Math.max(1e-9, truthP));
    }
    const acc = correct / r.length;
    return {
      n: r.length,
      accuracy: acc,
      logLoss: logLossSum / r.length,
      edge: acc - 0.5  // accuracy above random
    };
  }

  function stats() {
    const state = load();
    const perBucket = {};
    for (const b of BUCKETS) {
      perBucket[b.id] = Object.assign(computeBucketStats(state.log, b.id), {
        label: b.label,
        emoji: b.emoji
      });
    }
    return {
      perBucket,
      currentBucket: currentBucket(),
      total: state.log.length,
      currentMult: sizeMultiplier()
    };
  }

  // Compute a size multiplier in [0.5, 1.2] from accuracy in the current
  // (or specified) bucket vs random baseline. Tight (>+5pp): boost slightly,
  // loose (<-2pp): penalize. Need at least 20 samples in the bucket; below
  // that, return 1.0 (no signal).
  function sizeMultiplier(bucket) {
    if (!bucket) bucket = currentBucket();
    const state = load();
    const s = computeBucketStats(state.log, bucket);
    if (s.n < 20 || s.accuracy == null) return 1.0;
    const edge = s.edge; // accuracy - 0.5
    // Map edge ∈ [-0.10, +0.10] linearly to multiplier ∈ [0.5, 1.2]
    let mult = 1.0 + edge * 2.0;
    return Math.max(0.5, Math.min(1.2, mult));
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.HourlyPerf = {
    recordResolution,
    currentBucket,
    sizeMultiplier,
    stats,
    reset,
    BUCKETS,
    _tsToETMin: tsToETMin,
    _bucketForMin: bucketForMin
  };
})();
