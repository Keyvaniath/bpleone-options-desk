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
    required: ['stance', 'score', 'conviction', 'summary', 'bull_points', 'bear_points',
      'guidance_vs_expectations', 'guidance_detail', 'tone_shift', 'key_metrics',
      'risks', 'trade_implication', 'confidence_caveats']
  };

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
      'You are a senior equity analyst reading an earnings-call transcript and deciding, plainly: bullish or bearish, and how strongly.',
      'You are reading it for Brandon, a sharp, high-beta tech / AI / quantum momentum trader. He thinks in terms of "be in the sector, not the company," wants asymmetric upside, and trades the 1-5 day post-call reaction with options - so IV crush around the print matters to him.',
      '',
      'HOW TO SCORE (score is an integer -5 to +5):',
      '  +5/+4 strongly bullish, +3/+2 bullish, +1 lean bullish, 0 neutral/mixed, -1 lean bearish, -2/-3 bearish, -4/-5 strongly bearish.',
      '  The single biggest driver of the post-earnings move is GUIDANCE vs expectations, then the management TONE shift vs the prior quarter, then demand/backlog commentary, then margins. Weight them in that order.',
      '  For AI / semis / hardware names, weight data-center and AI-capex commentary heavily.',
      '',
      'RULES:',
      '  - Quote VERBATIM from the transcript for every bull and bear point. Never invent a quote.',
      '  - Never fabricate a number that is not in the transcript. If a figure is missing, say so rather than guessing.',
      '  - If the transcript looks partial, truncated, or is just prepared remarks with no Q&A, lower your conviction and say why in confidence_caveats.',
      '  - trade_implication: one or two sentences tuned to Brandon - the likely direction/magnitude of the near-term move, and the options angle (e.g. IV-crush risk, whether to be long premium or wait).',
      '  - Be honest and specific. No hedging filler.',
      '',
      calibration,
      '',
      'Context: ticker ' + (ticker || 'n/a') + ', period ' + (quarter || 'n/a') + '. Return the structured fields only.'
    ].join('\n');
  }

  // ---------------- the analysis call ----------------
  function analyze(input) {
    input = input || {};
    var ticker = (input.ticker || '').toUpperCase().trim();
    var quarter = (input.quarter || '').trim();
    var transcript = (input.transcript || '').trim();

    return new Promise(function (resolve, reject) {
      if (typeof AIClient === 'undefined' || !AIClient.isReady()) {
        reject(new Error('Claude is not configured. Add your API key in Settings to enable the analyzer.'));
        return;
      }
      if (transcript.length < 200) {
        reject(new Error('Paste a fuller transcript - this looks too short to analyze.'));
        return;
      }

      var system = buildSystemPrompt(ticker, quarter);
      var userMsg = 'Analyze the following earnings-call transcript for ' + (ticker || 'the company') +
        ' (' + (quarter || 'period unknown') + ') and return the structured read.\n\n=== TRANSCRIPT START ===\n' +
        transcript + '\n=== TRANSCRIPT END ===';

      AIClient.chat(
        [{ role: 'user', content: userMsg }],
        {
          system: system,
          model: MODEL,
          maxTokens: 6000,
          output_config: { format: { type: 'json_schema', schema: SCHEMA } }
        }
      ).then(function (resp) {
        if (resp.stop_reason === 'refusal') {
          reject(new Error('The model declined to analyze this text.'));
          return;
        }
        var read = parseRead(resp.text);
        if (!read) {
          reject(new Error('Could not parse a structured read from the response.'));
          return;
        }
        read._model = resp.model || MODEL;
        read._usage = resp.usage || null;
        resolve(read);
      }).catch(function (err) {
        reject(err);
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

    return {
      total: recs.length,
      labeled: labeled.length,
      withOutcome: withOutcome.length,
      bias: bias,
      agreePct: agreePct,
      hitPct: hitPct,
      rules: getRules().length
    };
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
    newId: newId,
    SCORE_BANDS: SCORE_BANDS,
    scoreColor: scoreColor,
    stanceForScore: stanceForScore,
    SCHEMA: SCHEMA
  };
})();
