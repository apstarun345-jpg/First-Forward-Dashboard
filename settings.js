/* Settings page. Every user: My account (profile, password, permissions). Admin: branding & images, theme colours,
   data source (sheet / gid / column letters / excluded TLs), thresholds, contacts & sharing, users & access, backup. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, A = FF.auth;
  const esc = U.esc;
  const TABS = [['account', '👤 My account'], ['brand', '🎨 Branding & images'], ['data', '🗂️ Data source'], ['rules', '📐 Thresholds'], ['contacts', '📲 Contacts & sharing'], ['users', '🔐 Users & access'], ['backup', '💾 Backup']];
  let tab = 'account';
  let settings = null, defaults = null, usersCache = null, permsCache = [];

  const field = (label, input, hint) => `<label class="fld"><span>${label}</span>${input}${hint ? `<small class="dim">${hint}</small>` : ''}</label>`;
  const txt = (path, value, attrs) => `<input class="input" data-path="${esc(path)}" value="${esc(value ?? '')}" ${attrs || ''}>`;
  const numI = (path, value, attrs) => `<input class="input" type="number" data-path="${esc(path)}" value="${esc(value ?? '')}" ${attrs || ''}>`;
  const color = (path, value) => `<span class="color-wrap"><input type="color" data-path="${esc(path)}" value="${esc(value || '#000000')}"><code>${esc(value || '')}</code></span>`;
  const check = (path, value, label) => `<label class="check"><input type="checkbox" data-path="${esc(path)}" ${value ? 'checked' : ''}> ${label}</label>`;
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
  const setPath = (obj, path, v) => { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach((k) => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); o[ks[ks.length - 1]] = v; };
  const section = (title, body, sub) => `<section class="card"><div class="card-head"><h3>${title}</h3>${sub ? `<div class="card-right dim">${sub}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const saveBar = (id) => `<div class="save-bar"><button class="btn primary" data-save="${id}">💾 Save</button><span class="dim small" id="save-msg-${id}"></span></div>`;

  async function loadSettings() {
    const out = await A.api('/api/settings');
    settings = JSON.parse(JSON.stringify(out.settings)); defaults = out.defaults;
  }
  async function save(patch, msgEl, opts) {
    try {
      if (msgEl) msgEl.textContent = 'Saving…';
      const out = await A.api('/api/settings', 'PUT', { settings: patch });
      settings = JSON.parse(JSON.stringify(out.settings));
      A.applySettings(out.settings);
      FF.app.renderSidebar();
      if (msgEl) msgEl.textContent = `Saved ✓ ${U.timeLabel(Date.now())}`;
      U.toast('Settings saved ✓', 'ok');
      if (opts && opts.reload) { U.toast('Sheet mapping badli — data dobara load ho raha hai…'); FF.store.reset(); if (FF.pages.performance.reset) FF.pages.performance.reset(); FF.store.preload(false).catch(() => {}); }
    } catch (err) { if (msgEl) msgEl.textContent = ''; U.toast(err.message, 'err'); }
  }
  function collect(root, base) {
    const patch = JSON.parse(JSON.stringify(base || {}));
    U.$$('[data-path]', root).forEach((el) => {
      const p = el.dataset.path;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number') v = el.value === '' ? null : Number(el.value);
      else v = el.value;
      if (el.dataset.list !== undefined) v = String(v).split(',').map((s) => s.trim()).filter(Boolean);
      if (v !== null) setPath(patch, p, v);
    });
    return patch;
  }
  // resize an image file → data URL
  function readImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error('Sirf image file (PNG / JPG / WEBP / SVG)'));
      if (file.type === 'image/svg+xml') { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const png = file.type === 'image/png' || file.type === 'image/gif';
        resolve(png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load nahi hui')); };
      img.src = url;
    });
  }

  // ---- tabs --------------------------------------------------------------------------------------
  function accountTab() {
    const u = A.user;
    const perms = A.permissions || [];
    return `${section('👤 Profile', `<div class="form-grid">${field('Username', `<input class="input" value="${esc(u.username)}" disabled>`)}${field('Full name', `<input class="input" id="pf-name" value="${esc(u.name || '')}">`)}${field('Mobile', `<input class="input" id="pf-mobile" value="${esc(u.mobile || '')}" inputmode="tel">`)}${field('Email', `<input class="input" id="pf-email" type="email" value="${esc(u.email || '')}">`)}</div><div class="save-bar"><button class="btn primary" id="pf-save">💾 Save profile</button><span class="dim small">Role: <b>${u.role === 'admin' ? '👑 Admin' : 'User'}</b> · joined ${u.createdAt ? U.timeLabel(new Date(u.createdAt).getTime()) : '—'}</span></div>`)}
      ${section('🔑 Change password', `<div class="form-grid">${field('Current password', '<input class="input" id="pw-cur" type="password" autocomplete="current-password">')}${field('New password', '<input class="input" id="pw-new" type="password" minlength="6" autocomplete="new-password">')}${field('Repeat new password', '<input class="input" id="pw-new2" type="password" minlength="6" autocomplete="new-password">')}</div><div class="save-bar"><button class="btn primary" id="pw-save">🔑 Update password</button>${u.mustChangePassword ? '<span class="badge red">Default password — please change</span>' : ''}</div>`)}
      ${section('🛡️ My access', `<div class="perm-grid">${perms.map((p) => `<div class="perm ${A.can(p.key) ? 'yes' : 'no'}"><span>${A.can(p.key) ? '✅' : '⛔'}</span><b>${esc(p.label)}</b><small class="dim">${esc(p.group)}</small></div>`).join('')}</div>${u.role === 'admin' ? '<p class="dim small">Admin ke paas sab access hota hai.</p>' : '<p class="dim small">Access badalna ho to admin se kaho.</p>'}`)}`;
  }
  function brandTab() {
    const s = settings, t = s.theme || {};
    const img = (key, label, hint, max) => `<div class="img-field"><div class="img-preview ${key}">${s[key] ? `<img src="${esc(s[key])}" alt="">` : '<span class="dim">No image</span>'}</div><div><b>${label}</b><small class="dim">${hint}</small><div class="btn-row"><label class="btn small">📤 Upload<input type="file" accept="image/*" hidden data-img="${key}" data-max="${max}"></label>${s[key] ? `<button class="btn small" data-img-clear="${key}">✕ Remove</button>` : ''}</div></div></div>`;
    return `${section('🏷️ Branding', `<div class="form-grid">${field('App name', txt('appName', s.appName), 'Browser title / login page')}${field('Brand (sidebar)', txt('brand', s.brand))}${field('Tagline', txt('tagline', s.tagline))}</div>${saveBar('brand')}`)}
      ${section('🖼️ Images', `${img('logo', 'Logo', 'Sidebar + login page (square works best, PNG with transparency). Auto-resized to 512px.', 512)}${img('loginImage', 'Login / hero image', 'Left side of the login page (landscape). Auto-resized to 1600px.', 1600)}<p class="dim small">Images server par save hoti hain (settings.json) — upload karte hi live.</p>`)}
      ${section('🎨 Theme colours', `<div class="form-grid">${field('Sidebar background (top)', color('theme.sidebarBg', t.sidebarBg))}${field('Sidebar background (bottom)', color('theme.sidebarBg2', t.sidebarBg2))}${field('Sidebar text', color('theme.sidebarText', t.sidebarText))}${field('Accent', color('theme.accent', t.accent))}${field('Accent 2 (gradient)', color('theme.accent2', t.accent2))}</div><p class="dim small">Colour badalte hi preview dikhta hai; Save karne par sabke liye lagta hai.</p>${saveBar('theme')}<button class="btn small" data-reset-theme>↺ Default colours</button>`)}`;
  }
  function dataTab() {
    const s = settings;
    const letters = (obj, keys, prefix) => `<div class="letter-grid">${keys.map((k) => `<label><small>${k}</small><input class="input mono" data-path="${prefix}.${k}" value="${esc(obj[k] ?? '')}"></label>`).join('')}</div>`;
    return `${section('📄 Google Sheet', `<div class="form-grid">${field('Sheet ID', txt('sheetId', s.sheetId, 'class="input mono"'), 'docs.google.com/spreadsheets/d/<b>ID</b>/edit — sheet "Anyone with the link can view" honi chahiye')}${field('EIR tab name', txt('eirSheet', s.eirSheet))}${field('StockDataa tab name', txt('stockSheet', s.stockSheet))}${field('StockDataa gid (optional)', txt('stockGid', s.stockGid))}${field('REPORT gid', txt('reportGid', s.reportGid), 'Google URL me #gid=… (REPORT tab)')}${field('Server cache (seconds)', numI('cacheSeconds', s.cacheSeconds, 'min="0"'), 'Browser reload par itni der tak server ka cached data milta hai; ↻ button hamesha fresh laata hai')}</div>
        <div class="form-grid">${field('Excluded TL names (not real TLs)', `<input class="input" data-path="excludeTls" data-list value="${esc((s.excludeTls || []).join(', '))}">`, 'Comma separated. Ye naam kisi bhi TL list / ranking me nahi aayenge (e.g. APS = direct agents)')}${field('GV master ID', txt('eir.gvMasterId', s.eir.gvMasterId))}${field('GV channel TL name', txt('eir.gvChannelTl', s.eir.gvChannelTl))}</div>${saveBar('data')}`)}
      ${section('🔠 EIR column letters', letters(s.eir, ['tagId', 'vrn', 'cls', 'type', 'status', 'date', 'agentId', 'agentName', 'masterId', 'tlId', 'gvId', 'gvName', 'gvTl', 'tlName', 'vrnType', 'monthName', 'regNumber'], 'eir') + saveBar('eir'), 'Sheet me column shift ho to sirf letters badlo')}
      ${section('🔠 StockDataa column letters', letters(s.stock, ['id', 'name', 'tagId', 'barcode', 'cls', 'tagType', 'bcAllocatedAt', 'agentId', 'agentName', 'agentAllocatedAt', 'tlName'], 'stock') + saveBar('stock'))}`;
  }
  function rulesTab() {
    const t = settings.thresholds || {};
    return section('📐 Thresholds & display', `<div class="form-grid">${field('Stock cover 🔴 red below (days)', numI('thresholds.coverRed', t.coverRed, 'min="0"'))}${field('Stock cover 🟠 orange below (days)', numI('thresholds.coverOrange', t.coverOrange, 'min="0"'))}${field('Stock cover 🟡 amber below (days)', numI('thresholds.coverAmber', t.coverAmber, 'min="0"'), '🟢 green above this')}${field('"Went quiet" after (inactive days)', numI('thresholds.inactiveDays', t.inactiveDays, 'min="1"'))}${field('Top N in rankings', numI('thresholds.topN', t.topN, 'min="3" max="50"'))}${field('Default rows per page', numI('pageSize', settings.pageSize, 'min="10" max="500"'))}</div>${check('allowSignup', settings.allowSignup !== false, 'Login page par "Sign up" allow karo (naye account admin approval ke baad hi chalte hain)')}${saveBar('rules')}`);
  }
  function contactsTab() {
    const c = settings.contacts || {};
    return section('📲 Contacts & sharing', `<div class="form-grid">${field('Team WhatsApp number', txt('contacts.teamWhatsapp', c.teamWhatsapp, 'inputmode="tel" placeholder="91xxxxxxxxxx"'), 'WhatsApp buttons is number par khulenge (blank = number choose karo)')}${field('Team email', txt('contacts.teamEmail', c.teamEmail, 'type="email"'), 'Email buttons ka default "To"')}${field('WhatsApp group link', txt('contacts.teamGroupLink', c.teamGroupLink, 'placeholder="https://chat.whatsapp.com/…"'))}${field('Message signature', txt('contacts.signature', c.signature))}</div><p class="dim small">Agent / TL profile me "WhatsApp TL" button REPORT sheet ke TL mobile par jaata hai (permission "See mobile numbers" chahiye).</p>${saveBar('contacts')}`);
  }
  async function usersTab(root) {
    const out = await A.api('/api/users');
    usersCache = out.users; permsCache = out.permissions;
    const groups = [...new Set(permsCache.map((p) => p.group))];
    const permBoxes = (u) => groups.map((g) => `<div class="perm-group"><small class="dim">${esc(g)}</small>${permsCache.filter((p) => p.group === g).map((p) => `<label class="check"><input type="checkbox" data-perm="${esc(p.key)}" ${u.role === 'admin' || u.permissions.includes(p.key) ? 'checked' : ''} ${u.role === 'admin' ? 'disabled' : ''}> ${esc(p.label)}</label>`).join('')}</div>`).join('');
    const rows = usersCache.map((u) => `<div class="user-card ${u.approved ? '' : 'pending'}" data-user="${esc(u.username)}">
        <div class="user-head"><span class="user-avatar big">${esc((u.name || u.username).slice(0, 1).toUpperCase())}</span><div class="user-meta"><b>${esc(u.name)}</b> <code>${esc(u.username)}</code>${u.username === A.user.username ? ' <span class="tag">you</span>' : ''}<small class="dim">${esc(u.email || '')}${u.mobile ? ` · ${esc(u.mobile)}` : ''} · joined ${u.createdAt ? U.timeLabel(new Date(u.createdAt).getTime()) : '—'} · last login ${u.lastLoginAt ? U.timeLabel(new Date(u.lastLoginAt).getTime()) : 'never'}</small></div>
          <div class="user-controls"><label class="check"><input type="checkbox" data-field="approved" ${u.approved ? 'checked' : ''}> ${u.approved ? 'Active' : '<b class="pend">Pending approval</b>'}</label><select data-field="role"><option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></div></div>
        <details class="user-perms" ${u.approved ? '' : 'open'}><summary>Permissions (${u.role === 'admin' ? 'all — admin' : `${u.permissions.length}/${permsCache.length}`})</summary><div class="perm-boxes">${permBoxes(u)}</div><div class="btn-row"><button class="btn small" data-perm-all>Select all</button><button class="btn small" data-perm-none>Clear</button><button class="btn small" data-perm-default>Default set</button></div></details>
        <div class="btn-row user-actions"><button class="btn small primary" data-user-save>💾 Save</button><button class="btn small" data-user-pw>🔑 Reset password</button>${u.username !== A.user.username ? '<button class="btn small danger" data-user-del>🗑 Delete</button>' : ''}<span class="dim small" data-user-msg></span></div>
      </div>`).join('');
    root.innerHTML = `${section(`🔐 Users <span class="dim">(${usersCache.length} · ${usersCache.filter((u) => !u.approved).length} pending)</span>`, `<p class="dim small">Naya user sign up karta hai → yahan "Pending" dikhega → Active tick karo, permissions choose karo, Save. Admin ke paas sab access hota hai.</p><div class="user-list">${rows}</div>`)}
      ${section('➕ Add user directly', `<div class="form-grid"><label class="fld"><span>Username</span><input class="input" id="nu-username" autocapitalize="none"></label><label class="fld"><span>Full name</span><input class="input" id="nu-name"></label><label class="fld"><span>Password</span><input class="input" id="nu-password" type="text" value="${Math.random().toString(36).slice(2, 10)}"></label><label class="fld"><span>Role</span><select id="nu-role"><option value="user">User</option><option value="admin">Admin</option></select></label><label class="fld"><span>Mobile</span><input class="input" id="nu-mobile"></label><label class="fld"><span>Email</span><input class="input" id="nu-email"></label></div><div class="save-bar"><button class="btn primary" id="nu-add">➕ Create user</button><span class="dim small">Default permissions milengi; baad me edit karo. Password user ko bata do (pehle login par badalne ko kaha jaayega).</span></div>`)}`;
    root.querySelectorAll('.user-card').forEach((card) => {
      const username = card.dataset.user;
      const msg = card.querySelector('[data-user-msg]');
      const roleSel = card.querySelector('[data-field="role"]');
      roleSel.addEventListener('change', () => { card.querySelectorAll('[data-perm]').forEach((cb) => { cb.disabled = roleSel.value === 'admin'; if (roleSel.value === 'admin') cb.checked = true; }); });
      card.querySelector('[data-perm-all]').addEventListener('click', () => card.querySelectorAll('[data-perm]').forEach((cb) => { cb.checked = true; }));
      card.querySelector('[data-perm-none]').addEventListener('click', () => card.querySelectorAll('[data-perm]').forEach((cb) => { cb.checked = false; }));
      card.querySelector('[data-perm-default]').addEventListener('click', () => card.querySelectorAll('[data-perm]').forEach((cb) => { cb.checked = out.defaults.includes(cb.dataset.perm); }));
      card.querySelector('[data-user-save]').addEventListener('click', async () => {
        const body = { approved: card.querySelector('[data-field="approved"]').checked, role: roleSel.value, permissions: [...card.querySelectorAll('[data-perm]')].filter((cb) => cb.checked).map((cb) => cb.dataset.perm) };
        msg.textContent = 'Saving…';
        try { await A.api(`/api/users/${encodeURIComponent(username)}`, 'PUT', body); msg.textContent = 'Saved ✓'; U.toast(`${username} updated ✓`, 'ok'); if (username === A.user.username) setTimeout(() => location.reload(), 600); else usersTab(root); } catch (err) { msg.textContent = ''; U.toast(err.message, 'err'); }
      });
      card.querySelector('[data-user-pw]').addEventListener('click', async () => {
        const pw = prompt(`Naya password for ${username} (min 6 chars):`, Math.random().toString(36).slice(2, 10));
        if (!pw) return;
        try { await A.api(`/api/users/${encodeURIComponent(username)}`, 'PUT', { password: pw }); U.toast(`Password reset ✓ — user ko bata do: ${pw}`, 'ok'); await U.copyText(pw); } catch (err) { U.toast(err.message, 'err'); }
      });
      const del = card.querySelector('[data-user-del]');
      if (del) del.addEventListener('click', async () => { if (!confirm(`Delete user "${username}"?`)) return; try { await A.api(`/api/users/${encodeURIComponent(username)}`, 'DELETE'); U.toast('Deleted', 'ok'); usersTab(root); } catch (err) { U.toast(err.message, 'err'); } });
    });
    U.$('#nu-add', root).addEventListener('click', async () => {
      const body = { username: U.$('#nu-username', root).value, name: U.$('#nu-name', root).value, password: U.$('#nu-password', root).value, role: U.$('#nu-role', root).value, mobile: U.$('#nu-mobile', root).value, email: U.$('#nu-email', root).value };
      try { await A.api('/api/users', 'POST', body); U.toast(`User ${body.username} created ✓ (password: ${body.password})`, 'ok'); usersTab(root); } catch (err) { U.toast(err.message, 'err'); }
    });
  }
  function backupTab() {
    return `${section('💾 Backup / restore settings', `<p class="dim small">Render free plan par disk ephemeral hoti hai — har deploy ke baad settings/users reset ho sakte hain. Isliye settings ka JSON download karke rakho, aur Render par <code>ADMIN_USER</code> / <code>ADMIN_PASSWORD</code> env set rakho (admin hamesha bana rahega). Persistent disk ho to <code>DATA_DIR</code> set karo.</p><div class="btn-row"><button class="btn" id="bk-export">⬇ Download settings JSON</button><label class="btn">📤 Import settings JSON<input type="file" accept="application/json" hidden id="bk-import"></label></div>`)}
      ${section('🧹 Maintenance', `<div class="btn-row"><button class="btn" id="bk-cache">🧹 Clear server cache</button><button class="btn danger" id="bk-reset">↺ Reset ALL settings to defaults</button></div><p class="dim small">Last saved: ${settings.updatedAt ? `${U.timeLabel(new Date(settings.updatedAt).getTime())} by ${esc(settings.updatedBy || '')}` : 'never'}</p>`)}`;
  }

  // ---- page ------------------------------------------------------------------------------------
  async function render(root, params) {
    const admin = A.isAdmin();
    if (params.tab && TABS.some((t) => t[0] === params.tab)) tab = params.tab;
    if (!admin) tab = 'account';
    root.innerHTML = `<div class="page-head"><div><h1>⚙️ Settings</h1><p class="sub">${admin ? 'Har cheez yahin se modify karo — branding, images, colours, sheet mapping, thresholds, contacts, users & access' : 'Profile, password aur aapka access'}</p></div></div>
      ${admin ? `<div class="card controls"><div class="seg" id="set-tabs">${TABS.map(([k, l]) => `<button class="seg-btn ${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div></div>` : ''}
      <div id="set-body">${U.spinner('Settings load ho rahi hain…')}</div>`;
    const body = U.$('#set-body', root);
    try { if (admin) await loadSettings(); } catch (err) { body.innerHTML = U.errorBox(err); return; }
    const draw = async () => {
      U.$$('#set-tabs .seg-btn', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      history.replaceState(null, '', `#/settings?tab=${tab}`);
      if (tab === 'account') body.innerHTML = accountTab();
      else if (tab === 'brand') body.innerHTML = brandTab();
      else if (tab === 'data') body.innerHTML = dataTab();
      else if (tab === 'rules') body.innerHTML = rulesTab();
      else if (tab === 'contacts') body.innerHTML = contactsTab();
      else if (tab === 'backup') body.innerHTML = backupTab();
      else if (tab === 'users') { body.innerHTML = U.spinner('Users…'); await usersTab(body); }
      bindTab();
    };
    function bindTab() {
      // account
      const pfSave = U.$('#pf-save', body);
      if (pfSave) pfSave.addEventListener('click', async () => { try { await A.api('/api/auth/profile', 'POST', { name: U.$('#pf-name', body).value, mobile: U.$('#pf-mobile', body).value, email: U.$('#pf-email', body).value }); U.toast('Profile saved ✓', 'ok'); const me = await A.api('/api/auth/me'); if (me.user) { Object.assign(A.user, me.user); FF.app.renderSidebar(); } } catch (err) { U.toast(err.message, 'err'); } });
      const pwSave = U.$('#pw-save', body);
      if (pwSave) pwSave.addEventListener('click', async () => {
        const cur = U.$('#pw-cur', body).value, n1 = U.$('#pw-new', body).value, n2 = U.$('#pw-new2', body).value;
        if (n1 !== n2) return U.toast('Naye passwords match nahi karte', 'err');
        try { const out = await A.api('/api/auth/password', 'POST', { current: cur, next: n1 }); Object.assign(A.user, out.user); U.toast('Password updated ✓', 'ok'); draw(); } catch (err) { U.toast(err.message, 'err'); }
      });
      // generic save buttons
      U.$$('[data-save]', body).forEach((btn) => btn.addEventListener('click', () => {
        const card = btn.closest('.card');
        const patch = collect(card, {});
        const msg = U.$(`#save-msg-${btn.dataset.save}`, body);
        const reload = ['data', 'eir', 'stock'].includes(btn.dataset.save);
        save(patch, msg, { reload });
      }));
      // live colour preview
      U.$$('input[type=color][data-path]', body).forEach((inp) => inp.addEventListener('input', () => { inp.nextElementSibling.textContent = inp.value; const t = { ...FF.config.theme }; t[inp.dataset.path.split('.')[1]] = inp.value; FF.config.theme = t; A.applyTheme(); }));
      const rt = U.$('[data-reset-theme]', body);
      if (rt) rt.addEventListener('click', () => save({ theme: defaults.theme }, null).then(draw));
      // images
      U.$$('input[type=file][data-img]', body).forEach((inp) => inp.addEventListener('change', async () => {
        const file = inp.files[0]; if (!file) return;
        try { const dataUrl = await readImage(file, Number(inp.dataset.max) || 512); if (dataUrl.length > 1.8 * 1024 * 1024) throw new Error('Image bahut badi hai — chhoti image use karo'); await save({ [inp.dataset.img]: dataUrl }, null); draw(); } catch (err) { U.toast(err.message, 'err'); }
      }));
      U.$$('[data-img-clear]', body).forEach((b) => b.addEventListener('click', () => save({ [b.dataset.imgClear]: '' }, null).then(draw)));
      // backup
      const ex = U.$('#bk-export', body);
      if (ex) ex.addEventListener('click', () => { const s = { ...settings }; U.downloadBlob(`ff-settings-${U.stamp()}.json`, new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' })); });
      const im = U.$('#bk-import', body);
      if (im) im.addEventListener('change', async () => { const f = im.files[0]; if (!f) return; try { const json = JSON.parse(await f.text()); if (!json || typeof json !== 'object') throw new Error('Invalid JSON'); delete json.updatedAt; delete json.updatedBy; await save(json, null, { reload: true }); draw(); } catch (err) { U.toast(err.message, 'err'); } });
      const cc = U.$('#bk-cache', body);
      if (cc) cc.addEventListener('click', async () => { try { await A.api('/api/cache/clear', 'POST', {}); U.toast('Server cache cleared ✓ — ab ↻ dabao', 'ok'); } catch (err) { U.toast(err.message, 'err'); } });
      const rs = U.$('#bk-reset', body);
      if (rs) rs.addEventListener('click', async () => { if (!confirm('Sab settings default par reset karni hain? (users delete nahi honge)')) return; try { const out = await A.api('/api/settings', 'PUT', { reset: true }); settings = out.settings; A.applySettings(out.settings); FF.app.renderSidebar(); U.toast('Reset ✓', 'ok'); draw(); } catch (err) { U.toast(err.message, 'err'); } });
    }
    root.addEventListener('click', (e) => { const t = e.target.closest('#set-tabs .seg-btn'); if (t) { tab = t.dataset.tab; draw(); } });
    await draw();
  }

  FF.pages.settings = { title: 'Settings', render };
})(window.FF);
