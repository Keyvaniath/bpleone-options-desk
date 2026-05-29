/* ===========================================
   BPLEONE — Customer Auth client (pass 240)
   ---
   Free account system. Talks to the Cloudflare Worker's /auth/* endpoints
   (PBKDF2-hashed passwords, KV-backed sessions — $0 on the free tier). The
   bearer token lives in localStorage; we validate it against /auth/me on load.

   Accounts do NOT gate content — everything on the site stays free. Accounts
   enable a saved watchlist, alert preferences, and a personalized "my account".

   Exposes:
     Auth.register(email, pw) -> {ok, email} | {error}
     Auth.login(email, pw)    -> {ok, email} | {error}
     Auth.logout()
     Auth.user()              -> { email } | null
     Auth.isLoggedIn()        -> bool
     Auth.token()             -> string | null
     Auth.savePrefs(obj) / Auth.prefs()
     Auth.onChange(cb)
   Fires window event 'bpleone:auth' on any state change.
   =========================================== */

(function () {
  const DEFAULT_WORKER = 'https://bpleone-brain-worker.brandonpleone.workers.dev';
  const TOKEN_KEY = 'bpleone_auth_token_v1';
  let state = { email: null, prefs: {}, ready: false };
  const subs = new Set();

  function workerUrl() {
    try {
      if (typeof WorkerBridge !== 'undefined' && WorkerBridge.getUrl) {
        const u = WorkerBridge.getUrl();
        if (u) return u;
      }
    } catch (e) {}
    return DEFAULT_WORKER;
  }
  function token() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function notify() {
    const snap = { email: state.email, prefs: state.prefs, ready: state.ready };
    subs.forEach(cb => { try { cb(snap); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent('bpleone:auth', { detail: snap })); } catch (e) {}
  }

  async function api(pathname, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(workerUrl() + pathname, {
        method: opts.method || 'GET', headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal, cache: 'no-store'
      });
      clearTimeout(to);
      const j = await r.json().catch(() => ({}));
      return { status: r.status, body: j };
    } catch (e) { clearTimeout(to); return { status: 0, body: { error: 'network error' } }; }
  }

  async function refresh() {
    if (!token()) { state = { email: null, prefs: {}, ready: true }; notify(); return state; }
    const { status, body } = await api('/auth/me');
    if (status === 200 && body.authenticated) {
      state = { email: body.email, prefs: body.prefs || {}, ready: true };
    } else if (status === 200 && !body.authenticated) {
      setToken(null);  // session expired/invalid
      state = { email: null, prefs: {}, ready: true };
    } else {
      // network error — keep token, mark ready but unknown (don't wipe session)
      state.ready = true;
    }
    notify();
    return state;
  }

  async function register(email, password) {
    const { status, body } = await api('/auth/register', { method: 'POST', body: { email, password } });
    if (status === 200 && body.ok) { setToken(body.token); state = { email: body.email, prefs: {}, ready: true }; notify(); return { ok: true, email: body.email }; }
    return { error: body.error || ('register failed (' + status + ')') };
  }
  async function login(email, password) {
    const { status, body } = await api('/auth/login', { method: 'POST', body: { email, password } });
    if (status === 200 && body.ok) { setToken(body.token); state = { email: body.email, prefs: {}, ready: true }; notify(); return { ok: true, email: body.email }; }
    return { error: body.error || ('login failed (' + status + ')') };
  }
  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
    setToken(null); state = { email: null, prefs: {}, ready: true }; notify();
  }
  async function savePrefs(prefs) {
    if (!token()) return { error: 'not logged in' };
    const { status, body } = await api('/auth/prefs', { method: 'POST', body: { prefs } });
    if (status === 200 && body.ok) { state.prefs = body.prefs || {}; notify(); return { ok: true }; }
    return { error: body.error || 'save failed' };
  }

  // ---- nav pill rendering ----
  function renderPill() {
    let slot = document.getElementById('bp-auth-slot');
    if (!slot) {
      // create a fixed top-right pill if the nav didn't provide a slot
      slot = document.createElement('div');
      slot.id = 'bp-auth-slot';
      slot.style.cssText = 'position:fixed;top:10px;right:14px;z-index:9997;font-family:Inter,sans-serif;';
      document.body.appendChild(slot);
    }
    if (state.email) {
      const name = state.email.length > 22 ? state.email.slice(0, 20) + '…' : state.email;
      slot.innerHTML = '<a href="my-account.html" style="display:inline-block;padding:6px 12px;border-radius:20px;background:rgba(16,185,129,0.14);color:var(--green,#10b981);font-size:12px;font-weight:700;text-decoration:none;border:1px solid rgba(16,185,129,0.35);">● ' + name + '</a>';
    } else {
      slot.innerHTML = '<a href="login.html" style="display:inline-block;padding:6px 14px;border-radius:20px;background:rgba(0,212,255,0.12);color:var(--accent,#00d4ff);font-size:12px;font-weight:800;text-decoration:none;border:1px solid rgba(0,212,255,0.4);">Log in / Sign up — free</a>';
    }
  }

  function onChange(cb) { subs.add(cb); cb({ email: state.email, prefs: state.prefs, ready: state.ready }); return () => subs.delete(cb); }

  window.Auth = {
    register, login, logout, refresh, savePrefs,
    user: () => state.email ? { email: state.email } : null,
    isLoggedIn: () => !!state.email,
    token, prefs: () => state.prefs, onChange,
    workerUrl
  };

  // Render pill on load + on every auth change.
  function boot() {
    renderPill();
    onChange(renderPill);
    refresh();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 300);
    else document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 300));
  }
})();
