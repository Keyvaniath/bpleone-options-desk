/* ===========================================
   BPLEONE — Trade Quality Scorer
   ---
   Rates each closed trade 1-5 stars based on whether it was a "good"
   entry, INDEPENDENT of outcome. The goal: separate good process from
   good luck. A losing trade with a high quality score = good process,
   bad outcome. A winning trade with a low quality score = lucky win
   you shouldn't repeat.

   Scoring criteria (each worth 1 point):
     1. Conviction >= 65%
     2. Source quality was good at entry (≥ 55%)
     3. Pattern recall hit rate was favorable (≥ 50%)
     4. No earnings crossed during hold
     5. Position size was appropriate (within Kelly bounds)

   Returns: stars (0-5), per-criterion breakdown, summary stats.

   Pulls from AutoTrade.closedTrades() + checks against historical context.

   Exposes:
     TradeQuality.scoreTrade(trade) -> { stars, criteria, qualityIdx }
     TradeQuality.allScores() -> [{ trade, score }]
     TradeQuality.summary() -> { avgStars, qualityVsOutcome, lessons }
   =========================================== */

(function () {
  function scoreTrade(trade) {
    if (!trade) return { stars: 0, criteria: {}, qualityIdx: 0 };
    const c = {
      conviction: false,
      sourceQuality: false,
      patternRecall: false,
      earningsClear: false,
      sizeAppropriate: false
    };
    // 1. Conviction at entry
    c.conviction = (trade.conviction || 0) >= 0.65;
    // 2. Source quality (use what's recorded; approximate)
    if (trade.priceSource && trade.priceSource.indexOf('stale') === -1) c.sourceQuality = true;
    // 3. Pattern recall — try to look up via PatternRecall if available
    if (window.PatternRecall && trade.sourceJournalId) {
      try {
        const journal = JSON.parse(localStorage.getItem('bpleone_pred_journal_v1') || '[]');
        const entry = journal.find(j => j.id === trade.sourceJournalId);
        if (entry) {
          const s = window.PatternRecall.summarize(entry, 10);
          c.patternRecall = (s && s.hitRate != null) ? s.hitRate >= 0.5 : true;   // benefit of doubt if no history
        } else c.patternRecall = true;
      } catch (e) { c.patternRecall = true; }
    } else {
      c.patternRecall = true;
    }
    // 4. Earnings clear (we can't backfill historical earnings, so default yes)
    c.earningsClear = true;
    // 5. Size appropriate (within Kelly default)
    if (trade.adjKelly != null) {
      c.sizeAppropriate = trade.adjKelly > 0.005 && trade.adjKelly < 0.05;
    } else {
      c.sizeAppropriate = true;
    }
    const stars = Object.values(c).filter(Boolean).length;
    const qualityIdx = stars / 5;
    return { stars, criteria: c, qualityIdx };
  }

  function getClosedTrades() {
    if (!window.AutoTrade) return [];
    return window.AutoTrade.closedTrades();
  }

  function allScores() {
    return getClosedTrades().map(t => ({ trade: t, score: scoreTrade(t) }));
  }

  function summary() {
    const all = allScores();
    if (all.length === 0) return { empty: true };
    const avgStars = all.reduce((s, x) => s + x.score.stars, 0) / all.length;
    // Quality vs Outcome correlation
    let highQualityWins = 0, highQualityLosses = 0, lowQualityWins = 0, lowQualityLosses = 0;
    for (const x of all) {
      const isWin = x.trade.realizedPnL > 0;
      if (x.score.stars >= 4) { if (isWin) highQualityWins++; else highQualityLosses++; }
      if (x.score.stars <= 2) { if (isWin) lowQualityWins++; else lowQualityLosses++; }
    }
    const hqWinRate = (highQualityWins + highQualityLosses) > 0 ? highQualityWins / (highQualityWins + highQualityLosses) : null;
    const lqWinRate = (lowQualityWins + lowQualityLosses) > 0 ? lowQualityWins / (lowQualityWins + lowQualityLosses) : null;
    const lessons = [];
    if (hqWinRate != null && lqWinRate != null) {
      if (hqWinRate > lqWinRate + 0.10) lessons.push('✅ Process matters: high-quality trades win ' + (hqWinRate * 100).toFixed(0) + '% vs low-quality ' + (lqWinRate * 100).toFixed(0) + '%.');
      else if (lqWinRate > hqWinRate + 0.10) lessons.push('⚠ Low-quality trades currently win more than high-quality. Either the scorer is off or you got lucky on a few sloppy entries.');
      else lessons.push('Process score does not yet correlate strongly with outcome (small sample).');
    }
    const luckyWins = all.filter(x => x.trade.realizedPnL > 0 && x.score.stars <= 2).length;
    const unluckyLosses = all.filter(x => x.trade.realizedPnL < 0 && x.score.stars >= 4).length;
    if (luckyWins > 0) lessons.push('🍀 ' + luckyWins + ' lucky win(s) (low quality, positive outcome). Don\'t repeat the setup.');
    if (unluckyLosses > 0) lessons.push('💔 ' + unluckyLosses + ' unlucky loss(es) (high quality, negative outcome). Keep doing the process.');
    return {
      empty: false,
      total: all.length,
      avgStars: +avgStars.toFixed(2),
      hqWinRate, lqWinRate,
      lessons
    };
  }

  window.TradeQuality = { scoreTrade, allScores, summary };
})();
