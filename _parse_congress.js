/* One-shot + reusable parser: House Clerk FD index .txt -> congress-trades.json
   (also used verbatim by the daily GitHub Action). Filters Periodic Transaction
   Reports (FilingType P) - the actual stock-trade disclosures - and emits a
   filing-level feed (member, state/district, date, official PDF link). The free
   index has no ticker/amount; those live in the linked PDF, stated honestly on the page. */
const fs = require('fs');
const src = process.argv[2];               // path to YYYYFD.txt
const out = process.argv[3];               // path to data/congress-trades.json
const year = process.argv[4] || new Date().getFullYear();
const raw = fs.readFileSync(src, 'utf8');
const lines = raw.split(/\r?\n/).filter(Boolean);
// header: Prefix Last First Suffix FilingType StateDst Year FilingDate DocID
const rows = lines.slice(1).map(l => l.split('\t')).filter(c => c.length >= 9 && c[4] === 'P');
function parseDate(s) { const m = (s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[1] - 1, +m[2]).getTime() : 0; }
const filings = rows.map(c => {
  const docId = (c[8] || '').trim();
  const filingYear = (c[6] || year).trim();
  return {
    prefix: c[0].trim(), last: c[1].trim(), first: c[2].trim(), suffix: c[3].trim(),
    state: c[5].trim(), date: c[7].trim(), docId,
    // PTR PDFs live under ptr-pdfs/<year>/<DocID>.pdf
    pdfUrl: docId ? 'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/' + filingYear + '/' + docId + '.pdf' : null,
    _ts: parseDate(c[7])
  };
}).filter(f => f.docId).sort((a, b) => b._ts - a._ts).slice(0, 150)
  .map(({ _ts, ...f }) => f);   // drop sort key
const payload = { ok: true, source: 'house-clerk-financial-disclosure', chamber: 'house', year: String(year), count: filings.length, filings };
fs.writeFileSync(out, JSON.stringify(payload, null, 1));
console.log('wrote', out, '-', filings.length, 'PTR filings');
