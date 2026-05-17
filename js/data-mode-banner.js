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
    const out = { hasKey: false, provider: 'mock', enabled: false, connected: false };
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
    return out;
  }

  function bannerFor(needs) {
    const s = getDataStatus();
    const isLive = s.connected || (s.hasKey && s.enabled);
    if (needs === 'live') {
      if (isLive) {
        // Audit pass 12: be HONEST about the actual provider — Stooq is delayed,
        // Finnhub/Polygon/Alpaca/Tradier are real-time. Don't claim "WebSocket"
        // unless we actually have one.
        const provName = s.provider || 'unknown';
        const isRealTime = /finnhub|polygon|alpaca|tradier/i.test(provName);
        const txt = isRealTime
          ? 'LIVE · ' + provName + ' real-time — every tick is current market data.'
          : 'LIVE (delayed ~15 min) · ' + provName + ' free tier feeding real prices. <a href="live-status.html" style="color:var(--accent);text-decoration:underline;">Upgrade to real-time →</a>';
        return { mode: 'live', color: 'var(--green)', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)', icon: '✓', text: txt };
      } else {
        return { mode: 'mock', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', icon: '⚠', text: 'No live feed connected. <a href="connect-live-data.html" style="color:var(--accent);text-decoration:underline;">Connect data →</a>' };
      }
    }
    if (needs === 'chain') {
      if (isLive) {
        return { mode: 'partial', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', icon: 'ℹ', text: 'Quotes are LIVE (Finnhub WS), but the <strong>options chain on this page is synthetic</strong> — Finnhub free tier doesn\'t expose chains. Pro chain requires Polygon/Tradier/UW premium key.' };
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

  function paint() {
    const body = document.body;
    if (!body) return;
    const needs = body.getAttribute('data-needs');
    if (!needs) return;
    if (document.getElementById('dataModeBanner')) return;
    const b = bannerFor(needs);
    if (!b) return;
    const banner = document.createElement('div');
    banner.id = 'dataModeBanner';
    banner.style.cssText = `padding:8px 14px;background:${b.bg};border:1px solid ${b.border};border-radius:8px;color:${b.color};font-size:11px;font-family:var(--font-mono);margin:8px 16px;display:flex;align-items:center;gap:8px;`;
    banner.innerHTML = `<span style="font-size:14px;">${b.icon}</span><span>${b.text}</span><span style="margin-left:auto;font-size:9px;opacity:0.7;">MODE: ${b.mode.toUpperCase()}</span>`;
    // Insert after #site-nav if present, else at top of body
    const nav = document.getElementById('site-nav');
    if (nav && nav.nextSibling) nav.parentNode.insertBefore(banner, nav.nextSibling);
    else body.insertBefore(banner, body.firstChild);
  }

  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(paint, 200));
    else setTimeout(paint, 200);
  }

  return { paint, getDataStatus };
})();
if (typeof window !== 'undefined') window.DataModeBanner = DataModeBanner;
