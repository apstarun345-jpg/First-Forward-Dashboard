/* First Forward Dashboard — configuration.
   Defaults live here; everything can be changed from the Settings page (admin) — those overrides are
   stored on the server (data/settings.json) and merged in at startup via FF.config.apply().

   Two data sources ship with the app:
     • First Forward — main sheet (EIR issuance log + StockDataa inventory + REPORT performance)
     • GV Partner    — "Tag Issued Report" sheet (GV Master issuance + Tag Assignment stock + GV REPORT performance)
   `tabs` is the registry of every sheet tab the app can show; each tab is also a permission
   (`sheet:<id>`) that the admin can grant per user (Settings → Access matrix / Users & access). */
window.FF = window.FF || {};

FF.config = {
  appName: 'First Forward & Gv Partner Dashboard',
  brand: 'First Forward',
  tagline: 'Dashboard',
  logo: '',
  loginImage: '',
  loginAnimation: true,
  theme: { sidebarBg: '#1e1b4b', sidebarBg2: '#4c1d95', sidebarText: '#e0e7ff', accent: '#6366f1', accent2: '#a855f7', gvAccent: '#0d9488' },
  sheetId: '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc',
  gvSheetId: '1LkYX746lGZQKhl5ueoKe3kYOo4SNtu47p5-jkVNUiBA',

  // Server proxy (server.js) — caches Google responses. No auto refresh: data is loaded once when the site
  // opens and again only on the ↻ button or a browser reload.
  proxyPath: '/api/gviz',
  // Data only flows through the login-protected proxy (no direct browser→Google fallback), so access rules hold.
  directFallback: false,
  autoRefreshMs: 0,

  // ---- sheet tab registry -----------------------------------------------------------------------
  // id      → unique key (also the `sheet:<id>` permission and the #/sheet/<id> route)
  // group   → sidebar section ('First Forward' | 'GV Partner')
  // source  → 'main' (First Forward sheet) | 'gv' (GV Partner sheet)
  // tab     → exact Google Sheet tab name,  gid → optional tab id (takes priority when set)
  // startCol, startRow, endCol, endRow, range → custom column & row bounds for this sheet
  tabs: [
    { id: 'StockDataa', group: 'First Forward', source: 'main', kind: 'stock', icon: '📦', label: 'StockDataa · Inventory', tab: 'StockDataa', gid: '', startCol: 'A', startRow: '1', endCol: 'M', endRow: '', range: '', desc: 'Field stock (tag-wise)', enabled: true, search: ['I', 'H', 'K', 'B', 'D', 'F', 'C'] },
    { id: 'REPORT', group: 'First Forward', source: 'main', kind: 'report', icon: '📑', label: 'REPORT', tab: 'REPORT', gid: '242489821', startCol: 'A', startRow: '1', endCol: '', endRow: '', range: '', desc: 'Agent-wise summary: stock + issuance + status', enabled: true },
    { id: 'EIR', group: 'First Forward', source: 'main', kind: 'issuance', icon: '🗂️', label: 'EIR · Issuance log', tab: 'EIR', gid: '', startCol: 'A', startRow: '1', endCol: '', endRow: '', range: '', desc: 'Har tag ka issuance record (bada tab)', enabled: false, search: ['B', 'L', 'G', 'AH', 'E'] },
    { id: 'GV Master', group: 'GV Partner', source: 'gv', kind: 'gv-issuance', icon: '🚀', label: 'GV Master · Issuance', tab: 'GV Master', gid: '', startCol: 'A', startRow: '1', endCol: 'X', endRow: '', range: '', desc: 'GV partner ka poora issuance data', enabled: true, search: ['B', 'A', 'D', 'E', 'I'] },
    { id: 'Tag Assignment', group: 'GV Partner', source: 'gv', kind: 'gv-stock', icon: '📦', label: 'Tag Assignment · Stock', tab: 'Tag Assignment', gid: '', startCol: 'A', startRow: '1', endCol: 'M', endRow: '', range: '', desc: 'GV partner stock (tag-wise, In Stock)', enabled: true, search: ['F', 'B', 'C', 'H', 'A'] },
    { id: 'GV REPORT', group: 'GV Partner', source: 'gv', kind: 'gv-report', icon: '📑', label: 'GV REPORT · Performance', tab: 'GV REPORT', gid: '1284424234', startCol: 'A', startRow: '4', endCol: 'BE', endRow: '', range: 'A4:BE', desc: 'GV agent-wise performance + stock', enabled: true }
  ],

  // Legacy view of the First Forward sheet tabs (kept in sync with `tabs` by refreshViews()).
  sheets: [],

  // 🎛 Feature switches — server (Settings → 🎛 Features) se overwrite hote hain. Admin yahin se
  //    on/off/modify karta hai; defaults sab ON (alerts ke saath).
  features: {
    search: true, share: true, targetBar: true, stockTrend: true, tlCover: true, recon: true,
    loginHistory: true, pendingBadge: true, updateToast: true, backupReminder: true,
    waNumber: '',
    alerts: { lowCover: true, midMonth: true, inactive: true, zeroDay: true, newLoginIp: true, anomaly: true },
    digestHour: 8, midFrom: 15, midTo: 25, midGapPct: 40, zeroDropPct: 50, backupDays: 7,
    emailDigest: false,
    tvMode: true, weekCompare: true, agedStock: true, auditLog: true, announcements: true,
    tlGoals: true, otp2fa: true, emailReport: false, emailReportHour: 21,
    weeklyEmail: false, weeklyEmailHour: 9, anomalyPct: 80,
    badges: true, voiceSummary: true, askBox: true, teamMap: true, tlAnomaly: true, personalLinks: true,
    customAlerts: true, championEmail: false, championHour: 10, championTop: 3,
    followupTracker: true, followupDays: 3, followupHour: 10,
    dispatchPlan: true, suggestDays: 15,
    officeLat: 0, officeLng: 0
  },
  /** Feature flag padho — FF.config.feat('search') / FF.config.feat('alerts').lowCover */
  feat(key) { const f = this.features || {}; return f[key]; },

  // EIR (issuance log) column letters — used for Dashboard / Trend / class-wise comparisons.
  eir: {
    sheet: 'EIR',
    tagId: 'A', vrn: 'B', cls: 'D', type: 'P', status: 'Z', date: 'AA',
    agentId: 'J', agentName: 'L', masterId: 'AU', tlId: 'AV', gvId: 'AW', gvName: 'AX',
    gvTl: 'AZ', tlName: 'BA', vrnType: 'BC', monthName: 'BD', regNumber: 'BH',
    gvMasterId: '5845036', gvChannelTl: 'ApnaPayment Pvt. Ltd.'
  },

  // StockDataa (inventory) column letters.
  stock: {
    sheet: 'StockDataa',
    id: 'A', name: 'B', tagId: 'C', barcode: 'D', cls: 'E', tagType: 'F', bcAllocatedAt: 'G',
    agentId: 'H', agentName: 'I', agentAllocatedAt: 'J', tlName: 'K'
  },

  // Optional unified movement ledger in the First Forward spreadsheet. One row = one real stock
  // movement. Channel must be First Forward or GV Partner; Type is IN / OUT / TRANSFER / ADJUSTMENT.
  stockMovement: {
    enabled: false, sheet: 'Stock Movements', date: 'A', channel: 'B', type: 'C', quantity: 'D',
    cls: 'E', from: 'F', to: 'G', reference: 'H', note: 'I'
  },

  // GV Partner sheet mapping (tab names + column letters / header row).
  // GV Master = issuance log, Tag Assignment = stock, GV REPORT = agent-wise performance.
  gv: {
    master: {
      tab: 'GV Master', gid: '',
      uniqueId: 'A', agentName: 'B', tlId: 'C', tlName: 'D', vrn: 'E', vClass: 'F', cch: 'G',
      serial: 'H', tagId: 'I', amount: 'J', customer: 'K', productId: 'L', commission: 'M',
      status: 'N', commissionStatus: 'O', date: 'P', time: 'Q', gvTlId: 'R', masterCch: 'S',
      monthName: 'T', tagType: 'U', gvUniqueId: 'W', gvUniqueName: 'X'
    },
    assignment: {
      tab: 'Tag Assignment', gid: '',
      cls: 'A', tagId: 'B', serial: 'C', status: 'D', agentId: 'E', agentName: 'F',
      tlId: 'G', tlName: 'H', gvUniqueId: 'L', gvUniqueName: 'M', allocatedAt: ''
    },
    report: { tab: 'GV REPORT', gid: '1284424234', headerRow: 4, lastCol: 'AZ' }
  },

  report: { sheet: 'REPORT', gid: '242489821' },
  ffCommission: { rateCol: '', earnedCol: '', categoryCol: '', dateCol: '' }, // blank = dynamic REPORT heading discovery
  // FF Google Sheet ki "payout" tab — har class ka commission rate aur penalty. Blank fields auto-detect.
  ffPayout: { sheet: 'payout', gid: '', labelCol: '', classCol: '', rateCol: '', penaltyCol: '', noteCol: '' },
  // Cockpit (cockpit.js) ke thresholds — Settings se server par bhi save ho sakte hain.
  commissionAlerts: { enabled: true, outlierPct: 25, gvGapPct: 40, mismatchPct: 5, mismatchMin: 50, zeroEarnedMin: 1 },
  dispatch: { tagsPerBox: 25, horizon: 7, minNeed: 1, top: 40 },
  commissionSlabs: {
    enabled: false, model: 'agentTier',
    channels: {
      ff: [{ min: 1, max: 50, rate: '' }, { min: 51, max: 100, rate: '' }, { min: 101, max: 150, rate: '' }, { min: 151, max: 250, rate: '' }, { min: 251, max: null, rate: '' }],
      gv: [{ min: 1, max: 50, rate: '' }, { min: 51, max: 100, rate: '' }, { min: 101, max: 150, rate: '' }, { min: 151, max: 250, rate: '' }, { min: 251, max: null, rate: '' }]
    }
  },

  // TL names that are NOT real team leaders (placeholder for direct agents) — hidden from every TL view.
  excludeTls: ['APS'],
  thresholds: { coverRed: 7, coverOrange: 15, coverAmber: 30, inactiveDays: 3, topN: 10 },
  contacts: { teamWhatsapp: '', teamEmail: '', teamGroupLink: '', signature: 'Team First Forward' },
  pageSize: 50,
  allowSignup: true,

  // ---- helpers ---------------------------------------------------------------------------------
  /** Format or compute range string from col/row bounds (e.g. A, 1, M, '' → A1:M). */
  formatRange(startCol, startRow, endCol, endRow, customRange) {
    if (customRange && String(customRange).trim()) return String(customRange).trim().toUpperCase();
    const c1 = String(startCol || '').trim().toUpperCase();
    const r1 = String(startRow || '').trim();
    const c2 = String(endCol || '').trim().toUpperCase();
    const r2 = String(endRow || '').trim();
    if (!c1 && !c2 && !r1 && !r2) return '';
    const from = `${c1 || 'A'}${r1 || '1'}`;
    const to = `${c2}${r2}`;
    // A1 alone means ONE CELL to Google, not an open-ended sheet.
    return to ? `${from}:${to}` : (from === 'A1' ? '' : `${from}:ZZZ`);
  },
  /** All registered tabs (optionally only the enabled ones). */
  allTabs(onlyEnabled) {
    const list = (this.tabs || []).filter((t) => t && t.id);
    return onlyEnabled ? list.filter((t) => t.enabled !== false) : list;
  },
  /** Tab definition by id, tab name or label. */
  tabBy(name) {
    const n = String(name || '');
    return this.allTabs().find((t) => t.id === n || t.tab === n || t.label === n) || null;
  },
  /** Back-compat: sheet viewer / nav used config.sheetByName(name). */
  sheetByName(name) { return this.tabBy(name); },
  /** Google spreadsheet id for a tab (or for a raw source key). */
  sheetIdFor(tab) {
    const src = typeof tab === 'string' ? (this.tabBy(tab) || {}).source : (tab || {}).source;
    return src === 'gv' ? this.gvSheetId : this.sheetId;
  },
  /** Enabled tabs of one group ('First Forward' | 'GV Partner'). */
  groupTabs(group, onlyEnabled) {
    return this.allTabs(onlyEnabled).filter((t) => t.group === group);
  },
  /** Recompute the legacy `sheets` / `gvSheets` views after settings are merged in. */
  refreshViews() {
    if (!Array.isArray(this.tabs) || !this.tabs.length) this.tabs = FF.configDefaults ? FF.configDefaults.tabs : this.tabs;
    this.sheets = this.groupTabs('First Forward', true);
    this.gvSheets = this.groupTabs('GV Partner', true);
  },
  /** True when a TL name is a placeholder (e.g. "APS") that must not appear in TL views. */
  isExcludedTl(name) {
    const n = String(name || '').trim().toUpperCase();
    if (!n) return true;
    return (this.excludeTls || []).some((x) => String(x).trim().toUpperCase() === n);
  },
  /** Shared FF/GV dispatch classification: direct/APS agents do not need stock dispatch. */
  isDirectAgent(agent) {
    if (!agent || typeof agent !== 'object') return false;
    if (agent.isDirect === true || agent.directAgent === true || agent.tlExcluded === true) return true;
    const tl = String(agent.tlName || agent.tl || '').trim();
    if (!tl && !String(agent.tlId || agent.supervisorId || '').trim()) return true;
    if (tl && (this.isExcludedTl(tl) || /^(?:direct|direct agent|no tl)$/i.test(tl))) return true;
    return [agent.agentClass, agent.tlClass, agent.channelClass]
      .some((value) => /(^|[\s/_-])(APS|DIRECT)(?=$|[\s/_-])/i.test(String(value || '').trim()));
  },
  /** Merge server-side settings (Settings page) into this config. */
  apply(s) {
    if (!s || typeof s !== 'object') return;
    const pick = (k) => { if (s[k] !== undefined && s[k] !== null) this[k] = s[k]; };
    ['appName', 'brand', 'tagline', 'logo', 'loginImage', 'loginAnimation', 'sheetId', 'gvSheetId', 'excludeTls', 'pageSize', 'allowSignup'].forEach(pick);
    if (s.theme) this.theme = { ...this.theme, ...s.theme };
    if (s.thresholds) this.thresholds = { ...this.thresholds, ...s.thresholds };
    if (s.features) {
      const f = { ...this.features, ...s.features };
      f.alerts = { ...(this.features && this.features.alerts), ...(s.features.alerts || {}) };
      this.features = f;
    }
    if (s.contacts) this.contacts = { ...this.contacts, ...s.contacts };
    if (s.eir) this.eir = { ...this.eir, ...s.eir };
    if (s.stock) this.stock = { ...this.stock, ...s.stock };
    if (s.stockMovement) this.stockMovement = { ...this.stockMovement, ...s.stockMovement };
    if (Array.isArray(s.tabs) && s.tabs.length) {
      this.tabs = s.tabs.map((t) => {
        const copy = { ...t };
        if (!copy.range && (copy.startCol || copy.startRow || copy.endCol || copy.endRow)) {
          copy.range = this.formatRange(copy.startCol, copy.startRow, copy.endCol, copy.endRow);
        }
        return copy;
      });
    }
    if (s.gv) this.gv = { master: { ...this.gv.master, ...(s.gv.master || {}) }, assignment: { ...this.gv.assignment, ...(s.gv.assignment || {}) }, report: { ...this.gv.report, ...(s.gv.report || {}) } }
    if (s.commissionAlerts) this.commissionAlerts = { ...this.commissionAlerts, ...s.commissionAlerts };
    if (s.dispatch) this.dispatch = { ...this.dispatch, ...s.dispatch };;
    if (s.ffCommission) this.ffCommission = { ...this.ffCommission, ...s.ffCommission };
    if (s.ffPayout) this.ffPayout = { ...this.ffPayout, ...s.ffPayout };
    if (s.commissionSlabs) this.commissionSlabs = { ...this.commissionSlabs, ...s.commissionSlabs, channels: { ...this.commissionSlabs.channels, ...(s.commissionSlabs.channels || {}) } };
    if (s.eirSheet) this.eir.sheet = s.eirSheet;
    if (s.stockSheet) this.stock.sheet = s.stockSheet;
    const stockTab = this.tabBy('StockDataa');
    if (stockTab) { stockTab.tab = this.stock.sheet; if (s.stockGid !== undefined) stockTab.gid = s.stockGid || ''; }
    if (s.reportGid !== undefined) { this.report.gid = s.reportGid; const rep = this.tabBy('REPORT'); if (rep) rep.gid = s.reportGid; }
    if (!Array.isArray(this.excludeTls)) this.excludeTls = String(this.excludeTls || '').split(',').map((x) => x.trim()).filter(Boolean);
    this.refreshViews();
  }
};
FF.configDefaults = { tabs: JSON.parse(JSON.stringify(FF.config.tabs)) };
FF.config.refreshViews();
