/* ===========================================
   BPLEONE — Streak Tracker
   ---
   Walks resolved trades chronologically and computes:
     - Current streak (positive = wins in a row, negative = losses)
     - Longest winning streak
     - Longest losing streak
     - Days since last loss
     - Best day, worst day, by date
     - Recovery: how long after biggest loss to make it back?
     - 7-day rolling win rate trend

   Pulls from MoneyTracker trades (which uses confidence-weighted P&L).

   The mental-game scoring intentionally surfaces both wins AND losses
   — so the trader can recognize tilt risk and stay disciplined.

   Exposes:
     StreakTracker.snapshot() -> { currentStreak, longestWin, longestLoss, ... }
     StreakTracker.trend(days=14) -> daily win-rate over window
   =========================================== */

(function () {
  function getTrades() {
    if (typeof window === 'undefined' || !window.MoneyTracker) return [];
    try {
      const s = window.MoneyTracker.summary();
      if (s.empty || !s.windows || !s.windows.lifetime) return [];
      return (s.windows.lifetime.trades || []).slice().sort((a, b) => a.ts - b.ts);
    } catch (e) { return []; }
  }

  function snapshot() {
    const trades = getTrades();
    if (trades.length === 0) return { empty: true };
    let currentStreak = 0;
    let longestWin = 0, longestLoss = 0;
    let inStreak = 0;     // sign
    let runLen = 0;
    let lastLossTs = null, lastWinTs = null;
    let biggestLoss = null, biggestWin = null;
    for (const t of trades) {
      const sign = t.pnl > 0 ? 1 : (t.pnl < 0 ? -1 : 0);
      if (sign === 0) continue;
      if (sign === inStreak) {
        runLen++;
      } else {
        inStreak = sign;
        runLen = 1;
      }
      if (sign > 0 && runLen > longestWin) longestWin = runLen;
      if (sign < 0 && runLen > longestLoss) longestLoss = runLen;
      if (sign > 0) {
        lastWinTs = t.ts;
        if (!biggestWin || t.pnl > biggestWin.pnl) biggestWin = t;
      } else {
        lastLossTs = t.ts;
        if (!biggestLoss || t.pnl < biggestLoss.pnl) biggestLoss = t;
      }
    }
    currentStreak = inStreak * runLen;
    // Recovery: time from biggest loss to date when cum P&L returned to pre-loss level
    let recoveryHours = null;
    if (biggestLoss) {
      // Find ending equity index up to biggest loss
      let cum = 0, preLossCum = null;
      for (const t of trades) {
        if (t.ts === biggestLoss.ts) {
          preLossCum = cum;
          continue;
        }
      }
      // Recompute the cum and look for recovery
      cum = 0;
      let preLoss = null;
      for (const t of trades) {
        if (t.ts <= biggestLoss.ts) cum += t.pnl;
        else cum += t.pnl;
        if (t.ts === biggestLoss.ts) preLoss = cum - t.pnl;   // value before applying this loss
      }
      if (preLoss != null) {
        let postCum = 0;
        for (const t of trades) {
          if (t.ts < biggestLoss.ts) postCum += t.pnl;
        }
        // postCum equals preLoss before the loss
        let runCum = postCum;
        for (const t of trades) {
          if (t.ts <= biggestLoss.ts) continue;
          runCum += t.pnl;
          if (runCum >= preLoss) {
            recoveryHours = (t.ts - biggestLoss.ts) / (1000 * 60 * 60);
            break;
          }
        }
      }
    }
    return {
      empty: false,
      tradeCount: trades.length,
      currentStreak,
      longestWin, longestLoss,
      lastWinTs, lastLossTs,
      daysSinceLoss: lastLossTs ? (Date.now() - lastLossTs) / (24 * 60 * 60 * 1000) : null,
      daysSinceWin: lastWinTs ? (Date.now() - lastWinTs) / (24 * 60 * 60 * 1000) : null,
      biggestWin, biggestLoss,
      recoveryHours
    };
  }

  function trend(days) {
    days = days || 14;
    const trades = getTrades();
    if (trades.length === 0) return [];
    const out = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let d = days - 1; d >= 0; d--) {
      const day = new Date(today.getTime() - d * 86400000);
      const tomorrow = new Date(day.getTime() + 86400000);
      const dayTrades = trades.filter(t => t.ts >= day.getTime() && t.ts < tomorrow.getTime());
      const wins = dayTrades.filter(t => t.pnl > 0).length;
      const losses = dayTrades.filter(t => t.pnl < 0).length;
      const total = wins + losses;
      const pnl = dayTrades.reduce((s, t) => s + t.pnl, 0);
      out.push({
        date: day.toISOString().slice(0, 10),
        ts: day.getTime(),
        trades: dayTrades.length,
        winRate: total > 0 ? wins / total : null,
        wins, losses, pnl: +pnl.toFixed(2)
      });
    }
    return out;
  }

  // Mental-game messaging
  function mentalState(snap) {
    if (!snap || snap.empty) return { tier: 'idle', message: 'No resolved trades yet. Stay patient.', color: '#6b7280' };
    const cs = snap.currentStreak || 0;
    if (cs >= 5) return { tier: 'hot', message: '🔥 ' + cs + '-win streak. Stick to rules. Don\'t over-size.', color: '#10b981' };
    if (cs >= 3) return { tier: 'warm', message: '🌟 ' + cs + '-win streak. Keep doing what you\'re doing.', color: '#10b981' };
    if (cs <= -5) return { tier: 'cold-deep', message: '🧊 ' + (-cs) + '-loss streak. Step away. Reduce size 50% until 3 wins.', color: '#dc2626' };
    if (cs <= -3) return { tier: 'cold', message: '⚠ ' + (-cs) + '-loss streak. Pause. Review the last 3 setups before next entry.', color: '#f59e0b' };
    if (cs === 0) return { tier: 'neutral', message: 'No streak. Trade your plan.', color: '#00d4ff' };
    if (cs > 0) return { tier: 'mild-up', message: '✓ ' + cs + ' in a row. Keep going.', color: '#10b981' };
    return { tier: 'mild-down', message: '✗ ' + (-cs) + ' in a row. Trust the process.', color: '#f59e0b' };
  }

  window.StreakTracker = { snapshot, trend, mentalState };
})();
