/* 🗺 Team map — admin page: jinhone location share ki (Settings → 📍 ya phone), unka office-se
   distance, last-seen, accuracy. Office center = Settings → 🎛 Features → Office location.
   Koi external map tile nahi — lightweight SVG plot (offline bhi chalta hai). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;

  const R = 6371; // km
  const rad = (d) => (d * Math.PI) / 180;
  function haversine(a, b, c, d) {
    const dLat = rad(c - a), dLng = rad(d - b);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  const rel = (iso) => {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms)) return '—';
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'abhi abhi';
    if (m < 60) return `${m} min pehle`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ghante pehle`;
    return `${Math.floor(h / 24)} din pehle`;
  };

  function plot(people, office) {
    const W = 720, H = 420, PAD = 46;
    const pts = people.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const hasOffice = office && office.lat && office.lng;
    const all = pts.map((p) => [p.lat, p.lng]).concat(hasOffice ? [[office.lat, office.lng]] : []);
    if (!all.length) return `<div class="empty-state">Kisi ne bhi location share nahi ki.<br><small>Users apne 📱 Settings → My account se “Share my location” dabayein.</small></div>`;
    let minLat = Math.min(...all.map((a) => a[0])), maxLat = Math.max(...all.map((a) => a[0]));
    let minLng = Math.min(...all.map((a) => a[1])), maxLng = Math.max(...all.map((a) => a[1]));
    const spanLat = Math.max(0.01, maxLat - minLat), spanLng = Math.max(0.01, maxLng - minLng);
    const px = (lat, lng) => [PAD + ((lng - minLng) / spanLng) * (W - 2 * PAD), H - PAD - ((lat - minLat) / spanLat) * (H - 2 * PAD)];
    const pins = pts.map((p, i) => {
      const [x, y] = px(p.lat, p.lng);
      const dist = hasOffice ? haversine(office.lat, office.lng, p.lat, p.lng) : null;
      const color = dist === null ? '#64748b' : dist <= 2 ? '#10b981' : dist <= 10 ? '#f59e0b' : '#ef4444';
      const dy = i % 2 === 0 ? -14 : 22;
      return `<g class="map-pin" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
        <circle r="8" fill="${color}" stroke="#fff" stroke-width="2.5"><title>${esc(p.name)}${dist !== null ? ` · ${dist.toFixed(1)} km` : ''}</title></circle>
        <text y="${dy}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#0f172a" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(p.name.slice(0, 16))}</text>
      </g>`;
    }).join('');
    const officeMark = hasOffice ? (() => {
      const [x, y] = px(office.lat, office.lng);
      return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><rect x="-9" y="-9" width="18" height="18" rx="4" fill="#0f172a" stroke="#fff" stroke-width="2.5"/><text y="26" text-anchor="middle" font-size="11" font-weight="800" fill="#0f172a" paint-order="stroke" stroke="#fff" stroke-width="3">🏢 Office</text></g>`;
    })() : '';
    return `<svg class="map-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Team location plot">
      <rect width="${W}" height="${H}" rx="14" fill="#eef4ff"/>
      ${Array.from({ length: 7 }, (_, i) => `<line x1="${(i + 1) * (W / 8)}" y1="0" x2="${(i + 1) * (W / 8)}" y2="${H}" stroke="#dbe6ff"/><line x1="0" y1="${(i + 1) * (H / 8)}" x2="${W}" y2="${(i + 1) * (H / 8)}" stroke="#dbe6ff"/>`).join('')}
      ${officeMark}${pins}
    </svg>${hasOffice ? '' : '<p class="dim small">🏢 Office set nahi hai — Settings → 🎛 Features → Office location me lat/lng daalo.</p>'}`;
  }

  async function render(root) {
    root.innerHTML = `<div class="page-head"><div><h1>🗺 Team map</h1><p class="sub">Jinhone location share ki — office se distance, last-seen + accuracy</p></div>
      <div class="head-actions"><button class="btn" id="tm-refresh">↻ Refresh</button></div></div>
      <div id="tm-body">${U.spinner('Location aa rahi hai…')}</div>`;
    const body = U.$('#tm-body', root);
    const load = async () => {
      try {
        const out = await FF.auth.api('/api/team-location');
        if (!root.isConnected) return;
        const people = out.people || [];
        const office = out.office || { lat: 0, lng: 0 };
        const hasOffice = office.lat || office.lng;
        const rows = people.map((p) => {
          const dist = hasOffice && p.lat ? haversine(office.lat, office.lng, p.lat, p.lng) : null;
          const band = dist === null ? '—' : dist <= 2 ? '🟢' : dist <= 10 ? '🟡' : '🔴';
          return `<tr><td><b>${esc(p.name)}</b> ${p.role === 'admin' ? '👑' : ''}</td>
            <td class="num">${dist === null ? '—' : `<b>${dist.toFixed(1)} km</b> ${band}`}</td>
            <td>${esc(rel(p.at))}</td>
            <td class="small dim">${p.accuracy != null ? `±${U.fmt(p.accuracy)} m` : '—'}</td>
            <td class="small dim">${esc(String(p.lat || '')).slice(0, 8)}, ${esc(String(p.lng || '')).slice(0, 8)}</td>
            <td class="small dim">${esc(rel(p.lastLoginAt))}</td></tr>`;
        }).join('');
        body.innerHTML = `<section class="card"><div class="card-head"><h3>📍 Live positions <span class="dim">· ${people.length} log</span></h3>
            <div class="card-right dim small">🟢 ≤2 km · 🟡 ≤10 km · 🔴 10+ km</div></div>
          <div class="card-body">${plot(people, office)}
          ${people.length ? `<div class="table-wrap" style="margin-top:12px"><table class="tbl compact"><thead><tr><th>User</th><th class="num">Office se door</th><th>Location aayi</th><th>Accuracy</th><th>Lat, Lng</th><th>Last login</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
          </div></section>
        <p class="dim small">Location user khud share karta hai (My account → 📍 Share). Admin bhi manually doosre users ki location nahi set kar sakta — privacy.</p>`;
      } catch (err) { body.innerHTML = U.errorBox(err); }
    };
    U.$('#tm-refresh', root).addEventListener('click', load);
    await load();
  }

  FF.pages.teamMap = { title: 'Team map', render };
})(window.FF);
