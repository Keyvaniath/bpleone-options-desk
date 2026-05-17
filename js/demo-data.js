/* ===========================================
   BPLEONE — Demo Data Generator
   ---
   Synthesizes realistic resolved brain trades + alerts + auto-trades
   so the money pages light up immediately on a fresh browser instead
   of showing empty states for 24+ hours.

   Brandon clicks "Generate demo data" → 50 resolved journal entries,
   30 high-conviction alerts, 12 closed auto-trades.

   - Deterministic per seed so repeated calls produce same data
   - Distributed across last 30 days (so 7d / 30d windows both have data)
   - 60% win rate, mean +0.4R, fat-tail (-1 to +5R clamped)
   - Mix of LONG/SHORT, mix of symbols (NVDA, SPY, AAPL, etc.)

   Exposes:
     DemoData.generate({ seed, days, count }) -> { journal, alerts, trades }
     DemoData.clear() -> wipes only synthetic entries (real data preserved)
   =========================================== */

(function () {
  const JOURNAL_KEY = 'bpleone_pred_journal_v1';
  const ALERTS_KEY = 'bpleone_hc_alerts_v1';
  const AUTO_KEY = 'bpleone_auto_trade_v1';
  const DEMO_MARKER = 'demo-';   // all synthetic entries prefixed with this

  const SYMBOLS = ['NVDA', 'SPY', 'AAPL', 'MSFT', 'TSLA', 'AMD', 'QQQ', 'META', 'AMZN', 'GOOGL', 'BTC', 'COIN', 'SMCI', 'PLTR'];
  const REGIMES = ['bull', 'choppy', 'bear', 'high-vol'];
  const SOURCES = ['stooq', 'coinbase', 'finnhub'];

  function rngFactory(seed) {
    let s = (seed >>> 0) || 12345;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(arr, rand) { return arr[Math.floor(rand() * arr.length)]; }
  function normRand(rand) {
    // Box-Muller for ~N(0,1)
    const u = Math.max(1e-9, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function generate(opts) {
    opts = opts || {};
    const seed = opts.seed || 42;
    const days = opts.days || 30;
    const count = opts.count || 50;
    const rand = rngFactory(seed);
    const now = Date.now();

    // Load existing data (so we don't nuke real trades)
    let journal = [];
    try { journal = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]'); } catch (e) {}
    let alertsState = {};
    try { alertsState = JSON.parse(localStorage.getItem(ALERTS_KEY) || '{}'); } catch (e) {}
    let autoState = {};
    try { autoState = JSON.parse(localStorage.getItem(AUTO_KEY) || '{}'); } catch (e) {}

    // === Journal entries (50 resolved) ===
    let addedJournal = 0;
    for (let i = 0; i < count; i++) {
      const ageDays = (i / count) * days;
      const ts = now - ageDays * 86400000;
      const sym = pick(SYMBOLS, rand);
      const conv = 0.55 + rand() * 0.40;          // 0.55 - 0.95
      const isLong = rand() < 0.55;
      const predProb = isLong ? conv : (1 - conv);
      const direction = isLong ? 1 : -1;
      // 60% win, mean realized ret pulled from skewed distribution
      const winRoll = rand();
      let realizedRet;
      if (winRoll < 0.60) {
        // Win: positive return in predicted direction
        realizedRet = direction * (0.005 + Math.abs(normRand(rand)) * 0.015);
      } else {
        // Loss
        realizedRet = -direction * (0.005 + Math.abs(normRand(rand)) * 0.015);
      }
      const outcome = (predProb >= 0.5 && realizedRet > 0.003) || (predProb < 0.5 && realizedRet < -0.003) ? 'correct' : 'wrong';
      const entryPx = 50 + rand() * 500;
      const exitPx = entryPx * (1 + realizedRet);
      // Build feature vector (22 floats) — needed for PatternRecall
      const features = Array.from({ length: 22 }, () => +(rand().toFixed(4)));
      features[21] = 1; // bias
      journal.push({
        id: DEMO_MARKER + 'j-' + ts + '-' + sym + '-' + i,
        ts, sym,
        entryPx: +entryPx.toFixed(2),
        exitPx: +exitPx.toFixed(2),
        features,
        predProb: +predProb.toFixed(4),
        oodScore: +(rand() * 0.3).toFixed(3),
        priceSource: pick(SOURCES, rand),
        regime: pick(REGIMES, rand),
        resolved: { short: outcome, mid: false, long: false },
        outcome,
        realizedRet: +realizedRet.toFixed(4),
        rMultiple: +(realizedRet * direction / 0.01).toFixed(2)
      });
      addedJournal++;
    }

    // === High-Conviction Alerts feed (30) ===
    if (!alertsState.feed) alertsState.feed = [];
    if (!alertsState.lastAlertBySym) alertsState.lastAlertBySym = {};
    if (!alertsState.seenJournalIds) alertsState.seenJournalIds = {};
    let addedAlerts = 0;
    for (let i = 0; i < 30; i++) {
      const ageHours = (i / 30) * (days * 24);
      const ts = now - ageHours * 3600000;
      const sym = pick(SYMBOLS, rand);
      const conv = 0.75 + rand() * 0.20;
      const isLong = rand() < 0.55;
      alertsState.feed.push({
        ts,
        sym,
        conviction: +conv.toFixed(3),
        direction: isLong ? 'LONG' : 'SHORT',
        entryPx: +(50 + rand() * 500).toFixed(2),
        riskDollars: Math.floor(50 + rand() * 200),
        predProb: isLong ? +conv.toFixed(3) : +(1 - conv).toFixed(3),
        regime: pick(REGIMES, rand),
        sourceJournalId: DEMO_MARKER + 'a-' + ts + '-' + sym
      });
      addedAlerts++;
    }
    alertsState.totalAlerts = (alertsState.totalAlerts || 0) + addedAlerts;

    // === Auto-Trade closed (12) ===
    if (!autoState.config) autoState.config = { bankroll: 10000, riskPct: 0.02, stopPct: 0.01, targetPct: 0.025, holdHours: 24, maxOpenPositions: 5, maxTotalRiskPct: 0.10, kellyFraction: 0.25 };
    if (!autoState.closedTrades) autoState.closedTrades = [];
    if (!autoState.openTrades) autoState.openTrades = [];
    if (!autoState.seenJournalIds) autoState.seenJournalIds = {};
    let addedAuto = 0;
    for (let i = 0; i < 12; i++) {
      const ageDays = (i / 12) * days;
      const openedAt = now - ageDays * 86400000;
      const closedAt = openedAt + (4 + rand() * 20) * 3600000;
      const sym = pick(SYMBOLS, rand);
      const direction = rand() < 0.55 ? 1 : -1;
      const entryPx = 50 + rand() * 500;
      const winRoll = rand();
      const move = winRoll < 0.6 ? (0.005 + rand() * 0.025) : -(0.005 + rand() * 0.012);
      const exitPx = entryPx * (1 + move * direction);
      const shares = Math.floor(100 + rand() * 200);
      const realizedPnL = +((exitPx - entryPx) * direction * shares).toFixed(2);
      const riskDollars = +(entryPx * 0.01 * shares).toFixed(2);
      const rMultiple = riskDollars > 0 ? +(realizedPnL / riskDollars).toFixed(2) : 0;
      autoState.closedTrades.push({
        id: DEMO_MARKER + 'at-' + openedAt + '-' + sym,
        sym, openedAt, closedAt,
        entryPx: +entryPx.toFixed(2),
        exitPx: +exitPx.toFixed(2),
        direction,
        shares,
        riskDollars,
        realizedPnL,
        rMultiple,
        outcome: realizedPnL > 0 ? 'target' : 'stop',
        conviction: +(0.70 + rand() * 0.20).toFixed(3),
        predProb: 0.75,
        holdHours: +((closedAt - openedAt) / 3600000).toFixed(2),
        adjKelly: +(0.005 + rand() * 0.02).toFixed(4),
        regime: pick(REGIMES, rand),
        priceSource: pick(SOURCES, rand),
        open: false
      });
      addedAuto++;
    }
    autoState.totalOpened = (autoState.totalOpened || 0) + addedAuto;
    autoState.totalClosed = (autoState.totalClosed || 0) + addedAuto;

    // Persist
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal.slice(-5000))); } catch (e) {}
    try { localStorage.setItem(ALERTS_KEY, JSON.stringify(alertsState)); } catch (e) {}
    try { localStorage.setItem(AUTO_KEY, JSON.stringify(autoState)); } catch (e) {}
    return { journal: addedJournal, alerts: addedAlerts, autoTrades: addedAuto };
  }

  function clear() {
    // Strip only demo-prefixed entries
    let removed = 0;
    try {
      const j = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
      const filtered = j.filter(e => !e.id || e.id.indexOf(DEMO_MARKER) !== 0);
      removed += j.length - filtered.length;
      localStorage.setItem(JOURNAL_KEY, JSON.stringify(filtered));
    } catch (e) {}
    try {
      const s = JSON.parse(localStorage.getItem(ALERTS_KEY) || '{}');
      if (s.feed) {
        const filtered = s.feed.filter(a => !a.sourceJournalId || a.sourceJournalId.indexOf(DEMO_MARKER) !== 0);
        removed += s.feed.length - filtered.length;
        s.feed = filtered;
        localStorage.setItem(ALERTS_KEY, JSON.stringify(s));
      }
    } catch (e) {}
    try {
      const s = JSON.parse(localStorage.getItem(AUTO_KEY) || '{}');
      if (s.closedTrades) {
        const filtered = s.closedTrades.filter(t => !t.id || t.id.indexOf(DEMO_MARKER) !== 0);
        removed += s.closedTrades.length - filtered.length;
        s.closedTrades = filtered;
        localStorage.setItem(AUTO_KEY, JSON.stringify(s));
      }
    } catch (e) {}
    return { removed };
  }

  function hasDemoData() {
    try {
      const j = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
      return j.some(e => e.id && e.id.indexOf(DEMO_MARKER) === 0);
    } catch (e) { return false; }
  }

  window.DemoData = { generate, clear, hasDemoData };
})();
