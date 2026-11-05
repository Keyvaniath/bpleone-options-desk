// Pass-320: the Worker starts the GitHub snapshot job (.github/workflows/snapshots.yml) through
// workflow_dispatch. GitHub's own schedule ran that job about 5 times a day instead of ~48: scheduled
// events are delayed and dropped under load, while dispatched runs start right away. The job stays the
// only publisher of data/snap/*.json (the free CDN copy the browser pollers read first), so the CDN
// offload is unchanged; only the trigger moves. Pure logic here; the fetch lives in index.js.
//
// Pass-321 (2026-11-05): pass-320 used a second cron trigger ('*/15 * * * *'). Cloudflare never fired it:
// when two triggers match the same minute it invokes the Worker ONCE, as the minute trigger (observed with
// wrangler tail, 12:34-12:48 ET: one event per minute, the 12:45 one labeled '* * * * *'). The dispatch now
// rides the minute tick, keyed on the tick's scheduledTime.

export const SNAPSHOT_REPO = 'Keyvaniath/bpleone-options-desk';
export const SNAPSHOT_WORKFLOW = 'snapshots.yml';
export const SNAPSHOT_SCHEDULE = 'every 15 min on weekdays 9:00-16:15 ET, hourly otherwise (rides the minute tick)';

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etClock(ts) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(ts));
  const g = t => (p.find(x => x.type === t) || {}).value;
  return { wd: WD[g('weekday')], h: parseInt(g('hour'), 10) % 24, m: parseInt(g('minute'), 10) };
}

// Called on every minute tick with the tick's scheduledTime. Due at :00/:15/:30/:45 on weekdays from 9:00
// to 16:15 ET, and at :00 otherwise. 16:30 and 16:45 are skipped on purpose: that is when the radar ledger
// and the bar finalizer spend the tick's subrequest budget; the 17:00 run carries the closing prices.
// Market holidays run on the weekday schedule: harmless, the job commits only when the data changed.
export function snapshotDispatchDue(ts) {
  const { wd, h, m } = etClock(ts);
  if (m % 15 !== 0) return false;
  const weekday = wd >= 1 && wd <= 5;
  if (weekday && ((h >= 9 && h < 16) || (h === 16 && m === 15))) return true;
  return m === 0;
}

// Pass-322: the first token set through `wrangler secret put` drew 401 Bad credentials. A secret pasted
// into a terminal's hidden prompt can carry junk (spaces, a trailing CR, bracketed-paste escape codes).
// GitHub tokens are [A-Za-z0-9_] behind a known prefix, so pull the token out of whatever surrounds it.
export function cleanToken(raw) {
  const s = String(raw || '');
  const m = s.match(/github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+/);
  return m ? m[0] : s.trim();
}

// Describes the stored secret WITHOUT revealing it, for the failure log: lengths, the token type, and
// whether cleaning stripped anything. A fine-grained token is 93 characters; a classic one is 40.
export function tokenShape(raw) {
  const s = String(raw || '');
  const c = cleanToken(s);
  const kind = /^github_pat_/.test(c) ? 'fine-grained' : /^gh[pousr]_/.test(c) ? 'classic' : 'unrecognized (no GitHub token prefix)';
  return 'stored ' + s.length + ' chars; ' + kind + ' token, ' + c.length + ' chars' + (c !== s ? '; extra characters were stripped' : '; nothing stripped');
}

// The GitHub REST call. The token goes only in the Authorization header: never in the URL or a log.
export function buildDispatchRequest(token, ref) {
  return {
    url: 'https://api.github.com/repos/' + SNAPSHOT_REPO + '/actions/workflows/' + SNAPSHOT_WORKFLOW + '/dispatches',
    init: {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'bpleone-brain-worker',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: ref || 'main' })
    }
  };
}
