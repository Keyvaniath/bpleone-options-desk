# bpleone / trade — X launch kit (honesty-native, live-number grounded)

**Private (underscore = never deployed by Jekyll). This is the turnkey copy for broadcasting the options desk on X. Posting is Brandon's MANUAL action — an assistant never posts or creates the account.**

Supersedes the numeric parts of `_x-launch-thread.md` (whose figures were as-of 2026-06-19). Strategy source: the pass-315 growth workflow. Account decision: post under **@Bpleonresearch** as a sub-branded "bpleone / trade" series — do NOT mint a third handle (it forks the ~50-post base into two near-zero accounts and starts anonymous). EdgeStat stays separate (different audience/claim); the desk does not.

> ⚠️ **ALWAYS refresh numbers before posting — the scorecard moves daily.**
> `GET /brain/metrics` → `walk_forward_test` (accuracy, base_rate, skill_above_base, beats_base_rate_95, n)
> `GET /brain/confluence-score` → the insider/confluence verdict.
> **Live as of 2026-07-14:** walk-forward **56.9% accuracy = 56.9% drift base rate** → **+0.0pp skill** (n=1,721, NOT significant). Confluence/insider **54.7% vs 54.7% drift base** → `insider_edge_found: false`. **Honest current read: nothing we track beats market drift right now — and that is exactly what we say.** Do NOT quote the old 67%/z+2.94 insider figure anywhere; it round-tripped to the null.

---

## THE DECISION (what you asked)
**Hybrid, honesty-native.** Not pure daily (floods a near-zero feed with 50/50 noise) and not pure event-driven (cherry-picks good days, breaks the "I grade *everything*" promise). Three layers:

| Layer | When | What | Tool |
|---|---|---|---|
| **Anchor** | Every trading day, one fixed slot | ONE tweet: today's lean + running "beat-drift?" tally + chart + ledger link. On a flat day the post literally *is* "nothing beat drift today, tally X of Y." | `broadcast.html` daily card |
| **Amplify** | Catalyst days only (mega-cap earnings, FOMC, CPI, jobs, a real insider buy-cluster) | 7–12-tweet numbered thread + quote-tweet the mover; pre-register the grade rule up top | `broadcast.html` thread composer |
| **Acquire (the real growth lever)** | Daily, ~30 min | 15–20 substantive replies on 10–15 finance accounts 5–20× your size (notifications on). Add a data point, never "great post." | manual |
| **Flagship** | Weekly (Fri close) | "Week graded vs drift" recap — every lean, how many beat the base rate, what you got wrong. Repin. | `broadcast.html` |

The integrity claim lives on the **ledger (options.bpleone.com), not the tweet stream** — a missed tweet is a reach cost, never an honesty breach. That decoupling is what makes it sustainable solo.

---

## 1. PROFILE BIO (≤160 chars)
> Equity research in public + a trading desk that grades every directional lean vs market drift — and says so out loud when nothing beats it. Not advice. options.bpleone.com

## 2. PINNED MANIFESTO (single tweet, or tweet 1 of the launch thread)
> I built an AI options-trading brain, then graded its calls honestly.
>
> Its verdict on itself: "I have no proven edge over just holding the market."
>
> So I built the whole desk around saying that out loud, in public, every day. Here's why that's the entire point 🧵

## 3. LAUNCH THREAD (post once; pin tweet 1) — live-number honest
**1/** (the pinned manifesto above)

**2/ what it is**
> A free options + technical-analysis desk — bpleone / trade. Real market data, live options chains, SEC insider flow, a daily directional "lean," and a brain that grades thousands of its own past calls and reports how it actually did. No screenshots of imaginary P&L.

**3/ the bar**
> The bar isn't "beat a coin flip." Stocks drift up, so a coin flip already wins >50%. The only thing that counts as edge is beating that **drift** — at 95% confidence. Almost every "AI trading" account quietly fails this test. Mine tells you when it does.

**4/ the honest scorecard** (attach the proof-page screenshot)
> Right now the brain has graded **1,721 live 5-day calls**. Accuracy: **56.9%.** The market's drift base rate over the same window: **56.9%.** So its skill above just-holding-the-market is **+0.0pp** — not significant. Translation: today, no edge. And I'd rather you hear that from me.

**5/ then why follow?**
> Because a signal that grades itself in public and admits "nothing beat drift this week" is doing something almost no markets account will: telling you the truth about its own edge. When something *does* clear the bar, you'll trust it — because you watched me report the weeks it didn't.

**6/ the one real finding (framed honestly)**
> The one place real edge has shown up in the data is **SEC insider open-market buy-clusters** — the documented Lakonishok–Lee anomaly. I forward-test it live. It's cl:eared the drift bar before and regressed below it since — I publish the number either way. That honesty *is* the product.

**7/ how to use it**
> Every day I post one lean + the running scorecard. On real catalysts, a full thread. Every Friday, the week graded vs drift — wins, misses, and what I got wrong. It's research + decision-support, never advice. Size accordingly; assume drawdowns.

**8/ CTA**
> Follow if you want markets content that reports its own batting average honestly — no fake win-rates, no "10x guaranteed." The live scorecard: options.bpleone.com/edge-scorecard.html

*(Fix tweet 6 typo "cl:eared"→"cleared" when posting; kept here as a reminder to re-verify the live insider number first.)*

---

## 4. DAILY ANCHOR TEMPLATE (generate fresh from broadcast.html → "Transparency" + "Daily lean" cards)
> 📅 Today's 5-day lean: $SYM ▲/▼ (model conviction N%). Running scorecard: our calls hit X% vs a Y% drift base (n=Z) — [beating drift / explained by drift, not skill]. Graded live, not advice. options.bpleone.com/edge-scorecard.html

**Flat/no-clean-setup day (post it anyway — this IS the brand):**
> 📅 No high-conviction setup cleared the bar today — the disciplined move is no trade. Running tally: X of Y calls beat market drift. Posting the boring days is the whole point. options.bpleone.com/edge-scorecard.html

## 5. WEEKLY SCORECARD (Fri close; repin) — from broadcast.html transparency card
> 🧾 This week graded vs market drift: [N calls, hit rate X% vs Y% drift base]. What beat the bar: … What didn't: … What I got wrong: … No cherry-picking — the full ledger: options.bpleone.com/edge-scorecard.html

---

## 6. POSTING CHECKLIST (tape it to your monitor)
- [ ] **One fixed slot, every trading day** (pick close ~1:15pm PT *or* pre-open ~6:15am PT — the one you will NEVER miss). Predictability is the trust signal.
- [ ] **One anchor tweet/day — not five drafts.** Don't let the daily unit inflate into a daily thread (that's the burnout path).
- [ ] **Refresh live numbers first** (`/brain/metrics` + `/brain/confluence-score`). Never post a stale figure. Never round 56.9% up to "strong."
- [ ] **Differentiator-or-don't-ship:** every reply adds a data point or a contrarian read. Never "great post."
- [ ] **Daily reply block (~30 min, ~15–20 replies on accounts 5–20× your size).** This is ~70% of real growth — more than your own tweets.
- [ ] **Event days:** thread + quote-tweet the mover, grade rule stated up front.
- [ ] **Fridays:** the weekly scorecard, repinned.
- [ ] **Never celebrate a single call — only ever the record.** One winner is noise; the batting average is the brand.
- [ ] **Send is always your thumbs.** Scheduled auto-posts proved fragile (SPCX 7/7 silent-fail). Drafts can be auto-prepared; posting stays manual.

## 7. HONEST EXPECTATIONS
Month 1 ≈ 100–300 followers *if the daily reply block runs*; ~500–1,000 by months 2–3. First visible acceleration ~day 40–50, not now. Anyone promising 0→10K in 30 days is lying or buying ads — hold the same honesty about your own growth curve that you hold about the model's edge.
