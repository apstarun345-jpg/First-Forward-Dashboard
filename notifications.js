/* In-app notification centre + browser alerts.
   Browser alerts are opt-in because Notification permission is a browser privacy setting.
   The server keeps the feed (logins, page opens, locations and Google report changes). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const state = { started: false, bound: false, timer: null, presenceTimer: null, lastAt: '', items: [], unread: 0, firstPoll: true, page: 'home', pointer: null, people: [], lastInteraction: Date.now(), pointerBound: false };
  const esc = U.esc;

  function icon(item) {
    return ({ report: '📊', login: '🔐', activity: '👀', location: '📍', search: '🔍', click: '👆' }[item.type] || '🔔');
  }
  function canBrowserAlert() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }
  function browserAlert(item) {
    if (!canBrowserAlert() || !item || document.visibilityState === 'visible') return;
    try {
      const n = new Notification(`${icon(item)} ${item.title}`, { body: item.body, icon: FF.config.logo || 'icon-192.png', tag: item.type || 'ff-notification' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* browsers can still reject notifications in private mode */ }
  }
  function setCount(n) {
    state.unread = Math.max(0, Number(n) || 0);
    const badge = U.$('#notification-count');
    if (badge) { badge.textContent = state.unread > 99 ? '99+' : String(state.unread); badge.hidden = state.unread < 1; }
  }
  function latestTime(items) {
    return (items || []).reduce((max, x) => !max || x.createdAt > max ? x.createdAt : max, '');
  }
  function render() {
    const pop = U.$('#notification-pop');
    if (!pop) return;
    const browser = typeof Notification !== 'undefined';
    const permission = browser ? Notification.permission : 'unsupported';
    const rows = state.items.slice().reverse().slice(0, 40).map((item) => `<div class="notification-item ${item.type || ''}">
      <span class="notification-icon">${icon(item)}</span><div><b>${esc(item.title)}</b><p>${esc(item.body)}</p><small>${esc(U.timeLabel(new Date(item.createdAt).getTime()))}</small></div></div>`).join('');
    const presence = FF.auth.user && FF.auth.user.role === 'admin' ? `<section class="presence-panel"><div class="presence-title">🟢 User activity <small>Admin only · live / last seen</small></div>${state.people.length ? state.people.map((p) => `<div class="presence-row"><span class="presence-dot ${p.active ? 'is-live' : ''}"></span><div><b>${esc(p.name || p.username)}</b><small>${p.active ? `Active now · ${esc(p.page)}` : `Last active ${esc(U.timeLabel(p.lastSeen))} · last page: ${esc(p.page)}`}</small>${p.active && p.pointer ? `<small>Pointer: ${Math.round(p.pointer.x)}% from left, ${Math.round(p.pointer.y)}% from top</small>` : ''}</div><span class="presence-state">${p.active ? 'LIVE' : 'AWAY'}</span></div>`).join('') : '<div class="notification-empty">Users seen after this server started will appear here.</div>'}</section>` : '';
    pop.innerHTML = `<div class="notification-head"><div><b>Notifications</b><small>${state.unread ? `${state.unread} unread` : 'Sab updated hai'}</small></div><button class="btn small" data-notify-read>✓ Mark read</button></div>
      ${presence}
      ${permission === 'default' ? '<button class="notification-enable" data-notify-enable>🔔 Browser alerts on karo</button>' : permission === 'denied' ? '<div class="notification-permission">Browser alerts blocked hain — browser settings se allow karo.</div>' : permission === 'granted' ? '<div class="notification-permission ok">✅ Browser alerts on hain</div>' : ''}
      <div class="notification-list">${rows || '<div class="notification-empty">Abhi koi notification nahi. User login/page open, report update aur shared location yahan dikhegi.</div>'}</div>`;
  }
  async function poll(initial) {
    if (!FF.auth || !FF.auth.user) return;
    try {
      const qs = state.lastAt && !initial ? `?since=${encodeURIComponent(state.lastAt)}` : '';
      const out = await FF.auth.api(`/api/notifications${qs}`);
      const incoming = Array.isArray(out.items) ? out.items : [];
      const known = new Set(state.items.map((x) => x.id));
      const fresh = incoming.filter((x) => !known.has(x.id));
      if (!initial) fresh.forEach(browserAlert);
      state.items = [...state.items, ...incoming].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i).slice(-100);
      state.lastAt = latestTime(state.items) || out.checkAt || state.lastAt;
      setCount(out.unread);
      if (FF.auth.user && FF.auth.user.role === 'admin') {
        try { const live = await FF.auth.api('/api/presence'); state.people = Array.isArray(live.people) ? live.people : []; } catch { /* unavailable on older server */ }
      }
      render();
    } catch (err) {
      if (err && err.status === 401) stop();
    } finally { state.firstPoll = false; }
  }
  async function enableBrowser() {
    if (typeof Notification === 'undefined') { U.toast('Is browser me notifications supported nahi hain.', 'err'); return; }
    try {
      const permission = await Notification.requestPermission();
      render();
      U.toast(permission === 'granted' ? 'Browser alerts on ✓' : 'Browser alerts allow nahi hue.', permission === 'granted' ? 'ok' : 'warn');
    } catch { U.toast('Browser notification permission nahi mil saki.', 'err'); }
  }
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
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#notification-pop') && !e.target.closest('#notification-btn')) toggle(false);
      const enable = e.target.closest('[data-notify-enable]');
      if (enable) { e.preventDefault(); enableBrowser(); }
      const read = e.target.closest('[data-notify-read]');
      if (read) { e.preventDefault(); FF.auth.api('/api/notifications/read', 'POST', {}).catch(() => {}); setCount(0); render(); }
    });
  }
  function sendPresence() {
    if (!FF.auth || !FF.auth.user) return;
    const pointerEnabled = localStorage.getItem('ff_presence_pointer') !== '0';
    FF.auth.api('/api/presence', 'POST', { page: state.page, pointer: pointerEnabled ? state.pointer : null, engaged: Date.now() - state.lastInteraction < 90e3 }).catch(() => {});
  }
  function start() {
    bind();
    if (state.started) return;
    state.started = true;
    poll(true);
    sendPresence();
    state.timer = setInterval(() => poll(false), 15e3);
    state.presenceTimer = setInterval(sendPresence, 15e3);
    if (!state.pointerBound) {
      state.pointerBound = true;
      document.addEventListener('pointermove', (e) => {
        state.lastInteraction = Date.now();
        if (localStorage.getItem('ff_presence_pointer') === '0') return;
        state.pointer = { x: Math.round((e.clientX / Math.max(1, window.innerWidth)) * 100), y: Math.round((e.clientY / Math.max(1, window.innerHeight)) * 100) };
      }, { passive: true });
      ['click', 'keydown', 'wheel', 'touchstart'].forEach((type) => document.addEventListener(type, () => { state.lastInteraction = Date.now(); }, { passive: true }));
    }
  }
  function stop() { clearInterval(state.timer); clearInterval(state.presenceTimer); state.timer = null; state.presenceTimer = null; state.started = false; }
  function activity(page) {
    if (!FF.auth || !FF.auth.user) return;
    state.page = String(page || 'dashboard');
    state.lastInteraction = Date.now();
    FF.auth.api('/api/activity', 'POST', { page: state.page }).catch(() => {});
    sendPresence();
  }
  let searchDebounceTimer = null;
  function logSearch(option, query) {
    if (!FF.auth || !FF.auth.user || !query || !String(query).trim()) return;
    const q = String(query).trim();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
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
  FF.notifications = { start, stop, poll, toggle, activity, logSearch, logClick, get state() { return state; } };
  bind();
})(window.FF);
