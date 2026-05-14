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

// ----- Quote model -----
// { symbol, last, bid, ask, change, changePct, volume, ts }
const QUOTES = {
  SPY:  { symbol: 'SPY',  last: 562.18, prevClose: 557.05, volume: 38_400_000 },
  QQQ:  { symbol: 'QQQ',  last: 487.32, prevClose: 481.92, volume: 27_800_000 },
  IWM:  { symbol: 'IWM',  last: 218.45, prevClose: 219.15, volume: 18_200_000 },
  DIA:  { symbol: 'DIA',  last: 419.07, prevClose: 417.36, volume: 4_100_000 },
  AAPL: { symbol: 'AAPL', last: 218.94, prevClose: 215.00, volume: 42_500_000 },
  NVDA: { symbol: 'NVDA', last: 138.27, prevClose: 133.96, volume: 248_400_000 },
  TSLA: { symbol: 'TSLA', last: 248.61, prevClose: 254.15, volume: 88_200_000 },
  MSFT: { symbol: 'MSFT', last: 425.18, prevClose: 421.27, volume: 18_700_000 },
  META: { symbol: 'META', last: 587.42, prevClose: 577.78, volume: 14_800_000 },
  AMZN: { symbol: 'AMZN', last: 213.55, prevClose: 211.69, volume: 32_400_000 },
  GOOGL:{ symbol: 'GOOGL',last: 178.32, prevClose: 179.07, volume: 28_900_000 },
  AMD:  { symbol: 'AMD',  last: 162.18, prevClose: 158.46, volume: 58_400_000 },
  BTC:  { symbol: 'BTC',  last: 71284.50, prevClose: 69314.50, volume: 12_400_000 },
  ETH:  { symbol: 'ETH',  last: 3842.18, prevClose: 3770.18, volume: 8_200_000 },
  VIX:  { symbol: 'VIX',  last: 14.82, prevClose: 15.29, volume: 0 },
  GLD:  { symbol: 'GLD',  last: 248.91, prevClose: 247.55, volume: 6_100_000 },
  TLT:  { symbol: 'TLT',  last: 92.18,  prevClose: 92.44, volume: 18_400_000 },
  USO:  { symbol: 'USO',  last: 78.42,  prevClose: 77.51, volume: 4_200_000 },
  SMCI: { symbol: 'SMCI', last: 48.21,  prevClose: 44.46, volume: 28_400_000 },
  PLTR: { symbol: 'PLTR', last: 31.84,  prevClose: 29.98, volume: 38_500_000 },
  COIN: { symbol: 'COIN', last: 248.92, prevClose: 236.59, volume: 14_200_000 },
  MARA: { symbol: 'MARA', last: 18.42,  prevClose: 19.35, volume: 18_400_000 },
  RIVN: { symbol: 'RIVN', last: 12.18,  prevClose: 12.68, volume: 22_400_000 },
  XLE:  { symbol: 'XLE',  last: 94.20,  prevClose: 95.38, volume: 12_400_000 },
  BABA: { symbol: 'BABA', last: 88.42,  prevClose: 85.50, volume: 14_200_000 },
  SHOP: { symbol: 'SHOP', last: 68.50,  prevClose: 67.04, volume: 8_400_000 },
  CRM:  { symbol: 'CRM',  last: 278.40, prevClose: 275.84, volume: 5_200_000 },
  UBER: { symbol: 'UBER', last: 68.20,  prevClose: 67.42, volume: 12_400_000 }
};

function computeDerived(q) {
  q.change = q.last - q.prevClose;
  q.changePct = (q.change / q.prevClose) * 100;
  q.bid = +(q.last - 0.01).toFixed(2);
  q.ask = +(q.last + 0.01).toFixed(2);
  q.ts = Date.now();
  return q;
}
Object.values(QUOTES).forEach(computeDerived);

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

function tickOnce() {
  if (!TICK_ENABLED) return;
  Object.values(QUOTES).forEach(q => {
    const vol = TICK_VOL[q.symbol] || 0.0002;
    // OU-ish mean-revert lightly toward last "open" (here: prevClose * 1.0)
    const drift = ((q.prevClose * 1.001) - q.last) / q.last * 0.04;
    const shock = (Math.random() - 0.5) * vol * 2;
    const newLast = q.last * (1 + drift + shock);
    q.last = +Math.max(0.01, newLast).toFixed(2);
    computeDerived(q);
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

// ----- Auto-start when ready -----
// If DataProvider is configured with a real provider, it will pause the mock
// engine and stream real quotes. Otherwise the OU random walk drives the site.
document.addEventListener('DOMContentLoaded', () => {
  bindLive();
  let useMock = true;
  if (typeof DataProvider !== 'undefined') {
    try {
      const r = DataProvider.init();
      useMock = r && r.useMock !== false;
    } catch (e) { useMock = true; }
  }
  if (useMock) startLive(1500);
});
