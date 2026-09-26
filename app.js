/* App shell: login gate, sidebar (grouped + permission aware), top-right user menu, hash router, drawer.
   Data is preloaded once after login (FF.store + FF.gv) — no auto refresh; ↻ = fresh data from Google. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;

  // Pages registry — `group` decides the sidebar section, `perm` the access key.
  const PAGES = [
    { id: 'home', icon: '🏠', label: 'Home', desc: 'Greeting · overview · shortcuts', perm: 'home', group: 'Main' },
    { id: 'dashboard', icon: '📊', label: 'Dashboard', desc: 'KPIs & charts (EIR)', perm: 'dashboard', group: 'First Forward' },
    { id: 'trend', icon: '📈', label: 'Trend', desc: 'Daily · Monthly · Last vs Current', perm: 'trend', group: 'First Forward' },
    { id: 'performance', icon: '🏆', label: 'Performance', desc: 'Agents & TLs (REPORT)', perm: 'performance', group: 'First Forward' },
    { id: 'stock', icon: '📦', label: 'Stock', desc: 'Search · pivot · Excel (StockDataa)', perm: 'stock', group: 'First Forward' },
    { id: 'gvDashboard', icon: '🚀', label: 'GV Partner Dashboard', desc: 'GV issuance · stock · performance', perm: 'gvDashboard', group: 'GV Partner' },
    { id: 'gvTrend', icon: '📈', label: 'GV Trend', desc: 'GV Master daily / monthly', perm: 'gvTrend', group: 'GV Partner' },
    { id: 'gvPerformance', icon: '🏆', label: 'GV Performance', desc: 'GV agents & TLs (GV REPORT)', perm: 'gvPerformance', group: 'GV Partner' },
    { id: 'gvStock', icon: '📦', label: 'GV Stock', desc: 'Tag Assignment stock search', perm: 'gvStock', group: 'GV Partner' },
    { id: 'compare', icon: '⚖️', label: 'GV vs First Forward', desc: 'Dono ka side-by-side comparison', perm: 'compare', group: 'GV Partner' }
  ];
  const GROUP_ICON = { 'Main': '🏠', 'First Forward': '🟦', 'GV Partner': '🟩' };
  const pageDef = (id) => PAGES.find((p) => p.id === id) || null;
  let current = { page: '', params: {}, token: 0 };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const segs = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const params = {};
    new URLSearchParams(queryPart || '').forEach((v, k) => { params[k] = v; });
    let page = segs[0] || firstAllowedPage();
    if (page === 'sheet') { params.name = segs.slice(1).join('/'); }
    if (!FF.pages[page]) { const alias = { gvPartner: 'gvDashboard', comparison: 'compare', gvd: 'gvDashboard' }; page = alias[page] || firstAllowedPage(); }
    return { page, params };
  }
  function buildHash(page, params) {
    const p = { ...params };
    let path = `#/${page}`;
    if (page === 'sheet') { path += `/${encodeURIComponent(p.name || '')}`; delete p.name; }
    const q = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
  }
  function navigate(page, params) { location.hash = buildHash(page, params || {}); }
  function updateParams(patch) { navigate(current.page, { ...current.params, ...patch }); }
  function pagePerm(page, params) {
    if (page === 'sheet') return `sheet:${(params && params.name) || ''}`;
    if (page === 'settings') return null; // every logged-in user gets "My account"; admin sections are gated inside
    const p = pageDef(page);
    return p ? p.perm : null;
  }
  function allowed(page, params) { const perm = pagePerm(page, params); return !perm || FF.auth.can(perm); }
  function enabledTabs() { return (FF.config.allTabs ? FF.config.allTabs(true) : (FF.config.sheets || [])); }
  function firstAllowedPage() {
    if (FF.auth.can('home')) return 'home';
    const p = PAGES.find((x) => x.perm !== 'home' && FF.auth.can(x.perm));
    if (p) return p.id;
    const s = enabledTabs().find((x) => FF.auth.can(`sheet:${x.id}`));
    return s ? 'sheet' : 'settings';
  }

  // ---- sidebar ----------------------------------------------------------------------------------
  function navItem(id, icon, label, desc, active, href) {
    return `<a class="nav-item ${active ? 'active' : ''}" data-page="${id}" href="${href}"><span class="nav-ico">${icon}</span><span class="nav-text"><b>${esc(label)}</b><small>${esc(desc || '')}</small></span></a>`;
  }
  function renderSidebar() {
    const nav = U.$('#nav');
    if (!nav) return;
    const u = FF.auth.user;
    const sheets = enabledTabs().filter((s) => FF.auth.can(`sheet:${s.id}`));
    const groups = [...new Set(PAGES.map((p) => p.group))];
    let html = '';
    for (const group of groups) {
      const items = PAGES.filter((p) => p.group === group && FF.auth.can(p.perm));
      const groupSheets = group === 'Main' ? [] : sheets.filter((s) => (s.group || 'First Forward') === group);
      if (!items.length && !groupSheets.length) continue;
      const label = group === 'Main' ? '' : `${GROUP_ICON[group] || ''} ${group}`;
      html += `<div class="nav-sec ${group === 'GV Partner' ? 'gv' : group === 'First Forward' ? 'ff' : ''}">${label}${group === 'First Forward' || group === 'GV Partner' ? `<span class="nav-count">${items.length + groupSheets.length}</span>` : ''}</div>`;
      html += items.map((p) => navItem(p.id, p.icon, p.label, p.desc, current.page === p.id, `#/${p.id}`)).join('');
      if (groupSheets.length) {
        html += `<div class="nav-sub">Sheets</div>`;
        html += groupSheets.map((s) => `<a class="nav-item sheet ${current.page === 'sheet' && current.params.name === s.id ? 'active' : ''}" data-page="sheet" data-name="${esc(s.id)}" href="#/sheet/${encodeURIComponent(s.id)}"><span class="nav-ico">${s.icon || '📄'}</span><span class="nav-text"><b>${esc(s.id)}</b><small>${esc(s.desc || '')}</small></span></a>`).join('');
      }
    }
    html += `<div class="nav-sec">Account</div>` + navItem('settings', '⚙️', 'Settings', u && u.role === 'admin' ? 'Branding · data · users · access' : 'My account', current.page === 'settings', '#/settings');
    nav.innerHTML = html;

    const foot = U.$('#user-box');
    if (foot && u) foot.innerHTML = `<div class="user-chip">${FF.auth.avatarHtml(u, 'sm')}<span class="user-text"><b>${esc(u.name || u.username)}</b><small>${FF.auth.roleLabel(u)}</small></span><button class="icon-btn small" id="logout-btn" title="Logout">⎋</button></div>`;
    const lb = U.$('#logout-btn'); if (lb) lb.addEventListener('click', () => FF.auth.logout());
    renderTopUser();
  }

  // ---- top-right user menu ----------------------------------------------------------------------
  function renderTopUser() {
    const u = FF.auth.user;
    const btn = U.$('#user-btn');
    if (!btn || !u) return;
    btn.innerHTML = `${FF.auth.avatarHtml(u, 'top')}<span class="user-btn-text"><b>${esc(u.name || u.username)}</b><small>${FF.auth.roleLabel(u)}</small></span><span class="chev">▾</span>`;
    const menu = U.$('#user-menu');
    if (!menu) return;
    menu.innerHTML = `
      <div class="user-menu-head">
        ${FF.auth.avatarHtml(u, 'lg')}
        <div class="um-info"><b>${esc(u.name || u.username)}</b><span class="dim">@${esc(u.username)}</span>
          ${u.email ? `<a class="um-email" href="mailto:${esc(u.email)}">✉️ ${esc(u.email)}</a>` : '<span class="dim small">email set nahi hai</span>'}
          ${u.mobile ? `<span class="dim small">📞 ${esc(u.mobile)}</span>` : ''}
          <span class="badge ${u.role === 'admin' ? 'indigo' : 'gray'}">${FF.auth.roleLabel(u)}</span>
        </div>
      </div>
      <div class="user-menu-body">
        <a href="#/home" data-close-menu>🏠 Home</a>
        <a href="#/settings?tab=account" data-close-menu>👤 My account</a>
        <a href="#/settings?tab=account" data-close-menu>🔑 Password badlo</a>
        <label class="um-upload">🖼️ Photo upload / badlo<input type="file" accept="image/*" id="um-avatar" hidden></label>
        <a href="#" id="um-loc" data-close-menu>📍 Location share karo</a>
        ${FF.auth.isAdmin() ? `<a href="#/settings?tab=access" data-close-menu>🔐 Access matrix (admin)</a><a href="#/settings?tab=sources" data-close-menu>🗂️ Sheets &amp; tabs (admin)</a>` : ''}
        ${u.mustChangePassword ? '<div class="um-warn">⚠️ Default password chal raha hai — badal lo</div>' : ''}
        <button class="um-logout" id="user-logout">⎋ Logout</button>
      </div>
      <div class="user-menu-foot dim small">Last login ${u.lastLoginAt ? U.timeLabel(new Date(u.lastLoginAt).getTime()) : '—'}</div>`;
    const logout = U.$('#user-logout', menu);
    if (logout) logout.addEventListener('click', () => FF.auth.logout());
    const locBtn = U.$('#um-loc', menu);
    if (locBtn) locBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (FF.notify && FF.notify.sendLocation) FF.notify.sendLocation(false);
      else U.toast('Location module load nahi hua', 'err');
    });
    const up = U.$('#um-avatar', menu);
    if (up) up.addEventListener('change', async () => {
      const file = up.files && up.files[0];
      if (!file) return;
      try {
        const dataUrl = await readAvatar(file);
        await FF.auth.api('/api/auth/profile', 'POST', { avatar: dataUrl });
        await FF.auth.refreshUser();
        renderSidebar();
        U.toast('Profile photo update ho gayi ✓', 'ok');
      } catch (err) { U.toast(err.message, 'err'); }
    });
  }
  function readAvatar(file, maxSide) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error('Sirf image file (PNG / JPG / WEBP)'));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const size = maxSide || 256;
        const scale = Math.min(1, size / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load nahi hui')); };
      img.src = url;
    });
  }
  function toggleUserMenu(force) {
    const menu = U.$('#user-menu');
    const btn = U.$('#user-btn');
    if (!menu) return;
    const show = force !== undefined ? force : menu.hidden;
    menu.hidden = !show;
    if (btn) btn.classList.toggle('open', show);
  }

  function markActive() {
    U.$$('#nav .nav-item').forEach((a) => {
      const on = a.dataset.page === current.page && (current.page !== 'sheet' || a.dataset.name === current.params.name);
      a.classList.toggle('active', on);
    });
    const title = current.page === 'sheet' ? (current.params.name || 'Sheet') : (FF.pages[current.page] && FF.pages[current.page].title) || '';
    U.$('#top-title').textContent = title;
    document.title = `${title} · ${FF.config.appName}`;
  }

  async function renderCurrent(ctx) {
    const { page, params } = parseHash();
    current = { page, params, token: current.token + 1 };
    const token = current.token;
    markActive();
    closeSidebar();
    const main = U.$('#main');
    const root = document.createElement('div');
    root.className = `page page-${page}`;
    main.replaceChildren(root);
    main.scrollTop = 0; window.scrollTo(0, 0);
    if (!allowed(page, params)) {
      root.innerHTML = `<div class="empty-state">🔒 Is page ka access aapke account me nahi hai.<br><small class="dim">Admin se "${esc(pagePerm(page, params) || page)}" permission maango (Settings → Access matrix).</small></div>`;
      return;
    }
    try {
      await FF.pages[page].render(root, params, ctx || {});
    } catch (err) {
      console.error(err);
      if (token === current.token) root.innerHTML = U.errorBox(err, 'data-action="refresh"');
    }
    if (token === current.token) updateStatus();
  }
  function updateStatus(progress) {
    const el = U.$('#status');
    if (!el) return;
    const st = FF.store.state, gv = FF.gv ? FF.gv.state : null;
    const loading = st.loading || (gv && gv.loading);
    if (loading) {
      const p = st.loading ? st.progress : gv.progress;
      const extra = st.loading && gv && gv.loading ? ' (FF + GV)' : st.loading ? ' (FF)' : ' (GV)';
      el.innerHTML = `<span class="dot busy"></span> Loading ${p.done}/${p.total}${extra}…`;
      return;
    }
    const t = FF.store.loadedAt || (gv && gv.loadedAt);
    const errs = Object.keys(st.errors || {}).length + (gv ? Object.keys(gv.errors || {}).length : 0);
    el.innerHTML = t ? `<span class="dot ${errs ? 'warn' : 'live'}"></span> Data ${U.timeLabel(t)}${errs ? ` · ${errs} failed` : ''}` : '<span class="dot"></span> Ready';
    const btn = U.$('#top-refresh'); if (btn) btn.classList.remove('spin');
  }
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    const fresh = FF.auth.can('refresh');
    U.toast(fresh ? 'Google Sheet se fresh data la rahe hain…' : 'Data reload ho raha hai…');
    const btn = U.$('#top-refresh'); if (btn) btn.classList.add('spin');
    try {
      if (FF.pages.performance && FF.pages.performance.reset) FF.pages.performance.reset();
      FF.store.reset();
      if (FF.gv) FF.gv.reset();
      await Promise.all([FF.store.preload(true).catch(() => {}), FF.gv && FF.gv.enabled() ? FF.gv.preload(true).catch(() => {}) : Promise.resolve()]);
    } catch (err) { console.error(err); }
    refreshing = false;
    await renderCurrent({ fresh });
    U.toast('Data updated ✓', 'ok');
  }

  // ---- drawer -------------------------------------------------------------------
  function openDrawer({ kicker, title, sub, body, actions }) {
    U.$('#drawer-kicker').textContent = kicker || '';
    U.$('#drawer-title').textContent = title || '';
    U.$('#drawer-sub').innerHTML = sub || '';
    U.$('#drawer-actions').innerHTML = actions || '';
    U.$('#drawer-body').innerHTML = body || '';
    U.$('#drawer').classList.add('open');
    U.$('#drawer-backdrop').hidden = false;
    document.body.classList.add('no-scroll');
    U.$('#drawer-body').scrollTop = 0;
    if (FF.charts && FF.charts.mount) FF.charts.mount(U.$('#drawer-body'));
  }
  function closeDrawer() {
    U.$('#drawer').classList.remove('open');
    U.$('#drawer-backdrop').hidden = true;
    document.body.classList.remove('no-scroll');
  }
  function closeSidebar() { document.body.classList.remove('side-open'); }

  function exportCard(btn) {
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const card = btn.closest('.card') || document;
    const table = card.querySelector('table');
    if (!table) { U.toast('Is card me table nahi hai', 'err'); return; }
    const rows = U.tableToRows(table);
    U.downloadCsv(`${btn.dataset.name || 'export'}-${U.stamp()}.csv`, rows[0] || [], rows.slice(1));
    U.toast('CSV downloaded');
  }
  /** Share helper: data-share="wa|mail|copy" with data-text (and optional data-phone / data-subject / data-to) */
  async function share(el) {
    if (!FF.auth.can('share')) { U.toast('Share permission nahi hai', 'err'); return; }
    const text = el.dataset.text || '';
    const kind = el.dataset.share;
    if (kind === 'copy') { await U.copyText(text); U.toast('Copied ✓', 'ok'); return; }
    if (kind === 'mail') { location.href = U.mailLink(el.dataset.subject || FF.config.appName, text, el.dataset.to || FF.config.contacts.teamEmail); return; }
    await U.copyText(text);
    window.open(U.waLink(text, el.dataset.phone || ''), '_blank', 'noopener');
    U.toast('Message copied — WhatsApp khul raha hai');
  }

  function bind() {
    window.addEventListener('hashchange', () => { renderCurrent(); toggleUserMenu(false); });
    U.$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('side-open'));
    U.$('#side-backdrop').addEventListener('click', closeSidebar);
    U.$('#top-refresh').addEventListener('click', refresh);
    const ub = U.$('#user-btn');
    if (ub) ub.addEventListener('click', (e) => { e.stopPropagation(); toggleUserMenu(); });
    U.$('#drawer-close').addEventListener('click', closeDrawer);
    U.$('#drawer-backdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeSidebar(); toggleUserMenu(false); } });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#user-menu') && !e.target.closest('#user-btn')) toggleUserMenu(false);
      if (e.target.closest('#user-menu a')) toggleUserMenu(false);
      const sh = e.target.closest('[data-share]');
      if (sh) { e.preventDefault(); share(sh); return; }
      const act = e.target.closest('[data-action]');
      if (act) {
        const a = act.dataset.action;
        if (a === 'refresh') refresh();
        else if (a === 'export') exportCard(act);
        else if (a === 'clear-filters') updateParams({ tl: '', agent: '' });
        else if (a === 'close-drawer') closeDrawer();
        return;
      }
      const link = e.target.closest('[data-link]');
      if (link && !e.target.closest('a')) { location.hash = link.dataset.link; return; }
      const paramBtn = e.target.closest('button[data-param]');
      if (paramBtn) { updateParams({ [paramBtn.dataset.param]: paramBtn.dataset.value }); }
      const drawerLink = e.target.closest('#drawer a[href^="#/"]');
      if (drawerLink) closeDrawer();
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('select[data-param], input[data-param]');
      if (el) updateParams({ [el.dataset.param]: el.value, ...(el.dataset.param === 'tl' ? { agent: '' } : {}), ...(el.dataset.param === 'agent' ? { tl: '' } : {}) });
    });
    FF.store.on((ev, detail) => { if (ev === 'progress' || ev === 'start' || ev === 'done') updateStatus(detail); });
  }

  function onLogin() {
    renderSidebar();
    FF.auth.applyTheme();
    document.body.classList.add('ready');
    FF.store.preload(false).catch(() => {});
    if (FF.gv && FF.gv.enabled()) FF.gv.preload(false).catch(() => {});
    renderCurrent();
    if (FF.notify && FF.notify.start) FF.notify.start();
    const u = FF.auth.user;
    if (u && u.mustChangePassword) setTimeout(() => U.toast('⚠️ Default password chal raha hai — Settings → My account se badlo', 'err'), 900);
  }

  async function init() {
    U.initTooltip();
    bind();
    const ok = await FF.auth.init();
    if (ok) onLogin();
  }

  FF.app = { navigate, updateParams, refresh, openDrawer, closeDrawer, renderSidebar, renderCurrent, renderTopUser, onLogin, PAGES, get current() { return current; } };
  document.addEventListener('DOMContentLoaded', init);
})(window.FF);
