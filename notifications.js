/* In-app notification centre + browser alerts.
   Browser alerts are opt-in because Notification permission is a browser privacy setting.
   The server keeps the feed (logins, page opens, locations and Google report changes). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const state = { started: false, bound: false, timer: null, lastAt: '', items: [], unread: 0, firstPoll: true };
  const esc = U.esc;

  function icon(item) {
    return ({ report: '📊', login: '🔐', activity: '👀', location: '📍' }[item.type] || '🔔');
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
    pop.innerHTML = `<div class="notification-head"><div><b>Notifications</b><small>${state.unread ? `${state.unread} unread` : 'Sab updated hai'}</small></div><button class="btn small" data-notify-read>✓ Mark read</button></div>
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
  function start() {
    bind();
    if (state.started) return;
    state.started = true;
    poll(true);
    state.timer = setInterval(() => poll(false), 45e3);
  }
  function stop() { clearInterval(state.timer); state.timer = null; state.started = false; }
  function activity(page) {
    if (!FF.auth || !FF.auth.user) return;
    FF.auth.api('/api/activity', 'POST', { page: page || 'dashboard' }).catch(() => {});
  }
  FF.notifications = { start, stop, poll, toggle, activity, get state() { return state; } };
  bind();
})(window.FF);
