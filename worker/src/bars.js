// bars.js — pure helpers for the stored daily bars (worker pass-319, audit 2026-11-03). Tested by _test_bars.js.
//
// Why: since pass 209 the tick persists BARS_HISTORY only when a NEW day-bar is pushed (~9:30-9:40 ET); the
// intraday close/high/low updates live in memory and are lost. So every stored bar between auto-bootstraps
// was a morning snapshot: SPY 2026-11-02 stored close 759.54 vs the real 752.10, NVDA's range $1.11 vs $8.32.
// Those bars fed /brain/bars (pivots, ATR, RSI, candle patterns) and the brain's live range/ATR features.
// maybeFinalizeBars (index.js) runs after the close and calls reconcileBars with Yahoo's real daily bars.

// ET calendar day of a timestamp as a YYYYMMDD number (the dayKey format BARS_HISTORY uses).
export function etDayKey(ts) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts));
  const g = t => +(p.find(x => x.type === t) || {}).value;
  return g('year') * 10000 + g('month') * 100 + g('day');
}

// Today's stored bar is a morning snapshot until the evening finalize. When serving it, overlay the latest
// cached quote for the same ET day (fetched after the 9:30 open): close = last, high/low widened by the
// session high/low. Returns a new object marked live: 1; returns the bar unchanged when the quote does not
// qualify. `bar` is in the /brain/bars wire shape ({ ts, o, h, l, c, v, fin }).
export function overlayToday(bar, quote, todayKey) {
  if (!bar || !quote || !(quote.last > 0) || !quote.ts) return bar;
  if (etDayKey(bar.ts) !== todayKey || etDayKey(quote.ts) !== todayKey) return bar;
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(quote.ts));
  const hh = +(p.find(x => x.type === 'hour') || {}).value % 24, mm = +(p.find(x => x.type === 'minute') || {}).value;
  if (hh + mm / 60 < 9.5) return bar;   // pre-open quotes still carry the prior session's high/low
  const out = Object.assign({}, bar, { c: quote.last, live: 1 });
  if (quote.dayHigh > 0) out.h = Math.max(bar.h, quote.dayHigh, quote.last);
  if (quote.dayLow > 0) out.l = Math.min(bar.l, quote.dayLow, quote.last);
  if (quote.volume > 0) out.v = quote.volume;
  return out;
}

// Overwrite stored bars with the real daily OHLCV for every dayKey both sides have, and mark them final (fin: 1).
// `todayKey` bars are reconciled only when `afterClose` is true (Yahoo's bar for today is final after 16:00 ET).
// Stored bars Yahoo does not have (holiday glitches, partial data) are left untouched and stay unmarked.
// Returns { changed, verified } counts; mutates `history` in place.
export function reconcileBars(history, yahooBars, todayKey, afterClose) {
  let changed = 0, verified = 0;
  if (!Array.isArray(history) || !Array.isArray(yahooBars)) return { changed, verified };
  const byKey = {};
  for (const y of yahooBars) if (y && y.close > 0) byKey[etDayKey(y.ts)] = y;
  for (const bar of history) {
    if (!bar || !bar.dayKey) continue;
    if (bar.dayKey === todayKey && !afterClose) continue;
    const y = byKey[bar.dayKey];
    if (!y) continue;
    const same = bar.open === y.open && bar.high === y.high && bar.low === y.low && bar.close === y.close;
    if (!same) {
      bar.open = y.open; bar.high = y.high; bar.low = y.low; bar.close = y.close;
      if (y.volume > 0) bar.volume = y.volume;
      changed++;
    }
    if (!bar.fin) bar.fin = 1;
    verified++;
  }
  return { changed, verified };
}
