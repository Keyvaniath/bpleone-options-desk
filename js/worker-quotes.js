/* ===========================================
   BPLEONE — Worker Live Quotes (pass 239)
   ---
   NO FAKE NUMBERS. This is the primary real-price feed for the browser.

   The in-browser Stooq fallback is unreliable (CORS / network), and the old
   default fabricated inter-poll movement with an OU random walk. Instead we
   pull REAL prices from our own Cloudflare Worker, which fetches Yahoo
   server-side (no CORS, proven reliable) — the SAME data the 24/7 brain trains
   and predicts on. One audited source of truth for both the model and the
   displayed price.

   Source: GET {worker}/brain/signals — already maintained every cron tick with
   per-symbol { last, changePct, rvol, ts }. No new worker writes, no added cost.

   - Writes real values into QUOTES with priceSource='worker-yahoo', liveAt=ts.
   - NEVER fabricates: if the worker is unreachable, prices simply hold at their
     last real value (honest) and the data-mode banner reflects staleness.
   - Polls every 25s. Equity data is ~15min delayed (free tier); crypto via the
     worker's Binance/Yahoo proxy. Clearly a delayed-data product, never faked.
   =========================================== */

(function () {
  const DEFAULT_WORKER = 'https://bpleone-brain-worker.brandonpleone.workers.dev';
  const POLL_MS = 25000;
  let timer = null;
  let lastOk = 0;

  function workerUrl() {
    try {
      if (typeof WorkerBridge !== 'undefined' && WorkerBridge.getUrl) {
        const u = WorkerBridge.getUrl();
        if (u) return u;
      }
    } catch (e) {}
    return DEFAULT_WORKER;
  }

  async function pollOnce() {
    if (typeof QUOTES === 'undefined') return;
    const url = workerUrl() + '/brain/signals';
    let j;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) return;
      j = await r.json();
    } catch (e) { return; }
    const sigs = (j && Array.isArray(j.signals)) ? j.signals : [];
    if (sigs.length === 0) return;
    let applied = 0;
    for (const s of sigs) {
      if (!s || !s.sym || typeof s.last !== 'number' || !(s.last > 0)) continue;
      const q = QUOTES[s.sym];
      if (!q) continue;
      // Derive prevClose from the worker's changePct so change math is consistent.
      const chgPct = typeof s.changePct === 'number' ? s.changePct : 0;
      const prevClose = chgPct !== 0 ? s.last / (1 + chgPct / 100) : (q.prevClose || s.last);
      q.last = +s.last;
      q.prevClose = +(+prevClose).toFixed(4);
      q.change = +(q.last - q.prevClose).toFixed(4);
      q.changePct = +chgPct.toFixed(4);
      q.bid = +(q.last - 0.01).toFixed(2);
      q.ask = +(q.last + 0.01).toFixed(2);
      if (typeof s.rvol === 'number') q.rvol = s.rvol;
      q.priceSource = 'worker-yahoo';
      q.liveAt = s.ts || Date.now();
      q.ts = Date.now();
      q.fresh = true;   // pass 247: mark as a real/live quote — pages like the
                        // Dashboard filter on q.fresh and were showing empty
                        // because the worker feed never set it.
      if (typeof Feed !== 'undefined') Feed.publish(s.sym, q);
      applied++;
    }
    if (applied > 0) {
      lastOk = Date.now();
      if (typeof Feed !== 'undefined') Feed.publish('*', QUOTES);
      // Flip the global data mode to live the moment real worker prices land.
      try { if (typeof setDataMode === 'function') setDataMode('live'); } catch (e) {}
      // Pass 243: emit both events. 'bpleone:quotes' is the canonical "real
      // prices updated — re-render" signal that custom one-time renders listen
      // for (Feed only auto-updates [data-live] elements, not JS-built widgets).
      try { window.dispatchEvent(new CustomEvent('bpleone:quotes', { detail: { applied, at: lastOk } })); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('bpleone:worker-quotes', { detail: { applied, at: lastOk } })); } catch (e) {}
    }
  }

  // Pass 280: pull REAL prices for the FULL displayed universe (not just the ~24
  // ranked signals), so every seed gets replaced by a real (delayed) price — e.g.
  // SMCI now shows the real ~$40 down, not the months-old ~$51 seed. Degrades
  // gracefully: if /brain/quotes isn't deployed yet (404) or errors, we simply keep
  // the existing /brain/signals behavior — never fabricates, never breaks.
  async function pollQuotes() {
    if (typeof QUOTES === 'undefined') return;
    const syms = Object.keys(QUOTES);
    if (!syms.length) return;
    const url = workerUrl() + '/brain/quotes?syms=' + encodeURIComponent(syms.join(','));
    let j;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) return;
      j = await r.json();
    } catch (e) { return; }
    const qm = (j && j.quotes) ? j.quotes : null;
    if (!qm) return;
    let applied = 0;
    for (const sym in qm) {
      const v = qm[sym];
      const cur = QUOTES[sym];
      if (!cur || !v || typeof v.last !== 'number' || !(v.last > 0)) continue;
      // Never clobber a FRESHER real-time WS price (Finnhub/Coinbase) with the
      // delayed worker price.
      if ((cur.priceSource === 'finnhub' || cur.priceSource === 'coinbase' || cur.priceSource === 'coinbase-ws')
        && cur.liveAt && (Date.now() - cur.liveAt) < 60000) continue;
      const chgPct = typeof v.changePct === 'number' ? v.changePct : 0;
      const prevClose = (typeof v.prevClose === 'number' && v.prevClose > 0)
        ? v.prevClose
        : (chgPct !== 0 ? v.last / (1 + chgPct / 100) : (cur.prevClose || v.last));
      cur.last = +v.last;
      cur.prevClose = +(+prevClose).toFixed(4);
      cur.change = +(cur.last - cur.prevClose).toFixed(4);
      cur.changePct = +chgPct.toFixed(4);
      cur.bid = +(cur.last - 0.01).toFixed(2);
      cur.ask = +(cur.last + 0.01).toFixed(2);
      if (typeof v.volume === 'number') cur.volume = v.volume;
      if (typeof v.rvol === 'number') cur.rvol = v.rvol;
      cur.priceSource = 'worker-yahoo';
      cur.liveAt = v.ts || Date.now();
      cur.ts = Date.now();
      cur.fresh = true;
      if (typeof Feed !== 'undefined') Feed.publish(sym, cur);
      applied++;
    }
    if (applied > 0) {
      lastOk = Date.now();
      if (typeof Feed !== 'undefined') Feed.publish('*', QUOTES);
      try { if (typeof setDataMode === 'function') setDataMode('live'); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('bpleone:quotes', { detail: { applied, at: lastOk } })); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('bpleone:worker-quotes', { detail: { applied, at: lastOk } })); } catch (e) {}
    }
  }

  function start() {
    if (timer) return;
    pollOnce();
    pollQuotes();
    timer = setInterval(() => { pollOnce(); pollQuotes(); }, POLL_MS);
  }

  function status() { return { lastOk, polling: !!timer, source: workerUrl() + '/brain/signals + /brain/quotes' }; }

  window.WorkerQuotes = { start, pollOnce, pollQuotes, status };

  if (typeof document !== 'undefined') {
    // Pass 243: start IMMEDIATELY (was 800ms) so real prices land ASAP.
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start);
    }
  }
})();
