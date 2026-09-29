/* 🧾 MASTER PROFILE (v3.13) — master search me kisi bhi agent / TL par click karte hi poori "kundli":
     • Header: naam, ID, mobile, TL (naam / ID / mobile), status, last active, dispatch priority
     • Stock: agent stock (VC4 / Commercial / total) + TL stock
     • Dispatch: cover din, suggested VC4 + Commercial qty (avg/day × suggest-days − stock),
       Direct agent + High/Medium priority = "🏷️ TAG REQUIRED" (stock nahi, tags chahiye)
     • Issuance class-wise: Class | Last month | This month | Stock  (+ VC4 / Commercial / Total summary)
     • TL / all-Commercial ke liye: TL-level totals + agents table + class totals
     • Charts: class donut, last-vs-this month, month trend, last 7 days / agent-wise bars
     • CSV + WhatsApp share

   FF data → FF.pages.performance (REPORT tab) + FF.store (agentClass / agents / stockAgents)
   GV data → FF.gv (REPORT, Master issuance, Stock agent)
   Mobile fallback: agent.mobile → 10-digit agent ID → GV REPORT (id / naam) → "—" (contacts permission chahiye). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean;
  const fmt = (n, d) => U.fmt(n, d);
  const norm = (s) => clean(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const isHM = (p) => /high|medium/i.test(String(p || ''));
  const suggestDays = () => Number(FF.config && FF.config.features && FF.config.features.suggestDays) || 15;
  const suggest = (avg, stock) => Math.max(0, Math.ceil((Number(avg) || 0) * suggestDays() - (Number(stock) || 0)));
  const canContacts = () => { try { return !FF.auth || FF.auth.can('contacts'); } catch { return true; } };
  const perf = () => (FF.pages && FF.pages.performance) || null;
  const safeCall = (fn, fb) => { try { const v = fn(); return v === undefined ? fb : v; } catch { return fb; } };
  const safeAsync = async (fn) => { try { return await fn(); } catch { return null; } };
  const rowsOf = (key) => safeCall(() => FF.store && FF.store.get && FF.store.get(key), null) || [];
  const gvOn = () => !!(FF.gv && safeCall(() => (FF.gv.enabled ? FF.gv.enabled() : true), true));
  const gvRows = (key) => safeCall(() => (FF.gv && FF.gv.get && FF.gv.get(key)), null) || [];
  const CLS_ORDER = ['VC4', 'VC20', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16', 'VC5+'];
  const clsRank = (c) => { const i = CLS_ORDER.indexOf(String(c).toUpperCase()); return i < 0 ? 99 : i; };
  const is4 = (c) => /^VC\s*4$/i.test(String(c || '').trim());
  const monthLabel = (ym) => { try { return U.labelYM(ym); } catch { return String(ym || ''); } };
  const num = (v) => Number(v) || 0;

  // ------------------------------------------------------------------ loading
  let warmPromise = null;
  async function load() {
    const P = perf();
    const jobs = [];
    if (P && P.ensureLoaded) jobs.push(safeAsync(() => P.ensureLoaded()));
    ['agentClass', 'agents', 'stockAgents'].forEach((k) => { if (FF.store && FF.store.need) jobs.push(safeAsync(() => FF.store.need(k))); });
    if (gvOn() && FF.gv && FF.gv.need) ['report', 'stockAgent', 'stockAgentClass', 'master'].forEach((k) => jobs.push(safeAsync(() => FF.gv.need(k))));
    await Promise.all(jobs);
    quickCache.clear();
  }
  function warm() { if (!warmPromise) warmPromise = load().catch(() => {}); return warmPromise; }

  // ------------------------------------------------------------------ lookup helpers
  const quickCache = new Map();
  const ffAgents = () => safeCall(() => (perf() && perf().agents ? perf().agents() : []), []) || [];
  const gvReport = () => gvRows('report');
  function findFfAgent(name, id) {
    const n = norm(name);
    const list = ffAgents().filter((a) => norm(a.name) === n);
    if (id) { const byId = list.find((a) => a.agentId === id || a.id === id); if (byId) return byId; }
    return list[0] || null;
  }
  function findGvAgent(name, id) {
    const n = norm(name);
    const list = gvReport();
    return list.find((r) => id && r.agentId === id) || list.find((r) => norm(r.agentName) === n) || null;
  }
  function gvMobileFor(name, id) {
    const r = findGvAgent(name, id);
    return r && r.mobile && !/^na$/i.test(r.mobile) ? r.mobile : '';
  }
  function mobileFor(name, id, own) {
    const clean10 = (v) => String(v || '').replace(/\D/g, '');
    if (own && !/^na$/i.test(own)) return own;
    if (/^\d{10}$/.test(clean10(id)) && clean10(id) === String(id).trim()) return String(id).trim();
    return gvMobileFor(name, id) || '';
  }
  const monthsFrom = (rows, key) => U.uniq(rows.map((r) => r[key]).filter(Boolean)).sort();

  /** cls-wise { cls: {cur, last, stock} } builder */
  function classTable(issRows, stockRows, curYm, lastYm) {
    const map = new Map();
    const slot = (cls) => { const k = String(cls || '—').toUpperCase(); if (!map.has(k)) map.set(k, { cls: k, cur: 0, last: 0, stock: 0 }); return map.get(k); };
    issRows.forEach((r) => { if (r.ym === curYm) slot(r.cls).cur += num(r.n); else if (r.ym === lastYm) slot(r.cls).last += num(r.n); });
    stockRows.forEach((r) => { slot(r.cls).stock += num(r.n); });
    return [...map.values()].sort((a, b) => clsRank(a.cls) - clsRank(b.cls) || (b.cur + b.stock) - (a.cur + a.stock));
  }
  const groupSummary = (table) => {
    const g = { vc4: { cur: 0, last: 0, stock: 0 }, comm: { cur: 0, last: 0, stock: 0 }, total: { cur: 0, last: 0, stock: 0 } };
    table.forEach((r) => { const t = is4(r.cls) ? g.vc4 : g.comm; ['cur', 'last', 'stock'].forEach((k) => { t[k] += r[k]; g.total[k] += r[k]; }); });
    return g;
  };
  const trendOf = (rows, pick, ymOf) => {
    const map = new Map();
    rows.forEach((r) => { if (!pick(r)) return; const y = ymOf(r); if (!y) return; map.set(y, (map.get(y) || 0) + num(r.n)); });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([ym, n]) => ({ ym, n }));
  };
  const latestYm = (rows) => monthsFrom(rows, 'ym').pop() || U.ymKey(new Date());

  // ------------------------------------------------------------------ profile builders
  function ffAgentProfile(p, light) {
    const a = findFfAgent(p.name, p.sub);
    const P = perf();
    const elapsed = safeCall(() => P && P.daysElapsed && P.daysElapsed(), null);
    const out = { kind: 'ff-agent', channel: 'First Forward', ch: 'ff', name: p.name, id: (a && (a.agentId || a.id)) || p.sub || '', found: !!a };
    const ac = rowsOf('agentClass'), agRows = rowsOf('agents'), stk = rowsOf('stockAgents');
    const n = norm(p.name);
    if (a) {
      const avgVc4 = a.avgVc4 || (elapsed ? a.curVc4 / elapsed : 0) || 0;
      const avgNvc4 = a.avgNvc4 || (elapsed ? a.curNvc4 / elapsed : 0) || 0;
      Object.assign(out, {
        mobile: mobileFor(a.name, a.agentId || a.id, a.mobile), tl: { name: a.tlName, id: a.tlId, mobile: a.tlMobile },
        status: a.agentStatus || '', lastActive: a.lastActive || '', priority: a.priority || '', growth: a.growth || '',
        direct: !!a.tlExcluded, directLabel: a.tlExcluded ? FF.config.directLabel(a, 'ff') : '',
        stock: { vc4: num(a.stockVc4), comm: num(a.stockNvc4), total: num(a.stockTotal) || num(a.stockVc4) + num(a.stockNvc4) },
        tlStock: { vc4: num(a.tlStockVc4), comm: num(a.tlStockNvc4), total: num(a.tlStockTotal), has: a.tlStockTotal != null || a.tlStockVc4 != null },
        dispatch: { days: suggestDays(), avgVc4, avgComm: avgNvc4, cover: a.agentStockDays != null && a.agentStockDays !== '' && !Number.isNaN(Number(a.agentStockDays)) ? Number(a.agentStockDays) : null, sugVc4: suggest(avgVc4, a.stockVc4), sugComm: suggest(avgNvc4, a.stockNvc4) },
        totals: { curVc4: num(a.curVc4), curComm: num(a.curNvc4), curTotal: num(a.curTotal), lastVc4: num(a.lastVc4), lastComm: num(a.lastNvc4), lastTotal: num(a.lastTotal) },
        week: a.week || [], weekLabels: safeCall(() => P.dayLabels && P.dayLabels(), []) || []
      });
    } else {
      Object.assign(out, { mobile: mobileFor(p.name, p.sub, ''), tl: { name: [...(p.tlSet || [])][0] || '' }, priority: '', direct: !!p.direct, directLabel: p.directLabel || '', stock: { vc4: 0, comm: 0, total: 0 }, tlStock: { has: false }, dispatch: { days: suggestDays(), sugVc4: 0, sugComm: 0 }, totals: {} });
    }
    out.tagRequired = out.direct && isHM(out.priority);
    if (light) return out;
    const curYm = latestYm(ac.length ? ac : agRows), lastYm = U.prevMonthKey(curYm);
    const isMine = (r) => norm(r.name) === n && (!r.channel || /first/i.test(r.channel));
    out.months = { cur: curYm, last: lastYm };
    out.classes = classTable(ac.filter(isMine), stk.filter((r) => norm(r.agentName) === n), curYm, lastYm);
    if (!out.classes.length && a) out.classes = [{ cls: 'VC4', cur: num(a.curVc4), last: num(a.lastVc4), stock: num(a.stockVc4) }, { cls: 'Commercial', cur: num(a.curNvc4), last: num(a.lastNvc4), stock: num(a.stockNvc4) }];
    out.trend = trendOf(agRows, (r) => norm(r.name) === n && (!r.channel || /first/i.test(r.channel)), (r) => r.ym);
    return out;
  }

  function ffTlProfile(p, light) {
    const n = norm(p.name);
    const agents = ffAgents().filter((a) => !a.tlExcluded && norm(a.tlName) === n);
    const src = agents.find((a) => a.tlStockTotal != null) || agents[0] || null;
    const P = perf();
    const elapsed = safeCall(() => P && P.daysElapsed && P.daysElapsed(), null);
    const sumK = (k) => U.sum(agents, (a) => num(a[k]));
    const avgVc4 = (src && src.tlAvgVc4) || (elapsed ? sumK('curVc4') / elapsed : 0) || 0;
    const avgComm = (src && src.tlAvgNvc4) || (elapsed ? sumK('curNvc4') / elapsed : 0) || 0;
    const stock = src && src.tlStockTotal != null
      ? { vc4: num(src.tlStockVc4), comm: num(src.tlStockNvc4), total: num(src.tlStockTotal) }
      : { vc4: sumK('stockVc4'), comm: sumK('stockNvc4'), total: sumK('stockTotal') };
    const rowsA = agents.map((a) => {
      const av = a.avgVc4 || (elapsed ? a.curVc4 / elapsed : 0) || 0;
      const avc = a.avgNvc4 || (elapsed ? a.curNvc4 / elapsed : 0) || 0;
      return { name: a.name, id: a.agentId || a.id, mobile: mobileFor(a.name, a.agentId || a.id, a.mobile), priority: a.priority || '', stockVc4: num(a.stockVc4), stockComm: num(a.stockNvc4), stockTotal: num(a.stockTotal), cur: num(a.curTotal), last: num(a.lastTotal), curVc4: num(a.curVc4), curComm: num(a.curNvc4), sugVc4: suggest(av, a.stockVc4), sugComm: suggest(avc, a.stockNvc4) };
    }).sort((x, y) => y.cur - x.cur);
    const out = {
      kind: 'ff-tl', channel: 'First Forward', ch: 'ff', name: p.name, id: (src && src.tlId) || p.sub || '', found: !!agents.length,
      mobile: (src && src.tlMobile && !/^na$/i.test(src.tlMobile)) ? src.tlMobile : '', tl: { name: p.name, id: (src && src.tlId) || '', mobile: (src && src.tlMobile) || '' },
      status: (src && src.tlStatus) || '', lastActive: (src && src.tlLastActive) || '', priority: (src && prioOf(src.tlPriority)) || '', commPriority: (src && prioOf(src.tlCommPriority)) || '',
      stock, tlStock: { ...stock, has: true },
      dispatch: { days: suggestDays(), avgVc4, avgComm, cover: src && src.tlVc4Days != null ? Number(src.tlVc4Days) : null, sugVc4: suggest(avgVc4, stock.vc4), sugComm: suggest(avgComm, stock.comm), sumAgentVc4: U.sum(rowsA, (r) => r.sugVc4), sumAgentComm: U.sum(rowsA, (r) => r.sugComm) },
      totals: { curVc4: sumK('curVc4'), curComm: sumK('curNvc4'), curTotal: sumK('curTotal'), lastVc4: sumK('lastVc4'), lastComm: sumK('lastNvc4'), lastTotal: sumK('lastTotal') },
      agents: rowsA, agentCount: agents.length
    };
    if (src && src.tlCurTotal != null) Object.assign(out.totals, { tlCurTotal: num(src.tlCurTotal), tlLastTotal: num(src.tlLastTotal) });
    if (light) return out;
    const ac = rowsOf('agentClass'), agRows = rowsOf('agents'), stk = rowsOf('stockAgents');
    const curYm = latestYm(ac.length ? ac : agRows), lastYm = U.prevMonthKey(curYm);
    out.months = { cur: curYm, last: lastYm };
    out.classes = classTable(ac.filter((r) => norm(r.tlName) === n && (!r.channel || /first/i.test(r.channel))), stk.filter((r) => norm(r.tlName) === n), curYm, lastYm);
    if (!out.classes.length) out.classes = [{ cls: 'VC4', cur: out.totals.curVc4, last: out.totals.lastVc4, stock: stock.vc4 }, { cls: 'Commercial', cur: out.totals.curComm, last: out.totals.lastComm, stock: stock.comm }];
    out.trend = trendOf(agRows, (r) => norm(r.tlName) === n && (!r.channel || /first/i.test(r.channel)), (r) => r.ym);
    out.week = agents.reduce((acc, a) => acc.map((v, i) => v + num((a.week || [])[i])), [0, 0, 0, 0, 0, 0, 0]);
    out.weekLabels = safeCall(() => P.dayLabels && P.dayLabels(), []) || [];
    return out;
  }
  const prioOf = (t) => { const s = clean(t).replace(/[^\w\s]/g, '').toLowerCase(); if (/high|urgent|critical/.test(s)) return 'High'; if (/medium|slight/.test(s)) return 'Medium'; if (/low/.test(s)) return 'Low'; return clean(t); };

  const gvDaily = (r, cur) => (r.curDays ? cur / Math.max(1, r.curDays) : 0);
  function gvClassRows(match, curYm, lastYm) {
    const master = safeCall(() => (FF.gv && FF.gv.rows ? FF.gv.rows() : []), []) || [];
    return master.filter(match).map((r) => ({ ym: r.ym, cls: r.cls, n: 1 }));
  }
  function gvAgentProfile(p, light) {
    const r = findGvAgent(p.name, p.sub);
    const out = { kind: 'gv-agent', channel: 'GV Partner', ch: 'gv', name: p.name, id: (r && r.agentId) || p.sub || '', found: !!r };
    if (r) {
      const avgVc4 = gvDaily(r, r.curVc4), avgComm = gvDaily(r, r.curComm);
      const direct = safeCall(() => FF.config.isDirectAgent(r, 'gv'), false);
      const given = num(r.suggestedDispatch);
      Object.assign(out, {
        mobile: mobileFor(r.agentName, r.agentId, r.mobile), tl: { name: direct ? '' : r.tlName, id: r.tlId, mobile: '' }, status: r.agentStatus || '', lastActive: '', priority: prioOf(r.priority), growth: r.growth != null ? `${r.growth}%` : '',
        direct, directLabel: direct ? FF.config.directLabel(r, 'gv') : '',
        stock: { vc4: num(r.stockVc4), comm: num(r.stockComm), total: num(r.stockTotal) || num(r.stockVc4) + num(r.stockComm) },
        tlStock: { vc4: num(r.tlStockVc4), comm: num(r.tlStockComm), total: num(r.tlStockTotal), has: !direct && (r.tlStockTotal != null) },
        dispatch: { days: suggestDays(), avgVc4, avgComm, cover: avgVc4 > 0 ? num(r.stockVc4) / avgVc4 : null, given, minRequired: num(r.minRequired), sugVc4: given > 0 ? given : suggest(avgVc4, r.stockVc4), sugComm: suggest(avgComm, r.stockComm) },
        totals: { curVc4: num(r.curVc4), curComm: num(r.curComm), curTotal: num(r.curTotal), lastVc4: num(r.lastVc4), lastComm: num(r.lastComm), lastTotal: num(r.lastTotal) }
      });
    } else {
      Object.assign(out, { mobile: '', tl: { name: [...(p.tlSet || [])][0] || '' }, priority: '', direct: !!p.direct, directLabel: p.directLabel || '', stock: { vc4: 0, comm: 0, total: 0 }, tlStock: { has: false }, dispatch: { days: suggestDays(), sugVc4: 0, sugComm: 0 }, totals: {} });
    }
    out.tagRequired = out.direct && isHM(out.priority);
    if (light) return out;
    const n = norm(p.name);
    const master = gvClassRows((m) => norm(m.agentName) === n || (out.id && m.agentId === out.id));
    const curYm = latestYm(master.length ? master : [{ ym: U.ymKey(new Date()) }]), lastYm = U.prevMonthKey(curYm);
    out.months = { cur: curYm, last: lastYm };
    const stockRows = r ? Object.entries(r.stockByClass || {}).filter(([, v]) => v).map(([cls, v]) => ({ cls, n: v })) : [];
    const stockComm = r ? Math.max(0, num(r.stockComm)) : 0;
    out.classes = classTable(master, stockRows, curYm, lastYm);
    if (!out.classes.length && r) out.classes = Object.entries(r.curByClass || {}).map(([cls, cur]) => ({ cls, cur: num(cur), last: 0, stock: num((r.stockByClass || {})[cls]) })).filter((x) => x.cur || x.stock);
    if (!out.classes.length && r) out.classes = [{ cls: 'VC4', cur: num(r.curVc4), last: num(r.lastVc4), stock: num(r.stockVc4) }, { cls: 'Commercial', cur: num(r.curComm), last: num(r.lastComm), stock: stockComm }];
    out.trend = trendOf(master, () => true, (m) => m.ym);
    return out;
  }
  function gvTlProfile(p, light) {
    const n = norm(p.name);
    const list = gvReport().filter((r) => norm(r.tlName) === n && !safeCall(() => FF.config.isDirectAgent(r, 'gv'), false));
    const src = list[0] || null;
    const sumK = (k) => U.sum(list, (r) => num(r[k]));
    const days = Math.max(1, ...list.map((r) => num(r.curDays)), 1);
    const avgVc4 = sumK('curVc4') / days, avgComm = sumK('curComm') / days;
    const stock = src && src.tlStockTotal != null ? { vc4: num(src.tlStockVc4), comm: num(src.tlStockComm), total: num(src.tlStockTotal) } : { vc4: sumK('stockVc4'), comm: sumK('stockComm'), total: sumK('stockTotal') };
    const rowsA = list.map((r) => {
      const av = gvDaily(r, r.curVc4), avc = gvDaily(r, r.curComm);
      return { name: r.agentName, id: r.agentId, mobile: mobileFor(r.agentName, r.agentId, r.mobile), priority: prioOf(r.priority), stockVc4: num(r.stockVc4), stockComm: num(r.stockComm), stockTotal: num(r.stockTotal), cur: num(r.curTotal), last: num(r.lastTotal), curVc4: num(r.curVc4), curComm: num(r.curComm), sugVc4: num(r.suggestedDispatch) > 0 ? num(r.suggestedDispatch) : suggest(av, r.stockVc4), sugComm: suggest(avc, r.stockComm) };
    }).sort((x, y) => y.cur - x.cur);
    const out = {
      kind: 'gv-tl', channel: 'GV Partner', ch: 'gv', name: p.name, id: (src && src.tlId) || p.sub || '', found: !!list.length,
      mobile: '', tl: { name: p.name, id: (src && src.tlId) || '' }, status: '', lastActive: '', priority: '', stock, tlStock: { ...stock, has: true },
      dispatch: { days: suggestDays(), avgVc4, avgComm, cover: avgVc4 > 0 ? stock.vc4 / avgVc4 : null, sugVc4: suggest(avgVc4, stock.vc4), sugComm: suggest(avgComm, stock.comm), sumAgentVc4: U.sum(rowsA, (r) => r.sugVc4), sumAgentComm: U.sum(rowsA, (r) => r.sugComm) },
      totals: { curVc4: sumK('curVc4'), curComm: sumK('curComm'), curTotal: sumK('curTotal'), lastVc4: sumK('lastVc4'), lastComm: sumK('lastComm'), lastTotal: sumK('lastTotal') },
      agents: rowsA, agentCount: list.length
    };
    // TL priority = sabse high agent priority
    out.priority = rowsA.some((r) => r.priority === 'High') ? 'High' : rowsA.some((r) => r.priority === 'Medium') ? 'Medium' : rowsA.length ? 'Low' : '';
    if (light) return out;
    const master = gvClassRows((m) => norm(m.tlName) === n);
    const curYm = latestYm(master.length ? master : [{ ym: U.ymKey(new Date()) }]), lastYm = U.prevMonthKey(curYm);
    out.months = { cur: curYm, last: lastYm };
    const stockRows = [];
    list.forEach((r) => Object.entries(r.stockByClass || {}).forEach(([cls, v]) => { if (v) stockRows.push({ cls, n: v }); }));
    out.classes = classTable(master, stockRows, curYm, lastYm);
    if (!out.classes.length) out.classes = [{ cls: 'VC4', cur: out.totals.curVc4, last: out.totals.lastVc4, stock: stock.vc4 }, { cls: 'Commercial', cur: out.totals.curComm, last: out.totals.lastComm, stock: stock.comm }];
    out.trend = trendOf(master, () => true, (m) => m.ym);
    return out;
  }

  const BUILDERS = { 'ff-agent': ffAgentProfile, 'gv-agent': gvAgentProfile, 'ff-tl': ffTlProfile, 'gv-tl': gvTlProfile };
  const supports = (person) => !!(person && BUILDERS[person.kind]);
  /** Sync (already-loaded data) — light snapshot for suggestion rows / kundli cards. */
  function quick(person) {
    if (!supports(person)) return null;
    const key = `${person.kind}|${norm(person.name)}`;
    if (quickCache.has(key)) return quickCache.get(key);
    let v = null;
    try { v = BUILDERS[person.kind](person, true); } catch { v = null; }
    if (v && v.found) quickCache.set(key, v);
    return v && v.found ? v : null;
  }
  async function build(person) {
    if (!supports(person)) throw new Error('Is type ka profile nahi banta');
    await load();
    return BUILDERS[person.kind](person, false);
  }

  // ------------------------------------------------------------------ html
  const prioChip = (p) => (p ? `<span class="badge ${/high/i.test(p) ? 'red' : /medium/i.test(p) ? 'amber' : 'green'}">${esc(p)}</span>` : '<span class="dim">—</span>');
  const tagChip = (n) => `<b class="sug-chip direct">🏷️ ${fmt(n)} tags</b>`;
  const mobileCell = (m) => (!canContacts() ? '<span class="dim">🔒</span>' : m ? `<a href="tel:${esc(m)}">📞 ${esc(m)}</a>` : '<span class="dim">—</span>');
  const kpi = (label, value, foot, tone) => `<div class="mp-kpi ${tone || ''}"><small>${esc(label)}</small><b>${value}</b>${foot ? `<em>${foot}</em>` : ''}</div>`;
  const cell = (label, value) => `<div><small>${esc(label)}</small><b>${value}</b></div>`;

  function sugBlock(pr) {
    const d = pr.dispatch || {};
    const isTl = /tl$/.test(pr.kind);
    if (pr.tagRequired) {
      return { vc4: tagChip(d.sugVc4), comm: tagChip(d.sugComm), note: `🏷️ <b>TAG REQUIRED</b> — ${esc(pr.directLabel || 'Direct agent')} · stock box nahi jaata, par ${esc(pr.priority)} priority hai to tags chahiye.` };
    }
    if (pr.direct) return { vc4: '<span class="dim">No dispatch</span>', comm: '<span class="dim">No dispatch</span>', note: `🚫 ${esc(pr.directLabel || 'Direct agent')} — priority ${esc(pr.priority || 'Low')}: abhi dispatch / tags ki zarurat nahi.` };
    return { vc4: `<b class="sug-chip">${fmt(d.sugVc4)}</b>`, comm: `<b class="sug-chip">${fmt(d.sugComm)}</b>`, note: isTl ? `TL-level = TL avg/day × ${d.days} − TL stock · agents ke suggestions ka jod: VC4 <b>${fmt(d.sumAgentVc4)}</b> · Commercial <b>${fmt(d.sumAgentComm)}</b>` : `Suggested = avg/day × ${d.days} din − stock${d.given ? ' (VC4: sheet ka Suggested Dispatch Qty)' : ''}` };
  }

  function chartsHtml(pr) {
    const C = FF.charts;
    if (!C) return '';
    const cls = (pr.classes || []).filter((r) => r.cur || r.last || r.stock);
    const m = pr.months || {};
    const blocks = [];
    const donutItems = cls.filter((r) => r.cur > 0).map((r) => ({ label: r.cls, value: r.cur }));
    if (donutItems.length) blocks.push(`<div class="mp-chart"><h4>🎨 Class-wise issuance (this month)</h4>${C.donut({ items: donutItems, subtitle: 'issued', size: 150 })}</div>`);
    if (cls.length) blocks.push(`<div class="mp-chart"><h4>📊 Last vs this month · class-wise</h4>${C.bars({ labels: cls.map((r) => r.cls), height: 170, series: [{ name: monthLabel(m.last) || 'Last', values: cls.map((r) => r.last), color: '#c7d2fe' }, { name: monthLabel(m.cur) || 'This', values: cls.map((r) => r.cur), color: '#6366f1' }], showValues: true })}</div>`);
    const stockItems = cls.filter((r) => r.stock > 0).map((r) => ({ label: r.cls, value: r.stock }));
    if (stockItems.length) blocks.push(`<div class="mp-chart"><h4>📦 Stock by class</h4>${C.donut({ items: stockItems, subtitle: 'stock', size: 150 })}</div>`);
    if (pr.trend && pr.trend.length > 1) blocks.push(`<div class="mp-chart"><h4>📈 Monthly trend</h4>${C.bars({ labels: pr.trend.map((t) => monthLabel(t.ym)), height: 170, series: [{ name: 'Issued', values: pr.trend.map((t) => t.n), color: '#10b981' }], showValues: true })}</div>`);
    if (pr.week && pr.week.some((v) => v > 0)) blocks.push(`<div class="mp-chart"><h4>🗓️ Last 7 days</h4>${C.bars({ labels: (pr.weekLabels && pr.weekLabels.length === pr.week.length ? pr.weekLabels : pr.week.map((_, i) => `D${i + 1}`)), height: 170, series: [{ name: 'Issued', values: pr.week, color: '#f59e0b' }], showValues: true })}</div>`);
    if (pr.agents && pr.agents.length) {
      blocks.push(`<div class="mp-chart wide"><h4>🧑‍💼 Agent-wise issuance (this month vs last)</h4>${C.hbars({ items: pr.agents.slice(0, 12).map((a) => ({ label: a.name, sub: a.priority || '', value: a.cur, compare: a.last })), valueLabel: 'This month', compareLabel: 'Last month' })}</div>`);
      blocks.push(`<div class="mp-chart wide"><h4>📦 Agent-wise stock (VC4 / Commercial)</h4>${C.hbars({ items: [...pr.agents].sort((x, y) => y.stockTotal - x.stockTotal).slice(0, 12).map((a) => ({ label: a.name, sub: `VC4 ${fmt(a.stockVc4)} · Comm ${fmt(a.stockComm)}`, value: a.stockTotal })), valueLabel: 'Stock' })}</div>`);
    }
    return blocks.length ? `<div class="mp-charts">${blocks.join('')}</div>` : '';
  }

  function html(pr) {
    if (!pr) return '';
    const isTl = /tl$/.test(pr.kind);
    const d = pr.dispatch || {}, s = pr.stock || {}, t = pr.totals || {}, ts = pr.tlStock || {};
    const sg = sugBlock(pr);
    const m = pr.months || {};
    const cls = pr.classes || [];
    const g = groupSummary(cls);
    const noData = !pr.found ? `<div class="ms-empty small"><b>REPORT me is ${isTl ? 'TL' : 'agent'} ki row nahi mili</b><p class="dim">Performance / GV REPORT tab load hone ke baad poori profile aayegi (naam spelling bhi match honi chahiye).</p></div>` : '';
    const head = `<div class="mp-head">
      <span class="ms-avatar">${esc(pr.name.slice(0, 1).toUpperCase())}</span>
      <div class="mp-id"><b>${esc(pr.name)}</b><small>${esc(pr.channel)} · ${isTl ? 'Team Leader' : 'Agent'}${pr.id ? ` · ID ${esc(pr.id)}` : ''}${pr.direct ? ` · <span class="direct-chip">🚫 ${esc(pr.directLabel || 'Direct')}</span>` : ''}</small></div>
      <div class="mp-prio">${prioChip(pr.priority)}${pr.commPriority ? `<small class="dim">Comm: ${esc(pr.commPriority)}</small>` : ''}</div>
    </div>
    <div class="mp-cells">
      ${cell(isTl ? 'TL mobile' : 'Mobile', mobileCell(pr.mobile))}
      ${isTl ? cell('Agents', `${fmt(pr.agentCount)}`) : cell('TL', pr.direct ? `<span class="direct-chip">🚫 ${esc(pr.directLabel || 'Direct')}</span>` : esc((pr.tl && pr.tl.name) || '—'))}
      ${isTl ? '' : cell('TL ID', esc((pr.tl && pr.tl.id) || '—'))}
      ${isTl ? '' : cell("TL's mobile", mobileCell(pr.tl && pr.tl.mobile))}
      ${cell('Status', esc(pr.status || '—'))}
      ${cell('Last active', esc(pr.lastActive || '—'))}
      ${cell('Growth', esc(pr.growth || '—'))}
    </div>`;
    const kpis = `<div class="mp-kpis">
      ${kpi(isTl ? 'TL stock (total)' : 'Agent stock', fmt(s.total), `VC4 ${fmt(s.vc4)} · Commercial ${fmt(s.comm)}`, 'k1')}
      ${isTl ? '' : kpi('TL stock', ts.has ? fmt(ts.total) : '—', ts.has ? `VC4 ${fmt(ts.vc4)} · Comm ${fmt(ts.comm)}` : (pr.direct ? 'Direct — koi TL nahi' : ''), 'k2')}
      ${kpi('Dispatch priority', prioChip(pr.priority), d.cover != null ? `Cover ${fmt(d.cover, true)} din` : '', 'k3')}
      ${kpi(pr.tagRequired ? 'Tags required · VC4' : 'Suggested VC4', sg.vc4, `avg ${fmt(d.avgVc4, true)}/day × ${d.days} din`, pr.tagRequired ? 'k7' : 'k4')}
      ${kpi(pr.tagRequired ? 'Tags required · Comm.' : 'Suggested Commercial', sg.comm, `avg ${fmt(d.avgComm, true)}/day`, pr.tagRequired ? 'k7' : 'k5')}
      ${kpi('Issued this month', fmt(t.curTotal), `VC4 ${fmt(t.curVc4)} · Comm ${fmt(t.curComm)}`, 'k6')}
      ${kpi('Issued last month', fmt(t.lastTotal), `VC4 ${fmt(t.lastVc4)} · Comm ${fmt(t.lastComm)}`, 'k8')}
    </div>
    <p class="mp-note ${pr.tagRequired ? 'tag' : ''}">${sg.note}</p>`;
    const summary = `<table class="tbl compact mp-summary"><thead><tr><th></th><th class="num">${esc(monthLabel(m.last) || 'Last month')}</th><th class="num">${esc(monthLabel(m.cur) || 'This month')}</th><th class="num">Stock</th></tr></thead><tbody>
      <tr><td><b>VC4</b></td><td class="num">${fmt(g.vc4.last)}</td><td class="num">${fmt(g.vc4.cur)}</td><td class="num">${fmt(g.vc4.stock)}</td></tr>
      <tr><td><b>Commercial</b><small class="cell-sub">VC20 · VC5+ …</small></td><td class="num">${fmt(g.comm.last)}</td><td class="num">${fmt(g.comm.cur)}</td><td class="num">${fmt(g.comm.stock)}</td></tr>
      </tbody><tfoot><tr class="row-total"><td>Total issuance</td><td class="num">${fmt(g.total.last)}</td><td class="num">${fmt(g.total.cur)}</td><td class="num">${fmt(g.total.stock)}</td></tr></tfoot></table>`;
    const clsTable = cls.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">${esc(monthLabel(m.last) || 'Last month')}</th><th class="num">${esc(monthLabel(m.cur) || 'This month')}</th><th class="num">Growth</th><th class="num">Stock</th></tr></thead><tbody>
      ${cls.map((r) => `<tr><td><b>${esc(r.cls)}</b></td><td class="num">${fmt(r.last)}</td><td class="num">${fmt(r.cur)}</td><td class="num">${r.last ? `${r.cur >= r.last ? '▲' : '▼'} ${fmt(Math.abs((r.cur - r.last) / r.last) * 100, true)}%` : '—'}</td><td class="num">${fmt(r.stock)}</td></tr>`).join('')}
      </tbody><tfoot><tr class="row-total"><td>Total</td><td class="num">${fmt(g.total.last)}</td><td class="num">${fmt(g.total.cur)}</td><td></td><td class="num">${fmt(g.total.stock)}</td></tr></tfoot></table></div>` : '<p class="dim small">Class-wise data abhi load nahi hua.</p>';
    const agentsTable = isTl && pr.agents && pr.agents.length ? `<section class="mp-sec"><h4>🧑‍💼 TL ke agents · ${fmt(pr.agents.length)}</h4><div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th>Mobile</th><th>Priority</th><th class="num">VC4 stock</th><th class="num">Comm stock</th><th class="num">Last</th><th class="num">This month</th><th class="num">Sug. VC4</th><th class="num">Sug. Comm</th></tr></thead><tbody>
      ${pr.agents.slice(0, 200).map((a) => `<tr class="clickable" data-mp-agent="${esc(a.name)}" data-mp-kind="${pr.ch}-agent" data-mp-id="${esc(a.id || '')}"><td><b>${esc(a.name)}</b><small class="cell-sub">${esc(a.id || '')}</small></td><td>${mobileCell(a.mobile)}</td><td>${prioChip(a.priority)}</td><td class="num">${fmt(a.stockVc4)}</td><td class="num">${fmt(a.stockComm)}</td><td class="num">${fmt(a.last)}</td><td class="num">${fmt(a.cur)}</td><td class="num"><b class="sug-chip">${fmt(a.sugVc4)}</b></td><td class="num"><b class="sug-chip">${fmt(a.sugComm)}</b></td></tr>`).join('')}
      </tbody><tfoot><tr class="row-total"><td colspan="3">TL total</td><td class="num">${fmt(U.sum(pr.agents, (a) => a.stockVc4))}</td><td class="num">${fmt(U.sum(pr.agents, (a) => a.stockComm))}</td><td class="num">${fmt(U.sum(pr.agents, (a) => a.last))}</td><td class="num">${fmt(U.sum(pr.agents, (a) => a.cur))}</td><td class="num">${fmt(d.sumAgentVc4)}</td><td class="num">${fmt(d.sumAgentComm)}</td></tr></tfoot></table></div></section>` : '';
    const actions = `<div class="mp-actions"><button class="btn small" data-mp-csv>⬇ CSV</button><button class="btn small" data-mp-wa>📲 WhatsApp</button>${isTl ? '' : `<button class="btn small" data-mp-a360="${esc(pr.name)}">👁 Agent 360</button>`}<a class="btn small" href="#/masterStock?q=${encodeURIComponent(pr.name)}">🗄️ Register / tags</a></div>`;
    return `<div class="mp">${noData}${head}${kpis}
      <section class="mp-sec"><h4>🧾 Issuance summary${isTl ? ' — TL total' : ''}</h4>${summary}</section>
      <section class="mp-sec"><h4>🎯 Issuance class-wise · last month vs this month + stock</h4>${clsTable}</section>
      ${agentsTable}
      <section class="mp-sec"><h4>📊 Charts</h4>${chartsHtml(pr) || '<p class="dim small">Chart ke liye data nahi mila.</p>'}</section>
      ${actions}</div>`;
  }

  // ------------------------------------------------------------------ export / share
  function csvRows(pr) {
    const d = pr.dispatch || {}, s = pr.stock || {}, t = pr.totals || {}, ts = pr.tlStock || {};
    const rows = [['Name', pr.name], ['Type', `${pr.channel} ${/tl$/.test(pr.kind) ? 'TL' : 'Agent'}`], ['ID', pr.id], ['Mobile', canContacts() ? pr.mobile : ''], ['TL', (pr.tl && pr.tl.name) || ''], ['TL ID', (pr.tl && pr.tl.id) || ''], ["TL's mobile", canContacts() ? (pr.tl && pr.tl.mobile) || '' : ''],
      ['Status', pr.status], ['Last active', pr.lastActive], ['Priority', pr.priority], ['Direct agent', pr.direct ? pr.directLabel : 'No'], ['Tag required', pr.tagRequired ? 'YES' : 'No'],
      ['Stock VC4', s.vc4], ['Stock Commercial', s.comm], ['Stock total', s.total], ['TL stock total', ts.has ? ts.total : ''],
      ['Avg VC4/day', d.avgVc4], ['Suggested VC4' + (pr.tagRequired ? ' (tags)' : ''), d.sugVc4], ['Suggested Commercial' + (pr.tagRequired ? ' (tags)' : ''), d.sugComm],
      ['Issued this month', t.curTotal], ['Issued last month', t.lastTotal], ['', ''], ['Class', `${(pr.months || {}).last || 'Last'} | ${(pr.months || {}).cur || 'This'} | Stock`]];
    (pr.classes || []).forEach((r) => rows.push([r.cls, r.last, r.cur, r.stock]));
    if (pr.agents && pr.agents.length) { rows.push(['', '']); rows.push(['Agent', 'ID', 'Mobile', 'Priority', 'VC4 stock', 'Comm stock', 'Last', 'This', 'Sug VC4', 'Sug Comm']); pr.agents.forEach((a) => rows.push([a.name, a.id, canContacts() ? a.mobile : '', a.priority, a.stockVc4, a.stockComm, a.last, a.cur, a.sugVc4, a.sugComm])); }
    return rows;
  }
  function waText(pr) {
    const d = pr.dispatch || {}, s = pr.stock || {}, t = pr.totals || {};
    const lines = [`*${pr.name}* (${pr.channel} ${/tl$/.test(pr.kind) ? 'TL' : 'Agent'}${pr.id ? ` · ${pr.id}` : ''})`];
    if (canContacts() && pr.mobile) lines.push(`📞 ${pr.mobile}`);
    if (!/tl$/.test(pr.kind) && pr.tl && pr.tl.name && !pr.direct) lines.push(`TL: ${pr.tl.name}`);
    lines.push(`Priority: ${pr.priority || '—'}${pr.tagRequired ? ' · 🏷️ TAG REQUIRED' : ''}`);
    lines.push(`Stock: ${U.fmt(s.total)} (VC4 ${U.fmt(s.vc4)} · Comm ${U.fmt(s.comm)})`);
    lines.push(`${pr.tagRequired ? 'Tags needed' : 'Suggested dispatch'}: VC4 ${U.fmt(d.sugVc4)} · Comm ${U.fmt(d.sugComm)}`);
    lines.push(`Issued: this month ${U.fmt(t.curTotal)} · last month ${U.fmt(t.lastTotal)}`);
    (pr.classes || []).slice(0, 8).forEach((r) => lines.push(`• ${r.cls}: ${U.fmt(r.last)} → ${U.fmt(r.cur)} (stock ${U.fmt(r.stock)})`));
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ mount helpers
  function bind(el, pr) {
    el.__mpProfile = pr;
    if (el.__mpBound) return;
    el.__mpBound = true;
    el.addEventListener('click', (e) => {
      const cur = el.__mpProfile;
      if (!cur) return;
      if (e.target.closest('[data-mp-csv]')) { U.downloadCsv(`profile-${U.slug(cur.name)}-${U.stamp()}.csv`, ['Field', 'Value / Last', 'This', 'Stock'], csvRows(cur).map((r) => [r[0], r[1], r[2] ?? '', r[3] ?? ''])); return; }
      if (e.target.closest('[data-mp-wa]')) { const link = U.waLink ? U.waLink(waText(cur)) : ''; if (link) window.open(link, '_blank', 'noopener'); return; }
      const a360 = e.target.closest('[data-mp-a360]');
      if (a360) { if (FF.cockpit && FF.cockpit.agent360) FF.cockpit.agent360({ name: a360.dataset.mpA360 }).catch(() => {}); return; }
      const row = e.target.closest('[data-mp-agent]');
      if (row) { open({ kind: row.dataset.mpKind, name: row.dataset.mpAgent, sub: row.dataset.mpId, tlSet: new Set(), classMap: new Map(), bars: new Set() }); }
    });
  }
  const loadingHtml = (name) => `<div class="mp-loading"><span class="spinner"></span> <b>${esc(name)}</b> ki poori report ban rahi hai… (REPORT + stock + issuance load ho raha hai)</div>`;
  /** Inline (home / panel) — placeholder pehle, data aane par full profile. */
  async function renderInto(el, person) {
    if (!el || !supports(person)) return null;
    el.innerHTML = loadingHtml(person.name);
    try {
      const pr = await build(person);
      el.innerHTML = html(pr);
      if (FF.charts && FF.charts.mount) FF.charts.mount(el);
      bind(el, pr);
      return pr;
    } catch (err) {
      el.innerHTML = `<div class="ms-empty small"><b>Profile nahi ban payi</b><p class="dim">${esc(err && err.message || err)}</p></div>`;
      return null;
    }
  }
  /** Drawer — suggestion pick par. */
  async function open(person) {
    if (!supports(person) || !FF.app || !FF.app.openDrawer) return null;
    const kicker = `🔎 Master search · ${person.kind.endsWith('tl') ? 'TL' : 'Agent'} profile`;
    FF.app.openDrawer({ kicker, title: person.name, sub: esc(person.sub ? `ID ${person.sub}` : ''), body: `<div id="mp-drawer-slot">${loadingHtml(person.name)}</div>`, actions: '', wide: true });
    const slot = U.$('#mp-drawer-slot');
    try {
      const pr = await build(person);
      const body = U.$('#drawer-body');
      if (!body) return pr;
      body.innerHTML = html(pr);
      if (FF.charts && FF.charts.mount) FF.charts.mount(body);
      bind(body, pr);
      return pr;
    } catch (err) {
      if (slot) slot.innerHTML = `<div class="ms-empty small"><b>Profile nahi ban payi</b><p class="dim">${esc(err && err.message || err)}</p></div>`;
      return null;
    }
  }

  FF.masterProfile = { supports, quick, build, html, csvRows, waText, renderInto, open, warm, load, suggest, findFfAgent, findGvAgent, mobileFor, get suggestDays() { return suggestDays(); } };
})(window.FF);
