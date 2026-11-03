// _test_bars.js — unit tests for worker/src/bars.js (pass-319: finalize stored daily bars against real daily OHLC).
// Run: node _test_bars.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'worker', 'src', 'bars.js'), 'utf8').replace(/^export (const|function)/gm, '$1');
const B = new Function(src + '\nreturn { etDayKey, reconcileBars, overlayToday };')();

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }

// Yahoo daily bars carry the session-open timestamp (13:30 / 14:30 UTC); dayKey is the ET date.
ok(B.etDayKey(Date.UTC(2026, 10, 2, 14, 30)) === 20261102, 'ET dayKey from a session timestamp');
ok(B.etDayKey(Date.UTC(2026, 10, 3, 3, 0)) === 20261102, '03:00 UTC is still the previous ET day');

// The 11/3 audit case: morning snapshots stored as full-day bars.
const hist = [
  { dayKey: 20261029, open: 768, high: 770.76, low: 767.06, close: 767.40, volume: 1 },
  { dayKey: 20261030, open: 760, high: 761.46, low: 759.93, close: 760.01, volume: 1 },
  { dayKey: 20261102, open: 759, high: 759.73, low: 759.10, close: 759.54, volume: 1 },
  { dayKey: 20261103, open: 753, high: 753.25, low: 752.41, close: 753.21, volume: 1 },
  { dayKey: 20261020, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }   // a day Yahoo does not return
];
const y = [
  { ts: Date.UTC(2026, 9, 29, 13, 30), open: 768.1, high: 770.76, low: 766.62, close: 769.36, volume: 9e7 },
  { ts: Date.UTC(2026, 9, 30, 13, 30), open: 760.5, high: 761.46, low: 750.36, close: 755.72, volume: 9e7 },
  { ts: Date.UTC(2026, 10, 2, 14, 30), open: 758.0, high: 763.86, low: 751.60, close: 752.10, volume: 9e7 },
  { ts: Date.UTC(2026, 10, 3, 14, 30), open: 753.0, high: 757.07, low: 752.41, close: 754.44, volume: 6e7 }
];
const copy = JSON.parse(JSON.stringify(hist));
let r = B.reconcileBars(copy, y, 20261103, false);
ok(r.changed === 3 && r.verified === 3, 'completed days reconciled, today skipped before the close: ' + JSON.stringify(r));
ok(copy[2].close === 752.10 && copy[2].high === 763.86 && copy[2].low === 751.60 && copy[2].fin === 1, '11/2 bar corrected and marked final');
ok(copy[3].close === 753.21 && !copy[3].fin, "today's bar untouched before the close");
ok(copy[4].close === 1.5 && !copy[4].fin, 'a day Yahoo lacks stays untouched and unmarked');
r = B.reconcileBars(copy, y, 20261103, true);
ok(copy[3].close === 754.44 && copy[3].fin === 1 && r.changed === 1, "after the close today's bar is finalized");
r = B.reconcileBars(copy, y, 20261103, true);
ok(r.changed === 0 && r.verified === 4, 'idempotent: a second pass changes nothing');
ok(B.reconcileBars(null, y, 0, true).verified === 0 && B.reconcileBars([], null, 0, true).verified === 0, 'bad input is a no-op');

// overlayToday: today's morning-snapshot bar served with the latest session quote
const today = { ts: Date.UTC(2026, 10, 3, 14, 31), o: 753, h: 753.25, l: 752.41, c: 753.21, v: 1e6, fin: 0 };
const qMid = { last: 754.44, dayHigh: 757.07, dayLow: 752.41, volume: 6e7, ts: Date.UTC(2026, 10, 3, 20, 0) };   // 3:00 PM ET
const o1 = B.overlayToday(today, qMid, 20261103);
ok(o1.c === 754.44 && o1.h === 757.07 && o1.l === 752.41 && o1.v === 6e7 && o1.live === 1 && today.c === 753.21, 'overlay widens H/L, sets close, does not mutate');
ok(B.overlayToday(today, Object.assign({}, qMid, { ts: Date.UTC(2026, 10, 3, 13, 0) }), 20261103) === today, 'pre-open quote (8:00 ET) is not overlaid');
ok(B.overlayToday(today, Object.assign({}, qMid, { ts: Date.UTC(2026, 10, 2, 20, 0) }), 20261103) === today, "yesterday's quote is not overlaid");
const yBar = Object.assign({}, today, { ts: Date.UTC(2026, 10, 2, 14, 31) });
ok(B.overlayToday(yBar, qMid, 20261103) === yBar, 'only today\'s bar is overlaid');
ok(B.overlayToday(today, null, 20261103) === today, 'no quote: unchanged');

console.log(fails ? fails + ' bars test(s) FAILED' : 'bars: all tests passed');
process.exit(fails ? 1 : 0);
