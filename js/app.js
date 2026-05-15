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
  const want = ['js/toast.js', 'js/command-palette.js', 'js/hotkeys.js', 'js/onboarding.js'];
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

function buildTicker() {
  const tape = document.getElementById('ticker-content');
  if (!tape) return;
  const src = (typeof QUOTES !== 'undefined') ? QUOTES : null;
  const list = TICKER_SYMBOLS.map(s => {
    if (src && src[s]) return { sym: s, px: src[s].last, chg: src[s].changePct };
    return null;
  }).filter(Boolean);
  if (list.length === 0) {
    const fallback = [
      { sym:'SPY', px:562.18, chg:0.84 },{ sym:'QQQ', px:487.32, chg:1.12 },{ sym:'NVDA', px:138.27, chg:3.21 },
      { sym:'AAPL', px:218.94, chg:1.84 },{ sym:'TSLA', px:248.61, chg:-2.18 },{ sym:'META', px:587.42, chg:1.67 }
    ];
    list.push(...fallback);
  }
  const html = [...list, ...list].map(t => {
    const dir = t.chg >= 0 ? 'up' : 'down';
    const arrow = t.chg >= 0 ? '▲' : '▼';
    return '<span class="ticker-item" data-ticker-sym="' + t.sym + '">'
      + '<span class="ticker-symbol">' + t.sym + '</span>'
      + '<span class="ticker-price">$' + t.px.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) + '</span>'
      + '<span class="ticker-change ' + dir + '">' + arrow + ' ' + Math.abs(t.chg).toFixed(2) + '%</span>'
      + '</span>';
  }).join('');
  tape.innerHTML = html;
  if (typeof Feed !== 'undefined') {
    TICKER_SYMBOLS.forEach(s => {
      Feed.subscribe(s, q => {
        document.querySelectorAll('[data-ticker-sym="' + s + '"]').forEach(el => {
          const priceEl = el.querySelector('.ticker-price');
          const chgEl = el.querySelector('.ticker-change');
          if (priceEl) priceEl.textContent = '$' + q.last.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
          if (chgEl) {
            const arrow = q.changePct >= 0 ? '▲' : '▼';
            chgEl.textContent = arrow + ' ' + Math.abs(q.changePct).toFixed(2) + '%';
            chgEl.classList.toggle('up', q.changePct >= 0);
            chgEl.classList.toggle('down', q.changePct < 0);
          }
        });
      });
    });
  }
}

function buildNav(activePage) {
  activePage = activePage || '';
  const playsGrp = ['totd','plays','signals','earnings','earnings-preview','pre-market','zero-dte','setup-wizard','paper-trade','game-plan','hot-movers','squeeze-radar','trade-plan'];
  const tradeGrp = ['flow','chain','ta','momentum','market-internals','smart-money','heatmap','watchlists','vol-surface','gex','tape','sectors','pairs','calendar-analyzer','vol-cone','dark-pool','short-interest','etf-flows','volume-profile','order-flow','ticker','multi-leg-builder','bracket-builder','spread-scanner','wheel','correlation'];
  const toolsGrp = ['risk','fundamentals','backtester','edge','learn','learn-engine-explained','crypto','journal','alerts','macro','news','screener','anomalies','assistant','ai-scout','portfolio-builder','position-sizing','execution','strategies','api','seasonality','economic-events','settings','mindset','changelog','friday-summary','replay','live-positions','risk-attribution','edge-scanner','hypothetical','account','setup-combos','kelly-sizer','potd-backtest','news-reactions','live-train','radar','ai-cotrader','train-history','alerts-dashboard','weight-heatmap'];
  const isTrade = tradeGrp.indexOf(activePage) !== -1;
  const isPlays = playsGrp.indexOf(activePage) !== -1;
  const isTools = toolsGrp.indexOf(activePage) !== -1;
  const navHtml = ''
    + '<div class="ticker-tape"><div class="ticker-content" id="ticker-content"></div></div>'
    + '<nav class="navbar"><div class="nav-container">'
    + '<a href="index.html" class="logo"><div class="logo-mark">BP</div>'
    + '<span>bpleone <span style="color:var(--accent);font-weight:400">/ trade</span></span></a>'
    + '<ul class="nav-links">'
    + '<li><a href="dashboard.html" class="' + (activePage==='dashboard'?'active':'') + '">Dashboard</a></li>'
    + '<li class="nav-dd"><a href="#" class="' + (isPlays?'active':'') + '">Plays ▾</a>'
    + '<div class="nav-dropdown">'
    + '<a href="plays.html">⭐ Plays of the Day</a>'
    + '<a href="trade-of-the-day.html">🎯 Trade of the Day</a>'
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
    + '<li class="nav-dd"><a href="#" class="' + (isTrade?'active':'') + '">Trading ▾</a>'
    + '<div class="nav-dropdown">'
    + '<a href="options-flow.html">📡 Options Flow</a>'
    + '<a href="options-chain.html">⛓️ Options Chain</a>'
    + '<a href="vol-surface.html">🌐 Vol Surface</a>'
    + '<a href="technical-analysis.html">📊 Technical Analysis</a>'
    + '<a href="momentum.html">🚀 Momentum Scanner</a>'
    + '<a href="heatmap.html">🌡️ Market Heatmap</a>'
    + '<a href="market-internals.html">📈 Market Internals</a>'
    + '<a href="smart-money.html">🏛️ Smart Money</a>'
    + '<a href="watchlists.html">⭐ Watchlists</a>'
    + '<a href="gex.html">🌀 Gamma Exposure</a>'
    + '<a href="tape.html">📜 Time & Sales</a>'
    + '<a href="sectors.html">🏢 Sector Deep-Dive</a>'
    + '<a href="pairs.html">⚖️ Pair Trading</a>'
    + '<a href="calendar-analyzer.html">📆 Calendar Analyzer</a>'
    + '<a href="vol-cone.html">🌗 Vol Cone</a>'
    + '<a href="dark-pool.html">🌑 Dark Pool Tracker</a>'
    + '<a href="short-interest.html">🩳 Short Interest</a>'
    + '<a href="etf-flows.html">💸 ETF Flows</a>'
    + '<a href="volume-profile.html">📊 Volume Profile <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="order-flow.html">🔥 Order Flow <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="ticker.html">🔍 Ticker Focus <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="multi-leg-builder.html">🔧 Multi-Leg Builder <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="bracket-builder.html">🎯 Bracket Order Builder <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="spread-scanner.html">📊 Spread Scanner <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '<a href="wheel.html">🎡 Wheel Tracker <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="correlation.html">🌡 Correlation Matrix <span class="feat-badge feat-pro" style="font-size:8px;padding:0 5px;">PRO</span></a>'
    + '</div></li>'
    + '<li class="nav-dd"><a href="#" class="' + (isTools?'active':'') + '">Tools ▾</a>'
    + '<div class="nav-dropdown">'
    + '<a href="fundamentals.html">📊 Fundamentals</a>'
    + '<a href="macro.html">🌍 Macro Dashboard</a>'
    + '<a href="news.html">📰 News & Sentiment</a>'
    + '<a href="risk-dashboard.html">⚖️ Risk Dashboard</a>'
    + '<a href="backtester.html">🔬 Backtester</a>'
    + '<a href="journal.html">📓 Trade Journal</a>'
    + '<a href="alerts.html">🔔 Alerts</a>'
    + '<a href="edge-analytics.html">🧠 Edge Analytics</a>'
    + '<a href="learn-dashboard.html">🧠 Learn Dashboard <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="learn-engine-explained.html">🧬 How the Brain Learns <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="friday-summary.html">📅 Friday AI Review <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="replay.html">🎬 Replay Mode <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="live-positions.html">📡 Live Position Monitor <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="risk-attribution.html">🎯 Risk Attribution <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="ai-cotrader.html">🤖 AI Co-Trader <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="live-train.html">🎓 Live AI Trainer <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="train-history.html">📚 Training History <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="radar.html">📡 Multi-Symbol Radar <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="alerts-dashboard.html">🔔 Alerts Dashboard <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="weight-heatmap.html">🌡 Weight Heatmap <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="edge-scanner.html">🛰 Live Edge Scanner <span class="feat-badge feat-live" style="font-size:8px;padding:0 5px;">LIVE</span></a>'
    + '<a href="hypothetical.html">📝 Hypothetical Trades <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="setup-combos.html">🔗 Setup Combos <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="kelly-sizer.html">📐 Kelly Sizer <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="potd-backtest.html">🧪 POTD Backtest <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="news-reactions.html">📰 News Reactions <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="account.html">👤 My Desk <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="mindset.html">🧘 Mindset Tracker <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="crypto.html">₿ Crypto Desk</a>'
    + '<a href="screener.html">🔎 Multi-Factor Screener</a>'
    + '<a href="anomalies.html">⚠ Anomaly Detector</a>'
    + '<a href="assistant.html">🤖 AI Assistant</a>'
    + '<a href="ai-scout.html">🤖 AI Scout <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '<a href="portfolio-builder.html">📊 Portfolio Builder</a>'
    + '<a href="position-sizing.html">📐 Position Sizing</a>'
    + '<a href="execution.html">🎯 Execution Calc</a>'
    + '<a href="strategies.html">📚 Strategy Library</a>'
    + '<a href="seasonality.html">📆 Seasonality</a>'
    + '<a href="economic-events.html">🏦 Economic Events</a>'
    + '<a href="api.html">🔌 API & Webhooks</a>'
    + '<a href="settings.html">⚙ Settings</a>'
    + '<a href="changelog.html">📋 Changelog <span class="feat-badge feat-new" style="font-size:8px;padding:0 5px;">NEW</span></a>'
    + '</div></li>'
    + '<li><a href="education.html" class="' + (activePage==='education'?'active':'') + '">Education</a></li>'
    + '</ul>'
    + '<div class="nav-actions">'
    + '<a id="dataStatusPill" href="settings.html" title="Data feed status — click to configure" class="data-pill data-pill-mock"><span class="data-pill-dot"></span><span class="data-pill-label">MOCK</span></a>'
    + '<form id="navSearchForm" class="nav-search" style="display:flex;align-items:center;gap:4px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:3px 4px 3px 10px;"><span style="font-size:12px;color:var(--text-muted);">🔍</span><input id="navSearch" placeholder="Search symbol or page…" autocomplete="off" style="background:transparent;border:none;outline:none;color:var(--text-primary);font-size:12px;width:160px;font-family:inherit;text-transform:uppercase;"></form>'
    + '<button id="cmdkBtn" title="Search & navigate (⌘K)" class="btn btn-ghost" style="padding:6px 10px;font-size:11px;font-family:var(--font-mono);">⌘K</button>'
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

function startMarketClock() {
  const els = document.querySelectorAll('#market-clock');
  if (!els.length) return;
  const update = () => {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay();
    const h = et.getHours();
    const m = et.getMinutes();
    const isWeekday = day >= 1 && day <= 5;
    const isOpen = isWeekday && ((h === 9 && m >= 30) || (h > 9 && h < 16));
    const isPre = isWeekday && (h < 9 || (h === 9 && m < 30));
    const isAfter = isWeekday && h >= 16 && h < 20;
    let status = 'CLOSED', color = 'red';
    if (isOpen) { status = 'OPEN'; color = 'green'; }
    else if (isPre) { status = 'PRE-MARKET'; color = 'yellow'; }
    else if (isAfter) { status = 'AFTER HOURS'; color = 'yellow'; }
    const timeStr = et.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    els.forEach(el => {
      el.innerHTML = '<span class="signal-dot ' + color + '"></span> ' + status + ' · <span class="mono">' + timeStr + ' ET</span>';
    });
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
