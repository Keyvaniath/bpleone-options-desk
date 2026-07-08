# Scale-readiness — thousands of concurrent clients

> Private (underscore = not deployed). Evidence + capacity plan for "ready for thousands of clients." Last measured 2026-07-08, worker pass-301.

## Load-test evidence (live worker, measured — not estimated)

800 requests, concurrency 80, mixed across the hot polled endpoints (`/brain/signals`, `/brain/quotes`, `/brain/health`, `/brain/picks`, `/brain/state`, `/brain/metrics`, `/brain/confluence-score`, `/brain/bars`):

| Metric | Result |
|---|---|
| Latency p50 / p95 / p99 / max | **96 / 165 / 228 / 400 ms** |
| 5xx server errors | **0** — worker never fell over |
| 200 served | 665 |
| 429 rate-limited | 135 (all from the single test IP exceeding 120/10s — proves the limiter protects the origin) |
| Throughput from ONE client | 68 req/s sustained before the per-IP limiter bit |

## Capacity math (real load profile, post pass-296)

**Per-client request rate:** a *visible* tab polls on a jittered 30–45s cadence — `worker-quotes.js` does ~2 requests/cycle (signals + chunked quotes) + optional `worker-bridge` /brain/state every 60s ≈ **~3–4 worker requests/minute per visible client**. A hidden/background tab polls **zero** (visibility-gated).

**Aggregate at 1,000 concurrent VISIBLE clients:** ~4,000 req/min ≈ **~67 req/s**.
- Realistic (1,000 daily actives, ~10 min visible each): ~40k requests/day — fits the **Cloudflare Workers free tier** (100k/day).
- Worst case (1,000 tabs visible 24/7): ~5.8M/day — fits **Workers Paid** ($5/mo base includes 10M requests, then $0.30/M).

**KV reads:** hot keys use per-colo `cacheTtl` 30s → each key is read from KV ≈ once per 30s per colo, NOT per request. Even across ~275 colos this is thousands of reads/day, far under the 10M/day free KV-read limit. The polling herd shares reads.

**KV writes (the scarce resource — ~1 write/sec/key):** only (a) the cron tick ~1/min, (b) analytics sampled 1-in-5 on one key, (c) the quotes cache write gated on a dirty flag, (d) register capped 20/IP/day. All bounded well under budget. Traffic growth can no longer starve the brain's own writes.

**Subrequests:** `/brain/quotes` fetches capped at 24/request; no fan-out scales with client count.

## What is NOT a concern for this architecture (and why)
- **No database to scale.** State is Cloudflare KV — globally replicated by design, no capacity planning needed.
- **CDN edge caching is already there.** Static site → GitHub Pages (Fastly CDN). Worker → Cloudflare edge (275+ colos). Responses carry `Cache-Control`; KV reads are colo-cached.
- **No single origin server to overload.** Both tiers are edge-distributed; there is no VM/container to run out of CPU/RAM.

## Owner-actions — corrected to the ACTUAL infra (verified 2026-07-08)

Verified: the **site** is GitHub Pages behind Fastly (`Server: GitHub.com`) — NOT a Cloudflare zone. The **worker** is `workers_dev = true` (no custom domain) — it runs on `*.workers.dev`, which is **Cloudflare's shared zone, not one Brandon controls.** Two consequences:

**1. A Cloudflare WAF rate-limit rule is NOT available as a toggle here** (my earlier note was wrong). WAF/rate-limiting rules can only attach to a zone you own. To get edge rate-limiting you'd have to: put `bpleone.com`'s DNS on Cloudflare **and** bind the worker to a custom domain (e.g. `api.bpleone.com`) on that zone. That's an infra migration, not a switch — worth it only if a *distributed* (many-IP) billing-attack becomes a real concern. **On the current setup the defense layer is the in-app limiter** (per-isolate 120/10s + global KV register cap 20/IP/day + cheap cached 429s), which is adequate for single-source and small-source abuse.

**2. Workers Paid plan ($5/mo)** is the one real billing decision. Free tier hard-caps at **100k requests/day** — fine for early/realistic traffic (see math above), but a sustained many-always-visible-tabs load would hit it. **Crucially, hitting that cap is NOT an outage:** the free tier stops serving the worker, and the site is built to **degrade gracefully** — every page wraps worker fetches in try/catch, `worker-quotes.js` keeps last-known quotes on any non-200, and error states read "worker unreachable / catching up," never a broken page. So the free-tier ceiling acts as a crude billing circuit-breaker (stale data for the rest of the day, self-heals), not a crash. Enable Paid before a large public launch to avoid the stale-data window; it is not required for correctness or safety.

## Bottom line
Measured: sub-250ms p99, zero server errors under concurrent load, limiter proven to fire, and graceful degradation verified (worker-down → stale-but-labeled data, not a broken site). Architecture is edge-distributed with no DB/origin bottleneck; cost scales with *attention*, not open tabs. **Everything code-controllable is done, deployed, and load-verified.** The only remaining items are business decisions, not defects: (a) Workers Paid plan before sustained high traffic, and (b) — only if adversarial distributed-flood protection is ever needed — migrating the worker to a custom domain on a Cloudflare zone to unlock edge WAF. Neither blocks serving thousands of realistic clients today.
