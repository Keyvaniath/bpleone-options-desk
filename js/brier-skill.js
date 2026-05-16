/* ===========================================
   BPLEONE — Brier Skill Score (BSS)
   ---
   The Brier Score measures probabilistic-prediction quality:
       BS = mean (p - y)^2     (lower is better; 0 = perfect, 0.25 = no info)

   But raw Brier is hard to interpret. The Brier Skill Score normalizes it
   against a baseline (always predict the mean rate):
       BSS = 1 - (BS_model / BS_baseline)

   Interpretation:
       BSS > 0     → model beats baseline
       BSS = 0     → tied with baseline
       BSS < 0     → worse than baseline (model is anti-informative)
       BSS > 0.10  → useful
       BSS > 0.25  → strong

   This is the single most diagnostic number for "is my brain learning?"
   It's invariant to the base rate (which Brier alone isn't) and gives a
   clear pass/fail signal.

   Exposes:
     BrierSkill.record(predictedProb, actualWin)
     BrierSkill.score(window=200) → { brier, baseline, skill, n, baseRate }
     BrierSkill.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_brier_skill_v1';
  const MAX_LOG = 500;
  const DEFAULT_WINDOW = 200;

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

  function record(predictedProb, actualWin) {
    if (typeof predictedProb !== 'number' || (actualWin !== 0 && actualWin !== 1)) return;
    if (predictedProb < 0 || predictedProb > 1) return;
    const state = load();
    state.log.push({ p: +predictedProb.toFixed(4), y: actualWin, t: Date.now() });
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save(state);
  }

  function score(window) {
    if (!window) window = DEFAULT_WINDOW;
    const state = load();
    const rows = state.log.slice(-window);
    const n = rows.length;
    if (n < 10) {
      return { brier: null, baseline: null, skill: null, n, baseRate: null, ready: false };
    }
    const baseRate = rows.reduce((s, r) => s + r.y, 0) / n;
    let brierModel = 0;
    let brierBaseline = 0;
    for (const r of rows) {
      brierModel += (r.p - r.y) * (r.p - r.y);
      brierBaseline += (baseRate - r.y) * (baseRate - r.y);
    }
    brierModel /= n;
    brierBaseline /= n;
    const skill = brierBaseline > 0 ? (1 - brierModel / brierBaseline) : 0;
    return {
      brier: brierModel,
      baseline: brierBaseline,
      skill,
      n,
      baseRate,
      ready: true
    };
  }

  function tier(skill) {
    if (skill == null) return 'idle';
    if (skill < 0) return 'broken';
    if (skill < 0.05) return 'weak';
    if (skill < 0.10) return 'fair';
    if (skill < 0.20) return 'useful';
    if (skill < 0.30) return 'strong';
    return 'excellent';
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.BrierSkill = {
    record,
    score,
    tier,
    reset,
    DEFAULT_WINDOW
  };
})();
