/* ===========================================
   BPLEONE TRADING - CORE APP JS
   =========================================== */

// Theme: read saved preference and apply BEFORE first paint to avoid flash.
(function applySavedTheme() {
  try {
    const t = localStorage.getItem('bpleone_theme_v1') || 'dark';
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) {}
})();

// Register the service worker (PWA install + offline cache). Skip on file://.
(function registerSW() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
  }
})();

// Auto-load companion modules on any page that includes this script.
// Pages that already imported these get a no-op (idempotent).
//
// CRITICAL FIX (pass 176 — live-verified bug):
// The original implementation ran SYNCHRONOUSLY when app.js evaluated. At that
// point, only `<script>` tags BEFORE app.js in the HTML had been parsed —
// any tags AFTER (which is most of them, including the model.js most pages
// load explicitly) were invisible to the dedup check. Result: app.js injected
// a SECOND copy of model.js, and the second eval threw
// "SyntaxError: Identifier 'FEATURES' has already been declared". Found via
// Chrome console on options.bpleone.com — affected 105 of 402 pages.
// Fix: defer companion loading until DOMContentLoaded so the entire HTML
// has been parsed and all explicit <script> tags are visible to the check.
(function loadCompanions() {
  // Pass 270 (DEPLOY-INTEGRITY FIX): derive the cache-bust from app.js's OWN ?v=
  // query so lazily-loaded companions always match the version the HTML bumped to.
  // This used to be a hardcoded constant ('v188') that drifted stale while the HTML
  // reached v191 - so the browser kept serving the FIRST-cached copy of every lazy
  // module (e.g. data-mode-banner.js still rendered the old "every tick is current"
  // banner long after the fix deployed). Found via LIVE browser verify, not static
  // review. Deriving from self means it can never drift again.
  let CACHE_BUST = 'v207';
  try {
    const me = document.currentScript;
    const src = me ? me.src : ([...document.querySelectorAll('script[src]')].map(s => s.src).find(u => /\/app\.js(\?|$)/.test(u)) || '');
    const m = src.match(/[?&]v=([^&]+)/);
    if (m && m[1]) CACHE_BUST = m[1];
  } catch (e) {}
  function inject() {
    const want = ['js/toast.js', 'js/command-palette.js', 'js/hotkeys.js', 'js/onboarding.js', 'js/recent-tickers.js', 'js/symbol-linker.js', 'js/model.js', 'js/brain-loop.js', 'js/data-mode-banner.js'];
    const allScripts = [...document.querySelectorAll('script[src]')];
    const have = new Set(allScripts.map(s => {
      try { return new URL(s.src, location.href).pathname.split('/').slice(-2).join('/'); } catch (e) { return s.src; }
    }));
    want.forEach(rel => {
      // Check for both raw rel AND rel-with-any-query (since static tags have ?v=)
      if (have.has(rel) || allScripts.some(s => {
        const u = s.src.replace(/\?.*$/, '');
        return u.endsWith(rel);
      })) return;
      const s = document.createElement('script');
      s.src = rel + '?v=' + CACHE_BUST;
      s.async = false;
      document.head.appendChild(s);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  } else {
    inject();
  }
})();

const TICKER_SYMBOLS = ['SPY','QQQ','IWM','DIA','AAPL','NVDA','TSLA','MSFT','META','AMZN','GOOGL','AMD','BTC','ETH','VIX','GLD','TLT','USO','SMCI','PLTR','COIN'];

// Honest freshness helper (audit pass 270): minutes since the freshest REAL
// (non-crypto) equity quote. null = no real equity quote has landed yet. Crypto
// is excluded because it streams 24/7 in real time. Used by the data pill and the
// LIVE/DELAYED banner so we label by actual data AGE, never by provider name.
function equityDataAgeMin() {
  try {
    // Age of the freshest broad-market index from the MARKET-TIMESTAMP source
    // (worker/Yahoo/Stooq), which carries the real last-trade time. Finnhub WS is
    // deliberately EXCLUDED: off-hours its heartbeat resets liveAt to ~now and would
    // hide that the printed price is a stale last-close (this exact race made the
    // pill flash LIVE on today.html while SPY was 9.7h stale). Used only for the
    // "N ago" detail - the live-vs-stale decision is made by detectSession() (clock).
    const CORE = ['SPY', 'QQQ', 'DIA', 'IWM'];
    const Q = (typeof QUOTES !== 'undefined') ? QUOTES : {};
    const now = Date.now();
    let minAge = null;
    for (let i = 0; i < CORE.length; i++) {
      const q = Q[CORE[i]];
      if (!q || !q.liveAt) continue;
      const ps = q.priceSource || '';
      if (/worker|yahoo|stooq/i.test(ps)) {
        const age = (now - q.liveAt) / 60000;
        if (minAge === null || age < minAge) minAge = age;
      }
    }
    return minAge === null ? null : Math.round(minAge);
  } catch (e) { return null; }
}
if (typeof window !== 'undefined') window.equityDataAgeMin = equityDataAgeMin;

let _tickerSubscribed = false;
function buildTicker() {
  const tape = document.getElementById('ticker-content');
  if (!tape) return;
  const src = (typeof QUOTES !== 'undefined') ? QUOTES : null;
  const list = TICKER_SYMBOLS.map(s => {
    if (src && src[s] && src[s].last != null) {
      const ps = src[s].priceSource;
      const seed = !ps || ps === 'stale-seed' || ps === 'mock';
      return { sym: s, px: src[s].last, chg: src[s].changePct || 0, fresh: !!src[s].fresh, seed: seed };
    }
    return null;
  }).filter(Boolean);
  // If QUOTES not ready yet, retry shortly. Don't use stale hardcoded fallback.
  if (list.length === 0) {
    tape.innerHTML = '<span class="ticker-item" style="opacity:0.5;">loading market data…</span>';
    setTimeout(buildTicker, 500);
    return;
  }
  const html = [...list, ...list].map(t => {
    // Seed = a symbol no live feed has touched. Rendering a confident change% for
    // it fabricates a market move that never happened (e.g. the VIX seed showing
    // "-2.88%"). Show the symbol but suppress the fake % until a real tick lands.
    if (t.seed) {
      return '<span class="ticker-item" data-ticker-sym="' + t.sym + '" style="opacity:0.4;" title="No live feed yet - last-known value, not a current quote">'
        + '<span class="ticker-symbol">' + t.sym + '</span>'
        + '<span class="ticker-price">$' + t.px.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) + '</span>'
        + '<span class="ticker-change" style="color:var(--text-muted);">&middot;</span>'
        + '</span>';
    }
    const dir = t.chg >= 0 ? 'up' : 'down';
    const arrow = t.chg >= 0 ? '▲' : '▼';
    const staleMarker = t.fresh === false ? ' style="opacity:0.6;"' : '';
    return '<span class="ticker-item" data-ticker-sym="' + t.sym + '"' + staleMarker + '>'
      + '<span class="ticker-symbol">' + t.sym + '</span>'
      + '<span class="ticker-price">$' + t.px.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) + '</span>'
      + '<span class="ticker-change ' + dir + '">' + arrow + ' ' + Math.abs(t.chg).toFixed(2) + '%</span>'
      + '</span>';
  }).join('');
  tape.innerHTML = html;
  // Subscribe ONCE — Feed callbacks update existing DOM nodes by data-ticker-sym
  if (typeof Feed !== 'undefined' && !_tickerSubscribed) {
    _tickerSubscribed = true;
    TICKER_SYMBOLS.forEach(s => {
      Feed.subscribe(s, q => updateTickerItem(s, q));
    });
    // Wildcard fires on bootstrap-complete and major refreshes — force full re-render
    Feed.subscribe('*', () => {
      TICKER_SYMBOLS.forEach(s => {
        if (typeof QUOTES !== 'undefined' && QUOTES[s]) updateTickerItem(s, QUOTES[s]);
      });
    });
  }
}

function updateTickerItem(sym, q) {
  if (!q || q.last == null) return;
  const ps = q.priceSource;
  const seed = !ps || ps === 'stale-seed' || ps === 'mock';
  document.querySelectorAll('[data-ticker-sym="' + sym + '"]').forEach(el => {
    const priceEl = el.querySelector('.ticker-price');
    const chgEl = el.querySelector('.ticker-change');
    if (priceEl) priceEl.textContent = '$' + q.last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (chgEl) {
      if (seed) {
        // still no real feed for this symbol - keep the honest muted marker, never
        // a fabricated change%.
        chgEl.textContent = '·';
        chgEl.style.color = 'var(--text-muted)';
        chgEl.classList.remove('up', 'down');
        el.style.opacity = '0.4';
      } else {
        const arrow = (q.changePct || 0) >= 0 ? '▲' : '▼';
        chgEl.textContent = arrow + ' ' + Math.abs(q.changePct || 0).toFixed(2) + '%';
        chgEl.style.color = '';
        chgEl.classList.toggle('up', (q.changePct || 0) >= 0);
        chgEl.classList.toggle('down', (q.changePct || 0) < 0);
        el.style.opacity = '1';
      }
    }
  });
}

function buildNav(activePage) {
  activePage = activePage || '';
  const playsGrp = ['totd','options-lab','plays','signals','earnings','earnings-preview','pre-market','zero-dte','setup-wizard','paper-trade','game-plan','hot-movers','squeeze-radar','trade-plan','trade-of-the-day'];
  const tradeGrp = ['flow','chain','ta','momentum','market-internals','smart-money','heatmap','watchlists','vol-surface','gex','tape','sectors','pairs','calendar-analyzer','vol-cone','dark-pool','short-interest','etf-flows','volume-profile','order-flow','ticker','multi-leg-builder','bracket-builder','spread-scanner','wheel','correlation','big-bets','dark-pool-pro','day-trader-pro','flow-replay','gex-pro','iv-crush-tracker','opex-tracker','options-builder','options-pricer','options-skew-radar','orderbook','trade-tape','vol-term'];
  // Daily workflow group — top of funnel
  const dailyGrp = ['pick-of-day','morning-brief','daily-debrief','tomorrow-playbook','friday-summary','catalyst-clock','ai-narrative','daily-stats','conviction-stack','game-plan'];
  // Brain & ML group
  const brainGrp = ['edge-scorecard','edge-lab','brain-heartbeat','brain-audit','brain-decisions','discoveries','ml-feedback','edge-analytics','edge','learn-dashboard','learn','learn-engine-explained','live-train','train-history','weight-heatmap','assistant','ai-scout','ai-cotrader','setup-library','position-stacking','model-trainer','model-explorer','model-versions','feature-store','online-learning','model-confidence','feature-engineering','model-seed','brain-graph','ensemble','neural-net','cross-validation','learning-rate-tuner','prediction-replay','model-explain','model-compare','training-scheduler','ml-glossary','ml-status','active-learning','training-history','first-run-tour','model-results','model-pnl','brain-grade','auto-paper','calibration','brain-memory','daily-report','streak-tracker','risk-sizer-pro','missed-opportunities','ml-leaderboard','trade-of-the-day-pro','broker-prep','sentiment-vs-model','model-economy','brain-coach','scatter-finder','model-postmortem','model-export','brain-weekly-report','alert-rules-pro','model-what-if','model-symbols-leaderboard','trade-export','brain-live-feed','notification-log','setup-compare','brain-monthly-calendar','mobile-dashboard','brain-hub','brain-diary','cohort-analysis','jump-to','brain-vs-spy','brain-explained','smart-watchlist','portfolio-stress-test','brain-changelog','daily-routine','brain-snapshot','symbol-brain','time-of-day-brain','positions-live','pattern-library','brain-hotkeys','risk-limits','gut-check','trade-vs-plan','brain-evolution','performance-attribution-pro','brain-pulse','brain-questions','brain-tldr','trade-sizing-advisor','similar-trades','post-trade-debrief','emergency-stop','brain-vs-coin-flip','brain-rate-of-learning','multi-position-kelly','hall-of-fame','data-truth','live-data-setup','methodology','brain-health','historical-trainer','brain-monitor','continuous-learning','multi-horizon','probability-calibration','walk-forward-backtest','outlier-detection','brain-conviction','trade-selectivity','conviction-tracker','brain-bet','feature-drift','feature-importance','conviction-alerts','prediction-uncertainty','symbol-bias','ensemble-agreement','brain-daily-report','knn-recall','unified-predictor','conformal-prediction','swa-tracker','meta-stacker','regime-calibration','uncertainty-training','module-leaderboard','hourly-performance','drawdown-protector','covariate-shift','adaptive-lr','brain-truth','brier-skill','sharpe-ratio','setup-performance','label-smoothing','dow-performance','sample-decay','hindsight-replay','confidence-penalty','trade-trust','auto-pause','isotonic-calibration','symbol-skill','symbol-sharpe','sector-performance','reliability-diagram','brain-coach-live','volume-tracker','prediction-histogram','per-symbol-meta-stacker','self-distillation','counterfactual-replay','daily-cards','brain-backup','mixup','historical-bootstrap','train-now','learning-velocity','brain-debug','site-health','trade-coach','brain-proof','worker-setup','proof','constraints'];
  // Scanners group
  const scanGrp = ['alpha-scanner','smart-money-confluence','algo-signals','mean-reversion-scanner','trend-strength','confluence-scanner','radar','edge-scanner','hot-movers','squeeze-radar-pro','squeeze-composite','short-squeeze-alerts','pre-market-scanner','pre-market-gappers','after-hours-scanner','earnings-tonight','earnings-reactor','earnings-calendar','earnings','earnings-playbook','earnings-preview','screener','anomalies','ipo-calendar','pair-scanner','candlestick-scanner','news-reactions','comparison','symbol-diff','insider-clusters','insider-live','congress-trades','insider-congress-flow','buybacks-tracker','dollar-leaders','sweep-counter','retracement-finder','pivot-finder','levels-engine'];
  // Markets group
  const marketsGrp = ['macro','market-internals','breadth-pro','market-map','heatmap','cross-asset-pulse','cross-asset-correlations','correlations-live','sectors','global-markets','yield-curve','economic-events','economic-clock','halt-tracker','moc-imbalance','risk-radar','vix-pulse','smart-rotation','sector-rotation','sector-flow','sector-snapshot','heat-clock','sentiment-heat','news','news-pulse','news-impact','smart-money'];
  // Tools group — calculators, risk, journal, settings, alerts, crypto, education
  const toolsGrp = ['risk','risk-dashboard','risk-attribution','risk-parity','risk-of-ruin','fundamentals','backtester','multi-backtest','potd-backtest','journal','trade-journal-pro','alerts','alerts-builder','alerts-feed','alerts-dashboard','crypto','crypto-derivatives','crypto-basis','crypto-commodities','portfolio-builder','position-sizing','kelly-sizer','pdt-dashboard','margin-calc','pnl-projector','execution','liquidity-health','strategies','setup-combos','api','seasonality','settings','mindset','changelog','replay','hypothetical','account','performance-attribution','all-tools','pwa-install','watchlist-share','desk-split','time-of-day-pnl','live-pnl-heatmap','day-pnl-calendar','site-diagnostics','connect-live-data','data-reliability','make-money','options-101','how-to-make-money','weekly-refresh','source-quality','money-made','brain-daily-card','auto-trade','high-conviction-alerts','brain-vs-spy-live','risk-simulator','source-performance','pnl-calendar','mobile-money','voice-coach','trade-plans','brain-backtest','pattern-recall','mental-game','earnings-awareness','position-correlation','webhook-bridge','daily-replay','state-backup','money-hotkeys','auto-watchlist','brain-health-pro','pre-trade-checklist','loss-cooloff','goal-tracker','calibration-view','ai-market-pulse','sound-synth','trade-notes','money-changelog','equity-protector','risk-gauge','bankroll-milestones','hot-symbols','brain-time-of-day','trade-quality','symbol-deep-dive','outcome-distribution','brain-insights','smart-defaults','brain-meta-monitor','money-search','money-site-map','live-status','audit-log','self-test','dashboard','education','live-quote-grid','live-watcher','paper-portfolio','pnl-diagram','vwap-pnl','watchlist-pro','share','analytics','daily-post','owner-checklist'];
  const isTrade = tradeGrp.indexOf(activePage) !== -1;
  const isPlays = playsGrp.indexOf(activePage) !== -1 || dailyGrp.indexOf(activePage) !== -1;
  const isBrain = brainGrp.indexOf(activePage) !== -1;
  const isScan = scanGrp.indexOf(activePage) !== -1;
  const isMarkets = marketsGrp.indexOf(activePage) !== -1;
  const isTools = toolsGrp.indexOf(activePage) !== -1;
  // ---- DEMO MODE banner — shown when data source is mock (default). Brandon sees this until he wires a real feed.
  // The banner is constructed at render time and re-checks the global flag on each buildNav() call.
  // Linked to data-truth.html which walks through the fix.
  const demoBanner = ''
    + '<div id="bp-demo-banner" style="display:none;background:linear-gradient(90deg,#dc2626,#b91c1c);color:#fff;font-size:12px;font-weight:700;padding:8px 14px;text-align:center;letter-spacing:0.5px;border-bottom:2px solid #fff;">'
    +   '⚠ DEMO DATA — prices are simulated, not real. Brain is NOT training on these. '
    +   '<a href="data-truth.html" style="color:#fff;text-decoration:underline;font-weight:800;">Fix this →</a> '
    +   '<span style="opacity:0.75;margin-left:6px;font-weight:400;">(MSCI, NVDA, etc. shown here are random-walk drifts from a stale seed)</span>'
    + '</div>';
  // Reveal logic — runs after DOMContentLoaded. The "DEMO DATA — simulated
  // random-walk, brain not training" warning is only TRUE when the user has
  // explicitly enabled demo mode AND nothing real is feeding the page. A connected
  // live provider (Finnhub/Stooq) means prices are real, and a connected 24/7
  // worker means the brain trains on real data server-side regardless of what the
  // browser is displaying — so in those cases the warning is false and must stay
  // hidden. (Previously it fired whenever mode !== 'live', which over-warned on
  // every page that simply hadn't confirmed a live binding yet.)
  setTimeout(() => {
    try {
      const banner = document.getElementById('bp-demo-banner');
      if (!banner) return;
      const update = () => {
        let demoOn = false;
        try { demoOn = localStorage.getItem('bpleone_demo_mode') === '1'; } catch (e) {}
        let liveProvider = false;
        try { liveProvider = (typeof DataProvider !== 'undefined' && DataProvider.getStatus && DataProvider.getStatus().status === 'connected'); } catch (e) {}
        let workerBrain = false;
        try { workerBrain = (typeof WorkerBridge !== 'undefined' && WorkerBridge.isEnabled && WorkerBridge.isEnabled()); } catch (e) {}
        const realData = liveProvider || workerBrain || (window.BPLEONE_DATA_MODE === 'live');
        banner.style.display = (demoOn && !realData) ? 'block' : 'none';
      };
      update();
      window.addEventListener('bpleone:data-mode', update);
      try { if (typeof DataProvider !== 'undefined' && DataProvider.onStatus) DataProvider.onStatus(update); } catch (e) {}
    } catch (e) {}
  }, 100);

  const navHtml = ''
    + demoBanner
    + '<div class="ticker-tape"><div class="ticker-content" id="ticker-content"></div></div>'
    + '<nav class="navbar"><div class="nav-container">'
    + '<a href="index.html" class="logo"><div class="logo-mark">BP</div>'
    + '<span>bpleone <span style="color:var(--accent);font-weight:400">/ trade</span></span></a>'
    + '<a href="https://bpleone.com" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;margin-left:14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:14px;color:var(--text-secondary);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;text-decoration:none;transition:all 0.15s;" onmouseover="this.style.borderColor=\'var(--accent)\';this.style.color=\'var(--accent)\';" onmouseout="this.style.borderColor=\'var(--border)\';this.style.color=\'var(--text-secondary)\';" title="Back to the bpleone.com hub">← Hub</a>'
    + '<div id="nav-live-pulse" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;margin-left:10px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.4);border-radius:14px;color:#10b981;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;" title="Brain is alive and ticking"><span id="nav-pulse-dot" style="width:7px;height:7px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981;animation:bpleonePulse 1.5s ease-in-out infinite;"></span><span id="nav-pulse-text">LIVE</span></div>'
    + '<ul class="nav-links">'
    + '<li><a href="start-here.html" class="' + (activePage==='start-here'?'active':'') + '" style="font-weight:800;color:var(--accent);" title="New here? 2-minute orientation">🧭 Start Here</a></li>'
    + '<li><a href="today.html" class="' + (activePage==='today'?'active':'') + '" style="font-weight:800;">📅 Today</a></li>'
    + '<li><a href="dashboard.html" class="' + (activePage==='dashboard'?'active':'') + '">Dashboard</a></li>'
    + '<li class="nav-dd"><a href="#" class="' + (isPlays?'active':'') + '">Daily ▾</a><div class="nav-dropdown">'
    +   '<a href="pick-of-day.html">🎯 Pick of the Day</a>'
    +   '<a href="options-lab.html">🤖 Options Play Lab</a>'
    +   '<a href="morning-brief.html">☀ Morning Brief</a>'
    +   '<a href="conviction-stack.html">⭐ Conviction Stack</a>'
    +   '<a href="trade-of-the-day.html">🎯 Trade of the Day</a>'
    +   '<a href="plays.html">⭐ Plays of the Day</a>'
    +   '<a href="pre-market.html">🌅 Pre-Market</a>'
    +   '<a href="signals.html">⚡ Live Signals</a>'
    +   '<a href="all-tools.html" style="opacity:0.65;">⋯ more →</a>'
    + '</div></li>'
    + '<li class="nav-dd"><a href="#" class="' + (isScan?'active':'') + '">🎯 Picks ▾</a><div class="nav-dropdown">'
    +   '<a href="pick-of-day.html">🎯 Pick of the Day</a>'
    +   '<a href="alpha-scanner.html">📡 Alpha Scanner</a>'
    +   '<a href="smart-money-confluence.html">🐳 Smart-Money Confluence</a>'
    +   '<a href="edge-scorecard.html">📊 Edge Scorecard</a>'
    +   '<a href="algo-signals.html">⚡ Algo Signals</a>'
    +   '<a href="hot-movers.html">🔥 Hot Movers</a>'
    +   '<a href="all-tools.html" style="opacity:0.65;">⋯ more →</a>'
    + '</div></li>'
    + '<li class="nav-dd"><a href="#" class="' + (isBrain?'active':'') + '">🧠 Brain ▾</a><div class="nav-dropdown">'
    +   '<a href="proof.html">🔬 Is it real? (Proof) <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">AUDIT</span></a>'
    +   '<a href="edge-scorecard.html">📊 Edge Scorecard</a>'
    +   '<a href="edge-lab.html">🔬 Edge Lab</a>'
    +   '<a href="constraints.html">🎛 Signal Constraints</a>'
    +   '<a href="money-made.html">💵 Money Made</a>'
    +   '<a href="brain-hub.html">🧠 Brain Hub</a>'
    +   '<a href="brain-proof.html">🔬 Brain Modules</a>'
    +   '<a href="all-tools.html" style="opacity:0.65;">⋯ more →</a>'
    + '</div></li>'
    + '<li class="nav-dd"><a href="#" class="' + (isMarkets?'active':'') + '">📰 Data ▾</a><div class="nav-dropdown">'
    +   '<a href="news.html">📰 News</a>'
    +   '<a href="insider-live.html">🏛 Insider Trades</a>'
    +   '<a href="congress-trades.html">🏛 Congress</a>'
    +   '<a href="economic-events.html">🏦 Economic Events</a>'
    +   '<a href="earnings-calendar.html">📅 Earnings</a>'
    +   '<a href="vix-pulse.html">🌡 VIX Pulse</a>'
    +   '<a href="breadth-pro.html">📊 Breadth</a>'
    +   '<a href="all-tools.html" style="opacity:0.65;">⋯ more →</a>'
    + '</div></li>'
    + '<li class="nav-dd"><a href="#" class="' + ((isTools||isTrade)?'active':'') + '">🛠 Tools ▾</a><div class="nav-dropdown">'
    +   '<a href="fundamentals.html">📊 Fundamentals</a>'
    +   '<a href="options-pricer.html">🧮 Options Pricer</a>'
    +   '<a href="backtester.html">🔁 Backtester</a>'
    +   '<a href="journal.html">📓 Journal</a>'
    +   '<a href="alerts.html">🔔 Alerts</a>'
    +   '<a href="position-sizing.html">📐 Position Sizing</a>'
    +   '<a href="watchlists.html">⭐ Watchlists</a>'
    +   '<a href="settings.html">⚙ Settings</a>'
    +   '<a href="all-tools.html" style="font-weight:700;">⋯ All tools (full catalog) →</a>'
    + '</div></li>'
    + '</ul>'
    + '<div class="nav-actions">'
    + '<a id="dataStatusPill" href="settings.html" title="Data feed status — click to configure" class="data-pill data-pill-mock"><span class="data-pill-dot"></span><span class="data-pill-label">MOCK</span></a>'
    + '<form id="navSearchForm" class="nav-search" style="display:flex;align-items:center;gap:4px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:3px 4px 3px 10px;"><span style="font-size:12px;color:var(--text-muted);">🔍</span><input id="navSearch" placeholder="Search symbol or page…" autocomplete="off" style="background:transparent;border:none;outline:none;color:var(--text-primary);font-size:12px;width:160px;font-family:inherit;text-transform:uppercase;"></form>'
    + '<button id="cmdkBtn" title="Search & navigate (⌘K)" class="btn btn-ghost" style="padding:6px 10px;font-size:11px;font-family:var(--font-mono);">⌘K</button>'
    + '<button id="refreshDataBtn" title="Refresh all market data" class="btn btn-ghost" style="padding:6px 10px;color:var(--accent);">🔄</button>'
    + '<button id="themeBtn" title="Toggle theme" class="btn btn-ghost" style="padding:6px 10px;">🌓</button>'
    + '<button id="notifyBtn" title="Enable signal alerts" class="btn btn-ghost" style="padding:6px 10px;">🔔</button>'
    + '<span class="feat-badge feat-new" style="font-size:10px;padding:3px 10px;">🎉 FREE BETA</span>'
    + '<a href="about.html#subscribe" class="btn btn-primary" style="font-size:11px;padding:6px 12px;">Subscribe (free)</a>'
    + '</div></div></nav>';
  const slot = document.getElementById('site-nav');
  if (slot) slot.innerHTML = navHtml;
  buildTicker();
  buildMobileTabs(activePage);
  wireDataPill();
  const cmdkBtn = document.getElementById('cmdkBtn');
  if (cmdkBtn && window.CmdPalette) cmdkBtn.addEventListener('click', () => CmdPalette.open());
  // Wire nav search: short ticker (1-5 chars) → ticker.html, otherwise open ⌘K
  const navSearchForm = document.getElementById('navSearchForm');
  if (navSearchForm) {
    navSearchForm.addEventListener('submit', e => {
      e.preventDefault();
      const v = (document.getElementById('navSearch').value || '').trim().toUpperCase();
      if (!v) return;
      if (/^[A-Z]{1,6}(\.[A-Z]+)?$/.test(v)) {
        location.href = 'ticker.html?sym=' + v;
      } else {
        if (window.CmdPalette) { CmdPalette.open(); setTimeout(() => { const i = document.querySelector('.cmdk-input'); if (i) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } }, 50); }
      }
    });
  }
  const refreshBtn = document.getElementById('refreshDataBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const orig = refreshBtn.textContent;
      refreshBtn.textContent = '⏳';
      refreshBtn.disabled = true;
      let count = 0;
      try {
        if (typeof DataProvider !== 'undefined' && DataProvider.refreshAll) {
          const updated = await DataProvider.refreshAll();
          count = updated ? updated.length : 0;
        }
        if (window.Toast) Toast.show(count ? '✓ Refreshed ' + count + ' symbols' : 'Refresh fired', { kind: 'success' });
        // Force ticker re-render
        if (typeof Feed !== 'undefined' && typeof QUOTES !== 'undefined') Feed.publish('*', QUOTES);
      } catch (e) {
        if (window.Toast) Toast.show('Refresh failed: ' + e.message, { kind: 'error' });
      } finally {
        refreshBtn.textContent = orig;
        refreshBtn.disabled = false;
      }
    });
  }
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    const sync = () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      themeBtn.textContent = isLight ? '🌙' : '🌓';
      themeBtn.title = isLight ? 'Switch to dark theme' : 'Switch to light theme';
    };
    sync();
    themeBtn.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const next = isLight ? 'dark' : 'light';
      if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem('bpleone_theme_v1', next); } catch (e) {}
      sync();
      if (window.Toast) Toast.show('Theme: ' + next, { kind: 'info' });
    });
  }
  const nb = document.getElementById('notifyBtn');
  if (nb && typeof Notify !== 'undefined') {
    function refreshLabel() {
      const p = Notify.permission();
      nb.textContent = p === 'granted' ? (Notify.isMuted() ? '🔕' : '🔔') : '🔔';
      nb.title = p === 'granted' ? 'Notifications on — click to mute' : (p === 'denied' ? 'Notifications blocked' : 'Enable signal alerts');
    }
    refreshLabel();
    nb.addEventListener('click', async () => {
      const p = Notify.permission();
      if (p === 'granted') {
        Notify.setMuted(!Notify.isMuted());
        if (!Notify.isMuted()) Notify.fire('Alerts unmuted', 'You will be pinged on big movers and signals.');
      } else {
        const r = await Notify.request();
        if (r === 'granted') Notify.testPing();
      }
      refreshLabel();
    });
  }
}

function buildMobileTabs(activePage) {
  // Idempotent — if already injected, just update active state
  let bar = document.querySelector('.mobile-tab-bar');
  const tabs = [
    { key: 'game-plan',   icon: '📋', label: 'Plan',    url: 'game-plan.html' },
    { key: 'hot-movers',  icon: '🔥', label: 'Movers',  url: 'hot-movers.html' },
    { key: 'plays',       icon: '⭐', label: 'Plays',   url: 'plays.html' },
    { key: 'ticker',      icon: '🔍', label: 'Ticker',  url: 'ticker.html' },
    { key: 'assistant',   icon: '🤖', label: 'AI',      url: 'assistant.html' }
  ];
  if (!bar) {
    bar = document.createElement('nav');
    bar.className = 'mobile-tab-bar';
    document.body.appendChild(bar);
  }
  bar.innerHTML = tabs.map(t => `<a href="${t.url}" class="${t.key === activePage ? 'active' : ''}"><span class="icon">${t.icon}</span><span>${t.label}</span></a>`).join('');
}

function wireDataPill() {
  const pill = document.getElementById('dataStatusPill');
  if (!pill) return;
  // Real (delayed) prices flow from the worker feed even when no live WS is
  // connected, so the pill must NOT cry "MOCK" in that case — that mislabels real
  // data (seen on pick-of-day before an MD demo). Check for any real (non-seed) source.
  const hasRealPrices = () => {
    try {
      const Q = (typeof QUOTES !== 'undefined') ? QUOTES : {};
      return ['SPY', 'QQQ', 'DIA', 'IWM', 'BTC', 'ETH'].some(k => {
        const q = Q[k];
        return q && q.priceSource && q.priceSource !== 'stale-seed' && q.priceSource !== 'mock';
      });
    } catch (e) { return false; }
  };
  const render = (s) => {
    s = s || {};
    let cls = 'mock', label = 'MOCK';
    const sess = (typeof detectSession === 'function') ? detectSession() : 'open';
    if (s.status === 'connected') {
      // A connected WS streams crypto in real time, but equities are only live in
      // regular US hours; outside them the printed equity price is last-close. Gate
      // on the ET clock (detectSession), not a racy liveAt age.
      if (sess !== 'open') { cls = 'connecting'; label = 'DELAYED · LAST CLOSE'; }
      else { cls = 'live'; label = 'LIVE · ' + (s.provider || '').toUpperCase(); }
    }
    else if (s.status === 'connecting') { cls = 'connecting'; label = 'CONNECTING'; }
    else if (s.status === 'reconnecting') { cls = 'connecting'; label = 'RECONNECTING'; }
    else if (s.status === 'error') { cls = 'error'; label = 'ERROR'; }
    else if (hasRealPrices()) {
      // No live WS, but real (delayed) prices ARE flowing from the worker feed —
      // honest label by the market clock, never "MOCK".
      if (sess !== 'open') { cls = 'connecting'; label = 'DELAYED · LAST CLOSE'; }
      else { cls = 'connecting'; label = 'DELAYED ~15 MIN'; }
    }
    else if (s.status === 'disconnected' && s.enabled) { cls = 'mock'; label = 'OFFLINE'; }
    pill.className = 'data-pill data-pill-' + cls;
    const lab = pill.querySelector('.data-pill-label');
    if (lab) lab.textContent = label;
  };
  if (typeof DataProvider !== 'undefined') {
    try {
      DataProvider.onStatus(render);
      // Re-evaluate periodically: worker-quotes can land real prices without the WS
      // firing another status event, and the market session changes over time.
      setInterval(() => { try { render(DataProvider.getStatus()); } catch (e) {} }, 8000);
      return;
    } catch (e) {}
  }
  // Fallback: page didn't import data-provider.js — read localStorage so we still
  // reflect user's configured state even without the module on this page.
  try {
    const raw = localStorage.getItem('bpleone_data_v1');
    if (raw) {
      const c = JSON.parse(raw);
      render({ status: c.enabled && c.provider !== 'mock' ? 'connected' : 'mock', provider: c.provider, enabled: c.enabled });
      return;
    }
  } catch (e) {}
  render({ status: 'mock', provider: 'mock', enabled: false });
}

function buildFooter() {
  const f = document.getElementById('site-footer');
  if (!f) return;
  // Compact footer — full all-tools page is one click away.
  // Earlier versions had 120+ links here causing "endless scroll" on
  // narrow viewports. Now: 5 items per column + "View all" link.
  f.innerHTML = ''
    + '<footer class="footer"><div class="footer-container">'
    + '<div class="footer-brand"><h3>bpleone / trade</h3>'
    + '<p>Real-data options &amp; technical-analysis research, with a self-learning brain that states its edge plainly — and admits what is still unproven. Research, not investment advice.</p></div>'
    + '<div class="footer-col"><h4>💰 Money</h4><ul>'
    + '<li><a href="money-made.html">Money Made</a></li>'
    + '<li><a href="make-money.html">Make Money Dashboard</a></li>'
    + '<li><a href="auto-trade.html">Auto-Trade</a></li>'
    + '<li><a href="how-to-make-money.html">How-to Guide</a></li>'
    + '<li><a href="money-site-map.html"><strong>View all money tools →</strong></a></li>'
    + '</ul></div>'
    + '<div class="footer-col"><h4>📈 Trading</h4><ul>'
    + '<li><a href="dashboard.html">Dashboard</a></li>'
    + '<li><a href="hot-movers.html">Hot Movers</a></li>'
    + '<li><a href="sector-flow.html">Sector Flow</a></li>'
    + '<li><a href="technical-analysis.html">TA Scanner</a></li>'
    + '<li><a href="all-tools.html"><strong>View all trading tools →</strong></a></li>'
    + '</ul></div>'
    + '<div class="footer-col"><h4>🧠 Brain &amp; Tools</h4><ul>'
    + '<li><a href="brain-hub.html">Brain Hub</a></li>'
    + '<li><a href="high-conviction-alerts.html">Alerts</a></li>'
    + '<li><a href="risk-dashboard.html">Risk</a></li>'
    + '<li><a href="journal.html">Journal</a></li>'
    + '<li><a href="settings.html">Settings</a></li>'
    + '<li><a href="all-tools.html"><strong>View all tools (350+) →</strong></a></li>'
    + '</ul></div>'
    + '<div class="footer-col"><h4>Company</h4><ul>'
    + '<li><a href="about.html">About</a></li>'
    + '<li><a href="education.html">Education</a></li>'
    + '<li><a href="about.html#subscribe">Subscribe</a></li>'
    + '<li><a href="about.html#disclosure">Disclosures</a></li>'
    + '</ul></div>'
    + '</div>'
    + '<div style="max-width:1400px;margin:0 auto;"><div class="disclaimer">'
    + '<strong>Risk Disclosure:</strong> Content on bpleone.com is for educational and informational purposes only and is not investment advice or a recommendation to buy or sell any security. Options trading involves substantial risk of loss and is not suitable for every investor. Past performance is not indicative of future results. Always consult a licensed financial advisor before making investment decisions.'
    + '</div></div>'
    + '<div class="footer-bottom"><div>© 2026 bpleone. All rights reserved.</div><div>Made in Southern California · self-learning since day one</div></div>'
    + '</footer>';
}

function detectSession() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const h = et.getHours();
  const m = et.getMinutes();
  const isWeekday = day >= 1 && day <= 5;
  if (!isWeekday) return 'closed';
  if ((h === 9 && m >= 30) || (h > 9 && h < 16)) return 'open';
  if (h < 9 || (h === 9 && m < 30)) return 'pre-market';
  if (h >= 16 && h < 20) return 'after-hours';
  return 'closed';
}
window.detectSession = detectSession;

function startMarketClock() {
  const els = document.querySelectorAll('#market-clock');
  if (!els.length) return;
  const update = () => {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const sess = detectSession();
    let status = 'CLOSED', color = 'red';
    if (sess === 'open') { status = 'OPEN'; color = 'green'; }
    else if (sess === 'pre-market') { status = 'PRE-MARKET'; color = 'yellow'; }
    else if (sess === 'after-hours') { status = 'AFTER HOURS'; color = 'yellow'; }
    const timeStr = et.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    els.forEach(el => {
      el.innerHTML = '<span class="signal-dot ' + color + '"></span> ' + status + ' · <span class="mono">' + timeStr + ' ET</span>';
    });
    // Also update the data-pill secondary label if it exists
    const pill = document.getElementById('dataStatusPill');
    if (pill && !pill.dataset.sessionPainted) {
      // First call — append a session sub-label
      const lab = pill.querySelector('.data-pill-label');
      if (lab && !pill.querySelector('.data-pill-session')) {
        const sLab = document.createElement('span');
        sLab.className = 'data-pill-session';
        sLab.style.cssText = 'font-size:9px;margin-left:6px;padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.08);';
        pill.appendChild(sLab);
      }
    }
    const sLab = pill && pill.querySelector('.data-pill-session');
    if (sLab) {
      sLab.textContent = sess === 'open' ? 'OPEN' : sess === 'pre-market' ? 'PRE' : sess === 'after-hours' ? 'AH' : 'CLOSED';
      sLab.style.color = sess === 'open' ? 'var(--green)' : sess === 'pre-market' || sess === 'after-hours' ? 'var(--yellow)' : 'var(--red)';
    }
  };
  update();
  setInterval(update, 1000);
}

function initTabs() {
  document.querySelectorAll('.tabs').forEach(tabBar => {
    const buttons = tabBar.querySelectorAll('.tab-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        const group = tabBar.dataset.group;
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('[data-tab-group="' + group + '"]').forEach(c => c.classList.remove('active'));
        const el = document.querySelector('[data-tab-content="' + target + '"][data-tab-group="' + group + '"]') || document.querySelector('[data-tab-content="' + target + '"]');
        if (el) el.classList.add('active');
      });
    });
  });
}

function initSubscribe() {
  document.querySelectorAll('.subscribe-form').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = form.querySelector('.subscribe-input');
      const email = input.value.trim();
      if (!email || email.indexOf('@') === -1) { input.style.borderColor = 'var(--red)'; return; }
      form.innerHTML = '<div style="padding:16px;background:var(--green-bg);border:1px solid rgba(16,185,129,0.3);border-radius:8px;color:var(--green);font-weight:600;">✓ Welcome to the desk — check your inbox for confirmation.</div>';
      try { localStorage.setItem('bpleone_subscriber', email); } catch (err) {}
    });
  });
}

function initFilters() {
  document.querySelectorAll('.filter-group').forEach(group => {
    const buttons = group.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        const target = group.dataset.target;
        if (!target || !filter) return;
        document.querySelectorAll('[data-filter-target="' + target + '"] tbody tr').forEach(row => {
          const cat = row.dataset.cat || '';
          row.style.display = (filter === 'all' || cat === filter) ? '' : 'none';
        });
      });
    });
  });
}

function initSort() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const table = th.closest('table');
      const tbody = table.querySelector('tbody');
      const idx = [...th.parentNode.children].indexOf(th);
      const numeric = th.dataset.type === 'num';
      const asc = th.dataset.asc !== 'true';
      th.dataset.asc = asc;
      const rows = [...tbody.querySelectorAll('tr')];
      rows.sort((a, b) => {
        const av = a.children[idx].textContent.replace(/[$,%+]/g,'').trim();
        const bv = b.children[idx].textContent.replace(/[$,%+]/g,'').trim();
        if (numeric) return asc ? parseFloat(av) - parseFloat(bv) : parseFloat(bv) - parseFloat(av);
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

function initSearch() {
  document.querySelectorAll('.search-input[data-search-target]').forEach(input => {
    input.addEventListener('input', () => {
      const q = input.value.trim().toUpperCase();
      const target = input.dataset.searchTarget;
      document.querySelectorAll('[data-filter-target="' + target + '"] tbody tr').forEach(row => {
        const txt = row.textContent.toUpperCase();
        row.style.display = txt.indexOf(q) !== -1 ? '' : 'none';
      });
    });
  });
}

// Sticky brain-status footer — slim bar at the very bottom of every page
// that shows the live brain coach headline + key metrics. Polls BrainCoach
// once it's available. Persists user dismissal preference.
function initBrainStatusBar() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (document.getElementById('brain-status-bar')) return;
  // Skip if user previously dismissed
  try { if (localStorage.getItem('bpleone_status_bar_dismissed') === '1') return; } catch (e) {}

  const bar = document.createElement('div');
  bar.id = 'brain-status-bar';
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:1000;background:rgba(10,16,24,0.96);backdrop-filter:blur(10px);border-top:1px solid var(--border);padding:8px 18px;display:none;align-items:center;gap:14px;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;color:var(--text-secondary);';
  bar.innerHTML = ''
    + '<span id="bsb-dot" style="width:8px;height:8px;border-radius:50%;background:var(--text-muted);box-shadow:0 0 6px var(--text-muted);"></span>'
    + '<span id="bsb-headline" style="font-weight:700;color:var(--text-primary);">Brain status loading…</span>'
    + '<span id="bsb-metrics" style="font-family:var(--font-mono);color:var(--text-muted);font-size:11px;"></span>'
    + '<span style="flex:1;"></span>'
    + '<a href="brain-coach-live.html" style="color:var(--accent);text-decoration:none;font-weight:700;font-size:11px;">Coach →</a>'
    + '<a href="brain-truth.html" style="color:var(--accent);text-decoration:none;font-weight:700;font-size:11px;">All modules →</a>'
    + '<button id="bsb-close" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;" title="Dismiss for this browser">×</button>';
  document.body.appendChild(bar);

  const close = document.getElementById('bsb-close');
  if (close) close.onclick = () => {
    bar.style.display = 'none';
    try { localStorage.setItem('bpleone_status_bar_dismissed', '1'); } catch (e) {}
  };

  function refresh() {
    if (typeof window.BrainCoach === 'undefined') { setTimeout(refresh, 2000); return; }
    try {
      const s = window.BrainCoach.summary();
      bar.style.display = 'flex';
      const dot = document.getElementById('bsb-dot');
      dot.style.background = s.headlineColor;
      dot.style.boxShadow = '0 0 6px ' + s.headlineColor;
      dot.style.animation = 'bpleonePulse 1.5s ease-in-out infinite';
      document.getElementById('bsb-headline').textContent = s.headline;
      document.getElementById('bsb-headline').style.color = s.headlineColor;
      let metrics = 'Health ' + s.healthScore + '/100';
      if (s.snapshot.bss != null) metrics += ' · BSS ' + (s.snapshot.bss >= 0 ? '+' : '') + s.snapshot.bss.toFixed(2);
      if (s.snapshot.sharpe != null) metrics += ' · Sharpe ' + s.snapshot.sharpe.toFixed(2);
      if (s.alertCount > 0) metrics += ' · ⚠ ' + s.alertCount + ' alerts';
      document.getElementById('bsb-metrics').textContent = metrics;
    } catch (e) {}
  }
  refresh();
  setInterval(refresh, 30000);
  // Also refresh on every brain cycle for instant update
  window.addEventListener('bpleone:continuous-cycle', refresh);
}

// Heartbeat handler: visible nav-pulse tick + text updates on every cycle
function initLivePulseTicker() {
  if (typeof window === 'undefined') return;
  let lastCycle = Date.now();
  let cycleCount = 0;
  let liveDataConnected = false;

  // Subscribe to brain cycle events to update pill text
  window.addEventListener('bpleone:continuous-cycle', (e) => {
    cycleCount++;
    lastCycle = Date.now();
    const text = document.getElementById('nav-pulse-text');
    const dot = document.getElementById('nav-pulse-dot');
    if (text) {
      const d = e.detail || {};
      if (d.captured > 0 || d.resolved > 0) {
        text.textContent = '+' + (d.captured || 0) + 'p ' + (d.resolved || 0) + 'r';
        setTimeout(() => { if (text) text.textContent = 'LIVE'; }, 4000);
      }
    }
    if (dot) {
      dot.style.animation = 'none';
      // Force reflow so animation restarts
      void dot.offsetWidth;
      dot.style.animation = 'bpleoneTick 0.6s ease-out, bpleonePulse 1.5s ease-in-out infinite 0.6s';
    }
  });

  // Heartbeat ticker — colors the dot brighter on each tick
  window.addEventListener('bpleone:heartbeat', () => {
    const dot = document.getElementById('nav-pulse-dot');
    if (dot && !dot.style.animation.includes('bpleoneTick')) {
      // Brief flash if not already animating
      dot.style.transition = 'transform 0.2s';
      dot.style.transform = 'scale(1.4)';
      setTimeout(() => { if (dot) dot.style.transform = 'scale(1)'; }, 200);
    }
  });

  // Watchdog: if no cycle for 90s, show STALE — BUT only when the browser is the
  // brain. When the 24/7 Cloudflare worker is authoritative (WorkerBridge), the
  // browser tick intentionally defers, so a stalled local cycle does NOT mean the
  // brain is dead. A red "STALE" there is misleading and even contradicts the
  // footer's "Brain is HEALTHY"; the worker's true health is reported separately.
  setInterval(() => {
    const ageMs = Date.now() - lastCycle;
    const text = document.getElementById('nav-pulse-text');
    const dot = document.getElementById('nav-pulse-dot');
    const pill = document.getElementById('nav-live-pulse');
    if (!text || !dot || !pill) return;
    let workerBrain = false;
    try { workerBrain = (typeof WorkerBridge !== 'undefined') && WorkerBridge.isEnabled && WorkerBridge.isEnabled(); } catch (e) {}
    if (ageMs > 90 * 1000 && !workerBrain) {
      text.textContent = 'STALE';
      dot.style.background = 'var(--red)';
      dot.style.boxShadow = '0 0 8px var(--red)';
      pill.style.background = 'rgba(239,68,68,0.12)';
      pill.style.borderColor = 'rgba(239,68,68,0.4)';
      pill.style.color = 'var(--red)';
    }
  }, 15000);

  // Session-aware label: change "LIVE" to "AFTER" / "PRE" / "CLOSED" outside RTH
  // so the pill doesn't lie about market state on weekends/nights.
  // Also detect whether the underlying source is realtime (Finnhub/Polygon/
  // CoinbaseWS) or delayed (Stooq) and tell the user the truth.
  setInterval(() => {
    const text = document.getElementById('nav-pulse-text');
    const dot = document.getElementById('nav-pulse-dot');
    const pill = document.getElementById('nav-live-pulse');
    if (!text || !dot || !pill) return;
    if (text.textContent === 'STALE' || text.textContent.indexOf('+') === 0) return;
    const sess = (typeof detectSession === 'function') ? detectSession() : 'open';
    // Determine if any QUOTE has a real-time source vs delayed (Stooq)
    let realtimeCount = 0, delayedCount = 0;
    try {
      if (typeof QUOTES !== 'undefined') {
        for (const sym in QUOTES) {
          const src = QUOTES[sym].priceSource || QUOTES[sym].source;
          if (!src) continue;
          const s = String(src).toLowerCase();
          if (s.indexOf('finnhub') !== -1 || s.indexOf('polygon') !== -1 || s.indexOf('alpaca') !== -1 || s.indexOf('tradier') !== -1 || (s.indexOf('coinbase') !== -1 && s.indexOf('refresh') === -1 && s.indexOf('rest') === -1)) realtimeCount++;
          else if (s.indexOf('stooq') !== -1 || s.indexOf('coinbase-rest') !== -1 || s.indexOf('refresh') !== -1) delayedCount++;
        }
      }
    } catch (e) {}
    const hasRT = realtimeCount > delayedCount && realtimeCount > 0;
    if (sess === 'open') {
      if (hasRT) {
        text.textContent = 'LIVE';
        dot.style.background = '#10b981';
        dot.style.boxShadow = '0 0 8px #10b981';
        pill.style.background = 'rgba(16,185,129,0.12)';
        pill.style.borderColor = 'rgba(16,185,129,0.4)';
        pill.style.color = '#10b981';
        pill.title = 'Real-time data feed — tick-level updates';
      } else {
        text.textContent = 'DELAYED';
        dot.style.background = 'var(--yellow)';
        dot.style.boxShadow = '0 0 8px var(--yellow)';
        pill.style.background = 'rgba(245,158,11,0.12)';
        pill.style.borderColor = 'rgba(245,158,11,0.4)';
        pill.style.color = 'var(--yellow)';
        pill.title = 'Stooq free tier — ~15 min delayed. Click for details / upgrade to real-time.';
        // Make the pill click through to live-status
        if (!pill._clickWired) {
          pill.style.cursor = 'pointer';
          pill.addEventListener('click', () => { window.location.href = 'live-status.html'; });
          pill._clickWired = true;
        }
      }
    } else if (sess === 'pre-market') {
      text.textContent = 'PRE';
      dot.style.background = 'var(--yellow)';
      dot.style.boxShadow = '0 0 8px var(--yellow)';
      pill.style.background = 'rgba(245,158,11,0.12)';
      pill.style.borderColor = 'rgba(245,158,11,0.4)';
      pill.style.color = 'var(--yellow)';
      pill.title = 'Pre-market session — ticker may be thin';
    } else if (sess === 'after-hours') {
      text.textContent = 'AFTER';
      dot.style.background = 'var(--yellow)';
      dot.style.boxShadow = '0 0 8px var(--yellow)';
      pill.style.background = 'rgba(245,158,11,0.12)';
      pill.style.borderColor = 'rgba(245,158,11,0.4)';
      pill.style.color = 'var(--yellow)';
      pill.title = 'After-hours — ticker shows session close';
    } else {
      text.textContent = 'CLOSED';
      dot.style.background = 'var(--text-muted)';
      dot.style.boxShadow = '0 0 6px var(--text-muted)';
      pill.style.background = 'rgba(120,140,160,0.10)';
      pill.style.borderColor = 'rgba(120,140,160,0.3)';
      pill.style.color = 'var(--text-muted)';
      pill.title = 'Market closed — ticker shows last close';
    }
  }, 8000);
}

// Force live-data attempt on every page load. Stooq + Coinbase free polling
// start automatically via DataProvider.init() — no key needed for real prices.
// Configuring Finnhub/Polygon UPGRADES equities to real-time WebSocket ticks.
function tryAutoConnectLiveData() {
  if (typeof window === 'undefined' || !window.DataProvider) return;
  try {
    // Always init — boots Stooq/Coinbase fallbacks AND any configured WS provider
    if (window.DataProvider.init) window.DataProvider.init();
    // If a real-time WS provider is configured but disconnected, kick reconnect
    const status = window.DataProvider.getStatus && window.DataProvider.getStatus();
    if (status && status.enabled && status.provider && status.provider !== 'mock' && status.provider !== 'stooq' && status.status !== 'connected') {
      if (window.DataProvider.reconnect) window.DataProvider.reconnect();
    }
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  buildFooter();
  startMarketClock();
  initTabs();
  initSubscribe();
  initFilters();
  initSort();
  initSearch();
  initLivePulseTicker();
  // Try live data immediately on load + every 5 min thereafter
  setTimeout(tryAutoConnectLiveData, 1500);
  setInterval(tryAutoConnectLiveData, 5 * 60 * 1000);
  // Give BrainCoach time to load (lazy-loaded by live.js) before showing bar
  setTimeout(initBrainStatusBar, 4000);
});
