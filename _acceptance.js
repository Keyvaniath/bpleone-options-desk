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
    // Pass-320: the 15-min trigger starts the GitHub snapshot job; it needs the GH_DISPATCH_TOKEN secret.
    const sd = h.snapshot_dispatch;
    rec('worker', 'snapshot dispatch configured (15-min trigger)', sd && sd.configured ? 'PASS' : 'PENDING',
      sd ? (sd.configured ? sd.schedule : 'deployed, but the GH_DISPATCH_TOKEN secret is not set') : 'needs the pass-320 deploy');
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
    // Pass-320: snapshots.yml is started by the Worker (workflow_dispatch) with GitHub's schedule as a backup,
    // so both events count. brain-health.yml stays on GitHub's schedule on purpose: it watches the Worker, and
    // a check the Worker triggered would stop exactly when the Worker fails.
    for (const [file, perDay, events, why] of [
      ['snapshots.yml', 40, ['schedule', 'workflow_dispatch'], 'GitHub cron starvation; the Worker trigger (pass-320) fixes it once deployed with its token'],
      ['brain-health.yml', 40, ['schedule'], 'GitHub cron starvation; stays on GitHub on purpose (it monitors the Worker)']]) {
      const r = await getJson('https://api.github.com/repos/Keyvaniath/bpleone-options-desk/actions/workflows/' + file + '/runs?per_page=100');
      const day = (r.workflow_runs || []).filter(x => Date.parse(x.created_at) > now - 86400000);
      const n = day.filter(x => events.indexOf(x.event) >= 0).length;
      const nd = day.filter(x => x.event === 'workflow_dispatch').length;
      rec('jobs', file + ' ran on schedule (24h)', r._err ? 'WARN' : (n >= perDay * 0.8 ? 'PASS' : 'WARN'),
        r._err || (n + ' runs in 24h vs ~' + perDay + '+ asked' + (events.length > 1 ? ' (' + nd + ' started by the Worker)' : '') + (n >= perDay * 0.8 ? '' : ': ' + why)));
    }
  }

  const w = Math.max(...rows.map(r => (r.area + ' ' + r.item).length));
  for (const r of rows) console.log((r.status + '       ').slice(0, 8) + (r.area + ' ' + r.item).padEnd(w) + '  ' + r.detail);
  const c = s => rows.filter(r => r.status === s).length;
  console.log('\n' + c('PASS') + ' pass · ' + c('PENDING') + ' pending (needs deploy) · ' + c('WARN') + ' warn · ' + c('FAIL') + ' fail');
  process.exit(c('FAIL') ? 1 : 0);
})();
