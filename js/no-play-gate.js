/* ===========================================
   BPLEONE — NO PLAY gate for pick pages (audit 2026-11-03)
   ---
   The worker refits its live calibration daily; when the fit is uninformative (slope <= 0.2) it
   publishes NO PLAY on /brain/picks and no pick exists. Several pages (Trade of the Day, Brain Bet,
   Conviction Stack, Morning Brief) rank picks from the BROWSER model instead and never asked the
   worker, so they showed "the one trade right now" on days the authoritative gate said there was
   none. This module makes every such page show the gate first:
     - gate closed  -> "No qualifying setups today", the evidence, and the page's own output labeled
                       as the browser model's raw output (dimmed), not a pick;
     - gate open    -> a one-line note pointing to the worker's pick;
     - unreachable  -> says the gate could not be confirmed, so the output is unverified.
   Loaded directly (defer) by the pages listed in PAGES.
   =========================================== */
(function () {
  if (typeof document === 'undefined') return;
  const WORKER = (window.WorkerBridge && WorkerBridge.getUrl && WorkerBridge.getUrl()) || 'https://bpleone-brain-worker.brandonpleone.workers.dev';
  // page -> the element holding the page's own pick output (dimmed when the gate is closed); null = banner only
  const PAGES = { 'trade-of-the-day': '#content', 'brain-bet': '#bet', 'conviction-stack': null, 'morning-brief': null };
  const page = ((location.pathname.split('/').pop() || '').toLowerCase().replace(/\.html$/, '')) || 'index';
  if (!(page in PAGES)) return;
  const CK = 'bpleone_no_play_gate_v1';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function bar(kind, html) {
    const el = document.createElement('div');
    el.id = 'bp-no-play-gate';
    const tone = kind === 'closed' ? 'rgba(220,38,38,0.10);border:2px solid #ef4444;color:#fecaca'
               : kind === 'unknown' ? 'rgba(245,158,11,0.10);border:2px solid #f59e0b;color:#fde68a'
               : 'rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.5);color:#a7f3d0';
    el.style.cssText = 'margin:0 0 18px;padding:14px 18px;border-radius:12px;background:' + tone + ';font-size:13px;line-height:1.6;';
    el.innerHTML = html;
    return el;
  }
  function mount(state) {
    if (document.getElementById('bp-no-play-gate')) return;
    const host = document.querySelector('.container') || document.body;
    const header = host.querySelector('.page-header');
    let el;
    if (state.kind === 'closed') {
      const c = state.cal || {};
      el = bar('closed', '<div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:4px;">No qualifying setups today.</div>' +
        'The desk\'s live calibration, refit ' + esc(c.fitted ? new Date(c.fitted).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'daily') +
        ' on ' + esc(c.graded_calls != null ? c.graded_calls : '?') + ' graded 5-day calls, has slope ' + esc(c.slope_a != null ? (+c.slope_a).toFixed(3) : '?') +
        ' (needs > 0.2): the direction signal is uninformative, so the desk publishes <strong>no pick</strong>. ' +
        'Anything below is this browser\'s own model output, shown for transparency. It is not a pick and not advice. ' +
        '<a href="edge-scorecard.html" style="color:#fff;text-decoration:underline;">Live record</a> · <a href="system-status.html" style="color:#fff;text-decoration:underline;">System status</a>');
      const sel = PAGES[page];
      const target = sel && document.querySelector(sel);
      if (target) {
        target.style.opacity = '0.45';
        target.setAttribute('aria-label', 'Raw browser-model output, not a pick (NO PLAY today)');
        const tag = document.createElement('div');
        tag.style.cssText = 'font-size:11px;font-weight:800;letter-spacing:0.5px;color:#ef4444;text-transform:uppercase;margin:0 0 8px;';
        tag.textContent = 'Raw browser-model output · not a pick (NO PLAY today)';
        target.parentNode.insertBefore(tag, target);
      }
    } else if (state.kind === 'open') {
      el = bar('open', 'Live calibration is informative today (slope ' + esc((+state.cal.slope_a).toFixed(3)) + '). The desk\'s own graded pick is on ' +
        '<a href="pick-of-day.html" style="color:#fff;text-decoration:underline;">Pick of the Day</a>; this page ranks with the browser model, which has no proven edge over market drift.');
    } else {
      el = bar('unknown', '<strong>Could not confirm today\'s NO PLAY gate</strong> (the desk worker did not answer). Treat anything below as unverified browser-model output, not a pick.');
    }
    if (header && header.parentNode === host) host.insertBefore(el, header.nextSibling);
    else host.insertBefore(el, host.firstChild);
  }
  function decide(j) {
    if (!j || !j.ok) return { kind: 'unknown' };
    const cal = j.calibration || (j.no_play && j.no_play.calibration) || null;
    if (j.no_play || (cal && cal.informative === false)) return { kind: 'closed', cal: cal || {} };
    if (cal && cal.informative) return { kind: 'open', cal };
    return { kind: 'unknown' };
  }
  function run() {
    try {
      const c = JSON.parse(sessionStorage.getItem(CK) || 'null');
      if (c && Date.now() - c.ts < 10 * 60000) { mount(c.state); return; }
    } catch (e) {}
    fetch(WORKER + '/brain/picks', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null).then(j => {
      const state = decide(j);
      try { sessionStorage.setItem(CK, JSON.stringify({ ts: Date.now(), state })); } catch (e) {}
      mount(state);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  window.NoPlayGate = { pages: Object.keys(PAGES) };
})();
