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
  // norm() lakhon baar (har row × har TL) chalta hai — naam hazaaron rows me repeat hote hain, isliye memo (bounded).
  const normMemo = new Map();
  const norm = (s) => {
    const key = typeof s === 'string' ? s : String(s === null || s === undefined ? '' : s);
    const hit = normMemo.get(key);
    if (hit !== undefined) return hit;
    const out = clean(key).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    if (normMemo.size > 60000) normMemo.clear();
    normMemo.set(key, out);
    return out;
  };
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
  // gv.issuanceRows() rebuilds the whole EIR→GV rollup (an object per EIR line plus a person lookup) on every
  // call, and every TL / agent profile asked for it two or three times and then ran rows.filter() per agent.
  // For ~120 GV TLs that was ~15 s of frozen tab. The real adapter publishes the inputs it is computed from
  // (issuanceRows.inputsKey), so reuse the last result while they are unchanged. Everything here only
  // filters/maps the rows (never mutates them). Stubs without a key are called every time, as before.
  const issuanceMemo = { fn: null, key: null, rows: null };
  const sameKey = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
  function adapterIssuanceRows(g) {
    const fn = g.issuanceRows;
    let key = null;
    if (typeof fn.inputsKey === 'function') { try { key = fn.inputsKey(); } catch { key = null; } }
    if (key && issuanceMemo.fn === fn && sameKey(issuanceMemo.key, key)) return issuanceMemo.rows;
    let v;
    try { v = fn.call(g); } catch { return []; }          // a failure is never remembered
    const rows = (v === undefined ? [] : v) || [];
    if (key && Array.isArray(rows)) { issuanceMemo.fn = fn; issuanceMemo.key = key; issuanceMemo.rows = rows; }
    return rows;
  }
  const gvIssuanceRows = () => {
    const g = FF.gv || {};
    if (gvHasRowsAdapterOverride()) return safeCall(() => g.rows(), []) || [];
    if (typeof g.issuanceRows === 'function') return adapterIssuanceRows(g);
    return typeof g.rows === 'function' ? (safeCall(() => g.rows(), []) || []) : [];
  };
  // The real GV adapter's issuanceRows() is EIR-authoritative (with today's live GV Master rows).
  // Older test/host adapters that replace only rows() expose a compatibility snapshot, not exact
  // per-month issuance, so do not let that partial view overwrite GV REPORT summary totals.
  const gvCanonicalIssuanceRows = () => {
    const g = FF.gv || {};
    // Live adapter: issuanceRows() hi EIR-authoritative ledger hai (aaj ke live GV Master rows ke saath).
    // Isse pehle masterRows() ko dekha jaata tha, jiski wajah se GV Master khaali/adhoora hone par
    // TL team + agent ke month totals 0 ho jaate the (EIR me rows hote hue bhi).
    // Compatibility snapshot (sirf rows() replace kiya gaya legacy/host adapter) partial hota hai —
    // usse exact month totals nahi banate, warna GV REPORT ke bhare hue numbers 0/adhoora dikhte hain.
    if (gvHasRowsAdapterOverride()) return [];
    if (typeof g.issuanceRows === 'function') return adapterIssuanceRows(g);
    // Legacy host/test adapters jo sirf masterRows() dete hain — unke liye Master row mapping.
    if (typeof g.masterRows === 'function') {
      return (safeCall(() => g.masterRows(), []) || []).filter((r) => r && r.date).map((r) => ({
        ...r,
        key: U.dateKey(r.date),
        d: r.date,
        n: 1,
        type: /replacement/i.test(`${r.status || ''} ${r.tagType || ''}`) ? 'REPLACEMENT' : 'ISSUANCE',
        vrnType: r.tagType || 'VRN',
        channel: 'GV Partner',
        source: 'GV Master'
      }));
    }
    return [];
  };
  const CLS_ORDER = ['VC4', 'VC20', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16', 'VC5+'];
  const clsRank = (c) => { const i = CLS_ORDER.indexOf(String(c).toUpperCase()); return i < 0 ? 99 : i; };
  const is4 = (c) => /^VC\s*4$/i.test(String(c || '').trim());
  const monthLabel = (ym) => { try { return U.labelYM(ym); } catch { return String(ym || ''); } };
  const num = (v) => Number(v) || 0;
  const ISSUE_GROUPS = ['VC4', 'VC20', 'VC5+'];
  const blankIssueBins = () => ({ VC4: 0, VC20: 0, 'VC5+': 0, total: 0 });
  function issueGroup(row) {
    const cls = clean(row && row.cls).toUpperCase().replace(/\s+/g, '');
    if (cls === 'VC4') return 'VC4';
    if (cls === 'VC20') return 'VC20';
    if (cls === 'VC5+') return 'VC5+';
    const fallback = clean(row && row.group).toUpperCase();
    if (ISSUE_GROUPS.includes(fallback)) return fallback;
    const modelGroup = safeCall(() => FF.model && FF.model.classGroup && FF.model.classGroup(cls), '');
    const gvGroup = safeCall(() => FF.gv && FF.gv.classGroup && FF.gv.classGroup(cls), '');
    return ISSUE_GROUPS.includes(modelGroup) ? modelGroup : ISSUE_GROUPS.includes(gvGroup) ? gvGroup : 'VC5+';
  }
  /** Tag/summary rows → exact 3-way mix. A period is available only when at least one source row exists. */
  function classBinsFromRows(rows, curYm, lastYm) {
    const out = { cur: blankIssueBins(), last: blankIssueBins(), available: { cur: false, last: false } };
    (rows || []).forEach((row) => {
      const slot = row && row.ym === curYm ? 'cur' : row && row.ym === lastYm ? 'last' : '';
      if (!slot) return;
      const group = issueGroup(row);
      const raw = row.n;
      const qty = raw === '' || raw === null || raw === undefined ? 1 : Math.max(0, num(raw));
      out[slot][group] += qty;
      out[slot].total += qty;
      out.available[slot] = true;
    });
    return out;
  }
  /** GV REPORT ki row se period ka sheet-only view (blank cell = null, asli 0 = 0). */
  function sheetBinsOf(row, period) {
    if (!row) return null;
    return safeCall(() => (FF.gv && FF.gv.reportMonthBins ? FF.gv.reportMonthBins(row, period) : null), null);
  }
  /** Sheet ke period totals + ledger ka VC20/VC5+ mix → ek saaf 3-way group table.
   *  VC4 aur total hamesha GV REPORT sheet se (jab sheet me cell bhari ho); VC20/VC5+ ka batwara
   *  tag-ledger (EIR / GV Master) ke mix se hota hai kyunki sheet me sirf VC4 + NVC4 milta hai.
   *  `mix` batata hai ki batwara kahan se aaya — UI wahi note dikhata hai. */
  function sheetFirstGroups(sheetBins, ledgerBins) {
    const out = { VC4: 0, VC20: 0, 'VC5+': 0, total: 0, comm: 0, source: '', mix: '', sheet: null, ledger: null };
    const ledger = ledgerBins ? {
      VC4: num(ledgerBins.VC4), VC20: num(ledgerBins.VC20), 'VC5+': num(ledgerBins['VC5+']), total: num(ledgerBins.total)
    } : null;
    out.ledger = ledger;
    if (!sheetBins) {
      if (!ledger) return out;
      Object.assign(out, { VC4: ledger.VC4, VC20: ledger.VC20, 'VC5+': ledger['VC5+'], total: ledger.total, comm: ledger.VC20 + ledger['VC5+'], source: 'tag ledger', mix: 'ledger' });
      return out;
    }
    // Do shakal aati hain: gv.reportMonthBins → { VC4, VC20, 'VC5+', comm, total } aur TL snapshot
    // (masterProfile.reportedTlSnapshot) → { vc4, comm, total }.
    const rawVc4 = sheetBins.VC4 === null || sheetBins.VC4 === undefined ? sheetBins.vc4 : sheetBins.VC4;
    const vc4 = num(rawVc4);
    const comm = sheetBins.comm === null || sheetBins.comm === undefined ? Math.max(0, num(sheetBins.total) - vc4) : num(sheetBins.comm);
    const total = Math.max(num(sheetBins.total), vc4 + comm);
    Object.assign(out, { VC4: vc4, comm, total, source: 'GV REPORT sheet' });
    out.sheet = { vc4, comm, total };
    if (sheetBins.split && sheetBins.VC20 !== null && sheetBins.VC20 !== undefined) {
      // Current month: sheet khud VC5/VC6/… columns deta hai, isliye batwara bhi sheet ka hai.
      out.VC20 = Math.min(comm, Math.max(0, num(sheetBins.VC20)));
      out['VC5+'] = Math.max(0, comm - out.VC20);
      out.mix = 'sheet';
    } else if (ledger && ledger.VC20 + ledger['VC5+'] > 0) {
      const mixTotal = ledger.VC20 + ledger['VC5+'];
      out.VC20 = Math.min(comm, Math.max(0, Math.round((comm * ledger.VC20) / mixTotal)));
      out['VC5+'] = Math.max(0, comm - out.VC20);
      out.mix = 'ledger-mix';
    } else {
      out.VC20 = 0;
      out['VC5+'] = comm;
      out.mix = 'no-detail';
    }
    return out;
  }
  /** GV TL / agent ke liye ek hi jagah se group bins: sheet (VC4 + NVC4) + ledger ka VC20/VC5+ mix.
   *  `sheetSplit` = sheet ke apne class columns se nikla commercial batwara (TL ke team rows ka jod). */
  function gvGroupBins(reportSnapshots, classBins, stockComposition, sheetSplit) {
    const snaps = reportSnapshots || {};
    const bins = classBins || {};
    const cur = snaps.cur && sheetSplit && sheetSplit.cur ? { ...snaps.cur, ...sheetSplit.cur } : snaps.cur;
    return {
      last: sheetFirstGroups(snaps.last, bins.last),
      cur: sheetFirstGroups(cur, bins.cur),
      stock: groupBinsOf((stockComposition && stockComposition.classRows) || [], 'n')
    };
  }
  /** GV REPORT ke TL snapshot me commercial ka batwara nahi hota (sirf NVC4 total) — team ke class
   *  columns (VC5…VC16, current month) us sheet ke andar hi detail dete hain, isliye wahi use karo. */
  function tlSheetSplit(list, snapshot, period) {
    if (!snapshot || period !== 'cur' || !(list || []).some((r) => r.curClassAvailable)) return null;
    const comm = num(snapshot.comm);
    const detail = Math.min(comm, U.sum(list, (r) => ['VC5', 'VC6', 'VC7', 'VC12', 'VC16'].reduce((n, cls) => n + num(r.curByClass && r.curByClass[cls]), 0)));
    return { split: true, 'VC5+': detail, VC20: Math.max(0, comm - detail) };
  }
  /** class-wise rows → 3-way group bins (`key` = 'n' issuance ke liye, 'stock' stock ke liye). */
  function groupBinsOf(classes, key) {
    const k = key || 'n';
    const out = { VC4: 0, VC20: 0, 'VC5+': 0, total: 0 };
    (classes || []).forEach((row) => {
      const group = issueGroup(row);
      const n = Math.max(0, num(row && row[k]));
      out[group] += n;
      out.total += n;
    });
    return out;
  }
  function reportedTlSnapshot(rows, period) {
    const prefix = period === 'last' ? 'tlLast' : 'tlCur';
    const keys = [`${prefix}Vc4`, `${prefix}Comm`, `${prefix}Total`];
    const candidates = [];
    (rows || []).forEach((row) => {
      const values = keys.map((key) => {
        const raw = row && row[key];
        if (raw === null || raw === undefined || raw === '') return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
      });
      const availableFlag = row && row[period === 'last' ? 'tlLastAvailable' : 'tlCurAvailable'];
      if (!availableFlag && !values.some((value) => value !== null)) return;
      if (!values.some((value) => value !== null)) return;
      const [vc4Raw, commRaw, totalRaw] = values;
      const total = totalRaw !== null ? Math.max(0, totalRaw) : (vc4Raw !== null && commRaw !== null ? Math.max(0, vc4Raw) + Math.max(0, commRaw) : null);
      let vc4 = vc4Raw === null ? null : Math.max(0, vc4Raw);
      let comm = commRaw === null ? null : Math.max(0, commRaw);
      if (vc4 === null && comm !== null && total !== null) vc4 = Math.max(0, total - comm);
      if (comm === null && vc4 !== null && total !== null) comm = Math.max(0, total - vc4);
      candidates.push({ vc4, comm, total, completeness: values.filter((value) => value !== null).length });
    });
    if (!candidates.length) return null;
    // TL totals are repeated on each GV REPORT agent row. Pick the most common complete tuple;
    // never add repeated TL snapshots together. If a refresh leaves mixed rows, prefer the most
    // complete value and then the tuple seen most often.
    const tuples = new Map();
    candidates.forEach((candidate) => {
      const key = `${candidate.vc4}|${candidate.comm}|${candidate.total}`;
      const current = tuples.get(key) || { ...candidate, count: 0 };
      current.count++;
      current.completeness = Math.max(current.completeness, candidate.completeness);
      tuples.set(key, current);
    });
    const picked = [...tuples.values()].sort((a, b) => b.completeness - a.completeness || b.count - a.count)[0];
    return { vc4: picked.vc4, comm: picked.comm, total: picked.total, rows: candidates.length, source: 'GV REPORT' };
  }
  function reportedGvTlSnapshots(rows) {
    return { last: reportedTlSnapshot(rows, 'last'), cur: reportedTlSnapshot(rows, 'cur') };
  }
  function applyReportedTlSnapshot(totals, snapshot, prefix) {
    if (!snapshot) return;
    [['Vc4', 'vc4'], ['Comm', 'comm'], ['Total', 'total']].forEach(([suffix, key]) => {
      if (snapshot[key] !== null && snapshot[key] !== undefined) totals[`${prefix}${suffix}`] = snapshot[key];
    });
  }
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
  /**
   * 📈 Comparable MTD growth — current month ko yesterday tak aur previous month ko
   * usi calendar day tak compare karta hai. Whole previous-month total kabhi compare nahi hota.
   * Example: 7 Oct ko → 1–6 Oct vs 1–6 Sep.
   */
  function comparableMtdGrowth(pr, ch) {
    const channel = /^gv/i.test(String(ch || pr.ch || pr.channel || '')) ? 'gv' : 'ff';
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const curYm = U.ymKey(yesterday);
    const prevYm = U.prevMonthKey(curYm);
    const day = yesterday.getDate();
    const prevLastDay = U.daysInMonth(prevYm);
    const prevCutDay = Math.min(day, prevLastDay);
    const curStart = `${curYm}-01`;
    const curEnd = U.dateKey(yesterday);
    const prevStart = `${prevYm}-01`;
    const prevEndDate = U.fromDateKey(`${prevYm}-${String(prevCutDay).padStart(2, '0')}`);
    const prevEnd = U.dateKey(prevEndDate);
    const rowDateKey = (r) => {
      try {
        if (r && r.key && /^\\d{4}-\\d{1,2}-\\d{1,2}$/.test(String(r.key))) return U.dateKey(U.fromDateKey(String(r.key)));
        const raw = r && (r.date || r.d || r.createdAt);
        const d = raw instanceof Date ? raw : U.parseDate(raw);
        return d && !isNaN(d) ? U.dateKey(d) : '';
      } catch { return ''; }
    };
    let rows = [];
    try {
      if (channel === 'gv') {
        if (/-tl$/i.test(String(pr && pr.kind || ''))) {
          rows = (FF.gv && FF.gv.tlIssuanceRows ? FF.gv.tlIssuanceRows(pr.id || '', pr.name || '') : []) || [];
        } else {
          rows = gvCanonicalIssuanceRows() || [];
        }
      } else {
        rows = rowsOf('daily') || [];
      }
    } catch { rows = []; }
    const tl = /-tl$/i.test(String(pr && pr.kind || ''));
    const wantName = norm(pr && pr.name);
    const wantId = clean(pr && pr.id).replace(/\\.0+$/, '').toUpperCase();
    const belongs = (r) => {
      if (!r) return false;
      if (channel === 'gv') {
        if (tl) {
          const rid = clean(r.tlId || r.gvTlId || r.supervisorId).replace(/\\.0+$/, '').toUpperCase();
          return (wantId && rid && rid === wantId) || (!wantId && wantName && norm(r.tlName) === wantName);
        }
        const rid = clean(r.agentId).replace(/\\.0+$/, '').toUpperCase();
        return (wantId && rid && rid === wantId) || (!wantId && wantName && norm(r.agentName) === wantName);
      }
      if (String(r.channel || '').toLowerCase().includes('gv')) return false;
      if (tl) {
        const rid = clean(r.tlId).replace(/\\.0+$/, '').toUpperCase();
        return (wantId && rid && rid === wantId) || (!wantId && wantName && norm(r.tlName) === wantName);
      }
      const rid = clean(r.agentId || r.id).replace(/\\.0+$/, '').toUpperCase();
      return (wantId && rid && rid === wantId) || (!wantId && wantName && norm(r.agentName || r.name) === wantName);
    };
    let cur = 0, last = 0, curRows = 0, lastRows = 0;
    rows.forEach((r) => {
      if (!belongs(r)) return;
      const k = rowDateKey(r);
      if (!k) return;
      const n = num(r.n !== undefined ? r.n : (r.count !== undefined ? r.count : 1));
      if (k >= curStart && k <= curEnd) { cur += n; curRows++; }
      else if (k >= prevStart && k <= prevEnd) { last += n; lastRows++; }
    });
    // No comparable previous-period data = don't invent 0%/100% growth.
    const growth = last > 0 ? ((cur - last) / last) * 100 : (last === 0 && cur === 0 ? 0 : null);
    return { growth, current: cur, last, curRows, lastRows, day, currentEnd: curEnd, previousEnd: prevEnd, label: U.labelDateKey(curEnd), currentYm: curYm, previousYm: prevYm };
  }

  /** Growth % (sheet ka apna, warna totals se) + month-end projection us channel ke basis par. */
  function growthBlock(o, totals, ym, ch) {
    const b = basis(ch);
    const t = totals || {};
    const comparable = comparableMtdGrowth({ ...t, kind: o.kind || '', name: o.name || '', id: o.id || '', ch }, ch);
    const sheet = pctText(o.growth);
    const g = comparable && comparable.growth !== null ? comparable.growth : (sheet !== null ? sheet : U.growth(num(t.curTotal), num(t.lastTotal)));
    const proj = (k) => U.projectMonthEnd(t[k], b.days, ym);
    const growthText = g === null ? '' : `${g >= 0 ? '▲ +' : '▼ '}${Math.abs(g).toFixed(1)}%`;
    const growthBasis = { ...b, growthThrough: comparable ? comparable.label : '', growthCurrent: comparable ? comparable.current : null, growthLast: comparable ? comparable.last : null };
    return {
      text: growthText,
      num: g, basis: growthBasis, growthThrough: comparable ? comparable.label : '',
      comparableCurrent: comparable ? comparable.current : null,
      comparableLast: comparable ? comparable.last : null,
      cur: num(t.curTotal), last: num(t.lastTotal),
      projected: proj('curTotal'), projectedVc4: proj('curVc4'), projectedComm: proj('curComm'),
      sheetProjected: num(o.projected) || num(o.curProjected) || num(o.tlProjected)
    };
  }
  /** out par growth + month-end projection lagao (agent aur TL, dono channels). */
  function attachGrowth(out, src, ym) {
    const growthSrc = { ...(src || {}), kind: out.kind || '', name: out.name || '', id: out.id || '', ch: out.ch || '' };
    const gi = growthBlock(growthSrc, out.totals, ym, out.ch);
    out.growth = gi.text;
    out.growthNum = gi.num;
    out.projT1 = { num: gi.num, total: gi.projected, vc4: gi.projectedVc4, comm: gi.projectedComm, sheet: gi.sheetProjected, days: gi.basis.days, basis: gi.basis, growthThrough: gi.growthThrough, comparableCurrent: gi.comparableCurrent, comparableLast: gi.comparableLast };
    return gi;
  }

  // ------------------------------------------------------------------ loading
  let warmPromise = null;
  // 🔔 Progressive data: har dataset ke aate hi caches reset + subscribers (master search dropdown / kundli) ko khabar.
  // Pehle sab datasets ke khatam hone ka intezaar hota tha — ek slow GV query poore master search ko "REPORT load ho raha hai…"
  // par roke rakhti thi, jabki REPORT (stock) kab ka aa chuka hota tha.
  const dataListeners = new Set();
  let notifyTimer = 0, loadedOnce = false;
  function onData(fn) { dataListeners.add(fn); return () => dataListeners.delete(fn); }
  function dataArrived() {
    resetProfileCache();
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => dataListeners.forEach((fn) => { try { fn(); } catch { /* listener error */ } }), 60);
  }
  const progress = (fn) => safeAsync(fn).then((v) => { dataArrived(); return v; });
  /** v3.52 — FF REPORT reader (`performance.js`) lazy module hai; agar abhi tak load nahi hua to pehle
   *  use lao, warna FF agent/TL ka stock · priority · suggested dispatch kabhi nahi aata ("REPORT me
   *  row nahi mili" sirf isliye ki module hi nahi tha). Fail ho to chup-chaap aage badho. */
  async function ensurePerfModule() {
    if (perf()) return perf();
    try { if (FF.lazy && FF.lazy.need) await FF.lazy.need('performance'); } catch { /* optional */ }
    return perf();
  }
  async function load() {
    await ensurePerfModule();
    const P = perf();
    const jobs = [];
    if (P && P.ensureLoaded) jobs.push(progress(() => P.ensureLoaded()));
    ['daily', 'agentClass', 'agents', 'stockAgents'].forEach((k) => { if (FF.store && FF.store.need) jobs.push(progress(() => FF.store.need(k))); });
    if (gvOn() && FF.gv && FF.gv.need) ['report', 'stockAgent', 'stockTl', 'stockTlClass', 'stockAgentClass', 'master'].forEach((k) => jobs.push(progress(() => FF.gv.need(k))));
    await Promise.all(jobs);
    loadedOnce = true;
    resetProfileCache();
  }
  /** Summary/profile ke ek channel ko hi ready karo. Pehle FF + GV dono datasets har click par
   *  wait hote the, jabki GV report ko FF stock/performance (aur ulta) ki zaroorat nahi hoti. */
  async function loadFor(person) {
    const isGv = /^gv/i.test(String(person && person.kind || ''));
    const jobs = [];
    if (isGv) {
      if (FF.gv && FF.gv.need) ['report', 'stockAgent', 'stockTl', 'stockTlClass', 'stockAgentClass', 'master'].forEach((k) => jobs.push(progress(() => FF.gv.need(k, { only: true }))));
      // GV Master is the immediate fallback; consume FF EIR rollups only if the app already has them
      // in memory. Do not make a GV summary wait for the unrelated First Forward loader.
    } else {
      const P = await ensurePerfModule();
      if (P && P.ensureLoaded) jobs.push(progress(() => P.ensureLoaded({ light: true })));
      ['daily', 'agentClass', 'agents', 'stockAgents'].forEach((k) => { if (FF.store && FF.store.need) jobs.push(progress(() => FF.store.need(k, { only: true }))); });
    }
    await Promise.all(jobs);
    resetProfileCache();
  }
  function warm() { if (!warmPromise) warmPromise = load().catch(() => {}); return warmPromise; }

  // ------------------------------------------------------------------ lookup helpers
  const quickCache = new Map();
  let ffLookupCache = null, gvLookupCache = null;
  const ffAgents = () => safeCall(() => (perf() && perf().agents ? perf().agents() : []), []) || [];
  const gvReport = () => gvRows('report');
  function pushLookup(map, key, row) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  function buildPeopleLookup(rows, getName, getIds, getTl) {
    const byName = new Map(), byId = new Map(), byTl = new Map();
    rows.forEach((row) => {
      pushLookup(byName, norm(getName(row)), row);
      new Set((getIds(row) || []).map((id) => clean(id).toUpperCase()).filter(Boolean)).forEach((id) => pushLookup(byId, id, row));
      pushLookup(byTl, norm(getTl(row)), row);
    });
    return { rows, byName, byId, byTl };
  }
  function ffPeopleLookup() {
    if (!ffLookupCache) {
      const base = ffAgents();
      const extraAgents = rowsOf('agents') || [];
      const stockOnly = rowsOf('stockAgents') || [];
      // Merge all FF identity sources for lookup only. This does NOT change KPI calculations.
      const merged = [...base, ...extraAgents, ...stockOnly];
      ffLookupCache = buildPeopleLookup(
        merged,
        (a) => a.name || a.agentName,
        (a) => [a.agentId, a.id],
        (a) => a.tlName
      );
    }
    return ffLookupCache;
  }
  function gvPeopleLookup() {
    if (gvLookupCache) return gvLookupCache;
    // GV Master is the identity source: A=UNIQUE_ID (agent ID), C=TL ID, D=TL name.
    // GV REPORT enriches/cross-checks these identities; Tag Assignment enriches stock.
    const master = gvRows('master') || [];
    const report = gvReport() || [];
    const stock = gvRows('stockAgent') || [];
    const byAgentId = new Map(), byName = new Map(), rows = [];
    const normId = (v) => clean(v).replace(/\.0+$/, '').toUpperCase();
    const pushName = (name, row) => {
      const k = norm(name);
      if (!k) return;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(row);
    };
    const sameIdentity = (e, id, nk) => {
      if (!e) return false;
      const haveId = normId(e.agentId);
      const wantId = normId(id);
      if (wantId && haveId) return wantId === haveId;
      return nk && norm(e.agentName) === nk;
    };
    const merge = (raw, source) => {
      const r = { ...(raw || {}) };
      const id = clean(r.agentId || r.id), name = clean(r.agentName || r.name);
      if (!id && !name) return;
      const ik = normId(id), nk = norm(name);
      let e = ik ? byAgentId.get(ik) : null;
      if (!e && nk) {
        const sameName = byName.get(nk) || [];
        e = sameName.find((candidate) => sameIdentity(candidate, id, nk)) || null;
      }
      if (!e) {
        e = { ...r, agentId: id, agentName: name };
        rows.push(e);
        pushName(name, e);
      } else {
        Object.keys(r).forEach((k) => {
          if ((e[k] === undefined || e[k] === null || e[k] === '') && r[k] !== undefined && r[k] !== null && r[k] !== '') e[k] = r[k];
        });
      }
      if (source === 'master') {
        e.agentId = id || e.agentId || '';
        e.agentName = name || e.agentName || '';
        e.supervisorId = clean(r.supervisorId) || e.supervisorId || '';
        e.gvTlId = clean(r.gvTlId) || e.gvTlId || '';
        e.tlId = clean(r.tlId || r.supervisorId || r.gvTlId) || e.tlId || '';
        e.tlName = clean(r.tlName) || e.tlName || '';
      }
      if (ik) byAgentId.set(ik, e);
      // A merged row's name may change from a later source; keep lookup buckets current.
      return e;
    };
    master.forEach((r) => merge(r, 'master'));
    report.forEach((r) => merge(r, 'report'));
    stock.forEach((r) => merge(r, 'stock'));
    rows.forEach((r) => {
      r.tlId = clean(r.tlId || r.supervisorId || r.gvTlId);
      r.tlIds = [...new Set([r.tlId, r.supervisorId, r.gvTlId].map(clean).filter(Boolean))];
    });
    gvLookupCache = {
      rows,
      byName,
      // IMPORTANT: Agent ID lookup is A=UNIQUE_ID only. TL IDs are separate from agent IDs.
      byId: (() => {
        const m = new Map();
        rows.forEach((r) => { const id = normId(r.agentId); if (id) pushLookup(m, id, r); });
        return m;
      })(),
      byTl: (() => {
        const m = new Map();
        rows.forEach((r) => { if (r.tlName) pushLookup(m, norm(r.tlName), r); });
        return m;
      })()
    };
    return gvLookupCache;
  }
  /** Public read-only helper for TL KPI drawers: the GV REPORT carries one repeated TL snapshot per member row. */
  function gvTlSnapshot(name, id) {
    const wantName = norm(name), wantId = clean(id).toUpperCase();
    const rows = gvReport().filter((r) => (wantName && norm(r.tlName) === wantName) || (wantId && clean(r.tlId || r.supervisorId).toUpperCase() === wantId));
    return reportedGvTlSnapshots(rows);
  }
  function resetProfileCache() {
    quickCache.clear();
    tlStockCache.clear();
    stockIdxCache = new WeakMap();
    reportIdxCache = new WeakMap();
    ffLookupCache = null;
    gvLookupCache = null;
  }
  function findFfAgent(name, id) {
    const list = ffPeopleLookup().byName.get(norm(name)) || [];
    if (id) { const wantId = clean(id).toUpperCase(); const byId = list.find((a) => clean(a.agentId || a.id).toUpperCase() === wantId || clean(a.id).toUpperCase() === wantId); if (byId) return byId; }
    return list[0] || null;
  }
  function findGvAgent(name, id) {
    const index = gvPeopleLookup();
    const normWanted = clean(id).replace(/\.0+$/, '').toUpperCase();
    const idRows = normWanted ? index.byId.get(normWanted) : null;
    if (idRows && idRows.length) return idRows[0];
    const same = index.byName.get(norm(name)) || [];
    return same[0] || null;
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

  // TL stock is the TL's own inventory plus their managed agents. REPORT's TL snapshot remains
  // the floor: stock detail can be partial (a valid fixture and a real possibility during a sheet
  // refresh), so never replace the snapshot with the sum of whatever detail rows happen to exist.
  const tlStockCache = new Map();
  const rowAgentId = (r) => clean(r && (r.agentId || r.id)).toUpperCase();
  const rowAgentName = (r) => norm(r && (r.agentName || r.name));
  const rowTlId = (r) => clean(r && (r.tlId || r.supervisorId)).toUpperCase();
  const rowTlName = (r) => norm(r && (r.tlName || r.tl));
  function isSameAgent(row, name, id) {
    const wantId = clean(id).toUpperCase(), haveId = rowAgentId(row);
    if (wantId && haveId && wantId === haveId) return true;
    // A TL's own inventory can have an agent ID distinct from the supervisor/TL ID.
    return !!norm(name) && rowAgentName(row) === norm(name);
  }
  function belongsToTl(row, name, id) {
    const wantName = norm(name), wantId = clean(id).toUpperCase(), haveId = rowTlId(row);
    if (wantId && haveId) return haveId === wantId;
    return !!wantName && rowTlName(row) === wantName;
  }
  function isDirectStockRow(row, ch) {
    return !!(row && (row.directAgent || row.tlExcluded)) || !!safeCall(() => FF.config && FF.config.isDirectAgent && FF.config.isDirectAgent(row, ch), false);
  }
  /** Asli sheets (First Forward REPORT / GV REPORT) me TL ki APNI bhi ek "agent" row hoti hai jab uske
   *  paas stock hota hai. Wo row agents ki list me rehne par (a) "Agents: 3" me TL khud gin jaata hai aur
   *  (b) uska stock — jo aksar poore team ka rollup hota hai — agents ke jod me dobara jud jaata hai.
   *  Isliye TL ki row list se alag karte hain: `team` = agents, `self` = TL ke paas (UI me alag row). */
  function splitTlSelfRow(rows, tlName, tlId) {
    const list = (rows || []).slice();
    const hit = (r) => isSameAgent(r, tlName, tlId);
    const self = list.filter(hit).sort((a, b) => num(a && a.stockTotal) - num(b && b.stockTotal));
    return { team: list.filter((r) => !hit(r)), self: self.length ? self[self.length - 1] : null };
  }
  const classMapTotal = (map) => U.sum([...(map || new Map()).values()], (n) => num(n));
  function classMapParts(map) {
    const parts = { vc4: 0, comm: 0 };
    (map || new Map()).forEach((n, cls) => { if (is4(cls)) parts.vc4 += num(n); else parts.comm += num(n); });
    return parts;
  }
  function addClassRows(map, rows) {
    (rows || []).forEach((r) => {
      const n = Math.max(0, num(r && r.n));
      if (!n) return;
      const cls = clean(r.cls) || 'Commercial';
      map.set(cls, (map.get(cls) || 0) + n);
    });
    return map;
  }
  function fillClassMap(map, target) {
    const parts = classMapParts(map);
    const vc4 = Math.max(parts.vc4, num(target && target.vc4));
    let comm = Math.max(parts.comm, num(target && target.comm));
    comm += Math.max(0, num(target && target.total) - vc4 - comm);
    if (vc4 > parts.vc4) map.set('VC4', (map.get('VC4') || 0) + vc4 - parts.vc4);
    if (comm > parts.comm) map.set('Commercial', (map.get('Commercial') || 0) + comm - parts.comm);
    return map;
  }
  /** Sirf wo rows jinme sach me class ka column hai. GV ka 'stockAgent' aggregate (agent × TL) class-less
   *  hota hai — use class map bana kar sab 'Commercial' me daal dena hi ek inflation ka root tha. */
  function classRowsOnly(rows) { return (rows || []).filter((r) => !!clean(r && r.cls)); }
  /** {VC4: a.vc4 − b.vc4, Commercial: a.comm − b.comm} — sheet ke snapshot se TL ka own split nikaalne ke liye. */
  function classDiff(a, b) {
    const map = new Map();
    const vc4 = Math.max(0, num(a && a.vc4) - num(b && b.vc4));
    const comm = Math.max(0, num(a && a.comm) - num(b && b.comm));
    if (vc4 > 0) map.set('VC4', vc4);
    if (comm > 0) map.set('Commercial', comm);
    return map;
  }
  /** Ek class map ko `total` par laao — group (VC4 / Commercial) ke anupat se scale, kabhi UPAR jod kar nahi.
   *  `parts` ho to (report ka apna VC4 / Comm split) wahi split follow hota hai. Total se kam bacha ho to
   *  Commercial me, zyada ho to anupat ghat jaata hai — isse "own + agents" kabhi total se bada nahi hota. */
  function fitClassMap(map, total, parts) {
    const want = Math.max(0, Math.round(num(total)));
    const out = new Map();
    (map || new Map()).forEach((n, cls) => { const v = Math.max(0, Math.round(num(n))); if (v > 0) out.set(clean(cls) || 'Commercial', v); });
    if (!want) return out;
    if (!out.size) {
      const pv = Math.max(0, num(parts && parts.vc4)), pc = Math.max(0, num(parts && parts.comm));
      if (pv + pc > 0) { const vc4 = Math.min(want, Math.round((pv / (pv + pc)) * want)); out.set('VC4', vc4); if (want - vc4 > 0) out.set('Commercial', want - vc4); }
      else out.set('Commercial', want);
      return out;
    }
    const have = classMapTotal(out);
    if (have === want) return out;
    const pv = Math.max(0, num(parts && parts.vc4)), pc = Math.max(0, num(parts && parts.comm));
    const wantVc4 = pv + pc > 0 ? Math.min(want, Math.round((pv / (pv + pc)) * want))
      : Math.round((U.sum([...out.keys()].filter(is4), (k) => num(out.get(k))) / have) * want);
    const groups = { vc4: [...out.keys()].filter((c) => is4(c)), comm: [...out.keys()].filter((c) => !is4(c)) };
    const fixed = new Map();
    let acc = 0;
    Object.entries(groups).forEach(([g, keys], gi) => {
      const wantG = gi === 0 ? wantVc4 : want - acc;
      if (!keys.length) { if (wantG > 0) fixed.set(g === 'vc4' ? 'VC4' : 'Commercial', wantG); acc += wantG; return; }
      const haveG = U.sum(keys, (k) => num(out.get(k)));
      const sorted = keys.slice().sort((a, b) => num(out.get(b)) - num(out.get(a)));
      sorted.forEach((k, i) => {
        const v = haveG <= 0 ? 0 : (i === sorted.length - 1 ? Math.max(0, wantG - U.sum(sorted.slice(0, i), (x) => Math.round((num(out.get(x)) / haveG) * wantG))) : Math.round((num(out.get(k)) / haveG) * wantG));
        if (v > 0) fixed.set(k, v);
      });
      acc += wantG;
    });
    return fixed;
  }
  /** Class rows ko TL total ke VC4 / Commercial totals par laao (table ka jod == KPI card). */
  function alignClassMap(map, target) {
    const want = { vc4: Math.max(0, Math.round(num(target && target.vc4))), comm: Math.max(0, Math.round(num(target && target.comm))) };
    ['vc4', 'comm'].forEach((g) => {
      const keys = [...map.keys()].filter((cls) => (g === 'vc4' ? is4(cls) : !is4(cls)));
      const haveG = U.sum(keys, (k) => num(map.get(k)));
      if (!keys.length) { if (want[g] > 0) map.set(g === 'vc4' ? 'VC4' : 'Commercial', want[g]); return; }
      if (haveG === want[g]) return;
      if (want[g] <= 0) { keys.forEach((k) => map.delete(k)); return; }
      const sorted = keys.slice().sort((a, b) => num(map.get(b)) - num(map.get(a)));
      let acc = 0;
      sorted.forEach((k, i) => {
        const v = i === sorted.length - 1 ? Math.max(0, want[g] - acc) : Math.round((num(map.get(k)) / haveG) * want[g]);
        map.set(k, v); acc += v;
      });
    });
    [...map.entries()].forEach(([k, v]) => { if (!(num(v) > 0)) map.delete(k); });
    return map;
  }
  function reportStockParts(row, ch) {
    const vc4 = num(row && row.stockVc4);
    const comm = num(row && (ch === 'ff' ? (row.stockNvc4 ?? row.stockComm) : (row.stockComm ?? row.stockNvc4)));
    return { vc4, comm, total: Math.max(num(row && row.stockTotal), vc4 + comm) };
  }
  function reportClassMap(row, ch) {
    const map = new Map();
    if (ch === 'gv' && row && row.stockByClass && typeof row.stockByClass === 'object') {
      Object.entries(row.stockByClass).forEach(([cls, n]) => { if (num(n) > 0) map.set(clean(cls) || 'Commercial', num(n)); });
    }
    return fillClassMap(map, reportStockParts(row, ch));
  }
  function snapshotStockParts(row, ch) {
    const vc4 = num(row && row.tlStockVc4);
    let comm = num(row && (ch === 'ff' ? (row.tlStockNvc4 ?? row.tlStockComm) : (row.tlStockComm ?? row.tlStockNvc4)));
    const total = Math.max(num(row && row.tlStockTotal), vc4 + comm);
    if (vc4 + comm < total) comm += total - vc4 - comm;
    return { vc4, comm, total };
  }
  function stockRowsTotal(rows) { return U.sum(rows || [], (r) => Math.max(0, num(r && r.n))); }
  function uniqueReportRows(rows, ch) {
    const byPerson = new Map();
    (rows || []).forEach((row) => {
      const id = rowAgentId(row), name = rowAgentName(row);
      const key = id ? `id:${id}` : name ? `name:${name}` : '';
      if (!key) return;
      const old = byPerson.get(key);
      if (!old || reportStockParts(row, ch).total > reportStockParts(old, ch).total) byPerson.set(key, row);
    });
    return [...byPerson.values()];
  }
  // 🚀 Per-TL composition pehle har baar POORI agents + stock list ko 4-5 baar filter karti thi (TL × rows = quadratic) —
  // Agent/TL Summary list me har TL ke liye ye chalta tha (120 TL × ~10k rows ≈ 3 s; 300 TL par ~15 s → page "load hi nahi hota").
  // Ab rows ek baar index hoti hain (TL naam / ID, agent naam / ID) aur har TL sirf apni rows dekhta hai; order same rehta hai.
  let stockIdxCache = new WeakMap();   // rows array → index (resetProfileCache par naya — data reload ke baad stale na rahe)
  function stockIndex(rows) {
    if (!Array.isArray(rows)) return null;
    const hit = stockIdxCache.get(rows);
    if (hit && hit.n === rows.length) return hit;
    const idx = { n: rows.length, byTlName: new Map(), byTlId: new Map(), byAgentId: new Map(), byAgentName: new Map() };
    const put = (map, key, entry) => { if (!key) return; const list = map.get(key); if (list) list.push(entry); else map.set(key, [entry]); };
    rows.forEach((row, i) => {
      const entry = { row, i };
      put(idx.byTlName, rowTlName(row), entry); put(idx.byTlId, rowTlId(row), entry);
      put(idx.byAgentId, rowAgentId(row), entry); put(idx.byAgentName, rowAgentName(row), entry);
    });
    stockIdxCache.set(rows, idx);
    return idx;
  }
  /** Lookups ki rows ka union — original list ke order me (filter jaisa). */
  function pickIndexed(lookups) {
    const seen = new Set(), picked = [];
    lookups.forEach(([map, key]) => { if (key) (map.get(key) || []).forEach((e) => { if (!seen.has(e.i)) { seen.add(e.i); picked.push(e); } }); });
    return picked.sort((a, b) => a.i - b.i).map((e) => e.row);
  }
  let reportIdxCache = new WeakMap();   // rows array → { ch → { list, idx } }
  function reportIndex(rows, ch) {
    if (!Array.isArray(rows)) return { list: uniqueReportRows(rows, ch), idx: stockIndex([]) };
    let byCh = reportIdxCache.get(rows);
    if (!byCh || byCh.n !== rows.length) { byCh = { n: rows.length }; reportIdxCache.set(rows, byCh); }
    if (!byCh[ch]) { const list = uniqueReportRows(rows, ch); byCh[ch] = { list, idx: stockIndex(list) }; }
    return byCh[ch];
  }
  function tlStockComposition(ch, name, id, reportRows, detailRows, classRows) {
    const cacheKey = `${ch}|${norm(name)}|${clean(id).toUpperCase()}`;
    if (tlStockCache.has(cacheKey)) return tlStockCache.get(cacheKey);
    const wantName = norm(name), wantId = clean(id).toUpperCase();
    const rep = reportIndex(reportRows, ch);
    const selfReports = pickIndexed([[rep.idx.byAgentId, wantId], [rep.idx.byAgentName, wantName]])
      .filter((r) => belongsToTl(r, name, id) && isSameAgent(r, name, id));
    const teamReports = pickIndexed([[rep.idx.byTlName, wantName], [rep.idx.byTlId, wantId]])
      .filter((r) => belongsToTl(r, name, id) && (isSameAgent(r, name, id) || !isDirectStockRow(r, ch)));
    const memberReports = teamReports.filter((r) => !isSameAgent(r, name, id));
    const memberReportMap = new Map();
    const memberReportParts = { vc4: 0, comm: 0, total: 0 };
    memberReports.forEach((r) => {
      const p = reportStockParts(r, ch);
      memberReportParts.vc4 += p.vc4; memberReportParts.comm += p.comm; memberReportParts.total += p.total;
      const classes = reportClassMap(r, ch);
      classes.forEach((n, cls) => memberReportMap.set(cls, (memberReportMap.get(cls) || 0) + n));
    });
    fillClassMap(memberReportMap, memberReportParts);

    const detailList = detailRows || [];
    const didx = stockIndex(detailList);
    const selfDetails = (didx ? pickIndexed([[didx.byAgentId, wantId], [didx.byAgentName, wantName]]) : detailList)
      .filter((r) => belongsToTl(r, name, id) && isSameAgent(r, name, id));
    const memberDetails = (didx ? pickIndexed([[didx.byTlName, wantName], [didx.byTlId, wantId]]) : detailList)
      .filter((r) => belongsToTl(r, name, id) && !isSameAgent(r, name, id) && !isDirectStockRow(r, ch));
    const detailMemberTotal = stockRowsTotal(memberDetails);
    const classList = classRows || [];
    const classRowsForHolders = (holders) => {
      const out = [], seen = new Set();
      for (const holder of holders || []) {
        const holderId = rowAgentId(holder), holderName = rowAgentName(holder);
        let matches = holderId ? classList.filter((r) => rowAgentId(r) === holderId) : [];
        if (!holderId && holderName) matches = classList.filter((r) => rowAgentName(r) === holderName);
        matches.filter((r) => belongsToTl(r, name, id)).forEach((r) => { if (!seen.has(r)) { seen.add(r); out.push(r); } });
      }
      return out;
    };
    const detailMemberClassRows = ch === 'gv' ? classRowsForHolders([...memberReports, ...memberDetails]) : memberDetails;
    const detailOwnClassRows = ch === 'gv' ? classRowsForHolders([...selfReports, ...selfDetails]) : selfDetails;
    const detailMemberMap = addClassRows(new Map(), classRowsOnly(detailMemberClassRows));
    const detailOwnMap = addClassRows(new Map(), classRowsOnly(detailOwnClassRows));
    const detailOwnTotal = stockRowsTotal(selfDetails) || classMapTotal(detailOwnMap);
    const reportOwn = selfReports.sort((a, b) => reportStockParts(b, ch).total - reportStockParts(a, ch).total)[0] || null;
    const reportOwnParts = reportStockParts(reportOwn, ch);
    const reportOwnMap = reportOwn ? reportClassMap(reportOwn, ch) : new Map();
    const withinOne = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= 1;
    const detailComplete = memberReports.length
      ? withinOne(detailMemberTotal, memberReportParts.total)
      : memberDetails.length > 0;
    const detailClassComplete = classMapTotal(detailMemberMap) > 0 && withinOne(classMapTotal(detailMemberMap), detailMemberTotal);
    const useDetailMembers = (detailComplete && (detailClassComplete || (ch === 'ff' && !detailMemberTotal)))
      || (!memberReports.length && memberDetails.length > 0);
    const memberMap = useDetailMembers && classMapTotal(detailMemberMap) ? detailMemberMap : memberReportMap;
    const memberParts = classMapParts(memberMap);
    const detailMemberParts = classMapParts(detailMemberMap);
    // Agents (team) ka jod: class map / report / detail — jo bhi zyada bhara ho, taaki ek source ke
    // adhoora rehne par team stock na gire. TL ki APNI row isme nahi (wo `own` me aati hai).
    const teamFloor = {
      vc4: Math.max(memberParts.vc4, detailMemberParts.vc4, memberReportParts.vc4),
      comm: Math.max(memberParts.comm, detailMemberParts.comm, memberReportParts.comm)
    };
    teamFloor.total = teamFloor.vc4 + teamFloor.comm;

    // ───────────── TL ka OWN stock: ek hi baar judta hai (double count fix) ─────────────
    // Pehle TL ki REPORT row ("TL ka stock") ko agents ke jod me ALAG se add kar diya jaata tha — par
    // asli sheets me wo row aksar POORE TEAM ka rollup hoti hai (First Forward: 'TL's Stock Details',
    // GV Partner: 'Stock' sheet). Natija: TL ka stock do baar (own 120 + agents 80 = 200, asal 120).
    // GV me class-less 'Stock Agent' rows sab 'Commercial' me girte aur upar se report ka VC4 ADD ho
    // jaata (100 → 120). Ab own ka number priority se chunta hai aur kabhi team ke upar ADD nahi karta:
    //   1) stock detail me TL ki APNI rows (class-wise — sabse trusted),
    //   2) REPORT ki self row — par sirf tab jab wo team ke rollup jaisi na lage,
    //   3) sheet ka "TL's stock" snapshot − agents ka jod.
    const snapshotRows = teamReports.map((r) => snapshotStockParts(r, ch)).sort((a, b) => b.total - a.total);
    const snapshot = snapshotRows[0] || { vc4: 0, comm: 0, total: 0 };
    const snapshotTotal = snapshot.total || (snapshot.vc4 + snapshot.comm);
    const rollupOwnRow = !!reportOwn && teamFloor.total > 0 && reportOwnParts.total >= teamFloor.total - 1;
    let ownTotal = detailOwnTotal || 0;
    let ownFrom = ownTotal > 0 ? 'detail' : '';
    let ownMap = ownTotal > 0 ? new Map(detailOwnMap) : new Map();
    if (!ownTotal && reportOwn) {
      if (rollupOwnRow) {
        ownTotal = Math.max(0, snapshotTotal - teamFloor.total);
        ownFrom = 'snapshot-team';
        ownMap = classDiff(snapshot, teamFloor);
      } else {
        ownTotal = reportOwnParts.total || classMapTotal(reportOwnMap);
        ownFrom = 'report';
        ownMap = classMapTotal(reportOwnMap) > 0 ? new Map(reportOwnMap) : new Map();
      }
    }
    if (!ownTotal && snapshotTotal > teamFloor.total) {
      ownTotal = snapshotTotal - teamFloor.total;
      ownFrom = 'snapshot-team';
      ownMap = classDiff(snapshot, teamFloor);
    }
    ownMap = fitClassMap(ownMap, ownTotal, ownFrom === 'report' ? reportOwnParts : null);
    const ownParts = classMapParts(ownMap);
    ownTotal = ownParts.vc4 + ownParts.comm;

    const teamStock = { vc4: teamFloor.vc4, comm: teamFloor.comm, total: teamFloor.total };
    // Sheet ka total detail/report se bada ho (rows abhi load me / adhoore) to shortfall TEAM me jaayega,
    // OWN me nahi — warna TL ka stock dobara jud jaata hai.
    const counted = teamStock.total + ownTotal;
    const short = Math.max(0, snapshotTotal - counted);
    if (short > 0) { teamStock.comm += short; teamStock.total += short; }
    const stock = { vc4: teamStock.vc4 + ownParts.vc4, comm: teamStock.comm + ownParts.comm };
    stock.total = stock.vc4 + stock.comm;
    const classMap = new Map(memberMap);
    ownMap.forEach((n, cls) => classMap.set(cls, (classMap.get(cls) || 0) + n));
    alignClassMap(classMap, stock);
    let result = {
      stock, own: { ...ownParts, total: ownTotal }, agents: teamStock,
      classRows: [...classMap.entries()].sort((a, b) => num(b[1]) - num(a[1])).map(([cls, n]) => ({ cls, n })),
      // Diagnostics — UI ko "kaise joda gaya" dikhaane ke liye; data sources ka bharosa bhi yahi se pata chalta hai
      ownFrom, rollupOwnRow: !!rollupOwnRow, snapshot: { ...snapshot, total: snapshotTotal },
      membersFrom: useDetailMembers && classMapTotal(detailMemberMap) ? 'detail' : 'report',
      raw: { detailOwnTotal, reportOwnTotal: reportOwnParts.total, detailMemberTotal, memberReportTotal: memberReportParts.total }
    };
    if (ch === 'gv' && FF.gvTruth && FF.gvTruth.stockFor) {
      const exact = safeCall(() => FF.gvTruth.stockFor({ kind: 'gv-tl', name, id }), null);
      if (exact && exact.authoritative) {
        const exactTotal = num(exact.total), exactOwn = num(exact.own);
        result = {
          ...result,
          stock: { vc4: num(exact.vc4), comm: num(exact.comm), total: exactTotal },
          own: { ...(exact.ownParts || {}), total: exactOwn },
          agents: { ...(exact.agents || {}), total: num(exact.agentsTotal) },
          classRows: (exact.byClass || []).map((r) => ({ cls: r.cls, n: num(r.n) })).filter((r) => r.n > 0),
          ownFrom: 'Tag Assignment', membersFrom: 'Tag Assignment',
          raw: { ...result.raw, tagAssignmentTotal: exactTotal, tagAssignmentOwn: exactOwn, tagAssignmentAgents: num(exact.agentsTotal) }
        };
      }
    }
    tlStockCache.set(cacheKey, result);
    return result;
  }
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
  /** GV REPORT sheet ke period numbers seedhe totals me (sheet-first). Returns true jab lagaye gaye. */
  function applySheetMonth(totals, prefix, bins) {
    if (!bins || !totals) return false;
    const vc4 = num(bins.VC4);
    const comm = bins.comm === null || bins.comm === undefined ? Math.max(0, num(bins.total) - vc4) : num(bins.comm);
    const total = Math.max(num(bins.total), vc4 + comm);
    Object.assign(totals, { [`${prefix}Vc4`]: vc4, [`${prefix}Comm`]: comm, [`${prefix}Total`]: total });
    return true;
  }
  const sameGvAgent = (row, agent) => {
    const rowId = clean(row && (row.agentId || row.id)).toUpperCase();
    const agentId = clean(agent && (agent.agentId || agent.id)).toUpperCase();
    if (rowId && agentId) return rowId === agentId;
    return norm(row && (row.agentName || row.name)) === norm(agent && (agent.agentName || agent.name));
  };
  // Row lookups that return exactly what rows.filter(<predicate>) did — same rows, same sheet order — without
  // testing every row against every agent (rows × agents per TL, i.e. quadratic on a real-size sheet).
  // The index is built once per rows array; positions are marked in a bitmap so the order is the sheet's own.
  const addPos = (map, key, i) => { const l = map.get(key); if (l) l.push(i); else map.set(key, [i]); };
  function pickRows(rows, lists) {
    if (!lists.some(Boolean)) return [];
    const mark = new Uint8Array(rows.length);
    for (const l of lists) if (l) for (let k = 0; k < l.length; k++) mark[l[k]] = 1;
    const out = [];
    for (let i = 0; i < mark.length; i++) if (mark[i]) out.push(rows[i]);
    return out;
  }
  const gvTeamIdxCache = new WeakMap(), gvAgentIdxCache = new WeakMap();
  const sameGvKeys = (x) => ({
    id: clean(x && (x.agentId || x.id)).toUpperCase(),
    name: norm(x && (x.agentName || x.name))
  });
  /** == rows.filter((m) => agents.some((a) => sameGvAgent(m, a))) */
  function gvTeamRows(rows, agents) {
    if (!rows.length || !agents.length) return [];
    let idx = gvTeamIdxCache.get(rows);
    if (!idx || idx.n !== rows.length) {
      const byId = new Map(), byName = new Map(), byNameNoId = new Map();
      for (let i = 0; i < rows.length; i++) {
        const k = sameGvKeys(rows[i]);
        if (k.id) addPos(byId, k.id, i); else addPos(byNameNoId, k.name, i);   // sameGvAgent: ids decide only when both exist
        addPos(byName, k.name, i);
      }
      idx = { n: rows.length, byId, byName, byNameNoId };
      gvTeamIdxCache.set(rows, idx);
    }
    const lists = [];
    for (const a of agents) {
      const k = sameGvKeys(a);
      if (k.id) lists.push(idx.byId.get(k.id), idx.byNameNoId.get(k.name));   // row id must equal; id-less rows fall back to the name
      else lists.push(idx.byName.get(k.name));                                 // agent without id: name against every row
    }
    return pickRows(rows, lists);
  }
  /** == rows.filter((m) => norm(m.agentName) === nameKey || (id && m.agentId === id)) */
  function gvAgentRows(rows, nameKey, id) {
    if (!rows.length) return [];
    let idx = gvAgentIdxCache.get(rows);
    if (!idx || idx.n !== rows.length) {
      const byName = new Map(), byId = new Map();
      for (let i = 0; i < rows.length; i++) {
        addPos(byName, norm(rows[i].agentName), i);
        if (rows[i].agentId) addPos(byId, rows[i].agentId, i);
      }
      idx = { n: rows.length, byName, byId };
      gvAgentIdxCache.set(rows, idx);
    }
    return pickRows(rows, [idx.byName.get(nameKey), id ? idx.byId.get(id) : undefined]);
  }
  function applyExactGvAgentMonths(agentRows, issuanceRows, curYm, lastYm, preferLedger = false) {
    const curExists = !!exactGvMonth(issuanceRows, curYm);
    const lastExists = !!exactGvMonth(issuanceRows, lastYm);
    if (!preferLedger && !curExists && !lastExists) return;
    agentRows.forEach((agent) => {
      const issued = issuanceRows.filter((r) => sameGvAgent(r, agent));
      // GV TL profile me GV Master ka GV TL ID (R) exact source hai; us source ke available
      // period totals member ke REPORT snapshots ko bhi replace karte hain, warna row/drill alag honge.
      // Other GV views me existing sheet-first rule barkarar: filled REPORT cells win.
      if (curExists && (preferLedger || agent.curAvailable !== true)) {
        const x = exactGvMonth(issued, curYm) || { vc4: 0, comm: 0, total: 0 };
        Object.assign(agent, { curVc4: x.vc4, curComm: x.comm, curTotal: x.total });
      }
      if (lastExists && (preferLedger || agent.lastAvailable !== true)) {
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
  // Har TL / agent profile par poori agentClass list (10-20k rows) scan hoti thi — array identity par memo.
  const ymMemo = new WeakMap();
  const latestYm = (rows) => {
    const hit = rows && typeof rows === 'object' ? ymMemo.get(rows) : null;
    if (hit && hit.n === rows.length) return hit.v;
    const found = monthsFrom(rows, 'ym').pop();
    if (found && rows && typeof rows === 'object') ymMemo.set(rows, { n: rows.length, v: found });
    return found || U.ymKey(new Date());
  };

  // ------------------------------------------------------------------ profile builders
  function exactHolderMatch(row, name, id) {
    const wantId = clean(id).toUpperCase(), haveId = rowAgentId(row);
    if (wantId && haveId) return wantId === haveId;
    return !!norm(name) && rowAgentName(row) === norm(name);
  }
  function rowBelongsToHolderTl(row, src) {
    const wantId = rowTlId(src), haveId = rowTlId(row);
    if (wantId && haveId) return wantId === haveId;
    const wantName = rowTlName(src), haveName = rowTlName(row);
    return !!wantName && (!haveName || haveName === wantName);
  }
  /** Ek agent ka class-wise stock: pehle ID/TL-matched Tag Assignment rows, warna REPORT class split. */
  function agentClassStock(src, detailRows, ch) {
    const name = src.agentName || src.name, id = src.agentId || src.id;
    const idx = stockIndex(detailRows);
    const mine = idx ? pickIndexed([[idx.byAgentId, clean(id).toUpperCase()], [idx.byAgentName, norm(name)]])
      .filter((r) => exactHolderMatch(r, name, id) && rowBelongsToHolderTl(r, src) && clean(r.cls)) : [];
    const map = mine.length ? addClassRows(new Map(), mine) : reportClassMap(src, ch);
    return Object.fromEntries([...map.entries()].filter(([, n]) => num(n) > 0));
  }
  /** TL ki apni row ka class-wise stock — ID/TL match pehle, REPORT fallback doosre. */
  function selfClassStock(src, detailRows, ch, comp) {
    const name = src.agentName || src.name, id = src.agentId || src.id;
    const idx = stockIndex(detailRows);
    const mine = idx ? pickIndexed([[idx.byAgentId, clean(id).toUpperCase()], [idx.byAgentName, norm(name)]])
      .filter((r) => exactHolderMatch(r, name, id) && rowBelongsToHolderTl(r, src) && clean(r.cls)) : [];
    if (mine.length) return Object.fromEntries(addClassRows(new Map(), mine));
    const own = (comp && (comp.ownParts || comp.own)) || { vc4: 0, comm: 0 };
    const out = {};
    if (num(own.vc4) > 0) out.VC4 = num(own.vc4);
    if (num(own.comm) > 0) out.Commercial = num(own.comm);
    return out;
  }
  function ffAgentProfile(p, light) {
    const a = findFfAgent(p.name, p.sub);
    const P = perf();
        const out = { kind: 'ff-agent', channel: 'First Forward', ch: 'ff', name: p.name, id: (a && (a.agentId || a.id)) || p.sub || '', found: !!a };
    const ac = rowsOf('agentClass'), agRows = rowsOf('agents'), stk = rowsOf('stockAgents');
    const n = norm(p.name);
    const curYm = latestYm(ac.length ? ac : agRows), lastYm = U.prevMonthKey(curYm);
    const personId = clean(p.sub).replace(/\.0+$/, '').toUpperCase();
    const rowAgentId = (r) => clean(r.agentId || r.id).replace(/\.0+$/, '').toUpperCase();
    const isMine = (r) => {
      if (r.channel && !/first/i.test(r.channel)) return false;
      if (personId) return rowAgentId(r) === personId;
      return norm(r.name) === n;
    };
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
    out.months = { cur: curYm, last: lastYm };
    out.classBins = classBinsFromRows(ac.filter(isMine), curYm, lastYm);
    out.issuanceSources = { cur: 'First Forward EIR', last: 'First Forward EIR', classes: 'First Forward EIR' };
    attachGrowth(out, a || {}, curYm);
    if (a && !out.direct && a.tlName && (!FF.config.isRealTl || FF.config.isRealTl(a.tlName))) {
      const teamStock = tlStockComposition('ff', a.tlName, a.tlId, ffPeopleLookup().rows, stk, stk);
      out.tlStock = { ...teamStock.stock, has: true, own: teamStock.own, agents: teamStock.agents };
    }
    if (light) return out;
    out.classes = classTable(ac.filter(isMine), stk.filter((r) => {
      if (personId) return rowAgentId(r) === personId;
      return norm(r.agentName) === n;
    }), curYm, lastYm);
    out.classBins = classBinsFromRows(ac.filter(isMine), curYm, lastYm);
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
    const ffRows = ffPeopleLookup();
    const allAgents = ffRows.rows;
    const nameRows = ffRows.byTl.get(n) || [];
    const requestedTlId = clean(p.sub || p.id).toUpperCase();
    const exactTlRows = requestedTlId ? nameRows.filter((a) => clean(a.tlId).toUpperCase() === requestedTlId) : [];
    const idTlRows = requestedTlId ? ffRows.rows.filter((a) => clean(a.tlId).toUpperCase() === requestedTlId) : [];
    const knownTlIds = new Set(nameRows.map((a) => clean(a.tlId).toUpperCase()).filter(Boolean));
    const scopedTlRows = exactTlRows.length ? exactTlRows : idTlRows.length ? idTlRows : requestedTlId && knownTlIds.size > 1 ? [] : nameRows;
    const underTl = scopedTlRows.filter((a) => !a.tlExcluded);
    const src = underTl.find((a) => a.tlStockTotal != null) || underTl[0] || null;
    const tlId = (src && src.tlId) || requestedTlId || '';
    // TL ki apni row (sheet me 'Agent name' = TL) agents se alag — count/jod me double count na ho
    const selfSplit = splitTlSelfRow(underTl, p.name, tlId);
    const agents = selfSplit.team, selfRow = selfSplit.self;
    const P = perf();
    const sumK = (k) => U.sum(underTl, (a) => num(a[k]));
    const avgVc4 = U.runRate(sumK('curVc4'), 'ff'), avgComm = U.runRate(sumK('curNvc4'), 'ff');
    const stockDetails = rowsOf('stockAgents');
    const stockComposition = tlStockComposition('ff', p.name, tlId, allAgents, stockDetails, stockDetails);
    const stock = stockComposition.stock;
    const agentRow = (a, isSelf) => {
      const av = U.runRate(a.curVc4, 'ff'), avc = U.runRate(a.curNvc4, 'ff');
      return { name: a.name, id: a.agentId || a.id, tlId: a.tlId || tlId, tlName: a.tlName || p.name, mobile: mobileFor(a.name, a.agentId || a.id, a.mobile), priority: a.priority || '', status: a.agentStatus || '', lastActive: a.lastActive || '', isSelf: !!isSelf, stockVc4: num(a.stockVc4), stockComm: num(a.stockNvc4), stockTotal: num(a.stockTotal), cur: num(a.curTotal), last: num(a.lastTotal), curVc4: num(a.curVc4), curComm: num(a.curNvc4), lastVc4: num(a.lastVc4), lastComm: num(a.lastNvc4), sugVc4: suggest(av, a.stockVc4), sugComm: suggest(avc, a.stockNvc4), sugVc4Gross: suggestGro(av), sugCommGross: suggestGro(avc) };
    };
    const ffStockByHolder = new Map(), ffStockByName = new Map();
    const stockHolderKey = (a) => clean(a.agentId || a.id) ? `#${clean(a.agentId || a.id).toUpperCase()}` : `n:${norm(a.agentName || a.name)}`;
    stockDetails.filter((r) => {
      const ownerId = clean(r.tlId).toUpperCase();
      if (tlId) return !!ownerId && ownerId === clean(tlId).toUpperCase();
      return norm(r.tlName) === n;
    }).filter((r) => !safeCall(() => FF.config.isDirectAgent(r, 'ff'), false)).forEach((r) => {
      if (selfRow && isSameAgent(r, selfRow.name, selfRow.agentId || selfRow.id)) return;
      const key = stockHolderKey(r), holder = ffStockByHolder.get(key) || { ...r, n: 0, classStock: {} };
      holder.n += num(r.n);
      holder.classStock[r.cls] = (holder.classStock[r.cls] || 0) + num(r.n);
      ffStockByHolder.set(key, holder);
      if (norm(r.agentName)) ffStockByName.set(norm(r.agentName), holder);
    });
    const matchedHolders = new Set();
    const rowsA = agents.map((a) => {
      const holder = (a.agentId || a.id) && ffStockByHolder.get(`#${clean(a.agentId || a.id).toUpperCase()}`) || ffStockByName.get(norm(a.name));
      if (holder) matchedHolders.add(stockHolderKey(holder));
      const out = agentRow(holder ? { ...a, stockTotal: holder.n } : a, false);
      out.classStock = agentClassStock(a, stockDetails, 'ff');
      if (holder || Object.keys(out.classStock || {}).length) {
        const classes = Object.entries(out.classStock || {});
        out.stockTotal = holder ? holder.n : U.sum(classes.map(([, value]) => ({ n: value })), (x) => x.n);
        out.stockVc4 = num(classes.find(([cls]) => /^VC4$/i.test(cls))?.[1]);
        out.stockComm = Math.max(0, out.stockTotal - out.stockVc4);
      }
      return out;
    });
    ffStockByHolder.forEach((holder, key) => {
      if (matchedHolders.has(key)) return;
      const base = { ...holder, name: holder.agentName, agentId: holder.agentId, curTotal: 0, lastTotal: 0, curVc4: 0, curNvc4: 0, lastVc4: 0, lastNvc4: 0, stockTotal: holder.n, stockVc4: 0, stockNvc4: 0 };
      const out = agentRow(base, false);
      out.classStock = { ...holder.classStock };
      out.stockVc4 = num(Object.entries(out.classStock).find(([cls]) => /^VC4$/i.test(cls))?.[1]);
      out.stockComm = Math.max(0, holder.n - out.stockVc4);
      out.stockTotal = holder.n;
      rowsA.push(out);
    });
    rowsA.sort((x, y) => y.cur - x.cur || y.stockTotal - x.stockTotal || x.name.localeCompare(y.name));
    let selfA = selfRow ? agentRow({ ...selfRow, stockTotal: stockComposition.own.total, stockVc4: stockComposition.own.vc4, stockNvc4: stockComposition.own.comm }, true) : null;
    if (!selfA && num(stockComposition.own.total) > 0) selfA = agentRow({ name: p.name, agentId: tlId, tlName: p.name, stockTotal: stockComposition.own.total, stockVc4: stockComposition.own.vc4, stockNvc4: stockComposition.own.comm }, true);
    if (selfA) selfA.classStock = selfClassStock(selfRow || { name: selfA.name, agentId: selfA.id, tlId, tlName: p.name }, stockDetails, 'ff', stockComposition);
    const ac = rowsOf('agentClass'), agRows = rowsOf('agents'), stk = rowsOf('stockAgents');
    const curYm = latestYm(ac.length ? ac : agRows), lastYm = U.prevMonthKey(curYm);
    const teamClassRows = ac.filter((r) => norm(r.tlName) === n && (!r.channel || /first/i.test(r.channel)));
    const out = {
      kind: 'ff-tl', channel: 'First Forward', ch: 'ff', name: p.name, id: tlId, found: !!underTl.length,
      mobile: (src && src.tlMobile && !/^na$/i.test(src.tlMobile)) ? src.tlMobile : '', tl: { name: p.name, id: tlId, mobile: (src && src.tlMobile) || '' },
      status: (src && src.tlStatus) || '', lastActive: (src && src.tlLastActive) || '', priority: (src && prioOf(src.tlPriority)) || '', commPriority: (src && prioOf(src.tlCommPriority)) || '',
      stock, tlStock: { ...stock, has: true, own: stockComposition.own, agents: stockComposition.agents },
      stockSplit: { ownFrom: stockComposition.ownFrom, membersFrom: stockComposition.membersFrom, rollupOwnRow: stockComposition.rollupOwnRow, snapshot: stockComposition.snapshot, raw: stockComposition.raw },
      dispatch: { days: suggestDays(), avgVc4, avgComm, cover: avgVc4 > 0 ? stock.vc4 / avgVc4 : null, sugVc4: suggest(avgVc4, stock.vc4), sugComm: suggest(avgComm, stock.comm), sugVc4Gross: suggestGro(avgVc4), sugCommGross: suggestGro(avgComm), sumAgentVc4: U.sum(rowsA, (r) => r.sugVc4), sumAgentComm: U.sum(rowsA, (r) => r.sugComm), sumAgentVc4Gross: U.sum(rowsA, (r) => r.sugVc4Gross), sumAgentCommGross: U.sum(rowsA, (r) => r.sugCommGross), sumSelfVc4: selfA ? selfA.sugVc4 : 0, sumSelfComm: selfA ? selfA.sugComm : 0, sumSelfVc4Gross: selfA ? selfA.sugVc4Gross : 0, sumSelfCommGross: selfA ? selfA.sugCommGross : 0 },
      totals: { curVc4: sumK('curVc4'), curComm: sumK('curNvc4'), curTotal: sumK('curTotal'), lastVc4: sumK('lastVc4'), lastComm: sumK('lastNvc4'), lastTotal: sumK('lastTotal') },
      agents: rowsA, selfAgent: selfA, agentCount: rowsA.length, teamSize: underTl.length
    };
    // First Forward remains EIR-authoritative (T+1); its REPORT TL fields are duplicate snapshots.
    // 📈 TL growth % — REPORT tab ka apna "TL Performance Status · Percent"; expected month-end bhi saath.
    out.months = { cur: curYm, last: lastYm };
    out.classBins = classBinsFromRows(teamClassRows, curYm, lastYm);
    out.issuanceSources = { cur: 'First Forward EIR', last: 'First Forward EIR', classes: 'First Forward EIR' };
    attachGrowth(out, { growth: (src && src.tlGrowth) || '', projected: src && src.tlProjected }, curYm);
    if (light) return out;
    out.classes = classTable(teamClassRows, stockComposition.classRows, curYm, lastYm);
    out.classBins = classBinsFromRows(teamClassRows, curYm, lastYm);
    if (!out.classes.length) out.classes = [{ cls: 'VC4', cur: out.totals.curVc4, last: out.totals.lastVc4, stock: stock.vc4 }, { cls: 'Commercial', cur: out.totals.curComm, last: out.totals.lastComm, stock: stock.comm }];
    else if (rowsOf('daily').length) {
      // The class table is the same EIR source used by the clicked drill-down. Use its rollup for
      // TL KPIs once the canonical daily EIR view is present, so a stale REPORT TL total cannot
      // reappear above an exact class total.
      const exactTotals = groupSummary(out.classes);
      Object.assign(out.totals, { curVc4: exactTotals.vc4.cur, curComm: exactTotals.comm.cur, curTotal: exactTotals.total.cur, lastVc4: exactTotals.vc4.last, lastComm: exactTotals.comm.last, lastTotal: exactTotals.total.last });
    }
    out.trend = trendOf(agRows, (r) => norm(r.tlName) === n && (!r.channel || /first/i.test(r.channel)), (r) => r.ym);
    out.week = underTl.reduce((acc, a) => acc.map((v, i) => v + num((a.week || [])[i])), [0, 0, 0, 0, 0, 0, 0]);
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
    const truth = safeCall(() => FF.gvTruth && FF.gvTruth.person({
      kind: 'gv-agent',
      name: (r && r.agentName) || p.name,
      id: (r && r.agentId) || p.sub || '',
      tlId: r && r.tlId,
      altIds: [r && r.supervisorId, r && r.gvTlId]
    }), null);
    const truthStock = truth && truth.stock;
    const truthCur = truth && truth.ledger && truth.ledger.cur;
    const truthLast = truth && truth.ledger && truth.ledger.last;
    const truthToday = truth && truth.ledger && truth.ledger.today;
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
    if (r && !out.direct && r.tlName && (!FF.config.isRealTl || FF.config.isRealTl(r.tlName))) {
      const teamStock = tlStockComposition('gv', r.tlName, r.tlId, gvPeopleLookup().rows, gvRows('stockAgent'), gvRows('stockAgentClass'));
      out.tlStock = { ...teamStock.stock, has: true, own: teamStock.own, agents: teamStock.agents };
    }
    // 📦 GV individual-agent card must use the same Tag Assignment stock source as the clicked class-wise detail.
    // GV REPORT row snapshots can legitimately show 0/stale stock while stockAgent has the live holder rows.
    // Resolve by exact agent ID first, then exact normalized name, and use this same total in the light card.
    if (r && out.stock && num(out.stock.total) === 0) {
      try {
        const stockRows = gvRows('stockAgent') || [];
        const wantId = clean(out.id || p.sub).replace(/\\.0+$/, '').toUpperCase();
        const wantName = norm(out.name);
        const mine = stockRows.filter((x) => {
          const xid = clean(x.agentId || x.id).replace(/\\.0+$/, '').toUpperCase();
          const xname = norm(x.agentName || x.name);
          return (wantId && xid && xid === wantId) || (!wantId && wantName && xname === wantName) || (wantId && !xid && wantName && xname === wantName);
        });
        if (mine.length) {
          const total = U.sum(mine, (x) => num(x.n));
          const vc4 = U.sum(mine, (x) => /^VC4$/i.test(clean(x.cls)) ? num(x.n) : 0);
          const comm = Math.max(0, total - vc4);
          out.stock = { vc4, comm, total };
          out.stockSource = 'Tag Assignment';
          // Keep dispatch/cover/suggestions in sync with the corrected stock.
          out.dispatch.cover = out.dispatch.avgVc4 > 0 ? vc4 / out.dispatch.avgVc4 : null;
          out.dispatch.sugVc4 = suggest(out.dispatch.avgVc4, vc4);
          out.dispatch.sugComm = suggest(out.dispatch.avgComm, comm);
        }
      } catch { /* REPORT fallback remains safe */ }
    }
    out.tagRequired = out.direct && isHM(out.priority);
    const n = norm(p.name);
    // GV REPORT is a live calendar-month report: keep the actual current month even when its
    // first issuance row has not arrived yet, so the full prior month remains visible.
    const globalCurYm = U.ymKey(new Date());
    const globalLastYm = U.prevMonthKey(globalCurYm);
    const classLedger = gvIssuanceRows();
    const classMine = gvAgentRows(classLedger, n, out.id);
    out.months = { cur: globalCurYm, last: globalLastYm };
    out.classBins = classBinsFromRows(classMine, globalCurYm, globalLastYm);
    out.issuanceSources = { cur: 'GV Master / EIR', last: 'GV Master / EIR', classes: 'GV Master / EIR' };
    const exactMine = gvAgentRows(gvCanonicalIssuanceRows(), n, out.id);
    // 📑 Sheet-first: GV REPORT (jo GV ka live performance sheet hai) ka number hi final. Tag-ledger
    // (EIR / GV Master) sirf tab chalta hai jab sheet ka wo cell khaali ho — pehle Math.max/list-sum
    // se sheet aur ledger mix ho jaate the, isliye KPI aur sheet alag dikhte the.
    const sheetCur = r && r.curAvailable ? sheetBinsOf(r, 'cur') : null;
    const sheetLast = r && r.lastAvailable ? sheetBinsOf(r, 'last') : null;
    const exactCurrent = exactGvMonth(exactMine, globalCurYm);
    const exactPrevious = exactGvMonth(exactMine, globalLastYm);
    if (applySheetMonth(out.totals, 'cur', sheetCur) || exactCurrent) {
      if (!sheetCur) setExactGvMonth(out.totals, exactMine, globalCurYm, 'cur');
      out.dispatch.avgVc4 = U.runRate(out.totals.curVc4, 'gv');
      out.dispatch.avgComm = U.runRate(out.totals.curComm, 'gv');
      out.dispatch.cover = out.dispatch.avgVc4 > 0 ? out.stock.vc4 / out.dispatch.avgVc4 : null;
      out.dispatch.sugVc4 = suggest(out.dispatch.avgVc4, out.stock.vc4);
      out.dispatch.sugComm = suggest(out.dispatch.avgComm, out.stock.comm);
      out.dispatch.sugVc4Gross = suggestGro(out.dispatch.avgVc4);
      out.dispatch.sugCommGross = suggestGro(out.dispatch.avgComm);
    }
    if (!applySheetMonth(out.totals, 'last', sheetLast) && exactPrevious) setExactGvMonth(out.totals, exactMine, globalLastYm, 'last');
    out.sheetBins = { cur: sheetCur, last: sheetLast };
    out.issuanceSources.cur = sheetCur ? 'GV REPORT sheet' : exactCurrent ? 'GV Master / EIR' : 'GV REPORT';
    out.issuanceSources.last = sheetLast ? 'GV REPORT sheet' : exactPrevious ? 'GV Master / EIR' : 'GV REPORT';
    attachGrowth(out, r || {}, globalCurYm);
    out.groupBins = {
      last: sheetFirstGroups(sheetLast, out.classBins.last),
      cur: sheetFirstGroups(sheetCur, out.classBins.cur),
      stock: { VC4: num(out.stock && out.stock.vc4), VC20: 0, 'VC5+': num(out.stock && out.stock.comm), total: num(out.stock && out.stock.total) }
    };
    // GV Master is authoritative for GV agent issuance; Tag Assignment is authoritative for stock.
    const curYmTruth = U.ymKey(new Date()), lastYmTruth = U.prevMonthKey(curYmTruth);
    // Agent ka rule: naam (normalised) YA exact id — id case-sensitive rehta hai (gvAgentRows jaisa hi),
    // warna sheet me 'g001' vs 'G001' jaise farq par doosre agent ki rows jud jaati hain.
    const myMasterRows = gvCanonicalIssuanceRows().filter((row) => {
      if (out.id) return clean(row.agentId).replace(/\.0+$/, '').toUpperCase() === clean(out.id).replace(/\.0+$/, '').toUpperCase();
      return norm(row.agentName) === norm(out.name);
    });
    const curExact = exactGvMonth(myMasterRows, curYmTruth);
    const lastExact = exactGvMonth(myMasterRows, lastYmTruth);
    if (truthCur || curExact) {
      const cur = curExact || truthCur;
      Object.assign(out.totals, { curVc4: num(cur.vc4), curComm: num(cur.comm), curTotal: num(cur.total) });
    }
    if (truthLast || lastExact) {
      const last = lastExact || truthLast;
      Object.assign(out.totals, { lastVc4: num(last.vc4), lastComm: num(last.comm), lastTotal: num(last.total) });
    }
    if (truthToday) out.today = { vc4: num(truthToday.vc4), comm: num(truthToday.comm), total: num(truthToday.total) };

    // 📦 GV individual-agent stock: detail view ke exact class-wise/Tag Assignment source ko priority do.
    // GV Truth/REPORT snapshot 0 ya stale ho sakta hai jab Tag Assignment me actual holder rows present hon.
    const fallbackGvStock = () => {
      let vc4 = 0, comm = 0, total = 0;
      const classMap = r && r.stockByClass && typeof r.stockByClass === 'object' ? r.stockByClass : {};
      for (const [cls, n] of Object.entries(classMap)) {
        const v = num(n);
        total += v;
        if (/^VC4$/i.test(clean(cls))) vc4 += v;
        else comm += v;
      }
      if (total > 0) return { vc4, comm, total, source: 'GV REPORT class-wise' };

      try {
        const rows = gvRows('stockAgent') || [];
        const wantId = clean(out.id || p.sub).replace(/\\.0+$/, '').toUpperCase();
        const wantName = norm(out.name);
        const mine = rows.filter((x) => {
          const xid = clean(x.agentId || x.id).replace(/\\.0+$/, '').toUpperCase();
          const xn = norm(x.agentName || x.name);
          return (wantId && xid && xid === wantId) || (wantName && xn === wantName);
        });
        if (mine.length) {
          total = U.sum(mine, (x) => num(x.n));
          vc4 = U.sum(mine, (x) => /^VC4$/i.test(clean(x.cls)) ? num(x.n) : 0);
          comm = Math.max(0, total - vc4);
          if (total > 0) return { vc4, comm, total, source: 'Tag Assignment' };
        }
      } catch { /* fall through to Truth */ }
      if (truthStock) return { vc4: num(truthStock.vc4), comm: num(truthStock.comm), total: num(truthStock.total), source: 'GV Truth' };
      return null;
    };
    const resolvedStock = fallbackGvStock();
    if (resolvedStock && (resolvedStock.total > 0 || !truthStock)) {
      out.stock = { vc4: resolvedStock.vc4, comm: resolvedStock.comm, total: resolvedStock.total };
      out.stockSource = resolvedStock.source;
    } else if (truthStock) {
      out.stock = { vc4: num(truthStock.vc4), comm: num(truthStock.comm), total: num(truthStock.total) };
      out.stockSource = 'GV Truth';
    }
    out.tl = { name: out.direct ? '' : (truth && truth.tlName) || (out.tl && out.tl.name) || '', id: out.direct ? '' : (truth && truth.tlId) || (out.tl && out.tl.id) || '' };
    out.issuanceSources = { current: curExact ? 'GV Master' : 'GV Truth', last: lastExact ? 'GV Master' : 'GV Truth', stock: out.stockSource || (truthStock ? 'GV Truth' : 'GV REPORT fallback') };
    out.dispatch.cover = out.dispatch.avgVc4 > 0 ? out.stock.vc4 / out.dispatch.avgVc4 : null;
    out.dispatch.sugVc4 = suggest(out.dispatch.avgVc4, out.stock.vc4);
    out.dispatch.sugComm = suggest(out.dispatch.avgComm, out.stock.comm);
    out.dispatch.sugVc4Gross = suggestGro(out.dispatch.avgVc4);
    out.dispatch.sugCommGross = suggestGro(out.dispatch.avgComm);
    if (light) return out;
    const master = gvClassRows((m) => {
      if (out.id) return clean(m.agentId).replace(/\.0+$/, '').toUpperCase() === clean(out.id).replace(/\.0+$/, '').toUpperCase();
      return norm(m.agentName) === n;
    });
    const curYm = globalCurYm, lastYm = globalLastYm;
    out.classBins = classBinsFromRows(master, curYm, lastYm);
    if (!out.classBins.available.cur && !out.classBins.available.last) out.issuanceSources.classes = 'GV REPORT class fields';
    const stockRows = r ? Object.entries(r.stockByClass || {}).filter(([, v]) => v).map(([cls, v]) => ({ cls, n: v })) : [];
    const stockComm = r ? Math.max(0, num(r.stockComm)) : 0;
    out.classes = classTable(master, stockRows, curYm, lastYm);
    if (!out.classes.length && r) out.classes = Object.entries(r.curByClass || {}).map(([cls, cur]) => ({ cls, cur: num(cur), last: num((r.lastByClass || {})[cls]), stock: num((r.stockByClass || {})[cls]) })).filter((x) => x.cur || x.last || x.stock);
    if (!out.classes.length && r) out.classes = [{ cls: 'VC4', cur: num(r.curVc4), last: num(r.lastVc4), stock: num(r.stockVc4) }, { cls: 'Commercial', cur: num(r.curComm), last: num(r.lastComm), stock: stockComm }];
    out.classes = enrichClassesWithTotals(out.classes, out.totals, out.stock);
    out.groupBins = {
      last: sheetFirstGroups(sheetLast, out.classBins.last),
      cur: sheetFirstGroups(sheetCur, out.classBins.cur),
      stock: groupBinsOf(out.classes, 'stock')
    };
    out.trend = trendOf(master, () => true, (m) => m.ym);
    return out;
  }
  function gvTlProfile(p, light) {
    const n = norm(p.name);
    const gvIndex = gvPeopleLookup();
    const allReports = gvIndex.rows;
    const nameReports = n ? (gvIndex.byTl.get(n) || []) : [];
    const requestedTlId = clean(p.sub || p.id).toUpperCase();
    const exactReports = requestedTlId ? nameReports.filter((r) => clean(r.tlId || r.supervisorId).toUpperCase() === requestedTlId) : [];
    const knownTlIds = new Set(nameReports.map((r) => clean(r.tlId || r.supervisorId).toUpperCase()).filter(Boolean));
    let tlReports = exactReports.length ? exactReports : requestedTlId && knownTlIds.size > 1 ? [] : nameReports;
    if (!tlReports.length && requestedTlId) {
      tlReports = allReports.filter((r) => clean(r.tlId || r.supervisorId).toUpperCase() === requestedTlId);
    }
    const reportTeam = tlReports.filter((r) => !safeCall(() => FF.config.isDirectAgent(r, 'gv'), false));
    const reportTlId = (reportTeam[0] && reportTeam[0].tlId) || (tlReports[0] && tlReports[0].tlId) || p.sub || '';
    const tlNameCanon = (reportTeam[0] && reportTeam[0].tlName) || (tlReports[0] && tlReports[0].tlName) || p.name || '';
    const stockTlId = reportTlId;
    const tlId = safeCall(() => FF.gv && FF.gv.masterTlIdentity ? FF.gv.masterTlIdentity(reportTlId, tlNameCanon) : '', '') || reportTlId;
    const nCanon = norm(tlNameCanon);
    const isSelfReport = (r) => (nCanon && norm(r.agentName) === nCanon) || (!!reportTlId && clean(r.agentId).toUpperCase() === clean(reportTlId).toUpperCase() && (!nCanon || norm(r.tlName) === nCanon));
    // Keep the TL's own self-supervised GV REPORT row long enough to separate its issuance from the
    // member list. It is not a direct/no-TL agent: GV REPORT TL snapshots include this row's work.
    const list = tlReports.filter((r) => !safeCall(() => FF.config.isDirectAgent(r, 'gv'), false) || isSelfReport(r)).map((r) => ({ ...r }));
    const src = list.find((r) => !isSelfReport(r)) || list[0] || null;
    const selfRows = list.filter(isSelfReport).sort((a, b) => num(a.stockTotal) - num(b.stockTotal));
    const team = list.filter((r) => !isSelfReport(r)), selfRow = selfRows.length ? selfRows[selfRows.length - 1] : null;
    const reportSnapshots = reportedGvTlSnapshots(list);
    const sumK = (k) => U.sum(list, (r) => num(r[k]));
    const avgVc4 = U.runRate(sumK('curVc4'), 'gv'), avgComm = U.runRate(sumK('curComm'), 'gv');
    const stockComposition = tlStockComposition('gv', p.name, stockTlId, allReports, gvRows('stockAgent'), gvRows('stockAgentClass'));
    const stock = stockComposition.stock;
    const agentRow = (r, isSelf) => {
      const av = gvDaily(r, r.curVc4), avc = gvDaily(r, r.curComm);
      return { name: r.agentName, id: r.agentId, tlId: r.tlId || stockTlId, tlName: r.tlName || tlNameCanon, mobile: mobileFor(r.agentName, r.agentId, r.mobile), priority: prioOf(r.priority), status: r.agentStatus || '', lastActive: r.agentLastActive || r.lastActive || '', isSelf: !!isSelf, stockVc4: num(r.stockVc4), stockComm: num(r.stockComm), stockTotal: num(r.stockTotal), cur: num(r.curTotal), last: num(r.lastTotal), curVc4: num(r.curVc4), curComm: num(r.curComm), lastVc4: num(r.lastVc4), lastComm: num(r.lastComm), sugVc4: suggest(av, r.stockVc4), sugComm: suggest(avc, r.stockComm), sugVc4Gross: suggestGro(av), sugCommGross: suggestGro(avc) };
    };
    const gvClassDetail = gvRows('stockAgentClass');
    const gvStockByHolder = new Map(), gvStockByName = new Map();
    const stockHolderKey = (r) => clean(r.agentId) ? `#${clean(r.agentId).toUpperCase()}` : `n:${norm(r.agentName)}`;
    const stockTlRows = gvRows('stockAgent').filter((r) => {
      const ownerId = clean(r.tlId);
      if (stockTlId) return !!ownerId && ownerId.toUpperCase() === clean(stockTlId).toUpperCase();
      return norm(r.tlName) === nCanon;
    });
    stockTlRows.forEach((r) => {
      if (safeCall(() => FF.config.isDirectAgent(r, 'gv'), false) || isSelfReport(r)) return;
      const key = stockHolderKey(r), holder = gvStockByHolder.get(key) || { ...r, n: 0, stockVc4: 0, stockComm: 0 };
      holder.n += num(r.n);
      gvStockByHolder.set(key, holder);
      if (norm(r.agentName)) gvStockByName.set(norm(r.agentName), holder);
    });
    const matchedRoster = new Set();
    const rowsA = team.map((r) => {
      const holder = (r.agentId && gvStockByHolder.get(`#${clean(r.agentId).toUpperCase()}`)) || gvStockByName.get(norm(r.agentName));
      if (holder) matchedRoster.add(stockHolderKey(holder));
      const exact = holder ? { ...r, stockVc4: 0, stockComm: 0, stockTotal: holder.n } : r;
      const out = agentRow(exact, false);
      out.classStock = agentClassStock(r, gvClassDetail, 'gv');
      if (holder) {
        const cls = Object.entries(out.classStock || {});
        out.stockVc4 = num(cls.find(([k]) => /^VC4$/i.test(k))?.[1]);
        out.stockComm = Math.max(0, holder.n - out.stockVc4);
        out.stockTotal = holder.n;
      }
      return out;
    });
    gvStockByHolder.forEach((holder, key) => {
      if (matchedRoster.has(key)) return;
      const base = { ...holder, agentName: holder.agentName, agentId: holder.agentId, curTotal: 0, lastTotal: 0, curVc4: 0, curComm: 0, lastVc4: 0, lastComm: 0, stockTotal: holder.n, stockVc4: 0, stockComm: 0 };
      const out = agentRow(base, false);
      out.classStock = agentClassStock(base, gvClassDetail, 'gv');
      out.stockVc4 = num(Object.entries(out.classStock || {}).find(([k]) => /^VC4$/i.test(k))?.[1]);
      out.stockComm = Math.max(0, holder.n - out.stockVc4);
      out.stockTotal = holder.n;
      rowsA.push(out);
    });
    rowsA.sort((x, y) => y.cur - x.cur || y.stockTotal - x.stockTotal || x.name.localeCompare(y.name));
    let selfA = selfRow ? agentRow({ ...selfRow, stockTotal: stockComposition.own.total, stockVc4: stockComposition.own.vc4, stockComm: stockComposition.own.comm }, true) : null;
    if (!selfA && num(stockComposition.own.total) > 0) selfA = agentRow({ agentName: tlNameCanon || p.name, agentId: reportTlId || '', tlId: stockTlId, tlName: tlNameCanon || p.name, stockTotal: stockComposition.own.total, stockVc4: stockComposition.own.vc4, stockComm: stockComposition.own.comm }, true);
    if (selfA) selfA.classStock = selfClassStock(selfRow || { agentName: selfA.name, agentId: selfA.id, tlId: stockTlId, tlName: tlNameCanon }, gvClassDetail, 'gv', stockComposition);
    const out = {
      kind: 'gv-tl', channel: 'GV Partner', ch: 'gv', name: p.name, id: tlId, stockTlId: stockTlId || tlId, found: !!list.length,
      mobile: (src && src.tlMobile) || '', tl: { name: p.name, id: tlId }, status: '', lastActive: '', priority: '', stock, tlStock: { ...stock, has: true, own: stockComposition.own, agents: stockComposition.agents },
      stockSplit: { ownFrom: stockComposition.ownFrom, membersFrom: stockComposition.membersFrom, rollupOwnRow: stockComposition.rollupOwnRow, snapshot: stockComposition.snapshot, raw: stockComposition.raw },
      dispatch: { days: suggestDays(), avgVc4, avgComm, cover: avgVc4 > 0 ? stock.vc4 / avgVc4 : null, sugVc4: suggest(avgVc4, stock.vc4), sugComm: suggest(avgComm, stock.comm), sugVc4Gross: suggestGro(avgVc4), sugCommGross: suggestGro(avgComm), sumAgentVc4: U.sum(rowsA, (r) => r.sugVc4), sumAgentComm: U.sum(rowsA, (r) => r.sugComm), sumAgentVc4Gross: U.sum(rowsA, (r) => r.sugVc4Gross), sumAgentCommGross: U.sum(rowsA, (r) => r.sugCommGross), sumSelfVc4: selfA ? selfA.sugVc4 : 0, sumSelfComm: selfA ? selfA.sugComm : 0, sumSelfVc4Gross: selfA ? selfA.sugVc4Gross : 0, sumSelfCommGross: selfA ? selfA.sugCommGross : 0 },
      totals: { curVc4: sumK('curVc4'), curComm: sumK('curComm'), curTotal: sumK('curTotal'), lastVc4: sumK('lastVc4'), lastComm: sumK('lastComm'), lastTotal: sumK('lastTotal') },
      agents: rowsA, selfAgent: selfA, agentCount: rowsA.length, teamSize: list.length
    };
    // TL priority = sabse high agent priority
    out.priority = rowsA.some((r) => r.priority === 'High') ? 'High' : rowsA.some((r) => r.priority === 'Medium') ? 'Medium' : rowsA.length ? 'Low' : '';
    const globalCurYm = U.ymKey(new Date());
    const globalLastYm = U.prevMonthKey(globalCurYm);
    // GV Master column R (GV TL ID) is the canonical TL team key. Profile and its KPI drill
    // consume this same tagged row set; the broad EIR+Master rollup is fallback only.
    const masterTeamIssuance = safeCall(() => FF.gv && FF.gv.tlIssuanceRows ? FF.gv.tlIssuanceRows(tlId, tlNameCanon) : null, null);
    const hasMasterTlIdRows = Array.isArray(masterTeamIssuance) && masterTeamIssuance.length > 0;
    const classLedger = hasMasterTlIdRows ? masterTeamIssuance : gvIssuanceRows();
    const classTeamRows = hasMasterTlIdRows ? masterTeamIssuance : gvTeamRows(classLedger, list);
    out.months = { cur: globalCurYm, last: globalLastYm };
    out.classBins = classBinsFromRows(classTeamRows, globalCurYm, globalLastYm);
    const groupBinsWithTlMaster = () => {
      const fallback = gvGroupBins(reportSnapshots, out.classBins, stockComposition, { cur: tlSheetSplit(list, reportSnapshots.cur, 'cur') });
      if (!hasMasterTlIdRows) return fallback;
      const fromMaster = (period) => {
        const b = (out.classBins && out.classBins[period]) || blankIssueBins();
        const values = { VC4: num(b.VC4), VC20: num(b.VC20), 'VC5+': num(b['VC5+']), total: num(b.total) };
        const snap = reportSnapshots[period];
        const reportTotal = snap && snap.total !== null && snap.total !== undefined
          ? { vc4: snap.vc4, comm: snap.comm, total: snap.total } : null;
        return {
          ...values, comm: values.VC20 + values['VC5+'], source: 'GV Master · GV TL ID', mix: 'GV TL ID',
          sheet: reportTotal, ledger: values
        };
      };
      return { last: fromMaster('last') || fallback.last, cur: fromMaster('cur') || fallback.cur, stock: fallback.stock };
    };
    out.tlReportSnapshot = reportSnapshots;
    out.issuanceSources = {
      cur: 'GV Master · GV TL ID', last: 'GV Master · GV TL ID',
      classes: hasMasterTlIdRows ? 'GV Master · GV TL ID' : 'GV Master / EIR', stock: 'GV REPORT TL stock snapshot / Tag Assignment'
    };
    const agentNames = new Set(list.map((r) => norm(r.agentName)));
    const agentIds = new Set(list.map((r) => clean(r.agentId).toUpperCase()).filter(Boolean));
    const exactTeamIssuance = hasMasterTlIdRows ? masterTeamIssuance : gvTeamRows(gvCanonicalIssuanceRows(), list);
    // 🟢 TL AAJ LIVE: same GV Master team rows as the agent/team issuance cards.
    const todayTeamRows = (exactTeamIssuance || []).filter((r) => U.dateKey(r.date || r.d || U.fromDateKey(r.key || '')) === U.dateKey(new Date()));
    const todayTeam = {
      vc4: U.sum(todayTeamRows, (r) => r.group === 'VC4' ? num(r.n) || 1 : 0),
      comm: U.sum(todayTeamRows, (r) => r.group !== 'VC4' ? num(r.n) || 1 : 0),
      total: U.sum(todayTeamRows, (r) => num(r.n) || 1),
      replacement: U.sum(todayTeamRows, (r) => /replacement/i.test(r.status || r.type || '') ? num(r.n) || 1 : 0),
      chassis: U.sum(todayTeamRows, (r) => /chassis/i.test(r.tagType || r.vrnType || '') ? num(r.n) || 1 : 0)
    };
    out.today = todayTeam;
    // Count each selected GV Master tag once; synchronize member rows as well as TL cards.
    // If GV Master has no team rows, preserve the previous GV REPORT / EIR fallback behavior.
    applyExactGvAgentMonths(list, exactTeamIssuance, globalCurYm, globalLastYm, hasMasterTlIdRows);
    list.forEach((agent) => {
      const row = rowsA.find((candidate) => sameGvAgent(candidate, agent)) || (selfA && sameGvAgent(selfA, agent) ? selfA : null);
      if (!row) return;
      Object.assign(row, {
        cur: num(agent.curTotal), last: num(agent.lastTotal),
        curVc4: num(agent.curVc4), curComm: num(agent.curComm),
        lastVc4: num(agent.lastVc4), lastComm: num(agent.lastComm)
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
    const masterCur = hasMasterTlIdRows ? (exactCur || { vc4: 0, comm: 0, total: 0 }) : null;
    const masterLast = hasMasterTlIdRows ? (exactLast || { vc4: 0, comm: 0, total: 0 }) : null;
    const currentTotal = masterCur || exactCur;
    const lastTotal = masterLast || exactLast;
    if (currentTotal) Object.assign(out.totals, { curVc4: currentTotal.vc4, curComm: currentTotal.comm, curTotal: currentTotal.total });
    if (lastTotal) Object.assign(out.totals, { lastVc4: lastTotal.vc4, lastComm: lastTotal.comm, lastTotal: lastTotal.total });
    // GV TL totals and class/tag rows now share the exact GV Master GV TL ID team selection.
    // GV REPORT AQ:AV remains the fallback only when Master has no rows for that period.
    if (!masterCur) applyReportedTlSnapshot(out.totals, reportSnapshots.cur, 'cur');
    if (!masterLast) applyReportedTlSnapshot(out.totals, reportSnapshots.last, 'last');
    out.issuanceSources.cur = masterCur ? 'GV Master · GV TL ID' : reportSnapshots.cur ? 'GV REPORT · TL Current Month Issuance' : exactCur ? 'GV Master / EIR' : 'GV REPORT agent rows';
    out.issuanceSources.last = masterLast ? 'GV Master · GV TL ID' : reportSnapshots.last ? 'GV REPORT · TL Last Month Issued' : exactLast ? 'GV Master / EIR' : 'GV REPORT agent rows';
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
    out.groupBins = groupBinsWithTlMaster();
    if (light) return out;
    const master = hasMasterTlIdRows
      ? masterTeamIssuance
      : gvClassRows((m) => agentNames.has(norm(m.agentName)) || (m.agentId && agentIds.has(clean(m.agentId).toUpperCase())));
    const curYm = globalCurYm, lastYm = globalLastYm;
    out.classBins = classBinsFromRows(master, curYm, lastYm);
    const stockRows = stockComposition.classRows;
    out.classes = classTable(master, stockRows, curYm, lastYm);
    if (!out.classes.length) out.classes = [{ cls: 'VC4', cur: out.totals.curVc4, last: out.totals.lastVc4, stock: stock.vc4 }, { cls: 'Commercial', cur: out.totals.curComm, last: out.totals.lastComm, stock: stock.comm }];
    // Preserve the legacy report fallback only if it had no TL snapshot; a matched GV Master R team
    // remains authoritative regardless of whether GV REPORT also has repeated snapshots.
    if (!hasMasterTlIdRows && exactCur && !reportSnapshots.cur) Object.assign(out.totals, { curVc4: exactCur.vc4, curComm: exactCur.comm, curTotal: exactCur.total });
    if (!hasMasterTlIdRows && exactLast && !reportSnapshots.last) Object.assign(out.totals, { lastVc4: exactLast.vc4, lastComm: exactLast.comm, lastTotal: exactLast.total });
    // With GV Master GV TL ID rows, the tag-level class rows and headline intentionally share a source.
    // The search board and drill both display the ledger mix separately and expose any difference.
    if (!reportSnapshots.cur && !reportSnapshots.last) out.classes = enrichClassesWithTotals(out.classes, out.totals, stock);
    out.groupBins = groupBinsWithTlMaster();
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
  /** Sync full profile — jo data abhi memory me hai usi se (loadFor ka intezaar nahi). */
  function buildNow(person) {
    if (!supports(person)) throw new Error('Is type ka profile nahi banta');
    return BUILDERS[person.kind](person, false);
  }
  async function build(person) {
    if (!supports(person)) throw new Error('Is type ka profile nahi banta');
    await loadFor(person);
    return BUILDERS[person.kind](person, false);
  }
  /** Drawer / inline ke liye: pehle SOFT ms tak data ka intezaar, phir jo hai usse profile (partial flag ke saath); baaki data aane par
   *  `onLate(profile)` dobara bulaya jaata hai. Profile spinner ab kabhi "hamesha" nahi ghoomta. */
  const LIMITS = { openSoftMs: 12000 };   // tests chhota karte hain
  async function buildSoon(person, onLate) {
    if (!supports(person)) throw new Error('Is type ka profile nahi banta');
    const loading = loadFor(person);
    const done = await U.within(loading.then(() => true), LIMITS.openSoftMs, false);
    const pr = BUILDERS[person.kind](person, false);
    if (done) return pr;
    pr.partial = true;
    loading.then(() => { try { if (onLate) onLate(BUILDERS[person.kind](person, false)); } catch { /* late rebuild best effort */ } }).catch(() => {});
    return pr;
  }

  // ------------------------------------------------------------------ html
  const prioChip = (p) => (p ? `<span class="badge ${/high/i.test(p) ? 'red' : /medium/i.test(p) ? 'amber' : 'green'}">${esc(p)}</span>` : '<span class="dim">—</span>');
  const tagChip = (n) => `<b class="sug-chip direct">🏷️ ${fmt(n)} tags</b>`;
  const mobileCell = (m) => (!canContacts() ? '<span class="dim">🔒</span>' : m ? `<a href="tel:${esc(m)}">📞 ${esc(m)}</a>` : '<span class="dim">—</span>');
  const kpi = (label, value, foot, tone, kpiSpec) => `<div class="mp-kpi ${tone || ''}${kpiSpec ? ' kpi-clickable' : ''}"${kpiSpec ? ` data-kpi="${esc(kpiSpec)}" role="button" tabindex="0"` : ''}><small>${esc(label)}</small><b>${value}</b>${foot ? `<em>${foot}</em>` : ''}</div>`;

  const todayKpiHtml = (pr, isTl) => {
    const t = pr && pr.today;
    const tk = U.dateKey(new Date());
    const spec = isTl
      ? `src=gv&scope=day&date=${tk}&tl=${encodeURIComponent(pr.name || '')}&tlId=${encodeURIComponent(pr.id || '')}`
      : `src=gv&scope=day&date=${tk}&agent=${encodeURIComponent(pr.name || '')}&agentId=${encodeURIComponent(pr.id || '')}`;
    return kpi('🟢 Aaj ka Live GV', t ? fmt(t.total) : '—', t ? `VC4 ${fmt(t.vc4)} · Commercial ${fmt(t.comm)} · ${isTl ? 'TL + all agents' : 'GV Master'}` : 'GV Master se live snapshot', 'k0', spec);
  };
  const cell = (label, value) => `<div><small>${esc(label)}</small><b>${value}</b></div>`;

  /** Net (after stock) and gross (without stock deduction) — 🎯 KPI tile me HAMESHA dono dikhte hain
   *  (v3.51). Warna mode 'net' hone par tile me sirf 0 dikhta tha aur "bina stock" ka number neeche
   *  table me chhupa rehta tha. */
  function sugPairHtml(net, gross) {
    return `<span class="sug-pair sug-pair-tight"><span class="sug-result net" title="Required − stock"><small>After stock</small><b class="sug-chip">${fmt(net)}</b></span><span class="sug-result gross" title="Run-rate × din, stock ghata kar nahi"><small>W/o stock</small><b class="sug-chip wo">${fmt(gross)}</b></span></span>`;
  }
  function sugBlock(pr) {
    const d = pr.dispatch || {};
    const isTl = /tl$/.test(pr.kind);
    if (pr.tagRequired) {
      const tagPair = (net, gross) => `<span class="sug-pair sug-pair-tight"><span class="sug-result net"><small>Tag need · after stock</small>${tagChip(net)}</span><span class="sug-result gross"><small>Tags · w/o stock</small><b class="sug-chip wo">🏷️ ${fmt(gross)} tags</b></span></span>`;
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

  /** 🧑‍💼 TL ke agents — TL ki APNI row sabse upar alag dikhti hai (asli sheets me TL bhi apni team ki
   *  ek "agent" row hota hai) aur neeche footer reconcile karta hai: agents ka jod + TL ka own = TL total.
   *  Isse TL ka stock "agents ke sath" wali line me dobara nahi judta (double count fix) aur har stock cell
   *  click par wahi detail khulti hai jo number dikha raha hai. */
  function tlAgentsTable(pr) {
    const d = pr.dispatch || {}, ts = pr.tlStock || {}, s = pr.stock || {}, t = pr.totals || {}, m = pr.months || {};
    const rows = (pr.agents || []).slice();
    const selfA = pr.selfAgent || null;
    if (!rows.length && !selfA) return '';
    const tlSpec = `src=${pr.ch}&scope=stock&tl=${encodeURIComponent(pr.name)}`;
    const sum = (k, list) => U.sum(list || rows, (a) => num(a[k]));
    const own = ts.own || { vc4: 0, comm: 0, total: 0 }, ag = ts.agents || { vc4: 0, comm: 0, total: 0 };
    // v3.41 — har number (stock · last month · this month, VC4 / Comm / Total) apni drawer kholta hai:
    // agent → month / MTD → class (group) → day → tag / barcode row. Issuance drill me `ym` = profile ka month.
    const issSpec = (a, which, group) => {
      const who = `agent=${encodeURIComponent(a.name)}${a.id ? `&agentId=${encodeURIComponent(a.id)}` : ''}`;
      const base = which === 'cur' ? `src=${pr.ch}&scope=mtd&ym=${encodeURIComponent(m.cur || '')}` : `src=${pr.ch}&scope=month&ym=${encodeURIComponent(m.last || '')}`;
      const parentTl = pr.ch === 'gv' && /-tl$/.test(pr.kind || '')
        ? `&tl=${encodeURIComponent(pr.name || '')}&tlId=${encodeURIComponent(pr.id || '')}` : '';
      return `${base}${parentTl}&${who}${group ? `&group=${group}` : ''}`;
    };
    const rowHtml = (a) => {
      const spec = `src=${pr.ch}&scope=stock&agent=${encodeURIComponent(a.name)}${a.id ? `&agentId=${encodeURIComponent(a.id)}` : ''}`;
      const cellOf = (val, sp, ttl) => `<td class="num mp-drill" data-kpi="${esc(sp)}" role="button" tabindex="0" title="${esc(ttl)}">${fmt(val)}</td>`;
      const stk = (key) => cellOf(a[key], spec, `${a.name} ka stock detail`);
      const iss = (key, which, group) => cellOf(a[key], issSpec(a, which, group), `${a.name} · ${which === 'cur' ? 'is month' : 'last month'}${group ? ` · ${group}` : ''} — issuance detail (day → tag)`);
      return `<tr class="clickable${a.isSelf ? ' mp-selfrow' : ''}" data-mp-agent="${esc(a.name)}" data-mp-kind="${pr.ch}-agent" data-mp-id="${esc(a.id || '')}"><td>${a.isSelf ? '👤 ' : ''}<b>${esc(a.name)}</b>${a.isSelf ? '<span class="mp-tag-self">TL · apna stock</span>' : ''}<small class="cell-sub">${esc(a.id || '')}${a.status ? ` · ${esc(a.status)}` : ''}${a.lastActive ? ` · last ${esc(a.lastActive)}` : ''}</small></td><td>${mobileCell(a.mobile)}</td><td>${prioChip(a.priority)}</td>${stk('stockVc4')}${stk('stockComm')}${stk('stockTotal')}${iss('lastVc4', 'last', 'VC4')}${iss('lastComm', 'last', 'COMM')}${iss('last', 'last', '')}${iss('curVc4', 'cur', 'VC4')}${iss('curComm', 'cur', 'COMM')}${iss('cur', 'cur', '')}<td class="num">${U.sugCell(a.sugVc4, a.sugVc4Gross || 0)}</td><td class="num">${U.sugCell(a.sugComm, a.sugCommGross || 0)}</td></tr>`;
    };
    // Suggested footer values MUST come from the exact rows shown above.
    // TL total dispatch = agents' suggested dispatch + TL's own suggested dispatch.
    // The old footer used TL-level dispatch (d.sugVc4/d.sugComm), which can be 0 when
    // TL stock alone covers the TL-level run-rate even though individual agents still need tags.
    const footRow = (label, v, cls, spec) => `<tr class="clickable ${cls}"${spec ? ` data-kpi="${esc(spec)}" role="button" tabindex="0" title="In hi rows ki detail"` : ''}><td colspan="3">${label}</td><td class="num">${fmt(v.sVc4)}</td><td class="num">${fmt(v.sComm)}</td><td class="num">${fmt(v.sTotal)}</td><td class="num">${fmt(v.lVc4)}</td><td class="num">${fmt(v.lComm)}</td><td class="num">${fmt(v.last)}</td><td class="num">${fmt(v.cVc4)}</td><td class="num">${fmt(v.cComm)}</td><td class="num">${fmt(v.cur)}</td><td class="num">${U.sugCell(v.sugVc4, v.sugVc4Gross || 0)}</td><td class="num">${U.sugCell(v.sugComm, v.sugCommGross || 0)}</td></tr>`;
    const agentsTotal = { vc4: sum('stockVc4'), comm: sum('stockComm'), last: sum('last'), cur: sum('cur') };
    const sv = (list, o) => ({ lVc4: sum('lastVc4', list), lComm: sum('lastComm', list), last: sum('last', list), cVc4: sum('curVc4', list), cComm: sum('curComm', list), cur: sum('cur', list), ...o });
    const selfTotals = selfA ? { vc4: num(selfA.stockVc4), comm: num(selfA.stockComm), last: num(selfA.last), cur: num(selfA.cur) } : { vc4: 0, comm: 0, last: 0, cur: 0 };
    // Footer = KPI ka composition (own + agents = TL total hamesha barabar); upar ki rows ka jod alag ho
    // (sheet beech me load ho rahi ho) to note saaf batata hai — number chhupate nahi, explain karte hain.
    const rowGap = Math.abs((agentsTotal.vc4 + agentsTotal.comm + selfTotals.vc4 + selfTotals.comm) - (ag.total + own.total));
    const note = rowGap > 1
      ? `<p class="dim small">ℹ️ Footer ke numbers KPI se aate hain (stock rows + sheet ke snapshot ka reconcile) — isliye upar ki rows ka jod (${fmt(agentsTotal.vc4 + agentsTotal.comm + selfTotals.vc4 + selfTotals.comm)}) thoda alag ho sakta hai jab sheet abhi load ho rahi ho. TL total hamesha = own <b>${fmt(own.total)}</b> + agents <b>${fmt(ag.total)}</b> = <b>${fmt(s.total)}</b>.</p>`
      : '';
    const monthHead = (ym, fallback) => esc(monthLabel(ym) || fallback);
    const head = `<tr><th rowspan="2">Agent</th><th rowspan="2">Mobile</th><th rowspan="2">Priority</th><th colspan="3" class="num">📦 Stock</th><th colspan="3" class="num">⏮ ${monthHead(m.last, 'Last month')}</th><th colspan="3" class="num">▶ ${monthHead(m.cur, 'This month')}</th><th colspan="2" class="num">Suggested</th></tr><tr><th class="num">VC4</th><th class="num">Comm</th><th class="num">Total</th><th class="num">VC4</th><th class="num">Comm</th><th class="num">Total</th><th class="num">VC4</th><th class="num">Comm</th><th class="num">Total</th><th class="num">VC4</th><th class="num">Comm</th></tr>`;
    // Calculate from the exact agent/self rows displayed in this table.
    // Number(...) + fallback keeps this robust even when a host adapter gives numeric strings.
    const sugSum = (list, key) => (list || []).reduce((total, item) => {
      const value = Number(item && item[key]);
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);
    // The visible "Without subtracting stock" number is the gross suggested dispatch.
    // For the footer, gross is the requested total dispatch; net/After-stock remains visible separately.
    const agentsSug = {
      vc4: sugSum(rows, 'sugVc4'),
      comm: sugSum(rows, 'sugComm'),
      vc4Gross: sugSum(rows, 'sugVc4Gross'),
      commGross: sugSum(rows, 'sugCommGross')
    };
    const ownSug = {
      vc4: selfA ? Number(selfA.sugVc4) || 0 : 0,
      comm: selfA ? Number(selfA.sugComm) || 0 : 0,
      vc4Gross: selfA ? Number(selfA.sugVc4Gross) || 0 : 0,
      commGross: selfA ? Number(selfA.sugCommGross) || 0 : 0
    };
    const combinedSug = {
      vc4: agentsSug.vc4 + ownSug.vc4,
      comm: agentsSug.comm + ownSug.comm,
      vc4Gross: agentsSug.vc4Gross + ownSug.vc4Gross,
      commGross: agentsSug.commGross + ownSug.commGross
    };
    agentsSug.total = agentsSug.vc4 + agentsSug.comm;
    agentsSug.totalGross = agentsSug.vc4Gross + agentsSug.commGross;
    ownSug.total = ownSug.vc4 + ownSug.comm;
    ownSug.totalGross = ownSug.vc4Gross + ownSug.commGross;
    combinedSug.total = combinedSug.vc4 + combinedSug.comm;
    combinedSug.totalGross = combinedSug.vc4Gross + combinedSug.commGross;

    const agentsFoot = rows.length ? footRow(
      `<span class="mp-linkish">🧑‍💼 Agents total (${fmt(rows.length)}) · 🎯 ${fmt(agentsSug.totalGross)} tags</span>`,
      sv(rows, {
        sVc4: ag.vc4, sComm: ag.comm, sTotal: ag.total,
        sugVc4: agentsSug.vc4, sugComm: agentsSug.comm,
        sugVc4Gross: agentsSug.vc4Gross, sugCommGross: agentsSug.commGross
      }), '', `${tlSpec}&part=team`) : '';

    const ownFoot = selfA || own.total ? footRow(
      `👤 ${esc(selfA ? selfA.name : pr.name)} ke paas (TL own) · 🎯 ${fmt(ownSug.totalGross)} tags`,
      sv(selfA ? [selfA] : [], {
        sVc4: own.vc4, sComm: own.comm, sTotal: own.total,
        sugVc4: ownSug.vc4, sugComm: ownSug.comm,
        sugVc4Gross: ownSug.vc4Gross, sugCommGross: ownSug.commGross
      }), 'mp-selfrow', `${tlSpec}&part=own`) : '';

    // TL TOTAL = TL own gross suggested dispatch + all agents gross suggested dispatch.
    // This is intentionally independent of TL-level net d.sugVc4/d.sugComm.
    const totFoot = footRow(
      `= TL TOTAL (own + agents) · 🎯 ${fmt(combinedSug.totalGross)} tags`,
      {
        sVc4: s.vc4, sComm: s.comm, sTotal: s.total,
        lVc4: t.lastVc4, lComm: t.lastComm, last: t.lastTotal,
        cVc4: t.curVc4, cComm: t.curComm, cur: t.curTotal,
        sugVc4: combinedSug.vc4, sugComm: combinedSug.comm,
        sugVc4Gross: combinedSug.vc4Gross, sugCommGross: combinedSug.commGross
      }, 'row-total', tlSpec);
    return `<section class="mp-sec" data-mp-sec="agents"><h4>🧑‍💼 TL ke agents · ${fmt(rows.length)}${selfA ? ' <span class="dim small">+ TL (apna stock alag)</span>' : ''}</h4><p class="dim small">Har number par click → agent ki detail (stock / last month / is month → class → din → tag-barcode). Sug. = avg/day × ${d.days} din · <b>stock ke baad</b> (net)${sugMode() === 'both' ? ' · <span class="sug-wo-inline">w/o stock = bina stock ghataye (gross)</span>' : ''} · <span class="mp-linkish" data-kpi="${esc(`src=${pr.ch}&scope=people&tl=${encodeURIComponent(pr.name)}&self=0&sort=stock`)}" role="button" tabindex="0" title="Poora agents list">Poori list 👉</span></p><div class="table-wrap tall"><table class="tbl compact mp-agents-tbl"><thead>${head}</thead><tbody>${selfA ? rowHtml(selfA) : ''}${rows.map(rowHtml).join('')}</tbody><tfoot>${agentsFoot}${ownFoot}${totFoot}</tfoot></table></div>${note}${agentClassMatrix(pr)}</section>`;
  }

  /** 🎯 Group table ke liye bins — GV me sheet-first (pr.groupBins), FF me tag-ledger (pr.classBins). */
  function groupBinsFor(pr) {
    const usable = (g) => !!(g && (g.source || num(g.total) || num(g.VC4) || num(g.VC20) || num(g['VC5+'])));
    const given = pr && pr.groupBins;
    if (given && (usable(given.last) || usable(given.cur))) {
      return { last: usable(given.last) ? given.last : null, cur: usable(given.cur) ? given.cur : null, stock: given.stock || null };
    }
    const bins = (pr && pr.classBins) || null;
    if (!bins) return null;
    if (!usable(bins.last) && !usable(bins.cur)) return null;
    return {
      last: usable(bins.last) ? sheetFirstGroups(null, bins.last) : null,
      cur: usable(bins.cur) ? sheetFirstGroups(null, bins.cur) : null,
      stock: groupBinsOf((pr.classes || []), 'stock')
    };
  }
  /** 📑 Sheet vs tag-ledger ka farq ek hi jagah se — class table aur group table dono me dikhta hai. */
  function reconLine(bins) {
    return ['last', 'cur'].map((period) => {
      const b = bins && bins[period];
      if (!b || !b.ledger || !b.sheet) return '';
      const delta = num(b.ledger.total) - num(b.sheet.total);
      if (!delta) return '';
      return `${period === 'cur' ? 'Current' : 'Last'}: sheet <b>${fmt(b.sheet.total)}</b> vs tag ledger <b>${fmt(b.ledger.total)}</b> (Δ ${delta > 0 ? '+' : ''}${fmt(delta)})`;
    }).filter(Boolean).join(' · ');
  }
  /** 🎯 VC4 · VC20 · VC5+ — last month, current month aur stock ek hi table me, har cell clickable.
   *  Source bins `groupBinsFor()` se aate hain: GV TL me matched GV Master GV TL ID rows, otherwise
   *  legacy GV REPORT snapshot + tag mix; the source/reconciliation note names the path explicitly. */
  function groupTableHtml(pr, specs) {
    if (!pr) return '';
    const bins = groupBinsFor(pr);
    if (!bins) return '<p class="dim small">Class-group (VC4 · VC20 · VC5+) data abhi load nahi hua.</p>';
    const t = pr.totals || {}, s = pr.stock || {}, m = pr.months || {};
    const stock = bins.stock || {};
    const val = (period, group) => (bins[period] ? num(bins[period][group]) : null);
    const totalOf = (period) => {
      if (bins[period] && (bins[period].source || num(bins[period].total))) return num(bins[period].total);
      const sum = ['VC4', 'VC20', 'VC5+'].reduce((n, k) => n + (val(period, k) || 0), 0);
      return sum || num(period === 'cur' ? t.curTotal : t.lastTotal);
    };
    const stockTotal = num(stock.total) || num(s.total);
    const cell = (value, spec, title) => value === null
      ? '<td class="num dim">—</td>'
      : `<td class="num mp-drill" data-kpi="${esc(spec)}" role="button" tabindex="0" title="${esc(title)}">${fmt(value)}</td>`;
    const rowOf = (group, filter, label) => {
      const stockValue = ['VC4', 'VC20', 'VC5+'].includes(group) ? num(stock[group]) : null;
      return `<tr><td><b>${esc(label || group)}</b></td>
        ${cell(val('last', group), `${specs.last}&f=${filter}`, `${label || group} · last month issuance (din → tag)`)}
        ${cell(val('cur', group), `${specs.cur}&f=${filter}`, `${label || group} · current month issuance (din → tag)`)}
        ${cell(stockValue, `${specs.stock}${filter === 'comm' ? '' : `&f=${filter}`}`, `${label || group} · stock (barcode tak)`)}</tr>`;
    };
    const rows = [
      rowOf('VC4', 'vc4', 'VC4'),
      rowOf('VC20', 'vc20', 'VC20'),
      rowOf('VC5+', 'vc5p', 'VC5+'),
      `<tr class="row-total"><td><b>Total</b></td><td class="num"><b>${fmt(totalOf('last'))}</b></td><td class="num"><b>${fmt(totalOf('cur'))}</b></td><td class="num"><b>${fmt(stockTotal)}</b></td></tr>`
    ].join('');
    const src = (period) => {
      const b = bins[period];
      if (!b) return '';
      if (b.source === 'GV REPORT sheet') return b.mix === 'ledger-mix' ? 'GV REPORT sheet (VC4 + NVC4) · VC20/VC5+ ka batwara tag-ledger mix se' : 'GV REPORT sheet';
      if (b.source === 'GV Master · GV TL ID') return 'GV Master · GV TL ID (column R)';
      return b.source || 'tag ledger (EIR / GV Master)';
    };
    const notes = reconLine(bins);
    const usesTlMasterId = /-tl$/.test(pr.kind || '') && ['cur', 'last'].some((period) => bins[period] && bins[period].source === 'GV Master · GV TL ID');
    const sourceNote = usesTlMasterId ? ' TL issuance aur uske clicks GV Master ke GV TL ID (column R) se grouped hain; EIR aggregate is total me dobara nahi joda jata.' : '';
    return `<div class="table-wrap"><table class="tbl compact mp-group-tbl"><thead><tr><th>Class group</th><th class="num">${esc(monthLabel(m.last) || 'Last month')}</th><th class="num">${esc(monthLabel(m.cur) || 'This month')}</th><th class="num">Stock</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="dim small">Source — Last: ${src('last') || '—'} · Current: ${src('cur') || '—'} · Stock: Tag Assignment / StockDataa.${sourceNote}${notes ? ` <span class="mp-recon">${notes}</span>` : ''}</p>`;
  }

  /** 🆔 TL ID ke saath stock — TL apna + har agent alag-alag, sab clickable (TL ID hamesha sath).
   *  User rule: TL ka stock tab hi bharosemand hai jab pata ho kis ID ke paas kitna hai aur wo
   *  own ho ya agent ka — isliye ye section drawer me sabse neeche rehta hai. */
  function tlStockByIdHtml(pr) {
    if (!pr || !/-tl$/.test(String(pr.kind || ''))) return '';
    const ts = pr.tlStock || {}, s = pr.stock || {};
    const own = ts.own || null, ag = ts.agents || null;
    const tlId = (pr.tl && pr.tl.id) || pr.id || '';
    const rows = [];
    if (pr.selfAgent) rows.push({ ...pr.selfAgent, isSelf: true });
    rows.push(...(pr.agents || []));
    if (!rows.length && !own) return '';
    const stockLine = (a) => `<td class="num mp-drill" data-kpi="${esc(`src=${pr.ch}&scope=stock&agent=${encodeURIComponent(a.name)}${a.id ? `&agentId=${encodeURIComponent(a.id)}` : ''}`)}" role="button" tabindex="0" title="${esc(a.name)} · stock detail (class → barcode)">${fmt(a.stockVc4)}</td>
      <td class="num mp-drill" data-kpi="${esc(`src=${pr.ch}&scope=stock&agent=${encodeURIComponent(a.name)}${a.id ? `&agentId=${encodeURIComponent(a.id)}` : ''}`)}" role="button" tabindex="0" title="${esc(a.name)} · commercial stock">${fmt(a.stockComm)}</td>
      <td class="num mp-drill" data-kpi="${esc(`src=${pr.ch}&scope=stock&agent=${encodeURIComponent(a.name)}${a.id ? `&agentId=${encodeURIComponent(a.id)}` : ''}`)}" role="button" tabindex="0" title="${esc(a.name)} · total stock"><b>${fmt(a.stockTotal)}</b></td>`;
    const body = rows.map((a) => `<tr class="${a.isSelf ? 'mp-selfrow ' : ''}clickable" data-mp-agent="${esc(a.name)}" data-mp-kind="${pr.ch}-agent" data-mp-id="${esc(a.id || '')}" title="Click → ${esc(a.name)} ka 360 profile">
      <td>${a.isSelf ? '👤 ' : ''}<b>${esc(a.name)}</b>${a.isSelf ? '<span class="mp-tag-self">TL · apna stock</span>' : ''}</td>
      <td><small class="dim">${esc(a.id || '—')}</small></td>
      <td><small class="dim">${esc(tlId || '—')}</small></td>
      ${stockLine(a)}</tr>`).join('');
    const agentsOnly = (pr.agents || []);
    const agentsTotal = { vc4: num(ag && ag.vc4), comm: num(ag && ag.comm), total: num(ag && ag.total) };
    const ownTotal = own ? { vc4: num(own.vc4), comm: num(own.comm), total: num(own.total) } : null;
    const footRows = [
      agentsOnly.length ? `<tr class="row-total"><td colspan="3"><b>🧑‍💼 Agents ke paas (${fmt(agentsOnly.length)})</b></td><td class="num">${fmt(agentsTotal.vc4)}</td><td class="num">${fmt(agentsTotal.comm)}</td><td class="num"><b>${fmt(agentsTotal.total)}</b></td></tr>` : '',
      ownTotal ? `<tr class="mp-selfrow"><td colspan="3"><b>👤 TL ke paas (own)</b></td><td class="num">${fmt(ownTotal.vc4)}</td><td class="num">${fmt(ownTotal.comm)}</td><td class="num"><b>${fmt(ownTotal.total)}</b></td></tr>` : '',
      `<tr class="row-total"><td colspan="3"><b>= TL TOTAL · 🆔 ${esc(tlId || '—')}</b></td><td class="num"><b>${fmt(s.vc4)}</b></td><td class="num"><b>${fmt(s.comm)}</b></td><td class="num"><b>${fmt(s.total)}</b></td></tr>`
    ].filter(Boolean).join('');
    return `<section class="mp-sec" data-mp-sec="tlstock"><h4>🆔 TL ID-wise stock · ${esc(tlId || pr.name)} <span class="dim small">— kis ke paas kitna (own + agents)</span></h4>
      <p class="dim small">TL ka stock = TL ke paas (own) + agents ke paas. Har row par click → us agent ka 360 profile, stock cell par click → us ID ka stock (class → barcode tak).</p>
      <div class="table-wrap"><table class="tbl compact mp-tlid-tbl"><thead><tr><th>Naam</th><th>Agent ID</th><th>TL ID</th><th class="num">Stock VC4</th><th class="num">Stock Comm</th><th class="num">Stock total</th></tr></thead>
      <tbody>${body}</tbody><tfoot>${footRows}</tfoot></table></div></section>`;
  }

  /** 📦 Agent-wise × Class stock — TL ke har agent (aur TL ke apne) paas kis class ka kitna stock hai.
   *  Cell click → us agent ka us class ka stock (barcode rows tak). */
  function agentClassMatrix(pr) {
    const list = [...(pr.selfAgent ? [pr.selfAgent] : []), ...(pr.agents || [])].filter((a) => a.classStock && Object.keys(a.classStock).length);
    if (!list.length) return '';
    const clsSet = new Set();
    list.forEach((a) => Object.keys(a.classStock).forEach((c) => { if (num(a.classStock[c]) > 0) clsSet.add(c); }));
    const cols = [...clsSet].sort((x, y) => clsRank(x) - clsRank(y) || String(x).localeCompare(String(y)));
    if (!cols.length) return '';
    const colTot = (c) => U.sum(list, (a) => num(a.classStock[c]));
    const specOf = (a, c) => `src=${pr.ch}&scope=stock&agent=${encodeURIComponent(a.name)}${a.id ? `&agentId=${encodeURIComponent(a.id)}` : ''}${c ? `&cls=${encodeURIComponent(c)}` : ''}`;
    const body = list.map((a) => `<tr${a.isSelf ? ' class="mp-selfrow"' : ''}><td>${a.isSelf ? '👤 ' : ''}<b>${esc(a.name)}</b>${a.isSelf ? '<span class="mp-tag-self">TL · apna stock</span>' : ''}</td>${cols.map((c) => { const n = num(a.classStock[c]); return n ? `<td class="num mp-drill" data-kpi="${esc(specOf(a, c))}" role="button" tabindex="0" title="${esc(a.name)} · ${esc(c)} stock">${fmt(n)}</td>` : '<td class="num dim">·</td>'; }).join('')}<td class="num mp-drill" data-kpi="${esc(specOf(a, ''))}" role="button" tabindex="0"><b>${fmt(U.sum(cols, (c) => num(a.classStock[c])))}</b></td></tr>`).join('');
    const foot = `<tr class="row-total"><td>Total (upar ki rows)</td>${cols.map((c) => `<td class="num">${fmt(colTot(c))}</td>`).join('')}<td class="num">${fmt(U.sum(cols, colTot))}</td></tr>`;
    return `<h5 class="mp-subh" data-mp-sec="agentclass">📦 Agent-wise × Class stock <span class="dim small">· ${fmt(list.length)} rows · cell par click → barcode tak</span></h5><div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th>${cols.map((c) => `<th class="num">${esc(c)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
  }

  function html(pr) {
    if (!pr) return '';
    const isTl = /tl$/.test(pr.kind);
    const d = pr.dispatch || {}, s = pr.stock || {}, t = pr.totals || {}, ts = pr.tlStock || {};
    const tlStockLine = ts.own && ts.agents ? `Own ${fmt(ts.own.total)} + agents ${fmt(ts.agents.total)}` : '';
    const sg = sugBlock(pr);
    const m = pr.months || {};
    const cls = pr.classes || [];
    const g = groupSummary(cls);
    const noData = !pr.found ? `<div class="ms-empty small"><b>REPORT me is ${isTl ? 'TL' : 'agent'} ki row nahi mili</b><p class="dim">Performance / GV REPORT tab load hone ke baad poori profile aayegi (naam spelling bhi match honi chahiye).</p></div>` : '';
    const scopeParam = isTl ? `tl=${encodeURIComponent(pr.name)}` : `agent=${encodeURIComponent(pr.name)}${pr.id ? `&agentId=${encodeURIComponent(pr.id)}` : ''}`;
    const masterTlParam = isTl && (pr.stockTlId || pr.id) ? `&tlId=${encodeURIComponent(pr.stockTlId || pr.id)}` : '';
    const agentStockTlParam = !isTl && pr.tl && pr.tl.id ? `&tl=${encodeURIComponent(pr.tl.name || '')}&tlId=${encodeURIComponent(pr.tl.id)}` : '';
    const stockSpec = `src=${pr.ch}&scope=stock&${scopeParam}${isTl ? masterTlParam : agentStockTlParam}`;
    const tlStockSpec = !isTl && pr.tl && pr.tl.name
      ? `src=${pr.ch}&scope=stock&tl=${encodeURIComponent(pr.tl.name)}${pr.tl.id ? `&tlId=${encodeURIComponent(pr.tl.id)}` : ''}` : '';
    const curSpec = `src=${pr.ch}&scope=mtd&ym=${encodeURIComponent(m.cur || '')}&${scopeParam}${masterTlParam}`;
    const lastSpec = `src=${pr.ch}&scope=month&ym=${encodeURIComponent(m.last || '')}&${scopeParam}${masterTlParam}`;
    // v3.40 — har KPI/cell ki apni detail: card ka number == drawer ka number (`self=0` se TL ki apni row
    // agents ki list me se bahar rehti hai, isliye "Agents 2" par click 2 agents hi dikhayega).
    const peopleSpec = `src=${pr.ch}&scope=people&${isTl ? `tl=${encodeURIComponent(pr.name)}&self=0&sort=stock` : `agent=${encodeURIComponent(pr.name)}`}`;
    const split = pr.stockSplit || {};
    const ownBase = isTl ? stockSpec : tlStockSpec;
    const ownAgentsChips = ts.own && ts.agents && ownBase
      ? `<span class="mp-part own" data-kpi="${esc(`${ownBase}&part=own`)}" role="button" tabindex="0" title="Sirf TL ke paas (own) stock — click par wahin ki rows">Own ${fmt(ts.own.total)}</span> + <span class="mp-part team" data-kpi="${esc(`${ownBase}&part=team`)}" role="button" tabindex="0" title="Sirf agents ke paas stock — click par wahin ki rows">agents ${fmt(ts.agents.total)}</span>`
      : tlStockLine;
    const OWN_SRC = { detail: 'stock detail me TL ki APNI rows se', report: 'REPORT ki TL row se', 'snapshot-team': "sheet ke 'TL stock' total me se agents ka jod ghatane se" };
    const stockNote = isTl ? `<p class="mp-note stock">📦 <b>Stock ka hisaab</b> — TL ke paas <b>${fmt((ts.own || {}).total)}</b> + agents ke paas <b>${fmt((ts.agents || {}).total)}</b> = TL total <b>${fmt(s.total)}</b> (VC4 ${fmt(s.vc4)} · Commercial ${fmt(s.comm)}). Own ${esc(OWN_SRC[split.ownFrom] || 'TL ke paas abhi koi stock nahi')}; agents ka jod ${split.membersFrom === 'detail' ? 'stock detail rows' : 'REPORT agent rows'} se${split.rollupOwnRow ? ' · ⚠️ sheet me TL ki row poore team ka rollup thi, use ALAG se nahi joda (warna TL ka stock do baar judta)' : ''}${split.snapshot && split.snapshot.total ? ` · sheet ka "TL's stock" <b>${fmt(split.snapshot.total)}</b>${Math.abs(num(split.snapshot.total) - num(s.total)) <= 1 ? ' ✓ match' : ` (profile ${fmt(s.total)} — rows load hote hi set hoga)`}` : ''} <span class="dim">— koi double count nahi: own + agents = total.</span></p>` : '';
    const head = `<div class="mp-head">
      <span class="ms-avatar">${esc(pr.name.slice(0, 1).toUpperCase())}</span>
      <div class="mp-id"><b>${esc(pr.name)}</b><small>${esc(pr.channel)} · ${isTl ? 'Team Leader' : 'Agent'}${pr.id ? ` · ID ${esc(pr.id)}` : ''}${pr.direct ? ` · <span class="direct-chip">🚫 ${esc(pr.directLabel || 'Direct')}</span>` : ''}</small></div>
      <div class="mp-prio">${isTl && pr.priority ? `<span class="mp-linkish" data-kpi="${esc(`${peopleSpec}&level=${encodeURIComponent(pr.priority)}`)}" role="button" tabindex="0" title="${esc(pr.priority)} priority wale agents">${prioChip(pr.priority)}</span>` : prioChip(pr.priority)}${pr.commPriority ? `<small class="dim">Comm: ${esc(pr.commPriority)}</small>` : ''}</div>
    </div>
    <div class="mp-cells">
      ${cell(isTl ? 'TL mobile' : 'Mobile', mobileCell(pr.mobile))}
      ${isTl ? cell('Agents', `<span class="mp-linkish" data-kpi="${esc(peopleSpec)}" role="button" tabindex="0" title="In agents ki poori list">${fmt(pr.agentCount)} 👉</span>${pr.selfAgent ? '<small class="dim"> + TL (apna stock alag)</small>' : ''}`) : cell('TL', pr.direct ? `<span class="direct-chip">🚫 ${esc(pr.directLabel || 'Direct')}</span>` : esc((pr.tl && pr.tl.name) || '—'))}
      ${isTl ? '' : cell('TL ID', esc((pr.tl && pr.tl.id) || '—'))}
      ${isTl ? '' : cell("TL's mobile", mobileCell(pr.tl && pr.tl.mobile))}
      ${cell('Status', esc(pr.status || '—'))}
      ${cell('Last active', esc(pr.lastActive || '—'))}
      ${growthCell(pr)}
    </div>`;
    const kpis = `<div class="mp-kpis">
      ${pr.ch === 'gv' ? todayKpiHtml(pr, isTl) : ''}
      ${kpi(isTl ? 'TL stock (total)' : 'Agent stock', fmt(s.total), `${isTl && ownAgentsChips ? `${ownAgentsChips} · ` : ''}VC4 ${fmt(s.vc4)} · Commercial ${fmt(s.comm)}`, 'k1', stockSpec)}
      ${isTl ? '' : kpi('TL stock', ts.has ? fmt(ts.total) : '—', ts.has ? `${ownAgentsChips ? `${ownAgentsChips} · ` : ''}VC4 ${fmt(ts.vc4)} · Comm ${fmt(ts.comm)}` : (pr.direct ? 'Direct — koi TL nahi' : ''), 'k2', tlStockSpec)}
      ${kpi('Dispatch priority', prioChip(pr.priority), (pr.calc && pr.calc.total.cover != null ? `Cover ${fmt(pr.calc.total.cover, true)} din (all tags)` : (d.cover != null ? `Cover ${fmt(d.cover, true)} din` : '')) + (isTl ? ` · <span class="mp-linkish">agents ki list 👉</span>` : ''), 'k3', isTl ? peopleSpec : stockSpec)}
      ${kpi(pr.tagRequired ? `Tags required · VC4 · ${d.days} din` : `Suggested VC4 · ${d.days} din`, sg.vc4, `avg ${fmt(d.avgVc4, true)}/day × ${d.days} din${pr.tagRequired ? '' : ` · stock − ${fmt(s.vc4)}`}`, pr.tagRequired ? 'k7' : 'k4', `${curSpec}&group=VC4`)}
      ${kpi(pr.tagRequired ? 'Tags required · Comm.' : 'Suggested Commercial', sg.comm, `avg ${fmt(d.avgComm, true)}/day${pr.tagRequired ? '' : ` · stock − ${fmt(s.comm)}`}`, pr.tagRequired ? 'k7' : 'k5', `${curSpec}&group=COMM`)}
      ${kpi('Issued this month', fmt(t.curTotal), `VC4 ${fmt(t.curVc4)} · Comm ${fmt(t.curComm)}`, 'k6', curSpec)}
      ${kpi('Issued last month', fmt(t.lastTotal), `VC4 ${fmt(t.lastVc4)} · Comm ${fmt(t.lastComm)}`, 'k8', lastSpec)}
    </div>
    <p class="mp-note ${pr.tagRequired ? 'tag' : ''}">${sg.note}</p>${stockNote}`;
    // v3.44 — VC4 · VC20 · VC5+ teeno alag rows me (GV me sheet-first, FF me tag-ledger): har cell
    // apni detail kholta hai, aur sheet vs ledger ka farq neeche note me saaf likha rehta hai.
    const summary = groupTableHtml(pr, { cur: curSpec, last: lastSpec, stock: stockSpec });
    // 🧾 Class-table footer follows the selected period source: GV TL Master R when matched,
    // otherwise the existing GV REPORT/EIR fallback. Never show a headline total from one source
    // beside a contradictory tag sum from another without labeling the source/reconciliation.
    const groupBins = groupBinsFor(pr) || {};
    const sourceTotal = (period) => {
      const source = groupBins[period] && groupBins[period].source;
      return source === 'GV REPORT sheet' || source === 'GV Master · GV TL ID' ? num(groupBins[period].total) : null;
    };
    const footOf = (period) => {
      const sourced = sourceTotal(period);
      return { value: sourced === null ? num(period === 'cur' ? g.total.cur : g.total.last) : sourced,
        fromSheet: groupBins[period] && groupBins[period].source === 'GV REPORT sheet',
        fromTlMaster: groupBins[period] && groupBins[period].source === 'GV Master · GV TL ID' };
    };
    const footLast = footOf('last'), footCur = footOf('cur');
    const footSourceLabel = (footLast.fromTlMaster || footCur.fromTlMaster) ? ' <small class="dim">(GV Master · TL ID)</small>'
      : (footLast.fromSheet || footCur.fromSheet) ? ' <small class="dim">(sheet)</small>' : '';
    const clsRecon = reconLine(groupBins);
    const clsNote = clsRecon ? `<p class="dim small">📑 Class rows tag-ledger (EIR / GV Master) se aate hain — GV REPORT me sirf VC4 + NVC4 hota hai. Upar <b>Issuance summary</b> me source ke hisaab se total final hai. <span class="mp-recon">${clsRecon}</span></p>` : '';
    const clsTable = cls.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">${esc(monthLabel(m.last) || 'Last month')}</th><th class="num">${esc(monthLabel(m.cur) || 'This month')}</th><th class="num">Growth</th><th class="num">Stock</th></tr></thead><tbody>
      ${cls.map((r) => `<tr class="clickable" data-kpi="${esc(`${r.cur > 0 ? curSpec : lastSpec}&cls=${encodeURIComponent(r.cls)}`)}"><td><b>${esc(r.cls)}</b></td><td class="num">${fmt(r.last)}</td><td class="num">${fmt(r.cur)}</td><td class="num">${r.last ? U.pctHtml(((r.cur - r.last) / r.last) * 100) : '—'}</td><td class="num">${fmt(r.stock)}</td></tr>`).join('')}
      </tbody><tfoot><tr class="row-total"><td>Total${footSourceLabel}</td><td class="num">${fmt(footLast.value)}</td><td class="num">${fmt(footCur.value)}</td><td class="num">${footLast.value ? U.pctHtml(((footCur.value - footLast.value) / footLast.value) * 100) : '—'}</td><td class="num">${fmt(g.total.stock)}</td></tr></tfoot></table></div>${clsNote}` : '<p class="dim small">Class-wise data abhi load nahi hua.</p>';
    const agentsTable = isTl ? tlAgentsTable(pr) : '';
    const tlIdStockTable = isTl ? tlStockByIdHtml(pr) : '';
    const isTlStockVisible = !!tlIdStockTable;
    const actions = `<div class="mp-actions"><button class="btn small primary" data-mp-pdf>📄 PDF</button><button class="btn small" data-mp-csv>⬇ CSV</button><button class="btn small" data-mp-copy>📋 Copy</button><button class="btn small" data-mp-wa>📲 WhatsApp</button>${isTl ? '' : `<button class="btn small" data-mp-a360="${esc(pr.name)}">👁 Agent 360</button>`}<a class="btn small" href="#/masterStock?q=${encodeURIComponent(pr.name)}">🗄️ Register / tags</a></div>`;
    const partial = pr.partial ? '<div class="mp-partial dim small" role="status">⏳ Kuch data abhi load ho raha hai (Google Sheet slow hai) — numbers poore hote hi apne aap update ho jayenge.</div>' : '';
    const nav = `<nav class="mp-nav" aria-label="Report sections"><span class="dim small">Jao:</span>${[['kpis', '📦 Stock · KPI'], ['issuance', '🧾 Last vs Current'], ['class', '🎯 Class-wise'], ...(isTl && agentsTable ? [['agents', '🧑‍💼 Agents'], ['agentclass', '📦 Agent × Class']] : []), ...(isTl && isTlStockVisible ? [['tlstock', '🆔 TL ID stock']] : []), ['charts', '📊 Charts']].map(([k, l]) => `<button type="button" class="chip" data-mp-go="${k}">${l}</button>`).join('')}</nav>`;
    return `<div class="mp">${partial}${noData}${head}${nav}<div data-mp-sec="kpis">${kpis}</div>
      ${calcHtml(pr)}
      ${growthHtml(pr)}
      <section class="mp-sec" data-mp-sec="issuance"><h4>🧾 Issuance summary${isTl ? ' — TL total' : ''}</h4>${summary}</section>
      <section class="mp-sec" data-mp-sec="class"><h4>🎯 Issuance class-wise · last month vs this month + stock</h4>${clsTable}</section>
      ${agentsTable}
      ${tlIdStockTable}
      <section class="mp-sec" data-mp-sec="charts"><h4>📊 Charts</h4>${chartsHtml(pr) || '<p class="dim small">Chart ke liye data nahi mila.</p>'}</section>
      ${actions}</div>`;
  }

  // ------------------------------------------------------------------ export / share
  /** CSV / WhatsApp / PDF me bhi wahi hisaab jo drawer me dikhta hai: TL ki apni row ALAG (agents ke jod
   *  me nahi), phir reconcile footer — "own + agents = TL total". Exports aur screen par number alag na ho. */
  function tlExport(pr) {
    const ts = pr.tlStock || {}, s = pr.stock || {}, t = pr.totals || {}, d = pr.dispatch || {};
    const own = ts.own || { vc4: 0, comm: 0, total: 0 }, ag = ts.agents || { vc4: 0, comm: 0, total: 0 };
    const rows = (pr.agents || []).slice();
    const selfA = pr.selfAgent || null;
    return {
      own, ag, s, t, d, rows, selfA, list: selfA ? [selfA, ...rows] : rows,
      sum: (k) => U.sum(rows, (a) => num(a[k])),
      line: `TL ke paas (own) ${fmt(own.total)} + agents ke paas ${fmt(ag.total)} = TL total ${fmt(s.total)}`,
      foot: `Hisaab: TL ki apni row agents ke jod me ALAG dikhi hai — TL ka stock do baar nahi judta.`
    };
  }
  function csvRows(pr) {
    const d = pr.dispatch || {}, s = pr.stock || {}, t = pr.totals || {}, ts = pr.tlStock || {}, p = pr.projT1 || {}, b = p.basis || {};
    const g = groupSummary(pr.classes || []);
    const rows = [['Name', pr.name], ['Type', `${pr.channel} ${/tl$/.test(pr.kind) ? 'TL' : 'Agent'}`], ['ID', pr.id], ['Mobile', canContacts() ? pr.mobile : ''], ['TL', (pr.tl && pr.tl.name) || ''], ['TL ID', (pr.tl && pr.tl.id) || ''], ["TL's mobile", canContacts() ? (pr.tl && pr.tl.mobile) || '' : ''],
      ['Status', pr.status], ['Last active', pr.lastActive], ['Priority', pr.priority], ['Direct agent', pr.direct ? pr.directLabel : 'No'], ['Tag required', pr.tagRequired ? 'YES' : 'No'],
      ['Growth % (REPORT)', pr.growthNum === null || pr.growthNum === undefined ? '' : Number(pr.growthNum.toFixed(1))], ['Data till (run-rate basis)', b.label || ''],
      ['Expected month-end', p.total || ''], ['Expected month-end · sheet', p.sheet || ''],
      ['Stock VC4', s.vc4], ['Stock Commercial', s.comm], ['Stock total', s.total], ['TL stock total', ts.has ? ts.total : ''],
      ...(ts.own && ts.agents ? [['TL own stock (TL ke paas)', ts.own.total], ['TL agents stock (agents ke paas)', ts.agents.total], ['Stock formula', 'own + agents = TL total (koi double count nahi)']] : []),
      ['Stock hisaab (source)', (/tl$/.test(pr.kind) && pr.stockSplit ? `${pr.stockSplit.ownFrom || 'none'}${pr.stockSplit.rollupOwnRow ? ' · report TL row = team rollup (alag se nahi joda)' : ''}` : '')],
      ['Run-rate basis', `issued ÷ ${(pr.calc && pr.calc.total.elapsed) || ''} din (${U.basisText(pr.ch, b)})`], ['Avg VC4/day', d.avgVc4], ['Suggested VC4' + (pr.tagRequired ? ' (tags)' : '') + ' · stock ke baad (net)', d.sugVc4], ['Suggested VC4 · bina stock (gross)', d.sugVc4Gross || 0], ['Suggested Commercial' + (pr.tagRequired ? ' (tags)' : '') + ' · stock ke baad (net)', d.sugComm], ['Suggested Commercial · bina stock (gross)', d.sugCommGross || 0],
      ['Total run-rate/day', pr.calc ? pr.calc.total.rate : ''], ['Total required (× days)', pr.calc ? pr.calc.total.required : ''], ['Total dispatch WITH stock', pr.calc ? pr.calc.total.net : ''], ['Total dispatch W/O stock', pr.calc ? pr.calc.total.gross : ''], ['Total cover (days)', pr.calc && pr.calc.total.cover != null ? pr.calc.total.cover : ''], ['Issued this month', t.curTotal], ['Issued last month', t.lastTotal], ['', ''], ['Class', `${(pr.months || {}).last || 'Last'} | ${(pr.months || {}).cur || 'This'} | Stock`]];
    (pr.classes || []).forEach((r) => rows.push([r.cls, r.last, r.cur, r.stock]));
    rows.push(['GRAND TOTAL', g.total.last || t.lastTotal || 0, g.total.cur || t.curTotal || 0, g.total.stock || s.total || 0]);
    const E = tlExport(pr);
    if (E.list.length) {
      rows.push(['', '']);
      rows.push(['Agent', 'ID', 'Mobile', 'Priority', 'VC4 stock', 'Comm stock', 'Last', 'This', 'Sug VC4 (stock −)', 'Sug VC4 (bina stock)', 'Sug Comm (stock −)', 'Sug Comm (bina stock)']);
      E.list.forEach((a) => rows.push([a.isSelf ? `👤 ${a.name} (TL ka apna stock — agents ke jod me nahi)` : a.name, a.id, canContacts() ? a.mobile : '', a.priority, a.stockVc4, a.stockComm, a.last, a.cur, a.sugVc4, a.sugVc4Gross || 0, a.sugComm, a.sugCommGross || 0]));
      rows.push(['AGENTS TOTAL', `${E.rows.length} Agents`, '', '', E.sum('stockVc4'), E.sum('stockComm'), E.sum('last'), E.sum('cur'), d.sumAgentVc4 || 0, d.sumAgentVc4Gross || 0, d.sumAgentComm || 0, d.sumAgentCommGross || 0]);
      rows.push(['+ TL KE PAAS (OWN)', E.selfA ? 'TL ki apni row' : 'sheet ke snapshot se', '', '', E.own.vc4, E.own.comm, '', '', d.sumSelfVc4 || 0, d.sumSelfVc4Gross || 0, d.sumSelfComm || 0, d.sumSelfCommGross || 0]);
      rows.push(['= TL TOTAL', pr.name, '', '', E.s.vc4, E.s.comm, E.t.lastTotal, E.t.curTotal, d.sugVc4 || 0, d.sugVc4Gross || 0, d.sugComm || 0, d.sugCommGross || 0]);
    }
    return rows;
  }
  function waText(pr) {
    const d = pr.dispatch || {}, s = pr.stock || {}, t = pr.totals || {}, ts = pr.tlStock || {}, p = pr.projT1 || {}, b = p.basis || {};
    const g = groupSummary(pr.classes || []);
    const lines = [`*${pr.name}* (${pr.channel} ${/tl$/.test(pr.kind) ? 'TL' : 'Agent'}${pr.id ? ` · ${pr.id}` : ''})`];
    if (canContacts() && pr.mobile) lines.push(`📞 ${pr.mobile}`);
    if (!/tl$/.test(pr.kind) && pr.tl && pr.tl.name && !pr.direct) lines.push(`TL: ${pr.tl.name}`);
    lines.push(`Priority: ${pr.priority || '—'}${pr.tagRequired ? ' · 🏷️ TAG REQUIRED' : ''}`);
    lines.push(`Stock: ${U.fmt(s.total)}${ts.own && ts.agents ? ` (TL ke paas ${U.fmt(ts.own.total)} + agents ke paas ${U.fmt(ts.agents.total)} — TL ki row alag, double count nahi)` : ''} (VC4 ${U.fmt(s.vc4)} · Comm ${U.fmt(s.comm)})`);
    if (pr.growthNum !== null && pr.growthNum !== undefined) lines.push(`📈 Growth: ${pr.growthNum >= 0 ? '+' : ''}${pr.growthNum.toFixed(1)}%${b.shortLabel ? ` (till ${b.shortLabel})` : ''} · expected month-end ${U.fmt(p.total)}`);
    lines.push(`${pr.tagRequired ? 'Tags needed' : 'Suggested dispatch'} (${d.days} din): VC4 ${U.fmt(d.sugVc4)} · Comm ${U.fmt(d.sugComm)} — stock ke baad`);
    lines.push(`Bina stock ghataye: VC4 ${U.fmt(d.sugVc4Gross || 0)} · Comm ${U.fmt(d.sugCommGross || 0)}`);
    if (pr.calc) lines.push(`Run-rate ${U.fmt(pr.calc.total.rate, true)}/day (÷ ${pr.calc.total.elapsed} din) · All tags: with stock ${U.fmt(pr.calc.total.net)} · w/o stock ${U.fmt(pr.calc.total.gross)}${pr.calc.total.cover != null ? ` · cover ${U.fmt(pr.calc.total.cover, true)} din` : ''}`);
    lines.push(`Issued: this month ${U.fmt(t.curTotal)}${b.shortLabel ? ` (till ${b.shortLabel})` : ''} · last month ${U.fmt(t.lastTotal)}`);
    (pr.classes || []).slice(0, 12).forEach((r) => lines.push(`• ${r.cls}: ${U.fmt(r.last)} → ${U.fmt(r.cur)} (stock ${U.fmt(r.stock)})`));
    lines.push(`*Total Class-wise: Last ${U.fmt(g.total.last || t.lastTotal)} → MTD ${U.fmt(g.total.cur || t.curTotal)} (Stock ${U.fmt(g.total.stock || s.total)})*`);
    const E = tlExport(pr);
    if (E.list.length) {
      lines.push('', `*Team Agents (${U.fmt(E.rows.length)}):*`);
      E.list.slice(0, 22).forEach((a) => lines.push(`${a.isSelf ? '👤' : '•'} ${a.name}${a.isSelf ? ' — TL ka apna stock' : ''}: Last ${U.fmt(a.last)} · MTD ${U.fmt(a.cur)} · Stock ${U.fmt(a.stockTotal)}`));
      lines.push(`*Agents total: Last ${U.fmt(E.sum('last'))} · MTD ${U.fmt(E.sum('cur'))} · Stock ${U.fmt(E.ag.total)}*`);
      lines.push(`*${E.line}*`);
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
      { label: /tl$/.test(pr.kind) ? 'Stock in Hand (TL + agents)' : 'Stock in Hand', value: fmt(s.total), sub: `${pr.tlStock && pr.tlStock.own && pr.tlStock.agents ? `Own ${fmt(pr.tlStock.own.total)} + agents ${fmt(pr.tlStock.agents.total)} · ` : ''}VC4 ${fmt(s.vc4)} · Comm ${fmt(s.comm)}`, color: '#d97706' }
    ]);
    doc.section(`Class-wise Issuance (${m.last || 'Last'} vs ${m.cur || 'MTD'}) & Stock`);
    doc.table({
      headers: ['Class', m.last || 'Last Month', m.cur || 'Current (MTD)', 'Growth %', 'Stock in Hand'],
      align: ['left', 'right', 'right', 'right', 'right'],
      rows: (pr.classes || []).map((c) => [c.cls, fmt(c.last), fmt(c.cur), c.last ? `${(((c.cur - c.last) / c.last) * 100).toFixed(0)}%` : '—', fmt(c.stock)]),
      foot: ['GRAND TOTAL', fmt(g.total.last || t.lastTotal), fmt(g.total.cur || t.curTotal), (g.total.last || t.lastTotal) ? `${((((g.total.cur || t.curTotal) - (g.total.last || t.lastTotal)) / (g.total.last || t.lastTotal)) * 100).toFixed(0)}%` : '—', fmt(g.total.stock || s.total)]
    });
    const E = tlExport(pr);
    if (E.list.length) {
      doc.section(`Team Agents (${fmt(E.rows.length)})${E.selfA ? ' · TL ka apna stock alag row me' : ''}`, E.line);
      doc.table({
        headers: ['Agent', 'ID', 'Priority', 'Last Month', 'Current (MTD)', 'VC4 Stock', 'Comm Stock', 'Total Stock'],
        align: ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'right'],
        rows: E.list.map((a) => [a.isSelf ? `👤 ${a.name} (TL — apna stock)` : a.name, a.id || '—', a.priority || '—', fmt(a.last), fmt(a.cur), fmt(a.stockVc4), fmt(a.stockComm), fmt(a.stockTotal)]),
        foot: ['= TL TOTAL (own + agents)', `${fmt(E.rows.length)} Agents`, '', fmt(E.t.lastTotal), fmt(E.t.curTotal), fmt(E.s.vc4), fmt(E.s.comm), fmt(E.s.total)]
      });
      if (E.own.total || E.selfA) doc.text(`${E.line} — ${E.foot}`, { size: 3 });
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
      const go = e.target.closest('[data-mp-go]');
      if (go) {
        const root = go.closest('.mp') || el;
        const target = root.querySelector(`[data-mp-sec="${go.dataset.mpGo}"]`);
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const a360 = e.target.closest('[data-mp-a360]');
      if (a360) { if (FF.cockpit && FF.cockpit.agent360) FF.cockpit.agent360({ name: a360.dataset.mpA360 }).catch(() => {}); return; }
      const row = e.target.closest('[data-mp-agent]');
      // v3.40 — row ke andar [data-kpi] wale cell (stock / footer) par click = us hisse ki detail drawer
      // (app.js ka global handler), profile switch nahi — warna drawer aur profile do kaam ek saath.
      if (row && !e.target.closest('[data-kpi]')) open({ kind: row.dataset.mpKind, name: row.dataset.mpAgent, sub: row.dataset.mpId, tlSet: new Set(), classMap: new Map(), bars: new Set() });
    });
  }
  const loadingHtml = (name) => `<div class="mp-loading" role="status" aria-live="polite">${U.loader ? U.loader('', { size: 'md' }) : ''} <span><b>${esc(name)}</b> ki poori report ban rahi hai${U.ellipsis ? U.ellipsis() : '…'} <small class="dim">(REPORT + stock + issuance load ho raha hai)</small></span></div>`;
  /** Inline (home / panel) — placeholder pehle, data aane par full profile. */
  async function renderInto(el, person) {
    if (!el || !supports(person)) return null;
    el.innerHTML = loadingHtml(person.name);
    try {
      const paint = (profile) => { el.innerHTML = html(profile); if (FF.charts && FF.charts.mount) FF.charts.mount(el); bind(el, profile); };
      const pr = await buildSoon(person, (late) => { if (el.isConnected) paint(late); });
      paint(pr);
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
      // Slot hi bharo (neeche ka ageing section bacha rahe) · user dusra drawer khol chuka ho to overwrite mat karo.
      const paint = (profile) => {
        const body = U.$('#drawer-body');
        if (!body || !slot || !slot.isConnected) return;
        slot.innerHTML = html(profile);
        if (FF.charts && FF.charts.mount) FF.charts.mount(body);
        bind(body, profile);
      };
      const pr = await buildSoon(person, paint);
      paint(pr);
      return pr;
    } catch (err) {
      if (slot) slot.innerHTML = `<div class="ms-empty small"><b>Profile nahi ban payi</b><p class="dim">${esc(err && err.message || err)}</p></div>`;
      return null;
    }
  }

  // ------------------------------------------------------------------ 📊 Search issuance cards (Last · Current · VC4 · VC20 · VC5+)
  function issuancePresentation(pr) {
    if (!pr) return null;
    const t = pr.totals || {};
    const curYm = (pr.months && pr.months.cur) || U.ymKey(new Date());
    const lastYm = (pr.months && pr.months.last) || U.prevMonthKey(curYm);
    const elapsed = Math.max(1, num(pr.projT1 && pr.projT1.days) || U.runRateDays(undefined, pr.ch === 'gv' ? 'gv' : 'ff'));
    const bins = pr.classBins || { cur: blankIssueBins(), last: blankIssueBins(), available: {} };
    // 📑 GV TL with a matched Master identity uses GV Master GV TL ID rows for totals and class groups;
    // other GV profiles keep sheet-first fallbacks. FF continues using the First Forward EIR ledger.
    const groups = pr.groupBins || null;
    const usableBins = (g) => !!(g && (g.source || num(g.total) || num(g.VC4) || num(g.VC20) || num(g['VC5+'])));
    const periodValue = (period, group) => usableBins(groups && groups[period])
      ? num(groups[period][group])
      : (bins.available && bins.available[period] ? num((bins[period] || {})[group]) : null);
    const currentTotal = t.curTotal === null || t.curTotal === undefined ? null : Number(t.curTotal);
    const lastTotal = t.lastTotal === null || t.lastTotal === undefined ? null : Number(t.lastTotal);
    const expected = (value, ym) => value === null || !Number.isFinite(Number(value)) ? null : U.projectMonthEnd(Number(value), elapsed, ym);
    const curGroups = Object.fromEntries(ISSUE_GROUPS.map((group) => [group, periodValue('cur', group)]));
    const lastGroups = Object.fromEntries(ISSUE_GROUPS.map((group) => [group, periodValue('last', group)]));
    const sources = pr.issuanceSources || {};
    return {
      __issuancePresentation: true,
      kind: pr.kind || '', ch: pr.ch || (/^gv/.test(pr.kind || '') ? 'gv' : 'ff'),
      isTl: /-tl$/.test(pr.kind || ''), name: pr.name || '', id: pr.id || '',
      months: { cur: curYm, last: lastYm },
      current: {
        total: currentTotal,
        vc4: t.curVc4 === null || t.curVc4 === undefined ? null : Number(t.curVc4),
        comm: t.curComm === null || t.curComm === undefined ? null : Number(t.curComm),
        expected: pr.projT1 && Number.isFinite(Number(pr.projT1.total)) ? Number(pr.projT1.total) : expected(currentTotal, curYm),
        runRate: currentTotal === null ? null : currentTotal / elapsed
      },
      last: {
        total: lastTotal,
        vc4: t.lastVc4 === null || t.lastVc4 === undefined ? null : Number(t.lastVc4),
        comm: t.lastComm === null || t.lastComm === undefined ? null : Number(t.lastComm)
      },
      classes: Object.fromEntries(ISSUE_GROUPS.map((group) => [group, {
        cur: curGroups[group], last: lastGroups[group], expected: curGroups[group] === null ? null : expected(curGroups[group], curYm)
      }])),
      reconciliation: {
        cur: bins.available && bins.available.cur && currentTotal !== null ? { report: currentTotal, ledger: num(bins.cur.total), delta: num(bins.cur.total) - currentTotal, mix: (groups && groups.cur && groups.cur.mix) || '' } : null,
        last: bins.available && bins.available.last && lastTotal !== null ? { report: lastTotal, ledger: num(bins.last.total), delta: num(bins.last.total) - lastTotal, mix: (groups && groups.last && groups.last.mix) || '' } : null
      },
      groups,
      runRateDays: elapsed,
      runRateThrough: (pr.projT1 && pr.projT1.basis && (pr.projT1.basis.shortLabel || pr.projT1.basis.label)) || '',
      sources: {
        cur: sources.cur || (pr.ch === 'gv' ? 'GV Master / EIR' : 'First Forward EIR'),
        last: sources.last || (pr.ch === 'gv' ? 'GV Master / EIR' : 'First Forward EIR'),
        classes: sources.classes || (pr.ch === 'gv' ? 'GV Master / EIR class mix' : 'First Forward EIR class mix'),
        stock: sources.stock || (pr.ch === 'gv' ? 'GV REPORT / Tag Assignment' : 'FF REPORT / StockDataa')
      }
    };
  }
  function issuanceCardsHtml(value) {
    const m = value && value.__issuancePresentation ? value : issuancePresentation(value);
    if (!m) return '';
    const fmtMaybe = (n) => n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : fmt(Number(n));
    const who = m.isTl ? `tl=${encodeURIComponent(m.name)}${m.id ? `&tlId=${encodeURIComponent(m.id)}` : ''}` : `agent=${encodeURIComponent(m.name)}${m.id ? `&agentId=${encodeURIComponent(m.id)}` : ''}`;
    const spec = (period, group) => `src=${m.ch}&scope=${period === 'last' ? 'month' : 'mtd'}&ym=${encodeURIComponent(period === 'last' ? m.months.last : m.months.cur)}&${who}${group ? `&f=${group}` : ''}`;
    const mixText = (period) => {
      const groupValues = ISSUE_GROUPS.map((group) => m.classes[group][period]);
      return groupValues.some((v) => v !== null)
        ? `VC4 ${fmtMaybe(groupValues[0])} · VC20 ${fmtMaybe(groupValues[1])} · VC5+ ${fmtMaybe(groupValues[2])}`
        : `VC4 ${fmtMaybe(period === 'last' ? m.last.vc4 : m.current.vc4)} · Comm ${fmtMaybe(period === 'last' ? m.last.comm : m.current.comm)}`;
    };
    const card = (tone, label, valueText, sub, foot, kpiSpec, extra = '') => `<div class="ms-issuance-card ${tone}${kpiSpec ? ' is-drill' : ''}"${kpiSpec ? ` data-kpi="${esc(kpiSpec)}" data-kpi-title="${esc(label.replace(/<[^>]*>/g, ''))}" data-kpi-value="${esc(valueText)}" role="button" tabindex="0" title="${esc(`${label.replace(/<[^>]*>/g, '')} · detail kholo`)}"` : ''}>
      <div class="ms-issuance-card-head"><span>${label}</span><span class="ms-issuance-icon">${extra}</span></div>
      <b class="ms-issuance-value">${valueText}</b>
      <small class="ms-issuance-sub">${sub}</small>
      ${foot ? `<span class="ms-issuance-foot">${foot}</span>` : ''}
    </div>`;
    const curRate = m.current.runRate === null ? '—' : fmt(m.current.runRate, true);
    const through = m.runRateThrough ? ` · data ${esc(m.runRateThrough)}` : '';
    const classes = [
      ['VC4', 'vc4', '🚗'], ['VC20', 'vc20', '🛻'], ['VC5+', 'vc5p', '🚚']
    ].map(([label, group, icon]) => {
      const v = m.classes[label];
      const expectedText = v.expected === null ? '—' : fmtMaybe(v.expected);
      const curText = v.cur === null ? '—' : fmtMaybe(v.cur);
      const lastText = v.last === null ? '—' : fmtMaybe(v.last);
      const foot = `<span class="ms-issuance-expected">🎯 Expected in month <b>${expectedText}</b></span><span>Last ${esc(monthLabel(m.months.last))}: <b>${lastText}</b></span>`;
      return card(`class-${group}`, `<b>${label}</b>`, curText, `Current MTD · ${esc(monthLabel(m.months.cur))}`, foot, v.cur === null ? '' : spec('cur', group), icon);
    }).join('');
    const totalLast = card('last', '⏮ Last month', fmtMaybe(m.last.total), `${esc(monthLabel(m.months.last))} · ${mixText('last')}`, 'Pichhle mahine ka actual issuance', spec('last', ''), '📅');
    const totalCur = card('current', '▶ Current month · MTD', fmtMaybe(m.current.total), `${esc(monthLabel(m.months.cur))} · ${mixText('cur')}`, `<span class="ms-issuance-expected">🎯 Expected in month <b>${fmtMaybe(m.current.expected)}</b></span><span>Run-rate <b>${curRate}/day</b>${through}</span>`, spec('cur', ''), '⚡');
    const isGvTl = m.isTl && m.ch === 'gv';
    const reconciled = (period, label) => {
      const r = m.reconciliation && m.reconciliation[period];
      if (!isGvTl || !r || !/^GV REPORT/.test(m.sources[period] || '')) return '';
      const delta = `${r.delta > 0 ? '+' : ''}${fmt(r.delta)}`;
      return `${label}: ${fmt(r.report)} report vs ${fmt(r.ledger)} ledger (Δ ${delta})`;
    };
    const reconciliation = [reconciled('last', 'Last'), reconciled('cur', 'Current')].filter(Boolean).join(' · ');
    const masterAttributionNote = isGvTl && ['cur', 'last'].some((period) => m.sources[period] === 'GV Master · GV TL ID')
      ? ' Where source is GV Master · GV TL ID, GV Master column R is the attribution key; EIR grouped totals are not added again.' : '';
    const srcLine = isGvTl
      ? `TL Last/Current totals: <b>${esc(m.sources.last)} / ${esc(m.sources.cur)}</b> · stock: <b>${esc(m.sources.stock)}</b> · VC4 / VC20 / VC5+ class mix: <b>${esc(m.sources.classes)}</b>.${masterAttributionNote}${reconciliation ? ` <span class="ms-issuance-recon">${esc(reconciliation)}</span>` : ''}`
      : `Source: <b>${esc(m.sources.cur)}</b> · class mix: <b>${esc(m.sources.classes)}</b>.`;
    return `<section class="ms-issuance-board" aria-label="Last month, current month and class-wise issuance">
      <div class="ms-issuance-title"><div><b>📊 Issuance &amp; month-end pace</b><small>${esc(monthLabel(m.months.last))} → ${esc(monthLabel(m.months.cur))} · expected = current run-rate × month days</small></div><span class="ms-issuance-pill">${m.isTl ? 'TL roll-up' : 'Agent'} · ${m.ch === 'gv' ? '🟩 GV' : '🟦 FF'}</span></div>
      <div class="ms-issuance-grid">${totalLast}${totalCur}${classes}</div>
      <p class="ms-issuance-source">${srcLine} ${m.isTl && m.ch === 'gv' ? 'TL totals are deduplicated from GV REPORT; class mix is taken from the tag ledger, so a sheet refresh gap is called out rather than hidden.' : 'Expected values are projections, not issued tags.'}</p>
    </section>`;
  }

  // ------------------------------------------------------------------ 📊 REPORT data table (v3.43)
  /**
   * Ek person ka "REPORT data" row — Home search ki data table AUR FF/GV Agent-TL Summary ki
   * list table DONO isi se banti hain → teeno jagah numbers SAME (user rule).
   *   • FF → REPORT tab (performance path) · GV → GV REPORT tab
   *   • TL rows = own + agents rollup — quick()/build() ke wahi totals jo Summary KPI cards me
   *     dikhte hain (yahan dobara calculate nahi hota, isliye drift nahi hota)
   *   • quick() me row na ho to caller ka `fallback` (list ke cur/last/stock) — `found:false` ke saath.
   */
  const rnum = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d === undefined ? 0 : d); };
  function reportDataRow(person, fallback) {
    const p = person || {};
    const fb = fallback || {};
    const kind = p.kind || 'ff-agent';
    const ch = /^gv/.test(kind) ? 'gv' : 'ff';
    const isTl = /-tl$/.test(kind);
    let q = null;
    if (p.name) { try { q = quick({ kind, name: p.name, sub: p.id || p.sub || '', tlSet: p.tlSet || new Set(), classMap: new Map(), bars: new Set() }); } catch { q = null; } }
    const t = (q && q.totals) || {}, s = (q && q.stock) || {}, ts = (q && q.tlStock) || {};
    const pick = (qv, fv) => (q && qv !== undefined && qv !== null && Number.isFinite(Number(qv)) ? Number(qv) : rnum(fv));
    const cur = pick(t.curTotal, fb.cur), curVc4 = pick(t.curVc4, fb.curVc4), curComm = pick(t.curComm, fb.curComm);
    const last = pick(t.lastTotal, fb.last), lastVc4 = pick(t.lastVc4, fb.lastVc4), lastComm = pick(t.lastComm, fb.lastComm);
    const stock = pick(s.total, fb.stock), stockVc4 = pick(s.vc4, fb.stockVc4), stockComm = pick(s.comm, fb.stockComm);
    const direct = !!(q && q.direct) || !!p.direct || !!fb.direct;
    const tlName = isTl ? '' : ((q && q.tl && q.tl.name) || p.tl || fb.tlName || '');
    const tlId = isTl ? '' : ((q && q.tl && q.tl.id) || p.tlId || fb.tlId || '');
    const tlLabel = isTl ? '' : (direct ? ((q && q.directLabel) || p.directLabel || 'Direct (no TL)') : tlName);
    let growth = q && Number.isFinite(Number(q.growthNum)) ? Number(q.growthNum) : (fb.growth != null ? rnum(fb.growth, null) : null);
    if (growth === null || !Number.isFinite(growth)) growth = U.growth(cur, last);
    return {
      kind, ch, isTl, name: p.name || '', id: (q && q.id) || p.id || p.sub || fb.id || '',
      mobile: (q && q.mobile) || p.mobile || fb.mobile || '',
      priority: (q && q.priority) || p.priority || fb.priority || '',
      status: (q && q.status) || p.status || fb.status || '',
      direct, directLabel: (q && q.directLabel) || p.directLabel || '', tlName, tlId, tlLabel,
      stock, stockVc4, stockComm, cur, curVc4, curComm, last, lastVc4, lastComm, growth,
      curYm: (q && q.months && q.months.cur) || fb.curYm || '',
      lastYm: (q && q.months && q.months.last) || fb.lastYm || '',
      issuance: q ? issuancePresentation(q) : null,
      // TL rollup detail (TL row = own + agents — "total issuance with TL / stock same" rule)
      ownStock: ts.own && Number.isFinite(Number(ts.own.total)) ? Number(ts.own.total) : null,
      agentsStock: ts.agents && Number.isFinite(Number(ts.agents.total)) ? Number(ts.agents.total) : null,
      agentCount: q && Number.isFinite(Number(q.agentCount)) ? Number(q.agentCount) : rnum(fb.agentCount, 0),
      found: !!q
    };
  }
  /** dataset round-trip — table row ⇄ person object. */
  const rowEncode = (r) => `${r.kind}|${encodeURIComponent(r.name || '')}|${encodeURIComponent(r.id || '')}`;
  function personFromRow(el) {
    const tr = el && el.closest ? el.closest('[data-mppt-row]') : (el && el.dataset ? el : null);
    if (!tr || !tr.dataset) return null;
    const parts = String(tr.dataset.mpptRow || '').split('|');
    if (parts.length < 2) return null;
    const name = decodeURIComponent(parts[1] || ''), id = decodeURIComponent(parts[2] || '');
    return { kind: parts[0], name, id, sub: id, tlSet: new Set(), classMap: new Map(), bars: new Set() };
  }
  let peopleTableBound = false;
  /** Ek hi baar document-level delegation: sort · filter · chips · "aur dikhao". */
  function bindPeopleTable() {
    if (peopleTableBound || typeof document === 'undefined' || !document.addEventListener) return;
    peopleTableBound = true;
    const visibleRows = (wrap, apply) => {
      const rows = [...wrap.querySelectorAll('tr[data-mppt-row]')];
      const q = clean((wrap.querySelector('[data-mppt-filter]') || {}).value || '').toLowerCase();
      const chip = wrap.dataset.mpptChip || 'all';
      let shown = 0;
      rows.forEach((tr) => {
        const okQ = !q || String(tr.dataset.mpptSearch || '').includes(q);
        const kind = String(tr.dataset.mpptKind || '');
        const okChip = chip === 'all' || (chip === 'agents' && /-agent$/.test(kind)) || (chip === 'tls' && /-tl$/.test(kind));
        const ok = okQ && okChip;
        if (apply !== false) { tr.hidden = !ok; }
        if (ok) shown++;
      });
      const count = wrap.querySelector('[data-mppt-count]');
      if (count) count.textContent = `${U.fmt(shown)} / ${U.fmt(rows.length)} rows`;
      return shown;
    };
    document.addEventListener('click', (e) => {
      if (!e.target || !e.target.closest) return;
      const th = e.target.closest('[data-mppt-sort]');
      if (th) {
        const table = th.closest('table'); const tbody = table && table.querySelector('tbody');
        if (!tbody) return;
        const ths = [...table.querySelectorAll('thead [data-mppt-sort]')];
        const idx = ths.indexOf(th);
        const dir = th.dataset.mpptDir === 'asc' ? 'desc' : 'asc';
        ths.forEach((h) => { if (h !== th) delete h.dataset.mpptDir; });
        th.dataset.mpptDir = dir;
        const mul = dir === 'asc' ? 1 : -1;
        const rows = [...tbody.querySelectorAll('tr[data-mppt-row]')];
        rows.sort((a, b) => {
          const av = (a.children[idx] && a.children[idx].getAttribute('data-v')) || '';
          const bv = (b.children[idx] && b.children[idx].getAttribute('data-v')) || '';
          const an = Number(av), bn = Number(bv);
          if (av !== '' && bv !== '' && Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * mul;
          return String(av).localeCompare(String(bv)) * mul;
        });
        rows.forEach((tr) => tbody.appendChild(tr));
        return;
      }
      const chip = e.target.closest('[data-mppt-chip]');
      if (chip) {
        const wrap = chip.closest('.mppt-wrap');
        if (!wrap) return;
        wrap.dataset.mpptChip = chip.dataset.mpptChip;
        wrap.querySelectorAll('[data-mppt-chip]').forEach((c) => c.classList.toggle('on', c === chip));
        visibleRows(wrap);
        return;
      }
      const more = e.target.closest('[data-mppt-more]');
      if (more) {
        const wrap = more.closest('.mppt-wrap');
        const hidden = [...wrap.querySelectorAll('tr.mppt-rest[hidden]')].slice(0, 300);
        hidden.forEach((tr) => { tr.hidden = false; tr.classList.remove('mppt-rest'); });
        if (!wrap.querySelector('tr.mppt-rest[hidden]')) more.remove();
        visibleRows(wrap);
      }
    });
    document.addEventListener('input', (e) => {
      const inp = e.target && e.target.closest ? e.target.closest('[data-mppt-filter]') : null;
      if (inp) visibleRows(inp.closest('.mppt-wrap'));
    });
    peopleTableVisible = visibleRows;
  }
  let peopleTableVisible = null;
  /**
   * Sortable + filterable data table: Agent | TL | 📦 Stock | 🏷️ Total Issuance | 📅 Last Month | 📈 Growth.
   * `rows` = reportDataRow() output. opts: { id, chips, rowActions(r), footer, limit, curLabel, lastLabel, sourceNote }
   */
  function peopleTableHtml(rows, opts) {
    bindPeopleTable();
    const o = opts || {};
    const list = Array.isArray(rows) ? rows : [];
    const limit = o.limit || 250;
    const sortVal = (v) => (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : v);
    const rowHtml = (r, i) => {
      const whoParam = r.isTl ? `tl=${encodeURIComponent(r.name)}${r.id ? `&tlId=${encodeURIComponent(r.id)}` : ''}` : `agent=${encodeURIComponent(r.name)}${r.id ? `&agentId=${encodeURIComponent(r.id)}` : ''}`;
      const st = r.isTl ? `src=${r.ch}&scope=stock&tl=${encodeURIComponent(r.name)}` : `src=${r.ch}&scope=stock&agent=${encodeURIComponent(r.name)}${r.id ? `&agentId=${encodeURIComponent(r.id)}` : ''}`;
      const curSpec = `src=${r.ch}&scope=mtd&ym=${encodeURIComponent(r.curYm || '')}&${whoParam}`;
      const lastSpec = `src=${r.ch}&scope=month&ym=${encodeURIComponent(r.lastYm || '')}&${whoParam}`;
      const rollup = r.isTl
        ? ((r.ownStock != null || r.agentsStock != null)
            ? `own ${fmt(r.ownStock || 0)} + agents ${fmt(r.agentsStock || 0)} · ${fmt(r.agentCount)} agents`
            : `${fmt(r.agentCount)} agents`)
        : '';
      const tlCell = r.isTl
        ? `<b>👥 TL total</b><small class="cell-sub">${rollup || 'own + agents'}</small>`
        : (r.direct ? `<span class="direct-chip">🚫 ${esc(r.tlLabel || 'Direct (no TL)')}</span>` : `${esc(r.tlName || '—')}${r.tlId ? `<small class="cell-sub">${esc(r.tlId)}</small>` : ''}`);
      return `<tr class="clickable${r.isTl ? ' mp-tlrow' : ''}${i >= limit ? ' mppt-rest' : ''}"${i >= limit ? ' hidden' : ''} data-mppt-row="${esc(rowEncode(r))}" data-mppt-kind="${esc(r.kind)}" data-mppt-search="${esc(`${r.name} ${r.tlName} ${r.tlLabel} ${r.id}`.toLowerCase())}" title="Click → poori report">
        <td data-v="${esc(String(r.name || '').toLowerCase())}">
          <div class="mppt-who"><span class="ms-avatar tiny ${r.ch === 'gv' ? 'gv' : 'ff'}">${esc((r.name || '?').slice(0, 1).toUpperCase())}</span>
            <div><b>${esc(r.name)}</b><small class="cell-sub"><span class="badge ${r.ch === 'gv' ? 'green' : 'blue'}">${r.ch === 'gv' ? '🟩 GV' : '🟦 FF'}</span> <span class="badge ${r.isTl ? 'purple' : 'blue'}">${r.isTl ? 'TL' : 'Agent'}</span>${r.id ? ` · <span class="mono">${esc(r.id)}</span>` : ''}${r.priority ? ` · ${esc(r.priority)}` : ''}</small></div>
          </div>
        </td>
        <td data-v="${esc(String(r.isTl ? `0-${r.name}` : (r.tlLabel || r.tlName || 'zz')).toLowerCase())}">${tlCell}</td>
        <td class="num mp-drill" data-v="${sortVal(r.stock)}" data-kpi="${esc(st)}" role="button" tabindex="0" title="Stock ki detail"><b>${fmt(r.stock)}</b>${r.stockVc4 || r.stockComm ? `<small class="cell-sub">VC4 ${fmt(r.stockVc4)} · Comm ${fmt(r.stockComm)}</small>` : ''}</td>
        <td class="num mp-drill" data-v="${sortVal(r.cur)}" data-kpi="${esc(curSpec)}" role="button" tabindex="0" title="Total issuance ki detail"><b>${fmt(r.cur)}</b>${r.curVc4 || r.curComm ? `<small class="cell-sub">VC4 ${fmt(r.curVc4)} · Comm ${fmt(r.curComm)}</small>` : ''}</td>
        <td class="num mp-drill" data-v="${sortVal(r.last)}" data-kpi="${esc(lastSpec)}" role="button" tabindex="0" title="Last month issuance ki detail"><b>${fmt(r.last)}</b>${r.lastVc4 || r.lastComm ? `<small class="cell-sub">VC4 ${fmt(r.lastVc4)} · Comm ${fmt(r.lastComm)}</small>` : ''}</td>
        <td class="num" data-v="${sortVal(Number.isFinite(r.growth) ? r.growth : -999999)}">${U.pctHtml(r.growth, { decimals: 0 })}</td>
        ${o.rowActions ? `<td class="mppt-acts">${o.rowActions(r)}</td>` : ''}
      </tr>`;
    };
    const agents = list.filter((r) => !r.isTl);
    const foot = o.footer === false ? '' : `<tfoot>
      <tr class="row-total"><td colspan="2"><b>${esc(o.footerLabel || 'GRAND TOTAL — agents')}</b><small class="cell-sub">${fmt(agents.length)} agents · TL rows = own + agents (rollup, isliye jod me nahi)</small></td>
        <td class="num"><b>${fmt(U.sum(agents, (r) => r.stock))}</b></td>
        <td class="num"><b>${fmt(U.sum(agents, (r) => r.cur))}</b></td>
        <td class="num"><b>${fmt(U.sum(agents, (r) => r.last))}</b></td>
        <td class="num">${U.pctHtml(U.growth(U.sum(agents, (r) => r.cur), U.sum(agents, (r) => r.last)), { decimals: 0 })}</td>
        ${o.rowActions ? '<td></td>' : ''}
      </tr></tfoot>`;
    return `<div class="mppt-wrap" data-mppt="${esc(o.id || 'mppt')}" data-mppt-chip="all">
      <div class="mppt-bar">
        <input class="input mppt-filter" data-mppt-filter type="search" placeholder="🔍 Is table me filter — naam · TL · ID…" aria-label="Table filter">
        ${o.chips || ''}
        <span class="mppt-count dim small" data-mppt-count>${U.fmt(list.length)} / ${U.fmt(list.length)} rows</span>
        ${o.sourceNote ? `<span class="dim small mppt-src">${o.sourceNote}</span>` : ''}
      </div>
      <div class="table-wrap"><table class="tbl compact mp-people-table">
        <thead><tr>
          <th data-mppt-sort="name" role="button" tabindex="0">🧑‍💼 ${esc(o.whoLabel || 'Agent / TL')}</th>
          <th data-mppt-sort="tl" role="button" tabindex="0">👥 TL</th>
          <th class="num" data-mppt-sort="stock" role="button" tabindex="0">📦 Stock</th>
          <th class="num" data-mppt-sort="cur" role="button" tabindex="0">🏷️ Total Issuance${esc(o.curLabel ? ` · ${o.curLabel}` : ' (MTD)')}</th>
          <th class="num" data-mppt-sort="last" role="button" tabindex="0">📅 Last Month${esc(o.lastLabel ? ` · ${o.lastLabel}` : '')}</th>
          <th class="num" data-mppt-sort="growth" role="button" tabindex="0">📈 Growth</th>
          ${o.rowActions ? '<th></th>' : ''}
        </tr></thead>
        <tbody>${list.map(rowHtml).join('')}</tbody>
        ${foot}
      </table></div>
      ${list.length > limit ? `<div class="mppt-more-row"><button type="button" class="btn small" data-mppt-more>🔽 Aur ${fmt(Math.min(300, list.length - limit))} rows dikhao (${fmt(list.length - limit)} bache)</button></div>` : ''}
    </div>`;
  }

  FF.masterProfile = { supports, quick, build, buildNow, html, groupBinsFor, csvRows, waText, renderInto, open, warm, load, loadFor, onData, isLoaded: () => loadedOnce, invalidate: resetProfileCache, suggest, suggestGro, findFfAgent, findGvAgent, mobileFor, reportDataRow, issuanceCardsHtml, gvTlSnapshot, peopleTableHtml, personFromRow, get suggestDays() { return suggestDays(); }, _buildSoon: buildSoon, _limits: LIMITS };
})(window.FF);