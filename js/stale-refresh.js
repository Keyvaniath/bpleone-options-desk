/* ===========================================
   BPLEONE — Stale-Symbol Auto-Refresh
   ---
   When DataReliability flags a symbol as STALE (>5 min equity RTH,
   >2 min crypto), this module proactively triggers a fresh single-symbol
   fetch instead of waiting for the next feed cycle.

   For crypto stale symbols → force a Coinbase REST poll
   For equity stale symbols → one worker-feed poll (audit 2026-11-11: was a
   Stooq fetch, which a browser can never read: no CORS headers)

   Throttled to avoid refresh storms: max 1 refresh attempt per symbol
   per 30 seconds. Tracks attempt + success counts.

   Runs every 30 seconds.

   Exposes:
     StaleRefresh.checkOnce() → { refreshed, attempted }
     StaleRefresh.stats() → per-symbol refresh history
     StaleRefresh.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_stale_refresh_v1';
  const POLL_INTERVAL_MS = 30 * 1000;
  const MIN_SECONDS_BETWEEN_REFRESH = 30;

  const COINBASE_PAIRS = { BTC: 'BTC-USD', ETH: 'ETH-USD' };

  function load() {
    if (typeof localStorage === 'undefined') return { attempts: {}, totalRefreshed: 0, totalAttempted: 0 };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { attempts: {}, totalRefreshed: 0, totalAttempted: 0 };
    } catch (e) { return { attempts: {}, totalRefreshed: 0, totalAttempted: 0 }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  async function _refreshCoinbase(symbol) {
    const pair = COINBASE_PAIRS[symbol];
    if (!pair) return false;
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeoutId = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
      const res = await fetch('https://api.exchange.coinbase.com/products/' + pair + '/ticker', {
        method: 'GET', signal: ctrl ? ctrl.signal : undefined
      });
      if (timeoutId) clearTimeout(timeoutId);
      if (!res.ok) return false;
      const data = await res.json();
      const price = parseFloat(data.price);
      if (!isFinite(price) || price <= 0) return false;
      if (typeof window.DataReliability !== 'undefined') {
        const v = window.DataReliability.validate(symbol, price, 'coinbase-refresh', Date.now());
        window.DataReliability.recordFetch('coinbase-refresh', v.ok, 0);
        if (!v.ok) return false;
      }
      if (typeof window.CrossSourceCheck !== 'undefined') {
        try { window.CrossSourceCheck.record(symbol, 'coinbase-refresh', price); } catch (e) {}
      }
      if (typeof window.QUOTES !== 'undefined' && window.QUOTES[symbol]) {
        const q = window.QUOTES[symbol];
        // Audit pass 14: preserve seed prevClose (yesterday's close).
        q.last = price;
        if (q.prevClose > 0) {
          q.change = q.last - q.prevClose;
          q.changePct = (q.change / q.prevClose) * 100;
        }
        q.source = 'coinbase-refresh';
        q.priceSource = 'coinbase-refresh';
        q.liveAt = Date.now();
        q.ts = Date.now();
        try { if (typeof window.Feed !== 'undefined') window.Feed.publish(symbol, q); } catch (e) {}
      }
      return true;
    } catch (e) {
      if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch('coinbase-refresh', false, 0);
      return false;
    }
  }

  // Audit 2026-11-11: equities no longer refresh from Stooq. A browser can never read Stooq (no CORS headers:
  // "Failed to fetch" from options.bpleone.com, checked live), so the old _refreshStooq failed every attempt
  // (removed in pass 340); had it succeeded it would have computed change% against the stale seed prevClose. Stale equities now trigger ONE
  // worker-feed poll (js/worker-quotes.js prices the whole universe with a real prevClose in one request).
  let _lastWorkerPoll = 0;
  async function _refreshEquitiesViaWorker(symbols) {
    if (!symbols.length) return 0;
    if (!window.WorkerQuotes || typeof window.WorkerQuotes.pollQuotes !== 'function') return 0;
    if (Date.now() - _lastWorkerPoll < MIN_SECONDS_BETWEEN_REFRESH * 1000) return 0;
    _lastWorkerPoll = Date.now();
    const before = Date.now();
    try { await window.WorkerQuotes.pollQuotes(); } catch (e) { return 0; }
    const Q = window.QUOTES || {};
    return symbols.filter(s => Q[s] && Q[s].priceSource === 'worker-yahoo' && Q[s].ts >= before).length;
  }

  let _running = false;
  async function checkOnce() {
    if (typeof window === 'undefined' || !window.DataReliability) return { attempted: 0, refreshed: 0 };
    // Audit pass 54: reentrancy guard. setInterval doesn't await async, so a
    // checkOnce taking >30s would have the next interval fire while it's still
    // running. Both runs load the same state, see the same lastAttempts, and
    // double-fire fetches for stale symbols. The guard makes us skip the
    // overlapping tick instead of duplicating work.
    if (_running) return { attempted: 0, refreshed: 0, skipped: 'already-running' };
    _running = true;
    try {
      const staleList = window.DataReliability.staleSymbols();
      const state = load();
      let attempted = 0, refreshed = 0;
      const staleEquities = [];
      for (const s of staleList) {
        const symbol = s.symbol;
        const lastAttempt = state.attempts[symbol] || 0;
        if (Date.now() - lastAttempt < MIN_SECONDS_BETWEEN_REFRESH * 1000) continue;
        state.attempts[symbol] = Date.now();
        // Persist the attempt timestamp BEFORE the fetch so other concurrent
        // tabs see it even if our save-at-end never lands.
        save(state);
        attempted++;
        state.totalAttempted = (state.totalAttempted || 0) + 1;
        if (!s.isCrypto) { staleEquities.push(symbol); continue; }   // batched into one worker poll below
        if (await _refreshCoinbase(symbol)) {
          refreshed++;
          state.totalRefreshed = (state.totalRefreshed || 0) + 1;
        }
      }
      const eqOk = await _refreshEquitiesViaWorker(staleEquities);
      refreshed += eqOk;
      state.totalRefreshed = (state.totalRefreshed || 0) + eqOk;
      save(state);
      return { attempted, refreshed, totalChecked: staleList.length };
    } finally {
      _running = false;
    }
  }

  function stats() {
    const state = load();
    return {
      totalAttempted: state.totalAttempted || 0,
      totalRefreshed: state.totalRefreshed || 0,
      lastAttempts: state.attempts,
      successRate: state.totalAttempted > 0 ? state.totalRefreshed / state.totalAttempted : null
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  function start() {
    if (typeof window === 'undefined') return;
    if (window._staleRefreshInterval) return;
    window._staleRefreshInterval = setInterval(checkOnce, POLL_INTERVAL_MS);
  }

  window.StaleRefresh = { checkOnce, stats, reset, start, MIN_SECONDS_BETWEEN_REFRESH };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(start, 20 * 1000); // 20s delay so DataReliability has data
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(start, 20 * 1000));
    }
  }
})();
