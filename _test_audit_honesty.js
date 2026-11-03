// Regression guards for the 2026-11-03 honesty audit (batch 2). Static checks: each one pins a fix
// so a later pass cannot silently re-introduce a fabricated number. Run: node _test_audit_honesty.js
const fs = require('fs');
const vm = require('vm');
const read = f => fs.readFileSync(f, 'utf8');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL ' + name); } }

// 1. Synthetic insider trades never reach signals or training.
const icf = read('insider-congress-flow.html');
t('insider page has no syntheticTx generator', !/function\s+syntheticTx/.test(icf));
t('insider cache entries are stamped real', /real:\s*true/.test(icf));
t('confluence-scanner keeps only real insider entries', /\.real === true/.test(read('confluence-scanner.html')));
t('brain-loop keeps only real insider entries', /raw\[k\]\.real === true/.test(read('js/brain-loop.js')));
t('options-flow-live refuses to feed Learn from sample chains', /if \(!lastResultsReal\)/.test(read('options-flow-live.html')));

// 2. No placeholder quotes / fake indicators driving alerts or plans.
const ab = read('alerts-builder.html');
t('alerts-builder RSI is not 50 + 5 x change%', !/50 \+ \(q\.changePct/.test(ab));
t('alerts-builder getQ returns null without a real print', /return \(q && q\.last > 0\) \? q : null/.test(ab));
t('alerts-builder never evaluates a null value', /if \(val == null \|\| !isFinite\(val\)\) return;/.test(ab));
const tc = read('trade-coach.html');
t('trade-coach ATR comes from bars, fallback labeled', /atrFor\(sym\)/.test(tc) && /ATR ASSUMED 2\.5% of price/.test(tc));
const ep = read('earnings-playbook.html');
t('earnings-playbook has no 1.7 x ATR "implied move"', !/atrPct \* 1\.7/.test(ep));
t('earnings-playbook never fabricates a calendar', !/using synthetic/.test(ep) && !/Date\.now\(\) \+ 5 \* 86400000/.test(ep));
t('earnings-playbook implied move is a real straddle', /\/brain\/options-chain/.test(ep) && /call\.mid \+ put\.mid/.test(ep));
t('earnings-playbook cache key bumped past fabricated v1', /bpleone_earnings_playbook_v2/.test(ep));
const nl = read('notification-log.html');
t('notification test carries no random ticker or score', !/Math\.random\(\)\*4/.test(nl) && /TEST notification \(not a signal\)/.test(nl));
t('move notifications rank real-feed quotes only', /REAL\[q\.priceSource\]/.test(read('js/notify.js')));

// 3. Labels say what the page serves.
const sdb = read('js/sample-data-banner.js');
['iv-skew', 'options-flow-live', 'big-bets', 'dark-pool', 'insider-congress-flow'].forEach(p =>
  t('sample banner lists ' + p, sdb.indexOf("'" + p + "'") >= 0));
const live = read('js/live.js');
const lazyStart = live.indexOf('Lazy-load the auto-trainer');
const bannerLoad = live.indexOf("s.src = 'js/sample-data-banner.js?v=' + LV;");
t('sample banner loads before (outside) the 5s lazy batch', bannerLoad > 0 && bannerLoad < lazyStart);
const idx = read('all-tools.html') + read('jump-to.html') + read('js/command-palette.js');
t('no "Live >=$250k options prints" claim', idx.indexOf('Live ≥$250k') < 0);
t('no "sweeps, blocks" claim for options-flow', idx.indexOf('Unusual activity, sweeps, blocks') < 0);
t('no "Live skew" claim for iv-skew', idx.indexOf('Live skew + 3D surface') < 0);
const sl = read('setup-library.html');
t('setup-library claims no untested hit rates', !/<div class="v">\d+%<\/div><div class="l">Hit rate/.test(sl));
t('live-status classifies worker-yahoo as delayed', /DELAYED_SOURCES = \['worker-yahoo'/.test(read('live-status.html')));

// 4. System status page is wired and parses.
const ss = read('system-status.html');
t('system-status in sitemap', read('sitemap.xml').indexOf('system-status.html') >= 0);
t('system-status in tools nav group', /'system-status'/.test(read('js/app.js')));
const blocks = [...ss.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
let parses = true; blocks.forEach(b => { try { new vm.Script(b); } catch (e) { parses = false; } });
t('system-status inline scripts parse', parses && blocks.length >= 2);
t('system-status expected worker version matches worker', (ss.match(/EXPECTED_WORKER_VERSION = '([^']+)'/) || [])[1] === (read('worker/src/index.js').match(/WORKER_VERSION = '([^']+)'/) || [])[1]);

// 5. One cache-bust version across every page (a stale ?v= freezes fixes in returning browsers).
const versions = new Set();
fs.readdirSync('.').filter(f => f.endsWith('.html')).forEach(f => { for (const m of read(f).matchAll(/(?:src|href)="[^"]*\?v=(v\d+)/g)) versions.add(m[1]); });
t('single cache-bust version site-wide (' + [...versions].join(',') + ')', versions.size === 1);

// 6. Freshness sidecars are written by the daily jobs.
['congress-ptr.yml', 'econ-calendar.yml', 'edge-lab.yml'].forEach(w =>
  t(w + ' writes a data/meta sidecar', /node _write_meta\.js /.test(read('.github/workflows/' + w)) && /data\/meta\//.test(read('.github/workflows/' + w))));

// 6b. Pick pages that rank with the browser model show the worker's NO PLAY gate first.
const gate = read('js/no-play-gate.js');
t('no-play gate reads /brain/picks and handles closed + unreachable', /\/brain\/picks/.test(gate) && /No qualifying setups today/.test(gate) && /Could not confirm/.test(gate));
['trade-of-the-day', 'brain-bet', 'conviction-stack', 'morning-brief'].forEach(p =>
  t(p + ' loads the NO PLAY gate', read(p + '.html').indexOf('js/no-play-gate.js') >= 0 && gate.indexOf("'" + p + "'") >= 0));

// 7. Worker sources parse strictly. `node --check` passed an ES-module file with an unescaped quote in a
//    string (found 2026-11-03), so parse the bodies as scripts with imports/exports stripped.
['worker/src/index.js', 'worker/src/grading.js', 'worker/src/radar.js'].forEach(f => {
  const body = read(f).replace(/^import .*$/mg, '').replace(/^export default /mg, 'const __d = ').replace(/^export /mg, '');
  let okParse = true; try { new vm.Script('(async () => {' + body + '\n})'); } catch (e) { okParse = false; console.log('  ' + f + ': ' + e.message); }
  t(f + ' parses strictly', okParse);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
