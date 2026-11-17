/* ===========================================
   BPLEONE — CellInk (pass 352; not "Ink": Chromium already has a built-in window.Ink, the pen-ink API, so a module by that name never loaded)
   ---
   Heatmap cells get their colour from the data (correlation, return, P&L), drawn as a translucent fill over the
   card. Fixed white or grey text on them read ~1.5-2.5:1 on the pale cells of the light theme (the 11/16 whole-site
   sweep: correlation, seasonality, heatmap, day P&L and cross-asset pages). CellInk picks, per cell, whichever of dark
   or light text reads better on the colour actually drawn (the cell's fill composited over everything behind it).
     CellInk.fix(root, selector)    set the text colour of every matching element under root, once
     CellInk.watch(root, selector)  fix now, and again whenever root's content is re-rendered or the theme changes
     CellInk.inkFor({r, g, b})      '#0b1220' or '#f8fafc'
   =========================================== */
(function () {
  if (typeof window === 'undefined' || window.CellInk) return;
  const DARK = '#0b1220', LIGHT = '#f8fafc';
  const parse = c => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);

  // The colour actually drawn behind el: its own fill and every translucent ancestor fill, over the page.
  function bgOf(el) {
    const layers = [];
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;   // a gradient: leave it alone
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) {
      const t = layers[i];
      base = { r: t.r * t.a + base.r * (1 - t.a), g: t.g * t.a + base.g * (1 - t.a), b: t.b * t.a + base.b * (1 - t.a) };
    }
    return base;
  }
  function inkFor(bg) {
    const L = lum(bg);
    const onDark = (lum({ r: 248, g: 250, b: 252 }) + 0.05) / (L + 0.05);
    const onLight = (L + 0.05) / (lum({ r: 11, g: 18, b: 32 }) + 0.05);
    return onLight >= onDark ? DARK : LIGHT;
  }
  function fix(root, selector) {
    if (!root) return;
    root.querySelectorAll(selector).forEach(el => {
      if (!(el.textContent || '').trim()) return;
      const bg = bgOf(el);
      if (!bg) return;
      const ink = inkFor(bg);
      if (el.dataset.ink !== ink) { el.style.color = ink; el.dataset.ink = ink; }
    });
  }
  const watched = [];
  let themeObs = null;
  function watch(root, selector) {
    if (!root) return;
    let t = null;
    const run = () => { t = null; fix(root, selector); };
    run();
    // Re-renders replace the cells (childList); our own colour writes are attribute changes, not observed.
    new MutationObserver(() => { if (!t) t = setTimeout(run, 30); }).observe(root, { childList: true, subtree: true });
    watched.push(run);
    if (!themeObs) {
      themeObs = new MutationObserver(() => setTimeout(() => watched.forEach(f => f()), 30));
      themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    }
  }
  window.CellInk = { fix, watch, inkFor, bgOf };
})();
