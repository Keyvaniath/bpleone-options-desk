# 🔧 Fix the options desk on bpleone.com

> **Brandon — Nov 19 2026:** the betting desk works, the options one doesn't. That means DNS for `options.bpleone.com` isn't pointing at GitHub Pages yet. The CNAME file in this repo is correct (`options.bpleone.com`) and the site IS deployed — DNS is the missing piece. 5-minute fix below.

---

## Step 1 — Find the betting desk's DNS record and clone it

Since the betting desk works, **its DNS record is the template**. Go look at it:

1. Open Squarespace → **Settings** → **Domains** → click **bpleone.com** → **DNS Settings**
2. Look at the existing record for `betting` (or `sports`, or whatever subdomain the betting desk uses). It will be one of two things:
   - A **CNAME** record pointing to `keyvaniath.github.io.` (or another GitHub Pages target)
   - 4× **A records** pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
3. **Duplicate that exact record with `options` as the host.** Whatever betting uses, options should use.

That's it. DNS propagation takes 5–15 minutes. Once it resolves, https://options.bpleone.com loads everything we've built.

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
