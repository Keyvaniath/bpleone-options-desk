/* ===========================================
   BPLEONE — Weekly Historical Bootstrap Refresh
   ---
   The initial HistoricalBootstrap (60 days * 24 symbols ~= 660 examples)
   only runs ONCE per browser. Without periodic refresh, the historical
   training data goes stale — last week's price action never feeds the
   brain, so it keeps learning from the same 660 bars forever.

   This module:
     - Tracks last successful bootstrap timestamp in localStorage
     - On every page load, checks if >= 7 days have passed
     - If yes, calls HistoricalBootstrap.run({ force: true }) to pull
       fresh 60 days of bars (the last week + previous 53 days)
     - Throttled to max one refresh per 7 days
     - Logs each refresh attempt + outcome for the data-reliability page

   Exposes:
     WeeklyRefresh.check() -> { ranNow, lastRefresh, nextRefreshDue, history }
     WeeklyRefresh.forceNow() -> runs immediately regardless of timer
     WeeklyRefresh.status() -> read-only snapshot of state
     WeeklyRefresh.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_weekly_refresh_v1';
  const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
  const MIN_HOURS_BETWEEN_ATTEMPTS = 1;                  // safety: don't retry inside 1h
  const MAX_HISTORY = 20;

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : defaultState();
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return {
      lastSuccessAt: 0,
      lastAttemptAt: 0,
      history: [],   // [{ ts, ok, symbolsFetched, trainingExamples, errorCount, durationMs, trigger }]
      totalRefreshes: 0,
      totalAttempts: 0
    };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function pushHistory(state, entry) {
    state.history.push(entry);
    if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
  }

  function nextRefreshDue(state) {
    const next = (state.lastSuccessAt || 0) + REFRESH_INTERVAL_MS;
    return next;
  }

  function dueNow(state) {
    const now = Date.now();
    if (!state.lastSuccessAt) return true;            // never run
    if (now - state.lastSuccessAt >= REFRESH_INTERVAL_MS) return true;
    return false;
  }

  function canAttempt(state) {
    const now = Date.now();
    if (state.lastAttemptAt && now - state.lastAttemptAt < MIN_HOURS_BETWEEN_ATTEMPTS * 60 * 60 * 1000) return false;
    return true;
  }

  async function check(opts) {
    opts = opts || {};
    const state = load();
    if (typeof window === 'undefined' || !window.HistoricalBootstrap) {
      return { ranNow: false, reason: 'HistoricalBootstrap not loaded', lastSuccessAt: state.lastSuccessAt, nextRefreshDue: nextRefreshDue(state) };
    }
    if (!opts.force) {
      if (!dueNow(state)) {
        return { ranNow: false, reason: 'not-due', lastSuccessAt: state.lastSuccessAt, nextRefreshDue: nextRefreshDue(state), daysSince: state.lastSuccessAt ? (Date.now() - state.lastSuccessAt) / (24 * 60 * 60 * 1000) : null };
      }
      if (!canAttempt(state)) {
        return { ranNow: false, reason: 'retry-too-soon', lastAttemptAt: state.lastAttemptAt };
      }
    }
    // Mark attempt
    state.lastAttemptAt = Date.now();
    state.totalAttempts++;
    save(state);

    const t0 = Date.now();
    let result;
    try {
      result = await window.HistoricalBootstrap.run({ force: true });
    } catch (e) {
      result = { error: String(e && e.message || e) };
    }
    const duration = Date.now() - t0;
    const ok = !!(result && !result.error && (result.trainingExamples || 0) > 0);

    if (ok) {
      state.lastSuccessAt = Date.now();
      state.totalRefreshes++;
    }
    pushHistory(state, {
      ts: Date.now(),
      ok,
      symbolsFetched: result && result.symbolsFetched || 0,
      trainingExamples: result && result.trainingExamples || 0,
      errorCount: result && result.errors ? result.errors.length : (result && result.error ? 1 : 0),
      durationMs: duration,
      trigger: opts.force ? 'manual' : 'auto-weekly',
      error: result && result.error ? result.error : null
    });
    save(state);
    return { ranNow: true, ok, durationMs: duration, result, lastSuccessAt: state.lastSuccessAt, nextRefreshDue: nextRefreshDue(state) };
  }

  function forceNow() {
    return check({ force: true });
  }

  function status() {
    const state = load();
    return {
      lastSuccessAt: state.lastSuccessAt,
      lastAttemptAt: state.lastAttemptAt,
      nextRefreshDue: nextRefreshDue(state),
      totalRefreshes: state.totalRefreshes,
      totalAttempts: state.totalAttempts,
      daysSinceLastSuccess: state.lastSuccessAt ? (Date.now() - state.lastSuccessAt) / (24 * 60 * 60 * 1000) : null,
      due: dueNow(state),
      recent: state.history.slice(-10).reverse()
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  function autoSchedule() {
    if (typeof window === 'undefined') return;
    if (window._weeklyRefreshTimer) return;
    // First check ~30s after page load (give HistoricalBootstrap time to register)
    setTimeout(() => { check().catch(() => {}); }, 30 * 1000);
    // Then check every 6 hours in case the tab stays open across the week boundary
    window._weeklyRefreshTimer = setInterval(() => { check().catch(() => {}); }, 6 * 60 * 60 * 1000);
  }

  window.WeeklyRefresh = { check, forceNow, status, reset, REFRESH_INTERVAL_MS };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      autoSchedule();
    } else {
      document.addEventListener('DOMContentLoaded', autoSchedule);
    }
  }
})();
