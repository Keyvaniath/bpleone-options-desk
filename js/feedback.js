// feedback.js — a subtle floating feedback button so early users can tell you, in
// their own words, what's missing / confusing / would make them pay. That qualitative
// signal is worth more than any click count. Posts a 'feedback' event to the worker
// /track endpoint (which stores the text); shows up on analytics.html. Self-contained,
// no deps, never throws. Bottom-RIGHT so it doesn't collide with the Start Here nudge.
(function () {
  'use strict';
  // Respect the tracking opt-out, skip iframes.
  try { if (localStorage.getItem('bpleone_no_track') === '1') return; } catch (e) {}
  try { if (window.top !== window.self) return; } catch (e) {}

  function workerUrl() {
    try { if (window.WorkerBridge && WorkerBridge.getUrl && WorkerBridge.getUrl()) return WorkerBridge.getUrl(); } catch (e) {}
    return 'https://bpleone-brain-worker.brandonpleone.workers.dev';
  }
  function post(rating, text, email) {
    try {
      if (window.track) { window.track('feedback', { rating: rating, text: text, email: email }); return; }
      var anon = 'anon'; try { anon = localStorage.getItem('bpleone_anon_v1') || 'anon'; } catch (e) {}
      var body = JSON.stringify({ event: 'feedback', page: location.pathname, anon: anon, ts: Date.now(), props: { rating: rating, text: text, email: email } });
      if (navigator.sendBeacon) navigator.sendBeacon(workerUrl() + '/track', body);
      else fetch(workerUrl() + '/track', { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(function () {});
    } catch (e) {}
  }

  function injectCss() {
    if (document.getElementById('fb-css')) return;
    var css = ''
      + '#fb-btn{position:fixed;right:18px;bottom:18px;z-index:9997;display:inline-flex;align-items:center;gap:7px;'
      +   'padding:10px 15px;border-radius:999px;background:#0c1116;border:1px solid rgba(0,212,255,0.4);'
      +   'color:var(--accent,#00d4ff);font-family:var(--font-sans,system-ui,sans-serif);font-size:13px;font-weight:800;'
      +   'cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.45);}'
      + '#fb-btn:hover{background:#10161e;}'
      + '#fb-panel{position:fixed;right:18px;bottom:64px;z-index:9997;width:300px;max-width:calc(100vw - 36px);'
      +   'padding:16px 16px 14px;border-radius:14px;background:#0c1116;border:1px solid rgba(0,212,255,0.4);'
      +   'box-shadow:0 16px 44px rgba(0,0,0,0.6);font-family:var(--font-sans,system-ui,sans-serif);'
      +   'display:none;opacity:0;transform:translateY(8px);transition:opacity .18s,transform .18s;}'
      + '#fb-panel.on{display:block;opacity:1;transform:translateY(0);}'
      + '#fb-panel .h{font-size:14px;font-weight:800;color:#fff;margin-bottom:3px;}'
      + '#fb-panel .s{font-size:11.5px;color:#8b97a6;margin-bottom:11px;line-height:1.45;}'
      + '#fb-panel .rate{display:flex;gap:8px;margin-bottom:10px;}'
      + '#fb-panel .rate button{flex:1;padding:8px;border-radius:8px;background:transparent;border:1px solid var(--border,#243);color:#cdd6df;font-size:17px;cursor:pointer;}'
      + '#fb-panel .rate button.sel{border-color:var(--accent,#00d4ff);background:rgba(0,212,255,0.12);}'
      + '#fb-panel textarea,#fb-panel input{width:100%;box-sizing:border-box;background:#0a0e14;border:1px solid var(--border,#243);'
      +   'border-radius:8px;color:#fff;font-size:13px;padding:9px 11px;font-family:inherit;margin-bottom:9px;}'
      + '#fb-panel textarea{resize:vertical;min-height:62px;}'
      + '#fb-panel .send{width:100%;padding:10px;border-radius:9px;background:var(--accent,#00d4ff);color:#001018;border:none;font-weight:800;font-size:13.5px;cursor:pointer;}'
      + '#fb-panel .x{position:absolute;top:9px;right:11px;background:none;border:none;color:#7a8a99;font-size:18px;cursor:pointer;}'
      + '#fb-panel .ok{color:#6ee7b7;font-size:13px;font-weight:700;text-align:center;padding:10px 0;}';
    var s = document.createElement('style'); s.id = 'fb-css'; s.textContent = css; document.head.appendChild(s);
  }

  function build() {
    if (document.getElementById('fb-btn') || !document.body) return;
    injectCss();
    var btn = document.createElement('button');
    btn.id = 'fb-btn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Give feedback');
    btn.innerHTML = '💬 Feedback';
    document.body.appendChild(btn);

    var panel = document.createElement('div');
    panel.id = 'fb-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Feedback');
    panel.innerHTML =
        '<button class="x" id="fb-x" aria-label="Close">&times;</button>'
      + '<div class="h">Quick feedback</div>'
      + '<div class="s">Brutally honest is best. What\'s missing, confusing, or would make you actually use this?</div>'
      + '<div class="rate"><button type="button" data-r="up" id="fb-up">👍</button><button type="button" data-r="down" id="fb-down">👎</button></div>'
      + '<textarea id="fb-text" placeholder="Tell me anything — one line is fine."></textarea>'
      + '<input id="fb-email" type="email" placeholder="Email (optional — if you want a reply)" autocomplete="off">'
      + '<button class="send" id="fb-send" type="button">Send feedback</button>';
    document.body.appendChild(panel);

    var rating = '';
    function open() { panel.classList.add('on'); }
    function close() { panel.classList.remove('on'); }
    btn.addEventListener('click', function () { panel.classList.contains('on') ? close() : open(); });
    document.getElementById('fb-x').addEventListener('click', close);
    function pick(r) {
      rating = r;
      document.getElementById('fb-up').classList.toggle('sel', r === 'up');
      document.getElementById('fb-down').classList.toggle('sel', r === 'down');
    }
    document.getElementById('fb-up').addEventListener('click', function () { pick('up'); });
    document.getElementById('fb-down').addEventListener('click', function () { pick('down'); });
    document.getElementById('fb-send').addEventListener('click', function () {
      var text = (document.getElementById('fb-text').value || '').trim();
      var email = (document.getElementById('fb-email').value || '').trim();
      if (!rating && !text) { document.getElementById('fb-text').focus(); return; }
      post(rating, text.slice(0, 500), email.slice(0, 120));
      panel.innerHTML = '<button class="x" id="fb-x2" aria-label="Close">&times;</button><div class="ok">🙏 Thanks — this genuinely helps. I read every one.</div>';
      var x2 = document.getElementById('fb-x2'); if (x2) x2.addEventListener('click', close);
      setTimeout(close, 2600);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(build, 1200); });
  else setTimeout(build, 1200);
})();
