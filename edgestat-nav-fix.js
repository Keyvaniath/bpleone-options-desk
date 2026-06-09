// EdgeStat unified nav — DROP-IN REPLACEMENT for js/nav.js
// FIX: dropdowns were clipped by .mainnav's overflow:auto. Switching .dd-menu
// to position:fixed (with JS positioning from the button's bounding rect)
// escapes any current or future overflow setting on the nav container.
// Behavior is identical otherwise — same items, same active-page highlight,
// same click-outside-to-close, same toggle-on-second-click.
(function () {
  if (window.__edgestatNavInit) return;
  window.__edgestatNavInit = true;

  const SPORTS = [
    { href: "mlb.html",   label: "MLB" },
    { href: "golf.html",  label: "Golf" },
    { href: "nba.html",   label: "NBA" },
    { href: "nhl.html",   label: "NHL" },
    { href: "wnba.html",  label: "WNBA" },
    { href: "mls.html",   label: "MLS" },
    { href: "epl.html",   label: "EPL" },
    { href: "ucl.html",   label: "UCL" },
    { href: "nfl.html",   label: "NFL" },
    { href: "ncaaf.html", label: "NCAAF" },
    { href: "ncaab.html", label: "NCAAB" },
    { href: "cws.html",   label: "NCAA Baseball" },
    { href: "kbo.html",   label: "KBO" },
    { href: "lol.html",   label: "LoL" },
    { href: "cs.html",    label: "CS" },
    { href: "f1.html",    label: "F1" },
    { href: "ufc.html",   label: "UFC" },
  ];
  const PLAYERS = [
    { href: "nba-players-real.html",  label: "NBA Players" },
    { href: "wnba-players-real.html", label: "WNBA Players" },
    { href: "nhl-players-real.html",  label: "NHL Players" },
    { href: "lol-players.html",       label: "LoL Players" },
    { href: "cs-players.html",        label: "CS Players" },
    { href: "kbo-players.html",       label: "KBO Players" },
    { href: "player.html",            label: "MLB Player Search" },
  ];
  const TOOLS = [
    { href: "daily-summary.html",       label: "📰 Daily Summary" },
    { href: "heat-map.html",            label: "🔥 Heat Map (hot/cold)" },
    { href: "anomalies.html",           label: "⚠️ Anomalies" },
    { href: "ats-dashboard.html",       label: "📊 ATS Dashboard" },
    { href: "golf-live.html",           label: "⛳ Golf Live" },
    { href: "pitcher-matchup.html",     label: "⚾ Pitcher Matchup" },
    { href: "batter-sp-edges.html",     label: "🎯 Batter vs SP Edges" },
    { href: "batter-splits.html",       label: "📊 Batter Splits (H/A + D/N)" },
    { href: "convergence.html",         label: "🎯 Convergence Picks" },
    { href: "b2b-fatigue.html",         label: "😴 B2B Fatigue" },
    { href: "model-health.html",        label: "🏥 Model Health" },
    { href: "live-momentum.html",       label: "📈 Live Momentum" },
    { href: "slate-player-pot.html",    label: "🎯 Slate Player Pot" },
    { href: "todays-top-plays.html",    label: "⭐ Today's Top Plays" },
    { href: "locks-of-day.html",        label: "🔒 Locks of the Day" },
    { href: "cross-sport-parlays.html", label: "🎰 Cross-Sport Parlays" },
    { href: "consensus-picks.html",     label: "🎯 Consensus Picks" },
    { href: "data-health.html",         label: "📡 Data Health" },
    { href: "backtest-dashboard.html",  label: "Backtest Dashboard" },
    { href: "reliability.html",         label: "Calibration" },
    { href: "audit.html",               label: "Audit" },
    { href: "track-record.html",        label: "Track Record" },
    { href: "pod-history.html",         label: "POD History" },
    { href: "hedge.html",               label: "Hedge Calculator" },
    { href: "bankroll.html",            label: "Bankroll" },
    { href: "my-bets.html",             label: "My Bets" },
    { href: "simulator.html",           label: "Simulator" },
    { href: "linemaker.html",           label: "Linemaker" },
    { href: "arbitrage.html",           label: "Arbitrage" },
    { href: "ml-lab.html",              label: "ML Lab" },
    { href: "models.html",              label: "Models" },
    { href: "research.html",            label: "Research" },
    { href: "matchups.html",            label: "Best Matchups" },
    { href: "parlays.html",             label: "Parlays" },
    { href: "pickem.html",              label: "Pick-Em" },
    { href: "props.html",               label: "Props" },
    { href: "nrfi.html",                label: "NRFI" },
    { href: "config.html",              label: "Config" },
    { href: "training.html",            label: "Training" },
    { href: "learning.html",            label: "Learning" },
    { href: "residuals.html",           label: "Residuals" },
    { href: "live.html",                label: "MLB Live" },
  ];
  const TOP = [
    { href: "index.html",       label: "Dashboard" },
    { href: "accuracy.html",    label: "📊 Accuracy" },
    { href: "self-learning.html", label: "🧠 Self-Learning" },
    { href: "deep-edges.html",  label: "🔬 Deep Edges" },
    { href: "model-control.html", label: "🎛 Control" },
    { href: "learning-integrity.html", label: "🔬 Integrity" },
    { href: "line-shop.html",   label: "💰 Line Shop" },
    { href: "pulse.html",       label: "📡 Pulse" },
    { href: "backtest-replayer.html", label: "🔁 Replayer" },
    { href: "lifecycle.html",   label: "📈 Lifecycle" },
    { href: "tonight.html",     label: "🌙 Tonight" },
    { href: "live-now.html",    label: "Live Now" },
    { href: "play-of-day.html", label: "Play of Day" },
    { href: "best-bets.html",   label: "Best Bets" },
    { href: "brief.html",       label: "Brief" },
    { href: "learn.html",       label: "Learn" },
  ];

  function buildDropdown(label, items, currentPath) {
    const ddId = "dd_" + label.replace(/\s/g, "_");
    const itemsHtml = items.map(i => {
      const isActive = currentPath === i.href ? " style='color:var(--accent,#d4a04a);'" : "";
      return `<a href="${i.href}"${isActive}>${i.label}</a>`;
    }).join("");
    // CHANGED vs original: position:fixed so the .mainnav's overflow:auto
    // can't clip the menu. top/left are set by JS from the button's
    // getBoundingClientRect() each time the menu opens. z-index bumped to
    // 10000 so the menu stays above the topbar (z-index 100) and other
    // overlays.
    return `<div class="dd-wrap" style="position:relative; display:inline-block;">
      <button type="button" class="dd-btn" data-dd="${ddId}" style="background:none;border:none;color:var(--text-2,#aaa);font-size:12px;font-weight:500;padding:3px 6px;cursor:pointer;font-family:inherit;border-bottom:2px solid transparent;">${label} ▾</button>
      <div class="dd-menu" id="${ddId}" style="display:none;position:fixed;top:0;left:0;background:#0c0e13;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px;min-width:200px;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.4);max-height:60vh;overflow-y:auto;">
        ${itemsHtml.replace(/<a /g, '<a style="display:block;padding:6px 10px;font-size:12px;color:var(--text-2,#aaa);text-decoration:none;border-radius:4px;" onmouseover="this.style.background=\'rgba(255,255,255,0.05)\'" onmouseout="this.style.background=\'\'" ')}
      </div>
    </div>`;
  }

  function buildNav() {
    const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const topHtml = TOP.map(i => {
      const active = path === i.href.toLowerCase() ? ' class="active"' : "";
      return `<a href="${i.href}"${active}>${i.label}</a>`;
    }).join("");
    const sportsDd = buildDropdown("Sports", SPORTS, path);
    const playersDd = buildDropdown("Players", PLAYERS, path);
    const toolsDd = buildDropdown("Tools", TOOLS, path);
    return topHtml + sportsDd + playersDd + toolsDd;
  }

  // Anchor the fixed-position menu to the button's current screen position.
  // Called every time a menu opens, and on scroll/resize while any is open.
  function positionMenu(btn, menu) {
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.left = r.left + 'px';
    // Keep menu inside viewport horizontally
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const menuW = menu.offsetWidth || 200;
    if (r.left + menuW > vw - 8) {
      menu.style.left = Math.max(8, vw - menuW - 8) + 'px';
    }
  }

  function installNav() {
    const nav = document.querySelector("nav.mainnav");
    if (!nav) return;
    nav.innerHTML = buildNav();

    document.querySelectorAll(".dd-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.dd;
        const menu = document.getElementById(id);
        if (!menu) return;
        // Close every other menu first
        document.querySelectorAll(".dd-menu").forEach(m => { if (m !== menu) m.style.display = "none"; });
        const wasOpen = menu.style.display === "block";
        if (wasOpen) {
          menu.style.display = "none";
        } else {
          // Show first so offsetWidth measures correctly, then anchor.
          menu.style.display = "block";
          positionMenu(btn, menu);
        }
      });
    });

    // Reposition any open menu on scroll/resize so it stays glued to its button.
    const reposition = () => {
      document.querySelectorAll(".dd-menu").forEach(m => {
        if (m.style.display !== "block") return;
        const btn = document.querySelector(`[data-dd="${m.id}"]`);
        if (btn) positionMenu(btn, m);
      });
    };
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);

    // Close on outside click
    document.addEventListener("click", e => {
      if (!e.target.closest(".dd-wrap") && !e.target.closest(".dd-menu")) {
        document.querySelectorAll(".dd-menu").forEach(m => m.style.display = "none");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installNav);
  } else {
    installNav();
  }
})();
