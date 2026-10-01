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
   Duplicate VRN Inspector, and Agent Forensic Drawer. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;

  const FLAGS = {
    all:     { icon: '🛡️', label: 'All Flagged Agents', short: 'All Flagged', tone: 'red', desc: 'Agents with at least 1 operational anomaly' },
    multi:   { icon: '🚨', label: 'Multi-Flag Critical', short: 'Multi-Flag', tone: 'red', desc: '2 or more anomaly rules triggered together' },
    double:  { icon: '♊', label: 'Double / Duplicate VRN', short: 'Double VRN', tone: 'red', desc: 'Same VRN issued multiple times (duplicate vehicle number)' },
    wrong:   { icon: '🚫', label: 'High Wrong VRN', short: 'Wrong VRN', tone: 'red', desc: 'Unusually high wrong or invalid VRN entries' },
    replace: { icon: '🔁', label: 'High Replacement', short: 'Replacement', tone: 'amber', desc: 'Replacement ratio far above peer average' },
    chassis: { icon: '🔩', label: 'Excessive Chassis', short: 'Chassis', tone: 'amber', desc: 'Excessive chassis-based issuance without VRN' },
    spike:   { icon: '⚡', label: 'Sudden Day Spike', short: 'Day Spike', tone: 'blue', desc: 'Single-day burst ≥ 3× agent average (min 10 tags)' }
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
    viewMode: 'forensic', // 'forensic' | 'table' | 'duplicates'
    vrnCacheKey: '',
    vrnRecords: [],
    vrnFetchInfo: null
  };
  const VRN_PAGE_SIZE = 25000;
  const VRN_MAX_PAGES = 20;
  let activeModel = null;
  let uaDrawerWired = false;

  const isWrong = (v) => /wrong/i.test(String(v || ''));
  const isChassis = (v) => /chassis/i.test(String(v || ''));
  const isRepl = (t, s) => /replace/i.test(`${t || ''} ${s || ''}`);
  const cleanVrn = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isInvalidVrnFormat = (vrn, vrnType) => {
    if (isChassis(vrnType)) return false;
    const c = cleanVrn(vrn);
    if (!c) return true; // empty VRN is invalid unless the row is explicitly a chassis tag
    if (c.length < 6 || c.length > 13) return true;
    if (/^(0+|1+|9+|TEST|NA|NULL|NONE|UNKNOWN|UNAVAILABLE|XXXX|AAAA)/.test(c)) return true;
    if (/(\d)\1{4,}/.test(c)) return true; // e.g. 00000, 11111
    return false;
  };

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

  /** Pure analyzer — exposed as FF.unusual.analyze(dailyRows, opts) for tests and callers. */
  function analyze(dailyRows, opts) {
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
          doubleVrn: 0, invalidVrn: 0, wrongTagIds: new Set(), invalidTagIds: new Set(), invalidList: [], doubleList: [],
          byDay: new Map(), byClass: new Map()
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

    // Tag-level VRN inspection (Duplicate / Double VRN & Invalid VRN format)
    const vrnRecords = Array.isArray(o.vrnRecords) ? o.vrnRecords.filter((x) => x && x.key >= range.from && x.key <= range.to && (o.ch === 'all' || x.ch === o.ch)) : [];
    const vrnMap = new Map();
    const vrnOccurrenceKey = (rec, v) => rec.tagId
      ? `${rec.ch || 'ff'}|tag:${U.clean(rec.tagId).toUpperCase()}`
      : `${rec.ch || 'ff'}|${rec.key}|${v}|${U.clean(rec.agentId || rec.agentName).toUpperCase()}`;
    for (const rec of vrnRecords) {
      if (isChassis(rec.vrnType)) continue;
      const v = cleanVrn(rec.vrn);
      const invalid = isInvalidVrnFormat(rec.vrn, rec.vrnType);
      if (isWrong(rec.vrnType) || invalid) {
        const a = ensureAgent(rec.ch || 'ff', rec.agentId, rec.agentName, rec.tlName);
        if (a) {
          const occurrence = vrnOccurrenceKey(rec, v);
          if (isWrong(rec.vrnType)) a.wrongTagIds.add(occurrence);
          if (invalid && !a.invalidTagIds.has(occurrence)) {
            a.invalidTagIds.add(occurrence);
            a.invalidList.push({ vrn: U.clean(rec.vrn), tagId: U.clean(rec.tagId), key: rec.key, vrnType: U.clean(rec.vrnType) });
          }
        }
      }
      // Short/malformed values still count as invalid, but placeholders should not generate
      // meaningless duplicate-vehicle alarms.
      if (!v || v.length < 6 || invalid || /^(NA|NULL|NONE|UNKNOWN|UNAVAILABLE|TEST|XXXX|AAAA)$/.test(v)) continue;
      const list = vrnMap.get(v) || [];
      list.push(rec);
      vrnMap.set(v, list);
    }

    const duplicateVrns = [];
    for (const [vrn, list] of vrnMap.entries()) {
      if (list.length < 2) continue;
      const byAg = new Map();
      for (const rec of list) {
        const a = ensureAgent(rec.ch || 'ff', rec.agentId, rec.agentName, rec.tlName);
        if (a) {
          byAg.set(a.key, (byAg.get(a.key) || 0) + 1);
        }
      }
      for (const [agKey, cnt] of byAg.entries()) {
        const a = byAgent.get(agKey);
        if (a) {
          a.doubleVrn += cnt;
          a.doubleList.push({ vrn, count: list.length, agentCount: cnt, dates: U.uniq(list.map((x) => x.key)).sort(), classes: U.uniq(list.map((x) => x.cls)).filter(Boolean), tagIds: U.uniq(list.map((x) => x.tagId)).filter(Boolean) });
        }
      }
      duplicateVrns.push({
        vrn,
        count: list.length,
        agents: U.uniq(list.map((x) => x.agentName || x.agentId)).filter(Boolean),
        tls: U.uniq(list.map((x) => x.tlName)).filter(Boolean),
        channels: U.uniq(list.map((x) => (x.ch === 'gv' ? 'GV' : 'FF'))),
        classes: U.uniq(list.map((x) => x.cls)).filter(Boolean),
        dates: U.uniq(list.map((x) => x.key)).sort(),
        tagIds: U.uniq(list.map((x) => x.tagId)).filter(Boolean)
      });
    }
    duplicateVrns.sort((a, b) => b.count - a.count || a.vrn.localeCompare(b.vrn));

    // Daily EIR aggregates provide exact typed counts; raw VRN rows add malformed/wrong records.
    // Merge by tag ID where possible, so a tag marked both "Wrong" and malformed is not counted twice.
    for (const a of byAgent.values()) {
      const wrongIds = new Set([...a.wrongTagIds, ...a.invalidTagIds]);
      a.invalidVrn = a.invalidTagIds.size;
      a.wrong = Math.max(a.wrongType, wrongIds.size);
      wrongTot += a.wrong;
      invalidTot += a.invalidVrn;
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
      if (a.doubleVrn >= 2 || (a.doubleList && a.doubleList.length >= 1)) {
        flags.push('double');
        reasons.push(`♊ ${U.fmt(a.doubleVrn)} duplicate VRN tags (${a.doubleList.length} VRNs repeated)`);
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
    return {
      rows: out,
      peer,
      cuts: { wrongCut, replCut, chasCut, byChannel: { ff: cutsFor(peerByChannel.ff), gv: cutsFor(peerByChannel.gv) } },
      peerByChannel,
      counts,
      tagSums,
      totals: { tot, vc4Tot, commTot: tot - vc4Tot, wrongTot, invalidTot, replTot, chasTot, doubleTot },
      duplicateVrns,
      from: range.from,
      to: range.to,
      rangeLabel: range.label
    };
  }

  /** Stable tag identity lets GV Master today's live rows and EIR history coexist without duplication. */
  function vrnRecordKey(rec) {
    const ch = rec && rec.ch === 'gv' ? 'gv' : 'ff';
    const tagId = U.clean(rec && rec.tagId).toUpperCase();
    if (tagId) return `${ch}|tag:${tagId}`;
    return `${ch}|${rec && rec.key || ''}|${cleanVrn(rec && rec.vrn)}|${U.clean(rec && (rec.agentId || rec.agentName)).toUpperCase()}`;
  }
  function uniqueVrnRecords(records) {
    const map = new Map();
    for (const rec of records || []) {
      if (!rec || !rec.key || rec.vrn === null || rec.vrn === undefined) continue;
      const key = vrnRecordKey(rec);
      if (!map.has(key)) map.set(key, rec);
      else map.set(key, { ...map.get(key), ...Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== '' && v !== null && v !== undefined)) });
    }
    return [...map.values()];
  }

  /** Collect tag-level VRNs in a range using bounded, offset-based EIR pages. */
  async function loadVrnRecords(from, to) {
    const recs = [];
    if (G && typeof G.rows === 'function') {
      for (const r of G.rows() || []) {
        const key = r.date ? U.dateKey(r.date) : '';
        if (!key || key < from || key > to) continue;
        recs.push({
          ch: 'gv', key, vrn: r.vrn, tagId: r.tagId || r.serial || '', cls: r.cls || 'VC4',
          vrnType: r.tagType || '', agentId: r.agentId || '', agentName: r.agentName || '', tlName: r.tlName || ''
        });
      }
    }
    const cacheKey = `${from}_${to}`;
    if (state.vrnCacheKey === cacheKey) {
      return uniqueVrnRecords(recs.concat(state.vrnRecords));
    }
    const info = { pageSize: VRN_PAGE_SIZE, maxPages: VRN_MAX_PAGES, pages: 0, rowsRead: 0, capHit: false, offsetIssue: false, offsetVerified: false, source: 'GV Master fallback' };
    if (FF.data && typeof FF.data.query === 'function' && FF.config && FF.config.eir) {
      try {
        const e = FF.config.eir;
        const fields = [e.date, e.tagId, e.vrn, e.cls, e.vrnType, e.agentName, e.agentId, e.tlName, e.masterId, e.gvName, e.gvId];
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
              vrnType: D.cellText(r[4]), agentName, agentId, tlName: D.cellText(r[7])
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

  function matchesSearch(r, query) {
    if (!query) return true;
    const vrns = [...(r.doubleList || []).map((x) => x.vrn), ...(r.invalidList || []).map((x) => x.vrn)];
    return `${r.name} ${r.id} ${r.tl} ${r.reasons.join(' ')} ${vrns.join(' ')}`.toLowerCase().includes(query);
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
    const visibleKeys = new Set(scopedRows(model).map((r) => r.key));
    const visibleVrns = new Set(model.rows.filter((r) => visibleKeys.has(r.key)).flatMap((r) => (r.doubleList || []).map((d) => d.vrn)));
    return model.duplicateVrns.filter((d) => visibleVrns.has(d.vrn));
  }

  function exportCsvData(rows, model, titleSuffix) {
    const head = ['Channel', 'Agent Name', 'Agent ID', 'TL Name', 'Risk Score', 'Severity', 'Total Issued', 'VC4', 'Commercial', 'Double VRN', 'Wrong / Invalid VRN', 'Malformed VRN', 'Wrong %', 'Replacement', 'Replace %', 'Chassis', 'Chassis %', 'Active Days', 'Avg/Day', 'Max Day', 'Max Day Date', 'Spike ×', 'Flags', 'Forensic Reasons'];
    const body = rows.map((r) => [
      r.channel.toUpperCase(), r.name, r.id, r.tl, r.score, r.severity,
      r.total, r.vc4, r.comm, r.doubleVrn, r.wrong, r.invalidVrn, r.wrongPct.toFixed(1),
      r.replace, r.replacePct.toFixed(1), r.chassis, r.chassisPct.toFixed(1),
      r.days, r.avg.toFixed(1), r.maxDay, r.maxDate, r.spikeRatio.toFixed(1),
      r.flags.map((f) => FLAGS[f]?.short || f).join(' + '),
      r.reasons.join(' | ')
    ]);
    const totIssued = U.sum(rows, (r) => r.total);
    const totVc4 = U.sum(rows, (r) => r.vc4);
    const totComm = U.sum(rows, (r) => r.comm);
    const totDbl = U.sum(rows, (r) => r.doubleVrn);
    const totWrong = U.sum(rows, (r) => r.wrong);
    const totInvalid = U.sum(rows, (r) => r.invalidVrn);
    const totRepl = U.sum(rows, (r) => r.replace);
    const totChas = U.sum(rows, (r) => r.chassis);
    body.push([
      'GRAND TOTAL', `${rows.length} Agents`, '', '', '', '',
      totIssued, totVc4, totComm, totDbl,
      totWrong, totInvalid, totIssued ? ((totWrong / totIssued) * 100).toFixed(1) : '0.0',
      totRepl, totIssued ? ((totRepl / totIssued) * 100).toFixed(1) : '0.0',
      totChas, totIssued ? ((totChas / totIssued) * 100).toFixed(1) : '0.0',
      '', '', '', '', '', '', `${model.from} to ${model.to}`
    ]);
    U.downloadCsv(`unusual-activity-${U.slug(titleSuffix || state.flag)}-${model.from}_${model.to}.csv`, head, body);
  }

  async function exportPdfData(rows, model, btn, titleOverride) {
    try {
      if (!FF.pdf && FF.lazy && FF.lazy.loadScript) await FF.lazy.loadScript('pdf.js');
      if (!FF.pdf) { U.toast('PDF module load nahi hua', 'err'); return; }
      if (btn) U.setButtonBusy(btn, true, 'PDF…');
      const totIssued = U.sum(rows, (r) => r.total);
      const totDbl = U.sum(rows, (r) => r.doubleVrn);
      const totWrong = U.sum(rows, (r) => r.wrong);
      const totInvalid = U.sum(rows, (r) => r.invalidVrn);
      const totRepl = U.sum(rows, (r) => r.replace);
      const totChas = U.sum(rows, (r) => r.chassis);
      const kpiHtml = `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px">
        ${[
          ['Flagged Agents', U.fmt(rows.length), `${model.rangeLabel}`],
          ['Issued Tags', U.fmt(totIssued), `VC4 ${U.fmt(U.sum(rows, (r) => r.vc4))}`],
          ['Double VRN', U.fmt(totDbl), `${U.fmt(model.counts.double)} agents`],
          ['Wrong / Invalid VRN', U.fmt(totWrong), `${U.fmt(totInvalid)} malformed · peer ${model.peer.wrongPct.toFixed(1)}%`],
          ['Replacements', U.fmt(totRepl), `Peer ${model.peer.replacePct.toFixed(1)}%`],
          ['Chassis Tags', U.fmt(totChas), `Peer ${model.peer.chassisPct.toFixed(1)}%`]
        ].map(([l, v, s]) => `<div style="border:1px solid #cbd5e1;border-radius:8px;padding:8px;background:#f8fafc;text-align:center"><div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">${esc(l)}</div><div style="font-size:15px;font-weight:800;color:#0f172a;margin:2px 0">${esc(v)}</div><div style="font-size:9.5px;color:#475569">${esc(s)}</div></div>`).join('')}
      </div>`;
      const tblHtml = `<table style="width:100%;border-collapse:collapse;font-size:10px">
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
            <td style="padding:6px 5px;text-align:right">${U.fmt(totDbl)}</td>
            <td style="padding:6px 5px;text-align:right">${U.fmt(totWrong)}</td>
            <td style="padding:6px 5px;text-align:right">${U.fmt(totInvalid)}</td>
            <td style="padding:6px 5px;text-align:right">${U.fmt(totRepl)}</td>
            <td style="padding:6px 5px;text-align:right">${U.fmt(totChas)}</td>
            <td colspan="2" style="padding:6px 5px">Period: ${esc(model.from)} → ${esc(model.to)}</td>
          </tr>
        </tbody>
      </table>`;
      const page = FF.pdf.doc({
        title: titleOverride || `Unusual Activity Forensic Report · ${FLAGS[state.flag]?.label || 'All'}`,
        sub: `${model.rangeLabel} · ${rows.length} agents · Peer Wrong VRN ${model.peer.wrongPct.toFixed(1)}% · Replace ${model.peer.replacePct.toFixed(1)}% · Chassis ${model.peer.chassisPct.toFixed(1)}%`,
        meta: `Generated ${new Date().toLocaleString('en-IN')}`,
        body: kpiHtml + tblHtml
      });
      await FF.pdf.download([page], `unusual-activity-${U.slug(titleOverride || state.flag)}-${model.from}_${model.to}.pdf`);
      U.toast('Forensic PDF downloaded ✓', 'ok');
    } catch (err) {
      U.toast((err && err.message) || 'PDF export failed', 'err');
    } finally {
      if (btn) U.setButtonBusy(btn, false);
    }
  }

  /** Clicking any KPI card on Unusual Activity opens a dedicated drawer with that exact anomaly's data + CSV/PDF. */
  function openFlagDrawer(flagKey, model) {
    const fMeta = FLAGS[flagKey] || FLAGS.all;
    const rows = rowsForFlag(model, flagKey);
    const rowVrns = new Set(rows.flatMap((r) => (r.doubleList || []).map((d) => d.vrn)));
    const totIssued = U.sum(rows, (r) => r.total);
    const totDbl = U.sum(rows, (r) => r.doubleVrn);
    const totWrong = U.sum(rows, (r) => r.wrong);
    const totInvalid = U.sum(rows, (r) => r.invalidVrn);
    const totRepl = U.sum(rows, (r) => r.replace);
    const totChas = U.sum(rows, (r) => r.chassis);
    const duplicateRows = flagKey === 'double' ? model.duplicateVrns.filter((d) => rowVrns.has(d.vrn)) : [];

    const kpisHtml = `<div class="dkpis" style="margin-bottom:12px">
      <div class="dkpi"><small>Flagged Agents</small><b>${U.fmt(rows.length)}</b><span>${esc(fMeta.short)}</span></div>
      <div class="dkpi"><small>Total Issued</small><b>${U.fmt(totIssued)}</b><span>VC4 ${U.fmt(U.sum(rows, (r) => r.vc4))} · Comm ${U.fmt(U.sum(rows, (r) => r.comm))}</span></div>
      <div class="dkpi"><small>Double VRN</small><b>${U.fmt(totDbl)}</b><span>Duplicate vehicle numbers</span></div>
      <div class="dkpi"><small>Wrong / Invalid VRN</small><b>${U.fmt(totWrong)}</b><span>${U.fmt(totInvalid)} malformed · peer ${model.peer.wrongPct.toFixed(1)}%</span></div>
      <div class="dkpi"><small>Replacement / Chassis</small><b>${U.fmt(totRepl)} / ${U.fmt(totChas)}</b><span>Repl ${model.peer.replacePct.toFixed(1)}% · Chas ${model.peer.chassisPct.toFixed(1)}%</span></div>
    </div>`;

    const dupSection = flagKey === 'double' && duplicateRows.length
      ? `<section class="dsec"><h4>♊ Duplicate VRN Register (${U.fmt(duplicateRows.length)} Vehicles)</h4>
          <div class="table-wrap"><table class="tbl compact">
            <thead><tr><th>#</th><th>VRN (Vehicle No.)</th><th class="num">Times Issued</th><th>Agents Involved</th><th>TL</th><th>Classes</th><th>Dates</th></tr></thead>
            <tbody>
              ${duplicateRows.slice(0, 100).map((d, i) => `<tr>
                <td class="dim">${i + 1}</td>
                <td><b class="code-chip">${esc(d.vrn)}</b></td>
                <td class="num"><b class="count red">${U.fmt(d.count)}×</b></td>
                <td><b>${esc(d.agents.join(', ') || '—')}</b></td>
                <td>${esc(d.tls.join(', ') || '—')}</td>
                <td>${esc(d.classes.join(', ') || '—')}</td>
                <td class="dim small">${esc(d.dates.join(', '))}</td>
              </tr>`).join('')}
              <tr class="row-total"><td colspan="2"><b>Grand Total (${duplicateRows.length} VRNs)</b></td><td class="num"><b>${U.fmt(U.sum(duplicateRows, (d) => d.count))}</b></td><td colspan="4"></td></tr>
            </tbody>
          </table></div></section>`
      : '';

    const tableSection = `<section class="dsec"><h4>${fMeta.icon} ${esc(fMeta.label)} — Agent Breakdown (${U.fmt(rows.length)})</h4>
      <p class="dim small">${esc(fMeta.desc)} · Kisi bhi agent row par click karo → uska poora forensic breakdown khulega.</p>
      <div class="table-wrap"><table class="tbl compact">
        <thead><tr>
          <th>#</th><th>Ch</th><th>Agent</th><th>TL</th>
          <th class="num">Risk Score</th><th class="num">Issued</th>
          <th class="num">Double VRN</th><th class="num">Wrong / Invalid</th><th class="num">Malformed</th>
          <th class="num">Replace</th><th class="num">Chassis</th>
          <th class="num">Peak Day</th><th>Forensic Evidence</th>
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => `<tr class="clickable" data-ua-drawer-agent="${esc(r.key)}">
            <td class="dim">${i + 1}</td>
            <td><span class="kd-badge ${r.channel}">${r.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span></td>
            <td><b>${esc(r.name)}</b>${r.id ? ` <small class="dim">${esc(r.id)}</small>` : ''}</td>
            <td>${esc(r.tl || '—')}</td>
            <td class="num"><span class="count ${r.score >= 60 ? 'red' : 'amber'}">${r.score}</span></td>
            <td class="num"><b>${U.fmt(r.total)}</b></td>
            <td class="num">${r.doubleVrn ? `<b class="count red">${U.fmt(r.doubleVrn)}</b>` : '<span class="dim">0</span>'}</td>
            <td class="num">${U.fmt(r.wrong)} <small class="dim">(${r.wrongPct.toFixed(0)}%)</small></td>
            <td class="num">${U.fmt(r.invalidVrn)}</td>
            <td class="num">${U.fmt(r.replace)} <small class="dim">(${r.replacePct.toFixed(0)}%)</small></td>
            <td class="num">${U.fmt(r.chassis)} <small class="dim">(${r.chassisPct.toFixed(0)}%)</small></td>
            <td class="num">${U.fmt(r.maxDay)} <small class="dim">(${r.spikeRatio.toFixed(1)}×)</small></td>
            <td class="small">${esc(r.reasons.join(' · ') || '—')}</td>
          </tr>`).join('') || '<tr><td colspan="13" class="empty">Is anomaly category me koi agent nahi mila.</td></tr>'}
        </tbody>
        ${rows.length ? `<tfoot><tr class="row-total">
          <td colspan="5"><b>Grand Total (${rows.length} Agents)</b></td>
          <td class="num"><b>${U.fmt(totIssued)}</b></td>
          <td class="num"><b>${U.fmt(totDbl)}</b></td>
          <td class="num"><b>${U.fmt(totWrong)}</b></td>
          <td class="num"><b>${U.fmt(totInvalid)}</b></td>
          <td class="num"><b>${U.fmt(totRepl)}</b></td>
          <td class="num"><b>${U.fmt(totChas)}</b></td>
          <td colspan="2"></td>
        </tr></tfoot>` : ''}
      </table></div></section>`;

    FF.app.openDrawer({
      kicker: `Forensic Anomaly Drill-Down · ${model.rangeLabel}`,
      title: `${fMeta.icon} ${fMeta.label}`,
      sub: `<b>${U.fmt(rows.length)}</b> agents flagged · <b>${U.fmt(totIssued)}</b> total tags issued in period (${esc(model.from)} → ${esc(model.to)})`,
      wide: true,
      actions: `<button class="btn small" data-ua-modal-csv="${esc(flagKey)}">⬇ CSV</button><button class="btn small primary" data-ua-modal-pdf="${esc(flagKey)}">📄 PDF</button>`,
      body: kpisHtml + dupSection + tableSection,
      age: false
    });
  }

  /** Clicking any agent opens the deep Agent Forensic Investigation Drawer. */
  function openAgentForensicDrawer(r, model) {
    if (!r) return;
    const days = [...r.byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const classes = [...r.byClass.entries()].sort((a, b) => b[1] - a[1]);
    const kpiSpecBase = `src=${r.channel}&scope=range&from=${encodeURIComponent(model.from)}&to=${encodeURIComponent(model.to)}&agent=${encodeURIComponent(r.name)}&agentId=${encodeURIComponent(r.id || '')}&channel=${r.channel}`;

    const topKpis = `<div class="dkpis" style="margin-bottom:12px">
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&title=${encodeURIComponent(`${r.name} · Total Issued`)}`)}" title="Click to open tag-level issuance breakdown"><small>Total Issued</small><b>${U.fmt(r.total)}</b><span>VC4 ${U.fmt(r.vc4)} · Comm ${U.fmt(r.comm)}</span></div>
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&f=wrong&title=${encodeURIComponent(`${r.name} · Wrong / Invalid VRN`)}`)}" title="Click to open wrong and invalid VRN tags"><small>Wrong / Invalid VRN</small><b>${U.fmt(r.wrong)}</b><span>${U.fmt(r.invalidVrn)} malformed · ${r.wrongPct.toFixed(1)}% vs ${r.channel.toUpperCase()} peer ${r.peer.wrongPct.toFixed(1)}%</span></div>
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&f=repl&title=${encodeURIComponent(`${r.name} · Replacements`)}`)}" title="Click to open Replacement tags"><small>Replacements</small><b>${U.fmt(r.replace)}</b><span>${r.replacePct.toFixed(1)}% vs peer ${r.peer.replacePct.toFixed(1)}%</span></div>
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&f=chassis&title=${encodeURIComponent(`${r.name} · Chassis Tags`)}`)}" title="Click to open Chassis tags"><small>Chassis Tags</small><b>${U.fmt(r.chassis)}</b><span>${r.chassisPct.toFixed(1)}% vs peer ${r.peer.chassisPct.toFixed(1)}%</span></div>
      <div class="dkpi"><small>Double VRN / Peak</small><b>${U.fmt(r.doubleVrn)} / ${U.fmt(r.maxDay)}</b><span>Peak ${esc(r.maxDate || '—')} (${r.spikeRatio.toFixed(1)}× avg)</span></div>
    </div>`;

    const reasonsHtml = `<section class="dsec"><h4>🚨 Forensic Anomaly Findings (Risk Score: <span class="count ${r.score >= 60 ? 'red' : 'amber'}">${r.score}/100 · ${esc(r.severity)}</span>)</h4>
      ${r.reasons.length ? `<ul style="margin:6px 0 0 18px;line-height:1.6">${r.reasons.map((rs) => `<li><b>${esc(rs)}</b></li>`).join('')}</ul>` : '<p class="dim">Is period me koi anomaly threshold cross nahi hua.</p>'}
    </section>`;

    const dupHtml = r.doubleList && r.doubleList.length
      ? `<section class="dsec"><h4>♊ Duplicate VRNs Issued by ${esc(r.name)} (${r.doubleList.length})</h4>
          <div class="table-wrap"><table class="tbl compact">
            <thead><tr><th>#</th><th>VRN</th><th class="num">Total Count</th><th class="num">By This Agent</th><th>Classes</th><th>Dates</th><th>Tag IDs</th></tr></thead>
            <tbody>${r.doubleList.map((d, i) => `<tr><td class="dim">${i + 1}</td><td><b class="code-chip">${esc(d.vrn)}</b></td><td class="num"><b class="count red">${U.fmt(d.count)}×</b></td><td class="num"><b>${U.fmt(d.agentCount)}</b></td><td>${esc(d.classes.join(', '))}</td><td class="dim small">${esc(d.dates.join(', '))}</td><td class="dim small">${esc(d.tagIds.slice(0, 4).join(', '))}</td></tr>`).join('')}
            <tr class="row-total"><td colspan="2"><b>Grand Total</b></td><td class="num"><b>${U.fmt(U.sum(r.doubleList, (d) => d.count))}</b></td><td class="num"><b>${U.fmt(U.sum(r.doubleList, (d) => d.agentCount))}</b></td><td colspan="3"></td></tr></tbody>
          </table></div></section>`
      : '';

    const invalidHtml = r.invalidList && r.invalidList.length
      ? `<section class="dsec"><h4>🧾 Malformed / Invalid VRN Samples (${U.fmt(r.invalidList.length)})</h4>
          <p class="dim small">Repeated placeholder values are excluded from duplicate-VRN counts. Tag ID par click karo to exact source row khulegi.</p>
          <div class="table-wrap"><table class="tbl compact"><thead><tr><th>#</th><th>Date</th><th>VRN entered</th><th>Type</th><th>Tag ID</th></tr></thead>
          <tbody>${r.invalidList.slice(0, 100).map((item, i) => {
            const tagSpec = item.tagId ? `src=${r.channel}&scope=range&from=${encodeURIComponent(model.from)}&to=${encodeURIComponent(model.to)}&agent=${encodeURIComponent(r.name)}&agentId=${encodeURIComponent(r.id || '')}&channel=${r.channel}&tagId=${encodeURIComponent(item.tagId)}&date=${encodeURIComponent(item.key)}&title=${encodeURIComponent(`${r.name} · Tag ${item.tagId}`)}` : '';
            return `<tr${tagSpec ? ` class="clickable" role="button" tabindex="0" data-kpi="${esc(tagSpec)}"` : ''}><td class="dim">${i + 1}</td><td>${esc(item.key || '—')}</td><td><b class="code-chip">${esc(item.vrn || '(blank)')}</b></td><td>${esc(item.vrnType || '—')}</td><td>${esc(item.tagId || '—')}</td></tr>`;
          }).join('')}</tbody></table></div>
          ${r.invalidList.length > 100 ? `<p class="dim small">Showing first 100 of ${U.fmt(r.invalidList.length)} malformed rows.</p>` : ''}</section>`
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
        <tbody>${days.map(([dt, n]) => `<tr class="clickable" data-kpi="${esc(`src=${r.channel}&scope=day&date=${encodeURIComponent(dt)}&agent=${encodeURIComponent(r.name)}&agentId=${encodeURIComponent(r.id || '')}&channel=${r.channel}&title=${encodeURIComponent(`${r.name} · ${dt}`)}`)}"><td><b>${esc(U.labelDateKey(dt, true))}</b></td><td class="num"><b>${U.fmt(n)}</b></td><td class="num">${r.avg > 0 ? `${(n / r.avg).toFixed(1)}×` : '—'}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="row-total"><td><b>Grand Total (${days.length} days)</b></td><td class="num"><b>${U.fmt(r.total)}</b></td><td class="num"><b>${r.avg.toFixed(1)}/day</b></td></tr></tfoot>
      </table></div></section>`;

    FF.app.openDrawer({
      kicker: `Agent Forensic Profile · ${r.channel === 'gv' ? '🟩 GV Partner' : '🟦 First Forward'}`,
      title: `${r.name}${r.id ? ` (${r.id})` : ''}`,
      sub: `TL: <b>${esc(r.tl || 'Direct')}</b> · Period: ${esc(model.from)} → ${esc(model.to)} · Risk Score <b>${r.score}/100</b>`,
      wide: true,
      actions: `<button class="btn small" data-kpi="${esc(`${kpiSpecBase}&title=${encodeURIComponent(`${r.name} · All Tags`)}`)}">📄 Tag-Level Rows</button><a class="btn small" href="#/${r.channel === 'gv' ? 'gvAgentSummary' : 'ffAgentSummary'}?q=${encodeURIComponent(r.name)}">🧑‍💼 Agent Summary →</a>`,
      body: topKpis + reasonsHtml + dupHtml + invalidHtml + `<div class="grid g-2">${clsHtml}${dayHtml}</div>`,
      age: { kind: 'agent', key: r.id || r.name, keys: [r.id, r.name].filter(Boolean), ch: r.channel, title: r.name }
    });
  }

  function renderBody(root, model) {
    const scoped = scopedRows(model);
    const tls = [...new Set(model.rows.map((r) => r.tl).filter(Boolean))].sort();
    const rows = filteredRows(model);
    const topFlagged = rows.filter((r) => r.flags.length > 0).slice(0, 6);
    const visibleDuplicateRows = duplicateRowsForView(model);
    const kpiData = Object.fromEntries(Object.keys(FLAGS).map((key) => {
      const subset = key === 'all' ? scoped.filter((r) => r.flags.length) : scoped.filter((r) => r.flags.includes(key));
      const value = key === 'all' || key === 'multi' ? U.sum(subset, (r) => r.total)
        : key === 'double' ? U.sum(subset, (r) => r.doubleVrn)
          : key === 'wrong' ? U.sum(subset, (r) => r.wrong)
            : key === 'replace' ? U.sum(subset, (r) => r.replace)
              : key === 'chassis' ? U.sum(subset, (r) => r.chassis)
                : U.sum(subset, (r) => r.maxDay);
      return [key, { count: subset.length, tagSum: value }];
    }));

    const periodPills = PERIODS.map(([k, label]) =>
      `<button type="button" class="ua-period-pill ${state.period === k ? 'active' : ''}" data-ua-period="${k}">${label}</button>`
    ).join('');
    const fetchInfo = model.vrnFetchInfo || {};
    const pagingNote = fetchInfo.offsetIssue
      ? `⚠ EIR offset paging returned a repeated page after ${U.fmt(fetchInfo.rowsRead)} rows. Tag-level VRN details may be incomplete; narrow the date range or use the EIR report to verify.`
      : fetchInfo.capHit
        ? `⚠ Safety cap reached: ${VRN_MAX_PAGES} × ${U.fmt(VRN_PAGE_SIZE)} = ${U.fmt(VRN_MAX_PAGES * VRN_PAGE_SIZE)} EIR rows. More records exist beyond the cap; duplicate/malformed-VRN counts may be incomplete. Narrow the date range.`
        : fetchInfo.probeFailed
          ? `⚠ Read ${U.fmt(fetchInfo.rowsRead)} EIR rows (${fetchInfo.pages}/${VRN_MAX_PAGES} pages); the safety-cap probe failed, so completeness could not be confirmed.`
          : fetchInfo.source === 'EIR'
            ? `EIR tag-level scan: ${U.fmt(fetchInfo.rowsRead)} rows across ${fetchInfo.pages} page(s). Limit: ${VRN_MAX_PAGES} pages × ${U.fmt(VRN_PAGE_SIZE)} rows (${U.fmt(VRN_MAX_PAGES * VRN_PAGE_SIZE)} max); offset ${fetchInfo.offsetVerified ? 'verified across pages' : 'not verifiable from this range'}. `
            : '⚠ EIR tag-level VRN query is unavailable; duplicate/malformed checks use available GV Master rows only. Aggregate ratio analysis remains active.';

    const kpiCards = Object.entries(FLAGS).map(([k, f]) => {
      const count = kpiData[k].count;
      const tagSum = kpiData[k].tagSum;
      const active = state.flag === k;
      return `<div class="kpi ua-kpi-card ${f.tone} ${active ? 'ua-kpi-active' : ''}" data-ua-flag="${k}" role="button" tabindex="0" title="Click to filter & open ${esc(f.label)} breakdown with CSV/PDF">
        <div class="kpi-top"><span class="kpi-title">${esc(f.label)}</span><span class="kpi-icon">${f.icon}</span></div>
        <div class="kpi-value">${U.fmt(count)} <small class="dim" style="font-size:12px;font-weight:600">agents</small></div>
        <div class="kpi-foot"><b>${U.fmt(tagSum)}</b> tags · <span class="ua-kpi-cta">Click for data & CSV/PDF →</span></div>
      </div>`;
    }).join('');

    // Top Watchlist Forensic Cards
    const watchlistHtml = topFlagged.length ? `<section class="card ua-watchlist-card">
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
    </section>` : '';

    // Duplicate VRN Register Card
    const dupCardHtml = visibleDuplicateRows.length ? `<section class="card">
      <div class="card-head">
        <h3>♊ Double / Duplicate VRN Radar — ${U.fmt(visibleDuplicateRows.length)} Vehicles Issued Multiple Times</h3>
        <div class="card-right">
          <button class="btn small" id="ua-dup-csv">⬇ Duplicate VRN CSV</button>
        </div>
      </div>
      <div class="card-body">
        <div class="table-wrap"><table class="tbl compact">
          <thead><tr><th>#</th><th>VRN (Vehicle Number)</th><th class="num">Times Issued</th><th>Agents Involved</th><th>TL</th><th>Channel</th><th>Classes</th><th>Dates</th></tr></thead>
          <tbody>
            ${visibleDuplicateRows.slice(0, 30).map((d, i) => `<tr>
              <td class="dim">${i + 1}</td>
              <td><b class="code-chip">${esc(d.vrn)}</b></td>
              <td class="num"><b class="count red">${U.fmt(d.count)}×</b></td>
              <td><b>${esc(d.agents.join(', ') || '—')}</b></td>
              <td>${esc(d.tls.join(', ') || '—')}</td>
              <td>${esc(d.channels.join(', '))}</td>
              <td>${esc(d.classes.join(', '))}</td>
              <td class="dim small">${esc(d.dates.join(', '))}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr class="row-total"><td colspan="2"><b>Grand Total (${visibleDuplicateRows.length} duplicate VRNs)</b></td><td class="num"><b>${U.fmt(U.sum(visibleDuplicateRows, (d) => d.count))}</b></td><td colspan="5"></td></tr></tfoot>
        </table></div>
      </div>
    </section>` : '';

    const totIssued = U.sum(rows, (r) => r.total);
    const totVc4 = U.sum(rows, (r) => r.vc4);
    const totComm = U.sum(rows, (r) => r.comm);
    const totDbl = U.sum(rows, (r) => r.doubleVrn);
    const totWrong = U.sum(rows, (r) => r.wrong);
    const totInvalid = U.sum(rows, (r) => r.invalidVrn);
    const totRepl = U.sum(rows, (r) => r.replace);
    const totChas = U.sum(rows, (r) => r.chassis);

    root.innerHTML = `
      <div class="page-head ua-head">
        <div class="ua-head-copy">
          <span class="ua-kicker">Cross-channel · forensic signal center</span>
          <h1>🚨 Unusual Agent Activity & Fraud Radar</h1>
          <p class="sub">${esc(model.rangeLabel)} · <b>${U.fmt(kpiData.all.count)}</b> agents flagged in this view (${U.fmt(scoped.length)} agents) · Peer benchmark: Wrong / Invalid VRN <b>${model.peer.wrongPct.toFixed(1)}%</b> · Replace <b>${model.peer.replacePct.toFixed(1)}%</b> · Chassis <b>${model.peer.chassisPct.toFixed(1)}%</b></p>
        </div>
        <div class="head-actions">
          <button class="btn" id="ua-csv">⬇ CSV (${U.fmt(rows.length)})</button>
          <button class="btn primary" id="ua-pdf">📄 PDF Report</button>
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
        <div class="ua-data-note ${fetchInfo.capHit || fetchInfo.offsetIssue || fetchInfo.probeFailed || fetchInfo.source !== 'EIR' ? 'warning' : ''}" role="status" aria-live="polite">ℹ️ Date presets use calendar dates (not the latest data date). First Forward EIR can arrive with a one-day reporting delay; GV includes live Master rows. ${esc(pagingNote)}</div>
      </section>

      <div class="kpi-grid ua-kpi-grid">${kpiCards}</div>

      ${watchlistHtml}
      ${dupCardHtml}

      <section class="card">
        <div class="card-head">
          <h3>📋 Forensic Anomaly Ledger — ${esc(FLAGS[state.flag]?.label || 'All')} (${U.fmt(rows.length)} Agents)</h3>
          <div class="card-right">
            <span class="dim small">Click any row for Agent Forensic Drawer · Click KPI cards above for category drill-down</span>
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
            <tbody>
              ${rows.slice(0, 250).map((r, idx) => `<tr class="clickable" data-ua-agent-key="${esc(r.key)}">
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
              </tr>`).join('') || `<tr><td colspan="14" class="empty">🎉 Selected filters aur period me koi unusual activity nahi mili.</td></tr>`}
            </tbody>
            ${rows.length ? `<tfoot><tr class="row-total">
              <td colspan="5"><b>Grand Total (${U.fmt(rows.length)} Agents)</b></td>
              <td class="num"><b>${U.fmt(totIssued)}</b></td>
              <td class="num"><b>${U.fmt(totVc4)} / ${U.fmt(totComm)}</b></td>
              <td class="num"><b>${U.fmt(totDbl)}</b></td>
              <td class="num"><b>${U.fmt(totWrong)} (${totIssued ? ((totWrong / totIssued) * 100).toFixed(1) : '0.0'}%)</b></td>
              <td class="num"><b>${U.fmt(totInvalid)}</b></td>
              <td class="num"><b>${U.fmt(totRepl)} (${totIssued ? ((totRepl / totIssued) * 100).toFixed(1) : '0.0'}%)</b></td>
              <td class="num"><b>${U.fmt(totChas)} (${totIssued ? ((totChas / totIssued) * 100).toFixed(1) : '0.0'}%)</b></td>
              <td colspan="2">Period: ${esc(model.from)} → ${esc(model.to)}</td>
            </tr></tfoot>` : ''}
          </table></div>
        </div>
      </section>`;

    if (FF.app && FF.app.enhanceTables) FF.app.enhanceTables(root);
  }

  async function render(root, params) {
    if (params && params.ch) state.ch = params.ch;
    if (params && params.period) state.period = params.period;
    root.innerHTML = U.spinner('Forensic anomaly radar load ho raha hai… (EIR + GV Master)');
    await Promise.allSettled([S.need('daily'), G && G.enabled && G.enabled() ? G.need('master') : Promise.resolve()]);
    if (!root.isConnected) return;

    const daily = S.get('daily') || [];
    let currentModel = null;

    const runAnalysis = async () => {
      const prelim = resolveRange(daily, state);
      const vrnRecords = await loadVrnRecords(prelim.from, prelim.to);
      currentModel = analyze(daily, { ...state, vrnRecords });
      currentModel.vrnFetchInfo = state.vrnFetchInfo || null;
      if (!root.isConnected) return;
      activeModel = currentModel;
      renderBody(root, currentModel);
      wireEvents();
    };

    const wireEvents = () => {
      root.querySelectorAll('[data-ua-period]').forEach((btn) => btn.addEventListener('click', () => {
        state.period = btn.dataset.uaPeriod;
        if (state.period !== 'custom') { state.from = ''; state.to = ''; }
        runAnalysis();
      }));
      const applyBtn = U.$('#ua-apply-dates', root);
      if (applyBtn) {
        applyBtn.addEventListener('click', () => {
          state.from = U.$('#ua-from', root)?.value || '';
          state.to = U.$('#ua-to', root)?.value || '';
          state.period = 'custom';
          runAnalysis();
        });
      }
      ['#ua-from', '#ua-to'].forEach((sel) => {
        const inp = U.$(sel, root);
        if (inp) inp.addEventListener('change', () => {
          state.from = U.$('#ua-from', root)?.value || '';
          state.to = U.$('#ua-to', root)?.value || '';
          state.period = 'custom';
          runAnalysis();
        });
      });
      root.querySelectorAll('#ua-ch [data-ch]').forEach((b) => b.addEventListener('click', () => {
        state.ch = b.dataset.ch;
        state.tl = '';
        runAnalysis();
      }));
      root.querySelectorAll('[data-ua-flag]').forEach((card) => card.addEventListener('click', () => {
        const fk = card.dataset.uaFlag;
        state.flag = fk;
        renderBody(root, currentModel);
        wireEvents();
        openFlagDrawer(fk, currentModel);
      }));
      const tlSel = U.$('#ua-tl', root);
      if (tlSel) tlSel.addEventListener('change', (e) => { state.tl = e.target.value; renderBody(root, currentModel); wireEvents(); });
      const multSel = U.$('#ua-mult', root);
      if (multSel) multSel.addEventListener('change', (e) => { state.mult = Number(e.target.value); runAnalysis(); });
      const minSel = U.$('#ua-min', root);
      if (minSel) minSel.addEventListener('change', (e) => { state.min = Number(e.target.value); runAnalysis(); });
      const onlyChk = U.$('#ua-only', root);
      if (onlyChk) onlyChk.addEventListener('change', (e) => { state.onlyFlagged = e.target.checked; renderBody(root, currentModel); wireEvents(); });
      const qInp = U.$('#ua-q', root);
      if (qInp) qInp.addEventListener('input', U.debounce((e) => {
        state.q = e.target.value;
        renderBody(root, currentModel);
        wireEvents();
        const again = U.$('#ua-q', root);
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 220));
      const csvBtn = U.$('#ua-csv', root);
      if (csvBtn) csvBtn.addEventListener('click', () => exportCsvData(filteredRows(currentModel), currentModel));
      const pdfBtn = U.$('#ua-pdf', root);
      if (pdfBtn) pdfBtn.addEventListener('click', () => exportPdfData(filteredRows(currentModel), currentModel, pdfBtn));
      const dupCsvBtn = U.$('#ua-dup-csv', root);
      if (dupCsvBtn) dupCsvBtn.addEventListener('click', () => {
        const dups = duplicateRowsForView(currentModel);
        const dRows = dups.map((d, i) => [i + 1, d.vrn, d.count, d.agents.join(' | '), d.tls.join(' | '), d.channels.join(' | '), d.classes.join(' | '), d.dates.join(' | '), d.tagIds.join(' | ')]);
        dRows.push(['Grand Total', `${dups.length} VRNs`, U.sum(dups, (d) => d.count), '', '', '', '', '', '']);
        U.downloadCsv(`duplicate-vrns-${currentModel.from}_${currentModel.to}.csv`, ['#', 'VRN', 'Times Issued', 'Agents', 'TLs', 'Channels', 'Classes', 'Dates', 'Tag IDs'], dRows);
      });
      root.querySelectorAll('[data-ua-agent-key]').forEach((el) => {
        const open = () => {
          const hit = currentModel.rows.find((r) => r.key === el.dataset.uaAgentKey);
          if (hit) openAgentForensicDrawer(hit, currentModel);
        };
        el.addEventListener('click', open);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
      root.querySelectorAll('[data-ua-flag]').forEach((el) => el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      }));
    };

    if (!uaDrawerWired) {
      uaDrawerWired = true;
      document.addEventListener('click', (e) => {
        const model = activeModel;
        const target = e.target && e.target.closest ? e.target : e.target && e.target.parentElement;
        if (!model || !target || !target.closest) return;
        const mCsv = target.closest('[data-ua-modal-csv]');
        if (mCsv) {
          const fk = mCsv.dataset.uaModalCsv;
          exportCsvData(rowsForFlag(model, fk), model, FLAGS[fk]?.short || fk);
          return;
        }
        const mPdf = target.closest('[data-ua-modal-pdf]');
        if (mPdf) {
          const fk = mPdf.dataset.uaModalPdf;
          exportPdfData(rowsForFlag(model, fk), model, mPdf, `Unusual Activity · ${FLAGS[fk]?.label || fk}`);
          return;
        }
        const dAg = target.closest('[data-ua-drawer-agent]');
        if (dAg) {
          const hit = model.rows.find((r) => r.key === dAg.dataset.uaDrawerAgent);
          if (hit) openAgentForensicDrawer(hit, model);
        }
      });
    }

    await runAnalysis();
  }

  FF.unusual = { analyze, resolveRange, loadVrnRecords, get vrnFetchInfo() { return state.vrnFetchInfo; }, FLAGS, PERIODS };
  FF.pages.unusual = { title: 'Unusual Activity', render };
})(window.FF);
