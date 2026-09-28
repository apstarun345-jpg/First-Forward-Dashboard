/* Settings page. Every user: My account (profile, password, permissions). Admin: branding & images, theme colours,
   data source (sheet / gid / column letters / excluded TLs), thresholds, contacts & sharing, users & access, backup. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, A = FF.auth;
  const esc = U.esc;
  const TABS = [['account', '👤 My account'], ['brand', '🎨 Branding & images'], ['sources', '🗂️ Sheets & tabs'], ['access', '🔐 Access matrix'], ['data', '🔌 Data source'], ['rules', '📐 Thresholds'], ['contacts', '📲 Contacts & sharing'], ['users', '👥 Users & access'], ['backup', '☁️ Storage & backup']];
  let tab = 'account';
  let storage = null;
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
    const [out, health] = await Promise.all([A.api('/api/settings'), A.api('/api/health').catch(() => ({}))]);
    storage = health.storage;
    settings = JSON.parse(JSON.stringify(out.settings)); defaults = out.defaults;
  }
  async function save(patch, msgEl, opts) {
    try {
      if (msgEl) msgEl.textContent = 'Saving…';
      // ⚡ Optimistic: theme/branding changes turant apply karo — UI instantly feel kare
      const optimistic = { ...settings };
      Object.keys(patch).forEach((k) => { optimistic[k] = patch[k]; });
      settings = JSON.parse(JSON.stringify(optimistic));
      A.applySettings(optimistic);
      if (patch.tabs) FF.app.renderSidebar();
      const out = await A.api('/api/settings', 'PUT', { settings: patch });
      settings = JSON.parse(JSON.stringify(out.settings));
      A.applySettings(out.settings);
      FF.app.renderSidebar();
      if (msgEl) msgEl.textContent = `Saved ✓ ${U.timeLabel(Date.now())}`;
      U.toast('Settings saved ✓', 'ok');
      if (opts && opts.reload) { U.toast('Sheet mapping badli — data dobara load ho raha hai…'); FF.store.reset(); if (FF.gv) FF.gv.reset(); if (FF.pages.sheet.reset) FF.pages.sheet.reset(); if (FF.pages.performance.reset) FF.pages.performance.reset(); FF.preloader.fastSync(false).catch(() => {}); }
    } catch (err) {
      // Rollback optimistic change on failure
      if (A.settings) { settings = JSON.parse(JSON.stringify(A.settings)); A.applySettings(A.settings); FF.app.renderSidebar(); }
      if (msgEl) msgEl.textContent = 'Not saved — retry';
      U.toast(err.message, 'err');
    }
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
  // Resize + compress an image file before it is sent as a settings data URL.
  // Attractive logo handling: auto-size, smart background, high-quality smoothing, multi-pass compression.
  // opts.square → centre-crop to a perfect square first (profile photo), so the round avatar never
  // looks zoomed / cut. opts.minSide keeps a minimum output size for logos (never upscaled beyond 1:1).
  function readImage(file, maxSide, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error('Sirf image file (PNG / JPG / WEBP / SVG)'));
      if (file.type === 'image/svg+xml') { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const isLogo = (maxSide || 512) <= 512 && !o.square;
        const keepAlpha = (file.type === 'image/png' || file.type === 'image/gif') && (isLogo || o.square);
        // Source rect: full image, or centred square crop for avatars.
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (o.square) {
          const side = Math.min(img.width, img.height);
          sx = Math.round((img.width - side) / 2); sy = Math.round((img.height - side) / 2);
          sw = side; sh = side;
        }
        let scale = Math.min(1, (maxSide || 512) / Math.max(sw, sh));
        if (isLogo && o.minSide) {
          scale = Math.max(scale, Math.min(1, o.minSide / Math.max(sw, sh)));
        }
        let data = '';
        for (let pass = 0; pass < 5; pass++) {
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(sw * scale));
          c.height = Math.max(1, Math.round(sh * scale));
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          if (keepAlpha) {
            ctx.clearRect(0,0,c.width,c.height);
          } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0,0,c.width,c.height);
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
          const mime = keepAlpha ? 'image/png' : 'image/webp';
          const quality = keepAlpha ? undefined : Math.max(.65, .92 - pass * .08);
          data = c.toDataURL(mime, quality);
          const limit = isLogo ? 600 * 1024 : 1200 * 1024;
          if (data.length <= limit * 1.37 || scale <= .28) break;
          scale *= .72;
        }
        if (!keepAlpha && data.length > 1.8 * 1024 * 1024) {
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(sw * scale * 0.6));
          c.height = Math.max(1, Math.round(sh * scale * 0.6));
          c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
          data = c.toDataURL('image/jpeg', 0.72);
        }
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load nahi hui')); };
      img.src = url;
    });
  }
  // Human-friendly size info for a stored data-URL image (e.g. "256×256 · 48 KB").
  function imgSizeInfo(dataUrl) {
    const kb = Math.max(1, Math.round(String(dataUrl || '').length * 0.75 / 1024));
    return `${kb} KB`;
  }

  // ---- tabs --------------------------------------------------------------------------------------
  function avatarBlock() {
    const u = A.user;
    const savedSize = Number(localStorage.getItem('ff_avatar_size')) || 256;
    const sizeOpts = [128, 192, 256, 384, 512].map((s) => `<option value="${s}" ${s === savedSize ? 'selected' : ''}>${s === 128 ? 'Chhota (128px)' : s === 192 ? 'Medium (192px)' : s === 256 ? 'Standard (256px)' : s === 384 ? 'Bada (384px)' : 'HD (512px)'}</option>`).join('');
    return `<div class="avatar-edit">
      <div class="avatar-big">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<span>${esc((u.name || u.username).slice(0, 1).toUpperCase())}</span>`}</div>
      <div>
        <b>Profile photo</b>
        <small class="dim">Top-right menu, sidebar aur home page par dikhti hai. Photo auto centre-crop + resize hoti hai — koi bhi image upload karo, square me sahi set ho jayegi${u.avatar ? ` · current ${imgSizeInfo(u.avatar)}` : ''}.</small>
        <div class="btn-row"><label class="btn small">📤 Photo upload<input type="file" accept="image/*" id="av-upload" hidden></label><label class="fld inline-size"><span>📐 Size</span><select class="input small" id="av-size">${sizeOpts}</select></label>${u.avatar ? '<button class="btn small" id="av-clear">✕ Remove</button>' : ''}</div>
      </div></div>`;
  }
  // ---- 🔔 Notifications (har user) + 📲 Push diagnostics (sirf admin) ------------------------------
  // Bell panel me sirf ek ON/OFF switch hai; poori fine-tuning + troubleshooting yahin rehti hai.
  const ffSwitch = (key, isOn, disabled) => `<button type="button" class="ff-switch ${isOn ? 'on' : ''}" role="switch" aria-checked="${isOn ? 'true' : 'false'}" ${disabled ? 'disabled' : ''} data-notify-switch="${esc(key)}"><span class="ff-switch-knob"></span></button>`;
  function notifyPrefsNow() {
    const N = FF.notifications || {};
    return { ...((A.user && A.user.notifyPrefs) || {}), ...(N.prefs || {}) };
  }
  function switchRow(key, label, note, isOn, disabled) {
    return `<div class="notify-switch-row"><div class="nsr-text"><b>${label}</b>${note ? `<small>${note}</small>` : ''}</div>${ffSwitch(key, isOn, disabled)}</div>`;
  }
  function notificationsSection() {
    const prefs = notifyPrefsNow();
    const on = prefs.enabled !== false;
    const types = ((FF.notifications || {}).notifyTypes || []).filter((t) => (A.isAdmin() ? t.admin : t.user));
    return section('🔔 Notifications <span class="dim">(app + mobile)</span>', `
      <p class="dim small">Har notification <b>app ke andar (bell)</b> aur <b>mobile / desktop ke notification panel</b> dono par aati hai — app band hone par bhi Web Push se phone par alert chala jaata hai. Neeche decide karo kaunsi notifications aani chahiye.</p>
      <div class="notify-switches" style="background:transparent;padding:0;border:0">
        ${switchRow('master', 'Notifications ON / OFF', on ? 'ON — app ke andar toast + phone / desktop ke notification panel par alert (app band ho tab bhi)' : 'OFF — koi alert nahi aayega (list bell me padh sakte ho)', on)}
        ${switchRow('sound', '🔊 Sound / vibration', 'Alert ke saath short beep + mobile vibration', prefs.sound !== false, !on)}
        ${switchRow('monthly', '📅 Monthly report', 'Har mahine ki 1–5 tarikh ko pichhle mahine ka FF vs GV compare', prefs.monthly !== false, !on)}
      </div>
      <details class="notify-prefs" open style="border:0;margin-top:6px"><summary>Kaunsi notifications aayengi? (type-wise on/off — in-app + mobile dono par apply)</summary>
        <div class="notify-pref-grid">${types.map((t) => `<span class="check small">${ffSwitch(t.key, prefs[t.key] !== false, !on)} ${t.label}</span>`).join('')}</div>
        <p class="dim small" style="margin:6px 2px 0">${A.isAdmin() ? '👑 Admin ko sab users ki activity aati hai — naya signup, login, search, button click, page open, settings change, report/sheet update, location — sab. Upar se type ke hisaab se ON/OFF karo.' : 'Apne liye kaunsi alerts chahiye wo upar choose karo — ye in-app + phone panel dono par lagta hai.'}</p>
        ${A.isAdmin() ? `<div class="save-bar" style="margin-top:8px"><button class="btn small primary" data-notify-all-on>🔁 Sab notifications ON karo</button><span class="dim small">Ek click me saare types chalu — signup / search / click / page open / settings / report … sab aayengi.</span></div>` : ''}
      </details>
      ${A.isAdmin() ? `<div id="push-diag-slot" class="push-diag" style="margin-top:12px"><p class="dim small">📲 Push diagnostics load ho rahi hain…</p></div>` : ''}`);
  }
  function pushDiagHtml(st, health) {
    const p = (health && health.push) || {};
    const selfTest = st.selfTest || p.selfTest || {};
    const rows = [
      ['VAPID key source', `${esc(String(st.keySource || p.keySource || 'none'))} · ${st.keyDurable || p.durable ? 'durable ✓ (redeploy par same rahegi)' : '⚠️ TEMPORARY — deploy/restart par key badal jaayegi'}`],
      ['Auth scheme + subject', `${esc(String(st.scheme || p.scheme || 'vapid'))} · ${esc(String(st.subject || ''))}`],
      ['Self test', selfTest.ok ? '✅ pass — JWT apni public key se verify ho gaya' : `🔴 FAIL — ${esc(String(selfTest.error || ''))}`],
      ['Mere devices', `${st.subs || 0}${st.staleKeySubs ? ` (⚠️ ${st.staleKeySubs} purani VAPID key wale)` : ''}`],
      ['Total devices (sab users)', String(p.devices !== undefined ? p.devices : (st.allSubs !== undefined ? st.allSubs : '—'))],
      ['TTL (retry window)', `${st.ttl || p.ttl || 0} seconds`],
      ['Aakhri delivery OK', st.lastOk ? `${esc(U.timeLabel(new Date(st.lastOk.at).getTime()))} · status ${esc(String(st.lastOk.status))} · ${esc(String(st.lastOk.host || ''))}` : '—'],
      ['Aakhri delivery fail', st.lastError ? `${esc(U.timeLabel(new Date(st.lastError.at).getTime()))} · status ${esc(String(st.lastError.status || 'network'))} · ${esc(String(st.lastError.error || '').slice(0, 140))}` : '—']
    ];
    const boxes = [];
    if (st.configError) boxes.push(`<div class="warn-box">⚠️ Push service delivery reject kar rahi hai (status ${esc(String(st.configError.status || '?'))}) — ${esc(String(st.configError.error || '').slice(0, 200))}${st.configError.hint ? `<br><small>${esc(String(st.configError.hint))}</small>` : ''}</div>`);
    if (p.warning) boxes.push(`<div class="warn-box">⚠️ ${esc(String(p.warning))}</div>`);
    if (!boxes.length) boxes.push('<div class="ok-box" style="margin:0">✅ Push pipeline theek hai — VAPID keys durable hain, self-test pass, aur delivery 2xx aa rahi hai.</div>');
    return `${boxes.join('')}
      <div class="push-diag" style="margin-top:8px">${rows.map(([k, v]) => `<div class="row"><b>${k}</b><span>${v}</span></div>`).join('')}</div>
      <div class="btn-row" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn small" data-notify-panel-test title="Phone ke notification panel me ek test alert">📳 Panel test</button>
        <button class="btn small" data-notify-push-test title="Server se is device par real web push">🛰 Server push test</button>
        <button class="btn small" id="push-force-resub" title="Purani subscription hata kar nayi banao">🔁 Force re-subscribe</button>
        <button class="btn small" id="push-copy-key" data-pubkey="${esc(String(st.publicKey || ''))}" title="applicationServerKey copy karo">🔑 Public key copy</button>
      </div>
      <p class="dim small" style="margin-top:6px">applicationServerKey (65-byte raw point): <code>${esc(String(st.publicKey || '').slice(0, 60))}…</code></p>`;
  }
  async function bindNotifications(body) {
    const slot = U.$('#push-diag-slot', body);
    if (!slot) return;
    const drawDiag = async () => {
      slot.innerHTML = '<p class="dim small">📲 Push diagnostics load ho rahi hain…</p>';
      const [st, health] = await Promise.all([A.api('/api/push/status').catch(() => ({})), A.api('/api/health').catch(() => ({}))]);
      slot.innerHTML = pushDiagHtml(st || {}, health || {});
      const force = U.$('#push-force-resub', slot);
      if (force) force.addEventListener('click', async () => {
        force.disabled = true; force.textContent = 'Re-subscribe ho raha hai…';
        try {
          const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
          if (reg && reg.active && reg.active.postMessage) reg.active.postMessage({ type: 'ff-push-resubscribe', reason: 'settings' });
          if (FF.notifications) await FF.notifications.setupPush(true, { force: true });
          U.toast('🔁 Subscription dobara ban gayi — ab Server push test dabao', 'ok');
        } catch (err) { U.toast('Re-subscribe fail: ' + ((err && err.message) || err), 'err'); }
        await new Promise((r) => setTimeout(r, 1200));
        drawDiag();
      });
      const copy = U.$('#push-copy-key', slot);
      if (copy) copy.addEventListener('click', async () => {
        try { await U.copyText(copy.dataset.pubkey || ''); U.toast('VAPID public key copy ✓', 'ok'); } catch { U.toast('Copy nahi ho paya', 'err'); }
      });
    };
    await drawDiag();
    // Test buttons notifications.js ke delegated handler se chalte hain — unke baad numbers refresh karo.
    slot.addEventListener('click', (e) => {
      if (e.target.closest('[data-notify-panel-test]') || e.target.closest('[data-notify-push-test]')) setTimeout(() => { if (document.body.contains(slot)) drawDiag(); }, 2500);
    });
  }
  function accountTab() {
    const u = A.user;
    const perms = A.permissions || [];
    const loc = u.lastLocation;
    const locationText = loc ? `Last shared: ${U.timeLabel(new Date(loc.at).getTime())} · ${loc.latitude}, ${loc.longitude}${loc.accuracy ? ` · ±${loc.accuracy}m` : ''}` : 'Location abhi share nahi ki gayi hai.';
    const locationLink = loc ? `https://www.google.com/maps?q=${encodeURIComponent(`${loc.latitude},${loc.longitude}`)}` : '';
    return `${section('👤 Profile', avatarBlock() + `<div class="form-grid">${field('Username', `<input class="input" value="${esc(u.username)}" disabled>`)}${field('Full name', `<input class="input" id="pf-name" value="${esc(u.name || '')}">`)}${field('Mobile', `<input class="input" id="pf-mobile" value="${esc(u.mobile || '')}" inputmode="tel">`)}${field('Email', `<input class="input" id="pf-email" type="email" value="${esc(u.email || '')}">`)}</div><div class="save-bar"><button class="btn primary" id="pf-save">💾 Save profile</button><span class="dim small">Role: <b>${u.role === 'admin' ? '👑 Admin' : 'User'}</b> · joined ${u.createdAt ? U.timeLabel(new Date(u.createdAt).getTime()) : '—'}</span></div>`)}
      ${section('🧭 Workspace display & activity sharing', `<p class="dim small">Left navigation panel desktop par hamesha ek jagah fixed dikhta hai. Mobile me ☰ menu button se khulta hai.</p><div class="form-grid"><label>Tag Issued default range<select class="input" id="ti-range-days"><option value="1" ${localStorage.getItem('ti_range_days') === '7' || localStorage.getItem('ti_range_days') === '30' || localStorage.getItem('ti_range_days') === '90' ? '' : 'selected'}>Latest day</option><option value="7" ${localStorage.getItem('ti_range_days') === '7' ? 'selected' : ''}>Last 7 days</option><option value="30" ${localStorage.getItem('ti_range_days') === '30' ? 'selected' : ''}>Last 30 days</option><option value="90" ${localStorage.getItem('ti_range_days') === '90' ? 'selected' : ''}>Last 90 days</option></select></label><label>Top agent / team charts<select class="input" id="ti-chart-limit"><option value="5" ${localStorage.getItem('ti_chart_limit') === '5' ? 'selected' : ''}>Top 5</option><option value="10" ${localStorage.getItem('ti_chart_limit') !== '5' && localStorage.getItem('ti_chart_limit') !== '15' && localStorage.getItem('ti_chart_limit') !== '20' ? 'selected' : ''}>Top 10</option><option value="15" ${localStorage.getItem('ti_chart_limit') === '15' ? 'selected' : ''}>Top 15</option><option value="20" ${localStorage.getItem('ti_chart_limit') === '20' ? 'selected' : ''}>Top 20</option></select></label></div><label class="check"><input type="checkbox" id="presence-share-toggle" ${localStorage.getItem('ff_presence_pointer') !== '0' ? 'checked' : ''}> Admin <b>Live view</b> share karo — khula page, scroll, live cursor aur kin buttons / cards par click kiya.</label><p class="dim small">Admin notification panel se aapka live screen view (page + cursor + actions) dekh sakta hai. Typed text / passwords kabhi share nahi hote. Is option ko kabhi bhi band kar sakte hain.</p>`)}
      ${notificationsSection()}
      ${section('📍 Location (optional, consent ke saath)', `<p class="dim small">Location sirf tab li jayegi jab aap khud “Share my location” dabayenge. Browser permission ke bina koi GPS tracking nahi hoti. Admin ko aapki last shared location dikhegi.</p><div class="location-status">${loc ? '✅' : '⚪'} ${esc(locationText)} ${locationLink ? `<a class="btn small" href="${esc(locationLink)}" target="_blank" rel="noopener">🗺️ Maps me dekho</a>` : ''}</div><div class="save-bar"><button class="btn" id="location-share">📍 Share my location</button></div>`)}
      ${section('🔑 Change password', `<div class="form-grid">${field('Current password', '<input class="input" id="pw-cur" type="password" autocomplete="current-password">')}${field('New password', '<input class="input" id="pw-new" type="password" minlength="6" autocomplete="new-password">')}${field('Repeat new password', '<input class="input" id="pw-new2" type="password" minlength="6" autocomplete="new-password">')}</div><div class="save-bar"><button class="btn primary" id="pw-save">🔑 Update password</button>${u.mustChangePassword ? '<span class="badge red">Default password — please change</span>' : ''}</div>`)}
      ${section('🛡️ My access', `<div class="perm-grid">${perms.map((p) => `<div class="perm ${A.can(p.key) ? 'yes' : 'no'}"><span>${A.can(p.key) ? '✅' : '⛔'}</span><b>${esc(p.label)}</b><small class="dim">${esc(p.group)}</small></div>`).join('')}</div>${u.role === 'admin' ? '<p class="dim small">Admin ke paas sab access hota hai.</p>' : '<p class="dim small">Access badalna ho to admin se kaho.</p>'}`)}`;
  }
  const IMG_SIZES = { logo: [256, 384, 512, 768], loginImage: [1200, 1600, 2000, 2400] };
  function brandTab() {
    const s = settings, t = s.theme || {};
    const img = (key, label, hint, max) => {
      const sizes = IMG_SIZES[key] || [max];
      const savedKey = `ff_img_size_${key}`;
      const savedSize = Number(localStorage.getItem(savedKey)) || max;
      const sizeSel = `<label class="fld inline-size"><span>📐 Size</span><select class="input small" data-img-size="${key}">${sizes.map((v) => `<option value="${v}" ${v === savedSize ? 'selected' : ''}>${v}px</option>`).join('')}</select></label>`;
      return `<div class="img-field"><div class="img-preview ${key}">${s[key] ? `<img src="${esc(s[key])}" alt="">` : '<span class="dim">No image</span>'}</div><div><b>${label}</b><small class="dim">${hint}</small><small class="dim img-info" data-img-info="${key}">${s[key] ? `Saved: ${imgSizeInfo(s[key])}` : ''}</small><div class="btn-row"><label class="btn small">📤 Upload<input type="file" accept="image/*" hidden data-img="${key}" data-max="${max}"></label>${sizeSel}${s[key] ? `<button class="btn small" data-img-clear="${key}">✕ Remove</button>` : ''}</div></div></div>`;
    };
    return `${section('🏷️ Branding', `<div class="form-grid">${field('App name', txt('appName', s.appName), 'Browser title / login page')}${field('Brand (sidebar)', txt('brand', s.brand))}${field('Tagline', txt('tagline', s.tagline))}</div>${saveBar('brand')}`)}
      ${section('🖼️ Images', `${img('logo', 'Logo', 'Sidebar + login page (square works best, PNG with transparency). Upload ke baad selected size par auto-resize hota hai.', 512)}${img('loginImage', 'Login / hero image', 'Left side of the login page (landscape). Upload ke baad selected size par auto-resize hoti hai.', 1600)}<p class="dim small">Images server par save hoti hain (settings.json) — upload karte hi live. 📐 Size dropdown se choose karo kitne pixels par resize ho.</p>`)}
      ${section('🎨 Theme colours', `<div class="form-grid">${field('Sidebar background (top)', color('theme.sidebarBg', t.sidebarBg))}${field('Sidebar background (bottom)', color('theme.sidebarBg2', t.sidebarBg2))}${field('Sidebar text', color('theme.sidebarText', t.sidebarText))}${field('Accent', color('theme.accent', t.accent))}${field('Accent 2 (gradient)', color('theme.accent2', t.accent2))}</div><p class="dim small">Colour preview turant dikhta hai; picker selection complete karne par automatically save hota hai. Save button bhi use kar sakte hain.</p>${saveBar('theme')}<button class="btn small" data-reset-theme>↺ Default colours</button>`)}`;
  }
  function dataTab() {
    const s = settings;
    const letters = (obj, keys, prefix) => `<div class="letter-grid">${keys.map((k) => `<label><small>${k}</small><input class="input mono" data-path="${prefix}.${k}" value="${esc(obj[k] ?? '')}"></label>`).join('')}</div>`;
    return `${section('📄 Google Sheet', `<div class="form-grid">${field('Sheet ID', txt('sheetId', s.sheetId, 'class="input mono"'), 'docs.google.com/spreadsheets/d/<b>ID</b>/edit — sheet "Anyone with the link can view" honi chahiye')}${field('EIR tab name', txt('eirSheet', s.eirSheet))}${field('StockDataa tab name', txt('stockSheet', s.stockSheet))}${field('StockDataa gid (optional)', txt('stockGid', s.stockGid))}${field('REPORT gid', txt('reportGid', s.reportGid), 'Google URL me #gid=… (REPORT tab)')}${field('Server cache (seconds)', numI('cacheSeconds', s.cacheSeconds, 'min="0"'), 'Browser reload par itni der tak server ka cached data milta hai; ↻ button hamesha fresh laata hai')}</div>
        <div class="form-grid">${field('Excluded TL names (not real TLs)', `<input class="input" data-path="excludeTls" data-list value="${esc((s.excludeTls || []).join(', '))}">`, 'Comma separated. Ye naam kisi bhi TL list / ranking me nahi aayenge (e.g. APS = direct agents)')}${field('GV master ID', txt('eir.gvMasterId', s.eir.gvMasterId))}${field('GV channel TL name', txt('eir.gvChannelTl', s.eir.gvChannelTl))}</div>`)}
      ${section('🟩 GV Partner sheet <span class="dim">(dusra Google Sheet)</span>', `<div class="form-grid">${field('GV Sheet ID', txt('gvSheetId', s.gvSheetId, 'class="input mono"'), 'GV Partner ki sheet — "Anyone with the link can view" honi chahiye')}${field('GV Master tab', txt('gv.master.tab', (s.gv || {}).master ? s.gv.master.tab : ''), 'Issuance log tab ka exact naam')}${field('GV Master gid (optional)', txt('gv.master.gid', (s.gv || {}).master ? s.gv.master.gid : ''))}${field('Tag Assignment tab', txt('gv.assignment.tab', (s.gv || {}).assignment ? s.gv.assignment.tab : ''), 'Stock tab ka exact naam')}${field('GV REPORT tab', txt('gv.report.tab', (s.gv || {}).report ? s.gv.report.tab : ''))}${field('GV REPORT gid', txt('gv.report.gid', (s.gv || {}).report ? s.gv.report.gid : ''), 'Google URL me #gid=… (GV REPORT tab)')}${field('GV REPORT header row', numI('gv.report.headerRow', (s.gv || {}).report ? s.gv.report.headerRow : 4), 'GV REPORT me heading row (default 4)')}${field('GV REPORT last column', txt('gv.report.lastCol', (s.gv || {}).report ? s.gv.report.lastCol : 'BE'), 'Sabse aakhri column (default BE)')}</div>${saveBar('data')}`)}
      ${section('🔠 EIR column letters', letters(s.eir, ['tagId', 'vrn', 'cls', 'type', 'status', 'date', 'agentId', 'agentName', 'masterId', 'tlId', 'gvId', 'gvName', 'gvTl', 'tlName', 'vrnType', 'monthName', 'regNumber'], 'eir') + saveBar('eir'), 'Sheet me column shift ho to sirf letters badlo')}
      ${section('🔠 StockDataa column letters', letters(s.stock, ['id', 'name', 'tagId', 'barcode', 'cls', 'tagType', 'bcAllocatedAt', 'agentId', 'agentName', 'agentAllocatedAt', 'tlName'], 'stock') + saveBar('stock'))}
      ${section('📥 Bulk CSV tool <span class="dim">(Google Sheet me rows paste karne ke liye)</span>', `<p class="dim small">CSV file upload karo → preview dekho → <b>📋 Copy for Google Sheets</b> dabao → Google Sheet me select karke Ctrl+V se paste kar do. Excel (.xlsx) file ho to pehle Excel me <b>File → Save As → CSV</b> karke lao. Data sirf aapke browser me parse hota hai — sheet me dashboard khud kuch nahi likhta.</p>
        <div class="btn-row"><label class="btn small primary">📤 CSV upload<input type="file" accept=".csv,.txt,text/csv,text/plain" id="bulk-file" hidden></label><button class="btn small" id="bulk-copy" disabled>📋 Copy for Google Sheets</button><button class="btn small" id="bulk-dl" disabled>⬇ CSV download</button><button class="btn small" id="bulk-template">⬇ StockDataa template</button><button class="btn small" id="bulk-clear" disabled>✕ Clear</button><span class="dim small" id="bulk-info"></span></div>
        <div id="bulk-preview" style="margin-top:10px"></div>`)}`;
  }

  // ---- bulk CSV parsing (RFC-4180-ish: quotes, commas, newlines) ----
  let bulkRows = null;
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', inQ = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQ) {
        if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') inQ = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
    return rows;
  }
  function csvEscape(v) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function renderBulkPreview() {
    const box = U.$('#bulk-preview'); const info = U.$('#bulk-info');
    if (!box) return;
    const has = bulkRows && bulkRows.length;
    U.$('#bulk-copy').disabled = !has; U.$('#bulk-dl').disabled = !has; U.$('#bulk-clear').disabled = !has;
    if (!has) { box.innerHTML = ''; if (info) info.textContent = ''; return; }
    const cols = Math.max(...bulkRows.slice(0, 50).map((r) => r.length));
    if (info) info.textContent = `${bulkRows.length} rows · ${cols} columns`;
    const head = bulkRows[0].map((h) => `<th>${esc(h)}</th>`).join('') + (cols > bulkRows[0].length ? `<th colspan="${cols - bulkRows[0].length}"></th>` : '');
    box.innerHTML = `<div class="table-wrap tall"><table class="tbl compact sticky-first"><thead><tr>${head}</tr></thead><tbody>${bulkRows.slice(1, 51).map((r) => `<tr>${Array.from({ length: cols }, (_, i) => `<td>${esc(r[i] !== undefined ? r[i] : '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${bulkRows.length > 51 ? `<p class="dim small">Preview me pehli 50 rows — copy/download me poori ${bulkRows.length} rows jayengi.</p>` : ''}`;
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
        <div class="user-head"><span class="user-avatar big">${esc((u.name || u.username).slice(0, 1).toUpperCase())}</span><div class="user-meta"><b>${esc(u.name)}</b> <code>${esc(u.username)}</code>${u.username === A.user.username ? ' <span class="tag">you</span>' : ''}<small class="dim">${esc(u.email || '')}${u.mobile ? ` · ${esc(u.mobile)}` : ''} · joined ${u.createdAt ? U.timeLabel(new Date(u.createdAt).getTime()) : '—'} · last login ${u.lastLoginAt ? U.timeLabel(new Date(u.lastLoginAt).getTime()) : 'never'}${u.lastLocation ? ` · <a href="https://www.google.com/maps?q=${encodeURIComponent(`${u.lastLocation.latitude},${u.lastLocation.longitude}`)}" target="_blank" rel="noopener">📍 last location</a>` : ''}</small></div>
          <div class="user-controls"><label class="check"><input type="checkbox" data-field="approved" ${u.approved ? 'checked' : ''}> ${u.approved ? 'Active' : '<b class="pend">Pending approval</b>'}</label><select data-field="role"><option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></div></div>
        <details class="user-perms" ${u.approved ? '' : 'open'}><summary>Permissions (${u.role === 'admin' ? 'all — admin' : `${u.permissions.length}/${permsCache.length}`})</summary><div class="perm-boxes">${permBoxes(u)}</div><div class="btn-row"><button class="btn small" data-perm-all>Select all</button><button class="btn small" data-perm-none>Clear</button><button class="btn small" data-perm-default>Default set</button></div></details>
        <div class="user-notify-prefs">
          <label class="check"><input type="checkbox" data-field="notifyAccess" ${u.role === 'admin' || u.notifyAccess !== false ? 'checked' : ''} ${u.role === 'admin' ? 'disabled' : ''}> 🔔 Notifications access <small class="dim">(in-app bell, browser alerts, mobile push — sab band ho jayega off karne par)</small></label>
        </div>
        <div class="btn-row user-actions"><button class="btn small primary" data-user-save>💾 Save</button><button class="btn small" data-user-pw>🔑 Reset password</button>${u.username !== A.user.username ? '<button class="btn small danger" data-user-del>🗑 Delete</button>' : ''}<span class="dim small" data-user-msg></span></div>
      </div>`).join('');
    root.innerHTML = `${section(`🔐 Users <span class="dim">(${usersCache.length} · ${usersCache.filter((u) => !u.approved).length} pending)</span>`, `<p class="dim small">Naya user sign up karta hai → yahan "Pending" dikhega → Active tick karo, permissions choose karo, Save. Admin ke paas sab access hota hai. <b>🔔 Notifications access</b> off karne se user ko koi notification nahi dikhega / nahi milega — saari activity admin ko hi aayegi.</p><div class="user-list">${rows}</div>`)}
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
        const naBox = card.querySelector('[data-field="notifyAccess"]');
        if (naBox && !naBox.disabled) body.notifyAccess = naBox.checked;
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
  function storageSecret() {
    let sec = sessionStorage.getItem('ff_storage_secret');
    if (!sec) {
      const bytes = new Uint8Array(24);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes); else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
      sec = Array.from(bytes, (b) => abc[b % abc.length]).join('');
      sessionStorage.setItem('ff_storage_secret', sec);
    }
    return sec;
  }
  function storageTab() {
    const st = storage || {};
    const cloud = st.backend === 'appsscript' || st.backend === 'sheets';
    const status = cloud
      ? `<div class="ok-box">✅ <b>Permanent storage ON</b> — users, settings, sessions aur notifications Google Sheet (<code>APP_STORAGE</code> tab, encrypted) me save ho rahe hain. Deploy / restart ke baad bhi sab wahi rahega.${st.lastSavedAt ? ` Last saved ${esc(U.timeLabel(new Date(st.lastSavedAt).getTime()))}.` : ''}</div>`
      : `<div class="warn-box">⚠️ <b>Abhi storage temporary hai.</b> Render har deploy / restart / sleep par app folder mita deta hai — isliye saved settings aur user details wapas <b>default</b> ho jaati hain. Neeche ke 5 steps se Google Sheet me permanent save chalu karo (free, ~5 minute).</div>`;
    const sec = storageSecret();
    const steps = `<ol class="setup-steps">
        <li><b>Google Sheet kholo</b> — ek <u>naya private</u> Google Sheet banao (recommended) ya main sheet → menu <b>Extensions → Apps Script</b>.</li>
        <li><b>Code paste karo</b> — <button class="btn small primary" id="st-copy-code">📋 Copy Code.gs</button> (aapka secret isme pehle se daal diya hai) → Apps Script me purana code hata ke paste karo → 💾 Save.</li>
        <li><b>Deploy</b> — <b>Deploy → New deployment</b> → type <b>Web app</b> → Execute as: <b>Me</b> → Who has access: <b>Anyone</b> → Deploy → permissions Allow → <b>Web app URL</b> copy karo (…/exec).</li>
        <li><b>Test + data copy</b> — URL neeche paste karo → <b>Test connection</b> → phir <b>Copy current data to Sheet</b> (current users/settings sheet me chale jaayenge).</li>
        <li><b>Render me 2 variables</b> — Render dashboard → service → <b>Environment</b> → add karo (button se copy): <code>APPS_SCRIPT_URL</code> aur <code>APPS_SCRIPT_SECRET</code> → <b>Save, rebuild and deploy</b>. Bas! Ab kabhi reset nahi hoga.</li>
      </ol>
      <div class="form-grid"><label class="fld"><span>Apps Script Web app URL</span><input class="input" id="st-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(sessionStorage.getItem('ff_storage_url') || '')}"></label>
      <label class="fld"><span>Secret (Code.gs aur Render dono me same)</span><input class="input" id="st-secret" value="${esc(sec)}"><small class="dim">Ise safe rakho, baad me kabhi mat badlo. Chat/WhatsApp par share mat karo.</small></label></div>
      <div class="btn-row"><button class="btn" id="st-test">🔌 Test connection</button><button class="btn primary" id="st-migrate">☁️ Copy current data to Sheet</button><button class="btn" id="st-copy-env">📋 Copy Render env values</button></div>
      <div id="st-msg" class="dim small"></div>`;
    return section('☁️ Google Sheet storage — settings & user details permanent save', `${status}<p class="dim small">Active backend: <code>${esc(st.backend || 'files')}</code>${st.encrypted ? ' · encrypted ✓' : ''}${st.error ? ` · <span class="delta down">${esc(st.error)}</span>` : ''}</p>${cloud ? `<details><summary class="dim small">Setup steps dobara dekhne hain?</summary>${steps}</details>` : steps}`);
  }
  function backupTab() {
    return `${storageTab()}${section('💾 Backup / restore settings', `${storage && storage.warning ? `<div class="warn-box">⚠️ ${esc(storage.warning)}</div>` : ''}${storage && storage.error ? `<div class="warn-box">${esc(storage.error)}</div>` : ''}<p class="dim small">Storage: <code>${esc(storage && storage.backend === 'sheets' ? 'Same Google Sheet / APP_STORAGE' : storage && storage.dataDir || 'DATA_DIR')}</code> · ${storage && storage.backend === 'sheets' ? 'Encrypted cloud storage ✓ — users, sessions and settings' : storage && storage.persistentDiskMounted ? 'Persistent mount detected ✓' : 'Local storage — verify durable hosting before deploying'}. Settings export contains only settings, NOT users or sessions. Before changing Render storage, securely back up all runtime JSON files from the old data directory using Render Shell. Never put those files in Git. Environment admin credentials are used only on first setup.</p><div class="btn-row"><button class="btn" id="bk-export">⬇ Download settings JSON</button><label class="btn">📤 Import settings JSON<input type="file" accept="application/json" hidden id="bk-import"></label></div>`)}
      ${section('🧹 Maintenance', `<div class="btn-row"><button class="btn" id="bk-cache">🧹 Clear server cache</button><button class="btn danger" id="bk-reset">↺ Reset ALL settings to defaults</button></div><p class="dim small">Last saved: ${settings.updatedAt ? `${U.timeLabel(new Date(settings.updatedAt).getTime())} by ${esc(settings.updatedBy || '')}` : 'never'}</p>`)}`;
  }


  // ---- 🗂️ Sheets & tabs: registry of every sheet tab the app can show ----------------------------
  function sourcesTab() {
    const tabs = (settings.tabs && settings.tabs.length ? settings.tabs : FF.config.allTabs());
    const groupsOf = (src) => tabs.filter((t) => (t.source || 'main') === src);
    const rowHtml = (t) => `<tr data-tab-row="${esc(t.id)}">
        <td><label class="check"><input type="checkbox" data-tab-enabled ${t.enabled !== false ? 'checked' : ''}></label></td>
        <td><b>${esc(t.id)}</b>${t.kind === 'issuance' || t.kind === 'gv-issuance' ? '<br><small class="dim">issuance log</small>' : t.kind === 'stock' || t.kind === 'gv-stock' ? '<br><small class="dim">stock</small>' : '<br><small class="dim">report</small>'}</td>
        <td><input class="input" data-tab-field="label" value="${esc(t.label || t.id)}"></td>
        <td><select data-tab-field="group"><option value="First Forward" ${t.group === 'First Forward' ? 'selected' : ''}>First Forward</option><option value="GV Partner" ${t.group === 'GV Partner' ? 'selected' : ''}>GV Partner</option></select></td>
        <td><select data-tab-field="source"><option value="main" ${(t.source || 'main') === 'main' ? 'selected' : ''}>First Forward sheet</option><option value="gv" ${t.source === 'gv' ? 'selected' : ''}>GV Partner sheet</option></select></td>
        <td><input class="input mono" data-tab-field="tab" value="${esc(t.tab || t.id)}"></td>
        <td><input class="input mono" data-tab-field="gid" value="${esc(t.gid || '')}" placeholder="—"></td>
        <td><input class="input mono" style="width:52px" data-tab-field="startCol" value="${esc(t.startCol || 'A')}" placeholder="A"></td>
        <td><input class="input mono" style="width:52px" data-tab-field="startRow" value="${esc(t.startRow || '1')}" placeholder="1"></td>
        <td><input class="input mono" style="width:52px" data-tab-field="endCol" value="${esc(t.endCol || '')}" placeholder="M"></td>
        <td><input class="input mono" style="width:52px" data-tab-field="endRow" value="${esc(t.endRow || '')}" placeholder="all"></td>
        <td><input class="input mono" style="width:85px" data-tab-field="range" value="${esc(t.range || '')}" placeholder="e.g. A1:M"></td>
        <td><input class="input" data-tab-field="desc" value="${esc(t.desc || '')}"></td>
      </tr>`;
    const table = (title, list, hint) => `<h4 class="mx-h">${title}</h4><p class="dim small">${hint}</p>
      <div class="table-wrap"><table class="tbl compact matrix"><thead><tr><th>Show</th><th>Tab id / permission</th><th>Label</th><th>Sidebar group</th><th>Spreadsheet</th><th>Sheet tab name</th><th>gid</th><th title="Start column (e.g. A)">Start Col</th><th title="Start row (e.g. 1)">Start Row</th><th title="End column (e.g. M, Z, BE)">End Col</th><th title="End row (blank for all)">End Row</th><th title="Custom range (e.g. A1:M, A4:BE)">Range</th><th>Description</th></tr></thead><tbody>${list.map(rowHtml).join('')}</tbody></table></div>`;

    const rangeCards = tabs.map((t) => {
      const calcRange = t.range || FF.config.formatRange(t.startCol, t.startRow, t.endCol, t.endRow);
      return `<div class="range-config-card" data-range-card="${esc(t.id)}">
        <div class="rcc-head">
          <span class="rcc-icon">${t.icon || '📄'}</span>
          <div><b>${esc(t.label || t.id)}</b> <span class="badge ${t.group === 'GV Partner' ? 'teal' : 'indigo'}">${esc(t.group)}</span></div>
        </div>
        <p class="dim small">Tab: <code>${esc(t.tab || t.id)}</code>${t.gid ? ` · gid: <code>${esc(t.gid)}</code>` : ''}</p>
        <div class="rcc-inputs">
          <label><span>Start Col</span><input class="input mono rcc-field" data-ref="${esc(t.id)}" data-field="startCol" value="${esc(t.startCol || 'A')}" placeholder="A"></label>
          <label><span>Start Row</span><input class="input mono rcc-field" data-ref="${esc(t.id)}" data-field="startRow" value="${esc(t.startRow || '1')}" placeholder="1"></label>
          <label><span>End Col</span><input class="input mono rcc-field" data-ref="${esc(t.id)}" data-field="endCol" value="${esc(t.endCol || '')}" placeholder="M, BE..."></label>
          <label><span>End Row</span><input class="input mono rcc-field" data-ref="${esc(t.id)}" data-field="endRow" value="${esc(t.endRow || '')}" placeholder="Blank = All"></label>
          <label class="rcc-range-fld"><span>Applied Range</span><input class="input mono rcc-range" data-ref="${esc(t.id)}" data-field="range" value="${esc(calcRange)}" placeholder="e.g. A1:M"></label>
        </div>
        <small class="dim rcc-hint">Data <b>${esc(calcRange)}</b> se fetch hoga (e.g. Row ${t.startRow || 1} Column ${t.startCol || 'A'} se lekar ${t.endCol ? `Column ${t.endCol}` : 'aakhri column'} tak).</small>
      </div>`;
    }).join('');

    return `${section('🗂️ Sheets & tabs <span class="dim">(kaun si sheet dikhe aur range)</span>', `
        <p class="dim small">Har row ek Google Sheet tab hai. <b>Show</b> untick karne se wo tab poore app se hide ho jaata hai. Sheet ka exact naam, gid aur <b>Start/End Col &amp; Row (Range)</b> yahan se set karo. Per-user access <b>Access matrix</b> tab me dena hai.</p>
        ${table('🟦 First Forward sheet', groupsOf('main'), `Sheet ID: <code>${esc(settings.sheetId || '')}</code> · EIR = issuance log · StockDataa = stock (default range A1:M) · REPORT = performance (default range A1:BZ)`)}
        ${table('🟩 GV Partner sheet', groupsOf('gv'), `Sheet ID: <code>${esc(settings.gvSheetId || '')}</code> · GV Master = issuance (A1:X) · Tag Assignment = stock (A1:M) · GV REPORT = performance (A4:BE)`)}
        <div class="save-bar"><button class="btn primary" id="tabs-save">💾 Save tabs &amp; ranges</button><button class="btn" id="tabs-reload">↻ Data dobara load karo (Fresh Sync)</button><span class="dim small" id="tabs-msg"></span></div>`)}
      ${section('📊 Har Sheet Ka Data: Column & Row Range Selection <span class="dim">(Start to End Bounds)</span>', `
        <p class="dim small">Kis sheet ka data kaun se row aur column se chahiye aur kahan tak — yahan har sheet ke liye customize karo (jaise Column A Row 1 se Column M tak <code>A1:M</code> ya Row 4 se BE tak <code>A4:BE</code>). Save karne par Google Visualization proxy isi range me query karega.</p>
        <div class="range-config-grid">${rangeCards}</div>
        <div class="save-bar"><button class="btn primary" id="range-save-btn">💾 Save range settings</button></div>`)}
      ${section('➕ Naya tab jodo <span class="dim">(optional)</span>', `
        <p class="dim small">Dono Google Sheets me koi naya tab ho to yahan add karke user ko access de sakte ho.</p>
        <div class="form-grid"><label class="fld"><span>Tab id (permission key)</span><input class="input" id="nt-id" placeholder="e.g. GV Tag Status"></label>
        <label class="fld"><span>Label</span><input class="input" id="nt-label" placeholder="GV Tag Status · detail"></label>
        <label class="fld"><span>Sheet tab name</span><input class="input" id="nt-tab" placeholder="GV Tag Status"></label>
        <label class="fld"><span>gid</span><input class="input" id="nt-gid" placeholder="optional"></label>
        <label class="fld"><span>Start Col</span><input class="input mono" id="nt-start-col" value="A" placeholder="A"></label>
        <label class="fld"><span>Start Row</span><input class="input mono" id="nt-start-row" value="1" placeholder="1"></label>
        <label class="fld"><span>End Col</span><input class="input mono" id="nt-end-col" placeholder="M or BE"></label>
        <label class="fld"><span>Group</span><select id="nt-group"><option>GV Partner</option><option>First Forward</option></select></label>
        <label class="fld"><span>Spreadsheet</span><select id="nt-source"><option value="gv">GV Partner sheet</option><option value="main">First Forward sheet</option></select></label></div>
        <div class="save-bar"><button class="btn primary" id="nt-add">➕ Add tab</button></div>`)}
      ${section('🧩 Access quick map', `<p class="dim small">Permission key = <code>sheet:&lt;Tab id&gt;</code>. Access matrix me yeh checkbox ban jaate hain.</p>
        <div class="chip-row">${tabs.map((t) => `<span class="chip ${t.enabled !== false ? 'on' : ''}">${esc(t.id)} → <code>sheet:${esc(t.id)}</code></span>`).join('')}</div>`)}`;
  }

  // ---- 🔐 Access matrix: pages + sheets × users ---------------------------------------------------
  async function accessTab(root) {
    const out = await A.api('/api/users');
    const users = out.users || [], perms = out.permissions || [];
    const groups = [...new Set(perms.map((p) => p.group))];
    const permsOf = (g) => perms.filter((p) => p.group === g);
    const head = `<tr><th class="mx-user" rowspan="2">User</th>${groups.map((g) => `<th class="mx-group" colspan="${permsOf(g).length}">${esc(g)}</th>`).join('')}<th rowspan="2">Quick</th></tr>
      <tr>${groups.map((g) => permsOf(g).map((p) => `<th class="mx-perm" title="${esc(p.label)}">${esc(p.label.replace(/^(Sheet · |First Forward · |GV Partner · )/, ''))}</th>`).join('')).join('')}</tr>`;
    const rows = users.map((u) => `<tr data-mx-row="${esc(u.username)}" class="${u.role === 'admin' ? 'is-admin' : ''}">
        <td class="mx-user">${A.avatarHtml(u, 'sm')}<div class="mx-user-info"><b>${esc(u.name || u.username)}</b><small class="dim">@${esc(u.username)}${u.approved ? '' : ' · pending'}</small><span class="badge ${u.role === 'admin' ? 'indigo' : 'gray'}">${u.role === 'admin' ? '👑 Admin' : 'User'}</span></div></td>
        ${groups.map((g) => permsOf(g).map((p) => `<td class="mx-cell"><input type="checkbox" data-mx-perm="${esc(p.key)}" ${u.role === 'admin' || (u.permissions || []).includes(p.key) ? 'checked' : ''} ${u.role === 'admin' ? 'disabled' : ''}></td>`).join('')).join('')}
        <td class="mx-quick"><button class="btn tiny" data-mx-all>All</button><button class="btn tiny" data-mx-ff>FF</button><button class="btn tiny" data-mx-gv>GV</button><button class="btn tiny" data-mx-none>None</button></td>
      </tr>`).join('');

    let requests = [];
    try { requests = (await A.api('/api/users/reset-requests')).requests || []; } catch { /* ignore */ }
    const reqHtml = requests.length ? requests.map((r) => `<div class="reset-row" data-reset="${esc(r.username)}">
        <span class="badge amber">🔑 password reset</span><b>${esc(r.name || r.username)}</b> <code>${esc(r.username)}</code>
        <small class="dim">${esc(r.email || '')}${r.mobile ? ` · ${esc(r.mobile)}` : ''} · requested ${U.timeLabel(new Date(r.at).getTime())}</small>
        ${r.code ? `<span class="code-pill" title="User ko ye code do (30 min valid)">code: <b>${esc(r.code)}</b></span>` : ''}
        <span class="btn-row"><button class="btn small" data-gen-code>${r.code ? '↻ Naya code' : '🎟️ Code banao'}</button><button class="btn small" data-reset-pw>🔑 Naya password</button><button class="btn small" data-dismiss>✕ Dismiss</button></span></div>`).join('')
      : '<p class="dim small">Filhaal koi reset request nahi hai. User login page par “Forgot password?” se request bhejta hai aur yahan dikhta hai.</p>';

    root.innerHTML = `${section('🔐 Access matrix <span class="dim">(kaun kya dekh sakta hai)</span>', `
        <p class="dim small">Checkbox tick = us user ko wo permission. Admin checkbox disabled rehte hain (admin ke paas sab hota hai). Quick buttons: <b>All</b> = sab, <b>FF</b> = sirf First Forward, <b>GV</b> = sirf GV Partner, <b>None</b> = kuch nahi.</p>
        <div class="table-wrap matrix-wrap"><table class="tbl compact matrix"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
        <div class="save-bar"><button class="btn primary" id="mx-save">💾 Save access</button><span class="dim small" id="mx-msg"></span></div>`)}
      ${section('🔑 Password reset requests', reqHtml)}
      ${section('⚡ Fast presets', `<p class="dim small">Ek click me sabhi non-admin users ka access set karo:</p>
        <div class="btn-row"><button class="btn" data-preset="all">All non-admin → sab access</button><button class="btn" data-preset="ff">All non-admin → sirf First Forward</button><button class="btn" data-preset="gv">All non-admin → sirf GV Partner</button><button class="btn" data-preset="view">All non-admin → read-only (view + export)</button></div>`)}`;

    const setRow = (row, fn) => row.querySelectorAll('[data-mx-perm]').forEach((cb) => { if (!cb.disabled) { cb.checked = fn(cb.dataset.mxPerm); } });
    const preset = (kind) => users.filter((u) => u.role !== 'admin').forEach((u) => {
      const row = U.$(`[data-mx-row="${u.username}"]`, root);
      if (!row) return;
      setRow(row, (k) => {
        const isSheet = k.startsWith('sheet:');
        const sheetId = isSheet ? k.slice(6) : '';
        if (kind === 'all') return true;
        if (kind === 'ff') return k.startsWith('gv') || (isSheet && FF.config.tabBy(sheetId) && (FF.config.tabBy(sheetId).group === 'GV Partner')) ? false : true;
        if (kind === 'gv') return k.startsWith('gv') || k === 'compare' || (isSheet && FF.config.tabBy(sheetId) && FF.config.tabBy(sheetId).group === 'GV Partner');
        if (kind === 'view') return !['share', 'refresh', 'contacts'].includes(k) && k !== 'home' ? true : ['home'].includes(k);
        return false;
      });
    });
    U.$$('[data-preset]', root).forEach((b) => b.addEventListener('click', () => { preset(b.dataset.preset); U.toast('Preset lagaya — ab "Save access" dabao', 'ok'); }));
    root.addEventListener('click', async (e) => {
      const row = e.target.closest('[data-mx-row]');
      if (row) {
        const all = e.target.closest('[data-mx-all]'), none = e.target.closest('[data-mx-none]');
        if (all) { setRow(row, () => true); return; }
        if (none) { setRow(row, () => false); return; }
        if (e.target.closest('[data-mx-ff]')) { setRow(row, (k) => !(k.startsWith('gv') || k === 'compare' || (k.startsWith('sheet:') && (FF.config.tabBy(k.slice(6)) || {}).group === 'GV Partner'))); return; }
        if (e.target.closest('[data-mx-gv]')) { setRow(row, (k) => k.startsWith('gv') || k === 'compare' || (k.startsWith('sheet:') && (FF.config.tabBy(k.slice(6)) || {}).group === 'GV Partner')); return; }
      }
      const rr = e.target.closest('[data-reset]');
      if (rr) {
        const username = rr.dataset.reset;
        if (e.target.closest('[data-gen-code]')) {
          e.target.disabled = true;
          try { const out2 = await A.api(`/api/users/${encodeURIComponent(username)}/reset-code`, 'POST', {}); U.toast(`Code: ${out2.code} — user ko bata do`, 'ok'); await U.copyText(out2.code); await accessTab(root); }
          catch (err) { U.toast(err.message, 'err'); e.target.disabled = false; }
          return;
        }
        if (e.target.closest('[data-reset-pw]')) {
          const pw = prompt(`Naya password for ${username} (min 6 chars):`, Math.random().toString(36).slice(2, 10));
          if (!pw) return;
          try { await A.api(`/api/users/${encodeURIComponent(username)}`, 'PUT', { password: pw }); await A.api(`/api/users/reset-requests/${encodeURIComponent(username)}`, 'DELETE'); U.toast(`Password set ✓ — user ko bata do: ${pw}`, 'ok'); await U.copyText(pw); await accessTab(root); }
          catch (err) { U.toast(err.message, 'err'); }
          return;
        }
        if (e.target.closest('[data-dismiss]')) {
          try { await A.api(`/api/users/reset-requests/${encodeURIComponent(username)}`, 'DELETE'); U.toast('Request dismiss ✓', 'ok'); await accessTab(root); } catch (err) { U.toast(err.message, 'err'); }
        }
      }
    });
    U.$('#mx-save', root).addEventListener('click', async () => {
      const msg = U.$('#mx-msg', root);
      msg.textContent = 'Saving…';
      try {
        for (const u of users) {
          if (u.role === 'admin') continue;
          const row = U.$(`[data-mx-row="${u.username}"]`, root);
          if (!row) continue;
          const permissions = [...row.querySelectorAll('[data-mx-perm]')].filter((cb) => cb.checked).map((cb) => cb.dataset.mxPerm);
          await A.api(`/api/users/${encodeURIComponent(u.username)}`, 'PUT', { permissions });
          u.permissions = permissions;
        }
        msg.textContent = `Saved ✓ ${U.timeLabel(Date.now())}`;
        U.toast('Access update ho gaya ✓', 'ok');
        if (users.some((u) => u.username === A.user.username)) { await A.refreshUser(); FF.app.renderSidebar(); }
      } catch (err) { msg.textContent = ''; U.toast(err.message, 'err'); }
    });
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
      else if (tab === 'sources') body.innerHTML = sourcesTab();
      else if (tab === 'access') { body.innerHTML = U.spinner('Access matrix…'); await accessTab(body); }
      else if (tab === 'data') body.innerHTML = dataTab();
      else if (tab === 'rules') body.innerHTML = rulesTab();
      else if (tab === 'contacts') body.innerHTML = contactsTab();
      else if (tab === 'backup') body.innerHTML = backupTab();
      else if (tab === 'users') { body.innerHTML = U.spinner('Users…'); await usersTab(body); }
      bindTab();
    };
    function bindTab() {
      // 🔔 notification switches notifications.js ke delegated handler se chalte hain;
      // admin ki push diagnostics yahin async load hoti hai.
      if (FF.notifications) void bindNotifications(body);
      // account
      const presenceShare = U.$('#presence-share-toggle', body);
      if (presenceShare) presenceShare.addEventListener('change', () => { localStorage.setItem('ff_presence_pointer', presenceShare.checked ? '1' : '0'); if (FF.app.liveShareChip) FF.app.liveShareChip(); if (!presenceShare.checked && FF.auth.user.role !== 'admin') FF.auth.api('/api/presence', 'POST', { page: 'settings', pointer: null, overlay: '' }).catch(() => {}); });
      const rangeDays = U.$('#ti-range-days', body);
      if (rangeDays) rangeDays.addEventListener('change', () => localStorage.setItem('ti_range_days', rangeDays.value));
      const chartLimit = U.$('#ti-chart-limit', body);
      if (chartLimit) chartLimit.addEventListener('change', () => localStorage.setItem('ti_chart_limit', chartLimit.value));
      const pfSave = U.$('#pf-save', body);
      if (pfSave) pfSave.addEventListener('click', async () => { try { await A.api('/api/auth/profile', 'POST', { name: U.$('#pf-name', body).value, mobile: U.$('#pf-mobile', body).value, email: U.$('#pf-email', body).value }); U.toast('Profile saved ✓', 'ok'); const me = await A.api('/api/auth/me'); if (me.user) { Object.assign(A.user, me.user); FF.app.renderSidebar(); } } catch (err) { U.toast(err.message, 'err'); } });
      const locationShare = U.$('#location-share', body);
      if (locationShare) locationShare.addEventListener('click', () => {
        if (!navigator.geolocation) return U.toast('Is browser me location supported nahi hai.', 'err');
        locationShare.disabled = true; locationShare.textContent = 'Location le rahe hain…';
        navigator.geolocation.getCurrentPosition(async (pos) => {
          try { await A.api('/api/auth/location', 'POST', { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }); await A.refreshUser(); FF.app.renderSidebar(); U.toast('Location admin ke saath share ho gayi ✓', 'ok'); draw(); }
          catch (err) { U.toast(err.message, 'err'); locationShare.disabled = false; locationShare.textContent = '📍 Share my location'; }
        }, (err) => { U.toast(err.code === 1 ? 'Location permission allow karo, tabhi share hoga.' : 'Location nahi mil saki.', 'err'); locationShare.disabled = false; locationShare.textContent = '📍 Share my location'; }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
      });
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
      U.$$('input[type=color][data-path]', body).forEach((inp) => inp.addEventListener('change', () => {
        const theme = collect(inp.closest('.card'), {}).theme;
        if (theme) save({ theme }, U.$('#save-msg-theme', body));
      }));
      const rt = U.$('[data-reset-theme]', body);
      if (rt) rt.addEventListener('click', () => save({ theme: defaults.theme }, null).then(draw));
      // images (branding) — size dropdown decides the resize target
      U.$$('select[data-img-size]', body).forEach((sel) => sel.addEventListener('change', () => localStorage.setItem(`ff_img_size_${sel.dataset.imgSize}`, sel.value)));
      U.$$('input[type=file][data-img]', body).forEach((inp) => inp.addEventListener('change', async () => {
        const file = inp.files[0]; if (!file) return;
        const sizeSel = U.$(`select[data-img-size="${inp.dataset.img}"]`, body);
        const max = (sizeSel ? Number(sizeSel.value) : 0) || Number(inp.dataset.max) || 512;
        if (sizeSel) localStorage.setItem(`ff_img_size_${inp.dataset.img}`, sizeSel.value);
        try { const dataUrl = await readImage(file, max, { minSide: max <= 512 ? 128 : 0 }); if (dataUrl.length > 1.8 * 1024 * 1024) throw new Error('Image bahut badi hai — chhoti image use karo'); await save({ [inp.dataset.img]: dataUrl }, null); U.toast('Image save ho gayi ✓', 'ok'); draw(); } catch (err) { U.toast(err.message, 'err'); }
      }));
      U.$$('[data-img-clear]', body).forEach((b) => b.addEventListener('click', () => save({ [b.dataset.imgClear]: '' }, null).then(draw)));
      // show real pixel dimensions of stored images once they decode
      U.$$('[data-img-info]', body).forEach((el) => {
        const data = settings[el.dataset.imgInfo];
        if (!data) return;
        const im = new Image();
        im.onload = () => { if (U.$(`[data-img-info="${el.dataset.imgInfo}"]`, body)) el.textContent = `Saved: ${im.naturalWidth}×${im.naturalHeight}px · ${imgSizeInfo(data)}`; };
        im.src = data;
      });
      // bulk CSV tool
      const bulkFile = U.$('#bulk-file', body);
      if (bulkFile) bulkFile.addEventListener('change', () => {
        const file = bulkFile.files[0]; if (!file) return;
        if (file.size > 8 * 1024 * 1024) { U.toast('File 8 MB se badi hai', 'err'); return; }
        const rd = new FileReader();
        rd.onload = () => {
          bulkRows = parseCsv(rd.result);
          if (!bulkRows.length) { U.toast('CSV khali hai ya parse nahi hui', 'err'); bulkRows = null; }
          else U.toast(`CSV ready: ${bulkRows.length} rows ✓`, 'ok');
          renderBulkPreview();
        };
        rd.onerror = () => U.toast('File read nahi hui', 'err');
        rd.readAsText(file);
      });
      const bulkCopy = U.$('#bulk-copy', body);
      if (bulkCopy) bulkCopy.addEventListener('click', async () => {
        if (!bulkRows || !bulkRows.length) return;
        const tsv = bulkRows.map((r) => r.join('\t')).join('\n');
        const ok = await U.copyText(tsv);
        U.toast(ok ? 'Copy ho gaya ✓ — ab Google Sheet me Ctrl+V se paste karo' : 'Copy fail — browser permission check karo', ok ? 'ok' : 'err');
      });
      const bulkDl = U.$('#bulk-dl', body);
      if (bulkDl) bulkDl.addEventListener('click', () => {
        if (!bulkRows || !bulkRows.length) return;
        const csv = bulkRows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
        U.downloadBlob(`bulk-${U.stamp()}.csv`, new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
      });
      const bulkTpl = U.$('#bulk-template', body);
      if (bulkTpl) bulkTpl.addEventListener('click', () => {
        const s = settings.stock || {};
        const header = [['id', 'ID'], ['name', 'Name'], ['tagId', 'Tag ID'], ['barcode', 'Barcode'], ['cls', 'Class'], ['tagType', 'Tag Type'], ['bcAllocatedAt', 'BC Allocated At'], ['agentId', 'Agent ID'], ['agentName', 'Agent Name'], ['agentAllocatedAt', 'Agent Allocated At'], ['tlName', 'TL Name']].map(([k, label]) => (s[k] ? `${label} (${s[k]})` : label));
        U.downloadBlob('stockdataa-template.csv', new Blob([`\uFEFF${header.join(',')}\r\n`], { type: 'text/csv;charset=utf-8' }));
      });
      const bulkClear = U.$('#bulk-clear', body);
      if (bulkClear) bulkClear.addEventListener('click', () => { bulkRows = null; renderBulkPreview(); });
      renderBulkPreview();
      // profile photo — centre-crop square, size from dropdown
      const avUp = U.$('#av-upload', body);
      if (avUp) avUp.addEventListener('change', async () => {
        const file = avUp.files[0]; if (!file) return;
        const sizeSel = U.$('#av-size', body);
        const size = (sizeSel ? Number(sizeSel.value) : 0) || 256;
        if (sizeSel) localStorage.setItem('ff_avatar_size', sizeSel.value);
        try {
          const dataUrl = await readImage(file, size, { square: true });
          if (dataUrl.length > 1.2 * 1024 * 1024) throw new Error('Photo chhoti rakho (1 MB se kam)');
          await A.api('/api/auth/profile', 'POST', { avatar: dataUrl });
          await A.refreshUser(); FF.app.renderSidebar(); U.toast('Photo update ✓', 'ok'); draw();
        } catch (err) { U.toast(err.message, 'err'); }
      });
      const avClr = U.$('#av-clear', body);
      if (avClr) avClr.addEventListener('click', async () => { try { await A.api('/api/auth/profile', 'POST', { avatar: '' }); await A.refreshUser(); FF.app.renderSidebar(); U.toast('Photo hata di ✓', 'ok'); draw(); } catch (err) { U.toast(err.message, 'err'); } });
      // sheets & tabs registry
      const collectTabsFromUi = () => {
        return U.$$('[data-tab-row]', body).map((row) => {
          const tabId = row.dataset.tabRow;
          const card = U.$(`[data-range-card="${tabId}"]`, body);
          const startCol = ((card ? card.querySelector('[data-field="startCol"]')?.value : row.querySelector('[data-tab-field="startCol"]')?.value) || 'A').trim().toUpperCase();
          const startRow = ((card ? card.querySelector('[data-field="startRow"]')?.value : row.querySelector('[data-tab-field="startRow"]')?.value) || '1').trim();
          const endCol = ((card ? card.querySelector('[data-field="endCol"]')?.value : row.querySelector('[data-tab-field="endCol"]')?.value) || '').trim().toUpperCase();
          const endRow = ((card ? card.querySelector('[data-field="endRow"]')?.value : row.querySelector('[data-tab-field="endRow"]')?.value) || '').trim();
          let range = ((card ? card.querySelector('[data-field="range"]')?.value : row.querySelector('[data-tab-field="range"]')?.value) || '').trim().toUpperCase();
          if (!range && (startCol || startRow || endCol || endRow)) {
            range = FF.config.formatRange ? FF.config.formatRange(startCol, startRow, endCol, endRow) : `${startCol || 'A'}${startRow || 1}:${endCol || ''}${endRow || ''}`;
          }
          return {
            ...((settings.tabs || []).find(t => t.id === tabId) || {}),
            id: tabId,
            enabled: row.querySelector('[data-tab-enabled]').checked,
            label: row.querySelector('[data-tab-field="label"]').value,
            group: row.querySelector('[data-tab-field="group"]').value,
            source: row.querySelector('[data-tab-field="source"]').value,
            tab: row.querySelector('[data-tab-field="tab"]').value,
            gid: row.querySelector('[data-tab-field="gid"]').value,
            desc: row.querySelector('[data-tab-field="desc"]').value,
            startCol,
            startRow,
            endCol,
            endRow,
            range
          };
        });
      };

      const saveTabsHandler = async (msgEl) => {
        const tabs = collectTabsFromUi();
        if (msgEl) msgEl.textContent = 'Saving…';
        try {
          const out = await A.api('/api/settings', 'PUT', { settings: { tabs } });
          settings = JSON.parse(JSON.stringify(out.settings)); A.applySettings(out.settings); FF.app.renderSidebar();
          if (msgEl) msgEl.textContent = 'Saved ✓'; U.toast('Sheets, tabs aur ranges save ho gaye ✓', 'ok');
          if (FF.preloader) {
            await FF.preloader.fastSync();
          } else {
            FF.store.reset(); if (FF.gv) FF.gv.reset();
            await Promise.all([FF.store.preload(true).catch(() => {}), FF.gv && FF.gv.enabled() ? FF.gv.preload(true).catch(() => {}) : Promise.resolve()]);
          }
          draw();
        } catch (err) { if (msgEl) msgEl.textContent = 'Not saved — retry'; if (A.settings) A.applySettings(A.settings); U.toast(err.message, 'err'); }
      };

      const tabsSave = U.$('#tabs-save', body);
      if (tabsSave) tabsSave.addEventListener('click', () => saveTabsHandler(U.$('#tabs-msg', body)));
      const rangeSaveBtn = U.$('#range-save-btn', body);
      if (rangeSaveBtn) rangeSaveBtn.addEventListener('click', () => saveTabsHandler(null));

      // Live sync between range cards and table inputs
      U.$$('.rcc-field, .rcc-range', body).forEach((inp) => inp.addEventListener('input', (e) => {
        const tabId = e.target.dataset.ref;
        const card = U.$(`[data-range-card="${tabId}"]`, body);
        const row = U.$(`[data-tab-row="${tabId}"]`, body);
        if (!card || !row) return;
        const sCol = (card.querySelector('[data-field="startCol"]')?.value || 'A').trim().toUpperCase();
        const sRow = (card.querySelector('[data-field="startRow"]')?.value || '1').trim();
        const eCol = (card.querySelector('[data-field="endCol"]')?.value || '').trim().toUpperCase();
        const eRow = (card.querySelector('[data-field="endRow"]')?.value || '').trim();
        const rangeEl = card.querySelector('[data-field="range"]');
        if (e.target.dataset.field !== 'range' && rangeEl) {
          const calc = FF.config.formatRange(sCol, sRow, eCol, eRow);
          rangeEl.value = calc;
        }
        const rowRange = row.querySelector('[data-tab-field="range"]');
        if (rowRange && rangeEl) rowRange.value = rangeEl.value;
      }));

      const tabsReload = U.$('#tabs-reload', body);
      if (tabsReload) tabsReload.addEventListener('click', async () => {
        U.toast('Google se fresh data background sync chal raha hai…', 'info');
        if (FF.preloader) {
          await FF.preloader.fastSync();
        } else {
          FF.store.reset(); if (FF.gv) FF.gv.reset();
          await Promise.all([FF.store.preload(true).catch(() => {}), FF.gv && FF.gv.enabled() ? FF.gv.preload(true).catch(() => {}) : Promise.resolve()]);
        }
        U.toast('Fresh data load complete ✓', 'ok');
        draw();
      });
      const ntAdd = U.$('#nt-add', body);
      if (ntAdd) ntAdd.addEventListener('click', async () => {
        const id = U.$('#nt-id', body).value.trim();
        if (!id) return U.toast('Tab id daalo', 'err');
        const current = (settings.tabs || []).slice();
        if (current.some((t) => t.id === id)) return U.toast('Ye tab id pehle se hai', 'err');
        const startCol = (U.$('#nt-start-col', body)?.value || 'A').trim().toUpperCase();
        const startRow = (U.$('#nt-start-row', body)?.value || '1').trim();
        const endCol = (U.$('#nt-end-col', body)?.value || '').trim().toUpperCase();
        const range = FF.config.formatRange(startCol, startRow, endCol, '');
        current.push({ id, label: U.$('#nt-label', body).value.trim() || id, tab: U.$('#nt-tab', body).value.trim() || id, gid: U.$('#nt-gid', body).value.trim(), group: U.$('#nt-group', body).value, source: U.$('#nt-source', body).value, kind: 'sheet', icon: '📄', desc: '', enabled: true, startCol, startRow, endCol, range });
        try { const out = await A.api('/api/settings', 'PUT', { settings: { tabs: current } }); settings = JSON.parse(JSON.stringify(out.settings)); A.applySettings(out.settings); FF.app.renderSidebar(); U.toast('Tab add ho gaya ✓ — ab Access matrix me user ko do', 'ok'); draw(); } catch (err) { U.toast(err.message, 'err'); }
      });
      // Google Sheet storage wizard
      const stMsg = U.$('#st-msg', body);
      const stVals = () => { const url = (U.$('#st-url', body)?.value || '').trim(); const secret = (U.$('#st-secret', body)?.value || '').trim(); sessionStorage.setItem('ff_storage_url', url); sessionStorage.setItem('ff_storage_secret', secret); return { url, secret }; };
      const copyCode = U.$('#st-copy-code', body);
      if (copyCode) copyCode.addEventListener('click', async () => {
        try { const out = await A.api('/api/storage/apps-script'); const { secret } = stVals(); await U.copyText(out.code.replace("PASTE_A_LONG_RANDOM_SECRET_HERE", secret)); U.toast('Code.gs copied ✓ — Apps Script me paste karo', 'ok'); } catch (err) { U.toast(err.message, 'err'); }
      });
      const stTest = U.$('#st-test', body);
      if (stTest) stTest.addEventListener('click', async () => {
        const v = stVals(); stMsg.textContent = 'Testing…';
        try { const out = await A.api('/api/storage/test', 'POST', v); stMsg.innerHTML = `✅ Connected to <b>${esc(out.spreadsheet || 'Google Sheet')}</b>${out.hasData ? ` · sheet me pehle se data hai (${out.users} users) — Render env set karo, wahi load hoga.` : ' · sheet khaali hai — ab "Copy current data to Sheet" dabao.'}`; } catch (err) { stMsg.innerHTML = `<span class="delta down">❌ ${esc(err.message)}</span>`; }
      });
      const stMig = U.$('#st-migrate', body);
      if (stMig) stMig.addEventListener('click', async () => {
        const v = stVals(); stMsg.textContent = 'Copying users, settings, sessions…';
        try {
          let out;
          try { out = await A.api('/api/storage/migrate', 'POST', v); }
          catch (err) {
            if (err.status !== 409) throw err;
            if (!confirm(`${err.message}\n\nKya aap sheet ka data is server ke current data se OVERWRITE karna chahte ho? (Normally "Cancel" dabao aur seedha Render env set karo.)`)) { stMsg.textContent = err.message; return; }
            out = await A.api('/api/storage/migrate', 'POST', { ...v, force: true });
          }
          stMsg.innerHTML = `✅ ${out.users} users + settings Google Sheet me copy ho gaye. Ab Step 5: Render me APPS_SCRIPT_URL aur APPS_SCRIPT_SECRET add karke deploy karo.`; U.toast('Data copied to Google Sheet ✓', 'ok'); } catch (err) { stMsg.innerHTML = `<span class="delta down">❌ ${esc(err.message)}</span>`; }
      });
      const stEnv = U.$('#st-copy-env', body);
      if (stEnv) stEnv.addEventListener('click', async () => { const v = stVals(); if (!v.url) return U.toast('Pehle Web app URL paste karo', 'err'); await U.copyText(`APPS_SCRIPT_URL=${v.url}\nAPPS_SCRIPT_SECRET=${v.secret}`); U.toast('Env values copied ✓ — Render → Environment me paste karo', 'ok'); });
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
