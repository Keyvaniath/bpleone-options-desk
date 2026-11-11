/* ===========================================
   BPLEONE TRADING - SOCIAL SENTIMENT FETCHER
   ---
   Pulls Finnhub social sentiment + news sentiment.
   Cached per-symbol for 15 minutes to respect rate limits.
   ---
   Public API:
     Sentiment.get(symbol)          -> { score, mention, change } or null (sync, from cache)
     Sentiment.fetch(symbol)        -> Promise<sentimentObj>, hits network if cache stale
     Sentiment.fetchBatch(symbols)  -> Promise<Map<symbol, sentimentObj>>, parallel
     Sentiment.warmup(symbols)      -> kick off background fetch for a list
   =========================================== */

const Sentiment = (function () {
  const CACHE_KEY = 'bpleone_sentiment_cache_v1';
  const TTL_MS = 15 * 60 * 1000;

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {} }

  function getFinnhubKey() {
    try {
      const raw = localStorage.getItem('bpleone_data_v1');
      if (!raw) return null;
      const c = JSON.parse(raw);
      return c.provider === 'finnhub' ? c.apiKey : null;
    } catch (e) { return null; }
  }

  // Pass 340: both endpoints are premium on Finnhub. A free key gets 403 on each (checked in Brandon's browser
  // 11/11), and radar.html asked for every symbol in parallel every 15 minutes: two refused calls per symbol on the
  // same 60-a-minute budget the quote feed needs. A 401/403 now parks that endpoint for 7 days, and a batch runs
  // one symbol at a time, 1.1 s apart, only while an endpoint is still open.
  const PARK_KEY = 'bpleone_fh_premium_v1';
  const PARK_MS = 7 * 24 * 3600 * 1000;
  function parked(ep) {
    try { const j = JSON.parse(localStorage.getItem(PARK_KEY) || '{}'); return !!(j[ep] && Date.now() - j[ep] < PARK_MS); }
    catch (e) { return false; }
  }
  function park(ep) {
    try { const j = JSON.parse(localStorage.getItem(PARK_KEY) || '{}'); j[ep] = Date.now(); localStorage.setItem(PARK_KEY, JSON.stringify(j)); } catch (e) {}
  }
  // True while at least one sentiment endpoint has not refused this key.
  function available() { return !!getFinnhubKey() && !(parked('social-sentiment') && parked('news-sentiment')); }

  function get(sym) {
    const cache = loadCache();
    const entry = cache[sym];
    if (!entry) return null;
    if (Date.now() - entry.ts > TTL_MS) return null;
    return entry.data;
  }

  async function fetchOne(sym) {
    const cache = loadCache();
    const entry = cache[sym];
    if (entry && Date.now() - entry.ts < TTL_MS) return entry.data;

    const key = getFinnhubKey();
    if (!key || !available()) return null;

    const data = { sym, ts: Date.now(), socialScore: null, newsScore: null, mentions: null, source: null };
    // 1) Social sentiment endpoint (premium on Finnhub, often returns null for free tier)
    if (!parked('social-sentiment')) try {
      const today = new Date();
      const from = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
      const to = today.toISOString().slice(0, 10);
      const url = `https://finnhub.io/api/v1/stock/social-sentiment?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
      const res = await fetch(url);
      if (res.status === 401 || res.status === 403) park('social-sentiment');
      if (res.ok) {
        const j = await res.json();
        // Average reddit + twitter sentiment-score
        const all = (j.reddit || []).concat(j.twitter || []);
        if (all.length) {
          const avgScore = all.reduce((a, x) => a + (x.score || 0), 0) / all.length;
          const totalMentions = all.reduce((a, x) => a + (x.mention || 0), 0);
          data.socialScore = +avgScore.toFixed(2);
          data.mentions = totalMentions;
          data.source = 'finnhub-social';
        }
      }
    } catch (e) { /* ignore */ }

    // 2) News sentiment endpoint (also premium: a free key gets 403)
    if (!parked('news-sentiment')) try {
      const url = `https://finnhub.io/api/v1/news-sentiment?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`;
      const res = await fetch(url);
      if (res.status === 401 || res.status === 403) park('news-sentiment');
      if (res.ok) {
        const j = await res.json();
        if (j && j.sentiment) {
          // sentiment.bearishPercent / bullishPercent
          const bullish = j.sentiment.bullishPercent || 0;
          const bearish = j.sentiment.bearishPercent || 0;
          // Composite: -1 to +1
          data.newsScore = +((bullish - bearish) / 100).toFixed(2);
          if (j.buzz) data.buzz = j.buzz.buzz;
          if (!data.source) data.source = 'finnhub-news';
        }
      }
    } catch (e) { /* ignore */ }

    // Composite: use socialScore if present, else newsScore
    if (data.socialScore != null) data.composite = data.socialScore;
    else if (data.newsScore != null) data.composite = data.newsScore;
    else data.composite = null;

    cache[sym] = { ts: Date.now(), data };
    saveCache(cache);
    return data;
  }

  async function fetchBatch(symbols) {
    const out = {};
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i];
      if (!available()) { out[s] = null; continue; }        // refused: no further calls
      const fresh = get(s);
      if (fresh) { out[s] = fresh; continue; }               // cached: no call, no wait
      try { out[s] = await fetchOne(s); } catch (e) { out[s] = null; }
      if (i < symbols.length - 1 && available()) await new Promise(r => setTimeout(r, 1100));
    }
    return out;
  }

  function warmup(symbols) {
    // Fire-and-forget
    fetchBatch(symbols).catch(() => {});
  }

  function classify(score) {
    if (score == null) return 'unknown';
    if (score >= 0.4) return 'very-bullish';
    if (score >= 0.15) return 'bullish';
    if (score <= -0.4) return 'very-bearish';
    if (score <= -0.15) return 'bearish';
    return 'neutral';
  }

  return { get, fetch: fetchOne, fetchBatch, warmup, classify, available };
})();

if (typeof window !== 'undefined') window.Sentiment = Sentiment;
