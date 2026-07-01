# MD / IB / Goldman pitch package — bpleone / trade

> Private (underscore = not deployed). This is the presentation script for a
> senior finance audience (equity-research / IB Managing Director). Last hardened
> 2026-07-01 after the live-data sector-price fix (pass-294) and the honest
> system-health fix. The desk is clean: data verified real, metrics honest,
> no edge claimed anywhere.

---

## THE ONE-LINE FRAME (say this before you open the laptop)

**"I built an institutional-grade market-research system end-to-end, tested whether
it had a real predictive edge, found that it mostly doesn't — and made the product
say so out loud. I want to walk you through how I know that, because the honesty is
the point."**

This is NOT a pitch for a money-making signal. If you frame it as "my AI beats the
market," an MD shreds it in 30 seconds and you deserve it. You are showing a **work
sample that demonstrates how you think**: full-stack execution, statistical rigor,
and the discipline to kill your own thesis when the data says to.

The four things this proves about you — the actual resume:
1. **Execution** — a live, self-training ML system (worker + browser), built solo.
2. **Rigor** — walk-forward validation, base-rate decomposition, calibration, p-values.
3. **Intellectual honesty** — you disproved your own edge claim and shipped that finding.
4. **Communication** — you turn messy uncertainty into one plain-English sentence.

---

## THE 3-MINUTE DEMO PATH (exact clicks, exact words)

Keep it to three minutes. An MD's attention is the scarce asset. Four pages.

**1) `start-here.html` — the honest frame (20 sec)**
Open here. Read the hero line out loud:
> "It's a research & decision-support tool — not financial advice and not a
> guaranteed money-maker. Where an edge isn't proven yet, this site says so out loud."
Say: *"Most retail 'AI trading' sites lead with a fake win rate. I lead with the disclaimer. Here's why I earned the right to."*

**2) `proof.html` / `edge-scorecard.html` — the money moment (70 sec)**
This is the beat the whole meeting hinges on. Walk the numbers:
- "The model makes a 5-day directional call on 75 names, retrains every minute, 24/7."
- "Walk-forward accuracy is **54.7%** across **1,652** predictions. Looks like edge."
- "It isn't. I decompose it: **52.4% of that is market drift** — stocks drift up, so
  'up' is right more than half the time for free. The **actual timing skill is +2.3
  points, and it is NOT statistically significant.**"
- "So the verdict the system prints, on its own, is: **'MOSTLY DRIFT — little timing
  edge.'** Live-resolved picks are running **52.2%** on 1,612 graded calls. I don't
  hide that. It's on the front page."
Say: *"The interesting engineering was building the thing that could tell me my own idea didn't work."*

**3) `audit-log.html` — the rigor (40 sec)**
Scroll the top entries. Point at the counters: **331 audit passes, 44 critical bugs
found and fixed.** Pick one to make it real:
- *"The model once looked like it had a +2.9pt edge. It was a bug — successive
  bootstraps were accumulating weights instead of starting fresh. I found it, and
  the 'edge' mostly evaporated. I logged that against myself."*
- *"Today's entry: a stale symbol cap was quietly dropping the entire sector-ETF
  complex from the live feed — half my sector board was showing month-old prices. I
  caught it, fixed it two ways, and wrote it up."*

**4) `options-flow.html` (or the Edge Scorecard's experiment cards) — what's next (30 sec)**
- "TA at this horizon is tapped out — it's drift. Real edge, if it exists, needs
  *different data*: order flow, insider clustering, smart-money confluence."
- "So I've got two forward-tests running — free CBOE options-flow and brain/insider
  confluence — both **self-grading against a drift null**. They report a verdict in a
  few weeks. If they don't beat a coin flip, the site will say that too."
Say: *"I'd rather run an honest experiment for six weeks than claim an edge I can't defend to you."*

---

## HARD Q&A — the questions an MD will actually fire

**Q: "So it doesn't make money. Why are you showing me this?"**
A: "Because the ability to build a rigorous test, run it against my own hypothesis,
and report a negative result honestly is the exact skill set of a good analyst. Most
people show me a backtest that works. I'm showing you that I know why most backtests
that 'work' are lying."

**Q: "54.7% — isn't that better than a coin flip?"**
A: "Only if you ignore the base rate. Unconditional 5-day up-rate is 52.4%, so a
model that always says 'up' scores ~52.4% with zero skill. My skill above base is
+2.3pp on n=1,652 — z isn't past the 95% bound. It's not significant. That's why the
verdict says drift, not edge."

**Q: "What's the base rate / how do you know it's drift not skill?"**
A: "I compute the unconditional up-rate over the same window and same names, then
measure accuracy *above* that. Skill-above-base with a 95% confidence bound. Green
only if it clears the bound, amber if positive-but-not-significant, red if negative.
Raw accuracy never drives the badge."

**Q: "Is the data real or are you drawing random numbers?"**
A: "Real. Prices are Yahoo delayed quotes off a Cloudflare worker; bars, insider
Form-4s, congressional PTRs, news — all real free sources. Anything that needs a paid
feed I either leave blank or label 'SAMPLE — do not trade on these.' I did a full
sweep for fabricated-but-real-looking data and killed every instance. I can show you
the audit entry."

**Q: "Overfitting? You've got a lot of knobs."**
A: "That's the main risk and I treat it as the enemy. Walk-forward (train past /
test future, never shuffled), forward-chaining CV for hyperparameters, L2, a 120-day
window so train and test share regime, and a promotion guard so a new model only
replaces the champion if it holds up out-of-sample. The honest read is *still* 'no
significant edge' — if I were overfitting to look good, the number would look better."

**Q: "Calibration — are the probabilities meaningful?"**
A: "Platt scaling with an inversion guard — I reject any calibration fit that would
flip the directional sign, which happened once on a noisy sub-regime. ECE is ~0.05 on
the walk-forward set. Brier skill is still mildly negative, which I disclose."

**Q: "You built all of this yourself?"**
A: "Yes — the ML stack, the 24/7 worker, the calibration, the self-audit, ~400 pages.
No framework, no team. I can walk any layer you want to open."

**Q: "What would make this actually have edge?"**
A: "Different data, not more indicators. Flow and positioning, not price-derived TA.
That's exactly the two experiments running now — and I'll believe them only if they
beat the drift null over a real sample. If they don't, that's a finding too."

---

## THE CLOSE / THE ASK

*"I'm not here to sell you a signal — the honest answer is it doesn't beat drift yet,
and I say that on the homepage. I'm here because this is how I think about markets:
build the system, test it against myself, and report what's true even when it's not
flattering. That's the seat I want to be in / the work I want to be doing. I'd value
your read on where this kind of rigor is most useful."*

(Tune the middle clause to the actual meeting: a role, mentorship, a research-brand intro.)

---

## TWO THINGS TO NOT DO

1. **Never let a single screen read as a performance guarantee.** No "up X%," no
   isolated win-rate without its base rate beside it. One misleading screenshot
   undoes the whole honesty thesis.
2. **Don't oversell the experiments.** They are *open* tests with an honest prior that
   free 15-min flow probably won't beat drift. "Running an experiment," never "I found
   an edge." The credibility comes from not needing them to succeed.

---

## NUMBERS TO HAVE MEMORIZED (verified live 2026-07-01)

- Walk-forward: **54.66%** on **1,652** preds = **52.36% drift + 2.3pp skill (NOT sig)**; verdict "MOSTLY DRIFT."
- Live-resolved: **52.2%** on **1,612** graded (BSS -0.093); captures pending ~581.
- Broadcast picks (as of today, small samples, drift-consistent): Pick of Day **41.2%** hit / 17 graded / **+0.68%/call**; Alpha **52.2%** hit / 136 graded / **+0.11%/call**. Both are labeled on-page **"explained by drift, not edge"** — they return roughly what a long-ish position in an up-market gives, NOT skill. (These move with each grading; the point isn't the exact figure, it's that the site never lets a small-sample positive read masquerade as edge — and it added a "sit out on weak days" gate rather than shill a pick daily.)
- System self-audits every minute: model trained on **27,750** examples, Platt a=0.914 (healthy), audit_pass true.
- **331** documented audit passes, **44** critical bugs found & fixed, worker on pass-294.
