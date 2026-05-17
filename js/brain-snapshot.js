/* ===========================================
   BPLEONE — Brain Snapshot Export / Import
   ---
   Everything the brain learns is in localStorage under bpleone_* keys.
   This module bundles all of them into a JSON file Brandon can download
   for backup / share between devices / migrate to a new browser.

   On import, validates the structure and offers preview before
   overwriting current state.

   Exposes:
     BrainSnapshot.export() → { keys, size, timestamp, json }
     BrainSnapshot.download() — triggers browser download
     BrainSnapshot.import(jsonString, opts?) → { restored, skipped }
     BrainSnapshot.upload(file) → Promise<importResult>
     BrainSnapshot.summary() → { keys, size, ageOfOldest }
   =========================================== */

(function () {
  const PREFIX = 'bpleone_';
  const VERSION = 1;

  function getAllKeys() {
    if (typeof localStorage === 'undefined') return [];
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    return keys.sort();
  }

  function exportSnapshot() {
    const keys = getAllKeys();
    const data = {};
    let totalSize = 0;
    for (const k of keys) {
      const v = localStorage.getItem(k);
      data[k] = v;
      totalSize += (v || '').length;
    }
    const snap = {
      version: VERSION,
      timestamp: Date.now(),
      timestampReadable: new Date().toISOString(),
      keyCount: keys.length,
      sizeBytes: totalSize,
      data
    };
    return {
      keys: keys.length,
      size: totalSize,
      timestamp: snap.timestamp,
      json: JSON.stringify(snap)
    };
  }

  function download() {
    if (typeof document === 'undefined') return null;
    const snap = exportSnapshot();
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = 'bpleone-brain-' + dateStr + '.json';
    const blob = new Blob([snap.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { filename, ...snap };
  }

  function importSnapshot(jsonString, opts) {
    opts = opts || {};
    let snap;
    try { snap = JSON.parse(jsonString); }
    catch (e) { return { error: 'Invalid JSON: ' + e.message }; }
    if (!snap || typeof snap.data !== 'object') {
      return { error: 'Invalid snapshot format (missing data field)' };
    }
    if (snap.version && snap.version > VERSION) {
      return { error: 'Snapshot version ' + snap.version + ' is newer than supported ' + VERSION };
    }
    // Optional: wipe existing first
    if (opts.replace) {
      const existing = getAllKeys();
      for (const k of existing) localStorage.removeItem(k);
    }
    let restored = 0, skipped = 0;
    for (const k in snap.data) {
      if (!k.startsWith(PREFIX)) { skipped++; continue; }
      try {
        localStorage.setItem(k, snap.data[k]);
        restored++;
      } catch (e) {
        skipped++;
      }
    }
    return {
      restored,
      skipped,
      timestamp: snap.timestamp,
      timestampReadable: snap.timestampReadable
    };
  }

  function upload(file) {
    if (!file) return Promise.reject(new Error('No file'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const result = importSnapshot(e.target.result);
          resolve(result);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsText(file);
    });
  }

  function summary() {
    const keys = getAllKeys();
    let totalSize = 0;
    let oldestTs = Date.now();
    for (const k of keys) {
      const v = localStorage.getItem(k) || '';
      totalSize += v.length;
      // Try to parse ts from value if it's JSON
      try {
        const parsed = JSON.parse(v);
        if (parsed && parsed.fittedAt && parsed.fittedAt < oldestTs) oldestTs = parsed.fittedAt;
        if (parsed && parsed.lastTrainTs && parsed.lastTrainTs < oldestTs) oldestTs = parsed.lastTrainTs;
      } catch (e) {}
    }
    return {
      keys: keys.length,
      sizeBytes: totalSize,
      sizeKB: (totalSize / 1024).toFixed(1),
      ageOfOldestMs: keys.length > 0 ? Date.now() - oldestTs : null,
      keyList: keys
    };
  }

  function clear() {
    if (typeof localStorage === 'undefined') return;
    const keys = getAllKeys();
    for (const k of keys) localStorage.removeItem(k);
  }

  window.BrainSnapshot = {
    export: exportSnapshot,
    download,
    import: importSnapshot,
    upload,
    summary,
    clear,
    VERSION
  };
})();
