/* ===========================================
   BPLEONE TRADING - DATA MODE BANNER
   ---
   Inserts a banner at top of <body> showing whether the
   page is on LIVE or SYNTHETIC data, based on:
     - Finnhub key configured?
     - DataProvider status connected?
     - Page-specific requirements (e.g. option chain needs premium)
   Pages opt in by setting <body data-needs="live|chain|insider|earnings">.
   =========================================== */

const DataModeBanner = (function () {
  function getDataStatus() {
    const out = { hasKey: false, provider: 'mock', enabled: false, connected: false, workerLive: false };
    try {
      const raw = localStorage.getItem('bpleone_data_v1');
      if (raw) {
        const c = JSON.parse(raw);
        out.hasKey = !!(c.apiKey && c.provider === 'finnhub');
        out.provider = c.provider || 'mock';
        out.enabled = !!c.enabled;
      }
    } catch (e) {}
    try {
      if (typeof DataProvider !== 'undefined') {
        const s = DataProvider.getStatus();
        out.connected = s && s.status === 'connected';
        out.provider = s && s.provider ? s.provider : out.provider;
        out.lastMsgAt = s && s.lastMessageAt;
      }
    } catch (e) {}
    // Pass 305 (HONESTY fix): the primary real-price feed is the Cloudflare worker
    // (worker-quotes.js pulls REAL, ~15-min-delayed Yahoo prices straight into QUOTES
    // and flips window.BPLEONE_DATA_MODE to 'live') — it needs NO Finnhub key and does
    // NOT go through DataProvider. Before this, a user with no key saw "No live feed
    // connected / MODE: MOCK" even while real worker prices populated the page — a
    // false negative that made a working live product look broken. Recognize the worker
    // feed as live, corroborated by an actual real quote in QUOTES so we never claim
    // "live" on pure seeds.
    try {
      if (typeof window !== 'undefined' && window.BPLEONE_DATA_MODE === 'live') out.workerLive = true;
    } catch (e) {}
    try {
      if (typeof QUOTES !== 'undefined' && QUOTES) {
        for (const k in QUOTES) {
          const q = QUOTES[k];
          if (q && q.last > 0 && (q.priceSource === 'worker-yahoo' || q.priceSource === 'finnhub'
              || q.priceSource === 'coinbase' || q.priceSource === 'coinbase-ws')) { out.workerLive = true; break; }
        }
      }
    } catch (e) {}
    return out;
  }

  function bannerFor(needs) {
    const s = getDataStatus();
    const isLive = s.connected || (s.hasKey && s.enabled) || s.workerLive;
    if (needs === 'live') {
      if (isLive) {
        // Audit pass 277 (HONESTY): the live-vs-stale call is made by the ET market
        // CLOCK (detectSession), not by the provider name and not by a liveAt age a
        // racing off-hours Finnhub WS heartbeat can reset to ~now. During regular
        // hours equities are delayed ~15 min (Yahoo/Stooq); outside them the printed
        // price is the prior session's close. equityDataAgeMin() (market-timestamp
        // source only) supplies the "N ago" detail.
        const sess = (typeof window !== 'undefined' && typeof window.detectSession === 'function') ? window.detectSession() : 'open';
        if (sess === 'open') {
          return { mode: 'live', color: 'var(--green)', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)', icon: '✓', text: 'Crypto LIVE (real-time WS) · equities DELAYED ~15 min (free Yahoo/Stooq data — real prices, not real-time ticks).' };
        }
        const eqAge = (typeof window !== 'undefined' && typeof window.equityDataAgeMin === 'function') ? window.equityDataAgeMin() : null;
        let ago = '';
        if (eqAge !== null) {
          const _h = Math.floor(eqAge / 60), _m = Math.round(eqAge % 60);
          ago = '(' + (_h ? (_h + 'h' + (_m ? ' ' + _m + 'm' : '')) : (_m + 'm')) + ' ago) ';
        }
        return { mode: 'delayed', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', icon: 'ℹ', text: 'Outside regular hours · crypto LIVE 24/7 · equities show LAST CLOSE ' + ago + '— the change % is from the prior session, not current.' };
      } else {
        return { mode: 'mock', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', icon: '⚠', text: 'No live feed connected. <a href="connect-live-data.html" style="color:var(--accent);text-decoration:underline;">Connect data →</a>' };
      }
    }
    if (needs === 'chain') {
      if (isLive) {
        return { mode: 'partial', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', icon: 'ℹ', text: 'Quotes are LIVE (real prices, ~15-min delayed), but the <strong>options chain on this page is synthetic</strong> — free feeds don\'t expose chains. Pro chain requires Polygon/Tradier/UW premium key.' };
      }
      return { mode: 'mock', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', icon: '⚠', text: 'SYNTHETIC data — no provider key. Configure Finnhub for live quotes; Polygon/Tradier for live chains. <a href="settings.html" style="color:var(--accent);text-decoration:underline;">Settings →</a>' };
    }
    if (needs === 'insider') {
      if (s.hasKey) {
        return { mode: 'live', color: 'var(--green)', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)', icon: '✓', text: 'LIVE · Pulling Form 4 + sentiment from Finnhub /stock/insider-transactions and /stock/insider-sentiment.' };
      }
      return { mode: 'mock', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', icon: '⚠', text: 'SYNTHETIC insider data — no Finnhub key. <a href="settings.html" style="color:var(--accent);text-decoration:underline;">Configure for real Form 4 / sentiment data →</a>' };
    }
    if (needs === 'earnings') {
      if (s.hasKey) {
        return { mode: 'live', color: 'var(--green)', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)', icon: '✓', text: 'LIVE · Pulling earnings calendar + history from Finnhub.' };
      }
      return { mode: 'mock', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', icon: '⚠', text: 'SYNTHETIC earnings data — no Finnhub key. <a href="settings.html" style="color:var(--accent);text-decoration:underline;">Configure for real earnings →</a>' };
    }
    if (needs === 'crypto-funding') {
      // Binance API is public — no key needed
      return { mode: 'live', color: 'var(--green)', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)', icon: '✓', text: 'LIVE · Pulling funding rates directly from Binance public API (no key required). Synthetic fallback only if Binance blocked by network.' };
    }
    return null;
  }

  function render(banner, b) {
    banner.style.cssText = `padding:8px 14px;background:${b.bg};border:1px solid ${b.border};border-radius:8px;color:${b.color};font-size:11px;font-family:var(--font-mono);margin:8px 16px;display:flex;align-items:center;gap:8px;`;
    banner.innerHTML = `<span style="font-size:14px;">${b.icon}</span><span>${b.text}</span><span style="margin-left:auto;font-size:9px;opacity:0.7;">MODE: ${b.mode.toUpperCase()}</span>`;
  }

  function paint() {
    const body = document.body;
    if (!body) return;
    const needs = body.getAttribute('data-needs');
    if (!needs) return;
    const b = bannerFor(needs);
    if (!b) return;
    // Pass 305: re-runnable. paint() used to bail if the banner already existed,
    // so the FIRST evaluation (200ms after DOMContentLoaded, before the worker's
    // real prices had landed) froze a "No live feed connected" banner permanently
    // even once live prices arrived. Now it UPDATES the existing banner in place
    // and re-fires on the quote/data-mode events, so it flips to "delayed/live"
    // the moment real prices populate QUOTES.
    let banner = document.getElementById('dataModeBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'dataModeBanner';
      const nav = document.getElementById('site-nav');
      if (nav && nav.nextSibling) nav.parentNode.insertBefore(banner, nav.nextSibling);
      else body.insertBefore(banner, body.firstChild);
    }
    render(banner, b);
  }

  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(paint, 200));
    else setTimeout(paint, 200);
    // Re-evaluate when real prices land or the data mode flips.
    window.addEventListener('bpleone:quotes', paint);
    window.addEventListener('bpleone:worker-quotes', paint);
    window.addEventListener('bpleone:data-mode', paint);
  }

  return { paint, getDataStatus };
})();
if (typeof window !== 'undefined') window.DataModeBanner = DataModeBanner;
