/* ===========================================
   BPLEONE — Demo Data Floating Action Button
   ---
   A "Generate demo data" FAB for previewing populated UI on a fresh
   browser. Pass 239 (NO FAKE NUMBERS): OFF BY DEFAULT - it mounts ONLY
   when demo mode is explicitly enabled (localStorage bpleone_demo_mode=
   '1'); real customer-facing pages never show it. One click then fills
   50 synthetic resolved trades + 30 alerts + 12 closed auto-trades so
   the user can preview what the brain UI looks like populated.

   When mounted: hides if real journal data exists OR demo already
   generated. "Clear demo" button appears once demo data exists.

   Lazy-loaded by live.js. Idempotent (won't double-mount).
   =========================================== */

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window._demoFabMounted) return;

  function hasJournalData() {
    try { return JSON.parse(localStorage.getItem('bpleone_pred_journal_v1') || '[]').length > 0; } catch (e) { return false; }
  }
  function hasDemo() {
    return window.DemoData && window.DemoData.hasDemoData();
  }

  function mount() {
    if (window._demoFabMounted) return;
    window._demoFabMounted = true;
    const fab = document.createElement('div');
    fab.id = 'bp-demo-fab';
    fab.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px', 'z-index:9998',
      'display:flex', 'flex-direction:column', 'gap:8px', 'align-items:flex-end',
      'transition:opacity 0.3s ease',
      'pointer-events:auto', 'font-family:Inter,sans-serif'
    ].join(';');
    fab.innerHTML =
      '<button id="bp-demo-gen" style="padding:12px 20px;background:linear-gradient(135deg,#a884ff,#7c3aed);color:#fff;border:none;border-radius:30px;font-weight:800;cursor:pointer;font-size:13px;box-shadow:0 6px 20px rgba(140,100,255,0.35);letter-spacing:0.3px;">⚡ Generate demo data</button>' +
      '<button id="bp-demo-clr" style="display:none;padding:8px 16px;background:rgba(220,38,38,0.92);color:#fff;border:none;border-radius:30px;font-weight:700;cursor:pointer;font-size:11px;box-shadow:0 4px 14px rgba(220,38,38,0.25);">🗑 Clear demo data</button>';
    document.body.appendChild(fab);

    document.getElementById('bp-demo-gen').addEventListener('click', () => {
      if (!window.DemoData) { alert('Demo module still loading — try again in 2 seconds.'); return; }
      const r = window.DemoData.generate({ days: 30, count: 50 });
      toast('✅ Generated ' + r.journal + ' trades · ' + r.alerts + ' alerts · ' + r.autoTrades + ' closed auto-trades. Reload page to see them populate.');
      setTimeout(updateVisibility, 500);
    });
    document.getElementById('bp-demo-clr').addEventListener('click', () => {
      if (!window.DemoData) return;
      if (!confirm('Remove all demo data? Real brain data is preserved.')) return;
      const r = window.DemoData.clear();
      toast('🗑 Removed ' + r.removed + ' demo entries.');
      setTimeout(() => location.reload(), 800);
    });

    updateVisibility();
    // Audit pass 116: defensive guard so if mount() is somehow called twice
    // (e.g. page state-change retriggering init), we don't stack intervals.
    if (window._demoFabInterval) return;
    window._demoFabInterval = setInterval(updateVisibility, 8000);
  }

  function toast(msg) {
    let t = document.getElementById('bp-demo-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'bp-demo-toast';
      t.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:9999;background:rgba(0,0,0,0.92);color:#fff;padding:14px 22px;border-radius:10px;font-weight:700;font-size:13px;max-width:320px;line-height:1.5;border:1px solid rgba(140,100,255,0.4);font-family:Inter,sans-serif;opacity:0;transition:opacity 0.3s;';
      document.body.appendChild(t);
    }
    t.innerHTML = msg;
    t.style.opacity = '1';
    clearTimeout(window._demoToastTimer);
    window._demoToastTimer = setTimeout(() => { t.style.opacity = '0'; }, 4500);
  }

  function updateVisibility() {
    const fab = document.getElementById('bp-demo-fab');
    const gen = document.getElementById('bp-demo-gen');
    const clr = document.getElementById('bp-demo-clr');
    if (!fab || !gen || !clr) return;
    const real = hasJournalData();
    const demo = hasDemo();
    // Show generate button only when journal is empty OR contains only demo data
    if (!real) {
      // Definitely empty — show prominent generate button
      gen.style.display = 'inline-block';
      gen.textContent = '⚡ Generate demo data';
      clr.style.display = 'none';
    } else if (demo) {
      // Has demo data — show clear button + smaller generate
      gen.style.display = 'inline-block';
      gen.textContent = '+ More demo data';
      gen.style.padding = '8px 14px';
      gen.style.fontSize = '11px';
      clr.style.display = 'inline-block';
    } else {
      // Real data only — hide
      fab.style.opacity = '0';
      fab.style.pointerEvents = 'none';
      setTimeout(() => { if (fab && !hasJournalData()) { fab.style.opacity = '1'; fab.style.pointerEvents = 'auto'; } }, 100);
    }
  }

  // Don't mount on pages that already have their own data controls
  function shouldSkip() {
    const path = location.pathname.toLowerCase();
    const skip = ['/settings.html', '/state-backup.html', '/historical-bootstrap.html', '/weekly-refresh.html', '/connect-live-data.html', '/money-made.html'];   // money-made has its own inline empty-state banner
    return skip.some(p => path.endsWith(p));
  }

  // Pass 239 (NO FAKE NUMBERS): the demo FAB injects 50 synthetic trades + 30
  // alerts + 12 auto-trades. On a customer-facing product that is fake data, so
  // the FAB is OFF by default. It only mounts when the user explicitly opts into
  // demo mode (localStorage bpleone_demo_mode='1') — e.g. to preview empty
  // states. Real users never see it.
  function demoModeOn() {
    try { return localStorage.getItem('bpleone_demo_mode') === '1'; } catch (e) { return false; }
  }

  function init() {
    if (!demoModeOn()) return;   // pass 239: never on a live customer page
    if (shouldSkip()) return;
    // Wait briefly so DemoData has time to load
    setTimeout(mount, 1500);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
