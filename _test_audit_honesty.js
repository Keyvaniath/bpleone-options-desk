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
['trade-of-the-day', 'brain-bet', 'conviction-stack', 'morning-brief', 'plays'].forEach(p =>
  t(p + ' loads the NO PLAY gate', read(p + '.html').indexOf('js/no-play-gate.js') >= 0 && gate.indexOf("'" + p + "'") >= 0));

// 6c. Screenshot fixes (11/3 evening): crypto change vs Coinbase's 24h open, never the May seed; the nav pill
//     counts worker-yahoo as DELAYED and never resets to a hardcoded LIVE; Today leads with the live record.
const dp = read('js/data-provider.js');
t('crypto baseline is Coinbase open_24h (WS) and /stats open (REST)', /m\.open_24h/.test(dp) && /\/stats'/.test(dp) && /parseFloat\(data\.open\)/.test(dp) && !/preserve seed prevClose/.test(dp));
const appjs = read('js/app.js');
t('nav pill counts worker-yahoo as delayed', /s\.indexOf\('worker-yahoo'\) !== -1/.test(appjs));
t('nav pill never resets to a hardcoded LIVE after a brain cycle', !/setTimeout\(\(\) => \{ if \(text\) text\.textContent = 'LIVE'; \}/.test(appjs) && /nav-pulse-text">FEED</.test(appjs));
const today = read('today.html');
t('Today leads with the live record', /id="pf-live"/.test(today) && /live_resolved/.test(today) && /No edge in live trading/.test(today));
t('Today makes no "proof it works" or "Real $" claim', today.indexOf('the proof it works') < 0 && today.indexOf('Real $ track record') < 0);

// 6d. Third sweep (11/3 night): pick and P&L pages judge the brain by its LIVE record; the options chain is the
//     real CBOE chain with a labeled modeled fallback; implied moves come from the straddle; ATR-based option
//     levels use only verified bars; expired expirations are never offered; delayed data is never badged LIVE.
['pick-of-day', 'money-made'].forEach(p =>
  t(p + ' edge verdict checks the live record first', /liveBad/.test(read(p + '.html')) && /No edge in live trading/.test(read(p + '.html'))));
const chainPg = read('options-chain.html');
t('options-chain loads the real CBOE chain, modeled only as a labeled fallback', /\/brain\/options-chain/.test(chainPg) && /REAL = false; SPOT = null;\s*\n\s*CHAIN = buildChain\(sym\);/.test(chainPg) && /MODELED chain, not market data/.test(chainPg));
t('options-chain strip has no hardcoded IV rank / HV / earnings date', !/May 28 AMC/.test(chainPg) && !/>42<\/div>/.test(chainPg) && /id="kHv30"/.test(chainPg) && /\/brain\/earnings\?days=30/.test(chainPg));
t('options-chain covered call stock leg is one 100-share unit', /\{ type:'stock', side:'long', entry:S, qty:1 \}/.test(chainPg));
const epv = read('earnings-preview.html');
t('earnings-preview implied move is the CBOE straddle, no beta proxy or placeholder', /\/brain\/options-chain/.test(epv) && !/impliedPct = 5\.0/.test(epv) && !/0\.30 \+ \(m\.beta/.test(epv) && !/QUOTES\[sym\]\.last : 100\)/.test(epv));
['options-board', 'options-tranches'].forEach(p =>
  t(p + ' ATR uses only verified (fin) bars', /every\(b => b\.fin\)/.test(read(p + '.html'))));
t('expired expirations are skipped (tranches + chain)', /et\.hour >= 16\)\) continue/.test(read('options-tranches.html')) && /exp === today && closed\)\) continue/.test(chainPg));
['dashboard', 'pre-market', 'paper-trade', 'horizons', 'broadcast', 'pick-of-day', 'options-board', 'options-tranches'].forEach(p =>
  t(p + ' has no static LIVE badge', !/<span class="feat-badge feat-live"[^>]*>LIVE[^<]*<\/span>/.test(read(p + '.html'))));
t('data pill re-evaluates on pages without data-provider.js (no permanent MOCK)', /window\.addEventListener\('bpleone:quotes', \(\) => render\(fallbackStatus\(\)\)\)/.test(read('js/app.js')));
t('broadcast explains NO PLAY instead of blaming constraints', /picks && picks\.no_play\)\s*\n\s*\? 'NO PLAY today/.test(read('broadcast.html')));

// 6e. Pass 337 (11/11): GitHub started the snapshot job ~5 times a day, so the job chains itself. Each run starts
//     the next with GITHUB_TOKEN (needs actions: write) inside weekday 8:30-17:00 ET, behind an off switch, and the
//     checks judge it by runs that happened, never by a configured flag.
const snapWf = read('.github/workflows/snapshots.yml');
t('snapshot job can start its successor (actions: write + gh workflow run)', /actions: write/.test(snapWf) && /gh workflow run snapshots\.yml --ref main/.test(snapWf));
t('snapshot chain is bounded to weekday 8:30-17:00 ET and has an off switch', /"\$dow" -gt 5 \] \|\| \[ "\$hm" -lt 830 \] \|\| \[ "\$hm" -ge 1700 \]/.test(snapWf) && /vars\.SNAPSHOT_CHAIN != 'off'/.test(snapWf) && /timeout-minutes: 30/.test(snapWf));
t('snapshot crons avoid the top of the hour', !/cron: '\*\/15|cron: '0 \*/.test(snapWf) && !/cron: '\*\/30/.test(read('.github/workflows/brain-health.yml')));
const acc = read('_acceptance.js');
t('acceptance judges the snapshot job by runs, not by a configured flag', /deskSlots\(now - 86400000, now\)/.test(acc) && !/sd && sd\.configured \? 'PASS'/.test(acc));
t('system-status counts chained runs against desk-hour slots', /deskSlots: true/.test(ss) && /j\.deskSlots \? deskSlots\(from, now\)/.test(ss) && /x\.conclusion !== 'cancelled'/.test(ss));

// 6f. Audit 2026-11-11 (Brandon's browser, production): Finnhub REST fired ~75 calls in parallel (111 of 149 came
//     back 429), the pill said LIVE with 12 of 72 symbols streaming, the home page called the CORS-dead Stooq poll
//     "LIVE DATA", and the no-data-provider fallback read a SAVED provider as connected. Behavior is pinned by
//     _test_data_provider.js; these guard the wording and wiring.
const dprov = read('js/data-provider.js');
t('browser Stooq poll is retired (no 12 s interval; stooqPollOnce is a no-op)', !/setInterval\(stooqPollOnce/.test(dprov) && /async function stooqPollOnce\(\) \{\s*\n(\s*\/\/[^\n]*\n)*\s*return;/.test(dprov));
t('Finnhub bootstrap needs a key, is paced and stops on 429', /config\.provider !== 'finnhub' \|\| !config\.apiKey\) return \[\]/.test(dprov) && /FH_PACE_MS = 1100/.test(dprov) && /r\.status === 429\) \{ fh429Until/.test(dprov) && !/await Promise\.all\(syms\.map\(async sym/.test(dprov));
t('refreshAll re-polls the worker feed first', /refreshAll: async \(\) => \{\s*\n\s*try \{ if \(typeof window !== 'undefined' && window\.WorkerQuotes/.test(dprov));
t('stale-refresh no longer fetches Stooq', !/await _refreshStooq\(/.test(read('js/stale-refresh.js')) && /_refreshEquitiesViaWorker\(staleEquities\)/.test(read('js/stale-refresh.js')));
t('pill says LIVE only for what streams (live share), never for demo-sim', /function liveShare\(\)/.test(appjs) && /ls\.live >= 0\.9 \* ls\.real/.test(appjs) && /NOT_REAL_SOURCES = \['stale-seed', 'mock', 'demo-sim'\]/.test(appjs));
t('no-data-provider fallback never reports a saved provider as connected', /return \{ status: 'mock', provider: c\.provider, enabled: false \};/.test(appjs) && !/status: c\.enabled && c\.provider !== 'mock' \? 'connected'/.test(appjs));
['index', 'connect-live-data', 'brain-health', 'trade-of-the-day', 'live-status', 'about', 'start-here'].forEach(p => {
  const h = read(p + '.html');
  t(p + ' makes no Stooq live-price claim', !/LIVE DATA — STOOQ|Stooq polls equities|Stooq polling not yet started|Stooq fallback is polling|with Stooq as a fallback|give Stooq a moment|Yahoo\/Stooq/.test(h));
});
t('start-here does not promise Finnhub streaming to every visitor', !/stream from a real market feed \(Finnhub\)/.test(read('start-here.html')));

// 7. Worker sources parse strictly. `node --check` passed an ES-module file with an unescaped quote in a
//    string (found 2026-11-03), so parse the bodies as scripts with imports/exports stripped.
['worker/src/index.js', 'worker/src/grading.js', 'worker/src/radar.js', 'worker/src/bars.js', 'worker/src/snapshots.js'].forEach(f => {
  const body = read(f).replace(/^import .*$/mg, '').replace(/^export default /mg, 'const __d = ').replace(/^export /mg, '');
  let okParse = true; try { new vm.Script('(async () => {' + body + '\n})'); } catch (e) { okParse = false; console.log('  ' + f + ': ' + e.message); }
  t(f + ' parses strictly', okParse);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
