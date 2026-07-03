/* ===========================================
   BPLEONE - Earnings Call LLM engine
   ---
   Reads an earnings-call transcript and returns a structured
   bullish / bearish read via Claude (browser-direct, through AIClient).

   "Self-training" here is honest about what a browser can do: we do NOT
   fine-tune model weights. Instead every analysis is journaled to
   localStorage, Brandon labels it (his own score, standing rules, and the
   realized post-call move), and those labels are compiled into a CALIBRATION
   PROFILE that is injected into the system prompt on every future analysis.
   The model's reads converge toward Brandon's style and toward what actually
   happened. This mirrors the desk's capture -> resolve -> improve loop, but
   for a qualitative LLM read instead of the logistic brain.

   Storage:
     bpleone_earnings_llm_v1        -> array of records (the training set)
     bpleone_earnings_llm_rules_v1  -> array of standing-rule strings

   Exposes window.EarningsLLM:
     analyze({ticker, quarter, transcript})  -> Promise<read>
     getRecords / saveRecord / updateRecord / deleteRecord / clearAll
     getRules / setRules
     buildCalibrationProfile()  -> string injected into the prompt
     stats()  -> scoreboard numbers
     gradeOutcomeAuto(sym, callDateISO, horizonDays) -> Promise<outcome|null>
     SCORE_BANDS, scoreColor, stanceForScore
   =========================================== */

(function () {
  var REC_KEY = 'bpleone_earnings_llm_v1';
  var RULES_KEY = 'bpleone_earnings_llm_rules_v1';
  var WORKER = 'https://bpleone-brain-worker.brandonpleone.workers.dev';
  var MODEL = 'claude-opus-4-8';

  // ---- score -> stance band + color (kept in sync with the schema enum) ----
  var SCORE_BANDS = [
    { min: 3,  stance: 'Bullish',      color: 'var(--green)' },
    { min: 1,  stance: 'Lean Bullish', color: 'var(--green)' },
    { min: 0,  stance: 'Neutral',      color: 'var(--yellow)' },
    { min: -2, stance: 'Lean Bearish', color: 'var(--red)' },
    { min: -5, stance: 'Bearish',      color: 'var(--red)' }
  ];
  function stanceForScore(s) {
    s = Number(s) || 0;
    if (s >= 3) return 'Bullish';
    if (s >= 1) return 'Lean Bullish';
    if (s === 0) return 'Neutral';
    if (s >= -2) return 'Lean Bearish';
    return 'Bearish';
  }
  function scoreColor(s) {
    s = Number(s) || 0;
    if (s >= 1) return 'var(--green)';
    if (s <= -1) return 'var(--red)';
    return 'var(--yellow)';
  }

  // ---- the structured-output JSON schema Claude must fill ----
  // additionalProperties:false on every object + all props required
  // (structured-outputs requirement). No numeric/length constraints allowed,
  // so the score is constrained via an integer enum instead of min/max.
  var SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      stance: { type: 'string', enum: ['Bullish', 'Lean Bullish', 'Neutral', 'Lean Bearish', 'Bearish'] },
      score: { type: 'integer', enum: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5] },
      conviction: { type: 'string', enum: ['Low', 'Medium', 'High'] },
      headline: { type: 'string' },
      rating: { type: 'string', enum: ['Overweight', 'Neutral', 'Underweight'] },
      summary: { type: 'string' },
      bull_points: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { point: { type: 'string' }, quote: { type: 'string' } },
          required: ['point', 'quote']
        }
      },
      bear_points: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { point: { type: 'string' }, quote: { type: 'string' } },
          required: ['point', 'quote']
        }
      },
      guidance_vs_expectations: { type: 'string', enum: ['Raised / Above', 'In-line', 'Lowered / Below', 'No clear guidance'] },
      guidance_detail: { type: 'string' },
      tone_shift: { type: 'string' },
      key_metrics: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { metric: { type: 'string' }, value: { type: 'string' }, read: { type: 'string' } },
          required: ['metric', 'value', 'read']
        }
      },
      risks: { type: 'array', items: { type: 'string' } },
      trade_implication: { type: 'string' },
      confidence_caveats: { type: 'string' }
    },
    required: ['stance', 'score', 'conviction', 'headline', 'rating', 'summary', 'bull_points', 'bear_points',
      'guidance_vs_expectations', 'guidance_detail', 'tone_shift', 'key_metrics',
      'risks', 'trade_implication', 'confidence_caveats']
  };

  // Plain-text shape used by the fallback path (when the API rejects the
  // structured-output schema, we ask for this JSON shape in the prompt instead).
  var SHAPE_HINT = [
    '{',
    '  "stance": "Bullish|Lean Bullish|Neutral|Lean Bearish|Bearish",',
    '  "score": integer from -5 to 5,',
    '  "conviction": "Low|Medium|High",',
    '  "headline": "one-line thesis an MD reads first",',
    '  "rating": "Overweight|Neutral|Underweight (call-driven read-through on the stock)",',
    '  "summary": "2-4 sentence overall read",',
    '  "bull_points": [ { "point": "...", "quote": "verbatim from transcript" } ],',
    '  "bear_points": [ { "point": "...", "quote": "verbatim from transcript" } ],',
    '  "guidance_vs_expectations": "Raised / Above|In-line|Lowered / Below|No clear guidance",',
    '  "guidance_detail": "...",',
    '  "tone_shift": "how management tone changed vs the prior quarter",',
    '  "key_metrics": [ { "metric": "...", "value": "...", "read": "bullish/bearish/neutral and why" } ],',
    '  "risks": [ "..." ],',
    '  "trade_implication": "near-term move plus options angle",',
    '  "confidence_caveats": "..."',
    '}'
  ].join('\n');

  // ---------------- storage ----------------
  function getRecords() {
    try { return JSON.parse(localStorage.getItem(REC_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeRecords(arr) {
    try { localStorage.setItem(REC_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function saveRecord(rec) {
    var arr = getRecords();
    arr.unshift(rec);
    writeRecords(arr);
    return rec;
  }
  function updateRecord(id, patch) {
    var arr = getRecords();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) { arr[i] = Object.assign({}, arr[i], patch); break; }
    }
    writeRecords(arr);
  }
  function deleteRecord(id) {
    writeRecords(getRecords().filter(function (r) { return r.id !== id; }));
  }
  function clearAll() { writeRecords([]); }

  function getRules() {
    try { return JSON.parse(localStorage.getItem(RULES_KEY) || '[]'); } catch (e) { return []; }
  }
  function setRules(arr) {
    try { localStorage.setItem(RULES_KEY, JSON.stringify(arr || [])); } catch (e) {}
  }

  function newId() {
    return 'e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  // ---------------- self-training: calibration profile ----------------
  // Compiles Brandon's accumulated labels into a prompt block so the model
  // aligns future reads to his scoring tendency, his standing rules, and what
  // the stock actually did after similar calls.
  function buildCalibrationProfile(ticker) {
    var recs = getRecords();
    var labeled = recs.filter(function (r) {
      return r.feedback && (r.feedback.brandonScore !== null && r.feedback.brandonScore !== undefined);
    });
    var rules = getRules().filter(function (s) { return s && s.trim(); });

    var lines = [];

    if (!labeled.length && !rules.length) {
      return 'CALIBRATION FROM BRANDON: none yet. Use your own base judgment; he will start labeling these reads to teach you his style.';
    }

    lines.push('CALIBRATION FROM BRANDON\'S PAST LABELS - align your read to these:');

    // 1) systematic scoring bias (his score minus the model score)
    var deltas = labeled
      .filter(function (r) { return r.read && typeof r.read.score === 'number'; })
      .map(function (r) { return r.feedback.brandonScore - r.read.score; });
    if (deltas.length >= 3) {
      var bias = deltas.reduce(function (a, b) { return a + b; }, 0) / deltas.length;
      var b1 = Math.round(bias * 10) / 10;
      if (Math.abs(b1) >= 0.5) {
        lines.push('- Bias: across ' + deltas.length + ' labeled calls, Brandon scores on average ' +
          Math.abs(b1) + ' points more ' + (b1 > 0 ? 'BULLISH' : 'BEARISH') +
          ' than your raw read. Nudge your score in that direction unless the transcript clearly says otherwise.');
      }
    }

    // 2) outcome track record (did the directional read play out?)
    var graded = labeled.filter(function (r) {
      return r.outcome && (r.outcome.direction === 'up' || r.outcome.direction === 'down') && r.read && r.read.score !== 0;
    });
    if (graded.length >= 3) {
      var hits = graded.filter(function (r) {
        var dir = r.read.score > 0 ? 'up' : 'down';
        return dir === r.outcome.direction;
      }).length;
      lines.push('- Realized hit-rate: directional reads matched the 5-day move on ' + hits + ' of ' +
        graded.length + ' graded calls. If that is weak, be more skeptical of consensus-sounding optimism.');
    }

    // 3) standing rules
    if (rules.length) {
      lines.push('- Standing rules from Brandon (always apply):');
      rules.slice(0, 12).forEach(function (s) { lines.push('  * ' + s.trim()); });
    }

    // 4) few-shot exemplars: same ticker first, then most recent labeled
    var pool = labeled.slice();
    pool.sort(function (a, b) {
      var at = (ticker && a.ticker === ticker) ? 1 : 0;
      var bt = (ticker && b.ticker === ticker) ? 1 : 0;
      if (at !== bt) return bt - at;
      return (b.ts || '').localeCompare(a.ts || '');
    });
    var shots = pool.slice(0, 4);
    if (shots.length) {
      lines.push('- Examples of how Brandon graded recent calls:');
      shots.forEach(function (r) {
        var parts = [];
        parts.push((r.ticker || '?') + ' ' + (r.quarter || ''));
        parts.push('you read ' + (r.read ? r.read.score : '?') + ', Brandon scored ' + r.feedback.brandonScore);
        if (r.read && r.read.guidance_vs_expectations) parts.push('guidance ' + r.read.guidance_vs_expectations);
        if (r.outcome && typeof r.outcome.move5d === 'number') parts.push('stock then moved ' + r.outcome.move5d + '% over ~5d');
        if (r.feedback && r.feedback.notes && r.feedback.notes.trim()) parts.push('note: "' + r.feedback.notes.trim().slice(0, 160) + '"');
        lines.push('  * ' + parts.join('; '));
      });
    }

    return lines.join('\n');
  }

  // ---------------- system prompt ----------------
  function buildSystemPrompt(ticker, quarter) {
    var calibration = buildCalibrationProfile(ticker);
    return [
      'You are a senior sell-side equity research analyst writing a post-print note-flash on an earnings call for an institutional audience - portfolio managers and the trading desk. Your read must be sharp, numbers-first, and defensible: the standard of a Goldman Sachs or Morgan Stanley analyst note. No filler, no hedging, no generic boilerplate, no restating the obvious.',
      'The end reader, Brandon, runs high-beta tech / AI / semis / quantum exposure and trades the 1-5 day post-call reaction with options, so guidance-versus-consensus and the IV-crush setup are what matter most to him.',
      '',
      'DELIVERABLES - fill every field to that standard:',
      '  headline: ONE punchy sentence an MD reads first - the thesis of this print. E.g. "Guidance blows past the Street on AI DRAM; gross-margin trough the only debate - stay constructive into the next print."',
      '  rating: your read-through stance on the STOCK from THIS call - Overweight, Neutral, or Underweight. This is a call-driven near-term view, not a 12-month price-target rating; keep it honest to that scope.',
      '  score (-5..+5) and stance: the quantitative version of the same view. +5/+4 strongly bullish, +3/+2 bullish, +1 lean, 0 mixed, down to -4/-5 strongly bearish. Keep rating, stance and score directionally consistent.',
      '',
      'ANALYTICAL PRIORITY - weight in this order, because it is what actually moves the stock:',
      '  1. GUIDANCE vs consensus/expectations - the single biggest driver. Quantify the beat / miss / raise wherever the transcript gives you the figures.',
      '  2. Management TONE and credibility shift vs the prior quarter - confidence, hedging, changed language, what they stopped saying.',
      '  3. Demand / backlog / bookings commentary. For AI / semis / hardware names, weight data-center and AI-capex signals heavily.',
      '  4. Margins and mix; capital allocation (discount buyback hype - judge the real signal, not the optics).',
      '  5. Sector read-through: what this print implies for peers and the group - Brandon trades the sector, not just the name.',
      '',
      'RIGOR - non-negotiable, this is what makes the note credible:',
      '  - Quote VERBATIM from the transcript for every bull and bear point. Never invent or paraphrase a quote.',
      '  - Never state a number that is not in the transcript. If consensus is not provided, reason qualitatively and say so - do NOT fabricate a Street estimate.',
      '  - key_metrics: pull the figures management actually cited (revenue, growth, margin, segment, the guide) each with a one-line beat / miss / neutral read.',
      '  - trade_implication: likely direction and rough magnitude of the near-term move, plus the options angle - IV-crush risk, long premium vs spreads vs waiting for the dust to settle.',
      '  - If the transcript is partial, prepared-remarks-only, or missing Q&A, lower conviction and say exactly why in confidence_caveats.',
      '',
      calibration,
      '',
      'Context: ' + (ticker || 'n/a') + ' ' + (quarter || 'n/a') + '. Return only the structured fields - this is a note, not an essay.'
    ].join('\n');
  }

  // ---------------- the analysis call ----------------
  // Primary path constrains output with the JSON schema (structured outputs).
  // If the API rejects output_config or the reply is unparseable, retry once
  // prompt-only (JSON shape described in the system prompt) so the tool still
  // works. A safety refusal is surfaced, not retried.
  function analyze(input) {
    input = input || {};
    var ticker = (input.ticker || '').toUpperCase().trim();
    var quarter = (input.quarter || '').trim();
    var transcript = (input.transcript || '').trim();

    if (typeof AIClient === 'undefined' || !AIClient.isReady()) {
      return Promise.reject(new Error('Claude is not configured. Add your API key in Settings to enable the analyzer.'));
    }
    if (transcript.length < 200) {
      return Promise.reject(new Error('Paste a fuller transcript - this looks too short to analyze.'));
    }

    var system = buildSystemPrompt(ticker, quarter);
    var userMsg = 'Analyze the following earnings-call transcript for ' + (ticker || 'the company') +
      ' (' + (quarter || 'period unknown') + ') and return the structured read.\n\n=== TRANSCRIPT START ===\n' +
      transcript + '\n=== TRANSCRIPT END ===';

    function callOnce(useStructured) {
      var opts = { system: system, model: MODEL, maxTokens: 8000 };
      if (useStructured) {
        opts.output_config = { format: { type: 'json_schema', schema: SCHEMA } };
      } else {
        opts.system = system + '\n\nOUTPUT FORMAT: respond with ONLY a single JSON object, no prose and no code fences, matching exactly this shape:\n' + SHAPE_HINT;
      }
      return AIClient.chat([{ role: 'user', content: userMsg }], opts).then(function (resp) {
        if (resp.stop_reason === 'refusal') throw new Error('__refusal__');
        var read = parseRead(resp.text);
        if (!read) throw new Error('__unparseable__');
        read._model = resp.model || MODEL;
        read._usage = resp.usage || null;
        return read;
      });
    }

    return callOnce(true).catch(function (err) {
      if (err && err.message === '__refusal__') throw new Error('The model declined to analyze this text.');
      // structured path failed (output_config rejected or unparseable) - retry prompt-only
      return callOnce(false).catch(function (err2) {
        if (err2 && err2.message === '__refusal__') throw new Error('The model declined to analyze this text.');
        var m = (err2 && err2.message) || String(err2);
        if (m === '__unparseable__') m = 'could not parse a structured read from the response';
        throw new Error('Analysis failed: ' + m);
      });
    });
  }

  function parseRead(text) {
    if (!text) return null;
    var obj = null;
    try { obj = JSON.parse(text); } catch (e) {
      var m = text.match(/\{[\s\S]*\}/);
      if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { obj = null; } }
    }
    if (!obj || typeof obj !== 'object') return null;
    // defensive normalization
    obj.score = Math.max(-5, Math.min(5, Math.round(Number(obj.score) || 0)));
    if (!obj.stance) obj.stance = stanceForScore(obj.score);
    obj.bull_points = Array.isArray(obj.bull_points) ? obj.bull_points : [];
    obj.bear_points = Array.isArray(obj.bear_points) ? obj.bear_points : [];
    obj.key_metrics = Array.isArray(obj.key_metrics) ? obj.key_metrics : [];
    obj.risks = Array.isArray(obj.risks) ? obj.risks : [];
    obj.conviction = obj.conviction || 'Medium';
    obj.rating = obj.rating || (obj.score > 0 ? 'Overweight' : (obj.score < 0 ? 'Underweight' : 'Neutral'));
    obj.headline = obj.headline || obj.summary || '';
    return obj;
  }

  // ---------------- outcome grading (best-effort, off the worker bars) ----------------
  // Computes the ~5-trading-day move starting the first session on/after the
  // call date. Returns null on any problem (off-universe symbol, too old,
  // worker down) so the UI falls back to manual entry. Never throws.
  function gradeOutcomeAuto(sym, callDateISO, horizonDays) {
    sym = (sym || '').toUpperCase().trim();
    horizonDays = horizonDays || 5;
    var callMs = new Date(callDateISO).getTime();
    return fetch(WORKER + '/brain/bars?syms=' + encodeURIComponent(sym) + '&days=40')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return null;
        var bars = data[sym] || (data.bars && data.bars[sym]) || (data.data && data.data[sym]) || null;
        if (!Array.isArray(bars) || bars.length < horizonDays + 1) return null;
        bars = bars.slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        var i = -1;
        for (var k = 0; k < bars.length; k++) {
          if ((bars[k].ts || 0) >= callMs) { i = k; break; }
        }
        if (i < 0 || i + horizonDays >= bars.length) return null;
        var entry = Number(bars[i].c);
        var exit = Number(bars[i + horizonDays].c);
        if (!entry || !exit) return null;
        var move = ((exit - entry) / entry) * 100;
        move = Math.round(move * 100) / 100;
        return {
          move5d: move,
          direction: move > 1 ? 'up' : (move < -1 ? 'down' : 'flat'),
          source: 'auto',
          entryTs: bars[i].ts,
          exitTs: bars[i + horizonDays].ts
        };
      })
      .catch(function () { return null; });
  }

  // ---------------- scoreboard ----------------
  // Cost estimate for one analysis (Opus 4.8 standard rates, USD).
  var PRICE_IN = 5, PRICE_OUT = 25; // per million tokens
  function estimateCost(usage) {
    if (!usage) return 0;
    return ((usage.input_tokens || 0) * PRICE_IN + (usage.output_tokens || 0) * PRICE_OUT) / 1e6;
  }

  function stats() {
    var recs = getRecords();
    var labeled = recs.filter(function (r) {
      return r.feedback && r.feedback.brandonScore !== null && r.feedback.brandonScore !== undefined;
    });
    var withOutcome = recs.filter(function (r) {
      return r.outcome && (r.outcome.direction === 'up' || r.outcome.direction === 'down');
    });

    var bias = null, agreePct = null;
    if (labeled.length) {
      var ds = [], agree = 0;
      labeled.forEach(function (r) {
        if (r.read && typeof r.read.score === 'number') {
          var d = r.feedback.brandonScore - r.read.score;
          ds.push(d);
          if (Math.abs(d) <= 1) agree++;
        }
      });
      if (ds.length) {
        bias = Math.round((ds.reduce(function (a, b) { return a + b; }, 0) / ds.length) * 10) / 10;
        agreePct = Math.round((agree / ds.length) * 100);
      }
    }

    var hitPct = null;
    var graded = withOutcome.filter(function (r) { return r.read && r.read.score !== 0; });
    if (graded.length) {
      var hits = graded.filter(function (r) {
        var dir = r.read.score > 0 ? 'up' : 'down';
        return dir === r.outcome.direction;
      }).length;
      hitPct = Math.round((hits / graded.length) * 100);
    }

    var costTotal = 0, analysesPriced = 0;
    recs.forEach(function (r) {
      if (r.read && r.read._usage) { costTotal += estimateCost(r.read._usage); analysesPriced++; }
    });

    return {
      total: recs.length,
      labeled: labeled.length,
      withOutcome: withOutcome.length,
      bias: bias,
      agreePct: agreePct,
      hitPct: hitPct,
      rules: getRules().length,
      costTotal: costTotal,
      analysesPriced: analysesPriced
    };
  }

  // Most recent prior read for the same ticker (excludes a given id), for
  // quarter-over-quarter deltas. getRecords() is newest-first, so the first
  // match is the latest prior read.
  function priorReadFor(ticker, excludeId, beforeTs) {
    if (!ticker) return null;
    var recs = getRecords(); // newest-first
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.ticker !== ticker || r.id === excludeId || !r.read) continue;
      if (beforeTs && !((r.ts || '') < beforeTs)) continue; // only reads older than the reference
      return r;
    }
    return null;
  }

  // Export/import the whole training set so it survives a cache clear or moves
  // between browsers/machines. Import is non-destructive: it appends records
  // not already present (by id) and unions rules.
  function exportData() {
    return { type: 'bpleone_earnings_llm', version: 1, exportedAt: new Date().toISOString(), records: getRecords(), rules: getRules() };
  }
  function importData(obj) {
    if (!obj || obj.type !== 'bpleone_earnings_llm') return { ok: false, error: 'not an earnings-llm export file' };
    var existing = getRecords();
    var byId = {};
    existing.forEach(function (r) { if (r && r.id) byId[r.id] = true; });
    var added = 0;
    (Array.isArray(obj.records) ? obj.records : []).forEach(function (r) {
      if (r && r.id && !byId[r.id]) { existing.push(r); byId[r.id] = true; added++; }
    });
    existing.sort(function (a, b) { return (b.ts || '').localeCompare(a.ts || ''); });
    writeRecords(existing);
    var ru = getRules();
    var have = {};
    ru.forEach(function (s) { have[s] = true; });
    var rulesAdded = 0;
    (Array.isArray(obj.rules) ? obj.rules : []).forEach(function (s) { if (s && !have[s]) { ru.push(s); have[s] = true; rulesAdded++; } });
    setRules(ru);
    return { ok: true, added: added, rulesAdded: rulesAdded, total: existing.length };
  }

  // ---------------- transcript auto-fetch (free, via the brain worker) ----------------
  // Browsers can't fetch Motley Fool / search engines (no CORS), so discovery +
  // scrape happen server-side in the worker's /brain/transcript endpoint, which
  // returns the latest AVAILABLE transcript with its date. No key required.
  function fetchTranscript(ticker) {
    ticker = (ticker || '').toUpperCase().trim();
    return new Promise(function (resolve, reject) {
      if (!ticker) { reject(new Error('Enter a ticker first.')); return; }
      fetch(WORKER + '/brain/transcript?sym=' + encodeURIComponent(ticker))
        .then(function (r) {
          return r.json().catch(function () { return { ok: false, error: 'transcript service returned a bad response (HTTP ' + r.status + ')' }; });
        })
        .then(function (j) {
          if (!j || !j.ok) { reject(new Error((j && j.error) || 'transcript fetch failed')); return; }
          if (!j.transcript || j.transcript.length < 200) { reject(new Error('Transcript came back empty for ' + ticker + '.')); return; }
          resolve({ text: j.transcript, date: j.date || '', ticker: ticker, source: j.source || '', title: j.title || '' });
        })
        .catch(function (e) { reject(new Error('Could not reach the transcript service. ' + ((e && e.message) || ''))); });
    });
  }

  window.EarningsLLM = {
    analyze: analyze,
    getRecords: getRecords,
    saveRecord: saveRecord,
    updateRecord: updateRecord,
    deleteRecord: deleteRecord,
    clearAll: clearAll,
    getRules: getRules,
    setRules: setRules,
    buildCalibrationProfile: buildCalibrationProfile,
    stats: stats,
    gradeOutcomeAuto: gradeOutcomeAuto,
    priorReadFor: priorReadFor,
    exportData: exportData,
    importData: importData,
    fetchTranscript: fetchTranscript,
    newId: newId,
    SCORE_BANDS: SCORE_BANDS,
    scoreColor: scoreColor,
    estimateCost: estimateCost,
    stanceForScore: stanceForScore,
    SCHEMA: SCHEMA
  };
})();
