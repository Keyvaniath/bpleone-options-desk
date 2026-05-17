/* ===========================================
   BPLEONE — Loss Cool-Off
   ---
   After N consecutive losses (in either AutoTrade or MoneyTracker),
   automatically pauses AutoTrade for COOLOFF_HOURS.

   Why: revenge-trading after a loss streak is one of the top P&L
   destroyers. This is a hard rule that takes the human emotion out.

   Polls every 60 seconds. When trigger fires:
     - Calls AutoTrade.disable() (saves to localStorage)
     - Sets cooloffUntil timestamp
     - Logs the trigger event
   Auto-re-enables when cooloffUntil passes.

   Storage: bpleone_loss_cooloff_v1

   Exposes:
     LossCooloff.config({...}) / getConfig()
     LossCooloff.enable() / disable()
     LossCooloff.status() -> { active, cooloffUntil, lastTriggerAt, history }
     LossCooloff.tick()
     LossCooloff.manualOverride() -- skip remaining cooldown
   =========================================== */

(function () {
  const KEY = 'bpleone_loss_cooloff_v1';
  const POLL_MS = 60 * 1000;

  const DEFAULTS = {
    enabled: true,
    consecLossesTrigger: 3,
    cooloffHours: 2,
    autoReenable: true
  };

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      if (!j) return defaultState();
      const s = JSON.parse(j);
      s.config = Object.assign({}, DEFAULTS, s.config || {});
      s.history = s.history || [];
      return s;
    } catch (e) { return defaultState(); }
  }
  function defaultState() { return { config: Object.assign({}, DEFAULTS), cooloffUntil: 0, lastTriggerAt: 0, history: [] }; }
  function save(s) { if (typeof localStorage !== 'undefined') { try { if (s.history.length > 50) s.history = s.history.slice(-50); localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} } }

  function getConfig() { return load().config; }
  function config(opts) { const s = load(); s.config = Object.assign(s.config, opts || {}); save(s); return s.config; }
  function enable() { const s = load(); s.config.enabled = true; save(s); return s.config; }
  function disable() { const s = load(); s.config.enabled = false; save(s); return s.config; }

  function countConsecLosses() {
    // Pull recent closed trades from both AutoTrade and MoneyTracker
    const closed = [];
    if (window.AutoTrade) {
      const at = window.AutoTrade.closedTrades();
      at.forEach(t => closed.push({ ts: t.closedAt, pnl: t.realizedPnL }));
    }
    if (window.MoneyTracker) {
      const m = window.MoneyTracker.summary();
      if (!m.empty && m.windows && m.windows.lifetime) {
        const recent = m.windows.lifetime.trades || [];
        recent.forEach(t => closed.push({ ts: t.ts, pnl: t.pnl }));
      }
    }
    closed.sort((a, b) => a.ts - b.ts);
    // Walk from end: count consecutive losses
    let consec = 0;
    for (let i = closed.length - 1; i >= 0; i--) {
      const p = closed[i].pnl;
      if (p < 0) consec++;
      else if (p > 0) break;
    }
    return { consec, total: closed.length, lastTs: closed.length ? closed[closed.length - 1].ts : 0 };
  }

  function tick() {
    const s = load();
    const cfg = s.config;
    if (!cfg.enabled) return { skipped: true, reason: 'disabled' };
    // Auto-reenable if cooloff expired
    if (s.cooloffUntil && Date.now() > s.cooloffUntil && cfg.autoReenable) {
      if (window.AutoTrade && !window.AutoTrade.isEnabled()) {
        try { window.AutoTrade.enable(); } catch (e) {}
      }
      s.history.push({ ts: Date.now(), kind: 'auto-reenable', cooloffStartedAt: s.lastTriggerAt });
      s.cooloffUntil = 0;
      save(s);
      return { reenabled: true };
    }
    // Don't trigger if cooloff still active
    if (s.cooloffUntil > Date.now()) return { active: true, remainingMs: s.cooloffUntil - Date.now() };
    // Check consec losses
    const cl = countConsecLosses();
    if (cl.consec >= cfg.consecLossesTrigger) {
      // Trigger cooloff
      s.lastTriggerAt = Date.now();
      s.cooloffUntil = Date.now() + cfg.cooloffHours * 60 * 60 * 1000;
      s.history.push({ ts: Date.now(), kind: 'trigger', consecLosses: cl.consec, cooloffHours: cfg.cooloffHours });
      if (window.AutoTrade) {
        try { window.AutoTrade.disable(); } catch (e) {}
      }
      save(s);
      // Fire notification if available
      try {
        if (window.Notify) window.Notify.fire('⏸ Loss cool-off triggered', cl.consec + ' losses in a row. Auto-Trade paused for ' + cfg.cooloffHours + 'h.');
      } catch (e) {}
      return { triggered: true, consec: cl.consec };
    }
    return { ok: true, consec: cl.consec };
  }

  function status() {
    const s = load();
    const cl = countConsecLosses();
    return {
      config: s.config,
      cooloffUntil: s.cooloffUntil,
      remainingMs: Math.max(0, s.cooloffUntil - Date.now()),
      active: s.cooloffUntil > Date.now(),
      lastTriggerAt: s.lastTriggerAt,
      currentConsec: cl.consec,
      triggerAt: s.config.consecLossesTrigger,
      history: s.history.slice(-10).reverse()
    };
  }

  function manualOverride() {
    const s = load();
    s.cooloffUntil = 0;
    s.history.push({ ts: Date.now(), kind: 'manual-override' });
    save(s);
    return true;
  }

  function reset() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  }

  function autoStart() {
    if (typeof window === 'undefined') return;
    if (window._lossCooloffTimer) return;
    window._lossCooloffTimer = setInterval(() => { try { tick(); } catch (e) {} }, POLL_MS);
  }

  window.LossCooloff = { config, getConfig, enable, disable, tick, status, manualOverride, reset };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') autoStart();
    else document.addEventListener('DOMContentLoaded', autoStart);
  }
})();
