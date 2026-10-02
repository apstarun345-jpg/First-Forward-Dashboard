/* 🚨 Unusual Activity — tag-level VRN scan index (v3.37).
 *
 * EK HI LOGIC, DO JAGAH: ye file browser me classic script ki tarah load hoti hai
 * (`FF.unusualScan`) aur server me side-effect import se (`globalThis.FFunusualScan`).
 * Isliye jo duplicate / wrong / malformed / replacement / chassis tag server par count hota hai,
 * wahi count browser ke fallback scan me bhi hota hai — numbers kabhi diverge nahi karte.
 *
 * Kyun index (raw rows nahi): pehle browser EIR ke 25,000-row pages (max 20 page = 5 lakh rows)
 * khud kheenchta tha, isliye Unusual Activity page khulte hi atak jaata tha. Ab server wahi pages
 * PARALLEL me padhta hai, /api/unusual/scan sirf compact anomaly index lauta hai (duplicate VRN
 * groups + wrong/malformed/replacement/chassis evidence rows, capped) aur page turant paint hota hai.
 *
 * Index shape (chhoti keys = chhota JSON):
 *   { v, from, to, builtAt, ms,
 *     meta:   { source, rowsRead, pages, complete, capHit, offsetIssue, offsetVerified, probeFailed,
 *               error, message, truncated:{dup,bad,rep,cha}, mode },
 *     totals: { rows, dupGroups, dupTags, wrong, invalid, dup, repl, chassis },
 *     agents: { "ff|5846000": { ch, name, id, tl, w, i, d, r, c } },
 *     dup:    [ { v, n, a:[[agentKey,count]], d:[dates], c:[classes], t:[tagIds] } ],
 *     bad:    [ [agentKey, date, tagId, vrn, vrnType, kind] ],   kind 1=wrong 2=malformed 3=both
 *     rep:    [ [agentKey, date, tagId, vrn, cls, type, status] ],
 *     cha:    [ [agentKey, date, tagId, vrn, cls, vrnType] ] }
 */
(function (g) {
  'use strict';

  const VERSION = 1;
  /** Payload caps — index chhota rahe tabhi page fast rahega. Counts hamesha exact rehte hain,
      sirf evidence LISTEN cap hoti hain (aur `meta.truncated` me saaf dikhta hai). */
  const CAPS = {
    dupGroups: 4000,      // duplicate VRN groups (count desc)
    dupRows: 12000,       // duplicate VRN ki TAG-level rows (card ke "N tags" ka exact evidence)
    dupTagIds: 40,        // tag IDs per duplicate VRN
    dupDates: 40,
    bad: 12000,           // wrong / malformed tag rows
    rep: 12000,           // replacement tag rows
    cha: 12000,           // chassis tag rows
    agents: 8000          // distinct agents tracked in the index
  };

  const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
  const cleanVrn = (v) => str(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isWrongType = (v) => /wrong/i.test(str(v));
  const isChassisType = (v) => /chassis/i.test(str(v));
  const isReplacement = (type, status) => /replace/i.test(`${str(type)} ${str(status)}`);
  const PLACEHOLDER_VRN = /^(NA|NULL|NONE|UNKNOWN|UNAVAILABLE|TEST|XXXX|AAAA)$/;

  /** Malformed / invalid VRN — chassis rows exempt (unme VRN hota hi nahi). */
  function isInvalidVrnFormat(vrn, vrnType) {
    if (isChassisType(vrnType)) return false;
    const c = cleanVrn(vrn);
    if (!c) return true;
    if (c.length < 6 || c.length > 13) return true;
    if (/^(0+|1+|9+|TEST|NA|NULL|NONE|UNKNOWN|UNAVAILABLE|XXXX|AAAA)/.test(c)) return true;
    if (/(\d)\1{4,}/.test(c)) return true;
    return false;
  }
  /** Placeholder VRN duplicate-vehicle alarm paida nahi karna chahiye. */
  const isPlaceholderVrn = (v) => !v || v.length < 6 || PLACEHOLDER_VRN.test(v);

  /** EIR channel rule — model.channelOf() ka exact mirror (server par FF.model nahi hota). */
  function channelOfEir(masterId, tlName, cfg) {
    const e = cfg || {};
    const gvId = str(e.gvMasterId || '5845036').replace(/\.0+$/, '');
    const id = str(masterId).replace(/\.0+$/, '');
    const gvTl = str(e.gvChannelTl || 'ApnaPayment Pvt. Ltd.').toLowerCase();
    return (gvId && id === gvId) || (!id && gvTl && str(tlName).toLowerCase() === gvTl) ? 'GV Partner' : 'First Forward';
  }
  const chOf = (channel) => (channel === 'GV Partner' || channel === 'gv' ? 'gv' : 'ff');

  /** Agent ki stable identity — same agent FF/GV me alag, ID na ho to naam se. */
  function agentKey(ch, id, name) {
    const base = str(id || name).toUpperCase();
    return base ? `${ch}|${base}` : '';
  }

  /** Stable tag identity — GV Master ki live row aur EIR ki history row ek hi tag ko dobara na gine. */
  function recordKey(rec) {
    const ch = rec && rec.ch === 'gv' ? 'gv' : 'ff';
    const tagId = str(rec && rec.tagId).toUpperCase();
    if (tagId) return `${ch}|tag:${tagId}`;
    return `${ch}|${str(rec && rec.key)}|${cleanVrn(rec && rec.vrn)}|${str(rec && (rec.agentId || rec.agentName)).toUpperCase()}`;
  }

  /** Same tag do sources me aaye to fields merge karke ek hi record rakho. */
  function dedupe(records) {
    const map = new Map();
    for (const rec of records || []) {
      if (!rec || !rec.key || rec.vrn === null || rec.vrn === undefined) continue;
      const key = recordKey(rec);
      const prev = map.get(key);
      if (!prev) map.set(key, rec);
      else {
        for (const k of Object.keys(rec)) {
          const v = rec[k];
          if (v !== '' && v !== null && v !== undefined) prev[k] = v;
        }
      }
    }
    return [...map.values()];
  }

  function uniqSorted(list) { return [...new Set(list.filter(Boolean))].sort(); }
  function uniqFirst(list, cap) {
    const out = [];
    const seen = new Set();
    for (const x of list || []) {
      if (!x) continue;
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
      if (out.length >= cap) break;
    }
    return out;
  }

  /**
   * Tag-level records → compact anomaly index.
   * @param {object} o { records, from, to, meta, caps }
   */
  function buildIndex(o) {
    const opt = o || {};
    const caps = { ...CAPS, ...(opt.caps || {}) };
    const from = str(opt.from), to = str(opt.to);
    const records = (Array.isArray(opt.records) ? opt.records : []).filter((r) => r && r.key && (!from || r.key >= from) && (!to || r.key <= to));
    const agents = new Map();
    const dupMap = new Map();
    const bad = [], rep = [], cha = [];
    const truncated = { dup: false, dupRows: false, bad: false, rep: false, cha: false };
    const totals = { rows: records.length, dupGroups: 0, dupTags: 0, wrong: 0, invalid: 0, dup: 0, repl: 0, chassis: 0 };

    const ensure = (rec) => {
      const ch = chOf(rec.ch);
      const key = agentKey(ch, rec.agentId, rec.agentName);
      if (!key) return null;
      let a = agents.get(key);
      if (!a) {
        if (agents.size >= caps.agents) return null;
        // w = Wrong-VRN type · i = malformed/invalid · b = dono (ek hi tag) · d = duplicate VRN tags
        // r = replacement · c = chassis.  Union(wrong,invalid) = w + i - b.
        a = { k: key, ch, name: str(rec.agentName || rec.agentId), id: str(rec.agentId), tl: str(rec.tlName), w: 0, i: 0, b: 0, d: 0, r: 0, c: 0 };
        agents.set(key, a);
      } else {
        if (!a.name && rec.agentName) a.name = str(rec.agentName);
        if (!a.id && rec.agentId) a.id = str(rec.agentId);
        if ((!a.tl || a.tl === 'Direct') && rec.tlName) a.tl = str(rec.tlName);
      }
      return a;
    };

    for (const rec of records) {
      const ch = chOf(rec.ch);
      const agent = ensure(rec);
      const v = cleanVrn(rec.vrn);
      const wrong = isWrongType(rec.vrnType);
      const invalid = isInvalidVrnFormat(rec.vrn, rec.vrnType);
      const chassis = isChassisType(rec.vrnType);
      const repl = isReplacement(rec.type, rec.status);

      if (agent) {
        if (wrong) { agent.w++; totals.wrong++; }
        if (invalid) { agent.i++; totals.invalid++; }
        if (wrong && invalid) agent.b++;
        if (repl) { agent.r++; totals.repl++; }
        if (chassis) { agent.c++; totals.chassis++; }
      }
      if (wrong || invalid) {
        if (bad.length < caps.bad) bad.push([agent ? agent.k : `${ch}|`, str(rec.key), str(rec.tagId), str(rec.vrn), str(rec.vrnType), wrong && invalid ? 3 : wrong ? 1 : 2]);
        else truncated.bad = true;
      }
      if (repl) {
        if (rep.length < caps.rep) rep.push([agent ? agent.k : `${ch}|`, str(rec.key), str(rec.tagId), str(rec.vrn), str(rec.cls || 'VC4'), str(rec.type), str(rec.status)]);
        else truncated.rep = true;
      }
      if (chassis) {
        if (cha.length < caps.cha) cha.push([agent ? agent.k : `${ch}|`, str(rec.key), str(rec.tagId), str(rec.vrn), str(rec.cls || 'VC4'), str(rec.vrnType)]);
        else truncated.cha = true;
      }
      // Duplicate vehicle detection — chassis/placeholder/blank/malformed VRN se duplicate alarm nahi banta.
      if (chassis || isPlaceholderVrn(v) || invalid) continue;
      let group = dupMap.get(v);
      if (!group) { group = { v, n: 0, byAgent: new Map(), dates: [], classes: [], tagIds: [], occ: [] }; dupMap.set(v, group); }
      group.n++;
      if (agent) group.byAgent.set(agent.k, (group.byAgent.get(agent.k) || 0) + 1);
      if (rec.key) group.dates.push(str(rec.key));
      if (rec.cls) group.classes.push(str(rec.cls).toUpperCase());
      if (rec.tagId) group.tagIds.push(str(rec.tagId));
      // Har occurrence ki tag-level row — drawer/CSV me card ke "N tags" ke barabar rows dikhaane ke liye.
      if (group.occ.length < caps.dupRows) group.occ.push([agent ? agent.k : `${ch}|`, str(rec.key), str(rec.tagId), str(rec.cls).toUpperCase()]);
    }

    // Sirf wo VRN "duplicate" hain jo sach me 2+ baar aaye — per-agent counts yahan finalize hote hain
    // (warna ek-baar wale VRN bhi doubleVrn me jud jaate aur card ka number galat banta).
    const dup = [];
    const dupRows = [];
    for (const group of dupMap.values()) {
      if (group.n < 2) continue;
      totals.dupGroups++;
      totals.dupTags += group.n;
      for (const [k, n] of group.byAgent) {
        const a = agents.get(k);
        if (a) { a.d += n; totals.dup += n; }
      }
      for (const o of group.occ || []) {
        if (dupRows.length >= caps.dupRows) { truncated.dupRows = true; break; }
        dupRows.push([o[0], o[1], o[2], group.v, o[3]]);
      }
      if (dup.length >= caps.dupGroups) { truncated.dup = true; continue; }
      dup.push({
        v: group.v,
        n: group.n,
        a: [...group.byAgent.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => [k, n]),
        d: uniqSorted(group.dates).slice(0, caps.dupDates),
        c: uniqFirst(group.classes, 12),
        t: uniqFirst(group.tagIds, caps.dupTagIds)
      });
    }
    dup.sort((x, y) => y.n - x.n || x.v.localeCompare(y.v));
    if (totals.dupGroups > dup.length) truncated.dup = true;
    if (totals.dup > dupRows.length) truncated.dupRows = true;
    dupRows.sort((x, y) => x[1].localeCompare(y[1]) || x[3].localeCompare(y[3]));

    const agentOut = {};
    for (const a of agents.values()) {
      agentOut[a.k] = { ch: a.ch, name: a.name, id: a.id, tl: a.tl, w: a.w, i: a.i, b: a.b, d: a.d, r: a.r, c: a.c };
    }
    return {
      v: VERSION,
      from, to,
      builtAt: Date.now(),
      ms: Number(opt.ms) || 0,
      meta: { source: 'scan', rowsRead: totals.rows, pages: 0, complete: true, ...(opt.meta || {}), truncated },
      totals,
      agents: agentOut,
      dup, dupRows, bad, rep, cha
    };
  }

  /** Index me koi agent (naam/ID dono se dhoondh leta hai). */
  function agentOf(index, key) { return (index && index.agents && index.agents[key]) || null; }

  /** Ek agent ke duplicate VRN groups — agent forensic drawer ke liye. */
  function doubleListOf(index, key) {
    const out = [];
    for (const d of (index && index.dup) || []) {
      const hit = (d.a || []).find((x) => x[0] === key);
      if (hit) out.push({ vrn: d.v, count: d.n, agentCount: hit[1], dates: d.d || [], classes: d.c || [], tagIds: d.t || [] });
    }
    return out.sort((a, b) => b.count - a.count || a.vrn.localeCompare(b.vrn));
  }
  /** Ek agent ke malformed / invalid VRN rows. */
  function invalidListOf(index, key) {
    return ((index && index.bad) || [])
      .filter((r) => r[0] === key && (r[5] === 2 || r[5] === 3))
      .map((r) => ({ key: r[1], tagId: r[2], vrn: r[3], vrnType: r[4], kind: r[5] }));
  }
  /** Search ke liye chhota blob — poora evidence materialize kiye bina VRN search kaam kare. */
  function searchBlobOf(index, key) {
    const parts = [];
    for (const d of doubleListOf(index, key).slice(0, 25)) parts.push(d.vrn);
    for (const r of invalidListOf(index, key).slice(0, 25)) parts.push(r.vrn);
    return parts.join(' ').toLowerCase();
  }

  /** Duplicate VRN register — kuch agents (subset) ke liye, exactly wahi jo card/drawer me dikhta hai. */
  function duplicatesFor(index, keys) {
    const want = keys instanceof Set ? keys : new Set(keys || []);
    const out = [];
    for (const d of (index && index.dup) || []) {
      const agents = (d.a || []).filter((x) => !want.size || want.has(x[0]));
      if (!agents.length) continue;
      const names = [], tls = [], chs = [];
      let count = 0;
      for (const [k, n] of agents) {
        const a = agentOf(index, k);
        count += n;
        if (a) {
          if (a.name && !names.includes(a.name)) names.push(a.name);
          if (a.tl && !tls.includes(a.tl)) tls.push(a.tl);
          const c = a.ch === 'gv' ? 'GV' : 'FF';
          if (!chs.includes(c)) chs.push(c);
        }
      }
      out.push({
        vrn: d.v, count, total: d.n, agents: names, tls, channels: chs,
        agentCounts: agents.map(([k, n]) => ({ key: k, n, ...(agentOf(index, k) || {}) })),
        classes: d.c || [], dates: d.d || [], tagIds: d.t || []
      });
    }
    return out.sort((a, b) => b.count - a.count || a.vrn.localeCompare(b.vrn));
  }

  const EVIDENCE_HEAD = {
    double: ['Date', 'Tag ID', 'VRN (Vehicle No.)', 'Class', 'Agent', 'Agent ID', 'Channel', 'TL'],
    doubleGroups: ['VRN (Vehicle No.)', 'Tags Issued (times)', 'Agent', 'Agent ID', 'Channel', 'TL', 'Classes', 'Dates', 'Tag IDs'],
    wrong: ['Date', 'Tag ID', 'VRN entered', 'VRN Type', 'Problem', 'Agent', 'Agent ID', 'Channel', 'TL'],
    replace: ['Date', 'Tag ID', 'VRN', 'Class', 'Type', 'Status', 'Agent', 'Agent ID', 'Channel', 'TL'],
    chassis: ['Date', 'Tag ID', 'VRN', 'Class', 'VRN Type', 'Agent', 'Agent ID', 'Channel', 'TL'],
    spike: ['Peak Date', 'Tags on Peak Day', 'Agent Avg/Day', 'Spike ×', 'Active Days', 'Agent', 'Agent ID', 'Channel', 'TL'],
    all: ['Agent', 'Agent ID', 'Channel', 'TL', 'Risk Score', 'Severity', 'Total Issued', 'Flags']
  };

  /**
   * 🎯 Flag ka EXACT tag-level evidence — KPI card ka number isi se banta hai, isliye card aur
   * drawer/CSV me ek hi data dikhta hai. `rows` arrays hain (CSV me seedha jaate hain).
   */
  function evidence(index, opt) {
    const o = opt || {};
    const flag = o.flag === 'multi' ? 'all' : (o.flag || 'all');
    const want = o.keys instanceof Set ? o.keys : new Set(o.keys || []);
    const limit = Number(o.limit) || 0;
    const inScope = (key) => !want.size || want.has(key);
    const agentCells = (key) => {
      const a = agentOf(index, key) || {};
      return [a.name || '—', a.id || '—', a.ch === 'gv' ? 'GV' : 'FF', a.tl || 'Direct'];
    };
    let rows = [];
    let head = null;
    if (flag === 'double') {
      // 🎯 Tag-level rows — card "N duplicate tags" bolta hai to drawer me wahi N rows dikhni chahiye.
      if (Array.isArray(index && index.dupRows) && index.dupRows.length) {
        head = ['Date', 'Tag ID', 'VRN', 'Class', 'Agent', 'Agent ID', 'Ch', 'TL'];
        rows = index.dupRows.filter((r) => inScope(r[0])).map((r) => [r[1] || '—', r[2] || '—', r[3] || '—', r[4] || '—', ...agentCells(r[0])]);
      } else {
        // Purana/cached index (dupRows ke bina) — group × agent rows se kaam chalao.
        head = EVIDENCE_HEAD.doubleGroups.slice();
        for (const d of duplicatesFor(index, want)) {
          for (const ac of d.agentCounts) {
            const a = agentOf(index, ac.key) || {};
            rows.push([d.vrn, ac.n, a.name || '—', a.id || '—', a.ch === 'gv' ? 'GV' : 'FF', a.tl || 'Direct', (d.classes || []).join(' | '), (d.dates || []).join(' | '), (d.tagIds || []).join(' | ')]);
          }
        }
      }
    } else if (flag === 'wrong') {
      rows = ((index && index.bad) || []).filter((r) => inScope(r[0])).map((r) => {
        const kind = r[5] === 3 ? 'Wrong VRN + malformed' : r[5] === 1 ? 'Wrong VRN (sheet mark)' : 'Malformed / invalid VRN';
        return [r[1], r[2] || '—', r[3] || '(blank)', r[4] || '—', kind, ...agentCells(r[0])];
      });
    } else if (flag === 'replace') {
      rows = ((index && index.rep) || []).filter((r) => inScope(r[0])).map((r) => [r[1], r[2] || '—', r[3] || '—', r[4] || '—', r[5] || '—', r[6] || '—', ...agentCells(r[0])]);
    } else if (flag === 'chassis') {
      rows = ((index && index.cha) || []).filter((r) => inScope(r[0])).map((r) => [r[1], r[2] || '—', r[3] || '(blank)', r[4] || '—', r[5] || '—', ...agentCells(r[0])]);
    } else if (Array.isArray(o.rows)) {
      // 'all' / 'multi' / 'spike' — agent-level rows caller (page model) se aate hain.
      rows = o.rows;
    }
    const total = rows.length;
    if (limit && rows.length > limit) rows = rows.slice(0, limit);
    return { head: (o.head || head || EVIDENCE_HEAD[flag] || EVIDENCE_HEAD.all).slice(), rows, total, truncated: total > rows.length };
  }

  const api = {
    VERSION, CAPS, EVIDENCE_HEAD,
    str, cleanVrn, isWrongType, isChassisType, isReplacement, isInvalidVrnFormat, isPlaceholderVrn,
    channelOfEir, chOf, agentKey, recordKey, dedupe,
    buildIndex, agentOf, doubleListOf, invalidListOf, searchBlobOf, duplicatesFor, evidence
  };

  g.FFunusualScan = api;
  // Browser: FF namespace me rakho (lazy.js `FF['unusual-scan']` dekh kar re-inject skip karta hai).
  try {
    const FF = g.FF || (g.FF = {});
    FF.unusualScan = api;
    FF['unusual-scan'] = api;
  } catch { /* server: global kaafi hai */ }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
