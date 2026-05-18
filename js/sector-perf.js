/* ===========================================
   BPLEONE — Per-Sector Performance Tracker
   ---
   Aggregates per-symbol resolutions into sector buckets. SPY/QQQ/IWM go
   into 'index', NVDA/AMD into 'semi', etc.

   Returns BSS + Sharpe + win rate per sector + a multiplier in [0.5, 1.2]
   that the UnifiedPredictor can apply to size based on sector edge.

   The sector mapping is identical to SymbolBias's so the same fallback
   transfer behavior (NVDA informs AMD) applies here.

   Exposes:
     SectorPerf.sectorOf(symbol) → sector name
     SectorPerf.record(symbol, predProb, label, signedReturn)
     SectorPerf.stats(sector?, window=200) → per-sector stats or all
     SectorPerf.sizeMultiplier(sector?) → number in [0.5, 1.2]
     SectorPerf.leaderboard(window=200) → sorted
     SectorPerf.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_sector_perf_v1';
  const MAX_PER_SECTOR = 500;
  const DEFAULT_WINDOW = 200;
  const MIN_TO_SCORE = 15;

  // Sector mapping (same as SymbolBias for consistent transfer behavior)
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

  function sectorOf(symbol) {
    return SECTORS[symbol] || 'other';
  }

  function load() {
    if (typeof localStorage === 'undefined') return { bySector: {} };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { bySector: {} };
    } catch (e) { return { bySector: {} }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function record(symbol, predProb, label, signedReturn) {
    if (!symbol || typeof predProb !== 'number') return;
    if (label !== 0 && label !== 1) return;
    const sector = sectorOf(symbol);
    const state = load();
    if (!state.bySector[sector]) state.bySector[sector] = [];
    state.bySector[sector].push({
      sym: symbol,
      p: +predProb.toFixed(4),
      y: label,
      r: (typeof signedReturn === 'number' && isFinite(signedReturn))
        ? Math.max(-0.5, Math.min(0.5, +signedReturn.toFixed(6)))
        : null,
      t: Date.now()
    });
    if (state.bySector[sector].length > MAX_PER_SECTOR) {
      state.bySector[sector] = state.bySector[sector].slice(-MAX_PER_SECTOR);
    }
    save(state);
  }

  function computeSector(rows) {
    const n = rows.length;
    if (n < MIN_TO_SCORE) {
      return { n, accuracy: null, brier: null, skill: null, winRate: null, sharpe: null, annSharpe: null, ready: false };
    }
    let correct = 0, brierSum = 0, wins = 0;
    const rets = [];
    const baseRate = rows.reduce((s, r) => s + r.y, 0) / n;
    let brierBaseline = 0;
    for (const r of rows) {
      const dir = r.p >= 0.5 ? 1 : 0;
      if (dir === r.y) correct++;
      brierSum += (r.p - r.y) * (r.p - r.y);
      brierBaseline += (baseRate - r.y) * (baseRate - r.y);
      if (r.y === 1) wins++;
      if (typeof r.r === 'number') rets.push(r.r);
    }
    brierBaseline /= n;
    const brier = brierSum / n;
    const skill = brierBaseline > 0 ? 1 - brier / brierBaseline : 0;
    const accuracy = correct / n;
    const winRate = wins / n;
    let sharpe = null, annSharpe = null;
    if (rets.length >= MIN_TO_SCORE) {
      const meanR = rets.reduce((s, v) => s + v, 0) / rets.length;
      const varR = rets.reduce((s, v) => s + (v - meanR) * (v - meanR), 0) / Math.max(1, rets.length - 1);
      const stdR = Math.sqrt(varR);
      sharpe = stdR > 1e-10 ? meanR / stdR : 0;
      // Audit pass 68: was sqrt(23400) (10-min periods) but callers feed
      // DAILY returns. Inflated annSharpe by 9.6×. Use 252 trading days/year.
      annSharpe = sharpe * Math.sqrt(252);
    }
    return { n, accuracy, brier, skill, winRate, sharpe, annSharpe, baseRate, ready: true };
  }

  function stats(sector, window) {
    if (!window) window = DEFAULT_WINDOW;
    const state = load();
    if (sector) {
      const rows = (state.bySector[sector] || []).slice(-window);
      return computeSector(rows);
    }
    const out = {};
    for (const s in state.bySector) {
      out[s] = computeSector(state.bySector[s].slice(-window));
    }
    return out;
  }

  function sizeMultiplier(sector) {
    if (!sector) return 1.0;
    const s = stats(sector);
    if (!s.ready || s.accuracy == null) return 1.0;
    const edge = s.accuracy - 0.5;
    let m = 1.0 + edge * 2.0;
    return Math.max(0.5, Math.min(1.2, m));
  }

  function leaderboard(window) {
    if (!window) window = DEFAULT_WINDOW;
    const all = stats(null, window);
    const out = [];
    for (const sec in all) {
      out.push({ sector: sec, ...all[sec] });
    }
    out.sort((a, b) => {
      if (a.skill == null) return 1;
      if (b.skill == null) return -1;
      return b.skill - a.skill;
    });
    return out;
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.SectorPerf = {
    sectorOf,
    record,
    stats,
    sizeMultiplier,
    leaderboard,
    reset,
    SECTORS,
    MIN_TO_SCORE
  };
})();
