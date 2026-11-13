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

// 6g. Pass 339 (2026-11-11): the browser trainers' history. Stooq's daily CSV is as CORS-dead as its quote poll,
//     and Finnhub's /stock/candle refuses a free key. Behavior is pinned by _test_history_sources.js.
const hbs = read('js/historical-bootstrap.js'), ats = read('js/auto-trainer.js'), wrs = read('js/weekly-refresh.js');
['js/historical-bootstrap.js', 'js/auto-trainer.js', 'js/stale-refresh.js', 'js/weekly-refresh.js'].forEach(f =>
  t(f + ' never fetches Stooq', !/fetch\([^)]*stooq|stooq\.com\/q\/d\/l|STOOQ_HOST \+/.test(read(f).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')) ));
t('bootstrap reads the Worker bars in one request and parks a refused candle endpoint', /\/brain\/bars\?days=40&syms=' \+ syms\.join/.test(hbs) && /res\.status === 401 \|\| res\.status === 403\) \{ parkCandle/.test(hbs) && /lastCandleAt \+ FH_PACE_MS - Date\.now\(\)/.test(hbs));
t('bootstrap drops an unfinished bar and never fills a missing OHLC field', /etDay\(b\.ts\) === today && !b\.fin\) continue/.test(hbs) && !/open: j\.o\[i\] \|\| close/.test(hbs));
t('auto-trainer makes no request without candle access', /!HB\.candleAccess\(\)\) \{/.test(ats) && /return \{ skipped: 'no-history-source' \}/.test(ats) && !/fetchStooqHistory/.test(ats));
t('auto-trainer lock is released in a finally', /finally \{\s*\n\s*if \(claimed\) window\._autoTrainerRunning = false;/.test(ats));
t('trainers never overlap', /window\._autoTrainerRunning\) \{\s*\n\s*return \{ skipped: true, reason: 'auto-trainer-running'/.test(hbs) && /_historicalTrainerRunning\) return \{ skipped: 'bootstrap-running' \}/.test(ats));
t('weekly refresh respects the Worker-authoritative gate', /reason: 'worker-bridge-authoritative'/.test(wrs));
['historical-bootstrap', 'train-now', 'brain-debug'].forEach(p =>
  t(p + ' promises no Stooq history', !/bars from Stooq|Stooq bars|Stooq data|latest Stooq/.test(read(p + '.html'))));
t('train-now never reports a blanket "completed" for the auto-trainer', !/completed · main model \+ multi-horizon ensembles updated/.test(read('train-now.html')) && /if \(!n\) s\.err\(/.test(read('train-now.html')));

// 6h. Pass 340 (2026-11-11): data sources a US browser can actually read. Checked from Brandon's machine:
//     Binance futures + spot answer 451 ("restricted location"), Stooq sends no CORS headers, and a free Finnhub
//     key gets 403 on /calendar/economic, /stock/social-sentiment and /news-sentiment. Behavior is pinned by
//     _test_live_sources.js.
const fs6h = require('fs');
const allSrc = fs6h.readdirSync(__dirname).filter(f => f.endsWith('.html')).map(f => [f, read(f)])
  .concat(fs6h.readdirSync(__dirname + '/js').filter(f => f.endsWith('.js')).map(f => ['js/' + f, read('js/' + f)]));
const strip = t => t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const hits = re => allSrc.filter(([f, t]) => re.test(strip(t))).map(([f]) => f);
t('no page or module calls Binance (451 from the US)', hits(/fapi\.binance\.com|api\.binance\.com/).length === 0);
t('no page or module fetches Stooq (no CORS)', hits(/https:\/\/stooq\.com\/q/).length === 0);
t('no page calls Finnhub /calendar/economic (premium)', hits(/finnhub\.io\/api\/v1\/calendar\/economic/).length === 0);
t('crypto pages read OKX via okx-perps.js and poll only when visible', ['crypto-derivatives', 'crypto-basis'].every(p => {
  const h = read(p + '.html'); return /js\/okx-perps\.js\?v=/.test(h) && /if \(!document\.hidden\)/.test(h) && !/LIVE · BINANCE|live · Binance/.test(h); }));
t('SPY Radar and the options board read the calendar through EconFeed', ['spy-radar', 'options-board'].every(p => {
  const h = read(p + '.html'); return /EconFeed\.load\(\)/.test(h) && !/jget\('\/brain\/econ'\)/.test(h); }));
t('SPY Radar never calls the week clear from a feed that does not cover it', !/calendar risk is behind you/.test(read('spy-radar.html')) && /This is not an all-clear/.test(read('spy-radar.html')));
t('econ-feed refuses a calendar that does not cover today', /function covers\(cov, now\)/.test(read('js/econ-feed.js')) && /reason: tried\.length \? 'out-of-date' : 'unreachable'/.test(read('js/econ-feed.js')));
t('sentiment parks a refused premium endpoint and never bursts a batch', /res\.status === 401 \|\| res\.status === 403\) park\('social-sentiment'\)/.test(read('js/sentiment.js')) && !/await Promise\.all\(symbols\.map/.test(read('js/sentiment.js')));
t('the retired walk-forward page makes no edge claim', !/vMsg = '✓ REAL ALPHA'|runBacktest/.test(read('walk-forward-backtest.html')) && /href="proof\.html"/.test(read('walk-forward-backtest.html')));
t('no invented bid/ask: computeDerived sets none, real ones carry bidAskTs', (() => {
  const lv = read('js/live.js'); const cd = lv.slice(lv.indexOf('function computeDerived(q)'), lv.indexOf('function hasRealBidAsk'));
  return cd.length > 0 && !/q\.(bid|ask) =/.test(cd) && /q\.bidAskTs = Date\.now\(\)/.test(read('js/data-provider.js')); })());
t('the model spread feature uses only a real bid/ask', /spreadBps: \(isReal && q\.bid > 0 && q\.ask > 0 && q\.bidAskTs/.test(read('js/model.js')));
t('ticker and data-live show "—" for a seed, never its price', /<span class="ticker-price">—<\/span>/.test(appjs) && /priceEl\.textContent = seed \? '—'/.test(appjs) && /ps === 'stale-seed' \|\| ps === 'mock'\) \{\s*\n\s*el\.textContent = '—';/.test(read('js/live.js')));
t('the pill never says MOCK outside demo mode (first paint is LOADING)', /data-pill-label">LOADING<\/span>/.test(appjs) && !/data-pill-label">MOCK</.test(appjs) && /label = demo \? 'MOCK' : 'LOADING'/.test(appjs));
// Pass 341 (page smoke sweep 11/11): execution, portfolio-builder, position-sizing and vol-cone called charts.js
// helpers without loading charts.js (execution threw on load); dark-pool(-pro) prefilled 20-30 prints through an
// unguarded appendPrint(generatePrint()) although generatePrint() returns null by design (pass 308).
const chartFns = ['baseOptions', 'renderPriceChart', 'renderPriceWithMAChart', 'renderRSIChart', 'renderVolumeChart', 'renderSectorChart', 'renderFlowDonut', 'renderPerfChart', 'renderIVSmile', 'renderOIByStrike', 'renderMACD', 'generateSeries', 'timeLabels'];
const missCharts = allSrc.filter(([f]) => f.endsWith('.html') && !f.startsWith('_')).filter(([f, h]) => {
  const code = strip(h);
  const uses = chartFns.some(fn => new RegExp('\\b' + fn + '\\(').test(code) && !new RegExp('function ' + fn + '\\b').test(code));
  return uses && !/js\/charts\.js/.test(h);
}).map(([f]) => f);
t('every page that calls a charts.js helper loads charts.js' + (missCharts.length ? ' (missing: ' + missCharts.join(', ') + ')' : ''), missCharts.length === 0);
t('dark-pool pages ignore a null print', ['dark-pool', 'dark-pool-pro'].every(p => /function appendPrint\(p\) \{\s*\n\s*if \(!p\) return;/.test(read(p + '.html'))));
t('model-what-if writes no hand-labeled scenario into training rows', !/bpleone_train_v1/.test(strip(read('model-what-if.html'))) && !/id="saveBtn"/.test(read('model-what-if.html')));
t('model-what-if uses the model\'s real features and its own predict()', /ALL_FEATURES\.filter\(n => n !== 'bias'\)/.test(read('model-what-if.html')) && /m\.predict\(x\)/.test(read('model-what-if.html')) && !/'macd_hist','vol_z'/.test(read('model-what-if.html')));
t('potd-backtest logs picks from real prints only and never formats a null level', /\['stale-seed', 'mock', 'demo-sim'\]\.indexOf\(ps\) >= 0\) return null/.test(read('potd-backtest.html')) && /\$\{lv\(p\.entry\)\}/.test(read('potd-backtest.html')));
t('the retired historical trainer cannot overwrite the model', !/ModelStore\.save\(/.test(read('historical-trainer.html')) && /href="historical-bootstrap\.html"/.test(read('historical-trainer.html')));

// 6i. Pass 342 (Brandon's 11/13 screenshots, "A LOT OF THESE ARE BROKEN"): contradictions between pages.
t('no page says "trade with conviction" (the audit log may quote it)', hits(/trade with conviction/i).filter(f => f !== 'audit-log.html').length === 0);
t('the status bar reports the Worker brain, not the browser-local coach', /async function workerBrainStatus\(\)/.test(appjs) && /const st = await workerBrainStatus\(\);/.test(appjs) && !/BrainCoach\.summary\(\)/.test(appjs.slice(appjs.indexOf('function initBrainStatusBar'), appjs.indexOf('function initLivePulseTicker'))));
t('the home brain card reads the Worker status', /window\.workerBrainStatus\(\)/.test(read('index.html')) && !/BrainCoach\.summary\(\)/.test(read('index.html')));
t('the data pill re-renders when prices land (DataProvider path)', /window\.addEventListener\('bpleone:quotes', \(\) => \{ try \{ render\(DataProvider\.getStatus\(\)\)/.test(appjs));
t('the data banner names no retired Stooq feed and tags delayed equities DELAYED', !/Yahoo\/Stooq/.test(strip(read('js/data-mode-banner.js'))) && /mode: 'delayed', color: 'var\(--green\)'/.test(read('js/data-mode-banner.js')));
t('Alpha Scanner: no brain read or regime on NO PLAY days, no stale edge claim', /function brainHasNoRead\(sigs\)/.test(read('alpha-scanner.html')) && !/edge is real but marginal/.test(read('alpha-scanner.html')) && /sort\(\(a, b\) => \(b\.rvol \|\| 0\) - \(a\.rvol \|\| 0\)\)/.test(read('alpha-scanner.html')));
t('Confluence: no vote from a NO PLAY brain, live per-leg verdict, no stale insider claim', /const noRead = signals\.length > 0/.test(read('smart-money-confluence.html')) && /function paintVerdict\(sc\)/.test(read('smart-money-confluence.html')) && !/clears the drift null/.test(read('smart-money-confluence.html')) && !/carry comes from the insider leg/.test(read('smart-money-confluence.html')));
t('Horizons, Broadcast, Options Lab, Live Watcher honour NO PLAY', /const noPlay = !!\(picks && picks\.no_play\)/.test(read('horizons.html')) && /const noPlayH = !!\(picksH && picksH\.no_play\)/.test(read('broadcast.html')) && /const noPlay = !!\(picksR && picksR\.no_play\)/.test(read('options-lab.html')) && /const noRead = sg && \/\^no play\/i/.test(read('live-watcher.html')));
t('Broadcast pairs the brain with its OWN baseline and sample', /function brainRecord\(conf\)/.test(read('broadcast.html')) && !/\(v\.brain_hit_rate\*100\)\.toFixed\(1\) \+ '% vs a ' \+ \(v\.drift_base_rate/.test(read('broadcast.html')));
t('SPY Radar, Brain Coach, Algo Signals: no NO PLAY artifact read as a regime or bonus', /const noRead = \/\^no play\/i\.test\(spySig\.reason/.test(read('spy-radar.html')) && /function brainNoRead\(\)/.test(read('brain-coach.html')) && /if \(!brainNoRead\) sigList\.forEach/.test(read('algo-signals.html')));
t('Smart Money: the 13F cycle is computed, never hardcoded', !/filingDate > '20\d\d-\d\d-\d\d'/.test(read('smart-money-dashboard.html')) && /w\.latest\.filingDate > qeISO/.test(read('smart-money-dashboard.html')));
t('insider tiles count open-market trades only', /const om = data\.filter\(d => d\.openMarket\)/.test(read('insider-live.html')) && /const omAll = \(j\.transactions \|\| \[\]\)\.filter\(t => t\.openMarket\)/.test(read('smart-money-dashboard.html')) && /txns\.filter\(isOpenMarket\)\.forEach/.test(read('smart-money.html')));
t('keyless visitors get the Worker feed (smart-money insiders, dashboard headlines)', /\/brain\/insider\?symbol=/.test(read('smart-money.html')) && /fetch\(W \+ '\/brain\/news'/.test(read('dashboard.html')) && !/Connect Finnhub in <a href="settings\.html"/.test(read('dashboard.html')));
t('Brain P&L never shows a giant $0.00 for an empty browser session', !/<div class="big-number">\$0\.00<\/div><div class="subtitle">No resolved trades/.test(read('money-made.html')));
t('worker /brain/predict serves the live calibration and the NO PLAY flag', /const calibratedProb = calOn \? applyLiveCalibration\(adjProb, liveCal\) : modelProb;/.test(read('worker/src/index.js')) && /no_play: noPlay,/.test(read('worker/src/index.js')));
t('worker /brain/signals: no regime on NO PLAY days', /sigNoPlay \? 'no-read'/.test(read('worker/src/index.js')) && /no_play: !!sigNoPlay,/.test(read('worker/src/index.js')));

// 6j. Pass 343 (11/13): keyless visitors get the Worker's data, and nothing labels an estimate as the market's.
const visibleText = f => read(f).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const named = allSrc.filter(([f]) => f.endsWith('.html') && !f.startsWith('_') && f !== 'audit-log.html').filter(([f]) => /Brandon/.test(visibleText(f))).map(([f]) => f);
t('no page names Brandon in visible copy' + (named.length ? ' (' + named.join(', ') + ')' : ''), named.length === 0);
t('earnings pages read the Worker calendar, no key needed', /'\/brain\/earnings\?days=5'/.test(read('earnings-tonight.html')) && !/Need Finnhub key in Settings/.test(strip(read('earnings-tonight.html'))) && /'\/brain\/earnings\?days=6'/.test(read('tomorrow-playbook.html')) && /'\/brain\/earnings\?days=2'/.test(read('pre-market.html')));
t('pre-market headlines and earnings need no key', /PM_W \+ '\/brain\/news'/.test(read('pre-market.html')) && !/Connect Finnhub/.test(strip(read('pre-market.html'))) && /'\/brain\/news\?symbol='/.test(read('pre-market-scanner.html')) && !/need Finnhub key in Settings/.test(strip(read('pre-market-scanner.html'))));
t('an ATR estimate is never labeled implied or IV', !/high IV — consider IV crush/.test(read('tomorrow-playbook.html')) && !/High implied move — IV crush/.test(read('earnings-tonight.html')) && /Est\. move \(ATR\)/.test(read('earnings-tonight.html')));
t('earnings-playbook measures reactions at REAL report dates (never the fiscal period)', /'\/brain\/earnings-history\?symbol='/.test(read('earnings-playbook.html')) && !/new Date\(e\.period\)/.test(read('earnings-playbook.html')) && /if \(path === '\/brain\/earnings-history'\)/.test(read('worker/src/index.js')));
t('insider buy/sell typing is open-market only, and the scanner ignores old caches', /const sideOf = \(code, change\) => \(code === 'P' \|\| code === 'S'\)/.test(read('insider-congress-flow.html')) && /c\.tx\[k\]\.v === 2/.test(read('confluence-scanner.html')));
t('crypto page lists only crypto-exposed names, with the real source', !/BTC treasury/.test(strip(read('crypto.html'))) && !/BINANCE:BTCUSDT/.test(visibleText('crypto.html')));
t('replay never promises free intraday bars', !/free tier covers ~1 year intraday/.test(read('replay.html')) && /Needs an intraday data provider/.test(read('replay.html')));
t('feed headlines are escaped before innerHTML (pre-market-scanner)', /\$\{pmsEsc\(\(n\.headline \|\| ''\)\.slice\(0, 110\)\)\}/.test(read('pre-market-scanner.html')));

// 7. Worker sources parse strictly. `node --check` passed an ES-module file with an unescaped quote in a
//    string (found 2026-11-03), so parse the bodies as scripts with imports/exports stripped.
['worker/src/index.js', 'worker/src/grading.js', 'worker/src/radar.js', 'worker/src/bars.js', 'worker/src/snapshots.js', 'worker/src/econ.js', 'worker/src/earnings.js'].forEach(f => {
  const body = read(f).replace(/^import .*$/mg, '').replace(/^export default /mg, 'const __d = ').replace(/^export /mg, '');
  let okParse = true; try { new vm.Script('(async () => {' + body + '\n})'); } catch (e) { okParse = false; console.log('  ' + f + ': ' + e.message); }
  t(f + ' parses strictly', okParse);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
