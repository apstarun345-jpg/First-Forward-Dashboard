/* First Forward Dashboard — configuration.
   Defaults live here; everything can be changed from the Settings page (admin) — those overrides are
   stored on the server (data/settings.json) and merged in at startup via FF.config.apply(). */
window.FF = window.FF || {};

FF.config = {
  appName: 'First Forward Dashboard',
  brand: 'First Forward',
  tagline: 'Dashboard',
  logo: '',
  loginImage: '',
  theme: { sidebarBg: '#1e1b4b', sidebarBg2: '#4c1d95', sidebarText: '#e0e7ff', accent: '#6366f1', accent2: '#a855f7' },
  sheetId: '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc',

  // Server proxy (server.js) — caches Google responses. No auto refresh: data is loaded once when the site
  // opens and again only on the ↻ button or a browser reload.
  proxyPath: '/api/gviz',
  // Data only flows through the login-protected proxy (no direct browser→Google fallback), so access rules hold.
  directFallback: false,
  autoRefreshMs: 0,

  // Sheet tabs shown in the left sidebar under "Sheets" — only StockDataa and REPORT.
  sheets: [
    { name: 'StockDataa', icon: '📦', title: 'StockDataa · Inventory', desc: 'Field me pada hua stock (tag-wise)', big: true, search: ['I', 'H', 'K', 'B', 'D', 'F', 'C'], expect: 'ID' },
    { name: 'REPORT', icon: '📑', title: 'REPORT', desc: 'Agent-wise summary: stock + issuance + status', gid: '242489821' }
  ],

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

  report: { sheet: 'REPORT', gid: '242489821' },

  // TL names that are NOT real team leaders (placeholder for direct agents) — hidden from every TL view.
  excludeTls: ['APS'],
  thresholds: { coverRed: 7, coverOrange: 15, coverAmber: 30, inactiveDays: 3, topN: 10 },
  contacts: { teamWhatsapp: '', teamEmail: '', teamGroupLink: '', signature: 'Team First Forward' },
  pageSize: 50,
  allowSignup: true,

  sheetByName(name) {
    return this.sheets.find((s) => s.name === name) || null;
  },
  /** True when a TL name is a placeholder (e.g. "APS") that must not appear in TL views. */
  isExcludedTl(name) {
    const n = String(name || '').trim().toUpperCase();
    if (!n) return true;
    return (this.excludeTls || []).some((x) => String(x).trim().toUpperCase() === n);
  },
  /** Merge server-side settings (Settings page) into this config. */
  apply(s) {
    if (!s || typeof s !== 'object') return;
    const pick = (k) => { if (s[k] !== undefined && s[k] !== null) this[k] = s[k]; };
    ['appName', 'brand', 'tagline', 'logo', 'loginImage', 'sheetId', 'excludeTls', 'pageSize', 'allowSignup'].forEach(pick);
    if (s.theme) this.theme = { ...this.theme, ...s.theme };
    if (s.thresholds) this.thresholds = { ...this.thresholds, ...s.thresholds };
    if (s.contacts) this.contacts = { ...this.contacts, ...s.contacts };
    if (s.eir) this.eir = { ...this.eir, ...s.eir };
    if (s.stock) this.stock = { ...this.stock, ...s.stock };
    if (s.eirSheet) this.eir.sheet = s.eirSheet;
    if (s.stockSheet) { this.stock.sheet = s.stockSheet; this.sheets[0].name = s.stockSheet; }
    if (s.stockGid !== undefined) this.sheets[0].gid = s.stockGid || undefined;
    if (s.reportGid !== undefined) { this.report.gid = s.reportGid; this.sheets[1].gid = s.reportGid; }
    if (!Array.isArray(this.excludeTls)) this.excludeTls = String(this.excludeTls || '').split(',').map((x) => x.trim()).filter(Boolean);
  }
};
