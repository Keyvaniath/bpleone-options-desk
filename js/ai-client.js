/* ===========================================
   BPLEONE TRADING - AI CLIENT (Claude API)
   ---
   Wraps Anthropic's Messages API for direct
   browser usage. When configured, replaces the
   canned heuristic responses in assistant.html.
   ---
   Browser-direct calls require the
     anthropic-dangerous-direct-browser-access: true
   header. Note: the API key is stored in localStorage
   and visible to anyone with access to the browser.
   For production multi-user deployment a backend
   proxy is the right architecture; for single-user
   solo desk use, browser-direct is fine.
   =========================================== */

const AIClient = (function() {
  const KEY = 'bpleone_ai_v1';
  const subs = new Set();
  let config = loadConfig();

  function loadConfig() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const c = JSON.parse(raw);
      return Object.assign(defaults(), c);
    } catch (e) {
      return defaults();
    }
  }

  function defaults() {
    return {
      provider: 'claude',           // 'claude' only for now
      apiKey: '',
      model: 'claude-opus-4-7',     // latest Opus
      maxTokens: 1024,
      enabled: false
    };
  }

  function saveConfig(c) {
    config = Object.assign(config, c || {});
    try { localStorage.setItem(KEY, JSON.stringify(config)); } catch (e) {}
    subs.forEach(cb => { try { cb(getStatus()); } catch (e) {} });
  }

  function getConfig() { return Object.assign({}, config); }
  function getStatus() {
    return {
      enabled: config.enabled && !!config.apiKey,
      model: config.model,
      provider: config.provider
    };
  }
  function onStatus(cb) { subs.add(cb); cb(getStatus()); return () => subs.delete(cb); }

  function isReady() { return !!(config.enabled && config.apiKey); }

  // Default system prompt for the trading assistant.
  // Pulls live data context from QUOTES if available.
  function buildSystemPrompt() {
    const marketSnapshot = (typeof QUOTES !== 'undefined') ? Object.values(QUOTES).slice(0, 12).map(q =>
      `${q.symbol} $${(q.last||0).toFixed(2)} (${(q.changePct||0) >= 0 ? '+' : ''}${(q.changePct||0).toFixed(2)}%)`
    ).join(', ') : 'unavailable';

    return [
      'You are the resident trading desk assistant for bpleone / trade, an institutional-grade options + technical-analysis platform.',
      '',
      'PERSONA:',
      '- You sound like a sharp prop-desk analyst: terse, specific, numbers-first.',
      "- You never give personalized financial advice. You teach methodology and discuss setups.",
      '- You are honest about uncertainty and never fabricate prices, fills, or fundamental data you do not have.',
      '',
      'FORMATTING:',
      '- Lead with the answer. Then supporting math/reasoning.',
      "- Use **bold** for key terms, `code` for tickers and numbers, fenced code blocks for structures/sizing.",
      "- Keep responses under ~250 words unless the user asks for depth.",
      '',
      'CURRENT MARKET SNAPSHOT (from the platform feed):',
      marketSnapshot,
      '',
      'DESK METHODOLOGY:',
      '- Setup scoring is learn-adjusted from realized expectancy (see edge-analytics.html).',
      '- Risk: max 1% per trade, max 3% across correlated positions, reduce 25% if VIX>25.',
      '- Sizing: fixed-fractional / ¼-Kelly / ATR-based / vol-targeted (see position-sizing.html).',
      '- Vol regime: prefer spreads if IV rank > 40, long premium if < 20.',
      '- Always cite POP, max profit, max loss, breakeven for any options structure.',
      '',
      'ROUTING HINTS — if the user asks about something with a dedicated page, mention it:',
      '- Options flow → options-flow.html',
      '- Greeks/gamma → gex.html',
      '- Earnings → earnings-calendar.html',
      '- Sizing math → position-sizing.html',
      '- Portfolio risk → risk-dashboard.html',
      '- Vol surface → vol-surface.html',
      '- Backtest a strategy → backtester.html'
    ].join('\n');
  }

  // ---------- Messages API call ----------
  async function chat(messages, opts) {
    if (!isReady()) {
      throw new Error('AI client not configured. Set your Claude API key in Settings.');
    }
    opts = opts || {};
    const body = {
      model: config.model,
      max_tokens: opts.maxTokens || config.maxTokens || 1024,
      system: opts.system || buildSystemPrompt(),
      messages: messages
    };
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      let err = 'HTTP ' + resp.status;
      try {
        const j = await resp.json();
        if (j && j.error) err = j.error.message || j.error.type || err;
      } catch (e) {}
      throw new Error(err);
    }
    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return {
      text,
      usage: data.usage,
      stop_reason: data.stop_reason,
      model: data.model
    };
  }

  // Streaming variant — fires onChunk(text) for each delta
  async function chatStream(messages, opts, onChunk) {
    if (!isReady()) throw new Error('AI client not configured.');
    opts = opts || {};
    const body = {
      model: config.model,
      max_tokens: opts.maxTokens || config.maxTokens || 1024,
      system: opts.system || buildSystemPrompt(),
      messages,
      stream: true
    };
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      let err = 'HTTP ' + resp.status;
      try { const j = await resp.json(); if (j && j.error) err = j.error.message || err; } catch (e) {}
      throw new Error(err);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.text) {
            full += ev.delta.text;
            if (onChunk) onChunk(ev.delta.text, full);
          }
        } catch (e) {}
      }
    }
    return { text: full };
  }

  // ---------- Quick health check ----------
  async function testConnection() {
    try {
      const r = await chat([{ role: 'user', content: 'Reply with exactly: pong' }], { maxTokens: 16 });
      return { ok: true, sample: r.text.trim() };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  return {
    saveConfig,
    getConfig,
    getStatus,
    onStatus,
    isReady,
    chat,
    chatStream,
    testConnection,
    buildSystemPrompt
  };
})();
// Audit pass 76b: explicit window assignment so `window.AIClient` works from
// inline scripts. Top-level `const` is script-scoped (NOT auto-attached to
// window) — 3 callers used the `window.AIClient` form and were getting
// undefined.
if (typeof window !== 'undefined') window.AIClient = AIClient;
