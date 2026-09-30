/* GV Partner data layer — the second Google Sheet ("Tag Issued Report"):
     • GV Master      → issuance log (unique_id, agent, supervisor/TL, class, tag, date, status…)
     • Tag Assignment → stock in field (~60k rows, aggregated by Google via group-by queries)
     • GV REPORT      → agent-wise performance + stock summary (header row 4, columns A…BE)
   Everything is preloaded ONCE after login (like FF.store) and refreshed only on ↻ / reload.
   Field mapping lives in FF.config.gv (Settings → Data source → GV Partner). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const D = FF.data;

  const cfgGv = () => FF.config.gv || {};
  const masterCfg = () => cfgGv().master || {};
  const assignCfg = () => cfgGv().assignment || {};
  const reportCfg = () => cfgGv().report || {};

  // ---- class helpers -----------------------------------------------------------------------------
  /** "5" / "VC5" / "vc 5" → "VC5" */
  function normClass(raw) {
    const c = U.clean(raw).toUpperCase().replace(/\s+/g, '');
    if (!c) return 'NA';
    if (/^\d+$/.test(c)) return `VC${c}`;
    if (/^VC\d+$/.test(c)) return c;
    return c;
  }
  const classGroup = (cls) => {
    const c = normClass(cls);
    if (c === 'VC4') return 'VC4';
    if (c === 'VC20') return 'VC20';
    return 'VC5+';
  };
  const clsNum = (c) => parseInt(String(c).replace(/\D/g, ''), 10) || 999;
  const isHeaderRow = (row) => row.some((v) => /^(AGENT_ID|UNIQUE_ID|TAG_ID|VEHICLE_CLASS)$/i.test(U.clean(v)));

  // ---- store -------------------------------------------------------------------------------------
  const DATASETS = {
    master: { label: 'GV Master · issuance' },
    stockClass: { label: 'Tag Assignment · class mix' },
    stockTl: { label: 'Tag Assignment · TL-wise stock' },
    stockTlClass: { label: 'Tag Assignment · TL × class' },
    stockAgent: { label: 'Tag Assignment · agent-wise stock' },
    stockAgentClass: { label: 'Tag Assignment · agent × class' },
    report: { label: 'GV REPORT · performance' }
  };
  const state = { data: {}, errors: {}, loading: false, loadedAt: null, progress: { done: 0, total: 0 }, promise: null };

  /** Which datasets this user actually needs (permission aware). */
  function wanted() {
    const can = (p) => FF.auth.can(p);
    const pages = ['home', 'executive', 'forecast', 'dataQuality', 'tagIssued', 'gvDashboard', 'gvTrend', 'gvStock', 'gvPerformance', 'gvCommission', 'dualChannel', 'compare'];
    const anyPage = pages.some(can);
    const list = [];
    if (anyPage || can('sheet:GV Master')) list.push('master');
    if (can('gvStock') || can('gvDashboard') || can('gvCommission') || can('dualChannel') || can('forecast') || can('dataQuality') || can('compare') || can('sheet:Tag Assignment')) list.push('stockClass', 'stockTl', 'stockTlClass', 'stockAgent', 'stockAgentClass');
    if (can('gvPerformance') || can('gvDashboard') || can('gvCommission') || can('dualChannel') || can('forecast') || can('executive') || can('compare') || can('sheet:GV REPORT')) list.push('report');
    return list.length ? list : (anyPage ? Object.keys(DATASETS) : []);
  }
  /** True when this user can see anything from the GV sheet. */
  function enabled() {
    return ['home', 'executive', 'forecast', 'dataQuality', 'tagIssued', 'gvDashboard', 'gvTrend', 'gvStock', 'gvPerformance', 'gvCommission', 'dualChannel', 'compare'].some((p) => FF.auth.can(p))
      || !!FF.config.tabBy('GV Master') && FF.auth.can('sheet:' + (FF.config.tabBy('GV Master') || {}).id);
  }

  let generation = 0;
  const jobs = new Map();
  function loadKey(key, fresh) {
    if (jobs.has(key)) return jobs.get(key);
    const version = generation;
    const p = Promise.resolve().then(() => LOADERS[key]({ fresh })).then((value) => {
      if (version === generation) { state.data[key] = value; delete state.errors[key]; }
      return value;
    }).catch((err) => {
      if (version === generation) state.errors[key] = err;
      throw err;
    }).finally(() => {
      if (version !== generation) return;
      jobs.delete(key);
      state.progress.done++;

    });
    jobs.set(key, p);
    return p;
  }
  // ⚡ Pehle GV Master (aaj ka live number usi se aata hai), phir baaki GV datasets — 3 workers.
  const PRIORITY = ['master', 'report', 'stockClass', 'stockAgent', 'stockTl', 'stockTlClass', 'stockAgentClass'];
  const LOAD_WORKERS = 3;
  async function runQueue(keys, fresh) {
    const queue = keys.slice();
    const workers = Array.from({ length: Math.max(1, Math.min(LOAD_WORKERS, queue.length)) }, async () => {
      while (queue.length) { const key = queue.shift(); await loadKey(key, !!fresh).catch(() => {}); }
    });
    await Promise.all(workers);
  }
  function preload(fresh, only) {
    if (state.loading) return state.promise;
    if (state.promise && !fresh && !Object.keys(state.errors).length) return state.promise;
    const all = (only && only.length ? only : wanted()).filter((k) => DATASETS[k]);
    const keys = [...PRIORITY.filter((k) => all.includes(k)), ...all.filter((k) => !PRIORITY.includes(k))];
    const version = generation;
    state.loading = true; state.errors = {}; state.progress = { done: 0, total: keys.length };

    state.promise = runQueue(keys, fresh).then(() => {
      if (version === generation) {
        state.loading = false; state.loadedAt = Date.now();

      }
      return state.data;
    });
    return state.promise;
  }
  function get(key) { return state.data[key]; }
  function error(key) { return state.errors[key]; }
  async function need(key) {
    // A slow unrelated stock/report query must not block this page.
    if (state.data[key] !== undefined) return state.data[key];
    if (!state.promise) preload(false);
    return loadKey(key, false);
  }
  /** ⚡ Sirf chune hue GV datasets fresh load karo (aaj ka number = master). */
  async function refresh(keys) {
    const list = ((keys && keys.length) ? keys : ['master']).filter((k) => DATASETS[k]);
    await runQueue(list, true);
    state.loadedAt = Date.now();
    return state;
  }
  function reset() {
    generation++; jobs.clear(); state.loading = false; state.promise = null;
    state.data = {}; state.errors = {}; state.loadedAt = null; D.clearCache();
  }

  // ---- loaders -----------------------------------------------------------------------------------
  /** GV Master (issuance log) — small tab, loaded fully so every page can aggregate in memory. */
  async function loadMaster(opts) {
    const m = masterCfg();
    const gid = m.gid || (FF.config.tabBy('GV Master') || {}).gid || '';
    const t = await D.query('GV Master', '', { ...opts, gid });
    const rows = [];
    for (const r of t.rows) {
      const get = (letter) => D.cellText(r[U.colIndex(letter)]);
      const agentId = U.clean(get(m.uniqueId));
      if (!agentId || /^unique_id$/i.test(agentId)) continue;
      const date = D.cellDate(r[U.colIndex(m.date)]);
      const rawCls = get(m.cch) || get(m.vClass);
      const cls = normClass(rawCls);
      const commissionRaw = D.cellText(r[U.colIndex(m.commission)]);
      const tlId = U.clean(get(m.tlId));
      const rawTlName = U.clean(get(m.tlName));
      const agentName = U.clean(get(m.agentName)) || agentId;
      const tlName = rawTlName || (tlId ? `TL ${tlId}` : 'Direct');
      rows.push({
        date, ym: date ? U.ymKey(date) : '', day: date ? date.getDate() : 0,
        agentId, agentName,
        tlId, tlName,
        // 🧍 GV direct rule: TL ID + TL Name dono khaali (ya agent hi apna supervisor) → direct agent.
        directAgent: FF.config.isDirectAgent({ agentId, agentName, tlId, tlName: rawTlName, channel: 'GV Partner' }, 'gv'),
        channel: 'GV Partner',
        cls, group: classGroup(cls),
        status: U.clean(get(m.status)) || 'Issuance',
        tagType: U.clean(get(m.tagType)) || 'Other',
        tagId: U.clean(get(m.tagId)), vrn: U.clean(get(m.vrn)), serial: U.clean(get(m.serial)),
        customer: U.clean(get(m.customer)), productId: U.clean(get(m.productId)),
        amount: D.cellNumber(r[U.colIndex(m.amount)]) || 0,
        commission: D.cellNumber(r[U.colIndex(m.commission)]) || 0,
        commissionHasValue: commissionRaw !== '',
        gvUniqueId: U.clean(get(m.gvUniqueId)), gvUniqueName: U.clean(get(m.gvUniqueName)),
        monthName: U.clean(get(m.monthName)), time: U.clean(get(m.time))
      });
    }
    rows.sort((a, b) => (a.date && b.date ? a.date - b.date : 0));
    return rows;
  }

  /** Tag Assignment: class mix. */
  async function loadStockClass(opts) {
    const a = assignCfg();
    const t = await D.query('Tag Assignment', `select ${a.cls}, count(${a.tagId}) group by ${a.cls}`, opts);
    return t.rows.map((r) => ({ cls: normClass(D.cellText(r[0])), group: classGroup(D.cellText(r[0])), n: D.cellNumber(r[1]) || 0 }))
      .filter((r) => r.n && !/^(NA|CLASS)$/i.test(r.cls))
      .sort((x, y) => clsNum(x.cls) - clsNum(y.cls));
  }
  /** Tag Assignment: TL-wise stock. */
  async function loadStockTl(opts) {
    const a = assignCfg();
    const t = await D.query('Tag Assignment', `select ${a.tlId}, ${a.tlName}, count(${a.tagId}) group by ${a.tlId}, ${a.tlName} order by count(${a.tagId}) desc`, opts);
    return t.rows.map((r) => ({ tlId: D.cellText(r[0]), tlName: U.clean(D.cellText(r[1])), n: D.cellNumber(r[2]) || 0 }))
      .filter((r) => r.n && !isHeaderRow([r.tlId, r.tlName]))
      .map((r) => {
        const tlName = r.tlName || (U.clean(r.tlId) ? `TL ${U.clean(r.tlId)}` : 'Unassigned');
        return { ...r, tlName, channel: 'GV Partner', directAgent: !U.clean(r.tlName) && !U.clean(r.tlId), isRealTl: FF.config.isRealTl(tlName) };
      });
  }
  /** Tag Assignment: TL × class. */
  async function loadStockTlClass(opts) {
    const a = assignCfg();
    const t = await D.query('Tag Assignment', `select ${a.tlName}, ${a.cls}, count(${a.tagId}) group by ${a.tlName}, ${a.cls}`, opts);
    return t.rows.map((r) => ({ tlName: U.clean(D.cellText(r[0])) || 'Unassigned', cls: normClass(D.cellText(r[1])), group: classGroup(D.cellText(r[1])), n: D.cellNumber(r[2]) || 0 }))
      .filter((r) => r.n && !isHeaderRow([r.tlName, r.cls]));
  }
  /** Tag Assignment: agent-wise stock. */
  async function loadStockAgent(opts) {
    const a = assignCfg();
    const t = await D.query('Tag Assignment', `select ${a.agentId}, ${a.agentName}, ${a.tlId}, ${a.tlName}, count(${a.tagId}) group by ${a.agentId}, ${a.agentName}, ${a.tlId}, ${a.tlName} order by count(${a.tagId}) desc`, opts);
    return t.rows.map((r) => {
      const agentId = U.clean(D.cellText(r[0])), agentName = U.clean(D.cellText(r[1])) || U.clean(D.cellText(r[0]));
      const tlId = U.clean(D.cellText(r[2])), tlName = U.clean(D.cellText(r[3]));
      return {
        agentId, agentName, tlId, tlName: tlName || (tlId ? `TL ${tlId}` : 'Direct'), n: D.cellNumber(r[4]) || 0,
        channel: 'GV Partner',
        directAgent: FF.config.isDirectAgent({ agentId, agentName, tlId, tlName, channel: 'GV Partner' }, 'gv')
      };
    })
      .filter((r) => r.n && !isHeaderRow([r.agentId, r.agentName]));
  }
  /** Tag Assignment: agent × class. */
  async function loadStockAgentClass(opts) {
    const a = assignCfg();
    const t = await D.query('Tag Assignment', `select ${a.agentName}, ${a.cls}, count(${a.tagId}) group by ${a.agentName}, ${a.cls}`, opts);
    return t.rows.map((r) => ({ agentName: U.clean(D.cellText(r[0])), cls: normClass(D.cellText(r[1])), group: classGroup(D.cellText(r[1])), n: D.cellNumber(r[2]) || 0 }))
      .filter((r) => r.n && !isHeaderRow([r.agentName, r.cls]));
  }

  /**
   * GV REPORT (agent-wise). Fetched with an explicit `range` (A<headerRow>:BE) so the messy top rows
   * of the tab are skipped and row 4 becomes the header row. The column order below was verified
   * against the live tab; if the partner moves columns, change FF.config.gv.report.headerRow / columns.
   */
  const REPORT_COLS = {
    mobile: 0, agentId: 1, agentName: 2, tlId: 3, tlName: 4,
    stockVc12: 5, stockVc16: 6, stockVc4: 7, stockVc5: 8, stockVc6: 9, stockVc7: 10, stockTotal: 11, stockComm: 12,
    minRequired: 13, suggestedDispatch: 14, priority: 15,
    tlStockVc4: 16, tlStockComm: 17, tlStockTotal: 18,
    lastDays: 19, lastVc4: 20, lastComm: 21, lastTotal: 22, growthText: 23, agentStatus: 24, agentPerf: 25,
    todayIssued: 26, curDays: 27, replace: 28, chassis: 29,
    curVc4: 30, curVc5: 31, curVc6: 32, curVc7: 33, curVc12: 34, curVc16: 35, curComm: 36, curTotal: 37,
    expected: 38, runrateVc4: 39, runrateComm: 40, runrate: 41,
    tlLastVc4: 42, tlLastComm: 43, tlLastTotal: 44, tlCurVc4: 45, tlCurComm: 46, tlCurTotal: 47,
    avgRunrateVc4: 48, avgRunrateComm: 49, eRunrate: 50, supervisorId: 51
  };
  // Human labels for the GV REPORT columns above (used by the agent profile drawer).
  const REPORT_COLS_LABELS = ['Mobile Number', 'AGENT_ID', 'AGENT_NAME', 'TL ID', 'TL Name',
    'Stock VC12', 'Stock VC16', 'Stock VC4', 'Stock VC5', 'Stock VC6', 'Stock VC7', 'Stock Grand Total', 'Stock Commercial',
    'Minimum Required Inventory', 'Suggested Dispatch Qty', 'Priority Level',
    'TL Total Stock (VC4)', 'TL Total Stock (NVC4)', 'TL Total Stock',
    'Last Month · Issuance Days', 'Last Month · VC4', 'Last Month · Commercial', 'Last Month · Total', 'Growth %', 'Agent Status', 'Agent Performance',
    'Today Issued', 'Current Month · Issuance Days', 'Current Month · Replace', 'Current Month · Chassis',
    'Current Month · VC4', 'Current Month · VC5', 'Current Month · VC6', 'Current Month · VC7', 'Current Month · VC12', 'Current Month · VC16',
    'Current Month · Total CV', 'Current Month · Total Issuance', 'Expected In Month', 'Runrate (VC4)', 'Runrate (NVC4)', 'Runrate',
    'TL Last Month (VC4)', 'TL Last Month (Comm.)', 'TL Last Month Total', 'TL Current Month (VC4)', 'TL Current Month (NVC4)', 'TL Total Activation (MTD)',
    'Avg Runrate (VC4)', 'Avg Runrate (NVC4)', 'eRunrate', 'Supervisor ID'];
  async function loadReport(opts) {
    const rc = reportCfg();
    const headerRow = rc.headerRow || 4;
    const lastCol = rc.lastCol || 'BE';
    const range = `A${headerRow}:${lastCol}`;
    const t = await D.query('GV REPORT', '', { ...opts, gid: rc.gid || (FF.config.tabBy('GV REPORT') || {}).gid || '', range });
    const cell = (row, key) => D.cellText(row[REPORT_COLS[key]]);
    const num = (row, key) => D.cellNumber(row[REPORT_COLS[key]]);
    const rows = [];
    for (const r of t.rows) {
      const agentId = U.clean(cell(r, 'agentId'));
      if (!agentId || /^AGENT_ID$/i.test(agentId)) continue; // skip the header row itself
      const pctText = cell(r, 'growthText');
      const g = String(pctText).match(/[-+]?\d+(?:\.\d+)?/);
      let growth = g ? Number(g[0]) : null;
      if (growth !== null && /▼/.test(pctText) && growth > 0) growth = -growth;
      const tlId = U.clean(cell(r, 'tlId')) || U.clean(cell(r, 'supervisorId'));
      const rawTlName = U.clean(cell(r, 'tlName'));
      rows.push({
        agentId, agentName: U.clean(cell(r, 'agentName')) || agentId, mobile: U.clean(cell(r, 'mobile')),
        tlId,
        tlName: rawTlName || (tlId ? `TL ${tlId}` : 'Direct'), directAgent: !rawTlName && !tlId,
        stockVc4: num(r, 'stockVc4') || 0, stockComm: num(r, 'stockComm') || 0, stockTotal: num(r, 'stockTotal') || 0,
        stockByClass: Object.fromEntries([['VC12', 'stockVc12'], ['VC16', 'stockVc16'], ['VC4', 'stockVc4'], ['VC5', 'stockVc5'], ['VC6', 'stockVc6'], ['VC7', 'stockVc7']].map(([k, key]) => [k, num(r, key) || 0])),
        minRequired: num(r, 'minRequired') || 0, suggestedDispatch: num(r, 'suggestedDispatch') || 0,
        priority: U.clean(cell(r, 'priority')), tlStockVc4: num(r, 'tlStockVc4') || 0, tlStockComm: num(r, 'tlStockComm') || 0, tlStockTotal: num(r, 'tlStockTotal') || 0,
        lastDays: num(r, 'lastDays') || 0, lastVc4: num(r, 'lastVc4') || 0, lastComm: num(r, 'lastComm') || 0, lastTotal: num(r, 'lastTotal') || 0,
        growth, agentStatus: U.clean(cell(r, 'agentStatus')), agentPerf: U.clean(cell(r, 'agentPerf')),
        todayIssued: num(r, 'todayIssued') || 0, curDays: num(r, 'curDays') || 0, replace: num(r, 'replace') || 0, chassis: num(r, 'chassis') || 0,
        curVc4: num(r, 'curVc4') || 0, curComm: num(r, 'curComm') || 0, curTotal: num(r, 'curTotal') || 0,
        curByClass: Object.fromEntries([['VC4', 'curVc4'], ['VC5', 'curVc5'], ['VC6', 'curVc6'], ['VC7', 'curVc7'], ['VC12', 'curVc12'], ['VC16', 'curVc16']].map(([k, key]) => [k, num(r, key) || 0])),
        expected: num(r, 'expected') || 0, runrateVc4: num(r, 'runrateVc4') || 0, runrateComm: num(r, 'runrateComm') || 0, runrate: num(r, 'runrate') || 0,
        tlLastVc4: num(r, 'tlLastVc4') || 0, tlLastComm: num(r, 'tlLastComm') || 0, tlLastTotal: num(r, 'tlLastTotal') || 0,
        tlCurVc4: num(r, 'tlCurVc4') || 0, tlCurComm: num(r, 'tlCurComm') || 0, tlCurTotal: num(r, 'tlCurTotal') || 0,
        avgRunrateVc4: num(r, 'avgRunrateVc4') || 0, avgRunrateComm: num(r, 'avgRunrateComm') || 0, eRunrate: num(r, 'eRunrate') || 0,
        supervisorId: U.clean(cell(r, 'supervisorId')),
        raw: t.cols.map((c, i) => D.cellText(r[i], c))
      });
    }
    rows.sort((a, b) => b.curTotal - a.curTotal || b.stockTotal - a.stockTotal);
    return rows;
  }

  const LOADERS = { master: loadMaster, stockClass: loadStockClass, stockTl: loadStockTl, stockTlClass: loadStockTlClass, stockAgent: loadStockAgent, stockAgentClass: loadStockAgentClass, report: loadReport };

  // ---- in-memory aggregations over GV Master ------------------------------------------------------
  const rows = () => state.data.master || [];
  const masterMonths = () => U.uniq(rows().map((r) => r.ym).filter(Boolean)).sort();
  const masterLatestDate = () => rows().reduce((acc, r) => (!acc || (r.date && r.date > acc) ? r.date : acc), null);

  function masterSummary(ym, upToDay) {
    const s = { ym, total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, issuance: 0, replacement: 0, vrn: 0, chassis: 0, agents: new Set(), tls: new Set(), directSet: new Set(), days: new Set(), lastDay: 0, amount: 0, commission: 0, commissionVc4: 0, commissionVc20: 0, commissionVc5p: 0, amountVc4: 0, amountVc20: 0, amountVc5p: 0 };
    for (const r of rows()) {
      if (ym && r.ym !== ym) continue;
      if (upToDay && r.day > upToDay) continue;
      s.total += 1;
      if (r.group === 'VC4') s.vc4 += 1; else if (r.group === 'VC20') s.vc20 += 1; else s.vc5p += 1;
      if (/replacement/i.test(r.status)) s.replacement += 1; else s.issuance += 1;
      if (/chassis/i.test(r.tagType)) s.chassis += 1; else s.vrn += 1;
      s.agents.add(r.agentId);
      if (r.directAgent === true || FF.config.isDirectAgent(r, 'gv')) s.directSet.add(r.agentId);
      else s.tls.add(r.tlName || 'Direct');
      s.amount += r.amount; s.commission += r.commission;
      if (r.group === 'VC4') { s.commissionVc4 += r.commission || 0; s.amountVc4 += r.amount || 0; }
      else if (r.group === 'VC20') { s.commissionVc20 += r.commission || 0; s.amountVc20 += r.amount || 0; }
      else { s.commissionVc5p += r.commission || 0; s.amountVc5p += r.amount || 0; }
      if (r.day) { s.days.add(r.day); if (r.day > s.lastDay) s.lastDay = r.day; }
    }
    s.comm = s.vc20 + s.vc5p;
    s.activeAgents = s.agents.size;
    s.activeTls = s.tls.size;
    s.directAgents = s.directSet.size;
    s.activeDays = s.days.size;
    s.avgPerDay = s.lastDay ? s.total / s.lastDay : 0;
    s.daysInMonth = ym ? U.daysInMonth(ym) : 30;
    s.projected = s.lastDay ? Math.round((s.total / s.lastDay) * s.daysInMonth) : 0;
    return s;
  }
  function masterDailySeries(ym, dimFn) {
    const { y, m } = U.ymParts(ym);
    const n = U.daysInMonth(ym);
    const totals = new Array(n).fill(0);
    const dims = new Map();
    for (const r of rows()) {
      if (r.ym !== ym || !r.day) continue;
      totals[r.day - 1] += 1;
      if (dimFn) { const k = dimFn(r); if (!dims.has(k)) dims.set(k, new Array(n).fill(0)); dims.get(k)[r.day - 1] += 1; }
    }
    const days = Array.from({ length: n }, (_, i) => i + 1);
    return { ym, days, labels: days.map(String), dates: days.map((d) => new Date(y, m - 1, d)), totals, dims };
  }
  function weekly(ym) {
    const series = dailySeries(ym);
    const buckets = new Map();
    series.totals.forEach((v, i) => {
      const d = series.dates[i];
      const key = U.weekStart(d).getTime();
      if (!buckets.has(key)) buckets.set(key, { start: new Date(key), n: 0, days: 0 });
      const b = buckets.get(key); b.n += v; if (v > 0) b.days += 1;
    });
    return [...buckets.values()].sort((a, b) => a.start - b.start);
  }
  function masterByDim(ym, dimFn, upToDay) {
    const map = new Map();
    for (const r of rows()) {
      if (ym && r.ym !== ym) continue;
      if (upToDay && r.day > upToDay) continue;
      const k = dimFn(r);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  }
  /** Agent-wise rollup for a month (from GV Master). */
  function masterAgentRollup(ym) {
    const map = new Map();
    for (const r of rows()) {
      if (ym && r.ym !== ym) continue;
      const k = r.agentId || r.agentName;
      if (!map.has(k)) map.set(k, { agentId: r.agentId, agentName: r.agentName, tlName: r.tlName, channel: 'GV Partner', directAgent: r.directAgent === true, total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, replacement: 0, days: new Set() });
      const o = map.get(k);
      o.directAgent = o.directAgent && r.directAgent !== false;
      o.total += 1;
      if (r.group === 'VC4') o.vc4 += 1; else if (r.group === 'VC20') { o.vc20 += 1; o.comm += 1; } else { o.vc5p += 1; o.comm += 1; }
      if (/replacement/i.test(r.status)) o.replacement += 1;
      if (r.day) o.days.add(r.day);
      if (r.tlName && o.tlName === 'Direct') o.tlName = r.tlName;
    }
    return [...map.values()].map((a) => ({ ...a, activeDays: a.days.size, avgPerDay: a.days.size ? a.total / a.days.size : 0 })).sort((a, b) => b.total - a.total);
  }
  function masterTlRollup(ym) {
    const map = new Map();
    for (const r of rows()) {
      if (ym && r.ym !== ym) continue;
      // 🧍 Direct agents kisi TL ke under nahi — TL ranking/table me kabhi nahi aate (directRollup dekho).
      if (r.directAgent === true || FF.config.isDirectAgent(r, 'gv')) continue;
      const k = r.tlName || 'Direct';
      if (!map.has(k)) map.set(k, { tlName: k, tlId: r.tlId, total: 0, vc4: 0, comm: 0, agents: new Set() });
      const o = map.get(k);
      o.total += 1;
      if (r.group === 'VC4') o.vc4 += 1; else o.comm += 1;
      o.agents.add(r.agentId);
    }
    return [...map.values()].map((t) => ({ ...t, agentCount: t.agents.size })).sort((a, b) => b.total - a.total);
  }
  /** Direct agents ka rollup (GV Master se) — TL lists se alag rehta hai. */
  function masterDirectRollup(ym) {
    const map = new Map();
    for (const r of rows()) {
      if (ym && r.ym !== ym) continue;
      if (!(r.directAgent === true || FF.config.isDirectAgent(r, 'gv'))) continue;
      const k = r.agentId || r.agentName;
      if (!map.has(k)) map.set(k, { agentId: r.agentId, agentName: r.agentName, tlName: 'Direct', reason: FF.direct ? FF.direct.reason(r, 'gv') : 'GV direct agent', total: 0, vc4: 0, comm: 0, commission: 0, last: null });
      const o = map.get(k);
      o.total += 1;
      if (r.group === 'VC4') o.vc4 += 1; else o.comm += 1;
      o.commission += Number(r.commission || 0);
      if (r.date && (!o.last || r.date > o.last)) o.last = r.date;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }
  // ---- 🟩 GV AAJ = GV Master sheet (live) ----------------------------------------------------------
  // Rule (user-confirmed): First Forward ka *aaj* ka issuance EIR se, aur GV Partner ka *aaj* ka
  // issuance sirf GV Master tab se aata hai — kyunki GV live chalta hai aur EIR me uska aaj ka data
  // late/partial ho sakta hai. Kal se pichhle dinon ke liye EIR hi authoritative ledger rehta hai.
  //
  // Isliye: EIR ki daily GV series me se sirf AAJ ki rows hata kar GV Master ki aaj ki rows lagate hain
  // (add nahi — "replace", taaki ek hi tag do baar na gine).
  function todayKey() { return U.dateKey(new Date()); }
  const masterTodayReady = () => Array.isArray(state.data.master);
  /** Aaj ke GV Master rows — EIR daily row jaisa hi shape (downstream sab isi shape par chalta hai). */
  function masterTodayRows() {
    if (!masterTodayReady()) return [];
    const tk = todayKey();
    const out = [];
    for (const r of rows()) {
      if (!r.date || U.dateKey(r.date) !== tk) continue;
      const replacement = /replacement/i.test(r.status || '');
      out.push({
        date: r.date, d: r.date, key: tk, ym: r.ym, day: r.day,
        cls: r.cls, group: r.group,
        type: replacement ? 'REPLACEMENT' : 'ISSUANCE', status: r.status,
        tagType: r.tagType, vrnType: r.tagType || '',
        channel: 'GV Partner',
        agentId: r.agentId || '', agentName: r.agentName || '', tlId: r.tlId || '', tlName: r.tlName || '',
        tagId: r.tagId || '', serial: r.serial || '', vrn: r.vrn || '',
        customer: r.customer || '', amount: Number(r.amount) || 0, commission: Number(r.commission) || 0,
        live: true, source: 'gv-master', n: 1
      });
    }
    return out;
  }
  /** 🟩 Aaj ka GV snapshot (GV Master se) — Home card, chips aur drawers isi ko dikhate hain. */
  function gvToday() {
    const tk = todayKey();
    const rs = masterTodayRows();
    const count = (fn) => rs.reduce((n, r) => n + (fn(r) ? 1 : 0), 0);
    const byClass = {};
    const byAgent = new Map();
    for (const r of rs) {
      byClass[r.cls] = (byClass[r.cls] || 0) + 1;
      const k = r.agentId || r.agentName || '—';
      const a = byAgent.get(k) || { agentId: r.agentId, agentName: r.agentName, tlName: r.tlName, n: 0, vc4: 0, comm: 0 };
      a.n += 1; if (r.group === 'VC4') a.vc4 += 1; else a.comm += 1;
      byAgent.set(k, a);
    }
    return {
      date: tk, live: true, source: 'GV Master', loaded: masterTodayReady(),
      rows: rs, byClass, agents: [...byAgent.values()].sort((a, b) => b.n - a.n),
      total: rs.length, vc4: count((r) => r.group === 'VC4'), vc20: count((r) => r.group === 'VC20'),
      vc5p: count((r) => r.group === 'VC5+'), comm: count((r) => r.group !== 'VC4'),
      replacement: count((r) => r.type === 'REPLACEMENT'),
      chassis: count((r) => /chassis/i.test(r.vrnType || r.tagType || ''))
    };
  }
  /** GV daily series: EIR history + AAJ ki rows GV Master se (master load hone par). */
  function liveDailyRows() {
    const eir = eirDailyRows();
    if (!masterTodayReady()) return eir;
    const tk = todayKey();
    const live = masterTodayRows();
    const rest = eir.filter((r) => U.dateKey(r.date || r.d || new Date(0)) !== tk);
    return rest.concat(live).sort((a, b) => (a.d && b.d ? a.d - b.d : 0));
  }

  // ---- EIR-authoritative issuance views (kal se pichhle din) --------------------------------------
  // GV Master remains available below for operational fields (commission, status, stock metadata).
  function eirDaily() {
    return FF.store && typeof FF.store.get === 'function' && Array.isArray(FF.store.get('daily')) ? FF.store.get('daily') : null;
  }
  function eirReady() { return Array.isArray(eirDaily()); }
  function eirAgents() {
    return FF.store && typeof FF.store.get === 'function' && Array.isArray(FF.store.get('agents')) ? FF.store.get('agents') : [];
  }
  function eirAgentClass() {
    return FF.store && typeof FF.store.get === 'function' && Array.isArray(FF.store.get('agentClass')) ? FF.store.get('agentClass') : [];
  }
  function eirAgentToday() {
    return FF.store && typeof FF.store.get === 'function' && Array.isArray(FF.store.get('agentDailyClass')) ? FF.store.get('agentDailyClass') : [];
  }
  function eirDailyRows() {
    return (eirDaily() || []).filter((r) => r.channel === 'GV Partner').map((r) => ({
      date: r.d, d: r.d, ym: r.ym, day: r.day, cls: r.cls, group: r.group, type: r.type,
      status: r.type, tagType: r.vrnType || '', vrnType: r.vrnType || '', channel: 'GV Partner',
      agentId: r.agentId || '', agentName: r.agentName || '', tlId: r.tlId || '', tlName: r.tlName || '', n: r.n
    }));
  }
  function operationalCommission(ym, upToDay) {
    const s = masterSummary(ym, upToDay);
    return {
      amount: s.amount || 0, commission: s.commission || 0,
      commissionVc4: s.commissionVc4 || 0, commissionVc20: s.commissionVc20 || 0, commissionVc5p: s.commissionVc5p || 0,
      amountVc4: s.amountVc4 || 0, amountVc20: s.amountVc20 || 0, amountVc5p: s.amountVc5p || 0
    };
  }
  function eirPeopleRollup(ym) {
    const classes = eirAgentClass().filter((r) => r.channel === 'GV Partner' && (!ym || r.ym === ym));
    const meta = new Map();
    eirAgents().filter((r) => r.channel === 'GV Partner' && (!ym || r.ym === ym)).forEach((r) => {
      const key = `${r.ym}|${U.clean(r.name).toUpperCase()}`;
      if (!meta.has(key)) meta.set(key, r);
    });
    const commission = new Map();
    for (const r of rows()) {
      if (ym && r.ym !== ym) continue;
      const k = `${r.ym}|${U.clean(r.agentName).toUpperCase()}`;
      const v = commission.get(k) || { amount: 0, commission: 0 };
      v.amount += Number(r.amount || 0); v.commission += Number(r.commission || 0); commission.set(k, v);
    }
    // Agent-class is monthly, so build active-day sets from the same EIR daily ledger rather
    // than leaving every GV rollup at zero active days. This keeps avgPerDay meaningful.
    const daySets = new Map();
    for (const r of liveDailyRows()) {
      if (ym && r.ym !== ym) continue;
      const k = `${r.ym}|${U.clean(r.agentName).toUpperCase()}`;
      if (!daySets.has(k)) daySets.set(k, new Set());
      daySets.get(k).add(r.key || U.dateKey(r.date || r.d));
    }
    const map = new Map();
    const put = (r, n, group, type) => {
      const name = U.clean(r.name || r.agentName) || 'Unknown';
      const key = `${r.ym}|${name.toUpperCase()}`;
      const m = meta.get(key) || {};
      const id = r.id || r.agentId || r.gvId || m.id || name;
      const k = `${r.channel}|${id}|${name}`;
      if (!map.has(k)) {
        const op = commission.get(key) || { amount: 0, commission: 0 };
        const tlName = U.clean(r.tlName) || 'Direct';
        const direct = !tlName || /^(—|direct)$/i.test(tlName) || FF.config.isDirectAgent({ agentId: id, agentName: name, tlId: r.tlId, tlName, channel: 'GV Partner' }, 'gv');
        map.set(k, { agentId: id, agentName: name, tlId: r.tlId || m.tlId || '', tlName, channel: 'GV Partner', directAgent: direct,
          total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, replacement: 0, days: new Set(daySets.get(key) || []), byClass: {}, amount: op.amount, commission: op.commission });
      }
      const o = map.get(k); o.total += n;
      const exactClass = normClass(r.cls || group || 'NA');
      o.byClass[exactClass] = (o.byClass[exactClass] || 0) + n;
      if (group === 'VC4') o.vc4 += n; else if (group === 'VC20') { o.vc20 += n; o.comm += n; } else { o.vc5p += n; o.comm += n; }
      if (/replacement/i.test(type || '')) o.replacement += n;
    };
    if (classes.length) classes.forEach((r) => put(r, Number(r.n) || 0, r.group, r.type));
    else eirAgents().filter((r) => r.channel === 'GV Partner' && (!ym || r.ym === ym)).forEach((r) => put({ ...r, agentName: r.name, group: 'VC5+' }, Number(r.n) || 0, 'VC5+', 'ISSUANCE'));
    return [...map.values()].map((a) => ({ ...a, activeDays: a.days.size, avgPerDay: a.days.size ? a.total / a.days.size : 0 })).sort((a, b) => b.total - a.total);
  }
  function eirSummary(ym, upToDay) {
    const s = FF.model.summary(liveDailyRows(), ym, upToDay, 'GV Partner');
    const people = eirPeopleRollup(ym);
    s.agents = new Set(people.map((a) => a.agentId));
    s.tls = new Set(people.filter((a) => !a.directAgent).map((a) => a.tlName || 'Direct'));
    s.directSet = new Set(people.filter((a) => a.directAgent).map((a) => a.agentId));
    s.activeAgents = s.agents.size; s.activeTls = s.tls.size; s.directAgents = s.directSet.size;
    Object.assign(s, operationalCommission(ym, upToDay));
    return s;
  }
  function eirTlRollup(ym) {
    const map = new Map();
    for (const a of eirPeopleRollup(ym)) {
      if (a.directAgent) continue;
      const key = a.tlName || 'Direct';
      if (!map.has(key)) map.set(key, { tlName: key, tlId: a.tlId, total: 0, vc4: 0, comm: 0, agents: new Set() });
      const t = map.get(key); t.total += a.total; t.vc4 += a.vc4; t.comm += a.comm; t.agents.add(a.agentId);
    }
    return [...map.values()].map((t) => ({ ...t, agentCount: t.agents.size })).sort((a, b) => b.total - a.total);
  }
  function eirDirectRollup(ym) {
    return eirPeopleRollup(ym).filter((a) => a.directAgent).map((a) => ({ ...a, reason: FF.direct ? FF.direct.reason(a, 'gv') : 'GV direct agent', last: null }));
  }
  function months() { return eirReady() ? FF.model.months(liveDailyRows()) : masterMonths(); }
  function latestDate() { return eirReady() ? FF.model.latestDate(liveDailyRows()) : masterLatestDate(); }
  function summary(ym, upToDay) { return eirReady() ? eirSummary(ym, upToDay) : masterSummary(ym, upToDay); }
  function dailySeries(ym, dimFn) { return eirReady() ? FF.model.dailySeries(liveDailyRows(), ym, dimFn) : masterDailySeries(ym, dimFn); }
  function byDim(ym, dimFn, upToDay) {
    if (!eirReady()) return masterByDim(ym, dimFn, upToDay);
    const source = liveDailyRows().filter((r) => !ym || r.ym === ym).filter((r) => !upToDay || r.day <= upToDay);
    const map = new Map(); source.forEach((r) => { const k = dimFn(r); map.set(k, (map.get(k) || 0) + r.n); }); return map;
  }
  function agentRollup(ym) { return eirReady() ? eirPeopleRollup(ym) : masterAgentRollup(ym); }
  function tlRollup(ym) { return eirReady() ? eirTlRollup(ym) : masterTlRollup(ym); }
  function directRollup(ym) { return eirReady() ? eirDirectRollup(ym) : masterDirectRollup(ym); }
  // GV issuance rows = EIR history + GV Master ka aaj (live). GV pages/sprint/tag-issued sab yahi use karte hain.
  function issuanceRows() { return eirReady() ? liveDailyRows() : rows(); }

  /** Searchable people list (agents + TLs) for the suggestion dropdowns. */
  function people() {
    const map = new Map(), tls = new Map();
    for (const a of state.data.stockAgent || []) {
      const k = U.clean(a.agentName).toUpperCase();
      if (!k) continue;
      const e = map.get(k) || { name: a.agentName, id: a.agentId, tl: a.tlName, n: 0, direct: a.directAgent === true };
      e.n += a.n; if (!e.tl && a.tlName) e.tl = a.tlName; if (!e.id && a.agentId) e.id = a.agentId;
      map.set(k, e);
    }
    for (const r of state.data.report || []) {
      const k = U.clean(r.agentName).toUpperCase();
      if (!k) continue;
      const direct = FF.config.isDirectAgent(r, 'gv');
      const e = map.get(k) || { name: r.agentName, id: r.agentId, tl: r.tlName, n: 0, report: true };
      e.report = true; if (!e.tl) e.tl = r.tlName; if (!e.id) e.id = r.agentId;
      e.direct = e.direct || direct;
      map.set(k, e);
      const tl = U.clean(r.tlName);
      if (!direct && tl && FF.config.isRealTl(tl)) tls.set(tl, (tls.get(tl) || 0) + r.curTotal);
    }
    for (const t of state.data.stockTl || []) if (t.tlName && FF.config.isRealTl(t.tlName) && t.directAgent !== true) tls.set(t.tlName, (tls.get(t.tlName) || 0) + t.n);
    return { agents: [...map.values()], tls: [...tls.entries()].map(([name, n]) => ({ name, n })) };
  }

  const GV = {
    DATASETS, preload, refresh, need, get, error, reset, enabled, wanted,
    normClass, classGroup, clsNum,
    rows, masterRows: rows, issuanceRows, eirDailyRows, liveDailyRows, gvToday, masterTodayRows, todayKey, months, latestDate, summary, dailySeries, weekly, byDim, agentRollup, tlRollup, directRollup, people,
    REPORT_COLS, REPORT_COLS_LABELS,
    get state() { return state; },
    get loadedAt() { return state.loadedAt; },
    get loading() { return state.loading; }
  };
  FF.gv = GV;
})(window.FF);
