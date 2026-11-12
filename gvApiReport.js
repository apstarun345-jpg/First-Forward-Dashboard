/* 🛰️ GV API Report (v3.125.206) — GV ki direct API se date-range data: filters, multi-search (VRN / tag / barcode),
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
  const st = { from: '', to: '', rows: [], meta: null, loading: false, tab: 'summary', sort: {}, shown: PAGE,
    f: { agent: '', agentId: '', tl: '', tlId: '', cls: '', status: '', cstatus: '', vrn: '', multi: '', cid: '' }, loadedAt: 0 };

  const CSS = `
  .gar-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
  .gar-chip{padding:9px 14px;border-radius:14px;color:#fff;font-size:12px;font-weight:700;min-width:118px;box-shadow:0 8px 18px -12px rgba(15,23,42,.5)}
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
    const chips = `<div class="gar-chips">
      <div class="gar-chip c1">Total tags<b>${n0(t.n)}</b><small>${n0(t.n - t.repl)} issuance · ${n0(t.repl)} replacement</small></div>
      <div class="gar-chip c2">VC4<b>${n0(t.VC4)}</b></div><div class="gar-chip c3">VC20<b>${n0(t['VC20'])}</b></div><div class="gar-chip c5">VC5+<b>${n0(t['VC5+'])}</b></div>
      <div class="gar-chip c4">Commission<b>${money(t.comm)}</b><small>avg ${money(t.commN ? t.comm / t.commN : 0)} / tag</small></div>
      <div class="gar-chip c7">Amount<b>${money(t.amount)}</b></div>
      <div class="gar-chip c8">Agents · TLs<b>${n0(agents.size)}</b><small>${n0(tls.size)} TLs</small></div>
      <div class="gar-chip c6">Wrong VRN · Chassis<b>${n0(t.wrong)} · ${n0(t.chassis)}</b></div>
      <div class="gar-chip c1">Avg / day<b>${n0(t.n / dayN)}</b><small>${dayN} din</small></div></div>`;
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
  function exportCsv() {
    const list = filtered();
    let cols, rows;
    if (st.tab === 'agents') { cols = agentCols(); rows = group(list, (r) => r.id, (r) => ({ id: r.id, agent: r.agent, supName: r.supName, supId: r.supId })); }
    else if (st.tab === 'tls') { cols = tlCols(); rows = group(list, (r) => r.supId || r.supName || 'Direct', (r) => ({ supId: r.supId, supName: r.supName || 'Direct' })); rows.forEach((o) => { o.agents = new Set(list.filter((r) => (r.supId || r.supName || 'Direct') === o.key).map((r) => r.id)).size; }); }
    else if (st.tab === 'hours') { cols = [{ k: 'hr', label: 'Hour' }, { k: 'VC4', label: 'VC4' }, { k: 'VC20', label: 'VC20' }, { k: 'VC5+', label: 'VC5+' }, { k: 'n', label: 'Total' }, { k: 'repl', label: 'Replacement' }, { k: 'comm', label: 'Commission' }]; rows = group(list.filter((r) => r.time), (r) => r.time.slice(0, 2), (r) => ({ hr: r.time.slice(0, 2) })); }
    else if (st.tab === 'days') { cols = dayCols(); rows = group(list, (r) => r.day, (r) => ({ day: r.day })); }
    else if (st.tab === 'comm') { cols = commCols(); rows = commRows(list).rows; }
    else { cols = recCols(); rows = list; }
    const plain = (c, r) => { const v = c.v ? c.v(r) : r[c.k]; return v == null ? '' : v; };
    U.downloadCsv(`gv-api-${st.tab}-${st.from}_${st.to}.csv`, cols.map((c) => c.label), rows.map((r) => cols.map((c) => plain(c, r))));
  }

  // ---- paint --------------------------------------------------------------------------------------
  function paint(root) {
    const host = U.$('#gar-out', root); if (!host) return;
    const list = filtered();
    let note = '';
    if (st.meta && st.meta.errors && st.meta.errors.length) note += `<div class="gar-note">⚠️ ${st.meta.errors.length} din ka data API se nahi aaya: ${esc(st.meta.errors.map((e) => e.day).join(', '))} — Reload karke dekho.</div>`;
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
      <span style="margin-left:auto" class="dim small">${n0(list.length)} / ${n0(st.rows.length)} records</span></div>${VIEWS[st.tab](list)}`;
  }
  function distinct(key) { return [...new Set(st.rows.map((r) => r[key] || '—'))].sort(); }

  async function load(root) {
    const out = U.$('#gar-out', root); st.loading = true;
    out.innerHTML = U.spinner('GV API se data aa raha hai… (har din ek call)');
    try {
      const d = await FF.auth.api(`/api/gv-api-report?from=${encodeURIComponent(st.from)}&to=${encodeURIComponent(st.to)}`);
      if (!d || d.ok === false) throw new Error((d && d.error) || 'GV API report load nahi hua');
      st.meta = d; st.rows = d.rows || []; st.shown = PAGE; st.loadedAt = Date.now();
    } catch (err) { st.loading = false; if (root.isConnected) out.innerHTML = U.errorBox(err, 'data-gar="load"'); return; }
    st.loading = false;
    if (!root.isConnected) return;
    fillSelects(root); paint(root);
  }
  function fillSelects(root) {
    const set = (id, cur, opts) => { const el = U.$(id, root); if (el) el.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join(''); };
    set('#gar-cls', st.f.cls, [['', 'All classes']].concat(CLS.map((c) => [c, c])));
    set('#gar-status', st.f.status, [['', 'All status'], ['__iss', 'Issuance only'], ['__repl', 'Replacement only']].concat(distinct('status').map((s) => [s === '—' ? '' : s, s])));
    set('#gar-cstatus', st.f.cstatus, [['', 'Commission status: all']].concat(distinct('cstatus').map((s) => [s, s])));
  }

  async function render(root) {
    css();
    if (!st.from) { st.from = today(); st.to = today(); }
    root.innerHTML = `<div class="page-head"><div><h1>🛰️ GV API Report</h1><p class="sub">GV ki direct API se · date range · agent/TL filter · VRN / tag / barcode multi-search · commission class-wise</p></div>
      <div class="head-actions">${FF.auth.can('export') ? '<button class="btn" data-gar="csv">⬇ CSV (is tab ka)</button>' : ''}<button class="btn primary" data-gar="load">↻ API se load</button></div></div>
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
      const so = e.target.closest('[data-gar-sort]');
      if (so) { const [t, k] = so.dataset.garSort.split('|'); const cur = st.sort[t]; st.sort[t] = { k, dir: cur && cur.k === k ? -cur.dir : -1 }; paint(root); return; }
      const a = e.target.closest('[data-gar]'); if (!a) return;
      if (a.dataset.gar === 'load') { if (st.to < st.from) [st.from, st.to] = [st.to, st.from]; load(root); }
      else if (a.dataset.gar === 'more') { st.shown += PAGE; paint(root); }
      else if (a.dataset.gar === 'csv') exportCsv();
    };
    await load(root);
  }

  FF.pages.gvApiReport = { title: 'GV API Report', render };
})(window.FF);
