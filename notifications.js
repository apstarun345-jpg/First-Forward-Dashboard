/* In-app notification centre + browser / mobile push alerts.
   - In-app bell feed (polling) with per-type on/off preferences
   - Tab visible → toast; tab background → browser notification; PWA installed on mobile → OS notification panel (vibration + sound)
   - Sound toggle (Web Audio beep for in-app toasts; Vibration API for mobile pushes)
   - "📱 Enable mobile notifications" guide — Android Chrome + iOS Safari (16.4+) PWA install ke baad push chalta hai
*/
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const NOTIFY_TYPES = [
    // Non-admin relevant types (user ko apne hisse ke alerts):
    { key: 'login',    label: '🔐 Login / welcome',       user: true,  admin: true },
    { key: 'monthly',  label: '📅 Monthly auto report',    user: true,  admin: true },
    { key: 'user',     label: '👤 Account / security',     user: true,  admin: true },
    { key: 'info',     label: 'ℹ️ Info / updates',         user: true,  admin: true },
    // Admin-only activity types (sab users ki activity admin ko hi milti hai):
    { key: 'signup',   label: '🆕 New account signup',     user: false, admin: true },
    { key: 'report',   label: '📊 Report data update',     user: false, admin: true },
    { key: 'activity', label: '👀 User page opens',        user: false, admin: true },
    { key: 'click',    label: '👆 Button / option use',    user: false, admin: true },
    { key: 'search',   label: '🔍 Searches',               user: false, admin: true },
    { key: 'settings', label: '⚙️ Settings changes',       user: false, admin: true },
    { key: 'location', label: '📍 Location shares',        user: false, admin: true }
  ];
  const DEFAULT_PREFS = { login: true, signup: true, report: true, monthly: true, activity: true, click: false, search: true, settings: true, user: true, location: false, info: true, sound: true, push: true };
  const state = { started: false, bound: false, timer: null, presenceTimer: null, fastTimer: null, lastAt: '', items: [], unread: 0, firstPoll: true, page: 'home', pointer: null, people: [], lastInteraction: Date.now(), pointerBound: false, events: [], dirty: false, lastSent: 0, lastScroll: -1, pushOn: false, pushDevices: 0, pushStatus: null, pushTriedAt: 0, pushError: '', prefs: { ...DEFAULT_PREFS }, audioCtx: null };
  const EMBED = new URLSearchParams(location.search).get('embed') === 'live';
  const sharing = () => localStorage.getItem('ff_presence_pointer') !== '0';

  function hasAccess() {
    const u = FF.auth && FF.auth.user;
    if (!u) return false;
    if (u.role === 'admin') return true;
    return u.notifyAccess !== false;
  }
  function syncBellVisibility() {
    const btn = U.$('#notification-btn'), wrap = btn && btn.closest('.notification-wrap');
    if (wrap) wrap.hidden = !hasAccess();
  }
  function loadPrefsLocal() {
    try {
      const raw = localStorage.getItem('ff_notify_prefs');
      if (raw) { const p = JSON.parse(raw); state.prefs = { ...DEFAULT_PREFS, ...p }; return; }
    } catch { /* ignore */ }
    // Fall back from legacy sound key
    const oldSound = localStorage.getItem('ff_notify_sound');
    if (oldSound !== null) state.prefs.sound = oldSound !== '0';
  }
  function savePrefsLocal() { try { localStorage.setItem('ff_notify_prefs', JSON.stringify(state.prefs)); } catch {} }
  async function loadPrefs() {
    loadPrefsLocal();
    syncBellVisibility();
    if (!hasAccess()) return;
    try {
      const out = await FF.auth.api('/api/notifications/prefs');
      if (out && out.prefs) state.prefs = { ...DEFAULT_PREFS, ...out.prefs };
      savePrefsLocal();
    } catch { /* pre-login ya offline: local prefs hi kaam karenge */ }
  }
  async function savePrefs(patch, silent) {
    state.prefs = { ...state.prefs, ...patch };
    savePrefsLocal();
    try { await FF.auth.api('/api/notifications/prefs', 'PUT', { prefs: state.prefs }); } catch { /* retry next poll */ }
    if (!silent) U.toast('Notification preferences saved ✓', 'ok');
    render();
  }

  // ---- 🔊 in-app sound (Web Audio beep — 880Hz, 200ms, works without asset file) -----------------
  function beep() {
    if (state.prefs.sound === false) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!state.audioCtx) state.audioCtx = new Ctx();
      const ctx = state.audioCtx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.24);
      // Mobile ke liye vibration bhi (jab tab foreground hai)
      if (navigator.vibrate) try { navigator.vibrate([80, 40, 80]); } catch {}
    } catch { /* iOS/Safari may block without user gesture — silent fail */ }
  }
  function unlockAudio() {
    // Pehle user gesture par AudioContext unlock (mobile Safari / Chrome requirement)
    if (state.audioCtx && state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(() => {});
    document.removeEventListener('pointerdown', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
  }

  // ---- icon / helpers ----------------------------------------------------------------------------
  function icon(item) {
    return ({ report: '📊', monthly: '📅', login: '🔐', activity: '👀', location: '📍', search: '🔍', click: '👆', settings: '⚙️', user: '👤', info: 'ℹ️' }[item.type] || '🔔');
  }
  function canBrowserAlert() { return typeof Notification !== 'undefined' && Notification.permission === 'granted'; }
  function isInstalledPWA() {
    return window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || window.navigator.standalone === true);
  }
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }
  async function browserAlert(item) {
    if (!item) return;
    // Per-type preference check
    if (state.prefs[item.type] === false) return;
    if (document.visibilityState === 'visible') {
      if (U && U.toast) {
        U.toast(`${icon(item)} ${item.title}`, 'info');
        beep();
      }
      return;
    }
    if (!canBrowserAlert()) return;
    const title = `${icon(item)} ${item.title}`;
    const options = {
      body: item.body || '',
      icon: FF.config.logo || 'icon-192.png',
      badge: 'icon-192.png',
      tag: item.type || 'ff-notification',
      renotify: true,
      vibrate: state.prefs.sound !== false ? [200, 100, 200] : undefined,
      data: { link: (item.meta && item.meta.link) || '' }
    };
    // iOS Safari/PWA me `new Notification()` allowed nahi hai — service worker se dikhao.
    // Android/desktop par bhi SW wala raasta zyada reliable hai (panel me hi aata hai).
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        if (state.prefs.sound !== false && navigator.vibrate) try { navigator.vibrate([200, 100, 200]); } catch {}
        return;
      }
    } catch { /* fall through to the page-level constructor */ }
    try {
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); n.close(); };
      if (state.prefs.sound !== false && navigator.vibrate) try { navigator.vibrate([200, 100, 200]); } catch {}
    } catch { /* private mode / unsupported */ }
  }
  function setCount(n) {
    state.unread = Math.max(0, Number(n) || 0);
    const badge = U.$('#notification-count');
    if (badge) { badge.textContent = state.unread > 99 ? '99+' : String(state.unread); badge.hidden = state.unread < 1; }
    // Favicon / title badge for unread
    const t = (FF.config && FF.config.appName) || document.title.replace(/\s*\(\d+\)\s*/, '');
    document.title = state.unread > 0 ? `(${state.unread}) ${t}` : t;
  }
  function latestTime(items) { return (items || []).reduce((max, x) => !max || x.createdAt > max ? x.createdAt : max, ''); }

  // ---- render ------------------------------------------------------------------------------------
  function render() {
    const pop = U.$('#notification-pop');
    if (!pop) return;
    const browser = typeof Notification !== 'undefined';
    const permission = browser ? Notification.permission : 'unsupported';
    const pwa = isInstalledPWA();
    const canPush = 'serviceWorker' in navigator && 'PushManager' in window;

    // 📲 Mobile / OS notification panel status.
    // Pehle ka order galat tha: "app install nahi hai" wali hint sabse pehle match ho jaati thi,
    // isliye bina-PWA-install mobile Chrome par ENABLE button kabhi dikhta hi nahi tha — user chahe
    // permission de bhi de, push subscribe hone ka raasta hi nahi tha. Ab har case me action dikhta hai.
    const st = state.pushStatus || {};
    const lastError = st.lastError ? `Aakhri push fail: <b>${U.esc(String(st.lastError.status || 'network'))}</b>${st.lastError.error ? ` — ${U.esc(String(st.lastError.error).slice(0, 90))}` : ''}` : '';
    const deviceLine = state.pushOn ? `<small>${state.pushDevices || st.subs || 1} device registered${st.lastOk ? ` · last delivery ${U.esc(U.timeLabel(new Date(st.lastOk.at).getTime()))}` : ''}</small>` : '';
    const testBtns = `<div class="notify-push-actions"><button class="btn small" data-notify-panel-test title="Phone ke notification panel me ek test alert bhejo">📳 Panel test</button><button class="btn small" data-notify-push-test title="Server se is device par real push bhejo">🛰 Server push test</button></div>`;
    let pushCard = '';
    if (!canPush) {
      pushCard = `<div class="notification-permission warn">⚠️ Is browser me push notifications support nahi. Chrome / Edge / Samsung Internet (Android) ya Safari iOS 16.4+ use karo.</div>`;
    } else if (permission === 'denied') {
      pushCard = `<div class="notification-permission warn">🚫 Browser notifications blocked hain — browser/padlock settings se allow karo, phir yahan "Dobara on karo" dabao.</div>`;
    } else if (permission !== 'granted') {
      // iOS par push sirf installed PWA me chalta hai — Android/desktop browser tab me bhi chalega.
      const iosHint = isIOS() && !pwa ? '<div class="notification-permission warn">📱 iOS: pehle Safari → Share → "Add to Home Screen" se app install karo, phir ye button dabao.</div>' : '';
      const installHint = !pwa && !isIOS() ? '<div class="notification-permission hint">💡 "Install app" karne par app band hone ke baad bhi alerts milte rahenge (background push).</div>' : '';
      pushCard = `${iosHint}<button class="notification-enable" data-notify-enable>📲 Mobile notifications on karo — app band ho tab bhi panel me aayengi</button>${installHint}`;
    } else if (!state.pushOn) {
      // Permission granted hai lekin subscription nahi bani (key rotate, service worker, ya server drop)
      pushCard = `<div class="notification-permission warn">⚠️ Permission mil gayi hai par push subscription active nahi${state.pushError ? ` — ${U.esc(state.pushError)}` : ''}. ${lastError}</div>
        <button class="notification-enable" data-notify-enable>🔁 Push dobara on karo</button>${!pwa && !isIOS() ? '<div class="notification-permission hint">💡 App install nahi hai — "Install app" ke baad background push sabse reliable chalta hai.</div>' : ''}${testBtns}`;
    } else {
      pushCard = `<div class="notification-permission ok">✅ Mobile / OS panel push ON hai${pwa ? ' · PWA installed' : ' · browser tab'}</div>${deviceLine}${lastError ? `<div class="notification-permission warn">${lastError}</div>` : ''}${testBtns}`;
    }

    // Sound + master push toggles
    const toggles = `<div class="notify-toggles">
      <label class="check small"><input type="checkbox" data-pref-toggle="sound" ${state.prefs.sound !== false ? 'checked' : ''}> 🔊 Sound / vibration</label>
      <label class="check small"><input type="checkbox" data-pref-toggle="push" ${state.prefs.push !== false ? 'checked' : ''}> 📲 Push notifications (app band ho tab bhi)</label>
    </div>`;

    // Per-type preferences — admin ko sab types (activity + data); normal user ko sirf apne types
    const isAdmin = FF.auth.user && FF.auth.user.role === 'admin';
    const types = NOTIFY_TYPES.filter((t) => isAdmin ? t.admin : t.user);
    const prefsHtml = `<details class="notify-prefs"><summary>⚙️ Notification preferences · konse alerts chahiye?</summary>
      ${isAdmin ? `<div class="notify-pref-hint dim small">👑 Admin ko sab users ki har activity yahan + browser + mobile push pe milti hai. Band kar ke unwanted types hata sakte ho.</div>` : ''}
      <div class="notify-pref-list">
        ${types.map((t) => `<label class="check small"><input type="checkbox" data-pref-toggle="${t.key}" ${state.prefs[t.key] !== false ? 'checked' : ''}> ${t.label}</label>`).join('')}
      </div></details>`;

    const rows = state.items.slice().reverse().slice(0, 60).map((item) => `<button type="button" class="notification-item ${item.type || ''}" data-notify-open="${U.esc(item.id)}" title="Click → poori report: kya change hua">
      <span class="notification-icon">${icon(item)}</span><div><b>${U.esc(item.title)}</b><p>${U.esc(item.body)}</p><small>${U.esc(U.timeLabel(new Date(item.createdAt).getTime()))} · <u>details dekho →</u></small></div></button>`).join('');
    const presence = isAdmin ? `<section class="presence-panel"><div class="presence-title">🟢 User activity <small>Admin only · live / last seen</small></div>${state.people.length ? state.people.map((p) => `<div class="presence-row"><span class="presence-dot ${p.active ? 'is-live' : ''}"></span><div><b>${U.esc(p.name || p.username)}</b><small>${p.active ? `Active now · ${U.esc(p.page)}` : `Last active ${U.esc(U.timeLabel(p.lastSeen))} · last page: ${U.esc(p.page)}`}</small>${p.lastEvent ? `<small>Last action: ${U.esc(p.lastEvent.label || p.lastEvent.kind)}</small>` : ''}</div><span class="presence-side"><span class="presence-state">${p.online && p.active ? 'LIVE' : p.online ? 'IDLE' : 'AWAY'}</span>${isAdmin ? `<button class="btn small" data-live-watch="${U.esc(p.username)}">👁 Live view</button>` : ''}</span></div>`).join('') : '<div class="notification-empty">Users seen after this server started will appear here.</div>'}</section>` : '';
    pop.innerHTML = `<div class="notification-head"><div><b>Notifications</b><small>${state.unread ? `${state.unread} unread` : 'Sab updated hai'}</small></div><div style="display:flex;gap:6px"><button class="btn small" data-notify-test>🔊 Test</button><button class="btn small" data-notify-read>✓ Mark read</button></div></div>
      ${presence}
      ${pushCard}
      ${toggles}
      ${prefsHtml}
      <div class="notification-list">${rows || '<div class="notification-empty">Abhi koi notification nahi. User login/page open, report update aur shared location yahan dikhegi.</div>'}</div>`;
  }

  // ---- polling -----------------------------------------------------------------------------------
  async function poll(initial) {
    if (!FF.auth || !FF.auth.user) return;
    try {
      const qs = state.lastAt && !initial ? `?since=${encodeURIComponent(state.lastAt)}` : '';
      const out = await FF.auth.api(`/api/notifications${qs}`);
      const incoming = Array.isArray(out.items) ? out.items : [];
      const known = new Set(state.items.map((x) => x.id));
      const fresh = incoming.filter((x) => !known.has(x.id) && state.prefs[x.type] !== false);
      if (!initial) fresh.forEach(browserAlert);
      state.items = [...state.items, ...incoming].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i).slice(-100);
      state.lastAt = latestTime(state.items) || out.checkAt || state.lastAt;
      setCount(out.unread);
      if (FF.auth.user && FF.auth.user.role === 'admin') {
        try { const live = await FF.auth.api('/api/presence'); state.people = Array.isArray(live.people) ? live.people : []; } catch { /* older server */ }
      }
      render();
    } catch (err) {
      if (err && err.status === 401) stop();
    } finally { state.firstPoll = false; }
  }

  // ---- push subscribe ----------------------------------------------------------------------------
  function urlB64ToUint8(str) {
    const pad = '='.repeat((4 - (str.length % 4)) % 4);
    const b = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  function bytesToB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  /**
   * Server se aayi VAPID public key ko browser-ready 65-byte uncompressed P-256 point banao.
   * Chrome/Edge sirf raw point (0x04 || X || Y) accept karte hain — kisi bhi wajah se SPKI DER
   * (91 bytes) ya usse bada blob aaye to raw point uske andar hota hai (aakhri 65 bytes), nikal lo.
   * Iske bina subscribe "The provided applicationServerKey is not valid" se fail hota hai.
   */
  function vapidKeyBytes(str) {
    let bytes = urlB64ToUint8(String(str || '').trim());
    if (bytes.length > 65) {
      const tail = bytes.slice(bytes.length - 65);
      if (tail[0] === 4) { console.warn('push: server key SPKI-DER format me thi — raw 65-byte point nikal liya'); bytes = tail; }
    }
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error(`VAPID public key invalid (${bytes.length} bytes) — server par key corrupt hai, admin se config check karwao`);
    return bytes;
  }
  /** Existing subscription kis VAPID key se bani thi? (base64url) */
  function subKeyB64(sub) {
    try {
      const k = sub && sub.options && sub.options.applicationServerKey;
      if (!k) return '';
      const bytes = k instanceof Uint8Array ? k : new Uint8Array(k);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch { return ''; }
  }
  /**
   * Service worker registration — `navigator.serviceWorker.ready` kabhi reject nahi hota aur registration
   * fail hone par hamesha ke liye atak jaata hai (purana bug: setupPush chup-chaap hang ho jaata tha).
   * Isliye: registration khud ensure karo + timeout ke saath race karo.
   */
  async function swRegistration(timeoutMs = 12000) {
    if (!('serviceWorker' in navigator)) return null;
    try {
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg && navigator.serviceWorker.register) reg = await navigator.serviceWorker.register('./sw.js');
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
      ]);
      return ready || reg || null;
    } catch (err) {
      console.warn('service worker registration:', err && err.message);
      return null;
    }
  }
  /** Server se current push health (VAPID key + kitne devices registered hain). */
  async function refreshPushStatus() {
    try {
      const out = await FF.auth.api('/api/push/status');
      if (out && typeof out === 'object') {
        state.pushStatus = out;
        state.pushDevices = Number(out.subs || 0);
        if (out.prefsPush === false && state.prefs.push !== false) { state.prefs.push = false; savePrefsLocal(); }
      }
      return state.pushStatus;
    } catch { return null; }
  }
  /**
   * 📲 Web push subscribe — server se instant notifications, app band ho tab bhi, mobile panel me.
   *
   * Self-healing: agar server ki VAPID key badal gayi ho (redeploy) ya server ne dead subscription
   * drop kar di ho (403/410), to purani subscription hata kar nayi banate hain. Warna phone ka
   * notification panel hamesha ke liye silent reh jaata tha jabki in-app bell chalta rehta tha.
   */
  async function setupPush(silent, opts) {
    const force = !!(opts && opts.force);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
        state.pushError = 'is browser me push support nahi';
        return false;
      }
      if (Notification.permission !== 'granted') { state.pushError = 'notification permission granted nahi'; return false; }
      if (state.prefs.push === false && !force) return false;
      const reg = await swRegistration();
      if (!reg || !reg.pushManager) { state.pushError = 'service worker ready nahi hua'; if (!silent) U.toast('Service worker ready nahi hua — push on nahi ho paya. App dobara kholo.', 'warn'); return false; }
      // 1) Server ki current key + registration status
      const status = (await refreshPushStatus()) || {};
      let serverKey = status.publicKey || '';
      if (!serverKey) {
        const v = await FF.auth.api('/api/push/vapid').catch(() => null);
        serverKey = (v && v.publicKey) || '';
      }
      if (!serverKey) { state.pushError = 'server par VAPID key nahi'; return false; }
      // Key ko canonical 65-byte raw point me laao — SPKI DER aane par subscribe crash hota tha.
      let serverKeyBytes;
      try { serverKeyBytes = vapidKeyBytes(serverKey); } catch (err) { state.pushError = (err && err.message) || 'VAPID key invalid'; return false; }
      const serverKeyCanon = bytesToB64url(serverKeyBytes);
      // 2) SW ke paas pending (stash) subscription ho to server ko de do — session ab valid hai
      try { if (reg.active && reg.active.postMessage) reg.active.postMessage({ type: 'ff-push-flush' }); } catch { /* ignore */ }
      // 3) Existing subscription validate karo
      let sub = await reg.pushManager.getSubscription().catch(() => null);
      const serverSubs = typeof status.subs === 'number' ? status.subs : null;
      const keyMismatch = sub && subKeyB64(sub) !== serverKeyCanon;
      const droppedByServer = sub && serverSubs === 0; // server ne dead subscription hata di
      if (sub && (keyMismatch || droppedByServer || force)) {
        if (keyMismatch) console.warn('push: server VAPID key changed — re-subscribing so the OS panel works again');
        if (droppedByServer) console.warn('push: server par ye subscription nahi thi — re-subscribing');
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKeyBytes });
      const out = await FF.auth.api('/api/push/subscribe', 'POST', { subscription: sub.toJSON() });
      state.pushOn = true;
      state.pushError = '';
      state.pushTriedAt = Date.now();
      state.pushDevices = out && typeof out.subs === 'number' ? out.subs : (state.pushDevices || 1);
      if (!silent) U.toast('📲 Mobile notifications on ✓ — app band ho tab bhi phone ke panel me aayengi', 'ok');
      return true;
    } catch (err) {
      state.pushOn = false;
      state.pushError = (err && err.message) || 'setup failed';
      console.warn('push setup:', state.pushError);
      if (!silent) U.toast('Push setup nahi ho paya — ' + state.pushError, 'warn');
      return false;
    } finally { render(); }
  }
  async function disablePush() {
    try {
      const reg = await swRegistration(4000);
      const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription().catch(() => null) : null;
      if (sub) {
        await FF.auth.api('/api/push/unsubscribe', 'POST', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      state.pushOn = false;
      state.pushDevices = 0;
    } catch { /* ignore */ }
  }
  async function enableBrowser() {
    if (typeof Notification === 'undefined') { U.toast('Is browser me notifications supported nahi hain.', 'err'); return; }
    // Unlock audio on first user gesture
    unlockAudio();
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission === 'granted') {
        state.prefs.push = true; savePrefsLocal();
        await setupPush(true, { force: true });
      }
      render();
      U.toast(permission === 'granted' ? (state.pushOn ? '✅ Browser + mobile push alerts on' : 'Permission mil gayi, par push subscribe nahi hui — "Panel test" se check karo') : 'Browser alerts allow nahi hue.', permission === 'granted' && state.pushOn ? 'ok' : 'warn');
    } catch { U.toast('Browser notification permission nahi mil saki.', 'err'); }
  }
  /** OS notification panel ka seedha test — server push se independent (permission + SW check). */
  async function testPanel() {
    unlockAudio(); beep();
    try {
      const reg = await swRegistration(6000);
      if (reg && reg.active && reg.active.postMessage) { reg.active.postMessage({ type: 'ff-local-test' }); U.toast('📳 Panel test bheja — phone ke notification panel me dekho', 'ok'); return; }
      if (reg && reg.showNotification) { await reg.showNotification('🔔 Test notification', { body: 'Ye alert phone ke notification panel me aaya — OS notifications kaam kar rahe hain ✓', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'ff-test', vibrate: [200, 100, 200] }); U.toast('📳 Panel test bheja', 'ok'); return; }
    } catch { /* fall through */ }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      browserAlert({ type: 'info', title: 'Test notification', body: 'Ye test alert hai — sound + vibration kaam kar raha hai.', meta: {} });
      U.toast('🔊 Test alert bheja', 'ok');
      return;
    }
    U.toast('Panel test ke liye pehle notifications allow karo.', 'warn');
  }
  /** Server → is device par real web push (app band hone wala raasta). */
  async function testPush() {
    const ok = state.pushOn || await setupPush(true, { force: true });
    if (!ok) { U.toast('Pehle push enable karo — subscription nahi bani.', 'warn'); render(); return; }
    try {
      const out = await FF.auth.api('/api/push/test', 'POST', {});
      const results = (out && out.results) || [];
      if (out && out.delivered > 0) U.toast(`✅ Test push ${out.delivered} device(s) ko bheja — phone ka notification panel dekho`, 'ok');
      else if (results.length) U.toast(`⚠️ Push service ne reject kiya (status ${results[0].status || 'network'}) ${results[0].error ? '— ' + results[0].error : ''}`.slice(0, 150), 'err');
      else U.toast((out && out.hint) || 'Koi push device register nahi hai.', 'warn');
      await refreshPushStatus();
      render();
    } catch (err) { U.toast('Server push test fail: ' + ((err && err.message) || ''), 'err'); }
  }

  // ---- UI bind -----------------------------------------------------------------------------------
  function toggle(show) {
    const pop = U.$('#notification-pop'), btn = U.$('#notification-btn');
    if (!pop) return;
    const next = show === undefined ? pop.hidden : !!show;
    pop.hidden = !next;
    if (btn) { btn.setAttribute('aria-expanded', String(next)); btn.classList.toggle('open', next); }
    if (next) {
      FF.auth.api('/api/notifications/read', 'POST', {}).catch(() => {});
      setCount(0); render();
    }
  }
  function bind() {
    if (state.bound) return;
    const btn = U.$('#notification-btn');
    if (!btn) return;
    state.bound = true;
    btn.addEventListener('click', (e) => { if (!hasAccess()) return; e.stopPropagation(); toggle(); unlockAudio(); });
    document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
    document.addEventListener('keydown', unlockAudio, { once: true, passive: true });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#notification-pop') && !e.target.closest('#notification-btn')) toggle(false);
      const enable = e.target.closest('[data-notify-enable]');
      if (enable) { e.preventDefault(); enableBrowser(); return; }
      const prefBox = e.target.closest('[data-pref-toggle]');
      if (prefBox) { e.preventDefault(); e.stopPropagation(); const k = prefBox.dataset.prefToggle; const val = prefBox.checked; if (k === 'push' && val === false) disablePush(); if (k === 'push' && val === true) enableBrowser(); else savePrefs({ [k]: val }); return; }
      const openBtn = e.target.closest('[data-notify-open]');
      if (openBtn) { e.preventDefault(); const item = state.items.find((x) => x.id === openBtn.dataset.notifyOpen); toggle(false); if (item && item.meta && item.meta.link) { location.hash = item.meta.link; return; } if (item && FF.liveView) FF.liveView.openNotification(item); return; }
      const watchBtn = e.target.closest('[data-live-watch]');
      if (watchBtn) { e.preventDefault(); toggle(false); if (FF.liveView) FF.liveView.watch(watchBtn.dataset.liveWatch); return; }
      const test = e.target.closest('[data-notify-test]');
      if (test) { e.preventDefault(); testSound(); return; }
      const panelTest = e.target.closest('[data-notify-panel-test]');
      if (panelTest) { e.preventDefault(); testPanel(); return; }
      const pushTest = e.target.closest('[data-notify-push-test]');
      if (pushTest) { e.preventDefault(); testPush(); return; }
      const read = e.target.closest('[data-notify-read]');
      if (read) { e.preventDefault(); FF.auth.api('/api/notifications/read', 'POST', {}).catch(() => {}); setCount(0); render(); }
    });
  }
  function labelOf(el) {
    if (!el || el === document.body) return '';
    const target = el.closest('button, a, .kpi, [data-link], [data-agent], [data-tl], th, .seg-btn, .chip, .nav-item, tr.clickable, .notification-item, select, label, input') || el;
    if (target.matches('input[type=password]')) return 'password field';
    if (target.matches('input, textarea')) return `${target.placeholder || target.name || 'input'} (typing)`;
    const kpi = target.closest('.kpi');
    if (kpi) return `KPI: ${(kpi.querySelector('.kpi-title') || kpi).textContent.trim().slice(0, 60)} = ${(kpi.querySelector('.kpi-value') || {}).textContent || ''}`.trim();
    const text = (target.getAttribute('aria-label') || target.title || target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 90) || target.tagName.toLowerCase();
  }
  function track(kind, label) {
    if (EMBED || !FF.auth || !FF.auth.user || FF.auth.user.role === 'admin' || !sharing()) return;
    state.events.push({ at: Date.now(), kind, label: String(label || '').slice(0, 140), page: state.page });
    if (state.events.length > 30) state.events.shift();
    state.dirty = true;
  }
  function overlayLabel() {
    const drawer = document.getElementById('drawer');
    if (drawer && drawer.classList.contains('open')) return `Drawer: ${(document.getElementById('drawer-title') || {}).textContent || ''}`;
    const modal = document.querySelector('.kpi-modal, .live-modal');
    return modal ? 'Popup open' : '';
  }
  function sendPresence(force) {
    if (EMBED || !FF.auth || !FF.auth.user || FF.auth.user.role === 'admin') return;
    const share = sharing();
    const body = { page: state.page, title: document.title, engaged: Date.now() - state.lastInteraction < 90e3, visible: document.visibilityState === 'visible' };
    if (share) {
      body.pointer = state.pointer; body.viewport = { w: window.innerWidth, h: window.innerHeight };
      body.scroll = { y: Math.round(window.scrollY), h: document.documentElement.scrollHeight };
      body.overlay = overlayLabel();
      body.hash = location.hash;
      if (state.events.length) { body.events = state.events.splice(0); }
    } else body.pointer = null;
    body.page = share ? (location.hash.replace(/^#\/?/, '') || state.page) : state.page;
    state.dirty = false; state.lastSent = Date.now();
    FF.auth.api('/api/presence', 'POST', body).catch(() => {});
    return force;
  }
  /** Push na chalne par chup-chaap retry karo (throttled) — redeploy/key-rotate ke baad self-heal. */
  function retryPush() {
    if (EMBED || !hasAccess()) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (state.prefs.push === false) return;
    const due = !state.pushOn ? 30e3 : 10 * 60e3; // fail hone par jaldi, chalne par 10 min me re-validate
    if (state.pushTriedAt && Date.now() - state.pushTriedAt < due) return;
    state.pushTriedAt = Date.now();
    setupPush(true).catch(() => {});
  }
  function bindPushWatchers() {
    if (state.pushWatchersBound) return;
    state.pushWatchersBound = true;
    window.addEventListener('online', () => retryPush());
    // Permission browser settings se change ho (allow/block) → turant react karo
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'notifications' }).then((perm) => {
          perm.addEventListener && perm.addEventListener('change', () => {
            if (perm.state === 'granted') { state.pushTriedAt = 0; setupPush(true); }
            else { state.pushOn = false; render(); }
          });
        }).catch(() => {});
      }
    } catch { /* not supported everywhere */ }
    // Background me bhi (jab app khuli ho) har 5 min push health re-validate
    setInterval(() => { if (document.visibilityState === 'visible') retryPush(); }, 5 * 60e3);
  }
  function start() {
    bind();
    syncBellVisibility();
    if (state.started || EMBED) return;
    if (!hasAccess()) { state.started = true; return; } // bell off — no polling, no push
    state.started = true;
    loadPrefs().then(() => { setupPush(true); render(); });
    poll(true);
    sendPresence();
    // ⚡ Near-instant: first fast poll in 800ms, then every 5s visible / 15s hidden.
    setTimeout(() => poll(false), 800);
    state.timer = setInterval(() => poll(false), document.visibilityState === 'visible' ? 5e3 : 15e3);
    document.addEventListener('visibilitychange', () => {
      if (state.timer) { clearInterval(state.timer); state.timer = setInterval(() => poll(false), document.visibilityState === 'visible' ? 5e3 : 15e3); }
      if (document.visibilityState === 'visible') { poll(false); retryPush(); }
    });
    bindPushWatchers();
    state.presenceTimer = setInterval(() => sendPresence(), 15e3);
    state.fastTimer = setInterval(() => {
      if (!sharing() || document.visibilityState !== 'visible') return;
      const sc = Math.round(window.scrollY);
      if (sc !== state.lastScroll) { state.lastScroll = sc; state.dirty = true; }
      if (state.dirty && Date.now() - state.lastSent > 800) sendPresence();
    }, 400);
    if (!state.pointerBound) {
      state.pointerBound = true;
      document.addEventListener('pointermove', (e) => {
        state.lastInteraction = Date.now();
        if (!sharing()) return;
        state.pointer = { x: Math.round((e.clientX / Math.max(1, window.innerWidth)) * 1000) / 10, y: Math.round((e.clientY / Math.max(1, window.innerHeight)) * 1000) / 10 };
        state.dirty = true;
      }, { passive: true });
      document.addEventListener('pointerdown', (e) => {
        state.lastInteraction = Date.now();
        if (!sharing()) return;
        state.pointer = { x: Math.round((e.clientX / Math.max(1, window.innerWidth)) * 1000) / 10, y: Math.round((e.clientY / Math.max(1, window.innerHeight)) * 1000) / 10, down: true };
        track('click', labelOf(e.target));
      }, { passive: true, capture: true });
      document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('select')) track('select', `${labelOf(e.target.closest('label') || e.target)} → ${e.target.options[e.target.selectedIndex] ? e.target.options[e.target.selectedIndex].text : ''}`); }, true);
      window.addEventListener('hashchange', () => track('page', `Opened ${location.hash.replace(/^#\/?/, '') || 'home'}`));
      document.addEventListener('visibilitychange', () => { track('tab', document.visibilityState === 'visible' ? 'Came back to the tab' : 'Switched away from the tab'); sendPresence(); });
      ['keydown', 'wheel', 'touchstart'].forEach((type) => document.addEventListener(type, () => { state.lastInteraction = Date.now(); }, { passive: true }));
    }
  }
  function stop() { clearInterval(state.timer); clearInterval(state.presenceTimer); clearInterval(state.fastTimer); state.timer = null; state.presenceTimer = null; state.fastTimer = null; state.started = false; }
  function activity(page) {
    if (!FF.auth || !FF.auth.user) return;
    state.page = String(page || 'dashboard');
    state.lastInteraction = Date.now();
    if (EMBED) return;
    FF.auth.api('/api/activity', 'POST', { page: state.page }).catch(() => {});
    sendPresence();
  }
  let searchDebounceTimer = null;
  function logSearch(option, query) {
    if (!FF.auth || !FF.auth.user || !query || !String(query).trim()) return;
    const q = String(query).trim();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      track('search', `Searched "${q}" in ${option || 'Search'}`);
      FF.auth.api('/api/activity', 'POST', { type: 'search', option: option || 'Search', query: q })
        .then(() => poll(false))
        .catch(() => {});
    }, 600);
  }
  function logClick(option, details) {
    if (!FF.auth || !FF.auth.user || !option) return;
    FF.auth.api('/api/activity', 'POST', { type: 'click', option: option || 'Option', details: details || '' })
      .then(() => poll(false))
      .catch(() => {});
  }
  // Test sound button (for settings/test)
  function testSound() { unlockAudio(); beep(); U.toast('🔊 Test beep', 'info'); }
  FF.notifications = { start, stop, poll, toggle, activity, logSearch, logClick, track, testSound, render, setupPush, disablePush, enableBrowser, testPanel, testPush, refreshPushStatus, retryPush, browserAlert, get state() { return state; }, get prefs() { return state.prefs; } };
  bind();
})(window.FF);
