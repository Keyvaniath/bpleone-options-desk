// _test_snapshot_dispatch.js — unit tests for worker/src/snapshots.js (pass-320: the Worker's 15-minute
// trigger starts the GitHub snapshot job) plus the wiring that keeps the minute tick from running twice.
// Run: node _test_snapshot_dispatch.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const src = read('worker/src/snapshots.js').replace(/^export (const|function)/gm, '$1');
const S = new Function(src + '\nreturn { SNAPSHOT_CRON, SNAPSHOT_REPO, SNAPSHOT_WORKFLOW, SNAPSHOT_SCHEDULE, etClock, snapshotDispatchDue, buildDispatchRequest };')();

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }
const due = (y, mo, d, hUtc, mUtc) => S.snapshotDispatchDue(Date.UTC(y, mo - 1, d, hUtc, mUtc, 20));

// Winter (EST = UTC-5). Thu 11/5/2026.
ok(S.etClock(Date.UTC(2026, 10, 5, 14, 30)).h === 9 && S.etClock(Date.UTC(2026, 10, 5, 14, 30)).wd === 4, 'EST clock: 14:30 UTC Thu = 9:30 ET Thu');
ok(due(2026, 11, 5, 14, 0), 'weekday 9:00 ET fires');
ok(due(2026, 11, 5, 14, 15) && due(2026, 11, 5, 14, 30) && due(2026, 11, 5, 14, 45), 'weekday 9:15/9:30/9:45 ET fire');
ok(due(2026, 11, 5, 21, 45), 'weekday 16:45 ET fires (after the close)');
ok(!due(2026, 11, 5, 22, 15) && !due(2026, 11, 5, 22, 30) && due(2026, 11, 5, 22, 0), 'weekday 17:xx ET: only the :00 fire');
ok(!due(2026, 11, 5, 13, 45) && due(2026, 11, 5, 13, 0), 'weekday 8:xx ET: only the :00 fire');
ok(due(2026, 11, 6, 3, 0) && !due(2026, 11, 6, 3, 30), 'night: hourly');
// Weekend: Sat 11/7 midday ET.
ok(due(2026, 11, 7, 17, 0) && !due(2026, 11, 7, 17, 15), 'weekend 12:xx ET: hourly only');
// Friday 4 PM ET -> Saturday rollover: Fri 11/6 23:30 ET = Sat 04:30 UTC.
ok(S.etClock(Date.UTC(2026, 10, 7, 4, 30)).wd === 5, 'Sat 04:30 UTC is still Friday ET');
// Summer (EDT = UTC-4). Wed 7/15/2026: 9:00 ET = 13:00 UTC.
ok(due(2026, 7, 15, 13, 15) && !due(2026, 7, 15, 12, 45), 'EDT: 9:15 ET fires, 8:45 ET does not');
ok(due(2026, 7, 15, 20, 45) && !due(2026, 7, 15, 21, 15), 'EDT: 16:45 ET fires, 17:15 ET does not');
// Count per weekday ET and weekend day: 32 desk-hour fires + 16 hourly = 48; weekend 24.
let wk = 0, we = 0;
for (let i = 0; i < 96; i++) {
  if (S.snapshotDispatchDue(Date.UTC(2026, 10, 5, 5, 0) + i * 900000 + 20000)) wk++;   // Thu 00:00 ET onward
  if (S.snapshotDispatchDue(Date.UTC(2026, 10, 7, 5, 0) + i * 900000 + 20000)) we++;   // Sat 00:00 ET onward
}
ok(wk === 48, 'weekday dispatches = 48 (got ' + wk + ')');
ok(we === 24, 'weekend dispatches = 24 (got ' + we + ')');

// The request: token only in the Authorization header, never in the URL; body names the branch.
const rq = S.buildDispatchRequest('TEST-TOKEN-VALUE', 'main');
ok(rq.url === 'https://api.github.com/repos/Keyvaniath/bpleone-options-desk/actions/workflows/snapshots.yml/dispatches', 'dispatch URL');
ok(rq.url.indexOf('TEST-TOKEN-VALUE') < 0, 'token never in the URL');
ok(rq.init.method === 'POST' && rq.init.headers.Authorization === 'Bearer TEST-TOKEN-VALUE', 'POST with a bearer header');
ok(rq.init.headers['User-Agent'] && rq.init.headers['X-GitHub-Api-Version'], 'GitHub requires a User-Agent; API version pinned');
ok(JSON.parse(rq.init.body).ref === 'main' && JSON.parse(S.buildDispatchRequest('x').init.body).ref === 'main', 'ref defaults to main');

// Wiring: the trigger string matches wrangler.toml, scheduled() routes on it before the tick, and no log
// line ever prints the token.
const toml = read('worker/wrangler.toml');
const crons = (toml.match(/^crons\s*=\s*\[([^\]]*)\]/m) || [])[1] || '';
ok(crons.indexOf('"* * * * *"') >= 0 && crons.indexOf('"' + S.SNAPSHOT_CRON + '"') >= 0, 'wrangler.toml has the minute tick and SNAPSHOT_CRON');
const idx = read('worker/src/index.js');
const sch = idx.slice(idx.indexOf('async scheduled(event, env, ctx)'));
const route = sch.indexOf('event.cron === SNAPSHOT_CRON');
ok(route > 0 && route < sch.indexOf('tick(env)') && /event\.cron === SNAPSHOT_CRON\) \{ ctx\.waitUntil\(maybeDispatchSnapshots\(env\)\); return; \}/.test(sch),
  'scheduled() returns after the dispatch, before the minute tick');
const fnBody = idx.slice(idx.indexOf('async function maybeDispatchSnapshots'), idx.indexOf('// Cloudflare entry points'));
ok(fnBody.length > 0 && !/console\.log\([^)]*GH_DISPATCH_TOKEN\s*[+)]/.test(fnBody) && !/console\.log\([^)]*init/.test(fnBody), 'no log line prints the token or the request');
ok(/snapshot_dispatch: \{ configured: !!env\.GH_DISPATCH_TOKEN/.test(idx), 'health exposes a boolean, never the token');
ok(/workflow_dispatch:/.test(read('.github/workflows/snapshots.yml')), 'snapshots.yml accepts workflow_dispatch');

console.log(fails ? fails + ' snapshot-dispatch test(s) FAILED' : 'snapshot dispatch: all tests passed');
process.exit(fails ? 1 : 0);
