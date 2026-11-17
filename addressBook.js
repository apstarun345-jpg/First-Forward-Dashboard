/* 📍 Agents Address (v3.125.312) — Management. FF / GV channel filter · multi-field multi-search · file upload (pdf / excel / csv / text / paste).
   Data server me safe: tag-request address pehle, phir Address tab. Upload kabhi purani value nahi mitata. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const FIELDS = [['name', 'Name'], ['mobile', 'Mobile number'], ['pincode', 'Pincode'], ['id', 'Agent ID'], ['address', 'Address'], ['tl', 'TL name']];
  const st = { sel: new Set(), later: new Set(), channel: 'all', fields: ['name', 'mobile', 'pincode', 'id'], q: '', data: null, busy: false, preview: null, overwrite: false, timer: 0, poll: 0 };
  const chLabel = (c) => (c === 'gv' ? '🟩 GV' : '🟦 FF');
  const apiJson = (path) => FF.auth.api(path);

  async function load(root) {
    const box = U.$('#ab-results', root);
    if (!box) return;
    st.busy = true;
    box.innerHTML = U.spinner('Address dhundh rahe hain…');
    try {
      const qs = `channel=${st.channel}&fields=${st.fields.join(',')}&q=${encodeURIComponent(st.q)}&limit=300`;
      st.data = await apiJson(`/api/address-book?${qs}`);
    } catch (err) { st.busy = false; box.innerHTML = U.errorBox(err); return; }
    st.busy = false;
    paint(root);
  }
  function paint(root) {
    const d = st.data;
    if (!d) return;
    const tabs = U.$('#ab-tabs', root);
    const allowed = d.channels || [];
    tabs.innerHTML = [['all', `Sab (${U.fmt((d.counts.ff || 0) + (d.counts.gv || 0))})`], ...allowed.map((c) => [c, `${chLabel(c)} (${U.fmt(d.counts[c] || 0)})`])]
      .filter(([c]) => c !== 'all' || allowed.length > 1)
      .map(([c, l]) => `<button type="button" class="btn small${st.channel === c ? ' primary' : ''}" data-ch="${c}">${l}</button>`).join(' ');
    const box = U.$('#ab-results', root);
    const rows = d.rows || [];
    const sync = d.sync || {};
    const syncLine = sync.running ? `<span class="pill warn">⏳ Sheet sync: ${sync.done}/${sync.total}</span>` : sync.pending ? `<span class="pill warn">⚠ ${sync.pending} entries sheet me sync baaki (site me safe hain)</span>${d.canUpload ? ' <button class="btn small" id="ab-sync">Sheet me sync karo</button>' : ''}` : '<span class="pill ok">✅ Sheet + backup synced</span>';
    box.innerHTML = `<div class="ab-bar"><b>${U.fmt(d.total)}</b> mile${d.total > rows.length ? ` · pehle ${U.fmt(rows.length)} dikha rahe` : ''} · ${syncLine}${d.total ? ' <button class="btn small" id="ab-csv">⬇ CSV</button>' : ''}</div>
      <div class="ab-act"${rows.length ? '' : ' hidden'}><span id="ab-selc" class="dim small"></span> ${d.canUpload ? '<button class="btn small" id="ab-clean">🧹 Duplicate + pincode fix</button> ' : ''}<button class="btn small" id="ab-print" disabled>🖨️ Labels print</button> <button class="btn small" id="ab-pdf" disabled>📄 Labels PDF</button>${d.canUpload ? ' <button class="btn small danger" id="ab-del" disabled>🗑 Delete</button>' : ''}</div>
      <div class="table-wrap tall"><table class="tbl compact ab-tbl"><thead><tr><th><input type="checkbox" id="ab-all" title="Sab select"></th><th>Ch</th><th>Name</th><th>ID</th><th>Mobile</th><th>TL</th><th>Address</th><th>Pincode</th><th>Source</th><th></th></tr></thead><tbody>${rows.length ? rows.map((r, i) => `<tr class="${r.conflict ? 'ab-conf' : ''}"><td><input type="checkbox" data-sel="${esc(r.key)}"${st.sel.has(r.key) ? ' checked' : ''}></td><td>${chLabel(r.channel)}</td><td><b>${esc(r.name)}</b>${r.conflict ? ` <button class="btn small warn" data-conf="${esc(r.gkey)}" title="Is agent ke ${r.gsize} alag address hain — chuno">⚠ ${r.gsize} address</button>` : ''}</td><td>${esc(r.id)}</td><td class="nowrap">${esc(r.mobile)}</td><td>${esc(r.tl)}</td><td class="ab-addr">${esc(r.address)}</td><td>${esc(r.pincode)}</td><td><small class="dim">${esc(r.src)}</small></td><td><button class="btn small" data-copy="${i}" title="Address copy">📋</button></td></tr>`).join('') : '<tr><td colspan="10" class="dim" style="text-align:center;padding:18px">Kuch nahi mila.</td></tr>'}</tbody></table></div>`;
    const selRows = () => rows.filter((r) => st.sel.has(r.key));
    const refreshSel = () => { const n = selRows().length; ['ab-print', 'ab-pdf', 'ab-del'].forEach((id) => { const el = U.$('#' + id, box); if (el) el.disabled = !n; }); const c = U.$('#ab-selc', box); if (c) c.textContent = n ? `${n} select` : 'Select karke label / delete'; const all = U.$('#ab-all', box); if (all) all.checked = n > 0 && n === rows.length; };
    box.querySelectorAll('[data-sel]').forEach((cb) => { cb.onchange = () => { if (cb.checked) st.sel.add(cb.dataset.sel); else st.sel.delete(cb.dataset.sel); refreshSel(); }; });
    const allCb = U.$('#ab-all', box);
    if (allCb) allCb.onchange = () => { rows.forEach((r) => { if (allCb.checked) st.sel.add(r.key); else st.sel.delete(r.key); }); box.querySelectorAll('[data-sel]').forEach((cb) => { cb.checked = allCb.checked; }); refreshSel(); };
    refreshSel();
    const asReq = (r) => ({ id: `ADDR-${r.key}`, at: new Date().toISOString(), status: 'approved', addressOnly: true, rows: [], agent: { name: r.name, dispatchName: r.name, mobile: r.mobile, address: r.address, pincode: r.pincode, agentId: r.id, tl: r.tl, channel: r.channel } });
    const needTR = async () => { try { if (FF.lazy && FF.lazy.need) await FF.lazy.need('tagRequest'); } catch { /* ignore */ } if (!FF.pages.tagRequest || !FF.pages.tagRequest.openPrint) { U.toast('Label module load nahi hua — page refresh karo', 'err'); return null; } return FF.pages.tagRequest; };
    const cl = U.$('#ab-clean', box);
    if (cl) cl.onclick = async () => {
      cl.disabled = true;
      try {
        const pv = await FF.auth.api('/api/address-book/cleanup', 'POST', { apply: false });
        if (!pv.duplicatesRemoved && !pv.addressesFixed && !pv.pincodesFilled) { U.toast('Sab theek hai — kuch fix karne ko nahi', 'ok'); cl.disabled = false; return; }
        if (!confirm(`Cleanup:\n• ${pv.duplicatesRemoved} duplicate address hatenge (jin mobile par tag-request address hai, unke baaki Address-tab rows)\n• ${pv.addressesFixed} address saaf honge (doosre ka hissa hatega)\n• ${pv.pincodesFilled} khaali pincode bharenge\n\nHatayi hui rows "Address Deleted" log me rahengi. Karein?`)) { cl.disabled = false; return; }
        const out = await FF.auth.api('/api/address-book/cleanup', 'POST', { apply: true });
        U.toast(`🧹 ${out.duplicatesRemoved} duplicate hata, ${out.addressesFixed} address saaf, ${out.pincodesFilled} pincode bhare`, 'ok'); load(root);
      } catch (err) { alert(err.message); cl.disabled = false; }
    };
    const pr = U.$('#ab-print', box), pf = U.$('#ab-pdf', box), dl = U.$('#ab-del', box);
    if (pr) pr.onclick = async () => { const T = await needTR(); if (T) T.openPrint(selRows().map(asReq)); };
    if (pf) pf.onclick = async () => { const T = await needTR(); if (T) T.downloadPdf(selRows().map(asReq)); };
    if (dl) dl.onclick = async () => {
      const list = selRows();
      if (!confirm(`${list.length} address delete karein?\n\n${list.slice(0, 6).map((r) => `• ${r.name} (${r.mobile})`).join('\n')}${list.length > 6 ? '\n…' : ''}\n\nSite + Google Sheet dono se hatega (copy "Address Deleted" tab me save rahegi).`)) return;
      dl.disabled = true;
      try { const out = await FF.auth.api('/api/address-book/delete', 'POST', { keys: list.map((r) => r.key) }); list.forEach((r) => st.sel.delete(r.key)); U.toast(`🗑 ${out.deleted} delete${out.sheetDeleted === false ? ' (Sheet row nahi hati)' : ''}${out.note ? ' — ' + out.note : ''}`, out.sheetDeleted === false ? 'warn' : 'ok'); load(root); } catch (err) { dl.disabled = false; alert(err.message); }
    };
    box.querySelectorAll('[data-conf]').forEach((b) => { b.onclick = () => conflictModal(root, b.dataset.conf); });
    if (st.q.trim() && d.canUpload) { const g = rows.find((r) => r.conflict && !st.later.has(r.gkey)); if (g) setTimeout(() => conflictModal(root, g.gkey), 150); }
    const csv = U.$('#ab-csv', box);
    if (csv) csv.addEventListener('click', async () => {
      csv.disabled = true;
      try {
        const full = await apiJson(`/api/address-book?channel=${st.channel}&fields=${st.fields.join(',')}&q=${encodeURIComponent(st.q)}&limit=5000`);
        U.downloadCsv(`agents-address-${U.stamp()}.csv`, ['Name', 'ID', 'Mobile', 'TL', 'Address', 'Pincode', 'Channel'], full.rows.map((r) => [r.name, r.id, r.mobile, r.tl, r.address, r.pincode, r.channel === 'gv' ? 'GV' : 'FF']));
      } catch (err) { alert(err.message); }
      csv.disabled = false;
    });
    U.$$('[data-copy]', box).forEach((b) => b.addEventListener('click', () => {
      const r = rows[Number(b.dataset.copy)];
      const text = `${r.name}\n${r.mobile}\n${r.address}${r.pincode && !String(r.address).includes(r.pincode) ? ' ' + r.pincode : ''}`;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => { b.textContent = '✅'; setTimeout(() => { b.textContent = '📋'; }, 1200); }).catch(() => {});
    }));
    const sb = U.$('#ab-sync', box);
    if (sb) sb.addEventListener('click', async () => { sb.disabled = true; try { await FF.auth.api('/api/address-book/sync', 'POST', {}); watchSync(root); } catch (err) { alert(err.message); } });
    tabs.querySelectorAll('[data-ch]').forEach((b) => { b.onclick = () => { st.channel = b.dataset.ch; load(root); }; });
    if (sync.running) watchSync(root);
  }
  /** ⚠ Ek agent ke kai alag address — chuno kaunsa sahi hai (baaki delete) ya dono rakho. */
  async function conflictModal(root, gkey) {
    if (document.getElementById('ab-modal')) return;
    const m = gkey.split('|')[1] || '';
    let list = [];
    try { const j = await apiJson(`/api/address-book?channel=all&fields=mobile&q=${encodeURIComponent(m)}&limit=20`); list = (j.rows || []).filter((r) => r.gkey === gkey); } catch (err) { alert(err.message); return; }
    if (list.length < 2) { return; }
    const ov = document.createElement('div');
    ov.id = 'ab-modal'; ov.className = 'ab-ov';
    ov.innerHTML = `<div class="ab-md"><h3>⚠ ${esc(list[0].name)} — ${list.length} alag address mile</h3><p class="dim small">Mobile <b>${esc(m)}</b>. Kaunsa sahi hai? "Yeh sahi" dabane par baaki delete ho jayenge (Sheet se bhi; copy log me rahegi).</p>
      <div class="ab-cards">${list.map((r, i) => `<div class="ab-card"><div><b>${esc(r.name)}</b> ${chLabel(r.channel)} <small class="dim">${esc(r.src)}${r.updatedAt ? ' · ' + esc(String(r.updatedAt).slice(0, 10)) : ''}</small></div><div class="ab-addr">${esc(r.address)}</div><div>PIN <b>${esc(r.pincode)}</b>${r.id ? ` · ID ${esc(r.id)}` : ''}${r.tl ? ` · TL ${esc(r.tl)}` : ''}</div><button class="btn primary small" data-keep="${i}">✅ Yeh sahi</button></div>`).join('')}</div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="ab-both">Dono rakho (dobara na poochho)</button><button class="btn" id="ab-later">Baad me</button></div></div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('#ab-later').onclick = () => { st.later.add(gkey); close(); };
    ov.querySelector('#ab-both').onclick = async () => { try { await FF.auth.api('/api/address-book/resolve', 'POST', { mode: 'both', gkey }); close(); load(root); } catch (err) { alert(err.message); } };
    ov.querySelectorAll('[data-keep]').forEach((b) => { b.onclick = async () => {
      const keep = list[Number(b.dataset.keep)];
      const drop = list.filter((r) => r !== keep).flatMap((r) => [r.key, ...(r.altKeys || [])]);
      b.disabled = true;
      try { await FF.auth.api('/api/address-book/resolve', 'POST', { mode: 'one', gkey, drop }); close(); U.toast('✅ Sahi address rakh liya, baaki delete', 'ok'); load(root); } catch (err) { b.disabled = false; alert(err.message); }
    }; });
  }
  function watchSync(root) {
    clearInterval(st.poll);
    st.poll = setInterval(async () => {
      if (!document.body.contains(root)) { clearInterval(st.poll); return; }
      try { const s = await apiJson('/api/address-book/status'); if (st.data) st.data.sync = s.sync; const el = U.$('#ab-sync-live', root); if (el) el.textContent = s.sync.running ? `⏳ Sheet sync ${s.sync.done}/${s.sync.total}…` : `✅ Sheet sync done ${s.sync.done}/${s.sync.total}${s.sync.failed ? ` · ❌ ${s.sync.failed} fail (${s.sync.error}) — "Sheet me sync karo" dabao` : ''}${s.sync.log ? ' · ' + s.sync.log : ''}`; if (!s.sync.running) { clearInterval(st.poll); paint(root); } } catch { /* retry */ }
    }, 3000);
  }

  function chips(s) {
    const c = (t, v, tone) => `<span class="pill ${tone || ''}">${t}: <b>${U.fmt(v)}</b></span>`;
    return `${c('Total', s.total)} ${c('🟦 FF', s.ff)} ${c('🟩 GV', s.gv)} ${c('ID mili', s.withId)} ${c('TL mila', s.withTl)} ${c('Channel pata nahi (FF maana)', s.unknownChannel, s.unknownChannel ? 'warn' : '')} ${c('Mobile nahi', s.noMobile, s.noMobile ? 'warn' : '')} ${c('Address nahi', s.noAddress, s.noAddress ? 'warn' : '')} ${c('Check karo', s.review, s.review ? 'warn' : '')}`;
  }
  function paintPreview(root) {
    const box = U.$('#ab-preview', root);
    const pv = st.preview;
    if (!pv) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="ab-pv"><h4>📄 ${esc(pv.file)} — preview (abhi save nahi hua)</h4><div class="ab-chips">${chips(pv.stats)}</div>
      <p class="dim small">ID / TL / channel mobile number se: pehle tag requests, phir Address tab, phir Agent mobile sheet + REPORT se nikale gaye. Jo file me pehle se nahi tha wahi bharta hai — maujooda address/mobile kabhi nahi mitta.</p>
      <div class="table-wrap" style="max-height:340px"><table class="tbl compact"><thead><tr><th>Ch</th><th>Name</th><th>ID</th><th>Mobile</th><th>TL</th><th>Address</th><th>Pin</th><th>Match</th></tr></thead><tbody>${pv.rows.map((r) => `<tr${(r.flags || []).length ? ' class="ab-flag"' : ''}><td>${r.channel ? chLabel(r.channel) : '<span class="dim">?</span>'}</td><td>${esc(r.name)}</td><td>${esc(r.id)}</td><td>${esc(r.mobile)}</td><td>${esc(r.tl)}</td><td class="ab-addr">${esc(r.address)}</td><td>${esc(r.pincode)}</td><td><small class="dim">${esc(r.resolved || '')}</small></td></tr>`).join('')}</tbody></table></div>
      ${pv.stats.total > pv.rows.length ? `<p class="dim small">Pehli ${pv.rows.length} rows dikha rahe — save me sab ${U.fmt(pv.stats.total)} jayengi.</p>` : ''}
      <label class="small"><input type="checkbox" id="ab-ow"${st.overwrite ? ' checked' : ''}> Maujooda address ko file ke address se <b>replace</b> karo (default: sirf khaali jagah bharo)</label>
      <div style="margin-top:8px"><button class="btn primary" id="ab-commit">✅ Address tab me save karo (${U.fmt(pv.stats.total)})</button> <button class="btn" id="ab-cancel">Cancel</button> <span id="ab-sync-live" class="dim small"></span></div></div>`;
    U.$('#ab-ow', box).onchange = (e) => { st.overwrite = e.target.checked; };
    U.$('#ab-cancel', box).onclick = () => { st.preview = null; paintPreview(root); };
    U.$('#ab-commit', box).onclick = async (e) => {
      const btn = e.target; btn.disabled = true; btn.textContent = 'Save ho raha hai…';
      try {
        const out = await FF.auth.api('/api/address-book/commit', 'POST', { previewId: pv.previewId, overwrite: st.overwrite });
        st.preview = null;
        box.innerHTML = `<div class="ab-pv"><h4>✅ Save ho gaya</h4><p>Naye: <b>${out.added}</b> · khaali bhare: <b>${out.filled}</b> · replace: <b>${out.replaced}</b> · pehle se same: <b>${out.unchanged}</b>${out.unknownChannel ? ` · channel pata nahi (FF maana): <b>${out.unknownChannel}</b>` : ''}</p><p class="dim small">Site me + backup me turant save. Google Sheet ke "Address" tab me background me likh raha hai (<span id="ab-sync-live">…</span>) aur har row "Address Import Log" tab me alag se bhi rahegi.</p></div>`;
        watchSync(root); load(root);
      } catch (err) { btn.disabled = false; btn.textContent = 'Dobara try karo'; alert(err.message); }
    };
  }
  async function upload(root, file, pasted) {
    const box = U.$('#ab-preview', root);
    box.innerHTML = U.spinner(`${pasted ? 'Text' : file.name} padh rahe hain (badi PDF me ~30 sec)…`);
    try {
      const res = await fetch('/api/address-book/preview', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(pasted ? 'pasted.txt' : file.name) }, body: pasted ? new Blob([pasted]) : file });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      st.preview = json; paintPreview(root);
    } catch (err) { box.innerHTML = U.errorBox(err); }
  }

  function render(root) {
    const can = FF.auth.can;
    root.innerHTML = `<div class="page-head"><div><h1>📍 Agents Address</h1><p class="sub">Agent ka address · mobile · pincode · TL — pehle <b>tag request</b> ka address, phir <b>Address tab</b>. Ek saath kai search.</p></div></div>
      <section class="card"><div class="card-body">
        <div id="ab-tabs" class="ab-tabs"></div>
        <div class="ab-search">
          <details class="ab-fields"><summary class="btn small">🔎 Search in: <span id="ab-fl"></span> ▾</summary><div class="ab-fbox">${FIELDS.map(([k, l]) => `<label><input type="checkbox" data-f="${k}"${st.fields.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</div></details>
          <textarea id="ab-q" class="input" rows="2" placeholder="Ek ya kai: naam / mobile / pincode / ID — comma ya nayi line se alag karo (jaise 9876543210, 301706, Rahul)">${esc(st.q)}</textarea>
          <button class="btn primary" id="ab-go">Search</button> <button class="btn" id="ab-clear">Clear</button>
        </div>
        <div id="ab-results"></div>
      </div></section>
      <section class="card" id="ab-up"${can('addressUpload') ? '' : ' hidden'}><div class="card-head"><h3>⬆ Address upload (kisi bhi format me)</h3></div><div class="card-body">
        <p class="dim small">PDF · Excel (.xlsx) · CSV · text — columns hon ya upar-niche likha text (Name / Mo / Address / Pin). ID, TL aur channel mobile number se site data se nikalte hain. Pehle preview aata hai, phir save.</p>
        <input type="file" id="ab-file" accept=".pdf,.xlsx,.xlsm,.csv,.tsv,.txt,.text,.md,*/*"> <button class="btn small" id="ab-paste-t">📋 Text paste karo</button>
        <div id="ab-paste" hidden style="margin-top:8px"><textarea id="ab-pt" class="input" rows="6" placeholder="Yahan address text paste karo…"></textarea><button class="btn" id="ab-pgo">Preview</button></div>
        <div id="ab-preview"></div>
      </div></section>
      <style>.ab-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.ab-search{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-bottom:10px}.ab-search textarea{flex:1;min-width:240px}.ab-fields{position:relative}.ab-fields summary{cursor:pointer;list-style:none}.ab-fbox{position:absolute;z-index:20;background:var(--card,#fff);border:1px solid var(--line,#ddd);border-radius:10px;padding:8px 12px;display:grid;gap:6px;box-shadow:0 6px 20px rgba(0,0,0,.15);min-width:170px}.ab-bar{margin:6px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.ab-addr{min-width:260px;max-width:480px;white-space:normal}.nowrap{white-space:nowrap}.ab-pv{border:1px dashed var(--line,#ccc);border-radius:12px;padding:12px;margin-top:12px}.ab-chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.ab-flag td{background:rgba(255,193,7,.12)}.ab-conf td{background:rgba(255,152,0,.10)}.ab-act{margin:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.btn.danger{color:#b91c1c;border-color:#fca5a5}.ab-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:14px}.ab-md{background:var(--card,#fff);color:inherit;border-radius:14px;padding:16px;max-width:760px;width:100%;max-height:88vh;overflow:auto}.ab-cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.ab-card{border:1px solid var(--line,#ddd);border-radius:10px;padding:10px;display:grid;gap:6px}</style>`;
    const flLabel = () => { U.$('#ab-fl', root).textContent = st.fields.map((k) => (FIELDS.find((f) => f[0] === k) || [k, k])[1]).join(' · ') || 'kuch nahi'; };
    flLabel();
    root.querySelectorAll('[data-f]').forEach((cb) => { cb.onchange = () => { st.fields = [...root.querySelectorAll('[data-f]')].filter((x) => x.checked).map((x) => x.dataset.f); if (!st.fields.length) { cb.checked = true; st.fields = [cb.dataset.f]; } flLabel(); if (st.q.trim()) load(root); }; });
    const q = U.$('#ab-q', root);
    const go = () => { st.q = q.value; load(root); };
    U.$('#ab-go', root).onclick = go;
    U.$('#ab-clear', root).onclick = () => { q.value = ''; st.q = ''; load(root); };
    q.addEventListener('input', () => { clearTimeout(st.timer); st.timer = setTimeout(go, 450); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
    const file = U.$('#ab-file', root);
    if (file) file.onchange = () => { if (file.files[0]) upload(root, file.files[0]); };
    const pt = U.$('#ab-paste-t', root);
    if (pt) pt.onclick = () => { U.$('#ab-paste', root).hidden = !U.$('#ab-paste', root).hidden; };
    const pg = U.$('#ab-pgo', root);
    if (pg) pg.onclick = () => { const t = U.$('#ab-pt', root).value.trim(); if (t) upload(root, null, t); };
    load(root);
  }
  FF.pages.addressBook = { title: 'Agents Address', render };
})(window.FF);
