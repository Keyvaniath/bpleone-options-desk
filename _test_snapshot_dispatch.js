// _test_snapshot_dispatch.js — unit tests for worker/src/snapshots.js (pass-320/321: the Worker's minute tick
// starts the GitHub snapshot job) plus the wiring that keeps it from disturbing the tick.
// Run: node _test_snapshot_dispatch.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const src = read('worker/src/snapshots.js').replace(/^export (const|function)/gm, '$1');
const S = new Function(src + '\nreturn { SNAPSHOT_REPO, SNAPSHOT_WORKFLOW, SNAPSHOT_SCHEDULE, etClock, snapshotDispatchDue, buildDispatchRequest, cleanToken, tokenShape };')();

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }
// scheduledTime is the exact minute (seconds 0).
const due = (y, mo, d, hUtc, mUtc) => S.snapshotDispatchDue(Date.UTC(y, mo - 1, d, hUtc, mUtc, 0));

// Winter (EST = UTC-5). Thu 11/5/2026.
ok(S.etClock(Date.UTC(2026, 10, 5, 14, 30)).h === 9 && S.etClock(Date.UTC(2026, 10, 5, 14, 30)).wd === 4, 'EST clock: 14:30 UTC Thu = 9:30 ET Thu');
ok(due(2026, 11, 5, 14, 0) && due(2026, 11, 5, 14, 15) && due(2026, 11, 5, 14, 30) && due(2026, 11, 5, 14, 45), 'weekday 9:00/9:15/9:30/9:45 ET fire');
ok(!due(2026, 11, 5, 14, 1) && !due(2026, 11, 5, 14, 14) && !due(2026, 11, 5, 14, 59), 'off-quarter minutes never fire (called every minute)');
ok(due(2026, 11, 5, 21, 0) && due(2026, 11, 5, 21, 15), 'weekday 16:00 and 16:15 ET fire');
ok(!due(2026, 11, 5, 21, 30) && !due(2026, 11, 5, 21, 45), 'weekday 16:30/16:45 ET skipped (radar + finalizer window)');
ok(due(2026, 11, 5, 22, 0) && !due(2026, 11, 5, 22, 15), 'weekday 17:00 ET fires (closing prices), 17:15 does not');
ok(due(2026, 11, 5, 13, 0) && !due(2026, 11, 5, 13, 45), 'weekday 8:xx ET: only :00');
ok(due(2026, 11, 6, 3, 0) && !due(2026, 11, 6, 3, 30), 'night: hourly');
ok(due(2026, 11, 7, 17, 0) && !due(2026, 11, 7, 17, 15), 'weekend: hourly only');
ok(S.etClock(Date.UTC(2026, 10, 7, 4, 30)).wd === 5, 'Sat 04:30 UTC is still Friday ET');
// Summer (EDT = UTC-4). Wed 7/15/2026: 9:00 ET = 13:00 UTC.
ok(due(2026, 7, 15, 13, 15) && !due(2026, 7, 15, 12, 45), 'EDT: 9:15 ET fires, 8:45 ET does not');
ok(due(2026, 7, 15, 20, 15) && !due(2026, 7, 15, 20, 30), 'EDT: 16:15 ET fires, 16:30 ET does not');
// Every minute of a weekday and a weekend day: 46 and 24.
let wk = 0, we = 0;
for (let i = 0; i < 1440; i++) {
  if (S.snapshotDispatchDue(Date.UTC(2026, 10, 5, 5, 0) + i * 60000)) wk++;   // Thu 00:00 ET onward
  if (S.snapshotDispatchDue(Date.UTC(2026, 10, 7, 5, 0) + i * 60000)) we++;   // Sat 00:00 ET onward
}
ok(wk === 46, 'weekday dispatches = 46 (got ' + wk + ')');
ok(we === 24, 'weekend dispatches = 24 (got ' + we + ')');

// The request: token only in the Authorization header, never in the URL; body names the branch.
const rq = S.buildDispatchRequest('TEST-TOKEN-VALUE', 'main');
ok(rq.url === 'https://api.github.com/repos/Keyvaniath/bpleone-options-desk/actions/workflows/snapshots.yml/dispatches', 'dispatch URL');
ok(rq.url.indexOf('TEST-TOKEN-VALUE') < 0, 'token never in the URL');
ok(rq.init.method === 'POST' && rq.init.headers.Authorization === 'Bearer TEST-TOKEN-VALUE', 'POST with a bearer header');
ok(rq.init.headers['User-Agent'] && rq.init.headers['X-GitHub-Api-Version'], 'GitHub requires a User-Agent; API version pinned');
ok(JSON.parse(rq.init.body).ref === 'main' && JSON.parse(S.buildDispatchRequest('x').init.body).ref === 'main', 'ref defaults to main');

// Pass-322: a pasted secret can carry terminal junk; the token is pulled out of it, and the failure log
// describes the secret without revealing it.
const FG = 'github_pat_11ABCDEFG0aBcDeFgHiJkLmNoP_qRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const CL = 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
ok(S.cleanToken(FG) === FG && S.cleanToken(CL) === CL, 'clean tokens pass through unchanged');
ok(S.cleanToken('\x1b[200~' + FG + '\x1b[201~') === FG, 'bracketed-paste escape codes stripped');
ok(S.cleanToken(FG + '\r\n') === FG && S.cleanToken('  ' + CL + ' ') === CL, 'trailing CR/LF and spaces stripped');
ok(S.cleanToken(' not-a-token ') === 'not-a-token', 'an unrecognized value is only trimmed');
ok(S.cleanToken(undefined) === '', 'missing secret -> empty string');
const shape = S.tokenShape('\x1b[200~' + FG + '\x1b[201~');
ok(shape.indexOf('fine-grained token, ' + FG.length + ' chars') >= 0 && /extra characters were stripped/.test(shape), 'shape names the type, the length and the stripping (got: ' + shape + ')');
ok(shape.indexOf(FG) < 0 && shape.indexOf(FG.slice(11, 20)) < 0, 'shape never contains the token or a piece of it');
ok(/unrecognized/.test(S.tokenShape('hello world')) && /nothing stripped/.test(S.tokenShape(CL)), 'shape flags a non-token and a clean token');

// Wiring.
const toml = read('worker/wrangler.toml');
const crons = (toml.match(/^crons\s*=\s*\[([^\]]*)\]/m) || [])[1] || '';
ok(crons.trim() === '"* * * * *"', 'wrangler.toml has only the minute trigger (an overlapping second trigger never fires)');
const idx = read('worker/src/index.js');
const sch = idx.slice(idx.indexOf('async scheduled(event, env, ctx)'));
const disp = sch.indexOf('await maybeDispatchSnapshots(env, (event && event.scheduledTime) || Date.now());');
ok(disp > 0 && disp < sch.indexOf('tick(env)'), 'scheduled() awaits the dispatch first, keyed on scheduledTime, before the tick');
const fnBody = idx.slice(idx.indexOf('async function maybeDispatchSnapshots'), idx.indexOf('// Cloudflare entry points'));
ok(/^async function maybeDispatchSnapshots\(env, at\) \{\s*\n\s*try \{/.test(fnBody), 'the dispatch body is entirely inside try (it must never throw before the tick)');
ok(/AbortSignal\.timeout\(5000\)/.test(fnBody), 'the dispatch fetch has a timeout');
ok(/buildDispatchRequest\(cleanToken\(env\.GH_DISPATCH_TOKEN\)/.test(fnBody) && /tokenShape\(env\.GH_DISPATCH_TOKEN\)/.test(fnBody), 'the dispatch sends the cleaned token and a refusal logs only its shape');
ok(!/console\.log\([^)]*GH_DISPATCH_TOKEN\s*[+)]/.test(fnBody) && !/console\.log\([^)]*init/.test(fnBody), 'no log line prints the token or the request');
ok(/snapshot_dispatch: \{ configured: !!env\.GH_DISPATCH_TOKEN/.test(idx), 'health exposes a boolean, never the token');
ok(/workflow_dispatch:/.test(read('.github/workflows/snapshots.yml')), 'snapshots.yml accepts workflow_dispatch');

console.log(fails ? fails + ' snapshot-dispatch test(s) FAILED' : 'snapshot dispatch: all tests passed');
process.exit(fails ? 1 : 0);
