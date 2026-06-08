# ⚠️ YOU ARE MID-PROJECT. READ THIS FIRST.

> **Hi Claude. This is a continued session.** Prior Claudes built **400 HTML pages and 102 JS modules** — a complete institutional-grade trading platform with a **self-learning ML brain** (logistic regression + Adam optimizer, multi-horizon ensemble, MC dropout, bootstrap bagging, kNN recall, Platt + Isotonic + Regime calibration, OOD detection, drift PSI, conformal intervals, meta-stacking, per-symbol bias, label smoothing, sample-decay, mixup, self-distillation, hindsight replay, active learning), high-conviction push notifications, autopilot paper trading (AutoTrade), brain coach (live speech), per-symbol leaderboards, weekly auto-reports, what-if scenario tool, backup/restore, mobile dashboard. **DO NOT RESTART.** Don't propose to rebuild anything. Read this file, then continue from where the prior Claude left off.
>
> **TL;DR for Brandon (the user):** he's building `options.bpleone.com` as a subdomain of `bpleone.com`. **The site IS LIVE on GitHub Pages** (CNAME at repo root). The Squarespace hub tile is documented in `SQUARESPACE-FIX.md` + `SQUARESPACE-TILE.html` + `squarespace-preview.html`. The Pokémon TCG desk is at `pokemon.bpleone.com`. Brandon's mode is autonomous-build: he says "continue" or "keep building" and expects you to ship without confirmation prompts. He hates being asked permission for routine work.
>
> **First-thing-to-do checklist:**
> 1. `git log --oneline -15` to see recent commits — the most recent reflect today's audit work.
> 2. Read `/audit-log.html` to see the running list of audit passes + critical bugs found.
> 3. **Default action when Brandon says "continue":** find next thing to audit/build (the audit-log will hint), wire into `js/app.js` nav, add to `sitemap.xml`, lint, commit, push. No questions asked.
> 4. **Do NOT** ls the project to figure out what exists — use `Glob '*.html'` and `git log`. The page count is current at the top of this doc, not a stale enumerated list.
> 5. **Do NOT** propose a "fresh start" — everything is wired.
> 6. **The ML brain stack:** see `js/model.js` (Adam logistic engine), `js/brain-loop.js` (background ticks), `js/continuous-learner.js` (capture/resolve/train every 30s), `js/historical-bootstrap.js` (250-day Stooq warmup × 47 symbols), `js/auto-trainer.js` (6h cadence), `js/multi-horizon.js` + `js/bootstrap-ensemble.js` + `js/knn-recall.js` + `js/unified-predictor.js` (composes everything).
>
> Now continue reading.

---

# CLAUDE.md — Handoff for next Claude session

> **Read this first.** Everything Claude Code needs to pick up where the previous session left off, without re-discovering the codebase.

---

## TL;DR — what this is

This is `bpleone-trading`, an institutional-grade options + technical-analysis web platform that ships to **`https://options.bpleone.com`** (a subdomain of Brandon's Squarespace-hosted hub at `bpleone.com`). It's the second of multiple "desks" Brandon is building — the Pokémon TCG desk is live at `pokemon.bpleone.com`. This one is the equity / options / TA desk.

The site is **static HTML/CSS/JS** (no build step, no framework). Drop the folder on GitHub Pages and it's live. There's no backend — every "smart" feature runs client-side off localStorage. The data layer is the **Stooq zero-key fallback** (CSV poll every 12s for 47 symbols, ~15-min delayed) + **Coinbase WebSocket** (real-time BTC/ETH). User can swap in Finnhub/Polygon/Alpaca/Tradier via `settings.html`.

---

## Quick orientation

| | |
|---|---|
| **Domain** | `options.bpleone.com` (CNAME file at repo root) |
| **Pages** | 400 HTML files at the root (no `pages/` subdir) |
| **JS modules** | 102 files in `js/` |
| **CSS** | Single file: `css/style.css` (~1,500 lines, dark institutional theme) |
| **Manifest** | `manifest.json` (PWA), theme color `#00d4ff` |
| **SEO** | `robots.txt`, `sitemap.xml` (397 URLs) |
| **Deploy** | GitHub Pages from `main` |
| **Hub linkage** | `index.html` opens with a ribbon back to `bpleone.com`; nav has a small ← Hub pill on every page |

To preview locally: `python3 -m http.server 8080` then open `http://localhost:8080`.

---

## Page groups — where to find things

Don't trust any list of named pages — it goes stale. Instead, the nav grouping in `js/app.js` (`buildNav()`) is the canonical map:

| Nav group | Variable in `app.js` | What's there |
|---|---|---|
| Daily | `playsGrp` | Trade of the Day, Morning Brief, Plays of the Day, Pre-market, Conviction Stack, Signals, Earnings, 0DTE, Squeeze Radar, Trade Plan |
| Trade & Flow | `tradeGrp` | Day-Trader PRO, Big Bets, Options Flow + Chain + Pricer + Builder, Dark Pool, Pair Trades, Wheel, Vol Surface/Cone, Calendar |
| Brain | `brainGrp` | Brain Heartbeat/Audit/Decisions/Hub/Truth, ML pages (model-*, calibration, brier-skill, sharpe, kNN, meta-stacker, isotonic, regime, drift-psi, etc.), Training tools (train-now, learning-velocity, brain-debug, historical-bootstrap), 100+ ML diagnostic pages |
| Scanners | `scanGrp` | Algo signals, mean-reversion, trend-strength, confluence, edge-scanner, hot-movers, squeeze, pre-market scanners, earnings reactor, anomalies, IPO, pairs, candlestick, news-reactions, insider/congress, sweep counter |
| Markets | `marketsGrp` | Macro, market internals, breadth, sector rotation, heatmaps, yield curve, economic events, halt tracker, MOC imbalance, VIX, news |
| Tools | `toolsGrp` | Risk dashboards, fundamentals, backtester, journal, alerts, crypto, portfolio builder, position sizing, PDT, margin, execution, strategies, seasonality, settings, mindset, replay, hypothetical, account, performance attribution, **all-tools** (visual catalog of every page), PWA install, watchlist, money pages (money-made, mobile-money, voice-coach), webhook bridge, **pre-trade-checklist**, **train-now**, **learning-velocity**, **brain-debug**, **audit-log**, **self-test**, **live-status** |

`all-tools.html` is the human-readable index — if you need to find a specific page, look there.

---

## JS architecture — read this

All 102 JS modules attach to the global window. Most pages load this baseline:

```html
<script src="js/data-provider.js"></script>  <!-- WS/CSV adapter; Stooq fallback default -->
<script src="js/ai-client.js"></script>      <!-- Claude API wrapper (browser-direct) -->
<script src="js/app.js"></script>            <!-- nav, footer, ticker, clock, hub pill -->
<script src="js/notify.js"></script>         <!-- browser push -->
<script src="js/live.js"></script>           <!-- QUOTES + Feed pub/sub + Black-Scholes + mock tick -->
<script>buildNav('pagename');</script>
```

`live.js` also lazy-loads ~20 background modules on `DOMContentLoaded`: data-reliability, source-preference, stale-refresh, confidence-kelly, portfolio-allocator, money-tracker, demo-data, demo-fab, seed-detector, auto-trade, high-conviction-alerts, voice-coach, webhook-bridge, money-hotkeys, auto-watchlist, loss-cooloff, sound-synth, equity-protector, multi-horizon, brain-loop, model, more. Pages that need a specific module synchronously should add their own `<script src>` (see `_fix_direct_loads.py` for the auto-fixer).

### Critical modules to know

| Module | Purpose | Storage key |
|---|---|---|
| `model.js` | Logistic regression w/ Adam optimizer, 22-feature vectors, NaN-safe sigmoid | `bpleone_model_v1` |
| `continuous-learner.js` | Captures predictions every 30s, resolves at 1d/5d/20d horizons, trains the brain | `bpleone_pred_journal_v1` |
| `historical-bootstrap.js` | 250-day × 47-symbol warmup from Stooq on first visit | `bpleone_hist_bootstrap_v2` |
| `auto-trainer.js` | 6h cadence: pulls latest Stooq bars, trains main + per-horizon models | `bpleone_auto_train_ts_v1` |
| `weekly-refresh.js` | Every 3d: re-runs the historical bootstrap to ingest fresh history | `bpleone_weekly_refresh_v1` |
| `multi-horizon.js` | 3 logistic models (short/mid/long) with per-regime accuracy weighting | `bpleone_model_h_*_v1` |
| `bootstrap-ensemble.js` | K=5 logistic models trained via online bagging (P=0.6 inclusion) | `bpleone_bootstrap_model_k_*_v1` |
| `knn-recall.js` | Weighted-Euclidean k-NN over journal features (pass-60: returns P(LONG), not P(correct)) | reads `pred_journal_v1` |
| `calibrator.js` | Platt scaling (sigmoid fit to logit-mapped pairs) | `bpleone_calib_*_v1` |
| `isotonic-calibrator.js` | PAV (non-parametric monotone fit) | `bpleone_isotonic_*_v1` |
| `regime-calibrator.js` | Per-regime Platt | `bpleone_regime_calib_v1` |
| `outlier-detector.js` | EMA-Welford for 22 features; OOD score 0–1 (pass-78: now decays old samples) | `bpleone_feature_stats_v1` |
| `drift-psi.js` | Population Stability Index drift detection (pass-76: dual export PSIDrift + DriftPSI) | `bpleone_psi_*_v1` |
| `meta-stacker.js` | Learned logistic blend of (model, ensemble, bootstrap, knn, swa) base predictions | `bpleone_meta_stacker_v1` |
| `unified-predictor.js` | Composes everything → `{ finalProb, finalSizeMult, components, narrative }` | (composes, no storage) |
| `brier-skill.js` | BSS vs baseline | `bpleone_brier_skill_v1` |
| `sharpe-tracker.js` | Annualized Sharpe (pass-67: corrected from 23400→252 periods/yr) | `bpleone_sharpe_v1` |
| `auto-trade.js` | Closed-loop paper trading (pass-72: anchors entry to current q.last, not stale journal price) | `bpleone_auto_trade_v1` |
| `confidence-kelly.js` | Confidence-scaled Kelly sizing (pass-74: input.fraction now overrides storage) | `bpleone_confidence_kelly_v1` |
| `ensemble-agreement.js` | Cross-method agreement scorer (pass-53: returns UPPERCASE tiers to match all callers) | (composes) |

---

## CSS conventions

`css/style.css` is the only stylesheet. Single-tier rules, heavy CSS custom properties at `:root`.

**Layout:** `.grid` + `.grid-2/-3/-4/-12`, `.col-N`, `.card`, `.card-header`, `.card-title`.
**Typography:** Inter (sans), JetBrains Mono (`.mono` + numeric values).
**Colors:** `--accent` (cyan), `--green`/`--red`/`--yellow`/`--purple`. Soft `--green-bg` etc.
**Variables:** pass-26 fixed the stale `var(--bg)` and `var(--text)` aliasing 50+ pages were broken on — both now resolve via `:root` aliases.
**Utility classes** at bottom: `.flex`, `.gap-{8,12,16}`, `.mt-{8,16,24}`, `.mb-{8,16,24}`, `.text-center`, `.mono`.

---

## Data layer — Stooq + Coinbase

**Default (no config required):**
- `js/data-provider.js` boots a Stooq CSV poll for 47 symbols every 12s
- `Coinbase` WS gives real-time BTC/ETH with exponential-backoff reconnect (pass-43)
- `DataReliability` validates every price (30% jump cap, 5min equity / 2min crypto stale)
- `SourcePreference` ranks fresh updates from multiple sources

**With user API key (settings.html → Save):**
- Finnhub / Polygon / Tradier / Alpaca via real WS — overrides Stooq, mock pauses

Every `data-live="SYM:field"` element auto-updates via `Feed.subscribe`. All pages share the same `QUOTES` global.

---

## Hub linkage

- **CNAME** → `options.bpleone.com`
- **index.html** opens with a visible ribbon back to bpleone.com (added pass 76)
- **Nav ← Hub pill** on every page via `js/app.js`
- **Squarespace tile** docs: `SQUARESPACE-FIX.md` (paths to fix), `SQUARESPACE-TILE.html` (raw source), `squarespace-preview.html` (one-click copy)

---

## Architecture as of pass 216 — the brain has +2.93pp walk-forward edge

Two brains run in parallel, with **WorkerBridge picking the authority**:

1. **Browser brain** (`js/continuous-learner.js`, `js/model.js`) — runs while a tab is open, captures from QUOTES, trains on resolutions. localStorage state.

2. **Cloudflare Worker brain** (`worker/src/index.js`) — runs 24/7 on Cloudflare edge, captures from Finnhub every minute (12 syms per minute rotating), resolves outcomes at 24h/5d/20d horizons, trains. Cloudflare KV state.

The browser pages can **mirror state from the worker** via `js/worker-bridge.js`. Brandon's worker is at `https://bpleone-brain-worker.brandonpleone.workers.dev`. Connect via `/worker-setup.html`.

**Pass 199 ownership rule:** when `WorkerBridge.isEnabled()` is true, the worker is the authoritative brain. The three browser-side trainers (`continuous-learner`, `auto-trainer`, `historical-bootstrap`) all defer their train+save blocks — capture and resolve still run for diagnostic display on `brain-proof.html`, but the browser doesn't train on local data the worker has already processed. This prevents silent gradient loss (next worker sync overwrote local updates) AND double-counting (browser trained on outcomes the worker had already incorporated). Pass 205 added the same gate to `ModelTrainer.trainBatch` (4th browser trainer that was missed).

**Pass 200 version drift detection:** `worker/src/index.js` exports `WORKER_VERSION` (currently `'pass-215'`) and exposes it via `/brain/health → worker_version`. `worker-setup.html` compares to a hardcoded `EXPECTED_WORKER_VERSION`. When you ship a worker behavior change, bump both — the UI will then show a yellow "redeploy" banner until Brandon runs `git pull && cd worker && wrangler deploy`.

### Pass 206-216 — the edge discovery story

After passes 188-205 wired the worker brain end-to-end with proper validation, **the first real bootstrap returned no signal** (heldout_bss ~ 0, walk-forward badly negative). That kicked off the tuning loop that eventually found real edge:

- **Pass 206:** pivoted prediction from 1-day-±0.3% (famously near-random on liquid stocks) to **5-day-±1%** (real swing-trade horizon).
- **Pass 207:** added L2 weight decay to the worker logistic (was none — model was making 95% confident wrong predictions, avgLoss=3.57).
- **Pass 208 (CRITICAL):** `runBootstrap` was reading the existing KV model instead of starting fresh. Successive bootstraps accumulated weights → pass-207's L2 looked ineffective because the model was stuck. Now `const model = newModel()` at top.
- **Pass 209 (cost):** market-hours gate (8am-5pm ET, M-F) + BARS_HISTORY only writes on new day-bar. Cut ~70% of off-hours cron cost.
- **Pass 210:** L2 5× stronger (0.003 → 0.015), epochs 5 → 2. avgLoss dropped from 3.57 to 1.43.
- **Pass 211 (BREAKTHROUGH):** restricted bootstrap training to the most recent **120 days** (was 250). Walk-forward accuracy jumped from 42.2% → **52.93%** (+2.93pp above random). The 250-day window was dragging in stale-regime data; cutting it forced the walk-forward train+test to share regime characteristics.
- **Pass 212:** L2 0.015 → 0.025 to nudge calibration. Mostly diminishing returns at this point.
- **Pass 213:** added Platt scaling calibration layer. Bootstrap splits walk-forward heldout in half — first 50% fits Platt, last 50% is the final test set. Live tick applies Platt to journaled `predProb`; preserves raw output as `predProbRaw`. Also added per-symbol BSS surface to brain-proof.
- **Pass 214 (CRITICAL guard):** first live Platt fit returned a=-0.777 — would have INVERTED the model's directional sign because the 12-day calibration set hit a different sub-regime than the final test set. Added `a < 0.2` rejection guard so noisy fits fall back to raw predictions.
- **Pass 215:** per-symbol surface was showing noise as signal (n ~ 15 per sym after the 120-day cut). Combined random_split + walk_forward heldouts (~30 per sym), added `stable` flag at n≥10, UI filters Top5/Bottom5 to stable rows.
- **Pass 216:** added Live Brain Picks card to brain-proof — fetches /brain/journal recent entries, deduplicates by symbol, sorts by conviction (|predProb − 0.5|), surfaces top 30. Closes the loop: 24/7 worker captures → calibrated predictions → visible "what to trade now" card.

**Current state of the brain (as of pass 216):**

| Metric | Value |
|---|---|
| Walk-forward accuracy (n=1,092) | 52.93% |
| Walk-forward BSS | -0.074 (mild miscalibration but positive directional edge) |
| Random-split accuracy | 48.4% (below random; smaller training set has more variance) |
| Bootstrap training window | last 120 days |
| Training epochs | 2 |
| L2 regularization | 0.025 |
| Platt calibration | a >= 0.2 guard; falls back to raw if rejected |
| Live tick frequency | every minute, market hours only (8am-5pm ET, M-F) |
| Cost throttle | BARS_HISTORY only written on new day-bar |

**For trading decisions:** read `predProb` off a journal entry (calibrated when Platt is healthy, raw otherwise). The bottom 50 symbols by stable per-symbol BSS should be **avoided** — they're where the brain has anti-signal. The top 5 stable symbols by BSS are where to **concentrate sizing**.

---

## Architecture as of pass 267 — THE HONEST FINDING: no proven TA timing edge (it's drift, not skill)

> **Read this before you believe any "the brain has edge" claim above.** Passes 217-267 stress-tested the pass-216 "+2.93pp edge" story and it did not survive honest scrutiny. The short version: **at a 5-day horizon, the TA features carry no statistically-significant directional timing edge.** The accuracy that looks like a win is market drift (beta), not skill (alpha). The product is now honest about this end-to-end — do NOT re-introduce a badge or headline that claims predictive edge the data doesn't support.

**What changed 217 → 267 (the arc):**

- **Pass 218 (CRITICAL):** live-training horizon mismatch + journal cap too small — fixed, plus the same 5d/1pp horizon alignment pushed through every browser trainer, auto-trade, trade-plan, money-tracker, sharpe, knn (passes 218b-n).
- **Passes 219-222:** browser Platt + RegimeCalibrator inversion guards; Platt kept only if it improves held-back Brier; flag-based journal clear (race fix); champion/challenger competition in bootstrap.
- **Passes 260-267 — edge stability, then the reckoning:**
  - Fixed a silent edge regression (walk-forward 53% → 44%): champion selection had ranked on Brier skill (BSS) alone, promoting a better-calibrated but directionally-worse model. Now ranks on **validation accuracy** with BSS as tiebreaker, plus a **promotion guard** (`incumbentWf = prevChamps.champion_wf_acc`; a fresh bootstrap only replaces the champion if its walk-forward accuracy is within 0.015 of the incumbent's) and an **edge-recovery auto-bootstrap** (re-bootstraps when `champion_wf_acc` < 0.50, 20h cooldown) so it never silently serves a sub-coin-flip model.
  - **CV config selection** (`cvScoreConfig`, K=5 forward-chaining folds) so hyperparameters transfer instead of overfitting one split.
  - **6 stability features** (`addStabilityFeatures`, f[9]-f[14]: 50d SMA distance, 50d range position, mom5-mom20 divergence, mom10, up-day fraction, ATR5/ATR20 vol ratio), wired into BOTH `richFeatures` (bootstrap) and `extractRichFeatures` (live) — keep them in sync or live/train diverge.
  - **Dense labeling** (`LABEL_THRESHOLD = 0`, mid-horizon `HORIZON_MIN_MOVE = 0`) fed far more examples (17,784 → 26,496).
  - **The honesty metric.** Dense labeling reported 54.66% accuracy as "significant." The base-rate check exposed it: 54.66% = **52.36% drift** (unconditional 5-day up-rate) **+ 2.3pp skill**, which is NOT significant. `computeMetrics` now returns `base_rate`, `skill_above_base`, `beats_base_rate_95` and a verdict ("MOSTLY DRIFT (little timing edge)"). Edge badges on today.html / pick-of-day.html / proof.html gate GREEN on skill beating its 95% bound, AMBER on positive-but-not-significant skill, RED on negative — **never on raw accuracy.**

**Current honest state of the brain (pass 267, verified live):**

| Metric | Value |
|---|---|
| Trained on | 26,496 examples (dense labeling) |
| Walk-forward accuracy | 54.66% |
| Of which: market drift (base rate) | 52.36% |
| Of which: actual timing skill | +2.3pp — **NOT statistically significant** |
| Honest verdict | MOSTLY DRIFT (little timing edge) |
| Platt calibration | a=0.914 (healthy, not inverted) |
| Self-sustaining / audit_pass | true / true (worker checks own vitals every minute) |

**The strategic conclusion (do not re-litigate without new data):** TA features are **tapped out** at this horizon for direction AND volatility. More TA tuning has low ROI. Real edge requires *different data* — smart-money confluence / order flow / insider clustering — not more indicators. The confluence forward-test is the open experiment: `/brain/confluence-score` self-computes a verdict (`ready=false` until ≥20 graded confluence calls; then YES/PARTIAL/NO on whether brain+insider agreement beats a coin flip). It is **calendar-gated** — grades accrue at 5 trading days, ~20 needed = weeks. As of pass 267: 0 graded, first grades ~2 trading days out. The Edge Scorecard surfaces the verdict automatically when ready; **no code is pending — it self-reports.**

**New pages since pass 216:** `constraints.html` (noise-control editor — conviction floors, rvol/price filters, focus/exclude lists, regime gates; the brain trains on everything, this only governs what gets *broadcast*), `proof.html` (deep audit: self-check vitals, beat-a-coin-flip metrics, edge-by-conviction map, live record, methodology, per-trade why), `edge-scorecard.html` (confluence verdict banner).

### Worker endpoints

- `GET /brain/health` — readyz (lastTickAgo, healthy bool)
- `GET /brain/state` — full snapshot (journal+model+lastTick)
- `GET /brain/journal?n=N` — last N journal entries
- `GET /brain/model` — current model weights
- `GET /brain/metrics` — held-out + walk-forward BSS, accuracy, p-value (the "real signal vs noise" answer)
- `GET /brain/symbols` — per-symbol BSS breakdown
- `GET /brain/picks` — Pick of the Day + Best Long + Alpha list (honors `broadcast_constraints_v1`)
- `GET /brain/constraints` — current noise-control config (GET open; POST is auth — sets conviction floors, filters, focus/exclude)
- `GET /brain/confluence-score` — self-computing forward-test verdict (ready=false until ≥20 graded confluence calls)
- `GET /brain/news` — real headlines (no browser key needed)
- `GET /brain/insider` — SEC Form-4 insider transactions (16-name basket)
- `GET /brain/debug/fetch?sym=X` — diagnose data sources (Yahoo/Stooq)
- `POST /brain/bootstrap` (auth) — 250-day pre-train via Yahoo Finance v8
- `POST /brain/tick` (auth) — manual cron trigger

### Worker key invariants

- **NO browser CORS limits** — fetches Yahoo/Stooq successfully where browser can't
- **Finnhub free tier**: 60 calls/min, no /stock/candle (paid tier only). Worker rate-limits to 12 syms/tick (every minute, full universe rotates in ~6 min)
- **Cron tick only writes the model if `trained > 0`** (pass 190 race fix). Bootstrap is the authoritative model writer.
- **Per-symbol bar history in KV** (pass 193) so live captures use the same rich features as the bootstrap training set.

## Audit baseline — `/audit-log.html`

194+ audit passes have run on this codebase, finding **24+ CRITICAL bugs** that were silently corrupting metrics or breaking entire safety chains. The running log is at **`/audit-log.html`** — read it before adding new code. Some highlights worth knowing:

- **Pass 53**: EnsembleAgreement returned lowercase, 3 callers checked UPPERCASE → agreement-based sizing never fired
- **Pass 60**: kNN returned P(direction-correct), blended as P(LONG) → wrong-direction neighbors voted UP
- **Pass 67**: SharpeTracker used 23400 periods/yr → 9.6× over-reported annual Sharpe
- **Pass 72**: auto-trade opened at stale journal price → instant stop-outs on volatile names
- **Pass 76**: DriftPSI alias mismatch → drift-protection chain was inert across 5 callers
- **Pass 76b**: 5 modules (AIClient, BS, DataProvider, Feed, Notify) declared with top-level `const` never auto-attached to window → defensive `window.X` access returned undefined
- **Pass 78**: outlier-detector now decays old samples (EMA cap 500); bootstrap-ensemble removed dead `hashSeed`; ensemble-agreement unknown case NaN-guarded; continuous-learner per-horizon rMultiple typo
- **Pass 119 + 163-170 (TZ-naive bug class)**: model.js feature[20] used local `getHours()` → for PT user (Brandon) every prediction had a wrong hour-of-session feature. Same bug class then found in 13+ MORE places (brain-monthly-calendar, daily-report, brain-weekly-report, daily-replay, time-of-day-brain, brain-questions, cohort-analysis, setup-compare, performance-attribution-pro, model-postmortem, continuous-learner.stats(), streak-tracker.trend(), ai-narrative). All now use `Intl.DateTimeFormat` with `America/New_York` or the `toLocaleString` re-parse trick. **Always use ET when bucketing market data — markets are ET-anchored. Local time only OK for user-personal things like quiet hours.**
- **Pass 168-169 (race conditions)**: auto-trainer.js loaded model → async fetch loop → save; continuous-learner could ModelStore.load/train/save in between, then AT overwrote CL's gradient update. Fixed by splitting AT into Phase 1 (async fetches, no model touch) + Phase 2 (sync load/train/save). Also wired the cross-module `_historicalTrainerRunning` + `_autoTrainerRunning` flags so CL defers its save during long-running trainers.

---

## Conventions Claude Code should keep

1. **No build step.** Static HTML. Don't introduce webpack/vite/etc.
2. **No frameworks.** Vanilla JS + Chart.js CDN only.
3. **No emojis in code comments or commit messages.** Brandon is fine with emojis in UI but not in code.
4. **Pages are flat at the root.** Don't move them into a `pages/` directory — every internal href would break.
5. **Always `node --check` JS files after editing.**
6. **Always add new pages to BOTH `app.js`'s buildNav() (for the active state) AND the brainGrp/playsGrp/etc array** (also in `app.js`), AND `sitemap.xml`.
7. **Modules export via `window.X = X` at the bottom** — top-level `const X = ...` does NOT auto-attach (pass 76b).
8. **Storage keys all start with `bpleone_`** and end with `_v1` (or `_v2` after schema changes).
9. **Black-Scholes is in `live.js`**, not a separate file — don't refactor.
10. **Match existing nav grouping logic.** Brain/training stuff → `brainGrp`. New tool → `toolsGrp`. New scanner → `scanGrp`. The `activePage` string passed to `buildNav()` MUST match the bare filename (without `.html`) for the active-state highlight to light up.

---

## What's still mocked (until user wires a provider)

- News headlines, Congressional/insider transactions, Earnings dates (we have a static pattern table in `earnings-awareness.js`), Option chain prices, Dark pool prints
- Mock-to-real swap is now zero-code via `settings.html`

---

## Audit script

```bash
# Lint everything
for f in js/*.js; do node --check "$f"; done
# Quick state check
python3 -m http.server 8080  # browse to localhost:8080
```

For broader scans (broken hrefs, inline-JS parse, sitemap coverage), see the inline Python at the bottom of recent conversation transcripts — but the live audit page at `/audit-log.html` is the canonical record.

---

## How Brandon thinks about this product

This is the **second of multiple "desks"** Brandon is building on `bpleone.com`. Pokémon TCG desk (`pokemon.bpleone.com`) shipped first. This one is the equity / options / TA desk. Future desks planned: Sports Cards, Sports Betting / DFS, Sports Hub.

He wants this to feel like **Unusual Whales meets Goldman/MS terminal**. Institutional-grade UX, retail-friendly explanations underneath. He cares about:

- **Speed** (no build step, instant page loads)
- **Depth** (a real trader should find everything they'd want)
- **Self-learning** — the brain genuinely improves over time from real outcomes (this is what continuous-learner + auto-trainer + bootstrap + all the calibrators do)
- **Honest metrics** — passes 67-68 corrected the annualized-Sharpe over-report; passes 60+76 fixed silent failures in kNN and drift; Brandon wants the numbers to be trustworthy
- **Daily actionability** — Trade of the Day, Plays of the Day, Conviction Stack, Brain Bet (the "one trade now or nothing" page)
- **Making money** — the product is the foundation; pricing is on `about.html`

He's based in Southern California, late 20s, finance background (equity research / IB style). He uses Squarespace for the hub site and is comfortable with terminal but prefers click-by-click guides.

---

## Pick-up: typical next requests

In rough order of probability when Brandon comes back:

1. **"Keep building"** / **"Keep auditing"** — find next thing in audit-log to fix or extend; bias toward shipping. Reasonable defaults: more audit passes, more training-velocity features, more diagnostic surfaces.
2. **"Train the model"** — point at `/train-now.html` (one-click full pipeline) or expand training (deeper history, more symbols, lower cooldowns).
3. **"Fix [page X]"** — most "broken" pages turn out to be: missing direct `<script src>` (lazy-load race), or a case-mismatch like pass 53/76, or a misnamed window export like pass 76b.
4. **"What's on the hub?"** — check that `bpleone.com` is showing the LIVE tile (paths in SQUARESPACE-FIX.md).
5. **"Add real data"** — point to `settings.html` data-provider toggle.

Brandon's a fast-mover with strong taste — bias toward shipping over discussion.

— Updated by Claude through audit pass 267. (The brain-architecture sections above are layered: the pass-216 block tells the "we found edge" discovery story; the pass-267 block is the honest correction — no proven TA timing edge, it's drift not skill. Read the pass-267 block as current truth.)
