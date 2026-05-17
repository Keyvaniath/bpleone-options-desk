/* ===========================================
   BPLEONE — Smart Source Preference
   ---
   When 2+ data sources have a fresh price for the same symbol (e.g. Stooq
   poll just fired, but Coinbase WebSocket already had a tick 1s earlier),
   we want to PREFER the higher-quality source. Without this, the slower
   or less-reliable source can overwrite a better price.

   Quality is computed from:
     - DataReliability success rate (per-source over last 100 fetches)
     - CrossSourceCheck agreement (how often this source matches peers)
     - Latency penalty (higher latency = lower score)
     - Built-in priority: realtime WS > stooq > refresh fallbacks

   Each source gets a continuous score in [0, 1]. The score is recomputed
   on demand from current DataReliability + CrossSourceCheck state — no
   caching, no persistence (those modules already persist their data).

   Exposes:
     SourcePreference.rank(source) -> 0..1
     SourcePreference.shouldOverwrite(symbol, newSource) -> bool
        true when this incoming tick should replace the canonical price
     SourcePreference.compare(srcA, srcB) -> +1 / 0 / -1
     SourcePreference.preferred(symbol) -> { source, score }
     SourcePreference.allRanks() -> [{ source, score, components }]
   =========================================== */

(function () {
  // Built-in priority bias. WebSocket realtime > REST poll > refresh fallback.
  // Higher = better. Range 0..0.3, added on top of empirical reliability.
  const PRIORITY_BIAS = {
    'finnhub': 0.30,
    'polygon': 0.30,
    'alpaca': 0.28,
    'tradier': 0.28,
    'coinbase-ws': 0.30,
    'coinbase': 0.22,
    'coinbase-rest': 0.22,
    'coinbase-refresh': 0.20,
    'stooq': 0.18,
    'stooq-refresh': 0.15,
    'mock': 0.05,
    'seed': 0.02
  };

  // Window during which a source counts as "fresh enough" to be the canonical.
  // If the current canonical is older than this, any new fresh source wins
  // regardless of quality.
  const FRESHNESS_MS = 90 * 1000;

  // Tiebreaker margin: incoming source must beat current by this much
  // to be allowed to overwrite. Prevents thrashing between two near-equal sources.
  const TIEBREAKER_MARGIN = 0.02;

  function priorityFor(source) {
    if (!source) return 0;
    const s = String(source).toLowerCase();
    if (PRIORITY_BIAS[s] !== undefined) return PRIORITY_BIAS[s];
    // Loose match
    if (s.indexOf('finnhub') !== -1) return PRIORITY_BIAS.finnhub;
    if (s.indexOf('polygon') !== -1) return PRIORITY_BIAS.polygon;
    if (s.indexOf('alpaca') !== -1) return PRIORITY_BIAS.alpaca;
    if (s.indexOf('tradier') !== -1) return PRIORITY_BIAS.tradier;
    if (s.indexOf('coinbase') !== -1 && s.indexOf('refresh') !== -1) return PRIORITY_BIAS['coinbase-refresh'];
    if (s.indexOf('coinbase') !== -1) return PRIORITY_BIAS.coinbase;
    if (s.indexOf('stooq') !== -1 && s.indexOf('refresh') !== -1) return PRIORITY_BIAS['stooq-refresh'];
    if (s.indexOf('stooq') !== -1) return PRIORITY_BIAS.stooq;
    if (s.indexOf('mock') !== -1) return PRIORITY_BIAS.mock;
    return 0.10;  // unknown source: low neutral
  }

  function reliabilityFor(source) {
    // Per-source success-rate from DataReliability (last ~50 fetches)
    if (!source || typeof window === 'undefined' || !window.DataReliability) return 0.5;
    try {
      const h = window.DataReliability.sourceHealth(source);
      if (!h || !h.hasData) return 0.5;
      const r = (typeof h.recentSuccessRate === 'number') ? h.recentSuccessRate : (typeof h.lifetimeSuccessRate === 'number' ? h.lifetimeSuccessRate : 0.5);
      return Math.max(0, Math.min(1, r));
    } catch (e) { return 0.5; }
  }

  function agreementFor(source) {
    // Average agreement rate this source has with peers across all symbols.
    // Computed from CrossSourceCheck.allAgreements() — for now we just return
    // an aggregate. (Per-symbol agreement is also available if needed.)
    if (typeof window === 'undefined' || !window.CrossSourceCheck) return 0.85;
    try {
      const all = window.CrossSourceCheck.allAgreements();
      if (!all || all.length === 0) return 0.85;
      // We don't have per-source breakdown here, so use the overall symbol
      // agreement as a proxy. (A more granular version would extend CrossSourceCheck.)
      const avg = all.reduce((s, a) => s + (a.agreementScore != null ? a.agreementScore : 1), 0) / all.length;
      return Math.max(0, Math.min(1, avg));
    } catch (e) { return 0.85; }
  }

  function latencyFor(source) {
    // Inverse-latency component. <500ms = 1.0, 3000ms = 0.5, 8000ms+ = 0.1
    if (!source || typeof window === 'undefined' || !window.DataReliability) return 0.8;
    try {
      const h = window.DataReliability.sourceHealth(source);
      if (!h || !h.hasData || typeof h.avgLatencyMs !== 'number') return 0.8;
      const l = h.avgLatencyMs;
      if (l <= 0) return 0.8;
      if (l < 500) return 1.0;
      if (l > 8000) return 0.1;
      return Math.max(0.1, 1.0 - (l - 500) / 7500 * 0.9);
    } catch (e) { return 0.8; }
  }

  function rank(source) {
    // Composite: 0.35 priority + 0.35 reliability + 0.20 agreement + 0.10 latency
    const p = priorityFor(source);
    const r = reliabilityFor(source);
    const a = agreementFor(source);
    const l = latencyFor(source);
    const score = 0.35 * (p / 0.30) + 0.35 * r + 0.20 * a + 0.10 * l;
    return Math.max(0, Math.min(1, score));
  }

  function compare(srcA, srcB) {
    const ra = rank(srcA);
    const rb = rank(srcB);
    if (ra > rb + TIEBREAKER_MARGIN) return +1;
    if (rb > ra + TIEBREAKER_MARGIN) return -1;
    return 0;
  }

  function shouldOverwrite(symbol, newSource) {
    if (typeof window === 'undefined' || !window.QUOTES || !window.QUOTES[symbol]) return true;
    const q = window.QUOTES[symbol];
    const currentSource = q.priceSource || q.source;
    const currentTs = q.liveAt || q.ts || 0;
    // No current canonical → accept anything.
    if (!currentSource) return true;
    // Current is stale → accept anything fresh.
    if (Date.now() - currentTs > FRESHNESS_MS) return true;
    // Same source → always accept (just an update from same provider).
    if (currentSource === newSource) return true;
    // Compare rankings. Allow if new is at least as good (within tiebreak).
    return compare(newSource, currentSource) >= 0;
  }

  function preferred(symbol) {
    // For introspection: look at what's been recorded recently for this symbol
    // via CrossSourceCheck and rank the candidates.
    if (typeof window === 'undefined' || !window.CrossSourceCheck) return null;
    // CrossSourceCheck doesn't expose per-symbol recent sources cleanly;
    // we infer from the disagreements log if any, plus current quote.
    if (window.QUOTES && window.QUOTES[symbol]) {
      const q = window.QUOTES[symbol];
      const src = q.priceSource || q.source;
      return { source: src, score: rank(src) };
    }
    return null;
  }

  function allRanks() {
    // Best-effort: pull all known sources from DataReliability.allHealth().perSource
    const out = [];
    if (typeof window !== 'undefined' && window.DataReliability && typeof window.DataReliability.allHealth === 'function') {
      try {
        const all = window.DataReliability.allHealth();
        if (all && all.perSource) {
          for (const srcName in all.perSource) {
            const src = srcName;
            out.push({
              source: src,
              score: rank(src),
              components: {
                priority: priorityFor(src),
                reliability: reliabilityFor(src),
                agreement: agreementFor(src),
                latency: latencyFor(src)
              }
            });
          }
        }
      } catch (e) {}
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  window.SourcePreference = { rank, compare, shouldOverwrite, preferred, allRanks, PRIORITY_BIAS, FRESHNESS_MS, TIEBREAKER_MARGIN };
})();
