# Pre-registration, 2026-11-16 ~1:30 PM ET (written before any data was pulled)

Why: the live brain predicts whether a stock RISES over five sessions. That target is mostly the market's own move
(45.2% of its last 3,000 graded calls rose), and on 9,186 graded calls it is right 49.0% of the time with Brier skill
-0.16; its daily calibration slope is -0.09, so it publishes NO PLAY. Every free signal tested on that target
(TA, analyst revisions, 3-month momentum, options flow, insider clusters, confluence) is at the drift null
(memory: project_bpleone_edge_findings). Two hypotheses were never tested, and both are documented effects at this
horizon on a different target or different data. If neither passes, the brain stays as it is and nothing is built.

Data: one year of daily closes per name from the desk's Worker (/brain/history: Yahoo daily), report dates from SEC
EDGAR 8-K Item 2.02 (/brain/earnings-history). Universe: ~100 liquid US large caps listed in the script, fixed before
the run; names the Worker cannot price are dropped and counted. Benchmark: SPY.

## H1. One-week reversal on a market-relative target
- Every 5th session (non-overlapping weeks), rank names by their trailing 5-session return minus SPY's.
- Forward measure: next 5-session return minus SPY's.
- Statistic: the weekly spread (bottom quintile minus top quintile, equal weight), one value per week, and the weekly
  rank IC (Spearman of trailing vs forward relative return).
- PASS only if all three hold: mean weekly spread > 0 with t >= 2.0 over the weeks; mean IC t >= 2.0; and the spread
  stays > 0 after 20 bps of round-trip cost per side per week (40 bps per week for the long-short).
- One run, no parameter search. Quintiles and 5 sessions are fixed here.
- Sign convention: reversal means a NEGATIVE raw rank correlation, so the IC tested is the reversal IC = minus the
  Spearman correlation; t >= 2.0 on that. For H2 a week with events on one side only still counts: its observation is
  the mean of +forward for top-quintile events and -forward for bottom-quintile events (quintile breakpoints over all
  events in the year).

## H2. Drift after the earnings reaction (earnings-announcement return)
- Event: an 8-K Item 2.02 report date. Reaction = the report's close-to-close move minus SPY's (amc: report-day close
  to next close; bmo/dmh: prior close to report-day close).
- Forward measure: the next 10 sessions' return minus SPY's, starting the session after the reaction close.
- Statistic: long top-quintile reactions, short bottom-quintile; events clustered by calendar week (one observation per
  week = the mean spread of that week's events) to remove earnings-season overlap.
- PASS only if: mean clustered spread > 0 with t >= 2.0, at least 20 independent weeks, and > 0 after 40 bps cost.

## What happens next
- A pass is a candidate, not an edge: it becomes a CHALLENGER leg in the Worker, graded live forward against the same
  bar (overlap-corrected), never broadcast until it earns it, and shown on the site as an experiment.
- A fail is published as a fail on the Edge Scorecard's list of tested ideas.
