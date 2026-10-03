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
  const cchToken = (v) => U.clean(v).toUpperCase().replace(/\s+/g, ' ').trim();
  function configuredGroup(cch, fallbackClass) {
    const cfg = cfgGv().classCch || {};
    if (cfg.enabled !== false) {
      const token = cchToken(cch);
      const groups = cfg.groups || {};
      if (token) {
        for (const [group, values] of Object.entries(groups)) {
          if (!Array.isArray(values)) continue;
          if (values.some((v) => cchToken(v) === token)) return group === 'VC5' || group === 'VC5+' ? 'VC5+' : group;
        }
      }
    }
    return classGroup(fallbackClass || cch);
  }
  const isHeaderRow = (row) => row.some((v) => /^(AGENT_ID|UNIQUE_ID|TAG_ID|VEHICLE_CLASS)$/i.test(U.clean(v)));

  // ---- 🧭 Header-aware column mapping (v3.45) ------------------------------------------------------
  // Pehle har field sirf config ke column LETTER par padhi jaati thi — sheet me column aage-peeche
  // hote hi (naya column, merged heading, partner ka edit) number chup-chaap galat aane lagta tha.
  // Ab: config letter ka heading expected jaisa ho to wahi; warna heading se sahi column dhoondha
  // jaata hai; kuch bhi match na ho to configured letter hi chalega + warning (Settings/Data check me
  // dikhti hai). Isse "GV REPORT / GV Master ko sahi recognise karo" wali dikkat jad se theek hoti hai.
  const normHead = (s) => U.clean(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const headTokens = (s) => new Set((String(s || '').toUpperCase().match(/[A-Z0-9]{2,}/g) || []).filter((t) => t.length >= 3));
  /** Do tokens "lagbhag same" hain? (typo ya chhota abbreviation — MAX_QUANTITY vs MAX_QTY) */
  function tokenClose(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 3) return false;
    if (a.startsWith(b) || b.startsWith(a)) return true;
    // chhota edit distance (typo: EXPACTED vs EXPECTED)
    if (a.length <= 12 && b.length <= 12) {
      const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
      for (let j = 0; j <= b.length; j++) dp[0][j] = j;
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (dp[a.length][b.length] <= 2) return true;
    }
    return false;
  }
  /** 0–100: sheet ke heading label aur humari expected heading kitne milte hain. */
  function headScore(label, expected) {
    const a = normHead(label), e = normHead(expected);
    if (!a || !e) return 0;
    if (a === e) return 100;
    if (a.startsWith(e) || e.startsWith(a)) return 85;
    if (e.length >= 3 && a.includes(e)) return 75;
    if (a.length >= 3 && e.includes(a)) return 65;
    const ta = headTokens(label), te = headTokens(expected);
    if (!ta.size || !te.size) return 0;
    let hit = 0;
    te.forEach((t) => { if (ta.has(t) || [...ta].some((x) => tokenClose(x, t))) hit++; });
    const cov = hit / te.size;
    return cov >= 0.5 ? Math.round(40 + cov * 48) : 0;
  }
  /** True lagta hai ki labels sach me sheet ki headings hain (data rows nahi)? */
  function labelsPlausible(labels, spec, synonyms) {
    let sum = 0, n = 0;
    Object.keys(spec).forEach((field) => {
      const letter = spec[field];
      const isCol = typeof letter === 'number' || (typeof letter === 'string' && /^[A-Za-z]{1,3}$/.test(letter.trim()));
      if (!isCol) return;
      const syns = (synonyms && synonyms[field]) || [];
      if (!syns.length) return;
      const cfg = typeof letter === 'number' ? letter : U.colIndex(letter);
      sum += syns.reduce((best, s) => Math.max(best, headScore(U.clean(labels[cfg]), s)), 0);
      n++;
    });
    return n ? (sum / n) >= 45 : true;
  }
  /** Ek dataset ke labels se field → column index map banao (synonyms + nearest-index preference).
   *  `opts.firstRow` diya ho to pehle ye pakadta hai ki labels sach me headings hain ya pehli data row
   *  (gviz kabhi range ke pehle row ko hi label bana deta hai) — us case me config letters hi safe hain. */
  function mapFields(labels, spec, synonyms, opts) {
    let hasLabels = Array.isArray(labels) && labels.some((l) => U.clean(l));
    if (hasLabels && opts && Array.isArray(opts.firstRow) && opts.firstRow.length) {
      let same = 0, n = 0;
      labels.forEach((l, i) => {
        const a = U.clean(l), b = U.clean(opts.firstRow[i]);
        if (!a && !b) return;
        n++;
        if (a && b && a === b) same++;
      });
      if (n && (same / n) >= 0.6) hasLabels = false;
    }
    const idx = {}, info = {}, warnings = [];
    Object.keys(spec).forEach((field) => {
      const letter = spec[field];
      // spec me column letter ('E') ya seedha index (0, 1, … — jaise REPORT_COLS) dono chalte hain.
      // `tab`, `gid`, `headerRow` jaise settings column nahi hain — unko chhod do.
      const isCol = typeof letter === 'number' || (typeof letter === 'string' && /^[A-Za-z]{1,3}$/.test(letter.trim()));
      if (!isCol) return;
      const cfg = typeof letter === 'number' ? letter : U.colIndex(letter);
      const at = hasLabels ? U.clean(labels[cfg]) : '';
      const syns = (synonyms && synonyms[field]) || [];
      const scoreOf = (l) => syns.reduce((best, s) => Math.max(best, headScore(l, s)), 0);
      let use = cfg, how = hasLabels ? 'config' : 'no-headers';
      const hereScore = at ? scoreOf(at) : 0;
      if (hasLabels && at && syns.length && hereScore < 55) {
        let best = -1, bestScore = 0;
        labels.forEach((l, i) => {
          const s = scoreOf(l) - Math.min(20, Math.abs(i - cfg) * 2);
          if (s > bestScore) { bestScore = s; best = i; }
        });
        if (best >= 0 && bestScore >= 55) { use = best; how = best === cfg ? 'config' : 'header'; }
        else how = 'mismatch';
      }
      idx[field] = use;
      const cfgRef = typeof letter === 'number' ? U.colLetter(cfg) : letter;
      info[field] = { index: use, letter: U.colLetter(use), configLetter: cfgRef, label: at, how, score: hereScore };
      if (how === 'header') warnings.push(`${field}: column ${cfgRef} par "${at}" mila — heading "${U.clean(labels[use])}" (${U.colLetter(use)}) se padha gaya`);
    });
    return { idx, info, warnings, hasLabels };
  }
  // Expected headings (synonyms) — sheet me jo naam aam taur par hote hain.
  const MASTER_SYNS = {
    uniqueId: ['UNIQUE_ID', 'AGENT_ID', 'AGENTID', 'AGENT_CODE'], agentName: ['AGENT_NAME', 'AGENT', 'NAME'],
    tlId: ['SUPERVISOR_AGENT_ID', 'SUPERVISOR_ID', 'TL_ID'], tlName: ['SUPERVISOR_NAME', 'SUPERVISOR', 'TL_NAME'],
    vrn: ['VRN', 'VNO', 'VEHICLE_NUMBER', 'VEHICLE_NO'], vClass: ['VCLASS', 'VEHICLE_CLASS', 'CLASS', 'TAG_CLASS'],
    cch: ['CCH', 'CCH_CLASS'], serial: ['SNO', 'SERIAL_NUMBER', 'SERIAL'], tagId: ['TAG_ID_NUMBER', 'TAG_ID', 'TAGID'],
    amount: ['AMOUNT', 'VALUE', 'TXN_AMOUNT'], customer: ['CUSTOMER_NAME', 'CUSTOMER', 'NAME_OF_CUSTOMER'],
    productId: ['PRODUCT_ID', 'PRODUCT'], commission: ['COMMISSION', 'COMM', 'COMMISSION_AMOUNT'],
    status: ['STATUS', 'TAG_STATUS'], commissionStatus: ['COMMISSION_STATUS', 'COMM_STATUS', 'PAYMENT_STATUS'],
    date: ['ISSUE_DATE', 'DATE', 'ISSUANCE_DATE', 'TXN_DATE'], time: ['TIME', 'TXN_TIME'],
    gvTlId: ['GV_TL_ID', 'GVTLID', 'GV_TL'], masterCch: ['MASTER_CCH', 'MASTER_CCH_CLASS'],
    monthName: ['MONTH_NAME', 'MONTH'], tagType: ['TAG_TYPE', 'TYPE'],
    gvUniqueId: ['GV_UNIQUE_ID', 'GVUNIQUEID'], gvUniqueName: ['GV_UNIQUE_NAME', 'GVUNIQUENAME']
  };
  const ASSIGN_SYNS = {
    cls: ['VEHICLE_CLASS', 'VCLASS', 'CLASS', 'TAG_CLASS'], tagId: ['TAG_ID', 'TAG_ID_NUMBER', 'TAGID'],
    serial: ['SERIAL_NUMBER', 'SERIAL', 'SNO'], status: ['TAG_STATUS', 'STATUS', 'STOCK_STATUS'],
    agentId: ['AGENT_ID', 'AGENTID', 'UNIQUE_ID'], agentName: ['AGENT_NAME', 'AGENT', 'NAME'],
    tlId: ['SUPERVISOR_ID', 'SUPERVISOR_AGENT_ID', 'TL_ID'], tlName: ['SUPERVISOR_NAME', 'SUPERVISOR', 'TL_NAME'],
    gvUniqueId: ['GV_UNIQUE_ID'], gvUniqueName: ['GV_UNIQUE_NAME'], allocatedAt: ['ALLOCATED_AT', 'TAG_ALLOCATED_AT']
  };
  /** GV REPORT ke field → expected heading (REPORT_COLS_LABELS ke saath sync). */
  // Asli sheet ke headings (mock/dev/mock-gviz.js + live GV REPORT se) — inhe synonym me rakhne se
  // sahi column kabhi "mismatch" flag nahi hota, aur column shift hone par relocation bhi sahi hoti hai.
  const REPORT_SYNS = {
    mobile: ['Mobile Number', 'Mobile No', 'Mobile'], agentId: ['AGENT_ID', 'AGENT ID', 'AGENTID', 'AGENT CODE'],
    agentName: ['AGENT_NAME', 'AGENT NAME', 'AGENT', 'NAME'], tlId: ['TL ID', 'TL_ID', 'SUPERVISER ID', 'SUPERVISOR_ID'],
    tlName: ['TL Name', 'TL_NAME', 'SUPERVISOR_NAME', 'TL'],
    stockVc12: ['VC12', 'Stock VC12'], stockVc16: ['VC16', 'Stock VC16'], stockVc4: ['VC4', 'Stock VC4'],
    stockVc5: ['VC5', 'Stock VC5'], stockVc6: ['VC6', 'Stock VC6'], stockVc7: ['VC7', 'Stock VC7'],
    stockTotal: ['Grand Total', 'TOTAL CV', 'Stock Grand Total', 'TOTAL STOCK'],
    stockComm: ['Total CV', 'Total Stock Comm', 'Commercial', 'NVC4', 'Stock Commercial'],
    minRequired: ['Minimum Required Inventory', 'Minimum Required', 'MIN REQUIRED'],
    suggestedDispatch: ['Suggested Dispatch Quantity', 'Suggested Dispatch Qty', 'Suggested Dispatch'],
    priority: ['Priority Level', 'Priority', 'Priority Level '],
    tlStockVc4: ['TL Total Stock (VC4)', 'TL Stock VC4'], tlStockComm: ['TL Total Stock (NVC4)', 'TL Total Stock (Comm.)', 'TL Stock NVC4'],
    tlStockTotal: ['TL Total Stock', 'TL Stock Total'],
    lastDays: ['Last Month · Issuance Days', 'Issuance Days', 'Last Month Issuance Days'],
    lastVc4: ['Last Month  (VC4)', 'Last Month · VC4', 'Last Month (VC4)', 'Last Month VC4'],
    lastComm: ['Last Month (Comm.)', 'Last Month · Commercial', 'Last Month Comm', 'NVC4'],
    lastTotal: ['Total Last Month', 'Last Month · Total', 'Last Month Total'],
    growthText: ['Percent', 'Growth %', 'Growth', 'Percentage'],
    agentStatus: ['AGENT  Status', 'Agent Status', 'Status'], agentPerf: ['Agent Performance', 'Performance'],
    todayIssued: ['Today Issued', 'Today Issuance', 'Today'],
    curDays: ['Current Month · Issuance Days', 'Issuance Days', 'Current Month Issuance Days'],
    replace: ['Replace', 'Replacement', 'Current Month · Replace'], chassis: ['Chassis', 'Current Month · Chassis'],
    curVc4: ['VC4', 'Current Month · VC4'], curVc5: ['VC5', 'Current Month · VC5'], curVc6: ['VC6', 'Current Month · VC6'],
    curVc7: ['VC7', 'Current Month · VC7'], curVc12: ['VC12', 'Current Month · VC12'], curVc16: ['VC16', 'Current Month · VC16'],
    curComm: ['TOTAL CV CURRENT MONTH', 'Current Month · Commercial', 'Current Month · Total CV'],
    curTotal: ['Total Issunce', 'Total Issuance', 'Current Month · Total Issuance', 'Current Month · Total'],
    expected: ['Expacted In Month', 'Expected In Month', 'Expected Month End', 'Expected'],
    runrateVc4: ['Runrate (VC4)', 'Runrate VC4'], runrateComm: ['Runrate (NVC4)', 'Runrate NVC4'], runrate: ['Runrate', 'Run Rate'],
    tlLastVc4: ['TL Last Month (VC4)', 'Last Month  (VC4)'], tlLastComm: ['TL Last Month (Comm.)', 'TL Last Month Comm'],
    tlLastTotal: ['TL Last Month Total', 'Total Last Month'],
    tlCurVc4: ['VC4 Issuance', 'TL Current Month (VC4)', 'TL Current Month VC4'],
    tlCurComm: ['NVC4 Issuance', 'TL Current Month (NVC4)', 'TL Current Month Comm'],
    tlCurTotal: ['TL Total Activation(Current Month)', 'TL Total Activation (MTD)', 'TL Current Month Total', 'TL Total Activation'],
    avgRunrateVc4: ['Average Runrate (VC4)', 'Avg Runrate (VC4)'], avgRunrateComm: ['Average Runrate (NVC4)', 'Avg Runrate (NVC4)'],
    eRunrate: ['eRunrate', 'ERunrate', 'Expected Runrate'], supervisorId: ['SUPERVISER ID', 'SUPERVISOR ID', 'SUPERVISER_ID']
  };
  function reportSynonyms() {
    const out = {};
    Object.keys(REPORT_COLS).forEach((f) => {
      // Note: alias table + descriptive label dono — jo bhi heading sheet me mile, match ho jaye.
      out[f] = [REPORT_COLS_LABELS[REPORT_COLS[f]] || f].concat(REPORT_SYNS[f] || []);
    });
    return out;
  }

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
  const state = { data: {}, errors: {}, loading: false, loadedAt: null, progress: { done: 0, total: 0 }, promise: null, labels: {}, mapping: {} };

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
        scheduleRetry(version, 0);
      }
      return state.data;
    });
    return state.promise;
  }
  // 🔁 Auto-retry (v3.32) — GV ki fail hui sheets background me khud dobara load (4s · 10s · 20s · 40s · 75s).
  const RETRY_DELAYS = [4000, 10000, 20000, 40000, 75000];
  let retryTimer = null;
  function scheduleRetry(version, round) {
    clearTimeout(retryTimer);
    const failed = Object.keys(state.errors).filter((k) => DATASETS[k]);
    if (!failed.length || round >= RETRY_DELAYS.length || version !== generation) { state.retrying = false; return; }
    state.retrying = true;
    retryTimer = setTimeout(async () => {
      if (version !== generation) return;
      const list = Object.keys(state.errors).filter((k) => DATASETS[k]);
      list.forEach((k) => { delete state.errors[k]; });
      await runQueue(list, true);
      if (version !== generation) return;
      state.loadedAt = Date.now();
      if (!Object.keys(state.errors).length) {
        state.retrying = false;
        try { if (FF.app && FF.app.renderCurrent) FF.app.renderCurrent(); if (FF.app && FF.app.updateStatus) FF.app.updateStatus(); } catch { /* ignore */ }
      } else scheduleRetry(version, round + 1);
    }, RETRY_DELAYS[round]);
  }
  function retryNow() { scheduleRetry(generation, 0); }
  function get(key) { return state.data[key]; }
  function error(key) { return state.errors[key]; }
  async function need(key, opts) {
    // A slow unrelated stock/report query must not block this page. `{ only: true }` lets a lazy
    // summary fetch just its selected channel's datasets instead of starting every GV loader.
    if (state.data[key] !== undefined) return state.data[key];
    if (!(opts && opts.only) && !state.promise) preload(false);
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
    state.data = {}; state.errors = {}; state.loadedAt = null; state.labels = {}; state.mapping = {};
    D.clearCache();
  }
  /** 🧭 Header mapping health — Settings → Data check / Summary ke "Data check" panel ke liye. */
  function mapping(dataset) {
    if (dataset) return state.mapping[dataset] || null;
    const out = {};
    Object.keys(state.mapping).forEach((k) => { out[k] = state.mapping[k]; });
    return out;
  }
  function mappingWarnings() {
    const list = [];
    Object.entries(state.mapping).forEach(([key, m]) => {
      (m.warnings || []).forEach((w) => list.push({ dataset: key, text: w }));
    });
    return list;
  }
  /** Tag Assignment probe ko bahar se bhi chala sakte ho (Data check panel). */
  const ensureAssignmentMap = (opts) => assignMap(opts);

  // ---- loaders -----------------------------------------------------------------------------------
  /** GV Master (issuance log) — small tab, loaded fully so every page can aggregate in memory. */
  async function loadMaster(opts) {
    const m = masterCfg();
    const gid = m.gid || (FF.config.tabBy('GV Master') || {}).gid || '';
    const t = await D.query('GV Master', '', { ...opts, gid });
    const map = mapFields((t.cols || []).map((c) => c.label), m, MASTER_SYNS);
    state.mapping.master = map;
    state.labels.master = (t.cols || []).map((c) => c.label || '');
    const rows = [];
    for (const r of t.rows) {
      const get = (field) => D.cellText(r[map.idx[field]]);
      const num = (field) => D.cellNumber(r[map.idx[field]]);
      const agentId = U.clean(get('uniqueId'));
      if (!agentId || /^unique_id$/i.test(agentId)) continue;
      const date = D.cellDate(r[map.idx.date]);
      const rawCch = get('cch');
      const rawVClass = get('vClass');
      const rawCls = rawCch || rawVClass;
      const cls = normClass(rawCls);
      const group = configuredGroup(rawCch, rawVClass || rawCch);
      const commissionRaw = get('commission');
      // GV Master me C (supervisor_agent_id) aur R (GV TL ID) dono hote hain.
      // C ko crosswalk/audit ke liye rakho; calculation aur attribution ke liye sirf R.
      const supervisorId = U.clean(get('tlId')); // C = TL / supervisor ID
      const gvTlId = U.clean(get('gvTlId'));     // R = GV TL ID alias
      // Confirmed GV Master identity: A=UNIQUE_ID (agent), C=TL ID. R remains an alias.
      const tlId = supervisorId || gvTlId;
      const rawTlName = U.clean(get('tlName'));
      const agentName = U.clean(get('agentName')) || agentId;
      const tlName = rawTlName || (tlId ? `TL ${tlId}` : 'Direct');
      rows.push({
        date, ym: date ? U.ymKey(date) : '', day: date ? date.getDate() : 0,
        agentId, agentName,
        tlId, gvTlId, supervisorId, tlName,
        // 🧍 GV direct rule: TL ID + TL Name dono khaali (ya agent hi apna supervisor) → direct agent.
        directAgent: FF.config.isDirectAgent({ agentId, agentName, tlId, supervisorId, gvTlId, tlName: rawTlName, channel: 'GV Partner' }, 'gv'),
        channel: 'GV Partner',
        cch: U.clean(rawCch),
        cls, group,
        status: U.clean(get('status')) || 'Issuance',
        tagType: U.clean(get('tagType')) || 'Other',
        tagId: U.clean(get('tagId')), vrn: U.clean(get('vrn')), serial: U.clean(get('serial')),
        customer: U.clean(get('customer')), productId: U.clean(get('productId')),
        amount: num('amount') || 0,
        commission: num('commission') || 0,
        commissionHasValue: commissionRaw !== '',
        gvUniqueId: U.clean(get('gvUniqueId')), gvUniqueName: U.clean(get('gvUniqueName')),
        monthName: U.clean(get('monthName')), time: U.clean(get('time'))
      });
    }
    rows.sort((a, b) => (a.date && b.date ? a.date - b.date : 0));
    return rows;
  }

  // ---- 📦 Tag Assignment (stock) loaders — header-mapped + status-aware ---------------------------
  // Stock ka sahi matlab: jo tags ASLI me field me hain. Tag Assignment tab me status column hota hai;
  // pehle har row ginti thi, isliye issued/returned rows bhi "stock" me jud jaate the aur number
  // inflated dikhta tha. Ab clearly out-of-stock statuses chhod diye jaate hain (rule config se
  // badal sakte ho) aur dono count rakhe jaate hain: `n` = in-stock, `nAll` = tab me total rows.
  const IN_STOCK_WORDS = ['IN STOCK', 'INSTOCK', 'STOCK', 'ASSIGNED', 'ALLOCATED', 'AVAILABLE', 'ACTIVE', 'FRESH', 'OK'];
  const OUT_STOCK_WORDS = ['ISSUE', 'ISSUED', 'SOLD', 'DISPATCH', 'DELIVER', 'RETURN', 'CANCEL', 'DEAD', 'BLOCK', 'LOST', 'DAMAGE', 'REPLAC', 'VOID', 'EXPIRE', 'CLOSED', 'INACTIVE'];
  const stockStatusCfg = () => (FF.config.gvStockStatus || {});
  /** 'in' | 'out' | 'blank' | 'other' — clear out-of-stock rows hi chhodi jaati hain. */
  function stockStatusKind(raw) {
    const s = U.clean(raw).toUpperCase();
    if (!s) return 'blank';
    const cfg = stockStatusCfg();
    const out = (cfg.outStock || OUT_STOCK_WORDS).map((x) => String(x).toUpperCase());
    const inn = (cfg.inStock || IN_STOCK_WORDS).map((x) => String(x).toUpperCase());
    if (out.some((x) => s.includes(x))) return 'out';
    if (inn.some((x) => s.includes(x))) return 'in';
    return 'other';
  }
  /** Tag Assignment ke headings ek baar padho (1 row probe) — phir wahi letters sab queries me. */
  async function assignMap(opts) {
    const cached = state.mapping.assignment;
    if (cached && cached.hasLabels) return cached;
    const a = assignCfg();
    let labels = [];
    try {
      const probe = await D.query('Tag Assignment', 'select * limit 1', opts);
      labels = (probe.cols || []).map((c) => c.label || '');
      state.labels.assignmentProbeRow = (probe.rows && probe.rows[0]) ? probe.rows[0].map((c) => D.cellText(c)) : [];
      if (!labels.some((l) => U.clean(l)) || !labelsPlausible(labels, a, ASSIGN_SYNS)) {
        // labels ya to khaali hain ya heading ki jagah data row aa gayi hai — poora pehla page
        // (headers ke saath) maang kar dobara dekho. Sirf ek extra query.
        const t = await D.query('Tag Assignment', 'select * limit 5', opts);
        if ((t.cols || []).length) labels = (t.cols || []).map((c) => c.label || '');
      }
    } catch (err) { labels = []; }
    const map = mapFields(labels, a, ASSIGN_SYNS, { firstRow: state.labels.assignmentProbeRow });
    state.mapping.assignment = map;
    state.labels.assignment = labels;
    return map;
  }
  const letterOf = (map, field, fallback) => U.colLetter(map && map.idx && map.idx[field] !== undefined ? map.idx[field] : U.colIndex(fallback));
  /** Ek grouped result → { n (in-stock), nAll, byStatus } */
  function stockCounts(countCell, statusText) {
    const nAll = D.cellNumber(countCell) || 0;
    const kind = stockStatusKind(statusText);
    return { nAll, in: kind === 'out' ? 0 : nAll, out: kind === 'out' ? nAll : 0, kind, status: U.clean(statusText) };
  }
  /** Tag Assignment: class mix. */
  async function loadStockClass(opts) {
    const a = assignCfg();
    const map = await assignMap(opts);
    const cls = letterOf(map, 'cls', a.cls), tag = letterOf(map, 'tagId', a.tagId), st = letterOf(map, 'status', a.status);
    const t = await D.query('Tag Assignment', `select ${cls}, ${st}, count(${tag}) group by ${cls}, ${st}`, opts);
    const byCls = new Map();
    for (const r of t.rows) {
      const clsName = normClass(D.cellText(r[0]));
      const c = stockCounts(r[2], D.cellText(r[1]));
      const cur = byCls.get(clsName) || { cls: clsName, group: classGroup(clsName), n: 0, nAll: 0, byStatus: {} };
      cur.n += c.in; cur.nAll += c.nAll;
      if (c.status) cur.byStatus[c.status] = (cur.byStatus[c.status] || 0) + c.nAll;
      byCls.set(clsName, cur);
    }
    return [...byCls.values()]
      .filter((r) => r.n && !/^(NA|CLASS|N A)$/i.test(r.cls))
      .sort((x, y) => clsNum(x.cls) - clsNum(y.cls));
  }
  /** Tag Assignment: TL-wise stock. */
  async function loadStockTl(opts) {
    const a = assignCfg();
    const map = await assignMap(opts);
    const tlId = letterOf(map, 'tlId', a.tlId), tlName = letterOf(map, 'tlName', a.tlName);
    const tag = letterOf(map, 'tagId', a.tagId), st = letterOf(map, 'status', a.status);
    const t = await D.query('Tag Assignment', `select ${tlId}, ${tlName}, ${st}, count(${tag}) group by ${tlId}, ${tlName}, ${st} order by count(${tag}) desc`, opts);
    const byTl = new Map();
    for (const r of t.rows) {
      const id = U.clean(D.cellText(r[0])), name = U.clean(D.cellText(r[1]));
      if (isHeaderRow([id, name])) continue;
      const key = `${id}|${name}`;
      const c = stockCounts(r[3], D.cellText(r[2]));
      const cur = byTl.get(key) || { tlId: id, tlName: name, n: 0, nAll: 0, byStatus: {} };
      cur.n += c.in; cur.nAll += c.nAll;
      if (c.status) cur.byStatus[c.status] = (cur.byStatus[c.status] || 0) + c.nAll;
      byTl.set(key, cur);
    }
    return [...byTl.values()]
      .filter((r) => r.n)
      .map((r) => {
        const tlName = r.tlName || (U.clean(r.tlId) ? `TL ${U.clean(r.tlId)}` : 'Unassigned');
        return { ...r, tlName, channel: 'GV Partner', directAgent: !U.clean(r.tlName) && !U.clean(r.tlId), isRealTl: FF.config.isRealTl(tlName) };
      });
  }
  /** Tag Assignment: TL × class. */
  async function loadStockTlClass(opts) {
    const a = assignCfg();
    const map = await assignMap(opts);
    const tlNameL = letterOf(map, 'tlName', a.tlName), cls = letterOf(map, 'cls', a.cls);
    const tag = letterOf(map, 'tagId', a.tagId), st = letterOf(map, 'status', a.status);
    const t = await D.query('Tag Assignment', `select ${tlNameL}, ${cls}, ${st}, count(${tag}) group by ${tlNameL}, ${cls}, ${st}`, opts);
    const by = new Map();
    for (const r of t.rows) {
      const tlName = U.clean(D.cellText(r[0])) || 'Unassigned';
      const clsName = normClass(D.cellText(r[1]));
      if (isHeaderRow([tlName, clsName])) continue;
      const c = stockCounts(r[3], D.cellText(r[2]));
      const key = `${tlName}|${clsName}`;
      const cur = by.get(key) || { tlName, cls: clsName, group: classGroup(clsName), n: 0, nAll: 0, byStatus: {} };
      cur.n += c.in; cur.nAll += c.nAll;
      if (c.status) cur.byStatus[c.status] = (cur.byStatus[c.status] || 0) + c.nAll;
      by.set(key, cur);
    }
    return [...by.values()].filter((r) => r.n);
  }
  /** Tag Assignment: agent-wise stock. */
  async function loadStockAgent(opts) {
    const a = assignCfg();
    const map = await assignMap(opts);
    const agId = letterOf(map, 'agentId', a.agentId), agName = letterOf(map, 'agentName', a.agentName);
    const tlId = letterOf(map, 'tlId', a.tlId), tlNameL = letterOf(map, 'tlName', a.tlName);
    const tag = letterOf(map, 'tagId', a.tagId), st = letterOf(map, 'status', a.status);
    const t = await D.query('Tag Assignment', `select ${agId}, ${agName}, ${tlId}, ${tlNameL}, ${st}, count(${tag}) group by ${agId}, ${agName}, ${tlId}, ${tlNameL}, ${st} order by count(${tag}) desc`, opts);
    const by = new Map();
    for (const r of t.rows) {
      const agentId = U.clean(D.cellText(r[0])), agentName = U.clean(D.cellText(r[1])) || U.clean(D.cellText(r[0]));
      const tId = U.clean(D.cellText(r[2])), tName = U.clean(D.cellText(r[3]));
      if (isHeaderRow([agentId, agentName])) continue;
      const c = stockCounts(r[5], D.cellText(r[4]));
      const key = `${agentId}|${agentName}|${tId}|${tName}`;
      const cur = by.get(key) || { agentId, agentName, tlId: tId, tlName: tName, n: 0, nAll: 0, byStatus: {} };
      cur.n += c.in; cur.nAll += c.nAll;
      if (c.status) cur.byStatus[c.status] = (cur.byStatus[c.status] || 0) + c.nAll;
      by.set(key, cur);
    }
    return [...by.values()]
      .filter((r) => r.n)
      .map((r) => ({
        ...r, tlName: r.tlName || (r.tlId ? `TL ${r.tlId}` : 'Direct'), channel: 'GV Partner',
        directAgent: FF.config.isDirectAgent({ agentId: r.agentId, agentName: r.agentName, tlId: r.tlId, tlName: r.tlName, channel: 'GV Partner' }, 'gv')
      }));
  }
  /** Tag Assignment: agent × class. */
  async function loadStockAgentClass(opts) {
    const a = assignCfg();
    const map = await assignMap(opts);
    const agName = letterOf(map, 'agentName', a.agentName), cls = letterOf(map, 'cls', a.cls);
    const tag = letterOf(map, 'tagId', a.tagId), st = letterOf(map, 'status', a.status);
    const t = await D.query('Tag Assignment', `select ${agName}, ${cls}, ${st}, count(${tag}) group by ${agName}, ${cls}, ${st}`, opts);
    const by = new Map();
    for (const r of t.rows) {
      const agentName = U.clean(D.cellText(r[0]));
      const clsName = normClass(D.cellText(r[1]));
      if (isHeaderRow([agentName, clsName])) continue;
      const c = stockCounts(r[3], D.cellText(r[2]));
      const key = `${agentName}|${clsName}`;
      const cur = by.get(key) || { agentName, cls: clsName, group: classGroup(clsName), n: 0, nAll: 0, byStatus: {} };
      cur.n += c.in; cur.nAll += c.nAll;
      if (c.status) cur.byStatus[c.status] = (cur.byStatus[c.status] || 0) + c.nAll;
      by.set(key, cur);
    }
    return [...by.values()].filter((r) => r.n);
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
  /** GV REPORT me class ka detail: current month me VC5/VC6/VC7/VC12/VC16 columns aati hain (bache hue
   *  commercial tags = VC20), last month me sirf VC4 + NVC4 (commercial total) hota hai.
   *  Ye helper sheet ke numbers ko hi groups (VC4 · VC20 · VC5+) me badalta hai — kuch banata nahi. */
  function reportMonthBins(row, period) {
    if (!row) return null;
    const prefix = period === 'last' ? 'last' : 'cur';
    const raw = (key) => {
      const value = row[`${prefix}${key}`];
      return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value));
    };
    const vc4 = raw('Vc4'), comm = raw('Comm'), total = raw('Total');
    if (vc4 === null && comm === null && total === null) return null;
    const totalN = total !== null ? total : (vc4 !== null && comm !== null ? vc4 + comm : null);
    const bins = { VC4: vc4 || 0, VC20: null, 'VC5+': null, comm: comm || 0, total: totalN || 0, split: false };
    if (period === 'cur' && row.curClassAvailable) {
      const detail = ['VC5', 'VC6', 'VC7', 'VC12', 'VC16'].reduce((n, cls) => n + (Number(row.curByClass && row.curByClass[cls]) || 0), 0);
      bins['VC5+'] = detail;
      bins.VC20 = Math.max(0, bins.comm - detail);
      bins.split = true;
    }
    return bins;
  }
  function reportSheetBins(row) {
    return { last: reportMonthBins(row, 'last'), cur: reportMonthBins(row, 'cur') };
  }
  async function loadReport(opts) {
    const rc = reportCfg();
    const headerRow = rc.headerRow || 4;
    const lastCol = rc.lastCol || 'BE';
    const range = `A${headerRow}:${lastCol}`;
    const t = await D.query('GV REPORT', '', { ...opts, gid: rc.gid || (FF.config.tabBy('GV REPORT') || {}).gid || '', range });
    // 🧭 Heading se column verify/relocate — GV REPORT header row (row 4) me jo heading likhi hai,
    // usse hi confirm hota hai ki config ka letter wahi column hai (warna sheet ka column shift hone par
    // number chup-chaap galat aata rehta tha).
    const rmap = mapFields((t.cols || []).map((c) => c.label), REPORT_COLS, reportSynonyms());
    state.mapping.report = rmap;
    state.labels.report = (t.cols || []).map((c) => c.label || '');
    const colOf = (key) => (rmap.idx[key] !== undefined ? rmap.idx[key] : REPORT_COLS[key]);
    const cell = (row, key) => D.cellText(row[colOf(key)]);
    const num = (row, key) => D.cellNumber(row[colOf(key)]);
    const hasNum = (row, key) => { const value = num(row, key); return value !== null && value !== undefined; };
    // Sheet me cell khaali hai ya asli 0 — dono alag cheez hain. Ye flags decide karte hain ki GV REPORT
    // ko authoritative maana jaye ya tag-ledger (EIR / GV Master) se fallback lena pade.
    const AGENT_MONTH_COLS = {
      last: ['lastVc4', 'lastComm', 'lastTotal'],
      cur: ['curVc4', 'curComm', 'curTotal']
    };
    const CUR_CLASS_COLS = ['curVc4', 'curVc5', 'curVc6', 'curVc7', 'curVc12', 'curVc16'];
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
        // 🔎 Blank vs 0: GV REPORT hi GV ka live source hai. Jab sheet me cell bhari hui hai to wahi
        // number final mana jayega (tag-ledger sirf tab jab sheet ka period khaali ho).
        lastAvailable: AGENT_MONTH_COLS.last.some((key) => hasNum(r, key)),
        curAvailable: AGENT_MONTH_COLS.cur.some((key) => hasNum(r, key)),
        curClassAvailable: CUR_CLASS_COLS.some((key) => hasNum(r, key)),
        stockClassAvailable: ['stockVc12', 'stockVc16', 'stockVc4', 'stockVc5', 'stockVc6', 'stockVc7'].some((key) => hasNum(r, key)),
        tlStockAvailable: ['tlStockVc4', 'tlStockComm', 'tlStockTotal'].some((key) => hasNum(r, key)),
        expected: num(r, 'expected') || 0, runrateVc4: num(r, 'runrateVc4') || 0, runrateComm: num(r, 'runrateComm') || 0, runrate: num(r, 'runrate') || 0,
        // GV REPORT repeats the TL-level snapshot on every agent row. Preserve blank-vs-zero so
        // masterProfile can pick one TL snapshot instead of summing the repeated values (or
        // replacing them with an incomplete EIR roll-up).
        tlLastVc4: num(r, 'tlLastVc4'), tlLastComm: num(r, 'tlLastComm'), tlLastTotal: num(r, 'tlLastTotal'),
        tlLastAvailable: ['tlLastVc4', 'tlLastComm', 'tlLastTotal'].some((key) => hasNum(r, key)),
        tlCurVc4: num(r, 'tlCurVc4'), tlCurComm: num(r, 'tlCurComm'), tlCurTotal: num(r, 'tlCurTotal'),
        tlCurAvailable: ['tlCurVc4', 'tlCurComm', 'tlCurTotal'].some((key) => hasNum(r, key)),
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
  const identityId = (value) => U.clean(value).toUpperCase().replace(/[.]0+$/, '').replace(/\s+/g, '');
  const identityName = (value) => U.clean(value).toUpperCase().replace(/\s+/g, ' ');
  const masterTlIds = (r) => [...new Set([r && r.tlId, r && r.supervisorId, r && r.gvTlId].map(identityId).filter(Boolean))];
  const masterTlId = (r) => identityId(r && (r.tlId || r.supervisorId || r.gvTlId));

  /** GV Master ki ek tag row ko issuance views ke shared shape me rakho. */
  function masterIssuanceRow(r) {
    if (!r || !r.date) return null;
    const date = r.date;
    const tlId = U.clean(r.gvTlId);
    const replacement = /replacement/i.test(`${r.status || ''} ${r.tagType || ''}`);
    return {
      date, d: date, key: U.dateKey(date), ym: r.ym || U.ymKey(date), day: r.day || date.getDate(),
      cls: r.cls || normClass(''), group: r.group || classGroup(r.cls),
      type: replacement ? 'REPLACEMENT' : 'ISSUANCE', status: r.status || 'Issuance',
      tagType: r.tagType || 'Other', vrnType: r.tagType || '', channel: 'GV Partner',
      agentId: r.agentId || '', agentName: r.agentName || '', tlId,
      gvTlId: U.clean(r.gvTlId), tlName: r.tlName || (tlId ? `TL ${tlId}` : 'Direct'),
      tagId: r.tagId || '', vrn: r.vrn || '', serial: r.serial || '',
      amount: Number(r.amount) || 0, commission: Number(r.commission) || 0, n: 1,
      source: 'gv-master'
    };
  }
  /** Resolve the incoming/report TL identity, then attribute rows only by GV Master R (GV TL ID).
   * C (`supervisorId`) and TL name may crosswalk an old/report ID to R only when that mapping is unique;
   * neither C nor the name is used to count issuance rows. */
  function masterTlRows(tlId, tlName) {
    const wantedId = identityId(tlId), wantedName = identityName(tlName);
    if (wantedId) {
      const byId = rows().filter((r) => masterTlIds(r).includes(wantedId));
      if (byId.length) return byId;
    }
    if (!wantedName) return [];
    return rows().filter((r) => identityName(r.tlName) === wantedName);
  }
  function masterTlIdentity(tlId, tlName) {
    const match = masterTlRows(tlId, tlName)[0];
    return match ? U.clean(match.tlId || match.supervisorId || match.gvTlId) : '';
  }
  /**
   * TL-scoped GV issuance must use the real GV Master GV TL ID (column R), not a broad EIR rollup.
   * Returns null when there are no usable dated Master rows (caller may use its existing fallback).
   * Once any dated row identifies this TL, a month with no rows is an exact zero.
   */
  function tlIssuanceRows(tlId, tlName) {
    if (!Array.isArray(state.data.master)) return null;
    const matches = masterTlRows(tlId, tlName).map(masterIssuanceRow).filter(Boolean);
    return matches.length ? matches : null;
  }
  /** Agent-level GV drill uses the same canonical GV Master row set (unique_id / agent ID). */
  function agentIssuanceRows(agentId, agentName) {
    if (!Array.isArray(state.data.master)) return null;
    const wantedId = identityId(agentId), wantedName = identityName(agentName);
    let matches = [];
    if (wantedId) matches = rows().filter((r) => identityId(r.agentId) === wantedId);
    else if (wantedName) matches = rows().filter((r) => identityName(r.agentName) === wantedName);
    matches = matches.map(masterIssuanceRow).filter(Boolean);
    return matches.length ? matches : null;
  }

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
        agentId: r.agentId || '', agentName: r.agentName || '', tlId: r.tlId || r.supervisorId || r.gvTlId || '', supervisorId: r.supervisorId || '', gvTlId: r.gvTlId || '', tlName: r.tlName || '',
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
  const prevCalendarYm = (ym) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    if (!m) return '';
    let y = Number(m[1]), mo = Number(m[2]) - 1;
    if (mo < 1) { mo = 12; y -= 1; }
    return `${y}-${String(mo).padStart(2, '0')}`;
  };
  function gvPersonLookup() {
    const byId = new Map(), byName = new Map();
    const isChannelTl = (t) => {
      const c = U.clean(t).toLowerCase();
      const gvCh = U.clean((FF.config.eir && FF.config.eir.gvChannelTl) || 'ApnaPayment Pvt. Ltd.').toLowerCase();
      return !c || c === '—' || c === gvCh || /^apna\s*payment/i.test(c);
    };
    const add = (agentId, agentName, tlId, tlName) => {
      const id = U.clean(agentId), name = U.clean(agentName);
      const tId = U.clean(tlId), tName = isChannelTl(tlName) ? '' : U.clean(tlName);
      const rec = { agentId: id, agentName: name, tlId: tId, tlName: tName };
      if (id) {
        const k = id.toUpperCase();
        const prev = byId.get(k) || {};
        byId.set(k, { agentId: id || prev.agentId || '', agentName: name || prev.agentName || '', tlId: tId || prev.tlId || '', tlName: tName || prev.tlName || '' });
      }
      if (name && !isChannelTl(name)) {
        const k = name.toUpperCase();
        const prev = byName.get(k) || {};
        byName.set(k, { agentId: id || prev.agentId || '', agentName: name || prev.agentName || '', tlId: tId || prev.tlId || '', tlName: tName || prev.tlName || '' });
      }
    };
    for (const r of state.data.stockAgent || []) add(r.agentId, r.agentName, r.tlId, r.tlName);
    for (const r of state.data.report || []) add(r.agentId, r.agentName, r.tlId, r.tlName);
    for (const r of state.data.master || []) add(r.agentId, r.agentName, r.tlId, r.tlName);
    return {
      isChannelTl,
      resolve(agentId, agentName, tlId, tlName) {
        const id = U.clean(agentId), name = U.clean(agentName);
        const hit = (id && byId.get(id.toUpperCase())) || (name && byName.get(name.toUpperCase())) || {};
        const finalId = id || hit.agentId || '';
        const finalName = (!isChannelTl(name) && name) || hit.agentName || name || finalId || '';
        const finalTlId = U.clean(tlId) || hit.tlId || '';
        const rawTl = !isChannelTl(tlName) ? U.clean(tlName) : '';
        const finalTlName = rawTl || hit.tlName || (finalTlId ? `TL ${finalTlId}` : 'Direct');
        return { agentId: finalId, agentName: finalName, tlId: finalTlId, tlName: finalTlName };
      }
    };
  }
  function reportPrevYm() {
    const eirM = FF.model && eirDaily() ? FF.model.months(eirDaily().filter((r) => r.channel === 'GV Partner')) : [];
    const masM = masterMonths();
    const all = [...new Set([...eirM, ...masM])].filter(Boolean).sort();
    const cur = all[all.length - 1] || U.ymKey(new Date());
    return prevCalendarYm(cur);
  }
  function eirDailyRows() {
    const lk = gvPersonLookup();
    const fromEir = (eirDaily() || []).filter((r) => r.channel === 'GV Partner').map((r) => {
      const p = lk.resolve(r.agentId, r.agentName, r.tlId, r.tlName);
      return {
        date: r.d, d: r.d, key: r.key || (r.d ? U.dateKey(r.d) : ''), ym: r.ym, day: r.day, cls: r.cls, group: r.group, type: r.type,
        status: r.type, tagType: r.vrnType || '', vrnType: r.vrnType || '', channel: 'GV Partner',
        agentId: p.agentId, agentName: p.agentName, tlId: p.tlId, tlName: p.tlName, n: r.n
      };
    });
    // 🩹 GV Master supplement — EIR me agar us mahine ka koi bhi GV row hai to pehle poora mahina skip ho
    // jaata tha, isliye jo agent EIR me missing tha uska last-month drawer me 0 / GV REPORT se alag dikhta
    // tha. Ab row-by-row (tag-level) dedupe hota hai: EIR me jo tag pehle se hai wo dobara nahi judta,
    // baaki GV Master rows (GV ka asli ledger) add ho jaate hain.
    const seen = new Set();
    const seenAgg = new Set();
    const marker = (o) => {
      const key = o.key || (o.d ? U.dateKey(o.d) : '') || (o.date ? U.dateKey(o.date) : '');
      const tag = String(o.tagId || o.tag || '').trim().toUpperCase();
      if (tag) return `t|${key}|${tag}`;
      const vrn = String(o.vrn || '').trim().toUpperCase();
      if (vrn) return `v|${key}|${vrn}`;
      return `a|${key}|${o.agentId || U.clean(o.agentName).toUpperCase()}|${o.cls || ''}`;
    };
    (eirDaily() || []).filter((r) => r.channel === 'GV Partner').forEach((r) => {
      seen.add(marker(r));
      const hasTagOrVrn = String(r.tagId || r.tag || r.vrn || '').trim();
      if (!hasTagOrVrn) {
        const key = r.key || (r.d ? U.dateKey(r.d) : '') || (r.date ? U.dateKey(r.date) : '');
        const cls = normClass(r.cls || '');
        const p = lk.resolve(r.agentId, r.agentName, r.tlId, r.tlName);
        [p.agentId, p.agentName, r.agentId, r.agentName].forEach((who) => {
          const w = U.clean(who).toUpperCase();
          if (w && !lk.isChannelTl(w)) seenAgg.add(`a|${key}|${w}|${cls}`);
        });
      }
    });
    const tk = todayKey();
    for (const r of rows()) {
      const k = r.date ? U.dateKey(r.date) : '';
      if (!r.ym || k === tk) continue;
      const p = lk.resolve(r.agentId, r.agentName, r.tlId, r.tlName);
      const cls = normClass(r.cls || '');
      const coveredByAgg = [p.agentId, p.agentName, r.agentId, r.agentName, r.gvUniqueId, r.gvUniqueName].some((who) => {
        const w = U.clean(who).toUpperCase();
        return w && seenAgg.has(`a|${k}|${w}|${cls}`);
      });
      if (coveredByAgg) continue;
      const mk = marker({ key: k, tagId: r.tagId, vrn: r.vrn, agentId: p.agentId || r.agentId, agentName: p.agentName || r.agentName, cls });
      if (seen.has(mk)) continue;
      seen.add(mk);
      fromEir.push({
        date: r.date, d: r.date, key: k, ym: r.ym, day: r.day, cls: r.cls, group: r.group,
        type: /replace/i.test(`${r.status || ''} ${r.tagType || ''}`) ? 'REPLACEMENT' : 'ISSUANCE',
        status: r.status || 'Issuance', tagType: r.tagType || '', vrnType: r.tagType || '', channel: 'GV Partner',
        agentId: p.agentId, agentName: p.agentName, tlId: p.tlId, tlName: p.tlName, n: 1
      });
    }
    return fromEir;
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
    const lk = gvPersonLookup();
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
    const dailyRowsForYm = liveDailyRows().filter((r) => !ym || r.ym === ym);
    for (const r of dailyRowsForYm) {
      const k = `${r.ym}|${U.clean(r.agentName).toUpperCase()}`;
      if (!daySets.has(k)) daySets.set(k, new Set());
      daySets.get(k).add(r.key || U.dateKey(r.date || r.d));
    }
    const map = new Map();
    const put = (r, n, group, type) => {
      const rawName = U.clean(r.gvName || r.name || r.agentName) || 'Unknown';
      const key = `${r.ym || ym || ''}|${rawName.toUpperCase()}`;
      const m = meta.get(key) || {};
      const resolved = lk.resolve(r.id || r.agentId || r.gvId || m.id, rawName, r.tlId || m.tlId, r.tlName || m.tlName);
      const name = resolved.agentName || rawName;
      const id = resolved.agentId || name;
      const k = (id || name).toUpperCase();
      if (!map.has(k)) {
        const op = commission.get(`${r.ym || ym || ''}|${name.toUpperCase()}`) || commission.get(key) || { amount: 0, commission: 0 };
        const tlName = resolved.tlName || 'Direct';
        const direct = !tlName || /^(—|direct)$/i.test(tlName) || FF.config.isDirectAgent({ agentId: id, agentName: name, tlId: resolved.tlId, tlName, channel: 'GV Partner' }, 'gv');
        map.set(k, { agentId: id, agentName: name, tlId: resolved.tlId || '', tlName, channel: 'GV Partner', directAgent: direct,
          total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, replacement: 0, reportDays: 0, days: new Set(daySets.get(`${r.ym || ym || ''}|${name.toUpperCase()}`) || daySets.get(key) || []), byClass: {}, amount: op.amount, commission: op.commission });
      }
      const o = map.get(k); o.total += n;
      const exactClass = normClass(r.cls || group || 'NA');
      o.byClass[exactClass] = (o.byClass[exactClass] || 0) + n;
      if (group === 'VC4') o.vc4 += n; else if (group === 'VC20') { o.vc20 += n; o.comm += n; } else { o.vc5p += n; o.comm += n; }
      if (/replacement/i.test(type || '')) o.replacement += n;
    };
    const usableClasses = classes.filter((r) => !lk.isChannelTl(r.name));
    if (usableClasses.length) usableClasses.forEach((r) => put(r, Number(r.n) || 0, r.group, r.type));
    else if (dailyRowsForYm.length) dailyRowsForYm.forEach((r) => put(r, Number(r.n) || 1, r.group, r.type));
    else eirAgents().filter((r) => r.channel === 'GV Partner' && (!ym || r.ym === ym)).forEach((r) => put({ ...r, agentName: r.name, group: 'VC5+' }, Number(r.n) || 0, 'VC5+', 'ISSUANCE'));

    // 🔴 AAJ LIVE: EIR monthly rollup usually covers yesterday/T+1 only. Merge GV Master
    // today's rows even when the agent already exists in the EIR monthly map, otherwise Home/GV
    // Performance/TL rollups silently miss today's issuance for existing agents.
    const liveTodayRows = dailyRowsForYm.filter((r) => r.key === todayKey());
    if (liveTodayRows.length) {
      liveTodayRows.forEach((r) => put(r, Number(r.n) || 1, r.group, r.type));
    }

    // Fallback/enrich from GV REPORT Last Month (e.g. September 2026-09) when viewing previous month
    const prevYm = reportPrevYm();
    if (ym && ym === prevYm && Array.isArray(state.data.report)) {
      for (const rep of state.data.report) {
        const lastVc4 = Number(rep.lastVc4) || 0;
        const lastComm = Number(rep.lastComm) || 0;
        const lastTot = Math.max(Number(rep.lastTotal) || 0, lastVc4 + lastComm);
        if (lastTot <= 0) continue;
        const res = lk.resolve(rep.agentId, rep.agentName, rep.tlId, rep.tlName);
        const id = res.agentId || rep.agentId || res.agentName;
        const name = res.agentName || rep.agentName || id;
        const k = (id || name).toUpperCase();
        let o = map.get(k);
        if (!o) {
          // Check if matched by name key
          for (const [, v] of map.entries()) {
            if (U.clean(v.agentName).toUpperCase() === U.clean(name).toUpperCase()) { o = v; break; }
          }
        }
        if (!o) {
          const tlName = res.tlName || 'Direct';
          const direct = !tlName || /^(—|direct)$/i.test(tlName) || FF.config.isDirectAgent({ agentId: id, agentName: name, tlId: res.tlId, tlName, channel: 'GV Partner' }, 'gv');
          o = { agentId: id, agentName: name, tlId: res.tlId || '', tlName, channel: 'GV Partner', directAgent: direct,
            total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, replacement: 0, reportDays: Number(rep.lastDays) || 0, days: new Set(), byClass: {}, amount: 0, commission: 0 };
          map.set(k, o);
        }
        if (rep.lastDays && !o.reportDays) o.reportDays = Number(rep.lastDays) || 0;
        if (lastVc4 > o.vc4) {
          const diff = lastVc4 - o.vc4;
          o.vc4 = lastVc4;
          o.byClass.VC4 = (o.byClass.VC4 || 0) + diff;
        }
        if (lastComm > o.comm) {
          const diff = lastComm - o.comm;
          o.comm = lastComm;
          o.vc5p += diff;
          o.byClass['VC5+'] = (o.byClass['VC5+'] || 0) + diff;
        }
        o.total = Math.max(o.total, o.vc4 + o.comm, lastTot);
      }
    }

    return [...map.values()].map((a) => {
      const actDays = a.days.size || a.reportDays || 0;
      return { ...a, activeDays: actDays, avgPerDay: actDays ? a.total / actDays : 0 };
    }).sort((a, b) => b.total - a.total);
  }
  function eirSummary(ym, upToDay) {
    const s = FF.model.summary(liveDailyRows(), ym, upToDay, 'GV Partner');
    const people = eirPeopleRollup(ym);
    if (!upToDay && people.length) {
      const pTotal = people.reduce((acc, a) => acc + (a.total || 0), 0);
      const pVc4 = people.reduce((acc, a) => acc + (a.vc4 || 0), 0);
      const pVc20 = people.reduce((acc, a) => acc + (a.vc20 || 0), 0);
      const pVc5p = people.reduce((acc, a) => acc + (a.vc5p || 0), 0);
      const pComm = people.reduce((acc, a) => acc + (a.comm || 0), 0);
      const pRepl = people.reduce((acc, a) => acc + (a.replacement || 0), 0);
      if (pTotal > s.total) {
        s.total = pTotal;
        s.vc4 = Math.max(s.vc4 || 0, pVc4);
        s.vc20 = Math.max(s.vc20 || 0, pVc20);
        s.vc5p = Math.max(s.vc5p || 0, pVc5p);
        s.comm = Math.max(s.comm || 0, pComm);
        s.replacement = Math.max(s.replacement || 0, pRepl);
        s.newIssuance = Math.max(0, s.total - s.replacement);
      }
    }
    s.agents = new Set(people.filter((a) => a.total > 0).map((a) => a.agentId));
    s.tls = new Set(people.filter((a) => a.total > 0 && !a.directAgent).map((a) => a.tlName || 'Direct'));
    s.directSet = new Set(people.filter((a) => a.total > 0 && a.directAgent).map((a) => a.agentId));
    // v3.31: aaj ke LIVE GV Master rows ke agents bhi (EIR rollup kal tak hi hota hai) — warna 1 tareekh ko
    // MTD 34 tags par "Active agents 0" dikhta tha aur drill-down me 20 agents.
    const known = new Set([...s.agents].map((x) => U.clean(x).toUpperCase()));
    for (const r of liveDailyRows()) {
      if (r.ym !== ym || (upToDay && r.day > upToDay)) continue;
      const id = U.clean(r.agentId) || U.clean(r.agentName);
      if (!id || known.has(id.toUpperCase())) continue;
      known.add(id.toUpperCase()); s.agents.add(id);
      const direct = FF.config.isDirectAgent ? FF.config.isDirectAgent({ ...r, channel: 'GV Partner' }, 'gv') : !U.clean(r.tlName);
      if (direct) s.directSet.add(id); else s.tls.add(r.tlName || 'Direct');
    }
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
  function months() {
    const base = eirReady() ? FF.model.months(liveDailyRows()) : masterMonths();
    const set = new Set([...base, ...masterMonths()]);
    if (Array.isArray(state.data.report) && state.data.report.some((r) => (Number(r.lastTotal) || Number(r.lastVc4) || Number(r.lastComm)) > 0)) {
      const prev = reportPrevYm();
      if (prev) set.add(prev);
    }
    return [...set].filter(Boolean).sort();
  }
  // latestDate() is on every profile's hot path (U.channelBasis('gv', { force: true }) → gvLatest → here) and
  // used to rebuild the whole EIR→GV issuance rollup just to read one date. Master Search / Summary do that
  // once per TL and per agent, so a real-size GV sheet froze the tab for ~15 s. The answer only depends on
  // the arrays below (loaders replace them, never mutate in place) and on today's date, so reuse it.
  const lenOf = (a) => (Array.isArray(a) ? a.length : -1);
  /** Identity of everything issuanceRows() / liveDailyRows() / latestDate() are computed from. */
  function inputsKey() {
    const daily = eirDaily();
    const d = state.data;
    // + the one admin setting that changes how rows are attributed (resolve() → isChannelTl), so a Settings edit is never served stale.
    return [daily, lenOf(daily), d.master, lenOf(d.master), d.stockAgent, lenOf(d.stockAgent), d.report, lenOf(d.report), todayKey(), (FF.config && FF.config.eir && FF.config.eir.gvChannelTl) || ''];
  }
  const sameKey = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
  const latestMemo = { key: null, value: null };
  function latestDate() {
    const key = [FF.model && FF.model.latestDate, ...inputsKey()];
    if (sameKey(latestMemo.key, key)) return latestMemo.value;
    const value = eirReady() ? FF.model.latestDate(liveDailyRows()) : masterLatestDate();
    latestMemo.key = key; latestMemo.value = value;
    return value;
  }
  function summary(ym, upToDay) { return eirReady() ? eirSummary(ym, upToDay) : masterSummary(ym, upToDay); }
  function dailySeries(ym, dimFn) { return eirReady() ? FF.model.dailySeries(liveDailyRows(), ym, dimFn) : masterDailySeries(ym, dimFn); }
  function byDim(ym, dimFn, upToDay) {
    if (!eirReady()) return masterByDim(ym, dimFn, upToDay);
    const source = liveDailyRows().filter((r) => !ym || r.ym === ym).filter((r) => !upToDay || r.day <= upToDay);
    const map = new Map();
    if (source.length) {
      source.forEach((r) => { const k = dimFn(r); map.set(k, (map.get(k) || 0) + r.n); });
      return map;
    }
    if (!upToDay && ym) {
      for (const a of eirPeopleRollup(ym)) {
        const classes = Object.entries(a.byClass || {});
        if (classes.length) {
          for (const [cls, n] of classes) {
            const fakeRow = { ym, cls, group: classGroup(cls), type: 'ISSUANCE', status: 'ISSUANCE', tagType: 'VRN', vrnType: 'VRN', channel: 'GV Partner', agentId: a.agentId, agentName: a.agentName, tlId: a.tlId, tlName: a.tlName, n };
            const k = dimFn(fakeRow);
            map.set(k, (map.get(k) || 0) + n);
          }
        }
      }
    }
    return map;
  }
  function agentRollup(ym) { return eirReady() ? eirPeopleRollup(ym) : masterAgentRollup(ym); }
  function tlRollup(ym) { return eirReady() ? eirTlRollup(ym) : masterTlRollup(ym); }
  function directRollup(ym) { return eirReady() ? eirDirectRollup(ym) : masterDirectRollup(ym); }
  // GV issuance rows = EIR history + GV Master ka aaj (live). GV pages/sprint/tag-issued sab yahi use karte hain.
  function issuanceRows() { return eirReady() ? liveDailyRows() : rows(); }
  // Consumers that only read the rows (masterProfile builds one profile per TL / agent) may reuse the result
  // while this key is unchanged. Host/test stubs that replace issuanceRows() don't carry it, so they are never cached.
  issuanceRows.inputsKey = inputsKey;

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
    DATASETS, preload, refresh, need, get, error, reset, enabled, wanted, retryNow,
    normClass, classGroup, clsNum,
    rows, masterRows: rows, issuanceRows, tlIssuanceRows, masterTlIdentity, masterTlIds, agentIssuanceRows, eirDailyRows, liveDailyRows, gvToday, masterTodayRows, todayKey, months, latestDate, summary, dailySeries, weekly, byDim, agentRollup, tlRollup, directRollup, people,
    REPORT_COLS, REPORT_COLS_LABELS, reportMonthBins, reportSheetBins,
    mapping, mappingWarnings, ensureAssignmentMap, stockStatusKind,
    get labels() { return state.labels; },
    get state() { return state; },
    get loadedAt() { return state.loadedAt; },
    get loading() { return state.loading; }
  };
  FF.gv = GV;
})(window.FF);