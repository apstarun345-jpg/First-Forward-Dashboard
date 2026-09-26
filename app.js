/* App shell: login gate, sidebar (permission aware), hash router, drawer, global actions.
   Data is preloaded once after login (FF.store.preload) — no auto refresh; ↻ button = fresh data from Google. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const ANALYTICS = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard', desc: 'KPIs & charts', perm: 'dashboard' },
    { id: 'trend', icon: '📈', label: 'Trend', desc: 'Daily · Monthly · Last vs Current', perm: 'trend' },
    { id: 'performance', icon: '🏆', label: 'Performance', desc: 'Agents & TLs (REPORT)', perm: 'performance' },
    { id: 'stock', icon: '📦', label: 'Stock', desc: 'Search · pivot · Excel (StockDataa)', perm: 'stock' }
  ];
  let current = { page: '', params: {}, token: 0 };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const segs = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const params = {};
    new URLSearchParams(queryPart || '').forEach((v, k) => { params[k] = v; });
    let page = segs[0] || firstAllowedPage();
    if (page === 'sheet') { params.name = segs.slice(1).join('/'); }
    if (!FF.pages[page]) page = firstAllowedPage();
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
    const a = ANALYTICS.find((x) => x.id === page);
    return a ? a.perm : null;
  }
  function allowed(page, params) { const perm = pagePerm(page, params); return !perm || FF.auth.can(perm); }
  function firstAllowedPage() {
    const a = ANALYTICS.find((x) => FF.auth.can(x.perm));
    if (a) return a.id;
    const s = FF.config.sheets.find((x) => FF.auth.can(`sheet:${x.name}`));
    return s ? 'sheet' : 'settings';
  }

  function renderSidebar() {
    const nav = U.$('#nav');
    const sheets = FF.config.sheets.filter((s) => FF.auth.can(`sheet:${s.name}`));
    const pages = ANALYTICS.filter((a) => FF.auth.can(a.perm));
    const u = FF.auth.user;
    nav.innerHTML = `${pages.length ? `<div class="nav-sec">Analytics</div>${pages.map((a) => `<a class="nav-item" data-page="${a.id}" href="#/${a.id}"><span class="nav-ico">${a.icon}</span><span class="nav-text"><b>${a.label}</b><small>${a.desc}</small></span></a>`).join('')}` : ''}
      ${sheets.length ? `<div class="nav-sec">Sheets <span class="nav-count">${sheets.length}</span></div>${sheets.map((s) => `<a class="nav-item sheet" data-page="sheet" data-name="${esc(s.name)}" href="#/sheet/${encodeURIComponent(s.name)}"><span class="nav-ico">${s.icon || '📄'}</span><span class="nav-text"><b>${esc(s.name)}</b><small>${esc(s.desc || '')}</small></span>${s.big ? '<span class="nav-pill">big</span>' : ''}</a>`).join('')}` : ''}
      <div class="nav-sec">Account</div>
      <a class="nav-item" data-page="settings" href="#/settings"><span class="nav-ico">⚙️</span><span class="nav-text"><b>Settings</b><small>${u && u.role === 'admin' ? 'Branding · data · users · access' : 'My account'}</small></span></a>`;
    const foot = U.$('#user-box');
    if (foot && u) foot.innerHTML = `<div class="user-chip"><span class="user-avatar">${esc((u.name || u.username).slice(0, 1).toUpperCase())}</span><span class="user-text"><b>${esc(u.name || u.username)}</b><small>${u.role === 'admin' ? '👑 Admin' : 'User'}</small></span><button class="icon-btn small" id="logout-btn" title="Logout">⎋</button></div>`;
    const lb = U.$('#logout-btn'); if (lb) lb.addEventListener('click', () => FF.auth.logout());
  }
  function markActive() {
    U.$$('#nav .nav-item').forEach((a) => {
      const on = a.dataset.page === current.page && (current.page !== 'sheet' || a.dataset.name === current.params.name);
      a.classList.toggle('active', on);
    });
    const title = current.page === 'sheet' ? current.params.name : (FF.pages[current.page] && FF.pages[current.page].title) || '';
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
      root.innerHTML = `<div class="empty-state">🔒 Is page ka access aapke account me nahi hai.<br><small class="dim">Admin se "${esc(pagePerm(page, params) || page)}" permission maango.</small></div>`;
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
    const st = FF.store.state;
    if (st.loading) { const p = progress || st.progress; el.innerHTML = `<span class="dot busy"></span> Loading ${p.done}/${p.total}…`; return; }
    const t = FF.store.loadedAt;
    const errs = Object.keys(st.errors || {}).length;
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
      await FF.store.preload(true);
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
    if (!table) return;
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
    window.addEventListener('hashchange', () => renderCurrent());
    U.$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('side-open'));
    U.$('#side-backdrop').addEventListener('click', closeSidebar);
    U.$('#top-refresh').addEventListener('click', refresh);
    U.$('#drawer-close').addEventListener('click', closeDrawer);
    U.$('#drawer-backdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeSidebar(); } });
    document.addEventListener('click', (e) => {
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

  function onLogin(first) {
    renderSidebar();
    FF.auth.applyTheme();
    document.body.classList.add('ready');
    FF.store.preload(false).catch(() => {});
    renderCurrent();
    const u = FF.auth.user;
    if (u && u.mustChangePassword) setTimeout(() => U.toast('⚠️ Default password chal raha hai — Settings → My account se badlo', 'err'), 800);
    if (first) setTimeout(() => U.toast('👑 Aap pehle user ho — aap admin ban gaye', 'ok'), 400);
  }

  async function init() {
    U.initTooltip();
    bind();
    const ok = await FF.auth.init();
    if (ok) onLogin(false);
  }

  FF.app = { navigate, updateParams, refresh, openDrawer, closeDrawer, renderSidebar, renderCurrent, onLogin, get current() { return current; } };
  document.addEventListener('DOMContentLoaded', init);
})(window.FF);
