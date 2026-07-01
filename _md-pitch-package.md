# MD / IB / Goldman pitch package — bpleone / trade

> Private (underscore = not deployed). This is the presentation script for a
> senior finance audience (equity-research / IB Managing Director). Last hardened
> 2026-07-01 after the live-data sector-price fix (pass-294) and the honest
> system-health fix. The desk is clean: data verified real, metrics honest,
> no edge claimed anywhere.

---

## THE ONE-LINE FRAME (say this before you open the laptop)

**"I built an institutional-grade market-research system end-to-end and used it to
answer one question honestly: where is there a real edge, and where isn't there? My
TA model — the thing everyone else would hype — is mostly market drift, no significant
timing skill, and the site says so out loud. But a different dataset, SEC insider
buy-clusters, shows a real, statistically-significant edge in my own live forward-test.
And here's the discipline: I credit the data, not my model — because the model adds
nothing on top of it. Finding the real signal and refusing to over-attribute it is the point."**

This is NOT a pitch for a money-making signal you should buy. If you frame it as "my AI
beats the market," an MD shreds it in 30 seconds and you deserve it. You are showing a
**work sample that demonstrates how you think**: full-stack execution, statistical rigor,
the discipline to kill your own thesis when the data says to — and the judgment to know
that a real edge in *insider filings* is not the same as edge in *your model*.

The four things this proves about you — the actual resume:
1. **Execution** — a live, self-training ML system (worker + browser), built solo.
2. **Rigor** — walk-forward validation, base-rate decomposition, calibration, p-values.
3. **Intellectual honesty** — you disproved your own model's edge, found a real one in a *different* dataset, and refused to credit the model for it. Both directions of honesty.
4. **Communication** — you turn messy uncertainty into one plain-English sentence.

---

## THE 3-MINUTE DEMO PATH (exact clicks, exact words)

Keep it tight — ~3–4 minutes. An MD's attention is the scarce asset. Five short beats.

**1) `start-here.html` — the honest frame (20 sec)**
Open here. Read the hero line out loud:
> "It's a research & decision-support tool — not financial advice and not a
> guaranteed money-maker. Where an edge isn't proven yet, this site says so out loud."
Say: *"Most retail 'AI trading' sites lead with a fake win rate. I lead with the disclaimer. Here's why I earned the right to."*

**2) `proof.html` — the null result (55 sec)**
- "The model makes a 5-day directional call on 75 names, retrains every minute, 24/7."
- "Walk-forward accuracy is **54.7%** across **1,652** predictions. Looks like edge."
- "It isn't. I decompose it: **52.4% of that is market drift** — stocks drift up, so
  'up' is right more than half the time for free. The **actual timing skill is +2.3
  points, and it is NOT statistically significant.**"
- "So the verdict the system prints, on its own, is: **'MOSTLY DRIFT — little timing
  edge.'** Live-resolved picks: **52.2%** on 1,612 graded. It's on the front page."
Say: *"The interesting engineering was building the thing that could tell me my own idea didn't work."*

**3) `edge-scorecard.html` — the real edge, honestly attributed (55 sec — the centerpiece)**
This is the strongest beat. Three side-by-side cards, one live forward-test:
- **🧠 Brain alone: 53.0%** (n=1,211) — "Explained by drift, not edge." *"My model: no edge. Same story as Proof."*
- **🏛 Insiders alone: 67.4%** (n=230) — ✓ Beats drift & profitable (95%), **+3.5%/call**, z vs drift **+2.94**. *"A completely different dataset — SEC open-market insider buy-clusters — DOES show a real, significant edge. This is the well-documented insider-buying anomaly, and it's showing up live in my own forward-test, not a backtest."*
- **🐳 Confluence (both agree): 67.1%** (n=164) — *"Here's the discipline. When I require my model to ALSO agree, it doesn't beat insiders alone — it slightly dilutes it. So the edge is the insider data; my model adds nothing. The banner says exactly that, and it's **amber, not green** — I coded it to refuse credit for a 'fusion' that isn't doing the work."*
Say: *"That's the whole pitch in one screen — I found real signal in the right place, and I won't let my own model take credit for it."*

**4) `audit-log.html` — the rigor (40 sec)**
Scroll the top entries. Point at the counters: **331 audit passes, 44 critical bugs
found and fixed.** Pick one to make it real:
- *"The model once looked like it had a +2.9pt edge. It was a bug — successive
  bootstraps were accumulating weights instead of starting fresh. I found it, and
  the 'edge' mostly evaporated. I logged that against myself."*
- *"Today's entry: a stale symbol cap was quietly dropping the entire sector-ETF
  complex from the live feed — half my sector board was showing month-old prices. I
  caught it, fixed it two ways, and wrote it up."*

**5) `options-flow.html` — the experiment that *didn't* work (30 sec — the symmetry)**
- "I ran a second 'different-data' hypothesis: free CBOE options-flow — daily call/put
  dollar-flow direction, self-graded against the same drift null. The flow data itself is
  real and live (real $-flow, unusual-volume counts)."
- "The verdict came back **NO EDGE** — 45% directional, unprofitable, n=22 — and the page
  says exactly that, in the same red language that killed my own model. Two experiments,
  one hit (insiders), one miss (flow). The machine reports both the same way."
Say: *"That's the tell that the honesty is real, not marketing — I let it print NO EDGE on a feature I built and hoped would work."*

---

## HARD Q&A — the questions an MD will actually fire

**Q: "So it doesn't make money. Why are you showing me this?"**
A: "Two reasons. First, the ability to build a rigorous test, run it against my own
hypothesis, and report a negative result honestly is the exact skill set of a good
analyst — most people show me a backtest that works; I'm showing you I know why most
backtests that 'work' are lying. Second, it's not entirely negative: one dataset —
insider buy-clusters — is showing a real, significant edge in the live test. The point
is I can tell you *which* is which, with the statistics to back it."

**Q: "You said the insider signal has a real edge — walk me through it. How confident?"**
A: "Insider open-market buy-clusters call 5-day direction right 67.4% over 230 graded
live calls — versus a *selection-adjusted* drift base of 57.8% (I null against how those
same insider-bought names drift, not a naive 50%), so it's +9.6pp of real skill, z≈2.94,
p≈0.002. Average +3.5% per call. This is the long-documented insider-buying anomaly
(Lakonishok-Lee and successors) showing up in my own live forward-test, not a backtest.
Caveats I'd flag before you get excited: it's a *known* anomaly, not novel alpha I
discovered; free SEC Form-4 data, 5-day horizon; n=230 is decent but I'd want more; and
I lean on the hit rate over the average return because a few big winners can flatter the
mean. Most important: my ML model does *not* improve on it — requiring the model to agree
doesn't beat insiders alone — so I attribute the edge to the data, not the model."

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
A: "Different data, not more indicators — and I already have my first proof of that:
the insider signal beats drift where the price-based model can't. The thesis is
positioning and flow, not TA. The next test is the CBOE options-flow experiment, still
accruing. I'll believe each one only if it beats the drift null over a real sample —
and the insider one already has."

**Q: "If the edge is a known insider anomaly, what are YOU adding?"**
A: "Fair — the anomaly is documented. What I'm adding is the live, honest measurement
infrastructure: a system that grades every signal against the right (selection-adjusted)
null in real time, tells me which data actually carries edge, and refuses to let my own
model take credit it didn't earn. The edge is the insiders; the *discipline* is mine.
In a research seat, that measurement discipline is the transferable skill."

---

## THE CLOSE / THE ASK

*"I'm not here to sell you a signal. My model doesn't beat drift and I say so on the
homepage; the one real edge I've found lives in insider data, not my model, and I
attribute it there. I'm here because this is how I think about markets: build the
system, test it against myself, find where the edge actually is, and report what's true
even when it's not flattering to me. That's the seat I want to be in / the work I want
to be doing. I'd value your read on where this kind of rigor is most useful."*

(Tune the middle clause to the actual meeting: a role, mentorship, a research-brand intro.)

---

## THREE THINGS TO NOT DO

1. **Never let a single screen read as a performance guarantee.** No "up X%," no
   isolated win-rate without its base rate beside it. One misleading screenshot
   undoes the whole honesty thesis.
2. **Don't let the insider edge become "my model's edge."** It's the insider data (a
   documented anomaly), measured honestly — the model adds nothing, and that
   *attribution discipline* is the impressive part. If you claim your ML found alpha,
   you've become the thing the rest of the pitch mocks.
3. **Don't over-conclude the options-flow NO-EDGE either.** It's an early read (n=22) —
   "no edge so far, honestly reported," not "definitively dead." The point is the machine
   prints NO EDGE on a feature you built and hoped would work — that's the honesty tell,
   not a hard statistical verdict. Same discipline in both directions.

---

## NUMBERS TO HAVE MEMORIZED (verified live 2026-07-01)

- Walk-forward: **54.66%** on **1,652** preds = **52.36% drift + 2.3pp skill (NOT sig)**; verdict "MOSTLY DRIFT."
- Live-resolved: **52.2%** on **1,612** graded (BSS -0.093); captures pending ~581.
- **The edge, honestly attributed (edge-scorecard forward-test):** 🏛 **Insiders alone 67.4%** / n=230 / **+3.5%/call** / z vs (selection-adjusted) drift **+2.94** → real, significant. 🧠 **Brain alone 53.0%** / n=1,211 → no edge (drift). 🐳 **Confluence 67.1%** / n=164 → does NOT beat insiders-alone, so the edge is the *data*, not the fusion. Banner is **amber ("real edge, but it's the insider signal"), not green.**
- Broadcast picks (as of today, small samples, drift-consistent): Pick of Day **41.2%** hit / 17 graded / **+0.68%/call**; Alpha **52.2%** hit / 136 graded / **+0.11%/call**. Both are labeled on-page **"explained by drift, not edge"** — they return roughly what a long-ish position in an up-market gives, NOT skill. (These move with each grading; the point isn't the exact figure, it's that the site never lets a small-sample positive read masquerade as edge — and it added a "sit out on weak days" gate rather than shill a pick daily.)
- System self-audits every minute: model trained on **27,750** examples, Platt a=0.914 (healthy), audit_pass true.
- **332** documented audit passes, **45** critical bugs found & fixed, worker on pass-295.
