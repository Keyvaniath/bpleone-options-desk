/* ===========================================
   BPLEONE — Hindsight Replay (Hard Negative Mining)
   ---
   Most resolutions are unsurprising — the model said 70%, the trade
   went the right way, you train on it and move on. But occasionally
   the model says 85% confidently, then the trade goes against it.
   THOSE are the examples that contain the most learning signal — the
   model has a confident wrong belief that needs to be corrected.

   This module collects those "confidently wrong" examples into a
   hindsight pool. When triggered, it replays them through the model
   with elevated weight — biasing learning toward correcting the
   confident mistakes.

   A "confidently wrong" example is defined as:
     |predProb - 0.5| > 0.20    AND   prediction_direction !== actual_label

   i.e. model said at least 70% (or at most 30%) and was wrong.

   Pool is FIFO-capped at 100 examples. Each replay step adds
   regularization gradient toward "next time, be less confident here."

   Exposes:
     HindsightReplay.record(features, predProb, actualLabel, sym)
     HindsightReplay.triggerReplay(model, N)   — replay N most recent
     HindsightReplay.stats()
     HindsightReplay.reset()
   =========================================== */

(function () {
  const KEY = 'bpleone_hindsight_v1';
  const MAX_POOL = 100;
  const CONFIDENCE_THRESHOLD = 0.20; // |p-0.5| > this AND wrong → hindsight
  const REPLAY_WEIGHT = 3.0; // extra learning gradient on replay

  function load() {
    if (typeof localStorage === 'undefined') return { pool: [], replays: [] };
    try {
      const j = localStorage.getItem(KEY);
      return j ? JSON.parse(j) : { pool: [], replays: [] };
    } catch (e) { return { pool: [], replays: [] }; }
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function record(features, predProb, actualLabel, sym) {
    if (!Array.isArray(features) || features.length === 0) return false;
    if (typeof predProb !== 'number' || (actualLabel !== 0 && actualLabel !== 1)) return false;
    const confident = Math.abs(predProb - 0.5) > CONFIDENCE_THRESHOLD;
    const predDir = predProb >= 0.5 ? 1 : 0;
    const wasWrong = predDir !== actualLabel;
    if (!confident || !wasWrong) return false; // only confident+wrong qualifies

    const state = load();
    state.pool.push({
      x: features.slice(),
      p: +predProb.toFixed(4),
      y: actualLabel,
      sym: sym || null,
      t: Date.now()
    });
    if (state.pool.length > MAX_POOL) state.pool = state.pool.slice(-MAX_POOL);
    save(state);
    return true;
  }

  // Replay N most recent hindsight examples through the model. The replay
  // uses elevated weight (3x the standard step) to amplify the correction.
  function triggerReplay(model, n) {
    if (!model || typeof model.train !== 'function') return null;
    if (!n) n = 5;
    const state = load();
    if (state.pool.length === 0) return { replayed: 0 };
    const samples = state.pool.slice(-n);
    let totalLoss = 0;
    let count = 0;
    const origLR = model.lr;
    model.lr = origLR * REPLAY_WEIGHT;
    for (const s of samples) {
      try {
        const trainLabel = (typeof window !== 'undefined' && window.LabelSmoothing && window.LabelSmoothing.enabled())
          ? window.LabelSmoothing.smooth(s.y) : s.y;
        const { loss } = model.train(s.x, trainLabel);
        totalLoss += loss;
        count++;
      } catch (e) {}
    }
    model.lr = origLR;
    state.replays.push({
      n: count,
      avgLoss: count > 0 ? totalLoss / count : null,
      t: Date.now()
    });
    if (state.replays.length > 200) state.replays = state.replays.slice(-200);
    save(state);
    return { replayed: count, avgLoss: count > 0 ? totalLoss / count : null };
  }

  function stats() {
    const state = load();
    const recent = state.replays.slice(-50);
    const avgRecentLoss = recent.length > 0
      ? recent.filter(r => r.avgLoss != null).reduce((s, r) => s + r.avgLoss, 0) / Math.max(1, recent.length)
      : null;
    return {
      poolSize: state.pool.length,
      totalReplays: state.replays.length,
      recentReplayLoss: avgRecentLoss,
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      maxPool: MAX_POOL,
      replayWeight: REPLAY_WEIGHT
    };
  }

  function poolPreview(n) {
    if (!n) n = 10;
    const state = load();
    return state.pool.slice(-n).reverse().map(p => ({
      p: p.p,
      y: p.y,
      sym: p.sym,
      t: p.t,
      mistakeSize: Math.abs(p.p - p.y)
    }));
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.HindsightReplay = {
    record,
    triggerReplay,
    stats,
    poolPreview,
    reset,
    CONFIDENCE_THRESHOLD,
    MAX_POOL,
    REPLAY_WEIGHT
  };
})();
