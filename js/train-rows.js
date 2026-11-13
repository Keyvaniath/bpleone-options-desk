/* ===========================================
   BPLEONE — TrainRows: the browser model's GRADED calls (audit 2026-11-13, pass 344)
   ---
   28 stats pages read localStorage 'bpleone_train_v1', which no module writes (the only writer was
   model-what-if's hand-labeled scenarios, removed in pass 341), so every visitor saw 0%, "F" grades,
   "0/0 wins" or blank tables. This module serves the rows those pages expect, from the real stores:
     a. 'bpleone_pred_journal_v1' (continuous-learner): calls resolved 'correct' / 'wrong'. y = 1 when
        the direction call was right; pnl = the realized return (%) in the called direction.
     b. 'bpleone_train_data_v1' (ModelStore) rows that are resolved FINDINGS (meta.id): y = the finding hit.
        Continuous rows there duplicate the journal and auto-trainer rows are history, not predictions:
        both are skipped.
   Legacy row shape: { ts, y, label, features, meta: { sym, setup, horizon, source }, sym, setup, pnl, predProb }.
   driftRate(rows): the share an "always long" call would have gotten right on the same calls - the honest
   bar for a hit rate (pass 299), never 50%.
   =========================================== */
(function () {
  if (typeof window === 'undefined') return;
  var JOURNAL_KEY = 'bpleone_pred_journal_v1';
  var TRAIN_DATA_KEY = 'bpleone_train_data_v1';

  function readArr(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function fromJournal(e) {
    if (!e || (e.outcome !== 'correct' && e.outcome !== 'wrong')) return null;
    // Pass 344: older brain-proof builds injected test calls ('test-' ids, priceSource TEST-INJECTION); never grade them.
    if ((e.id && String(e.id).indexOf('test-') === 0) || e.priceSource === 'TEST-INJECTION' || e.regime === 'test') return null;
    var y = e.outcome === 'correct' ? 1 : 0;
    var p = (typeof e.predProb === 'number' && isFinite(e.predProb)) ? e.predProb : null;
    var long = p == null ? null : p >= 0.5;
    var ret = (typeof e.realizedRet === 'number' && isFinite(e.realizedRet)) ? e.realizedRet : null;
    var horizon = e.resolved && e.resolved.mid ? 'mid' : 'short';
    var setup = e.setup || ('model-call' + (horizon === 'mid' ? '-5d' : '-1d'));
    return {
      id: e.id || ('j-' + e.ts + '-' + e.sym),
      ts: e.ts,
      y: y, label: y,
      features: e.features || null,
      sym: e.sym, setup: setup,
      meta: { sym: e.sym, setup: setup, horizon: horizon, source: 'journal', regime: e.regime || null },
      pnl: ret != null && long != null ? +(ret * 100 * (long ? 1 : -1)).toFixed(3) : null,
      ret: ret,
      predProb: p,
      direction: long == null ? null : (long ? 'long' : 'short')
    };
  }

  function fromTrainData(r) {
    if (!r || !r.meta || !r.meta.id) return null;
    if (r.meta.continuous || r.meta.historical || r.meta.autoTrained) return null;
    if (r.label !== 0 && r.label !== 1) return null;
    var sym = r.meta.sym || null;
    var setup = r.meta.setup || 'finding';
    return {
      id: r.meta.id,
      ts: r.ts,
      y: r.label, label: r.label,
      features: r.features || null,
      sym: sym, setup: setup,
      meta: { sym: sym, setup: setup, horizon: r.meta.horizon || null, source: 'finding', id: r.meta.id },
      pnl: typeof r.meta.pnl === 'number' && isFinite(r.meta.pnl) ? r.meta.pnl : null,
      ret: null,
      predProb: null,
      direction: null
    };
  }

  function load() {
    var out = [], seen = {};
    function add(row) {
      if (!row || !(row.ts > 0)) return;
      if (seen[row.id]) return;
      seen[row.id] = 1;
      out.push(row);
    }
    readArr(JOURNAL_KEY).forEach(function (e) { add(fromJournal(e)); });
    readArr(TRAIN_DATA_KEY).forEach(function (r) { add(fromTrainData(r)); });
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out;
  }

  // Share of the same calls an "always long" call would have gotten right (rows with a known return only).
  function driftRate(rows) {
    rows = rows || load();
    var n = 0, up = 0;
    rows.forEach(function (r) { if (typeof r.ret === 'number' && isFinite(r.ret) && r.ret !== 0) { n++; if (r.ret > 0) up++; } });
    return n ? up / n : null;
  }

  function hitRate(rows) {
    rows = rows || load();
    if (!rows.length) return null;
    var w = 0; rows.forEach(function (r) { if (r.y === 1) w++; });
    return w / rows.length;
  }

  // One honest line for a hit rate: n, the bar it is graded against, and whether the sample can be graded.
  //   { n, hit, drift, skillPp, enough, text }
  var MIN_N = 20;
  function grade(rows) {
    rows = rows || load();
    var n = rows.length, hit = hitRate(rows), drift = driftRate(rows);
    var bar = drift != null ? drift : 0.52;
    var skillPp = hit == null ? null : (hit - bar) * 100;
    var text;
    if (!n) text = 'No graded calls in this browser yet.';
    else if (n < MIN_N) text = n + ' graded call' + (n === 1 ? '' : 's') + ': too few to grade (needs ' + MIN_N + '+).';
    else text = 'Hit rate ' + (hit * 100).toFixed(1) + '% vs ' + (drift != null ? 'drift ' + (drift * 100).toFixed(1) + '%' : 'drift ~52%') +
      ' (n=' + n + '): skill ' + (skillPp >= 0 ? '+' : '') + skillPp.toFixed(1) + ' pp.';
    return { n: n, hit: hit, drift: drift, bar: bar, skillPp: skillPp, enough: n >= MIN_N, text: text };
  }

  var EMPTY_HTML = 'No graded calls in this browser yet. The browser model grades its own 5-day calls only while a tab is open; ' +
    'the desk’s live record is the <a href="edge-scorecard.html" style="color:var(--accent);">Edge Scorecard</a>.';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // Realized % move in the called direction (0 when unknown). Replaces the pages' old payoff assumption
  // (every win +1.5R, every loss -1R), which booked an invented reward:risk on every call.
  function ret(t) { return t && typeof t.pnl === 'number' && isFinite(t.pnl) ? t.pnl : 0; }

  window.TrainRows = {
    load: load,
    ret: ret,
    count: function () { return load().length; },
    driftRate: driftRate,
    hitRate: hitRate,
    grade: grade,
    MIN_N: MIN_N,
    EMPTY_HTML: EMPTY_HTML,
    esc: esc,
    _fromJournal: fromJournal,
    _fromTrainData: fromTrainData
  };
})();
