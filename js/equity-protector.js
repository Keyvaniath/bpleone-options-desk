/* ===========================================
   BPLEONE — Equity Drawdown Protector
   ---
   Watches cumulative MoneyTracker + AutoTrade P&L. When current equity
   drops below PEAK - (PEAK * maxDrawdownPct), automatically disables
   AutoTrade and fires a notification.

   Different from Loss Cool-Off: that's about consecutive losses (event
   count). Different from the existing DrawdownProtector: that one
   reduces per-trade sizing. This one is the master kill-switch on
   absolute portfolio drawdown.

   Auto-re-enables when:
     - Equity recovers to within (peak * (1 - maxDD * recoveryPct)) of peak
     - OR returns to a new peak

   Storage: bpleone_equity_protector_v1
   =========================================== */

(function () {
  const KEY = 'bpleone_equity_protector_v1';
  const POLL_MS = 60 * 1000;

  const DEFAULTS = {
    enabled: true,
    maxDrawdownPct: 0.10,     // 10% portfolio drawdown
    recoveryPct: 0.50,        // recover halfway back before re-enable
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
  function defaultState() { return { config: Object.assign({}, DEFAULTS), peakEquity: 0, currentEquity: 0, triggeredAt: 0, history: [] }; }
  function save(s) { if (typeof localStorage !== 'undefined') { try { if (s.history.length > 50) s.history = s.history.slice(-50); localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} } }

  function getConfig() { return load().config; }
  function config(opts) { const s = load(); s.config = Object.assign(s.config, opts || {}); save(s); return s.config; }
  function isEnabled() { return load().config.enabled; }
  function enable() { const s = load(); s.config.enabled = true; save(s); return s.config; }
  function disable() { const s = load(); s.config.enabled = false; save(s); return s.config; }

  function currentEquity() {
    let pnl = 0;
    if (window.MoneyTracker) {
      const s = window.MoneyTracker.summary();
      if (!s.empty && s.windows && s.windows.lifetime) pnl += s.windows.lifetime.totalPnL || 0;
    }
    if (window.AutoTrade) {
      const st = window.AutoTrade.stats();
      pnl += st.totalPnL || 0;
    }
    return pnl;
  }

  function tick() {
    const s = load();
    const cfg = s.config;
    if (!cfg.enabled) return { skipped: true, reason: 'disabled' };
    const equity = currentEquity();
    s.currentEquity = equity;
    if (equity > s.peakEquity) {
      s.peakEquity = equity;
      if (s.triggeredAt > 0 && cfg.autoReenable) {
        if (window.AutoTrade && !window.AutoTrade.isEnabled()) {
          try { window.AutoTrade.enable(); } catch (e) {}
        }
        s.history.push({ ts: Date.now(), kind: 'auto-reenable-new-peak', equity: equity });
        s.triggeredAt = 0;
      }
      save(s);
      return { ok: true, peak: equity };
    }
    const dd = s.peakEquity - equity;
    const ddPct = s.peakEquity > 0 ? dd / s.peakEquity : 0;
    if (s.triggeredAt > 0) {
      const recoveryThreshold = s.peakEquity * (1 - cfg.maxDrawdownPct * cfg.recoveryPct);
      if (equity >= recoveryThreshold && cfg.autoReenable) {
        if (window.AutoTrade && !window.AutoTrade.isEnabled()) {
          try { window.AutoTrade.enable(); } catch (e) {}
        }
        s.history.push({ ts: Date.now(), kind: 'auto-reenable-recovery', equity: equity });
        s.triggeredAt = 0;
      }
      save(s);
      return { triggered: true, ddPct };
    }
    if (ddPct >= cfg.maxDrawdownPct && s.peakEquity > 0) {
      s.triggeredAt = Date.now();
      s.history.push({ ts: Date.now(), kind: 'trigger', ddPct, equity, peak: s.peakEquity });
      if (window.AutoTrade) { try { window.AutoTrade.disable(); } catch (e) {} }
      try {
        if (window.Notify) window.Notify.fire('🛑 Equity protector triggered', 'Equity ' + (ddPct * 100).toFixed(1) + '% below peak. Auto-Trade paused.');
      } catch (e) {}
      save(s);
      return { triggered: true, ddPct };
    }
    save(s);
    return { ok: true, ddPct };
  }

  function status() {
    const s = load();
    const dd = s.peakEquity - s.currentEquity;
    const ddPct = s.peakEquity > 0 ? dd / s.peakEquity : 0;
    return {
      config: s.config,
      peakEquity: s.peakEquity,
      currentEquity: s.currentEquity,
      drawdownDollars: +dd.toFixed(2),
      drawdownPct: +ddPct.toFixed(4),
      triggered: s.triggeredAt > 0,
      triggeredAt: s.triggeredAt,
      thresholdPct: s.config.maxDrawdownPct,
      history: s.history.slice(-10).reverse()
    };
  }

  function reset() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  }

  function autoStart() {
    if (typeof window === 'undefined') return;
    if (window._equityProtectorTimer) return;
    setTimeout(() => { try { tick(); } catch (e) {} }, 8000);
    window._equityProtectorTimer = setInterval(() => { try { tick(); } catch (e) {} }, POLL_MS);
  }

  window.EquityProtector = { config, getConfig, isEnabled, enable, disable, tick, status, reset };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') autoStart();
    else document.addEventListener('DOMContentLoaded', autoStart);
  }
})();
