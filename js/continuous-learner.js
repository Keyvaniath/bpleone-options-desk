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

  // Multi-horizon resolution: capture once, resolve at multiple horizons.
  // Each entry gets resolved at the SHORT horizon (1d) first for the main
  // rolling-accuracy loop, then again at MID (5d) and LONG (20d) for the
  // multi-horizon ensemble models.
  const HORIZON_HOURS = { short: 24, mid: 5 * 24, long: 20 * 24 };
  const MAX_JOURNAL = 5000;               // cap journal size
  const ROLLING_WINDOW = 50;              // rolling accuracy over last N labeled predictions
  const DRIFT_BASELINE = 0.50;            // baseline = random
  const DRIFT_TRIGGER = 0.45;             // below this triggers adaptation
  const CAPTURE_COOLDOWN_MIN_PER_SYM = 30;  // don't capture the same symbol more than once per 30 min
  const CAPTURE_COOLDOWN_UNCERTAIN_MIN = 5; // boost frequency for uncertain (active-learning) symbols

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

    // Read the regime once per cycle so all captures in this round share context
    const regimeInfo = (typeof MultiHorizon !== 'undefined') ? MultiHorizon.detectRegime() : { name: 'choppy' };

    UNIVERSE.forEach(sym => {
      const q = QUOTES[sym];
      if (!isLiveQuote(q)) return;
      const lastCap = state.lastCaptureBySym[sym] || 0;
      // Active-learning: uncertain symbols get a shorter cooldown (5 min instead of 30 min)
      const uncertainSyms = state.uncertainSyms || {};
      const cooldownMin = uncertainSyms[sym] ? CAPTURE_COOLDOWN_UNCERTAIN_MIN : CAPTURE_COOLDOWN_MIN_PER_SYM;
      if (Date.now() - lastCap < cooldownMin * 60 * 1000) return;

      // Build a synthetic "finding" to feed FeatureExtractor
      const finding = {
        ts: Date.now(),
        type: 'continuous-capture',
        severity: 1,
        meta: { sym, setup: 'capture-' + sym, last: q.last, bias: q.changePct >= 0 ? 'long' : 'short' }
      };
      try {
        const features = FeatureExtractor.extract(finding);
        // Per-horizon predictions if multi-horizon is loaded
        let ensemble = null;
        try {
          if (typeof MultiHorizon !== 'undefined') {
            ensemble = MultiHorizon.predictEnsemble(features);
          }
        } catch (e) {}
        const pred = model.predict(features);
        const journalEntry = {
          id: 'c-' + Date.now() + '-' + sym,
          ts: Date.now(),
          sym: sym,
          entryPx: q.last,
          features: features,
          predProb: pred.prob,
          priceSource: q.priceSource,
          regime: regimeInfo.name,
          regimeVix: regimeInfo.vix,
          regimeSpyChg: regimeInfo.spyChg,
          resolved: { short: false, mid: false, long: false }
        };
        if (ensemble) {
          journalEntry.ensembleProb = ensemble.prob;
          journalEntry.horizonProbs = ensemble.byHorizon;
          journalEntry.horizonWeights = ensemble.weights;
        }
        journal.push(journalEntry);
        state.lastCaptureBySym[sym] = Date.now();
        // Active-learning: mark uncertain if main prob in [0.40, 0.60]
        if (!state.uncertainSyms) state.uncertainSyms = {};
        if (pred.prob >= 0.40 && pred.prob <= 0.60) {
          state.uncertainSyms[sym] = { since: Date.now(), prob: pred.prob };
        } else {
          delete state.uncertainSyms[sym];
        }
        captured++;
      } catch (e) {}
    });

    if (captured > 0) {
      saveJournal(journal);
      saveState(state);
    }
    return captured;
  }

  // -------- Step 2: RESOLVE older predictions across all 3 horizons --------
  // For each captured prediction we attempt to resolve at SHORT (1d), MID (5d),
  // and LONG (20d) horizons. Each resolution trains the appropriate horizon
  // model. Short-horizon resolutions also drive the main rolling-accuracy
  // and concept-drift detector.
  function resolveRound() {
    if (typeof QUOTES === 'undefined' || typeof ModelStore === 'undefined') return 0;
    const journal = loadJournal();
    const now = Date.now();
    let resolvedShort = 0;
    const newRows = [];        // for main (legacy single) model — short horizon
    const newHorizonRows = []; // {horizon, features, label, weight, sym, predProb, regime}
    const accLog = loadAcc();

    // Per-horizon thresholds (the move magnitude that counts as a 'directional move')
    // Calibrated to be meaningful at each horizon — longer horizons need bigger moves.
    const HORIZON_MIN_MOVE = { short: 0.003, mid: 0.01, long: 0.03 };  // 0.3% / 1% / 3%

    journal.forEach(entry => {
      // Backwards compat: old entries had .resolved as boolean. Convert to object.
      if (typeof entry.resolved === 'boolean') {
        entry.resolved = { short: entry.resolved, mid: false, long: false };
      } else if (!entry.resolved || typeof entry.resolved !== 'object') {
        entry.resolved = { short: false, mid: false, long: false };
      }
      const q = QUOTES[entry.sym];
      if (!isLiveQuote(q)) return;
      const age = now - entry.ts;

      ['short', 'mid', 'long'].forEach(horizon => {
        if (entry.resolved[horizon]) return;
        if (age < HORIZON_HOURS[horizon] * 3600 * 1000) return;
        const ret = (q.last - entry.entryPx) / entry.entryPx;
        const predUp = entry.predProb >= 0.5;
        const horizonPredUp = entry.horizonProbs && typeof entry.horizonProbs[horizon] === 'number'
          ? entry.horizonProbs[horizon] >= 0.5 : predUp;
        const minMove = HORIZON_MIN_MOVE[horizon];
        const wentUp = ret > minMove;
        const wentDown = ret < -minMove;
        let label = null;
        if (horizonPredUp && wentUp) label = 1;
        else if (!horizonPredUp && wentDown) label = 1;
        else if (horizonPredUp && wentDown) label = 0;
        else if (!horizonPredUp && wentUp) label = 0;
        if (label === null) {
          entry.resolved[horizon] = 'flat';
          return;
        }
        entry.resolved[horizon] = label === 1 ? 'correct' : 'wrong';
        // Sample weight = |R-multiple| scaled (reward shaping).
        // R = ret / (ATR-equivalent). Use 0.5×ATR or 1% as denominator floor.
        const denom = Math.max(0.01, minMove * 3);  // ~1×ATR for the horizon
        const rMultiple = Math.abs(ret) / denom;
        const sampleWeight = Math.max(0.25, Math.min(4, rMultiple));

        newHorizonRows.push({
          horizon, features: entry.features, label, weight: sampleWeight,
          sym: entry.sym, predProb: (entry.horizonProbs && entry.horizonProbs[horizon]) || entry.predProb,
          regime: entry.regime || 'choppy', ret
        });

        // Short-horizon resolutions also drive the main loop
        if (horizon === 'short') {
          entry.outcome = label === 1 ? 'correct' : 'wrong';
          entry.realizedRet = ret;
          entry.exitPx = q.last;
          entry.rMultiple = rMultiple;
          newRows.push({ features: entry.features, label, sym: entry.sym, predProb: entry.predProb, weight: sampleWeight });
          accLog.push({ ts: Date.now(), correct: label === 1, sym: entry.sym, predProb: entry.predProb });
          resolvedShort++;
          // CALIBRATION: feed the (rawProb, actualWin) pair to the calibrator
          // so it can fit a Platt-scaling mapping and report honest probabilities.
          try {
            if (typeof Calibrator !== 'undefined') {
              Calibrator.recordPair(entry.predProb, label);
            }
          } catch (e) {}
        }
      });

      // Mark flat outcomes legibly for the dashboard
      if (entry.resolved.short && !entry.outcome) {
        entry.outcome = entry.resolved.short;  // 'flat' / 'correct' / 'wrong'
      }
    });

    // Train each horizon model on its new rows
    if (typeof MultiHorizon !== 'undefined' && newHorizonRows.length > 0) {
      newHorizonRows.forEach(r => {
        MultiHorizon.trainHorizon(r.horizon, r.features, r.label, r.weight);
        MultiHorizon.recordOutcome(r.regime, r.horizon, r.label === 1, r.predProb);
        // Save as training row tagged with horizon for the analytics pages
        ModelStore.addTrainingRow(r.features, r.label, {
          sym: r.sym,
          setup: 'continuous-' + r.horizon + '-' + r.sym,
          dataSource: 'live',
          priceSource: 'continuous-loop',
          horizon: r.horizon,
          regime: r.regime,
          sampleWeight: r.weight,
          rMultiple: Math.abs(r.ret) / Math.max(0.01, 0.01),
          continuous: true
        });
      });
    }

    const resolved = resolvedShort;

    if (newRows.length === 0) return 0;

    // Train on resolved entries with REWARD-SHAPED sample weights
    const state = loadState();
    const driftAdapt = state.driftAdapting || false;
    const model = ModelStore.load();
    const originalLR = model.lr;
    if (driftAdapt) model.lr = Math.min(0.2, originalLR * 2);
    let lossSum = 0;
    newRows.forEach(r => {
      // Reward-shaped training: repeat the SGD step weight-many times.
      // Bigger move = more impact on the model's weights. Floor at 0.25 so even
      // tiny moves contribute a quarter step.
      const w = Math.max(0.25, Math.min(4, r.weight || 1.0));
      let repLoss = 0;
      const fullSteps = Math.floor(w);
      const frac = w - fullSteps;
      for (let k = 0; k < fullSteps; k++) {
        const { loss } = model.train(r.features, r.label);
        repLoss += loss;
      }
      if (frac > 0) {
        const lrSaved = model.lr;
        model.lr = lrSaved * frac;
        const { loss } = model.train(r.features, r.label);
        repLoss += loss * frac;
        model.lr = lrSaved;
      }
      lossSum += repLoss / Math.max(1, w);
      ModelStore.addTrainingRow(r.features, r.label, {
        sym: r.sym,
        setup: 'continuous-' + r.sym,
        dataSource: 'live',
        priceSource: 'continuous-loop',
        continuous: true,
        predProbAtCapture: r.predProb,
        sampleWeight: w
      });
    });
    model.lr = originalLR;
    model.n_trained = (model.n_trained || 0) + newRows.length;
    ModelStore.save(model);

    // FEATURE ATTRIBUTION: for each resolved entry, compute per-feature
    // contribution to the prediction logit, then update the feature-alpha map.
    try {
      const alphaKey = 'bpleone_feature_alpha_v1';
      let alpha = JSON.parse(localStorage.getItem(alphaKey) || '{}');
      if (!alpha.features) alpha.features = {};
      newRows.forEach(r => {
        // Contribution: weight_i × feature_i (the term in the logit sum)
        for (let i = 0; i < r.features.length; i++) {
          const contrib = (model.weights[i] || 0) * r.features[i];
          const fname = 'f' + i;
          if (!alpha.features[fname]) alpha.features[fname] = { wins: 0, losses: 0, sumContribWin: 0, sumContribLoss: 0, n: 0 };
          const f = alpha.features[fname];
          f.n++;
          if (r.label === 1) { f.wins++; f.sumContribWin += contrib; }
          else { f.losses++; f.sumContribLoss += contrib; }
        }
      });
      alpha.updatedAt = Date.now();
      localStorage.setItem(alphaKey, JSON.stringify(alpha));
    } catch (e) {}

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

    // CALIBRATION: trigger re-fit after this batch of pairs has landed.
    // The calibrator decides internally whether enough new pairs accumulated
    // (≥50 since last fit) or enough time elapsed (>1h) to warrant a re-fit.
    try {
      if (typeof Calibrator !== 'undefined') Calibrator.maybeFit();
    } catch (e) {}

    try {
      window.dispatchEvent(new CustomEvent('bpleone:continuous-resolved', {
        detail: { resolved: newRows.length, avgLoss: lossSum / newRows.length, rollingAcc: state.lastRollingAcc }
      }));
    } catch (e) {}

    return newRows.length;
  }

  // -------- Stats summary --------
  function isShortResolved(e) {
    if (!e.resolved) return false;
    if (typeof e.resolved === 'boolean') return e.resolved;
    return !!e.resolved.short;
  }
  function summary() {
    const journal = loadJournal();
    const accLog = loadAcc();
    const state = loadState();
    const unresolved = journal.filter(e => !isShortResolved(e)).length;
    const resolved = journal.filter(e => isShortResolved(e) && e.outcome !== 'flat' && e.outcome !== 'unrateable-stale-data').length;
    const flat = journal.filter(e => e.outcome === 'flat').length;
    const today0 = new Date(); today0.setHours(0,0,0,0);
    const capturedToday = journal.filter(e => e.ts >= today0.getTime()).length;
    const resolvedToday = journal.filter(e => e.outcome && e.outcome !== 'flat' && e.ts >= today0.getTime() - 86400000).length;
    const rolling = accLog.slice(-ROLLING_WINDOW);
    const rollingAcc = rolling.length >= 5 ? rolling.filter(a => a.correct).length / rolling.length : null;
    const lifetimeAcc = accLog.length > 0 ? accLog.filter(a => a.correct).length / accLog.length : null;
    // Active-learning queue size
    const uncertainCount = state.uncertainSyms ? Object.keys(state.uncertainSyms).length : 0;
    return {
      journal: journal.length,
      unresolved, resolved, flat,
      capturedToday, resolvedToday,
      rollingAcc, lifetimeAcc,
      uncertainCount,
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
