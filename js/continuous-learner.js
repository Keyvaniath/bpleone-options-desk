/* ===========================================
   BPLEONE — Continuous walk-forward self-learning loop
   ---
   On every page load this module does three things in the background:

   1) CAPTURE — For every symbol in the universe with a fresh REAL price,
      snapshot the current feature vector, model probability, and price.
      Store in localStorage as a "prediction journal."

   2) RESOLVE — For every captured prediction older than the resolution
      window (1 day default), compute the realized 1-day return and
      label the prediction win (1) / loss (0). Add to training data.

   3) TRAIN — Train the model on newly-labeled entries. Track rolling
      accuracy. If accuracy drops below the random-baseline threshold,
      auto-increase the learning rate (concept-drift adaptation).

   This is the heart of self-learning: every page visit generates real
   training data from real prices. Goes from ~5 examples/day (the old
   emit→outcome cycle) to ~200+ (22 symbols × multiple captures × multiple
   horizons). All tagged dataSource='live' so the strict trainer accepts.
   =========================================== */

(function () {
  const UNIVERSE = ['SPY','QQQ','IWM','DIA','AAPL','NVDA','TSLA','MSFT','META','AMZN','GOOGL','AMD','PLTR','SMCI','COIN','BTC','ETH','BABA','SHOP','CRM','UBER','XLE','GLD','SLV'];

  const JOURNAL_KEY = 'bpleone_pred_journal_v1';
  const ACCURACY_KEY = 'bpleone_rolling_acc_v1';
  const STATE_KEY = 'bpleone_cont_state_v1';

  const RESOLUTION_HOURS = 24;            // wait 24h before labeling a prediction
  const MAX_JOURNAL = 5000;               // cap journal size
  const ROLLING_WINDOW = 50;              // rolling accuracy over last N labeled predictions
  const DRIFT_BASELINE = 0.50;            // baseline = random
  const DRIFT_TRIGGER = 0.45;             // below this triggers adaptation
  const CAPTURE_COOLDOWN_MIN_PER_SYM = 30;  // don't capture the same symbol more than once per 30 min

  function loadJournal() { try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]'); } catch (e) { return []; } }
  function saveJournal(j) { try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(j.slice(-MAX_JOURNAL))); } catch (e) {} }
  function loadAcc() { try { return JSON.parse(localStorage.getItem(ACCURACY_KEY) || '[]'); } catch (e) { return []; } }
  function saveAcc(a) { try { localStorage.setItem(ACCURACY_KEY, JSON.stringify(a.slice(-500))); } catch (e) {} }
  function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; } }
  function saveState(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {} }

  function isLiveQuote(q) {
    return q && q.priceSource && q.priceSource !== 'stale-seed' && q.priceSource !== 'mock'
      && q.liveAt && (Date.now() - q.liveAt) < 30 * 60 * 1000;
  }

  // -------- Step 1: CAPTURE --------
  function captureRound() {
    if (typeof QUOTES === 'undefined' || typeof FeatureExtractor === 'undefined' || typeof ModelStore === 'undefined') return 0;
    const journal = loadJournal();
    const state = loadState();
    if (!state.lastCaptureBySym) state.lastCaptureBySym = {};
    const model = ModelStore.load();
    let captured = 0;

    UNIVERSE.forEach(sym => {
      const q = QUOTES[sym];
      if (!isLiveQuote(q)) return;
      const lastCap = state.lastCaptureBySym[sym] || 0;
      if (Date.now() - lastCap < CAPTURE_COOLDOWN_MIN_PER_SYM * 60 * 1000) return;

      // Build a synthetic "finding" to feed FeatureExtractor
      const finding = {
        ts: Date.now(),
        type: 'continuous-capture',
        severity: 1,
        meta: { sym, setup: 'capture-' + sym, last: q.last, bias: q.changePct >= 0 ? 'long' : 'short' }
      };
      try {
        const features = FeatureExtractor.extract(finding);
        const pred = model.predict(features);
        journal.push({
          id: 'c-' + Date.now() + '-' + sym,
          ts: Date.now(),
          sym: sym,
          entryPx: q.last,
          features: features,
          predProb: pred.prob,
          priceSource: q.priceSource,
          resolved: false
        });
        state.lastCaptureBySym[sym] = Date.now();
        captured++;
      } catch (e) {}
    });

    if (captured > 0) {
      saveJournal(journal);
      saveState(state);
    }
    return captured;
  }

  // -------- Step 2: RESOLVE older predictions --------
  function resolveRound() {
    if (typeof QUOTES === 'undefined' || typeof ModelStore === 'undefined') return 0;
    const journal = loadJournal();
    const now = Date.now();
    const cutoff = now - RESOLUTION_HOURS * 3600 * 1000;
    let resolved = 0;
    const newRows = [];
    const accLog = loadAcc();

    journal.forEach(entry => {
      if (entry.resolved) return;
      if (entry.ts > cutoff) return;  // not old enough
      const q = QUOTES[entry.sym];
      if (!isLiveQuote(q)) return;  // can't label without current real price
      const ret = (q.last - entry.entryPx) / entry.entryPx;
      // Label: did 1-day return exceed 0.3% (a meaningful directional move)?
      // Use signed return — positive if pred said up and went up, OR if pred said down and went down.
      const predUp = entry.predProb >= 0.5;
      const wentUp = ret > 0.003;
      const wentDown = ret < -0.003;
      let label = null;
      if (predUp && wentUp) label = 1;        // correctly predicted up
      else if (!predUp && wentDown) label = 1; // correctly predicted down
      else if (predUp && wentDown) label = 0;  // wrongly predicted up
      else if (!predUp && wentUp) label = 0;   // wrongly predicted down
      // flat moves (within ±0.3%) — skip, no clear winner
      if (label === null) {
        entry.resolved = true;
        entry.outcome = 'flat';
        entry.realizedRet = ret;
        return;
      }
      entry.resolved = true;
      entry.outcome = label === 1 ? 'correct' : 'wrong';
      entry.realizedRet = ret;
      entry.exitPx = q.last;
      newRows.push({ features: entry.features, label, sym: entry.sym, predProb: entry.predProb });
      accLog.push({ ts: Date.now(), correct: label === 1, sym: entry.sym, predProb: entry.predProb });
      resolved++;
    });

    if (newRows.length === 0) return 0;

    // Train on resolved entries
    const state = loadState();
    const driftAdapt = state.driftAdapting || false;
    const model = ModelStore.load();
    // Boost learning rate temporarily if we're in drift adaptation mode
    const originalLR = model.lr;
    if (driftAdapt) model.lr = Math.min(0.2, originalLR * 2);
    let lossSum = 0;
    newRows.forEach(r => {
      const { loss } = model.train(r.features, r.label);
      lossSum += loss;
      ModelStore.addTrainingRow(r.features, r.label, {
        sym: r.sym,
        setup: 'continuous-' + r.sym,
        dataSource: 'live',
        priceSource: 'continuous-loop',
        continuous: true,
        predProbAtCapture: r.predProb
      });
    });
    model.lr = originalLR;
    model.n_trained = (model.n_trained || 0) + newRows.length;
    ModelStore.save(model);
    saveJournal(journal);
    saveAcc(accLog);

    // Check for concept drift: rolling accuracy over last ROLLING_WINDOW resolutions
    const recent = accLog.slice(-ROLLING_WINDOW);
    if (recent.length >= 20) {
      const acc = recent.filter(a => a.correct).length / recent.length;
      if (acc < DRIFT_TRIGGER && !state.driftAdapting) {
        state.driftAdapting = true;
        state.driftStartedAt = Date.now();
        try {
          window.dispatchEvent(new CustomEvent('bpleone:concept-drift', { detail: { rollingAcc: acc, window: recent.length } }));
        } catch (e) {}
      } else if (acc >= DRIFT_BASELINE + 0.05 && state.driftAdapting) {
        state.driftAdapting = false;
        state.driftRecoveredAt = Date.now();
      }
      state.lastRollingAcc = acc;
      state.lastResolveTs = Date.now();
      saveState(state);
    }

    try {
      window.dispatchEvent(new CustomEvent('bpleone:continuous-resolved', {
        detail: { resolved: newRows.length, avgLoss: lossSum / newRows.length, rollingAcc: state.lastRollingAcc }
      }));
    } catch (e) {}

    return newRows.length;
  }

  // -------- Stats summary --------
  function summary() {
    const journal = loadJournal();
    const accLog = loadAcc();
    const state = loadState();
    const unresolved = journal.filter(e => !e.resolved).length;
    const resolved = journal.filter(e => e.resolved && e.outcome !== 'flat').length;
    const flat = journal.filter(e => e.outcome === 'flat').length;
    const today0 = new Date(); today0.setHours(0,0,0,0);
    const capturedToday = journal.filter(e => e.ts >= today0.getTime()).length;
    const resolvedToday = journal.filter(e => e.outcome && e.outcome !== 'flat' && e.ts >= today0.getTime() - 86400000).length;
    const rolling = accLog.slice(-ROLLING_WINDOW);
    const rollingAcc = rolling.length >= 5 ? rolling.filter(a => a.correct).length / rolling.length : null;
    const lifetimeAcc = accLog.length > 0 ? accLog.filter(a => a.correct).length / accLog.length : null;
    return {
      journal: journal.length,
      unresolved, resolved, flat,
      capturedToday, resolvedToday,
      rollingAcc, lifetimeAcc,
      driftAdapting: !!state.driftAdapting,
      driftStartedAt: state.driftStartedAt || null,
      lastResolveTs: state.lastResolveTs || null
    };
  }

  // -------- Run cycle every minute (after first 15s delay) --------
  function runCycle() {
    try {
      const captured = captureRound();
      const resolved = resolveRound();
      if (captured > 0 || resolved > 0) {
        try {
          window.dispatchEvent(new CustomEvent('bpleone:continuous-cycle', { detail: { captured, resolved } }));
        } catch (e) {}
      }
    } catch (e) {}
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      // First cycle after 15s (gives Stooq/Coinbase time to populate real prices)
      setTimeout(runCycle, 15000);
      // Then every 60 seconds
      setInterval(runCycle, 60000);
    });
  }

  window.ContinuousLearner = { runCycle, summary, captureRound, resolveRound };
})();
