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
(function loadCompanions() {
  const want = ['js/toast.js', 'js/command-palette.js', 'js/hotkeys.js', 'js/onboarding.js', 'js/recent-tickers.js', 'js/symbol-linker.js', 'js/model.js', 'js/brain-loop.js', 'js/data-mode-banner.js'];
  const have = new Set([...document.querySelectorAll('script[src]')].map(s => {
    try { return new URL(s.src, location.href).pathname.split('/').slice(-2).join('/'); } catch (e) { return s.src; }
  }));
  want.forEach(rel => {
    const key = rel;
    if (have.has(key) || [...document.querySelectorAll('script[src]')].some(s => s.src.endsWith(rel))) return;
    const s = document.createElement('script');
    s.src = rel;
    s.async = false;
    document.head.appendChild(s);
  });
})();

const TICKER_SYMBOLS = ['SPY','QQQ','IWM','DIA','AAPL','NVDA','TSLA','MSFT','META','AMZN','GOOGL','AMD','BTC','ETH','VIX','GLD','TLT','USO','SMCI','PLTR','COIN'];

let _tickerSubscribed = false;
function buildTicker() {
  const tape = document.getElementById('ticker-content');
  if (!tape) return;
  const src = (typeof QUOTES !== 'undefined') ? QUOTES : null;
  const list = TICKER_SYMBOLS.map(s => {
    if (src && src[s] && src[s].last != null) return { sym: s, px: src[s].last, chg: src[s].changePct || 0, fresh: !!src[s].fresh };
    return null;
  }).filter(Boolean);
  // If QUOTES not ready yet, retry shortly. Don't use stale hardcoded fallback.
  if (list.length === 0) {
    tape.innerHTML = '<span class="ticker-item" style="opacity:0.5;">loading market data…</span>';
    setTimeout(buildTicker, 500);
    return;
  }
  const html = [...list, ...list].map(t => {
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
  document.querySelectorAll('[data-ticker-sym="' + sym + '"]').forEach(el => {
    const priceEl = el.querySelector('.ticker-price');
    const chgEl = el.querySelector('.ticker-change');
    if (priceEl) priceEl.textContent = '$' + q.last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (chgEl) {
      const arrow = (q.changePct || 0) >= 0 ? '▲' : '▼';
      chgEl.textContent = arrow + ' ' + Math.abs(q.changePct || 0).toFixed(2) + '%';
      chgEl.classList.toggle('up', (q.changePct || 0) >= 0);
      chgEl.classList.toggle('down', (q.changePct || 0) < 0);
    }
    if (q.fresh) el.style.opacity = '1';
  });
}

function buildNav(activePage) {
  activePage = activePage || '';
  const playsGrp = ['totd','plays','signals','earnings','earnings-preview','pre-market','zero-dte','setup-wizard','paper-trade','game-plan','hot-movers','squeeze-radar','trade-plan'];
  const tradeGrp = ['flow','chain','ta','momentum','market-internals','smart-money','heatmap','watchlists','vol-surface','gex','tape','sectors','pairs','calendar-analyzer','vol-cone','dark-pool','short-interest','etf-flows','volume-profile','order-flow','ticker','multi-leg-builder','bracket-builder','spread-scanner','wheel','correlation'];
  // Daily workflow group — top of funnel
  const dailyGrp = ['morning-brief','daily-debrief','tomorrow-playbook','friday-summary','catalyst-clock','ai-narrative','daily-stats','conviction-stack','game-plan'];
  // Brain & ML group
  const brainGrp = ['brain-heartbeat','brain-audit','brain-decisions','discoveries','ml-feedback','edge-analytics','edge','learn-dashboard','learn','learn-engine-explained','live-train','train-history','weight-heatmap','assistant','ai-scout','ai-cotrader','setup-library','position-stacking','model-trainer','model-explorer','model-versions','feature-store','online-learning','model-confidence','feature-engineering','model-seed','brain-graph','ensemble','neural-net','cross-validation','learning-rate-tuner','prediction-replay','model-explain','model-compare','training-scheduler','ml-glossary','ml-status','active-learning','training-history','first-run-tour','model-results','model-pnl','brain-grade','auto-paper','calibration','brain-memory','daily-report','streak-tracker','risk-sizer-pro','missed-opportunities','ml-leaderboard','trade-of-the-day-pro','broker-prep','sentiment-vs-model','model-economy','brain-coach','scatter-finder','model-postmortem','model-export','brain-weekly-report','alert-rules-pro','model-what-if','model-symbols-leaderboard','trade-export','brain-live-feed','notification-log','setup-compare','brain-monthly-calendar','mobile-dashboard','brain-hub','brain-diary','cohort-analysis','jump-to','brain-vs-spy','brain-explained','smart-watchlist','portfolio-stress-test','brain-changelog','daily-routine','brain-snapshot','symbol-brain','time-of-day-brain','positions-live','pattern-library','brain-hotkeys','risk-limits','gut-check','trade-vs-plan','brain-evolution','performance-attribution-pro','brain-pulse','brain-questions','brain-tldr','trade-sizing-advisor','similar-trades','post-trade-debrief','emergency-stop','brain-vs-coin-flip','brain-rate-of-learning','multi-position-kelly','hall-of-fame','data-truth','live-data-setup','methodology','brain-health','historical-trainer','brain-monitor','continuous-learning','multi-horizon','brain-smoke-test','probability-calibration','walk-forward-backtest','outlier-detection','brain-conviction','trade-selectivity','conviction-tracker','brain-bet','feature-drift','feature-importance','conviction-alerts','prediction-uncertainty','symbol-bias','ensemble-agreement','brain-daily-report','knn-recall','unified-predictor','conformal-prediction','swa-tracker','meta-stacker','regime-calibration','uncertainty-training','module-leaderboard','hourly-performance','drawdown-protector','covariate-shift','adaptive-lr','brain-truth','brier-skill','sharpe-ratio','setup-performance','label-smoothing','dow-performance','sample-decay','hindsight-replay','confidence-penalty','trade-trust','auto-pause','isotonic-calibration','symbol-skill','symbol-sharpe','sector-performance'];
  // Scanners group
  const scanGrp = ['algo-signals','mean-reversion-scanner','trend-strength','confluence-scanner','radar','edge-scanner','hot-movers','squeeze-radar-pro','squeeze-composite','short-squeeze-alerts','pre-market-scanner','pre-market-gappers','after-hours-scanner','earnings-tonight','earnings-reactor','earnings-calendar','earnings','earnings-playbook','earnings-preview','screener','anomalies','ipo-calendar','pair-scanner','candlestick-scanner','news-reactions','comparison','symbol-diff','insider-live','congress-trades','insider-congress-flow','buybacks-tracker','dollar-leaders','sweep-counter','retracement-finder','pivot-finder','levels-engine'];
  // Markets group
  const marketsGrp = ['macro','market-internals','breadth-pro','market-map','heatmap','cross-asset-pulse','cross-asset-correlations','correlations-live','sectors','global-markets','yield-curve','economic-events','economic-clock','halt-tracker','moc-imbalance','risk-radar','vix-pulse','smart-rotation','sector-rotation','sector-flow','sector-snapshot','heat-clock','sentiment-heat','news','news-pulse','news-impact','smart-money'];
  // Tools group — calculators, risk, journal, settings, alerts, crypto, education
  const toolsGrp = ['risk','risk-dashboard','risk-attribution','risk-parity','risk-of-ruin','fundamentals','backtester','multi-backtest','potd-backtest','journal','trade-journal-pro','alerts','alerts-builder','alerts-feed','alerts-dashboard','crypto','crypto-derivatives','crypto-basis','crypto-commodities','portfolio-builder','position-sizing','kelly-sizer','pdt-dashboard','margin-calc','pnl-projector','execution','liquidity-health','strategies','setup-combos','api','seasonality','settings','mindset','changelog','replay','hypothetical','account','performance-attribution','all-tools','pwa-install','watchlist-share','desk-split','time-of-day-pnl','live-pnl-heatmap','day-pnl-calendar','squarespace-preview'];
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
  // Reveal logic — runs after DOMContentLoaded so window.BPLEONE_DATA_MODE is set.
  setTimeout(() => {
    try {
      const banner = document.getElementById('bp-demo-banner');
      if (!banner) return;
      const update = () => {
        const mode = window.BPLEONE_DATA_MODE || 'mock';
        banner.style.display = mode === 'live' ? 'none' : 'block';
      };
      update();
      window.addEventListener('bpleone:data-mode', update);
    } catch (e) {}
  }, 100);

  const navHtml = ''
    + demoBanner
    + '<div class="ticker-tape"><div class="ticker-content" id="ticker-content"></div></div>'
    + '<nav class="navbar"><div class="nav-container">'
    + '<a href="index.html" class="logo"><div class="logo-mark">BP</div>'
    + '<span>bpleone <span style="color:var(--accent);font-weight:400">/ trade</span></span></a>'
    + '<a href="https://bpleone.com" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;margin-left:14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:14px;color:var(--text-secondary);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;text-decoration:none;transition:all 0.15s;" onmouseover="this.style.borderColor=\'var(--accent)\';this.style.color=\'var(--accent)\';" onmouseout="this.style.borderColor=\'var(--border)\';this.style.color=\'var(--text-secondary)\';" title="Back to the bpleone.com hub">← Hub</a>'
    + '<ul class="nav-links">'
    + '<li><a href="dashboard.html" class="' + (activePage==='dashboard'?'active':'') + '">Dashboard</a></li>'
    + '<li class="nav-dd"><a href="#" class="' + (isPlays?'active':'') + '">Daily ▾</a>'
    + '<div class="nav-dropdown">'
    + '<a href="morning-brief.html">☀ Morning Brief <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">DAILY</span></a>'
    + '<a href="conviction-stack.html">⭐ Conviction Stack <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">A-TIER</span></a>'
    + '<a href="trade-of-the-day.html">🎯 Trade of the Day</a>'
    + '<a href="plays.html">⭐ Plays of the Day</a>'
    + '<a href="trade-coach.html">🎓 Trade Coach <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="catalyst-clock.html">⏰ Catalyst Clock</a>'
    + '<a href="ai-narrative.html">📝 AI Narrative</a>'
    + '<a href="daily-debrief.html">📊 Daily AI Debrief</a>'
    + '<a href="tomorrow-playbook.html">📋 Tomorrow\'s Playbook</a>'
    + '<a href="friday-summary.html">📅 Friday Review</a>'
    + '<a href="daily-stats.html">📊 Daily Stats</a>'
    + '<a href="game-plan.html">📋 Game Plan</a>'
    + '<a href="pre-market.html">🌅 Pre-Market Brief</a>'
    + '<a href="signals.html">⚡ Live Signals</a>'
    + '<a href="earnings-calendar.html">📅 Earnings Calendar</a>'
    + '<a href="earnings-preview.html">🔬 Earnings Preview <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="zero-dte.html">⚡ 0DTE Dashboard</a>'
    + '<a href="setup-wizard.html">🧙 Setup Wizard</a>'
    + '<a href="paper-trade.html">🎮 Paper Trading <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="game-plan.html">📋 Today\'s Game Plan <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="hot-movers.html">🔥 Hot Movers <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="squeeze-radar.html">⛓ Squeeze Radar <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="trade-plan.html">📋 Trade Plan Generator <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '</div></li>'
    + '<li class="nav-dd"><a href="#" class="' + (isTrade?'active':'') + '">Trade & Flow ▾</a>'
    + '<div class="nav-dropdown">'
    + '<a href="day-trader-pro.html">📈 Day Trader PRO <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="big-bets.html">💰 Big Bets Feed <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="strike-chaser.html">🎯 Strike Chaser</a>'
    + '<a href="options-flow.html">📡 Options Flow</a>'
    + '<a href="options-flow-live.html">📡 Live Options Flow</a>'
    + '<a href="sweep-counter.html">⚡ Sweep Counter</a>'
    + '<a href="flow-replay.html">🎬 Flow Replay</a>'
    + '<a href="trade-tape.html">🎞 Trade Tape</a>'
    + '<a href="dark-pool.html">🌑 Dark Pool</a>'
    + '<a href="dark-pool-pro.html">🌑 Dark Pool PRO <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="options-chain.html">⛓️ Options Chain</a>'
    + '<a href="options-pricer.html">🧮 Options Pricer</a>'
    + '<a href="options-builder.html">🛠 Options Builder</a>'
    + '<a href="pnl-diagram.html">📊 P&amp;L Diagram</a>'
    + '<a href="multi-leg-builder.html">🔧 Multi-Leg Builder</a>'
    + '<a href="bracket-builder.html">🎯 Bracket Builder</a>'
    + '<a href="spread-scanner.html">📊 Spread Scanner</a>'
    + '<a href="calendar-analyzer.html">📆 Calendar Analyzer</a>'
    + '<a href="calendar-plays.html">📅 Calendar Plays</a>'
    + '<a href="pair-trades.html">⚖ Pair Trades</a>'
    + '<a href="wheel.html">🎡 Wheel Tracker</a>'
    + '<a href="vol-surface.html">🌐 Vol Surface</a>'
    + '<a href="vol-cone.html">🌗 Vol Cone</a>'
    + '<a href="vol-term.html">📉 Vol Term Structure</a>'
    + '<a href="vix-pulse.html">📊 VIX Pulse</a>'
    + '<a href="iv-skew.html">📈 IV Skew + Surface</a>'
    + '<a href="iv-crush-tracker.html">💥 IV Crush Tracker</a>'
    + '<a href="options-skew-radar.html">📡 Skew Radar</a>'
    + '<a href="gex.html">🌀 Gamma Exposure</a>'
    + '<a href="gex-pro.html">🌀 GEX PRO <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="opex-tracker.html">📆 OPEX Tracker</a>'
    + '<a href="zero-dte.html">⚡ 0DTE Dashboard</a>'
    + '<a href="trade-ticket.html">🎯 Trade Ticket</a>'
    + '<a href="trade-blotter.html">📋 Trade Blotter</a>'
    + '<a href="paper-portfolio.html">🎮 Paper Portfolio</a>'
    + '<a href="paper-trade.html">🎮 Paper Trade</a>'
    + '<a href="live-watcher.html">👁 Live Watcher</a>'
    + '<a href="live-quote-grid.html">📺 Live Quote Grid</a>'
    + '<a href="live-positions.html">📡 Live Positions</a>'
    + '<a href="watchlists.html">⭐ Watchlists</a>'
    + '<a href="watchlist-pro.html">⭐ Watchlist PRO <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="ticker.html">🔍 Ticker Focus</a>'
    + '<a href="conviction-board.html">⭐ Conviction Board</a>'
    + '<a href="setup-wizard.html">🧙 Setup Wizard</a>'
    + '<a href="trade-plan.html">📋 Trade Plan Generator</a>'
    + '<a href="signals.html">⚡ Live Signals</a>'
    + '<a href="tape.html">📜 Time &amp; Sales</a>'
    + '<a href="orderbook.html">📚 Order Book</a>'
    + '<a href="order-flow.html">🔥 Order Flow</a>'
    + '<a href="volume-profile.html">📊 Volume Profile</a>'
    + '<a href="vwap-pnl.html">📈 VWAP P&amp;L</a>'
    + '<a href="technical-analysis.html">📊 Technical Analysis</a>'
    + '<a href="momentum.html">🚀 Momentum</a>'
    + '<a href="levels-engine.html">📐 Levels Engine</a>'
    + '<a href="pivot-finder.html">🎯 Pivot Finder</a>'
    + '<a href="retracement-finder.html">📐 Fib Retracements</a>'
    + '<a href="candlestick-scanner.html">🕯 Candlesticks</a>'
    + '<a href="short-interest.html">🩳 Short Interest</a>'
    + '<a href="squeeze-radar.html">⛓ Squeeze Radar</a>'
    + '<a href="pairs.html">⚖ Pair Trading</a>'
    + '<a href="correlation.html">🌡 Correlation Matrix</a>'
    + '<a href="desk-split.html">⊞ Split Desk</a>'
    + '</div></li>'

    + '<li class="nav-dd"><a href="#" class="' + (isBrain?'active':'') + '">🧠 Brain ▾</a>'
    + '<div class="nav-dropdown">'
    + '<a href="brain-hub.html">🧠 Brain Hub <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">HUB</span></a>'
    + '<a href="data-truth.html">🔍 Data Truth <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#ef4444;color:#fff;">FIX</span></a>'
    + '<a href="live-data-setup.html">📡 Live Data Setup <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#ef4444;color:#fff;">REAL</span></a>'
    + '<a href="methodology.html">📐 Methodology <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">DOC</span></a>'
    + '<a href="brain-health.html">🩺 Brain Health <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">AUDIT</span></a>'
    + '<a href="historical-trainer.html">🎓 Train on Real History <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">TRAIN</span></a>'
    + '<a href="brain-monitor.html">🧠 Brain Monitor <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="continuous-learning.html">🔄 Continuous Learning <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">LOOP</span></a>'
    + '<a href="multi-horizon.html">🧪 Multi-Horizon Brain <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">ENSEMBLE</span></a>'
    + '<a href="brain-smoke-test.html">🔬 Smoke Test <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">VERIFY</span></a>'
    + '<a href="probability-calibration.html">📏 Probability Calibration <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">PLATT</span></a>'
    + '<a href="walk-forward-backtest.html">📈 Walk-Forward Backtest <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">$$$</span></a>'
    + '<a href="outlier-detection.html">🛡 Outlier Detection <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">OOD</span></a>'
    + '<a href="brain-conviction.html">⭐ Brain Conviction <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">PICKS</span></a>'
    + '<a href="trade-selectivity.html">🚦 Trade Selectivity <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">META</span></a>'
    + '<a href="conviction-tracker.html">📊 Conviction Tracker <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">P&amp;L</span></a>'
    + '<a href="brain-bet.html">🎰 Brain Bet <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#ef4444;color:#fff;">ONE TRADE</span></a>'
    + '<a href="feature-drift.html">📐 Feature Drift (PSI) <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">DRIFT</span></a>'
    + '<a href="feature-importance.html">🧪 Feature Importance <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">PRUNE</span></a>'
    + '<a href="conviction-alerts.html">🔔 Conviction Alerts <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">ALERT</span></a>'
    + '<a href="prediction-uncertainty.html">🎲 Prediction Uncertainty <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">BAYES</span></a>'
    + '<a href="symbol-bias.html">🎯 Symbol Bias <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">MIX-EFF</span></a>'
    + '<a href="ensemble-agreement.html">🤝 Ensemble Agreement <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">CONSENSUS</span></a>'
    + '<a href="brain-daily-report.html">📰 Daily Report <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">REPORT</span></a>'
    + '<a href="knn-recall.html">🧠 k-NN Recall <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">MEMORY</span></a>'
    + '<a href="unified-predictor.html">🔮 Unified Predictor <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">PIPELINE</span></a>'
    + '<a href="conformal-prediction.html">📐 Conformal Prediction <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">RIGOROUS</span></a>'
    + '<a href="swa-tracker.html">📊 SWA Tracker <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">FLAT-MIN</span></a>'
    + '<a href="meta-stacker.html">🧱 Meta-Stacker <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">LEARNED-BLEND</span></a>'
    + '<a href="regime-calibration.html">🎚 Regime Calibration <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">PER-REGIME</span></a>'
    + '<a href="uncertainty-training.html">🎯 Uncertainty Training <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">ACTIVE-LEARN</span></a>'
    + '<a href="module-leaderboard.html">🏆 Module Leaderboard <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">ATTRIB</span></a>'
    + '<a href="hourly-performance.html">⏰ Hourly Performance <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">TIME-OF-DAY</span></a>'
    + '<a href="drawdown-protector.html">🛡 Drawdown Protector <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#ef4444;color:#fff;">TILT</span></a>'
    + '<a href="covariate-shift.html">🔍 Covariate Shift <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">ADV-VAL</span></a>'
    + '<a href="adaptive-lr.html">⚙ Adaptive LR <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">DYNAMIC</span></a>'
    + '<a href="brain-truth.html">🧠 Brain Truth <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#00d4ff;color:#000;">OVERVIEW</span></a>'
    + '<a href="brier-skill.html">📊 Brier Skill <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">BSS</span></a>'
    + '<a href="sharpe-ratio.html">📈 Sharpe Ratio <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">RISK-ADJ</span></a>'
    + '<a href="setup-performance.html">🎬 Setup Performance <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">PER-TYPE</span></a>'
    + '<a href="label-smoothing.html">🪄 Label Smoothing <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">REGUL</span></a>'
    + '<a href="dow-performance.html">📅 Day-of-Week <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">DOW</span></a>'
    + '<a href="sample-decay.html">⏳ Sample Decay <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">AGE</span></a>'
    + '<a href="hindsight-replay.html">🔁 Hindsight Replay <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">HARD-NEG</span></a>'
    + '<a href="confidence-penalty.html">🎯 Confidence Penalty <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">ENTROPY</span></a>'
    + '<a href="trade-trust.html">⭐ Trade Trust <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#00d4ff;color:#000;">SCORE</span></a>'
    + '<a href="auto-pause.html">🚨 Auto-Pause <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#ef4444;color:#fff;">CIRCUIT</span></a>'
    + '<a href="isotonic-calibration.html">📐 Isotonic <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">NON-PARAM</span></a>'
    + '<a href="symbol-skill.html">🎯 Per-Symbol BSS <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">PER-SYM</span></a>'
    + '<a href="symbol-sharpe.html">📈 Per-Symbol Sharpe <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">RISK-ADJ</span></a>'
    + '<a href="sector-performance.html">🏭 Per-Sector Performance <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#10b981;color:#000;">SECTOR</span></a>'
    + '<a href="daily-routine.html">📋 Daily Routine <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">5-STEP</span></a>'
    + '<a href="positions-live.html">📊 Live Positions <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="symbol-brain.html">🧬 Symbol Brain <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="time-of-day-brain.html">⏰ Time-of-Day <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="pattern-library.html">📚 Pattern Library <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">REF</span></a>'
    + '<a href="brain-hotkeys.html">⌨ Hotkeys <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">⌘K</span></a>'
    + '<a href="risk-limits.html">🚧 Risk Limits <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#ef4444;color:#fff;">RISK</span></a>'
    + '<a href="gut-check.html">✅ Gut Check <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">60s</span></a>'
    + '<a href="trade-vs-plan.html">📐 Trade vs Plan <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">DISCIPLINE</span></a>'
    + '<a href="brain-evolution.html">🧬 Brain Evolution <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="brain-pulse.html">💓 Brain Pulse <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="brain-questions.html">🤔 Brain Q&amp;A <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ASK</span></a>'
    + '<a href="performance-attribution-pro.html">📊 P&amp;L Attribution <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="brain-tldr.html">⚡ Brain TL;DR <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">60s</span></a>'
    + '<a href="trade-sizing-advisor.html">📐 Sizing Advisor <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">SIZE</span></a>'
    + '<a href="similar-trades.html">🔍 Similar Trades <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="post-trade-debrief.html">🪞 Post-Trade Debrief <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">60s</span></a>'
    + '<a href="emergency-stop.html">🚨 Emergency Stop <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#ef4444;color:#fff;">KILL</span></a>'
    + '<a href="brain-vs-coin-flip.html">🪙 vs Coin Flip <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">STATS</span></a>'
    + '<a href="brain-rate-of-learning.html">📈 Rate of Learning <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">SLOPE</span></a>'
    + '<a href="multi-position-kelly.html">🎯 Multi Kelly <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">SIZE</span></a>'
    + '<a href="hall-of-fame.html">🏆 Hall of Fame <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">BEST</span></a>'
    + '<a href="brain-snapshot.html">📸 Snapshot <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">PDF</span></a>'
    + '<a href="smart-watchlist.html">⭐ Smart Watchlist <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">AUTO</span></a>'
    + '<a href="brain-vs-spy.html">⚖ Brain vs SPY <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">BENCH</span></a>'
    + '<a href="brain-explained.html">📖 How It Works <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">DOCS</span></a>'
    + '<a href="portfolio-stress-test.html">🩺 Stress Test <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">RISK</span></a>'
    + '<a href="brain-changelog.html">📜 Changelog <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">LOG</span></a>'
    + '<a href="jump-to.html">⚡ Jump To... <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">⌘K</span></a>'
    + '<a href="brain-diary.html">📓 Brain Diary <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="cohort-analysis.html">🔬 Cohort Analysis <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="model-results.html">🎯 Model Results <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">SEE THIS</span></a>'
    + '<a href="brain-grade.html">🎓 Brain Grade <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="auto-paper.html">🤖 Autopilot Paper <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">AUTO</span></a>'
    + '<a href="calibration.html">📏 Calibration <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="brain-memory.html">🧠 Brain Memory <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="daily-report.html">📋 Daily Report <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="streak-tracker.html">🔥 Streak Tracker <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="missed-opportunities.html">😢 Missed Opportunities <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="ml-leaderboard.html">🏆 ML Leaderboard <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="trade-of-the-day-pro.html">🎯 TOTD PRO <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">ML</span></a>'
    + '<a href="sentiment-vs-model.html">⚖ Sentiment vs Model <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="model-economy.html">📊 Model Economy <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="brain-coach.html">🎙 Brain Coach <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="scatter-finder.html">📊 Scatter Finder <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="model-postmortem.html">🔬 Model Postmortem <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="brain-weekly-report.html">📰 Weekly Report <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#a78bfa;color:#000;">REPORT</span></a>'
    + '<a href="model-what-if.html">🎛 What-If <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="model-symbols-leaderboard.html">🏆 Symbols Leaderboard <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="alert-rules-pro.html">⚡ Alert Rules PRO <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">RULES</span></a>'
    + '<a href="trade-export.html">📤 Trade Export <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">CSV</span></a>'
    + '<a href="model-export.html">💾 Model Backup <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">BAK</span></a>'
    + '<a href="brain-live-feed.html">📡 Live Feed <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="notification-log.html">🔔 Notif Log <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="setup-compare.html">⚔ Setup Compare <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="brain-monthly-calendar.html">📅 Monthly Calendar <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="mobile-dashboard.html">📱 Mobile Dash <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">MOBILE</span></a>'
    + '<a href="broker-prep.html">🔌 Broker Prep <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="risk-sizer-pro.html">📐 Risk Sizer PRO <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="model-pnl.html">💰 Model Sim P&amp;L <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="ml-status.html">🩺 ML Status <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="first-run-tour.html">🎬 First-Run Tour <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">START</span></a>'
    + '<a href="active-learning.html">🎯 Active Learning <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="training-history.html">📜 Training History <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="model-trainer.html">🎓 Model Trainer <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="model-confidence.html">🎯 Model Confidence <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="model-explorer.html">🔍 Model Explorer <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="online-learning.html">⚡ Online Learning <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="model-versions.html">📜 Model Versions <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="feature-store.html">📦 Feature Store <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="feature-engineering.html">📚 Feature Docs <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="model-seed.html">🌱 Model Seed <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="ensemble.html">⚔ Ensemble A/B <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="brain-graph.html">🕸 Brain Graph <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="neural-net.html">🧠 Neural Net (MLP) <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="cross-validation.html">🧪 Cross-Validation <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="learning-rate-tuner.html">⚙ LR Tuner <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="prediction-replay.html">🎬 Prediction Replay <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="model-explain.html">🔬 Model Explain <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">SHAP</span></a>'
    + '<a href="model-compare.html">⚖ Model Compare <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">ML</span></a>'
    + '<a href="training-scheduler.html">⏰ Training Scheduler <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="ml-glossary.html">📖 ML Glossary <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">DOCS</span></a>'
    + '<a href="brain-heartbeat.html">🫀 Brain Heartbeat <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="brain-audit.html">🩺 Brain Audit</a>'
    + '<a href="brain-decisions.html">📜 Brain Decisions</a>'
    + '<a href="discoveries.html">📜 Brain Discoveries</a>'
    + '<a href="ml-feedback.html">🧬 ML Feedback Loop</a>'
    + '<a href="edge-analytics.html">🧠 Edge Analytics</a>'
    + '<a href="learn-dashboard.html">🧠 Learn Dashboard</a>'
    + '<a href="learn-engine-explained.html">🧬 How the Brain Learns</a>'
    + '<a href="live-train.html">🎓 Live AI Trainer</a>'
    + '<a href="train-history.html">📚 Training History</a>'
    + '<a href="weight-heatmap.html">🌡 Weight Heatmap</a>'
    + '<a href="setup-library.html">📚 Setup Library</a>'
    + '<a href="assistant.html">🤖 AI Assistant</a>'
    + '<a href="ai-scout.html">🤖 AI Scout</a>'
    + '<a href="ai-cotrader.html">🤖 AI Co-Trader</a>'
    + '<a href="position-stacking.html">🛡 Position Stacking</a>'
    + '</div></li>'

    + '<li class="nav-dd"><a href="#" class="' + (isScan?'active':'') + '">📊 Scanners ▾</a>'
    + '<div class="nav-dropdown">'
    + '<a href="algo-signals.html">⚡ Algo Signals <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="confluence-scanner.html">🎯 Confluence Scanner</a>'
    + '<a href="mean-reversion-scanner.html">🔄 Mean-Rev Scanner</a>'
    + '<a href="trend-strength.html">📈 Trend Strength</a>'
    + '<a href="radar.html">📡 Multi-Symbol Radar</a>'
    + '<a href="edge-scanner.html">🛰 Edge Scanner</a>'
    + '<a href="hot-movers.html">🔥 Hot Movers</a>'
    + '<a href="squeeze-radar-pro.html">🔥 Squeeze Radar PRO</a>'
    + '<a href="squeeze-composite.html">⛓ Squeeze Composite</a>'
    + '<a href="short-squeeze-alerts.html">🔥 Squeeze Alerts</a>'
    + '<a href="pre-market-scanner.html">🌅 Pre-Market Scanner</a>'
    + '<a href="pre-market-gappers.html">🌅 Pre-Market Gappers</a>'
    + '<a href="after-hours-scanner.html">🌙 After-Hours Scanner</a>'
    + '<a href="earnings-tonight.html">⚡ Earnings Tonight</a>'
    + '<a href="earnings-reactor.html">📊 Earnings Reactor</a>'
    + '<a href="earnings-calendar.html">📅 Earnings Calendar</a>'
    + '<a href="earnings-preview.html">🔬 Earnings Preview</a>'
    + '<a href="earnings-playbook.html">📘 Earnings Playbook</a>'
    + '<a href="screener.html">🔎 Multi-Factor Screener</a>'
    + '<a href="anomalies.html">⚠ Anomaly Detector</a>'
    + '<a href="ipo-calendar.html">🎉 IPO Calendar</a>'
    + '<a href="pair-scanner.html">⚖ Pair Scanner</a>'
    + '<a href="insider-live.html">🏛 Insider Trades</a>'
    + '<a href="congress-trades.html">🏛 Congress Trades</a>'
    + '<a href="insider-congress-flow.html">🏛 Insider + Congress</a>'
    + '<a href="buybacks-tracker.html">💰 Buybacks Tracker</a>'
    + '<a href="dollar-leaders.html">💵 Dollar Vol Leaders</a>'
    + '<a href="news-reactions.html">📰 News Reactions</a>'
    + '<a href="comparison.html">📊 Symbol Comparison</a>'
    + '<a href="symbol-diff.html">⚖ Symbol Diff</a>'
    + '</div></li>'

    + '<li class="nav-dd"><a href="#" class="' + (isMarkets?'active':'') + '">🌐 Markets ▾</a>'
    + '<div class="nav-dropdown">'
    + '<a href="cross-asset-pulse.html">🌐 Cross-Asset Pulse <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="market-map.html">🗺 Market Map</a>'
    + '<a href="heatmap.html">🌡️ Heatmap</a>'
    + '<a href="market-internals.html">📈 Market Internals</a>'
    + '<a href="breadth-pro.html">📊 Breadth PRO</a>'
    + '<a href="smart-rotation.html">🔄 Smart Rotation</a>'
    + '<a href="sector-rotation.html">🔄 Sector Rotation</a>'
    + '<a href="sector-flow.html">🔄 Sector Flow</a>'
    + '<a href="sector-snapshot.html">🏢 Sector Snapshot</a>'
    + '<a href="sectors.html">🏢 Sector Deep-Dive</a>'
    + '<a href="smart-money.html">🏛️ Smart Money</a>'
    + '<a href="etf-flows.html">💸 ETF Flows</a>'
    + '<a href="macro.html">🌍 Macro</a>'
    + '<a href="global-markets.html">🌐 Global Markets</a>'
    + '<a href="yield-curve.html">📈 Yield Curve</a>'
    + '<a href="economic-events.html">🏦 Economic Events</a>'
    + '<a href="economic-clock.html">🏦 Economic Clock</a>'
    + '<a href="catalyst-clock.html">⏰ Catalyst Clock</a>'
    + '<a href="risk-radar.html">🚨 Risk Radar</a>'
    + '<a href="halt-tracker.html">⏸ Halt Tracker</a>'
    + '<a href="moc-imbalance.html">🔔 MOC Imbalance</a>'
    + '<a href="correlations-live.html">🔗 Live Correlations</a>'
    + '<a href="cross-asset-correlations.html">🔗 Cross-Asset Correlations</a>'
    + '<a href="heat-clock.html">🕐 Heat Clock</a>'
    + '<a href="sentiment-heat.html">🌡 Sentiment Heat</a>'
    + '<a href="news.html">📰 News &amp; Sentiment</a>'
    + '<a href="news-pulse.html">📰 News Pulse</a>'
    + '<a href="news-impact.html">📰 News Impact</a>'
    + '</div></li>'

    + '<li class="nav-dd"><a href="#" class="' + (isTools?'active':'') + '">🛠 Tools ▾</a>'
    + '<div class="nav-dropdown">'
    + '<a href="all-tools.html">🗂 All Tools (visual index)</a>'
    + '<a href="squarespace-preview.html">🏠 Squarespace Hub Tile <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;background:#00d4ff;color:#000;">DEPLOY</span></a>'
    + '<a href="risk-dashboard.html">⚖️ Risk Dashboard</a>'
    + '<a href="risk-attribution.html">🎯 Risk Attribution</a>'
    + '<a href="risk-parity.html">⚖ Risk Parity</a>'
    + '<a href="risk-of-ruin.html">🎲 Risk of Ruin</a>'
    + '<a href="performance-attribution.html">🎯 Performance Attrib</a>'
    + '<a href="liquidity-health.html">💧 Liquidity Health</a>'
    + '<a href="portfolio-builder.html">📊 Portfolio Builder</a>'
    + '<a href="position-sizing.html">📐 Position Sizing</a>'
    + '<a href="kelly-sizer.html">📐 Kelly Sizer</a>'
    + '<a href="margin-calc.html">📐 Margin Calculator</a>'
    + '<a href="pnl-projector.html">📈 P&amp;L Projector</a>'
    + '<a href="pdt-dashboard.html">📋 PDT Dashboard</a>'
    + '<a href="execution.html">🎯 Execution Calc</a>'
    + '<a href="day-pnl-calendar.html">📅 Day P&amp;L Calendar</a>'
    + '<a href="time-of-day-pnl.html">⏰ Time-of-Day P&amp;L</a>'
    + '<a href="live-pnl-heatmap.html">🌡 Live P&amp;L Heatmap</a>'
    + '<a href="trade-journal-pro.html">📓 Journal PRO</a>'
    + '<a href="journal.html">📓 Trade Journal</a>'
    + '<a href="backtester.html">🔬 Backtester</a>'
    + '<a href="multi-backtest.html">🧪 Multi-Strategy Backtest</a>'
    + '<a href="potd-backtest.html">🧪 POTD Backtest</a>'
    + '<a href="replay.html">🎬 Replay Mode</a>'
    + '<a href="hypothetical.html">📝 Hypothetical Trades</a>'
    + '<a href="setup-combos.html">🔗 Setup Combos</a>'
    + '<a href="strategies.html">📚 Strategy Library</a>'
    + '<a href="fundamentals.html">📊 Fundamentals</a>'
    + '<a href="seasonality.html">📆 Seasonality</a>'
    + '<a href="alerts.html">🔔 Alerts</a>'
    + '<a href="alerts-builder.html">🔔 Alerts Builder</a>'
    + '<a href="alerts-feed.html">🔔 Alerts Feed</a>'
    + '<a href="alerts-dashboard.html">🔔 Alerts Dashboard</a>'
    + '<a href="crypto.html">₿ Crypto Desk</a>'
    + '<a href="crypto-derivatives.html">⚡ Crypto Derivatives</a>'
    + '<a href="crypto-basis.html">⚡ Crypto Basis</a>'
    + '<a href="crypto-commodities.html">🌍 Crypto + Commodities</a>'
    + '<a href="mindset.html">🧘 Mindset Tracker</a>'
    + '<a href="watchlist-share.html">🔗 Watchlist Share</a>'
    + '<a href="pwa-install.html">📱 Install App</a>'
    + '<a href="account.html">👤 My Desk</a>'
    + '<a href="settings.html">⚙ Settings</a>'
    + '<a href="api.html">🔌 API &amp; Webhooks</a>'
    + '<a href="changelog.html">📋 Changelog</a>'
    + '</div></li>'
    + '<li><a href="education.html" class="' + (activePage==='education'?'active':'') + '">Education</a></li>'
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
  const render = (s) => {
    let cls = 'mock', label = 'MOCK';
    if (s.status === 'connected') { cls = 'live'; label = 'LIVE · ' + (s.provider || '').toUpperCase(); }
    else if (s.status === 'connecting') { cls = 'connecting'; label = 'CONNECTING'; }
    else if (s.status === 'reconnecting') { cls = 'connecting'; label = 'RECONNECTING'; }
    else if (s.status === 'error') { cls = 'error'; label = 'ERROR'; }
    else if (s.status === 'disconnected' && s.enabled) { cls = 'mock'; label = 'OFFLINE'; }
    pill.className = 'data-pill data-pill-' + cls;
    const lab = pill.querySelector('.data-pill-label');
    if (lab) lab.textContent = label;
  };
  if (typeof DataProvider !== 'undefined') {
    try { DataProvider.onStatus(render); return; } catch (e) {}
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
  f.innerHTML = ''
    + '<footer class="footer"><div class="footer-container">'
    + '<div class="footer-brand"><h3>bpleone / trade</h3>'
    + '<p>Institutional-grade technical analysis and options intelligence. Built by traders, for traders. Continuously self-learning.</p></div>'
    + '<div class="footer-col"><h4>Plays</h4><ul>'
    + '<li><a href="plays.html">Plays of the Day</a></li>'
    + '<li><a href="trade-of-the-day.html">Trade of the Day</a></li>'
    + '<li><a href="pre-market.html">Pre-Market Brief</a></li>'
    + '<li><a href="signals.html">Live Signals</a></li>'
    + '<li><a href="earnings-calendar.html">Earnings</a></li>'
    + '<li><a href="earnings-preview.html">Earnings Preview</a></li>'
    + '<li><a href="trade-plan.html">Trade Plan Generator</a></li>'
    + '<li><a href="zero-dte.html">0DTE</a></li>'
    + '<li><a href="setup-wizard.html">Setup Wizard</a></li>'
    + '<li><a href="paper-trade.html">Paper Trade</a></li>'
    + '<li><a href="game-plan.html">Game Plan</a></li>'
    + '<li><a href="hot-movers.html">Hot Movers</a></li>'
    + '<li><a href="squeeze-radar.html">Squeeze Radar</a></li>'
    + '</ul></div>'
    + '<div class="footer-col"><h4>Trading</h4><ul>'
    + '<li><a href="dashboard.html">Dashboard</a></li>'
    + '<li><a href="options-flow.html">Options Flow</a></li>'
    + '<li><a href="options-chain.html">Options Chain</a></li>'
    + '<li><a href="vol-surface.html">Vol Surface</a></li>'
    + '<li><a href="technical-analysis.html">TA Scanner</a></li>'
    + '<li><a href="momentum.html">Momentum</a></li>'
    + '<li><a href="heatmap.html">Heatmap</a></li>'
    + '<li><a href="market-internals.html">Internals</a></li>'
    + '<li><a href="smart-money.html">Smart Money</a></li>'
    + '<li><a href="watchlists.html">Watchlists</a></li>'
    + '<li><a href="gex.html">GEX Map</a></li>'
    + '<li><a href="tape.html">Tape</a></li>'
    + '<li><a href="sectors.html">Sectors</a></li>'
    + '<li><a href="pairs.html">Pairs</a></li>'
    + '<li><a href="calendar-analyzer.html">Calendar</a></li>'
    + '<li><a href="vol-cone.html">Vol Cone</a></li>'
    + '<li><a href="dark-pool.html">Dark Pool</a></li>'
    + '<li><a href="short-interest.html">Short Interest</a></li>'
    + '<li><a href="etf-flows.html">ETF Flows</a></li>'
    + '<li><a href="volume-profile.html">Volume Profile</a></li>'
    + '<li><a href="order-flow.html">Order Flow</a></li>'
    + '<li><a href="ticker.html">Ticker Focus</a></li>'
    + '<li><a href="multi-leg-builder.html">Multi-Leg Builder</a></li>'
    + '<li><a href="bracket-builder.html">Bracket Builder</a></li>'
    + '<li><a href="spread-scanner.html">Spread Scanner</a></li>'
    + '<li><a href="wheel.html">Wheel Tracker</a></li>'
    + '<li><a href="correlation.html">Correlation Matrix</a></li>'
    + '</ul></div>'
    + '<div class="footer-col"><h4>Tools</h4><ul>'
    + '<li><a href="fundamentals.html">Fundamentals</a></li>'
    + '<li><a href="macro.html">Macro</a></li>'
    + '<li><a href="news.html">News & Sentiment</a></li>'
    + '<li><a href="risk-dashboard.html">Risk</a></li>'
    + '<li><a href="backtester.html">Backtester</a></li>'
    + '<li><a href="journal.html">Journal</a></li>'
    + '<li><a href="alerts.html">Alerts</a></li>'
    + '<li><a href="edge-analytics.html">Edge Analytics</a></li>'
    + '<li><a href="learn-dashboard.html">Learn Dashboard</a></li>'
    + '<li><a href="crypto.html">Crypto</a></li>'
    + '<li><a href="screener.html">Screener</a></li>'
    + '<li><a href="anomalies.html">Anomalies</a></li>'
    + '<li><a href="assistant.html">AI Assistant</a></li>'
    + '<li><a href="ai-scout.html">AI Scout</a></li>'
    + '<li><a href="mindset.html">Mindset</a></li>'
    + '<li><a href="learn-engine-explained.html">How it Learns</a></li>'
    + '<li><a href="friday-summary.html">Friday Review</a></li>'
    + '<li><a href="replay.html">Replay Mode</a></li>'
    + '<li><a href="live-positions.html">Live Positions</a></li>'
    + '<li><a href="risk-attribution.html">Risk Attribution</a></li>'
    + '<li><a href="ai-cotrader.html">AI Co-Trader</a></li>'
    + '<li><a href="live-train.html">Live AI Trainer</a></li>'
    + '<li><a href="train-history.html">Training History</a></li>'
    + '<li><a href="radar.html">Multi-Symbol Radar</a></li>'
    + '<li><a href="alerts-dashboard.html">Alerts Dashboard</a></li>'
    + '<li><a href="weight-heatmap.html">Weight Heatmap</a></li>'
    + '<li><a href="sector-rotation.html">Sector Rotation</a></li>'
    + '<li><a href="options-flow-live.html">Live Options Flow</a></li>'
    + '<li><a href="earnings-playbook.html">Earnings Playbook</a></li>'
    + '<li><a href="daily-debrief.html">Daily AI Debrief</a></li>'
    + '<li><a href="multi-backtest.html">Multi-Strategy Backtester</a></li>'
    + '<li><a href="pre-market-scanner.html">Pre-Market Scanner</a></li>'
    + '<li><a href="after-hours-scanner.html">After-Hours Scanner</a></li>'
    + '<li><a href="tomorrow-playbook.html">Tomorrow\'s Playbook</a></li>'
    + '<li><a href="earnings-tonight.html">Earnings Tonight</a></li>'
    + '<li><a href="trade-ticket.html">Trade Ticket</a></li>'
    + '<li><a href="trade-blotter.html">Trade Blotter</a></li>'
    + '<li><a href="conviction-board.html">Conviction Board</a></li>'
    + '<li><a href="global-markets.html">Global Markets</a></li>'
    + '<li><a href="cross-asset-correlations.html">Cross-Asset Correlations</a></li>'
    + '<li><a href="squeeze-radar-pro.html">Squeeze Radar PRO</a></li>'
    + '<li><a href="insider-congress-flow.html">Insider + Congress</a></li>'
    + '<li><a href="calendar-plays.html">Calendar Plays</a></li>'
    + '<li><a href="pair-trades.html">Pair Trades</a></li>'
    + '<li><a href="iv-skew.html">IV Skew + Surface</a></li>'
    + '<li><a href="crypto-basis.html">Crypto Basis + Funding</a></li>'
    + '<li><a href="desk-split.html">Split Desk</a></li>'
    + '<li><a href="confluence-scanner.html">Confluence Scanner</a></li>'
    + '<li><a href="live-pnl-heatmap.html">Live P&amp;L Heatmap</a></li>'
    + '<li><a href="time-of-day-pnl.html">Time-of-Day P&amp;L</a></li>'
    + '<li><a href="brain-heartbeat.html">Brain Heartbeat</a></li>'
    + '<li><a href="discoveries.html">Brain Discoveries</a></li>'
    + '<li><a href="comparison.html">Symbol Comparison</a></li>'
    + '<li><a href="strike-chaser.html">Strike Chaser</a></li>'
    + '<li><a href="yield-curve.html">Yield Curve LIVE</a></li>'
    + '<li><a href="ml-feedback.html">ML Feedback Loop</a></li>'
    + '<li><a href="dark-pool-pro.html">Dark Pool PRO</a></li>'
    + '<li><a href="morning-brief.html">Morning Brief</a></li>'
    + '<li><a href="conviction-stack.html">Conviction Stack</a></li>'
    + '<li><a href="cross-asset-pulse.html">Cross-Asset Pulse</a></li>'
    + '<li><a href="vol-term.html">Vol Term Structure</a></li>'
    + '<li><a href="squeeze-composite.html">Squeeze Composite</a></li>'
    + '<li><a href="big-bets.html">Big Bets Feed</a></li>'
    + '<li><a href="setup-library.html">Setup Library</a></li>'
    + '<li><a href="brain-audit.html">Brain Audit</a></li>'
    + '<li><a href="liquidity-health.html">Liquidity Health</a></li>'
    + '<li><a href="sector-flow.html">Sector Flow</a></li>'
    + '<li><a href="iv-crush-tracker.html">IV Crush Tracker</a></li>'
    + '<li><a href="trade-coach.html">Trade Coach</a></li>'
    + '<li><a href="watchlist-pro.html">Watchlist PRO</a></li>'
    + '<li><a href="news-pulse.html">News Pulse</a></li>'
    + '<li><a href="breadth-pro.html">Breadth PRO</a></li>'
    + '<li><a href="halt-tracker.html">Halt Tracker</a></li>'
    + '<li><a href="pre-market-gappers.html">Pre-Market Gappers</a></li>'
    + '<li><a href="moc-imbalance.html">MOC Imbalance</a></li>'
    + '<li><a href="risk-radar.html">Risk Radar</a></li>'
    + '<li><a href="crypto-derivatives.html">Crypto Derivatives</a></li>'
    + '<li><a href="dollar-leaders.html">Dollar Vol Leaders</a></li>'
    + '<li><a href="day-trader-pro.html">Day Trader PRO</a></li>'
    + '<li><a href="smart-rotation.html">Smart Rotation</a></li>'
    + '<li><a href="gex-pro.html">GEX PRO</a></li>'
    + '<li><a href="correlations-live.html">Live Correlations</a></li>'
    + '<li><a href="options-skew-radar.html">Skew Radar</a></li>'
    + '<li><a href="ai-narrative.html">AI Narrative</a></li>'
    + '<li><a href="levels-engine.html">Levels Engine</a></li>'
    + '<li><a href="pdt-dashboard.html">PDT Dashboard</a></li>'
    + '<li><a href="catalyst-clock.html">Catalyst Clock</a></li>'
    + '<li><a href="flow-replay.html">Flow Replay</a></li>'
    + '<li><a href="risk-parity.html">Risk Parity</a></li>'
    + '<li><a href="algo-signals.html">Algo Signals</a></li>'
    + '<li><a href="earnings-reactor.html">Earnings Reactor</a></li>'
    + '<li><a href="insider-live.html">Insider Trades</a></li>'
    + '<li><a href="congress-trades.html">Congress Trades</a></li>'
    + '<li><a href="buybacks-tracker.html">Buybacks Tracker</a></li>'
    + '<li><a href="brain-decisions.html">Brain Decisions</a></li>'
    + '<li><a href="mean-reversion-scanner.html">Mean-Rev Scanner</a></li>'
    + '<li><a href="trend-strength.html">Trend Strength</a></li>'
    + '<li><a href="ipo-calendar.html">IPO Calendar</a></li>'
    + '<li><a href="symbol-diff.html">Symbol Diff</a></li>'
    + '<li><a href="pwa-install.html">Install App</a></li>'
    + '<li><a href="short-squeeze-alerts.html">Squeeze Alerts</a></li>'
    + '<li><a href="vix-pulse.html">VIX Pulse</a></li>'
    + '<li><a href="market-map.html">Market Map</a></li>'
    + '<li><a href="day-pnl-calendar.html">Day P&amp;L Calendar</a></li>'
    + '<li><a href="opex-tracker.html">OPEX Tracker</a></li>'
    + '<li><a href="live-watcher.html">Live Watcher</a></li>'
    + '<li><a href="paper-portfolio.html">Paper Portfolio</a></li>'
    + '<li><a href="alerts-builder.html">Alerts Builder</a></li>'
    + '<li><a href="trade-tape.html">Trade Tape</a></li>'
    + '<li><a href="all-tools.html">All Tools</a></li>'
    + '<li><a href="pair-scanner.html">Pair Scanner</a></li>'
    + '<li><a href="economic-clock.html">Economic Clock</a></li>'
    + '<li><a href="risk-of-ruin.html">Risk of Ruin</a></li>'
    + '<li><a href="trade-journal-pro.html">Journal PRO</a></li>'
    + '<li><a href="retracement-finder.html">Fib Retracements</a></li>'
    + '<li><a href="candlestick-scanner.html">Candlestick Scanner</a></li>'
    + '<li><a href="sector-snapshot.html">Sector Snapshot</a></li>'
    + '<li><a href="margin-calc.html">Margin Calculator</a></li>'
    + '<li><a href="pnl-projector.html">P&amp;L Projector</a></li>'
    + '<li><a href="options-pricer.html">Options Pricer</a></li>'
    + '<li><a href="pnl-diagram.html">P&amp;L Diagram</a></li>'
    + '<li><a href="orderbook.html">Order Book</a></li>'
    + '<li><a href="vwap-pnl.html">VWAP P&amp;L</a></li>'
    + '<li><a href="sentiment-heat.html">Sentiment Heat</a></li>'
    + '<li><a href="daily-stats.html">Daily Stats</a></li>'
    + '<li><a href="pivot-finder.html">Pivot Finder</a></li>'
    + '<li><a href="sweep-counter.html">Sweep Counter</a></li>'
    + '<li><a href="watchlist-share.html">Watchlist Share</a></li>'
    + '<li><a href="live-quote-grid.html">Live Quote Grid</a></li>'
    + '<li><a href="alerts-feed.html">Alerts Feed</a></li>'
    + '<li><a href="performance-attribution.html">Performance Attrib</a></li>'
    + '<li><a href="options-builder.html">Options Builder</a></li>'
    + '<li><a href="news-impact.html">News Impact</a></li>'
    + '<li><a href="heat-clock.html">Heat Clock</a></li>'
    + '<li><a href="position-stacking.html">Position Stacking</a></li>'
    + '<li><a href="crypto-commodities.html">Crypto + Commodities</a></li>'
    + '<li><a href="edge-scanner.html">Edge Scanner</a></li>'
    + '<li><a href="hypothetical.html">Hypothetical Trades</a></li>'
    + '<li><a href="setup-combos.html">Setup Combos</a></li>'
    + '<li><a href="kelly-sizer.html">Kelly Sizer</a></li>'
    + '<li><a href="potd-backtest.html">POTD Backtest</a></li>'
    + '<li><a href="news-reactions.html">News Reactions</a></li>'
    + '<li><a href="account.html">My Desk</a></li>'
    + '<li><a href="changelog.html">Changelog</a></li>'
    + '<li><a href="portfolio-builder.html">Portfolio</a></li>'
    + '<li><a href="position-sizing.html">Sizing</a></li>'
    + '<li><a href="execution.html">Execution</a></li>'
    + '<li><a href="strategies.html">Strategies</a></li>'
    + '<li><a href="seasonality.html">Seasonality</a></li>'
    + '<li><a href="economic-events.html">Economic Events</a></li>'
    + '<li><a href="api.html">API</a></li>'
    + '<li><a href="settings.html">Settings</a></li>'
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

document.addEventListener('DOMContentLoaded', () => {
  buildFooter();
  startMarketClock();
  initTabs();
  initSubscribe();
  initFilters();
  initSort();
  initSearch();
});
