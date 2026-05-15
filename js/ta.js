/* ===========================================
   BPLEONE TRADING - TECHNICAL ANALYSIS ENGINE
   ---
   Real TA indicators computed from streaming
   ticks + historical bars. No mocks.
   ---
   Public API:
     TA.snapshot(symbol)        -> { last, rsi, rsi5, rsi15, macd, signal, hist,
                                     ema9, ema20, ema50, ema200, sma20, sma50, sma200,
                                     atr, atrPct, vwap, vwapDist, bbUpper, bbLower, bbPct,
                                     adx, donchUp, donchDn, rvol, dayRangePct,
                                     trend, regime, summary }
     TA.subscribe(symbol, cb)   -> register callback for snapshot changes (~1Hz)
     TA.unsubscribe(symbol, cb) -> remove
     TA.warmup(symbol)          -> kick off historical bar fetch (lazy; auto-called on subscribe)
     TA.explain(field)          -> plain-English description (for tooltips)
   =========================================== */

const TA = (function () {
  // Per-symbol state: bars at multiple resolutions, cached values
  const STATE = {};
  // Subscribers per symbol
  const SUBS = {};
  // Bar resolutions we track (seconds)
  const RES = { '1m': 60, '5m': 300, '15m': 900, '1d': 86400 };

  function ensure(sym) {
    if (!STATE[sym]) {
      STATE[sym] = {
        bars: { '1m': [], '5m': [], '15m': [], '1d': [] },
        // current in-progress bar per resolution
        current: { '1m': null, '5m': null, '15m': null, '1d': null },
        snapshot: null,
        warmedUp: false,
        warmingUp: false,
        vwap: { num: 0, den: 0, day: null },   // intraday VWAP accumulator
        lastSnapshotAt: 0
      };
    }
    return STATE[sym];
  }

  // ---------- Math primitives ----------
  function sma(arr, n) {
    if (arr.length < n) return null;
    let s = 0;
    for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
    return s / n;
  }

  function emaSeries(arr, n) {
    if (arr.length < n) return null;
    const k = 2 / (n + 1);
    let e = arr.slice(0, n).reduce((a, x) => a + x, 0) / n;
    for (let i = n; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  }

  // RSI(14) Wilder smoothing
  function rsi(closes, n) {
    n = n || 14;
    if (closes.length < n + 1) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= n; loss /= n;
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      gain = (gain * (n - 1) + Math.max(d, 0)) / n;
      loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    }
    if (loss === 0) return 100;
    const rs = gain / loss;
    return 100 - 100 / (1 + rs);
  }

  // MACD(12, 26, 9) — returns { macd, signal, hist }
  function macd(closes) {
    if (closes.length < 35) return { macd: null, signal: null, hist: null };
    const ema12 = emaSeries(closes, 12);
    const ema26 = emaSeries(closes, 26);
    if (ema12 == null || ema26 == null) return { macd: null, signal: null, hist: null };
    const macdLine = ema12 - ema26;
    // signal line = EMA(9) of macd line — approximate by computing macd line series for last N points
    const macdSeries = [];
    // walk back to get macd at each point for signal smoothing — simplified: use last 20 points
    for (let i = Math.max(35, closes.length - 30); i < closes.length; i++) {
      const slice = closes.slice(0, i + 1);
      const e12 = emaSeries(slice, 12);
      const e26 = emaSeries(slice, 26);
      if (e12 != null && e26 != null) macdSeries.push(e12 - e26);
    }
    const signal = macdSeries.length >= 9 ? emaSeries(macdSeries, 9) : null;
    return { macd: macdLine, signal, hist: signal != null ? macdLine - signal : null };
  }

  // ATR(14) - average true range
  function atr(bars, n) {
    n = n || 14;
    if (bars.length < n + 1) return null;
    const trs = [];
    for (let i = 1; i < bars.length; i++) {
      const tr = Math.max(
        bars[i].h - bars[i].l,
        Math.abs(bars[i].h - bars[i - 1].c),
        Math.abs(bars[i].l - bars[i - 1].c)
      );
      trs.push(tr);
    }
    if (trs.length < n) return null;
    let a = trs.slice(0, n).reduce((s, x) => s + x, 0) / n;
    for (let i = n; i < trs.length; i++) a = (a * (n - 1) + trs[i]) / n;
    return a;
  }

  // ADX(14) - trend strength
  function adx(bars, n) {
    n = n || 14;
    if (bars.length < n * 2 + 1) return null;
    const plusDM = [], minusDM = [], trs = [];
    for (let i = 1; i < bars.length; i++) {
      const upMove = bars[i].h - bars[i - 1].h;
      const downMove = bars[i - 1].l - bars[i].l;
      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
      trs.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)));
    }
    function wilder(arr, n) {
      if (arr.length < n) return null;
      let s = arr.slice(0, n).reduce((a, x) => a + x, 0);
      const out = [s];
      for (let i = n; i < arr.length; i++) {
        s = s - s / n + arr[i];
        out.push(s);
      }
      return out;
    }
    const trSm = wilder(trs, n);
    const pDM = wilder(plusDM, n);
    const mDM = wilder(minusDM, n);
    if (!trSm || !pDM || !mDM) return null;
    const dx = [];
    for (let i = 0; i < trSm.length; i++) {
      const pDI = (pDM[i] / trSm[i]) * 100;
      const mDI = (mDM[i] / trSm[i]) * 100;
      const sum = pDI + mDI;
      if (sum) dx.push(Math.abs(pDI - mDI) / sum * 100);
    }
    if (dx.length < n) return null;
    // ADX = Wilder avg of DX over n
    let a = dx.slice(0, n).reduce((s, x) => s + x, 0) / n;
    for (let i = n; i < dx.length; i++) a = (a * (n - 1) + dx[i]) / n;
    return a;
  }

  // Bollinger Bands - returns { upper, mid, lower, pctB }
  function bollinger(closes, n, k) {
    n = n || 20; k = k || 2;
    if (closes.length < n) return { upper: null, mid: null, lower: null, pctB: null };
    const recent = closes.slice(-n);
    const m = recent.reduce((s, x) => s + x, 0) / n;
    const v = recent.reduce((s, x) => s + Math.pow(x - m, 2), 0) / n;
    const sd = Math.sqrt(v);
    const upper = m + k * sd, lower = m - k * sd;
    const last = closes[closes.length - 1];
    const pctB = (last - lower) / (upper - lower);
    return { upper, mid: m, lower, pctB };
  }

  // Donchian channels - returns { up, dn } over N bars
  function donchian(bars, n) {
    n = n || 20;
    if (bars.length < n) return { up: null, dn: null };
    const slice = bars.slice(-n);
    return { up: Math.max.apply(null, slice.map(b => b.h)), dn: Math.min.apply(null, slice.map(b => b.l)) };
  }

  // ---------- Bar aggregation from ticks ----------
  function startBar(bucket, t, price, vol) {
    return { t, o: price, h: price, l: price, c: price, v: vol || 0 };
  }

  function updateBar(bar, price, vol) {
    if (price > bar.h) bar.h = price;
    if (price < bar.l) bar.l = price;
    bar.c = price;
    bar.v += vol || 0;
  }

  // Push a tick into all resolutions for this symbol
  function pushTick(sym, price, vol, ts) {
    if (!price || !isFinite(price)) return;
    const s = ensure(sym);
    ts = ts || Date.now();

    Object.keys(RES).forEach(resKey => {
      const resSec = RES[resKey];
      const bucket = Math.floor(ts / 1000 / resSec) * resSec;
      const cur = s.current[resKey];
      if (!cur || cur.t !== bucket) {
        // bucket flipped - finalize current and start a new one
        if (cur) {
          s.bars[resKey].push(cur);
          // Trim history: keep ~ 500 bars per resolution
          if (s.bars[resKey].length > 500) s.bars[resKey].shift();
        }
        s.current[resKey] = startBar(bucket, ts, price, vol);
      } else {
        updateBar(cur, price, vol);
      }
    });

    // VWAP accumulator (resets on new day in ET)
    const dayKey = new Date(ts).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    if (s.vwap.day !== dayKey) {
      s.vwap = { num: 0, den: 0, day: dayKey };
    }
    s.vwap.num += price * (vol || 1);
    s.vwap.den += (vol || 1);

    // Recompute snapshot (throttled to once per second)
    if (ts - s.lastSnapshotAt > 1000) {
      s.lastSnapshotAt = ts;
      computeSnapshot(sym);
      notify(sym);
    }
  }

  // ---------- Snapshot ----------
  function getClosed(sym, resKey) {
    // Closed bars + current as the latest (in-progress) bar
    const s = ensure(sym);
    const list = s.bars[resKey].slice();
    if (s.current[resKey]) list.push(s.current[resKey]);
    return list;
  }

  function closes(sym, resKey) { return getClosed(sym, resKey).map(b => b.c); }

  function computeSnapshot(sym) {
    const s = ensure(sym);
    const bars1m = getClosed(sym, '1m');
    const bars5m = getClosed(sym, '5m');
    const bars15m = getClosed(sym, '15m');
    const barsD = getClosed(sym, '1d');
    const closes1m = bars1m.map(b => b.c);
    const closes5m = bars5m.map(b => b.c);
    const closes15m = bars15m.map(b => b.c);
    const closesD = barsD.map(b => b.c);
    const last = closes1m[closes1m.length - 1] || (typeof QUOTES !== 'undefined' && QUOTES[sym] ? QUOTES[sym].last : null);
    if (!last) { s.snapshot = null; return; }

    // Pick the most data-rich timeframe available for MACD/EMA200; fall back gracefully
    const sourceForLong = closesD.length >= 50 ? closesD : (closes15m.length >= 50 ? closes15m : closes5m);
    const sourceMid = closes5m.length >= 30 ? closes5m : closes1m;

    const ma = macd(sourceMid);
    const bb = bollinger(closes15m.length >= 20 ? closes15m : closes5m, 20, 2);
    const donch = donchian(bars15m.length >= 20 ? bars15m : bars5m, 20);
    const atrVal = atr(bars5m.length >= 15 ? bars5m : bars1m, 14);
    const adxVal = adx(bars15m.length >= 29 ? bars15m : bars5m, 14);
    const vwap = s.vwap.den ? s.vwap.num / s.vwap.den : null;

    // Day-range expansion: how much of typical range used today
    const q = (typeof QUOTES !== 'undefined') ? QUOTES[sym] : null;
    const dayRangePct = q && q.dayHigh && q.dayLow ? ((q.dayHigh - q.dayLow) / q.dayLow) * 100 : null;

    // Relative volume vs. a typical assumed 30-day avg (when avgVolume present in quote)
    const rvol = q && q.volume && q.avgVolume ? q.volume / q.avgVolume : null;

    // Trend classification: composite of EMAs vs price + ADX
    const ema20 = emaSeries(sourceMid, 20);
    const ema50 = emaSeries(sourceForLong, 50);
    const ema200 = emaSeries(sourceForLong, 200);
    let trend = 'neutral';
    if (ema20 && ema50 && last) {
      if (last > ema20 && ema20 > ema50) trend = 'uptrend';
      else if (last < ema20 && ema20 < ema50) trend = 'downtrend';
      else if (last > ema50 && last < ema20) trend = 'pullback-up';
      else if (last < ema50 && last > ema20) trend = 'rally-down';
    }
    const trendStrong = adxVal != null && adxVal >= 25;

    // Volatility regime
    let regime = 'normal';
    if (atrVal != null && last) {
      const atrPct = (atrVal / last) * 100;
      if (atrPct < 0.7) regime = 'compressed';
      else if (atrPct > 2.5) regime = 'expansive';
    }

    const snap = {
      last,
      bars: { '1m': bars1m.length, '5m': bars5m.length, '15m': bars15m.length, '1d': barsD.length },
      rsi: rsi(closes5m, 14),
      rsi1: rsi(closes1m, 14),
      rsi15: rsi(closes15m, 14),
      rsiD: rsi(closesD, 14),
      macd: ma.macd, signal: ma.signal, hist: ma.hist,
      ema9: emaSeries(sourceMid, 9),
      ema20,
      ema50,
      ema200,
      sma20: sma(sourceMid, 20),
      sma50: sma(sourceForLong, 50),
      sma200: sma(sourceForLong, 200),
      atr: atrVal,
      atrPct: atrVal != null && last ? (atrVal / last) * 100 : null,
      bbUpper: bb.upper, bbMid: bb.mid, bbLower: bb.lower, bbPct: bb.pctB,
      adx: adxVal,
      donchUp: donch.up, donchDn: donch.dn,
      vwap,
      vwapDist: vwap ? ((last - vwap) / vwap) * 100 : null,
      rvol,
      dayRangePct,
      trend,
      trendStrong,
      regime,
      ts: Date.now()
    };
    snap.summary = buildSummary(snap);
    s.snapshot = snap;
  }

  function buildSummary(s) {
    const out = [];
    if (s.trend === 'uptrend' && s.trendStrong) out.push('Strong uptrend (ADX ≥ 25)');
    else if (s.trend === 'uptrend') out.push('Uptrend');
    else if (s.trend === 'downtrend' && s.trendStrong) out.push('Strong downtrend');
    else if (s.trend === 'downtrend') out.push('Downtrend');
    else if (s.trend !== 'neutral') out.push(s.trend.replace('-', ' '));
    if (s.rsi != null) {
      if (s.rsi >= 70) out.push('RSI overbought (' + s.rsi.toFixed(0) + ')');
      else if (s.rsi <= 30) out.push('RSI oversold (' + s.rsi.toFixed(0) + ')');
      else out.push('RSI neutral (' + s.rsi.toFixed(0) + ')');
    }
    if (s.hist != null) {
      if (s.hist > 0) out.push('MACD bull cross');
      else if (s.hist < 0) out.push('MACD bear');
    }
    if (s.vwap && s.vwapDist != null) {
      out.push(s.vwapDist >= 0 ? '+' + s.vwapDist.toFixed(2) + '% over VWAP' : s.vwapDist.toFixed(2) + '% under VWAP');
    }
    if (s.bbPct != null) {
      if (s.bbPct > 1) out.push('Above upper BB');
      else if (s.bbPct < 0) out.push('Below lower BB');
    }
    if (s.regime === 'compressed') out.push('Vol compressed (squeeze setup)');
    else if (s.regime === 'expansive') out.push('Vol expansive');
    return out;
  }

  function snapshot(sym) {
    const s = ensure(sym);
    if (!s.snapshot) computeSnapshot(sym);
    return s.snapshot;
  }

  // ---------- Subscriptions ----------
  function subscribe(sym, cb) {
    if (!SUBS[sym]) SUBS[sym] = new Set();
    SUBS[sym].add(cb);
    warmup(sym);
    if (STATE[sym] && STATE[sym].snapshot) cb(STATE[sym].snapshot);
  }
  function unsubscribe(sym, cb) {
    if (SUBS[sym]) SUBS[sym].delete(cb);
  }
  function notify(sym) {
    const subs = SUBS[sym];
    if (!subs) return;
    const snap = STATE[sym] ? STATE[sym].snapshot : null;
    if (!snap) return;
    subs.forEach(cb => { try { cb(snap); } catch (e) {} });
  }

  // ---------- Warmup: pull historical bars on-demand ----------
  async function warmup(sym) {
    const s = ensure(sym);
    if (s.warmedUp || s.warmingUp) return;
    s.warmingUp = true;
    try {
      if (typeof DataProvider !== 'undefined' && DataProvider.getHistorical) {
        // 5-day window of 5-minute bars
        const to = Date.now();
        const from5m = to - 5 * 24 * 60 * 60 * 1000;
        const from1d = to - 220 * 24 * 60 * 60 * 1000;
        try {
          const bars5m = await DataProvider.getHistorical(sym, '5', from5m, to);
          if (Array.isArray(bars5m) && bars5m.length) {
            // Each bar expected { t, o, h, l, c, v }
            const filtered = bars5m.filter(b => b && b.c).slice(-400);
            s.bars['5m'] = filtered;
            // also derive 15m by bucketing 5m bars
            s.bars['15m'] = bucketBars(filtered, 3);
          }
        } catch (e) {}
        try {
          const barsD = await DataProvider.getHistorical(sym, 'D', from1d, to);
          if (Array.isArray(barsD) && barsD.length) {
            s.bars['1d'] = barsD.filter(b => b && b.c).slice(-220);
          }
        } catch (e) {}
      }
      s.warmedUp = true;
      computeSnapshot(sym);
      notify(sym);
    } finally {
      s.warmingUp = false;
    }
  }

  function bucketBars(bars, n) {
    if (!bars || !bars.length) return [];
    const out = [];
    for (let i = 0; i < bars.length; i += n) {
      const slice = bars.slice(i, i + n);
      if (!slice.length) continue;
      const b = {
        t: slice[0].t,
        o: slice[0].o,
        h: Math.max.apply(null, slice.map(x => x.h)),
        l: Math.min.apply(null, slice.map(x => x.l)),
        c: slice[slice.length - 1].c,
        v: slice.reduce((a, x) => a + (x.v || 0), 0)
      };
      out.push(b);
    }
    return out;
  }

  // ---------- Auto-hook into Feed for live ticks ----------
  function autoHook() {
    if (typeof Feed === 'undefined') return;
    // Wildcard hook updates TA on every tick anywhere in the app
    Feed.subscribe('*', q => {
      if (!q || !q.symbol) return;
      pushTick(q.symbol, q.last, q.lastVolume || q.volume || 1, q.ts || Date.now());
    });
  }
  setTimeout(autoHook, 100);

  // ---------- Tooltips / explanations ----------
  const EXPLAIN = {
    rsi: "RSI (Relative Strength Index) measures momentum on a 0–100 scale. Above 70 = overbought (potentially due for a pullback). Below 30 = oversold (potentially due for a bounce). Around 50 = neutral.",
    macd: "MACD compares two moving averages. When the MACD line crosses above the signal line (histogram turns positive), momentum has flipped bullish. Cross below = bearish flip.",
    ema: "Exponential Moving Average — weighted average of recent prices that reacts faster than a simple average. EMA20 = short-term trend, EMA50 = mid-term, EMA200 = long-term institutional trend filter.",
    atr: "Average True Range — typical price wobble per bar. Higher ATR = bigger moves. Use it to size your stop: a 1.5–2× ATR stop is durable.",
    adx: "ADX measures trend STRENGTH (not direction). Above 25 = a real trend is running. Below 20 = chop, mean-revert setups work better than trend-follow.",
    bb: "Bollinger Bands wrap price 2 standard deviations around a 20-bar mean. Price above upper band = stretched up. Below lower = stretched down. Bands squeezing tight = breakout coming.",
    vwap: "Volume-Weighted Average Price — the day's true average paid by every dollar of volume. Institutions defend it. Price above VWAP = bulls in control. Below = bears.",
    donchian: "Donchian channel — highest high / lowest low of last N bars. Break of upper = new high breakout. Break of lower = breakdown.",
    rvol: "Relative volume — today's volume vs. typical. Above 1.5x = unusual activity (something is happening). Below 0.7x = sleepy session.",
    trend: "Trend classification: uptrend = price above rising EMA20 above EMA50. Downtrend = mirror. Pullback = countertrend wiggle within a primary trend.",
    regime: "Volatility regime — compressed = ATR is small (energy building, ripe for squeeze). Expansive = ATR is large (already moving, late for new entries)."
  };
  function explain(field) { return EXPLAIN[field] || ''; }

  // ---------- Public surface ----------
  return {
    pushTick,
    snapshot,
    subscribe,
    unsubscribe,
    warmup,
    explain,
    _state: STATE
  };
})();

if (typeof window !== 'undefined') window.TA = TA;
