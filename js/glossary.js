// glossary.js — one shared source of plain-English definitions + an in-context
// "?" tooltip engine. Drop a chip anywhere and it becomes a hoverable / tappable
// / keyboard-focusable explainer:
//
//   <span class="gloss-q" data-term="conviction"></span>   -> a small "?" badge
//   <span data-gloss="drift-skill">drift</span>            -> underlines existing text
//
// Single source of truth so Start Here, Proof, Constraints and Today all teach the
// exact same definitions. No dependencies; injects its own CSS; safe to load anywhere.
(function () {
  'use strict';

  // The canonical definitions. Keep in sync with start-here.html's glossary.
  var DEFS = {
    'p-up':                { t: 'P(up)',                    d: "The brain's estimated probability a name rises over the next ~5 trading days. 50% is a coin flip; 65% is a meaningful lean up; 35% is a lean down." },
    'conviction':          { t: 'Conviction',               d: "How far P(up) sits from 50% — i.e. how strong the lean is. A conviction of 0.12 means P(up) is 62% (up) or 38% (down). Higher = the brain is more sure." },
    'horizon':             { t: 'Horizon',                  d: "The holding window the brain predicts over. Here it's 5 trading days (about a week) — a swing-trade horizon, not day-trading." },
    'walk-forward':        { t: 'Walk-forward accuracy',    d: "How often the brain was right when tested only on the future it never saw during training. The honest test — far harder to fake than testing on data it already studied." },
    'drift-skill':         { t: 'Drift vs Skill',           d: "Stocks tend to drift up over time, so part of being right just rides that drift (beta). Skill is accuracy above that baseline (alpha) — the only part that's a real edge. The desk separates the two." },
    'base-rate':           { t: 'Base rate',                d: "How often a name rises over the horizon regardless of any prediction — the bar any real edge has to clear." },
    'bss':                 { t: 'Brier skill (BSS)',        d: "A score for how well-calibrated the probabilities are versus random guessing. Positive = better than random; 0 = no better than a coin." },
    'calibration':         { t: 'Calibration (Platt)',      d: "A correction applied so that when the brain says \"70%,\" it really happens about 70% of the time — not 55% or 85%." },
    'confluence':          { t: 'Confluence',               d: "When two independent signals — the brain and insider buying — agree on direction. The bet is that agreement is stronger than either signal alone." },
    'champion-challenger': { t: 'Champion / Challenger',    d: "The brain always trains a rival model in the background. The challenger only takes over if it genuinely beats the current champion on unseen data — so the desk never quietly downgrades itself." },
    'significant':         { t: 'Statistically significant', d: "Unlikely to be luck. On this desk it means the edge clears a 95% confidence bar above the base rate — not merely above a coin flip. Drift alone can beat a coin flip; only real skill clears the base rate." }
  };

  function injectCss() {
    if (document.getElementById('gloss-css')) return;
    var css = ''
      + '.gloss-q{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;margin-left:5px;border-radius:50%;'
      +   'background:rgba(0,212,255,0.14);border:1px solid rgba(0,212,255,0.45);color:var(--accent,#00d4ff);'
      +   'font-size:10px;font-weight:800;font-family:var(--font-mono,monospace);line-height:1;cursor:help;vertical-align:middle;'
      +   'user-select:none;transition:background 0.12s;}'
      + '.gloss-q:hover,.gloss-q:focus{background:rgba(0,212,255,0.3);outline:none;}'
      + '[data-gloss]{border-bottom:1px dotted rgba(0,212,255,0.6);cursor:help;}'
      + '#gloss-tip{position:fixed;z-index:9999;max-width:300px;padding:11px 13px;border-radius:9px;'
      +   'background:#0c1116;border:1px solid rgba(0,212,255,0.4);box-shadow:0 8px 28px rgba(0,0,0,0.55);'
      +   'font-size:12.5px;line-height:1.55;color:#dfe6ee;pointer-events:none;opacity:0;transform:translateY(4px);'
      +   'transition:opacity 0.12s,transform 0.12s;font-family:var(--font-sans,system-ui,sans-serif);}'
      + '#gloss-tip.on{opacity:1;transform:translateY(0);}'
      + '#gloss-tip .gt{display:block;font-weight:800;color:var(--accent,#00d4ff);margin-bottom:4px;font-size:12px;'
      +   'text-transform:uppercase;letter-spacing:0.4px;}';
    var s = document.createElement('style');
    s.id = 'gloss-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  var tipEl = null;
  function tipNode() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'gloss-tip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function show(target, key) {
    var def = DEFS[key];
    if (!def) return;
    var el = tipNode();
    el.innerHTML = '<span class="gt"></span><span class="gd"></span>';
    el.querySelector('.gt').textContent = def.t;
    el.querySelector('.gd').textContent = def.d;
    el.classList.add('on');
    // Position: prefer just below the target, clamp to viewport.
    var r = target.getBoundingClientRect();
    var tw = el.offsetWidth, th = el.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8);
    var top = r.bottom + 8;
    if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 8); // flip above if no room
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
  function hide() { if (tipEl) tipEl.classList.remove('on'); }

  function attach(target, key) {
    if (!DEFS[key] || target.__gloss) return;
    target.__gloss = true;
    target.setAttribute('tabindex', '0');
    target.setAttribute('role', 'button');
    target.setAttribute('aria-label', DEFS[key].t + ': ' + DEFS[key].d);
    target.addEventListener('mouseenter', function () { show(target, key); });
    target.addEventListener('mouseleave', hide);
    target.addEventListener('focus', function () { show(target, key); });
    target.addEventListener('blur', hide);
    target.addEventListener('click', function (e) {
      e.preventDefault();
      // Tap toggles on touch devices.
      if (tipEl && tipEl.classList.contains('on')) hide(); else show(target, key);
    });
  }

  function decorate(root) {
    injectCss();
    root = root || document;
    var i, els;
    els = root.querySelectorAll('.gloss-q[data-term]');
    for (i = 0; i < els.length; i++) { if (!els[i].textContent) els[i].textContent = '?'; attach(els[i], els[i].getAttribute('data-term')); }
    els = root.querySelectorAll('[data-gloss]');
    for (i = 0; i < els.length; i++) { attach(els[i], els[i].getAttribute('data-gloss')); }
  }

  // Dismiss on scroll / resize / outside tap so the tip never gets orphaned.
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { decorate(document); });
  } else {
    decorate(document);
  }

  window.Glossary = { defs: DEFS, decorate: decorate };
})();
