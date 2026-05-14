/* ===========================================
   BPLEONE TRADING - ONBOARDING TOUR
   ---
   First-visit walkthrough. Spotlight + tooltip on
   key features. Skippable. Remembered in
   localStorage so it doesn't re-fire.
   =========================================== */

const Onboarding = (function() {
  const KEY = 'bpleone_tour_v1';

  function shouldRun() {
    try { return !localStorage.getItem(KEY); } catch (e) { return false; }
  }
  function markDone() {
    try { localStorage.setItem(KEY, JSON.stringify({ done: 1, at: Date.now() })); } catch (e) {}
  }

  // Step definitions: { selector | locate, title, body, side }
  const STEPS = {
    landing: [
      { locate: () => document.querySelector('.hero, .page-header'),
        title: 'Welcome to the desk',
        body: 'This is bpleone / trade — an institutional-grade options + TA platform built for solo traders. Let me show you the 4 things you need to know.',
        side: 'bottom' },
      { locate: () => document.querySelector('#dataStatusPill'),
        title: 'Live data status',
        body: 'This pill shows your data feed. <strong>MOCK</strong> means built-in random walks. Click it to add a Finnhub/Polygon key and it flips to <strong>LIVE</strong>.',
        side: 'bottom' },
      { locate: () => document.querySelector('.nav-links') || document.querySelector('.navbar'),
        title: 'Navigation',
        body: 'Hover the dropdowns for Plays / Trading / Tools — 50+ pages of pro features. Or press <kbd>⌘K</kbd> (or <kbd>Ctrl+K</kbd>) anywhere to jump fast.',
        side: 'bottom' },
      { locate: () => document.body,
        title: 'Pro keyboard shortcuts',
        body: 'Press <kbd>?</kbd> any time to see the full hotkey list. <kbd>g</kbd> then a letter jumps anywhere (e.g. <kbd>g d</kbd> = dashboard). Press <kbd>/</kbd> to search.',
        side: 'top' },
      { locate: () => document.querySelector('a[href="settings.html"]') || document.body,
        title: "You're set",
        body: 'Last thing — hit <strong>Settings</strong> to wire live market data (Finnhub free works) and optionally drop in an Anthropic key to make the AI Assistant <em>real</em>. Then go make money. 💰',
        side: 'bottom' }
    ]
  };

  function pickFlow() {
    const path = window.location.pathname.split('/').pop().toLowerCase();
    if (path === '' || path === 'index.html' || path === 'dashboard.html') return STEPS.landing;
    return null;
  }

  let active = false;
  let stepIdx = 0;
  let overlay = null;
  let spotlight = null;
  let card = null;
  let currentSteps = [];

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'onboarding-overlay';
    overlay.innerHTML = `
      <div class="ob-spotlight"></div>
      <div class="ob-card" role="dialog" aria-label="Onboarding tour">
        <div class="ob-progress"></div>
        <div class="ob-title"></div>
        <div class="ob-body"></div>
        <div class="ob-controls">
          <button class="btn btn-ghost ob-skip">Skip tour</button>
          <div style="flex:1"></div>
          <button class="btn btn-ghost ob-prev">← Back</button>
          <button class="btn btn-primary ob-next">Next →</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    spotlight = overlay.querySelector('.ob-spotlight');
    card = overlay.querySelector('.ob-card');
    overlay.querySelector('.ob-skip').addEventListener('click', skip);
    overlay.querySelector('.ob-prev').addEventListener('click', prev);
    overlay.querySelector('.ob-next').addEventListener('click', next);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { skip(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { next(); }
    else if (e.key === 'ArrowLeft') { prev(); }
  }

  function start(force) {
    if (!force && !shouldRun()) return;
    const flow = pickFlow();
    if (!flow) return;
    if (!overlay) build();
    currentSteps = flow;
    stepIdx = 0;
    active = true;
    overlay.classList.add('active');
    render();
  }

  function render() {
    const s = currentSteps[stepIdx];
    if (!s) { finish(); return; }
    overlay.querySelector('.ob-title').textContent = s.title;
    overlay.querySelector('.ob-body').innerHTML = s.body;
    overlay.querySelector('.ob-progress').innerHTML =
      currentSteps.map((_, i) => `<span class="ob-dot ${i === stepIdx ? 'on' : ''}"></span>`).join('');
    const last = stepIdx === currentSteps.length - 1;
    overlay.querySelector('.ob-next').textContent = last ? "Got it →" : "Next →";
    overlay.querySelector('.ob-prev').style.visibility = stepIdx === 0 ? 'hidden' : 'visible';
    position();
  }

  function position() {
    if (!active) return;
    const s = currentSteps[stepIdx];
    if (!s) return;
    const target = (typeof s.locate === 'function' ? s.locate() : null) || document.body;
    const r = target.getBoundingClientRect();
    const pad = 8;
    spotlight.style.top = (r.top - pad) + 'px';
    spotlight.style.left = (r.left - pad) + 'px';
    spotlight.style.width = (r.width + pad * 2) + 'px';
    spotlight.style.height = (r.height + pad * 2) + 'px';
    // Card placement — preferred side
    card.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = r.bottom + 16;
      let left = r.left;
      if (s.side === 'top' || (top + ch > vh - 16)) top = Math.max(16, r.top - ch - 16);
      if (left + cw > vw - 16) left = Math.max(16, vw - cw - 16);
      if (left < 16) left = 16;
      if (top < 16) top = 16;
      card.style.top = top + 'px';
      card.style.left = left + 'px';
      card.style.visibility = 'visible';
    });
  }

  function next() {
    if (stepIdx >= currentSteps.length - 1) finish();
    else { stepIdx++; render(); }
  }
  function prev() {
    if (stepIdx > 0) { stepIdx--; render(); }
  }
  function skip() { finish(); }

  function finish() {
    active = false;
    if (overlay) overlay.classList.remove('active');
    markDone();
    if (window.Toast) Toast.show('Tour complete — press ? for shortcuts anytime', { kind: 'success' });
  }

  // Auto-start on landing/dashboard pages
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => start(false), 1200); // give nav + content time to render
  });

  return { start, skip, finish };
})();

window.Onboarding = Onboarding;
