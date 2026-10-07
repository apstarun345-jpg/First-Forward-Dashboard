/* 📋 AGENT / TL SUMMARY (v3.33) — First Forward + GV Partner
 * Dedicated page per channel: search ANY Agent or TL by Name, Agent Name, TL Name, Agent ID, TL ID,
 * or Mobile Number, with instant top-of-screen suggested names, visual Class-wise Issuance & Stock charts,
 * Stock Ageing, clickable KPI cards & rows (opening exact data with CSV/PDF), and full Grand Totals
 * across UI tables, PDF, Copy, WhatsApp Share, and CSV.
 */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean, fmt = U.fmt;
  const norm = (s) => clean(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const idKey = (s) => clean(s).toUpperCase().replace(/\.0+$/, '').replace(/\s+/g, '');
  const mob10 = (s) => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : d; };
  const MP = () => FF.masterProfile;
  // 🔐 v3.35 — har option admin ke control me (Settings → Users / Access matrix).
  // FF.auth missing ho to default allow (tests/legacy) — masterProfile.js jaisa pattern.
  const can = (perm) => { try { return !FF.auth || FF.auth.can(perm); } catch { return true; } };
  const canContacts = () => can('contacts');

  async function loadPeople(channel) {
    const isGv = channel === 'gv';
    const kind = isGv ? 'gv-agent' : 'ff-agent';
    if (MP() && MP().loadFor) await MP().loadFor({ kind }).catch(() => {});
    else if (MP() && MP().load) await MP().load().catch(() => {});
    if (isGv && FF.gv) await Promise.all(['report', 'stockAgent', 'stockTl', 'stockTlClass', 'stockAgentClass', 'master'].map((k) => FF.gv.need(k, { only: true })).map((p) => p && p.catch ? p.catch(() => {}) : p));
    else await Promise.all([
      FF.pages.performance && FF.pages.performance.ensureLoaded ? FF.pages.performance.ensureLoaded({ light: true }) : null,
      FF.store.need('agents', { only: true }), FF.store.need('stockAgents', { only: true }), FF.store.need('daily', { only: true }), FF.store.need('agentClass', { only: true })
    ].map((p) => p && p.catch ? p.catch(() => {}) : p));

    const map = new Map();
    const byName = new Map();
    const personKey = (kind, id, name) => `${kind}|${idKey(id) || norm(name)}`;
    const rememberPerson = (kind, name, person) => {
      const k = `${kind}|${norm(name)}`; const arr = byName.get(k) || [];
      if (!arr.includes(person)) arr.push(person); byName.set(k, arr);
    };
    const add = (kind, name, id, tl, mobile, cur, stock, extra = {}) => {
      const nm = clean(name);
      if (!nm || /^(—|na|unknown|unassigned|direct)$/i.test(nm)) return;
      if (kind.endsWith('tl') && FF.config.isRealTl && !FF.config.isRealTl(nm)) return;
      const identity = idKey(id); const exactKey = personKey(kind, id, nm);
      let e = identity ? map.get(exactKey) : null;
      if (!e) { const candidates = byName.get(`${kind}|${norm(nm)}`) || []; e = candidates.find((x) => !identity || !idKey(x.id) || idKey(x.id) === identity) || null; }
      if (!e) {
        e = { kind, name: nm, id: clean(id), altIds: new Set(), tl: clean(tl), tlId: clean(extra.tlId), mobile: clean(mobile), tlMobile: clean(extra.tlMobile), cur: 0, stock: 0, last: 0 };
        map.set(exactKey, e); rememberPerson(kind, nm, e);
      } else if (identity && !idKey(e.id)) {
        for (const [k, value] of map.entries()) if (value === e && k !== exactKey) map.delete(k);
        e.id = clean(id); map.set(exactKey, e);
      }
      if (!e.id && id) e.id = clean(id);
      if (id) e.altIds.add(clean(id)); if (extra.altId) e.altIds.add(clean(extra.altId));
      if (!e.tl && tl) e.tl = clean(tl); if (!e.tlId && extra.tlId) e.tlId = clean(extra.tlId);
      if (!e.mobile && mobile) e.mobile = clean(mobile); if (!e.tlMobile && extra.tlMobile) e.tlMobile = clean(extra.tlMobile);
      e.cur = Math.max(e.cur, Number(cur) || 0); e.stock = Math.max(e.stock, Number(stock) || 0); e.last = Math.max(e.last, Number(extra.last) || 0);
    };

    if (isGv) {
      const gvP = FF.pages && FF.pages.gvPerformance;
      const rep = (gvP && gvP.sourceRows && gvP.sourceRows()) || (gvP && gvP.rows && gvP.rows()) || (FF.gv && FF.gv.get('report')) || [];
      const tlSum = new Map();
      for (const r of rep) {
        add('gv-agent', r.agentName, r.agentId, r.tlName, r.mobile, r.curTotal, r.stockTotal, { tlId: r.tlId, tlMobile: r.tlMobile, last: r.lastTotal, altId: r.supervisorId });
        if (clean(r.tlName) && (!FF.config.isDirectAgent || !FF.config.isDirectAgent(r, 'gv'))) {
          const tk = norm(r.tlName);
          const t = tlSum.get(tk) || { name: r.tlName, id: r.tlId, mobile: r.tlMobile || '', cur: 0, reportStock: 0, snapshotStock: 0, last: 0 };
          t.cur += Number(r.curTotal) || 0;
          t.reportStock += Number(r.stockTotal) || 0;
          t.snapshotStock = Math.max(t.snapshotStock, Number(r.tlStockTotal) || 0);
          t.last += Number(r.lastTotal) || 0;
          if (!t.id && r.tlId) t.id = r.tlId;
          if (!t.mobile && r.tlMobile) t.mobile = r.tlMobile;
          tlSum.set(tk, t);
        }
      }
      for (const t of tlSum.values()) {
        const quick = MP() && MP().quick ? MP().quick({ kind: 'gv-tl', name: t.name, sub: t.id || '', tlSet: new Set(), classMap: new Map(), bars: new Set() }) : null;
        const stock = quick && quick.stock ? quick.stock.total : Math.max(t.snapshotStock, t.reportStock);
        add('gv-tl', t.name, t.id, '', t.mobile, t.cur, stock, { tlId: t.id, last: t.last });
      }
      for (const s of (FF.gv && FF.gv.get('stockAgent')) || []) {
        add('gv-agent', s.agentName, s.agentId, s.tlName, '', 0, s.n, { tlId: s.tlId });
      }
      for (const m of (FF.gv && FF.gv.get('master')) || []) {
        add('gv-agent', m.agentName, m.agentId, m.tlName, '', 0, 0, { tlId: m.tlId, altId: m.gvUniqueId });
        if (clean(m.tlName)) add('gv-tl', m.tlName, m.tlId, '', '', 0, 0, { tlId: m.tlId });
      }
    } else {
      const ags = (FF.pages.performance && FF.pages.performance.agents && FF.pages.performance.agents()) || [];
      const tlSum = new Map();
      for (const a of ags) {
        add('ff-agent', a.name, a.agentId || a.id, a.tlName, a.mobile, a.curTotal, a.stockTotal, {
          tlId: a.tlId, tlMobile: a.tlMobile, last: a.lastTotal, altId: a.id
        });
        if (clean(a.tlName) && !a.tlExcluded) {
          const tk = norm(a.tlName);
          const t = tlSum.get(tk) || { name: a.tlName, id: a.tlId, mobile: a.tlMobile, cur: 0, reportStock: 0, snapshotStock: 0, last: 0 };
          t.cur += Number(a.curTotal) || 0;
          t.last += Number(a.lastTotal) || 0;
          t.reportStock += Number(a.stockTotal) || 0;
          t.snapshotStock = Math.max(t.snapshotStock, Number(a.tlStockTotal) || 0);
          if (!t.id && a.tlId) t.id = a.tlId;
          if (!t.mobile && a.tlMobile) t.mobile = a.tlMobile;
          tlSum.set(tk, t);
        }
      }
      for (const t of tlSum.values()) {
        const quick = MP() && MP().quick ? MP().quick({ kind: 'ff-tl', name: t.name, sub: t.id || '', tlSet: new Set(), classMap: new Map(), bars: new Set() }) : null;
        const stock = quick && quick.stock ? quick.stock.total : Math.max(t.snapshotStock, t.reportStock);
        add('ff-tl', t.name, t.id, '', t.mobile, t.cur, stock, { tlId: t.id, last: t.last });
      }
      for (const a of FF.store.get('agents') || []) {
        if (!a.channel || /first/i.test(a.channel)) {
          add('ff-agent', a.name, a.id, a.tlName, '', a.n, 0, { tlId: a.tlId });
          if (clean(a.tlName)) add('ff-tl', a.tlName, a.tlId, '', '', 0, 0, { tlId: a.tlId });
        }
      }
      for (const s of FF.store.get('stockAgents') || []) {
        add('ff-agent', s.agentName, s.agentId, s.tlName, '', 0, s.n, { tlId: s.tlId });
        if (clean(s.tlName) && (!FF.config.isDirectAgent || !FF.config.isDirectAgent(s, 'ff'))) {
          add('ff-tl', s.tlName, s.tlId, '', '', 0, 0, { tlId: s.tlId });
        }
      }
    }
    // Canonical KPI enrichment: Summary search chips/list must show the same identity + stock + MTD/last
    // values as Master Search / masterProfile, not a stale GV REPORT snapshot.
    return [...map.values()].map((p) => {
      const base = { ...p, altIds: [...(p.altIds || [])] };
      try {
        const q = MP() && MP().quick ? MP().quick({
          kind: p.kind, name: p.name, sub: p.id || '', tlSet: p.tl ? new Set([p.tl]) : new Set(),
          classMap: new Map(), bars: new Set()
        }) : null;
        if (q) {
          base.cur = Number(q.totals && q.totals.curTotal) || 0;
          base.last = Number(q.totals && q.totals.lastTotal) || 0;
          base.stock = Number(q.stock && q.stock.total) || 0;
          base.curVc4 = Number(q.totals && q.totals.curVc4) || 0;
          base.curComm = Number(q.totals && q.totals.curComm) || 0;
          base.lastVc4 = Number(q.totals && q.totals.lastVc4) || 0;
          base.lastComm = Number(q.totals && q.totals.lastComm) || 0;
          base.tl = q.tl && q.tl.name ? q.tl.name : base.tl;
          base.tlId = q.tl && q.tl.id ? q.tl.id : base.tlId;
          base.priority = q.priority || base.priority;
          base.direct = !!q.direct;
          base.directLabel = q.directLabel || base.directLabel || '';
        }
      } catch { /* keep lightweight fallback */ }
      return base;
    }).sort((a, b) => (b.cur + b.stock) - (a.cur + a.stock));
  }

  // ---- v3.34 speed: caches (stale-while-revalidate) ------------------------------------------------
  // Pehle har page-open par loadPeople() poori master + performance + stock data series ko dobara
  // await karta tha → page lag karta tha. Ab list 3 min tak cache hoti hai; TTL ke baad purani list
  // turant dikhti hai aur naya data background me aa jata hai (agle open par).
  const peopleCache = { ff: null, gv: null }; // channel → { at, list }
  let peopleCacheGeneration = 0;
  const PEOPLE_TTL = 3 * 60 * 1000;
  function loadPeopleCached(channel) {
    const slot = peopleCache[channel];
    if (slot && slot.list && Date.now() - slot.at < PEOPLE_TTL) return slot.list;
    const generation = peopleCacheGeneration;
    const p = loadPeople(channel).then((list) => {
      if (generation === peopleCacheGeneration) peopleCache[channel] = { at: Date.now(), list };
      return list;
    });
    if (slot && slot.list) { p.catch(() => {}); return slot.list; } // stale abhi, refresh background me
    return p;
  }

  // Report bhi 2 min cache — aage-peeche agent switch karne par summary turant khulti hai.
  const reportCache = new Map(); // `${kind}|${name}|${id}` → { at, report }
  let reportCacheGeneration = 0;
  const REPORT_TTL = 2 * 60 * 1000;
  function buildReportCached(person, opts) {
    const key = `${person.kind}|${norm(person.name)}|${person.id || ''}`;
    const hit = reportCache.get(key);
    if (hit && Date.now() - hit.at < REPORT_TTL && !(opts && opts.fresh)) return hit.report;
    const generation = reportCacheGeneration;
    return buildReport(person, opts).then((rep) => {
      if (generation !== reportCacheGeneration) return rep;
      reportCache.set(key, { at: Date.now(), report: rep });
      // TL teams commonly exceed 24 agents; retain a full roster so the next Team Pack is also instant.
      while (reportCache.size > 128) reportCache.delete(reportCache.keys().next().value);
      return rep;
    });
  }
  function clearCaches() { peopleCacheGeneration++; reportCacheGeneration++; peopleCache.ff = null; peopleCache.gv = null; reportCache.clear(); }

  // ---- v3.34 add-ons: 6-month trend · alerts · team pack -------------------------------------------
  function ymBack(ym, k) {
    const seg = String(ym || '').match(/^(\d{4})-(\d{1,2})$/);
    const y = seg ? Number(seg[1]) : new Date().getFullYear();
    const m = seg ? Number(seg[2]) : new Date().getMonth() + 1;
    const d = new Date(y, m - 1 - k, 1);
    return `${d.getFullYear()}-${U.pad2(d.getMonth() + 1)}`;
  }
  const monthLbl = (ym) => { const seg = String(ym || '').match(/^(\d{4})-(\d{1,2})$/); return seg ? new Date(Number(seg[1]), Number(seg[2]) - 1, 1).toLocaleString('en-IN', { month: 'short' }) : String(ym || ''); };

  /** Pichhle 6 mahine ka issuance (EIR ledger; GV Master rows are the already-loaded fallback). */
  function monthlyTrend(person, ch, isTl, curYm) {
    const rows = (FF.store && FF.store.get && FF.store.get('agentClass')) || [];
    const nm = norm(person.name);
    const wantGv = ch === 'gv';
    let mine = rows.filter((r) => {
      if (wantGv !== /gv/i.test(r.channel || '')) return false;
      return norm(isTl ? r.tlName : r.name) === nm;
    });
    if (!mine.length && wantGv && FF.gv && FF.gv.issuanceRows) {
      const wantedId = clean(person.id || person.sub).toUpperCase();
      mine = (FF.gv.issuanceRows() || []).filter((r) => {
        if (isTl) return norm(r.tlName || r.tl) === nm && (!wantedId || !r.tlId || clean(r.tlId).toUpperCase() === wantedId);
        const rowId = clean(r.agentId || r.id || r.gvId || r.gvUniqueId).toUpperCase();
        return (wantedId && rowId && rowId === wantedId) || norm(r.agentName || r.name || r.gvName) === nm;
      }).map((r) => ({ ym: rowYm(r), n: r.n == null ? 1 : r.n }));
    }
    if (!mine.length) return null;
    const byYm = new Map();
    mine.forEach((r) => byYm.set(r.ym, (byYm.get(r.ym) || 0) + (Number(r.n) || 0)));
    const base = /^\d{4}-\d{2}$/.test(curYm) ? curYm : U.ymKey(new Date());
    return Array.from({ length: 6 }, (_, i) => {
      const ym = ymBack(base, 5 - i);
      return { ym, lbl: monthLbl(ym), n: byYm.get(ym) || 0 };
    });
  }

  /** TL: girne wale / chamakte / idle agents. Agent: khud ka drop/star flag. */
  function agentAlerts(p, isTl) {
    const ags = (p.agents || []).filter((a) => a && a.name);
    if (!isTl) {
      const t = p.totals || {};
      return {
        drop: (t.growth != null && t.growth <= -50 && (t.lastTotal || 0) >= 20) ? [p] : [],
        stars: (t.growth != null && t.growth >= 50 && (t.curTotal || 0) >= 10) ? [p] : [],
        idle: []
      };
    }
    return {
      drop: ags.filter((a) => a.growth != null && a.growth <= -50 && a.lastTotal >= 20).sort((a, b) => a.growth - b.growth).slice(0, 8),
      stars: ags.filter((a) => a.growth != null && a.growth >= 50 && a.curTotal >= 10).sort((a, b) => b.curTotal - a.curTotal).slice(0, 8),
      idle: ags.filter((a) => !a.curTotal && a.stockTotal > 0).sort((a, b) => b.stockTotal - a.stockTotal).slice(0, 8)
    };
  }

  function matchPeople(list, q) {
    const raw = clean(q);
    if (!raw) return list.slice(0, 30);
    const s = norm(raw);
    const dq = digits(raw);
    const wantMob = dq.length >= 4 ? mob10(raw) : '';
    const scored = [];
    for (const p of list) {
      const pName = norm(p.name);
      const pId = norm(p.id);
      const pTl = norm(p.tl);
      const pTlId = norm(p.tlId);
      const pMob = mob10(p.mobile);
      const pTlMob = mob10(p.tlMobile);
      const altIds = (p.altIds || []).map(norm);

      let score = 0;
      if (pName === s || pId === s || (pTlId && pTlId === s && p.kind.endsWith('tl'))) score = 1000;
      else if (wantMob && wantMob.length === 10 && (pMob === wantMob || (p.kind.endsWith('tl') && pTlMob === wantMob))) score = 950;
      else if (altIds.includes(s)) score = 920;
      else if (pName.startsWith(s) || (pId && pId.startsWith(s))) score = 800;
      else if (wantMob && ((pMob && pMob.includes(wantMob)) || (pTlMob && pTlMob.includes(wantMob)) || (digits(p.id).includes(dq)))) score = 700;
      else if (pName.includes(s) || (pId && pId.includes(s)) || altIds.some((x) => x.includes(s))) score = 600;
      else if ((pTl && pTl.includes(s)) || (pTlId && pTlId.includes(s))) score = p.kind.endsWith('tl') ? 750 : 450;

      if (score > 0) scored.push({ p, score: score + Math.min(99, (p.cur + p.stock) / 100) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 35).map((x) => x.p);
  }

  /** Top suggested TLs & Agents shown immediately at the top of the screen. */
  function topSuggestions(list, q) {
    if (clean(q)) return matchPeople(list, q).slice(0, 12);
    const tls = list.filter((p) => p.kind.endsWith('tl')).slice(0, 5);
    const ags = list.filter((p) => !p.kind.endsWith('tl')).slice(0, 7);
    return [...tls, ...ags];
  }

  const monthOrdinal = (ym) => {
    const m = String(ym || '').match(/^(\d{4})-(\d{1,2})$/);
    return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
  };
  const monthDistance = (from, to) => {
    const a = monthOrdinal(from), b = monthOrdinal(to);
    return a === null || b === null ? null : Math.max(0, b - a);
  };
  const currentYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  function rowYm(row) {
    if (/^\d{4}-\d{1,2}$/.test(String(row && row.ym || ''))) return String(row.ym);
    const date = row && (row.date || row.d || row.dateKey);
    if (!date) return '';
    const key = typeof date === 'string' ? date : (date instanceof Date ? date.toISOString() : String(date));
    const m = key.match(/(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : '';
  }
  function sameAgentRow(row, agent, person) {
    const rowId = clean(row && (row.agentId || row.id || row.gvId || row.gvUniqueId)).toUpperCase();
    const agentId = clean(agent && (agent.id || agent.agentId)).toUpperCase();
    const rowName = norm(row && (row.agentName || row.name || row.gvName));
    const agentName = norm(agent && (agent.name || agent.agentName));
    const byId = rowId && agentId && rowId === agentId;
    if (!byId && (!rowName || rowName !== agentName)) return false;
    const targetTl = person && /tl$/i.test(String(person.kind || '')) ? norm(person.name) : norm((agent && (agent.tlName || agent.tl)) || (person && person.tl));
    const rowTl = norm(row && (row.tlName || row.tl));
    return !(targetTl && rowTl && rowTl !== targetTl);
  }
  const activityKey = (agent) => `${clean(agent && (agent.id || agent.agentId)).toUpperCase()}|${norm(agent && (agent.name || agent.agentName))}`;
  function activityContext(person, agents, ch) {
    const list = (agents || []).filter((a) => a && a.name);
    const byId = new Map(), byName = new Map(), sources = new Map(), latest = new Map();
    const index = (map, key, agent) => {
      if (!key) return;
      const values = map.get(key) || [];
      values.push(agent); map.set(key, values);
    };
    list.forEach((agent) => {
      const key = activityKey(agent);
      index(byId, clean(agent.id || agent.agentId).toUpperCase(), agent);
      index(byName, norm(agent.name || agent.agentName), agent);
      latest.set(key, '');
    });
    const performanceRows = ch === 'ff'
      ? ((FF.pages.performance && FF.pages.performance.agents && FF.pages.performance.agents()) || [])
      : (((FF.pages.gvPerformance && FF.pages.gvPerformance.sourceRows && FF.pages.gvPerformance.sourceRows()) || (FF.gv && FF.gv.get && FF.gv.get('report'))) || []);
    list.forEach((agent) => {
      const source = performanceRows.find((row) => sameAgentRow(row, agent, person)) || {};
      sources.set(activityKey(agent), source);
    });
    const findAgent = (row) => {
      const id = clean(row && (row.agentId || row.id || row.gvId || row.gvUniqueId)).toUpperCase();
      const name = norm(row && (row.agentName || row.name || row.gvName));
      const candidates = [...(id ? (byId.get(id) || []) : []), ...(name ? (byName.get(name) || []) : [])];
      const seen = new Set();
      for (const agent of candidates) {
        const key = activityKey(agent);
        if (seen.has(key)) continue;
        seen.add(key);
        if (sameAgentRow(row, agent, person)) return agent;
      }
      return null;
    };
    const updateLatest = (rows, fallback) => {
      for (const row of rows || []) {
        const rowChannel = clean(row.channel || '');
        if (!fallback && rowChannel && (ch === 'gv' ? !/gv|green/i.test(rowChannel) : !/first|ff/i.test(rowChannel))) continue;
        const agent = findAgent(row);
        if (!agent) continue;
        const key = activityKey(agent);
        if (fallback && latest.get(key)) continue;
        if (!(Number(fallback && row.n == null ? 1 : row.n) > 0)) continue;
        const ym = rowYm(row);
        if (ym && ym > (latest.get(key) || '')) latest.set(key, ym);
      }
    };
    const monthly = [
      ...((FF.store && FF.store.get && FF.store.get('agentClass')) || []),
      ...((FF.store && FF.store.get && FF.store.get('agents')) || [])
    ];
    updateLatest(monthly, false);
    // Monthly EIR is exact. For GV agents with no ledger month, index the already-loaded issuance
    // rows once (EIR or GV Master), not once per agent; never wait for another sheet request.
    if (ch === 'gv' && FF.gv && FF.gv.issuanceRows && [...latest.values()].some((ym) => !ym)) {
      updateLatest(FF.gv.issuanceRows() || [], true);
    }
    return { sources, latest };
  }
  function activityStatus(person, agent, ch, context) {
    const ctx = context || activityContext(person, [agent], ch);
    const key = activityKey(agent);
    const source = ctx.sources.get(key) || {};
    const latestYm = ctx.latest.get(key) || '';
    const curTotal = Number(agent && (agent.curTotal ?? agent.cur ?? (agent.totals && agent.totals.curTotal))) || Number(source.curTotal) || 0;
    const rawLastActive = clean(source.lastActive || source.tlLastActive || agent.lastActive || '');
    const rawStatus = clean(source.agentStatus || source.status || agent.agentStatus || agent.status || '');
    const nowYm = currentYm();
    let inactiveMonths = latestYm ? monthDistance(latestYm, nowYm) : null;
    if (curTotal > 0) inactiveMonths = 0;
    if (inactiveMonths === null) {
      const days = rawLastActive.match(/(\d+)\s*days?\s*inactive/i);
      if (days) inactiveMonths = Math.max(1, Math.floor(Number(days[1]) / 30));
      else if (/inactive|dormant|not active/i.test(`${rawLastActive} ${rawStatus}`)) inactiveMonths = 1;
      else if (/\bactive\b/i.test(`${rawLastActive} ${rawStatus}`)) inactiveMonths = 0;
      else inactiveMonths = 1;
    }
    const status = inactiveMonths > 0 ? 'Inactive' : 'Active';
    return {
      activityStatus: status,
      inactiveMonths: inactiveMonths > 0 ? inactiveMonths : 0,
      inactiveDuration: inactiveMonths > 0 ? `Inactive By ${inactiveMonths} Month` : '',
      lastActiveYm: latestYm,
      performanceStatus: rawStatus,
      lastActive: rawLastActive
    };
  }

  /** profile ke agent row (masterProfile shape) ko summary shape me laao — Last/MTD/VC4/Comm/Stock + growth. */
  function normAgentRow(a) {
    return {
      ...a,
      curTotal: a.cur ?? a.curTotal ?? 0, lastTotal: a.last ?? a.lastTotal ?? 0,
      curVc4: a.curVc4 || 0, curComm: a.curComm || 0,
      stockTotal: a.stockTotal || ((a.stockVc4 || 0) + (a.stockComm || 0)),
      growth: U.growth(a.cur ?? a.curTotal ?? 0, a.last ?? a.lastTotal ?? 0)
    };
  }
  /** TL ka stock hisaab — screen aur saare exports (text / CSV / Excel / PDF / Team Pack) isi ko use karte
   *  hain: `agents` (TL ki apni row ke bina) + `self` (TL ke paas) aur TL total = own + agents. */
  function tlSplit(r) {
    const p = (r && r.p) || {}, ts = p.tlStock || {}, t = p.totals || {};
    const agents = (p.agents || []).slice(), self = p.selfAgent || null;
    const own = ts.own || null, ag = ts.agents || null;
    return {
      own, ag, agents, self, list: self ? [self, ...agents] : agents, has: !!(own && ag),
      sum: (k) => U.sum(agents, (a) => Number(a[k]) || 0),
      stockTotal: Number(t.stockTotal) || 0,
      text: own && ag ? `TL ke paas (own) ${fmt(own.total)} + agents ke paas ${fmt(ag.total)} = TL total ${fmt(t.stockTotal)}` : ''
    };
  }
  async function buildReport(person, opts) {
    const raw = await MP().build({
      kind: person.kind, name: person.name, sub: person.id || '',
      tlSet: new Set(person.tl ? [person.tl] : []), classMap: new Map(), bars: new Set()
    });
    const ch = /^gv/.test(person.kind) ? 'gv' : 'ff';
    const isTl = /tl$/.test(person.kind);
    const t = raw.totals || {}, s = raw.stock || {}, m = raw.months || {};
    const p = {
      ...raw, kind: isTl ? 'tl' : 'agent', rawKind: person.kind, channel: raw.channel || (ch === 'gv' ? 'GV Partner' : 'First Forward'),
      tlName: (raw.tl && raw.tl.name) || person.tl || '',
      tlId: (raw.tl && raw.tl.id) || person.tlId || '',
      tlMobile: (raw.tl && raw.tl.mobile) || person.tlMobile || '',
      curYm: m.cur || '', lastYm: m.last || '',
      expected: raw.projT1 && raw.projT1.projectedCurrent != null ? Number(raw.projT1.projectedCurrent) || 0 : ((raw.projT1 && raw.projT1.total) || 0),
      runRate: raw.projT1 && raw.projT1.basis && raw.projT1.basis.growthElapsed > 0 ? (Number(raw.projT1.projectedCurrent) || 0) / Number(raw.projT1.basis.growthElapsed) : ((raw.calc && raw.calc.total && raw.calc.total.rate) || 0),
      totals: {
        ...t,
        curVc4: t.curVc4 || 0, curComm: t.curComm || 0, curTotal: t.curTotal || 0,
        lastVc4: t.lastVc4 || 0, lastComm: t.lastComm || 0, lastTotal: t.lastTotal || 0,
        stockVc4: s.vc4 || 0, stockComm: s.comm || 0, stockTotal: s.total || 0,
        growth: raw.growthNum != null ? raw.growthNum : U.growth(t.curTotal || 0, t.lastTotal || 0)
      },
      classTable: (raw.classes || []).map((c) => ({ ...c, growth: c.last ? ((c.cur - c.last) / c.last) * 100 : null })),
      agents: (raw.agents || []).map((a) => normAgentRow(a)),
      // v3.40 — TL ki APNI stock row agents se alag (masterProfile bhi alag rakhta hai): count me nahi ginti,
      // par UI/exports me dikhni chahiye — isliye `selfAgent` + composition ka `stockSplit` yahan pass hota hai.
      selfAgent: raw.selfAgent ? normAgentRow(raw.selfAgent) : null,
      stockSplit: raw.stockSplit || null,
      linkedTl: raw.linkedTl || null
    };
    const activityData = activityContext(person, isTl ? (p.selfAgent ? [p.selfAgent, ...p.agents] : p.agents) : [p], ch);
    if (isTl) {
      p.agents = p.agents.map((a) => ({ ...a, ...activityStatus(person, a, ch, activityData) }));
      if (p.selfAgent) Object.assign(p.selfAgent, activityStatus(person, p.selfAgent, ch, activityData));
    } else Object.assign(p, activityStatus(person, p, ch, activityData));
    const trend = monthlyTrend(person, ch, isTl, m.cur || '');
    const report = { person, p, age: null, ageState: 'idle', ch, isTl, trend, generatedAt: Date.now() };
    // 🧓 Ageing ab report ka rasta NAHI rokti. Summary page `{ age: false }` se base report turant dikhata hai (stock in hand,
    // issuance, charts — sab REPORT / StockDataa group-by se) aur ageing background me aati hai. Exports / Team Pack
    // (`age` default) ageing ka bounded intezaar karte hain — kabhi infinite nahi.
    if (!opts || opts.age !== false) await loadAgeing(report, { waitMs: opts && opts.ageWaitMs });
    return report;
  }
  const AGE_WAIT_MS = 60000;
  /** Report ki stock ageing (server index se) laao — report.age / report.ageState set karta hai. Kabhi throw nahi karta. */
  async function loadAgeing(report, opts) {
    if (!report) return null;
    if (!(FF.stockAge && FF.stockAge.compute)) { report.ageState = 'unavailable'; return null; }
    const person = report.person || {}, p = report.p || {}, ch = report.ch, isTl = report.isTl;
    let scope;
    if (isTl) {
      // Team-ageing ko TL display-name se nahi, selected TL ke exact agent IDs/holders se compute karo.
      // Isse same-name TLs ki ageing merge nahi hoti aur consolidated table ko per-agent buckets milte hain.
      const holders = [p.selfAgent, ...(p.agents || [])].filter(Boolean);
      // Use IDs whenever present; name aliases can resolve to another same-name holder in the age index.
      const keys = [...new Set(holders.flatMap((a) => (a.id ? [a.id] : [a.name]).filter(Boolean).map((x) => clean(x))))];
      scope = keys.length && keys.length <= 400
        ? { kind: 'agent', key: keys[0], keys, ch, title: person.name }
        : { kind: 'tl', key: person.name, ch, title: person.name };
    } else {
      scope = { kind: 'agent', key: person.id || person.name, keys: [person.name, person.id].filter(Boolean), ch, title: person.name };
    }
    report.ageState = 'loading';
    let res = null;
    try { res = await FF.stockAge.compute(scope, { waitMs: (opts && opts.waitMs) || AGE_WAIT_MS }); } catch { res = null; }
    const age = res && (res[ch] || res.ff || res.gv) || null;
    if (age) { report.age = age; report.ageState = 'ready'; }
    else {
      const st = FF.stockAge.status ? FF.stockAge.status() : null;
      report.ageState = st && st.building && !st.error ? 'building' : 'failed';
    }
    return report.age;
  }

  function reportText(r) {
    const p = r.p, t = p.totals || {}, age = r.age;
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const S = tlSplit(r);
    const lines = [
      `*📋 ${p.name}* (${chLabel} · ${r.isTl ? 'Team Leader' : 'Agent'}${p.id ? ` · ID: ${p.id}` : ''})`,
      `${p.mobile && canContacts() ? `📞 Mobile: ${p.mobile}` : ''}${!r.isTl && p.tlName ? ` · 👥 TL: ${p.tlName}${p.tlId ? ` (${p.tlId})` : ''}` : ''}`.replace(/^ · /, ''),
      `Priority: ${p.priority || '—'}${p.status ? ` · Performance: ${p.status}` : ''}${p.activityStatus ? ` · Activity: ${p.activityStatus}` : ''}${p.inactiveDuration ? ` · ${p.inactiveDuration}` : ''}`,
      '',
      `*📊 KPI Summary:*`,
      `• Current Month (${p.curYm || 'MTD'}): *${fmt(t.curTotal)}* (VC4: ${fmt(t.curVc4)} · Comm: ${fmt(t.curComm)})`,
      `• Last Month (${p.lastYm || 'Prev'}): *${fmt(t.lastTotal)}* (VC4: ${fmt(t.lastVc4)} · Comm: ${fmt(t.lastComm)})`,
      `• Growth: *${t.growth == null ? '—' : `${t.growth >= 0 ? '+' : ''}${t.growth.toFixed(1)}%`}* · Expected Month-End: *${fmt(p.expected)}* (Run-rate: ${fmt(p.runRate, true)}/day)`,
      `• Stock in Hand: *${fmt(t.stockTotal)}*${r.isTl && S.has ? ` (TL ke paas ${fmt(S.own.total)} + agents ke paas ${fmt(S.ag.total)} — TL ki row alag, double count nahi)` : ''} (VC4: ${fmt(t.stockVc4)} · Comm: ${fmt(t.stockComm)})`
    ].filter((x, i) => i !== 1 || Boolean(x));

    if ((p.classTable || []).length) {
      lines.push('', `*🚗 Class-wise Issuance & Stock (${p.lastYm || 'Last'} → ${p.curYm || 'MTD'}):*`);
      p.classTable.forEach((c) => {
        lines.push(`• ${c.cls}: Last ${fmt(c.last)} → MTD *${fmt(c.cur)}* | Stock: *${fmt(c.stock)}*`);
      });
      lines.push(`*∑ Class Grand Total: Last ${fmt(t.lastTotal)} → MTD ${fmt(t.curTotal)} | Stock ${fmt(t.stockTotal)}*`);
    }

    if (age && age.total) {
      lines.push('', `*⏳ Stock Ageing (Total ${fmt(age.total)} tags):*`);
      lines.push(`• Buckets: ${age.buckets.filter((b) => b.n > 0).map((b) => `${b.label}: ${fmt(b.n)}`).join(' · ')}`);
      if ((age.byClass || []).length) {
        age.byClass.forEach((c) => lines.push(`  - ${c.cls}: Total ${fmt(c.total)} (30+d: ${fmt(c.old30)} · 90+d: ${fmt(c.old60)})`));
      }
      lines.push(`*∑ Ageing Grand Total: ${fmt(age.total)} tags (0–30d: ${fmt(age.total - age.old30)} · 30+d Old: ${fmt(age.old30)} · 90+d Critical: ${fmt(age.old60)})*`);
    }

    if (r.isTl && S.list.length) {
      const sumLast = S.sum('lastTotal'), sumCur = S.sum('curTotal'), sumVc4 = S.sum('curVc4'), sumComm = S.sum('curComm'), sumStock = S.sum('stockTotal');
      lines.push('', `*🧑‍💼 Team Agents (${fmt(S.agents.length)}):*`);
      S.list.forEach((a) => {
        const activity = a.activityStatus || 'Inactive';
        lines.push(`${a.isSelf ? '👤' : '•'} ${a.name}${a.id ? ` (${a.id})` : ''}${a.isSelf ? ' — TL ka apna stock' : ''}: Last ${fmt(a.lastTotal)} · MTD *${fmt(a.curTotal)}* · Stock ${fmt(a.stockTotal)} · Status: ${activity}${a.inactiveDuration ? ` · ${a.inactiveDuration}` : ''}`);
      });
      lines.push(`*∑ Agents total (${fmt(S.agents.length)} Agents): Last ${fmt(sumLast)} · MTD ${fmt(sumCur)} (VC4 ${fmt(sumVc4)} · Comm ${fmt(sumComm)}) · Stock ${fmt(S.has ? S.ag.total : sumStock)}*`);
      if (S.has) lines.push(`*∑ ${S.text}*`);
    }

    lines.push('', `*🏁 GRAND TOTAL SUMMARY: Last ${fmt(t.lastTotal)} | MTD ${fmt(t.curTotal)} | Expected ${fmt(p.expected)} | Stock ${fmt(t.stockTotal)}${age ? ` | 30+d Old ${fmt(age.old30)}` : ''}*`);
    return lines.join('\n');
  }

  function reportCsv(r) {
    const p = r.p, t = p.totals || {}, age = r.age;
    // Team-agent rows neeche explicit status columns ke saath add hote hain; profile CSV ka
    // aggregate/class-wise section keep karo, duplicate legacy team rows ko suppress karke.
    const rows = MP().csvRows(r.isTl ? { ...p, agents: [], selfAgent: null } : p).map((row) => [...row]);
    if (!r.isTl) {
      rows.push(['Activity Status', p.activityStatus || '']);
      rows.push(['Inactive Duration', p.inactiveDuration || '']);
      rows.push(['Last Active Month', p.lastActiveYm || '']);
    }
    const S = tlSplit(r);
    if (r.isTl && S.list.length) {
      rows.push([]);
      rows.push(['Team Agents', `${S.agents.length} agents under ${p.name}${S.self ? ' (TL ki apni row alag niche)' : ''}`]);
      rows.push(['Agent Name', 'ID', 'Last Month', 'Current (MTD)', 'VC4', 'Comm', 'Growth %', 'Stock', 'Status', 'Inactive Duration']);
      S.list.forEach((a) => rows.push([a.isSelf ? `👤 ${a.name} (TL — apna stock)` : a.name, a.id || '', a.lastTotal, a.curTotal, a.curVc4, a.curComm, a.growth == null ? '' : Number(a.growth.toFixed(1)), a.stockTotal, a.activityStatus || 'Inactive', a.inactiveDuration || '']));
      rows.push(['AGENTS TOTAL', `${S.agents.length} Agents`, S.sum('lastTotal'), S.sum('curTotal'), S.sum('curVc4'), S.sum('curComm'), '', S.has ? S.ag.total : S.sum('stockTotal'), `${S.agents.filter((a) => a.activityStatus === 'Active').length} Active`, `${S.agents.filter((a) => a.activityStatus !== 'Active').length} Inactive`]);
      if (S.has) {
        rows.push(['+ TL KE PAAS (OWN)', p.name, S.self ? S.self.lastTotal : '', S.self ? S.self.curTotal : '', '', '', '', S.own.total, '', '']);
        rows.push(['= TL TOTAL (own + agents)', p.name, t.lastTotal, t.curTotal, t.curVc4, t.curComm, '', t.stockTotal, '', '']);
      }
    }
    if (age && age.total) {
      rows.push([]);
      rows.push(['Stock Ageing Class', ...age.buckets.map((b) => b.label), '30+d Old', '90+d Critical', 'Total Stock']);
      for (const c of age.byClass || []) {
        rows.push([c.cls, ...age.buckets.map((b) => c[b.key] || 0), c.old30, c.old60, c.total]);
      }
      rows.push(['STOCK AGEING GRAND TOTAL', ...age.buckets.map((b) => b.n || 0), age.old30, age.old60, age.total]);
    }
    rows.push([]);
    rows.push(['FINAL GRAND TOTAL SUMMARY', `Last Month: ${t.lastTotal}`, `Current MTD: ${t.curTotal}`, `Expected: ${p.expected}`, `Stock Total: ${t.stockTotal}`, age ? `30+d Old: ${age.old30}` : '']);
    return rows;
  }

  /** v3.34 — multi-sheet Excel workbook: Summary / Class-wise / Stock Ageing / Team Agents. */
  function reportXlsx(r) {
    const p = r.p, t = p.totals || {}, age = r.age;
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const sheets = [];
    sheets.push({
      name: 'Summary',
      header: ['Field', 'Value'],
      rows: [
        ['Report', `${chLabel} · ${r.isTl ? 'Team Leader' : 'Agent'} Summary`],
        ['Name', p.name], ['ID', p.id || ''], ['Mobile', canContacts() ? (p.mobile || '') : ''],
        ...(r.isTl ? [] : [['TL', p.tlName || ''], ['TL ID', p.tlId || '']]),
        ['Priority', p.priority || ''],
        ...(r.isTl ? [] : [['Activity Status', p.activityStatus || ''], ['Inactive Duration', p.inactiveDuration || ''], ['Last Active Month', p.lastActiveYm || '']]),
        ['Current Month', p.curYm || ''],
        [`Issuance ${p.curYm || '(MTD)'}`, t.curTotal],
        ['VC4 (MTD)', t.curVc4], ['Comm (MTD)', t.curComm],
        ['Last Month', p.lastYm || ''],
        [`Issuance ${p.lastYm || '(Last)'}`, t.lastTotal],
        ['VC4 (Last)', t.lastVc4], ['Comm (Last)', t.lastComm],
        ['Growth %', t.growth == null ? '' : Number(t.growth.toFixed(1))],
        ['Expected Month-End', p.expected], ['Run-rate / day', p.runRate],
        ['Stock in Hand', t.stockTotal],
        ...(r.isTl && p.tlStock && p.tlStock.own && p.tlStock.agents ? [['TL own stock (TL ke paas)', p.tlStock.own.total], ['Agents stock (agents ke paas)', p.tlStock.agents.total], ['Stock formula', 'TL ke paas (own) + agents ke paas = TL total — TL ki row agents me dobara nahi judti']] : []),
        ['VC4 Stock', t.stockVc4], ['Comm Stock', t.stockComm],
        ['30+d Old Stock', age ? age.old30 : ''],
        ['90+d Critical Stock', age ? age.old60 : ''],
        ['Generated', new Date().toLocaleString('en-IN')]
      ]
    });
    sheets.push({
      name: 'Class-wise',
      header: ['Class', p.lastYm || 'Last Month', p.curYm || 'Current (MTD)', 'Growth %', 'Stock in Hand'],
      rows: (p.classTable || []).map((c) => [c.cls, c.last, c.cur, c.growth == null ? '' : Number(c.growth.toFixed(1)), c.stock])
        .concat([['GRAND TOTAL', t.lastTotal, t.curTotal, t.growth == null ? '' : Number(t.growth.toFixed(1)), t.stockTotal]])
    });
    if (age && age.total) {
      sheets.push({
        name: 'Stock Ageing',
        header: ['Class', ...age.buckets.map((b) => b.label), '30+d Old', '90+d Critical', 'Total Stock'],
        rows: (age.byClass || []).map((c) => [c.cls, ...age.buckets.map((b) => c[b.key] || 0), c.old30, c.old60, c.total])
          .concat([['STOCK AGEING GRAND TOTAL', ...age.buckets.map((b) => b.n || 0), age.old30, age.old60, age.total]])
      });
    }
    const S = tlSplit(r);
    if (r.isTl && S.list.length) {
      sheets.push({
        name: 'Team Agents',
        header: ['Agent Name', 'ID', p.lastYm || 'Last Month', p.curYm || 'Current (MTD)', 'VC4', 'Comm', 'Growth %', 'Stock', 'Status', 'Inactive Duration'],
        rows: S.list.map((a) => [a.isSelf ? `👤 ${a.name} (TL — apna stock)` : a.name, a.id || '', a.lastTotal, a.curTotal, a.curVc4, a.curComm, a.growth == null ? '' : Number(a.growth.toFixed(1)), a.stockTotal, a.activityStatus || 'Inactive', a.inactiveDuration || ''])
          .concat([
            ['AGENTS TOTAL', `${S.agents.length} Agents`, S.sum('lastTotal'), S.sum('curTotal'), S.sum('curVc4'), S.sum('curComm'), '', S.has ? S.ag.total : S.sum('stockTotal'), `${S.agents.filter((a) => a.activityStatus === 'Active').length} Active`, `${S.agents.filter((a) => a.activityStatus !== 'Active').length} Inactive`],
            ...(S.has ? [['= TL TOTAL (own + agents)', p.name, t.lastTotal, t.curTotal, t.curVc4, t.curComm, '', t.stockTotal, S.text, '']] : [])
          ])
      });
    }
    return sheets;
  }

  function makePdf(r) {
    const p = r.p, age = r.age, t = p.totals || {};
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const doc = FF.pdf.doc({
      title: `${chLabel} · ${r.isTl ? 'Team Leader' : 'Agent'} Summary`,
      subtitle: `${p.name}${p.id ? ` (ID: ${p.id})` : ''}${p.tlName && !r.isTl ? ` · TL: ${p.tlName}` : ''}${p.mobile && canContacts() ? ` · ${p.mobile}` : ''}${p.activityStatus ? ` · ${p.activityStatus}${p.inactiveDuration ? ` (${p.inactiveDuration})` : ''}` : ''}`,
      right: `${new Date().toLocaleDateString('en-IN')} · ${p.curYm || ''}`
    });
    doc.kpis([
      { label: `This Month (${p.curYm || 'MTD'})`, value: fmt(t.curTotal), sub: `VC4 ${fmt(t.curVc4)} · Comm ${fmt(t.curComm)}`, color: '#2563eb' },
      { label: `Last Month (${p.lastYm || 'Prev'})`, value: fmt(t.lastTotal), sub: `VC4 ${fmt(t.lastVc4)} · Comm ${fmt(t.lastComm)}`, color: '#7c3aed' },
      { label: 'Growth / Expected', value: t.growth === null || t.growth === undefined ? '—' : `${t.growth >= 0 ? '+' : ''}${t.growth.toFixed(0)}%`, sub: `Expected ${fmt(p.expected)} · ${fmt(p.runRate, true)}/d`, color: (t.growth || 0) >= 0 ? '#16a34a' : '#dc2626' },
      { label: 'Stock in Hand', value: fmt(t.stockTotal), sub: `${r.isTl && p.tlStock && p.tlStock.own && p.tlStock.agents ? `Own ${fmt(p.tlStock.own.total)} + agents ${fmt(p.tlStock.agents.total)} · ` : ''}VC4 ${fmt(t.stockVc4)} · Comm ${fmt(t.stockComm)}`, color: '#0891b2' },
      { label: '30+d Old Stock', value: age ? fmt(age.old30) : '—', sub: age ? `90+d: ${fmt(age.old60)} · 180+d: ${fmt((age.buckets[4] && age.buckets[4].n) || 0)}` : 'Ageing', color: age && age.old60 ? '#dc2626' : '#d97706' }
    ]);

    doc.section(`Class-wise Issuance (${p.lastYm || 'Last'} vs ${p.curYm || 'MTD'}) & Stock in Hand`);
    const clsRows = (p.classTable || []).filter((x) => x.cur || x.last || x.stock);
    doc.table({
      headers: ['Class', p.lastYm || 'Last Month', p.curYm || 'Current (MTD)', 'Growth %', 'Stock in Hand'],
      align: ['left', 'right', 'right', 'right', 'right'],
      rows: clsRows.map((x) => [x.cls, fmt(x.last), fmt(x.cur), x.growth === null || x.growth === undefined ? '—' : `${x.growth >= 0 ? '+' : ''}${x.growth.toFixed(0)}%`, fmt(x.stock)]),
      foot: ['GRAND TOTAL', fmt(t.lastTotal), fmt(t.curTotal), t.growth === null || t.growth === undefined ? '—' : `${t.growth >= 0 ? '+' : ''}${t.growth.toFixed(0)}%`, fmt(t.stockTotal)]
    });

    if (age && age.total) {
      doc.section(`Stock Ageing — ${fmt(age.total)} tags (30+d: ${fmt(age.old30)} · 90+d: ${fmt(age.old60)})`);
      doc.table({
        headers: ['Class', ...age.buckets.map((b) => b.label), '30+d Old', '90+d Critical', 'Total'],
        align: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        rows: (age.byClass || []).map((c) => [c.cls, ...age.buckets.map((b) => fmt(c[b.key] || 0)), fmt(c.old30), fmt(c.old60), fmt(c.total)]),
        foot: ['GRAND TOTAL', ...age.buckets.map((b) => fmt(b.n || 0)), fmt(age.old30), fmt(age.old60), fmt(age.total)]
      });
    }

    const S = tlSplit(r);
    if (r.isTl && S.list.length) {
      const sumLast = S.sum('lastTotal'), sumCur = S.sum('curTotal'), sumVc4 = S.sum('curVc4'), sumComm = S.sum('curComm'), sumStock = S.sum('stockTotal');
      const teamGrowth = U.growth(sumCur, sumLast);
      doc.section(`Team Agents (${fmt(S.agents.length)}) — Issuance, Stock & Activity`, S.has ? S.text : '');
      doc.table({
        headers: ['Agent Name', 'ID', 'Last Month', 'Current (MTD)', 'VC4', 'Comm', 'Growth %', 'Stock', 'Status', 'Inactive Duration'],
        align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'left'],
        rows: S.list.map((a) => [a.isSelf ? `👤 ${a.name} (TL)` : a.name, a.id || '—', fmt(a.lastTotal), fmt(a.curTotal), fmt(a.curVc4), fmt(a.curComm), a.growth === null || a.growth === undefined ? '—' : `${a.growth >= 0 ? '+' : ''}${a.growth.toFixed(0)}%`, fmt(a.stockTotal), a.activityStatus || 'Inactive', a.inactiveDuration || '—']),
        foot: [`= TL TOTAL (${fmt(S.agents.length)} Agents${S.has ? ` + TL own ${fmt(S.own.total)}` : ''})`, '', fmt(t.lastTotal), fmt(t.curTotal), fmt(t.curVc4), fmt(t.curComm), teamGrowth === null ? '—' : `${teamGrowth >= 0 ? '+' : ''}${teamGrowth.toFixed(0)}%`, fmt(S.has ? S.stockTotal : sumStock), `${S.agents.filter((a) => a.activityStatus === 'Active').length} Active`, `${S.agents.filter((a) => a.activityStatus !== 'Active').length} Inactive`]
      });
    }

    doc.footer(`${FF.config.brand || 'ApnaPayment'} · ${chLabel} · Grand Total: Last ${fmt(t.lastTotal)} | MTD ${fmt(t.curTotal)} | Stock ${fmt(t.stockTotal)}`);
    return doc.finish();
  }

  function chartsSectionHtml(r) {
    const C = FF.charts;
    if (!C) return '';
    const p = r.p;
    const cls = (p.classTable || []).filter((x) => x.cur || x.last || x.stock);
    const stockCls = cls.filter((x) => x.stock > 0);
    const scopeParam = r.isTl
      ? `tl=${encodeURIComponent(p.name)}${(p.stockTlId || p.id) ? `&tlId=${encodeURIComponent(p.stockTlId || p.id)}` : ''}`
      : `agent=${encodeURIComponent(p.name)}${p.id ? `&agentId=${encodeURIComponent(p.id)}` : ''}${p.tlId ? `&tlId=${encodeURIComponent(p.tlId)}&tl=${encodeURIComponent(p.tlName || '')}` : ''}`;
    const curSpec = `src=${r.ch}&scope=mtd&ym=${encodeURIComponent(p.curYm || '')}&${scopeParam}`;
    const stockSpec = `src=${r.ch}&scope=stock&${scopeParam}`;

    const issuanceChart = cls.length
      ? C.bars({
          labels: cls.map((x) => x.cls),
          height: 190,
          series: [
            { name: p.lastYm || 'Last Month', values: cls.map((x) => x.last || 0), color: '#c7d2fe' },
            { name: p.curYm || 'This Month (MTD)', values: cls.map((x) => x.cur || 0), color: '#4f46e5' }
          ],
          showValues: true,
          onClickAttr: (i) => `data-kpi="${esc(`${curSpec}&cls=${encodeURIComponent(cls[i].cls)}`)}"`
        })
      : '<div class="empty">Class-wise issuance data abhi nahi hai</div>';

    const stockChart = stockCls.length
      ? `<div class="grid g-2" style="gap:12px;align-items:center">
          <div>${C.bars({
            labels: stockCls.map((x) => x.cls),
            height: 180,
            series: [{ name: 'Stock in Hand', values: stockCls.map((x) => x.stock || 0), color: '#0d9488' }],
            showValues: true,
            onClickAttr: (i) => `data-kpi="${esc(`${stockSpec}&cls=${encodeURIComponent(stockCls[i].cls)}`)}"`
          })}</div>
          <div>${C.donut({
            items: stockCls.map((x) => ({ label: x.cls, value: x.stock, attr: `data-kpi="${esc(`${stockSpec}&cls=${encodeURIComponent(x.cls)}`)}"` })),
            subtitle: 'Stock',
            size: 150
          })}</div>
        </div>`
      : '<div class="empty">Is waqt stock in hand 0 hai</div>';

    return `<div class="as-two" style="margin-bottom:14px">
      <div class="card card-primary">
        <div class="card-head"><h3>📊 Class-wise Issuance Chart (${esc(p.lastYm || 'Last')} vs ${esc(p.curYm || 'MTD')})</h3><span class="dim small">Bar par click karke class details dekhein</span></div>
        <div class="card-body">${issuanceChart}</div>
      </div>
      <div class="card card-teal">
        <div class="card-head"><h3>📦 Class-wise Stock in Hand Chart</h3><span class="dim small">Total Stock: <b>${fmt((p.totals && p.totals.stockTotal) || 0)}</b></span></div>
        <div class="card-body">${stockChart}</div>
      </div>
    </div>`;
  }

  function openAgeingDrill(r, minDays, filterCls) {
    const age = r.age;
    const p = r.p;
    if (!age || !FF.app || !FF.app.openDrawer) {
      U.toast('Stock ageing data load ho raha hai…', 'info');
      return;
    }
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const rows = (age.byClass || []).filter((c) => (!filterCls || c.cls === filterCls) && (minDays === 90 ? c.old60 > 0 : minDays === 30 ? c.old30 > 0 : c.total > 0));
    const title = `${p.name} · ${filterCls ? `${filterCls} ` : ''}${minDays ? `${minDays}+ Days Old ` : ''}Stock Ageing`;
    const tot30 = U.sum(rows, (c) => c.old30), tot60 = U.sum(rows, (c) => c.old60), totAll = U.sum(rows, (c) => c.total);
    const body = `<div class="dsec">
      <div class="mini-grid">
        <div class="mini-kpi c1"><span class="mini-label">Total Stock</span><b class="mini-value">${fmt(totAll)}</b><span class="mini-foot">${esc(chLabel)}</span></div>
        <div class="mini-kpi c4"><span class="mini-label">30+d Old Stock</span><b class="mini-value">${fmt(tot30)}</b><span class="mini-foot">Needs attention</span></div>
        <div class="mini-kpi c6"><span class="mini-label">90+d Critical</span><b class="mini-value">${fmt(tot60)}</b><span class="mini-foot">Urgent action</span></div>
      </div>
      <div class="table-wrap"><table class="tbl compact">
        <thead><tr><th>Class</th>${age.buckets.map((b) => `<th class="num">${esc(b.label)}</th>`).join('')}<th class="num">30+d</th><th class="num">90+d</th><th class="num">Total</th></tr></thead>
        <tbody>${rows.map((c) => `<tr class="clickable" data-kpi="${esc(`${stockSpec}&cls=${encodeURIComponent(c.cls)}`)}"><td><b>${esc(c.cls)}</b></td>${age.buckets.map((b) => `<td class="num">${fmt(c[b.key] || 0)}</td>`).join('')}<td class="num"><b>${fmt(c.old30)}</b></td><td class="num"><b class="${c.old60 ? 'bad' : ''}">${fmt(c.old60)}</b></td><td class="num"><b>${fmt(c.total)}</b></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Is bucket me koi stock nahi hai 🎉</td></tr>'}</tbody>
        <tfoot><tr class="row-total"><td>GRAND TOTAL</td>${age.buckets.map((b) => `<td class="num">${fmt(U.sum(rows, (c) => c[b.key] || 0))}</td>`).join('')}<td class="num">${fmt(tot30)}</td><td class="num">${fmt(tot60)}</td><td class="num">${fmt(totAll)}</td></tr></tfoot>
      </table></div>
    </div>`;
    FF.app.openDrawer({
      kicker: `⏳ ${chLabel} · Stock Ageing Drill-down`,
      title,
      sub: esc(`${r.isTl ? 'Team Leader' : 'Agent'}${p.id ? ` · ID ${p.id}` : ''} — kisi bhi class row par click karke tag/barcode details dekhein`),
      actions: can('export') ? `<button class="btn small" data-drawer-csv="${esc(title)}">⬇ CSV</button><button class="btn small primary" data-drawer-pdf="${esc(title)}">📄 PDF</button>` : '',
      body,
      wide: true,
      age: false
    });
  }

  function sparklineHtml(trend) {
    if (!trend) return '';
    const max = Math.max(...trend.map((t) => t.n), 1);
    const cols = trend.map((t, i) => `<div class="as-tr-col" title="${esc(t.ym)} · ${fmt(t.n)} tags"><span class="as-tr-val">${t.n ? fmt(t.n) : '·'}</span><div class="as-tr-bar ${i === trend.length - 1 ? 'now' : ''}" style="height:${Math.max(3, Math.round((t.n / max) * 52))}px"></div><span class="as-tr-lbl">${esc(t.lbl)}</span></div>`).join('');
    const cur = trend[trend.length - 1] || { n: 0 };
    const prev = trend.length > 1 ? trend[trend.length - 2].n : 0;
    const arrow = prev ? (cur.n >= prev ? '📈' : '📉') : '📊';
    return `<div class="card as-trend-card"><div class="card-head"><h3>${arrow} 6-Month Trend</h3><span class="dim small">6 mahine: <b>${fmt(U.sum(trend, (t) => t.n))}</b> · MTD: <b>${fmt(cur.n)}</b> · Last: <b>${fmt(prev)}</b></span></div><div class="as-trend">${cols}</div></div>`;
  }

  function alertsHtml(r) {
    const al = agentAlerts(r.p, r.isTl);
    if (!r.isTl) {
      const t = r.p.totals || {};
      if (al.drop.length) return `<div class="as-strip bad">⚠️ <b>MTD drop warning:</b> is mahine <b>${fmt(t.curTotal)}</b> vs last month <b>${fmt(t.lastTotal)}</b> (${t.growth.toFixed(0)}%) — TL se baat karein 📞</div>`;
      if (al.stars.length) return `<div class="as-strip good">🌟 <b>Shandaar performance!</b> MTD <b>${fmt(t.curTotal)}</b> — last month se <b>+${t.growth.toFixed(0)}%</b> up 🎉</div>`;
      return '';
    }
    const chip = (a, icon) => `<button type="button" class="chip as-sug-chip" data-as-pick="${esc(`${r.ch}-agent|${a.name}`)}">${icon} <b>${esc(a.name)}</b> <small class="dim">MTD ${fmt(a.curTotal)} · Last ${fmt(a.lastTotal)}</small></button>`;
    const rows = [];
    if (al.drop.length) rows.push(`<div class="as-chip-row"><span class="badge red">🔻 MTD drop −50%+</span>${al.drop.map((a) => chip(a, '🔻')).join('')}</div>`);
    if (al.stars.length) rows.push(`<div class="as-chip-row"><span class="badge green">🌟 Stars +50%+</span>${al.stars.map((a) => chip(a, '🌟')).join('')}</div>`);
    if (al.idle.length) rows.push(`<div class="as-chip-row"><span class="badge amber">🐌 Zero issuance · stock held</span>${al.idle.map((a) => chip(a, '🐌')).join('')}</div>`);
    return rows.length ? `<div class="card as-alert-card"><div class="card-head"><h3>🚨 Alerts &amp; 🌟 Top movers</h3><span class="dim small">Chip par click → agent ka poora summary</span></div><div class="card-body">${rows.join('')}</div></div>` : '';
  }

  // ---- v3.34 Team Pack — TL ke poore team ki ek combined PDF / Excel -------------------------------
  async function buildTeamPack(r, onProgress) {
    const agents = [...(r.p.agents || [])];
    const pack = new Array(agents.length);
    let cursor = 0, completed = 0;
    const workerCount = Math.min(5, agents.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < agents.length) {
        const i = cursor++, agent = agents[i];
        if (onProgress) onProgress(completed, agents.length, agent.name);
        let rep = null;
        try { rep = await buildReportCached({ kind: `${r.ch}-agent`, name: agent.name, id: agent.id || '', tl: r.p.name }); }
        catch (err) { console.warn('[agentSummary] team pack skip:', agent.name, err); }
        pack[i] = { agent, rep };
        completed++;
        if (onProgress) onProgress(completed, agents.length, agent.name);
      }
    });
    await Promise.all(workers);
    return pack;
  }

  function teamPackPdf(r, pack) {
    const p = r.p, t = p.totals || {}, age = r.age;
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const ok = pack.filter((x) => x.rep).length;
    const doc = FF.pdf.doc({ title: `${chLabel} · Team Pack — ${p.name}`, subtitle: `${ok}/${(p.agents || []).length} agents · TL summary + har agent ka apna page`, right: `${new Date().toLocaleDateString('en-IN')}` });
    doc.kpis([
      { label: `Team MTD (${p.curYm || ''})`, value: fmt(t.curTotal), sub: `VC4 ${fmt(t.curVc4)} · Comm ${fmt(t.curComm)}`, color: '#2563eb' },
      { label: 'Last Month', value: fmt(t.lastTotal), sub: `${fmt(p.agents.length)} agents`, color: '#7c3aed' },
      { label: 'Growth', value: t.growth == null ? '—' : `${t.growth >= 0 ? '+' : ''}${t.growth.toFixed(0)}%`, sub: `Expected ${fmt(p.expected)}`, color: (t.growth || 0) >= 0 ? '#16a34a' : '#dc2626' },
      { label: 'Stock in Hand', value: fmt(t.stockTotal), sub: `${p.tlStock && p.tlStock.own && p.tlStock.agents ? `Own ${fmt(p.tlStock.own.total)} + agents ${fmt(p.tlStock.agents.total)}${age ? ' · ' : ''}` : ''}${age ? `30+d ${fmt(age.old30)} · 90+d ${fmt(age.old60)}` : ''}`, color: '#0891b2' }
    ]);
    const clsRows = (p.classTable || []).filter((x) => x.cur || x.last || x.stock);
    if (clsRows.length) {
      doc.section(`Class-wise Issuance (${p.lastYm || 'Last'} vs ${p.curYm || 'MTD'}) & Stock`);
      doc.table({
        headers: ['Class', p.lastYm || 'Last', p.curYm || 'MTD', 'Growth %', 'Stock'],
        align: ['left', 'right', 'right', 'right', 'right'],
        rows: clsRows.map((x) => [x.cls, fmt(x.last), fmt(x.cur), x.growth == null ? '—' : `${x.growth >= 0 ? '+' : ''}${x.growth.toFixed(0)}%`, fmt(x.stock)]),
        foot: ['GRAND TOTAL', fmt(t.lastTotal), fmt(t.curTotal), t.growth == null ? '—' : `${t.growth >= 0 ? '+' : ''}${t.growth.toFixed(0)}%`, fmt(t.stockTotal)]
      });
    }
    pack.forEach(({ agent, rep }) => {
      if (!rep) return;
      const ap = rep.p, at = ap.totals || {};
      doc.section(`${agent.name}${agent.id ? ` · ID ${agent.id}` : ''} · ${agent.activityStatus || 'Inactive'}${agent.inactiveDuration ? ` · ${agent.inactiveDuration}` : ''}`);
      doc.kpis([
        { label: 'MTD', value: fmt(at.curTotal), sub: `VC4 ${fmt(at.curVc4)} · Comm ${fmt(at.curComm)}`, color: '#2563eb' },
        { label: 'Last Month', value: fmt(at.lastTotal), color: '#7c3aed' },
        { label: 'Growth', value: at.growth == null ? '—' : `${at.growth >= 0 ? '+' : ''}${at.growth.toFixed(0)}%`, color: (at.growth || 0) >= 0 ? '#16a34a' : '#dc2626' },
        { label: 'Stock', value: fmt(at.stockTotal), color: '#0891b2' }
      ]);
      const rows2 = (ap.classTable || []).filter((x) => x.cur || x.last || x.stock);
      if (rows2.length) doc.table({ headers: ['Class', 'Last', 'MTD', 'Stock'], align: ['left', 'right', 'right', 'right'], rows: rows2.map((x) => [x.cls, fmt(x.last), fmt(x.cur), fmt(x.stock)]) });
    });
    doc.footer(`${FF.config.brand || 'ApnaPayment'} · ${chLabel} Team Pack · ${p.name} · ${new Date().toLocaleDateString('en-IN')}`);
    return doc.finish();
  }

  function teamPackXlsx(r, pack) {
    const p = r.p, t = p.totals || {};
    const sheets = [{
      name: 'Team Summary',
      header: ['Agent', 'ID', p.lastYm || 'Last Month', p.curYm || 'Current (MTD)', 'VC4', 'Comm', 'Growth %', 'Stock', 'Status', 'Inactive Duration'],
      rows: (p.agents || []).map((a) => [a.name, a.id || '', a.lastTotal, a.curTotal, a.curVc4, a.curComm, a.growth == null ? '' : Number(a.growth.toFixed(1)), a.stockTotal, a.activityStatus || 'Inactive', a.inactiveDuration || ''])
        .concat([['GRAND TOTAL', `${p.agents.length} Agents`, U.sum(p.agents, (a) => a.lastTotal), U.sum(p.agents, (a) => a.curTotal), U.sum(p.agents, (a) => a.curVc4), U.sum(p.agents, (a) => a.curComm), '', U.sum(p.agents, (a) => a.stockTotal), `${p.agents.filter((a) => a.activityStatus === 'Active').length} Active`, `${p.agents.filter((a) => a.activityStatus !== 'Active').length} Inactive`]])
    }];
    if (r.age && r.age.total) {
      sheets.push({
        name: 'Stock Ageing',
        header: ['Class', ...r.age.buckets.map((b) => b.label), '30+d Old', '90+d Critical', 'Total'],
        rows: (r.age.byClass || []).map((c) => [c.cls, ...r.age.buckets.map((b) => c[b.key] || 0), c.old30, c.old60, c.total])
          .concat([['GRAND TOTAL', ...r.age.buckets.map((b) => b.n || 0), r.age.old30, r.age.old60, r.age.total]])
      });
    }
    pack.forEach(({ agent, rep }) => {
      if (!rep) return;
      const ap = rep.p, at = ap.totals || {};
      sheets.push({
        name: String(agent.name).slice(0, 28),
        header: ['Class', ap.lastYm || 'Last', ap.curYm || 'MTD', 'Growth %', 'Stock'],
        rows: (ap.classTable || []).filter((x) => x.cur || x.last || x.stock).map((x) => [x.cls, x.last, x.cur, x.growth == null ? '' : Number(x.growth.toFixed(1)), x.stock])
          .concat([['GRAND TOTAL', at.lastTotal, at.curTotal, at.growth == null ? '' : Number(at.growth.toFixed(1)), at.stockTotal]])
      });
    });
    return sheets;
  }

  function agentWaText(r, a) {
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    return `*🧑‍💼 ${a.name}* (${chLabel} · Agent${a.id ? ` · ID: ${a.id}` : ''})\n• Status: ${a.activityStatus || 'Unknown'}${a.inactiveDuration ? ` · ${a.inactiveDuration}` : ''}\n• MTD: *${fmt(a.curTotal)}* (Last: ${fmt(a.lastTotal)} · ${a.growth == null ? '—' : `${a.growth >= 0 ? '+' : ''}${a.growth.toFixed(0)}%`})\n• Stock: *${fmt(a.stockTotal)}*\n👥 TL: ${r.p.name}\n— ${FF.config.brand || 'ApnaPayment'} 📊`;
  }

  /** Ageing abhi nahi aayi — kyun (load ho rahi / server bana raha / fail) aur Retry. "Koi ageing nahi 🎉" kabhi nahi dikhata. */
  function ageStateHtml(r) {
    const st = r.ageState || 'idle';
    if (st === 'unavailable') return '<div class="card-body empty dim">Stock ageing is page par available nahi hai.</div>';
    if (st === 'loading' || st === 'idle') return `<div class="card-body as-age-state" role="status">${U.loader ? U.loader('', { size: 'sm' }) : ''} <span>🧓 Stock ageing load ho rahi hai${U.ellipsis ? U.ellipsis() : '…'} <small class="dim">(upar ka summary ready hai)</small></span></div>`;
    if (st === 'building') return '<div class="card-body as-age-state">⏳ Server stock ageing ka index bana raha hai (pehli baar poora StockDataa padhna padta hai, 1–2 min). Upar ka summary ready hai — <button type="button" class="btn small" data-as-age-retry>↻ Dobara check karo</button></div>';
    return '<div class="card-body as-age-state">⚠️ Stock ageing abhi load nahi hui — upar ka summary sahi hai. <button type="button" class="btn small" data-as-age-retry>↻ Retry</button></div>';
  }
  /** 🧑‍💼 Team Agents card — TL ki APNI row sabse upar alag (agents ke jod me nahi) aur neeche
   *  3-line footer: Agents total → + TL ke paas (own) → = TL total. Har stock cell / footer row
   *  click par usi hisse ki detail drawer khulti hai (card ka number == drawer ka number). */
  function teamAgentsCard(r) {
    const p = r.p, t = p.totals || {}, S = tlSplit(r);
    if (!S.list.length) return '';
    const tlStockSpec = `src=${r.ch}&scope=stock&tl=${encodeURIComponent(p.name)}${(p.stockTlId || p.id) ? `&tlId=${encodeURIComponent(p.stockTlId || p.id)}` : ''}`;
    const row = (a) => {
      const aSpec = `src=${r.ch}&scope=stock&agent=${encodeURIComponent(a.name)}${a.id ? `&agentId=${encodeURIComponent(a.id)}` : ''}${r.isTl ? `&tl=${encodeURIComponent(p.name)}${(p.stockTlId || p.id) ? `&tlId=${encodeURIComponent(p.stockTlId || p.id)}` : ''}` : ''}`;
      return `<tr class="clickable${a.isSelf ? ' mp-selfrow' : ''}"${a.isSelf ? ` data-kpi="${esc(`${tlStockSpec}&part=own`)}" title="TL ke paas (own) stock ki detail"` : ` data-as-pick="${esc(`${r.ch}-agent|${a.name}`)}"`}><td>${a.isSelf ? '👤 ' : ''}<b>${esc(a.name)}</b>${a.isSelf ? '<span class="mp-tag-self">TL · apna stock</span>' : ''}</td><td class="mono">${esc(a.id || '—')}</td><td class="num">${fmt(a.lastTotal)}</td><td class="num"><b>${fmt(a.curTotal)}</b></td><td class="num">${fmt(a.curVc4)}</td><td class="num">${fmt(a.curComm)}</td><td class="num">${U.pctHtml(a.growth)}</td><td class="num mp-drill" data-kpi="${esc(a.isSelf ? `${tlStockSpec}&part=own` : aSpec)}" role="button" tabindex="0" title="Stock ki detail">${fmt(a.stockTotal)}</td><td><span class="badge ${a.activityStatus === 'Active' ? 'green' : 'red'}">${esc(a.activityStatus || 'Inactive')}</span></td><td>${esc(a.inactiveDuration || '—')}</td><td>${can('share') && !a.isSelf ? `<button class="btn tiny" data-as-wa="${esc([a.name, a.id || '', a.curTotal, a.lastTotal, a.stockTotal, a.activityStatus || 'Inactive', a.inactiveDuration || ''].join('|'))}" title="WhatsApp par is agent ka summary bhejein">📲</button>` : ''}</td></tr>`;
    };
    const foot = (label, cells, cls, spec) => `<tr class="row-total${cls ? ` ${cls}` : ''}"${spec ? ` data-kpi="${esc(spec)}" role="button" tabindex="0"` : ''}><td colspan="2"><b>${label}</b></td>${cells}</tr>`;
    const sum = (k) => fmt(S.sum(k));
    const packBtns = can('export') ? `<span class="as-pack-btns"><button class="btn small" data-as-pack="xlsx" title="Poore team ki ek Excel workbook (Summary + har agent ki sheet)">👥 Team Pack Excel</button><button class="btn small primary" data-as-pack="pdf" title="Poore team ki ek combined PDF (TL + har agent ka page)">👥 Team Pack PDF</button></span>` : '';
    return `<div class="card" style="margin-top:14px">
        <div class="card-head"><h3>🧑‍💼 Team Agents (${fmt(S.agents.length)})${S.self ? ' · TL ka apna stock alag row me' : ''} — click any agent to open their summary</h3>${packBtns}</div>
        <p class="dim small" style="margin:0 14px 6px">Agents ka jod + TL ke paas (own) = TL total — TL ki row agents ke jod me dobara nahi judti. Kisi bhi stock number par click → wahin ki detail.</p>
        <div class="table-wrap"><table class="tbl compact">
          <thead><tr><th>Agent</th><th>ID</th><th class="num">${esc(p.lastYm || 'Last')}</th><th class="num">${esc(p.curYm || 'MTD')}</th><th class="num">VC4</th><th class="num">Comm</th><th class="num">Growth</th><th class="num">Stock</th><th>Status</th><th>Inactive Duration</th><th></th></tr></thead>
          <tbody>${S.list.map(row).join('')}</tbody>
          <tfoot>
            ${S.agents.length ? foot(`🧑‍💼 Agents total (${fmt(S.agents.length)})`, `<td class="num"><b>${sum('lastTotal')}</b></td><td class="num"><b>${sum('curTotal')}</b></td><td class="num">${sum('curVc4')}</td><td class="num">${sum('curComm')}</td><td class="num">${U.pctHtml(U.growth(S.sum('curTotal'), S.sum('lastTotal')))}</td><td class="num"><b>${fmt(S.has ? S.ag.total : S.sum('stockTotal'))}</b></td><td><b>${S.agents.filter((a) => a.activityStatus === 'Active').length} Active</b></td><td><b>${S.agents.filter((a) => a.activityStatus !== 'Active').length} Inactive</b></td><td></td>`, '', `${tlStockSpec}&part=team`) : ''}
            ${S.has || S.self ? foot(`👤 ${esc(S.self ? S.self.name : p.name)} ke paas (TL own)`, `<td class="num">${S.self ? fmt(S.self.lastTotal) : '—'}</td><td class="num">${S.self ? fmt(S.self.curTotal) : '—'}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num"><b>${fmt((S.own || {}).total)}</b></td><td>—</td><td>—</td><td></td>`, 'mp-selfrow', `${tlStockSpec}&part=own`) : ''}
            ${foot('= TL TOTAL (own + agents)', `<td class="num"><b>${fmt(t.lastTotal)}</b></td><td class="num"><b>${fmt(t.curTotal)}</b></td><td class="num"><b>${fmt(t.curVc4)}</b></td><td class="num"><b>${fmt(t.curComm)}</b></td><td class="num">${U.pctHtml(t.growth)}</td><td class="num"><b>${fmt(t.stockTotal)}</b></td><td>—</td><td>—</td><td></td>`, 'row-strong', tlStockSpec)}
          </tfoot>
        </table></div>
      </div>`;
  }
  function teamStockMatrixHtml(r) {
    if (!r || !r.isTl) return '';
    const p = r.p || {}, t = p.totals || {}, S = tlSplit(r), age = r.age;
    const holders = S.list || [];
    const classKey = (v) => {
      const s = clean(v).toUpperCase().replace(/\s+/g, '');
      return /^\d+$/.test(s) ? `VC${s}` : s;
    };
    const classSet = new Set();
    (p.classTable || []).forEach((x) => { if (Number(x.stock) > 0) classSet.add(classKey(x.cls)); });
    holders.forEach((a) => Object.entries(a.classStock || {}).forEach(([cls, value]) => { if (Number(value) > 0) classSet.add(classKey(cls)); }));
    (age && age.byClass || []).forEach((x) => { if (Number(x.total) > 0) classSet.add(classKey(x.cls)); });
    const classes = [...classSet].sort((a, b) => {
      const an = Number((a.match(/\d+/) || [999])[0]), bn = Number((b.match(/\d+/) || [999])[0]);
      return (an - bn) || a.localeCompare(b);
    });
    if (!classes.length && !holders.length) return '';

    const stockSpec = `src=${r.ch}&scope=stock&tl=${encodeURIComponent(p.name)}${(p.stockTlId || p.id) ? `&tlId=${encodeURIComponent(p.stockTlId || p.id)}` : ''}`;
    const classValue = (holder, cls) => {
      const hit = Object.entries(holder && holder.classStock || {}).find(([key]) => classKey(key) === classKey(cls));
      return hit ? Number(hit[1]) || 0 : 0;
    };
    const ageFor = (holder) => {
      const list = age && Array.isArray(age.byHolder) ? age.byHolder : [];
      if (!list.length) return null;
      const id = idKey(holder && holder.id);
      const exact = id ? list.find((x) => idKey(x.id) === id) : null;
      if (exact) return exact;
      const named = list.filter((x) => norm(x.name) === norm(holder && holder.name));
      return named.find((x) => norm(x.tl) === norm(p.name)) || (named.length === 1 ? named[0] : null);
    };
    const ageSum = (list) => {
      if (!age) return null;
      return (list || []).reduce((out, holder) => {
        const h = ageFor(holder);
        if (!h) return out;
        out.old30 += Number(h.old30) || 0;
        out.old60 += Number(h.old60) || 0;
        out.found = true;
        return out;
      }, { old30: 0, old60: 0, found: false });
    };
    const cellHtml = (value, spec) => `<td class="num"${value > 0 && spec ? ` data-kpi="${esc(spec)}" role="button" tabindex="0" title="Tag Assignment detail kholein"` : ''}>${value ? fmt(value) : '<span class="dim">0</span>'}</td>`;
    const rows = holders.map((holder) => {
      const isSelf = !!holder.isSelf;
      const holderSpec = isSelf
        ? `${stockSpec}&part=own`
        : `src=${r.ch}&scope=stock&agent=${encodeURIComponent(holder.name)}${holder.id ? `&agentId=${encodeURIComponent(holder.id)}` : ''}&tl=${encodeURIComponent(p.name)}${(p.stockTlId || p.id) ? `&tlId=${encodeURIComponent(p.stockTlId || p.id)}` : ''}`;
      const hAge = ageFor(holder);
      const classCells = classes.map((cls) => cellHtml(classValue(holder, cls), `${holderSpec}&cls=${encodeURIComponent(cls)}`)).join('');
      const total = Number(holder.stockTotal) || 0;
      const age30 = hAge ? fmt(hAge.old30) : '—', age90 = hAge ? fmt(hAge.old60) : '—';
      return `<tr class="${isSelf ? 'mp-selfrow' : ''}"><td>${isSelf ? '👤 ' : ''}<b>${esc(holder.name)}</b>${isSelf ? '<span class="mp-tag-self">TL · own</span>' : ''}${holder.id ? ` <small class="dim">${esc(holder.id)}</small>` : ''}</td>${classCells}${cellHtml(total, holderSpec)}<td class="num">${age30}</td><td class="num">${age90}</td></tr>`;
    });
    const agentRows = (S.agents || []);
    const agentAge = ageSum(agentRows), ownAge = S.self ? ageSum([S.self]) : null, totalAge = ageSum(holders);
    const sumClass = (list, cls) => (list || []).reduce((n, a) => n + classValue(a, cls), 0);
    const totalClassMap = new Map();
    (p.classTable || []).forEach((x) => totalClassMap.set(classKey(x.cls), Number(x.stock) || 0));
    if (!totalClassMap.size) classes.forEach((cls) => totalClassMap.set(cls, sumClass(holders, cls)));
    const ownClassMap = new Map(classes.map((cls) => [cls, S.self ? classValue(S.self, cls) : 0]));
    const agentClassMap = new Map(classes.map((cls) => [cls, sumClass(agentRows, cls)]));
    const totalRow = (label, values, total, rowAge, spec, clsName = '') => `<tr class="row-total ${clsName}"${spec ? ` data-kpi="${esc(spec)}" role="button" tabindex="0"` : ''}><td><b>${label}</b></td>${classes.map((cls) => cellHtml(Number(values.get(cls)) || 0, `${spec || stockSpec}&cls=${encodeURIComponent(cls)}`)).join('')}${cellHtml(total, spec)}<td class="num">${rowAge && rowAge.found ? fmt(rowAge.old30) : '—'}</td><td class="num">${rowAge && rowAge.found ? fmt(rowAge.old60) : '—'}</td></tr>`;
    const head = `<tr><th>Agent / TL</th>${classes.map((cls) => `<th class="num">${esc(cls)}</th>`).join('')}<th class="num">Stock total</th><th class="num">30+d</th><th class="num">90+d</th></tr>`;
    const foot = [
      ...(agentRows.length ? [totalRow(`Agents total (${fmt(agentRows.length)})`, agentClassMap, S.has ? S.ag.total : U.sum(agentRows, (x) => x.stockTotal), agentAge, `${stockSpec}&part=team`)] : []),
      ...(S.self || S.has ? [totalRow('TL own stock', ownClassMap, S.own ? S.own.total : 0, ownAge, `${stockSpec}&part=own`)] : []),
      totalRow('= TL TOTAL (own + agents)', totalClassMap, t.stockTotal || S.stockTotal || 0, totalAge, stockSpec, 'row-strong')
    ].join('');
    const ageHint = age ? 'Ageing Tag Assignment ke tag allocation dates / StockDataa match se.' : 'Ageing abhi load nahi hui.';
    return `<section class="card as-team-stock-card"><div class="card-head"><h3>📦 Consolidated Agent + TL stock · class-wise + ageing</h3><span class="dim small">${esc(ageHint)}</span></div><div class="table-wrap as-team-stock-wrap"><table class="tbl compact as-team-stock"><thead>${head}</thead><tbody>${rows.join('') || `<tr><td colspan="${classes.length + 4}" class="empty">Team stock holders nahi mile.</td></tr>`}</tbody><tfoot>${foot}</tfoot></table></div><p class="dim small as-team-stock-note">Class cells aur stock totals par click → usi holder / class ki Tag Assignment detail. 90+d ageing = dashboard ka critical ageing bucket.</p></section>`;
  }

  function reportHtml(r) {
    const p = r.p, t = p.totals || {}, age = r.age;
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const scopeParam = r.isTl
      ? `tl=${encodeURIComponent(p.name)}${(p.stockTlId || p.id) ? `&tlId=${encodeURIComponent(p.stockTlId || p.id)}` : ''}`
      : `agent=${encodeURIComponent(p.name)}${p.id ? `&agentId=${encodeURIComponent(p.id)}` : ''}${p.tlId ? `&tlId=${encodeURIComponent(p.tlId)}&tl=${encodeURIComponent(p.tlName || '')}` : ''}`;
    const curSpec = `src=${r.ch}&scope=mtd&ym=${encodeURIComponent(p.curYm || '')}&${scopeParam}`;
    const lastSpec = `src=${r.ch}&scope=month&ym=${encodeURIComponent(p.lastYm || '')}&${scopeParam}`;
    const stockSpec = `src=${r.ch}&scope=stock&${scopeParam}`;
    // v3.40 — TL stock ka own / agents split do clickable chips bankar (drawer me sirf wahi hissa khulta hai)
    const S = tlSplit(r);
    const tlStockSpec = `src=${r.ch}&scope=stock&tl=${encodeURIComponent(p.name)}${(p.stockTlId || p.id) ? `&tlId=${encodeURIComponent(p.stockTlId || p.id)}` : ''}`;
    const peopleSpec = `src=${r.ch}&scope=people&tl=${encodeURIComponent(p.name)}&self=0&sort=stock`;
    const splitChips = r.isTl && S.has
      ? `<span class="mp-part own" data-kpi="${esc(`${tlStockSpec}&part=own`)}" role="button" tabindex="0" title="Sirf TL ke paas (own) stock">TL ke paas ${fmt(S.own.total)}</span> + <span class="mp-part team" data-kpi="${esc(`${tlStockSpec}&part=team`)}" role="button" tabindex="0" title="Sirf agents ke paas stock">agents ${fmt(S.ag.total)}</span>`
      : '';

    const clsRows = (p.classTable || []).filter((x) => x.cur || x.last || x.stock);
    const sumAgentsLast = r.isTl ? U.sum(p.agents || [], (a) => a.lastTotal) : 0;
    const sumAgentsCur = r.isTl ? U.sum(p.agents || [], (a) => a.curTotal) : 0;
    const sumAgentsVc4 = r.isTl ? U.sum(p.agents || [], (a) => a.curVc4) : 0;
    const sumAgentsComm = r.isTl ? U.sum(p.agents || [], (a) => a.curComm) : 0;
    const sumAgentsStock = r.isTl ? U.sum(p.agents || [], (a) => a.stockTotal) : 0;
    const teamGrowth = r.isTl ? U.growth(sumAgentsCur, sumAgentsLast) : null;

    // 🔐 v3.35 — export buttons sirf `export` permission par, share/copy sirf `share` par (admin decides).
    const expBtns = can('export') ? `<button class="btn primary" data-as-act="pdf">📄 PDF</button>
          <button class="btn" data-as-act="excel">📊 Excel</button>
          <button class="btn" data-as-act="csv">⬇ CSV</button>` : '';
    const shBtns = can('share') ? `<button class="btn" data-as-act="share">📲 Share / WhatsApp</button>
          <button class="btn" data-as-act="wa">💬 WA Text</button>
          <button class="btn" data-as-act="copy">📋 Copy</button>` : '';
    const lt = !r.isTl ? (p.linkedTl || null) : null;
    const ltScope = lt ? `tl=${encodeURIComponent(lt.name)}${lt.id ? `&tlId=${encodeURIComponent(lt.id)}` : ''}` : '';
    const ltCurSpec = lt ? `src=${r.ch}&scope=mtd&ym=${encodeURIComponent(p.curYm || '')}&${ltScope}` : '';
    const ltLastSpec = lt ? `src=${r.ch}&scope=month&ym=${encodeURIComponent(p.lastYm || '')}&${ltScope}` : '';
    const ltStockSpec = lt ? `src=${r.ch}&scope=stock&${ltScope}` : '';
    const agentTlBlock = lt ? `<section class="card as-agent-tl-card"><div class="card-head"><h3>👤 Agent + 👥 TL — ek nazar me</h3><button type="button" class="btn small primary" data-as-open-tl="1" data-as-tl-name="${esc(lt.name)}" data-as-tl-id="${esc(lt.id || '')}">👥 TL Report</button></div><div class="kpi-grid seven">
      ${card({ key: 'agent-stock', icon: '📦', tone: 'g5', label: 'Agent Stock', value: t.stockTotal, unit: 'tags', sub: `VC4 <b>${fmt(t.stockVc4)}</b> · Comm <b>${fmt(t.stockComm)}</b>`, why: 'Agent stock · Tag Assignment', explain: 'Agent ke paas actual stock.' })}
      ${card({ key: 'tl-stock', icon: '📦', tone: 'g5', label: 'TL Stock', value: lt.stock.total, unit: 'tags', sub: `VC4 <b>${fmt(lt.stock.vc4)}</b> · Comm <b>${fmt(lt.stock.comm)}</b>`, why: 'TL stock', explain: 'Isi agent ke linked TL ka total stock.' })}
      ${card({ key: 'agent-cur', icon: '🏷️', tone: 'g1', label: `Agent Current · ${p.curYm || 'MTD'}`, value: t.curTotal, unit: 'tags', sub: `VC4 <b>${fmt(t.curVc4)}</b> · Comm <b>${fmt(t.curComm)}</b>`, why: 'Agent issuance', explain: 'Current month MTD.' })}
      ${card({ key: 'agent-last', icon: '📅', tone: 'g3', label: `Agent Last · ${p.lastYm || 'Last'}`, value: t.lastTotal, unit: 'tags', sub: `VC4 <b>${fmt(t.lastVc4)}</b> · Comm <b>${fmt(t.lastComm)}</b>`, why: 'Agent issuance', explain: 'Previous month full total.' })}
      ${card({ key: 'tl-cur', icon: '🏷️', tone: 'g1', label: `TL Current · ${p.curYm || 'MTD'}`, value: lt.totals.curTotal, unit: 'tags', sub: `VC4 <b>${fmt(lt.totals.curVc4)}</b> · Comm <b>${fmt(lt.totals.curComm)}</b>`, why: 'TL issuance', explain: 'Linked TL current month.' })}
      ${card({ key: 'tl-last', icon: '📅', tone: 'g3', label: `TL Last · ${p.lastYm || 'Last'}`, value: lt.totals.lastTotal, unit: 'tags', sub: `VC4 <b>${fmt(lt.totals.lastVc4)}</b> · Comm <b>${fmt(lt.totals.lastComm)}</b>`, why: 'TL issuance', explain: 'Linked TL previous full month.' })}
      ${card({ key: 'agent-growth', icon: '📈', tone: 'g7', label: 'Projected Growth', value: t.growth, unit: '%', sub: `Expected current ${fmt(p.expected)} vs last full ${fmt(t.lastTotal)}`, why: 'Run-rate projection', explain: 'Yesterday tak current MTD ÷ elapsed days × current month days, then previous full month se comparison.' })}
    </div><p class="dim small as-linked-tl">👥 Linked TL: <button type="button" class="mp-link-btn" data-as-open-tl="1" data-as-tl-name="${esc(lt.name)}" data-as-tl-id="${esc(lt.id || '')}">${esc(lt.name)}</button>${lt.id ? ` · ID ${esc(lt.id)}` : ''}</p></section>` : '';
    return `<div class="as-report">
      <div class="as-head v2">
        <div class="as-ava ${r.ch === 'gv' ? 'gv' : 'ff'}">${r.isTl ? '👥' : '🧑‍💼'}</div>
        <div class="as-who">
          <div class="badge-row"><span class="badge ${r.ch === 'gv' ? 'green' : 'blue'}">${r.ch === 'gv' ? '🟩 GV Partner' : '🟦 First Forward'}</span><span class="badge purple">${r.isTl ? '👥 Team Leader' : '🧑‍💼 Agent'}</span>${p.direct ? `<span class="direct-chip">🚫 ${esc(p.directLabel || 'Direct (no TL)')}</span>` : ''}${p.priority ? `<span class="badge ${/high/i.test(p.priority) ? 'red' : /med/i.test(p.priority) ? 'amber' : 'green'}">🔺 ${esc(p.priority)}</span>` : ''}${p.activityStatus ? `<span class="badge ${p.activityStatus === 'Active' ? 'green' : 'red'}">${esc(p.activityStatus)}${p.inactiveDuration ? ` · ${esc(p.inactiveDuration)}` : ''}</span>` : ''}<span class="badge amber" title="Ye numbers report tab se aate hain">📄 ${r.ch === 'gv' ? 'GV REPORT tab' : 'REPORT tab'}</span></div>
          <h2>${esc(p.name)}</h2>
          <p class="as-id-line dim">${p.id ? `ID: <b>${esc(p.id)}</b> · ` : ''}${p.tlName && !r.isTl ? `TL: <button type="button" class="mp-link-btn" data-as-open-tl="1" data-as-tl-name="${esc(p.tlName)}" data-as-tl-id="${esc(p.tlId || '')}">${esc(p.tlName)}</button>${p.tlId ? ` (${esc(p.tlId)})` : ''}` : r.isTl ? `Team: <b>${fmt((p.agents || []).length)}</b> agents${p.selfAgent ? ' + TL khud (own stock)' : ''}` : ''}${p.mobile && canContacts() ? ` · 📞 <a href="tel:${esc(p.mobile)}">${esc(p.mobile)}</a>` : ''}</p>
          ${r.isTl ? `<p class="as-tl-note"><b>👥 TL data = own + agents</b> — Stock ${fmt(t.stockTotal)} · Total Issuance ${fmt(t.curTotal)} · Last Month ${fmt(t.lastTotal)} (neeche Team Agents table me split)</p>` : ''}
        </div>
        ${expBtns || shBtns ? `<div class="as-actions">${expBtns}${shBtns}</div>` : ''}
      </div>

      ${agentTlBlock}
      <div class="kpi-grid six">
        <div class="kpi g1" data-kpi="${esc(curSpec)}" title="Click karke ${esc(p.curYm || 'is mahine')} ka exact issuance data dekhein"><div class="kpi-top"><span class="kpi-title">🏷️ Total Issuance · ${esc(p.curYm || 'MTD')}</span><span class="kpi-icon">${r.isTl ? '👥' : '🏷️'}</span></div><div class="kpi-value">${fmt(t.curTotal)}</div><div class="kpi-foot">VC4 <b>${fmt(t.curVc4)}</b> · Comm <b>${fmt(t.curComm)}</b>${r.isTl ? ' · own + agents' : ''}</div></div>
        <div class="kpi g3" data-kpi="${esc(lastSpec)}" title="Click karke ${esc(p.lastYm || 'pichhle mahine')} ka exact issuance data dekhein"><div class="kpi-top"><span class="kpi-title">📅 Last Month Issuance</span><span class="kpi-icon">📅</span></div><div class="kpi-value">${fmt(t.lastTotal)}</div><div class="kpi-foot">${esc(p.lastYm || 'Last month')} · VC4 <b>${fmt(t.lastVc4)}</b> · Comm <b>${fmt(t.lastComm)}</b>${r.isTl ? ' · own + agents' : ''}</div></div>
        <div class="kpi g2" data-kpi="${esc(curSpec)}" title="Click karke growth aur run-rate data dekhein"><div class="kpi-top"><span class="kpi-title">Expected</span><span class="kpi-icon">🎯</span></div><div class="kpi-value">${fmt(p.expected)}</div><div class="kpi-foot">${U.pctHtml(t.growth)} · <b>${fmt(p.runRate, true)}</b>/day</div></div>
        <div class="kpi g5" data-kpi="${esc(stockSpec)}" title="Click karke exact stock in hand aur barcodes dekhein"><div class="kpi-top"><span class="kpi-title">📦 Stock in hand</span><span class="kpi-icon">📦</span></div><div class="kpi-value">${fmt(t.stockTotal)}</div><div class="kpi-foot">${splitChips ? `${splitChips} · ` : ''}VC4 <b>${fmt(t.stockVc4)}</b> · Comm <b>${fmt(t.stockComm)}</b></div></div>
        <div class="kpi g4" data-kpi-self="1" data-as-age="30" title="Click karke 30+ din purana stock dekhein"><div class="kpi-top"><span class="kpi-title">30+d old stock</span><span class="kpi-icon">⏳</span></div><div class="kpi-value">${age ? fmt(age.old30) : '—'}</div><div class="kpi-foot">0–30d fresh: <b>${age ? fmt(age.total - age.old30) : '—'}</b></div></div>
        <div class="kpi g7" data-kpi-self="1" data-as-age="90" title="Click karke 90+ din critical stock dekhein"><div class="kpi-top"><span class="kpi-title">90+d critical</span><span class="kpi-icon">🚨</span></div><div class="kpi-value">${age ? fmt(age.old60) : '—'}</div><div class="kpi-foot">180+d: <b>${age ? fmt((age.buckets[4] && age.buckets[4].n) || 0) : '—'}</b></div></div>
      </div>

      ${r.isTl && (S.has || S.self) ? `<p class="dim small as-split-note">📦 <b>Stock ka hisaab</b> — ${esc(S.text)}. ${S.self ? `TL ki apni row Team Agents table me sabse upar <span class="mp-tag-self">TL · apna stock</span> bankar dikhi hai (agents ke jod me nahi).` : 'TL ke paas abhi apna stock nahi, isliye TL total = agents ka jod.'} <span class="mp-linkish" data-kpi="${esc(peopleSpec)}" role="button" tabindex="0" title="In agents ki poori list">Agents ki list 👉</span></p>` : ''}
      ${chartsSectionHtml(r)}
      ${sparklineHtml(r.trend)}
      ${alertsHtml(r)}

      <div class="as-two">
        <div class="card">
          <div class="card-head"><h3>🚗 Class-wise Issuance &amp; Stock</h3><span class="dim small">${esc(p.lastYm || 'Last')} → ${esc(p.curYm || 'MTD')} · Row par click karke details kholein</span></div>
          <div class="table-wrap"><table class="tbl compact">
            <thead><tr><th>Class</th><th class="num">${esc(p.lastYm || 'Last')}</th><th class="num">${esc(p.curYm || 'MTD')}</th><th class="num">Growth</th><th class="num">Stock</th></tr></thead>
            <tbody>${clsRows.map((c) => `<tr class="clickable" data-kpi="${esc(`${stockSpec}&cls=${encodeURIComponent(c.cls)}`)}"><td><b>${esc(c.cls)}</b></td><td class="num">${fmt(c.last)}</td><td class="num"><b>${fmt(c.cur)}</b></td><td class="num">${U.pctHtml(c.growth)}</td><td class="num">${fmt(c.stock)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No class rows</td></tr>'}</tbody>
            <tfoot><tr class="row-total"><td><b>Grand Total</b></td><td class="num"><b>${fmt(t.lastTotal)}</b></td><td class="num"><b>${fmt(t.curTotal)}</b></td><td class="num">${U.pctHtml(t.growth)}</td><td class="num"><b>${fmt(t.stockTotal)}</b></td></tr></tfoot>
          </table></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>⏳ Stock Ageing${age ? ` · ${fmt(age.total)} tags` : ''}</h3>${age ? `<span class="dim small">30+d: <b>${fmt(age.old30)}</b> · 90+d: <b class="bad">${fmt(age.old60)}</b></span>` : ''}</div>
          ${age && age.total ? `<div class="table-wrap"><table class="tbl compact">
            <thead><tr><th>Class</th>${age.buckets.map((b) => `<th class="num">${esc(b.label)}</th>`).join('')}<th class="num">30+d</th><th class="num">90+d</th><th class="num">Total</th></tr></thead>
            <tbody>${(age.byClass || []).map((c) => `<tr class="clickable" data-as-age-cls="${esc(c.cls)}"><td><b>${esc(c.cls)}</b></td>${age.buckets.map((b) => `<td class="num">${fmt(c[b.key] || 0)}</td>`).join('')}<td class="num"><b>${fmt(c.old30)}</b></td><td class="num"><b class="${c.old60 ? 'bad' : ''}">${fmt(c.old60)}</b></td><td class="num"><b>${fmt(c.total)}</b></td></tr>`).join('')}</tbody>
            <tfoot><tr class="row-total"><td><b>Grand Total</b></td>${age.buckets.map((b) => `<td class="num"><b>${fmt(b.n || 0)}</b></td>`).join('')}<td class="num"><b>${fmt(age.old30)}</b></td><td class="num"><b class="${age.old60 ? 'bad' : ''}">${fmt(age.old60)}</b></td><td class="num"><b>${fmt(age.total)}</b></td></tr></tfoot>
          </table></div>` : (age ? '<div class="card-body empty">Is waqt koi pending stock ageing nahi hai 🎉</div>' : ageStateHtml(r))}
        </div>
      </div>

      ${r.isTl ? teamAgentsCard(r) : ''}
      ${r.isTl ? teamStockMatrixHtml(r) : ''}
    </div>`;
  }

  // Exact identity token: same-name users stay distinguishable.
  const personUiToken = (p) => `${p.kind || ''}|${encodeURIComponent(p.id || '')}|${encodeURIComponent(p.name || '')}`;
  const parsePersonUiToken = (value) => { const parts = String(value || '').split('|'); return { kind: parts[0] || '', id: decodeURIComponent(parts[1] || ''), name: decodeURIComponent(parts.slice(2).join('|') || '') }; };

  function makePage(channel) {
    const isGv = channel === 'gv';
    const state = { list: [], picked: null, report: null, q: '', pickSeq: 0 };
    /** Spinner + 20 s ke baad "slow hai" hint + Retry — loading kabhi bina jankari / bina Retry ke nahi ghoomti. */
    function showWaiting(host, text, onRetry) {
      host.innerHTML = U.spinner(text);
      const timer = setTimeout(() => {
        if (!host.isConnected || !host.querySelector('.loading')) return;
        host.innerHTML = U.spinner(text, { hint: 'Google Sheet / server abhi slow hai — data aa raha hai, thoda rukiye. Bahut der lage to Retry dabaiye.' })
          + '<div class="as-wait-actions"><button type="button" class="btn small" data-as-retry>↻ Retry</button></div>';
        const btn = host.querySelector('[data-as-retry]');
        if (btn && onRetry) btn.addEventListener('click', onRetry);
      }, 20000);
      return () => clearTimeout(timer);
    }
    async function render(root, params) {
      const chLabel = isGv ? 'GV Partner' : 'First Forward';
      root.innerHTML = `<div class="page">
        <div class="page-head"><div><h1>${isGv ? '🟩' : '🟦'} ${chLabel} · Agent / TL Summary</h1><p class="sub">Search by <b>Name · Agent Name · TL Name · Agent ID · TL ID · Mobile Number</b> — poora summary + charts + ageing + Grand Total PDF / Excel / CSV / WhatsApp · report data <b>${isGv ? 'GV REPORT' : 'REPORT'} tab</b> se</p></div></div>
        <div class="card card-primary as-search-card"><div class="card-body">
          <div class="as-search-bar">
            <div class="as-search">
              <span class="as-search-ico" aria-hidden="true">🔎</span>
              <input id="as-q" class="input" type="search" placeholder="Search Agent Name, TL Name, Agent ID, TL ID, ya 10-digit Mobile Number…" value="${esc((params && params.q) || state.q || '')}" autocomplete="off" aria-label="Agent ya TL search">
              <button class="btn primary" id="as-search-btn" type="button">🔎 Search</button>
              ${can('refresh') ? `<button class="btn" id="as-refresh-btn" type="button" title="Data refresh — cache clear karke dobara load">🔄</button>` : ''}
              <div id="as-drop" hidden aria-hidden="true"></div>
            </div>
          </div>
          <div class="as-quick-wrap" style="margin-top:10px">
            <div class="as-quick-head"><span class="dim small">⚡ <b>Suggested TLs &amp; Agents</b> (click to open):</span></div>
            <div id="as-top-suggest" class="as-top-suggest"></div>
          </div>
        </div></div>
        <div class="card as-people-card">
          <div class="card-head"><h3>📊 REPORT data — sabhi agents &amp; TLs</h3><div class="card-right dim small">Source: <b>${isGv ? 'GV REPORT' : 'REPORT'} tab</b> · Summary ke same numbers · row par click → poori report</div></div>
          <div class="card-body as-people-body">
            <div id="as-people">${U.spinner(`${chLabel} ki REPORT data list ban rahi hai…`)}</div>
          </div>
        </div>
        <div id="as-body">${U.spinner(`${chLabel} agents & TLs load ho rahe hain…`)}</div>
      </div>`;
      const qEl = U.$('#as-q', root), drop = U.$('#as-drop', root), body = U.$('#as-body', root);
      const topSug = U.$('#as-top-suggest', root), searchBtn = U.$('#as-search-btn', root);
      const retryRender = () => render(root, params);
      const stopListHint = showWaiting(body, `${chLabel} agents & TLs load ho rahe hain…`, retryRender);
      try {
        state.list = await loadPeopleCached(channel);
      } catch (err) {
        // Pehle yahan throw = spinner hamesha ke liye (kuch bind hi nahi hota tha). Ab saaf error + Retry.
        stopListHint();
        console.error('[agentSummary] list load failed:', err);
        body.innerHTML = U.errorBox(err, 'data-as-retry');
        const btn = body.querySelector('[data-as-retry]');
        if (btn) btn.addEventListener('click', retryRender);
        return;
      }
      stopListHint();

      // 📊 v3.43 — poori REPORT data list (Agent · TL · Stock · Total Issuance · Last Month) —
      // MP().reportDataRow() se wahi numbers jo summary KPI cards me dikhte hain.
      const peopleHost = U.$('#as-people', root);
      const paintPeopleTable = () => {
        if (!peopleHost) return;
        if (!MP() || !MP().reportDataRow) { peopleHost.innerHTML = '<div class="card-body empty dim">REPORT data table available nahi hai.</div>'; return; }
        const rows = state.list.map((p) => MP().reportDataRow(p, { cur: p.cur, last: p.last, stock: p.stock, tlName: p.tl, tlId: p.tlId, mobile: p.mobile, id: p.id }));
        peopleHost.innerHTML = MP().peopleTableHtml(rows, {
          id: `as-${channel}-people`,
          chips: '<button type="button" class="chip on" data-mppt-chip="all">🎯 Sab</button><button type="button" class="chip" data-mppt-chip="agents">🧑‍💼 Agents</button><button type="button" class="chip" data-mppt-chip="tls">👥 TLs</button>',
          footer: true,
          footerLabel: `GRAND TOTAL — ${chLabel} agents`,
          whoLabel: channel === 'gv' ? 'GV Agent / TL' : 'FF Agent / TL',
          sourceNote: `Source: ${isGv ? 'GV REPORT' : 'REPORT'} tab`,
          limit: 250,
          rowActions: (r) => `<button type="button" class="btn tiny" data-as-open="${esc(personUiToken(r))}" title="Iska poora summary kholo">📂</button>`
        });
      };
      paintPeopleTable();

      const renderTopChips = (q) => {
        if (!topSug) return;
        const hits = topSuggestions(state.list, q);
        if (!hits.length) {
          topSug.innerHTML = '<span class="dim small">Koi matching naam/ID/mobile nahi mila</span>';
          return;
        }
        topSug.innerHTML = hits.map((p) => {
          const isTl = p.kind.endsWith('tl');
          const active = state.picked && state.picked.kind === p.kind && norm(state.picked.name) === norm(p.name);
          return `<button type="button" class="chip as-sug-chip ${active ? 'on' : ''}" data-as-opt="${esc(personUiToken(p))}">
            <span class="badge ${isTl ? 'purple' : 'blue'}">${isTl ? 'TL' : 'Agent'}</span>
            <b>${esc(p.name)}</b>
            ${p.id ? `<small class="mono">(${esc(p.id)})</small>` : ''}
            ${p.mobile && canContacts() ? `<small class="dim">📞${esc(mob10(p.mobile))}</small>` : ''}
            ${!isTl && p.tl ? `<span class="dim">· TL: </span><span class="mp-linkish" data-as-open-tl="1" data-as-tl-name="${esc(p.tl)}" data-as-tl-id="${esc(p.tlId || '')}" title="TL report kholo">${esc(p.tl)}</span>` : ''}
            <small class="dim">· MTD ${fmt(p.cur)} · Last ${fmt(p.last)} · Stock ${fmt(p.stock)}</small>
          </button>`;
        }).join('');
      };

      const showDrop = () => {}; // shared U.suggest handles suggestions


      const pick = async (person, opts) => {
        if (!person) return;
        drop.hidden = true;
        state.picked = person;
        state.q = person.name;
        qEl.value = person.name;
        renderTopChips('');
        const token = ++state.pickSeq;
        const stopHint = showWaiting(body, `${person.name} ka poora summary ban raha hai…`, () => pick(person, { ...(opts || {}), fresh: true }));
        let rep;
        try {
          // age: false → ageing ka intezaar nahi; stock in hand / issuance / charts turant, ageing peeche se (startAgeing).
          rep = await buildReportCached(person, { ...(opts || {}), age: false });
        } catch (err) {
          stopHint();
          if (token !== state.pickSeq) return;
          console.error('[agentSummary] report failed:', err);
          body.innerHTML = U.errorBox(err, 'data-as-retry');
          const btn = body.querySelector('[data-as-retry]');
          if (btn) btn.addEventListener('click', () => pick(person, { ...(opts || {}), fresh: true }));
          return;
        }
        stopHint();
        if (token !== state.pickSeq) return;   // user ne beech me dusra naam chun liya
        state.report = rep;
        paintReport(rep);
        if (rep.ageState !== 'ready') startAgeing(rep);
      };
      // 📊 REPORT data table — row / 📂 button par click → usi person ka poora summary neeche.
      // Number cells ([data-kpi]) ko chhod do — wo app.js ka detail drawer kholte hain.
      const peopleCard = U.$('.as-people-card', root) || root;
      if (peopleCard && peopleCard.addEventListener) peopleCard.addEventListener('click', (e) => {
        const openBtn = e.target.closest('[data-as-open]');
        if (openBtn) {
          const tokenData = parsePersonUiToken(openBtn.dataset.asOpen);
          const person = state.list.find((p) => p.kind === tokenData.kind && (tokenData.id ? idKey(p.id) === idKey(tokenData.id) : norm(p.name) === norm(tokenData.name)))
            || { kind: tokenData.kind, name: tokenData.name, id: tokenData.id };
          pick(person);
          return;
        }
        const row = e.target.closest('[data-mppt-row]');
        if (row && !e.target.closest('[data-kpi],button,a')) {
          const spec = MP() && MP().personFromRow ? MP().personFromRow(row) : null;
          if (!spec) return;
          const person = state.list.find((p) => p.kind === spec.kind && norm(p.name) === norm(spec.name)) || spec;
          pick(person);
        }
      });
      /** v3.41 — FF / GV dono ka option: usi naam ko dusre channel ke Summary me kholo (naam wahan na ho to saaf bataata hai). */
      const otherCh = isGv ? 'ff' : 'gv';
      const canOther = () => can(`${otherCh}AgentSummary`) && (otherCh !== 'gv' || !FF.gv || !FF.gv.enabled || FF.gv.enabled());
      const switchHtml = (rep) => {
        if (!canOther() || !rep || !rep.p) return '';
        const me = { ff: { i: '🟦', l: 'First Forward' }, gv: { i: '🟩', l: 'GV Partner' } };
        return `<div class="as-chswitch" role="group" aria-label="Channel"><span class="dim small">Channel:</span><button type="button" class="chip on" disabled>${me[channel].i} ${me[channel].l}</button><button type="button" class="chip" data-as-switch="${otherCh}" title="${esc(rep.p.name)} ko ${me[otherCh].l} Summary me kholo">${me[otherCh].i} ${me[otherCh].l} me dekho 👉</button></div>`;
      };
      const paintReport = (rep) => {
        body.innerHTML = switchHtml(rep) + reportHtml(rep);
        if (FF.charts && FF.charts.mount) FF.charts.mount(body);
        if (FF.app && FF.app.enhanceTables) FF.app.enhanceTables(body);
      };
      /** Ageing background me; aate hi (agar yehi report abhi screen par hai) report dobara paint — scroll jagah par rehta hai. */
      const startAgeing = (rep) => {
        if (!rep || rep.ageLoading) return;
        rep.ageState = 'loading';
        const finish = () => {
          rep.ageLoading = null;
          if (state.report !== rep || !body.isConnected) return;
          let main = null, top = 0, winTop = 0;
          try { main = document.getElementById('main'); top = main ? main.scrollTop : 0; winTop = window.scrollY || 0; } catch { /* non-DOM */ }
          paintReport(rep);
          try { if (main) main.scrollTop = top; if (winTop && window.scrollTo) window.scrollTo(0, winTop); } catch { /* non-DOM */ }
        };
        rep.ageLoading = loadAgeing(rep, { waitMs: AGE_WAIT_MS }).then(() => {
          // Server abhi index bana raha ho → timeout ke baad bhi poll chalta rehta hai; ready hote hi ek baar aur koshish.
          if (rep.ageState === 'building' && FF.stockAge && FF.stockAge.ready) {
            FF.stockAge.ready().then((idx) => { if (idx && rep.ageState !== 'ready' && state.report === rep) { rep.ageLoading = null; startAgeing(rep); } }).catch(() => {});
          }
        }).then(finish, finish);
      };

      renderTopChips(qEl.value);
      // Shared body-portal autocomplete: input ke neeche anchored, card overflow se clipped nahi.
      let asSuggest = null;
      try {
        asSuggest = U.suggest(qEl, {
          min: 2, max: 14,
          items: () => state.list.map((p) => {
            const isTl = p.kind.endsWith('tl');
            return { kind: isTl ? 'tl' : 'agent', kindLabel: isTl ? 'TL' : 'Agent', label: p.name,
              sub: [p.id ? `ID ${p.id}` : '', !isTl && p.tl ? `TL ${p.tl}${p.tlId ? ` (${p.tlId})` : ''}` : '', p.mobile && canContacts() ? `📞 ${mob10(p.mobile)}` : '', `MTD ${fmt(p.cur)} · Stock ${fmt(p.stock)}`].filter(Boolean).join(' · '),
              value: p.name, inputValue: p.name, person: p };
          }),
          onPick: (it) => { if (it && it.person) pick(it.person); },
          onEnter: (q) => { const hit = matchPeople(state.list, q)[0]; if (hit) pick(hit); else if (clean(q)) U.toast('Koi matching Agent ya TL nahi mila', 'warn'); }
        });
      } catch (err) { console.warn('[agentSummary] suggest init failed:', err); }
      let qTimer = 0;
      qEl.addEventListener('input', () => { state.q = qEl.value; clearTimeout(qTimer); qTimer = setTimeout(() => renderTopChips(qEl.value), 120); });
      qEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (!asSuggest || qEl.getAttribute('aria-expanded') !== 'true')) {
          e.preventDefault(); const hit = matchPeople(state.list, qEl.value)[0]; if (hit) pick(hit); else U.toast('Koi matching Agent ya TL nahi mila', 'warn');
        }
      });
      if (searchBtn) searchBtn.addEventListener('click', () => {
        if (asSuggest && asSuggest.close) asSuggest.close();
        const hit = matchPeople(state.list, qEl.value); if (hit[0]) pick(hit[0], { fresh: true }); else U.toast('Koi matching Agent ya TL nahi mila', 'warn');
      });

      const refreshBtn = U.$('#as-refresh-btn', root);
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          refreshBtn.disabled = true;
          try {
            clearCaches();
            state.list = await loadPeople(channel);
            renderTopChips(qEl.value);
            const target = (state.picked && matchPeople(state.list, state.picked.name)[0]) || (qEl.value && matchPeople(state.list, qEl.value)[0]);
            if (target) await pick(target, { fresh: true });
            U.toast('Data refresh ho gaya ✓', 'ok');
          } catch (err) {
            U.toast((err && err.message) || 'Refresh fail hua', 'err');
          } finally {
            refreshBtn.disabled = false;
          }
        });
      }

      if (root.__asSummaryClick) root.removeEventListener('click', root.__asSummaryClick);
      root.__asSummaryClick = async (e) => {
        const waBtn = e.target.closest('[data-as-wa]');
        if (waBtn && state.report) {
          if (!can('share')) { U.toast('Share permission nahi hai', 'err'); return; }
          const [wName, wId, wCur, wLast, wStock, activityStatusValue, inactiveDuration] = (waBtn.dataset.asWa || '').split('|');
          const a = { name: wName, id: wId, curTotal: Number(wCur) || 0, lastTotal: Number(wLast) || 0, stockTotal: Number(wStock) || 0, growth: U.growth(Number(wCur) || 0, Number(wLast) || 0), activityStatus: activityStatusValue, inactiveDuration };
          const mob = canContacts() && MP() && MP().mobileFor ? MP().mobileFor(wName, wId, '') : '';
          const txt = agentWaText(state.report, a);
          const link = mob && mob10(mob).length === 10 ? `https://wa.me/91${mob10(mob)}?text=${encodeURIComponent(txt)}` : U.waLink(txt);
          window.open(link, '_blank', 'noopener');
          return;
        }
        const tlOpen = e.target.closest('[data-as-open-tl]');
        if (tlOpen && state.report && FF.app && FF.app.navigate) { FF.app.navigate('masterSearch', { q: tlOpen.dataset.asTlName || '', id: tlOpen.dataset.asTlId || '', ch: state.report.ch || '' }); return; }
        const sw = e.target.closest('[data-as-switch]');
        if (sw && state.report) {
          const target = sw.dataset.asSwitch;
          if (FF.app && FF.app.navigate) FF.app.navigate(`${target}AgentSummary`, { name: state.report.p.name });
          return;
        }
        const packBtn = e.target.closest('[data-as-pack]');
        if (packBtn && state.report && state.report.isTl) {
          if (!can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
          if (packBtn.disabled) return;
          const kind = packBtn.dataset.asPack;
          packBtn.disabled = true;
          const orig = packBtn.textContent;
          if (kind === 'pdf' && U.downloadStart) U.downloadStart(`team-pack-${U.slug(state.report.p.name)}-${U.stamp()}.pdf`, 'Preparing Team Pack PDF…');
          if (kind === 'pdf' && U.downloadYield) await U.downloadYield();
          try {
            if (kind === 'pdf' && !FF.pdf && FF.lazy && FF.lazy.need) await FF.lazy.need('pdf').catch(() => {});
            const pack = await buildTeamPack(state.report, (done, total, name) => { packBtn.textContent = `⏳ ${done}/${total}…`; packBtn.title = name; });
            const okCount = pack.filter((x) => x.rep).length;
            const fname = `${state.report.ch}-team-pack-${U.slug(state.report.p.name)}-${U.stamp()}`;
            if (kind === 'pdf') {
              if (!FF.pdf || !FF.pdf.doc) throw new Error('PDF module load nahi hua — page refresh karo');
              FF.pdf.download(teamPackPdf(state.report, pack), `${fname}.pdf`);
              U.toast(`Team Pack PDF ✓ (${okCount} agents, 1 combined file)`, 'ok');
            } else {
              FF.xlsx.download(`${fname}.xlsx`, teamPackXlsx(state.report, pack));
              U.toast(`Team Pack Excel ✓ (${okCount} agents, alag-alag sheet)`, 'ok');
            }
          } catch (err) {
            if (kind === 'pdf' && U.downloadFail) U.downloadFail(`${state.report.ch}-team-pack-${U.slug(state.report.p.name)}-${U.stamp()}.pdf`, (err && err.message) || 'Team Pack PDF failed');
            console.error('[agentSummary] team pack failed:', err);
            U.toast((err && err.message) || 'Team Pack fail hua', 'err');
          } finally {
            packBtn.disabled = false;
            packBtn.textContent = orig;
          }
          return;
        }
        const opt = e.target.closest('[data-as-opt],[data-as-pick]');
        // v3.40 — row ke andar [data-kpi] cell (stock number) par click = us number ki detail drawer
        // (app.js ka global handler), summary switch nahi.
        if (opt && !e.target.closest('[data-kpi]')) {
          const tokenData = parsePersonUiToken(opt.dataset.asOpt || opt.dataset.asPick);
          const found = state.list.find((x) => x.kind === tokenData.kind && (tokenData.id ? idKey(x.id) === idKey(tokenData.id) : norm(x.name) === norm(tokenData.name)))
            || { kind: tokenData.kind, name: tokenData.name, id: tokenData.id };
          pick(found);
          return;
        }
        const ageRetry = e.target.closest('[data-as-age-retry]');
        if (ageRetry && state.report) {
          const rep = state.report;
          rep.ageState = 'idle'; rep.ageLoading = null;
          paintReport(rep);
          startAgeing(rep);
          return;
        }
        const ageCard = e.target.closest('[data-as-age]');
        if (ageCard && state.report) {
          openAgeingDrill(state.report, Number(ageCard.dataset.asAge) || 30, '');
          return;
        }
        const ageCls = e.target.closest('[data-as-age-cls]');
        if (ageCls && state.report) {
          openAgeingDrill(state.report, 0, ageCls.dataset.asAgeCls);
          return;
        }
        const act = e.target.closest('[data-as-act]');
        if (act && state.report) {
          const r = state.report, fname = `${r.ch}-${r.isTl ? 'tl' : 'agent'}-${U.slug(r.p.name)}-${U.stamp()}`;
          const k = act.dataset.asAct;
          // 🔐 v3.35 — render-time hide ke baad bhi yahan check (defense in depth, same toast strings)
          if (['pdf', 'excel', 'csv'].includes(k) && !can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
          if (['share', 'wa', 'copy'].includes(k) && !can('share')) { U.toast('Share permission nahi hai', 'err'); return; }          if (k === 'pdf' && U.downloadStart) U.downloadStart(`${fname}.pdf`, 'Preparing PDF…');
          if (k === 'pdf' && U.downloadYield) await U.downloadYield();

          act.disabled = true;
          try {
            await new Promise((res) => setTimeout(res, 30)); // busy paint
            if (k === 'pdf' || k === 'share') {
              if (!FF.pdf && FF.lazy && FF.lazy.need) await FF.lazy.need('pdf').catch(() => {});
              if (!FF.pdf || !FF.pdf.doc) throw new Error('PDF module load nahi hua — page refresh karo');
              const bytes = makePdf(r);
              if (k === 'share') await FF.pdf.share(bytes, `${fname}.pdf`, `${r.p.name} — Summary`, reportText(r));
              else FF.pdf.download(bytes, `${fname}.pdf`);
              U.toast(k === 'share' ? 'Share ready ✓' : 'PDF downloaded ✓', 'ok');
            } else if (k === 'wa') window.open(U.waLink(reportText(r)), '_blank', 'noopener');
            else if (k === 'copy') { await U.copyText(reportText(r)); U.toast('Summary copied (with Grand Total) ✓', 'ok'); }
            else if (k === 'csv') {
              const rows = reportCsv(r);
              U.downloadCsv(`${fname}.csv`, rows[0] || ['Field', 'Value'], rows.slice(1));
              U.toast('CSV downloaded (with Grand Total) ✓', 'ok');
            } else if (k === 'excel') {
              FF.xlsx.download(`${fname}.xlsx`, reportXlsx(r));
              U.toast('Excel downloaded (multi-sheet, Grand Total) ✓', 'ok');
            }
          } catch (err) {
            if (k === 'pdf' && U.downloadFail) U.downloadFail(`${fname}.pdf`, (err && err.message) || 'PDF export failed');
            console.error('[agentSummary] export failed:', err);
            U.toast(`${(err && err.message) || 'Export fail hua'}`, 'err');
          } finally {
            act.disabled = false;
          }
          return;
        }
        if (!e.target.closest('.as-search')) drop.hidden = true;
      };
      root.addEventListener('click', root.__asSummaryClick);

      const initial = (params && params.name && matchPeople(state.list, params.name)[0])
        || (params && params.q && matchPeople(state.list, params.q)[0])
        || state.picked
        || state.list.find((p) => p.kind.endsWith('tl'))
        || state.list[0];
      const asked = params && (params.name || params.q);
      if (asked && !matchPeople(state.list, asked)[0]) U.toast(`“${asked}” ${chLabel} me nahi mila — ${isGv ? 'FF' : 'GV'} se dekho ya naam check karo`, 'warn');
      if (initial) await pick(initial);
      else body.innerHTML = '<div class="card"><div class="card-body empty">Koi agent / TL data nahi mila.</div></div>';
    }
    // ⚠️ Shell har page ko { title, render } object ke roop me call karta hai (app.js → FF.pages[page].render).
    // Pehle yahan bare function return ho raha tha → "FF.pages[page].render is not a function" crash.
    return { title: 'Agent / TL Summary', render };
  }

  FF.pages.ffAgentSummary = makePage('ff');
  FF.pages.gvAgentSummary = makePage('gv');
  FF.agentSummary = { loadPeople, matchPeople, topSuggestions, buildReport, makePdf, reportText, reportCsv, reportXlsx, reportHtml, monthlyTrend, agentAlerts, activityStatus, buildTeamPack, teamPackPdf, teamPackXlsx, agentWaText, clearCaches };
})(window.FF);
