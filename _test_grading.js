// _test_grading.js — unit tests for worker/src/grading.js (pass-318: overlap-corrected flow grading,
// archive-before-rotation, sealed capture records). Run: node _test_grading.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'grading.js'), 'utf8')
  .replace(/^export (const|function|async function)/gm, '$1');
const names = ['OVERLAP_DAYS', 'overlapScore', 'splitForCap', 'monthOf', 'archiveBuckets', 'appendUnique', 'canonical',
  'sha256Hex', 'sealRecord', 'lastHash', 'verifyChain', 'windowOf', 'horizonStats'];
const G = new Function(src + '\nreturn {' + names.join(',') + '};')();

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }
const DAY = 86400000;

(async () => {
  // --- overlap correction: 10 daily same-name same-direction calls inside 9 days are ONE observation
  const t0 = Date.UTC(2026, 9, 1);
  const same = Array.from({ length: 10 }, (_, i) => ({ sym: 'NVDA', ts: t0 + i * DAY * 0.8, dir: 1, ret: 1 }));
  const s1 = G.overlapScore(same, e => e.dir, 0.5);
  ok(s1.n === 10 && s1.effective_n === 1, 'ten calls inside 7.2 days are one observation, got ' + s1.effective_n);
  const longer = Array.from({ length: 15 }, (_, i) => ({ sym: 'NVDA', ts: t0 + i * DAY * 0.8, dir: 1, ret: 1 }));
  ok(G.overlapScore(longer, e => e.dir, 0.5).effective_n === 2, 'a run longer than 9 days opens a second observation');
  // 10 calls spaced 10 days apart are independent
  const spaced = Array.from({ length: 10 }, (_, i) => ({ sym: 'NVDA', ts: t0 + i * 10 * DAY, dir: 1, ret: 1 }));
  ok(G.overlapScore(spaced, e => e.dir, 0.5).effective_n === 10, 'spaced calls are independent');
  // different names / directions are separate clusters
  const mixed = [{ sym: 'A', ts: t0, dir: 1, ret: 1 }, { sym: 'B', ts: t0, dir: 1, ret: 1 }, { sym: 'A', ts: t0, dir: -1, ret: -1 }];
  ok(G.overlapScore(mixed, e => e.dir, 0.5).effective_n === 3, 'sym and direction split clusters');
  // the correction shrinks z by sqrt(n_eff / n)
  const many = [];
  for (let k = 0; k < 40; k++) for (let i = 0; i < 5; i++) many.push({ sym: 'S' + k, ts: t0 + i * DAY, dir: 1, ret: (k % 3 === 0) ? -1 : 1 });
  const sm = G.overlapScore(many, e => e.dir, 0.5);
  ok(sm.n === 200 && sm.effective_n === 40, 'n 200 / n_eff 40');
  ok(Math.abs(sm.z_score_vs_drift - sm.z_score_vs_drift_raw * Math.sqrt(40 / 200)) < 0.02, 'z scaled by sqrt(n_eff/n)');
  // drift null: all-up calls in an all-up market get no credit
  const drifty = Array.from({ length: 30 }, (_, i) => ({ sym: 'X' + i, ts: t0, dir: 1, ret: 1 }));
  const sd = G.overlapScore(drifty, e => e.dir, 1.0);
  ok(sd.drift_null_rate === 1 && sd.beats_drift_95 === false, 'riding drift is not edge');
  // n_eff < 5 never beats drift
  const tiny = Array.from({ length: 20 }, (_, i) => ({ sym: 'T', ts: t0 + i * DAY * 0.3, dir: 1, ret: 1 }));
  ok(G.overlapScore(tiny, e => e.dir, 0.3).beats_drift_95 === false, 'n_eff < 5 cannot pass');
  // zero-direction calls are excluded
  ok(G.overlapScore([{ sym: 'Z', ts: t0, dir: 0, ret: 3 }], e => e.dir, 0.5).n === 0, 'dir 0 excluded');

  // --- retention: split keeps the newest, archives the oldest, never loses a record
  const log = Array.from({ length: 12 }, (_, i) => ({ dayKey: 20261001 + i, sym: 'A', ts: t0 + i * DAY }));
  const sp = G.splitForCap(log, 10);
  ok(sp.kept.length === 10 && sp.dropped.length === 2 && sp.dropped[0].dayKey === 20261001 && sp.kept[0].dayKey === 20261003, 'split oldest out');
  ok(G.splitForCap(log, 50).dropped.length === 0, 'under cap: nothing dropped');
  ok(sp.kept.length + sp.dropped.length === log.length, 'no record lost in split');
  ok(G.monthOf({ dayKey: 20261103 }) === '202611' && G.monthOf({ d: '2026-10-19' }) === '202610' && G.monthOf({ ts: Date.UTC(2026, 6, 4) }) === '202607', 'month keys');
  const b = G.archiveBuckets('flow', [{ dayKey: 20260930 }, { dayKey: 20261001 }, { dayKey: 20261002 }]);
  ok(Object.keys(b).sort().join(',') === 'archive_flow_202609,archive_flow_202610' && b.archive_flow_202610.length === 2, 'monthly buckets');
  const ap = G.appendUnique([{ dayKey: 1, sym: 'A', ts: 5 }], [{ dayKey: 1, sym: 'A', ts: 5 }, { dayKey: 2, sym: 'A', ts: 6 }]);
  ok(ap.length === 2, 'archive append is idempotent');

  // --- sealing: hash chain detects edits, deletions, reordering; outcome fields stay outside the seal
  ok(G.canonical({ b: 1, a: [2, { d: 1, c: 2 }] }) === '{"a":[2,{"c":2,"d":1}],"b":1}', 'canonical sorts keys');
  ok((await G.sha256Hex('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 known vector');
  let chain = [{ dayKey: 20261101, sym: 'OLD', ts: 1, entry: 10 }];   // legacy, unsealed
  for (let i = 0; i < 4; i++) chain.push(await G.sealRecord({ dayKey: 20261102 + i, sym: 'N' + i, ts: 10 + i, entry: 100 + i, flowDir: 1 }, G.lastHash(chain)));
  let v = await G.verifyChain(chain);
  ok(v.ok && v.sealed === 4 && v.legacy === 1, 'fresh chain verifies');
  chain[2].exit = 120; chain[2].ret = 5.5; chain[2].resolved = true; chain[2].exitTs = 99; chain[2].horizonDays = 7;
  ok((await G.verifyChain(chain)).ok, 'adding outcome fields does not break the seal');
  const tampered = chain.map(r => Object.assign({}, r)); tampered[3].entry = 1;
  ok(!(await G.verifyChain(tampered)).ok, 'editing a capture field is detected');
  const deleted = chain.filter((_, i) => i !== 2);
  ok(!(await G.verifyChain(deleted)).ok, 'deleting a sealed record is detected');
  const trimmed = chain.slice(2);   // head rotated into the archive: still verifies
  ok((await G.verifyChain(trimmed)).ok, 'head rotation (archive) does not break verification');

  // --- disclosure helpers
  const w = G.windowOf([{ dayKey: 20261020 }, { dayKey: 20260915 }, { d: '2026-11-02' }]);
  ok(w.first_day === '2026-09-15' && w.last_day === '2026-11-02' && w.records === 3, 'window of a rolling ledger');
  const hs = G.horizonStats([{ ts: 0, exitTs: 7 * DAY }, { ts: 0, exitTs: 9 * DAY }, { ts: 0, exitTs: 21 * DAY }, { ts: 0 }]);
  ok(hs.n === 3 && hs.median_days === 9 && hs.min_days === 7 && hs.max_days === 21, 'horizon stats');

  console.log(fails ? fails + ' grading test(s) FAILED' : 'grading: all tests passed');
  process.exit(fails ? 1 : 0);
})();
