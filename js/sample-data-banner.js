/* ===========================================
   BPLEONE — Sample-Data Honesty Banner (pass 242)
   ---
   NO FAKE NUMBERS, presented honestly. A handful of pages mimic data feeds
   that require a PAID subscription (options flow / OPRA, dark-pool prints,
   gamma/GEX, congressional & insider filings, MOC imbalances). We don't have
   those feeds on the free tier, so those pages show ILLUSTRATIVE sample data.

   Rather than quietly fake it, this module stamps a clear banner at the top of
   every such page: "Illustrative sample — not live." It also points the user
   to the parts of the site that ARE live and audited (Alpha Scanner / brain).

   Lazy-loaded by live.js on every page; only acts on the listed pages.
   =========================================== */

(function () {
  if (typeof document === 'undefined') return;

  // basename (no .html) -> short feature description for the banner.
  // Pass 250: removed insider-live + news-pulse (now REAL via the worker feeds),
  // and news-impact + congress-trades (they carry their own accurate in-page
  // notices now). Added the remaining genuinely-simulated paid-feed mocks found
  // in the no-fake-numbers audit (tape / trade-tape / strike-chaser / sector-flow
  // / sentiment-heat / daily-stats).
  const ILLUSTRATIVE = {
    'dark-pool': 'dark-pool prints', 'dark-pool-pro': 'dark-pool prints',
    'options-flow-live': 'options order flow', 'order-flow': 'order flow', 'orderbook': 'level-2 order book',
    'flow-replay': 'options flow', 'big-bets': 'large options trades',
    'gex': 'dealer gamma exposure (GEX)', 'gex-pro': 'dealer gamma exposure (GEX)', 'opex-tracker': 'options-expiry positioning',
    'insider-congress-flow': 'insider & congress filings',
    'moc-imbalance': 'market-on-close imbalances', 'etf-flows': 'ETF creation/redemption flows',
    'crypto-derivatives': 'crypto funding / open interest', 'halt-tracker': 'trading-halt feed',
    'sweep-counter': 'options sweeps', 'liquidity-health': 'venue liquidity', 'opex': 'options-expiry positioning',
    'tape': 'the time-and-sales tape', 'trade-tape': 'the time-and-sales tape',
    'strike-chaser': 'options volume / unusual activity', 'sector-flow': 'sector fund flows',
    'sentiment-heat': 'social/news sentiment scoring', 'daily-stats': 'market-internals & options stats',
    'live-watcher': 'the level-1 bid/ask & time-and-sales tape',
    'algo-signals': 'this algorithmic signal feed (the live version is the Alpha Scanner)',
    'breadth-pro': 'market breadth (advance/decline, McClellan, new highs/lows)',
    'risk-radar': 'cross-asset risk gauges (skew, VVIX, credit spread)',
    'candlestick-scanner': 'candlestick pattern detections'
  };

  function currentPage() {
    let p = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (p.endsWith('.html')) p = p.slice(0, -5);
    if (!p) p = 'index';
    return p;
  }

  function mount() {
    const page = currentPage();
    const feature = ILLUSTRATIVE[page];
    if (!feature) return;
    if (document.getElementById('bp-sample-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'bp-sample-banner';
    bar.style.cssText = 'position:relative;z-index:50;margin:0;padding:11px 16px;background:rgba(245,158,11,0.14);border-bottom:2px solid #f59e0b;color:#fbbf24;font-family:Inter,sans-serif;font-size:12.5px;line-height:1.5;text-align:center;';
    bar.innerHTML = '⚠️ <strong>Illustrative sample — not live.</strong> ' + feature.charAt(0).toUpperCase() + feature.slice(1) +
      ' needs a paid data feed we don\'t run on the free tier, so the figures here are simulated for layout. ' +
      'For <strong>live, audited</strong> signals use the <a href="alpha-scanner.html" style="color:#fff;text-decoration:underline;">Alpha Scanner</a> ' +
      'or <a href="smart-money-confluence.html" style="color:#fff;text-decoration:underline;">Smart-Money Confluence</a> (real insider data).';
    // Insert at very top of body so it's the first thing seen.
    if (document.body.firstChild) document.body.insertBefore(bar, document.body.firstChild);
    else document.body.appendChild(bar);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(mount, 200);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 200));

  window.SampleDataBanner = { pages: Object.keys(ILLUSTRATIVE) };
})();
