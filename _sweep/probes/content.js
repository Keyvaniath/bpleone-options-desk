(() => {
  const bad = /\bundefined\b|\bNaN\b|\[object Object\]|-?\bInfinity\b|\bnull%|Loading…|Loading\.\.\.|Pulling…|Fetching…/;
  const hits = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.nodeValue;
    if (!t || !bad.test(t)) continue;
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE)$/.test(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // skip explanatory prose that mentions these words on purpose (long sentences)
    const txt = t.trim().replace(/\s+/g, ' ');
    if (txt.length > 160) continue;
    let p = el, path = [];
    for (let i = 0; i < 3 && p && p !== document.body; i++, p = p.parentElement) path.unshift(p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + ((typeof p.className === 'string' && p.className.trim()) ? '.' + p.className.trim().split(/\s+/)[0] : ''));
    hits.push({ text: txt.slice(0, 90), at: path.join('>') });
    if (hits.length >= 8) break;
  }
  return { n: hits.length, sample: hits };
})()
