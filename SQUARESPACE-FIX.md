# 🔧 Fix the bpleone.com dashboard tile

> **⚡ FAST PATH:** open **`/squarespace-preview.html`** in your browser, click "Copy to clipboard," and paste into a Squarespace **Code Block** on the bpleone.com hub. That's the whole job. The page below explains every option in detail if you'd rather edit an existing tile manually.

## Status check first

The trading desk **IS live** — go test it yourself:
- https://options.bpleone.com ✓ returns 200 OK · hub-back ribbon on landing
- https://options.bpleone.com/morning-brief.html ✓ daily brief
- https://options.bpleone.com/conviction-stack.html ✓ brain setups
- https://options.bpleone.com/all-tools.html ✓ visual catalog of 397+ pages
- https://options.bpleone.com/brain-truth.html ✓ live status of every self-learning module
- https://options.bpleone.com/train-now.html ✓ **one-click full training pipeline** (NEW)
- https://options.bpleone.com/learning-velocity.html ✓ is the brain getting smarter? (NEW)
- https://options.bpleone.com/brain-debug.html ✓ ops console (NEW)

**If those URLs all work** → the only thing broken is the dashboard tile on your Squarespace hub site. Use Path 4 below (preferred — drops a full-design tile).
**If those URLs don't work** → DNS issue on the subdomain (rare, since cert is approved); see "Nuclear option" below.

---

## Fix the tile on Squarespace (5 minutes)

### Path 1: It's a `Button` block in a hub layout

1. Log into Squarespace → open `bpleone.com` editor
2. Navigate to the page that has the dashboard tile (probably home or "Desks")
3. Click on the **Options Desk** / **Trading** tile
4. In the right sidebar, find the **Button** or **Click Action** field
5. Change the URL to: **`https://options.bpleone.com/morning-brief.html`**
   - Or if you want bare landing: `https://options.bpleone.com`
6. Make sure **"Open in new tab"** is enabled (recommended)
7. Click **Save**
8. Click **Publish** (top right)

### Path 2: It's an `Image with Link` block

1. Open the same page in the editor
2. Click on the tile **image**
3. In the popup or right sidebar, look for **Click-Through URL**
4. Paste: **`https://options.bpleone.com/morning-brief.html`**
5. **Save** → **Publish**

### Path 3: It's a Squarespace `Summary` or `Portfolio Card`

1. Open the page
2. Click the card → look for **Item URL** or **External Link** in settings
3. Paste: **`https://options.bpleone.com/morning-brief.html`**
4. **Save** → **Publish**

### Path 4: It's the navigation menu

1. Squarespace settings → **Navigation**
2. Find the "Options Desk" entry (might be under "Coming Soon")
3. Edit → change the URL field to: **`https://options.bpleone.com/morning-brief.html`**
4. Make it visible (uncheck "Hidden")
5. **Save**

### Path 5 (RECOMMENDED): Drop in a complete pre-designed tile

If your existing tile is awkward to edit, replace it with a **Code Block** containing a polished tile. This is the path the team uses now.

1. Open `options.bpleone.com/squarespace-preview.html` in your browser
2. Click the variant you want (Card / Banner / Text link)
3. Click **📋 Copy to clipboard**
4. In Squarespace: **+ Add Block → Code**, paste, save
5. Move the new Code Block to the correct spot in the layout, delete the old broken tile

The Card variant matches the Pokemon desk style. The Banner is more compact. The Text link is just an inline href.

**Source file** (if you want to view it directly without rendering): `SQUARESPACE-TILE.html` in the repo root contains all three variants with inline copy comments.

---

## Update the description text on the tile

Right now your Squarespace tile might say something like "Bottom-up DCF + comps modeling" — that's wrong, it's stale from a planning doc. Here's better copy:

**Title:** Options Desk · Live
**Subtitle:** Institutional flow + brain-powered setups
**Description (1-2 sentences):**
> Bloomberg-style options flow, dark pool tracking, and an autonomous self-learning brain that ranks 195+ trade setups in real time. Free to use, built for retail.

**Badge:** Change "Coming Soon" → **"LIVE"** (green)

**Suggested icon:** 📊 or ⚡ or 🧠

---

## What to do after the tile works

Open https://bpleone.com in an incognito window → click the dashboard tile → verify it opens **https://options.bpleone.com/morning-brief.html** in a new tab and loads correctly.

If yes → 🎉 done. Share with friends.
If no → tell me what you see (screenshot helps).

---

## Nuclear option (if subdomain isn't resolving)

Run this in any terminal:
```bash
curl -sI https://options.bpleone.com | head -5
```

You should see `HTTP/1.1 200 OK` and `Server: GitHub.com`. If not, the DNS is broken:

**Fix DNS at Squarespace:**
1. Squarespace → Settings → Domains
2. Click **bpleone.com**
3. Click **DNS Settings** → **Add Custom Records**
4. Add a **CNAME** record:
   - Host: `options`
   - Data: `keyvaniath.github.io.`
5. Save. Wait 5-15 minutes for propagation.
6. Verify with the curl command above.

If you'd rather use an **A record** (more direct):
- Host: `options`
- Type: A
- Data: `185.199.108.153` (GitHub's primary)
- Add 3 more A records for: `185.199.109.153`, `185.199.110.153`, `185.199.111.153`

---

## Verified working as of right now

```
$ curl -sI https://options.bpleone.com | head -5
HTTP/1.1 200 OK
Server: GitHub.com
Content-Type: text/html; charset=utf-8
```

Site is live. Only the tile link needs updating. 5-minute Squarespace fix.

— Claude
