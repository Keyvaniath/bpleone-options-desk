/* Edge Lab backtest — honest test of whether free signals beat market DRIFT.
   Run daily by .github/workflows/edge-lab.yml (and seeded locally). Writes
   data/edge-lab.json for edge-lab.html. The page pulls the brain's own TA +
   confluence verdicts LIVE from the worker; this script handles the two signals
   that need deep history (analyst-revision momentum + price momentum), which it
   computes from Yahoo daily closes + the worker's /brain/recommendations.
   The bar is ALWAYS "beat the unconditional drift base rate at 95% (one-sided
   z>1.64)", never "beat a coin flip". No look-ahead: the signal at month t is
   graded on the return AFTER t. */
const fs = require('fs');
const W = 'https://bpleone-brain-worker.brandonpleone.workers.dev';
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bpleone-edge-lab/1.0)' } };
const SYMS = ['NVDA','AAPL','MSFT','AMD','META','AMZN','GOOGL','TSLA','JPM','BAC','GS','MS','C','WFC','AVGO','COST','WMT','TGT','HD','LOW','DIS','NFLX','PLTR','UBER','SHOP','PANW','MRVL','SNOW','CRM','ORCL','ADBE','INTC','QCOM','TXN','MU','SMCI','COIN','HOOD','SOFI','PYPL','BA','CAT','GE','MMM','KO','PEP','MCD','NKE','PFE','MRK','JNJ','UNH','CVX','XOM','COP','LMT','RTX','V','MA','ABNB','CMG','LULU','SBUX','T','VZ','CSCO','IBM','GME','F'];

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); }
function win(a) { return a.length ? a.filter(x => x > 0).length / a.length : NaN; }
function zVsBase(sig, base) { return (mean(sig) - mean(base)) / (sd(sig) / Math.sqrt(sig.length)); }
function net(r) { const t = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell; return t ? (2 * r.strongBuy + r.buy - r.sell - 2 * r.strongSell) / t : null; }

async function bars(s) {
  try {
    const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=2y&interval=1d`, UA)).json();
    const res = j.chart && j.chart.result && j.chart.result[0];
    if (!res || !res.timestamp) return null;
    const c = res.indicators.quote[0].close;
    return res.timestamp.map((t, i) => ({ d: new Date(t * 1000), c: c[i] })).filter(x => x.c > 0);
  } catch (e) { return null; }
}
async function recs(s) {
  try { const j = await (await fetch(`${W}/brain/recommendations?symbol=${s}`)).json(); return (j && j.ok && j.trend) ? j.trend : null; }
  catch (e) { return null; }
}

(async () => {
  const rev = { up: [], all: [] };
  const mom = [];
  let fetched = 0;
  for (const s of SYMS) {
    const px = await bars(s);
    if (px && px.length >= 150) {
      fetched++;
      const closes = px.map(p => p.c);
      // price momentum: every 21 td, trailing 63td return -> forward 21td return
      for (let t = 63; t + 21 < closes.length; t += 21) {
        mom.push({ mom: closes[t] / closes[t - 63] - 1, fwd: closes[t + 21] / closes[t] - 1 });
      }
      // analyst-revision momentum (needs rec history)
      const tr = await recs(s);
      if (tr && tr.length >= 3) {
        const o = tr.slice().reverse();
        for (let i = 1; i < o.length; i++) {
          const a = net(o[i - 1]), b = net(o[i]);
          if (a == null || b == null) continue;
          const pd = new Date(o[i].period + 'T00:00:00');
          const idx = px.findIndex(p => p.d >= pd);
          if (idx < 0 || idx + 21 >= px.length) continue;
          const fwd = px[idx + 21].c / px[idx].c - 1;
          rev.all.push(fwd);
          if (b - a > 0.02) rev.up.push(fwd);
        }
      }
    }
  }

  // price-momentum buckets
  mom.sort((a, b) => a.mom - b.mom);
  const k = Math.floor(mom.length / 3);
  const hi = mom.slice(mom.length - k).map(o => o.fwd);
  const allMom = mom.map(o => o.fwd);

  function sig(name, desc, signalArr, baseArr) {
    const z = zVsBase(signalArr, baseArr);
    const edge = (mean(signalArr) - mean(baseArr)) * 100;
    return {
      name, desc,
      n: signalArr.length,
      signal_ret_pct: +(mean(signalArr) * 100).toFixed(2),
      base_ret_pct: +(mean(baseArr) * 100).toFixed(2),
      signal_win_pct: +(win(signalArr) * 100).toFixed(0),
      edge_pp: +edge.toFixed(2),
      z: +z.toFixed(2),
      beats_drift_95: z > 1.64,
      verdict: z > 1.64 ? 'EDGE' : 'NO EDGE'
    };
  }

  const out = {
    ok: true,
    generated: new Date().toISOString().slice(0, 10),
    universe_size: fetched,
    horizon: '1-month forward return, graded vs the unconditional drift base rate (95% / one-sided z>1.64)',
    signals: [
      sig('Analyst-revision momentum', 'When analysts upgrade a name (net buy-rating rises month/month), does it beat drift next month? Finnhub recommendation trends + forward return.', rev.up, rev.all),
      sig('Price momentum (3mo → 1mo)', 'Classic momentum factor: do the strongest-trending names (top third by trailing 3-month return) outperform next month?', hi, allMom)
    ],
    note: 'These two signals need deep history so they are computed here from real Yahoo daily closes + worker recommendation trends. The brain TA + confluence rows on the page are pulled LIVE from the worker. Bar is always beat-drift, never beat-a-coin-flip.'
  };
  fs.writeFileSync(process.argv[2] || 'data/edge-lab.json', JSON.stringify(out, null, 1));
  console.log('wrote edge-lab.json | universe', fetched,
    '| revisions n=' + rev.up.length, 'z=' + out.signals[0].z,
    '| momentum n=' + hi.length, 'z=' + out.signals[1].z);
})();
