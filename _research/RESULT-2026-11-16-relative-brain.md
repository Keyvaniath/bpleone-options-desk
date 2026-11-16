# Result, 2026-11-16 ~1:30 PM ET: both pre-registered hypotheses FAIL

Pre-registration: `PREREG-2026-11-16-relative-brain.md` (commit 173644ea, made before any data was pulled).
Run: `python _research/relative_brain_test.py` (one run; data cached in `data-2026-11-16.json`; numbers in
`RESULT-2026-11-16-relative-brain.json`). 100 of 101 names priced (MMC failed at the Worker); SPY as benchmark.

| | Statistic | Bar | Result |
|---|---|---|---|
| H1 one-week reversal vs SPY | weekly bottom-minus-top quintile spread, 49 non-overlapping weeks (2025-11-24 to 2026-11-09) | t >= 2.0, reversal IC t >= 2.0, > 0 after 40 bps | +0.35% a week, t 0.52; reversal IC +0.045, t 1.17; -0.05% after costs; 28 of 49 weeks positive. **FAIL** |
| H2 drift after the earnings reaction | signed 10-session forward return vs SPY, top/bottom reaction quintile, clustered by week | t >= 2.0, >= 20 weeks, > 0 after 40 bps | 393 reports, 158 in the extreme quintiles, 38 weeks: -0.57%, t -0.52 (top quintile -0.61%, bottom +0.77%: a slight reversal, not drift). **FAIL** |

Conclusion: no change to the brain's prediction target or features. Nine ideas tested on free data, none beats drift.
The honest next step is different data (paid: needs Brandon's approval) or keeping the live harness grading; the brain
keeps running and publishing its own record (worker pass-327 adds the daily calibration history).
Listed publicly on the Edge Scorecard, section 4.
