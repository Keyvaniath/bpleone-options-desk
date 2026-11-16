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
