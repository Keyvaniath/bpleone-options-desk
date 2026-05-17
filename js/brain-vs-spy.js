/* ===========================================
   BPLEONE — Brain vs SPY benchmark
   ---
   "Is the brain better than just buying SPY and holding?"

   For a fair comparison this module:
     1. Walks the MoneyTracker simulated trades — uses the same Kelly sizing
     2. Takes the cumulative timeline of brain trades [t1, t2, ...]
     3. Builds a parallel SPY-buy-and-hold timeline using QUOTES['SPY']
        - Same starting bankroll
        - SPY return between two timestamps computed from QUOTES['SPY'].last
          (if no real historical bars present, falls back to constant
          1.0x baseline so this still renders without erroring)
     4. Compares: brain final value vs SPY final value, alpha, max DD, Sharpe-like

   For accurate SPY backfill we read from window.bpleone_spy_history if set
   by historical-bootstrap (it captures 60d of bars). Otherwise we use a
   placeholder of stable SPY at last.

   Exposes:
     BrainVsSpy.compare(window?) -> { brainPnL, spyPnL, alpha, finalBrain, finalSpy, curves }
     BrainVsSpy.alpha(window?) -> alpha number
   =========================================== */

(function () {
  const SPY_HISTORY_KEY = 'bpleone_spy_history_v1';

  function loadSpyBars() {
    if (typeof localStorage === 'undefined') return null;
    try {
      const j = localStorage.getItem(SPY_HISTORY_KEY);
      return j ? JSON.parse(j) : null;
    } catch (e) { return null; }
  }

  // Locate SPY close price closest to ts (within tolerance window)
  function spyPriceAt(ts, bars) {
    if (!bars || !bars.length) return null;
    // bars: [{ts, close}, ...] sorted ascending
    let best = null;
    let bestDiff = Infinity;
    for (let i = 0; i < bars.length; i++) {
      const d = Math.abs(bars[i].ts - ts);
      if (d < bestDiff) { bestDiff = d; best = bars[i]; }
    }
    // Tolerance: 7 days
    if (bestDiff > 7 * 24 * 60 * 60 * 1000) return null;
    return best.close;
  }

  function currentSpyPx() {
    if (typeof window === 'undefined' || !window.QUOTES || !window.QUOTES.SPY) return null;
    return window.QUOTES.SPY.last || null;
  }

  function compare(days) {
    if (typeof window === 'undefined' || !window.MoneyTracker) {
      return { error: 'MoneyTracker not loaded' };
    }
    const cfg = window.MoneyTracker.getConfig();
    const bankroll = cfg.bankroll || 10000;
    const summary = window.MoneyTracker.summary();
    if (summary.empty) {
      return { empty: true, bankroll, reason: 'no-brain-trades' };
    }
    const winKey = days ? (days <= 7 ? 'd7' : days <= 30 ? 'd30' : 'd90') : 'lifetime';
    const w = summary.windows[winKey];
    if (!w || w.totalTrades === 0) {
      return { empty: true, bankroll, reason: 'no-trades-in-window-' + winKey };
    }

    // Brain equity curve: trades is already cumulative
    const brainCurve = w.trades.map(t => ({ ts: t.ts, equity: bankroll + t.cum }));
    const finalBrain = brainCurve.length ? brainCurve[brainCurve.length - 1].equity : bankroll;
    const brainReturn = (finalBrain - bankroll) / bankroll;

    // SPY equity: buy at start with full bankroll, mark-to-market at each brain trade ts
    const bars = loadSpyBars();
    const spyNow = currentSpyPx();
    let spyCurve = [];
    let spyFinal = bankroll;
    if (brainCurve.length > 0 && spyNow) {
      const startTs = brainCurve[0].ts;
      const spyStart = spyPriceAt(startTs, bars) || spyNow;
      if (spyStart > 0) {
        const shares = bankroll / spyStart;
        for (const pt of brainCurve) {
          const px = spyPriceAt(pt.ts, bars) || spyNow;
          spyCurve.push({ ts: pt.ts, equity: +(shares * px).toFixed(2) });
        }
        spyFinal = +(shares * spyNow).toFixed(2);
      }
    }
    const spyReturn = (spyFinal - bankroll) / bankroll;
    const alpha = brainReturn - spyReturn;

    // Max DD on brain
    let peak = bankroll, maxDD = 0;
    for (const pt of brainCurve) {
      if (pt.equity > peak) peak = pt.equity;
      if (peak - pt.equity > maxDD) maxDD = peak - pt.equity;
    }
    // Sharpe-ish: mean return per trade / std
    const tradePcts = w.trades.map(t => t.pnl / bankroll);
    let mean = 0, std = 0;
    if (tradePcts.length > 1) {
      mean = tradePcts.reduce((s, v) => s + v, 0) / tradePcts.length;
      const variance = tradePcts.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (tradePcts.length - 1);
      std = Math.sqrt(variance);
    }
    const sharpish = std > 0 ? +(mean / std * Math.sqrt(252)).toFixed(2) : null;

    return {
      bankroll,
      window: winKey,
      brainCurve, spyCurve,
      finalBrain: +finalBrain.toFixed(2),
      finalSpy: +spyFinal.toFixed(2),
      brainReturn: +brainReturn.toFixed(4),
      spyReturn: +spyReturn.toFixed(4),
      alpha: +alpha.toFixed(4),
      brainMaxDD: +maxDD.toFixed(2),
      sharpish,
      tradeCount: w.totalTrades,
      brainWinRate: w.winRate,
      hasRealSpyBars: !!(bars && bars.length > 0)
    };
  }

  function alpha(days) {
    const c = compare(days);
    return c && c.alpha != null ? c.alpha : null;
  }

  window.BrainVsSpy = { compare, alpha };
})();
