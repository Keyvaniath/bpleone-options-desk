# Post-deploy verification — worker pass-283

After running `.\deploy.ps1` (or `npx wrangler deploy --config wrangler.toml`),
run the checks below to confirm the three things pass-283 ships actually went live.
Baselines were measured against the **pass-280** worker (the version live before
this deploy) so the before/after is concrete.

## What pass-283 changes
1. `/brain/bars` endpoint (was 404 → real daily OHLC). Unblocks pivot-finder,
   candlestick-scanner, algo-signals, vol-term charts, breadth, correlation,
   risk-radar credit/curve, risk-parity vols, and the backtest pages.
2. **change% fix** — `prevClose` now uses the prior daily bar (was a ~6-day-stale
   `chartPreviousClose`, which inflated daily change into a multi-day move).
3. **VIX complex + treasury yields** as on-demand Yahoo caret indices
   (`VIX9D/VIX3M/VIX6M/VXN/VVIX/SKEW/TNX/IRX/FVX/TYX`) — for vol-term + risk-radar.

## One-shot probe (run from the repo root)
```
node -e '
const B="https://bpleone-brain-worker.brandonpleone.workers.dev";
const g=async p=>{try{const r=await fetch(B+p,{signal:AbortSignal.timeout(12000)});return{s:r.status,j:await r.json().catch(()=>null)};}catch(e){return{s:"ERR"};}};
(async()=>{
  const h=await g("/brain/health"); console.log("version:", h.j&&h.j.worker_version, "(expect pass-283)");
  const b=await g("/brain/bars?syms=SPY&days=5"); console.log("/brain/bars:", b.s, "(expect 200, was 404)");
  const v=await g("/brain/quotes?syms=VIX9D,SKEW,TNX"); console.log("VIX complex:", v.j&&v.j.quotes&&Object.keys(v.j.quotes).join(",")||"(none)", "(expect VIX9D,SKEW,TNX)");
  const q=await g("/brain/quotes?syms=MU,SMCI,SPY");
  for(const s of ["MU","SMCI","SPY"]){const x=q.j&&q.j.quotes&&q.j.quotes[s]; if(x) console.log(s, "changePct", x.changePct.toFixed(2)+"%");}
})();
'
```

## Expected results

| Check | pass-280 (before) | pass-283 (after deploy) |
|---|---|---|
| `worker_version` | `pass-280` | `pass-283` |
| `/brain/bars?syms=SPY` | `404` | `200` with OHLC |
| `/brain/quotes?syms=VIX9D` | empty | resolves VIX9D/SKEW/TNX |
| MU change% | `-12.05%` (stale 6-day) | ~`-1.4%` (real daily*) |
| SMCI change% | `-19.00%` (stale) | ~`-7.6%` (real daily*) |
| SPY change% | `-2.96%` (stale) | ~`-0.3%` (real daily*) |

\* the exact daily numbers move with the market; the point is they drop from the
inflated multi-day figures to the true day-over-day move. Cross-check any symbol
against Yahoo's daily chart (last close vs prior close).

## Then spot-check in the browser
Open hot-movers, vix-pulse, daily-stats, risk-radar, crypto-derivatives. Numbers
should be real (not `—`). If a converted page stays `—`, note the symbol — it
means that symbol either isn't in the worker UNIVERSE (no bars) or the quote
fetch failed; trace page → `/brain/quotes` or `/brain/bars` → `fetchYahooQuote`.
