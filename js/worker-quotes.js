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

  // Pass 303 (scale): CDN read-offload. A scheduled Action publishes the hot
  // read snapshots to /data/snap/*.json on the site, served by the free Fastly
  // CDN — NOT metered against the Cloudflare Workers request budget. Prefer the
  // snapshot for steady-state polling (so thousands of clients cost ~$0 and the
  // free tier scales effectively without limit), and fall back to the live worker
  // whenever the snapshot is missing, unparseable, or stale (> SNAP_MAX_AGE_MS) —
  // so nothing breaks and fresh data still flows if the publisher ever lags.
  // The data is ~15-min delayed and the snapshot refreshes ~every 15 min, so a
  // 30-min freshness gate serves current-enough data from the CDN in steady state.
  const SNAP_MAX_AGE_MS = 30 * 60 * 1000;
  async function loadSnapshot(file) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 6000);
      // coarse 5-min cache-bucket keeps it CDN-cacheable (unmetered) yet current
      const bucket = Math.floor(Date.now() / 300000);
      const r = await fetch('/data/snap/' + file + '?b=' + bucket, { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) return null;
      const j = await r.json();
      const upd = j && (j.updatedAt || (j.lastTick && j.lastTick.ts) || 0);
      if (!upd || (Date.now() - upd) > SNAP_MAX_AGE_MS) return null;  // too stale -> use worker
      return j;
    } catch (e) { return null; }
  }

  async function pollOnce() {
    if (typeof QUOTES === 'undefined') return;
    let j = await loadSnapshot('signals.json');   // pass 303: CDN-first (unmetered)
    if (!j) {                                      // snapshot missing/stale -> live worker fallback
      const url = workerUrl() + '/brain/signals';
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 9000);
        const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(to);
        if (!r.ok) return;
        j = await r.json();
      } catch (e) { return; }
    }
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
      // No real L1 quote feed - do not synthesize a fake bid/ask spread.
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
    // Batch into <=50-symbol chunks. The worker caps a single /brain/quotes
    // request, so a full-universe poll (75+ symbols) sent as ONE request
    // silently dropped the trailing symbols (the whole XLF..XLRE sector-ETF
    // complex + AVGO/MU/JPM/BAC/GS), leaving them stuck on stale SEED prices
    // site-wide. Chunking keeps every request under the cap so ALL symbols get
    // real delayed prices - and it's robust even if QUOTES grows.
    // Pass 303 (scale): CDN-first. The published snapshot carries the full
    // universe in one file, so use it when fresh (unmetered Fastly read) and skip
    // the worker entirely. Fall back to the chunked worker fetch when the snapshot
    // is missing/stale, so nothing breaks and off-universe growth stays covered.
    let qm = null;
    const snap = await loadSnapshot('quotes.json');
    if (snap && snap.quotes && Object.keys(snap.quotes).length) qm = snap.quotes;
    if (!qm) {
      const CHUNK = 50;
      const batches = [];
      for (let i = 0; i < syms.length; i += CHUNK) batches.push(syms.slice(i, i + CHUNK));
      async function fetchChunk(list) {
        const url = workerUrl() + '/brain/quotes?syms=' + encodeURIComponent(list.join(','));
        try {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 9000);
          const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
          clearTimeout(to);
          if (!r.ok) return null;
          const j = await r.json();
          return (j && j.quotes) ? j.quotes : null;
        } catch (e) { return null; }
      }
      const parts = await Promise.all(batches.map(fetchChunk));
      qm = {};
      let anyOk = false;
      for (const part of parts) { if (part) { anyOk = true; Object.assign(qm, part); } }
      if (!anyOk) return;
    }
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
      // No real L1 quote feed - do not synthesize a fake bid/ask spread.
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

  // Pass 296 (scale): the fleet of open tabs is the worker's whole load profile.
  // Two fixes so thousands of clients don't melt the free/paid Workers budget:
  // 1. VISIBILITY GATING - a hidden/background tab contributes nothing to the
  //    user but kept polling forever (background tabs dominate total request
  //    volume at scale). Skip polls while hidden; refresh immediately on return.
  // 2. JITTER - every client on a fixed timer synchronizes into request herds
  //    that all miss the worker's quote cache together. A per-client random
  //    cadence spreads the load flat.
  // Pass 302 (scale): widened 30-45s -> 55-85s. The underlying data is ~15-min
  //    delayed, so a ~70s refresh loses ZERO freshness but cuts per-client worker
  //    requests ~47%, roughly DOUBLING how many concurrent clients the free tier
  //    (100k req/day) serves before the paid plan is needed. Cost scales with
  //    attention; this makes each attention-minute ~half as expensive.
  const JITTERED_POLL_MS = 55000 + Math.floor(Math.random() * 30000);
  function pollCycle() {
    if (typeof document !== 'undefined' && document.hidden) return;  // hidden tab: skip (catch up on visibilitychange)
    pollOnce();
    pollQuotes();
  }
  function start() {
    if (timer) return;
    // Pass 305 (live-data fix): the INITIAL load must NOT be visibility-gated.
    // pollCycle() returns early when document.hidden, so a page opened in a
    // background tab (cmd/ctrl-click, a restored session, browser prerender, or
    // any moment the tab isn't foregrounded at load) NEVER fetched and sat on the
    // stale SEED prices with "MODE: MOCK / No live feed" until the user focused
    // it. That read as broken live data. Fix: the first paint ALWAYS fetches real
    // prices; only the RECURRING interval skips while hidden (that's the pass-296
    // scale win, preserved below). Cost stays bounded — one fetch per tab, and it
    // hits the unmetered CDN snapshot first, so this does not reopen the scale hole.
    pollOnce();
    pollQuotes();
    timer = setInterval(pollCycle, JITTERED_POLL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) pollCycle(); });
    }
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
