/* ===========================================
   BPLEONE TRADING - TOAST NOTIFICATIONS
   ---
   Site-wide non-blocking notifications.
   Usage:
     Toast.show('message')
     Toast.show('connected', { kind:'success', duration:3000 })
     Toast.show('error', { kind:'error', sticky:true, action:{label:'Retry', onClick: ...} })
   =========================================== */

const Toast = (function() {
  let container = null;
  function ensure() {
    if (container) return container;
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
    return container;
  }
  function show(message, opts) {
    opts = opts || {};
    const kind = opts.kind || 'info';
    const duration = opts.duration == null ? 3500 : opts.duration;
    const sticky = !!opts.sticky;
    const c = ensure();
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    const icon = ({ info:'ℹ', success:'✓', warn:'⚠', error:'✕' })[kind] || 'ℹ';
    el.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-msg"></span>
      ${opts.action ? `<button class="toast-action"></button>` : ''}
      <button class="toast-close" aria-label="dismiss">×</button>
    `;
    el.querySelector('.toast-msg').textContent = String(message || '');
    if (opts.action) {
      const btn = el.querySelector('.toast-action');
      btn.textContent = opts.action.label || 'OK';
      btn.addEventListener('click', () => { try { opts.action.onClick && opts.action.onClick(); } catch (e) {} dismiss(el); });
    }
    el.querySelector('.toast-close').addEventListener('click', () => dismiss(el));
    c.appendChild(el);
    setTimeout(() => el.classList.add('toast-show'), 10);
    if (!sticky && duration > 0) setTimeout(() => dismiss(el), duration);
    return el;
  }
  function dismiss(el) {
    if (!el) return;
    el.classList.remove('toast-show');
    el.classList.add('toast-hide');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
  }
  return { show, dismiss };
})();

window.Toast = Toast;
