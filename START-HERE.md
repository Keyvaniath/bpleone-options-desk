# 👋 START HERE — Opening this in Claude Code

> **For Brandon.** Step-by-step to pick up exactly where Cowork mode left off, in Claude Code.

---

## Step 1 — Get the folder onto your computer

You have two ways:

**A. Use the ZIP** (if you haven't unzipped yet)
1. Download `bpleone-trading-v5.zip` from the Cowork session.
2. Unzip it anywhere — Desktop is fine.
3. You'll get a folder named `bpleone-trading-stage/` (or similar). **Rename it to `bpleone-trading`** to match what Claude Code expects.

**B. Use the working folder directly** (if it's already on your machine)
The folder is in your Cowork outputs directory. On a Mac that's roughly `~/Library/.../local-agent-mode-sessions/.../outputs/bpleone-trading`. Copy that whole folder somewhere easier — say `~/Code/bpleone-trading/`.

Either way, you should end up with a single folder named `bpleone-trading` containing:
- 44 HTML files at the root
- `css/`, `js/`, `assets/` subfolders
- `CLAUDE.md`, `HANDOFF.md`, `README.md`, `DEPLOY.md`, **this file** (`START-HERE.md`)
- `CNAME`, `manifest.json`, `favicon.svg`, `sitemap.xml`, `robots.txt`

---

## Step 2 — Open Claude Code in that folder

In Terminal (Mac) or PowerShell/cmd (Windows):

```bash
cd ~/Code/bpleone-trading        # or wherever you put it
claude                            # this launches Claude Code in this folder
```

Claude Code will **automatically read `CLAUDE.md` on startup**. You'll see something like:
> `Reading CLAUDE.md for project context…`

That alone gives the new Claude 90% of the context. The next 10% you give it with the first prompt.

---

## Step 3 — Paste this as your first message

Copy-paste this exactly. It primes Claude Code with the right framing:

```
Read CLAUDE.md and HANDOFF.md if you haven't already. I'm continuing
work on the bpleone-trading project — the equity/options/TA desk for
options.bpleone.com (subdomain of my Squarespace hub bpleone.com,
matching the existing pokemon.bpleone.com pattern).

Status: 44 pages built, audit clean, NOT yet deployed. The last
session built a v5 deploy bundle (bpleone-trading-v5.zip in this
folder) and a deploy guide (DEPLOY.md, 4 paths: GitHub Pages /
Vercel / Netlify / Squarespace embed).

What I want next:
[fill in one of these or your own]
  - "Walk me through deploying to Netlify"
  - "Keep building" (add more pages — read 'What's NOT yet built'
     in CLAUDE.md for ideas)
  - "Audit and fix any issues" (run the audit script in CLAUDE.md)
  - "Wire real market data" (point me to the one-function swap in
     js/live.js and recommend a data provider)
  - "Make [page X] denser/better"
```

---

## Step 4 — That's it

The next Claude now has:
- Full architecture map (CLAUDE.md)
- 60-second briefing (HANDOFF.md)
- Deploy instructions (DEPLOY.md)
- Project overview (README.md)
- Your specific ask (your first message)

No re-discovery needed. It can ship from message #2.

---

## If something goes wrong

**"Claude Code didn't read CLAUDE.md automatically"**
→ Just paste: `Read CLAUDE.md and HANDOFF.md now. Then continue.`

**"It says it can't find the files"**
→ You're probably not in the right directory. Run `pwd` to confirm. You should see the folder name `bpleone-trading` at the end of the path, and `ls` should show the 44 HTML files.

**"It wants to start from scratch"**
→ Stop it. Paste: `Don't rebuild — everything is already built. Read CLAUDE.md to see what exists.`

**"The audit script in CLAUDE.md fails"**
→ Likely a Mac/Linux vs Windows shell issue. Replace `bash` with whatever shell Claude Code uses on your system. The audit logic is portable; the wrapper isn't.

---

## Recap: 4 docs, 4 jobs

| File | Read by | Job |
|---|---|---|
| `START-HERE.md` | YOU (Brandon) | How to open this in Claude Code |
| `CLAUDE.md` | Claude Code (auto) | Full project context |
| `HANDOFF.md` | Claude Code (quick ref) | 60-second briefing |
| `DEPLOY.md` | Claude or you | How to ship to `options.bpleone.com` |
| `README.md` | Anyone seeing the GitHub repo | Public-facing overview |

You don't need to read CLAUDE.md or HANDOFF.md yourself — they're for the AI. You only read this file and DEPLOY.md.

---

## One last thing

If you ever want to back to **this exact Cowork session**, scroll up in Cowork — the full conversation is preserved. But Claude Code from this point forward is the better venue for iterative coding work. Cowork is great for ideation and prototyping; Claude Code is better for "I want to add 5 features and ship by tonight."

Good luck. 🚀
