/* App shell: login gate, sidebar, topbar with PWA install + user menu v2, hash router, drawer.
   Data: FF.store + FF.gv preloaded on login, plus FF.preloader for all sheets in background — instant sheet open. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;

  const PAGES = [
    { id: 'home', icon: '🏠', label: 'Home', desc: 'Highlights · GV & FF charts', perm: 'home', group: 'Management' },
    { id: 'executive', icon: '🧭', label: 'Executive Cockpit', desc: 'Management KPIs · outlook · exceptions', perm: 'executive', group: 'Management' },
    { id: 'tagIssued', icon: '🏷️', label: 'GV & FF Tag Issued', desc: 'Date-wise detailed issuance · VC4 vs Commercial', perm: 'tagIssued', group: 'Management' },
    { id: 'targets', icon: '🎯', label: 'Agent Targets', desc: 'Shortlist · target · progress · Excel', perm: 'targets', group: 'Management' },
    { id: 'rangeReport', icon: '📅', label: 'Range Report', desc: 'Custom from→to report · FF + GV · Excel', perm: 'tagIssued', group: 'Management' },
    { id: 'tv', icon: '📺', label: 'TV Mode', desc: 'Big-screen rotation · fullscreen', perm: 'home', group: 'Management', feat: 'tvMode' },
    { id: 'teamMap', icon: '🗺️', label: 'Team map', desc: 'Location + office distance (admin)', perm: 'home', group: 'Management', feat: 'teamMap', adminOnly: true },
    { id: 'dashboard', icon: '📊', label: 'Dashboard', desc: 'KPIs & charts (EIR)', perm: 'dashboard', group: 'First Forward' },
    { id: 'trend', icon: '📈', label: 'Trend', desc: 'Daily · Monthly · Last vs Current', perm: 'trend', group: 'First Forward' },
    { id: 'performance', icon: '🏆', label: 'Performance', desc: 'Agents & TLs (REPORT)', perm: 'performance', group: 'First Forward' },
    { id: 'stock', icon: '📦', label: 'Stock', desc: 'Search · pivot · Excel (StockDataa)', perm: 'stock', group: 'First Forward' },
    { id: 'stockReport', icon: '📋', label: 'Stock Report', desc: 'REPORT · agent & TL-wise stock', perm: 'performance', group: 'First Forward' },
    { id: 'ffCommission', icon: '₹', label: 'Commission Intelligence', desc: 'Reported rate & earned commission · Direct vs TL', perm: 'ffCommission', group: 'First Forward' },
    { id: 'gvDashboard', icon: '🚀', label: 'GV Partner Dashboard', desc: 'GV issuance · stock · performance', perm: 'gvDashboard', group: 'GV Partner' },
    { id: 'gvTrend', icon: '📈', label: 'GV Trend', desc: 'GV Master daily / monthly', perm: 'gvTrend', group: 'GV Partner' },
    { id: 'gvPerformance', icon: '🏆', label: 'GV Performance', desc: 'GV agents & TLs (GV REPORT)', perm: 'gvPerformance', group: 'GV Partner' },
    { id: 'gvStock', icon: '📦', label: 'GV Stock', desc: 'Tag Assignment stock search', perm: 'gvStock', group: 'GV Partner' },
    { id: 'gvStockReport', icon: '📋', label: 'GV Stock Report', desc: 'GV REPORT · agent, TL, class & dispatch', perm: 'gvStock', group: 'GV Partner' },
    { id: 'gvCommission', icon: '₹', label: 'Commission Intelligence', desc: 'Amount · issuance rate · commission by day/class', perm: 'gvCommission', group: 'GV Partner' },
    { id: 'dualChannel', icon: '🔗', label: 'Dual-channel Agents', desc: 'Verified GV + FF overlap · separate & combined', perm: 'dualChannel', group: 'Cross Channel' },
    { id: 'compare', icon: '⚖️', label: 'GV vs First Forward', desc: 'Dono ka side-by-side comparison', perm: 'compare', group: 'Cross Channel' },
    { id: 'charts', icon: '📊', label: 'Charts', desc: 'Chart-only GV vs FF analysis', perm: 'compare', group: 'Cross Channel' },
    { id: 'forecast', icon: '🔭', label: 'Stock Forecasting', desc: 'Projection · accuracy · reconciled closing stock', perm: 'forecast', group: 'Cross Channel' },
    { id: 'dataQuality', icon: '🧪', label: 'Data Quality Center', desc: 'Duplicates · missing IDs · stale & mismatch checks', perm: 'dataQuality', group: 'Cross Channel' },
    { id: 'dispatchPlan', icon: '🚚', label: 'Dispatch Planner', desc: 'Auto box plan · printable pick-list · WhatsApp', perm: 'dispatchPlan', group: 'Cross Channel' },
    { id: 'tlScorecard', icon: '🏅', label: 'TL Scorecard', desc: 'TL-wise score · target · commission · risk', perm: 'tlScorecard', group: 'Cross Channel' },
    { id: 'savedViews', icon: '⭐', label: 'Saved Views', desc: 'Reusable filters · shareable links', perm: 'savedViews', group: 'Workspace' },
    { id: 'reportStudio', icon: '🗓️', label: 'Report Studio', desc: 'Scheduled email · CSV · PDF · share', perm: 'savedViews', group: 'Workspace' },
    { id: 'followups', icon: '📝', label: 'Notes & Follow-ups', desc: 'Agent/TL timeline · owner · due date', perm: 'followups', group: 'Workspace' }
  ];
  const GROUP_ICON = { 'Management': '🧭', 'First Forward': '🟦', 'GV Partner': '🟩', 'Cross Channel': '🔗', 'Workspace': '🗂️', 'Account': '👤' };
  const pageDef = (id) => PAGES.find((p) => p.id === id) || null;
  let current = { page: '', params: {}, token: 0 };

  // ---- language (English / हिंदी) — navigation & titles -----------------------------------------
  const HI_PAGES = {
    home: { label: 'होम', desc: 'हाइलाइट्स · GV और FF चार्ट' },
    tagIssued: { label: 'GV और FF टैग जारी', desc: 'तारीख़ अनुसार विस्तृत जारी · VC4 बनाम कॉमर्शियल' },
    targets: { label: 'एजेंट टार्गेट', desc: 'शॉर्टलिस्ट · टार्गेट · प्रोग्रेस · उपलब्धि इतिहास · TL रोलअप' },
    rangeReport: { label: 'रेंज रिपोर्ट', desc: 'मनचाही तारीख़ रेंज · FF + GV संयुक्त · एक्सेल' },
    tv: { label: 'टीवी मोड', desc: 'बड़ी स्क्रीन रोटेशन · फुलस्क्रीन' },
    dashboard: { label: 'डैशबोर्ड', desc: 'KPI और चार्ट (EIR)' },
    trend: { label: 'ट्रेंड', desc: 'दैनिक · मासिक · पिछला बनाम चालू' },
    performance: { label: 'परफ़ॉर्मेंस', desc: 'एजेंट और TL (REPORT)' },
    stock: { label: 'स्टॉक', desc: 'सर्च · पिवट · एक्सेल (StockDataa)' },
    stockReport: { label: 'स्टॉक रिपोर्ट', desc: 'REPORT · एजेंट और TL अनुसार स्टॉक' },
    gvDashboard: { label: 'GV पार्टनर डैशबोर्ड', desc: 'GV जारी · स्टॉक · परफ़ॉर्मेंस' },
    gvTrend: { label: 'GV ट्रेंड', desc: 'GV मास्टर दैनिक / मासिक' },
    gvPerformance: { label: 'GV परफ़ॉर्मेंस', desc: 'GV एजेंट और TL (GV REPORT)' },
    gvStock: { label: 'GV स्टॉक', desc: 'टैग असाइनमेंट स्टॉक सर्च' },
    gvStockReport: { label: 'GV स्टॉक रिपोर्ट', desc: 'एजेंट · TL · क्लास · डिस्पैच' },
    dispatchPlan: { label: 'डिस्पैच प्लानर', desc: 'ऑटो बॉक्स प्लान · प्रिंट पिक-लिस्ट · WhatsApp' },
    tlScorecard: { label: 'TL स्कोरकार्ड', desc: 'TL अनुसार स्कोर · टार्गेट · कमीशन · रिस्क' },
    compare: { label: 'GV बनाम फर्स्ट फॉरवर्ड', desc: 'दोनों की तुलना' },
    charts: { label: 'चार्ट्स', desc: 'सिर्फ़ चार्ट · GV बनाम FF' },
    settings: { label: 'सेटिंग्स' }
  };
  const HI_GROUPS = { 'Management': 'मैनेजमेंट', 'First Forward': 'फर्स्ट फॉरवर्ड', 'GV Partner': 'जीवी पार्टनर', 'Cross Channel': 'क्रॉस चैनल', 'Workspace': 'वर्कस्पेस', 'Account': 'अकाउंट', 'Sheets': 'शीट्स' };
  const EN_PAGES = {
    home: { desc: 'Highlights · GV & FF charts' },
    tagIssued: { desc: 'Date-wise detailed issuance · VC4 vs Commercial' },
    targets: { desc: 'Shortlist agents · set targets · track progress · Excel' },
    rangeReport: { desc: 'Pick any from→to dates · FF + GV combined · Excel' },
    tv: { desc: 'Big-screen rotation · auto slides · fullscreen' },
    compare: { desc: 'Side-by-side comparison of both channels' },
    stock: { desc: 'Search · pivot · Excel (StockDataa)' }
  };
  // Exact textContent translations for page heads + common buttons (applied after every render).
  const TEXT = {
    hi: {
      '📊 Dashboard': '📊 डैशबोर्ड',
      'Summary · EIR issuance + StockDataa inventory · VC4 vs Commercial': 'सारांश · EIR जारी + स्टॉकडेटा इन्वेंटरी · VC4 बनाम कॉमर्शियल',
      '📦 Stock / Inventory': '📦 स्टॉक / इन्वेंटरी',
      'StockDataa — agent / TL / class wise stock · VC4 vs Commercial · pivot + Excel export': 'स्टॉकडेटा — एजेंट / TL / क्लास अनुसार स्टॉक · VC4 बनाम कॉमर्शियल · पिवट + एक्सेल',
      '⚖️ GV vs First Forward': '⚖️ GV बनाम फर्स्ट फॉरवर्ड',
      '🎯 Agent Targets': '🎯 एजेंट टार्गेट',
      '⚙️ Settings': '⚙️ सेटिंग्स',
      '↻ Refresh': '↻ रिफ्रेश',
      '🖨 PDF / Print': '🖨 PDF / प्रिंट',
      '📋 Copy summary': '📋 सारांश कॉपी करें',
      '⬇ Excel (Summary + StockDataa rows)': '⬇ एक्सेल (सारांश + स्टॉकडेटा पंक्तियाँ)',
      '⬇ Excel bundle': '⬇ एक्सेल बंडल',
      '💾 Save targets': '💾 टार्गेट सेव करें',
      '⬇ Excel': '⬇ एक्सेल',
      '✕ Clear': '✕ साफ़ करें',
      '☑ Visible select': '☑ दिख रहे चुनें',
      '✕ Selection clear': '✕ चयन हटाएँ',
      '📴 Offline — last loaded data dikh raha hai': '📴 ऑफलाइन — आखिरी लोड हुआ डेटा दिख रहा है'
    },
    en: {
      '📴 Offline — last loaded data dikh raha hai': '📴 Offline — showing last loaded data'
    }
  };
  const LANGS = [['en', '🇬🇧 English'], ['hinglish', '🗣️ Hinglish'], ['hi', '🇮🇳 हिंदी']];
  function lang() { try { const v = localStorage.getItem('ff_lang'); return v === 'hi' || v === 'en' ? v : 'hinglish'; } catch { return 'hinglish'; } }
  function setLang(v) {
    try { localStorage.setItem('ff_lang', v); } catch {}
    renderSidebar();
    U.toast(v === 'hi' ? 'भाषा: हिंदी ✓' : v === 'en' ? 'Language: English ✓' : 'Language: Hinglish ✓', 'ok');
    renderCurrent();
  }
  function toggleLangMenu() {
    const old = U.$('#lang-pop'); if (old) { old.remove(); return; }
    const btn = U.$('#lang-toggle'); if (!btn || !btn.parentElement) return;
    const pop = document.createElement('div');
    pop.id = 'lang-pop'; pop.className = 'lang-pop';
    const cur = lang();
    pop.innerHTML = LANGS.map(([v, l]) => `<button type="button" class="lang-opt ${cur === v ? 'on' : ''}" data-lang="${v}">${l}${cur === v ? ' ✓' : ''}</button>`).join('');
    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(pop);
    pop.addEventListener('click', (e) => { const b = e.target.closest('[data-lang]'); if (!b) return; pop.remove(); if (b.dataset.lang !== cur) setLang(b.dataset.lang); });
    setTimeout(() => {
      document.addEventListener('click', function close(ev) {
        if (pop && !pop.contains(ev.target) && ev.target !== btn) { if (pop.parentElement) pop.remove(); document.removeEventListener('click', close); }
      });
    }, 10);
  }
  function pageLabel(p) {
    if (lang() === 'hi' && HI_PAGES[p.id]) return { ...p, ...HI_PAGES[p.id] };
    if (lang() === 'en' && EN_PAGES[p.id]) return { ...p, ...EN_PAGES[p.id] };
    return p;
  }
  const groupLabel = (g) => (lang() === 'hi' && HI_GROUPS[g] ? HI_GROUPS[g] : g);
  /** DOM auto-translation: page heads, buttons, seg tabs (exact textContent match only). */
  function translateDom(root) {
    const mode = lang();
    if (mode === 'hinglish') return;
    const dict = TEXT[mode]; if (!dict) return;
    U.$$('.page-head h1, .page-head .sub, .btn, .seg-btn', root || document).forEach((el) => {
      if (!el || (el.querySelector && el.querySelector('input,select,img,svg')) || el.childElementCount > 0) return;
      const key = (el.textContent || '').trim();
      if (dict[key] !== undefined) el.textContent = dict[key];
    });
  }

  // ---- theme (light / dark) ---------------------------------------------------------------------
  function themeMode() { try { return localStorage.getItem('ff_theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } }
  function applyThemeMode() {
    document.documentElement.dataset.theme = themeMode();
    const b = U.$('#theme-toggle');
    if (b) { b.textContent = themeMode() === 'dark' ? '☀️' : '🌙'; b.title = themeMode() === 'dark' ? 'Light mode' : 'Dark mode'; }
  }
  function toggleThemeMode() {
    try { localStorage.setItem('ff_theme', themeMode() === 'dark' ? 'light' : 'dark'); } catch {}
    applyThemeMode();
  }
  // ---- chart PNG buttons -------------------------------------------------------------------------
  function enhanceCharts(root) {
    if (!FF.charts || !FF.charts.download) return;
    U.$$('[data-cid]', root || document).forEach((el) => {
      if (!el || typeof el.appendChild !== 'function' || typeof el.getAttribute !== 'function') return;
      const cid = el.getAttribute('data-cid');
      if (!cid || el.querySelector('.chart-dl')) return;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chart-dl'; btn.textContent = '📷';
      btn.title = 'Chart PNG download'; btn.setAttribute('aria-label', 'Chart PNG download');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardEl = el.closest ? el.closest('.card') : null;
        const h = cardEl && cardEl.querySelector ? cardEl.querySelector('.card-head h3') : null;
        FF.charts.download(cid, U.slug((h && h.textContent ? h.textContent : 'chart').replace(/[^\w\s-]/g, '').trim() || 'chart'));
        U.toast('Chart PNG download ho raha hai ✓', 'ok');
      });
      el.appendChild(btn);
    });
  }
  try { document.documentElement.dataset.theme = themeMode(); } catch {}

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
  function featOk(p) {
    if (p.adminOnly && !(FF.auth.user && FF.auth.user.role === 'admin')) return false;
    return !p.feat || !FF.config.features || FF.config.features[p.feat] !== false;
  }
  function allowed(page, params) { const perm = pagePerm(page, params); const p = pageDef(page); if (p && !featOk(p)) return false; return !perm || FF.auth.can(perm); }
  function enabledTabs() { return (FF.config.allTabs ? FF.config.allTabs(true) : (FF.config.sheets || [])); }
  function firstAllowedPage() {
    if (FF.auth.can('home')) return 'home';
    const p = PAGES.find((x) => x.perm !== 'home' && FF.auth.can(x.perm));
    if (p) return p.id;
    const s = enabledTabs().find((x) => FF.auth.can(`sheet:${x.id}`));
    return s ? 'sheet' : 'settings';
  }

  // ---- sidebar ----
  function navItem(id, icon, label, desc, active, href, badge) {
    return `<a class="nav-item ${active ? 'active' : ''}" data-page="${id}" href="${href}"><span class="nav-ico">${icon}</span><span class="nav-text"><b>${esc(label)}</b><small>${esc(desc || '')}${badge || ''}</small></span></a>`;
  }
  // ⏳ Pending account approvals (admin) — sidebar Settings item par live badge.
  let pendingSignups = 0;
  function setPendingSignups(n) { pendingSignups = Math.max(0, Number(n) || 0); }
  function refreshPendingBadge() {
    if (!FF.auth.isAdmin || !FF.auth.isAdmin()) return Promise.resolve();
    if (FF.config.feat && FF.config.feat('pendingBadge') === false) { setPendingSignups(0); renderSidebar(); return Promise.resolve(); }
    return FF.auth.api('/api/health').then((h) => {
      const n = Number(h && h.pendingSignups) || 0;
      if (n !== pendingSignups) { setPendingSignups(n); renderSidebar(); }
    }).catch(() => {});
  }
  // 📤 WhatsApp share — features.share ON ho tabhi; number blank ho to WhatsApp ka share picker khulta hai.
  function shareWhatsApp(text) {
    if (FF.config.feat && FF.config.feat('share') === false) return false;
    const f = FF.config.features || {};
    const num = String(f.waNumber || (FF.config.contacts && FF.config.contacts.teamWhatsapp) || '').replace(/\D/g, '');
    const url = `https://wa.me/${num}?text=${encodeURIComponent(String(text || '').slice(0, 1800))}`;
    window.open(url, '_blank', 'noopener');
    return true;
  }
  // 🔄 App update toast — server ka sw.js version badla to banner dikhao (Reload se naya cache).
  let versionSeen = '', versionShown = false;
  async function checkVersion() {
    try {
      const out = await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
      const v = out && out.version;
      if (!v || v === 'dev') return;
      if (!versionSeen) { versionSeen = v; return; }
      if (v === versionSeen || versionShown) return;
      if (FF.config.feat && FF.config.feat('updateToast') === false) return;
      versionShown = true;
      if (U.$('#update-toast')) return;
      const el = U.h(`<div class="update-toast" id="update-toast" role="status"><span>🔄 Naya version aaya (${U.esc(v)})</span><button class="btn small primary" id="update-reload">Reload</button><button class="btn small" id="update-later">Baad me</button></div>`);
      document.body.appendChild(el);
      U.$('#update-reload', el).addEventListener('click', () => location.reload());
      U.$('#update-later', el).addEventListener('click', () => el.remove());
    } catch { /* offline */ }
  }
  function startVersionWatch() {
    checkVersion();
    clearInterval(startVersionWatch.timer);
    startVersionWatch.timer = setInterval(checkVersion, 10 * 60e3);
    document.removeEventListener('visibilitychange', onVisibleVersion);
    document.addEventListener('visibilitychange', onVisibleVersion);
  }
  const onVisibleVersion = () => { if (document.visibilityState === 'visible') checkVersion(); };
  let openNavGroup = (() => { try { return localStorage.getItem('ff_nav_group') || 'Management'; } catch { return 'Management'; } })();
  function currentNavGroup(page, params) {
    if (page === 'settings') return 'Account';
    if (page === 'sheet') {
      const tab = enabledTabs().find((s) => s.id === (params && params.name));
      return tab ? (tab.group || 'First Forward') : 'Management';
    }
    const def = pageDef(page);
    return def ? def.group : 'Management';
  }
  function selectNavGroup(group, rerender) {
    openNavGroup = group || 'Management';
    try { localStorage.setItem('ff_nav_group', openNavGroup); } catch {}
    if (rerender !== false) renderSidebar();
  }
  function renderSidebar() {
    const nav = U.$('#nav');
    if (!nav) return;
    const u = FF.auth.user;
    const sheets = enabledTabs().filter((s) => FF.auth.can(`sheet:${s.id}`));
    const groups = [...new Set(PAGES.map((p) => p.group))];
    let html = '';
    for (const group of groups) {
      const items = PAGES.filter((p) => p.group === group && FF.auth.can(p.perm) && featOk(p));
      const groupSheets = group === 'Management' || group === 'Cross Channel' || group === 'Workspace' ? [] : sheets.filter((s) => (s.group || 'First Forward') === group);
      if (!items.length && !groupSheets.length) continue;
      const expanded = openNavGroup === group;
      const bodyId = `nav-group-${U.slug(group)}`;
      const channelClass = group === 'GV Partner' ? 'gv' : group === 'First Forward' ? 'ff' : group === 'Cross Channel' ? 'cross' : '';
      html += `<button type="button" class="nav-sec nav-sec-toggle ${channelClass} ${expanded ? 'open' : ''}" data-nav-group="${esc(group)}" aria-expanded="${expanded}" aria-controls="${bodyId}"><span>${GROUP_ICON[group] || '▦'} ${groupLabel(group)}</span><span class="nav-count">${items.length + groupSheets.length}</span><span class="nav-chevron" aria-hidden="true">›</span></button>`;
      html += `<div class="nav-group-body" id="${bodyId}" ${expanded ? '' : 'hidden'}>`;
      html += items.map((p) => { const L = pageLabel(p); return navItem(p.id, p.icon, L.label, L.desc, current.page === p.id, `#/${p.id}`); }).join('');
      if (groupSheets.length) {
        html += `<div class="nav-sub">${groupLabel('Sheets')}</div>`;
        html += groupSheets.map((s) => `<a class="nav-item sheet ${current.page === 'sheet' && current.params.name === s.id ? 'active' : ''}" data-page="sheet" data-name="${esc(s.id)}" href="#/sheet/${encodeURIComponent(s.id)}"><span class="nav-ico">${s.icon || '📄'}</span><span class="nav-text"><b>${esc(s.id)}</b><small>${esc(s.desc || '')}</small></span></a>`).join('');
      }
      html += '</div>';
    }
    const accountOpen = openNavGroup === 'Account';
    html += `<button type="button" class="nav-sec nav-sec-toggle ${accountOpen ? 'open' : ''}" data-nav-group="Account" aria-expanded="${accountOpen}" aria-controls="nav-group-account"><span>${GROUP_ICON.Account} ${groupLabel('Account')}</span><span class="nav-chevron" aria-hidden="true">›</span></button><div class="nav-group-body" id="nav-group-account" ${accountOpen ? '' : 'hidden'}>`
      + navItem('settings', '⚙️', pageLabel({ id: 'settings', label: 'Settings' }).label, u && u.role === 'admin' ? 'Branding · data · users · access' : 'My account', current.page === 'settings', '#/settings', u && u.role === 'admin' && pendingSignups > 0 ? ` <span class="nav-count" title="${pendingSignups} account approval pending — Settings → Users">${pendingSignups} pending ⏳</span>` : '') + '</div>';
    nav.innerHTML = html;
    nav.querySelectorAll('[data-nav-group]').forEach((btn) => btn.addEventListener('click', () => selectNavGroup(btn.dataset.navGroup)));

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
        // Centre-crop to a square so the round avatar never looks zoomed / cut off.
        const side = Math.min(img.width, img.height);
        const sx = Math.round((img.width - side) / 2), sy = Math.round((img.height - side) / 2);
        const size = maxSide || 256;
        const scale = Math.min(1, size / side);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(side * scale)); c.height = c.width;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,c.width,c.height);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, c.width, c.height);
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
    let title = current.page === 'sheet' ? (current.params.name || 'Sheet') : (FF.pages[current.page] && FF.pages[current.page].title) || '';
    const mode = lang();
    if (mode === 'hi') {
      const HI_TITLES = { Home: 'होम', Dashboard: 'डैशबोर्ड', Trend: 'ट्रेंड', Performance: 'परफ़ॉर्मेंस', Stock: 'स्टॉक', 'Stock Report': 'स्टॉक रिपोर्ट', Targets: 'टार्गेट', Settings: 'सेटिंग्स', 'GV vs First Forward': 'GV बनाम फर्स्ट फॉरवर्ड', Compare: 'तुलना' };
      title = HI_TITLES[title] || title;
    }
    U.$('#top-title').textContent = title;
    document.title = `${title} · ${FF.config.appName}`;
  }

  /** Animated page skeleton — data await ke dauraan hang ki jagah buffering dikhta hai. */
  function pageLoaderHtml(label) {
    return `<div class="page-loader" role="status" aria-live="polite">
      <div class="page-loader-head"><span class="page-loader-spin" aria-hidden="true"></span><b>${esc(String(label || 'Page'))}</b><small>data load ho raha hai<span class="dots">…</span></small></div>
      <div class="page-loader-grid">${'<div class="skel skel-card"></div>'.repeat(6)}</div>
      <div class="skel skel-line w80"></div><div class="skel skel-line w60"></div>
      <div class="skel skel-block"></div>
    </div>`;
  }

  async function renderCurrent(ctx) {
    if (!FF.auth.user) return;
    const { page, params } = parseHash();
    current = { page, params, token: current.token + 1 };
    const token = current.token;
    const pageGroup = currentNavGroup(page, params);
    if (openNavGroup !== pageGroup) selectNavGroup(pageGroup);
    markActive();
    closeSidebar();
    const main = U.$('#main');
    const root = document.createElement('div');
    root.className = `page page-${page}`;
    main.setAttribute('aria-busy', 'true');
    main.replaceChildren(root);
    main.scrollTop = 0; window.scrollTo(0, 0);
    // Slow page render ho to blank screen ("hang") ki jagah animated skeleton — page ka apna content
    // aate hi wo skeleton overwrite kar deta hai (root me content aa chuka ho to loader lagta hi nahi).
    const loaderTimer = setTimeout(() => {
      if (token === current.token && !root.childNodes.length) root.innerHTML = pageLoaderHtml(page === 'sheet' ? params.name : (FF.pages[page] && FF.pages[page].title) || page);
    }, 120);
    if (!allowed(page, params)) {
      root.innerHTML = `<div class="empty-state">🔒 Is page ka access aapke account me nahi hai.<br><small class="dim">Admin se "${esc(pagePerm(page, params) || page)}" permission maango (Settings → Access matrix).</small></div>`;
      main.setAttribute('aria-busy', 'false');
      return;
    }
    if (FF.notifications) FF.notifications.activity(page === 'sheet' ? `Sheet · ${params.name || ''}` : page);
    try {
      await FF.pages[page].render(root, params, ctx || {});
    } catch (err) {
      console.error(err);
      if (token === current.token) root.innerHTML = U.errorBox(err, 'data-action="refresh"');
    }
    clearTimeout(loaderTimer);
    if (token === current.token) { main.setAttribute('aria-busy', 'false'); updateStatus(); enhanceCharts(root); translateDom(root); }
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
    const errs = Object.keys(st.errors || {}).length + (gv ? Object.keys(gv.errors).length : 0);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    el.innerHTML = offline
      ? '<span class="dot warn"></span> 📴 Offline — last loaded data dikh raha hai'
      : (t ? `<span class="dot ${errs ? 'warn' : 'live'}\"></span> Data ${U.timeLabel(t)}${errs ? ` · ${errs} failed` : ''}${pre && pre.done ? ' · all sheets ready ✓' : ''}` : '<span class="dot"></span> Ready');
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
      if (FF.insights && FF.insights.reset) FF.insights.reset();
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
  function openDrawer({ kicker, title, sub, body, actions, wide }) {
    U.$('#drawer').classList.toggle('wide', !!wide);
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
    enhanceCharts(U.$('#drawer-body'));
    translateDom(U.$('#drawer-body'));
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
    if (FF.config.feat && FF.config.feat('share') === false) { U.toast('WhatsApp share band hai — Settings → 🎛 Features se ON karo', 'warn'); return; }
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
    // Sidebar stays fixed/visible on desktop — the old hover auto-hide mode is removed.
    document.body.classList.remove('sidebar-auto'); try { localStorage.removeItem('ff_sidebar_auto'); } catch { /* private mode */ }
    window.addEventListener('hashchange', () => { renderCurrent(); toggleUserMenu(false); });
    U.$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('side-open'));
    const themeBtn = U.$('#theme-toggle'); if (themeBtn) themeBtn.addEventListener('click', toggleThemeMode);
    const langBtn = U.$('#lang-toggle'); if (langBtn) langBtn.addEventListener('click', toggleLangMenu);
    applyThemeMode();
    window.addEventListener('online', () => { updateStatus(); U.toast('🌐 Internet wapas aa gaya — ↻ se fresh data lao', 'ok'); });
    window.addEventListener('offline', () => { updateStatus(); U.toast('📴 Offline ho — last loaded data dikhega', 'warn'); });
    U.$('#side-backdrop').addEventListener('click', closeSidebar);
    U.$('#top-refresh').addEventListener('click', refresh);
    const saveViewBtn = U.$('#save-view-btn');
    if (saveViewBtn) saveViewBtn.addEventListener('click', () => {
      if (FF.workspace && FF.workspace.openSave) FF.workspace.openSave();
      else U.toast('Saved views module ready nahi hai', 'warn');
    });
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
      if (kpi && !e.target.closest('a,button:not(.kpi)') && !kpi.closest('#drawer')) {
        if (FF.kpiDetail) { FF.kpiDetail.open(kpi); return; }
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
      if (paramBtn) {
        const patch = { [paramBtn.dataset.param]: paramBtn.dataset.value };
        // GV Stock tabs/Clear must not leave an old TL/agent search in the URL; otherwise that
        // stale parameter wins on the next render and makes the selected tab look broken.
        if (current.page === 'gvStock' && paramBtn.dataset.param === 'view') Object.assign(patch, { tl: '', agent: '' });
        updateParams(patch);
      }
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
    if (['stock', 'stockReport', 'home', 'executive', 'forecast', 'dataQuality', 'dualChannel', 'ffCommission', 'gvCommission', 'tagIssued', 'dashboard', 'trend', 'performance', 'gvStock', 'gvStockReport', 'gvDashboard', 'gvTrend', 'gvPerformance', 'compare', 'charts', 'sheet'].includes(current.page)) {
      renderCurrent({ bgUpdated: true });
    }
  }

  let syncTimer = null;
  let swRegistrationPromise = null;
  /** 📲 Service worker ko notifications.start() se PEHLE register karo — warna push subscribe
      `navigator.serviceWorker.ready` par atak jaata tha aur mobile panel silent reh jaata tha. */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (!swRegistrationPromise) {
      swRegistrationPromise = navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('SW registered · scope', reg.scope, '· push', !!(reg.pushManager));
          // SW ne khud skipWaiting() kiya hai; update milte hi clients.claim() ho jaata hai.
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'activated' && FF.notifications && FF.notifications.retryPush) FF.notifications.retryPush(); });
          });
          return reg;
        })
        .catch((err) => {
          console.warn('SW registration failed', err && err.message);
          swRegistrationPromise = null; // agli baar retry ho sake
          return null;
        });
    }
    return swRegistrationPromise;
  }
  const EMBED_LIVE = new URLSearchParams(location.search).get('embed') === 'live' && window.top !== window;
  function storageBanner(storage) {
    const old = U.$('#storage-banner'); if (old) old.remove();
    if (!storage || (storage.durable !== false && !storage.warning && !storage.error)) return;
    const el = U.h(`<div class="storage-banner" id="storage-banner" role="alert"><span>⚠️ <b>Settings aur user details permanent save nahi ho rahe</b> — ${U.esc(storage.error || 'Render restart / deploy par sab default ho jaayega.')} </span><a class="btn small primary" href="#/settings?tab=backup">☁️ Google Sheet storage setup karo</a><button class="btn small ghost" aria-label="Hide" data-hide-banner>✕</button></div>`);
    el.querySelector('[data-hide-banner]').addEventListener('click', () => el.remove());
    const main = U.$('#main');
    if (main && main.parentNode) main.parentNode.insertBefore(el, main); else document.body.prepend(el);
  }
  /** 📲 Push health banner (admin) — VAPID keys durable na hon to phone panel silent ho jaata hai. */
  function pushBanner(push) {
    const old = U.$('#push-banner'); if (old) old.remove();
    if (!push || push.enabled === false || !push.warning) return;
    const el = U.h(`<div class="storage-banner" id="push-banner" role="alert"><span>📲 <b>Mobile push notifications toot sakte hain</b> — ${U.esc(push.warning)} </span><a class="btn small primary" href="#/settings?tab=account">🩺 Push diagnostics</a><button class="btn small ghost" aria-label="Hide" data-hide-push-banner>✕</button></div>`);
    el.querySelector('[data-hide-push-banner]').addEventListener('click', () => el.remove());
    const main = U.$('#main');
    if (main && main.parentNode) main.parentNode.insertBefore(el, main); else document.body.prepend(el);
  }
  function liveShareChip() {
    const foot = U.$('.side-foot'); if (!foot) return;
    let chip = U.$('#live-share-chip');
    const u = FF.auth.user;
    const on = u && u.role !== 'admin' && localStorage.getItem('ff_presence_pointer') !== '0';
    if (!on) { if (chip) chip.remove(); return; }
    if (!chip) { chip = U.h('<a class="live-share-chip" id="live-share-chip" href="#/settings?tab=account" title="Admin aapka page, cursor aur clicks live dekh sakta hai. Settings → My account me band kar sakte ho.">👁 Admin live view on</a>'); foot.insertBefore(chip, foot.firstChild); }
  }
  function onLogin() {
    if (EMBED_LIVE) {
      // Admin live-view mirror: render only the page, no timers / prompts / notifications.
      document.body.classList.add('embed-live', 'ready');
      renderSidebar();
      FF.auth.applyTheme();
      if (FF.preloader) FF.preloader.preloadAll(false).catch(console.warn);
      renderCurrent();
      return;
    }
    renderSidebar();
    FF.auth.applyTheme();
    document.body.classList.add('ready');
    // Start one shared load BEFORE rendering; page requests join it.
    if (FF.preloader) FF.preloader.preloadAll(false).catch(console.warn);
    renderCurrent();
    if (FF.config.loginAnimation !== false) FF.auth.splash(FF.auth.user);
    registerServiceWorker(); // push notifications ke liye SW pehle ready ho
    if (FF.notifications) FF.notifications.start();
    liveShareChip();
    // 🔍 Global search button — features.search OFF ho to hide
    const gsBtn = U.$('#global-search-btn');
    if (gsBtn) gsBtn.hidden = FF.config.feat && FF.config.feat('search') === false;
    const svBtn = U.$('#save-view-btn');
    if (svBtn) svBtn.hidden = !FF.auth.can('savedViews');
    startVersionWatch(); // 🔄 update-available toast (features.updateToast)
    const u = FF.auth.user;
    if (FF.auth.isAdmin()) FF.auth.api('/api/health').then(h => { storageBanner(h.storage); pushBanner(h.push); setPendingSignups(h.pendingSignups); renderSidebar(); }).catch(() => {});
    if (u && u.mustChangePassword) setTimeout(() => U.toast('⚠️ Default password chal raha hai — Settings → My account se badlo', 'err'), 900);
    // Location prompt + PWA
    setTimeout(requestLocationOnOpen, 2000);
    updateInstallBtn();
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

  FF.app = { storageBanner, pushBanner, liveShareChip, navigate, updateParams, refresh, openDrawer, closeDrawer, renderSidebar, renderCurrent, renderTopUser, updateStatus, onLogin, onBackgroundDataUpdated, promptInstall, enhanceCharts, themeMode, toggleThemeMode, lang, setLang, toggleLangMenu, PAGES, refreshPendingBadge, setPendingSignups, shareWhatsApp, checkVersion, get pendingSignups() { return pendingSignups; }, get current() { return current; } };
  document.addEventListener('DOMContentLoaded', init);
})(window.FF);
