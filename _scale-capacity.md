# Scale & capacity plan — bpleone / trade desk (pass-300)

> Private ops reference (underscore = not deployed). Answers "can this serve thousands of
> concurrent clients, and what does it cost." Grounded in a real load test 2026-07-08.

## Measured (live load test, single test client → the worker)
- 1,000 requests across the 7 hot polled endpoints, concurrency 100.
- **588 req/s sustained, 99.8% success (998×200, 2×429), p50 82ms / p95 616ms / p99 871ms.**
- The 2×429 confirms the per-IP limiter fires under *concentrated* load (keep-alive → same isolate). Cloudflare Workers itself scales horizontally across isolates/colos to millions of req/s — 588 was my client's ceiling, not the worker's.

## Request rate per client (after pass-296 client hardening)
Every open tab is **visibility-gated** (hidden tabs send 0) and polls on a **jittered 30–45s** cadence.
- `worker-quotes.js` per visible client: 1 `/brain/signals` + ~2 `/brain/quotes` chunks per ~37.5s ≈ **~0.08 req/s**.
- `worker-bridge` (if connected): 1 `/brain/state` / 60s ≈ 0.017 req/s. Page-load bursts (metrics/confluence/picks) amortize low.
- **Steady state ≈ 0.08–0.10 req/s per *visible* client.**

| Concurrently-visible clients | Steady req/s to worker | vs measured 588 req/s |
|---|---|---|
| 1,000 | ~80–100 | ~15% |
| 10,000 | ~800–1,000 | ~1.5× (Workers auto-scales past it) |

Cost scales with **attention**, not open tabs — the whole point of the pass-296 visibility gate + jitter.

## The one real constraint: Cloudflare KV budget → **Workers Paid ($5/mo) is required at scale**
Per-colo read caching (`cacheTtl` 30–60s, pass 296–299) makes each hot key read from KV **~once per cache-window per colo, independent of client count**. So KV load is bounded by colos×keys, not clients.
- **KV reads:** ~10–30 active colos × ~8 hot keys × (1 read / 30–60s) ≈ **230k–690k reads/day**. Free tier = 100k/day (exceeded at scale). **Workers Paid = 10M reads/day included** → 15–40× headroom.
- **KV writes:** the cron alone writes ~model/journal/signals every market-minute ≈ **~1–1.5k writes/day** — already at/over the free-tier 1k/day. Plus sampled analytics (1-in-5, single key) + register (capped 20/IP/day). **Workers Paid = 1M writes/day included** → enormous headroom.

**→ Action (Brandon): confirm the worker is on the Cloudflare Workers _Paid_ plan ($5/mo).** The design already needs it for the cron's own writes; it also unlocks the read volume + unmetered requests for thousands of clients. This is the single infra prerequisite. Everything else is code, and it's done.

## Abuse / DDoS posture (layered)
1. **Cloudflare network-layer (L3/4) DDoS protection is automatic + free on ALL plans, incl. workers.dev** — volumetric floods are absorbed at the edge before reaching the worker. This is the primary botnet defense and requires no action.
2. **In-worker per-IP limiter** (pass-297/299, 120 req/10s/IP/isolate) — throttles a single-source hammer; best-effort per-isolate.
3. **Global per-IP signup cap** (pass-300, KV counter, 20/IP/day) — hard-bounds `user:*` key creation across all isolates.
4. **Analytics writes sampled 1-in-5**, admin routes constant-time-token gated, auth PBKDF2-100k.
5. **Optional belt-and-suspenders:** a Cloudflare **rate-limiting rule** (dashboard, paid add-on) gives a hard *global* app-layer limit no worker code can match. Not required for launch given (1)–(4); enable if app-layer abuse is ever observed.

## Data layer
There is **no separate database** — all state is Cloudflare KV (eventually-consistent, edge-replicated, effectively infinite read scale via the cache layer). No DB to shard/scale. Static pages (415 HTML) are served by GitHub Pages behind its CDN — infinite static scale, independent of the worker.

## Bottom line
Defects fixed + verified (pass-300); load-tested at 588 req/s / 99.8% from one client with the herd-suppression + rate-limiting working; architecture scales sub-linearly with cost. **The only scale prerequisite is the $5/mo Workers Paid plan.** Ready for thousands of concurrent clients.
