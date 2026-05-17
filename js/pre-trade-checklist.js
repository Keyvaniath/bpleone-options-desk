/* ===========================================
   BPLEONE — Pre-Trade Checklist
   ---
   A 10-point checklist that runs against a candidate signal (or any
   open auto-trade) to validate it's safe to enter / hold. Each item
   evaluates a real gate: data freshness, source agreement, brain trust,
   pattern recall, correlation, earnings risk, mental state, etc.

   Returns: passing count + per-item pass/fail/skip + overall verdict.

   Exposes:
     PreTradeChecklist.evaluate(alertOrEntry) -> { items, passing, total, verdict }
     PreTradeChecklist.evaluateAll() -> per current alerts
   =========================================== */

(function () {
  function evaluate(target) {
    if (!target) return { items: [], passing: 0, total: 0, verdict: 'no-target' };
    const items = [];

    // 1. Conviction gate
    const conv = Math.max(target.predProb || target.conviction || 0.5, 1 - (target.predProb || target.conviction || 0.5));
    items.push({
      name: 'Conviction ≥ 65%',
      passed: conv >= 0.65,
      detail: 'Brain says ' + Math.round(conv * 100) + '% probability'
    });

    // 2. Data freshness
    let freshPass = true, freshDetail = 'no QUOTES';
    if (typeof window !== 'undefined' && window.QUOTES && target.sym && window.QUOTES[target.sym]) {
      const q = window.QUOTES[target.sym];
      const age = q.liveAt ? (Date.now() - q.liveAt) / 1000 : 9999;
      freshPass = age < 300;
      freshDetail = age < 9999 ? Math.round(age) + 's old' : 'never updated';
    }
    items.push({ name: 'Price live (< 5min)', passed: freshPass, detail: freshDetail });

    // 3. Source quality
    let srcPass = true, srcDetail = '—';
    if (typeof window !== 'undefined' && window.SourcePreference && target.sym && window.QUOTES && window.QUOTES[target.sym]) {
      const q = window.QUOTES[target.sym];
      const src = q.priceSource || q.source;
      const score = src ? window.SourcePreference.rank(src) : 0;
      srcPass = score >= 0.55;
      srcDetail = src ? (src + ' · q=' + Math.round(score * 100) + '%') : 'unknown';
    }
    items.push({ name: 'Source quality ≥ 55%', passed: srcPass, detail: srcDetail });

    // 4. DataReliability: not stale
    let drPass = true, drDetail = '—';
    if (typeof window !== 'undefined' && window.DataReliability && target.sym) {
      const h = window.DataReliability.symbolHealth(target.sym);
      drPass = !h.stale;
      drDetail = h.stale ? 'STALE' : 'fresh · ' + Math.round((h.ageMs || 0) / 1000) + 's old';
    }
    items.push({ name: 'DataReliability not stale', passed: drPass, detail: drDetail });

    // 5. Pattern Recall
    let prPass = true, prDetail = 'skipped (no historical data)';
    if (typeof window !== 'undefined' && window.PatternRecall && target.features) {
      const s = window.PatternRecall.summarize(target, 10);
      if (s.count >= 5) {
        prPass = s.hitRate == null || s.hitRate >= 0.5;
        prDetail = s.wins + 'W / ' + s.losses + 'L over ' + s.count + ' look-alikes (' + Math.round((s.hitRate || 0) * 100) + '%)';
      } else {
        prDetail = 'insufficient history (' + s.count + ' neighbors)';
      }
    }
    items.push({ name: 'Pattern recall ≥ 50%', passed: prPass, detail: prDetail });

    // 6. OOD
    const oodVal = target.oodScore || 0;
    items.push({ name: 'OOD score < 0.6', passed: oodVal < 0.6, detail: 'OOD ' + oodVal.toFixed(2) });

    // 7. Earnings clear
    let eaPass = true, eaDetail = 'no scheduled earnings';
    if (typeof window !== 'undefined' && window.EarningsAwareness && target.sym) {
      const e = window.EarningsAwareness.nextEarnings(target.sym);
      if (e && e.daysOut >= 0 && e.daysOut <= 3) {
        eaPass = false;
        eaDetail = '⚠ earnings in ' + e.daysOut.toFixed(1) + 'd';
      } else if (e) {
        eaDetail = 'next earnings ~' + e.daysOut.toFixed(0) + 'd out';
      }
    }
    items.push({ name: 'Earnings > 3d away', passed: eaPass, detail: eaDetail });

    // 8. No existing position
    let nepPass = true, nepDetail = 'no open auto-trade';
    if (typeof window !== 'undefined' && window.AutoTrade && target.sym) {
      const open = window.AutoTrade.openTrades();
      const has = open.find(t => t.sym === target.sym);
      if (has) { nepPass = false; nepDetail = 'already open ' + (has.direction > 0 ? 'LONG' : 'SHORT') + ' ' + has.shares + 'sh'; }
    }
    items.push({ name: 'No existing position', passed: nepPass, detail: nepDetail });

    // 9. Portfolio not overloaded
    let pcPass = true, pcDetail = '—';
    if (typeof window !== 'undefined' && window.AutoTrade) {
      const open = window.AutoTrade.openTrades();
      const cfg = window.AutoTrade.getConfig();
      pcPass = open.length < cfg.maxOpenPositions;
      pcDetail = open.length + ' / ' + cfg.maxOpenPositions + ' positions';
    }
    items.push({ name: 'Under max positions cap', passed: pcPass, detail: pcDetail });

    // 10. Mental state OK (not in loss streak ≥3)
    let mgPass = true, mgDetail = 'no streak data';
    if (typeof window !== 'undefined' && window.StreakTracker) {
      const snap = window.StreakTracker.snapshot();
      if (!snap.empty) {
        mgPass = snap.currentStreak > -3;
        mgDetail = 'streak ' + (snap.currentStreak > 0 ? '+' : '') + snap.currentStreak;
      }
    }
    items.push({ name: 'Mental state OK', passed: mgPass, detail: mgDetail });

    const passing = items.filter(i => i.passed).length;
    const total = items.length;
    const verdict = passing >= 9 ? 'green' : passing >= 7 ? 'yellow' : 'red';
    return { items, passing, total, verdict };
  }

  function evaluateAll() {
    if (typeof window === 'undefined' || !window.HighConvictionAlerts) return [];
    const feed = window.HighConvictionAlerts.feed(20);
    const journal = (() => {
      try { return JSON.parse(localStorage.getItem('bpleone_pred_journal_v1') || '[]'); } catch (e) { return []; }
    })();
    return feed.map(a => {
      const entry = journal.find(j => j.id === a.sourceJournalId);
      const target = entry || a;
      return { alert: a, evaluation: evaluate(target) };
    });
  }

  window.PreTradeChecklist = { evaluate, evaluateAll };
})();
