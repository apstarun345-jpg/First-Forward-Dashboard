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
    { key: 'report',   label: '📊 Report data update',     user: true,  admin: true },
    { key: 'digest',   label: '🌅 Daily digest (subah · issuance + stock + cover)', user: false, admin: true },
    { key: 'alert',    label: '🔴 Critical alerts (low cover · mid-month target miss)', user: false, admin: true },
    { key: 'activity', label: '👀 User page opens',        user: false, admin: true },
    { key: 'click',    label: '👆 Button / option use',    user: false, admin: true },
    { key: 'search',   label: '🔍 Searches',               user: false, admin: true },
    { key: 'settings', label: '⚙️ Settings changes',     user: false, admin: true },
    { key: 'location', label: '📍 Location shares',        user: false, admin: true },
    // 🏷️ IDFC Agents Tag Request — requester ko confirmation + admin ko nayi request (v3.24)
    { key: 'request',  label: '🏷️ Tag Request (nayi request + status)', user: true, admin: true },
    // 🎙️ Live Assist — consent-based voice/video session (v3.26)
    { key: 'assist',   label: '🎙️ Live Assist (voice/video session)', user: true, admin: true }
  ];
  // `enabled` = master switch. UI me sirf ek "Notifications ON/OFF" button hai (Settings me baaki fine-tuning).
  // ⚠️ Sab keys TRUE rakho — savePrefs PURA object server par PUT karta hai, isliye yahan kisi
  // type ko false rakhne se wo permanently OFF save ho jaata tha (feed + mobile push dono band) —
  // isi wajah se admin ko sirf kuch types (sheet update) hi aati thi.
  const TONE_OPTIONS = [
    { id: 'classic', label: 'Classic · single clear beep' },
    { id: 'soft', label: 'Soft · gentle low tone' },
    { id: 'double', label: 'Double · two quick notes' },
    { id: 'chime', label: 'Chime · three rising notes' },
    { id: 'alert', label: 'Alert · alternating urgent notes' }
  ];
  const VALID_TONES = new Set(TONE_OPTIONS.map((x) => x.id));
  // `voice` = app/web band hone par bhi alerts bol kar sunao (pushVoice.js + sw.js voice queue).
  const DEFAULT_PREFS = { enabled: true, login: true, signup: true, report: true, monthly: true, digest: true, alert: true, activity: true, click: true, search: true, settings: true, user: true, location: true, info: true, request: true, assist: true, sound: true, tone: 'classic', push: true, voice: true };
  const state = { started: false, bound: false, timer: null, presenceTimer: null, fastTimer: null, lastAt: '', items: [], unread: 0, serverUnread: 0, firstPoll: true, page: 'home', pointer: null, people: [], lastInteraction: Date.now(), pointerBound: false, events: [], dirty: false, lastSent: 0, lastScroll: -1, pushOn: false, pushDevices: 0, pushStatus: null, pushTriedAt: 0, pushError: '', prefs: { ...DEFAULT_PREFS }, audioCtx: null, expanded: null, filterType: 'all', filterUnread: false, filterSearch: '', centerPriority: 'all', centerDate: 'all', seenAt: '', voiceAt: {} };
  const normalizePrefs = (p) => {
    const out = { ...DEFAULT_PREFS, ...(p && typeof p === 'object' ? p : {}) };
    if (!VALID_TONES.has(String(out.tone))) out.tone = DEFAULT_PREFS.tone;
    return out;
  };
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
      if (raw) { const p = JSON.parse(raw); state.prefs = normalizePrefs(p); return; }
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
      if (out && out.prefs) state.prefs = normalizePrefs(out.prefs);
      savePrefsLocal();
    } catch { /* pre-login ya offline: local prefs hi kaam karenge */ }
  }
  async function savePrefs(patch, silent) {
    state.prefs = normalizePrefs({ ...state.prefs, ...patch });
    savePrefsLocal();
    try { await FF.auth.api('/api/notifications/prefs', 'PUT', { prefs: state.prefs }); } catch { /* retry next poll */ }
    if (!silent) U.toast('Notification preferences saved ✓', 'ok');
    render();
  }

  // ---- 🔊 In-app/update tones (Web Audio; the selected pattern is persisted per user) -------------
  const TONE_NOTES = {
    classic: [{ hz: 880, at: 0, duration: 0.2 }],
    soft: [{ hz: 523.25, at: 0, duration: 0.28, gain: 0.09 }],
    double: [{ hz: 740, at: 0, duration: 0.12 }, { hz: 988, at: 0.18, duration: 0.17 }],
    chime: [{ hz: 659.25, at: 0, duration: 0.16 }, { hz: 880, at: 0.16, duration: 0.16 }, { hz: 1174.66, at: 0.32, duration: 0.24 }],
    alert: [{ hz: 1046.5, at: 0, duration: 0.13 }, { hz: 784, at: 0.17, duration: 0.13 }, { hz: 1046.5, at: 0.34, duration: 0.2 }]
  };
  const TONE_VIBRATION = { classic: [80, 40, 80], soft: [60], double: [60, 80, 60], chime: [50, 60, 50, 60, 90], alert: [180, 60, 180] };
  // ⚠️ v3.25 CHROME FIX — pehle AudioContext sirf beep() ke andar (hamesha bina gesture ke, poll
  //    callback me) banta tha. Chrome autoplay policy me aisa context "suspended" paida hota hai aur
  //    bina gesture ke resume() KABHI succeed nahi hota — isliye installed app me sound aati thi
  //    lekin Chrome website par hamesha silent. Ab:
  //      1. AudioContext pehle user gesture (click/keypress/touch) ke ANDAR banta + resume hota hai,
  //      2. gesture se pehle aaye beeps queue me jaate hain aur unlock hote hi baj uthte hain,
  //      3. unlock har gesture par retry hota hai jab tak context "running" na ho jaaye.
  let pendingBeeps = 0;
  let audioUnlockBound = false;
  function audioCtx() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!state.audioCtx) state.audioCtx = new Ctx();
      return state.audioCtx;
    } catch { return null; }
  }
  /** Sirf tab bajao jab context sach me running ho. Return: bajaya ya nahi. */
  function beepNow() {
    try {
      const ctx = audioCtx();
      if (!ctx || ctx.state !== 'running') return false;
      const notes = TONE_NOTES[state.prefs.tone] || TONE_NOTES.classic;
      const start = ctx.currentTime;
      notes.forEach((note) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        const at = start + note.at, duration = note.duration;
        o.type = state.prefs.tone === 'alert' ? 'triangle' : 'sine';
        o.frequency.value = note.hz;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(note.gain || 0.13, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        o.connect(g); g.connect(ctx.destination);
        o.start(at); o.stop(at + duration + 0.01);
      });
      // Mobile vibration bhi selected tone ke rhythm ke saath.
      if (navigator.vibrate) try { navigator.vibrate(TONE_VIBRATION[state.prefs.tone] || TONE_VIBRATION.classic); } catch {}
      return true;
    } catch { return false; }
  }
  function flushPendingBeeps() {
    if (!pendingBeeps) return;
    const n = Math.min(pendingBeeps, 3);
    pendingBeeps = 0;
    for (let i = 0; i < n; i++) setTimeout(() => beepNow(), i * 260);
  }
  function beep(force) {
    if (state.prefs.sound === false) return;
    if (!force && state.prefs.enabled === false) return; // master switch OFF → koi sound nahi
    const ctx = audioCtx();
    if (ctx && ctx.state === 'suspended') { try { ctx.resume().then(flushPendingBeeps).catch(() => {}); } catch { /* ignore */ } }
    if (beepNow()) return;
    // Chrome ne autoplay roka — agle user gesture par khud baj jayega (queue).
    pendingBeeps = Math.min(pendingBeeps + 1, 3);
    bindAudioUnlock();
  }
  /** Gesture listeners — context gesture ke ANDAR banao/resume karo, phir pending beeps baja do. */
  function bindAudioUnlock() {
    if (audioUnlockBound || typeof document === 'undefined' || !document.addEventListener) return;
    audioUnlockBound = true;
    const attempt = () => {
      const ctx = audioCtx(); // gesture ke andar create — Chrome isi ko allow karta hai
      if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
      if (ctx && ctx.state === 'running') flushPendingBeeps();
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, attempt, { passive: true }));
  }
  function unlockAudio() {
    // User gesture ke andar call hota hai — context yahin banao + resume karo (Chrome autoplay policy).
    const ctx = audioCtx();
    if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume().then(flushPendingBeeps).catch(() => {});
    if (ctx && ctx.state === 'running') flushPendingBeeps();
    bindAudioUnlock();
  }
  bindAudioUnlock(); // module load par hi lagao — login se pehle kiya gaya click bhi unlock kar de

  // ---- icon / helpers ----------------------------------------------------------------------------
  function icon(item) {
    return ({ report: '📊', monthly: '📅', digest: '🌅', alert: '🔴', login: '🔐', activity: '👀', location: '📍', search: '🔍', click: '👆', settings: '⚙️', user: '👤', info: 'ℹ️', request: '🏷️', assist: '🎙️' }[item.type] || '🔔');
  }
  // ---- 📂 notification ka data (panel me expand + redirect) --------------------------------------
  const META_LABEL = { date: 'Date', ip: 'IP', loginId: 'Login ID', username: 'User', page: 'Page', band: 'Cover band', cover: 'Cover (din)', vc4: 'VC4 stock', avg: 'Avg / din', ffMtd: 'FF MTD', gvMtd: 'GV MTD', ff: 'FF', gv: 'GV', total: 'Combined total', mtdDays: 'Active days', activeDays: 'Active days', observedDays: 'Observed days', zeroDays: 'Zero days observed', ffDays: 'FF active days', gvDays: 'GV active days', achieved: 'Achieved', totalTarget: 'Target', day: 'Day', users: 'Users', ageDays: 'Age (din)', prevAvg: 'Pichhle avg', today: 'Aaj', source: 'Source', reset: 'Reset link', changes: 'Changes', rows: 'Rows', classes: 'Class-wise', tl: 'TL', priority: 'Priority', requestId: 'Request ID' };
  /** Class-wise / type-wise snapshot ko chhote table me — notification ke andar data dikhane ke liye. */
  function classTable(classes) {
    const entries = Object.entries(classes && typeof classes === 'object' ? classes : {}).filter(([, v]) => Number(v) !== 0);
    if (!entries.length) return '';
    return `<table class="kd-tbl" style="margin-top:4px"><thead><tr><th>Class</th><th class="num">Tags</th></tr></thead><tbody>${entries.map(([k, v]) => `<tr><td>${U.esc(k)}</td><td class="num"><b>${U.esc(String(v))}</b></td></tr>`).join('')}</tbody></table>`;
  }
  function fmtMeta(v) {
    if (v === null || v === undefined || v === '') return '';
    if (Array.isArray(v)) return v.length > 8 ? `${v.slice(0, 8).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')} …(+${v.length - 8})` : v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function linkPageLabel(link) {
    try {
      const hash = String(link).replace(/^#\/?/, '');
      const pageId = hash.split('?')[0];
      if (pageId === 'sheet') return decodeURIComponent((hash.split('/')[1] || 'Sheet').split('?')[0]);
      const p = ((FF.app && FF.app.PAGES) || []).find((x) => x.id === pageId);
      if (p) return p.label;
      return pageId === 'settings' ? 'Settings' : (pageId || 'Page');
    } catch { return 'Page'; }
  }
  /** Item ke andar click karne par khulne wala data block — meta ke key/values + class-wise + page link. */
  function detailHtml(item) {
    const m = item.meta || {};
    // Structured blocks (class-wise / channel-wise) generic key-value list se alag dikhte hain.
    const STRUCTURED = new Set(['link', 'changes', 'classes', 'ffClasses', 'gvClasses', 'channels', 'snapshot', 'previous', 'delta']);
    const rows = [];
    Object.entries(m).forEach(([k, v]) => {
      if (STRUCTURED.has(k)) return;
      const s = fmtMeta(v);
      if (!s) return;
      rows.push(`<tr><td>${U.esc(META_LABEL[k] || k)}</td><td><b>${U.esc(s)}</b></td></tr>`);
    });
    const blocks = [];
    const pushClasses = (label, classes) => {
      const t = classTable(classes);
      if (t) blocks.push(`<div class="dim small" style="margin-top:6px">${label}</div>${t}`);
    };
    pushClasses('🟦 First Forward · class-wise', m.ffClasses || (m.classes && !m.gvClasses ? m.classes : null));
    pushClasses('🟩 GV Partner · class-wise', m.gvClasses);
    if (m.snapshot && m.snapshot.classes) {
      const src = m.source === 'gv' ? '🟩 GV Partner' : '🟦 First Forward';
      pushClasses(`${src} · ${U.esc(m.snapshot.date || '')} class-wise${m.previous && m.previous.date === m.snapshot.date && m.previous.total !== undefined ? ` (pehle ${U.esc(String(m.previous.total))} → ab <b>${U.esc(String(m.snapshot.total || 0))}</b>)` : ''}`, m.snapshot.classes);
    }
    const chg = Array.isArray(m.changes) && m.changes.length
      ? `<table class="kd-tbl" style="margin-top:4px"><tbody>${m.changes.slice(0, 10).map((c) => `<tr><td>${U.esc(String(c.field || ''))}</td><td>${U.esc(fmtMeta(c.before))} → <b>${U.esc(fmtMeta(c.after))}</b></td></tr>`).join('')}</tbody></table>` : '';
    return `<div class="notif-detail">
      ${rows.length ? `<table class="kd-tbl"><tbody>${rows.join('')}</tbody></table>` : ''}
      ${blocks.join('')}
      ${chg}
      <div class="notif-detail-actions">
        ${m.link ? `<button type="button" class="btn small primary" data-notify-goto="${U.esc(item.id)}">➡️ ${U.esc(linkPageLabel(m.link))} par jao</button>` : ''}
        <button type="button" class="btn small" data-notify-drawer="${U.esc(item.id)}">🔎 Details drawer me</button>
      </div></div>`;
  }
  function canBrowserAlert() { return typeof Notification !== 'undefined' && Notification.permission === 'granted'; }
  function isInstalledPWA() {
    return window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || window.navigator.standalone === true);
  }
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }
  async function browserAlert(item) {
    if (!item) return;
    if (state.prefs.enabled === false) return; // 🔕 master switch OFF
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
      vibrate: state.prefs.sound !== false ? (TONE_VIBRATION[state.prefs.tone] || TONE_VIBRATION.classic) : undefined,
      data: { link: (item.meta && item.meta.link) || '' }
    };
    // iOS Safari/PWA me `new Notification()` allowed nahi hai — service worker se dikhao.
    // Android/desktop par bhi SW wala raasta zyada reliable hai (panel me hi aata hai).
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        if (state.prefs.sound !== false && navigator.vibrate) try { navigator.vibrate(TONE_VIBRATION[state.prefs.tone] || TONE_VIBRATION.classic); } catch {}
        return;
      }
    } catch { /* fall through to the page-level constructor */ }
    try {
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); n.close(); };
      if (state.prefs.sound !== false && navigator.vibrate) try { navigator.vibrate(TONE_VIBRATION[state.prefs.tone] || TONE_VIBRATION.classic); } catch {}
    } catch { /* private mode / unsupported */ }
  }
  function setCount(n) {
    state.unread = Math.max(0, Number(n) || 0);
    const badge = U.$('#notification-count');
    if (badge) { badge.textContent = state.unread > 99 ? '99+' : String(state.unread); badge.hidden = state.unread < 1; }
    const mobileBadge = U.$('#mobile-notification-count');
    if (mobileBadge) {
      mobileBadge.textContent = state.unread > 99 ? '99+' : String(state.unread);
      mobileBadge.hidden = state.unread < 1;
    }
    // Favicon / title badge for unread
    const t = (FF.config && FF.config.appName) || document.title.replace(/\s*\(\d+\)\s*/, '');
    document.title = state.unread > 0 ? `(${state.unread}) ${t}` : t;
    // 📱 App icon badge (installed PWA) — sw.js setAppBadge karta hai; support na ho to skip.
    try {
      const sw = navigator.serviceWorker;
      if (sw && sw.controller && sw.controller.postMessage) sw.controller.postMessage({ type: 'ff-badge', count: state.unread });
    } catch { /* badge optional */ }
  }
  function latestTime(items) { return (items || []).reduce((max, x) => !max || x.createdAt > max ? x.createdAt : max, ''); }
  function itemUnread(item) {
    const seen = state.seenAt || (FF.auth.user && FF.auth.user.notificationsSeenAt) || '';
    return !seen || new Date(item.createdAt).getTime() > new Date(seen).getTime();
  }
  function markAllRead() {
    const at = new Date().toISOString();
    state.seenAt = at;
    if (FF.auth.user) FF.auth.user.notificationsSeenAt = at;
    FF.auth.api('/api/notifications/read', 'POST', {}).catch(() => {});
    state.serverUnread = 0;
    setCount(0); render();
  }

  // ---- 📊 Client-side "data update" alerts — sheet se naya data detect hote hi bell + toast + voice ----
  // Server watcher (checkReports) ke alawa client khud bhi detect karta hai (office bell 30s poll +
  // 5-min light sync). Tab visible ho to toast + beep, background ho to phone/desktop panel; aur
  // voiceText ho + Office Bell voice ON ho to bol kar bhi announce (browser autoplay unlock ke saath).
  function countUnread() {
    const localUnread = state.items.filter((x) => x.local && itemUnread(x)).length;
    return (state.serverUnread || 0) + localUnread;
  }
  /**
   * 🔊 Kya Office Bell ki voice ON hai?
   *
   * ⚠️ v3.24 BUG FIX — `FF.officeBell.voiceOn` ek GETTER hai (boolean deta hai), function nahi.
   * Purana code `bell.voiceOn ? bell.voiceOn() : true` chalta tha → "bell.voiceOn is not a function"
   * TypeError aata tha, wo poore localAlert ko maar deta tha aur **koi bhi voice announcement**
   * kabhi nahi hoti thi (notification aati thi, awaaz nahi). Ab dono shapes support karte hain —
   * getter (boolean), function (test stubs) aur `isVoiceOn()` helper.
   */
  function bellVoiceOn(bell) {
    const b = bell || FF.officeBell;
    if (!b) return true;
    try {
      if (typeof b.isVoiceOn === 'function') return !!b.isVoiceOn();
      if (typeof b.voiceOn === 'function') return !!b.voiceOn();
      if (typeof b.voiceOn === 'boolean') return b.voiceOn;
    } catch { /* voice prefs optional */ }
    return true;
  }
  /** Bell ne pichhle 75s me SACH ME bola? (sirf log entry nahi — warna duplicate-suppression galat lagti hai.) */
  function bellSpokeRecently(bell, now) {
    const b = bell || FF.officeBell;
    if (!b) return false;
    try {
      const at = Number(b.lastSpokeAt || 0);
      if (at > 0) return now - at < 75e3;
    } catch { /* ignore */ }
    try {
      const l = b.logList ? b.logList() : [];
      return !!(l.length && now - Number(l[0].at || 0) < 75e3);
    } catch { return false; }
  }
  function localAlert(opts) {
    const o = opts || {};
    const type = o.type || 'report';
    if (state.prefs.enabled === false) return null;
    if (state.prefs[type] === false) return null;
    const now = Date.now();
    // 60s ke andar same type ki local alert dobara na aaye — body merge kar do (spam nahi).
    const last = state.items.slice().reverse().find((x) => x.local && x.type === type);
    let item;
    if (last && now - new Date(last.createdAt).getTime() < 60e3) {
      last.title = String(o.title || last.title).slice(0, 120);
      last.body = String(o.body || last.body).slice(0, 800);
      last.meta = { ...(last.meta || {}), ...(o.meta || {}) };
      last.createdAt = new Date(now).toISOString();
      item = last;
    } else {
      item = {
        id: `local-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        type, title: String(o.title || 'Update').slice(0, 120),
        body: String(o.body || '').slice(0, 800), meta: o.meta || {},
        local: true, createdAt: new Date(now).toISOString()
      };
      state.items.push(item);
      if (state.items.length > 100) state.items = state.items.slice(-100);
      state.expanded = state.expanded || null;
    }
    setCount(countUnread());
    try { browserAlert(item); } catch { /* alerts optional — UI kabhi block na ho */ }
    // 🔊 Voice announcement — office bell ke speaker path se (autoplay unlock + queue wala).
    //    UI/bell update PEHLE ho chuke hain, isliye voice me koi bhi dikkat notification ko
    //    rok nahi sakti (purana bug: voiceOn() throw karta tha aur render() tak nahi pahunchta tha).
    if (o.voiceText && state.prefs.voice !== false) {
      try {
        const bell = FF.officeBell;
        const bellVoice = bellVoiceOn(bell);
        const muted = bell && bell.prefs && Number(bell.prefs().muteUntil || 0) > now;
        if (bell && bellVoice && !muted && !bellSpokeRecently(bell, now)) {
          if ((typeof document !== 'undefined' && document.hidden) || !bell.unlocked) {
            if (bell.queueAnnounce) bell.queueAnnounce(o.voiceText, 3);
          } else if (bell.speakAnnounce) {
            bell.speakAnnounce(o.voiceText, 3);
          }
          state.voiceAt = { ...state.voiceAt, any: now, [type]: now };
        }
      } catch (err) {
        console.warn('voice announce skipped:', (err && err.message) || err);
      }
    }
    render();
    return item;
  }

  // ---- 🔊 Server se aayi notification par bhi awaaz ----------------------------------------------
  // Ye raasta pehle bilkul nahi tha: server (sheet watcher / alerts / digest) se aayi notification
  // par sirf toast + panel alert hota tha, **koi voice nahi**. Ab office bell ke speaker path se
  // bol kar sunate hain — same autoplay-unlock + queue + mute rules ke saath.
  const VOICE_TYPES = new Set(['report', 'alert', 'digest', 'request']);
  /**
   * pushVoice.js ne ye alert bol diya (app band hone ke baad ka catch-up ya live push) — 75s wala
   * duplicate-guard set karo taaki wahi khabar polling se dobara na boli jaye.
   */
  function noteVoiced(type) {
    const now = Date.now();
    state.voiceAt = { ...state.voiceAt, any: now, ...(type ? { [type]: now } : {}) };
    return now;
  }
  /** Notification ka bolne-layak text (emoji/symbol hata kar, chhota aur saaf). */
  function voiceLineFor(item) {
    if (!item) return '';
    const hi = !(FF.assistant && FF.assistant.getLang && FF.assistant.getLang() === 'en');
    const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}\s+.,:%\-–—]/gu, ' ').replace(/\s+/g, ' ').trim();
    const m = item.meta || {};
    if (item.type === 'report') {
      const delta = m.delta && typeof m.delta === 'object' ? m.delta : null;
      const dTotal = delta && Number.isFinite(Number(delta.total)) ? Number(delta.total) : null;
      const parts = delta && delta.classes ? Object.entries(delta.classes).slice(0, 4).map(([k, v]) => `${k} ${Number(v) > 0 ? '+' : ''}${Number(v)}`) : [];
      if (dTotal !== null && dTotal !== 0) {
        const line = `${dTotal > 0 ? '+' : ''}${U.fmt(dTotal)} tags${parts.length ? ` (${parts.join(', ')})` : ''}`;
        return hi ? `Data update! ${line}` : `Data update! ${line}`;
      }
      const total = Number(m.snapshot && m.snapshot.total) || 0;
      if (total) return hi ? `Data update! Aaj ke ${U.fmt(total)} tags ho gaye.` : `Data update! Today's total is now ${U.fmt(total)} tags.`;
    }
    const title = clean(item.title);
    const body = clean(item.body);
    const text = [title, body].filter(Boolean).join('. ');
    return text.slice(0, 180);
  }
  /**
   * Server notification ko bolo. Guards: master + type pref ON, sound ON, office bell voice ON,
   * mute nahi, aur haal hi me kuch bola na ho (data update par 5 min — warna sheet watcher aur
   * office bell dono ek hi news do baar sunate hain).
   */
  function speakServerItem(item) {
    if (!item || !VOICE_TYPES.has(item.type)) return false;
    if (state.prefs.enabled === false || state.prefs[item.type] === false || state.prefs.sound === false) return false;
    if (state.prefs.voice === false) return false; // 🔊 "app band ho tab bhi voice" OFF = koi bhi alert announcement nahi
    const bell = FF.officeBell;
    if (!bell || !bellVoiceOn(bell)) return false;
    try { if (Number((bell.prefs && bell.prefs().muteUntil) || 0) > Date.now()) return false; } catch { /* ignore */ }
    const now = Date.now();
    if (state.voiceAt.any && now - state.voiceAt.any < 75e3) return false;
    if (item.type === 'report' && state.voiceAt.report && now - state.voiceAt.report < 5 * 60e3) return false;
    const text = voiceLineFor(item);
    if (!text) return false;
    try {
      if ((typeof document !== 'undefined' && document.hidden) || !bell.unlocked) {
        if (bell.queueAnnounce) bell.queueAnnounce(text, 3);
      } else if (bell.speakAnnounce) {
        bell.speakAnnounce(text, 3);
      }
      state.voiceAt = { ...state.voiceAt, any: now, [item.type]: now };
      return true;
    } catch (err) {
      console.warn('server voice skipped:', (err && err.message) || err);
      return false;
    }
  }

  // ---- render ------------------------------------------------------------------------------------
  /* Bell panel JAAN-BOOJH kar minimal hai: sirf ek "Notifications ON/OFF" switch + monthly report
     switch + list. Push diagnostics / panel test / server push test sab Settings me chale gaye
     (admin wahan troubleshoot karta hai) — warna har user ko warning-cards ka dhher dikhta tha. */
  function switchRow({ id, label, note, on, disabled }) {
    return `<div class="notify-switch-row">
      <div class="nsr-text"><b>${label}</b><small>${note}</small></div>
      <button type="button" class="ff-switch ${on ? 'on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" ${disabled ? 'disabled' : ''} ${id ? `data-notify-switch="${id}"` : ''}><span class="ff-switch-knob"></span></button>
    </div>`;
  }
  /** Panel ke andar sirf wahi warning jo action maangti hai — bina technical noise ke. */
  function hintLine() {
    const browser = typeof Notification !== 'undefined';
    const permission = browser ? Notification.permission : 'unsupported';
    const canPush = 'serviceWorker' in navigator && 'PushManager' in window;
    const on = state.prefs.enabled !== false;
    const st = state.pushStatus || {};
    const isAdmin = FF.auth.user && FF.auth.user.role === 'admin';
    if (!on) return `<div class="notify-line muted">🔕 Notifications OFF — koi alert nahi aayega. List phir bhi andar padh sakte ho.</div>`;
    if (isAdmin && st.configError) return `<div class="notify-line warn">⚠️ Push service delivery reject kar rahi hai (status ${U.esc(String(st.configError.status || '?'))}) — Settings → 👤 My account → Push diagnostics dekho.</div>`;
    if (permission === 'denied') return `<div class="notify-line warn">🚫 Browser ne notifications block kar rakhe hain — address bar ke 🔒 icon se Allow karo, phir switch OFF-ON karo.</div>`;
    if (!browser || !canPush) {
      // iOS par web push sirf installed PWA me chalta hai — ye ek line zaroori hai, warna panel chup-chaap silent rehta hai.
      if (isIOS() && !isInstalledPWA()) return `<div class="notify-line">📱 iOS par panel push sirf installed app me chalta hai — Safari → Share → “Add to Home Screen”, phir app kholo.</div>`;
      return `<div class="notify-line muted">ℹ️ Is browser me sirf in-app alerts milenge. Phone panel ke liye Chrome / Edge / Samsung Internet (Android) ya iOS 16.4+ (installed app) chahiye.</div>`;
    }
    if (permission !== 'granted') return `<div class="notify-line">🔔 Phone / desktop panel alerts ke liye switch OFF karke wapas ON karo aur “Allow” dabao.</div>`;
    if (!state.pushOn) return `<div class="notify-line">📲 Push subscription ban rahi hai… app band ho tab bhi alerts milenge.</div>`;
    return '';
  }
  function render() {
    const pop = U.$('#notification-pop');
    if (!pop) return;
    const on = state.prefs.enabled !== false;
    const monthly = state.prefs.monthly !== false;
    const isAdmin = FF.auth.user && FF.auth.user.role === 'admin';

    const voice = state.prefs.voice !== false;
    const switches = `<div class="notify-switches">
      ${switchRow({ id: 'master', label: '🔔 Notifications', note: on ? 'ON — app ke andar + phone / desktop panel par' : 'OFF — koi alert nahi aayega', on })}
      ${switchRow({ id: 'voice', label: '🔊 Alert voice (band ho tab bhi)', note: voice ? 'Alert bol kar sunata hai — app khula ho to turant, band tha to khulte hi catch-up' : 'Sirf beep / vibration, koi awaaz nahi', on: voice, disabled: !on })}
      ${switchRow({ id: 'monthly', label: '📅 Monthly report', note: 'Har mahine ki 1–5 tarikh ko pichhle mahine ka FF vs GV compare', on: monthly, disabled: !on })}
    </div>`;

    const typeOptions = [{ key: 'all', label: 'All types' }, ...NOTIFY_TYPES.filter((t) => t.admin || t.user).map((t) => ({ key: t.key, label: t.label }))];
    const filtered = state.items.slice().reverse().filter((item) => (state.filterType === 'all' || item.type === state.filterType) && (!state.filterUnread || itemUnread(item)));
    const rows = filtered.slice(0, 60).map((item) => {
      const open = state.expanded === item.id;
      const unread = itemUnread(item);
      return `<div class="notif-wrap ${open ? 'open' : ''} ${unread ? 'is-unread' : 'is-read'}"><button type="button" class="notification-item ${item.type || ''} ${unread ? 'unread' : 'read'} ${open ? 'active' : ''}" data-notify-open="${U.esc(item.id)}" title="Click → data expand karo" aria-expanded="${open ? 'true' : 'false'}">
      <span class="notification-icon">${icon(item)}</span><div><b>${U.esc(item.title)}</b><p>${U.esc(item.body)}</p><small>${unread ? '<strong>NEW</strong> · ' : ''}${U.esc(U.timeLabel(new Date(item.createdAt).getTime()))} · <u>${open ? 'band karo ↑' : 'data dekho ↓'}</u></small></div></button>${open ? detailHtml(item) : ''}</div>`;
    }).join('');
    const presence = isAdmin ? `<section class="presence-panel"><div class="presence-title">🟢 User activity <small>Admin only · live / last seen</small></div>${state.people.length ? state.people.map((p) => `<div class="presence-row"><span class="presence-dot ${p.active ? 'is-live' : ''}"></span><div><b>${U.esc(p.name || p.username)}</b><small>${p.active ? `Active now · ${U.esc(p.page)}` : `Last active ${U.esc(U.timeLabel(p.lastSeen))} · last page: ${U.esc(p.page)}`}</small>${p.lastEvent ? `<small>Last action: ${U.esc(p.lastEvent.label || p.lastEvent.kind)}</small>` : ''}</div><span class="presence-side"><span class="presence-state">${p.online && p.active ? 'LIVE' : p.online ? 'IDLE' : 'AWAY'}</span>${isAdmin ? `<button class="btn small" data-live-watch="${U.esc(p.username)}">👁 Live view</button> <button class="btn small" data-la-request="${U.esc(p.username)}" title="User ki marzi se live awaaz/video session shuru karo">🎙 Assist</button>` : ''}</span></div>`).join('') : '<div class="notification-empty">Users seen after this server started will appear here.</div>'}</section>` : '';
    pop.innerHTML = `<div class="notification-head"><div><b>Notifications</b><small>${state.unread ? `${state.unread} unread` : 'Sab updated hai'} · ${filtered.length} shown</small></div><div style="display:flex;gap:6px"><button class="btn small primary" data-notify-center>📬 Full Center</button><button class="btn small" data-notify-read ${state.unread ? '' : 'disabled'}>✓ Mark all read</button></div></div>
      <div class="notify-filter-bar"><label>Type <select data-notify-filter="type">${typeOptions.map((t) => `<option value="${U.esc(t.key)}" ${state.filterType === t.key ? 'selected' : ''}>${U.esc(t.label)}</option>`).join('')}</select></label><button type="button" class="btn small ${state.filterUnread ? 'primary' : ''}" data-notify-filter="unread">${state.filterUnread ? '✓ Unread only' : 'Unread only'}</button></div>
      ${presence}
      ${switches}
      ${hintLine()}
      <div class="notification-list">${rows || `<div class="notification-empty">${state.filterUnread ? 'No unread notifications in this view.' : 'Abhi koi notification nahi. User login/page open, report update aur shared location yahan dikhegi.'}</div>`}</div>`;
  }

  // ---- 📬 Notification Center 2.0 ----------------------------------------------------------------
  // Full-screen style inbox: priority + search + date window. Existing bell remains the quick inbox.
  const NOTIFY_PRIORITY = {
    alert: 'critical',
    request: 'action', settings: 'action', user: 'action', signup: 'action',
    report: 'info', digest: 'info', monthly: 'info', login: 'info', info: 'info',
    activity: 'info', click: 'info', search: 'info', location: 'info', assist: 'action'
  };
  const PRIORITY_META = {
    critical: { label: 'Critical', icon: '🚨' },
    action: { label: 'Action', icon: '⚡' },
    info: { label: 'Info', icon: 'ℹ️' }
  };
  function notifyPriority(item) { return NOTIFY_PRIORITY[item && item.type] || 'info'; }
  function notifyMatchesDate(item, range) {
    if (!range || range === 'all') return true;
    const t = new Date(item.createdAt || 0).getTime();
    if (!Number.isFinite(t)) return false;
    const now = Date.now();
    if (range === 'today') return new Date(t).toDateString() === new Date(now).toDateString();
    if (range === '7d') return now - t <= 7 * 86400e3;
    if (range === '30d') return now - t <= 30 * 86400e3;
    return true;
  }
  function centerItems() {
    const q = String(state.filterSearch || '').trim().toLowerCase();
    return state.items.slice().reverse().filter((item) => {
      if (state.centerPriority !== 'all' && notifyPriority(item) !== state.centerPriority) return false;
      if (!notifyMatchesDate(item, state.centerDate)) return false;
      if (!q) return true;
      return [item.title, item.body, item.type, ...(Object.values(item.meta || {}).map((v) => typeof v === 'object' ? JSON.stringify(v) : String(v)))]
        .join(' ').toLowerCase().includes(q);
    });
  }
  function centerItemHtml(item) {
    const p = notifyPriority(item), pm = PRIORITY_META[p] || PRIORITY_META.info, unread = itemUnread(item);
    const link = item.meta && item.meta.link;
    return `<article class="notify-center-item ${unread ? 'is-unread' : ''}" data-center-id="${U.esc(item.id)}">
      <div class="nci-priority ${p}" title="${U.esc(pm.label)}">${pm.icon}</div>
      <div class="nci-main">
        <div class="nci-top"><b>${U.esc(item.title)}</b><span class="nci-time">${unread ? '<strong>NEW</strong> · ' : ''}${U.esc(U.timeLabel(new Date(item.createdAt).getTime()))}</span></div>
        <p>${U.esc(item.body)}</p>
        <div class="nci-meta"><span>${icon(item)} ${U.esc(item.type || 'info')}</span>${link ? '<span>↗ linked</span>' : ''}</div>
      </div>
      <button type="button" class="btn small" data-center-open="${U.esc(item.id)}">Open</button>
    </article>`;
  }
  function centerRender(host) {
    if (!host) return;
    const items = centerItems();
    const counts = { critical: 0, action: 0, info: 0 };
    state.items.forEach((x) => { counts[notifyPriority(x)]++; });
    host.innerHTML = `
      <div class="notify-center-toolbar">
        <div class="notify-center-search"><span>🔎</span><input id="notify-center-search" class="input" placeholder="Search title, user, page, type…" value="${U.esc(state.filterSearch)}"></div>
        <div class="notify-center-filters">
          <select id="notify-center-priority" class="input">
            <option value="all" ${state.centerPriority === 'all' ? 'selected' : ''}>All priority · ${state.items.length}</option>
            <option value="critical" ${state.centerPriority === 'critical' ? 'selected' : ''}>🚨 Critical · ${counts.critical}</option>
            <option value="action" ${state.centerPriority === 'action' ? 'selected' : ''}>⚡ Action · ${counts.action}</option>
            <option value="info" ${state.centerPriority === 'info' ? 'selected' : ''}>ℹ️ Info · ${counts.info}</option>
          </select>
          <select id="notify-center-date" class="input">
            <option value="all" ${state.centerDate === 'all' ? 'selected' : ''}>Any time</option>
            <option value="today" ${state.centerDate === 'today' ? 'selected' : ''}>Today</option>
            <option value="7d" ${state.centerDate === '7d' ? 'selected' : ''}>Last 7 days</option>
            <option value="30d" ${state.centerDate === '30d' ? 'selected' : ''}>Last 30 days</option>
          </select>
          <button class="btn small" data-center-clear>↺ Clear</button>
        </div>
      </div>
      <div class="notify-center-summary">
        <span>Showing <b>${items.length}</b> of <b>${state.items.length}</b></span>
        <span>${state.unread ? `🔵 <b>${state.unread}</b> unread` : '✅ All caught up'}</span>
        <button class="btn small" data-center-read ${state.unread ? '' : 'disabled'}>✓ Mark all read</button>
      </div>
      <div class="notify-center-list">${items.length ? items.slice(0, 100).map(centerItemHtml).join('') : '<div class="notification-empty">No notifications match these filters.</div>'}</div>`;
    const search = host.querySelector('#notify-center-search');
    if (search) {
      search.addEventListener('input', () => {
        state.filterSearch = search.value;
        clearTimeout(state.centerSearchTimer);
        state.centerSearchTimer = setTimeout(() => centerRender(host), 120);
      });
    }
    const priority = host.querySelector('#notify-center-priority');
    if (priority) priority.addEventListener('change', () => { state.centerPriority = priority.value; centerRender(host); });
    const date = host.querySelector('#notify-center-date');
    if (date) date.addEventListener('change', () => { state.centerDate = date.value; centerRender(host); });
    host.querySelector('[data-center-clear]')?.addEventListener('click', () => {
      state.filterSearch = ''; state.centerPriority = 'all'; state.centerDate = 'all'; centerRender(host);
    });
    host.querySelector('[data-center-read]')?.addEventListener('click', () => markAllRead());
    host.querySelectorAll('[data-center-open]').forEach((btn) => btn.addEventListener('click', () => {
      const item = state.items.find((x) => x.id === btn.dataset.centerOpen);
      if (!item) return;
      FF.app.closeDrawer();
      if (FF.liveView && FF.liveView.openNotification) FF.liveView.openNotification(item);
      else if (item.meta && item.meta.link) location.hash = item.meta.link;
    }));
  }
  function openCenter() {
    if (!hasAccess() || !FF.app || !FF.app.openDrawer) return;
    const hostId = 'notification-center-host';
    FF.app.openDrawer({
      wide: true,
      kicker: '🔔 Notification Center 2.0',
      title: 'Priority Inbox',
      sub: 'Search, priority aur date se alerts filter karo — click se direct detail / source page kholo.',
      body: `<div id="${hostId}"></div>`
    });
    const host = U.$('#' + hostId);
    if (host) centerRender(host);
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
      // Naya item: visible tab par toast + beep, aur (voice ON ho to) bol kar bhi announce.
      if (!initial) fresh.forEach((x) => { browserAlert(x); speakServerItem(x); });
      // Naya signup aaya → sidebar ke pending-approvals badge ko turant update karo.
      if (fresh.some((x) => x.type === 'signup') && FF.app && FF.app.refreshPendingBadge) FF.app.refreshPendingBadge();
      state.items = [...state.items, ...incoming].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i).slice(-100);
      state.lastAt = latestTime(state.items) || out.checkAt || state.lastAt;
      state.seenAt = (FF.auth.user && FF.auth.user.notificationsSeenAt) || state.seenAt;
      state.serverUnread = Number(out.unread) || 0;
      setCount(countUnread());
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
      if ((state.prefs.push === false || state.prefs.enabled === false) && !force) return false;
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
  /** Browser permission maango (agar zaroorat ho) + push subscribe karo. `silent` = koi toast nahi. */
  async function enableBrowser(silent) {
    if (typeof Notification === 'undefined') { if (!silent) U.toast('Is browser me notifications supported nahi hain.', 'err'); return false; }
    unlockAudio(); // sound iOS/Safari me sirf user gesture ke baad chalta hai
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      markPermissionAsked();
      if (permission === 'granted') {
        state.prefs.push = true; savePrefsLocal();
        await setupPush(true, { force: true });
      }
      render();
      if (!silent) {
        U.toast(
          permission !== 'granted' ? 'Browser ne permission nahi di — address bar ke lock icon se Notifications Allow karo, phir switch OFF-ON karo.'
            : state.pushOn ? '🔔 Notifications ON — app ke andar + phone / desktop panel dono par aayengi'
            : '🔔 Notifications ON — in-app alerts chalu. Phone panel push apne aap subscribe ho jaayegi.',
          permission === 'granted' ? 'ok' : 'warn'
        );
      }
      return permission === 'granted';
    } catch { if (!silent) U.toast('Browser notification permission nahi mil saki.', 'err'); return false; }
  }
  /**
   * 🔔 Master switch — panel me yahi EK button hai.
   * ON  → permission maango + web push subscribe (app band ho tab bhi panel me alert).
   * OFF → push unsubscribe + koi toast / browser alert / sound nahi (list andar padh sakte ho).
   */
  async function setEnabled(on, opts) {
    const quiet = !!(opts && opts.quiet);
    unlockAudio();
    if (on) {
      state.prefs.enabled = true; state.prefs.push = true; savePrefsLocal(); render();
      const granted = await enableBrowser(true);
      await savePrefs({ enabled: true, push: true }, true);
      if (!quiet) {
        U.toast(
          granted && state.pushOn ? '🔔 Notifications ON ✓ — phone / desktop ke notification panel par bhi aayengi'
            : granted ? '🔔 Notifications ON ✓ — push subscription ban rahi hai, panel par bhi aayengi'
            : '🔕 In-app notifications ON, par browser permission nahi mili — lock icon se Allow karo',
          granted ? 'ok' : 'warn'
        );
      }
      render();
      return granted;
    }
    state.prefs.enabled = false; savePrefsLocal(); render();
    await disablePush();
    await savePrefs({ enabled: false, push: false }, true);
    if (!quiet) U.toast('🔕 Notifications OFF — ab koi alert nahi aayega', 'info');
    render();
    return false;
  }
  // ---- permission: ek hi baar khud maango (user ko button dhoondhna na pade) ----------------------
  const ASKED_KEY = 'ff_notify_permission_asked';
  function permissionAsked() { try { return localStorage.getItem(ASKED_KEY) === '1'; } catch { return true; } }
  function markPermissionAsked() { try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* ignore */ } }
  /**
   * Login ke baad pehli user interaction par ek hi baar permission prompt dikhao. Isse push bina
   * koi extra button dabaye kaam karne lagta hai — permission milte hi subscription silently ban jaati hai.
   */
  function maybeAskPermission() {
    if (EMBED || !hasAccess()) return false;
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return false;
    if (state.prefs.enabled === false || permissionAsked()) return false;
    if (document.visibilityState !== 'visible') return false;
    markPermissionAsked();
    Promise.resolve(Notification.requestPermission()).then((permission) => {
      if (permission === 'granted') {
        state.prefs.push = true; savePrefsLocal();
        setupPush(true).then(() => render()).catch(() => render());
      } else render();
    }).catch(() => render());
    return true;
  }
  /** OS notification panel ka seedha test — server push se independent (permission + SW check). */
  async function testPanel() {
    unlockAudio(); beep(true);
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
      // Opening the bell must not erase unread state.  Users can filter NEW items and explicitly
      // choose “Mark all read”, which keeps the badge trustworthy across devices.
      render();
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
    // Login ke baad pehli interaction par ek hi baar permission maango — push khud chalu ho jaata hai.
    const askOnGesture = () => {
      if (!hasAccess()) return;
      document.removeEventListener('pointerdown', askOnGesture);
      document.removeEventListener('keydown', askOnGesture);
      maybeAskPermission();
    };
    document.addEventListener('pointerdown', askOnGesture, { passive: true });
    document.addEventListener('keydown', askOnGesture);
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#notification-pop') && !e.target.closest('#notification-btn')) toggle(false);
      // 🔔 Switch — popover ka master ON/OFF + monthly (Settings bhi isi attribute ko use karta hai)
      const sw = e.target.closest('[data-notify-switch]');
      if (sw && !sw.disabled) {
        e.preventDefault(); e.stopPropagation();
        const which = sw.dataset.notifySwitch;
        const on = sw.getAttribute('aria-checked') !== 'true';
        sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on));
        if (which === 'master') setEnabled(on);
        else if (which === 'sound') { savePrefs({ sound: on }); if (on) beep(true); }
        else if (which === 'voice') {
          savePrefs({ voice: on });
          // ON karte hi jo alerts app band hone ke dauraan aaye the wo suna do (permission/gesture yahin hai).
          if (on && FF.pushVoice) { try { FF.pushVoice.flush('pref-on').catch(() => {}); } catch { /* optional */ } }
        } else savePrefs({ [which]: on });
        return;
      }
      // 🔁 Settings → Notifications: ek click me sabhi type ON — signup / search / click / page open /
      // settings / report … sab ek saath chalu (in-app feed + mobile push dono par).
      const allOn = e.target.closest('[data-notify-all-on]');
      if (allOn) {
        e.preventDefault(); e.stopPropagation();
        const patch = { enabled: true, push: true, sound: true, monthly: true, voice: true };
        NOTIFY_TYPES.forEach((t) => { patch[t.key] = true; });
        savePrefs(patch, true);
        enableBrowser(true).then((granted) => {
          if (granted) setupPush(true, { force: true }).catch(() => {});
          // Settings page ke saare type switches visually bhi ON kar do (wahi DOM dobara render hua bina).
          try {
            document.querySelectorAll('[data-notify-switch]').forEach((el) => {
              el.classList.add('on'); el.setAttribute('aria-checked', 'true'); el.disabled = false;
            });
          } catch { /* no DOM */ }
          U.toast(granted ? '✅ Sab notifications ON — app + mobile panel dono par aayengi (app band ho tab bhi)' : '✅ Sab types ON — browser permission mile to phone panel par bhi aayengi', granted ? 'ok' : 'warn');
          render();
        });
        return;
      }
      const enable = e.target.closest('[data-notify-enable]');
      if (enable) { e.preventDefault(); enableBrowser(); return; }
      const prefBox = e.target.closest('[data-pref-toggle]');
      if (prefBox) {
        e.preventDefault(); e.stopPropagation();
        const k = prefBox.dataset.prefToggle;
        const val = prefBox.type === 'checkbox' ? prefBox.checked : prefBox.getAttribute('aria-checked') !== 'true';
        if (k === 'enabled') { setEnabled(val); return; }
        if (k === 'push') { if (val) enableBrowser(); else disablePush().then(() => savePrefs({ push: false })); return; }
        savePrefs({ [k]: val });
        return;
      }
      const openBtn = e.target.closest('[data-notify-open]');
      if (openBtn) { // pehli click → panel ke andar data expand; wapas click → band
        e.preventDefault();
        state.expanded = state.expanded === openBtn.dataset.notifyOpen ? null : openBtn.dataset.notifyOpen;
        render();
        return;
      }
      const gotoBtn = e.target.closest('[data-notify-goto]');
      if (gotoBtn) { // expanded data par click → seedha us page par redirect
        e.preventDefault();
        const item = state.items.find((x) => x.id === gotoBtn.dataset.notifyGoto);
        state.expanded = null;
        toggle(false);
        if (item && item.meta && item.meta.link) location.hash = item.meta.link;
        return;
      }
      const drawerBtn = e.target.closest('[data-notify-drawer]');
      if (drawerBtn) { // poora data drawer me (liveView) — link ho to drawer me hi redirect button ke saath
        e.preventDefault();
        const item = state.items.find((x) => x.id === drawerBtn.dataset.notifyDrawer);
        state.expanded = null;
        toggle(false);
        if (item && FF.liveView) FF.liveView.openNotification(item);
        return;
      }
      const watchBtn = e.target.closest('[data-live-watch]');
      if (watchBtn) { e.preventDefault(); toggle(false); if (FF.liveView) FF.liveView.watch(watchBtn.dataset.liveWatch); return; }
      // 🎙️ Live Assist (v3.26) — pehle mode chuno (voice / video), phir consent request jaati hai.
      const laBtn = e.target.closest('[data-la-request]');
      if (laBtn) {
        e.preventDefault(); toggle(false);
        const username = laBtn.dataset.laRequest;
        if (!FF.liveAssist) { U.toast('Live Assist module load nahi hua', 'err'); return; }
        if (!FF.liveAssist.supported) { U.toast('Is browser me mic/WebRTC support nahi hai — Chrome/Edge use karo', 'err'); return; }
        if (FF.app && FF.app.openDrawer) {
          FF.app.openDrawer({
            kicker: '🎙️ Live Assist', title: `${username} se live baat`,
            sub: 'User ko consent popup dikhega — uski haan ke bina kuch nahi chalega',
            body: `<div class="kd-sec">
              <p class="dim small">Kaunsa session chahiye? User ke screen par request khulegi — wo <b>Allow</b> karega tabhi awaaz/video aayegi. Session ke dauran user ko hamesha 🔴 LIVE indicator dikhta hai.</p>
              <div class="btn-row" style="margin-top:8px">
                <button class="btn primary" id="la-mode-audio">🎙️ Sirf awaaz (voice)</button>
                <button class="btn" id="la-mode-video">🎥 Awaaz + video</button>
              </div></div>`
          });
          const av = U.$('#la-mode-audio'), vv = U.$('#la-mode-video');
          if (av) av.addEventListener('click', () => { FF.app.closeDrawer(); FF.liveAssist.adminRequest(username, 'audio'); });
          if (vv) vv.addEventListener('click', () => { FF.app.closeDrawer(); FF.liveAssist.adminRequest(username, 'video'); });
        } else FF.liveAssist.adminRequest(username, 'audio');
        return;
      }
      const test = e.target.closest('[data-notify-test]');
      if (test) { e.preventDefault(); testSound(); return; }
      const panelTest = e.target.closest('[data-notify-panel-test]');
      if (panelTest) { e.preventDefault(); testPanel(); return; }
      const pushTest = e.target.closest('[data-notify-push-test]');
      if (pushTest) { e.preventDefault(); testPush(); return; }
      // 📅 Settings → "Digest abhi bhejo" — Roz ka morning digest (issuance + stock + cover) turant bhejo.
      const digTest = e.target.closest('[data-notify-digest-test]');
      if (digTest) {
        e.preventDefault(); e.stopPropagation();
        digTest.disabled = true;
        const label = digTest.textContent;
        digTest.textContent = '⏳ Ban raha hai…';
        FF.auth.api('/api/notifications/digest', 'POST', {}).then((out) => {
          if (out && out.ok && out.item) { U.toast('🌅 Digest bhej diya — bell list + phone panel dono par', 'ok'); poll(false); }
          else U.toast('Digest nahi ban paya — pehle ek baar data sync (↻) karke dobara try karo', 'warn');
        }).catch((err) => U.toast('Digest fail: ' + ((err && err.message) || ''), 'err'))
          .finally(() => { digTest.disabled = false; digTest.textContent = label; });
        return;
      }
      const center = e.target.closest('[data-notify-center]');
      if (center) { e.preventDefault(); e.stopPropagation(); toggle(false); openCenter(); return; }
      const filter = e.target.closest('[data-notify-filter]');
      if (filter && filter.dataset.notifyFilter === 'unread') {
        e.preventDefault(); e.stopPropagation(); state.filterUnread = !state.filterUnread; render(); return;
      }
      const read = e.target.closest('[data-notify-read]');
      if (read) { e.preventDefault(); markAllRead(); }
    });
    document.addEventListener('change', (e) => {
      const filter = e.target.closest && e.target.closest('[data-notify-filter="type"]');
      if (filter) { state.filterType = filter.value || 'all'; render(); }
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
    if (state.prefs.enabled === false) return; // 🔕 master switch OFF → push mat banao
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
  function setTone(tone) {
    const selected = VALID_TONES.has(String(tone)) ? String(tone) : DEFAULT_PREFS.tone;
    unlockAudio();
    void savePrefs({ tone: selected }, true);
    beep(true);
    return selected;
  }
  function testSound() { unlockAudio(); beep(true); U.toast('🔊 Test beep', 'info'); } // force: master OFF ho tab bhi test chale
  FF.notifications = { start, stop, poll, toggle, openCenter, activity, logSearch, logClick, track, testSound, setTone, toneOptions: TONE_OPTIONS, render, setupPush, disablePush, enableBrowser, setEnabled, maybeAskPermission, testPanel, testPush, refreshPushStatus, retryPush, browserAlert, localAlert, speakServerItem, noteVoiced, countUnread, unlockAudio, beep, soundOn: () => state.prefs.sound !== false, notifyTypes: NOTIFY_TYPES, get state() { return state; }, get prefs() { return state.prefs; } };
  bind();
})(window.FF);