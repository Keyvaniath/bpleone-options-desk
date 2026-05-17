/* ===========================================
   BPLEONE TRADING - REAL DATA PROVIDER
   ---
   Pluggable WebSocket adapter that lets the
   site swap between the mock tick engine and
   real-time market data feeds.
   ---
   Supported providers (all free or freemium):
     mock     -> built-in OU random walk
     finnhub  -> wss://ws.finnhub.io  (free, real-time US equities)
     polygon  -> wss://socket.polygon.io  (paid, institutional)
     tradier  -> wss://ws.tradier.com  (paid, broker-grade)
     alpaca   -> wss://stream.data.alpaca.markets/v2/iex  (free with cap)

   Config is stored in localStorage under "bpleone_data_v1"
   and edited via settings.html.
   =========================================== */

const DataProvider = (function() {
  const KEY = 'bpleone_data_v1';
  const RECONNECT_BASE_MS = 1500;
  const RECONNECT_MAX_MS = 30000;
  const subs = new Set();

  let config = loadConfig();
  let ws = null;
  let status = 'disconnected';
  let lastError = '';
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let messagesReceived = 0;
  let bytesReceived = 0;
  let lastMessageAt = 0;

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
      provider: 'mock',
      apiKey: '',
      enabled: false,
      symbols: [],
      subscribeAll: true
    };
  }

  function saveConfig(c) {
    config = Object.assign(config, c || {});
    try { localStorage.setItem(KEY, JSON.stringify(config)); } catch (e) {}
    notifySubs();
  }

  function getConfig() { return Object.assign({}, config); }
  function getStatus() {
    return {
      status,
      provider: config.provider,
      enabled: config.enabled,
      lastError,
      messagesReceived,
      bytesReceived,
      lastMessageAt,
      reconnectAttempts
    };
  }

  function onStatus(cb) { subs.add(cb); cb(getStatus()); return () => subs.delete(cb); }
  function notifySubs() { const s = getStatus(); subs.forEach(cb => { try { cb(s); } catch (e) {} }); }
  function setStatus(s, err) {
    status = s;
    if (err !== undefined) lastError = err || '';
    notifySubs();
  }

  // ---------- Symbol resolution ----------
  function symbolsToSubscribe() {
    if (config.subscribeAll && typeof QUOTES !== 'undefined') return Object.keys(QUOTES);
    return config.symbols || [];
  }

  // ---------- Mock pause/resume ----------
  function pauseMock() {
    if (typeof pauseLive === 'function') pauseLive();
  }
  function resumeMock() {
    if (typeof resumeLive === 'function') resumeLive();
  }

  // ---------- Quote application ----------
  // Throttle wildcard publishes so pages subscribed to '*' don't re-render on
  // every single tick (Finnhub can fire many trades per second).
  let lastWildcardAt = 0;
  function publishWildcardThrottled() {
    const now = Date.now();
    if (now - lastWildcardAt < 250) return;  // 4Hz max
    lastWildcardAt = now;
    if (typeof Feed !== 'undefined' && typeof QUOTES !== 'undefined') Feed.publish('*', QUOTES);
  }

  function applyTrade(sym, price, size) {
    if (typeof QUOTES === 'undefined' || !QUOTES[sym]) return;
    const px = +price;
    // VALIDATE via DataReliability layer — rejects NaN, ≤0, jumps >30%, out-of-order ts
    if (typeof window.DataReliability !== 'undefined') {
      const v = window.DataReliability.validate(sym, px, config.provider, Date.now());
      if (!v.ok) {
        // Silently drop bad data; DataReliability has already logged it
        return;
      }
    } else {
      // Minimal fallback validation if reliability module hasn't loaded yet
      if (!isFinite(px) || px <= 0 || px > 1e7) return;
    }
    // Record for cross-source agreement check
    if (typeof window.CrossSourceCheck !== 'undefined') {
      try { window.CrossSourceCheck.record(sym, config.provider, px); } catch (e) {}
    }
    const q = QUOTES[sym];
    q.last = px;
    q.fresh = true;
    q.source = q.source || config.provider;
    // Mark as REAL data — TOTD and price displays trust this flag.
    q.priceSource = config.provider;
    q.liveAt = Date.now();
    q.lastTickAt = Date.now();
    if (size && size > 0) q.volume = (q.volume || 0) + size;
    if (typeof computeDerived === 'function') computeDerived(q);
    if (typeof Feed !== 'undefined') Feed.publish(sym, q);
    publishWildcardThrottled();
    messagesReceived++;
    lastMessageAt = Date.now();
  }

  function applyQuote(sym, bid, ask) {
    if (typeof QUOTES === 'undefined' || !QUOTES[sym]) return;
    const q = QUOTES[sym];
    if (bid) q.bid = +bid;
    if (ask) q.ask = +ask;
    if (bid && ask) {
      const mid = (bid + ask) / 2;
      if (mid > 0) {
        q.last = +mid.toFixed(4);
        if (typeof computeDerived === 'function') computeDerived(q);
      }
    }
    if (typeof Feed !== 'undefined') Feed.publish(sym, q);
    publishWildcardThrottled();
    messagesReceived++;
    lastMessageAt = Date.now();
  }

  // ---------- Reconnect with backoff ----------
  function scheduleReconnect() {
    if (!config.enabled) return;
    if (reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
    reconnectAttempts++;
    setStatus('reconnecting', lastError);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function clearReconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
  }

  // ---------- Heartbeat ----------
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      // Stale connection? Force reconnect.
      if (lastMessageAt && Date.now() - lastMessageAt > 90000) {
        try { ws && ws.close(); } catch (e) {}
      }
    }, 30000);
  }
  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  // ---------- Provider: Finnhub ----------
  // Map our local symbols → Finnhub's symbol convention.
  // Finnhub uses BINANCE: prefix for crypto, bare tickers for US equities.
  const FINNHUB_SYM_MAP = {
    BTC: 'BINANCE:BTCUSDT',
    ETH: 'BINANCE:ETHUSDT'
  };
  function toFinnhub(sym) { return FINNHUB_SYM_MAP[sym] || sym; }
  function fromFinnhub(fhSym) {
    for (const [local, fh] of Object.entries(FINNHUB_SYM_MAP)) {
      if (fh === fhSym) return local;
    }
    return fhSym;
  }

  // On connect, also bootstrap prevClose + spot for each symbol via REST so
  // change/changePct are accurate from tick #1 (Finnhub WS only sends last
  // trade price, not prevClose).
  // CRITICAL: every page reads QUOTES synchronously on initial render. We
  // run this bootstrap, mark each symbol fresh, then fire Feed.publish('*')
  // so all pages re-render with real values.
  async function bootstrapFinnhub(opts) {
    if (typeof QUOTES === 'undefined') return;
    opts = opts || {};
    // ALL mode bootstraps every symbol in QUOTES — used by "Refresh all data" buttons
    // so macro/international symbols (not subscribed via WS) still get fresh /quote
    const syms = opts.all ? Object.keys(QUOTES) : symbolsToSubscribe();
    const updated = [];
    await Promise.all(syms.map(async sym => {
      try {
        const fhSym = toFinnhub(sym);
        const r = await fetch('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(fhSym) + '&token=' + encodeURIComponent(config.apiKey));
        if (!r.ok) return;
        const j = await r.json();
        if (!QUOTES[sym]) return;
        // Finnhub: c=current, pc=previous close, o=open, h=high, l=low, t=timestamp
        if (typeof j.pc === 'number' && j.pc > 0) QUOTES[sym].prevClose = j.pc;
        if (typeof j.c === 'number' && j.c > 0) {
          QUOTES[sym].last = j.c;
          QUOTES[sym].fresh = true;          // mark as confirmed-from-feed
          QUOTES[sym].source = 'finnhub';
          if (typeof j.h === 'number') QUOTES[sym].dayHigh = j.h;
          if (typeof j.l === 'number') QUOTES[sym].dayLow = j.l;
          if (typeof j.o === 'number') QUOTES[sym].dayOpen = j.o;
          if (typeof computeDerived === 'function') computeDerived(QUOTES[sym]);
          if (typeof Feed !== 'undefined') Feed.publish(sym, QUOTES[sym]);
          updated.push(sym);
        }
      } catch (e) {}
    }));
    // Fire wildcard so every page subscribed to '*' re-renders with the
    // freshly-bootstrapped data.
    if (typeof Feed !== 'undefined' && typeof QUOTES !== 'undefined') {
      Feed.publish('*', QUOTES);
    }
    console.log('[DataProvider] Finnhub bootstrap done — fresh for ' + updated.length + '/' + syms.length + ': ' + updated.join(','));
    return updated;
  }

  function connectFinnhub() {
    if (!config.apiKey) throw new Error('Finnhub requires an API key');
    // Fire bootstrap REST calls for ALL symbols (don't await — let WS connect in parallel)
    // This ensures macro/intl symbols (unsubscribed via WS) still get fresh /quote data
    bootstrapFinnhub({ all: true });
    ws = new WebSocket('wss://ws.finnhub.io?token=' + encodeURIComponent(config.apiKey));
    ws.onopen = () => {
      symbolsToSubscribe().forEach(sym => {
        ws.send(JSON.stringify({ type: 'subscribe', symbol: toFinnhub(sym) }));
      });
      setStatus('connected');
      clearReconnect();
      startHeartbeat();
    };
    ws.onmessage = ev => {
      try {
        bytesReceived += ev.data.length;
        const msg = JSON.parse(ev.data);
        if (msg.type === 'trade' && Array.isArray(msg.data)) {
          msg.data.forEach(t => applyTrade(fromFinnhub(t.s), t.p, t.v));
        } else if (msg.type === 'ping') {
          // ignore
        } else if (msg.type === 'error') {
          setStatus('error', msg.msg || 'Finnhub error');
        }
      } catch (e) {}
    };
    ws.onerror = () => setStatus('error', 'Finnhub WebSocket error');
    ws.onclose = () => {
      stopHeartbeat();
      setStatus('disconnected');
      scheduleReconnect();
    };
  }

  // ---------- Provider: Polygon ----------
  function connectPolygon() {
    if (!config.apiKey) throw new Error('Polygon requires an API key');
    ws = new WebSocket('wss://socket.polygon.io/stocks');
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'auth', params: config.apiKey }));
    };
    ws.onmessage = ev => {
      try {
        bytesReceived += ev.data.length;
        const msgs = JSON.parse(ev.data);
        if (!Array.isArray(msgs)) return;
        msgs.forEach(msg => {
          if (msg.ev === 'status') {
            if (msg.status === 'auth_success') {
              const params = symbolsToSubscribe().map(s => 'T.' + s).join(',');
              if (params) ws.send(JSON.stringify({ action: 'subscribe', params }));
              const qparams = symbolsToSubscribe().map(s => 'Q.' + s).join(',');
              if (qparams) ws.send(JSON.stringify({ action: 'subscribe', params: qparams }));
              setStatus('connected');
              clearReconnect();
              startHeartbeat();
            } else if (msg.status === 'auth_failed') {
              setStatus('error', 'Polygon auth failed — check API key');
              try { ws.close(); } catch (e) {}
            }
          } else if (msg.ev === 'T') {
            applyTrade(msg.sym, msg.p, msg.s);
          } else if (msg.ev === 'Q') {
            applyQuote(msg.sym, msg.bp, msg.ap);
          }
        });
      } catch (e) {}
    };
    ws.onerror = () => setStatus('error', 'Polygon WebSocket error');
    ws.onclose = () => {
      stopHeartbeat();
      setStatus('disconnected');
      scheduleReconnect();
    };
  }

  // ---------- Provider: Alpaca (IEX feed, free tier) ----------
  function connectAlpaca() {
    if (!config.apiKey || !config.apiSecret) throw new Error('Alpaca requires API key + secret');
    ws = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');
    ws.onopen = () => {
      ws.send(JSON.stringify({
        action: 'auth',
        key: config.apiKey,
        secret: config.apiSecret
      }));
    };
    let authed = false;
    ws.onmessage = ev => {
      try {
        bytesReceived += ev.data.length;
        const msgs = JSON.parse(ev.data);
        if (!Array.isArray(msgs)) return;
        msgs.forEach(m => {
          if (m.T === 'success' && m.msg === 'authenticated') {
            authed = true;
            const syms = symbolsToSubscribe();
            ws.send(JSON.stringify({ action: 'subscribe', trades: syms, quotes: syms }));
            setStatus('connected');
            clearReconnect();
            startHeartbeat();
          } else if (m.T === 'error') {
            setStatus('error', m.msg || 'Alpaca error');
          } else if (m.T === 't' && authed) {
            applyTrade(m.S, m.p, m.s);
          } else if (m.T === 'q' && authed) {
            applyQuote(m.S, m.bp, m.ap);
          }
        });
      } catch (e) {}
    };
    ws.onerror = () => setStatus('error', 'Alpaca WebSocket error');
    ws.onclose = () => {
      stopHeartbeat();
      setStatus('disconnected');
      scheduleReconnect();
    };
  }

  // ---------- Provider: Tradier ----------
  async function connectTradier() {
    if (!config.apiKey) throw new Error('Tradier requires an Access Token');
    // Tradier needs a session token from REST first
    const sessResp = await fetch('https://api.tradier.com/v1/markets/events/session', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey
      }
    });
    if (!sessResp.ok) throw new Error('Tradier session request failed: ' + sessResp.status);
    const sess = await sessResp.json();
    const sid = sess && sess.stream && sess.stream.sessionid;
    if (!sid) throw new Error('Tradier session id missing');

    ws = new WebSocket('wss://ws.tradier.com/v1/markets/events');
    ws.onopen = () => {
      ws.send(JSON.stringify({
        symbols: symbolsToSubscribe(),
        sessionid: sid,
        linebreak: true,
        filter: ['trade', 'quote']
      }));
      setStatus('connected');
      clearReconnect();
      startHeartbeat();
    };
    ws.onmessage = ev => {
      try {
        bytesReceived += ev.data.length;
        const msg = JSON.parse(ev.data);
        if (msg.type === 'trade') applyTrade(msg.symbol, parseFloat(msg.price), parseInt(msg.size, 10));
        else if (msg.type === 'quote') applyQuote(msg.symbol, parseFloat(msg.bid), parseFloat(msg.ask));
      } catch (e) {}
    };
    ws.onerror = () => setStatus('error', 'Tradier WebSocket error');
    ws.onclose = () => {
      stopHeartbeat();
      setStatus('disconnected');
      scheduleReconnect();
    };
  }

  // ---------- Connect / disconnect ----------
  function connect() {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (!config.enabled || config.provider === 'mock') {
      setStatus('mock');
      resumeMock();
      return;
    }
    pauseMock();
    setStatus('connecting');
    try {
      if (config.provider === 'finnhub') connectFinnhub();
      else if (config.provider === 'polygon') connectPolygon();
      else if (config.provider === 'tradier') connectTradier();
      else if (config.provider === 'alpaca') connectAlpaca();
      else { setStatus('error', 'Unknown provider: ' + config.provider); resumeMock(); }
    } catch (e) {
      setStatus('error', e.message || String(e));
      resumeMock();
      scheduleReconnect();
    }
  }

  function disconnect() {
    clearReconnect();
    stopHeartbeat();
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    setStatus('disconnected');
  }

  // ---------- Historical bars (REST) ----------
  // Returns: [{ t: epochMs, o, h, l, c, v }, ...]
  async function getHistorical(symbol, resolution, fromMs, toMs) {
    if (!config.enabled || config.provider === 'mock' || !config.apiKey) {
      return generateSyntheticBars(symbol, resolution, fromMs, toMs);
    }
    try {
      if (config.provider === 'finnhub') return await finnhubBars(symbol, resolution, fromMs, toMs);
      if (config.provider === 'polygon') return await polygonBars(symbol, resolution, fromMs, toMs);
      if (config.provider === 'tradier') return await tradierBars(symbol, resolution, fromMs, toMs);
      if (config.provider === 'alpaca') return await alpacaBars(symbol, resolution, fromMs, toMs);
    } catch (e) {
      console.warn('[DataProvider] historical fetch failed, falling back to synthetic:', e);
    }
    return generateSyntheticBars(symbol, resolution, fromMs, toMs);
  }

  async function finnhubBars(symbol, res, from, to) {
    const map = { '1m':'1', '5m':'5', '15m':'15', '30m':'30', '60m':'60', '1d':'D', '1w':'W', '1mo':'M' };
    const r = map[res] || 'D';
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${r}&from=${Math.floor(from/1000)}&to=${Math.floor(to/1000)}&token=${encodeURIComponent(config.apiKey)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Finnhub bars failed: ' + resp.status);
    const j = await resp.json();
    if (j.s !== 'ok') throw new Error('Finnhub returned: ' + j.s);
    return j.t.map((t, i) => ({ t: t*1000, o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i], v: j.v[i] }));
  }

  async function polygonBars(symbol, res, from, to) {
    const map = { '1m':'1/minute', '5m':'5/minute', '15m':'15/minute', '30m':'30/minute', '60m':'1/hour', '1d':'1/day', '1w':'1/week', '1mo':'1/month' };
    const r = map[res] || '1/day';
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${r}/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${encodeURIComponent(config.apiKey)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Polygon bars failed: ' + resp.status);
    const j = await resp.json();
    return (j.results || []).map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  }

  async function tradierBars(symbol, res, from, to) {
    const map = { '1m':'1min', '5m':'5min', '15m':'15min', '1d':'daily', '1w':'weekly', '1mo':'monthly' };
    const interval = map[res] || 'daily';
    const fromStr = new Date(from).toISOString().slice(0,10);
    const toStr = new Date(to).toISOString().slice(0,10);
    const url = `https://api.tradier.com/v1/markets/history?symbol=${encodeURIComponent(symbol)}&interval=${interval}&start=${fromStr}&end=${toStr}`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + config.apiKey } });
    if (!resp.ok) throw new Error('Tradier bars failed: ' + resp.status);
    const j = await resp.json();
    const days = (j.history && j.history.day) || [];
    return (Array.isArray(days) ? days : [days]).map(d => ({ t: new Date(d.date).getTime(), o: +d.open, h: +d.high, l: +d.low, c: +d.close, v: +d.volume }));
  }

  async function alpacaBars(symbol, res, from, to) {
    const map = { '1m':'1Min', '5m':'5Min', '15m':'15Min', '30m':'30Min', '60m':'1Hour', '1d':'1Day' };
    const tf = map[res] || '1Day';
    const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${tf}&start=${new Date(from).toISOString()}&end=${new Date(to).toISOString()}&limit=5000&feed=iex`;
    const resp = await fetch(url, { headers: { 'APCA-API-KEY-ID': config.apiKey, 'APCA-API-SECRET-KEY': config.apiSecret || '' } });
    if (!resp.ok) throw new Error('Alpaca bars failed: ' + resp.status);
    const j = await resp.json();
    return (j.bars || []).map(b => ({ t: new Date(b.t).getTime(), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  }

  function generateSyntheticBars(symbol, res, from, to) {
    const q = (typeof QUOTES !== 'undefined' && QUOTES[symbol]) ? QUOTES[symbol] : { last: 100 };
    const stepMs = { '1m':60_000, '5m':300_000, '15m':900_000, '30m':1_800_000, '60m':3_600_000, '1d':86_400_000, '1w':604_800_000, '1mo':2_628_000_000 }[res] || 86_400_000;
    const bars = [];
    let px = q.last * (0.95 + Math.random() * 0.1);
    for (let t = from; t <= to; t += stepMs) {
      const o = px;
      const drift = (q.last - px) / q.last * 0.04;
      const shock = (Math.random() - 0.5) * 0.02;
      const c = o * (1 + drift + shock);
      const h = Math.max(o, c) * (1 + Math.random() * 0.005);
      const l = Math.min(o, c) * (1 - Math.random() * 0.005);
      const v = Math.round(((q.volume || 1_000_000) / 100) * (0.5 + Math.random()));
      bars.push({ t, o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2), v });
      px = c;
    }
    return bars;
  }

  // ---------- Finnhub-specific helpers for real fundamental/insider/news data ----------
  // These call Finnhub REST endpoints directly. They throw if no key or wrong provider.
  // Pages can call e.g. DataProvider.getInsiderTransactions('NVDA') to get real data.
  function _fhKey() {
    if (config.provider !== 'finnhub' || !config.apiKey) throw new Error('Finnhub key not configured');
    return encodeURIComponent(config.apiKey);
  }
  async function _fhGet(path, params) {
    const key = _fhKey();
    const qs = Object.entries(params || {}).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
    const url = 'https://finnhub.io/api/v1' + path + '?' + qs + '&token=' + key;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Finnhub ' + path + ' failed: ' + r.status);
    return r.json();
  }
  async function getInsiderTransactions(symbol) {
    const j = await _fhGet('/stock/insider-transactions', { symbol });
    return (j.data || []).map(t => ({
      symbol: t.symbol, name: t.name, share: t.share, change: t.change,
      filingDate: t.filingDate, transactionDate: t.transactionDate,
      transactionPrice: t.transactionPrice, transactionCode: t.transactionCode,
      isBuy: (t.change || 0) > 0
    }));
  }
  async function getInsiderSentiment(symbol, fromMs, toMs) {
    const fmt = ms => new Date(ms).toISOString().slice(0,10);
    const j = await _fhGet('/stock/insider-sentiment', { symbol, from: fmt(fromMs || Date.now() - 365*86400000), to: fmt(toMs || Date.now()) });
    return (j.data || []);
  }
  async function getCompanyNews(symbol, fromMs, toMs) {
    const fmt = ms => new Date(ms).toISOString().slice(0,10);
    const j = await _fhGet('/company-news', { symbol, from: fmt(fromMs || Date.now() - 7*86400000), to: fmt(toMs || Date.now()) });
    return (j || []).map(n => ({ id: n.id, headline: n.headline, summary: n.summary, source: n.source, url: n.url, datetime: n.datetime*1000, category: n.category, image: n.image, related: n.related }));
  }
  async function getMarketNews(category) {
    const j = await _fhGet('/news', { category: category || 'general' });
    return (j || []).map(n => ({ id: n.id, headline: n.headline, summary: n.summary, source: n.source, url: n.url, datetime: n.datetime*1000, category: n.category, image: n.image, related: n.related }));
  }
  async function getEarningsCalendar(fromMs, toMs) {
    const fmt = ms => new Date(ms).toISOString().slice(0,10);
    const j = await _fhGet('/calendar/earnings', { from: fmt(fromMs || Date.now()), to: fmt(toMs || Date.now() + 14*86400000) });
    return (j.earningsCalendar || []);
  }
  async function getRecommendations(symbol) {
    const j = await _fhGet('/stock/recommendation', { symbol });
    return Array.isArray(j) ? j : [];
  }
  async function getStockProfile(symbol) {
    return _fhGet('/stock/profile2', { symbol });
  }
  async function getBasicFinancials(symbol) {
    const j = await _fhGet('/stock/metric', { symbol, metric: 'all' });
    return j.metric || {};
  }
  async function getQuote(symbol) {
    return _fhGet('/quote', { symbol: toFinnhub(symbol) });
  }

  // ---------- Stooq zero-key fallback ----------
  // Stooq.com offers a free public CSV endpoint with CORS open. No API key, no signup.
  // Coverage: US equities, ETFs, indices, FX, crypto. Delayed ~15min, but real.
  // We use this as the default real-data source when no other provider is configured,
  // so prices on the site reflect reality even before Brandon wires anything.
  const STOOQ_MAP = {
    SPY:'spy.us', QQQ:'qqq.us', IWM:'iwm.us', DIA:'dia.us',
    AAPL:'aapl.us', NVDA:'nvda.us', TSLA:'tsla.us', MSFT:'msft.us', META:'meta.us', AMZN:'amzn.us', GOOGL:'googl.us', AMD:'amd.us',
    BTC:'btcusd', ETH:'ethusd',
    VIX:'^vix', GLD:'gld.us', TLT:'tlt.us', USO:'uso.us',
    SMCI:'smci.us', PLTR:'pltr.us', COIN:'coin.us', MARA:'mara.us', RIVN:'rivn.us',
    XLE:'xle.us', BABA:'baba.us', SHOP:'shop.us', CRM:'crm.us', UBER:'uber.us',
    SLV:'slv.us', UNG:'ung.us', DBA:'dba.us',
    FXI:'fxi.us', MCHI:'mchi.us', EWJ:'ewj.us', EWG:'ewg.us', EWU:'ewu.us',
    INDA:'inda.us', EWZ:'ewz.us', EWY:'ewy.us', EWT:'ewt.us',
    EEM:'eem.us', EFA:'efa.us', VEA:'vea.us', VWO:'vwo.us',
    SHY:'shy.us', IEF:'ief.us', TBT:'tbt.us', HYG:'hyg.us', LQD:'lqd.us', TIP:'tip.us',
    VXX:'vxx.us', UVXY:'uvxy.us', VNQ:'vnq.us'
  };
  let stooqPollTimer = null;
  let stooqLastFetchOk = 0;

  // Try multiple Stooq TLDs (.com, .pl) for redundancy. If both fail, return null
  // and the caller can fall back to Coinbase (for crypto) or wait for next cycle.
  const STOOQ_HOSTS = ['stooq.com', 'stooq.pl'];

  async function _stooqFetchChunk(stooqSymsCsv) {
    for (const host of STOOQ_HOSTS) {
      const url = 'https://' + host + '/q/l/?s=' + encodeURIComponent(stooqSymsCsv) + '&f=sd2t2ohlcv&h&e=csv';
      const startTs = Date.now();
      // 8-second timeout so a hung Stooq request can't lock the poll loop forever
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;
      try {
        const res = await fetch(url, { method:'GET', cache:'no-cache', signal: controller ? controller.signal : undefined });
        if (timeoutId) clearTimeout(timeoutId);
        const latency = Date.now() - startTs;
        if (!res.ok) {
          if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch('stooq-' + host, false, latency);
          continue; // try next host
        }
        const text = await res.text();
        const rows = parseStooqCsv(text);
        if (typeof window.DataReliability !== 'undefined') {
          window.DataReliability.recordFetch('stooq-' + host, rows.length > 0, latency);
          window.DataReliability.recordFetch('stooq', rows.length > 0, latency); // aggregate
        }
        if (rows.length > 0) return rows; // success
      } catch (e) {
        if (timeoutId) clearTimeout(timeoutId);
        if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch('stooq-' + host, false, Date.now() - startTs);
        // try next host
      }
    }
    // All Stooq hosts failed — record aggregate failure
    if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch('stooq', false, 0);
    return null;
  }

  function parseStooqCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(s => s.trim().toLowerCase());
    const idxSym = header.indexOf('symbol');
    const idxOpen = header.indexOf('open');
    const idxClose = header.indexOf('close');
    const idxHigh = header.indexOf('high');
    const idxLow = header.indexOf('low');
    const idxVol = header.indexOf('volume');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 4) continue;
      const close = parseFloat(cols[idxClose]);
      if (isNaN(close) || close <= 0) continue;
      rows.push({
        sym: cols[idxSym],
        open: parseFloat(cols[idxOpen]) || close,
        close: close,
        high: parseFloat(cols[idxHigh]) || close,
        low: parseFloat(cols[idxLow]) || close,
        volume: parseInt(cols[idxVol]) || 0
      });
    }
    return rows;
  }

  async function stooqPollOnce() {
    if (typeof QUOTES === 'undefined') return;
    const ourSyms = Object.keys(QUOTES);
    const stooqSyms = ourSyms.map(s => STOOQ_MAP[s]).filter(Boolean);
    if (!stooqSyms.length) return;
    // Chunk to avoid URL length issues — 25 symbols at a time
    let totalUpdated = 0;
    for (let i = 0; i < stooqSyms.length; i += 25) {
      const chunk = stooqSyms.slice(i, i + 25).join(' ');
      const rows = await _stooqFetchChunk(chunk);
      if (!rows) continue;
      rows.forEach(r => {
        // Map back to our internal symbol
        const ourSym = ourSyms.find(s => (STOOQ_MAP[s] || '').toLowerCase() === r.sym.toLowerCase());
        if (!ourSym || !QUOTES[ourSym]) return;
        // Validate price before accepting
        if (typeof window.DataReliability !== 'undefined') {
          const v = window.DataReliability.validate(ourSym, r.close, 'stooq', Date.now());
          if (!v.ok) return; // drop invalid; DataReliability has logged it
        }
        // Record for cross-source agreement
        if (typeof window.CrossSourceCheck !== 'undefined') {
          try { window.CrossSourceCheck.record(ourSym, 'stooq', r.close); } catch (e) {}
        }
        const q = QUOTES[ourSym];
        if (q.last !== r.close) q.prevClose = q.last;  // preserve previous as prevClose
        q.last = r.close;
        q.change = q.last - q.prevClose;
        q.changePct = q.prevClose > 0 ? (q.change / q.prevClose) * 100 : 0;
        q.bid = +(q.last - 0.01).toFixed(2);
        q.ask = +(q.last + 0.01).toFixed(2);
        q.volume = r.volume || q.volume;
        q.dayHigh = r.high;
        q.dayLow = r.low;
        // Mark this quote as REAL — UI and TOTD scoring trust this flag.
        q.source = 'stooq';
        q.priceSource = 'stooq';
        q.liveAt = Date.now();
        q.ts = Date.now();
        try { if (typeof Feed !== 'undefined') Feed.publish(ourSym, q); } catch (e) {}
        totalUpdated++;
      });
    }
    if (totalUpdated > 0) {
      stooqLastFetchOk = Date.now();
      // Mark site-wide as 'live' so the demo banner clears and the ML trainer accepts findings
      try {
        if (window.BPLEONE_DATA_MODE !== 'live') {
          window.BPLEONE_DATA_MODE = 'live';
          window.BPLEONE_LIVE_SOURCE = 'stooq';
          window.dispatchEvent(new CustomEvent('bpleone:data-mode', { detail: { mode: 'live', source: 'stooq' } }));
        }
      } catch (e) {}
      // Pause the mock random-walk so it doesn't drift Stooq's real values between polls.
      // Prices will only change when Stooq's next poll fetches new data (every 30s).
      try { if (typeof pauseLive === 'function') pauseLive(); } catch (e) {}
      setStatus('connected', { provider: 'stooq', messagesReceived: totalUpdated });
    }
  }

  function startStooqFallback() {
    if (stooqPollTimer) return;
    // First poll immediately, then every 12s. Stooq has no documented rate limit but
    // ~5 requests/sec is a polite ceiling. 12s × 3-4 chunks = ~3 req/poll cycle.
    stooqPollOnce();
    stooqPollTimer = setInterval(stooqPollOnce, 12000);
    // Also start Coinbase realtime crypto feed — free, CORS, no key.
    startCoinbaseCrypto();
    // Belt-and-suspenders: Coinbase REST poll as fallback if WS drops.
    startCoinbaseRestPoll();
  }

  // ---------- Coinbase realtime crypto fallback (BTC/ETH) ----------
  // Coinbase Exchange has a free public WebSocket with full CORS. Real-time
  // tick data for BTC-USD and ETH-USD. No API key, no signup.
  let coinbaseSocket = null;
  let coinbaseReconnect = null;

  function startCoinbaseCrypto() {
    if (coinbaseSocket && coinbaseSocket.readyState === WebSocket.OPEN) return;
    try {
      const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
      coinbaseSocket = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          product_ids: ['BTC-USD', 'ETH-USD'],
          channels: ['ticker']
        }));
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type !== 'ticker' || !m.product_id || !m.price) return;
          const sym = m.product_id === 'BTC-USD' ? 'BTC' : m.product_id === 'ETH-USD' ? 'ETH' : null;
          if (!sym || typeof QUOTES === 'undefined' || !QUOTES[sym]) return;
          const q = QUOTES[sym];
          const price = parseFloat(m.price);
          if (!isFinite(price) || price <= 0) return;
          // Validate via DataReliability — catches glitchy ticks
          if (typeof window.DataReliability !== 'undefined') {
            const v = window.DataReliability.validate(sym, price, 'coinbase', Date.now());
            if (!v.ok) return; // drop
          }
          // Record for cross-source agreement
          if (typeof window.CrossSourceCheck !== 'undefined') {
            try { window.CrossSourceCheck.record(sym, 'coinbase', price); } catch (e) {}
          }
          if (q.last !== price) q.prevClose = q.prevClose || q.last;
          q.last = price;
          q.bid = parseFloat(m.best_bid) || +(price - 0.5).toFixed(2);
          q.ask = parseFloat(m.best_ask) || +(price + 0.5).toFixed(2);
          q.volume = parseFloat(m.volume_24h) || q.volume;
          q.dayHigh = parseFloat(m.high_24h) || q.dayHigh;
          q.dayLow = parseFloat(m.low_24h) || q.dayLow;
          if (q.prevClose > 0) {
            q.change = q.last - q.prevClose;
            q.changePct = (q.change / q.prevClose) * 100;
          }
          q.source = 'coinbase';
          q.priceSource = 'coinbase';
          q.liveAt = Date.now();
          q.ts = Date.now();
          // Flip site mode to live if Coinbase is the first real source
          try {
            if (window.BPLEONE_DATA_MODE !== 'live') {
              window.BPLEONE_DATA_MODE = 'live';
              window.BPLEONE_LIVE_SOURCE = 'coinbase';
              window.dispatchEvent(new CustomEvent('bpleone:data-mode', { detail: { mode: 'live', source: 'coinbase' } }));
            }
          } catch (e) {}
          try { if (typeof Feed !== 'undefined') Feed.publish(sym, q); } catch (e) {}
        } catch (e) {}
      };
      ws.onclose = () => {
        coinbaseSocket = null;
        if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch('coinbase', false, 0);
        if (!coinbaseReconnect) coinbaseReconnect = setTimeout(() => { coinbaseReconnect = null; startCoinbaseCrypto(); }, 5000);
      };
      ws.onerror = () => {
        if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch('coinbase', false, 0);
        try { ws.close(); } catch (e) {}
      };
      // Mark coinbase success on each accepted message — done implicitly when DataReliability.validate succeeds
      const origOnMessage = ws.onmessage;
      ws.onmessage = function (evt) {
        if (origOnMessage) origOnMessage.call(this, evt);
        if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch('coinbase', true, 0);
      };
    } catch (e) {}
  }
  function stopCoinbaseCrypto() {
    try { if (coinbaseSocket) coinbaseSocket.close(); } catch (e) {}
    coinbaseSocket = null;
    if (coinbaseReconnect) { clearTimeout(coinbaseReconnect); coinbaseReconnect = null; }
  }
  function stopStooqFallback() {
    if (stooqPollTimer) { clearInterval(stooqPollTimer); stooqPollTimer = null; }
  }

  // ---------- Coinbase REST poll backup ----------
  // If WebSocket disconnects (firewall, network drop), this REST poll keeps
  // crypto prices flowing. Runs every 30s in the background as belt-and-suspenders.
  let coinbasePollTimer = null;
  const COINBASE_PAIRS = { BTC: 'BTC-USD', ETH: 'ETH-USD' };

  async function _coinbasePollOnce() {
    if (typeof QUOTES === 'undefined') return;
    for (const [sym, pair] of Object.entries(COINBASE_PAIRS)) {
      if (!QUOTES[sym]) continue;
      const startTs = Date.now();
      try {
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 5000) : null;
        const res = await fetch('https://api.exchange.coinbase.com/products/' + pair + '/ticker', {
          method: 'GET',
          signal: controller ? controller.signal : undefined
        });
        if (timeoutId) clearTimeout(timeoutId);
        const latency = Date.now() - startTs;
        if (!res.ok) {
          if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch('coinbase-rest', false, latency);
          continue;
        }
        const data = await res.json();
        const price = parseFloat(data.price);
        if (!isFinite(price) || price <= 0) continue;
        // Validate via DataReliability before accepting
        if (typeof window.DataReliability !== 'undefined') {
          const v = window.DataReliability.validate(sym, price, 'coinbase-rest', Date.now());
          window.DataReliability.recordFetch('coinbase-rest', v.ok, latency);
          if (!v.ok) continue;
        }
        // Record for cross-source agreement
        if (typeof window.CrossSourceCheck !== 'undefined') {
          try { window.CrossSourceCheck.record(sym, 'coinbase-rest', price); } catch (e) {}
        }
        const q = QUOTES[sym];
        if (q.last !== price) q.prevClose = q.prevClose || q.last;
        q.last = price;
        q.bid = +(price - 0.5).toFixed(2);
        q.ask = +(price + 0.5).toFixed(2);
        if (q.prevClose > 0) {
          q.change = q.last - q.prevClose;
          q.changePct = (q.change / q.prevClose) * 100;
        }
        // Only mark source as coinbase-rest if WebSocket is NOT the active source
        if (!coinbaseSocket || coinbaseSocket.readyState !== WebSocket.OPEN) {
          q.source = 'coinbase-rest';
          q.priceSource = 'coinbase-rest';
        }
        q.liveAt = Date.now();
        q.ts = Date.now();
        try { if (typeof Feed !== 'undefined') Feed.publish(sym, q); } catch (e) {}
      } catch (e) {
        if (typeof window.DataReliability !== 'undefined') window.DataReliability.recordFetch('coinbase-rest', false, Date.now() - startTs);
      }
    }
  }

  function startCoinbaseRestPoll() {
    if (coinbasePollTimer) return;
    _coinbasePollOnce();
    coinbasePollTimer = setInterval(_coinbasePollOnce, 30000);
  }

  // ---------- Init ----------
  function init() {
    config = loadConfig();
    if (config.enabled && config.provider !== 'mock' && config.apiKey) {
      // Real provider — start the connection. Mock engine stays paused.
      setTimeout(connect, 0);
      return { useMock: false };
    }
    // No real provider configured — kick off the Stooq zero-key fallback.
    // This pulls real (delayed) prices into QUOTES every 30s. The mock engine still
    // runs for inter-poll smoothing, but the anchor values are real.
    setStatus('mock');
    setTimeout(startStooqFallback, 200);
    return { useMock: true };  // mock engine still runs for smooth ticks between polls
  }

  return {
    init,
    connect,
    disconnect,
    reconnect: () => { disconnect(); setTimeout(connect, 200); },
    saveConfig,
    getConfig,
    getStatus,
    onStatus,
    getHistorical,
    // Force a fresh /quote pull for every symbol in QUOTES (incl. unsubscribed macro/intl)
    refreshAll: () => bootstrapFinnhub({ all: true }),
    // Real-data helpers (Finnhub)
    getInsiderTransactions,
    getInsiderSentiment,
    getCompanyNews,
    getMarketNews,
    getEarningsCalendar,
    getRecommendations,
    getStockProfile,
    getBasicFinancials,
    getQuote,
    // Stooq zero-key fallback controls
    startStooqFallback,
    stopStooqFallback,
    stooqPollOnce,
    getStooqStatus: () => ({ lastFetchOk: stooqLastFetchOk, polling: !!stooqPollTimer })
  };
})();
