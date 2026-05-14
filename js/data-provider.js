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
    const q = QUOTES[sym];
    q.last = +price;
    q.fresh = true;
    q.source = q.source || config.provider;
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
  async function bootstrapFinnhub() {
    if (typeof QUOTES === 'undefined') return;
    const syms = symbolsToSubscribe();
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
    // Fire bootstrap REST calls (don't await — let WS connect in parallel)
    bootstrapFinnhub();
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

  // ---------- Init ----------
  function init() {
    config = loadConfig();
    if (config.enabled && config.provider !== 'mock' && config.apiKey) {
      // Real provider — start the connection. Mock engine stays paused.
      setTimeout(connect, 0);
      return { useMock: false };
    }
    setStatus('mock');
    return { useMock: true };
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
    // Real-data helpers (Finnhub)
    getInsiderTransactions,
    getInsiderSentiment,
    getCompanyNews,
    getMarketNews,
    getEarningsCalendar,
    getRecommendations,
    getStockProfile,
    getBasicFinancials,
    getQuote
  };
})();
