/* First Forward Dashboard — configuration.
   Defaults live here; everything can be changed from the Settings page (admin) — those overrides are
   stored on the server (data/settings.json) and merged in at startup via FF.config.apply().

   Two data sources ship with the app:
     • First Forward — main sheet (EIR issuance log + StockDataa inventory + REPORT performance)
     • GV Partner    — "Tag Issued Report" sheet (GV Master issuance + Tag Assignment stock + GV REPORT performance)
   `tabs` is the registry of every sheet tab the app can show; each tab is also a permission
   (`sheet:<id>`) that the admin can grant per user (Settings → Access matrix / Users & access). */
window.FF = window.FF || {};

const __ffExcludedTlCache = { sig: null, set: null };   // isExcludedTl() ka cache (neeche)

FF.config = {
  appName: 'First Forward & Gv Partner Dashboard',
  brand: 'First Forward',
  tagline: 'Dashboard',
  logo: '',
  loginImage: '',
  footerText: 'First Forward Dashboard',
  developerName: 'Tarun Kumawat',
  showFooter: true,
  loginAnimation: true,
  theme: { sidebarBg: '#1e1b4b', sidebarBg2: '#4c1d95', sidebarText: '#e0e7ff', accent: '#6366f1', accent2: '#a855f7', gvAccent: '#0d9488' },
  sheetId: '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc',
  gvSheetId: '1LkYX746lGZQKhl5ueoKe3kYOo4SNtu47p5-jkVNUiBA',

  // Server proxy (server.js) — caches Google responses. No auto refresh: data is loaded once when the site
  // opens and again only on the ↻ button or a browser reload.
  proxyPath: '/api/gviz',
  // ⚡ Chhota "aaj ka live" feed (GV = GV Master tab se, FF = EIR se) — Home ka pehla paint isse hota hai.
  todayPath: '/api/today',
  gvTodayPath: '/api/gv-today',
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

  // 🔁 FF issuance lag (server settings → yahan merge hota hai). First Forward (EIR) ka issuance data
  //    T+1 aata hai — aaj ka data kal. GV Partner (master ID 5845036 ki EIR rows) LIVE chalta hai.
  //      • 1 (default) → TODAY view: GV live, FF = 0 with "kal aayega" note; YESTERDAY: dono.
  //      • 0 → purana behaviour (lag off, aaj ki FF rows bhi gini jayengi).
  //    Resolver: filters.js (FF.filters.ffLagOn / ffVisible / isFfPending).
  ffIssuanceLagDays: 1,

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
    dispatchPlan: true, suggestDays: 15, suggestMode: 'both',
    // v3.11 — naye feature flags (Settings → Features se on/off ho sakte hain)
    masterSearch: true, tabHeartbeat: true, themePacks: true, heatmap: true,
    networkGraph: true, sparklines: true, reportCards: true, anomalyRadar: true,
    chatCharts: true, levelUp: true, memoryLane: true,
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
  // 🧭 Admin CCH → class mapping for GV Master.
  // Empty lists keep existing VCLASS/CLASS fallback.
  gvClassCch: { enabled: true, source: 'cch', groups: { VC4: [], VC20: [], VC5: [] } },
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

  // 📦 GV stock ka "sahi" matlab: Tag Assignment me jo tags asli me field me hain. Column D (TAG_STATUS)
  // me ye shabd aaye to row stock se bahar (issued / returned…) — baaki sab in-stock maana jata hai.
  // Blank ya naya status kabhi chhupaya nahi jata: count ke saath byStatus bhi dikhta hai.
  gvStockStatus: {
    inStock: ['IN STOCK', 'STOCK', 'ASSIGNED', 'ALLOCATED', 'AVAILABLE', 'ACTIVE', 'FRESH', 'OK'],
    outStock: ['ISSUE', 'SOLD', 'DISPATCH', 'DELIVER', 'RETURN', 'CANCEL', 'DEAD', 'BLOCK', 'LOST', 'DAMAGE', 'REPLAC', 'VOID', 'EXPIRE', 'CLOSED', 'INACTIVE']
  },

  report: { sheet: 'REPORT', gid: '242489821' },
  ffCommission: { rateCol: '', earnedCol: '', categoryCol: '', dateCol: '' }, // blank = dynamic REPORT heading discovery
  // FF Google Sheet ki "payout" tab — har class ka commission rate aur penalty. Blank fields auto-detect.
  ffPayout: { sheet: 'payout', gid: '', labelCol: '', classCol: '', rateCol: '', penaltyCol: '', noteCol: '' },
  // Cockpit (cockpit.js) ke thresholds — Settings se server par bhi save ho sakte hain.
  commissionAlerts: { enabled: true, outlierPct: 25, gvGapPct: 40, mismatchPct: 5, mismatchMin: 50, zeroEarnedMin: 1 },
  dispatch: { tagsPerBox: 25, horizon: 7, minNeed: 1, top: 40 },
  // GV personal commission: exact agent-ID + vehicle-class mapping. VC4 defaults to the
  // GV Master commission column; the remaining classes are deliberately manual until admin
  // enters the official rate. Blank never means zero or a guessed rate.
  gvCommissionRates: {
    enabled: true, currentMonthOnly: true,
    classes: {
      VC4: { source: 'master', rate: '' }, VC20: { source: 'manual', rate: '' },
      VC5: { source: 'manual', rate: '' }, VC6: { source: 'manual', rate: '' },
      VC7: { source: 'manual', rate: '' }, VC12: { source: 'manual', rate: '' }
    }
  },
  commissionSlabs: {
    enabled: false, model: 'agentTier',
    channels: {
      ff: [{ min: 1, max: 50, rate: '' }, { min: 51, max: 100, rate: '' }, { min: 101, max: 150, rate: '' }, { min: 151, max: 250, rate: '' }, { min: 251, max: null, rate: '' }],
      gv: [{ min: 1, max: 50, rate: '' }, { min: 51, max: 100, rate: '' }, { min: 101, max: 150, rate: '' }, { min: 151, max: 250, rate: '' }, { min: 251, max: null, rate: '' }]
    }
  },

  // TL names that are NOT real team leaders (placeholder for direct agents) — hidden from every TL view.
  excludeTls: ['APS'],
  // 🧍 Direct Agents & TLs — poore site ka ek hi rule (Settings → 🧍 Direct Agents).
  // Direct agent = jiske paas asli TL nahi hai. Rule channel ke hisaab se:
  //   • First Forward : TL Name = ffTlNames (default "APS") → Direct Agent (APS)
  //   • GV Partner    : TL ID aur TL Name DONO blank (jinke paas TL hi nahi) → Direct Agent (no TL)
  // Extra signals (off karne ke liye false karo): agent khud apna supervisor, placeholder TL naam,
  // ya explicit isDirect/directAgent/tlExcluded flag. Direct agents TL ranking/TL table me nahi aate
  // aur (dispatchExempt) unko stock dispatch bhi nahi bhejna hota.
  direct: {
    enabled: true,
    ffTlNames: ['APS'],
    gvNoTl: true,
    gvSelfSupervised: true,
    hideFromTlViews: true,
    dispatchExempt: true,
    labelFf: 'Direct Agent (APS)',
    labelGv: 'Direct Agent (no TL)',
    labelBoth: 'Direct Agent'
  },
  // TL naam jo sirf placeholder hain (kabhi asli TL nahi) — har channel me TL list se bahar.
  directPlaceholderTls: ['DIRECT', 'DIRECT AGENT', 'DIRECTS', 'NO TL', 'NO TL ASSIGNED', 'NO SUPERVISOR', 'UNASSIGNED', 'NOT ASSIGNED', 'N/A', 'NA', '-', '--', '—'],
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
  /** Direct-agent rules (Settings → 🧍 Direct Agents). */
  directRules() { return this.direct || {}; },
  /** FF direct TL names — `direct.ffTlNames` + legacy `excludeTls` (jaise APS). */
  directTlNames() {
    const d = this.directRules();
    const list = [...(d.ffTlNames || []), ...(this.excludeTls || [])];
    const seen = new Set();
    return list.map((x) => String(x || '').trim()).filter((x) => { const k = x.toUpperCase(); if (!x || seen.has(k)) return false; seen.add(k); return true; });
  },
  /** True when a TL name is a placeholder (e.g. "APS", "Direct", "Unassigned") — never a real TL. */
  isExcludedTl(name) {
    const n = String(name || '').trim().toUpperCase();
    if (!n) return true;
    // Ye har agent/stock row par chalta hai (lakhon baar) — pehle har call par lists dobara ban-ti thin (master search index
    // ~2 s). Ab upper-cased Set ek baar banta hai aur sirf tab badalta hai jab Settings se lists badli hon (signature check).
    const d = this.directRules();
    const sig = `${(d.ffTlNames || []).join('\u0001')}\u0002${(this.excludeTls || []).join('\u0001')}\u0002${(this.directPlaceholderTls || []).join('\u0001')}`;
    if (!__ffExcludedTlCache.set || __ffExcludedTlCache.sig !== sig) {
      const set = new Set();
      [...(d.ffTlNames || []), ...(this.excludeTls || []), ...(this.directPlaceholderTls || [])].forEach((x) => { const k = String(x || '').trim().toUpperCase(); if (k) set.add(k); });
      __ffExcludedTlCache.set = set; __ffExcludedTlCache.sig = sig;
    }
    return __ffExcludedTlCache.set.has(n);
  },
  /** 'ff' | 'gv' | '' — channel of an agent/row (explicit param, else from the object). */
  directChannelOf(agent, channel) {
    const explicit = String(channel || '').trim().toLowerCase();
    if (explicit) return /^g/.test(explicit) ? 'gv' : /^f|^ff/.test(explicit) ? 'ff' : explicit;
    if (!agent || typeof agent !== 'object') return '';
    if (agent.isGv === true || agent.gv === true) return 'gv';
    const raw = String(agent.channel || agent.network || agent.source || agent.segment || '').trim().toLowerCase();
    if (/gv|partner/.test(raw)) return 'gv';
    if (/ff|first|forward/.test(raw)) return 'ff';
    return '';
  },
  /** True when the agent is "self-supervised": apna hi naam/ID supervisor column me likha hai. */
  isSelfSupervised(agent) {
    if (!agent || typeof agent !== 'object') return false;
    const self = (a, b) => {
      const x = String(a || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const y = String(b || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      return Boolean(x && y && x === y);
    };
    return self(agent.tlName || agent.tl, agent.agentName || agent.name) || self(agent.tlId || agent.supervisorId, agent.agentId || agent.id);
  },
  /** `VC4`-style class/token signal: APS ya DIRECT kisi bhi class/channel column me. */
  hasDirectToken(agent) {
    if (!agent || typeof agent !== 'object') return false;
    return [agent.agentClass, agent.tlClass, agent.channelClass, agent.stockClass]
      .some((value) => /(^|[\s/_-])(APS|DIRECT)(?=$|[\s/_-])/i.test(String(value || '').trim()));
  },
  /**
   * Shared FF/GV classification — kya ye agent DIRECT hai (koi asli TL nahi)?
   * Channel do (ya agent.channel se auto): 'ff' | 'gv'.
   *   FF : TL Name APS (ffTlNames) / placeholder / koi TL hi nahi.
   *   GV : TL ID + TL Name dono khaali, ya agent hi apna supervisor.
   * Channel pata na ho to dono rules ka union (safe side).
   */
  isDirectAgent(agent, channel) {
    if (!agent || typeof agent !== 'object') return false;
    if (agent.isDirect === true || agent.directAgent === true || agent.tlExcluded === true) return true;
    const d = this.directRules();
    if (d.enabled === false && !agent.isDirect && !agent.directAgent && !agent.tlExcluded) return false;
    const selfSupervised = d.gvSelfSupervised !== false && this.isSelfSupervised(agent);
    const ffRule = () => {
      const tl = String(agent.tlName || agent.tl || '').trim();
      if (tl && this.isExcludedTl(tl)) return true;
      if (!tl && !String(agent.tlId || agent.supervisorId || '').trim()) return true;
      return selfSupervised;
    };
    const gvRule = () => {
      const tl = String(agent.tlName || agent.tl || '').trim();
      const id = String(agent.tlId || agent.supervisorId || '').trim();
      if (d.gvNoTl !== false && !tl && !id) return true;
      if (tl && this.isExcludedTl(tl)) return true;
      return selfSupervised;
    };
    const ch = this.directChannelOf(agent, channel);
    if (ch === 'gv') return gvRule() || this.hasDirectToken(agent);
    if (ch === 'ff') return ffRule() || this.hasDirectToken(agent);
    return ffRule() || gvRule() || this.hasDirectToken(agent);
  },
  /** Kya ye TL naam asli team leader hai (direct placeholder nahi)? */
  isRealTl(name) { return !this.isExcludedTl(name); },
  /** Agent ke liye site-wide label: "Direct Agent (APS)" / "Direct Agent (no TL)" / asli TL naam. */
  directLabel(agent, channel) {
    const ch = this.directChannelOf(agent, channel);
    const d = this.directRules();
    if (ch === 'gv') return d.labelGv || 'Direct Agent (no TL)';
    if (ch === 'ff') return d.labelFf || 'Direct Agent (APS)';
    return d.labelBoth || 'Direct Agent';
  },
  /** Merge server-side settings (Settings page) into this config. */
  apply(s) {
    if (!s || typeof s !== 'object') return;
    const pick = (k) => { if (s[k] !== undefined && s[k] !== null) this[k] = s[k]; };
    ['appName', 'brand', 'tagline', 'logo', 'loginImage', 'loginAnimation', 'sheetId', 'gvSheetId', 'excludeTls', 'pageSize', 'allowSignup', 'directPlaceholderTls'].forEach(pick);
    if (s.gvClassCch) this.gvClassCch = { ...this.gvClassCch, ...s.gvClassCch, groups: { ...(this.gvClassCch && this.gvClassCch.groups), ...(s.gvClassCch.groups || {}) } };
    if (s.direct) this.direct = { ...this.direct, ...s.direct };
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
    if (s.dispatch) this.dispatch = { ...this.dispatch, ...s.dispatch };
    if (s.gvCommissionRates) this.gvCommissionRates = {
      ...this.gvCommissionRates, ...s.gvCommissionRates,
      classes: { ...(this.gvCommissionRates && this.gvCommissionRates.classes), ...(s.gvCommissionRates.classes || {}) }
    };
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
