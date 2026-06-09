// analytics.js — privacy-light, first-party usage analytics so Brandon can learn
// what early users actually do. No third party, no cookies, no PII: just a random
// local id + the page path + event name, beaconed to the worker's /track endpoint.
// Fails silently if the worker is unreachable (or the /track route isn't deployed
// yet) so it can never break a page.
(function () {
  'use strict';
  var KEY = 'bpleone_anon_v1';
  var WAS_NEW = false;

  function workerUrl() {
    try { if (window.WorkerBridge && WorkerBridge.getUrl && WorkerBridge.getUrl()) return WorkerBridge.getUrl(); } catch (e) {}
    return 'https://bpleone-brain-worker.brandonpleone.workers.dev';
  }
  function anonId() {
    try {
      var v = localStorage.getItem(KEY);
      if (!v) { v = 'a' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36); localStorage.setItem(KEY, v); WAS_NEW = true; }
      return v;
    } catch (e) { return 'anon'; }
  }
  function refHost() {
    try { return document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) { return ''; }
  }

  function send(event, props) {
    try {
      var id = anonId();
      var payload = {
        event: event || 'pageview',
        page: (location.pathname || '/').replace(/\/index\.html$/, '/'),
        ref: refHost(),
        anon: id,
        nu: WAS_NEW ? 1 : 0,
        ts: Date.now(),
        props: props || {}
      };
      WAS_NEW = false; // only the first beacon for a brand-new id counts as a new user
      var url = workerUrl() + '/track';
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        try { navigator.sendBeacon(url, body); return; } catch (e) {}
      }
      fetch(url, { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(function () {});
    } catch (e) { /* analytics must never throw */ }
  }

  window.track = send;
  // Honor an explicit opt-out flag if the user ever sets one.
  var off = false;
  try { off = localStorage.getItem('bpleone_no_track') === '1'; } catch (e) {}
  if (!off) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { send('pageview'); });
    else send('pageview');
    // Auto-track the clicks that pageviews DON'T already capture: outbound links
    // (leaving the site) and any element tagged with data-ev. Internal navigation
    // is intentionally NOT tracked here — the destination's own pageview covers it,
    // so we avoid double-counting and needless writes.
    document.addEventListener('click', function (e) {
      try {
        var el = e.target && e.target.closest && e.target.closest('a,button');
        if (!el) return;
        var explicit = el.getAttribute('data-ev');
        var txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
        if (el.tagName === 'A' && el.getAttribute('href')) {
          var href = el.getAttribute('href');
          var external = /^https?:\/\//.test(href) && href.indexOf(location.hostname) === -1;
          if (external) {
            var host = ''; try { host = new URL(href).hostname.replace(/^www\./, ''); } catch (_) {}
            send(explicit || ('out:' + host), { to: href.slice(0, 80), txt: txt });
          } else if (explicit) {
            send(explicit, { to: href.slice(0, 80), txt: txt });
          }
        } else if (explicit) {
          send(explicit, { txt: txt });
        }
      } catch (e2) {}
    }, true);
  }
})();
