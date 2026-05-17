/* ===========================================
   BPLEONE — Brain Backtester
   ---
   Re-runs the brain's resolved predictions through a configurable sizing
   model. Unlike MoneyTracker which uses one fixed strategy, the
   backtester sweeps strategy parameters so Brandon can find which one
   was best in hindsight:

     - bankroll
     - riskPct (1% / 2% / 3% / 5%)
     - minConviction filter (any / 0.6 / 0.7 / 0.8)
     - direction filter (LONG only / SHORT only / both)
     - symbol whitelist

   Returns: per-strategy P&L, # trades, win rate, Sharpe-ish.

   Source data: bpleone_pred_journal_v1 (same as MoneyTracker reads).

   Exposes:
     BrainBacktest.run(strategy) -> { pnl, trades, winRate, ... }
     BrainBacktest.grid({ riskPcts, minConvictions, ... }) -> [{strategy, result}, ...]
     BrainBacktest.bestParam(metric) -> top-scoring strategy
   =========================================== */

(function () {
  const JOURNAL_KEY = 'bpleone_pred_journal_v1';

  function loadResolved() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const journal = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
      return journal.filter(e => {
        if (!e || !e.ts || typeof e.predProb !== 'number' || typeof e.realizedRet !== 'number') return false;
        const r = e.resolved;
        return r && (r === true || (r.short && r.short !== false && r.short !== 'flat'));
      });
    } catch (e) { return []; }
  }

  function run(strategy) {
    const s = Object.assign({
      bankroll: 10000,
      riskPct: 0.02,
      stopRetAssumption: 0.01,
      maxRMultiple: 5,
      minConvictionToTrade: 0.55,
      directionFilter: 'both',     // 'long' | 'short' | 'both'
      symbolFilter: null,           // null = all, [] = none, [...] = whitelist
      windowDays: null              // null = all
    }, strategy || {});
    const cutoff = s.windowDays ? Date.now() - s.windowDays * 24 * 60 * 60 * 1000 : 0;
    const entries = loadResolved().filter(e => {
      if (e.ts < cutoff) return false;
      if (s.symbolFilter && Array.isArray(s.symbolFilter) && s.symbolFilter.length > 0 && s.symbolFilter.indexOf(e.sym) === -1) return false;
      const conv = Math.max(e.predProb, 1 - e.predProb);
      if (conv < s.minConvictionToTrade) return false;
      if (s.directionFilter === 'long' && e.predProb < 0.5) return false;
      if (s.directionFilter === 'short' && e.predProb >= 0.5) return false;
      return true;
    });
    let pnl = 0, wins = 0, losses = 0, peak = 0, maxDD = 0;
    const trades = [];
    for (const e of entries.sort((a, b) => a.ts - b.ts)) {
      const conv = Math.max(e.predProb, 1 - e.predProb);
      const direction = e.predProb >= 0.5 ? +1 : -1;
      const confMult = Math.max(0.2, Math.abs(e.predProb - 0.5) * 2);
      const riskDollars = s.bankroll * s.riskPct * confMult;
      const rRaw = (e.realizedRet * direction) / s.stopRetAssumption;
      const r = Math.max(-1, Math.min(s.maxRMultiple, rRaw));
      const tradePnL = riskDollars * r;
      pnl += tradePnL;
      if (tradePnL > 0) wins++; else if (tradePnL < 0) losses++;
      if (pnl > peak) peak = pnl;
      if (peak - pnl > maxDD) maxDD = peak - pnl;
      trades.push({ ts: e.ts, sym: e.sym, pnl: tradePnL, r, cum: pnl });
    }
    const totalTrades = wins + losses;
    const returns = trades.map(t => t.pnl / s.bankroll);
    let mean = 0, std = 0;
    if (returns.length > 1) {
      mean = returns.reduce((s, v) => s + v, 0) / returns.length;
      const variance = returns.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (returns.length - 1);
      std = Math.sqrt(variance);
    }
    const sharpish = std > 0 ? +(mean / std * Math.sqrt(252)).toFixed(2) : null;
    return {
      strategy: s,
      totalPnL: +pnl.toFixed(2),
      totalTrades,
      wins, losses,
      winRate: totalTrades > 0 ? wins / totalTrades : null,
      maxDrawdown: +maxDD.toFixed(2),
      sharpish,
      trades
    };
  }

  function grid(opts) {
    opts = opts || {};
    const riskPcts = opts.riskPcts || [0.01, 0.02, 0.03, 0.05];
    const minConvictions = opts.minConvictions || [0.55, 0.65, 0.75];
    const directionFilters = opts.directionFilters || ['both'];
    const base = opts.baseStrategy || {};
    const results = [];
    for (const r of riskPcts) {
      for (const c of minConvictions) {
        for (const d of directionFilters) {
          const s = Object.assign({}, base, { riskPct: r, minConvictionToTrade: c, directionFilter: d });
          results.push({ strategy: s, result: run(s) });
        }
      }
    }
    return results;
  }

  function bestParam(metric) {
    const all = grid();
    metric = metric || 'totalPnL';
    let best = null;
    for (const item of all) {
      if (!item.result) continue;
      const v = item.result[metric];
      if (v == null) continue;
      if (!best || v > best.result[metric]) best = item;
    }
    return best;
  }

  window.BrainBacktest = { run, grid, bestParam };
})();
