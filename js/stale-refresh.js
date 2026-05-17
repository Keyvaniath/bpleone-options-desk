/* ===========================================
   BPLEONE — Stale-Symbol Auto-Refresh
   ---
   When DataReliability flags a symbol as STALE (>5 min equity RTH,
   >2 min crypto), this module proactively triggers a fresh single-symbol
   fetch instead of waiting for the next 12s Stooq poll cycle.

   For crypto stale symbols → force a Coinbase REST poll
   For equity stale symbols → force a Stooq single-symbol fetch

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

  // Reuse the same Stooq symbol mapping the historical bootstrap uses
  const STOOQ_MAP = {
    SPY: 'spy.us', QQQ: 'qqq.us', IWM: 'iwm.us', DIA: 'dia.us',
    AAPL: 'aapl.us', MSFT: 'msft.us', GOOGL: 'googl.us', META: 'meta.us', AMZN: 'amzn.us',
    NVDA: 'nvda.us', AMD: 'amd.us', SMCI: 'smci.us',
    TSLA: 'tsla.us', PLTR: 'pltr.us', CRM: 'crm.us', SHOP: 'shop.us',
    COIN: 'coin.us',
    XLE: 'xle.us', GLD: 'gld.us', SLV: 'slv.us',
    BABA: 'baba.us', UBER: 'uber.us'
  };
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

  async function _refreshStooq(symbol) {
    const stooqSym = STOOQ_MAP[symbol];
    if (!stooqSym) return false;
    const url = 'https://stooq.com/q/l/?s=' + encodeURIComponent(stooqSym) + '&f=sd2t2ohlcv&h&e=csv';
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeoutId = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
      const res = await fetch(url, { method: 'GET', cache: 'no-cache', signal: ctrl ? ctrl.signal : undefined });
      if (timeoutId) clearTimeout(timeoutId);
      if (!res.ok) return false;
      const text = await res.text();
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) return false;
      const cols = lines[1].split(',');
      const close = parseFloat(cols[6]);
      if (!isFinite(close) || close <= 0) return false;
      // Validate + apply
      if (typeof window.DataReliability !== 'undefined') {
        const v = window.DataReliability.validate(symbol, close, 'stooq-refresh', Date.now());
        window.DataReliability.recordFetch('stooq-refresh', v.ok, 0);
        if (!v.ok) return false;
      }
      if (typeof window.CrossSourceCheck !== 'undefined') {
        try { window.CrossSourceCheck.record(symbol, 'stooq-refresh', close); } catch (e) {}
      }
      if (typeof window.QUOTES !== 'undefined' && window.QUOTES[symbol]) {
        const q = window.QUOTES[symbol];
        if (q.last !== close) q.prevClose = q.last;
        q.last = close;
        if (q.prevClose > 0) {
          q.change = q.last - q.prevClose;
          q.changePct = (q.change / q.prevClose) * 100;
        }
        q.source = 'stooq-refresh';
        q.priceSource = 'stooq-refresh';
        q.liveAt = Date.now();
        q.ts = Date.now();
        try { if (typeof window.Feed !== 'undefined') window.Feed.publish(symbol, q); } catch (e) {}
      }
      return true;
    } catch (e) {
      if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch('stooq-refresh', false, 0);
      return false;
    }
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
        if (q.last !== price) q.prevClose = q.prevClose || q.last;
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

  async function checkOnce() {
    if (typeof window === 'undefined' || !window.DataReliability) return { attempted: 0, refreshed: 0 };
    const staleList = window.DataReliability.staleSymbols();
    const state = load();
    let attempted = 0, refreshed = 0;
    for (const s of staleList) {
      const symbol = s.symbol;
      const lastAttempt = state.attempts[symbol] || 0;
      if (Date.now() - lastAttempt < MIN_SECONDS_BETWEEN_REFRESH * 1000) continue;
      state.attempts[symbol] = Date.now();
      attempted++;
      state.totalAttempted = (state.totalAttempted || 0) + 1;
      let ok = false;
      if (s.isCrypto) {
        ok = await _refreshCoinbase(symbol);
      } else {
        ok = await _refreshStooq(symbol);
      }
      if (ok) {
        refreshed++;
        state.totalRefreshed = (state.totalRefreshed || 0) + 1;
      }
    }
    save(state);
    return { attempted, refreshed, totalChecked: staleList.length };
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
