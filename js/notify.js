/* ===========================================
   BPLEONE TRADING - NOTIFICATIONS HELPER
   Browser push for signal alerts. Falls back
   silently if user denies permission.
   =========================================== */

const Notify = (function() {
  const KEY = 'bpleone_notify_prefs';
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
  }

  function supported() { return 'Notification' in window; }
  function permission() { return supported() ? Notification.permission : 'unsupported'; }

  async function request() {
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied')  return 'denied';
    try {
      const result = await Notification.requestPermission();
      return result;
    } catch (e) { return 'error'; }
  }

  function fire(title, body, opts) {
    if (!supported() || Notification.permission !== 'granted') return null;
    const prefs = loadPrefs();
    if (prefs.muted) return null;
    const notif = new Notification(title, Object.assign({
      body: body || '',
      icon: 'assets/icon-192.png',
      badge: 'assets/icon-192.png',
      tag: 'bpleone-' + (opts && opts.tag ? opts.tag : Date.now())
    }, opts || {}));
    if (opts && opts.url) {
      notif.onclick = () => { window.focus(); window.location.href = opts.url; notif.close(); };
    }
    setTimeout(() => notif.close(), 8000);
    return notif;
  }

  // Test ping the user can fire manually
  function testPing() {
    fire('🔔 Notifications are live', 'You will be alerted on signal triggers and live trades.', { tag: 'test' });
  }

  // Subscribe to a synthetic signal feed (driven by Feed if available)
  function autoSubscribeSignals() {
    if (typeof Feed === 'undefined') return;
    // Fire a digest every ~60s with the top mover, only if granted
    let lastFiredFor = '';
    setInterval(() => {
      if (Notification.permission !== 'granted' || loadPrefs().muted) return;
      if (typeof QUOTES === 'undefined') return;
      const sorted = Object.values(QUOTES).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
      const top = sorted[0];
      if (!top || top.symbol === lastFiredFor) return;
      // Only fire if move is "notable"
      if (Math.abs(top.changePct) < 2.0) return;
      lastFiredFor = top.symbol;
      const dir = top.changePct >= 0 ? 'up' : 'down';
      fire(`${top.symbol} ${dir} ${Math.abs(top.changePct).toFixed(2)}%`,
           `Now $${top.last.toFixed(2)}. Tap to view signals.`,
           { tag: top.symbol, url: 'signals.html' });
    }, 60000);
  }

  function setMuted(v) { const p = loadPrefs(); p.muted = !!v; savePrefs(p); }
  function isMuted() { return !!loadPrefs().muted; }

  return { supported, permission, request, fire, testPing, autoSubscribeSignals, setMuted, isMuted };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (typeof Notify !== 'undefined') Notify.autoSubscribeSignals();
});
