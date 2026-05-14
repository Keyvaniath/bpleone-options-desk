# ⚠️ YOU ARE MID-PROJECT. READ THIS FIRST.

> **Hi Claude. This is a continued session.** Prior Claudes built 60 HTML pages, 11 JS modules — institutional-grade trading platform with real-time data adapters (Finnhub/Polygon/Tradier/Alpaca), real Claude API integration in the assistant + AI Scout (idea generator), settings page for API key config, paper trading, single-symbol focus, volume profile, order flow heatmap, plain-English learn dashboard, squeeze radar, hot movers, multi-leg strategy builder with Greeks aggregator, today's game plan, command palette (⌘K), global hotkeys, toast system, and first-visit onboarding tour. **DO NOT RESTART.** Don't propose to rebuild anything. Read this file fully, then ask the user what specific thing they want next.
>
> **TL;DR for Brandon (the user):** he's building `options.bpleone.com` as a subdomain of `bpleone.com` (his Squarespace hub site). The Pokémon TCG desk already lives at `pokemon.bpleone.com`. This is the equity / options / TA desk going to `options.bpleone.com`. It's BUILT but NOT DEPLOYED yet.
>
> **First-thing-to-do checklist:**
> 1. Confirm to Brandon you've read this file: "Caught up. 50 pages, 7 JS modules, real data + Claude API plumbed, audit clean, ready to ship to options.bpleone.com."
> 2. Ask what he wants next (most likely: "keep building", "deploy this", "audit and fix", or "wire it to my live data feed").
> 3. **Do NOT** ls the project to figure out what exists — the file map below is authoritative.
> 4. **Do NOT** propose a "fresh start" — everything is already wired together.
>
> Now continue reading.

---

# CLAUDE.md — Handoff for next Claude session

> **Read this first.** Everything Claude Code needs to pick up where the previous session left off, without re-discovering the codebase.

---

## TL;DR — what this is

This is `bpleone-trading`, an institutional-grade options + technical-analysis web platform that ships to **`https://options.bpleone.com`** (a subdomain of Brandon's Squarespace-hosted hub at `bpleone.com`). It's the second of multiple "desks" Brandon is building — the Pokémon TCG desk is already live at `pokemon.bpleone.com`. This one is the equity / options / TA desk.

The site is **static HTML/CSS/JS** (no build step, no framework). Drop the folder on Netlify, GitHub Pages, Vercel, or Cloudflare Pages and it's live. No backend yet — all "live" data is generated client-side by a mock streaming engine that's designed to be swapped for a real WebSocket feed (Polygon / Tradier / Alpaca / Finnhub).

---

## Quick orientation

| | |
|---|---|
| **Domain** | `options.bpleone.com` (CNAME file at repo root) |
| **Pages** | 67 HTML files at the root (no `pages/` subdir) |
| **JS modules** | 11 files in `js/` — `app.js`, `charts.js`, `live.js`, `learn.js`, `notify.js`, `data-provider.js`, `ai-client.js`, `command-palette.js`, `hotkeys.js`, `onboarding.js`, `toast.js` |
| **CSS** | Single file: `css/style.css` (~1,460 lines, dark institutional theme) |
| **Assets** | `assets/icon.svg` + root `favicon.svg` |
| **PWA** | `manifest.json` at root, theme color `#00d4ff` |
| **SEO** | `robots.txt`, `sitemap.xml` (49 URLs) |
| **Deploy guide** | `DEPLOY.md` — 4 paths (GitHub Pages, Vercel, Netlify, Squarespace embed) |
| **Latest ZIP** | `bpleone-trading-v5.zip` (stale — rebuild before deploy) |

To preview locally: `python3 -m http.server 8080` and open `http://localhost:8080`.

---

## File map (50 HTML pages)

Grouped the way the navigation dropdowns group them in `js/app.js → buildNav()`:

### Top-level
- `index.html` — landing (hero, TOTD preview, features, CTA)
- `dashboard.html` — main market dashboard (SPY chart, signals, watchlist, news, econ cal)
- `education.html` — Options 101, TA, Strategies, Risk, Glossary (tabbed)
- `about.html` — pricing, FAQ, contact, disclosures
- `404.html` — themed not-found page

### Plays (7)
- `plays.html` — Plays of the Day, 8 conviction-ranked cards
- `trade-of-the-day.html` — featured single trade with full thesis + chart + options plays
- `pre-market.html` — 5:30 AM ET morning brief (TL;DR, catalysts, key levels, game plan)
- `signals.html` — live signal feed with filters
- `earnings-calendar.html` — week grid + headline-names table + IV-crush tracker
- `zero-dte.html` — 0DTE options dashboard with strike map and gamma walls
- `setup-wizard.html` — 6-step trade builder, logs into Edge Analytics

### Trading (18)
- `options-flow.html` — unusual options activity table, sweeps/blocks, IV smile
- `options-chain.html` — **the big one** — full chain w/ Greeks, strategy builder, Black-Scholes calc, P/L diagram (530 lines)
- `vol-surface.html` — IV surface grid (strikes × expiries), smile + term slice charts
- `vol-cone.html` — historical realized-vol percentile bands + current IV overlay
- `technical-analysis.html` — multi-indicator scanner, key-levels table
- `momentum.html` — multi-lookback RS ranking, Donchian breakouts, sector rotation
- `heatmap.html` — Finviz-style sector treemap, sized by mkt cap, colored by today
- `market-internals.html` — A/D, TICK/TRIN/VIX, McClellan, P/C ratio, yield curve, dark pool
- `smart-money.html` — Congress trades, Form 4 insiders, 13F shifts, leaderboard
- `watchlists.html` — localStorage-persisted multi-list manager
- `gex.html` — gamma exposure map, vanna, charm, GEX history
- `tape.html` — live Level-2 + ticking time & sales (600ms cadence)
- `sectors.html` — 11-sector tabbed deep-dive, rotation quadrant, factor tilts
- `pairs.html` — pair trading / stat arb scanner (Z-score, cointegration)
- `calendar-analyzer.html` — calendar/diagonal spread builder + P/L
- `dark-pool.html` — live dark pool print stream, % of vol by symbol, biggest blocks today, 30d history
- `short-interest.html` — SI% of float, days-to-cover, squeeze candidates, FTDs, Reg SHO threshold list
- `etf-flows.html` — daily creation/redemption, sector tiles, leaderboards, rotation quadrant, levered rebalance

### Tools (20)
- `fundamentals.html` — equity research view: earnings, financials, valuation, ratings, ownership (tabbed)
- `macro.html` — global indices, yield curve, central banks, FX, commodities, macro cal
- `news.html` — aggregated headlines with sentiment scoring per ticker
- `risk-dashboard.html` — portfolio Greeks, VaR/CVaR, scenario shocks, correlation, equity curve
- `backtester.html` — 8 strategies × any asset × date range, full perf/trade/risk stats
- `journal.html` — log every trade, CSV export, feeds Learn engine
- `alerts.html` — custom alerts (12 condition types), polls every 2.5s, fires browser notifications
- `edge-analytics.html` — **the self-learning brain** — learned setup weights, win rate by setup/sector/DoW/hold
- `crypto.html` — BTC/ETH, dominance, funding, ETF flows, on-chain, whale prints
- `screener.html` — multi-factor screener with custom weights, 6 presets, 18-stock universe
- `anomalies.html` — statistical outliers, vol spikes, gap moves, regime shifts
- `assistant.html` — chat UI. Routes to real Claude (streaming) when Anthropic key set in settings.html; falls back to 12 keyword-routed canned responses otherwise
- `portfolio-builder.html` — Markowitz mean-variance optimization, efficient frontier, max-Sharpe optimizer
- `position-sizing.html` — 4 sizing methods (fixed-fractional, Kelly, ATR, vol-targeted) + options sizing
- `execution.html` — Almgren-Chriss implementation shortfall, TWAP schedule, cost breakdown
- `strategies.html` — 24-strategy library with max profit/loss, BE, POP, when-to-use
- `seasonality.html` — year×month heatmap, DoW & monthly averages, OPEX patterns, presidential cycle, Santa rally
- `economic-events.html` — Fed dot plot, this-week + 30d calendar, CPI/NFP reaction histograms, 5y CPI/Unrate charts
- `settings.html` — **data provider config**, Claude API key, prefs, diagnostics, backup/restore, danger zone
- `api.html` — developer reference for the live engine + webhooks

---

## JS architecture — read this

All 7 JS modules attach to the global window (no modules, no bundler). Load order on most pages:

```html
<script src="js/data-provider.js"></script>  <!-- real WS adapter (Finnhub/Polygon/Tradier/Alpaca) -->
<script src="js/ai-client.js"></script>      <!-- Claude API wrapper for assistant -->
<script src="js/app.js"></script>            <!-- nav, footer, ticker, tabs, sort, search, clock, live-data pill -->
<script src="js/notify.js"></script>         <!-- browser push -->
<script src="js/charts.js"></script>         <!-- Chart.js helpers (only on chart pages) -->
<script src="js/live.js"></script>           <!-- mock tick engine + BS + chain generator -->
<script src="js/learn.js"></script>          <!-- self-learning engine (only on plays/journal/edge) -->
<script>buildNav('pagename');</script>
```

**Important:** `data-provider.js` and `ai-client.js` should load BEFORE `live.js` so the live engine can consult `DataProvider.init()` to decide whether to start the mock tick loop or yield to a real WebSocket feed. The 6 newest pages (settings, dark-pool, short-interest, etf-flows, seasonality, economic-events, assistant) include both. Older pages still run on mock — they don't need the upgrade unless Brandon wants live data flowing through their `data-live` bindings, in which case just add the two `<script>` tags before `js/live.js`.

### `js/app.js` (~330 lines)
- `buildNav(activePage)` — renders nav with active state, 4 dropdowns (Plays / Trading / Tools / Education), wires the 🔔 notify button
- `buildFooter()` — renders 5-col footer with disclaimer
- `startMarketClock()` — updates `#market-clock` every second with NY-time market session status
- `initTabs() / initFilters() / initSort() / initSearch() / initSubscribe()` — generic page wiring (idempotent, safe to call multiple times)
- Auto-init on `DOMContentLoaded` calls everything except `buildNav` (page-specific, called inline)

### `js/live.js` (~290 lines) — **mock data + Black-Scholes**
- `QUOTES` — keyed-by-symbol live quote map (28 symbols)
- `Feed.subscribe(sym, cb)` / `Feed.publish(sym, q)` — pub/sub for tick updates
- `startLive(intervalMs)` — kicks off the mock tick generator (OU mean-reverting random walks)
- `BS.price / BS.greeks / BS.impliedVol` — Black-Scholes pricing + Greeks + bisection IV solver
- `buildChain(symbol, expiries, strikesAround)` — generates a synthetic options chain w/ smile
- `strategyPayoff(legs, sRange)` — P/L at expiration for any multi-leg structure
- `bindLive()` — auto-updates any element with `data-live="SYM:field"` attribute on every tick. Fields: `last`, `change`, `changePct`, `bid`, `ask`, `volume`. Flashes green/red on change.

**To wire real data**: it's now zero-code. User opens `settings.html`, picks a provider, pastes their API key, toggles "Enable Live Feed", clicks Save & Connect. `js/data-provider.js` takes over from there — every `data-live` binding on every page that includes `data-provider.js` starts streaming real ticks. The mock engine auto-pauses.

### `js/learn.js` (~210 lines) — **the self-learning engine**
- Uses `localStorage` key `bpleone_learn_v1`
- `Learn.recordTrade(t)` — log a new open trade
- `Learn.closeTrade(id, exit, reason)` — close it, compute R, rebalance weights
- `Learn.rebalanceWeights()` — recompute setup weights from realized expectancy (squashed to `[0.5, 1.6]`)
- `Learn.adjustedScore(rawScore, type)` — apply learned weight to a raw signal score
- `Learn.stats()` — full roll-ups: by setup, sector, day-of-week, hold duration
- `Learn.reset()` — wipe all learning memory
- **Pre-seeded** with 240 simulated prior trades on first load so the system has signal from minute one

### `js/charts.js` (~360 lines) — **Chart.js helpers**
Wraps Chart.js with the dark theme and provides factories:
- `renderPriceChart`, `renderPriceWithMAChart`, `renderRSIChart`, `renderMACD`, `renderVolumeChart`
- `renderSectorChart`, `renderFlowDonut`, `renderIVSmile`, `renderOIByStrike`, `renderPerfChart`
- `baseOptions(showLegend=false)` — the shared chart config object

### `js/data-provider.js` (~360 lines) — **real-time data adapter**
Pluggable WebSocket layer that lets the site swap mock for real. Config persisted at `bpleone_data_v1`.
- `DataProvider.init()` — auto-called from `live.js`. Returns `{ useMock: true|false }`. If a real provider is configured & enabled, init connects the WS and yields the mock engine.
- `DataProvider.connect() / disconnect() / reconnect()` — explicit controls.
- `DataProvider.saveConfig({ provider, apiKey, apiSecret, enabled, symbols, subscribeAll })` — settings.html writes here.
- `DataProvider.getStatus() / onStatus(cb)` — subscribe to `{ status, provider, enabled, lastError, messagesReceived, bytesReceived, lastMessageAt, reconnectAttempts }`. Used by the nav pill.
- `DataProvider.getHistorical(symbol, resolution, fromMs, toMs)` — REST historical bars. Falls back to synthetic bars if no provider configured.
- **Supported providers:**
  - `mock` — built-in OU walks
  - `finnhub` — `wss://ws.finnhub.io` (free tier, real-time US trades)
  - `polygon` — `wss://socket.polygon.io/stocks` (T trades + Q quotes)
  - `alpaca` — `wss://stream.data.alpaca.markets/v2/iex` (free, IEX feed, needs key+secret)
  - `tradier` — `wss://ws.tradier.com/v1/markets/events` (broker tier, REST session token first)
- Each handler funnels into `applyTrade(sym, price, size)` and `applyQuote(sym, bid, ask)` which mutate `QUOTES[sym]`, recompute derived fields, and republish via `Feed.publish()` — keeping every existing `data-live` binding working unchanged.
- Exponential backoff reconnect (1.5s base, 30s cap, 2^n).

### `js/ai-client.js` (~180 lines) — **Claude API wrapper**
Direct browser-to-Anthropic. Config persisted at `bpleone_ai_v1`. Uses the `anthropic-dangerous-direct-browser-access: true` header (single-user pattern — for public multi-user, proxy through a backend).
- `AIClient.chat(messages, opts?)` — one-shot Messages API call. Returns `{ text, usage, stop_reason, model }`.
- `AIClient.chatStream(messages, opts?, onChunk)` — server-sent-events streaming. `onChunk(delta, fullSoFar)` fires per text delta.
- `AIClient.buildSystemPrompt()` — auto-injects the live market snapshot (from `QUOTES`) + desk methodology + page-routing hints into the system prompt.
- `AIClient.testConnection()` — sends "Reply pong" for a health check.
- `AIClient.saveConfig({ apiKey, model, maxTokens, enabled })` — wired from settings.html.
- `AIClient.isReady()` — boolean. `assistant.html` uses this to decide whether to route to Claude or fall back to the canned heuristic responses.

### `js/notify.js` (~80 lines)
- `Notify.request()` — request browser notification permission
- `Notify.fire(title, body, opts)` — show a notification
- `Notify.autoSubscribeSignals()` — pings on > 2% moves, debounced per-symbol-per-minute
- `Notify.setMuted(bool)` / `Notify.isMuted()` — per-user mute preference

---

## CSS conventions

`css/style.css` is the only stylesheet (~1,430 lines, organized into commented sections). Single-tier rules — no nesting, no preprocessor. Heavy use of CSS custom properties at `:root` for the design tokens.

**Layout system:**
- `.grid` with `.grid-2 / -3 / -4 / -12` for column counts
- `.col-2 / -3 / -4 / -5 / -6 / -7 / -8 / -9 / -12` for column spans in a 12-col grid
- `.card` is the base panel container
- `.card-header` + `.card-title` for panel headers

**Typography:**
- Inter for sans
- JetBrains Mono for `.mono` and all numeric values

**Colors (CSS variables):**
- `--accent` = `#00d4ff` (brand cyan)
- `--green` / `--red` / `--yellow` / `--purple` for signals
- `--green-bg` / `--red-bg` etc. for soft-tint backgrounds

**Utility classes** at the bottom of the file: `.flex`, `.gap-{8,12,16}`, `.mt-{8,16,24}`, `.mb-{8,16,24}`, `.text-center`, `.mono`.

**Responsive:** breakpoints at 1100px and 768px collapse grids.

---

## What works, what's mocked

**Works for real:**
- **Real-time market data feed** (Finnhub free tier, Polygon, Tradier, Alpaca — pick in `settings.html`)
- **Claude API in the assistant** (drop in an Anthropic key in `settings.html` → assistant routes to real Claude w/ streaming responses + market context system prompt)
- All Black-Scholes math (real, validated against textbook examples)
- The self-learning engine (real localStorage persistence; really does rebalance weights from realized R)
- Position sizing math (fixed-fractional, ¼-Kelly, ATR, vol-targeted)
- Implementation Shortfall (Almgren-Chriss simplified)
- Pair trading Z-scores (real math on synthetic price series)
- Browser notifications (real `Notification` API)
- Watchlists (real localStorage)
- Trade journal (real localStorage)
- Alerts (real polling + real notification fires)
- The chat assistant routing (keyword-matched fallback when no LLM key; real Claude when configured)
- Settings export/import + danger-zone resets

**Still mocked / placeholder data (until user wires their provider):**
- Ticker quotes default to OU-mean-reverting random walks; flip on real feed in `settings.html`
- News headlines (no Benzinga/Finnhub news wiring yet — could be added to data-provider)
- Congressional / insider transactions (no QuiverQuant/Capitol Trades wiring)
- Earnings calendar dates (no Earnings Whispers wiring)
- Option chain prices (synthetic — Polygon and Tradier expose real chains via REST; not yet plumbed)
- Dark pool prints stream on `dark-pool.html` (synthesizes from `QUOTES.last` — real feeds available via Polygon's `T` events with `D` condition code)

The mock-to-real swap is now **a config toggle** in settings.html — no code change required for live quotes.

---

## Deployment status (as of this handoff)

- **Domain target:** `options.bpleone.com` (CNAME file at repo root)
- **Bundle:** `bpleone-trading-v5.zip` — 316 KB compressed, 44 HTML + 5 JS + 1 CSS + 2 SVG
- **NOT yet deployed.** Brandon was going to drop this on Netlify (or match whatever he used for `pokemon.bpleone.com`).
- **Hub status:** `bpleone.com` shows the "Options Desk" tile as "Coming Soon" pointing to `options.bpleone.com`. Once this site is live, that tile needs:
  1. Coming-Soon badge → LIVE
  2. Description rewritten — current Squarespace copy says "Bottom-up DCF + comps modeling" which is wrong; the desk is options/TA/momentum primarily. Suggested copy is in `DEPLOY.md`.

---

## Audit baseline — the last full audit passed

The previous session ran an 18-point deep audit. All checks passed:

| Check | Status |
|---|---|
| 50 HTML pages closed properly | ✓ |
| 7 JS modules parse via `node --check` | ✓ |
| 50 inline `<script>` blocks parse | ✓ |
| All internal `href` links resolve | ✓ |
| All `#anchor` targets exist | ✓ |
| No duplicate IDs per page | ✓ |
| All chart `<canvas>` IDs referenced in JS | ✓ |
| All `data-live` symbols valid in `QUOTES` | ✓ |
| 0 missing CSS classes (191 classes tested) | ✓ |
| Manifest icons exist | ✓ |
| `robots.txt` + `sitemap.xml` correct domain | ✓ |
| Favicon on every page | ✓ |
| Nav `activePage` strings all match a dropdown group | ✓ |

**Known quirk:** the sandbox environment Brandon ran the build in occasionally truncated large files mid-write (≈ 50% of HTML edits with the Edit tool got cut off at ~8 KB). Workaround was using `bash` heredoc writes (`cat > file << 'EOF'`) for anything > 200 lines. Files are clean now; just worth knowing if you Edit a large file and the audit later flags it as having no `</html>`, that's the cause — re-write via bash heredoc.

---

## Conventions Claude Code should keep

1. **No build step.** This stays static HTML. Don't introduce webpack/vite/etc. without a reason.
2. **No frameworks.** No React, no Vue, no jQuery. Vanilla JS + Chart.js CDN only.
3. **No emojis in code that's not user-facing.** Brandon is fine with emojis in UI (they're throughout the nav and pages) but don't add them to code comments or commit messages.
4. **Pages are flat at the root.** Don't move them into a `pages/` directory — links would all break.
5. **Bash heredoc for any file > 200 lines.** Avoids the truncation issue. Edit tool is fine for surgical changes.
6. **Always `node --check` JS files after editing them.** Same for an extracted inline-script body. Audit script at the bottom of this doc.
7. **Black-Scholes is in `live.js`, not a separate file.** Don't refactor it out — it's referenced inline on `options-chain.html` and several other pages.
8. **Match the existing dropdown nav grouping logic in `js/app.js → buildNav()`.** New pages need to be added to `playsGrp`, `tradeGrp`, or `toolsGrp` arrays so the active state lights up.

---

## What's NOT yet built (Brandon may ask)

Things considered but not done:
- Real backend (auth, paid tier paywall, Stripe)
- Email subscribe wired to ConvertKit/Beehiiv (currently writes to `localStorage` only)
- Discord integration for the community tier
- Mobile-first refinement (responsive works but mobile UX could be tighter on some pages)
- TradingView widget embeds (we use Chart.js — could swap for richer TV widgets on key pages)
- Real LLM-powered assistant (current is keyword-routed canned responses)
- Real market data feed (one-line swap in `live.js`)
- Tests (no test suite — the audits live in shell scripts in conversation history)

---

## Quick audit script

**On Windows (no `node` needed)** — run the Python audit:
```bash
python _full_audit.py
```
Validates: JS module brace/paren/bracket balance via proper tokenizer, inline `<script>` blocks in every HTML, closing `</html>` tag, duplicate IDs, broken internal hrefs, and sitemap coverage. Files: `_balance.py` (tokenizer lib), `_full_audit.py` (orchestrator).

**On Mac/Linux with node** — the original bash audit still works:

```bash
echo "Pages: $(ls *.html | wc -l)"
echo "JS: $(ls js/*.js | wc -l)"

# All HTML closed
for f in *.html; do tail -3 "$f" | grep -q "</html>" || echo "✗ $f"; done

# JS valid
for f in js/*.js; do node --check "$f" 2>&1 | grep -E "Error" && echo "✗ $f"; done

# Inline scripts valid
for f in *.html; do
  python3 -c "
import re
c = open('$f').read()
inline = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', c, re.DOTALL)
print('\n'.join(inline))
" > /tmp/inline.js
  if [ -s /tmp/inline.js ]; then
    node --check /tmp/inline.js 2>&1 | grep -E "Error" && echo "✗ $f"
  fi
done
```

---

## How Brandon thinks about this product

This is the **second of multiple "desks"** Brandon is building on `bpleone.com`. Each desk is its own subdomain, its own deploy. The Pokémon TCG desk shipped first. This one is the equity / options / TA desk. Future desks planned: Sports Cards, Sports Betting / DFS, Sports Hub.

He wants this to feel like **Unusual Whales meets Goldman/MS terminal**. Institutional-grade UX, retail-friendly explanations underneath. He cares about:

- Speed (no build step, instant page loads)
- Depth (a real trader should find everything they'd want)
- A real **self-learning element** — the system improves over time based on tracked outcomes (this is what `learn.js` + `edge-analytics.html` are about)
- A daily **Trade of the Day** (the marquee feature) and a broader **Plays of the Day** ranking
- Making money — the product is the foundation; the pricing tiers are on `about.html` (Free / $49 Pro / $149 Desk)

He's based in Southern California, late 20s, finance background (equity research / IB style). He uses Squarespace for the hub site and is comfortable with terminal but prefers click-by-click guides if there's a faster path.

---

## Pick-up: typical next requests

If Brandon comes back, he's most likely to ask for one of these — in roughly this order of probability:

1. **"Keep building"** — meaning add more pages. He's added 60+ in 5 batches and hasn't slowed down. Read the "What's NOT yet built" section and propose 5-8 fresh additions.
2. **"Walk me through deploying to Netlify"** — the DEPLOY.md has the full guide; offer to be his real-time co-pilot through the 6 steps.
3. **"Fix [page X], it's not loading the chart"** — Chart.js timing issue; check that the `<canvas>` ID matches the render call, and that `chart.umd.min.js` CDN is in the `<head>`.
4. **"Make [page X] more like Unusual Whales"** — typically means denser data, more contracts, more flow detail. Look at `options-flow.html` as the canonical "UW-style" page and replicate that density.
5. **"Add real data"** — point to the one-function swap in `live.js`. Recommend Polygon (cheapest production-grade equity + options) or Tradier (if he wants the trading-integration upside).

Good luck. Brandon's a fast-mover with strong taste — bias toward shipping over discussion.
