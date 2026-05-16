/* ===========================================
   BPLEONE — Day-of-Week Performance Tracker
   ---
   Same pattern as HourlyPerf, but stratified by day-of-week (ET) rather
   than hour bucket. Markets behave differently on Mondays (post-weekend
   gaps), Fridays (positioning for weekend, OPEX), midweek (smoother).

   This module tracks the brain's accuracy per weekday and produces a
   [0.5, 1.2] size multiplier per day.

   Exposes:
     DowPerf.recordResolution(predictedProb, label, ts)
     DowPerf.currentDay() → 'MON' | 'TUE' | ... | 'SUN'
     DowPerf.sizeMultiplier(day?) → number in [0.5, 1.2]
     DowPerf.stats() → { perDay: {...}, currentDay, currentMult }
     DowPerf.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_dow_perf_v1';
  const MAX_LOG = 1000;
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

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

  // Convert ts to ET day-of-week index (0=Sun, 6=Sat). Uses Intl with
  // America/New_York TZ for correctness.
  function tsToETDay(ts) {
    if (!ts) ts = Date.now();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short'
      }).formatToParts(new Date(ts));
      for (const p of parts) {
        if (p.type === 'weekday') {
          const map = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
          return map[p.value] != null ? map[p.value] : new Date(ts).getDay();
        }
      }
      return new Date(ts).getDay();
    } catch (e) {
      // Fallback: local TZ approx
      return new Date(ts).getDay();
    }
  }

  function currentDay() {
    return DAYS[tsToETDay(Date.now())];
  }

  function recordResolution(predictedProb, label, ts) {
    if (typeof predictedProb !== 'number' || (label !== 0 && label !== 1)) return;
    if (!ts) ts = Date.now();
    const dayIdx = tsToETDay(ts);
    const state = load();
    state.log.push({ d: DAYS[dayIdx], p: +predictedProb.toFixed(4), y: label, t: ts });
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save(state);
  }

  function computeDayStats(rows, day) {
    const r = rows.filter(x => x.d === day);
    if (r.length === 0) return { n: 0, accuracy: null, edge: null, brier: null };
    let correct = 0, brierSum = 0;
    for (const row of r) {
      const dir = row.p >= 0.5 ? 1 : 0;
      if (dir === row.y) correct++;
      brierSum += (row.p - row.y) * (row.p - row.y);
    }
    const acc = correct / r.length;
    return {
      n: r.length,
      accuracy: acc,
      brier: brierSum / r.length,
      edge: acc - 0.5
    };
  }

  function stats() {
    const state = load();
    const perDay = {};
    for (const d of DAYS) {
      perDay[d] = computeDayStats(state.log, d);
    }
    return {
      perDay,
      currentDay: currentDay(),
      total: state.log.length,
      currentMult: sizeMultiplier()
    };
  }

  function sizeMultiplier(day) {
    if (!day) day = currentDay();
    const state = load();
    const s = computeDayStats(state.log, day);
    if (s.n < 20 || s.accuracy == null) return 1.0;
    const edge = s.edge;
    let mult = 1.0 + edge * 2.0;
    return Math.max(0.5, Math.min(1.2, mult));
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.DowPerf = {
    recordResolution,
    currentDay,
    sizeMultiplier,
    stats,
    reset,
    DAYS,
    _tsToETDay: tsToETDay
  };
})();
