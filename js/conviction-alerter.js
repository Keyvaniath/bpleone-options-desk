/* ===========================================
   BPLEONE — Real-time A-tier conviction alerts
   ---
   Runs in background on every page. Every 90 seconds:
     1. Runs the brain-conviction pipeline for every symbol
     2. Identifies A-tier picks (calibrated prob >= 0.70 or <= 0.30)
     3. Cross-checks selectivity gate (must be ACTIVE)
     4. For each NEW A-tier pick not previously alerted, fires:
        - Browser desktop notification (if granted)
        - Custom event for any in-page listeners
        - Logged to brain-changelog for audit
     5. 60-min per-symbol cooldown so you're not spammed

   The alert is the closing of the loop: brain learns → high-confidence
   setup → user hears about it instantly. No need to visit the page.

   Exposes:
     ConvictionAlerter.start() / stop()
     ConvictionAlerter.runOnce()  — manual trigger
     ConvictionAlerter.recent()   — last 50 alerts fired
   =========================================== */

(function () {
  const STATE_KEY = 'bpleone_conviction_alerter_v1';
  const LOG_KEY = 'bpleone_conviction_alert_log_v1';
  const UNIVERSE = ['SPY','QQQ','IWM','AAPL','NVDA','TSLA','MSFT','META','AMZN','GOOGL','AMD','PLTR','SMCI','COIN','BTC','ETH','BABA','SHOP','CRM','UBER','XLE','GLD','SLV'];
  const CHECK_INTERVAL_MS = 90 * 1000;   // every 90 seconds
  const ALERT_COOLDOWN_MS = 60 * 60 * 1000;  // 60 min per symbol
  const A_TIER_THRESHOLD = 0.70;  // calibrated prob ≥ 0.70 or ≤ 0.30

  function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; } }
  function saveState(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {} }
  function loadLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; } }
  function saveLog(l) { try { localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(-100))); } catch (e) {} }

  function isLiveQuote(q) {
    return q && q.priceSource && q.priceSource !== 'stale-seed' && q.priceSource !== 'mock'
      && q.liveAt && (Date.now() - q.liveAt) < 5 * 60 * 1000;
  }

  function rankOne(sym) {
    if (typeof QUOTES === 'undefined' || !QUOTES[sym]) return null;
    const q = QUOTES[sym];
    if (!isLiveQuote(q)) return null;
    if (typeof FeatureExtractor === 'undefined' || typeof ModelStore === 'undefined') return null;
    const finding = { ts: Date.now(), type: 'alerter-scan', severity: 1, meta: { sym, setup: 'scan', last: q.last, bias: q.changePct >= 0 ? 'long' : 'short' } };
    const features = FeatureExtractor.extract(finding);
    if (!features || features.length !== 22) return null;

    let oodScore = 0;
    if (typeof OutlierDetector !== 'undefined') {
      const stats = OutlierDetector.featureStats();
      if (stats && stats.ready) oodScore = OutlierDetector.oodScore(features);
    }
    if (oodScore > 0.5) return null;

    let rawProb;
    if (typeof MultiHorizon !== 'undefined') rawProb = MultiHorizon.predictEnsemble(features).prob;
    else rawProb = ModelStore.load().predict(features).prob;

    let prob = rawProb;
    if (typeof Calibrator !== 'undefined') {
      const params = Calibrator._loadParams();
      if (params) prob = Calibrator.calibrate(rawProb);
    }
    if (oodScore > 0.3) prob = 0.5 + (prob - 0.5) * (1 - oodScore);

    // A-tier: calibrated prob >= 0.70 OR <= 0.30
    if (prob < A_TIER_THRESHOLD && prob > (1 - A_TIER_THRESHOLD)) return null;

    let atr = q.dayHigh && q.dayLow ? (q.dayHigh - q.dayLow) : q.last * 0.015;
    const side = prob >= 0.5 ? 'LONG' : 'SHORT';
    const entry = q.last;
    const stop = side === 'LONG' ? entry - 1.5 * atr : entry + 1.5 * atr;
    const target = side === 'LONG' ? entry + 3 * atr : entry - 3 * atr;
    return { sym, prob, side, entry, stop, target, atr, oodScore };
  }

  function checkAlerts() {
    // Gate: selectivity must be ACTIVE
    if (typeof TradeSelectivity !== 'undefined') {
      const sel = TradeSelectivity.compute();
      if (sel.tier === 'SIT_OUT') return;  // never alert during sit-out
    }
    const state = loadState();
    if (!state.alertedAt) state.alertedAt = {};
    const log = loadLog();
    const now = Date.now();
    const newAlerts = [];

    UNIVERSE.forEach(sym => {
      const pick = rankOne(sym);
      if (!pick) return;
      const lastAlerted = state.alertedAt[sym] || 0;
      if (now - lastAlerted < ALERT_COOLDOWN_MS) return;

      // Fire desktop notification
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const title = '🎯 ' + pick.sym + ' · ' + pick.side + ' · ' + (pick.prob * 100).toFixed(0) + '%';
          const body = 'Entry $' + pick.entry.toFixed(2) + ' · Stop $' + pick.stop.toFixed(2) + ' · Target $' + pick.target.toFixed(2);
          new Notification(title, { body, icon: '/favicon.svg', tag: 'conviction-' + pick.sym });
        }
      } catch (e) {}

      // Custom event for in-page listeners (e.g., brain-bet auto-refresh)
      try {
        window.dispatchEvent(new CustomEvent('bpleone:conviction-alert', { detail: pick }));
      } catch (e) {}

      // Log
      log.unshift({ ts: now, ...pick });
      newAlerts.push(pick);
      state.alertedAt[sym] = now;
    });

    if (newAlerts.length > 0) {
      saveLog(log);
      saveState(state);
      // Append to brain-changelog for audit
      try {
        const chg = JSON.parse(localStorage.getItem('bpleone_brain_changelog_v1') || '[]');
        chg.unshift({
          ts: now,
          type: 'alert',
          title: newAlerts.length + ' A-tier conviction alert' + (newAlerts.length > 1 ? 's' : ''),
          body: newAlerts.map(a => a.sym + ' ' + a.side + ' @ ' + (a.prob * 100).toFixed(0) + '%').join(' · '),
          meta: { picks: newAlerts.map(a => ({ sym: a.sym, side: a.side, prob: a.prob, entry: a.entry })) }
        });
        localStorage.setItem('bpleone_brain_changelog_v1', JSON.stringify(chg.slice(0, 200)));
      } catch (e) {}
    }
  }

  let timer = null;
  function start() {
    if (timer) return;
    setTimeout(checkAlerts, 45 * 1000);  // first check 45s after page load
    timer = setInterval(checkAlerts, CHECK_INTERVAL_MS);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function runOnce() { checkAlerts(); }
  function recent() { return loadLog(); }
  function clearState() {
    try { localStorage.removeItem(STATE_KEY); } catch (e) {}
    try { localStorage.removeItem(LOG_KEY); } catch (e) {}
  }

  window.ConvictionAlerter = { start, stop, runOnce, recent, clearState, A_TIER_THRESHOLD };

  // Auto-start
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(start, 30000));
  }
})();
