# MD / IB / Goldman pitch package — bpleone / trade

> Private (underscore = not deployed). This is the presentation script for a
> senior finance audience (equity-research / IB Managing Director). Last hardened
> 2026-07-07 after the scale-hardening deploy (pass-296) and a live-numbers
> reconciliation. The desk is clean: data verified real, metrics honest.
>
> ⚠️ **THE NUMBERS MOVE — AND THAT IS THE PITCH NOW.** Between 2026-07-01 and
> 2026-07-07 the insider edge **regressed** as its sample grew: 67.4% (n=230,
> z+2.94) → **60.0% (n=310, z+1.7)**. It still clears the drift null at 95%, but
> only marginally now. Do NOT quote the old 67%/z2.94 — the MD can pull up the live
> page. **Always run `/brain/confluence-score` right before presenting** and use the
> current figures. The regression is not a problem to hide; it is the strongest thing
> you can show a research MD (see the reframed centerpiece + Q&A below).

---

> 🔴 **2026-08-10 UPDATE — THE STORY CHANGED AGAIN, AND IT'S STRONGER (supersedes the frame below).**
> A 15-agent deep audit (pass 316) found the real explanation for the "regression": the
> significance test **counted overlapping 5-day windows as independent observations.**
> Calls were logged per symbol per day on 5-trading-day windows — consecutive same-direction
> calls on one symbol are largely the *same bet*, counted ~5×. The famous "n=230, z=+2.94"
> was really **~25–45 independent observations**; cluster-correct the z (×√(n_eff/n)) and the
> significance vanishes. **The insider edge was never there — it was pseudo-replication.**
> The scorer is fixed (worker pass-306: `effective_n` + corrected z, disclosed on the live
> Edge Scorecard with a public methodology-correction note), and the live corrected read as
> of 8/10 is: brain z≈+0.7, confluence z≈+0.1, insiders z≈**−0.5** — all inside the null.
>
> **USE THIS ONE-LINE FRAME INSTEAD:**
> *"I built an institutional-grade research system and pointed it at one honest question:
> where's the edge? My TA model — the thing everyone hypes — is market drift, and the site
> says so out loud. One signal, SEC insider buy-clusters, looked genuinely significant in my
> live forward-test: z≈2.9. Then I audited my own scorer and found the significance was
> pseudo-replication — overlapping windows counted as independent samples. My best result
> was a false positive, my own audit caught it, and the correction is published on the live
> scorecard next to the misses. That loop — measure, distrust your best number, audit it
> hardest, publish the correction — is the actual product, and it's the discipline I'd bring
> to your desk."*
>
> Why this is a BETTER pitch than "the edge decayed": decay implies the measurement was fine
> and the world changed. A caught false positive demonstrates the rarer skill — hostile
> auditing of your own favorite result and publishing the retraction. Every research MD has
> watched careers built on the first mistake; almost nobody demonstrates the second habit.
> **Always pull `/brain/confluence-score` live before presenting** — quote `effective_n` and
> the corrected z, never the raw n.

## THE ONE-LINE FRAME (⚠️ superseded 2026-08-10 — see the update block above; kept for history)

**"I built an institutional-grade market-research system end-to-end and pointed it at one
honest question: where is there an edge, and where isn't there? My TA model — the thing
everyone else would hype — is market drift, no significant timing skill, and the site says
so out loud. A different dataset, SEC insider buy-clusters, does clear the drift null in my
live forward-test — but here's the part I actually want to show you: when I first measured
it, it was 67% at z≈2.9. As the sample grew over the next week, it regressed to 60% at
z≈1.7 — barely significant now. I watched my own edge decay toward the null in real time,
and I'm telling you the 60, not the 67. That gap — between a backtest that 'works' and a
forward-test you keep honest as the data comes in — is the whole point."**

This is NOT a pitch for a money-making signal you should buy. If you frame it as "my AI
beats the market," an MD shreds it in 30 seconds and you deserve it. You are showing a
**work sample that demonstrates how you think**: full-stack execution, statistical rigor,
the discipline to kill your own thesis when the data says to — and the calibration to
report an edge *shrinking* toward the null rather than quoting its flattering first print.

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

**3) `edge-scorecard.html` — the edge, honestly attributed AND honestly decaying (60 sec — the centerpiece)**
This is the strongest beat *because* it isn't a clean win. Three live cards (numbers as of
2026-07-07 — **pull `/brain/confluence-score` right before you present**):
- **🧠 Brain alone: ~50%** (n≈1,480) — below the drift base. *"My TA model: no edge. Same story as Proof — and if anything it's decayed under the drift base."*
- **🏛 Insiders alone: ~60%** (n≈310), z vs selection-adjusted drift **≈+1.7**, avg **≈+2.5%/call** — still ✓ beats drift at 95%, but marginally. *"Different dataset — SEC open-market insider buy-clusters — still clears the drift null. But watch this: a week ago it was 67% at z≈2.9. As I graded 80 more calls it regressed to 60% at z≈1.7. I'm showing you the 60."*
- **🐳 Confluence (both agree): ~57%** (n≈226) — z≈0, no longer beats drift. *"And requiring my model to agree doesn't help — confluence has drifted back to the base rate. The edge, such as it is, lives in the insider leg alone; my model adds nothing. The banner is **amber, not green**."*
Say: *"That's the whole pitch in one screen. I found a real-ish signal in the right place (different data, not TA) — and instead of framing you the flattering 67% first print, I'm telling you it's regressing toward the null as the sample grows. In a research seat, that calibration is worth more than the number."*
*Optional drill-down:* click **`insider-live.html`** — the live SEC Form-4 feed. When open-market **buy-clusters** are present they're the raw signal; when insiders are net-selling it says exactly that (honest empty state). **Glance before you present** — if there are no buy-clusters that day, stay on the scorecard.

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
A: "Because the ability to build a rigorous test, run it against my own hypothesis, and
report the result honestly — even when the result decays — is the exact skill of a good
analyst. Most people show me a backtest that works. I'm showing you a forward-test I keep
honest as the data comes in: one signal (insiders) that clears the drift null but is
regressing toward it, and a TA model that never had edge. I can tell you *which is which*,
with the statistics, and I won't inflate either."

**Q: "You said the insider signal has an edge — walk me through it. How confident?"**
A: "As of today, insider open-market buy-clusters call 5-day direction right ~60% over
~310 graded live calls — versus a *selection-adjusted* drift base (~55%, I null against how
those same insider-bought names drift, not a naive 50%), so ~+5pp of skill at z≈1.7. It
clears the 95% one-sided bound, but barely. And I'll be straight with you about the
trajectory: a week ago the same test read 67% at z≈2.9; 80 more graded calls pulled it to
60% at z≈1.7. That's regression toward the null, which is exactly what you'd expect if the
early number was partly noise. So my honest confidence is *'promising, not proven'* — it's
consistent with the documented insider-buying anomaly (Lakonishok-Lee), but I would NOT
size real capital on z≈1.7, and I'd want to see it hold over a few hundred more calls.
Also: my ML model does not improve on it — requiring the model to agree doesn't beat
insiders alone — so whatever edge exists is the data, not my model."

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
A: "Different data, not more indicators — that's the thesis, and the insider leg is the
partial proof: it clears the drift null where the price-based model can't, even as it
regresses. Positioning and filings, not TA. The other 'different-data' test — CBOE
options-flow — came back NO EDGE. So my read is: the signal that survives is corporate
insiders, and even that is marginal at free-data resolution. A real, sizeable edge
probably needs paid/faster data on the same thesis — but I'll only believe it if it
beats the drift null over a real sample, the way I've held every test here."

**Q: "If the edge is a known insider anomaly, what are YOU adding?"**
A: "Fair — the anomaly is documented. What I'm adding is the live, honest measurement
infrastructure: a system that grades every signal against the right (selection-adjusted)
null in real time, tells me which data actually carries edge, and refuses to let my own
model take credit it didn't earn. The edge is the insiders; the *discipline* is mine.
In a research seat, that measurement discipline is the transferable skill."

---

## THE CLOSE / THE ASK

*"I'm not here to sell you a signal. My model doesn't beat drift and I say so on the
homepage; the one signal that clears the null lives in insider data, not my model — and
even that is marginal and regressing, which I'll show you rather than hide. I'm here
because this is how I think about markets: build the system, test it against myself, find
where the edge actually is, and report what's true even when it decays on me. That
calibration is the seat I want to be in / the work I want to be doing. I'd value your read
on where this kind of rigor is most useful."*

(Tune the middle clause to the actual meeting: a role, mentorship, a research-brand intro.)

---

## THREE THINGS TO NOT DO

1. **Never let a single screen read as a performance guarantee.** No "up X%," no
   isolated win-rate without its base rate beside it. One misleading screenshot
   undoes the whole honesty thesis.
2. **Don't quote the stale 67%/z2.94 — and don't let the insider edge become "my model's edge."**
   The live number regressed to ~60%/z1.7; the MD can pull up the page, so a stale figure
   reads as either careless or dishonest. Pull `/brain/confluence-score` right before you
   present and use current numbers — and lead with the *regression*, which is the credible
   part. And whatever the number, it's the insider *data* (a documented anomaly), not your
   model — if you claim your ML found alpha you've become the thing the rest of the pitch mocks.
3. **Don't over-conclude the options-flow NO-EDGE either.** It's an early read (n=22) —
   "no edge so far, honestly reported," not "definitively dead." The point is the machine
   prints NO EDGE on a feature you built and hoped would work — that's the honesty tell,
   not a hard statistical verdict. Same discipline in both directions.

---

## NUMBERS — as of 2026-07-07 (⚠️ LIVE + MOVING — pull `/brain/confluence-score` + `/brain/metrics` right before presenting)

- Walk-forward (held-out backtest): **~54.7%** on ~1,650 preds = **~52.4% drift + ~2.3pp skill (NOT sig)**; verdict "MOSTLY DRIFT." (Backtest is stable; the *forward-test* legs below are what move.)
- **Forward-test legs (these regressed — the regression IS the pitch):**
  - 🏛 **Insiders alone ~60%** / n≈310 / avg **~+2.5%/call** / z vs selection-adjusted drift **~+1.7** → still clears the 95% bound, but marginally. **Was 67.4% / n=230 / z+2.94 on 07-01** — regressed toward the null as n grew.
  - 🧠 **Brain alone ~50%** / n≈1,480 → below the drift base; no edge (was 53%).
  - 🐳 **Confluence ~57%** / n≈226 / z≈0 → no longer beats drift (was 67%). Banner **amber**, attributes any edge to the insider leg, not the model.
- Broadcast picks (small samples, move daily): Pick of Day ~38% / n≈21; Alpha ~47% / n≈168 / **~−0.3%/call** — currently slightly negative, labeled on-page "explained by drift, not edge." (The point isn't the figure; it's that the site never lets a small-sample read masquerade as edge, and sits out weak days.)
- Options-flow experiment: **NO EDGE** (self-reported).
- System self-audits every minute: model trained on **~27,750** examples, calibration healthy, audit_pass **true**, worker **pass-296** (deployed 07-07).
- **333** documented audit passes, **46** critical bugs found & fixed.
- **Scale:** hardened for thousands of concurrent clients (pass-296) — per-colo KV read caching, stale-while-revalidate quotes, sampled analytics writes (protects the brain's KV budget), visibility-gated + jittered client polling, PBKDF2 auth. Cost scales with attention, not open tabs.
