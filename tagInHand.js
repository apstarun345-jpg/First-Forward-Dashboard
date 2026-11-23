/* 🏷️ Tag In Hand — bank mail "Tag In Hand Dated DD-MM-YYYY-AN01-Apna Payment" ki attachment (password-protected .xls) ka data, mahine-wise ek table.
   FF = file me agent id/name hai · GV = blank (GV Master se tag id par ek baar lookup). TL name / TL mail / Remark editable,
   date-wise bulk mail (GV → set ki hui GV mail, FF → TL ki mail). Server: /api/tih (tih-mail.js). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const CSS = `
  .tih{padding:0 0 24px}
  .tih-hero{margin:0 0 12px;padding:16px 18px;border-radius:16px;color:#fff;background:linear-gradient(120deg,#4f46e5,#7c3aed 45%,#db2777);display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;box-shadow:0 8px 24px rgba(79,70,229,.25)}
  .tih-hero h2{margin:0;font-size:20px}.tih-hero p{margin:2px 0 0;opacity:.9;font-size:12.5px}
  .tih-kpis{display:flex;gap:8px;flex-wrap:wrap}
  .tih-k{background:rgba(255,255,255,.18);backdrop-filter:blur(4px);border-radius:12px;padding:6px 12px;min-width:74px;text-align:center}
  .tih-k b{display:block;font-size:20px;font-variant-numeric:tabular-nums}.tih-k small{font-size:11px;opacity:.9}
  .tih-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}
  .tih-bar select,.tih-bar input[type=search],.tih-bar input[type=text]{padding:7px 10px;border:1px solid var(--line,#cbd5e1);border-radius:10px;background:var(--card,#fff);color:inherit;font-size:13px}
  .tih-seg{display:inline-flex;border:1px solid var(--line,#cbd5e1);border-radius:10px;overflow:hidden}
  .tih-seg button{border:0;background:var(--card,#fff);padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer;color:inherit}
  .tih-seg button.on{color:#fff}.tih-seg button[data-ch="all"].on{background:#4f46e5}.tih-seg button[data-ch="gv"].on{background:#16a34a}.tih-seg button[data-ch="ff"].on{background:#2563eb}
  .tih-btn{border:0;border-radius:10px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer;background:#e0e7ff;color:#3730a3}
  .tih-btn.pri{background:linear-gradient(120deg,#4f46e5,#db2777);color:#fff}.tih-btn.ok{background:#16a34a;color:#fff}.tih-btn:disabled{opacity:.5;cursor:default}
  .tih-send{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;margin:0 0 10px;border-radius:14px;border:1px dashed #a5b4fc;background:color-mix(in srgb,#6366f1 6%,var(--card,#fff))}
  .tih-send b{color:#4338ca}
  .tih-wrap{overflow:auto;border-radius:14px;border:1px solid var(--line,#e2e8f0);background:var(--card,#fff);max-height:70vh}
  table.tih-t{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px}
  .tih-t th{position:sticky;top:0;z-index:2;background:linear-gradient(120deg,#4338ca,#7c3aed);color:#fff;text-align:left;padding:9px 10px;white-space:nowrap;font-size:12px;cursor:pointer}
  .tih-t td{padding:6px 10px;border-bottom:1px solid var(--line,#e2e8f0);vertical-align:middle}
  .tih-t tr.d0 td{background:var(--card,#fff)}.tih-t tr.d1 td{background:color-mix(in srgb,#6366f1 5%,var(--card,#fff))}
  .tih-t tr:hover td{background:color-mix(in srgb,#f59e0b 10%,var(--card,#fff))}
  .tih-ch{display:inline-block;padding:2px 9px;border-radius:999px;font-weight:800;font-size:11px}
  .tih-ch.gv{background:#dcfce7;color:#166534}.tih-ch.ff{background:#dbeafe;color:#1e40af}
  .tih-day{font-weight:800;color:#4338ca;white-space:nowrap}
  .tih-vrn{font-weight:800;letter-spacing:.02em}.tih-tag{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#475569}
  .tih-rs{display:inline-block;padding:2px 8px;border-radius:8px;background:#ffedd5;color:#9a3412;font-size:11.5px;font-weight:700}
  .tih-ag small{display:block;color:var(--muted,#64748b);font-size:11px}
  .tih-src{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:6px;margin-left:4px}
  .tih-src.gv{background:#dcfce7;color:#166534}.tih-src.miss{background:#fee2e2;color:#b91c1c}.tih-src.wait{background:#fef3c7;color:#92400e}
  .tih-tl{font-weight:700;color:#7c3aed}
  .tih-in{width:100%;min-width:130px;padding:4px 7px;border:1px solid var(--line,#cbd5e1);border-radius:8px;background:var(--card,#fff);color:inherit;font-size:12px}
  .tih-in.saved{border-color:#16a34a;box-shadow:0 0 0 2px rgba(22,163,74,.2)}
  .tih-mb{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap}
  .tih-mb.y{background:#dcfce7;color:#166534}.tih-mb.n{background:#f1f5f9;color:#64748b}
  .tih-set{margin:0 0 12px;padding:12px 14px;border:1px solid #c7d2fe;border-radius:14px;background:color-mix(in srgb,#6366f1 5%,var(--card,#fff));display:grid;gap:10px}
  .tih-set label{display:grid;gap:3px;font-size:12px;font-weight:700;color:#4338ca}.tih-set input{padding:7px 10px;border:1px solid var(--line,#cbd5e1);border-radius:8px;background:var(--card,#fff);color:inherit;font-size:13px;font-weight:400}
  .tih-note{font-size:12px;color:var(--muted,#64748b)}.tih-err{color:#b91c1c;font-weight:700;font-size:12.5px}
  .tih-empty{padding:30px;text-align:center;color:var(--muted,#64748b)}
  html[data-theme="dark"] .tih-ch,html[data-theme="dark"] .tih-rs,html[data-theme="dark"] .tih-src,html[data-theme="dark"] .tih-mb{filter:brightness(.92)}
  @media(max-width:700px){.tih-hero h2{font-size:17px}.tih-t{font-size:12px}}
  `;
  const st = { root: null, data: null, busy: false, err: '', ch: 'all', month: '', day: '', q: '', sort: 'day', dir: -1, sel: new Set(), setOpen: false, msg: '', timer: null };
  const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : iso || '—');
  const mlabel = (m) => { try { return new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); } catch { return m; } };
  const css = () => { if (document.getElementById('tih-css')) return; const s = document.createElement('style'); s.id = 'tih-css'; s.textContent = CSS; document.head.appendChild(s); };
  const isAdmin = () => !!(st.data && st.data.admin);

  function filtered() {
    const q = st.q.trim().toLowerCase();
    let rows = ((st.data && st.data.rows) || []).filter((r) => (st.ch === 'all' || r.ch === st.ch) && (!st.month || (r.day || '').startsWith(st.month)) && (!st.day || r.day === st.day));
    if (q) rows = rows.filter((r) => [r.vrn, r.tagId, r.reason, r.agentId, r.agentName, r.tlName, r.remark].join(' ').toLowerCase().includes(q));
    const k = st.sort, d = st.dir;
    rows = rows.slice().sort((a, b) => { const x = String(a[k] || ''), y = String(b[k] || ''); return x < y ? -d : x > y ? d : 0; });
    return rows;
  }
  const daysOf = () => [...new Set(((st.data && st.data.rows) || []).filter((r) => !st.month || (r.day || '').startsWith(st.month)).map((r) => r.day).filter(Boolean))].sort().reverse();

  function head() {
    const all = ((st.data && st.data.rows) || []).filter((r) => !st.month || (r.day || '').startsWith(st.month));
    const ff = all.filter((r) => r.ch === 'ff').length, gv = all.length - ff, gvMiss = all.filter((r) => r.ch === 'gv' && r.src !== 'gv').length, sent = all.filter((r) => r.sentAt).length;
    const k = (n, l) => `<div class="tih-k"><b>${U.fmt(n)}</b><small>${l}</small></div>`;
    return `<div class="tih-hero"><div><h2>🏷️ Tag In Hand</h2><p>Bank ki "Tag In Hand Dated…" mail ki attachment · mahine-wise · FF / GV alag${st.data ? ` · ${st.data.meta.mails} mails padhi` : ''}</p></div><div class="tih-kpis">${k(all.length, 'Total tags')}${k(ff, 'FF')}${k(gv, 'GV')}${gvMiss ? k(gvMiss, 'GV agent nahi mila') : ''}${k(sent, 'Mail gayi')}</div></div>`;
  }
  function bar() {
    const d = st.data; if (!d) return '';
    const months = d.months || [];
    return `<div class="tih-bar">
      <div class="tih-seg">${['all', 'gv', 'ff'].map((c) => `<button data-ch="${c}" class="${st.ch === c ? 'on' : ''}">${c === 'all' ? 'All' : c === 'gv' ? '🟩 GV' : '🟦 FF'}</button>`).join('')}</div>
      <select data-f="month"><option value="">Sab mahine (${months.length})</option>${months.map((m) => `<option value="${m}" ${st.month === m ? 'selected' : ''}>${esc(mlabel(m))}</option>`).join('')}</select>
      <select data-f="day"><option value="">Sab dates</option>${daysOf().map((x) => `<option value="${x}" ${st.day === x ? 'selected' : ''}>${dmy(x)}</option>`).join('')}</select>
      <input type="search" data-f="q" placeholder="VRN / Tag / agent / TL / remark…" value="${esc(st.q)}">
      <button class="tih-btn" data-act="refresh" ${st.busy ? 'disabled' : ''}>${st.busy ? '⏳ Mail padh raha…' : '🔄 Refresh'}</button>
      <button class="tih-btn" data-act="csv">⬇ CSV</button>
      ${isAdmin() ? '<button class="tih-btn" data-act="set">⚙ Mail settings</button>' : ''}
      <span class="tih-note">${d.meta.pending ? `⏳ ${d.meta.pending} mail abhi padhni baaki` : ''} ${d.meta.error ? `<span class="tih-err">⚠ ${esc(d.meta.error)}</span>` : ''} ${d.meta.gvErr ? `<span class="tih-err">GV lookup: ${esc(d.meta.gvErr)}</span>` : ''}</span></div>`;
  }
  function settings() {
    if (!st.setOpen || !isAdmin()) return '';
    const c = st.data.cfg;
    const tls = [...new Set(((st.data.rows) || []).filter((r) => r.ch === 'ff' && r.tlName).map((r) => r.tlName))].sort();
    return `<div class="tih-set"><b>⚙ Mail settings</b>
      <label>🟩 GV ki report is mail par jaye (comma se alag)<input type="text" data-c="gvTo" value="${esc(c.gvTo)}" placeholder="gv-team@example.com"></label>
      <label>CC — GV (optional)<input type="text" data-c="gvCc" value="${esc(c.gvCc)}"></label>
      <label>CC — FF TL mails (optional)<input type="text" data-c="ffCc" value="${esc(c.ffCc)}"></label>
      <label>Kitne mahine ki mail leni hain (1–12)<input type="text" data-c="months" value="${esc(c.months)}" style="max-width:90px"></label>
      <div><button class="tih-btn pri" data-act="saveset">💾 Save</button> <button class="tih-btn" data-act="gvretry" title="GV Master me jo tag nahi mile unhe dobara dhundo">🔁 GV missing dobara dhundo</button> <span class="tih-note">${esc(st.msg)}</span></div>
      <div class="tih-note">TL ki mail table ke "TL mail" column me ek baar daalo — wahi TL ke har tag par lag jaati hai${tls.length ? ` (${tls.length} TL)` : ''}.</div></div>`;
  }
  function sendBar() {
    if (!st.data || !isAdmin()) return '';
    const days = daysOf();
    if (!days.length) return '';
    const d = st.day || days[0];
    const n = st.sel.size;
    return `<div class="tih-send"><b>📧 Bulk mail</b><select data-f="sendday">${days.map((x) => `<option value="${x}" ${d === x ? 'selected' : ''}>${dmy(x)}</option>`).join('')}</select>
      <button class="tih-btn ok" data-act="send" data-send="all">Sab (GV + FF TL)</button><button class="tih-btn" data-act="send" data-send="gv">Sirf GV</button><button class="tih-btn" data-act="send" data-send="ff">Sirf FF TLs</button>
      ${n ? `<button class="tih-btn pri" data-act="send" data-send="sel">Selected ${n} bhejo</button>` : ''}
      <span class="tih-note">GV → ${st.data.cfg.gvTo ? esc(st.data.cfg.gvTo) : '<span class="tih-err">GV mail set nahi (⚙)</span>'} · FF → TL ki mail</span><span class="tih-note" data-send-msg>${esc(st.msg && !st.setOpen ? st.msg : '')}</span></div>`;
  }
  function table() {
    const d = st.data;
    if (!d) return `<div class="tih-empty">${st.err ? `<span class="tih-err">${esc(st.err)}</span>` : '⏳ Load ho raha…'}</div>`;
    const rows = filtered();
    if (!rows.length) return `<div class="tih-empty">${d.meta.running || st.busy ? '⏳ Bank mails padh raha hoon…' : 'Is filter me koi tag nahi. Refresh dabao ya mahina badlo.'}</div>`;
    const th = (k, l) => `<th data-sort="${k}">${l}${st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    let prev = '', flip = 0;
    const adm = isAdmin();
    const body = rows.slice(0, 1500).map((r) => {
      if (r.day !== prev) { prev = r.day; flip ^= 1; }
      const src = r.ch === 'gv' ? (r.src === 'gv' ? '<span class="tih-src gv" title="GV Master se mila">GV Master</span>' : r.src === 'miss' ? '<span class="tih-src miss" title="GV Master me nahi mila">nahi mila</span>' : '<span class="tih-src wait">dhundh raha…</span>') : '';
      const who = r.agentName || r.agentId ? `${esc(r.agentName || '—')}<small>${esc(r.agentId)}</small>` : '<span class="tih-note">—</span>';
      const tlm = r.tlName ? (adm ? `<input class="tih-in" data-tlmail="${esc(r.tlName)}" value="${esc(r.tlMail)}" placeholder="TL mail daalo" type="text">` : esc(r.tlMail || '—')) : '<span class="tih-note">—</span>';
      return `<tr class="d${flip}"><td>${adm ? `<input type="checkbox" data-sel="${esc(r.k)}" ${st.sel.has(r.k) ? 'checked' : ''}>` : ''}</td>
        <td class="tih-day">${dmy(r.day)}</td><td><span class="tih-ch ${r.ch}">${r.ch === 'gv' ? '🟩 GV' : '🟦 FF'}</span></td>
        <td class="tih-vrn">${esc(r.vrn)}</td><td class="tih-tag">${esc(r.tagId)}</td><td><span class="tih-rs">${esc(r.reason || '—')}</span></td><td>${dmy(r.issueDate)}</td>
        <td class="tih-ag">${who}${src}</td><td class="tih-tl">${esc(r.tlName || '—')}</td><td>${tlm}</td>
        <td><input class="tih-in" data-remark="${esc(r.k)}" value="${esc(r.remark)}" placeholder="remark…" maxlength="300"></td>
        <td>${r.sentAt ? `<span class="tih-mb y" title="${esc(r.sentTo)}">✉️ ${new Date(r.sentAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>` : '<span class="tih-mb n">—</span>'}</td></tr>`;
    }).join('');
    return `<div class="tih-wrap"><table class="tih-t"><thead><tr><th>${adm ? '<input type="checkbox" data-selall>' : ''}</th>${th('day', 'Report date')}${th('ch', 'Channel')}${th('vrn', 'VRN')}${th('tagId', 'Tag ID')}${th('reason', 'Reason')}${th('issueDate', 'Issue date')}${th('agentName', 'Agent')}${th('tlName', 'TL name')}<th>TL mail</th>${th('remark', 'Remark')}<th>Mail</th></tr></thead><tbody>${body}</tbody></table></div>${rows.length > 1500 ? `<div class="tih-note" style="padding:6px">Pehle 1500 dikha raha hoon (${rows.length}) — filter lagao.</div>` : ''}<div class="tih-note" style="padding:6px 2px">${rows.length} tags</div>`;
  }
  function paint() {
    if (!st.root) return;
    const keep = st.root.querySelector('.tih-wrap');
    const sx = keep ? keep.scrollLeft : 0, sy = keep ? keep.scrollTop : 0;
    st.root.innerHTML = `<div class="tih">${head()}${bar()}${settings()}${sendBar()}${table()}</div>`;
    const w = st.root.querySelector('.tih-wrap'); if (w) { w.scrollLeft = sx; w.scrollTop = sy; }
  }
  async function load(quiet) {
    try { const d = await FF.auth.api('/api/tih'); st.data = d; st.err = ''; if (!st.month && d.months && d.months[0]) st.month = d.months[0]; }
    catch (e) { st.err = String((e && e.message) || e); }
    if (st.root && st.root.isConnected && !quiet) paint(); else if (st.root && st.root.isConnected) paint();
  }
  async function refresh(extra) {
    if (st.busy) return; st.busy = true; paint();
    try { await FF.auth.api('/api/tih/refresh', 'POST', extra || {}); } catch (e) { st.err = String((e && e.message) || e); }
    st.busy = false; await load();
  }
  function csv() {
    const rows = filtered();
    const c = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['Report date', 'Channel', 'VRN', 'Tag ID', 'Reason', 'Issue date', 'Agent ID', 'Agent name', 'TL name', 'TL mail', 'Remark', 'Mail sent'].join(',')]
      .concat(rows.map((r) => [dmy(r.day), r.ch.toUpperCase(), r.vrn, r.tagId, r.reason, dmy(r.issueDate), r.agentId, r.agentName, r.tlName, r.tlMail, r.remark, r.sentAt ? new Date(r.sentAt).toISOString().slice(0, 10) : ''].map(c).join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    a.download = `TagInHand_${st.month || 'all'}_${st.ch}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function send(mode, btn) {
    const day = (st.root.querySelector('[data-f="sendday"]') || {}).value || st.day || daysOf()[0];
    const body = { day, ch: mode === 'sel' ? 'all' : mode };
    if (mode === 'sel') body.keys = [...st.sel];
    btn.disabled = true;
    try {
      const pre = await FF.auth.api('/api/tih/send', 'POST', { ...body, dry: true });
      const lines = (pre.groups || []).map((g) => `✅ ${g.label} → ${g.to} (${g.n})`).concat((pre.skipped || []).map((s) => `⚠ ${s.label} (${s.n}) — ${s.why}`));
      if (!(pre.groups || []).length) { st.msg = lines.join(' · ') || 'Bhejne layak kuch nahi.'; paint(); return; }
      if (!window.confirm(`${dmy(day)} ki Tag In Hand mail bhejni hai?\n\n${lines.join('\n')}`)) { btn.disabled = false; return; }
      const out = await FF.auth.api('/api/tih/send', 'POST', body);
      st.msg = (out.results || []).map((r) => `${r.ok ? '✅' : '❌'} ${r.label} (${r.n})${r.ok ? '' : ' ' + (r.error || '')}`).join(' · ') + ((out.skipped || []).length ? ` · ⚠ ${(out.skipped || []).length} group skip` : '');
      st.sel.clear(); await load();
    } catch (e) { st.msg = String((e && e.message) || e); paint(); }
    btn.disabled = false;
  }
  async function saveSet() {
    const c = {}; st.root.querySelectorAll('[data-c]').forEach((i) => { c[i.dataset.c] = i.value; });
    try { const out = await FF.auth.api('/api/tih/cfg', 'POST', c); st.data.cfg = out.cfg; st.msg = '✅ Save ho gaya'; } catch (e) { st.msg = '❌ ' + String((e && e.message) || e); }
    paint();
  }
  function bind(root) {
    root.addEventListener('click', (e) => {
      const t = e.target;
      const chb = t.closest('[data-ch]'); if (chb) { st.ch = chb.dataset.ch; paint(); return; }
      const so = t.closest('[data-sort]'); if (so) { const k = so.dataset.sort; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = k === 'day' ? -1 : 1; } paint(); return; }
      const a = t.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      if (act === 'refresh') refresh();
      else if (act === 'csv') csv();
      else if (act === 'set') { st.setOpen = !st.setOpen; st.msg = ''; paint(); }
      else if (act === 'saveset') saveSet();
      else if (act === 'gvretry') refresh({ gvRetry: true });
      else if (act === 'send') send(a.dataset.send, a);
    });
    root.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.matches('[data-f="month"]')) { st.month = t.value; st.day = ''; st.sel.clear(); paint(); return; }
      if (t.matches('[data-f="day"]')) { st.day = t.value; paint(); return; }
      if (t.matches('[data-sel]')) { if (t.checked) st.sel.add(t.dataset.sel); else st.sel.delete(t.dataset.sel); paint(); return; }
      if (t.matches('[data-selall]')) { filtered().forEach((r) => { if (t.checked) st.sel.add(r.k); else st.sel.delete(r.k); }); paint(); return; }
      if (t.matches('[data-remark]')) {
        try { await FF.auth.api('/api/tih/remark', 'POST', { key: t.dataset.remark, text: t.value }); const r = st.data.rows.find((x) => x.k === t.dataset.remark); if (r) r.remark = t.value.trim(); t.classList.add('saved'); setTimeout(() => t.classList.remove('saved'), 1200); } catch { /* ignore */ }
        return;
      }
      if (t.matches('[data-tlmail]')) {
        const tl = t.dataset.tlmail;
        try {
          await FF.auth.api('/api/tih/tlmail', 'POST', { tl, email: t.value });
          st.data.rows.forEach((r) => { if (r.tlName === tl) r.tlMail = t.value.trim(); });
          root.querySelectorAll('[data-tlmail]').forEach((i) => { if (i.dataset.tlmail === tl) { i.value = t.value.trim(); i.classList.add('saved'); setTimeout(() => i.classList.remove('saved'), 1200); } });
        } catch (err) { t.value = ''; window.alert(String((err && err.message) || err)); }
      }
    });
    let qt = 0;
    root.addEventListener('input', (e) => {
      if (!e.target.matches('[data-f="q"]')) return;
      st.q = e.target.value; clearTimeout(qt);
      qt = setTimeout(() => { const pos = e.target.selectionStart; paint(); const i = root.querySelector('[data-f="q"]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } } }, 250);
    });
  }
  function render(root) {
    css(); st.root = root; root.innerHTML = '<div class="tih"><div class="tih-empty">⏳ Load ho raha…</div></div>';
    bind(root); load();
    clearInterval(st.timer);
    st.timer = setInterval(() => {
      if (!st.root || !st.root.isConnected) { clearInterval(st.timer); return; }
      if (document.hidden || st.busy) return;
      const ae = document.activeElement; if (ae && st.root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
      load(true);
    }, 90000);
  }
  FF.pages.tagInHand = { title: 'Tag In Hand', render };
})(window.FF);
