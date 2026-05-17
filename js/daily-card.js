/* ===========================================
   BPLEONE — Daily Auto-Summary Card
   ---
   At market close (16:00 ET), automatically captures a snapshot of the
   brain's state for that day. Stored as dated cards in localStorage so
   Brandon can browse a calendar of "what did the brain do today" /
   "what did it do last Tuesday."

   Each card captures:
     - Date (ET)
     - Total trades resolved that day
     - Win rate
     - Brier Skill Score
     - Annualized Sharpe
     - Current streak at end of day
     - Best / worst hour bucket
     - Top setup type
     - Drift / shift status
     - Brain health score
     - Notable alerts

   Auto-fire: a background interval checks every 10 minutes if it's after
   16:00 ET and a card for today hasn't been written yet. If so, generate
   and save.

   Manual trigger: DailyCard.generate() at any time to write today's card
   from current state.

   Exposes:
     DailyCard.generate() → card
     DailyCard.list() → array of all stored cards (newest first)
     DailyCard.load(dateStr) → specific card
     DailyCard.start() — kicks off the auto-fire loop
     DailyCard.reset()
   =========================================== */

(function () {
  const KEY_PREFIX = 'bpleone_daily_card_v1_';
  const INDEX_KEY = 'bpleone_daily_card_index_v1';
  const MARKET_CLOSE_MIN = 16 * 60; // 16:00 ET
  const POLL_MS = 10 * 60 * 1000; // 10 min

  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }

  function todayET() {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const map = {};
      for (const p of parts) map[p.type] = p.value;
      return map.year + '-' + map.month + '-' + map.day;
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function etMinNow() {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour12: false, hour: '2-digit', minute: '2-digit'
      }).formatToParts(new Date());
      let hh = 0, mm = 0;
      for (const p of parts) {
        if (p.type === 'hour') hh = parseInt(p.value, 10) % 24;
        if (p.type === 'minute') mm = parseInt(p.value, 10);
      }
      return hh * 60 + mm;
    } catch (e) { return new Date().getHours() * 60 + new Date().getMinutes(); }
  }

  function loadIndex() {
    if (typeof localStorage === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveIndex(idx) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch (e) {}
  }

  function loadCard(date) {
    if (typeof localStorage === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem(KEY_PREFIX + date) || 'null'); }
    catch (e) { return null; }
  }

  function saveCard(date, card) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(KEY_PREFIX + date, JSON.stringify(card));
      const idx = loadIndex();
      if (!idx.includes(date)) {
        idx.push(date);
        idx.sort();
        // Cap to last 90 days
        if (idx.length > 90) {
          for (const d of idx.slice(0, idx.length - 90)) {
            localStorage.removeItem(KEY_PREFIX + d);
          }
          idx.splice(0, idx.length - 90);
        }
        saveIndex(idx);
      }
    } catch (e) {}
  }

  function generate() {
    const date = todayET();
    const W = typeof window !== 'undefined' ? window : {};

    const card = { date, generatedAt: Date.now(), generatedBy: 'auto' };

    // Brain coach snapshot
    const bc = safe(() => W.BrainCoach && W.BrainCoach.summary(), null);
    if (bc) {
      card.healthScore = bc.healthScore;
      card.headline = bc.headline;
      card.warnCount = bc.warnCount;
      card.alertCount = bc.alertCount;
    }

    // Trades resolved today (count from BrierSkill log)
    const bss = safe(() => W.BrierSkill && W.BrierSkill.score(), null);
    if (bss && bss.ready) {
      card.bss = bss.skill;
      card.brierSampleSize = bss.n;
      card.baseRate = bss.baseRate;
    }

    // Sharpe
    const sh = safe(() => W.SharpeTracker && W.SharpeTracker.score(), null);
    if (sh && sh.ready) {
      card.sharpe = sh.annSharpe;
      card.meanReturn = sh.mean;
    }

    // Streak
    const dd = safe(() => W.DrawdownProtector && W.DrawdownProtector.stats(), null);
    if (dd) {
      card.currentStreak = dd.currentStreak;
      card.winRate = dd.winRate;
      card.totalTrades = dd.n;
    }

    // Best / worst hour
    const hp = safe(() => W.HourlyPerf && W.HourlyPerf.stats(), null);
    if (hp && hp.perBucket) {
      const buckets = Object.entries(hp.perBucket)
        .filter(([k, v]) => v.n >= 5 && v.edge != null)
        .sort((a, b) => b[1].edge - a[1].edge);
      if (buckets.length > 0) {
        card.bestHour = { bucket: buckets[0][0], edge: buckets[0][1].edge };
        card.worstHour = { bucket: buckets[buckets.length - 1][0], edge: buckets[buckets.length - 1][1].edge };
      }
    }

    // Top setup
    const st = safe(() => W.SetupTracker && W.SetupTracker.stats(), null);
    if (st && st.leaderboard && st.leaderboard[0]) {
      card.topSetup = { setup: st.leaderboard[0].setup, accuracy: st.leaderboard[0].accuracy, n: st.leaderboard[0].n };
    }

    // Drift status
    const psi = safe(() => W.DriftPSI && W.DriftPSI.status(), null);
    if (psi && typeof psi.psi === 'number') card.psi = psi.psi;
    const av = safe(() => W.AdversarialValidator && W.AdversarialValidator.score(), null);
    if (av) card.covariateShifted = av.shifted === true;

    // Trade trust
    const tt = safe(() => W.TradeTrust && W.TradeTrust.score(), null);
    if (tt) {
      card.trustScore = tt.score;
      card.trustTier = tt.tierLabel;
      card.activePenalties = tt.penalties.map(p => p.name);
    }

    // Volume
    const vt = safe(() => W.VolumeTracker && W.VolumeTracker.stats(), null);
    if (vt) {
      card.predictionsLastHour = vt.predictionsLastHour;
      card.avgLatencyMin = vt.avgLatencyMin;
    }

    saveCard(date, card);
    return card;
  }

  function list() {
    const idx = loadIndex();
    return idx.slice().reverse().map(d => loadCard(d)).filter(Boolean);
  }

  function load(date) {
    return loadCard(date);
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    const idx = loadIndex();
    for (const d of idx) localStorage.removeItem(KEY_PREFIX + d);
    localStorage.removeItem(INDEX_KEY);
  }

  function _autoCheck() {
    try {
      const minutes = etMinNow();
      // Only fire after market close (>=16:00)
      if (minutes < MARKET_CLOSE_MIN) return;
      const date = todayET();
      const existing = loadCard(date);
      if (existing) return; // already wrote today's
      generate();
    } catch (e) {}
  }

  function start() {
    if (typeof window === 'undefined') return;
    if (window._dailyCardInterval) return;
    window._dailyCardInterval = setInterval(_autoCheck, POLL_MS);
  }

  window.DailyCard = { generate, list, load, reset, start };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(start, 8000);
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(start, 8000));
    }
  }
})();
