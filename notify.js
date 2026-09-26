/* 🔔 Notification center: in-app bell + browser (Web) notifications + activity tracking.
   Server feeds events (daily bank-report, logins, site opens, signups, resets, settings, locations)
   via /api/notifications — we poll it, toast + browser-notify on new items, and keep the bell badge
   live. Also reports "site opened" (/api/track/open) and the user's location (/api/track/location). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const POLL_MS = 30 * 1000;
  const state = { items: [], unread: 0, seen: new Set(), started: false, open: false, timer: null, lastOpenAt: 0, locAsked: false };

  const TYPE_ICON = {
    'daily-report': '📊', login: '🔔', visit: '👋', signup: '🆕', 'reset-request': '🔑',
    'reset-done': '🔓', 'reset-code': '🔢', settings: '⚙️', 'user-create': '➕',
    'user-update': '👤', 'user-delete': '🗑️', location: '📍', test: '🧪', 'first-admin': '👑'
  };

  function bellHtml() {
    return `<button class="icon-btn notif-btn" id="notif-btn" aria-label="Notifications" title="Notifications">
        <span class="notif-ico">🔔</span><span class="notif-badge" id="notif-badge" hidden>0</span>
      </button>
      <div class="notif-menu" id="notif-menu" hidden>
        <div class="notif-head">
          <b>🔔 Notifications</b>
          <button class="link-btn" id="notif-read-all">Sab padh liya</button>
        </div>
        <div class="notif-list" id="notif-list"></div>
        <div class="notif-foot">
          <button class="btn small" id="notif-perm">🔔 Browser notifications</button>
          <button class="btn small" id="notif-loc">📍 Location bhejo</button>
          ${FF.auth && FF.auth.isAdmin() ? '<button class="btn small" id="notif-test">🧪 Test</button>' : ''}
        </div>
      </div>`;
  }

  function itemHtml(n) {
    const icon = n.icon || TYPE_ICON[n.type] || '🔔';
    const when = U.timeLabel(new Date(n.at).getTime());
    const unread = !(n.read || {})[(FF.auth.user || {}).username];
    return `<div class="notif-item ${unread ? 'unread' : ''}" data-id="${esc(n.id)}">
      <span class="notif-item-ico">${icon}</span>
      <div class="notif-item-main"><b>${esc(n.title)}</b><small>${esc(n.body || '').replace(/\n/g, '<br>')}</small><em>${esc(when)}</em></div>
    </div>`;
  }

  function render() {
    const badge = U.$('#notif-badge');
    if (badge) {
      badge.hidden = !state.unread;
      badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
    }
    const list = U.$('#notif-list');
    if (list) {
      list.innerHTML = state.items.length
        ? state.items.map(itemHtml).join('')
        : '<div class="notif-empty">Abhi koi notification nahi 🎉<br><small class="dim">Daily bank report, logins, site opens… sab yahan aayega.</small></div>';
    }
    const btn = U.$('#notif-btn');
    if (btn) btn.classList.toggle('has-unread', !!state.unread);
  }

  function toggleMenu(force) {
    const menu = U.$('#notif-menu');
    if (!menu) return;
    const show = force !== undefined ? force : menu.hidden;
    menu.hidden = !show;
    state.open = show;
    const btn = U.$('#notif-btn');
    if (btn) btn.classList.toggle('open', show);
    if (show) markRead(true);
  }

  async function markRead(silent) {
    try {
      await FF.auth.api('/api/notifications/read', 'POST', {});
      state.items.forEach((n) => { n.read = n.read || {}; n.read[(FF.auth.user || {}).username] = new Date().toISOString(); });
      state.unread = 0;
      render();
      if (!silent) U.toast('Sab notifications padh liye ✓', 'ok');
    } catch (err) { if (!silent) U.toast(err.message, 'err'); }
  }

  function pushBrowser(n) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const note = new Notification(n.title, { body: String(n.body || '').slice(0, 300), icon: 'icon-192.png', badge: 'icon-192.png', tag: n.id, requireInteraction: n.type === 'daily-report' });
      note.onclick = () => { window.focus(); note.close(); toggleMenu(true); };
    } catch { /* kuch browsers me constructor fail hota hai — ignore */ }
  }

  async function poll(first) {
    try {
      const out = await FF.auth.api('/api/notifications');
      const items = out.items || [];
      const fresh = items.filter((n) => !state.seen.has(n.id));
      if (!first && state.started) {
        fresh.slice(0, 5).forEach((n) => {
          U.toast(`${(TYPE_ICON[n.type] || '🔔')} ${n.title}`);
          pushBrowser(n);
        });
      }
      items.forEach((n) => state.seen.add(n.id));
      state.items = items;
      state.unread = out.unread || 0;
      render();
    } catch { /* network / session — agli poll par dekhenge */ }
  }

  // ---- activity tracking -----------------------------------------------------------------------
  async function trackOpen() {
    const now = Date.now();
    if (now - state.lastOpenAt < 5 * 60e3) return;
    state.lastOpenAt = now;
    try { await FF.auth.api('/api/track/open', 'POST', { page: location.hash }); } catch { /* ignore */ }
  }

  function sendLocation(silent) {
    if (!navigator.geolocation) { if (!silent) U.toast('Is browser me location support nahi hai', 'err'); return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await FF.auth.api('/api/track/location', 'POST', {
          lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy
        });
        if (!silent) U.toast('Location server ko bhej di ✓', 'ok');
        FF.auth.refreshUser && FF.auth.refreshUser().catch(() => {});
      } catch (err) { if (!silent) U.toast(err.message, 'err'); }
    }, (err) => {
      if (!silent) U.toast(err.code === 1 ? 'Location permission denied — browser settings se allow karo' : 'Location nahi mil payi', 'err');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60e3 });
  }

  function requestPermission() {
    if (typeof Notification === 'undefined') { U.toast('Is browser me notifications support nahi hain', 'err'); return; }
    if (Notification.permission === 'granted') { U.toast('Browser notifications already ON hain 🔔', 'ok'); return; }
    Notification.requestPermission().then((p) => {
      if (p === 'granted') {
        U.toast('Browser notifications ON ✓ — nayi report / activity aapko seedha milegi', 'ok');
        pushBrowser({ id: 'welcome', title: '🔔 Notifications ON', body: `${FF.config.appName} — ab aapko daily report aur activity updates browser me milenge.` });
      } else {
        U.toast('Permission nahi mili — browser settings se allow karo', 'err');
      }
      render();
    }).catch(() => {});
  }

  async function sendTest() {
    try {
      await FF.auth.api('/api/notifications/test', 'POST', { title: 'Test notification', body: 'Ye test hai — daily bank report aise hi dikhega. 🎉' });
      U.toast('Test notification bheja ✓', 'ok');
      poll(false);
    } catch (err) { U.toast(err.message, 'err'); }
  }

  // ---- boot ------------------------------------------------------------------------------------
  function mount() {
    const wrap = U.$('#notif-wrap');
    if (wrap) wrap.innerHTML = bellHtml();
    const btn = U.$('#notif-btn');
    if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
    const readAll = U.$('#notif-read-all');
    if (readAll) readAll.addEventListener('click', (e) => { e.stopPropagation(); markRead(false); });
    const perm = U.$('#notif-perm');
    if (perm) perm.addEventListener('click', (e) => { e.stopPropagation(); requestPermission(); });
    const loc = U.$('#notif-loc');
    if (loc) loc.addEventListener('click', (e) => { e.stopPropagation(); sendLocation(false); });
    const test = U.$('#notif-test');
    if (test) test.addEventListener('click', (e) => { e.stopPropagation(); sendTest(); });
    document.addEventListener('click', (e) => {
      if (state.open && !e.target.closest('#notif-wrap')) toggleMenu(false);
    });
    render();
  }

  function start() {
    if (state.started) return;
    state.started = true;
    mount();
    poll(true);
    state.timer = setInterval(() => poll(false), POLL_MS);
    trackOpen();
    setInterval(trackOpen, 15 * 60e3);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { trackOpen(); poll(false); } });

    // Location: sirf ek baar poochho, wo bhi tab jab user ne permission pehle di ho
    // (auto-prompt login ke turant baad — user gesture ke saath, taaki browser block na kare).
    if (!state.locAsked && navigator.permissions && navigator.geolocation) {
      state.locAsked = true;
      navigator.permissions.query({ name: 'geolocation' }).then((st) => {
        if (st.state === 'granted') sendLocation(true);
        st.onchange = () => { if (st.state === 'granted') sendLocation(true); };
      }).catch(() => {});
    }
  }

  FF.notify = {
    start, mount, poll, requestPermission, sendLocation, sendTest, toggleMenu,
    get items() { return state.items; }, get unread() { return state.unread; }
  };
})(window.FF);
