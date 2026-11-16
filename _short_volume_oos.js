// _short_volume_oos.js — the out-of-sample record of H3b (_research/PREREG-2026-11-16-short-volume-reversed-OOS.md).
// Recomputed from public data on every run: FINRA Reg SHO daily consolidated short volume and Yahoo daily closes (the
// desk's Worker /brain/history). Only weeks whose rebalance session is on or after 2026-11-20 count. No verdict before
// 26 weeks. A skipped run loses nothing: the next run recomputes every week.
// Usage: node _short_volume_oos.js data/research/short-volume-oos.json
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'data/research/short-volume-oos.json';
const CACHE = path.join(path.dirname(OUT), 'finra-short-ratios.json');   // universe rows only; rebuildable from FINRA
const W = 'https://bpleone-brain-worker.brandonpleone.workers.dev';
const FIRST_WEEK = '2026-11-20', NEED_WEEKS = 26, COST = 0.004;
const UNIVERSE = ('AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO BRK-B JPM LLY V UNH XOM MA JNJ PG HD COST ABBV MRK CVX WMT BAC KO '
  + 'PEP NFLX ADBE CRM AMD ORCL TMO ACN MCD CSCO ABT LIN DHR WFC INTU TXN DIS VZ PM CMCSA NEE IBM AMGN QCOM CAT '
  + 'GE HON UNP SPGI AMAT LOW BA RTX GS ISRG NOW PFE BKNG T ELV MS INTC BLK DE SBUX MDT PLD GILD AXP LMT ADP SYK '
  + 'MDLZ TJX ADI C MMC CB VRTX AMT CI REGN SCHW MO SO ZTS BMY DUK LRCX MU PANW KLAC SNPS CDNS UBER PLTR').split(' ');
const FINRA_SYM = s => s.replace('-', '.');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const etDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'desk-research' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function closes(sym) {
  try {
    const j = await getJson(W + '/brain/history?sym=' + encodeURIComponent(sym));
    const m = {};
    for (const p of (j.closes || [])) if (p && p.c > 0 && p.t) m[etDate(p.t)] = p.c;
    return Object.keys(m).length >= 100 ? m : null;
  } catch (e) { return null; }
}
async function finraDay(d) {
  const url = 'https://cdn.finra.org/equity/regsho/daily/CNMSshvol' + d.replace(/-/g, '') + '.txt';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'desk-research' } });
    if (r.status === 403 || r.status === 404) return null;
    if (!r.ok) return 'retry';
    const want = new Set(UNIVERSE.map(FINRA_SYM)), out = {};
    for (const line of (await r.text()).split('\n').slice(1)) {
      const p = line.split('|');
      if (p.length < 5 || !want.has(p[1])) continue;
      const sv = +p[2], tv = +p[4];
      if (tv > 0 && isFinite(sv)) out[p[1].replace('.', '-')] = +(sv / tv).toFixed(5);
    }
    return Object.keys(out).length ? out : null;
  } catch (e) { return 'retry'; }
}
function tstat(xs) {
  if (xs.length < 3) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  return sd > 0 ? m / (sd / Math.sqrt(xs.length)) : null;
}
function ranks(v) {
  const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = new Array(v.length);
  for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; }
  return r;
}
function spearman(a, b) {
  const ra = ranks(a), rb = ranks(b), ma = ra.reduce((x, y) => x + y, 0) / ra.length, mb = rb.reduce((x, y) => x + y, 0) / rb.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { n += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : 0;
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

(async () => {
  const spy = await closes('SPY');
  if (!spy) { console.error('no SPY closes; keeping last-good'); process.exit(3); }
  const sessions = Object.keys(spy).sort();
  // FINRA days needed: the 65 sessions before the first rebalance through the latest session.
  const firstIdx = sessions.findIndex(d => d >= FIRST_WEEK);
  const startIdx = Math.max(0, (firstIdx < 0 ? sessions.length : firstIdx) - 70);
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) {}
  const ratios = cache.ratios || {}, missing = new Set(cache.missing || []);
  for (const d of sessions.slice(startIdx)) {
    if (ratios[d] || missing.has(d)) continue;
    let got = await finraDay(d);
    if (got === 'retry') { await sleep(2000); got = await finraDay(d); }
    if (got && got !== 'retry') ratios[d] = got; else if (got === null && d < sessions[sessions.length - 1]) missing.add(d);
    await sleep(150);
  }
  const names = [];
  const px = {};
  for (const s of UNIVERSE) { const c = await closes(s); if (c) { px[s] = c; names.push(s); } await sleep(200); }

  // Weekly grid on the last session of each ISO week; a week counts from FIRST_WEEK on, and needs the next week's close.
  const wk = d => { const t = new Date(d + 'T12:00:00Z'); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day); return t.toISOString().slice(0, 10); };
  const lastOfWeek = [];
  for (let i = 0; i < sessions.length; i++) if (i === sessions.length - 1 || wk(sessions[i + 1]) !== wk(sessions[i])) lastOfWeek.push(sessions[i]);
  const fdays = Object.keys(ratios).sort();
  const rows = [];
  for (let w = 0; w + 1 < lastOfWeek.length; w++) {
    const d0 = lastOfWeek[w], df = lastOfWeek[w + 1];
    if (d0 < FIRST_WEEK) continue;
    if (df === sessions[sessions.length - 1] && wk(df) === wk(etDate(Date.now())) && new Date().getUTCDay() >= 1 && new Date().getUTCDay() <= 5) continue; // forward week still running
    const k = fdays.filter(x => x <= d0).length - 1;
    if (k < 64) continue;
    const recent = fdays.slice(k - 4, k + 1), base = fdays.slice(k - 64, k - 4);
    const spyFwd = spy[df] / spy[d0] - 1;
    const pts = [];
    for (const s of names) {
      const c = px[s];
      if (!c[d0] || !c[df]) continue;
      const rv = recent.map(d => ratios[d][s]).filter(v => v != null), bv = base.map(d => ratios[d][s]).filter(v => v != null);
      if (rv.length < 4 || bv.length < 50) continue;
      pts.push([mean(rv) - mean(bv), c[df] / c[d0] - 1 - spyFwd]);
    }
    if (pts.length < 40) continue;
    pts.sort((a, b) => a[0] - b[0]);
    const q = Math.floor(pts.length / 5);
    const spread = mean(pts.slice(-q).map(p => p[1])) - mean(pts.slice(0, q).map(p => p[1]));   // long HIGH, short LOW
    rows.push({ week: d0, to: df, names: pts.length, spread_pct: +(spread * 100).toFixed(3), ic: +spearman(pts.map(p => p[0]), pts.map(p => p[1])).toFixed(4) });
  }
  const sp = rows.map(r => r.spread_pct / 100), ic = rows.map(r => r.ic);
  const ts = tstat(sp), ti = tstat(ic);
  const res = {
    ok: true, test: 'H3b: long the highest abnormal FINRA short-volume ratio, short the lowest; next week vs SPY',
    registered: '2026-11-16', prereg: '_research/PREREG-2026-11-16-short-volume-reversed-OOS.md', first_week: FIRST_WEEK,
    weeks: rows.length, needed: NEED_WEEKS, universe: names.length,
    mean_spread_pct: rows.length ? +(mean(sp) * 100).toFixed(3) : null, t_spread: ts == null ? null : +ts.toFixed(2),
    mean_ic: rows.length ? +mean(ic).toFixed(4) : null, t_ic: ti == null ? null : +ti.toFixed(2),
    mean_net_pct: rows.length ? +((mean(sp) - COST) * 100).toFixed(3) : null,
    verdict: rows.length < NEED_WEEKS ? 'NO VERDICT YET' : (mean(sp) > 0 && ts >= 2 && ti >= 2 && mean(sp) - COST > 0 ? 'PASS' : 'FAIL'),
    rows, finra_days: fdays.length, generatedAt: new Date().toISOString(),
    sources: 'FINRA Reg SHO daily consolidated short volume (cdn.finra.org); Yahoo daily closes via the desk Worker'
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  fs.writeFileSync(CACHE, JSON.stringify({ ratios, missing: [...missing].sort() }));
  console.log('weeks', res.weeks, 'of', NEED_WEEKS, 'verdict', res.verdict, 'universe', names.length, 'finra days', fdays.length);
})().catch(e => { console.error(e); process.exit(1); });
