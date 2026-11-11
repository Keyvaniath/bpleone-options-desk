// _test_history_sources.js — behavior tests for the browser trainers' history sources (audit 2026-11-11, pass 339).
// Loads the real js/historical-bootstrap.js, js/weekly-refresh.js and js/auto-trainer.js in a vm sandbox with a
// fake fetch and a virtual clock, and checks:
//   1. no request ever goes to Stooq (a browser can never read it: no CORS headers);
//   2. a keyless visitor trains on the Worker's real bars in ONE request (+ Coinbase for BTC/ETH), and today's
//      unfinished bar is never used;
//   3. a key that Finnhub refuses for /stock/candle costs exactly one call, then the endpoint is parked;
//   4. a key with candle access is paced >= 1.1 s a call and a 429 stops the run;
//   5. the weekly refresh respects the Worker-authoritative gate; the auto-trainer makes no call without candle access.
// Run: node _test_history_sources.js   (exits 1 on any failure)
const fs = require('fs');
const vm = require('vm');
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }

const DAY = 86400000;
// 2026-11-11 15:00 ET (20:00 UTC), a Wednesday session in progress.
const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);

// 40 weekday bars ending TODAY; the last one is an unfinished overlay (fin 0, live 1).
function workerBars(sym) {
  const out = [];
  let t = NOW - 60 * DAY, px = 100 + sym.length * 7;
  for (let k = 0; out.length < 40; k++) {
    t += DAY;
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    px = px * (1 + 0.025 * Math.sin(k * 1.7 + sym.charCodeAt(0)));
    out.push({ ts: t, o: px * 0.99, h: px * 1.02, l: px * 0.98, c: px, v: 1e6 + k, fin: 1 });
  }
  out[out.length - 1].ts = NOW - 3600000;     // today
  out[out.length - 1].fin = 0;
  out[out.length - 1].live = 1;
  out[out.length - 1].c = 999999;            // poison: training on it would be obvious
  return out;
}
function coinbaseCandles() {
  const rows = [];
  for (let k = 0; k < 120; k++) {
    const t = Math.floor((NOW - k * DAY) / 1000);
    const px = 60000 * (1 + 0.03 * Math.sin(k));
    rows.push([t, px * 0.98, px * 1.02, px * 0.99, px, 1000]);
  }
  return rows;   // newest first, like Coinbase
}
function finnhubCandles() {
  const t = [], o = [], h = [], l = [], c = [], v = [];
  for (let k = 200; k >= 1; k--) {
    const ts = Math.floor((NOW - k * DAY) / 1000);
    const px = 100 * (1 + 0.03 * Math.sin(k));
    t.push(ts); o.push(px); h.push(px * 1.01); l.push(px * 0.99); c.push(px); v.push(1000);
  }
  return { s: 'ok', t, o, h, l, c, v };
}
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

function sandbox(opts) {
  opts = opts || {};
  let now = NOW;
  const timers = [];
  const calls = [];
  const store = {};
  if (opts.key) store.bpleone_data_v1 = JSON.stringify({ provider: 'finnhub', apiKey: 'TEST-NOT-A-KEY', enabled: true });
  if (opts.bridge) store.bpleone_worker_bridge_v1 = JSON.stringify({ url: 'https://example-worker.test', enabled: true });
  if (opts.bootstrapDone) {   // a returning browser: first-visit bootstrap and this week's refresh already ran
    store.bpleone_hist_bootstrap_v2 = JSON.stringify({ completed: true, runningAt: 0 });
    store.bpleone_weekly_refresh_v1 = JSON.stringify({ lastSuccessAt: NOW, lastAttemptAt: NOW, history: [], totalRefreshes: 1, totalAttempts: 1 });
  }
  let trained = 0;
  const RealDate = Date;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Date: class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
    setTimeout: (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; },
    clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { hidden: false, addEventListener() {}, readyState: 'complete' },
    CustomEvent: class { constructor(t, d) { this.type = t; this.detail = d; } },
    ModelStore: {
      load: () => ({ predict: () => ({ prob: 0.5 }), train: (f) => { if (f.some(x => !isFinite(x))) throw new Error('bad feature'); trained++; return { loss: 0.69 }; } }),
      save: () => {},
      addTrainingRow: () => {}
    },
    Model: {},
    fetch: (url) => {
      url = String(url);
      calls.push({ url, at: now });
      if (/stooq/.test(url)) return Promise.reject(new TypeError('Failed to fetch'));
      if (/\/brain\/bars/.test(url)) {
        const syms = (url.match(/syms=([^&]*)/) || [])[1].split(',');
        const bars = {};
        syms.forEach(s => { bars[s] = workerBars(s); });
        return Promise.resolve(resp(200, { count: syms.length, days: 40, bars }));
      }
      if (/coinbase\.com\/products\/(BTC|ETH)-USD\/candles/.test(url)) return Promise.resolve(resp(200, coinbaseCandles()));
      if (/finnhub\.io\/api\/v1\/stock\/candle/.test(url)) return Promise.resolve(opts.candle ? opts.candle() : resp(403, { error: "You don't have access to this resource." }));
      return Promise.resolve(resp(404, {}));
    },
  };
  ctx.window = ctx;
  ctx.dispatchEvent = () => {};
  if (opts.bridge) ctx.WorkerBridge = { isEnabled: () => true, getUrl: () => 'https://example-worker.test' };
  vm.createContext(ctx);
  vm.runInContext(read('js/historical-bootstrap.js'), ctx);
  vm.runInContext(read('js/weekly-refresh.js'), ctx);
  vm.runInContext(read('js/auto-trainer.js'), ctx);
  async function run(ms) {
    const end = now + ms;
    for (let guard = 0; guard < 100000; guard++) {
      await new Promise(r => setImmediate(r));
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = Math.max(now, t.at);
      try { t.fn(); } catch (e) {}
    }
    now = Math.max(now, end);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  }
  // Run a promise to completion while advancing the virtual clock.
  async function settle(p, ms) {
    let done = false, val;
    p.then(v => { done = true; val = v; }, e => { done = true; val = { thrown: String(e) }; });
    for (let k = 0; k < 400 && !done; k++) await run(ms || 1000);
    return val;
  }
  return { ctx, calls, run, settle, store, trained: () => trained, clock: () => now };
}
const by = (calls, re) => calls.filter(c => re.test(c.url));
const STOOQ = /stooq/, BARS = /\/brain\/bars/, CB = /coinbase\.com/, FHC = /finnhub\.io\/api\/v1\/stock\/candle/;

(async () => {
  // 1. Keyless visitor, first visit: one Worker request + Coinbase for crypto, real rows trained, no Stooq.
  {
    const S = sandbox();
    const r = await S.settle(S.ctx.HistoricalBootstrap.run({ force: true }));
    ok(by(S.calls, STOOQ).length === 0, 'keyless: no Stooq request (got ' + by(S.calls, STOOQ).length + ')');
    ok(by(S.calls, FHC).length === 0, 'keyless: no Finnhub candle request');
    ok(by(S.calls, BARS).length === 1, 'keyless: ONE Worker bars request (got ' + by(S.calls, BARS).length + ')');
    ok(by(S.calls, CB).length === 2, 'keyless: Coinbase for BTC + ETH (got ' + by(S.calls, CB).length + ')');
    ok(r && r.symbolsFetched === 48 && r.trainingExamples > 100, 'keyless: trains on real bars (fetched ' + (r && r.symbolsFetched) + ', rows ' + (r && r.trainingExamples) + ')');
    ok(r && r.sources && r.sources['worker-bars'] === 46 && r.sources.coinbase === 2, 'keyless: sources recorded (' + JSON.stringify(r && r.sources) + ')');
    ok(S.trained() === (r && r.trainingExamples), 'keyless: every counted row reached model.train');
    const url = by(S.calls, BARS)[0] ? by(S.calls, BARS)[0].url : '';
    ok(/^https:\/\/bpleone-brain-worker\.brandonpleone\.workers\.dev\/brain\/bars\?days=40&syms=SPY,/.test(url), 'keyless: default Worker URL used');
    const spy = JSON.parse(S.store.bpleone_spy_history_v1 || '[]');
    ok(spy.length === 39 && spy.every(b => b.close < 999999), "today's unfinished bar is dropped (SPY bars " + spy.length + ')');
  }

  // 2. A free key: Finnhub refuses /stock/candle (403). Exactly one call, then parked for 7 days.
  {
    const S = sandbox({ key: true });
    const r = await S.settle(S.ctx.HistoricalBootstrap.run({ force: true }));
    ok(by(S.calls, FHC).length === 1, 'free key: one candle probe, then stop (got ' + by(S.calls, FHC).length + ')');
    ok(by(S.calls, BARS).length === 1 && r.trainingExamples > 100, 'free key: falls back to the Worker bars');
    ok(/"status":403/.test(S.store.bpleone_fh_candle_v1 || ''), 'free key: candle endpoint parked');
    await S.settle(S.ctx.HistoricalBootstrap.run({ force: true }));
    ok(by(S.calls, FHC).length === 1, 'free key: a second run makes no candle call while parked (got ' + by(S.calls, FHC).length + ')');
    ok(by(S.calls, STOOQ).length === 0, 'free key: no Stooq request');
  }

  // 3. A key with candle access: paced >= 1.1 s; the Worker is asked only for what Finnhub did not cover.
  {
    const S = sandbox({ key: true, candle: () => resp(200, finnhubCandles()) });
    const r = await S.settle(S.ctx.HistoricalBootstrap.run({ force: true }), 2000);
    const f = by(S.calls, FHC);
    ok(f.length === 48, 'paid key: one candle call per symbol (got ' + f.length + ')');
    const gaps = f.slice(1).map((c, i) => c.at - f[i].at);
    ok(gaps.length && gaps.every(g => g >= 1100), 'paid key: paced >= 1100 ms (min gap ' + Math.min(...gaps) + ')');
    ok(by(S.calls, BARS).length === 0 && by(S.calls, CB).length === 0, 'paid key: no Worker/Coinbase request when Finnhub covered all');
    ok(r.sources && r.sources['finnhub-candle'] === 48, 'paid key: sources recorded');
  }

  // 4. A 429 on the candle endpoint stops Finnhub for the run (not parked) and the Worker fills in.
  {
    let n = 0;
    const S = sandbox({ key: true, candle: () => (++n >= 3 ? resp(429, {}) : resp(200, finnhubCandles())) });
    const r = await S.settle(S.ctx.HistoricalBootstrap.run({ force: true }), 2000);
    ok(by(S.calls, FHC).length === 3, 'candle 429: stops at once (got ' + by(S.calls, FHC).length + ')');
    ok(!S.store.bpleone_fh_candle_v1, 'candle 429: not parked (a rate limit is not a refusal)');
    ok(by(S.calls, BARS).length === 1 && r.symbolsFetched === 48, 'candle 429: the Worker bars fill the rest');
  }

  // 5. Weekly refresh: Worker-authoritative gate; auto-trainer without candle access makes no call.
  {
    const S = sandbox({ bridge: true });
    const r = await S.settle(S.ctx.WeeklyRefresh.check());
    ok(r && r.ranNow === false && r.reason === 'worker-bridge-authoritative', 'weekly refresh respects the Worker-authoritative gate (' + JSON.stringify(r) + ')');
    ok(S.calls.length === 0, 'weekly refresh with the gate makes no request (got ' + S.calls.length + ')');
  }
  {
    const S = sandbox();
    await S.settle(S.ctx.AutoTrainer.runNow());
    ok(S.calls.length === 0, 'auto-trainer keyless: no request (got ' + S.calls.length + ')');
    ok(S.ctx.AutoTrainer.lastSkip && S.ctx.AutoTrainer.lastSkip.reason === 'no-history-source', 'auto-trainer records why it skipped');
  }
  {
    const S = sandbox({ key: true });   // candle refused
    await S.settle(S.ctx.AutoTrainer.runNow());
    ok(by(S.calls, FHC).length <= 1 && by(S.calls, STOOQ).length === 0, 'auto-trainer free key: at most one candle probe, no Stooq (got ' + S.calls.length + ')');
  }
  {
    const S = sandbox({ key: true, bootstrapDone: true, candle: () => resp(200, finnhubCandles()) });
    await S.settle(S.ctx.AutoTrainer.runNow(), 2000);
    const f = by(S.calls, FHC);
    const gaps = f.slice(1).map((c, i) => c.at - f[i].at);
    ok(f.length === 44 && gaps.every(g => g >= 1100), 'auto-trainer paid key: 44 paced candle calls (got ' + f.length + ', min gap ' + Math.min(...gaps) + ')');
    ok(S.trained() > 0, 'auto-trainer paid key: trains');
  }
  {
    // A fresh browser with candle access: bootstrap (8 s), weekly refresh (30 s) and auto-trainer (60 s) all fire.
    // They must take turns (one paced loop at a time), so Finnhub never sees more than ~55 calls in any minute.
    const S = sandbox({ key: true, candle: () => resp(200, finnhubCandles()) });
    await S.run(15 * 60000);
    const f = by(S.calls, FHC);
    const perMin = Math.max(...f.map(c => f.filter(d => d.at >= c.at && d.at - c.at < 60000).length));
    ok(f.length >= 48 && perMin <= 55, 'fresh paid-key browser: trainers take turns (calls ' + f.length + ', max in any minute ' + perMin + ')');
    // Interleaving would show the second loop's SPY call before the first loop's last call.
    const spyAt = f.filter(c => /symbol=SPY&/.test(c.url)).map(c => c.at);
    const ethAt = f.filter(c => /ETHUSDT/.test(c.url)).map(c => c.at);
    ok(spyAt.length < 2 || !ethAt.length || spyAt[1] > ethAt[0], 'fresh paid-key browser: the second loop starts after the first ends');
    ok(by(S.calls, STOOQ).length === 0, 'fresh paid-key browser: no Stooq request');
  }
  {
    // The auto-trainer's trigger fires when the file is lazy-loaded after DOMContentLoaded.
    const S = sandbox({ bootstrapDone: true });
    const before = S.ctx.AutoTrainer.lastSkip;
    await S.run(61000);
    ok(!before && S.ctx.AutoTrainer.lastSkip && S.ctx.AutoTrainer.lastSkip.reason === 'no-history-source', 'auto-trainer runs 60 s after a lazy load');
  }

  console.log(fails ? fails + ' history-source test(s) FAILED' : 'history sources: all tests passed');
  process.exit(fails ? 1 : 0);
})();
