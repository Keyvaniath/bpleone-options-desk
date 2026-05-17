/* ===========================================
   BPLEONE — Money Hotkeys
   ---
   Vim-style "g [letter]" sequence shortcuts to jump between the
   money-focused pages. Plus single-letter actions for power users.

   Sequence shortcuts:
     g h -> home
     g m -> make-money
     g $ -> money-made
     g a -> auto-trade
     g b -> brain-bet
     g r -> risk-simulator
     g p -> pnl-calendar
     g s -> source-quality
     g d -> data-reliability
     g c -> brain-vs-spy-live
     g x -> daily-replay
     g w -> webhook-bridge
     g v -> voice-coach
     g k -> mental-game
     g e -> earnings-awareness

   Single keys:
     ? -> open/close the help overlay
     /  -> focus search input if one exists
     Esc -> close overlay
     t -> toggle voice coach
     n -> toggle high-conviction alerts
     y -> toggle auto-trade
     [ -> previous high-conviction alert (jump)
     ] -> next alert

   Ignored while typing in inputs/textareas.
   =========================================== */

(function () {
  const SEQUENCE_TIMEOUT = 1500;
  const MAP = {
    h: 'index.html',
    m: 'make-money.html',
    '$': 'money-made.html',
    a: 'auto-trade.html',
    b: 'brain-bet.html',
    r: 'risk-simulator.html',
    p: 'pnl-calendar.html',
    s: 'source-quality.html',
    d: 'data-reliability.html',
    c: 'brain-vs-spy-live.html',
    x: 'daily-replay.html',
    w: 'webhook-bridge.html',
    v: 'voice-coach.html',
    k: 'mental-game.html',
    e: 'earnings-awareness.html',
    t: 'trade-plans.html',
    l: 'brain-backtest.html',
    o: 'position-correlation.html',
    g: 'brain-hub.html',         // double-g = hub
    n: 'high-conviction-alerts.html',
    u: 'mobile-money.html',
    f: 'pattern-recall.html'
  };

  let pending = null;
  let pendingAt = 0;
  let overlayEl = null;

  function inEditable() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = (a.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (a.isContentEditable) return true;
    return false;
  }

  function nav(page) {
    if (typeof window !== 'undefined') window.location.href = page;
  }

  function buildOverlay() {
    if (overlayEl) return overlayEl;
    const el = document.createElement('div');
    el.id = 'money-hotkey-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:none;align-items:center;justify-content:center;font-family:Inter,sans-serif;backdrop-filter:blur(8px);';
    const groups = [
      { title: '💰 Money', items: [['g m', 'Make Money'], ['g $', 'Money Made'], ['g a', 'Auto-Trade'], ['g r', 'Risk Sim'], ['g p', 'P&L Calendar'], ['g x', 'Daily Replay'], ['g c', 'vs SPY'], ['g f', 'Pattern Recall'], ['g k', 'Mental Game'], ['g e', 'Earnings'], ['g o', 'Pos Correlation'], ['g l', 'Backtester'], ['g t', 'Trade Plans']] },
      { title: '🧠 Brain', items: [['g h', 'Home'], ['g g', 'Brain Hub'], ['g b', 'Brain Bet'], ['g n', 'Alerts'], ['g v', 'Voice Coach'], ['g w', 'Webhook'], ['g s', 'Source Quality'], ['g d', 'Data Reliability'], ['g u', 'Mobile']] },
      { title: '🎛 Toggles', items: [['t', 'Voice coach on/off'], ['n', 'Alerts on/off'], ['y', 'Auto-trade on/off'], ['[', 'Latest alert nav'], [']', 'Next page nav'], ['Esc', 'Close overlay']] }
    ];
    let html = '<div style="background:#0d1218;border:1px solid rgba(0,212,255,0.3);border-radius:18px;padding:32px;max-width:880px;width:90%;max-height:84vh;overflow:auto;color:#e6e9ee;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;"><div style="font-size:22px;font-weight:900;letter-spacing:-0.3px;">⌨ Keyboard shortcuts</div><div style="font-size:13px;color:#9ca3af;">Press <kbd style="background:rgba(255,255,255,0.1);padding:2px 8px;border-radius:4px;font-family:JetBrains Mono;">Esc</kbd> or <kbd style="background:rgba(255,255,255,0.1);padding:2px 8px;border-radius:4px;font-family:JetBrains Mono;">?</kbd> to close</div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;">';
    for (const g of groups) {
      html += '<div><div style="font-size:13px;font-weight:800;color:#00d4ff;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">' + g.title + '</div>';
      for (const it of g.items) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px;"><span style="color:#cbd5e1;">' + it[1] + '</span><kbd style="background:rgba(0,212,255,0.10);border:1px solid rgba(0,212,255,0.3);color:#00d4ff;padding:2px 10px;border-radius:5px;font-family:JetBrains Mono;font-weight:700;font-size:11px;">' + it[0] + '</kbd></div>';
      }
      html += '</div>';
    }
    html += '</div></div>';
    el.innerHTML = html;
    el.addEventListener('click', e => { if (e.target === el) hideOverlay(); });
    document.body.appendChild(el);
    overlayEl = el;
    return el;
  }
  function showOverlay() { buildOverlay().style.display = 'flex'; }
  function hideOverlay() { if (overlayEl) overlayEl.style.display = 'none'; }
  function toggleOverlay() { if (!overlayEl || overlayEl.style.display !== 'flex') showOverlay(); else hideOverlay(); }

  function handleKey(e) {
    if (inEditable() && e.key !== 'Escape') return;
    const k = e.key;
    const now = Date.now();
    // Esc
    if (k === 'Escape') { hideOverlay(); return; }
    // Help overlay
    if (k === '?' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleOverlay(); return; }
    // Pending sequence (after "g")
    if (pending === 'g' && now - pendingAt < SEQUENCE_TIMEOUT) {
      pending = null;
      if (MAP[k]) { e.preventDefault(); nav(MAP[k]); return; }
      return;
    }
    if (k === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      pending = 'g';
      pendingAt = now;
      return;
    }
    // Single-letter toggles
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (k === 't' && window.VoiceCoach) {
        if (window.VoiceCoach.isEnabled()) window.VoiceCoach.disable();
        else window.VoiceCoach.enable();
        showToast(window.VoiceCoach.isEnabled() ? '🎙️ Voice ON' : '🎙️ Voice OFF');
        return;
      }
      if (k === 'n' && window.HighConvictionAlerts) {
        if (window.HighConvictionAlerts.isEnabled()) window.HighConvictionAlerts.disable();
        else window.HighConvictionAlerts.enable();
        showToast(window.HighConvictionAlerts.isEnabled() ? '🔔 Alerts ON' : '🔔 Alerts OFF');
        return;
      }
      if (k === 'y' && window.AutoTrade) {
        if (window.AutoTrade.isEnabled()) window.AutoTrade.disable();
        else window.AutoTrade.enable();
        showToast(window.AutoTrade.isEnabled() ? '🤖 Auto-Trade ON' : '🤖 Auto-Trade OFF');
        return;
      }
    }
  }

  function showToast(msg) {
    let toast = document.getElementById('hk-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'hk-toast';
      toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(0,212,255,0.95);color:#000;padding:12px 22px;border-radius:30px;font-weight:800;font-family:Inter,sans-serif;font-size:13px;z-index:10000;box-shadow:0 8px 32px rgba(0,212,255,0.4);transition:opacity 0.3s;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(window._hkToastTimer);
    window._hkToastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 1800);
  }

  function init() {
    if (window._moneyHotkeysInstalled) return;
    window._moneyHotkeysInstalled = true;
    document.addEventListener('keydown', handleKey);
  }

  window.MoneyHotkeys = { showOverlay, hideOverlay, toggleOverlay, MAP };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init);
  }
})();
