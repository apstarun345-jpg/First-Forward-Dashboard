/* 🛰️ GV API Report (v3.125.264) — GV ki direct API se date-range data: filters, multi-search (VRN / tag / barcode),
   agent · TL · day · class-wise summary aur commission lookup. Admin only. Data: /api/gv-api-report */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const CLS = ['VC4', 'VC20', 'VC5+'];
  const PAGE = 200;
  const today = () => U.dateKey(new Date());
  const st = { from: '', to: '', rows: [], meta: null, loading: false, tab: 'summary', sort: {}, shown: PAGE, box: '',
    f: { agent: '', agentId: '', tl: '', tlId: '', cls: '', status: '', cstatus: '', vrn: '', multi: '', cid: '' }, loadedAt: 0 };

  const CSS = `
  .gar-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
  .gar-chip{padding:9px 14px;border-radius:14px;color:#fff;font-size:12px;font-weight:700;min-width:118px;box-shadow:0 8px 18px -12px rgba(15,23,42,.5)}
  .gar-chip{cursor:pointer;transition:transform .12s,box-shadow .12s;border:0;text-align:left;font-family:inherit}
  .gar-chip:hover{transform:translateY(-2px);box-shadow:0 12px 22px -12px rgba(15,23,42,.65)}
  .gar-chip.on{outline:3px solid #facc15;outline-offset:2px}
  .gar-chip.c9{background:linear-gradient(135deg,#b45309,#f97316)}.gar-chip.c10{background:linear-gradient(135deg,#be123c,#e11d48)}
  .gar-boxbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0;padding:9px 12px;border-radius:12px;background:linear-gradient(135deg,#eef2ff,#fdf4ff);color:#312e81;font-size:13px;border:1px solid #c7d2fe}
  .gar-boxbar b{font-weight:800}
  .gar-chip b{display:block;font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}
  .gar-chip small{display:block;font-weight:600;opacity:.9;font-size:11px}
  .gar-chip.c1{background:linear-gradient(135deg,#4f46e5,#6366f1)}.gar-chip.c2{background:linear-gradient(135deg,#7c3aed,#a855f7)}
  .gar-chip.c3{background:linear-gradient(135deg,#ea580c,#f59e0b)}.gar-chip.c4{background:linear-gradient(135deg,#059669,#10b981)}
  .gar-chip.c5{background:linear-gradient(135deg,#0284c7,#38bdf8)}.gar-chip.c6{background:linear-gradient(135deg,#e11d48,#fb7185)}
  .gar-chip.c7{background:linear-gradient(135deg,#0f766e,#14b8a6)}.gar-chip.c8{background:linear-gradient(135deg,#475569,#64748b)}
  .gar-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:0 0 10px}
  .gar-filters .input,.gar-filters select{width:100%}
  .gar-lbl{font-size:11px;font-weight:700;opacity:.7;margin:0 0 2px;display:block}
  .gar-multi{width:100%;min-height:74px;font-family:ui-monospace,monospace;font-size:12px}
  .gar-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
  .gar-tabs button{border:0;border-radius:999px;padding:7px 14px;font:inherit;font-weight:700;font-size:12.5px;cursor:pointer;background:rgba(100,116,139,.16);color:inherit}
  .gar-tabs button.on{background:#4f46e5;color:#fff}
  .gar-wrap{overflow:auto;border-radius:12px;border:1px solid rgba(148,163,184,.3);max-height:68vh}
  table.gar{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px}
  table.gar th,table.gar td{padding:7px 9px;white-space:nowrap;border-bottom:1px solid rgba(148,163,184,.2)}
  table.gar thead th{position:sticky;top:0;z-index:2;background:#4338ca;color:#fff;font-weight:700;text-align:left;cursor:pointer;user-select:none}
  table.gar td.n{text-align:right;font-variant-numeric:tabular-nums}
  table.gar tfoot td{position:sticky;bottom:0;background:#eef2ff;font-weight:800}
  table.gar tbody tr:hover td{background:rgba(99,102,241,.07)}
  .gar-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-weight:700;font-size:11.5px;background:#e0e7ff;color:#3730a3}
  .gar-pill.g{background:#dcfce7;color:#15803d}.gar-pill.r{background:#fee2e2;color:#b91c1c}.gar-pill.a{background:#ffedd5;color:#c2410c}
  .gar-note{margin:8px 0;padding:8px 12px;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:12.5px}
  .gar-nf{margin:8px 0;padding:8px 12px;border-radius:10px;background:#fef2f2;color:#991b1b;font-size:12.5px;word-break:break-all}
  .gar-ok{margin:8px 0;padding:8px 12px;border-radius:10px;background:#f0fdf4;color:#166534;font-size:12.5px}
  `;
  function css() { if (document.getElementById('gar-css')) return; const s = document.createElement('style'); s.id = 'gar-css'; s.textContent = CSS; document.head.appendChild(s); }

  const n0 = (v) => Math.round(Number(v) || 0).toLocaleString('en-IN');
  const money = (v) => (v == null ? '–' : '₹' + (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('en-IN'));
  const norm = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const has = (hay, needle) => !needle || String(hay || '').toLowerCase().includes(String(needle).trim().toLowerCase());
  const isRepl = (r) => /repl/i.test(r.status || '');
  // 📦 v3.125.264 — har colourful box clickable: box → filtered records (ya agent / day table) + CSV / PDF
  const BOX = {
    total: { label: 'Total tags', pred: null },
    issuance: { label: 'Issuance', pred: (r) => !isRepl(r) },
    repl: { label: 'Replacement', pred: isRepl },
    VC4: { label: 'VC4', pred: (r) => r.cls === 'VC4' },
    VC20: { label: 'VC20', pred: (r) => r.cls === 'VC20' },
    'VC5+': { label: 'VC5+', pred: (r) => r.cls === 'VC5+' },
    comm: { label: 'Commission', pred: (r) => r.commission != null },
    amount: { label: 'Amount', pred: null },
    agents: { label: 'Agents', pred: null, tab: 'agents' },
    wrong: { label: 'Wrong VRN', pred: (r) => r.vrnSt === 'wrong' },
    chassis: { label: 'Chassis', pred: (r) => r.vrnSt === 'chassis' },
    avg: { label: 'Day-wise', pred: null, tab: 'days' }
  };
  const boxed = (list) => { const b = st.box && BOX[st.box]; return b && b.pred ? list.filter(b.pred) : list; };
  const TAB_LABEL = { summary: 'Total tags', agents: 'Agents', tls: 'TLs', days: 'Day-wise', hours: 'Hour-wise', comm: 'Commission', rec: 'Total tags' };
  // file name: "<agent / TL name> - <box>"
  function personLabel(list) {
    const uniq = (k) => [...new Set(list.map((r) => String(r[k] || '').trim()).filter(Boolean))];
    if (st.f.agent || st.f.agentId) { const n = uniq('agent'); if (n.length === 1) return n[0]; if (n.length) return `${n.length} agents`; return st.f.agent || st.f.agentId; }
    if (st.f.tl || st.f.tlId) { const n = uniq('supName'); if (n.length === 1) return n[0]; if (n.length) return `${n.length} TLs`; return st.f.tl || st.f.tlId; }
    if (st.f.cid) { const ids = String(st.f.cid).split(/[\s,;|]+/).filter(Boolean); if (ids.length === 1) { const r = list.find((x) => String(x.id) === ids[0]) || list.find((x) => String(x.supId) === ids[0]); if (r) return String(r.id) === ids[0] ? r.agent : r.supName; } }
    return 'All agents';
  }
  const fileBase = (list) => `${personLabel(list)} - ${st.box ? BOX[st.box].label : TAB_LABEL[st.tab] || st.tab}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

  // ---- filtering ----------------------------------------------------------------------------------
  let multiInfo = { tokens: [], found: new Set() };
  function filtered() {
    const f = st.f;
    const tokens = String(f.multi || '').split(/[\s,;|]+/).map((t) => norm(t)).filter(Boolean);
    const found = new Set();
    const vrnQ = norm(f.vrn);
    const out = st.rows.filter((r) => {
      if (!has(r.agent, f.agent) || !has(r.id, f.agentId) || !has(r.supName, f.tl) || !has(r.supId, f.tlId)) return false;
      if (f.cls && r.cls !== f.cls) return false;
      if (f.status && (f.status === '__repl' ? !isRepl(r) : f.status === '__iss' ? isRepl(r) : r.status !== f.status)) return false;
      if (f.cstatus && (r.cstatus || '—') !== f.cstatus) return false;
      if (vrnQ === 'WRONG' ? r.vrnSt !== 'wrong' : vrnQ === 'CHASSIS' ? r.vrnSt !== 'chassis' : false) return false;
      if (tokens.length) {
        const keys = [norm(r.vno), norm(r.tag), norm(r.sno), norm(r.id), norm(r.name)];
        let hit = false;
        for (const t of tokens) if (keys.some((k) => k && (k === t || (t.length >= 6 && k.includes(t))))) { hit = true; found.add(t); }
        if (!hit) return false;
      }
      return true;
    });
    multiInfo = { tokens: [...new Set(tokens)], found };
    return out;
  }

  // ---- aggregation --------------------------------------------------------------------------------
  const blank = () => ({ n: 0, repl: 0, amount: 0, comm: 0, commN: 0, VC4: 0, 'VC20': 0, 'VC5+': 0, paid: 0, pend: 0, wrong: 0, chassis: 0, last: '' });
  function bump(o, r) {
    o.n++; if (isRepl(r)) o.repl++; o.amount += r.amount || 0;
    if (r.commission != null) { o.comm += r.commission; o.commN++; }
    o[r.cls] = (o[r.cls] || 0) + 1;
    if (/paid|done|success|settled/i.test(r.cstatus || '') && !/un|not|pend/i.test(r.cstatus || '')) o.paid++; else if (r.cstatus) o.pend++;
    if (r.vrnSt === 'wrong') o.wrong++; if (r.vrnSt === 'chassis') o.chassis++;
    if (r.added > o.last) o.last = r.added;
  }
  function group(list, keyFn, labelFn) {
    const m = new Map();
    for (const r of list) { const k = keyFn(r); let o = m.get(k); if (!o) { o = { key: k, ...labelFn(r), ...blank() }; m.set(k, o); } bump(o, r); }
    return [...m.values()];
  }

  // ---- generic table ------------------------------------------------------------------------------
  function sorted(tab, cols, rows) {
    const s = st.sort[tab]; if (!s) return rows;
    const c = cols.find((x) => x.k === s.k); if (!c) return rows;
    const g = (r) => (c.v ? c.v(r) : r[c.k]);
    return rows.slice().sort((a, b) => { const x = g(a), y = g(b); const r = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)); return s.dir * r; });
  }
  function tableHtml(tab, cols, rows, opts) {
    opts = opts || {};
    const list = sorted(tab, cols, rows);
    const shown = list.slice(0, opts.limit || list.length);
    const arrow = (c) => (st.sort[tab] && st.sort[tab].k === c.k ? (st.sort[tab].dir > 0 ? ' ▲' : ' ▼') : '');
    const cell = (c, r) => { const v = c.v ? c.v(r) : r[c.k]; const t = c.f ? c.f(v, r) : (c.n ? n0(v) : esc(v == null ? '' : v)); return `<td class="${c.n ? 'n' : ''}">${t}</td>`; };
    const foot = opts.total ? `<tfoot><tr>${cols.map((c, i) => `<td class="${c.n ? 'n' : ''}">${i === 0 ? 'Total' : (c.tot ? (c.f ? c.f(c.tot(list), null) : n0(c.tot(list))) : '')}</td>`).join('')}</tr></tfoot>` : '';
    return `<div class="gar-wrap"><table class="gar"><thead><tr>${cols.map((c) => `<th data-gar-sort="${tab}|${c.k}">${esc(c.label)}${arrow(c)}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((r) => `<tr>${cols.map((c) => cell(c, r)).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="dim">Koi record nahi.</td></tr>`}</tbody>${foot}</table></div>
      ${list.length > shown.length ? `<div style="margin:8px 0"><button class="btn" data-gar="more">⬇ Aur dikhao (${shown.length}/${list.length})</button></div>` : `<p class="dim small">${n0(list.length)} rows</p>`}`;
  }
  const colsAgg = (first) => first.concat([
    { k: 'VC4', label: 'VC4', n: 1, tot: (l) => l.reduce((a, x) => a + x.VC4, 0) }, { k: 'VC20', label: 'VC20', n: 1, tot: (l) => l.reduce((a, x) => a + x.VC20, 0) }, { k: 'VC5+', label: 'VC5+', n: 1, tot: (l) => l.reduce((a, x) => a + x['VC5+'], 0) },
    { k: 'n', label: 'Total tags', n: 1, tot: (l) => l.reduce((a, x) => a + x.n, 0) },
    { k: 'repl', label: 'Replacement', n: 1, tot: (l) => l.reduce((a, x) => a + x.repl, 0) },
    { k: 'amount', label: 'Amount', n: 1, f: (v) => money(v), tot: (l) => l.reduce((a, x) => a + x.amount, 0) },
    { k: 'comm', label: 'Commission', n: 1, f: (v) => money(v), tot: (l) => l.reduce((a, x) => a + x.comm, 0) },
    { k: 'avg', label: 'Avg comm / tag', n: 1, v: (r) => (r.commN ? r.comm / r.commN : 0), f: (v) => money(v) },
    { k: 'wrong', label: 'Wrong VRN', n: 1, tot: (l) => l.reduce((a, x) => a + x.wrong, 0) },
    { k: 'chassis', label: 'Chassis', n: 1, tot: (l) => l.reduce((a, x) => a + x.chassis, 0) },
    { k: 'last', label: 'Last tag', v: (r) => String(r.last || '').slice(0, 16) }
  ]);

  // ---- tabs ---------------------------------------------------------------------------------------
  function viewSummary(list) {
    const t = blank(); list.forEach((r) => bump(t, r));
    const agents = new Set(list.map((r) => r.id)), tls = new Set(list.map((r) => r.supId).filter(Boolean));
    const dayN = new Set(list.map((r) => r.day)).size || 1;
    const sub = (pred) => { const o = blank(); list.filter(pred).forEach((r) => bump(o, r)); return o; };
    const chip = (key, cc, label, val, smalls) => `<button type="button" class="gar-chip ${cc}${st.box === key ? ' on' : ''}" data-gar-box="${esc(key)}" title="Click → ${esc(label)} records">${esc(label)}<b>${val}</b>${(smalls || []).map((x) => `<small>${x}</small>`).join('')}</button>`;
    const iss = sub(BOX.issuance.pred), rp = sub(isRepl), wr = sub(BOX.wrong.pred), ch = sub(BOX.chassis.pred);
    const chips = `<div class="gar-chips">
      ${chip('total', 'c1', 'Total tags', n0(t.n), [`${n0(t.n - t.repl)} issuance · ${n0(t.repl)} replacement`])}
      ${chip('issuance', 'c4', 'Issuance', n0(iss.n), [`💸 ${money(iss.comm)}`])}
      ${chip('repl', 'c9', 'Replacement', n0(rp.n), [`💸 ${money(rp.comm)}`])}
      ${[['VC4', 'c2'], ['VC20', 'c3'], ['VC5+', 'c5']].map(([c, cc]) => { const o = sub((r) => r.cls === c); return chip(c, cc, c, n0(o.n), [`💸 ${money(o.comm)} commission`, `avg ${money(o.commN ? o.comm / o.commN : 0)} / tag`]); }).join('')}
      ${chip('comm', 'c4', 'Commission', money(t.comm), [`avg ${money(t.commN ? t.comm / t.commN : 0)} / tag`])}
      ${chip('amount', 'c7', 'Amount', money(t.amount), [])}
      ${chip('agents', 'c8', 'Agents · TLs', n0(agents.size), [`${n0(tls.size)} TLs`])}
      ${chip('wrong', 'c6', 'Wrong VRN', n0(wr.n), [`VC4 ${n0(wr.VC4)} · VC20 ${n0(wr.VC20)} · VC5+ ${n0(wr['VC5+'])}`])}
      ${chip('chassis', 'c10', 'Chassis', n0(ch.n), [`VC4 ${n0(ch.VC4)} · VC20 ${n0(ch.VC20)} · VC5+ ${n0(ch['VC5+'])}`])}
      ${chip('avg', 'c1', 'Avg / day', n0(t.n / dayN), [`${dayN} din`])}</div>
      <p class="dim small" style="margin:-4px 0 10px">👆 Kisi bhi box par click karo → wahi records khulenge (CSV / PDF download ke saath).</p>`;
    const cls = group(list, (r) => r.cls, (r) => ({ cls: r.cls }));
    const stat = group(list, (r) => r.status || '—', (r) => ({ status: r.status || '—' }));
    const cst = group(list, (r) => r.cstatus || '—', (r) => ({ cstatus: r.cstatus || '—' }));
    const mini = (tab, key, label, rows) => tableHtml(tab, [{ k: key, label }, { k: 'n', label: 'Tags', n: 1, tot: (l) => l.reduce((a, x) => a + x.n, 0) }, { k: 'amount', label: 'Amount', n: 1, f: money, tot: (l) => l.reduce((a, x) => a + x.amount, 0) }, { k: 'comm', label: 'Commission', n: 1, f: money, tot: (l) => l.reduce((a, x) => a + x.comm, 0) }], rows, { total: true });
    return `${chips}<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px"><div><h4>Class-wise</h4>${mini('s-cls', 'cls', 'Class', cls)}</div><div><h4>Status-wise</h4>${mini('s-st', 'status', 'Status', stat)}</div><div><h4>Commission status</h4>${mini('s-cs', 'cstatus', 'Commission status', cst)}</div></div>`;
  }
  const agentCols = () => colsAgg([{ k: 'id', label: 'Agent ID' }, { k: 'agent', label: 'Agent name' }, { k: 'supName', label: 'TL name' }, { k: 'supId', label: 'TL ID' }]);
  const tlCols = () => colsAgg([{ k: 'supId', label: 'TL ID' }, { k: 'supName', label: 'TL name' }, { k: 'agents', label: 'Agents', n: 1 }]);
  const dayCols = () => colsAgg([{ k: 'day', label: 'Date' }]);
  const recCols = () => [
    { k: 'added', label: 'Date · time' }, { k: 'id', label: 'Agent ID' }, { k: 'agent', label: 'Agent' }, { k: 'supId', label: 'TL ID' }, { k: 'supName', label: 'TL' },
    { k: 'cls', label: 'Class', f: (v) => `<span class="gar-pill">${esc(v)}</span>` }, { k: 'vclass', label: 'V class' }, { k: 'cch', label: 'CCH' },
    { k: 'vno', label: 'VRN', f: (v, r) => `${esc(v)}${r && r.vrnSt === 'wrong' ? ' <span class="gar-pill r">wrong</span>' : r && r.vrnSt === 'chassis' ? ' <span class="gar-pill a">chassis</span>' : ''}` },
    { k: 'tag', label: 'Tag ID' }, { k: 'sno', label: 'Barcode / SNO' }, { k: 'name', label: 'Customer' }, { k: 'product', label: 'Product' },
    { k: 'amount', label: 'Amount', n: 1, f: money }, { k: 'commission', label: 'Commission', n: 1, f: (v) => (v == null ? '–' : money(v)) },
    { k: 'status', label: 'Status' }, { k: 'cstatus', label: 'Comm. status' }, { k: 'extra', label: 'Other fields', v: (r) => (r.ex ? JSON.stringify(r.ex) : '') }
  ];
  function viewAgents(list) { return tableHtml('agents', agentCols(), group(list, (r) => r.id, (r) => ({ id: r.id, agent: r.agent, supName: r.supName, supId: r.supId })), { total: true, limit: st.shown }); }
  function viewTls(list) {
    const rows = group(list, (r) => r.supId || r.supName || 'Direct', (r) => ({ supId: r.supId, supName: r.supName || 'Direct' }));
    rows.forEach((o) => { o.agents = new Set(list.filter((r) => (r.supId || r.supName || 'Direct') === o.key).map((r) => r.id)).size; });
    return tableHtml('tls', tlCols(), rows, { total: true, limit: st.shown });
  }
  function viewHours(list) {
    const rows = group(list.filter((r) => r.time), (r) => r.time.slice(0, 2), (r) => ({ hr: r.time.slice(0, 2) })).sort((a, b) => (a.hr < b.hr ? -1 : 1));
    const max = Math.max(1, ...rows.map((r) => r.n));
    rows.forEach((r) => { r.slot = `${r.hr}:00 – ${r.hr}:59`; });
    return `<p class="dim small">Ghante-wise tags (date_added time se, IST) — 00:00:00 se 23:59:59.</p>` + tableHtml('hours', [
      { k: 'slot', label: 'Ghanta', v: (r) => r.hr, f: (v, r) => (r ? esc(r.slot) : '') },
      { k: 'bar', label: '', v: (r) => r.n, f: (v, r) => (r ? `<div style="min-width:160px;background:#e0e7ff;border-radius:6px"><div style="width:${Math.round(r.n / max * 100)}%;background:linear-gradient(90deg,#4f46e5,#a855f7);height:10px;border-radius:6px"></div></div>` : '') },
      { k: 'VC4', label: 'VC4', n: 1 }, { k: 'VC20', label: 'VC20', n: 1 }, { k: 'VC5+', label: 'VC5+', n: 1 },
      { k: 'n', label: 'Total', n: 1, tot: (l) => l.reduce((a, x) => a + x.n, 0) }, { k: 'repl', label: 'Replacement', n: 1 }, { k: 'comm', label: 'Commission', n: 1, f: money, tot: (l) => l.reduce((a, x) => a + x.comm, 0) }
    ], rows, { total: true });
  }
  function viewDays(list) { const rows = group(list, (r) => r.day, (r) => ({ day: r.day })).sort((a, b) => (a.day < b.day ? 1 : -1)); return tableHtml('days', dayCols(), rows, { total: true }); }
  function viewRecords(list) { return tableHtml('rec', recCols(), list, { limit: st.shown }); }
  // 💸 commission: ID daalo → class-wise kitna commission gaya
  const commCols = () => [
    { k: 'id', label: 'Agent ID' }, { k: 'agent', label: 'Agent' }, { k: 'supName', label: 'TL' }, { k: 'cls', label: 'Class', f: (v) => `<span class="gar-pill">${esc(v)}</span>` },
    { k: 'n', label: 'Tags', n: 1, tot: (l) => l.reduce((a, x) => a + x.n, 0) }, { k: 'comm', label: 'Total commission', n: 1, f: money, tot: (l) => l.reduce((a, x) => a + x.comm, 0) },
    { k: 'per', label: 'Per-tag commission', v: (r) => r.perTxt }, { k: 'min', label: 'Min', n: 1, f: (v) => (v == null ? '–' : money(v)) }, { k: 'max', label: 'Max', n: 1, f: (v) => (v == null ? '–' : money(v)) },
    { k: 'paid', label: 'Paid', n: 1 }, { k: 'pend', label: 'Pending/other', n: 1 }, { k: 'noComm', label: 'Commission blank', n: 1 }
  ];
  function commRows(list) {
    const ids = String(st.f.cid || '').split(/[\s,;|]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const src = ids.length ? list.filter((r) => ids.includes(String(r.id).toLowerCase()) || ids.includes(String(r.supId).toLowerCase())) : list;
    const rows = group(src, (r) => r.id + '|' + r.cls, (r) => ({ id: r.id, agent: r.agent, supName: r.supName, cls: r.cls }));
    rows.forEach((o) => {
      const vals = src.filter((r) => r.id === o.id && r.cls === o.cls && r.commission != null).map((r) => r.commission);
      const cnt = new Map(); vals.forEach((v) => cnt.set(v, (cnt.get(v) || 0) + 1));
      o.perTxt = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, c]) => `${money(v)} ×${c}`).join(' · ') || '–';
      o.min = vals.length ? Math.min(...vals) : null; o.max = vals.length ? Math.max(...vals) : null; o.noComm = o.n - vals.length;
    });
    return { rows: rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : CLS.indexOf(a.cls) - CLS.indexOf(b.cls))), src };
  }
  function viewComm(list) {
    const { rows, src } = commRows(list);
    const byCls = group(src, (r) => r.cls, (r) => ({ cls: r.cls }));
    return `<div class="gar-bar" style="margin:0 0 10px"><label class="gar-lbl">Agent ID / TL ID (multiple — space ya comma)</label>
      <input class="input" id="gar-cid" placeholder="jaise: 5845036 ya agent IDs…" value="${esc(st.f.cid)}" style="max-width:420px"></div>
      <h4>Class-wise commission ${st.f.cid ? '(selected IDs)' : '(filtered sab)'}</h4>
      ${tableHtml('c-cls', [{ k: 'cls', label: 'Class' }, { k: 'n', label: 'Tags', n: 1, tot: (l) => l.reduce((a, x) => a + x.n, 0) }, { k: 'comm', label: 'Total commission', n: 1, f: money, tot: (l) => l.reduce((a, x) => a + x.comm, 0) }, { k: 'avg', label: 'Avg / tag', n: 1, v: (r) => (r.commN ? r.comm / r.commN : 0), f: money }], byCls, { total: true })}
      <h4 style="margin-top:14px">Agent × class</h4>${tableHtml('c-ag', commCols(), rows, { total: true, limit: st.shown })}`;
  }
  const VIEWS = { summary: viewSummary, agents: viewAgents, tls: viewTls, days: viewDays, hours: viewHours, comm: viewComm, rec: viewRecords };

  // ---- CSV ----------------------------------------------------------------------------------------
  function tabData(tabArg) {
    const tab = tabArg || st.tab;
    const list = boxed(filtered());
    let cols, rows;
    if (tab === 'agents') { cols = agentCols(); rows = group(list, (r) => r.id, (r) => ({ id: r.id, agent: r.agent, supName: r.supName, supId: r.supId })); }
    else if (tab === 'tls') { cols = tlCols(); rows = group(list, (r) => r.supId || r.supName || 'Direct', (r) => ({ supId: r.supId, supName: r.supName || 'Direct' })); rows.forEach((o) => { o.agents = new Set(list.filter((r) => (r.supId || r.supName || 'Direct') === o.key).map((r) => r.id)).size; }); }
    else if (tab === 'hours') { cols = [{ k: 'hr', label: 'Hour' }, { k: 'VC4', label: 'VC4' }, { k: 'VC20', label: 'VC20' }, { k: 'VC5+', label: 'VC5+' }, { k: 'n', label: 'Total' }, { k: 'repl', label: 'Replacement' }, { k: 'comm', label: 'Commission' }]; rows = group(list.filter((r) => r.time), (r) => r.time.slice(0, 2), (r) => ({ hr: r.time.slice(0, 2) })); }
    else if (tab === 'days') { cols = dayCols(); rows = group(list, (r) => r.day, (r) => ({ day: r.day })); }
    else if (tab === 'comm') { cols = commCols(); rows = commRows(list).rows; }
    else { cols = recCols(); rows = list; }
    const s0 = st.sort[tab === 'summary' ? 'rec' : tab]; if (s0) rows = sorted(tab === 'summary' ? 'rec' : tab, cols, rows);
    return { cols, rows, list };
  }
  const plain = (c, r) => { const v = c.v ? c.v(r) : r[c.k]; return v == null ? '' : v; };
  function exportCsv() {
    const { cols, rows, list } = tabData(st.tab === 'summary' && st.box ? (BOX[st.box].tab || 'rec') : st.tab);
    U.downloadCsv(`${fileBase(list)}.csv`, cols.map((c) => c.label), rows.map((r) => cols.map((c) => plain(c, r))));
  }
  // 📄 PDF — A4 par fit hone wale columns
  const PDF_KEYS = {
    rec: [['added', 'Date · time', 2.2], ['id', 'Agent ID', 1.3], ['agent', 'Agent', 2.2], ['supName', 'TL', 1.9], ['cls', 'Class', 0.9], ['vno', 'VRN', 1.7], ['tag', 'Tag ID', 2.3], ['status', 'Status', 1.3], ['amount', 'Amount', 1.1, 1], ['commission', 'Comm.', 1, 1]],
    agents: [['id', 'Agent ID', 1.2], ['agent', 'Agent', 2.2], ['supName', 'TL', 2], ['VC4', 'VC4', 0.8, 1], ['VC20', 'VC20', 0.8, 1], ['VC5+', 'VC5+', 0.8, 1], ['n', 'Total', 0.8, 1], ['repl', 'Repl.', 0.8, 1], ['wrong', 'Wrong', 0.8, 1], ['chassis', 'Chassis', 0.9, 1], ['comm', 'Commission', 1.3, 1]],
    tls: [['supId', 'TL ID', 1.2], ['supName', 'TL', 2.3], ['agents', 'Agents', 0.9, 1], ['VC4', 'VC4', 0.8, 1], ['VC20', 'VC20', 0.8, 1], ['VC5+', 'VC5+', 0.8, 1], ['n', 'Total', 0.9, 1], ['repl', 'Repl.', 0.8, 1], ['wrong', 'Wrong', 0.8, 1], ['chassis', 'Chassis', 0.9, 1], ['comm', 'Commission', 1.3, 1]],
    days: [['day', 'Date', 1.4], ['VC4', 'VC4', 1, 1], ['VC20', 'VC20', 1, 1], ['VC5+', 'VC5+', 1, 1], ['n', 'Total', 1, 1], ['repl', 'Replacement', 1.2, 1], ['wrong', 'Wrong VRN', 1.1, 1], ['chassis', 'Chassis', 1, 1], ['amount', 'Amount', 1.4, 1], ['comm', 'Commission', 1.4, 1]]
  };
  const MONEY_K = new Set(['amount', 'comm', 'commission']);
  async function exportPdf(btn) {
    const want = st.tab === 'summary' && st.box ? (BOX[st.box].tab || 'rec') : st.tab;
    const tab = PDF_KEYS[want] ? want : 'rec';
    const { cols, rows, list } = tabData(tab);
    const name = `${fileBase(list)}.pdf`;
    try {
      if (btn) btn.disabled = true;
      if (!FF.pdf && FF.lazy && FF.lazy.need) await FF.lazy.need('pdf');
      if (!FF.pdf || !FF.pdf.doc) throw new Error('PDF module load nahi hua — page refresh karo');
      const keys = PDF_KEYS[tab];
      const byK = new Map(cols.map((c) => [c.k, c]));
      const cell = (k, r) => { const c = byK.get(k); const v = c ? plain(c, r) : r[k]; if (MONEY_K.has(k)) return v == null || v === '' ? '–' : money(v); if (typeof v === 'number') return n0(v); return String(v == null ? '' : v).slice(0, k === 'added' ? 16 : 60); };
      const t = blank(); list.forEach((r) => bump(t, r));
      const doc = FF.pdf.doc({ title: `GV API Report · ${fileBase(list)}`, subtitle: `${st.from} → ${st.to} · ${n0(list.length)} records`, right: new Date().toLocaleString('en-IN') });
      doc.kpis([
        { label: 'Total tags', value: n0(t.n), sub: `${n0(t.n - t.repl)} issuance` }, { label: 'Replacement', value: n0(t.repl) },
        { label: 'VC4 · VC20 · VC5+', value: `${n0(t.VC4)} · ${n0(t.VC20)} · ${n0(t['VC5+'])}` }, { label: 'Commission', value: money(t.comm) },
        { label: 'Wrong VRN', value: n0(t.wrong) }, { label: 'Chassis', value: n0(t.chassis) }, { label: 'Amount', value: money(t.amount) }, { label: 'Agents', value: n0(new Set(list.map((r) => r.id)).size) }
      ], 4);
      const MAX = 1500, out = rows.slice(0, MAX);
      doc.section(st.box ? BOX[st.box].label : TAB_LABEL[tab], `${n0(rows.length)} rows${rows.length > MAX ? ` · PDF me pehle ${MAX} (poora CSV me)` : ''}`);
      doc.table(keys.map(([, h, w, n]) => ({ h, w, align: n ? 'right' : 'left' })), out.map((r) => keys.map(([k]) => cell(k, r))), { headColor: '#4338ca' });
      FF.pdf.download(doc.finish(), name);
      if (U.toast) U.toast('PDF downloaded ✓', 'ok');
    } catch (err) { if (U.toast) U.toast((err && err.message) || 'PDF nahi bana', 'err'); } finally { if (btn) btn.disabled = false; }
  }

  // ---- paint --------------------------------------------------------------------------------------
  function paint(root) {
    const host = U.$('#gar-out', root); if (!host) return;
    const base = filtered();
    const list = boxed(base);
    let note = '';
    if (st.meta && st.meta.errors && st.meta.errors.length) note += `<div class="gar-note">⚠️ ${st.meta.errors.length} din ka data GV API ne baar-baar try karne par bhi nahi diya: ${esc(st.meta.errors.map((e) => e.day).join(', '))} <button class="btn small" data-gar="retry">↻ Sirf ye din dobara lao</button></div>`;
    if (st.meta && st.meta.truncated) note += '<div class="gar-note">⚠️ Ek baar me max 45 din (aakhri din kat gaye). Date range chhoti karo.</div>';
    if (st.meta && st.meta.stats) {
      const x = st.meta.stats, bad = st.rows.filter((r) => !CLS.includes(r.cls)).length, noC = st.rows.filter((r) => r.commission == null).length, direct = st.rows.filter((r) => !r.supId && !r.supName).length;
      note += `<div class="gar-ok" style="background:#eff6ff;color:#1e3a8a">ℹ️ Date filter = <b>date_added 00:00:00 – 23:59:59 (IST)</b>. API ne ${n0(x.fetched)} records diye → ${n0(x.dupes)} repeat hataye · ${n0(x.outside)} doosre din ke alag kiye · ${n0(st.rows.length)} bache.${x.noDate ? ` ⚠️ ${n0(x.noDate)} me date_added nahi tha.` : ''}${bad ? ` ⚠️ ${n0(bad)} ki class pehchaan nahi hui.` : ''}${noC ? ` · ${n0(noC)} me commission khaali.` : ''}${direct ? ` · ${n0(direct)} bina TL (direct).` : ''}</div>`;
    }
    if (multiInfo.tokens.length) {
      const nf = multiInfo.tokens.filter((t) => !multiInfo.found.has(t));
      note += `<div class="${nf.length ? 'gar-nf' : 'gar-ok'}">🔎 Multi-search: ${multiInfo.found.size}/${multiInfo.tokens.length} mile${nf.length ? ` · ❌ nahi mile (${nf.length}): ${esc(nf.slice(0, 60).join(', '))}${nf.length > 60 ? '…' : ''}` : ' ✓'}</div>`;
    }
    host.innerHTML = `${note}<div class="gar-tabs">${[['summary', '📊 Summary'], ['agents', '👤 Agents'], ['tls', '🧑‍💼 TLs'], ['days', '📅 Day-wise'], ['hours', '🕐 Hour-wise'], ['comm', '💸 Commission'], ['rec', '📋 All records']].map(([k, l]) => `<button data-gar-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}
      <span style="margin-left:auto" class="dim small">${n0(list.length)} / ${n0(st.rows.length)} records</span></div>${boxBar(list)}${VIEWS[st.tab](st.tab === 'summary' ? base : list)}`;
  }
  function boxBar(list) {
    if (!st.box) return '';
    const ex = FF.auth.can('export');
    return `<div class="gar-boxbar">📦 <b>${esc(BOX[st.box].label)}</b> · ${esc(personLabel(list))} · ${n0(list.length)} records
      <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${ex ? '<button class="btn small" data-gar="csv">⬇ CSV</button><button class="btn small" data-gar="pdf">📄 PDF</button>' : ''}<button class="btn small" data-gar="unbox">✖ Box hatao</button></span></div>`;
  }
  function distinct(key) { return [...new Set(st.rows.map((r) => r[key] || '—'))].sort(); }

  const addDays = (k, n) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const CHUNK = 15;
  function mergeRows(into, seen, rows) { let add = 0; for (const r of rows) { const k = r.k || (r.tag + '|' + r.id + '|' + r.sno); if (seen.has(k)) continue; seen.add(k); into.push(r); add++; } return add; }
  // ek din (±1 buffer server khud leta hai) — sirf usi din ke records
  async function retryDay(day, stats) {
    const d = await FF.auth.api(`/api/gv-api-report?from=${day}&to=${day}`);
    if (!d || d.ok === false) throw new Error((d && d.error) || 'retry fail');
    if (stats && d.stats) stats.fetched += d.stats.fetched || 0;
    return d;
  }
  async function retryFailed(root) {
    const days = ((st.meta && st.meta.errors) || []).map((e) => e.day);
    if (!days.length) return;
    const out = U.$('#gar-out', root); const seen = new Set(st.rows.map((r) => r.k || (r.tag + '|' + r.id + '|' + r.sno)));
    const still = [];
    for (const day of days) {
      out.innerHTML = U.spinner(`${day} dobara la raha hoon…`);
      try { const d = await retryDay(day); mergeRows(st.rows, seen, (d.rows || []).filter((r) => r.day >= st.from && r.day <= st.to)); (d.errors || []).filter((e) => e.day === day).forEach((e) => still.push(e)); } catch (err) { still.push({ day, error: String(err.message || err) }); }
    }
    st.rows.sort((x, y) => (x.added < y.added ? -1 : x.added > y.added ? 1 : 0));
    st.meta.errors = still;
    if (root.isConnected) { fillSelects(root); paint(root); }
  }
  async function load(root) {
    const out = U.$('#gar-out', root); st.loading = true; st.abort = false;
    const total = Math.max(1, Math.round((Date.parse(`${st.to}T00:00:00Z`) - Date.parse(`${st.from}T00:00:00Z`)) / 864e5) + 1);
    const rows = [], seen = new Set(), errors = [], stats = { fetched: 0, dupes: 0, outside: 0, noDate: 0 };
    let doneDays = 0;
    const progress = () => { out.innerHTML = U.spinner(`GV API se data aa raha hai… ${doneDays}/${total} din · ${n0(rows.length)} records`) + '<div style="text-align:center;margin-top:6px"><button class="btn small" data-gar="stop">⏹ Roko (jitna aaya utna dikhao)</button></div>'; };
    progress();
    try {
      for (let from = st.from; from <= st.to && !st.abort; from = addDays(from, CHUNK)) {
        const to = addDays(from, CHUNK - 1) > st.to ? st.to : addDays(from, CHUNK - 1);
        let d = null, lastErr = null;
        for (let a = 0; a < 3 && !d; a++) {   // poora chunk fail (timeout / 502) ho to bhi 3 baar
          if (a) await new Promise((r) => setTimeout(r, 2500 * a));
          try { d = await FF.auth.api(`/api/gv-api-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); if (!d || d.ok === false) { lastErr = new Error((d && d.error) || 'GV API report load nahi hua'); d = null; } } catch (err) { lastErr = err; }
        }
        if (!d) throw lastErr || new Error('GV API report load nahi hua');
        mergeRows(rows, seen, d.rows || []);
        (d.errors || []).forEach((e) => errors.push(e));
        Object.keys(stats).forEach((k) => { stats[k] += (d.stats && d.stats[k]) || 0; });
        doneDays += Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;
        if (!root.isConnected) return;
        progress();
      }
      // ↻ jo din fail hue unhe ek-ek karke dobara (3 round, ruk-ruk kar) — selected range poori chahiye
      for (let round = 1; round <= 3 && errors.length && !st.abort; round++) {
        const clamp = (k) => (k < st.from ? st.from : k > st.to ? st.to : k);   // buffer din (±1) → paas wala range ka din (server ±1 khud leta hai)
        const failed = [...new Set(errors.map((e) => clamp(e.day)))].sort();
        errors.length = 0;
        await new Promise((r) => setTimeout(r, 1500 * round));
        for (const day of failed) {
          if (st.abort || !root.isConnected) break;
          out.innerHTML = U.spinner(`Kuch din dobara la raha hoon (round ${round}/3)… ${day} · ${n0(rows.length)} records`);
          const one = await retryDay(day, stats).catch((err) => ({ err }));
          if (one.err) { errors.push({ day, error: String(one.err.message || one.err) }); continue; }
          mergeRows(rows, seen, (one.rows || []).filter((r) => r.day >= st.from && r.day <= st.to));
          (one.errors || []).filter((e) => e.day === day).forEach((e) => errors.push(e));
        }
      }
    } catch (err) { st.loading = false; if (root.isConnected) out.innerHTML = U.errorBox(err, 'data-gar="load"'); return; }
    rows.sort((x, y) => (x.added < y.added ? -1 : x.added > y.added ? 1 : 0));
    const dedupErr = []; const seenE = new Set(); errors.forEach((e) => { if (!seenE.has(e.day)) { seenE.add(e.day); dedupErr.push(e); } });
    errors.length = 0; errors.push(...dedupErr.filter((e) => e.day >= st.from && e.day <= st.to));
    st.meta = { errors, stats, truncated: false, partial: st.abort }; st.rows = rows; st.shown = PAGE; st.loadedAt = Date.now(); st.loading = false;
    if (!root.isConnected) return;
    fillSelects(root); paint(root);
  }
  // 🔎 Multi-search: date range se bahar bhi — API me peeche tak (din-din) dhundo, jab tak sab mil na jaayein
  async function searchApi(root) {
    const tokens = [...new Set(String(st.f.multi || '').split(/[\s,;|]+/).map((t) => norm(t)).filter(Boolean))];
    if (!tokens.length) { U.toast ? U.toast('Pehle multi-search box me VRN / tag / barcode daalo.') : alert('Pehle multi-search box me VRN / tag / barcode daalo.'); return; }
    const out = U.$('#gar-out', root); st.abort = false; st.loading = true;
    const days = Number(U.$('#gar-sdays', root).value) || 365;
    const found = new Set(), rows = [], seen = new Set(), errors = [];
    const q = encodeURIComponent(tokens.slice(0, 200).join(','));
    let scanned = 0, to = today(), hitDay = '';
    const prog = () => { out.innerHTML = U.spinner(`API me dhundh raha hoon… ${scanned}/${days} din peeche · ${found.size}/${tokens.length} mile`) + '<div style="text-align:center;margin-top:6px"><button class="btn small" data-gar="stop">⏹ Roko</button></div>'; };
    prog();
    try {
      while (scanned < days && !st.abort && found.size < tokens.length) {
        const from = addDays(to, -(CHUNK - 1));
        const d = await FF.auth.api(`/api/gv-api-report?from=${from}&to=${to}&q=${q}`);
        if (!d || d.ok === false) throw new Error((d && d.error) || 'API search nahi chala');
        mergeRows(rows, seen, d.rows || []);
        (d.errors || []).forEach((e) => errors.push(e));
        for (const r of d.rows || []) { const keys = [norm(r.vno), norm(r.tag), norm(r.sno), norm(r.id), norm(r.name)]; tokens.forEach((t) => { if (keys.some((k) => k && (k === t || (t.length >= 6 && k.includes(t))))) found.add(t); }); }
        scanned += CHUNK; to = addDays(from, -1); hitDay = from;
        if (!root.isConnected) return;
        prog();
      }
    } catch (err) { st.loading = false; if (root.isConnected) out.innerHTML = U.errorBox(err, 'data-gar="search"'); return; }
    rows.sort((x, y) => (x.added < y.added ? -1 : x.added > y.added ? 1 : 0));
    st.rows = rows; st.from = rows.length ? rows[0].day : st.from; st.to = rows.length ? rows[rows.length - 1].day : st.to;
    st.meta = { errors, stats: null, truncated: false, searched: { scanned, until: hitDay, found: found.size, total: tokens.length } };
    st.tab = 'rec'; st.shown = PAGE; st.loading = false;
    const fi = U.$('#gar-from', root), ti = U.$('#gar-to', root); if (fi) fi.value = st.from; if (ti) ti.value = st.to;
    if (!root.isConnected) return;
    fillSelects(root); paint(root);
  }
  function fillSelects(root) {
    const set = (id, cur, opts) => { const el = U.$(id, root); if (el) el.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join(''); };
    set('#gar-cls', st.f.cls, [['', 'All classes']].concat(CLS.map((c) => [c, c])));
    set('#gar-status', st.f.status, [['', 'All status'], ['__iss', 'Issuance only'], ['__repl', 'Replacement only']].concat(distinct('status').map((s) => [s === '—' ? '' : s, s])));
    set('#gar-cstatus', st.f.cstatus, [['', 'Commission status: all']].concat(distinct('cstatus').map((s) => [s, s])));
  }

  function clearFilters(root) {
    st.f = { agent: '', agentId: '', tl: '', tlId: '', cls: '', status: '', cstatus: '', vrn: '', multi: '', cid: '' };
    root.querySelectorAll('[data-gar-f]').forEach((el) => { el.value = ''; });
    const c = U.$('#gar-cid', root); if (c) c.value = '';
    st.box = ''; st.shown = PAGE; fillSelects(root); paint(root);
  }
  async function render(root) {
    css();
    if (!st.from) { st.from = today(); st.to = today(); }
    root.innerHTML = `<div class="page-head"><div><h1>🛰️ GV API Report</h1><p class="sub">GV ki direct API se · date range · agent/TL filter · VRN / tag / barcode multi-search · commission class-wise</p></div>
      <div class="head-actions">${FF.auth.can('export') ? '<button class="btn" data-gar="csv">⬇ CSV (is tab ka)</button><button class="btn" data-gar="pdf">📄 PDF</button>' : ''}<button class="btn" data-gar="clear">✖ Filters clear</button><button class="btn primary" data-gar="load">↻ API se load</button></div></div>
      <div class="gar-filters">
        <div><label class="gar-lbl">From date</label><input class="input" type="date" id="gar-from" value="${esc(st.from)}"></div>
        <div><label class="gar-lbl">To date</label><input class="input" type="date" id="gar-to" value="${esc(st.to)}"></div>
        <div><label class="gar-lbl">Agent name</label><input class="input" data-gar-f="agent" placeholder="naam" value="${esc(st.f.agent)}"></div>
        <div><label class="gar-lbl">Agent ID</label><input class="input" data-gar-f="agentId" placeholder="ID" value="${esc(st.f.agentId)}"></div>
        <div><label class="gar-lbl">TL name</label><input class="input" data-gar-f="tl" placeholder="TL naam" value="${esc(st.f.tl)}"></div>
        <div><label class="gar-lbl">TL ID</label><input class="input" data-gar-f="tlId" placeholder="TL ID" value="${esc(st.f.tlId)}"></div>
        <div><label class="gar-lbl">Class</label><select class="input" id="gar-cls" data-gar-f="cls"></select></div>
        <div><label class="gar-lbl">Status</label><select class="input" id="gar-status" data-gar-f="status"></select></div>
        <div><label class="gar-lbl">Commission status</label><select class="input" id="gar-cstatus" data-gar-f="cstatus"></select></div>
        <div><label class="gar-lbl">VRN check</label><select class="input" data-gar-f="vrn"><option value="">All</option><option value="wrong" ${st.f.vrn === 'wrong' ? 'selected' : ''}>Wrong VRN only</option><option value="chassis" ${st.f.vrn === 'chassis' ? 'selected' : ''}>Chassis only</option></select></div>
      </div>
      <label class="gar-lbl">🔎 Multiple search — VRN · Tag ID · Barcode/SNO · Agent ID · Customer (ek ya bahut saare, space / comma / new line se alag)</label>
      <textarea class="input gar-multi" data-gar-f="multi" placeholder="MH12AB1234&#10;34161FA820…&#10;barcode…">${esc(st.f.multi)}</textarea>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0"><button class="btn primary small" data-gar="search">🛰️ API se dhundo (date range se bahar bhi)</button><select class="input" id="gar-sdays" style="max-width:190px"><option value="30">peeche 30 din</option><option value="90">peeche 90 din</option><option value="180">peeche 180 din</option><option value="365" selected>peeche 365 din</option><option value="730">peeche 730 din</option></select><span class="dim small">Box ke VRN/tag/barcode ko API me din-din peeche dhundta hai, sab milte hi ruk jaata hai.</span></div>
      <div id="gar-out" style="margin-top:8px">${U.spinner('GV API se data aa raha hai…')}</div>`;
    fillSelects(root);
    const redo = U.debounce ? U.debounce(() => { st.shown = PAGE; paint(root); }, 200) : () => { st.shown = PAGE; paint(root); };
    root.oninput = (e) => {
      const k = e.target.dataset && e.target.dataset.garF; if (k) { st.f[k] = e.target.value; redo(); return; }
      if (e.target.id === 'gar-cid') { st.f.cid = e.target.value; redo(); }
    };
    root.onchange = (e) => {
      if (e.target.id === 'gar-from') st.from = e.target.value; else if (e.target.id === 'gar-to') st.to = e.target.value;
      else if (e.target.dataset && e.target.dataset.garF) { st.f[e.target.dataset.garF] = e.target.value; st.shown = PAGE; paint(root); }
    };
    root.onclick = (e) => {
      const tab = e.target.closest('[data-gar-tab]'); if (tab) { st.tab = tab.dataset.garTab; st.shown = PAGE; paint(root); return; }
      const bx = e.target.closest('[data-gar-box]');
      if (bx && BOX[bx.dataset.garBox]) {
        const k = bx.dataset.garBox; st.box = k; st.tab = BOX[k].tab || 'rec'; st.shown = PAGE; paint(root);
        const tb = U.$('.gar-tabs', root); if (tb && tb.scrollIntoView) tb.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const so = e.target.closest('[data-gar-sort]');
      if (so) { const [t, k] = so.dataset.garSort.split('|'); const cur = st.sort[t]; st.sort[t] = { k, dir: cur && cur.k === k ? -cur.dir : -1 }; paint(root); return; }
      const a = e.target.closest('[data-gar]'); if (!a) return;
      if (a.dataset.gar === 'load') { if (st.to < st.from) [st.from, st.to] = [st.to, st.from]; load(root); }
      else if (a.dataset.gar === 'stop') st.abort = true;
      else if (a.dataset.gar === 'search') searchApi(root);
      else if (a.dataset.gar === 'clear') clearFilters(root);
      else if (a.dataset.gar === 'more') { st.shown += PAGE; paint(root); }
      else if (a.dataset.gar === 'csv') exportCsv();
      else if (a.dataset.gar === 'pdf') exportPdf(a);
      else if (a.dataset.gar === 'unbox') { st.box = ''; st.tab = 'summary'; st.shown = PAGE; paint(root); }
      else if (a.dataset.gar === 'retry') retryFailed(root);
    };
    await load(root);
  }

  FF.pages.gvApiReport = { title: 'GV API Report', render, _test: { st, BOX, boxed, personLabel, fileBase, viewSummary, filtered } };
})(window.FF);
