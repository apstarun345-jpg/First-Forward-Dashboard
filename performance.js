/* Performance page: agent & TL performance from the REPORT tab (stock + last/current month issuance + status).
   Quick-find (dropdown) → full agent / TL profile with charts, VC4 vs Commercial comparison, priority & status
   quick filters, WhatsApp / Email share. "APS" (direct agents) is never shown as a TL. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, D = FF.data, C = FF.charts, S = FF.store;
  const esc = U.esc, clean = U.clean, num = U.num;

  // Columns whose sub-header is blank in the sheet (verified against StockDataa TAG_CLASS totals).
  const LABEL_OVERRIDES = { stockC1: 'VC5', stockC2: 'VC6', stockC3: 'VC7', stockC4: 'VC12', stockC5: 'VC16', colAB: '', curC1: 'VC5', curC2: 'VC6', curC3: 'VC7', curC4: 'VC12', curC5: 'VC16', colBR: '' };
  const SCHEMA = [
    { key: 'profile', title: 'Agent Profile', match: /agent profile/i, fixed: 0, cols: [{ key: 'agentId', label: 'Agent ID' }, { key: 'id', label: 'ID' }, { key: 'name', label: 'Agent Name' }] },
    { key: 'tl', title: 'TL Master Data', match: /tl'?s master data/i, fixed: 3, cols: [{ key: 'gvIdFound', label: 'GV ID Found' }, { key: 'tlId', label: 'TL ID' }, { key: 'tlMobile', label: 'TL Mobile' }, { key: 'tlName', label: 'TL Name' }] },
    { key: 'stock', title: 'Agent Inventory (Stock)', match: /agent inventory summary/i, fixed: 7, cols: [{ key: 'stockVc4', label: 'VC4 Stock', type: 'num' }, { key: 'stockC1', label: null, type: 'num' }, { key: 'stockC2', label: null, type: 'num' }, { key: 'stockC3', label: null, type: 'num' }, { key: 'stockC4', label: null, type: 'num' }, { key: 'stockC5', label: null, type: 'num' }, { key: 'stockTotal', label: 'Total Stock', type: 'num' }, { key: 'stockNvc4', label: 'Commercial Stock', type: 'num' }] },
    { key: 'dispatchVc4', title: 'Fastag Dispatch (VC4) · TL level', match: /dispatch details \(vc4\)/i, fixed: 15, cols: [{ key: 'tlVc4Days', label: 'TL VC4 Stock Days', type: 'num' }, { key: 'tlProjectedB', label: 'TL Projected Issuance', type: 'num' }, { key: 'tlPriority', label: 'Dispatch Priority', type: 'badge' }, { key: 'tlStockAlert', label: 'Stock Alert', type: 'badge' }] },
    { key: 'tlStock', title: 'TL Stock', match: /tl'?s stock details/i, fixed: 19, cols: [{ key: 'tlStockVc4', label: 'TL VC4 Stock', type: 'num' }, { key: 'tlStockNvc4', label: 'TL Commercial Stock', type: 'num' }, { key: 'tlStockTotal', label: 'TL Total Stock', type: 'num' }] },
    { key: 'lastMonth', title: 'Last Month', match: /performance in\s*-/i, occurrence: 0, fixed: 22, month: true, cols: [{ key: 'lastActiveDays', label: 'Active Days', type: 'num' }, { key: 'lastVc4', label: 'VC4 Issued', type: 'num' }, { key: 'lastNvc4', label: 'Commercial Issued', type: 'num' }, { key: 'lastTotal', label: 'Total Issued', type: 'num' }] },
    { key: 'curMonth', title: 'Current Month', match: /performance in\s*-/i, occurrence: 1, fixed: 26, month: true, cols: [{ key: 'wrongVrn', label: 'Wrong VRN', type: 'num' }, { key: 'colAB', label: null, type: 'num' }, { key: 'curVc4', label: 'VC4 Issued', type: 'num' }, { key: 'curC1', label: null, type: 'num' }, { key: 'curC2', label: null, type: 'num' }, { key: 'curC3', label: null, type: 'num' }, { key: 'curC4', label: null, type: 'num' }, { key: 'curC5', label: null, type: 'num' }, { key: 'curNvc4', label: 'Commercial Issued', type: 'num' }, { key: 'curTotal', label: 'Total Issued', type: 'num' }, { key: 'curProjected', label: 'Projected (month end)', type: 'num' }, { key: 'avgVc4', label: 'VC4 / Active Day', type: 'num' }, { key: 'avgNvc4', label: 'Commercial / Active Day', type: 'num' }, { key: 'avgTotal', label: 'Daily Avg (Total)', type: 'num' }] },
    { key: 'status', title: 'Agent Performance Status', match: /agents? performance status/i, fixed: 40, cols: [{ key: 'growth', label: 'Last vs Current', type: 'pct' }, { key: 'lastActive', label: 'Last Active', type: 'badge' }, { key: 'agentStatus', label: 'Agent Status', type: 'badge' }] },
    { key: 'week', title: 'Last 7 Days', match: /performance in 7 days/i, fixed: 43, cols: [{ key: 'activeDays', label: 'Active Days (month)', type: 'num' }, { key: 'd1', label: '@header', type: 'num' }, { key: 'd2', label: '@header', type: 'num' }, { key: 'd3', label: '@header', type: 'num' }, { key: 'd4', label: '@header', type: 'num' }, { key: 'd5', label: '@header', type: 'num' }, { key: 'd6', label: '@header', type: 'num' }, { key: 'd7', label: '@header', type: 'num' }] },
    { key: 'tlLast', title: 'TL · Last Month Issued', match: /tl'?s last month issued/i, fixed: 51, cols: [{ key: 'tlLastVc4', label: 'VC4', type: 'num' }, { key: 'tlLastNvc4', label: 'Commercial', type: 'num' }, { key: 'tlLastTotal', label: 'Total', type: 'num' }, { key: 'tlLastAvg', label: 'Daily Avg', type: 'num' }] },
    { key: 'tlCur', title: 'TL · Current Month Issuance', match: /tl'?s current month issuance/i, fixed: 55, cols: [{ key: 'tlCurVc4', label: 'VC4', type: 'num' }, { key: 'tlCurNvc4', label: 'Commercial', type: 'num' }, { key: 'tlCurTotal', label: 'Total', type: 'num' }, { key: 'tlAvgVc4', label: 'VC4 / Day', type: 'num' }, { key: 'tlAvgNvc4', label: 'Commercial / Day', type: 'num' }, { key: 'tlAvgTotal', label: 'Daily Avg (Total)', type: 'num' }] },
    { key: 'tlStatus', title: 'TL Performance Status', match: /tl'?s performance status/i, fixed: 61, cols: [{ key: 'tlGrowth', label: 'Last vs Current', type: 'pct' }, { key: 'tlLastActive', label: 'Last Active', type: 'badge' }, { key: 'tlStatus', label: 'TL Status', type: 'badge' }, { key: 'tlProjected', label: 'Projected (month end)', type: 'num' }] },
    { key: 'agentWise', title: 'Agent Wise (Dispatch)', match: /^agent wise/i, fixed: 65, cols: [{ key: 'agentAvg', label: 'Daily Avg', type: 'num' }, { key: 'agentStockDays', label: 'Stock Days (VC4)', type: 'num' }, { key: 'agentPriority', label: 'Priority Level', type: 'badge' }] },
    { key: 'dispatchComm', title: 'Fastag Dispatch (Commercial) · TL level', match: /dispatch details \(commercial\)/i, fixed: 68, cols: [{ key: 'tlNvc4Days', label: 'TL Commercial Stock Days', type: 'num' }, { key: 'colBR', label: null, type: 'num' }, { key: 'tlCommPriority', label: 'Priority Level', type: 'badge' }, { key: 'tlCommAlert', label: 'Stock Alert', type: 'badge' }] },
    { key: 'device', title: 'Device', match: /^device/i, fixed: 72, cols: [{ key: 'biometric', label: 'Biometric Device' }] },
    { key: 'gvStock', title: 'GV Stock', match: /^gv stock/i, fixed: 73, cols: [{ key: 'gvStockVc4', label: 'VC4', type: 'num' }, { key: 'gvStockNvc4', label: 'Commercial', type: 'num' }] },
    { key: 'gvLast', title: 'GV Issuance · Last Month', match: /gv issuance last month/i, fixed: 75, cols: [{ key: 'gvLast', label: 'Total', type: 'num' }] },
    { key: 'gvCur', title: 'GV Issuance · Current Month', match: /gv issuance current month/i, fixed: 76, cols: [{ key: 'gvCur', label: 'Total', type: 'num' }] }
  ];
  const EMPTY_FILTERS = () => ({ q: '', tl: '', status: '', active: '', alert: '', priority: '', tlPriority: '', commPriority: '', hideZero: false });
  const state = {
    agents: [], filtered: [], tlGroups: [], allTlGroups: [], columns: {}, sections: [], months: { last: 'Last Month', cur: 'Current Month' }, dayLabels: [], daysElapsed: null,
    view: 'overview', filters: EMPTY_FILTERS(),
    sort: { agents: { key: 'curTotal', dir: 'desc' }, tls: { key: 'tlCurTotal', dir: 'desc' } }, page: 1, pageSize: 50, loadedAt: 0, sourceTable: null
  };

  // ---- helpers ------------------------------------------------------------------
  function pct(value) {
    if (value === null || value === undefined || value === '') return null;
    const m = String(value).match(/[-+]?\d+(?:\.\d+)?/);
    if (!m) return null;
    let n = Number(m[0]);
    if (/▼/.test(String(value)) && n > 0) n = -n;
    return n;
  }
  function stripEmoji(text) { return clean(text).replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}▲▼\s]+/u, '').trim(); }
  function tone(text) {
    const t = clean(text);
    if (!t) return 'gray';
    if (/🚀|🟢|▲/.test(t)) return 'green';
    if (/🟡/.test(t)) return 'amber';
    if (/🟠/.test(t)) return 'orange';
    if (/🔴|🔻|▼/.test(t)) return 'red';
    if (/not found/i.test(t)) return 'gray';
    if (/inactive|de-?growth|risk|critical|urgent|high/i.test(t)) return 'red';
    if (/medium|slight/i.test(t)) return 'amber';
    if (/growth|ok|active|yes|low/i.test(t)) return 'green';
    return 'gray';
  }
  function badge(text) {
    const t = clean(text);
    if (!t) return '<span class="dim">—</span>';
    return `<span class="badge ${tone(t)}" title="${esc(t)}">${esc(stripEmoji(t) || t)}</span>`;
  }
  function trend(text) {
    const n = pct(text);
    return n === null ? '<span class="dim">—</span>' : U.deltaHtml(n, { decimals: 0 });
  }
  const fmt = (v, dec) => U.fmt(v, dec ? 1 : 0);
  const prio = (text) => { const t = stripEmoji(text).toLowerCase(); if (/high|urgent|critical/.test(t)) return 'High'; if (/medium|slight/.test(t)) return 'Medium'; if (/low/.test(t)) return 'Low'; return t ? stripEmoji(text) : ''; };
  const norm = (s) => clean(s).toUpperCase().replace(/\s+/g, ' ');
  const canContacts = () => FF.auth.can('contacts');
  const mobileHtml = (m) => (m && !/^na$/i.test(m) && canContacts() ? ` · <a href="tel:${esc(m)}">📞 ${esc(m)}</a>` : '');

  // ---- ingest -------------------------------------------------------------------
  function resolveSchema(sectionRow, subRow) {
    const found = {}, positions = {};
    SCHEMA.forEach((section) => {
      const matches = [];
      sectionRow.forEach((cell, index) => { if (section.match.test(clean(cell))) matches.push(index); });
      const start = matches[section.occurrence || 0] !== undefined ? matches[section.occurrence || 0] : section.fixed;
      positions[section.key] = start;
      if (section.month) {
        const m = clean(sectionRow[start]).match(/performance in\s*-\s*(.+)$/i);
        if (m) state.months[section.key === 'lastMonth' ? 'last' : 'cur'] = m[1].trim();
      }
    });
    state.sections = SCHEMA.map((section) => {
      const start = positions[section.key];
      const cols = section.cols.map((col, offset) => {
        const index = start + offset;
        let label = col.label, unknown = false;
        if (label === '@header') label = clean(subRow[index]) || `Day ${offset}`;
        if (label === null) { const o = clean(LABEL_OVERRIDES[col.key]); if (o) label = o; else { label = `Column ${U.colLetter(index)}`; unknown = true; } }
        const resolved = { key: col.key, index, label, type: col.type || 'text', unknown, section: section.key, letter: U.colLetter(index) };
        found[col.key] = resolved;
        return resolved;
      });
      return { key: section.key, title: section.month ? `${section.title} (${section.key === 'lastMonth' ? state.months.last : state.months.cur})` : section.title, cols };
    });
    state.columns = found;
    state.dayLabels = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((k) => found[k].label);
    const dayMatch = (state.dayLabels[6] || '').match(/(\d{1,2})/);
    state.daysElapsed = dayMatch ? Number(dayMatch[1]) : null;
  }
  function activeCategory(text) {
    const t = clean(text);
    if (!t) return 'other';
    if (/not found/i.test(t)) return 'notfound';
    if (/inactive in month/i.test(t)) return 'inactive-month';
    const m = t.match(/(\d+)\s*days?\s*inactive/i);
    if (m) return Number(m[1]) <= 7 ? 'inactive-7' : 'inactive-8';
    if (/active/i.test(t)) return 'active';
    return 'other';
  }
  function inactiveDays(text) {
    const m = clean(text).match(/(\d+)\s*days?\s*inactive/i);
    if (m) return Number(m[1]);
    if (/inactive in month/i.test(clean(text))) return 99;
    return 0;
  }
  function buildAgents(rows, dataStart) {
    const c = state.columns, agents = [];
    for (let r = dataStart; r < rows.length; r++) {
      const raw = rows[r];
      const get = (key) => clean(raw[c[key].index]);
      if (!get('agentId') && !get('name') && !get('id')) continue;
      if (!get('agentId') && /^(grand\s*)?total$/i.test(get('name') || get('id'))) continue; // totals row
      const agent = { raw, __row: r };
      Object.values(c).forEach((col) => {
        const text = clean(raw[col.index]);
        if (col.type === 'num') agent[col.key] = num(text);
        else if (col.type === 'pct') { agent[col.key] = text; agent[col.key + 'Num'] = pct(text); }
        else agent[col.key] = text;
      });
      agent.week = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((k) => agent[k] || 0);
      agent.weekTotal = agent.week.reduce((a, b) => a + b, 0);
      agent.curTotal = agent.curTotal ?? 0; agent.lastTotal = agent.lastTotal ?? 0;
      agent.curVc4 = agent.curVc4 ?? 0; agent.curNvc4 = agent.curNvc4 ?? 0; agent.lastVc4 = agent.lastVc4 ?? 0; agent.lastNvc4 = agent.lastNvc4 ?? 0;
      agent.hasIssuance = agent.curTotal > 0;
      agent.tlKey = agent.tlId && !/^na$/i.test(agent.tlId) ? agent.tlId : (agent.tlName || 'Unknown');
      agent.tlExcluded = FF.config.isExcludedTl(agent.tlName) || (!agent.tlName && FF.config.isExcludedTl(agent.tlKey));
      agent.isMaster = Boolean(agent.agentId) && agent.agentId === agent.tlId && /apna\s*paye?ment/i.test(agent.name);
      agent.activeCat = activeCategory(agent.lastActive);
      agent.inactiveDays = inactiveDays(agent.lastActive);
      agent.priority = prio(agent.agentPriority);
      agent.searchText = [agent.name, agent.agentId, agent.id, agent.gvIdFound, agent.tlName, agent.tlId, agent.tlMobile].join(' ').toLowerCase();
      agents.push(agent);
    }
    return agents;
  }
  function buildTlGroups(agents, includeExcluded) {
    const map = new Map();
    agents.forEach((agent) => {
      if (agent.tlExcluded && !includeExcluded) return;
      let g = map.get(agent.tlKey);
      if (!g) { g = { tlKey: agent.tlKey, tlId: agent.tlId, tlName: agent.tlName, tlMobile: agent.tlMobile, agents: [], week: [0, 0, 0, 0, 0, 0, 0], source: null, excluded: agent.tlExcluded }; map.set(agent.tlKey, g); }
      g.agents.push(agent);
      agent.week.forEach((v, i) => { g.week[i] += v; });
      if (!g.source || (g.source.tlCurTotal == null && agent.tlCurTotal != null)) g.source = agent;
      if (!g.tlName && agent.tlName) g.tlName = agent.tlName;
      if (!g.tlMobile && agent.tlMobile) g.tlMobile = agent.tlMobile;
    });
    const keys = ['tlStockVc4', 'tlStockNvc4', 'tlStockTotal', 'tlVc4Days', 'tlProjectedB', 'tlPriority', 'tlStockAlert', 'tlLastVc4', 'tlLastNvc4', 'tlLastTotal', 'tlLastAvg', 'tlCurVc4', 'tlCurNvc4', 'tlCurTotal', 'tlAvgVc4', 'tlAvgNvc4', 'tlAvgTotal', 'tlGrowth', 'tlGrowthNum', 'tlLastActive', 'tlStatus', 'tlProjected', 'tlNvc4Days', 'tlCommPriority', 'tlCommAlert'];
    return [...map.values()].map((g) => {
      keys.forEach((k) => { g[k] = g.source ? g.source[k] : null; });
      g.agentCount = g.agents.length; g.activeCount = g.agents.filter((a) => a.hasIssuance).length;
      g.weekTotal = g.week.reduce((a, b) => a + b, 0);
      g.agentCurTotal = U.sum(g.agents, (a) => a.curTotal); g.agentCurVc4 = U.sum(g.agents, (a) => a.curVc4); g.agentCurNvc4 = U.sum(g.agents, (a) => a.curNvc4);
      g.agentLastTotal = U.sum(g.agents, (a) => a.lastTotal); g.agentLastVc4 = U.sum(g.agents, (a) => a.lastVc4); g.agentLastNvc4 = U.sum(g.agents, (a) => a.lastNvc4);
      g.priority = prio(g.tlPriority); g.commPriority = prio(g.tlCommPriority);
      g.searchText = [g.tlName, g.tlId, g.tlMobile].join(' ').toLowerCase();
      return g;
    });
  }
  async function ensureLoaded() {
    const table = await S.need('report');
    if (state.agents.length && state.sourceTable === table) return;
    const rows = D.textRows(table);
    if (table.cols && table.cols.some((c) => /agent profile/i.test(c.label))) {
      rows.unshift(table.cols.map((c) => c.label || ''));
    } else if (table.headers > 0) {
      rows.unshift(table.cols.map((c) => c.label || ''));
    }
    let idx = -1;
    for (let i = 0; i < Math.min(rows.length, 8); i++) if (rows[i].some((cell) => /agent profile/i.test(cell))) { idx = i; break; }
    if (idx < 0) throw new Error('REPORT tab ka header (Agent Profile Details…) nahi mila — sheet structure badal gayi?');
    resolveSchema(rows[idx], rows[idx + 1] || []);
    state.agents = buildAgents(rows, idx + 2);
    if (!state.agents.length) throw new Error('REPORT me koi agent row nahi mili.');
    state.allTlGroups = buildTlGroups(state.agents, false);
    state.sourceTable = table;
    state.loadedAt = Date.now();
  }
  function reset() { state.agents = []; state.sourceTable = null; state.allTlGroups = []; }

  // ---- filters / kpis -------------------------------------------------------------
  function applyFilters() {
    const f = state.filters, q = f.q.trim().toLowerCase();
    state.filtered = state.agents.filter((a) => !(q && !a.searchText.includes(q)) && !(f.tl && a.tlKey !== f.tl && norm(a.tlName) !== norm(f.tl)) && !(f.status && (a.agentStatus || '(blank)') !== f.status) && !(f.active && a.activeCat !== f.active) && !(f.alert && (a.tlStockAlert || '(blank)') !== f.alert) && !(f.priority && a.priority !== f.priority) && !(f.tlPriority && prio(a.tlPriority) !== f.tlPriority) && !(f.commPriority && prio(a.tlCommPriority) !== f.commPriority) && !(f.hideZero && !a.hasIssuance));
    state.tlGroups = buildTlGroups(state.filtered, false);
    state.page = 1;
  }
  const filtersActive = () => { const f = state.filters; return Boolean(f.q || f.tl || f.status || f.active || f.alert || f.priority || f.tlPriority || f.commPriority || f.hideZero); };
  function countBy(list, getter) { const m = new Map(); list.forEach((i) => { const k = getter(i); m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); }
  function kpiData() {
    const list = state.filtered;
    const k = { agents: list.length, active: list.filter((a) => a.hasIssuance).length, curTotal: U.sum(list, (a) => a.curTotal), curVc4: U.sum(list, (a) => a.curVc4), curNvc4: U.sum(list, (a) => a.curNvc4), lastTotal: U.sum(list, (a) => a.lastTotal), lastVc4: U.sum(list, (a) => a.lastVc4), lastNvc4: U.sum(list, (a) => a.lastNvc4), projected: U.sum(list, (a) => a.curProjected), stockTotal: U.sum(list, (a) => a.stockTotal), stockVc4: U.sum(list, (a) => a.stockVc4), stockNvc4: U.sum(list, (a) => a.stockNvc4), wrongVrn: U.sum(list, (a) => a.wrongVrn), week: [0, 0, 0, 0, 0, 0, 0] };
    list.forEach((a) => a.week.forEach((v, i) => { k.week[i] += v; }));
    k.weekTotal = k.week.reduce((a, b) => a + b, 0); k.lastDay = k.week[6];
    k.growth = k.lastTotal > 0 ? (k.projected / k.lastTotal - 1) * 100 : null;
    k.dailyAvg = state.daysElapsed ? k.curTotal / state.daysElapsed : null;
    return k;
  }
  function alertBuckets() {
    const groups = state.tlGroups;
    const isLow = (t) => /risk|critical|low stock|urgent|out of stock|reorder/i.test(clean(t)) && !/stock ok/i.test(clean(t));
    const isOver = (t) => /over ?stock|high stock/i.test(clean(t));
    const lowStock = groups.filter((g) => (g.tlCurTotal || 0) > 0 && (isLow(g.tlStockAlert) || (isLow(g.tlCommAlert) && (g.tlCurNvc4 || 0) > 0))).sort((a, b) => (a.tlVc4Days ?? 9999) - (b.tlVc4Days ?? 9999));
    const overStock = groups.filter((g) => isOver(g.tlStockAlert)).sort((a, b) => (b.tlVc4Days ?? 0) - (a.tlVc4Days ?? 0));
    const dropped = state.filtered.filter((a) => a.lastTotal > 0 && a.inactiveDays >= (FF.config.thresholds.inactiveDays || 3)).sort((a, b) => b.lastTotal - a.lastTotal);
    const deGrowth = state.filtered.filter((a) => /de-?growth/i.test(a.agentStatus || '')).sort((a, b) => (b.lastTotal - (b.curProjected || 0)) - (a.lastTotal - (a.curProjected || 0)));
    const wrongVrn = state.filtered.filter((a) => (a.wrongVrn || 0) > 0).sort((a, b) => b.wrongVrn - a.wrongVrn);
    const highPriority = state.filtered.filter((a) => a.priority === 'High').sort((a, b) => (a.agentStockDays ?? 9999) - (b.agentStockDays ?? 9999));
    return { lowStock, overStock, dropped, deGrowth, wrongVrn, highPriority, total: lowStock.length + overStock.length + deGrowth.length + wrongVrn.length };
  }

  // ---- EIR class split (VC4 / VC20 / VC5+) for a name -------------------------------------------
  function classSplit(nameOrTl, isTl) {
    const rows = S.get('agentClass') || [];
    const daily = S.get('daily') || [];
    const latest = daily.length ? FF.model.latestDate(daily) : null;
    if (!latest) return null;
    const cur = U.ymKey(latest), last = U.prevMonthKey(cur);
    const key = norm(nameOrTl);
    const mine = rows.filter((r) => (isTl ? norm(r.tlName) === key : norm(r.name) === key));
    if (!mine.length) return null;
    const agg = (ym) => { const o = { VC4: 0, VC20: 0, 'VC5+': 0, total: 0, repl: 0 }; mine.filter((r) => r.ym === ym).forEach((r) => { o[r.group] += r.n; o.total += r.n; if (r.type === 'REPLACEMENT') o.repl += r.n; }); return o; };
    return { cur, last, curS: agg(cur), lastS: agg(last), curLabel: U.labelYM(cur), lastLabel: U.labelYM(last), day: latest.getDate() };
  }
  function vsCommercialCard(title, cur, last, labels) {
    const lc = labels || { cur: state.months.cur, last: state.months.last };
    const rows = [['VC4', cur.vc4, last.vc4], ['Commercial', cur.comm, last.comm], ['Total', cur.total, last.total]];
    const share = (v, t) => (t ? U.fmtPct((v / t) * 100, 0) : '—');
    return `<div class="dsec"><h4>${title}</h4>${C.bars({ labels: ['VC4', 'Commercial', 'Total'], height: 150, series: [{ name: lc.last, values: [last.vc4, last.comm, last.total], color: '#c7d2fe' }, { name: lc.cur, values: [cur.vc4, cur.comm, cur.total], color: '#6366f1' }], legendAlways: true })}
      <table class="tbl compact" style="margin-top:10px"><thead><tr><th></th><th class="num">${esc(lc.cur)}</th><th class="num">${esc(lc.last)}</th><th class="num">Growth</th><th class="num">Share (cur)</th></tr></thead><tbody>${rows.map(([l, a, b]) => `<tr><td><b>${l}</b></td><td class="num"><b>${fmt(a)}</b></td><td class="num">${fmt(b)}</td><td class="num">${U.deltaHtml(U.growth(a, b), { decimals: 0 })}</td><td class="num">${share(a, cur.total)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---- table helpers ------------------------------------------------------------------
  const cellMain = (main, sub) => `<div class="cell-main" title="${esc(main)}">${esc(main || '—')}</div>${sub ? `<span class="cell-sub">${esc(sub)}</span>` : ''}`;
  const tlLabel = (a) => (a.tlExcluded ? 'Direct (no TL)' : a.tlName);
  const AGENT_COLUMNS = () => [
    { key: 'name', label: 'Agent', sticky: true, sortValue: (a) => a.name, render: (a) => `${cellMain(a.name, a.agentId || a.id)}${a.isMaster ? '<span class="tag">Master</span>' : ''}` },
    { key: 'tlName', label: 'TL', sortValue: (a) => tlLabel(a), render: (a) => cellMain(tlLabel(a), a.tlExcluded ? '' : a.tlId) },
    { key: 'lastTotal', label: `${state.months.last.slice(0, 3)} total`, num: true, sortValue: (a) => a.lastTotal, render: (a) => `${fmt(a.lastTotal)} <small class="dim">${fmt(a.lastVc4)}/${fmt(a.lastNvc4)}</small>` },
    { key: 'curVc4', label: 'VC4', num: true, sortValue: (a) => a.curVc4, render: (a) => fmt(a.curVc4) },
    { key: 'curNvc4', label: 'Commercial', num: true, sortValue: (a) => a.curNvc4, render: (a) => fmt(a.curNvc4) },
    { key: 'curTotal', label: `${state.months.cur.slice(0, 3)} total`, num: true, strong: true, sortValue: (a) => a.curTotal, render: (a) => `<b>${fmt(a.curTotal)}</b>` },
    { key: 'curProjected', label: 'Projected', num: true, sortValue: (a) => a.curProjected, render: (a) => fmt(a.curProjected) },
    { key: 'avgTotal', label: 'Avg/day', num: true, sortValue: (a) => a.avgTotal, render: (a) => fmt(a.avgTotal, true) },
    { key: 'growth', label: 'Growth', num: true, sortValue: (a) => a.growthNum, render: (a) => trend(a.growth) },
    { key: 'weekTotal', label: '7 days', sortValue: (a) => a.weekTotal, render: (a) => `<span class="spark-wrap">${C.spark(a.week)}<b>${fmt(a.weekTotal)}</b></span>` },
    { key: 'activeDays', label: 'Active days', num: true, sortValue: (a) => a.activeDays, render: (a) => fmt(a.activeDays) },
    { key: 'lastActive', label: 'Last active', sortValue: (a) => a.inactiveDays, render: (a) => badge(a.lastActive) },
    { key: 'agentStatus', label: 'Status', sortValue: (a) => a.agentStatus, render: (a) => badge(a.agentStatus) },
    { key: 'stockTotal', label: 'Stock VC4 / Comm', num: true, sortValue: (a) => a.stockTotal, render: (a) => `<b>${fmt(a.stockVc4)}</b> <small class="dim">/ ${fmt(a.stockNvc4)}</small>` },
    { key: 'agentStockDays', label: 'Stock days', num: true, sortValue: (a) => a.agentStockDays, render: (a) => fmt(a.agentStockDays) },
    { key: 'agentPriority', label: 'Priority', sortValue: (a) => a.agentPriority, render: (a) => badge(a.agentPriority) },
    { key: 'wrongVrn', label: 'Wrong VRN', num: true, sortValue: (a) => a.wrongVrn, render: (a) => (a.wrongVrn ? `<span class="delta down">${fmt(a.wrongVrn)}</span>` : '<span class="dim">0</span>') },
    { key: 'biometric', label: 'Device', sortValue: (a) => a.biometric, render: (a) => badge(a.biometric) }
  ];
  const TL_COLUMNS = () => [
    { key: 'tlName', label: 'Team Leader', sticky: true, sortValue: (g) => g.tlName || g.tlKey, render: (g) => cellMain(g.tlName || g.tlKey, `${g.tlId || ''}${g.tlMobile && !/^na$/i.test(g.tlMobile) && canContacts() ? ` · ${g.tlMobile}` : ''}`) },
    { key: 'agentCount', label: 'Agents (active)', num: true, sortValue: (g) => g.agentCount, render: (g) => `<b>${g.agentCount}</b> <small class="dim">(${g.activeCount})</small>` },
    { key: 'tlLastTotal', label: `${state.months.last.slice(0, 3)} total`, num: true, sortValue: (g) => g.tlLastTotal, render: (g) => `${fmt(g.tlLastTotal)} <small class="dim">${fmt(g.tlLastVc4)}/${fmt(g.tlLastNvc4)}</small>` },
    { key: 'tlCurVc4', label: 'VC4', num: true, sortValue: (g) => g.tlCurVc4, render: (g) => fmt(g.tlCurVc4) },
    { key: 'tlCurNvc4', label: 'Commercial', num: true, sortValue: (g) => g.tlCurNvc4, render: (g) => fmt(g.tlCurNvc4) },
    { key: 'tlCurTotal', label: `${state.months.cur.slice(0, 3)} total`, num: true, sortValue: (g) => g.tlCurTotal, render: (g) => `<b>${fmt(g.tlCurTotal)}</b>` },
    { key: 'tlAvgTotal', label: 'Avg/day', num: true, sortValue: (g) => g.tlAvgTotal, render: (g) => fmt(g.tlAvgTotal, true) },
    { key: 'tlProjected', label: 'Projected', num: true, sortValue: (g) => g.tlProjected, render: (g) => fmt(g.tlProjected) },
    { key: 'tlGrowth', label: 'Growth', num: true, sortValue: (g) => g.tlGrowthNum, render: (g) => trend(g.tlGrowth) },
    { key: 'tlStatus', label: 'TL status', sortValue: (g) => g.tlStatus, render: (g) => badge(g.tlStatus) },
    { key: 'weekTotal', label: '7 days (agents)', sortValue: (g) => g.weekTotal, render: (g) => `<span class="spark-wrap">${C.spark(g.week, '#ec4899')}<b>${fmt(g.weekTotal)}</b></span>` },
    { key: 'tlStockVc4', label: 'Stock VC4 / Comm', num: true, sortValue: (g) => g.tlStockVc4, render: (g) => `<b>${fmt(g.tlStockVc4)}</b> <small class="dim">/ ${fmt(g.tlStockNvc4)}</small>` },
    { key: 'tlVc4Days', label: 'VC4 stock days', num: true, sortValue: (g) => g.tlVc4Days, render: (g) => fmt(g.tlVc4Days) },
    { key: 'tlPriority', label: 'Priority (VC4)', sortValue: (g) => g.tlPriority, render: (g) => badge(g.tlPriority) },
    { key: 'tlStockAlert', label: 'Alert (VC4)', sortValue: (g) => g.tlStockAlert, render: (g) => badge(g.tlStockAlert) },
    { key: 'tlNvc4Days', label: 'Comm stock days', num: true, sortValue: (g) => g.tlNvc4Days, render: (g) => fmt(g.tlNvc4Days) },
    { key: 'tlCommPriority', label: 'Priority (Comm)', sortValue: (g) => g.tlCommPriority, render: (g) => badge(g.tlCommPriority) },
    { key: 'tlCommAlert', label: 'Alert (Comm)', sortValue: (g) => g.tlCommAlert, render: (g) => badge(g.tlCommAlert) }
  ];
  function sortList(list, columns, s) {
    const col = columns.find((c) => c.key === s.key) || columns[0];
    const dir = s.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = col.sortValue(a), vb = col.sortValue(b);
      const na = va === null || va === undefined || va === '', nb = vb === null || vb === undefined || vb === '';
      if (na && nb) return 0; if (na) return 1; if (nb) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }
  function tableHtml(columns, list, s, rowAttr) {
    return `<table class="tbl sticky-first"><thead><tr>${columns.map((c) => `<th class="sortable ${c.num ? 'num' : ''} ${s.key === c.key ? 'sorted' : ''}" data-sort="${c.key}"><span>${esc(c.label)}</span>${s.key === c.key ? `<i>${s.dir === 'asc' ? '▲' : '▼'}</i>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${list.length ? list.map((item) => `<tr ${rowAttr(item)}>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render(item)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="empty">Koi match nahi. Filters clear karke dekho.</td></tr>`}</tbody></table>`;
  }

  // ---- share texts ----------------------------------------------------------------------
  const sig = () => (FF.config.contacts.signature ? `— ${FF.config.contacts.signature}` : '');
  function agentText(a) {
    const cs = classSplit(a.name, false);
    return [`*${FF.config.brand} – Agent Report – ${a.name}*`, `ID ${a.agentId || '—'} · TL ${tlLabel(a) || '—'}`, `${state.months.cur} MTD: *${fmt(a.curTotal)}* (VC4 ${fmt(a.curVc4)} | Commercial ${fmt(a.curNvc4)})`, `${state.months.last}: ${fmt(a.lastTotal)} (VC4 ${fmt(a.lastVc4)} | Commercial ${fmt(a.lastNvc4)}) · Growth ${stripEmoji(a.growth) || '—'}`, cs ? `Class split ${cs.curLabel}: VC4 ${fmt(cs.curS.VC4)} · VC20 ${fmt(cs.curS.VC20)} · VC5+ ${fmt(cs.curS['VC5+'])}` : '', `Projected: ${fmt(a.curProjected)} · Avg/day ${fmt(a.avgTotal, true)} · Active days ${fmt(a.activeDays)}`, `Last 7 days: ${a.week.join(', ')} (total ${fmt(a.weekTotal)})`, `Status: ${stripEmoji(a.agentStatus) || '—'} · ${stripEmoji(a.lastActive) || '—'}`, `Stock: VC4 ${fmt(a.stockVc4)} · Commercial ${fmt(a.stockNvc4)} · Total ${fmt(a.stockTotal)} · ${fmt(a.agentStockDays)} days · Priority ${a.priority || '—'}`, a.wrongVrn ? `Wrong VRN: ${fmt(a.wrongVrn)}` : '', sig()].filter(Boolean).join('\n');
  }
  function tlText(g) {
    const agents = [...g.agents].sort((a, b) => b.curTotal - a.curTotal);
    return [`*${FF.config.brand} – TL Report – ${g.tlName || g.tlKey}*`, `Agents: ${g.agentCount} (${g.activeCount} active)`, `${state.months.cur} MTD: *${fmt(g.tlCurTotal)}* (VC4 ${fmt(g.tlCurVc4)} | Commercial ${fmt(g.tlCurNvc4)}) · ${fmt(g.tlAvgTotal, true)}/day`, `${state.months.last}: ${fmt(g.tlLastTotal)} (VC4 ${fmt(g.tlLastVc4)} | Commercial ${fmt(g.tlLastNvc4)}) · Growth ${stripEmoji(g.tlGrowth) || '—'}`, `Projected: ${fmt(g.tlProjected)} · Status ${stripEmoji(g.tlStatus) || '—'}`, `Stock: VC4 ${fmt(g.tlStockVc4)} (${fmt(g.tlVc4Days)} days · ${stripEmoji(g.tlStockAlert) || '—'} · priority ${g.priority || '—'}) · Commercial ${fmt(g.tlStockNvc4)} (${fmt(g.tlNvc4Days)} days · priority ${g.commPriority || '—'})`, '', '*Top agents*', ...agents.slice(0, 5).map((a, i) => `${i + 1}. ${a.name} – ${fmt(a.curTotal)}`), agents.filter((a) => !a.hasIssuance).length ? `Inactive this month: ${agents.filter((a) => !a.hasIssuance).length}` : '', sig()].filter(Boolean).join('\n');
  }
  function shareButtons(text, subject, phone) {
    if (!FF.auth.can('share')) return '';
    const p = phone && canContacts() ? U.phoneDigits(phone) : '';
    const team = U.phoneDigits(FF.config.contacts.teamWhatsapp);
    return `${p ? `<button class="btn small" data-share="wa" data-phone="${esc(p)}" data-text="${esc(text)}">📲 WhatsApp TL</button>` : ''}<button class="btn small" data-share="wa" data-phone="${esc(team)}" data-text="${esc(text)}">📲 WhatsApp${team ? ' team' : ''}</button>${FF.config.contacts.teamGroupLink ? `<a class="btn small" href="${esc(FF.config.contacts.teamGroupLink)}" target="_blank" rel="noopener">👥 Group</a>` : ''}<button class="btn small" data-share="mail" data-subject="${esc(subject)}" data-text="${esc(text)}">✉️ Email</button><button class="btn small" data-share="copy" data-text="${esc(text)}">📋 Copy</button>`;
  }

  // ---- drawer content -------------------------------------------------------------------
  function valueHtml(col, agent) {
    const raw = clean(agent.raw[col.index]);
    if (col.type === 'badge') return badge(raw);
    if (col.type === 'pct') return trend(raw);
    if (col.type === 'num') return `<b>${fmt(raw, /avg|\/ day/i.test(col.label) && !/days/i.test(col.label))}</b>`;
    return `<b>${esc(raw || '—')}</b>`;
  }
  function openAgent(rowIndex) {
    const agent = state.agents.find((a) => a.__row === rowIndex);
    if (!agent) return;
    const row = (label, html, title) => `<div class="drow"><span title="${esc(title || '')}">${esc(label)}</span>${html}</div>`;
    const cs = classSplit(agent.name, false);
    const summary = `<div class="dsec"><div class="dkpis">
        <div class="dkpi"><small>${esc(state.months.cur)} MTD</small><b>${fmt(agent.curTotal)}</b><span>VC4 ${fmt(agent.curVc4)} · Comm ${fmt(agent.curNvc4)}</span></div>
        <div class="dkpi"><small>${esc(state.months.last)}</small><b>${fmt(agent.lastTotal)}</b><span>VC4 ${fmt(agent.lastVc4)} · Comm ${fmt(agent.lastNvc4)}</span></div>
        <div class="dkpi"><small>Growth</small><b>${trend(agent.growth)}</b><span>Projected ${fmt(agent.curProjected)}</span></div>
        <div class="dkpi"><small>Stock</small><b>${fmt(agent.stockTotal)}</b><span>VC4 ${fmt(agent.stockVc4)} · ${fmt(agent.agentStockDays)} days</span></div>
      </div><div class="badge-row">${badge(agent.agentStatus)}${badge(agent.lastActive)}${agent.agentPriority ? `<span class="dim small">Priority</span>${badge(agent.agentPriority)}` : ''}${agent.biometric ? `<span class="dim small">Device</span>${badge(agent.biometric)}` : ''}</div></div>`;
    const compare = vsCommercialCard(`⚖️ VC4 vs Commercial · ${esc(state.months.last)} → ${esc(state.months.cur)}`, { vc4: agent.curVc4, comm: agent.curNvc4, total: agent.curTotal }, { vc4: agent.lastVc4, comm: agent.lastNvc4, total: agent.lastTotal });
    const classCard = cs ? `<div class="dsec"><h4>🚗 Class split (EIR) · VC4 / VC20 / VC5+ · ${esc(cs.lastLabel)} vs ${esc(cs.curLabel)}</h4>${C.bars({ labels: ['VC4', 'VC20', 'VC5+'], height: 150, series: [{ name: cs.lastLabel, values: [cs.lastS.VC4, cs.lastS.VC20, cs.lastS['VC5+']], color: '#fbcfe8' }, { name: cs.curLabel, values: [cs.curS.VC4, cs.curS.VC20, cs.curS['VC5+']], color: '#ec4899' }], legendAlways: true })}
        <table class="tbl compact" style="margin-top:10px"><thead><tr><th></th><th class="num">VC4</th><th class="num">VC20</th><th class="num">VC5+</th><th class="num">Total</th><th class="num">Replacement</th></tr></thead><tbody><tr><td><b>${esc(cs.curLabel)}</b> (till ${cs.day})</td><td class="num"><b>${fmt(cs.curS.VC4)}</b></td><td class="num"><b>${fmt(cs.curS.VC20)}</b></td><td class="num"><b>${fmt(cs.curS['VC5+'])}</b></td><td class="num"><b>${fmt(cs.curS.total)}</b></td><td class="num">${fmt(cs.curS.repl)}</td></tr><tr><td>${esc(cs.lastLabel)} (full)</td><td class="num">${fmt(cs.lastS.VC4)}</td><td class="num">${fmt(cs.lastS.VC20)}</td><td class="num">${fmt(cs.lastS['VC5+'])}</td><td class="num">${fmt(cs.lastS.total)}</td><td class="num">${fmt(cs.lastS.repl)}</td></tr><tr><td>Growth</td><td class="num">${U.deltaHtml(U.growth(cs.curS.VC4, cs.lastS.VC4), { decimals: 0 })}</td><td class="num">${U.deltaHtml(U.growth(cs.curS.VC20, cs.lastS.VC20), { decimals: 0 })}</td><td class="num">${U.deltaHtml(U.growth(cs.curS['VC5+'], cs.lastS['VC5+']), { decimals: 0 })}</td><td class="num">${U.deltaHtml(U.growth(cs.curS.total, cs.lastS.total), { decimals: 0 })}</td><td></td></tr></tbody></table></div>` : '';
    const stockClasses = ['stockVc4', 'stockC1', 'stockC2', 'stockC3', 'stockC4', 'stockC5'].map((k) => ({ label: state.columns[k].label, value: agent[k] || 0 })).filter((x) => x.value > 0);
    const stockCard = `<div class="dsec"><h4>📦 Stock in hand · ${fmt(agent.stockTotal)} <small class="dim">(VC4 ${fmt(agent.stockVc4)} · Commercial ${fmt(agent.stockNvc4)})</small></h4>${stockClasses.length ? C.bars({ labels: stockClasses.map((x) => x.label), height: 130, series: [{ name: 'Stock', values: stockClasses.map((x) => x.value), color: '#14b8a6' }] }) : '<div class="dim">No stock</div>'}<div class="dgrid" style="margin-top:8px">${row('Stock days (VC4)', `<b>${fmt(agent.agentStockDays)}</b>`)}${row('Priority', badge(agent.agentPriority))}${row('Daily avg', `<b>${fmt(agent.agentAvg, true)}</b>`)}</div></div>`;
    const sections = state.sections.filter((s) => !['profile', 'stock'].includes(s.key)).map((section) => {
      if (section.key === 'week') {
        return `<div class="dsec"><h4>📅 ${esc(section.title)} · total ${fmt(agent.weekTotal)}</h4>${C.bars({ labels: state.dayLabels, height: 130, series: [{ name: 'Issued', values: agent.week, color: '#6366f1' }] })}<div class="dgrid" style="margin-top:8px">${row(section.cols[0].label, `<b>${fmt(agent.activeDays)}</b>`)}</div></div>`;
      }
      return `<details class="dsec collapsible"><summary>${esc(section.title)}</summary><div class="dgrid">${section.cols.map((col) => row(col.label, valueHtml(col, agent), `Sheet column ${col.letter}`)).join('')}</div></details>`;
    }).join('');
    const text = agentText(agent);
    FF.app.openDrawer({ kicker: agent.isMaster ? 'Master account' : 'Agent', title: agent.name || agent.agentId || '—', sub: `ID ${esc(agent.agentId || '—')} · TL ${esc(tlLabel(agent) || '—')}${mobileHtml(agent.tlMobile)}`, actions: `${shareButtons(text, `Agent report · ${agent.name}`, agent.tlMobile)}<a class="btn small" href="#/stock?agent=${encodeURIComponent(agent.name)}">📦 Stock</a><a class="btn small" href="#/trend?agent=${encodeURIComponent(agent.name)}">📈 Trend</a>`, body: summary + compare + classCard + stockCard + sections });
  }
  function openTl(tlKey) {
    const group = state.allTlGroups.find((g) => g.tlKey === tlKey || norm(g.tlName) === norm(tlKey)) || buildTlGroups(state.agents.filter((a) => a.tlKey === tlKey || norm(a.tlName) === norm(tlKey)), true)[0];
    if (!group) return;
    const row = (label, html) => `<div class="drow"><span>${label}</span>${html}</div>`;
    const agents = [...group.agents].sort((a, b) => b.curTotal - a.curTotal);
    const cs = classSplit(group.tlName, true);
    const body = `<div class="dsec"><div class="dkpis">
        <div class="dkpi"><small>${esc(state.months.cur)} MTD</small><b>${fmt(group.tlCurTotal)}</b><span>VC4 ${fmt(group.tlCurVc4)} · Comm ${fmt(group.tlCurNvc4)}</span></div>
        <div class="dkpi"><small>${esc(state.months.last)}</small><b>${fmt(group.tlLastTotal)}</b><span>VC4 ${fmt(group.tlLastVc4)} · Comm ${fmt(group.tlLastNvc4)}</span></div>
        <div class="dkpi"><small>Growth</small><b>${trend(group.tlGrowth)}</b><span>Projected ${fmt(group.tlProjected)} · ${fmt(group.tlAvgTotal, true)}/day</span></div>
        <div class="dkpi"><small>Agents</small><b>${group.agentCount}</b><span>${group.activeCount} active · ${group.agentCount - group.activeCount} inactive</span></div>
      </div><div class="badge-row">${badge(group.tlStatus)}${badge(group.tlLastActive)}<span class="dim small">VC4</span>${badge(group.tlPriority)}${badge(group.tlStockAlert)}<span class="dim small">Comm</span>${badge(group.tlCommPriority)}${badge(group.tlCommAlert)}</div></div>
      ${vsCommercialCard(`⚖️ VC4 vs Commercial · ${esc(state.months.last)} → ${esc(state.months.cur)}`, { vc4: group.tlCurVc4 || 0, comm: group.tlCurNvc4 || 0, total: group.tlCurTotal || 0 }, { vc4: group.tlLastVc4 || 0, comm: group.tlLastNvc4 || 0, total: group.tlLastTotal || 0 })}
      ${cs ? `<div class="dsec"><h4>🚗 Class split (EIR) · VC4 / VC20 / VC5+</h4>${C.bars({ labels: ['VC4', 'VC20', 'VC5+'], height: 140, series: [{ name: cs.lastLabel, values: [cs.lastS.VC4, cs.lastS.VC20, cs.lastS['VC5+']], color: '#fbcfe8' }, { name: cs.curLabel, values: [cs.curS.VC4, cs.curS.VC20, cs.curS['VC5+']], color: '#ec4899' }], legendAlways: true })}<div class="dgrid" style="margin-top:8px">${row(`${esc(cs.curLabel)} (till ${cs.day})`, `<b>${fmt(cs.curS.VC4)} / ${fmt(cs.curS.VC20)} / ${fmt(cs.curS['VC5+'])}</b>`)}${row(`${esc(cs.lastLabel)} (full)`, `<b>${fmt(cs.lastS.VC4)} / ${fmt(cs.lastS.VC20)} / ${fmt(cs.lastS['VC5+'])}</b>`)}</div></div>` : ''}
      <div class="dsec"><h4>📅 Last 7 days (agents) · ${fmt(group.weekTotal)}</h4>${C.bars({ labels: state.dayLabels, height: 130, series: [{ name: 'Issued', values: group.week, color: '#ec4899' }] })}</div>
      <div class="dsec"><h4>📦 Stock & dispatch</h4><div class="dgrid">${row('Stock VC4', `<b>${fmt(group.tlStockVc4)}</b>`)}${row('Stock Commercial', `<b>${fmt(group.tlStockNvc4)}</b>`)}${row('Stock total', `<b>${fmt(group.tlStockTotal)}</b>`)}${row('VC4 stock days', `<b>${fmt(group.tlVc4Days)}</b>`)}${row('Alert (VC4)', badge(group.tlStockAlert))}${row('Priority (VC4)', badge(group.tlPriority))}${row('Comm stock days', `<b>${fmt(group.tlNvc4Days)}</b>`)}${row('Alert (Comm)', badge(group.tlCommAlert))}${row('Priority (Comm)', badge(group.tlCommPriority))}</div></div>
      <div class="dsec"><h4>🧑‍💼 Agents (${agents.length})</h4><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent</th><th class="num">${esc(state.months.cur.slice(0, 3))}</th><th class="num">VC4</th><th class="num">Comm</th><th class="num">7d</th><th>Last active</th><th>Status</th><th>Priority</th></tr></thead><tbody>${agents.map((a) => `<tr data-agent="${a.__row}" class="clickable"><td>${cellMain(a.name, a.agentId)}</td><td class="num"><b>${fmt(a.curTotal)}</b></td><td class="num">${fmt(a.curVc4)}</td><td class="num">${fmt(a.curNvc4)}</td><td class="num">${fmt(a.weekTotal)}</td><td>${badge(a.lastActive)}</td><td>${badge(a.agentStatus)}</td><td>${badge(a.agentPriority)}</td></tr>`).join('')}</tbody></table></div></div>`;
    const text = tlText(group);
    FF.app.openDrawer({ kicker: 'Team Leader', title: group.tlName || group.tlKey, sub: `ID ${esc(group.tlId || group.tlKey)}${mobileHtml(group.tlMobile)} · ${group.agentCount} agents · ${group.activeCount} active`, actions: `${shareButtons(text, `TL report · ${group.tlName || group.tlKey}`, group.tlMobile)}<a class="btn small" href="#/stock?tl=${encodeURIComponent(group.tlName || '')}">📦 Stock</a><a class="btn small" href="#/trend?tl=${encodeURIComponent(group.tlName || '')}">📈 Trend</a>`, body });
  }

  // ---- views ----------------------------------------------------------------------------
  function renderKpis(el) {
    const k = kpiData(), al = alertBuckets();
    el.innerHTML = `<div class="kpi-grid six">
      <div class="kpi g1"><div class="kpi-top"><span class="kpi-title">Agents</span><span class="kpi-icon">🧑‍💼</span></div><div class="kpi-value">${fmt(k.agents)}</div><div class="kpi-foot">Active <b>${fmt(k.active)}</b> · Inactive <b>${fmt(k.agents - k.active)}</b></div></div>
      <div class="kpi g2"><div class="kpi-top"><span class="kpi-title">${esc(state.months.cur)} issued</span><span class="kpi-icon">🏷️</span></div><div class="kpi-value">${fmt(k.curTotal)}</div><div class="kpi-foot">VC4 <b>${fmt(k.curVc4)}</b> · Comm <b>${fmt(k.curNvc4)}</b>${k.dailyAvg !== null ? ` · <b>${fmt(k.dailyAvg, true)}</b>/day` : ''}</div></div>
      <div class="kpi g6"><div class="kpi-top"><span class="kpi-title">Projected vs ${esc(state.months.last)}</span><span class="kpi-icon">🎯</span></div><div class="kpi-value">${fmt(k.projected)}</div><div class="kpi-foot">${esc(state.months.last)} <b>${fmt(k.lastTotal)}</b> · ${U.deltaHtml(k.growth, { decimals: 0 })}</div></div>
      <div class="kpi g5"><div class="kpi-top"><span class="kpi-title">${esc(state.dayLabels[6] || 'Last day')}</span><span class="kpi-icon">⚡</span></div><div class="kpi-value">${fmt(k.lastDay)}</div><div class="kpi-foot">7-day <b>${fmt(k.weekTotal)}</b> · avg <b>${fmt(k.weekTotal / 7, true)}</b>/day</div></div>
      <div class="kpi g9"><div class="kpi-top"><span class="kpi-title">Stock in field</span><span class="kpi-icon">📦</span></div><div class="kpi-value">${fmt(k.stockTotal)}</div><div class="kpi-foot">VC4 <b>${fmt(k.stockVc4)}</b> · Comm <b>${fmt(k.stockNvc4)}</b></div></div>
      <div class="kpi g8"><div class="kpi-top"><span class="kpi-title">Needs attention</span><span class="kpi-icon">🚨</span></div><div class="kpi-value">${fmt(al.total)}</div><div class="kpi-foot">TL stock <b>${al.lowStock.length + al.overStock.length}</b> · De-growth <b>${al.deGrowth.length}</b> · High priority <b>${al.highPriority.length}</b></div></div>
    </div>`;
  }
  function chipBar() {
    const f = state.filters;
    const P = ['High', 'Medium', 'Low'];
    const cnt = (fn) => state.agents.filter(fn).length;
    const tlCnt = (fn) => state.allTlGroups.filter(fn).length;
    const chip = (key, value, label, count, cls) => `<button class="chip ${cls || ''} ${f[key] === value ? 'on' : ''}" data-chip="${key}" data-value="${esc(value)}">${label} <b>${fmt(count)}</b></button>`;
    const statuses = countBy(state.agents, (a) => a.agentStatus || '(blank)').filter(([v]) => v !== '(blank)').slice(0, 7);
    return `<div class="chip-groups">
      <div class="chip-group"><span class="chip-label">Agent priority</span>${P.map((p) => chip('priority', p, `${p === 'High' ? '🔴' : p === 'Medium' ? '🟡' : '🟢'} ${p}`, cnt((a) => a.priority === p), p.toLowerCase())).join('')}</div>
      <div class="chip-group"><span class="chip-label">TL priority · VC4</span>${P.map((p) => chip('tlPriority', p, `${p === 'High' ? '🔴' : p === 'Medium' ? '🟡' : '🟢'} ${p}`, tlCnt((g) => g.priority === p), p.toLowerCase())).join('')}</div>
      <div class="chip-group"><span class="chip-label">TL priority · Commercial</span>${P.map((p) => chip('commPriority', p, `${p === 'High' ? '🔴' : p === 'Medium' ? '🟡' : '🟢'} ${p}`, tlCnt((g) => g.commPriority === p), p.toLowerCase())).join('')}</div>
      <div class="chip-group"><span class="chip-label">Status</span>${statuses.map(([v, c]) => chip('status', v, `<span class="badge ${tone(v)}">${esc(stripEmoji(v))}</span>`, c)).join('')}</div>
      <div class="chip-group"><span class="chip-label">Activity</span>${[['active', '🟢 Active'], ['inactive-7', '🟡 Inactive 1–7d'], ['inactive-8', '🔴 Inactive 8+d'], ['inactive-month', '⚫ Inactive in month']].map(([v, l]) => chip('active', v, l, cnt((a) => a.activeCat === v))).join('')}</div>
    </div>`;
  }
  function distList(entries, total, filterKey) {
    if (!entries.length) return '<div class="empty">No data</div>';
    return `<div class="dist">${entries.map(([label, count, valueOverride]) => {
      const value = valueOverride !== undefined ? valueOverride : label;
      const active = state.filters[filterKey] === value;
      return `<div class="dist-row ${active ? 'on' : ''}" data-chip="${filterKey}" data-value="${esc(value)}"><div class="dist-head">${badge(label)}<b>${fmt(count)}</b></div><div class="hbar-track"><div class="hbar-fill ${tone(label)}" style="width:${total ? (count / total) * 100 : 0}%"></div></div></div>`;
    }).join('')}</div>`;
  }
  function renderOverview(el) {
    const k = kpiData();
    const topN = FF.config.thresholds.topN || 10;
    const topAgents = [...state.filtered].sort((a, b) => b.curTotal - a.curTotal).slice(0, topN);
    const topTls = [...state.tlGroups].sort((a, b) => (b.tlCurTotal || 0) - (a.tlCurTotal || 0)).slice(0, topN);
    const activity = [['active', 'Active'], ['inactive-7', 'Inactive 1–7 days'], ['inactive-8', 'Inactive 8+ days'], ['inactive-month', 'Inactive in month'], ['notfound', 'Not found'], ['other', 'Other']].map(([key, label]) => [label, state.filtered.filter((a) => a.activeCat === key).length, key]).filter((r) => r[1] > 0);
    const shareCur = k.curTotal ? (k.curVc4 / k.curTotal) * 100 : 0, shareLast = k.lastTotal ? (k.lastVc4 / k.lastTotal) * 100 : 0;
    el.innerHTML = `<div class="grid g-2-1">
        <section class="card"><div class="card-head"><h3>⚖️ VC4 vs Commercial · ${esc(state.months.last)} → ${esc(state.months.cur)}</h3><div class="card-right dim">VC4 share ${U.fmtPct(shareLast, 0)} → ${U.fmtPct(shareCur, 0)}</div></div><div class="card-body">
          <div class="grid g-2" style="margin-bottom:0">
            <div>${C.bars({ labels: ['VC4', 'Commercial'], height: 190, series: [{ name: state.months.last, values: [k.lastVc4, k.lastNvc4], color: '#c7d2fe' }, { name: `${state.months.cur} (MTD)`, values: [k.curVc4, k.curNvc4], color: '#6366f1' }], legendAlways: true })}</div>
            <table class="tbl compact"><thead><tr><th></th><th class="num">VC4</th><th class="num">Commercial</th><th class="num">Total</th></tr></thead><tbody>
              <tr><td>${esc(state.months.cur)} MTD</td><td class="num"><b>${fmt(k.curVc4)}</b></td><td class="num"><b>${fmt(k.curNvc4)}</b></td><td class="num"><b>${fmt(k.curTotal)}</b></td></tr>
              <tr><td>${esc(state.months.last)}</td><td class="num">${fmt(k.lastVc4)}</td><td class="num">${fmt(k.lastNvc4)}</td><td class="num">${fmt(k.lastTotal)}</td></tr>
              <tr><td>Growth</td><td class="num">${U.deltaHtml(U.growth(k.curVc4, k.lastVc4), { decimals: 0 })}</td><td class="num">${U.deltaHtml(U.growth(k.curNvc4, k.lastNvc4), { decimals: 0 })}</td><td class="num">${U.deltaHtml(U.growth(k.curTotal, k.lastTotal), { decimals: 0 })}</td></tr>
              <tr><td>Per day (MTD)</td><td class="num">${state.daysElapsed ? fmt(k.curVc4 / state.daysElapsed, true) : '—'}</td><td class="num">${state.daysElapsed ? fmt(k.curNvc4 / state.daysElapsed, true) : '—'}</td><td class="num">${k.dailyAvg !== null ? fmt(k.dailyAvg, true) : '—'}</td></tr>
              <tr><td>Stock in field</td><td class="num">${fmt(k.stockVc4)}</td><td class="num">${fmt(k.stockNvc4)}</td><td class="num">${fmt(k.stockTotal)}</td></tr>
              <tr><td>Stock days</td><td class="num">${state.daysElapsed && k.curVc4 ? fmt(k.stockVc4 / (k.curVc4 / state.daysElapsed)) : '—'}</td><td class="num">${state.daysElapsed && k.curNvc4 ? fmt(k.stockNvc4 / (k.curNvc4 / state.daysElapsed)) : '—'}</td><td class="num">${k.dailyAvg ? fmt(k.stockTotal / k.dailyAvg) : '—'}</td></tr>
            </tbody></table></div></div></section>
        <section class="card"><div class="card-head"><h3>📅 Last 7 days</h3><div class="card-right dim">Total ${fmt(k.weekTotal)} · avg ${fmt(k.weekTotal / 7, true)}/day</div></div><div class="card-body">${C.bars({ labels: state.dayLabels, series: [{ name: 'Issued', values: k.week, color: '#6366f1' }], height: 200 })}</div></section>
      </div>
      <div class="grid g-2">
        <section class="card"><div class="card-head"><h3>⭐ Top agents · ${esc(state.months.cur)}</h3><div class="card-right dim">ghost bar = ${esc(state.months.last)}</div></div><div class="card-body">${C.hbars({ items: topAgents.map((a, i) => ({ label: a.name + (a.isMaster ? ' (Master)' : ''), sub: `${tlLabel(a)} · VC4 ${fmt(a.curVc4)} · Comm ${fmt(a.curNvc4)}`, value: a.curTotal, compare: a.lastTotal, color: C.PALETTE[i % C.PALETTE.length], attr: `data-agent="${a.__row}"` })), valueLabel: state.months.cur, compareLabel: state.months.last })}</div></section>
        <section class="card"><div class="card-head"><h3>🏅 Top TLs · ${esc(state.months.cur)}</h3><div class="card-right dim">APS excluded · ghost bar = ${esc(state.months.last)}</div></div><div class="card-body">${C.hbars({ items: topTls.map((g, i) => ({ label: g.tlName || g.tlKey, sub: `${g.activeCount}/${g.agentCount} active · VC4 ${fmt(g.tlCurVc4)} · Comm ${fmt(g.tlCurNvc4)}`, value: g.tlCurTotal || 0, compare: g.tlLastTotal || 0, color: C.PALETTE[(i + 4) % C.PALETTE.length], attr: `data-tl="${esc(g.tlKey)}"` })), valueLabel: state.months.cur, compareLabel: state.months.last })}</div></section>
      </div>
      <div class="grid g-3">
        <section class="card"><div class="card-head"><h3>🚦 Agent status</h3></div><div class="card-body">${distList(countBy(state.filtered, (a) => a.agentStatus || '(blank)'), state.filtered.length, 'status')}</div></section>
        <section class="card"><div class="card-head"><h3>📦 TL stock alerts (VC4)</h3><div class="card-right dim">${state.tlGroups.length} TLs</div></div><div class="card-body">${distList(countBy(state.tlGroups, (g) => g.tlStockAlert || '(blank)'), state.tlGroups.length, 'alert')}</div></section>
        <section class="card"><div class="card-head"><h3>🕒 Agent activity</h3><div class="card-right dim">Biometric: ${fmt(state.filtered.filter((a) => /^y/i.test(a.biometric || '')).length)} yes</div></div><div class="card-body">${distList(activity, state.filtered.length, 'active')}</div></section>
      </div>`;
  }
  function renderAgents(el) {
    const columns = AGENT_COLUMNS();
    const sorted = sortList(state.filtered, columns, state.sort.agents);
    const pages = Math.max(1, Math.ceil(sorted.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const slice = sorted.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    el.innerHTML = `<section class="card"><div class="card-head"><h3>Agents <span class="dim">${fmt(sorted.length)} of ${fmt(state.agents.length)}${filtersActive() ? ' · filtered' : ''}</span></h3><div class="card-right">${FF.auth.can('export') ? `<button class="btn small" data-act="export-agents">⬇ CSV (all columns)</button><button class="btn small" data-act="export-agents-xlsx">⬇ Excel</button>` : ''}</div></div>
      <div class="table-wrap tall">${tableHtml(columns, slice, state.sort.agents, (a) => `data-agent="${a.__row}" class="clickable"`)}</div>
      <div class="pager center"><button class="btn small" data-act="page" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${state.page} / ${pages} · ${fmt(sorted.length)} agents</span><button class="btn small" data-act="page" data-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''}>Next ›</button><select data-act="pagesize">${[25, 50, 100, 250].map((n) => `<option value="${n}" ${n === state.pageSize ? 'selected' : ''}>${n}/page</option>`).join('')}</select></div></section>`;
    el.__sorted = sorted;
  }
  function renderTls(el) {
    const columns = TL_COLUMNS();
    const sorted = sortList(state.tlGroups, columns, state.sort.tls);
    const direct = state.filtered.filter((a) => a.tlExcluded);
    el.innerHTML = `<section class="card"><div class="card-head"><h3>Team Leaders <span class="dim">${fmt(sorted.length)} TLs · APS / direct agents excluded${direct.length ? ` (${direct.length} direct agents in Agents tab)` : ''}</span></h3><div class="card-right">${FF.auth.can('export') ? `<button class="btn small" data-act="export-tls">⬇ CSV</button>` : ''}</div></div><div class="table-wrap tall">${tableHtml(columns, sorted, state.sort.tls, (g) => `data-tl="${esc(g.tlKey)}" class="clickable"`)}</div></section>`;
    el.__sorted = sorted;
  }
  function renderAlerts(el) {
    const b = alertBuckets(), cap = 100;
    const tlRows = (list, extra) => list.slice(0, cap).map((g) => `<tr data-tl="${esc(g.tlKey)}" class="clickable"><td>${cellMain(g.tlName || g.tlKey, g.tlId)}</td><td class="num">${fmt(g.tlStockVc4)} <small class="dim">/ ${fmt(g.tlStockNvc4)}</small></td><td class="num">${fmt(g.tlAvgTotal, true)}</td><td class="num"><b>${fmt(g.tlVc4Days)}</b></td><td class="num">${fmt(g.tlNvc4Days)}</td><td>${badge(g.tlStockAlert)}</td><td>${badge(g.tlCommAlert)}</td><td>${badge(extra(g))}</td></tr>`).join('');
    const agentRows = (list, valueFn) => list.slice(0, cap).map((a) => `<tr data-agent="${a.__row}" class="clickable"><td>${cellMain(a.name, a.agentId)}</td><td>${cellMain(tlLabel(a), a.tlMobile && !/^na$/i.test(a.tlMobile) && canContacts() ? a.tlMobile : '')}</td><td class="num">${fmt(a.lastTotal)}</td><td class="num">${fmt(a.curTotal)}</td><td class="num"><b>${valueFn(a)}</b></td><td>${badge(a.lastActive)}</td><td>${badge(a.agentStatus)}</td></tr>`).join('');
    const tlHead = (x) => `<thead><tr><th>TL</th><th class="num">Stock VC4 / Comm</th><th class="num">Avg/day</th><th class="num">VC4 days</th><th class="num">Comm days</th><th>Alert (VC4)</th><th>Alert (Comm)</th><th>${x}</th></tr></thead>`;
    const agentHead = (x) => `<thead><tr><th>Agent</th><th>TL</th><th class="num">${esc(state.months.last.slice(0, 3))}</th><th class="num">${esc(state.months.cur.slice(0, 3))}</th><th class="num">${x}</th><th>Last active</th><th>Status</th></tr></thead>`;
    const card = (title, count, tone, body, sub, name) => `<section class="card"><div class="card-head"><h3>${title} <span class="count ${tone}">${fmt(count)}</span></h3><div class="card-right dim">${sub || ''}${count && FF.auth.can('export') ? ` <button class="btn small" data-action="export" data-name="${name}">⬇ CSV</button>` : ''}</div></div>${count ? `<div class="table-wrap tall">${body}</div>` : '<div class="card-body empty">Sab theek hai — koi entry nahi.</div>'}</section>`;
    el.innerHTML = `${card('🔴 High priority agents · dispatch', b.highPriority.length, 'red', `<table class="tbl">${agentHead('Stock days')}<tbody>${agentRows(b.highPriority, (a) => fmt(a.agentStockDays))}</tbody></table>`, 'Agent priority "High" · sorted by lowest stock days', 'high-priority-agents')}
      ${card('🚨 Dispatch needed · TL stock risk', b.lowStock.length, 'red', `<table class="tbl">${tlHead('Priority')}<tbody>${tlRows(b.lowStock, (g) => g.tlPriority)}</tbody></table>`, 'Active TLs jinka VC4 (ya Commercial) stock alert risk dikha raha hai', 'tl-stock-risk')}
      ${card('🧊 Over-stocked TLs', b.overStock.length, 'amber', `<table class="tbl">${tlHead('TL status')}<tbody>${tlRows(b.overStock, (g) => g.tlStatus)}</tbody></table>`, 'Stock zaroorat se zyada — dispatch hold', 'tl-over-stock')}
      ${card('📉 De-growth agents', b.deGrowth.length, 'red', `<table class="tbl">${agentHead('Projected')}<tbody>${agentRows(b.deGrowth, (a) => fmt(a.curProjected))}</tbody></table>`, `Status "De-Growth" · sorted by biggest drop vs ${esc(state.months.last)}`, 'de-growth-agents')}
      ${card(`😶 Went quiet · ${esc(state.months.last)} me issue kiya, ab ${FF.config.thresholds.inactiveDays || 3}+ din inactive`, b.dropped.length, 'amber', `<table class="tbl">${agentHead('Inactive days')}<tbody>${agentRows(b.dropped, (a) => (a.inactiveDays >= 99 ? 'Month' : String(a.inactiveDays)))}</tbody></table>`, 'TL follow-up list', 'went-quiet-agents')}
      ${card('🔖 Wrong VRN entries', b.wrongVrn.length, 'amber', `<table class="tbl">${agentHead('Wrong VRN')}<tbody>${agentRows(b.wrongVrn, (a) => fmt(a.wrongVrn))}</tbody></table>`, 'Is month wrong vehicle numbers wale agents', 'wrong-vrn-agents')}`;
  }

  // ---- page ------------------------------------------------------------------------------
  async function render(root, params) {
    if (params.view && ['overview', 'agents', 'tls', 'alerts'].includes(params.view)) state.view = params.view;
    if (params.tl !== undefined) state.filters.tl = params.tl;
    if (params.q !== undefined) state.filters.q = '';
    root.innerHTML = `<div class="page-head"><div><h1>🏆 Performance</h1><p class="sub" id="pf-sub">REPORT tab se agent & TL performance…</p></div>
      <div class="head-actions">${FF.auth.can('share') ? '<button class="btn" data-act="share">📲 WhatsApp summary</button><button class="btn" data-act="mail">✉️ Email summary</button>' : ''}<button class="btn primary" data-action="refresh">↻ Refresh</button>${FF.auth.can('sheet:REPORT') ? '<a class="btn" href="#/sheet/REPORT">Full REPORT sheet →</a>' : ''}</div></div>
      <div id="pf-body">${U.spinner('REPORT tab load ho raha hai…')}</div>`;
    try { await ensureLoaded(); await Promise.allSettled([S.need('agentClass'), S.need('daily')]); } catch (err) { U.$('#pf-body', root).innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    applyFilters();
    const body = U.$('#pf-body', root);
    U.$('#pf-sub', root).textContent = `${state.months.cur} report · ${state.agents.length} agents · ${state.allTlGroups.length} TLs · loaded ${U.timeLabel(state.loadedAt)}`;
    const tlOpts = () => [...state.allTlGroups].sort((a, b) => (a.tlName || '').localeCompare(b.tlName || ''));
    body.innerHTML = `<div class="card controls finder"><div class="finder-row"><div class="finder-input"><span class="finder-ico">🔎</span><input class="input" id="pf-find" placeholder="Quick find: agent / TL naam type karo → click karte hi poora profile (charts, VC4 vs Commercial, last vs current)…"></div><span class="ctrl-note dim">Enter = pehla match · list se click karo</span></div></div>
      <div id="pf-kpis"></div>
      <div class="card controls"><div class="seg" id="pf-tabs">${[['overview', '🏠 Overview'], ['agents', '🧑‍💼 Agents'], ['tls', '👥 TLs'], ['alerts', '🚨 Alerts']].map(([k, l]) => `<button class="seg-btn ${state.view === k ? 'on' : ''}" data-view="${k}">${l}</button>`).join('')}</div>
        <div class="ctrl-row"><input class="input" id="pf-q" placeholder="Filter list: agent / ID / TL / mobile…" value="${esc(state.filters.q)}">
          <label>TL <select id="pf-tl"><option value="">All TLs</option>${tlOpts().map((t) => `<option value="${esc(t.tlKey)}" ${t.tlKey === state.filters.tl || norm(t.tlName) === norm(state.filters.tl) ? 'selected' : ''}>${esc(t.tlName || t.tlKey)} · ${t.agentCount}</option>`).join('')}</select></label>
          <label>Stock alert <select id="pf-alert"><option value="">All</option>${countBy(state.agents, (a) => a.tlStockAlert || '(blank)').map(([v, c]) => `<option value="${esc(v)}" ${v === state.filters.alert ? 'selected' : ''}>${esc(v)} · ${c}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" id="pf-hidezero" ${state.filters.hideZero ? 'checked' : ''}> Hide 0-issuance</label>
          <button class="btn small" id="pf-clear">✕ Clear</button></div>
        <div id="pf-chips">${chipBar()}</div></div>
      <div id="pf-view"></div>`;
    const kpisEl = U.$('#pf-kpis', body), viewEl = U.$('#pf-view', body);
    const draw = () => {
      renderKpis(kpisEl);
      U.$('#pf-chips', body).innerHTML = chipBar();
      U.$$('#pf-tabs .seg-btn', body).forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
      if (state.view === 'overview') renderOverview(viewEl); else if (state.view === 'agents') renderAgents(viewEl); else if (state.view === 'tls') renderTls(viewEl); else renderAlerts(viewEl);
    };
    const refilter = () => { applyFilters(); draw(); };
    // quick find (dropdown)
    const findItems = () => {
      const items = [];
      state.allTlGroups.forEach((g) => items.push({ kind: 'tl', kindLabel: 'TL', label: g.tlName || g.tlKey, sub: `${g.agentCount} agents · ${state.months.cur.slice(0, 3)} ${fmt(g.tlCurTotal)}`, keywords: `${g.tlId} ${g.tlMobile}`, key: g.tlKey }));
      [...state.agents].sort((a, b) => b.curTotal - a.curTotal).forEach((a) => items.push({ kind: 'agent', kindLabel: 'Agent', label: a.name, sub: `${tlLabel(a)} · ${state.months.cur.slice(0, 3)} ${fmt(a.curTotal)} · ID ${a.agentId}`, keywords: `${a.agentId} ${a.id}`, badge: a.priority ? `${a.priority} priority` : '', row: a.__row }));
      return items;
    };
    const pickFind = (it) => {
      if (it.label && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('Performance Find', it.label);
      if (it.kind === 'tl') openTl(it.key); else openAgent(it.row);
    };
    const findInput = U.$('#pf-find', body);
    U.suggest(findInput, { items: findItems, max: 14, onPick: pickFind, onEnter: (q) => { if (q && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('Performance Find', q); const all = findItems(); const hit = all.find((i) => norm(i.label) === norm(q)) || all.find((i) => norm(i.label).includes(norm(q))); if (hit) pickFind(hit); else U.toast('Koi agent / TL match nahi hua', 'err'); } });
    if (params.q) { findInput.value = params.q; const all = findItems(); const hit = all.find((i) => norm(i.label) === norm(params.q)) || all.find((i) => norm(i.label).includes(norm(params.q))); if (hit) setTimeout(() => pickFind(hit), 50); }
    U.$('#pf-q', body).addEventListener('input', U.debounce((e) => {
      state.filters.q = e.target.value;
      if (state.filters.q && FF.notifications && FF.notifications.logSearch) {
        FF.notifications.logSearch('Performance Filter', state.filters.q);
      }
      refilter();
    }, 400));
    [['pf-tl', 'tl'], ['pf-alert', 'alert']].forEach(([id, key]) => U.$(`#${id}`, body).addEventListener('change', (e) => { state.filters[key] = e.target.value; refilter(); }));
    U.$('#pf-hidezero', body).addEventListener('change', (e) => { state.filters.hideZero = e.target.checked; refilter(); });
    U.$('#pf-clear', body).addEventListener('click', () => { state.filters = EMPTY_FILTERS(); U.$('#pf-q', body).value = ''; ['pf-tl', 'pf-alert'].forEach((id) => { U.$(`#${id}`, body).value = ''; }); U.$('#pf-hidezero', body).checked = false; refilter(); });
    body.addEventListener('click', (e) => {
      const tab = e.target.closest('#pf-tabs .seg-btn');
      if (tab) { state.view = tab.dataset.view; history.replaceState(null, '', `#/performance?view=${state.view}`); draw(); return; }
      const agentEl = e.target.closest('[data-agent]');
      if (agentEl) { openAgent(Number(agentEl.dataset.agent)); return; }
      const tlEl = e.target.closest('[data-tl]');
      if (tlEl) { openTl(tlEl.dataset.tl); return; }
      const chip = e.target.closest('[data-chip]');
      if (chip) {
        const key = chip.dataset.chip, value = chip.dataset.value;
        state.filters[key] = state.filters[key] === value ? '' : value;
        const sel = U.$(`#pf-${key}`, body); if (sel) sel.value = state.filters[key];
        if (state.filters[key]) state.view = ['tlPriority', 'commPriority', 'alert'].includes(key) ? 'tls' : 'agents';
        refilter(); return;
      }
      const th = e.target.closest('th.sortable');
      if (th) { const t = state.view === 'tls' ? 'tls' : 'agents'; const s = state.sort[t]; const cols = t === 'tls' ? TL_COLUMNS() : AGENT_COLUMNS(); if (s.key === th.dataset.sort) s.dir = s.dir === 'asc' ? 'desc' : 'asc'; else { s.key = th.dataset.sort; const col = cols.find((c) => c.key === s.key); s.dir = col && (col.num || /Total|Count/.test(s.key)) ? 'desc' : 'asc'; } draw(); return; }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'page') { state.page = Number(act.dataset.page); draw(); viewEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      if (act.dataset.act === 'export-agents' || act.dataset.act === 'export-agents-xlsx') {
        if (!FF.auth.can('export')) return U.toast('Download permission nahi hai', 'err');
        const cols = state.sections.flatMap((s) => s.cols);
        const header = cols.map((c) => `${c.label}${c.unknown ? ` (${c.letter})` : ''}`);
        const rows = (viewEl.__sorted || state.filtered).map((a) => cols.map((c) => { const v = clean(a.raw[c.index]); return c.type === 'num' && num(v) !== null ? num(v) : v; }));
        if (act.dataset.act === 'export-agents') U.downloadCsv(`agents-report-${U.stamp()}.csv`, header, rows); else FF.xlsx.download(`agents-report-${U.stamp()}.xlsx`, [{ name: 'Agents', header, rows }, { name: 'TLs', header: TL_COLUMNS().map((c) => c.label), rows: state.tlGroups.map((g) => TL_COLUMNS().map((c) => { const v = c.sortValue(g); return v === null || v === undefined ? '' : v; })) }]);
        U.toast('Agents export ready', 'ok');
      }
      if (act.dataset.act === 'export-tls') { if (!FF.auth.can('export')) return U.toast('Download permission nahi hai', 'err'); const cols = TL_COLUMNS(); U.downloadCsv(`tl-summary-${U.stamp()}.csv`, cols.map((c) => c.label), (viewEl.__sorted || state.tlGroups).map((g) => cols.map((c) => { const v = c.sortValue(g); return v === null || v === undefined ? '' : v; }))); U.toast('TL CSV exported'); }
      if (act.dataset.act === 'share') shareSummary('wa');
      if (act.dataset.act === 'mail') shareSummary('mail');
    });
    body.addEventListener('change', (e) => { if (e.target.matches('[data-act="pagesize"]')) { state.pageSize = Number(e.target.value); state.page = 1; draw(); } });
    draw();
  }
  function summaryText() {
    const k = kpiData(), al = alertBuckets();
    const topTls = [...state.tlGroups].sort((a, b) => (b.tlCurTotal || 0) - (a.tlCurTotal || 0)).slice(0, 5);
    const topAgents = [...state.filtered].filter((a) => !a.isMaster).sort((a, b) => b.curTotal - a.curTotal).slice(0, 5);
    return [`*${FF.config.brand} – Agent Report – ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}*${filtersActive() ? ' (filtered)' : ''}`,
      `${state.dayLabels[6] || 'Last day'}: *${fmt(k.lastDay)}* tags`, `Last 7 days: ${fmt(k.weekTotal)} (avg ${fmt(k.weekTotal / 7, true)}/day)`,
      `${state.months.cur} MTD: *${fmt(k.curTotal)}* (VC4 ${fmt(k.curVc4)} | Commercial ${fmt(k.curNvc4)})`, `${state.months.last}: ${fmt(k.lastTotal)} (VC4 ${fmt(k.lastVc4)} | Commercial ${fmt(k.lastNvc4)})`, `Projected: ${fmt(k.projected)} (${k.growth === null ? '—' : U.fmtSigned(k.growth, 0)} vs ${state.months.last})`,
      `Active agents: ${fmt(k.active)} / ${fmt(k.agents)}`, `Stock in field: ${fmt(k.stockTotal)} (VC4 ${fmt(k.stockVc4)} | Commercial ${fmt(k.stockNvc4)})`, `Alerts: ${al.highPriority.length} high-priority agents, ${al.lowStock.length} TL stock risk, ${al.overStock.length} over-stocked, ${al.deGrowth.length} de-growth`, '',
      `*Top TLs (${state.months.cur})*`, ...topTls.map((g, i) => `${i + 1}. ${g.tlName || g.tlKey} – ${fmt(g.tlCurTotal || 0)}`), '', '*Top Agents*', ...topAgents.map((a, i) => `${i + 1}. ${a.name} – ${fmt(a.curTotal)}`), sig()].filter((l) => l !== null).join('\n');
  }
  async function shareSummary(kind) {
    if (!FF.auth.can('share')) return U.toast('Share permission nahi hai', 'err');
    const text = summaryText();
    if (kind === 'mail') { location.href = U.mailLink(`${FF.config.brand} · Performance summary`, text, FF.config.contacts.teamEmail); return; }
    await U.copyText(text);
    window.open(U.waLink(text, FF.config.contacts.teamWhatsapp), '_blank', 'noopener');
    U.toast('Summary copied — WhatsApp khul raha hai');
  }

  FF.pages.performance = { title: 'Performance', render, openAgent, openTl, reset, agents: () => state.agents };
})(window.FF);
