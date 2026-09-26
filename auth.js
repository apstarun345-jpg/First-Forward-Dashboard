/* Auth: login / signup screen, session, permissions (FF.auth.can). Admin manages users in Settings → Users. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const state = { user: null, permissions: [], settings: null, ready: false };

  async function api(path, method, body) {
    const res = await fetch(path, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (!res.ok) { const err = new Error((json && json.error) || `HTTP ${res.status}`); err.status = res.status; throw err; }
    return json || {};
  }

  function can(perm) {
    const u = state.user;
    if (!u) return false;
    if (u.role === 'admin') return true;
    return (u.permissions || []).includes(perm);
  }
  function isAdmin() { return !!(state.user && state.user.role === 'admin'); }
  function applySettings(settings) { if (settings) { state.settings = settings; FF.config.apply(settings); applyTheme(); } }
  function applyTheme() {
    const t = FF.config.theme || {};
    const r = document.documentElement.style;
    if (t.sidebarBg) r.setProperty('--side-bg', t.sidebarBg);
    if (t.sidebarBg2) r.setProperty('--side-bg2', t.sidebarBg2);
    if (t.sidebarText) r.setProperty('--side-ink', t.sidebarText);
    if (t.accent) r.setProperty('--brand', t.accent);
    if (t.accent2) r.setProperty('--brand-2', t.accent2);
    document.title = FF.config.appName;
    const brand = U.$('#brand-name'); if (brand) brand.textContent = FF.config.brand;
    const tag = U.$('#brand-tag'); if (tag) tag.textContent = FF.config.tagline || 'Dashboard';
    const logo = U.$('#brand-logo');
    if (logo) { logo.innerHTML = FF.config.logo ? `<img src="${esc(FF.config.logo)}" alt="logo">` : esc((FF.config.brand || 'FF').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()); logo.classList.toggle('has-img', !!FF.config.logo); }
  }

  // ---- login / signup screen -------------------------------------------------------------------
  function screen(html) {
    let el = U.$('#auth-screen');
    if (!el) { el = U.h('<div id="auth-screen" class="auth-screen"></div>'); document.body.appendChild(el); }
    el.innerHTML = html;
    el.hidden = false;
    document.body.classList.add('auth-open');
    return el;
  }
  function hideScreen() { const el = U.$('#auth-screen'); if (el) el.hidden = true; document.body.classList.remove('auth-open'); }

  function formHtml(mode, msg) {
    const c = FF.config;
    const logo = c.logo ? `<img class="auth-logo" src="${esc(c.logo)}" alt="">` : `<div class="auth-logo mono-logo">${esc((c.brand || 'FF').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</div>`;
    const hero = c.loginImage ? `<div class="auth-hero" style="background-image:url('${esc(c.loginImage)}')"></div>` : `<div class="auth-hero gradient"><div class="auth-hero-text"><h2>${esc(c.brand)}</h2><p>FASTag issuance · stock · agent performance — ek jagah.</p><ul><li>📊 Live dashboard & trends</li><li>📦 Stock search + Excel export</li><li>🏆 Agent & TL performance</li></ul></div></div>`;
    const signupOk = c.allowSignup !== false;
    return `<div class="auth-card">
      ${hero}
      <div class="auth-form">
        <div class="auth-brand">${logo}<div><b>${esc(c.appName)}</b><small>${esc(c.tagline || 'Dashboard')}</small></div></div>
        <div class="seg auth-tabs"><button class="seg-btn ${mode === 'login' ? 'on' : ''}" data-mode="login">Login</button>${signupOk ? `<button class="seg-btn ${mode === 'signup' ? 'on' : ''}" data-mode="signup">Sign up</button>` : ''}</div>
        <form id="auth-form" autocomplete="on">
          ${mode === 'signup' ? `<label>Full name<input name="name" class="input" required maxlength="80" placeholder="Aapka naam"></label>` : ''}
          <label>Username<input name="username" class="input" required minlength="3" maxlength="60" placeholder="e.g. rahul" autocapitalize="none" autocomplete="username"></label>
          ${mode === 'signup' ? `<div class="two"><label>Mobile <small>(optional)</small><input name="mobile" class="input" inputmode="tel" placeholder="98xxxxxxxx"></label><label>Email <small>(optional)</small><input name="email" class="input" type="email" placeholder="you@mail.com"></label></div>` : ''}
          <label>Password<input name="password" class="input" type="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" placeholder="min 6 characters"></label>
          <div id="auth-msg" class="auth-msg ${msg && msg.kind ? msg.kind : ''}">${msg ? esc(msg.text) : ''}</div>
          <button class="btn primary big" type="submit">${mode === 'signup' ? 'Create account' : 'Login'}</button>
          <p class="dim small auth-note">${mode === 'signup' ? 'Account banne ke baad admin approve karega aur access set karega.' : 'Access nahi hai? Admin se account / permission maango.'}</p>
        </form>
      </div></div>`;
  }
  function showLogin(mode, msg) {
    const el = screen(formHtml(mode || 'login', msg));
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => showLogin(b.dataset.mode)));
    const form = U.$('#auth-form', el);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const btn = form.querySelector('button[type=submit]');
      const msgEl = U.$('#auth-msg', el);
      btn.disabled = true; msgEl.className = 'auth-msg'; msgEl.textContent = mode === 'signup' ? 'Account ban raha hai…' : 'Login ho raha hai…';
      try {
        const out = await api(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', 'POST', data);
        if (out.pending) { showLogin('login', { kind: 'ok', text: out.message || 'Account ban gaya — admin approval ke baad login karo.' }); return; }
        state.user = out.user; state.permissions = out.permissions || state.permissions; applySettings(out.settings);
        hideScreen();
        FF.app && FF.app.onLogin && FF.app.onLogin(out.first);
      } catch (err) {
        msgEl.className = 'auth-msg err'; msgEl.textContent = err.message;
        btn.disabled = false;
      }
    });
    setTimeout(() => { const f = form.querySelector('input'); f && f.focus(); }, 50);
  }

  async function init() {
    try {
      const me = await api('/api/auth/me');
      state.permissions = me.permissions || [];
      applySettings(me.settings);
      if (me.user) { state.user = me.user; state.ready = true; return true; }
    } catch (err) {
      console.error(err);
      // static hosting / server down → app cannot work without the proxy + auth
      screen(`<div class="auth-card single"><div class="auth-form"><h2>Server se connect nahi hua</h2><p class="dim">${esc(err.message)}</p><button class="btn primary" onclick="location.reload()">Retry</button></div></div>`);
      return false;
    }
    showLogin('login');
    return false;
  }
  async function logout() {
    try { await api('/api/auth/logout', 'POST', {}); } catch { /* ignore */ }
    state.user = null;
    location.hash = '';
    location.reload();
  }
  function onExpired() {
    if (!state.user) return;
    state.user = null;
    showLogin('login', { kind: 'err', text: 'Session khatam ho gaya — dobara login karo.' });
  }

  FF.auth = { init, can, isAdmin, logout, api, showLogin, onExpired, applySettings, applyTheme, get user() { return state.user; }, get permissions() { return state.permissions; }, get settings() { return state.settings; } };
})(window.FF);
