// quote.js — one daily quote from a Yahoo v8 chart (range=5d, interval=1d). Pure; fetchYahooQuote in index.js calls it.
//
// Pass-332 fix (11/16 evening): after the close Yahoo returns TODAY's daily bar with close = null (high and low
// present). The old code took the last bar with a close as "today" and the bar before it as the previous close, so
// every evening it measured the move from TWO sessions back (SPY -2.27% instead of -1.91%, QQQ -3.84% vs -2.67%,
// NVDA -6.05% vs -4.12%, UVXY +17.87% vs +13.67% on 11/16), and showed the prior session's high and low as today's
// range. Now the session is the ET date of meta.regularMarketTime (the time of meta.regularMarketPrice), the previous
// close is the latest close on an EARLIER ET date, and the day's high / low / volume come from Yahoo's
// regularMarketDay* fields (the bar's values only as a fallback).
// Crypto (BTC-USD, ETH-USD) trades around the clock in UTC-day bars whose ET dates do not line up with the quote time,
// so it keeps the bar rule: the in-progress bar against the bar before it.

const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export function etDayOfSec(sec) { return ET_DAY.format(new Date(sec * 1000)); }

const ok = v => typeof v === 'number' && isFinite(v) && v > 0;

export function dailyQuoteFromChart(result, opts) {
  const crypto = !!(opts && opts.crypto);
  if (!result || !Array.isArray(result.timestamp)) return null;
  const meta = result.meta || {};
  const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
  if (!q || !Array.isArray(q.close)) return null;
  const ts = result.timestamp, n = Math.min(ts.length, q.close.length);
  // Last bar with a close (during the session: today's in-progress bar).
  let i = n - 1;
  while (i >= 0 && !ok(q.close[i])) i--;
  if (i < 0) return null;
  const last = ok(meta.regularMarketPrice) ? meta.regularMarketPrice : q.close[i];
  if (!ok(last)) return null;
  const at = (arr, k) => (Array.isArray(arr) && k >= 0 && ok(arr[k]) ? arr[k] : null);

  let s, prevClose;
  if (crypto) {
    s = i;
    prevClose = i > 0 && ok(q.close[i - 1]) ? q.close[i - 1] : null;
  } else {
    const day = typeof meta.regularMarketTime === 'number' ? etDayOfSec(meta.regularMarketTime) : etDayOfSec(ts[i]);
    s = -1;
    for (let k = n - 1; k >= 0; k--) { if (etDayOfSec(ts[k]) === day) { s = k; break; } }
    prevClose = null;
    for (let k = n - 1; k >= 0; k--) { if (etDayOfSec(ts[k]) < day && ok(q.close[k])) { prevClose = q.close[k]; break; } }
  }
  if (!ok(prevClose)) prevClose = ok(meta.chartPreviousClose) ? meta.chartPreviousClose : last;
  const dayHigh = ok(meta.regularMarketDayHigh) && !crypto ? meta.regularMarketDayHigh : (at(q.high, s) || last);
  const dayLow = ok(meta.regularMarketDayLow) && !crypto ? meta.regularMarketDayLow : (at(q.low, s) || last);
  const volume = ok(meta.regularMarketVolume) ? meta.regularMarketVolume : ((Array.isArray(q.volume) && q.volume[s]) || 0);
  return {
    last,
    prevClose,
    dayHigh,
    dayLow,
    dayOpen: at(q.open, s) || last,
    volume,
    changePct: prevClose ? ((last - prevClose) / prevClose) * 100 : 0,
    session: crypto ? null : (typeof meta.regularMarketTime === 'number' ? etDayOfSec(meta.regularMarketTime) : etDayOfSec(ts[i]))
  };
}
