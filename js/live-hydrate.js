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
    const batches = [];
    for (let i = 0; i < syms.length; i += CHUNK) batches.push(syms.slice(i, i + CHUNK));
    let applied = 0;

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
        for (const sym in qm) {
          const v = qm[sym];
          if (!v || typeof v.last !== 'number' || !(v.last > 0)) continue;
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
      } catch (e) {}
    }

    await Promise.all(batches.map(fetchChunk));
    if (applied > 0) {
      try { if (typeof Feed !== 'undefined') Feed.publish('*', QUOTES); } catch (e) {}
      try { if (typeof setDataMode === 'function') setDataMode('live'); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('bpleone:quotes', { detail: { applied, hydrate: true } })); } catch (e) {}
    }
    if (opts.onDone) opts.onDone(applied);
    return applied;
  }

  if (typeof window !== 'undefined') window.hydrateQuotes = hydrateQuotes;
})();
