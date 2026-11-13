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

  async function closes(sym) {
    sym = String(sym || '').toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 12);
    if (!sym) return null;
    if (mem[sym]) return mem[sym];
    const ss = fromSession(sym);
    if (ss) return (mem[sym] = ss);
    if (inflight[sym]) return inflight[sym];
    inflight[sym] = (async () => {
      try {
        const r = await fetch(W + '/brain/history?sym=' + encodeURIComponent(sym), { cache: 'no-store' });
        if (!r.ok) return null;
        const j = await r.json();
        const byDay = {};
        (j && Array.isArray(j.closes) ? j.closes : []).forEach(p => { if (p && p.c > 0 && p.t) byDay[etDate(p.t)] = p.c; });
        const s = Object.keys(byDay).sort().map(d => ({ d, c: byDay[d] }));
        if (s.length < 10) return null;
        mem[sym] = s;
        try { sessionStorage.setItem('bpleone_dh_' + sym, JSON.stringify({ at: Date.now(), s })); } catch (e) {}
        return s;
      } catch (e) { return null; } finally { delete inflight[sym]; }
    })();
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
