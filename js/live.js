/* ===========================================
   BPLEONE TRADING - LIVE UPDATE ENGINE
   ---
   Drives "live" data across the site.
   Mock by default; swap MockFeed for a WebSocketFeed
   wired to Polygon, Tradier, Finnhub, Alpaca, etc.
   =========================================== */

// ----- Pub/sub for live data -----
const Feed = (() => {
  const subs = new Map();
  function subscribe(symbol, cb) {
    if (!subs.has(symbol)) subs.set(symbol, new Set());
    subs.get(symbol).add(cb);
    return () => subs.get(symbol)?.delete(cb);
  }
  function publish(symbol, quote) {
    if (subs.has(symbol)) subs.get(symbol).forEach(cb => { try { cb(quote); } catch (e) {} });
  }
  function symbols() { return [...subs.keys()]; }
  return { subscribe, publish, symbols };
})();
// Audit pass 76b: explicit window assignment so `window.Feed` works from
// inline scripts and modules that defensively access it through window.
// CRITICAL FIX (pass 175 — live-verified bug): the original line
// `window.QUOTES = QUOTES` was BEFORE `const QUOTES = {...}` at line 32,
// which is a Temporal Dead Zone violation — it silently throws at script
// eval time and the entire `window.QUOTES` assignment is skipped. Verified
// live: window.QUOTES was undefined even though Finnhub had populated QUOTES
// itself. window.QUOTES assignment is now moved below the const declaration.
if (typeof window !== 'undefined') { window.Feed = Feed; }

// ----- Quote model -----
// { symbol, last, bid, ask, change, changePct, volume, ts }
// Seed values updated 2026-05-15. These are placeholders only — the data-provider
// Stooq fallback overrides them with real prices on page load. Treat anything
// you see here without a live provider attached as fictional.
const QUOTES = {
  SPY:  { symbol: 'SPY',  last: 619.40, prevClose: 615.12, volume: 38_400_000 },
  QQQ:  { symbol: 'QQQ',  last: 558.20, prevClose: 552.10, volume: 27_800_000 },
  IWM:  { symbol: 'IWM',  last: 232.85, prevClose: 231.40, volume: 18_200_000 },
  DIA:  { symbol: 'DIA',  last: 452.10, prevClose: 449.85, volume: 4_100_000 },
  AAPL: { symbol: 'AAPL', last: 248.30, prevClose: 245.80, volume: 42_500_000 },
  NVDA: { symbol: 'NVDA', last: 178.45, prevClose: 174.20, volume: 248_400_000 },
  TSLA: { symbol: 'TSLA', last: 312.60, prevClose: 308.45, volume: 88_200_000 },
  MSFT: { symbol: 'MSFT', last: 482.30, prevClose: 478.90, volume: 18_700_000 },
  META: { symbol: 'META', last: 645.20, prevClose: 638.40, volume: 14_800_000 },
  AMZN: { symbol: 'AMZN', last: 238.75, prevClose: 235.60, volume: 32_400_000 },
  GOOGL:{ symbol: 'GOOGL',last: 205.40, prevClose: 203.15, volume: 28_900_000 },
  AMD:  { symbol: 'AMD',  last: 188.20, prevClose: 184.60, volume: 58_400_000 },
  BTC:  { symbol: 'BTC',  last: 96420.00, prevClose: 95180.00, volume: 12_400_000 },
  ETH:  { symbol: 'ETH',  last: 4280.50, prevClose: 4215.30, volume: 8_200_000 },
  VIX:  { symbol: 'VIX',  last: 15.20, prevClose: 15.65, volume: 0 },
  GLD:  { symbol: 'GLD',  last: 292.40, prevClose: 290.80, volume: 6_100_000 },
  TLT:  { symbol: 'TLT',  last: 89.20,  prevClose: 89.45, volume: 18_400_000 },
  USO:  { symbol: 'USO',  last: 74.60,  prevClose: 73.80, volume: 4_200_000 },
  SMCI: { symbol: 'SMCI', last: 51.40,  prevClose: 50.20, volume: 28_400_000 },
  PLTR: { symbol: 'PLTR', last: 36.80,  prevClose: 35.95, volume: 38_500_000 },
  COIN: { symbol: 'COIN', last: 285.40, prevClose: 281.20, volume: 14_200_000 },
  MARA: { symbol: 'MARA', last: 21.40,  prevClose: 21.10, volume: 18_400_000 },
  RIVN: { symbol: 'RIVN', last: 13.80,  prevClose: 13.60, volume: 22_400_000 },
  XLE:  { symbol: 'XLE',  last: 91.40,  prevClose: 92.10, volume: 12_400_000 },
  BABA: { symbol: 'BABA', last: 124.60, prevClose: 122.40, volume: 14_200_000 },
  SHOP: { symbol: 'SHOP', last: 112.40, prevClose: 110.80, volume: 8_400_000 },
  CRM:  { symbol: 'CRM',  last: 295.40, prevClose: 293.20, volume: 5_200_000 },
  UBER: { symbol: 'UBER', last: 82.40,  prevClose: 81.60, volume: 12_400_000 },
  SLV:  { symbol: 'SLV',  last: 34.20,  prevClose: 33.85, volume: 14_800_000 },
  UNG:  { symbol: 'UNG',  last: 16.40,  prevClose: 16.65, volume: 6_400_000 },
  DBA:  { symbol: 'DBA',  last: 27.40,  prevClose: 27.20, volume: 800_000 },
  // --- International indices ---
  FXI:  { symbol: 'FXI',  last: 38.20,  prevClose: 37.85, volume: 24_500_000 },     // China large-cap
  MCHI: { symbol: 'MCHI', last: 35.40,  prevClose: 35.10, volume: 4_200_000 },      // MSCI China (Brandon flagged the old $58 seed)
  EWJ:  { symbol: 'EWJ',  last: 82.40,  prevClose: 81.95, volume: 8_100_000 },      // Japan
  EWG:  { symbol: 'EWG',  last: 41.20,  prevClose: 41.00, volume: 2_400_000 },      // Germany
  EWU:  { symbol: 'EWU',  last: 41.60,  prevClose: 41.40, volume: 1_800_000 },      // UK
  INDA: { symbol: 'INDA', last: 62.40,  prevClose: 62.10, volume: 4_500_000 },      // India
  EWZ:  { symbol: 'EWZ',  last: 27.20,  prevClose: 26.95, volume: 18_400_000 },     // Brazil
  EWY:  { symbol: 'EWY',  last: 70.40,  prevClose: 70.10, volume: 3_200_000 },      // South Korea
  EWT:  { symbol: 'EWT',  last: 57.40,  prevClose: 57.00, volume: 6_400_000 },      // Taiwan
  EEM:  { symbol: 'EEM',  last: 49.40,  prevClose: 49.10, volume: 38_400_000 },     // Emerging
  EFA:  { symbol: 'EFA',  last: 92.40,  prevClose: 92.10, volume: 12_400_000 },     // Developed ex-US
  VEA:  { symbol: 'VEA',  last: 61.40,  prevClose: 61.20, volume: 11_200_000 },     // Vanguard developed
  VWO:  { symbol: 'VWO',  last: 53.40,  prevClose: 53.15, volume: 8_400_000 },      // Vanguard emerging
  // --- Forex proxies ---
  UUP:  { symbol: 'UUP',  last: 28.92,  prevClose: 29.04, volume: 4_200_000 },      // Dollar bullish
  FXE:  { symbol: 'FXE',  last: 100.42, prevClose: 100.18, volume: 320_000 },       // Euro
  FXY:  { symbol: 'FXY',  last: 62.18,  prevClose: 62.45, volume: 480_000 },        // Yen
  FXB:  { symbol: 'FXB',  last: 124.18, prevClose: 123.94, volume: 120_000 },       // British pound
  FXC:  { symbol: 'FXC',  last: 71.42,  prevClose: 71.28, volume: 240_000 },        // Canadian dollar
  FXA:  { symbol: 'FXA',  last: 64.18,  prevClose: 64.34, volume: 180_000 },        // Australian dollar
  FXF:  { symbol: 'FXF',  last: 108.92, prevClose: 108.74, volume: 120_000 },       // Swiss franc
  // --- Treasuries / credit ---
  SHY:  { symbol: 'SHY',  last: 82.18,  prevClose: 82.14, volume: 6_400_000 },      // 1-3y treasury
  IEF:  { symbol: 'IEF',  last: 96.42,  prevClose: 96.55, volume: 12_800_000 },     // 7-10y
  TBT:  { symbol: 'TBT',  last: 28.45,  prevClose: 28.61, volume: 4_200_000 },      // 2x inverse 20+y
  HYG:  { symbol: 'HYG',  last: 80.42,  prevClose: 80.31, volume: 28_400_000 },     // High-yield bonds
  LQD:  { symbol: 'LQD',  last: 110.18, prevClose: 109.92, volume: 12_400_000 },    // Investment grade
  TIP:  { symbol: 'TIP',  last: 110.42, prevClose: 110.27, volume: 4_800_000 },     // Inflation-protected
  // --- Volatility ---
  VXX:  { symbol: 'VXX',  last: 42.18,  prevClose: 43.51, volume: 28_400_000 },     // VIX short-term
  UVXY: { symbol: 'UVXY', last: 18.42,  prevClose: 19.21, volume: 38_400_000 },     // 2x VIX short-term
  // --- Real estate ---
  VNQ:  { symbol: 'VNQ',  last: 92.18,  prevClose: 91.94, volume: 4_200_000 },      // Real estate
  // --- Pass 69 expansion: cover the new bootstrap/auto-trainer universe ---
  NFLX: { symbol: 'NFLX', last: 980.40, prevClose: 972.50, volume: 4_800_000 },
  ORCL: { symbol: 'ORCL', last: 178.60, prevClose: 176.80, volume: 12_200_000 },
  AVGO: { symbol: 'AVGO', last: 245.30, prevClose: 242.10, volume: 18_400_000 },
  MU:   { symbol: 'MU',   last: 104.50, prevClose: 103.20, volume: 22_400_000 },
  JPM:  { symbol: 'JPM',  last: 260.40, prevClose: 258.90, volume: 9_800_000 },
  BAC:  { symbol: 'BAC',  last: 48.20,  prevClose: 47.80, volume: 38_200_000 },
  GS:   { symbol: 'GS',   last: 610.40, prevClose: 605.20, volume: 1_800_000 },
  XLF:  { symbol: 'XLF',  last: 52.40,  prevClose: 52.10, volume: 28_400_000 },
  XLK:  { symbol: 'XLK',  last: 245.80, prevClose: 243.20, volume: 4_800_000 },
  XLV:  { symbol: 'XLV',  last: 152.40, prevClose: 151.80, volume: 6_200_000 },
  XLY:  { symbol: 'XLY',  last: 218.40, prevClose: 216.80, volume: 4_400_000 },
  XLP:  { symbol: 'XLP',  last: 82.60,  prevClose: 82.40, volume: 8_200_000 },
  XLI:  { symbol: 'XLI',  last: 142.80, prevClose: 141.90, volume: 11_400_000 },
  XLU:  { symbol: 'XLU',  last: 80.20,  prevClose: 79.95, volume: 14_200_000 }
};
// Pass 175: window.QUOTES assignment moved here (AFTER the const declaration)
// so it doesn't hit TDZ. Without this, every module that defensively reads
// window.QUOTES gets undefined.
if (typeof window !== 'undefined') { window.QUOTES = QUOTES; }

function computeDerived(q) {
  q.change = q.last - q.prevClose;
  q.changePct = (q.change / q.prevClose) * 100;
  q.bid = +(q.last - 0.01).toFixed(2);
  q.ask = +(q.last + 0.01).toFixed(2);
  q.ts = Date.now();
  return q;
}
// CRITICAL: every quote starts as stale-seed (not real). priceSource flips to
// 'stooq' or 'finnhub' / etc. once the live provider returns a real value for
// that symbol. UI code that displays prices MUST check this — never render a
// stale-seed value as if it were real, never let TOTD score a symbol whose
// last update is from the seed.
Object.values(QUOTES).forEach(q => {
  computeDerived(q);
  q.priceSource = 'stale-seed';
  q.liveAt = 0;  // ms epoch of last real update
});

// ----- Mock tick engine -----
// Vol is roughly realistic: index-like ~0.2bp/sec, equities ~1bp/sec
const TICK_VOL = {
  SPY: 0.00010, QQQ: 0.00012, IWM: 0.00014, DIA: 0.00009, GLD: 0.00010, TLT: 0.00011, USO: 0.00018,
  VIX: 0.00060,
  AAPL: 0.00018, NVDA: 0.00032, TSLA: 0.00038, MSFT: 0.00018, META: 0.00022, AMZN: 0.00018, GOOGL: 0.00018, AMD: 0.00030,
  BTC: 0.00060, ETH: 0.00065,
  SMCI: 0.00065, PLTR: 0.00060, COIN: 0.00055, MARA: 0.00080, RIVN: 0.00075, XLE: 0.00018,
  BABA: 0.00035, SHOP: 0.00030, CRM: 0.00018, UBER: 0.00028
};

let TICK_ENABLED = true;
let TICK_INTERVAL = null;

// Pass 239 (NO FAKE NUMBERS): demo mode is OFF by default. The site shows ONLY
// real prices (Stooq ~15min-delayed equities + Coinbase real-time crypto +
// worker/Yahoo). Between real polls the price holds at its last REAL value —
// that's honest (it's the last known delayed price), not a fabricated walk.
// The Ornstein-Uhlenbeck simulator below only runs when a user explicitly opts
// into demo mode (localStorage bpleone_demo_mode='1'), e.g. for screenshots on
// a closed market. It is NEVER the default on a customer-facing page.
function isDemoMode() {
  try { return localStorage.getItem('bpleone_demo_mode') === '1'; } catch (e) { return false; }
}

function tickOnce() {
  if (!TICK_ENABLED) return;
  if (!isDemoMode()) return;  // pass 239: no synthetic ticks unless demo mode
  Object.values(QUOTES).forEach(q => {
    // Pass 239: even in demo mode, NEVER overwrite a symbol that has a real
    // price (liveAt > 0). Only simulate symbols a real feed hasn't reached yet.
    if (q.liveAt && q.liveAt > 0) return;
    const vol = TICK_VOL[q.symbol] || 0.0002;
    // OU-ish mean-revert lightly toward last "open" (here: prevClose * 1.0)
    const drift = ((q.prevClose * 1.001) - q.last) / q.last * 0.04;
    const shock = (Math.random() - 0.5) * vol * 2;
    const newLast = q.last * (1 + drift + shock);
    q.last = +Math.max(0.01, newLast).toFixed(2);
    computeDerived(q);
    q.priceSource = 'demo-sim';  // never masquerade as real
    Feed.publish(q.symbol, q);
  });
  Feed.publish('*', QUOTES);
}

function startLive(intervalMs = 1500) {
  if (TICK_INTERVAL) clearInterval(TICK_INTERVAL);
  TICK_INTERVAL = setInterval(tickOnce, intervalMs);
}

function stopLive() {
  TICK_ENABLED = false;
  if (TICK_INTERVAL) clearInterval(TICK_INTERVAL);
}

function pauseLive() { TICK_ENABLED = false; }
function resumeLive() { TICK_ENABLED = true; }

// ----- DOM binding helpers -----
// data-live="SPY:last"    binds the latest price for SPY
// data-live="SPY:change"  binds the change
// data-live="SPY:changePct" binds the percent change
// data-live="SPY:bid" / :ask / :volume
function bindLive() {
  document.querySelectorAll('[data-live]').forEach(el => {
    const [sym, field] = el.dataset.live.split(':');
    const fmt = el.dataset.fmt || (field === 'changePct' ? 'pct' : field === 'change' ? 'signed' : 'num');
    const update = q => {
      let val;
      switch (field) {
        case 'last': val = q.last; break;
        case 'change': val = q.change; break;
        case 'changePct': val = q.changePct; break;
        case 'bid': val = q.bid; break;
        case 'ask': val = q.ask; break;
        case 'volume': val = q.volume; break;
        default: val = q.last;
      }
      const prev = parseFloat(el.dataset.prev || 'NaN');
      el.dataset.prev = val;
      let txt;
      if (fmt === 'pct') txt = (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
      else if (fmt === 'signed') txt = (val >= 0 ? '+' : '') + val.toFixed(2);
      else if (fmt === 'volume') txt = val >= 1_000_000 ? (val/1_000_000).toFixed(1) + 'M' : (val/1000).toFixed(0) + 'k';
      else txt = '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      el.textContent = txt;
      // color classes for change-style fields
      if (field === 'change' || field === 'changePct') {
        el.classList.toggle('green-text', val >= 0);
        el.classList.toggle('red-text', val < 0);
      }
      // flash on change
      if (!isNaN(prev) && prev !== val) {
        el.style.transition = 'background-color 0.4s ease';
        el.style.backgroundColor = val > prev ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)';
        setTimeout(() => { el.style.backgroundColor = 'transparent'; }, 400);
      }
    };
    if (QUOTES[sym]) update(QUOTES[sym]);
    Feed.subscribe(sym, update);
  });
}

// ----- Black-Scholes / Greeks -----
// Inputs: S (spot), K (strike), T (years to expiry), r (risk-free), sigma (vol), q (div yield)
const BS = (() => {
  function erf(x) {
    // Abramowitz & Stegun 7.1.26
    const sign = Math.sign(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    x = Math.abs(x);
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t * Math.exp(-x*x);
    return sign * y;
  }
  function N(x) { return 0.5 * (1 + erf(x / Math.sqrt(2))); }
  function n(x) { return Math.exp(-x*x/2) / Math.sqrt(2 * Math.PI); }

  function d1(S, K, T, r, sigma, q=0) {
    return (Math.log(S/K) + (r - q + sigma*sigma/2) * T) / (sigma * Math.sqrt(T));
  }
  function d2(S, K, T, r, sigma, q=0) { return d1(S,K,T,r,sigma,q) - sigma * Math.sqrt(T); }

  function price(type, S, K, T, r, sigma, q=0) {
    if (T <= 0) return Math.max(0, type === 'call' ? S - K : K - S);
    const _d1 = d1(S, K, T, r, sigma, q);
    const _d2 = d2(S, K, T, r, sigma, q);
    if (type === 'call') return S * Math.exp(-q*T) * N(_d1) - K * Math.exp(-r*T) * N(_d2);
    return K * Math.exp(-r*T) * N(-_d2) - S * Math.exp(-q*T) * N(-_d1);
  }

  function greeks(type, S, K, T, r, sigma, q=0) {
    if (T <= 0) T = 1/365;
    const _d1 = d1(S, K, T, r, sigma, q);
    const _d2 = d2(S, K, T, r, sigma, q);
    const callDelta = Math.exp(-q*T) * N(_d1);
    const putDelta = callDelta - Math.exp(-q*T);
    const delta = type === 'call' ? callDelta : putDelta;
    const gamma = Math.exp(-q*T) * n(_d1) / (S * sigma * Math.sqrt(T));
    const vega = S * Math.exp(-q*T) * n(_d1) * Math.sqrt(T) / 100; // per 1 IV point
    const thetaC = (-S*Math.exp(-q*T)*n(_d1)*sigma/(2*Math.sqrt(T)) - r*K*Math.exp(-r*T)*N(_d2) + q*S*Math.exp(-q*T)*N(_d1));
    const thetaP = (-S*Math.exp(-q*T)*n(_d1)*sigma/(2*Math.sqrt(T)) + r*K*Math.exp(-r*T)*N(-_d2) - q*S*Math.exp(-q*T)*N(-_d1));
    const theta = (type === 'call' ? thetaC : thetaP) / 365; // per day
    const rho = type === 'call'
      ? K*T*Math.exp(-r*T)*N(_d2)/100
      : -K*T*Math.exp(-r*T)*N(-_d2)/100;
    return { delta, gamma, vega, theta, rho };
  }

  // Bisection IV solver
  function impliedVol(type, S, K, T, r, marketPrice, q=0) {
    let lo = 0.001, hi = 5, mid;
    for (let i = 0; i < 60; i++) {
      mid = (lo + hi) / 2;
      const p = price(type, S, K, T, r, mid, q);
      if (Math.abs(p - marketPrice) < 0.0005) return mid;
      if (p < marketPrice) lo = mid; else hi = mid;
    }
    return mid;
  }

  return { price, greeks, impliedVol, d1, d2 };
})();
// Audit pass 76b: site-diagnostics.html and other callers reference window.BS
// for Black-Scholes utilities. Top-level `const BS` doesn't auto-attach.
if (typeof window !== 'undefined') window.BS = BS;

// ----- Generate a synthetic options chain -----
function buildChain(symbol, expiries = [7, 21, 38, 65, 100], strikesAround = 12, strikeStep = null) {
  const q = QUOTES[symbol];
  if (!q) return [];
  const S = q.last;
  const r = 0.045;
  // step = ~1% of spot rounded
  const step = strikeStep || (S < 50 ? 1 : S < 200 ? 2.5 : S < 500 ? 5 : 10);
  const baseIV = ({ SPY:0.14, QQQ:0.18, IWM:0.21, VIX:0.85, NVDA:0.42, TSLA:0.55, AAPL:0.28, MSFT:0.24, META:0.32, AMD:0.45, BTC:0.65, ETH:0.70, AMZN:0.30, GOOGL:0.28, SMCI:0.78, PLTR:0.62, COIN:0.70 })[symbol] || 0.35;
  const chains = [];
  expiries.forEach(dte => {
    const T = dte / 365;
    const strikes = [];
    for (let i = -strikesAround; i <= strikesAround; i++) {
      const K = +(Math.round((S + i * step) / step) * step).toFixed(2);
      // smile: increases away from ATM
      const m = Math.log(K/S);
      const iv = +(baseIV * (1 + 0.6 * Math.abs(m) + 0.25 * m * m)).toFixed(4);
      const call = BS.price('call', S, K, T, r, iv);
      const put = BS.price('put', S, K, T, r, iv);
      const gC = BS.greeks('call', S, K, T, r, iv);
      const gP = BS.greeks('put', S, K, T, r, iv);
      // synthetic volume/OI heavier near ATM
      const distOI = Math.exp(-Math.pow((K-S)/S, 2) * 50);
      strikes.push({
        strike: K,
        callBid: +Math.max(0.01, call - 0.05).toFixed(2),
        callAsk: +(call + 0.05).toFixed(2),
        callMid: +call.toFixed(2),
        callVol: Math.round(distOI * 4000 * (0.5 + Math.random())),
        callOI: Math.round(distOI * 22000 * (0.5 + Math.random())),
        callIV: +(iv * 100).toFixed(1),
        callDelta: +gC.delta.toFixed(3),
        callGamma: +gC.gamma.toFixed(4),
        callTheta: +gC.theta.toFixed(3),
        callVega: +gC.vega.toFixed(3),
        putBid: +Math.max(0.01, put - 0.05).toFixed(2),
        putAsk: +(put + 0.05).toFixed(2),
        putMid: +put.toFixed(2),
        putVol: Math.round(distOI * 3200 * (0.5 + Math.random())),
        putOI: Math.round(distOI * 18000 * (0.5 + Math.random())),
        putIV: +(iv * 100).toFixed(1),
        putDelta: +gP.delta.toFixed(3),
        putGamma: +gP.gamma.toFixed(4),
        putTheta: +gP.theta.toFixed(3),
        putVega: +gP.vega.toFixed(3)
      });
    }
    chains.push({ dte, expiry: new Date(Date.now() + dte * 86400000).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }), strikes });
  });
  return chains;
}

// ----- Strategy payoff at expiration -----
function strategyPayoff(legs, sRange) {
  // legs: [{ type: 'call'|'put'|'stock', side: 'long'|'short', strike, premium, qty }]
  return sRange.map(S => {
    let total = 0;
    legs.forEach(leg => {
      const mult = (leg.side === 'long' ? 1 : -1) * (leg.qty || 1);
      if (leg.type === 'stock') total += (S - leg.entry) * mult;
      else if (leg.type === 'call') total += (Math.max(0, S - leg.strike) - leg.premium) * mult;
      else if (leg.type === 'put') total += (Math.max(0, leg.strike - S) - leg.premium) * mult;
    });
    return { S, pnl: +total.toFixed(2) };
  });
}

// ----- Data-mode tracking -----
// Critical: tells the brain whether prices are real or synthetic.
// Mock = OU random-walk drift from a (possibly stale) seed.
// Live = real ticks from a configured data provider.
// The ML trainer SKIPS findings tagged as mock to avoid poisoning the model.
window.BPLEONE_DATA_MODE = 'mock';
window.BPLEONE_DATA_SEEDED_AT = '2026-05-15';  // seed date for the QUOTES table — anything older is stale

function setDataMode(mode) {
  window.BPLEONE_DATA_MODE = mode;
  try { window.dispatchEvent(new CustomEvent('bpleone:data-mode', { detail: { mode } })); } catch (e) {}
}

// Lazy-load the auto-trainer (daily bar refresh) and the continuous-learner
// (every-page-load capture + resolve loop). Both run in the background after
// first paint so they never block the UI.
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    try {
      // Data Reliability MUST load FIRST — it validates every price tick before
      // it reaches QUOTES. Without it, applyTrade silently allows garbage data.
      if (!document.querySelector('script[src*="data-reliability.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/data-reliability.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Pass 239: PRIMARY real-price feed — pulls live Yahoo-sourced quotes from
      // our worker (the same data the brain uses). Loaded early so real prices
      // replace the stale seeds fast and the OU walk never has to run.
      if (!document.querySelector('script[src*="worker-quotes.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/worker-quotes.js';
        s.async = true;
        document.head.appendChild(s);
      }
      // Pass 240: customer auth client — renders the Log in / Account pill on
      // every page and validates the session against the worker.
      if (!document.querySelector('script[src*="js/auth.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/auth.js';
        s.async = true;
        document.head.appendChild(s);
      }
      // Pass 242: sample-data honesty banner — stamps an "illustrative, not live"
      // notice on the handful of pages that simulate paid-feed data.
      if (!document.querySelector('script[src*="sample-data-banner.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/sample-data-banner.js?v=v184';
        s.async = true;
        document.head.appendChild(s);
      }
      // Cross-source price agreement check — logs when 2+ sources disagree
      // on the same symbol within 60s. Catches cases where individual ticks
      // pass validation but ONE source is silently wrong.
      if (!document.querySelector('script[src*="cross-source-check.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/cross-source-check.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Smart Source Preference — when multiple sources have a fresh price for
      // the same symbol, pick the highest-quality one as canonical. Must load
      // before stale-refresh so that module's writes also consult it.
      if (!document.querySelector('script[src*="source-preference.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/source-preference.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Stale-symbol auto-refresh — proactively fetches when DataReliability
      // flags a symbol as stale. Closes the gap between 12s poll cycles.
      if (!document.querySelector('script[src*="stale-refresh.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/stale-refresh.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Confidence-Scaled Kelly — sizing math for actual money-making.
      if (!document.querySelector('script[src*="confidence-kelly.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/confidence-kelly.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Multi-position Portfolio Allocator — diversification + correlation budget.
      if (!document.querySelector('script[src*="portfolio-allocator.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/portfolio-allocator.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Money Tracker — simulated cumulative P&L from brain signals (7/30/90/lifetime).
      if (!document.querySelector('script[src*="money-tracker.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/money-tracker.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Journal Repair — one-shot idempotent migrations that fix past
      // corruption from audit-discovered bugs (e.g. pass 119 feature[20]
      // timezone fix). Runs at most once per migration-version per browser.
      if (!document.querySelector('script[src*="journal-repair.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/journal-repair.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Demo Data Generator — lets users populate empty pages with synthetic
      // resolved trades so the brain UI doesn't read empty for 24+ hours.
      if (!document.querySelector('script[src*="demo-data.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/demo-data.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Demo FAB — gated behind demo mode (pass 239). Versioned src so returning
      // users get the GATED build instead of a stale-cached ungated copy.
      if (!document.querySelector('script[src*="demo-fab.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/demo-fab.js?v=v180';
        s.async = true;
        document.head.appendChild(s);
      }
      // Seed Detector — dims any data-live element whose QUOTES symbol
      // hasn't been touched by a live source (seed-only). Tooltip shows source.
      if (!document.querySelector('script[src*="seed-detector.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/seed-detector.js';
        s.async = true;
        document.head.appendChild(s);
      }
      // Auto-Trade closed loop — opens paper trades on high-conviction brain signals.
      // Off by default; user must enable on auto-trade.html. Auto-loads here so
      // the 15s polling can run from any page once the user has flipped the toggle.
      if (!document.querySelector('script[src*="auto-trade.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/auto-trade.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // High-Conviction Alerts — fires browser push notification + logs to feed
      // when brain crosses ≥75% conviction. Default ON. User mutes via the page.
      if (!document.querySelector('script[src*="high-conviction-alerts.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/high-conviction-alerts.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Voice Coach — speaks high-conviction signals via Web Speech API.
      // Off by default (autoplay rules); user opts in on voice-coach.html.
      if (!document.querySelector('script[src*="voice-coach.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/voice-coach.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Webhook Bridge — POSTs alerts to Discord/Slack/generic endpoint.
      if (!document.querySelector('script[src*="webhook-bridge.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/webhook-bridge.js?v=v178';
        s.async = false;
        document.head.appendChild(s);
      }
      // Worker Bridge (pass 180) — talks to Cloudflare Worker for 24/7 brain state.
      if (!document.querySelector('script[src*="worker-bridge.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/worker-bridge.js?v=v178';
        s.async = false;
        document.head.appendChild(s);
      }
      // Money Hotkeys — vim-style g+letter shortcuts. Available site-wide.
      if (!document.querySelector('script[src*="money-hotkeys.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/money-hotkeys.js';
        s.async = true;
        document.head.appendChild(s);
      }
      // Auto-Watchlist — auto-promotes alerted symbols to a curated list.
      if (!document.querySelector('script[src*="auto-watchlist.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/auto-watchlist.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Loss Cool-Off — auto-disables AutoTrade after N consec losses.
      if (!document.querySelector('script[src*="loss-cooloff.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/loss-cooloff.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Sound Synth — Web Audio beeps for alerts. Off by default.
      if (!document.querySelector('script[src*="sound-synth.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/sound-synth.js';
        s.async = true;
        document.head.appendChild(s);
      }
      // Equity Drawdown Protector — master kill-switch on portfolio DD.
      if (!document.querySelector('script[src*="equity-protector.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/equity-protector.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Multi-horizon ensemble MUST load before continuous-learner so the
      // learner can call MultiHorizon.* immediately on first capture.
      if (!document.querySelector('script[src*="multi-horizon.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/multi-horizon.js';
        s.async = false;  // synchronous so it loads before continuous-learner
        document.head.appendChild(s);
      }
      // Calibrator: Platt-scaling probability mapper. Loads before
      // continuous-learner so it can record every resolved pair.
      if (!document.querySelector('script[src*="calibrator.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/calibrator.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Outlier detector: maintains running feature stats, flags OOD inputs.
      if (!document.querySelector('script[src*="outlier-detector.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/outlier-detector.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Trade selectivity: meta-classifier ('should I trade today?').
      if (!document.querySelector('script[src*="trade-selectivity.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/trade-selectivity.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // PSI drift detector: leading-indicator distribution shift via
      // Population Stability Index. Auto-fires concept-drift event.
      if (!document.querySelector('script[src*="drift-psi.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/drift-psi.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Feature importance: auto-prunes low-alpha features by reducing
      // their per-feature learning rate. Reads alpha map, exposes
      // window.FeatureImportance.lrMultiplier(i) for Model.train.
      if (!document.querySelector('script[src*="feature-importance.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/feature-importance.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Bayesian uncertainty (MC dropout) for confidence intervals on
      // every prediction. Used by brain-bet for size adjustment.
      if (!document.querySelector('script[src*="bayesian-dropout.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/bayesian-dropout.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Symbol bias: per-symbol learned offset (mixed-effects).
      // Fed by continuous-learner on every resolution.
      if (!document.querySelector('script[src*="symbol-bias.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/symbol-bias.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Bootstrap ensemble: K=5 separately-trained models via online
      // bagging for rigorous uncertainty estimates.
      if (!document.querySelector('script[src*="bootstrap-ensemble.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/bootstrap-ensemble.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Ensemble agreement: combines multi-horizon + bootstrap + dropout
      // into a single composite agreement score for confidence sizing.
      if (!document.querySelector('script[src*="ensemble-agreement.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/ensemble-agreement.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // k-NN recall: non-parametric memory. Finds similar past
      // resolutions and blends their outcomes into predictions.
      if (!document.querySelector('script[src*="knn-recall.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/knn-recall.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Conformal prediction: distribution-free prediction intervals with
      // rigorous coverage guarantees. Records (predicted, actual) pairs from
      // continuous-learner and produces guaranteed-coverage intervals.
      if (!document.querySelector('script[src*="conformal.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/conformal.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // SWA: Stochastic Weight Averaging. Auto-snapshots weights into a
      // running average every 60s; the average sits in a flatter minimum
      // and generalizes better than the latest weights.
      if (!document.querySelector('script[src*="swa.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/swa.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Meta-Stacker: learns optimal blend weights for the 5 base learners
      // from resolved (basePreds, win/loss) pairs. Replaces hard-coded blend.
      if (!document.querySelector('script[src*="meta-stacker.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/meta-stacker.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Per-symbol Meta-Stacker: same idea but separate weights per symbol.
      // Falls back to global MetaStacker when a symbol hasn't trained yet.
      if (!document.querySelector('script[src*="per-symbol-meta-stacker.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/per-symbol-meta-stacker.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Self-Distillation: optional opt-in knowledge distillation using SWA
      // as the teacher. After each training step, do one extra step toward
      // (α × teacher_prediction + (1-α) × hard_label). Regularizer.
      if (!document.querySelector('script[src*="self-distillation.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/self-distillation.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Counterfactual replay: perturbs features ±10% and measures prediction
      // robustness. Brittle predictions are flagged for review.
      if (!document.querySelector('script[src*="counterfactual-replay.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/counterfactual-replay.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Daily auto-summary card: snapshots brain state at market close.
      if (!document.querySelector('script[src*="daily-card.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/daily-card.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Brain snapshot export/import for backup + migration.
      if (!document.querySelector('script[src*="brain-snapshot.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/brain-snapshot.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Mixup augmentation: synthetic training examples by interpolating pairs.
      if (!document.querySelector('script[src*="mixup.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/mixup.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Regime-Stratified Calibrator: separate Platt scalers per market
      // regime (bull/bear/chop/high-vol/mixed) so calibration adapts to
      // current conditions instead of averaging across regimes.
      if (!document.querySelector('script[src*="regime-calibrator.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/regime-calibrator.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Active Learning: uncertainty-weighted training. Examples the model
      // was uncertain about get larger sample weights when they resolve.
      if (!document.querySelector('script[src*="active-learning.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/active-learning.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Module Attribution: tracks per-module accuracy / Brier / log-loss
      // for the 5 base learners on every resolution.
      if (!document.querySelector('script[src*="module-attribution.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/module-attribution.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Hourly performance: stratifies accuracy by time-of-day bucket
      // (open / mid-am / lunch / mid-pm / close). The UnifiedPredictor
      // size multiplier consults this to grow/shrink positions by hour.
      if (!document.querySelector('script[src*="hourly-perf.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/hourly-perf.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Drawdown protector: tracks recent win/loss streak, shrinks size
      // after losing streaks (tilt protection) or long winning streaks
      // (anti-overconfidence).
      if (!document.querySelector('script[src*="drawdown-protector.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/drawdown-protector.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Adversarial validator: detects covariate shift (input distribution
      // drift). Trains a tiny classifier to distinguish old-vs-recent
      // feature vectors. When shifted, predictions are scaled toward 0.5.
      if (!document.querySelector('script[src*="adversarial-validator.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/adversarial-validator.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Adaptive LR: dynamically adjusts model.lr based on loss-slope.
      // Rising loss → LR up (adapt faster), falling loss → LR down (fine-tune).
      if (!document.querySelector('script[src*="adaptive-lr.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/adaptive-lr.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Brier Skill Score: the single most diagnostic number for "is the
      // brain actually learning?" — 1 - BS_model / BS_baseline.
      if (!document.querySelector('script[src*="brier-skill.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/brier-skill.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Sharpe Tracker: realized signed-return of directional predictions.
      // Annualized Sharpe is the bottom-line "is this making money?" metric.
      if (!document.querySelector('script[src*="sharpe-tracker.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/sharpe-tracker.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Setup Tracker: stratifies accuracy by setup-type (bull/bear/momentum/
      // reversion/breakout) extracted from the feature vector's one-hot flags.
      if (!document.querySelector('script[src*="setup-tracker.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/setup-tracker.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Label Smoothing: trains on y=0.025/0.975 instead of 0/1 to prevent
      // overconfidence. Load early so model.js training calls pick it up.
      if (!document.querySelector('script[src*="label-smoothing.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/label-smoothing.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Day-of-week performance: stratifies accuracy by weekday (ET).
      if (!document.querySelector('script[src*="dow-perf.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/dow-perf.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Sample age decay: exponential decay of training-example weight by
      // age. Half-life 7 days by default — recent examples dominate training.
      if (!document.querySelector('script[src*="sample-decay.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/sample-decay.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Hindsight replay: hard-negative mining. Confidently-wrong predictions
      // are saved + replayed with 3x weight to amplify the correction.
      if (!document.querySelector('script[src*="hindsight-replay.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/hindsight-replay.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Confidence penalty: entropy regularization. Disabled by default
      // but available as a knob to push model away from peaked outputs.
      if (!document.querySelector('script[src*="confidence-penalty.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/confidence-penalty.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Trade Trust Score: aggregates ALL diagnostic signals into a single
      // 0-100 trust rating for any current prediction. Pure computation.
      if (!document.querySelector('script[src*="trade-trust-score.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/trade-trust-score.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Auto-Pause circuit breaker: when TradeTrust drops below 40, auto-
      // pause new trade ideas. Hysteresis: requires 60+ to fully resume.
      if (!document.querySelector('script[src*="auto-pause.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/auto-pause.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Isotonic calibrator: non-parametric calibration via Pool Adjacent
      // Violators. Complements Platt and regime-Platt with a more flexible
      // monotonic mapping.
      if (!document.querySelector('script[src*="isotonic-calibrator.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/isotonic-calibrator.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Per-symbol Brier Skill: stratifies BSS by symbol so the brain knows
      // which symbols it has real edge on.
      if (!document.querySelector('script[src*="symbol-skill.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/symbol-skill.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Per-symbol Sharpe: stratifies risk-adjusted return per symbol.
      // Shows which symbols actually MADE money (not just statistically
      // beat the baseline).
      if (!document.querySelector('script[src*="symbol-sharpe.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/symbol-sharpe.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Per-sector performance: aggregates symbols into sectors (semi /
      // mega-tech / index / energy / etc) for a higher-level edge view.
      if (!document.querySelector('script[src*="sector-perf.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/sector-perf.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Reliability diagram: bins (predicted, actual) pairs for the
      // gold-standard calibration curve + Expected Calibration Error.
      if (!document.querySelector('script[src*="reliability-diagram.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/reliability-diagram.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Brain Coach: synthesizes all 30+ diagnostic modules into a plain-
      // English headline + diagnosis + advice. Pure computation.
      if (!document.querySelector('script[src*="brain-coach.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/brain-coach.js?v=v188';  // versioned so module fixes reach returning users (was un-versioned -> cached forever)
        s.async = false;
        document.head.appendChild(s);
      }
      // Volume + latency tracker: 'is the brain actually running?' diagnostic.
      // Counts predictions/hour and tracks resolution latency distribution.
      if (!document.querySelector('script[src*="volume-tracker.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/volume-tracker.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Prediction histogram: distribution of predicted probabilities.
      // Diagnostic for 'is the brain differentiating between trades?'
      if (!document.querySelector('script[src*="prediction-histogram.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/prediction-histogram.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Unified predictor: chains every meta-module into ONE call.
      // Loads last so all dependencies are present.
      if (!document.querySelector('script[src*="unified-predictor.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/unified-predictor.js';
        s.async = false;
        document.head.appendChild(s);
      }
      // Conviction alerter: background notification when A-tier picks fire.
      if (!document.querySelector('script[src*="conviction-alerter.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/conviction-alerter.js';
        s.async = false;
        document.head.appendChild(s);
      }
      if (!document.querySelector('script[src*="auto-trainer.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/auto-trainer.js';
        s.async = true;
        document.head.appendChild(s);
      }
      if (!document.querySelector('script[src*="continuous-learner.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/continuous-learner.js';
        s.async = true;
        document.head.appendChild(s);
      }
      // Historical Bootstrap: pulls 60 days of Stooq bars on first visit
      // and pre-trains the model + calibrators + BSS + Sharpe so the brain
      // doesn't start at zero. Auto-triggers 8s after load if not yet run.
      // Loaded LAST so all brain modules are present when it runs.
      if (!document.querySelector('script[src*="historical-bootstrap.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/historical-bootstrap.js';
        s.async = true;
        document.head.appendChild(s);
      }
      // Weekly refresh — re-runs the historical bootstrap once per 7 days
      // so the model is always training on the most recent 60 days of bars.
      // Loaded after historical-bootstrap so the dependency exists.
      if (!document.querySelector('script[src*="weekly-refresh.js"]')) {
        const s = document.createElement('script');
        s.src = 'js/weekly-refresh.js';
        s.async = true;
        document.head.appendChild(s);
      }
    } catch (e) {}
  }, 5000);
});

// ----- Auto-start when ready -----
// If DataProvider is configured with a real provider, it will pause the mock
// engine and stream real quotes. Otherwise the OU random walk drives the site.
document.addEventListener('DOMContentLoaded', () => {
  bindLive();
  // Pass 239 (NO FAKE NUMBERS): always boot the real data layer (DataProvider
  // starts the Stooq + Coinbase + worker live feeds). The synthetic OU walk
  // runs ONLY if the user explicitly enabled demo mode — never by default.
  if (typeof DataProvider !== 'undefined') {
    try { DataProvider.init(); } catch (e) {}
  }
  const demo = isDemoMode();
  setDataMode(demo ? 'demo' : 'live');
  if (demo) startLive(1500);
  // Pass 243 (CRITICAL — "data not live"): EAGER-load the real-price feed
  // IMMEDIATELY, not in the 5-second lazy block below. The 5s delay meant
  // custom one-time renders (e.g. morning-brief's pulse) painted seed values
  // and never saw the real worker-yahoo prices that landed 6s later. Loading
  // now gets real prices into QUOTES within ~1s; worker-quotes re-publishes
  // Feed + a 'bpleone:quotes' event so pages can re-render. (The lazy block's
  // existence-guard makes its later attempt a no-op.)
  ['js/worker-quotes.js', 'js/auth.js'].forEach(src => {
    if (!document.querySelector('script[src*="' + src + '"]')) {
      const s = document.createElement('script'); s.src = src + '?v=v182'; s.async = true;
      document.head.appendChild(s);
    }
  });
});
