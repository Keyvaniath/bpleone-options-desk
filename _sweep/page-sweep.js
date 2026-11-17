// _sweep/page-sweep.js (pass 348-349): load every page in headless Edge and MEASURE it. Local html/css/js are
// served on the production origin through CDP Fetch interception, so the page meets the real Worker and data
// exactly as visitors do; analytics (/track) is blocked. Never run sweeps in a person's own browser.
//
// Usage: node _sweep/page-sweep.js <repoDir> <out.json> [page ...]     (no pages = every root *.html)
// Env:   VW=390|1280 (viewport width, default 390)  TABS=4  SETTLE=4000 (ms after load)  THEME=dark|light
//        PROBE=_sweep/probes/<x>.js  run that probe instead of the default overflow check:
//          content.js         visible undefined / NaN / [object Object] / Infinity / stuck "Loading"
//          contrast.js        text under 3:1 against its composited background
//          runaway-canvas.js  Chart.js canvases taller than 1,200px (fill-parent chart in an auto-height box)
//          overflow-cause.js  the parent grid/flex behind each clipped element
//        PERF=1     Worker calls per path, 429s, long tasks, heap      PROFILE=1  top functions by CPU self time
//        SHOT=<dir> screenshot (SHOT_SEL=<css> captures just that element; SHOT_FULL=1 the whole page, up to 6,000px)
//        PRE=<file> script run before both   LIVE=1 load the PRODUCTION site (no local files; /track still blocked)
//        DESKTOP=1 a desktop browser (no mobile emulation, scale 1, desktop user agent) instead of a phone
// Default check: elements whose right edge passes the viewport and that no scroll/clip ancestor contains
// (body overflow-x:hidden hides this bug class: nothing scrolls, the content is just cut off).
// Baseline 11/16/26: 0 clipped at 390px and 1,280px, 0 uncaught errors, on all 427 pages.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const REPO = process.argv[2], OUT = process.argv[3], ONLY = process.argv.slice(4);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333 + Math.floor(Math.random() * 300);
const EDGE_DIR = path.resolve(path.dirname(OUT), 'edge-prof-' + PORT);
const ORIGIN = 'https://options.bpleone.com';
const TABS = +(process.env.TABS || 4), SETTLE_MS = +(process.env.SETTLE || 4000), LOAD_TIMEOUT = 15000;

const CHECK = process.env.PROBE ? fs.readFileSync(process.env.PROBE, "utf8") : `(() => {
  const W = document.documentElement.clientWidth;
  const clipAnc = el => { for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) || cs.position === 'fixed') return true; } return false; };
  const offends = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > W + 2; };
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!offends(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
    if (clipAnc(el)) continue;
    const par = el.parentElement;
    if (par && par !== document.body && offends(par) && getComputedStyle(par).position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    const cls = (typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    out.push({ sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls, left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), style: (el.getAttribute('style') || '').slice(0, 90), text: (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 50) });
  }
  return { W, n: out.length, sample: out.slice(0, 8) };
})()`;

const CT = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const pages = ONLY.length ? ONLY : fs.readdirSync(REPO).filter(f => f.endsWith('.html') && !f.startsWith('_')).map(f => f.slice(0, -5)).sort();
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + EDGE_DIR, '--no-first-run', '--disable-extensions', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] }); edge.stderr.on('data', d => { if (process.env.EDGE_DEBUG) process.stderr.write(d); });
  let ver;
  for (let i = 0; i < 60 && !ver; i++) { try { ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); } catch (e) { await sleep(500); } }
  if (!ver) throw new Error('edge did not start');
  const results = {};
  let next = 0;
  async function worker(k) {
    const t = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pend = new Map(); const listeners = [];
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } else if (m.method) listeners.forEach(f => f(m)); };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    let errs = [], loaded = false, reqs = {}, s429 = 0;
    listeners.push(async m => {
      if (m.method === 'Fetch.requestPaused') {
        const u = new URL(m.params.request.url);
        try {
          if (/\/track$/.test(u.pathname)) return await send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' });
          if (u.origin === ORIGIN && !process.env.LIVE) {
            let p = decodeURIComponent(u.pathname); if (p === '/' ) p = '/index.html';
            const ext = path.extname(p); const f = path.join(REPO, p);
            if (CT[ext] && fs.existsSync(f)) return await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: CT[ext] }, { name: 'Cache-Control', value: 'no-store' }], body: fs.readFileSync(f).toString('base64') });
          }
          await send('Fetch.continueRequest', { requestId: m.params.requestId });
        } catch (e) {}
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails; errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 160));
      } else if (m.method === 'Network.requestWillBeSent') {
        try { const u = new URL(m.params.request.url); const k = /workers\.dev$/.test(u.hostname) ? 'W' + u.pathname : u.hostname; reqs[k] = (reqs[k] || 0) + 1; } catch (e) {}
      } else if (m.method === 'Network.responseReceived') {
        if (m.params.response && m.params.response.status === 429) s429++;
      } else if (m.method === 'Page.loadEventFired') loaded = true;
      else if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
    });
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    if (process.env.THEME) await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('bpleone_theme_v1','" + process.env.THEME + "')}catch(e){}" });
    if (process.env.PERF) await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__lt=[];try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){window.__lt.push(Math.round(e.duration))})}).observe({type:'longtask',buffered:true})}catch(e){}" });
    await send('Fetch.enable', { patterns: [{ urlPattern: ORIGIN + '/*', requestStage: 'Request' }, { urlPattern: '*/track', requestStage: 'Request' }] });
    const DESK = !!process.env.DESKTOP;
    await send('Emulation.setDeviceMetricsOverride', { width: +(process.env.VW || 390), height: DESK ? 900 : 844, deviceScaleFactor: DESK ? 1 : 2, mobile: !DESK });
    await send('Emulation.setUserAgentOverride', { userAgent: DESK ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    while (next < pages.length) {
      const pg = pages[next++]; errs = []; loaded = false; reqs = {}; s429 = 0;
      try {
        if (process.env.PROFILE) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 }); await send('Profiler.start'); }
        await send('Page.navigate', { url: ORIGIN + '/' + pg + '.html' });
        const t0 = Date.now(); while (!loaded && Date.now() - t0 < LOAD_TIMEOUT) await sleep(150);
        await sleep(SETTLE_MS);
        // PRE=<file>: run this script after the settle and before the screenshot and probe (e.g. render a card with a
        // field the deployed Worker does not serve yet, to preview it). Never use it to make a check pass.
        if (process.env.PRE) { await send('Runtime.evaluate', { expression: fs.readFileSync(process.env.PRE, 'utf8'), awaitPromise: true }); await sleep(500); }
        if (process.env.SHOT && process.env.SHOT_SEL) {
          const rr = await send('Runtime.evaluate', { expression: 'JSON.stringify((function(){var e=document.querySelector(' + JSON.stringify(process.env.SHOT_SEL) + '); if(!e) return null; var b=e.getBoundingClientRect(); return {x:b.left+scrollX, y:b.top+scrollY, w:b.width, h:b.height};})())', returnByValue: true });
          const b = JSON.parse(rr.result.value || 'null');
          if (b) { const sh = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: 1 } }); fs.writeFileSync(path.join(process.env.SHOT, pg + '-' + (process.env.VW || 390) + '-el.png'), Buffer.from(sh.data, 'base64')); }
        }
        if (process.env.SHOT && process.env.SHOT_FULL) {
          const lm = await send('Page.getLayoutMetrics');
          const cs = lm.cssContentSize || lm.contentSize;
          const sh = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: cs.width, height: Math.min(cs.height, 6000), scale: 1 } });
          fs.writeFileSync(path.join(process.env.SHOT, pg + '-' + (process.env.VW || 390) + '-full.png'), Buffer.from(sh.data, 'base64'));
        } else if (process.env.SHOT) { const sh = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(process.env.SHOT, pg + '-' + (process.env.VW || 390) + '.png'), Buffer.from(sh.data, 'base64')); }
        const r = await Promise.race([send('Runtime.evaluate', { expression: CHECK, returnByValue: true, awaitPromise: true }), sleep(10000).then(() => ({ timeout: true }))]);
        const v = r.result ? r.result.value : null;
        if (process.env.PROFILE) {
          const { profile } = await send('Profiler.stop');
          const self = {}, byId = {};
          profile.nodes.forEach(n => { byId[n.id] = n; });
          const dt = {}; (profile.samples || []).forEach((id, i) => { dt[id] = (dt[id] || 0) + ((profile.timeDeltas || [])[i] || 0); });
          for (const n of profile.nodes) { const cf = n.callFrame; const k = (cf.functionName || '(anon)') + ' ' + (cf.url || '').split('/').pop().split('?')[0] + ':' + (cf.lineNumber + 1); self[k] = (self[k] || 0) + (dt[n.id] || 0) / 1000; }
          results[pg] = Object.entries(self).filter(([k]) => !/^\((idle|program|garbage collector|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ' ' + Math.round(v) + 'ms');
          results[pg].unshift('total ' + Math.round(Object.entries(self).filter(([k]) => !/^\((idle|program|root)\)/.test(k)).reduce((a, [, v]) => a + v, 0)) + 'ms');
          continue;
        }
        if (process.env.PERF) {
          const lt = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__lt||[])', returnByValue: true }).then(x => JSON.parse(x.result.value)).catch(() => []);
          const heap = await send('Runtime.getHeapUsage').catch(() => ({}));
          const wk = Object.entries(reqs).filter(([k]) => k[0] === 'W' && k[1] === '/');
          results[pg] = { worker: wk.reduce((a, [, c]) => a + c, 0), workerPaths: Object.fromEntries(wk.sort((a, b) => b[1] - a[1]).slice(0, 6)), total: Object.values(reqs).reduce((a, c) => a + c, 0), s429, ltN: lt.length, ltMax: lt.length ? Math.max(...lt) : 0, ltSum: lt.reduce((a, c) => a + c, 0), heapMB: heap.usedSize ? Math.round(heap.usedSize / 1e6) : null, errors: errs.slice(0, 3) };
          if (Object.keys(results).length % 25 === 0) { fs.writeFileSync(OUT, JSON.stringify(results, null, 1)); console.log('progress', Object.keys(results).length, '/', pages.length); }
          continue;
        }
        results[pg] = process.env.PROBE ? v : Object.assign({ loaded, errors: errs.slice(0, 5) }, v || { n: -1, note: r.timeout ? 'eval timeout' : 'no value' });
      } catch (e) { results[pg] = { n: -1, note: String(e.message || e).slice(0, 120), errors: errs.slice(0, 5) }; }
      if (Object.keys(results).length % 25 === 0) { fs.writeFileSync(OUT, JSON.stringify(results, null, 1)); console.log('progress', Object.keys(results).length, '/', pages.length); }
    }
    ws.close();
  }
  await Promise.all(Array.from({ length: Math.min(TABS, pages.length) }, (_, k) => worker(k)));
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const flagged = Object.entries(results).filter(([, v]) => v.n !== 0);
  console.log('done', Object.keys(results).length, 'pages; flagged', flagged.length);
  for (const [p, v] of flagged) console.log(p, v.n, v.note || '', (v.sample || []).slice(0, 2).map(s => s.sel + '@' + s.right).join(' | '));
  const errPages = Object.entries(results).filter(([, v]) => v.errors && v.errors.length);
  console.log('pages with uncaught errors:', errPages.length);
  for (const [p, v] of errPages) console.log('  ERR', p, v.errors[0]);
  edge.kill();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
