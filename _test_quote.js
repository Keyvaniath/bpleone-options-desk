// _test_quote.js — worker pass-332: worker/src/quote.js dailyQuoteFromChart. The evening fixture is Yahoo's real SPY
// answer on 11/16/2026 at ~8:35 PM ET (today's daily bar with close = null), which made the Worker report SPY -2.27%
// (from Thursday's close) instead of -1.91% (from Friday's) and Friday's high as Monday's.
// Run: node _test_quote.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'quote.js'), 'utf8').replace(/^export (const|function)/gm, '$1');
const Q = new Function(src + '\nreturn { dailyQuoteFromChart, etDayOfSec };')();
const idx = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'index.js'), 'utf8');

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-6);

// 9:30 ET bar stamps, Tue 11/10 .. Mon 11/16 (UTC 14:30 in November)
const day = d => Date.UTC(2026, 10, d, 14, 30) / 1000;
const TS = [day(10), day(11), day(12), day(13), day(16)];
const chart = (close, high, low, meta) => ({ timestamp: TS, meta, indicators: { quote: [{ close, high, low, open: close.map(c => c), volume: close.map(() => 1e6) }] } });

// 1. Evening: today's bar has close = null (the 11/16 payload)
const evening = chart(
  [749.9199829101562, 759.8099975585938, 757.1199951171875, 754.3699951171875, null],
  [752.14, 762.51, 763.04, 760.12, 749.82],
  [745.0, 752.0, 754.0, 750.0, 738.07],
  { regularMarketPrice: 739.95, regularMarketTime: Date.UTC(2026, 10, 16, 21, 0) / 1000, chartPreviousClose: 752.69,
    regularMarketDayHigh: 749.82, regularMarketDayLow: 738.07, regularMarketVolume: 67827833 });
const e = Q.dailyQuoteFromChart(evening, {});
ok(e && e.last === 739.95, 'evening: last = regularMarketPrice');
ok(e && near(e.prevClose, 754.3699951171875), 'evening: previous close = FRIDAY (754.37), not Thursday (got ' + (e && e.prevClose) + ')');
ok(e && near(e.changePct, -1.9115, 1e-3), 'evening: SPY -1.91% (the bug reported -2.27%)');
ok(e && e.dayHigh === 749.82 && e.dayLow === 738.07, 'evening: Monday\'s high/low, not Friday\'s (760.12)');
ok(e && e.volume === 67827833 && e.session === '2026-11-16', 'evening: volume from meta; session = the quote\'s ET date');

// 2. During the session: today's bar is in progress and has a close
const live = chart(
  [749.92, 759.81, 757.12, 754.37, 741.2],
  [752.14, 762.51, 763.04, 760.12, 749.82],
  [745.0, 752.0, 754.0, 750.0, 739.5],
  { regularMarketPrice: 741.25, regularMarketTime: Date.UTC(2026, 10, 16, 18, 0) / 1000, regularMarketDayHigh: 749.82, regularMarketDayLow: 739.5 });
const l = Q.dailyQuoteFromChart(live, {});
ok(l && near(l.prevClose, 754.37) && near(l.changePct, (741.25 / 754.37 - 1) * 100), 'session: previous close = Friday');

// 3. Before the open (Tue 8 AM): Yahoo has no Tuesday bar yet; the quote is Monday's close
const pre = chart(
  [749.92, 759.81, 757.12, 754.37, 739.95],
  [752.14, 762.51, 763.04, 760.12, 749.82],
  [745.0, 752.0, 754.0, 750.0, 738.07],
  { regularMarketPrice: 739.95, regularMarketTime: Date.UTC(2026, 10, 16, 21, 0) / 1000 });
const p = Q.dailyQuoteFromChart(pre, {});
ok(p && near(p.prevClose, 754.37) && p.dayHigh === 749.82, 'pre-open: Monday against Friday, Monday\'s range from its bar');

// 4. Crypto keeps the bar rule (UTC-day bars do not line up with ET dates)
const cts = [16, 17, 18, 19, 20].map(d => Date.UTC(2026, 10, d) / 1000);
const btc = { timestamp: cts, meta: { regularMarketPrice: 65000, regularMarketTime: Date.UTC(2026, 10, 20, 15) / 1000 },
  indicators: { quote: [{ close: [60000, 61000, 62000, 63000, 64900], high: [1, 1, 1, 1, 65500], low: [1, 1, 1, 1, 63500], open: [1, 1, 1, 1, 63100], volume: [1, 1, 1, 1, 9] }] } };
const b = Q.dailyQuoteFromChart(btc, { crypto: true });
ok(b && b.prevClose === 63000 && b.dayHigh === 65500 && b.session === null, 'crypto: the in-progress UTC bar against the bar before it');

// 5. Degenerate input
ok(Q.dailyQuoteFromChart(null, {}) === null && Q.dailyQuoteFromChart({ timestamp: [], indicators: { quote: [{ close: [] }] } }, {}) === null, 'no bars -> null');
ok(Q.etDayOfSec(Date.UTC(2026, 10, 17, 1, 0) / 1000) === '2026-11-16', 'etDayOfSec: 1 AM UTC on 11/17 is still 11/16 in New York');

// Wiring: the Worker uses the helper, and the old inline prior-bar rule is gone
ok(/import \{ dailyQuoteFromChart \} from '\.\/quote\.js';/.test(idx) && /dailyQuoteFromChart\(result, \{ crypto: \/-USD\$\/\.test\(yhSym\) \}\)/.test(idx), 'fetchYahooQuote calls dailyQuoteFromChart');
ok(!/typeof q\.close\[i - 1\] === 'number' && q\.close\[i - 1\] > 0/.test(idx), 'the old "bar before the last bar with a close" rule is gone');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('quote: all checks pass');
