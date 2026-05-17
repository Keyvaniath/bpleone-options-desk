/* ===========================================
   BPLEONE — High-Conviction Alerts
   ---
   Polls the ContinuousLearner journal every 20s. For each newly-captured
   high-conviction prediction (≥ MIN_ALERT_CONVICTION, default 0.75) with
   all gates passing, fires a browser notification AND adds to an in-memory
   alert feed so Brandon can catch signals away from the screen.

   Gates (mirror AutoTrade so both react to the same events):
     - conviction (max(prob, 1-prob)) >= cfg.minConviction
     - oodScore < 0.6 if present
     - QUOTES has fresh live price (< 5min liveAt)
     - DataReliability not stale

   Throttling: at most one alert per symbol per cfg.cooldownMinutes (default 10).
   Notifications include suggested $ size (from ConfidenceKelly if loaded).

   Persisted in localStorage so the feed survives page reloads.

   Exposes:
     HighConvictionAlerts.enable() / disable() / isEnabled()
     HighConvictionAlerts.config(opts) / getConfig()
     HighConvictionAlerts.feed(n?) -> recent alerts
     HighConvictionAlerts.tick() -> manual check
     HighConvictionAlerts.testFire() -> manual test notification
     HighConvictionAlerts.clear()
     HighConvictionAlerts.reset()
   =========================================== */

(function () {
  const STATE_KEY = 'bpleone_hc_alerts_v1';
  const JOURNAL_KEY = 'bpleone_pred_journal_v1';
  const POLL_INTERVAL_MS = 20 * 1000;
  const MAX_FEED = 200;

  const DEFAULTS = {
    enabled: true,            // default ON — Brandon wants to catch these
    minConviction: 0.75,
    cooldownMinutes: 10,
    bankroll: 10000,
    soundOn: true             // browser-controlled, just a preference flag
  };

  function loadState() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(STATE_KEY);
      return j ? JSON.parse(j) : defaultState();
    } catch (e) { return defaultState(); }
  }
  function defaultState() {
    return {
      config: Object.assign({}, DEFAULTS),
      feed: [],          // [{ ts, sym, conviction, direction, entryPx, riskDollars, predProb, regime }]
      lastAlertBySym: {},  // sym -> ts of last alert
      seenJournalIds: {},
      totalAlerts: 0
    };
  }
  function save(s) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (s.feed.length > MAX_FEED) s.feed = s.feed.slice(-MAX_FEED);
      const seen = Object.keys(s.seenJournalIds);
      if (seen.length > 1000) {
        const trim = {};
        seen.slice(-1000).forEach(k => { trim[k] = s.seenJournalIds[k]; });
        s.seenJournalIds = trim;
      }
      localStorage.setItem(STATE_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function loadJournal() {
    if (typeof localStorage === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]'); } catch (e) { return []; }
  }

  function isEnabled() { return !!loadState().config.enabled; }
  function enable() { const s = loadState(); s.config.enabled = true; save(s); return s.config; }
  function disable() { const s = loadState(); s.config.enabled = false; save(s); return s.config; }
  function getConfig() { return loadState().config; }
  function config(opts) {
    const s = loadState();
    s.config = Object.assign(s.config, opts || {});
    save(s);
    return s.config;
  }

  function feed(n) {
    const all = loadState().feed.slice().reverse();
    return n ? all.slice(0, n) : all;
  }
  function clear() {
    const s = loadState();
    s.feed = [];
    s.lastAlertBySym = {};
    save(s);
  }
  function reset() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STATE_KEY);
  }

  function suggestedRiskDollars(conviction, bankroll) {
    if (typeof window === 'undefined' || !window.ConfidenceKelly) {
      // Simple fallback: 2% * conviction multiplier
      const confMult = Math.max(0.2, (conviction - 0.5) * 2);
      return +(bankroll * 0.02 * confMult).toFixed(0);
    }
    try {
      const sized = window.ConfidenceKelly.size({
        prob: conviction, winR: 0.025, lossR: 0.01, bankroll, entryPx: 100, fraction: 0.25
      });
      return sized && sized.adjKelly ? +(bankroll * sized.adjKelly).toFixed(0) : 0;
    } catch (e) { return 0; }
  }

  function passesGates(entry, cfg, state) {
    if (!entry || !entry.sym || typeof entry.predProb !== 'number') return false;
    if (state.seenJournalIds[entry.id]) return false;
    const conv = Math.max(entry.predProb, 1 - entry.predProb);
    if (conv < cfg.minConviction) return false;
    if (entry.oodScore && entry.oodScore > 0.6) return false;
    // cooldown
    const lastTs = state.lastAlertBySym[entry.sym] || 0;
    if (Date.now() - lastTs < cfg.cooldownMinutes * 60 * 1000) return false;
    // freshness
    if (typeof window === 'undefined' || !window.QUOTES || !window.QUOTES[entry.sym]) return false;
    const q = window.QUOTES[entry.sym];
    if (!q.last || q.last <= 0) return false;
    if (q.liveAt && Date.now() - q.liveAt > 5 * 60 * 1000) return false;
    // DataReliability stale?
    if (typeof window.DataReliability !== 'undefined') {
      try {
        const h = window.DataReliability.symbolHealth(entry.sym);
        if (h && h.stale) return false;
      } catch (e) {}
    }
    return true;
  }

  function fireAlert(entry, state, cfg) {
    const conv = Math.max(entry.predProb, 1 - entry.predProb);
    const direction = entry.predProb >= 0.5 ? 'LONG' : 'SHORT';
    const riskDollars = suggestedRiskDollars(conv, cfg.bankroll);
    const alert = {
      ts: Date.now(),
      sym: entry.sym,
      conviction: +conv.toFixed(3),
      direction,
      entryPx: entry.entryPx,
      riskDollars,
      predProb: entry.predProb,
      regime: entry.regime,
      sourceJournalId: entry.id
    };
    state.feed.push(alert);
    state.lastAlertBySym[entry.sym] = Date.now();
    state.seenJournalIds[entry.id] = Date.now();
    state.totalAlerts++;

    // Browser notification (if Notify is loaded and permission granted)
    if (typeof window.Notify !== 'undefined') {
      try {
        const title = '🧠 ' + entry.sym + ' ' + direction + ' · ' + (conv * 100).toFixed(0) + '%';
        const body = '$' + (entry.entryPx || 0).toFixed(2) + ' · suggested risk $' + riskDollars + ' · ' + (entry.regime || 'mixed');
        window.Notify.fire(title, body, { tag: 'hc-' + entry.sym, url: 'auto-trade.html' });
      } catch (e) {}
    }
    return alert;
  }

  function tick() {
    const state = loadState();
    const cfg = state.config;
    if (!cfg.enabled) return { skipped: true, reason: 'disabled' };
    if (typeof window === 'undefined') return { skipped: true, reason: 'no-window' };
    const journal = loadJournal();
    const cutoff = Date.now() - 5 * 60 * 1000;
    const recent = journal.filter(e => e.ts >= cutoff);
    let fired = 0;
    for (const entry of recent) {
      if (passesGates(entry, cfg, state)) {
        fireAlert(entry, state, cfg);
        fired++;
      } else {
        state.seenJournalIds[entry.id] = Date.now();
      }
    }
    save(state);
    return { fired, scanned: recent.length };
  }

  function testFire() {
    const s = loadState();
    const alert = {
      ts: Date.now(),
      sym: 'TEST',
      conviction: 0.85,
      direction: 'LONG',
      entryPx: 100.00,
      riskDollars: 200,
      predProb: 0.85,
      regime: 'test',
      sourceJournalId: 'test-' + Date.now()
    };
    s.feed.push(alert);
    s.totalAlerts++;
    save(s);
    if (typeof window.Notify !== 'undefined') {
      try { window.Notify.fire('🧠 TEST · LONG · 85%', '$100.00 · suggested risk $200 · test mode', { tag: 'hc-test' }); } catch (e) {}
    }
    return alert;
  }

  function autoStart() {
    if (typeof window === 'undefined') return;
    if (window._hcAlertsTimer) return;
    window._hcAlertsTimer = setInterval(() => { try { tick(); } catch (e) {} }, POLL_INTERVAL_MS);
  }

  window.HighConvictionAlerts = {
    enable, disable, isEnabled,
    config, getConfig,
    feed, clear, reset,
    tick, testFire,
    POLL_INTERVAL_MS, DEFAULTS
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      autoStart();
    } else {
      document.addEventListener('DOMContentLoaded', autoStart);
    }
  }
})();
