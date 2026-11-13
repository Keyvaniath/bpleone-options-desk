// _test_train_rows.js — pass 344: 28 pages read localStorage 'bpleone_train_v1', which no module writes, so every
// visitor saw 0%, "F" grades or blank tables. js/train-rows.js serves the browser model's GRADED calls from the real
// stores (the continuous learner's prediction journal + resolved findings in ModelStore's training rows).
// Run: node _test_train_rows.js   (exits 1 on any failure)
const fs = require('fs');
const path = require('path');
let fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('FAIL: ' + m); } }

// --- load the module against a fake window + localStorage ---
const store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const window = {};
new Function('window', 'localStorage', fs.readFileSync(path.join(__dirname, 'js', 'train-rows.js'), 'utf8'))(window, localStorage);
const TR = window.TrainRows;
ok(TR && typeof TR.load === 'function' && typeof TR.driftRate === 'function' && typeof TR.count === 'function', 'module exports load / driftRate / count');

// --- empty stores ---
ok(TR.load().length === 0 && TR.count() === 0, 'no stores -> no rows');
ok(TR.driftRate([]) === null && TR.hitRate([]) === null, 'no rows -> drift and hit rate are null, never 0');
ok(/No graded calls/.test(TR.grade([]).text) && TR.grade([]).enough === false, 'empty grade says so');

// --- fixture journal (continuous-learner shape) ---
const day = 864e5, t0 = Date.parse('2026-11-02T15:00:00Z');
store.bpleone_pred_journal_v1 = JSON.stringify([
  { id: 'c-1', ts: t0, sym: 'AAPL', predProb: 0.62, outcome: 'correct', realizedRet: 0.021, resolved: { short: 'correct', mid: 'correct' } },  // long, right
  { id: 'c-2', ts: t0 + day, sym: 'NVDA', predProb: 0.40, outcome: 'correct', realizedRet: -0.030, resolved: { short: 'wrong', mid: 'correct' } }, // short, right
  { id: 'c-3', ts: t0 + 2 * day, sym: 'TSLA', predProb: 0.70, outcome: 'wrong', realizedRet: -0.015, resolved: { mid: 'wrong' } },               // long, wrong
  { id: 'c-4', ts: t0 + 3 * day, sym: 'MSFT', predProb: 0.55, outcome: 'flat', resolved: { mid: 'flat' } },                                       // flat: skipped
  { id: 'c-5', ts: t0 + 4 * day, sym: 'AMD', predProb: 0.58, resolved: { short: false, mid: false } },                                           // unresolved: skipped
  { id: 'c-1', ts: t0, sym: 'AAPL', predProb: 0.62, outcome: 'correct', realizedRet: 0.021, resolved: { mid: 'correct' } },                     // duplicate id
  { id: 'test-17', ts: t0 + 4 * day, sym: 'AAPL', predProb: 0.85, outcome: 'correct', priceSource: 'TEST-INJECTION', regime: 'test' }          // old brain-proof test call: skipped
]);
// --- fixture training rows (ModelStore shape) ---
store.bpleone_train_data_v1 = JSON.stringify([
  { ts: t0 + 5 * day, features: [0.1], label: 1, meta: { id: 'f_1', sym: 'META', setup: 'volume-breakout', dataSource: 'live' } },       // resolved finding: kept
  { ts: t0 + 5 * day, features: [0.1], label: 0, meta: { sym: 'AAPL', setup: 'continuous-AAPL', continuous: true, dataSource: 'live' } }, // duplicate of journal: skipped
  { ts: t0 + 5 * day, features: [0.1], label: 1, meta: { sym: 'SPY', setup: 'auto-train-x', historical: true, autoTrained: true } },     // history, not a call: skipped
  { ts: t0 + 5 * day, features: [0.1], label: 1, meta: { id: 'f_2', sym: 'QQQ', setup: 'x', continuous: true } }                         // continuous wins over id: skipped
]);
const rows = TR.load();
ok(rows.length === 4, 'keeps 3 graded journal calls + 1 resolved finding, drops flat/unresolved/duplicate/continuous/historical (got ' + rows.length + ')');
ok(rows[0].sym === 'META' && rows[rows.length - 1].sym === 'AAPL', 'newest first');
const by = s => rows.find(r => r.sym === s);
ok(by('AAPL').y === 1 && Math.abs(by('AAPL').pnl - 2.1) < 1e-9 && by('AAPL').direction === 'long', 'long call right: y=1, pnl +2.1%');
ok(by('NVDA').y === 1 && Math.abs(by('NVDA').pnl - 3.0) < 1e-9 && by('NVDA').direction === 'short', 'short call right: pnl is the move in the CALLED direction (+3.0% on a -3% stock)');
ok(by('TSLA').y === 0 && Math.abs(by('TSLA').pnl + 1.5) < 1e-9, 'long call wrong: y=0, pnl -1.5%');
ok(by('META').y === 1 && by('META').pnl === null && by('META').meta.source === 'finding' && by('META').meta.setup === 'volume-breakout', 'finding row: y = hit, no invented pnl');
ok(by('AAPL').meta.sym === 'AAPL' && by('AAPL').meta.source === 'journal' && by('AAPL').meta.horizon === 'mid', 'legacy meta shape (sym, setup, horizon, source)');
ok(by('AAPL').label === by('AAPL').y && Array.isArray(by('META').features), 'label mirrors y; features carried');

// --- drift rate: the share an always-long call got right on the same calls (rows with a known return) ---
// returns: +2.1%, -3.0%, -1.5% -> always-long right on 1 of 3
ok(Math.abs(TR.driftRate(rows) - 1 / 3) < 1e-9, 'driftRate = 1/3 (always long right only on AAPL)');
ok(Math.abs(TR.hitRate(rows) - 0.75) < 1e-9, 'hitRate = 3/4');
ok(TR.ret(by('NVDA')) === by('NVDA').pnl && TR.ret(by('META')) === 0, 'ret(): realized % or 0 when unknown (no assumed +1.5R)');
const g = TR.grade(rows);
ok(g.n === 4 && g.enough === false && /too few to grade/.test(g.text), 'below 20 calls: too few to grade');
const many = Array.from({ length: 25 }, (_, i) => ({ y: i < 15 ? 1 : 0, ret: i < 20 ? 0.01 : -0.01 }));
const g2 = TR.grade(many);
ok(g2.enough && Math.abs(g2.drift - 0.8) < 1e-9 && Math.abs(g2.skillPp - (0.6 - 0.8) * 100) < 1e-9 && /vs drift 80\.0%/.test(g2.text), 'graded against drift (60% right vs 80% always-long = -20 pp), never 50%');
ok(TR.esc('<b x="1">&') === '&lt;b x=&quot;1&quot;&gt;&amp;', 'escaper');

// --- pages: nothing reads the dead key any more (comments excepted) ---
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1').replace(/<!--[\s\S]*?-->/g, '');
const pages = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'));
const readers = pages.filter(f => /bpleone_train_v1/.test(strip(fs.readFileSync(path.join(__dirname, f), 'utf8'))));
ok(readers.length === 0, 'no page reads bpleone_train_v1 (found: ' + readers.join(', ') + ')');
const users = pages.filter(f => /TrainRows\./.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
const unloaded = users.filter(f => !/<script src="js\/train-rows\.js\?v=v\d+"><\/script>/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
ok(users.length >= 20 && unloaded.length === 0, 'every page using TrainRows loads js/train-rows.js (' + users.length + ' pages; missing: ' + unloaded.join(', ') + ')');
// no letter grades at coin-flip cutoffs on a hit rate in the converted pages
const gradeIdiom = /(hit|hitRate|endHit)\s*>=\s*0\.7\s*\?\s*'A'/;
const graders = users.filter(f => gradeIdiom.test(strip(fs.readFileSync(path.join(__dirname, f), 'utf8'))));
ok(graders.length === 0, 'no A-F grade at 50/60/70% on a hit rate (found: ' + graders.join(', ') + ')');
const r15 = users.filter(f => /\|\|\s*1\.5\)/.test(strip(fs.readFileSync(path.join(__dirname, f), 'utf8'))));
ok(r15.length === 0, 'no assumed +1.5R payoff per win (found: ' + r15.join(', ') + ')');
// data stores, not graded calls: these read ModelStore's training rows directly
['data-truth.html', 'brain-health.html', 'brain-monitor.html', 'brain-changelog.html'].forEach(f =>
  ok(/bpleone_train_data_v1/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')), f + ' reads the real training-row store'));
// pick-style pages that rank browser-model findings carry the NO PLAY gate
const gate = fs.readFileSync(path.join(__dirname, 'js', 'no-play-gate.js'), 'utf8');
['brain-pulse', 'brain-hub', 'brain-snapshot', 'mobile-dashboard', 'brain-tldr'].forEach(pg => {
  ok(new RegExp("'" + pg + "':").test(gate), pg + ' is in the NO PLAY gate page list');
  ok(/js\/no-play-gate\.js\?v=v\d+" defer/.test(fs.readFileSync(path.join(__dirname, pg + '.html'), 'utf8')), pg + ' loads js/no-play-gate.js');
});
ok(/f\.ts >= today0\.getTime\(\) && f\.meta && f\.meta\.sym/.test(fs.readFileSync(path.join(__dirname, 'brain-pulse.html'), 'utf8')), 'brain-pulse ranks only findings that name a symbol (no "undefined" pick)');
ok(/replace\(\/\[\^A-Z0-9\.\\-\]\/g, ''\)\.slice\(0, 8\)/.test(fs.readFileSync(path.join(__dirname, 'symbol-brain.html'), 'utf8')), 'symbol-brain strict-sanitizes ?sym= before innerHTML');

console.log(fails ? fails + ' train-rows test(s) FAILED' : 'train-rows: all tests passed');
process.exit(fails ? 1 : 0);
