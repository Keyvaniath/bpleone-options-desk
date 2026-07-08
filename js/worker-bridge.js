/* ===========================================
   BPLEONE — Worker Bridge
   ---
   Lets browser pages read brain state from the Cloudflare Worker
   instead of (or in addition to) the local browser-resident brain.

   Setup:
     1. Deploy the worker (see worker/README.md)
     2. WorkerBridge.setUrl('https://your-worker.workers.dev')  // once, persists
     3. WorkerBridge.enable()                                    // now pages use worker state

   When enabled:
     - brain-proof.html, brain-truth.html, etc. read journal+model from worker
     - Local capture loop still runs as a fallback (offline-safe)
     - Worker is the authoritative source of "what the brain actually knows"

   Exposes:
     WorkerBridge.setUrl(url) / getUrl()
     WorkerBridge.enable() / disable() / isEnabled()
     WorkerBridge.health()                  → { ok, lastTickAgo, healthy }
     WorkerBridge.state()                   → { journal, model, lastTick }
     WorkerBridge.journal(n)                → recent N entries
     WorkerBridge.model()                   → server's current model weights
   =========================================== */

(function () {
  const STORAGE_KEY = 'bpleone_worker_bridge_v1';

  function loadCfg() {
    if (typeof localStorage === 'undefined') return { url: '', enabled: false };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { url: '', enabled: false };
    } catch (e) { return { url: '', enabled: false }; }
  }
  function saveCfg(c) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch (e) {}
  }

  function setUrl(url) {
    const c = loadCfg();
    c.url = (url || '').replace(/\/$/, '');  // strip trailing slash
    saveCfg(c);
    return c;
  }
  function getUrl() { return loadCfg().url; }
  function enable() { const c = loadCfg(); c.enabled = true; saveCfg(c); return c; }
  function disable() { const c = loadCfg(); c.enabled = false; saveCfg(c); return c; }
  function isEnabled() { return !!loadCfg().enabled; }

  async function _fetch(path) {
    const cfg = loadCfg();
    if (!cfg.url) return { error: 'no-worker-url' };
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeoutId = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
      const r = await fetch(cfg.url + path, { signal: ctrl ? ctrl.signal : undefined });
      if (timeoutId) clearTimeout(timeoutId);
      if (!r.ok) return { error: 'http-' + r.status };
      return await r.json();
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  }

  async function health() { return _fetch('/brain/health'); }
  async function state()  { return _fetch('/brain/state'); }
  async function journal(n) { return _fetch('/brain/journal?n=' + (n || 200)); }
  async function model()  { return _fetch('/brain/model'); }

  // One-shot bootstrap fetch — call this when you want to seed the browser's
  // local view with the worker's authoritative state (e.g. after page load).
  // Imports the worker's journal into bpleone_pred_journal_v1 (mirror copy).
  //
  // Pass 198 defensive guards:
  //   - Array.isArray() check on the local journal (corruption-safe)
  //   - Array.isArray() check on s.journal (server-response-safe)
  //   - Array length === 22 check on s.model.weights (model-format-safe)
  // Previously a corrupted localStorage or malformed worker response would
  // throw inside .map / .filter and the whole sync silently failed forever.
  async function syncFromWorker() {
    if (!isEnabled()) return { skipped: 'not-enabled' };
    const s = await state();
    if (s.error) return { error: s.error };
    if (typeof localStorage === 'undefined') return { error: 'no-localStorage' };
    try {
      // Merge into local journal (don't overwrite — preserves any local-only entries).
      // If local storage was corrupted (parsed to non-array), reset to []
      // instead of crashing the whole sync.
      let local;
      try {
        const parsed = JSON.parse(localStorage.getItem('bpleone_pred_journal_v1') || '[]');
        local = Array.isArray(parsed) ? parsed : [];
      } catch (e) { local = []; }
      const localIds = new Set(local.map(e => e && e.id).filter(Boolean));
      const serverJournal = Array.isArray(s.journal) ? s.journal : [];
      const merged = local.concat(serverJournal.filter(e => e && e.id && !localIds.has(e.id)));
      // Cap and persist
      if (merged.length > 12000) merged.splice(0, merged.length - 12000);
      localStorage.setItem('bpleone_pred_journal_v1', JSON.stringify(merged));
      // Also mirror the worker's model into the local ModelStore key — flag
      // it as worker-sourced so the local trainer knows not to retrain from
      // scratch (since worker is authoritative). Only mirror if the weight
      // vector is a 22-element array (the production shape).
      if (s.model && Array.isArray(s.model.weights) && s.model.weights.length === 22) {
        const m = {
          weights: s.model.weights,
          bias: typeof s.model.bias === 'number' ? s.model.bias : 0,
          n_trained: typeof s.model.n_trained === 'number' ? s.model.n_trained : 0,
          version: s.model.version || 1,
          source: 'worker'
        };
        localStorage.setItem('bpleone_model_v1', JSON.stringify(m));
      }
      return {
        ok: true,
        merged: merged.length - local.length,
        modelN: s.model && s.model.n_trained,
        lastTickAgo: s.lastTick && s.lastTick.ts ? Math.floor((Date.now() - s.lastTick.ts) / 1000) : null
      };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  }

  if (typeof window !== 'undefined') {
    window.WorkerBridge = {
      setUrl, getUrl, enable, disable, isEnabled,
      health, state, journal, model, syncFromWorker
    };

    // Auto-sync on page load if enabled
    if (typeof document !== 'undefined') {
      const fire = () => {
        if (isEnabled() && getUrl()) {
          syncFromWorker().then(r => {
            if (r.ok && r.merged > 0) {
              try { window.dispatchEvent(new CustomEvent('bpleone:worker-sync', { detail: r })); } catch (e) {}
            }
          });
          // Re-sync the brain-state mirror while page is open — skip the tick
          // while the tab is hidden (no point polling in a backgrounded tab) and
          // catch up immediately on return (mirror worker-quotes.js).
          // Pass 302 (scale): 60s -> 180s. This is a viewer mirror of brain state
          // that the cron only changes ~1/min; 3-min re-sync loses nothing
          // meaningful and cuts this poller's worker load 3x for free.
          if (!window._workerBridgeSync) {
            const pollSync = () => {
              if (typeof document !== 'undefined' && document.hidden) return;  // hidden tab: skip (catch up on visibilitychange)
              syncFromWorker().catch(() => {});
            };
            window._workerBridgeSync = setInterval(pollSync, 180000);
            document.addEventListener('visibilitychange', () => { if (!document.hidden) pollSync(); });
          }
        }
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(fire, 1500));
      else setTimeout(fire, 1500);
    }
  }
})();
