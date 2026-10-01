/* 🏷️ IDFC AGENTS TAG REQUEST (v3.25) — panel ka naya option.
 *
 * Flow (admin/user dono):
 *   1. 🔗 Employee link   — admin link copy karke employees ko bhejta hai; wo kholte hi form par
 *                            pahunch jaate hain (#/tagRequest?view=form). Login + "tagRequest"
 *                            permission chahiye (admin Settings → Access matrix se de deta hai).
 *   2. 📝 Form bharo      — naam/ID search karo → dropdown me AGENTS + TL dono aate hain. Agent
 *                            chunte hi ID + TL naam + channel khud bhar jaata hai. Aage saari
 *                            classes (VC4·VC5·VC6·VC7·VC12·VC16) ke aage blank box — jis class ki
 *                            jitni request hai likho (0 ya khaali = us class me koi request nahi).
 *                            Ek saath KAI agents ki request lag sakti hai (➕ Ek aur agent).
 *   3. 🔍 System check    — system khud sheet se data check karta hai: last month + current month
 *                            issuance (class-wise), agent stock, priority, growth, cover days aur
 *                            suggested qty. TL rollup bhi (TL stock / issuance / priority).
 *   4. 📤 Submit          — admin ke paas "📥 Tag Requests" me pahunch jaata hai (notification ke
 *                            saath). Rows TL ke naam se group hokar aati hain (TL hai to TL-wise,
 *                            warna agent-wise). Admin wahin se qty/status ✏️ edit karta hai.
 *   5. 📗 Google Sheet    — admin chahe to sync ON karo: tab naam + columns + rows (class/agent/
 *                            request) choose karo — har nayi request (aur status change) direct us
 *                            Google Sheet me entry ban jaati hai. Manual "Sheet me push" bhi hai.
 *   6. ⬇ / 📋 / 💬        — CSV · Excel · Copy · WhatsApp · Print, sab result par.
 *
 * Data source (koi naya bhaari query nahi — sab pehle se load hota hai):
 *   • FF.store 'agentClass' → EIR class × month × type × vrnType rows (issuance, replacement, chassis)
 *   • performance page (REPORT) → agent stock class-wise, priority, TL naam
 *   • GV REPORT (gv.get('report')) → GV agent stock/issuance class-wise + priority
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
  const STOCK_KEY = { VC4: 'stockVc4', VC5: 'stockC1', VC6: 'stockC2', VC7: 'stockC3', VC12: 'stockC4', VC16: 'stockC5' };
  const CUR_KEY = { VC4: 'curVc4', VC5: 'curC1', VC6: 'curC2', VC7: 'curC3', VC12: 'curC4', VC16: 'curC5' };
  const LAST_KEY = { VC4: 'lastVc4', VC5: 'lastC1', VC6: 'lastC2', VC7: 'lastC3', VC12: 'lastC4', VC16: 'lastC5' };
  const STATUS = {
    pending: { label: '⏳ Pending', tone: 'amber' },
    approved: { label: '✅ Approved', tone: 'green' },
    dispatched: { label: '🚚 Dispatched', tone: 'blue' },
    rejected: { label: '⛔ Rejected', tone: 'red' }
  };

  const state = {
    view: 'form', rows: [], note: '', result: null, requests: [], requestsAt: 0,
    index: null, indexPromise: null, resolved: new Map(), busy: '', problems: [],
    groupBy: 'tl', // requests/drawer me grouping: 'tl' ya 'agent'
    sheet: { loaded: false, busy: false, config: null, fields: null, connected: false, hint: '', publicForm: null },
    // 🌐 v3.27 — public (bina login) employee form ka state
    publicMode: false, publicCfg: null, employee: { name: '', mobile: '', office: '' }, done: null, status: null, statusId: '',
    // 🔁 v3.27.1 — submit se pehle duplicate check (same naam + same agent×class pehle se active?)
    dup: { list: [], force: false, busy: false }
  };
  const rid = () => Math.random().toString(36).slice(2, 9);
  const emptyQty = () => { const q = {}; CLASS_LIST.forEach((c) => { q[c] = ''; }); return q; };
  function newRow(patch) { return { id: rid(), agentId: '', name: '', tl: '', channel: '', tlFilter: '', q: emptyQty(), ...(patch || {}) }; }
  if (!state.rows.length) state.rows = [newRow()];

  const norm = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ' ');
  const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  const ymNow = () => U.ymKey(new Date());
  const ymLast = () => U.prevMonthKey(ymNow());
  const isAdmin = () => !!(FF.auth && FF.auth.user && FF.auth.user.role === 'admin');
  const isPublic = () => !!state.publicMode;
  /** Employees ko bhejne wala seedha form link — v3.27 se ye BINA LOGIN khulta hai. */
  function shareLink() {
    try { return `${location.origin}/tag-request`; }
    catch { return '/tag-request'; }
  }
  /** Google Sheet link → ID (target sheet preview ke liye; asli parsing server par hoti hai). */
  const sheetIdOfLink = (link) => { const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/.exec(String(link || '')); return m ? m[1] : ''; };
  // ---- 🌐 public (bina login) mode ke helpers ---------------------------------------------------
  const PUB_EMPLOYEE_KEY = 'ff_public_employee';
  /** Employee ka naam/mobile yaad rakho (agli baar prefilled — dobara type nahi karna padta). */
  function loadEmployee() {
    try {
      const raw = localStorage.getItem(PUB_EMPLOYEE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) || {};
      state.employee = { name: String(o.name || '').slice(0, 80), mobile: String(o.mobile || '').slice(0, 16), office: String(o.office || '').slice(0, 80) };
    } catch { /* private mode / bad JSON */ }
  }
  function saveEmployee() {
    try { localStorage.setItem(PUB_EMPLOYEE_KEY, JSON.stringify({ name: state.employee.name, mobile: state.employee.mobile, office: state.employee.office })); } catch { /* ignore */ }
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
  const employeeOk = () => String(state.employee.name || '').trim().length >= 2;
  /** Employee card — sirf public mode me (naam mandatory, baaki Settings se optional). */
  function employeeCardHtml() {
    const cfg = state.publicCfg || {};
    const e = state.employee || {};
    const missing = !employeeOk();
    return `<section class="card tr-employee ${missing ? 'tr-employee-todo' : ''}" id="tr-employee-card">
      <div class="card-head"><h3>👤 Aapka naam <span class="badge red">zaroori</span></h3>
        <div class="card-right dim">Isi naam se request admin ke paas jayegi</div></div>
      <div class="card-body">
        <div class="tr-emp-grid">
          <label class="field"><span class="dim small">Employee name *</span>
            <input class="input" data-tr-emp="name" value="${esc(e.name || '')}" placeholder="Poora naam likho (e.g. Ramesh Yadav)" autocomplete="name" maxlength="80"></label>
          ${cfg.askMobile === false ? '' : `<label class="field"><span class="dim small">Mobile (optional)</span>
            <input class="input" data-tr-emp="mobile" inputmode="tel" value="${esc(e.mobile || '')}" placeholder="10 digit mobile" maxlength="16" autocomplete="tel"></label>`}
          ${cfg.askOffice ? `<label class="field"><span class="dim small">Branch / Office (optional)</span>
            <input class="input" data-tr-emp="office" value="${esc(e.office || '')}" placeholder="e.g. Jaipur office" maxlength="80"></label>` : ''}
        </div>
        ${missing ? '<p class="dim small" style="margin:8px 0 0">☝️ Naam bharo — phir niche agent chuno aur qty likho.</p>' : ''}
      </div></section>`;
  }

  // ---- 📚 index: agent → stock / issuance / TL / priority -----------------------------------------
  /** EIR class-month rows ko agent key par jama karo. */
  function addEir(map, channel, name, id, tl, row) {
    const key = `${channel}|${norm(name) || digits(id)}`;
    const rec = map.get(key) || {
      channel, name: name || id || key, agentId: digits(id), tlName: tl || '',
      stock: {}, cur: {}, last: {}, eirCur: {}, eirLast: {}, growth: null, priority: ''
    };
    if (id && !rec.agentId) rec.agentId = digits(id);
    if (name && (!rec.name || rec.name === key)) rec.name = name;
    if (tl && !rec.tlName) rec.tlName = tl;
    const ym = row.ym, cls = String(row.cls || '').toUpperCase();
    if (!CLASS_LIST.includes(cls)) return rec ? void 0 : map.set(key, rec);
    if (ym === ymNow()) rec.eirCur[cls] = num(rec.eirCur[cls]) + num(row.n);
    if (ym === ymLast()) rec.eirLast[cls] = num(rec.eirLast[cls]) + num(row.n);
    map.set(key, rec);
    return rec;
  }
  /** Poora index — REPORT (FF) + GV REPORT (GV) + EIR class-month. Ek baar banta hai, 60s cache. */
  async function buildIndex(force) {
    if (!force && state.index && Date.now() - state.index.at < 60e3) return state.index;
    if (state.indexPromise) return state.indexPromise;
    const S = FF.store;
    const perf = FF.pages.performance;
    // 🌐 Public form: sirf zaroori datasets (`only`) + light performance load — Google par kam load,
    // mobile par kam data, aur result bilkul same (report + daily + agentClass → wahi suggestions).
    const light = isPublic();
    const only = light ? { only: true } : undefined;
    const jobs = [
      S && S.need ? S.need('agentClass', only).catch(() => []) : Promise.resolve([]),
      perf && perf.ensureLoaded ? perf.ensureLoaded(light ? { light: true } : undefined).then(() => (perf.agents ? perf.agents() : [])).catch(() => []) : Promise.resolve([]),
      FF.gv && FF.gv.need ? FF.gv.need('report').then(() => (FF.gv.get('report') || [])).catch(() => []) : Promise.resolve([])
    ];
    state.indexPromise = Promise.all(jobs).then(([eirRows, ffAgents, gvRows]) => {
      const byKey = new Map();
      const tls = new Map();
      const tlOf = (channel, tlName) => {
        const t = String(tlName || '').trim();
        if (!t || !FF.config.isRealTl(t)) return null;
        const key = `${channel}|${norm(t)}`;
        const g = tls.get(key) || { key, name: t, channel, stock: {}, cur: {}, last: {}, agents: new Set(), priority: '' };
        tls.set(key, g);
        return g;
      };
      const put = (channel, name, id, tlName, patch) => {
        const key = `${channel}|${norm(name) || digits(id)}`;
        const rec = byKey.get(key) || { channel, name: name || id, agentId: digits(id), tlName: tlName || '', stock: {}, cur: {}, last: {}, eirCur: {}, eirLast: {}, priority: '', growth: null };
        if (id && !rec.agentId) rec.agentId = digits(id);
        if (name && (!rec.name || rec.name === key)) rec.name = name;
        if (tlName && !rec.tlName) rec.tlName = tlName;
        Object.assign(rec, patch || {});
        byKey.set(key, rec);
        const g = tlOf(channel, rec.tlName);
        if (g) { g.agents.add(key); if (!g.priority && rec.priority) g.priority = rec.priority; }
        return rec;
      };
      // 🟦 First Forward — REPORT (stock class-wise, current month class-wise, priority)
      (ffAgents || []).forEach((a) => {
        const stock = {}, cur = {}, last = {};
        CLASS_LIST.forEach((cls) => {
          stock[cls] = num(a[STOCK_KEY[cls]]);
          cur[cls] = num(a[CUR_KEY[cls]]);
          last[cls] = num(a[LAST_KEY[cls]]);
        });
        put('ff', a.name, a.agentId, a.tlName, { stock, cur, last, priority: String(a.agentPriority || a.priority || '').trim(), growth: a.growth, direct: !!a.tlExcluded });
      });
      // 🟩 GV Partner — GV REPORT (stock/issuance class-wise + priority)
      (gvRows || []).forEach((r) => {
        const stock = {}, cur = {}, last = {};
        CLASS_LIST.forEach((cls) => {
          stock[cls] = num(r.stockByClass && r.stockByClass[cls]);
          cur[cls] = num(r.curByClass && r.curByClass[cls]);
          last[cls] = cls === 'VC4' ? num(r.lastVc4) : 0;
        });
        put('gv', r.agentName, r.agentId, r.tlName, { stock, cur, last, priority: String(r.priority || '').trim(), growth: r.growth });
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
        const g = tlOf(rec.channel, rec.tlName);
        if (g) {
          CLASS_LIST.forEach((cls) => {
            g.stock[cls] = num(g.stock[cls]) + num(rec.stock[cls]);
            g.cur[cls] = num(g.cur[cls]) + num(rec.cur[cls]);
            g.last[cls] = num(g.last[cls]) + num(rec.last[cls]);
          });
        }
      });
      // Search list (form ke dropdown + lookup ke liye).
      const list = [...byKey.values()].map((r) => ({
        key: `${r.channel}|${norm(r.name)}`, channel: r.channel, name: r.name, agentId: r.agentId, tlName: r.tlName, priority: r.priority
      }));
      state.index = { at: Date.now(), byKey, tls, list, cur: ymNow(), last: ymLast() };
      return state.index;
    }).catch((err) => {
      console.warn('tagRequest index:', err && err.message);
      state.index = { at: Date.now(), byKey: new Map(), tls: new Map(), list: [], cur: ymNow(), last: ymLast(), error: err };
      return state.index;
    }).finally(() => { state.indexPromise = null; });
    return state.indexPromise;
  }
  /** Form row ke liye agent record dhoondo — ID (digits), exact naam ya partial naam se. */
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
  const coverOf = (avg, stock) => (avg > 0 ? stock / avg : null);
  /** Channel ka sahi run-rate divisor: FF = T−1 (aaj ka data kal aata hai), GV = live aaj. */
  const basisDays = (channel) => {
    try {
      const b = U.channelBasis && U.channelBasis(channel === 'gv' ? 'gv' : 'ff');
      return Number(b && b.days) > 0 ? Number(b.days) : U.runRateDays();
    } catch { return U.runRateDays(); }
  };
  const perDay = (issued, channel) => num(issued) / basisDays(channel);
  const priorityFor = (cover, fallback) => {
    // Sheet me priority emoji ke saath aati hai ("🟢 Low", "🟡 Medium"…) — clean label banao,
    // warna badge/notification me emoji double ho jaate hain aur CSV me bhi gandagi aati hai.
    const raw = String(fallback || '').replace(/[^\p{L}]+/gu, ' ').trim();
    const hit = /high|medium|low/i.exec(raw);
    if (hit) return hit[0][0].toUpperCase() + hit[0].slice(1).toLowerCase();
    if (cover == null) return 'Low';
    return cover < 7 ? 'High' : cover < 15 ? 'Medium' : 'Low';
  };
  const toneFor = (p) => (/high/i.test(p) ? 'red' : /medium/i.test(p) ? 'amber' : 'green');
  const growthOf = (cur, last) => (last > 0 ? ((cur - last) / last) * 100 : (cur > 0 ? 100 : 0));
  const growthCell = (g) => `<span class="delta ${g > 0 ? 'up' : g < 0 ? 'down' : ''}">${g > 0 ? '▲ +' : g < 0 ? '▼ ' : ''}${fmt(g, 1)}%</span>`;
  /** TL-wise phir agent-wise sort — TL naam ho to TL ke anusar group dikhe, warna agent-wise. */
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

  // ---- 🔍 system check → result ---------------------------------------------------------------
  /**
   * Form rows ko resolve karke class-wise requirement nikaalo.
   * `useSuggestion` = blank qty par system suggestion (preview/assistant path ka purana behaviour);
   * UI form me blank/0 = us class ki request nahi.
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
        const cur = num(rec.cur[c]), last = num(rec.last[c]), stock = num(rec.stock[c]);
        // FF ka run-rate T−1 basis par, GV ka live basis par (warna GV suggestion kam aata hai).
        const avg = perDay(cur, rec.channel);
        const pair = U.suggestPair(avg, stock);
        const cover = coverOf(avg, stock);
        const priority = priorityFor(cover, rec.priority);
        const growth = growthOf(cur, last);
        const asked = String(qty[c] === undefined ? '' : qty[c]).trim();
        const approved = asked !== '' && Number.isFinite(Number(asked)) ? Math.max(0, Math.round(Number(asked))) : (useSuggestion ? pair.net : 0);
        out.push({
          id: rid(), agentKey: `${rec.channel}|${norm(rec.name)}`, agentId: rec.agentId, agentName: rec.name,
          tl: rec.tlName || '—', channel: rec.channel, cls: c, last, cur, stock, avg, cover, growth, priority,
          sugNet: pair.net, sugGross: pair.gross, approved, remark: '', days: pair.days
        });
        const tlKey = `${rec.channel}|${norm(rec.tlName)}`;
        if (rec.tlName && FF.config.isRealTl(rec.tlName)) {
          const g = tlMap.get(tlKey) || (state.index && state.index.tls.get(tlKey)) || { name: rec.tlName, channel: rec.channel, stock: {}, cur: {}, last: {}, priority: '', agents: new Set() };
          const tl = tlMap.get(tlKey) || { name: g.name, channel: g.channel, stock: { ...(g.stock || {}) }, cur: { ...(g.cur || {}) }, last: { ...(g.last || {}) }, priority: g.priority || '', agents: new Set(g.agents || []), reqNet: 0, reqGross: 0, reqApproved: 0, reqAgents: new Set() };
          tl.reqNet += pair.net; tl.reqGross += pair.gross; tl.reqApproved += approved;
          tl.reqAgents.add(rec.name);
          tlMap.set(tlKey, tl);
        }
      }
    }
    // TL priority — TL ke poore stock/issuance se (jab sheet me priority na ho).
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

  // ---- 📤 share / export helpers ---------------------------------------------------------------
  function resultText(res, forWhatsApp) {
    const r = res || state.result;
    if (!r) return '';
    const head = `*🏷️ IDFC Agents Tag Request*${forWhatsApp ? '' : ' — ' + new Date().toLocaleString('en-IN')}`;
    const lines = r.rows.map((x) => `${x.agentName}${x.agentId ? ` (${x.agentId})` : ''} · ${x.cls} · TL ${x.tl} · ${x.channel === 'gv' ? 'GV' : 'FF'} · stock ${x.stock} · ${U.labelYM(ymLast())} ${x.last} / ${U.labelYM(ymNow())} ${x.cur} · ${x.priority} · 🎯 ${x.approved}${x.remark ? ` (${x.remark})` : ''}`);
    const tot = r.rows.reduce((s, x) => s + num(x.approved), 0);
    const tls = r.tls.length ? `\n\n*TL rollup:*\n${r.tls.map((t) => `${t.name} (${t.channel === 'gv' ? 'GV' : 'FF'}) · stock VC4 ${num(t.stock.VC4)} · ${U.labelYM(ymNow())} VC4 ${num(t.cur.VC4)} · ${t.priority} · 🎯 ${t.reqApproved} (${t.reqAgentCount} agents)`).join('\n')}` : '';
    return `${head}\n${lines.join('\n')}${tls}\n\n*Total request: ${tot} tags*${r.note ? `\nNote: ${r.note}` : ''}`;
  }
  function exportRows(res) {
    const r = res || state.result;
    return (r ? r.rows : []).map((x) => [
      x.agentId || '', x.agentName, x.tl, x.channel === 'gv' ? 'GV Partner' : 'First Forward', x.cls,
      x.last, x.cur, Number(x.growth.toFixed(1)), x.stock, x.cover == null ? '' : Number(x.cover.toFixed(1)),
      x.priority, x.sugNet, x.sugGross, x.approved, x.remark || ''
    ]);
  }
  const EXPORT_HEAD = ['Agent ID', 'Agent', 'TL', 'Channel', 'Tag Class', `Last month (${'__LM__'})`, 'Current month (MTD)', 'Growth %', 'Stock', 'Cover (days)', 'Priority', `Suggested · stock − (${'__D__'}d)`, 'Suggested · w/o stock', 'Approved qty', 'Remark'];
  function exportHeader() {
    return EXPORT_HEAD.map((h) => h.replace('__LM__', U.labelYM(ymLast())).replace('__D__', String(U.suggestDays())));
  }
  /** Kisi bhi saved request ko CSV/Excel/Share text me badlo (admin drawer se bhi). */
  function requestRowArray(r) {
    return (r && r.rows ? r.rows : []).map((x) => [
      x.agentId || '', x.agentName || '', x.tl || '', x.channel === 'gv' ? 'GV Partner' : 'First Forward', x.cls || '',
      num(x.last), num(x.cur), x.growth === undefined || x.growth === null ? '' : Number(x.growth),
      num(x.stock), x.cover === undefined || x.cover === null ? '' : Number(x.cover),
      x.priority || '', num(x.sugNet), num(x.sugGross), num(x.approved), x.remark || ''
    ]);
  }
  function requestText(r) {
    if (!r) return '';
    const rows = (r.rows || []).map((x) => `${x.agentName}${x.agentId ? ` (${x.agentId})` : ''} · ${x.cls} · ${x.channel === 'gv' ? 'GV' : 'FF'} · stock ${num(x.stock)} · ${num(x.last)}/${num(x.cur)} · ${x.priority || ''} · 🎯 ${num(x.approved)}${x.remark ? ` (${x.remark})` : ''}`);
    const tot = (r.rows || []).reduce((s, x) => s + num(x.approved), 0);
    return `*🏷️ IDFC Agents Tag Request* (${statusOf(r).label})\n${esc(r.byName || r.by)} · ${new Date(r.at).toLocaleString('en-IN')}${r.note ? `\nNote: ${r.note}` : ''}\n\n${rows.join('\n')}\n\n*Total: ${tot} tags*`;
  }
  function downloadRequest(r, kind) {
    if (!r) return;
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const header = exportHeader();
    const rows = requestRowArray(r);
    const tls = (r.tls || []).map((t) => ['TL', t.name, '', t.channel === 'gv' ? 'GV Partner' : 'First Forward', '', num(t.lastVc4), num(t.curVc4), '', num(t.stockVc4), t.cover === undefined || t.cover === null ? '' : Number(t.cover), t.priority || '', num(t.sugNet), num(t.sugGross), num(t.reqApproved), `${num(t.agents)} agents`]);
    const stamp = `${r.id || ''}`.slice(-8);
    if (kind === 'xlsx' && FF.xlsx) {
      FF.xlsx.download(`tag-request-${stamp}.xlsx`, [{ name: 'Tag Request', header, rows: rows.concat([[], ['TL ROLLUP'], ...tls]) }]);
      U.toast('Excel downloaded ✓');
      return;
    }
    U.downloadCsv(`tag-request-${stamp}.csv`, header, rows.concat([[], ['TL ROLLUP'], ...tls]));
    U.toast('CSV downloaded ✓');
  }
  function download(kind) {
    if (!state.result) return;
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const header = exportHeader();
    const rows = exportRows();
    const tls = state.result.tls.map((t) => ['TL', t.name, '', t.channel === 'gv' ? 'GV Partner' : 'First Forward', '', num(t.last.VC4), num(t.cur.VC4), '', num(t.stock.VC4), t.cover == null ? '' : Number(t.cover.toFixed(1)), t.priority, '', '', t.reqApproved, `${t.reqAgentCount} requested agents`]);
    if (kind === 'xlsx' && FF.xlsx) {
      FF.xlsx.download(`tag-request-${U.stamp()}.xlsx`, [{ name: 'Tag Request', header, rows: rows.concat([[], ['TL ROLLUP'], ...tls]) }]);
      U.toast('Excel downloaded ✓');
      return;
    }
    U.downloadCsv(`tag-request-${U.stamp()}.csv`, header, rows.concat([[], ['TL ROLLUP'], ...tls]));
    U.toast('CSV downloaded ✓');
  }
  /** Submit payload — dono raaston (login / public) ke liye ek hi shape. */
  function submitPayload() {
    return {
      note: state.note,
      rows: state.result.rows.map((x) => ({
        agentId: x.agentId, agentName: x.agentName, tl: x.tl, channel: x.channel, cls: x.cls,
        last: x.last, cur: x.cur, stock: x.stock, cover: x.cover == null ? null : Number(x.cover.toFixed(1)),
        priority: x.priority, growth: Number(x.growth.toFixed(1)), sugNet: x.sugNet, sugGross: x.sugGross,
        approved: num(x.approved), remark: x.remark || ''
      })),
      tls: state.result.tls.map((t) => ({
        name: t.name, channel: t.channel, stockVc4: num(t.stock.VC4), curVc4: num(t.cur.VC4), lastVc4: num(t.last.VC4),
        priority: t.priority, reqApproved: num(t.reqApproved), agents: t.reqAgentCount,
        sugNet: num(t.reqNet), sugGross: num(t.reqGross), cover: t.cover == null ? null : Number(t.cover.toFixed(1))
      }))
    };
  }
  /** Public form ka actual POST — duplicate confirm ke baad ya seedha. */
  function submitPublic() {
    saveEmployee();
    publicApi('/api/public/tag-request', 'POST', { employee: state.employee, ...submitPayload() }).then((out) => {
      state.done = (out && out.request) || { id: '—', total: 0, rows: 0 };
      state.done.warnings = (out && out.warnings) || [];
      state.view = 'done';
      state.result = null; state.rows = [newRow()];
      state.dup = { list: [], force: false, busy: false };
      U.toast('📤 Request bhej di gayi — ID sambhal ke rakho', 'ok');
      renderRoot();
    }).catch((err) => {
      U.toast('Request nahi gayi: ' + ((err && err.message) || ''), 'err');
    }).finally(() => { state.busy = ''; state.dup.busy = false; });
  }
  /** 🔁 Submit se pehle purani active request check — mili to warning card dikhta hai (force ke bina submit nahi). */
  function checkDupesThenSubmit() {
    if (state.dup.busy) return;
    state.dup.busy = true;
    const btn = U.$('[data-tr-act="send"]');
    if (btn) { btn.disabled = true; btn.textContent = '🔁 Purani request check ho rahi hai…'; }
    publicApi('/api/public/tag-request/check', 'POST', { employee: state.employee, rows: submitPayload().rows })
      .then((out) => {
        const list = (out && out.duplicates) || [];
        state.dup.busy = false;
        if (!list.length) { state.dup.list = []; state.busy = 'send'; return submitPublic(); }
        state.dup.list = list;
        state.busy = '';
        U.toast('🔁 Aapke naam se pehle se ek request active hai — ek baar dekh lo', 'warn');
        renderRoot();
        const card = rootEl.querySelector('#tr-dup-card');
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(() => { state.dup.busy = false; state.busy = 'send'; submitPublic(); }); // check fail ho to submit na ruke
  }
  function submit() {
    if (!state.result) { U.toast('Pehle 🔍 system check chalao', 'warn'); return; }
    if (!isPublic() && !FF.auth.can('tagRequest')) { U.toast('Is page ka access nahi hai', 'err'); return; }
    if (!state.result.rows.length) { U.toast('Koi row nahi — agent + class chuno', 'warn'); return; }
    // 🌐 Public form: employee name mandatory (upar wala card).
    if (isPublic() && !employeeOk()) {
      U.toast('👤 Employee name likhna zaroori hai', 'err');
      const card = rootEl.querySelector('#tr-employee-card');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const inp = rootEl.querySelector('[data-tr-emp="name"]');
      if (inp && inp.focus) inp.focus();
      return;
    }
    const total = state.result.rows.reduce((s, x) => s + num(x.approved), 0);
    if (!total) { U.toast('Approved qty 0 hai — kuch qty daalo', 'warn'); return; }
    if (isPublic()) {
      // 🔁 Pehli baar: duplicate check → warning; "Phir bhi bhejo" ke baad hi POST.
      if (state.dup.force) { state.dup.force = false; state.busy = 'send'; return submitPublic(); }
      return checkDupesThenSubmit();
    }
    state.busy = 'send';
    const btn = U.$('[data-tr-act="send"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Bhej rahe hain…'; }
    FF.auth.api('/api/tag-requests', 'POST', submitPayload()).then((out) => {
      U.toast(out && out.ok ? '📤 Tag request admin ko chali gayi — status wahin dikhega' : 'Request save ho gayi', 'ok');
      state.requestsAt = 0;
      state.view = 'requests';
      renderRoot();
    }).catch((err) => U.toast('Request nahi gayi: ' + ((err && err.message) || ''), 'err'))
      .finally(() => { state.busy = ''; });
  }

  // ---- 🌐 public: done + status views ------------------------------------------------------------
  /** 🔁 Duplicate warning card — result view me, submit button ke upar. */
  function dupWarningHtml() {
    const list = (isPublic() && state.dup && state.dup.list) || [];
    if (!list.length) return '';
    const rows = list.map((d) => {
      const v = STATUS[d.status] || STATUS.pending;
      const same = (d.matched || []).slice(0, 4).join(', ');
      return `<li><b class="mono">${esc(d.id)}</b> <span class="badge ${v.tone}">${v.label}</span>
        <small class="dim"> · ${fmt(d.total)} tags · ${fmt(d.rows)} rows · ${esc(U.timeLabel(new Date(d.at).getTime()))}${same ? ` · same: ${esc(same)}${(d.matched || []).length > 4 ? '…' : ''}` : ''}</small></li>`;
    }).join('');
    return `<section class="card tr-dup-warn" id="tr-dup-card"><div class="card-body">
      <h3 style="margin:0 0 6px">🔁 Ye entry pehle se hai</h3>
      <p style="margin:0 0 8px">Aapke naam <b>${esc(state.employee.name || '')}</b> se <b>${fmt(list.length)} request already active</b> hai aur usme wahi agent × class mila hai. Status dekh lo — dobara bhejne ki zaroorat nahi. Phir bhi nayi request chahiye to <b>"🔁 Phir bhi bhejo"</b> dabao.</p>
      <ul class="tr-dup-list">${rows}</ul>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn primary" data-tr-act="dup-status" data-id="${esc(list[0].id || '')}">🔎 Status dekho</button>
        <button class="btn" data-tr-act="dup-force">🔁 Phir bhi bhejo</button>
        <button class="btn" data-tr-act="dup-edit">✏️ Form me wapas</button>
      </div></div></section>`;
  }
  function renderDone() {
    const d = state.done || {};
    const body = rootEl.querySelector('#tr-body');
    body.innerHTML = `<section class="card tr-done"><div class="card-body">
      <div class="tr-done-icon">✅</div>
      <h2 style="margin:6px 0">Request bhej di gayi!</h2>
      <p class="dim" style="margin:0 0 12px">${esc(state.employee.name || '')} — aapki request (${fmt(d.rows || 0)} rows · ${fmt(d.total || 0)} tags) admin ke paas pahunch gayi hai. Neeche wala <b>Request ID</b> sambhal ke rakho — isse kabhi bhi status check kar sakte ho.</p>
      <div class="tr-done-id"><span class="dim small">Request ID</span><b id="tr-done-id">${esc(d.id || '—')}</b>
        <button class="btn small" data-tr-act="copy-id">📋 Copy</button></div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn primary" data-tr-act="again">➕ Naya request banao</button>
        <button class="btn" data-tr-act="check-status" data-id="${esc(d.id || '')}">🔎 Status dekho</button>
      </div>
      ${(() => {
        const dup = ((state.done && state.done.warnings) || []).find((x) => x && x.code === 'duplicate');
        return dup ? `<div class="notice amber" style="margin-top:10px">🔁 Note: aapke naam se pehle se <b>${fmt(dup.count || 0)}</b> active request thi (${esc((dup.requests || []).map((r) => r.id).slice(0, 3).join(', '))}) — admin ko ye bhi dikhaya gaya hai, taaki duplicate na maane jaayein.</div>` : '';
      })()}
      <p class="dim small" style="margin-top:10px">Status ke 4 stage: ⏳ Pending → ✅ Approved → 🚚 Dispatched (ya ⛔ Rejected). Admin status badalte hi aapko yahin pata chal jaayega.</p>
    </div></section>`;
    const act = (name, fn) => { const b = rootEl.querySelector(`[data-tr-act="${name}"]`); if (b) b.addEventListener('click', fn); };
    act('copy-id', () => U.copyText(String(d.id || '')).then((ok) => U.toast(ok ? '📋 Request ID copy ho gayi' : 'Copy nahi hua', ok ? 'ok' : 'warn')));
    act('again', () => { state.done = null; state.view = 'form'; state.result = null; renderRoot(); });
    act('check-status', () => { state.status = null; state.statusId = String(d.id || ''); state.view = 'status'; renderRoot(); });
  }
  function renderStatus() {
    const body = rootEl.querySelector('#tr-body');
    const s = state.status;
    const v = STATUS[s && s.status] || STATUS.pending;
    body.innerHTML = `<section class="card"><div class="card-head"><h3>🔎 Request status</h3>
        <div class="card-right dim">Submit ke baad mila Request ID yahan daalo</div></div>
      <div class="card-body">
        <div class="tr-status-row">
          <input class="input" id="tr-status-id" placeholder="e.g. tagreq_m2k9x_ab12cd34" value="${esc(state.statusId || '')}">
          <button class="btn primary" data-tr-act="find">🔎 Status dekho</button>
        </div>
        ${s ? `<div class="tr-status-out">
          <div class="tr-status-line"><span class="badge ${v.tone}">${v.label}</span>
            <b>${fmt(s.total || 0)} tags</b> · ${fmt(s.rows || 0)} rows · ${fmt(s.agents || 0)} agents</div>
          <div class="dim small">👤 ${esc(s.byName || '')} · bheji gayi ${esc(U.timeLabel(new Date(s.at).getTime()))}${s.sheetSynced ? ' · 📗 Google Sheet me entry ho gayi' : ''}</div>
          ${s.adminNote ? `<div class="notice green" style="margin-top:8px">Admin note: ${esc(s.adminNote)}</div>` : ''}
          ${/pending/i.test(s.status || '') ? '<p class="dim small" style="margin:8px 0 0">Abhi admin review kar raha hai — status badalte hi yahan naya stage dikhega.</p>' : ''}
        </div>` : ''}
      </div></section>`;
    const find = () => {
      const inp = rootEl.querySelector('#tr-status-id');
      const id = String((inp && inp.value) || '').trim();
      if (!id) { U.toast('Request ID daalo', 'warn'); return; }
      state.statusId = id;
      publicApi(`/api/public/tag-request/status?id=${encodeURIComponent(id)}`).then((out) => {
        state.status = out.request || null; renderStatus();
      }).catch((err) => { state.status = null; U.toast((err && err.message) || 'Status nahi mila', 'err'); renderStatus(); });
    };
    const act = (name, fn) => { const b = rootEl.querySelector(`[data-tr-act="${name}"]`); if (b) b.addEventListener('click', fn); };
    act('find', find);
    const inp = rootEl.querySelector('#tr-status-id');
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });
  }

  // ---- 🖼️ views ---------------------------------------------------------------------------------
  let rootEl = null;
  function renderRoot() {
    if (!rootEl) return;
    if (isPublic()) {
      if (state.view === 'done' && state.done) return renderDone();
      if (state.view === 'status') return renderStatus();
      if (state.view === 'result' && state.result) return renderResult();
      return renderForm();
    }
    if (state.view === 'requests') renderRequests();
    else if (state.view === 'result' && state.result) renderResult();
    else renderForm();
  }
  const tabsHtml = () => {
    const tab = (id, label) => `<button class="seg-btn ${state.view === id ? 'on' : ''}" data-tr-view="${id}">${label}</button>`;
    if (isPublic()) return `<div class="seg" id="tr-tabs">${tab('form', '📝 Form')}${tab('result', '📊 Result')}${tab('status', '🔎 Status')}</div>`;
    return `<div class="seg" id="tr-tabs">${tab('form', '📝 Form')}${tab('result', '📊 Result')}${tab('requests', isAdmin() ? '📥 Tag Requests (admin)' : '📥 Meri requests')}</div>`;
  };
  function headHtml() {
    if (isPublic()) {
      const cfg = state.publicCfg || {};
      const brand = cfg.brand || 'First Forward';
      const logo = cfg.logo ? `<img class="tr-public-logo" src="${esc(cfg.logo)}" alt="${esc(brand)}">` : `<span class="tr-public-logo mono">${esc(String(brand).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span>`;
      return `<div class="page-head tr-public-head"><div>
          <div class="tr-public-brand">${logo}<div><b>${esc(brand)}</b><small class="dim">${esc(cfg.tagline || 'Dashboard')}</small></div></div>
          <h1>🏷️ ${esc(cfg.title || 'IDFC Agents Tag Request')}</h1>
          <p class="sub">${esc(cfg.intro || 'Employee form — login ki zaroorat nahi. Upar apna naam likho, agent chuno, class-wise qty daalo aur submit kar do. Admin ko request turant mil jaayegi.')}</p>
        </div>
        <div class="head-actions">${tabsHtml()}<button class="btn" data-tr-act="reload">↻ Data refresh</button></div></div>`;
    }
    return `<div class="page-head"><div><h1>🏷️ Tag Request</h1><p class="sub">IDFC Agents Tag Request — naam search karo (agents + TL dropdown) → class-wise qty bharo (VC4/VC5/VC6/VC7/VC12/VC16, 0 bhi chalega) → 🔍 system check → 📤 admin ko submit. Ek saath kai agents ki request lagti hai.</p></div>
      <div class="head-actions">${tabsHtml()}<button class="btn" data-tr-act="share" title="Employees ko bhejne wala form link copy karo (bina login khulta hai)">🔗 Employee link</button><button class="btn" data-tr-act="reload">↻ Data refresh</button></div></div>`;
  }
  function bindCommon(body) {
    body.querySelectorAll('[data-tr-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.trView; renderRoot(); }));
    const reload = body.querySelector('[data-tr-act="reload"]');
    if (reload) reload.addEventListener('click', () => { buildIndex(true).then(() => U.toast('Taaza data se index ban gaya', 'ok')); });
    const share = body.querySelector('[data-tr-act="share"]');
    if (share) share.addEventListener('click', () => {
      const link = shareLink();
      const msg = `🏷️ Tag Request form — yahan se tag request lagao (naam likho, bas):\n${link}`;
      const done = () => {
        U.toast('🔗 Link copy ho gaya — employees ko WhatsApp / message me bhej do', 'ok');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).catch(() => {});
      };
      if (FF.app && FF.app.openDrawer) {
        FF.app.openDrawer({
          kicker: '🔗 Employee link', title: 'Tag Request form link (bina login)',
          sub: 'Ye link employees ko bhejo — kholte hi form khul jayega. Login/signup ki zaroorat NAHI, bas apna naam likhna hai.',
          body: `<div class="kd-sec">
            <label class="field" style="display:block"><span class="dim small">Link (copy karke bhejo)</span>
              <input class="input" id="tr-share-link" readonly style="width:100%" value="${esc(link)}"></label>
            <p class="dim small">✅ Koi account nahi chahiye — employee <b>naam</b> likhkar, agent + class qty daal kar submit karta hai. Request aapke <b>🏷️ Tag Request → 📥 Tag Requests</b> me "employee link" badge ke saath aati hai (WhatsApp/notification ke saath).<br>
            📗 Google Sheet sync ON ho to us sheet me bhi entry auto hoti hai. Form band karna ho ya mobile/branch field badalna ho → Tag Request page ke admin card / <a href="#/tagRequest?view=requests">📥 Tag Requests</a> tab se.</p>
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
      U.copyText(link).then(done).catch(done);
    });
  }

  // ---- 📝 form ------------------------------------------------------------------------------------
  /** Search dropdown ke liye items — AGENTS + TL dono, query se match karke. */
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
    const tls = row.tlFilter ? [] : [...idx.tls.values()].filter((t) => !q || norm(t.name).includes(q)).slice(0, 8)
      .map((t) => ({ kind: 'tl', name: t.name, channel: t.channel, agents: t.agents ? t.agents.size : 0 }));
    return [...agents, ...tls];
  }
  function suggestHtml(items, row) {
    if (!items.length) return `<div class="tr-suggest-empty">${state.index ? 'Koi match nahi mila — ID/naam check karo' : 'Agent list load ho rahi hai…'}</div>`;
    return items.map((it, i) => it.kind === 'tl'
      ? `<button type="button" class="tr-suggest-item tl ${i === 0 ? 'hot' : ''}" data-tr-pick="tl:${esc(norm(it.channel) + '|' + norm(it.name))}"><span class="tr-suggest-name">🧑‍💼 ${esc(it.name)}</span><small class="dim">TL · ${esc(it.agents)} agents · ${it.channel === 'gv' ? 'GV' : 'FF'} — is TL ke agents dekho</small></button>`
      : `<button type="button" class="tr-suggest-item ${i === 0 ? 'hot' : ''}" data-tr-pick="agent:${esc(it.channel)}:${esc(it.agentId || '')}:${esc(norm(it.name))}"><span class="tr-suggest-name">${esc(it.name)}${it.agentId ? ` <small class="dim">#${esc(it.agentId)}</small>` : ''}</span><small class="dim">${it.tlName ? `TL ${esc(it.tlName)} · ` : ''}${it.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</small></button>`).join('');
  }
  function rowHtml(row, i) {
    const rec = findAgent(row.name || row.agentId, row.channel);
    const auto = rec
      ? `<span class="badge green">${rec.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span> <b>${esc(rec.name)}</b>${rec.agentId ? ` · ID <b>${esc(rec.agentId)}</b>` : ''}${rec.tlName ? ` · TL <b>${esc(rec.tlName)}</b>` : ''}`
      : (row.name || row.agentId ? '<span class="badge amber">data me nahi mila</span> <span class="dim small">ID/naam sheet se match nahi hua — dropdown se chuno</span>'
        : (state.index ? '<span class="dim small">Naam likhna shuru karo — agents + TL dropdown me aayenge; chunte hi ID + TL bhar jayega</span>' : '<span class="dim small">agent list load ho rahi hai…</span>'));
    const inputs = CLASS_LIST.map((c) => `<label class="tr-cls-cell" title="${esc(CLASS_LABEL[c])} — kitni tags chahiye (0 ya khaali = nahi chahiye)">
        <span>${c}</span>
        <input class="input tr-qty" data-tr-cls="${c}" inputmode="numeric" placeholder="0" value="${esc(row.q[c])}">
      </label>`).join('');
    return `<div class="tr-row-card" data-tr-row="${row.id}">
      <div class="tr-row-top">
        <span class="num dim tr-row-num">${i + 1}</span>
        <div class="tr-search-wrap">
          <input class="input tr-agent" data-tr-field="agent" value="${esc(rec ? rec.name : (row.name || row.agentId))}" placeholder="Agent ID / Naam search karo…" autocomplete="off">
          <div class="tr-suggest" data-tr-suggest hidden></div>
        </div>
        <button class="btn small" data-tr-del="${row.id}" title="Row hatao">✕</button>
      </div>
      <div class="tr-row-meta">${auto}${row.tlFilter ? ` <button type="button" class="chip on tr-filter-clear" title="TL filter hatao">TL: ${esc(row.tlFilter)} ✕</button>` : ''}</div>
      <div class="tr-classes">${inputs}</div>
    </div>`;
  }
  function renderForm() {
    const body = rootEl.querySelector('#tr-body');
    const total = state.rows.reduce((s, r) => s + CLASS_LIST.reduce((a, c) => a + (num(r.q[c]) || 0), 0), 0);
    body.innerHTML = `
      ${isPublic() ? employeeCardHtml() : ''}
      ${state.problems.length ? `<div class="card"><div class="card-body"><b>⚠️ Pichhle check me dikkat:</b><ul>${state.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div></div>` : ''}
      <section class="card"><div class="card-head"><h3>📝 IDFC Agents Tag Request Form <span class="count">${fmt(state.rows.length)} agents</span></h3>
        <div class="card-right dim">Class ke aage qty likho (0 bhi chalega) · total <b>${fmt(total)}</b> tags</div></div>
        <div class="card-body">
          <div class="tr-rows">${state.rows.map(rowHtml).join('')}</div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn" data-tr-act="add">➕ Ek aur agent</button>
            <button class="btn" data-tr-act="clear">🧹 Clear</button>
            <button class="btn primary" data-tr-act="check">${isPublic() && state.publicCfg && state.publicCfg.showCheck === false ? '➡️ Aage badho (qty check)' : '🔍 System check karo → Result'}</button>
          </div>
          <label class="field" style="display:block;margin-top:12px"><span class="dim small">Note (optional — admin ke liye)</span>
            <input class="input" data-tr-field="note" value="${esc(state.note)}" placeholder="e.g. urgent — kal dispatch chahiye" style="width:100%"></label>
        </div></section>
      <p class="dim small">🔎 System check: har agent × class ke liye sheet se <b>last month</b> + <b>current month (MTD)</b> issuance, <b>stock</b>, <b>cover days</b>, <b>growth</b> aur <b>priority</b> nikaalta hai — result me sab dikhta hai aur approved qty edit ho sakti hai. Submit par rows admin ke paas <b>TL-wise</b> (TL naam ho to) ya <b>agent-wise</b> grouped jaati hain.</p>`;
    rootEl.querySelectorAll('.tr-row-card').forEach(bindFormRow);
    bindFormGlobal();
  }
  /** Ek row-card ki bindings (search dropdown + qty inputs). Partial re-render par sirf naya card
   *  bind hota hai — purane cards ke listeners duplicate nahi hote. */
  function bindFormRow(card) {
    // ---- agent search + dropdown --------------------------------------------------------------
    const inp = card.querySelector('.tr-agent');
    if (inp) {
      const row = state.rows.find((r) => r.id === card.dataset.trRow);
      const box = card.querySelector('[data-tr-suggest]');
      let hot = 0;
      const close = () => { if (box) box.hidden = true; };
      const show = () => {
        if (!box || !row) return;
        const items = suggestItems(inp.value, row);
        box.innerHTML = suggestHtml(items, row);
        box.hidden = false;
        hot = 0;
        box.querySelectorAll('[data-tr-pick]').forEach((b, i) => {
          b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(b.dataset.trPick); });
          b.addEventListener('mouseenter', () => { hot = i; markHot(); });
        });
      };
      const markHot = () => { const els = box.querySelectorAll('.tr-suggest-item'); els.forEach((el, i) => el.classList.toggle('hot', i === hot)); };
      const pick = (val) => {
        if (!row) return;
        if (val.startsWith('tl:')) {
          const [ch, name] = val.slice(3).split('|');
          row.tlFilter = name.replace(/\s+/g, ' ').trim();
          row.agentId = ''; row.name = ''; row.channel = ch === 'gv' ? 'gv' : 'ff';
          inp.value = '';
          renderForm();
          const again = rootEl.querySelector(`[data-tr-row="${row.id}"] .tr-agent`);
          if (again) again.focus();
          U.toast(`🧑‍💼 TL ${row.tlFilter} ke agents list me hain — agent chuno`, 'info');
          return;
        }
        const [, channel, , nameKey] = val.split(':');
        const idx = state.index;
        const rec = idx && idx.byKey.get(`${channel}|${nameKey}`);
        if (rec) {
          row.agentId = rec.agentId || ''; row.name = rec.name; row.tl = rec.tlName; row.channel = rec.channel; row.tlFilter = '';
          inp.value = rec.name;
        }
        close();
        // Sirf isi row ka meta/badge turant refresh (poora form re-render → focus na toote).
        const fresh = rowHtml(row, state.rows.indexOf(row));
        const wrap = document.createElement('div'); wrap.innerHTML = fresh;
        card.replaceWith(wrap.firstElementChild);
        bindFormRow(wrap.firstElementChild);
        const next = rootEl.querySelector(`[data-tr-row="${row.id}"] .tr-agent`);
        if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
      };
      inp.addEventListener('input', () => {
        if (!row) return;
        // Live typing — naam raw rakho; 4+ digit likha to ID lookup turant try karo.
        row.name = inp.value.trim();
        const d = digits(inp.value);
        if (d.length >= 4 && !/[a-z]/i.test(inp.value)) {
          const hit = findAgent(inp.value, row.channel);
          if (hit) row.agentId = hit.agentId;
        }
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
    // ---- class qty inputs (typing par re-render nahi — fast + focus safe) ------------------------
    card.querySelectorAll('.tr-qty').forEach((qinp) => qinp.addEventListener('input', () => {
      const row = state.rows.find((r) => r.id === card.dataset.trRow);
      if (!row) return;
      const clean = qinp.value.replace(/[^\d]/g, '');
      if (clean !== qinp.value) qinp.value = clean;
      row.q[qinp.dataset.trCls] = clean;
      const total = state.rows.reduce((s, r) => s + CLASS_LIST.reduce((a, c) => a + (num(r.q[c]) || 0), 0), 0);
      const head = rootEl.querySelector('.card-right.dim b');
      if (head) head.textContent = fmt(total);
    }));
    // ---- TL filter clear + row delete -------------------------------------------------------------
    card.querySelectorAll('.tr-filter-clear').forEach((b) => b.addEventListener('click', () => {
      const row = state.rows.find((r) => r.id === card.dataset.trRow);
      if (row) { row.tlFilter = ''; renderForm(); }
    }));
    card.querySelectorAll('[data-tr-del]').forEach((b) => b.addEventListener('click', () => {
      state.rows = state.rows.filter((r) => r.id !== card.dataset.trRow);
      if (!state.rows.length) state.rows = [newRow()];
      renderForm();
    }));
  }
  /** Global form actions — note, add/clear/check. Ek hi baar bind hote hain. */
  function bindFormGlobal() {
    const bodyEl = rootEl;
    const note = bodyEl.querySelector('[data-tr-field="note"]');
    if (note) note.addEventListener('input', () => { state.note = note.value; });
    // 🌐 Public form: employee name/mobile/branch (naam mandatory) — typing par state + localStorage.
    bodyEl.querySelectorAll('[data-tr-emp]').forEach((inp) => inp.addEventListener('input', () => {
      const key = inp.dataset.trEmp;
      state.employee[key] = inp.value;
      if (key === 'mobile') { const clean = inp.value.replace(/[^\d+]/g, ''); if (clean !== inp.value) inp.value = clean; state.employee.mobile = clean; }
      const card = bodyEl.querySelector('#tr-employee-card');
      if (card) card.classList.toggle('tr-employee-todo', !employeeOk());
      saveEmployee();
    }));
    const act = (name, fn) => { const b = bodyEl.querySelector(`[data-tr-act="${name}"]`); if (b) b.addEventListener('click', fn); };
    act('add', () => { state.rows.push(newRow()); renderForm(); const inputs = rootEl.querySelectorAll('.tr-agent'); const last = inputs[inputs.length - 1]; if (last) last.focus(); });
    act('clear', () => { state.rows = [newRow()]; state.note = ''; state.result = null; state.problems = []; renderForm(); });
    act('check', async () => {
      // Naam pehle — warna result bhar kar submit par pata chalega (public form me mandatory).
      if (isPublic() && !employeeOk()) {
        U.toast('👤 Pehle apna naam likho (upar wale card me)', 'warn');
        const inp = bodyEl.querySelector('[data-tr-emp="name"]');
        if (inp && inp.focus) inp.focus();
        return;
      }
      const btn = bodyEl.querySelector('[data-tr-act="check"]');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Data check ho raha hai…'; }
      try { await buildIndex(); } catch { /* index fallback */ }
      const res = analyze(false);
      if (!res) { renderForm(); U.toast('Koi valid row nahi mili — agent chuno aur class me qty daalo (0/khaali = skip)', 'warn'); return; }
      state.view = 'result';
      renderRoot();
      U.toast(`✅ ${res.rows.length} class-rows ka check ho gaya`, 'ok');
    });
  }

  // ---- 📊 result -------------------------------------------------------------------------------
  function renderResult() {
    const res = state.result;
    const body = rootEl.querySelector('#tr-body');
    if (!res) { state.view = 'form'; renderForm(); return; }
    // 🌐 Public form + admin ne "system check dikhao" OFF kiya → stock/issuance/suggestion columns
    // chhupa do (qty edit wala simple table rehta hai).
    const noCheck = isPublic() && state.publicCfg && state.publicCfg.showCheck === false;
    if (rootEl) rootEl.classList.toggle('tr-no-check', !!noCheck);
    const total = res.rows.reduce((s, x) => s + num(x.approved), 0);
    const totalRef = res.rows.reduce((s, x) => s + num(x.sugNet), 0);
    const totalGross = res.rows.reduce((s, x) => s + num(x.sugGross), 0);
    const agents = new Set(res.rows.map((x) => x.agentKey));
    // TL-wise grouping — TL badalte hi separator row.
    let lastTl = null;
    const rowsHtml = res.rows.map((x) => {
      let sep = '';
      if (tlSortKey(x.tl) !== lastTl) {
        lastTl = tlSortKey(x.tl);
        sep = `<tr class="tr-group-row"><td colspan="13">${x.tl === '—' ? '👤 Agent-wise (koi TL nahi)' : `🧑‍💼 TL: ${esc(x.tl)}`}</td></tr>`;
      }
      return `${sep}<tr data-tr-res="${x.id}">
          <td><b>${esc(x.agentName)}</b> <small class="dim">${esc(x.agentId || '')}</small> <span class="badge ${x.channel === 'gv' ? 'green' : ''}">${x.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span></td>
          <td class="tr-check-col">${esc(x.tl)}</td>
          <td><b>${esc(x.cls)}</b></td>
          <td class="num tr-check-col">${fmt(x.last)}</td>
          <td class="num tr-check-col"><b>${fmt(x.cur)}</b> <small class="dim">· ${fmt(x.avg, true)}/din${x.channel === 'gv' ? ' (live)' : ''}</small></td>
          <td class="num tr-check-col">${growthCell(x.growth)}</td>
          <td class="num tr-check-col"><b>${fmt(x.stock)}</b></td>
          <td class="num tr-check-col">${x.cover == null ? '<span class="dim">∞</span>' : `<span class="badge ${x.cover < 7 ? 'red' : x.cover < 15 ? 'amber' : 'green'}">${fmt(x.cover, true)}</span>`}</td>
          <td class="tr-check-col"><span class="badge ${toneFor(x.priority)}">${esc(x.priority)}</span></td>
          <td class="num tr-check-col"><b class="sug-chip">${fmt(x.sugNet)}</b></td>
          <td class="num dim tr-check-col">${fmt(x.sugGross)}</td>
          <td class="num"><input class="input tr-appr" style="width:78px" data-tr-appr="${x.id}" inputmode="numeric" value="${num(x.approved)}"></td>
          <td><input class="input tr-remark" style="width:160px" data-tr-remark="${x.id}" value="${esc(x.remark)}" placeholder="remark"></td>
        </tr>`;
    }).join('');
    body.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi g2"><div class="kpi-top"><span class="kpi-title">📝 Request rows</span></div><div class="kpi-value">${fmt(res.rows.length)}</div><div class="kpi-foot">${fmt(agents.size)} agents · ${fmt(new Set(res.rows.map((x) => x.cls)).size)} classes</div></div>
        <div class="kpi g9 tr-check-col"><div class="kpi-top"><span class="kpi-title">🎯 Suggested (stock −)</span></div><div class="kpi-value">${fmt(totalRef)}</div><div class="kpi-foot">w/o stock ${fmt(totalGross)} · ${res.days} din ka target</div></div>
        <div class="kpi g6"><div class="kpi-top"><span class="kpi-title">✅ Approved (editable)</span></div><div class="kpi-value" id="tr-total">${fmt(total)}</div><div class="kpi-foot">admin ko yahi jayega</div></div>
        <div class="kpi g4 tr-check-col"><div class="kpi-top"><span class="kpi-title">🚦 High priority</span></div><div class="kpi-value">${fmt(res.rows.filter((x) => /high/i.test(x.priority)).length)}</div><div class="kpi-foot">cover &lt; 7 din</div></div>
      </div>
      <section class="card"><div class="card-head"><h3>📊 System check · agent × class</h3>
        <div class="card-right dim">TL-wise grouped · qty / remark badal sakte ho — totals apne aap update hote hain</div></div>
        <div class="table-wrap tall"><table class="tbl"><thead><tr>
          <th>Agent</th><th class="tr-check-col">TL</th><th>Class</th><th class="num tr-check-col">${esc(U.labelYM(ymLast()))}</th><th class="num tr-check-col">${esc(U.labelYM(ymNow()))} MTD</th><th class="num tr-check-col">Growth</th><th class="num tr-check-col">Stock</th><th class="num tr-check-col">Cover</th><th class="tr-check-col">Priority</th>
          <th class="num tr-check-col">🎯 stock −</th><th class="num tr-check-col">🎯 w/o stock</th><th class="num">✅ Approved</th><th>Remark</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table></div>
      </section>
      ${res.tls.length ? `<section class="card tr-check-col"><div class="card-head"><h3>🧑‍💼 TL rollup (TL stock · issuance · priority · suggested)</h3><div class="card-right dim">TL ke poore agents ka stock/issuance + is request ka total</div></div>
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th>TL</th><th>Channel</th><th class="num">Agents</th><th class="num">VC4 stock</th><th class="num">${esc(U.labelYM(ymNow()))} VC4</th><th class="num">Cover</th><th>Priority</th><th class="num">🎯 is request ka total</th></tr></thead>
        <tbody>${res.tls.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td>${t.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</td><td class="num">${fmt(t.agentsCount)}${t.reqAgentCount ? ` <small class="dim">(${fmt(t.reqAgentCount)} requested)</small>` : ''}</td><td class="num"><b>${fmt(t.stock.VC4)}</b></td><td class="num">${fmt(t.cur.VC4)}</td><td class="num">${t.cover == null ? '<span class="dim">∞</span>' : `<span class="badge ${t.cover < 7 ? 'red' : t.cover < 15 ? 'amber' : 'green'}">${fmt(t.cover, true)}</span>`}</td><td><span class="badge ${toneFor(t.priority)}">${esc(t.priority)}</span></td><td class="num"><b>${fmt(t.reqApproved)}</b> <small class="dim">/ sug ${fmt(t.reqNet)}</small></td></tr>`).join('')}</tbody></table></div></section>` : ''}
      ${isPublic() ? dupWarningHtml() : ''}
      ${state.problems.length ? `<section class="card"><div class="card-body"><b>⚠️ Kuch rows skip hui:</b><ul>${state.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div></section>` : ''}
      <section class="card"><div class="card-body">
        ${isPublic() ? `<p class="dim small" style="margin:0 0 8px">👤 Request <b>${esc(state.employee.name || '—')}</b> ke naam se jaayegi${state.employee.mobile ? ` · ${esc(state.employee.mobile)}` : ''}${state.employee.office ? ` · ${esc(state.employee.office)}` : ''}.</p>` : ''}
        <label class="field" style="display:block"><span class="dim small">Note (admin ko dikhega)</span><input class="input" id="tr-res-note" style="width:100%" value="${esc(res.note || state.note)}" placeholder="e.g. urgent"></label>
        <div class="btn-row" style="margin-top:10px">
          ${(isPublic() || FF.auth.can('tagRequest')) ? `<button class="btn primary" data-tr-act="send">${isPublic() ? '📤 Request submit karo' : '📤 Admin ko submit karo'}</button>` : ''}
          ${FF.auth.can('export') ? '<button class="btn" data-tr-act="csv">⬇ CSV</button><button class="btn" data-tr-act="xlsx">⬇ Excel</button>' : ''}
          <button class="btn" data-tr-act="copy">📋 Copy</button>
          ${FF.auth.can('share') ? '<button class="btn" data-tr-act="wa">💬 WhatsApp</button>' : ''}
          <button class="btn" data-tr-act="print">🖨 Print</button>
          <button class="btn" data-tr-act="back">✏️ Form me wapas</button>
        </div>
        <p class="dim small" style="margin-top:8px">🎯 <b>stock −</b> = run-rate × ${res.days} din − stock in hand · <b>w/o stock</b> = run-rate × ${res.days} din (stock ghataye bina) · growth = current MTD vs ${esc(U.labelYM(ymLast()))} · cover = stock ÷ run-rate · din / mode ⚙️ Settings → Features me badal sakte ho.</p>
      </div></section>`;
    const recalc = () => {
      const t = res.rows.reduce((s, x) => s + num(x.approved), 0);
      const el = rootEl.querySelector('#tr-total');
      if (el) el.textContent = fmt(t);
    };
    rootEl.querySelectorAll('[data-tr-appr]').forEach((inp) => inp.addEventListener('input', () => {
      const row = res.rows.find((x) => x.id === inp.dataset.trAppr);
      if (row) { row.approved = Math.max(0, Math.round(Number(inp.value) || 0)); recalc(); }
    }));
    rootEl.querySelectorAll('[data-tr-remark]').forEach((inp) => inp.addEventListener('input', () => {
      const row = res.rows.find((x) => x.id === inp.dataset.trRemark);
      if (row) row.remark = inp.value;
    }));
    const note = rootEl.querySelector('#tr-res-note');
    if (note) note.addEventListener('input', () => { state.note = note.value; res.note = note.value; });
    const act = (name, fn) => { const b = rootEl.querySelector(`[data-tr-act="${name}"]`); if (b) b.addEventListener('click', fn); };
    act('send', submit);
    // 🔁 duplicate warning card ke buttons
    act('dup-force', () => { state.dup.force = true; submit(); });
    act('dup-status', (e) => { state.statusId = String((e && e.currentTarget && e.currentTarget.dataset.id) || ''); state.status = null; state.view = 'status'; renderRoot(); });
    act('dup-edit', () => { state.dup = { list: [], force: false, busy: false }; state.view = 'form'; renderRoot(); });
    const sendBtn = rootEl.querySelector('[data-tr-act="send"]');
    if (sendBtn && isPublic() && (state.dup.list || []).length) { sendBtn.textContent = '🔁 Phir bhi bhejo'; sendBtn.disabled = false; }
    act('csv', () => download('csv'));
    act('xlsx', () => download('xlsx'));
    act('copy', () => U.copyText(resultText()).then((ok) => U.toast(ok ? '📋 Copy ho gaya' : 'Copy nahi hua', ok ? 'ok' : 'warn')));
    act('wa', () => { if (FF.app && FF.app.shareWhatsApp) FF.app.shareWhatsApp(resultText(null, true)); else U.toast('Share available nahi', 'warn'); });
    act('print', () => { try { window.print(); } catch { U.toast('Print support nahi', 'warn'); } });
    act('back', () => { state.view = 'form'; renderRoot(); });
  }

  // ---- 📥 requests (admin / apni) ----------------------------------------------------------------
  function loadRequests(force) {
    if (!force && state.requests.length && Date.now() - state.requestsAt < 30e3) return Promise.resolve(state.requests);
    return FF.auth.api('/api/tag-requests').then((out) => {
      state.requests = Array.isArray(out && out.requests) ? out.requests : [];
      state.requestsAt = Date.now();
      return state.requests;
    }).catch((err) => { console.warn('tag requests:', err && err.message); state.requests = []; return []; });
  }
  const statusOf = (r) => STATUS[r.status] || STATUS.pending;
  function renderRequests() {
    const body = rootEl.querySelector('#tr-body');
    body.innerHTML = U.spinner('Requests load ho rahi hain…');
    loadRequests(true).then(() => {
      if (state.view !== 'requests') return;
      if (!state.requests.length) {
        body.innerHTML = '<section class="card"><div class="card-body empty">Abhi koi tag request nahi hai. 📝 Form bharo → 🔍 system check → 📤 submit.<br><small class="dim">Employee link se aayi requests bhi yahin dikhengi (🌐 badge ke saath).</small></div></section>';
        if (isAdmin()) body.insertAdjacentHTML('beforeend', publicCardHtml() + sheetCardHtml());
        bindPublicCard(); bindSheetCard();
        return;
      }
      body.innerHTML = `<section class="card"><div class="card-head"><h3>📥 Tag Requests <span class="count">${fmt(state.requests.length)}</span></h3>
        <div class="card-right dim">${isAdmin() ? 'Admin: qty edit karo, status set karo — sab yahin se' : 'Aapki bheji hui requests aur unka status'}</div></div>
        <div class="table-wrap tall"><table class="tbl"><thead><tr><th>Kab</th><th>Kisne</th><th class="num">Rows</th><th class="num">Agents</th><th class="num">Total qty</th><th>Status</th><th>Note</th><th></th></tr></thead>
        <tbody>${state.requests.map((r) => `<tr data-tr-req="${esc(r.id)}">
          <td>${esc(U.timeLabel(new Date(r.at).getTime()))}</td>
          <td><b>${esc(r.byName || r.by)}</b>${r.source === 'public-link' ? ' <span class="badge" title="Employee link se aayi (bina login)">🌐 employee link</span>' : ''}${r.dupCount || (r.dupOf || []).length ? ` <span class="badge amber" title="Employee ne phir bhi bheji — pehle se ${(r.dupOf || []).length} active request: ${esc((r.dupOf || []).join(', '))}">🔁 duplicate</span>` : ''}${r.employee && r.employee.mobile ? `<small class="dim"> ${esc(r.employee.mobile)}</small>` : ''}</td>
          <td class="num">${fmt((r.rows || []).length)}</td>
          <td class="num">${fmt(new Set((r.rows || []).map((x) => x.agentName)).size)}</td>
          <td class="num"><b>${fmt((r.rows || []).reduce((s, x) => s + num(x.approved), 0))}</b></td>
          <td><span class="badge ${statusOf(r).tone}">${statusOf(r).label}</span>${r.sheetSync && r.sheetSync.error ? ' <span class="badge red" title="Sheet sync fail">📗!</span>' : r.sheetSync ? ' <span class="badge green" title="Sheet me entry ho chuki hai">📗</span>' : ''}</td>
          <td class="dim small">${esc(String(r.note || '').slice(0, 60))}</td>
          <td class="num"><button class="btn small primary" data-tr-open="${esc(r.id)}">Kholo</button>${isAdmin() ? ` <button class="btn small" data-tr-meta="${esc(r.id)}">✏️ Edit</button>` : ''}${isAdmin() || r.by === (FF.auth.user && FF.auth.user.username) ? ` <button class="btn small" data-tr-drop="${esc(r.id)}">🗑</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div></section>`;
      body.querySelectorAll('[data-tr-open]').forEach((b) => b.addEventListener('click', () => openRequest(b.dataset.trOpen, false)));
      body.querySelectorAll('[data-tr-meta]').forEach((b) => b.addEventListener('click', () => openRequest(b.dataset.trMeta, true)));
      body.querySelectorAll('[data-tr-drop]').forEach((b) => b.addEventListener('click', () => {
        const r = state.requests.find((x) => x.id === b.dataset.trDrop);
        if (!r) return;
        if (!window.confirm(`Request delete karein? (${(r.rows || []).length} rows)`)) return;
        FF.auth.api(`/api/tag-requests/${encodeURIComponent(r.id)}`, 'DELETE').then(() => { U.toast('🗑 Request delete ho gayi', 'ok'); renderRequests(); }).catch((err) => U.toast('Delete fail: ' + ((err && err.message) || ''), 'err'));
      }));
      if (isAdmin()) {
        body.insertAdjacentHTML('beforeend', publicCardHtml() + sheetCardHtml());
        bindPublicCard(); bindSheetCard();
      }
    });
  }

  // ---- 📗 Google Sheet sync card (admin) -----------------------------------------------------------
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
      return state.sheet.config;
    }).catch((err) => { state.sheet.hint = (err && err.message) || 'Config load nahi hui'; return null; });
  }
  function sheetCardHtml() {
    const s = state.sheet;
    const cfg = s.config;
    if (!cfg) return '<section class="card" id="tr-sheet-card"><div class="card-body dim small">📗 Google Sheet sync load ho raha hai…</div></section>';
    const fields = s.fields || {};
    const colBox = Object.entries(fields).map(([k, label]) => `<label class="tr-col-opt"><input type="checkbox" data-tr-col="${esc(k)}" ${cfg.columns.includes(k) ? 'checked' : ''}> ${esc(label)}</label>`).join('');
    const pub = state.sheet.publicForm || {};
    const targetId = sheetIdOfLink(cfg.sheetLink) || cfg.spreadsheetId || '';
    return `<section class="card" id="tr-sheet-card"><div class="card-head"><h3>📗 Google Sheet me direct entry <span class="badge ${cfg.enabled ? 'green' : ''}">${cfg.enabled ? 'ON' : 'OFF'}</span></h3>
      <div class="card-right dim">Admin — tag requests ko seedha apni Google Sheet me likho</div></div>
      <div class="card-body">
        ${s.connected ? '' : `<div class="notice amber" style="margin-bottom:10px">⚠️ ${esc(s.hint || 'Apps Script connect nahi hai — pehle sheet storage setup karo.')}</div>`}
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
        <p class="dim small" style="margin-top:8px">${targetId ? `🎯 Entries <b>is sheet</b> me jaayengi (ID …${esc(String(targetId).slice(-8))} · tab <b>${esc(cfg.tab || '')}</b>). Us sheet par Apps Script wale Google account ka <b>Editor</b> access hona chahiye — Sheet → Share.` : `Entries is waqt usi sheet me hoti hain jisme Apps Script bana hai (Settings → Backup). Kahin aur bhejna ho to upar <b>alag sheet ka link</b> paste karo.`} Tab na ho to ban jaata hai; pehli entry par header row apne aap likhi jaati hai. Har request drawer me <b>📗 Sheet me push</b> button se manual entry bhi kar sakte ho.</p>
      </div></section>`;
  }

  // ---- 🌐 public employee-link card (admin) -------------------------------------------------------
  /** Employee link (bina login) ka admin control: ON/OFF, fields, title, link copy. */
  function publicCardHtml() {
    const pub = state.sheet.publicForm;
    if (!pub) return '<section class="card" id="tr-public-card"><div class="card-body dim small">🌐 Employee link settings load ho rahi hain…</div></section>';
    const link = shareLink();
    const open = pub.enabled !== false;
    return `<section class="card" id="tr-public-card"><div class="card-head"><h3>🌐 Employee link (bina login) <span class="badge ${open ? 'green' : ''}">${open ? 'ON' : 'OFF'}</span></h3>
      <div class="card-right dim">Ye link koi bhi khol sakta hai — login/signup nahi, bas naam</div></div>
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
            <input class="input" data-tr-pub="intro" value="${esc(pub.intro || '')}" placeholder="Naam likho → agent chuno → qty daalo → submit"></label>
          <label class="field"><span class="dim small">Fields aur check</span>
            <span class="tr-check-row">
              <label class="tr-col-opt"><input type="checkbox" data-tr-pub="askMobile" ${pub.askMobile !== false ? 'checked' : ''}> Mobile (optional)</label>
              <label class="tr-col-opt"><input type="checkbox" data-tr-pub="askOffice" ${pub.askOffice ? 'checked' : ''}> Branch/Office (optional)</label>
              <label class="tr-col-opt"><input type="checkbox" data-tr-pub="showCheck" ${pub.showCheck !== false ? 'checked' : ''}> System check (stock/suggestion) dikhao</label>
            </span></label>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn primary" data-tr-pub-act="save">💾 Save</button>
          <button class="btn" data-tr-pub-act="toggle">${open ? '⏸ Link OFF karo' : '▶️ Link ON karo'}</button>
        </div>
        <p class="dim small" style="margin-top:8px">🔐 Employee ko sirf yehi form dikhta hai — dashboard ka koi doosra page nahi. Data server par scoped public endpoint se aata hai (sirf aggregated issuance + agent summary). Har request <b>employee link</b> badge se aapki list me aati hai — 📱 device/IP aur naam ke saath. Employee apna status <b>Request ID</b> se dekh sakta hai.</p>
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
      if (state.sheet.publicForm && replaceCard('#tr-public-card', publicCardHtml())) attach();
      else if (!state.sheet.publicForm) { /* public config aayi hi nahi */ }
    });
    function attach() {
      const card = rootEl.querySelector('#tr-public-card');
      if (!card) return;
      const act = (name, fn) => { const b = card.querySelector(`[data-tr-pub-act="${name}"]`); if (b) b.addEventListener('click', fn); };
      const collect = () => ({
        title: (card.querySelector('[data-tr-pub="title"]') || {}).value || '',
        intro: (card.querySelector('[data-tr-pub="intro"]') || {}).value || '',
        askMobile: !!(card.querySelector('[data-tr-pub="askMobile"]') || {}).checked,
        askOffice: !!(card.querySelector('[data-tr-pub="askOffice"]') || {}).checked,
        showCheck: !!(card.querySelector('[data-tr-pub="showCheck"]') || {}).checked
      });
      const save = (patch, msg) => {
        const btn = card.querySelector('[data-tr-pub-act="save"]');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Save…'; }
        FF.auth.api('/api/public-tag-form', 'PUT', { config: { ...collect(), ...(patch || {}) } })
          .then((out) => { state.sheet.publicForm = out.config; U.toast(msg || '💾 Employee link settings save ho gayi', 'ok'); if (replaceCard('#tr-public-card', publicCardHtml())) attach(); })
          .catch((err) => U.toast('Save fail: ' + ((err && err.message) || ''), 'err'))
          .finally(() => { const b = rootEl.querySelector('#tr-public-card [data-tr-pub-act="save"]'); if (b) { b.disabled = false; b.textContent = '💾 Save'; } });
      };
      act('save', () => save(null));
      act('toggle', () => {
        const next = !(state.sheet.publicForm && state.sheet.publicForm.enabled !== false);
        save({ enabled: next }, next ? '▶️ Employee link ON — employees ko link bhej sakte ho' : '⏸ Employee link OFF — ab link kholne par "band hai" dikhega');
      });
      act('copy', (e) => U.copyText(e.target.dataset.link || shareLink()).then((ok) => U.toast(ok ? '📋 Employee link copy ho gaya' : 'Copy nahi hua', ok ? 'ok' : 'warn')));
      act('wa', (e) => { const l = e.target.dataset.link || shareLink(); const msg = `🏷️ Tag Request form — yahan se tag request lagao (naam likho, bas):\n${l}`; if (FF.app && FF.app.shareWhatsApp) FF.app.shareWhatsApp(msg); else window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank'); });
      const inp = card.querySelector('#tr-public-link');
      if (inp) inp.addEventListener('click', () => { try { inp.select(); } catch { /* ignore */ } });
    }
  }
  /** Card ko naye HTML se badlo (outerHTML setter har fake/real DOM me safe nahi — replaceWith use karo). */
  function replaceSheetCard() {
    const card = rootEl && rootEl.querySelector ? rootEl.querySelector('#tr-sheet-card') : null;
    if (!card || !card.replaceWith) return null;
    const tmp = document.createElement('div');
    tmp.innerHTML = sheetCardHtml();
    const fresh = tmp.firstElementChild;
    if (!fresh) return null;
    card.replaceWith(fresh);
    return fresh;
  }
  function bindSheetCard() {
    if (!isAdmin()) return;
    loadSheetConfig().then(() => {
      if (state.sheet.config && replaceSheetCard()) attach();
    });
    function attach() {
      const card = rootEl.querySelector('#tr-sheet-card');
      if (!card) return;
      const act = (name, fn) => { const b = card.querySelector(`[data-tr-sheet-act="${name}"]`); if (b) b.addEventListener('click', fn); };
      const collect = () => {
        const cfg = {
          sheetLink: (card.querySelector('[data-tr-sheet="sheetLink"]') || {}).value || '',
          tab: (card.querySelector('[data-tr-sheet="tab"]') || {}).value || 'Tag Requests',
          rowMode: (card.querySelector('[data-tr-sheet="rowMode"]') || {}).value || 'class',
          onSubmit: !!(card.querySelector('[data-tr-sheet="onSubmit"]') || {}).checked,
          onStatus: !!(card.querySelector('[data-tr-sheet="onStatus"]') || {}).checked,
          columns: [...card.querySelectorAll('[data-tr-col]:checked')].map((x) => x.dataset.trCol)
        };
        return cfg;
      };
      act('save', () => {
        const btn = card.querySelector('[data-tr-sheet-act="save"]');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Save…'; }
        FF.auth.api('/api/tag-request-sheet', 'PUT', { config: collect() })
          .then((out) => { state.sheet.config = out.config; state.sheet.connected = !!out.connected; U.toast('💾 Sheet sync settings save ho gayi', 'ok'); if (replaceSheetCard()) attach(); })
          .catch((err) => U.toast('Save fail: ' + ((err && err.message) || ''), 'err'))
          .finally(() => { if (btn) { btn.disabled = false; btn.textContent = '💾 Save settings'; } });
      });
      act('toggle', () => {
        const cfg = collect();
        cfg.enabled = !(state.sheet.config && state.sheet.config.enabled);
        FF.auth.api('/api/tag-request-sheet', 'PUT', { config: cfg })
          .then((out) => { state.sheet.config = out.config; state.sheet.connected = !!out.connected; U.toast(out.config.enabled ? '▶️ Google Sheet sync ON — nayi requests direct sheet me jayengi' : '⏸ Sheet sync OFF', out.config.enabled ? 'ok' : 'info'); if (replaceSheetCard()) attach(); })
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

  /** Request ko drawer me kholo — admin edit (qty + status) kar sakta hai. Rows TL-wise grouped. */
  function openRequest(id, editMode) {
    const r = state.requests.find((x) => x.id === id);
    if (!r || !FF.app) return;
    const canEdit = isAdmin() || (r.by === (FF.auth.user && FF.auth.user.username) && r.status === 'pending');
    const tot = (r.rows || []).reduce((s, x) => s + num(x.approved), 0);
    const rowsSorted = sortRows(r.rows || [], state.groupBy);
    let lastGroup = null;
    const rowsHtml = rowsSorted.map((x) => {
      const i = (r.rows || []).indexOf(x);
      const g = state.groupBy === 'agent' ? norm(x.agentName || '') : tlSortKey(x.tl);
      let sep = '';
      if (g !== lastGroup) {
        lastGroup = g;
        sep = `<tr class="tr-group-row"><td colspan="13">${state.groupBy === 'agent' ? `👤 ${esc(x.agentName || 'Agent')}` : (x.tl === '—' ? '👤 Agent-wise (koi TL nahi)' : `🧑‍💼 TL: ${esc(x.tl)}`)}</td></tr>`;
      }
      return `${sep}<tr><td>${esc(x.agentName)}<small class="dim"> ${esc(x.agentId || '')}</small></td><td>${esc(x.tl || '—')}</td><td><b>${esc(x.cls)}</b></td>
      <td class="num">${fmt(x.last)}</td><td class="num">${fmt(x.cur)}</td><td class="num">${x.growth === undefined || x.growth === null ? '—' : growthCell(Number(x.growth) || 0)}</td>
      <td class="num">${fmt(x.stock)}</td><td class="num">${x.cover === undefined || x.cover === null ? '—' : fmt(x.cover, true)}</td><td>${esc(x.priority || '')}</td>
      <td class="num">${fmt(x.sugNet)}</td><td class="num dim">${fmt(x.sugGross)}</td>
      <td class="num">${canEdit && editMode ? `<input class="input" style="width:74px" data-tr-req-qty="${i}" value="${num(x.approved)}">` : `<b>${fmt(x.approved)}</b>`}</td>
      <td>${canEdit && editMode ? `<input class="input" style="width:150px" data-tr-req-rem="${i}" value="${esc(x.remark || '')}" placeholder="remark">` : esc(x.remark || '')}</td></tr>`;
    }).join('');
    const syncBadge = r.sheetSync ? (r.sheetSync.error ? `<span class="badge red">📗 Sheet fail: ${esc(r.sheetSync.error)}</span>` : `<span class="badge green">📗 Sheet me entry ho chuki (${esc(r.sheetSync.tab || '')} · ${esc(r.sheetSync.event || '')})</span>`) : '';
    const body = `<div class="kd-stats">
        <div class="kd-stat"><span>Request</span><b>${esc(String(r.id).slice(0, 14))}</b></div>
        <div class="kd-stat sky"><span>Kisne</span><b>${esc(r.byName || r.by)}</b></div>
        <div class="kd-stat amber"><span>Status</span><b>${statusOf(r).label}</b></div>
        <div class="kd-stat violet"><span>Total qty</span><b>${fmt(tot)}</b></div>
      </div>
      ${r.source === 'public-link' ? `<p class="dim small">🌐 <b>Employee link</b> se aayi (bina login)${r.employee && r.employee.mobile ? ` · 📱 ${esc(r.employee.mobile)}` : ''}${r.employee && r.employee.office ? ` · 🏢 ${esc(r.employee.office)}` : ''}${r.ip ? ` · IP ${esc(r.ip)}` : ''}</p>` : ''}
      ${(r.dupOf || []).length ? `<p class="dim small">🔁 <b>Duplicate mark:</b> milti-julti active request pehle se thi — ${esc((r.dupOf || []).join(', '))}</p>` : ''}
      <p class="dim small">${esc(U.timeLabel(new Date(r.at).getTime()))}${r.note ? ` · 📝 ${esc(r.note)}` : ''} ${syncBadge}</p>
      <div class="kd-sec"><div class="kd-h-row"><h4 class="kd-h">Rows (${fmt((r.rows || []).length)})</h4>
        <div class="seg small"><button type="button" class="seg-btn ${state.groupBy === 'tl' ? 'on' : ''}" data-tr-group="tl">TL-wise</button><button type="button" class="seg-btn ${state.groupBy === 'agent' ? 'on' : ''}" data-tr-group="agent">Agent-wise</button></div></div>
        <div class="kd-scroll tall"><table class="kd-tbl"><thead><tr><th>Agent</th><th>TL</th><th>Class</th><th class="num">Last</th><th class="num">MTD</th><th class="num">Growth</th><th class="num">Stock</th><th class="num">Cover</th><th>Priority</th><th class="num">Sug. (stock −)</th><th class="num">Sug. w/o stock</th><th class="num">Approved</th><th>Remark</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div>
      ${(r.tls || []).length ? `<div class="kd-sec"><h4 class="kd-h">TL rollup (TL stock · issuance · priority · suggested)</h4><div class="kd-scroll"><table class="kd-tbl"><thead><tr><th>TL</th><th class="num">VC4 stock</th><th class="num">MTD VC4</th><th class="num">Cover</th><th>Priority</th><th class="num">Suggested</th><th class="num">Request total</th></tr></thead><tbody>${r.tls.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${fmt(t.stockVc4)}</td><td class="num">${fmt(t.curVc4)}</td><td class="num">${t.cover === undefined || t.cover === null ? '—' : fmt(t.cover, true)}</td><td>${esc(t.priority || '')}</td><td class="num">${fmt(t.sugNet)} <small class="dim">/ ${fmt(t.sugGross)}</small></td><td class="num"><b>${fmt(t.reqApproved)}</b></td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${canEdit ? `<div class="kd-sec"><h4 class="kd-h">Admin action</h4>
        <label class="field"><span class="dim small">Status</span><select class="input" id="tr-req-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label class="field" style="display:block;margin-top:6px"><span class="dim small">Admin note</span><input class="input" id="tr-req-note" style="width:100%" value="${esc(r.adminNote || '')}" placeholder="e.g. kal 2 box dispatch"></label>
        <div class="btn-row" style="margin-top:8px"><button class="btn primary" id="tr-req-save">💾 Save</button></div></div>` : ''}
      <div class="btn-row" style="margin-top:10px">
        ${isAdmin() ? '<button class="btn" id="tr-req-sheet">📗 Sheet me push</button>' : ''}
        ${FF.auth.can('export') ? '<button class="btn" id="tr-req-csv">⬇ CSV</button><button class="btn" id="tr-req-xlsx">⬇ Excel</button>' : ''}
        <button class="btn" id="tr-req-copy">📋 Copy</button>
        ${FF.auth.can('share') ? '<button class="btn" id="tr-req-wa">💬 WhatsApp</button>' : ''}
      </div>`;
    FF.app.openDrawer({
      kicker: '🏷️ Tag Request', title: `${esc(r.byName || r.by)} · ${fmt((r.rows || []).length)} rows`,
      sub: `${statusOf(r).label} · total ${fmt(tot)} tags · ${state.groupBy === 'tl' ? 'TL-wise' : 'agent-wise'} grouped`,
      body,
      wide: true
    });
    const bind = (sel, fn) => { const el = U.$(sel); if (el) el.addEventListener('click', fn); };
    bind('#tr-req-csv', () => downloadRequest(r, 'csv'));
    bind('#tr-req-xlsx', () => downloadRequest(r, 'xlsx'));
    bind('#tr-req-copy', () => U.copyText(requestText(r)).then((ok) => U.toast(ok ? '📋 Copy ho gaya' : 'Copy nahi hua', ok ? 'ok' : 'warn')));
    bind('#tr-req-wa', () => { if (FF.app && FF.app.shareWhatsApp) FF.app.shareWhatsApp(requestText(r)); else U.toast('Share available nahi', 'warn'); });
    // 🔀 TL-wise / Agent-wise grouping toggle — drawer dobara kholo naye order me.
    document.querySelectorAll('[data-tr-group]').forEach((b) => b.addEventListener('click', () => {
      state.groupBy = b.dataset.trGroup;
      openRequest(id, editMode);
    }));
    const sheetBtn = U.$('#tr-req-sheet');
    if (sheetBtn) sheetBtn.addEventListener('click', () => {
      sheetBtn.disabled = true; sheetBtn.textContent = '⏳ Sheet me likh rahe hain…';
      FF.auth.api('/api/tag-request-sheet/push', 'POST', { id: r.id })
        .then((out) => { U.toast(`📗 Sheet me ${out.added} rows add ho gayi (tab: ${out.tab || ''})`, 'ok'); r.sheetSync = { at: new Date().toISOString(), event: 'manual', added: out.added, tab: out.tab }; })
        .catch((err) => U.toast('Sheet push fail: ' + ((err && err.message) || ''), 'err'))
        .finally(() => { sheetBtn.disabled = false; sheetBtn.textContent = '📗 Sheet me push'; });
    });
    const save = U.$('#tr-req-save');
    if (save) save.addEventListener('click', () => {
      const rows = (r.rows || []).map((x, i) => {
        const q = U.$(`[data-tr-req-qty="${i}"]`), rem = U.$(`[data-tr-req-rem="${i}"]`);
        return { ...x, approved: q ? Math.max(0, Math.round(Number(q.value) || 0)) : num(x.approved), remark: rem ? rem.value : (x.remark || '') };
      });
      const payload = { rows, status: (U.$('#tr-req-status') || {}).value || r.status, adminNote: (U.$('#tr-req-note') || {}).value || '' };
      save.disabled = true; save.textContent = '⏳ Save…';
      FF.auth.api(`/api/tag-requests/${encodeURIComponent(r.id)}`, 'PUT', payload)
        .then((out) => {
          U.toast('💾 Request update ho gayi', 'ok');
          if (out && out.request) Object.assign(r, out.request);
          FF.app.closeDrawer();
          renderRequests();
        })
        .catch((err) => U.toast('Save fail: ' + ((err && err.message) || ''), 'err'))
        .finally(() => { save.disabled = false; save.textContent = '💾 Save'; });
    });
  }

  // ---- render -----------------------------------------------------------------------------------
  async function render(root, params, ctx) {
    rootEl = root;
    // 🌐 Public mode: /tag-request (ya ?public=1) — bina login, sirf employee name mandatory.
    state.publicMode = !!(params && params.public) || !!isPublic();
    if (params && ctx && ctx.publicConfig) state.publicCfg = ctx.publicConfig;
    if (state.publicMode) {
      loadEmployee();
      if (!state.publicCfg && FF.publicForm && FF.publicForm.config) state.publicCfg = FF.publicForm.config;
    }
    if (params && params.view) {
      const views = state.publicMode ? ['form', 'result', 'status', 'done'] : ['form', 'result', 'requests'];
      if (views.includes(params.view)) state.view = params.view;
    }
    if (state.publicMode && state.view === 'requests') state.view = 'form';
    root.innerHTML = `${headHtml()}<div id="tr-body">${U.spinner('Tag request workspace khul raha hai…')}</div>`;
    bindCommon(root);
    const qp = (params && params.agent) ? String(params.agent) : '';
    if (qp && !state.rows.some((r) => r.name || r.agentId)) state.rows = [newRow({ agentId: /^\d+$/.test(qp) ? qp : '', name: /^\d+$/.test(qp) ? '' : qp })];
    if (state.publicMode) {
      // Public link par sirf 4 view: form → result → done / status.
      if (state.view === 'done' && state.done) { renderDone(); return; }
      if (state.view === 'result' && state.result) { renderResult(); return; }
      if (state.view === 'status') { renderStatus(); return; }
      if (state.done && state.view === 'form') state.done = null;
      renderForm();
      buildIndex().then(() => { if (state.view === 'form' && root.isConnected) renderForm(); }).catch(() => {});
      return;
    }
    if (state.view === 'requests') { renderRequests(); return; }
    if (state.view === 'result' && state.result) { renderResult(); return; }
    // Pehle form turant dikhao, phir index background me (page kabhi block na ho).
    renderForm();
    buildIndex().then(() => { if (state.view === 'form' && root.isConnected) renderForm(); }).catch(() => {});
  }

  /**
   * Headless system-check — bina UI ke (assistant / smoke test / deep link).
   * `preview([{ name|agentId, classes: ['VC4'], qty }])` → analyze ka result (rows + tl rollup).
   * Qty na diya ho to system suggestion lagti hai (purana behaviour); classQty object diya to wahi.
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
    state.rows = rows;
    try {
      await buildIndex();
      // Qty wale rows me approved = qty; bina qty (sirf classes) wale me system suggestion.
      const hasAnyQty = rows.some((r) => CLASS_LIST.some((c) => String(r.q[c]).trim() !== ''));
      return analyze(!hasAnyQty);
    } finally { state.rows = keep; }
  }

  FF.pages.tagRequest = {
    title: 'Tag Request',
    render,
    preview,
    shareLink,
    // 🔁 Diagnostics (Settings → support / smoke): duplicate warning card ka wahi HTML jo employee dekhta hai.
    dupWarning: (list, name) => {
      const saved = { mode: state.publicMode, dup: state.dup, emp: state.employee };
      state.publicMode = true;
      state.dup = { list: Array.isArray(list) ? list : [], force: false, busy: false };
      state.employee = { ...(saved.emp || {}), name: name || (saved.emp && saved.emp.name) || 'Employee' };
      const html = dupWarningHtml();
      state.publicMode = saved.mode; state.dup = saved.dup; state.employee = saved.emp;
      return html;
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
