/* 🆕 New IDs — EIR me issuance karne wale agents jinki ID Agent master (Sheet4 col A) me nahi hai.
   Name · ID · Assistant ID · month-wise issuance count. Excel me export karo → naye agent Sheet4 me daalo →
   refresh karte hi wo list se hat jate hain. Source: GET /api/new-ids (server EIR − Sheet4). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const state = { data: null, q: '', sort: 'last', busy: false, tab: 'new', sq: '', sres: null, sbusy: false, serr: '' };
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
  function searchHtml() {
    const res = state.sres;
    const rows = [];
    if (res) res.results.forEach((r) => {
      if (!r.matches.length) rows.push(`<tr><td class="mono">${esc(r.term)}</td><td colspan="6" class="dim">❌ Sheet4 me nahi mila</td></tr>`);
      r.matches.forEach((m, i) => rows.push(`<tr><td class="mono">${i ? '' : esc(r.term)}</td><td class="mono">${esc(m.id || '—')}</td><td>${esc(m.name || '—')}</td><td class="mono">${esc(m.tlId || '—')}</td><td>${esc(m.tlName || '—')}</td><td class="mono dim">${esc(m.newId || '—')}</td></tr>`));
      if (r.more) rows.push(`<tr><td></td><td colspan="5" class="dim">+${r.more} aur match — search chhota/exact karo</td></tr>`);
    });
    return `<div class="card"><div class="card-body">
      <p class="dim small">Kai Agent ID ya naam ek saath daalo (line / comma se alag). ID exact match hoti hai (Agent ID, New Agent ID ya TL ID), naam me "contains" search.</p>
      <textarea class="input mono" data-nid-sq rows="4" style="width:100%" placeholder="20354013&#10;6108274&#10;rohit panthi">${esc(state.sq)}</textarea>
      <div class="row" style="gap:8px;margin-top:8px;align-items:center"><button class="btn primary" data-nid-search>🔎 Search Sheet4</button>${res ? `<button class="btn" data-nid-sxlsx>⬇️ Excel</button><span class="dim small">${U.fmt(res.results.length)} search · Sheet4 me ${U.fmt(res.total)} rows</span>` : ''}${state.sbusy ? '<span class="dim small">⏳ search ho raha hai…</span>' : ''}</div>
      ${state.serr ? `<p style="color:#b91c1c">❌ ${esc(state.serr)}</p>` : ''}
      ${res ? `<div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Searched</th><th>Agent ID</th><th>Name</th><th>TL ID</th><th>TL Name</th><th>New Agent ID</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : ''}
    </div></div>`;
  }
  async function runSearch() {
    const ta = state.root.querySelector('[data-nid-sq]'); if (ta) state.sq = ta.value;
    if (!state.sq.trim()) { state.serr = 'ID ya naam daalo.'; return paint(); }
    state.sbusy = true; state.serr = ''; paint();
    try { state.sres = await FF.auth.api('/api/agent-master-search', 'POST', { terms: state.sq.split(/[\n,;\t]+/).map((x) => x.trim()).filter(Boolean) }); }
    catch (e) { state.serr = e && e.message ? e.message : 'Search fail'; }
    state.sbusy = false; paint();
  }
  function searchXlsx() {
    if (!state.sres) return;
    const body = [];
    state.sres.results.forEach((r) => { if (!r.matches.length) body.push([r.term, '', 'NOT FOUND', '', '', '']); r.matches.forEach((m) => body.push([r.term, m.id, m.name, m.tlId, m.tlName, m.newId])); });
    FF.xlsx.download(`sheet4-search-${U.stamp()}.xlsx`, [{ name: 'Sheet4', header: ['Searched', 'Agent ID', 'Name', 'TL ID', 'TL Name', 'New Agent ID'], rows: body }]);
  }
  function paint() {
    const root = state.root; if (!root) return;
    const mount = root.querySelector('[data-nid-body]'); if (!mount) return;
    const tabs = `<div class="seg" style="margin-bottom:12px"><button type="button" class="seg-btn${state.tab === 'new' ? ' on' : ''}" data-nid-tab="new">🆕 New IDs</button><button type="button" class="seg-btn${state.tab === 'search' ? ' on' : ''}" data-nid-tab="search">🔎 Sheet4 search</button></div>`;
    if (state.tab === 'search') { mount.innerHTML = tabs + searchHtml(); return; }
    paintNew(mount, tabs);
  }
  function paintNew(mount, tabs) {
    const d = state.data;
    if (!d) { mount.innerHTML = tabs + `<div class="card"><div class="card-body dim">${state.err ? `❌ ${esc(state.err)}` : '⏳ EIR aur Sheet4 match ho raha hai… (pehli baar 10-30 sec)'}</div></div>`; return; }
    const rows = visible(), s = d.summary || {};
    const months = d.months.slice(-6);
    mount.innerHTML = tabs + `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div style="flex:1 1 180px;padding:14px 16px;border-radius:14px;background:var(--card,#fff);border:1px solid rgba(99,102,241,.25);box-shadow:0 1px 4px rgba(0,0,0,.06)"><div style="font-size:26px;font-weight:800;color:#1e3a8a">${U.fmt(s.count)}</div><div style="font-size:13px;color:#475569;margin-top:2px">🆕 New agents (Sheet4 me nahi)</div></div>
        <div style="flex:1 1 180px;padding:14px 16px;border-radius:14px;background:var(--card,#fff);border:1px solid rgba(99,102,241,.25);box-shadow:0 1px 4px rgba(0,0,0,.06)"><div style="font-size:26px;font-weight:800;color:#1e3a8a">${U.fmt(s.tags)}</div><div style="font-size:13px;color:#475569;margin-top:2px">Total tags issued</div></div>
        <div style="flex:1 1 180px;padding:14px 16px;border-radius:14px;background:var(--card,#fff);border:1px solid rgba(99,102,241,.25);box-shadow:0 1px 4px rgba(0,0,0,.06)"><div style="font-size:26px;font-weight:800;color:#1e3a8a">${U.fmt(s.activeThisMonth)}</div><div style="font-size:13px;color:#475569;margin-top:2px">Is mahine active${s.curYm ? ` (${esc(ymLabel(s.curYm))})` : ''}</div></div>
        <div style="flex:1 1 180px;padding:14px 16px;border-radius:14px;background:var(--card,#fff);border:1px solid rgba(99,102,241,.25);box-shadow:0 1px 4px rgba(0,0,0,.06)"><div style="font-size:26px;font-weight:800;color:#1e3a8a">${U.fmt(s.newThisMonth)}</div><div style="font-size:13px;color:#475569;margin-top:2px">Is mahine pehli baar</div></div>
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
    root.addEventListener('input', (e) => { if (e.target.matches('[data-nid-sq]')) state.sq = e.target.value; if (e.target.matches('[data-nid-q]')) { state.q = e.target.value; const p = e.target.selectionStart; paint(); const q = root.querySelector('[data-nid-q]'); if (q) { q.focus(); try { q.setSelectionRange(p, p); } catch { /* ignore */ } } } });
    root.addEventListener('change', (e) => { if (e.target.matches('[data-nid-sort]')) { state.sort = e.target.value; paint(); } });
    root.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-nid-tab]'); if (tb) { state.tab = tb.dataset.nidTab; paint(); return; }
      if (e.target.closest('[data-nid-search]')) { runSearch(); return; }
      if (e.target.closest('[data-nid-sxlsx]')) { searchXlsx(); return; }
      if (e.target.closest('[data-nid-xlsx]')) exportXlsx();
      if (e.target.closest('[data-nid-refresh]')) { const mount = root.querySelector('[data-nid-body]'); if (mount) mount.insertAdjacentHTML('afterbegin', '<p class="dim small">⏳ Refresh ho raha hai…</p>'); load(true); }
    });
    load(false);
  }
  FF.pages.newIds = { title: 'New IDs', render };
})(window.FF);
