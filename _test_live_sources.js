// _test_live_sources.js — behavior tests for pass 340 (audit 2026-11-11): the data sources a US browser can read.
//   1. js/okx-perps.js parses OKX's public API (Binance futures answers 451 to every US visitor) and annualizes at
//      the contract's own funding interval.
//   2. js/econ-feed.js uses a calendar only when it covers today: the Worker's copy sat on the week of 10/18 into
//      November and SPY Radar called the week's calendar risk "behind you" during a PPI week.
//   3. js/sentiment.js parks a refused (premium) Finnhub endpoint for 7 days and never bursts a batch.
// Run: node _test_live_sources.js   (exits 1 on any failure)
const fs = require('fs');
const vm = require('vm');
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const NOW = Date.UTC(2026, 10, 11, 21, 0, 0);   // Wed 11/11/2026 4 PM ET

function sandbox(files, fetchImpl, store) {
  let now = NOW;
  const calls = [];
  const timers = [];
  store = store || {};
  const RealDate = Date;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Date: class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
    Intl, setTimeout: (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; }, clearTimeout: () => {},
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    fetch: (url) => { url = String(url); calls.push({ url, at: now }); return Promise.resolve(fetchImpl(url)); },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  files.forEach(f => vm.runInContext(read(f) + (f === 'js/sentiment.js' ? '\n;this.Sentiment = Sentiment;' : ''), ctx));
  async function settle(p) {
    let done = false, val;
    p.then(v => { done = true; val = v; }, e => { done = true; val = { thrown: String(e) }; });
    for (let k = 0; k < 2000 && !done; k++) {
      await new Promise(r => setImmediate(r));
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (t && !done) { timers.shift(); now = Math.max(now, t.at); t.fn(); }
    }
    return val;
  }
  return { ctx, calls, settle, store, clock: () => now };
}

(async () => {
  // ---------- 1. OKX ----------
  {
    const okx = (data) => resp(200, { code: '0', msg: '', data });
    const S = sandbox(['js/okx-perps.js'], url => {
      if (/funding-rate-history/.test(url)) return okx([
        { fundingTime: '1794412800000', fundingRate: '0.00005', realizedRate: '0.0000463' },
        { fundingTime: '1794384000000', fundingRate: '0.00009', realizedRate: '0.0000937' }]);
      if (/public\/funding-rate\?/.test(url)) return okx([{ fundingRate: '0.0001', fundingTime: '1794441600000', nextFundingTime: '1794470400000' }]);
      if (/mark-price/.test(url)) return okx([{ markPx: '74631.1' }]);
      if (/index-tickers/.test(url)) return okx([{ idxPx: '74665.7' }]);
      if (/open-interest/.test(url)) return okx([{ oi: '3550910', oiCcy: '35509.1', oiUsd: '2650293025.1' }]);
      if (/market\/ticker\?/.test(url)) return okx([{ last: '74629.5', open24h: '73970.3', volCcy24h: '66159.548' }]);
      return resp(404, {});
    });
    const d = await S.settle(S.ctx.OkxPerps.snapshot('BTC'));
    ok(d.mark === 74631.1 && d.index === 74665.7, 'okx: mark and index parsed');
    ok(d.intervalH === 8, 'okx: funding interval from OKX\'s own schedule (got ' + d.intervalH + ')');
    ok(Math.abs(S.ctx.OkxPerps.annualizedPct(d.funding, d.intervalH) - 10.95) < 0.01, 'okx: 0.01% per 8 h annualizes to 10.95%');
    ok(Math.abs(S.ctx.OkxPerps.annualizedPct(0.0001, 1) - 87.6) < 0.01, 'okx: a 1 h contract annualizes 8x higher than an 8 h one');
    ok(Math.abs(d.chgPct - (74629.5 - 73970.3) / 73970.3 * 100) < 1e-9, 'okx: 24h change vs open24h');
    ok(Math.abs(d.vol24Usd - 66159.548 * 74629.5) < 1, 'okx: 24h volume in USD = base volume x last');
    ok(Math.abs(d.oiUsd - 2650293025.1) < 1, 'okx: OI in USD');
    ok(d.basisPct < 0 && Math.abs(d.basisPct - (74631.1 - 74665.7) / 74665.7 * 100) < 1e-9, 'okx: basis = mark vs index');
    ok(S.calls.every(c => /^https:\/\/www\.okx\.com\/api\/v5\//.test(c.url)), 'okx: every call goes to OKX');
    const h = await S.settle(S.ctx.OkxPerps.fundingHistory('BTC', 30));
    ok(h.length === 2 && h[0].ts < h[1].ts && h[1].rate === 0.0000463, 'okx: history oldest first, realized rate');
    // Refused or empty -> nulls, never numbers.
    const F = sandbox(['js/okx-perps.js'], () => resp(451, { code: 0, msg: 'restricted' }));
    const e = await F.settle(F.ctx.OkxPerps.snapshot('BTC'));
    ok(e.mark === null && e.funding === null && e.oiUsd === null && e.basisPct === null, 'okx: a refused call yields nulls, no synthetic numbers');
    ok(await F.settle(F.ctx.OkxPerps.fundingHistory('BTC', 30)) === null, 'okx: refused history is null');
  }

  // ---------- 2. Economic calendar ----------
  const thisWeek = [
    { title: 'CPI m/m', country: 'USD', date: '2026-11-10T08:30:00-05:00', impact: 'High', forecast: '0.3%', previous: '0.6%' },
    { title: 'PPI m/m', country: 'USD', date: '2026-11-13T08:30:00-05:00', impact: 'High', forecast: '0.4%', previous: '1.3%' },
    { title: 'Retail Sales', country: 'USD', date: '2026-11-12T08:30:00-05:00', impact: 'Medium', forecast: '', previous: '' },
    { title: 'GDP', country: 'GBP', date: '2026-11-12T02:00:00-05:00', impact: 'High', forecast: '', previous: '' },
    { title: 'Bank Holiday', country: 'USD', date: '2026-11-11T00:00:00-05:00', impact: 'Holiday', forecast: '', previous: '' },
  ];
  const oct18 = [
    { title: 'Retail Sales m/m', country: 'USD', date: '2026-10-21T08:30:00-04:00', impact: 'High', forecast: '', previous: '' },
    { title: 'Flash PMI', country: 'USD', date: '2026-10-24T09:45:00-04:00', impact: 'High', forecast: '', previous: '' },
  ];
  {
    const S = sandbox(['js/econ-feed.js'], url => /econ-calendar-thisweek/.test(url) ? resp(200, thisWeek) : resp(200, { ok: true, stale: true, events: oct18 }));
    const f = await S.settle(S.ctx.EconFeed.load());
    ok(f.ok && f.source === 'desk calendar file' && f.coverage.last === '2026-11-13', 'econ: the daily file is used when it covers today');
    ok(S.calls.length === 1, 'econ: no Worker call when the file covers today');
    const left = S.ctx.EconFeed.us(f.events, { impacts: ['high'], fromTs: NOW });
    ok(left.length === 1 && left[0].title === 'PPI m/m', 'econ: remaining US high-impact = PPI (got ' + left.map(e => e.title) + ')');
    ok(S.ctx.EconFeed.us(f.events, { impacts: ['high', 'medium'] }).length === 3, 'econ: US high + medium, no GBP, no holiday');
  }
  {
    // The 11/11 production state for a visitor whose file request failed: only the Worker's 10/18 copy.
    const S = sandbox(['js/econ-feed.js'], url => /econ-calendar-thisweek/.test(url) ? resp(404, {}) : resp(200, { ok: true, stale: true, events: oct18 }));
    const f = await S.settle(S.ctx.EconFeed.load());
    ok(!f.ok && f.reason === 'out-of-date' && f.events.length === 0, 'econ: a feed that does not cover today is refused, not read as an all-clear');
    ok(f.tried[0].coverage.first === '2026-10-21' && f.tried[0].coverage.last === '2026-10-24', 'econ: the refusal says what the stale feed covers');
  }
  {
    const S = sandbox(['js/econ-feed.js'], () => resp(503, {}));
    const f = await S.settle(S.ctx.EconFeed.load());
    ok(!f.ok && f.reason === 'unreachable', 'econ: both sources down -> unreachable');
  }
  {
    // The Worker is the fallback when the file is missing and the Worker covers today.
    const S = sandbox(['js/econ-feed.js'], url => /econ-calendar-thisweek/.test(url) ? resp(404, {}) : resp(200, { ok: true, stale: false, events: thisWeek }));
    const f = await S.settle(S.ctx.EconFeed.load());
    ok(f.ok && f.source === 'worker', 'econ: the Worker fills in when its copy covers today');
  }

  // ---------- 3. Sentiment ----------
  {
    const key = { bpleone_data_v1: JSON.stringify({ provider: 'finnhub', apiKey: 'TEST-NOT-A-KEY' }) };
    const S = sandbox(['js/sentiment.js'], () => resp(403, { error: "You don't have access to this resource." }), key);
    const syms = ['AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'META', 'AMZN', 'GOOGL'];
    const out = await S.settle(S.ctx.Sentiment.fetchBatch(syms));
    ok(S.calls.length === 2, 'sentiment: a refusing key costs one call per endpoint, then stops (got ' + S.calls.length + ')');
    ok(Object.values(out).every(v => v === null || v.composite === null), 'sentiment: refused -> no score, never a made-up one');
    ok(S.ctx.Sentiment.available() === false, 'sentiment: reports unavailable once both endpoints refused');
    await S.settle(S.ctx.Sentiment.fetchBatch(syms));
    ok(S.calls.length === 2, 'sentiment: parked for the next batch (got ' + S.calls.length + ')');
  }
  {
    const key = { bpleone_data_v1: JSON.stringify({ provider: 'finnhub', apiKey: 'TEST-NOT-A-KEY' }) };
    const S = sandbox(['js/sentiment.js'], url => /social-sentiment/.test(url)
      ? resp(200, { reddit: [{ score: 0.5, mention: 10 }], twitter: [] })
      : resp(200, { sentiment: { bullishPercent: 60, bearishPercent: 40 } }), key);
    await S.settle(S.ctx.Sentiment.fetchBatch(['AAPL', 'MSFT', 'NVDA']));
    const starts = S.calls.filter((c, i) => i % 2 === 0).map(c => c.at);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    ok(S.calls.length === 6 && gaps.every(g => g >= 1100), 'sentiment: with access, one symbol at a time, >= 1.1 s apart (gaps ' + gaps + ')');
    ok(S.ctx.Sentiment.get('AAPL').composite === 0.5, 'sentiment: real score kept');
  }

  console.log(fails ? fails + ' live-source test(s) FAILED' : 'live sources: all tests passed');
  process.exit(fails ? 1 : 0);
})();
