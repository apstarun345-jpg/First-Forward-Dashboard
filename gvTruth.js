/* 🧾 GV TRUTH ENGINE (v3.45) — GV Partner ke saare number ek hi jagah, source ke saath.
 *
 *  User rule (confirmed):
 *    • GV MASTER (tag ledger: VRN barcode, TAG_ID, agent name, date, class…) = FINAL issuance.
 *    • TAG ASSIGNMENT                                                        = FINAL stock.
 *    • GV REPORT (sheet ke bane-banaye month/stock numbers)                  = cross-check.
 *  Har KPI ke saath ye bhi dikhta hai ki dusre source me kitna likha hai aur farq kyun hai — kuch
 *  chhupta nahi. Drill-down har number ke NEECHE ki tag rows dikhata hai (VRN barcode / tag id / date /
 *  class / status / agent / TL), taaki number ko ginti se verify kiya ja sake.
 *
 *  Ye module sirf padhta hai (koi sheet write nahi) aur FF.gv ke already-loaded datasets par chalta hai
 *  (GV Master poora load hota hai; Tag Assignment aggregated + on-demand tag query). Ek index ek baar
 *  banta hai (data identity par cache), isliye 200+ agents/TLs ki list bhi turant banti hai.
 */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const clean = U.clean;

  const norm = (s) => clean(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const idKey = (v) => clean(v).toUpperCase().replace(/\.0+$/, '').replace(/\s+/g, '');
  const nameKey = (v) => clean(v).toUpperCase().replace(/\s+/g, ' ');
  const sum = (list, f) => (list || []).reduce((n, x) => n + (Number(f(x)) || 0), 0);

  const G = () => FF.gv;
  const todayKey = () => (G() && G().todayKey ? G().todayKey() : U.dateKey(new Date()));
  const curYm = () => U.ymKey(new Date());
  const prevYmOf = (ym) => U.prevMonthKey(ym || curYm());
  const daysIn = (ym) => (U.daysInMonth ? U.daysInMonth(ym) : 30);

  // ---- source accessors ----------------------------------------------------------------------------
  const ledgerRows = () => { try { return (G() && G().rows()) || []; } catch { return []; } };
  const reportRows = () => { try { return (G() && G().get('report')) || []; } catch { return []; } };
  const stockAgentRows = () => { try { return (G() && G().get('stockAgent')) || []; } catch { return []; } };
  const stockAgentClassRows = () => { try { return (G() && G().get('stockAgentClass')) || []; } catch { return []; } };
  const stockTlRows = () => { try { return (G() && G().get('stockTl')) || []; } catch { return []; } };
  const stockTlClassRows = () => { try { return (G() && G().get('stockTlClass')) || []; } catch { return []; } };
  const stockClassRows = () => { try { return (G() && G().get('stockClass')) || []; } catch { return []; } };
  const eirDaily = () => { try { return (FF.store && FF.store.get('daily')) || []; } catch { return []; } };
  const eirAgentClass = () => { try { return (FF.store && FF.store.get('agentClass')) || []; } catch { return []; } };

  // ---- one-pass index (data identity par cached) ----------------------------------------------------
  function push(map, key, row) { if (!key) return; const list = map.get(key); if (list) list.push(row); else map.set(key, [row]); }
  function dataKey() {
    const d = (G() && G().state && G().state.data) || {};
    const len = (a) => (Array.isArray(a) ? a.length : -1);
    return [len(d.master), len(d.stockAgent), len(d.stockAgentClass), len(d.stockTl), len(d.stockTlClass), len(d.report), todayKey()].join('|');
  }
  let idxCache = { key: '', refs: [], value: null };
  function invalidateIndex() { idxCache = { key: '', refs: [], value: null }; }
  function index() {
    const key = dataKey();
    const data = (G() && G().state && G().state.data) || {};
    const refs = ['master', 'stockAgent', 'stockAgentClass', 'stockTl', 'stockTlClass', 'report'].map((k) => data[k]);
    if (idxCache.key === key && idxCache.value && refs.every((ref, i) => ref === idxCache.refs[i])) return idxCache.value;
    const ledger = { byAgentId: new Map(), byAgentName: new Map(), byTlId: new Map(), byTlName: new Map() };
    for (const r of ledgerRows()) {
      push(ledger.byAgentId, idKey(r.agentId), r);
      push(ledger.byAgentName, nameKey(r.agentName), r);
      // ⚠️ GV Unique ID/Name se index NAHI karte: wo GV side ka shared id hota hai (ek hi value kai
      // agents par), isliye usse match karne par sab rows jod me aa jaati thi.
      [r.tlId, r.supervisorId, r.gvTlId].forEach((id) => push(ledger.byTlId, idKey(id), r));
      push(ledger.byTlName, nameKey(r.tlName), r);
    }
    const stock = {
      byAgentId: new Map(), byAgentName: new Map(), byTlId: new Map(), byTlName: new Map(),
      tlTotalsById: new Map(), tlTotalsByName: new Map(),
      classByAgentId: new Map(), classByAgent: new Map(), classByTlId: new Map(), classByTl: new Map()
    };
    for (const r of stockAgentRows()) {
      push(stock.byAgentId, idKey(r.agentId), r);
      push(stock.byAgentName, nameKey(r.agentName), r);
      push(stock.byTlId, idKey(r.tlId), r);
      push(stock.byTlName, nameKey(r.tlName), r);
    }
    for (const r of stockTlRows()) {
      push(stock.tlTotalsById, idKey(r.tlId), r);
      push(stock.tlTotalsByName, nameKey(r.tlName), r);
    }
    for (const r of stockAgentClassRows()) {
      push(stock.classByAgentId, idKey(r.agentId), r);
      push(stock.classByAgent, nameKey(r.agentName), r);
    }
    for (const r of stockTlClassRows()) {
      push(stock.classByTlId, idKey(r.tlId), r);
      push(stock.classByTl, nameKey(r.tlName), r);
    }
    const sheet = { byAgentId: new Map(), byAgentName: new Map(), byTlId: new Map(), byTlName: new Map() };
    for (const r of reportRows()) {
      push(sheet.byAgentId, idKey(r.agentId), r);
      push(sheet.byAgentName, nameKey(r.agentName), r);
      push(sheet.byTlId, idKey(r.tlId), r);
      push(sheet.byTlId, idKey(r.supervisorId), r);
      push(sheet.byTlName, nameKey(r.tlName), r);
    }
    const value = { key, ledger, stock, sheet };
    idxCache = { key, refs, value };
    return value;
  }

  // ---- identity ------------------------------------------------------------------------------------
  function identityOf(spec) {
    const isTl = /tl$/.test(String(spec.kind || ''));
    const ids = [], names = [];
    if (spec.id) ids.push(idKey(spec.id));
    if (spec.tlId) ids.push(idKey(spec.tlId));
    (spec.tlIds || []).forEach((x) => ids.push(idKey(x)));
    (spec.altIds || []).forEach((x) => ids.push(idKey(x)));
    if (spec.name) names.push(nameKey(spec.name));
    return { isTl, ids: [...new Set(ids.filter(Boolean))], names: [...new Set(names.filter(Boolean))] };
  }
  function lookup(map, keys) {
    const out = [];
    const seen = new Set();
    for (const k of keys) for (const r of (map.get(k) || [])) { if (!seen.has(r)) { seen.add(r); out.push(r); } }
    return out;
  }
  /** ID aur naam dono se milne wali rows ko ek baar hi lo (same row do baar nahi ginti). */
  function mergeLookups(a, b) {
    const out = [], seen = new Set();
    for (const r of a.concat(b)) { if (!seen.has(r)) { seen.add(r); out.push(r); } }
    return out;
  }
  function ledgerFor(spec) {
    const id = identityOf(spec);
    const ix = index();
    if (id.isTl) {
      const direct = mergeLookups(lookup(ix.ledger.byTlId, id.ids), lookup(ix.ledger.byTlName, id.names));
      if (direct.length) return direct;
      if (G() && G().tlIssuanceRows) {
        const rows = G().tlIssuanceRows(spec.id || '', spec.name || '');
        if (Array.isArray(rows) && rows.length) return rows;
      }
      return [];
    }
    return mergeLookups(lookup(ix.ledger.byAgentId, id.ids), lookup(ix.ledger.byAgentName, id.names));
  }

  // ---- stats ---------------------------------------------------------------------------------------
  function dailySeries(rows) {
    const map = new Map();
    for (const r of rows) {
      const day = Number(r.day) || 0;
      if (!day) continue;
      const b = map.get(day) || { day, n: 0, vc4: 0, comm: 0 };
      const n = Number(r.n) || 1;
      b.n += n; if (r.group === 'VC4') b.vc4 += n; else b.comm += n;
      map.set(day, b);
    }
    return [...map.values()].sort((a, b) => a.day - b.day);
  }
  function monthStat(rows) {
    const byClass = {};
    const days = new Set();
    let vc4 = 0, comm = 0, replacement = 0, chassis = 0, commission = 0, amount = 0, units = 0;
    for (const r of rows) {
      const n = Number(r.n) || 1;
      units += n;
      const cls = U.clean(r.cls) || 'NA';
      byClass[cls] = (byClass[cls] || 0) + n;
      if (r.group === 'VC4') vc4 += n; else comm += n;
      if (/replacement/i.test(`${r.type || ''} ${r.status || ''}`)) replacement += n;
      if (/chassis/i.test(`${r.vrnType || ''} ${r.tagType || ''}`)) chassis += n;
      commission += Number(r.commission) || 0;
      amount += Number(r.amount) || 0;
      if (r.day) days.add(Number(r.day));
    }
    const dayList = [...days].sort((a, b) => a - b);
    return {
      total: units, units, vc4, comm, byClass, replacement, chassis, vrn: units - chassis, commission, amount,
      rowCount: rows.length, days: days.size, firstDay: dayList[0] || 0, lastDay: dayList[dayList.length - 1] || 0,
      daily: dailySeries(rows)
    };
  }
  function monthStatOf(rows, ym) { return monthStat(rows.filter((r) => r.ym === ym)); }

  // ---- stock ---------------------------------------------------------------------------------------
  function stockClassLabel(value) {
    const token = clean(value).toUpperCase().replace(/\s+/g, '');
    if (!token || /^(?:NA|N\/A|UNKNOWN|UNSPECIFIED|OTHER|—|-)$/i.test(token)) return '';
    if (/^\d+$/.test(token)) return `VC${token}`;
    if (/^VC\d+$/.test(token)) return token;
    if (/^(?:COMMERCIAL|COMM|NVC4)$/.test(token)) return 'Commercial';
    return '';
  }
  function stockClassGroup(cls) {
    if (cls === 'VC4') return 'VC4';
    if (cls === 'VC20' || cls === 'Commercial') return 'COMM';
    if (/^VC\d+$/.test(cls)) return 'VC5+';
    return '';
  }
  function classSplit(rows) {
    const byClass = new Map();
    let invalid = 0;
    (rows || []).forEach((r) => {
      const raw = clean(r && r.cls);
      const cls = stockClassLabel(raw);
      const n = Number(r && r.n) || 0;
      const group = cls && stockClassGroup(cls);
      // A missing or unfamiliar Tag Assignment class is not Commercial. Keep its count separate,
      // then mark the split unavailable instead of manufacturing a class allocation.
      if (!cls || !group) { invalid += n; return; }
      const c = byClass.get(cls) || { cls, group, n: 0, nAll: 0 };
      c.n += n;
      c.nAll += r && r.nAll !== undefined ? (Number(r.nAll) || 0) : n;
      byClass.set(cls, c);
    });
    const list = [...byClass.values()].sort((a, b) => b.n - a.n);
    const total = sum(list, (c) => c.n);
    const nAll = sum(list, (c) => c.nAll);
    const vc4 = sum(list.filter((c) => c.group === 'VC4'), (c) => c.n);
    return { total, nAll, vc4, comm: total - vc4, excluded: Math.max(0, nAll - total), invalid, byClass: list };
  }
  /** ID is authoritative when available; a same-name holder must never be merged into it. */
  function preferredRows(byId, byName, rawId, rawName, ownerField) {
    const id = idKey(rawId);
    const exact = id ? lookup(byId, [id]) : [];
    if (exact.length) return exact;
    const name = nameKey(rawName);
    const named = name ? lookup(byName, [name]) : [];
    // When an ID was requested, a name fallback is safe only if every named row has that same owner ID.
    // Missing IDs are ambiguous too; do not quietly merge same-name people/TLs.
    if (id && named.length) {
      const field = ownerField || 'agentId';
      const ids = new Set(named.map((r) => idKey(r && r[field])).filter(Boolean));
      if (ids.size !== 1 || !ids.has(id)) return [];
    }
    return named;
  }
  function assignmentLoaded(key) {
    try { return Array.isArray(G() && G().get && G().get(key)); } catch { return false; }
  }
  function unknownClassSplit(total) {
    const n = Math.max(0, Number(total) || 0);
    return { total: n, units: n, vc4: null, comm: null, byClass: [], classAvailable: false };
  }
  function exactClassSplit(rows, total, available) {
    const n = Math.max(0, Number(total) || 0);
    const raw = classSplit(rows || []);
    if (!available || raw.invalid > 0 || raw.total !== n) return unknownClassSplit(n);
    return { ...raw, classAvailable: true };
  }
  function agentStock(spec) {
    const ix = index();
    const tlId = clean(spec.tlId || spec.supervisorId || '');
    const inTlScope = (r) => !tlId || idKey(r && r.tlId) === idKey(tlId);
    const rows = preferredRows(ix.stock.byAgentId, ix.stock.byAgentName, spec.id, spec.name, 'agentId').filter(inTlScope);
    const cls = preferredRows(ix.stock.classByAgentId, ix.stock.classByAgent, spec.id, spec.name, 'agentId').filter(inTlScope);
    const total = rows.length ? sum(rows, (r) => r.n) : sum(cls, (r) => r.n);
    const classLoaded = assignmentLoaded('stockAgentClass');
    const split = exactClassSplit(cls, total, classLoaded);
    const byStatus = {};
    rows.forEach((r) => Object.entries(r.byStatus || {}).forEach(([k, v]) => { byStatus[k] = (byStatus[k] || 0) + v; }));
    const one = rows[0] || cls[0] || {};
    const sourceLoaded = assignmentLoaded('stockAgent') || classLoaded;
    const holderFound = rows.length > 0 || cls.length > 0;
    const tlCoverage = tlId ? tlStock({ kind: 'gv-tl', id: tlId, name: spec.tlName || spec.supervisorName || '' }) : null;
    // A missing agent row is a confirmed zero only when there is no team scope, or the Tag
    // Assignment holder rows reconcile exactly to that TL's independent aggregate. If the TL
    // total exposes a partial holder list, leave absent agents unavailable instead of showing 0.
    const holderAbsenceConfirmed = !tlId || !!(tlCoverage && tlCoverage.authoritative && tlCoverage.holderBreakdownAvailable);
    const authoritative = sourceLoaded && (holderFound || holderAbsenceConfirmed);
    return {
      ...split, total, byStatus, tlName: one.tlName || '', tlId: one.tlId || '', own: total,
      ownParts: { ...split, total }, agentsTotal: 0, agentCount: rows.length ? 1 : 0,
      source: 'Tag Assignment', authoritative, classAvailable: split.classAvailable,
      holderBreakdownAvailable: authoritative
    };
  }
  function sameSelf(row, tlId, tlName) {
    return (!!tlId && idKey(row && row.agentId) === idKey(tlId)) || (!!tlName && nameKey(row && row.agentName) === nameKey(tlName));
  }
  function tlStock(spec) {
    const ix = index();
    const tlId = clean(spec.tlId || spec.id || (spec.tlIds || [])[0] || '');
    const tlName = clean(spec.name || '');
    const directRows = preferredRows(ix.stock.tlTotalsById, ix.stock.tlTotalsByName, tlId, tlName, 'tlId');
    const tlClassRows = preferredRows(ix.stock.classByTlId, ix.stock.classByTl, tlId, tlName, 'tlId');
    const agentRows = preferredRows(ix.stock.byTlId, ix.stock.byTlName, tlId, tlName, 'tlId');
    const isSelfHolder = (r) => sameSelf(r, tlId, tlName);
    // The TL's own Tag Assignment row can satisfy the generic GV self-supervised/direct rule.
    // It remains a legitimate TL-own holder here; exclude only unrelated direct agents.
    const eligibleAgentRows = agentRows.filter((r) => isSelfHolder(r) || !(r.directAgent === true || safeDirectAgent(r)));
    const assignmentAuthoritative = ['stockTl', 'stockTlClass', 'stockAgent', 'stockAgentClass'].some(assignmentLoaded);
    const exactTotal = directRows.length ? sum(directRows, (r) => r.n) : tlClassRows.length ? sum(tlClassRows, (r) => r.n) : null;

    // Agent × class is keyed by holder IDs and TL IDs (not just a shared display name).
    const classRows = stockAgentClassRows();
    const scopedClassRows = classRows.filter((r) => {
      const rowTlId = clean(r && r.tlId);
      if (tlId) return !!rowTlId && idKey(rowTlId) === idKey(tlId);
      return !!tlName && nameKey(r && r.tlName) === nameKey(tlName);
    });
    const peopleForClass = (people) => {
      const picked = [], seen = new Set();
      for (const person of people || []) {
        const id = idKey(person.agentId), name = nameKey(person.agentName);
        let matches = id ? scopedClassRows.filter((r) => idKey(r.agentId) === id) : [];
        if (!matches.length && name) {
          const namedRows = scopedClassRows.filter((r) => nameKey(r.agentName) === name);
          const rowIds = new Set(namedRows.map((r) => idKey(r.agentId)).filter(Boolean));
          const rosterIds = new Set(agentRows.filter((r) => nameKey(r.agentName) === name).map((r) => idKey(r.agentId)).filter(Boolean));
          const safeNameFallback = !id
            ? rowIds.size <= 1
            : rowIds.size === 0 && rosterIds.size === 1 && rosterIds.has(id);
          if (safeNameFallback) matches = namedRows;
        }
        matches.forEach((r) => { if (!seen.has(r)) { seen.add(r); picked.push(r); } });
      }
      return picked;
    };
    const eligibleClassRows = scopedClassRows.filter((r) => isSelfHolder(r) || !(r.directAgent === true || safeDirectAgent(r)));
    const selfRows = eligibleAgentRows.filter((r) => sameSelf(r, tlId, tlName));
    const members = eligibleAgentRows.filter((r) => !sameSelf(r, tlId, tlName));
    const selfClassRows = peopleForClass(selfRows);
    const memberClassRows = peopleForClass(members);
    const classSource = tlClassRows.length ? tlClassRows : eligibleClassRows;
    const derivedTotal = sum(eligibleAgentRows, (r) => r.n);
    const total = exactTotal === null ? (sum(classSource, (r) => r.n) || derivedTotal) : exactTotal;
    const classDatasetLoaded = assignmentLoaded('stockTlClass') || assignmentLoaded('stockAgentClass');
    const split = exactClassSplit(classSource, total, classDatasetLoaded);

    // Own/agent counts are shown only when Tag Assignment holder rows account for the exact TL total.
    // A TL-level aggregate by itself cannot tell us who holds it; never guess that all stock is TL-own.
    const classHolderMap = new Map();
    for (const r of eligibleClassRows) {
      const id = idKey(r.agentId), name = nameKey(r.agentName), key = id ? `#${id}` : `n:${name}`;
      if (!key || key === 'n:') continue;
      const cur = classHolderMap.get(key) || { agentId: r.agentId, agentName: r.agentName, tlId: r.tlId, tlName: r.tlName, n: 0 };
      cur.n += Number(r.n) || 0;
      classHolderMap.set(key, cur);
    }
    const classHolderRows = [...classHolderMap.values()];
    const agentRowsTotal = sum(eligibleAgentRows, (r) => r.n);
    const classHolderTotal = sum(classHolderRows, (r) => r.n);
    const holderDataLoaded = assignmentLoaded('stockAgent') || assignmentLoaded('stockAgentClass');
    const holders = eligibleAgentRows.length && agentRowsTotal === total
      ? eligibleAgentRows
      : classHolderRows.length && classHolderTotal === total ? classHolderRows
        : eligibleAgentRows.length ? eligibleAgentRows : classHolderRows;
    const holderTotal = sum(holders, (r) => r.n);
    const holderBreakdownAvailable = holderDataLoaded && holderTotal === total;
    const selfHolders = holders.filter((r) => sameSelf(r, tlId, tlName));
    const memberHolders = holders.filter((r) => !sameSelf(r, tlId, tlName)
      && !(r.directAgent === true || safeDirectAgent(r)));
    const ownTotal = holderBreakdownAvailable ? sum(selfHolders, (r) => r.n) : null;
    const agentsTotal = holderBreakdownAvailable ? sum(memberHolders, (r) => r.n) : null;
    const ownRows = peopleForClass(selfHolders);
    const memberRows = peopleForClass(memberHolders);
    const ownClass = exactClassSplit(ownRows, ownTotal || 0, holderBreakdownAvailable && assignmentLoaded('stockAgentClass'));
    const agentsClass = exactClassSplit(memberRows, agentsTotal || 0, holderBreakdownAvailable && assignmentLoaded('stockAgentClass'));
    const byStatus = {};
    directRows.forEach((r) => Object.entries(r.byStatus || {}).forEach(([k, v]) => { byStatus[k] = (byStatus[k] || 0) + v; }));
    const nAll = directRows.length ? sum(directRows, (r) => r.nAll === undefined ? r.n : r.nAll) : split.nAll || total;
    const ownParts = { ...ownClass, total: ownTotal };
    const agents = { ...agentsClass, total: agentsTotal };
    return {
      ...split, byStatus, own: ownTotal, agentsTotal,
      ownParts, agents, agentCount: memberHolders.length, source: 'Tag Assignment',
      authoritative: assignmentAuthoritative, classAvailable: split.classAvailable,
      holderBreakdownAvailable, holderClassAvailable: ownClass.classAvailable && agentsClass.classAvailable,
      memberStockAvailable: holderBreakdownAvailable,
      nAll: Math.max(total, nAll), excluded: Math.max(0, nAll - total)
    };
  }
  const stockFor = (spec) => (identityOf(spec).isTl ? tlStock(spec) : agentStock(spec));
  function safeDirectAgent(row) {
    try { return !!(FF.config && FF.config.isDirectAgent && FF.config.isDirectAgent(row, 'gv')); } catch { return false; }
  }

  // ---- GV REPORT (sheet) cross-check ---------------------------------------------------------------
  function reportRowFor(spec) {
    const id = identityOf(spec);
    const ix = index();
    if (!id.isTl) return (lookup(ix.sheet.byAgentId, id.ids)[0]) || (lookup(ix.sheet.byAgentName, id.names)[0]) || null;
    const team = mergeLookups(lookup(ix.sheet.byTlId, id.ids), lookup(ix.sheet.byTlName, id.names));
    if (team.length) {
      // TL snapshot sheet ki har team row par repeat hota hai — koi bhi ek row ka snapshot wahi hota hai.
      const withSnapshot = team.find((r) => r.tlCurAvailable || r.tlLastAvailable || r.tlStockAvailable);
      return withSnapshot || team[0];
    }
    // TL na mile to khud TL ki row (AGENT_ID = TL ID) dhoondho
    return (lookup(ix.sheet.byAgentId, id.ids)[0]) || (lookup(ix.sheet.byAgentName, id.names)[0]) || null;
  }
  function sheetFor(spec) {
    const r = reportRowFor(spec);
    if (!r) return null;
    const isTl = identityOf(spec).isTl;
    const pick = (tlKey, agentKey) => {
      const v = isTl ? r[tlKey] : r[agentKey];
      return v === null || v === undefined ? null : v;
    };
    return {
      found: true, agentName: r.agentName, agentId: r.agentId, tlName: r.tlName, tlId: r.tlId,
      cur: pick('tlCurTotal', 'curTotal'), curVc4: pick('tlCurVc4', 'curVc4'), curComm: pick('tlCurComm', 'curComm'),
      last: pick('tlLastTotal', 'lastTotal'), lastVc4: pick('tlLastVc4', 'lastVc4'), lastComm: pick('tlLastComm', 'lastComm'),
      stock: pick('tlStockTotal', 'stockTotal'), stockVc4: pick('tlStockVc4', 'stockVc4'), stockComm: pick('tlStockComm', 'stockComm'),
      curAvailable: !!r.tlCurAvailable || !!r.curAvailable, lastAvailable: !!r.tlLastAvailable || !!r.lastAvailable,
      stockAvailable: !!r.tlStockAvailable || !!r.stockClassAvailable, todayIssued: r.todayIssued,
      growth: r.growth, priority: r.priority, perf: r.agentPerf, status: r.agentStatus, curDays: r.curDays, lastDays: r.lastDays,
      tlTeam: !!r.tlName
    };
  }

  // ---- EIR cross-check (First Forward sheet ka GV ledger) ------------------------------------------
  function eirFor(spec, ym) {
    const id = identityOf(spec);
    const y = ym || curYm();
    const matchRow = (r) => (id.isTl
      ? id.names.includes(nameKey(r.tlName))
      : (id.names.includes(nameKey(r.name)) || id.names.includes(nameKey(r.agentName)) || id.names.includes(nameKey(r.gvName))));
    const rows = eirAgentClass().filter((r) => /gv/i.test(String(r.channel || '')) && matchRow(r));
    const out = { cur: 0, last: 0, today: 0, rows: rows.length };
    rows.forEach((r) => {
      if (r.ym === y) out.cur += Number(r.n) || 0;
      else if (r.ym === prevYmOf(y)) out.last += Number(r.n) || 0;
    });
    const tk = todayKey();
    out.today = eirDaily().filter((r) => r.channel === 'GV Partner' && r.key === tk && matchRow(r)).reduce((n, r) => n + (Number(r.n) || 0), 0);
    return out;
  }

  // ---- person truth --------------------------------------------------------------------------------
  function person(spec) {
    const ym = spec.ym || curYm();
    const id = identityOf(spec);
    const isTl = id.isTl;
    const all = ledgerFor(spec);
    const curRows = all.filter((r) => r.ym === ym);
    const lastRows = all.filter((r) => r.ym === prevYmOf(ym));
    const tk = todayKey();
    const todayRows = all.filter((r) => (r.key ? r.key === tk : r.date && U.dateKey(r.date) === tk));
    const monthSet = [...new Set(all.map((r) => r.ym).filter(Boolean))].sort();
    const ledger = {
      cur: monthStat(curRows), last: monthStat(lastRows), today: monthStat(todayRows),
      months: monthSet, rows: { cur: curRows, last: lastRows, today: todayRows, all }
    };
    const sheet = sheetFor(spec);
    const stock = stockFor(spec);
    const eir = eirFor(spec, ym);
    const warnings = [];
    if (!sheet && !isTl) warnings.push('Is agent ka row GV REPORT sheet me nahi mila — sirf GV Master ledger numbers dikh rahe hain.');
    if (sheet && !sheet.curAvailable && !sheet.lastAvailable) warnings.push('GV REPORT me is person ke month cells khaali hain — sheet cross-check available nahi.');
    if (stock.excluded > 0) warnings.push(`Tag Assignment me ${stock.excluded} tag rows ka status out-of-stock (issued/returned) hai — wo stock me nahi gine gaye.`);
    if (!stock.authoritative) warnings.push('Tag Assignment stock source abhi available nahi — stock ko confirm hone tak nahi dikhaya jayega.');
    else if (!stock.classAvailable) warnings.push('Tag Assignment se total stock available hai, lekin class mix match nahi hua — VC4 / Commercial split nahi dikhaya jayega.');
    if (isTl && stock.authoritative && !stock.holderBreakdownAvailable) warnings.push('Tag Assignment TL total available hai, lekin complete holder rows nahi mili — TL own / agents split nahi dikhaya jayega.');
    if (!all.length) warnings.push('GV Master me is person ki koi tag row nahi mili — naam/ID check karein (ya sheet me hi data nahi hai).');
    const checks = [
      { metric: `Issuance · is mahine (${ym})`, final: ledger.cur.total, others: [
        sheet && sheet.curAvailable ? { label: 'GV REPORT sheet', value: sheet.cur } : null,
        { label: 'EIR ledger', value: eir.cur }] },
      { metric: `Issuance · last month (${prevYmOf(ym)})`, final: ledger.last.total, others: [
        sheet && sheet.lastAvailable ? { label: 'GV REPORT sheet', value: sheet.last } : null,
        { label: 'EIR ledger', value: eir.last }] },
      { metric: 'Stock in hand (live)', final: stock.authoritative ? stock.total : null, others: [
        sheet && sheet.stockAvailable ? { label: 'GV REPORT sheet', value: sheet.stock } : null] }
    ].map((c) => ({ ...c, others: c.others.filter(Boolean).map((o) => ({ ...o, diff: c.final === null || c.final === undefined ? null : c.final - (Number(o.value) || 0) })) }));
    return {
      ch: 'gv', kind: isTl ? 'tl' : 'agent', name: spec.name, id: spec.id || (sheet && sheet.agentId) || '', mobile: spec.mobile || '',
      direct: !!spec.direct, tlName: spec.tlName || (sheet && !isTl ? sheet.tlName : '') || stock.tlName || '', tlId: spec.tlId || (sheet && sheet.tlId) || stock.tlId || '',
      ym, lastYm: prevYmOf(ym), ledger, sheet, stock, eir, checks, warnings, source: 'GV Master (final) · Tag Assignment (stock) · GV REPORT (cross-check)',
      generatedAt: Date.now()
    };
  }

  // ---- people list (ledger se, bina kisi heavy join ke) --------------------------------------------
  function reportDataRowFromTruth(spec) { return person(spec); }
  /** GV ke agents + TLs — ledger (issuance) + Tag Assignment (stock) + sheet cross-check ek jagah. */
  function people() {
    const ix = index();
    const map = new Map();
    const ensure = (kind, name, id, extra = {}) => {
      const nm = clean(name);
      if (!nm) return null;
      const k = `${kind}|${nameKey(nm)}`;
      let e = map.get(k);
      if (!e) {
        const placeholder = kind === 'gv-tl' && !!(FF.config && FF.config.isExcludedTl && FF.config.isExcludedTl(nm));
        e = { kind, name: nm, id: clean(id), tlName: '', tlId: '', cur: 0, last: 0, today: 0, stock: 0, sheetCur: null, sheetLast: null, sheetStock: null, isDirect: false, isPlaceholder: placeholder, altIds: new Set(), mobile: '' };
        map.set(k, e);
      }
      if (!e.id && id) e.id = clean(id);
      Object.assign(e, extra);
      return e;
    };
    for (const r of ledgerRows()) {
      const direct = FF.config.isDirectAgent ? FF.config.isDirectAgent(r, 'gv') : !!r.directAgent;
      const a = ensure('gv-agent', r.agentName, r.agentId, { tlName: r.tlName, tlId: r.tlId, isDirect: direct });
      if (a) {
        const n = Number(r.n) || 1;
        if (r.ym === curYm()) a.cur += n;
        else if (r.ym === prevYmOf(curYm())) a.last += n;
        if (r.key === todayKey()) a.today += n;
      }
      const tlId = clean(r.tlId || r.supervisorId || r.gvTlId);
      const tlName = clean(r.tlName) || (tlId ? `TL ${tlId}` : '');
      if (!direct && (tlName || tlId)) {
        const t = ensure('gv-tl', tlName, tlId);
        if (t) {
          const n = Number(r.n) || 1;
          if (r.ym === curYm()) t.cur += n;
          else if (r.ym === prevYmOf(curYm())) t.last += n;
          if (r.key === todayKey()) t.today += n;
          [r.tlId, r.supervisorId, r.gvTlId].forEach((id) => { if (id) t.altIds.add(clean(id)); });
        }
      }
    }
    const hasAgentStock = assignmentLoaded('stockAgent');
    const hasAgentClassStock = assignmentLoaded('stockAgentClass');
    const hasTlStock = assignmentLoaded('stockTl');
    const hasTlClassStock = assignmentLoaded('stockTlClass');
    const agentStockSource = hasAgentStock ? stockAgentRows() : (hasAgentClassStock ? stockAgentClassRows() : []);
    for (const r of agentStockSource) {
      const a = ensure('gv-agent', r.agentName, r.agentId, { tlName: r.tlName, tlId: r.tlId });
      if (a) a.stock += Number(r.n) || 0;
    }
    const tlStockMap = new Map();
    if (hasTlStock) {
      for (const r of stockTlRows()) {
        const key = idKey(r.tlId) || nameKey(r.tlName);
        if (key) tlStockMap.set(key, (tlStockMap.get(key) || 0) + (Number(r.n) || 0));
      }
    } else if (hasTlClassStock) {
      for (const r of stockTlClassRows()) {
        const key = idKey(r.tlId) || nameKey(r.tlName);
        if (key) tlStockMap.set(key, (tlStockMap.get(key) || 0) + (Number(r.n) || 0));
      }
    } else {
      for (const r of agentStockSource) {
        if (r.directAgent === true || safeDirectAgent(r)) continue;
        const key = idKey(r.tlId) || nameKey(r.tlName);
        if (key) tlStockMap.set(key, (tlStockMap.get(key) || 0) + (Number(r.n) || 0));
      }
    }
    for (const r of (hasTlStock ? stockTlRows() : hasTlClassStock ? stockTlClassRows() : agentStockSource)) {
      if (!clean(r.tlName) && !clean(r.tlId)) continue;
      const t = ensure('gv-tl', r.tlName || `TL ${r.tlId}`, r.tlId, {});
      const key = idKey(r.tlId) || nameKey(r.tlName);
      if (t && key) t.stock = tlStockMap.get(key) || 0;
    }
    for (const r of reportRows()) {
      const a = ensure('gv-agent', r.agentName, r.agentId, { tlName: r.tlName, tlId: r.tlId });
      if (a) {
        if (r.curAvailable) a.sheetCur = r.curTotal;
        if (r.lastAvailable) a.sheetLast = r.lastTotal;
        if (r.stockClassAvailable) a.sheetStock = r.stockTotal;
        if (r.mobile) a.mobile = r.mobile;
      }
      if (clean(r.tlName) && clean(r.tlId)) {
        const t = ensure('gv-tl', r.tlName, r.tlId, {});
        if (t) {
          if (r.tlCurAvailable && t.sheetCur === null) t.sheetCur = r.tlCurTotal;
          if (r.tlLastAvailable && t.sheetLast === null) t.sheetLast = r.tlLastTotal;
          if (r.tlStockAvailable && t.sheetStock === null) t.sheetStock = r.tlStockTotal;
        }
      }
    }
    // Asli log pehle (jin ka issuance/stock hai), placeholder TL (Unassigned/Direct…) sabse aakhir me —
    // page ka default pick hamesha kisi kaam ke person par hi jaye.
    const tlStockAvailable = hasTlStock || hasTlClassStock || hasAgentStock || hasAgentClassStock;
    const agentStockAvailable = hasAgentStock || hasAgentClassStock;
    return [...map.values()].map((e) => ({
      ...e, altIds: [...e.altIds], stockAvailable: e.kind === 'gv-tl' ? tlStockAvailable : agentStockAvailable,
      stockClassAvailable: e.kind === 'gv-agent' ? hasAgentClassStock : hasTlClassStock || hasAgentClassStock
    }))
      .sort((a, b) => (Number(a.isPlaceholder) - Number(b.isPlaceholder)) || ((b.cur + (b.stockAvailable ? b.stock : 0)) - (a.cur + (a.stockAvailable ? a.stock : 0))) || a.name.localeCompare(b.name));
  }

  // ---- TL team rollup (ledger + stock + sheet, per agent) -------------------------------------------
  function team(spec) {
    const id = identityOf(spec);
    if (!id.isTl) return [];
    const isSelf = (agentId, agentName) => !!((agentId && id.ids.includes(idKey(agentId))) || (agentName && id.names.includes(nameKey(agentName))));
    const ym = spec.ym || curYm();
    const map = new Map();
    const ensure = (agentId, agentName) => {
      const k = idKey(agentId) || nameKey(agentName);
      if (!k) return null;
      let e = map.get(k);
      if (!e) { e = { key: k, name: clean(agentName) || clean(agentId), id: clean(agentId), isSelf: isSelf(agentId, agentName), cur: 0, last: 0, today: 0, stock: 0, sheetCur: null, sheetLast: null, sheetStock: null, classes: {} }; map.set(k, e); }
      if (!e.id && agentId) e.id = clean(agentId);
      if (!e.name && agentName) e.name = clean(agentName);
      return e;
    };
    for (const r of mergeLookups(lookup(index().ledger.byTlId, id.ids), lookup(index().ledger.byTlName, id.names))) {
      const e = ensure(r.agentId, r.agentName);
      if (!e) continue;
      const n = Number(r.n) || 1;
      if (r.ym === ym) e.cur += n;
      else if (r.ym === prevYmOf(ym)) e.last += n;
      if ((r.key || '') === todayKey()) e.today += n;
      const cls = U.clean(r.cls) || 'NA';
      e.classes[cls] = (e.classes[cls] || 0) + n;
    }
    const hasAgentStock = assignmentLoaded('stockAgent');
    const hasAgentClassStock = assignmentLoaded('stockAgentClass');
    const teamStockRows = hasAgentStock ? stockAgentRows() : (hasAgentClassStock ? stockAgentClassRows() : []);
    for (const r of teamStockRows) {
      if (!(id.ids.includes(idKey(r.tlId)) || id.names.includes(nameKey(r.tlName)))) continue;
      if ((r.directAgent === true || safeDirectAgent(r)) && !isSelf(r.agentId, r.agentName)) continue;
      const e = ensure(r.agentId, r.agentName);
      if (e) e.stock += Number(r.n) || 0;
    }
    for (const r of reportRows()) {
      if (!(id.ids.includes(idKey(r.tlId)) || id.names.includes(nameKey(r.tlName)))) continue;
      const e = ensure(r.agentId, r.agentName);
      if (!e) continue;
      if (r.curAvailable) e.sheetCur = r.curTotal;
      if (r.lastAvailable) e.sheetLast = r.lastTotal;
      if (r.stockClassAvailable) e.sheetStock = r.stockTotal;
    }
    return [...map.values()].map((r) => ({
      ...r, stockAvailable: hasAgentStock || hasAgentClassStock, stockClassAvailable: hasAgentClassStock
    })).sort((a, b) => (b.cur + (a.stockAvailable ? b.stock : 0)) - (a.cur + (a.stockAvailable ? a.stock : 0)));
  }

  // ---- tag-level drill -----------------------------------------------------------------------------
  async function drill(spec) {
    const scope = spec.scope || 'cur';
    const p = spec.truth || person(spec);
    const cls = clean(spec.cls).toUpperCase();
    const isTl = p.kind === 'tl';
    const who = `${p.name}${p.id ? ` (${p.id})` : ''}`;
    if (scope === 'stock') {
      let rows = await stockTagRows({ ...spec, truth: p });
      const classKey = (v) => clean(v).toUpperCase().replace(/\s+/g, '');
      if (cls) rows = rows.filter((r) => classKey(r.cls) === classKey(cls));
      const part = clean(spec.part).toLowerCase();
      if (isTl && (part === 'own' || part === 'team')) {
        const selfId = idKey(p.tlId || p.id || spec.tlId || spec.id);
        const selfName = nameKey(p.name || spec.tl || spec.name);
        const isSelf = (r) => (selfId && idKey(r.agentId) === selfId) || (selfName && nameKey(r.agentName) === selfName);
        rows = rows.filter((r) => {
          if (part === 'own') return isSelf(r);
          if (isSelf(r)) return false;
          try { return !(FF.config && FF.config.isDirectAgent && FF.config.isDirectAgent(r, 'gv')); } catch { return true; }
        });
      }
      const shown = rows.filter((r) => r.inStock);
      const out = rows.filter((r) => !r.inStock);
      return {
        title: `📦 Stock in hand · ${who}${cls ? ` · ${cls}` : ''}`, source: 'Tag Assignment (GV Partner sheet)',
        note: `${isTl ? (part === 'own' ? 'TL own' : part === 'team' ? 'TL ke agents' : 'TL + uske agents') : 'Is agent'} ke ${shown.length} matching tag rows stock me hain${out.length ? ` · ${out.length} rows ka status out-of-stock tha (list me grey)` : ''}. Har row = ek tag (TAG_ID, serial/barcode, class, status, holder, TL).`,
        columns: ['TAG_ID', 'SERIAL / BARCODE', 'CLASS', 'STATUS', 'AGENT', 'AGENT ID', 'TL', 'TL ID', 'GV UNIQUE ID'],
        rows: rows.map((r) => [r.tagId || '—', r.serial || r.barcode || '—', r.cls || '—', r.status || '—', r.agentName || '—', r.agentId || '—', r.tlName || '—', r.tlId || '—', r.gvUniqueId || '—']),
        rowFlags: rows.map((r) => (r.inStock ? '' : 'out')),
        raw: rows, truth: p
      };
    }
    const base = scope === 'last' ? p.ledger.rows.last : scope === 'today' ? p.ledger.rows.today : p.ledger.rows.cur;
    const rows = cls ? base.filter((r) => (U.clean(r.cls) || 'NA').toUpperCase() === cls) : base;
    const label = scope === 'last' ? `Last month (${p.lastYm})` : scope === 'today' ? `Today (${todayKey()})` : `Is mahine (${p.ym})`;
    const total = rows.reduce((n, r) => n + (Number(r.n) || 1), 0);
    return {
      title: `🏷️ ${label} · ${who}${cls ? ` · ${cls}` : ''}`, source: 'GV Master (GV Partner sheet)',
      note: `${rows.length} tag rows GV Master ledger me — column A = agent ID, I = TAG_ID, E = VRN, F = class, P = date. Inka jod = ${total} tag.`,
      columns: ['DATE', 'VRN / BARCODE', 'TAG_ID', 'SERIAL', 'CLASS', 'TYPE', 'STATUS', 'AGENT', 'TL'],
      rows: rows.map((r) => [
        r.date ? U.labelDate(r.date, true) : (r.key || '—'),
        r.vrn || '—', r.tagId || '—', r.serial || '—', r.cls || '—',
        (/chassis/i.test(`${r.vrnType || ''}`) ? 'Chassis' : 'VRN'), r.status || '—', r.agentName || '—', r.tlName || '—'
      ]),
      raw: rows, truth: p
    };
  }
  /** Tag Assignment se tag-level rows (on demand) — sirf us person ke tags. */
  async function stockTagRows(spec) {
    const id = identityOf(spec);
    const truth = spec.truth || {};
    const a = (FF.config.gv && FF.config.gv.assignment) || {};
    const map = (G() && G().ensureAssignmentMap) ? await G().ensureAssignmentMap({ only: true }).catch(() => null) : null;
    const letter = (field, fallback) => U.colLetter(map && map.idx && map.idx[field] !== undefined ? map.idx[field] : U.colIndex(fallback));
    const L = {
      cls: letter('cls', a.cls), tagId: letter('tagId', a.tagId), serial: letter('serial', a.serial), status: letter('status', a.status),
      agentId: letter('agentId', a.agentId), agentName: letter('agentName', a.agentName), tlId: letter('tlId', a.tlId),
      tlName: letter('tlName', a.tlName), gvUniqueId: letter('gvUniqueId', a.gvUniqueId || 'L')
    };
    const lit = (v) => `'${String(v).replace(/'/g, "\\'")}'`;
    const cols = `${L.cls}, ${L.tagId}, ${L.serial}, ${L.status}, ${L.agentId}, ${L.agentName}, ${L.tlId}, ${L.tlName}, ${L.gvUniqueId}`;
    const limit = Math.max(1, Math.min(5000, Number(spec.limit) || 3000));
    const where = [];
    if (id.isTl) {
      const tName = truth.tlName || spec.tl || spec.name;
      const tId = truth.tlId || spec.tlId || spec.id;
      // Do not OR an exact TL ID with the display name: duplicate names would leak another TL's rows.
      where.push(tId ? `${L.tlId} = ${lit(tId)}` : `${L.tlName} = ${lit(tName)}`);
    } else if (spec.id || truth.id) {
      where.push(`${L.agentId} = ${lit(spec.id || truth.id)}`);
      if ((spec.tlId || truth.tlId) && L.tlId) where.push(`${L.tlId} = ${lit(spec.tlId || truth.tlId)}`);
    } else {
      where.push(`${L.agentName} = ${lit(spec.name)}`);
    }
    let t = null;
    try { t = await FF.data.query('Tag Assignment', `select ${cols} where ${where.join(' and ')} order by ${L.cls} limit ${limit}`, { only: true }); }
    catch (err) { t = null; }
    if (!t && id.isTl && !(truth.tlId || spec.tlId || spec.id)) {
      try { t = await FF.data.query('Tag Assignment', `select ${cols} where ${L.tlName} = ${lit(truth.tlName || spec.tl || spec.name)} limit ${limit}`, { only: true }); }
      catch (err) { t = null; }
    }
    if (!t && !id.isTl) {
      try { t = await FF.data.query('Tag Assignment', `select ${cols} where ${L.agentName} = ${lit(spec.name)} limit ${limit}`, { only: true }); }
      catch (err) { t = null; }
    }
    const kindOf = (G() && G().stockStatusKind) || (() => 'other');
    const normClass = (G() && G().normClass) || ((x) => clean(x));
    return ((t && t.rows) || []).map((r) => {
      const status = FF.data.cellText(r[3]);
      return {
        cls: normClass(FF.data.cellText(r[0])), tagId: FF.data.cellText(r[1]), serial: FF.data.cellText(r[2]), barcode: FF.data.cellText(r[2]),
        status, agentId: FF.data.cellText(r[4]), agentName: FF.data.cellText(r[5]), tlId: FF.data.cellText(r[6]), tlName: FF.data.cellText(r[7]), gvUniqueId: FF.data.cellText(r[8]),
        inStock: kindOf(status) !== 'out'
      };
    });
  }

  // ---- mapping / data-check ------------------------------------------------------------------------
  function mapping() {
    const m = (G() && G().mapping) ? G().mapping() : {};
    const raw = (G() && G().mappingWarnings) ? G().mappingWarnings() : [];
    const warnings = raw.map((w) => (typeof w === 'string' ? w : `${(w && w.dataset) || 'sheet'}: ${(w && w.text) || ''}`)).filter(Boolean);
    const labels = (G() && G().labels) || {};
    return {
      datasets: m, warnings,
      tabs: [
        { key: 'master', label: 'GV Master · issuance (final)', labels: labels.master || [] },
        { key: 'assignment', label: 'Tag Assignment · stock (final)', labels: labels.assignment || [] },
        { key: 'report', label: 'GV REPORT · performance (cross-check)', labels: labels.report || [] }
      ],
      checkedAt: Date.now()
    };
  }
  function health() {
    const rows = ledgerRows(), rep = reportRows(), stock = stockAgentRows();
    const statuses = {};
    stock.forEach((r) => Object.entries(r.byStatus || {}).forEach(([k, v]) => { statuses[k] = (statuses[k] || 0) + v; }));
    const m = mapping();
    return {
      loaded: { ledger: rows.length, sheet: rep.length, stockAgents: stock.length, stockTls: stockTlRows().length, stockClasses: stockClassRows().length },
      months: [...new Set(rows.map((r) => r.ym).filter(Boolean))].sort(),
      statuses, warnings: m.warnings, mapping: m.datasets, tabs: m.tabs
    };
  }

  FF.gvTruth = { person, people, team, drill, stockTagRows, mapping, health, index, invalidateIndex, ledgerRows, reportRows, reportRowFor, sheetFor, stockFor, identityOf, monthStat, todayKey };
})(window.FF);