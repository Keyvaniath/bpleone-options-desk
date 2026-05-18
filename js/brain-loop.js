/* ===========================================
   BPLEONE TRADING - AUTONOMOUS BRAIN LOOP
   ---
   Background self-learning runtime. Runs on EVERY
   page that loads app.js (auto-loaded).
   ---
   Cadence:
     every 60s   — scan universe for adj-score ≥ 0.8 setups, log new ones
     every 5m    — detect weight shifts vs prior snapshot, log significant ones
     every 15m   — scan for confluence (6-star) setups, log
     every 60m   — write "hourly digest" (top setups, sentiment, regime), post to Discord
   ---
   All findings → bpleone_brain_findings_v1 (capped at 500 most recent)
   ---
   Public:
     BrainLoop.start()            — auto-called on load
     BrainLoop.stop()
     BrainLoop.recent(n)
     BrainLoop.clear()
     BrainLoop.tick(label)        — manual force-fire any tick
   =========================================== */

const BrainLoop = (function () {
  const FINDINGS_KEY = 'bpleone_brain_findings_v1';
  const STATE_KEY = 'bpleone_brain_loop_state_v1';
  const MAX_FINDINGS = 500;

  // Universe to scan
  const UNIVERSE = ['SPY','QQQ','IWM','NVDA','TSLA','AAPL','MSFT','META','AMZN','GOOGL','AMD','COIN','PLTR','SMCI','NFLX','CRM','ORCL','AVGO','MU','BTC','ETH','GLD','SLV','USO','XLK','XLE','XLF','VXX'];

  function loadFindings() { try { return JSON.parse(localStorage.getItem(FINDINGS_KEY) || '{"items":[]}'); } catch (e) { return { items: [] }; } }
  function saveFindings(f) { try { localStorage.setItem(FINDINGS_KEY, JSON.stringify(f)); } catch (e) {} }
  function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; } }
  function saveState(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {} }

  function biasFromTag(tag) {
    const bull = ['volume-breakout','52w-break','50ma-reclaim','macd-cross','bull-flag','cup-handle','vwap-reclaim','momentum-extension','continuation-bull','oversold-mean-revert'];
    const bear = ['flush-on-volume','breakdown','bear-flag','vwap-rejection','overbought-fade','continuation-bear','bb-stretch-up'];
    if (bull.indexOf(tag) !== -1) return 'long';
    if (bear.indexOf(tag) !== -1) return 'short';
    return 'neutral';
  }

  function emit(type, severity, title, body, meta) {
    const findings = loadFindings();
    // Dedup: same (type, meta.sym, meta.setup) within 1 hour
    const dedupKey = type + '|' + (meta && meta.sym ? meta.sym : '') + '|' + (meta && meta.setup ? meta.setup : '');
    const cutoff = Date.now() - 60 * 60 * 1000;
    if (findings.items.find(f => f.dedupKey === dedupKey && f.ts > cutoff)) return null;
    const f = {
      id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      ts: Date.now(),
      type, severity, title, body, meta: meta || {},
      dedupKey,
      // ---- DATA INTEGRITY: tag every finding with the source of its underlying prices.
      // The ML trainer skips 'mock' findings so the brain never learns from synthetic data.
      dataSource: (typeof window !== 'undefined' && window.BPLEONE_DATA_MODE) || 'mock'
    };
    // ---- ML: snapshot feature vector + model prediction at emit time ----
    try {
      if (typeof window !== 'undefined' && window.FeatureExtractor && window.ModelStore) {
        f.features = window.FeatureExtractor.extract(f);
        const model = window.ModelStore.load();
        const pred = model.predict(f.features);
        f.modelProb = pred.prob;
        f.modelScore = pred.score;
        f.modelVersion = model.version;
      }
    } catch (e) {}
    findings.items.unshift(f);
    if (findings.items.length > MAX_FINDINGS) findings.items.length = MAX_FINDINGS;
    saveFindings(findings);
    // Dispatch DOM event so live pages can react
    try { window.dispatchEvent(new CustomEvent('bpleone:brain-finding', { detail: f })); } catch (e) {}
    // Post critical findings to Discord (deduped server-side too)
    if (severity === 'high' && typeof DiscordAlerts !== 'undefined' && DiscordAlerts.url()) {
      try {
        DiscordAlerts.fire('🧠 ' + title + ' · ' + body, { dedupKey: 'brain:' + dedupKey + ':' + new Date().toLocaleDateString('en-US'), dedupTtl: 6 * 60 * 60 * 1000 });
      } catch (e) {}
    }
    // ---- High-conviction ML push notification ----
    // Trigger if model says >= 0.78 AND severity is high/3-star
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
          && (severity === 'high' || severity === 3)
          && f.modelProb && f.modelProb >= 0.78) {
        const sym = (meta && meta.sym) || 'MKT';
        // Dedup on this exact notification within 30 min
        const notifKey = 'mlnotif:' + sym + ':' + (f.modelProb >= 0.85 ? 'extreme' : 'high');
        const state = loadState();
        if (!state.notifSent) state.notifSent = {};
        const lastSent = state.notifSent[notifKey] || 0;
        if (Date.now() - lastSent > 30 * 60 * 1000) {
          state.notifSent[notifKey] = Date.now();
          saveState(state);
          new Notification('🧬 ML high-confidence · ' + sym, {
            body: 'Model: ' + (f.modelProb * 100).toFixed(0) + '% confidence · ' + title,
            icon: '/favicon.svg',
            tag: notifKey
          });
        }
      }
    } catch (e) {}
    return f;
  }

  // --- Tick: high-conviction live setups ---
  function tickHighConviction() {
    if (typeof QUOTES === 'undefined' || typeof Learn === 'undefined') return;
    UNIVERSE.forEach(sym => {
      const q = QUOTES[sym];
      if (!q || !q.last) return;
      const snap = (typeof TA !== 'undefined') ? TA.snapshot(sym) : null;
      const features = {
        last: q.last, prevClose: q.prevClose, dayHigh: q.dayHigh, dayLow: q.dayLow,
        volume: q.volume, avgVolume: q.avgVolume,
        rsi: snap ? snap.rsi : null, macdHist: snap ? snap.hist : null,
        atrPct: snap ? snap.atrPct : null, adx: snap ? snap.adx : null,
        bbPct: snap ? snap.bbPct : null, vwapDist: snap ? snap.vwapDist : null,
        trend: snap ? snap.trend : null, regime: snap ? snap.regime : null,
        donchUp: snap ? snap.donchUp : null, donchDn: snap ? snap.donchDn : null
      };
      const tag = Learn.autoTagSetup(features, { symbol: sym });
      const weight = Learn.weightFor ? Learn.weightFor(tag.tag, { symbol: sym }) : 1.0;
      const adj = tag.score * weight;
      if (adj >= 0.85) {
        const bias = biasFromTag(tag.tag);
        if (bias === 'neutral') return;
        emit(
          'high-conviction-signal',
          'high',
          sym + ' · ' + tag.tag + ' adj-score ' + adj.toFixed(2),
          (tag.reasons || []).join(' · ') + ' · last $' + q.last.toFixed(2) + ' (' + (q.changePct >= 0 ? '+' : '') + (q.changePct || 0).toFixed(2) + '%)',
          { sym, setup: tag.tag, score: adj, bias, last: q.last, weight }
        );
      }
    });
  }

  // --- Tick: weight shifts ---
  function tickWeightShift() {
    if (typeof Learn === 'undefined' || !Learn.getWeights) return;
    const state = loadState();
    const prev = state.lastWeights || {};
    const curr = Learn.getWeights();
    let shifted = false;
    Object.entries(curr).forEach(([setup, w]) => {
      const oldW = prev[setup] != null ? prev[setup] : 1.0;
      const delta = w - oldW;
      if (Math.abs(delta) >= 0.04) {
        shifted = true;
        emit(
          'weight-shift',
          Math.abs(delta) >= 0.08 ? 'high' : 'medium',
          setup + ' weight ' + (delta >= 0 ? 'rose' : 'fell') + ' to ' + w.toFixed(2),
          'Was ' + oldW.toFixed(2) + ', now ' + w.toFixed(2) + ' (Δ ' + (delta >= 0 ? '+' : '') + delta.toFixed(3) + '). ' + (delta > 0 ? 'Brain trusts this setup more now.' : 'Brain trusts this setup less now.'),
          { setup, oldW, newW: w, delta }
        );
      }
    });
    state.lastWeights = curr;
    saveState(state);
    return shifted;
  }

  // --- Tick: confluence (6-star) detection ---
  function tickConfluence() {
    if (typeof QUOTES === 'undefined' || typeof Learn === 'undefined') return;
    // Cross-reference TA score + ADX + rvol + insider buying + sentiment
    let insiderCache = {};
    let sentCache = {};
    try { insiderCache = JSON.parse(localStorage.getItem('bpleone_insider_cache_v1') || '{"tx":{}}').tx || {}; } catch (e) {}
    try { sentCache = JSON.parse(localStorage.getItem('bpleone_sentiment_cache_v1') || '{}'); } catch (e) {}

    UNIVERSE.forEach(sym => {
      const q = QUOTES[sym];
      if (!q || !q.last) return;
      const snap = (typeof TA !== 'undefined') ? TA.snapshot(sym) : null;
      const features = {
        last: q.last, prevClose: q.prevClose, dayHigh: q.dayHigh, dayLow: q.dayLow,
        volume: q.volume, avgVolume: q.avgVolume,
        rsi: snap ? snap.rsi : null, atrPct: snap ? snap.atrPct : null, adx: snap ? snap.adx : null,
        trend: snap ? snap.trend : null, regime: snap ? snap.regime : null,
        donchUp: snap ? snap.donchUp : null, donchDn: snap ? snap.donchDn : null
      };
      const tag = Learn.autoTagSetup(features, { symbol: sym });
      const weight = Learn.weightFor ? Learn.weightFor(tag.tag, { symbol: sym }) : 1.0;
      const adj = tag.score * weight;
      const bias = biasFromTag(tag.tag);
      if (bias === 'neutral') return;

      const signals = [];
      if (adj >= 0.7) signals.push('TA setup');
      if (snap && snap.adx >= 25) signals.push('strong trend');
      if (snap && snap.rvol > 1.3) signals.push('rvol>1.3x');
      // Insider check
      const insTx = (insiderCache[sym] && insiderCache[sym].data) || [];
      const cutoff = Date.now() - 30 * 86400000;
      const netDollars = insTx.filter(t => t.ts > cutoff).reduce((s, t) => s + (t.type === 'buy' ? t.value : -t.value), 0);
      if ((bias === 'long' && netDollars > 250000) || (bias === 'short' && netDollars < -1000000)) signals.push('insider flow');
      // Sentiment
      const sentE = sentCache[sym];
      if (sentE && sentE.data && sentE.data.composite != null) {
        const sc = sentE.data.composite;
        if ((bias === 'long' && sc > 0.15) || (bias === 'short' && sc < -0.15)) signals.push('sentiment');
      }
      if (signals.length >= 5) {
        emit('confluence-6star', 'high', sym + ' · ' + signals.length + '/6 signals stacking · ' + bias.toUpperCase(),
          signals.join(' + ') + ' · setup: ' + tag.tag + ' adj ' + adj.toFixed(2),
          { sym, setup: tag.tag, signals, bias, adj });
      }
    });
  }

  // --- Outcome tracker: rate past findings against forward price moves ---
  // Looks at "high-conviction-signal" findings from 30+ min ago, checks what the symbol did since,
  // tags them with outcome ('hit' / 'miss' / 'flat') so we can compute hit-rate over time.
  function tickOutcomes() {
    if (typeof QUOTES === 'undefined') return;
    const findings = loadFindings();
    let changed = false;
    findings.items.forEach(f => {
      if (f.outcome) return; // already rated
      if (f.type !== 'high-conviction-signal' && f.type !== 'confluence-6star') return;
      const age = Date.now() - f.ts;
      // Wait at least 30 min before rating
      if (age < 30 * 60 * 1000) return;
      const sym = f.meta && f.meta.sym;
      const entryPx = f.meta && f.meta.last;
      const bias = f.meta && f.meta.bias;
      if (!sym || !entryPx || !bias) { f.outcome = 'unknown'; changed = true; return; }
      const q = QUOTES[sym];
      if (!q || !q.last) return;
      // DATA INTEGRITY: refuse to rate the outcome unless BOTH the entry price
      // came from a real source (the finding itself must have dataSource='live')
      // AND the current exit price is from a real source with a recent update.
      const entryIsReal = f.dataSource === 'live';
      const exitIsReal = q.priceSource && q.priceSource !== 'stale-seed' && q.priceSource !== 'mock' && q.liveAt && (Date.now() - q.liveAt) < 60 * 60 * 1000;
      if (!entryIsReal || !exitIsReal) {
        // Mark unrateable so it never trains. Don't try again unless data improves.
        f.outcome = 'unrateable-stale-data';
        f.outcomeRatedAt = Date.now();
        changed = true;
        return;
      }
      const move = ((q.last - entryPx) / entryPx) * 100;
      // Bias-adjusted: for short, positive R = price went DOWN
      const signedMove = bias === 'short' ? -move : move;
      // After 30+ min, rate as:
      //   hit if signedMove ≥ 0.5%
      //   miss if signedMove ≤ -0.5%
      //   flat otherwise
      let outcome;
      if (signedMove >= 0.5) outcome = 'hit';
      else if (signedMove <= -0.5) outcome = 'miss';
      else outcome = 'flat';
      f.outcome = outcome;
      f.realizedPct = +signedMove.toFixed(2);
      f.outcomeRatedAt = Date.now();
      changed = true;
    });
    if (changed) saveFindings(findings);
  }

  // --- ML feedback: nudge per-symbol weight when outcome rated ---
  function tickMLFeedback() {
    if (typeof Learn === 'undefined' || !Learn.load) return;
    const findings = loadFindings();
    const state = loadState();
    if (!state.fedFindings) state.fedFindings = {};
    let nudged = 0;
    findings.items.forEach(f => {
      if (!f.outcome || f.outcome === 'unknown') return;
      if (state.fedFindings[f.id]) return; // already fed back
      const sym = f.meta && f.meta.sym;
      const setup = f.meta && f.meta.setup;
      if (!sym || !setup) return;
      // Subtle nudge to per-symbol weight: +0.005 for hit, -0.005 for miss, 0 for flat
      try {
        const data = Learn.load();
        if (!data.symbolWeights) data.symbolWeights = {};
        if (!data.symbolWeights[sym]) data.symbolWeights[sym] = {};
        const entry = data.symbolWeights[sym][setup] || { w: 1.0, n: 0, expectancy: 0 };
        const delta = f.outcome === 'hit' ? 0.005 : f.outcome === 'miss' ? -0.005 : 0;
        entry.w = Math.max(0.5, Math.min(1.6, entry.w + delta));
        entry.n = (entry.n || 0) + 1;
        data.symbolWeights[sym][setup] = entry;
        try { localStorage.setItem('bpleone_learn_v1', JSON.stringify(data)); } catch (e) {}
        state.fedFindings[f.id] = { ts: Date.now(), outcome: f.outcome, delta };
        nudged++;
      } catch (e) {}
    });
    if (nudged > 0) {
      saveState(state);
      emit('ml-feedback', 'low', 'ML feedback ran', `Adjusted ${nudged} per-symbol weights from outcome ratings (hit=+0.005, miss=-0.005)`, { nudged });
    }
    // ---- Train the actual ML model on new rated outcomes ----
    try {
      if (typeof window !== 'undefined' && window.ModelTrainer) {
        const result = window.ModelTrainer.trainBatch();
        if (result.trained > 0) {
          emit('model-trained', 'low', 'Model trained · batch',
            `Trained on ${result.trained} new outcomes. Avg loss: ${result.avgLoss.toFixed(3)}. n_trained: ${result.model.n_trained}, rolling acc: ${(result.model.rollingAccuracy() * 100).toFixed(1)}%`,
            { batchSize: result.trained, avgLoss: result.avgLoss, n_trained: result.model.n_trained });
        }
      }
    } catch (e) {}
  }

  // --- Regime detector ---
  function tickRegimeDetect() {
    if (typeof QUOTES === 'undefined') return;
    function getChg(sym) { return (QUOTES[sym] && typeof QUOTES[sym].changePct === 'number') ? QUOTES[sym].changePct : 0; }
    const spy = getChg('SPY'), vxx = getChg('VXX'), tlt = getChg('TLT'), hyg = getChg('HYG'), uup = getChg('UUP'), gld = getChg('GLD');
    const score = Math.max(0, Math.min(100, 50 + spy*5 + hyg*6 - vxx*4 - uup*3 - gld*2 + tlt));
    const state = loadState();
    const prev = state.regimeScore;
    state.regimeScore = score;
    state.regimeTs = Date.now();
    saveState(state);
    // Emit regime shift if changes by 20+ points
    if (typeof prev === 'number' && Math.abs(score - prev) >= 20) {
      const dir = score > prev ? 'RISK-ON pivot' : 'RISK-OFF pivot';
      const label = score >= 65 ? 'RISK-ON' : score >= 45 ? 'NEUTRAL' : score >= 30 ? 'CAUTION' : 'RISK-OFF';
      emit('regime-shift', 'high', dir + ' — ' + label, 'Cross-asset regime composite moved from ' + prev.toFixed(0) + ' to ' + score.toFixed(0) + '. Rebalance bias toward ' + label.toLowerCase() + '.', { from: prev, to: score, label });
    }
  }

  // --- Conviction stack snapshot ---
  function tickConvictionSnapshot() {
    const findings = loadFindings();
    const now = Date.now();
    const four = 4 * 60 * 60 * 1000;
    const recent = findings.items.filter(f => (now - f.ts) < four);
    // Group by symbol
    const bySym = {};
    // Audit pass 59: severity is emitted as a STRING ('high'/'medium'/'low')
    // by every emit() call site, but the old code did `(f.severity || 1) * 8`
    // which coerces 'high' → NaN → score becomes NaN. Map to a numeric
    // multiplier first.
    function sevWeight(s) {
      if (typeof s === 'number' && isFinite(s)) return s;
      if (s === 'high' || s === 'critical') return 3;
      if (s === 'medium') return 2;
      if (s === 'low') return 1;
      return 1;
    }
    recent.forEach(f => {
      const sym = f.meta && f.meta.sym;
      if (!sym) return;
      const contrib = sevWeight(f.severity) * 8 * Math.exp(-(now - f.ts) / (2.5 * 3.6e6));
      if (!bySym[sym]) bySym[sym] = { sym, score: 0 };
      bySym[sym].score += contrib;
    });
    const stack = Object.values(bySym).map(s => ({ ...s, score: Math.min(100, Math.round(s.score)) }))
      .sort((a, b) => b.score - a.score).slice(0, 10);
    const state = loadState();
    state.convictionSnapshot = { ts: now, stack };
    saveState(state);
  }

  // --- Drift detection ---
  function tickDriftCheck() {
    try {
      if (typeof window === 'undefined' || !window.detectDrift) return;
      const d = window.detectDrift();
      if (d.alert) {
        const state = loadState();
        const lastAlert = state.lastDriftAlertTs || 0;
        // Cooldown 6h
        if (Date.now() - lastAlert < 6 * 60 * 60 * 1000) return;
        state.lastDriftAlertTs = Date.now();
        saveState(state);
        emit('drift-alert', 'high', 'Model performance drift detected',
          'Recent hit rate ' + (d.recentHR * 100).toFixed(1) + '% vs lifetime ' + (d.lifetimeHR * 100).toFixed(1) + '% (delta ' + (d.drift * 100).toFixed(1) + '%). Consider full retrain or snapshot rollback.',
          { recentHR: d.recentHR, lifetimeHR: d.lifetimeHR, drift: d.drift, n: d.n });
      }
    } catch (e) {}
  }

  // --- Hourly digest ---
  function tickHourlyDigest() {
    const findings = loadFindings();
    const cutoff = Date.now() - 60 * 60 * 1000;
    const recent = findings.items.filter(f => f.ts > cutoff);
    const bySev = { high: 0, medium: 0, low: 0 };
    recent.forEach(f => { if (bySev[f.severity] != null) bySev[f.severity]++; });
    const summary = recent.length + ' findings in last hour (' + bySev.high + ' high, ' + bySev.medium + ' med). Top: ' +
      recent.slice(0, 3).map(f => f.meta && f.meta.sym ? f.meta.sym : f.type).join(', ');
    emit('hourly-digest', 'medium', 'Hourly brain digest', summary, { count: recent.length, ...bySev });
  }

  // Cadences
  let timers = [];
  function start() {
    stop();
    // Stagger so they don't all fire at once
    setTimeout(() => { tickHighConviction(); timers.push(setInterval(tickHighConviction, 60 * 1000)); }, 5000);
    setTimeout(() => { tickWeightShift(); timers.push(setInterval(tickWeightShift, 5 * 60 * 1000)); }, 8000);
    setTimeout(() => { tickConfluence(); timers.push(setInterval(tickConfluence, 15 * 60 * 1000)); }, 12000);
    // Outcome rating + ML feedback — every 5 min
    setTimeout(() => { tickOutcomes(); tickMLFeedback(); timers.push(setInterval(() => { tickOutcomes(); tickMLFeedback(); }, 5 * 60 * 1000)); }, 15000);
    // Regime detection every 5 min
    setTimeout(() => { tickRegimeDetect(); timers.push(setInterval(tickRegimeDetect, 5 * 60 * 1000)); }, 18000);
    // Conviction stack snapshot every 2 min
    setTimeout(() => { tickConvictionSnapshot(); timers.push(setInterval(tickConvictionSnapshot, 2 * 60 * 1000)); }, 20000);
    // Drift detection every 15 min
    setTimeout(() => { tickDriftCheck(); timers.push(setInterval(tickDriftCheck, 15 * 60 * 1000)); }, 22000);
    // Hourly digest aligned to clock minute :30
    const minToHalf = (90 - (new Date().getMinutes() * 60 + new Date().getSeconds()) % 3600 / 60) % 60;
    setTimeout(() => { tickHourlyDigest(); timers.push(setInterval(tickHourlyDigest, 60 * 60 * 1000)); }, Math.max(15000, minToHalf * 60 * 1000));
  }
  function stop() { timers.forEach(t => clearInterval(t)); timers = []; }

  function recent(n) {
    return loadFindings().items.slice(0, n || 50);
  }
  function clear() { saveFindings({ items: [] }); }

  // Auto-start on load
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(start, 1500));
    } else {
      setTimeout(start, 1500);
    }
  }

  return { start, stop, recent, clear, emit, tickHighConviction, tickWeightShift, tickConfluence, tickOutcomes, tickMLFeedback, tickRegimeDetect, tickConvictionSnapshot, tickHourlyDigest, tickDriftCheck };
})();
if (typeof window !== 'undefined') window.BrainLoop = BrainLoop;
