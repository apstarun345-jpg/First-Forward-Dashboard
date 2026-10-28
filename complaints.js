/* 📨 Agents Complaints Summary — bank POS-complaint mails (Gmail) → colourful table with status.
   Server keeps the current month fresh in the background (Settings → Agents Complaints → refresh minutes), so this page
   just reads the ready cache: GET /api/complaints?from&to. Older months are fetched from Gmail on demand.
   Status: Pending · Solved by <you> (you replied) · Solved by Bank (bank debited / refunded / closed) · Solved by Team. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const ymd = (d) => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 10); };
  const today = () => ymd(new Date());
  const monthStart = (d) => `${String(d).slice(0, 7)}-01`;
  const state = {
    root: null, data: null, busy: false, err: '', tab: 'list',
    from: '', to: '', status: 'all', tl: '', agent: '', q: '', sort: 'date', dir: -1, timer: null, req: 0
  };
  state.from = monthStart(today()); state.to = today();

  const STATUS_CLS = (s) => (/^pending/i.test(s) ? 'pend' : /bank/i.test(s) ? 'bank' : /team/i.test(s) ? 'team' : 'me');
  const rupee = (n) => (n ? `₹${U.fmt(n)}` : '—');
  const when = (ms) => { if (!ms) return '—'; try { return new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return '—'; } };
  const dayLabel = (iso) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; } };
  const ageText = (r) => {
    const end = r.status === 'Pending' ? Date.now() : (r.resolvedAt || Date.now());
    const h = Math.max(0, Math.round((end - r.date) / 3600e3));
    return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
  };
  const rowsAll = () => (state.data && state.data.rows) || [];
  const statuses = () => [...new Set(rowsAll().map((r) => r.status))];

  function visible() {
    const q = state.q.trim().toLowerCase();
    let rows = rowsAll().filter((r) => {
      if (state.status === 'tat') { if (!r.tatBreached) return false; } else if (state.status !== 'all' && r.status !== state.status) return false;
      if (state.tl && (r.tlName || '— not found —') !== state.tl) return false;
      if (state.agent && `${r.agentName}|${r.agentId}` !== state.agent) return false;
      if (q && ![r.caseNo, r.vrn, r.tagId, r.description, r.bcName, r.agentName, r.agentId, r.tlName, r.tlId, r.status].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const key = state.sort, dir = state.dir;
    rows = rows.slice().sort((a, b) => {
      const x = a[key], y = b[key];
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x || '').localeCompare(String(y || ''), 'en', { numeric: true });
      return c * dir || b.date - a.date;
    });
    return rows;
  }

  function kpis(rows) {
    const by = {}; rows.forEach((r) => { by[r.status] = (by[r.status] || 0) + 1; });
    const ded = rows.reduce((t, r) => t + (r.deducted || 0), 0);
    const tat = rows.filter((r) => r.tatBreached).length;
    return { total: rows.length, by, ded, tat };
  }

  function tilesHtml() {
    const all = rowsAll(), k = kpis(all);
    const owner = (state.data && state.data.meta && state.data.meta.config && state.data.meta.config.ownerName) || 'Tarun';
    const tile = (cls, label, val, key, sub) => `<button type="button" class="cmp-tile cmp-${cls}${state.status === key ? ' on' : ''}" data-cmp-status="${esc(key)}"><span>${esc(label)}</span><b>${val}</b>${sub ? `<em>${sub}</em>` : ''}</button>`;
    return `<div class="cmp-tiles">
      ${tile('all', 'All complaints', U.fmt(k.total), 'all', `${dayLabel(state.from)} → ${dayLabel(state.to)}`)}
      ${tile('pend', 'Pending', U.fmt(k.by['Pending'] || 0), 'Pending', 'no reply · bank not closed')}
      ${tile('me', `Solved by ${esc(owner)}`, U.fmt(k.by[`Solved by ${owner}`] || 0), `Solved by ${owner}`, 'you replied')}
      ${tile('bank', 'Solved by Bank', U.fmt(k.by['Solved by Bank'] || 0), 'Solved by Bank', k.ded ? `deducted ${rupee(k.ded)}` : 'bank closed / refunded')}
      ${k.by['Solved by Team'] ? tile('team', 'Solved by Team', U.fmt(k.by['Solved by Team']), 'Solved by Team', 'teammate replied') : ''}
      ${tile('tat', 'TAT breached', U.fmt(k.tat), 'tat', 'pending past TAT')}
    </div>`;
  }

  function filtersHtml() {
    const rows = rowsAll();
    const tls = [...new Set(rows.map((r) => r.tlName || '— not found —'))].sort((a, b) => a.localeCompare(b));
    const agents = [...new Map(rows.map((r) => [`${r.agentName}|${r.agentId}`, r])).values()].sort((a, b) => String(a.agentName).localeCompare(String(b.agentName)));
    const chip = (id, label) => `<button type="button" class="chip" data-cmp-quick="${id}">${label}</button>`;
    return `<div class="cmp-filters card"><div class="card-body">
      <div class="cmp-frow">
        <label>📅 From <input type="date" class="input" data-cmp-from value="${esc(state.from)}" max="${today()}"></label>
        <label>To <input type="date" class="input" data-cmp-to value="${esc(state.to)}" max="${today()}"></label>
        <div class="cmp-quick">${chip('today', 'Today')}${chip('7d', 'Last 7 days')}${chip('month', 'This month')}${chip('last', 'Last month')}${chip('90d', 'Last 90 days')}</div>
      </div>
      <div class="cmp-frow">
        <label>Status <select class="input" data-cmp-statussel><option value="all">All</option>${statuses().map((s) => `<option value="${esc(s)}"${state.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}<option value="tat"${state.status === 'tat' ? ' selected' : ''}>TAT breached</option></select></label>
        <label>TL <select class="input" data-cmp-tl><option value="">All TLs</option>${tls.map((t) => `<option value="${esc(t)}"${state.tl === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Agent <select class="input" data-cmp-agent><option value="">All agents</option>${agents.map((a) => `<option value="${esc(`${a.agentName}|${a.agentId}`)}"${state.agent === `${a.agentName}|${a.agentId}` ? ' selected' : ''}>${esc(a.agentName || '—')} · ${esc(a.agentId || '—')}</option>`).join('')}</select></label>
        <label class="cmp-search">Search <input class="input" data-cmp-q placeholder="Case · VRN · Tag · agent · TL · description" value="${esc(state.q)}"></label>
        <button type="button" class="btn small" data-cmp-clear>✖ Clear</button>
      </div></div></div>`;
  }

  const TH = [['date', 'Date'], ['caseNo', 'Case Number'], ['vrn', 'Vehicle Registration Number'], ['tagId', 'Tag Id'], ['description', 'Description'], ['bcName', 'BC Name'], ['agentName', 'Agent Name'], ['agentId', 'Agent ID'], ['tlName', 'TL Name'], ['tlId', 'TL ID'], ['status', 'Status'], ['deducted', 'Deducted'], ['date', 'Age']];
  function listHtml(rows) {
    if (!rows.length) return '<div class="empty">No complaints found for these filters.</div>';
    const head = TH.map(([k, l], i) => `<th class="cmp-th${state.sort === k && i < 12 ? ' on' : ''}" data-cmp-sort="${k}" title="Sort">${l}${state.sort === k && i < 12 ? (state.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('');
    const body = rows.map((r, i) => `<tr class="cmp-r-${STATUS_CLS(r.status)}${r.tatBreached ? ' cmp-tat' : ''}">
      <td class="cmp-d"><b>${esc(dayLabel(r.day))}</b><small>${esc(when(r.date))}</small></td>
      <td class="cmp-case"><a href="${esc(r.link)}" target="_blank" rel="noopener" title="Open the mail in Gmail">${esc(r.caseNo || '—')}</a></td>
      <td class="mono cmp-c">${esc(r.vrn || '—')}</td>
      <td class="mono cmp-tag">${esc(r.tagId || '—')}</td>
      <td class="cmp-desc">${esc(r.description || '—')}</td>
      <td class="cmp-c">${esc(r.bcName || '—')}</td>
      <td><b>${esc(r.agentName || '—')}</b></td>
      <td class="mono cmp-c">${esc(r.agentId || '—')}</td>
      <td>${r.tlName ? `<b>${esc(r.tlName)}</b>` : '<span class="dim">—</span>'}</td>
      <td class="mono cmp-c">${esc(r.tlId || '—')}</td>
      <td class="cmp-st"><span class="cmp-pill cmp-${STATUS_CLS(r.status)}" title="${esc(r.bankNote || '')}">${esc(r.status)}</span>${r.resolvedAt ? `<small>${esc(when(r.resolvedAt))}</small>` : (r.tatBreached ? '<small class="cmp-late">TAT breached</small>' : `<small>TAT ${esc(when(r.tatDueAt))}</small>`)}</td>
      <td class="num cmp-ded">${r.deducted ? `<b>${rupee(r.deducted)}</b>` : '—'}</td>
      <td class="num cmp-age">${esc(ageText(r))}</td></tr>`).join('');
    return `<div class="table-wrap cmp-wrap"><table class="tbl cmp-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function groupHtml(rows, by) {
    const m = new Map();
    rows.forEach((r) => {
      const key = by === 'tl' ? (r.tlName || '— not found —') : `${r.agentName || '—'}|${r.agentId || ''}`;
      const g = m.get(key) || { key, name: by === 'tl' ? key : (r.agentName || '—'), id: by === 'tl' ? (r.tlId || '') : r.agentId, tl: r.tlName, total: 0, pend: 0, me: 0, bank: 0, team: 0, ded: 0, tat: 0 };
      g.total++; g.ded += r.deducted || 0; if (r.tatBreached) g.tat++;
      const c = STATUS_CLS(r.status); g[c]++;
      m.set(key, g);
    });
    const list = [...m.values()].sort((a, b) => b.pend - a.pend || b.total - a.total);
    if (!list.length) return '<div class="empty">No complaints found for these filters.</div>';
    const owner = (state.data && state.data.meta && state.data.meta.config && state.data.meta.config.ownerName) || 'Tarun';
    return `<div class="table-wrap cmp-wrap"><table class="tbl cmp-tbl cmp-sum"><thead><tr><th>#</th><th>${by === 'tl' ? 'TL' : 'Agent'}</th><th>ID</th>${by === 'agent' ? '<th>TL</th>' : ''}<th class="num">Total</th><th class="num">Pending</th><th class="num">Solved by ${esc(owner)}</th><th class="num">Solved by Bank</th><th class="num">Solved by Team</th><th class="num">TAT breached</th><th class="num">Deducted</th></tr></thead><tbody>${list.map((g, i) => `<tr><td class="dim">${i + 1}</td><td><button type="button" class="smap-link" data-cmp-pick="${by}" data-key="${esc(g.key)}"><b>${esc(g.name)}</b></button></td><td class="mono cmp-c">${esc(g.id || '—')}</td>${by === 'agent' ? `<td>${esc(g.tl || '—')}</td>` : ''}<td class="num"><b>${g.total}</b></td><td class="num">${g.pend ? `<span class="cmp-pill cmp-pend">${g.pend}</span>` : 0}</td><td class="num">${g.me || 0}</td><td class="num">${g.bank || 0}</td><td class="num">${g.team || 0}</td><td class="num">${g.tat ? `<span class="cmp-late">${g.tat}</span>` : 0}</td><td class="num">${g.ded ? `<b>${rupee(g.ded)}</b>` : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function metaLine() {
    const m = state.data && state.data.meta;
    if (!m) return '';
    const c = m.config || {};
    const t = m.okAt ? new Date(m.okAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
    const err = m.error ? `<span class="cmp-err">⚠ ${esc(m.error)}</span>` : '';
    return `<p class="dim small cmp-meta">${m.running ? '⏳ Syncing with Gmail… · ' : ''}Last Gmail sync <b>${esc(t)}</b> · auto-refresh every <b>${esc(c.refreshMin || 10)} min</b> · subjects: ${(c.subjects || []).map((s) => `<code>${esc(s)}</code>`).join(' ')}${m.account ? ` · mailbox ${esc(m.account)}` : ''}${c.enabled === false ? ' · <b>auto-refresh is OFF</b>' : ''} ${err}</p>`;
  }

  function exportXlsx() {
    const rows = visible();
    const header = ['Date', 'Case Number', 'Vehicle Registration Number', 'Tag Id', 'Description', 'BC Name', 'Agent Name', 'Agent ID', 'TL Name', 'TL ID', 'Status', 'Replied at', 'Resolved at', 'Deducted (₹)', 'Bank note', 'TAT breached', 'Mail link'];
    const iso = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '');
    const body = rows.map((r) => [iso(r.date), r.caseNo, r.vrn, r.tagId, r.description, r.bcName, r.agentName, r.agentId, r.tlName, r.tlId, r.status, iso(r.repliedAt), iso(r.resolvedAt), r.deducted || '', r.bankNote, r.tatBreached ? 'Yes' : '', r.link]);
    FF.xlsx.download(`agents-complaints-${state.from}_${state.to}-${U.stamp()}.xlsx`, [{ name: 'Complaints', header, rows: body }]);
  }

  function paint() {
    const root = state.root; if (!root) return;
    const mount = root.querySelector('[data-cmp-body]'); if (!mount) return;
    const keepQ = root.querySelector('[data-cmp-q]');
    const hadFocus = keepQ && document.activeElement === keepQ; const pos = hadFocus ? keepQ.selectionStart : 0;
    const rows = visible();
    const tabs = `<div class="seg cmp-tabs"><button type="button" class="seg-btn${state.tab === 'list' ? ' on' : ''}" data-cmp-tab="list">📋 Complaints</button><button type="button" class="seg-btn${state.tab === 'agent' ? ' on' : ''}" data-cmp-tab="agent">👤 By agent</button><button type="button" class="seg-btn${state.tab === 'tl' ? ' on' : ''}" data-cmp-tab="tl">👥 By TL</button></div>`;
    const err = state.err ? `<div class="notice err">${esc(state.err)}</div>` : '';
    const loading = state.busy ? '<p class="dim small">⏳ Loading… (older months are read from Gmail, this can take up to a minute)</p>' : '';
    mount.innerHTML = `${metaLine()}${err}${loading}${state.data ? tilesHtml() + filtersHtml() : ''}
      ${state.data ? `<div class="cmp-bar">${tabs}<span class="dim small">${U.fmt(rows.length)} of ${U.fmt(rowsAll().length)} complaints</span><span class="cmp-bar-r"><button type="button" class="btn small" data-cmp-refresh>🔄 Sync Gmail now</button><button type="button" class="btn small primary" data-cmp-xlsx>⬇ Excel</button></span></div>
      <div class="card"><div class="card-body cmp-card">${state.tab === 'list' ? listHtml(rows) : groupHtml(rows, state.tab)}</div></div>` : (state.busy ? U.spinner('Reading complaints…') : '')}`;
    if (hadFocus) { const q = root.querySelector('[data-cmp-q]'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch { /* ignore */ } } }
  }

  async function load(opts) {
    const my = ++state.req;
    state.busy = true; state.err = ''; paint();
    try {
      const d = await FF.auth.api(`/api/complaints?from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}`);
      if (my !== state.req) return;
      state.data = d;
      if (d && d.meta && d.meta.error && !(d.rows || []).length) state.err = d.meta.error;
    } catch (e) { if (my === state.req) state.err = (e && e.message) || 'Could not load complaints'; }
    if (my === state.req) { state.busy = false; paint(); }
    void opts;
  }
  async function syncNow(btn) {
    await U.withButtonBusy(btn, async () => {
      try {
        const r = await FF.auth.api('/api/complaints/refresh', 'POST', {});
        if (r && r.ok === false) { state.err = r.error || 'Gmail sync failed'; paint(); return; }
        await load();
      } catch (e) { state.err = (e && e.message) || 'Gmail sync failed'; paint(); }
    }, 'Syncing…');
  }
  function quick(id) {
    const t = today(), d = new Date();
    if (id === 'today') { state.from = t; state.to = t; }
    else if (id === '7d') { d.setDate(d.getDate() - 6); state.from = ymd(d); state.to = t; }
    else if (id === 'month') { state.from = monthStart(t); state.to = t; }
    else if (id === 'last') { const f = new Date(d.getFullYear(), d.getMonth() - 1, 1), l = new Date(d.getFullYear(), d.getMonth(), 0); state.from = ymd(f); state.to = ymd(l); }
    else if (id === '90d') { d.setDate(d.getDate() - 89); state.from = ymd(d); state.to = t; }
    state.tl = ''; state.agent = '';
    load();
  }

  function render(root) {
    state.root = root;
    root.innerHTML = `<div class="page cmp-page"><div class="page-head"><div><h1>📨 Agents Complaints Summary</h1>
      <p class="sub">Bank POS-complaint mails from Gmail — case, VRN, tag, agent, TL and status. The current month refreshes in the background; pick any date range to look back.</p></div></div>
      <div data-cmp-body></div></div>`;
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-cmp-from]')) { if (t.value) { state.from = t.value; if (state.to < state.from) state.to = state.from; load(); } return; }
      if (t.matches('[data-cmp-to]')) { if (t.value) { state.to = t.value; if (state.from > state.to) state.from = state.to; load(); } return; }
      if (t.matches('[data-cmp-statussel]')) { state.status = t.value; paint(); return; }
      if (t.matches('[data-cmp-tl]')) { state.tl = t.value; paint(); return; }
      if (t.matches('[data-cmp-agent]')) { state.agent = t.value; paint(); }
    });
    root.addEventListener('input', (e) => { if (e.target.matches('[data-cmp-q]')) { state.q = e.target.value; paint(); } });
    root.addEventListener('click', (e) => {
      const t = e.target;
      const tile = t.closest('[data-cmp-status]'); if (tile) { state.status = state.status === tile.dataset.cmpStatus ? 'all' : tile.dataset.cmpStatus; paint(); return; }
      const qk = t.closest('[data-cmp-quick]'); if (qk) { quick(qk.dataset.cmpQuick); return; }
      const tab = t.closest('[data-cmp-tab]'); if (tab) { state.tab = tab.dataset.cmpTab; paint(); return; }
      const so = t.closest('[data-cmp-sort]'); if (so) { const k = so.dataset.cmpSort; state.dir = state.sort === k ? -state.dir : (k === 'date' || k === 'deducted' ? -1 : 1); state.sort = k; paint(); return; }
      const pick = t.closest('[data-cmp-pick]'); if (pick) { if (pick.dataset.cmpPick === 'tl') { state.tl = pick.dataset.key; state.agent = ''; } else { state.agent = pick.dataset.key; } state.tab = 'list'; paint(); return; }
      if (t.closest('[data-cmp-clear]')) { state.status = 'all'; state.tl = ''; state.agent = ''; state.q = ''; paint(); return; }
      if (t.closest('[data-cmp-xlsx]')) { exportXlsx(); return; }
      const rf = t.closest('[data-cmp-refresh]'); if (rf) syncNow(rf);
    });
    load();
    // background cache is refreshed by the server; the page just re-reads it quietly every minute
    clearInterval(state.timer);
    state.timer = setInterval(async () => {
      if (!state.root || !state.root.isConnected) { clearInterval(state.timer); return; }
      if (document.hidden || state.busy) return;
      const ae = document.activeElement; if (ae && state.root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;   // user is typing / picking
      try { const d = await FF.auth.api(`/api/complaints?from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}`); if (state.root.isConnected) { state.data = d; paint(); } } catch { /* keep last data */ }
    }, 60000);
  }
  FF.pages.complaints = { title: 'Agents Complaints Summary', render };
})(window.FF);
