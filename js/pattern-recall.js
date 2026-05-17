/* ===========================================
   BPLEONE — Pattern Recall
   ---
   "This NVDA long looks like 12 prior NVDA setups — 9 won at avg +2.1R."

   For a candidate signal (journal entry or alert), finds the K nearest
   prior RESOLVED trades using L2 distance on the 22-feature vector,
   then summarizes their realized outcomes.

   Useful for adding pattern-based intuition to a numerical conviction
   score: high model conviction is one thing, but if 9/12 historical
   look-alikes won, that's actionable confirmation.

   Exposes:
     PatternRecall.findSimilar(entryOrAlert, k=10) -> [{neighbor, distance, outcome, ret, ts}]
     PatternRecall.summarize(entry, k=10) -> { count, wins, losses, avgRet, hitRate }
   =========================================== */

(function () {
  const JOURNAL_KEY = 'bpleone_pred_journal_v1';

  function loadResolved() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const journal = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
      return journal.filter(e => {
        if (!e || !Array.isArray(e.features)) return false;
        if (typeof e.realizedRet !== 'number') return false;
        const r = e.resolved;
        return r && (r === true || (r.short && r.short !== false && r.short !== 'flat'));
      });
    } catch (e) { return []; }
  }

  function l2(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      s += d * d;
    }
    return Math.sqrt(s);
  }

  function findSimilar(target, k) {
    k = k || 10;
    if (!target) return [];
    const features = target.features || target.basePreds || null;
    if (!features || !Array.isArray(features)) return [];
    const pool = loadResolved();
    // Exclude the target itself
    const targetId = target.id;
    const scored = pool
      .filter(p => p.id !== targetId)
      .map(p => ({ neighbor: p, distance: l2(features, p.features) }))
      .filter(p => isFinite(p.distance));
    scored.sort((a, b) => a.distance - b.distance);
    return scored.slice(0, k).map(s => ({
      neighbor: { sym: s.neighbor.sym, ts: s.neighbor.ts, predProb: s.neighbor.predProb, entryPx: s.neighbor.entryPx, regime: s.neighbor.regime },
      distance: +s.distance.toFixed(3),
      outcome: s.neighbor.outcome || (s.neighbor.realizedRet > 0 ? 'correct' : 'wrong'),
      realizedRet: +s.neighbor.realizedRet.toFixed(4),
      rMultiple: s.neighbor.rMultiple || null,
      ts: s.neighbor.ts
    }));
  }

  function summarize(target, k) {
    const neighbors = findSimilar(target, k);
    if (neighbors.length === 0) return { count: 0, wins: 0, losses: 0, avgRet: null, hitRate: null, neighbors: [] };
    // Project predicted direction onto historical retention rate
    const targetUp = !target || target.predProb == null ? true : target.predProb >= 0.5;
    let wins = 0, losses = 0;
    let totalRet = 0;
    neighbors.forEach(n => {
      const neighborUp = n.neighbor.predProb == null ? n.realizedRet > 0 : n.neighbor.predProb >= 0.5;
      const sameDir = neighborUp === targetUp;
      const realized = sameDir ? n.realizedRet : -n.realizedRet;
      totalRet += realized;
      if (realized > 0.003) wins++;
      else if (realized < -0.003) losses++;
    });
    const total = wins + losses;
    return {
      count: neighbors.length,
      wins, losses,
      hitRate: total > 0 ? wins / total : null,
      avgRet: +(totalRet / neighbors.length).toFixed(4),
      neighbors
    };
  }

  window.PatternRecall = { findSimilar, summarize };
})();
