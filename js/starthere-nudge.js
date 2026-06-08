// starthere-nudge.js — points brand-new visitors to the Start Here orientation
// exactly once. The moment it is shown, a localStorage flag is set so it never
// appears again on this device. Non-modal corner pill: it never blocks the page.
// Self-contained CSS, no dependencies. New visitors are precisely the audience
// that always fetches fresh JS, so cache staleness is a non-issue here.
(function () {
  'use strict';
  var KEY = 'bpleone_seen_starthere_v1';

  // Never on the Start Here page itself, the 404, or inside an iframe/preview.
  var path = (location.pathname || '').toLowerCase();
  if (path.indexOf('start-here') !== -1 || path.indexOf('404') !== -1) return;
  try { if (window.top !== window.self) return; } catch (e) {}

  // Already shown once? Never again.
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }

  function markSeen() { try { localStorage.setItem(KEY, JSON.stringify({ seen: 1 })); } catch (e) {} }

  function build() {
    // If a first-run tour overlay is on screen, defer to a later page load — don't
    // double up first-run UI, and don't burn the one-time flag yet.
    if (document.getElementById('onboarding-overlay')) return;
    if (document.getElementById('sh-nudge') || !document.body) return;

    var css = ''
      + '#sh-nudge{position:fixed;left:18px;bottom:18px;z-index:9998;width:300px;max-width:calc(100vw - 36px);'
      +   'padding:16px 18px;border-radius:14px;background:#0c1116;border:1px solid rgba(0,212,255,0.4);'
      +   'box-shadow:0 14px 40px rgba(0,0,0,0.6);font-family:var(--font-sans,system-ui,sans-serif);'
      +   'opacity:0;transform:translateY(10px);transition:opacity .25s,transform .25s;}'
      + '#sh-nudge.on{opacity:1;transform:translateY(0);}'
      + '#sh-nudge .sh-h{font-size:15px;font-weight:800;color:#fff;margin-bottom:6px;}'
      + '#sh-nudge .sh-b{font-size:12.5px;line-height:1.55;color:#9fb0bf;margin-bottom:13px;}'
      + '#sh-nudge #sh-go{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:9px;'
      +   'background:var(--accent,#00d4ff);color:#001018;font-size:13px;font-weight:800;text-decoration:none;}'
      + '#sh-nudge #sh-go:hover{filter:brightness(1.1);}'
      + '#sh-nudge #sh-x{position:absolute;top:8px;right:10px;background:none;border:none;color:#7a8a99;'
      +   'font-size:20px;line-height:1;cursor:pointer;padding:2px 7px;border-radius:6px;}'
      + '#sh-nudge #sh-x:hover{color:#fff;}'
      + '@media(max-width:520px){#sh-nudge{left:10px;right:10px;bottom:10px;width:auto;}}';
    var st = document.createElement('style');
    st.id = 'sh-nudge-css';
    st.textContent = css;
    document.head.appendChild(st);

    var wrap = document.createElement('div');
    wrap.id = 'sh-nudge';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'New here? Start Here orientation');
    wrap.innerHTML =
        '<button id="sh-x" aria-label="Dismiss" title="Dismiss">&times;</button>'
      + '<div class="sh-h">&#128075; New here?</div>'
      + '<div class="sh-b">Get the whole desk in 2 minutes &mdash; what\'s real, the 3 pages that matter, and every term in plain English.</div>'
      + '<a id="sh-go" href="start-here.html">Start Here &rarr;</a>';
    document.body.appendChild(wrap);

    // Showing it counts as "seen" — strictly once, no nagging across pages.
    markSeen();
    requestAnimationFrame(function () { wrap.classList.add('on'); });

    function close() {
      wrap.classList.remove('on');
      setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 250);
    }
    var x = document.getElementById('sh-x');
    if (x) x.addEventListener('click', close);
  }

  function start() { setTimeout(build, 1400); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
