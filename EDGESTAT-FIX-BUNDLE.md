# EdgeStat — Fix Bundle (Bug A + Bug B)

Both fixes are drop-in. Save these files into your EdgeStat repo and redeploy
(Cloudflare Pages, GitHub Pages, wherever you host it).

## Bug A — Sports / Players / Tools dropdowns don't open

**Root cause:** `.mainnav` in `css/style.css` has `overflow-y: auto`. The
dropdown menus open with `position: absolute; top: 100%` — that places them
*below* `.mainnav`, which then clips them because of the overflow setting.
The dropdowns are opening every time you click — you just can't see them.

**Fix:** Replace the entire contents of `js/nav.js` with the file at
`C:\Users\Owner\bpleone-options-desk\edgestat-nav-fix.js`. That version
switches `.dd-menu` to `position: fixed` and anchors it to the button's
on-screen position via `getBoundingClientRect()`, so no parent overflow can
clip it.

Alternative one-liner (CSS only, easier to deploy): add this to `css/style.css`:
```css
.mainnav { overflow: visible !important; }
```

## Bug B — Dashboard shows POD 0-1 / -100% ROI, you expect 4-2

**Root cause:** The hero stats card reads `data/pod_pl.json`, which tracks
**Play-of-the-Day picks only** (1 pick, 0-1 record). Your actual all-source
record (lock_of_day 4-0 + pod 0-1 + top_25_board 0-1 = **4-2**) lives in
`data/all_picks_ledger.json`. The card is showing POD-only correctly — it's
just labeled and scoped narrower than you remember.

**Fix:** In `index.html`, find this block in the big inline `<script>` (around
the `setText` IIFE near the top of the dashboard logic):

```js
fetch("data/pod_pl.json", { cache: "no-cache" })
  .then(r => r.json())
  .then(d => {
    const wins = d.wins || 0;
    const losses = d.losses || 0;
    const settled = d.n_settled || 0;
    const net = d.net_units;
    const roi = d.roi_pct;
    const hr = d.hit_rate;
    const total = d.total_pods || 0;

    setText("hsNetUnits", net == null || settled === 0 ? "--" : (net >= 0 ? "+" : "") + net.toFixed(2));
    setText("hsHitRate", hr == null ? "--" : (hr * 100).toFixed(1));
    setText("hsROI", roi == null ? "--" : (roi >= 0 ? "+" : "") + roi.toFixed(1));
    setText("hsClosed", String(settled));

    const labels = document.querySelectorAll(".hero-stats .stat-label");
    if (labels[0]) labels[0].textContent = "POD Net Units (1u flat)";
    if (labels[1]) labels[1].textContent = "POD Hit Rate";
    if (labels[2]) labels[2].textContent = "POD ROI %";
    if (labels[3]) labels[3].textContent = "PODs Settled";
    // ... podProgress note below ...
```

**Replace with:**

```js
fetch("data/all_picks_ledger.json", { cache: "no-cache" })
  .then(r => r.json())
  .then(d => {
    const wins = d.wins || 0;
    const losses = d.losses || 0;
    const settled = d.n_settled || 0;
    const net = d.net_units;
    const roi = d.roi_pct;
    const hr = d.hit_rate;
    const total = d.total_picks || 0;

    setText("hsNetUnits", net == null || settled === 0 ? "--" : (net >= 0 ? "+" : "") + net.toFixed(2));
    setText("hsHitRate", hr == null ? "--" : (hr * 100).toFixed(1));
    setText("hsROI", roi == null ? "--" : (roi >= 0 ? "+" : "") + roi.toFixed(1));
    setText("hsClosed", String(settled));

    const labels = document.querySelectorAll(".hero-stats .stat-label");
    if (labels[0]) labels[0].textContent = "Net Units (1u flat, all picks)";
    if (labels[1]) labels[1].textContent = "Hit Rate";
    if (labels[2]) labels[2].textContent = "ROI %";
    if (labels[3]) labels[3].textContent = "Picks Settled";
```

And in the `podProgress` note, change the small-sample copy from POD-specific to
all-picks copy:

```js
} else if (settled > 0 && settled < 30) {
  note.innerHTML = `* All-picks track record: <strong>${wins}-${losses}</strong> in ${settled} settled (lock_of_day, POD, top_25, ...). ${d.n_pending || 0} pending. Per-source breakdown on <a href="accuracy.html" style="color:#d4a04a; text-decoration: underline;">Accuracy &rarr;</a>.`;
}
```

After this fix the hero stats will read **4 - 2 / +0.18u / 66.7% / 4 settled**
(from `all_picks_ledger.json`'s current contents — verified live).

The POD-only widget remains the source of truth on `pod-history.html` and
`play-of-day.html`.

## Bug C — Live Pulse shows "0 games tracked"

This one isn't in this bundle yet — it's a Cloudflare Worker issue. Your
`EDGESTAT_WORKER_URL = "https://edgestat-live.brandonpleone.workers.dev"`
worker isn't pushing line-move snapshots into KV. Either:
1. The worker scheduled trigger isn't firing, or
2. The KV namespace bound to that worker is empty / different than expected,
   or
3. The Pulse page is reading the wrong KV key.

Confirming this requires the worker's source. Once you point me at it (same
repo as the betting site? a different one?), I can audit it the same way I
did `bpleone-brain-worker`.

## Deploy steps

Pick whichever applies to your setup:

**If EdgeStat is on Cloudflare Pages (git-connected):**
1. Find the repo locally (or use GitHub web editor)
2. Replace `js/nav.js` with the fix file
3. Patch the inline script in `index.html` per Bug B
4. Commit + push — Pages auto-deploys

**If EdgeStat is on Cloudflare Pages (manual upload):**
1. Download the current site
2. Apply both fixes locally
3. Drag the folder into the Cloudflare Pages dashboard

**Hard refresh the live site after deploy:** Ctrl + Shift + R to bust caches.

## Files in this bundle

- `edgestat-nav-fix.js` — drop-in replacement for `js/nav.js` (Bug A robust fix)
- `EDGESTAT-FIX-BUNDLE.md` — this document
