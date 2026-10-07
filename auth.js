/* Auth: professional login / signup screen with company logos, pure English, no overlapping.
   GADIVAN = GV Partner, FIRST forward = IDFC First Forward Toll & Fuel, ApnaPayment with pure yellow triangle. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const state = { user: null, permissions: [], settings: null, ready: false };

  // 👁 v3.35 — view-as preview: admin khud ko kisi user ke rights me temporarily dekh sakta hai.
  // Sirf VIEW overlay hai — session/data real admin ka rehta hai. sessionStorage me rehta hai
  // (tab refresh par preview bana rahe), lekin init() me validate hota hai: real admin hi preview
  // me reh sakta hai; logout par clear.
  const VIEWAS_KEY = 'ff_viewas';
  let viewAs = null; // { username, name, role, permissions: [], mobile?, email?, avatar? }
  function viewAsRestore() {
    try {
      const raw = sessionStorage.getItem(VIEWAS_KEY);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (v && v.username && Array.isArray(v.permissions)) viewAs = v;
    } catch { /* corrupt/absent — ignore */ }
  }
  function viewAsPersist() {
    try {
      if (viewAs) sessionStorage.setItem(VIEWAS_KEY, JSON.stringify(viewAs));
      else sessionStorage.removeItem(VIEWAS_KEY);
    } catch { /* ignore */ }
  }
  viewAsRestore();

  async function api(path, method, body) {
    const controller = new AbortController();
    const isAuthCall = /^\/api\/auth\//.test(path);
    const timer = setTimeout(() => controller.abort(), isAuthCall ? 25000 : 60000);
    let res;
    try { res = await fetch(path, { signal: controller.signal, method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' }); } finally { clearTimeout(timer); }
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (!res.ok) { const err = new Error((json && json.error) || `HTTP ${res.status}`); err.status = res.status; err.data = json; throw err; }
    return json || {};
  }

  function can(perm) {
    // 👁 preview on hai to sirf target user ke permissions lagte hain (admin bypass nahi).
    if (viewAs) return viewAs.role === 'admin' || (viewAs.permissions || []).includes(perm);
    const u = state.user;
    if (!u) return false;
    if (u.role === 'admin') return true;
    return (u.permissions || []).includes(perm);
  }
  function isAdmin() {
    if (viewAs) return viewAs.role === 'admin';
    return !!(state.user && state.user.role === 'admin');
  }
  /** 👁 Preview mode me target user ka pseudo-user (display ke liye) — off ho to null. */
  function viewingAs() { return viewAs; }
  function startViewAs(user) {
    // Sirf REAL admin account se shuru ho sakta hai (preview mode me nahi — wahan tab tak
    // Users tab bhi khula nahi hota, phir bhi guard hai).
    if (!state.user || state.user.role !== 'admin' || !user || !user.username) return false;
    viewAs = {
      username: String(user.username),
      name: String(user.name || user.username),
      role: user.role === 'admin' ? 'admin' : 'user',
      permissions: Array.isArray(user.permissions) ? user.permissions.slice() : [],
      mobile: user.mobile || '', email: user.email || '', avatar: user.avatar || ''
    };
    viewAsPersist();
    return true;
  }
  function stopViewAs() {
    if (!viewAs) return false;
    viewAs = null;
    viewAsPersist();
    return true;
  }
  function avatarHtml(user, cls) {
    const u = user || state.user || {};
    const name = String(u.name || u.username || 'U').trim();
    const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    if (u.avatar) return `<span class="av ${cls || ''}"><img src="${esc(u.avatar)}" alt="${esc(name)}"></span>`;
    return `<span class="av mono ${cls || ''}\">${esc(initials)}</span>`;
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
    if (logo) { logo.innerHTML = FF.config.logo ? `<img src="${esc(FF.config.logo)}\" alt=\"logo\">` : esc((FF.config.brand || 'FF').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()); logo.classList.toggle('has-img', !!FF.config.logo); }
    // App/tab identity stays ApnaPayment; uploaded branding still controls the sidebar.
    const fc = U.$('#app-footer-copy'); if (fc) fc.textContent = '© 2026 ' + (FF.config.footerText || FF.config.appName || 'First Forward Dashboard');
    const fd = U.$('#app-footer-dev'); if (fd) fd.textContent = 'Designed & Developed by ' + (FF.config.developerName || 'Tarun Kumawat');
    const footer = U.$('#app-footer'); if (footer) footer.hidden = FF.config.showFooter === false;
    const favicon = U.$('#site-favicon');
    if (favicon) { favicon.href = 'favicon.svg?v=5'; favicon.type = 'image/svg+xml'; }
  }

  function screen(html) {
    let el = U.$('#auth-screen');
    if (!el) { el = U.h('<div id="auth-screen" class="auth-screen pro"></div>'); document.body.appendChild(el); }
    el.innerHTML = html;
    el.hidden = false;
    if (typeof window.__FF_FINISH_BOOT === 'function') window.__FF_FINISH_BOOT(); else { const boot = U.$('#app-boot'); if (boot) boot.remove(); }
    document.body.classList.add('auth-open');
    return el;
  }
  function hideScreen() { const el = U.$('#auth-screen'); if (el) el.hidden = true; document.body.classList.remove('auth-open'); }
  const logoHtml = (size) => (FF.config.logo
    ? `<img class="auth-logo ${size || ''}" src="${esc(FF.config.logo)}" alt="">`
    : `<div class="auth-logo mono-logo ${size || ''}">${esc((FF.config.brand || 'FF').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</div>`);

  // ---- Professional visual v4: ApnaPayment big text top, GADIVAN + FIRST forward below, pure English ----
  function visualHtml() {
    return `<div class="auth-visual pro-visual v4">
      <div class="pro-bg"></div>
      <div class="pro-grid"></div>
      <div class="pro-glow g1"></div>
      <div class="pro-glow g2"></div>
      <div class="auth-visual-inner pro-inner v4-inner">
        <!-- ApnaPayment Company - Perfectly Centered, Professional, No Background -->
        <div class="apna-top centered">
          <div class="apna-logo-wrap">
            <div class="apna-text-logo">
              <span class="apna-a">A</span>pnaPayment
              <span class="apna-tri">▶</span>
            </div>
            <div class="apna-sub">Revolutionary Payment Solution</div>
          </div>
          <div class="apna-company-label">ApnaPayment Company • Powering FASTag Ecosystem • GV Partner & First Forward Dashboard</div>
        </div>
        
        <h2 class="pro-title">Unified FASTag Intelligence Platform</h2>
        <p class="pro-sub">Enterprise-grade dashboard for toll and fuel payment operations. Monitor, analyze, and optimize your FASTag business across First Forward and GV Partner channels.</p>

        <div class="pro-features">
          <div class="pf-card"><div class="pf-icon" style="background:#eef2ff;color:#4f46e5">📊</div><div><b>First Forward Dashboard</b><span>EIR issuance log, StockDataa inventory, REPORT performance. Real-time KPIs, VC4 vs Commercial breakdown, agent and TL rankings.</span></div></div>
          <div class="pf-card"><div class="pf-icon" style="background:#ccfbf1;color:#0d9488">🚀</div><div><b>GV Partner - GADIVAN</b><span>GV Master issuance, Tag Assignment stock, GV REPORT. Complete partner performance tracking and dispatch alerts.</span></div></div>
          <div class="pf-card"><div class="pf-icon" style="background:#fef3c7;color:#d97706">⚖️</div><div><b>Comparative Intelligence</b><span>Side-by-side GV vs First Forward comparison, daily MTD trends, projected month-end, class-wise growth analysis.</span></div></div>
          <div class="pf-card"><div class="pf-icon" style="background:#fce7f3;color:#db2777">🏷️</div><div><b>Tag Issued Insights</b><span>Date-wise detailed issuance — select any date to view VC4, Commercial, class-wise up/down trends for both channels.</span></div></div>
        </div>

        <div class="pro-stats-row">
          <div class="ps-item"><b>⚡ Fast Sync</b><small>Background preload — instant sheet open</small></div>
          <div class="ps-item"><b>📦 Stock Intelligence</b><small>Days cover, low stock alerts, dispatch priority</small></div>
          <div class="ps-item"><b>🏆 Performance</b><small>Agent & TL rankings, Excel export, WhatsApp share</small></div>
        </div>

      </div>
    </div>`;
  }

  function formHtml(mode, msg) {
    const c = FF.config;
    const signupOk = c.allowSignup !== false;
    return `<div class="auth-shell pro-shell login-only-shell">
      <div class="auth-panel pro-panel">
        <div class="auth-card pro-card">
          <div class="auth-brand-sm pro-brand-sm login-app-brand">
            <b class="login-app-name">${esc(c.appName)}</b>
          </div>
          
          <div class="pro-login-header">
            <h3>Secure Login</h3>
            <p>Access your FASTag operations dashboard. Professional, fast, and secure.</p>
          </div>

          <div class="seg auth-tabs pro-tabs"><button class="seg-btn ${mode === 'login' ? 'on' : ''}" data-mode="login">Login</button>${signupOk ? `<button class="seg-btn ${mode === 'signup' ? 'on' : ''}" data-mode="signup">Create Account</button>` : ''}</div>
          
          <form id="auth-form" autocomplete="on" novalidate class="pro-form">
            ${mode === 'signup' ? `<label class="pro-label"><span>Full Name</span><input name="name" class="input pro-input" required maxlength="80" placeholder="Enter your full name" autocomplete="name"></label>` : ''}
            <label class="pro-label"><span>${mode === 'signup' ? 'Username' : 'Username / Mobile Number / Email'}</span><input name="username" class="input pro-input" required ${mode === 'signup' ? 'minlength="3" maxlength="60"' : 'minlength="2" maxlength="120"'} placeholder="${mode === 'signup' ? 'Choose a username' : 'Enter username, mobile number or email'}" autocapitalize="none" autocomplete="username" ${mode !== 'signup' ? 'inputmode="text"' : ''}></label>
            ${mode === 'signup' ? `<div class="two"><label class="pro-label"><span>Mobile Number</span><input name="mobile" class="input pro-input" inputmode="tel" placeholder="Enter mobile number" autocomplete="tel"></label><label class="pro-label"><span>Email Address</span><input name="email" class="input pro-input" type="email" placeholder="Enter email address" autocomplete="email"></label></div>` : '<div class="pro-hint">💡 You can login with username, mobile number or email + password</div>'}
            <label class="pro-label"><span>Password</span><span class="pw-wrap"><input name="password" class="input pro-input" type="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" placeholder="Enter password (min 6 characters)"><button type="button" class="pw-eye" data-eye title="Show / Hide password">👁</button></span></label>
            <div class="auth-row pro-row">
              <label class="check small"><input type="checkbox" id="auth-remember" checked> <span>Remember me</span></label>
              <button type="button" class="link-btn pro-link" id="auth-forgot">Forgot password?</button>
            </div>
            <div id="auth-msg" class="auth-msg ${msg && msg.kind ? msg.kind : ''}">${msg ? esc(msg.text) : ''}</div>
            <button class="btn primary big auth-submit pro-submit" type="submit"><span class="btn-label">${mode === 'signup' ? 'Create Account' : 'Login to Dashboard'}</span></button>
            <div class="auth-progress" id="auth-progress" hidden><div class="auth-progress-bar"></div></div>
            
            <div class="pro-info-box">
              <b>Dashboard Capabilities:</b>
              <ul>
                <li>📊 <b>Issuance Tracking</b> — Daily, MTD, projected, VC4 vs Commercial</li>
                <li>📦 <b>Inventory Management</b> — Stock in field, days cover, dispatch priority</li>
                <li>🏆 <b>Performance Analytics</b> — Agent & TL rankings, growth trends</li>
                <li>🏷️ <b>Date-wise Reports</b> — GV & FF Tag Issued detailed view</li>
                <li>⚡ <b>Fast & Secure</b> — Background sync, PWA installable, location tracking</li>
              </ul>
            </div>

            <p class="dim small pro-note">${mode === 'signup' ? 'New account requires admin approval. You will receive access after verification.' : 'Need access? Contact your administrator for account creation and permissions.'}</p>
          </form>
        </div>
        <p class="auth-foot dim small pro-foot">© 2026 ${esc(c.footerText || c.appName || c.brand || 'First Forward Dashboard')} • <strong class="developer-credit">Designed &amp; Developed by Tarun Kumawat</strong><br><span>${esc(c.brand || '')} • Live data from Google Sheets • Secure &amp; Enterprise Ready${state.settings && state.settings.updatedAt ? ` • Updated ${U.timeLabel(new Date(state.settings.updatedAt).getTime())}` : ''}</span></p>
      </div>
    </div>`;
  }

  function forgotHtml(step, msg, help) {
    const wa = (help && help.whatsapp) ? U.waLink('Hello, I need to reset my dashboard password.', help.whatsapp) : '';
    const mail = (help && help.email) ? U.mailLink('Password Reset Request', 'Please reset my dashboard account password.', help.email) : '';
    return `<div class="auth-shell pro-shell">
      ${visualHtml()}
      <div class="auth-panel pro-panel">
        <div class="auth-card pro-card">
          <div class="auth-brand-sm pro-brand-sm">${logoHtml()}<div><b>Password Reset</b><small>${esc(FF.config.appName)}</small></div></div>
          <div class="seg auth-tabs pro-tabs"><button class="seg-btn ${step === 'ask' ? 'on' : ''}" data-fstep="ask">1. Request</button><button class="seg-btn ${step === 'code' ? 'on' : ''}" data-fstep="code">2. Reset with Code</button></div>
          ${step === 'ask' ? `<form id="forgot-form">
            <p class="dim small">Enter your username, email or mobile. Your request will be sent to the administrator who will provide a new password or 6-digit code.</p>
            <label class="pro-label"><span>Username / Email / Mobile</span><input name="username" class="input pro-input" required placeholder="username, email or mobile" autocapitalize="none"></label>
            <div id="auth-msg" class="auth-msg ${msg ? msg.kind || '' : ''}">${msg ? esc(msg.text) : ''}</div>
            <button class="btn primary big pro-submit" type="submit">Send Request</button>
            <div class="btn-row" style="margin-top:10px">${wa ? `<a class="btn small" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp Admin</a>` : ''}${mail ? `<a class="btn small" href="${esc(mail)}">Email Admin</a>` : ''}</div>
          </form>` : `<form id="reset-form">
            <p class="dim small">Enter the 6-digit code received from admin and set a new password. Code is valid for 30 minutes. You can use username, email or mobile.</p>
            <label class="pro-label"><span>Username / Email / Mobile</span><input name="username" class="input pro-input" required autocapitalize="none" placeholder="username, email or mobile"></label>
            <label class="pro-label"><span>6-digit Code</span><input name="code" class="input mono pro-input" required inputmode="numeric" maxlength="8" placeholder="123456"></label>
            <div class="two"><label class="pro-label"><span>New Password</span><input name="password" class="input pro-input" type="password" required minlength="6" autocomplete="new-password"></label><label class="pro-label"><span>Confirm Password</span><input name="password2" class="input pro-input" type="password" required minlength="6" autocomplete="new-password"></label></div>
            <div id="auth-msg" class="auth-msg ${msg ? msg.kind || '' : ''}">${msg ? esc(msg.text) : ''}</div>
            <button class="btn primary big pro-submit" type="submit">Set New Password</button>
          </form>`}
          <button class="link-btn pro-link" id="auth-back" style="margin-top:12px">← Back to Login</button>
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
    let remembered = '';
    try { remembered = localStorage.getItem('ff_user') || ''; } catch { /* cookies still restore the session when browser storage is blocked */ }
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
      btn.querySelector('.btn-label').textContent = mode === 'signup' ? 'Creating account...' : 'Authenticating...';
      if (progress) progress.hidden = !anim;
      msgEl.className = 'auth-msg'; msgEl.textContent = '';
      try {
        const out = await api(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', 'POST', data);
        if (out.pending) {
          btn.disabled = false; btn.classList.remove('busy'); btn.querySelector('.btn-label').textContent = 'Create Account';
          if (progress) progress.hidden = true;
          showLogin('login', { kind: 'ok', text: out.message || 'Account created — waiting for admin approval.' });
          return;
        }
        state.user = out.user; state.permissions = out.permissions || state.permissions; applySettings(out.settings);
        try {
          if (U.$('#auth-remember', el) && U.$('#auth-remember', el).checked) localStorage.setItem('ff_user', data.username || '');
          else localStorage.removeItem('ff_user');
        } catch { /* username hint is optional; never block a successful login */ }
        hideScreen();
        FF.app && FF.app.onLogin && FF.app.onLogin(out.first);
        welcomeToast(state.user, out.first);
        try { dispatchEvent(new CustomEvent('ff-login', { detail: { first: !!out.first, user: state.user } })); } catch { /* non-browser */ }
      } catch (err) {
        // 🔐 Naye IP OTP: server 428 bhejta hai → OTP screen dikhao.
        if (err.status === 428 && err.data && err.data.otpRequired && mode !== 'signup') { showOtp(err.data); return; }
        msgEl.className = 'auth-msg err';
        msgEl.textContent = err.message;
        btn.disabled = false; btn.classList.remove('busy');
        btn.querySelector('.btn-label').textContent = mode === 'signup' ? 'Create Account' : 'Login to Dashboard';
        if (progress) progress.hidden = true;
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      }
    });
    setTimeout(() => { const f = form.querySelector('input'); f && f.focus(); }, 60);
  }

  // 📱 OTP screen — code email par aata hai; sahi ho to wahi login success path chalte hai.
  function showOtp(data, msg) {
    const ticket = String(data.ticket || '');
    const el = screen(`<div class="auth-card pro-card" style="max-width:430px">
      <div class="auth-head">${logoHtml('lg')}<div><div class="auth-title">🔐 Verification code</div>
      <div class="auth-sub">${esc(data.hint || 'Email par 6-digit code bheja gaya')}</div></div></div>
      <div class="auth-msg${msg ? (msg.kind === 'ok' ? '' : ' err') : ''}" id="auth-msg">${msg ? esc(msg.text) : ''}</div>
      <form id="otp-form" class="auth-fields" autocomplete="one-time-code">
        <label class="auth-label">OTP (6 digits)</label>
        <input name="code" class="auth-input" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="••••••" required autofocus>
        <button type="submit" class="btn primary wide" style="margin-top:14px"><span class="btn-label">Verify &amp; Continue</span></button>
      </form>
      <div class="auth-foot"><a href="#" id="otp-back">← Wapas login</a><span class="auth-hint">Code 10 min valid hai</span></div>
    </div>`);
    U.$('#otp-back', el).addEventListener('click', (e) => { e.preventDefault(); showLogin('login'); });
    const form = U.$('#otp-form', el);
    setTimeout(() => { const i = form.querySelector('input'); i && i.focus(); }, 60);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      const msgEl = U.$('#auth-msg', el);
      btn.disabled = true; btn.querySelector('.btn-label').textContent = 'Verifying...';
      msgEl.className = 'auth-msg'; msgEl.textContent = '';
      try {
        const out = await api('/api/auth/otp', 'POST', { ticket, code: new FormData(form).get('code') });
        state.user = out.user; state.permissions = out.permissions || state.permissions; applySettings(out.settings);
        hideScreen();
        FF.app && FF.app.onLogin && FF.app.onLogin(false);
        welcomeToast(state.user, false);
        try { dispatchEvent(new CustomEvent('ff-login', { detail: { first: false, user: state.user } })); } catch { /* non-browser */ }
      } catch (err) {
        msgEl.className = 'auth-msg err';
        msgEl.textContent = err.message || 'OTP verify fail';
        btn.disabled = false; btn.querySelector('.btn-label').textContent = 'Verify & Continue';
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      }
    });
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
      btn.disabled = true; btn.textContent = 'Sending...';
      try { const out = await api('/api/auth/forgot', 'POST', { username: data.username }); showForgot('ask', { kind: out.found ? 'ok' : 'warn', text: out.message }, out.help); }
      catch (err) { showForgot('ask', { kind: 'err', text: err.message }); }
    });
    const rset = U.$('#reset-form', el);
    if (rset) rset.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(rset).entries());
      const msgEl = U.$('#auth-msg', el);
      if (data.password !== data.password2) { msgEl.className = 'auth-msg err'; msgEl.textContent = 'Passwords do not match.'; return; }
      const btn = rset.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Setting...';
      try { const out = await api('/api/auth/reset', 'POST', { username: data.username, code: data.code, password: data.password }); showLogin('login', { kind: 'ok', text: out.message }); }
      catch (err) { msgEl.className = 'auth-msg err'; msgEl.textContent = err.message; btn.disabled = false; btn.textContent = 'Set New Password'; }
    });
  }

  function splash(user) {
    // Non-blocking welcome: data loads immediately and navigation stays usable.
    const old = U.$('#welcome-splash'); if (old) old.remove();
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = user && (user.name || user.username) || '';
    const el = U.h(`<section class="welcome-greeting" id="welcome-splash" role="status" aria-live="polite">
      <img src="icon-192.png?v=5" alt="ApnaPayment" width="48" height="48">
      <div><small>APNAPAYMENT · YOUR WORKSPACE</small><h2>${greeting}, ${esc(name)} <span class="greeting-wave">👋</span></h2><p>Welcome back. Your sheets are getting ready in the background.</p></div>
      <button class="icon-btn" aria-label="Dismiss welcome">✕</button></section>`);
    document.body.appendChild(el);
    let timer;
    const done = () => { clearTimeout(timer); el.remove(); };
    el.querySelector('button').addEventListener('click', done);
    timer = setTimeout(done, 4200);
  }
  function welcomeToast(user, first) {
    const name = (user && (user.name || user.username)) || '';
    if (first) setTimeout(() => U.toast('👑 You are the first user — admin privileges granted', 'ok'), 500);
    setTimeout(() => U.toast(`Welcome back, ${name} 👋`, 'ok'), first ? 1200 : 400);
  }

  async function init() {
    // Intentional logout: skip the workspace splash/API round-trip and show the real login screen immediately.
    try {
      if (sessionStorage.getItem('ff_skip_workspace_boot_once') === '1') {
        sessionStorage.removeItem('ff_skip_workspace_boot_once');
        showLogin('login');
        return false;
      }
    } catch {}
    // Render may expose the shell a few seconds before durable storage finishes loading.
    // /api/auth/me returns 503 + booting:true during that window; retry automatically
    // instead of trapping the user on a manual connection error screen.
    const maxBootRetries = 12;
    for (let attempt = 0; attempt <= maxBootRetries; attempt++) {
      try {
        const me = await api('/api/auth/me');
        state.permissions = me.permissions || [];
        applySettings(me.settings);
        if (viewAs && (!me.user || me.user.role !== 'admin')) stopViewAs();
        if (me.user) {
          state.user = me.user; state.ready = true;
          if (typeof window.__FF_FINISH_BOOT === 'function') window.__FF_FINISH_BOOT();
          else { const boot = U.$('#app-boot'); if (boot) boot.remove(); }
          return true;
        }
        showLogin('login');
        return false;
      } catch (err) {
        const booting = err && err.status === 503 && err.data && err.data.booting;
        if (booting && attempt < maxBootRetries) {
          const wait = Math.min(5000, 700 + attempt * 700);
          screen('<div class="auth-shell single"><div class="auth-panel"><div class="auth-card"><h2>Workspace starting…</h2><p class="dim">Durable storage load ho rahi hai. Automatic retry ' + (attempt + 1) + '/' + maxBootRetries + '…</p><button class="btn primary" onclick="location.reload()">Retry now</button></div></div></div>');
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }
        console.error(err);
        screen('<div class="auth-shell single"><div class="auth-panel"><div class="auth-card"><h2>Unable to connect to server</h2><p class="dim">' + esc(err.message) + '</p><button class="btn primary" onclick="location.reload()">Retry</button></div></div></div>');
        return false;
      }
    }
    return false;
  }

  async function logout() {
    // ⚡ Instant UI — don't wait for network/bootstrap/splash before showing the login page.
    try { sessionStorage.setItem('ff_skip_workspace_boot_once', '1'); } catch {}
    state.user = null;
    stopViewAs(); // 👁 preview session ke saath chala jaye
    try { localStorage.removeItem('ff_user'); } catch { /* ignore */ }
    if (FF.notifications && FF.notifications.stop) FF.notifications.stop();
    if (FF.liveAssist && FF.liveAssist.stop) FF.liveAssist.stop();
    U.toast('Logged out ✓', 'ok');
    location.hash = '';
    // Fire-and-forget server logout + reload immediately (instant feel, cookie cleared on next load).
    api('/api/auth/logout', 'POST', {}).catch(() => {});
    // Use requestAnimationFrame + microtask for a snappy reload (gives the toast a frame to paint).
    requestAnimationFrame(() => { location.replace(location.pathname); });
  }
  function onExpired() {
    if (!state.user) return;
    state.user = null;
    if (FF.preloader) FF.preloader.reset();
    FF.store.reset(); if (FF.gv) FF.gv.reset();
    if (FF.pages.sheet && FF.pages.sheet.reset) FF.pages.sheet.reset();
    if (FF.pages.performance && FF.pages.performance.reset) FF.pages.performance.reset();
    showLogin('login', { kind: 'err', text: 'Session expired — please login again.' });
  }
  async function refreshUser() {
    const me = await api('/api/auth/me');
    if (me.user) { state.user = me.user; applySettings(me.settings); }
    return state.user;
  }

  FF.auth = {
    init, can, isAdmin, logout, api, showLogin, showForgot, onExpired, applySettings, applyTheme, avatarHtml, roleLabel, refreshUser, splash,
    startViewAs, stopViewAs, viewingAs,
    get user() { return state.user; }, get permissions() { return state.permissions; }, get settings() { return state.settings; },
    get viewAsUser() { return viewAs ? { username: viewAs.username, name: viewAs.name, role: viewAs.role, mobile: viewAs.mobile || '', email: viewAs.email || '', avatar: viewAs.avatar || '', permissions: viewAs.permissions } : null; }
  };
})(window.FF);
