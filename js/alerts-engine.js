/* ===========================================
   BPLEONE TRADING - SETUP-FIRING ALERTS ENGINE
   ---
   Background service. Runs on every page that loads it.
   Watches the configured symbol universe via Feed.
   On a NEW high-conviction setup transition:
     - logs to localStorage (recent alerts feed)
     - fires browser Notify (if granted)
     - posts to Discord webhook (if configured)
     - dispatches 'bpleone:alert' window event for other pages
   Dedup is per (symbol, setup) for 1 hour by default.
   ---
   Public API:
     AlertsEngine.config()
     AlertsEngine.setConfig(cfg)        -> { symbols, minScore, enabled, muteUntil }
     AlertsEngine.recent(n?)            -> last N fired alerts
     AlertsEngine.clear()
     AlertsEngine.mute(minutes)         -> snooze
     AlertsEngine.fire(alertObj)        -> manual fire (used by tests)
   =========================================== */

const AlertsEngine = (function () {
  const CFG_KEY = 'bpleone_alerts_cfg_v1';
  const LOG_KEY = 'bpleone_alerts_log_v1';
  const LAST_TAG_KEY = 'bpleone_alerts_last_tag_v1';
  const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'AMD', 'COIN', 'PLTR', 'BTC', 'ETH', 'GLD', 'SLV', 'USO'];
  const DEFAULT_CFG = {
    enabled: true,
    symbols: DEFAULT_SYMBOLS,
    minScore: 0.78,           // adj score threshold
    dedupHours: 1,
    muteUntil: 0,
    soundOn: false,
    desktopOn: true,
    discordOn: true
  };

  function loadCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (!raw) return Object.assign({}, DEFAULT_CFG);
      return Object.assign({}, DEFAULT_CFG, JSON.parse(raw));
    } catch (e) { return Object.assign({}, DEFAULT_CFG); }
  }
  function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} }

  function loadLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '{"items":[]}'); }
    catch (e) { return { items: [] }; }
  }
  function saveLog(l) { try { localStorage.setItem(LOG_KEY, JSON.stringify(l)); } catch (e) {} }

  function loadLastTags() {
    try { return JSON.parse(localStorage.getItem(LAST_TAG_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveLastTags(m) { try { localStorage.setItem(LAST_TAG_KEY, JSON.stringify(m)); } catch (e) {} }

  function biasFromTag(tag) {
    const bullTags = ['volume-breakout', '52w-break', 'unusual-call', '50ma-reclaim', 'macd-cross', 'momentum-extension', 'bull-flag', 'cup-handle', 'vwap-reclaim', 'continuation-bull'];
    const bearTags = ['flush-on-volume', 'breakdown', 'unusual-put', 'bear-flag', 'overbought-fade', 'vwap-rejection', 'continuation-bear', 'bb-stretch-up'];
    if (bullTags.indexOf(tag) !== -1) return 'bull';
    if (bearTags.indexOf(tag) !== -1) return 'bear';
    if (tag === 'oversold-mean-revert' || tag === 'bb-stretch-down') return 'bull';
    return 'neutral';
  }

  function fire(alert) {
    const cfg = loadCfg();
    if (!cfg.enabled) return false;
    if (cfg.muteUntil && Date.now() < cfg.muteUntil) return false;
    // Dedup
    const log = loadLog();
    const dedupKey = alert.sym + '|' + alert.setup;
    const ttl = (cfg.dedupHours || 1) * 60 * 60 * 1000;
    const recent = log.items.find(x => x.dedupKey === dedupKey && Date.now() - x.ts < ttl);
    if (recent) return false;
    const entry = Object.assign({ id: 'al_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), ts: Date.now(), dedupKey }, alert);
    log.items.unshift(entry);
    if (log.items.length > 200) log.items.pop();
    saveLog(log);

    // Notify
    if (cfg.desktopOn && typeof Notify !== 'undefined' && Notify.permission && Notify.permission() === 'granted') {
      try {
        Notify.fire(
          '⚡ ' + alert.sym + ' · ' + alert.setup,
          (alert.bias === 'bull' ? 'LONG' : alert.bias === 'bear' ? 'SHORT' : '•') + ' setup at $' + (+alert.last).toFixed(2) + ' · score ' + (+alert.score).toFixed(2)
        );
      } catch (e) {}
    }
    // Discord
    if (cfg.discordOn && typeof DiscordAlerts !== 'undefined' && DiscordAlerts.url()) {
      try {
        DiscordAlerts.signal({ sym: alert.sym, setup: alert.setup, score: alert.score, last: alert.last, bias: alert.bias, reasons: alert.reasons });
      } catch (e) {}
    }
    // Sound (lightweight)
    if (cfg.soundOn) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = alert.bias === 'bear' ? 320 : 660; g.gain.value = 0.04;
        o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 220);
      } catch (e) {}
    }
    // Dispatch DOM event so any open page can react
    try {
      window.dispatchEvent(new CustomEvent('bpleone:alert', { detail: entry }));
    } catch (e) {}
    return true;
  }

  function scanOnce() {
    if (typeof QUOTES === 'undefined' || typeof Learn === 'undefined' || typeof TA === 'undefined') return;
    const cfg = loadCfg();
    if (!cfg.enabled) return;
    if (cfg.muteUntil && Date.now() < cfg.muteUntil) return;
    const lastTags = loadLastTags();
    let changed = false;
    cfg.symbols.forEach(sym => {
      const q = QUOTES[sym];
      if (!q || !q.last) return;
      const snap = TA.snapshot(sym);
      const features = {
        last: q.last, prevClose: q.prevClose, dayHigh: q.dayHigh, dayLow: q.dayLow,
        volume: q.volume, avgVolume: q.avgVolume,
        rsi: snap ? snap.rsi : null,
        macd: snap ? snap.macd : null, macdHist: snap ? snap.hist : null,
        ma50: snap ? (snap.sma50 || snap.ema50) : null,
        ma200: snap ? (snap.sma200 || snap.ema200) : null,
        atr: snap ? snap.atr : null, atrPct: snap ? snap.atrPct : null,
        adx: snap ? snap.adx : null, bbPct: snap ? snap.bbPct : null,
        vwapDist: snap ? snap.vwapDist : null,
        donchUp: snap ? snap.donchUp : null, donchDn: snap ? snap.donchDn : null,
        trend: snap ? snap.trend : null, trendStrong: snap ? snap.trendStrong : null,
        regime: snap ? snap.regime : null, rvol: snap ? snap.rvol : null
      };
      const tag = Learn.autoTagSetup(features, { symbol: sym });
      if (!tag || !tag.tag) return;
      const weight = typeof Learn.weightFor === 'function' ? Learn.weightFor(tag.tag, { symbol: sym }) : 1.0;
      const adj = tag.score * weight;
      const prev = lastTags[sym];
      if (prev && prev.tag === tag.tag) {
        return; // no transition
      }
      // Transition detected — fire if conviction high
      lastTags[sym] = { tag: tag.tag, ts: Date.now() };
      changed = true;
      if (adj < cfg.minScore) return;
      const bias = biasFromTag(tag.tag);
      fire({
        sym, setup: tag.tag, score: adj, last: q.last,
        bias, reasons: tag.reasons || [],
        from: prev ? prev.tag : null
      });
    });
    if (changed) saveLastTags(lastTags);
  }

  // Throttle scans — 1.5s minimum between full universe sweeps
  let lastScanAt = 0;
  function scheduleScan() {
    const now = Date.now();
    if (now - lastScanAt < 1500) return;
    lastScanAt = now;
    scanOnce();
  }

  // Auto-hook into Feed when libs are ready
  function bootstrap() {
    if (typeof Feed !== 'undefined' && typeof Learn !== 'undefined' && typeof TA !== 'undefined') {
      Feed.subscribe('*', () => scheduleScan());
      // Also periodic poll so it works even without ticks (re-tag on TA-snapshot changes)
      setInterval(scheduleScan, 5000);
      return;
    }
    setTimeout(bootstrap, 500);
  }
  setTimeout(bootstrap, 800);

  function config() { return loadCfg(); }
  function setConfig(patch) {
    const cfg = Object.assign({}, loadCfg(), patch);
    saveCfg(cfg);
    return cfg;
  }
  function recent(n) {
    const log = loadLog();
    return (log.items || []).slice(0, n || 50);
  }
  function clear() { saveLog({ items: [] }); }
  function mute(minutes) {
    const c = loadCfg();
    c.muteUntil = Date.now() + (minutes || 60) * 60 * 1000;
    saveCfg(c);
    return c;
  }

  return { config, setConfig, recent, clear, mute, fire, scanOnce };
})();

if (typeof window !== 'undefined') window.AlertsEngine = AlertsEngine;
