/* 🏷️ IDFC AGENTS TAG REQUEST (v3.24) — panel ka naya option.
 *
 * Flow (admin/user dono):
 *   1. 📝 Form bharo      — Agent ID / Naam, TL, Tag Class (VC4 · VC5 · VC6 · VC7 · VC12 · VC16)
 *                            ek ya kai rows (multiple agents), har row me kai classes.
 *   2. 🔍 System check    — system khud data dekhta hai: last month + current month issuance (class-wise),
 *                            agent stock (class-wise), priority, growth level, cover days aur
 *                            suggested dispatch qty — **stock ke baad** + **bina stock ghataye**.
 *                            TL ka rollup bhi: TL stock, TL issuance, TL priority, TL suggested.
 *   3. ✏️ Editable        — qty / remark koi bhi cell me badal sakte ho (system suggestion default).
 *   4. 📤 Submit          — admin ke paas "🏷️ Tag Request" section me pahunch jaata hai (notification ke saath);
 *                            admin wahin se qty edit karke status (pending/approved/dispatched) set karta hai.
 *   5. ⬇ / 📋 / 💬        — CSV · Excel · Copy · WhatsApp · Print, sab result par.
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
    index: null, indexPromise: null, resolved: new Map(), busy: '', problems: []
  };
  const rid = () => Math.random().toString(36).slice(2, 9);
  function newRow(patch) { return { id: rid(), agentId: '', name: '', tl: '', channel: '', classes: [], qty: '', ...(patch || {}) }; }
  if (!state.rows.length) state.rows = [newRow()];

  const norm = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ' ');
  const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  const ymNow = () => U.ymKey(new Date());
  const ymLast = () => U.prevMonthKey(ymNow());
  const isAdmin = () => !!(FF.auth && FF.auth.user && FF.auth.user.role === 'admin');

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
    const jobs = [
      S && S.need ? S.need('agentClass').catch(() => []) : Promise.resolve([]),
      perf && perf.ensureLoaded ? perf.ensureLoaded().then(() => (perf.agents ? perf.agents() : [])).catch(() => []) : Promise.resolve([]),
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
      // Search list (form ke datalist + lookup ke liye).
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

  // ---- 🔍 system check → result ---------------------------------------------------------------
  /** Form rows ko resolve karke class-wise requirement nikaalo (editable qty ke saath). */
  function analyze() {
    const problems = [];
    const out = [];
    const tlMap = new Map();
    let serial = 0;
    for (const row of state.rows) {
      const cls = (row.classes || []).filter((c) => CLASS_LIST.includes(c));
      if (!String(row.agentId || row.name || '').trim()) continue;             // khaali row chhod do
      const rec = findAgent(row.name || row.agentId, row.channel);
      if (!rec) { problems.push(`"${row.name || row.agentId}" data me nahi mila — ID/naam check karo (sheet me row honi chahiye).`); continue; }
      if (!cls.length) { problems.push(`${rec.name} — kam se kam ek Tag Class chuno.`); continue; }
      if (!out.some((x) => x.agentKey === `${rec.channel}|${norm(rec.name)}`)) serial++;
      for (const c of cls) {
        const cur = num(rec.cur[c]), last = num(rec.last[c]), stock = num(rec.stock[c]);
        // FF ka run-rate T−1 basis par, GV ka live basis par (warna GV suggestion kam aata hai).
        const avg = perDay(cur, rec.channel);
        const pair = U.suggestPair(avg, stock);
        const cover = coverOf(avg, stock);
        const priority = priorityFor(cover, rec.priority);
        const growth = growthOf(cur, last);
        const asked = String(row.qty || '').trim();
        const approved = asked !== '' && Number.isFinite(Number(asked)) ? Math.max(0, Math.round(Number(asked))) : pair.net;
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
      rows: out, tls: [...tlMap.values()].sort((a, b) => (a.cover == null ? 999 : a.cover) - (b.cover == null ? 999 : b.cover)),
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
  function submit() {
    if (!state.result) { U.toast('Pehle 🔍 system check chalao', 'warn'); return; }
    if (!FF.auth.can('tagRequest')) { U.toast('Is page ka access nahi hai', 'err'); return; }
    if (!state.result.rows.length) { U.toast('Koi row nahi — agent + class chuno', 'warn'); return; }
    const total = state.result.rows.reduce((s, x) => s + num(x.approved), 0);
    if (!total) { U.toast('Approved qty 0 hai — kuch qty daalo', 'warn'); return; }
    state.busy = 'send';
    const btn = U.$('[data-tr-act="send"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Bhej rahe hain…'; }
    FF.auth.api('/api/tag-requests', 'POST', {
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
    }).then((out) => {
      U.toast(out && out.ok ? '📤 Tag request admin ko chali gayi — status wahin dikhega' : 'Request save ho gayi', 'ok');
      state.requestsAt = 0;
      state.view = 'requests';
      renderRoot();
    }).catch((err) => U.toast('Request nahi gayi: ' + ((err && err.message) || ''), 'err'))
      .finally(() => { state.busy = ''; });
  }

  // ---- 🖼️ views ---------------------------------------------------------------------------------
  let rootEl = null;
  function renderRoot() {
    if (!rootEl) return;
    if (state.view === 'requests') renderRequests();
    else if (state.view === 'result' && state.result) renderResult();
    else renderForm();
  }
  const tabsHtml = () => {
    const tab = (id, label) => `<button class="seg-btn ${state.view === id ? 'on' : ''}" data-tr-view="${id}">${label}</button>`;
    return `<div class="seg" id="tr-tabs">${tab('form', '📝 Form')}${tab('result', '📊 Result')}${tab('requests', isAdmin() ? '📥 Tag Requests (admin)' : '📥 Meri requests')}</div>`;
  };
  function headHtml() {
    return `<div class="page-head"><div><h1>🏷️ Tag Request</h1><p class="sub">IDFC Agents Tag Request Form — agent + tag class (VC4/VC5/VC6/VC7/VC12/VC16) chuno → system khud data check karke stock, issuance, priority, growth aur suggested dispatch qty nikaalta hai — wo editable hai, phir share / download / admin ko submit.</p></div>
      <div class="head-actions">${tabsHtml()}<button class="btn" data-tr-act="reload">↻ Data refresh</button></div></div>`;
  }
  function bindCommon(body) {
    body.querySelectorAll('[data-tr-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.trView; renderRoot(); }));
    const reload = body.querySelector('[data-tr-act="reload"]');
    if (reload) reload.addEventListener('click', () => { buildIndex(true).then(() => U.toast('Taaza data se index ban gaya', 'ok')); });
  }

  // ---- 📝 form ------------------------------------------------------------------------------------
  function agentOptions(listQuery) {
    const idx = state.index;
    if (!idx) return '';
    const q = norm(listQuery);
    const items = (idx.list || []).filter((a) => !q || norm(a.name).includes(q) || digits(a.agentId).includes(digits(q))).slice(0, 400);
    return items.map((a) => `<option value="${esc(a.agentId || a.name)}">${esc(a.name)}${a.tlName ? ` · TL ${esc(a.tlName)}` : ''} · ${a.channel === 'gv' ? 'GV' : 'FF'}</option>`).join('');
  }
  function rowHtml(row, i) {
    const rec = findAgent(row.name || row.agentId, row.channel);
    const auto = rec ? `<span class="badge green">${rec.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span> ${esc(rec.name)}${rec.agentId ? ` · ID ${esc(rec.agentId)}` : ''}${rec.tlName ? ` · TL ${esc(rec.tlName)}` : ''}` : (state.index ? '<span class="dim small">ID/naam likho — system khud naam, TL aur channel bhar dega</span>' : '<span class="dim small">agent list load ho rahi hai…</span>');
    return `<tr data-tr-row="${row.id}">
      <td class="num dim">${i + 1}</td>
      <td><input class="input tr-agent" list="tr-agents-${row.id}" data-tr-field="agentId" value="${esc(row.agentId)}" placeholder="Agent ID / naam" autocomplete="off">
        <datalist id="tr-agents-${row.id}">${agentOptions(row.agentId)}</datalist>
        <div class="small dim" style="margin-top:2px">${auto}</div></td>
      <td>${CLASS_LIST.map((c) => `<button type="button" class="chip ${row.classes.includes(c) ? 'on' : ''}" data-tr-cls="${c}" title="${esc(CLASS_LABEL[c])}">${c}</button>`).join(' ')}</td>
      <td class="num"><input class="input tr-qty" style="width:74px" data-tr-field="qty" value="${esc(row.qty)}" placeholder="${U.suggestDays()}d" inputmode="numeric"></td>
      <td class="num"><button class="btn small" data-tr-del="${row.id}" title="Row hatao">✕</button></td>
    </tr>`;
  }
  function renderForm() {
    const body = rootEl.querySelector('#tr-body');
    body.innerHTML = `
      ${state.problems.length ? `<div class="card"><div class="card-body"><b>⚠️ Pichhle check me dikkat:</b><ul>${state.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div></div>` : ''}
      <section class="card"><div class="card-head"><h3>📝 IDFC Agents Tag Request Form <span class="count">${fmt(state.rows.length)} rows</span></h3>
        <div class="card-right dim">Agent ID ya naam likho · class chips chuno · qty khaali chhodo to system suggestion lagega</div></div>
        <div class="card-body">
          <div class="table-wrap"><table class="tbl compact"><thead><tr><th>#</th><th>Agent ID / Naam</th><th>Tag Class (VC4·VC5·VC6·VC7·VC12·VC16)</th><th class="num">Qty<br><small class="dim">optional</small></th><th></th></tr></thead>
          <tbody>${state.rows.map(rowHtml).join('')}</tbody></table></div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn" data-tr-act="add">➕ Ek aur agent</button>
            <button class="btn" data-tr-act="clear">🧹 Clear</button>
            <button class="btn primary" data-tr-act="check">🔍 System check karo → Result</button>
          </div>
          <label class="field" style="display:block;margin-top:12px"><span class="dim small">Note (optional — admin ke liye)</span>
            <input class="input" data-tr-field="note" value="${esc(state.note)}" placeholder="e.g. urgent — kal dispatch chahiye" style="width:100%"></label>
        </div></section>
      <p class="dim small">🔎 System check: har agent × class ke liye sheet se <b>last month</b> + <b>current month (MTD)</b> issuance, <b>stock</b>, <b>cover days</b>, <b>growth</b> aur <b>priority</b> nikaal kar suggested dispatch qty deta hai — <b>stock ke baad</b> (net) aur <b>bina stock ghataye</b> (w/o stock). Sab editable hai.</p>`;
    const bodyEl = rootEl;
    bodyEl.querySelectorAll('.tr-agent').forEach((inp) => {
      const row = state.rows.find((r) => r.id === inp.closest('[data-tr-row]').dataset.trRow);
      const sync = () => {
        const v = inp.value.trim();
        if (!v) return;
        const rec = findAgent(v, row.channel);
        if (rec) {
          row.agentId = rec.agentId || v; row.name = rec.name; row.tl = rec.tlName; row.channel = rec.channel;
          if (!row.classes.length) row.classes = ['VC4'];
          renderForm();
        } else { row.agentId = /^\d{4,}$/.test(v.replace(/\D/g, '')) ? v.replace(/\D/g, '') : ''; row.name = v; row.channel = ''; }
      };
      inp.addEventListener('change', sync);
    });
    bodyEl.querySelectorAll('[data-tr-cls]').forEach((btn) => btn.addEventListener('click', () => {
      const row = state.rows.find((r) => r.id === btn.closest('[data-tr-row]').dataset.trRow);
      const c = btn.dataset.trCls;
      row.classes = row.classes.includes(c) ? row.classes.filter((x) => x !== c) : row.classes.concat(c);
      renderForm();
    }));
    bodyEl.querySelectorAll('[data-tr-field="qty"]').forEach((inp) => inp.addEventListener('input', () => {
      const row = state.rows.find((r) => r.id === inp.closest('[data-tr-row]').dataset.trRow);
      row.qty = inp.value;
    }));
    const note = bodyEl.querySelector('[data-tr-field="note"]');
    if (note) note.addEventListener('input', () => { state.note = note.value; });
    const del = bodyEl.querySelectorAll('[data-tr-del]');
    del.forEach((b) => b.addEventListener('click', () => {
      state.rows = state.rows.filter((r) => r.id !== b.dataset.trDel);
      if (!state.rows.length) state.rows = [newRow()];
      renderForm();
    }));
    const act = (name, fn) => { const b = bodyEl.querySelector(`[data-tr-act="${name}"]`); if (b) b.addEventListener('click', fn); };
    act('add', () => { state.rows.push(newRow()); renderForm(); });
    act('clear', () => { state.rows = [newRow()]; state.note = ''; state.result = null; state.problems = []; renderForm(); });
    act('check', async () => {
      const btn = bodyEl.querySelector('[data-tr-act="check"]');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Data check ho raha hai…'; }
      try { await buildIndex(); } catch { /* index fallback */ }
      const res = analyze();
      if (!res) { renderForm(); U.toast('Koi valid row nahi mili — agent ID/naam aur class check karo', 'warn'); return; }
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
    const total = res.rows.reduce((s, x) => s + num(x.approved), 0);
    const totalRef = res.rows.reduce((s, x) => s + num(x.sugNet), 0);
    const totalGross = res.rows.reduce((s, x) => s + num(x.sugGross), 0);
    const agents = new Set(res.rows.map((x) => x.agentKey));
    body.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi g2"><div class="kpi-top"><span class="kpi-title">📝 Request rows</span></div><div class="kpi-value">${fmt(res.rows.length)}</div><div class="kpi-foot">${fmt(agents.size)} agents · ${fmt(new Set(res.rows.map((x) => x.cls)).size)} classes</div></div>
        <div class="kpi g9"><div class="kpi-top"><span class="kpi-title">🎯 Suggested (stock −)</span></div><div class="kpi-value">${fmt(totalRef)}</div><div class="kpi-foot">w/o stock ${fmt(totalGross)} · ${res.days} din ka target</div></div>
        <div class="kpi g6"><div class="kpi-top"><span class="kpi-title">✅ Approved (editable)</span></div><div class="kpi-value" id="tr-total">${fmt(total)}</div><div class="kpi-foot">admin ko yahi jayega</div></div>
        <div class="kpi g4"><div class="kpi-top"><span class="kpi-title">🚦 High priority</span></div><div class="kpi-value">${fmt(res.rows.filter((x) => /high/i.test(x.priority)).length)}</div><div class="kpi-foot">cover &lt; 7 din</div></div>
      </div>
      <section class="card"><div class="card-head"><h3>📊 System check · agent × class</h3>
        <div class="card-right dim">qty / remark badal sakte ho — totals apne aap update hote hain</div></div>
        <div class="table-wrap tall"><table class="tbl"><thead><tr>
          <th>Agent</th><th>TL</th><th>Class</th><th class="num">${esc(U.labelYM(ymLast()))}</th><th class="num">${esc(U.labelYM(ymNow()))} MTD</th><th class="num">Growth</th><th class="num">Stock</th><th class="num">Cover</th><th>Priority</th>
          <th class="num">🎯 stock −</th><th class="num">🎯 w/o stock</th><th class="num">✅ Approved</th><th>Remark</th></tr></thead>
        <tbody>${res.rows.map((x) => `<tr data-tr-res="${x.id}">
          <td><b>${esc(x.agentName)}</b> <small class="dim">${esc(x.agentId || '')}</small> <span class="badge ${x.channel === 'gv' ? 'green' : ''}">${x.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span></td>
          <td>${esc(x.tl)}</td>
          <td><b>${esc(x.cls)}</b></td>
          <td class="num">${fmt(x.last)}</td>
          <td class="num"><b>${fmt(x.cur)}</b> <small class="dim">· ${fmt(x.avg, true)}/din${x.channel === 'gv' ? ' (live)' : ''}</small></td>
          <td class="num">${growthCell(x.growth)}</td>
          <td class="num"><b>${fmt(x.stock)}</b></td>
          <td class="num">${x.cover == null ? '<span class="dim">∞</span>' : `<span class="badge ${x.cover < 7 ? 'red' : x.cover < 15 ? 'amber' : 'green'}">${fmt(x.cover, true)}</span>`}</td>
          <td><span class="badge ${toneFor(x.priority)}">${esc(x.priority)}</span></td>
          <td class="num"><b class="sug-chip">${fmt(x.sugNet)}</b></td>
          <td class="num dim">${fmt(x.sugGross)}</td>
          <td class="num"><input class="input tr-appr" style="width:78px" data-tr-appr="${x.id}" inputmode="numeric" value="${num(x.approved)}"></td>
          <td><input class="input tr-remark" style="width:160px" data-tr-remark="${x.id}" value="${esc(x.remark)}" placeholder="remark"></td>
        </tr>`).join('')}</tbody></table></div>
      </section>
      ${res.tls.length ? `<section class="card"><div class="card-head"><h3>🧑‍💼 TL rollup (TL stock · issuance · priority · suggested)</h3><div class="card-right dim">TL ke poore agents ka stock/issuance + is request ka total</div></div>
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th>TL</th><th>Channel</th><th class="num">Agents</th><th class="num">VC4 stock</th><th class="num">${esc(U.labelYM(ymNow()))} VC4</th><th class="num">Cover</th><th>Priority</th><th class="num">🎯 is request ka total</th></tr></thead>
        <tbody>${res.tls.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td>${t.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</td><td class="num">${fmt(t.agentsCount)}${t.reqAgentCount ? ` <small class="dim">(${fmt(t.reqAgentCount)} requested)</small>` : ''}</td><td class="num"><b>${fmt(t.stock.VC4)}</b></td><td class="num">${fmt(t.cur.VC4)}</td><td class="num">${t.cover == null ? '<span class="dim">∞</span>' : `<span class="badge ${t.cover < 7 ? 'red' : t.cover < 15 ? 'amber' : 'green'}">${fmt(t.cover, true)}</span>`}</td><td><span class="badge ${toneFor(t.priority)}">${esc(t.priority)}</span></td><td class="num"><b>${fmt(t.reqApproved)}</b> <small class="dim">/ sug ${fmt(t.reqNet)}</small></td></tr>`).join('')}</tbody></table></div></section>` : ''}
      ${state.problems.length ? `<section class="card"><div class="card-body"><b>⚠️ Kuch rows skip hui:</b><ul>${state.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div></section>` : ''}
      <section class="card"><div class="card-body">
        <label class="field" style="display:block"><span class="dim small">Note (admin ko dikhega)</span><input class="input" id="tr-res-note" style="width:100%" value="${esc(res.note || state.note)}" placeholder="e.g. urgent"></label>
        <div class="btn-row" style="margin-top:10px">
          ${FF.auth.can('tagRequest') ? '<button class="btn primary" data-tr-act="send">📤 Admin ko submit karo</button>' : ''}
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
        body.innerHTML = '<section class="card"><div class="card-body empty">Abhi koi tag request nahi hai. 📝 Form bharo → 🔍 system check → 📤 submit.</div></section>';
        return;
      }
      body.innerHTML = `<section class="card"><div class="card-head"><h3>📥 Tag Requests <span class="count">${fmt(state.requests.length)}</span></h3>
        <div class="card-right dim">${isAdmin() ? 'Admin: qty edit karo, status set karo — sab yahin se' : 'Aapki bheji hui requests aur unka status'}</div></div>
        <div class="table-wrap tall"><table class="tbl"><thead><tr><th>Kab</th><th>Kisne</th><th class="num">Rows</th><th class="num">Agents</th><th class="num">Total qty</th><th>Status</th><th>Note</th><th></th></tr></thead>
        <tbody>${state.requests.map((r) => `<tr data-tr-req="${esc(r.id)}">
          <td>${esc(U.timeLabel(new Date(r.at).getTime()))}</td>
          <td><b>${esc(r.byName || r.by)}</b></td>
          <td class="num">${fmt((r.rows || []).length)}</td>
          <td class="num">${fmt(new Set((r.rows || []).map((x) => x.agentName)).size)}</td>
          <td class="num"><b>${fmt((r.rows || []).reduce((s, x) => s + num(x.approved), 0))}</b></td>
          <td><span class="badge ${statusOf(r).tone}">${statusOf(r).label}</span></td>
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
    });
  }
  /** Request ko drawer me kholo — admin edit (qty + status) kar sakta hai. */
  function openRequest(id, editMode) {
    const r = state.requests.find((x) => x.id === id);
    if (!r || !FF.app) return;
    const canEdit = isAdmin() || (r.by === (FF.auth.user && FF.auth.user.username) && r.status === 'pending');
    const tot = (r.rows || []).reduce((s, x) => s + num(x.approved), 0);
    const rowsHtml = (r.rows || []).map((x, i) => `<tr><td>${esc(x.agentName)}<small class="dim"> ${esc(x.agentId || '')}</small></td><td>${esc(x.tl || '—')}</td><td><b>${esc(x.cls)}</b></td>
      <td class="num">${fmt(x.last)}</td><td class="num">${fmt(x.cur)}</td><td class="num">${x.growth === undefined || x.growth === null ? '—' : growthCell(Number(x.growth) || 0)}</td>
      <td class="num">${fmt(x.stock)}</td><td class="num">${x.cover === undefined || x.cover === null ? '—' : fmt(x.cover, true)}</td><td>${esc(x.priority || '')}</td>
      <td class="num">${fmt(x.sugNet)}</td><td class="num dim">${fmt(x.sugGross)}</td>
      <td class="num">${canEdit && editMode ? `<input class="input" style="width:74px" data-tr-req-qty="${i}" value="${num(x.approved)}">` : `<b>${fmt(x.approved)}</b>`}</td>
      <td>${canEdit && editMode ? `<input class="input" style="width:150px" data-tr-req-rem="${i}" value="${esc(x.remark || '')}" placeholder="remark">` : esc(x.remark || '')}</td></tr>`).join('');
    const body = `<div class="kd-stats">
        <div class="kd-stat"><span>Request</span><b>${esc(String(r.id).slice(0, 14))}</b></div>
        <div class="kd-stat sky"><span>Kisne</span><b>${esc(r.byName || r.by)}</b></div>
        <div class="kd-stat amber"><span>Status</span><b>${statusOf(r).label}</b></div>
        <div class="kd-stat violet"><span>Total qty</span><b>${fmt(tot)}</b></div>
      </div>
      <p class="dim small">${esc(U.timeLabel(new Date(r.at).getTime()))}${r.note ? ` · 📝 ${esc(r.note)}` : ''}</p>
      <div class="kd-sec"><h4 class="kd-h">Rows (${fmt((r.rows || []).length)})</h4><div class="kd-scroll tall"><table class="kd-tbl"><thead><tr><th>Agent</th><th>TL</th><th>Class</th><th class="num">Last</th><th class="num">MTD</th><th class="num">Growth</th><th class="num">Stock</th><th class="num">Cover</th><th>Priority</th><th class="num">Sug. (stock −)</th><th class="num">Sug. w/o stock</th><th class="num">Approved</th><th>Remark</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div>
      ${(r.tls || []).length ? `<div class="kd-sec"><h4 class="kd-h">TL rollup (TL stock · issuance · priority · suggested)</h4><div class="kd-scroll"><table class="kd-tbl"><thead><tr><th>TL</th><th class="num">VC4 stock</th><th class="num">MTD VC4</th><th class="num">Cover</th><th>Priority</th><th class="num">Suggested</th><th class="num">Request total</th></tr></thead><tbody>${r.tls.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${fmt(t.stockVc4)}</td><td class="num">${fmt(t.curVc4)}</td><td class="num">${t.cover === undefined || t.cover === null ? '—' : fmt(t.cover, true)}</td><td>${esc(t.priority || '')}</td><td class="num">${fmt(t.sugNet)} <small class="dim">/ ${fmt(t.sugGross)}</small></td><td class="num"><b>${fmt(t.reqApproved)}</b></td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${canEdit ? `<div class="kd-sec"><h4 class="kd-h">Admin action</h4>
        <label class="field"><span class="dim small">Status</span><select class="input" id="tr-req-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label class="field" style="display:block;margin-top:6px"><span class="dim small">Admin note</span><input class="input" id="tr-req-note" style="width:100%" value="${esc(r.adminNote || '')}" placeholder="e.g. kal 2 box dispatch"></label>
        <div class="btn-row" style="margin-top:8px"><button class="btn primary" id="tr-req-save">💾 Save</button></div></div>` : ''}
      <div class="btn-row" style="margin-top:10px">
        ${FF.auth.can('export') ? '<button class="btn" id="tr-req-csv">⬇ CSV</button><button class="btn" id="tr-req-xlsx">⬇ Excel</button>' : ''}
        <button class="btn" id="tr-req-copy">📋 Copy</button>
        ${FF.auth.can('share') ? '<button class="btn" id="tr-req-wa">💬 WhatsApp</button>' : ''}
      </div>`;
    FF.app.openDrawer({
      kicker: '🏷️ Tag Request', title: `${esc(r.byName || r.by)} · ${fmt((r.rows || []).length)} rows`,
      sub: `${statusOf(r).label} · total ${fmt(tot)} tags`,
      body,
      wide: true
    });
    const bind = (sel, fn) => { const el = U.$(sel); if (el) el.addEventListener('click', fn); };
    bind('#tr-req-csv', () => downloadRequest(r, 'csv'));
    bind('#tr-req-xlsx', () => downloadRequest(r, 'xlsx'));
    bind('#tr-req-copy', () => U.copyText(requestText(r)).then((ok) => U.toast(ok ? '📋 Copy ho gaya' : 'Copy nahi hua', ok ? 'ok' : 'warn')));
    bind('#tr-req-wa', () => { if (FF.app && FF.app.shareWhatsApp) FF.app.shareWhatsApp(requestText(r)); else U.toast('Share available nahi', 'warn'); });
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
  async function render(root, params) {
    rootEl = root;
    if (params && params.view && ['form', 'result', 'requests'].includes(params.view)) state.view = params.view;
    root.innerHTML = `${headHtml()}<div id="tr-body">${U.spinner('Tag request workspace khul raha hai…')}</div>`;
    bindCommon(root);
    const qp = (params && params.agent) ? String(params.agent) : '';
    if (qp && !state.rows.some((r) => r.name || r.agentId)) state.rows = [newRow({ agentId: /^\d+$/.test(qp) ? qp : '', name: /^\d+$/.test(qp) ? '' : qp, classes: ['VC4'] })];
    if (state.view === 'requests') { renderRequests(); return; }
    if (state.view === 'result' && state.result) { renderResult(); return; }
    // Pehle form turant dikhao, phir index background me (page kabhi block na ho).
    renderForm();
    buildIndex().then(() => { if (state.view === 'form' && root.isConnected) renderForm(); }).catch(() => {});
  }

  /**
   * Headless system-check — bina UI ke (assistant / smoke test / deep link).
   * `preview([{ name|agentId, classes: ['VC4'], qty }])` → analyze ka result (rows + tl rollup).
   * Page ka state nahi chhua jaata, isliye ye kabhi bhi safe hai.
   */
  async function preview(input) {
    const rows = (Array.isArray(input) ? input : [input || {}]).map((x) => newRow({
      agentId: /^\d+$/.test(String(x.agentId || x.name || '')) ? String(x.agentId || x.name) : '',
      name: /^\d+$/.test(String(x.agentId || x.name || '')) ? '' : String(x.name || x.agentId || ''),
      classes: (Array.isArray(x.classes) ? x.classes : [x.cls || 'VC4']).map((c) => String(c || '').toUpperCase()).filter((c) => CLASS_LIST.includes(c)),
      qty: x.qty === undefined || x.qty === null ? '' : String(x.qty)
    }));
    const keep = state.rows;
    state.rows = rows;
    try {
      await buildIndex();
      return analyze();
    } finally { state.rows = keep; }
  }

  FF.pages.tagRequest = {
    title: 'Tag Request',
    render,
    preview,
    // Diagnostics (Settings → support / smoke): index kitna bana, koi error?
    indexInfo: () => ({
      agents: state.index ? state.index.list.length : 0,
      tls: state.index ? state.index.tls.size : 0,
      at: state.index ? state.index.at : 0,
      error: state.index && state.index.error ? String(state.index.error.message || state.index.error) : '',
      problems: state.problems.slice(0, 5)
    }),
    // Doosre pages / assistant se seedha "tag request banao" — agent pre-filled form.
    open: (agent) => { if (agent) state.rows = [newRow({ agentId: /^\d+$/.test(String(agent)) ? String(agent) : '', name: /^\d+$/.test(String(agent)) ? '' : String(agent), classes: ['VC4'] })]; state.view = 'form'; }
  };
})(window.FF);
