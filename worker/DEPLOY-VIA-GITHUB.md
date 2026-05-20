# Zero-CLI Deploy via GitHub Actions

This bypasses the wrangler CLI entirely. You add 4 secrets in GitHub once,
and GitHub Actions deploys the worker for you.

## What you need before starting

1. A Cloudflare account (free): https://dash.cloudflare.com/sign-up
2. Your Finnhub API key (same one in `options.bpleone.com/settings.html`)

## Step-by-step (10 minutes total, all in browser, no terminal)

### STEP 1 — Get your Cloudflare Account ID (1 min)

1. Go to https://dash.cloudflare.com/
2. Click any domain in your account (or "Workers & Pages" in left sidebar)
3. On the right side, find **"Account ID"** — it's a 32-character hex string
4. Click the copy button next to it. Save this somewhere — you'll paste it in Step 3.

### STEP 2 — Create a Cloudflare API Token (2 min)

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **"Create Token"**
3. Find the template "Edit Cloudflare Workers" → click **"Use template"**
4. Under "Account Resources": **Include → All accounts** (or pick your account)
5. Under "Zone Resources": **Include → All zones** (or leave default)
6. Click **"Continue to summary"** → **"Create Token"**
7. **COPY THE TOKEN** that appears (long string starting with various chars). You won't see it again. Save it.

### STEP 3 — Add 4 secrets to your GitHub repo (3 min)

1. Go to https://github.com/Keyvaniath/bpleone-options-desk/settings/secrets/actions
2. Click **"New repository secret"** four times, adding these one-by-one:

| Name | Value |
|------|-------|
| `CLOUDFLARE_API_TOKEN` | (the token you copied in Step 2) |
| `CLOUDFLARE_ACCOUNT_ID` | (the account id you copied in Step 1) |
| `FINNHUB_API_KEY` | (your Finnhub key from settings.html) |
| `ADMIN_TOKEN` | (make up any 30+ character random string — only used by you for the bootstrap call) |

### STEP 4 — Trigger the deploy (30 seconds)

1. Go to https://github.com/Keyvaniath/bpleone-options-desk/actions/workflows/deploy-worker.yml
2. Click **"Run workflow"** (right side, dropdown) → leave branch as `main` → click green **"Run workflow"** button
3. Wait ~2 minutes. The workflow:
   - Creates a KV namespace (first run only, then commits the id)
   - Uploads your FINNHUB_API_KEY and ADMIN_TOKEN as worker secrets
   - Deploys the worker code
   - Cron starts ticking every minute automatically

4. When the workflow shows the green ✓, click into the "Deploy worker" step and find a line like:
   ```
   ✨ Deployed bpleone-brain-worker
      https://bpleone-brain-worker.YOUR-SUBDOMAIN.workers.dev
   ```
   **Copy that URL.** That's your worker.

### STEP 5 — Verify it's alive (30 seconds)

In your browser, open:
```
https://bpleone-brain-worker.YOUR-SUBDOMAIN.workers.dev/brain/health
```

After ~60 seconds (waiting for the first cron tick), you should see:
```json
{"ok": true, "lastTickAgo": 30, "healthy": true, ...}
```

If `lastTickAgo: null`, wait another minute and refresh. The cron needs one tick to fire.

### STEP 6 — Bootstrap with 250 days of historical data (1 min)

1. Go to https://github.com/Keyvaniath/bpleone-options-desk/actions/workflows/bootstrap-brain.yml
2. Click **"Run workflow"** → paste your worker URL into the input box → click green button
3. Wait ~30 seconds. The workflow makes a POST to `/brain/bootstrap` and pre-trains the brain on 250 days of Finnhub candles.

When done, the workflow's output shows something like:
```
"symbolsFetched": 47, "trainingExamples": 10847
```

Your brain is now pre-trained AND will continue learning every minute, 24/7.

### STEP 7 — Connect your browser (10 seconds)

1. Open https://options.bpleone.com/worker-setup.html
2. Paste your worker URL into the input
3. Click **⚡ Connect**

Status panel updates:
- Connected: **YES**
- Last tick: **< 60s**
- Journal: thousands and growing
- Model n_trained: **10,000+**

Every brain page now reads the authoritative 24/7 state.

## Done

Brain runs 24/7 in Cloudflare's edge. Close Chrome, close laptop, leave for vacation — the brain keeps capturing, resolving, training every minute. Open any page when you're back and it shows the latest state.

## How to redeploy after code changes

Just push to `main`. The workflow auto-runs when anything in `worker/` changes.

## How to view worker logs

```
Cloudflare dashboard → Workers & Pages → bpleone-brain-worker → Logs
```

Or via CLI if you ever install wrangler: `wrangler tail`.
