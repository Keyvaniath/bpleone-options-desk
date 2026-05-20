/* ===========================================
   BPLEONE TRADING — ML MODEL ENGINE
   ---
   Real, in-browser, self-training ML pipeline.
   No external server. Everything lives in localStorage.

   Architecture:
     1. FEATURES (constant) — the 22 normalized feature names
     2. FeatureExtractor.extract(finding, market) — builds a feature vector
     3. Model — logistic regression w/ SGD (binary cross-entropy)
     4. ModelStore — persistence + versioning
     5. ModelTrainer — orchestrates training from outcome ratings

   The model predicts P(win) for any setup. Brain attaches this
   confidence to every finding so conviction stacking uses *learned*
   weights, not just rule-of-thumb scoring.

   Public surface:
     Model.predict(x) -> {prob, score, contributions}
     Model.train(x, y) -> {loss, p}
     Model.featureImportance() -> sorted list
     Model.serialize() / .deserialize(d)
     ModelStore.save(m) / .load() / .saveVersion(m, label) / .versions()
     FeatureExtractor.extract(finding, market) -> Array(22)
     ModelTrainer.trainBatch() — one mini-batch from outcomes
     ModelTrainer.fullRetrain() — re-fit from full history
     ModelTrainer.evaluate() — accuracy / loss on labeled set
   =========================================== */

const FEATURES = [
  // Technical state (0-9)
  'rsi14_norm',           // 0: RSI/100
  'atr_pct_norm',         // 1: ATR%/10, capped
  'vol_ratio_norm',       // 2: RVOL/4, capped
  'dist_50ma',            // 3: signed % distance from 50MA, capped
  'dist_200ma',           // 4: signed % distance from 200MA, capped
  'spy_chg_norm',         // 5: SPY day chg / 5%
  'sector_strength',      // 6: sector ETF day chg / 5%
  'beta_norm',            // 7: symbol beta normalized 0-1
  'spread_bps_norm',      // 8: tighter = better; 0-1
  'iv_pct_norm',          // 9: IV percentile

  // Setup classification (10-15)
  'severity_norm',        // 10: severity/3
  'is_bull_setup',        // 11
  'is_bear_setup',        // 12
  'is_momentum',          // 13
  'is_reversion',         // 14
  'is_breakout',          // 15

  // Brain state (16-19)
  'brain_weight_norm',    // 16: (w - 0.5) / 1.1
  'regime_score_norm',    // 17: cross-asset regime / 100
  'vix_norm',             // 18: (VIX - 10) / 40
  'coincident_count_norm',// 19: other findings on same sym in 4h / 10

  // Temporal (20-21)
  'hour_norm',            // 20: time since 9:30 / session length
  'bias'                  // 21: intercept (always 1)
];

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function safeNum(n, def) { return (typeof n === 'number' && isFinite(n)) ? n : def; }

const FeatureExtractor = {
  /**
   * Build feature vector from a brain finding + optional market snapshot
   * Returns Array of length FEATURES.length, all values in [0, 1] or [-1, 1]
   */
  extract(finding, marketSnap) {
    finding = finding || {};
    const meta = finding.meta || {};
    const sym = meta.sym || '';
    marketSnap = marketSnap || this.snapshotMarket(sym);
    const features = new Array(FEATURES.length).fill(0);

    // 0: RSI normalized
    features[0] = clamp(safeNum(marketSnap.rsi, 50) / 100, 0, 1);
    // 1: ATR%
    features[1] = clamp(safeNum(marketSnap.atrPct, 2) / 10, 0, 1);
    // 2: RVOL
    features[2] = clamp(safeNum(marketSnap.rvol, 1) / 4, 0, 1);
    // 3: Distance from 50MA (signed %)
    features[3] = clamp(safeNum(marketSnap.dist50, 0) / 10, -1, 1);
    // 4: Distance from 200MA
    features[4] = clamp(safeNum(marketSnap.dist200, 0) / 20, -1, 1);
    // 5: SPY day change
    features[5] = clamp(safeNum(marketSnap.spyChg, 0) / 5, -1, 1);
    // 6: Sector strength
    features[6] = clamp(safeNum(marketSnap.sectorChg, 0) / 5, -1, 1);
    // 7: Beta normalized
    features[7] = clamp(safeNum(marketSnap.beta, 1) / 2, 0, 1);
    // 8: Spread (tighter = better, so invert)
    features[8] = 1 - clamp(safeNum(marketSnap.spreadBps, 5) / 30, 0, 1);
    // 9: IV percentile
    features[9] = clamp(safeNum(marketSnap.ivPct, 50) / 100, 0, 1);

    // 10: Severity
    features[10] = clamp(safeNum(finding.severity, 1) / 3, 0, 1);

    // 11-15: setup-type one-hot via keyword matching
    const tag = ((meta.setup || finding.type || '') + ' ' + (meta.bias || '')).toLowerCase();
    features[11] = /bull|long|breakout|reclaim|momentum-extension|oversold|sweep-call/.test(tag) ? 1 : 0;
    features[12] = /bear|short|breakdown|rejection|overbought|sweep-put/.test(tag) ? 1 : 0;
    features[13] = /momentum|breakout|reclaim|continuation|trend/.test(tag) ? 1 : 0;
    features[14] = /reversion|reversal|oversold|overbought|fade|mean/.test(tag) ? 1 : 0;
    features[15] = /breakout|52w|breakdown|squeeze|cup|flag/.test(tag) ? 1 : 0;

    // 16: Brain weight (per-symbol learned multiplier)
    features[16] = clamp((safeNum(marketSnap.brainWeight, 1) - 0.5) / 1.1, 0, 1);

    // 17: Regime score
    features[17] = clamp(safeNum(marketSnap.regimeScore, 50) / 100, 0, 1);

    // 18: VIX normalized
    features[18] = clamp((safeNum(marketSnap.vix, 18) - 10) / 40, 0, 1);

    // 19: Coincident findings
    features[19] = clamp(safeNum(marketSnap.coincident, 1) / 10, 0, 1);

    // 20: Hour of session (0-1)
    // Audit pass 119 (CRITICAL for non-ET users): was new Date().getHours() —
    // local time. For a user in PT, that's 3 hours behind ET. Market opens
    // 6:30am PT = 9:30am ET; with local getHours() the feature reported
    // hour=6.5, clamped to 0 ("before market open") even when ET market
    // was active. Result: the entire 22-feature vector had a consistently
    // wrong feature[20] for non-ET-time-zone users — directly corrupting
    // every prediction the brain made for that user.
    const now = new Date(finding.ts || Date.now());
    let etHour = 9.5;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour12: false, hour: '2-digit', minute: '2-digit'
      }).formatToParts(now);
      let hh = 0, mm = 0;
      for (const p of parts) {
        if (p.type === 'hour') hh = parseInt(p.value, 10) % 24;
        if (p.type === 'minute') mm = parseInt(p.value, 10);
      }
      etHour = hh + mm / 60;
    } catch (e) {
      etHour = now.getHours() + now.getMinutes() / 60;  // last-resort fallback
    }
    const sessStart = 9.5, sessEnd = 16;
    features[20] = clamp((etHour - sessStart) / (sessEnd - sessStart), 0, 1);

    // 21: bias
    features[21] = 1;

    return features;
  },

  /** Capture current market state for a symbol (used both at emit-time + train-time)
   *  CRITICAL: never inject Math.random() into features. If a feature cannot be
   *  computed from real data, return a NEUTRAL default (0.5 after normalization)
   *  and flag the snapshot as 'degraded'. Random noise in features prevents the
   *  brain from learning anything no matter how good the labels are.
   */
  snapshotMarket(sym) {
    try {
      const q = (typeof window !== 'undefined' && window.QUOTES && window.QUOTES[sym]) ? window.QUOTES[sym] : null;
      const spy = (typeof window !== 'undefined' && window.QUOTES && window.QUOTES.SPY) ? window.QUOTES.SPY : null;
      const vxx = (typeof window !== 'undefined' && window.QUOTES && window.QUOTES.VXX) ? window.QUOTES.VXX : null;
      const learn = (function () { try { return JSON.parse(localStorage.getItem('bpleone_learn_v1') || '{}'); } catch (e) { return {}; } })();
      const state = (function () { try { return JSON.parse(localStorage.getItem('bpleone_brain_loop_state_v1') || '{}'); } catch (e) { return {}; } })();
      const findings = (function () { try { return JSON.parse(localStorage.getItem('bpleone_brain_findings_v1') || '{"items":[]}').items; } catch (e) { return []; } })();
      const coincident = findings.filter(f => f.meta && f.meta.sym === sym && (Date.now() - f.ts) < 4 * 3600 * 1000).length;
      const isReal = q && q.priceSource && q.priceSource !== 'stale-seed' && q.priceSource !== 'mock';
      // Day range %, computed from real dayHigh/dayLow if Stooq provided them.
      // Without bar history we cannot compute real ATR — leave as neutral.
      const dayRangePct = (isReal && q.dayHigh && q.dayLow) ? ((q.dayHigh - q.dayLow) / q.last * 100) : null;
      // RVOL needs avgVolume from history — we don't have it without a richer feed.
      // Default to 1.0 (neutral) until a real avg-volume source is wired.
      return {
        // RSI: needs 14-period history. Without it, return neutral 50.
        rsi: 50,
        // ATR%: use day range if real; otherwise neutral 2%.
        atrPct: dayRangePct != null ? dayRangePct : 2,
        // RVOL: needs avg history. Neutral 1.0 until provider sends.
        rvol: 1.0,
        // Distance from 50/200 MAs: needs MA series. Neutral 0 (= at MA) until provided.
        dist50: 0,
        dist200: 0,
        // Real % changes from QUOTES (these ARE valid even from a single-snapshot feed).
        spyChg: isReal && spy && spy.priceSource && spy.priceSource !== 'stale-seed' ? (spy.changePct || 0) : 0,
        sectorChg: 0,
        beta: 1.0,
        // Spread: bid-ask from real source if available; else neutral 5bps.
        spreadBps: (isReal && q.bid && q.ask) ? Math.max(1, ((q.ask - q.bid) / q.last) * 10000) : 5,
        ivPct: 50,
        brainWeight: (learn.symbols && learn.symbols[sym] && learn.symbols[sym].w) || 1.0,
        regimeScore: state.regimeScore || 50,
        vix: vxx && vxx.priceSource && vxx.priceSource !== 'stale-seed' ? vxx.last : 18,
        coincident,
        // Integrity flags so downstream can decide whether to trust this snapshot
        priceSource: q ? q.priceSource : 'none',
        isReal,
        liveAt: q ? q.liveAt : 0,
        degraded: !isReal || dayRangePct == null  // many features default to neutral
      };
    } catch (e) { return { degraded: true, isReal: false }; }
  }
};

class Model {
  constructor(n) {
    n = n || FEATURES.length;
    this.weights = new Array(n).fill(0);
    this.weights[n - 1] = 0; // bias starts at 0
    this.n_trained = 0;
    this.n_hits = 0;
    this.n_misses = 0;
    this.lr = 0.05;
    this.l2 = 0.0005; // L2 regularization strength (weight decay)
    this.lossHistory = [];
    this.accHistory = [];
    this.version = 1;
    this.lastTrainTs = 0;
    this.createdTs = Date.now();
    // ---- ADAM OPTIMIZER STATE ----
    // m = first moment (running gradient average)
    // v = second moment (running squared-gradient average)
    // Adam converges faster than plain SGD with less manual tuning of LR.
    // Reference: Kingma & Ba 2014.
    this.optimizer = 'adam';  // 'adam' or 'sgd'
    this.m = new Array(n).fill(0);
    this.v = new Array(n).fill(0);
    this.adamBeta1 = 0.9;
    this.adamBeta2 = 0.999;
    this.adamEps = 1e-8;
    this.adamStep = 0;
  }

  sigmoid(z) {
    // Audit pass 15: NaN-safe. If z is NaN/Infinity (corrupted weights, bad
    // feature row), return 0.5 (no signal) instead of NaN which would poison
    // every downstream calibration + sizing calc.
    if (!isFinite(z)) return 0.5;
    z = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-z));
  }

  /** Returns {prob: 0..1, score: 0..100, contributions: Array} */
  predict(x) {
    let z = 0;
    const contributions = [];
    for (let i = 0; i < x.length; i++) {
      const contrib = x[i] * this.weights[i];
      z += contrib;
      contributions.push({ feature: FEATURES[i], value: x[i], weight: this.weights[i], contrib });
    }
    const prob = this.sigmoid(z);
    return { prob, score: Math.round(prob * 100), z, contributions };
  }

  /** Train one sample. y in {0, 1}. Returns {loss, p}.
   *  FEATURE IMPORTANCE: if window.FeatureImportance is loaded, applies
   *  per-feature learning-rate multipliers so high-alpha features train
   *  faster and low-alpha features train slower (auto-pruning).
   *
   *  OPTIMIZER: defaults to Adam (adaptive moments). Falls back to plain
   *  SGD if this.optimizer === 'sgd'. Adam state (m, v) auto-initialized
   *  in constructor; deserialize() also restores them if present.
   */
  train(x, y) {
    const { prob } = this.predict(x);
    let err = prob - y;
    // CONFIDENCE PENALTY: entropy regularization. Adds β × (prob - 0.5) to
    // the gradient, biasing the model away from peaked outputs. Disabled by
    // default (β=0.05 if enabled). Reduces overconfidence; complements label
    // smoothing.
    if (typeof window !== 'undefined' && window.ConfidencePenalty && window.ConfidencePenalty.enabled()) {
      err += window.ConfidencePenalty.gradAdjustment(prob);
    }
    const hasImportance = typeof window !== 'undefined' && window.FeatureImportance && typeof window.FeatureImportance.lrMultiplier === 'function';

    // Ensure Adam state arrays exist (for models deserialized before Adam upgrade)
    if (!this.m || this.m.length !== x.length) this.m = new Array(x.length).fill(0);
    if (!this.v || this.v.length !== x.length) this.v = new Array(x.length).fill(0);

    if (this.optimizer === 'adam') {
      this.adamStep++;
      const b1 = this.adamBeta1, b2 = this.adamBeta2, eps = this.adamEps;
      const b1Pow = 1 - Math.pow(b1, this.adamStep);
      const b2Pow = 1 - Math.pow(b2, this.adamStep);
      for (let i = 0; i < x.length; i++) {
        const lrMult = hasImportance ? window.FeatureImportance.lrMultiplier(i) : 1.0;
        const decay = (i === x.length - 1) ? 0 : this.l2 * this.weights[i];
        const grad = err * x[i] + decay;
        // First moment (running mean of gradient)
        this.m[i] = b1 * this.m[i] + (1 - b1) * grad;
        // Second moment (running mean of squared gradient)
        this.v[i] = b2 * this.v[i] + (1 - b2) * grad * grad;
        // Bias-corrected estimates
        const mHat = this.m[i] / b1Pow;
        const vHat = this.v[i] / b2Pow;
        // Adam update with feature-importance multiplier on the effective LR
        this.weights[i] -= this.lr * lrMult * mHat / (Math.sqrt(vHat) + eps);
      }
    } else {
      // Legacy SGD path
      for (let i = 0; i < x.length; i++) {
        const lrMult = hasImportance ? window.FeatureImportance.lrMultiplier(i) : 1.0;
        const decay = (i === x.length - 1) ? 0 : this.l2 * this.weights[i];
        this.weights[i] -= this.lr * lrMult * (err * x[i] + decay);
      }
    }

    const loss = -(y * Math.log(Math.max(1e-9, prob)) + (1 - y) * Math.log(Math.max(1e-9, 1 - prob)));
    this.n_trained++;
    if (y === 1) this.n_hits++; else this.n_misses++;
    this.lossHistory.push({ ts: Date.now(), loss, p: prob, y });
    if (this.lossHistory.length > 1000) this.lossHistory.shift();
    // Rolling accuracy
    const correct = (prob >= 0.5 ? 1 : 0) === y;
    this.accHistory.push(correct ? 1 : 0);
    if (this.accHistory.length > 100) this.accHistory.shift();
    this.lastTrainTs = Date.now();
    return { loss, prob, correct };
  }

  rollingAccuracy() {
    if (this.accHistory.length === 0) return 0;
    return this.accHistory.reduce((s, v) => s + v, 0) / this.accHistory.length;
  }

  featureImportance() {
    return FEATURES.map((f, i) => ({
      feature: f,
      weight: this.weights[i],
      abs: Math.abs(this.weights[i])
    })).sort((a, b) => b.abs - a.abs);
  }

  serialize() {
    return {
      weights: this.weights.slice(),
      n_trained: this.n_trained,
      n_hits: this.n_hits,
      n_misses: this.n_misses,
      version: this.version,
      lr: this.lr,
      lossHistory: this.lossHistory.slice(-200),
      accHistory: this.accHistory.slice(),
      lastTrainTs: this.lastTrainTs,
      createdTs: this.createdTs,
      // Audit pass 40: persist Adam optimizer state. Without these the m/v
      // running moments reset every page reload, effectively re-warming the
      // optimizer from zero every session and discarding accumulated curvature
      // information. The model still trained, but slower and less stably.
      optimizer: this.optimizer,
      m: this.m ? this.m.slice() : null,
      v: this.v ? this.v.slice() : null,
      adamStep: this.adamStep,
      adamBeta1: this.adamBeta1,
      adamBeta2: this.adamBeta2,
      adamEps: this.adamEps
    };
  }

  deserialize(d) {
    if (!d) return;
    this.weights = (d.weights && d.weights.length === FEATURES.length) ? d.weights.slice() : new Array(FEATURES.length).fill(0);
    this.n_trained = d.n_trained || 0;
    this.n_hits = d.n_hits || 0;
    this.n_misses = d.n_misses || 0;
    this.version = d.version || 1;
    this.lr = d.lr || 0.05;
    this.lossHistory = d.lossHistory || [];
    this.accHistory = d.accHistory || [];
    this.lastTrainTs = d.lastTrainTs || 0;
    this.createdTs = d.createdTs || Date.now();
    // Audit pass 40: restore Adam state. Falls back to zero-initialized arrays
    // for older saved models that pre-date Adam. train() also has length-mismatch
    // guards so this is defensive in depth.
    this.optimizer = d.optimizer || 'adam';
    this.m = (d.m && d.m.length === FEATURES.length) ? d.m.slice() : new Array(FEATURES.length).fill(0);
    this.v = (d.v && d.v.length === FEATURES.length) ? d.v.slice() : new Array(FEATURES.length).fill(0);
    this.adamStep = d.adamStep || 0;
    this.adamBeta1 = d.adamBeta1 || 0.9;
    this.adamBeta2 = d.adamBeta2 || 0.999;
    this.adamEps = d.adamEps || 1e-8;
  }
}

const ModelStore = {
  KEY: 'bpleone_model_v1',
  VERSIONS_KEY: 'bpleone_model_versions_v1',
  TRAIN_DATA_KEY: 'bpleone_train_data_v1',

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      const m = new Model();
      if (d) m.deserialize(d);
      return m;
    } catch (e) { return new Model(); }
  },

  save(model) {
    try { localStorage.setItem(this.KEY, JSON.stringify(model.serialize())); } catch (e) {}
  },

  saveVersion(model, label) {
    try {
      const versions = this.versions();
      versions.unshift({ ...model.serialize(), label: label || ('v' + model.version), savedAt: Date.now() });
      if (versions.length > 50) versions.length = 50;
      localStorage.setItem(this.VERSIONS_KEY, JSON.stringify(versions));
    } catch (e) {}
  },

  versions() {
    try { return JSON.parse(localStorage.getItem(this.VERSIONS_KEY) || '[]'); } catch (e) { return []; }
  },

  promote(versionIdx) {
    try {
      const versions = this.versions();
      const v = versions[versionIdx];
      if (!v) return false;
      const m = new Model();
      m.deserialize(v);
      m.version = m.version + 1;
      this.save(m);
      this.saveVersion(m, 'promoted ' + (v.label || ''));
      return m;
    } catch (e) { return false; }
  },

  /** Append a labeled training row. Used for retraining and export. */
  addTrainingRow(features, label, meta) {
    try {
      const rows = this.getTrainingData();
      rows.unshift({ ts: Date.now(), features, label, meta: meta || {} });
      if (rows.length > 5000) rows.length = 5000;
      localStorage.setItem(this.TRAIN_DATA_KEY, JSON.stringify(rows));
    } catch (e) {}
  },

  getTrainingData() {
    try { return JSON.parse(localStorage.getItem(this.TRAIN_DATA_KEY) || '[]'); } catch (e) { return []; }
  },

  clearTrainingData() {
    try { localStorage.removeItem(this.TRAIN_DATA_KEY); } catch (e) {}
  }
};

const ModelTrainer = {
  /** Train one mini-batch from newly-rated outcomes that haven't been trained on yet. */
  trainBatch() {
    const model = ModelStore.load();
    let trained = 0;
    let lossSum = 0;
    try {
      const findings = JSON.parse(localStorage.getItem('bpleone_brain_findings_v1') || '{"items":[]}').items;
      const state = JSON.parse(localStorage.getItem('bpleone_brain_loop_state_v1') || '{}');
      const fed = state.fedFindings || {};
      const trainedIds = new Set((state.trainedFindings || []));

      // DATA INTEGRITY: opt-in flag to allow training on mock-data findings.
      // Default behavior is to SKIP synthetic data so the brain never learns from fake prices.
      const allowMock = !!(window.BPLEONE_ALLOW_MOCK_TRAINING);
      let skippedMock = 0;

      findings.forEach(f => {
        if (!f.outcome || trainedIds.has(f.id)) return;
        // Outcomes that aren't trainable
        if (f.outcome === 'flat' || f.outcome === 'unknown' || f.outcome === 'unrateable-stale-data') {
          trainedIds.add(f.id); // skip neutral / unrateable forever
          return;
        }
        if (f.outcome !== 'hit' && f.outcome !== 'miss') {
          trainedIds.add(f.id);
          return;
        }
        // Skip findings whose underlying prices came from mock data.
        // Untagged findings are treated as mock (legacy, pre-tag).
        const src = f.dataSource || 'mock';
        if (src !== 'live' && !allowMock) {
          skippedMock++;
          return;
        }
        // Build feature vector — prefer stored snapshot, else regenerate
        const features = f.features || FeatureExtractor.extract(f);
        const label = f.outcome === 'hit' ? 1 : 0;
        // Apply label smoothing if enabled — prevents overconfidence by
        // training on y=0.025 / y=0.975 instead of 0/1
        const trainLabel = (typeof window !== 'undefined' && window.LabelSmoothing && window.LabelSmoothing.enabled())
          ? window.LabelSmoothing.smooth(label) : label;
        const { loss } = model.train(features, trainLabel);
        ModelStore.addTrainingRow(features, label, { id: f.id, sym: f.meta && f.meta.sym, setup: f.meta && f.meta.setup, dataSource: src });
        trainedIds.add(f.id);
        trained++;
        lossSum += loss;
      });
      if (skippedMock > 0) {
        try { window.BPLEONE_LAST_SKIPPED_MOCK = skippedMock; } catch (e) {}
      }

      if (trained > 0) {
        state.trainedFindings = Array.from(trainedIds).slice(-2000);
        localStorage.setItem('bpleone_brain_loop_state_v1', JSON.stringify(state));
        ModelStore.save(model);
        // Dispatch event for live trainers
        try {
          window.dispatchEvent(new CustomEvent('bpleone:model-trained', {
            detail: { batchSize: trained, avgLoss: lossSum / trained, model: model.serialize() }
          }));
        } catch (e) {}
      }
    } catch (e) {}
    return { trained, avgLoss: trained > 0 ? lossSum / trained : 0, model };
  },

  /** Full re-fit from all stored training data. Use when feature schema changes. */
  fullRetrain(epochs) {
    epochs = epochs || 3;
    const model = new Model();
    const data = ModelStore.getTrainingData();
    let totalLoss = 0;
    for (let e = 0; e < epochs; e++) {
      // Audit pass 109: was `data.slice().sort(() => Math.random() - 0.5)` —
      // the "random comparator" pattern is biased (V8's sort isn't uniform
      // when the comparator is random). Fisher-Yates gives a true uniform
      // shuffle — important for stochastic gradient descent ordering.
      const shuffled = data.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
      }
      shuffled.forEach(row => {
        if (row.features && row.features.length === FEATURES.length) {
          const { loss } = model.train(row.features, row.label);
          totalLoss += loss;
        }
      });
    }
    ModelStore.save(model);
    ModelStore.saveVersion(model, 'fullRetrain × ' + epochs + ' epochs · ' + data.length + ' samples');
    return { model, samples: data.length, epochs, avgLoss: data.length > 0 ? totalLoss / (data.length * epochs) : 0 };
  },

  /** Evaluate current model on stored training data. */
  evaluate() {
    const model = ModelStore.load();
    const data = ModelStore.getTrainingData();
    if (data.length === 0) return { acc: 0, n: 0, tp: 0, fp: 0, tn: 0, fn: 0 };
    let tp = 0, fp = 0, tn = 0, fn = 0;
    data.forEach(row => {
      if (!row.features || row.features.length !== FEATURES.length) return;
      const { prob } = model.predict(row.features);
      const pred = prob >= 0.5 ? 1 : 0;
      if (pred === 1 && row.label === 1) tp++;
      else if (pred === 1 && row.label === 0) fp++;
      else if (pred === 0 && row.label === 0) tn++;
      else fn++;
    });
    const total = tp + fp + tn + fn;
    const acc = total > 0 ? (tp + tn) / total : 0;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
    return { n: total, acc, tp, fp, tn, fn, precision, recall, f1 };
  }
};

/**
 * DEPRECATED: this used to seed 200 synthetic Math.random() rows and train the
 * model on them so it would 'be useful from minute one'. That was wrong —
 * training on random features just makes the model produce confident garbage
 * predictions. The honest default is a blank model that returns 0.5 (neutral)
 * for everything until real labeled trades come in.
 *
 * Function is kept callable for explicit opt-in via model-seed.html, but it
 * is NO LONGER called automatically. It tags every row with priceSource='mock'
 * and dataSource='mock' so the trainer correctly refuses to use them.
 */
function autoSeedIfNeeded() {
  // Default behavior is now to do NOTHING. The model stays at default weights
  // (predictions = 0.5) until real labeled trades fill the training set.
  // To force a synthetic seed, call ModelStore.forceSyntheticSeed() explicitly.
  return false;
}

/** Internal: only call from explicit user action (e.g. model-seed.html). */
function _generateSyntheticSeed(force) {
  try {
    if (!force && localStorage.getItem('bpleone_model_autoseeded_v1')) return false;
    const existing = ModelStore.getTrainingData();
    if (existing.length > 30 && !force) return false; // user has real data — don't pollute
    const SETUP_PRIORS = [
      { name: '52w-breakout', hr: 0.62, mom: 1, brk: 1, bull: 1 },
      { name: 'bull-flag', hr: 0.58, mom: 1, brk: 0, bull: 1 },
      { name: 'vwap-reclaim', hr: 0.54, mom: 1, brk: 0, bull: 1 },
      { name: 'oversold-bounce', hr: 0.58, mom: 0, brk: 0, bull: 1, rev: 1 },
      { name: 'overbought-fade', hr: 0.52, mom: 0, brk: 0, bull: 0, rev: 1 },
      { name: 'bb-squeeze', hr: 0.63, mom: 0, brk: 1, bull: 0 },
      { name: '50ma-breakdown', hr: 0.53, mom: 1, brk: 0, bull: 0 },
      { name: 'sweep-call', hr: 0.45, mom: 0, brk: 0, bull: 1 },
      { name: 'sweep-put', hr: 0.39, mom: 0, brk: 0, bull: 0 },
      { name: 'dp-bid-lift', hr: 0.61, mom: 0, brk: 0, bull: 1 },
      { name: 'confluence-6star', hr: 0.68, mom: 1, brk: 1, bull: 1 }
    ];
    function genRow(prior) {
      const isHit = Math.random() < prior.hr;
      const winBonus = isHit ? 0.15 : -0.10;
      const features = new Array(FEATURES.length).fill(0);
      features[0] = Math.max(0, Math.min(1, (prior.bull ? 0.45 : 0.55) + winBonus + (Math.random() - 0.5) * 0.3));
      features[1] = 0.25 + (Math.random() - 0.5) * 0.3;
      features[2] = Math.max(0, Math.min(1, 0.4 + winBonus + Math.random() * 0.3));
      features[3] = Math.max(-1, Math.min(1, (prior.bull ? 0.3 : -0.3) + (Math.random() - 0.5) * 0.4));
      features[4] = features[3] * 0.7 + (Math.random() - 0.5) * 0.3;
      features[5] = Math.max(-1, Math.min(1, (prior.bull ? 0.2 : -0.2) + (Math.random() - 0.5) * 0.6));
      features[6] = Math.max(-1, Math.min(1, (prior.bull ? 0.15 : -0.15) + winBonus * 2 + (Math.random() - 0.5) * 0.5));
      features[7] = 0.4 + Math.random() * 0.4;
      features[8] = Math.max(0, Math.min(1, 0.7 + winBonus * 1.5 + Math.random() * 0.2));
      features[9] = 0.5 + (Math.random() - 0.5) * 0.6;
      features[10] = 0.4 + (isHit ? 0.2 : 0) + Math.random() * 0.3;
      features[11] = prior.bull ? 1 : 0;
      features[12] = !prior.bull && !prior.rev ? 1 : 0;
      features[13] = prior.mom ? 1 : 0;
      features[14] = prior.rev ? 1 : 0;
      features[15] = prior.brk ? 1 : 0;
      features[16] = Math.max(0, Math.min(1, 0.5 + winBonus * 1.5 + (Math.random() - 0.5) * 0.3));
      features[17] = Math.max(0, Math.min(1, (prior.bull ? 0.55 : 0.45) + winBonus * 2 + Math.random() * 0.2));
      features[18] = 0.3 + (Math.random() - 0.5) * 0.4;
      features[19] = Math.max(0, Math.min(1, 0.2 + winBonus * 3 + Math.random() * 0.3));
      features[20] = Math.random();
      features[21] = 1;
      return { features, label: isHit ? 1 : 0, setup: prior.name };
    }

    const rows = [];
    for (let i = 0; i < 200; i++) {
      const prior = SETUP_PRIORS[Math.floor(Math.random() * SETUP_PRIORS.length)];
      rows.push(genRow(prior));
    }
    const model = new Model();
    for (let e = 0; e < 3; e++) {
      const sh = rows.slice().sort(() => Math.random() - 0.5);
      sh.forEach(r => model.train(r.features, r.label));
    }
    // Tag every synthetic row explicitly so the trainer refuses to use them
    // unless explicitly opted in. priceSource='mock' + dataSource='mock' makes
    // them invisible to the live-only training path.
    rows.forEach(r => ModelStore.addTrainingRow(r.features, r.label, {
      sym: 'AUTOSEED',
      setup: r.setup,
      dataSource: 'mock',
      priceSource: 'mock',
      synthetic: true
    }));
    ModelStore.save(model);
    ModelStore.saveVersion(model, 'synthetic-seed (200 rows × 3 epochs)');
    localStorage.setItem('bpleone_model_autoseeded_v1', String(Date.now()));
    try { window.dispatchEvent(new CustomEvent('bpleone:model-autoseeded', { detail: { rows: 200 } })); } catch (e) {}
    return true;
  } catch (e) { return false; }
}

/**
 * Convenience: predict P(win) for an existing brain finding.
 * Returns {prob, score, contributions} or null if features missing.
 */
function predictForFinding(f) {
  if (!f) return null;
  const features = f.features || FeatureExtractor.extract(f);
  if (!features) return null;
  const model = ModelStore.load();
  return model.predict(features);
}

/**
 * Drift detection: compute brain's recent hit-rate vs long-term.
 * Returns {recentHR, lifetimeHR, drift, alert}
 */
function detectDrift() {
  try {
    const state = JSON.parse(localStorage.getItem('bpleone_brain_loop_state_v1') || '{}');
    const fed = Object.values(state.fedFindings || {});
    if (fed.length < 30) return { recentHR: 0, lifetimeHR: 0, drift: 0, alert: false, n: fed.length };
    const decided = fed.filter(f => f.outcome === 'hit' || f.outcome === 'miss');
    if (decided.length < 30) return { recentHR: 0, lifetimeHR: 0, drift: 0, alert: false, n: decided.length };
    decided.sort((a, b) => a.ts - b.ts);
    const lifetimeHits = decided.filter(f => f.outcome === 'hit').length;
    const lifetimeHR = lifetimeHits / decided.length;
    const recent = decided.slice(-30);
    const recentHits = recent.filter(f => f.outcome === 'hit').length;
    const recentHR = recentHits / recent.length;
    const drift = recentHR - lifetimeHR;
    return { recentHR, lifetimeHR, drift, alert: drift < -0.15, n: decided.length };
  } catch (e) { return { recentHR: 0, lifetimeHR: 0, drift: 0, alert: false, n: 0 }; }
}

if (typeof window !== 'undefined') {
  window.Model = Model;
  window.FEATURES = FEATURES;
  window.FeatureExtractor = FeatureExtractor;
  window.ModelStore = ModelStore;
  window.ModelTrainer = ModelTrainer;
  window.predictForFinding = predictForFinding;
  window.detectDrift = detectDrift;

  // Auto-seed on first load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(autoSeedIfNeeded, 500));
  } else {
    setTimeout(autoSeedIfNeeded, 500);
  }
}
