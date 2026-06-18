# Paid-Data Roadmap — the path to a real edge

> Private decision memo for Brandon (underscore-prefixed, so Jekyll does NOT deploy it — keeps vendor/pricing off the public site). Written 2026-06-18. Prices change constantly; verify each on the vendor's own site before committing.

## Where we are (the honest baseline)

Free data is **tapped out for timing edge**. Across passes 217-267 + this session's Edge Lab, every free-data signal (TA features, analyst-revision momentum, price momentum, brain walk-forward) lands at **"mostly drift, not statistically significant."** The live track record is real and large (1,000+ resolved 5-day calls) but the skill *above the market's drift* (~+2.3pp) does not clear the 95% bar. That is the efficient market, and the desk says so out loud — which is the differentiator.

The strategic conclusion (already banked, do not re-litigate): **a real edge needs different data, not more free indicators.** This memo scopes that data.

Two distinct goals, often conflated:
1. **De-SAMPLE** — make the ~34 honestly-labeled placeholder pages (options flow/chain/GEX, dark pool, L2 tape, short-interest/squeeze) show REAL data. This is a *credibility/coverage* win, not necessarily an edge win.
2. **Hunt edge** — feed a genuinely new signal (order/option flow) into the brain and forward-test whether it beats drift. This is the *alpha* bet.

## What each feed unlocks (for THIS desk specifically)

| Feed | ~Cost (verify) | De-SAMPLEs | Edge potential | Notes |
|---|---|---|---|---|
| **Tradier** (brokerage data) | Free if you trade there | options-lab real premiums, vol-surface/term, options-chain | Low (raw quotes, no analytics) | Cheapest path to *real option prices* replacing the Black-Scholes estimates in options-lab. No flow/analytics. |
| **Polygon.io Options Starter** | ~$29/mo (15-min delayed) | Same as Tradier + greeks, full chains, 5yr history | Low-Med | REST + WebSocket, OPRA-licensed, per-contract greeks. 15-min delay is fine for swing horizon. Cleanest API. Real-time tier runs into the hundreds/mo. |
| **Unusual Whales** (+ public API) | ~$50/mo retail; API token extra | options-flow, dark-pool, unusual-activity, GEX pages | **Med-High** | This is the literal "Unusual Whales meets a terminal" vision. The API can feed real flow into the worker → a flow-based signal to forward-test. The most direct "different data that could carry edge." |
| **ThetaData** | Cheap historical options | (backtesting only) | n/a (validation tool) | Use to BACKTEST a flow/options signal on history BEFORE paying for a live feed. De-risks the spend. |
| **SqueezeMetrics (DIX/GEX)** | ~tens/mo | dark-pool index, gamma pages | Med (regime, not direction) | DIX (dark-pool buy pressure) + GEX (dealer gamma). Good for regime context; weaker as a standalone directional signal. |
| **SpotGamma** | Higher retail tier | GEX / gamma-flip pages | Med | Polished gamma/positioning. Overlaps SqueezeMetrics. |

## Recommended sequence (highest ROI first)

**Step 1 — cheapest credibility win ($0-29/mo): real option prices.**
Wire Tradier (free if you already trade there) or Polygon Options Starter ($29/mo). Point options-lab + the vol pages at it so premiums are REAL, not Black-Scholes estimates — removes the single biggest "it's only an estimate" caveat on the flagship tool. Pure coverage/credibility; no edge claim.

**Step 2 — the actual edge experiment ($50-100/mo): options flow.**
Subscribe to Unusual Whales' API. Ingest real flow into the worker, build a flow-based signal (e.g. repeated-sweep / large-premium-call confluence with the brain's lean), and **forward-test it through the existing Edge Lab / confluence machinery** — publish the null until it clears the drift bar, same honesty rule as everything else. This is the only line item with real alpha potential, and it's the one worth the money IF it earns its keep.

**De-risk Step 2 first (optional, cheap):** buy a month of ThetaData historical options and backtest the flow signal offline before committing to a live feed. If it doesn't beat drift on history, don't pay for the live feed.

**Skip for now:** real-time options (Polygon hundreds/mo) and dedicated order-flow/L2 — overkill for a 5-day swing horizon; the edge question is answered by flow + chains, not by tick-level real-time.

## Integration plan (fits the current architecture, low-risk)

- **Keys stay server-side in the Cloudflare worker** — exact same pattern as the Finnhub key (the browser never sees them). Add endpoints like `/brain/flow` and `/brain/options-chain`; the existing SAMPLE pages flip to real by pointing at them (they were built to "light up the moment a paid feed is wired" — pass 305).
- **Cost control is already built:** the worker is market-hours-gated + KV-cached (pass 209). A paid feed inherits that throttle, so you're not paying for off-hours calls.
- **The edge signal rides the existing rails:** Edge Lab (`_edge_lab.js` -> `data/edge-lab.json` -> page) and the confluence forward-test already grade signals vs drift and publish the verdict honestly. A flow signal becomes one more row there. No new honesty framework needed.
- **Nothing ships to users as "live" until it's real** — the honesty doctrine holds: a paid signal gets the same drift-bar gate before any green badge.

## The one-line answer for the MD

"Free data is tapped out — we proved it and we publish the null. The path to edge is options flow (Unusual Whales-class data, ~$50-100/mo), fed server-side into the same brain and forward-tested against drift before we ever claim it works. Real option prices (Tradier/Polygon, ~$0-29/mo) are a cheaper first step that makes the options tools fully live regardless."

---
Sources (verify current pricing on each): unusualwhales.com/pricing + /public-api, polygon.io/business-options, flashalpha.com options-data comparisons, thetadata, squeezemetrics. As of June 2026.
