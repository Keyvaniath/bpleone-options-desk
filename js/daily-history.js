/* ===========================================
   BPLEONE — Daily history (pass 345)
   ---
   One year of REAL daily closes for any ticker from the desk's Worker (/brain/history: Yahoo daily,
   crypto included), keyed by ET calendar date so two series can be aligned BY DATE. Pages used
   DataProvider.getHistorical, which is Finnhub's paid candle endpoint: for keyless and free-key
   visitors it returned nothing, so cross-asset-correlations and pair-trades showed empty tables, and
   both lined series up by array position (crypto has 7-day weeks, equities 5).
     DailyHistory.closes(sym)            -> Promise<[{ d: 'YYYY-MM-DD', c }]> oldest first, or null
     DailyHistory.align(a, b)            -> { dates, a: [closes], b: [closes] } on common dates
     DailyHistory.returns(closes)        -> simple daily returns (length - 1)
     DailyHistory.pearson(x, y)          -> correlation of two equal-length arrays, or null (< 10 points)
   Cached per symbol in memory and sessionStorage for 6 hours.
   Pass 350 (worker pass-331): closes() calls made within 30 ms share ONE request (/brain/history?syms=, up to 40
   names); names the Worker defers (over its per-request Yahoo budget) are asked for again, at most twice. An older
   Worker ignores syms (it would answer with SPY), so the batch is used only when the reply carries `histories`;
   otherwise each name falls back to ?sym=, six at a time.
   =========================================== */
(function () {
  if (typeof window === 'undefined' || window.DailyHistory) return;
  const W = (function () {
    try { const u = window.WorkerBridge && WorkerBridge.getUrl && WorkerBridge.getUrl(); if (u && /^https:\/\//.test(u)) return u.replace(/\/$/, ''); } catch (e) {}
    return 'https://bpleone-brain-worker.brandonpleone.workers.dev';
  })();
  const TTL = 6 * 3600 * 1000;
  const mem = {};
  const inflight = {};
  const etDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));

  function fromSession(sym) {
    try { const c = JSON.parse(sessionStorage.getItem('bpleone_dh_' + sym) || 'null'); if (c && Date.now() - c.at < TTL && Array.isArray(c.s)) return c.s; } catch (e) {}
    return null;
  }

  const BATCH_MAX = 40;
  const SAFE = /^[A-Z][A-Z0-9.\-]{0,7}$/;   // what the Worker's batch accepts unchanged
  const queue = new Map();                  // sym -> [resolve]
  let timer = null;
  let batchOk = null;                       // null = not tried, true = Worker serves ?syms=, false = older Worker

  function toSeries(points) {
    const byDay = {};
    (Array.isArray(points) ? points : []).forEach(p => { if (p && p.c > 0 && p.t) byDay[etDate(p.t)] = p.c; });
    const s = Object.keys(byDay).sort().map(d => ({ d, c: byDay[d] }));
    return s.length < 10 ? null : s;
  }
  function store(sym, s) {
    if (!s) return null;
    mem[sym] = s;
    try { sessionStorage.setItem('bpleone_dh_' + sym, JSON.stringify({ at: Date.now(), s })); } catch (e) {}
    return s;
  }
  async function fetchOne(sym) {
    try {
      const r = await fetch(W + '/brain/history?sym=' + encodeURIComponent(sym), { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      return store(sym, toSeries(j && j.closes));
    } catch (e) { return null; }
  }
  async function fetchEach(syms) {
    const out = {};
    for (let i = 0; i < syms.length; i += 6) await Promise.all(syms.slice(i, i + 6).map(async s => { out[s] = await fetchOne(s); }));
    return out;
  }
  // One batch round trip; returns { got: {sym: series|null}, deferred: [syms] } or null when the Worker has no batch route.
  async function fetchBatch(syms) {
    let j = null;
    try { const r = await fetch(W + '/brain/history?syms=' + syms.map(encodeURIComponent).join(','), { cache: 'no-store' }); j = r.ok ? await r.json() : null; } catch (e) { j = null; }
    if (!j || !j.histories || typeof j.histories !== 'object') return null;
    const got = {}, deferred = Array.isArray(j.deferred) ? j.deferred.filter(s => syms.indexOf(s) >= 0) : [];
    syms.forEach(s => { if (deferred.indexOf(s) < 0) got[s] = store(s, toSeries(j.histories[s] && j.histories[s].closes)); });
    return { got, deferred };
  }
  async function flush() {
    timer = null;
    const waiters = new Map(queue); queue.clear();
    const syms = [...waiters.keys()];
    const results = {};
    const batchable = syms.filter(s => SAFE.test(s));
    const singles = syms.filter(s => !SAFE.test(s));
    if (batchable.length > 1 && batchOk !== false) {
      for (let i = 0; i < batchable.length; i += BATCH_MAX) {
        let todo = batchable.slice(i, i + BATCH_MAX);
        for (let round = 0; round < 3 && todo.length; round++) {
          if (round) await new Promise(r => setTimeout(r, 1200));
          const b = await fetchBatch(todo);
          if (!b) { batchOk = false; break; }
          batchOk = true;
          Object.assign(results, b.got);
          todo = b.deferred;
        }
        if (batchOk === false) { Object.assign(results, await fetchEach(batchable.filter(s => !(s in results)))); break; }
        singles.push(...todo);   // still deferred after three rounds: ask for each on its own
      }
    } else {
      singles.push(...batchable);
    }
    Object.assign(results, await fetchEach(singles.filter(s => !(s in results))));
    waiters.forEach((fns, s) => fns.forEach(fn => fn(results[s] || null)));
  }

  async function closes(sym) {
    sym = String(sym || '').toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 12);
    if (!sym) return null;
    if (mem[sym]) return mem[sym];
    const ss = fromSession(sym);
    if (ss) return (mem[sym] = ss);
    if (inflight[sym]) return inflight[sym];
    inflight[sym] = new Promise(resolve => {
      if (!queue.has(sym)) queue.set(sym, []);
      queue.get(sym).push(resolve);
      if (!timer) timer = setTimeout(flush, 30);
    }).finally(() => { delete inflight[sym]; });
    return inflight[sym];
  }

  function align(a, b) {
    if (!a || !b) return null;
    const mb = new Map(b.map(p => [p.d, p.c]));
    const dates = [], xa = [], xb = [];
    a.forEach(p => { if (mb.has(p.d)) { dates.push(p.d); xa.push(p.c); xb.push(mb.get(p.d)); } });
    return { dates, a: xa, b: xb };
  }

  function returns(c) {
    const out = [];
    for (let i = 1; i < c.length; i++) out.push(c[i] / c[i - 1] - 1);
    return out;
  }

  function pearson(x, y) {
    const n = Math.min(x ? x.length : 0, y ? y.length : 0);
    if (n < 10) return null;
    const a = x.slice(-n), b = y.slice(-n);
    const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
  }

  window.DailyHistory = { closes, align, returns, pearson };
})();
