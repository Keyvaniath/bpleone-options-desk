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
  function recordTrade(t) {
    const state = load();
    const trade = Object.assign({
      id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      ts: Date.now(),
      result: null, R: null
    }, t);
    state.trades.push(trade);
    save(state);
    return trade;
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
    save(state);
    rebalanceWeights();
    return trade;
  }

  // Re-weight signal types based on rolling realized expectancy
  function rebalanceWeights() {
    const state = load();
    const byType = {};
    state.trades.forEach(t => {
      if (t.result == null) return;
      if (!byType[t.setup]) byType[t.setup] = [];
      byType[t.setup].push(t.R || 0);
    });
    Object.keys(state.weights).forEach(type => {
      const rs = byType[type] || [];
      if (rs.length < 3) return;
      const expectancy = rs.reduce((a, b) => a + b, 0) / rs.length;
      // squash to [0.5, 1.6] so weight can amplify/dampen without flipping
      const w = Math.max(0.5, Math.min(1.6, 1 + expectancy * 0.3));
      state.weights[type] = +w.toFixed(3);
    });
    save(state);
    return state.weights;
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

  // Adjust a raw signal score by current learned weight for its type
  function adjustedScore(rawScore, type) {
    const state = load();
    const w = state.weights[type] || 1.0;
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

  // Auto-seed on load
  try { seedIfEmpty(); rebalanceConditional(); } catch (e) {}

  return {
    recordTrade, closeTrade, recordSignal, adjustedScore, stats, getWeights,
    rebalanceWeights, reset, load,
    // new conditional API
    rebalanceConditional, adjustedScoreCtx, explain, insights, tagRegime,
    // helpers
    bucketVixRegime, currentVix
  };
})();
