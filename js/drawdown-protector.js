/* ===========================================
   BPLEONE — Drawdown-Aware Sizing
   ---
   Even a brain with positive edge will hit losing streaks. The Kelly
   formula plus uncertainty multipliers reduce size for individual
   uncertain bets, but they don't account for the streak the trader
   is currently in. Three consecutive losses changes the conditional
   probability of the next one being right (mean reversion in the
   model's error process), and more importantly it changes the
   psychological + bankroll risk.

   This module:
     - Maintains a rolling 100-resolution win/loss history
     - Detects the CURRENT streak (positive = wins, negative = losses)
     - Computes a multiplier ∈ [0.3, 1.0]:
         losing_streak >= 5 → 0.4 (heavy tilt protection)
         losing_streak >= 3 → 0.65
         losing_streak >= 2 → 0.85
         winning_streak >= 7 → 0.80 (anti-overconfidence)
         winning_streak >= 4 → 0.92
         otherwise         → 1.0

   Exposes:
     DrawdownProtector.record(label)          — feed each resolution (1/0)
     DrawdownProtector.currentStreak()        — signed integer
     DrawdownProtector.sizeMultiplier()       — [0.3, 1.0]
     DrawdownProtector.stats()                — full stats incl. max streaks
     DrawdownProtector.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_drawdown_v1';
  const MAX_LOG = 200;

  function load() {
    if (typeof localStorage === 'undefined') return { log: [] };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { log: [] };
    } catch (e) { return { log: [] }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function record(label) {
    if (label !== 0 && label !== 1) return;
    const state = load();
    state.log.push({ y: label, t: Date.now() });
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save(state);
  }

  // Signed current streak: positive = wins, negative = losses, 0 = empty
  function currentStreak() {
    const state = load();
    if (state.log.length === 0) return 0;
    const last = state.log[state.log.length - 1].y;
    let streak = 0;
    for (let i = state.log.length - 1; i >= 0; i--) {
      if (state.log[i].y === last) streak++;
      else break;
    }
    return last === 1 ? streak : -streak;
  }

  // Max streak (signed) over the whole window
  function maxStreaks() {
    const state = load();
    if (state.log.length === 0) return { maxWin: 0, maxLose: 0 };
    let maxWin = 0, maxLose = 0;
    let cur = 0;
    let prev = null;
    for (const r of state.log) {
      if (r.y === prev) {
        cur++;
      } else {
        cur = 1;
        prev = r.y;
      }
      if (prev === 1) maxWin = Math.max(maxWin, cur);
      else maxLose = Math.max(maxLose, cur);
    }
    return { maxWin, maxLose };
  }

  function sizeMultiplier() {
    const s = currentStreak();
    // Losing streaks (s < 0): tighter as it deepens
    if (s <= -5) return 0.40;
    if (s <= -3) return 0.65;
    if (s <= -2) return 0.85;
    // Winning streaks (s > 0): slight anti-overconfidence after extended runs
    if (s >= 7) return 0.80;
    if (s >= 4) return 0.92;
    return 1.0;
  }

  function reasoning() {
    const s = currentStreak();
    if (s <= -5) return 'Cold streak — heavy tilt protection (-60% size).';
    if (s <= -3) return 'Losing streak — protective sizing (-35% size).';
    if (s <= -2) return 'Two losses in a row — mild caution (-15% size).';
    if (s >= 7) return 'Long winning streak — anti-overconfidence (-20% size).';
    if (s >= 4) return 'Winning streak — mild anti-overconfidence (-8% size).';
    return 'Normal sizing.';
  }

  function stats() {
    const state = load();
    const streak = currentStreak();
    const max = maxStreaks();
    const wins = state.log.filter(r => r.y === 1).length;
    const total = state.log.length;
    return {
      n: total,
      wins,
      losses: total - wins,
      winRate: total > 0 ? wins / total : null,
      currentStreak: streak,
      maxWinStreak: max.maxWin,
      maxLoseStreak: max.maxLose,
      sizeMultiplier: sizeMultiplier(),
      reasoning: reasoning()
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.DrawdownProtector = {
    record,
    currentStreak,
    sizeMultiplier,
    reasoning,
    stats,
    reset
  };
})();
