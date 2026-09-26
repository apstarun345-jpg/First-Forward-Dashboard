/* Auth: animated login / signup screen, forgot-password flow, session, permissions (FF.auth.can).
   Admin manages users in Settings → Users & access / Access matrix.
   Login flow: form → "Logging in…" animation → "Welcome back, <name>!" splash → dashboard. */
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
  /** Avatar <img> or initials bubble for any user object. */
  function avatarHtml(user, cls) {
    const u = user || state.user || {};
    const name = String(u.name || u.username || 'U').trim();
    const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    if (u.avatar) return `<span class="av ${cls || ''}"><img src="${esc(u.avatar)}" alt="${esc(name)}"></span>`;
    return `<span class="av mono ${cls || ''}">${esc(initials)}</span>`;
  }
  const roleLabel = (u) => (!u ? '' : u.role === 'admin' ? '👑 Admin' : 'User');

  function applySettings(settings) { if (settings) { state.settings = settings; FF.config.apply(settings); applyTheme(); } }
  function applyTheme() {
    const t = FF.config.theme || {};
    const r = document.documentElement.style;
    if (t.sidebarBg) r.setProperty('--side-bg', t.sidebarBg);
    if (t.sidebarBg2) r.setProperty('--side-bg2', t.sidebarBg2);
    if (t.sidebarText) r.setProperty('--side-ink', t.sidebarText);
    if (t.accent) r.setProperty('--brand', t.accent);
    if (t.accent2) r.setProperty('--brand-2', t.accent2);
    if (t.gvAccent) r.setProperty('--gv', t.gvAccent);
    document.title = FF.config.appName;
    const brand = U.$('#brand-name'); if (brand) brand.textContent = FF.config.brand;
    const tag = U.$('#brand-tag'); if (tag) tag.textContent = FF.config.tagline || 'Dashboard';
    const logo = U.$('#brand-logo');
    if (logo) { logo.innerHTML = FF.config.logo ? `<img src="${esc(FF.config.logo)}" alt="logo">` : esc((FF.config.brand || 'FF').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()); logo.classList.toggle('has-img', !!FF.config.logo); }
    const favicon = U.$('#site-favicon');
    if (favicon) { favicon.href = FF.config.logo || 'favicon.svg'; favicon.type = FF.config.logo ? ((FF.config.logo.match(/^data:(image\/[^;]+)/) || [])[1] || 'image/png') : 'image/svg+xml'; }
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
  const logoHtml = (size) => (FF.config.logo
    ? `<img class="auth-logo ${size || ''}" src="${esc(FF.config.logo)}" alt="">`
    : `<div class="auth-logo mono-logo ${size || ''}">${esc((FF.config.brand || 'FF').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</div>`);

  function visualHtml() {
    const c = FF.config;
    const hero = c.loginImage
      ? `<div class="auth-visual-img" style="background-image:url('${esc(c.loginImage)}')"></div>`
      : '';
    return `<div class="auth-visual">
      <div class="auth-mesh"></div>
      ${hero}
      <div class="auth-visual-inner">
        <div class="auth-brand-big">${logoHtml('big')}<div><b>${esc(c.brand || 'First Forward')}</b><small>${esc(c.tagline || 'Dashboard')}</small></div></div>
        <h2 class="auth-visual-title">Do dashboard, ek hi login.</h2>
        <p class="auth-visual-sub">First Forward (EIR · StockDataa · REPORT) aur GV Partner (GV Master · Tag Assignment · GV REPORT) — issuance, stock, trend aur performance ek jagah.</p>
        <ul class="auth-points">
          <li><span>📊</span> First Forward dashboard & trend</li>
          <li><span>🚀</span> GV Partner dashboard & stock</li>
          <li><span>⚖️</span> GV vs First Forward comparison</li>
          <li><span>🏆</span> Agent &amp; TL performance + Excel export</li>
        </ul>
        <div class="auth-float a1"><b>MTD Issuance</b><em>live</em></div>
        <div class="auth-float a2"><b>VC4 vs Commercial</b><em>compare</em></div>
        <div class="auth-float a3"><b>GV + FF</b><em>alag alag</em></div>
      </div>
    </div>`;
  }

  function formHtml(mode, msg) {
    const c = FF.config;
    const signupOk = c.allowSignup !== false;
    return `<div class="auth-shell">
      ${visualHtml()}
      <div class="auth-panel">
        <div class="auth-card">
          <div class="auth-brand-sm">${logoHtml()}<div><b>${esc(c.appName)}</b><small>${esc(c.tagline || 'Dashboard')}</small></div></div>
          <p class="auth-mobile-intro">📊 <b>Issuance, stock aur performance</b> ek hi colourful dashboard me — First Forward aur GV Partner ka clear comparison, daily report alerts ke saath.</p>
          <div class="seg auth-tabs"><button class="seg-btn ${mode === 'login' ? 'on' : ''}" data-mode="login">Login</button>${signupOk ? `<button class="seg-btn ${mode === 'signup' ? 'on' : ''}" data-mode="signup">Sign up</button>` : ''}</div>
          <form id="auth-form" autocomplete="on" novalidate>
            ${mode === 'signup' ? `<label>Full name<input name="name" class="input" required maxlength="80" placeholder="Aapka naam" autocomplete="name"></label>` : ''}
            <label>Username<input name="username" class="input" required minlength="3" maxlength="60" placeholder="e.g. tarun" autocapitalize="none" autocomplete="username"></label>
            ${mode === 'signup' ? `<div class="two"><label>Mobile <small>(optional)</small><input name="mobile" class="input" inputmode="tel" placeholder="98xxxxxxxx" autocomplete="tel"></label><label>Email <small>(optional)</small><input name="email" class="input" type="email" placeholder="you@mail.com" autocomplete="email"></label></div>` : ''}
            <label>Password<span class="pw-wrap"><input name="password" class="input" type="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" placeholder="min 6 characters"><button type="button" class="pw-eye" data-eye title="Password dikhao / chhupao">👁</button></span></label>
            <div class="auth-row">
              <label class="check small"><input type="checkbox" id="auth-remember" checked> <span>Mujhe yaad rakho</span></label>
              <button type="button" class="link-btn" id="auth-forgot">Forgot password?</button>
            </div>
            <div id="auth-msg" class="auth-msg ${msg && msg.kind ? msg.kind : ''}">${msg ? esc(msg.text) : ''}</div>
            <button class="btn primary big auth-submit" type="submit"><span class="btn-label">${mode === 'signup' ? 'Create account' : 'Login'}</span></button>
            <div class="auth-progress" id="auth-progress" hidden><div class="auth-progress-bar"></div></div>
            <p class="dim small auth-note">${mode === 'signup' ? 'Account banne ke baad admin approve karega aur access set karega.' : 'Access nahi hai? Admin se account / permission maango.'}</p>
          </form>
        </div>
        <p class="auth-foot dim small">${esc(c.brand || '')} · Data Google Sheet se live aata hai${state.settings && state.settings.updatedAt ? ` · settings updated ${U.timeLabel(new Date(state.settings.updatedAt).getTime())}` : ''}</p>
      </div>
    </div>`;
  }

  /** Forgot-password panel: step 1 = request to admin, step 2 = redeem 6-digit code. */
  function forgotHtml(step, msg, help) {
    const wa = (help && help.whatsapp) ? U.waLink('Hi, mujhe apna dashboard password reset karwana hai.', help.whatsapp) : '';
    const mail = (help && help.email) ? U.mailLink('Password reset request', 'Mera dashboard account ka password reset kar dijiye.', help.email) : '';
    return `<div class="auth-shell">
      ${visualHtml()}
      <div class="auth-panel">
        <div class="auth-card">
          <div class="auth-brand-sm">${logoHtml()}<div><b>Password reset</b><small>${esc(FF.config.appName)}</small></div></div>
          <div class="seg auth-tabs"><button class="seg-btn ${step === 'ask' ? 'on' : ''}" data-fstep="ask">1 · Request</button><button class="seg-btn ${step === 'code' ? 'on' : ''}" data-fstep="code">2 · Code se reset</button></div>
          ${step === 'ask' ? `<form id="forgot-form">
            <p class="dim small">Apna username ya registered email daalo — request admin ke paas jayegi aur wo aapko naya password ya 6-digit code dega.</p>
            <label>Username / Email<input name="username" class="input" required placeholder="tarun ya tarun@mail.com" autocapitalize="none"></label>
            <div id="auth-msg" class="auth-msg ${msg ? msg.kind || '' : ''}">${msg ? esc(msg.text) : ''}</div>
            <button class="btn primary big" type="submit">📨 Request bhejo</button>
            <div class="btn-row" style="margin-top:10px">${wa ? `<a class="btn small" href="${esc(wa)}" target="_blank" rel="noopener">🟢 Admin ko WhatsApp</a>` : ''}${mail ? `<a class="btn small" href="${esc(mail)}">✉️ Email admin</a>` : ''}</div>
            <p class="dim small">Admin Settings → Users &amp; access → “Reset requests” me aapki request dekh lega.</p>
          </form>` : `<form id="reset-form">
            <p class="dim small">Admin se mila 6-digit code aur naya password daalo. Code 30 minute tak valid hai.</p>
            <label>Username<input name="username" class="input" required autocapitalize="none"></label>
            <label>6-digit code<input name="code" class="input mono" required inputmode="numeric" maxlength="8" placeholder="123456"></label>
            <div class="two"><label>Naya password<input name="password" class="input" type="password" required minlength="6" autocomplete="new-password"></label><label>Dobara likho<input name="password2" class="input" type="password" required minlength="6" autocomplete="new-password"></label></div>
            <div id="auth-msg" class="auth-msg ${msg ? msg.kind || '' : ''}">${msg ? esc(msg.text) : ''}</div>
            <button class="btn primary big" type="submit">🔓 Password set karo</button>
          </form>`}
          <button class="link-btn" id="auth-back" style="margin-top:12px">← Login par wapas</button>
        </div>
      </div>
    </div>`;
  }

  function showLogin(mode, msg) {
    const el = screen(formHtml(mode || 'login', msg));
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => showLogin(b.dataset.mode)));
    el.querySelectorAll('[data-eye]').forEach((b) => b.addEventListener('click', () => {
      const inp = b.parentElement.querySelector('input');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      b.classList.toggle('on', inp.type === 'text');
    }));
    U.$('#auth-forgot', el).addEventListener('click', () => showForgot('ask'));
    const remembered = localStorage.getItem('ff_user');
    if (remembered) { const inp = el.querySelector('input[name=username]'); if (inp && !inp.value) inp.value = remembered; }
    const form = U.$('#auth-form', el);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const btn = form.querySelector('button[type=submit]');
      const msgEl = U.$('#auth-msg', el);
      const progress = U.$('#auth-progress', el);
      const anim = FF.config.loginAnimation !== false;
      btn.disabled = true;
      btn.classList.add('busy');
      btn.querySelector('.btn-label').textContent = mode === 'signup' ? 'Account ban raha hai…' : 'Login ho raha hai…';
      if (progress) progress.hidden = !anim;
      msgEl.className = 'auth-msg'; msgEl.textContent = '';
      try {
        const out = await api(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', 'POST', data);
        if (out.pending) {
          btn.disabled = false; btn.classList.remove('busy'); btn.querySelector('.btn-label').textContent = 'Create account';
          if (progress) progress.hidden = true;
          showLogin('login', { kind: 'ok', text: out.message || 'Account ban gaya — admin approval ke baad login karo.' });
          return;
        }
        state.user = out.user; state.permissions = out.permissions || state.permissions; applySettings(out.settings);
        if (U.$('#auth-remember', el) && U.$('#auth-remember', el).checked) localStorage.setItem('ff_user', data.username || '');
        else localStorage.removeItem('ff_user');
        if (anim) { await splash(state.user); } else hideScreen();
        hideScreen();
        FF.app && FF.app.onLogin && FF.app.onLogin(out.first);
        welcomeToast(state.user, out.first);
      } catch (err) {
        msgEl.className = 'auth-msg err';
        msgEl.textContent = err.message;
        btn.disabled = false; btn.classList.remove('busy');
        btn.querySelector('.btn-label').textContent = mode === 'signup' ? 'Create account' : 'Login';
        if (progress) progress.hidden = true;
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      }
    });
    setTimeout(() => { const f = form.querySelector('input'); f && f.focus(); }, 60);
  }

  function showForgot(step, msg, help) {
    const el = screen(forgotHtml(step, msg, help || (state.settings && state.settings.contacts) || {}));
    el.querySelectorAll('[data-fstep]').forEach((b) => b.addEventListener('click', () => showForgot(b.dataset.fstep)));
    U.$('#auth-back', el).addEventListener('click', () => showLogin('login'));
    const ask = U.$('#forgot-form', el);
    if (ask) ask.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(ask).entries());
      const btn = ask.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Bhej rahe hain…';
      try { const out = await api('/api/auth/forgot', 'POST', { username: data.username }); showForgot('ask', { kind: out.found ? 'ok' : 'warn', text: out.message }, out.help); }
      catch (err) { showForgot('ask', { kind: 'err', text: err.message }); }
    });
    const rset = U.$('#reset-form', el);
    if (rset) rset.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(rset).entries());
      const msgEl = U.$('#auth-msg', el);
      if (data.password !== data.password2) { msgEl.className = 'auth-msg err'; msgEl.textContent = 'Dono passwords match nahi karte.'; return; }
      const btn = rset.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Set kar rahe hain…';
      try { const out = await api('/api/auth/reset', 'POST', { username: data.username, code: data.code, password: data.password }); showLogin('login', { kind: 'ok', text: out.message }); }
      catch (err) { msgEl.className = 'auth-msg err'; msgEl.textContent = err.message; btn.disabled = false; btn.textContent = '🔓 Password set karo'; }
    });
  }

  // ---- "Welcome back" splash + toast -----------------------------------------------------------
  function splash(user) {
    return new Promise((resolve) => {
      const name = (user && (user.name || user.username)) || '';
      const el = U.h(`<div class="welcome-splash" id="welcome-splash">
        <div class="welcome-inner">
          <div class="welcome-ring"><span>✓</span></div>
          <h2>Welcome back, <b>${esc(name)}</b>!</h2>
          <p class="welcome-role">${user && user.role === 'admin' ? '👑 Admin access' : 'User access'} · dashboard load ho raha hai…</p>
          <div class="welcome-bar"><i></i></div>
        </div>
      </div>`);
      document.body.appendChild(el);
      document.body.classList.add('auth-open');
      const done = () => { el.classList.add('out'); setTimeout(() => { el.remove(); document.body.classList.remove('auth-open'); resolve(); }, 320); };
      el.addEventListener('click', done);
      setTimeout(done, 1700);
    });
  }
  function welcomeToast(user, first) {
    const name = (user && (user.name || user.username)) || '';
    if (first) setTimeout(() => U.toast('👑 Aap pehle user ho — aap admin ban gaye', 'ok'), 500);
    setTimeout(() => U.toast(`Welcome back, ${name} 👋`, 'ok'), first ? 1200 : 400);
  }

  async function init() {
    try {
      const me = await api('/api/auth/me');
      state.permissions = me.permissions || [];
      applySettings(me.settings);
      if (me.user) { state.user = me.user; state.ready = true; return true; }
    } catch (err) {
      console.error(err);
      screen(`<div class="auth-shell single"><div class="auth-panel"><div class="auth-card"><h2>Server se connect nahi hua</h2><p class="dim">${esc(err.message)}</p><button class="btn primary" onclick="location.reload()">Retry</button></div></div></div>`);
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
  /** Refresh cached user after a profile / avatar change. */
  async function refreshUser() {
    const me = await api('/api/auth/me');
    if (me.user) { state.user = me.user; applySettings(me.settings); }
    return state.user;
  }

  FF.auth = {
    init, can, isAdmin, logout, api, showLogin, showForgot, onExpired, applySettings, applyTheme, avatarHtml, roleLabel, refreshUser, splash,
    get user() { return state.user; }, get permissions() { return state.permissions; }, get settings() { return state.settings; }
  };
})(window.FF);
