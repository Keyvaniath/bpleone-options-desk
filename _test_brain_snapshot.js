/* Headless test for js/brain-snapshot.js */
const fs = require('fs');
const path = require('path');

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  key: (i) => Object.keys(store)[i] || null,
  get length() { return Object.keys(store).length; },
  clear: () => { for (const k in store) delete store[k]; }
};
global.window = {};

const src = fs.readFileSync(path.join(__dirname, 'js', 'brain-snapshot.js'), 'utf8');
eval(src);
const BS = global.window.BrainSnapshot;

let pass = 0, fail = 0;
function t(name, cond, info) {
  if (cond) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (info ? ': ' + info : '')); fail++; }
}

// T1: API
t('T1 API present', typeof BS.export === 'function' && typeof BS.import === 'function');

// T2: Empty export
BS.clear();
const e2 = BS.export();
t('T2 empty export', e2.keys === 0 && e2.size === 0);

// T3: Export collects bpleone_ keys
localStorage.setItem('bpleone_test_1', 'value1');
localStorage.setItem('bpleone_test_2', JSON.stringify({ data: 'value2' }));
localStorage.setItem('other_key', 'should_not_be_included');
const e3 = BS.export();
t('T3a includes only bpleone_ keys', e3.keys === 2);
t('T3b includes valid JSON', JSON.parse(e3.json).data['bpleone_test_1'] === 'value1');

// T4: Export size matches
t('T4 size matches', e3.size === 'value1'.length + JSON.stringify({ data: 'value2' }).length);

// T5: Import restores
BS.clear();
const r5 = BS.import(e3.json);
t('T5a restored count', r5.restored === 2);
t('T5b key restored', localStorage.getItem('bpleone_test_1') === 'value1');

// T6: Import rejects non-bpleone keys (poisoned snapshot)
BS.clear();
const poisoned = JSON.stringify({
  version: 1,
  data: {
    'bpleone_good': 'ok',
    'evil_key': 'bad'
  }
});
const r6 = BS.import(poisoned);
t('T6 skips non-prefix keys', r6.restored === 1 && r6.skipped === 1);
t('T6b evil key not restored', localStorage.getItem('evil_key') === null);

// T7: Invalid JSON
const r7 = BS.import('not valid json');
t('T7 invalid JSON error', r7.error && r7.error.includes('Invalid JSON'));

// T8: Invalid format
const r8 = BS.import('{"version": 1}'); // missing data field
t('T8 invalid format error', r8.error && r8.error.includes('Invalid snapshot'));

// T9: Future version rejected
const r9 = BS.import('{"version": 999, "data": {}}');
t('T9 future version rejected', r9.error && r9.error.includes('newer than supported'));

// T10: replace option wipes existing
localStorage.setItem('bpleone_existing', 'old');
const r10 = BS.import(JSON.stringify({ version: 1, data: { 'bpleone_new': 'fresh' } }), { replace: true });
t('T10a existing removed', localStorage.getItem('bpleone_existing') === null);
t('T10b new restored', localStorage.getItem('bpleone_new') === 'fresh');

// T11: summary returns key count + size
BS.clear();
localStorage.setItem('bpleone_a', '12345');
localStorage.setItem('bpleone_b', '67890');
const s11 = BS.summary();
t('T11 summary keys + size', s11.keys === 2 && s11.sizeBytes === 10);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
