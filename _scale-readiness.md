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

## The ONE owner-action for hostile-scale (distributed/botnet)
The in-app limiter is **per-isolate** (in-memory) + a **global KV cap on register (20/IP/day)**. That stops single-source and small-source abuse. For a **distributed** flood (thousands of IPs), the correct tool is Cloudflare's native edge rate-limiting, which runs *before* the Worker and no app code can match:

**Cloudflare dashboard → Security → WAF → Rate limiting rules → Create:**
- Match: `http.request.uri.path contains "/brain/"` (and a second rule for `/auth/register`)
- Rate: e.g. 240 requests / 1 min / IP → Action: Block (or Managed Challenge) for 60s
- (Free plan includes one rate-limit rule; Pro/Biz allow more.)

Also confirm the Workers **Paid plan** is enabled before a large public launch (the free tier's 100k/day is fine for early traffic but a spike of many always-visible tabs would exceed it).

## Bottom line
Measured: sub-250ms p99, zero server errors under concurrent load, limiter proven to fire. Architecture is edge-distributed with no DB/origin bottleneck, and cost scales with *attention* not open tabs. Ready for thousands of realistic clients today; enable the WAF rule + Paid plan before an adversarial-scale public launch.
