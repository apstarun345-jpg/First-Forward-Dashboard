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
  const state = { rows: [], months: {}, tab: 'both', q: '', at: 0, busy: null };
  const keyOf = (v) => clean(v).toUpperCase().replace(/\.0+$/, '').replace(/\s+/g, ' ');
  const isDirect = (r, ch) => { try { return !!FF.config.isDirectAgent(r, ch); } catch { return false; } };
  const num = (v) => Number(v) || 0;
  const CLASSES = ['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16', 'VC20', 'Other'];
  const clsKey = (c) => { const m = /^\s*VC\s*0*(\d+)/i.exec(String(c || '')); const k = m ? `VC${m[1]}` : ''; return CLASSES.includes(k) ? k : 'Other'; };
  const clsMap = (rows) => { const m = new Map(); (rows || []).forEach((r) => { const n = num(r.n); if (!n) return; [keyOf(r.agentId), `N:${keyOf(r.agentName)}`].forEach((k) => { if (!k || k === 'N:') return; const o = m.get(k) || {}; const c = clsKey(r.cls); o[c] = (o[c] || 0) + n; m.set(k, o); }); }); return m; };
  const clsOf = (m, id, name) => { const o = m.get(keyOf(id)) || m.get(`N:${keyOf(name)}`) || {}; const out = {}; CLASSES.forEach((c) => { out[c] = o[c] || 0; }); return out; };
  const clsSum = (l) => { const t = {}; CLASSES.forEach((c) => { t[c] = l.reduce((s, r) => s + ((r.cls && r.cls[c]) || 0), 0); }); return t; };

  // Office / placeholder holders are not agents: GV "Not Assigned", FF "APNA PAYMENT" (company ID 5845036).
  const isOffice = (id, name) => /^\s*not\s*assigned\s*$/i.test(`${id}`) || /^\s*not\s*assigned\s*$/i.test(`${name}`) || /^\s*apna\s*payment(\s*pvt.*)?\s*$/i.test(`${name}`) || String(id).trim() === '5845036';
  // ---- data ---------------------------------------------------------------------------------------
  const classify = (r) => {
    r.type = r.direct ? 'direct' : 'managed';
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
        out.push(classify({ ch: 'ff', id: clean(a.agentId || a.id), name: clean(a.name || a.agentId), tlName: clean(a.tlName), tlId: clean(a.tlId), direct: isDirect(a, 'ff'), stock, vc4Stock: num(a.stockVc4), cls: clsOf(fm, a.agentId || a.id, a.name), cur: num(a.curTotal), last: num(a.lastTotal), lastActive: clean(a.lastActive).replace(/^[^\p{L}\d]+/u, '') }));
      });
    } catch { /* FF optional */ }
    return out;
  }
  const prevYm = (ym) => { const [y, m] = String(ym).split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  async function gvRows() {
    const out = [], G = FF.gv;
    if (!G) return out;
    try { await FF.store.need('daily'); } catch { /* optional */ }
    let stockRows = [], report = [], gm = new Map();
    try { gm = clsMap(await G.need('stockAgentClass')); } catch { /* class split optional */ }
    try { stockRows = (await G.need('stockAgent')) || []; } catch { /* optional */ }
    try { report = (await G.need('report')) || []; } catch { /* optional */ }
    const latest = G.latestDate && G.latestDate();
    const cur = latest ? U.ymKey(latest) : '', prev = cur ? prevYm(cur) : '';
    const iss = (ym) => { const m = new Map(); try { (ym ? G.agentRollup(ym) : []).forEach((a) => { const t = num(a.total); [a.agentId, a.agentName].forEach((v) => { const k = keyOf(v); if (k) m.set(k, Math.max(m.get(k) || 0, t)); }); }); } catch { /* ignore */ } return m; };
    const curM = iss(cur), lastM = iss(prev);
    const rep = new Map();
    report.forEach((r) => { [r.agentId, r.agentName].forEach((v) => { const k = keyOf(v); if (k && !rep.has(k)) rep.set(k, r); }); });
    const agg = new Map();
    stockRows.forEach((r) => {
      const id = clean(r.agentId), key = keyOf(id) || `N:${keyOf(r.agentName)}`;
      if (!key || key === 'N:') return;
      const o = agg.get(key) || { ch: 'gv', id, name: clean(r.agentName || id), tlName: '', tlId: '', direct: false, stock: 0, vc4Stock: 0, src: r };
      o.stock += num(r.n); if (!o.tlName) o.tlName = clean(r.tlName); if (!o.tlId) o.tlId = clean(r.tlId);
      o.direct = o.direct || r.directAgent === true || isDirect(r, 'gv');
      agg.set(key, o);
    });
    agg.forEach((o) => {
      if (o.stock <= 0) return;
      o.cls = clsOf(gm, o.id, o.name);
      if (isOffice(o.id, o.name)) return;
      const rp = rep.get(keyOf(o.id)) || rep.get(keyOf(o.name)) || {};
      const hasEir = curM.size > 0;
      o.cur = hasEir ? (curM.get(keyOf(o.id)) || curM.get(keyOf(o.name)) || 0) : num(rp.curTotal);
      o.last = hasEir ? (lastM.get(keyOf(o.id)) || lastM.get(keyOf(o.name)) || 0) : num(rp.lastTotal);
      o.vc4Stock = num(rp.stockVc4);
      o.lastActive = clean(rp.lastActive || '').replace(/^[^\p{L}\d]+/u, '');
      if (!o.direct && rp.agentId) o.direct = isDirect(rp, 'gv');
      delete o.src; out.push(classify(o));
    });
    return out;
  }
  async function load(force) {
    if (state.busy) return state.busy;
    if (!force && state.rows.length && Date.now() - state.at < 120000) return state.rows;
    state.busy = (async () => {
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
    active: (r) => r.status === 'active', inactive: (r) => r.status !== 'active', in1: (r) => r.status === 'in1', in2: (r) => r.status === 'in2',
    'd.active': (r) => r.direct && r.status === 'active', 'd.inactive': (r) => r.direct && r.status !== 'active', 'd.in1': (r) => r.direct && r.status === 'in1', 'd.in2': (r) => r.direct && r.status === 'in2',
    'm.active': (r) => !r.direct && r.status === 'active', 'm.inactive': (r) => !r.direct && r.status !== 'active', 'm.in1': (r) => !r.direct && r.status === 'in1', 'm.in2': (r) => !r.direct && r.status === 'in2'
  };
  const TITLES = {
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
      g.agents++; g.stock += r.stock; g.cur += r.cur;
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
      ['Stock', (r) => fmt(r.stock), 1], ...CLASSES.map((c) => [c, (r) => fmt((r.cls && r.cls[c]) || 0), 1]), ['This month', (r) => fmt(r.cur), 1], ['Last month', (r) => fmt(r.last), 1], ['Last active', (r) => e(r.lastActive || '—')]];
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
  const classLine = (l) => { const t = clsSum(l); return CLASSES.filter((c) => t[c]).map((c) => `${c} <b>${fmt(t[c])}</b>`).join(' · ') || '—'; };
  const kp = (ch, b) => `data-kpi="scope=list&list=aov.${ch}.${b}&src=${ch === 'both' ? 'both' : ch}"`;

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
.aov-leg{font-size:11px;color:var(--muted,#6b7280)}`;
  const chip = (ch, b, label, s, tone, foot) => `<button type="button" class="aov-chip ${tone || ''}" ${kp(ch, b)} title="Click — full list"><small>${label}</small><b>${fmt(s.n)}</b><i>${fmt(s.stock)} tags${foot ? ` · ${foot}` : ''}</i></button>`;
  function card(ch) {
    const s = stat(ch), who = ch === 'both' ? '🔗 GV + FF · Combined' : `${CH[ch].icon} ${CH[ch].label}`;
    if (!s.all.n) return `<div class="aov-card"><h3>${who}</h3><p class="dim">No agent with stock found.</p></div>`;
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const bar = `<div class="aov-bar" title="Stock split"><span style="width:${pct(s.active.stock, s.all.stock)}%;background:#10b981"></span><span style="width:${pct(s.in1.stock, s.all.stock)}%;background:#f59e0b"></span><span style="width:${pct(s.in2.stock, s.all.stock)}%;background:#ef4444"></span></div><div class="aov-leg">🟢 active ${pct(s.active.stock, s.all.stock)}% · 🟠 inactive this month ${pct(s.in1.stock, s.all.stock)}% · 🔴 inactive 2 months ${pct(s.in2.stock, s.all.stock)}% <b>of stock</b></div>`;
    const block = (p, name, nCh) => `<div class="aov-sec">${name}</div><div class="aov-chips">${chip(nCh, p ? 'direct' : 'managed', 'Total', p ? s.direct : s.managed)}${chip(nCh, p ? 'd.active' : 'm.active', '🟢 Active', s[p ? 'd.active' : 'm.active'], 'good')}${chip(nCh, p ? 'd.inactive' : 'm.inactive', '⚪ Inactive', s[p ? 'd.inactive' : 'm.inactive'], 'warn')}${chip(nCh, p ? 'd.in1' : 'm.in1', '🟠 Inactive · this month', s[p ? 'd.in1' : 'm.in1'], 'warn')}${chip(nCh, p ? 'd.in2' : 'm.in2', '🔴 Inactive · 2 months', s[p ? 'd.in2' : 'm.in2'], 'bad')}</div>`;
    return `<div class="aov-card"><h3>${who}</h3><div class="aov-sub">${fmt(s.all.n)} agents hold ${fmt(s.all.stock)} tags · inactive agents hold <b>${fmt(s.inactive.stock)}</b> (${pct(s.inactive.stock, s.all.stock)}%)</div>
      <div class="aov-leg" style="margin:-4px 0 6px">📦 Stock by class: ${classLine(forCh(ch))}<br>⚪ Inactive agents' stock: ${classLine(forCh(ch).filter(BUCKETS.inactive))}</div>
      <div class="aov-chips">${chip(ch, 'all', '📦 Agents with stock', s.all)}${chip(ch, 'direct', '🚫 Direct agents', s.direct)}${chip(ch, 'managed', '🧑‍💼 TL-managed agents', s.managed)}<button type="button" class="aov-chip" ${kp(ch, 'tls')}><small>🧑‍💼 TLs</small><b>${fmt(s.tls.n)}</b><i>${s.tls.n ? `${s.perTl.toFixed(1)} agents / TL` : '—'}</i></button></div>
      <div class="aov-chips">${chip(ch, 'active', '🟢 Active agents', s.active, 'good')}${chip(ch, 'inactive', '⚪ Inactive agents', s.inactive, 'warn')}${chip(ch, 'in1', '🟠 Inactive · this month', s.in1, 'warn')}${chip(ch, 'in2', '🔴 Inactive · 2 months', s.in2, 'bad')}</div>${bar}
      ${block(true, '🚫 Direct agents', ch)}${block(false, '🧑‍💼 TL-managed agents', ch)}</div>`;
  }
  function tlTable() {
    const rows = tlGroups(state.tab).filter((g) => !state.q || `${g.name} ${g.id}`.toLowerCase().includes(state.q));
    if (!rows.length) return '<p class="dim">No TL found.</p>';
    return `<div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Ch</th><th>TL</th><th class="num">Agents</th><th class="num">Active</th><th class="num">Inactive</th><th class="num">Stock</th><th class="num">Stock · inactive</th><th class="num">Issued MTD</th></tr></thead><tbody>${rows.map((g) => `<tr class="clickable" data-q="${esc(g.name)}"><td>${g.ch === 'gv' ? '🟩' : '🟦'}</td><td><b>${esc(g.name)}</b> <small class="dim">${esc(g.id || '')}</small></td><td class="num">${fmt(g.agents)}</td><td class="num">${fmt(g.active)}</td><td class="num">${fmt(g.inactive)}</td><td class="num"><b>${fmt(g.stock)}</b></td><td class="num">${fmt(g.inactiveStock)}</td><td class="num">${fmt(g.cur)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function csv() {
    const rows = forCh(state.tab).slice().sort((a, b) => a.ch.localeCompare(b.ch) || b.stock - a.stock);
    U.downloadCsv(`gv-ff-agents-summary-${U.stamp()}.csv`, ['Channel', 'Agent', 'Agent ID', 'Type', 'TL', 'TL ID', 'Status', 'Stock', ...CLASSES.map((c) => `Stock ${c}`), 'Issued this month', 'Issued last month', 'Last active'],
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
      <section class="card" style="margin-top:14px"><div class="card-head"><h3>🧑‍💼 TLs holding stock</h3><div class="card-right"><input class="input" id="aov-q" placeholder="Search TL…" value="${esc(state.q)}"></div></div><div class="card-body" id="aov-tls">${tlTable()}</div></section>
      <p class="dim small">Active = issued ≥ 1 tag this month · Inactive this month = issued last month but not this month · Inactive 2 months = nothing issued last month or this month. Only agents with stock &gt; 0 are counted (office holders “APNA PAYMENT” and “Not Assigned” are excluded). Class split: VC4 · VC5 · VC6 · VC7 · VC12 · VC16 · VC20 · Other. Direct agent rule = Settings → Direct Agents.</p></div>`;
    root.querySelectorAll('[data-aov-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.aovTab; paint(root); }));
    const rf = root.querySelector('#aov-refresh'); if (rf) rf.addEventListener('click', () => { root.innerHTML = U.spinner('Refreshing…'); load(true).then(() => paint(root)).catch((err) => { root.innerHTML = U.errorBox(err); }); });
    const cv = root.querySelector('#aov-csv'); if (cv) cv.addEventListener('click', csv);
    const q = root.querySelector('#aov-q'); if (q) q.addEventListener('input', () => { state.q = q.value.trim().toLowerCase(); const t = root.querySelector('#aov-tls'); if (t) t.innerHTML = tlTable(); });
    if (!root.__aovClick) root.__aovClick = true; else return;
    root.addEventListener('click', (ev) => { const tr = ev.target.closest && ev.target.closest('#aov-tls tr[data-q]'); if (tr) location.hash = `#/masterSearch?q=${encodeURIComponent(tr.dataset.q)}`; });
  }
  async function render(root) {
    register();
    root.innerHTML = U.spinner('Building GV + FF agents summary…');
    try { await Promise.race([load(false), new Promise((_, rej) => setTimeout(() => rej(new Error('Data is still loading — sheets are being read. Try ↻ in a moment.')), 45000))]); }
    catch (err) { root.innerHTML = U.errorBox(err); return; }
    paint(root);
  }
  FF.agentsOverview = { load, stat, listFor, tlGroups, classify, _state: state };
  FF.pages.agentsOverview = { title: 'GV & FF Agents Summary', render };
})(FF);
