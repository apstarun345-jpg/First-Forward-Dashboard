/* 🏷️ IDFC AGENTS TAG REQUEST (v3.25 → v3.30) — panel ka option + bina login employee link.
 *
 * v3.30 flow (employee link /tag-request aur login form — dono same):
 *   1. 👤 Employee      — upar sirf EMPLOYEE ka naam (office wala jo request laga raha hai).
 *   2. 🧑 Agent blocks  — har agent ka: naam/ID search (agents + TL dropdown, ID/TL/channel auto),
 *                          📱 mobile · 🏠 full address · 📮 pincode · class-wise qty (VERTICAL list:
 *                          VC4·VC5·VC6·VC7·VC12·VC16). "➕ Add new agent" se naya block. Agent ne
 *                          employee se tag maange → employee uski request yahan bharta hai.
 *   3. 📤 Submit        — system chup-chaap sheet data check karta hai (stock / last month / MTD —
 *                          🚗 VC4+VC20 aur 🚚 VC5+ alag) aur snapshot saath bhejta hai. Server HAR AGENT
 *                          ki alag request banata hai (apna ID / status / edit / label).
 *   4. 🔎 Status        — employee link par agent ke MOBILE number (ya Request ID) se status.
 *   5. 📥 Tag Requests  — admin: har request EK ROW me (koi "Kholo" nahi) — stock total + 🚗/🚚,
 *                          last month, current MTD, run rate, expected, growth %, requested qty
 *                          (class-wise ✏️ edit wahin), ✅ approve, address. Upar ☑ select →
 *                          🖨️ Print selected (har request ka label sirf EK baar), ✅ Approve, ⬇ CSV.
 *   6. ⚙️ Link & Sheet  — employee link ON/OFF + fields, 📗 Google Sheet sync (alag tab me).
 *
 * Data source (koi naya bhaari query nahi — sab pehle se load hota hai):
 *   • FF.store 'agentClass' → EIR class × month rows (issuance — canonical)
 *   • performance page (REPORT) → agent stock class-wise, priority, TL naam, VC20 bins
 *   • GV REPORT (gv.get('report')) → GV agent stock/issuance class-wise + priority
 *   • admin (login) par exact stock: FF 'stockAgents' + GV 'stockAgentClass' (VC20 alag)
 */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const fmt = (n, d) => U.fmt(Number(n) || 0, d);
  const num = (v) => Number(v) || 0;

  const CLASS_LIST = ['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16'];
  const CLASS_LABEL = { VC4: 'VC4 (Car/Jeep)', VC5: 'VC5 (Bus 2 axle)', VC6: 'VC6 (Truck 3 axle)', VC7: 'VC7 (Truck 4-6 axle)', VC12: 'VC12 (Truck 7+ axle)', VC16: 'VC16 (HCM/EME)' };
  const CLASS_DESC = (c) => { const m = /\((.*)\)/.exec(CLASS_LABEL[c] || ''); return m ? m[1] : ''; };
  const STOCK_KEY = { VC4: 'stockVc4', VC5: 'stockC1', VC6: 'stockC2', VC7: 'stockC3', VC12: 'stockC4', VC16: 'stockC5' };
  const CUR_KEY = { VC4: 'curVc4', VC5: 'curC1', VC6: 'curC2', VC7: 'curC3', VC12: 'curC4', VC16: 'curC5' };
  const LAST_KEY = { VC4: 'lastVc4', VC5: 'lastC1', VC6: 'lastC2', VC7: 'lastC3', VC12: 'lastC4', VC16: 'lastC5' };
  const STATUS = {
    pending: { label: '⏳ Pending', tone: 'amber' },
    approved: { label: '✅ Approved', tone: 'green' },
    dispatched: { label: '🚚 Dispatched', tone: 'blue' },
    rejected: { label: '⛔ Rejected', tone: 'red' }
  };
  const STATUS_KEYS = ['pending', 'approved', 'dispatched', 'rejected'];
  const PAGE_ROWS = 150; // requests table — pehle itni rows, phir "⬇ Aur dikhao" (mobile par fast)

  const state = {
    view: 'form', rows: [], note: '', result: null, problems: [], busy: '',
    index: null, indexPromise: null, exact: null, exactPromise: null,
    // 📝 form
    employee: { name: '', office: '' }, errs: {}, formCfg: null, formCfgPromise: null,
    // 🌐 public (bina login)
    publicMode: false, publicCfg: null, done: null,
    status: { q: '', list: null, busy: false, err: '', searched: '' },
    // 🔁 submit se pehle duplicate check (wahi agent + class pehle se active?)
    dup: { list: [], force: false, busy: false },
    // 📥 requests table
    requests: [], requestsAt: 0, reqLoaded: false, reqError: '',
    sel: new Set(), filter: { status: 'all', q: '' }, edit: null, limit: PAGE_ROWS, dview: [],
    sheet: { loaded: false, busy: false, config: null, fields: null, connected: false, hint: '', publicForm: null }
  };
  const rid = () => Math.random().toString(36).slice(2, 9);
  const emptyQty = () => { const q = {}; CLASS_LIST.forEach((c) => { q[c] = ''; }); return q; };
  function newRow(patch) { return { id: rid(), agentId: '', name: '', tl: '', channel: '', tlFilter: '', isTl: false, dispatchName: '', q: emptyQty(), mobile: '', address: '', pincode: '', ...(patch || {}) }; }
  if (!state.rows.length) state.rows = [newRow()];

  const norm = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ' ');
  const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const round1 = (v) => Math.round(num(v) * 10) / 10;
  const ymNow = () => U.ymKey(new Date());
  const ymLast = () => U.prevMonthKey(ymNow());
  const isAdmin = () => !!(FF.auth && FF.auth.user && FF.auth.user.role === 'admin');
  const isPublic = () => !!state.publicMode;
  const me = () => (FF.auth && FF.auth.user && FF.auth.user.username) || '';
  /** Employees ko bhejne wala seedha form link — v3.27 se ye BINA LOGIN khulta hai. */
  function shareLink() {
    try { return `${location.origin}/tag-request`; }
    catch { return '/tag-request'; }
  }
  /** Google Sheet link → ID (target sheet preview ke liye; asli parsing server par hoti hai). */
  const sheetIdOfLink = (link) => { const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/.exec(String(link || '')); return m ? m[1] : ''; };
  const dateLabel = (at) => { try { return new Date(at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); } catch { return ''; } };
  const timeLabelShort = (at) => { try { return new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const longDate = (at) => { try { return new Date(at || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; } };
  const ago = (at) => { try { return U.timeLabel(new Date(at).getTime()); } catch { return ''; } };

  // ---- 👤 employee (device par yaad rehta hai) + public API -----------------------------------------
  const PUB_EMPLOYEE_KEY = 'ff_public_employee';
  const AGENT_BOOK_KEY = 'ff_tr_agent_contacts';
  function loadEmployee() {
    try {
      const raw = localStorage.getItem(PUB_EMPLOYEE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) || {};
      if (!clean(state.employee.name)) state.employee.name = String(o.name || '').slice(0, 80);
      if (!clean(state.employee.office)) state.employee.office = String(o.office || '').slice(0, 80);
    } catch { /* private mode / bad JSON */ }
  }
  function saveEmployee() {
    try { localStorage.setItem(PUB_EMPLOYEE_KEY, JSON.stringify({ name: state.employee.name, office: state.employee.office })); } catch { /* ignore */ }
  }
  /** 📇 Agent ka pichla mobile/address/pincode (isi device par) — wahi agent dobara chuno to auto-fill. */
  function agentBook() {
    try { return JSON.parse(localStorage.getItem(AGENT_BOOK_KEY) || '{}') || {}; } catch { return {}; }
  }
  function rememberAgents(agents) {
    try {
      const book = agentBook();
      agents.forEach((a) => {
        const key = `${a.channel}|${norm(a.agentName)}`;
        if (a.agentName && (a.mobile || a.address)) book[key] = { mobile: a.mobile, address: a.address, pincode: a.pincode, at: Date.now() };
      });
      const keys = Object.keys(book).sort((x, y) => num(book[y].at) - num(book[x].at));
      const trimmed = {};
      keys.slice(0, 200).forEach((k) => { trimmed[k] = book[k]; });
      localStorage.setItem(AGENT_BOOK_KEY, JSON.stringify(trimmed));
    } catch { /* ignore */ }
  }
  /** Public endpoints (koi cookie/session nahi) — login wale FF.auth.api ki jagah. */
  function publicApi(path, method, body) {
    if (FF.publicForm && FF.publicForm.api) return FF.publicForm.api(path, method, body);
    return fetch(path, { method: method || 'GET', body: body ? JSON.stringify(body) : undefined, headers: body ? { 'Content-Type': 'application/json' } : undefined }).then(async (res) => {
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `HTTP ${res.status}`);
      return json || {};
    });
  }
  /** Form config (mandatory fields): public = link ka config; login form bhi wahi rules (server same check karta hai). */
  const formCfg = () => (isPublic() ? (state.publicCfg || {}) : (state.formCfg || {}));
  function loadFormCfg() {
    if (isPublic() || state.formCfg) return Promise.resolve(state.formCfg);
    if (state.formCfgPromise) return state.formCfgPromise;
    state.formCfgPromise = publicApi('/api/public/tag-request').then((out) => { state.formCfg = (out && out.config) || {}; return state.formCfg; })
      .catch(() => { state.formCfg = {}; return state.formCfg; })
      .finally(() => { state.formCfgPromise = null; });
    return state.formCfgPromise;
  }

  // ---- 📚 index: agent → stock / issuance / TL / priority (+ 🚗 VC4+VC20 · 🚚 VC5+ groups) ----------
  /** 🚗 core = VC4 + VC20 (car/jeep) · 🚚 comm = VC5+ (commercial). */
  const groupOf = (cls, group) => {
    const g = String(group || '');
    if (g === 'VC4' || g === 'VC20') return 'core';
    if (g === 'VC5+') return 'comm';
    const c = String(cls || '').toUpperCase().replace(/\s+/g, '');
    return c === 'VC4' || c === 'VC20' ? 'core' : 'comm';
  };
  const emptyGroups = () => ({ core: { stock: 0, last: 0, cur: 0 }, comm: { stock: 0, last: 0, cur: 0 } });
  /** EIR class-month rows ko agent key par jama karo (class-wise + group-wise). */
  function addEir(map, channel, name, id, tl, row) {
    const key = `${channel}|${norm(name) || digits(id)}`;
    const rec = map.get(key) || {
      channel, name: name || id || key, agentId: digits(id), tlName: tl || '',
      stock: {}, cur: {}, last: {}, eirCur: {}, eirLast: {}, growth: null, priority: '', grp: emptyGroups()
    };
    if (id && !rec.agentId) rec.agentId = digits(id);
    if (name && (!rec.name || rec.name === key)) rec.name = name;
    if (tl && !rec.tlName) rec.tlName = tl;
    const ym = row.ym, cls = String(row.cls || '').toUpperCase();
    // v3.31: channel ka DATA month (FF kal tak · GV live) — 1 tareekh ko FF ka "current" = pichhla month.
    const mo = monthsFor(channel);
    // Group (VC20 bhi) — class list se pehle, warna VC20 chhoot jaata
    const g = groupOf(cls, row.group);
    rec.eirG = rec.eirG || { cur: { core: 0, comm: 0 }, last: { core: 0, comm: 0 }, hasCur: false, hasLast: false };
    if (ym === mo.cur) { rec.eirG.cur[g] += num(row.n); rec.eirG.hasCur = true; }
    if (ym === mo.last) { rec.eirG.last[g] += num(row.n); rec.eirG.hasLast = true; }
    map.set(key, rec);
    if (!CLASS_LIST.includes(cls)) return rec;
    if (ym === mo.cur) rec.eirCur[cls] = num(rec.eirCur[cls]) + num(row.n);
    if (ym === mo.last) rec.eirLast[cls] = num(rec.eirLast[cls]) + num(row.n);
    return rec;
  }
  /** Channel ka data month + uska pichhla month (index build ke waqt ek baar). */
  let idxMonths = null;
  function monthsFor(channel) {
    const ch = channel === 'gv' ? 'gv' : 'ff';
    if (idxMonths && idxMonths[ch]) return idxMonths[ch];
    const cur = basisYm(ch);
    return { cur, last: U.prevMonthKey(cur) };
  }
  /** Poora index — REPORT (FF) + GV REPORT (GV) + EIR class-month. Ek baar banta hai, 60s cache. */
  async function buildIndex(force) {
    if (!force && state.index && Date.now() - state.index.at < 60e3) return state.index;
    if (state.indexPromise) return state.indexPromise;
    const S = FF.store;
    const perf = FF.pages.performance;
    // 🌐 Public form: sirf zaroori datasets (`only`) + light performance load — Google par kam load.
    const light = isPublic();
    const only = light ? { only: true } : undefined;
    const jobs = [
      S && S.need ? S.need('agentClass', only).catch(() => []) : Promise.resolve([]),
      perf && perf.ensureLoaded ? perf.ensureLoaded(light ? { light: true } : undefined).then(() => (perf.agents ? perf.agents() : [])).catch(() => []) : Promise.resolve([]),
      FF.gv && FF.gv.need ? FF.gv.need('report').then(() => (FF.gv.get('report') || [])).catch(() => []) : Promise.resolve([])
    ];
    state.indexPromise = Promise.all(jobs).then(([eirRows, ffAgents, gvRows]) => {
      idxMonths = null;
      idxMonths = { ff: monthsFor('ff'), gv: monthsFor('gv') };
      const byKey = new Map();
      const tls = new Map();
      const tlOf = (channel, tlName) => {
        const t = String(tlName || '').trim();
        if (!t || !FF.config.isRealTl(t)) return null;
        const key = `${channel}|${norm(t)}`;
        const g = tls.get(key) || { key, name: t, channel, stock: {}, cur: {}, last: {}, agents: new Set(), priority: '', grp: emptyGroups() };
        tls.set(key, g);
        return g;
      };
      const put = (channel, name, id, tlName, patch) => {
        const key = `${channel}|${norm(name) || digits(id)}`;
        const rec = byKey.get(key) || { channel, name: name || id, agentId: digits(id), tlName: tlName || '', stock: {}, cur: {}, last: {}, eirCur: {}, eirLast: {}, priority: '', growth: null, grp: emptyGroups() };
        if (id && !rec.agentId) rec.agentId = digits(id);
        if (name && (!rec.name || rec.name === key)) rec.name = name;
        if (tlName && !rec.tlName) rec.tlName = tlName;
        Object.assign(rec, patch || {});
        byKey.set(key, rec);
        const g = tlOf(channel, rec.tlName);
        if (g) { g.agents.add(key); if (!g.priority && rec.priority) g.priority = rec.priority; }
        return rec;
      };
      // 🟦 First Forward — REPORT (stock class-wise, current month class-wise, priority, VC20 bins)
      (ffAgents || []).forEach((a) => {
        const stock = {}, cur = {}, last = {};
        CLASS_LIST.forEach((cls) => {
          stock[cls] = num(a[STOCK_KEY[cls]]);
          cur[cls] = num(a[CUR_KEY[cls]]);
          last[cls] = num(a[LAST_KEY[cls]]);
        });
        const comm = CLASS_LIST.slice(1).reduce((s, c) => s + stock[c], 0);
        const core = stock.VC4 + Math.max(0, num(a.stockTotal) - stock.VC4 - comm); // VC20 = total − VC4 − VC5+
        const cb = a.curBins, lb = a.lastBins;
        const grp = {
          core: { stock: core, cur: cb ? num(cb.VC4) + num(cb.VC20) : num(a.curVc4), last: lb ? num(lb.VC4) + num(lb.VC20) : num(a.lastVc4) },
          comm: { stock: comm, cur: cb ? num(cb['VC5+']) : num(a.curNvc4), last: lb ? num(lb['VC5+']) : num(a.lastNvc4) }
        };
        put('ff', a.name, a.agentId, a.tlName, { stock, cur, last, grp, priority: String(a.agentPriority || a.priority || '').trim(), growth: a.growth, direct: !!a.tlExcluded });
      });
      // 🟩 GV Partner — GV REPORT (stock/issuance class-wise + priority)
      (gvRows || []).forEach((r) => {
        const stock = {}, cur = {}, last = {};
        CLASS_LIST.forEach((cls) => {
          stock[cls] = num(r.stockByClass && r.stockByClass[cls]);
          cur[cls] = num(r.curByClass && r.curByClass[cls]);
          last[cls] = cls === 'VC4' ? num(r.lastVc4) : 0;
        });
        const split = (vc4, comm, total) => { const c = num(comm); const core = num(vc4) + Math.max(0, num(total) - num(vc4) - c); return { core, comm: c }; };
        const commStock = num(r.stockComm) || CLASS_LIST.slice(1).reduce((s, c) => s + stock[c], 0);
        const st = split(r.stockVc4, commStock, r.stockTotal), cu = split(r.curVc4, r.curComm, r.curTotal), la = split(r.lastVc4, r.lastComm, r.lastTotal);
        const grp = { core: { stock: st.core, cur: cu.core, last: la.core }, comm: { stock: st.comm, cur: cu.comm, last: la.comm } };
        put('gv', r.agentName, r.agentId, r.tlName, { stock, cur, last, grp, priority: String(r.priority || '').trim(), growth: r.growth });
      });
      // 🗂️ EIR class-month rows — authoritative issuance (FF + GV dono channel)
      (eirRows || []).forEach((row) => {
        const channel = row.channel === 'GV Partner' ? 'gv' : 'ff';
        addEir(byKey, channel, row.name, '', row.tlName, row);
        const rec = byKey.get(`${channel}|${norm(row.name)}`);
        const g = tlOf(channel, row.tlName || (rec && rec.tlName));
        if (g && rec) g.agents.add(`${channel}|${norm(rec.name)}`);
      });
      // Final: EIR (agar mila) REPORT se upar — issuance ka canonical source; warna REPORT value.
      byKey.forEach((rec) => {
        CLASS_LIST.forEach((cls) => {
          if (rec.eirCur[cls] !== undefined) rec.cur[cls] = num(rec.eirCur[cls]);
          if (rec.eirLast[cls] !== undefined) rec.last[cls] = num(rec.eirLast[cls]);
        });
        if (!rec.grp) rec.grp = emptyGroups();
        if (rec.eirG && rec.eirG.hasCur) { rec.grp.core.cur = rec.eirG.cur.core; rec.grp.comm.cur = rec.eirG.cur.comm; }
        if (rec.eirG && rec.eirG.hasLast) { rec.grp.core.last = rec.eirG.last.core; rec.grp.comm.last = rec.eirG.last.comm; }
        const g = tlOf(rec.channel, rec.tlName);
        if (g) {
          CLASS_LIST.forEach((cls) => {
            g.stock[cls] = num(g.stock[cls]) + num(rec.stock[cls]);
            g.cur[cls] = num(g.cur[cls]) + num(rec.cur[cls]);
            g.last[cls] = num(g.last[cls]) + num(rec.last[cls]);
          });
          ['core', 'comm'].forEach((k) => ['stock', 'last', 'cur'].forEach((f) => { g.grp[k][f] += num(rec.grp && rec.grp[k] && rec.grp[k][f]); }));
        }
      });
      // Search list (form ke dropdown + lookup ke liye).
      const list = [...byKey.values()].map((r) => ({
        key: `${r.channel}|${norm(r.name)}`, channel: r.channel, name: r.name, agentId: r.agentId, tlName: r.tlName, priority: r.priority
      }));
      state.index = { at: Date.now(), byKey, tls, list, cur: idxMonths.ff.cur, last: idxMonths.ff.last, months: idxMonths };
      return state.index;
    }).catch((err) => {
      console.warn('tagRequest index:', err && err.message);
      state.index = { at: Date.now(), byKey: new Map(), tls: new Map(), list: [], cur: ymNow(), last: ymLast(), error: err };
      return state.index;
    }).finally(() => { state.indexPromise = null; });
    return state.indexPromise;
  }
  /** 🎯 Admin (login) — exact agent stock (StockDataa + GV Tag Assignment) → VC4+VC20 / VC5+ bilkul sahi.
   *  Public form par nahi (wo data public nahi hai) — wahan REPORT se nikla stock hi chalta hai. */
  function loadExactStock() {
    if (isPublic()) return Promise.resolve(null);
    if (state.exact) return Promise.resolve(state.exact);
    if (state.exactPromise) return state.exactPromise;
    const S = FF.store;
    state.exactPromise = Promise.all([
      S && S.need ? S.need('stockAgents').catch(() => []) : Promise.resolve([]),
      FF.gv && FF.gv.need && FF.auth && FF.auth.can && (FF.auth.can('gvStock') || isAdmin())
        ? FF.gv.need('stockAgentClass').then(() => (FF.gv.get('stockAgentClass') || [])).catch(() => []) : Promise.resolve([])
    ]).then(([ff, gv]) => {
      const m = new Map();
      const add = (key, row) => { const e = m.get(key) || { core: 0, comm: 0 }; e[groupOf(row.cls, row.group)] += num(row.n); m.set(key, e); };
      (Array.isArray(ff) ? ff : []).forEach((r) => {
        if (digits(r.agentId)) add(`ff|id:${digits(r.agentId)}`, r);
        if (r.agentName && r.agentName !== '—') add(`ff|n:${norm(r.agentName)}`, r);
      });
      (Array.isArray(gv) ? gv : []).forEach((r) => { if (r.agentName) add(`gv|n:${norm(r.agentName)}`, r); });
      state.exact = m.size ? m : null;
      return state.exact;
    }).catch(() => null).finally(() => { state.exactPromise = null; });
    return state.exactPromise;
  }
  /** Form row ke liye agent record dhoondo — ID (digits), exact naam ya partial naam se (fuzzy). */
  function findAgent(q, channel) {
    const idx = state.index;
    if (!idx) return null;
    const text = String(q || '').trim();
    if (!text) return null;
    const d = digits(text);
    if (d.length >= 4) {
      const hit = idx.list.find((a) => a.agentId && (a.agentId === d || a.agentId.endsWith(d)));
      if (hit) return idx.byKey.get(hit.key) || null;
    }
    const n = norm(text);
    const exact = idx.list.filter((a) => norm(a.name) === n);
    if (exact.length === 1) return idx.byKey.get(exact[0].key) || null;
    if (exact.length > 1) return idx.byKey.get((channel ? exact.find((a) => a.channel === channel) || exact[0] : exact[0]).key) || null;
    const starts = idx.list.filter((a) => norm(a.name).startsWith(n));
    if (starts.length) return idx.byKey.get(starts[0].key) || null;
    const includes = idx.list.filter((a) => norm(a.name).includes(n));
    return includes.length ? (idx.byKey.get(includes[0].key) || null) : null;
  }
  /** Sirf PAKKA match (dropdown se chuna / exact ID / exact naam) — galat agent se request na jud jaaye. */
  function exactAgent(row) {
    const idx = state.index;
    if (!idx || !row) return null;
    if (row.isTl) return tlRecord(row.channel, row.name);
    const pick = (list) => { if (!list.length) return null; const hit = (row.channel && list.find((a) => a.channel === row.channel)) || list[0]; return idx.byKey.get(hit.key) || null; };
    const id = digits(row.agentId);
    if (id.length >= 3) { const r = pick(idx.list.filter((a) => a.agentId && a.agentId === id)); if (r) return r; }
    const text = String(row.name || '').trim();
    if (!text) return null;
    const d = digits(text);
    if (d.length >= 4 && d.length === text.replace(/[\s#-]/g, '').length) { const r = pick(idx.list.filter((a) => a.agentId === d)); if (r) return r; }
    return pick(idx.list.filter((a) => norm(a.name) === norm(text)));
  }
  /** 👥 TL ko ek "record" ki tarah (stock / cur / last / grp) — TL ke naam par bhi request ban sake. */
  function tlRecord(channel, name) {
    const idx = state.index;
    if (!idx) return null;
    const g = idx.tls.get(`${channel === 'gv' ? 'gv' : 'ff'}|${norm(name)}`);
    if (!g) return null;
    if (!g.rec) g.rec = { ...g, agentId: '', tlName: g.name, isTl: true };
    return g.rec;
  }
  /** TL ke saare agents (stock / last / cur ke saath) — TL pick karte hi poora data dikhane ke liye. */
  function tlAgents(g) {
    const idx = state.index;
    if (!idx || !g) return [];
    return [...(g.agents || [])].map((k) => idx.byKey.get(k)).filter(Boolean)
      .map((r) => { const m = groupMetrics(r); return { key: `${r.channel}|${norm(r.name)}`, name: r.name, agentId: r.agentId, channel: r.channel, stock: num(m.core.stock) + num(m.comm.stock), last: num(m.core.last) + num(m.comm.last), cur: num(m.core.cur) + num(m.comm.cur), priority: r.priority }; })
      .sort((a, b) => b.cur - a.cur || b.stock - a.stock);
  }
  /** Saved request ke agent ka live record (admin table) — ID ya exact naam, channel same. */
  function lookupAgent(a) {
    const idx = state.index;
    if (!idx || !a) return null;
    const ch = a.channel === 'gv' ? 'gv' : 'ff';
    if (a.kind === 'tl') return tlRecord(ch, a.name);
    const id = digits(a.agentId);
    let hit = id ? idx.list.find((x) => x.agentId === id && x.channel === ch) : null;
    if (!hit && a.name) hit = idx.list.find((x) => x.channel === ch && norm(x.name) === norm(a.name)) || idx.list.find((x) => norm(x.name) === norm(a.name));
    return hit ? idx.byKey.get(hit.key) || null : null;
  }
  const coverOf = (avg, stock) => (avg > 0 ? stock / avg : null);
  /** Channel ka sahi run-rate divisor: FF = T−1 (aaj ka data kal aata hai), GV = live aaj. */
  const basisDays = (channel) => {
    try {
      const b = U.channelBasis && U.channelBasis(channel === 'gv' ? 'gv' : 'ff');
      return Number(b && b.days) > 0 ? Number(b.days) : U.runRateDays();
    } catch { return U.runRateDays(); }
  };
  const perDay = (issued, channel) => num(issued) / basisDays(channel);
  /** Data month (YYYY-MM) — FF kal tak ka data (1 tareekh = pichhla month), GV live. Expected isi month ke din se. */
  const basisYm = (channel) => { try { const b = U.channelBasis && U.channelBasis(channel === 'gv' ? 'gv' : 'ff'); return (b && b.ym) || ymNow(); } catch { return ymNow(); } };
  const priorityFor = (cover, fallback) => {
    // Sheet me priority emoji ke saath aati hai ("🟢 Low", "🟡 Medium"…) — clean label banao.
    const raw = String(fallback || '').replace(/[^\p{L}]+/gu, ' ').trim();
    const hit = /high|medium|low/i.exec(raw);
    if (hit) return hit[0][0].toUpperCase() + hit[0].slice(1).toLowerCase();
    if (cover == null) return 'Low';
    return cover < 7 ? 'High' : cover < 15 ? 'Medium' : 'Low';
  };
  const growthOf = (cur, last) => (last > 0 ? ((cur - last) / last) * 100 : (cur > 0 ? 100 : 0));
  /** Ek agent × class ka system data (form hint + submit snapshot + preview). */
  function classData(rec, c) {
    const cur = num(rec.cur[c]), last = num(rec.last[c]), stock = num(rec.stock[c]);
    const avg = perDay(cur, rec.channel); // FF ka run-rate T−1 basis par, GV ka live basis par
    const pair = U.suggestPair(avg, stock);
    const cover = coverOf(avg, stock);
    return { cur, last, stock, avg, cover, priority: priorityFor(cover, rec.priority), growth: growthOf(cur, last), sugNet: pair.net, sugGross: pair.gross, days: pair.days };
  }
  /** 🚗 / 🚚 group snapshot — submit ke saath jaata hai, admin table bhi isi shape ko padhta hai. */
  function groupMetrics(rec) {
    const g = rec.grp || emptyGroups();
    const exact = state.exact ? (state.exact.get(`${rec.channel}|id:${rec.agentId}`) || state.exact.get(`${rec.channel}|n:${norm(rec.name)}`)) : null;
    return {
      core: { stock: exact ? exact.core : num(g.core.stock), last: num(g.core.last), cur: num(g.core.cur) },
      comm: { stock: exact ? exact.comm : num(g.comm.stock), last: num(g.comm.last), cur: num(g.comm.cur) },
      days: basisDays(rec.channel), ym: basisYm(rec.channel), exactStock: !!exact
    };
  }
  /** Snapshot → dikhane wale numbers: run rate = MTD ÷ din · expected = month-end projection ·
   *  growth = expected vs last month (MTD vs poora last month galat tulna hoti). */
  function metricNumbers(m) {
    const days = Math.max(1, num(m && m.days) || 1);
    const ym = (m && m.ym) || ymNow();
    const part = (g) => {
      const cur = num(g && g.cur), last = num(g && g.last);
      const exp = U.projectMonthEnd(cur, days, ym);
      return { stock: num(g && g.stock), last, cur, rate: cur / days, exp, growth: last > 0 ? ((exp - last) / last) * 100 : (exp > 0 ? null : 0) };
    };
    const core = part(m && m.core), comm = part(m && m.comm);
    const total = part({ stock: core.stock + comm.stock, last: core.last + comm.last, cur: core.cur + comm.cur });
    return { core, comm, total, days, ym };
  }
  /** TL-wise phir agent-wise sort (preview result ke liye). */
  const tlSortKey = (t) => (!t || t === '—' ? 'zzzz' : norm(t));
  function sortRows(rows, by) {
    const clsRank = (c) => CLASS_LIST.indexOf(c);
    return [...rows].sort((a, b) => {
      if (by !== 'agent') {
        const t = tlSortKey(a.tl).localeCompare(tlSortKey(b.tl));
        if (t) return t;
      }
      const n = norm(a.agentName).localeCompare(norm(b.agentName));
      if (n) return n;
      return clsRank(a.cls) - clsRank(b.cls);
    });
  }

  // ---- 🔍 system check (headless preview / assistant) --------------------------------------------
  /**
   * Form rows ko resolve karke class-wise requirement nikaalo.
   * `useSuggestion` = blank qty par system suggestion (preview/assistant path ka purana behaviour).
   */
  function analyze(useSuggestion) {
    const problems = [];
    const out = [];
    const tlMap = new Map();
    let serial = 0;
    for (const row of state.rows) {
      if (!String(row.agentId || row.name || '').trim()) continue;             // khaali row chhod do
      const rec = findAgent(row.name || row.agentId, row.channel);
      if (!rec) { problems.push(`"${row.name || row.agentId}" data me nahi mila — ID/naam check karo (sheet me row honi chahiye).`); continue; }
      const qty = row.q || {};
      const active = CLASS_LIST.filter((c) => {
        const v = String(qty[c] === undefined ? '' : qty[c]).trim();
        return v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
      });
      const anyListed = CLASS_LIST.some((c) => (row.classes || []).includes(c));
      if (!active.length && !useSuggestion && !anyListed) { problems.push(`${rec.name} — kam se kam ek class me qty daalo (0 ya khaali = skip).`); continue; }
      const classesToUse = active.length ? active : (useSuggestion || anyListed ? CLASS_LIST.filter((c) => (row.classes || []).includes(c)) : []);
      if (!classesToUse.length) { problems.push(`${rec.name} — kam se kam ek Tag Class chuno.`); continue; }
      if (!out.some((x) => x.agentKey === `${rec.channel}|${norm(rec.name)}`)) serial++;
      for (const c of classesToUse) {
        const d = classData(rec, c);
        const asked = String(qty[c] === undefined ? '' : qty[c]).trim();
        const approved = asked !== '' && Number.isFinite(Number(asked)) ? Math.max(0, Math.round(Number(asked))) : (useSuggestion ? d.sugNet : 0);
        out.push({
          id: rid(), agentKey: `${rec.channel}|${norm(rec.name)}`, agentId: rec.agentId, agentName: rec.name,
          tl: rec.tlName || '—', channel: rec.channel, cls: c, last: d.last, cur: d.cur, stock: d.stock, avg: d.avg, cover: d.cover, growth: d.growth, priority: d.priority,
          sugNet: d.sugNet, sugGross: d.sugGross, approved, remark: '', days: d.days
        });
        const tlKey = `${rec.channel}|${norm(rec.tlName)}`;
        if (rec.tlName && FF.config.isRealTl(rec.tlName)) {
          const g = tlMap.get(tlKey) || (state.index && state.index.tls.get(tlKey)) || { name: rec.tlName, channel: rec.channel, stock: {}, cur: {}, last: {}, priority: '', agents: new Set() };
          const tl = tlMap.get(tlKey) || { name: g.name, channel: g.channel, stock: { ...(g.stock || {}) }, cur: { ...(g.cur || {}) }, last: { ...(g.last || {}) }, priority: g.priority || '', agents: new Set(g.agents || []), reqNet: 0, reqGross: 0, reqApproved: 0, reqAgents: new Set() };
          tl.reqNet += d.sugNet; tl.reqGross += d.sugGross; tl.reqApproved += approved;
          tl.reqAgents.add(rec.name);
          tlMap.set(tlKey, tl);
        }
      }
    }
    tlMap.forEach((tl) => {
      const cover = coverOf(perDay(num(tl.cur.VC4), tl.channel), num(tl.stock.VC4));
      tl.cover = cover;
      tl.priority = priorityFor(cover, tl.priority);
      tl.agentsCount = tl.agents.size;
      tl.reqAgentCount = tl.reqAgents.size;
    });
    state.problems = problems;
    state.result = out.length ? {
      rows: sortRows(out), tls: [...tlMap.values()].sort((a, b) => (a.cover == null ? 999 : a.cover) - (b.cover == null ? 999 : b.cover)),
      at: new Date().toISOString(), agentCount: serial, days: U.suggestDays(), note: state.note
    } : null;
    return state.result;
  }

  // ---- 🖨️ Dispatch labels — har chuni request ka label sirf EK baar (A4, 2 columns) -----------------
  /* FROM = Settings → 📲 Contacts (contacts.fromName/fromAddress/fromPhone).
   * TO   = agent ka naam · mobile · address · pincode (v3.30 request). Purani request (v3.27) me
   *        delivery employee ke address par thi — tab TO = employee + "Agent:" line.
   * Print page par per-page (8/10/12) aur text size buttons; PDF = print dialog me "Save as PDF". */
  function dispatchFrom() {
    const st = (FF.auth && FF.auth.settings) || {};
    const c = st.contacts || {};
    const brand = st.brand || FF.config.brand || 'First Forward';
    return {
      name: String(c.fromName || '').trim() || brand,
      address: String(c.fromAddress || '').trim(),
      phone: String(c.fromPhone || '').trim(),
      has: !!(String(c.fromName || '').trim() || String(c.fromAddress || '').trim() || String(c.fromPhone || '').trim())
    };
  }
  /** Delivery kiske paas: v3.30 = agent ka contact; purani request = employee ka. */
  function contactOf(r) {
    const a = r.agent || {};
    if (a.mobile || a.address || a.pincode) return { who: 'agent', name: a.dispatchName || a.name || '', dispatchName: a.dispatchName || '', mobile: a.mobile || '', address: a.address || '', pincode: a.pincode || '' };
    const e = r.employee || {};
    return { who: 'employee', name: e.name || r.byName || '', mobile: e.mobile || '', address: e.address || '', pincode: e.pincode || '' };
  }
  const clsRank = (c) => { const i = CLASS_LIST.indexOf(String(c || '').toUpperCase()); return i < 0 ? 99 : i; };
  /** Request → ek label ka data (classes approved qty ke saath; sab 0 ho to requested). */
  function labelItem(r) {
    const rows = [...(r.rows || [])].sort((a, b) => clsRank(a.cls) - clsRank(b.cls));
    const byCls = new Map();
    rows.forEach((x) => { const k = String(x.cls || '').toUpperCase(); if (k) byCls.set(k, num(byCls.get(k)) + num(x.approved)); });
    const classes = [...byCls.entries()].filter(([, q]) => q > 0).map(([cls, qty]) => ({ cls, qty }));
    const agents = [...new Set(rows.map((x) => x.agentName).filter(Boolean))];
    const agentName = (r.agent && r.agent.name) || agents[0] || '';
    return {
      id: String(r.id || ''), date: longDate(r.at), status: r.status || 'pending', to: contactOf(r),
      classes, total: classes.reduce((s, x) => s + x.qty, 0),
      employee: (r.employee && r.employee.name) || r.byName || r.by || '',
      agentName, agentId: (r.agent && r.agent.agentId) || (rows[0] && rows[0].agentId) || '',
      agents: agents.length, forTl: !!(r.agent && r.agent.kind === 'tl'), tl: (r.agent && r.agent.tl) || (rows[0] && rows[0].tl !== '—' ? rows[0].tl : '') || ''
    };
  }
  /** Label par agent / TL ka reference line (dispatch name alag ho ya purani employee request ho tab). */
  function agentRef(it) {
    const t = it.to || {};
    if (t.who === 'employee' && it.agentName) return `Agent: ${it.agentName}${it.agents > 1 ? ` +${it.agents - 1}` : ''}`;
    if (t.dispatchName && it.agentName && t.dispatchName.trim().toLowerCase() !== it.agentName.trim().toLowerCase()) return `${it.forTl ? 'TL' : 'Agent'}: ${it.agentName}`;
    return '';
  }
  /** Plain-text label — copy / WhatsApp share ke liye. */
  function labelText(r) {
    const f = dispatchFrom();
    const it = labelItem(r);
    const t = it.to;
    return [
      `FROM: ${f.name}${f.address ? `, ${f.address}` : ''}${f.phone ? ` · Ph: ${f.phone}` : ''}`,
      '',
      `TO: ${t.name || ''}`,
      t.mobile ? `Mob: ${t.mobile}` : '',
      t.address ? `Address: ${t.address}` : '',
      t.pincode ? `Pincode: ${t.pincode}` : '',
      ...(agentRef(it) ? [agentRef(it)] : []),
      '',
      `Request: ${it.id} · ${it.date} · ${it.total} tags${it.classes.length ? ` (${it.classes.map((c) => `${c.cls}×${c.qty}`).join(', ')})` : ''}`
    ].filter((x) => x !== '' && x !== undefined).join('\n');
  }
  /** Poora printable HTML — har item ka EK label (dobara repeat nahi). `rows` = A4 par label rows
   *  (4/5/6 → 8/10/12 labels per page), `size` = text pt. */
  function labelsHtml(items, opts) {
    const o = opts || {};
    const list = (Array.isArray(items) ? items : []).filter(Boolean);
    const f = dispatchFrom();
    const pt = [9, 10.5, 12, 14].includes(Number(o.size)) ? Number(o.size) : 10.5;
    const rowsPerPage = [3, 4, 5, 6].includes(Number(o.rows)) ? Number(o.rows) : 5;
    const hOf = (n) => ((283 - (n - 1) * 2.5) / n).toFixed(1); // label height (mm)
    const fromLine = `<div class="from"><b>FROM:</b> ${esc(f.name)}${f.address ? `<br>${esc(f.address)}` : ''}${f.phone ? `<br>☏ ${esc(f.phone)}` : ''}</div>`;
    const cells = list.map((it) => {
      const t = it.to || {};
      const cls = it.classes.length ? it.classes.map((c) => `${esc(c.cls)} × ${fmt(c.qty)}`).join(' · ') : '—';
      const agentLine = agentRef(it) ? `<div class="to-agent">${esc(agentRef(it))}</div>` : '';
      const meta = `Req ${esc(it.id.slice(-10))} · ${esc(it.date)}${it.employee ? ` · Emp: ${esc(it.employee)}` : ''}${it.tl ? ` · TL ${esc(it.tl)}` : ''}${it.agentId && t.who === 'agent' ? ` · ID ${esc(it.agentId)}` : ''}`;
      return `<div class="lbl">${fromLine}<div class="to"><span class="tag">TO</span><b class="to-name">${esc(t.name || '')}</b>${t.mobile ? `<div class="to-mob">☏ ${esc(t.mobile)}</div>` : ''}${t.address ? `<div class="to-addr">${esc(t.address)}</div>` : ''}${t.pincode ? `<div class="to-pin">PIN: ${esc(t.pincode)}</div>` : ''}${agentLine}</div><div class="cls">🏷️ ${cls} = <b>${fmt(it.total)} tags</b></div><div class="meta">${meta}</div></div>`;
    }).join('');
    const totalTags = list.reduce((s, it) => s + num(it.total), 0);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Dispatch labels · ${list.length}</title>
<style>
@page { size: A4; margin: 6mm; }
* { box-sizing: border-box; }
body { font-family: Arial, "Segoe UI", sans-serif; color: #111; margin: 0; }
.bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: #fff; border-bottom: 1px solid #bbb; padding: 6px 8px; font-size: 13px; }
.bar button { border: 1px solid #999; background: #fff; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 13px; }
.bar .grp { display: inline-flex; gap: 0; align-items: center; }
.bar .grp button { border-radius: 0; margin-left: -1px; }
.bar .grp button:first-of-type { border-radius: 6px 0 0 6px; }
.bar .grp button:last-of-type { border-radius: 0 6px 6px 0; }
.bar button.on { background: #2563eb; color: #fff; border-color: #2563eb; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5mm; padding: 2mm 0; }
.lbl { border: 1.4px dashed #111; border-radius: 2mm; padding: 2.5mm 3mm; height: ${hOf(rowsPerPage)}mm; overflow: hidden; page-break-inside: avoid; break-inside: avoid; font-size: ${pt}pt; line-height: 1.3; display: flex; flex-direction: column; }
.from { font-size: 66%; color: #333; border-bottom: 1px dotted #999; padding-bottom: 1.2mm; margin-bottom: 1.4mm; }
.to { flex: 1; min-height: 0; overflow: hidden; }
.to .tag { font-size: 64%; font-weight: 700; border: 1px solid #111; padding: 0 3px; border-radius: 2px; margin-right: 4px; }
.to-name { font-size: 117%; font-weight: 800; }
.to-mob { font-weight: 700; margin-top: 0.6mm; }
.to-addr { margin-top: 0.6mm; }
.to-pin { font-size: 150%; font-weight: 900; letter-spacing: 0.5px; margin-top: 0.8mm; }
.to-agent { font-size: 80%; margin-top: 0.6mm; }
.cls { font-size: 82%; border-top: 1px dotted #999; margin-top: 1.2mm; padding-top: 0.9mm; }
.meta { font-size: 60%; color: #444; margin-top: 0.6mm; }
.empty { padding: 30px; text-align: center; color: #666; }
@media print { .bar { display: none; } body { margin: 0; } }
</style></head><body>
<div class="bar"><b>🖨️ Dispatch labels — ${list.length} request${list.length === 1 ? '' : 's'} · ${fmt(totalTags)} tags (har label ek hi baar)</b>
  <button id="pbtn" style="font-weight:700">🖨️ Print</button>
  <button id="pdfbtn" style="font-weight:700;background:#16a34a;color:#fff;border-color:#16a34a">📄 Download PDF</button>
  <span>Text size: <span class="grp"><button class="sz" data-sz="9">A−</button><button class="sz" data-sz="10.5">A</button><button class="sz" data-sz="12">A+</button><button class="sz" data-sz="14">A++</button></span></span>
  <span>Per page: <span class="grp"><button class="rp" data-rows="4">8</button><button class="rp" data-rows="5">10</button><button class="rp" data-rows="6">12</button></span></span>
  <span style="color:#666;font-size:12px">📄 Download PDF = seedha PDF file (same label format) — dispatch team ko bhejo.</span></div>
<div class="grid">${cells || '<div class="empty">Koi request select nahi hui.</div>'}</div>
</body></html>`;
  }
  /** 📄 Labels → PDF (direct download) — print wale label ka hi format: FROM · TO (naam/mobile/address/PIN) · class qty. */
  function labelsPdf(items, opts) {
    const o = opts || {};
    const list = (Array.isArray(items) ? items : []).filter(Boolean);
    if (!FF.pdf || !list.length) return null;
    const f = dispatchFrom();
    const pt = [9, 10.5, 12, 14].includes(Number(o.size)) ? Number(o.size) : 10.5;
    const rowsPerPage = [3, 4, 5, 6].includes(Number(o.rows)) ? Number(o.rows) : 5;
    const MMPT = 25.4 / 72;
    const W = 210, H = 297, MG = 6, GAP = 2.5;
    const lw = (W - 2 * MG - GAP) / 2, lh = (283 - (rowsPerPage - 1) * 2.5) / rowsPerPage;
    const perPage = rowsPerPage * 2;
    const FONT = FF.pdf.FONT;
    const canvases = [];
    for (let start = 0; start < list.length; start += perPage) {
      const pg = FF.pdf.page(W, H);
      const { ctx, px } = pg;
      list.slice(start, start + perPage).forEach((it, n) => {
        const col = n % 2, rowI = Math.floor(n / 2);
        const x0 = MG + col * (lw + GAP), y0 = MG + rowI * (lh + GAP);
        const t = it.to || {};
        const fnt = (pct, w) => { ctx.font = `${w || 400} ${px(pt * MMPT * pct)}px ${FONT}`; };
        const line = (xa, ya, xb, dash) => { ctx.save(); ctx.strokeStyle = dash ? '#888' : '#111'; ctx.lineWidth = px(0.25); ctx.setLineDash(dash ? [px(0.5), px(0.7)] : []); ctx.beginPath(); ctx.moveTo(px(xa), px(ya)); ctx.lineTo(px(xb), px(ya)); ctx.stroke(); ctx.restore(); };
        // dashed border
        ctx.save(); ctx.strokeStyle = '#111'; ctx.lineWidth = px(0.35); ctx.setLineDash([px(1.6), px(1.1)]);
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(px(x0), px(y0), px(lw), px(lh), px(2)); else ctx.rect(px(x0), px(y0), px(lw), px(lh)); ctx.stroke(); ctx.restore();
        const ix = x0 + 3, iw = lw - 6;
        let y = y0 + 2.5;
        const text = (str, pct, w, color, gapAfter) => {
          fnt(pct, w); ctx.fillStyle = color || '#111';
          const lines = FF.pdf.wrap(ctx, str, px(iw));
          const step = pt * MMPT * pct * 1.28;
          lines.forEach((l) => { y += step; ctx.fillText(l, px(ix), px(y - step * 0.22)); });
          y += gapAfter || 0;
        };
        // FROM
        text(`FROM: ${f.name}${f.address ? `, ${f.address}` : ''}${f.phone ? `  ☏ ${f.phone}` : ''}`, 0.66, 500, '#333', 1);
        line(ix, y, ix + iw, true); y += 1.6;
        // TO
        fnt(0.64, 700); ctx.fillStyle = '#111';
        const tagW = ctx.measureText('TO').width / pg.k + 2.4;
        ctx.save(); ctx.strokeStyle = '#111'; ctx.lineWidth = px(0.25); ctx.strokeRect(px(ix), px(y + 0.3), px(tagW), px(pt * MMPT * 0.64 * 1.25)); ctx.restore();
        ctx.fillText('TO', px(ix + 1.2), px(y + 0.3 + pt * MMPT * 0.64 * 1.0));
        fnt(1.17, 800); ctx.fillStyle = '#111';
        const nameLines = FF.pdf.wrap(ctx, t.name || '', px(iw - tagW - 1.5));
        const nstep = pt * MMPT * 1.17 * 1.28;
        nameLines.forEach((l, i) => { y += i === 0 ? nstep * 0.95 : nstep; ctx.fillText(l, px(ix + tagW + 1.5), px(y)); });
        y += 0.6;
        if (t.mobile) text(`☏ ${t.mobile}`, 1, 700);
        if (t.address) text(t.address, 1, 400);
        if (t.pincode) text(`PIN: ${t.pincode}`, 1.5, 900, '#111', 0.4);
        const aref = agentRef(it);
        if (aref) text(aref, 0.8, 400);
        // bottom: classes + meta (label ke neeche anchor)
        const cls = it.classes.length ? it.classes.map((c) => `${c.cls} × ${fmt(c.qty)}`).join(' · ') : '—';
        const meta = `Req ${String(it.id).slice(-10)} · ${it.date}${it.employee ? ` · Emp: ${it.employee}` : ''}${it.tl ? ` · TL ${it.tl}` : ''}${it.agentId && t.who === 'agent' ? ` · ID ${it.agentId}` : ''}`;
        fnt(0.6, 400);
        const metaLines = FF.pdf.wrap(ctx, meta, px(iw)).slice(0, 2);
        fnt(0.82, 400);
        const clsLines = FF.pdf.wrap(ctx, `${cls} = ${fmt(it.total)} tags`, px(iw)).slice(0, 2);
        const hMeta = metaLines.length * pt * MMPT * 0.6 * 1.28, hCls = clsLines.length * pt * MMPT * 0.82 * 1.28;
        let yb = y0 + lh - 2.2 - hMeta - hCls - 1.6;
        line(ix, yb, ix + iw, true); yb += 0.6;
        fnt(0.82, 700); ctx.fillStyle = '#111';
        clsLines.forEach((l) => { yb += pt * MMPT * 0.82 * 1.28; ctx.fillText(l, px(ix), px(yb - 0.6)); });
        fnt(0.6, 400); ctx.fillStyle = '#444';
        metaLines.forEach((l) => { yb += pt * MMPT * 0.6 * 1.28; ctx.fillText(l, px(ix), px(yb - 0.4)); });
      });
      canvases.push(pg.canvas);
    }
    return FF.pdf.build(canvases);
  }
  /** Chuni requests → PDF download (print popup ki zaroorat nahi). */
  async function downloadPdf(requests, opts) {
    const items = uniqueRequests(requests).map(labelItem);
    if (!items.length) { U.toast('Pehle ☑ requests select karo', 'warn'); return false; }
    try { if (FF.lazy && FF.lazy.need) await FF.lazy.need('pdf'); } catch { /* ignore */ }
    if (!FF.pdf) { U.toast('PDF module load nahi hua — page refresh karo', 'err'); return false; }
    const blob = labelsPdf(items, opts || { size: 10.5, rows: 5 });
    if (!blob) { U.toast('PDF nahi bana', 'err'); return false; }
    const name = items.length === 1 ? `dispatch-label-${items[0].id.slice(-8)}.pdf` : `dispatch-labels-${items.length}-${new Date().toISOString().slice(0, 10)}.pdf`;
    FF.pdf.download(blob, name);
    U.toast(`📄 PDF download ho gayi — ${items.length} label${items.length === 1 ? '' : 's'}`, 'ok');
    if (!dispatchFrom().has && isAdmin()) U.toast('ℹ️ FROM address Settings → 📲 Contacts me bharo — label par wahi aata hai', 'info');
    return true;
  }
  /** Ek request ka label HTML (purana export — smoke/tests isi ko use karte hain). Ab 1 request = 1 label. */
  function dispatchLabelHtml(r, opts) {
    return labelsHtml([labelItem(r)], opts);
  }
  /** Har request sirf EK baar (same ID dobara aaye to chhod do) — print kabhi repeat na ho. */
  function uniqueRequests(requests) {
    const seen = new Set();
    return (Array.isArray(requests) ? requests : []).filter((r) => r && r.id && !seen.has(r.id) && seen.add(r.id));
  }
  /** Print window ke buttons opener se bind karo — popup ke andar inline <script> site ki CSP se block hota hai
   *  (isi wajah se pehle Print / size / per-page buttons kaam nahi karte the). */
  function wireLabelWindow(w, requests) {
    const doc = w.document;
    const H = {}; [3, 4, 5, 6].forEach((n) => { H[n] = `${((283 - (n - 1) * 2.5) / n).toFixed(1)}mm`; });
    const st = { size: 10.5, rows: 5 };
    const each = (sel, fn) => Array.prototype.forEach.call(doc.querySelectorAll(sel), fn);
    const mark = (sel, attr, v) => each(sel, (b) => b.classList.toggle('on', b.getAttribute(attr) === String(v)));
    mark('.sz', 'data-sz', st.size); mark('.rp', 'data-rows', st.rows);
    each('.sz', (b) => b.addEventListener('click', () => { st.size = Number(b.getAttribute('data-sz')); each('.lbl', (l) => { l.style.fontSize = `${st.size}pt`; }); mark('.sz', 'data-sz', st.size); }));
    each('.rp', (b) => b.addEventListener('click', () => { st.rows = Number(b.getAttribute('data-rows')); each('.lbl', (l) => { l.style.height = H[st.rows]; }); mark('.rp', 'data-rows', st.rows); }));
    const pb = doc.getElementById('pbtn');
    if (pb) pb.addEventListener('click', () => { try { w.focus(); w.print(); } catch { /* ignore */ } });
    const pdfb = doc.getElementById('pdfbtn');
    if (pdfb) pdfb.addEventListener('click', () => { downloadPdf(requests, { size: st.size, rows: st.rows }); });
  }
  /** Print window kholo — har request ek hi baar. */
  function openPrint(requests) {
    const uniq = uniqueRequests(requests);
    const items = uniq.map(labelItem);
    if (!items.length) { U.toast('Pehle ☑ requests select karo', 'warn'); return; }
    const w = window.open('', '_blank', 'width=1000,height=800');
    if (!w || !w.document) { U.toast('Popup block ho gaya — 📄 PDF download button use karo ya browser me popups allow karo', 'warn'); return; }
    w.document.open(); w.document.write(labelsHtml(items, { size: 10.5, rows: 5 })); w.document.close();
    wireLabelWindow(w, uniq);
    try { w.focus(); } catch { /* ignore */ }
    if (!dispatchFrom().has && isAdmin()) U.toast('ℹ️ FROM address Settings → 📲 Contacts me bharo — label par wahi aata hai', 'info');
  }

  // ---- 🔁 duplicate warning (submit se pehle) ----------------------------------------------------
  function dupWarningHtml() {
    const list = (state.dup && state.dup.list) || [];
    if (!list.length) return '';
    const rows = list.map((d) => {
      const v = STATUS[d.status] || STATUS.pending;
      const same = (d.matched || []).slice(0, 4).join(', ');
      return `<li><b class="mono">${esc(d.id)}</b> <span class="badge ${v.tone}">${v.label}</span>
        <small class="dim"> · ${fmt(d.total)} tags${d.agentName ? ` · ${esc(d.agentName)}` : ` · ${fmt(d.rows)} rows`}${d.byName ? ` · by ${esc(d.byName)}` : ''} · ${esc(ago(d.at))}${same ? ` · same: ${esc(same)}${(d.matched || []).length > 4 ? '…' : ''}` : ''}</small></li>`;
    }).join('');
    return `<section class="card tr-dup-warn" id="tr-dup-card"><div class="card-body">
      <h3 style="margin:0 0 6px">🔁 Ye entry pehle se hai</h3>
      <p style="margin:0 0 8px"><b>${esc(state.employee.name || '')}</b>, isi agent (wahi class) ki <b>${fmt(list.length)} request already active</b> hai — kisi bhi employee ne daali ho. Status dekh lo, dobara bhejne ki zaroorat nahi. Phir bhi nayi request chahiye to <b>"🔁 Phir bhi bhejo"</b> dabao.</p>
      <ul class="tr-dup-list">${rows}</ul>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn primary" data-tr-act="dup-status" data-id="${esc(list[0].id || '')}">🔎 Status dekho</button>
        <button class="btn" data-tr-act="dup-force">🔁 Phir bhi bhejo</button>
        <button class="btn" data-tr-act="dup-edit">✏️ Form me wapas</button>
      </div></div></section>`;
  }

  // ---- 🖼️ shell: head + tabs ------------------------------------------------------------------------
  let rootEl = null;
  const bodyEl = () => (rootEl ? rootEl.querySelector('#tr-body') : null);
  function renderRoot() {
    if (!rootEl) return;
    syncTabs();
    const body = bodyEl();
    if (body && body.classList) body.classList.toggle('tr-no-check', isPublic() && !!state.publicCfg && state.publicCfg.showCheck === false);
    if (isPublic()) {
      if (state.view === 'done' && state.done) return renderDone();
      if (state.view === 'status') return renderStatus();
      return renderForm();
    }
    if (state.view === 'requests') return renderRequests();
    if (state.view === 'settings' && isAdmin()) return renderSettings();
    return renderForm();
  }
  function syncTabs() {
    if (!rootEl || !rootEl.querySelectorAll) return;
    const v = state.view === 'done' ? 'form' : state.view;
    rootEl.querySelectorAll('[data-tr-view]').forEach((b) => b.classList.toggle('on', b.dataset.trView === v));
  }
  const tabsHtml = () => {
    const v = state.view === 'done' ? 'form' : state.view;
    const tab = (id, label) => `<button class="seg-btn ${v === id ? 'on' : ''}" data-tr-view="${id}">${label}</button>`;
    // 🌐 Employee link: sirf Form + Status (Result tab hata diya — system check submit ke saath hota hai)
    if (isPublic()) return `<div class="seg" id="tr-tabs">${tab('form', '📝 Form')}${tab('status', '🔎 Status')}</div>`;
    return `<div class="seg" id="tr-tabs">${tab('form', '📝 Form')}${tab('requests', isAdmin() ? '📥 Tag Requests' : '📥 Meri requests')}${isAdmin() ? tab('settings', '⚙️ Link & Sheet') : ''}</div>`;
  };
  function headHtml() {
    if (isPublic()) {
      const cfg = state.publicCfg || {};
      const brand = cfg.brand || 'First Forward';
      const logo = cfg.logo ? `<img class="tr-public-logo" src="${esc(cfg.logo)}" alt="${esc(brand)}">` : `<span class="tr-public-logo mono">${esc(String(brand).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span>`;
      return `<div class="page-head tr-public-head"><div>
          <div class="tr-public-brand">${logo}<div><b>${esc(brand)}</b><small class="dim">${esc(cfg.tagline || 'Dashboard')}</small></div></div>
          <h1>🏷️ ${esc(cfg.title || 'IDFC Agents Tag Request')}</h1>
          <p class="sub">${esc(cfg.intro || 'Employee form — login ki zaroorat nahi. Upar apna naam likho, phir har agent ka naam, mobile, address, pincode aur class-wise qty bharo. Admin ko request turant mil jaayegi.')}</p>
        </div>
        <div class="head-actions">${tabsHtml()}</div></div>`;
    }
    return `<div class="page-head"><div><h1>🏷️ Tag Request</h1><p class="sub">IDFC Agents Tag Request — upar employee ka naam, neeche har agent ka block (naam · mobile · address · pincode · class-wise qty). Admin: 📥 Tag Requests me har request ek row me — select karke 🖨️ print / ✅ approve.</p></div>
      <div class="head-actions">${tabsHtml()}<button class="btn" data-tr-act="share" title="Employees ko bhejne wala form link copy karo (bina login khulta hai)">🔗 Employee link</button><button class="btn" data-tr-act="reload" title="Sheet ka taaza data dobara padho">↻ Data refresh</button></div></div>`;
  }
  function bindCommon(root) {
    root.querySelectorAll('[data-tr-view]').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.trView;
      if (v === state.view) return;
      state.view = v;
      if (v === 'form' && state.done) state.done = null;
      renderRoot();
    }));
    const reload = root.querySelector('[data-tr-act="reload"]');
    if (reload) reload.addEventListener('click', () => {
      state.exact = null;
      Promise.all([buildIndex(true), loadExactStock()]).then(() => { U.toast('Taaza data se index ban gaya', 'ok'); onIndexReady(); });
    });
    const share = root.querySelector('[data-tr-act="share"]');
    if (share) share.addEventListener('click', () => {
      const link = shareLink();
      const msg = `🏷️ Tag Request form — agent ki tag request yahan lagao (aapka naam + agent ka naam, mobile, address, pincode, class-wise qty):\n${link}`;
      if (FF.app && FF.app.openDrawer) {
        FF.app.openDrawer({
          kicker: '🔗 Employee link', title: 'Tag Request form link (bina login)',
          sub: 'Ye link employees ko bhejo — kholte hi form khul jayega. Login/signup ki zaroorat NAHI.',
          body: `<div class="kd-sec">
            <label class="field" style="display:block"><span class="dim small">Link (copy karke bhejo)</span>
              <input class="input" id="tr-share-link" readonly style="width:100%" value="${esc(link)}"></label>
            <p class="dim small">✅ Koi account nahi chahiye — employee apna <b>naam</b> likhta hai, phir har agent ka naam · mobile · address · pincode · class-wise qty bhar kar submit karta hai. Har agent ki request aapke <b>🏷️ Tag Request → 📥 Tag Requests</b> me alag row me aati hai ("🌐 employee link" badge). Agent apna status link ke <b>🔎 Status</b> tab me apne mobile number se dekh sakta hai.<br>
            Form band karna ho ya fields badalni ho → <b>⚙️ Link & Sheet</b> tab.</p>
            <div class="btn-row" style="margin-top:8px">
              <button class="btn primary" id="tr-share-copy">📋 Copy link</button>
              <button class="btn" id="tr-share-wa">💬 WhatsApp se bhejo</button>
            </div></div>`
        });
        const c = U.$('#tr-share-copy');
        if (c) c.addEventListener('click', () => U.copyText(link).then((ok) => U.toast(ok ? '📋 Link copy ho gaya' : 'Copy nahi hua', ok ? 'ok' : 'err')));
        const w = U.$('#tr-share-wa');
        if (w) w.addEventListener('click', () => { if (FF.app.shareWhatsApp) FF.app.shareWhatsApp(msg); else window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank'); });
        const inp = U.$('#tr-share-link');
        if (inp) inp.addEventListener('click', () => { try { inp.select(); } catch { /* ignore */ } });
        return;
      }
      U.copyText(link).then((ok) => U.toast(ok ? '🔗 Link copy ho gaya — employees ko bhej do' : 'Copy nahi hua', ok ? 'ok' : 'warn'));
    });
  }
  /** Index (sheet data) aa gaya → jo view khula hai usme numbers bhar do (focus nahi tootna chahiye). */
  function onIndexReady() {
    if (!rootEl || !rootEl.isConnected) return;
    if (state.view === 'form') refreshFormMeta();
    else if (state.view === 'requests') refreshMetrics();
  }

  // ---- 📝 form ----------------------------------------------------------------------------------------
  const rowTotal = (row) => CLASS_LIST.reduce((s, c) => s + Math.max(0, Math.round(num(row.q[c]))), 0);
  const rowHasContent = (row) => !!(String(row.name || row.agentId || '').trim() || digits(row.mobile) || clean(row.address) || digits(row.pincode) || rowTotal(row) > 0);
  const errOf = (rowId, field) => (state.errs[rowId] && state.errs[rowId][field]) || '';
  const badCls = (rowId, field) => (errOf(rowId, field) ? ' tr-bad' : '');
  function employeeCardHtml() {
    const cfg = formCfg();
    const e = state.employee || {};
    const err = errOf('employee', 'name');
    const ok = clean(e.name).length >= 2;
    return `<section class="card tr-employee ${ok ? '' : 'tr-employee-todo'}" id="tr-employee-card">
      <div class="card-head"><h3>👤 Employee details <span class="badge red">zaroori</span></h3>
        <div class="card-right dim">Office employee — jo ye request laga raha hai</div></div>
      <div class="card-body">
        <div class="tr-emp-grid">
          <label class="field"><span class="dim small">Employee name *</span>
            <input class="input${err ? ' tr-bad' : ''}" data-tr-emp="name" value="${esc(e.name || '')}" placeholder="Apna poora naam likho (e.g. Ramesh Yadav)" autocomplete="name" maxlength="80"></label>
          ${cfg.askOffice ? `<label class="field"><span class="dim small">Branch / Office</span>
            <input class="input" data-tr-emp="office" value="${esc(e.office || '')}" placeholder="e.g. Jaipur office" maxlength="80"></label>` : ''}
        </div>
        ${err ? `<p class="tr-err-line">⚠️ ${esc(err)}</p>` : ''}
        <p class="dim small" style="margin:8px 0 0">🧑 Agent ne aapse tag maange? Neeche <b>har agent</b> ka naam, mobile, full address, pincode aur class-wise qty bharo — "➕ Add new agent" se aur agents jodo.</p>
      </div></section>`;
  }
  /** Search dropdown ke liye items — TL + AGENTS dono (TL pehle, taaki sirf agent hi na dikhein). */
  function suggestItems(query, row) {
    const idx = state.index;
    if (!idx) return [];
    const q = norm(query);
    const dq = digits(query);
    const agents = (idx.list || []).filter((a) => {
      if (row.tlFilter && norm(a.tlName) !== norm(row.tlFilter)) return false;
      if (!q) return true;
      return norm(a.name).includes(q) || (dq && digits(a.agentId).includes(dq)) || norm(a.tlName).includes(q);
    }).slice(0, 24).map((a) => ({ kind: 'agent', name: a.name, agentId: a.agentId, tlName: a.tlName, channel: a.channel }));
    const tls = row.tlFilter ? [] : [...idx.tls.values()].filter((t) => !q || norm(t.name).includes(q))
      .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1) || norm(a.name).localeCompare(norm(b.name))).slice(0, 10)
      .map((t) => ({ kind: 'tl', name: t.name, channel: t.channel, agents: t.agents ? t.agents.size : 0 }));
    return [...tls, ...agents];
  }
  function suggestHtml(items) {
    if (!items.length) return `<div class="tr-suggest-empty">${state.index ? 'Koi match nahi mila — naya agent hai to naam likh kar aage badho' : 'Agent list load ho rahi hai…'}</div>`;
    return items.map((it, i) => it.kind === 'tl'
      ? `<button type="button" class="tr-suggest-item tl ${i === 0 ? 'hot' : ''}" data-tr-pick="tl:${esc(norm(it.channel) + '|' + norm(it.name))}"><span class="tr-suggest-name">🧑‍💼 ${esc(it.name)}</span><small class="dim">TL · ${esc(it.agents)} agents · ${it.channel === 'gv' ? 'GV' : 'FF'} — TL select karo → poora data dikhega</small></button>`
      : `<button type="button" class="tr-suggest-item ${i === 0 ? 'hot' : ''}" data-tr-pick="agent:${esc(it.channel)}:${esc(it.agentId || '')}:${esc(norm(it.name))}"><span class="tr-suggest-name">${esc(it.name)}${it.agentId ? ` <small class="dim">#${esc(it.agentId)}</small>` : ''}</span><small class="dim">${it.tlName ? `TL ${esc(it.tlName)} · ` : ''}${it.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</small></button>`).join('');
  }
  /** Agent ke neeche ka status line — pakka match / "kya ye hai?" / naya agent. */
  function agentMetaHtml(row) {
    const rec = exactAgent(row);
    const filter = row.tlFilter ? ` <button type="button" class="chip on tr-filter-clear" title="TL filter hatao">TL: ${esc(row.tlFilter)} ✕</button>` : '';
    if (rec && rec.isTl) return `<span class="badge purple">👥 TL</span> <span class="badge green">${rec.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span> <b>${esc(rec.name)}</b> · ${fmt(rec.agents ? rec.agents.size : 0)} agents <small class="dim">— TL ke naam par request · dispatch name neeche bharo</small>`;
    if (rec) return `<span class="badge green">${rec.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span> <b>${esc(rec.name)}</b>${rec.agentId ? ` · ID <b>${esc(rec.agentId)}</b>` : ''}${rec.tlName ? ` · TL <b>${esc(rec.tlName)}</b>` : ''}${filter}`;
    const q = String(row.name || row.agentId || '').trim();
    if (!q) return (state.index ? '<span class="dim small">Naam / ID likhna shuru karo — agents + TL dropdown me aayenge; chunte hi ID + TL bhar jayega</span>' : '<span class="dim small">⏳ agent list load ho rahi hai…</span>') + filter;
    if (!state.index) return '<span class="dim small">⏳ agent list load ho rahi hai…</span>' + filter;
    const guess = findAgent(q, row.channel);
    if (guess) return `<span class="badge amber">exact match nahi</span> <button type="button" class="chip tr-guess" data-tr-guess="agent:${esc(guess.channel)}:${esc(guess.agentId || '')}:${esc(norm(guess.name))}">Kya ye agent hai? <b>${esc(guess.name)}</b>${guess.agentId ? ` #${esc(guess.agentId)}` : ''} ✓</button>${filter}`;
    return `<span class="badge amber">🆕 data me nahi mila</span> <span class="dim small">naya agent? request phir bhi jayegi — admin verify karega</span>${filter}`;
  }
  /** Class ke aage chhota system hint (stock · MTD · 💡 suggestion) — sirf pakke match par. */
  function hintText(rec, c) {
    if (!rec) return '';
    const d = classData(rec, c);
    if (!d.stock && !d.cur && !d.last && !d.sugNet) return '';
    return `stock ${fmt(d.stock)} · MTD ${fmt(d.cur)}${d.sugNet > 0 ? ` · 💡 ${fmt(d.sugNet)}` : ''}`;
  }
  /** 👥 TL select hote hi uska poora data — stock · last · current (🚗/🚚) + TL ke saare agents. */
  function tlPanelHtml(row) {
    const rec = row.isTl ? exactAgent(row) : null;
    if (!rec) return '';
    const m = metricNumbers(groupMetrics(rec));
    const list = tlAgents(rec);
    const cell = (label, g) => `<div class="tr-tlk"><small>${label}</small><b>${fmt(g.stock)}</b><span class="dim small">stock · last ${fmt(g.last)} · MTD ${fmt(g.cur)}</span></div>`;
    return `<div class="tr-tl-panel">
      <div class="tr-tl-kpis">${cell('🚗 VC4+VC20', m.core)}${cell('🚚 VC5+', m.comm)}${cell('Total', m.total)}<div class="tr-tlk"><small>Agents</small><b>${fmt(list.length)}</b><span class="dim small">TL ${esc(rec.priority || '—')}</span></div></div>
      <details class="tr-tl-agents"><summary>👥 ${esc(rec.name)} ke agents (${fmt(list.length)}) — click karke agent chuno</summary>
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent</th><th>Stock</th><th>Last</th><th>MTD</th></tr></thead><tbody>${list.map((a) => `<tr class="tr-tl-agent" data-tr-tlagent="agent:${esc(a.channel)}:${esc(a.agentId || '')}:${esc(norm(a.name))}" style="cursor:pointer"><td><b>${esc(a.name)}</b>${a.agentId ? ` <small class="dim">#${esc(a.agentId)}</small>` : ''}</td><td class="num">${fmt(a.stock)}</td><td class="num">${fmt(a.last)}</td><td class="num">${fmt(a.cur)}</td></tr>`).join('') || '<tr><td colspan="4" class="dim">Agents nahi mile</td></tr>'}</tbody></table></div>
      </details></div>`;
  }
  function agentCardHtml(row, i) {
    const cfg = formCfg();
    const askMobile = cfg.askMobile !== false, askAddress = cfg.askAddress !== false;
    const rec = exactAgent(row);
    const total = rowTotal(row);
    const errs = state.errs[row.id] || {};
    const errList = Object.values(errs).filter(Boolean);
    const qtyRows = CLASS_LIST.map((c) => `<label class="tr-qty-row" title="${esc(CLASS_LABEL[c])} — kitni tags chahiye (0 ya khaali = nahi chahiye)">
        <span class="tr-qty-cls"><b>${c}</b><small>${esc(CLASS_DESC(c))}</small><small class="tr-qty-hint tr-check-col" data-tr-hint="${c}">${esc(hintText(rec, c))}</small></span>
        <input class="input tr-qty" data-tr-cls="${c}" inputmode="numeric" placeholder="0" maxlength="5" value="${esc(row.q[c])}" aria-label="${c} qty">
      </label>`).join('');
    return `<div class="tr-agent-card${errList.length ? ' tr-has-err' : ''}" data-tr-row="${row.id}">
      <div class="tr-agent-head">
        <span class="tr-agent-num">🧑 Agent ${i + 1}</span>
        <span class="tr-agent-total"><b data-tr-agent-total>${fmt(total)}</b> tags</span>
        ${state.rows.length > 1 ? `<button type="button" class="btn small" data-tr-del="${row.id}" title="Is agent ko form se hatao">✕ Hatao</button>` : ''}
      </div>
      <div class="tr-agent-grid">
        <div class="tr-agent-info">
          <label class="field"><span class="dim small">Agent ID / Naam *</span>
            <div class="tr-search-wrap">
              <input class="input tr-agent${badCls(row.id, 'agent')}" data-tr-field="agent" value="${esc(rec ? rec.name : (row.name || row.agentId))}" placeholder="Agent ID / Naam search karo…" autocomplete="off">
              <div class="tr-suggest" data-tr-suggest hidden></div>
            </div></label>
          <div class="tr-row-meta">${agentMetaHtml(row)}</div>
          <div class="tr-tl-slot">${tlPanelHtml(row)}</div>
          <div class="tr-contact-grid">
            <label class="field tr-span-all"><span class="dim small">🚚 Dispatch name${row.isTl ? ' *' : ''} <small class="dim">(label par jis naam se tag jayega — agent ka naam alag ho sakta hai${row.isTl ? ' · TL ko dispatch nahi hota, isliye zaroori' : ''})</small></span>
              <input class="input${badCls(row.id, 'dispatchName')}" data-tr-a="dispatchName" maxlength="120" placeholder="Jis naam par dispatch karna hai (khaali = agent ka naam)" autocomplete="off" value="${esc(row.dispatchName)}"></label>
            <label class="field"><span class="dim small">📱 Agent mobile number${askMobile ? ' *' : ''}</span>
              <input class="input${badCls(row.id, 'mobile')}" data-tr-a="mobile" inputmode="tel" maxlength="16" placeholder="10 digit mobile" autocomplete="off" value="${esc(row.mobile)}"></label>
            <label class="field"><span class="dim small">📮 Pincode${askAddress ? ' *' : ''}</span>
              <input class="input${badCls(row.id, 'pincode')}" data-tr-a="pincode" inputmode="numeric" maxlength="6" placeholder="6 digit pincode" autocomplete="off" value="${esc(row.pincode)}"></label>
            <label class="field tr-span-all"><span class="dim small">🏠 Full address${askAddress ? ' *' : ''} <small class="dim">(house / street / area / city — tags isi address par jayenge)</small></span>
              <textarea class="input${badCls(row.id, 'address')}" data-tr-a="address" rows="2" maxlength="300" placeholder="e.g. 24, Shanti Nagar, Sodala, Jaipur">${esc(row.address)}</textarea></label>
          </div>
          ${row.fromBook ? '<p class="dim small tr-book-note">📇 Is agent ka pichli baar wala mobile/address bhar diya — ek baar check kar lo.</p>' : ''}
          ${errList.length ? `<ul class="tr-err-list">${errList.map((m) => `<li>⚠️ ${esc(m)}</li>`).join('')}</ul>` : ''}
        </div>
        <div class="tr-qty-list${badCls(row.id, 'qty')}" role="group" aria-label="Class-wise qty">
          <div class="tr-qty-head"><span>Tag class</span><span>Qty</span></div>
          ${qtyRows}
          <div class="tr-qty-foot"><span>Total</span><b data-tr-agent-total2>${fmt(total)}</b></div>
        </div>
      </div>
    </div>`;
  }
  const grandTotal = () => state.rows.reduce((s, r) => s + rowTotal(r), 0);
  const filledCount = () => state.rows.filter(rowHasContent).length;
  function renderForm() {
    const body = bodyEl();
    if (!body) return;
    const cfg = formCfg();
    const busy = state.busy === 'send';
    body.innerHTML = `
      ${employeeCardHtml()}
      <section class="card tr-agents-card"><div class="card-head"><h3>🧑‍🤝‍🧑 Agent request <span class="count" data-tr-agents>${fmt(state.rows.length)} agent${state.rows.length === 1 ? '' : 's'}</span></h3>
        <div class="card-right dim">Har agent: naam · mobile · address · pincode · class-wise qty (0/khaali = nahi chahiye) · total <b data-tr-total>${fmt(grandTotal())}</b> tags</div></div>
        <div class="card-body">
          <div class="tr-rows">${state.rows.map(agentCardHtml).join('')}</div>
          <div class="tr-add-row"><button type="button" class="btn tr-add-btn" data-tr-act="add">➕ Add new agent</button>
            <span class="dim small">Ek aur agent ki request? Naya block khul jayega.</span></div>
          ${cfg.askNote === false ? '' : `<label class="field" style="display:block;margin-top:12px"><span class="dim small">Note (optional — admin ke liye)</span>
            <input class="input" data-tr-field="note" value="${esc(state.note)}" placeholder="e.g. urgent — kal dispatch chahiye" maxlength="300" style="width:100%"></label>`}
        </div></section>
      ${dupWarningHtml()}
      <div class="tr-submit-bar">
        <div class="tr-submit-sum"><b data-tr-total2>${fmt(grandTotal())}</b> tags · <b data-tr-filled>${fmt(filledCount())}</b> agent</div>
        <button type="button" class="btn" data-tr-act="clear">🧹 Clear</button>
        <button type="button" class="btn primary tr-send-btn" data-tr-act="send" ${busy ? 'disabled' : ''}>${busy ? '⏳ Bhej rahe hain…' : '📤 Request submit karo'}</button>
      </div>
      <p class="dim small">🔎 Submit par system khud sheet se agent ka <b>stock</b>, <b>last month</b> aur <b>current month</b> issuance (🚗 VC4+VC20 · 🚚 VC5+ alag) check karke admin ko saath bhejta hai. Har agent ki request alag banti hai — status <b>🔎 Status</b> tab me agent ke mobile number se dikhta hai.</p>`;
    rootEl.querySelectorAll('.tr-agent-card').forEach(bindAgentCard);
    bindFormGlobal();
  }
  /** Index aane par sirf meta + hints update (typing ke beech focus na toote). */
  function refreshFormMeta() {
    const active = document.activeElement;
    const typing = active && rootEl.contains && rootEl.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName || '');
    if (!typing) { renderForm(); return; }
    rootEl.querySelectorAll('.tr-agent-card').forEach((card) => {
      const row = state.rows.find((r) => r.id === card.dataset.trRow);
      if (!row) return;
      const meta = card.querySelector('.tr-row-meta');
      if (meta) meta.innerHTML = agentMetaHtml(row);
      updateHints(card, row);
    });
  }
  function updateHints(card, row) {
    const rec = exactAgent(row);
    card.querySelectorAll('[data-tr-hint]').forEach((el) => { el.textContent = hintText(rec, el.dataset.trHint); });
  }
  function updateTotals(card, row) {
    if (card && row) {
      const t = fmt(rowTotal(row));
      card.querySelectorAll('[data-tr-agent-total],[data-tr-agent-total2]').forEach((el) => { el.textContent = t; });
    }
    const g = fmt(grandTotal());
    rootEl.querySelectorAll('[data-tr-total],[data-tr-total2]').forEach((el) => { el.textContent = g; });
    rootEl.querySelectorAll('[data-tr-filled]').forEach((el) => { el.textContent = fmt(filledCount()); });
  }
  /** Field theek hone par uska error turant hatao (poora re-render nahi). */
  function clearErr(card, rowId, field) {
    if (!state.errs[rowId] || !state.errs[rowId][field]) return;
    delete state.errs[rowId][field];
    const sel = field === 'agent' ? '.tr-agent' : field === 'qty' ? '.tr-qty-list' : field === 'name' ? '[data-tr-emp="name"]' : `[data-tr-a="${field}"]`;
    const el = card ? card.querySelector(sel) : null;
    if (el && el.classList) el.classList.remove('tr-bad');
    if (card && rowId !== 'employee') {
      const list = card.querySelector('.tr-err-list');
      const left = Object.values(state.errs[rowId] || {}).filter(Boolean);
      if (list) { if (left.length) list.innerHTML = left.map((m) => `<li>⚠️ ${esc(m)}</li>`).join(''); else list.remove(); }
      if (!left.length && card.classList) card.classList.remove('tr-has-err');
    }
  }
  /** Agent chuna → row bharo + (isi device par) pichla contact auto-fill. */
  function idx_tl(ch, nameKey) {
    const idx = state.index;
    return idx ? idx.tls.get(`${String(ch).toLowerCase() === 'gv' ? 'gv' : 'ff'}|${nameKey}`) || null : null;
  }
  function applyPick(row, val) {
    const [, channel, , nameKey] = String(val).split(':');
    const idx = state.index;
    const rec = idx && idx.byKey.get(`${channel}|${nameKey}`);
    if (!rec) return false;
    row.agentId = rec.agentId || ''; row.name = rec.name; row.tl = rec.tlName; row.channel = rec.channel; row.tlFilter = ''; row.isTl = false;
    if (!digits(row.mobile) && !clean(row.address)) {
      const saved = agentBook()[`${rec.channel}|${norm(rec.name)}`];
      if (saved) { row.mobile = saved.mobile || ''; row.address = saved.address || ''; row.pincode = saved.pincode || ''; row.fromBook = true; }
    }
    if (state.errs[row.id]) delete state.errs[row.id].agent;
    return true;
  }
  /** Ek agent-card ki bindings (search dropdown + contact + qty). Partial re-render par sirf naya card
   *  bind hota hai — purane cards ke listeners duplicate nahi hote. */
  function bindAgentCard(card) {
    const row = state.rows.find((r) => r.id === card.dataset.trRow);
    if (!row) return;
    const rerenderCard = (focusSel) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = agentCardHtml(row, state.rows.indexOf(row));
      const fresh = wrap.firstElementChild;
      if (!fresh || !card.replaceWith) { renderForm(); return; }
      card.replaceWith(fresh);
      bindAgentCard(fresh);
      const next = focusSel ? fresh.querySelector(focusSel) : null;
      if (next && next.focus) { next.focus(); if (next.setSelectionRange && typeof next.value === 'string') { try { next.setSelectionRange(next.value.length, next.value.length); } catch { /* number inputs */ } } }
      updateTotals(fresh, row);
    };
    // ---- agent search + dropdown --------------------------------------------------------------
    const inp = card.querySelector('.tr-agent');
    const box = card.querySelector('[data-tr-suggest]');
    if (inp && box) {
      let hot = 0;
      const close = () => { box.hidden = true; };
      const markHot = () => { box.querySelectorAll('.tr-suggest-item').forEach((el, i) => el.classList.toggle('hot', i === hot)); };
      const pick = (val) => {
        if (val.startsWith('tl:')) {
          const [ch, nameKey] = val.slice(3).split('|');
          const g = idx_tl(ch, nameKey);
          close();
          if (!g) { U.toast('TL data nahi mila', 'warn'); return; }
          row.isTl = true; row.tlFilter = ''; row.agentId = ''; row.name = g.name; row.tl = g.name; row.channel = g.channel;
          if (state.errs[row.id]) delete state.errs[row.id].agent;
          rerenderCard('[data-tr-a="dispatchName"]');
          U.toast(`👥 TL ${g.name} ka poora data neeche hai — dispatch name bharo ya uska koi agent chuno`, 'info');
          return;
        }
        close();
        if (applyPick(row, val)) rerenderCard(row.fromBook || digits(row.mobile) ? '.tr-qty' : '[data-tr-a="mobile"]');
      };
      const show = () => {
        box.innerHTML = suggestHtml(suggestItems(inp.value, row));
        box.hidden = false;
        hot = 0;
        box.querySelectorAll('[data-tr-pick]').forEach((b, i) => {
          b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(b.dataset.trPick); });
          b.addEventListener('mouseenter', () => { hot = i; markHot(); });
        });
      };
      inp.addEventListener('input', () => {
        // Live typing — naam raw rakho; pura number likha to ID maan lo (exact match se resolve hoga).
        row.name = inp.value.trim();
        if (row.isTl) { row.isTl = false; const slot = card.querySelector('.tr-tl-slot'); if (slot) slot.innerHTML = ''; }
        const d = digits(inp.value);
        row.agentId = d.length >= 3 && !/[a-z]/i.test(inp.value) ? d : '';
        row.fromBook = false;
        clearErr(card, row.id, 'agent');
        const meta = card.querySelector('.tr-row-meta');
        if (meta) meta.innerHTML = agentMetaHtml(row);
        updateHints(card, row);
        show();
      });
      inp.addEventListener('focus', show);
      inp.addEventListener('blur', () => setTimeout(close, 150));
      inp.addEventListener('keydown', (e) => {
        if (box.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { show(); e.preventDefault(); return; }
        if (box.hidden) return;
        const els = box.querySelectorAll('.tr-suggest-item');
        if (e.key === 'ArrowDown') { hot = Math.min(hot + 1, els.length - 1); markHot(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { hot = Math.max(hot - 1, 0); markHot(); e.preventDefault(); }
        else if (e.key === 'Enter') { const el = els[hot]; if (el) { e.preventDefault(); pick(el.dataset.trPick); } }
        else if (e.key === 'Escape') close();
      });
    }
    // "Kya ye agent hai?" chip + TL filter clear (meta line dobara banti hai — delegation)
    card.addEventListener('click', (e) => {
      const guess = e.target.closest ? e.target.closest('[data-tr-guess]') : null;
      if (guess) { if (applyPick(row, guess.dataset.trGuess)) rerenderCard(digits(row.mobile) ? '.tr-qty' : '[data-tr-a="mobile"]'); return; }
      const tla = e.target.closest ? e.target.closest('[data-tr-tlagent]') : null;
      if (tla) { if (applyPick(row, tla.dataset.trTlagent)) rerenderCard(digits(row.mobile) ? '.tr-qty' : '[data-tr-a="mobile"]'); return; }
      const clr = e.target.closest ? e.target.closest('.tr-filter-clear') : null;
      if (clr) { row.tlFilter = ''; rerenderCard('.tr-agent'); }
    });
    // ---- agent contact (mobile · address · pincode) — typing par re-render nahi -------------------
    card.querySelectorAll('[data-tr-a]').forEach((el) => el.addEventListener('input', () => {
      const key = el.dataset.trA;
      let v = el.value;
      if (key === 'mobile') { const c = v.replace(/[^\d+\s-]/g, ''); if (c !== v) el.value = c; v = c.replace(/[\s-]/g, ''); }
      if (key === 'pincode') { const c = v.replace(/\D/g, '').slice(0, 6); if (c !== v) el.value = c; v = c; }
      row[key] = v;
      const ok = key === 'mobile' ? digits(v).length >= 10 : key === 'pincode' ? /^\d{6}$/.test(v) : key === 'dispatchName' ? clean(v).length >= 2 : clean(v).length >= 8;
      if (ok) clearErr(card, row.id, key);
      updateTotals(null, null);
    }));
    // ---- class qty inputs (typing par re-render nahi — fast + focus safe) ------------------------
    card.querySelectorAll('.tr-qty').forEach((qinp) => {
      qinp.addEventListener('input', () => {
        const c = qinp.value.replace(/[^\d]/g, '').slice(0, 5);
        if (c !== qinp.value) qinp.value = c;
        row.q[qinp.dataset.trCls] = c;
        if (rowTotal(row) > 0) clearErr(card, row.id, 'qty');
        updateTotals(card, row);
      });
      // Enter = agli class par (mobile keyboard par "next" jaisa)
      qinp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const all = [...card.querySelectorAll('.tr-qty')];
        const next = all[all.indexOf(qinp) + 1];
        if (next) next.focus();
      });
    });
    card.querySelectorAll('[data-tr-del]').forEach((b) => b.addEventListener('click', () => {
      if (rowHasContent(row) && !window.confirm('Is agent ki details form se hata dein?')) return;
      state.rows = state.rows.filter((r) => r.id !== row.id);
      delete state.errs[row.id];
      if (!state.rows.length) state.rows = [newRow()];
      renderForm();
    }));
  }
  /** Global form actions — employee, note, add/clear/send, duplicate card. */
  function bindFormGlobal() {
    const root = rootEl;
    const note = root.querySelector('[data-tr-field="note"]');
    if (note) note.addEventListener('input', () => { state.note = note.value; });
    root.querySelectorAll('[data-tr-emp]').forEach((inp) => inp.addEventListener('input', () => {
      const key = inp.dataset.trEmp;
      state.employee[key] = inp.value;
      if (key === 'name') {
        const card = root.querySelector('#tr-employee-card');
        if (card && card.classList) card.classList.toggle('tr-employee-todo', clean(inp.value).length < 2);
        if (clean(inp.value).length >= 2 && errOf('employee', 'name')) {
          delete state.errs.employee.name;
          if (inp.classList) inp.classList.remove('tr-bad');
          const line = card && card.querySelector('.tr-err-line');
          if (line) line.remove();
        }
      }
      saveEmployee();
    }));
    const act = (name, fn) => { const b = root.querySelector(`[data-tr-act="${name}"]`); if (b) b.addEventListener('click', fn); };
    act('add', () => {
      if (state.rows.length >= 40) { U.toast('Ek baar me max 40 agents — baaki agli request me bhejo', 'warn'); return; }
      state.rows.push(newRow());
      renderForm();
      const cards = rootEl.querySelectorAll('.tr-agent-card');
      const last = cards[cards.length - 1];
      if (last) {
        if (last.scrollIntoView) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const inp = last.querySelector('.tr-agent');
        if (inp && inp.focus) inp.focus();
      }
    });
    act('clear', () => {
      if (filledCount() && !window.confirm('Poora form khaali kar dein? (employee naam bana rahega)')) return;
      state.rows = [newRow()]; state.note = ''; state.errs = {}; state.dup = { list: [], force: false, busy: false };
      renderForm();
    });
    act('send', () => submit());
    act('dup-force', () => { state.dup.force = true; state.dup.list = []; submit(); });
    act('dup-edit', () => { state.dup.list = []; renderForm(); });
    act('dup-status', (e) => {
      const id = (e.currentTarget && e.currentTarget.dataset.id) || '';
      state.dup.list = [];
      if (isPublic()) {
        const firstMobile = digits((state.rows.find((r) => digits(r.mobile).length >= 10) || {}).mobile);
        state.status = { q: firstMobile || id, list: null, busy: false, err: '', searched: '' };
        state.view = 'status';
      } else {
        state.filter = { status: 'all', q: id };
        state.view = 'requests';
      }
      renderRoot();
    });
  }
  /** Saari galtiyan ek saath (agent-wise) — pehli galti par scroll + focus. */
  function validateForm() {
    const cfg = formCfg();
    const errs = {};
    let first = null;
    const mark = (rowId, field, msg) => { (errs[rowId] = errs[rowId] || {})[field] = msg; if (!first) first = { rowId, field }; };
    if (clean(state.employee.name).length < 2) mark('employee', 'name', 'Employee name zaroori hai (kam se kam 2 akshar)');
    const filled = state.rows.filter(rowHasContent);
    if (!filled.length) mark(state.rows[0].id, 'agent', 'Kam se kam ek agent ka naam + qty bharo');
    const seen = new Map();
    filled.forEach((row) => {
      const n = state.rows.indexOf(row) + 1;
      if (String(row.name || row.agentId || '').trim().length < 2) mark(row.id, 'agent', 'Agent ka naam / ID likho (dropdown se chuno)');
      if (row.isTl && clean(row.dispatchName).length < 2) mark(row.id, 'dispatchName', 'TL ke naam par request hai — Dispatch name (jisko tag bhejna hai) zaroori hai');
      const mob = digits(row.mobile);
      if ((cfg.askMobile !== false || mob) && (mob.length < 10 || mob.length > 13)) mark(row.id, 'mobile', 'Agent ka 10 digit mobile number daalo');
      if (cfg.askAddress !== false) {
        if (clean(row.address).length < 8) mark(row.id, 'address', 'Agent ka full address likho (house / street / area / city)');
        if (!/^\d{6}$/.test(digits(row.pincode))) mark(row.id, 'pincode', '6 digit pincode daalo');
      } else if (row.pincode && !/^\d{6}$/.test(digits(row.pincode))) mark(row.id, 'pincode', 'Pincode 6 digit ka hona chahiye');
      if (!rowTotal(row)) mark(row.id, 'qty', 'Kam se kam ek class me qty daalo');
      const rec = exactAgent(row);
      const key = rec ? `${rec.channel}|${norm(rec.name)}` : `?|${norm(row.name || row.agentId)}`;
      if (String(row.name || row.agentId || '').trim()) {
        if (seen.has(key)) mark(row.id, 'agent', `Ye agent upar (Agent ${seen.get(key)}) me pehle se hai — wahi qty badha do`);
        else seen.set(key, n);
      }
    });
    const classRows = filled.reduce((s, r) => s + CLASS_LIST.filter((c) => num(r.q[c]) > 0).length, 0);
    const maxRows = Math.min(150, Math.max(5, Number(cfg.maxRows) || 60));
    if (classRows > maxRows && !first) mark(filled[filled.length - 1].id, 'qty', `Ek baar me max ${maxRows} class-rows — kuch agents agli request me bhejo`);
    state.errs = errs;
    return first;
  }
  /** Submit payload — har agent ka block + system snapshot (🚗/🚚 + class-wise). */
  function buildPayload() {
    const agents = state.rows.filter(rowHasContent).map((row) => {
      const rec = exactAgent(row);
      const channel = rec ? rec.channel : (row.channel === 'gv' ? 'gv' : 'ff');
      const rows = CLASS_LIST.filter((c) => num(row.q[c]) > 0).map((c) => {
        const qty = Math.max(0, Math.round(num(row.q[c])));
        if (!rec) return { cls: c, requested: qty, approved: qty };
        const d = classData(rec, c);
        return {
          cls: c, requested: qty, approved: qty, last: d.last, cur: d.cur, stock: d.stock,
          cover: d.cover == null ? null : round1(d.cover), priority: d.priority, growth: round1(d.growth), sugNet: d.sugNet, sugGross: d.sugGross
        };
      });
      return {
        agentId: rec ? rec.agentId || '' : (/^\d{3,}$/.test(String(row.agentId || '')) ? String(row.agentId) : ''),
        agentName: rec ? rec.name : clean(row.name || row.agentId),
        dispatchName: clean(row.dispatchName), kind: row.isTl ? 'tl' : 'agent',
        tl: rec ? rec.tlName || '' : '', channel,
        mobile: String(row.mobile || '').replace(/[^\d+]/g, ''), address: clean(row.address), pincode: digits(row.pincode).slice(0, 6),
        unmatched: !rec, metrics: rec ? groupMetrics(rec) : null, rows
      };
    });
    const office = clean(state.employee.office);
    return { employee: { name: clean(state.employee.name), ...(office && formCfg().askOffice ? { office } : {}) }, note: clean(state.note), agents };
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]);
  async function submit() {
    if (state.busy) return;
    if (!isPublic() && !(FF.auth && FF.auth.can && FF.auth.can('tagRequest'))) { U.toast('Is page ka access nahi hai', 'err'); return; }
    const first = validateForm();
    if (first) {
      renderForm();
      const n = Object.values(state.errs).reduce((s, e) => s + Object.keys(e || {}).length, 0);
      U.toast(`⚠️ ${n} jagah details adhoori hain — laal box dekho`, 'err');
      const card = first.rowId === 'employee' ? rootEl.querySelector('#tr-employee-card') : rootEl.querySelector(`[data-tr-row="${first.rowId}"]`);
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const sel = first.rowId === 'employee' ? '[data-tr-emp="name"]' : first.field === 'agent' ? '.tr-agent' : first.field === 'qty' ? '.tr-qty' : `[data-tr-a="${first.field}"]`;
      const inp = card ? card.querySelector(sel) : null;
      if (inp && inp.focus) setTimeout(() => inp.focus({ preventScroll: true }), 250);
      return;
    }
    state.busy = 'send';
    const btn = rootEl.querySelector('[data-tr-act="send"]');
    const setBtn = (t) => { if (btn) { btn.disabled = true; btn.textContent = t; } };
    setBtn('⏳ Sheet data check ho raha hai…');
    // Snapshot ke liye index — slow network par form atke nahi (max ~6s, phir bina snapshot ke bhejo)
    try { await withTimeout(Promise.all([buildIndex(), isPublic() ? null : withTimeout(loadExactStock(), 2500)]), 6000); } catch { /* snapshot optional */ }
    const payload = buildPayload();
    const api = isPublic() ? publicApi : (path, method, body) => FF.auth.api(path, method, body);
    try {
      if (!state.dup.force) {
        setBtn('🔁 Purani request check ho rahi hai…');
        const chk = await publicApi('/api/public/tag-request/check', 'POST', { employee: payload.employee, agents: payload.agents.map((a) => ({ agentId: a.agentId, agentName: a.agentName, mobile: a.mobile, channel: a.channel, rows: a.rows.map((x) => ({ cls: x.cls, approved: x.approved })) })) }).catch(() => null);
        const list = (chk && chk.duplicates) || [];
        if (list.length) {
          state.dup.list = list;
          state.busy = '';
          renderForm();
          U.toast('🔁 Is agent ki request pehle se active hai — ek baar dekh lo', 'warn');
          const card = rootEl.querySelector('#tr-dup-card');
          if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
      state.dup = { list: [], force: false, busy: false };
      setBtn('📤 Bhej rahe hain…');
      const path = isPublic() ? '/api/public/tag-request' : '/api/tag-requests';
      const out = await api(path, 'POST', payload);
      rememberAgents(payload.agents);
      saveEmployee();
      const reqs = (out && out.requests) || (out && out.request ? [out.request] : []);
      state.rows = [newRow()]; state.note = ''; state.errs = {};
      state.busy = '';
      if (isPublic()) {
        state.done = {
          batch: (out && out.batch) || { total: payload.agents.reduce((s, a) => s + a.rows.reduce((x, r) => x + r.approved, 0), 0), agents: reqs.length },
          requests: reqs.map((r) => ({ id: r.id, agentName: r.agentName || (r.agent && r.agent.name) || '', mobile: r.mobile || (r.agent && r.agent.mobile) || '', total: r.total, classes: r.classes || [] })),
          warnings: (out && out.warnings) || [], employee: payload.employee.name
        };
        state.view = 'done';
        U.toast(`📤 ${reqs.length} agent ki request bhej di gayi`, 'ok');
      } else {
        state.requestsAt = 0;
        state.view = 'requests';
        state.filter = { status: 'all', q: '' };
        U.toast(`📤 ${reqs.length || 1} agent ki tag request admin ko chali gayi — status yahin dikhega`, 'ok');
      }
      renderRoot();
    } catch (err) {
      state.busy = '';
      U.toast('Request nahi gayi: ' + ((err && err.message) || ''), 'err');
      const b = rootEl.querySelector('[data-tr-act="send"]');
      if (b) { b.disabled = false; b.textContent = '📤 Request submit karo'; }
    }
  }

  // ---- 🌐 public: done + status --------------------------------------------------------------------
  function renderDone() {
    const d = state.done || {};
    const body = bodyEl();
    if (!body) return;
    const reqs = d.requests || [];
    const batch = d.batch || {};
    const dup = (d.warnings || []).find((x) => x && x.code === 'duplicate');
    body.innerHTML = `<section class="card tr-done"><div class="card-body">
      <div class="tr-done-icon">✅</div>
      <h2 style="margin:6px 0">Request bhej di gayi!</h2>
      <p class="dim" style="margin:0 0 12px">${esc(d.employee || state.employee.name || '')} — <b>${fmt(reqs.length || batch.agents || 0)} agent</b> ki request (${fmt(batch.total || 0)} tags) admin ke paas pahunch gayi. Status <b>🔎 Status</b> tab me <b>agent ke mobile number</b> se dekh sakte ho.</p>
      ${reqs.length ? `<div class="table-wrap"><table class="tbl tr-done-tbl"><thead><tr><th>Agent</th><th>Mobile</th><th>Classes</th><th class="num">Tags</th><th>Request ID</th></tr></thead><tbody>
        ${reqs.map((r) => `<tr><td><b>${esc(r.agentName || '—')}</b></td><td>${esc(r.mobile || '—')}</td><td class="small">${esc((r.classes || []).map((c) => `${c.cls}×${c.qty}`).join(' · '))}</td><td class="num"><b>${fmt(r.total)}</b></td>
          <td><span class="mono small">${esc(r.id)}</span> <button class="btn small" data-tr-copy-id="${esc(r.id)}" title="Request ID copy">📋</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <div class="btn-row" style="margin-top:12px;justify-content:center">
        <button class="btn primary" data-tr-act="again">➕ Naya request banao</button>
        <button class="btn" data-tr-act="check-status">🔎 Status dekho</button>
      </div>
      ${dup ? `<div class="notice amber" style="margin-top:10px">🔁 Note: ${fmt(dup.count || 0)} agent ki request pehle se active thi — admin ko 🔁 mark ke saath dikhegi, taaki duplicate dispatch na ho.</div>` : ''}
      <p class="dim small" style="margin-top:10px">Status ke stage: ⏳ Pending → ✅ Approved → 🚚 Dispatched (ya ⛔ Rejected). Admin status badalte hi Status tab me dikh jaata hai.</p>
    </div></section>`;
    body.querySelectorAll('[data-tr-copy-id]').forEach((b) => b.addEventListener('click', () => U.copyText(b.dataset.trCopyId).then((ok) => U.toast(ok ? '📋 Request ID copy ho gayi' : 'Copy nahi hua', ok ? 'ok' : 'warn'))));
    const act = (name, fn) => { const b = body.querySelector(`[data-tr-act="${name}"]`); if (b) b.addEventListener('click', fn); };
    act('again', () => { state.done = null; state.view = 'form'; renderRoot(); });
    act('check-status', () => {
      const first = reqs.find((r) => digits(r.mobile).length >= 10);
      state.status = { q: first ? digits(first.mobile).slice(-10) : String((reqs[0] || {}).id || ''), list: null, busy: false, err: '', searched: '' };
      state.done = null; state.view = 'status';
      renderRoot();
    });
  }
  const STEPS = ['pending', 'approved', 'dispatched'];
  function statusCardHtml(s) {
    const v = STATUS[s.status] || STATUS.pending;
    const at = STEPS.indexOf(s.status);
    const steps = s.status === 'rejected'
      ? '<div class="tr-steps"><span class="tr-step done">⏳ Pending</span><span class="tr-step bad">⛔ Rejected</span></div>'
      : `<div class="tr-steps">${STEPS.map((k, i) => `<span class="tr-step ${i <= at ? 'done' : ''}">${STATUS[k].label}</span>`).join('')}</div>`;
    const cls = (s.classes || []).map((c) => {
      const changed = num(c.requested) !== num(c.approved) && (s.status !== 'pending' || num(c.requested));
      return `<span class="tr-st-cls"><b>${esc(c.cls)}</b> ${changed ? `<s class="dim">${fmt(c.requested)}</s> → <b>${fmt(c.approved)}</b>` : fmt(c.approved)}${c.agent ? ` <small class="dim">${esc(c.agent)}</small>` : ''}</span>`;
    }).join('');
    return `<div class="tr-st-card st-${esc(s.status || 'pending')}">
      <div class="tr-st-top"><span class="badge ${v.tone}">${v.label}</span><b class="tr-st-agent">${esc(s.agentName || '—')}</b>${s.agents > 1 ? `<small class="dim"> +${s.agents - 1} agents</small>` : ''}<span class="tr-st-total"><b>${fmt(s.total)}</b> tags</span></div>
      ${steps}
      ${cls ? `<div class="tr-st-classes">${cls}</div>` : ''}
      <div class="dim small">📅 ${esc(longDate(s.at))} · ${esc(ago(s.at))}${s.byName ? ` · 👤 entry: ${esc(s.byName)}` : ''} · <span class="mono">${esc(s.id)}</span>${s.sheetSynced ? ' · 📗 sheet entry' : ''}</div>
      ${s.adminNote ? `<div class="notice green" style="margin-top:8px">💬 Admin note: ${esc(s.adminNote)}</div>` : ''}
    </div>`;
  }
  function renderStatus() {
    const body = bodyEl();
    if (!body) return;
    const st = state.status;
    const list = st.list;
    body.innerHTML = `<section class="card tr-status-card"><div class="card-head"><h3>🔎 Request status</h3>
        <div class="card-right dim">Agent ka mobile number (jo request me diya tha) ya Request ID daalo</div></div>
      <div class="card-body">
        <div class="tr-status-row">
          <input class="input" id="tr-status-id" inputmode="tel" autocomplete="off" placeholder="Agent mobile (10 digit) ya Request ID" value="${esc(st.q || '')}">
          <button class="btn primary" data-tr-act="find" ${st.busy ? 'disabled' : ''}>${st.busy ? '⏳ Dhoondh rahe hain…' : '🔎 Status dekho'}</button>
        </div>
        ${st.err ? `<div class="notice amber" style="margin-top:10px">⚠️ ${esc(st.err)}</div>` : ''}
        ${list ? (list.length
          ? `<p class="dim small" style="margin:12px 0 6px">${fmt(list.length)} request mili${st.searched ? ` · ${esc(st.searched)}` : ''} (nayi upar)</p><div class="tr-st-list">${list.map(statusCardHtml).join('')}</div>`
          : `<div class="tr-status-out" style="margin-top:12px">Is number se koi request nahi mili. Wahi mobile number daalo jo request lagate waqt agent ke liye diya tha — ya Request ID try karo.</div>`) : ''}
      </div></section>`;
    const find = () => {
      const inp = body.querySelector('#tr-status-id');
      const q = String((inp && inp.value) || '').trim();
      st.q = q;
      const d = digits(q);
      let path = '';
      if (d.length >= 10 && d.length <= 13 && /^[\d+\s-]+$/.test(q)) path = `/api/public/tag-request/status?mobile=${encodeURIComponent(d)}`;
      else if (/^tagreq/i.test(q) || q.length >= 12) path = `/api/public/tag-request/status?id=${encodeURIComponent(q)}`;
      if (!path) { st.err = 'Agent ka 10 digit mobile number ya poori Request ID daalo.'; st.list = null; renderStatus(); return; }
      st.busy = true; st.err = ''; renderStatus();
      publicApi(path).then((out) => {
        st.list = out && Array.isArray(out.requests) ? out.requests : (out && out.request ? [out.request] : []);
        st.searched = out && out.mobile ? `📱 ${out.mobile}` : '';
      }).catch((err) => { st.list = null; st.err = (err && err.message) || 'Status nahi mila'; })
        .finally(() => { st.busy = false; renderStatus(); });
    };
    const btn = body.querySelector('[data-tr-act="find"]');
    if (btn) btn.addEventListener('click', find);
    const inp = body.querySelector('#tr-status-id');
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });
    // Done screen / duplicate card se aaye → seedha search
    if (st.q && !st.list && !st.busy && !st.err && !st.searched && st.autoDone !== st.q) { st.autoDone = st.q; find(); }
  }

  // ---- 📥 requests table (admin / apni) — har agent ki request EK ROW me ------------------------------
  function loadRequests(force) {
    if (!force && state.reqLoaded && Date.now() - state.requestsAt < 30e3) return Promise.resolve(state.requests);
    return FF.auth.api('/api/tag-requests').then((out) => {
      state.requests = Array.isArray(out && out.requests) ? out.requests : [];
      state.requestsAt = Date.now(); state.reqLoaded = true; state.reqError = '';
      return state.requests;
    }).catch((err) => { console.warn('tag requests:', err && err.message); state.reqError = (err && err.message) || 'load fail'; state.reqLoaded = true; return state.requests; });
  }
  const statusOf = (r) => STATUS[r.status] || STATUS.pending;
  /** Server (tagAgentKeyOf) ke saath bilkul same — purani multi-agent request me ek agent ki rows. */
  const agentKeyOf = (x) => `${x && x.channel === 'gv' ? 'gv' : 'ff'}|${String((x && x.agentId) || '').trim() ? `id:${String(x.agentId).trim()}` : `n:${String((x && x.agentName) || '').trim().toLowerCase().replace(/\s+/g, ' ')}`}`;
  /** Requests → table rows: v3.30 request = 1 row; purani multi-agent request = har agent ki row. */
  function displayRows(requests) {
    const out = [];
    (requests || []).forEach((r) => {
      const groups = new Map();
      (r.rows || []).forEach((x) => {
        const k = r.agent ? 'agent' : agentKeyOf(x);
        const g = groups.get(k) || { agentKey: r.agent ? '' : k, rows: [] };
        g.rows.push(x); groups.set(k, g);
      });
      if (!groups.size) groups.set('none', { agentKey: '', rows: [] });
      const siblings = groups.size;
      groups.forEach((g, k) => {
        const first = g.rows[0] || {};
        const a = r.agent || {};
        const rows = [...g.rows].sort((x, y) => clsRank(x.cls) - clsRank(y.cls));
        out.push({
          key: `${r.id}::${k}`, agentKey: siblings > 1 ? g.agentKey : '', req: r, rows, siblings,
          agent: {
            name: a.name || first.agentName || '—', agentId: a.agentId || first.agentId || '',
            tl: a.tl || (first.tl && first.tl !== '—' ? first.tl : ''), channel: (a.channel || first.channel) === 'gv' ? 'gv' : 'ff', unmatched: !!a.unmatched, kind: a.kind || 'agent', dispatchName: a.dispatchName || ''
          },
          contact: contactOf(r),
          total: rows.reduce((s, x) => s + num(x.approved), 0),
          requested: rows.reduce((s, x) => s + (x.requested === undefined || x.requested === null ? num(x.approved) : num(x.requested)), 0)
        });
      });
    });
    return out;
  }
  function filterRows(list) {
    const f = state.filter;
    const q = norm(f.q);
    const dq = digits(f.q);
    return list.filter((dr) => {
      if (f.status !== 'all' && (dr.req.status || 'pending') !== f.status) return false;
      if (!q) return true;
      const r = dr.req, e = r.employee || {};
      const hay = norm([dr.agent.name, dr.agent.agentId, dr.agent.tl, e.name, e.office, r.byName, dr.contact.name, dr.contact.address, dr.contact.pincode, r.id, r.note, r.adminNote].join(' '));
      if (hay.includes(q)) return true;
      return dq.length >= 3 && [dr.contact.mobile, e.mobile, dr.contact.pincode, dr.agent.agentId].some((v) => digits(v).includes(dq));
    });
  }
  /** Ek row ke metrics: live sheet data (admin) → submit wala snapshot → requested class rows. */
  function metricsFor(dr) {
    const rec = state.index ? lookupAgent(dr.agent) : null;
    if (rec) return { ...groupMetrics(rec), src: 'live' };
    const m = dr.req.metrics;
    if (m && dr.siblings === 1) return { ...m, days: num(m.days) || basisDays(dr.agent.channel), src: 'snap' };
    const g = emptyGroups();
    dr.rows.forEach((x) => { const k = groupOf(x.cls); g[k].stock += num(x.stock); g[k].last += num(x.last); g[k].cur += num(x.cur); });
    let ym = ymNow();
    try { ym = U.ymKey(new Date(dr.req.at)); } catch { /* keep */ }
    return { ...g, days: basisDays(dr.agent.channel), ym, src: 'rows' };
  }
  const SRC_TITLE = {
    live: 'Live sheet data (abhi ka)',
    snap: 'Submit ke waqt ka snapshot (live data me agent nahi mila)',
    rows: 'Sirf requested classes ka data (purani request)'
  };
  const subLine = (a, b, d) => `<small class="tr-m-sub">🚗 ${fmt(a, d)} · 🚚 ${fmt(b, d)}</small>`;
  const growthHtml = (g) => (g === null ? '<span class="delta up">🆕 new</span>' : `<span class="delta ${g > 0.05 ? 'up' : g < -0.05 ? 'down' : 'flat'}">${g > 0.05 ? '▲ +' : g < -0.05 ? '▼ ' : ''}${fmt(g, 1)}%</span>`);
  const growthSmall = (g) => (g === null ? 'new' : `${g > 0 ? '+' : ''}${fmt(g, 0)}%`);
  /** 8 metric cells — index aane par inhi ko in-place badla jaata hai (data-tr-m). */
  function metricCellsHtml(dr) {
    const m = metricsFor(dr);
    const n = metricNumbers(m);
    // Agent sheet me nahi mila + koi snapshot nahi → "0" galat lagta (stock 0?) — "—" dikhao
    if (m.src === 'rows' && !n.total.stock && !n.total.last && !n.total.cur) {
      const title = dr.agent.unmatched ? 'Agent sheet data me nahi mila (naya agent?) — stock/issuance data nahi' : 'Is request ke saath data nahi aaya';
      return ['stock', 'core', 'comm', 'last', 'cur', 'rate', 'exp', 'growth'].map((k) => `<td class="num tr-m tr-m-none" data-tr-m="${k}" title="${esc(title)}">${k === 'stock' ? '<i class="tr-src rows"></i>' : ''}—</td>`).join('');
    }
    const dot = `<i class="tr-src ${m.src}" title="${esc(SRC_TITLE[m.src] || '')}${m.src !== 'live' && m.ym ? ` · ${esc(U.labelYM(m.ym))}` : ''}${m.exactStock ? ' · exact stock (StockDataa)' : ''}"></i>`;
    return [
      `<td class="num tr-m" data-tr-m="stock">${dot}<b>${fmt(n.total.stock)}</b></td>`,
      `<td class="num tr-m tr-m-core" data-tr-m="core"><b>${fmt(n.core.stock)}</b></td>`,
      `<td class="num tr-m tr-m-comm" data-tr-m="comm"><b>${fmt(n.comm.stock)}</b></td>`,
      `<td class="num tr-m" data-tr-m="last"><b>${fmt(n.total.last)}</b>${subLine(n.core.last, n.comm.last)}</td>`,
      `<td class="num tr-m" data-tr-m="cur"><b>${fmt(n.total.cur)}</b>${subLine(n.core.cur, n.comm.cur)}</td>`,
      `<td class="num tr-m" data-tr-m="rate" title="${fmt(n.total.cur)} ÷ ${fmt(n.days)} din"><b>${fmt(n.total.rate, 1)}</b>${subLine(n.core.rate, n.comm.rate, 1)}</td>`,
      `<td class="num tr-m" data-tr-m="exp"><b>${fmt(n.total.exp)}</b>${subLine(n.core.exp, n.comm.exp)}</td>`,
      `<td class="num tr-m" data-tr-m="growth">${growthHtml(n.total.growth)}<small class="tr-m-sub">🚗 ${growthSmall(n.core.growth)} · 🚚 ${growthSmall(n.comm.growth)}</small></td>`
    ].join('');
  }
  const canEditReq = (r) => isAdmin() || (r.by === me() && (r.status || 'pending') === 'pending');
  const canDeleteReq = (r) => isAdmin() || r.by === me();
  function classCellHtml(dr) {
    const editing = state.edit && state.edit.key === dr.key;
    if (editing) {
      const classes = [...new Set([...CLASS_LIST, ...dr.rows.map((x) => String(x.cls || '').toUpperCase()).filter(Boolean)])];
      return `<div class="tr-cq tr-cq-edit">${classes.map((c) => {
        const x = dr.rows.find((y) => String(y.cls).toUpperCase() === c);
        const asked = x ? (x.requested === undefined ? num(x.approved) : num(x.requested)) : 0;
        return `<label class="tr-cq-row"><b>${esc(c)}</b><input class="input" data-tr-eq="${esc(c)}" inputmode="numeric" maxlength="6" value="${esc(state.edit.qty[c] === undefined ? '' : state.edit.qty[c])}" placeholder="0">${asked ? `<small class="dim" title="Agent ne maanga">req ${fmt(asked)}</small>` : '<small></small>'}</label>`;
      }).join('')}
      ${isAdmin() ? `<input class="input tr-cq-note" data-tr-enote maxlength="300" placeholder="💬 Admin note (optional)" value="${esc(state.edit.note || '')}">` : ''}</div>`;
    }
    if (!dr.rows.length) return '<span class="dim small">—</span>';
    return `<div class="tr-cq">${dr.rows.map((x) => {
      const asked = x.requested === undefined || x.requested === null ? num(x.approved) : num(x.requested);
      const changed = asked !== num(x.approved);
      return `<div class="tr-cq-row${changed ? ' changed' : ''}${num(x.approved) === 0 ? ' zero' : ''}"><b>${esc(x.cls)}</b><span>${changed ? `<s class="dim">${fmt(asked)}</s> → ` : ''}<b>${fmt(x.approved)}</b></span></div>`;
    }).join('')}</div>`;
  }
  function statusCellHtml(dr) {
    const r = dr.req;
    const v = statusOf(r);
    const dup = r.dupCount || (r.dupOf || []).length;
    const sheet = r.sheetSync && r.sheetSync.error ? ` <span class="badge red" title="Sheet sync fail: ${esc(r.sheetSync.error || '')}">📗!</span>` : r.sheetSync ? ' <span class="badge green" title="Sheet me entry ho chuki hai">📗</span>' : '';
    const top = `<span class="badge ${v.tone}">${v.label}</span>${sheet}${dup ? ` <span class="badge amber" title="Pehle se active request: ${esc((r.dupOf || []).join(', '))}">🔁 dup</span>` : ''}`;
    if (!isAdmin()) return `<div class="tr-st-cell">${top}${r.adminNote ? `<small class="dim tr-note" title="${esc(r.adminNote)}">💬 ${esc(String(r.adminNote).slice(0, 60))}</small>` : ''}</div>`;
    const status = r.status || 'pending';
    return `<div class="tr-st-cell">${top}
      ${status === 'pending' ? `<button class="btn small primary tr-approve" data-tr-op="approve" data-key="${esc(dr.key)}">✅ Approve</button>` : ''}
      <select class="input tr-status-sel" data-tr-status data-key="${esc(dr.key)}" aria-label="Status badlo">${STATUS_KEYS.map((k) => `<option value="${k}" ${k === status ? 'selected' : ''}>${STATUS[k].label}</option>`).join('')}</select>
      ${r.adminNote ? `<small class="dim tr-note" title="${esc(r.adminNote)}">💬 ${esc(String(r.adminNote).slice(0, 60))}</small>` : ''}</div>`;
  }
  function actionsCellHtml(dr) {
    const r = dr.req;
    const k = esc(dr.key);
    if (state.edit && state.edit.key === dr.key) {
      return `<div class="tr-acts"><button class="btn small primary" data-tr-op="save" data-key="${k}">💾 Save</button><button class="btn small" data-tr-op="cancel" data-key="${k}">✕ Cancel</button></div>`;
    }
    return `<div class="tr-acts">
      ${canEditReq(r) ? `<button class="btn small" data-tr-op="edit" data-key="${k}" title="Class-wise qty badlo">✏️ Edit</button>` : ''}
      <button class="btn small" data-tr-op="print1" data-key="${k}" title="Sirf is request ka label print">🖨️</button>
      <button class="btn small" data-tr-op="pdf1" data-key="${k}" title="Is request ka label PDF download">📄</button>
      <button class="btn small" data-tr-op="copy" data-key="${k}" title="Label text copy (WhatsApp ke liye)">📋</button>
      ${isAdmin() ? `<button class="btn small" data-tr-op="push" data-key="${k}" title="Google Sheet me entry">📗</button>` : ''}
      ${canDeleteReq(r) ? `<button class="btn small" data-tr-op="del" data-key="${k}" title="Request delete">🗑</button>` : ''}
    </div>`;
  }
  function reqRowHtml(dr) {
    const r = dr.req;
    const e = r.employee || {};
    const c = dr.contact;
    const sel = state.sel.has(dr.key);
    const editing = state.edit && state.edit.key === dr.key;
    const status = r.status || 'pending';
    const empName = e.name || r.byName || r.by || '—';
    const entryBy = r.byName && r.byName !== empName ? `<small class="dim">entry: ${esc(r.byName)}</small>` : '';
    return `<tr class="tr-req-row st-${esc(status)}${sel ? ' tr-sel' : ''}${editing ? ' tr-editing' : ''}" data-tr-key="${esc(dr.key)}">
      <td class="tr-c-sel"><input type="checkbox" data-tr-sel="${esc(dr.key)}" ${sel ? 'checked' : ''} aria-label="Select"></td>
      <td class="tr-c-date"><b>${esc(dateLabel(r.at))}</b><small class="dim">${esc(timeLabelShort(r.at))}</small><small class="mono dim" title="${esc(r.id)}">#${esc(String(r.id || '').slice(-6))}</small></td>
      <td class="tr-c-emp"><b>${esc(empName)}</b>${e.office ? `<small class="dim">${esc(e.office)}</small>` : ''}${entryBy}${r.source === 'public-link' ? '<span class="badge" title="Employee link se aayi (bina login)">🌐 link</span>' : ''}</td>
      <td class="tr-c-agent"><b>${esc(dr.agent.name)}</b>${dr.agent.kind === 'tl' ? ' <span class="badge purple">TL</span>' : ''}${dr.agent.dispatchName ? `<small class="dim"> 🚚 ${esc(dr.agent.dispatchName)}</small>` : ''}<small class="dim">${dr.agent.agentId ? `#${esc(dr.agent.agentId)}` : ''}${dr.agent.tl ? `${dr.agent.agentId ? ' · ' : ''}TL ${esc(dr.agent.tl)}` : ''}</small>
        <span class="tr-tags"><span class="badge ${dr.agent.channel === 'gv' ? 'green' : 'blue'}">${dr.agent.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span>${dr.agent.unmatched ? '<span class="badge amber" title="Sheet data me nahi mila — naya agent?">🆕 verify</span>' : ''}${dr.siblings > 1 ? `<span class="badge gray" title="Purani request — ek request me ${dr.siblings} agents">🔗 ${dr.siblings} agents</span>` : ''}</span></td>
      <td class="tr-c-addr">${c.who === 'employee' && (c.mobile || c.address) ? '<small class="dim">employee ka address:</small>' : ''}${c.mobile ? `<a class="tr-mob" href="tel:${esc(String(c.mobile).replace(/[^\d+]/g, ''))}">☏ ${esc(c.mobile)}</a>` : ''}${c.address ? `<div class="tr-addr">${esc(c.address)}</div>` : ''}${c.pincode ? `<b class="tr-pin">📮 ${esc(c.pincode)}</b>` : ''}${!c.mobile && !c.address && !c.pincode ? '<span class="dim small">—</span>' : ''}</td>
      ${metricCellsHtml(dr)}
      <td class="tr-c-cls">${classCellHtml(dr)}</td>
      <td class="num tr-c-total"><b data-tr-rowtotal>${fmt(dr.total)}</b>${dr.requested !== dr.total ? `<small class="dim">req ${fmt(dr.requested)}</small>` : ''}</td>
      <td class="tr-c-status">${statusCellHtml(dr)}</td>
      <td class="tr-c-act">${actionsCellHtml(dr)}</td>
    </tr>`;
  }
  function chipsHtml(all) {
    const counts = { all: all.length };
    STATUS_KEYS.forEach((k) => { counts[k] = 0; });
    all.forEach((dr) => { const s = dr.req.status || 'pending'; counts[s] = num(counts[s]) + 1; });
    const chip = (k, label) => `<button type="button" class="chip ${state.filter.status === k ? 'on' : ''}" data-tr-chip="${k}">${label} <span class="count">${fmt(counts[k] || 0)}</span></button>`;
    return chip('all', 'Sab') + STATUS_KEYS.map((k) => chip(k, STATUS[k].label)).join('');
  }
  function requestsShellHtml() {
    const lm = U.labelYM(ymLast());
    return `<section class="card tr-req-card" id="tr-req-card">
      <div class="card-head"><h3>📥 Tag Requests <span class="count" data-tr-count>${fmt(state.dview.length)}</span></h3>
        <div class="card-right dim">${isAdmin() ? 'Har agent ki request ek row me — ☑ select karke 🖨️ print / ✅ approve · qty ✏️ wahin edit' : 'Aapki bheji hui requests aur unka status'}</div></div>
      <div class="tr-req-toolbar">
        <div class="tr-req-actions">
          <label class="tr-selall"><input type="checkbox" data-tr-selall aria-label="Saari dikhti rows select"> <span>Select all</span></label>
          <span class="tr-selcount" data-tr-selcount>0 selected</span>
          <button type="button" class="btn primary" data-tr-bulk="print" disabled>🖨️ Print selected</button>
          <button type="button" class="btn" data-tr-bulk="pdf" disabled title="Selected requests ke labels ki PDF file (address ka same format) — seedha download">📄 Download PDF</button>
          ${isAdmin() ? '<button type="button" class="btn" data-tr-bulk="approve" disabled>✅ Approve selected</button>' : ''}
          <button type="button" class="btn" data-tr-bulk="csv" title="Selected (ya saari dikhti) rows ka CSV">⬇ CSV</button>
          <button type="button" class="btn small" data-tr-bulk="none" hidden>✕ Selection hatao</button>
        </div>
        <div class="tr-req-filter">
          <div class="tr-chips" data-tr-chips>${chipsHtml(displayRows(state.requests))}</div>
          <input class="input tr-req-search" data-tr-search type="search" placeholder="🔎 Agent / employee / mobile / PIN / ID" value="${esc(state.filter.q)}">
          <button type="button" class="btn" data-tr-act="req-refresh" title="Nayi requests laao">↻</button>
        </div>
      </div>
      <div class="table-wrap tall tr-req-wrap"><table class="tbl tr-req-tbl">
        <thead>
          <tr>
            <th rowspan="2" class="tr-c-sel"></th><th rowspan="2">Date · ID</th><th rowspan="2">Employee</th><th rowspan="2">Agent</th><th rowspan="2">📍 Mobile · Address</th>
            <th colspan="3" class="section has">📦 Stock</th><th colspan="5" class="section has">📈 Issuance (🚗 VC4+VC20 · 🚚 VC5+)</th>
            <th rowspan="2">🏷️ Requested (class-wise)</th><th rowspan="2" class="num">Total</th><th rowspan="2">Status</th><th rowspan="2"></th>
          </tr>
          <tr>
            <th class="num">Total</th><th class="num">🚗 VC4/VC20</th><th class="num">🚚 VC5+</th>
            <th class="num">Last month<small class="tr-th-sub">${esc(lm)}</small></th><th class="num">Current<small class="tr-th-sub">MTD</small></th>
            <th class="num">Run rate<small class="tr-th-sub">/ din</small></th><th class="num">Expected<small class="tr-th-sub">month-end</small></th><th class="num">Growth<small class="tr-th-sub">exp vs last</small></th>
          </tr>
        </thead>
        <tbody data-tr-tbody><tr><td colspan="17">${U.spinner('Requests load ho rahi hain…')}</td></tr></tbody>
      </table></div>
      <div class="tr-req-foot dim small" data-tr-foot></div>
      <p class="dim small tr-legend">🚗 = VC4 + VC20 (car/jeep) · 🚚 = VC5+ (commercial) · Run rate = current MTD ÷ din (FF: kal tak, GV: aaj tak) · Expected = run rate × mahine ke din · Growth = expected vs last month · <i class="tr-src live"></i> live data · <i class="tr-src snap"></i> submit ke waqt ka snapshot · Approve ke baad ☑ select → 🖨️ Print selected = har request ka label sirf ek baar.</p>
    </section>`;
  }
  function renderRequests() {
    const body = bodyEl();
    if (!body) return;
    state.edit = null;
    state.dview = filterRows(displayRows(state.requests));
    body.innerHTML = requestsShellHtml();
    bindRequestsCard();
    if (state.reqLoaded) renderReqTable();
    loadRequests(true).then(() => { if (state.view === 'requests') renderReqTable(); });
    buildIndex().then(() => { if (state.view === 'requests') refreshMetrics(); }).catch(() => {});
    if (isAdmin()) loadExactStock().then((m) => { if (m && state.view === 'requests') refreshMetrics(); }).catch(() => {});
  }
  function renderReqTable() {
    const card = rootEl.querySelector('#tr-req-card');
    if (!card) return;
    const all = displayRows(state.requests);
    // Jo request ab list me hi nahi (delete) unka selection bhi hatao
    const keys = new Set(all.map((dr) => dr.key));
    [...state.sel].forEach((k) => { if (!keys.has(k)) state.sel.delete(k); });
    state.dview = filterRows(all);
    const tbody = card.querySelector('[data-tr-tbody]');
    const shown = state.dview.slice(0, state.limit);
    if (tbody) {
      if (state.reqError && !state.requests.length) tbody.innerHTML = `<tr><td colspan="17" class="empty">⚠️ Requests load nahi hui: ${esc(state.reqError)} <button class="btn small" data-tr-act="req-refresh">↻ Retry</button></td></tr>`;
      else if (!all.length) tbody.innerHTML = '<tr><td colspan="17" class="empty">Abhi koi tag request nahi hai. 📝 Form bharo → 📤 submit.<br><small class="dim">Employee link se aayi requests bhi yahin dikhengi (🌐 badge ke saath).</small></td></tr>';
      else if (!shown.length) tbody.innerHTML = '<tr><td colspan="17" class="empty">Is filter / search me koi request nahi.</td></tr>';
      else tbody.innerHTML = shown.map(reqRowHtml).join('');
    }
    const chips = card.querySelector('[data-tr-chips]');
    if (chips) chips.innerHTML = chipsHtml(all);
    const count = card.querySelector('[data-tr-count]');
    if (count) count.textContent = fmt(state.dview.length);
    const foot = card.querySelector('[data-tr-foot]');
    if (foot) {
      const tags = state.dview.reduce((s, dr) => s + dr.total, 0);
      foot.innerHTML = `${fmt(state.dview.length)} rows · ${fmt(tags)} tags${state.dview.length > shown.length ? ` · <button type="button" class="btn small" data-tr-act="more">⬇ Aur dikhao (${fmt(state.dview.length - shown.length)} baaki)</button>` : ''}`;
    }
    updateSelUi();
    if (state.edit) {
      const first = card.querySelector('.tr-editing [data-tr-eq]');
      if (first && first.focus) first.focus();
    }
  }
  /** Index / exact stock aaya → har row ke metric cells in-place (search box ka focus bana rahe). */
  function refreshMetrics() {
    const card = rootEl && rootEl.querySelector('#tr-req-card');
    if (!card) return;
    const byKey = new Map(state.dview.map((dr) => [dr.key, dr]));
    card.querySelectorAll('tr[data-tr-key]').forEach((tr) => {
      const dr = byKey.get(tr.dataset.trKey);
      if (!dr) return;
      const tmp = document.createElement('tr');
      tmp.innerHTML = metricCellsHtml(dr);
      const fresh = [...tmp.querySelectorAll('[data-tr-m]')];
      tr.querySelectorAll('[data-tr-m]').forEach((td, i) => {
        const f = fresh[i];
        if (!f) return;
        td.innerHTML = f.innerHTML;
        td.className = f.className;
        if (f.title) td.title = f.title; else td.removeAttribute('title');
      });
    });
  }
  function updateSelUi() {
    const card = rootEl && rootEl.querySelector('#tr-req-card');
    if (!card) return;
    const n = state.sel.size;
    const visible = state.dview.slice(0, state.limit);
    const visSel = visible.filter((dr) => state.sel.has(dr.key)).length;
    const lbl = card.querySelector('[data-tr-selcount]');
    if (lbl) lbl.textContent = n ? `${fmt(n)} selected${visSel < n ? ` (${fmt(n - visSel)} filter se chhupe)` : ''}` : '0 selected';
    const all = card.querySelector('[data-tr-selall]');
    if (all) { all.checked = !!visible.length && visSel === visible.length; all.indeterminate = visSel > 0 && visSel < visible.length; }
    const pr = card.querySelector('[data-tr-bulk="print"]');
    if (pr) { pr.disabled = !n; pr.textContent = n ? `🖨️ Print selected (${fmt(selectedRequests().length)})` : '🖨️ Print selected'; }
    const pf = card.querySelector('[data-tr-bulk="pdf"]');
    if (pf) { pf.disabled = !n; pf.textContent = n ? `📄 Download PDF (${fmt(selectedRequests().length)})` : '📄 Download PDF'; }
    const ap = card.querySelector('[data-tr-bulk="approve"]');
    if (ap) { const p = selectedRequests().filter((r) => (r.status || 'pending') === 'pending').length; ap.disabled = !p; ap.textContent = p ? `✅ Approve selected (${fmt(p)})` : '✅ Approve selected'; }
    const none = card.querySelector('[data-tr-bulk="none"]');
    if (none) none.hidden = !n;
    card.querySelectorAll('tr[data-tr-key]').forEach((tr) => { if (tr.classList) tr.classList.toggle('tr-sel', state.sel.has(tr.dataset.trKey)); });
  }
  /** Selected rows → unique requests (table order me) — print / approve isi se. */
  function selectedRequests() {
    const seen = new Set();
    const out = [];
    displayRows(state.requests).forEach((dr) => {
      if (!state.sel.has(dr.key) || seen.has(dr.req.id)) return;
      seen.add(dr.req.id); out.push(dr.req);
    });
    return out;
  }
  const findDr = (key) => displayRows(state.requests).find((dr) => dr.key === key) || null;
  function replaceRequest(updated) {
    if (!updated || !updated.id) return;
    const i = state.requests.findIndex((x) => x.id === updated.id);
    if (i >= 0) state.requests[i] = { ...state.requests[i], ...updated };
  }
  function putRequest(r, payload) {
    return FF.auth.api(`/api/tag-requests/${encodeURIComponent(r.id)}`, 'PUT', payload).then((out) => { if (out && out.request) replaceRequest(out.request); return out; });
  }
  function startEdit(dr) {
    const qty = {};
    dr.rows.forEach((x) => { qty[String(x.cls).toUpperCase()] = String(num(x.approved)); });
    state.edit = { key: dr.key, qty, note: dr.req.adminNote || '' };
    renderReqTable();
  }
  function saveEdit() {
    const ed = state.edit;
    const dr = ed && findDr(ed.key);
    if (!dr) { state.edit = null; renderReqTable(); return; }
    const classQty = {};
    const extraData = {}; // nayi class jodi → us class ka live stock/issuance snapshot bhi bhejo
    const rec = state.index ? lookupAgent(dr.agent) : null;
    Object.entries(ed.qty).forEach(([c, v]) => {
      const qty = Math.max(0, Math.round(num(v)));
      const x = dr.rows.find((y) => String(y.cls).toUpperCase() === c);
      if (x ? num(x.approved) !== qty : qty > 0) {
        classQty[c] = qty;
        if (!x && rec && CLASS_LIST.includes(c)) { const d = classData(rec, c); extraData[c] = { stock: d.stock, last: d.last, cur: d.cur }; }
      }
    });
    const payload = {};
    if (Object.keys(classQty).length) { payload.classQty = classQty; if (dr.agentKey) payload.agentKey = dr.agentKey; if (Object.keys(extraData).length) payload.classData = extraData; }
    if (isAdmin() && clean(ed.note) !== clean(dr.req.adminNote)) payload.adminNote = clean(ed.note);
    if (!Object.keys(payload).length) { state.edit = null; renderReqTable(); U.toast('Kuch badla nahi', 'info'); return; }
    const btn = rootEl.querySelector('.tr-editing [data-tr-op="save"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    putRequest(dr.req, payload).then(() => {
      state.edit = null;
      U.toast(`💾 ${dr.agent.name} — qty update ho gayi`, 'ok');
      renderReqTable();
    }).catch((err) => {
      U.toast('Save fail: ' + ((err && err.message) || ''), 'err');
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save'; }
    });
  }
  function setStatus(dr, status, btn) {
    if (btn) { btn.disabled = true; }
    return putRequest(dr.req, { status }).then(() => {
      U.toast(`${STATUS[status] ? STATUS[status].label : status} — ${dr.agent.name}`, 'ok');
      renderReqTable();
    }).catch((err) => { U.toast('Status update fail: ' + ((err && err.message) || ''), 'err'); renderReqTable(); });
  }
  async function bulkApprove() {
    const list = selectedRequests().filter((r) => (r.status || 'pending') === 'pending');
    if (!list.length) { U.toast('Selected me koi pending request nahi', 'info'); return; }
    if (!window.confirm(`${list.length} pending request${list.length > 1 ? 's' : ''} approve karein?`)) return;
    const btn = rootEl.querySelector('[data-tr-bulk="approve"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Approve ho rahi hain…'; }
    let ok = 0, fail = 0;
    for (const r of list) {
      try { await putRequest(r, { status: 'approved' }); ok++; } catch { fail++; }
    }
    U.toast(`✅ ${ok} approve${fail ? ` · ⚠️ ${fail} fail` : ''}`, fail ? 'warn' : 'ok');
    renderReqTable();
  }
  function exportCsv() {
    if (FF.auth && FF.auth.can && !FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const rows = state.sel.size ? displayRows(state.requests).filter((dr) => state.sel.has(dr.key)) : state.dview;
    if (!rows.length) { U.toast('Koi row nahi', 'warn'); return; }
    const header = ['Date', 'Request ID', 'Status', 'Employee', 'Office', 'Agent', 'Agent ID', 'TL', 'Channel', 'Mobile', 'Address', 'Pincode',
      'Stock total', 'Stock VC4+VC20', 'Stock VC5+', `Last month (${U.labelYM(ymLast())})`, 'Current MTD', 'Run rate / day', 'Expected month-end', 'Growth %',
      ...CLASS_LIST.flatMap((c) => [`${c} requested`, `${c} approved`]), 'Total requested', 'Total approved', 'Note', 'Admin note', 'Source'];
    const data = rows.map((dr) => {
      const r = dr.req, e = r.employee || {}, n = metricNumbers(metricsFor(dr));
      const cls = (c) => { const x = dr.rows.find((y) => String(y.cls).toUpperCase() === c); return x ? [x.requested === undefined ? num(x.approved) : num(x.requested), num(x.approved)] : ['', '']; };
      return [
        new Date(r.at).toLocaleString('en-IN'), r.id, r.status || 'pending', e.name || r.byName || '', e.office || '', dr.agent.name, dr.agent.agentId, dr.agent.tl,
        dr.agent.channel === 'gv' ? 'GV Partner' : 'First Forward', dr.contact.mobile, dr.contact.address, dr.contact.pincode,
        n.total.stock, n.core.stock, n.comm.stock, n.total.last, n.total.cur, round1(n.total.rate), n.total.exp, n.total.growth === null ? 'new' : round1(n.total.growth),
        ...CLASS_LIST.flatMap(cls), dr.requested, dr.total, r.note || '', r.adminNote || '', r.source === 'public-link' ? 'employee link' : 'login'
      ];
    });
    U.downloadCsv(`tag-requests-${U.stamp()}.csv`, header, data);
    U.toast(`⬇ ${data.length} rows ka CSV`, 'ok');
  }
  function bindRequestsCard() {
    const card = rootEl.querySelector('#tr-req-card');
    if (!card) return;
    let searchTimer = null;
    card.addEventListener('click', (e) => {
      const t = e.target;
      const bulk = t.closest && t.closest('[data-tr-bulk]');
      if (bulk) {
        const op = bulk.dataset.trBulk;
        if (op === 'print') openPrint(selectedRequests());
        else if (op === 'pdf') downloadPdf(selectedRequests());
        else if (op === 'approve') bulkApprove();
        else if (op === 'csv') exportCsv();
        else if (op === 'none') { state.sel.clear(); updateSelUi(); card.querySelectorAll('[data-tr-sel]').forEach((x) => { x.checked = false; }); }
        return;
      }
      const chip = t.closest && t.closest('[data-tr-chip]');
      if (chip) { state.filter.status = chip.dataset.trChip; state.limit = PAGE_ROWS; state.edit = null; renderReqTable(); return; }
      const act = t.closest && t.closest('[data-tr-act]');
      if (act && act.dataset.trAct === 'req-refresh') { loadRequests(true).then(() => { renderReqTable(); U.toast('↻ Requests taaza', 'ok'); }); return; }
      if (act && act.dataset.trAct === 'more') { state.limit += PAGE_ROWS; renderReqTable(); return; }
      const opEl = t.closest && t.closest('[data-tr-op]');
      if (!opEl) return;
      const dr = findDr(opEl.dataset.key);
      if (!dr) return;
      const op = opEl.dataset.trOp;
      if (op === 'approve') setStatus(dr, 'approved', opEl);
      else if (op === 'edit') startEdit(dr);
      else if (op === 'cancel') { state.edit = null; renderReqTable(); }
      else if (op === 'save') saveEdit();
      else if (op === 'print1') openPrint([dr.req]);
      else if (op === 'pdf1') downloadPdf([dr.req]);
      else if (op === 'copy') U.copyText(labelText(dr.req)).then((ok) => U.toast(ok ? '📋 Label text copy ho gaya' : 'Copy nahi hua', ok ? 'ok' : 'warn'));
      else if (op === 'push') {
        opEl.disabled = true;
        FF.auth.api('/api/tag-request-sheet/push', 'POST', { id: dr.req.id })
          .then((out) => { U.toast(`📗 Sheet me ${out.added} rows add ho gayi (tab: ${out.tab || ''})`, 'ok'); dr.req.sheetSync = { at: new Date().toISOString(), event: 'manual', added: out.added, tab: out.tab }; renderReqTable(); })
          .catch((err) => { U.toast('Sheet push fail: ' + ((err && err.message) || ''), 'err'); opEl.disabled = false; });
      } else if (op === 'del') {
        if (!window.confirm(`${dr.agent.name} ki request delete karein? (${fmt(dr.req.total)} tags${dr.siblings > 1 ? ` · poori request ${dr.siblings} agents ki` : ''})`)) return;
        FF.auth.api(`/api/tag-requests/${encodeURIComponent(dr.req.id)}`, 'DELETE').then(() => {
          state.requests = state.requests.filter((x) => x.id !== dr.req.id);
          U.toast('🗑 Request delete ho gayi', 'ok');
          renderReqTable();
        }).catch((err) => U.toast('Delete fail: ' + ((err && err.message) || ''), 'err'));
      }
    });
    card.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches && t.matches('[data-tr-sel]')) {
        if (t.checked) state.sel.add(t.dataset.trSel); else state.sel.delete(t.dataset.trSel);
        updateSelUi();
        return;
      }
      if (t.matches && t.matches('[data-tr-selall]')) {
        state.dview.slice(0, state.limit).forEach((dr) => { if (t.checked) state.sel.add(dr.key); else state.sel.delete(dr.key); });
        card.querySelectorAll('[data-tr-sel]').forEach((x) => { x.checked = state.sel.has(x.dataset.trSel); });
        updateSelUi();
        return;
      }
      if (t.matches && t.matches('[data-tr-status]')) {
        const dr = findDr(t.dataset.key);
        if (dr && t.value !== (dr.req.status || 'pending')) setStatus(dr, t.value, t);
      }
    });
    card.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches && t.matches('[data-tr-search]')) {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { state.filter.q = t.value; state.limit = PAGE_ROWS; state.edit = null; renderReqTable(); }, 180);
        return;
      }
      if (t.matches && t.matches('[data-tr-eq]') && state.edit) {
        const c = t.value.replace(/\D/g, '').slice(0, 6);
        if (c !== t.value) t.value = c;
        state.edit.qty[t.dataset.trEq] = c;
        const tr = t.closest('tr');
        const tot = tr && tr.querySelector('[data-tr-rowtotal]');
        if (tot) tot.textContent = fmt(Object.values(state.edit.qty).reduce((s, v) => s + Math.round(num(v)), 0));
        return;
      }
      if (t.matches && t.matches('[data-tr-enote]') && state.edit) state.edit.note = t.value;
    });
    card.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!state.edit || !(t.matches && (t.matches('[data-tr-eq]') || t.matches('[data-tr-enote]')))) return;
      if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
      else if (e.key === 'Escape') { state.edit = null; renderReqTable(); }
    });
  }

  // ---- ⚙️ Link & Sheet (admin) — employee link card + 📗 Google Sheet sync card --------------------------
  function loadSheetConfig(force) {
    if (!isAdmin()) return Promise.resolve(null);
    if (state.sheet.loaded && !force) return Promise.resolve(state.sheet.config);
    return FF.auth.api('/api/tag-request-sheet').then((out) => {
      state.sheet.loaded = true;
      state.sheet.config = out.config || null;
      state.sheet.fields = out.fields || {};
      state.sheet.connected = !!out.connected;
      state.sheet.hint = out.hint || '';
      state.sheet.publicForm = out.publicForm || null;
      if (state.sheet.publicForm) state.formCfg = { ...(state.formCfg || {}), ...state.sheet.publicForm };
      return state.sheet.config;
    }).catch((err) => { state.sheet.hint = (err && err.message) || 'Config load nahi hui'; return null; });
  }
  function renderSettings() {
    const body = bodyEl();
    if (!body) return;
    body.innerHTML = publicCardHtml() + sheetCardHtml();
    bindPublicCard(); bindSheetCard();
  }
  function sheetCardHtml() {
    const s = state.sheet;
    const cfg = s.config;
    if (!cfg) return '<section class="card" id="tr-sheet-card"><div class="card-body dim small">📗 Google Sheet sync load ho raha hai…</div></section>';
    const fields = s.fields || {};
    const colBox = Object.entries(fields).map(([k, label]) => `<label class="tr-col-opt"><input type="checkbox" data-tr-col="${esc(k)}" ${cfg.columns.includes(k) ? 'checked' : ''}> ${esc(label)}</label>`).join('');
    const targetId = sheetIdOfLink(cfg.sheetLink) || cfg.spreadsheetId || '';
    const noAgentCols = !['agentMobile', 'agentAddress', 'agentPincode'].some((k) => cfg.columns.includes(k));
    return `<section class="card" id="tr-sheet-card"><div class="card-head"><h3>📗 Google Sheet me direct entry <span class="badge ${cfg.enabled ? 'green' : ''}">${cfg.enabled ? 'ON' : 'OFF'}</span></h3>
      <div class="card-right dim">Admin — tag requests ko seedha apni Google Sheet me likho</div></div>
      <div class="card-body">
        ${s.connected ? '' : `<div class="notice amber" style="margin-bottom:10px">⚠️ ${esc(s.hint || 'Apps Script connect nahi hai — pehle sheet storage setup karo.')}</div>`}
        ${noAgentCols ? '<div class="notice amber" style="margin-bottom:10px">ℹ️ v3.30: delivery ab <b>agent</b> ke address par hoti hai — neeche <b>Agent mobile / Agent address / Agent pincode</b> columns tick karke save karo (naye columns sheet me aakhir me judte hain).</div>' : ''}
        <div class="tr-sheet-grid">
          <label class="field"><span class="dim small">Alag Google Sheet ka link (khaali = jis sheet me Apps Script hai usi me entry)</span>
            <input class="input" data-tr-sheet="sheetLink" value="${esc(cfg.sheetLink || '')}" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
          <label class="field"><span class="dim small">Sheet ke andar ka tab (naam)</span>
            <input class="input" data-tr-sheet="tab" value="${esc(cfg.tab || 'Tag Requests')}" placeholder="Tag Requests"></label>
          <label class="field"><span class="dim small">Kaunsi rows likhi jaayein</span>
            <select class="input" data-tr-sheet="rowMode">
              <option value="class" ${cfg.rowMode === 'class' ? 'selected' : ''}>Har agent × class ki alag row (default)</option>
              <option value="agent" ${cfg.rowMode === 'agent' ? 'selected' : ''}>Har agent ki ek row (classes ek saath)</option>
              <option value="request" ${cfg.rowMode === 'request' ? 'selected' : ''}>Har request ki ek total row</option>
            </select></label>
          <label class="field"><span class="dim small">Kab entry ho</span>
            <span class="tr-check-row">
              <label class="tr-col-opt"><input type="checkbox" data-tr-sheet="onSubmit" ${cfg.onSubmit !== false ? 'checked' : ''}> Nayi request par</label>
              <label class="tr-col-opt"><input type="checkbox" data-tr-sheet="onStatus" ${cfg.onStatus !== false ? 'checked' : ''}> Status change par (approved/dispatched)</label>
            </span></label>
        </div>
        <label class="field" style="display:block;margin-top:8px"><span class="dim small">Kaunse columns sheet me aayein (order = checkbox order)</span>
          <div class="tr-cols-grid">${colBox}</div></label>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn primary" data-tr-sheet-act="save">💾 Save settings</button>
          <button class="btn" data-tr-sheet-act="toggle">${cfg.enabled ? '⏸ Sync OFF karo' : '▶️ Sync ON karo'}</button>
          <button class="btn" data-tr-sheet-act="test">🔌 Sheet check karo</button>
          ${cfg.sheetLink ? `<a class="btn" href="${esc(cfg.sheetLink)}" target="_blank" rel="noopener">↗ Sheet kholo</a>` : ''}
        </div>
        <p class="dim small" style="margin-top:8px">${targetId ? `🎯 Entries <b>is sheet</b> me jaayengi (ID …${esc(String(targetId).slice(-8))} · tab <b>${esc(cfg.tab || '')}</b>). Us sheet par Apps Script wale Google account ka <b>Editor</b> access hona chahiye — Sheet → Share.` : 'Entries is waqt usi sheet me hoti hain jisme Apps Script bana hai (Settings → Backup). Kahin aur bhejna ho to upar <b>alag sheet ka link</b> paste karo.'} Tab na ho to ban jaata hai; pehli entry par header row apne aap likhi jaati hai. Har agent ki request alag rows me jaati hai (ek submit = ek saath). Table ki har row me <b>📗</b> button se manual entry bhi kar sakte ho.</p>
      </div></section>`;
  }
  /** Employee link (bina login) ka admin control: ON/OFF, fields, title, link copy. */
  function publicCardHtml() {
    const pub = state.sheet.publicForm;
    if (!pub) return '<section class="card" id="tr-public-card"><div class="card-body dim small">🌐 Employee link settings load ho rahi hain…</div></section>';
    const link = shareLink();
    const open = pub.enabled !== false;
    return `<section class="card" id="tr-public-card"><div class="card-head"><h3>🌐 Employee link (bina login) <span class="badge ${open ? 'green' : ''}">${open ? 'ON' : 'OFF'}</span></h3>
      <div class="card-right dim">Ye link koi bhi khol sakta hai — login/signup nahi · employee naam + har agent ka mobile/address/pincode</div></div>
      <div class="card-body">
        <div class="tr-public-link-row">
          <input class="input" id="tr-public-link" readonly value="${esc(link)}">
          <button class="btn primary" data-tr-pub-act="copy" data-link="${esc(link)}">📋 Copy link</button>
          <button class="btn" data-tr-pub-act="wa" data-link="${esc(link)}">💬 WhatsApp</button>
        </div>
        <div class="tr-sheet-grid" style="margin-top:10px">
          <label class="field"><span class="dim small">Form ka title (employee ko dikhta hai)</span>
            <input class="input" data-tr-pub="title" value="${esc(pub.title || '')}" placeholder="IDFC Agents Tag Request"></label>
          <label class="field"><span class="dim small">Upar ka message (optional)</span>
            <input class="input" data-tr-pub="intro" value="${esc(pub.intro || '')}" placeholder="Naam likho → agent ka block bharo → submit"></label>
          <label class="field"><span class="dim small">Agent ke fields aur check</span>
            <span class="tr-check-row">
              <label class="tr-col-opt"><input type="checkbox" data-tr-pub="askMobile" ${pub.askMobile !== false ? 'checked' : ''}> Agent mobile number (zaroori)</label>
              <label class="tr-col-opt"><input type="checkbox" data-tr-pub="askAddress" ${pub.askAddress !== false ? 'checked' : ''}> Agent full address + pincode (zaroori)</label>
              <label class="tr-col-opt"><input type="checkbox" data-tr-pub="askOffice" ${pub.askOffice ? 'checked' : ''}> Employee branch/office (optional)</label>
              <label class="tr-col-opt"><input type="checkbox" data-tr-pub="showCheck" ${pub.showCheck !== false ? 'checked' : ''}> Class ke aage stock/MTD hint dikhao</label>
            </span></label>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn primary" data-tr-pub-act="save">💾 Save</button>
          <button class="btn" data-tr-pub-act="toggle">${open ? '⏸ Link OFF karo' : '▶️ Link ON karo'}</button>
        </div>
        <p class="dim small" style="margin-top:8px">🔐 Employee ko sirf yehi form dikhta hai (📝 Form + 🔎 Status) — dashboard ka koi doosra page nahi. Har agent ki request <b>🌐 link</b> badge ke saath 📥 Tag Requests me alag row me aati hai. Agent / employee status <b>agent ke mobile number</b> (ya Request ID) se dekh sakte hain — status me address kabhi nahi dikhta. Login form par bhi yahi mandatory fields lagti hain.</p>
      </div></section>`;
  }
  function replaceCard(id, html) {
    const card = rootEl && rootEl.querySelector ? rootEl.querySelector(id) : null;
    if (!card || !card.replaceWith) return null;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const fresh = tmp.firstElementChild;
    if (!fresh) return null;
    card.replaceWith(fresh);
    return fresh;
  }
  function bindPublicCard() {
    if (!isAdmin()) return;
    loadSheetConfig().then(() => {
      if (state.view === 'settings' && state.sheet.publicForm && replaceCard('#tr-public-card', publicCardHtml())) attach();
    });
    function attach() {
      const card = rootEl.querySelector('#tr-public-card');
      if (!card) return;
      const act = (name, fn) => { const b = card.querySelector(`[data-tr-pub-act="${name}"]`); if (b) b.addEventListener('click', fn); };
      const collect = () => ({
        title: (card.querySelector('[data-tr-pub="title"]') || {}).value || '',
        intro: (card.querySelector('[data-tr-pub="intro"]') || {}).value || '',
        askMobile: !!(card.querySelector('[data-tr-pub="askMobile"]') || {}).checked,
        askAddress: !!(card.querySelector('[data-tr-pub="askAddress"]') || {}).checked,
        askOffice: !!(card.querySelector('[data-tr-pub="askOffice"]') || {}).checked,
        showCheck: !!(card.querySelector('[data-tr-pub="showCheck"]') || {}).checked
      });
      const save = (patch, msg) => {
        const btn = card.querySelector('[data-tr-pub-act="save"]');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Save…'; }
        FF.auth.api('/api/public-tag-form', 'PUT', { config: { ...collect(), ...(patch || {}) } })
          .then((out) => { state.sheet.publicForm = out.config; state.formCfg = { ...(state.formCfg || {}), ...out.config }; U.toast(msg || '💾 Employee link settings save ho gayi', 'ok'); if (replaceCard('#tr-public-card', publicCardHtml())) attach(); })
          .catch((err) => U.toast('Save fail: ' + ((err && err.message) || ''), 'err'))
          .finally(() => { const b = rootEl.querySelector('#tr-public-card [data-tr-pub-act="save"]'); if (b) { b.disabled = false; b.textContent = '💾 Save'; } });
      };
      act('save', () => save(null));
      act('toggle', () => {
        const next = !(state.sheet.publicForm && state.sheet.publicForm.enabled !== false);
        save({ enabled: next }, next ? '▶️ Employee link ON — employees ko link bhej sakte ho' : '⏸ Employee link OFF — ab link kholne par "band hai" dikhega');
      });
      act('copy', (e) => U.copyText(e.target.dataset.link || shareLink()).then((ok) => U.toast(ok ? '📋 Employee link copy ho gaya' : 'Copy nahi hua', ok ? 'ok' : 'warn')));
      act('wa', (e) => { const l = e.target.dataset.link || shareLink(); const msg = `🏷️ Tag Request form — agent ki tag request yahan lagao (aapka naam + agent ka naam, mobile, address, pincode, qty):\n${l}`; if (FF.app && FF.app.shareWhatsApp) FF.app.shareWhatsApp(msg); else window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank'); });
      const inp = card.querySelector('#tr-public-link');
      if (inp) inp.addEventListener('click', () => { try { inp.select(); } catch { /* ignore */ } });
    }
  }
  function bindSheetCard() {
    if (!isAdmin()) return;
    loadSheetConfig().then(() => {
      if (state.view === 'settings' && state.sheet.config && replaceCard('#tr-sheet-card', sheetCardHtml())) attach();
    });
    function attach() {
      const card = rootEl.querySelector('#tr-sheet-card');
      if (!card) return;
      const act = (name, fn) => { const b = card.querySelector(`[data-tr-sheet-act="${name}"]`); if (b) b.addEventListener('click', fn); };
      const collect = () => ({
        sheetLink: (card.querySelector('[data-tr-sheet="sheetLink"]') || {}).value || '',
        tab: (card.querySelector('[data-tr-sheet="tab"]') || {}).value || 'Tag Requests',
        rowMode: (card.querySelector('[data-tr-sheet="rowMode"]') || {}).value || 'class',
        onSubmit: !!(card.querySelector('[data-tr-sheet="onSubmit"]') || {}).checked,
        onStatus: !!(card.querySelector('[data-tr-sheet="onStatus"]') || {}).checked,
        columns: [...card.querySelectorAll('[data-tr-col]:checked')].map((x) => x.dataset.trCol)
      });
      act('save', () => {
        const btn = card.querySelector('[data-tr-sheet-act="save"]');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Save…'; }
        FF.auth.api('/api/tag-request-sheet', 'PUT', { config: collect() })
          .then((out) => { state.sheet.config = out.config; state.sheet.connected = !!out.connected; U.toast('💾 Sheet sync settings save ho gayi', 'ok'); if (replaceCard('#tr-sheet-card', sheetCardHtml())) attach(); })
          .catch((err) => U.toast('Save fail: ' + ((err && err.message) || ''), 'err'))
          .finally(() => { if (btn) { btn.disabled = false; btn.textContent = '💾 Save settings'; } });
      });
      act('toggle', () => {
        const cfg = collect();
        cfg.enabled = !(state.sheet.config && state.sheet.config.enabled);
        FF.auth.api('/api/tag-request-sheet', 'PUT', { config: cfg })
          .then((out) => { state.sheet.config = out.config; state.sheet.connected = !!out.connected; U.toast(out.config.enabled ? '▶️ Google Sheet sync ON — nayi requests direct sheet me jayengi' : '⏸ Sheet sync OFF', out.config.enabled ? 'ok' : 'info'); if (replaceCard('#tr-sheet-card', sheetCardHtml())) attach(); })
          .catch((err) => U.toast('Toggle fail: ' + ((err && err.message) || ''), 'err'));
      });
      act('test', () => {
        const btn = card.querySelector('[data-tr-sheet-act="test"]');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Check…'; }
        const cfgNow = collect();
        FF.auth.api('/api/tag-request-sheet/test', 'POST', { sheetLink: cfgNow.sheetLink, tab: cfgNow.tab })
          .then((out) => {
            const where = out.spreadsheet ? `sheet "${out.spreadsheet}" (tab ${out.tab})` : `tab ${out.tab}`;
            U.toast(`🔌 Connected ✓ — ${where}${out.note ? ' · ' + out.note : ''}`, out.targetExists === false ? 'warn' : 'ok');
          })
          .catch((err) => U.toast('Sheet check fail: ' + ((err && err.message) || ''), 'err'))
          .finally(() => { if (btn) { btn.disabled = false; btn.textContent = '🔌 Sheet check karo'; } });
      });
    }
  }

  // ---- render -----------------------------------------------------------------------------------
  async function render(root, params, ctx) {
    rootEl = root;
    // 🌐 Public mode: /tag-request (ya ?public=1) — bina login.
    state.publicMode = !!(params && params.public) || !!isPublic();
    if (params && ctx && ctx.publicConfig) state.publicCfg = ctx.publicConfig;
    if (state.publicMode && !state.publicCfg && FF.publicForm && FF.publicForm.config) state.publicCfg = FF.publicForm.config;
    loadEmployee();
    if (!state.publicMode && !clean(state.employee.name)) state.employee.name = (FF.auth && FF.auth.user && (FF.auth.user.name || FF.auth.user.username)) || '';
    const views = state.publicMode ? ['form', 'status', 'done'] : ['form', 'requests', 'settings'];
    if (params && params.view) {
      const v = params.view === 'result' ? 'form' : String(params.view); // purana "Result" tab ab form me hi
      if (views.includes(v)) state.view = v;
    }
    if (state.publicMode && params && params.mobile) { state.status = { q: String(params.mobile), list: null, busy: false, err: '', searched: '' }; state.view = 'status'; }
    if (!views.includes(state.view) || (state.view === 'settings' && !isAdmin()) || (state.view === 'done' && !state.done)) state.view = 'form';
    root.innerHTML = `${headHtml()}<div id="tr-body"></div>`;
    bindCommon(root);
    const qp = (params && params.agent) ? String(params.agent) : '';
    if (qp && !state.rows.some((r) => r.name || r.agentId)) state.rows = [newRow({ agentId: /^\d+$/.test(qp) ? qp : '', name: /^\d+$/.test(qp) ? '' : qp })];
    renderRoot();
    if (!state.publicMode) {
      loadFormCfg().then(() => {
        const active = document.activeElement;
        const typing = active && root.contains && root.contains(active);
        if (state.view === 'form' && root.isConnected && !typing) renderForm();
      });
    }
    buildIndex().then(() => onIndexReady()).catch(() => {});
  }

  /**
   * Headless system-check — bina UI ke (assistant / smoke test / deep link).
   * `preview([{ name|agentId, classes: ['VC4'], qty }])` → analyze ka result (rows + tl rollup).
   * Qty na diya ho to system suggestion lagti hai; classQty object diya to wahi.
   * Page ka state nahi chhua jaata, isliye ye kabhi bhi safe hai.
   */
  async function preview(input) {
    const rows = (Array.isArray(input) ? input : [input || {}]).map((x) => {
      const q = emptyQty();
      const clsList = (Array.isArray(x.classes) ? x.classes : [x.cls || 'VC4']).map((c) => String(c || '').toUpperCase()).filter((c) => CLASS_LIST.includes(c));
      const given = x.classQty && typeof x.classQty === 'object' ? x.classQty : null;
      if (given) {
        CLASS_LIST.forEach((c) => { q[c] = given[c] === undefined || given[c] === null ? '' : String(given[c]); });
      } else if (x.qty !== undefined && x.qty !== null && x.qty !== '') {
        clsList.forEach((c) => { q[c] = String(x.qty); });
      }
      return newRow({
        agentId: /^\d+$/.test(String(x.agentId || x.name || '')) ? String(x.agentId || x.name) : '',
        name: /^\d+$/.test(String(x.agentId || x.name || '')) ? '' : String(x.name || x.agentId || ''),
        classes: given ? [] : clsList,
        q
      });
    });
    const keep = state.rows;
    const keepResult = state.result;
    state.rows = rows;
    try {
      await buildIndex();
      const hasAnyQty = rows.some((r) => CLASS_LIST.some((c) => String(r.q[c]).trim() !== ''));
      return analyze(!hasAnyQty);
    } finally { state.rows = keep; state.result = keepResult; }
  }

  FF.pages.tagRequest = {
    title: 'Tag Request',
    render,
    preview,
    shareLink,
    // 🖨️ Dispatch labels — pure HTML generators (smoke/tests): 1 request = 1 label, multi = har ek EK baar.
    dispatchLabelHtml, labelsPdf, downloadPdf, tlRecord, labelsHtml: (requests, opts) => labelsHtml(uniqueRequests(requests).map(labelItem), opts), labelText, dispatchFrom,
    // 🔁 Diagnostics (smoke): duplicate warning card ka wahi HTML jo employee dekhta hai.
    dupWarning: (list, name) => {
      const saved = { dup: state.dup, emp: state.employee };
      state.dup = { list: Array.isArray(list) ? list : [], force: false, busy: false };
      state.employee = { ...(saved.emp || {}), name: name || (saved.emp && saved.emp.name) || 'Employee' };
      const html = dupWarningHtml();
      state.dup = saved.dup; state.employee = saved.emp;
      return html;
    },
    // 🧪 Tests: requests → table rows (har agent ek row) + row HTML + submit payload.
    _test: {
      displayRows, reqRowHtml: (dr) => reqRowHtml(dr), metricNumbers, agentKeyOf, labelItem, contactOf,
      payload: (rows, employee) => {
        const keep = { rows: state.rows, emp: state.employee };
        state.rows = rows.map((r) => newRow({ ...r, q: { ...emptyQty(), ...(r.q || {}) } }));
        state.employee = { name: '', office: '', ...(employee || {}) };
        try { return { ids: state.rows.map((r) => r.id), errors: validateForm(), errs: state.errs, payload: buildPayload() }; } finally { state.rows = keep.rows; state.employee = keep.emp; state.errs = {}; }
      }
    },
    // Diagnostics (Settings → support / smoke): index kitna bana, koi error?
    indexInfo: () => ({
      agents: state.index ? state.index.list.length : 0,
      tls: state.index ? state.index.tls.size : 0,
      at: state.index ? state.index.at : 0,
      error: state.index && state.index.error ? String(state.index.error.message || state.index.error) : '',
      problems: state.problems.slice(0, 5)
    }),
    // Doosre pages / assistant se seedha "tag request banao" — agent pre-filled form.
    open: (agent) => { if (agent) state.rows = [newRow({ agentId: /^\d+$/.test(String(agent)) ? String(agent) : '', name: /^\d+$/.test(String(agent)) ? '' : String(agent) })]; state.view = 'form'; }
  };
})(window.FF);
