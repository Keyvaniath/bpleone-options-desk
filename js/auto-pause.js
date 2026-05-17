/* ===========================================
   BPLEONE — Auto-Pause Circuit Breaker
   ---
   TradeTrust gives a 0-100 score that aggregates every brain diagnostic.
   This module operationalizes the score: when it drops below 40 ("DO NOT
   TRADE"), it auto-pauses new predictions, fires a desktop notification,
   and exposes a flag any consumer page (brain-bet, conviction-alerter,
   etc.) can check before showing trade ideas.

   States:
     ACTIVE   — brain operating normally
     PAUSED   — trust < 40, no new trades shown
     COOLDOWN — trust recovered to 40-60, awaiting stable 60+ before resuming

   Hysteresis is intentional: pausing at 40 but requiring 60+ to resume
   prevents oscillation around the threshold.

   Exposes:
     AutoPause.isPaused() → bool
     AutoPause.state()    → 'ACTIVE' | 'PAUSED' | 'COOLDOWN'
     AutoPause.check()    → forces a check, returns new state
     AutoPause.start()    — starts the 60s polling loop
     AutoPause.history()  → [{ ts, from, to, score }, ...]
     AutoPause.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_auto_pause_v1';
  const PAUSE_THRESHOLD = 40;
  const RESUME_THRESHOLD = 60;
  const POLL_MS = 60 * 1000;
  const CONSECUTIVE_BELOW_TO_PAUSE = 3; // require 3 polls in a row below threshold to actually pause
  const MIN_RESOLUTIONS_BEFORE_PAUSE = 20; // never pause until we have real data

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      const s = j ? JSON.parse(j) : null;
      if (!s) return defaultState();
      if (!s.state) s.state = 'ACTIVE';
      if (!s.history) s.history = [];
      return s;
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return { state: 'ACTIVE', history: [], lastCheckTs: 0 };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function check() {
    if (typeof window === 'undefined' || !window.TradeTrust) {
      return load().state;
    }
    let score;
    try { score = window.TradeTrust.score().score; } catch (e) { return load().state; }
    const state = load();
    if (!state.belowCount) state.belowCount = 0;

    // SAFETY GATE: never pause until we have enough resolutions
    // (avoids pausing on cold start when modules have no data yet).
    let totalResolutions = 0;
    try {
      const bs = window.BrierSkill && window.BrierSkill.score();
      if (bs && bs.n) totalResolutions = bs.n;
    } catch (e) {}
    const hasEnoughData = totalResolutions >= MIN_RESOLUTIONS_BEFORE_PAUSE;

    const prev = state.state;
    let next = prev;
    if (prev === 'ACTIVE') {
      if (score < PAUSE_THRESHOLD && hasEnoughData) {
        state.belowCount++;
        if (state.belowCount >= CONSECUTIVE_BELOW_TO_PAUSE) {
          next = 'PAUSED';
          state.belowCount = 0;
        }
      } else {
        state.belowCount = 0;
      }
    } else if (prev === 'PAUSED') {
      if (score >= PAUSE_THRESHOLD) next = 'COOLDOWN';
    } else if (prev === 'COOLDOWN') {
      if (score >= RESUME_THRESHOLD) next = 'ACTIVE';
      else if (score < PAUSE_THRESHOLD && hasEnoughData) {
        state.belowCount++;
        if (state.belowCount >= CONSECUTIVE_BELOW_TO_PAUSE) {
          next = 'PAUSED';
          state.belowCount = 0;
        }
      } else {
        state.belowCount = 0;
      }
    }
    state.lastCheckTs = Date.now();
    if (next !== prev) {
      state.history.push({ ts: Date.now(), from: prev, to: next, score });
      if (state.history.length > 100) state.history = state.history.slice(-100);
      state.state = next;
      save(state);
      // Fire notification on transition — only if permission is granted
      // (never auto-request permission; never throw if blocked).
      try {
        const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';
        if (canNotify && typeof Notify !== 'undefined' && typeof Notify.fire === 'function') {
          const msg = next === 'PAUSED' ? '🛑 Brain auto-paused — trust score below 40'
            : next === 'COOLDOWN' ? '⚠ Brain in cooldown — trust recovering'
            : '✓ Brain resumed — trust restored';
          Notify.fire('Brain status: ' + next, msg);
        }
      } catch (e) {}
      // Fire window event for other pages to react
      try {
        if (typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('bpleone:auto-pause-change', {
            detail: { from: prev, to: next, score }
          }));
        }
      } catch (e) {}
    } else {
      save(state);
    }
    return next;
  }

  function isPaused() { return load().state === 'PAUSED'; }
  function state() { return load().state; }
  function history() { return load().history.slice().reverse(); }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  function start() {
    if (typeof window === 'undefined') return;
    if (window._autoPauseInterval) return;
    window._autoPauseInterval = setInterval(check, POLL_MS);
  }

  window.AutoPause = {
    isPaused,
    state,
    check,
    history,
    start,
    reset,
    PAUSE_THRESHOLD,
    RESUME_THRESHOLD
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(start, 10 * 1000);
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(start, 10 * 1000));
    }
  }
})();
