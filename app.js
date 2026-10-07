/* App shell: login gate, sidebar, topbar with PWA install + user menu v2, hash router, drawer.
   Data: FF.store + FF.gv preloaded on login, plus FF.preloader for all sheets in background — instant sheet open. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;

  const PAGES = [
    // 🧹 v3.62 — retired pages (Operations Control Tower · Executive Cockpit · TV Mode · GV & FF
    // Commission Intelligence · Charts · Stock Forecasting · TL Scorecard · Stock Radar · poora
    // Workspace group · poora Wow Zone group) yahan se hata di gayi hain. Sidebar me nahi dikhti aur
    // inka module (lazy GROUPS) download bhi nahi hota. Purana bookmark/WhatsApp/notification link
    // khule to RETIRED_PAGES use safe page par redirect kar deta hai.
    { id: 'home', icon: '🏠', label: 'Home', desc: 'Highlights · GV & FF charts', perm: 'home', group: 'Management' },
    { id: 'tagIssued', icon: '🏷️', label: 'GV & FF Tag Issued', desc: 'Date-wise detailed issuance · VC4 vs Commercial', perm: 'tagIssued', group: 'Management' },
    { id: 'targets', icon: '🎯', label: 'Agent Targets', desc: 'Shortlist · target · progress · Excel', perm: 'targets', group: 'Management' },
    { id: 'tagRequest', icon: '🏷️', label: 'Tag Request', desc: 'IDFC agents · employee + har agent ka mobile/address/pincode + class-wise qty → admin table (select · print · approve)', perm: 'tagRequest', group: 'Management' },
    { id: 'masterSearch', icon: '🔎', label: 'Master Search', desc: 'GV + FF · naam / ID / mobile → seedha poora profile (koi list nahi)', perm: 'masterSearch', group: 'Management' },
    { id: 'rangeReport', icon: '📅', label: 'Range Report', desc: 'Custom from→to report · FF + GV · Excel', perm: 'rangeReport', group: 'Management' },
    { id: 'teamMap', icon: '🗺️', label: 'Team map', desc: 'Location + office distance (admin)', perm: 'teamMap', group: 'Management', feat: 'teamMap', adminOnly: true },
    { id: 'dashboard', icon: '📊', label: 'Dashboard', desc: 'KPIs & charts (EIR)', perm: 'dashboard', group: 'First Forward' },
    { id: 'trend', icon: '📈', label: 'Trend', desc: 'Daily · Monthly · Last vs Current', perm: 'trend', group: 'First Forward' },
    { id: 'performance', icon: '🏆', label: 'Performance', desc: 'Agents & TLs (REPORT)', perm: 'performance', group: 'First Forward' },
    { id: 'stock', icon: '📦', label: 'Stock', desc: 'Search · pivot · Excel (StockDataa)', perm: 'stock', group: 'First Forward' },
    { id: 'gvDashboard', icon: '🚀', label: 'GV Partner Dashboard', desc: 'GV issuance · stock · performance', perm: 'gvDashboard', group: 'GV Partner' },
    { id: 'gvTrend', icon: '📈', label: 'GV Trend', desc: 'GV Master daily / monthly', perm: 'gvTrend', group: 'GV Partner' },
    { id: 'gvPerformance', icon: '🏆', label: 'GV Performance', desc: 'GV agents & TLs (GV REPORT)', perm: 'gvPerformance', group: 'GV Partner' },
    { id: 'gvStock', icon: '📦', label: 'GV Stock', desc: 'Tag Assignment stock search', perm: 'gvStock', group: 'GV Partner' },
    { id: 'gvStockReport', icon: '📋', label: 'GV Stock Report', desc: 'GV REPORT · agent, TL, class & dispatch', perm: 'gvStockReport', group: 'GV Partner' },
    { id: 'dualChannel', icon: '🔗', label: 'Dual-channel Agents', desc: 'Verified GV + FF overlap · separate & combined', perm: 'dualChannel', group: 'Cross Channel' },
    { id: 'masterStock', icon: '🗄️', label: 'Master Stock', desc: 'Barcode / agent / TL / GV search · StockDataa ↔ Tag Assignment reconciliation', perm: 'masterStock', group: 'Cross Channel' },
    { id: 'compare', icon: '⚖️', label: 'GV vs First Forward', desc: 'Dono ka side-by-side comparison', perm: 'compare', group: 'Cross Channel' },
    { id: 'dataQuality', icon: '🧪', label: 'Data Quality Center', desc: 'Duplicates · missing IDs · stale & mismatch checks', perm: 'dataQuality', group: 'Cross Channel' },
    { id: 'dispatchPlan', icon: '🚚', label: 'Dispatch Planner', desc: 'Auto box plan · printable pick-list · WhatsApp', perm: 'dispatchPlan', group: 'Cross Channel' },
    { id: 'directAgents', icon: '🧍', label: 'Direct Agents & TLs', desc: 'FF: TL Name APS · GV: TL ID + Name blank — ek hi rule poore site par', perm: 'directAgents', group: 'Cross Channel' },
    { id: 'newAgents', icon: '🆕', label: 'New Agents & TL Changes', desc: 'Naye agents · TL badla / hata — FF + GV alag table, click → poori profile', perm: 'newAgents', group: 'Cross Channel' },
    { id: 'unusual', icon: '🚨', label: 'Unusual Activity', desc: 'High Wrong VRN · Replacement · Chassis · single-day spike — agent-wise flags (FF + GV)', perm: 'unusual', group: 'Cross Channel' },
    { id: 'ffAgentSummary', icon: '📄', label: 'Agent / TL Summary', desc: 'FF agent ya TL → stock · issuance · ageing · Share / PDF', perm: 'ffAgentSummary', group: 'First Forward' },
    { id: 'gvAgentSummary', icon: '📄', label: 'Agent / TL Summary', desc: 'GV agent ya TL → stock · issuance · ageing · Share / PDF', perm: 'gvAgentSummary', group: 'GV Partner' },
    { id: 'fastagChampions', icon: '🏆', label: 'FASTag Champions', desc: 'Top agents/TLs by VC4, Commercial, Chassis, Replacement, Wrong VRN — FF & GV', perm: 'fastagChampions', group: 'Cross Channel' },
  ];
  const GROUP_ICON = { 'Management': '🧭', 'First Forward': '🟦', 'GV Partner': '🟩', 'Cross Channel': '🔗', 'Workspace': '🗂️', 'Account': '👤', 'Wow Zone': '🎉' };
  // ── 🧹 v3.62 · RETIRED PAGES ────────────────────────────────────────────────────────────────────
  // Ye pages app se hata di gayi hain (client request: sirf kaam ki cheezein — site halki aur phone
  // par smooth). Modules disk par hain (koi purana code crash na ho), par:
  //   • PAGES/lazy GROUPS me nahi → koi download/parse nahi,
  //   • purana bookmark / WhatsApp link / notification link khule to yahan se redirect ho jaata hai.
  // Naya page add karna ho to sirf upar PAGES me line daalo — yahan kuch nahi chhedna padta.
  const RETIRED_PAGES = {
    controlTower: 'home', executive: 'home', tv: 'home',
    ffCommission: 'home', gvCommission: 'gvDashboard',
    charts: 'home', forecast: 'stock', tlScorecard: 'performance', stockRadar: 'stock',
    savedViews: 'home', reportStudio: 'home', followups: 'home',
    arena: 'home', fame: 'home', warRoom: 'home', activity: 'home', network: 'home',
    radar: 'home', reportCards: 'home', sprints: 'home'
  };
  const retiredTarget = (id) => (Object.prototype.hasOwnProperty.call(RETIRED_PAGES, id) ? RETIRED_PAGES[id] : '');
  const pageDef = (id) => PAGES.find((p) => p.id === id) || null;
  let current = { page: '', params: {}, token: 0 };

  // ---- shared shell state -------------------------------------------------------------------------
  const readLocalJson = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; } };
  const writeLocalJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };
  // Shared cross-page workspace filters were removed: each report now owns its own filters.
  // Clear any old saved filter snapshot so it cannot silently constrain data after an upgrade.
  function currentFilterValues() {
    const params = current.params || {};
    return {
      period: params.period || 'month', month: params.month || '',
      channel: params.channel || params.ch || '', tl: params.tl || '', agent: params.agent || '', cls: params.cls || ''
    };
  }
  function clearGlobalFilters() {
    try { localStorage.removeItem('ff_global_filters'); } catch { /* private mode */ }
    updateParams({ period: '', channel: '', ch: '', tl: '', agent: '', cls: '', month: '', from: '', to: '', date: '' });
  }
  function renderGlobalFilters() {
    const bar = U.$('#global-filter-bar');
    if (bar) { bar.hidden = true; bar.replaceChildren(); }
    try { localStorage.removeItem('ff_global_filters'); } catch { /* private mode */ }
  }
  // v3.59 — Bottom bar icons are inline SVG, not emoji. Emoji (🏷️ 🔔 ⌂ ★ ☰) render at different
  // sizes/weights per phone and are missing on many Android devices → the bar looked misaligned.
  // One 24×24 stroke icon set now keeps every tab the same size, baseline and visual weight.
  const NAV_ICONS = {
    home: '<path d="M3.6 10.9 12 3.9l8.4 7"/><path d="M6.2 9.6V19a1.4 1.4 0 0 0 1.4 1.4h2.9v-4.7h3v4.7h2.9A1.4 1.4 0 0 0 17.8 19V9.6"/>',
    tag: '<path d="M20.4 13.4 13.4 20.4a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12V4.5A1.5 1.5 0 0 1 4.5 3H12a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8Z"/><circle cx="7.9" cy="7.9" r="1.4"/>',
    bell: '<path d="M6.4 9.7a5.6 5.6 0 0 1 11.2 0c0 3.3.8 4.8 1.6 5.7.4.5 0 1.3-.7 1.3H5.5c-.7 0-1.1-.8-.7-1.3.8-.9 1.6-2.4 1.6-5.7Z"/><path d="M9.9 19.6a2.2 2.2 0 0 0 4.2 0"/>',
    team: '<path d="M8.2 20.4h7.6"/><path d="M12 16.7v3.7"/><path d="M6.6 4.6h10.8v4.5a5.4 5.4 0 0 1-10.8 0V4.6Z"/><path d="M6.6 6.6H4.9a2 2 0 0 0 2 3.6"/><path d="M17.4 6.6h1.7a2 2 0 0 1-2 3.6"/>',
    more: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>'
  };
  const navIcon = (key) => `<svg class="mnav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">${NAV_ICONS[key] || NAV_ICONS.more}</svg>`;

  function renderMobileNav() {
    const nav = U.$('#mobile-nav');
    if (!nav) return;
    if (!FF.auth || !FF.auth.user) {
      nav.hidden = true;
      nav.replaceChildren();
      document.body.classList.remove('has-mobile-nav');
      return;
    }
    // Native-app style: keep five primary destinations/actions visible and thumb-friendly.
    // Search remains available from the top search/command palette; More exposes every route.
    const items = [
      { kind: 'route', id: 'home', icon: 'home', label: 'Home' },
      { kind: 'route', id: 'tagIssued', icon: 'tag', label: 'Tag Issued' },
      { kind: 'action', id: 'notifications', icon: 'bell', label: 'Alerts' },
      { kind: 'route', id: 'performance', icon: 'team', label: 'Team' },
      { kind: 'action', id: 'more', icon: 'more', label: 'More' }
    ];
    nav.hidden = false;
    document.body.classList.add('has-mobile-nav');
    nav.setAttribute('aria-label', 'Primary mobile navigation');
    nav.innerHTML = items.map((x) => {
      const active = x.kind === 'route' && current.page === x.id;
      if (x.kind === 'route') return `<a href="#/${x.id}" class="mobile-nav-item ${active ? 'active' : ''}" aria-label="${esc(x.label)}"><span aria-hidden="true">${navIcon(x.icon)}</span><small>${esc(x.label)}</small></a>`;
      const badge = x.id === 'notifications' ? '<b class="mobile-nav-badge" id="mobile-notification-count" hidden>0</b>' : '';
      const menuAttrs = x.id === 'more' ? ' aria-controls="sidebar" aria-expanded="false"' : '';
      return `<button type="button" class="mobile-nav-item mobile-nav-action" data-mobile-action="${x.id}" aria-label="${esc(x.label)}"${menuAttrs}><span aria-hidden="true">${navIcon(x.icon)}${badge}</span><small>${esc(x.label)}</small></button>`;
    }).join('');
    try {
      const count = FF.notifications && FF.notifications.countUnread ? FF.notifications.countUnread() : 0;
      const badge = U.$('#mobile-notification-count');
      if (badge) { badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = count < 1; }
    } catch { /* notifications optional during boot */ }
  }
  function updateFocusMode(on) {
    const enabled = on === undefined ? document.documentElement.classList.toggle('focus-mode') : !!on;
    if (on !== undefined) document.documentElement.classList.toggle('focus-mode', enabled);
    try { localStorage.setItem('ff_focus_mode', enabled ? '1' : '0'); } catch {}
    const btn = U.$('#focus-toggle');
    if (btn) { btn.classList.toggle('active', enabled); btn.setAttribute('aria-pressed', String(enabled)); btn.title = enabled ? 'Exit focus mode' : 'Focus mode'; }
    document.body.classList.toggle('focus-mode', enabled);
    return enabled;
  }
  function renderA11yPanel() {
    const old = U.$('#a11y-panel'); if (old) old.remove();
    const state = readLocalJson('ff_a11y', { largeText: false, highContrast: false, reducedMotion: false });
    const pref = U.loaderPref ? U.loaderPref() : 'mix';
    const styles = ['mix', ...(U.LOADER_STYLES || [])];
    const loaderPick = U.loader ? `<div class="a11y-loader"><label>🌀 Loader style <select class="select small" data-a11y-loader>${styles.map((k) => `<option value="${k}" ${k === pref ? 'selected' : ''}>${esc((U.LOADER_LABELS || {})[k] || k)}</option>`).join('')}</select></label><div class="a11y-loader-preview" data-a11y-loader-preview>${pref === 'mix' ? U.LOADER_STYLES.map((k) => U.loader(k, { size: 'md' })).join('') : U.loader(pref, { size: 'lg' })}</div><small class="dim">Loader hamesha chalta hai — Mac/Windows me "Reduce motion" ON ho tab bhi, taaki pata chale data aa raha hai (atka nahi hai).</small></div>` : '';
    const panel = U.h(`<div class="a11y-panel" id="a11y-panel" role="dialog" aria-label="Accessibility mode"><div class="a11y-head"><b>Accessibility mode</b><button class="icon-btn small" data-a11y-close aria-label="Close">✕</button></div><p class="dim small">Readable, keyboard-friendly controls — settings persist on this device.</p><label><input type="checkbox" data-a11y="largeText" ${state.largeText ? 'checked' : ''}> Larger text</label><label><input type="checkbox" data-a11y="highContrast" ${state.highContrast ? 'checked' : ''}> High contrast + stronger borders</label><label><input type="checkbox" data-a11y="reducedMotion" ${state.reducedMotion ? 'checked' : ''}> Reduce motion (decorations band · loader chalta rahega)</label>${loaderPick}<button class="btn small" data-a11y-reset>Reset accessibility</button></div>`);
    document.body.appendChild(panel);
    const apply = (key, value) => { state[key] = value; writeLocalJson('ff_a11y', { ...state }); document.documentElement.classList.toggle(A11Y_CLASS[key], value); };
    panel.querySelectorAll('[data-a11y]').forEach((el) => el.addEventListener('change', () => apply(el.dataset.a11y, el.checked)));
    const pick = panel.querySelector('[data-a11y-loader]');
    if (pick) pick.addEventListener('change', () => {
      try { localStorage.setItem('ff_loader_style', pick.value); } catch { /* private mode */ }
      const box = panel.querySelector('[data-a11y-loader-preview]');
      if (box) box.innerHTML = pick.value === 'mix' ? U.LOADER_STYLES.map((k) => U.loader(k, { size: 'md' })).join('') : U.loader(pick.value, { size: 'lg' });
      U.toast(pick.value === 'mix' ? '🌀 Loader: har baar naya style' : `🌀 Loader style: ${(U.LOADER_LABELS || {})[pick.value] || pick.value}`, 'ok');
    });
    panel.querySelector('[data-a11y-close]').addEventListener('click', () => panel.remove());
    panel.querySelector('[data-a11y-reset]').addEventListener('click', () => { writeLocalJson('ff_a11y', { largeText: false, highContrast: false, reducedMotion: false }); Object.values(A11Y_CLASS).forEach((c) => document.documentElement.classList.remove(c)); try { localStorage.removeItem('ff_loader_style'); } catch { /* */ } panel.remove(); });
  }
  // CSS classes (styles.css): a11y-large · a11y-contrast · a11y-motion — pehle JS galat naam lagata tha, toggles kaam nahi karte the.
  const A11Y_CLASS = { largeText: 'a11y-large', highContrast: 'a11y-contrast', reducedMotion: 'a11y-motion' };
  function applyA11y() {
    const state = readLocalJson('ff_a11y', {});
    Object.keys(A11Y_CLASS).forEach((key) => document.documentElement.classList.toggle(A11Y_CLASS[key], !!state[key]));
  }
  function maybeOnboarding() {
    if (!FF.auth.user || EMBED_LIVE) return;
    try { if (localStorage.getItem('ff_onboarding_seen') === '1') return; localStorage.setItem('ff_onboarding_seen', '1'); } catch { return; }
    setTimeout(() => {
      if (U.$('#onboarding-tour') || !document.body.classList.contains('ready')) return;
      const tour = U.h(`<div class="onboarding-backdrop" id="onboarding-tour" role="dialog" aria-modal="true" aria-labelledby="tour-title"><section class="onboarding-card"><div class="tour-kicker">FIRST FORWARD · QUICK TOUR</div><h2 id="tour-title">Your command center is ready</h2><p id="tour-copy">Use the sidebar for pages, each report’s own filters for its data, and <kbd>Ctrl</kbd> <kbd>K</kbd> to search or run commands.</p><div class="tour-progress" id="tour-progress">1 / 4</div><div class="onboarding-actions"><button class="btn" data-tour-skip>Skip</button><button class="btn primary" data-tour-next>Next →</button></div></section></div>`);
      document.body.appendChild(tour);
      const steps = [
        ['Navigation + reports', 'Sidebar groups your management, FF, GV and cross-channel work. Report filters stay local to the report you are viewing.'],
        ['Search + export', 'Press Ctrl / ⌘ + K for pages, agents, TLs, tags and calculations. Table toolbars provide density, columns and CSV export.'],
        ['Notifications + offline', 'The bell shows unread alerts and actions. The status dot tells you when the last snapshot is available; offline mode keeps the last known data.'],
        ['Personalise your workspace', 'Use 🎯 Focus mode for management screens, ♿ Accessibility mode for readable contrast and text, 🎨 theme packs, and Settings for profiles.']
      ];
      let i = 0;
      const draw = () => { U.$('#tour-title', tour).textContent = steps[i][0]; U.$('#tour-copy', tour).textContent = steps[i][1]; U.$('#tour-progress', tour).textContent = `${i + 1} / ${steps.length}`; U.$('[data-tour-next]', tour).textContent = i === steps.length - 1 ? 'Done ✓' : 'Next →'; };
      const close = () => tour.remove();
      U.$('[data-tour-skip]', tour).addEventListener('click', close);
      U.$('[data-tour-next]', tour).addEventListener('click', () => { if (i === steps.length - 1) close(); else { i++; draw(); } });
      draw();
    }, 1200);
  }

  // ---- language (English / हिंदी) — navigation & titles -----------------------------------------
  const HI_PAGES = {
    home: { label: 'होम', desc: 'हाइलाइट्स · GV और FF चार्ट' },
    tagIssued: { label: 'GV और FF टैग जारी', desc: 'तारीख़ अनुसार विस्तृत जारी · VC4 बनाम कॉमर्शियल' },
    targets: { label: 'एजेंट टार्गेट', desc: 'शॉर्टलिस्ट · टार्गेट · प्रोग्रेस · उपलब्धि इतिहास · TL रोलअप' },
    tagRequest: { label: 'टैग रिक्वेस्ट', desc: 'IDFC एजेंट · कर्मचारी + हर एजेंट का मोबाइल/पता/पिनकोड + क्लास-वार मात्रा → एडमिन टेबल (चुनें · प्रिंट · अप्रूव)' },
    rangeReport: { label: 'रेंज रिपोर्ट', desc: 'मनचाही तारीख़ रेंज · FF + GV संयुक्त · एक्सेल' },
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
    compare: { label: 'GV बनाम फर्स्ट फॉरवर्ड', desc: 'दोनों की तुलना' },
    settings: { label: 'सेटिंग्स' },
    newAgents: { label: 'नए एजेंट और TL बदलाव', desc: 'नए एजेंट · TL बदला / हटा — FF + GV अलग टेबल' },
    directAgents: { label: 'डायरेक्ट एजेंट और TL', desc: 'FF: TL Name APS · GV: TL ID + Name खाली — पूरी साइट पर एक ही नियम' },
    fastagChampions: { label: 'फास्टैग चैंपियंस', desc: 'टॉप एजेंट/TL — VC4, कॉमर्शियल, चेसिस, रिप्लेसमेंट, रॉन्ग VRN · FF और GV' },
  };
  const HI_GROUPS = { 'Management': 'मैनेजमेंट', 'First Forward': 'फर्स्ट फॉरवर्ड', 'GV Partner': 'जीवी पार्टनर', 'Cross Channel': 'क्रॉस चैनल', 'Workspace': 'वर्कस्पेस', 'Account': 'अकाउंट', 'Sheets': 'शीट्स' };
  const EN_PAGES = {
    home: { desc: 'Highlights · GV & FF charts' },
    tagIssued: { desc: 'Date-wise detailed issuance · VC4 vs Commercial' },
    targets: { desc: 'Shortlist agents · set targets · track progress · Excel' },
    tagRequest: { desc: 'IDFC agents · employee + each agent’s mobile/address/pincode + class-wise qty → admin table (select · print · approve)' },
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
    if (FF.i18n) FF.i18n.set(v);
    renderSidebar();
    renderTopUser();
    applyThemeMode();
    const msg = v === 'hi' ? 'भाषा बदल गई — पूरी साइट हिंदी में है ✓' : v === 'en' ? 'Language changed — whole site is now in English ✓' : 'Language changed — poori site Hinglish me hai ✓';
    U.toast(msg, 'ok');
    renderCurrent();                                  // page dobara render (source Hinglish se)
    if (FF.i18n) FF.i18n.translateTitle(v);
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
  /** 🌐 Site-wide language: poori DOM walk hoti hai — text nodes + title/placeholder/aria-label.
      Tables, KPI cards, badges, drawers, notifications, dynamic messages — sab translate. */
  function translateDom(root) {
    const mode = lang();
    if (mode === 'hinglish') return;
    const el = root || document.body;
    if (!el) return;
    if (FF.i18n) FF.i18n.translateTree(el, mode);
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

  // Filter badalne par kabhi kabhi nayi hash purani jaisi hi hoti hai (jaise "This month" jab pehle
  // se month hi tha). Us case me location.hash event nahi aata aur page purana hi rehta tha — isliye
  // jab hash same ho to ye override memory me rakha jaata hai aur page khud dobara render hota hai.
  let paramOverride = null;
  // ⚡ v3.23 — page id resolve kabhi bhi FF.pages registry par depend NAHI karega. Lazy modules
  // (settings, wow, insights, gvpages …) apna FF.pages[name] tab register karte hain jab wo load
  // hon — isliye purana `if (!FF.pages[page]) → firstAllowedPage()` har lazy page ko pehle click
  // par chup-chaap Home par bhej deta tha, aur uske baad wahi link dobara click karne par hash
  // same hone se kuch hota hi nahi tha ("panel ke option khulte hi nahi"). Ab PAGES registry
  // (app.js ka pageDef) bhi valid maana jaata hai — module aage se load ho jayega (lazy.ensure).
  const PAGE_ALIAS = { gvPartner: 'gvDashboard', comparison: 'compare', gvd: 'gvDashboard', 'gv-ff': 'tagIssued' };
  function pageKnown(id) {
    if (!id) return false;
    if (id === 'sheet' || id === 'settings') return true;
    if (pageDef(id)) return true;                 // app registry — module load hone se PEHLE bhi valid
    return !!(FF.pages && FF.pages[id]);          // dynamically registered pages (tests/legacy)
  }
  /** Hash ke page id ko valid page me resolve karo (alias map + unknown fallback). */
  function resolvePage(id) {
    if (!id) return firstAllowedPage();
    if (PAGE_ALIAS[id]) return PAGE_ALIAS[id];
    // 🧹 v3.62 — hata di gayi page par purana link (bookmark / WhatsApp / notification) aaye to
    // yahin safe page resolve ho jaata hai — koi adhoora render ya blank screen nahi.
    const retired = retiredTarget(id);
    if (retired) return FF.auth.can && !FF.auth.can(retired) ? firstAllowedPage() : retired;
    return pageKnown(id) ? id : firstAllowedPage();
  }
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const segs = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const params = {};
    new URLSearchParams(queryPart || '').forEach((v, k) => { params[k] = v; });
    const initialRoute = segs.length ? null : firstAllowedRoute();
    let page = segs[0] || initialRoute.page;
    if (page === 'sheet') {
      params.name = segs.length ? segs.slice(1).join('/') : (initialRoute.params.name || '');
    }
    page = resolvePage(page);
    if (paramOverride && paramOverride.hash === location.hash && paramOverride.page === page) {
      Object.assign(params, paramOverride.params);
    }
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
  function navigate(page, params) {
    const next = buildHash(page, params || {});
    if (location.hash === next) {
      // Same URL — hashchange nahi aayega. Params memory me rakh kar page ko khud refresh karo,
      // warna filter badalne par kuch hota hi nahi dikhta (purana bug).
      paramOverride = { hash: next, page, params: { ...(params || {}) } };
      renderCurrent();
      return;
    }
    paramOverride = null;
    location.hash = next;
  }
  function updateParams(patch) { navigate(current.page, { ...current.params, ...patch }); }
  function pagePerm(page, params) {
    if (page === 'sheet') return `sheet:${(params && params.name) || ''}`;
    if (page === 'settings') return null;
    const p = pageDef(page);
    return p ? p.perm : null;
  }
  function featOk(p) {
    if (p.adminOnly && !FF.auth.isAdmin()) return false; // 👁 preview me target ke hisaab se
    return !p.feat || !FF.config.features || FF.config.features[p.feat] !== false;
  }
  function allowed(page, params) { const perm = pagePerm(page, params); const p = pageDef(page); if (p && !featOk(p)) return false; return !perm || FF.auth.can(perm); }
  function enabledTabs() { return (FF.config.allTabs ? FF.config.allTabs(true) : (FF.config.sheets || [])); }
  function firstAllowedRoute() {
    if (FF.auth.can('home')) return { page: 'home', params: {} };
    const p = PAGES.find((x) => x.perm !== 'home' && featOk(x) && FF.auth.can(x.perm));
    if (p) return { page: p.id, params: {} };
    const s = enabledTabs().find((x) => FF.auth.can(`sheet:${x.id}`));
    return s ? { page: 'sheet', params: { name: s.id } } : { page: 'settings', params: {} };
  }
  function firstAllowedPage() { return firstAllowedRoute().page; }

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
      + navItem('settings', '⚙️', pageLabel({ id: 'settings', label: 'Settings' }).label, FF.auth.isAdmin() ? 'Branding · data · users · access' : 'My account', current.page === 'settings', '#/settings', FF.auth.isAdmin() && pendingSignups > 0 ? ` <span class="nav-count" title="${pendingSignups} account approval pending — Settings → Users">${pendingSignups} pending ⏳</span>` : '') + '</div>';
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
    // Android Chrome sometimes does not emit beforeinstallprompt until the browser menu has
    // been opened once. Keep a visible, manual-install entry on mobile instead of silently
    // hiding it; tapping it gives the exact browser-specific steps below.
    const mobile = document.documentElement.classList.contains('mobile-ui') || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    btn.hidden = !!(pwaInstalled || isStandalone || (!deferredPrompt && !mobile));
  }
  async function promptInstall() {
    if (!deferredPrompt) {
      const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent || '');
      U.toast(ios
        ? 'App banane ke liye Safari Share ↗ → Add to Home Screen dabao, phir home-screen icon se kholo.'
        : 'Chrome me ⋮ → Install app / Add to Home screen dabao. Install ke baad home-screen icon se kholo — tab URL bar nahi dikhega.', 'info');
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
    const u = FF.auth.viewAsUser || FF.auth.user; // 👁 preview me target user dikhao
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
        openNotifications();
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

  /** Theme picker + office bell — modules lazy ho sakte hain, isliye mount idempotent rakhna hai. */
  const touchShell = () => !!(FF.lazy && FF.lazy.deviceProfile && FF.lazy.deviceProfile().coarse);
  const savedThemePack = () => { try { return localStorage.getItem('ff_theme_pack') || 'default'; } catch { return 'default'; } };
  function mountShellExtras() {
    try {
      if (FF.officeBell && FF.officeBell.mount) FF.officeBell.mount();
      // 🧹 v3.62 — wowzone (~66 KB: theme packs + tab heartbeat + Wow Zone graphics) ab background me
      // apne aap download nahi hota. Phone par sirf 🎨 tap karne par (ya pehle se koi theme pack chuna
      // ho to usko apply karne ke liye) aata hai — login ke baad 1 MB+ JS parse nahi hota, isliye
      // scroll/paint smooth rehta hai. Desktop par pehle jaisa hi (idle me) load hota hai.
      if (!FF.wowzone && !mountShellExtras.wowAsked) {
        if (savedThemePack() === 'default' && touchShell()) return;
        mountShellExtras.wowAsked = true;
        ensureShell(['wowzone']).then(() => { if (FF.wowzone) mountShellExtras(); }).catch(() => {});
        return;
      }
      if (FF.wowzone) {
        if (!(FF.config.feat && FF.config.feat('themePacks') === false)) FF.wowzone.mountThemePicker();
        if (!(FF.config.feat && FF.config.feat('tabHeartbeat') === false) && !touchShell()) {
          clearInterval(appHeartbeat.timer);
          if (appHeartbeat.instance) appHeartbeat.instance.stop();
          appHeartbeat.instance = FF.wowzone.startHeartbeat({ interval: 45000 });
        }
      }
    } catch (err) { console.warn('shell extras', err && err.message); }
  }
  /** 🎨 Shell ka static theme button → wowzone sirf click par load karo, phir wahi popup kholo. */
  function bindThemePackButton() {
    const btn = U.$('#theme-pack-btn');
    if (!btn || btn.__ffWired) return;
    btn.__ffWired = true;
    btn.addEventListener('click', (e) => {
      if (FF.wowzone && FF.wowzone.mountThemePicker) return;      // module ready → uska handler popup khol dega
      e.preventDefault(); e.stopPropagation();
      ensureShell(['wowzone']).then(() => {
        mountShellExtras();
        const b = U.$('#theme-pack-btn');
        if (b && FF.wowzone && FF.wowzone.mountThemePicker) b.click();
      }).catch(() => {});
    });
  }

  // ---- 🐚 v3.60 shell extras — bell / KPI drawer / search / assistant first paint ke BAAD aate hain ----
  // Pehle ye 11 modules index.html me eager the: login se PEHLE ~550 KB extra JS download + parse hota
  // tha, isliye phone par Home 1-3 second late khulta tha aur scroll atka hua lagta tha. Ab pehle Home
  // paint hota hai, phir idle me chhoti waves me ye modules aate hain aur apne hooks chala lete hain.
  // Koi feature band nahi hota — jo cheez user turant click kare (🔔 bell, KPI card, Ctrl/⌘+K, 🔍
  // search) wo on-demand load ho jaati hai (ensureShell).
  let shellExtrasStarted = false;
  const ensureShell = (names) => (FF.lazy && FF.lazy.shellNeed ? FF.lazy.shellNeed(names) : Promise.resolve());
  // 🔎 Global search stays visible on every page; index/data continue loading in the background.
  // v3.61: module first paint ke baad aata hai, isliye mount bhi usi wave hook se hota hai —
  // topbar search bar waise hi har page par dikhta hai (bas ~1s baad, bina pehla paint roke).
  function mountSearchTopbar() {
    if (FF.config.feat && FF.config.feat('masterSearch') === false) return;
    if (FF.masterSearch && FF.masterSearch.mountTopbar) FF.masterSearch.mountTopbar();
  }
  function startShellExtras() {
    bindThemePackButton();
    if (shellExtrasStarted) return Promise.resolve(false);
    shellExtrasStarted = true;
    const hooks = (wave) => {
      try {
        if (wave.includes('notifications')) { registerServiceWorker(); if (FF.notifications) FF.notifications.start(); }
        if (wave.includes('masterSearch')) mountSearchTopbar();
        if (wave.includes('officeBell')) mountShellExtras();
        if (wave.includes('liveAssist') && FF.liveAssist) FF.liveAssist.start();
      } catch (err) { console.warn('shell extras hook', err && err.message); }
    };
    const touch = !!(FF.lazy && FF.lazy.deviceProfile && FF.lazy.deviceProfile().coarse);
    // Pehla paint + Home ka data fetch ho jaane do, uske baad hi extras (phone par thoda aur gap).
    setTimeout(() => {
      if (FF.lazy && FF.lazy.shell) FF.lazy.shell({ afterWave: hooks }).catch(() => {});
      else hooks(['notifications', 'liveView', 'masterSearch', 'officeBell', 'liveAssist']);   // loader na ho to jo loaded hai wahi
    }, touch ? 1800 : 700);
    return Promise.resolve(true);
  }
  /** 🔔 Bell / alert center — module abhi load nahi hua to load karke kholo (click kabhi dead nahi hota). */
  function openNotifications(force) {
    if (FF.notifications) { if (FF.notifications.openCenter && force === 'center') FF.notifications.openCenter(); else FF.notifications.toggle(true); return Promise.resolve(); }
    return ensureShell(['notifications', 'liveView']).then(() => {
      if (FF.notifications) { if (FF.notifications.openCenter && force === 'center') FF.notifications.openCenter(); else FF.notifications.toggle(true); }
    });
  }

  function markActive() {
    U.$$('#nav .nav-item').forEach((a) => {
      const on = a.dataset.page === current.page && (current.page !== 'sheet' || a.dataset.name === current.params.name);
      a.classList.toggle('active', on);
    });
    // Lazy loading: page module abhi load nahi hua ho to bhi title sidebar registry se aa jaye.
    const def = pageDef(current.page);
    let title = current.page === 'sheet' ? (current.params.name || 'Sheet') : (FF.pages[current.page] && FF.pages[current.page].title) || (def && def.label) || '';
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
      <div class="page-loader-head">${U.loader ? U.loader('', { size: 'md' }) : '<span class="page-loader-spin" aria-hidden="true"></span>'}<b>${esc(String(label || 'Page'))}</b><small>data load ho raha hai${U.ellipsis ? U.ellipsis() : '<span class="dots">…</span>'}</small></div>
      <div class="page-loader-grid">${'<div class="skel skel-card"></div>'.repeat(6)}</div>
      <div class="skel skel-line w80"></div><div class="skel skel-line w60"></div>
      <div class="skel skel-block"></div>
    </div>`;
  }

  // 👁 v3.35 — view-as preview strip: har page par dikhe, Exit se wapas real admin par.
  let viewAsLast = null;
  function viewAsBanner() {
    if (EMBED_LIVE) return;
    const v = FF.auth.viewingAs ? FF.auth.viewingAs() : null;
    const key = v ? v.username : null;
    const changed = key !== viewAsLast;
    viewAsLast = key;
    const old = U.$('#viewas-banner');
    if (!v) { if (old) old.remove(); }
    else if (!old) {
      const el = U.h(`<div class="viewas-banner" id="viewas-banner" role="alert"><span>👁 <b>Preview mode</b> — <b>${esc(v.name)}</b> (@${esc(v.username)}) ke rights se dekh rahe ho · ye sirf view hai, data aapke admin session se aayega</span><button class="btn small primary" id="viewas-exit">↩️ Exit preview</button></div>`);
      document.body.appendChild(el);
      U.$('#viewas-exit', el).addEventListener('click', () => {
        if (FF.auth.stopViewAs) FF.auth.stopViewAs();
        if (FF.agentSummary && FF.agentSummary.clearCaches) FF.agentSummary.clearCaches();
        el.remove();
        U.toast('Preview mode off ✓', 'ok');
        if (location.hash !== '#/home') location.hash = '#/home';
        else renderCurrent();
      });
    }
    // Preview on/off par sidebar + top-user card target ke hisaab se refresh.
    if (changed) { renderSidebar(); renderTopUser(); }
  }

  // 🖐️ v3.62 — "scroll nahi hoti" ka sabse aam karan: koi overlay apna `no-scroll` lock chhod jaata
  // tha (drawer/panel/notes modal band karne par bhi) aur poora page scroll-proof ho jaata tha. Ab
  // har route render se pehle check hota hai — koi overlay khula nahi hai to lock hat jaata hai.
  function unlockPageScroll() {
    try {
      if (U.$('.drawer.open') || U.$('.ms-panel') || U.$('.live-modal') || U.$('.palette-backdrop:not([hidden])') || U.$('#auth-screen:not([hidden])')) return false;
      document.body.classList.remove('no-scroll');
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('overflow-y');
      document.documentElement.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('overflow-y');
      return true;
    } catch { return false; }
  }
  let retiredNoticeKey = '';
  /** Retired-page notice ek hi baar (per page id) dikhao — toast spam na ho. */
  function retiredNotice(page) {
    if (retiredNoticeKey === page) return false;
    retiredNoticeKey = page;
    return true;
  }

  async function renderCurrent(ctx) {
    if (!FF.auth.user) return;
    viewAsBanner();
    const { page, params } = parseHash();
    // Legacy route: Stock Report ka koi standalone module nahi hai; same stock/report
    // capability Performance + Stock pages me already available hai. Purane bookmarks
    // ko broken lazy route par bhejne ke bajay existing Performance page par redirect karo.
    if (page === 'stockReport') { location.hash = '#/performance'; return; }
    // 🧹 v3.62 — hata di gayi page (bookmark / purana link / notification link) → seedha safe page.
    const retired = retiredTarget(page);
    if (retired) {
      const dest = retired === 'home' || (FF.auth.can && FF.auth.can(retired)) ? retired : 'home';
      if (retiredNotice(page)) U.toast('🧹 Ye page ab dashboard me nahi hai — simple version me hata di gayi hai.', 'info');
      current = { page: dest, params: {}, token: current.token + 1 };
      if (location.hash !== `#/${dest}`) { try { history.replaceState(null, '', `#/${dest}`); } catch { location.hash = `#/${dest}`; } }
      return renderCurrent(ctx);
    }
    current = { page, params, token: current.token + 1 };
    const token = current.token;
    renderGlobalFilters();
    renderMobileNav();
    const pageGroup = currentNavGroup(page, params);
    if (openNavGroup !== pageGroup) selectNavGroup(pageGroup);
    markActive();
    closeSidebar();
    unlockPageScroll();      // 🖐️ leaked scroll-lock kabhi page freeze na kare
    const main = U.$('#main');
    const root = document.createElement('div');
    root.className = `page page-${page}`;
    main.setAttribute('aria-busy', 'true');
    routeProgress(true, token);
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
      routeProgress(false, token);
      return;
    }
    if (FF.notifications) FF.notifications.activity(page === 'sheet' ? `Sheet · ${params.name || ''}` : page);
    try {
      // ⚡ Page ka module sirf tab download hota hai jab us page ko khola jaye (pehla load halka rehta hai).
      if (FF.lazy && FF.lazy.ensure) await FF.lazy.ensure(page);
      // Network/cache failure recovery: retry the requested module once before showing an error.
      if (!FF.pages[page] && FF.lazy && FF.lazy.ensure) {
        await FF.lazy.ensure(page);
      }
      if (!FF.pages[page] && FF.lazy && FF.lazy.ensureAll) await FF.lazy.ensureAll();
      if (!FF.pages[page]) throw new Error(`Page module load nahi hua (${page}). Internet check karke ↻ dabaiye.`);
      // Fallback: agar kisi module ne galti se bare function register kiya ho (bina .render ke) to bhi chala lo.
      const mod = FF.pages[page];
      if (typeof mod.render === 'function') await mod.render(root, params, ctx || {});
      else if (typeof mod === 'function') await mod(root, params, ctx || {});
      else throw new Error(`Page render nahi ho paya (${page}).`);
    } catch (err) {
      console.error(err);
      if (token === current.token) root.innerHTML = U.errorBox(err, 'data-action="refresh"');
    }
    clearTimeout(loaderTimer);
    routeProgress(false, token);
    if (token === current.token) {
      main.setAttribute('aria-busy', 'false'); updateStatus(); translateDom(root); applySavedTweaks(root);
      // ⚡ Paint-first: non-essential chart/table decoration is idle-deferred.
      // Data fetching/query/cache/export paths are untouched, so downloads stay identical.
      const polish = () => {
        if (token !== current.token || !root.isConnected) return;
        enhanceCharts(root); enhanceTables(root);
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(polish, { timeout: 250 });
      else setTimeout(polish, 0);
    }
  }

  /** 🩺 v3.37 — Settings → Diagnostics ke SAVED fixes boot/par har page render par eagerly laga do.
      settings.js lazy load hota hai, isliye ye chhota sa hook app.js me hai: speed prefs (ff-no-anim /
      ff-lite) + attribute repairs (jaise `data-kpi-self="1"` — card ka click page khud handle kare,
      global kpiDetail hijack na kare). Rule localStorage me hai → reload ke baad bhi fix laga rehta hai. */
  const DIAG_ATTR_FIX = { kpiSelf: ['data-kpi-self', '1'] };
  function applySavedTweaks(root) {
    try {
      const prefs = JSON.parse(localStorage.getItem('ff_speed_prefs') || '{}') || {};
      const html = document.documentElement;
      if (html && html.classList) {
        html.classList.toggle('ff-no-anim', !!prefs.reduceMotion);
        html.classList.toggle('ff-lite', !!prefs.lite);
      }
      const rules = JSON.parse(localStorage.getItem('ff_diag_attr_repairs') || '[]');
      if (!Array.isArray(rules) || !rules.length) return 0;
      const scope = root || document;
      if (!scope.querySelectorAll) return 0;
      let n = 0;
      for (const r of rules) {
        const fix = DIAG_ATTR_FIX[r && r.fixType];
        if (!fix || !r.selector) continue;
        let els = [];
        try { els = [...scope.querySelectorAll(r.selector)]; } catch { els = []; }
        for (const el of els) if (el && el.getAttribute && el.getAttribute(fix[0]) !== fix[1]) { el.setAttribute(fix[0], fix[1]); n++; }
      }
      return n;
    } catch { return 0; }
  }
  /** 🚦 v3.31 — kisi bhi option/page par click → upar patli chalti progress line (Reduce motion me bhi chalti hai).
      Sirf tab dikhti hai jab render 150ms se lamba ho (fast pages par flash nahi). */
  let routeTimer = 0, routeToken = 0;
  function routeProgress(on, token) {
    let el = document.getElementById('route-progress');
    if (!el && on) { el = U.h('<div id="route-progress" class="route-progress" role="progressbar" aria-label="Loading" hidden><i></i></div>'); document.body.appendChild(el); }
    clearTimeout(routeTimer);
    if (on) { routeToken = token || 0; routeTimer = setTimeout(() => { if (el && routeToken === current.token) el.hidden = false; }, 150); return; }
    if (token && token !== routeToken) return;
    if (el) el.hidden = true;
  }
  function openDataFreshness() {
    const old = U.$('#data-freshness-center');
    if (old) { old.remove(); return; }
    const ds = FF.data && FF.data.status ? FF.data.status() : {};
    const st = FF.store && FF.store.state ? FF.store.state : {};
    const gv = FF.gv && FF.gv.state ? FF.gv.state : {};
    const basis = U.channelBasis ? U.channelBasis('ff') : null;
    const gvBasis = U.channelBasis ? U.channelBasis('gv') : null;
    const fmtAt = (t) => t ? U.timeLabel(t) : 'Not loaded';
    const row = (name, at, note, cls) => `<div class="fresh-row"><span class="fresh-dot ${cls || ''}"></span><div><b>${U.esc(name)}</b><small>${U.esc(note)}</small></div><strong>${U.esc(fmtAt(at))}</strong></div>`;
    const host = U.h(`<div class="data-fresh-backdrop" id="data-freshness-center" role="dialog" aria-modal="true" aria-label="Data Freshness Center">
      <section class="data-fresh-card">
        <header><div><b>🕒 Data Freshness Center</b><small>Sirf existing loaded state — koi extra Google/API request nahi</small></div><button class="icon-btn small" data-fresh-close aria-label="Close">✕</button></header>
        <div class="data-fresh-body">
          <div class="fresh-grid">
            ${row('First Forward · EIR', st.loadedAt, basis ? `Report basis: ${basis.shortLabel} · T+1` : 'Report basis available after data load', st.loadedAt ? 'ok' : '')}
            ${row('GV Partner · live', gv.loadedAt, gvBasis ? `Latest data: ${gvBasis.shortLabel}` : 'Live basis available after data load', gv.loadedAt ? 'ok' : '')}
            ${row('Last query', ds.lastLoadAt, ds.lastSource ? `Source: ${ds.lastSource} · cache entries: ${ds.cacheEntries || 0}` : `Cache entries: ${ds.cacheEntries || 0}`, ds.lastLoadAt ? 'ok' : '')}
          </div>
          <div class="fresh-note"><b>⚡ Speed-safe design</b><span>Page data repeat-open par memory cache se aata hai. CSV/Excel download path ko touch nahi kiya gaya. Large sheets browser me full-download nahi hoti; existing query/paging architecture same hai.</span></div>
          <div class="fresh-actions"><button class="btn small" data-fresh-refresh>↻ Fresh data load</button><button class="btn small" data-fresh-close>Close</button></div>
        </div>
      </section>
    </div>`);
    document.body.appendChild(host);
    host.querySelectorAll('[data-fresh-close]').forEach((b) => b.addEventListener('click', () => host.remove()));
    host.addEventListener('click', (e) => { if (e.target === host) host.remove(); });
    const rb = host.querySelector('[data-fresh-refresh]');
    if (rb) rb.addEventListener('click', () => { host.remove(); refresh(); });
  }

  function updateStatus(progress) {
    const el = U.$('#status');
    if (!el) return;
    const st = FF.store.state, gv = FF.gv ? FF.gv.state : null;
    const pre = FF.preloader ? FF.preloader.state : null;
    const loading = st.loading || (gv && gv.loading) || (pre && pre.running);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const offlineEl = U.$('#offline-state');
    if (offlineEl) { offlineEl.hidden = !offline; offlineEl.textContent = offline ? '📴 Offline · last snapshot' : ''; offlineEl.className = `offline-state${offline ? ' is-offline' : ''}`; }
    if (loading) {
      const p = pre && pre.running ? pre.progress : (st.loading ? st.progress : gv.progress);
      const extra = pre && pre.running ? ` (preloading ${p.loaded}/${p.total})` : st.loading && gv && gv.loading ? ' (FF + GV)' : st.loading ? ' (FF)' : ' (GV)';
      el.innerHTML = `<span class="dot busy"></span> Loading ${p.done !== undefined ? `${p.done}/${p.total}` : `${p.loaded}/${p.total}`}${extra}…`;
      return;
    }
    const t = FF.store.loadedAt || (gv && gv.loadedAt);
    const errs = Object.keys(st.errors || {}).length + (gv ? Object.keys(gv.errors).length : 0);
    el.innerHTML = offline
      ? '<span class="dot warn"></span> 📴 Offline — last loaded data dikh raha hai'
      : (t ? `<span class="dot ${errs ? 'warn' : 'live'}\"></span> Data ${U.timeLabel(t)}${errs ? ` · ${errs} failed${(st.retrying || (gv && gv.retrying)) ? ' — 🔁 auto-retry chal raha hai…' : ''}` : ''}${pre && pre.done ? ' · all sheets ready ✓' : ''}` : '<span class="dot"></span> Ready');
    const btn = U.$('#top-refresh'); if (btn) btn.classList.remove('spin');
    const statusEl = U.$('#status'); if (statusEl) { statusEl.title = 'Click: Data Freshness Center'; statusEl.style.cursor = 'pointer'; }
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
    if (FF.masterProfile && FF.masterProfile.invalidate) FF.masterProfile.invalidate();
    if (FF.masterSearch && FF.masterSearch.invalidate) FF.masterSearch.invalidate();
    if (FF.agentSummary && FF.agentSummary.clearCaches) FF.agentSummary.clearCaches();
    refreshing = false;
    await renderCurrent();
    await checkFeedChange(true).catch(() => {}); // naya data ho to notification + voice announcement
    const errors = FF.preloader ? FF.preloader.state.errors : [];
    U.toast(errors.length ? 'Some sheets could not update. Retry refresh.' : 'Data updated ✓', errors.length ? 'warn' : 'ok');
  }

  // ---- drawer ----
  let drawerStack = [];
  let activeDrawerSnap = null;
  function currentDrawerSnapshot() {
    return activeDrawerSnap ? { ...activeDrawerSnap } : null;
  }
  function restoreDrawerSnapshot(snap) {
    if (!snap) return;
    openDrawer({ ...snap, fromBack: true });
  }
  function openDrawer({ kicker, title, sub, body, actions, wide, age, loading, replace, fromBack }) {
    const isOpen = !!(U.$('#drawer') && U.$('#drawer').classList.contains('open'));
    const htmlStr = String(body || '');
    const isLoader = !!loading || (/class="loading"/.test(htmlStr) && htmlStr.length < 900);
    if (isOpen && activeDrawerSnap && !activeDrawerSnap.loading && !replace && !fromBack && !isLoader) {
      drawerStack.push({ ...activeDrawerSnap });
    }
    let finalActions = actions || '';
    if (!isLoader && !/<form[\s>]/i.test(htmlStr)) {
      if (drawerStack.length && !/data-kd-back|data-drawer-back|data-mp-back/.test(finalActions)) {
        finalActions = `<button class="btn small" data-drawer-back>← Back</button>${finalActions}`;
      }
      if (FF.auth && FF.auth.can && FF.auth.can('export')) {
        if (!/data-drawer-csv/.test(finalActions)) finalActions += '<button class="btn small" data-drawer-csv title="Download Drawer CSV">⬇ CSV</button>';
        if (!/data-drawer-pdf/.test(finalActions)) finalActions += '<button class="btn small" data-drawer-pdf title="Download Drawer PDF">📄 PDF</button>';
      }
    }
    if (!isLoader) {
      activeDrawerSnap = { kicker, title, sub, body, actions, wide, age, loading: false };
    }
    U.$('#drawer').classList.toggle('wide', !!wide);
    U.$('#drawer-kicker').textContent = kicker || '';
    U.$('#drawer-title').textContent = title || '';
    U.$('#drawer-sub').innerHTML = sub || '';
    U.$('#drawer-actions').innerHTML = finalActions;
    const ageHtml = drawerAgeHtml({ kicker, title, body, age });
    U.$('#drawer-body').innerHTML = (body || '') + ageHtml;
    U.$('#drawer').classList.add('open');
    U.$('#drawer-backdrop').hidden = false;
    document.body.classList.add('no-scroll');
    U.$('#drawer-body').scrollTop = 0;
    if (FF.charts && FF.charts.mount) FF.charts.mount(U.$('#drawer-body'));
    enhanceCharts(U.$('#drawer-body'));
    enhanceTables(U.$('#drawer-body'));
    translateDom(U.$('#drawer-body'));
    if (ageHtml && FF.stockAge && FF.stockAge.decorate) FF.stockAge.decorate(U.$('#drawer-body')).catch(() => {});
  }
  function extractDrawerData() {
    const bodyEl = U.$('#drawer-body');
    const title = (U.$('#drawer-title') && U.$('#drawer-title').textContent || 'Drawer Report').trim();
    const kicker = (U.$('#drawer-kicker') && U.$('#drawer-kicker').textContent || '').trim();
    const sub = (U.$('#drawer-sub') && U.$('#drawer-sub').textContent || '').replace(/\s+/g, ' ').trim();
    const kpis = [];
    if (bodyEl) {
      bodyEl.querySelectorAll('.dkpi, .kd-stat, .mp-kpi, .mini-kpi').forEach((el) => {
        const lbl = (el.querySelector('small, span, .mini-label') || {}).textContent || '';
        const val = (el.querySelector('b, strong, .mini-value') || {}).textContent || '';
        const spans = [...el.querySelectorAll('span, small')].map((s) => (s.textContent || '').trim()).filter((t) => t && t !== lbl.trim() && t !== val.trim());
        if (lbl.trim() || val.trim()) kpis.push({ label: lbl.trim(), value: val.trim(), sub: spans.join(' · ') });
      });
    }
    const tables = [];
    if (bodyEl) {
      bodyEl.querySelectorAll('table').forEach((tbl, idx) => {
        const sec = tbl.closest('section, .dsec, .mp-sec, details');
        const headingEl = sec ? sec.querySelector('h4, h3, summary') : null;
        const tTitle = (headingEl ? headingEl.textContent : `Table ${idx + 1}`).replace(/\s+/g, ' ').trim();
        const rawRows = U.tableToRows(tbl).filter((r) => r.some((c) => String(c || '').trim() !== ''));
        if (!rawRows.length) return;
        const head = rawRows[0];
        const rows = rawRows.slice(1);
        const hasTotal = rows.some((r) => /^(total|grand total|tl total)\b/i.test(String(r[0] || '').trim()));
        if (!hasTotal && rows.length > 1 && head.length > 1) {
          const totRow = head.map((_, ci) => {
            if (ci === 0) return 'Grand Total';
            let sum = 0, numCount = 0;
            rows.forEach((r) => {
              const raw = String(r[ci] || '').replace(/,/g, '').trim();
              if (/^-?\d+(\.\d+)?$/.test(raw)) { sum += Number(raw); numCount++; }
            });
            return numCount === rows.length && numCount > 0 ? U.fmt(sum) : '';
          });
          if (totRow.slice(1).some(Boolean)) rows.push(totRow);
        }
        tables.push({ title: tTitle, head, rows });
      });
    }
    return { title, kicker, sub, kpis, tables };
  }
  function exportDrawerCsv() {
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const d = extractDrawerData();
    const out = [[d.title, d.kicker, d.sub]];
    if (d.kpis.length) {
      out.push([], ['KPI Metric', 'Value', 'Details']);
      d.kpis.forEach((k) => out.push([k.label, k.value, k.sub]));
    }
    d.tables.forEach((t) => {
      out.push([], [t.title], t.head, ...t.rows);
    });
    U.downloadCsv(`${U.slug(d.title || 'drawer')}-${U.stamp()}.csv`, ['Section / Field', 'Value / Col 2', 'Col 3', 'Col 4', 'Col 5', 'Col 6', 'Col 7', 'Col 8'], out);
    U.toast('Drawer CSV downloaded ✓', 'ok');
  }
  async function exportDrawerPdf(btn) {
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const drawerPdfName = `${U.slug(d.title || 'drawer')}-${U.stamp()}.pdf`;
    if (U.downloadStart) U.downloadStart(drawerPdfName, 'Preparing PDF…');
    try {
      if (!FF.pdf && FF.lazy && FF.lazy.need) await FF.lazy.need('pdf');
      if (!FF.pdf || !FF.pdf.doc) { U.toast('PDF module load nahi hua', 'err'); return; }
      if (btn) U.setButtonBusy(btn, true, 'PDF…');
      const d = extractDrawerData();
      // v3.34 — structured API (kpis + table) se multi-page PDF; finish() ab Blob deta hai.
      const doc = FF.pdf.doc({
        title: d.title || 'Drawer Report',
        subtitle: [d.kicker, d.sub].filter(Boolean).join(' · '),
        right: `Generated ${new Date().toLocaleString('en-IN')}`
      });
      if (d.kpis.length) doc.kpis(d.kpis.slice(0, 12).map((k) => ({ label: k.label, value: k.value, sub: k.sub })), 4);
      let used = d.kpis.length > 0;
      (d.tables || []).forEach((t) => {
        if (!t || !t.head || !t.rows || !t.rows.length) return;
        doc.section(t.title || 'Table', `${t.rows.length} rows`);
        doc.table({ headers: t.head, align: t.head.map((h, i) => (i === 0 ? 'left' : 'right')), rows: t.rows.slice(0, 400) });
        used = true;
      });
      if (!used) doc.text('Summary details exported.');
      FF.pdf.download(doc.finish(), drawerPdfName);
      U.toast('Drawer PDF downloaded ✓', 'ok');
    } catch (err) {
      U.toast((err && err.message) || 'PDF export failed', 'err');
    } finally {
      if (btn) U.setButtonBusy(btn, false);
    }
  }
  /** 🧓 v3.31 — HAR drawer me stock ageing. Drawer khud `age: { kind: 'agent'|'tl'|'agents'|'all', key, ch, keys, tls, title }`
      bata sakta hai (`age: false` = nahi chahiye); na bataye to kicker/title se andaza: agent / TL / poora network.
      Forms (note, saved view) aur sirf-loader wale pehle frame me nahi lagta; pehle se ageing ho to dobara nahi. */
  function drawerAgeScope({ kicker, title, body, age }) {
    if (age === false || !FF.stockAge || !FF.stockAge.sectionHtml) return null;
    if (FF.auth && FF.auth.can && FF.auth.can('stock') === false && FF.auth.can('gvStock') === false) return null;
    const html = String(body || '');
    if (/data-age-host|data-drawer-age/.test(html)) return null;
    if (age && typeof age === 'object') return age;
    if (/<form[\s>]/i.test(html)) return null;
    if (/class="loading"/.test(html) && html.length < 900) return null;
    const k = String(kicker || ''), t = String(title || '').trim();
    const both = `${k} ${t}`;
    const ch = /\bGV\b|GV Partner/i.test(both) ? 'gv' : /\bFF\b|First Forward/i.test(both) ? 'ff' : '';
    const clean = (x) => x.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s*·\s*(FF|GV)\s*agent$/i, '').replace(/\s*·\s*stock$/i, '').trim();
    if (/team leader|\bTL\b/i.test(k) && t) return { kind: 'tl', key: clean(t), ch, title: clean(t) };
    if (/\bagent\b/i.test(k) && !/\bagents\b/i.test(k) && t) return { kind: 'agent', key: clean(t), ch, title: clean(t) };
    return { kind: 'all', key: 'all', ch };
  }
  function drawerAgeHtml(o) {
    try {
      const scope = drawerAgeScope(o);
      if (!scope) return '';
      const open = scope.open !== undefined ? !!scope.open : scope.kind !== 'all';
      return FF.stockAge.sectionHtml(scope, { open, title: scope.title || scope.key });
    } catch (err) { console.warn('drawer ageing', err && err.message); return ''; }
  }
  function closeDrawer() {
    U.$('#drawer').classList.remove('open');
    U.$('#drawer-backdrop').hidden = true;
    document.body.classList.remove('no-scroll');
    drawerStack = [];
    activeDrawerSnap = null;
    if (FF.kpiDetail && FF.kpiDetail.resetHistory) FF.kpiDetail.resetHistory();
  }
  function openSidebar() {
    document.body.classList.add('side-open');
    U.$$('#menu-btn, #mobile-nav [data-mobile-action="more"]').forEach((button) => button.setAttribute('aria-expanded', 'true'));
  }
  function closeSidebar() {
    document.body.classList.remove('side-open');
    U.$$('#menu-btn, #mobile-nav [data-mobile-action="more"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  }
  function toggleSidebar() {
    if (document.body.classList.contains('side-open')) closeSidebar();
    else openSidebar();
  }

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

  // ---- table experience: density, columns, sticky context and export ------------------------------
  function tableDensity() { try { return localStorage.getItem('ff_table_density') || 'comfortable'; } catch { return 'comfortable'; } }
  function setTableDensity(value) { try { localStorage.setItem('ff_table_density', value); } catch {} document.documentElement.dataset.tableDensity = value; }
  /** 🏷️ Barcode / serial columns → dash wala format (608116-011-0558601) har table me. */
  const BARCODE_HEAD_RE = /barcode|serial|serial\s*number|bc\b/i;
  function barcodeColumnIndexes(table) {
    const heads = [...table.querySelectorAll('thead th')];
    const out = [];
    heads.forEach((th, i) => { if (BARCODE_HEAD_RE.test(th.textContent || '')) out.push(i); });
    return out;
  }
  /** Table ke barcode cells ko display format me badlo (value + data-full attribute me original). */
  function polishBarcodes(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('table').forEach((table) => {
      const cols = barcodeColumnIndexes(table);
      if (!cols.length) return;
      table.querySelectorAll('tbody tr').forEach((tr) => {
        cols.forEach((i) => {
          const td = tr.children[i];
          if (!td || td.dataset.bcDone === '1') return;
          const full = (td.textContent || '').trim();
          const pretty = U.barcode(full);
          if (pretty && pretty !== full) {
            td.dataset.bcDone = '1';
            td.dataset.bcFull = full;
            td.textContent = pretty;
            td.title = `${full} · barcode`;
          }
        });
      });
    });
  }

  function enhanceTables(root) {
    if (!root || !root.querySelectorAll) return;
    polishBarcodes(root);
    setTableDensity(tableDensity());
    root.querySelectorAll('.table-wrap').forEach((wrap) => {
      const table = wrap.querySelector('table');
      if (!table || wrap.querySelector('.table-tools')) return;
      const toolbar = document.createElement('div');
      toolbar.className = 'table-tools';
      toolbar.innerHTML = `<span class="table-tools-title">Table</span><span class="table-tools-note">${table.tBodies && table.tBodies[0] ? `${table.tBodies[0].rows.length} rows` : 'view'}</span><button type="button" class="btn small" data-table-density title="Toggle compact row density">${tableDensity() === 'compact' ? '↕ Comfortable' : '↕ Compact'}</button><button type="button" class="btn small" data-table-columns title="Choose visible columns">☷ Columns</button><button type="button" class="btn small" data-table-export title="Export this table">⬇ CSV</button>`;
      const menu = document.createElement('div');
      menu.className = 'table-columns-menu'; menu.hidden = true;
      [...table.querySelectorAll('thead th')].forEach((th, i) => {
        const label = (th.textContent || `Column ${i + 1}`).replace(/\s+/g, ' ').trim().slice(0, 60) || `Column ${i + 1}`;
        const row = document.createElement('label');
        row.innerHTML = `<input type="checkbox" data-table-col="${i}" checked> <span>${esc(label)}</span>`;
        menu.appendChild(row);
      });
      wrap.insertBefore(toolbar, table);
      wrap.appendChild(menu);
      toolbar.querySelector('[data-table-density]').addEventListener('click', () => {
        const next = tableDensity() === 'compact' ? 'comfortable' : 'compact';
        setTableDensity(next); root.querySelectorAll('table').forEach((t) => t.classList.toggle('table-density-compact', next === 'compact'));
        document.querySelectorAll('[data-table-density]').forEach((b) => { b.textContent = next === 'compact' ? '↕ Comfortable' : '↕ Compact'; });
      });
      toolbar.querySelector('[data-table-columns]').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
      toolbar.querySelector('[data-table-export]').addEventListener('click', () => {
        if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
        const rows = U.tableToRows(table); U.downloadCsv(`${U.slug(current.page || 'table')}-${U.stamp()}.csv`, rows[0] || [], rows.slice(1)); U.toast('Table CSV downloaded ✓', 'ok');
      });
      menu.querySelectorAll('[data-table-col]').forEach((input) => input.addEventListener('change', () => {
        const index = Number(input.dataset.tableCol); const hidden = !input.checked;
        [...table.querySelectorAll('tr')].forEach((tr) => { const cell = tr.children[index]; if (cell) cell.hidden = hidden; });
      }));
      table.classList.toggle('table-density-compact', tableDensity() === 'compact');
    });
  }

  function bind() {
    // Sidebar stays fixed/visible on desktop — the old hover auto-hide mode is removed.
    document.body.classList.remove('sidebar-auto'); try { localStorage.removeItem('ff_sidebar_auto'); } catch { /* private mode */ }
    window.addEventListener('hashchange', () => { paramOverride = null; renderCurrent(); toggleUserMenu(false); });
    U.$('#menu-btn').addEventListener('click', toggleSidebar);
    const themeBtn = U.$('#theme-toggle'); if (themeBtn) themeBtn.addEventListener('click', toggleThemeMode);
    const langBtn = U.$('#lang-toggle');
    if (langBtn) {
      langBtn.addEventListener('click', toggleLangMenu);
      const l = lang();
      langBtn.title = l === 'hi' ? 'भाषा' : l === 'en' ? 'Language' : 'भाषा · Language';
      langBtn.setAttribute('aria-label', langBtn.title);
    }
    if (FF.i18n) FF.i18n.translateTitle();
    applyThemeMode();
    applyA11y();
    try { updateFocusMode(localStorage.getItem('ff_focus_mode') === '1'); } catch { updateFocusMode(false); }
    const focusBtn = U.$('#focus-toggle');
    if (focusBtn) focusBtn.addEventListener('click', () => { const on = updateFocusMode(); U.toast(on ? '🎯 Focus mode ON — distraction-free view' : 'Focus mode OFF', 'ok'); });
    const a11yBtn = U.$('#a11y-btn');
    if (a11yBtn) a11yBtn.addEventListener('click', (e) => { e.stopPropagation(); renderA11yPanel(); });
    window.addEventListener('online', () => { updateStatus(); renderGlobalFilters(); U.toast('🌐 Internet wapas aa gaya — ↻ se fresh data lao', 'ok'); });
    window.addEventListener('offline', () => { updateStatus(); U.toast('📴 Offline ho — last loaded data dikhega', 'warn'); });
    U.$('#side-backdrop').addEventListener('click', closeSidebar);
    U.$('#top-refresh').addEventListener('click', refresh);
    const statusEl = U.$('#status'); if (statusEl) statusEl.addEventListener('click', openDataFreshness);
    window.addEventListener('ff:data-loaded', () => updateStatus());
    // ⚡ Panel links instant: hover/tap karte hi us page ka lazy module prefetch ho jaata hai
    //    (pehla click bina ruke khulta hai), aur ACTIVE link dobara click karne par page refresh
    //    hota hai — pehle hash same hone par kuch nahi hota tha ("click par khulta hi nahi").
    const prefetchFrom = (el) => {
      const a = el && el.closest && el.closest('a[href^="#/"]');
      if (!a || !FF.lazy || !FF.lazy.ensure) return;
      const id = decodeURIComponent((a.getAttribute('href') || '').replace(/^#\/?/, '').split('?')[0].split('/')[0] || '');
      if (id && id !== 'sheet') FF.lazy.ensure(id).catch(() => {});
    };
    document.addEventListener('mouseover', (e) => prefetchFrom(e.target), { passive: true });
    document.addEventListener('pointerdown', (e) => prefetchFrom(e.target), { passive: true, capture: true });
    // 📱 Mobile: chhote screen par topbar ek line me fit ho — kam zaroori buttons "⋯" me chhup jaate hain.
    const topActions = U.$('#top-actions');
    const moreBtn = U.$('#top-more');
    if (moreBtn && topActions) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = topActions.classList.toggle('more-open');
        moreBtn.textContent = open ? '✕' : '⋯';
        moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', (e) => {
        if (!topActions.classList.contains('more-open')) return;
        if (topActions.contains(e.target)) return;
        topActions.classList.remove('more-open');
        moreBtn.textContent = '⋯';
        moreBtn.setAttribute('aria-expanded', 'false');
      });
    }
    // Mobile bottom-nav actions reuse existing topbar/sidebar controls — no duplicate pages.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mobile-action]');
      if (!btn) return;
      const action = btn.dataset.mobileAction;
      if (action === 'search') { U.$('#global-search-btn')?.click(); return; }
      if (action === 'notifications') { openNotifications('center'); return; }
      if (action === 'more') { U.$('#menu-btn')?.click(); return; }
    });
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
    // 🔔 Bell ka apna handler notifications.js me hai, jo ab first paint ke BAAD load hota hai.
    // Pehle 1-2 second me bell dabane par kuch nahi hota tha — isliye ye fallback: module lao, phir kholo.
    // (Module load hone ke baad ye handler no-op reh jaata hai, kyunki FF.notifications set ho jaata hai.)
    const bellBtn = U.$('#notification-btn');
    if (bellBtn && !bellBtn.__ffFallbackWired) {
      bellBtn.__ffFallbackWired = true;
      bellBtn.addEventListener('click', (e) => {
        if (FF.notifications) return;
        e.preventDefault(); e.stopPropagation();
        openNotifications();
      });
    }
    document.addEventListener('keydown', (e) => {
      // ⌨️ Ctrl/⌘+K — palette first paint ke baad load hota hai, isliye pehli dabane par load karke kholo.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'k' && !FF.palette) {
        e.preventDefault();
        ensureShell(['palette', 'masterSearch']).then(() => { if (FF.palette) FF.palette.toggle(); });
        return;
      }
      if (e.key === 'Escape') { closeDrawer(); closeSidebar(); toggleUserMenu(false); }
      // ⌨️ v3.31 — [data-kpi] role=button tiles (Home ke top agents) keyboard se bhi khulein
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[data-kpi][role="button"]')) { e.preventDefault(); e.target.click(); }
    });
    document.addEventListener('click', (e) => {
      // 🔗 Current page ka link dobara click → page re-render (hashchange nahi aata tha → dead click).
      const sameLink = e.target.closest && e.target.closest('a[href^="#"]');
      if (sameLink && (sameLink.getAttribute('href') || '') === location.hash) {
        e.preventDefault();
        toggleUserMenu(false);
        renderCurrent();
        return;
      }
      if (e.target.closest('[data-global-filter-clear]')) {
        e.preventDefault(); clearGlobalFilters(); return;
      }
      if (!e.target.closest('#user-menu') && !e.target.closest('#user-btn')) toggleUserMenu(false);
      if (e.target.closest('#user-menu a')) toggleUserMenu(false);
      const drawerBack = e.target.closest('[data-drawer-back]');
      if (drawerBack) {
        const prev = drawerStack.pop();
        if (prev) restoreDrawerSnapshot(prev);
        return;
      }
      const drawerCsv = e.target.closest('[data-drawer-csv]');
      if (drawerCsv) { exportDrawerCsv(); return; }
      const drawerPdf = e.target.closest('[data-drawer-pdf]');
      if (drawerPdf) { exportDrawerPdf(drawerPdf); return; }
      // `.kpi` ya `[data-kpi]` — dono clickable hain (Home ke glance tiles bhi data-kpi use karte hain).
      // 🚨 v3.37: `data-kpi-self` wale cards ka click PAGE khud handle karta hai (jaise Unusual Activity ke
      // anomaly cards). Unhe yahan se kpiDetail.open() mat karo — warna do drawer khulte the aur aakhri
      // (card se unrelated, MTD-inferred) drawer jeet jaata tha: "card ka data drawer me nahi dikhta".
      const kpi = e.target.closest('.kpi, [data-kpi]');
      if (kpi && !e.target.closest('a,button:not(.kpi)') && !kpi.closest('[data-kpi-self]')) {
        if (FF.kpiDetail) { FF.kpiDetail.open(kpi); return; }
        // Drill drawer ka module first paint ke baad load hota hai — click par load karke kholo.
        if (FF.lazy && FF.lazy.shellNeed) {
          const card = kpi;
          FF.lazy.shellNeed(['kpiDetail', 'stockAge']).then(() => {
            if (FF.kpiDetail) FF.kpiDetail.open(card);
            else showKpiSummary(card.dataset.kpiTitle || U.$('.kpi-title', card)?.textContent || 'KPI summary', card.dataset.kpiValue || U.$('.kpi-value', card)?.innerText || '—', card.dataset.kpiFoot || U.$('.kpi-foot', card)?.innerText || '');
          });
          return;
        }
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
        else if (a === 'focus-mode') updateFocusMode();
        else if (a === 'notifications') openNotifications();
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
    FF.store.on((ev, detail) => { if (ev === 'progress' || ev === 'start' || ev === 'done' || ev === 'retry' || ev === 'refresh') updateStatus(detail); });
    // ⚡ Install button pehle har 3 second me check hota tha (din bhar ka bekaar timer). Ab wo
    // beforeinstallprompt / appinstalled events + theme-language change par update hota hai, aur
    // safety ke liye 60s ka ek halka interval hai.
    setInterval(updateInstallBtn, 60000);
  }

  function onBackgroundDataUpdated() {
    // If user is on a data page, smoothly re-render so new stock and stats appear automatically
    if (['stock', 'stockReport', 'home', 'dataQuality', 'dualChannel', 'masterStock', 'fastagChampions', 'tagIssued', 'dashboard', 'trend', 'performance', 'gvStock', 'gvStockReport', 'gvDashboard', 'gvTrend', 'gvPerformance', 'compare', 'sheet'].includes(current.page)) {
      renderCurrent({ bgUpdated: true });
    }
  }

  // ---- 📊🔄 Instant data sync + "data update" notification/voice ---------------------------------
  // Google Sheet me naya data: office bell (30s poll) ya 5-min light sync detect karta hai →
  // page numbers turant refresh + bell notification + (voice ON ho to) bol kar announce.
  const FEED_SIG_KEY = 'ff_feed_sig';
  let lastSyncAt = 0, syncingNow = null, syncLockUntil = 0;
  function feedSig(feed) {
    if (!feed || feed.ok === false) return null;
    // /api/today deliberately returns 200 with ffError/gvError so the dashboard can still show
    // the healthy channel.  That partial response is NOT a zero-tag snapshot: treating the
    // missing side as zero made recovery from a temporary Google error look like a new issuance
    // and produced the exact false notification users were seeing.
    if (feed.ffError || feed.gvError || !feed.ff || !feed.gv) return null;
    const series = (s) => (s && typeof s === 'object')
      ? Object.entries(s).filter(([, n]) => Number.isFinite(Number(n))).sort().slice(-3).map(([d, n]) => `${d}:${Number(n)}`).join(',')
      : '';
    const f = feed.ff, g = feed.gv;
    const ffTotal = Number(f.total), gvTotal = Number(g.total);
    if (!Number.isFinite(ffTotal) || !Number.isFinite(gvTotal)) return null;
    // `classes` bhi saath rakho — notification ke drawer me class-wise breakdown dikhane ke liye
    // (sirf totals rakhne se "kitna update hua class wise" pata nahi chalta tha).
    const classesOf = (v) => (v && typeof v.classes === 'object' && v.classes) ? { ...v.classes } : {};
    return {
      ff: ffTotal, gv: gvTotal, s: `${series(f.series)}|${series(g.series)}`,
      date: feed.date || '', ffClasses: classesOf(f), gvClasses: classesOf(g)
    };
  }
  function loadFeedSig() {
    try { const v = JSON.parse(localStorage.getItem(FEED_SIG_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
  }
  function saveFeedSig(sig) {
    try { if (sig) localStorage.setItem(FEED_SIG_KEY, JSON.stringify({ ...sig, at: Date.now() })); } catch { /* private mode */ }
  }
  // A notification is a data event, not a fetch/status event.  Compare the two live channels
  // and their class maps; a date rollover with no tags is only a new baseline and must stay quiet.
  function feedChanged(before, after) {
    if (!before || !after) return false;
    const classChanged = (a, b) => {
      const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
      for (const key of keys) if (Number((a || {})[key] || 0) !== Number((b || {})[key] || 0)) return true;
      return false;
    };
    const currentChanged = before.ff !== after.ff || before.gv !== after.gv
      || classChanged(before.ffClasses, after.ffClasses) || classChanged(before.gvClasses, after.gvClasses);
    const historyChanged = before.s !== after.s;
    if (!currentChanged && !historyChanged) return false;
    // Midnight with no issuance: the server deliberately treats this as a baseline. Mirror that
    // rule here so the foreground poll cannot show a phantom "0 tags" update.
    if (before.date && after.date && before.date !== after.date
      && Number(after.ff) === 0 && Number(after.gv) === 0
      && !classChanged(before.ffClasses, after.ffClasses) && !classChanged(before.gvClasses, after.gvClasses)) return false;
    return true;
  }
  /** Pichhle snapshot se badlaav → notification + voice announcement (class-wise breakdown ke saath). */
  function announceDataUpdate(before, after) {
    const dFf = (after.ff || 0) - (before ? before.ff || 0 : 0);
    const dGv = (after.gv || 0) - (before ? before.gv || 0 : 0);
    const total = (after.ff || 0) + (after.gv || 0);
    const delta = dFf + dGv;
    // 📊 class-wise: "kitna update hua class wise" — drawer + bell expansion dono isi se bante hain.
    const mergeClasses = (...maps) => { const out = {}; maps.forEach((m) => Object.entries(m || {}).forEach(([k, v]) => { out[k] = (out[k] || 0) + (Number(v) || 0); })); return out; };
    const classDelta = (b, a) => { const out = {}; new Set([...Object.keys(b || {}), ...Object.keys(a || {})]).forEach((k) => { const d = Number((a || {})[k] || 0) - Number((b || {})[k] || 0); if (d) out[k] = d; }); return out; };
    const sigClasses = (sig) => mergeClasses(sig && sig.ffClasses, sig && sig.gvClasses);
    const snapOf = (sig) => (sig ? { date: sig.date || '', total: (sig.ff || 0) + (sig.gv || 0), classes: sigClasses(sig) } : null);
    const deltaClasses = mergeClasses(
      before && before.ff !== after.ff ? classDelta(before.ffClasses, after.ffClasses) : {},
      before && before.gv !== after.gv ? classDelta(before.gvClasses, after.gvClasses) : {}
    );
    const hi = !(FF.assistant && FF.assistant.getLang && FF.assistant.getLang() === 'en');
    const signed = (n) => `${n >= 0 ? '+' : ''}${U.fmt(n)}`;
    const body = hi
      ? `Aaj ka total ${U.fmt(total)} tags ho gaya (${signed(delta)} · FF ${signed(dFf)}, GV ${signed(dGv)}) — Google Sheet se fresh data aa gaya.`
      : `Today's total is now ${U.fmt(total)} tags (${signed(delta)} · FF ${signed(dFf)}, GV ${signed(dGv)}) — fresh data loaded from Google Sheet.`;
    const voiceText = hi
      ? `Data update! Aaj ke ${U.fmt(total)} tags ho gaye — ${signed(delta)} naye.`
      : `Data update! Today's total is now ${U.fmt(total)} tags — ${signed(delta)} new.`;
    if (FF.notifications && FF.notifications.localAlert) {
      FF.notifications.localAlert({
        type: 'report',
        title: `📊 Data update — ${U.fmt(total)} tags`,
        body,
        // 📊 class-wise snapshot: bell ke andar expand + drawer me "kitna update hua class wise,
        //    chassis / replace / wrong" — sab isi meta se banta hai (liveView.reportView).
        // This flag distinguishes a real sheet/tag delta from generic informational items in
        // the notification centre and is also carried into the push payload.
        dataChange: true,
        meta: {
          dataChange: true,
          link: '#/tagIssued', ff: after.ff, gv: after.gv,
          date: after.date || '',
          ffClasses: after.ffClasses || {}, gvClasses: after.gvClasses || {},
          delta: { total: delta, classes: deltaClasses },
          snapshot: snapOf(after),
          previous: snapOf(before)
        },
        voiceText
      });
    }
  }
  /** Aaj ka feed totals le kar pichhle snapshot se compare — change ho to announce + sig save. */
  async function checkFeedChange(announce) {
    let feed = null;
    try { feed = await FF.data.today({ fresh: true }); } catch { return null; }
    const after = feedSig(feed);
    if (!after) return null;
    const before = loadFeedSig();
    saveFeedSig(after);
    if (announce !== false && feedChanged(before, after)) {
      announceDataUpdate(before, after);
    }
    return after;
  }
  /**
   * ⚡ syncNow — halka refresh (daily + report + GV master + today feed) + change detect.
   * opts.auto  → throttled (2.5 min min gap) + page auto re-render;
   * opts.full  → poora preload (manual ↻ path se).
   */
  async function syncNow(opts) {
    const o = opts || {};
    if (!FF.auth.user) return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    const conn = (typeof navigator !== 'undefined' && navigator.connection) || null;
    if (conn && (conn.saveData || /^(slow-)?2g$/.test(String(conn.effectiveType || '')))) return null;
    if (FF.preloader && FF.preloader.running) return null;
    if (refreshing) return null;
    const now = Date.now();
    if (o.auto && now < syncLockUntil) return null;
    if (o.auto) syncLockUntil = now + 150e3; // auto callers (office bell / interval) ke liye throttle
    if (syncingNow) return syncingNow;
    syncingNow = (async () => {
      const before = loadFeedSig();
      try {
        if (o.full && FF.preloader && FF.preloader.fastSync) await FF.preloader.fastSync(true);
        else if (FF.preloader && FF.preloader.lightSync) await FF.preloader.lightSync(true);
        else await FF.store.refresh(['daily', 'report']).catch(() => {});
      } catch (err) { console.warn('syncNow', err && err.message); }
      lastSyncAt = Date.now();
      let after = null;
      try { after = feedSig(await FF.data.today({ fresh: true })); } catch { /* offline */ }
      if (after) {
        saveFeedSig(after);
        if (feedChanged(before, after)) {
          announceDataUpdate(before, after);
        }
      }
      if (FF.auth.user && !['settings', 'sheet'].includes(current.page)) onBackgroundDataUpdated();
      return after;
    })().finally(() => { syncingNow = null; });
    return syncingNow;
  }
  const onVisibleSync = () => {
    if (document.visibilityState !== 'visible' || !FF.auth.user) return;
    if (Date.now() - lastSyncAt > 90e3) syncNow({ auto: true }).catch(() => {});
  };

  let syncTimer = null;
  const appHeartbeat = { timer: null, instance: null };
  let swRegistrationPromise = null;
  /** 📲 Service worker ko notifications.start() se PEHLE register karo — warna push subscribe
      `navigator.serviceWorker.ready` par atak jaata tha aur mobile panel silent reh jaata tha. */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (!swRegistrationPromise) {
      swRegistrationPromise = navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
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
    const on = u && !FF.auth.isAdmin() && localStorage.getItem('ff_presence_pointer') !== '0'; // 👁 preview: target ke hisaab se
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
    maybeOnboarding();
    if (FF.config.loginAnimation !== false) FF.auth.splash(FF.auth.user);
    registerServiceWorker(); // push notifications ke liye SW pehle ready ho
    liveShareChip();
    // 🐚 Bell · KPI drill drawer · search · assistant · office bell · live assist → first paint ke
    //    baad waves me (pehle ye sab login se pehle eager load hote the → pehla paint slow).
    startShellExtras();
    // ⚡ Baaki page modules background me (idle) load hote hain — device ke hisaab se: phone par sirf
    //    roz kaam aane wale 3 modules, desktop par poori list. (wowzone jaise modules lazy hain →
    //    warm ke baad shell extras dobara mount karne padte hain.)
    if (FF.lazy && FF.lazy.warm) Promise.resolve(FF.lazy.warm()).then(() => setTimeout(mountShellExtras, 400)).catch(() => {});
    // 🔍 Global search button — features.search OFF ho to hide
    const gsBtn = U.$('#global-search-btn');
    if (gsBtn) {
      gsBtn.hidden = FF.config.feat && FF.config.feat('search') === false;
      if (!gsBtn.__ffWired) {
        gsBtn.__ffWired = true;
        gsBtn.addEventListener('click', () => {
          const focusSearch = () => {
            if (FF.masterSearch && FF.masterSearch.mountTopbar) {
              FF.masterSearch.mountTopbar();
              const inp = U.$('#master-search-input');
              if (inp) { inp.focus(); inp.select(); return true; }
            }
            if (FF.palette) { FF.palette.toggle(); return true; }
            return false;
          };
          if (focusSearch()) return;
          // Module abhi load nahi hua (first paint ke baad aata hai) → load karke kholo.
          ensureShell(['masterSearch', 'palette']).then(focusSearch);
        });
      }
    }
    // 🧹 v3.62 — Saved Views page hata di gayi, isliye topbar ka ☆ (save current view) button bhi
    // hamesha chhupa rehta hai (pehle wo ek dead page kholta tha).
    const svBtn = U.$('#save-view-btn');
    if (svBtn) svBtn.hidden = true;
    startVersionWatch(); // 🔄 update-available toast (features.updateToast)
    const u = FF.auth.user;
    if (FF.auth.isAdmin()) FF.auth.api('/api/health').then(h => { storageBanner(h.storage); pushBanner(h.push); setPendingSignups(h.pendingSignups); renderSidebar(); }).catch(() => {});
    if (u && u.mustChangePassword) setTimeout(() => U.toast('⚠️ Default password chal raha hai — Settings → My account se badlo', 'err'), 900);
    // Location prompt + PWA
    setTimeout(requestLocationOnOpen, 2000);
    updateInstallBtn();
    // ⚡ Auto background sync — ab har 5 min (pehle 15 min tha) + turant jab:
    //    • tab wapas visible ho (user lautaa),  • office bell ko naye tags dikhein (30s poll),
    //    • manual ↻. syncNow() feed totals compare karke naya data aane par notification + voice
    //      announcement bhi karta hai ("data update ki notification / voice se batao").
    clearInterval(syncTimer);
    syncTimer = setInterval(() => {
      if (!FF.auth.user || document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const conn = (typeof navigator !== 'undefined' && navigator.connection) || null;
      if (conn && (conn.saveData || /^(slow-)?2g$/.test(String(conn.effectiveType || '')))) return; // data-saver/2G par auto-sync band
      syncNow({ auto: true });
    }, 5 * 60 * 1000);
    // 🔄 Tab wapas kholte hi (90s se purana data ho to) instant light sync — "sheet ka data
    //    turant update nahi hota" wali complaint ka fix. Background me chalta hai, page re-render hota hai.
    document.removeEventListener('visibilitychange', onVisibleSync);
    document.addEventListener('visibilitychange', onVisibleSync);
  }

  async function init() {
    U.initTooltip();
    applySavedTweaks();          // ⚡ saved speed prefs + diagnostic repairs — sabse pehle
    bind();
    // 🌐 Public employee link (/tag-request) — yahan login ka koi chakkar nahi: seedha form khulta
    //    hai, sirf employee name mandatory. Baaki poora app pehle jaisa login-protected rehta hai.
    if (FF.publicForm && FF.publicForm.active()) { await FF.publicForm.boot(); return; }
    const ok = await FF.auth.init();
    if (ok) onLogin();
  }

  // ---- ⌨️ command palette (Ctrl/⌘+K) helpers — FF.palette inhe call karta hai ----
  function exportCurrentCsv(kind) {
    const table = U.$('#main table');
    if (!table) { U.toast('Is page par koi table nahi hai', 'warn'); return; }
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const rows = U.tableToRows(table);
    const head0 = rows[0] || [];
    const body = rows.slice(1);
    if (kind === 'xlsx' && FF.xlsx) {
      FF.xlsx.download(`${U.slug((current.page || 'view'))}-${U.stamp()}.xlsx`, [{ name: 'View', header: head0, rows: body }]);
      U.toast('Excel download ho raha hai ✓', 'ok');
      return;
    }
    U.downloadCsv(`${U.slug(current.page || 'view')}-${U.stamp()}.csv`, head0, body);
    U.toast('CSV download ho raha hai ✓', 'ok');
  }
  function toggleLangQuick() {
    const order = ['hinglish', 'en', 'hi'];
    const next = order[(order.indexOf(lang()) + 1) % order.length];
    setLang(next);
  }

  FF.app = { openDataFreshness, storageBanner, pushBanner, liveShareChip, applySavedTweaks, navigate, updateParams, clearGlobalFilters, refresh, syncNow, checkFeedChange, announceDataUpdate, parseHash, resolvePage, pageKnown, firstAllowedPage, firstAllowedRoute, openDrawer, closeDrawer, currentDrawerSnapshot, restoreDrawerSnapshot, exportDrawerCsv, exportDrawerPdf, renderSidebar, renderCurrent, renderTopUser, updateStatus, onLogin, onBackgroundDataUpdated, promptInstall, enhanceCharts, enhanceTables, themeMode, toggleThemeMode, lang, setLang, toggleLangMenu, renderGlobalFilters, renderMobileNav, focusMode: updateFocusMode, openAccessibility: renderA11yPanel, tableDensity, setTableDensity, PAGES, refreshPendingBadge, setPendingSignups, shareWhatsApp, checkVersion, exportCSV: () => exportCurrentCsv('csv'), exportXLSX: () => exportCurrentCsv('xlsx'), toggleTheme: toggleThemeMode, toggleLang: toggleLangQuick, get pendingSignups() { return pendingSignups; }, get current() { return current; }, currentFilters: () => (FF.filters ? FF.filters.current() : currentFilterValues()) };
  document.addEventListener('DOMContentLoaded', init);
})(window.FF);