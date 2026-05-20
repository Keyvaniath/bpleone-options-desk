/* ===========================================
   BPLEONE — Journal Repair Migrations
   ---
   One-shot, idempotent migrations that repair corrupted journal entries
   from past audit-discovered bugs. Each migration is gated by a version
   flag in localStorage so it only runs ONCE per browser, but is safe to
   re-run if the flag is cleared (idempotent — recomputes from immutable
   inputs like entry.ts).

   Migrations registered here:

     M1 — feature[20] timezone repair (pass 119 fix)
       Past entries captured before pass 119 had feature[20] (hour of
       trading session) computed from new Date().getHours() — local time.
       For non-ET users this was systematically wrong. Recomputes
       feature[20] from entry.ts using America/New_York timezone.

   Exposes:
     JournalRepair.runAll()             — runs every migration in order
     JournalRepair.runMigration(name)   — manually run one migration (clears its version flag first)
     JournalRepair.status()             — returns { ranAt, repairCount, migrations: [...] }
     JournalRepair.reset()              — clears all version flags so migrations re-run on next call
   =========================================== */

(function () {
  const JOURNAL_KEY = 'bpleone_pred_journal_v1';
  const STATUS_KEY = 'bpleone_journal_repair_v1';

  function loadJournal() {
    if (typeof localStorage === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveJournal(j) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(j)); } catch (e) {}
  }
  function loadStatus() {
    if (typeof localStorage === 'undefined') return { ran: {}, lastRunAt: 0, history: [] };
    try {
      const s = JSON.parse(localStorage.getItem(STATUS_KEY) || 'null');
      return s || { ran: {}, lastRunAt: 0, history: [] };
    } catch (e) { return { ran: {}, lastRunAt: 0, history: [] }; }
  }
  function saveStatus(s) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(STATUS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // ---- Helper: get hour-of-session in ET from any timestamp ----
  function etHourFromTs(ts) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour12: false, hour: '2-digit', minute: '2-digit'
      }).formatToParts(new Date(ts));
      let hh = 0, mm = 0;
      for (const p of parts) {
        if (p.type === 'hour') hh = parseInt(p.value, 10) % 24;
        if (p.type === 'minute') mm = parseInt(p.value, 10);
      }
      return hh + mm / 60;
    } catch (e) {
      const d = new Date(ts);
      return d.getHours() + d.getMinutes() / 60;
    }
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // ---- Migration M1: feature[20] timezone repair ----
  // FEATURES schema (see js/model.js):
  //   features[20] = clamp((etHour - 9.5) / (16 - 9.5), 0, 1)
  // The fix at pass 119 corrected NEW captures. This migration retroactively
  // applies the same formula to historical entries.
  const M1 = {
    name: 'feature20-tz-repair',
    description: 'Recompute feature[20] (hour of session) in ET for all journal entries — pass 119 fix',
    version: 'v1',
    run() {
      const journal = loadJournal();
      let repaired = 0;
      let skipped = 0;
      for (const entry of journal) {
        if (!entry || !entry.ts || !Array.isArray(entry.features) || entry.features.length < 22) {
          skipped++;
          continue;
        }
        const correctEtHour = etHourFromTs(entry.ts);
        const correctFeature20 = clamp((correctEtHour - 9.5) / (16 - 9.5), 0, 1);
        if (Math.abs((entry.features[20] || 0) - correctFeature20) > 0.001) {
          entry.features[20] = +correctFeature20.toFixed(4);
          repaired++;
        } else {
          skipped++;
        }
      }
      if (repaired > 0) saveJournal(journal);
      return { repaired, skipped, total: journal.length };
    }
  };

  const MIGRATIONS = [M1];

  function runMigration(migration) {
    const status = loadStatus();
    const key = migration.name + '@' + migration.version;
    if (status.ran[key]) return { skipped: true, reason: 'already-ran', key };
    const t0 = Date.now();
    let result;
    try {
      result = migration.run();
    } catch (e) {
      result = { error: String(e && e.message || e) };
    }
    status.ran[key] = Date.now();
    status.lastRunAt = Date.now();
    status.history = status.history || [];
    status.history.push({
      ts: Date.now(),
      name: migration.name,
      version: migration.version,
      durationMs: Date.now() - t0,
      result
    });
    if (status.history.length > 50) status.history = status.history.slice(-50);
    saveStatus(status);
    // Also log to the brain changelog if it exists
    try {
      const log = JSON.parse(localStorage.getItem('bpleone_brain_changelog_v1') || '[]');
      log.unshift({
        ts: Date.now(),
        type: 'repair',
        title: 'Journal repair: ' + migration.name,
        body: migration.description + ' — ' + JSON.stringify(result),
        meta: { migration: migration.name, version: migration.version }
      });
      localStorage.setItem('bpleone_brain_changelog_v1', JSON.stringify(log.slice(0, 200)));
    } catch (e) {}
    return { ok: !result.error, durationMs: Date.now() - t0, result };
  }

  function runAll() {
    const results = [];
    for (const m of MIGRATIONS) {
      results.push(Object.assign({ name: m.name, version: m.version }, runMigration(m)));
    }
    return results;
  }

  function runByName(name) {
    const m = MIGRATIONS.find(x => x.name === name);
    if (!m) return { error: 'no-such-migration' };
    // Clear the version flag so it re-runs
    const status = loadStatus();
    delete status.ran[m.name + '@' + m.version];
    saveStatus(status);
    return runMigration(m);
  }

  function status() {
    const s = loadStatus();
    return {
      lastRunAt: s.lastRunAt,
      migrations: MIGRATIONS.map(m => ({
        name: m.name,
        version: m.version,
        description: m.description,
        ranAt: s.ran[m.name + '@' + m.version] || null
      })),
      history: (s.history || []).slice(-10).reverse()
    };
  }

  function reset() {
    saveStatus({ ran: {}, lastRunAt: 0, history: [] });
  }

  window.JournalRepair = { runAll, runMigration: runByName, status, reset, MIGRATIONS };

  // Auto-run all pending migrations on page load (one-shot per browser per
  // migration-version). Run after a short delay so other modules (like the
  // continuous-learner) have a chance to load.
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    const fire = () => setTimeout(() => { try { runAll(); } catch (e) {} }, 4000);
    if (document.readyState === 'complete' || document.readyState === 'interactive') fire();
    else document.addEventListener('DOMContentLoaded', fire);
  }
})();
