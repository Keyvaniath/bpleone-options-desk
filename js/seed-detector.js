/* ===========================================
   BPLEONE — Seed Detector
   ---
   Marks every QUOTES symbol with `liveStatus`:
     'realtime' — finnhub/polygon/alpaca/tradier/coinbase WS
     'delayed'  — stooq, stooq-refresh, coinbase-rest
     'stale'    — has a source but last update > 5min (during market hours)
     'seed'     — never been touched by any live source

   "Seed" symbols are the ones we should be most worried about — they're
   showing the placeholder values from live.js initialization, which look
   real but aren't connected to a live feed. The brain will not train on
   seed prices (they don't generate ticks), but the UI may show them and
   users might think they're current.

   Exposes:
     SeedDetector.status(sym) -> 'realtime'|'delayed'|'stale'|'seed'
     SeedDetector.allStatuses() -> { sym: { status, source, ageMs, last } }
     SeedDetector.seedSymbols() -> array of seed-only symbols
     SeedDetector.summary() -> { realtime, delayed, stale, seed, total }

   Plus an auto-applied DOM patch: walks all elements with
   `data-live="SYM:field"` and adds a class `.seed-warn` if the symbol
   is in seed state, so CSS can dim the price display.
   =========================================== */

(function () {
  const REALTIME = /finnhub|polygon|alpaca|tradier/i;
  const REALTIME_CRYPTO = /^coinbase$|^coinbase-ws$/i;
  const DELAYED = /stooq|coinbase-rest|coinbase-refresh|stale-refresh/i;

  function classify(src) {
    if (!src) return 'none';
    const s = String(src);
    if (REALTIME.test(s)) return 'realtime';
    if (REALTIME_CRYPTO.test(s)) return 'realtime';
    if (DELAYED.test(s)) return 'delayed';
    return 'unknown';
  }

  function isMarketOpen() {
    if (typeof window === 'undefined') return false;
    if (typeof window.detectSession === 'function') return window.detectSession() === 'open';
    const d = new Date();
    const day = d.getDay();
    if (day === 0 || day === 6) return false;
    const h = d.getUTCHours();
    return h >= 13 && h <= 21;
  }

  function status(sym) {
    if (typeof window === 'undefined' || !window.QUOTES || !window.QUOTES[sym]) return 'unknown';
    const q = window.QUOTES[sym];
    const src = q.priceSource || q.source;
    if (!src) return 'seed';
    const cls = classify(src);
    const ageMs = q.liveAt ? Date.now() - q.liveAt : Infinity;
    if (cls === 'realtime') return ageMs > 5 * 60 * 1000 && isMarketOpen() ? 'stale' : 'realtime';
    if (cls === 'delayed') return ageMs > 5 * 60 * 1000 && isMarketOpen() ? 'stale' : 'delayed';
    return 'delayed';
  }

  function allStatuses() {
    if (typeof window === 'undefined' || !window.QUOTES) return {};
    const out = {};
    for (const sym in window.QUOTES) {
      const q = window.QUOTES[sym];
      out[sym] = {
        status: status(sym),
        source: q.priceSource || q.source || null,
        ageMs: q.liveAt ? Date.now() - q.liveAt : null,
        last: q.last
      };
    }
    return out;
  }

  function seedSymbols() {
    const s = allStatuses();
    return Object.keys(s).filter(k => s[k].status === 'seed').sort();
  }

  function summary() {
    const s = allStatuses();
    const counts = { realtime: 0, delayed: 0, stale: 0, seed: 0, total: 0 };
    for (const sym in s) {
      counts.total++;
      counts[s[sym].status] = (counts[s[sym].status] || 0) + 1;
    }
    return counts;
  }

  // Auto-apply visual dim to seed-state data-live elements
  function decorate() {
    if (typeof document === 'undefined') return;
    const els = document.querySelectorAll('[data-live]');
    els.forEach(el => {
      const binding = el.getAttribute('data-live') || '';
      const sym = binding.split(':')[0];
      if (!sym) return;
      const st = status(sym);
      el.classList.remove('seed-warn', 'stale-warn');
      if (st === 'seed') el.classList.add('seed-warn');
      else if (st === 'stale') el.classList.add('stale-warn');
      // Set title for hover detail
      const src = window.QUOTES && window.QUOTES[sym] && (window.QUOTES[sym].priceSource || window.QUOTES[sym].source);
      el.title = sym + ' · ' + (src || 'NO LIVE SOURCE') + ' · ' + st.toUpperCase();
    });
  }

  // Inject CSS once
  function injectCss() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('seed-detector-css')) return;
    const style = document.createElement('style');
    style.id = 'seed-detector-css';
    style.textContent = [
      '[data-live].seed-warn { opacity: 0.55; text-decoration: line-through dotted rgba(220,38,38,0.6); }',
      '[data-live].seed-warn::after { content: " ⚠"; color: var(--red); font-size: 0.8em; }',
      '[data-live].stale-warn { color: var(--yellow) !important; }',
      '[data-live].stale-warn::after { content: " stale"; color: var(--yellow); font-size: 0.7em; opacity: 0.7; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function autoStart() {
    if (typeof window === 'undefined') return;
    if (window._seedDetectorTimer) return;
    injectCss();
    // First decorate after live.js has had a chance to fetch
    setTimeout(decorate, 3000);
    window._seedDetectorTimer = setInterval(decorate, 10000);
  }

  window.SeedDetector = { status, allStatuses, seedSymbols, summary, classify, decorate };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') autoStart();
    else document.addEventListener('DOMContentLoaded', autoStart);
  }
})();
