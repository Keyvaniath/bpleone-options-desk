// _test_econ_worker.js — worker pass-323: /brain/econ never serves a calendar that does not cover today.
// Loads worker/src/econ.js (pure helpers) and checks the handler's wiring in worker/src/index.js.
// Run: node _test_econ_worker.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'econ.js'), 'utf8').replace(/^export (const|function)/gm, '$1');
const E = new Function(src + '\nreturn { ECON_DESK_FILE, ECON_SLACK_MS, normalizeEconEvents, econCoverage, econCovers };')();
let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }

const NOW = Date.UTC(2026, 10, 11, 21, 0, 0);   // Wed 11/11/2026 4 PM ET
const week = (first, last) => [
  { title: 'A', country: 'USD', date: first, impact: 'High', forecast: '', previous: '' },
  { title: 'B', country: 'USD', date: last, impact: 'High', forecast: '', previous: '' }];

ok(E.econCovers(week('2026-11-08T17:30:00-05:00', '2026-11-14T10:00:00-05:00'), NOW), 'this week (11/8-11/14) covers 11/11');
ok(!E.econCovers(week('2026-10-18T10:15:00-04:00', '2026-10-24T09:45:00-04:00'), NOW), 'the 10/18 week (what production served) does not cover 11/11');
ok(E.econCovers(week('2026-11-08T17:30:00-05:00', '2026-11-14T10:00:00-05:00'), Date.UTC(2026, 10, 15, 20, 0, 0)), 'Sunday afternoon: last week\'s file still covers (36 h slack)');
ok(!E.econCovers(week('2026-11-08T17:30:00-05:00', '2026-11-14T10:00:00-05:00'), Date.UTC(2026, 10, 16, 14, 0, 0)), 'Monday morning: last week\'s file no longer covers');
ok(!E.econCovers(week('2026-11-22T10:00:00-05:00', '2026-11-28T10:00:00-05:00'), NOW), 'a future week does not cover today');
ok(!E.econCovers([], NOW) && !E.econCovers(null, NOW) && !E.econCovers([{ date: '' }], NOW), 'empty or undated lists never cover');
const c = E.econCoverage(week('2026-10-18T10:15:00-04:00', '2026-10-24T09:45:00-04:00'));
ok(c.first === '2026-10-18' && c.last === '2026-10-24', 'coverage reports the dates for the refusal note');
const n = E.normalizeEconEvents([{ title: 'CPI', country: 'USD', date: 'x', impact: 'High', extra: 1 }, null, 5]);
ok(n.length === 1 && n[0].forecast === '' && !('extra' in n[0]), 'normalize keeps the six fields, drops junk');
ok(E.normalizeEconEvents({}) === null, 'normalize rejects a non-array');
ok(E.ECON_DESK_FILE === 'https://options.bpleone.com/data/econ-calendar-thisweek.json', 'desk file is the Pages copy the Action commits');

const idx = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'index.js'), 'utf8');
const h = idx.slice(idx.indexOf("if (path === '/brain/econ')"), idx.indexOf("// ===== Pass 248: REAL news feed"));
ok(/const desk = await fetchDeskFile\(\);\s*\n\s*if \(desk && econCovers\(desk, nowE\)\)/.test(h), 'handler falls back to the desk file, only if it covers today');
ok(/if \(econCovers\(stored\.events, nowE\)\) \{\s*\n\s*raw = stored\.events; staleServed = true/.test(h), 'last-good copy served only while it covers today');
ok(/out_of_date: outOfDate \?/.test(h) && /source,/.test(h), 'response says where the events came from and when the copy is out of date');
ok(/const econGood = Array\.isArray\(events\) && \(events\.length > 0/.test(h), 'an empty/failed calendar is still never edge-cached for an hour (pass 308)');
ok(/const WORKER_VERSION = 'pass-3(2[3-9]|[3-9]\d)'/.test(idx), 'worker version is pass-323 or later');
ok(/json\(result, result\.ok \? 200 : \(result\.notFound \? 404 : 502\)\)/.test(idx) && /ok: false, notFound: true, error: 'No Motley Fool transcript found/.test(idx), 'a missing transcript is a 404, not a 502');

console.log(fails ? fails + ' econ worker test(s) FAILED' : 'econ worker: all tests passed');
process.exit(fails ? 1 : 0);
