/* ===========================================
   BPLEONE TRADING - RECENT TICKERS SIDEBAR
   ---
   Tracks last 10 symbols viewed. Auto-injects a
   floating sidebar with quick-jump chips on every
   page that loads this script.
   =========================================== */

const RecentTickers = (function () {
  const KEY = 'bpleone_recent_tickers_v1';
  const MAX = 10;

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }

  function add(sym) {
    if (!sym || !/^[A-Z]{1,6}(\.[A-Z]+)?$/.test(sym)) return;
    let list = load();
    list = list.filter(s => s !== sym);
    list.unshift(sym);
    if (list.length > MAX) list = list.slice(0, MAX);
    save(list);
    render();
  }

  function clear() { save([]); render(); }
  function getAll() { return load(); }

  function autoCapture() {
    try {
      const params = new URLSearchParams(location.search);
      const sym = (params.get('sym') || '').toUpperCase();
      if (sym) add(sym);
    } catch (e) {}
  }

  function render() {
    let bar = document.getElementById('bpleoneRecentBar');
    const list = load();
    if (!list.length) {
      if (bar) bar.style.display = 'none';
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'bpleoneRecentBar';
      bar.style.cssText = 'position:fixed;right:0;top:120px;z-index:90;background:var(--bg-elevated);border:1px solid var(--border);border-right:none;border-radius:10px 0 0 10px;padding:10px 8px;display:flex;flex-direction:column;gap:4px;max-width:80px;box-shadow:-4px 0 12px rgba(0,0,0,0.3);';
      document.body.appendChild(bar);
    }
    bar.style.display = 'flex';
    bar.innerHTML = `<div style="font-size:8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;text-align:center;margin-bottom:2px;">RECENT</div>` +
      list.map(s => `<a href="trade-ticket.html?sym=${s}" title="${s} → Trade Ticket" style="display:block;text-align:center;padding:6px 4px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--text-primary);text-decoration:none;transition:all .12s;">${s}</a>`).join('') +
      `<button onclick="RecentTickers.clear()" title="Clear" style="margin-top:4px;padding:4px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;">✕</button>`;
  }

  // Auto-capture on every page load
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { autoCapture(); render(); });
    } else {
      autoCapture(); render();
    }
    // Also hook clicks on any link with ?sym= param
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href*="?sym="]');
      if (!a) return;
      try {
        const url = new URL(a.href, location.href);
        const sym = (url.searchParams.get('sym') || '').toUpperCase();
        if (sym) add(sym);
      } catch (err) {}
    });
  }

  return { add, clear, getAll, render };
})();
if (typeof window !== 'undefined') window.RecentTickers = RecentTickers;
