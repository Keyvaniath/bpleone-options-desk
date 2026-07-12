/* ===========================================
   BPLEONE — Live Quote Hydrate (pass 305)
   ---
   Fixes a systemic honesty bug found in the pass-305 audit: several pages
   render a hardcoded symbol LIST (watchlists, quote grids, market maps, level
   engines) that includes names OUTSIDE the worker UNIVERSE / QUOTES seed map
   (MSTR, HOOD, SOFI, RIOT, HD, WMT, LLY, ...). The site's primary feed
   (worker-quotes.js) only UPDATES existing seed keys, so those off-universe
   names never received a real price and each page fell back to a fabricated
   placeholder ($100.00 / $0.00 / +0.00%) presented as live.

   This module hydrates REAL prices for ANY symbol list from the worker's
   /brain/quotes endpoint (which accepts any ticker, exactly like the well-built
   pages already do), CREATING QUOTES entries as needed and marking them
   fresh=true so the page's getQ returns real data. It never fabricates: symbols
   the worker can't price are simply left absent, and callers render '—'.

   Usage:
     hydrateQuotes(['SPY','MSTR','HOOD'], { onDone: renderAll });
   =========================================== */
(function () {
  const DEFAULT_WORKER = 'https://bpleone-brain-worker.brandonpleone.workers.dev';
  function workerUrl() {
    try { if (typeof WorkerBridge !== 'undefined' && WorkerBridge.getUrl) { const u = WorkerBridge.getUrl(); if (u) return u; } } catch (e) {}
    return DEFAULT_WORKER;
  }

  async function hydrateQuotes(symbols, opts) {
    opts = opts || {};
    if (typeof QUOTES === 'undefined') { if (opts.onDone) opts.onDone(0); return 0; }
    let syms = (symbols || []).map(s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9.\-]/g, '').trim()).filter(Boolean);
    syms = [...new Set(syms)];
    // Skip symbols that already carry a fresh real price (unless forced).
    if (!opts.force) syms = syms.filter(s => { const q = QUOTES[s]; return !(q && q.fresh && q.last > 0); });
    if (!syms.length) { if (opts.onDone) opts.onDone(0); return 0; }

    const CHUNK = 40;
    let applied = 0;

    function applyQuote(sym, v) {
      if (!v || typeof v.last !== 'number' || !(v.last > 0)) return;
      const chgPct = typeof v.changePct === 'number' ? v.changePct : 0;
      const prev = (typeof v.prevClose === 'number' && v.prevClose > 0)
        ? v.prevClose
        : (chgPct !== 0 ? v.last / (1 + chgPct / 100) : v.last);
      const cur = QUOTES[sym] || (QUOTES[sym] = { symbol: sym });
      cur.last = +v.last;
      cur.prevClose = +(+prev).toFixed(4);
      cur.change = +(cur.last - cur.prevClose).toFixed(4);
      cur.changePct = +chgPct.toFixed(4);
      if (typeof v.volume === 'number') cur.volume = v.volume;
      if (typeof v.rvol === 'number') cur.rvol = v.rvol;
      if (typeof v.dayHigh === 'number') cur.dayHigh = v.dayHigh;
      if (typeof v.dayLow === 'number') cur.dayLow = v.dayLow;
      cur.priceSource = 'worker-yahoo';
      cur.liveAt = v.ts || Date.now();
      cur.ts = Date.now();
      cur.fresh = true;
      try { if (typeof Feed !== 'undefined') Feed.publish(sym, cur); } catch (e) {}
      applied++;
    }

    // Pass 305 (scale): CDN-snapshot-FIRST, mirroring worker-quotes.js. At page
    // load nothing is fresh yet, so hitting the metered live worker for the FULL
    // list duplicated the primary feed. The published snapshot covers the whole
    // in-universe set from the free Fastly CDN; only the symbols it does NOT
    // carry (the truly off-universe names) go to /brain/quotes.
    async function trySnapshot(list) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 6000);
        const bucket = Math.floor(Date.now() / 300000);   // 5-min CDN-cacheable bucket
        const r = await fetch('/data/snap/quotes.json?b=' + bucket, { signal: ctrl.signal });
        clearTimeout(to);
        if (!r.ok) return list;
        const j = await r.json();
        const upd = j && j.updatedAt;
        if (!upd || (Date.now() - upd) > 30 * 60 * 1000) return list;   // stale -> worker
        const qm = j.quotes || {};
        const remaining = [];
        for (const s of list) { if (qm[s]) applyQuote(s, qm[s]); else remaining.push(s); }
        return remaining;
      } catch (e) { return list; }
    }

    async function fetchChunk(list) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 9000);
        const r = await fetch(workerUrl() + '/brain/quotes?syms=' + encodeURIComponent(list.join(',')), { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(to);
        if (!r.ok) return;
        const j = await r.json();
        const qm = j && j.quotes;
        if (!qm) return;
        for (const sym in qm) applyQuote(sym, qm[sym]);
      } catch (e) {}
    }

    function announce() {
      try { if (typeof Feed !== 'undefined') Feed.publish('*', QUOTES); } catch (e) {}
      try { if (typeof setDataMode === 'function') setDataMode('live'); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('bpleone:quotes', { detail: { applied, hydrate: true } })); } catch (e) {}
    }

    // First pass: CDN snapshot for whatever it covers, live worker for the rest.
    const offSnapshot = await trySnapshot(syms);
    if (offSnapshot.length) {
      const batches = [];
      for (let i = 0; i < offSnapshot.length; i += CHUNK) batches.push(offSnapshot.slice(i, i + CHUNK));
      await Promise.all(batches.map(fetchChunk));
    }

    // Pass 305: announce + onDone IMMEDIATELY after the first pass - symbols that
    // hydrated on try one must not wait 2.5s behind the retry (which previously
    // also delayed pages where one permanently-unpriceable symbol forced the slow
    // path on every load). The bounded retry runs in the BACKGROUND for just the
    // missing symbols and fires a second announce only if it lands more quotes.
    if (applied > 0) announce();
    if (opts.onDone) opts.onDone(applied);

    if (opts.retry !== false) {
      const missing = syms.filter(s => { const q = QUOTES[s]; return !(q && q.fresh && q.last > 0); });
      if (missing.length) {
        (async () => {
          await new Promise(res => setTimeout(res, 2500));
          const before = applied;
          const retryBatches = [];
          for (let i = 0; i < missing.length; i += CHUNK) retryBatches.push(missing.slice(i, i + CHUNK));
          await Promise.all(retryBatches.map(fetchChunk));
          if (applied > before) { announce(); if (opts.onDone) opts.onDone(applied); }
        })();
      }
    }
    return applied;
  }

  if (typeof window !== 'undefined') window.hydrateQuotes = hydrateQuotes;
})();
