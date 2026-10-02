/* Settings page. Every user: My account (profile, password, permissions). Admin: branding & images, theme colours,
   data source (sheet / gid / column letters / excluded TLs), thresholds, contacts & sharing, users & access, backup. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, A = FF.auth;
  const esc = U.esc;
  const TABS = [['account', '👤 My account'], ['diagnostics', '🩺 Site diagnostics'], ['sound', '🔊 Sound & voice'], ['brand', '🎨 Branding & images'], ['sources', '🗂️ Sheets & tabs'], ['access', '🔐 Access matrix'], ['data', '🔌 Data source'], ['direct', '🧍 Direct agents'], ['rules', '📐 Thresholds'], ['features', '🎛 Features'], ['contacts', '📲 Contacts & sharing'], ['users', '👥 Users & access'], ['links', '🔗 Personal links'], ['audit', '📜 Audit log'], ['backup', '☁️ Storage & backup']];
  let tab = 'account';
  let storage = null;
  let settings = null, defaults = null, usersCache = null, permsCache = [];

  // 🎙 Assistant voice prefs — assistant.js ke 🌐/⚙ changes ko bhi yahan sync rakho (ek hi baar register).
  if (typeof window !== 'undefined' && !window.__ffVoiceSettingsSync) {
    window.__ffVoiceSettingsSync = true;
    window.addEventListener('ff-voice-prefs', (e) => {
      const sel = document.querySelector('#voice-lang');
      if (sel && e && e.detail) sel.value = e.detail.lang === 'en' ? 'en' : 'hi';
    });
  }

  const field = (label, input, hint) => `<label class="fld"><span>${label}</span>${input}${hint ? `<small class="dim">${hint}</small>` : ''}</label>`;
  const txt = (path, value, attrs) => `<input class="input" data-path="${esc(path)}" value="${esc(value ?? '')}" ${attrs || ''}>`;
  const numI = (path, value, attrs) => `<input class="input" type="number" data-path="${esc(path)}" value="${esc(value ?? '')}" ${attrs || ''}>`;
  const color = (path, value) => `<span class="color-wrap"><input type="color" data-path="${esc(path)}" value="${esc(value || '#000000')}"><code>${esc(value || '')}</code></span>`;
  const check = (path, value, label) => `<label class="check"><input type="checkbox" data-path="${esc(path)}" ${value ? 'checked' : ''}> ${label}</label>`;
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
  const setPath = (obj, path, v) => { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach((k, i) => { if (!o[k] || typeof o[k] !== 'object') o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; }); o[ks[ks.length - 1]] = v; };
  const section = (title, body, sub) => `<section class="card"><div class="card-head"><h3>${title}</h3>${sub ? `<div class="card-right dim">${sub}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const saveBar = (id) => `<div class="save-bar"><button class="btn primary" data-save="${id}">💾 Save</button><span class="dim small" id="save-msg-${id}"></span></div>`;

  async function loadSettings() {
    const [out, health] = await Promise.all([A.api('/api/settings'), A.api('/api/health').catch(() => ({}))]);
    storage = health.storage;
    settings = JSON.parse(JSON.stringify(out.settings)); defaults = out.defaults;
  }
  async function save(patch, msgEl, opts) {
    const clone = (v) => JSON.parse(JSON.stringify(v || {}));
    const merge = (base, next) => {
      if (!next || typeof next !== 'object' || Array.isArray(next)) return next;
      const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
      Object.entries(next).forEach(([k, v]) => { out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k], v) : v; });
      return out;
    };
    const before = clone(settings || A.settings || {});
    try {
      if (msgEl) msgEl.textContent = 'Saving… server confirmation ka wait hai';
      // ⚡ Optimistic preview, but nested Features values ko accidentally drop mat karo.
      const optimistic = merge(before, patch);
      settings = clone(optimistic);
      A.applySettings(optimistic);
      if (patch.tabs) FF.app.renderSidebar();
      const out = await A.api('/api/settings', 'PUT', { settings: patch });
      settings = clone(out.settings);
      A.applySettings(out.settings);
      FF.app.renderSidebar();
      if (msgEl) msgEl.textContent = `Saved ✓ ${U.timeLabel(Date.now())}`;
      U.toast('Settings saved ✓', 'ok');
      if (opts && opts.reload) { U.toast('Sheet mapping badli — data dobara load ho raha hai…'); FF.store.reset(); if (FF.gv) FF.gv.reset(); if (FF.pages.sheet.reset) FF.pages.sheet.reset(); if (FF.pages.performance.reset) FF.pages.performance.reset(); if (FF.insights && FF.insights.reset) FF.insights.reset(); FF.preloader.fastSync(false).catch(() => {}); }
      return true;
    } catch (err) {
      settings = clone(before); A.applySettings(before); FF.app.renderSidebar();
      if (msgEl) msgEl.textContent = 'Not saved — retry';
      U.toast(err.message, 'err');
      return false;
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
    const notificationApi = FF.notifications || {};
    const types = (notificationApi.notifyTypes || []).filter((t) => (A.isAdmin() ? t.admin : t.user));
    const toneOptions = (notificationApi.toneOptions || [{ id: 'classic', label: 'Classic · single clear beep' }]);
    const tone = toneOptions.some((x) => x.id === prefs.tone) ? prefs.tone : 'classic';
    return section('🔔 Notifications <span class="dim">(app + mobile)</span>', `
      <p class="dim small">Har notification <b>app ke andar (bell)</b> aur <b>mobile / desktop ke notification panel</b> dono par aati hai — app band hone par bhi Web Push se phone par alert chala jaata hai. Neeche decide karo kaunsi notifications aani chahiye.</p>
      <div class="notify-switches" style="background:transparent;padding:0;border:0">
        ${switchRow('master', 'Notifications ON / OFF', on ? 'ON — app ke andar toast + phone / desktop ke notification panel par alert (app band ho tab bhi)' : 'OFF — koi alert nahi aayega (list bell me padh sakte ho)', on)}
        ${switchRow('sound', '🔊 Sound / vibration', 'Alert ke saath short beep + mobile vibration', prefs.sound !== false, !on)}
        ${switchRow('voice', '🔊 Alert voice — app band ho tab bhi', 'Alert ki ek line phone/desktop par boli jaati hai — app khula ho to turant, band tha to dobara khulte hi (12 ghante tak catch-up). OFF karo to sirf beep / vibration.', prefs.voice !== false, !on)}
        ${switchRow('monthly', '📅 Monthly report', 'Har mahine ki 1–5 tarikh ko pichhle mahine ka FF vs GV compare', prefs.monthly !== false, !on)}
      </div>
      <div class="btn-row" style="margin:2px 0 8px"><button type="button" class="btn small" id="voice-closed-test">🔊 Closed-app voice test</button><span class="dim small">App bilkul band ho aur phone locked ho — us waqt <b>text + sound + vibration</b> OS panel me turant aata hai (voice service worker me nahi chalti); bolne wali line app dobara khulte hi sunai deti hai. Android par “notification read aloud” app se OS panel ke alerts bhi padhwaye ja sakte hain.</span></div>
      <div class="notify-tone-row" style="display:flex;align-items:end;gap:8px;flex-wrap:wrap;margin:10px 0">
        <label class="fld" style="min-width:250px;flex:1"><span>🔔 Notification / update beep tone</span>
          <select class="input" id="notify-tone" ${!on ? 'disabled' : ''}>${toneOptions.map((x) => `<option value="${esc(x.id)}" ${tone === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
        </label>
        <button type="button" class="btn small" id="notify-tone-test">▶ Preview tone</button>
      </div>
      <p class="dim small">Selected sound is used for in-app alerts and report updates. Background phone/desktop pushes use the device's native notification sound; supported devices also get a tone-matched vibration pattern.</p>
      <details class="notify-prefs" open style="border:0;margin-top:6px"><summary>Kaunsi notifications aayengi? (type-wise on/off — in-app + mobile dono par apply)</summary>
        <div class="notify-pref-grid">${types.map((t) => `<span class="check small">${ffSwitch(t.key, prefs[t.key] !== false, !on)} ${t.label}</span>`).join('')}</div>
        <p class="dim small" style="margin:6px 2px 0">${A.isAdmin() ? '👑 Admin ko sab users ki activity aati hai — naya signup, login, search, button click, page open, settings change, report/sheet update, location — sab. Upar se type ke hisaab se ON/OFF karo.' : 'Apne liye kaunsi alerts chahiye wo upar choose karo — ye in-app + phone panel dono par lagta hai.'}</p>
        ${A.isAdmin() ? `<div class="save-bar" style="margin-top:8px"><button class="btn small primary" data-notify-all-on>🔁 Sab notifications ON karo</button><button class="btn small" data-notify-digest-test title="Kal/MTD/stock wala roz ka summary turant bhejo — pipeline ka test">📅 Digest abhi bhejo</button><span class="dim small">Ek click me saare types chalu — signup / search / click / page open / settings / report … sab aayengi. Digest = subah ka summary (issuance + stock + VC4 cover) roz ek baar.</span></div>` : ''}
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
    const N = FF.notifications;
    const toneEl = U.$('#notify-tone', body);
    if (toneEl && N && N.setTone) toneEl.addEventListener('change', () => {
      const selected = N.setTone(toneEl.value);
      toneEl.value = selected;
      U.toast('🔔 Notification tone saved and previewed ✓', 'ok');
    });
    const toneTest = U.$('#notify-tone-test', body);
    if (toneTest && N && N.testSound) toneTest.addEventListener('click', () => N.testSound());
    const voiceTest = U.$('#voice-closed-test', body);
    if (voiceTest) voiceTest.addEventListener('click', async () => {
      const V = FF.pushVoice;
      if (!V) { U.toast('Voice module load nahi hua — app dobara kholo.', 'warn'); return; }
      try { if (N && N.unlockAudio) N.unlockAudio(); } catch { /* ignore */ }
      const ok = await V.test();
      U.toast(ok ? '🔊 Voice test bhej diya — awaaz sunai di?' : '🔇 Awaaz block hai — screen par ek baar tap karke dobara try karo (browser autoplay policy).', ok ? 'ok' : 'warn');
    });
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
  // ---- 🛡️ My access · colorful, clickable page cards (data summary ke saath) ---------------------
  // Har panel ka apna colour (Management / First Forward / GV Partner / Cross Channel / Workspace /
  // Actions / Sheets). Card = link (page khulta hai), band access = locked card + toast.
  // Summary sirf IN-MEMORY data se bharata hai — settings page par koi extra network call nahi.
  const ACC_TONE = { 'Management': 't-mgmt', 'First Forward': 't-ff', 'GV Partner': 't-gv', 'Cross Channel': 't-cross', 'Workspace': 't-ws', 'Actions': 't-act', 'Sheets': 't-sheet' };
  const ACC_ICON = { 'Management': '🧭', 'First Forward': '🟦', 'GV Partner': '🟩', 'Cross Channel': '🔗', 'Workspace': '🗂️', 'Actions': '⚡', 'Sheets': '📄' };
  function accStats() {
    const s = {};
    try {
      const pick = (obj, key) => (obj && typeof obj.get === 'function' ? obj.get(key) : null);
      const mk = U.ymKey(new Date());
      const daily = pick(FF.store, 'daily');
      if (Array.isArray(daily) && daily.length) {
        const ffDaily = daily.filter((r) => !r.channel || r.channel === 'First Forward');
        const sumN = (rows) => rows.reduce((n, r) => n + (Number(r.n) || 0), 0);
        s.ffTags = sumN(ffDaily);
        const keys = ffDaily.filter((r) => r.key && r.n).map((r) => r.key).sort();
        s.ffLast = keys.length ? keys[keys.length - 1] : '';
        s.ffMtd = sumN(ffDaily.filter((r) => r.key && r.key.startsWith(mk)));
      }
      const stockAgents = pick(FF.store, 'stockAgents');
      if (Array.isArray(stockAgents)) s.ffStock = stockAgents.reduce((n, r) => n + (Number(r.n) || 0), 0);
      const report = pick(FF.store, 'report');
      if (report && Array.isArray(report.rows)) s.reportRows = Math.max(0, report.rows.length - 2);
      const gvm = pick(FF.gv, 'master');
      if (Array.isArray(gvm) && gvm.length) {
        s.gvRows = gvm.length;
        const mtd = gvm.filter((r) => r.ym === mk);
        s.gvMtd = mtd.length;
        s.gvComm = mtd.reduce((n, r) => n + (Number(r.commission) || 0), 0);
        const yms = gvm.filter((r) => r.ym).map((r) => r.ym).sort();
        s.gvLast = yms.length ? yms[yms.length - 1] : '';
      }
      const gvStock = pick(FF.gv, 'stockClass');
      if (Array.isArray(gvStock)) s.gvStock = gvStock.reduce((n, r) => n + (Number(r.n) || 0), 0);
    } catch { /* data optional — summary tabhi dikhegi jab data already loaded ho */ }
    return s;
  }
  function accSummaryFor(id, s) {
    const f = (n) => U.fmt(Math.round(n || 0));
    const gvBit = s.gvRows ? ` · GV ${f(s.gvRows)}` : '';
    switch (id) {
      case 'home': case 'dashboard': case 'trend':
        return s.ffTags ? `${f(s.ffTags)} FF tags${s.ffLast ? ` · data till ${s.ffLast}` : ''}` : '';
      case 'executive':
        return (s.ffMtd || s.gvMtd) ? `MTD · FF ${f(s.ffMtd)}${s.gvMtd != null ? ` · GV ${f(s.gvMtd)}` : ''}${s.gvComm ? ` · GV comm ${U.fmt(s.gvComm)}` : ''}` : '';
      case 'tagIssued': case 'rangeReport':
        return (s.ffTags || s.gvRows) ? `FF ${f(s.ffTags)}${gvBit} rows` : '';
      case 'targets': case 'tv': case 'teamMap':
        return s.ffMtd ? `FF MTD ${f(s.ffMtd)} tags` : '';
      case 'stock': case 'stockReport':
        return s.ffStock ? `${f(s.ffStock)} tags field stock` : '';
      case 'performance': case 'ffCommission':
        return s.reportRows ? `REPORT ${f(s.reportRows)} agent rows` : '';
      case 'gvDashboard': case 'gvTrend': case 'gvPerformance':
        return s.gvRows ? `GV ${f(s.gvRows)} rows${s.gvLast ? ` · ${U.labelYM(s.gvLast)}` : ''}` : '';
      case 'gvCommission':
        return s.gvRows ? `GV comm ${s.gvComm ? U.fmt(s.gvComm) : '—'}${gvBit} rows` : '';
      case 'gvStock': case 'gvStockReport':
        return s.gvStock ? `${f(s.gvStock)} tags GV stock` : '';
      case 'dualChannel': case 'compare': case 'charts': case 'forecast': case 'dataQuality': case 'dispatchPlan': case 'tlScorecard':
        return (s.ffTags && s.gvRows) ? `FF ${f(s.ffTags)}${gvBit} rows` : '';
      default: return '';
    }
  }
  function accessSection(perms, u) {
    const pages = (FF.app && FF.app.PAGES) || [];
    const tone = (group) => ACC_TONE[group] || 't-pages';
    const cardHtml = (icon, label, desc, href, allowed, toneClass, sumId) => {
      const badge = allowed ? (href ? '<span class="acc-go">→</span>' : '<span class="acc-go">✅</span>') : '<span class="acc-lock">⛔</span>';
      const inner = `<span class="acc-ico">${icon}</span><span class="acc-main"><b>${esc(label)}</b>${desc ? `<small>${esc(desc)}</small>` : ''}${sumId ? `<em class="acc-sum" data-acc-sum="${esc(sumId)}"></em>` : ''}</span>${badge}`;
      if (!href) return `<span class="acc-card ${toneClass} ${allowed ? 'done' : 'locked'}" ${allowed ? '' : `data-acc-locked="${esc(label)}"`}>${inner}</span>`;
      if (allowed) return `<a class="acc-card ${toneClass}" href="${esc(href)}">${inner}</a>`;
      return `<button type="button" class="acc-card ${toneClass} locked" data-acc-locked="${esc(label)}">${inner}</button>`;
    };
    const order = ['Management', 'First Forward', 'GV Partner', 'Cross Channel', 'Workspace'];
    const allowedOf = (p) => A.can(p.perm) && (!p.adminOnly || A.isAdmin()) && (!p.feat || !FF.config.features || FF.config.features[p.feat] !== false);
    const panels = order.map((g) => ({ g, items: pages.filter((p) => p.group === g && allowedOf(p)) })).filter((p) => p.items.length);
    let html = '<div class="acc-panels">';
    panels.forEach((panel) => {
      const t = tone(panel.g);
      const items = panel.items.map((p) => cardHtml(p.icon, p.label, p.desc, `#/${p.id}`, true, t, p.id)).join('');
      html += `<div class="acc-panel"><div class="acc-panel-head"><span class="acc-panel-ico">${ACC_ICON[panel.g] || '▦'}</span><b>${esc(panel.g)}</b><span class="acc-count">${panel.items.length} pages</span></div><div class="acc-grid">${items}</div></div>`;
    });
    const pagePermKeys = new Set(pages.map((p) => p.perm));
    const actionPerms = perms.filter((p) => !pagePermKeys.has(p.key) && !String(p.key).startsWith('sheet:') && A.can(p.key));
    if (actionPerms.length) {
      html += `<div class="acc-panel"><div class="acc-panel-head"><span class="acc-panel-ico">${ACC_ICON.Actions}</span><b>Actions</b><span class="acc-count">${actionPerms.length} permissions</span></div><div class="acc-grid">${actionPerms.map((p) => cardHtml('⚡', p.label, 'Har page ke andar available action', '', true, tone('Actions'), '')).join('')}</div></div>`;
    }
    const sheets = perms.filter((p) => String(p.key).startsWith('sheet:') && A.can(p.key));
    if (sheets.length) {
      html += `<div class="acc-panel"><div class="acc-panel-head"><span class="acc-panel-ico">${ACC_ICON.Sheets}</span><b>Sheets</b><span class="acc-count">${sheets.length} tabs</span></div><div class="acc-grid">${sheets.map((p) => cardHtml('📄', p.label.replace(/^Sheet · /, ''), p.group, `#/sheet/${encodeURIComponent(p.key.slice(6))}`, true, tone('Sheets'), '')).join('')}</div></div>`;
    }
    html += '</div>';
    const granted = perms.filter((p) => A.can(p.key)).length;
    html += `<p class="dim small" style="margin-top:10px">${u.role === 'admin' ? '👑 Admin — sab pages khule hain.' : `Aapke paas <b>${granted}</b> permissions active hain — sirf wahi yahan dikhte hain.`} Card par click = wahi page data summary ke saath khulega.</p>`;
    return html;
  }

  // ---- 🎙 Assistant awaaz & bhasha (My account · per-user, localStorage) ----
  const voiceScore = (v) => (/^hi[-_]/i.test(v.lang) ? 0 : /^en[-_]IN/i.test(v.lang) ? 1 : /^en/i.test(v.lang) ? 2 : 3);
  function voiceOptions(p, key) {
    const vs = (typeof window !== 'undefined' && 'speechSynthesis' in window) ? (window.speechSynthesis.getVoices() || []) : [];
    const sorted = vs.slice().sort((a, b) => voiceScore(a) - voiceScore(b) || String(a.name).localeCompare(String(b.name)));
    const cur = key === 'en' ? p.en : p.hi;
    return `<option value="">🎲 Auto — browser default</option>${sorted.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === cur ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)}${v.localService ? '' : ' · 🟣 online'}</option>`).join('')}`;
  }
  function voiceSection() {
    const p = U.voicePrefs();
    const prof = U.voiceProfile();
    const langSel = `<label class="fld"><span>🌐 Assistant language</span><select class="input" id="voice-lang"><option value="hi" ${p.lang !== 'en' ? 'selected' : ''}>हिंदी / Hinglish (default)</option><option value="en" ${p.lang === 'en' ? 'selected' : ''}>English</option></select></label>`;
    const voiceSel = (key, label) => `<label class="fld"><span>${label}</span><select class="input" id="voice-${key}" data-vkey="${key}">${voiceOptions(p, key)}</select></label>`;
    const slider = (key, label, dflt) => { const v = Number(p[key]) > 0 ? Number(p[key]) : dflt; return `<label class="fld"><span>${label} <b data-vval="${key}">${v}</b></span><input type="range" id="voice-${key}" data-vkey="${key}" min="0.5" max="1.5" step="0.05" value="${v}"></label>`; };
    const profChip = prof
      ? `<div class="btn-row"><span class="ins-pill hot">🎤 ${esc(prof.name)} active</span><span class="ins-pill">Pitch ~${esc(prof.hz)} Hz · ${esc(prof.gender === 'male' ? 'deep' : 'soft')}</span><span class="ins-pill">Speed ${Number(prof.rate).toFixed(2)}×</span><button class="btn small danger" id="voice-prof-clear">🗑 Profile hatao</button></div>`
      : `<p class="dim small">Abhi koi personal voice profile nahi — default system voice chal rahi hai.</p>`;
    return section('🎙 Assistant awaaz & bhasha', `<p class="dim small">Voice assistant ka jawab kis awaaz me bole — Hindi / English voice, speed aur pitch yahan se set karo. Har language ki apni voice choose hoti hai; assistant panel ke 🌐 button se language turant switch hoti hai (mic ki bhasha bhi saath me badalti hai — hi-IN ⇄ en-IN). Test karke sun lo, pasand aaye to bas.</p>
      <div class="form-grid">${langSel}${voiceSel('hi', '🗣 Hindi / Hinglish awaaz')}${voiceSel('en', '🗣 English awaaz')}${slider('rate', '⚡ Speed', 1.02)}${slider('pitch', '🎵 Pitch', 1)}</div>
      <div class="form-grid"><label class="check"><input type="checkbox" id="voice-greet" ${p.greet !== false ? 'checked' : ''}> 🌅 <b>Login par voice greeting</b> — "Good morning &lt;naam&gt;, kaise ho aap?" bol kar welcome</label><label class="check"><input type="checkbox" id="voice-conv" ${p.convMode === true ? 'checked' : ''}> 🎧 <b>Hands-free conversation mode</b> — har jawab ke baad khud sunta rahega (Alexa-style)</label></div>
      <div class="form-grid"><label class="check"><input type="checkbox" id="voice-wake" ${p.wake !== false ? 'checked' : ''}> 👂 <b>Wake word ON</b> — word bolte hi voice assistant active (Alexa/Siri style)</label><label class="fld"><span>🗣 Wake word (konsa word sunna hai)</span><input class="input" id="voice-wake-word" value="${esc(p.wakeWord || 'Hey Gems')}" maxlength="30" placeholder="Hey Gems"></label></div>
      <p class="dim small" id="voice-wake-status"></p>
      <div class="btn-row"><button class="btn small" id="voice-test-hi">🔊 Hindi test</button><button class="btn small" id="voice-test-en">🔊 English test</button><button class="btn small" id="voice-refresh">🔄 Voice list refresh</button><button class="btn small" id="voice-reset">↺ Default</button></div>
      <p class="dim small" id="voice-count"></p>
      <h4 class="drawer-section-title">🎤 Meri awaaz — sample upload / record</h4>
      <p class="dim small">Apni voice ka 5–15 second ka sample do — assistant uski pitch, speed aur tone analyze kar ke <b>usi style me</b> bolne lagta hai (browser TTS tone-match). Audio sirf analyze hoti hai, save nahi hoti. Full Voice Studio (default voices + meri awaaz, ek jagah) assistant ke 🎛 button se bhi khul sakti hai.</p>
      ${profChip}
      <div class="btn-row"><label class="btn small" style="cursor:pointer">📁 Voice sample upload<input type="file" id="voice-file" accept="audio/*" hidden></label><button class="btn small" id="voice-rec">⏺ Record karo</button><span class="dim small" id="voice-rec-status"></span></div>
      <div class="btn-row"><button class="btn small" id="voice-studio-open">🎛 Voice Studio kholein</button></div>`, 'localStorage · sirf aapke browser me');
  }
  function bindVoiceTab(body) {
    const countEl = U.$('#voice-count', body);
    const refresh = () => {
      ['hi', 'en'].forEach((key) => { const sel = U.$(`#voice-${key}`, body); if (sel) sel.innerHTML = voiceOptions(U.voicePrefs(), key); });
      const vs = (typeof window !== 'undefined' && 'speechSynthesis' in window) ? (window.speechSynthesis.getVoices() || []) : [];
      if (countEl) countEl.textContent = vs.length ? `${vs.length} voices mili — best quality ke liye 🟣 online "Microsoft … India" ya "Google हिन्दी" voice chuno.` : 'Browser ne abhi tak voice list nahi bheji — 🔄 refresh dabao (ya page kholte hi Chrome voices background me load hoti hain).';
    };
    refresh();
    try { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = refresh; } catch { /* optional */ }
    const langSel = U.$('#voice-lang', body);
    if (langSel) langSel.addEventListener('change', () => U.setVoicePrefs({ lang: langSel.value }));
    const greetCb = U.$('#voice-greet', body);
    if (greetCb) greetCb.addEventListener('change', () => {
      U.setVoicePrefs({ greet: greetCb.checked });
      U.toast(greetCb.checked ? '🌅 Login greeting ON — next login par assistant awaaz me bolega.' : '🔕 Login greeting OFF.', 'ok');
    });
    const convCb = U.$('#voice-conv', body);
    if (convCb) convCb.addEventListener('change', () => {
      U.setVoicePrefs({ convMode: convCb.checked });
      U.toast(convCb.checked ? '🎧 Hands-free mode ON — assistant har jawab ke baad khud sunega.' : '🎧 Hands-free mode OFF.', 'ok');
    });
    // 👂 Wake word — on/off + apna word set karo (assistant turant sync hota hai)
    const wakeCb = U.$('#voice-wake', body), wakeWordEl = U.$('#voice-wake-word', body), wakeStatusEl = U.$('#voice-wake-status', body);
    const wakeInfo = () => {
      if (!wakeStatusEl) return;
      const A2 = FF.assistant;
      const word = String((U.voicePrefs().wakeWord || 'Hey Gems')).trim() || 'Hey Gems';
      const on = U.voicePrefs().wake !== false;
      const supported = !A2 || !A2.wakeSupported || A2.wakeSupported();
      if (!supported) wakeStatusEl.textContent = '⚠️ Is browser me speech recognition nahi hai — wake word Chrome/Edge me best chalta hai.';
      else if (!on) wakeStatusEl.textContent = '🔕 Wake word OFF hai — checkbox lagao to assistant word sunkar active hoga.';
      else wakeStatusEl.textContent = `🟢 Wake word ON — jab aap "${word}" bolenge, assistant khud active ho kar sawaal sunega. FAB par green dot = sun raha hai.`;
    };
    wakeInfo();
    if (wakeCb) wakeCb.addEventListener('change', () => {
      U.setVoicePrefs({ wake: wakeCb.checked });
      wakeInfo();
      U.toast(wakeCb.checked ? `👂 Wake word ON — "${(wakeWordEl && wakeWordEl.value.trim()) || 'Hey Gems'}" bolo to assistant active.` : '🔕 Wake word OFF.', 'ok');
    });
    if (wakeWordEl) {
      let wakeTimer = null;
      wakeWordEl.addEventListener('input', () => {
        clearTimeout(wakeTimer);
        wakeTimer = setTimeout(() => {
          const word = wakeWordEl.value.trim();
          if (word.length < 2) { if (wakeStatusEl) wakeStatusEl.textContent = '⚠️ Wake word kam se kam 2 letters ka rakho.'; return; }
          U.setVoicePrefs({ wakeWord: word });
          wakeInfo();
          U.toast(`🗣 Wake word set: "${word}" ✓`, 'ok');
        }, 600);
      });
    }
    U.$$('[data-vkey]', body).forEach((el) => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const key = el.dataset.vkey;
        if (el.tagName === 'SELECT') U.setVoicePrefs({ [key]: el.value });
        else { U.setVoicePrefs({ [key]: Number(el.value) }); const out = U.$(`[data-vval="${key}"]`, body); if (out) out.textContent = el.value; }
      });
    });
    const speakSample = (langKey) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return U.toast('Is browser me speech synthesis support nahi hai — Chrome/Edge try karo.', 'warn');
      try {
        window.speechSynthesis.cancel();
        const text = langKey === 'en' ? 'Hello! I am your First Forward dashboard assistant. Rahul issued forty tags today.' : 'Namaste! Main First Forward dashboard assistant hoon. Aaj Rahul ke chaalis tags lage.';
        const p = U.voicePrefs();
        const u = new SpeechSynthesisUtterance(text);
        const vs = window.speechSynthesis.getVoices() || [];
        const v = U.matchVoice(vs, langKey, U.voiceProfile());
        if (v) u.voice = v;
        u.lang = (v && v.lang) || (langKey === 'en' ? 'en-IN' : 'hi-IN');
        u.rate = Number(p.rate) > 0 ? Number(p.rate) : 1.02;
        u.pitch = Number(p.pitch) > 0 ? Number(p.pitch) : 1;
        window.speechSynthesis.speak(u);
      } catch { /* optional */ }
    };
    const th = U.$('#voice-test-hi', body); if (th) th.addEventListener('click', () => speakSample('hi'));
    const te = U.$('#voice-test-en', body); if (te) te.addEventListener('click', () => speakSample('en'));
    const vr = U.$('#voice-refresh', body); if (vr) vr.addEventListener('click', refresh);
    const vreset = U.$('#voice-reset', body);
    if (vreset) vreset.addEventListener('click', () => {
      U.setVoiceProfile(null);
      U.setVoicePrefs({ lang: 'hi', hi: '', en: '', rate: 0, pitch: 0 });
      const ls = U.$('#voice-lang', body); if (ls) ls.value = 'hi';
      ['hi', 'en'].forEach((k) => { const sel = U.$(`#voice-${k}`, body); if (sel) sel.value = ''; });
      [['rate', '1.02'], ['pitch', '1']].forEach(([k, v]) => { const el = U.$(`#voice-${k}`, body); if (el) el.value = v; const out = U.$(`[data-vval="${k}"]`, body); if (out) out.textContent = v; });
      U.toast('🎙 Voice settings default par reset ✓', 'ok');
    });
    // ---- 🎤 Meri awaaz — sample upload/record → analyze → apply (shared U helpers) ----
    // cap = { blob } (upload) ya { blob, pcm, sampleRate } (record) — recording raw PCM se analyse
    // hoti hai, isliye browser audio-decode fail hone par bhi kaam karti hai.
    const applyVoiceSample = async (cap, name) => {
      const status = U.$('#voice-rec-status', body);
      if (!cap) return;
      if (status) status.textContent = '🔍 Awaaz analyze ho rahi hai…';
      try {
        const res = await U.analyzeVoiceCapture(cap);
        if (!res.ok) { if (status) status.textContent = `⚠️ ${res.reason}`; return; }
        res.name = name || 'Meri awaaz';
        U.setVoiceProfile(res);
        if (status) status.textContent = `✓ ${res.name} apply ho gayi — ~${res.hz} Hz · ${res.gender === 'male' ? 'deep' : 'soft'} · ${res.rate}× speed`;
        U.toast('✅ Meri awaaz lag gayi — assistant ab isi tone me bolega!', 'ok');
      } catch (err) {
        if (status) status.textContent = `⚠️ ${err.message || 'Decode nahi hua'}`;
        U.toast(err.message || 'Audio analyze nahi hua — dobara try karo.', 'err');
      }
    };
    const fileEl = U.$('#voice-file', body);
    if (fileEl) fileEl.addEventListener('change', () => {
      const f = fileEl.files && fileEl.files[0];
      if (f) applyVoiceSample({ blob: f }, f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Meri awaaz');
      fileEl.value = ''; // same file dobara select karne par bhi change fire ho
    });
    const recBtn = U.$('#voice-rec', body);
    if (recBtn) recBtn.addEventListener('click', async () => {
      const status = U.$('#voice-rec-status', body);
      if (recBtn.dataset.recording === '1' && recBtn._capture) {
        const cap = await recBtn._capture.stop();
        recBtn._capture = null;
        recBtn.dataset.recording = '0';
        recBtn.textContent = '⏺ Record karo';
        if (status) status.textContent = 'Recording complete ✓ analyze ho raha hai…';
        applyVoiceSample(cap, 'Meri awaaz');
        return;
      }
      try {
        recBtn._capture = await U.startVoiceCapture();
        recBtn.dataset.recording = '1';
        recBtn.textContent = '⏹ Stop';
        if (status) status.textContent = '⏺ Recording… bolo abhi (5–15 second)';
      } catch (err) {
        U.toast(err.message || 'Mic permission chahiye — recording ke liye Allow karo.', 'err');
        if (status) status.textContent = `⚠️ ${err.message || 'Mic permission chahiye — Allow karo'}`;
      }
    });
    const profClear = U.$('#voice-prof-clear', body);
    if (profClear) profClear.addEventListener('click', () => {
      U.setVoiceProfile(null);
      U.toast('🗑 Voice profile hata di — default voice wapas.', 'ok');
    });
    const studioOpen = U.$('#voice-studio-open', body);
    if (studioOpen) studioOpen.addEventListener('click', () => {
      if (FF.assistant && FF.assistant.openVoiceStudio) FF.assistant.openVoiceStudio();
      else U.toast('Assistant abhi load nahi hua — page refresh karo.', 'warn');
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
      ${section('🛡️ My access <span class="dim">· colorful · click = page + data summary</span>', accessSection(perms, u))}`;
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
    const s = settings, fc = s.ffCommission || {}, sm = s.stockMovement || {}, cs = s.commissionSlabs || defaults.commissionSlabs || {};
    const gvcr = s.gvCommissionRates || (defaults && defaults.gvCommissionRates) || {};
    const gvPersonalClasses = ['VC4', 'VC20', 'VC5', 'VC6', 'VC7', 'VC12'];
    const standardSlabs = [{ min: 1, max: 50, rate: '' }, { min: 51, max: 100, rate: '' }, { min: 101, max: 150, rate: '' }, { min: 151, max: 250, rate: '' }, { min: 251, max: null, rate: '' }];
    const slabEditor = (channel, label) => { const slabs = (cs.channels && cs.channels[channel]) || standardSlabs; return `<div class="card compact-card"><div class="card-head"><h3>${label}</h3><span class="dim small">₹ per tag</span></div><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent issuance slab</th><th>Commission per tag (₹)</th></tr></thead><tbody>${standardSlabs.map((band, i) => { const saved = slabs[i] || band; return `<tr><td><b>${band.max === null ? `${band.min}+` : `${band.min}–${band.max}`}</b></td><td><input class="input mono" inputmode="decimal" data-path="commissionSlabs.channels.${channel}.${i}.rate" value="${esc(saved.rate ?? '')}" placeholder="Set ₹ / tag"></td></tr>`; }).join('')}</tbody></table></div></div>`; };
    const letters = (obj, keys, prefix) => `<div class="letter-grid">${keys.map((k) => `<label><small>${k}</small><input class="input mono" data-path="${prefix}.${k}" value="${esc(obj[k] ?? '')}"></label>`).join('')}</div>`;
    return `${section('📄 Google Sheet', `<div class="form-grid">${field('Sheet ID', txt('sheetId', s.sheetId, 'class="input mono"'), 'docs.google.com/spreadsheets/d/<b>ID</b>/edit — sheet "Anyone with the link can view" honi chahiye')}${field('EIR tab name', txt('eirSheet', s.eirSheet))}${field('StockDataa tab name', txt('stockSheet', s.stockSheet))}${field('StockDataa gid (optional)', txt('stockGid', s.stockGid))}${field('REPORT gid', txt('reportGid', s.reportGid), 'Google URL me #gid=… (REPORT tab)')}${field('Server cache (seconds)', numI('cacheSeconds', s.cacheSeconds, 'min="0"'), 'Browser reload par itni der tak server ka cached data milta hai; ↻ button hamesha fresh laata hai')}</div>
        <div class="form-grid">${field('Excluded TL names (not real TLs)', `<input class="input" data-path="excludeTls" data-list value="${esc((s.excludeTls || []).join(', '))}">`, 'Comma separated. Ye naam kisi bhi TL list / ranking me nahi aayenge (e.g. APS = direct agents)')}${field('GV master ID', txt('eir.gvMasterId', s.eir.gvMasterId))}${field('GV channel TL name', txt('eir.gvChannelTl', s.eir.gvChannelTl))}</div>
        <h4 style="margin:14px 0 8px">₹ FF REPORT commission column settings <span class="dim small">(optional · admin configurable)</span></h4><p class="dim small">Yahan REPORT sheet ke commission source ka <b>column letter</b> (jaise <b>BZ</b>) <b>ya heading ka naam</b> (jaise <b>Commission Rate</b>) — dono chalte hain. Naam likhne par dashboard REPORT headings me wahi naam dhoondta hai (chhota-bada letter, extra space sab ignore hota hai). Save karne ke baad Commission Intelligence refresh karein.</p><div class="form-grid">${field('Commission rate column / heading', txt('ffCommission.rateCol', fc.rateCol || '', 'placeholder="e.g. BZ ya Commission Rate" maxlength="60"'), 'Rate / percentage / per-tag rate ka REPORT column — letter ya heading ka naam')}${field('Earned commission column / heading', txt('ffCommission.earnedCol', fc.earnedCol || '', 'placeholder="e.g. CA ya Earned Commission" maxlength="60"'), 'Actual earned / payout amount ka column — rate se alag (letter ya naam)')}${field('Agent category column / heading', txt('ffCommission.categoryCol', fc.categoryCol || '', 'placeholder="optional" maxlength="60"'), 'Direct/TL se extra sheet category ho to uska column')}${field('Commission date column / heading', txt('ffCommission.dateCol', fc.dateCol || '', 'placeholder="optional" maxlength="60"'), 'Date/period column, Today / 7 / 15 / 30 day filters ke liye')}</div><p class="dim small">Blank chhodne par headings auto-detect hoti hain (commission / comm. / payout / earning / incentive / ₹ jaisi heading milte hi dashboard khud utha leta hai). Jo bhi heading app use kar rahi hai wo <b>Commission Intelligence → 🔍 REPORT commission column finder</b> table me letter ke saath dikhti hai — wahan se ek click me bhi set kar sakte hain. Missing commission ko guessed rate se calculate nahi kiya jata.</p><div class="btn-row"><a class="btn small" href="#/ffCommission">₹ Open Commission Intelligence → column finder</a></div>`)}
      ${section('🧾 FF payout sheet · class rates + penalties', `<p class="dim small">FF Google Sheet ki <b>payout</b> tab jisme har class ka commission rate aur penalty likha hai (jaise VC4 kitna, VC20 kitna, VC5+ kitna, wrong VRN penalty kitni). Commission Intelligence page isi se <b>expected commission</b> calculate karti hai — class-wise counts × rate − penalties (koi average nahi). Tab ka naam/columns auto-detect hote hain; galat mile to yahan set karo.</p><div class="form-grid">${field('Payout tab name', txt('ffPayout.sheet', (s.ffPayout || {}).sheet ?? 'payout'), 'FF spreadsheet me exact tab naam (default: payout)')}${field('Payout tab gid (optional)', txt('ffPayout.gid', (s.ffPayout || {}).gid || ''))}${field('Particulars column (optional)', txt('ffPayout.labelCol', (s.ffPayout || {}).labelCol || '', 'placeholder="auto" maxlength="40"'))}${field('Class column (optional)', txt('ffPayout.classCol', (s.ffPayout || {}).classCol || '', 'placeholder="auto" maxlength="40"'))}${field('Commission rate column (optional)', txt('ffPayout.rateCol', (s.ffPayout || {}).rateCol || '', 'placeholder="auto" maxlength="40"'))}${field('Penalty column (optional)', txt('ffPayout.penaltyCol', (s.ffPayout || {}).penaltyCol || '', 'placeholder="auto" maxlength="40"'))}</div><div class="btn-row"><a class="btn small" href="#/ffCommission">🧾 Payout rates preview dekho →</a></div>${saveBar('ffPayout')}`)}
      ${section('💸 Commission slabs · FF + GV', `<p class="dim small">Har channel ke liye ₹ per tag set karein. Slab agent ke selected-period total issuance par apply hoga. <b>Agent tier</b>: total count jis slab me aaye, us rate ko period ke sab tags par lagaye. <b>Marginal</b>: har band ka rate sirf us band ke tags par apply hoga. Actual sheet commission ke saath difference dekhne ke liye rates set karke Enable karein.</p><label class="check"><input type="checkbox" data-path="commissionSlabs.enabled" ${cs.enabled === true ? 'checked' : ''}> <b>Enable slab expected-vs-actual comparison</b></label><div class="form-grid"><label class="fld"><span>Slab calculation model</span><select class="input" data-path="commissionSlabs.model"><option value="agentTier" ${(cs.model || 'agentTier') === 'agentTier' ? 'selected' : ''}>Agent tier · one rate × all tags</option><option value="marginal" ${cs.model === 'marginal' ? 'selected' : ''}>Marginal · rate per band</option></select></label></div><div class="split-cards">${slabEditor('ff', 'First Forward')}${slabEditor('gv', 'GV Partner')}</div><p class="dim small">Bands: 1–50 · 51–100 · 101–150 · 151–250 · 251+. ₹ rate blank ho to us slab ka expected payout nahi banega—dashboard guess nahi karega.</p>${saveBar('commissionSlabs')}`)}
      ${section('👤 GV personal commission · class-wise rates', `<p class="dim small">GV Commission Intelligence me <b>agent ID + exact vehicle class</b> ke hisaab se personal commission dikhai jayega. <b>VC4 default = GV Master ke current month ke commission column ki exact rate</b>; koi average, cut ya extra amount nahi. Baaki classes ke official rates aap yahan set kar sakte ho. Blank manual rate par dashboard payout guess nahi karega.</p><label class="check"><input type="checkbox" data-path="gvCommissionRates.enabled" ${gvcr.enabled !== false ? 'checked' : ''}> <b>Personal commission table ON</b></label><p class="dim small">Source rule: <b>GV Master</b> select karne par row ke agent ID + class se commission value li jayegi. <b>Manual</b> select karke ₹/tag bharo to us class ke current-month tags × wahi rate hoga. Rate source har agent ke saamne dikhega.</p><div class="gv-rate-settings"><div class="gv-rate-settings-head"><span>Vehicle class</span><span>Rate source</span><span>Manual rate (₹ / tag)</span></div>${gvPersonalClasses.map((cls) => { const saved = (gvcr.classes && gvcr.classes[cls]) || {}; const source = saved.source === 'manual' ? 'manual' : (cls === 'VC4' ? 'master' : 'manual'); return `<div class="gv-rate-setting-row"><b>${cls}</b><select class="input" data-path="gvCommissionRates.classes.${cls}.source"><option value="master" ${source === 'master' ? 'selected' : ''}>GV Master · agent + class</option><option value="manual" ${source === 'manual' ? 'selected' : ''}>Manual setting</option></select><input class="input mono" type="number" min="0" step="0.0001" inputmode="decimal" data-path="gvCommissionRates.classes.${cls}.rate" value="${esc(saved.rate ?? '')}" placeholder="${source === 'master' ? 'Auto from GV Master' : 'Set ₹ / tag'}"><small class="dim">${cls === 'VC4' && source === 'master' ? 'Default: exact GV Master rate' : 'Aap official rate set karo'}</small></div>`; }).join('')}</div>${saveBar('gvCommissionRates')}`)}
      ${section('🚨 Commission alerts &amp; dispatch thresholds', `<p class="dim small">Commission alerts (FF Commission page) aur Dispatch Planner ke defaults. Alert na chahte ho to enable off kar do.</p><div class="form-grid">
        <label class="check"><input type="checkbox" data-path="commissionAlerts.enabled" ${(s.commissionAlerts || {}).enabled !== false ? 'checked' : ''}> <b>Commission alerts ON</b></label>
        ${field('Rate outlier vs peer median %', numI('commissionAlerts.outlierPct', (s.commissionAlerts || {}).outlierPct !== undefined ? s.commissionAlerts.outlierPct : 25), 'Isse zyada gap par alert')}
        ${field('GV per-tag gap vs class median %', numI('commissionAlerts.gvGapPct', (s.commissionAlerts || {}).gvGapPct !== undefined ? s.commissionAlerts.gvGapPct : 40))}
        ${field('Sheet vs computed mismatch %', numI('commissionAlerts.mismatchPct', (s.commissionAlerts || {}).mismatchPct !== undefined ? s.commissionAlerts.mismatchPct : 5))}
        ${field('Mismatch minimum ₹', numI('commissionAlerts.mismatchMin', (s.commissionAlerts || {}).mismatchMin !== undefined ? s.commissionAlerts.mismatchMin : 50), 'Chhote gaps ignore')}
        ${field('Tags per box (dispatch)', numI('dispatch.tagsPerBox', (s.dispatch || {}).tagsPerBox !== undefined ? s.dispatch.tagsPerBox : 25))}
        ${field('Dispatch horizon (din)', numI('dispatch.horizon', (s.dispatch || {}).horizon !== undefined ? s.dispatch.horizon : 7), '7 / 15 / 30')}
        ${field('Minimum need (tags)', numI('dispatch.minNeed', (s.dispatch || {}).minNeed !== undefined ? s.dispatch.minNeed : 1), 'Isse kam need wale agents plan me nahi')}
      </div><div class="btn-row"><a class="btn small" href="#/ffCommission">🚨 Commission alerts dekho</a><a class="btn small" href="#/dispatchPlan">🚚 Dispatch planner</a></div>${saveBar('commissionAlerts')}${saveBar('dispatch')}`)}
      ${section('🟩 GV Partner sheet <span class="dim">(dusra Google Sheet)</span>', `<div class="form-grid">${field('GV Sheet ID', txt('gvSheetId', s.gvSheetId, 'class="input mono"'), 'GV Partner ki sheet — "Anyone with the link can view" honi chahiye')}${field('GV Master tab', txt('gv.master.tab', (s.gv || {}).master ? s.gv.master.tab : ''), 'Issuance log tab ka exact naam')}${field('GV Master gid (optional)', txt('gv.master.gid', (s.gv || {}).master ? s.gv.master.gid : ''))}${field('Tag Assignment tab', txt('gv.assignment.tab', (s.gv || {}).assignment ? s.gv.assignment.tab : ''), 'Stock tab ka exact naam')}${field('Tag Assignment allocation-date column', txt('gv.assignment.allocatedAt', (s.gv || {}).assignment ? s.gv.assignment.allocatedAt || '' : '', 'placeholder="optional · e.g. N" maxlength="3"'), 'Daily duplicate-barcode review ke liye assignment / allocation date column (blank = date-based GV alert unavailable)')}${field('GV REPORT tab', txt('gv.report.tab', (s.gv || {}).report ? s.gv.report.tab : ''))}${field('GV REPORT gid', txt('gv.report.gid', (s.gv || {}).report ? s.gv.report.gid : ''), 'Google URL me #gid=… (GV REPORT tab)')}${field('GV REPORT header row', numI('gv.report.headerRow', (s.gv || {}).report ? s.gv.report.headerRow : 4), 'GV REPORT me heading row (default 4)')}${field('GV REPORT last column', txt('gv.report.lastCol', (s.gv || {}).report ? s.gv.report.lastCol : 'BE'), 'Sabse aakhri column (default BE)')}</div>${saveBar('data')}`)}
      ${section('🔠 EIR column letters', letters(s.eir, ['tagId', 'vrn', 'cls', 'type', 'status', 'date', 'agentId', 'agentName', 'masterId', 'tlId', 'gvId', 'gvName', 'gvTl', 'tlName', 'vrnType', 'monthName', 'regNumber'], 'eir') + saveBar('eir'), 'Sheet me column shift ho to sirf letters badlo')}
      ${section('🔠 StockDataa column letters', letters(s.stock, ['id', 'name', 'tagId', 'barcode', 'cls', 'tagType', 'bcAllocatedAt', 'agentId', 'agentName', 'agentAllocatedAt', 'tlName'], 'stock') + saveBar('stock'))}
      ${section('🔄 Stock movement ledger <span class="dim">(optional · exact inward / transfer reconciliation)</span>', `${check('stockMovement.enabled', sm.enabled === true, 'Google Sheet movement ledger connect karo')}<p class="dim small">First Forward spreadsheet me ek unified tab use hota hai. Har real movement ki ek row rakho. Channel = <code>First Forward</code> ya <code>GV Partner</code>; Type = <code>IN</code>, <code>OUT</code>, <code>TRANSFER</code>, ya signed <code>ADJUSTMENT</code>. Unknown type ko dashboard guess nahi karega.</p><div class="form-grid">${field('Movement tab name', txt('stockMovement.sheet', sm.sheet || 'Stock Movements'), 'Main First Forward spreadsheet ke andar')}${field('Date column', txt('stockMovement.date', sm.date || 'A', 'maxlength="3"'))}${field('Channel column', txt('stockMovement.channel', sm.channel || 'B', 'maxlength="3"'))}${field('Movement type column', txt('stockMovement.type', sm.type || 'C', 'maxlength="3"'))}${field('Quantity column', txt('stockMovement.quantity', sm.quantity || 'D', 'maxlength="3"'))}${field('Vehicle class column', txt('stockMovement.cls', sm.cls || 'E', 'maxlength="3"'))}${field('From column', txt('stockMovement.from', sm.from || 'F', 'maxlength="3"'))}${field('To column', txt('stockMovement.to', sm.to || 'G', 'maxlength="3"'))}${field('Reference column', txt('stockMovement.reference', sm.reference || 'H', 'maxlength="3"'))}${field('Note column', txt('stockMovement.note', sm.note || 'I', 'maxlength="3"'))}</div><div class="btn-row"><button class="btn small" id="movement-template">⬇ Movement CSV template</button><a class="btn small" href="#/forecast?view=balance">Open reconciliation</a></div>${saveBar('stockMovement')}`)}
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
  // 🧍 Direct Agents & TLs — ek hi rule poore site par (FF: TL Name APS · GV: TL ID + TL Name blank).
  function directTab() {
    const s = settings || {};
    const d = Object.assign({}, (FF.config && FF.config.direct) || {}, s.direct || {});
    const on = (v, def) => (v === undefined ? def : v !== false);
    const placeholders = (s.directPlaceholderTls && s.directPlaceholderTls.length ? s.directPlaceholderTls : (FF.config.directPlaceholderTls || []));
    return `${section('🧍 Direct Agents & TLs <span class="dim">· ek hi rule poore site par</span>', `
      <p class="dim small">Direct agent = jiske paas asli TL nahi. Yahi rule <b>har page</b> par lagta hai — GV Stock Report (dispatch filter), Dispatch Planner ka “Direct pool”, Performance ka TL dropdown (🚫 option), Stock page ka direct chip, Team Network ka alag hub, Master search aur <a href="#/directAgents">🧍 Direct Agents page</a>. Direct agents TL ranking/table me kabhi nahi aate aur (default) unko stock dispatch nahi jaata.</p>
      <div class="direct-rule-grid">
        <div class="direct-rule-card"><div class="direct-rule-head"><span>🟦</span><b>First Forward</b><small>TL Name rule</small></div>
          <p>Jinke <b>TL Name</b> neeche list me hain → <b>Direct Agent (APS)</b>.</p>
          ${field('FF direct TL names', `<input class="input" data-path="direct.ffTlNames" data-list value="${esc((d.ffTlNames || ['APS']).join(', '))}">`, 'Comma separated · default APS')}
        </div>
        <div class="direct-rule-card"><div class="direct-rule-head"><span>🟩</span><b>GV Partner</b><small>TL ID + TL Name rule</small></div>
          <p>Jinke <b>TL ID aur TL Name dono khaali</b> → <b>Direct Agent (no TL)</b>.</p>
          ${check('direct.gvNoTl', on(d.gvNoTl, true), 'TL ID + TL Name dono blank = direct')}
          ${check('direct.gvSelfSupervised', on(d.gvSelfSupervised, true), 'Agent hi apna supervisor (self) = direct')}
        </div>
      </div>
      <div class="form-grid">${field('FF label', txt('direct.labelFf', d.labelFf || 'Direct Agent (APS)'))}${field('GV label', txt('direct.labelGv', d.labelGv || 'Direct Agent (no TL)'))}</div>
      <div class="form-grid"><label class="check"><input type="checkbox" data-path="direct.enabled" ${on(d.enabled, true) ? 'checked' : ''}> <b>Rule ON</b></label>${check('direct.hideFromTlViews', on(d.hideFromTlViews, true), 'TL lists / rankings / TL tables se hatao')}${check('direct.dispatchExempt', on(d.dispatchExempt, true), 'Stock dispatch exempt (planner me alag “Direct pool”)')}</div>
      ${field('Placeholder TL names (kabhi asli TL nahi)', `<input class="input" data-path="directPlaceholderTls" data-list value="${esc(placeholders.join(', '))}">`, 'Comma separated — Direct, No TL, Unassigned… Ye har channel me TL list se bahar rehte hain')}
      <div class="btn-row"><a class="btn small" href="#/directAgents">🧍 Direct agents list →</a><a class="btn small" href="#/gvStockReport?view=dispatch">📋 GV dispatch view →</a><a class="btn small" href="#/dispatchPlan">🚚 Dispatch planner →</a><a class="btn small" href="#/performance?view=alerts">🏆 FF dispatch alerts →</a></div>
      ${saveBar('direct')}`)}
      ${section('🔍 Live preview <span class="dim">· is rule se kaun direct ban raha hai</span>', `<div id="dir-preview"><div class="dim small">Preview ban raha hai…</div></div>`)}`;
  }
  async function fillDirectPreview(body) {
    const box = U.$('#dir-preview', body);
    if (!box) return;
    const rows = [];
    try {
      if (FF.pages.performance && FF.pages.performance.ensureLoaded) await FF.pages.performance.ensureLoaded();
      const ff = (FF.pages.performance.agents && FF.pages.performance.agents()) || [];
      const directFf = ff.filter((a) => FF.config.isDirectAgent(a, 'ff'));
      rows.push(`<tr><td>🟦 First Forward <small class="dim">REPORT</small></td><td class="num"><b>${U.fmt(ff.length)}</b></td><td class="num"><b>${U.fmt(directFf.length)}</b></td><td class="small">${directFf.slice(0, 8).map((a) => esc(a.name)).join(', ') || '<span class="dim">—</span>'}</td></tr>`);
    } catch (err) { /* FF data optional */ }
    try {
      if (FF.gv && FF.gv.need) {
        const rep = await FF.gv.need('report');
        const directGv = (rep || []).filter((r) => FF.config.isDirectAgent(r, 'gv'));
        rows.push(`<tr><td>🟩 GV Partner <small class="dim">GV REPORT</small></td><td class="num"><b>${U.fmt((rep || []).length)}</b></td><td class="num"><b>${U.fmt(directGv.length)}</b></td><td class="small">${directGv.slice(0, 8).map((r) => esc(r.agentName)).join(', ') || '<span class="dim">—</span>'}</td></tr>`);
      }
    } catch (err) { /* GV data optional */ }
    if (!box.isConnected) return;
    box.innerHTML = rows.length
      ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Channel</th><th class="num">Total agents</th><th class="num">🚫 Direct</th><th>Examples</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><p class="dim small">Ye numbers current loaded data se live hain. Rule save karne ke baad har page (dispatch, TL lists, search) naye rule par chalti hai.</p>`
      : '<div class="dim small">Data load nahi hua — login ke baad ye preview bharega.</div>';
  }
  function rulesTab() {
    const t = settings.thresholds || {};
    return section('📐 Thresholds & display', `<div class="form-grid">${field('Stock cover 🔴 red below (days)', numI('thresholds.coverRed', t.coverRed, 'min="0"'))}${field('Stock cover 🟠 orange below (days)', numI('thresholds.coverOrange', t.coverOrange, 'min="0"'))}${field('Stock cover 🟡 amber below (days)', numI('thresholds.coverAmber', t.coverAmber, 'min="0"'), '🟢 green above this')}${field('"Went quiet" after (inactive days)', numI('thresholds.inactiveDays', t.inactiveDays, 'min="1"'))}${field('Top N in rankings', numI('thresholds.topN', t.topN, 'min="3" max="50"'))}${field('Default rows per page', numI('pageSize', settings.pageSize, 'min="10" max="500"'))}</div>${check('allowSignup', settings.allowSignup !== false, 'Login page par "Sign up" allow karo (naye account admin approval ke baad hi chalte hain)')}${saveBar('rules')}`);
  }
  // ---- 🔊 Sound & voice (Office Bell + Voice Announcer) — v3.18 ----------------------------------
  /** Naye tags ki awaaz yahan se test / configure hoti hai (topbar 🔊 menu ka hi doosra darwaza). */
  function soundTab() {
    const B = FF.officeBell;
    const p = B ? B.prefs() : { minTags: 1, ff: true, gv: true, ting: true, tone: 'classic', muteUntil: 0 };
    const toneOptions = (B && B.toneOptions) || [{ id: 'classic', label: 'Classic · rising with update size' }];
    const tone = toneOptions.some((x) => x.id === p.tone) ? p.tone : 'classic';
    const unlocked = !!(B && B.unlocked);
    const badge = unlocked ? '<span class="badge green">SOUND UNLOCKED ✓</span>'
      : `<span class="badge ${B && B.lastError ? 'red' : 'amber'}">${B && B.lastError ? `BLOCKED · ${esc(B.lastError)}` : 'TAP TO UNLOCK'}</span>`;
    const log = B ? B.logList() : [];
    const clock = (t) => { try { return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
    return `${section(`🔊 Office Bell · naye tags ki awaaz ${badge}`, `
      <p class="dim small">Sheet me naya tag aate hi office me khabar — <b>🎙️ bol kar</b> ya <b>🔔 ting</b> se.
      Browser autoplay rokta hai, isliye pehli baar <b>Enable sound</b> dabana zaroori hai (ek hi baar).</p>
      <div class="form-grid">
        ${field('🎙️ Voice announcer', `<label class="check"><input type="checkbox" data-snd="voice" ${B && B.voiceOn ? 'checked' : ''}> Naye tags bol kar sunao</label>`, 'Off karne par sirf ting bajega')}
        ${field('🔔 Ting sound', `<label class="check"><input type="checkbox" data-snd="ting" ${p.ting !== false ? 'checked' : ''}> WebAudio ting bajao</label>`)}
        ${field('🎵 New-tag update beep tone', `<select id="snd-tone" data-snd="tone">${toneOptions.map((x) => `<option value="${esc(x.id)}" ${tone === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`, 'Classic is the default; the selected pattern is saved on this device')}
        ${field('🟦 First Forward tags', `<label class="check"><input type="checkbox" data-snd="ff" ${p.ff !== false ? 'checked' : ''}> FF ke naye tags announce karo</label>`)}
        ${field('🟩 GV Partner tags', `<label class="check"><input type="checkbox" data-snd="gv" ${p.gv !== false ? 'checked' : ''}> GV ke naye tags announce karo</label>`)}
        ${field('🏷️ Kam se kam kitne tags par bolo', `<select id="snd-min">${[1, 2, 5, 10, 25].map((n) => `<option value="${n}" ${Number(p.minTags) === n ? 'selected' : ''}>${n} tag${n > 1 ? 's' : ''}</option>`).join('')}</select>`, 'Chhote bursts par chup rehna ho to badhao')}
        ${field('⏱️ Poll interval', '<span class="dim">30 second (fixed)</span>', 'Har 30 sec aaj ka agent-wise count check hota hai')}
      </div>
      <div class="save-bar">
        <button class="btn primary" id="snd-unlock">🔊 Enable sound</button>
        <button class="btn" id="snd-test">🎙️ Test voice</button>
        <button class="btn" id="snd-tone-test">🔔 Preview selected beep</button>
        <button class="btn" id="snd-mute">${B && Number(p.muteUntil) > Date.now() ? '🔔 Unmute' : '🔕 Mute 30 min'}</button>
        <button class="btn" id="snd-check">↻ Check now</button>
        <span class="dim small" id="snd-msg"></span>
      </div>
      <p class="dim small">Awaaz assistant ki voice settings follow karti hai — <b>👤 My account → 🎙 Assistant voice</b> se language, pitch aur "Meri awaaz" profile badlo.</p>`)}
      ${section(`🕘 Aaj ki khabar <span class="dim">(${log.length})</span>`, log.length
        ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Time</th><th class="num">Tags</th><th>Channel</th><th>Top agents</th></tr></thead><tbody>${log.slice(0, 30).map((l) => `<tr><td>${esc(clock(l.at))}</td><td class="num"><b>+${U.fmt(l.total || 0)}</b></td><td>${l.ff ? `🟦 ${U.fmt(l.ff)}` : ''}${l.ff && l.gv ? ' · ' : ''}${l.gv ? `🟩 ${U.fmt(l.gv)}` : ''}</td><td class="dim">${esc(l.who || '—')}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="dim small">Abhi tak koi naya tag announce nahi hua. Bell 🔔 on karo aur sheet me naya tag aane do.</p>')}
      ${section('🎯 Voice kyun nahi aa rahi thi? (fix)', `<ul class="guide"><li><b>Problem:</b> Chrome / Edge <b>autoplay policy</b> ki wajah se bina user gesture ke <code>speechSynthesis.speak()</code> block kar dete hain (<code>not-allowed</code>). Office Bell background me poll karta hai, isliye awaaz chup-chaap fail ho jaati thi.</li><li><b>Fix 1:</b> pehle click / tap / keypress par audio <b>unlock</b> hota hai (AudioContext resume + silent utterance).</li><li><b>Fix 2:</b> unlock se pehle aayi khabar <b>queue</b> me jaati hai aur unlock hote hi boli jaati hai — kuch miss nahi hota.</li><li><b>Fix 3:</b> speak fail ho to <b>ting</b> bajta hai aur <b>"Enable sound"</b> nudge dikhta hai — ab pata chal jaata hai ki awaaz block hai.</li><li><b>Fix 4:</b> tab background me ho to bhi poll chalta hai; awaaz tab visible hote hi nikalti hai.</li></ul>`)}
      ${section('🔠 Multiple selection (v3.18)', `<ul class="guide"><li><b>🚚 Dispatch Planner</b> — Channel, Type, Priority, Need aur TL filters par ek saath <b>kai values</b> choose karo (jaise FF + GV, ya High + Medium).</li><li>Table me har row par <b>☑ checkbox</b> — kai agents/TL select karke ek saath <b>CSV / Excel / WhatsApp / Summary</b> nikalo.</li><li><b>🏆 Performance</b> — TL filter bhi multiple select hai.</li><li><b>📧 Dispatch email</b> — schedule me ek saath kai channel aur priority bhej sakte ho.</li></ul>`)}`;
  }
  function bindSoundTab(body, redraw) {
    const B = FF.officeBell;
    if (!B) return;
    const draw = typeof redraw === 'function' ? redraw : () => {};
    const msg = U.$('#snd-msg', body);
    const say = (t) => { if (msg) msg.textContent = t; };
    U.$$('[data-snd]', body).forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.snd;
      if (k === 'voice') { try { localStorage.setItem('ff-office-bell-voice', el.checked ? '1' : '0'); } catch { /* ignore */ } if (el.checked) B.unlock('retry'); }
      else if (k === 'tone') { B.setPrefs({ tone: el.value }); B.testTing(); say('Tone saved and previewed ✓'); return; }
      else B.setPrefs({ [k]: el.checked });
      say('Saved ✓');
    }));
    const min = U.$('#snd-min', body);
    if (min) min.addEventListener('change', () => { B.setPrefs({ minTags: Number(min.value) || 1 }); say('Saved ✓'); });
    const unlockBtn = U.$('#snd-unlock', body);
    if (unlockBtn) unlockBtn.addEventListener('click', () => {
      B.unlock('retry');
      B.speakAnnounce('Awaaz chalu ho gayi — ab har naya tag bol kar sunaunga.', 3)
        .then((ok) => { say(ok ? 'Voice chalu ✓' : `Block hai: ${B.lastError || 'browser'}`); U.toast(ok ? '🔊 Voice ready ✓' : '⚠️ Voice block hai', ok ? 'ok' : 'err'); draw(); });
    });
    const testBtn = U.$('#snd-test', body);
    if (testBtn) testBtn.addEventListener('click', () => {
      B.unlock('retry');
      B.speakAnnounce('Ye ek test hai — Rahul ne paanch naye tags issue kiye.', 5)
        .then((ok) => { say(ok ? 'Test bol diya ✓' : `Block hai: ${B.lastError || 'browser'}`); });
    });
    const toneTest = U.$('#snd-tone-test', body);
    if (toneTest) toneTest.addEventListener('click', () => { B.testTing(); say('Selected update tone previewed ✓'); });
    const muteBtn = U.$('#snd-mute', body);
    if (muteBtn) muteBtn.addEventListener('click', () => {
      const isMuted = Number(B.prefs().muteUntil || 0) > Date.now();
      B.setPrefs({ muteUntil: isMuted ? 0 : Date.now() + 30 * 60 * 1000 });
      say(isMuted ? 'Unmute ✓' : '30 minute ke liye mute ✓');
      draw();
    });
    const checkBtn = U.$('#snd-check', body);
    if (checkBtn) checkBtn.addEventListener('click', async () => {
      say('Live count le rahe hain…');
      try { const c = await B.countsToday(); say(`Aaj: FF ${U.fmt(c.ff)} · GV ${U.fmt(c.gv)} · baseline set — agle naye tag par khabar milegi.`); }
      catch (err) { say(`Error: ${err.message}`); }
    });
  }
  function contactsTab() {
    const c = settings.contacts || {};
    return section('📲 Contacts & sharing', `<div class="form-grid">${field('Team WhatsApp number', txt('contacts.teamWhatsapp', c.teamWhatsapp, 'inputmode="tel" placeholder="91xxxxxxxxxx"'), 'WhatsApp buttons is number par khulenge (blank = number choose karo)')}${field('Team email', txt('contacts.teamEmail', c.teamEmail, 'type="email"'), 'Email buttons ka default "To"')}${field('WhatsApp group link', txt('contacts.teamGroupLink', c.teamGroupLink, 'placeholder="https://chat.whatsapp.com/…"'))}${field('Message signature', txt('contacts.signature', c.signature))}</div><p class="dim small">Agent / TL profile me "WhatsApp TL" button REPORT sheet ke TL mobile par jaata hai (permission "See mobile numbers" chahiye).</p>${saveBar('contacts')}`)
      + section('🖨️ Dispatch label — FROM (company ka address)', `<div class="form-grid">${field('Company / dispatch naam', txt('contacts.fromName', c.fromName, 'placeholder="Apna Payment Pvt Ltd"'), 'Label par FROM ke saath dikhega (blank = app brand ka naam)')}${field('Company ka poora address', `<textarea class="input" data-path="contacts.fromAddress" rows="3" placeholder="Plot 12, RIICO Industrial Area, Jaipur, Rajasthan — 302006" maxlength="400">${esc(c.fromAddress || '')}</textarea>`, 'Tag request ke 🖨️ dispatch label / A4 print par FROM block — employee ka address TO me, company ka FROM me dikhta hai.')}${field('Company phone (optional)', txt('contacts.fromPhone', c.fromPhone, 'inputmode="tel" placeholder="Your dispatch office number"'))}</div><p class="dim small">Use: 🏷️ Tag Requests → koi bhi request khanchno (jarur hai ki employee link se aayi ho, address ke saath) → 🖨️ <b>Dispatch label</b> section → Print / 📄 PDF / Share. Label A4 page par left+right dono taraf repeat hota hai.</p>${saveBar('contacts')}`);
  }
  async function usersTab(root) {
    const out = await A.api('/api/users');
    usersCache = out.users; permsCache = out.permissions;
    const groups = [...new Set(permsCache.map((p) => p.group))];
    const permBoxes = (u) => groups.map((g) => `<div class="perm-group"><small class="dim">${esc(g)}</small>${permsCache.filter((p) => p.group === g).map((p) => `<label class="check"><input type="checkbox" data-perm="${esc(p.key)}" ${u.role === 'admin' || u.permissions.includes(p.key) ? 'checked' : ''} ${u.role === 'admin' ? 'disabled' : ''}> ${esc(p.label)}</label>`).join('')}</div>`).join('');
    const rows = usersCache.map((u) => `<div class="user-card ${u.approved ? '' : 'pending'}" data-user="${esc(u.username)}">
        <div class="user-head">${A.avatarHtml(u, 'lg')}<div class="user-meta"><b>${esc(u.name)}</b> <code>${esc(u.username)}</code>${u.username === A.user.username ? ' <span class="tag">you</span>' : ''}<small class="dim">${esc(u.email || '')}${u.mobile ? ` · ${esc(u.mobile || '')}` : ''} · joined ${u.createdAt ? U.timeLabel(new Date(u.createdAt).getTime()) : '—'} · last login ${u.lastLoginAt ? U.timeLabel(new Date(u.lastLoginAt).getTime()) : 'never'}${u.lastLocation ? ` · <a href="https://www.google.com/maps?q=${encodeURIComponent(`${u.lastLocation.latitude},${u.lastLocation.longitude}`)}" target="_blank" rel="noopener">📍 last location</a>` : ''}</small></div>
          <div class="user-controls"><label class="check"><input type="checkbox" data-field="approved" ${u.approved ? 'checked' : ''}> ${u.approved ? 'Active' : '<b class="pend">Pending approval</b>'}</label><select data-field="role"><option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></div></div>
        <details class="user-perms" ${u.approved ? '' : 'open'}><summary>Permissions (${u.role === 'admin' ? 'all — admin' : `${u.permissions.length}/${permsCache.length}`})</summary><div class="perm-boxes">${permBoxes(u)}</div><div class="btn-row"><button class="btn small" data-perm-all>Select all</button><button class="btn small" data-perm-none>Clear</button><button class="btn small" data-perm-default>Default set</button></div></details>
        ${u.loginHistory && u.loginHistory.length ? `<details class="user-perms"><summary>🕘 Login history (${u.loginHistory.length})</summary><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Kab</th><th>Login ID se</th><th>IP</th></tr></thead><tbody>${u.loginHistory.slice().reverse().map((l) => `<tr><td>${esc(U.timeLabel(new Date(l.at).getTime()))}</td><td>${esc(l.id || '—')}</td><td class="mono">${esc(l.ip || '—')}</td></tr>`).join('')}</tbody></table></div><p class="dim small" style="margin-top:4px">Last ${u.loginHistory.length} logins (max 20 store hote hain).</p></details>` : ''}
        <div class="user-notify-prefs">
          <label class="check"><input type="checkbox" data-field="notifyAccess" ${u.role === 'admin' || u.notifyAccess !== false ? 'checked' : ''} ${u.role === 'admin' ? 'disabled' : ''}> 🔔 Notifications access <small class="dim">(in-app bell, browser alerts, mobile push — sab band ho jayega off karne par)</small></label>
        </div>
        <div class="btn-row user-actions"><button class="btn small primary" data-user-save>💾 Save</button><button class="btn small" data-user-pw>🔑 Reset password</button>${u.username !== A.user.username ? `<button class="btn small" data-user-viewas title="Is user ke rights se poora dashboard dekho — sirf view preview, kuch save nahi hoga">👁 Preview</button><button class="btn small danger" data-user-del>🗑 Delete</button>` : ''}<span class="dim small" data-user-msg></span></div>
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
      const userSave = card.querySelector('[data-user-save]');
      userSave.addEventListener('click', () => U.withButtonBusy(userSave, async () => {
        const body = { approved: card.querySelector('[data-field="approved"]').checked, role: roleSel.value, permissions: [...card.querySelectorAll('[data-perm]')].filter((cb) => cb.checked).map((cb) => cb.dataset.perm) };
        const naBox = card.querySelector('[data-field="notifyAccess"]');
        if (naBox && !naBox.disabled) body.notifyAccess = naBox.checked;
        msg.textContent = 'Saving… server confirmation ka wait hai';
        try { await A.api(`/api/users/${encodeURIComponent(username)}`, 'PUT', body); msg.textContent = 'Saved ✓'; U.toast(`${username} updated ✓`, 'ok'); if (username === A.user.username) setTimeout(() => location.reload(), 600); else await usersTab(root); if (FF.app && FF.app.refreshPendingBadge) FF.app.refreshPendingBadge(); } catch (err) { msg.textContent = ''; U.toast(err.message, 'err'); }
      }, 'Saving user…'));
      card.querySelector('[data-user-pw]').addEventListener('click', async () => {
        const pw = prompt(`Naya password for ${username} (min 6 chars):`, Math.random().toString(36).slice(2, 10));
        if (!pw) return;
        try { await A.api(`/api/users/${encodeURIComponent(username)}`, 'PUT', { password: pw }); U.toast(`Password reset ✓ — user ko bata do: ${pw}`, 'ok'); await U.copyText(pw); } catch (err) { U.toast(err.message, 'err'); }
      });
      const del = card.querySelector('[data-user-del]');
      if (del) del.addEventListener('click', async () => { if (!confirm(`Delete user "${username}"?`)) return; try { await A.api(`/api/users/${encodeURIComponent(username)}`, 'DELETE'); U.toast('Deleted', 'ok'); usersTab(root); if (FF.app && FF.app.refreshPendingBadge) FF.app.refreshPendingBadge(); } catch (err) { U.toast(err.message, 'err'); } });
      // 👁 v3.35 — view-as preview: admin is user ban kar poora dashboard dekh sake (sirf view).
      const viewBtn = card.querySelector('[data-user-viewas]');
      if (viewBtn) viewBtn.addEventListener('click', () => {
        if (!A.startViewAs(u)) { U.toast('Preview shuru nahi hua', 'err'); return; }
        U.toast(`👁 Preview ON — ${u.name || u.username} ke rights. Upar ke banner se Exit karo.`, 'ok');
        if (location.hash !== '#/home') location.hash = '#/home';
        else if (FF.app && FF.app.renderCurrent) FF.app.renderCurrent();
      });
    });
    const addUser = U.$('#nu-add', root);
    addUser.addEventListener('click', () => U.withButtonBusy(addUser, async () => {
      const body = { username: U.$('#nu-username', root).value, name: U.$('#nu-name', root).value, password: U.$('#nu-password', root).value, role: U.$('#nu-role', root).value, mobile: U.$('#nu-mobile', root).value, email: U.$('#nu-email', root).value };
      try { await A.api('/api/users', 'POST', body); U.toast(`User ${body.username} created ✓ (password: ${body.password})`, 'ok'); await usersTab(root); if (FF.app && FF.app.refreshPendingBadge) FF.app.refreshPendingBadge(); } catch (err) { U.toast(err.message, 'err'); }
    }, 'Creating user…'));
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
        <p class="dim small">Checkbox tick = us user ko wo permission. Admin checkbox disabled rehte hain (admin ke paas sab hota hai). Quick buttons: <b>All</b> = sab, <b>FF</b> = sirf First Forward, <b>GV</b> = sirf GV Partner, <b>None</b> = kuch nahi. Agent / TL Summary ke liye <b>FF Agent / TL Summary</b> aur <b>GV Agent / TL Summary</b> alag permission hain — dono tick karne par dono access milta hai.</p>
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
        if (kind === 'ff') return k.startsWith('gv') || k === 'gvAgentSummary' || (isSheet && FF.config.tabBy(sheetId) && (FF.config.tabBy(sheetId).group === 'GV Partner')) ? false : true;
        if (kind === 'gv') return (k.startsWith('gv') || k === 'gvAgentSummary' || k === 'compare') || (isSheet && FF.config.tabBy(sheetId) && FF.config.tabBy(sheetId).group === 'GV Partner');
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
        if (e.target.closest('[data-mx-ff]')) { setRow(row, (k) => !((k.startsWith('gv') || k === 'gvAgentSummary' || k === 'compare') || (k.startsWith('sheet:') && (FF.config.tabBy(k.slice(6)) || {}).group === 'GV Partner'))); return; }
        if (e.target.closest('[data-mx-gv]')) { setRow(row, (k) => k.startsWith('gv') || k === 'gvAgentSummary' || k === 'compare' || (k.startsWith('sheet:') && (FF.config.tabBy(k.slice(6)) || {}).group === 'GV Partner')); return; }
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
    const mxSave = U.$('#mx-save', root);
    mxSave.addEventListener('click', () => U.withButtonBusy(mxSave, async () => {
      const msg = U.$('#mx-msg', root);
      msg.textContent = 'Saving… server confirmation ka wait hai';
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
    }, 'Saving access…'));
  }

  // ---- 🎛 Features tab: har feature ka ON/OFF + modify numbers (admin) ---------------------------
  function featuresTab() {
    const df = (defaults && defaults.features) || {};
    const f = { ...df, ...((settings && settings.features) || {}) };
    f.alerts = { ...(df.alerts || {}), ...(((settings && settings.features) || {}).alerts || {}) };
    const em = { ...((defaults && defaults.email) || {}), ...((settings && settings.email) || {}) };
    const routeDefaults = (defaults && defaults.notificationRoutes) || {};
    const routes = { ...routeDefaults, ...((settings && settings.notificationRoutes) || {}) };
    const c = (key, label, hint) => `<label class="check"><input type="checkbox" data-path="features.${key}" ${f[key] !== false ? 'checked' : ''}> <b>${label}</b>${hint ? `<br><small class="dim" style="margin-left:20px">${hint}</small>` : ''}</label>`;
    const a = (key, label, hint) => `<label class="check"><input type="checkbox" data-path="features.alerts.${key}" ${f.alerts[key] !== false ? 'checked' : ''}> <b>${label}</b>${hint ? `<br><small class="dim" style="margin-left:20px">${hint}</small>` : ''}</label>`;
    const n = (path, value, label, attrs) => field(label, numI(path, value, attrs || 'min="0" max="999"'));
    const uiCard = section('🎛 App features <span class="dim">(on / off)</span>', `
      <p class="dim small">Har nayi/purani feature yahan se band-chalu kar sakte ho — user ko dikhega ya nahi, aap decide karo. Notification ke types alag se 👤 My account → 🔔 Notifications me hain.</p>
      <div class="feat-grid">
        ${c('search', '🔍 Global search (Ctrl / ⌘ + K)', 'Topbar 🔍 button + ek box me pages, sheets, agents, TLs')}
        ${c('share', '📤 WhatsApp share buttons', 'Dashboard / Trend / Stock header ke 📤 + pivot share-row')}
        ${c('targetBar', '🎯 Dashboard target progress bar', 'MTD vs target ka colored bar (Targets page par target set karo)')}
        ${c('stockTrend', '📉 Stock trend chart', 'Stock page par last-30-din ka line chart (server snapshots)')}
        ${c('tlCover', '📈 TL-wise cover list', 'Stock page — kam cover wale TLs upar, band emoji ke saath')}
        ${c('recon', '🧾 Stock in vs issued', 'Stock page — MTD issuance + stock change se approx in-flow')}
        ${c('loginHistory', '🕘 Login history table', 'Users tab me: kab, kis login ID se, kis IP se (last 20)')}
        ${c('pendingBadge', '⏳ Pending-approvals badge', 'Sidebar Settings par pending signup count')}
        ${c('updateToast', '🔄 “Update available” toast', 'Server version badle to app me Reload banner')}
        ${c('backupReminder', '☁️ Settings backup reminder', `Backup purana ho to roz info alert — age threshold → ⚙️ neeche`)}
        ${c('tvMode', '📺 TV mode page', 'Office TV ke liye Dashboard → Trend → Stock → Targets auto-rotation (sidebar me 📺 TV Mode)')}
        ${c('weekCompare', '🗓 Same-day-last-week KPI', 'Dashboard par “aaj vs pichhle hafte ke same din” comparison')}
        ${c('agedStock', '🧓 Aged stock buckets', 'Stock page — 0-15 / 16-30 / 31-60 / 60+ din purana stock')}
        ${c('auditLog', '📜 Audit log', 'Settings me 📜 tab — login, settings, users, OTP sab kuch (admin only)')}
        ${c('announcements', '📢 Announcement composer', 'Settings me sab users ko ek saath broadcast karne ka box')}
        ${c('tlGoals', '🎯 TL monthly goals', 'Targets page TL rollup me goal column + admin editable goals')}
        ${c('otp2fa', '🔐 OTP on new-IP login', 'Naye IP par login = 6-digit OTP email (SMTP set ho tabhi) — known device par seedha login')}
        ${c('badges', '🏅 Weekly badges + rank card', 'Performance page — 🥇🥈🥉 top agents/TL + ek click me shareable image')}
        ${c('voiceSummary', '🗣️ Voice summary (Hindi)', 'Dashboard par 🔊 button — aaj ke numbers bol kar sunata hai (browser TTS)')}
        ${c('askBox', '🤖 Sawal-jawab box', 'Search (Ctrl+K) me likho “aaj ka VC4?” / “Rahul ka MTD” — seedha jawab')}
        ${c('teamMap', '🗺 Team map', 'Admin sidebar page — location share karne walo ka distance map (office se)')}
        ${c('personalLinks', '🔗 Personal links', 'Har agent/TL ka secret read-only performance link — Settings me 🔗 tab')}
        ${c('customAlerts', '🗓 Custom alert scheduler', 'Apne reminders/status — roz / har Somwar / har mahine fixed time par bell me')}
        ${c('championEmail', '🥇 Champion certificate email', 'Mahine ke top agents ka certificate SMTP se email (SMTP set ho tabhi)')}
        ${c('followupTracker', '⏰ Follow-up tracker', 'Silent agents + due agent/TL notes — roz owner timeline reminder')}
        ${c('dispatchPlan', '🎯 Suggested dispatch cards', 'High + Medium priority agents: cover din + suggested tag qty (GV + FF)')}
        ${c('masterSearch', '🔎 Master search bar', 'Topbar + Home panel — naam, TL, ID, GV ID, barcode, tag ID sab ek search me (dropdown suggestions + kundli cards)')}
        ${c('tabHeartbeat', '🟢 Live tab heartbeat', 'Browser tab title me live aaj ka tag count + top agent (doosre tab me bhi pulse)')}
        ${c('themePacks', '🎨 Theme packs', 'Topbar 🎨 — Default · Neon · Glass · Diwali festive · Gold · Mono')}
        ${c('heatmap', '📅 Activity Calendar (heatmap)', 'Poore saal ka GitHub-style calendar — FF / GV / combined + streak stats')}
        ${c('networkGraph', '🕸️ Team Network graph', 'TL centre me, agents orbit karte hue — animated constellation')}
        ${c('sparklines', '📈 KPI sparklines', 'Dashboard ke KPI cards ke andar mini trend chart')}
        ${c('reportCards', '🧾 Agent Report Cards', 'Monthly report card (grades + auto remarks + TL sign) — print/PDF')}
        ${c('anomalyRadar', '🚨 Anomaly Radar', 'Spike · crash · naya star · wrong-VRN burst · stale sheet auto-detect')}
        ${c('chatCharts', '🤖 Chat me charts', 'Assistant se “last 7 days ka graph” pucho — jawab ke saath chart')}
        ${c('levelUp', '🎖️ Level-Up Ceremony', 'Promotion par fullscreen golden ceremony + trumpet (Agent Arena)')}
        ${c('memoryLane', '📅 “Aaj ka din” memories', 'Pichhle mahine/saal ki isi din ki activity Home par')}
      </div>${saveBar('feat-ui')}`);
    const alertCard = section('🔴 Alert automation <span class="dim">(server-side — tab bhi chalta hai jab app band ho)</span>', `
      <div class="feat-grid">
        ${a('lowCover', '🔴 VC4 low-cover alert', 'Cover band bigadne par turant + red zone me roz (bands → 📐 Thresholds)')}
        ${a('midMonth', '🎯 Mid-month target miss', 'Window me ek baar — pace 40%+ peeche ho to warning')}
        ${a('inactive', '💤 Weekly inactive users', 'Har Monday 9 AM IST — 3+ din silent users ki list')}
        ${a('zeroDay', '⚠️ Zero-day / sharp-drop', 'Raat 9 IST — aaj 0 issuance ya avg se bahut kam')}
        ${a('newLoginIp', '🔐 Naye IP se login', 'Known IPs se bahar naye IP par login par admin alert')}
        ${a('anomaly', '📉 Agent anomaly (raat 9)', 'Koi agent achanak 0 / bahut kam ho jaye to alert — threshold % ⚙️ neeche')}
        <label class="check"><input type="checkbox" data-path="features.tlAnomaly" ${f.tlAnomaly !== false ? 'checked' : ''}> <b>🏆 TL anomaly (raat 9)</b><br><small class="dim" style="margin-left:20px">Poori team ka issuance achanak gira ho to TL-level alert — threshold same %</small></label>
      </div>
      <p class="dim small">In alerts ki ON/OFF apne phone par bhi chahiye to 👤 My account → 🔔 Notifications me <b>🔴 Critical alerts</b> type bhi ON rakho.</p>${saveBar('feat-alerts')}`);
    const routeLabels = [
      ['dailyDigest', '🌅 Daily digest', 'Roz ka FF/GV + stock summary'],
      ['monthlyReport', '📅 Monthly report', 'Pichhle mahine ka FF vs GV comparison'],
      ['lowStock', '🔴 Low-stock / cover alert', 'VC4 cover band low hone par'],
      ['midMonth', '🎯 Mid-month target miss', 'Target pace se peeche hone par'],
      ['zeroDay', '⚠️ Zero-day / sharp drop', 'Aaj issuance zero ya bahut kam'],
      ['agentAnomaly', '📉 Agent anomaly', 'Agent ka issuance achanak girne par'],
      ['tlAnomaly', '🏆 TL anomaly', 'Team issuance achanak girne par'],
      ['followup', '⏰ Follow-up list', 'Silent agents ki daily list'],
      ['champion', '🥇 Monthly champions', 'Champion email ke baad winner notification'],
      ['reportUpdate', '🔄 Sheet/report update', 'Google Sheet me fresh rows aane par'],
      ['inactiveUsers', '💤 Inactive app users', 'Dashboard login inactivity report'],
      ['backupReminder', '☁️ Backup reminder', 'Settings backup purana hone par']
    ];
    const routeOptions = (value) => [['admin', '👑 Sirf admin'], ['users', '👥 Sirf users'], ['both', '📢 Admin + users'], ['off', '⛔ Kisi ko nahi']]
      .map(([v, label]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${label}</option>`).join('');
    const routesCard = section('🔔 Notification audience <span class="dim">(admin decide kare: kisko kya jaye)</span>', `
      <p class="dim small">Har automated event ka bell + browser/mobile push audience select karo. <b>Users</b> = sab approved non-admin users jinke account me notification access aur unka personal master switch ON hai. Login/password/security events privacy ke liye hamesha personal/admin hi rehte hain.</p>
      <div class="notify-route-grid">${routeLabels.map(([key, label, hint]) => `<label class="notify-route"><span><b>${label}</b><small>${hint}</small></span><select class="input" data-path="notificationRoutes.${key}">${routeOptions(routes[key] || routeDefaults[key] || 'admin')}</select></label>`).join('')}</div>
      ${saveBar('feat-routes')}`);
    const modsCard = section('⚙️ Alert modify <span class="dim">(numbers tune karo)</span>', `
      <div class="form-grid">
        ${n('features.digestHour', f.digestHour, '🌅 Digest hour (IST)', 'min="0" max="23"')}
        ${n('features.midFrom', f.midFrom, '🎯 Mid-month window: from (tareekh)', 'min="1" max="28"')}
        ${n('features.midTo', f.midTo, 'Mid-month window: to (tareekh)', 'min="2" max="31"')}
        ${n('features.midGapPct', f.midGapPct, '🎯 Kitna % peeche = alert (%)', 'min="5" max="90"')}
        ${n('features.zeroDropPct', f.zeroDropPct, '⚠️ Sharp-drop threshold (%) — 0 = sirf zero-day', 'min="0" max="90"')}
        ${n('features.backupDays', f.backupDays, '☁️ Backup reminder age (din)', 'min="1" max="120"')}
        ${n('features.anomalyPct', f.anomalyPct, '📉 Anomaly: avg se kitna % neeche = alert', 'min="10" max="95"')}
        ${n('features.championHour', f.championHour ?? 10, '🥇 Champion email hour (IST)', 'min="0" max="23"')}
        ${n('features.championTop', f.championTop ?? 3, '🥇 Kitne top champions (1-10)', 'min="1" max="10"')}
        ${n('features.followupDays', f.followupDays ?? 3, '⏰ Follow-up: kitne din silent = alert', 'min="1" max="30"')}
        ${n('features.followupHour', f.followupHour ?? 10, '⏰ Follow-up hour (IST)', 'min="0" max="23"')}
      </div>
      <p class="dim small">Cover bands (🔴/🟠/🟡) aur “went quiet” days → <b>📐 Thresholds</b> tab. Digest ka ON/OFF type → 🔔 Notifications. 🎯 Suggested dispatch/tags ke din aur style → upar <b>🎯 Suggested dispatch / tags</b> card.</p>${saveBar('feat-mods')}`);
    const smode = f.suggestMode === 'net' || f.suggestMode === 'gross' ? f.suggestMode : 'both';
    const suggestCard = section('🎯 Suggested dispatch / tags <span class="dim">(kitne din ka · kaise dikhaye)</span>', `
      <p class="dim small">Har jagah — master search (TLS + agents), profile drawer, Performance, GV dispatch plan, Direct Agents — suggested qty <b>run-rate</b> (avg VC4/day) se nikalta hai. Do criteria milte hain: <b>Stock ke baad</b> = avg/day × din − current stock · <b>Bina stock ghataye</b> = avg/day × din.</p>
      <div class="form-grid">
        ${field('🗓️ Kitne din ka suggest kare (target cover)', numI('features.suggestDays', f.suggestDays ?? 15, 'min="3" max="90"'), 'Default 15 din · 30 karoge to 30 din ke run-rate par requirement dikhegi')}
        ${field('👁️ Kaise dikhaye', `<select class="input" data-path="features.suggestMode">
          <option value="both" ${smode === 'both' ? 'selected' : ''}>Dono dikhao — stock ke baad + bina stock (recommended)</option>
          <option value="net" ${smode === 'net' ? 'selected' : ''}>Sirf stock ke baad (net = avg × din − stock)</option>
          <option value="gross" ${smode === 'gross' ? 'selected' : ''}>Sirf bina stock ghataye (gross = avg × din)</option>
        </select>`, '“Dono” chunne par har jagah net ke saath “w/o stock” figure bhi dikhega')}
      </div>
      <p class="dim small">Example: avg 10/day · stock 40 · target 30 din → <b>stock ke baad</b> = 10×30−40 = <b>260</b> · <b>bina stock</b> = 10×30 = <b>300</b>.</p>${saveBar('feat-suggest')}`);
    const waCard = section('📤 WhatsApp share number', `
      <div class="form-grid">${field('Direct number (blank = WhatsApp share picker)', txt('features.waNumber', f.waNumber || '', 'placeholder="9198xxxxxxxx00 · country code ke saath" inputmode="tel"'))}</div>
      <p class="dim small">Number blank ho to WhatsApp apna contact picker kholta hai. Contacts tab ka team number fallback me use hota hai.</p>${saveBar('feat-wa')}`);
    const provOpt = (v, label) => `<option value="${v}" ${(em.provider || 'auto') === v ? 'selected' : ''}>${label}</option>`;
    const emailCard = section('📧 Email <span class="dim">(OTP · digest · report · certificates)</span>', `
      <div class="mail-status" id="em-status"><span class="dim small">Email status load ho raha hai…</span></div>
      <label class="check" style="margin-bottom:6px"><input type="checkbox" data-path="features.emailDigest" ${f.emailDigest ? 'checked' : ''}> <b>Digest email se bhi bhejo</b> <small class="dim">(push ke saath-saath subah ka summary email par)</small></label>
      <label class="check" style="margin-bottom:6px"><input type="checkbox" data-path="features.weeklyEmail" ${f.weeklyEmail === true ? 'checked' : ''}> <b>📬 Weekly auto-digest email (admin on/off)</b> <small class="dim">— har Monday, pichhle Mon–Sun ka FF/GV summary + stock. Hour → ⬇️ neeche</small></label>
      <label class="check" style="margin-bottom:6px"><input type="checkbox" data-path="features.emailReport" ${f.emailReport === true ? 'checked' : ''}> <b>📊 Roz ka scheduled report email (HTML + CSV)</b> <small class="dim">— last-14-din table, CSV attach. Hour → ⬇️ neeche</small></label>
      <div class="form-grid">
        ${field('Weekly email hour (IST)', numI('features.weeklyEmailHour', f.weeklyEmailHour ?? 9, 'min="0" max="23"'))}
        ${field('Report email hour (IST)', numI('features.emailReportHour', f.emailReportHour ?? 21, 'min="0" max="23"'))}
        ${field('To (comma-separated)', txt('email.to', em.to || '', 'placeholder="boss@x.com, team@x.com"'), 'Digest / report / certificate in emails par jayenge')}
        ${field('From (name <email>)', txt('email.from', em.from || '', 'placeholder="Dashboard <alerts@yourdomain.com>"'), 'SMTP: Gmail me wahi Gmail · Resend/Brevo: verified sender · Apps Script: ignore (Gmail account se jata hai, sirf naam use hota hai)')}
        ${field('Email provider', `<select class="input" data-path="email.provider" id="em-provider">${provOpt('auto', '🤖 Auto — jo configured hai sab try (recommended)')}${provOpt('appsscript', '🟢 Google Apps Script (Gmail) — HTTPS, free, Render par chalta hai')}${provOpt('smtp', '📮 SMTP (Gmail / Outlook / apna server)')}${provOpt('resend', '⚡ Resend API (HTTPS)')}${provOpt('brevo', '📨 Brevo API (HTTPS)')}</select>`, 'Render FREE par SMTP ports block hote hain — wahan Apps Script / Resend / Brevo chuno')}
      </div>
      <details class="mail-adv" ${em.host || ['smtp'].includes(em.provider) ? 'open' : ''}><summary><b>📮 SMTP settings</b> <small class="dim">(sirf tab jab SMTP use karna ho)</small></summary>
        <div class="form-grid">
          ${field('SMTP host', txt('email.host', em.host || '', 'placeholder="smtp.gmail.com"'))}
          ${field('Port', numI('email.port', em.port || 587, 'min="1" max="65535"'), '587 = STARTTLS (TLS unchecked) · 465 = implicit TLS (checked)')}
          ${field('TLS (465 / implicit)', `<input type="checkbox" data-path="email.secure" ${em.secure ? 'checked' : ''}>`)}
          ${field('User', txt('email.user', em.user || '', 'autocomplete="off"'))}
          ${field('Password / app password', `<input class="input" type="password" data-path="email.pass" value="${esc(em.pass || '')}" autocomplete="new-password">`, 'Gmail App Password — spaces ho to chalega')}
        </div>
      </details>
      <details class="mail-adv" ${em.resendKey || em.brevoKey ? 'open' : ''}><summary><b>⚡ Resend / 📨 Brevo API keys</b> <small class="dim">(optional — env var RESEND_API_KEY / BREVO_API_KEY bhi chalta hai)</small></summary>
        <div class="form-grid">
          ${field('Resend API key', `<input class="input" type="password" data-path="email.resendKey" value="${esc(em.resendKey || '')}" autocomplete="new-password" placeholder="re_…">`, 'From = verified domain ka email')}
          ${field('Brevo API key', `<input class="input" type="password" data-path="email.brevoKey" value="${esc(em.brevoKey || '')}" autocomplete="new-password" placeholder="xkeysib-…">`, 'From = Brevo me verified sender')}
        </div>
      </details>
      <div class="save-bar"><button class="btn primary" data-save="feat-email">💾 Save</button><button class="btn" id="em-test">📧 Test email bhejo</button><button class="btn" id="em-diag">🩺 Diagnose</button><span class="dim small" id="save-msg-feat-email"></span></div>
      <div id="em-diag-out" class="mail-diag" hidden></div>
      <div class="mail-help">
        <p class="dim small"><b>🟢 Sabse aasaan (Render free par bhi):</b> Google Apps Script relay. Storage wala hi script use hota hai — <code>google-apps-script/Code.gs</code> ka naya code paste karo → ▶ Run <code>authorizeMail</code> (Allow) → Deploy → Manage deployments → Edit → <b>New version</b>. Provider = Auto/Apps Script, <b>To</b> bharo, Test dabao. Gmail limit ≈ 100 mail/din.</p>
        <p class="dim small"><b>📮 SMTP:</b> Gmail → host <code>smtp.gmail.com</code>, port <b>587</b> + TLS unchecked, ya <b>465</b> + TLS checked; App Password (2-Step Verification ON). <b>Render free plan SMTP block karta hai (26 Sep 2025 se)</b> — Diagnose bata dega ki port khula hai ya nahi. “Test email” pehle durable save confirm karta hai, phir bhejta hai.</p>
      </div>`);
    const announceCard = section('📢 Announcement <span class="dim">(sab users ko ek message)</span>', `
      <p class="dim small">Type karo aur bhejo — sab logged-in users ke bell panel me turant dikhega (jaise ek broadcast). Ye raha preview:</p>
      <textarea class="input" id="an-text" rows="3" maxlength="500" placeholder="e.g. Kal 11 AM sabka monthly meeting hai — attendance zaroori."></textarea>
      <div class="save-bar" style="margin-top:8px"><button class="btn primary" id="an-send">📢 Broadcast karo</button><span class="dim small" id="an-msg"></span></div>`);
    const mapCard = section('🗺 Office location <span class="dim">(team map ka center)</span>', `
      <p class="dim small">Team map (🗺 sidebar page) yahan ke coordinates ko “office” maanta hai — har user ki distance isi se nikalti hai. Google Maps me office kholo → URL me jo lat,lng dikhe wo yahan daalo.</p>
      <div class="form-grid">
        ${field('Office latitude', numI('features.officeLat', f.officeLat ?? 0, 'step="0.000001" min="-90" max="90"'))}
        ${field('Office longitude', numI('features.officeLng', f.officeLng ?? 0, 'step="0.000001" min="-180" max="180"'))}
      </div>${saveBar('feat-map')}`);
    const schedOn = f.customAlerts !== false;
    const schedCard = section('🗓 Custom alert scheduler <span class="dim">(reminders · status messages)</span>', `
      <p class="dim small">Jaise chaho waise yaad dilao — <b>roz</b>, <b>har {weekday}</b> (e.g. Somwar), ya <b>har mahine ki tareekh</b> par fixed IST hour. Text me <code>{today}</code> (aaj ke tags) · <code>{mtd}</code> (MTD total) · <code>{date}</code> use kar sakte ho. Target = sirf admin ya <b>sab users (broadcast)</b>.</p>
      ${schedOn ? '' : '<p class="check" style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:8px 12px;margin-bottom:10px">⏸️ Scheduler band hai — Features se ON karo tabhi reminders jayenge.</p>'}
      <div class="finder-row" style="margin-bottom:8px">
        <input class="input" id="sc-title" placeholder="Title — e.g. Aaj ka status" style="min-width:170px" maxlength="60">
        <input class="input" id="sc-text" placeholder='Message — e.g. "Aaj {today} tags hue (MTD {mtd}) — sab apna target pura karo!"' style="min-width:280px" maxlength="240">
        <select class="input" id="sc-kind" style="width:auto"><option value="daily">Roz</option><option value="weekly">Har hafte</option><option value="monthly">Har mahine</option></select>
        <select class="input" id="sc-when" style="width:auto"></select>
        <select class="input" id="sc-target" style="width:auto"><option value="admin">Sirf admin</option><option value="broadcast">Sab users</option></select>
        <button class="btn primary" id="sc-add">➕ Schedule add</button>
      </div>
      <div id="sched-list">${schedListHtml((settings && settings.schedules) || [])}</div>
      <div class="save-bar" style="margin-top:8px">
        <button class="btn" id="ch-fire" title="SMTP par abhi champion certificate bhejo (test)">🥇 Champion email abhi bhejo</button>
        <button class="btn" id="fu-fire" title="Abhi follow-up list check karo + notification bhejo">⏰ Follow-up abhi chalao</button>
        <span class="dim small" id="save-msg-feat-sched"></span>
      </div>
      <p class="dim small">Champion email ko SMTP chahiye (upar 📧 Email card). Follow-up = jinka pichhla issuance N+ din purana ho gaya.</p>`);
    return `${uiCard}${suggestCard}${alertCard}${routesCard}${modsCard}${waCard}${emailCard}${announceCard}${mapCard}${schedCard}`;
  }

  // ---- 🗓 schedule list (features tab) ---------------------------------------------------------
  function schedWhenLabel(s) {
    const DAYS = ['Ravivar', 'Somwar', 'Mangalwar', 'Budhwar', 'Guruwar', 'Shukrawar', 'Shanivar'];
    if (s.kind === 'weekly') return `${DAYS[Number(s.weekday) || 0]} ${Number(s.hour) || 0}:00`;
    if (s.kind === 'monthly') return `Har mahine ${Number(s.day) || 1} tareekh · ${Number(s.hour) || 0}:00`;
    return `Roz ${Number(s.hour) || 0}:00`;
  }
  function schedListHtml(list) {
    if (!list.length) return '<p class="dim">Abhi koi schedule nahi — upar title + message daal ke add karo.</p>';
    const KIND = { daily: '🔁 Roz', weekly: '📅 Hafte', monthly: '🗓 Mahine' };
    return `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Kab</th><th>Title</th><th>Message</th><th>Target</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr>
        <td>${KIND[s.kind] || '🔁'} <b>${esc(schedWhenLabel(s))}</b></td>
        <td><b>${esc(s.title || '')}</b></td>
        <td class="small">${esc(String(s.text || '').slice(0, 60))}</td>
        <td class="small">${s.target === 'broadcast' ? '📢 Sabko' : '👑 Admin'}</td>
        <td>${s.enabled === false ? '<span class="badge red">OFF</span>' : '<span class="badge">ON</span>'}</td>
        <td class="num" style="white-space:nowrap">
          <button class="btn small sc-fire" data-id="${esc(s.id)}" title="Abhi bhejo (test)">▶️</button>
          <button class="btn small sc-tog" data-id="${esc(s.id)}">${s.enabled === false ? '▶️ ON' : '⏸️'}</button>
          <button class="btn small sc-del" data-id="${esc(s.id)}">🗑</button>
        </td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // ---- 📜 Audit log (admin) ---------------------------------------------------------------------------
  async function auditTab(body) {
    let entries = [];
    try { entries = (await A.api('/api/audit')).entries || []; } catch (err) { body.innerHTML = U.errorBox(err); return; }
    if (!entries.length) { body.innerHTML = `<div class="card"><p class="dim">Abhi tak koi audit entry nahi — login, settings change, user create karte hi yahan dikhega.</p></div>`; return; }
    const actions = [...new Set(entries.map((e) => e.action))].sort();
    body.innerHTML = `<div class="card">
      <div class="page-head" style="margin-bottom:8px"><div><h2>📜 Audit log <span class="dim small">(last ${entries.length})</span></h2>
      <p class="sub">Kaunne kab kya kiya — login/OTP, settings, users, announcements, email sends. Server par last 400 entries rakhi jaati hain.</p></div></div>
      <div class="form-grid" style="max-width:420px">${field('Action filter', `<select class="input" id="au-filter"><option value="">Sab</option>${actions.map((a2) => `<option value="${esc(a2)}">${esc(a2)}</option>`).join('')}</select>`)}</div>
      <div class="table-wrap" style="max-height:70vh;overflow:auto;margin-top:10px"><table class="table" id="au-table"><thead><tr><th>⏰ When</th><th>👤 Who</th><th>Action</th><th>Target</th><th>IP / note</th></tr></thead><tbody>
      ${entries.map((e) => `<tr data-action="${esc(e.action)}"><td class="mono small">${esc((e.at || '').replace('T', ' ').slice(0, 19))}</td><td><b>${esc(e.actor || '—')}</b>${e.role ? ` <span class="dim small">${esc(e.role)}</span>` : ''}</td><td>${esc(e.action)}</td><td class="mono small">${esc(e.target || '')}</td><td class="small dim">${esc(e.ip || '')}${e.note ? ` · ${esc(e.note)}` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    const sel = U.$('#au-filter', body);
    sel.addEventListener('change', () => {
      U.$$('#au-table tbody tr', body).forEach((tr) => { tr.hidden = !!sel.value && tr.dataset.action !== sel.value; });
    });
  }

  // ---- 🔗 Personal links (admin) — agent/TL ka secret read-only URL + Access Control + Auth ----
  const PL_SECTIONS_META = [
    { key: 'overview', icon: '📊', label: 'Overview & KPIs' },
    { key: 'stock', icon: '📦', label: 'Class-wise Stock' },
    { key: 'issuance', icon: '📅', label: 'Date & Agent Issuance' },
    { key: 'performance', icon: '🏆', label: 'Performance & Growth' },
    { key: 'ageing', icon: '⏳', label: 'Stock Ageing' },
    { key: 'export', icon: '⬇', label: 'CSV & PDF Download' }
  ];
  async function linksTab(body) {
    let links = [];
    let plDef = { requireAuth: true, sections: PL_SECTIONS_META.map((s) => s.key) };
    try {
      const res = await A.api('/api/personal-links');
      links = res.links || [];
      if (res.defaults) plDef = res.defaults;
    } catch (err) { body.innerHTML = U.errorBox(err); return; }
    const on = !settings || !settings.features || settings.features.personalLinks !== false;
    const origin = location.origin;
    const offBanner = on ? '' : '<p class="check" style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:8px 12px;margin-bottom:10px">⏸️ Feature <b>band</b> hai — sabhi links ab 404 denge. <a href="#/settings?tab=features">🎛 Features → Personal links ON karo</a>.</p>';
    const defSecs = Array.isArray(plDef.sections) ? plDef.sections : PL_SECTIONS_META.map((s) => s.key);
    const secCheckboxes = (prefix, activeList) => PL_SECTIONS_META.map((s) => `<label class="chip ${activeList.includes(s.key) ? 'on' : ''}" style="cursor:pointer;display:inline-flex;align-items:center;gap:5px"><input type="checkbox" data-${prefix}-sec="${s.key}" ${activeList.includes(s.key) ? 'checked' : ''}> ${s.icon} ${esc(s.label)}</label>`).join('');
    const wireSectionGroup = (host, selector, dataKey) => {
      const boxes = [...host.querySelectorAll(selector)];
      const exportBox = boxes.find((cb) => cb.dataset[dataKey] === 'export');
      const hasView = () => boxes.some((cb) => cb.dataset[dataKey] !== 'export' && cb.checked);
      const sync = (changed) => {
        if (changed && changed === exportBox && changed.checked && !hasView()) {
          changed.checked = false;
          U.toast('Exports ke liye pehle kam-se-kam ek report section allow karein.', 'warn');
        }
        if (!hasView() && exportBox) {
          if (exportBox.checked) {
            exportBox.checked = false;
            U.toast('Last report section hatane par exports bhi band ho gaye.', 'info');
          }
          exportBox.disabled = true;
          if (exportBox.closest('.chip')) exportBox.closest('.chip').title = 'Enable at least one report section before allowing exports';
        } else if (exportBox) {
          exportBox.disabled = false;
          if (exportBox.closest('.chip')) exportBox.closest('.chip').title = 'Download access for the report sections allowed above';
        }
        boxes.forEach((cb) => { const chip = cb.closest('.chip'); if (chip) chip.classList.toggle('on', cb.checked); });
      };
      boxes.forEach((cb) => cb.addEventListener('change', () => sync(cb)));
      sync(null);
    };

    body.innerHTML = `<div class="card">
      <div class="page-head" style="margin-bottom:8px"><div><h2>🔗 Personal links <span class="dim small">(read-only · ID + Mobile Auth · Custom Access)</span></h2>
      <p class="sub">First Forward ya GV agent/TL ka personal portal URL — Class-wise Stock, Date &amp; Agent Issuance, Performance, Stock Ageing tabs + CSV/PDF download. Jab TL/Agent link kholega to <b>TL/Agent ID + Mobile Number</b> se verify hokar khulega.</p></div></div>
      ${offBanner}
      <div class="card compact-card" style="margin-bottom:12px;background:var(--bg-subtle,#f8fafc)">
        <div class="card-head"><h3>➕ Naya Personal Link Banao</h3><span class="dim small">Naam choose karein → registered ID, mobile aur allowed sections set karein</span></div>
        <div class="finder-row" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <select class="input" id="pl-source" style="width:auto"><option value="ff">🟦 First Forward</option><option value="gv">🟩 GV Partner</option></select>
          <select class="input" id="pl-kind" style="width:auto"><option value="agent">🧑‍💼 Agent</option><option value="tl">👥 TL</option></select>
          <div class="finder-input" style="min-width:240px;flex:1"><span class="finder-ico">🔎</span><input class="input" id="pl-name" placeholder="Naam type karke suggestion choose karo" maxlength="80"></div>
          <input class="input" id="pl-person-id" placeholder="🪪 TL / Agent ID (Auth ke liye)" style="width:190px" maxlength="40">
          <input class="input" id="pl-mobile" type="tel" inputmode="numeric" placeholder="📱 10-digit Mobile" style="width:170px" maxlength="14">
          <button class="btn primary" id="pl-create">🔗 Naya link banao</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:6px">
          <span class="dim small"><b>🎛️ Link Access Sections:</b></span>
          ${secCheckboxes('new', defSecs)}
          <span class="badge blue" title="Server-side check is mandatory">🔐 ID + registered mobile verification is always required</span>
        </div>
        <span class="dim small" id="pl-msg" style="display:block;margin-top:6px"></span>
      </div>

      <div class="card compact-card" style="margin-bottom:12px">
        <div class="card-head"><h3>🛡️ Admin Global Default Access Control</h3><span class="dim small">Naye links aur existing links ke liye default tabs · identity verification always stays on</span></div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
          ${secCheckboxes('def', defSecs)}
          <span class="badge blue">🔐 ID + mobile verification cannot be disabled</span>
          <button class="btn small primary" id="pl-save-def" style="margin-left:auto">💾 Save Default &amp; Apply to All Links</button>
        </div>
      </div>

      ${links.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Source</th><th>Kind</th><th>Naam</th><th>🔐 Auth (ID · Mobile)</th><th>🎛️ Allowed Sections</th><th>Link</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${links.map((l) => {
        const secs = Array.isArray(l.sections) ? l.sections : defSecs;
        const secBadges = PL_SECTIONS_META.filter((s) => secs.includes(s.key)).map((s) => `<span class="badge" title="${esc(s.label)}">${s.icon} ${esc(s.label.split(' ')[0])}</span>`).join(' ') || '<span class="badge red" title="No report sections are enabled">🔒 No sections</span>';
        const authBadge = l.personId && String(l.mobile || '').replace(/\D/g, '').length === 10
          ? `<span class="badge blue" title="Exact TL/Agent ID + registered mobile are checked server-side">🔐 ${esc(l.personId)} · 📱 ••••${esc(String(l.mobile).slice(-4))}</span>`
          : '<span class="badge red" title="Report stays locked until both credentials are configured">⚠️ Setup needed</span>';
        return `<tr>
        <td>${l.source === 'gv' ? '🟩 GV' : '🟦 FF'}</td>
        <td>${l.kind === 'tl' ? '👥 TL' : '🧑‍💼 Agent'}</td>
        <td><b>${esc(l.name)}</b><div class="dim small">${esc(String(l.createdAt || '').slice(0, 10))}</div></td>
        <td>${authBadge}</td>
        <td><div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">${secBadges}</div></td>
        <td class="mono small"><a href="/p/${esc(l.token)}" target="_blank" rel="noopener">${esc(origin)}/p/${esc(String(l.token).slice(0, 10))}…</a></td>
        <td>${l.enabled !== false ? '<span class="badge green">✅ ON</span>' : '<span class="badge red">⛔ OFF</span>'}</td>
        <td class="num" style="white-space:nowrap">
          <button class="btn small pl-edit" data-id="${esc(l.id)}" title="Access sections aur ID/Mobile Auth edit karo">⚙️ Access</button>
          <button class="btn small pl-copy" data-token="${esc(l.token)}" title="Poora URL copy karo">📋</button>
          <button class="btn small pl-wa" data-token="${esc(l.token)}" data-name="${esc(l.name)}" data-id="${esc(l.personId || '')}" title="WhatsApp par bhejo">💬</button>
          <button class="btn small pl-toggle" data-id="${esc(l.id)}" data-on="${l.enabled === false ? '1' : ''}">${l.enabled !== false ? '⏸️' : '▶️'}</button>
          <button class="btn small pl-del" data-id="${esc(l.id)}" title="Delete">🗑</button>
        </td></tr>`;
      }).join('')}
      </tbody></table></div>` : '<p class="dim">Abhi koi link nahi — source + exact naam choose karke pehla banao.</p>'}
      <p class="dim small" style="margin-top:10px">⚡ Har Personal Link me <b>📊 Overview · 📦 Class-wise Stock · 📅 Date &amp; Agent Issuance · 🏆 Performance · ⏳ Stock Ageing</b> tabs aur <b>⬇ CSV / 📄 PDF</b> download options hain. Admin <b>⚙️ Access</b> button se kisi bhi link ke sections ya Auth ID/Mobile badal sakta hai.</p>
    </div>`;
    const msg = U.$('#pl-msg', body), create = U.$('#pl-create', body);
    const sourceEl = U.$('#pl-source', body), kindEl = U.$('#pl-kind', body), nameEl = U.$('#pl-name', body);
    const pidEl = U.$('#pl-person-id', body), mobEl = U.$('#pl-mobile', body);

    wireSectionGroup(body, 'input[type="checkbox"][data-new-sec]', 'newSec');
    wireSectionGroup(body, 'input[type="checkbox"][data-def-sec]', 'defSec');

    const suggestionItems = () => {
      let people;
      if (sourceEl.value === 'gv' && FF.gv && FF.gv.people) people = FF.gv.people();
      else {
        const agents = new Map(), tls = new Map();
        const rows = FF.store && FF.store.get ? (FF.store.get('agents') || []) : [];
        rows.filter((a) => a.channel === 'First Forward').forEach((a) => {
          const name = String(a.name || '').trim(), tl = String(a.tlName || '').trim();
          if (name) {
            const old = agents.get(name) || { name, tl, id: a.id || '', mobile: a.mobile || '', n: 0 };
            old.n += Number(a.n) || 0; old.tl = old.tl || tl; old.id = old.id || a.id || ''; old.mobile = old.mobile || a.mobile || '';
            agents.set(name, old);
          }
          if (tl && !FF.config.isExcludedTl(tl)) tls.set(tl, (tls.get(tl) || 0) + (Number(a.n) || 0));
        });
        people = { agents: [...agents.values()], tls: [...tls.entries()].map(([name, n]) => ({ name, n })) };
      }
      if (kindEl.value === 'tl') return (people.tls || []).map((t) => ({ kind: 'tl', kindLabel: 'TL', label: t.name, id: t.id || t.tlId || '', mobile: t.mobile || '', sub: t.n ? `${U.fmtShort(t.n)} tags` : '', value: t.name }));
      return (people.agents || []).map((a) => ({ kind: 'agent', kindLabel: 'Agent', label: a.name, id: a.id || a.agentId || '', mobile: a.mobile || '', sub: a.tl || (a.id ? `ID ${a.id}` : ''), keywords: a.id || '', value: a.name }));
    };
    U.suggest(nameEl, {
      min: 1,
      items: suggestionItems,
      onPick: (it) => {
        nameEl.value = it.value || it.label;
        if (pidEl && it.id && !pidEl.value) pidEl.value = it.id;
        if (mobEl && it.mobile && !mobEl.value) mobEl.value = String(it.mobile).replace(/\D/g, '').slice(-10);
      },
      onEnter: (q) => { nameEl.value = q; }
    });
    [sourceEl, kindEl].forEach((el) => el.addEventListener('change', () => { nameEl.value = ''; if (pidEl) pidEl.value = ''; if (mobEl) mobEl.value = ''; nameEl.focus(); }));

    create.addEventListener('click', async () => {
      const source = sourceEl.value === 'gv' ? 'gv' : 'ff';
      const kind = kindEl.value === 'tl' ? 'tl' : 'agent';
      const name = (nameEl.value || '').trim();
      if (!name) return U.toast('Pehle exact naam choose karo', 'err');
      const personId = (pidEl && pidEl.value || '').trim();
      const mobile = (mobEl && mobEl.value || '').replace(/\D/g, '').slice(-10);
      if (personId.length < 2) return U.toast(`Exact ${kind === 'tl' ? 'TL ID' : 'Agent ID'} zaroori hai`, 'err');
      if (mobile.length !== 10) return U.toast('Registered 10-digit mobile number zaroori hai', 'err');
      const sections = [...body.querySelectorAll('[data-new-sec]:checked')].map((x) => x.dataset.newSec);
      msg.textContent = 'Google Sheet storage me link save ho raha hai…';
      await U.withButtonBusy(create, async () => {
        try {
          const out = await A.api('/api/personal-links', 'POST', { source, kind, name, personId, mobile, sections });
          const url = `${origin}/p/${out.link.token}`;
          await U.copyText(url).catch(() => false);
          U.toast('🔗 Link ban gaya aur copy ho gaya ✓', 'ok');
          await draw();
        } catch (err) { U.toast(err.message, 'err'); if (msg) msg.textContent = err.message; }
      }, 'Link save ho raha hai…');
    });

    const saveDefBtn = U.$('#pl-save-def', body);
    if (saveDefBtn) saveDefBtn.addEventListener('click', () => U.withButtonBusy(saveDefBtn, async () => {
      const sections = [...body.querySelectorAll('[data-def-sec]:checked')].map((x) => x.dataset.defSec);
      await A.api('/api/personal-links/defaults', 'POST', { sections, applyToAll: true });
      U.toast('🛡️ Global default access sabhi Personal Links par apply ho gaya ✓', 'ok');
      await draw();
    }, 'Saving…'));

    U.$$('.pl-edit', body).forEach((b) => b.addEventListener('click', () => {
      const link = links.find((x) => x.id === b.dataset.id);
      if (!link || !FF.app || !FF.app.openDrawer) return;
      const curSecs = Array.isArray(link.sections) ? link.sections : defSecs;
      FF.app.openDrawer({
        kicker: `🔗 Personal Link Access · ${link.source === 'gv' ? 'GV Partner' : 'First Forward'}`,
        title: `${link.kind === 'tl' ? '👥' : '🧑‍💼'} ${link.name}`,
        sub: 'Set the exact registered ID/mobile and control which report sections this link may return',
        body: `<div class="kd-sec">
          <div class="form-grid">
            <label class="fld"><span>🪪 ${link.kind === 'tl' ? 'TL ID' : 'Agent ID'} (Auth ke liye)</span>
              <input class="input" id="ple-id" value="${esc(link.personId || '')}" placeholder="e.g. 1001 ya TL-01"></label>
            <label class="fld"><span>📱 Registered Mobile Number (10 digit)</span>
              <input class="input" id="ple-mob" type="tel" inputmode="numeric" value="${esc(link.mobile || '')}" placeholder="e.g. 9876543210" maxlength="14"></label>
          </div>
          <p class="check" style="margin-top:8px">🔐 <b>ID + exact registered mobile verification is mandatory.</b> No personal report HTML/data is returned until both match.</p>
          <h4 class="drawer-section-title" style="margin-top:14px">🎛️ Allowed Tabs &amp; Features</h4>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
            ${PL_SECTIONS_META.map((s) => `<label class="chip ${curSecs.includes(s.key) ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" data-ple-sec="${s.key}" ${curSecs.includes(s.key) ? 'checked' : ''}> ${s.icon} ${esc(s.label)}</label>`).join('')}
          </div>
          <div class="btn-row" style="margin-top:16px">
            <button class="btn primary" id="ple-save">💾 Save Access &amp; Auth</button>
          </div>
        </div>`
      });
      const dBody = document.getElementById('drawer-body');
      if (!dBody) return;
      wireSectionGroup(dBody, 'input[data-ple-sec]', 'pleSec');
      const saveBtn = dBody.querySelector('#ple-save');
      if (saveBtn) saveBtn.addEventListener('click', () => U.withButtonBusy(saveBtn, async () => {
        const personId = (dBody.querySelector('#ple-id') && dBody.querySelector('#ple-id').value || '').trim();
        const mobile = (dBody.querySelector('#ple-mob') && dBody.querySelector('#ple-mob').value || '').replace(/\D/g, '').slice(-10);
        const sections = [...dBody.querySelectorAll('[data-ple-sec]:checked')].map((x) => x.dataset.pleSec);
        if (personId.length < 2) return U.toast(`Exact ${link.kind === 'tl' ? 'TL ID' : 'Agent ID'} zaroori hai`, 'err');
        if (mobile.length !== 10) return U.toast('Registered 10-digit mobile number zaroori hai', 'err');
        await A.api(`/api/personal-links/${encodeURIComponent(link.id)}`, 'PUT', { personId, mobile, sections });
        U.toast(`✅ ${link.name} ka Personal Link access update ho gaya`, 'ok');
        if (FF.app.closeDrawer) FF.app.closeDrawer();
        await draw();
      }, 'Saving…'));
    }));

    U.$$('.pl-copy', body).forEach((b) => b.addEventListener('click', () => {
      const url = `${origin}/p/${b.dataset.token}`;
      U.copyText(url).then(() => U.toast('📋 Link copy ho gaya', 'ok')).catch(() => { window.prompt('Copy karo:', url); });
    }));
    U.$$('.pl-wa', body).forEach((b) => b.addEventListener('click', () => {
      const url = `${origin}/p/${b.dataset.token}`;
      const text = `🔗 *${b.dataset.name}* — Personal Performance & Stock Link:\n🪪 Apni registered ID aur 📱 10-digit mobile verify karke report kholein.\n${url}`;
      if (FF.app && FF.app.shareWhatsApp) FF.app.shareWhatsApp(text);
      else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }));
    U.$$('.pl-toggle', body).forEach((b) => b.addEventListener('click', () => U.withButtonBusy(b, async () => {
      try { await A.api(`/api/personal-links/${encodeURIComponent(b.dataset.id)}/enable`, 'POST', { enabled: b.dataset.on === '1' }); await draw(); }
      catch (err) { U.toast(err.message, 'err'); }
    }, '…')));
    U.$$('.pl-del', body).forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm('Ye link delete kar dein?')) return;
      await U.withButtonBusy(b, async () => {
        try { await A.api(`/api/personal-links/${encodeURIComponent(b.dataset.id)}`, 'DELETE'); U.toast('Link delete ✓', 'ok'); await draw(); }
        catch (err) { U.toast(err.message, 'err'); }
      }, '…');
    }));
  }

  // ---- site diagnostics -------------------------------------------------------------------------
  // This scanner is intentionally browser-safe: it can repair wrapping, sizing and accessible
  // names in the rendered UI, but it never edits a displayed data total. Source discrepancies are
  // surfaced with their page/selector/context and a clear "repair the source" explanation.
  const diagnosticState = { findings: null, scannedAt: 0, running: false, pageStats: [], lastAllScanAt: 0 };
  const diagPage = () => {
    try { return (FF.app && FF.app.current && FF.app.current.page) || (location.hash.match(/^#\/?([^?/]*)/) || [])[1] || 'current page'; } catch { return 'current page'; }
  };
  const diagText = (el, limit = 120) => String(el && (el.innerText || el.textContent || '') || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const diagVisible = (el) => {
    if (!el || el.hidden || el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    try {
      const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return !r || (r.width > 0 && r.height > 0);
    } catch { return true; }
  };
  const diagStyle = (el) => { try { return window.getComputedStyle ? window.getComputedStyle(el) : {}; } catch { return {}; } };
  function diagSelector(el) {
    if (!el) return 'document';
    if (el.id) return `#${el.id}`;
    const tag = String(el.tagName || 'element').toLowerCase();
    const classes = String(el.className && typeof el.className === 'string' ? el.className : '').split(/\s+/).filter((x) => /^[a-zA-Z][\w-]*$/.test(x)).slice(0, 2);
    return `${tag}${classes.length ? `.${classes.join('.')}` : ''}`;
  }
  function diagKnownRoute(href) {
    const m = String(href || '').match(/^#\/?([^?/#]+)/);
    if (!m) return true;
    const route = m[1];
    if (route === 'sheet') return true;
    return !!(FF.pages && FF.pages[route]);
  }
  /** 🛠️ Persistent safe-repair layer: fixes browser me apply hote hi localStorage me rule ban jaate hain
      aur ek global stylesheet se POORE SITE par (har page, har reload) lagu rehte hain — pehle fix
      sirf current DOM par lagta tha aur page change/reload par gayab ho jaata tha. */
  const LS_REPAIRS = 'ff_diag_repairs';
  const REPAIR_CSS = {
    wrap: 'min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word;white-space:normal',
    control: 'max-width:100%;min-width:0;flex-shrink:1;white-space:normal',
    kpi: 'min-width:0;max-width:100%'
  };
  function repairRules() { try { const v = JSON.parse(localStorage.getItem(LS_REPAIRS) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  function applyRepairCss(rules) {
    try {
      if (typeof document === 'undefined') return;
      const head = document.head || (document.querySelector && document.querySelector('head'));
      if (!head) return;
      const list = (rules || repairRules()).filter((r) => r && r.selector && REPAIR_CSS[r.fixType]);
      let tag = document.getElementById('ff-diag-style');
      if (!tag) { tag = document.createElement('style'); tag.id = 'ff-diag-style'; head.appendChild(tag); }
      tag.textContent = list.map((r) => `${r.selector}{${REPAIR_CSS[r.fixType]}}`).join('\n');
      document.documentElement.classList.toggle('ff-diag-repairs', list.length > 0);
    } catch { /* CSS layer optional — element-level fix phir bhi laga rehta hai */ }
  }
  function writeRepairs(rules) {
    try { localStorage.setItem(LS_REPAIRS, JSON.stringify(rules.slice(-150))); } catch { /* private mode */ }
    applyRepairCss(rules);
  }
  function addRepair(f) {
    const selector = f.repairSelector || diagStableSelector(f.element);
    if (!selector || !REPAIR_CSS[f.fixType]) return false;
    const rules = repairRules().filter((r) => r.selector !== selector);
    rules.push({ selector, fixType: f.fixType, at: Date.now(), page: f.page || '' });
    writeRepairs(rules);
    f.repairSelector = selector;
    return true;
  }
  /** Element ka stable selector (id → class → nth-of-type path) — persistent CSS rule ke liye. */
  function diagStableSelector(el) {
    if (!el || !el.tagName || typeof document === 'undefined') return '';
    if (el.id) return `#${el.id}`;
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.tagName && node !== document.body && depth < 4) {
      let sel = String(node.tagName).toLowerCase();
      if (node.classList && node.classList.length) sel += '.' + [...node.classList].slice(0, 2).join('.');
      const parent = node.parentElement;
      if (parent && parent.children) {
        const sibs = [...parent.children].filter((x) => x.tagName === node.tagName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = parent || node.parentNode;
      depth++;
    }
    return parts.join(' > ');
  }
  function diagFinding(out, f) {
    out.push({ id: f.id || `diag-${out.length + 1}`, severity: f.severity || 'low', category: f.category || 'UI', safe: f.safe === true, page: f.page || diagPage(), selector: f.selector || 'document', context: f.context || '—', explanation: f.explanation || '', suggestion: f.suggestion || '', fixType: f.fixType || '', element: f.element || null, repairSelector: f.repairSelector || (f.element ? diagStableSelector(f.element) : ''), fixed: false });
  }
  function scanDomDiagnostics() {
    const out = [];
    if (typeof document === 'undefined') return out;
    // Scan the shell as well as the current route: sidebar/topbar/mobile nav contain site-wide
    // actions that are otherwise outside #app. Hidden panels are filtered by diagVisible().
    const root = document.body || document.querySelector('#app');
    const all = root ? [...root.querySelectorAll('*')] : [];
    const ignored = (el) => el.matches && (el.matches('script,style,noscript,svg,path,canvas,pre,code,.table-wrap,.heat-wrap,.kd-scroll,.suggest,[data-diagnostic-ignore]') || el.closest('.table-wrap,.heat-wrap,.kd-scroll,.suggest,[data-diagnostic-ignore]'));
    const route = diagPage();
    all.filter((el) => diagVisible(el) && !ignored(el)).forEach((el) => {
      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!r || r.width < 1 || r.height < 1) return;
      const cs = diagStyle(el);
      const overX = (el.scrollWidth || 0) > (el.clientWidth || r.width) + 3;
      const overY = (el.scrollHeight || 0) > (el.clientHeight || r.height) + 3;
      const clipped = /hidden|clip/.test(`${cs.overflow || ''} ${cs.overflowX || ''} ${cs.overflowY || ''}`) || cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap';
      if ((overX || overY) && clipped) {
        const important = el.closest && el.closest('.drawer,.mp,.ms-kundli,.mp-kpi,.dkpi');
        diagFinding(out, { id: `overflow-${diagSelector(el)}-${out.length}`, category: 'Text overflow / overlap', severity: important ? 'high' : 'medium', safe: true, fixType: 'wrap', element: el, page: route, selector: diagSelector(el), context: diagText(el) || 'Element content', explanation: `Content apne box se ${overX ? 'horizontal' : ''}${overX && overY ? ' aur ' : ''}${overY ? 'vertical' : ''} bahar ja raha hai; label, value ya badge overlap/clip ho sakta hai.`, suggestion: 'Box ko shrink hone do, text wrap karo aur badge ko available width ke andar rakho.' });
      }
    });
    [...root.querySelectorAll('button,input,select,textarea,[role="button"]')].filter(diagVisible).forEach((el) => {
      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!r) return;
      const outside = r.left < -2 || r.right > (window.innerWidth || document.documentElement.clientWidth || r.right) + 2;
      if (outside || r.width < 24 || r.height < 24) diagFinding(out, { id: `control-${diagSelector(el)}-${out.length}`, category: 'Clipped controls', severity: 'medium', safe: true, fixType: 'control', element: el, page: route, selector: diagSelector(el), context: diagText(el) || el.getAttribute('aria-label') || el.getAttribute('title') || 'Control', explanation: outside ? 'Control viewport ke bahar nikal raha hai.' : 'Control ka hit-area bahut chhota hai; mobile/touch par clip ya tap miss ho sakta hai.', suggestion: 'Control ko max-width: 100% aur responsive wrapping ke saath accessible minimum size do.' });
    });
    const kpis = [...root.querySelectorAll('.kpi,.dkpi,.mp-kpi')].filter(diagVisible);
    kpis.forEach((el) => {
      const isKpi = el.matches('.kpi'), label = el.querySelector(isKpi ? '.kpi-title' : 'small'), value = el.querySelector(isKpi ? '.kpi-value' : 'b');
      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!label || !diagText(label) || !value || !diagText(value)) diagFinding(out, { id: `kpi-content-${diagSelector(el)}-${out.length}`, category: 'KPI card consistency', severity: 'medium', safe: true, fixType: 'kpi', element: el, page: route, selector: diagSelector(el), context: diagText(el) || 'KPI card', explanation: 'KPI card me label ya value missing/empty hai; cards ka content pattern inconsistent hai.', suggestion: 'Card ko shrink-safe banao aur label/value ko explicit rakho.' });
      if (r && (r.width < 112 || r.height < 48)) diagFinding(out, { id: `kpi-size-${diagSelector(el)}-${out.length}`, category: 'KPI card consistency', severity: 'medium', safe: true, fixType: 'kpi', element: el, page: route, selector: diagSelector(el), context: diagText(el) || 'KPI card', explanation: 'KPI card responsive breakpoint par bahut chhota ho gaya hai.', suggestion: 'Grid item ko min-width: 0 do aur content ko wrap hone do.' });
    });
    [...root.querySelectorAll('a[href]')].filter(diagVisible).forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || href === '#' || /^javascript:/i.test(href)) diagFinding(out, { id: `link-empty-${diagSelector(a)}-${out.length}`, category: 'Links / actions', severity: 'medium', safe: false, page: route, selector: diagSelector(a), context: diagText(a) || 'Unnamed link', explanation: 'Link ka destination missing hai; click karne par useful action nahi hota.', suggestion: 'Valid internal route ya explicit button action set karo.' });
      else if (/^#\/?/.test(href) && !diagKnownRoute(href)) diagFinding(out, { id: `link-route-${href}-${out.length}`, category: 'Links / actions', severity: 'high', safe: false, page: route, selector: diagSelector(a), context: `${diagText(a) || 'Link'} → ${href}`, explanation: 'Internal link registered page/action se match nahi karta.', suggestion: 'Route name/permission check karo; browser me isse safely repair nahi kiya ja sakta.' });
    });
    [...root.querySelectorAll('button,[role="button"]')].filter(diagVisible).forEach((el) => {
      const name = diagText(el) || el.getAttribute('aria-label') || el.getAttribute('title');
      if (!name) diagFinding(out, { id: `a11y-button-${diagSelector(el)}-${out.length}`, category: 'Accessibility', severity: 'low', safe: true, fixType: 'aria', element: el, page: route, selector: diagSelector(el), context: 'Button without accessible name', explanation: 'Screen reader ko is action ka naam nahi mil raha.', suggestion: 'Visible action text ya aria-label provide karo.' });
    });
    [...root.querySelectorAll('img')].filter(diagVisible).forEach((el) => { if (!el.getAttribute('alt')) diagFinding(out, { id: `a11y-image-${diagSelector(el)}-${out.length}`, category: 'Accessibility', severity: 'low', safe: true, fixType: 'alt', element: el, page: route, selector: diagSelector(el), context: 'Image without alt text', explanation: 'Image ka alternative text missing hai.', suggestion: 'Decorative image ho to alt empty rakho; meaningful image ho to short description do.' }); });
    // Route contract scan complements the rendered-DOM pass: every registered page/action module is
    // checked even when that route is not currently open, while page-specific layout findings come
    // from the current page and any open drawer without navigating the user away.
    (FF.app && Array.isArray(FF.app.PAGES) ? FF.app.PAGES : []).forEach((def) => {
      if (!def || !def.id || def.id === 'sheet') return;
      if (!FF.pages || !FF.pages[def.id] || typeof FF.pages[def.id].render !== 'function') diagFinding(out, { id: `route-missing-${def.id}`, category: 'Links / actions', severity: 'high', safe: false, page: 'Site routes', selector: `#/${def.id}`, context: `${def.label || def.id} route`, explanation: 'Registered navigation page ka render module missing hai.', suggestion: 'Page module/script registration restore karo; browser se safe fix nahi kiya ja sakta.' });
    });
    // Core module contract — koi module missing ho to uspar nirbhar pages chup-chaap toot jaate hain.
    [['util', 'FF.util'], ['model', 'FF.model'], ['store', 'FF.store'], ['gv', 'FF.gv'], ['charts', 'FF.charts'], ['filters', 'FF.filters'], ['kpiDetail', 'FF.kpiDetail']].forEach(([id, path]) => {
      const obj = path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), typeof window !== 'undefined' ? window : {});
      if (!obj) diagFinding(out, { id: `module-${id}-missing`, category: 'Core modules', severity: 'high', safe: false, page: 'Site shell', selector: path, context: `${path} load nahi hua`, explanation: `Ye module missing hai — ${id} par nirbhar pages/KPI drill-down kaam nahi karenge.`, suggestion: 'index.html me script tag (aur cache version) check karo, phir hard reload karo.' });
    });
    // 🔁 FF T+1 lag config sanity
    if (FF.filters && typeof FF.filters.ffLagDays === 'function') {
      const lag = FF.filters.ffLagDays();
      if (!Number.isFinite(lag) || lag < 0 || lag > 7) diagFinding(out, { id: 'config-ff-lag', category: 'Data source', severity: 'medium', safe: false, page: 'Site config', selector: 'FF.config.ffIssuanceLagDays', context: `ffIssuanceLagDays = ${String(lag)}`, explanation: 'FF issuance lag 0–7 din ke beech hona chahiye (default 1 = aaj ka data kal).', suggestion: 'Settings → Sheets & tabs / config me ffIssuanceLagDays sahi karo.' });
    }
    // KPI card contract: har data-kpi spec parse hona chahiye, warna click par galat drawer khulta hai.
    const KNOWN_SRC = ['ff', 'gv', 'both'];
    const KNOWN_SCOPE = ['day', 'mtd', 'month', 'range', 'stock', 'agents', 'status', 'stockreport'];
    const KNOWN_F = ['vc4', 'comm', 'vc20', 'vc5p', 'repl', 'chassis', 'wrong', 'gv', 'ff'];
    [...root.querySelectorAll('[data-kpi]')].forEach((el) => {
      const raw = el.getAttribute('data-kpi');
      if (!raw) return;
      const p = new URLSearchParams(raw);
      const bad = [];
      if (p.get('src') && !KNOWN_SRC.includes(p.get('src'))) bad.push(`src=${p.get('src')}`);
      if (p.get('scope') && !KNOWN_SCOPE.includes(p.get('scope'))) bad.push(`scope=${p.get('scope')}`);
      String(p.get('f') || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => { if (!KNOWN_F.includes(x)) bad.push(`f=${x}`); });
      if (bad.length) diagFinding(out, { id: `kpi-spec-${diagSelector(el)}-${out.length}`, category: 'KPI card consistency', severity: 'medium', safe: false, page: route, selector: diagSelector(el), context: `${diagText(el, 60) || 'KPI'} → data-kpi="${raw}"`, explanation: `KPI drill-down spec me unknown key: ${bad.join(', ')}. Click karne par drawer galat ya khali aa sakta hai.`, suggestion: `Allowed: src ${KNOWN_SRC.join('/')} · scope ${KNOWN_SCOPE.join('/')} · f ${KNOWN_F.join('/')}.` });
    });
    return out;
  }
  // Boot par saved repairs apply karo — fix har page/reload par pehle se lagi rehti hai.
  try { if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyRepairCss()); else applyRepairCss(); } } catch { /* ignore */ }
  function applyDiagnosticFix(f) {
    if (!f || !f.safe) return false;
    const el = f.element;
    if (f.fixType === 'aria') { if (!el) return false; el.setAttribute('aria-label', el.getAttribute('title') || 'Action'); f.fixed = true; return true; }
    if (f.fixType === 'alt') { if (!el) return false; el.setAttribute('alt', ''); f.fixed = true; return true; }
    // 🆕 attribute repair (jaise data-kpi-self) — DOM par turant + localStorage rule + watcher se har re-render par.
    if (ATTR_FIX[f.fixType]) {
      const saved = addAttrRepair(f);
      if (el && el.setAttribute) { try { el.setAttribute(ATTR_FIX[f.fixType].attr, ATTR_FIX[f.fixType].value); } catch { /* ignore */ } }
      startAttrRepairWatcher();
      f.fixed = saved || !!el;
      return true;
    }
    if (!REPAIR_CSS[f.fixType]) return false;
    // 1) Site-wide persistent CSS rule (page change / reload ke baad bhi lagu rehta hai)
    const saved = addRepair(f);
    // 2) Turant visible asar current element par
    if (el && el.style) {
      el.classList.add(f.fixType === 'wrap' ? 'ff-diagnostic-fixed' : f.fixType === 'control' ? 'ff-diagnostic-control-fixed' : 'ff-diagnostic-kpi-fixed');
      Object.assign(el.style, f.fixType === 'wrap'
        ? { minWidth: '0', maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word', whiteSpace: 'normal' }
        : f.fixType === 'control'
          ? { maxWidth: '100%', minWidth: '0', flexShrink: '1', whiteSpace: 'normal' }
          : { minWidth: '0', maxWidth: '100%' });
    }
    // Element DOM me na ho (ya naya render ho) par rule hai to bhi fix ho chuka maana jayega.
    f.fixed = saved || !!el;
    return true;
  }
  /** Kya is finding ka repair pehle se saved hai? (page reload ke baad bhi "Fixed" dikhe) */
  function repairSaved(f) {
    if (!f || !f.safe) return false;
    const selector = f.repairSelector || diagStableSelector(f.element);
    if (!selector) return false;
    if (ATTR_FIX[f.fixType]) return attrRepairRules().some((r) => r.selector === selector && r.fixType === f.fixType);
    if (!REPAIR_CSS[f.fixType]) return false;
    return repairRules().some((r) => r.selector === selector && r.fixType === f.fixType);
  }
  // ============ 🩺 Diagnostics v2 (v3.37) — "Settings ke diagnose button se sab detect + fix" ============
  /** 🎯 Root-cause detector: kuch pages apne KPI card ka click khud handle karte hain (data-ua-flag,
      data-as-age), lekin app.js ka GLOBAL `.kpi, [data-kpi]` handler bhi usi click par chal jaata hai.
      Dono drawer khulte hain aur aakhri wala (card ke title se inferred, period ignore) jeet jaata hai →
      "card ka apna data drawer me nahi dikhta". Fix = card par `data-kpi-self="1"` (global handler skip). */
  const SELF_KPI_ATTRS = ['data-ua-flag', 'data-as-age'];
  const LS_ATTR_REPAIRS = 'ff_diag_attr_repairs';
  const LS_SPEED_PREFS = 'ff_speed_prefs';
  const LS_DIAG_HISTORY = 'ff_diag_history';
  const ATTR_FIX = { kpiSelf: { attr: 'data-kpi-self', value: '1', label: 'Card ka click page khud handle kare (global kpiDetail hijack band)' } };

  function attrRepairRules() { try { const v = JSON.parse(localStorage.getItem(LS_ATTR_REPAIRS) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  function writeAttrRepairs(rules) { try { localStorage.setItem(LS_ATTR_REPAIRS, JSON.stringify((rules || []).slice(-120))); } catch { /* private mode */ } applyAttrRepairs(); }
  function addAttrRepair(f) {
    const selector = f.repairSelector || diagStableSelector(f.element);
    if (!selector || !ATTR_FIX[f.fixType]) return false;
    const rules = attrRepairRules().filter((r) => !(r.selector === selector && r.fixType === f.fixType));
    rules.push({ selector, fixType: f.fixType, at: Date.now(), page: f.page || '' });
    writeAttrRepairs(rules);
    f.repairSelector = selector;
    return true;
  }
  /** Saved attribute repairs DOM par lagao — page re-render ke baad watcher dobara laga deta hai. */
  function applyAttrRepairs(root) {
    try {
      if (typeof document === 'undefined') return 0;
      const rules = attrRepairRules();
      if (!rules.length) return 0;
      const scope = root || document;
      let n = 0;
      for (const r of rules) {
        const fix = ATTR_FIX[r.fixType];
        if (!fix || !r.selector || !scope.querySelectorAll) continue;
        let els = [];
        try { els = [...scope.querySelectorAll(r.selector)]; } catch { els = []; }
        for (const el of els) { if (el && el.getAttribute && el.getAttribute(fix.attr) !== fix.value) { el.setAttribute(fix.attr, fix.value); n++; } }
      }
      return n;
    } catch { return 0; }
  }
  let attrWatcher = null;
  /** Naya page render hote hi saved attr repairs dobara lagao (re-render par fix gayab na ho). */
  function startAttrRepairWatcher() {
    try {
      if (attrWatcher || typeof MutationObserver === 'undefined' || !document.body) return;
      let pending = false;
      attrWatcher = new MutationObserver(() => {
        if (pending || !attrRepairRules().length) return;
        pending = true;
        setTimeout(() => { pending = false; applyAttrRepairs(document); }, 250);
      });
      attrWatcher.observe(document.body, { childList: true, subtree: true });
    } catch { /* watcher optional hai */ }
  }

  /** ⚡ Speed doctor — user ke apne performance prefs; app.js inhe boot par hi laga deta hai. */
  const SPEED_PREF_DEFS = [
    { key: 'reduceMotion', label: '🎞 Animations band (ff-no-anim)', hint: 'Drawer/table transitions hat jaate hain — card click turant khulta hai, purane device par sabse zyada farq.' },
    { key: 'lite', label: '🪶 Lite mode (ff-lite)', hint: 'Bhaari visual layer (shadows/gradients/big tables) halka — scroll aur paint fast.' },
    { key: 'uaFastScan', label: '🚀 Unusual Activity: Fast scan mode', hint: 'Page turant daily numbers se paint hota hai; ≤30 min purana server scan cache use hota hai, fresh scan sirf ↻ Re-scan par.' }
  ];
  function speedPrefs() { try { return JSON.parse(localStorage.getItem(LS_SPEED_PREFS) || '{}') || {}; } catch { return {}; } }
  function applySpeedPrefs(p) {
    try {
      const prefs = p || speedPrefs();
      const root = (typeof document !== 'undefined' && document.documentElement) || null;
      if (!root || !root.classList) return prefs;
      root.classList.toggle('ff-no-anim', !!prefs.reduceMotion);
      root.classList.toggle('ff-lite', !!prefs.lite);
      return prefs;
    } catch { return {}; }
  }
  function setSpeedPref(key, val) {
    const next = { ...speedPrefs(), [key]: !!val };
    try { localStorage.setItem(LS_SPEED_PREFS, JSON.stringify(next)); } catch { /* private mode */ }
    applySpeedPrefs(next);
    return next;
  }

  /** 🧾 Scan history — "pichli baar kitne findings the" compare karne ke liye (last 20 scans). */
  function diagHistory() { try { const v = JSON.parse(localStorage.getItem(LS_DIAG_HISTORY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  function pushDiagHistory(entry) { try { localStorage.setItem(LS_DIAG_HISTORY, JSON.stringify([entry, ...diagHistory()].slice(0, 20))); } catch { /* ignore */ } }

  /** 🔎 DOM pass: KPI cards jinka click page khud handle karta hai par `data-kpi-self` missing hai. */
  function diagSelfKpiFindings(out, route) {
    try {
      if (typeof document === 'undefined' || !document.querySelectorAll) return out;
      for (const el of [...document.querySelectorAll('.kpi, [data-kpi]')]) {
        if (!el || !el.hasAttribute || el.hasAttribute('data-kpi-self')) continue;
        const attrs = SELF_KPI_ATTRS.filter((a) => el.hasAttribute(a));
        if (!attrs.length) continue;                    // normal kpiDetail card — theek hai
        const sel = diagStableSelector(el) || diagSelector(el);
        diagFinding(out, {
          id: `kpi-self-${sel}-${attrs.join('-')}`,
          category: 'KPI card click',
          severity: 'high',
          safe: true,
          fixType: 'kpiSelf',
          page: route,
          selector: sel,
          element: el,
          context: `${diagText(el, 60) || 'KPI card'} → ${attrs.join(' + ')}${el.hasAttribute('data-kpi') ? ' + data-kpi' : ''}`,
          explanation: 'Ye card page ka apna click handler use karta hai, lekin global `.kpi` handler (FF.kpiDetail) bhi isi click par chal jaata hai. Do drawer khulte hain aur aakhri wala card ke title se INFERRED (period/flag ignore) data dikha deta hai — isi liye card ka number drawer me nahi milta aur click slow lagta hai.',
          suggestion: 'Fix button card par data-kpi-self="1" laga deta hai (site-wide saved + re-render par dobara lagta hai). Permanent ke liye source me bhi wahi attribute rakho — v3.37 me unusual.js/agentSummary.js par pehle se hai.'
        });
      }
    } catch { /* DOM pass optional */ }
    return out;
  }

  /** 🐢 Page weight/render timings — "kaunsa page site ko slow karta hai" ka exact jawab. */
  function diagPageWeightFindings(out, stats) {
    for (const s of stats || []) {
      const kb = Math.round((s.chars || 0) / 1024);
      const ctx = `${s.label || s.page} · render ${U.fmt(s.ms)}ms · ${U.fmt(s.nodes)} DOM nodes · ${U.fmt(kb)} KB HTML`;
      if (s.ms > 2500 || s.nodes > 5000 || kb > 400) {
        diagFinding(out, {
          id: `page-weight-${s.page}`, category: 'Page speed', severity: s.ms > 6000 || s.nodes > 12000 ? 'high' : 'medium',
          safe: false, page: s.label || s.page, selector: `#/${s.page}`, context: ctx,
          explanation: 'Is page ka render/DOM bhaari hai — click, scroll aur drawer isi se atakte hain.',
          suggestion: 'Tables ko cap + "Load more" par rakho (Unusual Activity ka CAP_LEDGER/CAP_DRAWER pattern), bade sections ko chunk me bharo, aur ⚡ Speed doctor me Lite mode / Animations band chalu karo.'
        });
      }
    }
    return out;
  }

  /** 🗂 Data health — store snapshot + Unusual Activity tag scan ka asli status. */
  function diagDataHealthFindings(out) {
    try {
      const daily = (FF.store && FF.store.get && FF.store.get('daily')) || [];
      if (!daily.length) {
        diagFinding(out, { id: 'diag-store-empty', category: 'Data health', severity: 'high', safe: false, page: 'Site snapshot', selector: 'FF.store.daily', context: 'Store me 0 daily rows hain', explanation: 'Bina daily rows ke saare KPI/anomaly cards khali ya galat dikhenge.', suggestion: 'Topbar ↻ Refresh dabao; Settings → Sheets me EIR/REPORT sheet ID + mapping check karo.' });
      }
      const ua = FF.unusual;
      if (ua && ua.state) {
        const st = ua.state;
        if (st.scanError) diagFinding(out, { id: 'diag-ua-scan-error', category: 'Unusual Activity scan', severity: 'high', safe: false, page: 'Unusual Activity', selector: '/api/unusual/scan', context: `Server scan error: ${st.scanError}`, explanation: 'Server-side tag scan fail hua, isliye page browser fallback par chala (slow + adhoora data).', suggestion: 'Unusual Activity → 🩺 Diagnose → ↻ Deep scan dabao. Deploy me server.js aur unusual-scan.js same version ke hone chahiye (hard reload / sw cache clear).' });
        const meta = (st.scan && st.scan.meta) || null;
        if (meta && meta.complete === false) diagFinding(out, { id: 'diag-ua-incomplete', category: 'Unusual Activity scan', severity: 'medium', safe: false, page: 'Unusual Activity', selector: 'scan.meta.complete', context: `Scan adhoora · ${U.fmt(meta.rowsRead || 0)} rows · ${U.fmt(meta.pages || 0)} pages`, explanation: 'Sheet paging cap ki wajah se kuch tag rows padhi hi nahi gayin — duplicate/wrong counts kam dikh sakte hain.', suggestion: 'Date range chhota karo (7–15 din) ya admin se page cap badhwao.' });
        if (meta && meta.offsetIssue) diagFinding(out, { id: 'diag-ua-offset', category: 'Unusual Activity scan', severity: 'high', safe: false, page: 'Unusual Activity', selector: 'gviz offset', context: 'Google gviz offset paging me rows repeat ho rahi hain', explanation: 'Offset-based paging par sheet same rows dobara deti hai → counts double ho jaate hain.', suggestion: 'Scan library offset verify karke fallback par chali jaati hai; phir bhi dikhe to range chhota karo.' });
        if (st.scan && st.scan.at && Date.now() - st.scan.at > 60 * 60000) diagFinding(out, { id: 'diag-ua-stale', category: 'Unusual Activity scan', severity: 'low', safe: false, page: 'Unusual Activity', selector: 'scan.at', context: `Aakhri tag scan ${U.timeLabel(st.scan.at)} ka hai`, explanation: 'Scan purana hai — naye tags isme nahi hain.', suggestion: 'Unusual Activity → ↻ Re-scan (fresh) dabao.' });
        if (st.lastPaintMs > 400) diagFinding(out, { id: 'diag-ua-paint', category: 'Page speed', severity: 'medium', safe: false, page: 'Unusual Activity', selector: 'paintAll()', context: `Last paint ${U.fmt(st.lastPaintMs)}ms (paint #${U.fmt(st.paintCount || 0)})`, explanation: 'Page ka paint 400ms se zyada le raha hai — tables/DOM bhaari hain.', suggestion: '⚡ Speed doctor me Lite mode chalu karo; ledger/drawer caps already chunked hain.' });
      }
    } catch { /* data pass optional */ }
    return out;
  }

  /** 🔬 Card ↔ drawer parity probe — Unusual Activity ke har KPI card ko asli me click karke verify. */
  async function runCardParityProbe(body) {
    const out = U.$('#diag-parity-out', body);
    if (!out) return [];
    const app = FF.app;
    if (!app || !app.navigate) throw new Error('App shell ready nahi hai');
    const back = (app.current && app.current.page) || 'settings';
    out.innerHTML = U.spinner('Unusual Activity ke har KPI card par click karke drawer ka number verify ho raha hai…');
    try {
      if (FF.lazy && FF.lazy.ensure) await FF.lazy.ensure('unusual');
      app.navigate('unusual', {});
      await new Promise((r) => setTimeout(r, 2500));          // instant paint + background scan settle
      if (!FF.unusual || typeof FF.unusual.probeCards !== 'function') throw new Error('FF.unusual.probeCards nahi mila — purana cache lag raha hai, hard reload (Ctrl+Shift+R) karo');
      const results = (await FF.unusual.probeCards(out)) || [];
      const bad = results.filter((r) => !r.ok);
      for (const r of bad) {
        diagFinding(diagnosticState.findings || (diagnosticState.findings = []), {
          id: `parity-${r.flag}`, category: 'Card ↔ drawer parity', severity: 'high', safe: false,
          page: 'Unusual Activity', selector: `[data-ua-flag="${r.flag}"]`,
          context: `${r.label}: card "${r.card}" vs drawer "${r.drawerTitle}"`,
          explanation: `Card ka number drawer me nahi mila (title ${r.okTitle ? '✓' : '✗'} · value ${r.okValue ? '✓' : '✗'} · unit ${r.okUnit ? '✓' : '✗'}).`,
          suggestion: 'Unusual Activity → 🩺 Diagnose → ↻ Deep scan (fresh) chalao; phir yahi probe dobara karo.'
        });
      }
      const head = `<p class="dim small">${U.fmt(results.length)} KPI cards test hue · ${bad.length ? `<b class="red">${U.fmt(bad.length)} mismatch</b>` : '<b>✅ har card ka number drawer me exact mila</b>'}</p>`;
      out.innerHTML = head + out.innerHTML.replace(/^<p class="dim small">[\s\S]*?<\/p>/, '');
      return results;
    } finally {
      app.navigate(back, back === 'settings' ? { tab: 'diagnostics' } : {});
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  /** Findings ko filter/search/group karke dikhane ke liye view state. */
  const diagView = { sev: 'all', cat: 'all', q: '', group: 'none' };
  function diagVisibleFindings() {
    const q = (diagView.q || '').trim().toLowerCase();
    let list = (diagnosticState.findings || []).filter((f) => {
      if (diagView.sev !== 'all' && f.severity !== diagView.sev) return false;
      if (diagView.cat !== 'all' && (f.category || 'Other') !== diagView.cat) return false;
      if (!q) return true;
      return `${f.category} ${f.page} ${f.selector} ${f.context} ${f.explanation} ${f.suggestion}`.toLowerCase().includes(q);
    });
    if (diagView.group !== 'none') {
      const key = (f) => (diagView.group === 'page' ? (f.page || '—') : (f.category || 'Other'));
      list = list.slice().sort((a, b) => String(key(a)).localeCompare(String(key(b))) || (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
    }
    return list;
  }
  function diagExport(kind) {
    const list = diagVisibleFindings();
    const head = ['severity', 'category', 'page', 'selector', 'context', 'why', 'fix', 'fixed', 'safeFix'];
    const rows = list.map((f) => [f.severity || '', f.category || '', f.page || '', f.selector || '', f.context || '', f.explanation || '', f.suggestion || '', f.fixed ? 'yes' : 'no', f.safe ? 'yes' : 'no']);
    const stampName = U.slug(`${U.stamp()}-diagnostics`);
    if (kind === 'csv') { U.downloadCsv(`${stampName}.csv`, head, rows); return rows.length; }
    if (kind === 'json') {
      const payload = { exportedAt: new Date().toISOString(), scannedAt: diagnosticState.scannedAt || null, count: rows.length, findings: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))) };
      U.downloadBlob(`${stampName}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      return rows.length;
    }
    const text = rows.map((r) => `[${String(r[0]).toUpperCase()}] ${r[1]} · ${r[2]} · ${r[3]}\n  ${r[4]}\n  Why: ${r[5]}\n  Fix: ${r[6]}`).join('\n\n');
    void U.copyText(`🩺 First Forward diagnostics — ${rows.length} findings (${U.timeLabel(Date.now())})\n\n${text}`);
    return rows.length;
  }

  function renderDiagnosticResults(body) {
    const box = U.$('#diag-results', body), status = U.$('#diag-status', body), fixAll = U.$('#diag-fix-all', body), scan = U.$('#diag-scan', body);
    if (!box) return;
    const list = (diagnosticState.findings || []).map((f) => ({ ...f, fixed: f.fixed || repairSaved(f) }));
    diagnosticState.findings = list;
    if (scan) scan.textContent = diagnosticState.scannedAt ? '↻ Rescan site' : '🩺 Scan site now';
    const safe = list.filter((f) => f.safe && !f.fixed);
    const savedCss = repairRules().length, savedAttr = attrRepairRules().length, savedCount = savedCss + savedAttr;
    const counts = ['high', 'medium', 'low'].map((s) => `${s}: ${list.filter((f) => f.severity === s).length}`).join(' · ');
    if (status) status.textContent = diagnosticState.running ? 'Scan chal raha hai…' : (diagnosticState.scannedAt ? `${list.length} findings · ${counts}${savedCount ? ` · 🛠 ${savedCount} saved repair${savedCount > 1 ? 's' : ''} active` : ''} · ${U.timeLabel(diagnosticState.scannedAt)}` : 'Abhi scan nahi hua');
    if (fixAll) { fixAll.disabled = !safe.length; fixAll.textContent = safe.length ? `🛠 Fix all safe (${safe.length})` : '🛠 Fix all safe'; }

    // ---- toolbar (filter / search / group / export) ----
    const toolbar = U.$('#diag-toolbar', body);
    if (toolbar) toolbar.hidden = !list.length;
    const catSel = U.$('#diag-filter-cat', body);
    if (catSel) {
      const cats = [...new Set(list.map((f) => f.category || 'Other'))].sort();
      if (diagView.cat !== 'all' && !cats.includes(diagView.cat)) diagView.cat = 'all';
      const cur = diagView.cat;
      catSel.innerHTML = `<option value="all">All categories (${list.length})</option>` + cats.map((c) => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)} (${list.filter((f) => (f.category || 'Other') === c).length})</option>`).join('');
    }
    const sevSel = U.$('#diag-filter-sev', body);
    if (sevSel) sevSel.innerHTML = ['all', 'high', 'medium', 'low'].map((v) => `<option value="${v}"${diagView.sev === v ? ' selected' : ''}>${v === 'all' ? `All severities (${list.length})` : `${v} (${list.filter((f) => f.severity === v).length})`}</option>`).join('');
    const grpSel = U.$('#diag-group', body);
    if (grpSel) grpSel.innerHTML = [['none', 'No grouping'], ['category', 'Group: category'], ['page', 'Group: page'], ['severity', 'Group: severity']].map(([v, l]) => `<option value="${v}"${diagView.group === v ? ' selected' : ''}>${l}</option>`).join('');
    const search = U.$('#diag-search', body);
    if (search && search.value !== diagView.q) search.value = diagView.q || '';

    const visible = diagVisibleFindings();
    const histBox = U.$('#diag-history', body);
    if (histBox) {
      const h = diagHistory();
      histBox.innerHTML = h.length ? `<div class="diag-saved"><b>🧾 Scan history</b> ${h.slice(0, 5).map((e) => `<span class="chip">${U.timeLabel(e.at)} · ${e.scope || 'site'} · ${U.fmt(e.total)} findings (${U.fmt(e.high)} high)${e.repairs ? ` · 🛠 ${U.fmt(e.repairs)}` : ''}</span>`).join(' ')}</div>` : '';
    }
    if (!diagnosticState.scannedAt) { box.innerHTML = '<div class="diag-empty">🩺 Scan button dabao — current rendered pages, registered actions, KPI cards (click hijack samet), accessibility, page speed/DOM weight aur available FF data consistency checks run honge. Fix button se safe repairs SITE-WIDE save hote hain (reload ke baad bhi lagu).</div>'; return; }
    if (!list.length) { box.innerHTML = `<div class="diag-ok">✅ Koi detectable issue nahi mila. Source snapshots, KPI cards, routes, page speed aur responsive UI normal dikh rahe hain.${savedCount ? `<br><small class="dim">🛠 ${savedCount} saved repair rule active — ye har page par lagu rehta hai.</small>` : ''}</div>`; return; }
    if (!visible.length) { box.innerHTML = `<div class="diag-empty">🔍 Is filter/search me koi finding nahi — ${list.length} findings me se.</div>`; return; }

    const groupKey = (f) => (diagView.group === 'page' ? (f.page || '—') : diagView.group === 'severity' ? (f.severity || 'low') : (f.category || 'Other'));
    let lastGroup = null;
    const articles = visible.map((f) => {
      const head = diagView.group !== 'none' && groupKey(f) !== lastGroup ? `<div class="diag-group-head">${esc(String(groupKey(f)))} <small class="dim">(${U.fmt(visible.filter((x) => groupKey(x) === groupKey(f)).length)})</small></div>` : '';
      lastGroup = groupKey(f);
      const fixLabel = f.fixType === 'kpiSelf' ? '🛠 Fix: card ko page-owned banao (site-wide)' : '🛠 Fix (site-wide)';
      return `${head}<article class="diag-finding ${esc(f.severity)} ${f.fixed ? 'fixed' : ''}">
      <div class="diag-finding-head"><span class="diag-severity">${f.severity === 'high' ? '⛔ High' : f.severity === 'medium' ? '⚠️ Medium' : 'ℹ️ Low'}</span><b>${esc(f.category)}</b><small>${esc(f.page)} · ${esc(f.selector)}</small></div>
      <p><b>${esc(f.context)}</b><br>${esc(f.explanation)}</p><p class="dim small"><b>Suggested fix:</b> ${esc(f.suggestion)}</p>
      ${f.safe && !f.fixed ? `<button class="btn small primary" data-diagnostic-fix="${esc(f.id)}">${fixLabel}</button>` : f.fixed ? '<span class="diag-fixed">✅ Fixed &amp; saved — poore site par lagu (rescan recommended)</span>' : '<span class="diag-source-note">🗂️ Source/config correction required — no unsafe browser fix applied</span>'}
    </article>`;
    }).join('');

    box.innerHTML = `${savedCount ? `<div class="diag-saved"><b>🛠 ${savedCount} saved repair${savedCount > 1 ? 's' : ''}</b> poore site par lagu hain${savedAttr ? ` (${savedAttr} attribute rule — re-render par apne aap dobara lagte hain)` : ''} (page change / reload ke baad bhi). <button class="btn small" type="button" data-diag-clear-repairs>Clear all repairs</button></div>` : ''}
    <div class="dim small diag-count">Dikh rahe hain <b>${U.fmt(visible.length)}</b> / ${U.fmt(list.length)} findings${diagView.q ? ` · search "${esc(diagView.q)}"` : ''}</div>
    ${articles}`;
    // delegated fix buttons — har re-render ke baad dobara wire (results box ke andar hi).
    U.$$('[data-diagnostic-fix]', box).forEach((btn) => btn.addEventListener('click', () => {
      const finding = (diagnosticState.findings || []).find((f) => f.id === btn.dataset.diagnosticFix);
      if (applyDiagnosticFix(finding)) { renderDiagnosticResults(body); U.toast('🛠 Safe fix site-wide apply + save ho gaya ✓', 'ok'); void runSiteDiagnostics(body); }
      else U.toast('Ye finding browser se safely fix nahi hoti — source/config theek karo', 'warn');
    }));
    const clearIn = U.$('[data-diag-clear-repairs]', box);
    if (clearIn) clearIn.addEventListener('click', () => { writeRepairs([]); writeAttrRepairs([]); U.toast('Saare saved repairs hata diye', 'warn'); renderDiagnosticResults(body); });
  }

  /** 🐢 Har page ka render time + DOM weight — "site slow kyun hai" ka page-level jawab. */
  function renderPageStats(body) {
    const box = U.$('#diag-page-stats', body);
    if (!box) return;
    const stats = diagnosticState.pageStats || [];
    if (!stats.length) { box.innerHTML = '<p class="dim small">🌐 "Scan every page" chalao → har page ka render time, DOM nodes aur HTML weight yahan aayega.</p>'; return; }
    const worst = stats.slice().sort((a, b) => b.ms - a.ms)[0];
    box.innerHTML = `<p class="dim small">Sabse bhaari page: <b>${esc(worst.label || worst.page)}</b> · ${U.fmt(worst.ms)}ms · ${U.fmt(worst.nodes)} nodes</p>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Page</th><th class="num">Render</th><th class="num">DOM nodes</th><th class="num">HTML</th></tr></thead>
      <tbody>${stats.slice().sort((a, b) => b.ms - a.ms).map((s) => `<tr><td><b>${esc(s.label || s.page)}</b></td><td class="num">${s.ms > 2500 ? `<b class="count red">${U.fmt(s.ms)}ms</b>` : `${U.fmt(s.ms)}ms`}</td><td class="num">${s.nodes > 5000 ? `<b class="count amber">${U.fmt(s.nodes)}</b>` : U.fmt(s.nodes)}</td><td class="num">${U.fmt(Math.round((s.chars || 0) / 1024))} KB</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function runSiteDiagnostics(body) {
    if (diagnosticState.running) return;
    diagnosticState.running = true; renderDiagnosticResults(body);
    // Pehle saved repairs laga do — warna fix kiye hue cards har scan me dobara "problem" bankar aate hain.
    applyAttrRepairs(document);
    applySpeedPrefs();
    const route = (FF.app && FF.app.current && FF.app.current.page) || 'current page';
    const findings = scanDomDiagnostics();
    diagSelfKpiFindings(findings, route);
    diagDataHealthFindings(findings);
    diagPageWeightFindings(findings, diagnosticState.pageStats);
    try {
      // Keep the data-source pass behind the same permission gate as the Performance page. The
      // site-wide UI scan is safe for every Settings user, but a member must not learn source
      // totals or sheet diagnostics for a page they cannot open.
      if ((A.isAdmin() || A.can('performance')) && FF.pages && FF.pages.performance && FF.pages.performance.diagnostics) {
        const result = await FF.pages.performance.diagnostics();
        (result.findings || []).forEach((f) => diagFinding(findings, { ...f, page: f.page || 'Performance', category: f.category || 'Data source' }));
      }
    } catch (err) {
      diagFinding(findings, { id: 'diag-performance-scan', severity: 'medium', category: 'Data source', safe: false, page: 'Performance', selector: 'diagnostics()', context: 'Performance scan unavailable', explanation: err.message || String(err), suggestion: 'Performance page/data source ko refresh karke dobara scan karo.' });
    }
    const loadedAt = (FF.store && FF.store.loadedAt) || (FF.gv && FF.gv.loadedAt) || (FF.data && FF.data.lastLoadAt);
    if (loadedAt) {
      const age = Math.max(0, Date.now() - new Date(loadedAt).getTime());
      if (age > 8 * 3600000) diagFinding(findings, { id: 'diag-site-snapshot-stale', severity: age > 24 * 3600000 ? 'high' : 'medium', category: 'Stale data', page: 'Site snapshot', selector: 'FF.store.loadedAt', context: `${U.timeLabel(loadedAt)} · snapshot purana hai`, explanation: 'Site ka in-memory snapshot recommended freshness window se purana hai.', suggestion: 'Topbar Refresh dabao aur source sync complete hone do.' });
    }
    diagnosticState.findings = findings; diagnosticState.scannedAt = Date.now(); diagnosticState.running = false;
    pushDiagHistory({ at: diagnosticState.scannedAt, scope: route, total: findings.length, high: findings.filter((f) => f.severity === 'high').length, medium: findings.filter((f) => f.severity === 'medium').length, low: findings.filter((f) => f.severity === 'low').length, repairs: repairRules().length + attrRepairRules().length });
    renderDiagnosticResults(body);
  }
  /** 🌐 Poora site scan — har permitted page ko render karke uske DOM ko check karta hai.
      (Pehle scan sirf current page + shell dekhta tha, isliye "diagnose kaam nahi karta" lagta tha.) */
  async function scanEveryPage(onProgress) {
    const app = FF.app;
    if (!app) throw new Error('App shell abhi ready nahi hai');
    const startPage = (app.current && app.current.page) || 'settings';
    const pages = (app.PAGES || []).filter((d) => d && d.id && d.id !== 'settings' && FF.pages[d.id] && typeof FF.pages[d.id].render === 'function'
      && !(d.adminOnly && !A.isAdmin()) && (!d.perm || A.can(d.perm)));
    const found = []; const failed = []; const stats = [];
    applyAttrRepairs(document);
    for (let i = 0; i < pages.length; i++) {
      const def = pages[i];
      if (onProgress) onProgress(i + 1, pages.length, def);
      try {
        const t0 = Date.now();
        app.navigate(def.id, {});
        await new Promise((r) => setTimeout(r, 900));   // render + layout settle
        const ms = Date.now() - t0;
        const main = (typeof document !== 'undefined' && (document.getElementById('main') || document.body)) || null;
        let nodes = 0, chars = 0;
        try { nodes = main ? (main.querySelectorAll ? main.querySelectorAll('*').length : 0) : 0; } catch { nodes = 0; }
        try { chars = main ? String(main.innerHTML || '').length : 0; } catch { chars = 0; }
        stats.push({ page: def.id, label: def.label || def.id, ms, nodes, chars });
        const pageFindings = scanDomDiagnostics();
        diagSelfKpiFindings(pageFindings, def.label || def.id);
        found.push(...pageFindings);
      } catch (err) { failed.push({ page: def.id, label: def.label || def.id, error: err && err.message ? err.message : String(err) }); }
    }
    diagnosticState.pageStats = stats;
    diagDataHealthFindings(found);
    diagPageWeightFindings(found, stats);
    if (startPage) { app.navigate(startPage, startPage === 'settings' ? { tab: 'diagnostics' } : {}); await new Promise((r) => setTimeout(r, 700)); }
    return { found, failed, pages: pages.length, stats };
  }

  function diagnosticsTab() {
    const prefs = speedPrefs();
    return `${section('🩺 Site diagnostics & safe repair — sab kuch yahin se', '<p>Ek hi button se poora site check hota hai: rendered pages, KPI cards (click hijack samet), links/actions, accessibility, page speed/DOM weight, data health aur available FF source totals. Safe issues <b>Fix</b> se SITE-WIDE repair ho jaate hain (localStorage rule — reload/page change ke baad bhi lagu, attribute rules har re-render par apne aap dobara lagte hain). EIR/REPORT mismatch ko browser me fake nahi kiya jayega.</p><div class="diag-scope"><span>🔎 UI: site shell + current page + open drawers</span><span>🃏 KPI: card ka click sahi handler ko jaata hai ya nahi</span><span>🗂️ Data: FF EIR daily/class vs REPORT + Unusual Activity tag scan health</span><span>🐢 Speed: per-page render ms + DOM weight</span><span>♿ A11y: labels, alt text, hit areas</span></div><div class="btn-row wrap"><button class="btn primary" id="diag-scan">🩺 Scan is page</button><button class="btn" id="diag-scan-all">🌐 Scan every page</button><button class="btn" id="diag-fix-all" disabled>🛠 Fix all safe</button><button class="btn" id="diag-parity">🔬 Card ↔ drawer parity test</button><span class="dim small" id="diag-status">Abhi scan nahi hua</span></div><div class="diag-toolbar" id="diag-toolbar" hidden><div class="btn-row wrap"><select class="input" id="diag-filter-sev" title="Severity filter"></select><select class="input" id="diag-filter-cat" title="Category filter"></select><select class="input" id="diag-group" title="Grouping"></select><input class="input" id="diag-search" type="search" placeholder="🔍 findings me dhoondho (page, selector, reason)"><button class="btn small" id="diag-export-csv" title="Visible findings CSV">⬇ CSV</button><button class="btn small" id="diag-export-json" title="Visible findings JSON">⬇ JSON</button><button class="btn small" id="diag-copy" title="Visible findings clipboard par">📋 Copy</button></div></div><div id="diag-parity-out" class="diag-parity"></div><div id="diag-results" class="diag-results"></div><div id="diag-history" class="diag-history"></div>', 'Safe UI fixes apply hote hi rescan karo; source/data findings ko sheet mapping se repair karo.')}`
    + section('🐢 Page speed & DOM weight', '<div id="diag-page-stats"><p class="dim small">🌐 "Scan every page" chalao → har page ka render time, DOM nodes aur HTML weight yahan aayega.</p></div>', 'Bhaari page = slow click/scroll. Caps, chunked rendering aur ⚡ Speed doctor prefs se theek hota hai.')
    + section('⚡ Speed doctor — apni site ko turant halka karo', `<p>Ye prefs isi browser me save hote hain aur <b>boot par turant</b> lagu hote hain (app.js hook). Purane/slow device par sabse pehla farq "Animations band" se dikhta hai.</p>
      <div class="pref-list">${SPEED_PREF_DEFS.map((d) => `<label class="pref-row"><input type="checkbox" data-speed-pref="${esc(d.key)}"${prefs[d.key] ? ' checked' : ''}><span><b>${esc(d.label)}</b><br><small class="dim">${esc(d.hint)}</small></span></label>`).join('')}</div>
      <div class="btn-row wrap"><button class="btn small" id="speed-reset-prefs">↺ Speed prefs reset</button><span class="dim small" id="speed-pref-note">${Object.keys(prefs).filter((k) => prefs[k]).length ? `Active: ${Object.keys(prefs).filter((k) => prefs[k]).join(', ')}` : 'Koi pref active nahi'}</span></div>`, 'Prefs sirf performance ke liye hain — data/reporting par koi asar nahi.')
    + speedCard();
  }

  // ---- ⚡ Speed / "site slow kyun hai" — exact reason (server query timings) ----------------------
  function speedCard() {
    return section('⚡ Speed · site slow kyun hai (exact reason)', `
      <p>Yahan <b>server ke Google Sheets queries</b> ka asli time dikhta hai: kaunsi query kitni baar chali, cache se kitni baar mili
      aur Google se aane me kitne ms lage. Sabse upar wali slow query hi aapki site ko slow karti hai.</p>
      <div class="btn-row"><button class="btn primary" id="speed-load">⚡ Abhi check karo</button>
      <button class="btn" id="speed-fresh">↻ Queries fresh karo (cache bypass)</button>
      <span class="dim small" id="speed-note">Login ke baad Home khulte hi ye numbers bhar jaate hain.</span></div>
      <div id="speed-out"><p class="dim small">Check karo → slowest Google queries, cache hit rate aur warm queries.</p></div>`);
  }
  async function loadSpeedCard(body) {
    const out = U.$('#speed-out', body); if (!out) return;
    const note = U.$('#speed-note', body);
    out.innerHTML = U.spinner('Server se query timings aa rahi hain…');
    try {
      const res = await A.api('/api/perf');
      const perf = res.perf || {};
      const slow = (perf.slowest || []).slice(0, 12);
      const hitPct = (() => {
        const q = perf.queries || [];
        const calls = q.reduce((a, x) => a + x.calls, 0), hits = q.reduce((a, x) => a + x.cacheHits, 0);
        return calls ? Math.round((hits / calls) * 100) : 0;
      })();
      out.innerHTML = `<div class="diag-scope"><span>🗄️ Cache: <b>${U.fmt(perf.cacheEntries || 0)}</b>/${U.fmt(perf.cacheEntriesMax || 0)} entries · TTL ${esc(String(perf.cacheSeconds || 0))}s</span><span>⚡ Cache hit rate: <b>${hitPct}%</b></span><span>🔥 Warm queries: <b>${U.fmt(perf.warmedQueries || 0)}</b></span></div>
        ${slow.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Google query (sheet · query)</th><th class="num">Calls</th><th class="num">Cache hits</th><th class="num">Google (upstream)</th><th class="num">Avg ms</th><th class="num">Max ms</th></tr></thead><tbody>${slow.map((q) => `<tr><td><code class="wrap">${esc(q.key)}</code></td><td class="num">${U.fmt(q.calls)}</td><td class="num">${U.fmt(q.cacheHits)}</td><td class="num">${U.fmt(q.upstream)}</td><td class="num"><b>${U.fmt(q.avgMs)}</b></td><td class="num">${U.fmt(q.maxMs)}</td></tr>`).join('')}</tbody></table></div>
        <p class="dim small">Sabse upar wali row sabse slow query hai — <b>avg ms</b> zyada = wahin bottleneck. Ye aam taur par badi tab (EIR / StockDataa) par naya column, formula ya poori-tab scan wali query hoti hai.</p>`
        : '<p class="dim small">Abhi tak koi Google query record nahi hui — Home/Trend kholo, phir dobara check karo.</p>'}
        ${(perf.hotQueries || []).length ? `<details><summary class="dim small">🔥 Sabse zyada hit hone wali queries (${perf.hotQueries.length})</summary><div class="table-wrap"><table class="tbl compact"><tbody>${perf.hotQueries.map((h) => `<tr><td>${U.fmt(h.hits)}×</td><td><code class="wrap">${esc(h.url)}</code></td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
      if (note) note.textContent = `Last check ${U.timeLabel(Date.now())} · version ${perf.version || ''}`;
    } catch (err) {
      out.innerHTML = U.errorBox(err);
    }
  }
  function bindSpeedCard(body) {
    const btn = U.$('#speed-load', body); if (btn) btn.addEventListener('click', () => U.withButtonBusy(btn, () => loadSpeedCard(body), 'Checking…'));
    const fresh = U.$('#speed-fresh', body);
    if (fresh) fresh.addEventListener('click', () => U.withButtonBusy(fresh, () => loadSpeedCard(body), 'Fresh…'));
  }

  // ---- page ------------------------------------------------------------------------------------
  async function render(root, params) {
    const admin = A.isAdmin();
    if (params.tab && TABS.some((t) => t[0] === params.tab)) tab = params.tab;
    if (!admin && !['account', 'diagnostics'].includes(tab)) tab = 'account';
    const visibleTabs = admin ? TABS : TABS.filter(([k]) => ['account', 'diagnostics'].includes(k));
    root.innerHTML = `<div class="page-head"><div><h1>⚙️ Settings</h1><p class="sub">${admin ? 'Har cheez yahin se modify karo — branding, images, colours, sheet mapping, thresholds, contacts, users & access' : 'Profile, site diagnostics, password aur aapka access'}</p></div></div>
      <div class="card controls"><div class="seg" id="set-tabs">${visibleTabs.map(([k, l]) => `<button class="seg-btn ${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div></div>
      <div id="set-body">${U.spinner('Settings load ho rahi hain…')}</div>`;
    const body = U.$('#set-body', root);
    try { if (admin) await loadSettings(); } catch (err) { body.innerHTML = U.errorBox(err); return; }
    const draw = async () => {
      U.$$('#set-tabs .seg-btn', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      history.replaceState(null, '', `#/settings?tab=${tab}`);
      if (tab === 'account') body.innerHTML = accountTab();
      else if (tab === 'diagnostics') body.innerHTML = diagnosticsTab();
      else if (tab === 'sound') { body.innerHTML = soundTab(); bindSoundTab(body, draw); }
      else if (tab === 'brand') body.innerHTML = brandTab();
      else if (tab === 'sources') body.innerHTML = sourcesTab();
      else if (tab === 'access') { body.innerHTML = U.spinner('Access matrix…'); await accessTab(body); }
      else if (tab === 'data') body.innerHTML = dataTab();
      else if (tab === 'direct') { body.innerHTML = directTab(); void fillDirectPreview(body); }
      else if (tab === 'rules') body.innerHTML = rulesTab();
      else if (tab === 'features') body.innerHTML = featuresTab();
      else if (tab === 'audit') { body.innerHTML = U.spinner('Audit log…'); await auditTab(body); }
      else if (tab === 'links') { body.innerHTML = U.spinner('Personal links…'); await linksTab(body); }
      else if (tab === 'contacts') body.innerHTML = contactsTab();
      else if (tab === 'backup') body.innerHTML = backupTab();
      else if (tab === 'users') { body.innerHTML = U.spinner('Users…'); await usersTab(body); }
      bindTab();
    };
    function bindTab() {
      // 🔔 notification switches notifications.js ke delegated handler se chalte hain;
      // admin ki push diagnostics yahin async load hoti hai.
      if (FF.notifications) void bindNotifications(body);
      // ⚡ Speed card (admin) — exact slow-query reason.
      if (U.$('#speed-load', body)) { bindSpeedCard(body); void loadSpeedCard(body); }
      // 🩺 Site diagnostics — delegated fix actions survive result re-renders.
      const diagScan = U.$('#diag-scan', body);
      const diagFixAll = U.$('#diag-fix-all', body);
      if (diagScan) diagScan.addEventListener('click', () => U.withButtonBusy(diagScan, () => runSiteDiagnostics(body), 'Scanning…'));
      const diagAll = U.$('#diag-scan-all', body);
      if (diagAll) diagAll.addEventListener('click', async () => {
        const status = U.$('#diag-status', body);
        diagAll.disabled = true;
        try {
          diagnosticState.running = true;
          const out = await scanEveryPage((i, n, def) => { if (status) status.textContent = `🌐 ${i}/${n} scan ho raha hai · ${def.label || def.id}…`; });
          // Har page ke findings merge karo (page label ke saath) + route errors bhi finding bana do.
          const merged = out.found;
          out.failed.forEach((f) => merged.push({ id: `route-error-${f.page}`, severity: 'high', category: 'Links / actions', safe: false, page: f.label, selector: `#/${f.page}`, context: `${f.label} render fail`, explanation: f.error, suggestion: 'Us page ka data/module check karo — render ke waqt exception aa raha hai.', fixed: false }));
          diagnosticState.findings = merged;
          diagnosticState.scannedAt = Date.now();
          diagnosticState.running = false;
          diagnosticState.lastAllScanAt = Date.now();
          pushDiagHistory({ at: diagnosticState.scannedAt, scope: `every page (${out.pages})`, total: merged.length, high: merged.filter((f) => f.severity === 'high').length, medium: merged.filter((f) => f.severity === 'medium').length, low: merged.filter((f) => f.severity === 'low').length, repairs: repairRules().length + attrRepairRules().length });
          body.innerHTML = diagnosticsTab();
          bindTab();
          renderDiagnosticResults(body);
          renderPageStats(body);
          const after = U.$('#diag-status', body);
          if (after) after.textContent = `${merged.length} findings · ${out.pages} pages scanned · ${U.timeLabel(diagnosticState.scannedAt)}`;
          U.toast(`🌐 ${out.pages} pages scan ho gaye — ${merged.length} findings${out.failed.length ? ` · ${out.failed.length} page render fail` : ''}`, merged.length ? 'warn' : 'ok');
        } catch (err) {
          diagnosticState.running = false; diagAll.disabled = false;
          U.toast(err.message || 'Site scan fail hua', 'err');
        }
      });
      if (diagFixAll) diagFixAll.addEventListener('click', () => {
        const safe = (diagnosticState.findings || []).filter((f) => f.safe && !f.fixed);
        safe.forEach(applyDiagnosticFix);
        renderDiagnosticResults(body);
        if (safe.length) { U.toast(`${safe.length} safe UI fixes apply ho gaye — rescan ho raha hai ✓`, 'ok'); void runSiteDiagnostics(body); }
      });
      // 🩺 v3.37 — parity probe, filters/search/group, exports, page stats aur Speed doctor prefs.
      const diagParity = U.$('#diag-parity', body);
      if (diagParity) diagParity.addEventListener('click', () => U.withButtonBusy(diagParity, async () => {
        const results = await runCardParityProbe(body);
        const bad = (results || []).filter((r) => !r.ok);
        renderDiagnosticResults(body);
        U.toast(bad.length ? `🔬 ${bad.length} card(s) ka number drawer me nahi mila — findings me dekho` : `🔬 ${(results || []).length} cards verify — sab exact match ✅`, bad.length ? 'warn' : 'ok');
      }, 'Testing…'));
      const onFilter = () => renderDiagnosticResults(body);
      const fSev = U.$('#diag-filter-sev', body); if (fSev) fSev.addEventListener('change', () => { diagView.sev = fSev.value || 'all'; onFilter(); });
      const fCat = U.$('#diag-filter-cat', body); if (fCat) fCat.addEventListener('change', () => { diagView.cat = fCat.value || 'all'; onFilter(); });
      const fGrp = U.$('#diag-group', body); if (fGrp) fGrp.addEventListener('change', () => { diagView.group = fGrp.value || 'none'; onFilter(); });
      const fSearch = U.$('#diag-search', body);
      if (fSearch) fSearch.addEventListener('input', U.debounce(() => { diagView.q = fSearch.value || ''; onFilter(); }, 220));
      const exp = (kind, btn, label) => { if (!btn) return; btn.addEventListener('click', () => { const n = diagExport(kind); U.toast(`${label}: ${n} findings export hue ✓`, 'ok'); }); };
      exp('csv', U.$('#diag-export-csv', body), 'CSV');
      exp('json', U.$('#diag-export-json', body), 'JSON');
      exp('copy', U.$('#diag-copy', body), 'Clipboard');
      const prefNote = U.$('#speed-pref-note', body);
      U.$$('[data-speed-pref]', body).forEach((cb) => cb.addEventListener('change', () => {
        const next = setSpeedPref(cb.dataset.speedPref, cb.checked);
        if (prefNote) { const active = Object.keys(next).filter((k) => next[k]); prefNote.textContent = active.length ? `Active: ${active.join(', ')}` : 'Koi pref active nahi'; }
        U.toast(cb.checked ? '⚡ Pref ON — reload ke baad bhi lagu rahega' : 'Pref OFF', 'ok');
      }));
      const speedReset = U.$('#speed-reset-prefs', body);
      if (speedReset) speedReset.addEventListener('click', () => {
        try { localStorage.removeItem(LS_SPEED_PREFS); } catch { /* ignore */ }
        applySpeedPrefs({});
        body.innerHTML = diagnosticsTab(); bindTab(); renderDiagnosticResults(body); renderPageStats(body);
        U.toast('↺ Speed prefs reset ho gaye', 'warn');
      });
      applyAttrRepairs(body);
      startAttrRepairWatcher();
      renderPageStats(body);
      // account
      // 🛡️ My access cards — locked cards par toast + live data summary (sirf in-memory, no network).
      U.$$('[data-acc-locked]', body).forEach((b) => b.addEventListener('click', () => U.toast(`⛔ "${b.dataset.accLocked}" ke liye access chahiye — admin se Settings → Users me enable karwao.`, 'err')));
      try {
        const aStats = accStats();
        U.$$('[data-acc-sum]', body).forEach((el) => { const t = accSummaryFor(el.dataset.accSum, aStats); if (t) el.textContent = t; else el.remove(); });
      } catch { /* summary optional */ }
      const presenceShare = U.$('#presence-share-toggle', body);
      if (presenceShare) presenceShare.addEventListener('change', () => { localStorage.setItem('ff_presence_pointer', presenceShare.checked ? '1' : '0'); if (FF.app.liveShareChip) FF.app.liveShareChip(); if (!presenceShare.checked && FF.auth.user.role !== 'admin') FF.auth.api('/api/presence', 'POST', { page: 'settings', pointer: null, overlay: '' }).catch(() => {}); });
      const rangeDays = U.$('#ti-range-days', body);
      if (rangeDays) rangeDays.addEventListener('change', () => localStorage.setItem('ti_range_days', rangeDays.value));
      const chartLimit = U.$('#ti-chart-limit', body);
      if (chartLimit) chartLimit.addEventListener('change', () => localStorage.setItem('ti_chart_limit', chartLimit.value));
      // 🎙 Assistant voice & language section (My account)
      if (U.$('#voice-lang', body)) bindVoiceTab(body);
      const pfSave = U.$('#pf-save', body);
      if (pfSave) pfSave.addEventListener('click', () => U.withButtonBusy(pfSave, async () => { try { await A.api('/api/auth/profile', 'POST', { name: U.$('#pf-name', body).value, mobile: U.$('#pf-mobile', body).value, email: U.$('#pf-email', body).value }); U.toast('Profile saved ✓', 'ok'); const me = await A.api('/api/auth/me'); if (me.user) { Object.assign(A.user, me.user); FF.app.renderSidebar(); } } catch (err) { U.toast(err.message, 'err'); } }, 'Saving profile…'));
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
        await U.withButtonBusy(pwSave, async () => {
          try { const out = await A.api('/api/auth/password', 'POST', { current: cur, next: n1 }); Object.assign(A.user, out.user); U.toast('Password updated ✓', 'ok'); await draw(); }
          catch (err) { U.toast(err.message, 'err'); }
        }, 'Updating…');
      });
      // generic save buttons
      U.$$('[data-save]', body).forEach((btn) => btn.addEventListener('click', () => {
        const card = btn.closest('.card');
        const patch = collect(card, {});
        const msg = U.$(`#save-msg-${btn.dataset.save}`, body);
        const reload = ['data', 'eir', 'stock', 'stockMovement', 'ffPayout', 'gvCommissionRates'].includes(btn.dataset.save);
        U.withButtonBusy(btn, () => save(patch, msg, { reload }), 'Saving…');
      }));
      // 📧 Features → email: status chips, pehle save phir test mail, aur 🩺 diagnose
      const emStatus = U.$('#em-status', body);
      const PROV_LABEL = { smtp: '📮 SMTP', appsscript: '🟢 Apps Script (Gmail)', resend: '⚡ Resend', brevo: '📨 Brevo' };
      const drawStatus = async () => {
        if (!emStatus) return;
        try {
          const st = await A.api('/api/notifications/email/status');
          const chips = Object.keys(PROV_LABEL).map((k) => `<span class="badge ${st.providers[k] ? 'green' : 'gray'}">${PROV_LABEL[k]} ${st.providers[k] ? '✓ ready' : '— not set'}</span>`).join(' ');
          const first = (st.order || [])[0];
          emStatus.innerHTML = `${chips}<div class="dim small" style="margin-top:6px">${first ? `Abhi mail is transport se jayegi: <b>${PROV_LABEL[first]}</b>${st.order.length > 1 ? ` (fallback: ${st.order.slice(1).map((k) => PROV_LABEL[k]).join(' → ')})` : ''}` : '⚠️ Koi email transport configured nahi — neeche se ek chuno. Render free par Apps Script sabse aasaan hai.'}</div>`;
        } catch { emStatus.innerHTML = ''; }
      };
      drawStatus();
      const emTest = U.$('#em-test', body);
      if (emTest) emTest.addEventListener('click', async () => {
        const cardEl = emTest.closest('.card');
        await U.withButtonBusy(emTest, async () => {
          // Save ko CONFIRM hone do; pehle test request race karke purani config use kar leti thi.
          const saved = await save(collect(cardEl, {}), U.$('#save-msg-feat-email', body));
          if (!saved) return;
          try {
            const out = await A.api('/api/notifications/email/test', 'POST', {});
            U.toast(`📧 Test email gaya (${PROV_LABEL[out.provider] || out.provider || 'email'}). Inbox/spam check karo.`, 'ok');
          } catch (err) {
            U.toast(err.message, 'err');
            const box = U.$('#em-diag-out', body); if (box) { box.hidden = false; box.innerHTML = `<div class="mail-diag-err">❌ ${esc(err.message)}</div><div class="dim small">🩺 Diagnose dabao — pata chalega SMTP port block hai ya credentials galat.</div>`; }
          }
          drawStatus();
        }, 'Saving + testing email…');
      });
      const emDiag = U.$('#em-diag', body);
      if (emDiag) emDiag.addEventListener('click', async () => {
        const cardEl = emDiag.closest('.card');
        await U.withButtonBusy(emDiag, async () => {
          const saved = await save(collect(cardEl, {}), U.$('#save-msg-feat-email', body));
          if (!saved) return;
          const box = U.$('#em-diag-out', body);
          try {
            const d = await A.api('/api/notifications/email/diagnose', 'POST', {});
            box.hidden = false;
            box.innerHTML = `<div class="mail-diag-list">${d.checks.map((c) => `<div class="${c.ok ? 'ok' : 'bad'}"><span>${c.ok ? '✅' : '❌'}</span><b>${esc(c.name)}</b><small>${esc(c.detail || '')}</small></div>`).join('')}</div>${d.advice.length ? `<div class="mail-diag-advice">${d.advice.map((t) => `<p>💡 ${esc(t)}</p>`).join('')}</div>` : ''}`;
          } catch (err) { box.hidden = false; box.innerHTML = `<div class="mail-diag-err">❌ ${esc(err.message)}</div>`; }
          drawStatus();
        }, 'Diagnosing…');
      });
      // 📢 Announcement broadcast (featuresTab)
      const anSend = U.$('#an-send', body);
      if (anSend) anSend.addEventListener('click', async () => {
        const text = (U.$('#an-text', body).value || '').trim();
        if (!text) return U.toast('Pehle message likho', 'err');
        anSend.disabled = true;
        try {
          await A.api('/api/announcements', 'POST', { text });
          U.$('#an-text', body).value = '';
          U.$('#an-msg', body).textContent = 'Broadcast bhej diya ✓';
          U.toast('📢 Announcement sabko bhej diya', 'ok');
        } catch (err) { U.toast(err.message, 'err'); }
        finally { anSend.disabled = false; }
      });
      // 🗓 Custom alert scheduler (featuresTab)
      const scWhen = U.$('#sc-when', body);
      if (scWhen) {
        const fillWhen = () => {
          const kind = U.$('#sc-kind', body).value;
          const hours = (pfx) => `<optgroup label="Hour (IST)">${Array.from({ length: 24 }, (_, h) => `<option value="${pfx}${h}">${String(h).padStart(2, '0')}:00</option>`).join('')}</optgroup>`;
          if (kind === 'daily') scWhen.innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, '0')}:00 IST</option>`).join('');
          else if (kind === 'weekly') scWhen.innerHTML = ['Ravivar', 'Somwar', 'Mangalwar', 'Budhwar', 'Guruwar', 'Shukrawar', 'Shanivar'].map((d, i) => `<option value="w${i}">${d}</option>`).join('') + hours('wh');
          else scWhen.innerHTML = Array.from({ length: 28 }, (_, i) => `<option value="d${i + 1}">Tareekh ${i + 1}</option>`).join('') + hours('dh');
        };
        fillWhen();
        U.$('#sc-kind', body).addEventListener('change', fillWhen);
        const schedsNow = () => (settings && Array.isArray(settings.schedules)) ? settings.schedules : [];
        const saveScheds = async (list, btn) => {
          if (btn) btn.disabled = true;
          try {
            const out = await A.api('/api/settings', 'PUT', { schedules: list });
            if (out.settings) settings = out.settings;
            const box = U.$('#sched-list', body);
            if (box) box.innerHTML = schedListHtml((settings && settings.schedules) || []);
            return true;
          } catch (err) { U.toast(err.message, 'err'); return false; }
          finally { if (btn) btn.disabled = false; }
        };
        const parseWhen = (kind, val) => {
          if (kind === 'weekly') return { weekday: Number((String(val).match(/^w(\d+)/) || [])[1] || 0), hour: Number((String(val).match(/wh(\d+)/) || [])[1] || 9) };
          if (kind === 'monthly') return { day: Number((String(val).match(/^d(\d+)/) || [])[1] || 1), hour: Number((String(val).match(/dh(\d+)/) || [])[1] || 9) };
          return { hour: Number(val) || 9 };
        };
        const scAdd = U.$('#sc-add', body);
        if (scAdd) scAdd.addEventListener('click', async () => {
          const title = (U.$('#sc-title', body).value || '').trim();
          const text = (U.$('#sc-text', body).value || '').trim();
          const kind = U.$('#sc-kind', body).value;
          if (!title || !text) return U.toast('Title + message dono chahiye', 'err');
          const sched = { id: `sc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title, text, kind, ...parseWhen(kind, scWhen.value), target: U.$('#sc-target', body).value, enabled: true };
          if (await saveScheds([...schedsNow(), sched], scAdd)) {
            U.$('#sc-title', body).value = ''; U.$('#sc-text', body).value = '';
            U.toast('🗓 Schedule add ho gaya ✓', 'ok');
          }
        });
        U.$$('#sched-list .sc-fire', body).forEach((b) => b.addEventListener('click', async () => {
          b.disabled = true;
          try { const out = await A.api(`/api/schedules/${encodeURIComponent(b.dataset.id)}/fire`, 'POST', {}); U.toast(out.ok ? '▶️ Notification bhej di ✓' : 'Kuch nahi hua', out.ok ? 'ok' : 'warn'); }
          catch (err) { U.toast(err.message, 'err'); } finally { b.disabled = false; }
        }));
        U.$$('#sched-list .sc-tog', body).forEach((b) => b.addEventListener('click', async () => {
          const list = schedsNow().map((s) => s.id === b.dataset.id ? { ...s, enabled: s.enabled === false } : s);
          await saveScheds(list, b);
        }));
        U.$$('#sched-list .sc-del', body).forEach((b) => b.addEventListener('click', async () => {
          if (!window.confirm('Schedule delete karein?')) return;
          await saveScheds(schedsNow().filter((s) => s.id !== b.dataset.id), b);
        }));
      }
      const chFire = U.$('#ch-fire', body);
      if (chFire) chFire.addEventListener('click', async () => {
        chFire.disabled = true;
        try { const out = await A.api('/api/notifications/champion-email', 'POST', {}); U.toast(out.ok ? `🥇 Champion email gaya — ${out.month} · ${(out.top || []).join(', ')}` : 'Kuch nahi hua', out.ok ? 'ok' : 'warn'); }
        catch (err) { U.toast(err.message, 'err'); } finally { chFire.disabled = false; }
      });
      const fuFire = U.$('#fu-fire', body);
      if (fuFire) fuFire.addEventListener('click', () => U.withButtonBusy(fuFire, async () => {
        try { const out = await A.api('/api/followup?fire=1'); U.toast(out.fired ? `⏰ ${out.list.length} silent agents — notification bhej di` : (out.list && out.list.length ? `⏰ ${out.list.length} silent agents (alert pehle ja chuka tha)` : 'Sab active hain — koi silent nahi'), 'ok'); }
        catch (err) { U.toast(err.message, 'err'); }
      }, 'Checking…'));
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
      const movementTpl = U.$('#movement-template', body);
      if (movementTpl) movementTpl.addEventListener('click', () => {
        const csv = 'Date,Channel,Type,Quantity,Class,From,To,Reference,Note\r\n2026-09-01,First Forward,IN,500,VC4,Warehouse,Field,GRN-001,Received stock\r\n2026-09-02,GV Partner,TRANSFER,50,VC4,Agent A,Agent B,TR-001,Internal transfer — net zero\r\n2026-09-03,First Forward,ADJUSTMENT,-2,VC4,Field,,ADJ-001,Damaged tags';
        U.downloadBlob('stock-movements-template.csv', new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
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
        if (msgEl) msgEl.textContent = 'Saving… server confirmation ka wait hai';
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
      if (tabsSave) tabsSave.addEventListener('click', () => U.withButtonBusy(tabsSave, () => saveTabsHandler(U.$('#tabs-msg', body)), 'Saving + syncing…'));
      const rangeSaveBtn = U.$('#range-save-btn', body);
      if (rangeSaveBtn) rangeSaveBtn.addEventListener('click', () => U.withButtonBusy(rangeSaveBtn, () => saveTabsHandler(null), 'Saving + syncing…'));

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
      if (ex) ex.addEventListener('click', () => { const s = { ...settings }; U.downloadBlob(`ff-settings-${U.stamp()}.json`, new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' })); // ☁️ reminder ke liye server par timestamp (changeList skip karta hai — koi notification nahi)
        A.api('/api/settings', 'PUT', { settings: { lastBackupAt: new Date().toISOString() } }).then((out) => { settings = JSON.parse(JSON.stringify(out.settings)); }).catch(() => {}); });
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

  FF.pages.settings = {
    title: 'Settings', render,
    diagnostics: {
      scanDom: scanDomDiagnostics, state: diagnosticState,
      applyFix: applyDiagnosticFix, repairs: repairRules, clearRepairs: () => { writeRepairs([]); writeAttrRepairs([]); },
      stableSelector: diagStableSelector, repairCss: REPAIR_CSS, saved: repairSaved,
      // v3.37 — attribute repairs (data-kpi-self), speed prefs, per-page stats, history, exports, parity probe
      attrFix: ATTR_FIX, attrRepairs: attrRepairRules, applyAttrRepairs, clearAttrRepairs: () => writeAttrRepairs([]),
      selfKpiAttrs: SELF_KPI_ATTRS, scanSelfKpi: diagSelfKpiFindings, dataHealth: diagDataHealthFindings,
      speedPrefs, setSpeedPref, applySpeedPrefs, speedPrefDefs: SPEED_PREF_DEFS,
      pageStats: () => diagnosticState.pageStats || [], history: diagHistory,
      visibleFindings: diagVisibleFindings, view: diagView, export: diagExport,
      probeParity: runCardParityProbe, runSite: runSiteDiagnostics, scanEveryPage, renderResults: renderDiagnosticResults
    }
  };
})(window.FF);
