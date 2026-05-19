/* ===========================================
   BPLEONE — Cross-Source Price Agreement Check
   ---
   DataReliability validates each price tick INDIVIDUALLY (not finite,
   ≤0, >30% jump, out-of-order ts). But it can't catch the case where
   ONE source is silently wrong — e.g. Stooq returning SPY at $585.10
   while Coinbase or a real WS provider has $590.40 at the same moment.
   Both prices pass individual validation, but they disagree.

   This module:
     1. Records (symbol, source, price, ts) every time a price arrives
     2. When 2+ sources have a price for the same symbol within
        AGREEMENT_WINDOW_MS, computes max relative disagreement
     3. If disagreement > DISAGREEMENT_THRESHOLD, logs a discrepancy
     4. Surfaces a per-symbol "agreement score" — higher = more reliable

   Doesn't reject prices (we can't tell which source is wrong). Just
   logs the disagreement so Brandon can review on the dashboard.

   Exposes:
     CrossSourceCheck.record(symbol, source, price)
     CrossSourceCheck.disagreements(window=50) → recent disagreements
     CrossSourceCheck.symbolAgreement(symbol) → { score, sources, avg }
     CrossSourceCheck.allAgreements()
     CrossSourceCheck.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_cross_source_v1';
  const AGREEMENT_WINDOW_MS = 60 * 1000;    // 60 sec window to compare across sources
  const DISAGREEMENT_THRESHOLD = 0.005;     // 0.5% = noteworthy
  const MAX_LOG = 1000;
  const MAX_DISAGREEMENTS = 200;
  // Audit pass 97: record() was called on every price tick (Coinbase WS can
  // fire many times/sec) and wrote localStorage every time — a brutal write
  // storm. Now: hold the full state in-memory, work on it directly, and
  // only persist to localStorage every FLUSH_INTERVAL_MS or on pagehide.
  const FLUSH_INTERVAL_MS = 10 * 1000;

  function loadFromStorage() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : defaultState();
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return {
      recent: [],         // [{ sym, source, price, ts }] — last AGREEMENT_WINDOW worth
      disagreements: [],  // [{ sym, sources, prices, maxPct, ts }]
      symbolStats: {}     // sym → { agreementChecks, disagreementCount }
    };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // In-memory state, hydrated lazily from localStorage on first access.
  let _state = null;
  let _lastFlushAt = 0;
  let _dirty = false;

  function getState() {
    if (_state === null) _state = loadFromStorage();
    return _state;
  }

  function maybeFlush() {
    if (!_dirty) return;
    if (Date.now() - _lastFlushAt < FLUSH_INTERVAL_MS) return;
    save(_state);
    _lastFlushAt = Date.now();
    _dirty = false;
  }

  function record(symbol, source, price) {
    if (!symbol || !source || typeof price !== 'number' || !isFinite(price) || price <= 0) return;
    const state = getState();
    const now = Date.now();

    // Drop old entries beyond window
    state.recent = state.recent.filter(r => now - r.ts < AGREEMENT_WINDOW_MS);

    // Find other recent entries for the same symbol from DIFFERENT sources
    const peers = state.recent.filter(r => r.sym === symbol && r.source !== source);

    if (peers.length > 0) {
      // Compare across sources
      const sources = { [source]: price };
      peers.forEach(p => { sources[p.source] = p.price; });
      const prices = Object.values(sources);
      const maxP = Math.max(...prices);
      const minP = Math.min(...prices);
      const maxPct = minP > 0 ? (maxP - minP) / minP : 0;

      // Update per-symbol stats
      if (!state.symbolStats[symbol]) state.symbolStats[symbol] = { checks: 0, disagreements: 0, totalDisagreementPct: 0 };
      state.symbolStats[symbol].checks++;
      if (maxPct > DISAGREEMENT_THRESHOLD) {
        state.symbolStats[symbol].disagreements++;
        state.symbolStats[symbol].totalDisagreementPct += maxPct;
        state.disagreements.push({
          sym: symbol,
          sources: Object.keys(sources),
          prices: sources,
          maxPct,
          ts: now
        });
        if (state.disagreements.length > MAX_DISAGREEMENTS) {
          state.disagreements = state.disagreements.slice(-MAX_DISAGREEMENTS);
        }
      }
    }

    // Add current to recent
    state.recent.push({ sym: symbol, source, price: +price.toFixed(4), ts: now });
    if (state.recent.length > MAX_LOG) state.recent = state.recent.slice(-MAX_LOG);
    _dirty = true;
    maybeFlush();
  }

  function disagreements(n) {
    if (!n) n = 50;
    const state = getState();
    return state.disagreements.slice(-n).reverse();
  }

  function symbolAgreement(symbol) {
    const state = getState();
    const s = state.symbolStats[symbol];
    if (!s || s.checks === 0) return { symbol, checks: 0, agreementScore: null };
    const agreementRate = 1 - (s.disagreements / s.checks);
    const avgDisagreement = s.disagreements > 0 ? s.totalDisagreementPct / s.disagreements : 0;
    return {
      symbol,
      checks: s.checks,
      disagreementCount: s.disagreements,
      agreementScore: agreementRate,  // 1.0 = perfect agreement, 0.0 = always disagrees
      avgDisagreementPct: avgDisagreement
    };
  }

  function allAgreements() {
    const state = getState();
    const out = [];
    for (const sym in state.symbolStats) {
      out.push(symbolAgreement(sym));
    }
    out.sort((a, b) => (a.agreementScore || 1) - (b.agreementScore || 1));
    return out;
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
    _state = defaultState();
    _dirty = false;
  }

  // Pass 97: flush on page hide so we don't lose the buffered state.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => {
      try { if (_dirty && _state) { save(_state); _dirty = false; } } catch (e) {}
    });
  }

  window.CrossSourceCheck = {
    record,
    disagreements,
    symbolAgreement,
    allAgreements,
    reset,
    AGREEMENT_WINDOW_MS,
    DISAGREEMENT_THRESHOLD
  };
})();
