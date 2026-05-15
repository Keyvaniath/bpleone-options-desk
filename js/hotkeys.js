/* ===========================================
   BPLEONE TRADING - GLOBAL HOTKEYS
   ---
   Pro keyboard shortcuts. Press ? anywhere to
   see the full list.
   ---
   Bindings (won't fire while typing in an input):
     ?          Show keyboard help
     /          Focus search / open command palette
     g d        Go to Dashboard
     g p        Go to Plays
     g t        Go to Trade of the Day
     g f        Go to Options Flow
     g s        Go to Signals
     g k        Go to Settings
     g a        Go to Assistant
     g j        Go to Journal
     g l        Go to Learn Dashboard
     g r        Go to Risk
     j / k      Next / previous item in active list
     n          Toggle notifications mute
     t          Theme toggle (when implemented)
   =========================================== */

const Hotkeys = (function() {
  let chord = null;
  let chordTimer = null;

  const ROUTES = {
    'd': 'dashboard.html',
    'p': 'plays.html',
    't': 'trade-of-the-day.html',
    'f': 'options-flow.html',
    'c': 'options-chain.html',
    's': 'signals.html',
    'k': 'settings.html',
    'a': 'assistant.html',
    'j': 'journal.html',
    'l': 'learn-dashboard.html',
    'r': 'risk-dashboard.html',
    'e': 'edge-analytics.html',
    'w': 'watchlists.html',
    'm': 'momentum.html',
    'v': 'vol-surface.html',
    'g': 'gex.html',
    'h': 'heatmap.html',
    'o': 'order-flow.html',
    'b': 'paper-trade.html',
    'i': 'ticker.html',
    'x': 'tape.html'
  };

  function isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function go(url) { window.location.href = url; }

  function clearChord() {
    chord = null;
    if (chordTimer) clearTimeout(chordTimer);
  }

  function startChord(prefix) {
    chord = prefix;
    if (chordTimer) clearTimeout(chordTimer);
    chordTimer = setTimeout(clearChord, 1500);
  }

  function showHelp() {
    let modal = document.getElementById('hotkey-help-modal');
    if (modal) { modal.classList.add('active'); return; }
    modal = document.createElement('div');
    modal.id = 'hotkey-help-modal';
    modal.className = 'hotkey-modal active';
    modal.innerHTML = `
      <div class="hotkey-backdrop"></div>
      <div class="hotkey-panel">
        <div class="hotkey-head">
          <h3>⌨ Keyboard Shortcuts</h3>
          <button class="hotkey-close" aria-label="Close">×</button>
        </div>
        <div class="hotkey-grid">
          <div class="hotkey-col">
            <div class="hotkey-section">Universal</div>
            <div class="hotkey-row"><span><kbd>?</kbd></span><span>Show this help</span></div>
            <div class="hotkey-row"><span><kbd>⌘</kbd><kbd>K</kbd> / <kbd>Ctrl</kbd><kbd>K</kbd></span><span>Open command palette</span></div>
            <div class="hotkey-row"><span><kbd>/</kbd></span><span>Focus search / palette</span></div>
            <div class="hotkey-row"><span><kbd>Esc</kbd></span><span>Close any overlay</span></div>
            <div class="hotkey-row"><span><kbd>n</kbd></span><span>Toggle notifications mute</span></div>

            <div class="hotkey-section">Within a List</div>
            <div class="hotkey-row"><span><kbd>j</kbd> / <kbd>k</kbd></span><span>Next / previous row</span></div>
          </div>

          <div class="hotkey-col">
            <div class="hotkey-section">Go to (chord)</div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>d</kbd></span><span>Dashboard</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>p</kbd></span><span>Plays of the Day</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>t</kbd></span><span>Trade of the Day</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>f</kbd></span><span>Options Flow</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>c</kbd></span><span>Options Chain</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>s</kbd></span><span>Signals</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>e</kbd></span><span>Edge Analytics</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>l</kbd></span><span>Learn Dashboard</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>r</kbd></span><span>Risk Dashboard</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>j</kbd></span><span>Journal</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>a</kbd></span><span>AI Assistant</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>b</kbd></span><span>Paper Trading</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>o</kbd></span><span>Order Flow</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>i</kbd></span><span>Ticker Focus</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>k</kbd></span><span>Settings</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>w</kbd></span><span>Watchlists</span></div>
            <div class="hotkey-row"><span><kbd>g</kbd><kbd>x</kbd></span><span>Time & Sales (tape)</span></div>
          </div>
        </div>
        <div class="hotkey-footer">Hotkeys are disabled while typing in inputs. Pro tip: <kbd>⌘K</kbd> finds everything you can hotkey to (and more).</div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.hotkey-backdrop').addEventListener('click', hideHelp);
    modal.querySelector('.hotkey-close').addEventListener('click', hideHelp);
  }

  function hideHelp() {
    const m = document.getElementById('hotkey-help-modal');
    if (m) m.classList.remove('active');
  }

  function handleKey(e) {
    // Always-on: Escape closes overlays
    if (e.key === 'Escape') {
      hideHelp();
      if (window.CmdPalette) CmdPalette.close();
      return;
    }
    if (isTyping()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // chord: g X
    if (chord === 'g') {
      const k = e.key.toLowerCase();
      if (ROUTES[k]) { e.preventDefault(); clearChord(); go(ROUTES[k]); return; }
      clearChord();
      return;
    }

    if (e.key === '?') { e.preventDefault(); showHelp(); return; }
    if (e.key === '/') {
      e.preventDefault();
      if (window.CmdPalette) CmdPalette.open();
      return;
    }
    if (e.key === 'g') { e.preventDefault(); startChord('g'); return; }
    // Quick-trade: press T (uppercase) → prompt for symbol → open Trade Ticket
    if (e.key === 'T') {
      e.preventDefault();
      const sym = prompt('Quick-trade · enter ticker:');
      if (sym && /^[A-Z]{1,6}(\.[A-Z]+)?$/.test(sym.trim().toUpperCase())) {
        location.href = 'trade-ticket.html?sym=' + sym.trim().toUpperCase();
      }
      return;
    }
    if (e.key === 'n') {
      if (typeof Notify !== 'undefined' && Notify.permission() === 'granted') {
        Notify.setMuted(!Notify.isMuted());
        if (window.Toast) Toast.show('Alerts: ' + (Notify.isMuted() ? 'muted' : 'on'));
      }
      return;
    }
    if (e.key === 'j' || e.key === 'k') {
      // navigate within table rows / cards if a focusable list exists
      const dir = e.key === 'j' ? 1 : -1;
      const list = document.querySelector('table tbody');
      if (!list) return;
      const rows = [...list.querySelectorAll('tr')].filter(r => r.offsetParent !== null);
      if (!rows.length) return;
      let idx = rows.findIndex(r => r.classList.contains('row-focus'));
      idx = idx < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, idx + dir));
      rows.forEach(r => r.classList.remove('row-focus'));
      rows[idx].classList.add('row-focus');
      rows[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
      e.preventDefault();
    }
  }

  document.addEventListener('keydown', handleKey);

  return { showHelp, hideHelp };
})();

window.Hotkeys = Hotkeys;
