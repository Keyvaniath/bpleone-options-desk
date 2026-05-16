/* ===========================================
   BPLEONE TRADING - SELF-LEARNING MODULE
   ---
   Tracks every trade idea outcome in localStorage,
   scores patterns by realized expectancy, and
   feeds confidence scores back into signals.
   =========================================== */

const Learn = (function () {
  const KEY = 'bpleone_learn_v1';
  const SCHEMA = {
    version: 1,
    trades: [],       // every closed idea: { id, ts, symbol, setup, sector, bias, score, entry, exit, stop, target, result, R, holdDays, notes }
    signals: [],      // every signal seen: { id, ts, symbol, type, score, fired, outcome? }
    counters: {},     // arbitrary KPIs the system rolls up
    weights: {        // signal-type weights — adjust based on rolling expectancy
      'macd-cross': 1.0, '50ma-reclaim': 1.0, 'bull-flag': 1.0,
      'cup-handle': 1.0, 'unusual-call': 1.0, 'unusual-put': 1.0,
      '52w-break': 1.0, 'rsi-divergence': 1.0, 'volume-breakout': 1.0,
      'gamma-squeeze': 1.0, 'sweep': 1.0, 'block': 1.0
    }
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(SCHEMA));
      const obj = JSON.parse(raw);
      // hydrate missing weights
      Object.keys(SCHEMA.weights).forEach(k => { if (!(k in obj.weights)) obj.weights[k] = 1.0; });
      return obj;
    } catch (e) {
      return JSON.parse(JSON.stringify(SCHEMA));
    }
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---- Public API ----
  // Capture market context at entry (called automatically by recordTrade).
  // Returns { spyChg, vixLevel, vixRegime, breadthPct, tod, dayOfMonth, dowChord }
  function captureMarketContext() {
    const ctx = { capturedAt: Date.now() };
    try {
      if (typeof QUOTES !== 'undefined') {
        if (QUOTES.SPY) ctx.spyChg = +(QUOTES.SPY.changePct || 0).toFixed(2);
        if (QUOTES.QQQ) ctx.qqqChg = +(QUOTES.QQQ.changePct || 0).toFixed(2);
        if (QUOTES.VIX) ctx.vixLevel = +(QUOTES.VIX.last || 0).toFixed(2);
        if (QUOTES.BTC) ctx.btcChg = +(QUOTES.BTC.changePct || 0).toFixed(2);
        if (QUOTES.TLT) ctx.tltChg = +(QUOTES.TLT.changePct || 0).toFixed(2);
        const arr = Object.values(QUOTES).filter(q => q.fresh && isFinite(q.changePct) && q.symbol !== 'VIX');
        if (arr.length) {
          const adv = arr.filter(q => q.changePct > 0).length;
          ctx.breadthPct = +((adv / arr.length) * 100).toFixed(1);
        }
      }
      ctx.vixRegime = ctx.vixLevel == null ? 'unknown' : (ctx.vixLevel < 14 ? 'low' : ctx.vixLevel < 20 ? 'normal' : ctx.vixLevel < 30 ? 'elevated' : 'panic');
      const now = new Date();
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const h = et.getHours(), m = et.getMinutes();
      const minSinceOpen = (h - 9) * 60 + (m - 30);
      if (minSinceOpen < 0) ctx.tod = 'pre-market';
      else if (minSinceOpen < 30) ctx.tod = 'open';                  // first 30 min
      else if (minSinceOpen < 180) ctx.tod = 'morning';               // 10-12 ET
      else if (minSinceOpen < 270) ctx.tod = 'mid-day';               // 12-2 ET
      else if (minSinceOpen < 360) ctx.tod = 'afternoon';             // 2-3:30 ET
      else if (minSinceOpen < 390) ctx.tod = 'close';                 // last 30 min
      else ctx.tod = 'after-hours';
      ctx.dow = et.toLocaleDateString('en-US', { weekday: 'short' });
      ctx.dayOfMonth = et.getDate();
    } catch (e) {}
    return ctx;
  }

  // Auto-tag a setup type from observable features at entry.
  // Pulls real indicators from TA engine if available, falls back to ctx fields.
  // Returns ALL matching tags (with scores) so callers can detect setup combos.
  function autoTagSetup(ctx, opts) {
    opts = opts || {};
    // If a symbol is provided and TA is available, enrich ctx with real indicators
    if (opts.symbol && typeof TA !== 'undefined') {
      const snap = TA.snapshot(opts.symbol);
      if (snap) {
        ctx = Object.assign({}, ctx, {
          last: snap.last || ctx.last,
          rsi: snap.rsi != null ? snap.rsi : ctx.rsi,
          rsi15: snap.rsi15,
          rsiD: snap.rsiD,
          macd: snap.macd != null ? snap.macd : ctx.macd,
          macdHist: snap.hist,
          macdSignal: snap.signal,
          ema20: snap.ema20,
          ema50: snap.ema50,
          ema200: snap.ema200,
          ma50: snap.sma50 || snap.ema50 || ctx.ma50,
          ma200: snap.sma200 || snap.ema200 || ctx.ma200,
          atr: snap.atr,
          atrPct: snap.atrPct,
          adx: snap.adx,
          bbPct: snap.bbPct,
          vwap: snap.vwap,
          vwapDist: snap.vwapDist,
          donchUp: snap.donchUp,
          donchDn: snap.donchDn,
          trend: snap.trend,
          trendStrong: snap.trendStrong,
          regime: snap.regime,
          rvol: snap.rvol || ctx.rvol
        });
      }
    }

    const pct = ctx.last && ctx.prevClose ? (ctx.last / ctx.prevClose - 1) * 100 : 0;
    const rvol = ctx.rvol || (ctx.avgVolume && ctx.volume ? ctx.volume / ctx.avgVolume : null);
    const above50 = ctx.ma50 ? ctx.last >= ctx.ma50 : null;
    const above200 = ctx.ma200 ? ctx.last >= ctx.ma200 : null;
    const rsi = ctx.rsi;
    const macd = ctx.macd;
    const macdHist = ctx.macdHist;
    const adx = ctx.adx;
    const bbPct = ctx.bbPct;
    const vwapDist = ctx.vwapDist;
    const trend = ctx.trend;
    const trendStrong = ctx.trendStrong;
    const regime = ctx.regime;

    // Build a list of every setup that matches — sorted by score (highest first).
    const hits = [];
    function add(tag, score, ...reasons) { hits.push({ tag, score, reasons }); }

    // VOLUME / BREAKOUTS
    if (rvol && rvol > 2.5 && pct > 3) add('volume-breakout', 0.92, 'rvol>2.5x', 'pct>3%');
    if (rvol && rvol > 2 && pct < -3) add('flush-on-volume', 0.85, 'rvol>2x', 'pct<-3%');
    if (ctx.donchUp && ctx.last >= ctx.donchUp * 0.999) add('52w-break', 0.88, 'breaking 20-bar high');
    if (ctx.donchDn && ctx.last <= ctx.donchDn * 1.001) add('breakdown', 0.85, 'breaking 20-bar low');

    // UNUSUAL OPTIONS
    if (ctx.unusual === 'call' && pct > 0) add('unusual-call', 0.80, 'unusual call flow');
    if (ctx.unusual === 'put' && pct < 0) add('unusual-put', 0.78, 'unusual put flow');

    // MA RECLAIM
    if (above50 === true && ctx.ma50 && Math.abs(ctx.last - ctx.ma50) / ctx.ma50 < 0.005 && macd != null && macd > 0) {
      add('50ma-reclaim', 0.82, 'within 0.5% of 50DMA', 'MACD>0');
    }
    if (above200 === true && above50 === false && pct > 0 && trend === 'uptrend') {
      add('cup-handle', 0.74, 'above 200DMA', 'below 50DMA', 'long-base reclaim');
    }

    // MOMENTUM
    if (macdHist != null && macdHist > 0 && rsi != null && rsi > 50 && rsi < 70 && pct > 0) {
      add('macd-cross', 0.80, 'MACD hist>0', 'RSI 50-70');
    }
    if (rsi != null && rsi > 70 && pct > 1 && trendStrong) {
      add('momentum-extension', 0.74, 'RSI>70', 'ADX>25', 'strong trend');
    }
    if (rsi != null && rsi < 30 && pct < -1) add('oversold-mean-revert', 0.65, 'RSI<30', 'pct<-1%');
    if (rsi != null && rsi > 70 && pct > 1 && !trendStrong) {
      add('overbought-fade', 0.55, 'RSI>70 in chop');
    }

    // BOLLINGER BAND
    if (bbPct != null && bbPct > 1 && rsi > 65) add('bb-stretch-up', 0.62, 'price > upper BB', 'RSI>65');
    if (bbPct != null && bbPct < 0 && rsi < 35) add('bb-stretch-down', 0.62, 'price < lower BB', 'RSI<35');

    // SQUEEZE / COMPRESSION
    if (regime === 'compressed' && adx != null && adx < 20) {
      add('vol-squeeze', 0.68, 'ATR compressed', 'ADX<20', 'breakout setup');
    }

    // VWAP
    if (vwapDist != null && vwapDist > 0 && vwapDist < 1 && pct > 0 && trend === 'uptrend') {
      add('vwap-reclaim', 0.70, 'just reclaimed VWAP', 'in uptrend');
    }
    if (vwapDist != null && vwapDist < 0 && vwapDist > -1 && pct < 0 && trend === 'downtrend') {
      add('vwap-rejection', 0.68, 'rejected at VWAP', 'in downtrend');
    }

    // FLAGS
    if (pct > 1 && rvol && rvol > 1.3 && trend === 'uptrend') add('bull-flag', 0.72, 'momentum + rvol>1.3x', 'in uptrend');
    if (pct < -1 && rvol && rvol > 1.3 && trend === 'downtrend') add('bear-flag', 0.70, 'momentum down + rvol>1.3x', 'in downtrend');

    // FALLBACKS (only if nothing else fired)
    if (!hits.length) {
      if (pct > 0.5) hits.push({ tag: 'continuation-bull', score: 0.55, reasons: ['weak-signal upward'] });
      else if (pct < -0.5) hits.push({ tag: 'continuation-bear', score: 0.55, reasons: ['weak-signal downward'] });
      else hits.push({ tag: 'consolidation', score: 0.30, reasons: ['no strong feature'] });
    }

    // Sort by score desc
    hits.sort((a, b) => b.score - a.score);
    const top = hits[0];
    // Return primary tag (back-compat) plus the full hit list so callers can detect combos
    return Object.assign({}, top, { allTags: hits.map(h => h.tag), allHits: hits });
  }

  function recordTrade(t) {
    const state = load();
    const trade = Object.assign({
      id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      ts: Date.now(),
      result: null, R: null,
      mfe: null, mae: null,                  // max favorable / adverse excursion (price)
      mfeR: null, maeR: null,                // same in R-multiples
      marketCtx: captureMarketContext()      // SPY/VIX/breadth/tod at entry
    }, t);
    // If caller didn't specify setup, try auto-tagging from t.entryFeatures
    if (!trade.setup && t.entryFeatures) {
      const auto = autoTagSetup(t.entryFeatures, { symbol: t.symbol });
      trade.setup = auto.tag;
      trade.autoTagged = true;
      trade.autoTagReasons = auto.reasons;
      // Capture every matched setup so combo-analyzer can find them later
      if (auto.allTags && auto.allTags.length > 1) {
        trade.allTags = auto.allTags;
        trade.allHits = auto.allHits;
      }
    }
    // Snapshot the TA reading at entry so we can study what conditions favored each setup
    if (t.symbol && typeof TA !== 'undefined') {
      try {
        const snap = TA.snapshot(t.symbol);
        if (snap) {
          trade.taSnap = {
            rsi: snap.rsi, rsi15: snap.rsi15, rsiD: snap.rsiD,
            macd: snap.macd, hist: snap.hist,
            atr: snap.atr, atrPct: snap.atrPct, adx: snap.adx,
            bbPct: snap.bbPct, vwapDist: snap.vwapDist,
            trend: snap.trend, trendStrong: snap.trendStrong, regime: snap.regime,
            rvol: snap.rvol
          };
        }
      } catch (e) {}
    }
    state.trades.push(trade);
    save(state);
    return trade;
  }

  // Update MFE / MAE while a trade is open. Call this on every tick that matters.
  function updateExcursion(id, currentPrice) {
    const state = load();
    const t = state.trades.find(x => x.id === id);
    if (!t || t.result) return;
    const stopDist = t.bias === 'bull' ? (t.entry - t.stop) : (t.stop - t.entry);
    const moveIn = t.bias === 'bull' ? (currentPrice - t.entry) : (t.entry - currentPrice);
    if (t.mfe == null || moveIn > t.mfe) {
      t.mfe = +moveIn.toFixed(4);
      t.mfeR = stopDist ? +(moveIn / Math.abs(stopDist)).toFixed(2) : 0;
    }
    if (t.mae == null || moveIn < t.mae) {
      t.mae = +moveIn.toFixed(4);
      t.maeR = stopDist ? +(moveIn / Math.abs(stopDist)).toFixed(2) : 0;
    }
    save(state);
  }

  function closeTrade(id, exit, reasonTag) {
    const state = load();
    const trade = state.trades.find(x => x.id === id);
    if (!trade) return null;
    trade.exit = exit;
    trade.closeReason = reasonTag || 'manual';
    trade.closedTs = Date.now();
    trade.holdDays = (trade.closedTs - trade.ts) / 86400000;
    const stopDist = trade.bias === 'bull' ? (trade.entry - trade.stop) : (trade.stop - trade.entry);
    const pnl = trade.bias === 'bull' ? (exit - trade.entry) : (trade.entry - exit);
    trade.pnl = pnl;
    trade.R = stopDist ? +(pnl / Math.abs(stopDist)).toFixed(2) : 0;
    trade.result = trade.R >= 0 ? 'win' : 'loss';
    // Final-update MFE/MAE with exit price in case it's the extreme
    updateExcursion(id, exit);
    // Efficiency: how much of MFE did we capture?
    if (trade.mfeR != null && trade.mfeR > 0) {
      trade.efficiency = +Math.max(0, Math.min(1, trade.R / trade.mfeR)).toFixed(2);
    }
    save(state);
    rebalanceWeights();
    return trade;
  }

  // Re-weight signal types based on rolling realized expectancy.
  // Upgrades:
  //   1) DRIFT DECAY: trades > 90 days old get exponentially less weight
  //   2) CONFIDENCE SHRINKAGE: weights with low n shrink toward 1.0 (Bayesian-ish)
  //   3) PER-SYMBOL WEIGHTS: separate edge file per symbol so SPY/TSLA specialize
  function _computeWeight(arr, halfLifeDays, fullTrustAt) {
    const HALF = halfLifeDays || 90;
    const fullTrust = fullTrustAt || 20;
    const now = Date.now();
    const items = arr.map(t => ({
      R: t.R || 0,
      w: Math.pow(0.5, Math.max(0, (now - (t.closedTs || t.ts)) / 86400000) / HALF)
    }));
    const totalW = items.reduce((a, x) => a + x.w, 0);
    if (!totalW) return null;
    const wSum = items.reduce((a, x) => a + x.R * x.w, 0);
    const expectancy = wSum / totalW;
    const ess = totalW;
    const trust = Math.min(1, Math.max(0, (ess - 1) / (fullTrust - 1)));
    const raw = 1 + expectancy * 0.3;
    const blended = trust * raw + (1 - trust) * 1.0;
    return { w: +Math.max(0.5, Math.min(1.6, blended)).toFixed(3), n: arr.length, ess, expectancy };
  }

  function rebalanceWeights() {
    const state = load();
    if (!state.symbolWeights) state.symbolWeights = {};

    // Global weights (across all symbols) — back-compat
    const byType = {};
    const bySymType = {};  // { 'SPY|macd-cross': [trade,...] }
    state.trades.forEach(t => {
      if (t.result == null) return;
      if (!byType[t.setup]) byType[t.setup] = [];
      byType[t.setup].push(t);
      if (t.symbol) {
        const key = t.symbol + '|' + t.setup;
        if (!bySymType[key]) bySymType[key] = [];
        bySymType[key].push(t);
      }
    });
    Object.keys(state.weights).forEach(type => {
      const arr = byType[type] || [];
      if (arr.length < 3) {
        if (arr.length === 0 && state.weights[type] !== 1.0) state.weights[type] = 1.0;
        return;
      }
      const c = _computeWeight(arr);
      if (c) state.weights[type] = c.w;
    });
    Object.keys(byType).forEach(type => {
      if (!(type in state.weights)) state.weights[type] = 1.0;
    });

    // Per-symbol weights — same math, but on the symbol-specific slice.
    // Specialized weight requires ≥ 5 samples to count; below that we fall back to global.
    Object.keys(bySymType).forEach(key => {
      const [sym, type] = key.split('|');
      const arr = bySymType[key];
      if (arr.length < 5) return;
      const c = _computeWeight(arr, 90, 15);
      if (!c) return;
      if (!state.symbolWeights[sym]) state.symbolWeights[sym] = {};
      state.symbolWeights[sym][type] = { w: c.w, n: c.n, expectancy: +c.expectancy.toFixed(3) };
    });
    save(state);
    return state.weights;
  }

  // Returns the blended weight: per-symbol if enough samples, else global.
  // alpha grows with sample size — at n=5 use 0.25 symbol/0.75 global, at n=20 use 0.7/0.3.
  function weightFor(setup, opts) {
    opts = opts || {};
    const state = load();
    const g = state.weights[setup] != null ? state.weights[setup] : 1.0;
    if (!opts.symbol || !state.symbolWeights || !state.symbolWeights[opts.symbol]) return g;
    const s = state.symbolWeights[opts.symbol][setup];
    if (!s) return g;
    // Blend factor: 0 at n=0, ~0.7 at n=20 (asymptotes towards 1)
    const alpha = Math.min(0.7, s.n / 30);
    return +(alpha * s.w + (1 - alpha) * g).toFixed(3);
  }

  // Per-symbol stats roll-up for UIs
  function symbolStats(symbol) {
    const state = load();
    const trades = state.trades.filter(t => t.symbol === symbol && t.result);
    if (!trades.length) return { n: 0, wins: 0, totalR: 0, winRate: 0, bySetup: {} };
    const wins = trades.filter(t => t.R > 0);
    const totalR = trades.reduce((a, t) => a + (+t.R || 0), 0);
    const bySetup = {};
    trades.forEach(t => {
      if (!bySetup[t.setup]) bySetup[t.setup] = { n: 0, totalR: 0, wins: 0 };
      bySetup[t.setup].n++;
      bySetup[t.setup].totalR += +t.R || 0;
      if (t.R > 0) bySetup[t.setup].wins++;
    });
    return {
      n: trades.length,
      wins: wins.length,
      losses: trades.length - wins.length,
      winRate: wins.length / trades.length,
      totalR,
      avgR: totalR / trades.length,
      bySetup
    };
  }

  function recordSignal(s) {
    const state = load();
    const sig = Object.assign({
      id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      ts: Date.now()
    }, s);
    state.signals.push(sig);
    // cap signals list at 5,000
    if (state.signals.length > 5000) state.signals = state.signals.slice(-5000);
    save(state);
    return sig;
  }

  // Adjust a raw signal score by current learned weight for its type.
  // Pass { symbol } to consult per-symbol weights (specialized when available).
  function adjustedScore(rawScore, type, opts) {
    const w = weightFor(type, opts);
    return Math.max(0, Math.min(100, Math.round(rawScore * w)));
  }

  // Stats roll-ups
  function stats() {
    const state = load();
    const closed = state.trades.filter(t => t.result);
    const wins = closed.filter(t => t.result === 'win');
    const losses = closed.filter(t => t.result === 'loss');
    const totalR = closed.reduce((a, t) => a + (t.R || 0), 0);
    const avgWin = wins.length ? wins.reduce((a, t) => a + t.R, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a, t) => a + t.R, 0) / losses.length : 0;
    return {
      total: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length ? wins.length / closed.length : 0,
      avgR: closed.length ? totalR / closed.length : 0,
      avgWin, avgLoss,
      expectancy: avgWin * (wins.length / Math.max(1, closed.length)) + avgLoss * (losses.length / Math.max(1, closed.length)),
      profitFactor: avgLoss !== 0 ? Math.abs((avgWin * wins.length) / (avgLoss * losses.length)) : null,
      bySetup: groupBy(closed, 'setup'),
      bySector: groupBy(closed, 'sector'),
      byBias: groupBy(closed, 'bias'),
      byDayOfWeek: groupByFn(closed, t => new Date(t.ts).toLocaleDateString('en-US', { weekday: 'short' })),
      byHoldBucket: groupByFn(closed, t => {
        const h = t.holdDays || 0;
        if (h < 1) return 'Intraday';
        if (h < 4) return '1–3 days';
        if (h < 10) return '4–9 days';
        if (h < 30) return '10–29 days';
        return '30+ days';
      })
    };
  }

  function groupBy(arr, key) { return groupByFn(arr, t => t[key]); }
  function groupByFn(arr, fn) {
    const out = {};
    arr.forEach(t => {
      const k = fn(t) || '—';
      if (!out[k]) out[k] = { count: 0, wins: 0, losses: 0, totalR: 0 };
      out[k].count++;
      if (t.result === 'win') out[k].wins++;
      else if (t.result === 'loss') out[k].losses++;
      out[k].totalR += t.R || 0;
    });
    Object.values(out).forEach(g => {
      g.winRate = g.count ? g.wins / g.count : 0;
      g.avgR = g.count ? g.totalR / g.count : 0;
    });
    return out;
  }

  // Seed with realistic prior so a brand-new install has signal
  function seedIfEmpty() {
    const state = load();
    if (state.trades.length) return;
    const setups = ['50ma-reclaim','bull-flag','cup-handle','macd-cross','unusual-call','unusual-put','52w-break','rsi-divergence','volume-breakout','gamma-squeeze'];
    const sectors = ['Tech','Comm Svc','Cons Disc','Financials','Healthcare','Industrials','Energy','Materials','Utilities','REITs','Cons Stpl'];
    const symbols = ['NVDA','AMD','META','AAPL','MSFT','GOOGL','AMZN','TSLA','PLTR','COIN','SMCI','SHOP','SPY','QQQ','AVGO','MU','CRM','UBER','BABA','XLE'];
    const now = Date.now();
    for (let i = 0; i < 240; i++) {
      const setup = setups[Math.floor(Math.random()*setups.length)];
      const sector = sectors[Math.floor(Math.random()*sectors.length)];
      const symbol = symbols[Math.floor(Math.random()*symbols.length)];
      const bias = Math.random() > 0.32 ? 'bull' : 'bear';
      const entry = +(50 + Math.random()*500).toFixed(2);
      const stopDist = entry * 0.04 * (0.6 + Math.random()*0.8);
      const stop = bias === 'bull' ? entry - stopDist : entry + stopDist;
      // outcome: skewed to wins for known good setups, weighted by setup quality
      const setupEdge = { '50ma-reclaim': 0.18, 'cup-handle': 0.15, 'bull-flag': 0.14, 'macd-cross': 0.10, 'unusual-call': 0.08, '52w-break': 0.12, 'rsi-divergence': 0.06, 'volume-breakout': 0.16, 'unusual-put': 0.02, 'gamma-squeeze': 0.18 }[setup] || 0.05;
      const win = Math.random() < (0.50 + setupEdge);
      const R = win ? (1.0 + Math.random() * 2.5) : -(0.5 + Math.random() * 0.8);
      const exit = bias === 'bull' ? entry + R * stopDist : entry - R * stopDist;
      const ts = now - (240 - i) * 86400000 * (0.6 + Math.random()*0.8);
      state.trades.push({
        id: 't_seed_' + i,
        ts, closedTs: ts + (1 + Math.floor(Math.random()*14)) * 86400000,
        symbol, setup, sector, bias,
        score: 50 + Math.floor(Math.random()*45),
        entry: +entry.toFixed(2),
        stop:  +stop.toFixed(2),
        exit:  +exit.toFixed(2),
        pnl: +((bias==='bull'?exit-entry:entry-exit)).toFixed(2),
        R: +R.toFixed(2),
        result: win ? 'win' : 'loss',
        holdDays: 1 + Math.floor(Math.random()*14),
        closeReason: win ? (Math.random() > 0.4 ? 'target' : 'trail') : 'stop'
      });
    }
    save(state);
    rebalanceWeights();
  }

  function reset() { save(JSON.parse(JSON.stringify(SCHEMA))); }

  function getWeights() { return load().weights; }

  // ---------------- Conditional / contextual learning ----------------
  // Tracks weights by (setup × dimension × bucket), e.g. setup='macd-cross'
  // dimension='sector' bucket='Tech' => weight for that combination.
  // Score formula: adjusted = raw × base × product(conditional adjustments)
  // Adjustments are mild (multiplicative around 1.0) so they refine — not flip — the base.
  function bucketDayOfWeek(ts) { return new Date(ts).toLocaleDateString('en-US', { weekday: 'short' }); }
  function bucketHoldBand(holdDays) {
    if (holdDays < 1) return 'Intraday';
    if (holdDays < 4) return '1-3d';
    if (holdDays < 10) return '4-9d';
    if (holdDays < 30) return '10-29d';
    return '30d+';
  }
  function bucketVixRegime(vix) {
    if (vix == null) return 'unknown';
    if (vix < 14) return 'low';        // complacent
    if (vix < 20) return 'normal';
    if (vix < 30) return 'elevated';
    return 'panic';
  }

  function currentVix() {
    if (typeof QUOTES !== 'undefined' && QUOTES.VIX) return QUOTES.VIX.last;
    return null;
  }

  // Compute conditional adjustment factors from history. Stored on state.conditional.
  function rebalanceConditional() {
    const state = load();
    if (!state.conditional) state.conditional = {};
    const closed = state.trades.filter(t => t.result);
    if (closed.length < 8) { save(state); return state.conditional; }

    function bucketsFor(t) {
      return {
        sector: t.sector || '—',
        dow: bucketDayOfWeek(t.ts),
        hold: bucketHoldBand(t.holdDays || 0),
        bias: t.bias || '—',
        // Use stored regime if present; otherwise treat as 'normal'
        regime: t.vixRegime || 'normal'
      };
    }

    const acc = {}; // setup -> dim -> bucket -> { sum, n }
    closed.forEach(t => {
      const buckets = bucketsFor(t);
      if (!acc[t.setup]) acc[t.setup] = {};
      Object.keys(buckets).forEach(dim => {
        if (!acc[t.setup][dim]) acc[t.setup][dim] = {};
        const b = buckets[dim];
        if (!acc[t.setup][dim][b]) acc[t.setup][dim][b] = { sum: 0, n: 0 };
        acc[t.setup][dim][b].sum += t.R || 0;
        acc[t.setup][dim][b].n += 1;
      });
    });

    const out = {};
    Object.keys(acc).forEach(setup => {
      out[setup] = {};
      Object.keys(acc[setup]).forEach(dim => {
        out[setup][dim] = {};
        Object.keys(acc[setup][dim]).forEach(bucket => {
          const v = acc[setup][dim][bucket];
          if (v.n < 3) return;
          const expectancy = v.sum / v.n;
          // Conditional adjustment is gentler than base — squashed to [0.7, 1.35]
          const adj = Math.max(0.7, Math.min(1.35, 1 + expectancy * 0.18));
          out[setup][dim][bucket] = { adj: +adj.toFixed(3), n: v.n, expectancy: +expectancy.toFixed(2), winRate: +(closed.filter(t => t.setup===setup && bucketsFor(t)[dim] === bucket && t.result==='win').length / v.n).toFixed(3) };
        });
      });
    });
    state.conditional = out;
    save(state);
    return out;
  }

  // adjustedScoreCtx: raw score adjusted by base × all relevant conditional adjustments.
  // ctx = { sector, dow?, hold?, bias?, regime? } — any subset is fine.
  function adjustedScoreCtx(rawScore, type, ctx) {
    const state = load();
    const base = state.weights[type] || 1.0;
    let mult = base;
    const cond = state.conditional && state.conditional[type];
    if (cond && ctx) {
      Object.keys(ctx).forEach(dim => {
        const bucket = ctx[dim];
        const entry = cond[dim] && cond[dim][bucket];
        if (entry && typeof entry.adj === 'number') mult *= entry.adj;
      });
    }
    return Math.max(0, Math.min(100, Math.round(rawScore * mult)));
  }

  // Plain-English explanation: returns array of strings like
  // "Tech sector has been favorable (+1.4R avg over 12 trades)"
  function explain(type, ctx) {
    const state = load();
    const reasons = [];
    const base = state.weights[type] || 1.0;
    reasons.push({
      kind: 'base',
      text: `Base weight for ${type}: ${base.toFixed(2)}× (${base >= 1.1 ? 'favored' : base <= 0.9 ? 'penalized' : 'neutral'})`,
      impact: (base - 1)
    });
    const cond = state.conditional && state.conditional[type];
    if (cond && ctx) {
      Object.keys(ctx).forEach(dim => {
        const bucket = ctx[dim];
        const e = cond[dim] && cond[dim][bucket];
        if (e) {
          const verb = e.adj > 1.05 ? 'favored' : e.adj < 0.95 ? 'penalized' : 'neutral';
          reasons.push({
            kind: 'conditional',
            dim, bucket,
            text: `${dim}=${bucket}: ${verb} — avg ${e.expectancy >= 0 ? '+' : ''}${e.expectancy}R over ${e.n} prior trades, win rate ${Math.round(e.winRate*100)}%`,
            impact: (e.adj - 1)
          });
        }
      });
    }
    return reasons;
  }

  // High-level "what the system has learned" digest — used by learn-dashboard.html.
  function insights(maxItems) {
    const state = load();
    const cond = state.conditional || {};
    const items = [];
    Object.keys(cond).forEach(setup => {
      Object.keys(cond[setup]).forEach(dim => {
        Object.keys(cond[setup][dim]).forEach(bucket => {
          const e = cond[setup][dim][bucket];
          if (!e || e.n < 4) return;
          const direction = e.adj > 1.0 ? 'boosts' : 'fades';
          const strength = Math.abs(e.adj - 1) * 100;
          items.push({
            setup, dim, bucket,
            adj: e.adj, n: e.n, expectancy: e.expectancy, winRate: e.winRate,
            strength,
            sentence: `${setup} on ${dim}=${bucket} → ${direction} (${(e.adj * 100).toFixed(0)}% scaling, ${Math.round(e.winRate*100)}% win-rate over ${e.n})`
          });
        });
      });
    });
    items.sort((a, b) => b.strength - a.strength);
    return items.slice(0, maxItems || 20);
  }

  // Mark this position's regime at open time so closeTrade keeps regime correlation
  function tagRegime(trade) {
    const v = currentVix();
    trade.vixRegime = bucketVixRegime(v);
    return trade;
  }

  // Auto-seed DISABLED — was generating 240 synthetic trades with Math.random()
  // outcomes on first load. That poisoned every analytics page (Cohort,
  // Performance Attribution, Best Symbols, etc.) with fake history that
  // users couldn't distinguish from real data. The honest default is empty —
  // analytics pages should show 'no data yet' until real trades exist.
  // To force a synthetic seed for testing, call Learn.seedIfEmpty() from console.
  try { rebalanceConditional(); } catch (e) {}

  return {
    recordTrade, closeTrade, recordSignal, adjustedScore, stats, getWeights,
    rebalanceWeights, reset, load,
    // new conditional API
    rebalanceConditional, adjustedScoreCtx, explain, insights, tagRegime,
    // feature extraction / auto-tagging / MFE-MAE
    captureMarketContext, autoTagSetup, updateExcursion,
    // per-symbol weights
    weightFor, symbolStats,
    // helpers
    bucketVixRegime, currentVix
  };
})();
