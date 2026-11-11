/* ===========================================
   BPLEONE — OKX perpetual futures (public market data)
   ---
   Audit 2026-11-11 (pass 340): crypto-derivatives.html and crypto-basis.html read
   Binance USDS-M futures, which answers HTTP 451 ("Service unavailable from a
   restricted location") to every US visitor, Brandon included: both pages showed
   nothing but dashes. OKX's public API answers from the US and sends CORS headers
   for options.bpleone.com (checked 11/11). Bybit is geo-blocked the same way as
   Binance (CloudFront 403); OKX's long/short ratio endpoint sends no CORS header,
   so the pages do not show one.

   No key, no synthetic fallback: a failed call returns null and the page shows '—'.

   Exposes:
     OkxPerps.snapshot('BTC')         -> { asset, mark, index, funding, intervalH,
                                           nextFundingTime, chgPct, oiUsd, vol24Usd,
                                           basisPct, venue: 'OKX' } (fields null when missing)
     OkxPerps.fundingHistory('BTC', n) -> [{ ts, rate }] oldest first, rate as a fraction
                                           (realized settlements), or null
     OkxPerps.annualizedPct(rate, intervalH) -> % a year
   =========================================== */
(function () {
  const BASE = 'https://www.okx.com';
  const num = v => (v === '' || v == null || !isFinite(+v)) ? null : +v;

  async function okx(path) {
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
      const r = await fetch(BASE + path, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (t) clearTimeout(t);
      if (!r.ok) return null;
      const j = await r.json();
      return (j && j.code === '0' && Array.isArray(j.data)) ? j.data : null;
    } catch (e) { return null; }
  }

  function annualizedPct(rate, intervalH) {
    if (rate == null || !(intervalH > 0)) return null;
    return rate * (365 * 24 / intervalH) * 100;
  }

  async function snapshot(asset) {
    const inst = asset + '-USDT-SWAP';
    const [fr, mp, ix, oi, tk] = await Promise.all([
      okx('/api/v5/public/funding-rate?instId=' + inst),
      okx('/api/v5/public/mark-price?instType=SWAP&instId=' + inst),
      okx('/api/v5/market/index-tickers?instId=' + asset + '-USDT'),
      okx('/api/v5/public/open-interest?instType=SWAP&instId=' + inst),
      okx('/api/v5/market/ticker?instId=' + inst)
    ]);
    const f = fr && fr[0], m = mp && mp[0], x = ix && ix[0], o = oi && oi[0], t = tk && tk[0];
    const mark = m ? num(m.markPx) : null;
    const index = x ? num(x.idxPx) : null;
    const funding = f ? num(f.fundingRate) : null;
    const ft = f ? num(f.fundingTime) : null, nft = f ? num(f.nextFundingTime) : null;
    // The funding interval comes from OKX's own schedule (8 h on the majors today; some contracts run 4 h or 1 h).
    const intervalH = (ft && nft && nft > ft) ? (nft - ft) / 3600000 : null;
    const last = t ? num(t.last) : null, open24 = t ? num(t.open24h) : null;
    const chgPct = (last != null && open24 > 0) ? (last - open24) / open24 * 100 : null;
    const volCcy = t ? num(t.volCcy24h) : null;           // 24h volume in the base coin
    const vol24Usd = (volCcy != null && last != null) ? volCcy * last : null;
    let oiUsd = o ? num(o.oiUsd) : null;
    if (oiUsd == null && o && num(o.oiCcy) != null && mark != null) oiUsd = num(o.oiCcy) * mark;
    const basisPct = (mark != null && index > 0) ? (mark - index) / index * 100 : null;
    return { asset, mark, index, funding, intervalH, nextFundingTime: ft, chgPct, oiUsd, vol24Usd, basisPct, venue: 'OKX' };
  }

  async function fundingHistory(asset, n) {
    const rows = await okx('/api/v5/public/funding-rate-history?instId=' + asset + '-USDT-SWAP&limit=' + Math.min(100, Math.max(1, n || 30)));
    if (!rows || !rows.length) return null;
    return rows
      .map(r => ({ ts: num(r.fundingTime), rate: num(r.realizedRate) != null ? num(r.realizedRate) : num(r.fundingRate) }))
      .filter(r => r.ts && r.rate != null)
      .sort((a, b) => a.ts - b.ts);
  }

  window.OkxPerps = { snapshot, fundingHistory, annualizedPct };
})();
