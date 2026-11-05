// Pass-320: the Worker starts the GitHub snapshot job (.github/workflows/snapshots.yml) through
// workflow_dispatch. GitHub's own schedule ran that job about 5 times a day instead of ~48: scheduled
// events are delayed and dropped under load, while dispatched runs start right away. The job stays the
// only publisher of data/snap/*.json (the free CDN copy the browser pollers read first), so the CDN
// offload is unchanged; only the trigger moves. Pure logic here; the fetch lives in index.js.

// Must equal the second entry of [triggers].crons in wrangler.toml. scheduled() routes on it.
export const SNAPSHOT_CRON = '*/15 * * * *';
export const SNAPSHOT_REPO = 'Keyvaniath/bpleone-options-desk';
export const SNAPSHOT_WORKFLOW = 'snapshots.yml';
export const SNAPSHOT_SCHEDULE = 'every 15 min on weekdays 9:00-16:45 ET, hourly otherwise';

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etClock(ts) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(ts));
  const g = t => (p.find(x => x.type === t) || {}).value;
  return { wd: WD[g('weekday')], h: parseInt(g('hour'), 10) % 24, m: parseInt(g('minute'), 10) };
}

// The trigger fires at :00, :15, :30 and :45. Dispatch on every fire during weekday desk hours
// (9:00-16:59 ET, which brackets the 9:30-16:00 session and the close), and on the :00 fire otherwise.
// Market holidays run on the weekday schedule: harmless, the job commits only when the data changed.
export function snapshotDispatchDue(ts) {
  const { wd, h, m } = etClock(ts);
  if (wd >= 1 && wd <= 5 && h >= 9 && h < 17) return true;
  return m < 15;
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
