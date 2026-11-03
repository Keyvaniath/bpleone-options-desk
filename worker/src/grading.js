// grading.js — shared, pure helpers for the worker's forward-test ledgers (audit 2026-11-03, pass-318).
// The cron I/O lives in index.js; everything here is deterministic and unit-tested (_test_grading.js).
//
// Three jobs:
//  1. overlapScore: directional calls graded against the market-drift null WITH the overlap correction.
//     Daily calls on 5-day windows are not independent; same-(sym, dir) calls within OVERLAP_DAYS count
//     as one observation and z is scaled by sqrt(n_eff / n). /brain/confluence-score has used this since
//     pass 306; /brain/flow-score did not until pass-318.
//  2. Retention: the ledgers are capped (KV value size). splitForCap + archiveBuckets move the records a
//     cap would drop into append-only monthly archive keys instead of deleting them.
//  3. Sealing: each new capture record carries a sha256 over its capture fields plus the previous record's
//     hash (a hash chain), so a later edit or deletion of a capture is detectable. Outcome fields (exit,
//     ret, ...) are appended after capture and are deliberately outside the seal.

export const OVERLAP_DAYS = 9;
export const OUTCOME_FIELDS = ['exit', 'ret', 'resolved', 'exitTs', 'exitSrc', 'horizonDays', 'hash'];

export function overlapScore(entries, dirFn, driftUp) {
  const calls = entries.map(e => ({ dir: dirFn(e), ret: e.ret, sym: e.sym || '?', ts: e.ts || 0 })).filter(c => c.dir !== 0);
  const n = calls.length;
  const hits = calls.filter(c => (c.dir > 0 && c.ret > 0) || (c.dir < 0 && c.ret < 0)).length;
  const avgDirRet = n ? calls.reduce((a, c) => a + c.ret * c.dir, 0) / n : null;
  let nullHits = 0;
  calls.forEach(c => { nullHits += (c.dir > 0 ? driftUp : (1 - driftUp)); });
  const p0 = n ? nullHits / n : 0.5;
  const lastCounted = {};
  let nEff = 0;
  calls.slice().sort((a, b) => a.ts - b.ts).forEach(c => {
    const key = c.sym + ':' + (c.dir > 0 ? 'U' : 'D');
    if (!(key in lastCounted) || (c.ts - lastCounted[key]) >= OVERLAP_DAYS * 86400000) { nEff++; lastCounted[key] = c.ts; }
  });
  const shrink = n > 0 ? Math.sqrt(nEff / n) : 1;
  const zRaw = (n >= 5 && p0 > 0 && p0 < 1) ? (hits - n * p0) / Math.sqrt(n * p0 * (1 - p0)) : null;
  const z = zRaw != null ? zRaw * shrink : null;
  return {
    n, hits,
    effective_n: nEff,
    hit_rate: n ? +(hits / n).toFixed(4) : null,
    drift_null_rate: +p0.toFixed(4),
    avg_directional_ret_pct: avgDirRet != null ? +avgDirRet.toFixed(3) : null,
    profitable: avgDirRet != null && avgDirRet > 0,
    z_score_vs_drift: z != null ? +z.toFixed(2) : null,          // overlap-corrected
    z_score_vs_drift_raw: zRaw != null ? +zRaw.toFixed(2) : null, // pre-correction, for transparency
    beats_drift_95: z != null && nEff >= 5 && z > 1.64
  };
}

// Split a capped log: the newest `cap` records stay, the older ones go to the archive.
export function splitForCap(log, cap) {
  if (!Array.isArray(log) || log.length <= cap) return { kept: log || [], dropped: [] };
  return { kept: log.slice(-cap), dropped: log.slice(0, log.length - cap) };
}

// Monthly archive keys: archive_<name>_<YYYYMM>. Month from dayKey (YYYYMMDD number, or radar's 'YYYY-MM-DD'
// in r.d) or, failing that, from ts.
export function monthOf(rec) {
  if (rec && typeof rec.dayKey === 'number' && rec.dayKey > 19000000) return String(Math.floor(rec.dayKey / 100));
  if (rec && typeof rec.d === 'string' && /^\d{4}-\d{2}/.test(rec.d)) return rec.d.slice(0, 4) + rec.d.slice(5, 7);
  const t = rec && (rec.ts || rec.t);
  if (t) { const d = new Date(t); return String(d.getUTCFullYear() * 100 + d.getUTCMonth() + 1); }
  return 'unknown';
}
export function archiveBuckets(name, dropped) {
  const out = {};
  (dropped || []).forEach(r => { const k = 'archive_' + name + '_' + monthOf(r); (out[k] = out[k] || []).push(r); });
  return out;
}
// Append without duplicating a record that an earlier, interrupted archive pass already wrote.
export function appendUnique(existing, add) {
  const key = r => r.hash || JSON.stringify([r.dayKey || r.d, r.sym || r.s, r.ts || r.t]);
  const seen = new Set((existing || []).map(key));
  const out = (existing || []).slice();
  (add || []).forEach(r => { const k = key(r); if (!seen.has(k)) { seen.add(k); out.push(r); } });
  return out;
}

// Canonical JSON: sorted keys, so the hash does not depend on property order.
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function captureFields(rec) {
  const o = {};
  Object.keys(rec).forEach(k => { if (OUTCOME_FIELDS.indexOf(k) < 0) o[k] = rec[k]; });
  return o;
}
// Seal a capture record: rec.prev = previous record's hash, rec.hash = sha256(canonical(capture fields incl. prev)).
export async function sealRecord(rec, prevHash) {
  const body = Object.assign({}, rec, { prev: prevHash || null });
  delete body.hash;
  body.hash = await sha256Hex(canonical(captureFields(body)));
  return body;
}
export function lastHash(log) {
  for (let i = (log || []).length - 1; i >= 0; i--) if (log[i] && log[i].hash) return log[i].hash;
  return null;
}
// Verify the sealed records of a log. Unsealed (legacy) records are counted, not failed. The first sealed
// record's prev may point at a record already archived, so only links between adjacent sealed records
// present in this log are checked.
export async function verifyChain(log) {
  let sealed = 0, legacy = 0, prev = undefined;
  const broken = [];
  for (const r of (log || [])) {
    if (!r || !r.hash) { legacy++; continue; }
    sealed++;
    const h = await sha256Hex(canonical(captureFields(r)));
    if (h !== r.hash) broken.push({ hash: r.hash, why: 'content changed after capture' });
    else if (prev !== undefined && r.prev !== prev) broken.push({ hash: r.hash, why: 'chain link does not match the previous sealed record' });
    prev = r.hash;
  }
  return { sealed, legacy, verified: sealed - broken.length, broken: broken.slice(0, 20), ok: broken.length === 0 };
}

// What window a capped ledger actually covers (it is rolling once the cap binds).
export function windowOf(log) {
  const days = (log || []).map(r => r && (r.dayKey || (r.d ? +r.d.replace(/-/g, '') : null))).filter(Boolean).sort((a, b) => a - b);
  const fmt = k => { const s = String(k); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); };
  return { records: (log || []).length, first_day: days.length ? fmt(days[0]) : null, last_day: days.length ? fmt(days[days.length - 1]) : null };
}

// Calendar days between capture and exit for resolved records that recorded exitTs.
export function horizonStats(resolved) {
  const h = (resolved || []).filter(r => r && r.exitTs && r.ts != null).map(r => (r.exitTs - r.ts) / 86400000).sort((a, b) => a - b);
  if (!h.length) return { n: 0, median_days: null, min_days: null, max_days: null };
  const r1 = x => Math.round(x * 10) / 10;
  return { n: h.length, median_days: r1(h[Math.floor(h.length / 2)]), min_days: r1(h[0]), max_days: r1(h[h.length - 1]) };
}
