/* ===========================================
   BPLEONE — Data Reliability Layer
   ---
   Validates every price tick before it's accepted into QUOTES.
   Tracks per-source and per-symbol health.
   Surfaces stale or suspicious data so the brain doesn't learn from garbage.

   Validation rules:
     1. Price must be finite, positive, and non-zero
     2. Price jump from last accepted value < 30% (catch fat-finger / glitches)
     3. New timestamp must be >= last accepted timestamp
     4. If symbol hasn't updated in MAX_AGE_MS, mark stale

   Source health:
     - Fetch success rate (last 100 attempts)
     - Average latency
     - Last successful fetch timestamp

   Per-symbol health:
     - Last accepted price + ts
     - Last rejected price + reason
     - Current freshness (ts-now in seconds)
     - Current source

   Exposes:
     DataReliability.validate(symbol, newPrice, source, ts) → { ok, reason }
     DataReliability.recordFetch(source, success, latencyMs)
     DataReliability.symbolHealth(symbol)
     DataReliability.sourceHealth(source)
     DataReliability.allHealth() → { perSymbol, perSource, summary }
     DataReliability.staleSymbols(maxAgeMs) → array
   =========================================== */

(function () {
  const KEY = 'bpleone_data_reliability_v1';
  const MAX_PRICE_JUMP_PCT = 0.30;        // 30% jump = suspicious
  const STALE_MS_EQUITY_RTH = 5 * 60 * 1000;   // 5 min during RTH
  const STALE_MS_EQUITY_OFF = 60 * 60 * 1000;  // 1 hr outside RTH
  const STALE_MS_CRYPTO = 2 * 60 * 1000;       // 2 min for crypto
  const MAX_FETCH_HISTORY = 100;
  const MAX_VALIDATION_HISTORY = 200;

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : defaultState();
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return {
      symbols: {},   // sym → { lastPrice, lastTs, lastSource, rejectedCount, lastRejection }
      sources: {},   // source → { fetches: [{success, latencyMs, ts}], totalFetches, successCount, lastSuccessAt }
      validations: []  // recent {sym, price, source, ok, reason, ts} log
    };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Returns true if symbol is crypto-like (BTC, ETH, etc)
  function isCrypto(symbol) {
    return /^(BTC|ETH|SOL|XRP|LTC|DOGE)/.test((symbol || '').toUpperCase());
  }

  // Is the US market currently in regular trading hours (9:30-16:00 ET, Mon-Fri)?
  function isRTH() {
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short', hour12: false, hour: '2-digit', minute: '2-digit'
      }).formatToParts(now);
      let weekday = '', hh = 0, mm = 0;
      for (const p of parts) {
        if (p.type === 'weekday') weekday = p.value;
        if (p.type === 'hour') hh = parseInt(p.value, 10) % 24;
        if (p.type === 'minute') mm = parseInt(p.value, 10);
      }
      if (weekday === 'Sat' || weekday === 'Sun') return false;
      const min = hh * 60 + mm;
      return min >= 570 && min < 960; // 9:30 to 16:00
    } catch (e) { return false; }
  }

  function validate(symbol, newPrice, source, ts) {
    if (!symbol) return { ok: false, reason: 'no-symbol' };
    if (typeof newPrice !== 'number' || !isFinite(newPrice)) {
      _logRejection(symbol, newPrice, source, 'non-finite');
      return { ok: false, reason: 'non-finite' };
    }
    if (newPrice <= 0) {
      _logRejection(symbol, newPrice, source, 'non-positive');
      return { ok: false, reason: 'non-positive' };
    }
    if (newPrice > 1e7) {
      _logRejection(symbol, newPrice, source, 'absurdly-large');
      return { ok: false, reason: 'absurdly-large' };
    }
    const state = load();
    const prev = state.symbols[symbol];
    if (prev && prev.lastPrice > 0) {
      const jumpPct = Math.abs(newPrice - prev.lastPrice) / prev.lastPrice;
      if (jumpPct > MAX_PRICE_JUMP_PCT) {
        _logRejection(symbol, newPrice, source, 'jump-' + (jumpPct * 100).toFixed(0) + 'pct');
        return { ok: false, reason: 'price-jump-' + (jumpPct * 100).toFixed(0) + 'pct' };
      }
      const newTs = ts || Date.now();
      if (newTs < prev.lastTs - 1000) {
        // 1-second tolerance for clock skew
        _logRejection(symbol, newPrice, source, 'out-of-order-ts');
        return { ok: false, reason: 'out-of-order-timestamp' };
      }
    }
    // Accept — update state
    state.symbols[symbol] = {
      lastPrice: newPrice,
      lastTs: ts || Date.now(),
      lastSource: source || 'unknown',
      acceptedCount: ((prev && prev.acceptedCount) || 0) + 1,
      rejectedCount: (prev && prev.rejectedCount) || 0,
      lastRejection: prev && prev.lastRejection
    };
    state.validations.push({ sym: symbol, price: newPrice, source, ok: true, ts: Date.now() });
    if (state.validations.length > MAX_VALIDATION_HISTORY) {
      state.validations = state.validations.slice(-MAX_VALIDATION_HISTORY);
    }
    save(state);
    return { ok: true };
  }

  function _logRejection(symbol, price, source, reason) {
    try {
      const state = load();
      const prev = state.symbols[symbol] || { acceptedCount: 0, rejectedCount: 0 };
      state.symbols[symbol] = Object.assign(prev, {
        rejectedCount: (prev.rejectedCount || 0) + 1,
        lastRejection: { price, source, reason, ts: Date.now() }
      });
      state.validations.push({ sym: symbol, price, source, ok: false, reason, ts: Date.now() });
      if (state.validations.length > MAX_VALIDATION_HISTORY) {
        state.validations = state.validations.slice(-MAX_VALIDATION_HISTORY);
      }
      save(state);
    } catch (e) {}
  }

  function recordFetch(source, success, latencyMs) {
    if (!source) return;
    const state = load();
    if (!state.sources[source]) {
      state.sources[source] = { fetches: [], totalFetches: 0, successCount: 0, lastSuccessAt: 0 };
    }
    const src = state.sources[source];
    src.fetches.push({ success: !!success, latencyMs: latencyMs || 0, ts: Date.now() });
    if (src.fetches.length > MAX_FETCH_HISTORY) src.fetches = src.fetches.slice(-MAX_FETCH_HISTORY);
    src.totalFetches = (src.totalFetches || 0) + 1;
    if (success) {
      src.successCount = (src.successCount || 0) + 1;
      src.lastSuccessAt = Date.now();
    }
    save(state);
  }

  function symbolHealth(symbol) {
    const state = load();
    const s = state.symbols[symbol];
    // Audit pass 19: hasData should require an accepted price, not just an
    // entry. A symbol that only ever had rejections has lastPrice=undefined
    // and lastTs=undefined, but the entry exists (from _logRejection). The
    // pre-trade checklist + auto-trade depend on hasData to gate properly.
    if (!s || !s.lastTs || !(s.lastPrice > 0)) {
      return {
        symbol,
        hasData: false,
        rejectedCount: (s && s.rejectedCount) || 0,
        lastRejection: s && s.lastRejection,
        stale: true,    // treat 'no data' as stale so downstream gates fail closed
        isCrypto: isCrypto(symbol)
      };
    }
    const ageMs = Date.now() - s.lastTs;
    const maxStale = isCrypto(symbol) ? STALE_MS_CRYPTO : (isRTH() ? STALE_MS_EQUITY_RTH : STALE_MS_EQUITY_OFF);
    return {
      symbol,
      hasData: true,
      lastPrice: s.lastPrice,
      lastTs: s.lastTs,
      ageMs: ageMs,    // expose ageMs for callers (pre-trade-checklist uses it)
      ageSec: Math.floor(ageMs / 1000),
      ageMin: (ageMs / 60000).toFixed(1),
      lastSource: s.lastSource,
      acceptedCount: s.acceptedCount,
      rejectedCount: s.rejectedCount,
      lastRejection: s.lastRejection,
      stale: ageMs > maxStale,
      maxStaleMs: maxStale,
      isCrypto: isCrypto(symbol),
      duringRTH: !isCrypto(symbol) && isRTH()
    };
  }

  function sourceHealth(source) {
    const state = load();
    const s = state.sources[source];
    if (!s || s.fetches.length === 0) return { source, hasData: false };
    const recent = s.fetches.slice(-50);
    const successRate = recent.filter(f => f.success).length / recent.length;
    const avgLatency = recent.length > 0
      ? recent.reduce((sum, f) => sum + (f.latencyMs || 0), 0) / recent.length
      : 0;
    return {
      source,
      hasData: true,
      totalFetches: s.totalFetches,
      successCount: s.successCount,
      lifetimeSuccessRate: s.totalFetches > 0 ? s.successCount / s.totalFetches : 0,
      recentSuccessRate: successRate,
      avgLatencyMs: avgLatency,
      lastSuccessAt: s.lastSuccessAt,
      ageSinceSuccessMs: s.lastSuccessAt ? Date.now() - s.lastSuccessAt : null,
      degraded: successRate < 0.7 || (s.lastSuccessAt && (Date.now() - s.lastSuccessAt) > 5 * 60 * 1000)
    };
  }

  function staleSymbols() {
    const state = load();
    const out = [];
    for (const sym in state.symbols) {
      const h = symbolHealth(sym);
      if (h.stale) out.push(h);
    }
    return out;
  }

  function allHealth() {
    const state = load();
    const perSymbol = {};
    let staleCount = 0, totalSymbols = 0;
    for (const sym in state.symbols) {
      perSymbol[sym] = symbolHealth(sym);
      if (perSymbol[sym].stale) staleCount++;
      totalSymbols++;
    }
    const perSource = {};
    let degradedSources = 0, totalSources = 0;
    for (const src in state.sources) {
      perSource[src] = sourceHealth(src);
      if (perSource[src].degraded) degradedSources++;
      totalSources++;
    }
    const recentRejections = state.validations.filter(v => !v.ok && Date.now() - v.ts < 5 * 60 * 1000).length;
    return {
      perSymbol,
      perSource,
      summary: {
        totalSymbols,
        staleSymbols: staleCount,
        totalSources,
        degradedSources,
        recentRejections,
        validationsLogged: state.validations.length,
        duringRTH: isRTH()
      }
    };
  }

  function recentValidations(n) {
    if (!n) n = 50;
    const state = load();
    return state.validations.slice(-n).reverse();
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.DataReliability = {
    validate,
    recordFetch,
    symbolHealth,
    sourceHealth,
    staleSymbols,
    allHealth,
    recentValidations,
    reset,
    isCrypto,
    isRTH,
    MAX_PRICE_JUMP_PCT,
    STALE_MS_EQUITY_RTH,
    STALE_MS_CRYPTO
  };
})();
