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
  /** Net = avg/day × din − stock (stock ghatane ke baad). */
  const suggest = (avg, stock) => Math.max(0, Math.ceil((Number(avg) || 0) * suggestDays() - (Number(stock) || 0)));
  /** Gross = avg/day × din (bina stock ghataye — pure run-rate requirement). */
  const suggestGro = (avg) => Math.max(0, Math.ceil((Number(avg) || 0) * suggestDays()));
  const sugMode = () => (U.suggestMode ? U.suggestMode() : 'both');
  const canContacts = () => { try { return !FF.auth || FF.auth.can('contacts'); } catch { return true; } };
  const perf = () => (FF.pages && FF.pages.performance) || null;
  const safeCall = (fn, fb) => { try { const v = fn(); return v === undefined ? fb : v; } catch { return fb; } };
  const safeAsync = async (fn) => { try { return await fn(); } catch { return null; } };
  const rowsOf = (key) => safeCall(() => FF.store && FF.store.get && FF.store.get(key), null) || [];
  const gvOn = () => !!(FF.gv && safeCall(() => (FF.gv.enabled ? FF.gv.enabled() : true), true));
  const gvRows = (key) => safeCall(() => (FF.gv && FF.gv.get && FF.gv.get(key)), null) || [];
  // Some older host adapters replace only GV.rows while the canonical adapter is unavailable.
  // Treat that explicit adapter override as a compatibility source; the live dashboard keeps
  // G.rows === G.masterRows and therefore always takes EIR issuanceRows below.
  const gvHasRowsAdapterOverride = () => {
    const g = FF.gv || {};
    return typeof g.rows === 'function' && typeof g.masterRows === 'function' && g.rows !== g.masterRows;
  };
  const gvIssuanceRows = () => {
    const g = FF.gv || {};
    if (gvHasRowsAdapterOverride()) return safeCall(() => g.rows(), []) || [];
    if (typeof g.issuanceRows === 'function') return safeCall(() => g.issuanceRows(), []) || [];
    return typeof g.rows === 'function' ? (safeCall(() => g.rows(), []) || []) : [];
  };
  // The real GV adapter's issuanceRows() is EIR-authoritative (with today's live GV Master rows).
  // Older test/host adapters that replace only rows() expose a compatibility snapshot, not exact
  // per-month issuance, so do not let that partial view overwrite GV REPORT summary totals.
  const gvCanonicalIssuanceRows = () => {
    const g = FF.gv || {};
    if (gvHasRowsAdapterOverride() || typeof g.issuanceRows !== 'function') return [];
    return safeCall(() => g.issuanceRows(), []) || [];
  };
  const CLS_ORDER = ['VC4', 'VC20', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16', 'VC5+'];
  const clsRank = (c) => { const i = CLS_ORDER.indexOf(String(c).toUpperCase()); return i < 0 ? 99 : i; };
  const is4 = (c) => /^VC\s*4$/i.test(String(c || '').trim());
  const monthLabel = (ym) => { try { return U.labelYM(ym); } catch { return String(ym || ''); } };
  const num = (v) => Number(v) || 0;
  /** Sheet ka "▲ +12.5%" / "▼ 8%" text → number (sign included). */
  function pctText(value) {
    if (value === null || value === undefined || value === '') return null;
    const m = String(value).match(/[-+]?\d+(?:\.\d+)?/);
    if (!m) return null;
    let n = Number(m[0]);
    if (/▼/.test(String(value)) && n > 0) n = -n;
    return Number.isFinite(n) ? n : null;
  }
  /** 📅 Channel basis — FF: data kal aata hai (aaj−1 din) · GV: live aaj. Isi par run-rate / projection. */
  const basis = (ch) => (U.channelBasis
    ? U.channelBasis(ch, { force: true })
    : (U.reportBasis ? U.reportBasis({ force: true }) : { day: U.runRateDays(), days: U.runRateDays(), label: '', back: 1, shortLabel: '' }));
  /** Growth % (sheet ka apna, warna totals se) + month-end projection us channel ke basis par. */
  function growthBlock(o, totals, ym, ch) {
    const b = basis(ch);
    const t = totals || {};
    const sheet = pctText(o.growth);
    const g = sheet !== null ? sheet : U.growth(num(t.curTotal), num(t.lastTotal));
    const proj = (k) => U.projectMonthEnd(t[k], b.days, ym);
    return {
      text: o.growth || (g === null ? '' : `${g >= 0 ? '▲ +' : '▼ '}${Math.abs(g).toFixed(1)}%`),
      num: g, basis: b,
      cur: num(t.curTotal), last: num(t.lastTotal),
      projected: proj('curTotal'), projectedVc4: proj('curVc4'), projectedComm: proj('curComm'),
      // Sheet ka apna projected (REPORT) — hamare recompute se compare karne ke liye rakhte hain.
      sheetProjected: num(o.projected) || num(o.curProjected) || num(o.tlProjected)
    };
  }
  /** out par growth + month-end projection lagao (agent aur TL, dono channels). */
  function attachGrowth(out, src, ym) {
    const gi = growthBlock(src || {}, out.totals, ym, out.ch);
    out.growth = gi.text;
    out.growthNum = gi.num;
    out.projT1 = { num: gi.num, total: gi.projected, vc4: gi.projectedVc4, comm: gi.projectedComm, sheet: gi.sheetProjected, days: gi.basis.days, basis: gi.basis };
    return gi;
  }

  // ------------------------------------------------------------------ loading
  let warmPromise = null;
  async function load() {
    const P = perf();
    const jobs = [];
    if (P && P.ensureLoaded) jobs.push(safeAsync(() => P.ensureLoaded()));
    ['daily', 'agentClass', 'agents', 'stockAgents'].forEach((k) => { if (FF.store && FF.store.need) jobs.push(safeAsync(() => FF.store.need(k))); });
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
  /** Exact GV month totals are only authoritative for months with actual issuance rows. */
  function exactGvMonth(rows, ym) {
    if (!ym) return null;
    const monthRows = (rows || []).filter((r) => r && r.ym === ym);
    if (!monthRows.length) return null;
    const out = { vc4: 0, comm: 0, total: 0 };
    monthRows.forEach((r) => {
      const raw = r.n;
      const qty = raw === '' || raw === null || raw === undefined ? 1 : Math.max(0, num(raw));
      if (is4(r.cls)) out.vc4 += qty;
      else out.comm += qty;
      out.total += qty;
    });
    return out;
  }
  function setExactGvMonth(totals, rows, ym, prefix) {
    const exact = exactGvMonth(rows, ym);
    if (!exact) return false;
    totals[`${prefix}Vc4`] = exact.vc4;
    totals[`${prefix}Comm`] = exact.comm;
    totals[`${prefix}Total`] = exact.total;
    return true;
  }
  const sameGvAgent = (row, agent) => {
    const rowId = clean(row && (row.agentId || row.id)).toUpperCase();
    const agentId = clean(agent && (agent.agentId || agent.id)).toUpperCase();
    if (rowId && agentId) return rowId === agentId;
    return norm(row && (row.agentName || row.name)) === norm(agent && (agent.agentName || agent.name));
  };
  function applyExactGvAgentMonths(agentRows, issuanceRows, curYm, lastYm) {
    const curExists = !!exactGvMonth(issuanceRows, curYm);
    const lastExists = !!exactGvMonth(issuanceRows, lastYm);
    if (!curExists && !lastExists) return;
    agentRows.forEach((agent) => {
      const issued = issuanceRows.filter((r) => sameGvAgent(r, agent));
      if (curExists) {
        const x = exactGvMonth(issued, curYm) || { vc4: 0, comm: 0, total: 0 };
        Object.assign(agent, { curVc4: x.vc4, curComm: x.comm, curTotal: x.total });
      }
      if (lastExists) {
        const x = exactGvMonth(issued, lastYm) || { vc4: 0, comm: 0, total: 0 };
        Object.assign(agent, { lastVc4: x.vc4, lastComm: x.comm, lastTotal: x.total });
      }
    });
  }
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
        const out = { kind: 'ff-agent', channel: 'First Forward', ch: 'ff', name: p.name, id: (a && (a.agentId || a.id)) || p.sub || '', found: !!a };
    const ac = rowsOf('agentClass'), agRows = rowsOf('agents'), stk = rowsOf('stockAgents');
    const n = norm(p.name);
    if (a) {
      const avgVc4 = U.runRate(a.curVc4, 'ff'), avgNvc4 = U.runRate(a.curNvc4, 'ff');
      Object.assign(out, {
        mobile: mobileFor(a.name, a.agentId || a.id, a.mobile), tl: { name: a.tlName, id: a.tlId, mobile: a.tlMobile },
        status: a.agentStatus || '', lastActive: a.lastActive || '', priority: a.priority || '', growth: a.growth || '',
        direct: !!a.tlExcluded, directLabel: a.tlExcluded ? FF.config.directLabel(a, 'ff') : '',
        stock: { vc4: num(a.stockVc4), comm: num(a.stockNvc4), total: num(a.stockTotal) || num(a.stockVc4) + num(a.stockNvc4) },
        tlStock: { vc4: num(a.tlStockVc4), comm: num(a.tlStockNvc4), total: num(a.tlStockTotal), has: a.tlStockTotal != null || a.tlStockVc4 != null },
        dispatch: { days: suggestDays(), avgVc4, avgComm: avgNvc4, cover: avgVc4 > 0 ? num(a.stockVc4) / avgVc4 : null, sugVc4: suggest(avgVc4, a.stockVc4), sugComm: suggest(avgNvc4, a.stockNvc4), sugVc4Gross: suggestGro(avgVc4), sugCommGross: suggestGro(avgNvc4) },
        totals: { curVc4: num(a.curVc4), curComm: num(a.curNvc4), curTotal: num(a.curTotal), lastVc4: num(a.lastVc4), lastComm: num(a.lastNvc4), lastTotal: num(a.lastTotal) },
        week: a.week || [], weekLabels: safeCall(() => P.dayLabels && P.dayLabels(), []) || []
      });
    } else {
      Object.assign(out, { mobile: mobileFor(p.name, p.sub, ''), tl: { name: [...(p.tlSet || [])][0] || '' }, priority: '', direct: !!p.direct, directLabel: p.directLabel || '', stock: { vc4: 0, comm: 0, total: 0 }, tlStock: { has: false }, dispatch: { days: suggestDays(), sugVc4: 0, sugComm: 0, sugVc4Gross: 0, sugCommGross: 0 }, totals: {} });
    }
    out.tagRequired = out.direct && isHM(out.priority);
    attachGrowth(out, a || {}, latestYm(ac.length ? ac : agRows));
    if (light) return out;
    const curYm = latestYm(ac.length ? ac : agRows), lastYm = U.prevMonthKey(curYm);
    const isMine = (r) => norm(r.name) === n && (!r.channel || /first/i.test(r.channel));
    out.months = { cur: curYm, last: lastYm };
    out.classes = classTable(ac.filter(isMine), stk.filter((r) => norm(r.agentName) === n), curYm, lastYm);
    if (!out.classes.length && a) out.classes = [{ cls: 'VC4', cur: num(a.curVc4), last: num(a.lastVc4), stock: num(a.stockVc4) }, { cls: 'Commercial', cur: num(a.curNvc4), last: num(a.lastNvc4), stock: num(a.stockNvc4) }];
    else if (out.classes.length && rowsOf('daily').length) {
      // Only replace the REPORT snapshot once the canonical EIR daily view is loaded. Some
      // lightweight callers provide a partial class fixture without daily EIR context; keep those
      // callers' REPORT totals rather than inventing a partial profile total.
      const exactTotals = groupSummary(out.classes);
      Object.assign(out.totals, { curVc4: exactTotals.vc4.cur, curComm: exactTotals.comm.cur, curTotal: exactTotals.total.cur, lastVc4: exactTotals.vc4.last, lastComm: exactTotals.comm.last, lastTotal: exactTotals.total.last });
    }
    out.trend = trendOf(agRows, (r) => norm(r.name) === n && (!r.channel || /first/i.test(r.channel)), (r) => r.ym);
    return out;
  }

  function ffTlProfile(p, light) {
    const n = norm(p.name);
    const agents = ffAgents().filter((a) => !a.tlExcluded && norm(a.tlName) === n);
    const src = agents.find((a) => a.tlStockTotal != null) || agents[0] || null;
    const P = perf();
        const sumK = (k) => U.sum(agents, (a) => num(a[k]));
    const avgVc4 = U.runRate(sumK('curVc4'), 'ff'), avgComm = U.runRate(sumK('curNvc4'), 'ff');
    const stock = src && src.tlStockTotal != null
      ? { vc4: num(src.tlStockVc4), comm: num(src.tlStockNvc4), total: num(src.tlStockTotal) }
      : { vc4: sumK('stockVc4'), comm: sumK('stockNvc4'), total: sumK('stockTotal') };
    const rowsA = agents.map((a) => {
      const av = U.runRate(a.curVc4, 'ff'), avc = U.runRate(a.curNvc4, 'ff');
      return { name: a.name, id: a.agentId || a.id, mobile: mobileFor(a.name, a.agentId || a.id, a.mobile), priority: a.priority || '', stockVc4: num(a.stockVc4), stockComm: num(a.stockNvc4), stockTotal: num(a.stockTotal), cur: num(a.curTotal), last: num(a.lastTotal), curVc4: num(a.curVc4), curComm: num(a.curNvc4), sugVc4: suggest(av, a.stockVc4), sugComm: suggest(avc, a.stockNvc4), sugVc4Gross: suggestGro(av), sugCommGross: suggestGro(avc) };
    }).sort((x, y) => y.cur - x.cur);
    const ac = rowsOf('agentClass'), agRows = rowsOf('agents'), stk = rowsOf('stockAgents');
    const curYm = latestYm(ac.length ? ac : agRows), lastYm = U.prevMonthKey(curYm);
    const out = {
      kind: 'ff-tl', channel: 'First Forward', ch: 'ff', name: p.name, id: (src && src.tlId) || p.sub || '', found: !!agents.length,
      mobile: (src && src.tlMobile && !/^na$/i.test(src.tlMobile)) ? src.tlMobile : '', tl: { name: p.name, id: (src && src.tlId) || '', mobile: (src && src.tlMobile) || '' },
      status: (src && src.tlStatus) || '', lastActive: (src && src.tlLastActive) || '', priority: (src && prioOf(src.tlPriority)) || '', commPriority: (src && prioOf(src.tlCommPriority)) || '',
      stock, tlStock: { ...stock, has: true },
      dispatch: { days: suggestDays(), avgVc4, avgComm, cover: avgVc4 > 0 ? stock.vc4 / avgVc4 : null, sugVc4: suggest(avgVc4, stock.vc4), sugComm: suggest(avgComm, stock.comm), sugVc4Gross: suggestGro(avgVc4), sugCommGross: suggestGro(avgComm), sumAgentVc4: U.sum(rowsA, (r) => r.sugVc4), sumAgentComm: U.sum(rowsA, (r) => r.sugComm), sumAgentVc4Gross: U.sum(rowsA, (r) => r.sugVc4Gross), sumAgentCommGross: U.sum(rowsA, (r) => r.sugCommGross) },
      totals: { curVc4: sumK('curVc4'), curComm: sumK('curNvc4'), curTotal: sumK('curTotal'), lastVc4: sumK('lastVc4'), lastComm: sumK('lastNvc4'), lastTotal: sumK('lastTotal') },
      agents: rowsA, agentCount: agents.length
    };
    // Issuance totals already come from the corrected Performance/EIR path above. Keep REPORT's
    // TL snapshot out of the profile totals so the drawer cannot reintroduce the old mismatch.
    // 📈 TL growth % — REPORT tab ka apna "TL Performance Status · Percent"; expected month-end bhi saath.
    attachGrowth(out, { growth: (src && src.tlGrowth) || '', projected: src && src.tlProjected }, curYm);
    if (light) return out;
    out.months = { cur: curYm, last: lastYm };
    out.classes = classTable(ac.filter((r) => norm(r.tlName) === n && (!r.channel || /first/i.test(r.channel))), stk.filter((r) => norm(r.tlName) === n), curYm, lastYm);
    if (!out.classes.length) out.classes = [{ cls: 'VC4', cur: out.totals.curVc4, last: out.totals.lastVc4, stock: stock.vc4 }, { cls: 'Commercial', cur: out.totals.curComm, last: out.totals.lastComm, stock: stock.comm }];
    else if (rowsOf('daily').length) {
      // The class table is the same EIR source used by the clicked drill-down. Use its rollup for
      // TL KPIs once the canonical daily EIR view is present, so a stale REPORT TL total cannot
      // reappear above an exact class total.
      const exactTotals = groupSummary(out.classes);
      Object.assign(out.totals, { curVc4: exactTotals.vc4.cur, curComm: exactTotals.comm.cur, curTotal: exactTotals.total.cur, lastVc4: exactTotals.vc4.last, lastComm: exactTotals.comm.last, lastTotal: exactTotals.total.last });
    }
    out.trend = trendOf(agRows, (r) => norm(r.tlName) === n && (!r.channel || /first/i.test(r.channel)), (r) => r.ym);
    out.week = agents.reduce((acc, a) => acc.map((v, i) => v + num((a.week || [])[i])), [0, 0, 0, 0, 0, 0, 0]);
    out.weekLabels = safeCall(() => P.dayLabels && P.dayLabels(), []) || [];
    return out;
  }
  const prioOf = (t) => { const s = clean(t).replace(/[^\w\s]/g, '').toLowerCase(); if (/high|urgent|critical/.test(s)) return 'High'; if (/medium|slight/.test(s)) return 'Medium'; if (/low/.test(s)) return 'Low'; return clean(t); };

  const gvDaily = (r, cur) => U.runRate(cur, 'gv');
  function gvClassRows(match) {
    const issuance = gvIssuanceRows();
    const out = issuance.filter(match).map((r) => ({ ym: r.ym, cls: r.cls, n: r.n === '' || r.n === null || r.n === undefined ? 1 : Math.max(0, Number(r.n) || 0) }));
    const yms = new Set(out.map((r) => r.ym).filter(Boolean));
    for (const r of rowsOf('agentClass')) {
      if (!/gv|green/i.test(r.channel || '') || !r.ym || yms.has(r.ym)) continue;
      if (match({ agentName: r.name || r.gvName || r.agentName, agentId: r.id || r.agentId || '', tlName: r.tlName || '' })) {
        out.push({ ym: r.ym, cls: r.cls, n: Number(r.n) || 0 });
      }
    }
    return out;
  }
  function enrichClassesWithTotals(classes, totals, stock) {
    const list = Array.isArray(classes) ? classes.map((x) => ({ ...x })) : [];
    const t = totals || {}, s = stock || {};
    const sumVc4Last = list.filter((x) => x.cls === 'VC4').reduce((acc, x) => acc + num(x.last), 0);
    const sumCommLast = list.filter((x) => x.cls !== 'VC4').reduce((acc, x) => acc + num(x.last), 0);
    const sumVc4Cur = list.filter((x) => x.cls === 'VC4').reduce((acc, x) => acc + num(x.cur), 0);
    const sumCommCur = list.filter((x) => x.cls !== 'VC4').reduce((acc, x) => acc + num(x.cur), 0);
    if (!sumVc4Last && num(t.lastVc4) > 0) {
      let vc4Row = list.find((x) => x.cls === 'VC4');
      if (!vc4Row) { vc4Row = { cls: 'VC4', cur: 0, last: 0, stock: num(s.vc4) }; list.unshift(vc4Row); }
      vc4Row.last = num(t.lastVc4);
    }
    if (!sumVc4Cur && num(t.curVc4) > 0) {
      let vc4Row = list.find((x) => x.cls === 'VC4');
      if (!vc4Row) { vc4Row = { cls: 'VC4', cur: 0, last: 0, stock: num(s.vc4) }; list.unshift(vc4Row); }
      vc4Row.cur = num(t.curVc4);
    }
    if (!sumCommLast && num(t.lastComm) > 0) {
      let commRow = list.find((x) => x.cls !== 'VC4');
      if (!commRow) { commRow = { cls: 'Commercial', cur: 0, last: 0, stock: num(s.comm) }; list.push(commRow); }
      commRow.last = num(t.lastComm);
    }
    if (!sumCommCur && num(t.curComm) > 0) {
      let commRow = list.find((x) => x.cls !== 'VC4');
      if (!commRow) { commRow = { cls: 'Commercial', cur: 0, last: 0, stock: num(s.comm) }; list.push(commRow); }
      commRow.cur = num(t.curComm);
    }
    return list;
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
        dispatch: { days: suggestDays(), avgVc4, avgComm, cover: avgVc4 > 0 ? num(r.stockVc4) / avgVc4 : null, given, minRequired: num(r.minRequired), sugVc4: suggest(avgVc4, r.stockVc4), sugComm: suggest(avgComm, r.stockComm), sugVc4Gross: suggestGro(avgVc4), sugCommGross: suggestGro(avgComm) },
        totals: { curVc4: num(r.curVc4), curComm: num(r.curComm), curTotal: num(r.curTotal), lastVc4: num(r.lastVc4), lastComm: num(r.lastComm), lastTotal: num(r.lastTotal) }
      });
    } else {
      Object.assign(out, { mobile: '', tl: { name: [...(p.tlSet || [])][0] || '' }, priority: '', direct: !!p.direct, directLabel: p.directLabel || '', stock: { vc4: 0, comm: 0, total: 0 }, tlStock: { has: false }, dispatch: { days: suggestDays(), sugVc4: 0, sugComm: 0, sugVc4Gross: 0, sugCommGross: 0 }, totals: {} });
    }
    out.tagRequired = out.direct && isHM(out.priority);
    const n = norm(p.name);
    const issuance = gvIssuanceRows();
    // GV REPORT is a live calendar-month report: keep the actual current month even when its
    // first issuance row has not arrived yet, so the full prior month remains visible.
    const globalCurYm = U.ymKey(new Date());
    const globalLastYm = U.prevMonthKey(globalCurYm);
    const mine = issuance.filter((m) => norm(m.agentName) === n || (out.id && m.agentId === out.id));
    const exactMine = gvCanonicalIssuanceRows().filter((m) => norm(m.agentName) === n || (out.id && m.agentId === out.id));
    // Use exact EIR month totals rather than Math.max(REPORT, EIR): Math.max left stale REPORT
    // numbers on top of smaller, authoritative class details, so the KPI and its drill-down disagreed.
    const exactCurrent = exactGvMonth(exactMine, globalCurYm);
    const exactPrevious = exactGvMonth(exactMine, globalLastYm);
    if (exactCurrent) {
      setExactGvMonth(out.totals, exactMine, globalCurYm, 'cur');
      out.dispatch.avgVc4 = U.runRate(out.totals.curVc4, 'gv');
      out.dispatch.avgComm = U.runRate(out.totals.curComm, 'gv');
      out.dispatch.cover = out.dispatch.avgVc4 > 0 ? out.stock.vc4 / out.dispatch.avgVc4 : null;
      out.dispatch.sugVc4 = suggest(out.dispatch.avgVc4, out.stock.vc4);
      out.dispatch.sugComm = suggest(out.dispatch.avgComm, out.stock.comm);
      out.dispatch.sugVc4Gross = suggestGro(out.dispatch.avgVc4);
      out.dispatch.sugCommGross = suggestGro(out.dispatch.avgComm);
    }
    if (exactPrevious) setExactGvMonth(out.totals, exactMine, globalLastYm, 'last');
    attachGrowth(out, r || {}, globalCurYm);
    if (light) return out;
    const master = gvClassRows((m) => norm(m.agentName) === n || (out.id && m.agentId === out.id));
    const curYm = globalCurYm, lastYm = globalLastYm;
    out.months = { cur: curYm, last: lastYm };
    const stockRows = r ? Object.entries(r.stockByClass || {}).filter(([, v]) => v).map(([cls, v]) => ({ cls, n: v })) : [];
    const stockComm = r ? Math.max(0, num(r.stockComm)) : 0;
    out.classes = classTable(master, stockRows, curYm, lastYm);
    if (!out.classes.length && r) out.classes = Object.entries(r.curByClass || {}).map(([cls, cur]) => ({ cls, cur: num(cur), last: num((r.lastByClass || {})[cls]), stock: num((r.stockByClass || {})[cls]) })).filter((x) => x.cur || x.last || x.stock);
    if (!out.classes.length && r) out.classes = [{ cls: 'VC4', cur: num(r.curVc4), last: num(r.lastVc4), stock: num(r.stockVc4) }, { cls: 'Commercial', cur: num(r.curComm), last: num(r.lastComm), stock: stockComm }];
    out.classes = enrichClassesWithTotals(out.classes, out.totals, out.stock);
    out.trend = trendOf(master, () => true, (m) => m.ym);
    return out;
  }
  function gvTlProfile(p, light) {
    const n = norm(p.name);
    const list = gvReport().filter((r) => norm(r.tlName) === n && !safeCall(() => FF.config.isDirectAgent(r, 'gv'), false)).map((r) => ({ ...r }));
    const src = list[0] || null;
    const sumK = (k) => U.sum(list, (r) => num(r[k]));
    const avgVc4 = U.runRate(sumK('curVc4'), 'gv'), avgComm = U.runRate(sumK('curComm'), 'gv');
    const stock = src && src.tlStockTotal != null ? { vc4: num(src.tlStockVc4), comm: num(src.tlStockComm), total: num(src.tlStockTotal) } : { vc4: sumK('stockVc4'), comm: sumK('stockComm'), total: sumK('stockTotal') };
    const rowsA = list.map((r) => {
      const av = gvDaily(r, r.curVc4), avc = gvDaily(r, r.curComm);
      return { name: r.agentName, id: r.agentId, mobile: mobileFor(r.agentName, r.agentId, r.mobile), priority: prioOf(r.priority), stockVc4: num(r.stockVc4), stockComm: num(r.stockComm), stockTotal: num(r.stockTotal), cur: num(r.curTotal), last: num(r.lastTotal), curVc4: num(r.curVc4), curComm: num(r.curComm), sugVc4: suggest(av, r.stockVc4), sugComm: suggest(avc, r.stockComm), sugVc4Gross: suggestGro(av), sugCommGross: suggestGro(avc) };
    }).sort((x, y) => y.cur - x.cur);
    const out = {
      kind: 'gv-tl', channel: 'GV Partner', ch: 'gv', name: p.name, id: (src && src.tlId) || p.sub || '', found: !!list.length,
      mobile: (src && src.tlMobile) || '', tl: { name: p.name, id: (src && src.tlId) || '' }, status: '', lastActive: '', priority: '', stock, tlStock: { ...stock, has: true },
      dispatch: { days: suggestDays(), avgVc4, avgComm, cover: avgVc4 > 0 ? stock.vc4 / avgVc4 : null, sugVc4: suggest(avgVc4, stock.vc4), sugComm: suggest(avgComm, stock.comm), sugVc4Gross: suggestGro(avgVc4), sugCommGross: suggestGro(avgComm), sumAgentVc4: U.sum(rowsA, (r) => r.sugVc4), sumAgentComm: U.sum(rowsA, (r) => r.sugComm), sumAgentVc4Gross: U.sum(rowsA, (r) => r.sugVc4Gross), sumAgentCommGross: U.sum(rowsA, (r) => r.sugCommGross) },
      totals: { curVc4: sumK('curVc4'), curComm: sumK('curComm'), curTotal: sumK('curTotal'), lastVc4: sumK('lastVc4'), lastComm: sumK('lastComm'), lastTotal: sumK('lastTotal') },
      agents: rowsA, agentCount: list.length
    };
    // TL priority = sabse high agent priority
    out.priority = rowsA.some((r) => r.priority === 'High') ? 'High' : rowsA.some((r) => r.priority === 'Medium') ? 'Medium' : rowsA.length ? 'Low' : '';
    const globalCurYm = U.ymKey(new Date());
    const globalLastYm = U.prevMonthKey(globalCurYm);
    const agentNames = new Set(list.map((r) => norm(r.agentName)));
    const agentIds = new Set(list.map((r) => clean(r.agentId).toUpperCase()).filter(Boolean));
    const isTeamAgent = (m) => list.some((a) => sameGvAgent(m, a));
    const exactTeamIssuance = gvCanonicalIssuanceRows().filter(isTeamAgent);
    // Canonical EIR totals feed both the TL roll-up and each listed agent row. When a month has
    // exact team issuance data, absent agents are explicitly zeroed so their sum stays exact.
    applyExactGvAgentMonths(list, exactTeamIssuance, globalCurYm, globalLastYm);
    list.forEach((agent) => {
      const row = rowsA.find((candidate) => sameGvAgent(candidate, agent));
      if (!row) return;
      Object.assign(row, {
        cur: num(agent.curTotal), last: num(agent.lastTotal),
        curVc4: num(agent.curVc4), curComm: num(agent.curComm)
      });
      const av = gvDaily(agent, agent.curVc4), avc = gvDaily(agent, agent.curComm);
      Object.assign(row, {
        sugVc4: suggest(av, agent.stockVc4), sugComm: suggest(avc, agent.stockComm),
        sugVc4Gross: suggestGro(av), sugCommGross: suggestGro(avc)
      });
    });
    rowsA.sort((a, b) => b.cur - a.cur);
    const sumList = (k) => U.sum(list, (r) => num(r[k]));
    Object.assign(out.totals, {
      curVc4: sumList('curVc4'), curComm: sumList('curComm'), curTotal: sumList('curTotal'),
      lastVc4: sumList('lastVc4'), lastComm: sumList('lastComm'), lastTotal: sumList('lastTotal')
    });
    const exactCur = exactGvMonth(exactTeamIssuance, globalCurYm);
    const exactLast = exactGvMonth(exactTeamIssuance, globalLastYm);
    if (exactCur) Object.assign(out.totals, { curVc4: exactCur.vc4, curComm: exactCur.comm, curTotal: exactCur.total });
    if (exactLast) Object.assign(out.totals, { lastVc4: exactLast.vc4, lastComm: exactLast.comm, lastTotal: exactLast.total });
    // Rebuild TL run-rates/dispatch from the corrected issuance rows as well.
    out.dispatch.avgVc4 = U.runRate(out.totals.curVc4, 'gv');
    out.dispatch.avgComm = U.runRate(out.totals.curComm, 'gv');
    out.dispatch.cover = out.dispatch.avgVc4 > 0 ? stock.vc4 / out.dispatch.avgVc4 : null;
    out.dispatch.sugVc4 = suggest(out.dispatch.avgVc4, stock.vc4);
    out.dispatch.sugComm = suggest(out.dispatch.avgComm, stock.comm);
    out.dispatch.sugVc4Gross = suggestGro(out.dispatch.avgVc4);
    out.dispatch.sugCommGross = suggestGro(out.dispatch.avgComm);
    out.dispatch.sumAgentVc4 = U.sum(rowsA, (r) => r.sugVc4);
    out.dispatch.sumAgentComm = U.sum(rowsA, (r) => r.sugComm);
    out.dispatch.sumAgentVc4Gross = U.sum(rowsA, (r) => r.sugVc4Gross);
    out.dispatch.sumAgentCommGross = U.sum(rowsA, (r) => r.sugCommGross);
    // 📈 GV TL growth — GV sheet TL-level value nahi deta, isliye agents ke totals se.
    attachGrowth(out, {}, globalCurYm);
    if (light) return out;
    const master = gvClassRows((m) => agentNames.has(norm(m.agentName)) || (m.agentId && agentIds.has(clean(m.agentId).toUpperCase())));
    const curYm = globalCurYm, lastYm = globalLastYm;
    out.months = { cur: curYm, last: lastYm };
    const stockRows = [];
    list.forEach((r) => Object.entries(r.stockByClass || {}).forEach(([cls, v]) => { if (v) stockRows.push({ cls, n: v }); }));
    out.classes = classTable(master, stockRows, curYm, lastYm);
    if (!out.classes.length) out.classes = [{ cls: 'VC4', cur: out.totals.curVc4, last: out.totals.lastVc4, stock: stock.vc4 }, { cls: 'Commercial', cur: out.totals.curComm, last: out.totals.lastComm, stock: stock.comm }];
    // Align summary KPIs with the exact rows shown in the class table for each available month.
    if (exactCur) Object.assign(out.totals, { curVc4: exactCur.vc4, curComm: exactCur.comm, curTotal: exactCur.total });
    if (exactLast) Object.assign(out.totals, { lastVc4: exactLast.vc4, lastComm: exactLast.comm, lastTotal: exactLast.total });
    out.classes = enrichClassesWithTotals(out.classes, out.totals, stock);
    out.trend = trendOf(master, () => true, (m) => m.ym);
    return out;
  }

  /** 🧮 Ek hi formula: run-rate = issued ÷ (channel ke basis ka din) · required = run-rate × din ·
      with stock = required − stock · w/o stock = required · cover = stock ÷ run-rate.
      FF ka data kal aata hai (aaj−1 din) · GV live hai (aaj ka din). */
  function withCalc(pr) {
    if (!pr) return pr;
    const t = pr.totals || {}, s = pr.stock || {};
    const elapsed = (pr.projT1 && pr.projT1.days) || U.runRateDays(undefined, pr.ch === 'gv' || /^gv/.test(pr.kind || '') ? 'gv' : 'ff');
    const mk = (cur, last, stock) => U.dispatchCalc({ cur: num(cur), last: num(last), stock: num(stock), elapsed });
    pr.calc = {
      vc4: mk(t.curVc4, t.lastVc4, s.vc4),
      comm: mk(t.curComm, t.lastComm, s.comm),
      total: mk(t.curTotal, t.lastTotal, s.total)
    };
    return pr;
  }
  const BUILDERS = {
    'ff-agent': (p, l) => withCalc(ffAgentProfile(p, l)), 'gv-agent': (p, l) => withCalc(gvAgentProfile(p, l)),
    'ff-tl': (p, l) => withCalc(ffTlProfile(p, l)), 'gv-tl': (p, l) => withCalc(gvTlProfile(p, l))
  };
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
  const kpi = (label, value, foot, tone, kpiSpec) => `<div class="mp-kpi ${tone || ''}${kpiSpec ? ' kpi-clickable' : ''}"${kpiSpec ? ` data-kpi="${esc(kpiSpec)}" role="button" tabindex="0"` : ''}><small>${esc(label)}</small><b>${value}</b>${foot ? `<em>${foot}</em>` : ''}</div>`;
  const cell = (label, value) => `<div><small>${esc(label)}</small><b>${value}</b></div>`;

  /** Net (after stock) and gross (without stock deduction), with gross visually emphasized. */
  function sugPairHtml(net, gross) { return U.sugCell(net, gross); }
  function sugBlock(pr) {
    const d = pr.dispatch || {};
    const isTl = /tl$/.test(pr.kind);
    if (pr.tagRequired) {
      const tagPair = (net, gross) => sugMode() === 'both'
        ? `<span class="sug-pair"><span class="sug-result net"><small>Tag need · after stock</small>${tagChip(net)}</span><span class="sug-result gross"><small>Tags · no stock deducted</small><b class="sug-chip wo">🏷️ ${fmt(gross)} tags</b></span></span>`
        : tagChip(sugMode() === 'gross' ? gross : net);
      return { vc4: tagPair(d.sugVc4, d.sugVc4Gross || 0), comm: tagPair(d.sugComm, d.sugCommGross || 0), note: `🏷️ <b>TAG REQUIRED</b> — ${esc(pr.directLabel || 'Direct agent')} · stock box nahi jaata, par ${esc(pr.priority)} priority hai to tags chahiye. Suggested ${d.days} din ke run-rate par.` };
    }
    if (pr.direct) return { vc4: '<span class="dim">No dispatch</span>', comm: '<span class="dim">No dispatch</span>', note: `🚫 ${esc(pr.directLabel || 'Direct agent')} — priority ${esc(pr.priority || 'Low')}: abhi dispatch / tags ki zarurat nahi.` };
    return { vc4: sugPairHtml(d.sugVc4, d.sugVc4Gross || 0), comm: sugPairHtml(d.sugComm, d.sugCommGross || 0), note: isTl ? `TL-level = TL avg/day × ${d.days} din − TL stock = <b>stock ke baad</b> · bina stock = avg/day × ${d.days} · agents ka jod: VC4 <b>${fmt(d.sumAgentVc4)}</b> (w/o ${fmt(d.sumAgentVc4Gross || 0)}) · Comm <b>${fmt(d.sumAgentComm)}</b> (w/o ${fmt(d.sumAgentCommGross || 0)})` : `Suggested = avg/day × ${d.days} din − stock = <b>stock ke baad</b> · bina stock ghataye = avg/day × ${d.days}` };
  }

  const coverBadge = (c) => (c == null ? '<span class="dim">—</span>' : `<span class="badge ${c < 7 ? 'red' : c < 15 ? 'amber' : 'green'}">${fmt(c, true)} din</span>`);
  /** 📈 Growth cell — sheet ka % + "data till <date>" + month-end projection. */
  function growthCell(pr) {
    const g = pr.growthNum, p = pr.projT1 || null, b = p && p.basis;
    const main = (g === null || g === undefined || !Number.isFinite(g)) ? '<span class="dim">—</span>' : U.pctHtml(g, { decimals: 1 });
    const foot = [];
    if (b && b.shortLabel) foot.push(`till ${esc(b.shortLabel)}`);
    if (p && p.total) foot.push(`proj ${fmt(p.total)}`);
    return `<div class="mp-growth"><small>Growth</small><b>${main}</b>${foot.length ? `<em>${foot.join(' · ')}</em>` : ''}</div>`;
  }
  /** 📈 Growth + month-end projection — run-rate basis ke hisaab se (FF: kal tak · GV: live aaj). */
  function growthHtml(pr) {
    const p = pr.projT1;
    if (!p || !pr.found) return '';
    const t = pr.totals || {}, m = pr.months || {}, b = p.basis || {};
    const last = monthLabel(m.last) || 'Last month', cur = monthLabel(m.cur) || 'This month';
    const curHead = b.shortLabel ? `${cur} · till ${b.shortLabel}` : cur;
    const g = (a, c) => U.pctHtml(U.growth(num(a), num(c)), { decimals: 0 });
    const row = (label, a, c, proj) => `<tr><td><b>${label}</b></td><td class="num">${fmt(c)}</td><td class="num"><b>${fmt(a)}</b></td><td class="num">${g(a, c)}</td><td class="num"><b>${fmt(proj)}</b></td></tr>`;
    const gTotal = p.num === null || p.num === undefined ? U.growth(t.curTotal, t.lastTotal) : p.num;
    const days = b.days || p.days || 0;
    const rate = days ? num(t.curTotal) / days : 0;
    const monthDays = m.cur ? U.daysInMonth(m.cur) : 30;
    const left = m.cur ? Math.max(0, monthDays - days) : 0;
    return `<section class="mp-sec mp-growth-sec"><h4>📈 Growth % &amp; month-end expected</h4>
      <p class="dim small">📅 ${esc(U.basisText(pr.ch, b))} · Expected = run-rate (${fmt(rate, true)}/day) × is month ke ${fmt(monthDays)} din${left ? ` · aage <b>${fmt(left)} din</b> bache hain` : ''}.</p>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Tag</th><th class="num">${esc(last)}</th><th class="num">${esc(curHead)}</th><th class="num">Growth</th><th class="num">Expected month-end</th></tr></thead><tbody>
        ${row('VC4', t.curVc4, t.lastVc4, p.vc4)}${row('Commercial', t.curComm, t.lastComm, p.comm)}
      </tbody><tfoot><tr class="row-total"><td>Total</td><td class="num">${fmt(t.lastTotal)}</td><td class="num">${fmt(t.curTotal)}</td><td class="num">${U.pctHtml(gTotal, { decimals: 0 })}</td><td class="num">${fmt(p.total)}</td></tr></tfoot></table></div>
      <div class="dgrid" style="margin-top:8px">
        <div class="drow"><span>Run-rate / day</span><b>${fmt(rate, true)} · ${fmt(days)} din ka hisaab</b></div>
        <div class="drow"><span>Data till</span><b>${esc(b.label || `${fmt(days)} din`)}</b></div>
        <div class="drow"><span>Aage kitne din bache</span><b>${fmt(left)} din · <small class="dim">expected ${fmt(Math.round(rate * left))} aur tags</small></b></div>
        <div class="drow"><span>Sheet ka expected</span><b>${p.sheet ? `${fmt(p.sheet)} <small class="dim">(purana basis)</small>` : '—'}</b></div>
        <div class="drow"><span>Growth % kahan se</span><b>${pr.growth ? `${esc(pr.growth)} <small class="dim">REPORT tab</small>` : '<small class="dim">totals se calculate</small>'}</b></div>
      </div></section>`;
  }
  function calcHtml(pr) {
    const c = pr.calc;
    if (!c) return '';
    const days = c.total.days, el = c.total.elapsed;
    const row = (label, x, strong) => `<tr class="${strong ? 'row-strong' : ''}"><td><b>${label}</b></td><td class="num">${fmt(x.last)}</td><td class="num">${fmt(x.cur)}</td><td class="num">${fmt(x.rate, true)}</td><td class="num">${fmt(x.required)}</td><td class="num">${fmt(x.stock)}</td><td class="num"><b class="sug-chip">${fmt(x.net)}</b></td><td class="num"><b class="sug-chip wo">${fmt(x.gross)}</b></td><td class="num">${coverBadge(x.cover)}</td></tr>`;
    const m = pr.months || {};
    const b = (pr.projT1 && pr.projT1.basis) || {};
    return `<section class="mp-sec mp-calc"><h4>🧮 Dispatch calculation · ${fmt(days)} din</h4>
      <p class="dim small">📅 ${esc(U.basisText(pr.ch, b))} — isliye run-rate = is month ka issue ÷ <b>${fmt(el)} din</b> · Required = run-rate × <b>${fmt(days)}</b> din · <b>After stock</b> = Required − stock · <b>Without subtracting stock</b> = full Required · Cover = stock ÷ run-rate</p>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Tag</th><th class="num">${esc(monthLabel(m.last) || 'Last month')}</th><th class="num">${esc(monthLabel(m.cur) || 'This month')}</th><th class="num">Run-rate / day</th><th class="num">× ${fmt(days)} din</th><th class="num">Stock</th><th class="num">With stock dispatch · after stock</th><th class="num">W/o stock dispatch · no stock deduction</th><th class="num">Cover</th></tr></thead><tbody>${row('VC4', c.vc4)}${row('Commercial', c.comm)}</tbody><tfoot>${row('Total', c.total, true).replace('<tr class="row-strong">', '<tr class="row-total">')}</tfoot></table></div></section>`;
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
      ${growthCell(pr)}
    </div>`;
    const scopeParam = isTl ? `tl=${encodeURIComponent(pr.name)}` : `agent=${encodeURIComponent(pr.name)}${pr.id ? `&agentId=${encodeURIComponent(pr.id)}` : ''}`;
    const stockSpec = `src=${pr.ch}&scope=stock&${scopeParam}`;
    const tlStockSpec = !isTl && pr.tl && pr.tl.name ? `src=${pr.ch}&scope=stock&tl=${encodeURIComponent(pr.tl.name)}` : '';
    const curSpec = `src=${pr.ch}&scope=mtd&ym=${encodeURIComponent(m.cur || '')}&${scopeParam}`;
    const lastSpec = `src=${pr.ch}&scope=month&ym=${encodeURIComponent(m.last || '')}&${scopeParam}`;
    const kpis = `<div class="mp-kpis">
      ${kpi(isTl ? 'TL stock (total)' : 'Agent stock', fmt(s.total), `VC4 ${fmt(s.vc4)} · Commercial ${fmt(s.comm)}`, 'k1', stockSpec)}
      ${isTl ? '' : kpi('TL stock', ts.has ? fmt(ts.total) : '—', ts.has ? `VC4 ${fmt(ts.vc4)} · Comm ${fmt(ts.comm)}` : (pr.direct ? 'Direct — koi TL nahi' : ''), 'k2', tlStockSpec)}
      ${kpi('Dispatch priority', prioChip(pr.priority), pr.calc && pr.calc.total.cover != null ? `Cover ${fmt(pr.calc.total.cover, true)} din (all tags)` : (d.cover != null ? `Cover ${fmt(d.cover, true)} din` : ''), 'k3', stockSpec)}
      ${kpi(pr.tagRequired ? `Tags required · VC4 · ${d.days} din` : `Suggested VC4 · ${d.days} din`, sg.vc4, `avg ${fmt(d.avgVc4, true)}/day × ${d.days} din${pr.tagRequired ? '' : ` · stock − ${fmt(s.vc4)}`}`, pr.tagRequired ? 'k7' : 'k4', `${curSpec}&group=VC4`)}
      ${kpi(pr.tagRequired ? 'Tags required · Comm.' : 'Suggested Commercial', sg.comm, `avg ${fmt(d.avgComm, true)}/day${pr.tagRequired ? '' : ` · stock − ${fmt(s.comm)}`}`, pr.tagRequired ? 'k7' : 'k5', `${curSpec}&group=COMM`)}
      ${kpi('Issued this month', fmt(t.curTotal), `VC4 ${fmt(t.curVc4)} · Comm ${fmt(t.curComm)}`, 'k6', curSpec)}
      ${kpi('Issued last month', fmt(t.lastTotal), `VC4 ${fmt(t.lastVc4)} · Comm ${fmt(t.lastComm)}`, 'k8', lastSpec)}
    </div>
    <p class="mp-note ${pr.tagRequired ? 'tag' : ''}">${sg.note}</p>`;
    const summary = `<table class="tbl compact mp-summary"><thead><tr><th></th><th class="num">${esc(monthLabel(m.last) || 'Last month')}</th><th class="num">${esc(monthLabel(m.cur) || 'This month')}</th><th class="num">Stock</th></tr></thead><tbody>
      <tr class="clickable" data-kpi="${esc(`${curSpec}&group=VC4`)}"><td><b>VC4</b></td><td class="num">${fmt(g.vc4.last)}</td><td class="num">${fmt(g.vc4.cur)}</td><td class="num">${fmt(g.vc4.stock)}</td></tr>
      <tr class="clickable" data-kpi="${esc(`${curSpec}&group=COMM`)}"><td><b>Commercial</b><small class="cell-sub">VC20 · VC5+ …</small></td><td class="num">${fmt(g.comm.last)}</td><td class="num">${fmt(g.comm.cur)}</td><td class="num">${fmt(g.comm.stock)}</td></tr>
      </tbody><tfoot><tr class="row-total"><td>Total issuance</td><td class="num">${fmt(g.total.last)}</td><td class="num">${fmt(g.total.cur)}</td><td class="num">${fmt(g.total.stock)}</td></tr></tfoot></table>`;
    const clsTable = cls.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">${esc(monthLabel(m.last) || 'Last month')}</th><th class="num">${esc(monthLabel(m.cur) || 'This month')}</th><th class="num">Growth</th><th class="num">Stock</th></tr></thead><tbody>
      ${cls.map((r) => `<tr class="clickable" data-kpi="${esc(`${r.cur > 0 ? curSpec : lastSpec}&cls=${encodeURIComponent(r.cls)}`)}"><td><b>${esc(r.cls)}</b></td><td class="num">${fmt(r.last)}</td><td class="num">${fmt(r.cur)}</td><td class="num">${r.last ? U.pctHtml(((r.cur - r.last) / r.last) * 100) : '—'}</td><td class="num">${fmt(r.stock)}</td></tr>`).join('')}
      </tbody><tfoot><tr class="row-total"><td>Total</td><td class="num">${fmt(g.total.last)}</td><td class="num">${fmt(g.total.cur)}</td><td class="num">${g.total.last ? U.pctHtml(((g.total.cur - g.total.last) / g.total.last) * 100) : '—'}</td><td class="num">${fmt(g.total.stock)}</td></tr></tfoot></table></div>` : '<p class="dim small">Class-wise data abhi load nahi hua.</p>';
    const agentsTable = isTl && pr.agents && pr.agents.length ? `<section class="mp-sec"><h4>🧑‍💼 TL ke agents · ${fmt(pr.agents.length)}</h4><p class="dim small">Sug. = avg/day × ${d.days} din · <b>stock ke baad</b> (net)${sugMode() === 'both' ? ' · <span class="sug-wo-inline">w/o stock = bina stock ghataye (gross)</span>' : ''}</p><div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th>Mobile</th><th>Priority</th><th class="num">VC4 stock</th><th class="num">Comm stock</th><th class="num">Last</th><th class="num">This month</th><th class="num">Sug. VC4</th><th class="num">Sug. Comm</th></tr></thead><tbody>
      ${pr.agents.slice(0, 200).map((a) => `<tr class="clickable" data-mp-agent="${esc(a.name)}" data-mp-kind="${pr.ch}-agent" data-mp-id="${esc(a.id || '')}"><td><b>${esc(a.name)}</b><small class="cell-sub">${esc(a.id || '')}</small></td><td>${mobileCell(a.mobile)}</td><td>${prioChip(a.priority)}</td><td class="num">${fmt(a.stockVc4)}</td><td class="num">${fmt(a.stockComm)}</td><td class="num">${fmt(a.last)}</td><td class="num">${fmt(a.cur)}</td><td class="num">${U.sugCell(a.sugVc4, a.sugVc4Gross || 0)}</td><td class="num">${U.sugCell(a.sugComm, a.sugCommGross || 0)}</td></tr>`).join('')}
      </tbody><tfoot><tr class="row-total"><td colspan="3">TL total</td><td class="num">${fmt(U.sum(pr.agents, (a) => a.stockVc4))}</td><td class="num">${fmt(U.sum(pr.agents, (a) => a.stockComm))}</td><td class="num">${fmt(U.sum(pr.agents, (a) => a.last))}</td><td class="num">${fmt(U.sum(pr.agents, (a) => a.cur))}</td><td class="num">${U.sugCell(d.sumAgentVc4, d.sumAgentVc4Gross || 0)}</td><td class="num">${U.sugCell(d.sumAgentComm, d.sumAgentCommGross || 0)}</td></tr></tfoot></table></div></section>` : '';
    const actions = `<div class="mp-actions"><button class="btn small primary" data-mp-pdf>📄 PDF</button><button class="btn small" data-mp-csv>⬇ CSV</button><button class="btn small" data-mp-copy>📋 Copy</button><button class="btn small" data-mp-wa>📲 WhatsApp</button>${isTl ? '' : `<button class="btn small" data-mp-a360="${esc(pr.name)}">👁 Agent 360</button>`}<a class="btn small" href="#/masterStock?q=${encodeURIComponent(pr.name)}">🗄️ Register / tags</a></div>`;
    return `<div class="mp">${noData}${head}${kpis}
      ${calcHtml(pr)}
      ${growthHtml(pr)}
      <section class="mp-sec"><h4>🧾 Issuance summary${isTl ? ' — TL total' : ''}</h4>${summary}</section>
      <section class="mp-sec"><h4>🎯 Issuance class-wise · last month vs this month + stock</h4>${clsTable}</section>
      ${agentsTable}
      <section class="mp-sec"><h4>📊 Charts</h4>${chartsHtml(pr) || '<p class="dim small">Chart ke liye data nahi mila.</p>'}</section>
      ${actions}</div>`;
  }

  // ------------------------------------------------------------------ export / share
  function csvRows(pr) {
    const d = pr.dispatch || {}, s = pr.stock || {}, t = pr.totals || {}, ts = pr.tlStock || {}, p = pr.projT1 || {}, b = p.basis || {};
    const g = groupSummary(pr.classes || []);
    const rows = [['Name', pr.name], ['Type', `${pr.channel} ${/tl$/.test(pr.kind) ? 'TL' : 'Agent'}`], ['ID', pr.id], ['Mobile', canContacts() ? pr.mobile : ''], ['TL', (pr.tl && pr.tl.name) || ''], ['TL ID', (pr.tl && pr.tl.id) || ''], ["TL's mobile", canContacts() ? (pr.tl && pr.tl.mobile) || '' : ''],
      ['Status', pr.status], ['Last active', pr.lastActive], ['Priority', pr.priority], ['Direct agent', pr.direct ? pr.directLabel : 'No'], ['Tag required', pr.tagRequired ? 'YES' : 'No'],
      ['Growth % (REPORT)', pr.growthNum === null || pr.growthNum === undefined ? '' : Number(pr.growthNum.toFixed(1))], ['Data till (run-rate basis)', b.label || ''],
      ['Expected month-end', p.total || ''], ['Expected month-end · sheet', p.sheet || ''],
      ['Stock VC4', s.vc4], ['Stock Commercial', s.comm], ['Stock total', s.total], ['TL stock total', ts.has ? ts.total : ''],
      ['Run-rate basis', `issued ÷ ${(pr.calc && pr.calc.total.elapsed) || ''} din (${U.basisText(pr.ch, b)})`], ['Avg VC4/day', d.avgVc4], ['Suggested VC4' + (pr.tagRequired ? ' (tags)' : '') + ' · stock ke baad (net)', d.sugVc4], ['Suggested VC4 · bina stock (gross)', d.sugVc4Gross || 0], ['Suggested Commercial' + (pr.tagRequired ? ' (tags)' : '') + ' · stock ke baad (net)', d.sugComm], ['Suggested Commercial · bina stock (gross)', d.sugCommGross || 0],
      ['Total run-rate/day', pr.calc ? pr.calc.total.rate : ''], ['Total required (× days)', pr.calc ? pr.calc.total.required : ''], ['Total dispatch WITH stock', pr.calc ? pr.calc.total.net : ''], ['Total dispatch W/O stock', pr.calc ? pr.calc.total.gross : ''], ['Total cover (days)', pr.calc && pr.calc.total.cover != null ? pr.calc.total.cover : ''], ['Issued this month', t.curTotal], ['Issued last month', t.lastTotal], ['', ''], ['Class', `${(pr.months || {}).last || 'Last'} | ${(pr.months || {}).cur || 'This'} | Stock`]];
    (pr.classes || []).forEach((r) => rows.push([r.cls, r.last, r.cur, r.stock]));
    rows.push(['GRAND TOTAL', g.total.last || t.lastTotal || 0, g.total.cur || t.curTotal || 0, g.total.stock || s.total || 0]);
    if (pr.agents && pr.agents.length) {
      rows.push(['', '']);
      rows.push(['Agent', 'ID', 'Mobile', 'Priority', 'VC4 stock', 'Comm stock', 'Last', 'This', 'Sug VC4 (stock −)', 'Sug VC4 (bina stock)', 'Sug Comm (stock −)', 'Sug Comm (bina stock)']);
      pr.agents.forEach((a) => rows.push([a.name, a.id, canContacts() ? a.mobile : '', a.priority, a.stockVc4, a.stockComm, a.last, a.cur, a.sugVc4, a.sugVc4Gross || 0, a.sugComm, a.sugCommGross || 0]));
      rows.push(['TEAM GRAND TOTAL', `${pr.agents.length} Agents`, '', '', U.sum(pr.agents, (a) => a.stockVc4), U.sum(pr.agents, (a) => a.stockComm), U.sum(pr.agents, (a) => a.last), U.sum(pr.agents, (a) => a.cur), d.sumAgentVc4 || 0, d.sumAgentVc4Gross || 0, d.sumAgentComm || 0, d.sumAgentCommGross || 0]);
    }
    return rows;
  }
  function waText(pr) {
    const d = pr.dispatch || {}, s = pr.stock || {}, t = pr.totals || {}, p = pr.projT1 || {}, b = p.basis || {};
    const g = groupSummary(pr.classes || []);
    const lines = [`*${pr.name}* (${pr.channel} ${/tl$/.test(pr.kind) ? 'TL' : 'Agent'}${pr.id ? ` · ${pr.id}` : ''})`];
    if (canContacts() && pr.mobile) lines.push(`📞 ${pr.mobile}`);
    if (!/tl$/.test(pr.kind) && pr.tl && pr.tl.name && !pr.direct) lines.push(`TL: ${pr.tl.name}`);
    lines.push(`Priority: ${pr.priority || '—'}${pr.tagRequired ? ' · 🏷️ TAG REQUIRED' : ''}`);
    lines.push(`Stock: ${U.fmt(s.total)} (VC4 ${U.fmt(s.vc4)} · Comm ${U.fmt(s.comm)})`);
    if (pr.growthNum !== null && pr.growthNum !== undefined) lines.push(`📈 Growth: ${pr.growthNum >= 0 ? '+' : ''}${pr.growthNum.toFixed(1)}%${b.shortLabel ? ` (till ${b.shortLabel})` : ''} · expected month-end ${U.fmt(p.total)}`);
    lines.push(`${pr.tagRequired ? 'Tags needed' : 'Suggested dispatch'} (${d.days} din): VC4 ${U.fmt(d.sugVc4)} · Comm ${U.fmt(d.sugComm)} — stock ke baad`);
    lines.push(`Bina stock ghataye: VC4 ${U.fmt(d.sugVc4Gross || 0)} · Comm ${U.fmt(d.sugCommGross || 0)}`);
    if (pr.calc) lines.push(`Run-rate ${U.fmt(pr.calc.total.rate, true)}/day (÷ ${pr.calc.total.elapsed} din) · All tags: with stock ${U.fmt(pr.calc.total.net)} · w/o stock ${U.fmt(pr.calc.total.gross)}${pr.calc.total.cover != null ? ` · cover ${U.fmt(pr.calc.total.cover, true)} din` : ''}`);
    lines.push(`Issued: this month ${U.fmt(t.curTotal)}${b.shortLabel ? ` (till ${b.shortLabel})` : ''} · last month ${U.fmt(t.lastTotal)}`);
    (pr.classes || []).slice(0, 12).forEach((r) => lines.push(`• ${r.cls}: ${U.fmt(r.last)} → ${U.fmt(r.cur)} (stock ${U.fmt(r.stock)})`));
    lines.push(`*Total Class-wise: Last ${U.fmt(g.total.last || t.lastTotal)} → MTD ${U.fmt(g.total.cur || t.curTotal)} (Stock ${U.fmt(g.total.stock || s.total)})*`);
    if (pr.agents && pr.agents.length) {
      lines.push('', `*Team Agents (${U.fmt(pr.agents.length)}):*`);
      pr.agents.slice(0, 20).forEach((a) => lines.push(`• ${a.name}: Last ${U.fmt(a.last)} · MTD ${U.fmt(a.cur)} · Stock ${U.fmt(a.stockTotal)}`));
      lines.push(`*Team Grand Total: Last ${U.fmt(U.sum(pr.agents, (a) => a.last))} · MTD ${U.fmt(U.sum(pr.agents, (a) => a.cur))} · Stock ${U.fmt(U.sum(pr.agents, (a) => a.stockTotal))}*`);
    }
    return lines.join('\n');
  }
  function makePdf(pr) {
    if (!FF.pdf || !FF.pdf.doc) return null;
    const d = pr.dispatch || {}, s = pr.stock || {}, t = pr.totals || {}, p = pr.projT1 || {}, m = pr.months || {};
    const g = groupSummary(pr.classes || []);
    const doc = FF.pdf.doc({
      title: `${pr.channel} · ${/tl$/.test(pr.kind) ? 'Team Leader' : 'Agent'} Profile`,
      subtitle: `${pr.name}${pr.id ? ` (ID: ${pr.id})` : ''}${pr.mobile && canContacts() ? ` · ${pr.mobile}` : ''}`,
      right: `${new Date().toLocaleDateString('en-IN')}`
    });
    doc.kpis([
      { label: 'This Month (MTD)', value: fmt(t.curTotal), sub: `VC4 ${fmt(t.curVc4)} · Comm ${fmt(t.curComm)}`, color: '#2563eb' },
      { label: 'Last Month', value: fmt(t.lastTotal), sub: `VC4 ${fmt(t.lastVc4)} · Comm ${fmt(t.lastComm)}`, color: '#7c3aed' },
      { label: 'Expected', value: fmt(p.total || 0), sub: `Growth ${pr.growthNum != null ? `${pr.growthNum.toFixed(1)}%` : '—'}`, color: '#059669' },
      { label: 'Stock in Hand', value: fmt(s.total), sub: `VC4 ${fmt(s.vc4)} · Comm ${fmt(s.comm)}`, color: '#d97706' }
    ]);
    doc.section(`Class-wise Issuance (${m.last || 'Last'} vs ${m.cur || 'MTD'}) & Stock`);
    doc.table({
      headers: ['Class', m.last || 'Last Month', m.cur || 'Current (MTD)', 'Growth %', 'Stock in Hand'],
      align: ['left', 'right', 'right', 'right', 'right'],
      rows: (pr.classes || []).map((c) => [c.cls, fmt(c.last), fmt(c.cur), c.last ? `${(((c.cur - c.last) / c.last) * 100).toFixed(0)}%` : '—', fmt(c.stock)]),
      foot: ['GRAND TOTAL', fmt(g.total.last || t.lastTotal), fmt(g.total.cur || t.curTotal), (g.total.last || t.lastTotal) ? `${((((g.total.cur || t.curTotal) - (g.total.last || t.lastTotal)) / (g.total.last || t.lastTotal)) * 100).toFixed(0)}%` : '—', fmt(g.total.stock || s.total)]
    });
    if (pr.agents && pr.agents.length) {
      doc.section(`Team Agents (${fmt(pr.agents.length)})`);
      doc.table({
        headers: ['Agent', 'ID', 'Priority', 'Last Month', 'Current (MTD)', 'VC4 Stock', 'Comm Stock', 'Total Stock'],
        align: ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'right'],
        rows: pr.agents.map((a) => [a.name, a.id || '—', a.priority || '—', fmt(a.last), fmt(a.cur), fmt(a.stockVc4), fmt(a.stockComm), fmt(a.stockTotal)]),
        foot: ['GRAND TOTAL', `${fmt(pr.agents.length)} Agents`, '', fmt(U.sum(pr.agents, (a) => a.last)), fmt(U.sum(pr.agents, (a) => a.cur)), fmt(U.sum(pr.agents, (a) => a.stockVc4)), fmt(U.sum(pr.agents, (a) => a.stockComm)), fmt(U.sum(pr.agents, (a) => a.stockTotal))]
      });
    }
    doc.footer(`${FF.config.brand || 'ApnaPayment'} · ${pr.channel} Profile Report`);
    return doc.finish();
  }

  // ------------------------------------------------------------------ mount helpers
  function bind(el, pr) {
    el.__mpProfile = pr;
    if (el.__mpBound) return;
    el.__mpBound = true;
    el.addEventListener('click', (e) => {
      const cur = el.__mpProfile;
      if (!cur) return;
      if (e.target.closest('[data-mp-pdf]')) {
        const bytes = makePdf(cur);
        if (bytes && FF.pdf) { FF.pdf.download(bytes, `profile-${U.slug(cur.name)}-${U.stamp()}.pdf`); U.toast('PDF downloaded ✓', 'ok'); }
        return;
      }
      if (e.target.closest('[data-mp-csv]')) { U.downloadCsv(`profile-${U.slug(cur.name)}-${U.stamp()}.csv`, ['Field', 'Value / Last', 'This', 'Stock'], csvRows(cur).map((r) => [r[0], r[1], r[2] ?? '', r[3] ?? ''])); return; }
      if (e.target.closest('[data-mp-copy]')) { U.copyText(waText(cur)); U.toast('Summary copied ✓', 'ok'); return; }
      if (e.target.closest('[data-mp-wa]')) { const link = U.waLink ? U.waLink(waText(cur)) : ''; if (link) window.open(link, '_blank', 'noopener'); return; }
      const a360 = e.target.closest('[data-mp-a360]');
      if (a360) { if (FF.cockpit && FF.cockpit.agent360) FF.cockpit.agent360({ name: a360.dataset.mpA360 }).catch(() => {}); return; }
      const row = e.target.closest('[data-mp-agent]');
      if (row) { open({ kind: row.dataset.mpKind, name: row.dataset.mpAgent, sub: row.dataset.mpId, tlSet: new Set(), classMap: new Map(), bars: new Set() }); }
    });
  }
  const loadingHtml = (name) => `<div class="mp-loading" role="status" aria-live="polite">${U.loader ? U.loader('', { size: 'md' }) : ''} <span><b>${esc(name)}</b> ki poori report ban rahi hai${U.ellipsis ? U.ellipsis() : '…'} <small class="dim">(REPORT + stock + issuance load ho raha hai)</small></span></div>`;
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
    const kicker = person.kicker || `🔎 Master search · ${person.kind.endsWith('tl') ? 'TL' : 'Agent'} profile`;
    const isTl = person.kind.endsWith('tl');
    const ch = /^gv/.test(person.kind) ? 'gv' : 'ff';
    // 🧓 v3.31 — profile drawer ke neeche us agent / TL ka stock ageing (FF ya GV channel)
    const age = isTl ? { kind: 'tl', key: person.name, ch, title: person.name } : { kind: 'agent', key: person.sub || person.name, keys: [person.name], ch, title: person.name };
    FF.app.openDrawer({ kicker, title: person.name, sub: esc(person.sub ? `ID ${person.sub}` : ''), body: `<div id="mp-drawer-slot">${loadingHtml(person.name)}</div>`, actions: '', wide: true, age });
    const slot = U.$('#mp-drawer-slot');
    try {
      const pr = await build(person);
      const body = U.$('#drawer-body');
      if (!body) return pr;
      // Slot hi bharo (neeche ka ageing section bacha rahe) · user dusra drawer khol chuka ho to overwrite mat karo.
      if (!slot || !slot.isConnected) return pr;
      slot.innerHTML = html(pr);
      if (FF.charts && FF.charts.mount) FF.charts.mount(body);
      bind(body, pr);
      return pr;
    } catch (err) {
      if (slot) slot.innerHTML = `<div class="ms-empty small"><b>Profile nahi ban payi</b><p class="dim">${esc(err && err.message || err)}</p></div>`;
      return null;
    }
  }

  FF.masterProfile = { supports, quick, build, html, csvRows, waText, renderInto, open, warm, load, suggest, suggestGro, findFfAgent, findGvAgent, mobileFor, get suggestDays() { return suggestDays(); } };
})(window.FF);
