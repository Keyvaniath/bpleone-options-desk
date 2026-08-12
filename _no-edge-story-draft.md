# THE NO-EDGE STORY — flagship draft (Substack + HN + r/algotrading)

**Private (underscore = never deployed). Rewritten 2026-08-10 in human voice; every number pulled from the live scorecard that day. Publishing is Brandon's manual action. Before posting: re-pull `/brain/metrics` + `/brain/confluence-score` — the numbers move daily. Voice check: publisher, not adviser — this is a story about measurement, never a solicitation.**

> ⚠️ One personal claim to confirm before publishing anywhere: about.html says "former equity research analyst." Only you know if that's accurate as worded. The story below avoids biographical claims entirely, so it's safe either way.

---

## A. SUBSTACK FLAGSHIP (~1,200 words)

**Title:** I built an AI trading brain. It graded itself: no edge.

**Alt title:** My trading model's best discovery was a bug in my own math.

**Subtitle:** 1,721 live graded predictions. 29,700 training examples. A year of work. The most valuable number it ever produced was zero.

---

I spent the better part of a year building a self-learning trading system.

Logistic regression with an Adam optimizer. Twenty-two engineered features. Platt calibration, walk-forward validation, a Cloudflare worker grading its own predictions every minute the market is open. It makes a directional call on about 75 liquid names, waits five trading days, checks what actually happened, and trains on the result. No backtest cherry-picking. Live calls, timestamped, graded in public, no take-backs.

As of this week it has 1,721 graded predictions. Accuracy: 56.9%.

That number would look great in a Discord ad. Here's what's wrong with it. Over the exact same window, the market's unconditional five-day up-rate — the score you'd get by predicting "up" every time and going to the beach — was also 56.9%.

Skill over doing nothing: +0.0 percentage points.

I built a machine that says "stocks usually go up," with extra steps.

### The baseline nobody uses

Every "my algo hits 60%" screenshot you've ever seen is being graded against a coin flip. That's the wrong test. Stocks drift up. On a five-day horizon, "up" is the right answer somewhere between 52% and 57% of the time depending on the window, before any skill enters the picture. The coin is rigged in everyone's favor, so beating the coin means nothing.

The only bar I let my system claim is this one: beat the drift base rate, at 95% confidence.

Under that bar, everything I built is indistinguishable from drift. Not just the main model. I tested every free signal I could get my hands on, because I badly wanted something to work. Analyst-revision momentum: nothing, it's priced in before you see it. Price momentum: nothing. Options flow from the free delayed feed: nothing. Each one graded live or on held-out data. Null, null, null.

### The one that "worked"

One signal did clear the bar, for a while. SEC Form 4 insider buy-clusters — multiple insiders buying their own stock in the open market. This is a documented anomaly with decades of academic paper behind it, so when my live forward test showed it hitting 67% on 230 graded calls, z-score +2.94 against a drift-adjusted null, I believed it. Statistically significant, in free data, measured honestly. I was insufferable about it for about a month. I rebuilt my whole pitch around it.

Then it started fading. 67% became 60%. The z-score slid from 2.9 to 1.7. I wrote that up too, told myself it was regression to the mean, and honestly the write-up was pretty good: "watch a real edge decay in real time." Very mature. Very scientific.

It wasn't regression to the mean.

Last week I ran a deep audit of my own scoring code and found the real answer. My significance test was counting overlapping windows as independent observations. The scorer logged one call per symbol per day, and each call was graded on a five-day forward window. So consecutive calls on the same symbol in the same direction shared four-fifths of their window. They weren't 230 independent bets. They were the same bet, counted five times over. Correct for the overlap and the effective sample was maybe 25 to 45 observations. Rerun the z-score with that correction and the significance is just gone.

The edge didn't decay. It was never there. What I'd been narrating as "regression to the mean" was a small noisy sample wandering back to its true value, which was the null the whole time.

The same audit found my scanner had been inventing "unusual volume" every morning before the open — the data vendor reports the prior day's total volume until the session starts, and my time-of-day projection was amplifying it about tenfold. Both bugs are fixed. Both are written up in the site's public audit log, which is now 352 entries long, because apparently that's who I am now.

### So what do I actually have?

An honest answer, after a year and 29,700 training examples:

I have a measurement instrument. The same infrastructure that proves a signal has no edge is exactly what you'd need to validate one that does. Almost nobody selling trading signals has that infrastructure. That fact is not a coincidence. It is the business model.

I have a live, un-fakeable record of the null. Every call timestamped and graded against drift, published on the weeks the answer was "nothing worked," which was all of them. You can't counterfeit a public ledger of your own misses.

And I got an expensive education in how easy it is to fool yourself. I had walk-forward validation. Base-rate corrections. Calibration guards. Champion-challenger promotion rules. Real rigor, or so I thought — and I still shipped a false positive, because pseudo-replication is subtle and wanting a result is not. The bug survived every check I built until I finally pointed a hostile audit at the one number I most wanted to keep.

Which raises the uncomfortable question. If I nearly fooled myself with all that machinery, what are the odds the guy screenshotting his win rate with none of it isn't fooling himself?

### What I'd want every trader to take from this

Grade against drift, never a coin flip. Treat overlapping windows as one observation, because that's what they are. And audit your best result the hardest, precisely because it's the one you don't want to kill.

A null result, honestly measured and published, turns out to be worth more than a fake edge. It's the only thing on my site nobody can take away.

The whole system is free and live. The scorecard grades itself in public every trading day, ugly numbers included: options.bpleone.com/edge-scorecard.html

*Research and education, not investment advice. The desk publishes leans and grades them; it doesn't manage money or recommend trades.*

---

## B. SHOW HN POST

**Title:** Show HN: I built a self-learning trading brain — it graded itself and found no edge

**URL:** https://options.bpleone.com/edge-scorecard.html

**First comment (post immediately, from you):**
> Author here. This started as an attempt to build an "AI trading" system and turned into a study of my own self-deception.
>
> The system: logistic regression + Adam, 22 features, Platt calibration, walk-forward validation, running on a Cloudflare worker that grades its own 5-day directional calls live. 1,721 graded predictions so far.
>
> The result: 56.9% accuracy — which is exactly the market's drift base rate over the same window. +0.0pp of skill. The site says so on every page, because grading against a 50% coin flip (what most "algo" accounts do) is meaningless when stocks drift up.
>
> The part I think HN will enjoy: one signal (SEC insider buy-clusters, a documented anomaly) looked genuinely significant for months — z=+2.94 on n=230. Then a deep audit of my own scoring code found the significance test was counting overlapping 5-day windows as independent observations. Effective n was ~25–45, not 230. The "edge" was pseudo-replication. I'd been publicly narrating its decline as "regression to the mean," which was wrong in an instructive way: it never existed. Fixed and disclosed in the public audit log (352 entries).
>
> Everything is free, no signup gates on the data. Happy to answer anything about the stats, the infra (runs on the CF free tier), or what it's like to publish your own null result.

---

## C. r/algotrading POST

**Title:** After 1,721 live graded predictions, my system's skill over market drift is exactly +0.0pp — and my one "significant" edge turned out to be an overlapping-windows bug

**Body:**
> Sharing this because the failure modes are more useful than another win-rate screenshot.
>
> **Setup:** 22-feature logistic model (Adam, L2, Platt calibration, walk-forward CV), predicting 5-day direction on ~75 liquid US names. A worker grades every live call against realized 5-day returns. No backtest-only claims — everything below is the live ledger.
>
> **Results, graded honestly:**
> - Walk-forward accuracy: 56.9% on n=1,721
> - Unconditional 5-day up-rate (drift) over the same window: 56.9%
> - Skill above drift: +0.0pp. Not significant. Nothing.
> - Also tested live/held-out: analyst-revision momentum (−2.3pp vs base), price momentum (z≈0), free options-flow (null).
>
> **The interesting bug:** SEC insider buy-clusters looked real for months — 67% hit rate, n=230, z=+2.94 vs a selection-adjusted drift null. Then it "regressed." An audit of my scorer found why: I logged a call per symbol per day on 5-day forward windows, so consecutive same-direction calls on one symbol overlapped 4/5 — the test treated ~25–45 effective observations as 230 independent ones. Cluster-correct the z (×√(n_eff/n)) and significance vanishes. Classic pseudo-replication. Embarrassing, and exactly the mechanism behind a lot of published "edges."
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
- Local preview: run `python -m http.server 8899` in the repo and open http://localhost:8899/_story-preview.html
