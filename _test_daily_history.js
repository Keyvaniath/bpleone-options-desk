// _test_daily_history.js — pass 345: js/daily-history.js (real daily closes from the Worker, aligned BY DATE).
// cross-asset-correlations and pair-trades read Finnhub's paid candles (empty for keyless and free-key visitors) and
// paired series by array position; pair-trades correlated price LEVELS. news-reactions labeled "move to the current
// price" as its 1h/1d reactions. Run: node _test_daily_history.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('FAIL: ' + m); } }

const day = 864e5, t0 = Date.parse('2026-11-02T21:00:00Z');   // 4 PM ET closes
const store = {};
const ctx = {
  window: {}, console, Intl, Date, Math, JSON, Map, Set, Promise, encodeURIComponent,
  sessionStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
  fetch: async url => {
    const sym = decodeURIComponent(url.split('sym=')[1]);
    // AAA trades every day (crypto-like), BBB skips the weekend 11/7-11/8
    const n = 20, closes = [];
    for (let i = 0; i < n; i++) {
      const t = t0 + i * day;
      const dow = new Date(t).getUTCDay();
      if (sym === 'BBB' && (dow === 0 || dow === 6)) continue;
      closes.push({ t, c: 100 + i * (sym === 'AAA' ? 1 : 2) });
    }
    return { ok: true, json: async () => ({ ok: true, closes }) };
  }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'daily-history.js'), 'utf8'), ctx);
const DH = ctx.DailyHistory;

(async () => {
  ok(DH && typeof DH.closes === 'function' && typeof DH.align === 'function', 'module exports closes / align / returns / pearson');
  const a = await DH.closes('AAA'), b = await DH.closes('BBB');
  ok(a.length === 20 && b.length < 20 && /^\d{4}-\d{2}-\d{2}$/.test(a[0].d), 'closes keyed by ET date (BBB skips weekends)');
  ok(a[0].d === '2026-11-02', 'a 4 PM ET close lands on its own ET date');
  const al = DH.align(a, b);
  ok(al.dates.length === b.length && al.dates.every(d => b.some(p => p.d === d)), 'align keeps only the common dates');
  const i = al.dates.indexOf('2026-11-09');
  ok(i > 0 && al.a[i] === 107 && al.b[i] === 114, 'aligned values belong to the same date (not the same array position)');
  ok(DH.returns([100, 110, 99]).map(x => +x.toFixed(4)).join() === '0.1,-0.1', 'simple daily returns');
  ok(DH.pearson([1, 2, 3], [1, 2, 3]) === null, 'fewer than 10 points -> null, never a number');
  const x = Array.from({ length: 12 }, (_, k) => k), y = x.map(v => 2 * v + 1);
  ok(Math.abs(DH.pearson(x, y) - 1) < 1e-12 && Math.abs(DH.pearson(x, y.map(v => -v)) + 1) < 1e-12, 'pearson +1 / -1');
  ok(store.bpleone_dh_AAA && JSON.parse(store.bpleone_dh_AAA).s.length === 20, 'cached per symbol in sessionStorage');

  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  ['pair-trades.html', 'cross-asset-correlations.html', 'news-reactions.html'].forEach(f => {
    ok(/js\/daily-history\.js/.test(read(f)), f + ' loads js/daily-history.js');
  });
  ok(!/DataProvider\.getHistorical/.test(read('pair-trades.html')) && !/DataProvider\.getHistorical/.test(read('cross-asset-correlations.html')), 'pair-trades / correlations no longer depend on paid candles');
  ok(/DailyHistory\.pearson\(DailyHistory\.returns\(a\), DailyHistory\.returns\(b\)\)/.test(read('pair-trades.html')), 'pair-trades correlates daily RETURNS, not price levels');
  ok(!/item\.reaction1h = \(\(now - item\.priceAt\)/.test(read('news-reactions.html')) && /sessionDone\(series\[i\]\.d\)/.test(read('news-reactions.html')), 'news-reactions: reactions from real closes, never "move to the current price"');
  ok(/loaded === 0/.test(read('multi-backtest.html')), 'multi-backtest names the missing data instead of blaming the settings');
  console.log(fails ? fails + ' daily-history test(s) FAILED' : 'daily history: all tests passed');
  process.exit(fails ? 1 : 0);
})();
