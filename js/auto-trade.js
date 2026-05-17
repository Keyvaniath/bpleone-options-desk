/* ===========================================
   BPLEONE — Auto-Trade Closed Loop
   ---
   When the brain fires a HIGH-CONVICTION signal (≥75% probability) with
   all gates passing, this module auto-opens a paper trade with
   ConfidenceKelly-sized position. Tracks each open trade against live
   QUOTES until stop, target, or time-stop hits. Records realized P&L.

   What counts as "all gates passing":
     - predProb >= MIN_CONVICTION (default 0.75)
     - source quality not stale (q.priceSource not 'stale-refresh', liveAt < 5min)
     - DataReliability says the symbol is not stale
     - No existing open auto-trade for this symbol (one-position-per-symbol)
     - Total open risk + new risk <= MAX_TOTAL_RISK_PCT * bankroll

   Each auto-trade:
     - entry = current quote.last when captured
     - direction = LONG if predProb >= 0.5, SHORT otherwise
     - stop = entry × (1 ± STOP_PCT)
     - target = entry × (1 ± TARGET_PCT)   (target_pct = stop_pct × R_MULTIPLE)
     - timeStop = ts + HOLD_HOURS hours
     - sizeShares from ConfidenceKelly given bankroll + conviction

   Closes when:
     - last <= stop (LONG) or last >= stop (SHORT) → outcome 'stop'
     - last >= target (LONG) or last <= target (SHORT) → outcome 'target'
     - now > timeStop → outcome 'time'

   Brandon must opt in (off by default) — toggled via AutoTrade.enable()/disable().
   Status persisted in localStorage. Polls every 15s.

   Exposes:
     AutoTrade.enable() / disable() / isEnabled()
     AutoTrade.config(opts) / getConfig()
     AutoTrade.openTrades() / closedTrades(window?)
     AutoTrade.stats(window?) -> { pnl, trades, winRate, ... }
     AutoTrade.tick() -> one polling round
     AutoTrade.reset()
   =========================================== */

(function () {
  const STATE_KEY = 'bpleone_auto_trade_v1';
  const JOURNAL_KEY = 'bpleone_pred_journal_v1';   // read brain captures from here
  const POLL_INTERVAL_MS = 15 * 1000;

  const DEFAULTS = {
    enabled: false,
    bankroll: 10000,
    minConviction: 0.75,
    stopPct: 0.01,         // 1% adverse = stop
    targetPct: 0.025,      // 2.5% favorable = target (2.5R)
    holdHours: 24,
    maxOpenPositions: 5,
    maxTotalRiskPct: 0.10, // 10% of bankroll
    kellyFraction: 0.25
  };

  function loadState() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(STATE_KEY);
      return j ? JSON.parse(j) : defaultState();
    } catch (e) { return defaultState(); }
  }
  function defaultState() {
    return {
      config: Object.assign({}, DEFAULTS),
      openTrades: [],
      closedTrades: [],
      lastJournalScanTs: 0,
      seenJournalIds: {},
      totalOpened: 0,
      totalClosed: 0
    };
  }
  function save(s) {
    if (typeof localStorage === 'undefined') return;
    try {
      // Cap closedTrades to most recent 500 to avoid bloat
      if (s.closedTrades && s.closedTrades.length > 500) s.closedTrades = s.closedTrades.slice(-500);
      // Cap seenJournalIds size (keep last 1000)
      const ids = Object.keys(s.seenJournalIds || {});
      if (ids.length > 1000) {
        const trimmed = {};
        ids.slice(-1000).forEach(k => { trimmed[k] = s.seenJournalIds[k]; });
        s.seenJournalIds = trimmed;
      }
      localStorage.setItem(STATE_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function loadJournal() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const j = localStorage.getItem(JOURNAL_KEY);
      return j ? JSON.parse(j) : [];
    } catch (e) { return []; }
  }

  function isEnabled() { return !!loadState().config.enabled; }
  function enable() { const s = loadState(); s.config.enabled = true; save(s); return s.config; }
  function disable() { const s = loadState(); s.config.enabled = false; save(s); return s.config; }

  function getConfig() { return loadState().config; }
  function config(opts) {
    const s = loadState();
    s.config = Object.assign(s.config, opts || {});
    save(s);
    return s.config;
  }

  function openTrades() { return loadState().openTrades.slice(); }
  function closedTrades(days) {
    const cls = loadState().closedTrades.slice();
    if (!days) return cls;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return cls.filter(t => (t.closedAt || t.openedAt) >= cutoff);
  }

  function stats(days) {
    const cls = closedTrades(days);
    let pnl = 0, wins = 0, losses = 0;
    let bestPnl = -Infinity, worstPnl = Infinity;
    let bestTrade = null, worstTrade = null;
    const symPnL = {};
    cls.forEach(t => {
      pnl += t.realizedPnL;
      if (t.realizedPnL > 0) wins++;
      else if (t.realizedPnL < 0) losses++;
      if (t.realizedPnL > bestPnl) { bestPnl = t.realizedPnL; bestTrade = t; }
      if (t.realizedPnL < worstPnl) { worstPnl = t.realizedPnL; worstTrade = t; }
      symPnL[t.sym] = (symPnL[t.sym] || 0) + t.realizedPnL;
    });
    const total = wins + losses;
    return {
      totalPnL: +pnl.toFixed(2),
      totalTrades: cls.length,
      wins, losses,
      winRate: total > 0 ? wins / total : null,
      bestTrade, worstTrade,
      symPnL,
      openCount: loadState().openTrades.length
    };
  }

  // Determine if a journal entry meets all open criteria
  function shouldOpen(entry, cfg, state) {
    if (!entry || !entry.sym || typeof entry.predProb !== 'number') return null;
    // Already opened from this journal id
    if (state.seenJournalIds[entry.id]) return null;
    // Conviction gate (LONG or SHORT)
    const conv = Math.max(entry.predProb, 1 - entry.predProb);
    if (conv < cfg.minConviction) return null;
    // OOD gate — if outlier, skip
    if (entry.oodScore && entry.oodScore > 0.6) return null;
    // Already have open trade for this symbol?
    if (state.openTrades.find(t => t.sym === entry.sym)) return null;
    // Position-count cap
    if (state.openTrades.length >= cfg.maxOpenPositions) return null;
    // Source quality gate: skip if price was sourced from a stale-refresh
    // path (we don't trust those for live entries).
    if (entry.priceSource && /stale/.test(entry.priceSource)) return null;
    // Check QUOTES still has a fresh price
    if (typeof window === 'undefined' || !window.QUOTES || !window.QUOTES[entry.sym]) return null;
    const q = window.QUOTES[entry.sym];
    if (!q.last || q.last <= 0) return null;
    if (q.liveAt && Date.now() - q.liveAt > 5 * 60 * 1000) return null;  // 5min stale
    // DataReliability: not stale?
    if (typeof window.DataReliability !== 'undefined') {
      try {
        const h = window.DataReliability.symbolHealth(entry.sym);
        if (h && h.stale) return null;
      } catch (e) {}
    }
    // OK to open. Use the entry price from the journal capture (matches what
    // the brain saw at prediction time) — Brandon could have clicked then.
    return entry.entryPx > 0 ? entry.entryPx : q.last;
  }

  // Compute Kelly-sized position from ConfidenceKelly module
  function sizeTrade(conv, entryPx, cfg) {
    if (typeof window === 'undefined' || !window.ConfidenceKelly) {
      // Fallback: simple 2% of bankroll risked
      const riskDollars = cfg.bankroll * 0.02;
      const stopDollars = entryPx * cfg.stopPct;
      const shares = Math.max(1, Math.floor(riskDollars / stopDollars));
      return { shares, riskDollars };
    }
    try {
      const sized = window.ConfidenceKelly.size({
        prob: conv,
        winR: cfg.targetPct,
        lossR: cfg.stopPct,
        bankroll: cfg.bankroll,
        entryPx: entryPx,
        fraction: cfg.kellyFraction
      });
      if (!sized || !sized.adjKelly) {
        // ConfidenceKelly might return adjKelly=0 if no edge
        return { shares: 0, riskDollars: 0, reason: sized && sized.reason };
      }
      // Convert adjKelly fraction to dollar risk, then to shares assuming stop
      const riskDollars = cfg.bankroll * sized.adjKelly;
      const stopDollars = entryPx * cfg.stopPct;
      const shares = Math.max(0, Math.floor(riskDollars / stopDollars));
      return { shares, riskDollars: +riskDollars.toFixed(2), adjKelly: sized.adjKelly };
    } catch (e) {
      return { shares: 0, riskDollars: 0, reason: 'sizing-error' };
    }
  }

  function openTrade(entry, entryPx, sized, cfg, state) {
    const direction = entry.predProb >= 0.5 ? +1 : -1;
    const trade = {
      id: 'at-' + Date.now() + '-' + entry.sym,
      sourceJournalId: entry.id,
      sym: entry.sym,
      openedAt: Date.now(),
      entryPx: entryPx,
      direction,
      shares: sized.shares,
      riskDollars: sized.riskDollars,
      predProb: entry.predProb,
      conviction: Math.max(entry.predProb, 1 - entry.predProb),
      stop: direction > 0 ? entryPx * (1 - cfg.stopPct) : entryPx * (1 + cfg.stopPct),
      target: direction > 0 ? entryPx * (1 + cfg.targetPct) : entryPx * (1 - cfg.targetPct),
      timeStop: Date.now() + cfg.holdHours * 60 * 60 * 1000,
      regime: entry.regime,
      priceSource: entry.priceSource,
      adjKelly: sized.adjKelly,
      open: true
    };
    state.openTrades.push(trade);
    state.seenJournalIds[entry.id] = Date.now();
    state.totalOpened++;
    return trade;
  }

  function closeTrade(trade, lastPx, reason, state) {
    trade.closedAt = Date.now();
    trade.exitPx = lastPx;
    trade.outcome = reason;
    const move = (lastPx - trade.entryPx) * trade.direction;
    trade.realizedPnL = +(move * trade.shares).toFixed(2);
    trade.realizedPct = trade.entryPx > 0 ? +(move / trade.entryPx * 100).toFixed(3) : 0;
    trade.rMultiple = trade.riskDollars > 0 ? +(trade.realizedPnL / trade.riskDollars).toFixed(2) : 0;
    trade.holdHours = +((trade.closedAt - trade.openedAt) / (1000 * 60 * 60)).toFixed(2);
    trade.open = false;
    // Remove from open, add to closed
    state.openTrades = state.openTrades.filter(t => t.id !== trade.id);
    state.closedTrades.push(trade);
    state.totalClosed++;
    return trade;
  }

  // One polling round
  function tick() {
    const state = loadState();
    const cfg = state.config;
    if (!cfg.enabled) return { skipped: true, reason: 'disabled' };
    let opened = 0, closed = 0;

    // 1) Try to open new trades from recent journal entries
    if (typeof window !== 'undefined' && window.QUOTES) {
      const journal = loadJournal();
      // Only consider recently-captured entries (last 5 min)
      const cutoff = Date.now() - 5 * 60 * 1000;
      const recent = journal.filter(e => e.ts >= cutoff);
      for (const entry of recent) {
        const entryPx = shouldOpen(entry, cfg, state);
        if (!entryPx) continue;
        const conv = Math.max(entry.predProb, 1 - entry.predProb);
        const sized = sizeTrade(conv, entryPx, cfg);
        if (sized.shares <= 0) {
          state.seenJournalIds[entry.id] = Date.now();   // mark as seen so we don't rescan
          continue;
        }
        // Risk budget check
        const newRisk = sized.riskDollars;
        const existingRisk = state.openTrades.reduce((s, t) => s + (t.riskDollars || 0), 0);
        if (existingRisk + newRisk > cfg.bankroll * cfg.maxTotalRiskPct) {
          state.seenJournalIds[entry.id] = Date.now();   // skip, mark seen
          continue;
        }
        openTrade(entry, entryPx, sized, cfg, state);
        opened++;
      }
    }

    // 2) Check open trades for stop/target/time
    if (typeof window !== 'undefined' && window.QUOTES) {
      const stillOpen = [];
      for (const t of state.openTrades) {
        const q = window.QUOTES[t.sym];
        if (!q || !q.last) { stillOpen.push(t); continue; }
        const last = q.last;
        // Stop hit?
        const stopHit = (t.direction > 0 && last <= t.stop) || (t.direction < 0 && last >= t.stop);
        const targetHit = (t.direction > 0 && last >= t.target) || (t.direction < 0 && last <= t.target);
        const timeStopHit = Date.now() >= t.timeStop;
        if (stopHit) { closeTrade(t, last, 'stop', state); closed++; }
        else if (targetHit) { closeTrade(t, last, 'target', state); closed++; }
        else if (timeStopHit) { closeTrade(t, last, 'time', state); closed++; }
        else stillOpen.push(t);
      }
      state.openTrades = stillOpen;
    }

    state.lastJournalScanTs = Date.now();
    save(state);
    return { opened, closed, openCount: state.openTrades.length };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STATE_KEY);
  }

  function autoStart() {
    if (typeof window === 'undefined') return;
    if (window._autoTradeTimer) return;
    window._autoTradeTimer = setInterval(() => { try { tick(); } catch (e) {} }, POLL_INTERVAL_MS);
  }

  window.AutoTrade = {
    enable, disable, isEnabled,
    config, getConfig,
    openTrades, closedTrades, stats,
    tick, reset, MIN_POLL_MS: POLL_INTERVAL_MS, DEFAULTS
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      autoStart();
    } else {
      document.addEventListener('DOMContentLoaded', autoStart);
    }
  }
})();
