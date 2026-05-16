/* ===========================================
   BPLEONE — Exponential Sample Age Decay
   ---
   The brain currently treats every training example with equal sample
   weight (modulo R-multiple and active-learning multipliers). But a
   resolution from 3 weeks ago carries less signal about today's market
   than a resolution from this morning.

   This module computes an exponential decay multiplier based on the
   age of the training example:
       decay = exp(-age_days / half_life)
       half_life = 7 days (default)

       0 days old   → 1.000
       7 days old   → 0.500
       14 days old  → 0.250
       21 days old  → 0.125

   When multiplied into sampleWeight, old examples still contribute but
   recent ones dominate gradient updates. This lets the model adapt
   faster to regime shifts (e.g. when volatility regime changes).

   Configurable:
     - half_life in days (default 7)
     - enabled flag (default true)

   Exposes:
     SampleDecay.multiplier(ageDays | timestampMs)
     SampleDecay.halfLife() / .setHalfLife(days)
     SampleDecay.enabled() / .setEnabled(bool)
     SampleDecay.stats()
   =========================================== */

(function () {
  const KEY = 'bpleone_sample_decay_v1';
  const DEFAULT_HALFLIFE_DAYS = 7;
  const MIN_HALFLIFE = 1;
  const MAX_HALFLIFE = 90;
  const MS_PER_DAY = 86400 * 1000;

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      const s = j ? JSON.parse(j) : null;
      if (!s) return defaultState();
      if (typeof s.halfLife !== 'number') s.halfLife = DEFAULT_HALFLIFE_DAYS;
      if (typeof s.enabled !== 'boolean') s.enabled = true;
      if (typeof s.appliedCount !== 'number') s.appliedCount = 0;
      return s;
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return {
      halfLife: DEFAULT_HALFLIFE_DAYS,
      enabled: true,
      appliedCount: 0
    };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Accept either age in days (number > 0 expected to be small) or a
  // timestamp in ms (large number); infer based on magnitude.
  function multiplier(ageOrTs) {
    if (typeof ageOrTs !== 'number' || !isFinite(ageOrTs)) return 1.0;
    const state = load();
    if (!state.enabled) return 1.0;
    let ageDays;
    if (ageOrTs > 1e9) {
      // Timestamp in ms — convert to age
      ageDays = (Date.now() - ageOrTs) / MS_PER_DAY;
    } else {
      ageDays = ageOrTs;
    }
    if (ageDays < 0) ageDays = 0;
    const hl = state.halfLife;
    const m = Math.exp(-ageDays * Math.LN2 / hl);
    state.appliedCount++;
    save(state);
    return m;
  }

  function halfLife() { return load().halfLife; }
  function setHalfLife(days) {
    const clamped = Math.max(MIN_HALFLIFE, Math.min(MAX_HALFLIFE, days));
    const state = load();
    state.halfLife = clamped;
    save(state);
  }

  function enabled() { return load().enabled; }
  function setEnabled(b) {
    const state = load();
    state.enabled = !!b;
    save(state);
  }

  function stats() {
    const state = load();
    return {
      halfLife: state.halfLife,
      enabled: state.enabled,
      appliedCount: state.appliedCount,
      min: MIN_HALFLIFE,
      max: MAX_HALFLIFE,
      default: DEFAULT_HALFLIFE_DAYS
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.SampleDecay = {
    multiplier,
    halfLife,
    setHalfLife,
    enabled,
    setEnabled,
    stats,
    reset,
    DEFAULT_HALFLIFE_DAYS,
    MIN_HALFLIFE,
    MAX_HALFLIFE
  };
})();
