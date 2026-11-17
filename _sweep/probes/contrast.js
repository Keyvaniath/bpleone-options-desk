(() => {
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const blend = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const cache = new Map();
  function bgOf(el) {
    if (cache.has(el)) return cache.get(el);
    const layers = [];
    let unknown = false;
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') { unknown = true; break; }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = null;
    if (!unknown) { let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base); out = base; }
    cache.set(el, out);
    return out;
  }
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const hits = new Map();
  let checked = 0, low = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (t.length < 2 || !/[\p{L}\p{N}]/u.test(t)) continue;   // emoji and symbols draw in their own colours
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const bg = bgOf(el); if (!bg) continue;
    const fg0 = parse(cs.color); if (!fg0) continue;
    const fg = blend(fg0, bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    checked++;
    if (ratio < 3) {
      low++;
      const key = hex(fg) + ' on ' + hex(bg);
      const h = hits.get(key) || { key, ratio: +ratio.toFixed(2), count: 0, text: t.slice(0, 40), el: el.tagName.toLowerCase() + ((typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\s+/)[0] : '') };
      h.count++; hits.set(key, h);
    }
  }
  const list = [...hits.values()].sort((a, b) => b.count - a.count);
  return { n: low, checked, combos: list.length, sample: list.slice(0, 6) };
})()
