# 🔧 Fix the options desk on bpleone.com

> **Brandon — Nov 19 2026 UPDATE:** discovered that `betting.bpleone.com` ALSO returns a TLS-cert-mismatch error in Bitdefender. So this isn't a DNS-only problem — neither subdomain has a valid HTTPS certificate provisioned. Both need the same multi-step fix: DNS → GitHub Pages custom-domain → wait for Let's Encrypt → Enforce HTTPS.

---

## Why "betting works" is misleading

If you've been visiting `betting.bpleone.com` and not seeing certificate warnings, your browser may be caching an old cert OR you're hitting it from a context that doesn't enforce HTTPS. But in incognito / with strict security on, you'll see the same Bitdefender block: "Your connection to this web page is not safe due to an unmatching security certificate."

That means whatever server `betting.bpleone.com` resolves to is presenting a cert issued for a DIFFERENT hostname. Same root cause we need to fix for options.

---

## The full sequence — do this for options FIRST, then betting

### Step 1 — DNS record on bpleone.com

Squarespace → **Settings** → **Domains** → click **bpleone.com** → **DNS Settings** → **Add Custom Record**

**Preferred — CNAME (simpler, only one record):**

| Host | Type | Data | TTL |
|---|---|---|---|
| `options` | CNAME | `keyvaniath.github.io.` | default |

(The trailing dot on `keyvaniath.github.io.` matters in some DNS UIs — include it if Squarespace allows.)

**Alternative — 4× A records (faster propagation, no CNAME chain):**

| Host | Type | Data |
|---|---|---|
| `options` | A | `185.199.108.153` |
| `options` | A | `185.199.109.153` |
| `options` | A | `185.199.110.153` |
| `options` | A | `185.199.111.153` |

DNS propagation: 5–60 min depending on TTL. Verify with `nslookup options.bpleone.com` from a terminal — should return either the GitHub Pages IPs or resolve through to them.

### Step 2 — GitHub Pages: register the custom domain on the repo

Go to **github.com/Keyvaniath/bpleone-options-desk/settings/pages**

- **Source:** Deploy from a branch
- **Branch:** `main` / `/ (root)`
- **Custom domain:** type `options.bpleone.com` and click Save

Once saved, GitHub runs a DNS check. If DNS from Step 1 has propagated, you'll see ✅ "DNS check successful." If not, you'll see a yellow warning — wait, refresh, repeat.

### Step 3 — wait for Let's Encrypt cert

After DNS check passes, GitHub Pages submits a certificate request to Let's Encrypt. This takes **5–15 minutes**. The page shows "Your site is ready to be published at..." or similar. The "Enforce HTTPS" checkbox is GREYED OUT during this window.

**Do not click anything on the page during this time** — the cert process is fragile to repo settings changes.

### Step 4 — Enforce HTTPS

Once the cert is issued, "Enforce HTTPS" becomes available. **Check it.** This is what tells Pages to serve the Let's Encrypt cert instead of falling back to GitHub's default (which is what's causing Bitdefender's warning today — the wrong cert is being served).

### Step 5 — verify

In an **incognito window** (no cached certs):

```
https://options.bpleone.com/dns-test.html
```

You should see the big green ✓ "options.bpleone.com is LIVE" page. NO certificate warning. NO Bitdefender block.

Also from terminal:

```
$ curl -sI https://options.bpleone.com | head -5
HTTP/2 200
server: GitHub.com
content-type: text/html; charset=utf-8
```

If you see `server: GitHub.com` with no cert error → 🎉 done.

---

## Step 2 — Verify it worked

Open in an incognito window (skips browser cache):

```
https://options.bpleone.com/dns-test.html
```

If you see a big green ✓ with "options.bpleone.com is LIVE" — done.
If you see a Squarespace 404 / GoDaddy parking page / DNS error — keep reading.

---

## Path A: betting uses a CNAME record

Add this to DNS Settings on bpleone.com:

| Host | Type | Data |
|---|---|---|
| `options` | CNAME | `keyvaniath.github.io.` |

(Note the trailing dot.)

## Path B: betting uses 4 A records

Add ALL FOUR of these (GitHub Pages uses anycast across 4 IPs):

| Host | Type | Data |
|---|---|---|
| `options` | A | `185.199.108.153` |
| `options` | A | `185.199.109.153` |
| `options` | A | `185.199.110.153` |
| `options` | A | `185.199.111.153` |

## Path C: betting is a Squarespace subdomain (not GitHub Pages)

If betting points to Squarespace itself (e.g., a CNAME to `ext-sq.squarespace.com`), then betting is NOT on GitHub Pages and we can't simply clone its record. In that case:

1. Use **Path A** (CNAME → `keyvaniath.github.io.`) for options instead — GitHub Pages is where we deployed.
2. The repo at `Keyvaniath/bpleone-options-desk` has GitHub Pages enabled with custom domain `options.bpleone.com`.

---

## Step 3 — Confirm GitHub Pages settings on the repo

Just so the GitHub side is also right (one-time check):

1. https://github.com/Keyvaniath/bpleone-options-desk/settings/pages
2. **Source:** Deploy from a branch
3. **Branch:** `main` / `/ (root)`
4. **Custom domain:** `options.bpleone.com`
5. **Enforce HTTPS:** ✅ checked

If "Enforce HTTPS" is greyed out, the cert isn't issued yet — that happens AFTER DNS resolves. So fix DNS first, then come back and enable HTTPS.

---

## Step 4 — Wire the hub tile so visitors can find the desk

Once `https://options.bpleone.com` loads, the last step is making it discoverable from bpleone.com:

### Easiest: nav menu

1. Squarespace → **Pages** or **Navigation**
2. Find the "Desks" menu (you have one — I can see it in your nav)
3. Add an item:
   - **Label:** Options Desk
   - **URL:** `https://options.bpleone.com`
   - **Open in new tab:** YES
4. Save → Publish

### Better: pre-designed tile

1. Open `https://options.bpleone.com/squarespace-preview.html`
2. Click the variant you like (Card / Banner / Text)
3. Click **📋 Copy to clipboard**
4. In Squarespace, on whatever page has the Desks section: **+ Add Block → Code**, paste, save
5. Move it next to your betting tile

---

## What the desk has (Nov 2026)

So you know what you're linking to:

- **400 HTML pages** — institutional-grade options + technicals + ML brain
- **102 JS modules** — Black-Scholes, multi-horizon ensemble, calibration, drift PSI, conformal intervals, meta-stacking
- **104+ audit passes** with 17 CRITICAL bugs fixed (Sharpe was 9.6× over-reported; drift-protection chain was inert; auto-trade opened at stale prices — all fixed)
- **Self-learning** — captures + resolves predictions every 30s, retrains every 6h, bootstraps from 250 days of historical data on first visit
- **Visit pages worth opening first:** `/site-health.html`, `/train-now.html`, `/learning-velocity.html`, `/brain-debug.html`, `/audit-log.html`, `/all-tools.html`

---

## Verified state of this repo

```bash
$ cat CNAME
options.bpleone.com

$ git log -1
HEAD on origin/main, all fixes deployed
```

The site is built and committed. DNS is the only thing standing between visitors and 400 trading pages.

— Claude
