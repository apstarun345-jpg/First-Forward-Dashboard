/* 📍 Agents Address (v3.125.312) — Management. FF / GV channel filter · multi-field multi-search · file upload (pdf / excel / csv / text / paste).
   Data server me safe: tag-request address pehle, phir Address tab. Upload kabhi purani value nahi mitata. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const FIELDS = [['name', 'Name'], ['mobile', 'Mobile number'], ['pincode', 'Pincode'], ['id', 'Agent ID'], ['address', 'Address'], ['tl', 'TL name']];
  const st = { tl: '', view: 'list', multi: false, status: 'all', act: null, sel: new Set(), later: new Set(), channel: 'all', kf: '', fields: ['name', 'mobile', 'pincode', 'id'], q: '', data: null, busy: false, preview: null, overwrite: false, timer: 0, poll: 0 };
  const chLabel = (c) => (c === 'gv' ? '🟩 GV' : '🟦 FF');
  const apiJson = (path) => FF.auth.api(path);

  async function load(root) {
    const box = U.$('#ab-results', root);
    if (!box) return;
    st.busy = true;
    if (st.data && box.firstChild) box.style.opacity = '.55'; else box.innerHTML = `<div class="abx-skel">${['b', 'g', 'r', 'a', 'o', 'p', 't'].map((c) => `<span class="abx-sk sk-${c}"></span>`).join('')}</div><div class="abx-skrow"></div><div class="abx-skrow"></div><div class="abx-skrow short"></div><p class="abx-skt">📍 Address dhundh rahe hain…</p>`;   // ⚡ purana result dikhta rahe, flash nahi
    try {
      const qs = `kf=${encodeURIComponent(st.kf || '')}&channel=${st.channel}&fields=${st.fields.join(',')}&q=${encodeURIComponent(st.q)}&limit=${st.view === 'map' ? 5000 : 300}${st.multi ? '&multi=1' : ''}${st.view === 'map' ? '&geo=1' : ''}`;
      st.data = await apiJson(`/api/address-book?${qs}`);
    } catch (err) { st.busy = false; box.style.opacity = ''; box.innerHTML = U.errorBox(err); return; }
    st.busy = false; box.style.opacity = '';
    paint(root);
  }
  function paint(root) {
    const d = st.data;
    if (!d) return;
    const tabs = U.$('#ab-tabs', root);
    const hs = U.$('#ab-herostats', root), k0 = d.kpi || {};
    if (hs) { const pc = k0.total ? Math.round((k0.complete || 0) * 100 / k0.total) : 0; hs.innerHTML = `<span class="abx-hs"><b>${U.fmt(k0.total || 0)}</b><i>Total</i></span><span class="abx-hs ff"><b>${U.fmt((d.counts || {}).ff || 0)}</b><i>🟦 FF</i></span><span class="abx-hs gv"><b>${U.fmt((d.counts || {}).gv || 0)}</b><i>🟩 GV</i></span><span class="abx-hs ring" style="--p:${pc}"><b>${pc}%</b><i>complete</i></span>`; }
    const allowed = d.channels || [];
    tabs.innerHTML = [['all', `Sab (${U.fmt((d.counts.ff || 0) + (d.counts.gv || 0))})`], ...allowed.map((c) => [c, `${chLabel(c)} (${U.fmt(d.counts[c] || 0)})`])]
      .filter(([c]) => c !== 'all' || allowed.length > 1)
      .map(([c, l]) => `<button type="button" class="abx-tab t-${c}${st.channel === c ? ' on' : ''}" data-ch="${c}">${l}</button>`).join(' ');
    const box = U.$('#ab-results', root);
    const rows = st.view === 'map' ? (d.rows || []).slice(0, 300) : (d.rows || []);   // map me poori list pin banti hai, table sirf pehli 300
    const sync = d.sync || {};
    const fillOn = d.canUpload && ['nomobile', 'nopin', 'noaddr'].includes(st.kf) && st.view === 'list';
    const syncLine = sync.running ? `<span class="pill warn">⏳ Sheet sync: ${sync.done}/${sync.total}</span>` : sync.pending ? `<span class="pill warn">⚠ ${sync.pending} entries sheet me sync baaki (site me safe hain)</span>${d.canUpload ? ' <button class="btn small" id="ab-sync">Sheet me sync karo</button>' : ''}` : '<span class="pill ok">✅ Sheet + backup synced</span>';
    box.innerHTML = kpiStrip(d) + termPanel(d) + `<div class="ab-tools"><span class="grp"><button type="button" class="btn small${st.view === 'list' ? ' primary' : ''}" data-view="list">📋 List</button><button type="button" class="btn small abx-mapbtn" data-fullmap="1" title="Map — zoom, satellite, meri location, paas ke agents">🗺 Map</button></span> <label class="small"><input type="checkbox" id="ab-multi"${st.multi ? ' checked' : ''}> ⚠ Sirf 2+ address wale${d.multiCount ? ` (${d.multiCount})` : ''}</label></div>${st.view === 'map' ? '<div id="ab-mapbox"></div>' : ''}<div class="ab-bar"><b>${U.fmt(d.total)}</b> mile${d.total > rows.length ? ` · pehle ${U.fmt(rows.length)} dikha rahe` : ''} · ${syncLine}${d.total ? ' <button class="btn small" id="ab-csv">⬇ CSV</button>' : ''}${d.canUpload ? ' <button class="btn small primary" id="ab-new">➕ Naya address</button>' : ''} ${d.canUpload ? '<button class="btn small" id="ab-refresh" title="Sheet se abhi taaza data lo (warna har 8 ghante me apne aap)">🔄 Force refresh</button>' : ''} <small class="dim" id="ab-cache">${d.cache && d.cache.at ? 'Sheet se last: ' + esc(new Date(d.cache.at).toLocaleString('en-IN', { hour12: true, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })) + ' · auto har 8 ghante' : 'auto har 8 ghante'}</small></div>
      <div class="ab-act"${rows.length ? '' : ' hidden'}><span id="ab-selc" class="dim small"></span> ${d.canUpload ? '<button class="btn small" id="ab-clean">🧹 Duplicate + pincode fix</button> ' : ''}<button class="btn small" id="ab-print" disabled>🖨️ Labels print</button> <button class="btn small" id="ab-pdf" disabled>📄 Labels PDF</button>${d.canUpload ? ' <button class="btn small danger" id="ab-del" disabled>🗑 Delete</button>' : ''}</div>
      ${fillOn ? `<div class="ab-fillbar"><b>✍️ Fill mode</b> — ${{ nomobile: 'mobile', nopin: 'pincode', noaddr: 'address' }[st.kf]} nahi wale ${U.fmt(rows.length)} rows; khaali box me likho, phir <button class="btn small primary" id="ab-fillsave">💾 Sab save karo</button> <small class="dim">Address me pincode ho to apne aap uthega · site + Google Sheet dono me jayega</small> <span id="ab-fillst" class="small"></span></div>` : ''}
      <div class="table-wrap tall"><table class="tbl compact ab-tbl${fillOn ? ' ab-filling' : ''}"><thead><tr><th><input type="checkbox" id="ab-all" title="Sab select"></th><th>Ch</th><th>Name</th><th>ID</th><th>Mobile</th><th>TL</th><th>Address</th><th>Pincode</th><th>Source</th><th></th></tr></thead><tbody>${rows.length ? rows.map((r, i) => `<tr class="${r.conflict ? 'ab-conf' : ''} ab-r-${r.channel === 'gv' ? 'gv' : 'ff'}"><td><input type="checkbox" data-sel="${esc(r.key)}"${st.sel.has(r.key) ? ' checked' : ''}></td><td>${chLabel(r.channel)}</td><td><b>${esc(r.name)}</b>${r.conflict ? ` <button class="btn small warn" data-conf="${esc(r.gkey)}" title="Is agent ke ${r.gsize} alag address hain — chuno">⚠ ${r.gsize} address</button>` : ''}</td><td>${esc(r.id)}</td><td class="nowrap">${r.mobile && String(r.mobile).replace(/\D/g, '').length >= 10 ? esc(r.mobile) : fillOn ? `<input class="input ab-fill" data-fill="${i}|mobile" inputmode="numeric" maxlength="14" placeholder="📱 Mobile likho" value="${esc(r.mobile || '')}">` : '<span class="ab-bd">❌ nahi</span>'}</td><td>${esc(r.tl)}</td><td class="ab-addr">${fillOn && String(r.address || '').trim().length < 8 ? `<textarea class="input ab-fill" data-fill="${i}|address" rows="2" placeholder="🏠 Poora address likho">${esc(r.address || '')}</textarea>` : esc(r.address)}</td><td>${/^\d{6}$/.test(String(r.pincode || '')) ? `<span class="ab-pin">${esc(r.pincode)}</span>` : fillOn ? `<input class="input ab-fill ab-fill-pin" data-fill="${i}|pincode" inputmode="numeric" maxlength="6" placeholder="📮 Pincode" value="${esc(r.pincode || '')}">` : '<span class="ab-bd">❌ nahi</span>'}</td><td><span class="ab-src ${r.src === 'Tag request' ? 'tr' : 'ad'}">${esc(r.src)}</span></td><td><button class="btn small" data-copy="${i}" title="Address copy">📋</button>${d.canUpload ? ` <button class="btn small" data-edit="${i}" title="${r.src === 'Tag request' ? 'Edit — us agent ki tag request ka address bhi badlega' : 'Address edit'}">✏️</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="10" class="dim" style="text-align:center;padding:18px">Kuch nahi mila.</td></tr>'}</tbody></table></div>`;
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
        cl.textContent = '⏳ Clean ho raha hai…';
        const out = await FF.auth.api('/api/address-book/cleanup', 'POST', { apply: true });   // v3.125.321 — seedha apply; tag-request address kabhi nahi hatta
        const s = out.sync || {};
        if (!out.duplicatesRemoved && !out.addressesFixed && !out.pincodesFilled) U.toast('Sab theek hai — kuch fix karne ko nahi', 'ok');
        else U.toast(`🧹 ${out.duplicatesRemoved} duplicate hata, ${out.addressesFixed} address saaf, ${out.pincodesFilled} pincode bhare · tag-request address safe · Sheet ${s.failed || s.error ? '⚠ sync baaki' : '✅ synced'}`, 'ok');
        cl.textContent = '🧹 Duplicate + pincode fix'; cl.disabled = false; load(root);
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
    box.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { st.view = b.dataset.view; load(root); }; });
    box.querySelectorAll('[data-fullmap]').forEach((b) => { b.onclick = openFullMap; });
    const mc = U.$('#ab-multi', box); if (mc) mc.onchange = () => { st.multi = mc.checked; load(root); };
    if (st.view === 'map') mapView(root, box, d);
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
    const nw = U.$('#ab-new', box); if (nw) nw.onclick = () => addModal(root, {});
    box.querySelectorAll('[data-addterm]').forEach((b) => { b.onclick = () => addModal(root, prefillOf(b.dataset.addterm)); });
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => addModal(root, { edit: rows[Number(b.dataset.edit)] }); });
    // ✍️ v3.125.376 — Fill mode: KPI (mobile / pincode / address nahi) click → list me hi bharo → ek click me sab save
    box.querySelectorAll('[data-fill]').forEach((el) => { el.addEventListener('input', () => { el.classList.add('dirty'); if (el.dataset.fill.endsWith('|address')) { const pinEl = box.querySelector(`[data-fill="${el.dataset.fill.split('|')[0]}|pincode"]`); const m = el.value.match(/(?<!\d)[1-9]\d{5}(?!\d)/g); if (pinEl && m && !pinEl.value) { pinEl.value = m[m.length - 1]; pinEl.classList.add('dirty'); } } }); });
    const fs = U.$('#ab-fillsave', box);
    if (fs) fs.onclick = async () => {
      const ch = new Map();
      box.querySelectorAll('[data-fill].dirty').forEach((el) => { const [i, f] = el.dataset.fill.split('|'); const r = rows[Number(i)]; if (!r) return; const o = ch.get(r) || {}; o[f] = el.value.trim(); ch.set(r, o); });
      if (!ch.size) { U.toast('Kuch bhara nahi — khaali box me likho', 'warn'); return; }
      const out = U.$('#ab-fillst', box); fs.disabled = true; let ok = 0; const bad = [];
      for (const [r, o] of ch) {
        const body = { key: r.key, name: r.name, id: r.id, tl: r.tl, channel: r.channel, mobile: o.mobile != null ? o.mobile : r.mobile, address: o.address != null ? o.address : r.address, pincode: o.pincode != null ? o.pincode : r.pincode };
        if (out) out.textContent = `⏳ ${ok + bad.length + 1}/${ch.size} save…`;
        try { await FF.auth.api('/api/address-book/save', 'POST', body); ok++; } catch (err) { bad.push(`${r.name}: ${(err && err.message) || err}`); }
      }
      fs.disabled = false;
      U.toast(`✅ ${ok} save ho gaye${bad.length ? ` · ⚠ ${bad.length} nahi hue` : ''}`, bad.length ? 'warn' : 'ok');
      if (bad.length) alert('Ye save nahi hue:\n\n' + bad.slice(0, 15).join('\n'));
      load(root);
    };
    const mc2 = U.$('#ab-misscopy', box); if (mc2) mc2.onclick = () => { const t = (d.termStats || []).filter((x) => !x.n).map((x) => x.t).join('\n'); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => U.toast('Nahi mile wali list copy ho gayi', 'ok')).catch(() => {}); };
    const mc3 = U.$('#ab-missonly', box); if (mc3) mc3.onclick = () => { const miss = (d.termStats || []).filter((x) => !x.n).map((x) => x.t); const q0 = U.$('#ab-q', root); if (q0) q0.value = miss.join('\n'); st.q = miss.join('\n'); load(root); };
    const rf = U.$('#ab-refresh', box);
    if (rf) rf.addEventListener('click', async () => { rf.disabled = true; rf.textContent = '⏳ Sheet se la rahe…'; try { const o = await FF.auth.api('/api/address-book/refresh', 'POST', {}); U.toast(`✅ Sheet se taaza data aa gaya (${U.fmt(o.rows)} rows)`, 'ok'); load(root); } catch (err) { rf.disabled = false; rf.textContent = '🔄 Force refresh'; alert(err.message); } });
    box.querySelectorAll('[data-kf]').forEach((b) => { b.onclick = () => { st.kf = st.kf === b.dataset.kf ? '' : b.dataset.kf; load(root); }; });
    const sb = U.$('#ab-sync', box);
    if (sb) sb.addEventListener('click', async () => { sb.disabled = true; try { await FF.auth.api('/api/address-book/sync', 'POST', {}); watchSync(root); } catch (err) { alert(err.message); } });
    tabs.querySelectorAll('[data-ch]').forEach((b) => { b.onclick = () => { st.channel = b.dataset.ch; load(root); }; });
    if (sync.running) watchSync(root);
  }
  // ---- 🗺 Map: pincode se agents kahan hain + active / inactive ------------------------------------
  const TILE = 256;
  const proj = (lat, lng, z) => { const n = TILE * (2 ** z), s = Math.sin(lat * Math.PI / 180); return { x: (lng + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n }; };
  const unproj = (x, y, z) => { const n = TILE * (2 ** z); return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI, lng: x / n * 360 - 180 }; };
  const keyOf = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const STAT = { active: ['🟢 Active', 'green'], in1: ['🟠 Inactive · is mahine', 'amber'], in2: ['🔴 Inactive · 2 mahine', 'red'], none: ['⚪ Status nahi (stock/report me nahi)', ''] };
  async function loadActivity() {
    if (st.act) return st.act;
    const m = new Map();
    try {
      if (FF.lazy && FF.lazy.need) await FF.lazy.need('agentsOverview');
      const rows = await FF.agentsOverview.load();
      (rows || []).forEach((r) => { const v = { status: r.status, lastActive: r.lastActive || '', cur: r.cur, last: r.last }; if (r.id) m.set(`${r.ch}|${keyOf(r.id)}`, v); if (r.name) m.set(`${r.ch}|N${keyOf(r.name)}`, v); });
    } catch { /* status optional */ }
    st.act = m; return m;
  }
  const actOf = (act, r) => act.get(`${r.channel}|${keyOf(r.id)}`) || act.get(`${r.channel}|N${keyOf(r.name)}`) || null;
  // 🗺 v3.125.379 — Full-screen map (Leaflet) — addressMap.js on demand
  async function openFullMap() {
    try {
      // v3.125.382 — map file hamesha server ke current version se (page ka purana cache map ko purana na chalaye)
      let ver = ''; try { ver = (await FF.auth.api('/api/version')).version || ''; } catch { ver = String(Date.now()); }
      if (!FF.addressMap || FF.addressMap.ver !== ver) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = `./addressMap.js?v=${encodeURIComponent(ver)}`; s.onload = ok; s.onerror = () => no(new Error('Map module load nahi hua — page reload karo')); document.head.appendChild(s); });
      if (FF.addressMap) FF.addressMap.ver = ver;
      const rootEl = document.querySelector('.abx-scard') || document.body;
      let host = document.getElementById('ab-maphost');
      if (!host) { host = document.createElement('div'); host.id = 'ab-maphost'; rootEl.parentNode.insertBefore(host, rootEl.nextSibling); }
      const old = document.getElementById('amx'); if (old) { old.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      FF.addressMap.open({ host, channel: st.channel, q: st.q, fields: st.fields, kf: st.kf, loadActivity, actOf });
    } catch (err) { U.toast(String((err && err.message) || err), 'err'); }
  }
  async function mapView(root, box, d) {
    const host = U.$('#ab-mapbox', box);
    host.innerHTML = U.spinner('Map + active status aa raha hai…');
    const act = await loadActivity();
    const pinsData = d.pins || {};
    const inIndia = (g) => !!g && g[0] >= 6 && g[0] <= 37.5 && g[1] >= 68 && g[1] <= 98;   // galat / bahar ke pincode map ko kharab na karein
    const all = (d.rows || []).map((r) => { const g = pinsData[r.pincode] || null; return { ...r, a: actOf(act, r), g: inIndia(g) ? g : null }; });
    const stOf = (r) => (r.a && r.a.status) || 'none';
    const isAct = (r) => stOf(r) === 'active', isInact = (r) => stOf(r) === 'in1' || stOf(r) === 'in2';
    const tls = [...new Set(all.map((r) => r.tl).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const base = all.filter((r) => !st.tl || r.tl === st.tl);
    const want = st.status;
    const shown = base.filter((r) => want === 'all' || (want === 'active' ? isAct(r) : want === 'inactive' ? isInact(r) : stOf(r) === 'none'));
    const placed = shown.filter((r) => r.g);
    const bad = shown.filter((r) => !r.g);
    const groups = new Map();
    placed.forEach((r) => { if (!groups.has(r.pincode)) groups.set(r.pincode, { pin: r.pincode, lat: r.g[0], lng: r.g[1], district: r.g[2], state: r.g[3], list: [] }); groups.get(r.pincode).list.push(r); });
    const pts = [...groups.values()];
    const toneOfList = (list) => { const s = list.map(stOf); return s.includes('active') ? 'green' : s.includes('in1') ? 'amber' : s.includes('in2') ? 'red' : 'gray'; };
    const n = { all: base.length, active: base.filter(isAct).length, inactive: base.filter(isInact).length, none: base.filter((r) => stOf(r) === 'none').length };
    const states = new Map(); placed.forEach((r) => { const k = r.g[3] || '—'; const o = states.get(k) || { s: k, n: 0, a: 0 }; o.n++; if (isAct(r)) o.a++; states.set(k, o); });
    const stateList = [...states.values()].sort((a, b) => b.n - a.n);
    const actList = placed.filter(isAct).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    host.innerHTML = `<div class="ab-mapbar"><span class="grp">${[['all', `Sab (${n.all})`], ['active', `🟢 Active (${n.active})`], ['inactive', `🔴 Inactive (${n.inactive})`], ['none', `⚪ Status nahi (${n.none})`]].map(([k, l]) => `<button type="button" class="btn small${want === k ? ' primary' : ''}" data-st="${k}">${l}</button>`).join('')}</span>
        <select id="ab-tl" class="input small"><option value="">Sab TL</option>${tls.map((t) => `<option${st.tl === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <input id="ab-ms" class="input small" placeholder="🔎 pincode / naam / mobile — map par jao" style="min-width:230px">
        <span class="dim small">${U.fmt(placed.length)} agents · ${U.fmt(pts.length)} pincode</span></div>
      <div class="ab-legend small"><span><i class="ab-dot green static"></i> Active</span><span><i class="ab-dot amber static"></i> Inactive is mahine</span><span><i class="ab-dot red static"></i> Inactive 2 mahine</span><span><i class="ab-dot gray static"></i> Status nahi</span><span class="dim">· number = us jagah ke agents (zoom karo to alag ho jate hain)</span></div>
      <div class="ab-mapwrap"><div class="osm-map" id="ab-osm"><div class="osm-controls"><button type="button" data-mz="in">＋</button><button type="button" data-mz="out">−</button><button type="button" data-mfit="1" title="Sab dikhao">⌖</button></div><div class="osm-tiles"></div><div class="osm-pins"></div><div class="osm-attrib">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · pincode location approx</div></div>
        <div class="ab-side"><div class="ab-sh"><b>🟢 Active agents (${actList.length})</b> <small class="dim">click → map par</small></div>${actList.slice(0, 300).map((r, i) => `<div class="ab-srow" data-si="${i}"><b>${esc(r.name)}</b> <small class="dim">${esc(r.id)}</small><div class="small">📍 ${esc(r.g[2])}, ${esc(r.g[3])} · ${esc(r.pincode)}</div><div class="small dim">last: ${esc((r.a && r.a.lastActive) || '—')}</div></div>`).join('') || '<div class="dim small" style="padding:10px">Is filter me active agent nahi.</div>'}</div></div>
      <div class="ab-states small">${stateList.slice(0, 14).map((s) => `<button type="button" class="btn small" data-state="${esc(s.s)}">${esc(s.s)} <b>${s.n}</b>${s.a ? ` · 🟢${s.a}` : ''}</button>`).join(' ')}</div>
      ${bad.length ? `<details class="ab-bad small"><summary>⚠ ${bad.length} agents ka pincode map me nahi aaya (khaali / galat) — fix karo</summary>${bad.slice(0, 80).map((r) => `<div>${esc(r.name)} · ${esc(r.mobile)} · pin: <b>${esc(r.pincode || 'khaali')}</b></div>`).join('')}</details>` : ''}
      <div id="ab-pick" class="ab-pick dim small">Dot par click karo — us jagah ke agents, status aur last active yahan aayega.</div>`;
    host.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => { st.status = b.dataset.st; mapView(root, box, d); }; });
    U.$('#ab-tl', host).onchange = (e) => { st.tl = e.target.value; mapView(root, box, d); };
    const map = U.$('#ab-osm', host), tiles = U.$('.osm-tiles', map), pinsEl = U.$('.osm-pins', map), pick = U.$('#ab-pick', host);
    if (!pts.length) { map.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center">Is filter me map par dikhane ko agents nahi.</div>'; return; }
    let zoom = 5, center = { lat: 22.5, lng: 80 }, cl = [];
    const dim = () => ({ w: Math.max(300, map.clientWidth || 720), h: Math.max(300, map.clientHeight || 430) });
    const fitTo = (list, maxZ) => {
      const { w, h } = dim();
      for (let z = maxZ || 12; z >= 3; z--) { const ps = list.map((p) => proj(p.lat, p.lng, z)); const x0 = Math.min(...ps.map((p) => p.x)), x1 = Math.max(...ps.map((p) => p.x)), y0 = Math.min(...ps.map((p) => p.y)), y1 = Math.max(...ps.map((p) => p.y)); if (x1 - x0 <= w - 110 && y1 - y0 <= h - 110) { zoom = z; center = unproj((x0 + x1) / 2, (y0 + y1) / 2, z); break; } }
      draw();
    };
    const showPick = (g) => {
      pick.classList.remove('dim');
      pick.innerHTML = `<h4>📍 ${esc(g.pin)} — ${esc(g.district)}, ${esc(g.state)} <small class="dim">(${g.list.length} agent)</small> <a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${g.lat},${g.lng}">Google Maps ↗</a></h4><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Ch</th><th>Name</th><th>ID</th><th>Mobile</th><th>Status</th><th>Last active</th><th>Address</th></tr></thead><tbody>${g.list.map((r) => { const s = STAT[stOf(r)]; return `<tr><td>${chLabel(r.channel)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.id)}</td><td class="nowrap">${esc(r.mobile)}</td><td>${s[0]}</td><td>${esc((r.a && r.a.lastActive) || '—')}</td><td class="ab-addr">${esc(r.address)}</td></tr>`; }).join('')}</tbody></table></div>`;
      pick.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    function draw() {
      const { w, h } = dim(); const cp = proj(center.lat, center.lng, zoom); const ox = cp.x - w / 2, oy = cp.y - h / 2, nn = 2 ** zoom;
      let t = '';
      for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + h) / TILE); ty++) { if (ty < 0 || ty >= nn) continue; for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + w) / TILE); tx++) t += `<img src="https://tile.openstreetmap.org/${zoom}/${((tx % nn) + nn) % nn}/${ty}.png" alt="" draggable="false" style="left:${Math.round(tx * TILE - ox)}px;top:${Math.round(ty * TILE - oy)}px">`; }
      tiles.innerHTML = t;
      const cells = new Map();
      pts.forEach((g) => { const p = proj(g.lat, g.lng, zoom); const k = `${Math.floor(p.x / 44)}:${Math.floor(p.y / 44)}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(g); });
      cl = [...cells.values()].map((arr) => { const list = arr.flatMap((g) => g.list); return { arr, list, lat: arr.reduce((s, g) => s + g.lat, 0) / arr.length, lng: arr.reduce((s, g) => s + g.lng, 0) / arr.length }; });
      pinsEl.innerHTML = cl.map((c, i) => { const p = proj(c.lat, c.lng, zoom); const x = p.x - ox, y = p.y - oy; if (x < -40 || y < -40 || x > w + 40 || y > h + 40) return ''; const tone = toneOfList(c.list), cnt = c.list.length; const sz = cnt > 1 ? Math.min(40, 20 + Math.round(Math.log2(cnt) * 5)) : 16; const one = cnt === 1 && zoom >= 8 && tone === 'green' ? `<i class="ab-lbl">${esc(c.list[0].name)}</i>` : ''; return `<a href="#" class="ab-dot ${tone}" data-c="${i}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${sz}px;height:${sz}px" title="${esc(c.arr[0].pin)} · ${esc(c.arr[0].district)} · ${cnt} agent">${cnt > 1 ? cnt : ''}${one}</a>`; }).join('');
    }
    map.addEventListener('click', (e) => {
      const z = e.target.closest('[data-mz]'); if (z) { e.preventDefault(); zoom = Math.max(3, Math.min(17, zoom + (z.dataset.mz === 'in' ? 1 : -1))); draw(); return; }
      if (e.target.closest('[data-mfit]')) { e.preventDefault(); fitTo(pts, 12); return; }
      const dot = e.target.closest('[data-c]'); if (!dot) return; e.preventDefault();
      const c = cl[Number(dot.dataset.c)];
      if (c.arr.length > 1 && zoom < 16) { fitTo(c.arr, Math.min(17, zoom + 4)); return; }
      showPick(c.arr[0]);
    });
    host.querySelectorAll('[data-si]').forEach((el) => { el.onclick = () => { const r = actList[Number(el.dataset.si)]; const g = groups.get(r.pincode); center = { lat: g.lat, lng: g.lng }; zoom = 12; draw(); showPick(g); map.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }; });
    host.querySelectorAll('[data-state]').forEach((b) => { b.onclick = () => { const list = pts.filter((g) => g.state === b.dataset.state); if (list.length) fitTo(list, 9); }; });
    const ms = U.$('#ab-ms', host);
    ms.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return; const q = ms.value.trim().toLowerCase(); if (!q) return;
      const hit = pts.filter((g) => g.pin === q.replace(/\D/g, '') || g.list.some((r) => String(r.name).toLowerCase().includes(q) || String(r.mobile).includes(q.replace(/\D/g, '') || '~')));
      if (!hit.length) { U.toast('Map par nahi mila', 'warn'); return; }
      fitTo(hit, 12); if (hit.length === 1) showPick(hit[0]);
    });
    let drag = null;
    map.addEventListener('pointerdown', (e) => { if (e.target.closest('button,a')) return; drag = { x: e.clientX, y: e.clientY, c: proj(center.lat, center.lng, zoom) }; map.setPointerCapture(e.pointerId); });
    map.addEventListener('pointermove', (e) => { if (!drag) return; center = unproj(drag.c.x - (e.clientX - drag.x), drag.c.y - (e.clientY - drag.y), zoom); draw(); });
    const end = () => { drag = null; }; map.addEventListener('pointerup', end); map.addEventListener('pointercancel', end);
    map.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(3, Math.min(17, zoom + (e.deltaY < 0 ? 1 : -1))); draw(); }, { passive: false });
    fitTo(pts, 12);
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
    // ⚡ Instant: popup turant band + list se local update; server delete/sync background me (fail ho to wapas load).
    const dropLocal = (keys) => {
      if (!st.data || !Array.isArray(st.data.rows)) return;
      const ks = new Set(keys);
      st.data.rows = st.data.rows.filter((r) => !(ks.has(r.key) || (r.altKeys || []).some((k) => ks.has(k))));
      if (st.data.counts) { /* count server se agle load par theek ho jayega */ }
      try { paint(root); } catch { /* list repaint optional */ }
    };
    ov.querySelector('#ab-both').onclick = () => {
      close(); st.later.add(gkey);
      if (st.data && Array.isArray(st.data.rows)) st.data.rows.forEach((r) => { if (r.gkey === gkey) r.conflict = false; });
      try { paint(root); } catch { /* optional */ }
      U.toast('✅ Dono rakhe', 'ok');
      FF.auth.api('/api/address-book/resolve', 'POST', { mode: 'both', gkey }).catch((err) => { alert('Save nahi hua: ' + err.message); load(root); });
    };
    ov.querySelectorAll('[data-keep]').forEach((b) => { b.onclick = () => {
      const keep = list[Number(b.dataset.keep)];
      const drop = list.filter((r) => r !== keep).flatMap((r) => [r.key, ...(r.altKeys || [])]);
      close();
      U.toast('✅ Sahi address rakh liya — baaki hat rahe hain', 'ok');
      dropLocal(drop);
      FF.auth.api('/api/address-book/resolve', 'POST', { mode: 'one', gkey, drop }).catch((err) => { alert('Delete nahi hua: ' + err.message); load(root); });
    }; });
  }

  /** Search term → popup ka prefill (mobile / pincode / ID / naam). */
  function prefillOf(t) {
    const raw = String(t || '').trim(), dg = raw.replace(/\D/g, '');
    if (/^(\+?91[\s-]*)?[6-9][\d\s-]{9,13}$/.test(raw) && dg.slice(-10).length === 10) return { mobile: dg.slice(-10) };
    if (/^[1-9]\d{5}$/.test(raw)) return { pincode: raw };
    if (/^[A-Za-z]{0,4}\d{4,}$/.test(raw.replace(/\s/g, ''))) return { id: raw.replace(/\s/g, '') };
    return { name: raw };
  }
  /** 📊 KPI cards — colourful, clickable (server-side filter). */
  function kpiStrip(d) {
    const srch = !!d.skpi, k = d.skpi || d.kpi || {}, f = st.kf || '';
    const card = (key, ico, label, val, cls, sub) => `<button type="button" class="ab-kpi ${cls}${(f === key || (key === '' && !f)) ? ' on' : ''}" data-kf="${key}"><span class="ab-ki">${ico}</span><span class="ab-kv">${U.fmt(val || 0)}</span><span class="ab-kl">${label}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
    const pct = k.total ? Math.round((k.complete || 0) * 100 / k.total) : 0;
    const fix = d.canUpload ? 'click → list me bharo ✍️' : 'click → list';
    const head = srch ? `<div class="ab-khead">🔎 <b>Search ka hisaab</b> · ${U.fmt(k.terms)} search me <span class="ok-t">${U.fmt(k.found)} mile</span>${k.terms - k.found ? ` · <span class="bad-t">${U.fmt(k.terms - k.found)} nahi mile</span>` : ''} · ${U.fmt(k.total)} address <small class="dim">(poore data ke liye search khaali karo)</small></div>` : '';
    return `${head}<div class="ab-kpis${srch ? ' srch' : ''}">${card('', srch ? '🔎' : '📍', srch ? 'Search me mile' : 'Total address', k.total, 'k-blue', srch ? 'sab dikhao' : 'sab dikhao')}${card('complete', '✅', 'Poora (mobile+pin+address)', k.complete, 'k-green', `<span class="ab-bar2"><i style="width:${pct}%"></i></span>${pct}% complete`)}${card('nomobile', '📵', 'Mobile nahi', k.noMobile, 'k-red', fix)}${card('nopin', '📮', 'Pincode nahi', k.noPin, 'k-amber', fix)}${card('noaddr', '🏠', 'Address nahi / chhota', k.noAddr, 'k-orange', fix)}${card('multi', '⚠', '2+ address (conflict)', k.multi, 'k-purple', 'check karo')}${card('tagreq', '📝', 'Tag request se', k.tagReq, 'k-teal', 'edit ✏️ bhi ho sakta')}</div>`;
  }
  /** 🔎 Multi-search ka hisaab: kitne mile, kaun nahi mile (har ek par ➕ Add address). */
  function termPanel(d) {
    const ts = d.termStats || [];
    if (!ts.length) return '';
    const miss = ts.filter((x) => !x.n), got = ts.filter((x) => x.n);
    const addB = (x) => (d.canUpload ? ` <button type="button" class="btn small primary" data-addterm="${esc(x.t)}">➕ Add address</button>` : '');
    return `<div class="ab-terms"><div class="ab-tsum"><b>🔎 ${ts.length} search</b> · <span class="ok-t">✅ ${got.length} mile</span> · <span class="${miss.length ? 'bad-t' : 'ok-t'}">${miss.length ? '❌' : '✅'} ${miss.length} nahi mile</span>${miss.length ? ' <button type="button" class="btn small" id="ab-misscopy">📋 Nahi mile copy</button>' : ''}</div>
      ${miss.length ? `<div class="ab-miss">${miss.slice(0, 60).map((x) => `<span class="ab-mchip">❌ <b>${esc(x.t)}</b>${addB(x)}</span>`).join('')}${miss.length > 60 ? `<span class="dim small"> +${miss.length - 60} aur</span>` : ''}</div>` : ''}
      ${got.length ? `<details class="ab-found"><summary class="dim small">✅ ${got.length} mile — dekho</summary><div class="ab-miss">${got.slice(0, 80).map((x) => `<span class="ab-mchip ok">✅ ${esc(x.t)} <small class="dim">(${x.n})</small></span>`).join('')}</div></details>` : ''}</div>`;
  }
  /** ➕ Naya address / ✏️ edit popup — name · mobile · pincode · agent ID · channel · TL · address → site + Google Sheet. */
  function addModal(root, o) {
    if (document.getElementById('ab-add')) return;
    const e = o.edit || null, pre = e ? { name: e.name, mobile: e.mobile, pincode: e.pincode, id: e.id, address: e.address, tl: e.tl, channel: e.channel } : (o || {});
    const allowed = (st.data && st.data.channels) || ['ff', 'gv'];
    const ov = document.createElement('div');
    ov.id = 'ab-add'; ov.className = 'ab-ov';
    ov.innerHTML = `<div class="ab-md"><h3>${e ? '✏️ Address edit' : '➕ Naya address'}</h3>
      <p class="dim small">${e ? 'Badlav site + Google Sheet dono me save honge.' : 'Save karte hi site me aur Google Sheet ke Address tab me chala jayega. Mobile / ID likhte hi baaki details apne aap bhar jati hain.'}</p>
      <div class="ab-form">
        <label>Name *<input class="input" id="af-name" value="${esc(pre.name || '')}" autocomplete="off"></label>
        <label>Mobile * <input class="input" id="af-mobile" inputmode="numeric" maxlength="14" value="${esc(pre.mobile || '')}" autocomplete="off"></label>
        <label>Agent ID <input class="input" id="af-id" value="${esc(pre.id || '')}" autocomplete="off"></label>
        <label>Pincode <input class="input" id="af-pin" inputmode="numeric" maxlength="6" value="${esc(pre.pincode || '')}" autocomplete="off"><small id="af-geo" class="dim"></small></label>
        <label>Channel <select class="input" id="af-ch"><option value="">Auto (mobile / ID se)</option>${allowed.map((x) => `<option value="${x}"${pre.channel === x ? ' selected' : ''}>${x === 'gv' ? '🟩 GV' : '🟦 FF'}</option>`).join('')}</select></label>
        <label>TL <input class="input" id="af-tl" value="${esc(pre.tl || '')}" autocomplete="off"></label>
        <label class="af-wide">Address * <textarea class="input" id="af-addr" rows="3">${esc(pre.address || '')}</textarea></label>
      </div>
      <div id="af-hint" class="small" style="margin:6px 0"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="af-cancel" type="button">Cancel</button><button class="btn primary" id="af-save" type="button">💾 Save</button></div></div>`;
    document.body.appendChild(ov);
    const g = (id) => ov.querySelector('#' + id), close = () => ov.remove();
    g('af-cancel').onclick = close;
    ov.addEventListener('mousedown', (ev) => { if (ev.target === ov) close(); });
    const hint = (h, cls) => { g('af-hint').innerHTML = h ? `<span class="${cls || 'dim'}">${h}</span>` : ''; };
    let lastQ = '';
    const lookup = async (by) => {
      const mobile = g('af-mobile').value.replace(/\D/g, '').slice(-10), id = g('af-id').value.trim();
      const key = by === 'id' ? `i:${id}` : `m:${mobile}`;
      if (key === lastQ) return;
      if (by === 'mobile' && mobile.length !== 10) return;
      if (by === 'id' && id.length < 4) return;
      lastQ = key;
      try {
        const j = await apiJson(`/api/address-book/lookup?${by === 'id' ? `id=${encodeURIComponent(id)}` : `mobile=${mobile}`}`);
        const f = j.found;
        if (f) {
          if (!g('af-name').value.trim() && f.name) g('af-name').value = f.name;
          if (!g('af-id').value.trim() && f.id) g('af-id').value = f.id;
          if (!g('af-mobile').value.trim() && f.mobile) g('af-mobile').value = f.mobile;
          if (!g('af-tl').value.trim() && f.tl) g('af-tl').value = f.tl;
          if (!g('af-ch').value && f.channel) g('af-ch').value = f.channel;
        }
        const ex = j.existing || [];
        hint(f ? `✅ Agent mila${f.via ? ` (${esc(f.via)})` : ''}: <b>${esc(f.name || '')}</b> ${f.id ? '· ID ' + esc(f.id) : ''} ${f.tl ? '· TL ' + esc(f.tl) : ''}${ex.length && !e ? `<br>⚠ Is mobile ka address pehle se hai: <i>${esc(ex[0].address)}</i> — alag likhoge to naya version banega (search me chuno).` : ''}` : (by === 'mobile' ? 'ℹ Is mobile ka agent site data me nahi mila — ID / channel khud bharo.' : ''), f ? 'ok-t' : 'dim');
      } catch { /* optional */ }
    };
    g('af-mobile').addEventListener('input', () => { if (g('af-mobile').value.replace(/\D/g, '').length >= 10) lookup('mobile'); });
    g('af-mobile').addEventListener('blur', () => lookup('mobile'));
    g('af-id').addEventListener('blur', () => lookup('id'));
    const geo = async () => {
      const pin = g('af-pin').value.replace(/\D/g, '');
      if (pin.length !== 6) { g('af-geo').textContent = ''; return; }
      try { const j = await apiJson(`/api/address-book/lookup?pincode=${pin}`); g('af-geo').textContent = j.geo ? `📍 ${j.geo.district}, ${j.geo.state}` : '⚠ Pincode list me nahi mila'; } catch { /* optional */ }
    };
    g('af-pin').addEventListener('input', geo);
    g('af-addr').addEventListener('blur', () => { if (g('af-pin').value.trim()) return; const m = g('af-addr').value.match(/(?<!\d)[1-9]\d{5}(?!\d)/g); if (m) { g('af-pin').value = m[m.length - 1]; geo(); } });
    if (pre.pincode) geo();
    if (pre.mobile && !e) lookup('mobile'); else if (pre.id && !e) lookup('id');
    (g('af-name').value ? (g('af-addr').value ? g('af-save') : g('af-addr')) : g('af-name')).focus();
    g('af-save').onclick = async () => {
      const body = { name: g('af-name').value, mobile: g('af-mobile').value, id: g('af-id').value, pincode: g('af-pin').value, channel: g('af-ch').value, tl: g('af-tl').value, address: g('af-addr').value };
      if (e) body.key = e.key;
      if (!body.name.trim()) { hint('Name likho.', 'bad-t'); return; }
      if (body.mobile.replace(/\D/g, '').length < 10) { hint('Mobile 10 digit ka likho.', 'bad-t'); return; }
      if (body.address.trim().length < 5) { hint('Address likho.', 'bad-t'); return; }
      const b = g('af-save'); b.disabled = true; b.textContent = 'Save ho raha hai…';
      try {
        const out = await FF.auth.api('/api/address-book/save', 'POST', body);
        close();
        const msg = out.mode === 'edit' ? '✅ Address update ho gaya' : out.versions ? '⚠ Is mobile ka alag address pehle se tha — naya version save hua (search karke sahi chuno)' : out.unchanged ? 'ℹ Ye address pehle se saved tha' : '✅ Address save ho gaya';
        U.toast(`${msg}${out.sync && out.sync.running ? ' · Sheet sync chal raha hai…' : ''}`, 'ok');
        load(root);
        if (o && typeof o.onSaved === 'function') { try { o.onSaved(out, body); } catch { /* optional */ } }
      } catch (err) { b.disabled = false; b.textContent = '💾 Save'; hint(esc(err.message || err), 'bad-t'); }
    };
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
    root.innerHTML = `<div class="ab-hero abx-hero"><div class="abx-htxt"><span class="abx-badge">📍 Management · Agents</span><h1>Agents Address</h1><p>Agent ka address · mobile · pincode · TL — pehle <b>tag request</b> ka address, phir <b>Address tab</b>. Ek saath kai search, khaali cheezein yahin bharo.</p></div><div class="abx-hright"><div class="abx-hstats" id="ab-herostats"></div><button type="button" class="abx-heromap" id="ab-heromap">🗺 Map dekho <small>📍 meri location · satellite · paas ke agents</small></button></div></div>
      <section class="card abx-scard"><div class="card-body">
        <div class="abx-top"><div id="ab-tabs" class="ab-tabs abx-tabs"></div><div class="abx-fields"><span class="abx-fl">🔎 Kisme dhundhe:</span>${FIELDS.map(([k, l]) => `<label class="abx-pill"><input type="checkbox" data-f="${k}"${st.fields.includes(k) ? ' checked' : ''}><span>${l}</span></label>`).join('')}<span id="ab-fl" hidden></span></div></div>
        <div class="ab-search abx-search">
          <div class="abx-qwrap"><span class="abx-qico">🔍</span><textarea id="ab-q" class="input ab-bigq" rows="3" placeholder="Ek ya kai: naam / mobile / pincode / ID — comma ya nayi line se alag karo (jaise 9876543210, 301706, Rahul)">${esc(st.q)}</textarea></div>
          <div class="ab-sbtns"><button class="btn primary ab-gobtn" id="ab-go">🔎 Search</button><button class="btn abx-clr" id="ab-clear">✖ Clear</button></div>
        </div>
        <div id="ab-results"></div>
      </div></section>
      <section class="card abx-upcard" id="ab-up"${can('addressUpload') ? '' : ' hidden'}><div class="card-head"><h3>⬆ Address upload <small class="dim">(kisi bhi format me)</small></h3></div><div class="card-body">
        <label class="abx-drop" id="ab-drop"><input type="file" id="ab-file" accept=".pdf,.xlsx,.xlsm,.csv,.tsv,.txt,.text,.md,*/*" hidden><span class="abx-dico">📂</span><b>File yahan chhodo ya click karke chuno</b><small>PDF · Excel (.xlsx) · CSV · text — columns ya upar-niche likha text (Name / Mo / Address / Pin). ID, TL aur channel mobile se apne aap. Pehle preview, phir save.</small><span class="abx-types"><i>PDF</i><i>XLSX</i><i>CSV</i><i>TXT</i></span></label>
        <div style="margin-top:8px"><button class="btn small" id="ab-paste-t">📋 Text paste karo</button></div>
        <div id="ab-paste" hidden style="margin-top:8px"><textarea id="ab-pt" class="input" rows="6" placeholder="Yahan address text paste karo…"></textarea><button class="btn" id="ab-pgo">Preview</button></div>
        <div id="ab-preview"></div>
      </div></section>
      <style>.ab-hero{border-radius:18px;padding:20px 24px;margin-bottom:14px;color:#fff;background:linear-gradient(120deg,#4f46e5 0%,#0ea5e9 45%,#10b981 100%);box-shadow:0 8px 24px rgba(79,70,229,.25)}.ab-hero h1{margin:0 0 4px;font-size:30px;color:#fff!important;text-shadow:0 2px 6px rgba(0,0,0,.25)}.ab-hero p{margin:0;opacity:.95}.ab-hero b{color:#fef08a}
.ab-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 12px}.ab-kpi{all:unset;box-sizing:border-box;cursor:pointer;border-radius:14px;padding:12px 14px;color:#fff;display:grid;gap:1px;position:relative;box-shadow:0 4px 12px rgba(0,0,0,.15);transition:transform .12s,box-shadow .12s}.ab-kpi:hover{transform:translateY(-2px);box-shadow:0 8px 18px rgba(0,0,0,.22)}.ab-kpi.on{outline:3px solid #111;outline-offset:2px}.ab-ki{font-size:20px}.ab-kv{font-size:28px;font-weight:800;line-height:1.1}.ab-kl{font-size:12px;font-weight:700;opacity:.95}.ab-kpi small{opacity:.8;font-size:11px}
.k-blue{background:linear-gradient(135deg,#2563eb,#3b82f6)}.k-green{background:linear-gradient(135deg,#16a34a,#4ade80)}.k-red{background:linear-gradient(135deg,#dc2626,#f87171)}.k-amber{background:linear-gradient(135deg,#d97706,#fbbf24)}.k-orange{background:linear-gradient(135deg,#ea580c,#fb923c)}.k-purple{background:linear-gradient(135deg,#7c3aed,#a78bfa)}.k-teal{background:linear-gradient(135deg,#0d9488,#2dd4bf)}
.ab-bigq{font-size:17px!important;min-height:78px;padding:12px 14px!important;border:2px solid #6366f1!important;border-radius:14px!important;background:linear-gradient(180deg,#fff,#eef2ff);box-shadow:0 2px 10px rgba(99,102,241,.2)}.ab-bigq:focus{outline:none;border-color:#0ea5e9!important;box-shadow:0 0 0 4px rgba(14,165,233,.25)}.ab-search{align-items:stretch!important}.ab-sbtns{display:grid;gap:6px}.ab-gobtn{font-size:16px!important;padding:12px 22px!important;background:linear-gradient(135deg,#4f46e5,#0ea5e9)!important;color:#fff!important;border:0!important}
.ab-tbl tbody tr.ab-r-gv td:first-child{border-left:4px solid #16a34a}.ab-tbl tbody tr.ab-r-ff td:first-child{border-left:4px solid #2563eb}.ab-tbl tbody tr.ab-r-gv:hover td{background:rgba(22,163,74,.08)}.ab-tbl tbody tr.ab-r-ff:hover td{background:rgba(37,99,235,.08)}.ab-tbl thead th{background:linear-gradient(135deg,#eef2ff,#e0f2fe)}
.ab-pin{background:#dbeafe;color:#1d4ed8;border-radius:999px;padding:2px 9px;font-weight:700}.ab-bd{color:#b91c1c;font-size:12px;font-weight:700}.ab-src{border-radius:999px;padding:2px 9px;font-size:11px;font-weight:700}.ab-src.tr{background:#ccfbf1;color:#0f766e}.ab-src.ad{background:#ede9fe;color:#6d28d9}
.ab-terms{background:linear-gradient(135deg,#f0f9ff,#f5f3ff);border-color:#a5b4fc!important}.ab-tsum{font-size:15px}.ab-mchip{font-weight:600}
/* 🎨 v3.125.376 — Agents Address: glossy KPI tiles, fill mode, colourful table */
.ab-hero{position:relative;overflow:hidden;background:linear-gradient(120deg,#7c3aed 0%,#4f46e5 30%,#0ea5e9 65%,#14b8a6 100%)!important}.ab-hero:after{content:"";position:absolute;right:-60px;top:-60px;width:220px;height:220px;border-radius:50%;background:rgba(255,255,255,.14)}.ab-hero:before{content:"";position:absolute;right:120px;bottom:-80px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,.08)}
.ab-khead{margin:2px 0 8px;padding:8px 12px;border-radius:12px;background:linear-gradient(90deg,rgba(99,102,241,.12),rgba(14,165,233,.08));border:1px solid rgba(99,102,241,.25);font-size:13px}
.ab-kpi{overflow:hidden;padding:14px 16px!important;min-height:112px;border:1px solid rgba(255,255,255,.25)}.ab-kpi:after{content:"";position:absolute;right:-26px;bottom:-26px;width:90px;height:90px;border-radius:50%;background:rgba(255,255,255,.16)}
.ab-ki{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:rgba(255,255,255,.25);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);font-size:19px!important;margin-bottom:4px}
.ab-kv{font-size:30px!important;letter-spacing:-.02em}.ab-kpi.on{outline:none!important;box-shadow:0 0 0 3px #fff,0 0 0 6px #1e1b4b,0 10px 24px rgba(0,0,0,.25)!important;transform:translateY(-2px)}
.ab-kpis.srch .ab-kpi{animation:abPop .35s ease}@keyframes abPop{from{transform:scale(.96);opacity:.6}to{transform:none;opacity:1}}
.ab-bar2{display:block;height:5px;border-radius:9px;background:rgba(255,255,255,.3);margin:4px 0 2px;overflow:hidden}.ab-bar2 i{display:block;height:100%;background:#fff;border-radius:9px}
.k-blue{background:linear-gradient(135deg,#1d4ed8,#3b82f6 55%,#60a5fa)!important}.k-green{background:linear-gradient(135deg,#15803d,#22c55e 55%,#86efac)!important}.k-red{background:linear-gradient(135deg,#b91c1c,#ef4444 55%,#fca5a5)!important}.k-amber{background:linear-gradient(135deg,#b45309,#f59e0b 55%,#fde68a)!important}.k-orange{background:linear-gradient(135deg,#c2410c,#f97316 55%,#fdba74)!important}.k-purple{background:linear-gradient(135deg,#6d28d9,#8b5cf6 55%,#c4b5fd)!important}.k-teal{background:linear-gradient(135deg,#0f766e,#14b8a6 55%,#99f6e4)!important}
.ab-fillbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0 8px;padding:10px 12px;border-radius:12px;background:linear-gradient(90deg,#fef3c7,#fff7ed);border:1px solid #fbbf24;font-size:13px}
.ab-fill{min-width:140px;font-size:13px!important;padding:5px 8px!important;border:2px dashed #f59e0b!important;background:#fffbeb!important;border-radius:8px!important}.ab-fill.dirty{border-style:solid!important;border-color:#16a34a!important;background:#f0fdf4!important}.ab-fill-pin{min-width:90px;width:96px}textarea.ab-fill{width:100%;min-width:220px}
.ab-tbl{border-collapse:separate;border-spacing:0}.ab-tbl thead th{position:sticky;top:0;z-index:2;background:linear-gradient(135deg,#4f46e5,#0ea5e9)!important;color:#fff!important;font-size:11px;letter-spacing:.05em;text-transform:uppercase;border:0!important}
.ab-tbl tbody tr:nth-child(even) td{background:rgba(99,102,241,.04)}.ab-tbl tbody td{border-bottom:1px solid rgba(148,163,184,.25)}.ab-tbl tbody tr td:nth-child(3) b{color:#1e1b4b}
.ab-src.tr{background:linear-gradient(135deg,#ccfbf1,#99f6e4)!important;color:#115e59!important}.ab-src.ad{background:linear-gradient(135deg,#ede9fe,#ddd6fe)!important;color:#5b21b6!important}.ab-pin{background:linear-gradient(135deg,#dbeafe,#bfdbfe)!important;box-shadow:inset 0 0 0 1px #93c5fd}
.ab-bd{display:inline-block;padding:1px 8px;border-radius:999px;background:#fee2e2}
/* 🌈 v3.125.378 — Agents Address full redesign */
.abx-hero{display:flex!important;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;padding:26px 30px!important;border-radius:22px!important;background:radial-gradient(circle at 12% 20%,rgba(255,255,255,.18),transparent 40%),linear-gradient(115deg,#6d28d9 0%,#4f46e5 28%,#0284c7 60%,#0d9488 100%)!important;box-shadow:0 14px 34px rgba(79,70,229,.32)!important;text-align:left}
.abx-htxt{position:relative;z-index:1;max-width:640px}.abx-htxt h1{font-size:32px!important;margin:6px 0 4px!important;letter-spacing:-.01em}.abx-htxt p{font-size:14px;line-height:1.5}
.abx-badge{display:inline-block;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.2);font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
.abx-hstats{position:relative;z-index:1;display:flex;gap:10px;flex-wrap:wrap}.abx-hs{min-width:86px;padding:10px 14px;border-radius:16px;background:rgba(255,255,255,.16);backdrop-filter:blur(6px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3);display:flex;flex-direction:column;align-items:center;color:#fff}.abx-hs b{font-size:22px;line-height:1.1}.abx-hs i{font-style:normal;font-size:11px;font-weight:700;opacity:.9}
.abx-hs.ff{background:rgba(59,130,246,.35)}.abx-hs.gv{background:rgba(34,197,94,.32)}.abx-hs.ring{background:conic-gradient(#fde047 calc(var(--p)*1%),rgba(255,255,255,.18) 0);border-radius:50%;min-width:0;width:82px;height:82px;justify-content:center;position:relative}.abx-hs.ring:before{content:"";position:absolute;inset:7px;border-radius:50%;background:#4338ca}.abx-hs.ring b,.abx-hs.ring i{position:relative}.abx-hs.ring b{font-size:18px}
.abx-scard{border-radius:20px!important;border:0!important;background:linear-gradient(#fff,#fff) padding-box,linear-gradient(135deg,#a78bfa,#38bdf8,#34d399) border-box!important;border:2px solid transparent!important;box-shadow:0 10px 30px rgba(15,23,42,.08)!important}
.abx-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.abx-tabs{margin:0!important;padding:4px;border-radius:999px;background:#f1f5f9;display:inline-flex!important;gap:4px}.abx-tab{all:unset;cursor:pointer;padding:7px 14px;border-radius:999px;font-weight:800;font-size:13px;color:#334155;transition:.15s}.abx-tab:hover{background:#e2e8f0}
.abx-tab.on{color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.18)}.abx-tab.t-all.on{background:linear-gradient(135deg,#6d28d9,#4f46e5)}.abx-tab.t-ff.on{background:linear-gradient(135deg,#1d4ed8,#3b82f6)}.abx-tab.t-gv.on{background:linear-gradient(135deg,#15803d,#22c55e)}
.abx-fields{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.abx-fl{font-size:12px;font-weight:800;color:#475569}.abx-pill{cursor:pointer}.abx-pill input{display:none}.abx-pill span{display:inline-block;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:700;border:1.5px solid #cbd5e1;color:#64748b;background:#fff;transition:.15s}.abx-pill input:checked+span{border-color:transparent;color:#fff;background:linear-gradient(135deg,#0ea5e9,#6366f1);box-shadow:0 3px 8px rgba(99,102,241,.3)}
.abx-search{display:flex!important;gap:10px!important}.abx-qwrap{position:relative;flex:1;min-width:260px}.abx-qico{position:absolute;left:14px;top:13px;font-size:18px;opacity:.7;pointer-events:none}.abx-qwrap .ab-bigq{width:100%;padding-left:44px!important;min-height:70px;border-radius:16px!important;background:linear-gradient(180deg,#fff,#f5f3ff)!important}
.ab-gobtn{border-radius:14px!important;box-shadow:0 6px 16px rgba(79,70,229,.35)!important}.abx-clr{border-radius:14px!important;border:1.5px solid #fca5a5!important;color:#b91c1c!important;background:#fff1f2!important;font-weight:700}
.ab-bar,.ab-act,.ab-tools{padding:8px 12px;border-radius:14px;background:linear-gradient(90deg,#f8fafc,#eef2ff);border:1px solid #e0e7ff}.ab-bar b{font-size:16px;color:#4338ca}
.ab-tbl tbody tr{transition:background .12s}.table-wrap.tall{border-radius:16px;border:1px solid #e0e7ff;box-shadow:0 6px 18px rgba(15,23,42,.06)}
.abx-skel{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:6px 0 12px}.abx-sk{height:96px;border-radius:14px;opacity:.35;animation:abxPulse 1.2s ease-in-out infinite}.sk-b{background:#3b82f6}.sk-g{background:#22c55e}.sk-r{background:#ef4444}.sk-a{background:#f59e0b}.sk-o{background:#f97316}.sk-p{background:#8b5cf6}.sk-t{background:#14b8a6}
.abx-skrow{height:14px;border-radius:9px;margin:10px auto;width:70%;background:linear-gradient(90deg,#e0e7ff,#f5f3ff,#e0e7ff);background-size:200% 100%;animation:abxShim 1.3s linear infinite}.abx-skrow.short{width:40%}.abx-skt{text-align:center;font-weight:700;color:#4f46e5}
@keyframes abxPulse{50%{opacity:.6}}@keyframes abxShim{to{background-position:-200% 0}}
.abx-upcard{border-radius:20px!important;overflow:hidden}.abx-upcard .card-head{background:linear-gradient(90deg,rgba(14,165,233,.14),rgba(16,185,129,.1))}
.abx-drop{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;padding:24px;border-radius:18px;border:2.5px dashed #818cf8;background:linear-gradient(135deg,#eef2ff,#ecfeff);cursor:pointer;transition:.15s}.abx-drop:hover,.abx-drop.over{border-color:#0ea5e9;background:linear-gradient(135deg,#e0f2fe,#dcfce7);transform:translateY(-1px)}.abx-dico{font-size:34px}.abx-drop b{font-size:15px;color:#3730a3}.abx-drop small{color:#64748b;max-width:620px}
.abx-types{display:flex;gap:6px}.abx-types i{font-style:normal;font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;color:#fff;background:#ef4444}.abx-types i:nth-child(2){background:#16a34a}.abx-types i:nth-child(3){background:#0ea5e9}.abx-types i:nth-child(4){background:#64748b}
.abx-hright{position:relative;z-index:1;display:flex;flex-direction:column;align-items:flex-end;gap:10px}.abx-heromap{border:0;cursor:pointer;border-radius:14px;padding:10px 16px;font-weight:800;font-size:14px;color:#1e1b4b;background:linear-gradient(135deg,#fde047,#facc15);box-shadow:0 6px 16px rgba(0,0,0,.25);display:flex;flex-direction:column;align-items:flex-start}.abx-heromap small{font-size:10px;font-weight:700;opacity:.75}.abx-heromap:hover{transform:translateY(-1px)}.abx-mapbtn{background:linear-gradient(135deg,#f59e0b,#ef4444)!important;color:#fff!important;border:0!important;font-weight:800}
@media(max-width:700px){.abx-hero{padding:18px!important}.abx-htxt h1{font-size:24px!important}.abx-hs{min-width:70px;padding:8px 10px}}</style>
      <style>.ab-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.ab-search{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-bottom:10px}.ab-search textarea{flex:1;min-width:240px}.ab-fields{position:relative}.ab-fields summary{cursor:pointer;list-style:none}.ab-fbox{position:absolute;z-index:20;background:var(--card,#fff);border:1px solid var(--line,#ddd);border-radius:10px;padding:8px 12px;display:grid;gap:6px;box-shadow:0 6px 20px rgba(0,0,0,.15);min-width:170px}.ab-bar{margin:6px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.ab-addr{min-width:260px;max-width:480px;white-space:normal}.nowrap{white-space:nowrap}.ab-pv{border:1px dashed var(--line,#ccc);border-radius:12px;padding:12px;margin-top:12px}.ab-chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.ab-flag td{background:rgba(255,193,7,.12)}.ab-conf td{background:rgba(255,152,0,.10)}.ab-terms{border:1px solid var(--line,#ddd);border-radius:12px;padding:10px 12px;margin-bottom:10px;background:rgba(0,0,0,.02)}.ab-miss{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.ab-mchip{display:inline-flex;gap:6px;align-items:center;padding:3px 8px;border-radius:999px;border:1px solid rgba(220,38,38,.35);background:rgba(220,38,38,.06)}.ab-mchip.ok{border-color:rgba(22,163,74,.35);background:rgba(22,163,74,.06)}.ok-t{color:#15803d}.bad-t{color:#b91c1c}.ab-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ab-form label{display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:600}.ab-form .af-wide{grid-column:1/-1}@media(max-width:640px){.ab-form{grid-template-columns:1fr}}.ab-legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:4px 0 8px}.ab-dot{position:absolute;transform:translate(-50%,-50%);border-radius:50%;border:2px solid #fff;background:var(--c,#64748b);color:#fff;font:700 11px/1 system-ui;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.4);z-index:3;text-decoration:none!important}.ab-dot.green{--c:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.28),0 1px 4px rgba(0,0,0,.4)}.ab-dot.amber{--c:#f59e0b}.ab-dot.red{--c:#ef4444}.ab-dot.gray{--c:#64748b}.ab-dot.static{position:static;display:inline-block;width:12px;height:12px;transform:none;vertical-align:middle}.ab-lbl{position:absolute;left:calc(100% + 6px);top:50%;transform:translateY(-50%);white-space:nowrap;background:rgba(255,255,255,.94);color:#064e3b;padding:1px 5px;border-radius:5px;font:600 10px/1.3 system-ui;font-style:normal;box-shadow:0 1px 3px rgba(0,0,0,.25)}.ab-mapwrap{display:grid;grid-template-columns:1fr 300px;gap:10px}@media(max-width:900px){.ab-mapwrap{grid-template-columns:1fr}}.ab-side{max-height:clamp(340px,55vh,540px);overflow:auto;border:1px solid var(--line,#ddd);border-radius:12px}.ab-sh{padding:8px;position:sticky;top:0;background:var(--card,#fff);border-bottom:1px solid var(--line,#ddd)}.ab-srow{padding:7px 8px;border-bottom:1px solid var(--line,#eee);cursor:pointer}.ab-srow:hover{background:rgba(22,163,74,.10)}.ab-states{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.ab-bad{margin:6px 0}.ab-tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:6px 0}.ab-mapbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0}.ab-pick{margin:8px 0;padding:8px}.ab-cnt{position:absolute;top:-10px;left:6px;background:#111;color:#fff;border-radius:9px;font-size:10px;padding:0 5px;line-height:15px}.osm-pin.ab-x{}.ab-act{margin:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.btn.danger{color:#b91c1c;border-color:#fca5a5}.ab-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:14px}.ab-md{background:var(--card,#fff);color:inherit;border-radius:14px;padding:16px;max-width:760px;width:100%;max-height:88vh;overflow:auto}.ab-cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.ab-card{border:1px solid var(--line,#ddd);border-radius:10px;padding:10px;display:grid;gap:6px}</style>`;
    const flLabel = () => { U.$('#ab-fl', root).textContent = st.fields.map((k) => (FIELDS.find((f) => f[0] === k) || [k, k])[1]).join(' · ') || 'kuch nahi'; };
    flLabel();
    root.querySelectorAll('[data-f]').forEach((cb) => { cb.onchange = () => { st.fields = [...root.querySelectorAll('[data-f]')].filter((x) => x.checked).map((x) => x.dataset.f); if (!st.fields.length) { cb.checked = true; st.fields = [cb.dataset.f]; } flLabel(); if (st.q.trim()) load(root); }; });
    const q = U.$('#ab-q', root);
    const go = () => { st.q = q.value; load(root); };
    U.$('#ab-go', root).onclick = go;
    U.$('#ab-clear', root).onclick = () => { q.value = ''; st.q = ''; st.kf = ''; load(root); };
    q.addEventListener('input', () => { clearTimeout(st.timer); st.timer = setTimeout(go, 300); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
    const file = U.$('#ab-file', root);
    if (file) file.onchange = () => { if (file.files[0]) upload(root, file.files[0]); };
    const hm = U.$('#ab-heromap', root); if (hm) hm.onclick = openFullMap;
    const drop = U.$('#ab-drop', root);
    if (drop) { ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); })); drop.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) upload(root, f); }); }
    const pt = U.$('#ab-paste-t', root);
    if (pt) pt.onclick = () => { U.$('#ab-paste', root).hidden = !U.$('#ab-paste', root).hidden; };
    const pg = U.$('#ab-pgo', root);
    if (pg) pg.onclick = () => { const t = U.$('#ab-pt', root).value.trim(); if (t) upload(root, null, t); };
    load(root);
  }
  /** ➕ Dusre pages (Master Search / Master Profile) se "Add address" popup — save → site + Google Sheet. */
  function ensureModalCss() {
    if (document.getElementById('ab-modal-css')) return;
    const css = '.ab-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:14px}.ab-md{background:var(--card,#fff);color:inherit;border-radius:14px;padding:16px;max-width:760px;width:100%;max-height:88vh;overflow:auto}.ab-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ab-form label{display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:600}.ab-form .af-wide{grid-column:1/-1}@media(max-width:640px){.ab-form{grid-template-columns:1fr}}.ok-t{color:#15803d}.bad-t{color:#b91c1c}.ab-addbtn{background:linear-gradient(135deg,#f97316,#ec4899)!important;color:#fff!important;border:0!important;font-weight:700;border-radius:999px!important;padding:5px 14px!important;box-shadow:0 3px 10px rgba(236,72,153,.35)}';
    const el = document.createElement('style'); el.id = 'ab-modal-css'; el.textContent = css; document.head.appendChild(el);
  }
  FF.addressBook = { add(o) { ensureModalCss(); addModal(document.body, o || {}); } };
  FF.pages.addressBook = { title: 'Agents Address', render };
})(window.FF);
