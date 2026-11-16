// _test_history_batch.js — worker pass-331: /brain/history?syms= runs end to end through the real handler.
// Copies worker/src to a temp dir as ES modules, stubs Yahoo (fetch), KV and the edge cache, then calls the Worker's
// own fetch(). Checks: one batch answers many names, cold fetches are capped per request and the rest are deferred,
// only UNIVERSE names are written to KV, only a complete batch is edge-cached, and ?sym= still behaves as before
// (404 on a miss). Also loads js/daily-history.js against the same handler to check the client batches and falls
// back to ?sym= when the Worker has no batch route.
// Run: node _test_history_batch.js   (exits 1 on any failure)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-hist-'));
  const src = path.join(__dirname, 'worker', 'src');
  for (const f of fs.readdirSync(src)) if (f.endsWith('.js')) fs.copyFileSync(path.join(src, f), path.join(tmp, f));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');

  // --- stubs ---
  const yahooCalls = [];
  const DAY = 86400000, T0 = Date.UTC(2025, 10, 17, 21);
  globalThis.fetch = async (u) => {
    const url = String(u);
    const m = /\/v8\/finance\/chart\/([^?]+)\?range=1y&interval=1d/.exec(url);
    if (!m) return new Response('{}', { status: 404 });
    const sym = decodeURIComponent(m[1]);
    yahooCalls.push(sym);
    if (sym === 'NOPE') return new Response(JSON.stringify({ chart: { result: null } }), { status: 200 });
    const ts = [], close = [];
    for (let i = 0; i < 250; i++) { ts.push(Math.floor((T0 + i * DAY) / 1000)); close.push(100 + i * 0.1); }
    return new Response(JSON.stringify({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ close, open: close, high: close, low: close, volume: close }] } }] } }), { status: 200 });
  };
  const edge = new Map();
  globalThis.caches = { default: {
    match: async (req) => { const r = edge.get(req.url); return r ? r.clone() : undefined; },
    put: async (req, resp) => { edge.set(req.url, resp); }
  } };
  const kv = new Map(), kvPuts = [];
  const env = { BRAIN_KV: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    put: async (k, v) => { kv.set(k, v); kvPuts.push(k); },
    delete: async (k) => { kv.delete(k); },
    list: async () => ({ keys: [] })
  } };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };

  const W = (await import(pathToFileURL(path.join(tmp, 'index.js')).href)).default;
  const call = async (q, ip) => {
    const r = await W.fetch(new Request('https://w.test/brain/history' + q, { headers: { 'CF-Connecting-IP': ip || '1.2.3.4' } }), env, ctx);
    await Promise.all(waits.splice(0));
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, cc: r.headers.get('Cache-Control'), j };
  };

  // 20 universe names + 1 off-list (ZZZQ) + 1 unknown: first request fetches at most 12 cold names
  const names = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'META', 'AMZN', 'GOOGL', 'XLK', 'XLE', 'XLF', 'SMH', 'TLT', 'GLD', 'MU', 'AVGO', 'NFLX'];
  const q = '?syms=' + names.concat(['ZZZQ', 'NOPE']).join(',');
  const r1 = await call(q);
  ok(r1.status === 200 && r1.j && r1.j.histories, 'batch answers 200 with histories');
  ok(yahooCalls.length === 12, 'first batch fetched 12 cold names from Yahoo (got ' + yahooCalls.length + ')');
  ok(r1.j.deferred.length === 10 && r1.j.n + r1.j.missing.length === 12, 'the other 10 are deferred; the 12 fetched are served or missing');
  ok(r1.cc === 'public, max-age=60' && edge.size === 0, 'an incomplete batch is not edge-cached and says max-age 60');
  ok(r1.j.histories[Object.keys(r1.j.histories)[0]].closes.length === 250, 'each history carries its closes');

  const r2 = await call(q);
  const r3 = await call(q);
  ok(r3.j.deferred.length === 0, 'after three requests nothing is deferred');
  ok(r3.j.missing.length === 1 && r3.j.missing[0] === 'NOPE', 'an unknown symbol is listed as missing');
  ok(r3.j.n === 21 && r3.j.histories.ZZZQ, 'off-list ZZZQ is served');
  ok(!kvPuts.includes('hist_v1:ZZZQ') && !kvPuts.includes('hist_v1:NOPE') && kvPuts.includes('hist_v1:SPY'), 'only UNIVERSE names are written to KV');
  ok(r3.cc === 'public, max-age=600' && edge.size === 1, 'a complete batch with a miss is edge-cached (short max-age)');
  const before = yahooCalls.length;
  const r4 = await call(q);
  ok(yahooCalls.length === before && r4.j.n === 21, 'the cached batch is served with no new Yahoo calls');
  const r4b = await call('?syms=' + names.concat(['NOPE', 'ZZZQ']).reverse().join(','));
  ok(yahooCalls.length === before && r4b.j.n === 21, 'the same names in another order hit the same cache entry');

  // bad input
  const r5 = await call('?syms=,,%3C%3E,123,');
  ok(r5.status === 400, 'a batch with no valid symbol is a 400');
  const big = []; for (let i = 0; i < 60; i++) big.push('A' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)));
  const r6 = await call('?syms=' + big.join(','), '5.6.7.8');
  ok(r6.j && (r6.j.n + r6.j.deferred.length + r6.j.missing.length) === 40, 'a batch is capped at 40 names');

  // single route unchanged
  const s1 = await call('?sym=NOPE', '9.9.9.9');
  ok(s1.status === 404 && /no history/.test(s1.j.error), '?sym= miss is still a 404');
  const s2 = await call('?sym=SPY', '9.9.9.9');
  ok(s2.status === 200 && s2.j.sym === 'SPY' && s2.j.closes.length === 250 && s2.cc === 'public, max-age=3600', '?sym= hit unchanged');

  // --- client: js/daily-history.js against this handler ---
  const sess = new Map();
  const clientFetches = [];
  const mkWindow = (handler) => {
    const win = { WorkerBridge: { getUrl: () => 'https://w.test' } };
    const sandboxFetch = async (u) => { clientFetches.push(String(u)); return handler(String(u)); };
    const sessionStorage = { getItem: k => (sess.has(k) ? sess.get(k) : null), setItem: (k, v) => sess.set(k, v) };
    const code = fs.readFileSync(path.join(__dirname, 'js', 'daily-history.js'), 'utf8');
    new Function('window', 'fetch', 'sessionStorage', 'WorkerBridge', code)(win, sandboxFetch, sessionStorage, win.WorkerBridge);
    return win.DailyHistory;
  };
  const viaWorker = async (u) => {
    const q2 = u.replace('https://w.test/brain/history', '');
    const r = await W.fetch(new Request('https://w.test/brain/history' + q2, { headers: { 'CF-Connecting-IP': '7.7.7.' + (clientFetches.length % 250) } }), env, ctx);
    await Promise.all(waits.splice(0));
    return r;
  };
  edge.clear();
  const DH = mkWindow(viaWorker);
  const set = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'EWT'];
  const got = await Promise.all(set.map(s => DH.closes(s)));
  ok(got.every(g => Array.isArray(g) && g.length > 200 && g[0].d && g[0].c > 0), 'client: every name resolves to a dated close series');
  ok(clientFetches.length === 1 && /syms=/.test(clientFetches[0]), 'client: six closes() calls made ONE batched request (got ' + clientFetches.length + ')');
  const again = await DH.closes('SPY');
  ok(clientFetches.length === 1 && again === got[0], 'client: a repeat is served from memory');

  // older Worker: ignores syms and answers with SPY's single history -> client falls back to ?sym=
  clientFetches.length = 0; sess.clear();
  const oldWorker = async (u) => {
    const m = /[?&]sym=([^&]+)/.exec(u);
    const sym = m ? decodeURIComponent(m[1]) : 'SPY';
    const closes = []; for (let i = 0; i < 30; i++) closes.push({ t: T0 + i * DAY, c: 50 + i });
    return new Response(JSON.stringify({ ok: true, sym, n: closes.length, closes }), { status: 200 });
  };
  const DH2 = mkWindow(oldWorker);
  const g2 = await Promise.all(['AAPL', 'MSFT', 'NVDA'].map(s => DH2.closes(s)));
  ok(g2.every(g => Array.isArray(g) && g.length === 30), 'client on an older Worker: still gets every series');
  ok(clientFetches.length === 4 && clientFetches.filter(u => /[?&]sym=/.test(u)).length === 3, 'client on an older Worker: one failed batch, then one ?sym= per name');

  fs.rmSync(tmp, { recursive: true, force: true });
  if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
  console.log('history batch: all checks pass');
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
