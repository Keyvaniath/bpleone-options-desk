/* ===========================================
   BPLEONE — Trade selectivity meta-classifier
   ---
   Even a great prediction model loses money if it trades every day.
   Some market conditions make ALL strategies unreliable: high VIX,
   first/last 30min of session, holiday weeks, after-Fed day, when
   rolling accuracy collapses, when OOD ratio spikes.

   This module computes a single "should I trade today?" score by
   aggregating six independent meta-signals. Each signal contributes
   weighted negative or positive points to a [0, 100] activity score:

     80-100  ACTIVE       — normal trading conditions
     50-79   SELECTIVE    — only A-tier picks, half size
     0-49    SIT OUT      — brain should not publish picks

   The brain-conviction page reads this and refuses to publish picks
   when score < 50.

   Exposes:
     TradeSelectivity.compute() → {score, tier, signals, reasoning}
     TradeSelectivity.shouldTrade()  → boolean
   =========================================== */

(function () {
  const MAX_SCORE = 100;

  function signalVix() {
    if (typeof QUOTES === 'undefined') return { score: 50, ok: null, msg: 'VIX unavailable' };
    const vix = (QUOTES.VIX && QUOTES.VIX.priceSource && QUOTES.VIX.priceSource !== 'stale-seed') ? QUOTES.VIX.last : null;
    const vxx = (QUOTES.VXX && QUOTES.VXX.priceSource && QUOTES.VXX.priceSource !== 'stale-seed') ? QUOTES.VXX.last : null;
    const vixLevel = vix != null ? vix : (vxx != null ? vxx * 0.55 + 5 : null);
    if (vixLevel == null) return { score: 50, ok: null, msg: 'VIX unavailable from live source' };
    // Optimal trading VIX: 12-22. Above 25: high vol = noise. Below 11: complacency = unreliable signals.
    let s;
    if (vixLevel < 11) s = 50;        // too quiet
    else if (vixLevel <= 17) s = 95;  // optimal
    else if (vixLevel <= 22) s = 85;  // active but tradeable
    else if (vixLevel <= 28) s = 60;  // elevated risk
    else if (vixLevel <= 35) s = 30;  // high risk
    else s = 10;                       // crisis
    const ok = s >= 60;
    return { score: s, ok, msg: 'VIX ≈ ' + vixLevel.toFixed(1) + (s >= 80 ? ' (optimal)' : s >= 60 ? ' (elevated)' : ' (extreme — sit out)') };
  }

  function signalSession() {
    // First 15min and last 15min of regular session = noise
    const now = new Date();
    const hour = now.getHours();
    const min = now.getMinutes();
    const timeMin = hour * 60 + min;
    // US market: 9:30-16:00 ET. Assuming server is in user's timezone.
    // We can't know timezone reliably, so use rough hour-of-day signal.
    const isOpen = (hour > 9 || (hour === 9 && min >= 30)) && hour < 16;
    if (!isOpen) {
      return { score: 50, ok: null, msg: 'Outside primary US session (pre/post-market)' };
    }
    const openMin = 9 * 60 + 30;
    const closeMin = 16 * 60;
    const minutesIn = timeMin - openMin;
    const minutesToClose = closeMin - timeMin;
    if (minutesIn < 15) return { score: 40, ok: false, msg: 'First 15min of open — too noisy' };
    if (minutesToClose < 15) return { score: 40, ok: false, msg: 'Last 15min — closing imbalance noise' };
    if (minutesIn < 45) return { score: 70, ok: true, msg: 'Open hour (settled but volatile)' };
    if (minutesToClose < 45) return { score: 75, ok: true, msg: 'Power hour (settled)' };
    return { score: 90, ok: true, msg: 'Mid-session (stable trading window)' };
  }

  function signalDayOfWeek() {
    const now = new Date();
    const dow = now.getDay();
    // 0=Sun, 6=Sat. We assume US market closed weekends.
    if (dow === 0 || dow === 6) return { score: 30, ok: false, msg: 'Weekend — markets closed' };
    if (dow === 1) return { score: 85, ok: true, msg: 'Monday' };
    if (dow === 2 || dow === 3 || dow === 4) return { score: 95, ok: true, msg: 'Mid-week (most predictable)' };
    if (dow === 5) {
      const hour = now.getHours();
      if (hour >= 14) return { score: 60, ok: false, msg: 'Friday afternoon — weekend risk' };
      return { score: 80, ok: true, msg: 'Friday morning' };
    }
    return { score: 70, ok: true };
  }

  function signalRollingAccuracy() {
    let log = [];
    try { log = JSON.parse(localStorage.getItem('bpleone_rolling_acc_v1') || '[]'); } catch (e) {}
    const recent = log.slice(-20);
    if (recent.length < 10) return { score: 70, ok: null, msg: 'Insufficient resolved predictions for rolling check' };
    const wins = recent.filter(r => r.correct).length;
    const acc = wins / recent.length;
    if (acc >= 0.60) return { score: 95, ok: true, msg: 'Recent accuracy ' + (acc * 100).toFixed(0) + '% (hot streak)' };
    if (acc >= 0.50) return { score: 85, ok: true, msg: 'Recent accuracy ' + (acc * 100).toFixed(0) + '% (above coin flip)' };
    if (acc >= 0.40) return { score: 55, ok: false, msg: 'Recent accuracy ' + (acc * 100).toFixed(0) + '% (below average)' };
    return { score: 25, ok: false, msg: 'Recent accuracy ' + (acc * 100).toFixed(0) + '% (cold — sit out)' };
  }

  function signalOodRatio() {
    if (typeof OutlierDetector === 'undefined') return { score: 70, ok: null, msg: 'Outlier detector not loaded' };
    const ratio = OutlierDetector.recentOodRatio(6);
    if (ratio == null) return { score: 70, ok: null, msg: 'No recent OOD data' };
    if (ratio < 0.10) return { score: 95, ok: true, msg: 'OOD ratio ' + (ratio * 100).toFixed(0) + '% (normal regime)' };
    if (ratio < 0.25) return { score: 80, ok: true, msg: 'OOD ratio ' + (ratio * 100).toFixed(0) + '% (slightly anomalous)' };
    if (ratio < 0.45) return { score: 50, ok: false, msg: 'OOD ratio ' + (ratio * 100).toFixed(0) + '% (unfamiliar regime)' };
    return { score: 20, ok: false, msg: 'OOD ratio ' + (ratio * 100).toFixed(0) + '% (extreme — brain in unknown territory)' };
  }

  function signalDriftAdapt() {
    let state = {};
    try { state = JSON.parse(localStorage.getItem('bpleone_cont_state_v1') || '{}'); } catch (e) {}
    if (state.driftAdapting) return { score: 30, ok: false, msg: 'Concept drift in progress — brain still adapting' };
    return { score: 90, ok: true, msg: 'No active drift' };
  }

  // Weights reflect relative importance of each signal. They sum to 1.
  // VIX + accuracy carry the most weight (these are the actual edge proxies).
  const WEIGHTS = {
    vix: 0.25,
    session: 0.15,
    dow: 0.10,
    accuracy: 0.25,
    ood: 0.15,
    drift: 0.10
  };

  function compute() {
    const signals = {
      vix: signalVix(),
      session: signalSession(),
      dow: signalDayOfWeek(),
      accuracy: signalRollingAccuracy(),
      ood: signalOodRatio(),
      drift: signalDriftAdapt()
    };
    // Weighted average score
    let totalScore = 0;
    let totalWeight = 0;
    Object.keys(WEIGHTS).forEach(k => {
      const w = WEIGHTS[k];
      totalScore += signals[k].score * w;
      totalWeight += w;
    });
    const score = Math.round(totalScore / totalWeight);
    // Tier mapping
    const tier = score >= 80 ? 'ACTIVE' : score >= 50 ? 'SELECTIVE' : 'SIT_OUT';
    // Pick the worst-scoring signal as the dominant reasoning
    let worst = null;
    Object.entries(signals).forEach(([k, s]) => {
      if (!worst || s.score < worst.score) worst = { k, ...s };
    });
    const reasoning = score >= 80
      ? 'All systems green. Normal trading conditions.'
      : score >= 50
      ? 'One or more signals flagging — take only A-tier picks at half size. Worst: ' + worst.msg
      : 'Brain advises sitting out. Worst: ' + worst.msg;
    return { score, tier, signals, reasoning, worst };
  }

  function shouldTrade() {
    return compute().score >= 50;
  }

  window.TradeSelectivity = { compute, shouldTrade, WEIGHTS };
})();
