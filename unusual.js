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
    vrnRecords: []
  };

  const isWrong = (v) => /wrong/i.test(String(v || ''));
  const isChassis = (v) => /chassis/i.test(String(v || ''));
  const isRepl = (t, s) => /replace/i.test(`${t || ''} ${s || ''}`);
  const cleanVrn = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isInvalidVrnFormat = (vrn, vrnType) => {
    if (isChassis(vrnType)) return false;
    const c = cleanVrn(vrn);
    if (!c) return false;
    if (c.length < 6 || c.length > 13) return true;
    if (/^(0+|1+|9+|TEST|NA|NULL|NONE|XXXX|AAAA)/.test(c)) return true;
    if (/(\d)\1{4,}/.test(c)) return true; // e.g. 00000, 11111
    return false;
  };

  function resolveRange(all, opts) {
    const o = opts || state;
    const latest = all.reduce((m, r) => (r.key > m ? r.key : m), '') || U.dateKey(new Date());
    const today = U.dateKey(new Date());
    const refDay = latest > today ? latest : today;
    const curYm = latest.slice(0, 7);
    const prevYm = U.prevMonthKey(curYm);
    const shiftDays = (key, delta) => {
      const dt = U.fromDateKey(key) || new Date();
      dt.setDate(dt.getDate() + delta);
      return U.dateKey(dt);
    };
    if (o.period === 'today') {
      const d = all.some((r) => r.key === today) ? today : latest;
      return { from: d, to: d, label: `Today (${U.labelDateKey(d, true)})` };
    }
    if (o.period === 'yesterday') {
      const y = shiftDays(refDay, -1);
      return { from: y, to: y, label: `Yesterday (${U.labelDateKey(y, true)})` };
    }
    if (o.period === 'last7') {
      const f = shiftDays(latest, -6);
      return { from: f, to: latest, label: `Last 7 Days (${f} → ${latest})` };
    }
    if (o.period === 'last') {
      const f = `${prevYm}-01`, t = `${prevYm}-${U.pad2(U.daysInMonth(prevYm))}`;
      return { from: f, to: t, label: `Last Month (${U.labelYM(prevYm, true)})` };
    }
    if (o.period === 'last30') {
      const f = shiftDays(latest, -29);
      return { from: f, to: latest, label: `Last 30 Days (${f} → ${latest})` };
    }
    if (o.period === 'custom' && (o.from || o.to)) {
      const f = o.from || o.to, t = o.to || o.from;
      const [a, b] = f <= t ? [f, t] : [t, f];
      return { from: a, to: b, label: `Custom (${a} → ${b})` };
    }
    const f = `${curYm}-01`;
    return { from: f, to: latest, label: `This Month MTD (${U.labelYM(curYm, true)})` };
  }

  /** Pure analyzer — exposed as FF.unusual.analyze(dailyRows, opts) for tests and callers. */
  function analyze(dailyRows, opts) {
    const o = { ch: 'all', period: 'mtd', mult: 2, min: 5, ...(opts || {}) };
    const all = (dailyRows || []).filter((r) => r && r.key && (o.ch === 'all' || (o.ch === 'gv' ? r.channel === 'GV Partner' : r.channel !== 'GV Partner')));
    const range = resolveRange(all, o);
    const rows = all.filter((r) => r.key >= range.from && r.key <= range.to);

    let tot = 0, wrongTot = 0, replTot = 0, chasTot = 0, vc4Tot = 0;
    const byAgent = new Map();
    const ensureAgent = (ch, id, name, tl) => {
      const k = `${ch}|${ U.clean(id || name).toUpperCase() }`;
      if (!k || k.endsWith('|')) return null;
      let a = byAgent.get(k);
      if (!a) {
        a = {
          key: k, channel: ch, id: U.clean(id), name: U.clean(name || id), tl: U.clean(tl),
          total: 0, vc4: 0, comm: 0, wrong: 0, replace: 0, chassis: 0,
          doubleVrn: 0, invalidVrn: 0, doubleList: [],
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
      if (isWrong(r.vrnType)) { a.wrong += n; wrongTot += n; }
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
    for (const rec of vrnRecords) {
      if (isChassis(rec.vrnType)) continue;
      const v = cleanVrn(rec.vrn);
      if (!v || v.length < 4) continue;
      const list = vrnMap.get(v) || [];
      list.push(rec);
      vrnMap.set(v, list);
      if (isInvalidVrnFormat(rec.vrn, rec.vrnType)) {
        const a = ensureAgent(rec.ch || 'ff', rec.agentId, rec.agentName, rec.tlName);
        if (a) a.invalidVrn += 1;
      }
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

    const peer = {
      wrongPct: tot ? (wrongTot / tot) * 100 : 0,
      replacePct: tot ? (replTot / tot) * 100 : 0,
      chassisPct: tot ? (chasTot / tot) * 100 : 0
    };
    const wrongCut = Math.max(8, peer.wrongPct * o.mult);
    const replCut = Math.max(12, peer.replacePct * o.mult);
    const chasCut = Math.max(15, peer.chassisPct * o.mult);

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
      a.wrongPct = a.total ? (a.wrong / a.total) * 100 : 0;
      a.replacePct = a.total ? (a.replace / a.total) * 100 : 0;
      a.chassisPct = a.total ? (a.chassis / a.total) * 100 : 0;
      a.doublePct = a.total ? (a.doubleVrn / a.total) * 100 : 0;
      doubleTot += a.doubleVrn;

      const flags = [];
      const reasons = [];
      if (a.doubleVrn >= 2 || (a.doubleList && a.doubleList.length >= 1)) {
        flags.push('double');
        reasons.push(`♊ ${U.fmt(a.doubleVrn)} duplicate VRN tags (${a.doubleList.length} VRNs repeated)`);
      }
      if ((a.wrong >= o.min && a.wrongPct >= wrongCut) || a.invalidVrn >= o.min) {
        flags.push('wrong');
        reasons.push(`🚫 ${U.fmt(a.wrong)} Wrong VRN (${a.wrongPct.toFixed(1)}% vs peer ${peer.wrongPct.toFixed(1)}%)`);
      }
      if (a.replace >= o.min && a.replacePct >= replCut) {
        flags.push('replace');
        reasons.push(`🔁 ${U.fmt(a.replace)} Replacements (${a.replacePct.toFixed(1)}% vs peer ${peer.replacePct.toFixed(1)}%)`);
      }
      if (a.chassis >= o.min && a.chassisPct >= chasCut) {
        flags.push('chassis');
        reasons.push(`🔩 ${U.fmt(a.chassis)} Chassis tags (${a.chassisPct.toFixed(1)}% vs peer ${peer.chassisPct.toFixed(1)}%)`);
      }
      if (days >= 2 && maxDay >= Math.max(10, o.min * 2) && a.spikeRatio >= 3) {
        flags.push('spike');
        reasons.push(`⚡ ${U.fmt(maxDay)} tags on ${maxDate} (${a.spikeRatio.toFixed(1)}× avg ${avg.toFixed(1)}/day)`);
      }
      if (flags.length >= 2) flags.unshift('multi');

      a.flags = flags;
      a.reasons = reasons;
      const rawScore = (flags.includes('double') ? a.doubleVrn * 12 + 25 : 0)
        + (flags.includes('wrong') ? (a.wrongPct / Math.max(1, wrongCut)) * 28 : 0)
        + (flags.includes('replace') ? (a.replacePct / Math.max(1, replCut)) * 22 : 0)
        + (flags.includes('chassis') ? (a.chassisPct / Math.max(1, chasCut)) * 18 : 0)
        + (flags.includes('spike') ? a.spikeRatio * 7 : 0)
        + (flags.includes('multi') ? 20 : 0);
      a.score = Math.min(100, Math.round(rawScore));
      a.severity = a.score >= 65 || flags.includes('multi') || flags.includes('double') ? 'Critical' : a.score >= 35 ? 'High' : flags.length ? 'Elevated' : 'Normal';
      out.push(a);
    }
    out.sort((a, b) => (b.flags.length - a.flags.length) || (b.score - a.score) || (b.doubleVrn - a.doubleVrn) || (b.wrong - a.wrong) || (b.total - a.total));
    const counts = { all: 0, multi: 0, double: 0, wrong: 0, replace: 0, chassis: 0, spike: 0 };
    const tagSums = { all: 0, multi: 0, double: doubleTot, wrong: wrongTot, replace: replTot, chassis: chasTot, spike: 0 };
    for (const a of out) {
      if (a.flags.length) {
        counts.all++;
        tagSums.all += a.total;
      }
      for (const f of a.flags) {
        counts[f] = (counts[f] || 0) + 1;
        if (f === 'multi') tagSums.multi += a.total;
        if (f === 'spike') tagSums.spike += a.maxDay;
      }
    }
    return {
      rows: out,
      peer,
      cuts: { wrongCut, replCut, chasCut },
      counts,
      tagSums,
      totals: { tot, vc4Tot, commTot: tot - vc4Tot, wrongTot, replTot, chasTot, doubleTot },
      duplicateVrns,
      from: range.from,
      to: range.to,
      rangeLabel: range.label
    };
  }

  /** Collect VRN-level records from GV Master (in memory) + EIR (lightweight query for the period). */
  async function loadVrnRecords(from, to) {
    const recs = [];
    if (G && typeof G.rows === 'function') {
      for (const r of G.rows() || []) {
        const key = r.date ? U.dateKey(r.date) : '';
        if (!key || key < from || key > to) continue;
        if (!r.vrn) continue;
        recs.push({
          ch: 'gv', key, vrn: r.vrn, tagId: r.tagId || r.serial || '', cls: r.cls || 'VC4',
          vrnType: r.tagType || '', agentId: r.agentId || '', agentName: r.agentName || '', tlName: r.tlName || ''
        });
      }
    }
    const cacheKey = `${from}_${to}`;
    if (state.vrnCacheKey === cacheKey && state.vrnRecords.length) {
      return recs.concat(state.vrnRecords);
    }
    if (FF.data && typeof FF.data.query === 'function' && FF.config && FF.config.eir) {
      try {
        const e = FF.config.eir;
        const q = `select ${e.date}, ${e.tagId}, ${e.vrn}, ${e.cls}, ${e.vrnType}, ${e.agentName}, ${e.agentId}, ${e.tlName}, ${e.masterId}, ${e.gvName}, ${e.gvId} where toDate(${e.date}) >= date '${from}' and toDate(${e.date}) <= date '${to}' and ${e.vrn} is not null limit 25000`;
        const t = await FF.data.query(e.sheet || 'EIR', q, {});
        const D = FF.data;
        const gvFromMaster = recs.length > 0;
        const eirRecs = [];
        for (const r of t.rows || []) {
          const d = D.cellDate(r[0]);
          const key = d ? U.dateKey(d) : '';
          if (!key) continue;
          const channel = FF.model && FF.model.channelOf ? FF.model.channelOf(D.cellText(r[8]), D.cellText(r[7])) : 'First Forward';
          if (channel === 'GV Partner' && gvFromMaster) continue;
          const ch = channel === 'GV Partner' ? 'gv' : 'ff';
          const agentName = ch === 'gv' ? (D.cellText(r[9]) || D.cellText(r[5])) : (D.cellText(r[5]) || D.cellText(r[9]));
          const agentId = ch === 'gv' ? (D.cellText(r[10]) || D.cellText(r[6])) : (D.cellText(r[6]) || D.cellText(r[10]));
          eirRecs.push({
            ch, key, tagId: D.cellText(r[1]), vrn: D.cellText(r[2]), cls: D.cellText(r[3]) || 'VC4',
            vrnType: D.cellText(r[4]), agentName, agentId, tlName: D.cellText(r[7])
          });
        }
        state.vrnCacheKey = cacheKey;
        state.vrnRecords = eirRecs;
        return recs.concat(eirRecs);
      } catch {
        /* fallback to GV Master + aggregate EIR daily */
      }
    }
    return recs;
  }

  function filteredRows(model) {
    const q = U.clean(state.q).toLowerCase();
    return model.rows.filter((r) => {
      if (state.onlyFlagged && !r.flags.length) return false;
      if (state.flag !== 'all' && !r.flags.includes(state.flag)) return false;
      if (state.tl && r.tl !== state.tl) return false;
      if (q && !`${r.name} ${r.id} ${r.tl} ${r.reasons.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function exportCsvData(rows, model, titleSuffix) {
    const head = ['Channel', 'Agent Name', 'Agent ID', 'TL Name', 'Risk Score', 'Severity', 'Total Issued', 'VC4', 'Commercial', 'Double VRN', 'Wrong VRN', 'Wrong %', 'Replacement', 'Replace %', 'Chassis', 'Chassis %', 'Active Days', 'Avg/Day', 'Max Day', 'Max Day Date', 'Spike ×', 'Flags', 'Forensic Reasons'];
    const body = rows.map((r) => [
      r.channel.toUpperCase(), r.name, r.id, r.tl, r.score, r.severity,
      r.total, r.vc4, r.comm, r.doubleVrn, r.wrong, r.wrongPct.toFixed(1),
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
    const totRepl = U.sum(rows, (r) => r.replace);
    const totChas = U.sum(rows, (r) => r.chassis);
    body.push([
      'GRAND TOTAL', `${rows.length} Agents`, '', '', '', '',
      totIssued, totVc4, totComm, totDbl,
      totWrong, totIssued ? ((totWrong / totIssued) * 100).toFixed(1) : '0.0',
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
      const totRepl = U.sum(rows, (r) => r.replace);
      const totChas = U.sum(rows, (r) => r.chassis);
      const kpiHtml = `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px">
        ${[
          ['Flagged Agents', U.fmt(rows.length), `${model.rangeLabel}`],
          ['Issued Tags', U.fmt(totIssued), `VC4 ${U.fmt(U.sum(rows, (r) => r.vc4))}`],
          ['Double VRN', U.fmt(totDbl), `${U.fmt(model.counts.double)} agents`],
          ['Wrong VRN', U.fmt(totWrong), `Peer ${model.peer.wrongPct.toFixed(1)}%`],
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
          <th style="padding:5px;text-align:right">Wrong VRN</th>
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
    const rows = model.rows.filter((r) => (flagKey === 'all' ? r.flags.length > 0 : r.flags.includes(flagKey)));
    const totIssued = U.sum(rows, (r) => r.total);
    const totDbl = U.sum(rows, (r) => r.doubleVrn);
    const totWrong = U.sum(rows, (r) => r.wrong);
    const totRepl = U.sum(rows, (r) => r.replace);
    const totChas = U.sum(rows, (r) => r.chassis);

    const kpisHtml = `<div class="dkpis" style="margin-bottom:12px">
      <div class="dkpi"><small>Flagged Agents</small><b>${U.fmt(rows.length)}</b><span>${esc(fMeta.short)}</span></div>
      <div class="dkpi"><small>Total Issued</small><b>${U.fmt(totIssued)}</b><span>VC4 ${U.fmt(U.sum(rows, (r) => r.vc4))} · Comm ${U.fmt(U.sum(rows, (r) => r.comm))}</span></div>
      <div class="dkpi"><small>Double VRN</small><b>${U.fmt(totDbl)}</b><span>Duplicate vehicle numbers</span></div>
      <div class="dkpi"><small>Wrong VRN</small><b>${U.fmt(totWrong)}</b><span>Peer avg ${model.peer.wrongPct.toFixed(1)}%</span></div>
      <div class="dkpi"><small>Replacement / Chassis</small><b>${U.fmt(totRepl)} / ${U.fmt(totChas)}</b><span>Repl ${model.peer.replacePct.toFixed(1)}% · Chas ${model.peer.chassisPct.toFixed(1)}%</span></div>
    </div>`;

    const dupSection = flagKey === 'double' && model.duplicateVrns.length
      ? `<section class="dsec"><h4>♊ Duplicate VRN Register (${U.fmt(model.duplicateVrns.length)} Vehicles)</h4>
          <div class="table-wrap"><table class="tbl compact">
            <thead><tr><th>#</th><th>VRN (Vehicle No.)</th><th class="num">Times Issued</th><th>Agents Involved</th><th>TL</th><th>Classes</th><th>Dates</th></tr></thead>
            <tbody>
              ${model.duplicateVrns.slice(0, 100).map((d, i) => `<tr>
                <td class="dim">${i + 1}</td>
                <td><b class="code-chip">${esc(d.vrn)}</b></td>
                <td class="num"><b class="count red">${U.fmt(d.count)}×</b></td>
                <td><b>${esc(d.agents.join(', ') || '—')}</b></td>
                <td>${esc(d.tls.join(', ') || '—')}</td>
                <td>${esc(d.classes.join(', ') || '—')}</td>
                <td class="dim small">${esc(d.dates.join(', '))}</td>
              </tr>`).join('')}
              <tr class="row-total"><td colspan="2"><b>Grand Total (${model.duplicateVrns.length} VRNs)</b></td><td class="num"><b>${U.fmt(U.sum(model.duplicateVrns, (d) => d.count))}</b></td><td colspan="4"></td></tr>
            </tbody>
          </table></div></section>`
      : '';

    const tableSection = `<section class="dsec"><h4>${fMeta.icon} ${esc(fMeta.label)} — Agent Breakdown (${U.fmt(rows.length)})</h4>
      <p class="dim small">${esc(fMeta.desc)} · Kisi bhi agent row par click karo → uska poora forensic breakdown khulega.</p>
      <div class="table-wrap"><table class="tbl compact">
        <thead><tr>
          <th>#</th><th>Ch</th><th>Agent</th><th>TL</th>
          <th class="num">Risk Score</th><th class="num">Issued</th>
          <th class="num">Double VRN</th><th class="num">Wrong VRN</th>
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
            <td class="num">${U.fmt(r.replace)} <small class="dim">(${r.replacePct.toFixed(0)}%)</small></td>
            <td class="num">${U.fmt(r.chassis)} <small class="dim">(${r.chassisPct.toFixed(0)}%)</small></td>
            <td class="num">${U.fmt(r.maxDay)} <small class="dim">(${r.spikeRatio.toFixed(1)}×)</small></td>
            <td class="small">${esc(r.reasons.join(' · ') || '—')}</td>
          </tr>`).join('') || '<tr><td colspan="12" class="empty">Is anomaly category me koi agent nahi mila.</td></tr>'}
        </tbody>
        ${rows.length ? `<tfoot><tr class="row-total">
          <td colspan="5"><b>Grand Total (${rows.length} Agents)</b></td>
          <td class="num"><b>${U.fmt(totIssued)}</b></td>
          <td class="num"><b>${U.fmt(totDbl)}</b></td>
          <td class="num"><b>${U.fmt(totWrong)}</b></td>
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
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&f=wrong&title=${encodeURIComponent(`${r.name} · Wrong VRN`)}`)}" title="Click to open Wrong VRN tags"><small>Wrong VRN</small><b>${U.fmt(r.wrong)}</b><span>${r.wrongPct.toFixed(1)}% vs peer ${model.peer.wrongPct.toFixed(1)}%</span></div>
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&f=repl&title=${encodeURIComponent(`${r.name} · Replacements`)}`)}" title="Click to open Replacement tags"><small>Replacements</small><b>${U.fmt(r.replace)}</b><span>${r.replacePct.toFixed(1)}% vs peer ${model.peer.replacePct.toFixed(1)}%</span></div>
      <div class="dkpi kpi-clickable" data-kpi="${esc(`${kpiSpecBase}&f=chassis&title=${encodeURIComponent(`${r.name} · Chassis Tags`)}`)}" title="Click to open Chassis tags"><small>Chassis Tags</small><b>${U.fmt(r.chassis)}</b><span>${r.chassisPct.toFixed(1)}% vs peer ${model.peer.chassisPct.toFixed(1)}%</span></div>
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
      body: topKpis + reasonsHtml + dupHtml + `<div class="grid g-2">${clsHtml}${dayHtml}</div>`,
      age: { kind: 'agent', key: r.id || r.name, keys: [r.id, r.name].filter(Boolean), ch: r.channel, title: r.name }
    });
  }

  function renderBody(root, model) {
    const tls = [...new Set(model.rows.map((r) => r.tl).filter(Boolean))].sort();
    const rows = filteredRows(model);
    const topFlagged = rows.filter((r) => r.flags.length > 0).slice(0, 6);

    const periodPills = PERIODS.map(([k, label]) =>
      `<button type="button" class="ua-period-pill ${state.period === k ? 'active' : ''}" data-ua-period="${k}">${label}</button>`
    ).join('');

    const kpiCards = Object.entries(FLAGS).map(([k, f]) => {
      const count = model.counts[k] || 0;
      const tagSum = model.tagSums[k] || 0;
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
              <div><span>Wrong VRN</span><b class="${r.wrong ? 'red' : ''}">${U.fmt(r.wrong)} <small>(${r.wrongPct.toFixed(0)}%)</small></b></div>
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
    const dupCardHtml = model.duplicateVrns.length ? `<section class="card">
      <div class="card-head">
        <h3>♊ Double / Duplicate VRN Radar — ${U.fmt(model.duplicateVrns.length)} Vehicles Issued Multiple Times</h3>
        <div class="card-right">
          <button class="btn small" id="ua-dup-csv">⬇ Duplicate VRN CSV</button>
        </div>
      </div>
      <div class="card-body">
        <div class="table-wrap"><table class="tbl compact">
          <thead><tr><th>#</th><th>VRN (Vehicle Number)</th><th class="num">Times Issued</th><th>Agents Involved</th><th>TL</th><th>Channel</th><th>Classes</th><th>Dates</th></tr></thead>
          <tbody>
            ${model.duplicateVrns.slice(0, 30).map((d, i) => `<tr>
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
          <tfoot><tr class="row-total"><td colspan="2"><b>Grand Total (${model.duplicateVrns.length} duplicate VRNs)</b></td><td class="num"><b>${U.fmt(U.sum(model.duplicateVrns, (d) => d.count))}</b></td><td colspan="5"></td></tr></tfoot>
        </table></div>
      </div>
    </section>` : '';

    const totIssued = U.sum(rows, (r) => r.total);
    const totVc4 = U.sum(rows, (r) => r.vc4);
    const totComm = U.sum(rows, (r) => r.comm);
    const totDbl = U.sum(rows, (r) => r.doubleVrn);
    const totWrong = U.sum(rows, (r) => r.wrong);
    const totRepl = U.sum(rows, (r) => r.replace);
    const totChas = U.sum(rows, (r) => r.chassis);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>🚨 Unusual Agent Activity & Fraud Radar</h1>
          <p class="sub">${esc(model.rangeLabel)} · <b>${U.fmt(model.counts.all)}</b> agents flagged out of ${U.fmt(model.rows.length)} · Peer benchmark: Wrong VRN <b>${model.peer.wrongPct.toFixed(1)}%</b> · Replace <b>${model.peer.replacePct.toFixed(1)}%</b> · Chassis <b>${model.peer.chassisPct.toFixed(1)}%</b></p>
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
        <div class="ctrl-row" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          <div class="seg" id="ua-ch">${[['all', '🌐 All Channels'], ['ff', '🟦 First Forward'], ['gv', '🟩 GV Partner']].map(([k, l]) => `<button type="button" class="seg-btn ${state.ch === k ? 'on' : ''}" data-ch="${k}">${l}</button>`).join('')}</div>
          <label>TL <select id="ua-tl"><option value="">All TLs (${tls.length})</option>${tls.map((t) => `<option value="${esc(t)}" ${t === state.tl ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label>Sensitivity <select id="ua-mult">${[[1.5, '1.5× Peer (Strict)'], [2, '2× Peer (Standard)'], [3, '3× Peer (Relaxed)']].map(([v, l]) => `<option value="${v}" ${Number(state.mult) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Min Tags <select id="ua-min">${[3, 5, 10, 15, 25].map((v) => `<option value="${v}" ${Number(state.min) === v ? 'selected' : ''}>≥ ${v} tags</option>`).join('')}</select></label>
          <input class="input" id="ua-q" placeholder="Search agent, ID, TL, VRN…" value="${esc(state.q)}" style="min-width:200px">
          <label class="check"><input type="checkbox" id="ua-only" ${state.onlyFlagged ? 'checked' : ''}> Flagged Only</label>
        </div>
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
              <th class="num">🚫 Wrong VRN</th><th class="num">🔁 Replace</th>
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
                <td class="num ${r.flags.includes('replace') ? 'ua-hit' : ''}"><b>${U.fmt(r.replace)}</b> <small class="dim">(${r.replacePct.toFixed(1)}%)</small></td>
                <td class="num ${r.flags.includes('chassis') ? 'ua-hit' : ''}"><b>${U.fmt(r.chassis)}</b> <small class="dim">(${r.chassisPct.toFixed(1)}%)</small></td>
                <td class="num ${r.flags.includes('spike') ? 'ua-hit' : ''}"><b>${U.fmt(r.maxDay)}</b> <small class="dim">${r.maxDate ? `${r.maxDate.slice(5)} (${r.spikeRatio.toFixed(1)}×)` : ''}</small></td>
                <td>${r.flags.filter((f) => f !== 'multi').map((f) => `<span class="badge ${FLAGS[f].tone}" style="margin:1px">${FLAGS[f].icon} ${esc(FLAGS[f].short)}</span>`).join(' ') || '<span class="dim">Normal</span>'}
                  ${r.reasons.length ? `<div class="dim small" style="margin-top:2px">${esc(r.reasons.join(' · '))}</div>` : ''}
                </td>
              </tr>`).join('') || `<tr><td colspan="13" class="empty">🎉 Selected filters aur period me koi unusual activity nahi mili.</td></tr>`}
            </tbody>
            ${rows.length ? `<tfoot><tr class="row-total">
              <td colspan="5"><b>Grand Total (${U.fmt(rows.length)} Agents)</b></td>
              <td class="num"><b>${U.fmt(totIssued)}</b></td>
              <td class="num"><b>${U.fmt(totVc4)} / ${U.fmt(totComm)}</b></td>
              <td class="num"><b>${U.fmt(totDbl)}</b></td>
              <td class="num"><b>${U.fmt(totWrong)} (${totIssued ? ((totWrong / totIssued) * 100).toFixed(1) : '0.0'}%)</b></td>
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
      if (!root.isConnected) return;
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
        const dRows = currentModel.duplicateVrns.map((d, i) => [i + 1, d.vrn, d.count, d.agents.join(' | '), d.tls.join(' | '), d.channels.join(' | '), d.classes.join(' | '), d.dates.join(' | '), d.tagIds.join(' | ')]);
        dRows.push(['Grand Total', `${currentModel.duplicateVrns.length} VRNs`, U.sum(currentModel.duplicateVrns, (d) => d.count), '', '', '', '', '', '']);
        U.downloadCsv(`duplicate-vrns-${currentModel.from}_${currentModel.to}.csv`, ['#', 'VRN', 'Times Issued', 'Agents', 'TLs', 'Channels', 'Classes', 'Dates', 'Tag IDs'], dRows);
      });
      root.querySelectorAll('[data-ua-agent-key]').forEach((el) => el.addEventListener('click', () => {
        const hit = currentModel.rows.find((r) => r.key === el.dataset.uaAgentKey);
        if (hit) openAgentForensicDrawer(hit, currentModel);
      }));
    };

    if (!document.__uaDrawerWired) {
      document.__uaDrawerWired = true;
      document.addEventListener('click', (e) => {
        if (!currentModel) return;
        const mCsv = e.target.closest('[data-ua-modal-csv]');
        if (mCsv) {
          const fk = mCsv.dataset.uaModalCsv;
          const subRows = currentModel.rows.filter((r) => (fk === 'all' ? r.flags.length > 0 : r.flags.includes(fk)));
          exportCsvData(subRows, currentModel, FLAGS[fk]?.short || fk);
          return;
        }
        const mPdf = e.target.closest('[data-ua-modal-pdf]');
        if (mPdf) {
          const fk = mPdf.dataset.uaModalPdf;
          const subRows = currentModel.rows.filter((r) => (fk === 'all' ? r.flags.length > 0 : r.flags.includes(fk)));
          exportPdfData(subRows, currentModel, mPdf, `Unusual Activity · ${FLAGS[fk]?.label || fk}`);
          return;
        }
        const dAg = e.target.closest('[data-ua-drawer-agent]');
        if (dAg) {
          const hit = currentModel.rows.find((r) => r.key === dAg.dataset.uaDrawerAgent);
          if (hit) openAgentForensicDrawer(hit, currentModel);
        }
      });
    }

    await runAnalysis();
  }

  FF.unusual = { analyze, FLAGS, PERIODS };
  FF.pages.unusual = { title: 'Unusual Activity', render };
})(window.FF);
