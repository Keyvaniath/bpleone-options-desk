/* ===========================================
   BPLEONE TRADING - SERVICE WORKER
   ---
   App-shell cache for offline & instant loads.
   Network-first for HTML (fresh data wins),
   cache-first for assets (JS/CSS/fonts).
   =========================================== */

// Audit pass 94: bumped version so the new stale-while-revalidate strategy
// activates on existing browsers (caches with the old version get cleared).
const VERSION = 'v1.2';  // pass 174-175: CRITICAL fixes (Finnhub priceSource/liveAt + window.QUOTES TDZ) — force cache invalidation
const CACHE_SHELL = 'bpleone-shell-' + VERSION;
const CACHE_RUNTIME = 'bpleone-runtime-' + VERSION;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/css/style.css',
  '/js/app.js',
  '/js/live.js',
  '/js/learn.js',
  '/js/notify.js',
  '/js/charts.js',
  '/js/data-provider.js',
  '/js/ai-client.js',
  '/js/command-palette.js',
  '/js/hotkeys.js',
  '/js/onboarding.js',
  '/js/toast.js',
  '/manifest.json',
  '/favicon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_SHELL).then(cache => cache.addAll(SHELL_ASSETS).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_SHELL && k !== CACHE_RUNTIME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Skip cross-origin (CDN scripts, API calls)
  if (url.origin !== location.origin) return;

  // Skip Anthropic / market-data WS upgrades (handled by browser)
  if (url.protocol === 'wss:' || url.protocol === 'ws:') return;

  // HTML: network-first with cache fallback
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_RUNTIME).then(c => c.put(req, copy)).catch(() => null);
        return resp;
      }).catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Static assets (JS/CSS/SVG): stale-while-revalidate
  // Audit pass 94: was cache-first, which meant once a JS file landed in the
  // cache, bugfix deploys NEVER reached users (until VERSION bumped — manual,
  // error-prone). Now: return cached immediately for speed, AND fetch a
  // fresh copy in the background so the NEXT page-load picks up any deploy.
  // For users with a cached version, fixes land within one page-refresh
  // instead of being permanently stuck.
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE_RUNTIME).then(c => c.put(req, copy)).catch(() => null);
        }
        return resp;
      }).catch(() => null);
      // Return cached immediately if available; otherwise wait for network.
      return cached || network;
    })
  );
});

// Listen for messages from the page (e.g. clear-cache command)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  } else if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
