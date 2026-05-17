/* ===========================================
   BPLEONE — State Backup / Export / Import
   ---
   Exports every localStorage key under the bpleone_* prefix to a
   single JSON file Brandon can download. Importable on another
   browser / device to instantly restore brain state + journal +
   settings + auto-trade history.

   Includes a "diff preview" before import so user sees what changes.

   Exposes:
     StateBackup.snapshot()             -> in-memory object
     StateBackup.exportJSON()           -> JSON string
     StateBackup.exportFile()           -> triggers download
     StateBackup.importJSON(jsonStr)    -> applies (with confirmation)
     StateBackup.importFile(file)       -> reads + imports
     StateBackup.diff(jsonStr)          -> { added, changed, unchanged }
     StateBackup.keyList()              -> ordered key list w/ sizes
   =========================================== */

(function () {
  const PREFIX = 'bpleone_';

  function snapshot() {
    if (typeof localStorage === 'undefined') return {};
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) {
        out[k] = localStorage.getItem(k);
      }
    }
    return out;
  }

  function exportJSON() {
    const obj = {
      meta: {
        exportedAt: new Date().toISOString(),
        version: 1,
        source: 'bpleone-state-backup'
      },
      state: snapshot()
    };
    return JSON.stringify(obj, null, 2);
  }

  function exportFile(filename) {
    if (typeof document === 'undefined') return;
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    a.href = url;
    a.download = filename || ('bpleone-backup-' + ts + '.json');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    return true;
  }

  function parseImport(jsonStr) {
    try {
      const obj = JSON.parse(jsonStr);
      // Accept both wrapped { meta, state } and bare {key:value}
      if (obj && obj.state && typeof obj.state === 'object') return obj.state;
      if (obj && typeof obj === 'object') return obj;
      return null;
    } catch (e) { return null; }
  }

  function diff(jsonStr) {
    const incoming = parseImport(jsonStr);
    if (!incoming) return { error: 'invalid-json' };
    const current = snapshot();
    const added = [], changed = [], unchanged = [], dropped = [];
    for (const k in incoming) {
      if (k.indexOf(PREFIX) !== 0) continue;
      if (!(k in current)) added.push(k);
      else if (current[k] !== incoming[k]) changed.push(k);
      else unchanged.push(k);
    }
    for (const k in current) {
      if (!(k in incoming)) dropped.push(k);
    }
    return {
      added, changed, unchanged, dropped,
      addedCount: added.length, changedCount: changed.length,
      unchangedCount: unchanged.length, droppedCount: dropped.length
    };
  }

  function importJSON(jsonStr, opts) {
    opts = opts || {};
    const incoming = parseImport(jsonStr);
    if (!incoming) return { ok: false, reason: 'invalid-json' };
    if (typeof localStorage === 'undefined') return { ok: false, reason: 'no-localstorage' };
    let setCount = 0, deleted = 0;
    if (opts.wipeFirst) {
      // Delete all bpleone_* keys
      const toDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) toDelete.push(k);
      }
      toDelete.forEach(k => { localStorage.removeItem(k); deleted++; });
    }
    for (const k in incoming) {
      if (k.indexOf(PREFIX) !== 0) continue;
      try { localStorage.setItem(k, incoming[k]); setCount++; } catch (e) {}
    }
    return { ok: true, set: setCount, deletedBefore: deleted };
  }

  function importFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject('no-file');
      const reader = new FileReader();
      reader.onload = e => {
        const text = e.target.result;
        const d = diff(text);
        resolve({ json: text, diff: d });
      };
      reader.onerror = () => reject('read-error');
      reader.readAsText(file);
    });
  }

  function keyList() {
    const snap = snapshot();
    const out = Object.keys(snap).map(k => ({
      key: k,
      bytes: (snap[k] || '').length,
      preview: (snap[k] || '').slice(0, 60) + ((snap[k] || '').length > 60 ? '…' : '')
    }));
    out.sort((a, b) => b.bytes - a.bytes);
    return out;
  }

  function deleteKey(k) {
    if (typeof localStorage === 'undefined') return false;
    if (!k || k.indexOf(PREFIX) !== 0) return false;
    localStorage.removeItem(k);
    return true;
  }

  window.StateBackup = {
    snapshot, exportJSON, exportFile,
    parseImport, diff, importJSON, importFile,
    keyList, deleteKey, PREFIX
  };
})();
