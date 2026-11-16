# Pre-registration, 2026-11-16 ~3:30 PM ET: the REVERSED short-volume hypothesis, out of sample only

H3 (PREREG-2026-11-16-short-volume.md) failed as registered: over 49 weeks the stocks with the HIGHEST abnormal
short-volume ratio beat those with the lowest, the opposite of the registered direction (spread -0.46% a week,
t -2.02; IC t -1.41; result in RESULT-2026-11-16-short-volume.md). A result found after the fact proves nothing, so it
is not claimed. A plausible mechanism exists (much of FINRA "short volume" is market makers selling into heavy buying,
so high short volume can mark demand), which makes it worth one honest test on data that does not exist yet.

## H3b, as registered here (no change after this commit)
- Construction: identical to H3 (99 large caps; abnormal ratio = mean ShortVolume/TotalVolume over the last 5 sessions
  minus the mean over the 60 sessions before; non-overlapping 5-session weeks; target = next 5-session return minus SPY).
- Direction REVERSED: long the HIGHEST abnormal-ratio quintile, short the LOWEST.
- Sample: only weeks whose rebalance session is on or after 2026-11-20 (the first Friday after this commit). The weekly
  grid is anchored on Friday closes: rebalance at a Friday close, measured to the next Friday close (holiday weeks use
  the last session of the week). Nothing before 2026-11-20 counts.
- Verdict at 26 weeks (about mid-May 2027), not before: PASS only if mean weekly spread > 0 with t >= 2.0, the IC
  (Spearman of abnormal ratio with forward relative return, same sign as the spread) has t >= 2.0, and the spread is
  > 0 after 40 bps a week. Interim numbers are published every week with "no verdict yet".
- Data: FINRA Reg SHO daily consolidated files and Yahoo daily closes (the desk's Worker). Everything is recomputed from
  public data each run, so a skipped run loses nothing and no input can be edited after the fact.
