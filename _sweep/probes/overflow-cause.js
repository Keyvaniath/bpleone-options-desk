(() => {
  const W = document.documentElement.clientWidth;
  const clipAnc = el => { for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) || cs.position === 'fixed') return true; } return false; };
  const offends = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > W + 2; };
  const desc = el => { if (!el) return null; const cs = getComputedStyle(el); const cls = (typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''; return { sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls, disp: cs.display, gtc: cs.display.includes('grid') ? cs.gridTemplateColumns.slice(0, 80) : undefined, flexWrap: cs.display.includes('flex') ? cs.flexWrap : undefined, w: Math.round(el.getBoundingClientRect().width), minW: cs.minWidth, style: (el.getAttribute('style') || '').slice(0, 140) }; };
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!offends(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
    if (clipAnc(el)) continue;
    const par = el.parentElement;
    if (par && par !== document.body && offends(par) && getComputedStyle(par).position !== 'fixed') continue;
    // walk up to the first ancestor that is NOT wider than the viewport: that is the container the row overflows
    let box = par; while (box && box !== document.body && box.getBoundingClientRect().right > W + 2) box = box.parentElement;
    out.push({ el: desc(el), parent: desc(par), grand: par ? desc(par.parentElement) : null, text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40) });
    if (out.length >= 4) break;
  }
  return out;
})()
