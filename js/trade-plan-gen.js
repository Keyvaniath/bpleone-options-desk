/* ===========================================
   BPLEONE — Trade Plan Generator
   ---
   For each high-conviction signal, produces a structured 1-paragraph
   trade plan: entry, stop, target, expected hold, conviction rationale,
   risk callouts.

   If AIClient is configured + enabled (user pasted Anthropic key on
   settings.html), uses Claude for a natural-language thesis. Otherwise
   builds a deterministic structured plan from the journal entry data.

   Caches generated plans (by sourceJournalId) in localStorage so we
   don't re-call the API for the same signal.

   Exposes:
     TradePlanGen.generate(journalEntry) -> { plan, source: 'ai'|'template', ts }
     TradePlanGen.generateAlert(alertObj) -> same, takes a HC-alert
     TradePlanGen.cached(sourceJournalId) -> cached plan or null
     TradePlanGen.clearCache()
   =========================================== */

(function () {
  const CACHE_KEY = 'bpleone_trade_plans_v1';
  const MAX_CACHE = 200;

  function loadCache() {
    if (typeof localStorage === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveCache(c) {
    if (typeof localStorage === 'undefined') return;
    try {
      const keys = Object.keys(c);
      if (keys.length > MAX_CACHE) {
        // Trim oldest by ts
        const sorted = keys.map(k => ({ k, ts: c[k].ts || 0 })).sort((a, b) => b.ts - a.ts);
        const trimmed = {};
        sorted.slice(0, MAX_CACHE).forEach(x => { trimmed[x.k] = c[x.k]; });
        c = trimmed;
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) {}
  }

  function cached(id) {
    if (!id) return null;
    const c = loadCache();
    return c[id] || null;
  }
  function clearCache() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CACHE_KEY);
  }

  function buildTemplate(entry) {
    const sym = entry.sym;
    const conv = Math.max(entry.predProb, 1 - entry.predProb);
    const dir = entry.predProb >= 0.5 ? 'LONG' : 'SHORT';
    const entryPx = entry.entryPx || 0;
    const stopPct = 0.01;
    const targetPct = 0.025;
    const stop = dir === 'LONG' ? entryPx * (1 - stopPct) : entryPx * (1 + stopPct);
    const target = dir === 'LONG' ? entryPx * (1 + targetPct) : entryPx * (1 - targetPct);
    const rr = (targetPct / stopPct).toFixed(1);
    const lines = [];
    lines.push(sym + ' ' + dir + ' setup (' + Math.round(conv * 100) + '% conviction)');
    lines.push('Entry: ~$' + entryPx.toFixed(2) + ' · Stop: $' + stop.toFixed(2) + ' (' + (stopPct * 100).toFixed(1) + '%) · Target: $' + target.toFixed(2) + ' (' + (targetPct * 100).toFixed(1) + '%) · R:R ' + rr + ':1');
    const reasons = [];
    if (entry.ensembleProb != null) reasons.push('ensemble prob ' + (entry.ensembleProb * 100).toFixed(0) + '%');
    if (entry.basePreds) {
      const bp = entry.basePreds;
      if (bp.bootstrap != null) reasons.push('bootstrap mean ' + (bp.bootstrap * 100).toFixed(0) + '%');
      if (bp.knn != null) reasons.push('KNN-recall ' + (bp.knn * 100).toFixed(0) + '%');
    }
    if (entry.regime) reasons.push('regime: ' + entry.regime);
    if (entry.oodScore != null && entry.oodScore > 0.4) reasons.push('⚠ OOD score ' + entry.oodScore.toFixed(2));
    if (reasons.length) lines.push('Reasoning: ' + reasons.join(' · '));
    const risks = [];
    risks.push('Stop = 1× risk unit (' + (stopPct * 100).toFixed(1) + '%)');
    if (entry.oodScore > 0.6) risks.push('Inputs are out-of-distribution — size down or skip');
    if (entry.uncertaintyStd > 0.15) risks.push('High prediction uncertainty (' + entry.uncertaintyStd.toFixed(2) + ' MC std)');
    lines.push('Risks: ' + risks.join(' · '));
    lines.push('Hold horizon: 1d (short) · Time-stop: 24h · Exit on stop/target/brain reversal/time-stop');
    return lines.join('\n');
  }

  async function generateAI(entry) {
    if (typeof window === 'undefined' || !window.AIClient) return null;
    if (typeof window.AIClient.isReady !== 'function' || !window.AIClient.isReady()) return null;
    try {
      const sym = entry.sym;
      const conv = Math.max(entry.predProb, 1 - entry.predProb);
      const dir = entry.predProb >= 0.5 ? 'LONG' : 'SHORT';
      const features = entry.features ? JSON.stringify(entry.features.slice(0, 22)) : 'n/a';
      const prompt = 'You are a concise options trader. Given this brain signal, write a 4-line trade plan: ' +
        'line 1 = headline (symbol, direction, conviction%), ' +
        'line 2 = entry/stop/target levels assuming 1% stop and 2.5R target, ' +
        'line 3 = "why this setup" in 12 words max, ' +
        'line 4 = key risk in 10 words max. ' +
        'No fluff. No disclaimers. No bullet points.\n\n' +
        'Signal: sym=' + sym + ' direction=' + dir + ' conviction=' + (conv*100).toFixed(0) + '%' +
        ' entryPx=' + (entry.entryPx || 0).toFixed(2) +
        ' regime=' + (entry.regime || 'mixed') +
        ' ensembleProb=' + (entry.ensembleProb || entry.predProb) +
        ' oodScore=' + (entry.oodScore || 0);
      const res = await window.AIClient.chat([{ role: 'user', content: prompt }], { maxTokens: 200 });
      if (res && res.text) return res.text.trim();
    } catch (e) {}
    return null;
  }

  async function generate(entry) {
    if (!entry) return null;
    const id = entry.id || (entry.sym + '-' + entry.ts);
    const c = loadCache();
    if (c[id]) return c[id];
    let plan = null, src = 'template';
    try {
      plan = await generateAI(entry);
      if (plan) src = 'ai';
    } catch (e) {}
    if (!plan) {
      plan = buildTemplate(entry);
      src = 'template';
    }
    const stored = { plan, source: src, ts: Date.now(), sym: entry.sym, conviction: Math.max(entry.predProb, 1 - entry.predProb) };
    c[id] = stored;
    saveCache(c);
    return stored;
  }

  async function generateAlert(alert) {
    if (!alert) return null;
    // Re-shape alert to look like a journal entry enough for generate()
    const pseudo = {
      id: alert.sourceJournalId || (alert.sym + '-' + alert.ts),
      sym: alert.sym,
      ts: alert.ts,
      entryPx: alert.entryPx,
      predProb: alert.predProb,
      regime: alert.regime
    };
    return generate(pseudo);
  }

  window.TradePlanGen = { generate, generateAlert, cached, clearCache };
})();
