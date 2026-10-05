/* 🗺 Team map — consent-based last shared locations on real OpenStreetMap tiles.
   Office center = Settings → 🎛 Features → Office location. No silent/background GPS tracking. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;

  const EARTH_KM = 6371;
  const TILE = 256;
  const rad = (d) => (d * Math.PI) / 180;
  const coord = (p) => !!p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Number(p.lat) >= -90 && Number(p.lat) <= 90 && Number(p.lng) >= -180 && Number(p.lng) <= 180;
  function haversine(a, b, c, d) {
    const dLat = rad(c - a), dLng = rad(d - b);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
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
  const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;

  function project(lat, lng, zoom) {
    const n = TILE * (2 ** zoom);
    const x = ((Number(lng) + 180) / 360) * n;
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
    const phi = rad(clamped);
    const y = (1 - Math.log(Math.tan(phi) + (1 / Math.cos(phi))) / Math.PI) / 2 * n;
    return { x, y };
  }
  function unproject(x, y, zoom) {
    const n = TILE * (2 ** zoom);
    const lng = (x / n) * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    return { lat, lng };
  }
  function pinTone(dist) { return dist === null ? 'gray' : dist <= 2 ? 'green' : dist <= 10 ? 'amber' : 'red'; }

  /** Tiny dependency-free slippy map: OSM tiles + our own markers, fit/zoom/pan. */
  function mountMap(host, people, office) {
    if (!host) return;
    const team = (people || []).filter(coord).map((p) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }));
    const officeOk = coord(office) && !(Number(office.lat) === 0 && Number(office.lng) === 0);
    const points = team.map((p) => ({ ...p, kind: 'person' }));
    if (officeOk) points.push({ lat: Number(office.lat), lng: Number(office.lng), name: 'Office', kind: 'office' });
    if (!points.length) {
      host.innerHTML = `<div class="empty-state">📍 Abhi map par dikhane ke liye location nahi hai.<br><small>Users: Settings → My account → “Share my location” · Admin: Settings → Features → Office location.</small></div>`;
      return;
    }

    host.innerHTML = `<div class="osm-map" role="application" aria-label="Team locations on map">
      <div class="osm-tiles" aria-hidden="true"></div><div class="osm-pins"></div>
      <div class="osm-controls"><button type="button" data-map-zoom="in" aria-label="Zoom in">＋</button><button type="button" data-map-zoom="out" aria-label="Zoom out">−</button><button type="button" data-map-fit aria-label="Fit all locations" title="Sab locations fit karo">⌖</button></div>
      <div class="osm-attrib">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</div>
    </div>`;
    const map = U.$('.osm-map', host), tiles = U.$('.osm-tiles', host), pins = U.$('.osm-pins', host);
    let zoom = 12, center = { lat: points[0].lat, lng: points[0].lng };
    let frame = 0;

    function dimensions() { return { w: Math.max(300, map.clientWidth || 720), h: Math.max(300, map.clientHeight || 430) }; }
    function fit() {
      const { w, h } = dimensions();
      for (let z = 18; z >= 2; z--) {
        const ps = points.map((p) => project(p.lat, p.lng, z));
        const minX = Math.min(...ps.map((p) => p.x)), maxX = Math.max(...ps.map((p) => p.x));
        const minY = Math.min(...ps.map((p) => p.y)), maxY = Math.max(...ps.map((p) => p.y));
        if (maxX - minX <= w - 110 && maxY - minY <= h - 120) {
          zoom = z;
          center = unproject((minX + maxX) / 2, (minY + maxY) / 2, z);
          break;
        }
      }
      // A single point should show the nearby roads, not a building-level over-zoom.
      if (points.length === 1) zoom = Math.min(15, zoom);
      renderTiles();
    }
    function renderTiles() {
      const { w, h } = dimensions();
      const cp = project(center.lat, center.lng, zoom);
      const ox = cp.x - w / 2, oy = cp.y - h / 2;
      const n = 2 ** zoom;
      const firstX = Math.floor(ox / TILE), lastX = Math.floor((ox + w) / TILE);
      const firstY = Math.floor(oy / TILE), lastY = Math.floor((oy + h) / TILE);
      let tileHtml = '';
      for (let ty = firstY; ty <= lastY; ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = firstX; tx <= lastX; tx++) {
          const wrappedX = ((tx % n) + n) % n;
          tileHtml += `<img src="https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png" alt="" draggable="false" loading="eager" style="left:${Math.round(tx * TILE - ox)}px;top:${Math.round(ty * TILE - oy)}px">`;
        }
      }
      tiles.innerHTML = tileHtml;
      pins.innerHTML = points.map((p) => {
        const at = project(p.lat, p.lng, zoom);
        const x = at.x - ox, y = at.y - oy;
        if (p.kind === 'office') return `<a class="osm-pin office" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px" href="${mapsUrl(p.lat, p.lng)}" target="_blank" rel="noopener" aria-label="Office location"><span>🏢</span><b>Office</b></a>`;
        const dist = officeOk ? haversine(Number(office.lat), Number(office.lng), p.lat, p.lng) : null;
        const detail = `${p.name}${dist === null ? '' : ` · ${dist.toFixed(1)} km from office`}`;
        return `<a class="osm-pin ${pinTone(dist)}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px" href="${mapsUrl(p.lat, p.lng)}" target="_blank" rel="noopener" title="${esc(detail)}" aria-label="${esc(detail)}"><span></span><b>${esc(String(p.name || 'User').slice(0, 24))}</b></a>`;
      }).join('');
    }
    function scheduleRender() { cancelAnimationFrame(frame); frame = requestAnimationFrame(renderTiles); }
    function setZoom(next) {
      zoom = Math.max(2, Math.min(18, next));
      renderTiles();
    }
    map.addEventListener('click', (e) => {
      const z = e.target.closest('[data-map-zoom]');
      if (z) { e.preventDefault(); setZoom(zoom + (z.dataset.mapZoom === 'in' ? 1 : -1)); return; }
      if (e.target.closest('[data-map-fit]')) { e.preventDefault(); fit(); }
    });

    let drag = null;
    map.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button,a')) return;
      const cp = project(center.lat, center.lng, zoom);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: cp.x, cy: cp.y };
      map.classList.add('dragging'); map.setPointerCapture(e.pointerId);
    });
    map.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      center = unproject(drag.cx - (e.clientX - drag.x), drag.cy - (e.clientY - drag.y), zoom);
      scheduleRender();
    });
    const endDrag = (e) => { if (drag && (!e || drag.id === e.pointerId)) { drag = null; map.classList.remove('dragging'); } };
    map.addEventListener('pointerup', endDrag); map.addEventListener('pointercancel', endDrag);
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => {
        if (!map.isConnected) { observer.disconnect(); cancelAnimationFrame(frame); return; }
        scheduleRender();
      });
      observer.observe(map);
    }
    fit();
  }

  async function render(root) {
    root.innerHTML = `<div class="page-head"><div><h1>🗺 Team map</h1><p class="sub">Consent se share hui last location · real map · office distance + accuracy</p></div>
      <div class="head-actions"><button class="btn" id="tm-refresh">↻ Refresh</button></div></div>
      <div id="tm-body">${U.spinner('Location aa rahi hai…')}</div>`;
    const body = U.$('#tm-body', root);
    const load = async () => {
      try {
        const out = await FF.auth.api('/api/team-location');
        if (!root.isConnected) return;
        const people = (out.people || []).filter(coord);
        const office = out.office || { lat: 0, lng: 0 };
        const officeOk = coord(office) && !(Number(office.lat) === 0 && Number(office.lng) === 0);
        const rows = people.map((p) => {
          const dist = officeOk ? haversine(Number(office.lat), Number(office.lng), Number(p.lat), Number(p.lng)) : null;
          const band = dist === null ? '—' : dist <= 2 ? '🟢' : dist <= 10 ? '🟡' : '🔴';
          return `<tr><td><b>${esc(p.name)}</b> ${p.role === 'admin' ? '👑' : ''}</td>
            <td class="num">${dist === null ? '—' : `<b>${dist.toFixed(1)} km</b> ${band}`}</td>
            <td>${esc(rel(p.at))}</td>
            <td class="small dim">${p.accuracy != null ? `±${U.fmt(p.accuracy)} m` : '—'}</td>
            <td class="small"><a href="${mapsUrl(p.lat, p.lng)}" target="_blank" rel="noopener">${esc(String(p.lat).slice(0, 9))}, ${esc(String(p.lng).slice(0, 9))} ↗</a></td>
            <td class="small dim">${esc(rel(p.lastLoginAt))}</td></tr>`;
        }).join('');
        body.innerHTML = `<section class="card"><div class="card-head"><h3>📍 Last shared positions <span class="dim">· ${people.length} log</span></h3>
            <div class="card-right dim small">🟢 ≤2 km · 🟡 ≤10 km · 🔴 10+ km</div></div>
          <div class="card-body"><div id="tm-map"></div>
          ${people.length ? `<div class="table-wrap" style="margin-top:12px"><table class="tbl compact"><thead><tr><th>User</th><th class="num">Office se door</th><th>Location aayi</th><th>Accuracy</th><th>Lat, Lng</th><th>Last login</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="dim small" style="margin-top:10px">Kisi user ne abhi location share nahi ki. Map par office phir bhi dikh sakta hai.</p>'}
          </div></section>
        ${officeOk ? '' : '<div class="warn-box">🏢 Office coordinates set nahi hain — Settings → 🎛 Features → Office location me latitude/longitude save karo.</div>'}
        <p class="dim small">Location automatic track nahi hoti. Har user khud Settings → My account → 📍 Share dabata hai; map sirf uski latest consented location dikhata hai.</p>`;
        mountMap(U.$('#tm-map', body), people, office);
      } catch (err) { body.innerHTML = U.errorBox(err); }
    };
    const refresh = U.$('#tm-refresh', root);
    refresh.addEventListener('click', () => U.withButtonBusy(refresh, load, 'Refreshing…'));
    await load();
  }

  FF.pages.teamMap = { title: 'Team map', render };
})(window.FF);
