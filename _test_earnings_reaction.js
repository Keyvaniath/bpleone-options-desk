// _test_earnings_reaction.js — pass 343: earnings-playbook measures past reactions around the REAL report date.
// It used /stock/earnings `period` (the fiscal quarter END) as the report date, so every "past post-earnings move"
// was a price change around quarter end. Extracts analyzeSymbol() from the page and checks the timing rules.
// Run: node _test_earnings_reaction.js   (exits 1 on any failure)
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync(__dirname + '/earnings-playbook.html', 'utf8').replace(/\r\n/g, '\n');   // the page has CRLF line endings
const start = html.indexOf('  function analyzeSymbol(');
const end = html.indexOf('\n  }\n', start) + 4;
const src = html.slice(start, end);
const ctx = { Intl, Date, Math, Number };
vm.createContext(ctx);
vm.runInContext(src + '\n;this.analyzeSymbol = analyzeSymbol;', ctx);
let fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('FAIL: ' + m); } }

// Daily closes, one per ET session at 9:30 ET (14:30 UTC), as /brain/history serves them (t in ms).
const day = d => Date.parse(d + 'T14:30:00Z');
const closes = [
  ['2026-07-28', 100], ['2026-07-29', 102], ['2026-07-30', 110], ['2026-07-31', 109],   // amc report 7/29 -> 7/30 reaction
  ['2026-10-20', 200], ['2026-10-21', 190], ['2026-10-22', 191],                       // bmo report 10/21 -> 10/21 reaction
  ['2026-09-29', 50], ['2026-09-30', 51], ['2026-10-01', 49]                           // quarter END 9/30 (not a report)
].map(([d, c]) => ({ t: day(d), c }));
closes.sort((a, b) => a.t - b.t);

const hist = [
  { date: '2026-10-21', hour: 'bmo' },
  { date: '2026-07-29', hour: 'amc' },
];
const a = ctx.analyzeSymbol('XYZ', '2027-01-20', hist, closes, null);
ok(a.n === 2, 'two reactions measured (got ' + a.n + ')');
ok(Math.abs(a.pastMoves[0] - (190 / 200 - 1) * 100) < 0.01, 'bmo: report-day close vs prior close (got ' + a.pastMoves[0] + ')');
ok(Math.abs(a.pastMoves[1] - (110 / 102 - 1) * 100) < 0.01, 'amc: next-session close vs report-day close (got ' + a.pastMoves[1] + ')');

// Timing not stated: the next session's close vs the prior session's close.
const b = ctx.analyzeSymbol('XYZ', '2027-01-20', [{ date: '2026-07-29', hour: '' }], closes, null);
ok(b.n === 1 && Math.abs(b.pastMoves[0] - (110 / 100 - 1) * 100) < 0.01, 'unstated timing spans both sessions (got ' + b.pastMoves + ')');

// A date with no session in the history is skipped, never approximated from a nearby bar.
const c = ctx.analyzeSymbol('XYZ', '2027-01-20', [{ date: '2026-08-15', hour: 'amc' }], closes, null);
ok(c.n === 0, 'a report date with no session is skipped (got ' + c.n + ')');
ok(!/e\.period/.test(src), 'the fiscal period is never used as a report date');

console.log(fails ? fails + ' earnings-reaction test(s) FAILED' : 'earnings reaction: all tests passed');
process.exit(fails ? 1 : 0);
