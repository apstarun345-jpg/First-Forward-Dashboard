/* 🗺 v3.125.379 — Agents Address · Full-screen Map (Leaflet, site ke andar hi — bahar ki script nahi).
   • Asli map: drag, pinch / scroll zoom, ＋ / − , scale, 3 layer (Street · Light · Satellite)
   • 📍 Meri location (live) + "Mere paas" — sabse nazdeek agents km ke saath
   • Cluster (rang = active / inactive), ek hi pincode ke kai agents → spiderfy
   • Filters: status · channel · TL · search (pincode / naam / mobile / ID) → flyTo
   • Side list = map me jo dikh raha hai; popup me 📞 Call · 💬 WhatsApp · 🧭 Raasta · 📋 Copy
   Data: /api/address-book?geo=1 (pincode → lat/lng) + agentsOverview (active status). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  let leafletP = null;
  const assetV = (n) => { try { const m = document.querySelector('meta[name="ff-asset-versions"]'); const v = m ? JSON.parse(m.content) : {}; return v[n] ? `?v=${v[n]}` : ''; } catch { return ''; } };
  function needLeaflet() {
    if (window.L && window.L.markerClusterGroup) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    const js = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Map library load nahi hui')); document.head.appendChild(s); });
    if (!document.getElementById('ff-leaflet-css')) { const l = document.createElement('link'); l.id = 'ff-leaflet-css'; l.rel = 'stylesheet'; l.href = `./vendor-leaflet.css${assetV('vendor-leaflet')}`; document.head.appendChild(l); }
    leafletP = js(`./vendor-leaflet.js${assetV('vendor-leaflet')}`).then(() => js(`./vendor-leaflet-cluster.js${assetV('vendor-leaflet-cluster')}`)).then(() => window.L).catch((e) => { leafletP = null; throw e; });
    return leafletP;
  }
  const inIndia = (g) => !!g && g[0] >= 6 && g[0] <= 37.5 && g[1] >= 68 && g[1] <= 98;
  const km = (a, b) => { const R = 6371, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const ST = { active: ['Active', '#16a34a', '🟢'], in1: ['Inactive · is mahine', '#f59e0b', '🟠'], in2: ['Inactive · 2 mahine', '#ef4444', '🔴'], none: ['Status nahi', '#64748b', '⚪'] };
  const fmtKm = (d) => (d < 1 ? `${Math.round(d * 1000)} m` : d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d)} km`);

  /** o: { channel, q, fields, kf, loadActivity(), actOf(act, r) } */
  async function open(o) {
    if (document.getElementById('amx')) return;
    const ov = document.createElement('div');
    ov.id = 'amx'; ov.className = 'amx';
    ov.innerHTML = `<div class="amx-top">
        <div class="amx-title">🗺 <b>Agents Map</b> <small id="amx-sub">load ho raha hai…</small></div>
        <div class="amx-search"><input id="amx-q" class="input" placeholder="🔎 Pincode / naam / mobile / ID — Enter"><button class="amx-btn" id="amx-go">Jao</button></div>
        <div class="amx-tb">
          <select id="amx-ch" class="input"><option value="all">Sab channel</option><option value="ff">🟦 FF</option><option value="gv">🟩 GV</option></select>
          <select id="amx-tl" class="input"><option value="">Sab TL</option></select>
          <button class="amx-btn loc" id="amx-me" title="Meri current location">📍 Meri location</button>
          <button class="amx-btn" id="amx-side" title="List dikhao / chhupao">☰ List</button>
          <button class="amx-btn close" id="amx-x" title="Band karo (Esc)">✕</button>
        </div></div>
      <div class="amx-chips" id="amx-chips"></div>
      <div class="amx-body"><div id="amx-map" class="amx-map"><div class="amx-loading">${U.spinner ? U.spinner('Map + agents load ho rahe hain…') : 'Load…'}</div></div>
        <aside class="amx-side" id="amx-panel"><div class="amx-sh"><div class="amx-tabs"><button class="on" data-tab="view">👁 Map me dikh rahe</button><button data-tab="near">📍 Mere paas</button><button data-tab="bad">⚠ Pincode galat</button></div><small id="amx-cnt" class="dim"></small></div><div class="amx-list" id="amx-list"></div></aside></div>`;
    document.body.appendChild(ov);
    document.documentElement.classList.add('amx-lock');
    const $ = (s) => ov.querySelector(s);
    let map = null, cluster = null, meMarker = null, meCircle = null, watchId = null, me = null, tab = 'view';
    const close = () => { if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId); document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('amx-lock'); try { if (map) map.remove(); } catch { /* ignore */ } ov.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    $('#amx-x').onclick = close;
    $('#amx-side').onclick = () => { ov.classList.toggle('noside'); setTimeout(() => map && map.invalidateSize(), 220); };
    $('#amx-ch').value = o.channel || 'all';

    let L, rows = [], act = new Map();
    try {
      [L] = await Promise.all([needLeaflet()]);
      const qs = `channel=${encodeURIComponent($('#amx-ch').value)}&fields=${(o.fields || ['name', 'mobile', 'pincode', 'id']).join(',')}&q=${encodeURIComponent(o.q || '')}&kf=${encodeURIComponent(o.kf || '')}&limit=5000&geo=1`;
      const [d, a] = await Promise.all([FF.auth.api(`/api/address-book?${qs}`), o.loadActivity ? o.loadActivity().catch(() => new Map()) : Promise.resolve(new Map())]);
      act = a || new Map();
      const pins = d.pins || {};
      rows = (d.rows || []).map((r) => { const g = pins[r.pincode]; const a2 = o.actOf ? o.actOf(act, r) : null; return { ...r, g: inIndia(g) ? g : null, st: (a2 && a2.status) || 'none', last: (a2 && a2.lastActive) || '' }; });
    } catch (err) { $('#amx-map').innerHTML = `<div class="amx-loading">${U.errorBox ? U.errorBox(err) : esc(String(err && err.message || err))}</div>`; return; }

    // ---- map --------------------------------------------------------------------------------
    $('#amx-map').innerHTML = '';
    map = L.map($('#amx-map'), { zoomControl: false, worldCopyJump: true, minZoom: 4, maxZoom: 18 }).setView([22.5, 80], 5);
    const layers = {
      '🗺 Street': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }),
      '🧭 Road (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' }),
      '🛰 Satellite': L.layerGroup([L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' }), L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })])
    };
    layers['🗺 Street'].addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.layers(layers, null, { position: 'topright', collapsed: false }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    const fitBtn = L.control({ position: 'bottomright' });
    fitBtn.onAdd = () => { const b = L.DomUtil.create('button', 'amx-fab'); b.title = 'Sab agents dikhao'; b.innerHTML = '⌖'; L.DomEvent.on(b, 'click', (e) => { L.DomEvent.stop(e); fitAll(); }); return b; };
    fitBtn.addTo(map);

    const tls = [...new Set(rows.map((r) => r.tl).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $('#amx-tl').innerHTML = '<option value="">Sab TL</option>' + tls.map((t) => `<option>${esc(t)}</option>`).join('');
    let want = 'all';
    const filtered = () => rows.filter((r) => (!$('#amx-tl').value || r.tl === $('#amx-tl').value) && ($('#amx-ch').value === 'all' || r.channel === $('#amx-ch').value) && (want === 'all' || (want === 'inactive' ? (r.st === 'in1' || r.st === 'in2') : r.st === want)));

    const pop = (r) => {
      const s = ST[r.st] || ST.none, mob = String(r.mobile || '').replace(/\D/g, '').slice(-10);
      const dist = me && r.g ? ` · <b>${fmtKm(km(me, r.g))}</b> door` : '';
      return `<div class="amx-pop"><div class="amx-ph ${r.channel}"><b>${esc(r.name)}</b><span>${r.channel === 'gv' ? '🟩 GV' : '🟦 FF'}</span></div>
        <div class="amx-pr"><span class="amx-st" style="--c:${s[1]}">${s[2]} ${s[0]}</span>${r.last ? ` <small>· last ${esc(r.last)}</small>` : ''}</div>
        ${r.id ? `<div class="amx-pr"><small>ID</small> <b>${esc(r.id)}</b></div>` : ''}${r.tl ? `<div class="amx-pr"><small>TL</small> ${esc(r.tl)}</div>` : ''}
        <div class="amx-pr addr">📍 ${esc(r.address || '')} <b>${esc(r.pincode || '')}</b>${r.g ? `<br><small>${esc(r.g[2] || '')}, ${esc(r.g[3] || '')}${dist}</small>` : ''}</div>
        <div class="amx-pa">${mob ? `<a class="c" href="tel:${mob}">📞 Call</a><a class="w" target="_blank" rel="noopener" href="https://wa.me/91${mob}">💬 WhatsApp</a>` : ''}${r.g ? `<a class="d" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1${me ? `&origin=${me[0]},${me[1]}` : ''}&destination=${encodeURIComponent(`${r.address || ''} ${r.pincode || ''}`.trim() || `${r.g[0]},${r.g[1]}`)}">🧭 Raasta</a>` : ''}<button type="button" class="p" data-amx-copy="${esc(`${r.name}\n${mob}\n${r.address || ''}${r.pincode && !String(r.address || '').includes(r.pincode) ? ' ' + r.pincode : ''}`)}">📋 Copy</button></div></div>`;
    };
    const tone = (sts) => (sts.includes('active') ? 'green' : sts.includes('in1') ? 'amber' : sts.includes('in2') ? 'red' : 'gray');
    let markers = new Map();
    function draw(fit) {
      if (cluster) map.removeLayer(cluster);
      cluster = L.markerClusterGroup({
        showCoverageOnHover: false, spiderfyOnMaxZoom: true, maxClusterRadius: 48, chunkedLoading: true,
        iconCreateFunction: (c) => { const ms = c.getAllChildMarkers(); const n = ms.length, t = tone(ms.map((m) => m.options.st)); const sz = n < 10 ? 34 : n < 100 ? 42 : 52; return L.divIcon({ html: `<span>${n}</span>`, className: `amx-cl ${t}`, iconSize: [sz, sz] }); }
      });
      markers = new Map();
      const list = filtered().filter((r) => r.g);
      list.forEach((r, i) => {
        const s = ST[r.st] || ST.none;
        const m = L.marker([r.g[0], r.g[1]], { st: r.st, icon: L.divIcon({ className: `amx-pin ${r.channel}`, html: `<i style="--c:${s[1]}"></i>`, iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -20] }) });
        m.bindPopup(() => pop(r), { maxWidth: 300, className: 'amx-popw' });
        cluster.addLayer(m); markers.set(r, m); r._i = i;
      });
      map.addLayer(cluster);
      const all = filtered(), n = { all: 0, active: 0, inactive: 0, none: 0 };
      rows.filter((r) => (!$('#amx-tl').value || r.tl === $('#amx-tl').value) && ($('#amx-ch').value === 'all' || r.channel === $('#amx-ch').value)).forEach((r) => { n.all++; if (r.st === 'active') n.active++; else if (r.st === 'in1' || r.st === 'in2') n.inactive++; else n.none++; });
      $('#amx-chips').innerHTML = [['all', `Sab ${n.all}`, ''], ['active', `🟢 Active ${n.active}`, 'g'], ['inactive', `🔴 Inactive ${n.inactive}`, 'r'], ['none', `⚪ Status nahi ${n.none}`, 'n']].map(([k, l, c]) => `<button type="button" class="amx-chip ${c}${want === k ? ' on' : ''}" data-want="${k}">${l}</button>`).join('') + `<span class="amx-legend"><i style="--c:#16a34a"></i>Active <i style="--c:#f59e0b"></i>Is mahine inactive <i style="--c:#ef4444"></i>2 mahine <i style="--c:#64748b"></i>Status nahi · <b>🟦</b> FF <b>🟩</b> GV ring</span>`;
      $('#amx-sub').textContent = `${U.fmt(list.length)} agents map par · ${U.fmt(new Set(list.map((r) => r.pincode)).size)} pincode${all.length - list.length ? ` · ${all.length - list.length} ka pincode galat` : ''}`;
      if (fit) fitAll();
      paintList();
    }
    function fitAll() { const pts = filtered().filter((r) => r.g).map((r) => [r.g[0], r.g[1]]); if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 12 }); }
    function focus(r) { const m = markers.get(r); if (!m) return; cluster.zoomToShowLayer(m, () => m.openPopup()); if (window.innerWidth < 760) ov.classList.add('noside'); }
    function paintList() {
      const host = $('#amx-list'); let list = [];
      if (tab === 'view') { const b = map.getBounds(); list = filtered().filter((r) => r.g && b.contains([r.g[0], r.g[1]])); if (me) list.sort((a, b2) => km(me, a.g) - km(me, b2.g)); else list.sort((a, b2) => String(a.name).localeCompare(String(b2.name))); }
      else if (tab === 'near') { if (!me) { host.innerHTML = '<div class="amx-empty">📍 Pehle <b>Meri location</b> dabao — phir sabse paas wale agents km ke saath yahan aayenge.</div>'; $('#amx-cnt').textContent = ''; return; } list = filtered().filter((r) => r.g).sort((a, b2) => km(me, a.g) - km(me, b2.g)).slice(0, 60); }
      else list = filtered().filter((r) => !r.g);
      $('#amx-cnt').textContent = `${U.fmt(list.length)} agents`;
      host.innerHTML = list.slice(0, 250).map((r, i) => { const s = ST[r.st] || ST.none; return `<div class="amx-li ${r.channel}" data-li="${i}"><i class="dot" style="--c:${s[1]}"></i><div><b>${esc(r.name)}</b><small>${esc(r.id || '')}${r.tl ? ` · ${esc(r.tl)}` : ''}</small><small>📍 ${r.g ? `${esc(r.g[2] || '')} · ${esc(r.pincode)}` : `pin: <b class="bad">${esc(r.pincode || 'khaali')}</b>`}${me && r.g ? ` · <b class="km">${fmtKm(km(me, r.g))}</b>` : ''}</small></div></div>`; }).join('') || '<div class="amx-empty">Is jagah koi agent nahi — zoom out karo.</div>';
      host.querySelectorAll('[data-li]').forEach((el) => { el.onclick = () => { const r = list[Number(el.dataset.li)]; if (r && r.g) focus(r); else if (r) U.toast('Is agent ka pincode map me nahi — Agents Address me pincode theek karo', 'warn'); }; });
    }
    map.on('moveend', () => { if (tab === 'view') paintList(); });
    ov.addEventListener('click', (e) => {
      const w = e.target.closest('[data-want]'); if (w) { want = w.dataset.want; draw(true); return; }
      const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; ov.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === t)); paintList(); return; }
      const c = e.target.closest('[data-amx-copy]'); if (c) { (navigator.clipboard ? navigator.clipboard.writeText(c.dataset.amxCopy) : Promise.reject()).then(() => { c.textContent = '✅ Copied'; }).catch(() => {}); }
    });
    $('#amx-tl').onchange = () => draw(true);
    $('#amx-ch').onchange = () => draw(true);
    const search = () => {
      const q = $('#amx-q').value.trim().toLowerCase(); if (!q) return;
      const dg = q.replace(/\D/g, '');
      const hit = filtered().filter((r) => r.g && (r.pincode === dg || String(r.name).toLowerCase().includes(q) || (dg.length >= 5 && String(r.mobile).includes(dg)) || String(r.id).toLowerCase() === q));
      if (!hit.length) { U.toast('Map par nahi mila (pincode galat ho sakta hai)', 'warn'); return; }
      if (hit.length === 1) focus(hit[0]); else map.fitBounds(hit.map((r) => [r.g[0], r.g[1]]), { padding: [60, 60], maxZoom: 13 });
    };
    $('#amx-go').onclick = search;
    $('#amx-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

    // ---- 📍 meri location (live) ---------------------------------------------------------------
    $('#amx-me').onclick = () => {
      if (!navigator.geolocation) { U.toast('Is device me location nahi chalti', 'err'); return; }
      const b = $('#amx-me'); b.classList.add('busy'); b.textContent = '⏳ Location…';
      let first = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition((p) => {
        me = [p.coords.latitude, p.coords.longitude];
        const acc = Math.max(10, p.coords.accuracy || 50);
        if (!meMarker) { meMarker = L.marker(me, { icon: L.divIcon({ className: 'amx-me', html: '<i></i>', iconSize: [20, 20] }), zIndexOffset: 1000 }).addTo(map).bindTooltip('📍 Aap yahan ho'); meCircle = L.circle(me, { radius: acc, color: '#2563eb', weight: 1, fillOpacity: 0.12 }).addTo(map); }
        else { meMarker.setLatLng(me); meCircle.setLatLng(me).setRadius(acc); }
        b.classList.remove('busy'); b.classList.add('on'); b.textContent = '📍 Live';
        if (first) { first = false; map.flyTo(me, 11); tab = 'near'; ov.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'near')); ov.classList.remove('noside'); }
        paintList();
      }, (err) => { b.classList.remove('busy'); b.textContent = '📍 Meri location'; U.toast(err && err.code === 1 ? 'Location ki permission nahi di — browser me Allow karo' : 'Location nahi mili — GPS / internet check karo', 'err'); }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
    };
    draw(true);
    setTimeout(() => map.invalidateSize(), 120);
  }
  (function css() { if (document.getElementById('amx-css')) return; const el = document.createElement('style'); el.id = 'amx-css'; el.textContent = '.amx-lock,.amx-lock body{overflow:hidden!important}.amx{position:fixed;inset:0;z-index:10050;display:flex;flex-direction:column;background:#0f172a;color:#0f172a;font-size:13px}.amx-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 14px;background:linear-gradient(110deg,#6d28d9,#4f46e5 35%,#0284c7 70%,#0d9488);color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.3)}.amx-title{font-size:18px;display:flex;align-items:baseline;gap:10px;min-width:220px}.amx-title small{font-size:12px;opacity:.9}.amx-search{display:flex;gap:6px;flex:1;min-width:240px}.amx-search .input{flex:1;border-radius:12px!important;border:0!important;padding:9px 12px!important;font-size:14px}.amx-tb{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.amx-tb .input{border-radius:10px!important;border:0!important;padding:7px 9px!important;max-width:170px}.amx-btn{border:0;border-radius:10px;padding:8px 12px;font-weight:800;cursor:pointer;background:rgba(255,255,255,.2);color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}.amx-btn:hover{background:rgba(255,255,255,.32)}.amx-btn.loc{background:linear-gradient(135deg,#f59e0b,#ef4444)}.amx-btn.loc.on{background:linear-gradient(135deg,#16a34a,#22c55e);animation:amxGlow 1.6s infinite}.amx-btn.busy{opacity:.7}.amx-btn.close{background:#fff;color:#b91c1c;font-size:16px;padding:6px 12px}@keyframes amxGlow{50%{box-shadow:0 0 0 5px rgba(34,197,94,.35)}}.amx-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 14px;background:#fff;border-bottom:1px solid #e2e8f0}.amx-chip{border:1.5px solid #cbd5e1;background:#fff;border-radius:999px;padding:5px 12px;font-weight:800;font-size:12px;cursor:pointer;color:#334155}.amx-chip.on{color:#fff;border-color:transparent;background:linear-gradient(135deg,#4f46e5,#0ea5e9)}.amx-chip.g.on{background:linear-gradient(135deg,#15803d,#22c55e)}.amx-chip.r.on{background:linear-gradient(135deg,#b91c1c,#f97316)}.amx-chip.n.on{background:linear-gradient(135deg,#475569,#94a3b8)}.amx-legend{margin-left:auto;font-size:11px;color:#475569;display:flex;gap:6px;align-items:center;flex-wrap:wrap}.amx-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--c)}.amx-body{flex:1;display:grid;grid-template-columns:1fr 340px;min-height:0}.amx.noside .amx-body{grid-template-columns:1fr 0}.amx.noside .amx-side{display:none}.amx-map{position:relative;min-height:0;background:#e2e8f0}.amx-loading{position:absolute;inset:0;display:grid;place-items:center;background:#fff}.amx-side{background:#f8fafc;border-left:1px solid #e2e8f0;display:flex;flex-direction:column;min-height:0}.amx-sh{padding:8px;border-bottom:1px solid #e2e8f0;background:#fff;display:grid;gap:4px}.amx-tabs{display:flex;gap:4px}.amx-tabs button{flex:1;border:0;border-radius:9px;padding:7px 4px;font-size:11px;font-weight:800;cursor:pointer;background:#eef2ff;color:#3730a3}.amx-tabs button.on{background:linear-gradient(135deg,#4f46e5,#0ea5e9);color:#fff}.amx-list{overflow:auto;flex:1;padding:6px}.amx-li{display:flex;gap:9px;padding:8px 9px;margin-bottom:5px;border-radius:12px;background:#fff;border:1px solid #e2e8f0;border-left:4px solid #3b82f6;cursor:pointer}.amx-li.gv{border-left-color:#16a34a}.amx-li:hover{background:#eef2ff}.amx-li .dot{flex:0 0 12px;height:12px;margin-top:4px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 25%,transparent)}.amx-li b{display:block;font-size:13px}.amx-li small{display:block;font-size:11px;color:#64748b}.amx-li .km{color:#0f766e}.amx-li .bad{color:#b91c1c}.amx-empty{padding:20px;text-align:center;color:#64748b}.amx-pin{background:none!important;border:0!important}.amx-pin i{display:block;width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--c);border:3px solid #2563eb;box-shadow:0 2px 6px rgba(0,0,0,.4)}.amx-pin.gv i{border-color:#16a34a}.amx-cl{border-radius:50%;display:grid!important;place-items:center;color:#fff;font-weight:800;border:3px solid rgba(255,255,255,.85);box-shadow:0 3px 10px rgba(0,0,0,.35)}.amx-cl span{font-size:13px}.amx-cl.green{background:radial-gradient(circle,#22c55e,#15803d)}.amx-cl.amber{background:radial-gradient(circle,#fbbf24,#d97706)}.amx-cl.red{background:radial-gradient(circle,#f87171,#b91c1c)}.amx-cl.gray{background:radial-gradient(circle,#94a3b8,#475569)}.amx-me{background:none!important;border:0!important}.amx-me i{display:block;width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 0 rgba(37,99,235,.6);animation:amxPulse 1.8s infinite}@keyframes amxPulse{70%{box-shadow:0 0 0 16px rgba(37,99,235,0)}100%{box-shadow:0 0 0 0 rgba(37,99,235,0)}}.amx-fab{width:34px;height:34px;border-radius:8px;border:2px solid rgba(0,0,0,.2);background:#fff;font-size:18px;cursor:pointer}.amx-popw .leaflet-popup-content{margin:0;width:280px!important}.amx-popw .leaflet-popup-content-wrapper{padding:0;border-radius:14px;overflow:hidden}.amx-pop{font-size:12px}.amx-ph{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;color:#fff;background:linear-gradient(135deg,#1d4ed8,#3b82f6)}.amx-ph.gv{background:linear-gradient(135deg,#15803d,#22c55e)}.amx-ph b{font-size:14px}.amx-pr{padding:3px 12px}.amx-pr small{color:#64748b}.amx-pr.addr{padding-top:6px;line-height:1.4}.amx-st{display:inline-block;padding:1px 8px;border-radius:999px;font-weight:800;background:color-mix(in srgb,var(--c) 18%,#fff);color:var(--c)}.amx-pa{display:flex;flex-wrap:wrap;gap:5px;padding:8px 12px 10px}.amx-pa a,.amx-pa button{flex:1 1 auto;text-align:center;border:0;border-radius:9px;padding:6px 8px;font-weight:800;font-size:11px;text-decoration:none!important;cursor:pointer;color:#fff!important}.amx-pa .c{background:#2563eb}.amx-pa .w{background:#16a34a}.amx-pa .d{background:#ea580c}.amx-pa .p{background:#7c3aed}.leaflet-control-layers{border-radius:12px!important;font-size:12px}@media(max-width:760px){.amx-body{grid-template-columns:1fr}.amx-side{position:absolute;left:0;right:0;bottom:0;height:42vh;z-index:1000;border-top:2px solid #6366f1;border-radius:16px 16px 0 0}.amx-title{font-size:15px;min-width:0}.amx-legend{display:none}}'; document.head.appendChild(el); })();
  FF.addressMap = { open, needLeaflet };
})(window.FF);
