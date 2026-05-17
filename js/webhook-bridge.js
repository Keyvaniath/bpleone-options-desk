/* ===========================================
   BPLEONE — Webhook Bridge
   ---
   Forward high-conviction brain alerts to Discord / Slack / generic
   webhooks. User pastes a webhook URL once; the bridge polls
   HighConvictionAlerts feed every 30 seconds and POSTs each NEW alert
   formatted appropriately for the target platform.

   Target detection by URL:
     - discord.com/api/webhooks/...   -> Discord embed
     - hooks.slack.com/services/...   -> Slack blocks
     - default                        -> generic JSON payload

   No CORS workaround needed: both Discord and Slack incoming webhooks
   accept cross-origin POST from any browser.

   No-spam: tracks last-pushed journal IDs; never re-pushes.
   Throttled to one push every 5 seconds to avoid burst-rate-limit
   on Discord/Slack.

   Storage: bpleone_webhook_bridge_v1

   Exposes:
     WebhookBridge.enable() / disable() / isEnabled()
     WebhookBridge.config({ url, ... }) / getConfig()
     WebhookBridge.testPing()        - sends a test message
     WebhookBridge.tick()            - manual flush
     WebhookBridge.log(n=20)         - recent push attempts
   =========================================== */

(function () {
  const STATE_KEY = 'bpleone_webhook_bridge_v1';
  const POLL_INTERVAL_MS = 30 * 1000;
  const MIN_BETWEEN_PUSHES_MS = 5 * 1000;
  const MAX_LOG = 100;

  const DEFAULTS = {
    enabled: false,
    url: '',
    minConviction: 0.75,   // mirrors HC alerts
    includeRisk: true,
    botName: 'bpleone brain'
  };

  function loadState() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(STATE_KEY);
      if (!j) return defaultState();
      return Object.assign(defaultState(), JSON.parse(j));
    } catch (e) { return defaultState(); }
  }
  function defaultState() {
    return {
      config: Object.assign({}, DEFAULTS),
      seenJournalIds: {},
      log: [],
      lastPushAt: 0,
      totalPushes: 0,
      totalErrors: 0
    };
  }
  function save(s) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (s.log.length > MAX_LOG) s.log = s.log.slice(-MAX_LOG);
      const seen = Object.keys(s.seenJournalIds);
      if (seen.length > 1000) {
        const trim = {};
        seen.slice(-1000).forEach(k => { trim[k] = s.seenJournalIds[k]; });
        s.seenJournalIds = trim;
      }
      localStorage.setItem(STATE_KEY, JSON.stringify(s));
    } catch (e) {}
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
  function log(n) {
    n = n || 20;
    return loadState().log.slice(-n).reverse();
  }
  function clearLog() { const s = loadState(); s.log = []; save(s); }

  function detectTarget(url) {
    if (!url) return 'none';
    if (url.indexOf('discord.com/api/webhooks') !== -1) return 'discord';
    if (url.indexOf('hooks.slack.com/services') !== -1) return 'slack';
    return 'generic';
  }

  function buildPayload(alert, cfg, target) {
    const conv = (alert.conviction || 0) * 100;
    const dirEmoji = alert.direction === 'LONG' ? '📈' : '📉';
    const headline = dirEmoji + ' ' + alert.sym + ' ' + alert.direction + ' · ' + conv.toFixed(0) + '%';
    let extra = '$' + (alert.entryPx || 0).toFixed(2);
    if (cfg.includeRisk && alert.riskDollars) extra += ' · suggested risk $' + alert.riskDollars;
    if (alert.regime) extra += ' · ' + alert.regime;

    if (target === 'discord') {
      const color = alert.direction === 'LONG' ? 0x10b981 : 0xdc2626;
      return {
        username: cfg.botName || 'bpleone brain',
        embeds: [{
          title: headline,
          description: extra,
          color: color,
          timestamp: new Date(alert.ts || Date.now()).toISOString(),
          footer: { text: 'options.bpleone.com / brain' }
        }]
      };
    }
    if (target === 'slack') {
      return {
        text: headline + ' — ' + extra,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: headline } },
          { type: 'section', text: { type: 'mrkdwn', text: '*' + extra + '*\n_' + new Date(alert.ts || Date.now()).toLocaleString() + '_' } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: 'options.bpleone.com / brain' }] }
        ]
      };
    }
    // generic
    return {
      sym: alert.sym,
      direction: alert.direction,
      conviction: +(alert.conviction || 0).toFixed(3),
      entryPx: alert.entryPx,
      riskDollars: alert.riskDollars,
      regime: alert.regime,
      ts: alert.ts
    };
  }

  async function push(alert, state) {
    const cfg = state.config;
    if (!cfg.url) return { ok: false, reason: 'no-url' };
    const target = detectTarget(cfg.url);
    const payload = buildPayload(alert, cfg, target);
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const ok = res.ok;
      state.log.push({ ts: Date.now(), sym: alert.sym, target, ok, status: res.status });
      if (ok) state.totalPushes++; else state.totalErrors++;
      return { ok, status: res.status, target };
    } catch (e) {
      state.log.push({ ts: Date.now(), sym: alert.sym, target, ok: false, error: String(e && e.message || e) });
      state.totalErrors++;
      return { ok: false, reason: String(e && e.message || e) };
    }
  }

  async function tick() {
    const state = loadState();
    const cfg = state.config;
    if (!cfg.enabled || !cfg.url) return { skipped: true, reason: !cfg.url ? 'no-url' : 'disabled' };
    if (typeof window === 'undefined' || !window.HighConvictionAlerts) return { skipped: true, reason: 'no-alerts' };
    if (state.lastPushAt && Date.now() - state.lastPushAt < MIN_BETWEEN_PUSHES_MS) return { skipped: true, reason: 'throttle' };
    const feed = window.HighConvictionAlerts.feed(20);
    let pushed = 0, skipped = 0;
    for (const a of feed) {
      const id = a.sourceJournalId || (a.sym + '-' + a.ts);
      if (state.seenJournalIds[id]) { skipped++; continue; }
      const conv = a.conviction || 0;
      if (conv < cfg.minConviction) { state.seenJournalIds[id] = Date.now(); skipped++; continue; }
      // Push it
      state.lastPushAt = Date.now();
      await push(a, state);
      state.seenJournalIds[id] = Date.now();
      pushed++;
      // Wait a bit between sends so we don't bury Discord
      await new Promise(r => setTimeout(r, MIN_BETWEEN_PUSHES_MS));
      // Reload state so other pages can read up-to-date log
    }
    save(state);
    return { pushed, skipped };
  }

  async function testPing() {
    const state = loadState();
    const cfg = state.config;
    if (!cfg.url) return { ok: false, reason: 'no-url' };
    const fake = { sym: 'TEST', direction: 'LONG', conviction: 0.99, entryPx: 100, riskDollars: 200, regime: 'test', ts: Date.now() };
    const res = await push(fake, state);
    save(state);
    return res;
  }

  function reset() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STATE_KEY);
  }

  function autoStart() {
    if (typeof window === 'undefined') return;
    if (window._webhookBridgeTimer) return;
    window._webhookBridgeTimer = setInterval(() => { tick().catch(() => {}); }, POLL_INTERVAL_MS);
  }

  window.WebhookBridge = {
    enable, disable, isEnabled,
    config, getConfig,
    tick, testPing,
    log, clearLog, reset,
    detectTarget, POLL_INTERVAL_MS, DEFAULTS
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') autoStart();
    else document.addEventListener('DOMContentLoaded', autoStart);
  }
})();
