/* App shell: login gate, sidebar, topbar with PWA install + user menu v2, hash router, drawer.
   Data: FF.store + FF.gv preloaded on login, plus FF.preloader for all sheets in background — instant sheet open. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;

  const PAGES = [
    { id: 'home', icon: '🏠', label: 'Home', desc: 'Highlights · GV & FF charts', perm: 'home', group: 'Main' },
    { id: 'tagIssued', icon: '🏷️', label: 'GV & FF Tag Issued', desc: 'Date-wise detailed issuance · VC4 vs Commercial', perm: 'tagIssued', group: 'Main' },
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
    if (!FF.pages[page]) { const alias = { gvPartner: 'gvDashboard', comparison: 'compare', gvd: 'gvDashboard', tagIssued: 'tagIssued', 'gv-ff': 'tagIssued' }; page = alias[page] || firstAllowedPage(); }
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
    if (page === 'settings') return null;
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

  // ---- sidebar ----
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

  // ---- PWA install ----
  let deferredPrompt = null;
  let pwaInstalled = false;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallBtn();
  });
  window.addEventListener('appinstalled', () => {
    pwaInstalled = true;
    deferredPrompt = null;
    updateInstallBtn();
    U.toast('App installed ✓ — ab home screen se kholo', 'ok');
  });
  function updateInstallBtn() {
    const btn = U.$('#pwa-install');
    if (!btn) return;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (pwaInstalled || isStandalone || !deferredPrompt) {
      btn.hidden = true;
    } else {
      btn.hidden = false;
    }
  }
  async function promptInstall() {
    if (!deferredPrompt) {
      U.toast('Install: browser menu → Install app / Add to Home Screen', 'info');
      return;
    }
    deferredPrompt.prompt();
    try {
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') U.toast('Installing…', 'ok');
    } catch {}
    deferredPrompt = null;
    updateInstallBtn();
  }

  // ---- top-right user menu ----
  function renderTopUser() {
    const u = FF.auth.user;
    const btn = U.$('#user-btn');
    if (!btn || !u) return;
    btn.innerHTML = `${FF.auth.avatarHtml(u, 'top')}<span class="user-btn-text"><b>${esc(u.name || u.username)}</b><small>${FF.auth.roleLabel(u)}</small></span><span class="chev">▾</span>`;
    const menu = U.$('#user-menu');
    if (!menu) return;
    const unread = (FF.notifications && FF.notifications.state && FF.notifications.state.unread) || 0;
    menu.innerHTML = `
      <div class="user-card-clean">
        <div class="ucc-head">
          <div class="ucc-avatar">${FF.auth.avatarHtml(u, 'lg')}</div>
          <div class="ucc-name-box">
            <h3 class="ucc-name">${esc(u.name || u.username)}</h3>
            <span class="ucc-role-badge ${u.role === 'admin' ? 'admin' : ''}">${FF.auth.roleLabel(u)}</span>
          </div>
        </div>
        <div class="ucc-details">
          <div class="ucc-row">
            <span class="ucc-icon">📱</span>
            <div class="ucc-info">
              <span class="ucc-label">Mobile Number</span>
              <b class="ucc-val">${esc(u.mobile || 'Not set')}</b>
            </div>
          </div>
          <div class="ucc-row">
            <span class="ucc-icon">✉️</span>
            <div class="ucc-info">
              <span class="ucc-label">Email Address</span>
              <b class="ucc-val">${esc(u.email || 'Not set')}</b>
            </div>
          </div>
        </div>
        <div class="ucc-actions">
          <button class="ucc-btn ucc-notify" id="um-open-notifications">
            <span class="ucc-btn-ico">🔔</span>
            <span class="ucc-btn-text">Notifications</span>
            ${unread > 0 ? `<span class="ucc-unread">${unread}</span>` : ''}
          </button>
          <button class="ucc-btn ucc-logout" id="user-logout">
            <span class="ucc-btn-ico">⎋</span>
            <span class="ucc-btn-text">Logout</span>
          </button>
        </div>
      </div>`;
    const logout = U.$('#user-logout', menu);
    if (logout) logout.addEventListener('click', () => FF.auth.logout());
    const notifyBtn = U.$('#um-open-notifications', menu);
    if (notifyBtn) {
      notifyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUserMenu(false);
        if (FF.notifications) FF.notifications.toggle(true);
      });
    }
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
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        // Attractive: white background + centered image with rounded corners
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,c.width,c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let data = c.toDataURL('image/jpeg', 0.86);
        if (data.length > 180 * 1024) {
          const c2 = document.createElement('canvas');
          const s2 = Math.min(1, 200 / Math.max(c.width, c.height));
          c2.width = Math.round(c.width * s2); c2.height = Math.round(c.height * s2);
          c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height);
          data = c2.toDataURL('image/jpeg', 0.78);
        }
        resolve(data);
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
    if (!FF.auth.user) return;
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
    if (FF.notifications) FF.notifications.activity(page === 'sheet' ? `Sheet · ${params.name || ''}` : page);
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
    const pre = FF.preloader ? FF.preloader.state : null;
    const loading = st.loading || (gv && gv.loading) || (pre && pre.running);
    if (loading) {
      const p = pre && pre.running ? pre.progress : (st.loading ? st.progress : gv.progress);
      const extra = pre && pre.running ? ` (preloading ${p.loaded}/${p.total})` : st.loading && gv && gv.loading ? ' (FF + GV)' : st.loading ? ' (FF)' : ' (GV)';
      el.innerHTML = `<span class="dot busy"></span> Loading ${p.done !== undefined ? `${p.done}/${p.total}` : `${p.loaded}/${p.total}`}${extra}…`;
      return;
    }
    const t = FF.store.loadedAt || (gv && gv.loadedAt);
    const errs = Object.keys(st.errors || {}).length + (gv ? Object.keys(gv.errors || {}).length : 0);
    el.innerHTML = t ? `<span class="dot ${errs ? 'warn' : 'live'}\"></span> Data ${U.timeLabel(t)}${errs ? ` · ${errs} failed` : ''}${pre && pre.done ? ' · all sheets ready ✓' : ''}` : '<span class="dot"></span> Ready';
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
      if (FF.preloader && FF.preloader.fastSync) {
        await FF.preloader.fastSync(fresh);
      } else {
        FF.store.reset();
        if (FF.gv) FF.gv.reset();
        await Promise.all([FF.store.preload(true).catch(() => {}), FF.gv && FF.gv.enabled() ? FF.gv.preload(true).catch(() => {}) : Promise.resolve()]);
      }
    } catch (err) { console.error(err); }
    refreshing = false;
    await renderCurrent();
    const errors = FF.preloader ? FF.preloader.state.errors : [];
    U.toast(errors.length ? 'Some sheets could not update. Retry refresh.' : 'Data updated ✓', errors.length ? 'warn' : 'ok');
  }

  // ---- drawer ----
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

  // ---- location permission on app open — banner + auto ----
  function ensureLocBanner() {
    let el = U.$('#loc-banner');
    if (el) return el;
    el = U.h('<div id="loc-banner" class="loc-banner" hidden><span>📍 Location access chahiye — field tracking ke liye allow karo</span><button class="btn small primary" id="loc-allow">Allow</button><button class="btn small" id="loc-dismiss">✕</button></div>');
    document.body.appendChild(el);
    U.$('#loc-allow', el).addEventListener('click', () => { el.hidden = true; shareLocationSilently(); });
    U.$('#loc-dismiss', el).addEventListener('click', () => { el.hidden = true; localStorage.setItem('ff_loc_prompt', String(Date.now())); });
    return el;
  }
  function requestLocationOnOpen() {
    if (!navigator.geolocation) return;
    const lastPrompt = localStorage.getItem('ff_loc_prompt');
    if (lastPrompt && Date.now() - Number(lastPrompt) < 24*60*60*1000) return;
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(p => {
        if (p.state === 'denied') return;
        if (p.state === 'granted') {
          shareLocationSilently();
        } else {
          const banner = ensureLocBanner();
          banner.hidden = false;
          // Also try silent after 2s if user interacts
          setTimeout(() => { if (!banner.hidden) { /* keep visible */ } }, 100);
        }
      }).catch(() => {
        const banner = ensureLocBanner();
        banner.hidden = false;
      });
    } else {
      const banner = ensureLocBanner();
      banner.hidden = false;
    }
  }
  function shareLocationSilently() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await FF.auth.api('/api/auth/location', 'POST', { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        await FF.auth.refreshUser();
        renderTopUser();
        const b = U.$('#loc-banner'); if (b) b.hidden = true;
        U.toast('📍 Location shared ✓', 'ok');
      } catch (e) { console.warn('Location share failed', e.message); }
    }, (err) => {
      console.warn('Geolocation error', err.message);
      localStorage.setItem('ff_loc_prompt', String(Date.now()));
      const b = U.$('#loc-banner'); if (b) b.hidden = true;
      if (err.code === 1) U.toast('Location denied — Settings → My account se baad me share kar sakte ho', 'warn');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
  }

  function showKpiSummary(title, value, foot) {
    U.$('#kpi-summary-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'kpi-summary-modal'; modal.className = 'kpi-modal-backdrop';
    modal.innerHTML = `<section class="kpi-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><button class="icon-btn kpi-modal-close" aria-label="Close">✕</button><span class="kpi-modal-kicker">KPI SUMMARY · ${esc(FF.pages[current.page]?.title || current.page)}</span><h2>${esc(title)}</h2><strong>${esc(value)}</strong><p>${esc(foot || 'Selected KPI total.')}</p><button class="btn primary kpi-modal-done">Done</button></section>`;
    document.body.append(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('.kpi-modal-close,.kpi-modal-done')) close(); });
  }

  function bind() {
    document.body.classList.toggle('sidebar-auto', localStorage.getItem('ff_sidebar_auto') !== '0');
    window.addEventListener('hashchange', () => { renderCurrent(); toggleUserMenu(false); });
    U.$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('side-open'));
    U.$('#side-backdrop').addEventListener('click', closeSidebar);
    U.$('#top-refresh').addEventListener('click', refresh);
    const pwaBtn = U.$('#pwa-install');
    if (pwaBtn) pwaBtn.addEventListener('click', promptInstall);
    const ub = U.$('#user-btn');
    if (ub) ub.addEventListener('click', (e) => { e.stopPropagation(); toggleUserMenu(); });
    U.$('#drawer-close').addEventListener('click', closeDrawer);
    U.$('#drawer-backdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeSidebar(); toggleUserMenu(false); } });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#user-menu') && !e.target.closest('#user-btn')) toggleUserMenu(false);
      if (e.target.closest('#user-menu a')) toggleUserMenu(false);
      const kpi = e.target.closest('.kpi');
      if (kpi && !e.target.closest('a,button:not(.kpi)')) {
        const title = kpi.dataset.kpiTitle || U.$('.kpi-title', kpi)?.textContent || 'KPI summary';
        const value = kpi.dataset.kpiValue || U.$('.kpi-value', kpi)?.innerText || '—';
        const foot = kpi.dataset.kpiFoot || U.$('.kpi-foot', kpi)?.innerText || '';
        showKpiSummary(title, value, foot);
        return;
      }
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
      const drawerLink = e.target.closest('#drawer a[href^="/"]');
      if (drawerLink) closeDrawer();
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('select[data-param], input[data-param]');
      if (el) updateParams({ [el.dataset.param]: el.value, ...(el.dataset.param === 'tl' ? { agent: '' } : {}), ...(el.dataset.param === 'agent' ? { tl: '' } : {}) });
    });
    FF.store.on((ev, detail) => { if (ev === 'progress' || ev === 'start' || ev === 'done') updateStatus(detail); });
    // periodic install btn check
    setInterval(updateInstallBtn, 3000);
  }

  function onBackgroundDataUpdated() {
    // If user is on a data page, smoothly re-render so new stock and stats appear automatically
    if (['stock', 'home', 'tagIssued', 'dashboard', 'trend', 'performance', 'gvStock', 'gvDashboard', 'gvTrend', 'gvPerformance', 'compare', 'sheet'].includes(current.page)) {
      renderCurrent({ bgUpdated: true });
    }
  }

  let syncTimer = null;
  function onLogin() {
    renderSidebar();
    FF.auth.applyTheme();
    document.body.classList.add('ready');
    // Start one shared load BEFORE rendering; page requests join it.
    if (FF.preloader) FF.preloader.preloadAll(false).catch(console.warn);
    renderCurrent();
    if (FF.config.loginAnimation !== false) FF.auth.splash(FF.auth.user);
    if (FF.notifications) FF.notifications.start();
    const u = FF.auth.user;
    if (FF.auth.isAdmin()) FF.auth.api('/api/health').then(h => {
      if (h.storage && (h.storage.warning || h.storage.error)) U.toast(h.storage.error || h.storage.warning, 'warn');
    }).catch(() => {});
    if (u && u.mustChangePassword) setTimeout(() => U.toast('⚠️ Default password chal raha hai — Settings → My account se badlo', 'err'), 900);
    // Location prompt + PWA
    setTimeout(requestLocationOnOpen, 2000);
    updateInstallBtn();
    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(() => console.log('SW registered')).catch(e => console.warn('SW failed', e));
    }
    // Auto background sync every 5 minutes when tab is open
    clearInterval(syncTimer);
    syncTimer = setInterval(() => {
      if (FF.auth.user && document.visibilityState === 'visible' && FF.preloader && !FF.preloader.running) {
        FF.preloader.preloadAll(true).then(() => {
          if (FF.auth.user && !['settings', 'sheet'].includes(current.page)) onBackgroundDataUpdated();
        }).catch(() => {});
      }
    }, 5 * 60 * 1000);
  }

  async function init() {
    U.initTooltip();
    bind();
    const ok = await FF.auth.init();
    if (ok) onLogin();
  }

  FF.app = { navigate, updateParams, refresh, openDrawer, closeDrawer, renderSidebar, renderCurrent, renderTopUser, updateStatus, onLogin, onBackgroundDataUpdated, promptInstall, PAGES, get current() { return current; } };
  document.addEventListener('DOMContentLoaded', init);
})(window.FF);
