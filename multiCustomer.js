/* 👥 Multiple Customer ID (v3.125.77) — Cross Channel.
   EIR LEGACY_CUSTOMER_ID × month → tags count + issuing agent. Agent naam EIR me khaali ho to GV Master
   (tag ID / VRN) se agent ID · naam · channel. Header click = sort (asc / desc), channel filter, CSV.
   Total par click → us customer ke saare tag-level EIR rows (drawer + CSV). Source: /api/multi-customer. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ymLabel = (ym) => { const [y, m] = String(ym).split('-'); return `${MN[Number(m) - 1] || m} ${String(y).slice(2)}`; };
  const PAGE = 300;
  const state = { root: null, data: null, err: '', busy: false, q: '', ch: '', min: 2, sort: { key: 'total', dir: 'desc' }, shown: PAGE, sel: new Set() };

  // ------------------------------------------------------------------ filter + sort
  function visible() {
    const d = state.data; if (!d) return [];
    const q = state.q.trim().toLowerCase();
    let rows = d.rows.filter((r) => r.total >= state.min
      && (!state.ch || (state.ch === 'none' ? !r.agentName : r.channel === state.ch))
      && (!q || [r.id, r.agentName, r.agentId, r.tlName].some((v) => String(v || '').toLowerCase().includes(q))));
    const { key, dir } = state.sort, sgn = dir === 'asc' ? 1 : -1;
    const val = (r) => (key.startsWith('m:') ? (r.months[key.slice(2)] || 0) : r[key]);
    rows = rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * sgn;
      return String(x || '').localeCompare(String(y || ''), 'en', { numeric: true }) * sgn;
    });
    return rows;
  }

  // ------------------------------------------------------------------ CSV
  const csvCell = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  function downloadCsv(name, header, rows) {
    // Lambi IDs (18 digit) Excel me kharab na hon → ="…" format.
    const fix = (v) => (/^\d{12,}$/.test(String(v || '')) ? `="${v}"` : v);
    const text = [header, ...rows].map((r) => r.map((v) => csvCell(fix(v))).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function summaryCsv(only) {
    const d = state.data, rows = only || visible(); if (!d) return;
    const header = ['Legacy Customer ID', ...d.months.map(ymLabel), 'Total tags', 'Agent name', 'Agent ID', 'TL name', 'Channel', 'Agent source', 'Agents count'];
    const body = rows.map((r) => [r.id, ...d.months.map((m) => r.months[m] || 0), r.total, r.agentName, r.agentId, r.tlName || '', r.channel, r.source, r.agents]);
    const tot = ['TOTAL', ...d.months.map((m) => U.sum(rows, (r) => r.months[m] || 0)), U.sum(rows, (r) => r.total), '', '', '', '', '', ''];
    downloadCsv(`multiple-customer-id-${U.stamp ? U.stamp() : Date.now()}.csv`, header, [...body, tot]);
  }
  const TAG_HEAD = ['Legacy Customer ID', 'Customer', 'Tag ID', 'VRN', 'Class', 'Issue date', 'Month', 'Type', 'Status', 'Agent ID', 'Agent name', 'TL name', 'Channel', 'Agent source'];
  const dShort = (t) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t.iso || ''); return m ? `${m[3]} ${MN[Number(m[2]) - 1]} ${m[1]}` : (t.date || ''); };
  const tagRow = (t) => [t.customerId, t.customer, t.tagId, t.vrn, t.cls, dShort(t), t.ym ? ymLabel(t.ym) : '', t.type, t.status, t.agentId, t.agentName, t.tlName || '', t.channel, t.agentSource || ''];
  async function fetchTags(ids) { const out = await FF.auth.api('/api/multi-customer/tags', 'POST', { ids }); return (out && out.rows) || []; }
  async function tagCsvAll(btn, opts) {
    const o = opts || {};
    const src = o.rows || visible();
    const rows = (o.ym ? src.filter((r) => r.months[o.ym]) : src).slice(0, 1200);
    if (!rows.length) { U.toast('Koi customer nahi', 'warn'); return; }
    const all = [];
    const label = btn.textContent;
    try {
      btn.disabled = true;
      for (let i = 0; i < rows.length; i += 40) {
        btn.textContent = `⏳ ${Math.min(i + 40, rows.length)} / ${rows.length}`;
        const part = await fetchTags(rows.slice(i, i + 40).map((r) => r.id));
        all.push(...part);
      }
      const keep = o.ym ? all.filter((t) => t.ym === o.ym) : all;
      downloadCsv(`multiple-customer-eir-tags${o.ym ? '-' + o.ym : ''}${o.tag ? '-' + o.tag : ''}-${U.stamp ? U.stamp() : Date.now()}.csv`, TAG_HEAD, keep.map(tagRow));
      U.toast(`${U.fmt(keep.length)} tags download hue`, 'ok');
      if (src.length > rows.length) U.toast(`Pehle ${rows.length} customers ke tags download hue — filter laga kar baaki lo`, 'warn');
    } catch (err) { U.toast(String((err && err.message) || err), 'err'); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  // ------------------------------------------------------------------ drawer: one customer's tags
  async function openCustomer(id) {
    const r = state.data && state.data.rows.find((x) => x.id === id);
    const title = `Customer ${id}`;
    const open = (body) => { if (FF.app && FF.app.openDrawer) FF.app.openDrawer({ kicker: '👥 Multiple Customer ID', title, sub: r ? `${U.fmt(r.total)} tags · ${esc(r.agentName || 'agent naam nahi')} · ${esc(r.channel)}` : '', body }); };
    open(U.spinner ? U.spinner('EIR se tags aa rahe hain…') : 'Loading…');
    try {
      const tags = await fetchTags([id]);
      const body = `<div class="mc-drawer-bar"><button class="btn small primary" data-mc-tagcsv="${esc(id)}">⬇ CSV</button><span class="dim small">${U.fmt(tags.length)} tags</span></div>
        <div class="table-wrap mc-dwrap"><table class="tbl compact mc-tbl mc-dtbl"><thead><tr>${['Tag ID', 'VRN', 'Class', 'Issue date', 'Type', 'Status', 'Agent name', 'Agent ID', 'TL name', 'Channel'].map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${tags.map((t) => `<tr><td class="mono">${esc(t.tagId)}</td><td class="mono">${esc(t.vrn)}</td><td><span class="cg-tag cg-${esc(String(t.cls).toLowerCase().replace(/[^a-z0-9]/g, ''))}">${esc(t.cls || '—')}</span></td><td>${esc(dShort(t))}</td><td>${esc(t.type)}</td><td>${esc(t.status)}</td><td>${t.agentName ? esc(t.agentName) : '<span class="dim">—</span>'}${t.agentSource === 'GV Master' ? ' <small class="mc-src" title="EIR me naam khaali tha — GV Master se mila">GV Master</small>' : ''}</td><td class="mono">${esc(t.agentId || '—')}</td><td>${t.tlName ? esc(t.tlName) : '<span class="dim">—</span>'}</td><td>${chBadge(t.channel)}</td></tr>`).join('')}</tbody></table></div>`;
      open(body);
      state.lastTags = { id, tags };
    } catch (err) { open(`<p class="dim">❌ ${esc((err && err.message) || err)}</p>`); }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-mc-tagcsv]');
    if (!b || !state.lastTags || state.lastTags.id !== b.dataset.mcTagcsv) return;
    downloadCsv(`customer-${b.dataset.mcTagcsv}-tags.csv`, TAG_HEAD, state.lastTags.tags.map(tagRow));
  });

  // ------------------------------------------------------------------ render
  const chBadge = (c) => {
    const k = c === 'GV' ? 'gv' : c === 'FF' ? 'ff' : c === 'FF + GV' ? 'both' : 'none';
    return `<span class="mc-ch mc-ch-${k}">${esc(c || '—')}</span>`;
  };
  function headCell(key, label, num) {
    const on = state.sort.key === key;
    const arrow = on ? (state.sort.dir === 'asc' ? '▲' : '▼') : '⇅';
    return `<th class="${num ? 'num ' : ''}mc-sort${on ? ' on' : ''}" data-mc-sort="${esc(key)}" title="Click = sort">${label} <i>${arrow}</i></th>`;
  }
  function paint() {
    const mount = state.root && state.root.querySelector('[data-mc-body]'); if (!mount) return;
    const d = state.data;
    if (!d) {
      mount.innerHTML = `<div class="card"><div class="card-body dim">${state.err ? `❌ ${esc(state.err)}` : `⏳ EIR se customers jode ja rahe hain + GV Master se agent dhoondhe ja rahe hain… (pehli baar 1-3 min)${state.progress ? ` · <b>${esc(state.progress)}</b>` : ''}`}</div></div>`;
      return;
    }
    const rows = visible(), s = d.summary || {};
    const months = d.months;
    const tile = (cls, v, l) => `<div class="mc-tile ${cls}"><b>${v}</b><small>${l}</small></div>`;
    const totals = months.map((m) => U.sum(rows, (r) => r.months[m] || 0));
    mount.innerHTML = `
      <div class="mc-tiles">
        ${tile('t1', U.fmt(s.customers), 'Customers (2+ tags)')}
        ${tile('t2', U.fmt(s.tags), 'Total tags (EIR)')}
        ${tile('t3', U.fmt(s.gvResolved), 'Agent GV Master se mila')}
        ${tile('t4', U.fmt(s.blankLeft), 'Agent naam nahi mila')}
      </div>
      <div class="card"><div class="card-body">
        <div class="mc-bar">
          <input class="input" data-mc-q placeholder="Customer ID / agent name / ID" value="${esc(state.q)}">
          <select class="input" data-mc-ch>
            ${[['', 'Sab channel'], ['FF', '🟦 FF'], ['GV', '🟩 GV'], ['FF + GV', '🔗 FF + GV'], ['none', '❔ Agent naam nahi']].map(([v, l]) => `<option value="${v}"${state.ch === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <select class="input" data-mc-min>
            ${[2, 3, 5, 10, 20, 50].map((n) => `<option value="${n}"${state.min === n ? ' selected' : ''}>${n}+ tags</option>`).join('')}
          </select>
          <button class="btn primary" data-mc-csv>⬇ CSV (summary)</button>
          <button class="btn" data-mc-tagall>⬇ EIR tag-level CSV</button>
          <button class="btn" data-mc-refresh>🔄 Refresh</button>
          ${state.sel.size ? `<span class="mc-selbar"><b>${U.fmt(state.sel.size)} selected</b><button class="btn small primary" data-mc-seltags>⬇ Selected tags CSV</button><button class="btn small" data-mc-selsum>⬇ Selected summary CSV</button><button class="btn small" data-mc-selclear>✕ Clear</button></span>` : ''}
          <span class="dim small">${U.fmt(rows.length)} customers · ${U.fmt(U.sum(rows, (r) => r.total))} tags · ${esc(new Date(d.at).toLocaleTimeString('en-IN'))}</span>
        </div>
        ${d.gvError ? `<p class="small" style="color:#b45309">⚠️ GV Master lookup: ${esc(d.gvError)}</p>` : ''}
        <div class="table-wrap mc-wrap"><table class="tbl compact mc-tbl">
          <thead><tr><th class="mc-chk"><input type="checkbox" data-mc-all title="Sab (dikhne wale) select" ${rows.length && rows.slice(0, state.shown).every((r) => state.sel.has(r.id)) ? 'checked' : ''}></th><th>#</th>${headCell('id', 'Legacy Customer ID')}${months.map((m) => headCell(`m:${m}`, esc(ymLabel(m)), true)).join('')}${headCell('total', 'Total', true)}${headCell('agentName', 'Agent name')}${headCell('agentId', 'Agent ID')}${headCell('tlName', 'TL name')}${headCell('channel', 'Channel')}${headCell('source', 'Source')}</tr></thead>
          <tbody>${rows.slice(0, state.shown).map((r, i) => `<tr class="${state.sel.has(r.id) ? 'mc-on' : ''}"><td class="mc-chk"><input type="checkbox" data-mc-pick="${esc(r.id)}" ${state.sel.has(r.id) ? 'checked' : ''}></td><td class="dim">${i + 1}</td><td class="mono">${esc(r.id)}</td>${months.map((m) => `<td class="num">${r.months[m] ? U.fmt(r.months[m]) : '<span class="dim">·</span>'}</td>`).join('')}<td class="num"><button type="button" class="mc-total" data-mc-open="${esc(r.id)}" title="Tags dekho">${U.fmt(r.total)}</button></td><td>${r.agentName ? esc(r.agentName) : '<span class="dim">—</span>'}${r.agents > 1 ? ` <small class="mc-more" title="Is customer ke tags ${r.agents} agents ne issue kiye">+${r.agents - 1}</small>` : ''}</td><td class="mono">${esc(r.agentId || '—')}</td><td>${r.tlName ? esc(r.tlName) : '<span class="dim">—</span>'}</td><td>${chBadge(r.channel)}</td><td class="small dim">${esc(r.source)}</td></tr>`).join('')}</tbody>
          <tfoot><tr class="mc-foot"><td></td><td></td><td>Total <small class="dim">click = CSV</small></td>${totals.map((t, i) => `<td class="num">${t ? `<button type="button" class="mc-ftot" data-mc-ym="${esc(months[i])}" title="${esc(ymLabel(months[i]))} ke saare tags — CSV">${U.fmt(t)}</button>` : '0'}</td>`).join('')}<td class="num"><button type="button" class="mc-ftot all" data-mc-ym="" title="Saare tags — CSV">${U.fmt(U.sum(rows, (r) => r.total))}</button></td><td colspan="5"></td></tr></tfoot>
        </table></div>
        ${rows.length > state.shown ? `<div style="text-align:center;margin-top:10px"><button class="btn" data-mc-more>⬇ Aur ${U.fmt(Math.min(PAGE, rows.length - state.shown))} dikhao (${U.fmt(rows.length - state.shown)} baaki)</button></div>` : ''}
        <p class="dim small" style="margin-top:8px">Total par click = us customer ke saare EIR tags. Agent: EIR ka issuing agent (sabse zyada tags wala); naam khaali ho to GV Master (Tag ID / VRN) se.</p>
      </div></div>`;
    if (FF.app && FF.app.enhanceTables) { /* custom sort chahiye — global enhancer nahi */ }
  }
  async function load(fresh) {
    if (state.busy) return; state.busy = true; state.err = '';
    try {
      for (let i = 0; i < 150; i++) {
        const out = await FF.auth.api(`/api/multi-customer${fresh && i === 0 ? '?fresh=1' : ''}`);
        if (out && !out.pending) { state.data = out; break; }
        state.progress = (out && out.progress) || '';
        paint();
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!state.data) state.err = 'Abhi ban raha hai — thodi der baad 🔄 Refresh dabao.';
    } catch (e) { state.err = (e && e.message) || 'Load nahi hua'; }
    state.busy = false; paint();
  }
  function render(root) {
    state.root = root; state.shown = PAGE;
    root.innerHTML = `<div class="page mc-page"><div class="page-head"><div><h1>👥 Multiple Customer ID</h1>
      <p class="sub">EIR ke <b>LEGACY_CUSTOMER_ID</b> jinke <b>2+ tags</b> hain — month-wise count, issuing agent (EIR, ya GV Master se Tag ID / VRN), channel. Header click = sort.</p></div></div>
      <div data-mc-body></div></div>`;
    paint();
    root.addEventListener('input', (e) => {
      if (!e.target.matches('[data-mc-q]')) return;
      state.q = e.target.value; state.shown = PAGE;
      clearTimeout(state.qt); state.qt = setTimeout(() => { const pos = e.target.selectionStart; paint(); const inp = root.querySelector('[data-mc-q]'); if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch { /* ignore */ } } }, 250);
    });
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-mc-pick]')) { const id = e.target.dataset.mcPick; if (e.target.checked) state.sel.add(id); else state.sel.delete(id); paint(); return; }
      if (e.target.matches('[data-mc-all]')) { visible().slice(0, state.shown).forEach((r) => { if (e.target.checked) state.sel.add(r.id); else state.sel.delete(r.id); }); paint(); return; }
      if (e.target.matches('[data-mc-ch]')) { state.ch = e.target.value; state.shown = PAGE; paint(); }
      if (e.target.matches('[data-mc-min]')) { state.min = Number(e.target.value) || 2; state.shown = PAGE; paint(); }
    });
    root.addEventListener('click', (e) => {
      const th = e.target.closest('[data-mc-sort]');
      if (th) { const k = th.dataset.mcSort; state.sort = state.sort.key === k ? { key: k, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: /^(id|agentName|agentId|channel|source)$/.test(k) ? 'asc' : 'desc' }; paint(); return; }
      const op = e.target.closest('[data-mc-open]'); if (op) { openCustomer(op.dataset.mcOpen); return; }
      const ft = e.target.closest('[data-mc-ym]'); if (ft) { tagCsvAll(ft, { ym: ft.dataset.mcYm || '' }); return; }
      const selRows = () => (state.data ? state.data.rows.filter((r) => state.sel.has(r.id)) : []);
      const st = e.target.closest('[data-mc-seltags]'); if (st) { tagCsvAll(st, { rows: selRows(), tag: 'selected' }); return; }
      if (e.target.closest('[data-mc-selsum]')) { summaryCsv(selRows()); return; }
      if (e.target.closest('[data-mc-selclear]')) { state.sel.clear(); paint(); return; }
      if (e.target.closest('[data-mc-more]')) { state.shown += PAGE; paint(); return; }
      if (e.target.closest('[data-mc-csv]')) { summaryCsv(); return; }
      const ta = e.target.closest('[data-mc-tagall]'); if (ta) { tagCsvAll(ta); return; }
      if (e.target.closest('[data-mc-refresh]')) { state.data = null; paint(); load(true); }
    });
    load(false);
  }
  FF.pages.multiCustomer = { title: 'Multiple Customer ID', render };
})(window.FF);
