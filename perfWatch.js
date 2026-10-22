/* ============================================================================================================
   🔎 perfWatch.js — Performance watchlist (FF + GV, one shared format)

   One panel, every segment of agents on one screen:
     growth · high growth · flat · de-growth · high de-growth · new · active today · inactive 3/7/15+ days ·
     no issuance this month · went quiet · no issuance in 2 months · High / Medium / Low priority ·
     zero stock · stock lying idle · needs dispatch · direct agents · needs attention.
   Click a segment → the full list for that segment (all agents, nothing searched). Search / TL / sort narrow it.
   Plus: totals strip, sortable paged table, CSV export and top-10 lists.

   Input rows are normalised by the page (GV or FF):
     { n, id, tl, direct, last, cur, proj, g, today, recent, stock, pri, st, inact, run, ref }
   ============================================================================================================ */
window.FF = window.FF || {};
(function (FF) {
  'use strict';

  const U = FF.util;
  const esc = U.esc;
  const nf = (n) => U.fmt(Number(n) || 0);
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const states = {};   // per channel (ff | gv) — remembers segment / filters between redraws

  function ensureCss() {
    if (document.getElementById('pw-css')) return;
    const st = document.createElement('style');
    st.id = 'pw-css';
    st.textContent = `
.pw-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.pw-head h3{margin:0}
.pw-group{margin:10px 0 4px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#64748b)}
.pw-seg{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:8px}
.pw-card{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:12px;border:1px solid var(--line,#e2e8f0);border-left:4px solid var(--pw-c,#6366f1);background:var(--card,#fff);transition:transform .12s,box-shadow .12s}
.pw-card:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(15,23,42,.08)}
.pw-card:focus-visible{outline:2px solid var(--pw-c,#6366f1);outline-offset:2px}
.pw-card.on{background:color-mix(in srgb,var(--pw-c,#6366f1) 10%,var(--card,#fff));border-color:var(--pw-c,#6366f1);box-shadow:0 0 0 2px color-mix(in srgb,var(--pw-c,#6366f1) 25%,transparent)}
.pw-card small{font-size:11.5px;font-weight:700;color:var(--muted,#64748b)}
.pw-card b{font-size:22px;line-height:1.15;font-variant-numeric:tabular-nums}
.pw-card span{font-size:11px;color:var(--muted,#94a3b8)}
.pw-tot{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:12px 0}
.pw-tot div{padding:8px 10px;border-radius:10px;background:var(--bg-subtle,#f1f5f9);text-align:center}
.pw-tot small{display:block;font-size:11px;font-weight:700;color:var(--muted,#64748b);text-transform:uppercase;letter-spacing:.04em}
.pw-tot b{font-size:17px;font-variant-numeric:tabular-nums}
.pw-ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:10px 0}
.pw-ctl label{display:flex;flex-direction:column;gap:2px;font-size:11.5px;font-weight:700;color:var(--muted,#64748b)}
.pw-ctl .input,.pw-ctl select{min-width:150px}
.pw-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:14px}
.pw-top ol{list-style:none;margin:0;padding:0}
.pw-top li{display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px dashed var(--line,#e2e8f0);cursor:pointer;font-size:13px}
.pw-top li:hover{background:var(--bg-subtle,#f1f5f9)}
.pw-top li:last-child{border:0}
.pw-top li i{font-style:normal;color:var(--muted,#94a3b8);font-size:11.5px;text-align:center}
.pw-top li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pw-top li em{font-style:normal;font-size:11px;color:var(--muted,#94a3b8);display:block}
.pw-top li b{font-variant-numeric:tabular-nums}
.pw-pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:800;white-space:nowrap}
.pw-pill.red{background:#fee2e2;color:#b91c1c}.pw-pill.amber{background:#fef3c7;color:#b45309}.pw-pill.green{background:#dcfce7;color:#15803d}.pw-pill.grey{background:#e2e8f0;color:#475569}.pw-pill.blue{background:#dbeafe;color:#1d4ed8}
.pw-note{font-size:12px;color:var(--muted,#64748b);margin:4px 0 0}
`;
    document.head.appendChild(st);
  }

  /** Segment definitions. `t(row, ctx)` decides membership. */
  function segments(hg) {
    const hasData = (r) => r.last > 0 || r.cur > 0;
    return [
      { grp: 'All', items: [
        { id: 'all', ic: '👥', l: 'All agents', c: '#6366f1', t: () => true },
        { id: 'attention', ic: '🚨', l: 'Needs attention', c: '#dc2626', hint: 'priority · inactive · zero stock · de-growth', t: (r) => r.pri === 'High' || r.pri === 'Medium' || r.inact >= 3 || r.stock === 0 || (r.g !== null && r.g < 0) || (r.last > 0 && r.cur === 0) }
      ] },
      { grp: 'Growth', items: [
        { id: 'growing', ic: '📈', l: 'Growing', c: '#16a34a', hint: 'growth above 0%', t: (r) => r.g !== null && r.g > 0 },
        { id: 'hiGrow', ic: '🚀', l: 'High growth', c: '#059669', hint: `growth ≥ +${hg}%`, t: (r) => r.g !== null && r.g >= hg },
        { id: 'flat', ic: '➡️', l: 'Flat', c: '#64748b', hint: 'growth exactly 0%', t: (r) => r.g === 0 && hasData(r) },
        { id: 'deGrow', ic: '📉', l: 'De-growth', c: '#ea580c', hint: 'growth below 0%', t: (r) => r.g !== null && r.g < 0 },
        { id: 'hiDe', ic: '🔻', l: 'High de-growth', c: '#dc2626', hint: `growth ≤ −${hg}%`, t: (r) => r.g !== null && r.g <= -hg },
        { id: 'new', ic: '🆕', l: 'New this month', c: '#0ea5e9', hint: 'no last month, issued this month', t: (r) => r.last <= 0 && r.cur > 0 }
      ] },
      { grp: 'Activity', items: [
        { id: 'active', ic: '🟢', l: 'Active today', c: '#16a34a', t: (r) => r.inact === 0 && r.cur > 0 },
        { id: 'in3', ic: '⏱️', l: 'Inactive 3+ days', c: '#f59e0b', t: (r) => r.inact >= 3 },
        { id: 'in7', ic: '⏳', l: 'Inactive 7+ days', c: '#ea580c', t: (r) => r.inact >= 7 },
        { id: 'in15', ic: '🛑', l: 'Inactive 15+ days', c: '#dc2626', t: (r) => r.inact >= 15 },
        { id: 'noMonth', ic: '😴', l: 'No issuance this month', c: '#b91c1c', hint: 'MTD = 0', t: (r) => r.cur <= 0 },
        { id: 'quiet', ic: '😶', l: 'Went quiet', c: '#9333ea', hint: 'issued last month, nothing this month', t: (r) => r.last > 0 && r.cur <= 0 },
        { id: 'in2m', ic: '💤', l: 'Inactive 2 months', c: '#475569', hint: 'no issuance last month and this month', t: (r) => r.last <= 0 && r.cur <= 0 }
      ] },
      { grp: 'Priority & stock', items: [
        { id: 'pHigh', ic: '🔺', l: 'High priority', c: '#dc2626', t: (r) => r.pri === 'High' },
        { id: 'pMed', ic: '🟡', l: 'Medium priority', c: '#f59e0b', t: (r) => r.pri === 'Medium' },
        { id: 'pLow', ic: '🟢', l: 'Low priority', c: '#16a34a', t: (r) => r.pri === 'Low' },
        { id: 'dispatch', ic: '🚚', l: 'Needs dispatch', c: '#0d9488', hint: 'High / Medium · not direct', t: (r) => !r.direct && (r.pri === 'High' || r.pri === 'Medium') },
        { id: 'zeroStock', ic: '0️⃣', l: 'Zero stock', c: '#b45309', t: (r) => r.stock === 0 },
        { id: 'idle', ic: '📦', l: 'Stock lying idle', c: '#7c3aed', hint: 'has stock, no issuance this month', t: (r) => r.stock > 0 && r.cur <= 0 },
        { id: 'direct', ic: '🚫', l: 'Direct agents', c: '#64748b', hint: 'no TL', t: (r) => r.direct }
      ] }
    ];
  }

  const SORTS = [
    ['cur', 'MTD issued'], ['last', 'Last month'], ['g', 'Growth %'], ['gain', 'Gain vs last month'], ['stock', 'Stock'],
    ['recent', 'Today / recent'], ['inact', 'Inactive days'], ['run', 'Run rate'], ['n', 'Name A–Z']
  ];
  const sortVal = (r, k) => (k === 'gain' ? (r.cur - r.last) : k === 'n' ? String(r.n || '').toLowerCase() : (r[k] === null || r[k] === undefined ? -Infinity : r[k]));

  const priPill = (p) => (p === 'High' ? '<span class="pw-pill red">High</span>' : p === 'Medium' ? '<span class="pw-pill amber">Medium</span>' : p === 'Low' ? '<span class="pw-pill green">Low</span>' : '<span class="dim">—</span>');
  const statusPill = (r) => {
    if (r.cur <= 0 && r.last <= 0) return '<span class="pw-pill grey">No issuance · 2 mo</span>';
    if (r.cur <= 0) return '<span class="pw-pill red">Inactive in month</span>';
    if (r.inact === 0) return '<span class="pw-pill green">Active</span>';
    if (r.inact >= 99) return '<span class="pw-pill red">Inactive in month</span>';
    return `<span class="pw-pill ${r.inact >= 7 ? 'red' : 'amber'}">${r.inact}d inactive</span>`;
  };
  const growthHtml = (r) => (r.g === null ? (r.last <= 0 && r.cur > 0 ? '<span class="pw-pill blue">New</span>' : '<span class="dim">—</span>') : U.deltaHtml(r.g, { decimals: 0 }));

  /**
   * mount(host, { ch, rows, months:{cur,last}, recentLabel, onAgent(row), onTl(name), title })
   */
  function mount(host, opts) {
    if (!host) return;
    ensureCss();
    const ch = opts.ch === 'gv' ? 'gv' : 'ff';
    const rows = (opts.rows || []).map((r) => ({
      ...r,
      last: Number(r.last) || 0, cur: Number(r.cur) || 0, stock: Number(r.stock) || 0, recent: Number(r.recent) || 0,
      g: r.g === null || r.g === undefined || Number.isNaN(Number(r.g)) ? null : Number(r.g),
      inact: r.inact === null || r.inact === undefined ? (Number(r.cur) > 0 ? 0 : 99) : Number(r.inact),
      run: Number(r.run) || 0, _k: norm(`${r.n} ${r.id} ${r.tl}`)
    }));
    const S = states[ch] || (states[ch] = { seg: 'all', q: '', tl: '', sort: 'cur', dir: 'desc', page: 1, hg: 25 });
    const pageSize = 50;
    const months = opts.months || { cur: 'MTD', last: 'Last month' };
    const tlNames = [...new Set(rows.filter((r) => !r.direct && r.tl).map((r) => r.tl))].sort((a, b) => a.localeCompare(b));
    const hasDirect = rows.some((r) => r.direct);

    const draw = () => {
      const groups = segments(S.hg);
      const flat = groups.flatMap((g) => g.items);
      const seg = flat.find((x) => x.id === S.seg) || flat[0];
      const counts = {}, sums = {};
      flat.forEach((x) => { counts[x.id] = 0; sums[x.id] = 0; });
      rows.forEach((r) => flat.forEach((x) => { if (x.t(r)) { counts[x.id]++; sums[x.id] += r.cur; } }));
      const qn = norm(S.q);
      let list = rows.filter((r) => seg.t(r));
      if (qn) list = list.filter((r) => qn.split(' ').every((t) => r._k.includes(t)));
      if (S.tl === '__direct__') list = list.filter((r) => r.direct);
      else if (S.tl) list = list.filter((r) => !r.direct && norm(r.tl) === norm(S.tl));
      const dir = S.dir === 'asc' ? 1 : -1;
      list = list.slice().sort((a, b) => {
        const x = sortVal(a, S.sort), y = sortVal(b, S.sort);
        if (x < y) return -dir; if (x > y) return dir;
        return b.cur - a.cur || String(a.n).localeCompare(String(b.n));
      });
      const pages = Math.max(1, Math.ceil(list.length / pageSize));
      if (S.page > pages) S.page = pages;
      const pageRows = list.slice((S.page - 1) * pageSize, S.page * pageSize);
      const T = list.reduce((a, r) => { a.last += r.last; a.cur += r.cur; a.stock += r.stock; a.recent += r.recent; return a; }, { last: 0, cur: 0, stock: 0, recent: 0 });
      const tg = T.last > 0 ? Math.round((T.cur / T.last - 1) * 100) : null;
      const th = (k, label, num) => `<th class="${num ? 'num' : ''} sortable ${S.sort === k ? 'sorted' : ''}" data-pw-sort="${k}" title="Sort">${esc(label)}${S.sort === k ? `<i>${S.dir === 'asc' ? '▲' : '▼'}</i>` : ''}</th>`;
      const body = pageRows.map((r) => `<tr class="clickable ${r.direct ? 'dispatch-direct' : ''}" data-pw-agent="${esc(String(r.ref === undefined ? r.n : r.ref))}">
        <td><b>${esc(r.n)}</b><small class="cell-sub">${esc(r.id || '')}</small></td>
        <td>${r.direct ? '<b class="direct-chip">🚫 Direct</b>' : (r.tl ? `<a href="#" data-pw-tl="${esc(r.tl)}">${esc(r.tl)}</a>` : '<span class="dim">—</span>')}</td>
        <td class="num">${nf(r.last)}</td><td class="num"><b>${nf(r.cur)}</b></td><td class="num">${growthHtml(r)}</td>
        <td class="num">${nf(r.cur - r.last) === '0' ? '0' : `<span class="${r.cur - r.last >= 0 ? 'up' : 'down'}">${r.cur - r.last > 0 ? '+' : ''}${nf(r.cur - r.last)}</span>`}</td>
        <td class="num">${nf(r.recent)}</td><td class="num">${nf(r.stock)}</td><td class="num">${r.run ? U.fmt(Math.round(r.run * 10) / 10) : '0'}</td>
        <td>${priPill(r.pri)}</td><td>${statusPill(r)}</td></tr>`).join('');
      const topCard = (title, html) => `<div class="card"><div class="card-head"><h3>${title}</h3></div>${html ? `<ol>${html}</ol>` : '<div class="empty">No data</div>'}</div>`;
      const tlOf = (r) => (r.direct ? 'Direct agent' : r.tl || '—');
      const gainFmt = (r) => { const d = r.cur - r.last; return `${d > 0 ? '+' : ''}${U.fmt(d)}`; };
      const scopeNote = seg.id === 'all' && !S.q && !S.tl ? 'all agents' : `${seg.l}${S.tl ? ' · ' + (S.tl === '__direct__' ? 'Direct agents' : S.tl) : ''}${S.q ? ' · “' + S.q + '”' : ''}`;
      const topLists = `<div class="pw-head" style="margin-top:14px"><h3>🏅 Top lists <span class="dim small">· within: ${esc(scopeNote)} (${nf(list.length)} agents)</span></h3></div><div class="pw-top">
        ${topCard('⭐ Top 10 · MTD issuance', list.filter((r) => r.cur > 0).slice().sort((a, b) => b.cur - a.cur).slice(0, 10).map((r, i) => `<li data-pw-agent="${esc(String(r.ref === undefined ? r.n : r.ref))}"><i>${i + 1}</i><span><b>${esc(r.n)}</b><em>${esc(tlOf(r))} · last ${nf(r.last)}</em></span><b>${nf(r.cur)}</b></li>`).join(''))}
        ${topCard('🚀 Top 10 · biggest gain vs last month', list.filter((r) => r.cur > r.last).slice().sort((a, b) => (b.cur - b.last) - (a.cur - a.last)).slice(0, 10).map((r, i) => `<li data-pw-agent="${esc(String(r.ref === undefined ? r.n : r.ref))}"><i>${i + 1}</i><span><b>${esc(r.n)}</b><em>${esc(tlOf(r))} · ${nf(r.last)} → ${nf(r.cur)}</em></span><b class="up">${gainFmt(r)}</b></li>`).join(''))}
        ${topCard('🔻 Top 10 · biggest drop vs last month', list.filter((r) => r.cur < r.last).slice().sort((a, b) => (a.cur - a.last) - (b.cur - b.last)).slice(0, 10).map((r, i) => `<li data-pw-agent="${esc(String(r.ref === undefined ? r.n : r.ref))}"><i>${i + 1}</i><span><b>${esc(r.n)}</b><em>${esc(tlOf(r))} · ${nf(r.last)} → ${nf(r.cur)}</em></span><b class="down">${gainFmt(r)}</b></li>`).join(''))}
        ${topCard('📦 Top 10 · stock in hand', list.filter((r) => r.stock > 0).slice().sort((a, b) => b.stock - a.stock).slice(0, 10).map((r, i) => `<li data-pw-agent="${esc(String(r.ref === undefined ? r.n : r.ref))}"><i>${i + 1}</i><span><b>${esc(r.n)}</b><em>${esc(tlOf(r))} · MTD ${nf(r.cur)}</em></span><b>${nf(r.stock)}</b></li>`).join(''))}
        ${topCard('😴 Top 10 · idle stock (no issuance)', list.filter((r) => r.stock > 0 && r.cur <= 0).slice().sort((a, b) => b.stock - a.stock).slice(0, 10).map((r, i) => `<li data-pw-agent="${esc(String(r.ref === undefined ? r.n : r.ref))}"><i>${i + 1}</i><span><b>${esc(r.n)}</b><em>${esc(tlOf(r))} · last month ${nf(r.last)}</em></span><b>${nf(r.stock)}</b></li>`).join(''))}
        ${topCard('🔺 Top 10 · most urgent dispatch', list.filter((r) => !r.direct && (r.pri === 'High' || r.pri === 'Medium')).slice().sort((a, b) => (a.pri === b.pri ? b.cur - a.cur : (a.pri === 'High' ? -1 : 1))).slice(0, 10).map((r, i) => `<li data-pw-agent="${esc(String(r.ref === undefined ? r.n : r.ref))}"><i>${i + 1}</i><span><b>${esc(r.n)}</b><em>${esc(tlOf(r))} · MTD ${nf(r.cur)} · stock ${nf(r.stock)}</em></span><b>${esc(r.pri)}</b></li>`).join(''))}
      </div>`;
      host.innerHTML = `<div class="card">
        <div class="pw-head"><h3>🔎 Performance watchlist <span class="dim small">· ${opts.title || (ch === 'gv' ? 'GV Partner' : 'First Forward')} · ${nf(rows.length)} agents${opts.allCount && opts.allCount > rows.length ? ` <b>(page filters on · ${nf(opts.allCount)} total)</b>` : ''}</span></h3>
          <label class="small dim">High / de-growth threshold <select data-pw-hg>${[25, 50, 100].map((v) => `<option value="${v}" ${S.hg === v ? 'selected' : ''}>±${v}%</option>`).join('')}</select></label></div>
        ${groups.map((g) => `<div class="pw-group">${esc(g.grp)}</div><div class="pw-seg">${g.items.map((x) => `<button type="button" class="pw-card ${x.id === seg.id ? 'on' : ''}" style="--pw-c:${x.c}" data-pw-seg="${x.id}" title="${esc(x.hint || x.l)}"><small>${x.ic} ${esc(x.l)}</small><b>${nf(counts[x.id])}</b><span>${x.hint ? esc(x.hint) : `MTD ${nf(sums[x.id])}`}</span></button>`).join('')}</div>`).join('')}
      </div>
      <div class="card">
        <div class="pw-head"><h3>${seg.ic} ${esc(seg.l)} <span class="dim small">· ${nf(list.length)} of ${nf(rows.length)} agents</span></h3>
          <div class="btn-row">${FF.auth && FF.auth.can && FF.auth.can('export') ? '<button class="btn small" data-pw-csv>⬇ CSV</button>' : ''}${seg.id !== 'all' || S.q || S.tl ? '<button class="btn small" data-pw-clear>✕ Show all</button>' : ''}</div></div>
        <div class="pw-ctl">
          <label>Search <input class="input" data-pw-q placeholder="Agent / ID / TL" value="${esc(S.q)}"></label>
          <label>TL <select data-pw-tl><option value="">All TLs</option>${hasDirect ? `<option value="__direct__" ${S.tl === '__direct__' ? 'selected' : ''}>🚫 Direct agents</option>` : ''}${tlNames.map((t) => `<option value="${esc(t)}" ${norm(S.tl) === norm(t) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label>Sort by <select data-pw-sortsel>${SORTS.map(([k, l]) => `<option value="${k}" ${S.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Order <select data-pw-dir><option value="desc" ${S.dir === 'desc' ? 'selected' : ''}>High → Low</option><option value="asc" ${S.dir === 'asc' ? 'selected' : ''}>Low → High</option></select></label>
        </div>
        <div class="pw-tot"><div><small>Agents</small><b>${nf(list.length)}</b></div><div><small>${esc(months.last)}</small><b>${nf(T.last)}</b></div><div><small>${esc(months.cur)} (MTD)</small><b>${nf(T.cur)}</b></div><div><small>Growth</small><b>${tg === null ? '—' : U.deltaHtml(tg, { decimals: 0 })}</b></div><div><small>${esc(opts.recentLabel || 'Today')}</small><b>${nf(T.recent)}</b></div><div><small>Stock</small><b>${nf(T.stock)}</b></div></div>
        <div class="table-wrap tall"><table class="tbl compact"><thead><tr>${th('n', 'Agent')}<th>TL</th>${th('last', months.last, true)}${th('cur', `${months.cur} (MTD)`, true)}${th('g', 'Growth', true)}${th('gain', 'Gain / drop', true)}${th('recent', opts.recentLabel || 'Today', true)}${th('stock', 'Stock', true)}${th('run', 'Run / day', true)}<th>Priority</th>${th('inact', 'Status')}</tr></thead>
          <tbody>${body || '<tr><td colspan="11" class="empty">No agents in this segment.</td></tr>'}</tbody>
          <tfoot><tr class="row-total"><td>Total (${nf(list.length)})</td><td></td><td class="num">${nf(T.last)}</td><td class="num">${nf(T.cur)}</td><td class="num">${tg === null ? '—' : `${tg > 0 ? '+' : ''}${tg}%`}</td><td class="num">${T.cur - T.last > 0 ? '+' : ''}${nf(T.cur - T.last)}</td><td class="num">${nf(T.recent)}</td><td class="num">${nf(T.stock)}</td><td></td><td></td><td></td></tr></tfoot></table></div>
        <div class="pager"><button class="btn small" data-pw-pg="prev" ${S.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${S.page} / ${nf(pages)}</span><button class="btn small" data-pw-pg="next" ${S.page >= pages ? 'disabled' : ''}>Next ›</button></div>
        <p class="pw-note">Growth = projected month-end vs last month. High growth ≥ +${S.hg}% · high de-growth ≤ −${S.hg}%. Inactive days come from the sheet / EIR last-issue date.</p>
      </div>${topLists}`;
      host.__list = list;
    };

    if (!host.__pwBound) {
      host.__pwBound = true;
      host.addEventListener('click', (e) => {
        const o = host.__opts, St = host.__S;
        const seg = e.target.closest('[data-pw-seg]');
        if (seg) { St.seg = seg.dataset.pwSeg; St.page = 1; host.__draw(); return; }
        const sortTh = e.target.closest('[data-pw-sort]');
        if (sortTh) { const k = sortTh.dataset.pwSort; if (St.sort === k) St.dir = St.dir === 'asc' ? 'desc' : 'asc'; else { St.sort = k; St.dir = k === 'n' ? 'asc' : 'desc'; } host.__draw(); return; }
        const pg = e.target.closest('[data-pw-pg]');
        if (pg) { St.page += pg.dataset.pwPg === 'next' ? 1 : -1; host.__draw(); return; }
        if (e.target.closest('[data-pw-clear]')) { St.seg = 'all'; St.q = ''; St.tl = ''; St.page = 1; host.__draw(); return; }
        if (e.target.closest('[data-pw-csv]')) {
          const list = host.__list || [];
          const header = ['Agent', 'ID', 'TL', o.months.last, `${o.months.cur} (MTD)`, 'Growth %', 'Gain / drop', o.recentLabel || 'Today', 'Stock', 'Run / day', 'Priority', 'Status'];
          const data = list.map((r) => [r.n, r.id || '', r.direct ? 'Direct agent' : r.tl || '', r.last, r.cur, r.g === null ? '' : r.g, r.cur - r.last, r.recent, r.stock, r.run ? Math.round(r.run * 10) / 10 : 0, r.pri || '', r.cur <= 0 && r.last <= 0 ? 'No issuance · 2 months' : r.cur <= 0 ? 'Inactive in month' : r.inact === 0 ? 'Active' : r.inact >= 99 ? 'Inactive in month' : `${r.inact} days inactive`]);
          U.downloadCsv(`${o.ch}-watchlist-${St.seg}-${U.stamp()}.csv`, header, data);
          U.toast(`${U.fmt(data.length)} agents exported`, 'ok');
          return;
        }
        const tl = e.target.closest('[data-pw-tl]');
        if (tl) { e.preventDefault(); e.stopPropagation(); if (o.onTl) o.onTl(tl.dataset.pwTl); return; }
        const ag = e.target.closest('[data-pw-agent]');
        if (ag && o.onAgent) { o.onAgent(ag.dataset.pwAgent); }
      });
      host.addEventListener('change', (e) => {
        const St = host.__S;
        if (e.target.matches('[data-pw-tl]')) { St.tl = e.target.value; St.page = 1; host.__draw(); }
        else if (e.target.matches('[data-pw-sortsel]')) { St.sort = e.target.value; St.dir = St.sort === 'n' ? 'asc' : 'desc'; host.__draw(); }
        else if (e.target.matches('[data-pw-dir]')) { St.dir = e.target.value; host.__draw(); }
        else if (e.target.matches('[data-pw-hg]')) { St.hg = Number(e.target.value) || 25; St.page = 1; host.__draw(); }
      });
      host.addEventListener('input', U.debounce((e) => {
        if (!e.target.matches('[data-pw-q]')) return;
        const St = host.__S; St.q = e.target.value; St.page = 1; host.__draw();
        const inp = host.querySelector('[data-pw-q]');
        if (inp) { inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) { /* ignore */ } }
        if (St.q && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('Performance Watchlist', St.q);
      }, 250));
    }
    host.__opts = { ...opts, ch, months };
    host.__S = S;
    host.__draw = draw;
    draw();
  }

  FF.perfWatch = { mount };
})(window.FF);
