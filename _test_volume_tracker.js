/* Headless test for js/volume-tracker.js */
const fs = require('fs');
const path = require('path');

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { for (const k in store) delete store[k]; }
};
global.window = {};

const src = fs.readFileSync(path.join(__dirname, 'js', 'volume-tracker.js'), 'utf8');
eval(src);
const VT = global.window.VolumeTracker;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof VT.recordPrediction === 'function' && typeof VT.recordResolution === 'function');

// T2: Empty
VT.reset();
t('T2 empty', VT.stats().ready === false);

// T3: Record predictions
VT.reset();
const now = Date.now();
VT.recordPrediction(now);
VT.recordPrediction(now - 30 * 60 * 1000); // 30 min ago
VT.recordPrediction(now - 2 * 60 * 60 * 1000); // 2 hr ago
const s3 = VT.stats();
t('T3a total predictions', s3.totalPredictions === 3);
t('T3b last hour count', s3.predictionsLastHour === 2);

// T4: Record resolutions with latency
VT.reset();
VT.recordResolution(now - 10 * 60 * 1000, now); // 10 min latency
VT.recordResolution(now - 5 * 60 * 1000, now); // 5 min latency
const s4 = VT.stats();
t('T4a total resolutions', s4.totalResolutions === 2);
t('T4b avg latency ~7.5 min', Math.abs(s4.avgLatencyMin - 7.5) < 0.1);

// T5: Invalid latency rejected (negative or > 30 days)
VT.reset();
VT.recordResolution(now, now - 1000); // negative
VT.recordResolution(now - 100 * 24 * 3600 * 1000, now); // too old
t('T5 invalid resolutions rejected', VT.stats().totalResolutions === 0);

// T6: p95 latency — put 10 high latencies in 100 records so p95 picks one of them
VT.reset();
for (let i = 0; i < 100; i++) {
  // 90 at 5min, 10 at 30min → p95 (index 95) should be 30min
  const latencyMs = i < 90 ? 5 * 60 * 1000 : 30 * 60 * 1000;
  VT.recordResolution(now - latencyMs, now);
}
const s6 = VT.stats();
t('T6 p95 latency picks up high tail', s6.p95LatencyMin > 5);

// T7: Stale predictions detected
VT.reset();
VT.recordPrediction(now - 48 * 60 * 60 * 1000); // 48h ago, not resolved
VT.recordPrediction(now - 30 * 60 * 1000); // recent, not resolved
t('T7 stale detected', VT.stats().unresolvedOlderThan24h >= 1);

// T8: FIFO cap on preds
VT.reset();
for (let i = 0; i < 2500; i++) VT.recordPrediction(now - i);
t('T8 FIFO cap on preds', VT.stats().totalPredictions === VT.MAX_LOG);

// T9: FIFO cap on resolutions
VT.reset();
for (let i = 0; i < 2500; i++) VT.recordResolution(now - 5 * 60 * 1000 - i, now);
t('T9 FIFO cap on resolutions', VT.stats().totalResolutions === VT.MAX_LOG);

// T10: Empty stats fields are null
VT.reset();
const s10 = VT.stats();
t('T10 empty stats latency null', s10.avgLatencyMs === null && s10.p95LatencyMs === null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
