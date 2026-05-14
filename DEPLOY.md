# Deploy to options.bpleone.com

The ZIP `bpleone-trading-deploy.zip` (in this folder) contains everything ready to go.
CNAME inside is already pointed at `options.bpleone.com` — matches your existing hub tile.

If you want a different subdomain, before deploying edit the file `CNAME` and change the single line to e.g. `trade.bpleone.com` or `ta.bpleone.com`.

---

## Path A — GitHub Pages (free, what most people use, what you likely used for Pokémon)

**One-time setup:**
1. Go to github.com → green **New** repo button → name it `bpleone-equity` → **Private** is fine → create.
2. On the new repo page, click **uploading an existing file** (the link in the empty-repo screen).
3. Unzip `bpleone-trading-deploy.zip` on your computer. Drag **the contents** of the `bpleone-trading-stage/` folder (NOT the folder itself) into the GitHub upload box. You should see `index.html`, `dashboard.html`, the `css/`, `js/`, `CNAME`, etc. at the top level.
4. Scroll down → write a commit message ("initial") → **Commit changes**.
5. Go to **Settings → Pages** (left sidebar). Under "Source" pick `Deploy from a branch`, branch = `main`, folder = `/ (root)`. Save.
6. GitHub will say "Your site is live at https://<your-username>.github.io/bpleone-equity/" — wait ~60 seconds for the first build.

**Point the subdomain (Squarespace DNS):**
7. Squarespace → **Settings → Domains → bpleone.com → DNS settings**.
8. Add a `CNAME` record:
    - Host: `equity`
    - Value: `<your-github-username>.github.io`
    - TTL: leave default
9. Back on GitHub → Settings → Pages → **Custom domain** field → enter `options.bpleone.com` → Save.
10. Wait 10–30 min for DNS to propagate. GitHub shows a green check when ready. Tick **Enforce HTTPS** once the cert is issued.

You're live at `https://options.bpleone.com`.

**For future updates:** edit files on GitHub directly (pencil icon), or `git pull`/`git push` from your computer. Site auto-rebuilds in ~30 seconds.

---

## Path B — Vercel (if Pokémon is on Vercel)

1. Go to vercel.com → **Add New → Project** → **Import** a GitHub repo (after doing GitHub upload steps 1-4 above).
2. Framework Preset: `Other`. Root directory: leave blank. **Deploy**.
3. After it deploys, **Settings → Domains** → add `options.bpleone.com`.
4. Vercel shows you a CNAME target (something like `cname.vercel-dns.com`). Add that as a CNAME in Squarespace DNS for host `equity`.
5. Vercel auto-provisions HTTPS. Done.

---

## Path C — Netlify (drag-drop, no GitHub needed)

1. netlify.com → **Sites** → drag the unzipped `bpleone-trading-stage/` folder onto the dashboard.
2. Site goes live at a random `*.netlify.app` URL.
3. **Domain settings → Add custom domain → options.bpleone.com**.
4. Netlify shows the CNAME target. Add it as CNAME in Squarespace DNS for host `equity`.
5. Enable HTTPS (one click).

---

## Path D — Squarespace embed (NOT recommended, but possible)

Squarespace is a poor host for an interactive single-page app like this — limited file uploads, no real custom routing, sluggish iframes. But if you must:

1. In Squarespace, edit the **Options Desk** page that the hub tile links to.
2. Add a **Code Block** → embed mode → paste:
   ```html
   <iframe src="https://options.bpleone.com" style="width:100%;height:100vh;border:0;display:block;"></iframe>
   ```
3. This requires the site to be hosted somewhere else first (Path A, B, or C above) — you'd be embedding rather than uploading.

If your goal is truly "no GitHub, all Squarespace," I'd recommend Path C (Netlify) since it's drag-drop and integrates cleanly with your existing Squarespace DNS.

---

## Updating the hub tile

After the desk is live, in your **bpleone.com** hub site (the page in the screenshot):
- Change tile state from "COMING SOON" to "LIVE" badge.
- Update tile description if you want — current placeholder reads "Bottom-up DCF + comps modeling…" but this desk is more TA / options / momentum. Suggested copy:

> **Options Desk**
> Institutional-grade options flow, TA scanner, momentum ranking, and a learn-adjusted Trade of the Day. Built on the workflow used at GS/MS — distilled for the retail trader. Now live.
>
> `options.bpleone.com →`

---

## What if I want a different subdomain name?

Before uploading:
1. Open the `CNAME` file in the unzipped folder.
2. Change its single line to e.g. `trade.bpleone.com` or `ta.bpleone.com`.
3. In Squarespace DNS, use that host (`trade` or `ta`) for the CNAME record.
4. In your hub (bpleone.com), update the tile's link to match.

That's it. The site itself doesn't hardcode the domain anywhere else.
