/* v3.125.420 — 🎨 Look studio: site ka look (accent, font, radius, sidebar, background, glass, charts…) — per browser, localStorage `ff_look`. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const KEY = 'ff_look', D = document, H = D.documentElement;
  const DEF = { accent: '', radius: 'soft', font: 'system', side: 'default', bg: 'none', glass: false, gb: true, ico: false, ghead: false, cround: true, cgrad: true, csmooth: false, hl: true, ring: true, autoDark: false, fav: true };
  const ACCENTS = ['#6366f1', '#0ea5e9', '#0d9488', '#16a34a', '#f59e0b', '#ea580c', '#e11d48', '#9333ea'];
  const FONTS = {
    system: { label: 'Default', stack: '' },
    inter: { label: 'Inter', stack: 'Inter, "Segoe UI", system-ui, sans-serif', files: [[400, 'inter-latin-400-normal'], [600, 'inter-latin-600-normal'], [800, 'inter-latin-800-normal']] },
    poppins: { label: 'Poppins', stack: 'Poppins, "Segoe UI", system-ui, sans-serif', files: [[400, 'poppins-latin-400-normal'], [600, 'poppins-latin-600-normal'], [800, 'poppins-latin-800-normal']] },
    manrope: { label: 'Manrope', stack: 'Manrope, "Segoe UI", system-ui, sans-serif', files: [[400, 'manrope-latin-400-normal'], [600, 'manrope-latin-600-normal'], [800, 'manrope-latin-800-normal']] },
    hind: { label: 'Hind (Hindi+Eng)', stack: 'Hind, "Segoe UI", system-ui, sans-serif', files: [[400, 'hind-latin-400-normal'], [600, 'hind-latin-600-normal'], [700, 'hind-latin-700-normal']], dev: [[400, 'hind-devanagari-400-normal'], [600, 'hind-devanagari-600-normal'], [700, 'hind-devanagari-700-normal']] }
  };
  let cfg = Object.assign({}, DEF);
  try { cfg = Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* bad json */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* blocked */ } };
  const loaded = new Set();
  function ensureFont(id) {
    const f = FONTS[id]; if (!f || !f.files || loaded.has(id)) return; loaded.add(id);
    const ff = (fam, list, range) => list.map(([w, n]) => `@font-face{font-family:${fam};font-weight:${w};font-style:normal;font-display:swap;src:url(/fonts/${n}.woff2) format('woff2');${range ? 'unicode-range:' + range + ';' : ''}}`).join('');
    const fam = id === 'hind' ? 'Hind' : f.label.split(' ')[0];
    let css = ff(fam, f.files); if (f.dev) css += ff(fam, f.dev, 'U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+25CC,U+A830-A839,U+A8E0-A8FF');
    const st = D.createElement('style'); st.id = 'ff-look-font-' + id; st.textContent = css; D.head.appendChild(st);
  }
  const CLASSES = ['ff-rad-sharp', 'ff-rad-round', 'ff-side-light', 'ff-side-float', 'ff-bg-mesh', 'ff-bg-dots', 'ff-glass', 'ff-gb', 'ff-ico', 'ff-ghead', 'ff-c-round', 'ff-c-grad', 'ff-c-smooth', 'ff-hl', 'ff-ring', 'ff-font-custom'];
  function apply() {
    const c = cfg, cl = H.classList; CLASSES.forEach((x) => cl.remove(x));
    if (c.radius === 'sharp') cl.add('ff-rad-sharp'); else if (c.radius === 'round') cl.add('ff-rad-round');
    if (c.side === 'light') cl.add('ff-side-light'); else if (c.side === 'float') cl.add('ff-side-float');
    if (c.bg === 'mesh' || (c.glass && c.bg === 'none')) cl.add('ff-bg-mesh'); else if (c.bg === 'dots') cl.add('ff-bg-dots');
    [['glass', 'ff-glass'], ['gb', 'ff-gb'], ['ico', 'ff-ico'], ['ghead', 'ff-ghead'], ['cround', 'ff-c-round'], ['cgrad', 'ff-c-grad'], ['csmooth', 'ff-c-smooth'], ['hl', 'ff-hl'], ['ring', 'ff-ring']].forEach(([k, n]) => { if (c[k]) cl.add(n); });
    if (/^#[0-9a-f]{6}$/i.test(c.accent)) { H.style.setProperty('--brand', c.accent); H.style.setProperty('--brand-2', `color-mix(in srgb, ${c.accent} 55%, #ec4899)`); H.style.setProperty('--brand2', `color-mix(in srgb, ${c.accent} 55%, #ec4899)`); }
    else { ['--brand', '--brand-2', '--brand2'].forEach((p) => H.style.removeProperty(p)); }
    const f = FONTS[c.font] || FONTS.system;
    if (f.stack) { ensureFont(c.font); cl.add('ff-font-custom'); H.style.setProperty('--ff-font', f.stack); } else H.style.removeProperty('--ff-font');
    autoDark(); favicon(true);
    try { if (FF.charts && FF.charts.syncPackPalette) FF.charts.syncPackPalette(); } catch { /* optional */ }
  }
  // 🌙 auto dark: 7pm–6am
  function autoDark() {
    if (!cfg.autoDark) return; const pm = H.dataset.themePack && window.FF_PACK_MODES && window.FF_PACK_MODES[H.dataset.themePack]; if (pm) return;
    const h = new Date().getHours(); H.dataset.theme = (h >= 19 || h < 6) ? 'dark' : 'light';
  }
  // 🔖 favicon with live tag count (tab title se)
  let origFav = null;
  function favicon(force) {
    let link = D.querySelector('link[rel~="icon"]'); if (!link) return; if (origFav === null) origFav = link.href;
    if (!cfg.fav) { if (origFav && link.href !== origFav) link.href = origFav; return; }
    const m = /(\d[\d,]*)\s+tags/i.exec(D.title || ''); if (!m) { if (force && origFav) link.href = origFav; return; }
    const n = m[1].replace(/,/g, ''); const txt = Number(n) >= 1000 ? (Number(n) / 1000).toFixed(1).replace('.0', '') + 'k' : n;
    try {
      const cv = D.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'); const brand = getComputedStyle(H).getPropertyValue('--brand').trim() || '#6366f1';
      x.fillStyle = brand; x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill(); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `800 ${txt.length > 3 ? 24 : txt.length > 2 ? 28 : 34}px sans-serif`; x.fillText(txt, 32, 34);
      link.type = 'image/png'; link.href = cv.toDataURL('image/png');
    } catch { /* canvas blocked */ }
  }
  function watchTitle() { const t = D.querySelector('title'); if (!t) return; let q = 0; new MutationObserver(() => { clearTimeout(q); q = setTimeout(() => favicon(false), 400); }).observe(t, { childList: true, characterData: true, subtree: true }); }
  // ---- panel ----
  const chip = (k, v, label, extra) => `<button type="button" class="lk-chip${String(cfg[k]) === String(v) ? ' on' : ''}" data-lk="${k}" data-v="${v}"${extra || ''}>${label}</button>`;
  const tog = (k, label, hint) => `<label class="lk-tog"><input type="checkbox" data-lkt="${k}"${cfg[k] ? ' checked' : ''}><span><b>${label}</b><small>${hint}</small></span></label>`;
  function panel() {
    const fonts = Object.entries(FONTS).map(([id, f]) => `<button type="button" class="lk-chip lk-font${cfg.font === id ? ' on' : ''}" data-lk="font" data-v="${id}" style="${f.stack ? 'font-family:' + f.stack : ''}">${f.label}</button>`).join('');
    const sw = ACCENTS.map((a) => `<button type="button" class="lk-sw${cfg.accent.toLowerCase() === a ? ' on' : ''}" data-lk="accent" data-v="${a}" style="background:${a}" aria-label="${a}"></button>`).join('');
    return `<div class="lk">
      <h4>🎨 Accent colour</h4><div class="lk-row">${sw}<input type="color" class="lk-color" id="lk-color" value="${cfg.accent || '#6366f1'}" title="Apna colour"><button type="button" class="lk-chip${!cfg.accent ? ' on' : ''}" data-lk="accent" data-v="">Theme ka</button></div>
      <h4>🔤 Font</h4><div class="lk-row">${fonts}</div>
      <h4>◼️ Corners</h4><div class="lk-row">${chip('radius', 'sharp', 'Sharp')}${chip('radius', 'soft', 'Soft')}${chip('radius', 'round', 'Round')}</div>
      <h4>🧭 Sidebar</h4><div class="lk-row">${chip('side', 'default', 'Default')}${chip('side', 'light', 'Light')}${chip('side', 'float', 'Floating')}</div>
      <h4>🖼️ Background</h4><div class="lk-row">${chip('bg', 'none', 'Plain')}${chip('bg', 'mesh', 'Gradient mesh')}${chip('bg', 'dots', 'Dot grid')}</div>
      <h4>✨ Cards & text</h4>${tog('glass', 'Glass cards', 'Blur wale transparent cards (purane phone par slow ho sakta hai)')}${tog('gb', 'Gradient borders', 'Alert / record / profile pe chamakti border')}${tog('ico', 'Icon badges', 'Menu aur KPI icons gradient badge me')}${tog('ghead', 'Gradient headings', 'Bade titles par colour gradient')}${tog('ring', 'Avatar ring', 'Photo ke around ghoomti ring')}
      <h4>📊 Charts</h4>${tog('cround', 'Rounded bars', 'Bars ke kone gol')}${tog('cgrad', 'Bar shine', 'Bars par halki chamak')}${tog('csmooth', 'Smooth lines', 'Line charts curve me')}${tog('hl', 'Hover highlight', 'Ek bar par jao to baaki halke')}
      <h4>🌙 Auto</h4>${tog('autoDark', 'Auto dark (7pm–6am)', 'Raat ko apne aap dark, subah light')}${tog('fav', 'Tab icon me count', 'Browser tab ke icon par aaj ke tags')}
      <div class="lk-row"><button type="button" class="btn" id="lk-reset">↺ Sab default karo</button></div></div>`;
  }
  function open() {
    if (!FF.app || !FF.app.openDrawer) return;
    const body = FF.app.openDrawer({ kicker: '🎨 Look studio', title: 'Site ka look', sub: 'Badlaav turant dikhta hai · sirf is browser me save hota hai', body: panel() });
    const host = body && body.querySelector ? body : D.getElementById('drawer-body'); if (!host) return;
    const act = D.getElementById('drawer-actions'); if (act) act.innerHTML = '';   // CSV/PDF yahan kaam ke nahi
    const repaint = () => { host.innerHTML = panel(); };
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lk]'); if (b) { cfg[b.dataset.lk] = b.dataset.v; save(); apply(); repaint(); return; }
      if (e.target.closest('#lk-reset')) { cfg = Object.assign({}, DEF); save(); apply(); repaint(); }
    });
    host.addEventListener('change', (e) => {
      const t = e.target.closest('[data-lkt]'); if (t) { cfg[t.dataset.lkt] = !!t.checked; save(); apply(); return; }
      if (e.target.id === 'lk-color') { cfg.accent = e.target.value; save(); apply(); repaint(); }
    });
  }
  FF.look = { open, apply, get cfg() { return cfg; }, DEF };
  apply(); watchTitle();
  setInterval(autoDark, 5 * 60e3);
  setTimeout(() => { apply(); }, 2500);   // app.js theme boot ke baad dobara (auto-dark / pack ke saath)
})(window.FF);
