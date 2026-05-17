/* ===========================================
   BPLEONE — Risk-of-Ruin Monte Carlo
   ---
   Runs N independent simulated "careers" of K trades each, using the brain's
   empirical win rate + avg R-multiple win/loss, and tells you:

     - P(ruin) at various drawdown levels (-25%, -50%, -75%)
     - Distribution of ending bankroll values (p5, p25, p50, p75, p95)
     - Probability of doubling, 5x, 10x
     - Worst-case max drawdown across all sims

   Defaults come from MoneyTracker (real brain stats). Brandon can override
   any param to stress-test scenarios:
     - "What if win rate drops to 45%?"
     - "What if I sized 5% instead of 2%?"
     - "What if I take 500 trades a year?"

   The math:
     Each trade: prob WIN = winRate, payout = avgWin (in R)
                 prob LOSS = 1-winRate, payout = -avgLoss (in R)
     Position dollar risk = bankroll × riskPct (per trade)
     Bankroll updates: B_new = B + dollarRisk × R
     If bankroll ever <= 0 → 'ruined' (cap loss at -1R, so true ruin
       requires roughly 1/riskPct consecutive losses)

   Exposes:
     RiskMonteCarlo.run({ ... }) -> { sims, p5/p25/p50/p75/p95, pRuin, pDouble, ... }
     RiskMonteCarlo.defaults() -> auto-derived params from MoneyTracker if loaded
   =========================================== */

(function () {
  const DEFAULT_SIMS = 1000;
  const DEFAULT_TRADES_PER_SIM = 250;

  // Mulberry32 deterministic RNG factory
  function rngFactory(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function defaults() {
    // Pull empirical stats from MoneyTracker if available
    const out = {
      bankroll: 10000,
      riskPct: 0.02,        // 2% per trade
      winRate: 0.55,        // baseline
      avgWinR: 1.8,
      avgLossR: 1.0,
      tradesPerSim: DEFAULT_TRADES_PER_SIM,
      sims: DEFAULT_SIMS,
      seed: 12345
    };
    if (typeof window !== 'undefined' && window.MoneyTracker) {
      try {
        const s = window.MoneyTracker.summary();
        if (!s.empty && s.windows && s.windows.lifetime && s.windows.lifetime.totalTrades > 0) {
          const w = s.windows.lifetime;
          if (w.winRate != null) out.winRate = Math.max(0.30, Math.min(0.85, w.winRate));
          // avgWin / avgLoss are dollars; convert to R using risk per trade
          // Approximate: riskDollars = bankroll * 0.02 * average confMult ≈ bankroll * 0.012
          const riskDollars = s.config.bankroll * s.config.riskPct;
          if (w.avgWin > 0 && riskDollars > 0) out.avgWinR = Math.max(0.5, Math.min(5, w.avgWin / riskDollars));
          if (w.avgLoss > 0 && riskDollars > 0) out.avgLossR = Math.max(0.5, Math.min(2, w.avgLoss / riskDollars));
        }
      } catch (e) {}
    }
    return out;
  }

  function run(opts) {
    const cfg = Object.assign(defaults(), opts || {});
    const rand = rngFactory(cfg.seed | 0);
    const sims = [];
    let ruinCount = 0;
    let dd25Count = 0, dd50Count = 0, dd75Count = 0;
    let doubleCount = 0, fiveXCount = 0, tenXCount = 0;
    let worstDD = 0;
    const endingValues = [];

    for (let s = 0; s < cfg.sims; s++) {
      let bankroll = cfg.bankroll;
      let peak = bankroll;
      let maxDD = 0;
      let ruined = false;
      for (let i = 0; i < cfg.tradesPerSim; i++) {
        const dollarRisk = bankroll * cfg.riskPct;
        const r = rand();
        let R;
        if (r < cfg.winRate) R = cfg.avgWinR;
        else R = -cfg.avgLossR;
        bankroll += dollarRisk * R;
        if (bankroll > peak) peak = bankroll;
        const dd = (peak - bankroll) / peak;
        if (dd > maxDD) maxDD = dd;
        if (bankroll <= 0.001 * cfg.bankroll) { ruined = true; bankroll = 0; break; }
      }
      sims.push({ ending: +bankroll.toFixed(2), maxDD: +maxDD.toFixed(4), ruined });
      endingValues.push(bankroll);
      if (ruined) ruinCount++;
      if (maxDD >= 0.25) dd25Count++;
      if (maxDD >= 0.50) dd50Count++;
      if (maxDD >= 0.75) dd75Count++;
      if (bankroll >= 2 * cfg.bankroll) doubleCount++;
      if (bankroll >= 5 * cfg.bankroll) fiveXCount++;
      if (bankroll >= 10 * cfg.bankroll) tenXCount++;
      if (maxDD > worstDD) worstDD = maxDD;
    }
    endingValues.sort((a, b) => a - b);
    function pct(p) {
      const idx = Math.max(0, Math.min(endingValues.length - 1, Math.floor(p * endingValues.length)));
      return +endingValues[idx].toFixed(2);
    }
    const median = pct(0.50);
    const mean = +(endingValues.reduce((s, v) => s + v, 0) / endingValues.length).toFixed(2);
    return {
      config: cfg,
      sims: cfg.sims,
      tradesPerSim: cfg.tradesPerSim,
      pRuin: ruinCount / cfg.sims,
      pDD25: dd25Count / cfg.sims,
      pDD50: dd50Count / cfg.sims,
      pDD75: dd75Count / cfg.sims,
      pDouble: doubleCount / cfg.sims,
      p5x: fiveXCount / cfg.sims,
      p10x: tenXCount / cfg.sims,
      worstDD: +worstDD.toFixed(4),
      endingMean: mean,
      endingMedian: median,
      endingP5: pct(0.05),
      endingP25: pct(0.25),
      endingP75: pct(0.75),
      endingP95: pct(0.95),
      bestSim: +endingValues[endingValues.length - 1].toFixed(2),
      worstSim: +endingValues[0].toFixed(2)
    };
  }

  window.RiskMonteCarlo = { run, defaults };
})();
