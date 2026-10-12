/* 📱 native-app.js (v3.73) — installed PWA / phone ko Android app jaisa chalata hai.
   Sirf html.mobile-ui par (ui-boot.js lagata hai) — desktop layout bilkul nahi badalta.

   Kya karta hai:
   • App bar: ☰ · title · 🔍 · 🔔 · ⋮ — baaki saare topbar buttons (bhasha, theme, a11y, focus,
     refresh, saved views, office bell, voice, install…) ⋮ ke bottom sheet me. Asli buttons hi click
     hote hain, isliye har feature pehle jaisa kaam karta hai (koi logic duplicate nahi).
   • Search: poori screen ka search bar (← back ke saath), Master Search ke suggestions neeche.
   • Android BACK button: pehle khula sheet / drawer / menu / search band hota hai, page nahi badalta.
   • Bottom tabs native jaisa: Home se tab kholo → back = Home; tab se tab → history me dher nahi lagta.
   • Pull-to-refresh (page top par neeche kheencho) → FF.app.refresh().
   • KPI drawer = bottom sheet, neeche swipe karke band.
   • Status bar ka rang app bar ke rang se match (light / dark). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const html = document.documentElement;
  if (!html.classList.contains('mobile-ui')) return;
  html.classList.add('native-shell');

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
  const ICON = {
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    back: svg('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    bell: svg('<path d="M6 9a6 6 0 0 1 12 0c0 3.5.9 5.1 1.7 6 .4.5 0 1.2-.6 1.2H4.9c-.6 0-1-.7-.6-1.2.8-.9 1.7-2.5 1.7-6Z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>'),
    dots: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')
  };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* optional */ } };
  const routeOf = (hash) => String(hash || '').replace(/^#\/?/, '').split(/[?&/]/)[0] || 'home';
  const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const visible = (el) => !!el && !el.hidden && el.getAttribute('aria-hidden') !== 'true';

  // ------------------------------------------------------------------------------------------
  // App bar
  // ------------------------------------------------------------------------------------------
  function buildAppBar() {
    const bar = $('.topbar');
    if (!bar || $('#nab-actions')) return;
    const lead = document.createElement('button');
    lead.type = 'button'; lead.id = 'nab-lead'; lead.className = 'nab-btn'; lead.setAttribute('aria-label', 'Menu');
    lead.innerHTML = ICON.menu;
    lead.addEventListener('click', () => { const m = $('#menu-btn'); if (m) m.click(); });
    bar.insertBefore(lead, bar.firstChild);

    const actions = document.createElement('div');
    actions.id = 'nab-actions'; actions.className = 'nab-actions';
    actions.innerHTML = `<button type="button" class="nab-btn" id="nab-search" aria-label="Search">${ICON.search}</button>`
      + `<button type="button" class="nab-btn" id="nab-bell" aria-label="Notifications">${ICON.bell}<b class="nab-badge" id="nab-badge" hidden>0</b></button>`
      + `<button type="button" class="nab-btn" id="nab-more" aria-label="More options" aria-haspopup="dialog">${ICON.dots}</button>`;
    bar.appendChild(actions);
    $('#nab-search').addEventListener('click', openSearch);
    $('#nab-bell').addEventListener('click', openNotifications);
    $('#nab-more').addEventListener('click', openOverflow);
    mirrorBadge();
    const count = $('#notification-count');
    if (count) new MutationObserver(mirrorBadge).observe(count, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
  function mirrorBadge() {
    const src = $('#notification-count'), dst = $('#nab-badge');
    if (!dst) return;
    const n = src && !src.hidden ? String(src.textContent || '').trim() : '';
    dst.textContent = n;
    dst.hidden = !n || n === '0';
  }
  function openNotifications() {
    // Bottom-nav "Alerts" jaisa hi: poora Notification Center (drawer / bottom sheet).
    const tab = $('#mobile-nav [data-mobile-action="notifications"]');
    if (tab) { tab.click(); return; }
    const btn = $('#notification-btn');
    if (btn) btn.click();
  }

  // ------------------------------------------------------------------------------------------
  // Bottom sheet (⋮ overflow) — app ke saare secondary controls, asli buttons ko click karta hai
  // ------------------------------------------------------------------------------------------
  const SKIP_IDS = new Set(['global-search-btn', 'notification-btn', 'top-more', 'user-btn', 'menu-btn']);
  function overflowItems() {
    const out = [];
    $$('#top-actions button, #top-actions a[href]').forEach((el) => {
      if (SKIP_IDS.has(el.id) || el.closest('#master-search') || el.closest('#notification-pop') || el.closest('#user-menu') || el.closest('.theme-pop, [role="menu"]')) return;
      if (el.hidden || el.closest('[hidden]') || el.disabled) return;
      const label = String(el.getAttribute('aria-label') || el.title || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label) return;
      const glyph = String(el.textContent || '').trim();
      const icon = Array.from(glyph)[0] || '•';
      const sub = el.title && el.title !== label ? el.title : '';
      out.push({ el, label, icon, sub });
    });
    return out;
  }
  let sheetState = null;
  function openSheet({ title, html: bodyHtml, onClick }) {
    closeSheet(true);
    const scrim = document.createElement('div');
    scrim.className = 'nsheet-scrim';
    scrim.innerHTML = `<section class="nsheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="nsheet-handle" aria-hidden="true"></div>${title ? `<h2 class="nsheet-title">${esc(title)}</h2>` : ''}<div class="nsheet-body">${bodyHtml}</div></section>`;
    document.body.appendChild(scrim);
    const sheet = $('.nsheet', scrim);
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) { closeSheet(); return; }
      const item = e.target.closest('[data-nsheet-i]');
      if (item && onClick) onClick(Number(item.dataset.nsheetI), item);
    });
    dragToDismiss(sheet, $('.nsheet-handle', scrim), () => closeSheet());
    requestAnimationFrame(() => scrim.classList.add('open'));
    sheetState = { scrim };
    syncOverlays();
  }
  function closeSheet(instant) {
    if (!sheetState) return;
    const { scrim } = sheetState;
    sheetState = null;
    scrim.classList.remove('open');
    if (instant) scrim.remove(); else setTimeout(() => scrim.remove(), 220);
    syncOverlays();
  }
  function openOverflow() {
    const items = overflowItems();
    const user = (FF.auth && FF.auth.user) || null;
    const head = user ? `<button type="button" class="nsheet-account" data-nsheet-i="-1"><span class="nsheet-avatar">${esc(String(user.name || user.username || '?').slice(0, 1).toUpperCase())}</span><span><b>${esc(user.name || user.username)}</b><small>${esc(user.role === 'admin' ? 'Admin · account, settings, logout' : 'Account · settings, logout')}</small></span></button>` : '';
    const list = items.map((it, i) => `<button type="button" class="nsheet-item" data-nsheet-i="${i}"><span class="nsheet-ico" aria-hidden="true">${esc(it.icon)}</span><span class="nsheet-txt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`).join('');
    openSheet({
      title: 'Options',
      html: head + `<div class="nsheet-list">${list}</div>`,
      onClick: (i) => {
        closeSheet(true);
        // Sheet band hone ke baad asli control — popovers (theme packs, user menu) sahi jagah khulte hain.
        setTimeout(() => {
          if (i === -1) { const u = $('#user-btn'); if (u) u.click(); return; }
          const it = items[i];
          if (it && it.el && it.el.isConnected) it.el.click();
        }, 60);
      }
    });
  }

  // ------------------------------------------------------------------------------------------
  // Full-screen search (Master Search input ko app bar me le aata hai)
  // ------------------------------------------------------------------------------------------
  function searchInput() { return $('#master-search-input'); }
  function enterSearchMode() {
    const box = $('#master-search');
    if (!box) return false;
    if (!$('#nab-search-back', box)) {
      const back = document.createElement('button');
      back.type = 'button'; back.id = 'nab-search-back'; back.className = 'nab-btn'; back.setAttribute('aria-label', 'Search band karo');
      back.innerHTML = ICON.back;
      back.addEventListener('click', () => exitSearch());
      const row = $('.master-search-row', box) || box;
      row.insertBefore(back, row.firstChild);
    }
    html.classList.add('nab-search-open');
    const input = searchInput();
    if (input) { try { input.focus(); input.select(); } catch { /* ignore */ } }
    syncOverlays();
    return true;
  }
  function exitSearch() {
    if (!html.classList.contains('nab-search-open')) return;
    html.classList.remove('nab-search-open');
    const input = searchInput();
    if (input) { try { input.blur(); } catch { /* ignore */ } }
    $$('.suggest-pop, .ms-suggest, [data-suggest-portal]').forEach((el) => { el.hidden = true; });
    syncOverlays();
  }
  function openSearch() {
    if (FF.masterSearch && typeof FF.masterSearch.mountTopbar === 'function') {
      try { FF.masterSearch.mountTopbar(); } catch { /* fall through */ }
    }
    if (enterSearchMode()) return;
    // Cold start: search module abhi load nahi hua — purana button lazy-load karta hai, phir hum mode on karte hain.
    const btn = $('#global-search-btn');
    if (btn) btn.click();
    let tries = 0;
    const wait = setInterval(() => {
      tries++;
      if (FF.masterSearch && FF.masterSearch.mountTopbar) { try { FF.masterSearch.mountTopbar(); } catch { /* ignore */ } }
      if ($('#master-search-input')) {
        clearInterval(wait);
        if (FF.palette && FF.palette.close) FF.palette.close();
        enterSearchMode();
      } else if (tries > 40) clearInterval(wait);
    }, 100);
  }

  // ------------------------------------------------------------------------------------------
  // Android BACK button — khule overlays pehle band hon
  // ------------------------------------------------------------------------------------------
  const OVERLAYS = [
    { open: () => !!sheetState, close: () => closeSheet() },
    { open: () => !!$('#onboarding-tour'), close: () => { const b = $('#onboarding-tour [data-tour-skip]'); if (b) b.click(); else $('#onboarding-tour').remove(); } },
    { open: () => !!$('#ff-saved-views'), close: () => { const b = $('#ff-saved-views [data-sv-close]'); if (b) b.click(); else $('#ff-saved-views').remove(); } },
    { open: () => visible($('#palette-backdrop')), close: () => { if (FF.palette && FF.palette.close) FF.palette.close(); else $('#palette-backdrop').hidden = true; } },
    { open: () => html.classList.contains('nab-search-open'), close: () => exitSearch() },
    { open: () => !!($('#drawer') && $('#drawer').classList.contains('open')), close: () => { const c = $('#drawer-close'); if (c) c.click(); else pressEscape(); } },
    { open: () => visible($('#user-menu')), close: () => { const u = $('#user-btn'); if (u) u.click(); if (visible($('#user-menu'))) pressEscape(); } },
    { open: () => visible($('#notification-pop')), close: () => { if (FF.notifications && FF.notifications.toggle) FF.notifications.toggle(false); else $('#notification-pop').hidden = true; } },
    { open: () => document.body.classList.contains('side-open'), close: () => { const b = $('#side-backdrop'); if (b) b.click(); if (document.body.classList.contains('side-open')) pressEscape(); } }
  ];
  const anyOverlay = () => OVERLAYS.find((o) => { try { return o.open(); } catch { return false; } });
  const nav = { sentinel: false, sentinelHref: '', ignorePop: 0, pending: null };
  let syncTimer = 0;
  function syncOverlays() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const open = !!anyOverlay();
      if (open && !nav.sentinel) {
        history.pushState(Object.assign({}, history.state || {}, { ffOverlay: 1 }), '');
        nav.sentinel = true; nav.sentinelHref = location.href;
      } else if (!open && nav.sentinel) {
        nav.sentinel = false;
        // Link dabane se page badal gaya ho to sentinel neeche dab gaya — back mat karo (warna page ulta jaata).
        if (location.href === nav.sentinelHref) { nav.ignorePop++; history.back(); }
      }
    }, 60);
  }
  window.addEventListener('popstate', () => {
    if (nav.ignorePop) { nav.ignorePop--; return; }
    if (nav.pending) { const to = nav.pending; nav.pending = null; goTab(to); return; }
    if (nav.sentinel) {
      nav.sentinel = false;
      const o = anyOverlay();
      if (o) { try { o.close(); } catch { /* ignore */ } }
      // Ek se zyada overlay khule the (jaise drawer ke upar sheet) — bache hue ke liye naya sentinel.
      setTimeout(syncOverlays, 120);
    }
  });
  window.addEventListener('hashchange', () => {
    if (nav.sentinel && location.href !== nav.sentinelHref) nav.sentinel = false;
    if (html.classList.contains('nab-search-open')) exitSearch();
    closeSheet(true);
    markTabs();
  });

  // ------------------------------------------------------------------------------------------
  // Tabs: Home → tab = push (back se Home) · tab → tab = replace (history me dher nahi)
  // ------------------------------------------------------------------------------------------
  function goTab(href) {
    const cur = routeOf(location.hash), dest = routeOf(href);
    if (cur === dest) return;
    if (dest === 'home' && history.state && history.state.ffFromHome) { history.back(); return; }
    if (cur === 'home') history.pushState({ ffFromHome: 1 }, '', href);
    else history.replaceState(Object.assign({}, history.state || {}, { ffOverlay: 0 }), '', href);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  document.addEventListener('click', (e) => {
    const searchTab = e.target.closest && e.target.closest('#mobile-nav [data-mobile-action="search"]');
    if (searchTab) { e.preventDefault(); e.stopPropagation(); vibrate(6); openSearch(); return; }
    const a = e.target.closest && e.target.closest('#mobile-nav a[href^="#/"], #nav a[href^="#/"]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const href = a.getAttribute('href');
    if (routeOf(href) === routeOf(location.hash) && !nav.sentinel) return;   // same page → app ka apna re-render
    e.preventDefault();
    e.stopPropagation();
    vibrate(6);
    if (nav.sentinel) {
      // Sidebar/sheet khula hai: pehle use band karo (sentinel hatao), phir tab kholo.
      nav.sentinel = false;
      const o = anyOverlay();
      if (o) { try { o.close(); } catch { /* ignore */ } }
      if (document.body.classList.contains('side-open')) pressEscape();
      if (routeOf(href) === routeOf(location.hash)) { nav.ignorePop++; history.back(); return; }
      nav.pending = href;
      history.back();
      return;
    }
    goTab(href);
  }, true);
  function markTabs() {
    const cur = routeOf(location.hash);
    $$('#mobile-nav a.mobile-nav-item').forEach((a) => a.classList.toggle('active', routeOf(a.getAttribute('href')) === cur));
  }

  // ------------------------------------------------------------------------------------------
  // Bottom sheet drag (KPI drawer + overflow sheet)
  // ------------------------------------------------------------------------------------------
  function dragToDismiss(panel, handle, onDismiss) {
    if (!panel || !handle || handle.__ffDrag) return;
    handle.__ffDrag = true;
    let startY = 0, dy = 0, active = false;
    handle.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; active = true; startY = e.touches[0].clientY; dy = 0; panel.style.setProperty('transition', 'none', 'important'); }, { passive: true });
    handle.addEventListener('touchmove', (e) => {
      if (!active) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      panel.style.setProperty('transform', `translateY(${dy}px)`, 'important');
    }, { passive: true });
    const end = () => {
      if (!active) return;
      active = false;
      panel.style.removeProperty('transition');
      panel.style.removeProperty('transform');
      if (dy > 110) onDismiss();
    };
    handle.addEventListener('touchend', end);
    handle.addEventListener('touchcancel', end);
  }
  function wireDrawerSheet() {
    const drawer = $('#drawer'), head = drawer && $('.drawer-head', drawer);
    if (!drawer || !head) return;
    if (!$('.nsheet-handle', drawer)) {
      const grip = document.createElement('div');
      grip.className = 'nsheet-handle drawer-grip'; grip.setAttribute('aria-hidden', 'true');
      drawer.insertBefore(grip, drawer.firstChild);
    }
    const close = () => { const c = $('#drawer-close'); if (c) c.click(); };
    dragToDismiss(drawer, $('.drawer-grip', drawer), close);
    dragToDismiss(drawer, $('.drawer-kicker', drawer) || head, close);
  }

  // ------------------------------------------------------------------------------------------
  // Pull-to-refresh
  // ------------------------------------------------------------------------------------------
  function wirePullToRefresh() {
    const ind = document.createElement('div');
    ind.className = 'nptr'; ind.setAttribute('aria-hidden', 'true');
    ind.innerHTML = `<span class="nptr-ico">${ICON.refresh}</span>`;
    document.body.appendChild(ind);
    const MAX = 96, TRIGGER = 72;
    let sx = 0, sy = 0, pull = 0, tracking = false, engaged = false, busy = false;
    const blocked = (t) => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable], .table-wrap, .nsheet, .drawer, .sidebar, .palette-backdrop, #mobile-nav, .topbar, canvas, .leaflet-container, .map-wrap'));
    document.addEventListener('touchstart', (e) => {
      if (busy || e.touches.length !== 1 || window.scrollY > 0 || anyOverlay() || blocked(e.target) || !document.body.classList.contains('ready')) { tracking = false; return; }
      tracking = true; engaged = false; pull = 0;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
      if (!engaged) {
        if (dy < 8 || Math.abs(dx) > dy || window.scrollY > 0) { if (Math.abs(dx) > 10 || dy < -4) tracking = false; return; }
        engaged = true;
      }
      pull = Math.min(MAX, dy * 0.5);
      ind.style.transform = `translate(-50%, ${pull}px) rotate(${pull * 3}deg)`;
      ind.style.opacity = String(Math.min(1, pull / TRIGGER));
      ind.classList.toggle('armed', pull >= TRIGGER);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const end = async () => {
      if (!tracking) return;
      tracking = false;
      if (!engaged) return;
      if (pull >= TRIGGER && FF.app && typeof FF.app.refresh === 'function') {
        busy = true; vibrate(10);
        ind.classList.add('spin');
        ind.style.transform = `translate(-50%, ${TRIGGER * 0.8}px)`;
        try { await Promise.race([Promise.resolve(FF.app.refresh()), new Promise((r) => setTimeout(r, 15000))]); } catch { /* refresh khud toast dikhata hai */ }
        busy = false;
      }
      ind.classList.remove('spin', 'armed');
      ind.style.transform = ''; ind.style.opacity = '';
      pull = 0;
    };
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
  }

  // ------------------------------------------------------------------------------------------
  // Status bar colour + app bar elevation + sidebar swipe-to-close
  // ------------------------------------------------------------------------------------------
  function syncStatusBar() {
    const bar = $('.topbar');
    const meta = $('meta[name="theme-color"]');
    if (!bar || !meta) return;
    const bg = getComputedStyle(bar).backgroundColor;
    const m = bg && bg.match(/\d+(\.\d+)?/g);
    if (!m || m.length < 3) return;
    const hex = '#' + m.slice(0, 3).map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('');
    if (meta.content !== hex) meta.content = hex;
  }
  function wireScrollElevation() {
    let raf = 0;
    window.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; html.classList.toggle('nab-scrolled', window.scrollY > 4); });
    }, { passive: true });
  }
  function wireSidebarSwipe() {
    const side = $('#sidebar');
    if (!side) return;
    let sx = 0, dx = 0, on = false;
    side.addEventListener('touchstart', (e) => { if (!document.body.classList.contains('side-open') || e.touches.length !== 1) return; on = true; sx = e.touches[0].clientX; dx = 0; side.style.setProperty('transition', 'none', 'important'); }, { passive: true });
    side.addEventListener('touchmove', (e) => { if (!on) return; dx = Math.min(0, e.touches[0].clientX - sx); if (dx < -6) side.style.setProperty('transform', `translateX(${dx}px)`, 'important'); }, { passive: true });
    const end = () => { if (!on) return; on = false; side.style.removeProperty('transition'); side.style.removeProperty('transform'); if (dx < -80) { const b = $('#side-backdrop'); if (b) b.click(); if (document.body.classList.contains('side-open')) pressEscape(); } };
    side.addEventListener('touchend', end); side.addEventListener('touchcancel', end);
  }

  /** Kuch pages (jaise Settings) topbar title khaali chhodte hain — app bar me page ka heading dikhao. */
  function syncTitle() {
    const t = $('#top-title');
    if (!t || String(t.textContent || '').trim()) return;
    const h = $('.main .page-head h1, .main h1');
    const text = h ? String(h.textContent || '').replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F]/gu, '').replace(/\s+/g, ' ').trim() : '';
    if (text) t.textContent = text;
  }

  // ------------------------------------------------------------------------------------------
  function start() {
    buildAppBar();
    wireDrawerSheet();
    wirePullToRefresh();
    wireScrollElevation();
    wireSidebarSwipe();
    markTabs();
    syncStatusBar();
    new MutationObserver(() => syncOverlays()).observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] });
    ['#drawer', '#user-menu', '#notification-pop', '#sidebar'].forEach((sel) => { const el = $(sel); if (el) new MutationObserver(syncOverlays).observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden'] }); });
    new MutationObserver(() => { syncStatusBar(); }).observe(html, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    // Mobile nav app.js har route par dobara banata hai — active tab hum bhi sync rakhte hain.
    const main = $('#main');
    let titleTimer = 0;
    if (main) new MutationObserver(() => { clearTimeout(titleTimer); titleTimer = setTimeout(syncTitle, 120); }).observe(main, { childList: true });
    const mnav = $('#mobile-nav');
    if (mnav) new MutationObserver(markTabs).observe(mnav, { childList: true });
    // Palette backdrop baad me banta hai (lazy) — aate hi observe karo.
    const watchPalette = setInterval(() => { const p = $('#palette-backdrop'); if (p) { clearInterval(watchPalette); new MutationObserver(syncOverlays).observe(p, { attributes: true, attributeFilter: ['hidden'] }); } }, 1000);
    setTimeout(() => clearInterval(watchPalette), 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  FF.nativeApp = { openSearch, exitSearch, openOverflow, closeSheet, goTab, _state: nav };
})(window.FF);
