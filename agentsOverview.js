/* 🧮 GV & FF Agents Summary — kitne agents ke paas stock hai, kaun direct / TL-managed, kaun active / inactive.
   Sab number clickable (KPI drill list: search · agent profile · CSV). Data: FF = Performance (REPORT + EIR),
   GV = Tag Assignment (stock) + GV REPORT + EIR rollup (issuance).
   Definitions (dono channel par same):
     • Stock agent   = jiske paas stock > 0
     • Active        = is month me ≥ 1 tag issue kiya
     • Inactive      = is month me 0 issuance, aur stock abhi bhi uske paas
         – this month only = pichhle month issue kiya tha, is month nahi
         – 2 months        = na pichhle month, na is month (2+ mahine se band) */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean, fmt = U.fmt;
  const CH = { ff: { label: 'First Forward', icon: '🟦' }, gv: { label: 'GV Partner', icon: '🟩' } };
  const state = { rows: [], months: {}, tab: 'both', q: '', at: 0, busy: null, sourceErrors: {} };
  const keyOf = (v) => clean(v).toUpperCase().replace(/\.0+$/, '').replace(/\s+/g, ' ');
  const isDirect = (r, ch) => { try { return !!FF.config.isDirectAgent(r, ch); } catch { return false; } };
  const num = (v) => Number(v) || 0;
  const CLASSES = ['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16'];   // VC20 = commercial class of VC4 → counted under VC4/20
  const CLS_LABEL = { VC4: 'VC4/20' };
  const clsLabel = (c) => CLS_LABEL[c] || c;
  const clsKey = (c) => { const m = /^\s*VC\s*0*(\d+)/i.exec(String(c || '')); const k = m ? (m[1] === '20' ? 'VC4' : `VC${m[1]}`) : ''; return CLASSES.includes(k) ? k : ''; };
  const clsMap = (rows) => { const m = new Map(); (rows || []).forEach((r) => { const n = num(r.n); if (!n) return; [keyOf(r.agentId), `N:${keyOf(r.agentName)}`].forEach((k) => { if (!k || k === 'N:') return; const o = m.get(k) || {}; const c = clsKey(r.cls); if (!c) return; o[c] = (o[c] || 0) + n; m.set(k, o); }); }); return m; };
  const clsOf = (m, id, name) => { const o = m.get(keyOf(id)) || m.get(`N:${keyOf(name)}`) || {}; const out = {}; CLASSES.forEach((c) => { out[c] = o[c] || 0; }); return out; };
  const clsSum = (l) => { const t = {}; CLASSES.forEach((c) => { t[c] = l.reduce((s, r) => s + ((r.cls && r.cls[c]) || 0), 0); }); return t; };

  // Office / placeholder holders are not agents: GV "Not Assigned", FF "APNA PAYMENT" (company ID 5845036).
  const isOffice = (id, name) => /^\s*not\s*assigned\s*$/i.test(`${id}`) || /^\s*not\s*assigned\s*$/i.test(`${name}`) || /^\s*apna\s*payment(\s*pvt.*)?\s*$/i.test(`${name}`) || String(id).trim() === '5845036';
  // ---- data ---------------------------------------------------------------------------------------
  /** Month-end projection of this month's issuance (run-rate × days in month). */
  const projected = (cur, ch) => {
    let days = 0; try { days = Number(U.runRateDays ? U.runRateDays(ch) : 0) || 0; } catch { days = 0; }
    const n = new Date(); const dim = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    return days > 0 ? (cur / days) * dim : cur;
  };
  const classify = (r) => {
    r.type = r.direct ? 'direct' : 'managed';
    r.deg = r.cur > 0 && r.last > 0 && (r.proj > 0 ? r.proj : projected(r.cur, r.ch)) < r.last;   // issuing, but on track for less than last month
    r.status = r.cur > 0 ? 'active' : r.last > 0 ? 'in1' : 'in2';   // in1 = inactive this month, in2 = inactive 2 months
    return r;
  };
  async function ffRows() {
    const out = [];
    let fm = new Map();
    try { fm = clsMap(await FF.store.need('stockAgents')); } catch { /* class split optional */ }
    try {
      if (FF.pages.performance && FF.pages.performance.ensureLoaded) await FF.pages.performance.ensureLoaded();
      const list = (FF.pages.performance && FF.pages.performance.agents && FF.pages.performance.agents()) || [];
      list.forEach((a) => {
        const stock = num(a.stockTotal); if (stock <= 0 || isOffice(a.agentId || a.id, a.name)) return;
        out.push(classify({ ch: 'ff', id: clean(a.agentId || a.id), name: clean(a.name || a.agentId), tlName: clean(a.tlName), tlId: clean(a.tlId), direct: isDirect(a, 'ff'), stock, vc4Stock: num(a.stockVc4), cls: clsOf(fm, a.agentId || a.id, a.name), proj: num(a.curProjected), cur: num(a.curTotal), last: num(a.lastTotal), lastActive: clean(a.lastActive).replace(/^[^\p{L}\d]+/u, '') }));
      });
    } catch (err) { state.sourceErrors.ff = err.message || 'FF summary unavailable'; }
    return out;
  }
  const prevYm = (ym) => { const [y, m] = String(ym).split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  async function gvRows() {
    const out = [], G = FF.gv, S = FF.store;
    if (!G) return out;
    // Same datasets as GV Performance: EIR (daily + agent/class roll-ups) + GV Master (today) + GV REPORT.
    // Without agents/agentClass/master the EIR roll-up came back empty → "this month 0 · last month 0" for everyone.
    const opt = (p) => Promise.resolve().then(p).catch(() => null);
    const [dailyR, agentsR, agentClassR, masterR, stockRowsR, reportR, clsR] = await Promise.all([
      opt(() => S && S.need('daily')), opt(() => S && S.need('agents')), opt(() => S && S.need('agentClass')), opt(() => G.need('master')),
      opt(() => G.need('stockAgent')), opt(() => G.need('report')), opt(() => G.need('stockAgentClass'))
    ]);
    if (stockRowsR === null) { state.sourceErrors.gv = 'GV stock could not be loaded'; return out; }
    if ([dailyR, agentsR, agentClassR, masterR, reportR].every((v) => v === null)) { state.sourceErrors.gv = 'GV issuance sources could not be loaded'; return out; }
    const stockRows = stockRowsR || [], report = reportR || [], gm = clsMap(clsR || []);
    // Calendar months (same rule as GV Performance): this month = today's month, last = previous calendar month.
    const cur = U.ymKey(new Date()), prev = U.prevMonthKey ? U.prevMonthKey(cur) : prevYm(cur);
    // 1) Tag ledger (EIR history + GV Master live) → per agent per month, plus last issuance date.
    const led = { [cur]: new Map(), [prev]: new Map() }, lastDate = new Map();
    const bump = (m, keys, n) => { const seen = new Set(); keys.forEach((k) => { if (!k || seen.has(k)) return; seen.add(k); m.set(k, (m.get(k) || 0) + n); }); };
    let issRows = [];
    try { issRows = (G.issuanceRows && G.issuanceRows()) || []; } catch { issRows = []; }
    issRows.forEach((r) => {
      const keys = [keyOf(r.agentId), `N:${keyOf(r.agentName)}`].filter((k) => k && k !== 'N:');
      if (led[r.ym]) bump(led[r.ym], keys, num(r.n) || 1);
      const d = r.date || r.d; const dk = d ? (U.dateKey ? U.dateKey(d) : String(d)) : '';
      if (dk) keys.forEach((k) => { if (!lastDate.has(k) || lastDate.get(k) < dk) lastDate.set(k, dk); });
    });
    // 2) EIR monthly roll-up (covers months where daily rows are not loaded).
    const roll = (ym) => { const m = new Map(); try { (G.agentRollup(ym) || []).forEach((a) => { const t = num(a.total); [keyOf(a.agentId), `N:${keyOf(a.agentName)}`].forEach((k) => { if (k && k !== 'N:') m.set(k, Math.max(m.get(k) || 0, t)); }); }); } catch { /* ignore */ } return m; };
    const rollCur = roll(cur), rollPrev = roll(prev);
    const get = (m, id, name) => (m.get(keyOf(id)) || m.get(`N:${keyOf(name)}`) || 0);
    // 3) GV REPORT row per agent (TL mapping + sheet totals).
    const rep = new Map();
    report.forEach((r) => { [keyOf(r.agentId), `N:${keyOf(r.agentName)}`].forEach((k) => { if (k && k !== 'N:' && !rep.has(k)) rep.set(k, r); }); });
    // Who actually leads agents: any ID / name that appears as another agent's TL. A self-supervised row
    // (TL ID = own ID) of such a person is a TL — not a direct agent.
    const leaders = new Set();
    const addLeader = (r) => { const own = keyOf(r.agentId), tid = keyOf(r.tlId), tn = keyOf(r.tlName); if (tid && tid !== own) leaders.add(tid); if (tn && tn !== keyOf(r.agentName) && !/^(DIRECT|TL .*)$/.test(tn)) leaders.add(`N:${tn}`); };
    report.forEach(addLeader); stockRows.forEach(addLeader);
    const isLeader = (id, name) => leaders.has(keyOf(id)) || leaders.has(`N:${keyOf(name)}`);
    const realTl = (r) => { const id = clean(r && r.tlId), nm = clean(r && r.tlName); return { id, name: /^(direct|—|-)$/i.test(nm) ? '' : nm }; };
    // Aggregate stock by agent; TL fields from the agent's biggest stock row.
    const agg = new Map();
    stockRows.forEach((r) => {
      const id = clean(r.agentId), key = keyOf(id) || `N:${keyOf(r.agentName)}`;
      if (!key || key === 'N:') return;
      const o = agg.get(key) || { ch: 'gv', id, name: clean(r.agentName || id), tlName: '', tlId: '', stock: 0, top: -1 };
      const n = num(r.n); o.stock += n;
      if (n > o.top) { o.top = n; const t = realTl(r); o.tlId = t.id; o.tlName = t.name; }
      agg.set(key, o);
    });
    agg.forEach((o) => {
      if (o.stock <= 0 || isOffice(o.id, o.name)) return;
      o.cls = clsOf(gm, o.id, o.name);
      const rp = rep.get(keyOf(o.id)) || rep.get(`N:${keyOf(o.name)}`) || null;
      // TL mapping: GV REPORT TL first; Tag Assignment TL when the REPORT cell is blank / row missing.
      if (rp) { const t = realTl(rp); if (t.id || t.name) { o.tlId = t.id; o.tlName = t.name; } }
      const self = (!o.tlId || keyOf(o.tlId) === keyOf(o.id)) && (!o.tlName || keyOf(o.tlName) === keyOf(o.name));
      o.isTl = isLeader(o.id, o.name);
      if (o.isTl) { o.direct = false; o.tlId = o.id; o.tlName = o.name; }                // a TL's own stock → TL side
      else if (self) { o.direct = true; o.tlId = ''; o.tlName = 'Direct'; }            // no TL / self, leads nobody → direct
      else o.direct = isDirect({ agentId: o.id, agentName: o.name, tlId: o.tlId, tlName: o.tlName, channel: 'GV Partner' }, 'gv');
      // Issuance: ledger → EIR roll-up → GV REPORT, largest wins per month (each source can lag).
      o.cur = Math.max(get(led[cur], o.id, o.name), get(rollCur, o.id, o.name), rp ? num(rp.curTotal) : 0);
      o.last = Math.max(get(led[prev], o.id, o.name), get(rollPrev, o.id, o.name), rp ? num(rp.lastTotal) : 0);
      o.vc4Stock = o.cls.VC4 || (rp ? num(rp.stockVc4) : 0);
      const ld = lastDate.get(keyOf(o.id)) || lastDate.get(`N:${keyOf(o.name)}`) || '';
      o.lastActive = ld || clean((rp && rp.lastActive) || '').replace(/^[^\p{L}\d]+/u, '');
      delete o.top; out.push(classify(o));
    });
    return out;
  }
  async function load(force) {
    if (state.busy) return state.busy;
    if (!force && state.rows.length && Date.now() - state.at < 120000) return state.rows;
    state.busy = (async () => {
      state.sourceErrors = {};
      const [f, g] = await Promise.all([ffRows(), gvRows()]);
      state.rows = [...f, ...g]; state.at = Date.now();
      return state.rows;
    })().finally(() => { state.busy = null; });
    return state.busy;
  }

  // ---- numbers ------------------------------------------------------------------------------------
  const sumStock = (l) => l.reduce((s, r) => s + r.stock, 0);
  const forCh = (ch) => (ch === 'both' ? state.rows : state.rows.filter((r) => r.ch === ch));
  const BUCKETS = {
    all: () => true, direct: (r) => r.direct, managed: (r) => !r.direct,
    deg: (r) => r.deg, 'd.deg': (r) => r.direct && r.deg, 'm.deg': (r) => !r.direct && r.deg,
    active: (r) => r.status === 'active', inactive: (r) => r.status !== 'active', in1: (r) => r.status === 'in1', in2: (r) => r.status === 'in2',
    'd.active': (r) => r.direct && r.status === 'active', 'd.inactive': (r) => r.direct && r.status !== 'active', 'd.in1': (r) => r.direct && r.status === 'in1', 'd.in2': (r) => r.direct && r.status === 'in2',
    'm.active': (r) => !r.direct && r.status === 'active', 'm.inactive': (r) => !r.direct && r.status !== 'active', 'm.in1': (r) => !r.direct && r.status === 'in1', 'm.in2': (r) => !r.direct && r.status === 'in2'
  };
  const TITLES = {
    deg: 'De-growth', 'd.deg': 'Direct · de-growth', 'm.deg': 'TL-managed · de-growth',
    all: 'Agents with stock', direct: 'Direct agents', managed: 'TL-managed agents', active: 'Active agents', inactive: 'Inactive agents', in1: 'Inactive · this month', in2: 'Inactive · 2 months',
    'd.active': 'Direct · active', 'd.inactive': 'Direct · inactive', 'd.in1': 'Direct · inactive this month', 'd.in2': 'Direct · inactive 2 months',
    'm.active': 'TL-managed · active', 'm.inactive': 'TL-managed · inactive', 'm.in1': 'TL-managed · inactive this month', 'm.in2': 'TL-managed · inactive 2 months'
  };
  const listFor = (ch, b) => forCh(ch).filter(BUCKETS[b] || BUCKETS.all);
  function tlGroups(ch) {
    const map = new Map();
    forCh(ch).filter((r) => !r.direct).forEach((r) => {
      const name = r.tlName || 'Unmapped', k = `${r.ch}|${keyOf(r.tlId) || keyOf(name)}`;
      const g = map.get(k) || { ch: r.ch, name, id: r.tlId, agents: 0, active: 0, inactive: 0, stock: 0, inactiveStock: 0, cur: 0 };
      g.stock += r.stock; g.cur += r.cur;
      if (r.isTl) { g.ownStock = (g.ownStock || 0) + r.stock; map.set(k, g); return; }   // TL's own stock — not one of "his agents"
      g.agents++;
      if (r.status === 'active') g.active++; else { g.inactive++; g.inactiveStock += r.stock; }
      map.set(k, g);
    });
    return [...map.values()].sort((a, b) => b.stock - a.stock);
  }
  const stat = (ch) => {
    const all = forCh(ch), o = {};
    Object.keys(BUCKETS).forEach((b) => { const l = all.filter(BUCKETS[b]); o[b] = { n: l.length, stock: sumStock(l) }; });
    const tls = tlGroups(ch); o.tls = { n: tls.length, stock: sumStock(all.filter((r) => !r.direct)) };
    o.perTl = tls.length ? o.managed.n / tls.length : 0;
    return o;
  };

  // ---- drill lists --------------------------------------------------------------------------------
  const TYPE_LBL = { direct: '🚫 Direct', managed: '🧑‍💼 TL' };
  const ST_LBL = { active: '🟢 Active', in1: '🟠 Inactive · this month', in2: '🔴 Inactive · 2 months' };
  function register() {
    if (!FF.kpiDetail || !FF.kpiDetail.registerList || register.done) return;
    register.done = true;
    const e = esc;
    const cols = [['Ch', (r) => (r.ch === 'gv' ? '🟩 GV' : '🟦 FF')], ['Agent', (r) => `<b>${e(r.name)}</b> <small class="dim">${e(r.id || '')}</small>`], ['TL', (r) => e(r.direct ? 'Direct' : r.tlName || '—')], ['Status', (r) => ST_LBL[r.status]],
      ['Stock', (r) => fmt(r.stock), 1], ...CLASSES.map((c) => [clsLabel(c), (r) => fmt((r.cls && r.cls[c]) || 0), 1]), ['This month', (r) => fmt(r.cur), 1], ['Last month', (r) => fmt(r.last), 1], ['Last active', (r) => e(r.lastActive || '—')]];
    ['ff', 'gv', 'both'].forEach((ch) => {
      Object.keys(BUCKETS).forEach((b) => {
        FF.kpiDetail.registerList(`aov.${ch}.${b}`, () => {
          const rows = listFor(ch, b).sort((a, c) => c.stock - a.stock || c.cur - a.cur);
          const who = ch === 'both' ? 'GV + FF' : CH[ch].label;
          return { kicker: `${who} · ${TITLES[b]}`, title: `${who} · ${TITLES[b]}`, unit: 'agents', rows, columns: cols, agent: (r) => ({ name: r.name, id: r.id, ch: r.ch }),
            headline: { value: sumStock(rows), unit: 'tags in stock' },
            sub: `Stock by class: ${classLine(rows)} · This month issued <b>${fmt(U.sum(rows, (r) => r.cur))}</b> · last month <b>${fmt(U.sum(rows, (r) => r.last))}</b>` };
        });
      });
      FF.kpiDetail.registerList(`aov.${ch}.tls`, () => {
        const rows = tlGroups(ch);
        return { kicker: `${ch === 'both' ? 'GV + FF' : CH[ch].label} · TLs holding stock`, title: `${ch === 'both' ? 'GV + FF' : CH[ch].label} · TLs holding stock`, unit: 'TLs', rows, headline: { value: sumStock(rows.map((g) => ({ stock: g.stock }))), unit: 'tags with their agents' },
          columns: [['Ch', (r) => (r.ch === 'gv' ? '🟩 GV' : '🟦 FF')], ['TL', (r) => `<b>${e(r.name)}</b> <small class="dim">${e(r.id || '')}</small>`], ['Agents', (r) => fmt(r.agents), 1], ['Active', (r) => fmt(r.active), 1], ['Inactive', (r) => fmt(r.inactive), 1], ['Stock', (r) => fmt(r.stock), 1], ['Stock · inactive', (r) => fmt(r.inactiveStock), 1], ['Issued MTD', (r) => fmt(r.cur), 1]],
          agent: () => null, tl: (r) => ({ name: r.name, id: r.id, ch: r.ch }), sub: 'Direct agents are not counted here.' };
      });
    });
  }
  const classLine = (l) => { const t = clsSum(l); return CLASSES.filter((c) => t[c]).map((c) => `${clsLabel(c)} <b>${fmt(t[c])}</b>`).join(' · ') || '—'; };
  const kp = (ch, b) => `data-kpi="scope=list&list=aov.${ch}.${b}&src=${ch === 'both' ? 'both' : ch}"`;

  // Follow-up rules use the same stock and issuance as this summary; ageing is separate and may be unavailable.
  const follow = { age: {}, errors: {}, q: '', reason: 'all', low: 5, limit: 100, seq: 0 };
  function followupRows(rows, ageSources, targets, ym, lowThreshold = 5) {
    const targetMap = new Map((targets || []).filter((t) => t && t.ym === ym && t.key).map((t) => [String(t.key).toUpperCase(), t]));
    const indices = {};
    for (const ch of ['ff', 'gv']) {
      if (!Array.isArray(ageSources[ch])) continue;
      const ids = new Map(), names = new Map();
      for (const a of ageSources[ch]) {
        const id = keyOf(a.id), name = keyOf(a.name);
        if (id) ids.set(id, a);
        if (name) names.set(name, names.has(name) ? null : a);
      }
      indices[ch] = { ids, names };
    }
    return (rows || []).filter((r) => !r.isTl).map((r) => {
      const idx = indices[r.ch], id = keyOf(r.id), name = keyOf(r.name);
      // Do not join two different IDs by name; a name-only record is usable only when unambiguous.
      const byName = idx && idx.names.get(name);
      const age = idx ? (idx.ids.get(id) || (byName && (!id || !keyOf(byName.id)) ? byName : null)) : null;
      const t = targetMap.get(`${r.ch}|${name}`.toUpperCase());
      const target = t && Number(t.target) > 0 ? Number(t.target) : null;
      const projection = num(r.proj) || projected(num(r.cur), r.ch);
      const reasons = [];
      if (r.status === 'in2') reasons.push('No issuance in 2 months');
      else if (r.status === 'in1') reasons.push('No issuance this month');
      else if (num(r.cur) > 0 && lowThreshold > 0 && num(r.cur) <= lowThreshold) reasons.push(`Low issuance (≤${lowThreshold} MTD)`);
      if (r.deg) reasons.push('Projected de-growth');
      if (age && age.age90 > 0) reasons.push('Stock aged 90+ days');
      if (target && projection < target) reasons.push('Below target pace');
      if (t && t.goal === 'active' && !num(r.cur)) reasons.push('Active goal pending');
      const score = (r.status === 'in2' ? 4 : r.status === 'in1' ? 3 : num(r.cur) > 0 && lowThreshold > 0 && num(r.cur) <= lowThreshold ? 1 : 0) + (age && age.age90 > 0 ? 2 : 0) + (r.deg ? 1 : 0) + (target && projection < target ? 1 : 0);
      return { ...r, age, target, projection, reasons, score, priority: score >= 5 ? 'High' : score >= 3 ? 'Medium' : 'Review' };
    }).filter((r) => r.reasons.length).sort((a, b) => b.score - a.score || (b.age?.age90 || 0) - (a.age?.age90 || 0) || b.stock - a.stock || a.name.localeCompare(b.name));
  }
  const followRows = () => followupRows(forCh(state.tab).filter((r) => FF.auth.can(r.ch === 'ff' ? 'sheet:StockDataa' : 'sheet:Tag Assignment')), follow.age, FF.auth.settings?.targets || [], U.ymKey(new Date()), follow.low)
    .filter((r) => follow.reason === 'all' || r.reasons.some((x) => x.toLowerCase().includes(follow.reason)))
    .filter((r) => !follow.q || `${r.name} ${r.id} ${r.tlName} ${r.reasons.join(' ')}`.toLowerCase().includes(follow.q));
  function followHtml() {
    const rows = followRows(), shown = rows.slice(0, follow.limit);
    const notes = Object.entries(follow.errors).filter(([ch]) => state.tab === 'both' || state.tab === ch).map(([ch, msg]) => `${ch.toUpperCase()}: ${msg}`).join(' · ');
    const sourceNotes = Object.entries(state.sourceErrors).filter(([ch]) => state.tab === 'both' || state.tab === ch).map(([ch, msg]) => `${ch.toUpperCase()}: ${msg}`).join(' · ');
    return `<div class="aov-asg-bar"><select class="input" data-fu-reason><option value="all" ${follow.reason === 'all' ? 'selected' : ''}>All reasons</option><option value="no issuance" ${follow.reason === 'no issuance' ? 'selected' : ''}>No issuance</option><option value="low issuance" ${follow.reason === 'low issuance' ? 'selected' : ''}>Low issuance</option><option value="de-growth" ${follow.reason === 'de-growth' ? 'selected' : ''}>De-growth</option><option value="90+" ${follow.reason === '90+' ? 'selected' : ''}>90+ days stock</option><option value="target pace" ${follow.reason === 'target pace' ? 'selected' : ''}>Below target pace</option></select><label class="small">Low MTD ≤ <select class="input" data-fu-low>${[0, 1, 5, 10, 20].map((n) => `<option value="${n}" ${follow.low === n ? 'selected' : ''}>${n || 'Off'}</option>`).join('')}</select></label><input class="input" data-fu-q placeholder="Search agent / ID / TL" value="${esc(follow.q)}">${FF.auth.can('export') ? '<button class="btn small" data-fu-csv>⬇ CSV (filtered)</button>' : ''}<span class="dim small">${fmt(rows.length)} agents</span></div>
      ${sourceNotes ? `<p role="alert" class="small">⚠ Summary data unavailable: ${esc(sourceNotes)}. Affected agents are not shown.</p>` : ''}
      ${notes ? `<p role="alert" class="small">⚠ Ageing unavailable: ${esc(notes)}. Other follow-up reasons remain available.</p>` : ''}
      <div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Priority</th><th>Agent</th><th>TL</th><th>Reasons</th><th>Stock</th><th>90+ days</th><th>Age unknown</th><th>This month</th><th>Last month</th><th>Target / projected</th></tr></thead><tbody>${shown.map((r) => `<tr><td><b>${esc(r.priority)}</b></td><td>${r.ch === 'gv' ? '🟩' : '🟦'} ${FF.auth.can(`${r.ch}AgentSummary`) ? `<a href="#/${r.ch}AgentSummary?name=${encodeURIComponent(r.name)}">${esc(r.name)}</a>` : esc(r.name)}<br><small class="dim">${esc(r.id)}</small></td><td>${esc(r.direct ? 'Direct' : r.tlName || '—')}</td><td>${esc(r.reasons.join(' · '))}</td><td>${fmt(r.stock)}</td><td>${r.age ? fmt(r.age.age90) : '—'}</td><td>${r.age ? fmt(r.age.unknown) : '—'}</td><td>${fmt(r.cur)}</td><td>${fmt(r.last)}</td><td>${r.target ? `${fmt(r.target)} / ${fmt(Math.round(r.projection))}` : '—'}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">No agents match the follow-up rules.</td></tr>'}</tbody></table></div>${rows.length > shown.length ? `<button class="btn small" data-fu-more>Show more (${fmt(rows.length - shown.length)} remaining)</button>` : ''}
      <p class="dim small">Stock holders only; priority uses inactivity, low MTD issuance (threshold above), 90+ day stock, projected de-growth and overall monthly target pace. Target pace uses month-end projection, not actual target achievement; class-only targets are not evaluated. GV 90+ age uses assigned in-stock rows; unknown ages are shown separately. FF / GV issuance uses Agents Summary sources and may lag their sheets.</p>`;
  }
  function paintFollow(root) { const node = root.querySelector('#aov-follow-body'); if (node) node.innerHTML = followHtml(); }
  async function loadFollowAge(root) {
    const seq = ++follow.seq; follow.age = {}; follow.errors = { ff: 'Loading', gv: 'Loading' }; paintFollow(root);
    await Promise.all(['ff', 'gv'].map(async (ch) => {
      if (!FF.auth.can(ch === 'ff' ? 'sheet:StockDataa' : 'sheet:Tag Assignment')) { follow.errors[ch] = 'No sheet access'; return; }
      try {
        let result; const start = Date.now();
        do { result = await FF.auth.api(`/api/agent-followup-age?source=${ch}`); if (!result.pending) break; if (Date.now() - start > 4 * 60e3) throw new Error('Index still loading'); await new Promise((resolve) => setTimeout(resolve, 3000)); } while (seq === follow.seq && root.isConnected);
        if (seq === follow.seq && result && !result.pending) { follow.age[ch] = result.rows; delete follow.errors[ch]; }
      } catch (err) { if (seq === follow.seq) follow.errors[ch] = err.message || 'Could not load'; }
    }));
    if (seq === follow.seq && root.isConnected) paintFollow(root);
  }
  function followCsv() {
    const safe = (v) => { const s = String(v ?? ''); return /^[\t\r\n ]*[=+@-]/.test(s) ? `'${s}` : s; };
    U.downloadCsv(`agent-follow-up-${U.stamp()}.csv`, ['Priority', 'Channel', 'Agent', 'Agent ID', 'TL', 'Reasons', 'Stock', 'Stock 90+ days', 'Age unknown', 'This month', 'Last month', 'Overall target', 'Month-end projection'], followRows().map((r) => [r.priority, r.ch.toUpperCase(), r.name, r.id, r.direct ? 'Direct' : r.tlName, r.reasons.join(' · '), r.stock, r.age ? r.age.age90 : '', r.age ? r.age.unknown : '', r.cur, r.last, r.target ?? '', r.target ? Math.round(r.projection) : ''].map(safe)));
  }

  // ---- render -------------------------------------------------------------------------------------
  const CSS = `.aov-wrap .aov-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 14px}
.aov-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}
.aov-card{border:1px solid var(--line,#e5e7eb);border-radius:16px;padding:14px 16px;background:var(--card,#fff)}
.aov-card h3{margin:0 0 2px;font-size:16px}.aov-card .aov-sub{color:var(--muted,#6b7280);font-size:12px;margin-bottom:10px}
.aov-chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.aov-chip{border:1px solid var(--line,#e5e7eb);border-radius:12px;padding:8px 12px;min-width:112px;background:var(--bg-soft,#f8fafc);cursor:pointer;text-align:left;font:inherit;color:inherit}
.aov-chip:hover{border-color:#6366f1;box-shadow:0 2px 8px rgba(99,102,241,.18)}
.aov-chip small{display:block;color:var(--muted,#6b7280);font-size:11px}.aov-chip b{font-size:20px;display:block;line-height:1.2}.aov-chip i{font-style:normal;font-size:11px;color:var(--muted,#6b7280)}
.aov-chip.good b{color:#059669}.aov-chip.warn b{color:#d97706}.aov-chip.bad b{color:#dc2626}
.aov-sec{margin:12px 0 4px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#6b7280)}
.aov-bar{display:flex;height:10px;border-radius:99px;overflow:hidden;background:#e5e7eb;margin:6px 0 2px}.aov-bar span{display:block}
.aov-leg{font-size:11px;color:var(--muted,#6b7280)}
.aov-asg-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.aov-asg-bar .input{min-width:150px;max-width:260px}
.aov-sortable{cursor:pointer;user-select:none}.aov-sel{background:rgba(99,102,241,.08)}.aov-asg-msg{margin:8px 0;font-size:13px}`;
  const chip = (ch, b, label, s, tone, foot) => `<button type="button" class="aov-chip ${tone || ''}" ${kp(ch, b)} title="Click — full list"><small>${label}</small><b>${fmt(s.n)}</b><i>${fmt(s.stock)} tags${foot ? ` · ${foot}` : ''}</i></button>`;
  function card(ch) {
    const s = stat(ch), who = ch === 'both' ? '🔗 GV + FF · Combined' : `${CH[ch].icon} ${CH[ch].label}`;
    if (!s.all.n) return `<div class="aov-card"><h3>${who}</h3><p class="dim">No agent with stock found.</p></div>`;
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const bar = `<div class="aov-bar" title="Stock split"><span style="width:${pct(s.active.stock, s.all.stock)}%;background:#10b981"></span><span style="width:${pct(s.in1.stock, s.all.stock)}%;background:#f59e0b"></span><span style="width:${pct(s.in2.stock, s.all.stock)}%;background:#ef4444"></span></div><div class="aov-leg">🟢 active ${pct(s.active.stock, s.all.stock)}% · 🟠 inactive this month ${pct(s.in1.stock, s.all.stock)}% · 🔴 inactive 2 months ${pct(s.in2.stock, s.all.stock)}% <b>of stock</b></div>`;
    const block = (p, name, nCh) => `<div class="aov-sec">${name}</div><div class="aov-chips">${chip(nCh, p ? 'direct' : 'managed', 'Total', p ? s.direct : s.managed)}${chip(nCh, p ? 'd.active' : 'm.active', '🟢 Active', s[p ? 'd.active' : 'm.active'], 'good')}${chip(nCh, p ? 'd.inactive' : 'm.inactive', '⚪ Inactive', s[p ? 'd.inactive' : 'm.inactive'], 'warn')}${chip(nCh, p ? 'd.in1' : 'm.in1', '🟠 Inactive · this month', s[p ? 'd.in1' : 'm.in1'], 'warn')}${chip(nCh, p ? 'd.in2' : 'm.in2', '🔴 Inactive · 2 months', s[p ? 'd.in2' : 'm.in2'], 'bad')}${chip(nCh, p ? 'd.deg' : 'm.deg', '🔻 De-growth', s[p ? 'd.deg' : 'm.deg'], 'warn')}</div>`;
    return `<div class="aov-card"><h3>${who}</h3><div class="aov-sub">${fmt(s.all.n)} agents hold ${fmt(s.all.stock)} tags · inactive agents hold <b>${fmt(s.inactive.stock)}</b> (${pct(s.inactive.stock, s.all.stock)}%)</div>
      <div class="aov-leg" style="margin:-4px 0 6px">📦 Stock by class: ${classLine(forCh(ch))}<br>⚪ Inactive agents' stock: ${classLine(forCh(ch).filter(BUCKETS.inactive))}</div>
      <div class="aov-chips">${chip(ch, 'all', '📦 Agents with stock', s.all)}${chip(ch, 'direct', '🚫 Direct agents', s.direct)}${chip(ch, 'managed', '🧑‍💼 TL-managed agents', s.managed)}<button type="button" class="aov-chip" ${kp(ch, 'tls')}><small>🧑‍💼 TLs</small><b>${fmt(s.tls.n)}</b><i>${s.tls.n ? `${s.perTl.toFixed(1)} agents / TL` : '—'}</i></button></div>
      <div class="aov-chips">${chip(ch, 'active', '🟢 Active agents', s.active, 'good')}${chip(ch, 'inactive', '⚪ Inactive agents', s.inactive, 'warn')}${chip(ch, 'in1', '🟠 Inactive · this month', s.in1, 'warn')}${chip(ch, 'in2', '🔴 Inactive · 2 months', s.in2, 'bad')}${chip(ch, 'deg', '🔻 De-growth', s.deg, 'warn')}</div>${bar}
      ${block(true, '🚫 Direct agents', ch)}${block(false, '🧑‍💼 TL-managed agents', ch)}</div>`;
  }
  function tlTable() {
    const rows = tlGroups(state.tab).filter((g) => !state.q || `${g.name} ${g.id}`.toLowerCase().includes(state.q));
    if (!rows.length) return '<p class="dim">No TL found.</p>';
    return `<div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Ch</th><th>TL</th><th class="num">Agents</th><th class="num">Active</th><th class="num">Inactive</th><th class="num">Stock</th><th class="num">Stock · inactive</th><th class="num">Issued MTD</th></tr></thead><tbody>${rows.map((g) => `<tr class="clickable" data-q="${esc(g.name)}"><td>${g.ch === 'gv' ? '🟩' : '🟦'}</td><td><b>${esc(g.name)}</b> <small class="dim">${esc(g.id || '')}</small></td><td class="num">${fmt(g.agents)}</td><td class="num">${fmt(g.active)}</td><td class="num">${fmt(g.inactive)}</td><td class="num"><b>${fmt(g.stock)}</b></td><td class="num">${fmt(g.inactiveStock)}</td><td class="num">${fmt(g.cur)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function csv() {
    const rows = forCh(state.tab).slice().sort((a, b) => a.ch.localeCompare(b.ch) || b.stock - a.stock);
    U.downloadCsv(`gv-ff-agents-summary-${U.stamp()}.csv`, ['Channel', 'Agent', 'Agent ID', 'Type', 'TL', 'TL ID', 'Status', 'Stock', ...CLASSES.map((c) => `Stock ${clsLabel(c)}`), 'Issued this month', 'Issued last month', 'Last active'],
      rows.map((r) => [CH[r.ch].label, r.name, r.id, r.direct ? 'Direct' : 'TL-managed', r.direct ? '' : r.tlName, r.direct ? '' : r.tlId, ST_LBL[r.status].replace(/^\S+\s/, ''), r.stock, ...CLASSES.map((c) => (r.cls && r.cls[c]) || 0), r.cur, r.last, r.lastActive || '']));
  }
  function paint(root) {
    const tabBtn = (v, t) => `<button class="btn small ${state.tab === v ? 'primary' : ''}" data-aov-tab="${v}">${t}</button>`;
    const chans = state.tab === 'both' ? ['ff', 'gv'] : [state.tab];
    root.innerHTML = `<div class="aov-wrap"><style>${CSS}</style>
      <div class="page-head"><div><h1>🧮 GV &amp; FF Agents Summary</h1><p class="sub">Agents holding stock — direct vs TL-managed, active vs inactive. <b>Click any number</b> for the full agent list (profile · CSV).</p></div>
        <div class="head-actions"><button class="btn small" id="aov-refresh">↻ Refresh</button>${FF.auth && FF.auth.can('export') ? '<button class="btn small" id="aov-csv">⬇ CSV</button>' : ''}</div></div>
      <div class="aov-tabs">${tabBtn('both', '🔗 Both')}${tabBtn('ff', '🟦 First Forward')}${tabBtn('gv', '🟩 GV Partner')}</div>
      ${state.tab === 'both' ? `<div class="aov-grid" style="margin-bottom:14px">${card('both')}</div>` : ''}
      <div class="aov-grid">${chans.map(card).join('')}</div>
      <section class="card" style="margin-top:14px"><div class="card-head"><h3>📋 Agent follow-up list</h3></div><div class="card-body" id="aov-follow-body">${followHtml()}</div></section>
      <section class="card" style="margin-top:14px"><div class="card-head"><h3>🧑‍💼 TLs holding stock</h3><div class="card-right"><input class="input" id="aov-q" placeholder="Search TL…" value="${esc(state.q)}"></div></div><div class="card-body" id="aov-tls">${tlTable()}</div></section>
      ${isAdmin() ? `<section class="card" id="aov-asg" style="margin-top:14px"><div class="card-head"><h3>📌 Assign work to a team link</h3></div><div class="card-body"><p class="dim small" style="margin:0 0 8px">Pick agents (inactive this month, inactive 2 months, de-growth…) and assign them to a team link. They show on that link under <b>Assigned work by RSM</b>, where the team sets a target (count or Active). Totals appear on your Home page.</p><div id="aov-asg-body">${U.spinner('Loading team links…')}</div></div></section>` : ''}
      <p class="dim small">Active = issued ≥ 1 tag this month · Inactive this month = issued last month but not this month · Inactive 2 months = nothing issued last month or this month · De-growth = issuing, but this month's run-rate projects below last month. Only agents with stock &gt; 0 are counted (office holders “APNA PAYMENT” and “Not Assigned” are excluded). Class split: VC4/20 (VC20 is the commercial class of VC4) · VC5 · VC6 · VC7 · VC12 · VC16. Direct agent rule = Settings → Direct Agents.</p></div>`;
    root.querySelectorAll('[data-aov-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.aovTab; paint(root); }));
    const rf = root.querySelector('#aov-refresh'); if (rf) rf.addEventListener('click', () => { root.innerHTML = U.spinner('Refreshing…'); load(true).then(() => { paint(root); loadFollowAge(root); }).catch((err) => { root.innerHTML = U.errorBox(err); }); });
    const cv = root.querySelector('#aov-csv'); if (cv) cv.addEventListener('click', csv);
    const q = root.querySelector('#aov-q'); if (q) q.addEventListener('input', () => { state.q = q.value.trim().toLowerCase(); const t = root.querySelector('#aov-tls'); if (t) t.innerHTML = tlTable(); });
    if (isAdmin()) { bindAsg(root); loadLinks(false).then(() => paintAsg(root)).catch((err) => { const el = root.querySelector('#aov-asg-body'); if (el) el.innerHTML = `<p class="dim">Could not load team links: ${esc((err && err.message) || err)}</p>`; }); }
    if (!root.__aovClick) root.__aovClick = true; else return;
    root.addEventListener('click', (ev) => {
      const tr = ev.target.closest && ev.target.closest('#aov-tls tr[data-q]'); if (tr) location.hash = `#/masterSearch?q=${encodeURIComponent(tr.dataset.q)}`;
      if (ev.target.closest('[data-fu-more]')) { follow.limit += 200; paintFollow(root); }
      if (ev.target.closest('[data-fu-csv]') && FF.auth.can('export')) followCsv();
    });
    root.addEventListener('change', (ev) => { if (ev.target.matches('[data-fu-reason]')) follow.reason = ev.target.value; else if (ev.target.matches('[data-fu-low]')) follow.low = Number(ev.target.value); else return; follow.limit = 100; paintFollow(root); });
    root.addEventListener('input', (ev) => { if (ev.target.matches('[data-fu-q]')) { const pos = ev.target.selectionStart; follow.q = ev.target.value.trim().toLowerCase(); follow.limit = 100; paintFollow(root); const el = root.querySelector('[data-fu-q]'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } } });
  }

  // ---- 📌 Assign work to a team link (admin) -----------------------------------------------------------
  const isAdmin = () => { try { return !!(FF.auth && FF.auth.user && FF.auth.user.role === 'admin'); } catch { return false; } };
  const asg = { links: [], at: 0, busy: false, sel: new Set(), ch: 'both', f: 'in1', type: 'all', q: '', sort: { k: 'stock', d: -1 }, limit: 100, linkId: '', msg: '' };
  const rowKey = (r) => `${r.ch}|${keyOf(r.name)}`;
  const ASG_FILTERS = [['in1', '🟠 Inactive · this month'], ['in2', '🔴 Inactive · 2 months'], ['deg', '🔻 De-growth'], ['inactive', '⚪ All inactive'], ['active', '🟢 Active'], ['all', '📦 All with stock']];
  const bucketLabel = (r) => (r.status === 'in1' ? 'Inactive · this month' : r.status === 'in2' ? 'Inactive · 2 months' : r.deg ? 'De-growth' : 'Assigned');
  async function loadLinks(force) {
    if (!force && asg.links.length && Date.now() - asg.at < 60000) return asg.links;
    const d = await FF.auth.api('/api/personal-links');
    asg.links = ((d && d.links) || []).filter((l) => l && (l.kind === 'tl' || l.kind === 'group') && l.enabled !== false);
    asg.at = Date.now();
    if (!asg.links.some((l) => l.id === asg.linkId)) asg.linkId = '';
    return asg.links;
  }
  const assignedMap = () => { const m = new Map(); asg.links.forEach((l) => (l.assigned || []).forEach((a) => m.set(`${a.src === 'gv' ? 'gv' : 'ff'}|${keyOf(a.name)}`, l))); return m; };
  const linkLabel = (l) => `${l.name} · ${l.kind === 'tl' ? 'TL' : 'Team'} · ${l.source === 'gv' ? 'GV' : l.source === 'ff' ? 'FF' : 'GV+FF'}`;
  function asgRows() {
    const q = asg.q.trim().toLowerCase(), amap = assignedMap();
    const list = forCh(asg.ch).filter(BUCKETS[asg.f] || BUCKETS.all).filter((r) => asg.type === 'all' || (asg.type === 'direct' ? r.direct : !r.direct))
      .filter((r) => !q || `${r.name} ${r.id} ${r.tlName}`.toLowerCase().includes(q));
    const val = (r) => { const k = asg.sort.k; if (k === 'name') return r.name.toLowerCase(); if (k === 'tl') return (r.direct ? 'direct' : r.tlName || '').toLowerCase(); if (k === 'status') return r.status === 'active' ? 2 : r.status === 'in1' ? 1 : 0; if (k === 'to') return ((amap.get(rowKey(r)) || {}).name || '').toLowerCase(); if (k.startsWith('c:')) return (r.cls && r.cls[k.slice(2)]) || 0; return r[k] || 0; };
    list.sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return (c * asg.sort.d) || (b.stock - a.stock); });
    return { list, amap };
  }
  function asgHtml() {
    const { list, amap } = asgRows();
    const shown = list.slice(0, asg.limit), selN = asg.sel.size;
    const th = (k, label, cls) => `<th class="${cls || ''} aov-sortable" data-asg-sort="${k}">${label}${asg.sort.k === k ? (asg.sort.d > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    const opts = (arr, cur) => arr.map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`).join('');
    const linkOpts = `<option value="">Select a team link…</option>${asg.links.map((l) => `<option value="${esc(l.id)}" ${l.id === asg.linkId ? 'selected' : ''}>${esc(linkLabel(l))}${(l.assigned || []).length ? ` (${(l.assigned || []).length} assigned)` : ''}</option>`).join('')}`;
    const allOn = list.length > 0 && list.every((r) => asg.sel.has(rowKey(r)));
    const body = shown.map((r) => { const k = rowKey(r), to = amap.get(k); return `<tr class="${asg.sel.has(k) ? 'aov-sel' : ''}"><td><input type="checkbox" data-asg-row="${esc(k)}" ${asg.sel.has(k) ? 'checked' : ''}></td><td>${r.ch === 'gv' ? '🟩' : '🟦'} <b>${esc(r.name)}</b> <small class="dim">${esc(r.id || '')}</small></td><td>${esc(r.direct ? 'Direct' : r.tlName || '—')}</td><td>${ST_LBL[r.status]}${r.deg ? ' · 🔻 De-growth' : ''}</td><td class="num"><b>${fmt(r.stock)}</b></td>${CLASSES.map((c) => `<td class="num">${fmt((r.cls && r.cls[c]) || 0)}</td>`).join('')}<td class="num">${fmt(r.last)}</td><td class="num">${fmt(r.cur)}</td><td>${to ? `📌 ${esc(to.name)}` : '<span class="dim">—</span>'}</td></tr>`; }).join('');
    return `<div class="aov-asg-bar">
        <select class="input" data-asg-ch>${opts([['both', '🔗 GV + FF'], ['ff', '🟦 First Forward'], ['gv', '🟩 GV Partner']], asg.ch)}</select>
        <select class="input" data-asg-f>${opts(ASG_FILTERS, asg.f)}</select>
        <select class="input" data-asg-type>${opts([['all', 'Direct + TL-managed'], ['direct', '🚫 Direct only'], ['managed', '🧑‍💼 TL-managed only']], asg.type)}</select>
        <input class="input" data-asg-q placeholder="Search agent / ID / TL…" value="${esc(asg.q)}">
        <select class="input" data-asg-link>${linkOpts}</select>
        <button class="btn small primary" data-asg-go ${selN && asg.linkId ? '' : 'disabled'}>📌 Assign ${selN ? `(${selN})` : ''}</button>
        <button class="btn small" data-asg-selall ${list.length ? '' : 'disabled'}>☑ Select all ${fmt(list.length)}</button>
        <button class="btn small" data-asg-clear ${selN ? '' : 'disabled'}>Clear</button>
        <button class="btn small" data-asg-un ${selN ? '' : 'disabled'} title="Remove the selected agents from whichever link they are assigned to">Unassign</button>
      </div>
      ${asg.msg ? `<p class="aov-asg-msg">${asg.msg}</p>` : ''}
      <div class="aov-leg" style="margin:6px 0">${fmt(list.length)} agents · ${fmt(sumStock(list))} tags in stock · ${fmt(selN)} selected</div>
      <div class="table-wrap tall"><table class="tbl compact"><thead><tr><th><input type="checkbox" data-asg-all ${allOn ? 'checked' : ''} title="Select all ${fmt(list.length)} matching agents"></th>${th('name', 'Agent')}${th('tl', 'TL')}${th('status', 'Status')}${th('stock', 'Stock', 'num')}${CLASSES.map((c) => th(`c:${c}`, clsLabel(c), 'num')).join('')}${th('last', 'Last month', 'num')}${th('cur', 'This month', 'num')}${th('to', 'Assigned to')}</tr></thead><tbody>${body || '<tr><td colspan="13" class="dim">No agents match.</td></tr>'}</tbody></table></div>
      ${list.length > shown.length ? `<div class="btn-row"><button class="btn small" data-asg-more>⬇ Show ${fmt(Math.min(200, list.length - shown.length))} more</button> <span class="dim small">showing ${fmt(shown.length)} of ${fmt(list.length)} — Select all covers all matching agents, not just the rows shown</span></div>` : ''}`;
  }
  function paintAsg(root) { const el = root.querySelector('#aov-asg-body'); if (el) el.innerHTML = asgHtml(); }
  async function doAssign(root, un) {
    const { list } = asgRows(), keys = asg.sel;
    const all = state.rows, byKey = new Map(all.map((r) => [rowKey(r), r]));
    const picked = [...keys].map((k) => byKey.get(k)).filter(Boolean);
    if (!picked.length) return;
    if (!un && !asg.linkId) return;
    const lim = asg.f === 'all' || asg.f === 'inactive' || asg.f === 'active' ? '' : (ASG_FILTERS.find((x) => x[0] === asg.f) || [])[1];
    const items = picked.map((r) => ({ src: r.ch, name: r.name, id: r.id, tl: r.direct ? '' : r.tlName, bucket: lim ? lim.replace(/^\S+\s/, '') : bucketLabel(r) }));
    asg.msg = 'Saving…'; paintAsg(root);
    try {
      if (un) {
        const amap = assignedMap(), byLink = new Map();
        picked.forEach((r) => { const l = amap.get(rowKey(r)); if (l) { (byLink.get(l.id) || byLink.set(l.id, []).get(l.id)).push({ src: r.ch, name: r.name }); } });
        for (const [id, rem] of byLink) await FF.auth.api(`/api/personal-links/${encodeURIComponent(id)}/assign`, 'POST', { remove: rem });
        asg.msg = `✅ Removed ${fmt(byLink.size ? picked.length : 0)} from their team link.`;
      } else {
        await FF.auth.api(`/api/personal-links/${encodeURIComponent(asg.linkId)}/assign`, 'POST', { add: items });
        const l = asg.links.find((x) => x.id === asg.linkId);
        asg.msg = `✅ ${fmt(items.length)} agents assigned to <b>${esc(l ? l.name : 'the team link')}</b> — they now see them under “Assigned work by RSM”.`;
      }
      asg.sel.clear();
      await loadLinks(true);
    } catch (err) { asg.msg = `⚠️ ${esc((err && err.message) || 'Could not save')}`; }
    paintAsg(root);
  }
  function bindAsg(root) {
    if (root.__asgBound) return; root.__asgBound = true;
    root.addEventListener('change', (e) => {
      const t = e.target; if (!t || !t.closest || !t.closest('#aov-asg')) return;
      if (t.matches('[data-asg-ch]')) { asg.ch = t.value; asg.sel.clear(); asg.limit = 100; }
      else if (t.matches('[data-asg-f]')) { asg.f = t.value; asg.sel.clear(); asg.limit = 100; }
      else if (t.matches('[data-asg-type]')) { asg.type = t.value; asg.sel.clear(); asg.limit = 100; }
      else if (t.matches('[data-asg-link]')) asg.linkId = t.value;
      else if (t.matches('[data-asg-row]')) { if (t.checked) asg.sel.add(t.getAttribute('data-asg-row')); else asg.sel.delete(t.getAttribute('data-asg-row')); }
      else if (t.matches('[data-asg-all]')) { const { list } = asgRows(); list.forEach((r) => { if (t.checked) asg.sel.add(rowKey(r)); else asg.sel.delete(rowKey(r)); }); }
      else return;
      asg.msg = ''; paintAsg(root);
    });
    root.addEventListener('input', (e) => { const t = e.target; if (t && t.matches && t.matches('[data-asg-q]')) { asg.q = t.value; asg.limit = 100; const pos = t.selectionStart; paintAsg(root); const n = root.querySelector('[data-asg-q]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ignore */ } } } });
    root.addEventListener('click', (e) => {
      const t = e.target; if (!t || !t.closest || !t.closest('#aov-asg')) return;
      const th = t.closest('[data-asg-sort]');
      if (th) { const k = th.getAttribute('data-asg-sort'); asg.sort = { k, d: asg.sort.k === k ? -asg.sort.d : (k === 'name' || k === 'tl' || k === 'to' ? 1 : -1) }; paintAsg(root); return; }
      if (t.closest('[data-asg-selall]')) { asgRows().list.forEach((r) => asg.sel.add(rowKey(r))); asg.msg = ''; paintAsg(root); return; }
      if (t.closest('[data-asg-clear]')) { asg.sel.clear(); asg.msg = ''; paintAsg(root); return; }
      if (t.closest('[data-asg-more]')) { asg.limit += 200; paintAsg(root); return; }
      if (t.closest('[data-asg-go]')) { doAssign(root, false); return; }
      if (t.closest('[data-asg-un]')) doAssign(root, true);
    });
  }
  async function render(root) {
    register();
    root.innerHTML = U.spinner('Building GV + FF agents summary…');
    try { await Promise.race([load(false), new Promise((_, rej) => setTimeout(() => rej(new Error('Data is still loading — sheets are being read. Try ↻ in a moment.')), 45000))]); }
    catch (err) { root.innerHTML = U.errorBox(err); return; }
    paint(root);
    loadFollowAge(root);
  }
  FF.agentsOverview = { load, stat, listFor, tlGroups, classify, clsLabel, followupRows, _state: state };
  FF.pages.agentsOverview = { title: 'GV & FF Agents Summary', render };
})(FF);
