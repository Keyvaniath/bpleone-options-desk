/* ===========================================
   BPLEONE — Economic calendar feed for browser pages
   ---
   Audit 2026-11-11 (pass 340). Two problems this module fixes:
     1. SPY Radar and the options board read the Worker's /brain/econ, which was
        still serving the week of 10/18 in November (ForexFactory blocks Cloudflare
        Worker fetches, so it serves its last good copy). They then kept only future
        events, found none, and SPY Radar told visitors "No US high-impact events
        left this week — the calendar risk is behind you" during a PPI week.
     2. calendar-plays and tomorrow-playbook read Finnhub's /calendar/economic, a
        premium endpoint: a free key gets 403 (checked in Brandon's browser 11/11),
        so the macro rows were always empty.
   Source order (same as economic-events.html): the same-origin file the
   econ-calendar GitHub Action commits daily (data/econ-calendar-thisweek.json),
   then the Worker. A feed is used only if it covers today; otherwise load()
   says so and the page shows no events instead of a false all-clear.

   Exposes:
     EconFeed.load() -> { ok, events, source, coverage: {first, last}, lastGood }
                        or { ok: false, events: [], reason: 'out-of-date'|'unreachable', tried }
     EconFeed.us(events, { fromTs, toTs, impacts: ['high','medium'] }) -> filtered US rows
     EconFeed.etDay(ts), EconFeed.etTime(ts)
   =========================================== */
(function () {
  const DEFAULT_WORKER = 'https://bpleone-brain-worker.brandonpleone.workers.dev';
  const FILE = 'data/econ-calendar-thisweek.json';
  const SLACK_MS = 36 * 3600 * 1000;   // a weekly file still "covers" today up to 36 h after its last event

  function workerBase() {
    try {
      if (window.WorkerBridge && typeof window.WorkerBridge.getUrl === 'function') {
        const u = window.WorkerBridge.getUrl();
        if (u && /^https:\/\//.test(u)) return u.replace(/\/$/, '');
      }
    } catch (e) {}
    return DEFAULT_WORKER;
  }
  async function getJson(url) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  function etDay(ts) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ts)); }
    catch (e) { return new Date(ts).toISOString().slice(0, 10); }
  }
  function etTime(ts) {
    try { return new Date(ts).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch (e) { return ''; }
  }
  function coverage(events) {
    const ts = events.map(e => Date.parse(e && e.date)).filter(isFinite);
    if (!ts.length) return null;
    const firstTs = Math.min.apply(null, ts), lastTs = Math.max.apply(null, ts);
    return { firstTs, lastTs, first: etDay(firstTs), last: etDay(lastTs) };
  }
  function covers(cov, now) {
    return !!cov && cov.lastTs >= now - SLACK_MS && cov.firstTs <= now + SLACK_MS;
  }

  async function load() {
    const now = Date.now();
    const tried = [];
    const file = await getJson(FILE);
    if (Array.isArray(file) && file.length) {
      const c = coverage(file);
      tried.push({ source: 'desk calendar file', coverage: c });
      if (covers(c, now)) return { ok: true, events: file, source: 'desk calendar file', coverage: c, lastGood: false };
    }
    const w = await getJson(workerBase() + '/brain/econ');
    if (w && w.ok && Array.isArray(w.events) && w.events.length) {
      const c = coverage(w.events);
      tried.push({ source: 'worker', coverage: c });
      if (covers(c, now)) return { ok: true, events: w.events, source: 'worker', coverage: c, lastGood: !!w.stale };
    }
    return { ok: false, events: [], reason: tried.length ? 'out-of-date' : 'unreachable', tried };
  }

  // US rows (ForexFactory marks them country 'USD'), by impact, optionally inside [fromTs, toTs].
  function us(events, opts) {
    opts = opts || {};
    const impacts = (opts.impacts || ['high']).map(s => s.toLowerCase());
    return (events || []).filter(e => {
      if (!e || e.country !== 'USD') return false;
      if (impacts.indexOf(String(e.impact || '').toLowerCase()) < 0) return false;
      const t = Date.parse(e.date);
      if (!isFinite(t)) return false;
      if (opts.fromTs != null && t < opts.fromTs) return false;
      if (opts.toTs != null && t > opts.toTs) return false;
      return true;
    });
  }

  window.EconFeed = { load, us, coverage, etDay, etTime };
})();
