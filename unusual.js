/* 🚨 Unusual Agent Activity — Forensic Anomaly & Fraud Radar (First Forward + GV Partner).
   Captures real operational anomalies:
     • 🚫 High Wrong VRN     — agent's Wrong-VRN share >= max(8%, mult × peer) & count >= min, or malformed VRN
     • ♊ Double / Dup VRN   — same Vehicle Registration Number (VRN) issued multiple times
     • 🔁 High Replacement   — replacement share >= max(20%, mult × peer) & count >= min
     • 🔩 Excessive Chassis  — chassis share >= max(25%, mult × peer) & count >= min
     • ⚡ Sudden Spike/Burst — single day >= 10 tags AND >= 3× the agent's own active-day average
     • 🚨 Multi-Flag Risk    — 2+ anomalies triggered together
   Includes Date Presets (Today, Yesterday, Last 7 Days, This Month, Last Month, Last 30 Days, Custom Range),
   clickable KPI cards that open exact related data with CSV & PDF downloads, Forensic Watchlist cards,
   Duplicate VRN Inspector, Agent Forensic Drawer and a 🩺 Diagnose panel.

   v3.37 — teen bade fixes:
   1) 🎯 KPI card = drawer. Har card ka apna metric (duplicate tags / wrong tags / replacement tags…) hota hai
      aur click par drawer me WAHI number headline banta hai + uske exact tag-level rows. Card markup me
      `data-kpi-self` hota hai taaki global KPI drill-down (kpiDetail) is drawer ko override na kare —
      pehle click par do drawer khulte the aur aakhri (unrelated MTD) drawer jeet jaata tha.
   2) ⚡ Speed. Page TURANT paint hota hai (daily EIR aggregates se), tag-level scan background me chalta hai
      (server /api/unusual/scan — parallel pages + compact index), section-wise repaint hota hai (poora page
      nahi), events ek hi baar delegate hote hain aur badi tables capped + "Load more" hain.
   3) 🩺 Diagnose. Usi page se data-source, scan completeness, thresholds ("flag 0 kyun hai"), render timings
      aur site diagnostics — sab kuch ek drawer me, fix/export ke saath. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, S = FF.store, G = FF.gv;
  const esc = U.esc;
  /** Shared scan logic (unusual-scan.js) — server aur browser ek hi counting use karte hain. */
  const LIB = () => FF.unusualScan || (typeof globalThis !== 'undefined' ? globalThis.FFunusualScan : null);

  const FLAGS = {
    all:     { icon: '🛡️', label: 'All Flagged Agents', short: 'All Flagged', tone: 'red', desc: 'Agents with at least 1 operational anomaly' },
    multi:   { icon: '🚨', label: 'Multi-Flag Critical', short: 'Multi-Flag', tone: 'red', desc: '2 or more anomaly rules triggered together' },
    double:  { icon: '♊', label: 'Double / Duplicate VRN', short: 'Double VRN', tone: 'red', desc: 'Same VRN issued multiple times (duplicate vehicle number)' },
    wrong:   { icon: '🚫', label: 'High Wrong VRN', short: 'Wrong VRN', tone: 'red', desc: 'Unusually high wrong or invalid VRN entries' },
    replace: { icon: '🔁', label: 'High Replacement', short: 'Replacement', tone: 'amber', desc: 'Replacement ratio far above peer average' },
    chassis: { icon: '🔩', label: 'Excessive Chassis', short: 'Chassis', tone: 'amber', desc: 'Excessive chassis-based issuance without VRN' },
    spike:   { icon: '⚡', label: 'Sudden Day Spike', short: 'Day Spike', tone: 'blue', desc: 'Single-day burst ≥ 3× agent average (min 10 tags)' }
  };
  /** Har card ka apna metric — card, drawer, CSV aur PDF chaaron me yahi number dikhta hai. */
  const METRICS = {
    all:     { unit: 'agents', noun: 'Flagged agents', evidence: 'Agent-level ledger (sab flagged agents)' },
    multi:   { unit: 'agents', noun: 'Multi-flag agents', evidence: 'Agent-level ledger (2+ anomalies together)' },
    double:  { unit: 'tags', noun: 'Duplicate VRN tags', evidence: 'Tag-level duplicate VRN register' },
    wrong:   { unit: 'tags', noun: 'Wrong / invalid VRN tags', evidence: 'Tag-level wrong + malformed VRN rows' },
    replace: { unit: 'tags', noun: 'Replacement tags', evidence: 'Tag-level replacement rows' },
    chassis: { unit: 'tags', noun: 'Chassis tags', evidence: 'Tag-level chassis rows' },
    spike:   { unit: 'peak-day tags', noun: 'Peak-day burst tags', evidence: 'Agent-wise peak day vs own average' }
  };

  const PERIODS = [
    ['today',     '⚡ Today'],
    ['yesterday', '⏮ Yesterday'],
    ['last7',     '📅 Last 7 Days'],
    ['mtd',       '📆 This Month (MTD)'],
    ['last',      '🗓️ Last Month'],
    ['last30',    '🕒 Last 30 Days'],
    ['custom',    '🎯 Custom Date']
  ];

  const state = {
    ch: 'all',
    period: 'mtd',
    from: '',
    to: '',
    flag: 'all',
    tl: '',
    q: '',
    mult: 2,
    min: 5,
    onlyFlagged: true,
    fastMode: false,          // ⚡ tag-level scan skip (sirf ratio analysis) — Settings/Speed doctor se bhi set hota hai
    vrnCacheKey: '',
    vrnRecords: [],
    vrnFetchInfo: null,
    scan: null,               // { via:'server'|'browser'|'cache', at, ms, index, meta }
    scanning: false,
    scanError: '',
    lastPaintMs: 0,
    lastAnalyzeMs: 0,
    paintCount: 0
  };
  const VRN_PAGE_SIZE = 25000;
  const VRN_MAX_PAGES = 20;
  /** DOM caps — badi tables poori render karne par click/scroll atak jaata tha. */
  const CAP_LEDGER = 60;
  const CAP_DRAWER = 100;
  const CAP_STEP = 200;
  const SCAN_CACHE_PREFIX = 'ff_ua_scan_';
  const SCAN_CACHE_TTL = 30 * 60e3;
  let activeModel = null;
  let uaDrawerWired = false;
  let rootWired = null;
  let scanSeq = 0;
  let sectionEls = null;

  const lib = () => LIB();
  const isWrong = (v) => /wrong/i.test(String(v || ''));
  const isChassis = (v) => /chassis/i.test(String(v || ''));
  const isRepl = (t, s) => /replace/i.test(`${t || ''} ${s || ''}`);
  const cleanVrn = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isInvalidVrnFormat = (vrn, vrnType) => {
    const L = lib();
    if (L) return L.isInvalidVrnFormat(vrn, vrnType);
    if (isChassis(vrnType)) return false;
    const c = cleanVrn(vrn);
    if (!c) return true;
    if (c.length < 6 || c.length > 13) return true;
    if (/^(0+|1+|9+|TEST|NA|NULL|NONE|UNKNOWN|UNAVAILABLE|XXXX|AAAA)/.test(c)) return true;
    if (/(\d)\1{4,}/.test(c)) return true;
    return false;
  };
  const prefs = () => {
    try { return JSON.parse(localStorage.getItem('ff_speed_prefs') || '{}') || {}; } catch { return {}; }
  };
  const fastMode = () => state.fastMode || prefs().uaFastScan === true;
  /** Memoized lazy property — badi lists sirf tab banti hain jab drawer/CSV unhe maange. */
  function lazyProp(obj, prop, fn) {
    let value, done = false;
    Object.defineProperty(obj, prop, {
      enumerable: true, configurable: true,
      get() { if (!done) { value = fn(); done = true; } return value; }
    });
  }

  function resolveRange(all, opts) {
    const o = opts || state;
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(o.today || '')) ? String(o.today) : U.dateKey(new Date());
    const curYm = today.slice(0, 7);
    const prevYm = U.prevMonthKey(curYm);
    const shiftDays = (key, delta) => {
      const dt = U.fromDateKey(key) || new Date();
      dt.setDate(dt.getDate() + delta);
      return U.dateKey(dt);
    };
    if (o.period === 'today') {
      return { from: today, to: today, label: `Today (${U.labelDateKey(today, true)})` };
    }
    if (o.period === 'yesterday') {
      const y = shiftDays(today, -1);
      return { from: y, to: y, label: `Yesterday (${U.labelDateKey(y, true)})` };
    }
    if (o.period === 'last7') {
      const f = shiftDays(today, -6);
      return { from: f, to: today, label: `Last 7 Days (${f} → ${today})` };
    }
    if (o.period === 'last') {
      const f = `${prevYm}-01`, t = `${prevYm}-${U.pad2(U.daysInMonth(prevYm))}`;
      return { from: f, to: t, label: `Last Month (${U.labelYM(prevYm, true)})` };
    }
    if (o.period === 'last30') {
      const f = shiftDays(today, -29);
      return { from: f, to: today, label: `Last 30 Days (${f} → ${today})` };
    }
    if (o.period === 'custom' && (o.from || o.to)) {
      const f = o.from || o.to, t = o.to || o.from;
      const [a, b] = f <= t ? [f, t] : [t, f];
      return { from: a, to: b, label: `Custom (${a} → ${b})` };
    }
    const f = `${curYm}-01`;
    return { from: f, to: today, label: `This Month MTD (${U.labelYM(curYm, true)})` };
  }

  /** Pure analyzer — exposed as FF.unusual.analyze(dailyRows, opts) for tests and callers.
      opts.vrnIndex (server/cached scan) ya opts.vrnRecords (legacy tag rows) dono chalte hain. */
  function analyze(dailyRows, opts) {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const o = { ch: 'all', period: 'mtd', mult: 2, min: 5, ...(opts || {}) };
    const all = (dailyRows || []).filter((r) => r && r.key && (o.ch === 'all' || (o.ch === 'gv' ? r.channel === 'GV Partner' : r.channel !== 'GV Partner')));
    const range = resolveRange(all, o);
    const rows = all.filter((r) => r.key >= range.from && r.key <= range.to);

    let tot = 0, wrongTot = 0, invalidTot = 0, replTot = 0, chasTot = 0, vc4Tot = 0;
    const byAgent = new Map();
    const ensureAgent = (ch, id, name, tl) => {
      const k = `${ch}|${ U.clean(id || name).toUpperCase() }`;
      if (!k || k.endsWith('|')) return null;
      let a = byAgent.get(k);
      if (!a) {
        a = {
          key: k, channel: ch, id: U.clean(id), name: U.clean(name || id), tl: U.clean(tl),
          total: 0, vc4: 0, comm: 0, wrong: 0, wrongType: 0, replace: 0, chassis: 0,
          doubleVrn: 0, invalidVrn: 0, wrongUnion: 0, byDay: new Map(), byClass: new Map()
        };
        byAgent.set(k, a);
      } else {
        if (!a.name && name) a.name = U.clean(name);
        if (!a.id && id) a.id = U.clean(id);
        if ((!a.tl || a.tl === 'Direct') && tl) a.tl = U.clean(tl);
      }
      return a;
    };

    for (const r of rows) {
      const n = Number(r.n) || 0;
      if (n <= 0) continue;
      const ch = r.channel === 'GV Partner' ? 'gv' : 'ff';
      const a = ensureAgent(ch, r.agentId, r.agentName, r.tlName);
      if (!a) continue;
      a.total += n; tot += n;
      if (r.group === 'VC4' || String(r.cls || '').toUpperCase() === 'VC4') { a.vc4 += n; vc4Tot += n; } else a.comm += n;
      if (isWrong(r.vrnType)) a.wrongType += n;
      if (isChassis(r.vrnType)) { a.chassis += n; chasTot += n; }
      if (isRepl(r.type, r.status)) { a.replace += n; replTot += n; }
      if (r.doubleVrn) a.doubleVrn += Number(r.doubleVrn) || 0;
      a.byDay.set(r.key, (a.byDay.get(r.key) || 0) + n);
      const cls = String(r.cls || 'VC4').toUpperCase();
      a.byClass.set(cls, (a.byClass.get(cls) || 0) + n);
    }

    // ---- tag-level scan index (server /api/unusual/scan, browser fallback, ya cached) ----
    const L = lib();
    let index = o.vrnIndex && o.vrnIndex.agents ? o.vrnIndex : null;
    if (!index && Array.isArray(o.vrnRecords) && o.vrnRecords.length && L) {
      index = L.buildIndex({ records: L.dedupe(o.vrnRecords), from: range.from, to: range.to, meta: { source: 'inline records' } });
    }
    // Index ke per-agent counts merge karo + duplicate-group counts aur VRN search blob EK HI baar
    // precompute karo (warna har agent ke liye poora dup/bad list scan hota → page atak jaata).
    const dupGroupsByAgent = new Map();
    const blobByAgent = new Map();
    if (index && L) {
      const pushBlob = (key, vrn) => {
        if (!key || !vrn) return;
        let list = blobByAgent.get(key);
        if (!list) { list = []; blobByAgent.set(key, list); }
        if (list.length < 30 && !list.includes(vrn)) list.push(vrn);
      };
      for (const d of index.dup || []) {
        for (const [k] of d.a || []) {
          dupGroupsByAgent.set(k, (dupGroupsByAgent.get(k) || 0) + 1);
          pushBlob(k, d.v);
        }
      }
      for (const r of index.bad || []) pushBlob(r[0], r[3]);
      for (const [key, s] of Object.entries(index.agents || {})) {
        const a = ensureAgent(s.ch === 'gv' ? 'gv' : 'ff', s.id, s.name, s.tl) || byAgent.get(key);
        if (!a) continue;
        a.scanKey = key;
        a.wrongTagCount = s.w || 0;
        a.wrongBoth = s.b || 0;
        a.invalidVrn = s.i || 0;
        a.wrongUnion = Math.max(0, (s.w || 0) + (s.i || 0) - (s.b || 0));
        a.doubleVrn += s.d || 0;
        a.scanRepl = s.r || 0;
        a.scanChassis = s.c || 0;
      }
    }
    for (const a of byAgent.values()) {
      a.wrong = Math.max(a.wrongType, a.wrongUnion || 0);
      if (index) {
        // 🎯 Card ka number aur drawer ki evidence rows EK hi source se aayein: tag-level scan zyada
        //    batata hai (GV live rows / FF T+1 lag ki wajah se daily aggregate peeche reh jaata hai)
        //    to bada number rakho. Kam hone par aggregate hi jeet-ta hai (purana behaviour safe).
        if ((a.scanRepl || 0) > a.replace) a.replace = a.scanRepl;
        if ((a.scanChassis || 0) > a.chassis) a.chassis = a.scanChassis;
      }
      wrongTot += a.wrong;
      invalidTot += a.invalidVrn;
    }
    if (index) {
      // Merge ke baad totals dobara — warna peer% aur grand total per-agent numbers se piche reh jaate.
      replTot = 0; chasTot = 0;
      for (const a of byAgent.values()) { replTot += a.replace; chasTot += a.chassis; }
    }

    const channelStats = { ff: { total: 0, wrong: 0, invalid: 0, replace: 0, chassis: 0 }, gv: { total: 0, wrong: 0, invalid: 0, replace: 0, chassis: 0 } };
    for (const a of byAgent.values()) {
      const c = channelStats[a.channel] || channelStats.ff;
      c.total += a.total; c.wrong += a.wrong; c.invalid += a.invalidVrn; c.replace += a.replace; c.chassis += a.chassis;
    }
    const peerFor = (s) => ({
      wrongPct: s.total ? (s.wrong / s.total) * 100 : 0,
      invalidPct: s.total ? (s.invalid / s.total) * 100 : 0,
      replacePct: s.total ? (s.replace / s.total) * 100 : 0,
      chassisPct: s.total ? (s.chassis / s.total) * 100 : 0
    });
    const overallStats = Object.values(channelStats).reduce((a, c) => ({
      total: a.total + c.total, wrong: a.wrong + c.wrong, invalid: a.invalid + c.invalid,
      replace: a.replace + c.replace, chassis: a.chassis + c.chassis
    }), { total: 0, wrong: 0, invalid: 0, replace: 0, chassis: 0 });
    const peer = peerFor(overallStats);
    const peerByChannel = { ff: peerFor(channelStats.ff), gv: peerFor(channelStats.gv) };
    const cutsFor = (p) => ({
      wrongCut: Math.max(8, p.wrongPct * o.mult),
      invalidCut: Math.max(3, p.invalidPct * o.mult),
      replCut: Math.max(12, p.replacePct * o.mult),
      chasCut: Math.max(15, p.chassisPct * o.mult)
    });
    const wrongCut = cutsFor(peer).wrongCut;
    const replCut = cutsFor(peer).replCut;
    const chasCut = cutsFor(peer).chasCut;

    const out = [];
    let doubleTot = 0;
    for (const a of byAgent.values()) {
      const days = a.byDay.size || 1;
      const avg = a.total / days;
      let maxDay = 0, maxDate = '';
      for (const [d, n] of a.byDay) { if (n > maxDay) { maxDay = n; maxDate = d; } }
      a.days = days;
      a.avg = avg;
      a.maxDay = maxDay;
      a.maxDate = maxDate;
      a.spikeRatio = avg > 0 ? maxDay / avg : 0;
      a.wrongPct = a.total ? (a.wrong / a.total) * 100 : (a.wrong ? 100 : 0);
      a.invalidPct = a.total ? (a.invalidVrn / a.total) * 100 : (a.invalidVrn ? 100 : 0);
      a.replacePct = a.total ? (a.replace / a.total) * 100 : 0;
      a.chassisPct = a.total ? (a.chassis / a.total) * 100 : 0;
      a.doublePct = a.total ? (a.doubleVrn / a.total) * 100 : 0;
      doubleTot += a.doubleVrn;
      const aPeer = peerByChannel[a.channel] || peer;
      const aCuts = cutsFor(aPeer);
      a.peer = aPeer;
      a.cuts = aCuts;

      const flags = [];
      const reasons = [];
      const dupCount = a.doubleVrn;
      a.dupGroups = dupGroupsByAgent.get(a.scanKey || a.key) || 0;
      if (dupCount >= 2 || a.dupGroups >= 1) {
        flags.push('double');
        reasons.push(`♊ ${U.fmt(dupCount)} duplicate VRN tags (${U.fmt(a.dupGroups)} VRNs repeated)`);
      }
      if ((a.wrong >= o.min && a.wrongPct >= aCuts.wrongCut) || (a.invalidVrn >= o.min && a.invalidPct >= aCuts.invalidCut)) {
        flags.push('wrong');
        reasons.push(`🚫 ${U.fmt(a.wrong)} Wrong / invalid VRN · wrong ${a.wrongPct.toFixed(1)}% vs ${a.channel.toUpperCase()} peer ${aPeer.wrongPct.toFixed(1)}% (alert ≥ ${aCuts.wrongCut.toFixed(1)}%) · malformed ${U.fmt(a.invalidVrn)} (${a.invalidPct.toFixed(1)}% vs ${aPeer.invalidPct.toFixed(1)}%, alert ≥ ${aCuts.invalidCut.toFixed(1)}%)`);
      }
      if (a.replace >= o.min && a.replacePct >= aCuts.replCut) {
        flags.push('replace');
        reasons.push(`🔁 ${U.fmt(a.replace)} Replacements (${a.replacePct.toFixed(1)}% vs ${a.channel.toUpperCase()} peer ${aPeer.replacePct.toFixed(1)}%; alert ≥ ${aCuts.replCut.toFixed(1)}%)`);
      }
      if (a.chassis >= o.min && a.chassisPct >= aCuts.chasCut) {
        flags.push('chassis');
        reasons.push(`🔩 ${U.fmt(a.chassis)} Chassis tags (${a.chassisPct.toFixed(1)}% vs ${a.channel.toUpperCase()} peer ${aPeer.chassisPct.toFixed(1)}%; alert ≥ ${aCuts.chasCut.toFixed(1)}%)`);
      }
      if (days >= 2 && maxDay >= Math.max(10, o.min * 2) && a.spikeRatio >= 3) {
        flags.push('spike');
        reasons.push(`⚡ ${U.fmt(maxDay)} tags on ${maxDate} (${a.spikeRatio.toFixed(1)}× avg ${avg.toFixed(1)}/day; alert ≥ ${Math.max(10, o.min * 2)} tags and ≥ 3×)`);
      }
      if (flags.length >= 2) flags.unshift('multi');

      a.flags = flags;
      a.reasons = reasons;
      const rawScore = (flags.includes('double') ? a.doubleVrn * 12 + 25 : 0)
        + (flags.includes('wrong') ? (a.wrongPct / Math.max(1, aCuts.wrongCut)) * 28 : 0)
        + (flags.includes('replace') ? (a.replacePct / Math.max(1, aCuts.replCut)) * 22 : 0)
        + (flags.includes('chassis') ? (a.chassisPct / Math.max(1, aCuts.chasCut)) * 18 : 0)
        + (flags.includes('spike') ? a.spikeRatio * 7 : 0)
        + (flags.includes('multi') ? 20 : 0);
      a.score = Math.min(100, Math.round(rawScore));
      a.severity = a.score >= 65 || flags.includes('multi') || flags.includes('double') ? 'Critical' : a.score >= 35 ? 'High' : flags.length ? 'Elevated' : 'Normal';

      // Badi lists (duplicate VRN, malformed rows, replacement/chassis evidence) sirf jab maangi jaayein.
      const sKey = a.scanKey || a.key;
      lazyProp(a, 'doubleList', () => (index && L ? L.doubleListOf(index, sKey) : []));
      lazyProp(a, 'invalidList', () => (index && L ? L.invalidListOf(index, sKey) : []));
      lazyProp(a, 'evidence', () => ({
        replace: (index && L ? (index.rep || []).filter((r) => r[0] === sKey) : []),
        chassis: (index && L ? (index.cha || []).filter((r) => r[0] === sKey) : []),
        wrong: (index && L ? (index.bad || []).filter((r) => r[0] === sKey) : [])
      }));
      a.searchBlob = `${a.name} ${a.id} ${a.tl} ${a.reasons.join(' ')} ${(blobByAgent.get(sKey) || []).join(' ')}`.toLowerCase();
      out.push(a);
    }
    out.sort((a, b) => (b.flags.length - a.flags.length) || (b.score - a.score) || (b.doubleVrn - a.doubleVrn) || (b.wrong - a.wrong) || (b.total - a.total));
    const counts = { all: 0, multi: 0, double: 0, wrong: 0, replace: 0, chassis: 0, spike: 0 };
    const tagSums = { all: 0, multi: 0, double: 0, wrong: 0, replace: 0, chassis: 0, spike: 0 };
    for (const a of out) {
      if (a.flags.length) { counts.all++; tagSums.all += a.total; }
      for (const f of a.flags) {
        counts[f] = (counts[f] || 0) + 1;
        if (f === 'multi') tagSums.multi += a.total;
        if (f === 'double') tagSums.double += a.doubleVrn;
        if (f === 'wrong') tagSums.wrong += a.wrong;
        if (f === 'replace') tagSums.replace += a.replace;
        if (f === 'chassis') tagSums.chassis += a.chassis;
        if (f === 'spike') tagSums.spike += a.maxDay;
      }
    }
    const model = {
      rows: out,
      peer,
      cuts: { wrongCut, replCut, chasCut, byChannel: { ff: cutsFor(peerByChannel.ff), gv: cutsFor(peerByChannel.gv) } },
      peerByChannel,
      counts,
      tagSums,
      totals: { tot, vc4Tot, commTot: tot - vc4Tot, wrongTot, invalidTot, replTot, chasTot, doubleTot },
      index: index || null,
      from: range.from,
      to: range.to,
      rangeLabel: range.label,
      analyzedAt: Date.now()
    };
    // Duplicate VRN register — index se (subset filtering duplicatesForView me hoti hai).
    lazyProp(model, 'duplicateVrns', () => (index && L ? L.duplicatesFor(index, []) : []));
    state.lastAnalyzeMs = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
    model.analyzeMs = state.lastAnalyzeMs;
    return model;
  }

  /** Stable tag identity lets GV Master today's live rows and EIR history coexist without duplication. */
  function vrnRecordKey(rec) {
    const L = lib();
    if (L) return L.recordKey(rec);
    const ch = rec && rec.ch === 'gv' ? 'gv' : 'ff';
    const tagId = U.clean(rec && rec.tagId).toUpperCase();
    if (tagId) return `${ch}|tag:${tagId}`;
    return `${ch}|${rec && rec.key || ''}|${cleanVrn(rec && rec.vrn)}|${U.clean(rec && (rec.agentId || rec.agentName)).toUpperCase()}`;
  }
  function uniqueVrnRecords(records) {
    const L = lib();
    if (L) return L.dedupe(records);
    const map = new Map();
    for (const rec of records || []) {
      if (!rec || !rec.key || rec.vrn === null || rec.vrn === undefined) continue;
      const key = vrnRecordKey(rec);
      if (!map.has(key)) map.set(key, rec);
      else map.set(key, { ...map.get(key), ...Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== '' && v !== null && v !== undefined)) });
    }
    return [...map.values()];
  }

  /** GV Master (live) rows already in browser memory — scan me merge hote hain. */
  function gvMasterRecords(from, to) {
    const recs = [];
    if (G && typeof G.rows === 'function') {
      for (const r of G.rows() || []) {
        const key = r.date ? U.dateKey(r.date) : '';
        if (!key || key < from || key > to) continue;
        recs.push({
          ch: 'gv', key, vrn: r.vrn, tagId: r.tagId || r.serial || '', cls: r.cls || 'VC4',
          vrnType: r.tagType || '', agentId: r.agentId || '', agentName: r.agentName || '', tlName: r.tlName || '',
          status: r.status || ''
        });
      }
    }
    return recs;
  }

  /** Browser fallback: EIR ke tag-level rows bounded, offset-based pages me (server endpoint na chale to). */
  async function loadVrnRecords(from, to, onProgress) {
    const recs = gvMasterRecords(from, to);
    const cacheKey = `${from}_${to}`;
    if (state.vrnCacheKey === cacheKey) {
      return uniqueVrnRecords(recs.concat(state.vrnRecords));
    }
    const info = { pageSize: VRN_PAGE_SIZE, maxPages: VRN_MAX_PAGES, pages: 0, rowsRead: 0, capHit: false, offsetIssue: false, offsetVerified: false, source: 'GV Master fallback' };
    if (FF.data && typeof FF.data.query === 'function' && FF.config && FF.config.eir) {
      try {
        const e = FF.config.eir;
        const fields = [e.date, e.tagId, e.vrn, e.cls, e.vrnType, e.agentName, e.agentId, e.tlName, e.masterId, e.gvName, e.gvId, e.type, e.status];
        const D = FF.data, eirRecs = [], seenEir = new Set();
        const base = `select ${fields.join(', ')} where toDate(${e.date}) >= date '${from}' and toDate(${e.date}) <= date '${to}' order by ${e.date} asc, ${e.tagId} asc`;
        let lastPageLength = 0;
        info.source = 'EIR';
        for (let page = 0; page < VRN_MAX_PAGES; page++) {
          const offset = page * VRN_PAGE_SIZE;
          const t = await FF.data.query(e.sheet || 'EIR', `${base} limit ${VRN_PAGE_SIZE} offset ${offset}`, {});
          const pageRows = t.rows || [];
          let pageUnique = 0;
          info.pages++;
          info.rowsRead += pageRows.length;
          lastPageLength = pageRows.length;
          if (onProgress) onProgress(info);
          for (const r of pageRows) {
            const d = D.cellDate(r[0]);
            const key = d ? U.dateKey(d) : '';
            if (!key) continue;
            const channel = FF.model && FF.model.channelOf ? FF.model.channelOf(D.cellText(r[8]), D.cellText(r[7])) : 'First Forward';
            const ch = channel === 'GV Partner' ? 'gv' : 'ff';
            const agentName = ch === 'gv' ? (D.cellText(r[9]) || D.cellText(r[5])) : (D.cellText(r[5]) || D.cellText(r[9]));
            const agentId = ch === 'gv' ? (D.cellText(r[10]) || D.cellText(r[6])) : (D.cellText(r[6]) || D.cellText(r[10]));
            const rec = {
              ch, key, tagId: D.cellText(r[1]), vrn: D.cellText(r[2]), cls: D.cellText(r[3]) || 'VC4',
              vrnType: D.cellText(r[4]), agentName, agentId, tlName: D.cellText(r[7]),
              type: D.cellText(r[11]), status: D.cellText(r[12])
            };
            const identity = vrnRecordKey(rec);
            if (!seenEir.has(identity)) { pageUnique++; seenEir.add(identity); }
            eirRecs.push(rec);
          }
          if (page > 0 && pageRows.length && pageUnique === 0) {
            info.offsetIssue = true;
            break;
          }
          if (page > 0 && pageUnique > 0) info.offsetVerified = true;
          if (pageRows.length < VRN_PAGE_SIZE) break;
        }
        // If all 20 pages filled, probe the next offset (one row only) to distinguish an exact fit
        // from data beyond the declared 500,000-row safety cap.
        if (!info.offsetIssue && info.pages === VRN_MAX_PAGES && lastPageLength === VRN_PAGE_SIZE) {
          try {
            const probe = await FF.data.query(e.sheet || 'EIR', `${base} limit 1 offset ${VRN_PAGE_SIZE * VRN_MAX_PAGES}`, {});
            info.capHit = (probe.rows || []).length > 0;
            info.offsetVerified = info.offsetVerified || info.capHit;
          } catch { info.probeFailed = true; }
        }
        info.complete = !info.capHit && !info.offsetIssue && !info.probeFailed;
        const merged = uniqueVrnRecords(recs.concat(eirRecs));
        state.vrnCacheKey = cacheKey;
        state.vrnRecords = merged;
        state.vrnFetchInfo = info;
        return merged;
      } catch (err) {
        info.source = 'GV Master fallback';
        info.error = true;
        info.message = U.clean(err && err.message) || 'EIR query failed';
        info.complete = false;
        state.vrnFetchInfo = info;
        /* fallback to available GV Master rows; daily EIR aggregates still support ratio analysis */
      }
    }
    if (!state.vrnFetchInfo || state.vrnCacheKey !== cacheKey) state.vrnFetchInfo = { ...info, complete: false };
    return uniqueVrnRecords(recs);
  }

  // ---- 🗄️ scan cache (sessionStorage) — same range dobara kholne par turant -----------------------
  const scanCacheKey = (from, to) => `${SCAN_CACHE_PREFIX}${from}_${to}`;
  function readScanCache(from, to) {
    try {
      const raw = sessionStorage.getItem(scanCacheKey(from, to));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.index || !parsed.index.agents) return null;
      if (Date.now() - Number(parsed.at || 0) > SCAN_CACHE_TTL) return null;
      return parsed;
    } catch { return null; }
  }
  function writeScanCache(from, to, payload) {
    try {
      const raw = JSON.stringify(payload);
      if (raw.length > 4e6) return false;           // bahut bada index sessionStorage me mat rakho
      sessionStorage.setItem(scanCacheKey(from, to), raw);
      return true;
    } catch { return false; }
  }
  function clearScanCache() {
    let n = 0;
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(SCAN_CACHE_PREFIX)) { sessionStorage.removeItem(k); n++; }
      }
    } catch { /* private mode */ }
    state.vrnCacheKey = ''; state.vrnRecords = [];
    return n;
  }

  /** Tag-level scan: pehle server (parallel + cached), warna browser paging fallback. */
  async function runScan(from, to, opts) {
    const o = opts || {};
    const L = lib();
    const t0 = Date.now();
    const cached = !o.fresh && readScanCache(from, to);
    if (cached) {
      state.scan = { via: 'cache', at: cached.at, ms: 0, index: cached.index, meta: cached.index.meta || {} };
      state.vrnFetchInfo = cached.index.meta || null;
      state.scanError = '';
      return state.scan;
    }
    // 1) 🚀 server endpoint — parallel pages + compact index (browser ko 5 lakh rows nahi kheenchne padti).
    //    Server EIR + GV Master dono padhta hai, isliye browser side merge ki zaroorat nahi (numbers exact rehte hain).
    if (FF.auth && FF.auth.api) {
      try {
        const res = await FF.auth.api(`/api/unusual/scan?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${o.fresh ? '&fresh=1' : ''}`);
        if (res && res.ok && res.index && res.index.agents) {
          const index = res.index;
          state.scan = { via: 'server', at: Date.now(), ms: Date.now() - t0, index, meta: index.meta || {} };
          state.vrnFetchInfo = index.meta || null;
          state.scanError = '';
          writeScanCache(from, to, { at: state.scan.at, index });
          return state.scan;
        }
        if (res && !res.ok) state.scanError = res.error || 'server scan unavailable';
      } catch (err) {
        state.scanError = U.clean(err && err.message) || 'server scan failed';
      }
    }
    // 2) 🐢 browser fallback — wahi purani paged gviz scan (progress ke saath)
    const records = await loadVrnRecords(from, to, o.onProgress);
    const index = L ? L.buildIndex({ records, from, to, meta: { ...(state.vrnFetchInfo || {}), source: 'browser-scan' } }) : null;
    if (index) {
      state.scan = { via: 'browser', at: Date.now(), ms: Date.now() - t0, index, meta: index.meta || {} };
      writeScanCache(from, to, { at: state.scan.at, index });
    }
    return state.scan;
  }
  function matchesSearch(r, query) {
    if (!query) return true;
    return String(r.searchBlob || `${r.name} ${r.id} ${r.tl} ${r.reasons.join(' ')}`).toLowerCase().includes(query);
  }
  function scopedRows(model) {
    const q = U.clean(state.q).toLowerCase();
    return model.rows.filter((r) => (!state.tl || r.tl === state.tl) && matchesSearch(r, q));
  }
  function rowsForFlag(model, flagKey) {
    return scopedRows(model).filter((r) => flagKey === 'all' ? r.flags.length > 0 : r.flags.includes(flagKey));
  }
  function filteredRows(model) {
    return scopedRows(model).filter((r) => {
      if (state.onlyFlagged && !r.flags.length) return false;
      if (state.flag !== 'all' && !r.flags.includes(state.flag)) return false;
      return true;
    });
  }
  function duplicateRowsForView(model) {
    const L = lib();
    if (!L || !model.index) return model.duplicateVrns || [];
    return L.duplicatesFor(model.index, scopedRows(model).map((r) => r.scanKey || r.key));
  }

  /** Evidence rows ka EXACT expected count — index.agents ke sums se (rows banaye bina, isliye sasta). */
  function evidenceCountFor(model, flagKey, rows) {
    const index = model.index;
    if (!index) return 0;
    if (flagKey === 'double') return U.sum(rows, (r) => r.doubleVrn);
    if (flagKey === 'all' || flagKey === 'multi' || flagKey === 'spike') return rows.length;
    const pick = flagKey === 'wrong' ? (s) => Math.max(0, (s.w || 0) + (s.i || 0) - (s.b || 0))
      : flagKey === 'replace' ? (s) => s.r || 0
        : flagKey === 'chassis' ? (s) => s.c || 0 : () => 0;
    let n = 0;
    for (const r of rows) {
      const s = index.agents[r.scanKey || r.key];
      if (s) n += pick(s);
    }
    return n;
  }

  /** 🎯 Card metric — card, drawer headline, CSV aur PDF sab isi ek function se bante hain. */
  function metricFor(model, flagKey) {
    const rows = rowsForFlag(model, flagKey);
    const issued = U.sum(rows, (r) => r.total);
    const L = lib();
    const keys = rows.map((r) => r.scanKey || r.key);
    const meta = METRICS[flagKey] || METRICS.all;
    let value = 0, sub = '', evidenceTotal = 0;
    if (flagKey === 'all' || flagKey === 'multi') {
      value = rows.length;
      sub = `${U.fmt(issued)} tags issued · ${U.fmt(rows.reduce((a, r) => a + r.flags.filter((f) => f !== 'multi').length, 0))} anomalies`;
    } else if (flagKey === 'double') {
      value = U.sum(rows, (r) => r.doubleVrn);
      const groups = model.index && L ? L.duplicatesFor(model.index, keys).length : U.sum(rows, (r) => r.dupGroups || 0);
      sub = `${U.fmt(groups)} vehicles repeated · ${U.fmt(rows.length)} agents`;
    } else if (flagKey === 'wrong') {
      value = U.sum(rows, (r) => r.wrong);
      const malformed = U.sum(rows, (r) => r.invalidVrn);
      const peerPct = model.peer.wrongPct || 0;
      sub = `${U.fmt(malformed)} malformed · peer ${peerPct.toFixed(1)}% · alert ≥ ${(model.cuts.wrongCut || 0).toFixed(1)}%`;
    } else if (flagKey === 'replace') {
      value = U.sum(rows, (r) => r.replace);
      sub = `${issued ? ((value / issued) * 100).toFixed(1) : '0.0'}% of issued · peer ${(model.peer.replacePct || 0).toFixed(1)}% · alert ≥ ${(model.cuts.replCut || 0).toFixed(1)}%`;
    } else if (flagKey === 'chassis') {
      value = U.sum(rows, (r) => r.chassis);
      sub = `${issued ? ((value / issued) * 100).toFixed(1) : '0.0'}% of issued · peer ${(model.peer.chassisPct || 0).toFixed(1)}% · alert ≥ ${(model.cuts.chasCut || 0).toFixed(1)}%`;
    } else {
      value = U.sum(rows, (r) => r.maxDay);
      const top = rows.slice().sort((a, b) => b.spikeRatio - a.spikeRatio)[0];
      sub = top ? `biggest burst ${top.spikeRatio.toFixed(1)}× avg on ${top.maxDate || '—'} · ${U.fmt(rows.length)} agents` : `${U.fmt(rows.length)} agents`;
    }
    evidenceTotal = evidenceCountFor(model, flagKey, rows);
    return {
      flag: flagKey, meta, rows, issued, value, sub, evidenceTotal,
      unit: meta.unit, noun: meta.noun,
      vc4: U.sum(rows, (r) => r.vc4), comm: U.sum(rows, (r) => r.comm),
      doubleVrn: U.sum(rows, (r) => r.doubleVrn), wrong: U.sum(rows, (r) => r.wrong),
      invalid: U.sum(rows, (r) => r.invalidVrn), replace: U.sum(rows, (r) => r.replace),
      chassis: U.sum(rows, (r) => r.chassis), peak: U.sum(rows, (r) => r.maxDay),
      sharePct: model.totals.tot ? (issued / model.totals.tot) * 100 : 0,
      matched: evidenceTotal === value
    };
  }

  // ---- ⬇ exports --------------------------------------------------------------------------------
  const AGENT_HEAD = ['Channel', 'Agent Name', 'Agent ID', 'TL Name', 'Risk Score', 'Severity', 'Total Issued', 'VC4', 'Commercial', 'Double VRN', 'Wrong / Invalid VRN', 'Malformed VRN', 'Wrong %', 'Replacement', 'Replace %', 'Chassis', 'Chassis %', 'Active Days', 'Avg/Day', 'Max Day', 'Max Day Date', 'Spike ×', 'Flags', 'Forensic Reasons'];
  function agentCsvRows(rows, model) {
    const body = rows.map((r) => [
      r.channel.toUpperCase(), r.name, r.id, r.tl, r.score, r.severity,
      r.total, r.vc4, r.comm, r.doubleVrn, r.wrong, r.invalidVrn, r.wrongPct.toFixed(1),
      r.replace, r.replacePct.toFixed(1), r.chassis, r.chassisPct.toFixed(1),
      r.days, r.avg.toFixed(1), r.maxDay, r.maxDate, r.spikeRatio.toFixed(1),
      r.flags.map((f) => FLAGS[f]?.short || f).join(' + '),
      r.reasons.join(' | ')
    ]);
    const totIssued = U.sum(rows, (r) => r.total);
    const totWrong = U.sum(rows, (r) => r.wrong);
    const totRepl = U.sum(rows, (r) => r.replace);
    const totChas = U.sum(rows, (r) => r.chassis);
    body.push([
      'GRAND TOTAL', `${rows.length} Agents`, '', '', '', '',
      totIssued, U.sum(rows, (r) => r.vc4), U.sum(rows, (r) => r.comm), U.sum(rows, (r) => r.doubleVrn),
      totWrong, U.sum(rows, (r) => r.invalidVrn), totIssued ? ((totWrong / totIssued) * 100).toFixed(1) : '0.0',
      totRepl, totIssued ? ((totRepl / totIssued) * 100).toFixed(1) : '0.0',
      totChas, totIssued ? ((totChas / totIssued) * 100).toFixed(1) : '0.0',
      '', '', '', '', '', '', `${model.from} to ${model.to}`
    ]);
    return body;
  }
  function exportCsvData(rows, model, titleSuffix) {
    U.downloadCsv(`unusual-activity-${U.slug(titleSuffix || state.flag)}-${model.from}_${model.to}.csv`, AGENT_HEAD, agentCsvRows(rows, model));
  }
  /** Card ke metric ka EXACT tag-level evidence CSV (drawer wale rows hi). */
  function exportEvidenceCsv(m, model) {
    const ev = evidenceFor(m, model, 0);
    U.downloadCsv(`unusual-${U.slug(m.flag)}-tags-${model.from}_${model.to}.csv`, ev.head, ev.rows.concat([['GRAND TOTAL', ev.total, '', '', '', '', '', '', '']]));
    U.toast(`${U.fmt(ev.total)} tag rows exported ✓`, 'ok');
  }
  function evidenceFor(m, model, limit) {
    const L = lib();
    const keys = m.rows.map((r) => r.scanKey || r.key);
    if (!L || !model.index) {
      return { head: ['Note'], rows: [['Tag-level scan abhi available nahi hai — ↻ Re-scan dabao.']], total: 0, truncated: false };
    }
    // 🎯 Card par 0 dikha hai to drawer me bhi 0 rows dikhni chahiye — khali key-set ka matlab
    //    "poora index" nahi hota (warna card 0 bolta aur drawer me saare tags aa jaate).
    if (!keys.length) {
      const head = (L.evidence(model.index, { flag: m.flag, keys: ['__none__'], limit: 1 }).head) || [];
      return { head, rows: [], total: 0, truncated: false };
    }
    if (m.flag === 'spike') {
      return L.evidence(model.index, {
        flag: 'spike', keys, limit,
        rows: m.rows.map((r) => [r.maxDate || '—', r.maxDay, r.avg.toFixed(1), `${r.spikeRatio.toFixed(1)}×`, r.days, r.name, r.id, r.channel.toUpperCase(), r.tl || 'Direct'])
      });
    }
    if (m.flag === 'all' || m.flag === 'multi') {
      return L.evidence(model.index, {
        flag: 'all', keys, limit,
        rows: m.rows.map((r) => [r.name, r.id, r.channel.toUpperCase(), r.tl || 'Direct', r.score, r.severity, r.total, r.flags.filter((f) => f !== 'multi').map((f) => FLAGS[f] && FLAGS[f].short || f).join(' + ')])
      });
    }
    return L.evidence(model.index, { flag: m.flag, keys, limit });
  }

  async function exportPdfData(rows, model, btn, titleOverride, metric) {
    const pdfName = `unusual-activity-${U.slug(titleOverride || state.flag)}-${model.from}_${model.to}.pdf`;
    if (U.downloadStart) U.downloadStart(pdfName, 'Preparing PDF…');
    if (U.downloadYield) await U.downloadYield();
    try {
      if (!FF.pdf && FF.lazy && FF.lazy.need) await FF.lazy.need('pdf');
      if (!FF.pdf || !FF.pdf.doc) throw new Error('PDF module load nahi hua');
      if (btn) U.setButtonBusy(btn, true, 'PDF…');
      const m = metric || metricFor(model, state.flag);
      const totIssued = U.sum(rows, (r) => r.total);
      const kpiHtml = `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px">
        ${[
          [m.meta.noun, U.fmt(m.value), m.unit],
          ['Agents in view', U.fmt(rows.length), `${m.sub}`],
          ['Issued Tags', U.fmt(totIssued), `VC4 ${U.fmt(U.sum(rows, (r) => r.vc4))}`],
          ['Double VRN', U.fmt(m.doubleVrn), `${U.fmt(model.counts.double)} agents`],
          ['Wrong / Invalid VRN', U.fmt(m.wrong), `${U.fmt(m.invalid)} malformed · peer ${model.peer.wrongPct.toFixed(1)}%`],
          ['Replacement / Chassis', `${U.fmt(m.replace)} / ${U.fmt(m.chassis)}`, `Peer ${model.peer.replacePct.toFixed(1)}% / ${model.peer.chassisPct.toFixed(1)}%`]
        ].map(([l, v, s]) => `<div style="border:1px solid #cbd5e1;border-radius:8px;padding:8px;background:#f8fafc;text-align:center"><div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">${esc(String(l))}</div><div style="font-size:15px;font-weight:800;color:#0f172a;margin:2px 0">${esc(String(v))}</div><div style="font-size:9.5px;color:#475569">${esc(String(s))}</div></div>`).join('')}
      </div>`;
      const ev = evidenceFor(m, model, 400);
      const evHtml = ev.rows.length ? `<h3 style="font-size:12px;margin:12px 0 6px">${esc(m.meta.evidence)} — ${U.fmt(ev.total)} rows${ev.truncated ? ' (first 400 shown)' : ''}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:9px"><thead><tr style="background:#334155;color:#fff">${ev.head.map((h) => `<th style="padding:4px;text-align:left">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${ev.rows.slice(0, 400).map((r) => `<tr style="border-bottom:1px solid #e2e8f0">${r.map((c) => `<td style="padding:3px 4px">${esc(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
      const tblHtml = `<h3 style="font-size:12px;margin:14px 0 6px">Agent breakdown — ${U.fmt(rows.length)} agents</h3><table style="width:100%;border-collapse:collapse;font-size:10px">
        <thead><tr style="background:#0f172a;color:#fff">
          <th style="padding:5px;text-align:left">#</th>
          <th style="padding:5px;text-align:left">Agent</th>
          <th style="padding:5px;text-align:left">TL / Ch</th>
          <th style="padding:5px;text-align:right">Risk</th>
          <th style="padding:5px;text-align:right">Issued</th>
          <th style="padding:5px;text-align:right">Double VRN</th>
          <th style="padding:5px;text-align:right">Wrong / Invalid</th>
          <th style="padding:5px;text-align:right">Malformed</th>
          <th style="padding:5px;text-align:right">Replace</th>
          <th style="padding:5px;text-align:right">Chassis</th>
          <th style="padding:5px;text-align:right">Peak Day</th>
          <th style="padding:5px;text-align:left">Detected Anomalies</th>
        </tr></thead>
        <tbody>
          ${rows.slice(0, 85).map((r, idx) => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:4px 5px">${idx + 1}</td>
            <td style="padding:4px 5px"><b>${esc(r.name)}</b>${r.id ? `<br><span style="color:#64748b;font-size:9px">${esc(r.id)}</span>` : ''}</td>
            <td style="padding:4px 5px">${esc(r.tl || '—')} · <b>${r.channel.toUpperCase()}</b></td>
            <td style="padding:4px 5px;text-align:right;font-weight:800;color:#dc2626">${r.score}</td>
            <td style="padding:4px 5px;text-align:right;font-weight:700">${U.fmt(r.total)}</td>
            <td style="padding:4px 5px;text-align:right;color:${r.doubleVrn ? '#dc2626;font-weight:800' : '#64748b'}">${U.fmt(r.doubleVrn)}</td>
            <td style="padding:4px 5px;text-align:right">${U.fmt(r.wrong)} (${r.wrongPct.toFixed(0)}%)</td>
            <td style="padding:4px 5px;text-align:right">${U.fmt(r.invalidVrn)}</td>
            <td style="padding:4px 5px;text-align:right">${U.fmt(r.replace)} (${r.replacePct.toFixed(0)}%)</td>
            <td style="padding:4px 5px;text-align:right">${U.fmt(r.chassis)} (${r.chassisPct.toFixed(0)}%)</td>
            <td style="padding:4px 5px;text-align:right">${U.fmt(r.maxDay)} (${r.spikeRatio.toFixed(1)}×)</td>
            <td style="padding:4px 5px">${esc(r.reasons.join(' · ') || 'Normal')}</td>
          </tr>`).join('')}
          <tr style="background:#eef2ff;font-weight:800;border-top:2px solid #1e293b">
            <td colspan="4" style="padding:6px 5px">Grand Total (${rows.length} Agents)</td>
            <td style="padding:6px 5px;text-align:right">${U.fmt(totIssued)}</td>
            <td style="padding:6px 5px;text-align:right">${U.fmt(U.sum(rows, (r) => r.doubleVrn))}</td>
            <td style="padding:6px 5px;text-align:right">${U.fmt(U.sum(rows, (r) => r.wrong))}</td>
            <td style="padding:6px 5px;text-align:right">${U.fmt(U.sum(rows, (r) => r.invalidVrn))}</td>
            <td style="padding:6px 5px;text-align:right">${U.fmt(U.sum(rows, (r) => r.replace))}</td>
            <td style="padding:6px 5px;text-align:right">${U.fmt(U.sum(rows, (r) => r.chassis))}</td>
            <td colspan="2" style="padding:6px 5px">Period: ${esc(model.from)} → ${esc(model.to)}</td>
          </tr>
        </tbody>
      </table>`;
      const page = FF.pdf.doc({
        title: titleOverride || `Unusual Activity Forensic Report · ${FLAGS[state.flag]?.label || 'All'}`,
        sub: `${model.rangeLabel} · ${m.meta.noun} ${U.fmt(m.value)} ${m.unit} · ${rows.length} agents · Peer Wrong VRN ${model.peer.wrongPct.toFixed(1)}% · Replace ${model.peer.replacePct.toFixed(1)}% · Chassis ${model.peer.chassisPct.toFixed(1)}%`,
        meta: `Generated ${new Date().toLocaleString('en-IN')}`,
        body: kpiHtml + evHtml + tblHtml
      });
      await FF.pdf.download([page], pdfName);
      U.toast('Forensic PDF downloaded ✓', 'ok');
    } catch (err) {
      if (U.downloadFail) U.downloadFail(pdfName, (err && err.message) || 'PDF export failed');
      U.toast((err && err.message) || 'PDF export failed', 'err');
    } finally {
      if (btn) U.setButtonBusy(btn, false);
    }
  }

  // ---- 🖼️ section painters (poora page dobara render nahi hota — sirf jo section badla) ----------
  function scanStatusText() {
    const s = state.scan, meta = (s && s.meta) || {};
    if (state.scanning) return { tone: 'busy', text: '🔎 Tag-level scan chal raha hai (duplicate / wrong / malformed VRN)… duplicate-VRN aur malformed numbers scan ke baad update honge.' };
    if (fastMode()) return { tone: 'fast', text: '⚡ Fast mode ON — tag-level scan skip ho raha hai (sirf ratio analysis). Duplicate/malformed counts 0 dikhenge. 🩺 Diagnose se Deep scan chala sakte ho.' };
    if (!s) return { tone: 'warn', text: 'ℹ️ Tag-level scan abhi nahi hua — ↻ Refresh ya 🩺 Diagnose → Re-scan.' };
    if (s.via === 'cache') return { tone: 'ok', text: `🗄️ Cached scan (${U.timeLabel(s.at)}) · ${U.fmt(meta.rowsRead || 0)} tag rows · ${s.ms || 0}ms` };
    const bits = [`${s.via === 'server' ? '🚀 Server scan' : '🐢 Browser scan'}`, `${U.fmt(meta.rowsRead || 0)} tag rows`, `${meta.pages || 0} page(s)`, `${s.ms}ms`];
    if (meta.capHit) bits.push('⚠ safety cap hit — range chhota karo');
    if (meta.offsetIssue) bits.push('⚠ offset paging issue — data adhoora ho sakta hai');
    if (meta.error) bits.push(`⚠ ${meta.message || 'scan error'}`);
    return { tone: meta.complete ? 'ok' : 'warn', text: bits.join(' · ') };
  }

  function paintScanBar() {
    const el = sectionEls && sectionEls.scan;
    if (!el) return;
    const st = scanStatusText();
    el.className = `ua-data-note ${st.tone === 'warn' ? 'warning' : ''} ${state.scanning ? 'busy' : ''}`;
    el.innerHTML = `<span>${esc(st.text)}</span>${state.scanning ? '<span class="ua-scan-spin">⟳</span>' : ''}
      <span class="ua-scan-actions">
        <button type="button" class="btn tiny" data-ua-rescan title="Tag-level scan dobara chalao">↻ Re-scan</button>
        <button type="button" class="btn tiny" data-ua-fast title="Fast mode: tag scan skip">${fastMode() ? '🐢 Deep scan ON karo' : '⚡ Fast mode'}</button>
        <button type="button" class="btn tiny" data-ua-diagnose title="Data, thresholds aur speed ka poora check">🩺 Diagnose</button>
      </span>`;
  }

  function kpiCardHtml(k, m, model) {
    const f = FLAGS[k];
    const active = state.flag === k;
    const pending = state.scanning || (!model.index && !fastMode());
    const valueHtml = k === 'all' || k === 'multi'
      ? `${U.fmt(m.value)} <small class="dim" style="font-size:12px;font-weight:600">agents</small>`
      : `${U.fmt(m.value)} <small class="dim" style="font-size:12px;font-weight:600">${esc(m.unit)}</small>`;
    return `<div class="kpi ua-kpi-card ${f.tone} ${active ? 'ua-kpi-active' : ''} ${pending ? 'ua-kpi-pending' : ''}"
      data-ua-flag="${k}" data-kpi-self="1" data-kpi-value="${esc(String(m.value))}" data-kpi-unit="${esc(m.unit)}"
      role="button" tabindex="0"
      aria-label="${esc(f.label)}: ${U.fmt(m.value)} ${esc(m.unit)}, ${U.fmt(m.rows.length)} agents. Click karke exact data, CSV aur PDF kholo."
      title="Click → ${esc(f.label)} ka exact data (${U.fmt(m.value)} ${esc(m.unit)}) + tag-level rows + CSV/PDF">
      <div class="kpi-top"><span class="kpi-title">${esc(f.label)}</span><span class="kpi-icon">${f.icon}</span></div>
      <div class="kpi-value">${valueHtml}</div>
      <div class="kpi-foot"><b>${U.fmt(m.rows.length)}</b> agents · ${esc(m.sub)}</div>
      <div class="ua-kpi-cta">${pending ? '⟳ scan pending…' : `Click → exact ${esc(m.unit)} + CSV/PDF`}</div>
    </div>`;
  }

  function paintKpis(model) {
    const el = sectionEls && sectionEls.kpis;
    if (!el) return;
    const t0 = Date.now();
    const cards = Object.keys(FLAGS).map((k) => kpiCardHtml(k, metricFor(model, k), model)).join('');
    el.innerHTML = cards;
    state.lastPaintMs = Date.now() - t0;
    state.paintCount++;
  }

  function paintWatch(model) {
    const el = sectionEls && sectionEls.watch;
    if (!el) return;
    const topFlagged = filteredRows(model).filter((r) => r.flags.length > 0).slice(0, 6);
    if (!topFlagged.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<section class="card ua-watchlist-card">
      <div class="card-head">
        <h3>🕵️ Priority Forensic Watchlist — Top Flagged Agents (${U.fmt(topFlagged.length)})</h3>
        <div class="card-right"><span class="dim small">Click any card to inspect full forensic evidence, duplicate VRNs & tag-level rows</span></div>
      </div>
      <div class="card-body">
        <div class="ua-watch-grid">
          ${topFlagged.map((r, idx) => `<div class="ua-suspect-card ${r.score >= 65 ? 'critical' : 'high'}" data-ua-agent-key="${esc(r.key)}" role="button" tabindex="0">
            <div class="ua-sc-head">
              <div>
                <span class="ua-sc-rank">#${idx + 1} · ${r.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span>
                <h4 class="ua-sc-name">${esc(r.name)}${r.id ? ` <small>(${esc(r.id)})</small>` : ''}</h4>
                <div class="ua-sc-tl">TL: <b>${esc(r.tl || 'Direct')}</b> · Issued: <b>${U.fmt(r.total)}</b> tags</div>
              </div>
              <div class="ua-sc-score">
                <b>${r.score}</b>
                <small>${esc(r.severity)}</small>
              </div>
            </div>
            <div class="ua-sc-metrics">
              <div><span>Double VRN</span><b class="${r.doubleVrn ? 'red' : ''}">${U.fmt(r.doubleVrn)}</b></div>
              <div><span>Wrong / Invalid</span><b class="${r.wrong ? 'red' : ''}">${U.fmt(r.wrong)} <small>(${r.wrongPct.toFixed(0)}%)</small></b><small>${U.fmt(r.invalidVrn)} malformed</small></div>
              <div><span>Replace</span><b>${U.fmt(r.replace)} <small>(${r.replacePct.toFixed(0)}%)</small></b></div>
              <div><span>Chassis</span><b>${U.fmt(r.chassis)} <small>(${r.chassisPct.toFixed(0)}%)</small></b></div>
            </div>
            <div class="ua-sc-reasons">
              ${r.reasons.slice(0, 3).map((rs) => `<span class="ua-reason-chip">${esc(rs)}</span>`).join('')}
            </div>
          </div>`).join('')}
        </div>
      </div>
    </section>`;
  }

  function paintDup(model) {
    const el = sectionEls && sectionEls.dup;
    if (!el) return;
    const dups = duplicateRowsForView(model);
    if (!dups.length) {
      el.innerHTML = state.scanning ? '<section class="card"><div class="card-body dim small">♊ Duplicate VRN register scan ke baad bharega…</div></section>' : '';
      return;
    }
    const shown = dups.slice(0, 30);
    const dupTotal = U.sum(dups, (d) => d.count);
    el.innerHTML = `<section class="card">
      <div class="card-head">
        <h3>♊ Double / Duplicate VRN Radar — ${U.fmt(dups.length)} Vehicles Issued Multiple Times</h3>
        <div class="card-right">
          <button class="btn small" id="ua-dup-csv">⬇ Duplicate VRN CSV</button>
        </div>
      </div>
      <div class="card-body">
        <div class="table-wrap"><table class="tbl compact">
          <thead><tr><th>#</th><th>VRN (Vehicle Number)</th><th class="num">Times Issued</th><th>Agents Involved</th><th>TL</th><th>Channel</th><th>Classes</th><th>Dates</th></tr></thead>
          <tbody>
            ${shown.map((d, i) => `<tr>
              <td class="dim">${i + 1}</td>
              <td><b class="code-chip">${esc(d.vrn)}</b></td>
              <td class="num"><b class="count red">${U.fmt(d.count)}×</b></td>
              <td><b>${esc(d.agents.join(', ') || '—')}</b></td>
              <td>${esc(d.tls.join(', ') || '—')}</td>
              <td>${esc((d.channels || []).join(', '))}</td>
              <td>${esc((d.classes || []).join(', '))}</td>
              <td class="dim small">${esc((d.dates || []).join(', '))}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr class="row-total"><td colspan="2"><b>Grand Total (${U.fmt(dups.length)} duplicate VRNs)</b></td><td class="num"><b>${U.fmt(dupTotal)}</b></td><td colspan="5">${dups.length > shown.length ? `Pehle ${shown.length} VRN dikhe — poora register ♊ KPI card click karke ya CSV se lo.` : ''}</td></tr></tfoot>
        </table></div>
      </div>
    </section>`;
    if (FF.app && FF.app.enhanceTables) FF.app.enhanceTables(el);
  }

  function ledgerRowHtml(r, idx) {
    return `<tr class="clickable" data-ua-agent-key="${esc(r.key)}">
      <td class="dim">${idx + 1}</td>
      <td><span class="kd-badge ${r.channel}">${r.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span></td>
      <td><b>${esc(r.name)}</b>${r.id ? `<small class="cell-sub">${esc(r.id)}</small>` : ''}</td>
      <td>${esc(r.tl || 'Direct')}</td>
      <td class="num"><span class="count ${r.score >= 65 ? 'red' : r.score >= 35 ? 'amber' : ''}"><b>${r.score}</b> · ${esc(r.severity)}</span></td>
      <td class="num"><b>${U.fmt(r.total)}</b></td>
      <td class="num">${U.fmt(r.vc4)} <small class="dim">/ ${U.fmt(r.comm)}</small></td>
      <td class="num ${r.flags.includes('double') ? 'ua-hit' : ''}">${r.doubleVrn ? `<b class="count red">${U.fmt(r.doubleVrn)}</b>` : '<span class="dim">0</span>'}</td>
      <td class="num ${r.flags.includes('wrong') ? 'ua-hit' : ''}"><b>${U.fmt(r.wrong)}</b> <small class="dim">(${r.wrongPct.toFixed(1)}%)</small></td>
      <td class="num">${U.fmt(r.invalidVrn)}</td>
      <td class="num ${r.flags.includes('replace') ? 'ua-hit' : ''}"><b>${U.fmt(r.replace)}</b> <small class="dim">(${r.replacePct.toFixed(1)}%)</small></td>
      <td class="num ${r.flags.includes('chassis') ? 'ua-hit' : ''}"><b>${U.fmt(r.chassis)}</b> <small class="dim">(${r.chassisPct.toFixed(1)}%)</small></td>
      <td class="num ${r.flags.includes('spike') ? 'ua-hit' : ''}"><b>${U.fmt(r.maxDay)}</b> <small class="dim">${r.maxDate ? `${r.maxDate.slice(5)} (${r.spikeRatio.toFixed(1)}×)` : ''}</small></td>
      <td>${r.flags.filter((f) => f !== 'multi').map((f) => `<span class="badge ${FLAGS[f].tone}" style="margin:1px">${FLAGS[f].icon} ${esc(FLAGS[f].short)}</span>`).join(' ') || '<span class="dim">Normal</span>'}
        ${r.reasons.length ? `<div class="dim small" style="margin-top:2px">${esc(r.reasons.join(' · '))}</div>` : ''}
      </td>
    </tr>`;
  }

  function paintLedger(model) {
    const el = sectionEls && sectionEls.ledger;
    if (!el) return;
    const rows = filteredRows(model);
    const shown = rows.slice(0, CAP_LEDGER);
    const totIssued = U.sum(rows, (r) => r.total);
    const totWrong = U.sum(rows, (r) => r.wrong);
    const totRepl = U.sum(rows, (r) => r.replace);
    const totChas = U.sum(rows, (r) => r.chassis);
    el.innerHTML = `<section class="card">
      <div class="card-head">
        <h3>📋 Forensic Anomaly Ledger — ${esc(FLAGS[state.flag]?.label || 'All')} (${U.fmt(rows.length)} Agents)</h3>
        <div class="card-right">
          <span class="dim small">Row click → Agent Forensic Drawer · KPI card click → us card ka exact data</span>
        </div>
      </div>
      <div class="card-body">
        <div class="table-wrap"><table class="tbl compact">
          <thead><tr>
            <th>#</th><th>Ch</th><th>Agent</th><th>TL</th>
            <th class="num">Risk Score</th><th class="num">Total Issued</th>
            <th class="num">VC4 / Comm</th><th class="num">♊ Double VRN</th>
            <th class="num">🚫 Wrong / Invalid</th><th class="num">Malformed</th><th class="num">🔁 Replace</th>
            <th class="num">🔩 Chassis</th><th class="num">⚡ Peak Day</th>
            <th>Detected Anomalies & Threshold Proof</th>
          </tr></thead>
          <tbody id="ua-ledger-body">
            ${shown.map(ledgerRowHtml).join('') || `<tr><td colspan="14" class="empty">🎉 Selected filters aur period me koi unusual activity nahi mili.</td></tr>`}
          </tbody>
          ${rows.length ? `<tfoot><tr class="row-total">
            <td colspan="5"><b>Grand Total (${U.fmt(rows.length)} Agents)</b></td>
            <td class="num"><b>${U.fmt(totIssued)}</b></td>
            <td class="num"><b>${U.fmt(U.sum(rows, (r) => r.vc4))} / ${U.fmt(U.sum(rows, (r) => r.comm))}</b></td>
            <td class="num"><b>${U.fmt(U.sum(rows, (r) => r.doubleVrn))}</b></td>
            <td class="num"><b>${U.fmt(totWrong)} (${totIssued ? ((totWrong / totIssued) * 100).toFixed(1) : '0.0'}%)</b></td>
            <td class="num"><b>${U.fmt(U.sum(rows, (r) => r.invalidVrn))}</b></td>
            <td class="num"><b>${U.fmt(totRepl)} (${totIssued ? ((totRepl / totIssued) * 100).toFixed(1) : '0.0'}%)</b></td>
            <td class="num"><b>${U.fmt(totChas)} (${totIssued ? ((totChas / totIssued) * 100).toFixed(1) : '0.0'}%)</b></td>
            <td colspan="2">Period: ${esc(model.from)} → ${esc(model.to)}</td>
          </tr></tfoot>` : ''}
        </table></div>
        ${rows.length > shown.length ? `<div class="ua-more"><button type="button" class="btn" data-ua-more-ledger="${CAP_LEDGER}">↓ Aur ${U.fmt(rows.length - shown.length)} agents dikhao</button><span class="dim small">Performance ke liye pehle ${shown.length} rows render hote hain; CSV/PDF me poore ${U.fmt(rows.length)} agents jaate hain.</span></div>` : ''}
      </div>
    </section>`;
    if (FF.app && FF.app.enhanceTables) FF.app.enhanceTables(el);
  }

  function paintAll(model) {
    const t0 = Date.now();
    paintKpis(model);
    paintWatch(model);
    paintDup(model);
    paintLedger(model);
    paintScanBar();
    state.lastPaintMs = Date.now() - t0;
    state.paintCount++;
    const head = sectionEls && sectionEls.headSub;
    if (head) {
      const m = metricFor(model, 'all');
      head.innerHTML = `${esc(model.rangeLabel)} · <b>${U.fmt(m.value)}</b> agents flagged in this view (${U.fmt(scopedRows(model).length)} agents) · Peer benchmark: Wrong / Invalid VRN <b>${model.peer.wrongPct.toFixed(1)}%</b> · Replace <b>${model.peer.replacePct.toFixed(1)}%</b> · Chassis <b>${model.peer.chassisPct.toFixed(1)}%</b>`;
    }
    const csvBtn = sectionEls && sectionEls.csv;
    if (csvBtn) csvBtn.textContent = `⬇ CSV (${U.fmt(filteredRows(model).length)})`;
  }

  /** Page ka skeleton — ek baar banta hai, baaki sections andar update hote hain (fast). */
  function buildShell(root, model) {
    const tls = [...new Set(model.rows.map((r) => r.tl).filter(Boolean))].sort();
    const periodPills = PERIODS.map(([k, label]) =>
      `<button type="button" class="ua-period-pill ${state.period === k ? 'active' : ''}" data-ua-period="${k}">${label}</button>`
    ).join('');
    root.innerHTML = `
      <div class="page-head ua-head">
        <div class="ua-head-copy">
          <span class="ua-kicker">Cross-channel · forensic signal center</span>
          <h1>🚨 Unusual Agent Activity & Fraud Radar</h1>
          <p class="sub" id="ua-head-sub"></p>
        </div>
        <div class="head-actions">
          <button class="btn" id="ua-csv">⬇ CSV</button>
          <button class="btn primary" id="ua-pdf">📄 PDF Report</button>
          <button class="btn" id="ua-diag">🩺 Diagnose</button>
          <button class="btn" data-action="refresh">↻ Refresh</button>
        </div>
      </div>

      <section class="card ua-filter-command">
        <div class="ua-period-bar">
          <span class="ua-bar-label">📅 Select Period:</span>
          <div class="ua-period-pills">${periodPills}</div>
          <div class="ua-custom-dates ${state.period === 'custom' ? 'active' : ''}">
            <label>From <input type="date" class="input" id="ua-from" value="${esc(state.from || model.from)}"></label>
            <label>To <input type="date" class="input" id="ua-to" value="${esc(state.to || model.to)}"></label>
            <button type="button" class="btn small primary" id="ua-apply-dates">Apply Dates</button>
          </div>
        </div>
        <div class="ctrl-row ua-control-row">
          <div class="seg" id="ua-ch">${[['all', '🌐 All Channels'], ['ff', '🟦 First Forward'], ['gv', '🟩 GV Partner']].map(([k, l]) => `<button type="button" class="seg-btn ${state.ch === k ? 'on' : ''}" data-ch="${k}">${l}</button>`).join('')}</div>
          <label>TL <select id="ua-tl"><option value="">All TLs (${tls.length})</option>${tls.map((t) => `<option value="${esc(t)}" ${t === state.tl ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label>Sensitivity <select id="ua-mult">${[[1.5, '1.5× Peer (Strict)'], [2, '2× Peer (Standard)'], [3, '3× Peer (Relaxed)']].map(([v, l]) => `<option value="${v}" ${Number(state.mult) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Min Tags <select id="ua-min">${[3, 5, 10, 15, 25].map((v) => `<option value="${v}" ${Number(state.min) === v ? 'selected' : ''}>≥ ${v} tags</option>`).join('')}</select></label>
          <input class="input" id="ua-q" placeholder="Search agent, ID, TL, VRN…" value="${esc(state.q)}" style="min-width:200px">
          <label class="check"><input type="checkbox" id="ua-only" ${state.onlyFlagged ? 'checked' : ''}> Flagged Only</label>
        </div>
        <div class="ua-data-note" id="ua-scan-bar" role="status" aria-live="polite"></div>
        <div class="ua-data-note">ℹ️ Date presets calendar dates use karte hain (latest data date nahi). First Forward EIR ek din ki reporting delay ke saath aa sakta hai; GV me live Master rows bhi hoti hain.</div>
      </section>

      <div class="kpi-grid ua-kpi-grid" id="ua-kpis"></div>
      <div id="ua-watch"></div>
      <div id="ua-dup"></div>
      <div id="ua-ledger"></div>`;
    sectionEls = {
      scan: U.$('#ua-scan-bar', root),
      kpis: U.$('#ua-kpis', root),
      watch: U.$('#ua-watch', root),
      dup: U.$('#ua-dup', root),
      ledger: U.$('#ua-ledger', root),
      headSub: U.$('#ua-head-sub', root),
      csv: U.$('#ua-csv', root)
    };
  }

  // ---- 🚨 flag drawer — card ka EXACT data ------------------------------------------------------
  const isNumericCell = (v) => /^-?[\d,]+(\.\d+)?(%|×)?$/.test(String(v).trim());
  /** Evidence row — numeric cells right-align, baaki left (har flag ke apne columns hain). */
  function evRowHtml(r) {
    return `<tr>${r.map((c) => (isNumericCell(c) ? `<td class="num">${esc(String(c))}</td>` : `<td>${esc(String(c))}</td>`)).join('')}</tr>`;
  }
  /** Drawer ke agent-breakdown table ki row (13 columns) — "Load more" bhi isi se banta hai. */
  function drawerAgentRowHtml(r, i, flagKey) {
    const focus = flagKey === 'double' ? r.doubleVrn : flagKey === 'wrong' ? r.wrong : flagKey === 'replace' ? r.replace
      : flagKey === 'chassis' ? r.chassis : flagKey === 'spike' ? r.maxDay : r.flags.length;
    return `<tr class="clickable" data-ua-drawer-agent="${esc(r.key)}">
      <td class="dim">${i + 1}</td>
      <td><span class="kd-badge ${r.channel}">${r.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span></td>
      <td><b>${esc(r.name)}</b>${r.id ? ` <small class="dim">${esc(r.id)}</small>` : ''}</td>
      <td>${esc(r.tl || '—')}</td>
      <td class="num"><span class="count ${r.score >= 60 ? 'red' : 'amber'}">${r.score}</span></td>
      <td class="num"><b>${U.fmt(r.total)}</b></td>
      <td class="num"><b class="count ${focus ? 'red' : ''}">${U.fmt(focus)}</b></td>
      <td class="num">${r.doubleVrn ? `<b class="count red">${U.fmt(r.doubleVrn)}</b>` : '<span class="dim">0</span>'}</td>
      <td class="num">${U.fmt(r.wrong)} <small class="dim">(${r.wrongPct.toFixed(0)}%)</small></td>
      <td class="num">${U.fmt(r.invalidVrn)}</td>
      <td class="num">${U.fmt(r.replace)} <small class="dim">(${r.replacePct.toFixed(0)}%)</small></td>
      <td class="num">${U.fmt(r.chassis)} <small class="dim">(${r.chassisPct.toFixed(0)}%)</small></td>
      <td class="small">${esc(r.reasons.join(' · ') || '—')}</td>
    </tr>`;
  }

  /** Card ka number vs drawer ka data — dono barabar hone par ✅, warna exact reason ke saath ⚠️. */
  function reconcileHtml(m, model, ev) {
    const diff = m.evidenceTotal - m.value;
    const listedRows = ev ? ev.total : m.evidenceTotal;
    const capNote = ev && listedRows < m.evidenceTotal
      ? ` <span class="dim small">(list me ${U.fmt(listedRows)} rows hain — baaki evidence list capped hai, counts exact hain)</span>`
      : '';
    if (!diff) {
      return `<div class="ua-match ok">✅ <b>Card = drawer:</b> ${U.fmt(m.value)} ${esc(m.unit)} — neeche wahi ${U.fmt(m.evidenceTotal)} ${esc(m.flag === 'all' || m.flag === 'multi' || m.flag === 'spike' ? 'agent rows' : 'tag rows')} hain (exact match).${capNote}</div>`;
    }
    const why = [];
    if (!model.index) why.push('tag-level scan abhi available nahi (↻ Re-scan dabao ya 🩺 Diagnose → Deep scan)');
    else {
      if (m.flag === 'wrong') why.push('kuch Wrong-VRN tags sirf daily EIR aggregate me count hote hain, unki tag-level row me "Wrong" mark nahi hota');
      if (m.flag === 'replace' || m.flag === 'chassis') why.push('card ka number daily EIR aggregate se hai; tag-level rows scan se — dono me FF T+1 lag / GV live rows ka farq ho sakta hai');
      const meta = model.index.meta || {};
      if (!meta.complete) why.push('scan adhoora hai (cap / paging warning) — range chhota karo');
      if (meta.truncated && Object.values(meta.truncated).some(Boolean)) why.push('evidence list capped hai (counts exact hain, list poori nahi)');
    }
    return `<div class="ua-match warn">⚠️ <b>Card:</b> ${U.fmt(m.value)} ${esc(m.unit)} · <b>tag-level rows:</b> ${U.fmt(m.evidenceTotal)} (farq ${diff > 0 ? '+' : ''}${U.fmt(diff)}).${capNote}<br><span class="dim small">Kyun: ${esc(why.join('; ') || 'aggregate aur tag-level source alag hain')}.</span></div>`;
  }

  function openFlagDrawer(flagKey, model) {
    const fMeta = FLAGS[flagKey] || FLAGS.all;
    const m = metricFor(model, flagKey);
    const rows = m.rows;
    const ev = evidenceFor(m, model, CAP_DRAWER);
    const fullEv = m.evidenceTotal;
    const dupSection = flagKey === 'double'
      ? (() => {
        const dups = duplicateRowsForView(model).slice(0, CAP_DRAWER);
        return dups.length ? `<section class="dsec"><h4>♊ Duplicate VRN Register (${U.fmt(duplicateRowsForView(model).length)} Vehicles)</h4>
          <div class="table-wrap"><table class="tbl compact">
            <thead><tr><th>#</th><th>VRN (Vehicle No.)</th><th class="num">Times Issued</th><th>Agents Involved</th><th>TL</th><th>Classes</th><th>Dates</th></tr></thead>
            <tbody>
              ${dups.map((d, i) => `<tr>
                <td class="dim">${i + 1}</td>
                <td><b class="code-chip">${esc(d.vrn)}</b></td>
                <td class="num"><b class="count red">${U.fmt(d.count)}×</b></td>
                <td><b>${esc(d.agents.join(', ') || '—')}</b></td>
                <td>${esc(d.tls.join(', ') || '—')}</td>
                <td>${esc((d.classes || []).join(', ') || '—')}</td>
                <td class="dim small">${esc((d.dates || []).join(', '))}</td>
              </tr>`).join('')}
            </tbody>
          </table></div></section>` : '';
      })()
      : '';

    const kpisHtml = `<div class="dkpis" style="margin-bottom:12px">
      <div class="dkpi dkpi-hero"><small>${esc(m.meta.noun)} (card value)</small><b>${U.fmt(m.value)}</b><span>${esc(m.unit)} · ${esc(model.rangeLabel)}</span></div>
      <div class="dkpi"><small>Agents flagged</small><b>${U.fmt(rows.length)}</b><span>${esc(fMeta.short)}</span></div>
      <div class="dkpi"><small>Total issued by them</small><b>${U.fmt(m.issued)}</b><span>VC4 ${U.fmt(m.vc4)} · Comm ${U.fmt(m.comm)}</span></div>
      <div class="dkpi"><small>Double VRN</small><b>${U.fmt(m.doubleVrn)}</b><span>Duplicate vehicle numbers</span></div>
      <div class="dkpi"><small>Wrong / Invalid VRN</small><b>${U.fmt(m.wrong)}</b><span>${U.fmt(m.invalid)} malformed · peer ${model.peer.wrongPct.toFixed(1)}%</span></div>
      <div class="dkpi"><small>Replacement / Chassis</small><b>${U.fmt(m.replace)} / ${U.fmt(m.chassis)}</b><span>Peer ${model.peer.replacePct.toFixed(1)}% / ${model.peer.chassisPct.toFixed(1)}%</span></div>
    </div>`;

    const evSection = `<section class="dsec"><h4>🧾 ${esc(m.meta.evidence)} — ${U.fmt(ev.total)} rows${ev.total !== fullEv ? ` <small class="dim">(card metric ${U.fmt(fullEv)})</small>` : ''}</h4>
      <p class="dim small">Ye wahi rows hain jinse card ka <b>${U.fmt(m.value)} ${esc(m.unit)}</b> number bana hai.</p>
      <div class="table-wrap"><table class="tbl compact">
        <thead><tr>${ev.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody id="ua-ev-body">${ev.rows.map(evRowHtml).join('') || `<tr><td colspan="${ev.head.length}" class="empty">Is anomaly ke koi tag-level rows nahi mile.</td></tr>`}</tbody>
      </table></div>
      ${ev.total > ev.rows.length ? `<div class="ua-more"><button type="button" class="btn" data-ua-more-ev="${ev.rows.length}">↓ Aur ${U.fmt(ev.total - ev.rows.length)} rows dikhao</button></div>` : ''}
    </section>`;

    const tableSection = `<section class="dsec"><h4>${fMeta.icon} ${esc(fMeta.label)} — Agent Breakdown (${U.fmt(rows.length)})</h4>
      <p class="dim small">${esc(fMeta.desc)} · Kisi bhi agent row par click karo → uska poora forensic breakdown khulega.</p>
      <div class="table-wrap"><table class="tbl compact">
        <thead><tr>
          <th>#</th><th>Ch</th><th>Agent</th><th>TL</th>
          <th class="num">Risk Score</th><th class="num">Issued</th>
          <th class="num">${flagKey === 'double' ? '♊ Duplicate tags' : flagKey === 'wrong' ? '🚫 Wrong / Invalid' : flagKey === 'replace' ? '🔁 Replace' : flagKey === 'chassis' ? '🔩 Chassis' : flagKey === 'spike' ? '⚡ Peak day' : 'Anomalies'}</th>
          <th class="num">Double VRN</th><th class="num">Wrong / Invalid</th><th class="num">Malformed</th>
          <th class="num">Replace</th><th class="num">Chassis</th><th>Forensic Evidence</th>
        </tr></thead>
        <tbody id="ua-ag-body">
          ${rows.slice(0, CAP_DRAWER).map((r, i) => drawerAgentRowHtml(r, i, flagKey)).join('') || '<tr><td colspan="13" class="empty">Is anomaly category me koi agent nahi mila.</td></tr>'}
        </tbody>
        ${rows.length ? `<tfoot><tr class="row-total">
          <td colspan="5"><b>Grand Total (${U.fmt(rows.length)} Agents)</b></td>
          <td class="num"><b>${U.fmt(m.issued)}</b></td>
          <td class="num"><b>${U.fmt(m.value)}</b></td>
          <td class="num"><b>${U.fmt(m.doubleVrn)}</b></td>
          <td class="num"><b>${U.fmt(m.wrong)}</b></td>
          <td class="num"><b>${U.fmt(m.invalid)}</b></td>
          <td class="num"><b>${U.fmt(m.replace)}</b></td>
          <td class="num"><b>${U.fmt(m.chassis)}</b></td>
          <td></td>
        </tr></tfoot>` : ''}
      </table></div>
      ${rows.length > CAP_DRAWER ? `<div class="ua-more"><button type="button" class="btn" data-ua-more-agents="${CAP_DRAWER}">↓ Aur ${U.fmt(rows.length - CAP_DRAWER)} agents dikhao</button></div>` : ''}
    </section>`;

    FF.app.openDrawer({
      kicker: `Forensic Anomaly Drill-Down · ${model.rangeLabel}`,
      title: `${fMeta.icon} ${fMeta.label}`,
      sub: `<b>${U.fmt(m.value)}</b> ${esc(m.unit)} · <b>${U.fmt(rows.length)}</b> agents flagged · period ${esc(model.from)} → ${esc(model.to)}`,
      wide: true,
      actions: `<button class="btn small" data-ua-modal-evcsv="${esc(flagKey)}" title="Card ke number wali exact tag-level rows">⬇ Tags CSV</button><button class="btn small" data-ua-modal-csv="${esc(flagKey)}">⬇ Agents CSV</button><button class="btn small primary" data-ua-modal-pdf="${esc(flagKey)}">📄 PDF</button>`,
      body: `<div class="ua-drawer-head">${reconcileHtml(m, model, ev)}</div>` + kpisHtml + dupSection + evSection + tableSection,
      age: false
    });
    drawerState.flag = flagKey;
    drawerState.metric = m;
  }

  /** Drawer ke "Load more" state — badi tables chunk me bharti hain (drawer freeze na ho). */
  const drawerState = { flag: 'all', metric: null };

  function drawerLoadMore(kind, from) {
    const model = activeModel;
    if (!model) return;
    const m = drawerState.metric || metricFor(model, drawerState.flag);
    if (kind === 'ev') {
      const ev = evidenceFor(m, model, 0);
      const body = U.$('#ua-ev-body');
      if (!body) return;
      const next = ev.rows.slice(from, from + CAP_STEP);
      body.insertAdjacentHTML('beforeend', next.map(evRowHtml).join(''));
      const btn = document.querySelector('[data-ua-more-ev]');
      const left = ev.rows.length - (from + next.length);
      if (btn) { if (left > 0) btn.dataset.uaMoreEv = String(from + next.length); else btn.remove(); }
    } else if (kind === 'agents') {
      const rows = m.rows.slice(from, from + CAP_STEP);
      const body = U.$('#ua-ag-body');
      if (!body) return;
      body.insertAdjacentHTML('beforeend', rows.map((r, i) => drawerAgentRowHtml(r, from + i, m.flag)).join(''));
      const btn = document.querySelector('[data-ua-more-agents]');
      const left = m.rows.length - (from + rows.length);
      if (btn) { if (left > 0) btn.dataset.uaMoreAgents = String(from + rows.length); else btn.remove(); }
    }
  }

  /** Clicking any agent opens the deep Agent Forensic Investigation Drawer. */
  function openAgentForensicDrawer(r, model) {
    if (!r) return;
    const days = [...r.byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const classes = [...r.byClass.entries()].sort((a, b) => b[1] - a[1]);
    const kpiSpecBase = `src=${r.channel}&scope=range&from=${encodeURIComponent(model.from)}&to=${encodeURIComponent(model.to)}&agent=${encodeURIComponent(r.name)}&agentId=${encodeURIComponent(r.id || '')}&channel=${r.channel}`;
    const evidence = r.evidence || { replace: [], chassis: [], wrong: [] };

    const topKpis = `<div class="dkpis" style="margin-bottom:12px">
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&title=${encodeURIComponent(`${r.name} · Total Issued`)}`)}" title="Click to open tag-level issuance breakdown"><small>Total Issued</small><b>${U.fmt(r.total)}</b><span>VC4 ${U.fmt(r.vc4)} · Comm ${U.fmt(r.comm)}</span></div>
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&f=wrong&title=${encodeURIComponent(`${r.name} · Wrong / Invalid VRN`)}`)}" title="Click to open wrong and invalid VRN tags"><small>Wrong / Invalid VRN</small><b>${U.fmt(r.wrong)}</b><span>${U.fmt(r.invalidVrn)} malformed · ${r.wrongPct.toFixed(1)}% vs ${r.channel.toUpperCase()} peer ${r.peer.wrongPct.toFixed(1)}%</span></div>
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&f=repl&title=${encodeURIComponent(`${r.name} · Replacements`)}`)}" title="Click to open Replacement tags"><small>Replacements</small><b>${U.fmt(r.replace)}</b><span>${r.replacePct.toFixed(1)}% vs peer ${r.peer.replacePct.toFixed(1)}% · ${U.fmt(evidence.replace.length)} tag rows</span></div>
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&f=chassis&title=${encodeURIComponent(`${r.name} · Chassis Tags`)}`)}" title="Click to open Chassis tags"><small>Chassis Tags</small><b>${U.fmt(r.chassis)}</b><span>${r.chassisPct.toFixed(1)}% vs peer ${r.peer.chassisPct.toFixed(1)}% · ${U.fmt(evidence.chassis.length)} tag rows</span></div>
      <div class="dkpi"><small>Double VRN / Peak</small><b>${U.fmt(r.doubleVrn)} / ${U.fmt(r.maxDay)}</b><span>Peak ${esc(r.maxDate || '—')} (${r.spikeRatio.toFixed(1)}× avg)</span></div>
    </div>`;

    const reasonsHtml = `<section class="dsec"><h4>🚨 Forensic Anomaly Findings (Risk Score: <span class="count ${r.score >= 60 ? 'red' : 'amber'}">${r.score}/100 · ${esc(r.severity)}</span>)</h4>
      ${r.reasons.length ? `<ul style="margin:6px 0 0 18px;line-height:1.6">${r.reasons.map((rs) => `<li><b>${esc(rs)}</b></li>`).join('')}</ul>` : '<p class="dim">Is period me koi anomaly threshold cross nahi hua.</p>'}
      <p class="dim small">Thresholds: Wrong ≥ ${r.cuts.wrongCut.toFixed(1)}% · Invalid ≥ ${r.cuts.invalidCut.toFixed(1)}% · Replace ≥ ${r.cuts.replCut.toFixed(1)}% · Chassis ≥ ${r.cuts.chasCut.toFixed(1)}% · min ${U.fmt(state.min)} tags · Spike ≥ ${Math.max(10, state.min * 2)} tags & 3× avg.</p>
    </section>`;

    const dupList = r.doubleList || [];
    const dupHtml = dupList.length
      ? `<section class="dsec"><h4>♊ Duplicate VRNs Issued by ${esc(r.name)} (${dupList.length})</h4>
          <div class="table-wrap"><table class="tbl compact">
            <thead><tr><th>#</th><th>VRN</th><th class="num">Total Count</th><th class="num">By This Agent</th><th>Classes</th><th>Dates</th><th>Tag IDs</th></tr></thead>
            <tbody>${dupList.slice(0, CAP_DRAWER).map((d, i) => `<tr><td class="dim">${i + 1}</td><td><b class="code-chip">${esc(d.vrn)}</b></td><td class="num"><b class="count red">${U.fmt(d.count)}×</b></td><td class="num"><b>${U.fmt(d.agentCount)}</b></td><td>${esc((d.classes || []).join(', '))}</td><td class="dim small">${esc((d.dates || []).join(', '))}</td><td class="dim small">${esc((d.tagIds || []).slice(0, 4).join(', '))}</td></tr>`).join('')}
            <tr class="row-total"><td colspan="2"><b>Grand Total</b></td><td class="num"><b>${U.fmt(U.sum(dupList, (d) => d.count))}</b></td><td class="num"><b>${U.fmt(U.sum(dupList, (d) => d.agentCount))}</b></td><td colspan="3"></td></tr></tbody>
          </table></div></section>`
      : '';

    const invalidList = r.invalidList || [];
    const invalidHtml = invalidList.length
      ? `<section class="dsec"><h4>🧾 Malformed / Invalid VRN Samples (${U.fmt(invalidList.length)})</h4>
          <p class="dim small">Repeated placeholder values are excluded from duplicate-VRN counts. Tag ID par click karo to exact source row khulegi.</p>
          <div class="table-wrap"><table class="tbl compact"><thead><tr><th>#</th><th>Date</th><th>VRN entered</th><th>Type</th><th>Tag ID</th></tr></thead>
          <tbody>${invalidList.slice(0, CAP_DRAWER).map((item, i) => {
            const tagSpec = item.tagId ? `src=${r.channel}&scope=range&from=${encodeURIComponent(model.from)}&to=${encodeURIComponent(model.to)}&agent=${encodeURIComponent(r.name)}&agentId=${encodeURIComponent(r.id || '')}&channel=${r.channel}&tagId=${encodeURIComponent(item.tagId)}&date=${encodeURIComponent(item.key)}&title=${encodeURIComponent(`${r.name} · Tag ${item.tagId}`)}` : '';
            return `<tr${tagSpec ? ` class="clickable" role="button" tabindex="0" data-kpi="${esc(tagSpec)}"` : ''}><td class="dim">${i + 1}</td><td>${esc(item.key || '—')}</td><td><b class="code-chip">${esc(item.vrn || '(blank)')}</b></td><td>${esc(item.vrnType || '—')}</td><td>${esc(item.tagId || '—')}</td></tr>`;
          }).join('')}</tbody></table></div>
          ${invalidList.length > CAP_DRAWER ? `<p class="dim small">Showing first ${CAP_DRAWER} of ${U.fmt(invalidList.length)} malformed rows — poora list ⬇ Tags CSV se milega.</p>` : ''}</section>`
      : '';

    const clsHtml = `<section class="dsec"><h4>🏷️ Class-wise Breakdown</h4>
      <div class="table-wrap"><table class="tbl compact">
        <thead><tr><th>Class</th><th class="num">Tags Issued</th><th class="num">Share %</th></tr></thead>
        <tbody>${classes.map(([c, n]) => `<tr class="clickable" data-kpi="${esc(`${kpiSpecBase}&cls=${encodeURIComponent(c)}&title=${encodeURIComponent(`${r.name} · ${c}`)}`)}"><td><b>${esc(c)}</b></td><td class="num"><b>${U.fmt(n)}</b></td><td class="num">${r.total ? ((n / r.total) * 100).toFixed(1) : '0.0'}%</td></tr>`).join('')}</tbody>
        <tfoot><tr class="row-total"><td><b>Grand Total</b></td><td class="num"><b>${U.fmt(r.total)}</b></td><td class="num"><b>100%</b></td></tr></tfoot>
      </table></div></section>`;

    const dayHtml = `<section class="dsec"><h4>📅 Date-wise Activity (${days.length} Active Days · Avg ${r.avg.toFixed(1)}/day)</h4>
      <div class="table-wrap"><table class="tbl compact">
        <thead><tr><th>Date</th><th class="num">Tags Issued</th><th class="num">vs Agent Avg</th></tr></thead>
        <tbody>${days.slice(0, CAP_DRAWER).map(([dt, n]) => `<tr class="clickable" data-kpi="${esc(`src=${r.channel}&scope=day&date=${encodeURIComponent(dt)}&agent=${encodeURIComponent(r.name)}&agentId=${encodeURIComponent(r.id || '')}&channel=${r.channel}&title=${encodeURIComponent(`${r.name} · ${dt}`)}`)}"><td><b>${esc(U.labelDateKey(dt, true))}</b></td><td class="num"><b>${U.fmt(n)}</b></td><td class="num">${r.avg > 0 ? `${(n / r.avg).toFixed(1)}×` : '—'}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="row-total"><td><b>Grand Total (${days.length} days)</b></td><td class="num"><b>${U.fmt(r.total)}</b></td><td class="num"><b>${r.avg.toFixed(1)}/day</b></td></tr></tfoot>
      </table></div></section>`;

    FF.app.openDrawer({
      kicker: `Agent Forensic Profile · ${r.channel === 'gv' ? '🟩 GV Partner' : '🟦 First Forward'}`,
      title: `${r.name}${r.id ? ` (${r.id})` : ''}`,
      sub: `TL: <b>${esc(r.tl || 'Direct')}</b> · Period: ${esc(model.from)} → ${esc(model.to)} · Risk Score <b>${r.score}/100</b>`,
      wide: true,
      actions: `<button class="btn small" data-kpi="${esc(`${kpiSpecBase}&title=${encodeURIComponent(`${r.name} · All Tags`)}`)}">📄 Tag-Level Rows</button><button class="btn small" data-ua-agent-diagnose="${esc(r.key)}">🩺 Diagnose</button><a class="btn small" href="#/${r.channel === 'gv' ? 'gvAgentSummary' : 'ffAgentSummary'}?q=${encodeURIComponent(r.name)}">🧑‍💼 Agent Summary →</a>`,
      body: topKpis + reasonsHtml + dupHtml + invalidHtml + `<div class="grid g-2">${clsHtml}${dayHtml}</div>`,
      age: { kind: 'agent', key: r.id || r.name, keys: [r.id, r.name].filter(Boolean), ch: r.channel, title: r.name }
    });
  }

  // ---- 🩺 Diagnose — data, thresholds, scan health, speed: sab kuch usi page se ------------------
  function diagnoseData(model) {
    const daily = S.get('daily') || [];
    const inRange = daily.filter((r) => r.key >= model.from && r.key <= model.to);
    const latest = daily.reduce((mx, r) => (r.key > mx ? r.key : mx), '');
    const meta = (model.index && model.index.meta) || {};
    const scan = state.scan || {};
    const flags = Object.keys(FLAGS).map((k) => {
      const m = metricFor(model, k);
      const cut = k === 'wrong' ? model.cuts.wrongCut : k === 'replace' ? model.cuts.replCut : k === 'chassis' ? model.cuts.chasCut : null;
      const peer = k === 'wrong' ? model.peer.wrongPct : k === 'replace' ? model.peer.replacePct : k === 'chassis' ? model.peer.chassisPct : null;
      let why = '—';
      if (k === 'all' || k === 'multi') why = m.value ? `${U.fmt(m.value)} agents par 1+ anomaly mili` : 'Kisi bhi agent ne threshold cross nahi kiya';
      else if (m.rows.length) why = `${U.fmt(m.rows.length)} agents ne rule cross kiya (min ${U.fmt(state.min)} tags${cut ? ` · share ≥ ${cut.toFixed(1)}%` : ''})`;
      else if (k === 'double') why = meta.complete === false ? 'Scan adhoora hai — duplicate VRN detect nahi ho paye' : (!model.index ? 'Tag-level scan pending/skip — duplicate VRN isi scan se milte hain' : 'Is range me koi VRN 2+ baar issue nahi hua');
      else if (k === 'wrong') why = `Peer wrong ${peer.toFixed(1)}% → alert line ${cut.toFixed(1)}%; koi agent ${U.fmt(state.min)}+ tags ke saath us line ko cross nahi karta`;
      else if (k === 'replace' || k === 'chassis') why = `Peer ${peer.toFixed(1)}% → alert line ${cut.toFixed(1)}%; koi agent ${U.fmt(state.min)}+ tags ke saath cross nahi karta`;
      else why = `Kisi agent ka peak day ${Math.max(10, state.min * 2)} tags aur 3× average dono cross nahi karta`;
      return { key: k, label: FLAGS[k].label, icon: FLAGS[k].icon, value: m.value, unit: m.unit, agents: m.rows.length, evidence: m.evidenceTotal, matched: m.matched, cut, peer, why, sub: m.sub };
    });
    return {
      range: model.rangeLabel, from: model.from, to: model.to,
      dailyRows: daily.length, rangeRows: inRange.length, latestDataDate: latest,
      agents: model.rows.length, issued: model.totals.tot,
      scan: {
        via: scan.via || 'none', at: scan.at || 0, ms: scan.ms || 0,
        source: meta.source || '—', mode: meta.mode || '—', rowsRead: meta.rowsRead || 0, pages: meta.pages || 0,
        gvRows: meta.gvRows || 0, complete: !!meta.complete, capHit: !!meta.capHit, offsetIssue: !!meta.offsetIssue,
        offsetVerified: !!meta.offsetVerified, probeFailed: !!meta.probeFailed, error: !!meta.error, message: meta.message || '',
        truncated: meta.truncated || {}, serverError: state.scanError || ''
      },
      flags,
      timings: { analyzeMs: model.analyzeMs || 0, paintMs: state.lastPaintMs, paints: state.paintCount },
      caps: { ledger: CAP_LEDGER, drawer: CAP_DRAWER, step: CAP_STEP },
      fastMode: fastMode()
    };
  }

  function diagnoseHtml(model, agentRow) {
    const d = diagnoseData(model);
    const s = d.scan;
    const flagRows = d.flags.map((f) => `<tr>
      <td><b>${f.icon} ${esc(f.label)}</b></td>
      <td class="num"><b>${U.fmt(f.value)}</b> <small class="dim">${esc(f.unit)}</small></td>
      <td class="num">${U.fmt(f.agents)}</td>
      <td class="num">${f.cut ? `${f.cut.toFixed(1)}%` : '—'}${f.peer !== null ? ` <small class="dim">(peer ${f.peer.toFixed(1)}%)</small>` : ''}</td>
      <td class="num">${f.evidence === f.value ? `<span class="count green">✓ ${U.fmt(f.evidence)}</span>` : `<span class="count amber">${U.fmt(f.evidence)}</span>`}</td>
      <td class="small">${esc(f.why)}</td>
    </tr>`).join('');
    const scanTone = s.complete ? 'ok' : 'warn';
    const agentHtml = agentRow ? `<section class="dsec"><h4>🧑‍💼 Agent focus: ${esc(agentRow.name)} (${esc(agentRow.id || '—')})</h4>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Metric</th><th class="num">Value</th><th class="num">Alert line</th><th>Flag?</th></tr></thead><tbody>
        ${[
          ['Total issued', U.fmt(agentRow.total), '—', '—'],
          ['Wrong / invalid VRN', U.fmt(agentRow.wrong), `≥ ${agentRow.cuts.wrongCut.toFixed(1)}% & ≥ ${U.fmt(state.min)} tags`, agentRow.flags.includes('wrong') ? '⛔ Yes' : '✅ No'],
          ['Malformed VRN', U.fmt(agentRow.invalidVrn), `≥ ${agentRow.cuts.invalidCut.toFixed(1)}% & ≥ ${U.fmt(state.min)} tags`, agentRow.invalidVrn >= state.min && agentRow.invalidPct >= agentRow.cuts.invalidCut ? '⛔ Yes' : '✅ No'],
          ['Duplicate VRN tags', U.fmt(agentRow.doubleVrn), '≥ 2 tags ya 1 repeated VRN', agentRow.flags.includes('double') ? '⛔ Yes' : '✅ No'],
          ['Replacements', U.fmt(agentRow.replace), `≥ ${agentRow.cuts.replCut.toFixed(1)}% & ≥ ${U.fmt(state.min)} tags`, agentRow.flags.includes('replace') ? '⛔ Yes' : '✅ No'],
          ['Chassis tags', U.fmt(agentRow.chassis), `≥ ${agentRow.cuts.chasCut.toFixed(1)}% & ≥ ${U.fmt(state.min)} tags`, agentRow.flags.includes('chassis') ? '⛔ Yes' : '✅ No'],
          ['Peak day', `${U.fmt(agentRow.maxDay)} on ${agentRow.maxDate || '—'}`, `≥ ${Math.max(10, state.min * 2)} tags & ≥ 3× avg (${agentRow.avg.toFixed(1)})`, agentRow.flags.includes('spike') ? '⛔ Yes' : '✅ No']
        ].map((r) => `<tr><td>${esc(r[0])}</td><td class="num"><b>${esc(r[1])}</b></td><td class="num small">${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="dim small">Risk score <b>${agentRow.score}/100 (${esc(agentRow.severity)})</b> · TL ${esc(agentRow.tl || 'Direct')} · ${agentRow.days} active days.</p>
    </section>` : '';
    return `${agentHtml}
    <section class="dsec"><h4>📡 Data source & freshness</h4>
      <div class="dkpis">
        <div class="dkpi"><small>Period</small><b>${esc(d.from)} → ${esc(d.to)}</b><span>${esc(d.range)}</span></div>
        <div class="dkpi"><small>Daily EIR rows (range)</small><b>${U.fmt(d.rangeRows)}</b><span>${U.fmt(d.dailyRows)} rows loaded overall</span></div>
        <div class="dkpi"><small>Latest data date</small><b>${esc(d.latestDataDate || '—')}</b><span>${d.latestDataDate && d.latestDataDate < d.to ? 'FF T+1 — aaj ka data kal aata hai' : 'range tak data hai'}</span></div>
        <div class="dkpi"><small>Agents analysed</small><b>${U.fmt(d.agents)}</b><span>${U.fmt(d.issued)} tags issued</span></div>
      </div>
    </section>
    <section class="dsec"><h4>🔎 Tag-level scan health</h4>
      <div class="ua-diag-scan ${scanTone}">
        <div><span>Source</span><b>${esc(s.source)}</b></div>
        <div><span>Via</span><b>${esc(s.via)}${s.mode && s.mode !== '—' ? ` · ${esc(s.mode)}` : ''}</b></div>
        <div><span>Tag rows read</span><b>${U.fmt(s.rowsRead)}</b></div>
        <div><span>Pages</span><b>${U.fmt(s.pages)}</b></div>
        <div><span>GV live rows</span><b>${U.fmt(s.gvRows)}</b></div>
        <div><span>Time</span><b>${U.fmt(s.ms)} ms</b></div>
        <div><span>Complete</span><b>${s.complete ? '✅ yes' : '⚠ no'}</b></div>
        <div><span>Cache</span><b>${s.via === 'cache' ? `🗄️ ${U.timeLabel(s.at)}` : s.at ? `saved ${U.timeLabel(s.at)}` : '—'}</b></div>
      </div>
      ${s.capHit ? '<p class="ua-note warn">⚠ Safety cap hit — is range me aur rows hain. Range chhota karo (Last 7 Days / Custom) ya server scan fresh chalao.</p>' : ''}
      ${s.offsetIssue ? '<p class="ua-note warn">⚠ EIR offset paging ne same page dobara diya — tag-level detail adhoori ho sakti hai.</p>' : ''}
      ${s.error || s.serverError ? `<p class="ua-note warn">⚠ Scan error: ${esc(s.message || s.serverError)} — browser fallback use hua.</p>` : ''}
      ${Object.entries(s.truncated || {}).filter(([, v]) => v).map(([k]) => `<p class="ua-note">ℹ️ ${esc(k)} evidence list capped hai (counts exact hain, list poori nahi).</p>`).join('')}
      ${d.fastMode ? '<p class="ua-note warn">⚡ Fast mode ON hai — tag-level scan skip ho raha hai, isliye Duplicate/Malformed 0 dikh rahe hain. Neeche "Deep scan" dabao.</p>' : ''}
    </section>
    <section class="dsec"><h4>📐 Har flag ka hisaab — number kahan se aaya, 0 kyun hai</h4>
      <div class="table-wrap"><table class="tbl compact">
        <thead><tr><th>Anomaly rule</th><th class="num">Card value</th><th class="num">Agents</th><th class="num">Alert line</th><th class="num">Tag rows</th><th>Reason / explanation</th></tr></thead>
        <tbody>${flagRows}</tbody>
      </table></div>
      <p class="dim small">Sensitivity ${Number(state.mult)}× peer · minimum ${U.fmt(state.min)} tags · channel ${esc(state.ch)}${state.tl ? ` · TL ${esc(state.tl)}` : ''}${state.q ? ` · search "${esc(state.q)}"` : ''}.</p>
    </section>
    <section class="dsec"><h4>⚡ Speed</h4>
      <div class="dkpis">
        <div class="dkpi"><small>Analyze time</small><b>${U.fmt(d.timings.analyzeMs)} ms</b><span>rules + thresholds</span></div>
        <div class="dkpi"><small>Last paint</small><b>${U.fmt(d.timings.paintMs)} ms</b><span>${U.fmt(d.timings.paints)} paints is session</span></div>
        <div class="dkpi"><small>Render caps</small><b>${d.caps.ledger} / ${d.caps.drawer}</b><span>ledger / drawer rows, +${d.caps.step} per "Load more"</span></div>
        <div class="dkpi"><small>Scan mode</small><b>${d.fastMode ? '⚡ Fast' : '🔬 Deep'}</b><span>${s.via === 'server' ? '🚀 server parallel scan' : s.via === 'browser' ? '🐢 browser paging' : s.via === 'cache' ? '🗄️ cached' : 'not run'}</span></div>
      </div>
      <p class="dim small">Page turant paint hota hai (daily aggregates se) aur tag-level scan background me chalta hai — isliye spinner me nahi atakna chahiye. Click par poora page dobara render nahi hota, sirf drawer khulta hai.</p>
    </section>
    <section class="dsec"><h4>🛠 Actions — sab kuch yahin se</h4>
      <div class="btn-row wrap">
        <button class="btn small primary" data-ua-act="rescan">↻ Deep re-scan (fresh)</button>
        <button class="btn small" data-ua-act="fast">${d.fastMode ? '🔬 Deep scan ON karo' : '⚡ Fast mode ON karo'}</button>
        <button class="btn small" data-ua-act="clearcache">🧹 Scan cache clear</button>
        <button class="btn small" data-ua-act="sitediag">🩺 Site diagnostics (yahan chalao)</button>
        <button class="btn small" data-ua-act="cards">🔬 Card ↔ drawer match test</button>
        <button class="btn small" data-ua-act="export">⬇ Diagnose report (CSV)</button>
        <button class="btn small" data-ua-act="copy">📋 Summary copy</button>
        <a class="btn small" href="#/settings?tab=diagnostics">⚙️ Settings → Site diagnostics</a>
      </div>
      <div id="ua-diag-out" class="ua-diag-out"></div>
    </section>`;
  }

  function diagnoseText(model, agentRow) {
    const d = diagnoseData(model);
    const s = d.scan;
    const lines = [
      `🚨 Unusual Activity — Diagnose`,
      `Period: ${d.range} (${d.from} → ${d.to})`,
      `Data: ${U.fmt(d.rangeRows)} daily EIR rows · ${U.fmt(d.agents)} agents · ${U.fmt(d.issued)} tags · latest data ${d.latestDataDate || '—'}`,
      `Scan: ${s.via} (${s.source}) · ${U.fmt(s.rowsRead)} tag rows · ${U.fmt(s.pages)} pages · ${U.fmt(s.ms)}ms · complete ${s.complete ? 'yes' : 'NO'}${s.capHit ? ' · CAP HIT' : ''}${s.offsetIssue ? ' · OFFSET ISSUE' : ''}`,
      `Speed: analyze ${U.fmt(d.timings.analyzeMs)}ms · paint ${U.fmt(d.timings.paintMs)}ms · mode ${d.fastMode ? 'Fast' : 'Deep'}`,
      '',
      'Flag-wise:'
    ];
    d.flags.forEach((f) => lines.push(` • ${f.icon} ${f.label}: ${U.fmt(f.value)} ${f.unit} · ${U.fmt(f.agents)} agents · tag rows ${U.fmt(f.evidence)}${f.matched ? ' ✓' : ' ⚠'} — ${f.why}`));
    if (agentRow) lines.push('', `Agent focus: ${agentRow.name} (${agentRow.id}) · score ${agentRow.score}/100 ${agentRow.severity} · flags ${agentRow.flags.join('+') || 'none'}`);
    return lines.join('\n');
  }

  function diagnoseCsv(model, agentRow) {
    const d = diagnoseData(model);
    const head = ['Section', 'Field', 'Value', 'Detail'];
    const rows = [
      ['Period', 'Range', `${d.from} → ${d.to}`, d.range],
      ['Data', 'Daily EIR rows in range', d.rangeRows, `${d.dailyRows} rows loaded`],
      ['Data', 'Latest data date', d.latestDataDate, d.latestDataDate && d.latestDataDate < d.to ? 'FF T+1 lag' : 'range covered'],
      ['Data', 'Agents analysed', d.agents, `${d.issued} tags issued`],
      ['Scan', 'Via', d.scan.via, d.scan.source],
      ['Scan', 'Tag rows read', d.scan.rowsRead, `${d.scan.pages} pages · GV live ${d.scan.gvRows}`],
      ['Scan', 'Time (ms)', d.scan.ms, `mode ${d.scan.mode}`],
      ['Scan', 'Complete', d.scan.complete ? 'yes' : 'no', [d.scan.capHit ? 'cap hit' : '', d.scan.offsetIssue ? 'offset issue' : '', d.scan.message || d.scan.serverError || ''].filter(Boolean).join(' · ')],
      ['Speed', 'Analyze ms', d.timings.analyzeMs, `${d.timings.paints} paints`],
      ['Speed', 'Last paint ms', d.timings.paintMs, `caps ${d.caps.ledger}/${d.caps.drawer}`],
      ['Speed', 'Mode', d.fastMode ? 'Fast (scan skip)' : 'Deep (tag-level scan)', '']
    ];
    d.flags.forEach((f) => rows.push(['Flag', f.label, `${f.value} ${f.unit}`, `${f.agents} agents · tag rows ${f.evidence} · ${f.matched ? 'match ✓' : 'mismatch ⚠'} · ${f.why}`]));
    if (agentRow) rows.push(['Agent', agentRow.name, `${agentRow.score}/100 ${agentRow.severity}`, `flags ${agentRow.flags.join('+') || 'none'} · issued ${agentRow.total} · wrong ${agentRow.wrong} · dup ${agentRow.doubleVrn} · repl ${agentRow.replace} · chassis ${agentRow.chassis}`]);
    U.downloadCsv(`unusual-diagnose-${model.from}_${model.to}.csv`, head, rows);
    U.toast('Diagnose report downloaded ✓', 'ok');
  }

  function openDiagnose(model, agentRow) {
    FF.app.openDrawer({
      kicker: agentRow ? 'Agent forensic diagnose' : 'Unusual Activity · data, thresholds & speed',
      title: agentRow ? `🩺 ${agentRow.name} — kyun flag hua` : '🩺 Diagnose — Unusual Activity',
      sub: `${esc(model.rangeLabel)} · scan ${esc((state.scan && state.scan.via) || 'none')} · analyze ${U.fmt(model.analyzeMs || 0)}ms`,
      wide: true,
      actions: `<button class="btn small" data-ua-act="copy">📋 Copy</button><button class="btn small primary" data-ua-act="export">⬇ CSV</button>`,
      body: diagnoseHtml(model, agentRow),
      age: false
    });
  }

  /** 🩺 Site diagnostics ko yahin chalao (Settings module lazy load karke) — "sab kuch yahi se". */
  async function runSiteDiagHere(out) {
    if (!out) return;
    out.innerHTML = U.spinner('Site diagnostics chal rahi hain…');
    try {
      if (FF.lazy && FF.lazy.need) await FF.lazy.need(['settings']);
      const dg = FF.pages.settings && FF.pages.settings.diagnostics;
      if (!dg || typeof dg.scanDom !== 'function') throw new Error('Diagnostics module load nahi hua');
      const findings = dg.scanDom() || [];
      if (!findings.length) { out.innerHTML = '<div class="diag-ok">✅ UI/routes/KPI contract me koi issue nahi mila.</div>'; return; }
      out.innerHTML = `<p class="dim small">${U.fmt(findings.length)} findings (current page + shell). "Fix" safe repairs site-wide save hote hain.</p>
        ${findings.slice(0, 40).map((f) => `<article class="diag-finding ${esc(f.severity)} ${f.fixed ? 'fixed' : ''}">
          <div class="diag-finding-head"><span class="diag-severity">${f.severity === 'high' ? '⛔ High' : f.severity === 'medium' ? '⚠️ Medium' : 'ℹ️ Low'}</span><b>${esc(f.category)}</b><small>${esc(f.page)} · ${esc(f.selector)}</small></div>
          <p><b>${esc(f.context)}</b><br>${esc(f.explanation)}</p>
          <p class="dim small"><b>Suggested fix:</b> ${esc(f.suggestion)}</p>
          ${f.safe ? `<button class="btn small primary" data-ua-diag-fix="${esc(f.id)}">🛠 Fix (site-wide)</button>` : '<span class="diag-source-note">🗂️ Source/config correction required</span>'}
        </article>`).join('')}`;
      out.querySelectorAll('[data-ua-diag-fix]').forEach((btn) => btn.addEventListener('click', () => {
        const f = findings.find((x) => x.id === btn.dataset.uaDiagFix);
        if (dg.applyFix(f)) { U.toast('🛠 Safe fix site-wide apply + save ho gaya ✓', 'ok'); btn.outerHTML = '<span class="diag-fixed">✅ Fixed &amp; saved</span>'; }
        else U.toast('Ye finding browser se safely fix nahi hoti', 'warn');
      }));
    } catch (err) {
      out.innerHTML = U.errorBox(err);
    }
  }

  /** 🔬 Card ↔ drawer match test — har KPI card click karke drawer ka headline number verify karta hai. */
  async function probeCards(out) {
    const model = activeModel;
    if (!model) return;
    if (!out) return;
    out.innerHTML = U.spinner('Har KPI card click karke drawer ka number verify ho raha hai…');
    const results = [];
    for (const k of Object.keys(FLAGS)) {
      const m = metricFor(model, k);
      openFlagDrawer(k, model);
      const titleEl = U.$('#drawer-title'), subEl = U.$('#drawer-sub'), bodyEl = U.$('#drawer-body');
      const title = (titleEl && titleEl.textContent) || '';
      const sub = ((subEl && (subEl.textContent || subEl.innerHTML)) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      // textContent + innerHTML dono padho — kuch DOM shim (aur harness) me textContent innerHTML se derive nahi hota.
      const body = `${(bodyEl && bodyEl.textContent) || ''} ${String((bodyEl && bodyEl.innerHTML) || '').replace(/<[^>]+>/g, ' ')}`.replace(/\s+/g, ' ');
      const want = U.fmt(m.value);
      const okTitle = title.includes(FLAGS[k].label);
      const okValue = sub.includes(want) || body.includes(want);
      const okUnit = body.includes(m.unit) || m.unit === 'agents';
      results.push({ flag: k, label: FLAGS[k].label, card: `${want} ${m.unit}`, drawerTitle: title, ok: okTitle && okValue && okUnit, okTitle, okValue, okUnit });
    }
    if (FF.app && FF.app.closeDrawer) FF.app.closeDrawer();
    const bad = results.filter((r) => !r.ok);
    out.innerHTML = `<p class="dim small">${U.fmt(results.length)} cards test hue · ${bad.length ? `<b class="red">${U.fmt(bad.length)} mismatch</b>` : '<b>✅ sab match</b>'}</p>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Card</th><th class="num">Card value</th><th>Drawer title</th><th>Match</th></tr></thead>
      <tbody>${results.map((r) => `<tr><td>${esc(r.label)}</td><td class="num"><b>${esc(r.card)}</b></td><td class="small">${esc(r.drawerTitle || '—')}</td><td>${r.ok ? '<span class="count green">✓ match</span>' : `<span class="count red">✗ ${[!r.okTitle ? 'title' : '', !r.okValue ? 'value' : '', !r.okUnit ? 'unit' : ''].filter(Boolean).join('/')}</span>`}</td></tr>`).join('')}</tbody></table></div>`;
    return results;
  }

  // ---- 🖱️ events — ek hi baar delegate (har repaint par re-wire nahi) ----------------------------
  function wireRoot(root) {
    if (rootWired === root) return;
    rootWired = root;
    let model = () => activeModel;

    root.addEventListener('click', (e) => {
      const t = e.target.closest ? e.target : null;
      if (!t) return;
      const m = model();

      const period = t.closest('[data-ua-period]');
      if (period) {
        state.period = period.dataset.uaPeriod;
        if (state.period !== 'custom') { state.from = ''; state.to = ''; }
        root.querySelectorAll('[data-ua-period]').forEach((b) => b.classList.toggle('active', b.dataset.uaPeriod === state.period));
        const cd = U.$('.ua-custom-dates', root);
        if (cd) cd.classList.toggle('active', state.period === 'custom');
        void reanalyze(root);
        return;
      }
      if (t.closest('#ua-apply-dates')) {
        state.from = (U.$('#ua-from', root) || {}).value || '';
        state.to = (U.$('#ua-to', root) || {}).value || '';
        state.period = 'custom';
        void reanalyze(root);
        return;
      }
      const chBtn = t.closest('#ua-ch [data-ch]');
      if (chBtn) {
        state.ch = chBtn.dataset.ch;
        state.tl = '';
        root.querySelectorAll('#ua-ch [data-ch]').forEach((b) => b.classList.toggle('on', b.dataset.ch === state.ch));
        void reanalyze(root);
        return;
      }
      // 🎯 KPI card — drawer TURANT khulta hai (poora page repaint nahi hota, isliye click fast hai)
      const card = t.closest('[data-ua-flag]');
      if (card) {
        const fk = card.dataset.uaFlag;
        state.flag = fk;
        root.querySelectorAll('[data-ua-flag]').forEach((c) => c.classList.toggle('ua-kpi-active', c.dataset.uaFlag === fk));
        if (m) { paintLedger(m); openFlagDrawer(fk, m); }
        return;
      }
      const moreLedger = t.closest('[data-ua-more-ledger]');
      if (moreLedger && m) {
        const from = Number(moreLedger.dataset.uaMoreLedger) || 0;
        const rows = filteredRows(m).slice(from, from + CAP_STEP);
        const body = U.$('#ua-ledger-body', root);
        if (body) body.insertAdjacentHTML('beforeend', rows.map((r, i) => ledgerRowHtml(r, from + i)).join(''));
        const left = filteredRows(m).length - (from + rows.length);
        if (left > 0) moreLedger.dataset.uaMoreLedger = String(from + rows.length);
        else moreLedger.remove();
        return;
      }
      const agent = t.closest('[data-ua-agent-key]');
      if (agent && m) {
        const hit = m.rows.find((r) => r.key === agent.dataset.uaAgentKey);
        if (hit) openAgentForensicDrawer(hit, m);
        return;
      }
      if (t.closest('#ua-csv') && m) { exportCsvData(filteredRows(m), m); return; }
      if (t.closest('#ua-pdf') && m) { void exportPdfData(filteredRows(m), m, t.closest('#ua-pdf')); return; }
      if (t.closest('#ua-dup-csv') && m) {
        const dups = duplicateRowsForView(m);
        const dRows = dups.map((d, i) => [i + 1, d.vrn, d.count, d.agents.join(' | '), d.tls.join(' | '), (d.channels || []).join(' | '), (d.classes || []).join(' | '), (d.dates || []).join(' | '), (d.tagIds || []).join(' | ')]);
        dRows.push(['Grand Total', `${dups.length} VRNs`, U.sum(dups, (d) => d.count), '', '', '', '', '', '']);
        U.downloadCsv(`duplicate-vrns-${m.from}_${m.to}.csv`, ['#', 'VRN', 'Times Issued', 'Agents', 'TLs', 'Channels', 'Classes', 'Dates', 'Tag IDs'], dRows);
        return;
      }
      if (t.closest('#ua-diag') || t.closest('[data-ua-diagnose]')) { if (m) openDiagnose(m); return; }
      if (t.closest('[data-ua-rescan]')) { void reanalyze(root, { fresh: true }); return; }
      if (t.closest('[data-ua-fast]')) {
        state.fastMode = !fastMode();
        try { localStorage.setItem('ff_speed_prefs', JSON.stringify({ ...prefs(), uaFastScan: state.fastMode })); } catch { /* private mode */ }
        U.toast(state.fastMode ? '⚡ Fast mode ON — tag scan skip' : '🔬 Deep scan ON — tag-level scan chalega', 'ok');
        void reanalyze(root, { fresh: !state.fastMode });
        return;
      }
    });

    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest && e.target.closest('[data-ua-flag],[data-ua-agent-key]');
      if (el) { e.preventDefault(); el.click(); }
    });

    root.addEventListener('change', (e) => {
      const m = model();
      const id = e.target.id;
      if (id === 'ua-from' || id === 'ua-to') {
        state.from = (U.$('#ua-from', root) || {}).value || '';
        state.to = (U.$('#ua-to', root) || {}).value || '';
        state.period = 'custom';
        root.querySelectorAll('[data-ua-period]').forEach((b) => b.classList.toggle('active', b.dataset.uaPeriod === 'custom'));
        void reanalyze(root);
      } else if (id === 'ua-tl') { state.tl = e.target.value; if (m) paintAll(m); }
      else if (id === 'ua-mult') { state.mult = Number(e.target.value); void reanalyze(root); }
      else if (id === 'ua-min') { state.min = Number(e.target.value); void reanalyze(root); }
      else if (id === 'ua-only') { state.onlyFlagged = e.target.checked; if (m) paintAll(m); }
    });

    const onSearch = U.debounce((e) => {
      state.q = e.target.value;
      const m = model();
      if (m) { paintKpis(m); paintWatch(m); paintDup(m); paintLedger(m); }   // input khud replace nahi hota → focus rehta hai
    }, 200);
    root.addEventListener('input', (e) => { if (e.target.id === 'ua-q') onSearch(e); });
  }

  /** Drawer ke andar ke actions (document-level, ek hi baar wire). */
  function wireDrawerOnce() {
    if (uaDrawerWired) return;
    uaDrawerWired = true;
    document.addEventListener('click', (e) => {
      const model = activeModel;
      const target = e.target && e.target.closest ? e.target : null;
      if (!target || !model) return;
      const mEv = target.closest('[data-ua-modal-evcsv]');
      if (mEv) { exportEvidenceCsv(metricFor(model, mEv.dataset.uaModalEvcsv), model); return; }
      const mCsv = target.closest('[data-ua-modal-csv]');
      if (mCsv) {
        const fk = mCsv.dataset.uaModalCsv;
        exportCsvData(rowsForFlag(model, fk), model, FLAGS[fk]?.short || fk);
        return;
      }
      const mPdf = target.closest('[data-ua-modal-pdf]');
      if (mPdf) {
        const fk = mPdf.dataset.uaModalPdf;
        void exportPdfData(rowsForFlag(model, fk), model, mPdf, `Unusual Activity · ${FLAGS[fk]?.label || fk}`, metricFor(model, fk));
        return;
      }
      const moreEv = target.closest('[data-ua-more-ev]');
      if (moreEv) { drawerLoadMore('ev', Number(moreEv.dataset.uaMoreEv) || 0); return; }
      const moreAg = target.closest('[data-ua-more-agents]');
      if (moreAg) { drawerLoadMore('agents', Number(moreAg.dataset.uaMoreAgents) || 0); return; }
      const agDiag = target.closest('[data-ua-agent-diagnose]');
      if (agDiag) {
        const hit = model.rows.find((r) => r.key === agDiag.dataset.uaAgentDiagnose);
        if (hit) openDiagnose(model, hit);
        return;
      }
      const dAg = target.closest('[data-ua-drawer-agent]');
      if (dAg) {
        const hit = model.rows.find((r) => r.key === dAg.dataset.uaDrawerAgent);
        if (hit) openAgentForensicDrawer(hit, model);
        return;
      }
      const act = target.closest('[data-ua-act]');
      if (act) {
        const out = U.$('#ua-diag-out');
        const kind = act.dataset.uaAct;
        if (kind === 'rescan') {
          if (out) out.innerHTML = U.spinner('Deep scan (fresh) chal raha hai…');
          state.fastMode = false;
          try { localStorage.setItem('ff_speed_prefs', JSON.stringify({ ...prefs(), uaFastScan: false })); } catch { /* ignore */ }
          const root = U.$('#main') || document.body;
          void reanalyze(root, { fresh: true }).then(() => { if (out) out.innerHTML = `<div class="diag-ok">✅ Fresh scan ho gaya — ${(state.scan && state.scan.via) || 'n/a'} · ${U.fmt(((state.scan && state.scan.meta) || {}).rowsRead || 0)} tag rows.</div>`; });
        } else if (kind === 'fast') {
          state.fastMode = !fastMode();
          try { localStorage.setItem('ff_speed_prefs', JSON.stringify({ ...prefs(), uaFastScan: state.fastMode })); } catch { /* ignore */ }
          const root = U.$('#main') || document.body;
          void reanalyze(root, { fresh: !state.fastMode });
          if (out) out.innerHTML = `<div class="diag-ok">${state.fastMode ? '⚡ Fast mode ON.' : '🔬 Deep scan ON.'} Page dobara analyse ho raha hai…</div>`;
        } else if (kind === 'clearcache') {
          const n = clearScanCache();
          if (out) out.innerHTML = `<div class="diag-ok">🧹 ${U.fmt(n)} cached scan(s) clear — ab re-scan chalega.</div>`;
          U.toast(`${n} cached scan clear ✓`, 'ok');
        } else if (kind === 'sitediag') { void runSiteDiagHere(out); }
        else if (kind === 'cards') { void probeCards(out); }
        else if (kind === 'export') diagnoseCsv(model, null);
        else if (kind === 'copy') { U.copyText(diagnoseText(model, null)); U.toast('Diagnose summary copied ✓', 'ok'); }
      }
    });
  }

  // ---- ♻️ analysis + scan orchestration ---------------------------------------------------------
  async function reanalyze(root, opts) {
    const o = opts || {};
    const daily = S.get('daily') || [];
    const range = resolveRange(daily, state);
    if (!sectionEls) return;
    // 1) turant: cached scan (ya bina scan) se analyse + paint — UI kabhi blank nahi hota
    const cached = fastMode() ? null : readScanCache(range.from, range.to);
    let model = analyze(daily, { ...state, vrnIndex: cached ? cached.index : (state.scan && state.scan.index && state.scan.index.from === range.from && state.scan.index.to === range.to ? state.scan.index : null) });
    model.scanPending = !fastMode() && !model.index;
    activeModel = model;
    if (o.keepShell !== true) {
      // TL list period ke saath badal sakti hai → shell dobara (sasta: sirf skeleton)
      buildShell(root, model);
      wireRoot(root);
    }
    paintAll(model);
    if (!root.isConnected) return;
    // 2) background: tag-level scan (server → browser fallback), phir sirf numbers update
    if (!fastMode() && (!model.index || o.fresh)) await runScanThenPaint(root, range, o);
    return model;
  }

  async function runScanThenPaint(root, range, opts) {
    const seq = ++scanSeq;
    state.scanning = true;
    paintScanBar();
    try {
      await runScan(range.from, range.to, {
        fresh: !!(opts && opts.fresh),
        onProgress: (info) => { if (seq === scanSeq) paintScanBar(info); }
      });
    } catch (err) {
      state.scanError = U.clean(err && err.message) || 'scan failed';
    }
    state.scanning = false;
    if (seq !== scanSeq || !root.isConnected) return;
    const daily = S.get('daily') || [];
    const model = analyze(daily, { ...state, vrnIndex: state.scan && state.scan.index });
    model.scanPending = false;
    activeModel = model;
    paintAll(model);
  }

  async function render(root, params) {
    if (params && params.ch) state.ch = params.ch;
    if (params && params.period) state.period = params.period;
    if (params && params.flag && FLAGS[params.flag]) state.flag = params.flag;
    if (params && params.fast !== undefined) state.fastMode = String(params.fast) === '1';
    root.innerHTML = U.spinner('Forensic anomaly radar load ho raha hai… (EIR + GV Master)');
    await Promise.allSettled([S.need('daily'), G && G.enabled && G.enabled() ? G.need('master') : Promise.resolve()]);
    if (!root.isConnected) return;
    // ⚡ Instant paint — daily aggregates se page turant dikhta hai, tag-level scan background me.
    const daily = S.get('daily') || [];
    const range = resolveRange(daily, state);
    const cached = fastMode() ? null : readScanCache(range.from, range.to);
    let model = analyze(daily, { ...state, vrnIndex: cached ? cached.index : null });
    model.scanPending = !fastMode() && !model.index;
    activeModel = model;
    buildShell(root, model);          // shell baad me — TL dropdown isi model ke TLs se banta hai
    wireRoot(root);
    wireDrawerOnce();
    paintAll(model);
    if (!model.index && !fastMode()) await runScanThenPaint(root, range, {});
  }

  FF.unusual = {
    analyze, resolveRange, loadVrnRecords, runScan, metricFor, evidenceFor, diagnoseData, diagnoseText, openDiagnose,
    probeCards, clearScanCache,
    get vrnFetchInfo() { return state.vrnFetchInfo; },
    get scan() { return state.scan; },
    get state() { return state; },
    get model() { return activeModel; },
    get metrics() { return activeModel ? Object.fromEntries(Object.keys(FLAGS).map((k) => [k, metricFor(activeModel, k)])) : {}; },
    FLAGS, PERIODS, METRICS, CAPS: { ledger: CAP_LEDGER, drawer: CAP_DRAWER, step: CAP_STEP }
  };
  FF.pages.unusual = { title: 'Unusual Activity', render, diagnose: openDiagnose };
})(window.FF);
