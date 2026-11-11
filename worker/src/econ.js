// Economic calendar helpers for /brain/econ (worker pass-323, audit 2026-11-11).
//
// ForexFactory's CDN rejects Cloudflare Worker egress most of the time (pass 319 measured ~2 of 3 failures).
// By November the live fetch had failed for three weeks straight, and the endpoint kept serving its KV
// "last good" copy: the week of 10/18, labeled stale. SPY Radar read it, kept only future events, found none
// and told visitors the week's calendar risk was "behind you" during a PPI week.
//
// Two rules now:
//   1. a second source sits between the live fetch and the KV copy: the calendar file the econ-calendar
//      GitHub Action commits daily and GitHub Pages serves (ECON_DESK_FILE);
//   2. a copy that does not cover today is never served as this week's calendar.
// Pure functions only; index.js does the fetching and KV.

export const ECON_DESK_FILE = 'https://options.bpleone.com/data/econ-calendar-thisweek.json';
export const ECON_SLACK_MS = 36 * 3600 * 1000;   // a Sunday-to-Saturday file still covers "today" 36 h past its last event

export function normalizeEconEvents(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.filter(e => e && typeof e === 'object').map(e => ({
    title: e.title || '',
    country: e.country || '',
    date: e.date || '',
    impact: e.impact || '',
    forecast: e.forecast || '',
    previous: e.previous || ''
  }));
}

export function econCoverage(events) {
  if (!Array.isArray(events)) return null;
  const ts = events.map(e => Date.parse(e && e.date)).filter(t => isFinite(t));
  if (!ts.length) return null;
  const firstTs = Math.min.apply(null, ts), lastTs = Math.max.apply(null, ts);
  return { firstTs, lastTs, first: new Date(firstTs).toISOString().slice(0, 10), last: new Date(lastTs).toISOString().slice(0, 10) };
}

// True when the calendar's events span today (with the slack above). An empty or undated list never covers.
export function econCovers(events, now) {
  const c = econCoverage(events);
  return !!c && c.lastTs >= now - ECON_SLACK_MS && c.firstTs <= now + ECON_SLACK_MS;
}
