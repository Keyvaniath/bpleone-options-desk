# Pre-registration: removing the brain's market echo (worker pass-333)

Written 2026-11-16 (evening ET), before pass-333 is deployed and before any call is made under it.

## What was found (data up to 11/16, 118 graded days, 9,024 calls)

- On 58 of 118 days the brain called 90% or more of its names the same way.
- Its daily share of UP calls has no relation to how many names rose over the next 5 days (correlation -0.02): no
  timing skill. Within a day its higher-rated names rose no more often (+0.007, standard error 0.022): no picking skill.
- Its daily share of UP calls correlates **+0.66** with the share of names that rose among the calls it made **6
  sessions earlier** (lag 3: +0.24, 4: +0.34, 5: +0.51, 7: +0.47, 8: +0.26, 10: +0.03). Calls are graded about a
  week after they are made, in the same 3-4 PM ET window as the day's new calls, and each graded call was fed to the
  model as one SGD step (learning rate 0.05) on its own error. A tick's graded calls come from one day and share one
  market week, so a week in which most names rose pushed the bias and every weight toward UP before the next calls.

## The change

The live update measures each graded call's error against the mean error of its tick's batch (at least 3 calls) and
steps on that difference. The demeaned errors sum to zero, so the bias and the inputs held constant cannot move; the
model learns only what separated names that rose from names that fell in the same week. The base rate stays where
the weekly 120-day retrain sets it. (Also in pass-333, unrelated to this test: live bar history 40 -> 60 bars, so the
50-day inputs f9/f10 are computed live as they are in training; they were 0.5 on 100% of live calls.)

## Predictions (measured with `echoByLag` in worker/src/lean.js, served at /brain/lean)

Evaluated on calls made from the first full trading day after the deploy, once 40 such days are graded
(around mid-January 2027):

1. **Primary.** The correlation at lag 6 between the daily share called UP and the share that rose in the batch
   graded just before falls below **+0.25** (from +0.66). Pass if below +0.25; fail otherwise.
2. The day-to-day swing of the share called UP shrinks: the standard deviation of the daily share called UP over the
   first 40 post-change days is below **0.338**, its value over the last 60 pre-change days (8/25 to 11/16/2026,
   population standard deviation, mean share called UP 0.568), computed on 11/16 from the live journal.
3. **Not predicted:** skill. Timing and picking skill are expected to stay at zero; this change removes a noise
   source, it does not add information. If picking skill appears it will be reported, not credited to this change,
   until it passes its own test.

The weekly retrain and the per-symbol bias layer are unchanged. Nothing about the live record's grading changes.
If the prediction fails, the result is published on the Edge Scorecard with the numbers, and the change is reviewed.
