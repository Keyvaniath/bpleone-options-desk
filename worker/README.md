# bpleone Brain Worker — 24/7 server-side brain

Cloudflare Worker that runs the brain logic continuously, independent of any open browser tab.
Replaces the "tab-must-be-open" client-side architecture.

## Why

- Browser brain only runs while a tab is open → if Brandon closes Chrome, brain stops
- Stooq historical data is CORS-blocked from browsers → can't pre-train
- Finnhub free tier's `/quote` works in browser but `/stock/candle` doesn't (from browser)
- **A server-side worker has no CORS restrictions and runs on a schedule**

## What it does

- **Cron**: every minute, fetches all 47 symbols from Finnhub, runs capture + resolve + train, persists state in Cloudflare KV
- **HTTP endpoints**: browser pages call `/brain/state` to display brain state — no local computation needed
- **Bootstrap**: `/brain/bootstrap` (POST, auth-required) pulls 250 days of Finnhub candles and pre-trains the model

## Cost

Free tier covers everything:
- 100k requests/day (cron uses 1440/day, browser reads add maybe 5k/day → far below cap)
- 1 GB KV storage (journal + model = ~5 MB)
- 10ms CPU per request (a tick takes ~50ms but counts as multiple requests — still under quota)

If you exceed free tier (you won't), it's $5/mo for the paid plan with 10M req/day.

## Setup (10 minutes, one-time)

```bash
# 1. Install wrangler (Cloudflare's CLI)
npm install -g wrangler

# 2. Login (opens a browser to authorize)
wrangler login

# 3. From the worker/ directory, create a KV namespace
cd worker
wrangler kv:namespace create BRAIN_KV
# Output looks like:
#   id = "abc123def456..."
# Copy that id and paste it into wrangler.toml's [[kv_namespaces]] section,
# replacing REPLACE_WITH_KV_ID_FROM_WRANGLER_OUTPUT.

# 4. Store secrets (DO NOT commit these to git)
wrangler secret put FINNHUB_API_KEY
# (paste your Finnhub key when prompted)

wrangler secret put ADMIN_TOKEN
# (make up a random long string — used for /brain/bootstrap auth)

# 5. Deploy
wrangler deploy
# Output gives you a URL like:
#   https://bpleone-brain-worker.YOUR-SUBDOMAIN.workers.dev

# 6. Verify (replace URL with yours)
curl https://bpleone-brain-worker.YOUR-SUBDOMAIN.workers.dev/brain/health
# After ~1 minute (first cron fires), should return { ok: true, lastTickAgo: <60, healthy: true }
```

## Trigger initial bootstrap (one-time, after deploy)

```bash
curl -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  https://bpleone-brain-worker.YOUR-SUBDOMAIN.workers.dev/brain/bootstrap
```

Returns `{ ok: true, symbolsFetched: 47, trainingExamples: ~11000, ... }` after ~30 seconds.

The brain now has 250 days of pre-trained weights AND will continue learning every minute, forever.

## Wire up the browser

In `js/data-provider.js` (browser), set the worker URL and switch read source:

```js
// js/worker-bridge.js (new module — see PR for exact code)
window.WorkerBridge = {
  url: 'https://bpleone-brain-worker.YOUR-SUBDOMAIN.workers.dev',
  async fetchState() {
    const r = await fetch(this.url + '/brain/state');
    return r.ok ? r.json() : null;
  }
};
```

Pages that want the worker's brain state instead of local computation call `WorkerBridge.fetchState()`
on load and render from that data. The local brain still runs in parallel as a fallback (so the page
works offline).

## Monitor

- `/brain/health` — readiness probe. Use UptimeRobot or BetterStack to monitor it.
- `wrangler tail` — live log stream from the worker.
- `wrangler kv:key list --binding BRAIN_KV` — inspect KV.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/brain/health` | none | Last tick timestamp + healthy bool |
| GET | `/brain/state` | none | Full snapshot (journal[500], model, lastTick) |
| GET | `/brain/journal?n=200` | none | Last N journal entries |
| GET | `/brain/model` | none | Current model weights + n_trained |
| POST | `/brain/bootstrap` | Bearer | Trigger 250-day historical bootstrap |
| POST | `/brain/tick` | Bearer | Manually trigger one tick (cron does this automatically) |

## Limitations

- The server-side model uses a **subset** of features (5 of 22). The browser still computes the rich
  feature vector locally and can `POST /brain/inject` if you want server-side training on those.
- Capture cooldown is 5 min per symbol (less aggressive than browser).
- This worker is the simple version. Adding bootstrap-ensemble, MultiHorizon, calibrators, etc. is
  next once you confirm this version is running.

## What this replaces

After deploying this:
- The browser's `continuous-learner.js` becomes redundant for the data-collection role
- `historical-bootstrap.html` becomes "trigger server bootstrap" instead of failed Stooq fetches
- The "Brain is HEALTHY 100/100" footer becomes meaningful (server reports real n_trained)
- Brandon can close Chrome — brain keeps running
