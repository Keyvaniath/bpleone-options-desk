# 🤝 HANDOFF — Quick Start for Next Session

**Project:** `bpleone-trading` — institutional-grade options & TA desk for `options.bpleone.com`
**Status:** Built but not yet deployed. 44 pages, 5 JS modules, 316 KB compressed bundle, 0 audit failures.

---

## 60-second briefing

Brandon (the user) is building a Wall Street-grade options/TA platform as a subdomain of his hub site `bpleone.com`. The Pokémon TCG desk is already live at `pokemon.bpleone.com`; this is the equity/options/TA desk going to `options.bpleone.com`. He uses Squarespace for the hub + plans to host this static site on Netlify or GitHub Pages.

**What's built:** 44 HTML pages across 4 nav groups (Plays / Trading / Tools / Education) covering trade ideas, options flow, full options chain with Black-Scholes, GEX, momentum, sectors, news/sentiment, smart-money tracking, backtester, portfolio optimizer, position sizing, execution math, vol surface/cone, pair trading, an AI chat assistant, a self-learning engine that tracks outcomes, and a developer API reference. All wired into nav, sitemap, and a deploy bundle.

**What's NOT done:** Site isn't deployed yet. Brandon needs to drop the v5 ZIP on Netlify + add a CNAME in Squarespace DNS for `equity` → his Netlify URL. Full step-by-step is in `DEPLOY.md`.

**The architecture:** Static HTML/CSS/JS, no build step, no framework. Single CSS file, 5 JS modules attached to `window`. All "live" data is mock-streamed by `js/live.js`. To swap for real data, replace one function with a WebSocket subscription — instructions in `api.html`.

---

## Read these in order before doing anything

1. **`CLAUDE.md`** — full architecture, conventions, file map, audit baseline. This is the canonical reference Claude Code reads automatically.
2. **`DEPLOY.md`** — how to ship to `options.bpleone.com`. 4 paths covered.
3. **`README.md`** — public-facing project overview.

---

## What Brandon most likely wants next

He's the type who says **"keep building"** and means it. If unclear, ask once, then ship. Don't deliberate.

His most common requests:
- "Keep building" → add more pages. He's built 60+ already in 5 batches.
- "Walk me through deploy" → live-coach him through `DEPLOY.md` steps.
- "Audit and fix" → run the audit script in `CLAUDE.md`, fix anything that fails.
- "Make it more like Unusual Whales" → denser data, more flow detail.
- "Add real data" → swap the tick generator in `js/live.js`.

---

## Conventions to keep (don't change without asking)

- No build step, no frameworks (Vanilla + Chart.js CDN)
- All HTML pages at the root, not in `pages/`
- Use bash heredoc for files > 200 lines (Edit tool has truncation issues at this size in the sandbox)
- Always `node --check` JS after editing
- Match nav grouping logic when adding pages (update `playsGrp`/`tradeGrp`/`toolsGrp` in `js/app.js → buildNav()`)
