# Result, 2026-11-16 ~3:25 PM ET: H3 FAILS as registered (and points the other way)

Pre-registration: `PREREG-2026-11-16-short-volume.md` (commit ae7df54b, before any FINRA data was pulled).
Run: `python _research/short_volume_test.py` (one run; FINRA ratios cached in `finra-ratios-2026-11-16.json`;
numbers in `RESULT-2026-11-16-short-volume.json`). 319 FINRA daily files (2 missing), 100 names, 49 weeks
(2025-11-24 to 2026-11-09).

| | Result | Verdict |
|---|---|---|
| H3 abnormal ratio, long LOW / short HIGH (registered) | -0.46% a week, t -2.02; IC t -1.41; -0.86% after costs; 16 of 49 weeks positive | **FAIL** |
| Secondary, raw 5-session ratio (never used to pass) | -0.15% a week, t -0.49 | no signal |

The registered direction lost: heavily shorted names beat lightly shorted ones the following week. That is not
claimed as a finding (it was not the registered hypothesis). It is registered as H3b and graded only on weeks from
2026-11-20 on: `PREREG-2026-11-16-short-volume-reversed-OOS.md`.
