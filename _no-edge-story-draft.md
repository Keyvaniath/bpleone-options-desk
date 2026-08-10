# THE NO-EDGE STORY — flagship draft (Substack + HN + r/algotrading)

**Private (underscore = never deployed). Written 2026-08-10, every number pulled from the live scorecard that day. Publishing is Brandon's manual action. Before posting: re-pull `/brain/metrics` + `/brain/confluence-score` — the numbers move daily. Voice check: publisher, not adviser — this is a story about measurement, never a solicitation.**

> ⚠️ One personal claim to confirm before publishing anywhere: about.html says "former equity research analyst." Only you know if that's accurate as worded. The story below avoids biographical claims entirely, so it's safe either way.

---

## A. SUBSTACK FLAGSHIP (~1,400 words)

**Title options (pick one):**
1. *I built an AI trading brain. It graded itself: no edge.*
2. *My trading model's honest verdict on itself: "I'm just market drift."*
3. *The edge that never existed: how my own audit caught my best result being a statistics bug.*

**Subtitle:** Eighteen months, 26,000 training examples, 1,721 live graded predictions — and the most valuable thing it produced was the number zero.

---

I spent months building a self-learning trading brain.

Logistic regression with an Adam optimizer, 22 engineered features, Platt calibration, walk-forward validation, a Cloudflare worker grading its own predictions every minute of every trading day. It captures a directional call on ~75 liquid names, waits five trading days, checks what actually happened, and trains on the result. No backtest cherry-picking — live, timestamped, irreversible calls.

As of this week it has graded **1,721 live five-day predictions**.

Its accuracy: **56.9%.**

Sounds decent, right? Most "AI trading" accounts would screenshot that and start selling a Discord.

Here's the number they wouldn't show you: over the exact same window, the market's unconditional five-day up-rate — the score you'd get by predicting "up" every time and taking a nap — was **also 56.9%.**

Skill above just-holding-the-market: **+0.0 percentage points.**

My model's honest verdict on itself is that it's an expensive way to say "stocks usually go up."

### The bar almost nobody uses

The dirty secret of every "my algo hits 60%!" post is the baseline. Stocks drift upward. On a five-day horizon, "up" is the right answer ~52–57% of the time depending on the window, before any skill enters the picture. Beating a coin flip is worthless — the coin is rigged in everyone's favor.

So the only bar I let my system claim is: **does it beat the drift base rate, at 95% statistical confidence?**

Under that bar, my brain — the ensembles, the calibrators, the kNN recall, the meta-stacker, all of it — is indistinguishable from drift. I tested the other free-data signals too, because I wanted *something* to work: analyst-revision momentum (no edge, priced in), price momentum (no edge), options-flow from the free CBOE feed (no edge). Each one graded live or on held-out data, each one a null result.

### The one signal that "worked" — and the bug that unmade it

One signal did clear the bar, for a while: SEC Form-4 **insider open-market buy clusters** — the documented Lakonishok–Lee anomaly. Multiple insiders buying their own stock in the open market, followed by positive drift-adjusted returns. My live forward test showed it hitting 67% on n=230 graded calls, z = +2.94 against a selection-adjusted drift null. Statistically significant. A real edge, in free data, measured honestly. I built the pitch around it.

Then it started fading. 67% became 60%. z = +2.9 became +1.7. I wrote that up too — "watch the edge decay in real time" — and told myself it was regression to the mean.

Last week, a deep audit of my own scoring code found the actual answer, and it's more embarrassing and more interesting than mean reversion:

**My significance test was counting overlapping windows as independent observations.**

The scorer logged a call per symbol per day, each graded on a five-trading-day forward window. Consecutive calls on the same symbol in the same direction share four-fifths of their window — they are substantially *the same bet*, counted five times. My "n=230" was really something like **25–45 effective observations**. Recompute the z-statistic with a cluster correction (scale by √(n_eff/n)) and the significance evaporates. The edge didn't fade. **It was never there.** The decay I'd been narrating as regression to the mean was a small sample wandering back toward its true value: the null.

The same audit found the scanner had been fabricating "unusual volume" every pre-market — the data vendor reports the prior session's full volume before the open, and my time-of-day projection amplified it ~10×. Both bugs fixed, both disclosed in the site's public audit log, which is now 349 entries long.

### What I actually built

So what do you have after all that work? Honestly:

1. **A measurement instrument, not a money machine.** The infrastructure that *proves* a signal has no edge is the same infrastructure that would validate one that does. Almost nobody selling signals has it, which is precisely why they can sell signals.
2. **A live, un-fakeable track record of the null.** Every call timestamped, graded against drift, published — including the weeks the answer is "nothing worked." You cannot counterfeit a ledger of your own misses.
3. **A working education in how easy self-deception is.** I had walk-forward validation, base-rate corrections, calibration guards, champion/challenger promotion rules — real rigor — and *still* shipped a false positive, because pseudo-replication is subtle and motivated reasoning is not. The bug survived until I pointed an adversarial audit at my own favorite result.

The uncomfortable inference: if I nearly fooled myself *with* all that machinery, what's the base rate of self-deception among accounts with none of it?

### The takeaway I'd tattoo on FinTwit

- Grade against **drift**, never a coin flip.
- Overlapping windows are **one observation**, not many. If your n includes the same bet on consecutive days, your significance test is fiction.
- Your best result deserves your **most hostile** audit, because it's the one you least want to kill.
- And a null result, honestly measured and published, is worth more than a fake edge. It's the only thing here nobody can take away.

The whole system is free and live — the scorecard grades itself in public daily, ugly numbers and all: options.bpleone.com/edge-scorecard.html

*Research and education, not investment advice. The desk publishes leans and grades them; it does not manage money or recommend trades.*

---

## B. SHOW HN POST

**Title:** Show HN: I built a self-learning trading brain — it graded itself and found no edge

**URL:** https://options.bpleone.com/edge-scorecard.html

**First comment (post immediately, from you):**
> Author here. This started as an attempt to build an "AI trading" system and turned into a measurement study of my own self-deception.
>
> The system: logistic regression + Adam, 22 features, Platt calibration, walk-forward validation, running 24/7 on a Cloudflare worker that grades its own 5-day directional calls live. 1,721 graded predictions so far.
>
> The result: 56.9% accuracy — which is exactly the market's drift base rate over the same window. +0.0pp of skill. The site says so on every page, because grading against a 50% coin flip (what most "algo" accounts do) is meaningless when stocks drift up.
>
> The part I think HN will enjoy: one signal (SEC insider buy-clusters, the Lakonishok–Lee anomaly) looked genuinely significant for months — z=+2.94, n=230. A deep audit of my own scoring code then found the significance test was counting overlapping 5-day windows as independent observations. Effective n was ~25–45, not 230. The edge was pseudo-replication, not alpha. Fixed, disclosed in the public audit log (349 entries).
>
> Everything is free, no signup gates on the data. Happy to answer anything about the stats, the infra (runs on the CF free tier), or what it's like to publish your own null result.

---

## C. r/algotrading POST

**Title:** After 1,721 live graded predictions, my system's skill over market drift is exactly +0.0pp — and my one "significant" edge turned out to be an overlapping-windows bug

**Body:**
> Sharing this because the failure modes are more useful than most win-rate screenshots.
>
> **Setup:** 22-feature logistic model (Adam, L2, Platt calibration, walk-forward CV), predicting 5-day direction on ~75 liquid US names. A worker grades every live call against realized 5-day returns. No backtest-only claims — everything below is the live ledger.
>
> **Results, graded honestly:**
> - Walk-forward accuracy: 56.9% on n=1,721
> - Unconditional 5-day up-rate (drift) over the same window: 56.9%
> - Skill above drift: +0.0pp. Not significant. Nothing.
> - Also tested live/held-out: analyst-revision momentum (−2.3pp vs base), price momentum (z≈0), free options-flow (null).
>
> **The interesting bug:** SEC insider buy-clusters looked real for months — 67% hit rate, n=230, z=+2.94 vs a selection-adjusted drift null. Then it "regressed." An audit of my scorer found why: I logged a call per symbol per day on 5-day forward windows, so consecutive same-direction calls on one symbol overlapped 4/5 — the test treated ~25–45 effective observations as 230 independent ones. Cluster-correct the z (×√(n_eff/n)) and significance vanishes. Classic pseudo-replication; embarrassing; exactly the kind of thing that produces most published "edges."
>
> **Rules I'd propose from this:** (1) your null is the drift base rate, never 50%; (2) overlapping forward windows are one observation; (3) audit your best result hardest — it's the one you're motivated not to kill.
>
> Ledger is public and free if anyone wants to kick the tires (link in profile / can share if allowed). Not selling anything — there's demonstrably nothing to sell.

---

## POSTING NOTES
- Substack first (it's the canonical home; per your workflow, schedule for a weekday ~5am PT). Then Show HN mid-morning ET Tue–Thu. Then r/algotrading (check its self-promo rules; the "link in profile" hedge is deliberate).
- Attach the edge-scorecard screenshot to the Substack piece.
- All three are ready to paste; refresh the numbers the day you post.
- These also feed the MD pitch: the artifact narrative is now "our audit caught our own false positive" — stronger than "the edge faded."
