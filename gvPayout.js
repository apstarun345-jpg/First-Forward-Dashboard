/* 💸 GV Commission Payout (v3.91) — GV Master se agent-wise latest commission (product ID, settings se)
   + TL name/ID + class + pichhle aur current mahine ke tags (VC4 / VC20 / VC5+). Direct + TL dono, filter ke saath. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, G = FF.gv, S = FF.store;
  const esc = U.esc;
  const GROUPS = ['VC4', 'VC20', 'VC5+'];
  const PAGE = 100;
  const st = { q: '', who: 'all', tl: '', cls: '', sort: 'comm', compact: true, shown: PAGE, rows: [], meta: null, cm: '', lm: '' };

  const CSS = `
  .gvp-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
  .gvp-chip{padding:8px 14px;border-radius:12px;color:#fff;font-size:12px;font-weight:600;min-width:120px}
  .gvp-chip b{display:block;font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}
  .gvp-chip.c1{background:linear-gradient(135deg,#4f46e5,#6366f1)}.gvp-chip.c2{background:linear-gradient(135deg,#ea580c,#f59e0b)}
  .gvp-chip.c3{background:linear-gradient(135deg,#0f766e,#14b8a6)}.gvp-chip.c4{background:linear-gradient(135deg,#7e22ce,#c026d3)}
  .gvp-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}
  .gvp-bar .input,.gvp-bar select{max-width:230px}
  .gvp-seg{display:inline-flex;padding:3px;border-radius:999px;background:rgba(100,116,139,.16)}
  .gvp-seg button{border:0;background:transparent;font:inherit;font-size:12.5px;font-weight:700;padding:6px 13px;border-radius:999px;cursor:pointer;color:inherit}
  .gvp-seg button.on{background:#4f46e5;color:#fff}
  .gvp-wrap{overflow:auto;border-radius:12px;border:1px solid rgba(148,163,184,.3);max-height:70vh}
  table.gvp{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px}
  table.gvp th,table.gvp td{padding:7px 9px;white-space:nowrap;border-bottom:1px solid rgba(148,163,184,.2)}
  table.gvp thead th{position:sticky;top:0;z-index:2;color:#fff;font-weight:700;text-align:center}
  table.gvp thead tr.g2 th{top:29px}
  table.gvp .ga{background:#4338ca}.gvp .gb{background:#c2410c}.gvp .gc{background:#0f766e}.gvp .gd{background:#7e22ce}
  table.gvp .ga2{background:#6366f1}.gvp .gb2{background:#f97316}.gvp .gc2{background:#14b8a6}.gvp .gd2{background:#a855f7}
  table.gvp td.n{text-align:right;font-variant-numeric:tabular-nums}
  table.gvp td.ta{background:rgba(99,102,241,.06)}table.gvp td.tb{background:rgba(249,115,22,.09);font-weight:800;color:#c2410c}
  table.gvp td.tc{background:rgba(20,184,166,.08)}table.gvp td.td{background:rgba(168,85,247,.08)}
  table.gvp td.tot{font-weight:800}
  table.gvp td.z{color:#94a3b8}
  table.gvp tbody tr:hover td{filter:brightness(.97)}
  .gvp-cls{display:inline-block;padding:2px 8px;border-radius:999px;background:#e0e7ff;color:#3730a3;font-weight:700;font-size:11.5px}
  .gvp-dir{display:inline-block;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-weight:700;font-size:11.5px}
  table.gvp.cmp th,table.gvp.cmp td{padding:4px 6px;font-size:12px}
  table.gvp th.gvp-s{cursor:pointer;user-select:none}table.gvp th.gvp-s:hover{filter:brightness(1.15)}
  .gvp-more{text-align:center;margin:12px 0}
  `;
  function css() {
    if (document.getElementById('gvp-css')) return;
    const s = document.createElement('style'); s.id = 'gvp-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  const idOf = (v) => String(v || '').trim().toUpperCase();
  const money = (n, cur) => `${cur}${Math.round(n).toLocaleString('en-IN')}`;

  /** Commission map + issuance rows → ek row per agent. */
  function build(map) {
    const latest = G.latestDate && G.latestDate();
    const cm = U.ymKey(latest instanceof Date && !isNaN(latest) ? latest : new Date());
    const [y, m] = cm.split('-').map(Number);
    const lm = U.ymKey(new Date(y, m - 2, 1));
    st.cm = cm; st.lm = lm;
    const tags = new Map();
    const bucket = (id) => { let b = tags.get(id); if (!b) { b = { l: { 'VC4': 0, 'VC20': 0, 'VC5+': 0 }, c: { 'VC4': 0, 'VC20': 0, 'VC5+': 0 }, name: '', tl: '', tlId: '' }; tags.set(id, b); } return b; };
    (G.issuanceRows() || []).forEach((r) => {
      const t = r.ym === cm ? 'c' : r.ym === lm ? 'l' : '';
      if (!t) return;
      const id = idOf(r.agentId); if (!id) return;
      const grp = GROUPS.includes(r.group) ? r.group : 'VC5+';
      const b = bucket(id); b[t][grp] += Number(r.n) || 1;
      if (!b.name && r.agentName) b.name = r.agentName;
      if (!b.tl && r.tlName) b.tl = r.tlName;
      if (!b.tlId && r.tlId) b.tlId = r.tlId;
    });
    const rows = [];
    const agents = (map && map.agents) || {};
    Object.keys(agents).forEach((id) => {
      const a = agents[id], b = tags.get(id) || bucket(id);
      const tlId = a.tid || '';
      const tlName = a.tn || (tlId ? b.tl : '');
      rows.push({
        id, name: a.n || b.name || '', tlId, tlName, direct: !tlId && !(a.tn),
        cls: a.c || '', comm: a.a, date: a.d || '',
        l: b.l, c: b.c, lt: b.l['VC4'] + b.l['VC20'] + b.l['VC5+'], ct: b.c['VC4'] + b.c['VC20'] + b.c['VC5+']
      });
    });
    return rows;
  }

  function filtered() {
    const q = st.q.trim().toLowerCase();
    let r = st.rows.filter((x) => {
      if (st.who === 'tl' && x.direct) return false;
      if (st.who === 'direct' && !x.direct) return false;
      if (st.tl && (x.tlId || '') !== st.tl) return false;
      if (st.cls && x.cls !== st.cls) return false;
      if (q && !(`${x.id} ${x.name} ${x.tlId} ${x.tlName}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const val = {
      id: (x) => x.id, name: (x) => x.name || '', tl: (x) => (x.direct ? '' : x.tlName || ''), tlId: (x) => x.tlId || '', cls: (x) => x.cls || '',
      comm: (x) => x.comm, lt: (x) => x.lt, ct: (x) => x.ct,
      l4: (x) => x.l['VC4'], l20: (x) => x.l['VC20'], l5: (x) => x.l['VC5+'], c4: (x) => x.c['VC4'], c20: (x) => x.c['VC20'], c5: (x) => x.c['VC5+']
    }[st.sort] || ((x) => x.comm);
    const by = (a, b) => { const p = val(a), q = val(b); return (typeof p === 'number' ? p - q : String(p).localeCompare(String(q), undefined, { numeric: true })) * st.dir; };
    return r.slice().sort(by);
  }

  const num = (v, cls) => `<td class="n ${cls} ${v ? '' : 'z'}">${v ? v.toLocaleString('en-IN') : '–'}</td>`;

  function rowHtml(x, i, meta) {
    const cur = meta.currency || '₹';
    return `<tr>
      <td class="ta n">${i + 1}</td>
      <td class="ta"><b>${esc(x.id)}</b></td>
      <td class="ta">${esc(x.name || '—')}</td>
      <td class="ta">${x.direct ? '<span class="gvp-dir">🚫 Direct</span>' : esc(x.tlName || '—')}${st.compact && x.tlId ? `<br><small class="dim">${esc(x.tlId)}</small>` : ''}</td>
      ${st.compact ? '' : `<td class="ta">${esc(x.tlId || '—')}</td>`}
      <td class="ta">${x.cls ? `<span class="gvp-cls">${esc(x.cls)}</span>` : '—'}</td>
      ${st.compact ? '' : `<td class="ta">${esc(meta.productId || '')}</td>`}
      <td class="tb n">${money(x.comm, cur)}${esc(meta.suffix || '')}<br><small style="font-weight:500;color:#9a3412">${esc(x.date || '')}</small></td>
      ${GROUPS.map((g) => num(x.l[g], 'tc')).join('')}${num(x.lt, 'tc tot')}
      ${GROUPS.map((g) => num(x.c[g], 'td')).join('')}${num(x.ct, 'td tot')}
    </tr>`;
  }

  const th = (k, label, cls) => k
    ? `<th class="${cls} gvp-s" data-gvp-sort="${k}" title="Sort">${esc(label)} ${st.sort === k ? (st.dir > 0 ? '▲' : '▼') : '<span style="opacity:.5">⇅</span>'}</th>`
    : `<th class="${cls}">${esc(label)}</th>`;
  function paint(root) {
    const list = filtered();
    const meta = st.meta || {};
    const sum = (k, g) => list.reduce((n, x) => n + (g ? x[k][g] : x[k]), 0);
    const tls = new Set(list.filter((x) => x.tlId).map((x) => x.tlId));
    const lmL = U.labelYM ? U.labelYM(st.lm) : st.lm, cmL = U.labelYM ? U.labelYM(st.cm) : st.cm;
    U.$('#gvp-chips', root).innerHTML = `
      <div class="gvp-chip c1">Agents<b>${list.length.toLocaleString('en-IN')}</b>${tls.size} TLs · ${list.filter((x) => x.direct).length} direct</div>
      <div class="gvp-chip c2">Avg commission<b>${list.length ? money(list.reduce((n, x) => n + x.comm, 0) / list.length, meta.currency || '₹') : '–'}</b>max ${list.length ? money(Math.max(...list.map((x) => x.comm)), meta.currency || '₹') : '–'}</div>
      <div class="gvp-chip c3">${esc(lmL)}<b>${sum('lt').toLocaleString('en-IN')}</b>VC4 ${sum('l', 'VC4')} · VC20 ${sum('l', 'VC20')} · VC5+ ${sum('l', 'VC5+')}</div>
      <div class="gvp-chip c4">${esc(cmL)}<b>${sum('ct').toLocaleString('en-IN')}</b>VC4 ${sum('c', 'VC4')} · VC20 ${sum('c', 'VC20')} · VC5+ ${sum('c', 'VC5+')}</div>`;
    const shown = list.slice(0, st.shown);
    U.$('#gvp-table', root).innerHTML = list.length ? `<div class="gvp-wrap"><table class="gvp${st.compact ? ' cmp' : ''}"><thead>
      <tr><th class="ga" colspan="${st.compact ? 5 : 7}">👤 Agent &amp; TL</th><th class="gb">💸 Commission</th><th class="gc" colspan="4">📅 ${esc(lmL)}${st.compact ? '' : ' · tags issued'}</th><th class="gd" colspan="4">📅 ${esc(cmL)}${st.compact ? '' : ' · tags issued'}</th></tr>
      <tr class="g2">${th('', '#', 'ga2')}${th('id', 'Agent ID', 'ga2')}${th('name', 'Agent name', 'ga2')}${th('tl', 'TL name', 'ga2')}${th('tlId', 'TL ID', 'ga2')}${th('cls', 'Class', 'ga2')}${th('', 'Product ID', 'ga2')}
      ${th('comm', 'Latest' + (meta.suffix || ''), 'gb2')}${th('l4', 'VC4', 'gc2')}${th('l20', 'VC20', 'gc2')}${th('l5', 'VC5+', 'gc2')}${th('lt', 'Total', 'gc2')}${th('c4', 'VC4', 'gd2')}${th('c20', 'VC20', 'gd2')}${th('c5', 'VC5+', 'gd2')}${th('ct', 'Total', 'gd2')}</tr>
      </thead><tbody>${shown.map((x, i) => rowHtml(x, i, meta)).join('')}</tbody></table></div>
      ${list.length > shown.length ? `<div class="gvp-more"><button class="btn" data-gvp="more">⬇ Aur dikhao (${shown.length}/${list.length})</button></div>` : `<p class="dim small">${list.length} agents</p>`}`
      : '<div class="empty">Koi agent nahi mila — filter badal ke dekho.</div>';
  }

  function exportCsv() {
    const meta = st.meta || {};
    const head = ['Agent ID', 'Agent name', 'TL name', 'TL ID', 'Class', 'Product ID', 'Latest commission', 'Commission date']
      .concat(GROUPS.map((g) => `${st.lm} ${g}`), [`${st.lm} Total`], GROUPS.map((g) => `${st.cm} ${g}`), [`${st.cm} Total`]);
    const rows = filtered().map((x) => [x.id, x.name, x.direct ? 'Direct' : x.tlName, x.tlId, x.cls, meta.productId || '', x.comm, x.date,
      ...GROUPS.map((g) => x.l[g]), x.lt, ...GROUPS.map((g) => x.c[g]), x.ct]);
    U.downloadCsv(`gv-commission-payout-${U.stamp ? U.stamp() : Date.now()}.csv`, head, rows);
  }

  async function render(root) {
    css();
    root.innerHTML = `<div class="page-head"><div><h1>💸 GV Commission Payout</h1><p class="sub">GV Master · agent-wise latest commission + TL + class + pichhle/current mahine ke tags</p></div>
      <div class="head-actions">${FF.auth.can('export') ? '<button class="btn" data-gvp="csv">⬇ CSV</button>' : ''}<button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div id="gvp-body">${U.spinner('Commission payout load ho raha hai…')}</div>`;
    const body = U.$('#gvp-body', root);
    let map;
    try {
      const [d] = await Promise.all([FF.auth.api('/api/gv-agent-commission'), Promise.allSettled([S.need('daily'), G.need('master')])]);
      map = d;
    } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    if (!map || map.enabled === false) { body.innerHTML = '<div class="empty">Commission box Settings me OFF hai.</div>'; return; }
    st.meta = map; st.rows = build(map); st.shown = PAGE;
    const tlOpts = [...new Map(st.rows.filter((x) => x.tlId).map((x) => [x.tlId, x.tlName || x.tlId])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const clsOpts = [...new Set(st.rows.map((x) => x.cls).filter(Boolean))].sort();
    body.innerHTML = `<div id="gvp-chips" class="gvp-chips"></div>
      <div class="gvp-bar">
        <input class="input" id="gvp-q" placeholder="🔍 Agent / TL naam ya ID" value="${esc(st.q)}">
        <span class="gvp-seg">${[['all', 'All'], ['tl', 'TL agents'], ['direct', 'Direct']].map(([k, l]) => `<button data-gvp-who="${k}" class="${st.who === k ? 'on' : ''}">${l}</button>`).join('')}</span>
        <select class="input" id="gvp-tl"><option value="">All TLs</option>${tlOpts.map(([id, n]) => `<option value="${esc(id)}" ${st.tl === id ? 'selected' : ''}>${esc(n)} (${esc(id)})</option>`).join('')}</select>
        <select class="input" id="gvp-cls"><option value="">All classes</option>${clsOpts.map((c) => `<option ${st.cls === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <button class="btn small" data-gvp="compact" id="gvp-cmp">${st.compact ? '↔ Full table' : '↕ Short table'}</button>
        <select class="input" id="gvp-sort">${[['comm', 'Commission ↓'], ['ct', 'Current month tags ↓'], ['lt', 'Last month tags ↓'], ['name', 'Agent name'], ['tl', 'TL name']].map(([k, l]) => `<option value="${k}" ${st.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div id="gvp-table"></div>
      <p class="dim small">Commission = GV Master ka latest (date column se) · product ${esc(map.productId || '')} (${esc(map.label || '')}). Tags = FF dashboard ke issuance data se.</p>`;
    const redo = () => { st.shown = PAGE; paint(root); };
    U.$('#gvp-q', root).addEventListener('input', U.debounce ? U.debounce((e) => { st.q = e.target.value; redo(); }, 150) : (e) => { st.q = e.target.value; redo(); });
    U.$('#gvp-tl', root).addEventListener('change', (e) => { st.tl = e.target.value; redo(); });
    U.$('#gvp-cls', root).addEventListener('change', (e) => { st.cls = e.target.value; redo(); });
    U.$('#gvp-sort', root).addEventListener('change', (e) => { st.sort = e.target.value; st.dir = e.target.value === 'name' || e.target.value === 'tl' ? 1 : -1; redo(); });
    root.onclick = (e) => {
      const w = e.target.closest('[data-gvp-who]');
      if (w) { st.who = w.dataset.gvpWho; root.querySelectorAll('[data-gvp-who]').forEach((b) => b.classList.toggle('on', b === w)); redo(); return; }
      const so = e.target.closest('[data-gvp-sort]');
      if (so) { const k = so.dataset.gvpSort; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = /^(id|name|tl|tlId|cls)$/.test(k) ? 1 : -1; } const dd = U.$('#gvp-sort', root); if (dd && [...dd.options].some((o) => o.value === k)) dd.value = k; paint(root); return; }
      const a = e.target.closest('[data-gvp]'); if (!a) return;
      if (a.dataset.gvp === 'more') { st.shown += PAGE; paint(root); }
      else if (a.dataset.gvp === 'compact') { st.compact = !st.compact; a.textContent = st.compact ? '↔ Full table' : '↕ Short table'; paint(root); }
      else if (a.dataset.gvp === 'csv') exportCsv();
    };
    paint(root);
  }

  FF.pages.gvPayout = { title: 'GV Commission Payout', render };
})(window.FF);
