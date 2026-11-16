// Chart.js canvases that keep growing: a fill-parent chart (responsive, maintainAspectRatio:false) inside an
// auto-height box resizes itself taller every frame. Measured twice, 2 s apart; flags growth > 40px or > 1,200px.
(async () => {
  const read = () => [...document.querySelectorAll('canvas')].map(c => ({ c, h: c.getBoundingClientRect().height }));
  const a = read();
  await new Promise(r => setTimeout(r, 2000));
  const out = [];
  a.forEach(({ c, h }) => {
    const h2 = c.getBoundingClientRect().height;
    if (h2 > 1200 || h2 - h > 40) out.push({ id: c.id || '?', h: Math.round(h2), grew: Math.round(h2 - h), attr: c.getAttribute('height'), parent: c.parentElement.tagName.toLowerCase() + '.' + String(c.parentElement.className || '').split(' ')[0] });
  });
  return { n: out.length, canvases: a.length, sample: out.slice(0, 6) };
})()
