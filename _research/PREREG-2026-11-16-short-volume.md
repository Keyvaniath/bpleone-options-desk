# Pre-registration, 2026-11-16 ~3:15 PM ET (written before any history was pulled)

Why: the nine ideas tested so far used prices, analyst ratings, insider filings and options flow; none beats drift
(see RESULT-2026-11-16-relative-brain.md and the Edge Scorecard, section 4). FINRA publishes, free, the daily short-sale
volume of every listed stock (Reg SHO consolidated file `cdn.finra.org/equity/regsho/daily/CNMSshvolYYYYMMDD.txt`:
ShortVolume and TotalVolume per symbol). Published research finds heavy short selling predicts lower returns over the
following days (Diether, Lee and Werner 2009; Boehmer, Jones and Zhang 2008). The public file also counts market-maker
shorting, which adds noise, so the honest prior is weak. One test, fixed here.

Universe and target: the same 99 large caps and the same Worker closes as H1 (cached data-2026-11-16.json). Target: the
next 5-session return minus SPY's, non-overlapping weeks (every 5th session).

## H3. Abnormal short-volume ratio
- Ratio = ShortVolume / TotalVolume per stock per day. Abnormal ratio at a rebalance day = the mean ratio over the last
  5 sessions minus the mean over the 60 sessions before those 5 (each stock against its own baseline).
- Each week, rank names by abnormal ratio; long the LOWEST quintile, short the HIGHEST.
- PASS only if all three hold: mean weekly spread > 0 with t >= 2.0; the IC (minus the Spearman correlation of
  abnormal ratio with the forward relative return) has t >= 2.0; the spread is > 0 after 40 bps a week.
- Reported but never used to pass: the same test on the raw 5-session ratio.
- No parameter search: 5 and 60 sessions and quintiles are fixed here. Days a stock is missing from the file count as
  missing; a name needs at least 50 of the 60 baseline days and 4 of the 5 recent days.

If it passes it becomes a challenger leg graded live before anything is broadcast. If it fails it joins the list.
