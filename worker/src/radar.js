// radar.js — the radar call ledger (worker pass-317). Pure functions only: the cron I/O and the
// /brain/radar-log route live in index.js. Each weekday after the close the worker logs, per name
// in RADAR_SET, exactly what the radar shows: the desk's 5-day lean (the live-calibrated P(up)
// as displayed), the options market's priced move to the next listed expiry and to ~a week out
// (ATM straddle / close, the page's method), and the next session's floor-trader pivots off the
// completed bar. Later captures fill the outcomes from real daily bars. The grading is honest by
// construction: direction is scored against the market-drift null with the overlap correction
// (daily calls on 5-day windows are not independent), and range containment is scored against
// what a FAIR straddle contains (~57.5%), because the implied move is the options market's
// forecast, not ours.

export const RADAR_SET = [
  // SPY first: its bar decides whether today was a trading session.
  'SPY', 'QQQ', 'SMH', 'SOXX', 'XLK',
  'NVDA', 'AMD', 'AVGO', 'MU', 'TSM', 'MRVL', 'ASML', 'AMAT', 'LRCX', 'INTC', 'QCOM', 'ARM', 'COHR', 'CRDO',
  'AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'ORCL', 'PLTR'
];
export const RADAR_GROUP = {
  SPY: 'index', QQQ: 'index', SMH: 'semis', SOXX: 'semis', XLK: 'tech',
  NVDA: 'semis', AMD: 'semis', AVGO: 'semis', MU: 'semis', TSM: 'semis', MRVL: 'semis', ASML: 'semis',
  AMAT: 'semis', LRCX: 'semis', INTC: 'semis', QCOM: 'semis', ARM: 'semis', COHR: 'semis', CRDO: 'semis',
  AAPL: 'tech', MSFT: 'tech', GOOGL: 'tech', META: 'tech', AMZN: 'tech', ORCL: 'tech', PLTR: 'tech'
};
export const FAIR_STRADDLE_CONTAINMENT = 0.575;   // P(|move| <= E|move|) for a normal move: 2*Phi(sqrt(2/pi)) - 1
export const RADAR_MAX_RECORDS = 6000;           // ~230 sessions x 26 names
export const OVERLAP_DAYS = 9;                   // same-(sym, dir) calls within 9 calendar days = one independent observation

const r4 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1e4) / 1e4;
const r2 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 100) / 100;

export function etDateStr(ms) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  return p;   // en-CA formats as YYYY-MM-DD
}

function dayDiff(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
}

// fetchYahooHistorical rows -> [{d,o,h,l,c}] ascending, one per ET session date
export function barsToDaily(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r || !(r.close > 0)) continue;
    const d = etDateStr(r.ts);
    const row = { d, o: +r.open, h: +r.high, l: +r.low, c: +r.close };
    if (out.length && out[out.length - 1].d === d) out[out.length - 1] = row; else out.push(row);
  }
  return out;
}

export function pivots(b) {
  if (!b || !(b.h > 0) || !(b.l > 0) || !(b.c > 0)) return null;
  const P = (b.h + b.l + b.c) / 3;
  return { P: r2(P), R1: r2(2 * P - b.l), S1: r2(2 * P - b.h), R2: r2(P + (b.h - b.l)), S2: r2(P - (b.h - b.l)) };
}

export function atr14(daily) {
  if (!daily || daily.length < 15) return null;
  const trs = [];
  for (let i = 1; i < daily.length; i++) {
    const b = daily[i], pc = daily[i - 1].c;
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)));
  }
  const last = trs.slice(-14);
  return r2(last.reduce((s, x) => s + x, 0) / last.length);
}

// The radar's method: ATM straddle (call mid + put mid at the strike nearest the close) / close.
// "next" = the first listed expiry after the session (SPY: tomorrow); "week" = the first expiry 2-6
// calendar days out (the page's Friday-ish row), else the next one beyond.
export function impliedMoves(chain, close, dayStr) {
  if (!chain || !Array.isArray(chain.contracts) || !chain.contracts.length || !(close > 0)) return { next: null, week: null };
  const exps = [...new Set(chain.contracts.map(c => c.expiration))].filter(e => e > dayStr).sort();
  function strad(e) {
    const inExp = chain.contracts.filter(c => c.expiration === e && c.bid > 0 && c.mid > 0);
    let atm = null, gap = 1e18;
    for (const c of inExp) { const g = Math.abs(c.strike - close); if (g < gap) { gap = g; atm = c.strike; } }
    if (atm == null) return null;
    const call = inExp.find(c => c.strike === atm && c.type === 'call');
    const put = inExp.find(c => c.strike === atm && c.type === 'put');
    if (!call || !put) return null;
    return { e, dte: dayDiff(dayStr, e), atm, pct: r4((call.mid + put.mid) / close),
             iv: (call.iv > 0 && put.iv > 0) ? r4((call.iv + put.iv) / 2) : null };
  }
  let next = null;
  for (const e of exps.slice(0, 3)) { next = strad(e); if (next) break; }
  const wk = exps.filter(e => { const t = dayDiff(dayStr, e); return t >= 2 && t <= 6; })
    .concat(exps.filter(e => dayDiff(dayStr, e) > 6));
  let week = null;
  for (const e of wk.slice(0, 3)) { if (next && e === next.e) continue; week = strad(e); if (week) break; }
  return { next, week };
}

// One logged call. Returns null when there is no completed bar for dayStr (holiday / data gap).
// sig = the /brain/signals row for the name (null when the brain does not score it).
export function buildCall(sym, daily, chain, sig, dayStr, sigFresh) {
  const t = daily && daily.length ? daily[daily.length - 1] : null;
  if (!t || t.d !== dayStr) return null;
  const im = impliedMoves(chain, t.c, dayStr);
  const pv = pivots(t) || {};
  const lean = !!(sig && sigFresh && typeof sig.predProb === 'number');
  return {
    d: dayStr, s: sym, g: RADAR_GROUP[sym] || 'other', c: r4(t.c),
    p: lean ? r4(sig.predProb) : null,
    pm: lean && typeof sig.predProbModel === 'number' ? r4(sig.predProbModel) : null,
    sig: lean ? String(sig.signal || '') : null,
    np: lean ? /no play/i.test(String(sig.reason || '')) : null,
    e1: im.next ? im.next.e : null, d1: im.next ? im.next.dte : null, m1: im.next ? im.next.pct : null,
    e5: im.week ? im.week.e : null, d5: im.week ? im.week.dte : null, m5: im.week ? im.week.pct : null,
    iv: im.next ? im.next.iv : null,
    P: pv.P ?? null, R1: pv.R1 ?? null, S1: pv.S1 ?? null, R2: pv.R2 ?? null, S2: pv.S2 ?? null,
    atr: atr14(daily), done: false
  };
}

// Fill outcomes for one name's open records from its daily bars (completed sessions only).
export function fillOutcomes(recs, daily) {
  if (!daily || !daily.length) return 0;
  const idx = {};
  daily.forEach((b, i) => { idx[b.d] = i; });
  const lastD = daily[daily.length - 1].d;
  const closeAsOf = d => { let best = null; for (const b of daily) { if (b.d <= d) best = b; else break; } return best; };
  let n = 0;
  for (const r of recs) {
    if (r.done) continue;
    const i = idx[r.d];
    if (i == null) continue;
    let ch = false;
    if (!r.o1 && daily[i + 1]) { const b = daily[i + 1]; r.o1 = { d: b.d, c: r4(b.c), h: r4(b.h), l: r4(b.l) }; ch = true; }
    if (!r.o5 && daily[i + 5]) { const b = daily[i + 5]; r.o5 = { d: b.d, c: r4(b.c) }; ch = true; }
    if (r.e1 && !r.x1 && lastD >= r.e1) { const b = closeAsOf(r.e1); if (b && b.d > r.d) { r.x1 = { d: b.d, c: r4(b.c) }; ch = true; } }
    if (r.e5 && !r.x5 && lastD >= r.e5) { const b = closeAsOf(r.e5); if (b && b.d > r.d) { r.x5 = { d: b.d, c: r4(b.c) }; ch = true; } }
    r.done = !!(r.o1 && r.o5 && (!r.e1 || r.x1) && (!r.e5 || r.x5));
    if (ch) n++;
  }
  return n;
}

// ---------------- grading ----------------
function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

export function leanStats(recs) {
  const calls = recs.filter(r => r.p != null && r.o5 && r.c > 0)
    .map(r => ({ s: r.s, d: r.d, dir: r.p >= 0.5 ? 1 : -1, ret: r.o5.c / r.c - 1 }));
  const n = calls.length;
  if (!n) return { n: 0, n_eff: 0, hits: 0, hit_rate: null, up_rate: null, drift_null_rate: null, z_adj: null, beats_drift_95: false };
  const hits = calls.filter(c => (c.dir > 0 && c.ret > 0) || (c.dir < 0 && c.ret < 0)).length;
  const up = calls.filter(c => c.ret > 0).length / n;
  let p0 = 0;
  calls.forEach(c => { p0 += c.dir > 0 ? up : 1 - up; });
  p0 /= n;
  // Overlap correction: same-(sym, dir) calls whose 5-day windows overlap are one observation.
  const groups = {};
  calls.slice().sort((a, b) => a.d < b.d ? -1 : 1).forEach(c => { (groups[c.s + '|' + c.dir] = groups[c.s + '|' + c.dir] || []).push(c.d); });
  let nEff = 0;
  Object.values(groups).forEach(ds => { let start = null; ds.forEach(d => { if (start == null || dayDiff(start, d) > OVERLAP_DAYS) { nEff++; start = d; } }); });
  const z = (p0 > 0 && p0 < 1) ? (hits - n * p0) / Math.sqrt(n * p0 * (1 - p0)) : null;
  const zAdj = z == null ? null : z * Math.sqrt(nEff / n);
  return { n, n_eff: nEff, hits, hit_rate: r4(hits / n), up_rate: r4(up), drift_null_rate: r4(p0),
           z_adj: zAdj == null ? null : r2(zAdj), beats_drift_95: !!(zAdj != null && nEff >= 5 && zAdj > 1.64) };
}

export function rangeStats(recs, k) {
  const m = 'm' + k, x = 'x' + k;
  const rs = recs.filter(r => r[m] > 0 && r[x] && r.c > 0);
  if (!rs.length) return { n: 0, contained_rate: null, expected_if_fair: FAIR_STRADDLE_CONTAINMENT, median_realized_to_implied: null };
  const ratios = rs.map(r => Math.abs(r[x].c / r.c - 1) / r[m]);
  return { n: rs.length, contained_rate: r4(ratios.filter(q => q <= 1).length / rs.length),
           expected_if_fair: FAIR_STRADDLE_CONTAINMENT, median_realized_to_implied: r4(median(ratios)) };
}

export function levelStats(recs) {
  const rs = recs.filter(r => r.o1 && r.R1 && r.S1);
  if (!rs.length) return { n: 0 };
  const up = rs.filter(r => r.o1.h >= r.R1).length, dn = rs.filter(r => r.o1.l <= r.S1).length;
  const either = rs.filter(r => r.o1.h >= r.R1 || r.o1.l <= r.S1).length;
  return { n: rs.length, touched_R1: r4(up / rs.length), touched_S1: r4(dn / rs.length), touched_either: r4(either / rs.length) };
}

export function gradeBlock(recs) {
  return {
    calls: recs.length,
    lean_5d: leanStats(recs),
    lean_5d_gate_open: leanStats(recs.filter(r => r.np === false)),
    lean_5d_no_play: leanStats(recs.filter(r => r.np === true)),
    range_next_expiry: rangeStats(recs, 1),
    range_week: rangeStats(recs, 5),
    pivots_next_session: levelStats(recs)
  };
}

export function radarStats(log, sym, recentN) {
  const all = (log || []).filter(r => r && r.d && r.s);
  const groups = { all: gradeBlock(all) };
  ['index', 'semis', 'tech'].forEach(g => { groups[g] = gradeBlock(all.filter(r => r.g === g)); });
  const symbols = {};
  RADAR_SET.forEach(s => {
    const rs = all.filter(r => r.s === s);
    const L = leanStats(rs), R1 = rangeStats(rs, 1), R5 = rangeStats(rs, 5);
    symbols[s] = { group: RADAR_GROUP[s], calls: rs.length, lean_hit_rate: L.hit_rate, lean_n: L.n, lean_n_eff: L.n_eff,
                   contained_next: R1.contained_rate, contained_week: R5.contained_rate, n_range: R1.n,
                   realized_to_implied: R1.median_realized_to_implied };
  });
  const days = [...new Set(all.map(r => r.d))].sort();
  const latest = days.length ? days[days.length - 1] : null;
  const want = String(sym || 'SPY').toUpperCase();
  const recent = all.filter(r => r.s === want).sort((a, b) => a.d < b.d ? 1 : -1).slice(0, recentN || 20);
  const L = groups.all.lean_5d;
  const ready = L.n_eff >= 20;
  const pct = x => x == null ? '—' : (x * 100).toFixed(1) + '%';
  let headline;
  if (!all.length) headline = 'Logging starts with the first after-close capture. Nothing graded yet.';
  else if (!ready) headline = 'Accruing: ' + all.length + ' calls logged over ' + days.length + ' session(s); ' + L.n + ' 5-day leans graded (' + L.n_eff + ' independent of the 20 needed). No verdict yet.';
  else headline = (L.beats_drift_95 ? 'The lean BEATS market drift at 95% (overlap-corrected): ' : 'The lean does NOT beat market drift: ')
    + pct(L.hit_rate) + ' vs a ' + pct(L.drift_null_rate) + ' drift null on ' + L.n + ' calls (' + L.n_eff + ' independent).';
  return { days: days.length, first_day: days[0] || null, latest_day: latest, groups, symbols, recent_sym: want, recent,
           verdict: { ready, headline } };
}
