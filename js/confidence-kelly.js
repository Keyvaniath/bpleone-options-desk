/* ===========================================
   BPLEONE — Confidence-Scaled Kelly Sizer
   ---
   Full Kelly = (p × b - q) / b   where p = win prob, q = 1-p, b = win/loss ratio.
   It maximizes log-growth of bankroll — but only if your edge estimate is PERFECT.
   In practice, estimates are noisy, so full Kelly often overbets and busts traders.

   The fix: scale Kelly by:
     1. Fraction (default 0.25) — quarter-Kelly is the standard "safe" version
     2. Uncertainty (MC dropout std + bootstrap divergence + conformal halfwidth)
     3. Calibration trust (BSS — if brain isn't learning, don't size up)
     4. Source quality (data reliability score)

   The output is a fraction of bankroll to risk on a single trade. Combined
   with stop distance gives shares/contracts.

   Formula (Bayesian-Kelly inspired):
     edge = (p × winR) - (q × lossR) / lossR       — expected R per dollar
     pureKelly = edge / winR
     adjKelly = pureKelly × KELLY_FRACTION × confidence_mult × trust_mult × source_mult
     adjKelly = max(0, min(MAX_KELLY, adjKelly))   — cap at 5% bankroll
     dollarsRisk = bankroll × adjKelly
     shares = dollarsRisk / risk-per-share

   Exposes:
     ConfidenceKelly.size({ prob, winR, lossR, bankroll, uncertainty?, agreementTier?, conformalHw? })
       → { adjKelly, dollarsRisk, shares, breakdown }
     ConfidenceKelly.config() → { fraction, maxKelly }
     ConfidenceKelly.setFraction(f) — 0.10 = tenth-Kelly (very safe), 1.0 = full
   =========================================== */

(function () {
  const KEY = 'bpleone_confidence_kelly_v1';
  const DEFAULT_FRACTION = 0.25;   // quarter-Kelly default
  const MIN_FRACTION = 0.05;
  const MAX_FRACTION = 1.0;
  const MAX_KELLY = 0.05;          // hard cap: never risk more than 5% per trade
  const MIN_PROB = 0.51;           // below this, no bet (no edge)

  function load() {
    if (typeof localStorage === 'undefined') return { fraction: DEFAULT_FRACTION };
    try {
      const j = localStorage.getItem(KEY);
      const s = j ? JSON.parse(j) : null;
      if (!s || typeof s.fraction !== 'number') return { fraction: DEFAULT_FRACTION };
      return s;
    } catch (e) { return { fraction: DEFAULT_FRACTION }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function size(input) {
    input = input || {};
    const prob = input.prob;
    const winR = input.winR || 1;
    const lossR = input.lossR || 1;
    const bankroll = input.bankroll || 0;
    const breakdown = {};

    if (typeof prob !== 'number' || prob < 0 || prob > 1 || bankroll <= 0) {
      return { adjKelly: 0, dollarsRisk: 0, shares: 0, reason: 'invalid-input', breakdown };
    }
    // Direction-agnostic: if prob<0.5, treat as SHORT bet at prob=(1-orig)
    const p = Math.max(prob, 1 - prob);
    const q = 1 - p;
    breakdown.p = p;
    breakdown.q = q;

    if (p < MIN_PROB) {
      return { adjKelly: 0, dollarsRisk: 0, shares: 0, reason: 'no-edge', breakdown };
    }

    // Pure Kelly with R-multiple
    const b = winR / lossR;
    const pureKelly = (p * b - q) / b;
    breakdown.pureKelly = pureKelly;
    if (pureKelly <= 0) {
      return { adjKelly: 0, dollarsRisk: 0, shares: 0, reason: 'negative-edge', breakdown };
    }

    // Multipliers
    const state = load();
    const fraction = state.fraction || DEFAULT_FRACTION;
    breakdown.fraction = fraction;

    // 1. Uncertainty multiplier (MC dropout std / bootstrap divergence)
    let uncMult = 1.0;
    if (typeof input.uncertaintyStd === 'number' && isFinite(input.uncertaintyStd)) {
      uncMult = Math.max(0.3, 1 - input.uncertaintyStd * 4);  // std=0.15 → 0.4x
    }
    breakdown.uncertaintyMult = uncMult;

    // 2. Agreement tier multiplier (cross-method)
    let agreementMult = 1.0;
    if (input.agreementTier === 'STRONG') agreementMult = 1.0;
    else if (input.agreementTier === 'MODERATE') agreementMult = 0.85;
    else if (input.agreementTier === 'MIXED') agreementMult = 0.6;
    else if (input.agreementTier === 'FRAGMENTED') agreementMult = 0.35;
    breakdown.agreementMult = agreementMult;

    // 3. Conformal interval halfwidth — wider = less trustworthy
    let conformalMult = 1.0;
    if (typeof input.conformalHw === 'number' && input.conformalHw > 0.10) {
      conformalMult = Math.max(0.3, 1 - (input.conformalHw - 0.10) * 3);
    }
    breakdown.conformalMult = conformalMult;

    // 4. BSS trust — if the brain isn't actually learning, scale down hard
    let trustMult = 1.0;
    if (typeof window !== 'undefined' && window.BrierSkill) {
      try {
        const bss = window.BrierSkill.score();
        if (bss && bss.ready) {
          if (bss.skill < 0) trustMult = 0.2;            // brain WORSE than baseline
          else if (bss.skill < 0.05) trustMult = 0.5;    // weak
          else if (bss.skill < 0.10) trustMult = 0.8;    // fair
          // else use 1.0 (useful/strong/excellent)
        }
      } catch (e) {}
    }
    breakdown.trustMult = trustMult;

    // 5. Source quality — penalize if active source is unreliable
    let sourceMult = 1.0;
    if (input.sourceName && typeof window !== 'undefined' && window.DataReliability) {
      try {
        const sh = window.DataReliability.sourceHealth(input.sourceName);
        if (sh && sh.hasData) {
          if (sh.degraded) sourceMult = 0.5;
          else if (sh.recentSuccessRate < 0.9) sourceMult = 0.75;
        }
      } catch (e) {}
    }
    breakdown.sourceMult = sourceMult;

    const adjKelly = Math.max(0, Math.min(MAX_KELLY,
      pureKelly * fraction * uncMult * agreementMult * conformalMult * trustMult * sourceMult
    ));
    breakdown.adjKelly = adjKelly;

    const dollarsRisk = bankroll * adjKelly;
    const riskPerShare = input.riskPerShare || lossR;
    const shares = riskPerShare > 0 ? Math.floor(dollarsRisk / riskPerShare) : 0;

    return { adjKelly, dollarsRisk, shares, breakdown, pureKelly };
  }

  function config() { return load(); }
  function setFraction(f) {
    const clamped = Math.max(MIN_FRACTION, Math.min(MAX_FRACTION, f));
    save({ fraction: clamped });
  }
  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.ConfidenceKelly = {
    size,
    config,
    setFraction,
    reset,
    DEFAULT_FRACTION,
    MIN_FRACTION,
    MAX_FRACTION,
    MAX_KELLY
  };
})();
