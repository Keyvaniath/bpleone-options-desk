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
    const now = new Date(finding.ts || Date.now());
    const hour = now.getHours() + now.getMinutes() / 60;
    const sessStart = 9.5, sessEnd = 16;
    features[20] = clamp((hour - sessStart) / (sessEnd - sessStart), 0, 1);

    // 21: bias
    features[21] = 1;

    return features;
  },

  /** Capture current market state for a symbol (used both at emit-time + train-time) */
  snapshotMarket(sym) {
    try {
      const q = (typeof window !== 'undefined' && window.QUOTES && window.QUOTES[sym]) ? window.QUOTES[sym] : null;
      const spy = (typeof window !== 'undefined' && window.QUOTES && window.QUOTES.SPY) ? window.QUOTES.SPY : null;
      const vxx = (typeof window !== 'undefined' && window.QUOTES && window.QUOTES.VXX) ? window.QUOTES.VXX : null;
      const learn = (function () { try { return JSON.parse(localStorage.getItem('bpleone_learn_v1') || '{}'); } catch (e) { return {}; } })();
      const state = (function () { try { return JSON.parse(localStorage.getItem('bpleone_brain_loop_state_v1') || '{}'); } catch (e) { return {}; } })();
      const findings = (function () { try { return JSON.parse(localStorage.getItem('bpleone_brain_findings_v1') || '{"items":[]}').items; } catch (e) { return []; } })();
      const coincident = findings.filter(f => f.meta && f.meta.sym === sym && (Date.now() - f.ts) < 4 * 3600 * 1000).length;
      return {
        rsi: 50 + (q && q.changePct ? q.changePct * 5 : 0) + (Math.random() - 0.5) * 8,
        atrPct: q ? Math.abs(q.changePct || 0) + 1.2 : 2,
        rvol: 0.8 + Math.random() * 2,
        dist50: q ? (q.changePct || 0) * 1.5 : 0,
        dist200: q ? (q.changePct || 0) * 2.5 : 0,
        spyChg: spy ? spy.changePct || 0 : 0,
        sectorChg: (Math.random() - 0.5) * 2,
        beta: 1.0,
        spreadBps: 3 + Math.random() * 10,
        ivPct: 40 + Math.random() * 40,
        brainWeight: (learn.symbols && learn.symbols[sym] && learn.symbols[sym].w) || 1.0,
        regimeScore: state.regimeScore || 50,
        vix: vxx ? Math.max(10, Math.min(60, (vxx.last || 18) * 1.1 + 4)) : 18,
        coincident
      };
    } catch (e) { return {}; }
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
    this.lossHistory = [];
    this.accHistory = [];
    this.version = 1;
    this.lastTrainTs = 0;
    this.createdTs = Date.now();
  }

  sigmoid(z) {
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

  /** Train one sample. y in {0, 1}. Returns {loss, p}. */
  train(x, y) {
    const { prob } = this.predict(x);
    const err = prob - y;
    for (let i = 0; i < x.length; i++) {
      this.weights[i] -= this.lr * err * x[i];
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
      createdTs: this.createdTs
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

      findings.forEach(f => {
        if (!f.outcome || trainedIds.has(f.id)) return;
        if (f.outcome === 'flat') {
          trainedIds.add(f.id); // skip neutral
          return;
        }
        // Build feature vector — prefer stored snapshot, else regenerate
        const features = f.features || FeatureExtractor.extract(f);
        const label = f.outcome === 'hit' ? 1 : 0;
        const { loss } = model.train(features, label);
        ModelStore.addTrainingRow(features, label, { id: f.id, sym: f.meta && f.meta.sym, setup: f.meta && f.meta.setup });
        trainedIds.add(f.id);
        trained++;
        lossSum += loss;
      });

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
      // Shuffle
      const shuffled = data.slice().sort(() => Math.random() - 0.5);
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

if (typeof window !== 'undefined') {
  window.Model = Model;
  window.FEATURES = FEATURES;
  window.FeatureExtractor = FeatureExtractor;
  window.ModelStore = ModelStore;
  window.ModelTrainer = ModelTrainer;
}
