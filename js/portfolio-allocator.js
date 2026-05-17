/* ===========================================
   BPLEONE — Multi-Position Portfolio Allocator
   ---
   When 3 high-conviction A-tier signals fire at once (NVDA + TSLA + SPY
   all looking strong), the naive answer is to size each at full Kelly.
   But that ignores correlation — all three could lose together (broad
   market drawdown), so you'd risk much more than you intend.

   This module solves the problem by:
     1. Computing each candidate's solo Kelly fraction
     2. Estimating correlation between symbols (sector + market proxy)
     3. Scaling each position down based on portfolio variance budget
     4. Enforcing total-risk cap (default 10% bankroll at risk)
     5. Preferring less-correlated picks when budget is tight

   Inputs:
     candidates = [
       { sym, prob, winR, lossR, uncertainty?, agreementTier?, conformalHw? },
       ...
     ]
     bankroll
     options = { maxTotalRiskPct: 0.10, maxSinglePct: 0.05, maxPositions: 5 }

   Output:
     allocations = [
       { sym, kelly, dollarsRisk, shares, weightInPortfolio, included },
       ...
     ]
     totalRisk = sum of dollarsRisk
     diversificationScore = effective # independent bets

   Uses ConfidenceKelly for the underlying per-trade sizing.

   Exposes:
     PortfolioAllocator.allocate(candidates, bankroll, opts?)
     PortfolioAllocator.summary(allocations) → { totalRisk, diversification, positions }
   =========================================== */

(function () {
  const DEFAULT_MAX_TOTAL_RISK = 0.10;  // 10% of bankroll at risk total
  const DEFAULT_MAX_SINGLE = 0.05;       // 5% per single trade
  const DEFAULT_MAX_POSITIONS = 5;

  // Rough sector mapping for correlation estimates. Same symbols in same
  // sector are highly correlated (0.8). Different sectors moderate (0.4).
  // Mega-tech vs anything is moderate (0.5). Crypto vs equity is low (0.2).
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

  function sectorOf(s) { return SECTORS[s] || 'other'; }

  // Estimate correlation between two symbols. Crude but effective:
  //   - Same symbol: 1.0 (shouldn't happen — dedup before)
  //   - Same sector: 0.8
  //   - Both index, both equity-related: 0.7
  //   - Crypto vs crypto: 0.85 (BTC + ETH highly correlated)
  //   - Crypto vs equity: 0.2 (mostly uncorrelated)
  //   - VIX/vol vs anything: -0.6 (inverse relationship)
  //   - Energy vs tech: 0.2 (low)
  //   - Default cross-sector: 0.5
  function correlate(symA, symB) {
    if (symA === symB) return 1.0;
    const a = sectorOf(symA), b = sectorOf(symB);
    if (a === b) return 0.8;
    if ((a === 'vol') !== (b === 'vol')) return -0.6;
    const cryptoA = (a === 'crypto' || a === 'crypto-equity');
    const cryptoB = (b === 'crypto' || b === 'crypto-equity');
    if (cryptoA && cryptoB) return 0.85;
    if (cryptoA !== cryptoB) return 0.2;
    const indexA = (a === 'index');
    const indexB = (b === 'index');
    if (indexA || indexB) return 0.7;  // index correlates with most equities
    if (a === 'metals' || b === 'metals') return 0.2;
    if (a === 'energy' || b === 'energy') return 0.3;
    return 0.5;
  }

  function allocate(candidates, bankroll, opts) {
    opts = opts || {};
    const maxTotalRisk = (opts.maxTotalRiskPct != null) ? opts.maxTotalRiskPct : DEFAULT_MAX_TOTAL_RISK;
    const maxSingle = (opts.maxSinglePct != null) ? opts.maxSinglePct : DEFAULT_MAX_SINGLE;
    const maxPositions = opts.maxPositions || DEFAULT_MAX_POSITIONS;

    if (!Array.isArray(candidates) || candidates.length === 0 || bankroll <= 0) {
      return { allocations: [], totalRisk: 0, totalRiskPct: 0, diversificationScore: 0 };
    }
    if (typeof window === 'undefined' || !window.ConfidenceKelly) {
      return { allocations: [], totalRisk: 0, totalRiskPct: 0, diversificationScore: 0, error: 'ConfidenceKelly not loaded' };
    }

    // Step 1: compute each candidate's solo confidence-Kelly size
    const sized = candidates.map(c => {
      const k = window.ConfidenceKelly.size({
        prob: c.prob,
        winR: c.winR,
        lossR: c.lossR,
        bankroll,
        uncertaintyStd: c.uncertainty,
        agreementTier: c.agreementTier,
        conformalHw: c.conformalHw,
        sourceName: c.sourceName,
        riskPerShare: c.riskPerShare
      });
      return Object.assign({}, c, { soloKelly: k.adjKelly, soloDollars: k.dollarsRisk, breakdown: k.breakdown });
    });

    // Step 2: rank by solo Kelly descending and take top-N
    sized.sort((a, b) => b.soloKelly - a.soloKelly);
    let included = sized.filter(c => c.soloKelly > 0).slice(0, maxPositions);

    if (included.length === 0) {
      return { allocations: sized.map(c => Object.assign(c, { included: false, kelly: 0, dollarsRisk: 0, shares: 0 })),
               totalRisk: 0, totalRiskPct: 0, diversificationScore: 0 };
    }

    // Step 3: compute total raw Kelly (if we took every solo position as-is)
    let totalRaw = included.reduce((s, c) => s + c.soloKelly, 0);

    // Step 4: compute correlation-adjusted variance.
    // Effective independent bets N_eff = (sum w)^2 / sum(w_i × w_j × ρ_ij)
    // The more correlated, the lower N_eff. We scale down accordingly.
    let varTotal = 0;
    for (let i = 0; i < included.length; i++) {
      for (let j = 0; j < included.length; j++) {
        const rho = correlate(included[i].sym, included[j].sym);
        varTotal += included[i].soloKelly * included[j].soloKelly * rho;
      }
    }
    const wSum = totalRaw;
    const nEff = varTotal > 0 ? (wSum * wSum) / varTotal : 1;
    // Diversification mult: low nEff → scale down because correlated
    const divMult = Math.min(1, Math.sqrt(nEff / included.length));

    // Step 5: scale each position by correlation factor + total-risk cap
    const totalRiskCap = maxTotalRisk;
    let finalTotal = totalRaw * divMult;
    let capMult = 1.0;
    if (finalTotal > totalRiskCap) {
      capMult = totalRiskCap / finalTotal;
    }

    const allocations = sized.map(c => {
      if (!included.includes(c)) {
        return Object.assign({}, c, { included: false, kelly: 0, dollarsRisk: 0, shares: 0, weightInPortfolio: 0 });
      }
      const k = Math.min(maxSingle, c.soloKelly * divMult * capMult);
      const dollars = bankroll * k;
      const riskPerShare = c.riskPerShare || c.lossR || 1;
      const shares = Math.floor(dollars / riskPerShare);
      return Object.assign({}, c, {
        included: true,
        kelly: k,
        dollarsRisk: dollars,
        shares,
        weightInPortfolio: finalTotal > 0 ? (k / finalTotal) : 0
      });
    });

    const totalRisk = allocations.filter(a => a.included).reduce((s, a) => s + a.dollarsRisk, 0);

    return {
      allocations,
      totalRisk,
      totalRiskPct: bankroll > 0 ? totalRisk / bankroll : 0,
      diversificationScore: nEff,
      capMult,
      divMult,
      maxTotalRisk: totalRiskCap
    };
  }

  function summary(result) {
    if (!result || !result.allocations) return null;
    const included = result.allocations.filter(a => a.included);
    return {
      positionCount: included.length,
      totalRisk: result.totalRisk,
      totalRiskPct: result.totalRiskPct,
      diversificationScore: result.diversificationScore,
      symbols: included.map(a => a.sym).join(', ')
    };
  }

  window.PortfolioAllocator = {
    allocate,
    summary,
    correlate,
    sectorOf,
    DEFAULT_MAX_TOTAL_RISK,
    DEFAULT_MAX_SINGLE,
    DEFAULT_MAX_POSITIONS
  };
})();
