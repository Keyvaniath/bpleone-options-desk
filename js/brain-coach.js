/* ===========================================
   BPLEONE — Brain Coach
   ---
   Translates the brain's current state from all 30+ diagnostic modules
   into plain-English advice. Like a fitness coach reading every metric
   and giving Brandon one paragraph he can act on.

   Generates 3 things:
     1. Headline:  "Brain is healthy" / "Brain is degraded" / "Be careful today"
     2. Diagnosis: bullet points of what's working + what's not
     3. Advice:    specific action recommendations

   Pure computation, reads from all module APIs. No state of its own.

   Exposes:
     BrainCoach.summary() → { headline, headlineColor, diagnosis: [...], advice: [...], snapshot: {...} }
   =========================================== */

(function () {
  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
  function fmt(n, d) { return n != null ? n.toFixed(d != null ? d : 3) : '—'; }
  function fmtPct(n) { return n != null ? (n * 100).toFixed(1) + '%' : '—'; }

  function summary() {
    const W = typeof window !== 'undefined' ? window : {};

    const snap = {};
    const diagnosis = [];
    const advice = [];
    let healthScore = 100; // start optimistic
    let alertCount = 0;
    let warnCount = 0;

    // --- BSS: is the brain learning? ---
    const bss = safe(() => W.BrierSkill && W.BrierSkill.score(), null);
    if (bss && bss.ready) {
      snap.bss = bss.skill;
      if (bss.skill > 0.20) {
        diagnosis.push({ icon: '✓', kind: 'good', text: 'Strong learning (BSS ' + (bss.skill >= 0 ? '+' : '') + fmt(bss.skill) + ') — brain has real edge over the baseline.' });
      } else if (bss.skill > 0.10) {
        diagnosis.push({ icon: '✓', kind: 'good', text: 'Useful learning (BSS ' + fmt(bss.skill) + ').' });
      } else if (bss.skill > 0) {
        diagnosis.push({ icon: '⚠', kind: 'warn', text: 'Fair edge (BSS ' + fmt(bss.skill) + ') — close to random.' });
        warnCount++;
        healthScore -= 10;
      } else {
        diagnosis.push({ icon: '✗', kind: 'alert', text: 'Brain is BELOW baseline (BSS ' + fmt(bss.skill) + ') — predictions worse than always guessing the mean.' });
        alertCount++;
        healthScore -= 25;
        advice.push({ icon: '🛑', text: 'Reduce or stop trading until BSS recovers above 0.' });
      }
    } else {
      diagnosis.push({ icon: '○', kind: 'idle', text: 'Brier Skill warming up — need more resolutions.' });
    }

    // --- Sharpe: is it making money? ---
    const sh = safe(() => W.SharpeTracker && W.SharpeTracker.score(), null);
    if (sh && sh.ready) {
      snap.sharpe = sh.annSharpe;
      if (sh.annSharpe > 1.5) {
        diagnosis.push({ icon: '✓', kind: 'good', text: 'Excellent risk-adjusted return (Sharpe ' + fmt(sh.annSharpe, 2) + ').' });
      } else if (sh.annSharpe > 1.0) {
        diagnosis.push({ icon: '✓', kind: 'good', text: 'Good risk-adjusted return (Sharpe ' + fmt(sh.annSharpe, 2) + ').' });
      } else if (sh.annSharpe > 0.5) {
        diagnosis.push({ icon: '⚠', kind: 'warn', text: 'Fair Sharpe (' + fmt(sh.annSharpe, 2) + ') — making money but barely.' });
        warnCount++;
      } else if (sh.annSharpe > 0) {
        diagnosis.push({ icon: '⚠', kind: 'warn', text: 'Weak Sharpe (' + fmt(sh.annSharpe, 2) + ') — barely positive.' });
        warnCount++;
        healthScore -= 10;
      } else {
        diagnosis.push({ icon: '✗', kind: 'alert', text: 'Losing money (Sharpe ' + fmt(sh.annSharpe, 2) + ') — directional bets are net negative.' });
        alertCount++;
        healthScore -= 20;
        advice.push({ icon: '💸', text: 'Sharpe is negative — paper trade only until it recovers.' });
      }
    }

    // --- Drift PSI: concept drift ---
    const psi = safe(() => W.DriftPSI && W.DriftPSI.status(), null);
    if (psi && typeof psi.psi === 'number') {
      snap.psi = psi.psi;
      if (psi.psi > 0.25) {
        diagnosis.push({ icon: '⚠', kind: 'alert', text: 'Concept drift detected (PSI ' + fmt(psi.psi) + ') — output distribution has shifted significantly.' });
        alertCount++;
        healthScore -= 15;
        advice.push({ icon: '🌊', text: 'Markets have shifted. Consider waiting for the brain to re-adapt before sizing up.' });
      } else if (psi.psi > 0.10) {
        diagnosis.push({ icon: '⚠', kind: 'warn', text: 'Mild output drift (PSI ' + fmt(psi.psi) + ').' });
        warnCount++;
      }
    }

    // --- Covariate shift: input drift ---
    const av = safe(() => W.AdversarialValidator && W.AdversarialValidator.score(), null);
    if (av && av.shifted) {
      diagnosis.push({ icon: '⚠', kind: 'alert', text: 'Covariate shift detected (AUC ' + fmt(av.lastAuc) + ') — current inputs look different from training distribution.' });
      alertCount++;
      healthScore -= 15;
      advice.push({ icon: '🔍', text: 'Brain is extrapolating into unfamiliar territory. Reduce size by 30-40%.' });
    }

    // --- Drawdown / tilt ---
    const dd = safe(() => W.DrawdownProtector && W.DrawdownProtector.stats(), null);
    if (dd && typeof dd.currentStreak === 'number') {
      snap.streak = dd.currentStreak;
      if (dd.currentStreak <= -5) {
        diagnosis.push({ icon: '🛑', kind: 'alert', text: 'Cold streak: ' + Math.abs(dd.currentStreak) + ' losses in a row.' });
        alertCount++;
        healthScore -= 20;
        advice.push({ icon: '🛑', text: 'Take a break. Tilt-protection size mult is at ' + (dd.sizeMultiplier * 100).toFixed(0) + '%.' });
      } else if (dd.currentStreak <= -3) {
        diagnosis.push({ icon: '⚠', kind: 'warn', text: 'Losing streak: ' + Math.abs(dd.currentStreak) + ' in a row.' });
        warnCount++;
        healthScore -= 10;
        advice.push({ icon: '⚠', text: 'Drawdown protector has reduced sizing to ' + (dd.sizeMultiplier * 100).toFixed(0) + '%. Trust it.' });
      } else if (dd.currentStreak >= 7) {
        diagnosis.push({ icon: '🔥', kind: 'warn', text: 'Hot streak: ' + dd.currentStreak + ' wins in a row.' });
        advice.push({ icon: '🪙', text: 'Long streaks revert. Don\'t size UP on the next trade.' });
      }
    }

    // --- Calibration / ECE ---
    const rd = safe(() => W.ReliabilityDiagram && W.ReliabilityDiagram.stats(), null);
    if (rd && rd.ece10 != null) {
      snap.ece = rd.ece10;
      if (rd.ece10 > 0.15) {
        diagnosis.push({ icon: '⚠', kind: 'warn', text: 'Calibration is poor (ECE ' + fmt(rd.ece10) + '). When brain says 70%, real win rate may differ a lot.' });
        warnCount++;
        healthScore -= 10;
      } else if (rd.ece10 < 0.05) {
        diagnosis.push({ icon: '✓', kind: 'good', text: 'Excellent calibration (ECE ' + fmt(rd.ece10) + ').' });
      }
    }

    // --- Trade trust + auto-pause ---
    const tt = safe(() => W.TradeTrust && W.TradeTrust.score(), null);
    if (tt) {
      snap.trust = tt.score;
      if (tt.score < 40) {
        diagnosis.push({ icon: '🛑', kind: 'alert', text: 'Trade trust at ' + tt.score + '/100 — DO NOT TRADE.' });
        alertCount++;
        healthScore -= 25;
        advice.push({ icon: '🛑', text: 'Auto-pause has fired (or will soon). Wait for trust to recover above 60.' });
      } else if (tt.score < 60) {
        diagnosis.push({ icon: '⚠', kind: 'warn', text: 'Trade trust at ' + tt.score + '/100 — paper trade only.' });
        warnCount++;
      } else if (tt.score >= 90) {
        diagnosis.push({ icon: '✓', kind: 'good', text: 'Trade trust at ' + tt.score + '/100 — green light.' });
      }
    }

    // --- Hourly performance for current hour ---
    const hp = safe(() => W.HourlyPerf && W.HourlyPerf.stats(), null);
    if (hp && hp.perBucket && hp.currentBucket) {
      const b = hp.perBucket[hp.currentBucket];
      if (b && b.n >= 20 && b.edge != null) {
        if (b.edge > 0.05) {
          diagnosis.push({ icon: '⏰', kind: 'good', text: 'Current hour (' + hp.currentBucket + ') is historically strong (+' + (b.edge * 100).toFixed(1) + 'pp edge).' });
        } else if (b.edge < -0.05) {
          diagnosis.push({ icon: '⏰', kind: 'warn', text: 'Current hour (' + hp.currentBucket + ') is historically weak (' + (b.edge * 100).toFixed(1) + 'pp edge).' });
          warnCount++;
          advice.push({ icon: '⏰', text: 'Brain typically underperforms in this hour. Consider waiting or sizing down.' });
        }
      }
    }

    // --- UI HONESTY GATE (pass 178) ---
    // Before any module-by-module "looks healthy" signal can claim victory,
    // check the ONE thing that actually matters: has the brain ever trained?
    // If model.n_trained === 0 the brain is making predictions from random/
    // initial weights — "HEALTHY · trade with conviction" is a lie no matter
    // what the per-module diagnostics say. Same if there's no journal at all.
    let untrained = false;
    let untrainedReason = '';
    try {
      const m = JSON.parse(localStorage.getItem('bpleone_model_v1') || 'null');
      if (!m || !m.n_trained || m.n_trained === 0) {
        untrained = true;
        untrainedReason = m ? 'model.n_trained = 0' : 'no model saved yet';
      }
    } catch (e) {
      untrained = true;
      untrainedReason = 'model store unreadable';
    }
    let journalLen = 0;
    try { journalLen = (JSON.parse(localStorage.getItem('bpleone_pred_journal_v1') || '[]') || []).length; } catch (e) {}

    // --- Headline ---
    healthScore = Math.max(0, Math.min(100, healthScore));
    let headline, headlineColor;
    if (untrained) {
      // Cap health at the lower of the per-module-derived score OR 35.
      // An untrained brain is NOT 100/100 no matter how clean the modules look.
      healthScore = Math.min(healthScore, 35);
      headline = journalLen > 0
        ? 'Brain UNTRAINED — capturing data but not learning yet (' + journalLen + ' captures, ' + untrainedReason + ')'
        : 'Brain UNTRAINED — no model weights, no journal (' + untrainedReason + ')';
      headlineColor = 'var(--red)';
    } else if (alertCount > 0) {
      headline = 'BRAIN IS DEGRADED — be very careful';
      headlineColor = 'var(--red)';
    } else if (warnCount > 1) {
      headline = 'Brain is OK but multiple warnings — reduce size';
      headlineColor = 'var(--yellow)';
    } else if (warnCount === 1) {
      headline = 'Brain is mostly healthy — one yellow flag';
      headlineColor = 'var(--yellow)';
    } else if (diagnosis.some(d => d.kind === 'good')) {
      headline = 'Brain is HEALTHY — trade with conviction';
      headlineColor = 'var(--green)';
    } else {
      headline = 'Brain is warming up — waiting for data';
      headlineColor = 'var(--text-muted)';
    }

    // Default advice if none
    if (advice.length === 0 && diagnosis.length > 0) {
      if (alertCount === 0 && warnCount === 0) {
        advice.push({ icon: '✓', text: 'No specific concerns. Follow standard sizing per Unified Predictor.' });
      } else {
        advice.push({ icon: '👀', text: 'Watch the diagnostic flags. Reduce size if they don\'t clear within 1 hour.' });
      }
    }

    return {
      headline,
      headlineColor,
      diagnosis,
      advice,
      snapshot: snap,
      healthScore,
      alertCount,
      warnCount,
      totalChecks: diagnosis.length
    };
  }

  window.BrainCoach = { summary };
})();
