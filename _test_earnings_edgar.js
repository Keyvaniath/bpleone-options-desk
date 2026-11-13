// _test_earnings_edgar.js — worker pass-325: past earnings report dates from SEC EDGAR 8-K Item 2.02 filings.
// Finnhub's free calendar reaches back ~1 month, so earnings-playbook could measure at most one past reaction.
// Fixture rows mirror real filings checked 11/13 (AAPL 11/02 21:30Z = 4:30 PM ET after the close; JPM 10/13
// 10:30Z = 6:30 AM ET before the open). Run: node _test_earnings_edgar.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'earnings.js'), 'utf8').replace(/^export (function|const)/gm, '$1');
const E = new Function(src + '\nreturn { earningsFrom8K, tickerMap, cikFor, cikPath, etParts };')();
let fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('FAIL: ' + m); } }

const recent = {
  form:               ['8-K',                      '4',                        '8-K',                      '8-K/A',                    '8-K',                      '8-K',                      '8-K'],
  items:              ['2.02,9.01',                '',                         '5.02',                     '2.02',                     '2.02',                     '7.01,2.02',                '2.02'],
  acceptanceDateTime: ['2026-11-02T21:30:44.000Z', '2026-11-01T22:00:00.000Z', '2026-10-20T20:00:00.000Z', '2026-10-15T20:00:00.000Z', '2026-10-13T10:30:00.000Z', '2026-07-14T14:45:00.000Z', '2026-07-01T20:10:00.000Z'],
  filingDate:         ['2026-11-02',               '2026-11-01',               '2026-10-20',               '2026-10-15',               '2026-10-13',               '2026-07-14',               '2026-07-01'],
};
const r = E.earningsFrom8K(recent);
ok(r.length === 3, 'keeps 8-K Item 2.02 only, one per quarter (got ' + r.length + ': ' + r.map(x => x.date).join(',') + ')');
ok(r[0].date === '2026-11-02' && r[0].hour === 'amc', 'accepted 4:30 PM ET -> after the close');
ok(r[1].date === '2026-10-13' && r[1].hour === 'bmo', 'accepted 6:30 AM ET -> before the open');
ok(r[2].date === '2026-07-14' && r[2].hour === 'dmh', 'accepted 10:45 AM ET -> during market hours; the 7/01 filing 13 days earlier is dropped as the same quarter');
ok(!r.some(x => x.date === '2026-10-15'), 'an 8-K/A amendment is not a new report');
ok(!r.some(x => x.date === '2026-10-20'), 'an 8-K without Item 2.02 is not an earnings release');
ok(E.etParts(Date.parse('2026-11-03T03:30:00Z')).date === '2026-11-02', 'ET date, not UTC (10:30 PM ET is still the report day)');

const map = E.tickerMap({ 0: { cik_str: 320193, ticker: 'AAPL' }, 1: { cik_str: 1067983, ticker: 'BRK-B' }, 2: { ticker: 'X' } });
ok(E.cikFor(map, 'aapl') === 320193 && E.cikFor(map, 'BRK.B') === 1067983 && E.cikFor(map, 'X') === null, 'ticker map: case, BRK.B/BRK-B, incomplete rows skipped');
ok(E.cikPath(320193) === 'CIK0000320193.json', 'CIK is zero-padded to 10 digits');

const idx = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'index.js'), 'utf8');
const hs = idx.indexOf("if (path === '/brain/earnings-history')"); const h = idx.slice(hs, idx.indexOf("if (path === '/brain/profile')", hs));
ok(/earningsFrom8K\(j && j\.filings && j\.filings\.recent\)/.test(h) && /if \(!rows\) try \{/.test(h), 'endpoint: EDGAR first, Finnhub only as the fallback');
ok(/'https:\/\/www\.sec\.gov\/files\/company_tickers\.json', SEC_UA/.test(idx) && /now - \(kv\.at \|\| 0\) < WEEK/.test(idx), 'ticker map fetched with the SEC user agent and cached for a week');

ok(/const ehGood = Array\.isArray\(rows\) && rows\.length > 0;/.test(h) && /if \(ehGood\) ctx\.waitUntil\(cache\.put/.test(h),
  'worker pass-326: an empty answer is never edge-cached (pass-324 pinned an empty Finnhub answer for 12 h)');
const ep = fs.readFileSync(path.join(__dirname, 'earnings-playbook.html'), 'utf8');
ok(/\/brain\/earnings-history\?src=edgar&symbol=/.test(ep), 'earnings-playbook asks under the EDGAR cache key, not the URL pass-324 cached empty');

console.log(fails ? fails + ' EDGAR earnings test(s) FAILED' : 'edgar earnings: all tests passed');
process.exit(fails ? 1 : 0);
