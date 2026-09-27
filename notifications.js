/* In-app notification centre + browser alerts.
   Browser alerts are opt-in because Notification permission is a browser privacy setting.
   The server keeps the feed (logins, page opens, locations and Google report changes). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const state = { started: false, bound: false, timer: null, presenceTimer: null, fastTimer: null, lastAt: '', items: [], unread: 0, firstPoll: true, page: 'home', pointer: null, people: [], lastInteraction: Date.now(), pointerBound: false, events: [], dirty: false, lastSent: 0, lastScroll: -1 };
  const EMBED = new URLSearchParams(location.search).get('embed') === 'live';
  const sharing = () => localStorage.getItem('ff_presence_pointer') !== '0';
  const esc = U.esc;

  function icon(item) {
    return ({ report: '📊', login: '🔐', activity: '👀', location: '📍', search: '🔍', click: '👆', settings: '⚙️', user: '👤' }[item.type] || '🔔');
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
    const isAdmin = FF.auth.user && FF.auth.user.role === 'admin';
    const rows = state.items.slice().reverse().slice(0, 60).map((item) => `<button type="button" class="notification-item ${item.type || ''}" data-notify-open="${esc(item.id)}" title="Click → poori report: kya change hua">
      <span class="notification-icon">${icon(item)}</span><div><b>${esc(item.title)}</b><p>${esc(item.body)}</p><small>${esc(U.timeLabel(new Date(item.createdAt).getTime()))} · <u>details dekho →</u></small></div></button>`).join('');
    const presence = isAdmin ? `<section class="presence-panel"><div class="presence-title">🟢 User activity <small>Admin only · live / last seen</small></div>${state.people.length ? state.people.map((p) => `<div class="presence-row"><span class="presence-dot ${p.active ? 'is-live' : ''}"></span><div><b>${esc(p.name || p.username)}</b><small>${p.active ? `Active now · ${esc(p.page)}` : `Last active ${esc(U.timeLabel(p.lastSeen))} · last page: ${esc(p.page)}`}</small>${p.lastEvent ? `<small>Last action: ${esc(p.lastEvent.label || p.lastEvent.kind)}</small>` : ''}</div><span class="presence-side"><span class="presence-state">${p.online && p.active ? 'LIVE' : p.online ? 'IDLE' : 'AWAY'}</span>${isAdmin ? `<button class="btn small" data-live-watch="${esc(p.username)}">👁 Live view</button>` : ''}</span></div>`).join('') : '<div class="notification-empty">Users seen after this server started will appear here.</div>'}</section>` : '';
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
      const openBtn = e.target.closest('[data-notify-open]');
      if (openBtn) { e.preventDefault(); const item = state.items.find((x) => x.id === openBtn.dataset.notifyOpen); toggle(false); if (item && FF.liveView) FF.liveView.openNotification(item); return; }
      const watchBtn = e.target.closest('[data-live-watch]');
      if (watchBtn) { e.preventDefault(); toggle(false); if (FF.liveView) FF.liveView.watch(watchBtn.dataset.liveWatch); return; }
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
  function start() {
    bind();
    if (state.started || EMBED) return;
    state.started = true;
    poll(true);
    sendPresence();
    state.timer = setInterval(() => poll(false), 15e3);
    // Heartbeat every 15s; while the user is moving / clicking, send ~1x per second (live cursor for admin).
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
  FF.notifications = { start, stop, poll, toggle, activity, logSearch, logClick, track, get state() { return state; } };
  bind();
})(window.FF);
