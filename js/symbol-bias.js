/* ===========================================
   BPLEONE — Per-symbol bias terms (mixed-effects learning)
   ---
   The shared 22-feature model captures general market patterns. But each
   symbol has its own quirks the shared model can't see: institutional
   ownership, sector tendencies, options-flow patterns, etc.

   This module adds ONE learned offset per symbol that gets applied to
   the raw logit. The model becomes a "mixed-effects" predictor:

     final_logit = shared_logit + symbol_bias[sym]

   Where symbol_bias[sym] is learned independently per symbol via
   exponentially-weighted moving average of (label - shared_prediction).
   If the shared model tends to underestimate NVDA, NVDA's bias goes
   positive. If it overestimates TSLA, TSLA's bias goes negative.

   Sector transfer: when we don't have enough samples for a symbol's own
   bias, we fall back to the sector average bias. So NVDA's bias informs
   AMD before AMD has its own learned history.

   Exposes:
     SymbolBias.bias(sym) → number (default 0)
     SymbolBias.update(sym, label, predicted) → updates bias
     SymbolBias.applyToProb(sym, prob) → bias-adjusted probability
     SymbolBias.summary() → all tracked symbols + stats
   =========================================== */

(function () {
  const STORE_KEY = 'bpleone_symbol_bias_v1';
  const MIN_N_FOR_OWN_BIAS = 5;   // need 5 samples before using symbol's own bias
  const LR = 0.05;                  // bias learning rate
  const MAX_BIAS = 1.5;             // clamp to prevent runaway (logit scale)

  // Sector mapping for fallback transfer
  const SECTORS = {
    'AAPL':'mega-tech','MSFT':'mega-tech','GOOGL':'mega-tech','META':'mega-tech','AMZN':'mega-tech',
    'NVDA':'semi','AMD':'semi','SMCI':'semi',
    'TSLA':'auto','PLTR':'software','CRM':'software','SHOP':'software',
    'COIN':'crypto-equity','BTC':'crypto','ETH':'crypto',
    'SPY':'index','QQQ':'index','IWM':'index','DIA':'index',
    'XLE':'energy','GLD':'metals','SLV':'metals',
    'BABA':'china','UBER':'gig',
    'VIX':'vol','VXX':'vol'
  };

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function logit(p) {
    const eps = 1e-6;
    const c = Math.max(eps, Math.min(1 - eps, p));
    return Math.log(c / (1 - c));
  }
  function sigmoid(z) {
    z = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-z));
  }

  function getEntry(sym) {
    const store = loadStore();
    return store[sym] || { bias: 0, n: 0, lastTs: 0 };
  }

  function sectorAvgBias(sym) {
    const sector = SECTORS[sym];
    if (!sector) return 0;
    const store = loadStore();
    let sum = 0, count = 0;
    Object.keys(store).forEach(s => {
      if (SECTORS[s] === sector && store[s].n >= MIN_N_FOR_OWN_BIAS) {
        sum += store[s].bias;
        count++;
      }
    });
    return count > 0 ? sum / count : 0;
  }

  // Returns the bias to apply: own bias if mature, else sector fallback
  function bias(sym) {
    const entry = getEntry(sym);
    if (entry.n >= MIN_N_FOR_OWN_BIAS) return entry.bias;
    return sectorAvgBias(sym);
  }

  // Apply bias to a probability (operates in logit space)
  function applyToProb(sym, prob) {
    const b = bias(sym);
    if (b === 0) return prob;
    return sigmoid(logit(prob) + b);
  }

  // Update on a labeled outcome
  // label: 1 (win) or 0 (loss). predicted: model's predicted probability.
  function update(sym, label, predicted) {
    if (!sym || (label !== 0 && label !== 1) || typeof predicted !== 'number') return;
    const store = loadStore();
    if (!store[sym]) store[sym] = { bias: 0, n: 0, lastTs: 0 };
    const entry = store[sym];
    // The residual in logit space: how much would we need to shift the
    // logit to get from `predicted` to `label`?
    const targetLogit = logit(label === 1 ? 0.9 : 0.1);  // soft target (avoid extremes)
    const currentLogit = logit(predicted);
    const residual = targetLogit - currentLogit;
    // EMA update
    entry.bias = Math.max(-MAX_BIAS, Math.min(MAX_BIAS, entry.bias + LR * residual));
    entry.n++;
    entry.lastTs = Date.now();
    store[sym] = entry;
    saveStore(store);
  }

  function summary() {
    const store = loadStore();
    return Object.entries(store).map(([sym, e]) => ({
      sym,
      bias: e.bias,
      n: e.n,
      sector: SECTORS[sym] || 'unknown',
      sectorFallback: e.n < MIN_N_FOR_OWN_BIAS,
      effectiveBias: e.n >= MIN_N_FOR_OWN_BIAS ? e.bias : sectorAvgBias(sym),
      lastUpdate: e.lastTs
    })).sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias));
  }

  function reset(sym) {
    const store = loadStore();
    if (sym) delete store[sym];
    else Object.keys(store).forEach(k => delete store[k]);
    saveStore(store);
  }

  window.SymbolBias = {
    bias,
    applyToProb,
    update,
    summary,
    reset,
    SECTORS,
    MIN_N_FOR_OWN_BIAS,
    MAX_BIAS
  };
})();
