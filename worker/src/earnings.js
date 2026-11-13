// Past earnings report dates from SEC EDGAR (worker pass-325).
//
// Finnhub's free earnings calendar only reaches back about a month (11/13: AAPL, MSFT, AMD returned their latest
// report only, JPM none), so earnings-playbook.html could never measure more than one past reaction. Every US issuer
// files an 8-K with Item 2.02 ("Results of Operations") when it releases earnings, timestamped to the second, so
// EDGAR's submissions feed gives years of real report dates and the release timing:
//   accepted at/after 16:00 ET -> 'amc' (after the close), before 09:30 ET -> 'bmo', otherwise 'dmh' (during hours).
// Pure functions only; index.js does the fetching and caching.

export function etParts(ms) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const g = t => (p.find(x => x.type === t) || {}).value;
  return { date: g('year') + '-' + g('month') + '-' + g('day'), h: (+g('hour') % 24) + (+g('minute')) / 60 };
}

// filings.recent from data.sec.gov/submissions/CIK##########.json -> [{ date, hour, accepted, filed }], newest first,
// one release per quarter (a second 2.02 filing within 20 days, e.g. preliminary results, keeps only the later one).
export function earningsFrom8K(recent) {
  const rows = [];
  const n = recent && Array.isArray(recent.form) ? recent.form.length : 0;
  for (let i = 0; i < n; i++) {
    if (recent.form[i] !== '8-K') continue;
    if (!/(^|,)\s*2\.02\s*(,|$)/.test(String((recent.items || [])[i] || ''))) continue;
    const acc = Date.parse((recent.acceptanceDateTime || [])[i]);
    if (!isFinite(acc)) continue;
    const et = etParts(acc);
    rows.push({ date: et.date, hour: et.h >= 16 ? 'amc' : et.h < 9.5 ? 'bmo' : 'dmh', accepted: recent.acceptanceDateTime[i], filed: (recent.filingDate || [])[i] || et.date });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const kept = [];
  for (const r of rows) {
    const last = kept[kept.length - 1];
    if (!last || (Date.parse(last.date) - Date.parse(r.date)) / 864e5 >= 20) kept.push(r);
  }
  return kept;
}

// company_tickers.json ({"0":{"cik_str":320193,"ticker":"AAPL",...},...}) -> { AAPL: 320193, ... }
export function tickerMap(json) {
  const map = {};
  for (const v of Object.values(json || {})) if (v && v.ticker && v.cik_str) map[String(v.ticker).toUpperCase()] = v.cik_str;
  return map;
}
export function cikFor(map, sym) {
  if (!map || !sym) return null;
  const s = String(sym).toUpperCase();
  return map[s] || map[s.replace('.', '-')] || map[s.replace('-', '.')] || null;
}
export function cikPath(cik) { return 'CIK' + String(cik).padStart(10, '0') + '.json'; }
