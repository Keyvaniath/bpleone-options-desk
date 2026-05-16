/* ===========================================
   BPLEONE — Trade Trust Score
   ---
   The brain has 20+ diagnostic modules. Each produces useful signal but
   it's a lot to track. This module aggregates them into a single 0-100
   trust score that says "how much should you trust this prediction
   right now?"

   Penalty rubric (subtracted from 100):
     BSS < 0.10              -15  (brain not clearly learning)
     BSS < 0                 -25  (brain worse than baseline; replaces -15)
     annualized Sharpe < 1.0 -10
     annualized Sharpe < 0   -25  (replaces -10)
     Drift PSI > 0.25        -20  (concept drift)
     Covariate shift fired   -25  (input distribution shifted)
     Drawdown streak ≤ -3    -15  (tilt risk)
     Drawdown streak ≤ -5    -25  (replaces -15; deep tilt)
     Agreement = FRAGMENTED   -10
     Conformal hw > 0.20     -15  (wide uncertainty intervals)
     HourlyPerf <20 samples   -5
     DowPerf <20 samples      -5

   Returns the score plus the list of penalties applied so Brandon can
   see exactly why his trust is degraded.

   Tier:
     90-100 → green light
     75-89  → trust but verify
     60-74  → reduced size
     40-59  → only paper trade
     <40   → don't trade

   Exposes:
     TradeTrust.score(components?) → { score, tier, penalties, factors }
     TradeTrust.reset()       — no-op, this is a pure computation
   =========================================== */

(function () {
  const TIER_THRESHOLDS = [
    { min: 90, tier: 'green',  label: 'GREEN LIGHT',   color: '#10b981' },
    { min: 75, tier: 'amber',  label: 'TRUST BUT VERIFY', color: '#00d4ff' },
    { min: 60, tier: 'caution', label: 'REDUCED SIZE',  color: '#f59e0b' },
    { min: 40, tier: 'warn',   label: 'PAPER ONLY',    color: '#f59e0b' },
    { min: 0,  tier: 'danger', label: 'DO NOT TRADE',  color: '#ef4444' }
  ];

  function tierOf(score) {
    for (const t of TIER_THRESHOLDS) {
      if (score >= t.min) return t;
    }
    return TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1];
  }

  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }

  function score(components) {
    components = components || {};
    let s = 100;
    const penalties = [];
    const factors = {};

    const W = typeof window !== 'undefined' ? window : {};
    // BSS
    const bss = safe(() => W.BrierSkill ? W.BrierSkill.score() : null, null);
    if (bss && bss.ready) {
      factors.bss = bss.skill;
      if (bss.skill < 0) { s -= 25; penalties.push({ name: 'BSS < 0', penalty: -25, value: bss.skill }); }
      else if (bss.skill < 0.10) { s -= 15; penalties.push({ name: 'BSS < 0.10', penalty: -15, value: bss.skill }); }
    }

    // Sharpe
    const sh = safe(() => W.SharpeTracker ? W.SharpeTracker.score() : null, null);
    if (sh && sh.ready) {
      factors.annSharpe = sh.annSharpe;
      if (sh.annSharpe < 0) { s -= 25; penalties.push({ name: 'Sharpe < 0', penalty: -25, value: sh.annSharpe }); }
      else if (sh.annSharpe < 1.0) { s -= 10; penalties.push({ name: 'Sharpe < 1.0', penalty: -10, value: sh.annSharpe }); }
    }

    // Drift PSI
    const psi = safe(() => W.DriftPSI ? W.DriftPSI.status() : null, null);
    if (psi && typeof psi.psi === 'number') {
      factors.psi = psi.psi;
      if (psi.psi > 0.25) { s -= 20; penalties.push({ name: 'Drift PSI > 0.25', penalty: -20, value: psi.psi }); }
    }

    // Covariate shift
    const av = safe(() => W.AdversarialValidator ? W.AdversarialValidator.score() : null, null);
    if (av && av.shifted) {
      factors.covariateShift = true;
      s -= 25;
      penalties.push({ name: 'Covariate shift detected', penalty: -25, value: av.lastAuc });
    }

    // Drawdown streak
    const dd = safe(() => W.DrawdownProtector ? W.DrawdownProtector.stats() : null, null);
    if (dd && typeof dd.currentStreak === 'number') {
      factors.streak = dd.currentStreak;
      if (dd.currentStreak <= -5) { s -= 25; penalties.push({ name: 'Deep losing streak', penalty: -25, value: dd.currentStreak }); }
      else if (dd.currentStreak <= -3) { s -= 15; penalties.push({ name: 'Losing streak ≥ 3', penalty: -15, value: dd.currentStreak }); }
    }

    // Cross-method agreement (from components if provided)
    if (components.agreementTier === 'FRAGMENTED') {
      factors.agreement = 'FRAGMENTED';
      s -= 10;
      penalties.push({ name: 'Agreement = FRAGMENTED', penalty: -10 });
    }

    // Conformal halfwidth (from components if provided)
    if (typeof components.conformalHalfwidth === 'number' && components.conformalHalfwidth > 0.20) {
      factors.conformalHw = components.conformalHalfwidth;
      s -= 15;
      penalties.push({ name: 'Wide conformal interval', penalty: -15, value: components.conformalHalfwidth });
    }

    // Hourly bucket sample size
    const hp = safe(() => W.HourlyPerf ? W.HourlyPerf.stats() : null, null);
    if (hp && hp.perBucket && hp.currentBucket) {
      const b = hp.perBucket[hp.currentBucket];
      if (b && b.n < 20) { s -= 5; penalties.push({ name: 'Hourly bucket insufficient', penalty: -5, value: b.n }); }
    }

    // DoW bucket sample size
    const dow = safe(() => W.DowPerf ? W.DowPerf.stats() : null, null);
    if (dow && dow.perDay && dow.currentDay) {
      const dStats = dow.perDay[dow.currentDay];
      if (dStats && dStats.n < 20) { s -= 5; penalties.push({ name: 'DoW bucket insufficient', penalty: -5, value: dStats.n }); }
    }

    s = Math.max(0, Math.min(100, Math.round(s)));
    const t = tierOf(s);
    return {
      score: s,
      tier: t.tier,
      tierLabel: t.label,
      tierColor: t.color,
      penalties,
      factors
    };
  }

  function reset() { /* pure computation, nothing to reset */ }

  window.TradeTrust = {
    score,
    tierOf,
    reset,
    TIER_THRESHOLDS
  };
})();
