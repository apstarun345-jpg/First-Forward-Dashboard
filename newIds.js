/* 🆕 New IDs — EIR me issuance karne wale agents jinki ID Agent master (Sheet4 col A) me nahi hai.
   Name · ID · Assistant ID · month-wise issuance count. Excel me export karo → naye agent Sheet4 me daalo →
   refresh karte hi wo list se hat jate hain. Source: GET /api/new-ids (server EIR − Sheet4). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const state = { data: null, q: '', sort: 'last', busy: false };
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ymLabel = (ym) => { const [y, m] = String(ym).split('-'); return `${MN[Number(m) - 1] || m} ${String(y).slice(2)}`; };

  function visible() {
    const d = state.data; if (!d) return [];
    const q = state.q.trim().toLowerCase();
    let rows = d.rows.filter((r) => !q || [r.name, r.id, r.legacyId, r.assistId, r.assistName].some((v) => String(v || '').toLowerCase().includes(q)));
    if (state.sort === 'total') rows = rows.slice().sort((a, b) => b.total - a.total);
    else if (state.sort === 'name') rows = rows.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return rows;
  }
  function exportXlsx() {
    const d = state.data, rows = visible(); if (!d) return;
    const header = ['Agent Name', 'Agent ID', 'Legacy ID', 'Assistant ID', 'Assistant Name', ...d.months.map(ymLabel), 'Total'];
    const body = rows.map((r) => [r.name, r.id, r.legacyId, r.assistId, r.assistName, ...d.months.map((m) => r.months[m] || 0), r.total]);
    FF.xlsx.download(`new-agent-ids-${U.stamp()}.xlsx`, [{ name: 'New IDs', header, rows: body }]);
  }
  function paint() {
    const root = state.root; if (!root) return;
    const mount = root.querySelector('[data-nid-body]'); if (!mount) return;
    const d = state.data;
    if (!d) { mount.innerHTML = `<div class="card"><div class="card-body dim">${state.err ? `❌ ${esc(state.err)}` : '⏳ EIR aur Sheet4 match ho raha hai… (pehli baar 10-30 sec)'}</div></div>`; return; }
    const rows = visible(), s = d.summary || {};
    const months = d.months.slice(-6);
    mount.innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-v">${U.fmt(s.count)}</div><div class="kpi-l">🆕 New agents (Sheet4 me nahi)</div></div>
        <div class="kpi"><div class="kpi-v">${U.fmt(s.tags)}</div><div class="kpi-l">Total tags issued</div></div>
        <div class="kpi"><div class="kpi-v">${U.fmt(s.activeThisMonth)}</div><div class="kpi-l">Is mahine active${s.curYm ? ` (${esc(ymLabel(s.curYm))})` : ''}</div></div>
        <div class="kpi"><div class="kpi-v">${U.fmt(s.newThisMonth)}</div><div class="kpi-l">Is mahine pehli baar</div></div>
      </div>
      <div class="card"><div class="card-body">
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
          <input class="input" data-nid-q placeholder="Search name / ID / assistant" value="${esc(state.q)}" style="max-width:260px">
          <select class="input" data-nid-sort style="max-width:190px"><option value="last"${state.sort === 'last' ? ' selected' : ''}>Latest active pehle</option><option value="total"${state.sort === 'total' ? ' selected' : ''}>Zyada issuance pehle</option><option value="name"${state.sort === 'name' ? ' selected' : ''}>Name A→Z</option></select>
          <button class="btn primary" data-nid-xlsx>⬇️ Excel</button>
          <button class="btn" data-nid-refresh>🔄 Refresh</button>
          <span class="dim small">${U.fmt(rows.length)} agents · Sheet4 me ${U.fmt(d.registryCount)} IDs · ${esc(new Date(d.at).toLocaleTimeString('en-IN'))}</span>
        </div>
        <div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>#</th><th>Agent name</th><th>Agent ID</th><th>Assistant ID</th><th>Assistant</th>${months.map((m) => `<th class="num">${esc(ymLabel(m))}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>${rows.slice(0, 500).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name || '—')}</td><td class="mono">${esc(r.id)}</td><td class="mono">${esc(r.assistId || '—')}</td><td>${esc(r.assistName || '—')}</td>${months.map((m) => `<td class="num">${r.months[m] ? U.fmt(r.months[m]) : '·'}</td>`).join('')}<td class="num"><b>${U.fmt(r.total)}</b></td></tr>`).join('') || `<tr><td colspan="${6 + months.length}" class="dim">🎉 Koi new ID nahi — sab Sheet4 me hain.</td></tr>`}</tbody></table></div>
        ${rows.length > 500 ? `<p class="dim small">Pehle 500 dikh rahe hain — baaki Excel me.</p>` : ''}
        <p class="dim small">Months: pichhle 6 table me, poora month-wise Excel me. Sheet4 me entry karte hi ID list se hat jaati hai (🔄 Refresh).</p>
      </div></div>`;
  }
  async function load(fresh) {
    if (state.busy) return; state.busy = true; state.err = '';
    try {
      for (let i = 0; i < 12; i++) {
        const out = await FF.auth.api(`/api/new-ids${fresh ? '?fresh=1' : ''}`);
        if (out && !out.pending) { state.data = out; break; }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!state.data) state.err = 'Abhi load ho raha hai — thodi der baad Refresh dabao.';
    } catch (e) { state.err = e && e.message ? e.message : 'Load nahi hua'; }
    state.busy = false; paint();
  }
  function render(root) {
    state.root = root;
    root.innerHTML = `<div class="page nid-page"><div class="page-head"><div><h1>🆕 New IDs</h1>
      <p class="sub">EIR me jin agents ne tags issue kiye par <b>Agent master (Sheet4)</b> me nahi hain — name, ID, assistant ID aur month-wise issuance. Admin Sheet4 ka link Settings → Data source me badal sakta hai.</p></div></div>
      <div data-nid-body></div></div>`;
    paint();
    root.addEventListener('input', (e) => { if (e.target.matches('[data-nid-q]')) { state.q = e.target.value; const p = e.target.selectionStart; paint(); const q = root.querySelector('[data-nid-q]'); if (q) { q.focus(); try { q.setSelectionRange(p, p); } catch { /* ignore */ } } } });
    root.addEventListener('change', (e) => { if (e.target.matches('[data-nid-sort]')) { state.sort = e.target.value; paint(); } });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-nid-xlsx]')) exportXlsx();
      if (e.target.closest('[data-nid-refresh]')) { const mount = root.querySelector('[data-nid-body]'); if (mount) mount.insertAdjacentHTML('afterbegin', '<p class="dim small">⏳ Refresh ho raha hai…</p>'); load(true); }
    });
    load(false);
  }
  FF.pages.newIds = { title: 'New IDs', render };
})(window.FF);
