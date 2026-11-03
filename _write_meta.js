// Freshness sidecar for a scheduled data file (audit 2026-11-03).
// Usage: node _write_meta.js <name> <data-file> <source-description>
// Writes data/meta/<name>.json:
//   checkedAt  - when this job last fetched the source successfully (every run)
//   changedAt  - when the data content last changed (kept from the previous sidecar when the hash is unchanged)
//   rows, sha256, coverage (first/last date found in the rows, when the rows carry dates)
//   runId / workflow - the GitHub Actions run that wrote it
// The data files themselves stay byte-identical; system-status.html reads the sidecar.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const [name, file, source] = process.argv.slice(2);
if (!name || !file) { console.error('usage: node _write_meta.js <name> <data-file> <source>'); process.exit(2); }

const raw = fs.readFileSync(file);
const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
let data = null;
try { data = JSON.parse(raw.toString('utf8')); } catch (e) { console.error('not JSON: ' + file); process.exit(1); }

const rowsOf = d => Array.isArray(d) ? d : (d && (d.filings || d.signals || d.rows || d.items)) || [];
const rows = rowsOf(data);
// Accepts ISO (2026-11-01, 2026-11-01T...) and US M/D/YYYY (the House Clerk index format).
function isoDay(v) {
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') : null;
}
const dates = rows.map(r => isoDay(r && (r.date || r.filed || r.filingDate || r.disclosed || r.transactionDate)))
  .filter(Boolean).sort();

const out = path.join('data', 'meta', name + '.json');
let prev = null;
try { prev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) {}
const now = new Date().toISOString();

const meta = {
  file,
  source: source || null,
  checkedAt: now,
  changedAt: (prev && prev.sha256 === sha256 && prev.changedAt) ? prev.changedAt : now,
  rows: rows.length,
  coverage: dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null,
  sha256,
  workflow: process.env.GITHUB_WORKFLOW || null,
  runId: process.env.GITHUB_RUN_ID || null
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(meta, null, 2) + '\n');
console.log('meta ' + out + ': rows=' + meta.rows + ' changed=' + (meta.changedAt === now));
