/* ===========================================
   BPLEONE TRADING - COMMAND PALETTE
   ---
   Cmd+K (Mac) / Ctrl+K (Windows) opens a universal
   jumper:
     - Type to fuzzy-search pages, tickers, actions
     - Arrow keys / Enter / Esc
     - Recent jumps remembered in localStorage
   Calls window.CmdPalette.open() from anywhere.
   =========================================== */

const CmdPalette = (function() {
  const RECENT_KEY = 'bpleone_cmdk_recent_v1';
  const MAX_RECENT = 6;
  let overlay = null;
  let inputEl = null;
  let resultsEl = null;
  let currentItems = [];
  let highlighted = 0;

  // ---------------- Item sources ----------------

  const PAGES = [
    { title: 'Dashboard', sub: 'Main market dashboard', url: 'dashboard.html', icon: '📊' },
    { title: 'Plays of the Day', sub: 'Top-ranked setups', url: 'plays.html', icon: '⭐' },
    { title: 'Trade of the Day', sub: 'Featured trade with thesis', url: 'trade-of-the-day.html', icon: '🎯' },
    { title: 'Pre-Market Brief', sub: '5:30 AM ET morning brief', url: 'pre-market.html', icon: '🌅' },
    { title: 'Live Signals', sub: 'Real-time signal feed', url: 'signals.html', icon: '⚡' },
    { title: 'Earnings Calendar', sub: 'Week grid + IV-crush tracker', url: 'earnings-calendar.html', icon: '📅' },
    { title: '0DTE Dashboard', sub: 'Strike map + gamma walls', url: 'zero-dte.html', icon: '⚡' },
    { title: 'Setup Wizard', sub: '6-step trade builder', url: 'setup-wizard.html', icon: '🧙' },
    { title: 'Options Flow', sub: 'Unusual activity, sweeps, blocks', url: 'options-flow.html', icon: '📡' },
    { title: 'Options Chain', sub: 'Full chain w/ Greeks + strategy builder', url: 'options-chain.html', icon: '⛓️' },
    { title: 'Vol Surface', sub: 'IV surface + smile + term', url: 'vol-surface.html', icon: '🌐' },
    { title: 'Vol Cone', sub: 'Realized vs implied vol bands', url: 'vol-cone.html', icon: '🌗' },
    { title: 'Technical Analysis', sub: 'Multi-indicator scanner', url: 'technical-analysis.html', icon: '📊' },
    { title: 'Momentum Scanner', sub: 'RS ranking + breakouts', url: 'momentum.html', icon: '🚀' },
    { title: 'Heatmap', sub: 'Finviz-style sector treemap', url: 'heatmap.html', icon: '🌡️' },
    { title: 'Market Internals', sub: 'A/D, TICK/TRIN/VIX, McClellan', url: 'market-internals.html', icon: '📈' },
    { title: 'Smart Money', sub: 'Congress, insiders, 13F shifts', url: 'smart-money.html', icon: '🏛️' },
    { title: 'Watchlists', sub: 'Custom multi-list manager', url: 'watchlists.html', icon: '⭐' },
    { title: 'Gamma Exposure', sub: 'GEX map, vanna, charm', url: 'gex.html', icon: '🌀' },
    { title: 'Time & Sales', sub: 'Live L2 + ticking tape', url: 'tape.html', icon: '📜' },
    { title: 'Sector Deep-Dive', sub: '11-sector rotation + tilts', url: 'sectors.html', icon: '🏢' },
    { title: 'Pairs Trading', sub: 'Z-score + cointegration', url: 'pairs.html', icon: '⚖️' },
    { title: 'Calendar Analyzer', sub: 'Diagonal + calendar P/L', url: 'calendar-analyzer.html', icon: '📆' },
    { title: 'Dark Pool Tracker', sub: 'Off-exchange prints', url: 'dark-pool.html', icon: '🌑' },
    { title: 'Short Interest', sub: 'Squeeze candidates, FTDs', url: 'short-interest.html', icon: '🩳' },
    { title: 'ETF Flows', sub: 'Creation/redemption + sector tiles', url: 'etf-flows.html', icon: '💸' },
    { title: 'Volume Profile', sub: 'VPVR + Market Profile (TPO)', url: 'volume-profile.html', icon: '📊' },
    { title: 'Order Flow', sub: 'Bid/ask imbalance + delta', url: 'order-flow.html', icon: '🔥' },
    { title: 'Paper Trading', sub: 'Practice against live data', url: 'paper-trade.html', icon: '🎮' },
    { title: 'Fundamentals', sub: 'Earnings, financials, valuation', url: 'fundamentals.html', icon: '📊' },
    { title: 'Macro Dashboard', sub: 'Indices, yields, FX, commodities', url: 'macro.html', icon: '🌍' },
    { title: 'News & Sentiment', sub: 'Headlines with sentiment', url: 'news.html', icon: '📰' },
    { title: 'Risk Dashboard', sub: 'Greeks, VaR, scenarios', url: 'risk-dashboard.html', icon: '⚖️' },
    { title: 'Backtester', sub: '8 strategies, full stats', url: 'backtester.html', icon: '🔬' },
    { title: 'Trade Journal', sub: 'Log every trade, feeds learn', url: 'journal.html', icon: '📓' },
    { title: 'Alerts', sub: 'Custom alerts, browser push', url: 'alerts.html', icon: '🔔' },
    { title: 'Edge Analytics', sub: 'Self-learning brain', url: 'edge-analytics.html', icon: '🧠' },
    { title: 'Learn Dashboard', sub: "What the system has learned", url: 'learn-dashboard.html', icon: '🧠' },
    { title: 'Crypto Desk', sub: 'BTC/ETH, funding, ETF flows', url: 'crypto.html', icon: '₿' },
    { title: 'Multi-Factor Screener', sub: 'Custom weights, 6 presets', url: 'screener.html', icon: '🔎' },
    { title: 'Anomaly Detector', sub: 'Statistical outliers', url: 'anomalies.html', icon: '⚠' },
    { title: 'AI Assistant', sub: 'Claude or heuristic responses', url: 'assistant.html', icon: '🤖' },
    { title: 'Portfolio Builder', sub: 'Mean-variance optimizer', url: 'portfolio-builder.html', icon: '📊' },
    { title: 'Position Sizing', sub: 'Kelly, ATR, vol-targeted', url: 'position-sizing.html', icon: '📐' },
    { title: 'Execution Calculator', sub: 'Almgren-Chriss, TWAP', url: 'execution.html', icon: '🎯' },
    { title: 'Strategy Library', sub: '24 options strategies', url: 'strategies.html', icon: '📚' },
    { title: 'Seasonality', sub: 'Calendar effects + cycles', url: 'seasonality.html', icon: '📆' },
    { title: 'Economic Events', sub: 'Fed, CPI, NFP, GDP', url: 'economic-events.html', icon: '🏦' },
    { title: 'Single-Symbol Focus', sub: 'Deep-dive any ticker', url: 'ticker.html', icon: '🔍' },
    { title: 'Settings', sub: 'API keys, prefs, diagnostics', url: 'settings.html', icon: '⚙' },
    { title: 'Education', sub: 'Options 101, TA, Glossary', url: 'education.html', icon: '🎓' },
    { title: 'About / Pricing', sub: 'Tiers, FAQ, disclosures', url: 'about.html', icon: 'ℹ' },
    { title: 'API & Webhooks', sub: 'Developer reference', url: 'api.html', icon: '🔌' },
    // Audit pass 106 additions — the new training/diagnostic surfaces
    { title: 'Train Now', sub: 'One-click full training pipeline', url: 'train-now.html', icon: '⚡' },
    { title: 'Learning Velocity', sub: 'Is the brain getting smarter?', url: 'learning-velocity.html', icon: '📈' },
    { title: 'Brain Debug', sub: 'Ops console — module health + storage + errors', url: 'brain-debug.html', icon: '🩺' },
    { title: 'Site Health', sub: 'Cumulative diagnostic dashboard', url: 'site-health.html', icon: '🏥' },
    { title: 'Audit Log', sub: '100+ audit passes, 17 CRITICAL bugs fixed', url: 'audit-log.html', icon: '🔍' },
    { title: 'Historical Bootstrap', sub: 'Pre-train brain on 250 days × 47 symbols', url: 'historical-bootstrap.html', icon: '⏪' },
    { title: 'Make Money', sub: 'Portfolio allocation + Kelly sizing', url: 'make-money.html', icon: '💰' },
    { title: 'Money Made', sub: 'Simulated cumulative P&L from brain signals', url: 'money-made.html', icon: '💵' },
    { title: 'Auto-Trade', sub: 'Closed-loop paper trading', url: 'auto-trade.html', icon: '🤖' },
    { title: 'Brain Bet', sub: 'The one trade right now (or nothing)', url: 'brain-bet.html', icon: '🎰' },
    { title: 'Brain Conviction', sub: 'All picks ranked by conviction', url: 'brain-conviction.html', icon: '⭐' },
    { title: 'Brain Hub', sub: 'Single-page command center', url: 'brain-hub.html', icon: '🧠' },
    { title: 'Live Status', sub: 'Per-symbol data freshness', url: 'live-status.html', icon: '📡' },
    { title: 'All Tools', sub: 'Visual catalog of 397+ pages', url: 'all-tools.html', icon: '🗺' }
  ];

  const ACTIONS = [
    { title: 'Toggle Notifications', sub: 'Enable/mute browser alerts', icon: '🔔', action: () => {
      if (typeof Notify !== 'undefined') {
        if (Notify.permission() === 'granted') Notify.setMuted(!Notify.isMuted());
        else Notify.request();
        toast && toast('Notifications: ' + (Notify.isMuted() ? 'muted' : 'on'));
      }
    }},
    { title: 'Refresh Page', sub: 'Hard reload', icon: '🔄', action: () => location.reload() },
    { title: 'Open AI Assistant', sub: 'Chat with desk brain', icon: '🤖', url: 'assistant.html' },
    { title: 'Open Settings', sub: 'API keys + diagnostics', icon: '⚙', url: 'settings.html' },
    { title: 'Show Keyboard Shortcuts', sub: 'Press ? anywhere', icon: '⌨', action: () => { if (window.Hotkeys) Hotkeys.showHelp(); } },
    { title: 'Reconnect Data Feed', sub: 'Restart WebSocket', icon: '🔌', action: () => {
      if (typeof DataProvider !== 'undefined') { DataProvider.reconnect(); toast && toast('Reconnecting feed...'); }
    }},
    { title: 'Backup Settings', sub: 'Download localStorage snapshot', icon: '💾', url: 'settings.html#export' },
    { title: 'Restart Onboarding Tour', sub: 'Walk through key features again', icon: '🧭', action: () => {
      try { localStorage.removeItem('bpleone_tour_v1'); } catch (e) {}
      if (window.Onboarding) Onboarding.start(true);
      else toast && toast('Tour not loaded on this page');
    }}
  ];

  const SYMBOLS = ['SPY','QQQ','IWM','DIA','VIX','NVDA','AAPL','MSFT','META','AMZN','GOOGL','TSLA','AMD','SMCI','PLTR','COIN','MARA','RIVN','BABA','SHOP','CRM','UBER','GLD','TLT','USO','XLE','BTC','ETH'];

  function toast(msg) {
    if (window.Toast && typeof Toast.show === 'function') Toast.show(msg);
  }

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; }
  }
  function pushRecent(item) {
    const r = getRecent().filter(x => x.title !== item.title);
    r.unshift({ title: item.title, sub: item.sub, url: item.url, icon: item.icon });
    while (r.length > MAX_RECENT) r.pop();
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) {}
  }

  // ---------------- Scoring ----------------
  function score(item, q) {
    if (!q) return 1;
    q = q.toLowerCase();
    const t = (item.title || '').toLowerCase();
    const s = (item.sub || '').toLowerCase();
    let sc = 0;
    if (t === q) sc += 200;
    if (t.startsWith(q)) sc += 100;
    if (t.includes(q)) sc += 50;
    if (s.includes(q)) sc += 20;
    // fuzzy: chars in order
    let i = 0;
    for (const c of t) { if (i < q.length && c === q[i]) i++; }
    if (i === q.length) sc += 10;
    return sc;
  }

  // ---------------- Build & filter ----------------
  function buildItems(q) {
    const items = [];

    // Tickers — if query looks like a ticker
    const upper = q.toUpperCase();
    if (q.length >= 1) {
      SYMBOLS.forEach(s => {
        if (s.startsWith(upper)) {
          const quote = (typeof QUOTES !== 'undefined' && QUOTES[s]) ? QUOTES[s] : null;
          const sub = quote
            ? '$' + (quote.last || 0).toFixed(2) + '  ' + ((quote.changePct || 0) >= 0 ? '+' : '') + (quote.changePct || 0).toFixed(2) + '%'
            : 'Single-symbol focus';
          items.push({ title: s, sub, url: 'ticker.html?sym=' + s, icon: '🔍', kind: 'ticker', _score: 150 - s.indexOf(upper) * 10 });
        }
      });
    }

    PAGES.forEach(p => {
      const sc = score(p, q);
      if (sc > 0) items.push(Object.assign({ kind: 'page', _score: sc }, p));
    });
    ACTIONS.forEach(a => {
      const sc = score(a, q);
      if (sc > 0) items.push(Object.assign({ kind: 'action', _score: sc - 5 }, a));
    });

    items.sort((a, b) => b._score - a._score);
    return items.slice(0, 12);
  }

  // ---------------- DOM ----------------
  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'cmdk-overlay';
    overlay.innerHTML = `
      <div class="cmdk-backdrop"></div>
      <div class="cmdk-panel" role="dialog" aria-label="Command palette">
        <div class="cmdk-bar">
          <span class="cmdk-prompt">⌘</span>
          <input class="cmdk-input" placeholder="Search pages, tickers, actions…   (type to filter)" autocomplete="off" spellcheck="false" />
          <span class="cmdk-kbd">esc</span>
        </div>
        <div class="cmdk-results"></div>
        <div class="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> nav</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
          <span style="margin-left:auto;">Press <kbd>?</kbd> for shortcuts</span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    inputEl = overlay.querySelector('.cmdk-input');
    resultsEl = overlay.querySelector('.cmdk-results');
    overlay.querySelector('.cmdk-backdrop').addEventListener('click', close);
    inputEl.addEventListener('input', () => { highlighted = 0; render(); });
    inputEl.addEventListener('keydown', onKey);
  }

  function renderRecent() {
    const recent = getRecent();
    if (!recent.length) return '';
    let html = '<div class="cmdk-section">Recent</div>';
    recent.forEach((r, i) => {
      html += renderItem(r, i, false);
    });
    return html;
  }

  function renderItem(item, idx, isMain) {
    const cls = (isMain && idx === highlighted) ? 'cmdk-item active' : 'cmdk-item';
    const kindTag = item.kind === 'ticker' ? '<span class="cmdk-tag tag-ticker">TICKER</span>'
                  : item.kind === 'action' ? '<span class="cmdk-tag tag-action">ACTION</span>'
                  : item.kind === 'page'   ? '<span class="cmdk-tag tag-page">PAGE</span>' : '';
    return `<div class="${cls}" data-idx="${idx}" data-main="${isMain?1:0}">
      <span class="cmdk-icon">${item.icon || '→'}</span>
      <div class="cmdk-text">
        <div class="cmdk-title">${escape(item.title)}</div>
        <div class="cmdk-sub">${escape(item.sub || '')}</div>
      </div>
      ${kindTag}
    </div>`;
  }

  function escape(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function render() {
    const q = inputEl.value.trim();
    if (!q) {
      currentItems = [];
      const recent = getRecent();
      const main = PAGES.slice(0, 8).map(p => Object.assign({ kind: 'page' }, p));
      currentItems = main;
      resultsEl.innerHTML = renderRecent() + '<div class="cmdk-section">Jump to</div>' + main.map((m, i) => renderItem(m, i, true)).join('');
    } else {
      currentItems = buildItems(q);
      if (!currentItems.length) {
        resultsEl.innerHTML = '<div class="cmdk-empty">No matches. Try a page name, ticker (NVDA), or action.</div>';
      } else {
        resultsEl.innerHTML = currentItems.map((m, i) => renderItem(m, i, true)).join('');
      }
    }
    // Click handlers
    resultsEl.querySelectorAll('.cmdk-item').forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (el.dataset.main === '1') { highlighted = parseInt(el.dataset.idx, 10); updateActive(); }
      });
      el.addEventListener('click', () => {
        if (el.dataset.main === '1') execute(currentItems[parseInt(el.dataset.idx, 10)]);
        else {
          const recent = getRecent();
          execute(recent[parseInt(el.dataset.idx, 10)]);
        }
      });
    });
  }

  function updateActive() {
    resultsEl.querySelectorAll('.cmdk-item[data-main="1"]').forEach((el, i) => {
      el.classList.toggle('active', i === highlighted);
    });
    const el = resultsEl.querySelector('.cmdk-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function execute(item) {
    if (!item) return;
    pushRecent(item);
    close();
    if (item.action) item.action();
    else if (item.url) window.location.href = item.url;
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); highlighted = Math.min((currentItems.length || 1) - 1, highlighted + 1); updateActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlighted = Math.max(0, highlighted - 1); updateActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); execute(currentItems[highlighted]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  // ---------------- Public ----------------
  function open() {
    if (!overlay) createOverlay();
    overlay.classList.add('cmdk-open');
    document.body.classList.add('cmdk-body-locked');
    inputEl.value = '';
    highlighted = 0;
    render();
    setTimeout(() => inputEl.focus(), 30);
  }
  function close() {
    if (!overlay) return;
    overlay.classList.remove('cmdk-open');
    document.body.classList.remove('cmdk-body-locked');
  }
  function toggle() { (overlay && overlay.classList.contains('cmdk-open')) ? close() : open(); }

  // Global hotkey: Cmd+K / Ctrl+K
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      toggle();
    }
  });

  return { open, close, toggle };
})();

window.CmdPalette = CmdPalette;
