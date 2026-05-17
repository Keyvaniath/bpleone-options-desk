/* ===========================================
   BPLEONE — Live Position Correlation
   ---
   Checks how correlated your open auto-trades are RIGHT NOW. If you
   have NVDA + AMD + SMCI all long, they're ~0.85 correlated — that's
   essentially one concentrated semis bet, not three independent ideas.

   Uses the same sector correlation matrix as portfolio-allocator.js:
     same-symbol: 0.8
     crypto-crypto: 0.85
     vol vs anything: -0.6
     same sector: 0.8
     default cross: 0.5

   Returns:
     - Pairwise correlation matrix for open positions
     - N_eff (effective independent positions): (Σw)² / Σ(wᵢwⱼρᵢⱼ)
     - Concentration score (1 = perfectly diversified, 0 = all same bet)
     - Sector concentration breakdown

   Exposes:
     PositionCorrelation.snapshot() -> { positions, matrix, n_eff, score, sectors }
     PositionCorrelation.recommendations() -> string[]
   =========================================== */

(function () {
  // Sector mapping (matches portfolio-allocator)
  const SECTORS = {
    NVDA: 'semi', AMD: 'semi', SMCI: 'semi', AVGO: 'semi', INTC: 'semi',
    AAPL: 'mega-tech', MSFT: 'mega-tech', GOOGL: 'mega-tech', AMZN: 'mega-tech', META: 'mega-tech',
    TSLA: 'auto-tech', RIVN: 'auto-tech',
    PLTR: 'software', CRM: 'software', SHOP: 'software',
    COIN: 'crypto-stocks', MARA: 'crypto-stocks',
    BABA: 'china', FXI: 'china', MCHI: 'china',
    UBER: 'gig',
    SPY: 'broad-index', QQQ: 'broad-index', IWM: 'broad-index', DIA: 'broad-index',
    XLE: 'energy', USO: 'energy', UNG: 'energy',
    GLD: 'metals', SLV: 'metals', DBA: 'commod-soft',
    BTC: 'crypto', ETH: 'crypto',
    VIX: 'vol',
    TLT: 'bonds'
  };

  function sectorOf(sym) { return SECTORS[sym] || 'misc'; }

  function correlation(a, b) {
    if (a === b) return 1.0;
    const sa = sectorOf(a);
    const sb = sectorOf(b);
    if ((sa === 'vol') !== (sb === 'vol')) return -0.6;
    if (sa === 'crypto' && sb === 'crypto') return 0.85;
    if (sa === sb) return 0.8;
    if ((sa === 'broad-index' || sb === 'broad-index') && sa !== sb) return 0.7;
    if ((sa === 'metals' && sb === 'metals')) return 0.85;
    if ((sa === 'bonds') !== (sb === 'bonds')) return -0.2;
    return 0.5;
  }

  function snapshot() {
    if (typeof window === 'undefined' || !window.AutoTrade) return { positions: [], matrix: [], n_eff: 0, score: null, sectors: {} };
    const open = window.AutoTrade.openTrades();
    if (open.length === 0) return { positions: [], matrix: [], n_eff: 0, score: null, sectors: {} };
    const positions = open.map(t => ({
      sym: t.sym,
      sector: sectorOf(t.sym),
      direction: t.direction,
      riskDollars: t.riskDollars || 0
    }));
    // Build weights (signed by direction)
    const weights = positions.map(p => (p.direction || 1) * (p.riskDollars || 0));
    const totalAbs = positions.reduce((s, p) => s + Math.abs(p.riskDollars || 0), 0) || 1;
    // Build pairwise matrix
    const matrix = [];
    for (let i = 0; i < positions.length; i++) {
      const row = [];
      for (let j = 0; j < positions.length; j++) {
        // Sign-adjust correlation: opposite directions flip sign
        const sameDir = positions[i].direction === positions[j].direction;
        const c = correlation(positions[i].sym, positions[j].sym);
        row.push(sameDir ? c : -c);
      }
      matrix.push(row);
    }
    // N_eff = (Σwᵢ)² / Σᵢⱼ wᵢwⱼ ρᵢⱼ
    // Use absolute weights for diversification
    const wAbs = positions.map(p => Math.abs(p.riskDollars || 0));
    const sumW = wAbs.reduce((s, w) => s + w, 0) || 1;
    let denom = 0;
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        denom += wAbs[i] * wAbs[j] * matrix[i][j];
      }
    }
    const n_eff = denom > 0 ? +((sumW * sumW) / denom).toFixed(2) : 0;
    const score = positions.length > 0 ? +Math.min(1, n_eff / positions.length).toFixed(2) : null;
    // Sector breakdown
    const sectors = {};
    positions.forEach(p => {
      const s = p.sector;
      if (!sectors[s]) sectors[s] = { count: 0, totalRisk: 0, symbols: [] };
      sectors[s].count++;
      sectors[s].totalRisk += Math.abs(p.riskDollars || 0);
      sectors[s].symbols.push(p.sym + (p.direction > 0 ? '+' : '-'));
    });
    Object.values(sectors).forEach(s => { s.share = totalAbs > 0 ? s.totalRisk / totalAbs : 0; });
    return { positions, matrix, n_eff, score, sectors, totalRiskDollars: +totalAbs.toFixed(2) };
  }

  function recommendations() {
    const s = snapshot();
    const rec = [];
    if (s.positions.length === 0) return rec;
    if (s.score != null && s.score < 0.5 && s.positions.length >= 3) {
      rec.push('⚠ Concentration alert: ' + s.positions.length + ' positions but only ' + s.n_eff + ' effective. You\'re betting on fewer themes than you think.');
    }
    // Sector concentration
    for (const sec in s.sectors) {
      if (s.sectors[sec].share > 0.6 && s.sectors[sec].count >= 2) {
        rec.push('🎯 ' + (s.sectors[sec].share * 100).toFixed(0) + '% of risk in ' + sec + ' (' + s.sectors[sec].symbols.join(', ') + '). Consider trimming or hedging.');
      }
    }
    if (s.score != null && s.score >= 0.85) {
      rec.push('✅ Well diversified: ' + s.n_eff + ' effective positions, score ' + (s.score * 100).toFixed(0) + '%.');
    }
    return rec;
  }

  window.PositionCorrelation = { snapshot, recommendations, correlation, sectorOf };
})();
