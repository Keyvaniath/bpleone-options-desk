/* ===========================================
   BPLEONE — Auto-Watchlist
   ---
   Every high-conviction alert auto-promotes its symbol to a curated
   watchlist. Each entry tracks:
     - first-alerted timestamp
     - alert count
     - last alert ts + direction
     - status: 'watching' | 'promoted' | 'dismissed'

   "Promoted" = Brandon manually said "yes this is worth tracking";
   "Dismissed" = he muted it. Default new entries are 'watching'.

   Polls HighConvictionAlerts every 30s.

   Storage: bpleone_auto_watchlist_v1

   Exposes:
     AutoWatchlist.list() -> all entries
     AutoWatchlist.promote(sym), dismiss(sym), revive(sym), remove(sym)
     AutoWatchlist.bySymbol(sym) -> single entry
     AutoWatchlist.tick() -> manual poll
   =========================================== */

(function () {
  const KEY = 'bpleone_auto_watchlist_v1';
  const POLL_MS = 30 * 1000;

  function load() {
    if (typeof localStorage === 'undefined') return { entries: {}, lastSeen: 0 };
    try { return JSON.parse(localStorage.getItem(KEY) || '{"entries":{},"lastSeen":0}'); } catch (e) { return { entries: {}, lastSeen: 0 }; }
  }
  function save(s) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  function list() {
    const s = load();
    return Object.values(s.entries).sort((a, b) => b.lastAlertTs - a.lastAlertTs);
  }
  function bySymbol(sym) {
    const s = load();
    return s.entries[sym] || null;
  }

  function promote(sym) {
    const s = load();
    if (!s.entries[sym]) return false;
    s.entries[sym].status = 'promoted';
    s.entries[sym].promotedAt = Date.now();
    save(s);
    return true;
  }
  function dismiss(sym) {
    const s = load();
    if (!s.entries[sym]) return false;
    s.entries[sym].status = 'dismissed';
    s.entries[sym].dismissedAt = Date.now();
    save(s);
    return true;
  }
  function revive(sym) {
    const s = load();
    if (!s.entries[sym]) return false;
    s.entries[sym].status = 'watching';
    delete s.entries[sym].dismissedAt;
    save(s);
    return true;
  }
  function remove(sym) {
    const s = load();
    delete s.entries[sym];
    save(s);
  }
  function clear() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  function tick() {
    if (typeof window === 'undefined' || !window.HighConvictionAlerts) return { skipped: true };
    const feed = window.HighConvictionAlerts.feed(50);
    const s = load();
    let added = 0, updated = 0;
    for (const a of feed) {
      if (!a || !a.sym) continue;
      if (a.ts <= s.lastSeen) continue;     // already processed
      const e = s.entries[a.sym];
      if (!e) {
        s.entries[a.sym] = {
          sym: a.sym,
          firstAlertTs: a.ts,
          lastAlertTs: a.ts,
          alertCount: 1,
          lastDirection: a.direction,
          lastConviction: a.conviction,
          lastRiskDollars: a.riskDollars,
          status: 'watching'
        };
        added++;
      } else if (a.ts > e.lastAlertTs) {
        e.lastAlertTs = a.ts;
        e.lastDirection = a.direction;
        e.lastConviction = a.conviction;
        e.lastRiskDollars = a.riskDollars;
        e.alertCount = (e.alertCount || 0) + 1;
        updated++;
      }
    }
    s.lastSeen = Date.now();
    save(s);
    return { added, updated, total: Object.keys(s.entries).length };
  }

  function autoStart() {
    if (typeof window === 'undefined') return;
    if (window._autoWatchlistTimer) return;
    setTimeout(tick, 4000);
    window._autoWatchlistTimer = setInterval(() => { try { tick(); } catch (e) {} }, POLL_MS);
  }

  window.AutoWatchlist = { list, bySymbol, promote, dismiss, revive, remove, clear, tick };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') autoStart();
    else document.addEventListener('DOMContentLoaded', autoStart);
  }
})();
