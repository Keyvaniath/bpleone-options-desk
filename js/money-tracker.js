/* ===========================================
   BPLEONE — Money Tracker (simulated P&L from brain signals)
   ---
   Brandon wants to know one number: "If I followed the brain's signals,
   how much money would I have made?"

   This module walks the ContinuousLearner journal
   (bpleone_pred_journal_v1) — every resolved short-horizon prediction —
   and computes simulated P&L assuming:

     - Fixed bankroll (default $10,000) — configurable
     - Risk-per-trade = bankroll × riskPct × confidenceMult
       confidenceMult = (predProb - 0.5) × 2 (so 0.6 = 0.2, 0.75 = 0.5, 0.9 = 0.8)
     - For each resolved trade:
         pnl = riskDollars × (realizedRet / stopRetAssumption)
       where stopRetAssumption defaults to 1% (a typical day stop).
       Win caps at riskDollars × 5 (trail-stops typically cap upside at 5R).

   Aggregates over 7d / 30d / 90d / lifetime. Computes:
     - Total $ P&L
     - # trades, win rate, avg win, avg loss
     - Max consecutive losses, max drawdown
     - Best/worst single trade
     - Per-symbol contribution (top 5 winners, top 5 losers)

   Exposes:
     MoneyTracker.summary(bankroll?, riskPct?) -> full snapshot
     MoneyTracker.bySymbol(window?) -> per-symbol P&L
     MoneyTracker.equityCurve(window?) -> [{ts, equity}]
     MoneyTracker.window(days?) -> filtered journal
     MoneyTracker.config(opts) / .getConfig()
   =========================================== */

(function () {
  const JOURNAL_KEY = 'bpleone_pred_journal_v1';
  const CONFIG_KEY = 'bpleone_money_tracker_v1';

  const DEFAULTS = {
    bankroll: 10000,
    riskPct: 0.02,
    // Pass 218g: stopRetAssumption widened to 2.5% to match the 5d-horizon
    // auto-trade default (was 0.01 = 1% which was the 24h-hold assumption).
    // Without this fix the rMultiple math undercounted full-stops: a 2% loss
    // on a 2.5% stop should be -0.8R, but at stopRet=0.01 was -2R (clamped
    // to -1R). Backward-compat: realizedRet pre-pass-218 still came from
    // short-horizon resolutions which capped at smaller moves anyway.
    stopRetAssumption: 0.025,  // 2.5% adverse move = full stop (5d horizon)
    maxRMultiple: 5,            // trail caps at 5R upside
    minConvictionToTrade: 0.55  // skip predictions below this
  };

  function loadJournal() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const j = localStorage.getItem(JOURNAL_KEY);
      return j ? JSON.parse(j) : [];
    } catch (e) { return []; }
  }

  function loadConfig() {
    if (typeof localStorage === 'undefined') return Object.assign({}, DEFAULTS);
    try {
      const j = localStorage.getItem(CONFIG_KEY);
      if (!j) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(j));
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }

  function saveConfig(c) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch (e) {}
  }

  function config(opts) {
    const merged = Object.assign(loadConfig(), opts || {});
    saveConfig(merged);
    return merged;
  }
  function getConfig() { return loadConfig(); }

  // Filter journal to entries resolved at the brain's prediction horizon
  // (MID = 5d post-pass-218) with realizedRet set. Backward-compat: also
  // accept short-horizon resolutions for legacy journal entries that
  // pre-date pass 218 — their realizedRet was set on short resolve.
  function resolvedEntries(journal) {
    return (journal || []).filter(e => {
      if (!e || !e.ts) return false;
      const r = e.resolved;
      if (!r) return false;
      const isResolved = r === true
        || (r.mid && r.mid !== false && r.mid !== 'flat')
        || (r.short && r.short !== false && r.short !== 'flat');
      return isResolved && typeof e.realizedRet === 'number' && typeof e.predProb === 'number';
    });
  }

  function windowFilter(entries, days) {
    if (!days) return entries.slice();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return entries.filter(e => e.ts >= cutoff);
  }

  function pnlForEntry(entry, cfg) {
    const conf = entry.predProb;
    if (conf < cfg.minConvictionToTrade && (1 - conf) < cfg.minConvictionToTrade) return null;
    const direction = conf >= 0.5 ? +1 : -1;        // long if >0.5, short if <0.5
    const confMult = Math.max(0, (Math.abs(conf - 0.5)) * 2);  // 0.5 -> 0, 1.0 -> 1.0
    const riskDollars = cfg.bankroll * cfg.riskPct * Math.max(0.2, confMult);
    // P&L in units of stop loss:
    //  ret>0 and long  -> + |ret|/stopRet R
    //  ret<0 and long  -> -|ret|/stopRet R, clamped at -1R (stop hits)
    //  ret>0 and short -> -|ret|/stopRet R, clamped at -1R
    //  ret<0 and short -> + |ret|/stopRet R
    const rRaw = (entry.realizedRet * direction) / cfg.stopRetAssumption;
    const r = Math.max(-1, Math.min(cfg.maxRMultiple, rRaw));
    const pnl = riskDollars * r;
    return { pnl, riskDollars, rMultiple: r, direction, confMult };
  }

  function summaryForEntries(entries, cfg) {
    const trades = [];
    let cum = 0;
    let peakEquity = 0;
    let maxDD = 0;
    let winCount = 0, lossCount = 0;
    let totalWin = 0, totalLoss = 0;
    let bestTrade = null, worstTrade = null;
    let consecLosses = 0, maxConsecLosses = 0;
    const symPnL = {};

    // Sort by ts ascending for equity curve / drawdown
    const sorted = entries.slice().sort((a, b) => a.ts - b.ts);
    for (const e of sorted) {
      const p = pnlForEntry(e, cfg);
      if (!p) continue;
      cum += p.pnl;
      peakEquity = Math.max(peakEquity, cum);
      const dd = peakEquity - cum;
      if (dd > maxDD) maxDD = dd;
      if (p.pnl > 0) {
        winCount++; totalWin += p.pnl;
        consecLosses = 0;
      } else if (p.pnl < 0) {
        lossCount++; totalLoss += -p.pnl;
        consecLosses++;
        if (consecLosses > maxConsecLosses) maxConsecLosses = consecLosses;
      }
      if (!bestTrade || p.pnl > bestTrade.pnl) bestTrade = { sym: e.sym, ts: e.ts, pnl: p.pnl, rMultiple: p.rMultiple, predProb: e.predProb };
      if (!worstTrade || p.pnl < worstTrade.pnl) worstTrade = { sym: e.sym, ts: e.ts, pnl: p.pnl, rMultiple: p.rMultiple, predProb: e.predProb };
      symPnL[e.sym] = (symPnL[e.sym] || 0) + p.pnl;
      trades.push({ ts: e.ts, sym: e.sym, pnl: p.pnl, rMultiple: p.rMultiple, cum });
    }
    const totalTrades = winCount + lossCount;
    const winRate = totalTrades > 0 ? winCount / totalTrades : null;
    const avgWin = winCount > 0 ? totalWin / winCount : 0;
    const avgLoss = lossCount > 0 ? totalLoss / lossCount : 0;
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? Infinity : null);
    const expectancy = totalTrades > 0 ? cum / totalTrades : 0;

    return {
      totalPnL: +cum.toFixed(2),
      totalTrades, winCount, lossCount,
      winRate, avgWin: +avgWin.toFixed(2), avgLoss: +avgLoss.toFixed(2),
      profitFactor, expectancy: +expectancy.toFixed(2),
      maxDrawdown: +maxDD.toFixed(2),
      maxConsecLosses, peakEquity: +peakEquity.toFixed(2),
      bestTrade, worstTrade,
      symPnL,
      trades: trades.slice(-100),       // last 100 for charting
      asOfMs: Date.now()
    };
  }

  function summary(opts) {
    const cfg = Object.assign(loadConfig(), opts || {});
    const journal = loadJournal();
    const entries = resolvedEntries(journal);
    if (entries.length === 0) {
      return {
        config: cfg,
        empty: true,
        windows: { d7: null, d30: null, d90: null, lifetime: null }
      };
    }
    return {
      config: cfg,
      empty: false,
      totalJournalEntries: journal.length,
      resolvedShortCount: entries.length,
      windows: {
        d7: summaryForEntries(windowFilter(entries, 7), cfg),
        d30: summaryForEntries(windowFilter(entries, 30), cfg),
        d90: summaryForEntries(windowFilter(entries, 90), cfg),
        lifetime: summaryForEntries(entries, cfg)
      }
    };
  }

  function bySymbol(days, opts) {
    const cfg = Object.assign(loadConfig(), opts || {});
    const entries = windowFilter(resolvedEntries(loadJournal()), days);
    const sum = summaryForEntries(entries, cfg);
    const out = [];
    for (const sym in sum.symPnL) {
      out.push({ sym, pnl: +sum.symPnL[sym].toFixed(2) });
    }
    out.sort((a, b) => b.pnl - a.pnl);
    return out;
  }

  function equityCurve(days, opts) {
    const cfg = Object.assign(loadConfig(), opts || {});
    const entries = windowFilter(resolvedEntries(loadJournal()), days);
    const sum = summaryForEntries(entries, cfg);
    return sum.trades.map(t => ({ ts: t.ts, equity: +t.cum.toFixed(2) }));
  }

  function windowFn(days) {
    return windowFilter(resolvedEntries(loadJournal()), days);
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(CONFIG_KEY);
  }

  window.MoneyTracker = {
    summary, bySymbol, equityCurve, window: windowFn,
    config, getConfig, reset, DEFAULTS
  };
})();
