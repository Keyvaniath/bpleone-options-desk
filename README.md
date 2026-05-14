# bpleone / trade

A full-stack-styled, static front-end for an options and technical analysis platform — built as a working starter for bpleone.com.

## What's inside

```
bpleone-trading/
├── index.html                  Landing — hero, TOTD preview, features, perf, CTA
├── dashboard.html              Live market dashboard (charts, signals, watchlist, news, econ cal)
├── trade-of-the-day.html       Featured daily trade — thesis, TA, options plays, sizing, plan
├── options-flow.html           Unusual options activity, sweeps, blocks, IV smile, OI by strike
├── options-chain.html          Full chain with Greeks, strategy builder, P/L diagram, BS calculator
├── technical-analysis.html     Multi-indicator scanner, key levels table
├── momentum.html               Multi-lookback RS ranking, Donchian breakouts, sector rotation
├── market-internals.html       Breadth, TICK/TRIN/VIX, McClellan, P/C ratio, yield curve, dark pool
├── signals.html                Live signal feed with filters
├── fundamentals.html           Earnings, financials, valuation, ratings, ownership (per-symbol)
├── risk-dashboard.html         Portfolio Greeks, VaR, scenario, correlation, equity curve
├── backtester.html             Strategy backtest builder — equity curve, drawdown, distribution
├── education.html              Options 101, TA, Strategies, Risk, Glossary
├── about.html                  About + Pricing + FAQ + Contact + Disclosures
├── 404.html                    Themed 404 page
├── css/style.css               Full institutional dark theme + nav dropdowns
├── js/
│   ├── app.js                  Nav (with dropdowns), footer, ticker tape, clock, tabs, filters, sort, search, subscribe
│   ├── charts.js               Chart.js helpers (price+MAs, RSI, MACD, vol, sector, donut, IV, OI, perf)
│   └── live.js                 Live quote engine (Feed pub/sub), Black-Scholes/Greeks, options chain generator, strategy payoff
├── CNAME                       GitHub Pages custom domain → bpleone.com
├── robots.txt + sitemap.xml    SEO essentials
├── assets/                     (empty — drop logos here later)
└── data/                       (empty — drop JSON feeds here later)
```

### Live update engine

`js/live.js` ships a complete mock-streaming engine driving all "live" elements:

- **`Feed`** — pub/sub channel. `Feed.subscribe('NVDA', q => ...)` for per-symbol callbacks, `Feed.subscribe('*', cb)` for all quotes.
- **`QUOTES`** — live quote map keyed by symbol. Auto-mutated on each tick.
- **`startLive(ms) / pauseLive() / resumeLive()`** — control the tick interval (default 1500 ms).
- **`BS`** — Black-Scholes pricer + Greeks (delta, gamma, theta, vega, rho) + bisection IV solver.
- **`buildChain(symbol, expiries, strikesAround)`** — generates a full synthetic options chain with smile.
- **`strategyPayoff(legs, sRange)`** — computes P/L at expiration for any multi-leg strategy.
- **`[data-live="SPY:last"]`** — any element with this attribute auto-binds. Fields: `last`, `change`, `changePct`, `bid`, `ask`, `volume`. Elements flash green/red on each tick.

**To plug in real data**, replace the synthetic tick generator in `live.js` with a WebSocket subscription:
```js
const ws = new WebSocket('wss://api.polygon.io/stocks?apiKey=...');
ws.onmessage = ev => {
  const q = JSON.parse(ev.data);
  Object.assign(QUOTES[q.symbol], { last: q.price });
  computeDerived(QUOTES[q.symbol]);
  Feed.publish(q.symbol, QUOTES[q.symbol]);
};
```
Polygon, Tradier, Finnhub, Alpaca, IEX Cloud all have similar websocket shapes.

## Run locally

It's a static site. Open `index.html` in your browser, or serve the folder:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .
```

Then visit `http://localhost:8080`.

## Deploy via GitHub Pages (recommended)

1. Create a new GitHub repo (e.g. `bpleone-trading` or `bpleone.github.io`).
2. Push this folder:
   ```bash
   cd bpleone-trading
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin git@github.com:<your-user>/<repo>.git
   git push -u origin main
   ```
3. In GitHub → **Settings → Pages**: Source = `main` / `/ (root)`. Save.
4. You'll get a URL like `https://<your-user>.github.io/<repo>/`.

## Connect to your Squarespace domain (bpleone.com)

You have two options. Option A is the cleanest.

### Option A — Point the whole domain at GitHub Pages (free, fast, full control)

1. In **GitHub repo → Settings → Pages → Custom domain**, enter `bpleone.com`. Save.
2. GitHub will create a `CNAME` file in the repo.
3. In your **Squarespace domain DNS** settings (Settings → Domains → bpleone.com → DNS):
   - Add 4 `A` records on `@` pointing to:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
   - Add a `CNAME` record on `www` pointing to `<your-user>.github.io`
4. Wait 10–60 minutes for DNS to propagate, then in GitHub Pages tick **Enforce HTTPS**.
5. Done — bpleone.com now serves this site.

> **Heads up:** This replaces your existing Squarespace site. If you want to keep the Squarespace site as the marketing front, use Option B.

### Option B — Keep Squarespace, embed/link the trading platform on a subdomain

1. Deploy this site to GitHub Pages as above.
2. Create a subdomain, e.g. `trade.bpleone.com`:
   - In Squarespace DNS, add a `CNAME` record on `trade` → `<your-user>.github.io`
3. In GitHub Pages → Custom domain, enter `trade.bpleone.com`.
4. From your Squarespace navigation, add a top-nav link "Trade Desk" pointing to `https://trade.bpleone.com`.
5. (Optional) For seamless embed inside a Squarespace page, use a Code Block:
   ```html
   <iframe src="https://trade.bpleone.com" style="width:100%;height:100vh;border:0;"></iframe>
   ```
   This works but iframes carry SEO and UX limits — a subdomain link is cleaner.

## Customization checklist

| What | Where |
|------|-------|
| Logo text & brand | Look for `bpleone / trade` in `js/app.js` (`buildNav`) and the footer (`buildFooter`) |
| Color palette | `css/style.css` `:root { ... }` block at the top |
| Today's trade content | `trade-of-the-day.html` (NVDA placeholder — replace with the day's pick) |
| Ticker tape symbols | `js/app.js` `TICKER_DATA` array |
| Pricing tiers | `about.html` |
| Disclaimer / risk language | `js/app.js` `buildFooter` and `about.html` disclosures |
| Subscribe form endpoint | `js/app.js` `initSubscribe` — currently stores to `localStorage`; swap for ConvertKit, Mailchimp, Beehiiv, or your email host |

## Wiring real data later

Right now all numbers are placeholders demonstrating the layout. Plug-in points:

- **Quotes / prices** — Polygon.io, Tradier, IEX Cloud, or a websocket from your broker
- **Options chain & flow** — Unusual Whales API, CheddarFlow API, or Polygon.io options endpoints
- **Charts** — Chart.js is already wired; you can also swap to TradingView's free widget by replacing canvas blocks with `<div class="tradingview-widget-container">` blocks
- **News** — Benzinga API, Finnhub, or Marketaux
- **Economic calendar** — Trading Economics API or Investing.com scrape via a backend
- **Email capture** — point `initSubscribe` POST at your ConvertKit/Mailchimp/Beehiiv form endpoint

## SEO & analytics

- Add a `<meta name="description">` per page (already done on `index.html`)
- Add Open Graph images: put a 1200×630 PNG in `/assets/og.png` and reference it from each `<head>`
- Drop your GA4 / Plausible / Fathom snippet into a shared `<head>` include or paste into each HTML before `</head>`
- Submit a `sitemap.xml` and `robots.txt` to Google Search Console once live

## Disclaimer (legal)

This template includes risk-disclosure language in the footer and on `about.html`. Have an attorney review before public launch, especially if you charge for content. If you start charging for trade-specific advice, you may need to register as an Investment Adviser (IA) or use a publisher exemption — talk to a securities lawyer.

## License & credit

Built by Claude (Anthropic) for Brandon — no attribution required. Make it yours.
