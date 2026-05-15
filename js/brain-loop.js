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
      dedupKey
    };
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

  return { start, stop, recent, clear, emit, tickHighConviction, tickWeightShift, tickConfluence };
})();
if (typeof window !== 'undefined') window.BrainLoop = BrainLoop;
