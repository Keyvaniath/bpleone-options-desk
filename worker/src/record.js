// record.js — the brain's live record by week (worker pass-329). Pure functions only; the
// /brain/record route lives in index.js. Input is the live journal: every capture the brain made,
// graded at 5 days by the minute tick (resolved.mid = 'correct' | 'wrong' | 'flat' | false).
//
// The same rule as /brain/metrics live_resolved: only 'correct' and 'wrong' count (a flat move and a
// still-open call are left out), the call is UP when predProb >= 0.5, and Brier uses the outcome
// "the stock rose". Each row also carries the share of graded names that rose, which is what an
// "always call up" rule would have hit that week, so the brain's hit rate is read against the
// market's own direction rather than against 50%. All names captured in one week share one market,
// so a week is close to ONE independent observation, not n of them.
//
// Pass-331: chance_rate = called_up * up_rate + (1 - called_up) * (1 - up_rate), the hit rate of calls made in the
// brain's own up/down mix but assigned to names at random. hit_rate - chance_rate (= `skill`, twice the covariance
// of "called up" and "rose") is the part of the hit rate that comes from choosing WHICH names, the only part a
// rule like "call up every time" cannot copy. It uses the week's realized up share, so it is a test, not a rule
// anyone could trade in advance.

// dayKey YYYYMMDD (ET calendar date) -> the Monday of its week, as YYYYMMDD.
export function weekOf(dayKey) {
  const k = Number(dayKey);
  if (!Number.isFinite(k) || k < 19000101) return null;
  const y = Math.floor(k / 10000), m = Math.floor(k / 100) % 100, d = k % 100;
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay();             // 0 Sun .. 6 Sat
  const mon = new Date(t - ((dow + 6) % 7) * 86400000);
  return mon.getUTCFullYear() * 10000 + (mon.getUTCMonth() + 1) * 100 + mon.getUTCDate();
}

export function gradedOutcome(e) {
  const o = e && e.resolved && e.resolved.mid;
  return (o === 'correct' || o === 'wrong') ? o : null;
}

export function recordByWeek(journal) {
  const weeks = new Map();
  const tot = { n: 0, hits: 0, up: 0, calledUp: 0, brier: 0 };
  for (const e of journal || []) {
    const o = gradedOutcome(e);
    if (!o || typeof e.predProb !== 'number' || !isFinite(e.predProb)) continue;
    const wk = weekOf(e.dayKey);
    if (!wk) continue;
    const predUp = e.predProb >= 0.5;
    const rose = (predUp && o === 'correct') || (!predUp && o === 'wrong');
    const b = (e.predProb - (rose ? 1 : 0)) ** 2;
    let w = weeks.get(wk);
    if (!w) { w = { week: wk, n: 0, hits: 0, up: 0, calledUp: 0, brier: 0 }; weeks.set(wk, w); }
    for (const a of [w, tot]) {
      a.n++; if (o === 'correct') a.hits++; if (rose) a.up++; if (predUp) a.calledUp++; a.brier += b;
    }
  }
  const r4 = v => Math.round(v * 10000) / 10000;
  const shape = a => {
    if (!a.n) return { n: 0, hit_rate: null, up_rate: null, called_up: null, chance_rate: null, skill: null, brier: null };
    const h = a.hits / a.n, u = a.up / a.n, c = a.calledUp / a.n, ch = c * u + (1 - c) * (1 - u);
    return {
      n: a.n,
      hit_rate: r4(h),
      up_rate: r4(u),          // = what "always call up" hit
      called_up: r4(c),        // share of the brain's calls that said UP
      chance_rate: r4(ch),     // the same up/down mix assigned at random
      skill: r4(h - ch),
      brier: r4(a.brier / a.n)
    };
  };
  const rows = [...weeks.values()].sort((a, b) => a.week - b.week).map(w => Object.assign({ week: String(w.week) }, shape(w)));
  // A week still being graded (fewer than half the median week's calls) is marked partial and left out of the
  // tally: one graded day reads as a whole week otherwise.
  const ns = rows.map(r => r.n).sort((a, b) => a - b);
  const med = ns.length ? ns[Math.floor(ns.length / 2)] : 0;
  rows.forEach(r => { r.partial = r.n < 0.5 * med; });
  const full = rows.filter(r => !r.partial);
  // Only the fair bar: calling UP every time is a rule anyone could follow in advance. (Picking each week's
  // majority direction would need hindsight, so it is not reported.)
  const beatUp = full.filter(r => r.hit_rate > r.up_rate).length;
  const beatChance = full.filter(r => r.skill > 0).length;
  // Mean weekly skill over fully graded weeks, with its standard error across weeks (each week ~ one observation;
  // adjacent weeks' 5-day windows overlap a little, so the error is if anything understated).
  const sk = full.map(r => r.skill);
  const mean = sk.length ? sk.reduce((x, y) => x + y, 0) / sk.length : null;
  const se = sk.length > 1 ? Math.sqrt(sk.reduce((x, y) => x + (y - mean) ** 2, 0) / (sk.length - 1) / sk.length) : null;
  return { rows, total: Object.assign(shape(tot), { weeks: rows.length, full_weeks: full.length, weeks_beat_always_up: beatUp,
    weeks_beat_chance: beatChance, mean_weekly_skill: mean == null ? null : r4(mean), mean_weekly_skill_se: se == null ? null : r4(se) }) };
}

// Pass-332: the record by ET day, split into the two things a direction call can get right.
//   timing     - on days it calls more names UP, do more names rise? (correlation across days of the share it
//                called UP with the share that rose)
//   selection  - within one day, are the names it rates higher the ones that rose? (per day: the correlation of
//                predProb with "rose", and hit - chance for the day's own up/down mix; averaged over days)
//   one_sided  - days on which >= 90% (or <= 10%) of its calls point the same way: it is calling the market that
//                day, not choosing names.
// Days overlap (each call covers the next 5 sessions), so errors are taken across WEEK averages of the daily
// values, never across days. Calls logged before the journal carried a dayKey (May 2026) are counted as `undated`
// and left out, here and in recordByWeek.
export const DAY_MIN_CALLS = 20;
export function corr(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
function meanSe(vals) {
  if (!vals.length) return { mean: null, se: null, n: 0 };
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const se = vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1) / vals.length) : null;
  return { mean: m, se, n: vals.length };
}
export function recordByDay(journal) {
  const days = new Map();
  let undated = 0;
  for (const e of journal || []) {
    const o = gradedOutcome(e);
    if (!o || typeof e.predProb !== 'number' || !isFinite(e.predProb)) continue;
    const k = Number(e.dayKey);
    if (!(k > 19000101)) { undated++; continue; }
    const up = e.predProb >= 0.5, rose = (up && o === 'correct') || (!up && o === 'wrong');
    let d = days.get(k);
    if (!d) { d = { p: [], r: [], up: 0, hits: 0 }; days.set(k, d); }
    d.p.push(e.predProb); d.r.push(rose ? 1 : 0); if (up) d.up++; if (o === 'correct') d.hits++;
  }
  const r4 = v => (v == null ? null : Math.round(v * 10000) / 10000);
  const rows = [...days.entries()].sort((a, b) => a[0] - b[0]).map(([k, d]) => {
    const n = d.p.length, c = d.up / n, u = d.r.reduce((a, b) => a + b, 0) / n, h = d.hits / n, ch = c * u + (1 - c) * (1 - u);
    return { day: String(k), n, called_up: r4(c), up_rate: r4(u), hit_rate: r4(h), chance_rate: r4(ch), skill: r4(h - ch),
      rank_corr: r4(corr(d.p, d.r)), partial: n < DAY_MIN_CALLS };
  });
  const full = rows.filter(r => !r.partial);
  // Week averages of the daily values: adjacent days share most of their 5-day windows, weeks far less.
  const byWeek = key => {
    const w = new Map();
    full.forEach(r => { if (r[key] == null) return; const wk = weekOf(r.day); const a = w.get(wk) || []; a.push(r[key]); w.set(wk, a); });
    return [...w.values()].map(a => a.reduce((s, v) => s + v, 0) / a.length);
  };
  const sel = meanSe(byWeek('skill')), rc = meanSe(byWeek('rank_corr'));
  const wkUp = byWeek('called_up'), wkRose = byWeek('up_rate');
  return {
    rows,
    summary: {
      days: full.length, calls: full.reduce((a, r) => a + r.n, 0), undated, min_calls_per_day: DAY_MIN_CALLS,
      one_sided_days: full.filter(r => r.called_up >= 0.9 || r.called_up <= 0.1).length,
      timing_corr: r4(corr(full.map(r => r.called_up), full.map(r => r.up_rate))),
      timing_corr_weekly: r4(corr(wkUp, wkRose)), weeks: wkUp.length,
      selection_skill: r4(sel.mean), selection_skill_se: r4(sel.se), days_beat_chance: full.filter(r => r.skill > 0).length,
      rank_corr: r4(rc.mean), rank_corr_se: r4(rc.se)
    }
  };
}
