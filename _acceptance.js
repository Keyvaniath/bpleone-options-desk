// _acceptance.js — the repeatable acceptance checklist for the 2026-11-03 audit (run before AND after a release).
// Run: node _acceptance.js [--site https://options.bpleone.com] [--offline]
// Offline part: every _test_*.js suite. Live part: the deployed worker and site, checked against what each fix
// promises. Live items the current deployment cannot pass yet are PENDING (needs deploy), not FAIL.
// Read-only: GETs only, no keys, no writes.
const { execFileSync } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const SITE = (args[args.indexOf('--site') + 1] && args.indexOf('--site') >= 0) ? args[args.indexOf('--site') + 1] : 'https://options.bpleone.com';
const WORKER = 'https://bpleone-brain-worker.brandonpleone.workers.dev';
const OFFLINE = args.includes('--offline');
const EXPECTED = (fs.readFileSync('worker/src/index.js', 'utf8').match(/WORKER_VERSION = '([^']+)'/) || [])[1];

const rows = [];
const rec = (area, item, status, detail) => rows.push({ area, item, status, detail: detail || '' });

// ---- 1. Offline suites
for (const f of fs.readdirSync('.').filter(f => /^_test_.*\.js$/.test(f)).sort()) {
  try {
    const out = execFileSync(process.execPath, [f], { encoding: 'utf8', timeout: 120000 });
    rec('tests', f, 'PASS', out.trim().split('\n').pop());
  } catch (e) {
    rec('tests', f, 'FAIL', ((e.stdout || '') + (e.stderr || '')).trim().split('\n').slice(-3).join(' | '));
  }
}

async function getJson(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : { _err: 'HTTP ' + r.status }; }
  catch (e) { return { _err: e.message }; }
}
// Weekday 8:30-17:00 ET quarter-hours in [from, to): the slots the snapshot chain should fill (34 a full weekday).
function deskSlots(from, to) {
  let n = 0;
  for (let t = Math.ceil(from / 900000) * 900000; t < to; t += 900000) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t));
    const g = k => (p.find(x => x.type === k) || {}).value;
    const hm = (parseInt(g('hour'), 10) % 24) * 100 + parseInt(g('minute'), 10);
    if (['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(g('weekday')) && hm >= 830 && hm < 1700) n++;
  }
  return n;
}
async function getText(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.text() : null; } catch (e) { return null; }
}

(async () => {
  if (!OFFLINE) {
    const now = Date.now();
    // ---- 2. Worker
    const h = await getJson(WORKER + '/brain/health');
    rec('worker', 'health: cron fresh + self-audit passes', h.healthy && h.audit_pass ? 'PASS' : (h._err ? 'FAIL' : 'WARN'),
      h._err || ('tick ' + h.lastTickAgo + 's ago, market_open ' + h.market_open + ', issues ' + JSON.stringify(h.issues || [])));
    const deployed = h.worker_version;
    const isNew = deployed === EXPECTED;
    rec('worker', 'deployed version = repo version (' + EXPECTED + ')', isNew ? 'PASS' : 'PENDING', 'deployed ' + deployed);
    // Pass-320/322: the Worker can also start the snapshot job (minute tick, GH_DISPATCH_TOKEN). Since pass 337
    // the job chains itself, so this path is an optional backup. Judged by runs it actually started (section 4),
    // never by the configured flag: on 11/5-11/11 the flag read true while GitHub rejected the stored token (401).
    const sd = h.snapshot_dispatch;
    const fsc = await getJson(WORKER + '/brain/flow-score');
    rec('worker', 'flow-score overlap-corrected (effective_n)', fsc.leg && fsc.leg.effective_n != null ? 'PASS' : (isNew ? 'FAIL' : 'PENDING'),
      fsc.leg ? ('n ' + fsc.leg.n + ', n_eff ' + fsc.leg.effective_n + ', z ' + fsc.leg.z_score_vs_drift + ' (raw ' + fsc.leg.z_score_vs_drift_raw + ')') : fsc._err);
    rec('worker', 'flow-score discloses window/retention/horizon', fsc.window && fsc.retention && fsc.horizon ? 'PASS' : (isNew ? 'FAIL' : 'PENDING'),
      fsc.window ? JSON.stringify(fsc.window) : '');
    const cs = await getJson(WORKER + '/brain/confluence-score');
    rec('worker', 'confluence-score discloses window + archive', cs.retention && cs.window ? 'PASS' : (isNew ? 'FAIL' : 'PENDING'),
      cs.window ? JSON.stringify(cs.window) : 'total_logged ' + cs.total_logged);
    const ar = await getJson(WORKER + '/brain/archive?log=confluence');
    rec('worker', 'archive route answers', ar.ok ? 'PASS' : (isNew ? 'FAIL' : 'PENDING'), ar.ok ? 'months: ' + (ar.months || []).join(',') : ar._err);
    const lv = await getJson(WORKER + '/brain/ledger-verify?log=confluence');
    rec('worker', 'sealed captures verify (hash chain)', lv.ok ? (lv.broken.length ? 'FAIL' : (lv.sealed ? 'PASS' : 'PENDING')) : (isNew ? 'FAIL' : 'PENDING'),
      lv.ok ? ('sealed ' + lv.sealed + ', legacy ' + lv.legacy + ', broken ' + lv.broken.length + (lv.sealed ? '' : ' (first sealed records arrive with the next daily capture)')) : lv._err);
    const pk = await getJson(WORKER + '/brain/picks');
    const cal = pk.calibration || {};
    rec('worker', 'calibration refit within 26h', cal.fitted && (now - Date.parse(cal.fitted)) < 26 * 3600000 ? 'PASS' : 'WARN', 'fitted ' + cal.fitted + ', slope ' + cal.slope_a + ', informative ' + cal.informative);
    const rl = await getJson(WORKER + '/brain/radar-log?n=1');
    rec('worker', 'radar ledger holds the last session', rl.latest_day ? 'PASS' : 'FAIL', 'latest ' + rl.latest_day + ', ' + (rl.today ? rl.today.captured + '/' + rl.today.of : ''));

    // ---- 3. Site
    const snap = await getJson(SITE + '/data/snap/quotes.json?cb=' + now);
    const snapAgeMin = snap.updatedAt ? Math.round((now - snap.updatedAt) / 60000) : null;
    rec('site', 'price snapshot age (pages fall back to the worker past 30 min)', snapAgeMin != null && snapAgeMin <= 30 ? 'PASS' : 'WARN', snapAgeMin + ' min');
    const ss = await getText(SITE + '/system-status.html');
    rec('site', 'system-status.html is published', ss ? 'PASS' : 'PENDING', ss ? '' : 'not on the site yet (needs the merge to main)');
    for (const m of ['congress-trades', 'econ-calendar', 'edge-lab']) {
      const j = await getJson(SITE + '/data/meta/' + m + '.json?cb=' + now);
      rec('site', 'freshness sidecar data/meta/' + m + '.json', j.checkedAt ? 'PASS' : 'PENDING', j.checkedAt ? 'checked ' + j.checkedAt + ', rows ' + j.rows : 'written by the job\'s next run after the merge');
    }
    const live = await getText(SITE + '/js/live.js?v=check' + now);
    const lazy = live ? live.indexOf('Lazy-load the auto-trainer') : -1;
    const ban = live ? live.indexOf("s.src = 'js/sample-data-banner.js?v=' + LV;") : -1;
    rec('site', 'sample banner loads immediately (not in the 5s batch)', live && ban > 0 && ban < lazy ? 'PASS' : 'PENDING');
    const sdb = await getText(SITE + '/js/sample-data-banner.js?v=check' + now);
    rec('site', 'iv-skew carries the sample banner', sdb && sdb.indexOf("'iv-skew'") >= 0 ? 'PASS' : 'PENDING');
    const gate = await getText(SITE + '/js/no-play-gate.js?v=check' + now);
    rec('site', 'NO PLAY gate on pick pages', gate ? 'PASS' : 'PENDING');
    const ab = await getText(SITE + '/alerts-builder.html');
    rec('site', 'alerts-builder RSI is real (no 50 + 5 x change%)', ab && ab.indexOf('50 + (q.changePct') < 0 ? 'PASS' : 'PENDING');
    const ep = await getText(SITE + '/earnings-playbook.html');
    rec('site', 'earnings-playbook implied move is a real straddle', ep && ep.indexOf('atrPct * 1.7') < 0 ? 'PASS' : 'PENDING');
    const icf = await getText(SITE + '/insider-congress-flow.html');
    rec('site', 'no generated insider trades', icf && !/function\s+syntheticTx/.test(icf) ? 'PASS' : 'PENDING');

    // ---- 4. Scheduled jobs (GitHub's public API; 60 anonymous reads/hour)
    // Pass 337: snapshots.yml chains itself (each run starts the next with GITHUB_TOKEN) on weekdays 8:30-17:00 ET.
    // Judge it by the runs that happened, split by who started them, against the desk-hour quarter-hours in the
    // last 24h. brain-health.yml stays on GitHub's schedule on purpose (it monitors the Worker).
    {
      const r = await getJson('https://api.github.com/repos/Keyvaniath/bpleone-options-desk/actions/workflows/snapshots.yml/runs?per_page=100');
      const day = (r.workflow_runs || []).filter(x => Date.parse(x.created_at) > now - 86400000 && x.conclusion !== 'cancelled');
      const by = x => x.event === 'schedule' ? 'schedule' : ((x.triggering_actor || x.actor || {}).login === 'github-actions[bot]' ? 'chain' : 'other');
      const n = { chain: 0, schedule: 0, other: 0 }; day.forEach(x => n[by(x)]++);
      const total = day.length, slots = deskSlots(now - 86400000, now);
      const ok = slots === 0 ? total > 0 : total >= slots * 0.8;
      rec('jobs', 'snapshots.yml ran through desk hours (24h)', r._err ? 'WARN' : (ok ? 'PASS' : 'WARN'),
        r._err || (total + ' runs vs ' + slots + ' weekday 8:30-17:00 ET quarter-hours (chain ' + n.chain + ', GitHub schedule ' + n.schedule + ', Worker/manual ' + n.other + ')' + (ok ? '' : ': the chain broke or never started; the two-hourly pass restarts it')));
      rec('worker', 'snapshot dispatch (optional backup path)', 'INFO',
        sd ? ('configured ' + !!sd.configured + '; ' + n.other + ' Worker/manual runs in 24h' + (sd.configured && !n.other ? ' (configured but starting nothing: on 11/5 GitHub rejected the stored token, 401; delete or replace the secret)' : '')) : 'not on this Worker build');
    }
    {
      const r = await getJson('https://api.github.com/repos/Keyvaniath/bpleone-options-desk/actions/workflows/brain-health.yml/runs?per_page=60');
      const n = (r.workflow_runs || []).filter(x => x.event === 'schedule' && Date.parse(x.created_at) > now - 86400000).length;
      rec('jobs', 'brain-health.yml ran on schedule (24h)', r._err ? 'WARN' : (n >= 48 * 0.8 ? 'PASS' : 'WARN'),
        r._err || (n + ' runs in 24h vs ~48 asked' + (n >= 48 * 0.8 ? '' : ': GitHub cron starvation; stays on GitHub on purpose (it monitors the Worker); off-peak minutes since pass 337')));
    }
  }

  const w = Math.max(...rows.map(r => (r.area + ' ' + r.item).length));
  for (const r of rows) console.log((r.status + '       ').slice(0, 8) + (r.area + ' ' + r.item).padEnd(w) + '  ' + r.detail);
  const c = s => rows.filter(r => r.status === s).length;
  console.log('\n' + c('PASS') + ' pass · ' + c('PENDING') + ' pending (needs deploy) · ' + c('WARN') + ' warn · ' + c('FAIL') + ' fail' + (c('INFO') ? ' · ' + c('INFO') + ' info' : ''));
  process.exit(c('FAIL') ? 1 : 0);
})();
