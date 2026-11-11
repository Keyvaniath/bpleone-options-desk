// _test_data_provider.js — behavior tests for js/data-provider.js (audit 2026-11-11).
// Loads the real module in a vm sandbox with a fake fetch/clock and checks the two fixes:
//   1. the browser Stooq poll is retired (a browser can never read Stooq: no CORS headers);
//   2. the Finnhub REST bootstrap needs a key, skips worker-priced symbols, paces under 60 calls a minute,
//      stops on a 429 and does not re-run inside the cooldown (it used to fire ~75 calls in parallel: 111 of
//      149 came back 429 in Brandon's browser).
// Run: node _test_data_provider.js   (exits 1 on any failure)
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(__dirname + '/js/data-provider.js', 'utf8');

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }

function sandbox(config, quotes, fetchImpl) {
  let now = Date.UTC(2026, 10, 11, 16, 0, 0);
  const timers = [];
  const calls = [];
  const store = { bpleone_data_v1: config ? JSON.stringify(config) : null };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
    // Timers run on a virtual clock: setTimeout schedules; tick() advances and runs what is due.
    setTimeout: (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; },
    clearTimeout: () => {}, setInterval: (fn, ms) => { calls.push({ url: 'setInterval:' + ms }); return 1; }, clearInterval: () => {},
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    document: { hidden: false, addEventListener() {}, readyState: 'complete' },
    WebSocket: class { constructor(u) { calls.push({ url: 'ws:' + u.replace(/token=[^&]*/, 'token=*') }); } send() {} close() {} },
    fetch: (url, o) => { calls.push({ url: String(url), at: now }); return Promise.resolve(fetchImpl(String(url))); },
    QUOTES: quotes,
    Feed: { publish() {} },
    CustomEvent: class { constructor(t, d) { this.type = t; this.detail = d; } },
  };
  ctx.window = ctx;
  ctx.dispatchEvent = () => {};
  vm.createContext(ctx);
  vm.runInContext(src + '\n;this.__DP = DataProvider;', ctx);
  async function run(ms) {
    const end = now + ms;
    for (let guard = 0; guard < 100000; guard++) {
      await new Promise(r => setImmediate(r));
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = Math.max(now, t.at);
      t.fn();
    }
    now = Math.max(now, end);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  }
  return { ctx, DP: ctx.__DP, calls, run, clock: () => now };
}

function universe(n, workerCovered) {
  const q = {};
  for (let i = 0; i < n; i++) {
    const s = 'S' + i;
    q[s] = i < workerCovered ? { last: 100, prevClose: 99, priceSource: 'worker-yahoo' } : { last: 50, prevClose: 49, priceSource: 'stale-seed' };
  }
  q.BTC = { last: 1, prevClose: 1, priceSource: 'stale-seed' };
  q.ETH = { last: 1, prevClose: 1, priceSource: 'stale-seed' };
  return q;
}
const quoteBody = () => ({ ok: true, status: 200, json: async () => ({ c: 101, pc: 100, o: 100, h: 102, l: 99 }), text: async () => '' });
const fin = calls => calls.filter(c => /finnhub\.io\/api\/v1\/quote/.test(c.url));
const stooq = calls => calls.filter(c => /stooq/.test(c.url));

(async () => {
  // 1. Keyless visitor: no Stooq request, no Finnhub request, and refreshAll fires nothing at Finnhub.
  {
    const S = sandbox(null, universe(40, 0), () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }));
    S.DP.init();
    await S.run(60000);
    ok(stooq(S.calls).length === 0, 'keyless: no Stooq request (got ' + stooq(S.calls).length + ')');
    ok(!S.calls.some(c => c.url === 'setInterval:12000'), 'keyless: no 12 s Stooq poll scheduled');
    await S.DP.refreshAll();
    await S.run(60000);
    ok(fin(S.calls).length === 0, 'keyless: refreshAll never calls Finnhub (got ' + fin(S.calls).length + ')');
  }

  // 2. Finnhub key, 75 symbols, 60 already priced by the worker: only the 17 uncovered (15 + BTC/ETH) are called,
  //    paced >= 1.1 s apart, after the 4 s head start.
  {
    const S = sandbox({ provider: 'finnhub', apiKey: 'TEST-NOT-A-KEY', enabled: true, subscribeAll: true }, universe(75, 60), () => quoteBody());
    S.DP.init();
    const t0 = S.clock();
    await S.run(120000);
    const f = fin(S.calls);
    ok(f.length === 17, 'key: only the 17 symbols the worker did not price are called (got ' + f.length + ')');
    ok(f.length && f[0].at - t0 >= 4000, 'key: the first call waits for the worker head start (got ' + (f.length ? f[0].at - t0 : 'none') + ' ms)');
    const gaps = f.slice(1).map((c, i) => c.at - f[i].at);
    ok(gaps.every(g => g >= 1100), 'key: calls are paced >= 1100 ms apart (min gap ' + Math.min(...gaps) + ')');
    const perMin = f.filter(c => c.at - f[0].at < 60000).length;
    ok(perMin <= 55, 'key: at most 55 calls in the first minute (got ' + perMin + ')');
    ok(stooq(S.calls).length === 0, 'key: no Stooq request');
    // Reconnect inside the cooldown: no second bootstrap.
    S.DP.connect && S.DP.connect();
    await S.run(60000);
    ok(fin(S.calls).length === 17, 'key: a reconnect inside 10 min does not re-run the bootstrap (got ' + fin(S.calls).length + ')');
  }

  // 3. A 429 stops the run at once and blocks a forced refresh for the cooldown.
  {
    let n = 0;
    const S = sandbox({ provider: 'finnhub', apiKey: 'TEST-NOT-A-KEY', enabled: true, subscribeAll: true }, universe(30, 0),
      () => (++n >= 5 ? { ok: false, status: 429, json: async () => ({}), text: async () => '' } : quoteBody()));
    S.DP.init();
    await S.run(120000);
    ok(fin(S.calls).length === 5, 'a 429 stops the bootstrap at once (got ' + fin(S.calls).length + ' calls)');
    await S.DP.refreshAll();
    await S.run(60000);
    ok(fin(S.calls).length === 5, 'after a 429, even a forced refresh waits out the cooldown (got ' + fin(S.calls).length + ')');
  }

  console.log(fails ? fails + ' data-provider test(s) FAILED' : 'data provider: all tests passed');
  process.exit(fails ? 1 : 0);
})();
