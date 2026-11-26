/* v3.125.386 — ui-motion.js: status colours, empty hints, route progress + row stagger, server-waking banner, bulk select (copy/CSV/WhatsApp), print/PDF dock.
   OS "Reduce motion" ignore hota hai; Settings → Animations band (html.ff-no-anim) se hi band hota hai. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const H = document.documentElement, D = document;
  const $ = (s, r) => (r || D).querySelector(s);
  const ST = {
    ok: /^(active|live|approved|done|completed|complete|issued|success|paid|delivered|ok|yes|kyc done|running|activated)$/i,
    bad: /^(inactive|rejected|failed|blocked|cancelled|canceled|expired|error|no|stuck|overdue|late)$/i,
    wait: /^(pending|in progress|processing|hold|on hold|review|waiting|draft|partial|submitted)$/i,
  };
  const mainEl = () => $('#main');

  // ---- 6 · status colours --------------------------------------------------------------------
  function paintStatus(root) {
    (root.querySelectorAll ? root.querySelectorAll('td:not([data-ux-st])') : []).forEach((td) => {
      td.setAttribute('data-ux-st', '1');
      if (td.children.length > 1 || td.querySelector('.badge,.chip,button,a,input,select')) return;
      const t = (td.textContent || '').replace(/[^\p{L}\s]/gu, '').trim();
      if (!t || t.length > 14) return;
      for (const k of ['ok', 'bad', 'wait']) if (ST[k].test(t)) { td.classList.add('ux-st', 'st-' + k); break; }
    });
  }
  // ---- 8 · empty hints -----------------------------------------------------------------------
  function paintEmpty(root) {
    (root.querySelectorAll ? root.querySelectorAll('.empty-state:not([data-ux-h])') : []).forEach((el) => {
      el.setAttribute('data-ux-h', '1');
      if (el.querySelector('small,br,.ux-empty-act')) return;
      const h = D.createElement('span'); h.className = 'ux-empty-hint';
      h.textContent = '💡 Filter / date badal ke dekho, ya ↻ Refresh dabao';
      el.appendChild(h);
    });
  }
  // ---- 9 · route progress + row stagger --------------------------------------------------------
  let prog = null, progT = 0;
  function progStart() {
    if (!prog) { prog = D.createElement('div'); prog.id = 'ux-prog'; D.body.appendChild(prog); }
    clearTimeout(progT); prog.className = ''; void prog.offsetWidth; prog.className = 'on';
    progT = setTimeout(progDone, 9000);
  }
  function progDone() { if (prog && prog.classList.contains('on')) { prog.className = 'done'; } }
  // 🎴 v3.125.474 — cards ek-ek karke halke se aayein (pehle 12) + KPI number badle to chamke (▲ hara / ▼ laal)
  const NOANIM = () => H.classList.contains('ff-no-anim') || H.classList.contains('ff-fast');   // OS reduce-motion jaan-boojh kar ignore (site ki apni setting)
  const kpiFlashPrev = new Map();
  function cardsIn(root) {
    if (NOANIM() || !root.querySelectorAll) return;
    let i = 0;
    root.querySelectorAll('.card:not(.ux-cin), .hs-box:not(.ux-cin)').forEach((c) => { c.classList.add('ux-cin'); if (i < 12) { c.style.setProperty('--ci', i); c.classList.add('ux-cin-a'); } i++; });
  }
  function kpiFlash(root) {
    if (NOANIM() || !root.querySelectorAll) return;
    root.querySelectorAll('.hs-box, .pf-t').forEach((t) => {
      const lab = t.querySelector('small, .lab'), b = t.querySelector('b'); if (!lab || !b) return;
      const key = `${location.hash.split('?')[0]}|${(lab.textContent || '').trim()}`, val = (b.textContent || '').trim();
      const prev = kpiFlashPrev.get(key); kpiFlashPrev.set(key, val);
      if (prev === undefined || prev === val) return;
      const a = parseFloat(prev.replace(/[^0-9.\-]/g, '')), c = parseFloat(val.replace(/[^0-9.\-]/g, ''));
      if (!isFinite(a) || !isFinite(c) || a === c) return;
      t.classList.remove('ux-chg-up', 'ux-chg-dn'); void t.offsetWidth; t.classList.add(c > a ? 'ux-chg-up' : 'ux-chg-dn');
      setTimeout(() => t.classList.remove('ux-chg-up', 'ux-chg-dn'), 1800);
    });
  }
  function stagger(root) {
    cardsIn(root); kpiFlash(root);
    const rows = root.querySelectorAll ? root.querySelectorAll('tbody tr:not(.ux-in)') : [];
    let i = 0; rows.forEach((tr) => { if (i < 14) { tr.style.setProperty('--i', i); tr.classList.add('ux-in'); } else tr.classList.add('ux-in'); i++; });
  }
  // ---- 5 · button feedback (⏳ → ✓ / ✗) -----------------------------------------------------------
  let lastBtn = null, lastAt = 0;
  D.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button, .btn, [role=button]'); if (b && !b.closest('#ux-dock, #ux-bar')) { lastBtn = b; lastAt = Date.now(); } }, true);
  const _fetch = window.fetch;
  if (typeof _fetch === 'function') {
    window.fetch = function (input, init) {
      const p = _fetch.apply(this, arguments);
      try {
        const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const btn = lastBtn;
        if (method !== 'GET' && btn && btn.isConnected && Date.now() - lastAt < 700 && /\/api\//.test(url)) {
          lastBtn = null; btn.classList.add('ux-busy'); btn.setAttribute('aria-busy', 'true');
          const tag = (cls, txt) => { const old = btn.querySelector(':scope > .ux-fb'); if (old) old.remove(); const sp = D.createElement('span'); sp.className = 'ux-fb ' + cls; sp.textContent = txt; btn.appendChild(sp); return sp; };
          tag('spin', '');
          const fin = (ok) => { btn.classList.remove('ux-busy'); btn.removeAttribute('aria-busy'); const sp = tag(ok ? 'ok' : 'fail', ok ? '✓ Ho gaya' : '✗ Nahi hua'); setTimeout(() => sp.remove(), 1600); };
          p.then((r) => fin(!!(r && r.ok)), () => fin(false));
        }
      } catch { /* optional */ }
      return p;
    };
  }
  // ---- 6 · friendly error messages ---------------------------------------------------------------
  const FRIENDLY = [
    [/failed to fetch|networkerror|load failed|network request failed|err_internet/i, '📡 Server se connect nahi ho pa raha — internet check karke dobara try karo.'],
    [/timeout|timed out|aborterror|aborted/i, '⏱ Server ne der kar di — ek baar dobara try karo.'],
    [/\b401\b|unauthori[sz]ed|session (expired|invalid)|token (expired|invalid)/i, '🔒 Session khatam ho gaya — dobara login karo.'],
    [/\b403\b|forbidden|permission denied|not permitted/i, '🚫 Is kaam ki permission nahi hai — admin se poochho.'],
    [/\b429\b|too many requests|rate limit/i, '🐢 Bahut zyada requests — 1 minute ruk ke try karo.'],
    [/\b50[0-4]\b|internal server error|bad gateway|service unavailable|gateway timeout/i, '🛠 Server me dikkat aayi — thodi der baad try karo.'],
    [/unexpected token|is not valid json|json\.parse|undefined|cannot read prop/i, '⚠️ Kuch gadbad hui — page refresh karke dobara try karo.']
  ];
  function friendly(msg) {
    const t = String(msg == null ? '' : msg); if (!t || t.length > 220 || /[ऀ-ॿ]/.test(t)) return t;
    for (const [re, out] of FRIENDLY) if (re.test(t)) return out;
    return t;
  }
  function wrapToast() {
    const u = FF.util; if (!u || typeof u.toast !== 'function') return false;
    if (u.toast.__ux) return true;
    const orig = u.toast; const w = function (m, t, ...rest) { const tone = String(t || ''); const out = /err|warn|bad|fail|red/i.test(tone) ? friendly(m) : m; if (out !== m) { try { console.info('[ux] original:', m); } catch { /* ignore */ } } return orig.call(this, out, t, ...rest); };
    w.__ux = true; u.toast = w; return true;
  }
  // ---- 6b · field check: mobile (10 digit) / pincode (6 digit) -------------------------------------
  function fieldKind(el) {
    if (!el || el.tagName !== 'INPUT' || el.dataset.uxNov || el.closest('.topbar, [role=search], .ms-panel')) return '';
    const ty = (el.type || '').toLowerCase(); if (ty === 'search' || ty === 'checkbox' || ty === 'radio' || ty === 'hidden' || ty === 'file') return '';
    const k = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
    if (/mobile|phone|\bmob\b/.test(k) || ty === 'tel') return 'mob';
    if (/pin ?code|pincode|\bpin\b/.test(k)) return 'pin';
    return '';
  }
  function checkField(el) {
    const kind = fieldKind(el); if (!kind) return;
    const d = String(el.value || '').replace(/\D/g, ''); let msg = '';
    if (d) {
      if (kind === 'mob' && !(d.length === 10 || (d.length === 12 && d.startsWith('91')))) msg = `Mobile 10 digit ka hona chahiye (abhi ${d.length})`;
      if (kind === 'pin' && d.length !== 6) msg = `Pincode 6 digit ka hona chahiye (abhi ${d.length})`;
    }
    let note = el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains('ux-ferr') ? el.nextElementSibling : null;
    el.classList.toggle('ux-bad', !!msg);
    if (msg) { if (!note) { note = D.createElement('small'); note.className = 'ux-ferr'; el.insertAdjacentElement('afterend', note); } note.textContent = '⚠ ' + msg; }
    else if (note) note.remove();
  }
  D.addEventListener('focusout', (e) => checkField(e.target), true);
  D.addEventListener('input', (e) => { if (e.target.classList && e.target.classList.contains('ux-bad')) checkField(e.target); }, true);
  (function waitToast(n) { if (!wrapToast() && n < 40) setTimeout(() => waitToast(n + 1), 500); })(0);
  // ---- 11 · bulk select ------------------------------------------------------------------------
  let dock = null, bar = null, selMode = false;
  const rowsSel = () => [...D.querySelectorAll('#main tbody tr.ux-sel')];
  const cellsOf = (tr) => [...tr.children].map((c) => (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim());
  function headOf(tr) { const t = tr.closest('table'); const th = t && t.querySelector('thead tr'); return th ? cellsOf(th) : []; }
  function updBar() {
    const n = rowsSel().length;
    bar.classList.toggle('on', selMode && n > 0);
    $('b', bar).textContent = n;
  }
  function setMode(on) {
    selMode = !!on; H.classList.toggle('ux-bsel', selMode);
    const b = $('[data-d="sel"]', dock); if (b) b.classList.toggle('on', selMode);
    if (!selMode) { D.querySelectorAll('#main tr.ux-sel').forEach((r) => r.classList.remove('ux-sel')); }
    updBar();
  }
  function toast(m) { try { FF.util.toast(m, 'ok'); } catch { /* optional */ } }
  function lines() { const rs = rowsSel(); const head = rs.length ? headOf(rs[0]) : []; return { head, rows: rs.map(cellsOf) }; }
  function actCopy() { const { head, rows } = lines(); const txt = [head, ...rows].filter((r) => r.length).map((r) => r.join('\t')).join('\n'); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('📋 ' + rows.length + ' rows copy ho gayi'), () => toast('Copy nahi hua')); }
  function actCsv() {
    const { head, rows } = lines(); const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const csv = '﻿' + [head, ...rows].filter((r) => r.length).map((r) => r.map(q).join(',')).join('\r\n');
    const a = D.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'selected-' + new Date().toISOString().slice(0, 10) + '.csv'; D.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function actWa() { const { rows } = lines(); const txt = rows.slice(0, 40).map((r) => r.filter(Boolean).join(' | ')).join('\n'); window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener'); }
  function actAll() { D.querySelectorAll('#main tbody tr').forEach((r) => r.classList.add('ux-sel')); updBar(); }
  // ---- 12 · print / PDF ------------------------------------------------------------------------
  function actPrint() {
    let ph = $('#ux-print-head'); if (!ph) { ph = D.createElement('div'); ph.id = 'ux-print-head'; D.body.insertBefore(ph, D.body.firstChild); }
    const h = ($('#main h1, #main h2') || {}).textContent || D.title;
    ph.innerHTML = '';
    const b = D.createElement('b'); b.textContent = (h || '').trim(); const s = D.createElement('small'); s.textContent = 'ApnaPayment · ' + new Date().toLocaleString('en-IN'); ph.append(b, s);
    window.print();
  }
  // ---- row density (Compact / Normal / Bada) ------------------------------------------------------
  const DEN = ['compact', 'normal', 'large'], DEN_L = { compact: '↕ Compact', normal: '↕ Normal', large: '↕ Bada' };
  const denGet = () => { try { const v = localStorage.getItem('ff_ux_den'); return DEN.indexOf(v) >= 0 ? v : 'normal'; } catch { return 'normal'; } };
  function denApply(v) {
    H.setAttribute('data-ux-den', v); try { localStorage.setItem('ff_ux_den', v); } catch { /* private */ }
    const b = $('[data-d="den"]', dock); if (b) b.textContent = DEN_L[v];
  }
  // ---- 🧊 3D look: on/off + mouse tilt (KPI tiles, logo) ----------------------------------------------
  const get3d = () => { try { return localStorage.getItem('ff_ux_3d') !== '0'; } catch { return true; } };
  function set3d(on) { H.classList.toggle('ff-3d', !!on); try { localStorage.setItem('ff_ux_3d', on ? '1' : '0'); } catch { /* private */ } const b = $('[data-d="3d"]', dock); if (b) b.classList.toggle('on', !!on); }
  function tiltInit() {
    if (!window.matchMedia || !matchMedia('(pointer: fine)').matches) return;
    let el = null, tick = 0;
    D.addEventListener('mousemove', (e) => {
      if (!H.classList.contains('ff-3d') || H.classList.contains('ff-no-anim')) return;
      const t = e.target.closest && e.target.closest('.kpi, .brand-logo');
      if (el && el !== t) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el = null; }
      if (!t) return; el = t;
      if (tick) return; tick = requestAnimationFrame(() => {
        tick = 0; const r = t.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        const k = t.classList.contains('brand-logo') ? 22 : 9;
        t.style.setProperty('--ry', ((x - .5) * k).toFixed(2) + 'deg'); t.style.setProperty('--rx', ((.5 - y) * k).toFixed(2) + 'deg');
        t.style.setProperty('--gx', (x * 100).toFixed(0) + '%'); t.style.setProperty('--gy', (y * 100).toFixed(0) + '%');
      });
    }, { passive: true });
    D.addEventListener('mouseleave', () => { if (el) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el = null; } });
  }
  function buildDock() {
    dock = D.createElement('div'); dock.id = 'ux-dock';
    dock.innerHTML = '<button type="button" data-d="sel" title="Rows chun kar copy / CSV / WhatsApp">☑ Select</button><button type="button" data-d="3d" title="3D look on / off">🧊 3D</button><button type="button" data-d="den" title="Table row ki gehraai: Compact / Normal / Bada"></button><button type="button" data-d="print" title="Is page ka saaf PDF / print">🖨 PDF</button>';
    denApply(denGet()); set3d(get3d() && !H.classList.contains('ff-fast')); tiltInit();
    bar = D.createElement('div'); bar.id = 'ux-bar';
    bar.innerHTML = '<b>0</b> chuni<button type="button" data-b="copy">📋 Copy</button><button type="button" data-b="csv">⬇ CSV</button><button type="button" data-b="wa">💬 WhatsApp</button><button type="button" data-b="all">Sab</button><button type="button" class="x" data-b="x">✕ Band</button>';
    D.body.append(dock, bar);
    dock.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.d === 'sel') setMode(!selMode); else if (b.dataset.d === '3d') set3d(!H.classList.contains('ff-3d')); else if (b.dataset.d === 'den') denApply(DEN[(DEN.indexOf(denGet()) + 1) % 3]); else actPrint(); });
    bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; ({ copy: actCopy, csv: actCsv, wa: actWa, all: actAll, x: () => setMode(false) })[b.dataset.b](); });
    D.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selMode) setMode(false); });
    // capture: select mode me row click sirf select/deselect kare (page ke apne click handler na chale)
    D.addEventListener('click', (e) => {
      if (!selMode) return; const tr = e.target.closest && e.target.closest('#main tbody tr'); if (!tr) return;
      e.preventDefault(); e.stopPropagation(); tr.classList.toggle('ux-sel'); updBar();
    }, true);
  }
  function dockVis() {
    const has = !!D.querySelector('#main tbody tr, #main .kpi, #main .card');
    const login = /login|auth/i.test(location.hash) || !!D.querySelector('.auth-shell');
    let adm = false; try { adm = !!(FF.auth && FF.auth.isAdmin()); } catch { adm = false; }
    dock.classList.toggle('on', has && !login && adm);
    if (!adm && selMode) setMode(false);
  }
  // ✨ v3.125.415 — count-up (KPI numbers) + bars grow. Sirf naye aaye nodes par, ek baar; reduced-motion me skip.
  const REDUCE = false;   // OS reduce-motion jaan-boojh kar ignore — sirf Settings (ff-no-anim) band karta hai
  const kpiPrev = new Map();
  function countUp(root) {
    if (REDUCE || document.documentElement.classList.contains('ff-no-anim')) return;
    const els = root.matches && root.matches('.kpi-value') ? [root] : Array.from(root.querySelectorAll ? root.querySelectorAll('.kpi-value') : []);
    els.slice(0, 60).forEach((el) => {
      // Live totals, shares and splits must remain one exact snapshot (no interpolated counts).
      if (el.closest('[data-countup="off"]')) return;
      if (el.dataset.cu || el.children.length || el.__ux || el.closest('#home-summary')) return; el.dataset.cu = '1';
      const t = el.textContent.trim(); const m = t.match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
      if (!m) return; const raw = m[2]; const to = parseFloat(raw.replace(/,/g, '')); if (!isFinite(to)) return;
      const card = el.closest('.kpi'); const tt = card && card.querySelector('.kpi-title');
      // Same title can mean today, MTD, FF or GV. Never borrow another metric's history.
      const spec = card && card.getAttribute('data-kpi');
      const key = spec && tt ? JSON.stringify([location.hash, spec, tt.textContent.trim()]) : '';
      if (kpiPrev.size > 500) kpiPrev.clear();
      const prev = key ? kpiPrev.get(key) : undefined; if (key) kpiPrev.set(key, to);
      if (prev !== undefined && prev === to) return;                 // wahi value dobara render — animate nahi
      const from = prev !== undefined ? prev : 0;
      if (prev === undefined && Math.abs(to) < 10) return;
      if (prev !== undefined && card) { card.classList.add('ux-ripple'); setTimeout(() => card.classList.remove('ux-ripple'), 1000); el.classList.add('ux-roll'); setTimeout(() => el.classList.remove('ux-roll'), 700); }
      const dec = (raw.split('.')[1] || '').length; const comma = raw.indexOf(',') >= 0;
      const fmt = (v) => { const n = dec ? v.toFixed(dec) : String(Math.round(v)); return m[1] + (comma ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : n) + m[3]; };
      const t0 = performance.now(), D = prev !== undefined ? 900 : 700;
      const step = (now) => { if (!el.isConnected) return; const k = Math.min(1, (now - t0) / D); const e = 1 - Math.pow(1 - k, 3); el.textContent = k >= 1 ? t : fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function barGrow(root) {
    if (REDUCE || document.documentElement.classList.contains('ff-no-anim')) return;
    const els = root.querySelectorAll ? root.querySelectorAll('.vcol-stack:not(.ux-g), .hbar-fill:not(.ux-g), svg.spark rect:not(.ux-g)') : [];
    let i = 0; els.forEach((el) => { if (i++ > 400) return; el.classList.add('ux-g'); });
  }
  // 🎉 v3.125.417 — full-screen confetti (canvas, ~2.5s), reduced-motion me skip
  function confetti() {
    if (REDUCE || D.documentElement.classList.contains('ff-no-anim')) return;
    const c = D.createElement('canvas'); c.className = 'ux-confetti'; c.width = innerWidth; c.height = innerHeight; D.body.appendChild(c);
    const x = c.getContext('2d'), cols = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#ef4444'];
    const ps = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.4, vx: -2 + Math.random() * 4, vy: 2 + Math.random() * 4, w: 6 + Math.random() * 6, h: 4 + Math.random() * 6, r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4, c: cols[(Math.random() * cols.length) | 0] }));
    const t0 = performance.now();
    (function tick(now) { const k = now - t0; x.clearRect(0, 0, c.width, c.height); ps.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.r += p.vr; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.globalAlpha = Math.max(0, 1 - k / 2800); x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore(); }); if (k < 2800) requestAnimationFrame(tick); else c.remove(); })(t0);
  }
  // 🪟 glass header — scroll par chhota + blur
  function headerScroll() { let on = false; addEventListener('scroll', () => { const v = (window.scrollY || 0) > 24; if (v !== on) { on = v; D.documentElement.classList.toggle('ff-scrolled', v); } }, { passive: true }); }
  // 🎞️ page transition — route badalne par main ek baar slide/fade
  function pageTrans() { const m = mainEl(); if (!m || REDUCE) return; m.classList.remove('ux-pt'); void m.offsetWidth; m.classList.add('ux-pt'); }
  // 🔔 v3.125.418 — sound toggle (default OFF) · tiny WebAudio chime
  const sndOn = () => { try { return localStorage.getItem('ff_sound') === '1'; } catch { return false; } };
  let actx = null;
  function chime(kind) {
    if (!sndOn()) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const notes = kind === 'alert' ? [440, 330] : [523, 659, 784];
      notes.forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.13; o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28); o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.3); });
    } catch { /* audio blocked */ }
  }
  function heroExtras(root) {
    const heroes = root.matches && root.matches('.home-hero') ? [root] : Array.from(root.querySelectorAll ? root.querySelectorAll('.home-hero') : []);
    heroes.forEach((h) => {
      const hr = new Date().getHours(); h.dataset.tod = hr < 5 ? 'night' : hr < 12 ? 'morning' : hr < 17 ? 'noon' : hr < 20 ? 'evening' : 'night';
      const side = h.querySelector('.home-hero-side'); if (!side || side.querySelector('#home-sound')) return;
      const b = D.createElement('button'); b.className = 'btn'; b.id = 'home-sound'; b.type = 'button';
      const paint = () => { b.textContent = sndOn() ? '🔔 Sound ON' : '🔕 Sound off'; b.title = 'Record / stock alert par halki awaaz'; };
      paint(); b.addEventListener('click', () => { try { localStorage.setItem('ff_sound', sndOn() ? '0' : '1'); } catch { /* storage blocked */ } paint(); chime('win'); }); side.appendChild(b);
      if (!side.querySelector('#home-look')) { const l = D.createElement('button'); l.className = 'btn'; l.id = 'home-look'; l.type = 'button'; l.textContent = '🎨 Look'; l.title = 'Site ka look badlo (colour, font, sidebar, charts…)'; l.addEventListener('click', () => { if (FF.look) FF.look.open(); }); side.appendChild(l); }
      if (!side.querySelector('#home-bento')) { const g = D.createElement('button'); g.className = 'btn'; g.id = 'home-bento'; g.type = 'button'; const pg = () => { g.textContent = D.documentElement.classList.contains('ff-bento') ? '▦ Bento ON' : '▤ Classic'; g.title = 'Home layout: Bento / Classic'; }; pg(); g.addEventListener('click', () => { D.documentElement.classList.toggle('ff-bento'); lsSet('ff_bento', D.documentElement.classList.contains('ff-bento') ? '1' : '0'); pg(); }); side.appendChild(g); }
    });
  }
  // 🧑‍💼 row hover — agent mini card (data-agent wali rows par, thodi der ruko to)
  let acMap = null, acAt = 0, acTimer = 0, acEl = null;
  function acBuild() {
    if (acMap && Date.now() - acAt < 60e3) return acMap; acMap = new Map(); acAt = Date.now();
    try {
      const U = FF.util, tk = U.dateKey(new Date()), ym = tk.slice(0, 7);
      for (const r of (FF.gv && FF.gv.rows ? FF.gv.rows() : [])) { if (!r.date || !r.agentName) continue; const k = U.dateKey(r.date); if (k.slice(0, 7) !== ym) continue; const a = acMap.get(r.agentName) || { td: 0, mtd: 0 }; const n = Number(r.n) || 1; a.mtd += n; if (k === tk) a.td += n; acMap.set(r.agentName, a); }
    } catch { /* gv optional */ }
    return acMap;
  }
  function acHide() { clearTimeout(acTimer); if (acEl) { acEl.remove(); acEl = null; } }
  function acInit() {
    D.addEventListener('mouseover', (e) => {
      const tr = e.target.closest && e.target.closest('tr[data-agent]'); if (!tr) return;
      if (tr.__acT === acEl) return; clearTimeout(acTimer);
      acTimer = setTimeout(() => {
        const nm = tr.getAttribute('data-agent'); const a = acBuild().get(nm); if (!a) return; acHide();
        const ranked = [...acBuild().entries()].sort((x, y) => y[1].mtd - x[1].mtd); const rk = ranked.findIndex((x) => x[0] === nm) + 1;
        const r = tr.getBoundingClientRect(); acEl = D.createElement('div'); acEl.className = 'ux-ac';
        acEl.innerHTML = `<b>${FF.util.esc(nm)}</b><div><span>Aaj</span><strong>${FF.util.fmt(a.td)}</strong></div><div><span>Is mahine</span><strong>${FF.util.fmt(a.mtd)}</strong></div><div><span>Rank (GV)</span><strong>#${rk}</strong></div>`;
        D.body.appendChild(acEl); const w = acEl.offsetWidth; acEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + 24)) + 'px'; acEl.style.top = Math.min(innerHeight - acEl.offsetHeight - 8, r.bottom + 4) + 'px';
      }, 500);
    }, { passive: true });
    D.addEventListener('mouseout', (e) => { const tr = e.target.closest && e.target.closest('tr[data-agent]'); if (tr && !(e.relatedTarget && tr.contains(e.relatedTarget))) acHide(); }, { passive: true });
    addEventListener('scroll', acHide, { passive: true, capture: true });
  }
  // ✨ v3.125.419 — morph, scroll-reveal, mini-bars, profile tabs
  function morph(root) {
    if (REDUCE || D.documentElement.classList.contains('ff-no-anim')) return;
    const els = root.matches && root.matches('.table-wrap,.chart-shot,.kpi-grid') ? [root] : Array.from(root.querySelectorAll ? root.querySelectorAll('.table-wrap,.chart-shot,.kpi-grid') : []);
    els.slice(0, 20).forEach((e) => { if (!e.dataset.mo) { e.dataset.mo = '1'; e.classList.add('ux-morph'); } });
  }
  let rvIO = null;
  function reveal(root) {
    if (REDUCE || !('IntersectionObserver' in window) || D.documentElement.classList.contains('ff-no-anim')) return;
    rvIO = rvIO || new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.remove('ux-rv'); en.target.classList.add('ux-rv-in'); rvIO.unobserve(en.target); } }), { rootMargin: '0px 0px -40px 0px', threshold: 0.06 });
    const els = Array.from(root.querySelectorAll ? root.querySelectorAll('.card, .kpi-grid') : []);
    let c = 0; els.forEach((e) => { if (c > 50 || e.dataset.rv || e.closest('.drawer,#drawer,.modal')) return; const r = e.getBoundingClientRect(); if (r.top > innerHeight + 40) { e.dataset.rv = '1'; e.classList.add('ux-rv'); rvIO.observe(e); c++; } });
  }
  function miniBars(root) {
    const lists = Array.from(root.querySelectorAll ? root.querySelectorAll('.hm-toplist, .hs-strip') : []);
    lists.forEach((l) => {
      const rows = Array.from(l.querySelectorAll('.hm-toprow, .hs-ag')); if (rows.length < 2) return;
      const val = (r) => Number(String((r.querySelector('strong, em') || {}).textContent || '').replace(/[^\d.]/g, '')) || 0; const mx = Math.max(...rows.map(val), 1);
      rows.forEach((r) => { if (!r.dataset.mb) { r.dataset.mb = '1'; r.classList.add('ux-bar'); r.style.setProperty('--bar', Math.round(val(r) / mx * 100) + '%'); } });
    });
  }
  function profileTabs(root) {
    return;   // v3.125.454 — Overview/Health/Growth/Account tab-bar hata diya (sab ek saath dikhta hai)
    // eslint-disable-next-line no-unreachable
    const pfs = root.matches && root.matches('.pf') ? [root] : Array.from(root.querySelectorAll ? root.querySelectorAll('.pf') : []);
    pfs.forEach((pf) => {
      if (pf.dataset.tb) return; const defs = [['📊 Overview', '.pf-tiles'], ['🩺 Health', '.pf-minis'], ['📈 Growth', '.pf-gcs'], ['🏦 Account', '.pf-pay, .pf-bks']];
      const found = defs.map(([l, sel]) => [l, pf.querySelector(sel)]).filter((x) => x[1]); if (found.length < 2) return; pf.dataset.tb = '1';
      const bar = D.createElement('div'); bar.className = 'pf-tabs';
      found.forEach(([l, el], i) => { const b = D.createElement('button'); b.type = 'button'; b.textContent = l; if (!i) b.className = 'on'; b.addEventListener('click', () => { bar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); el.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'center' }); }); bar.appendChild(b); });
      const h = pf.querySelector('.pf-h'); if (h && h.parentNode === pf) h.after(bar); else pf.prepend(bar);
    });
  }
  // 🧩 shared-element: KPI card click → card phailke drawer ban jaye, band ho to wapas sikud jaye
  let seRect = null, seAt = 0, seCard = null;
  function ghost(a, b, dur) {
    if (REDUCE) return; const g = D.createElement('div'); g.className = 'ux-ghost';
    Object.assign(g.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' }); D.body.appendChild(g);
    const an = g.animate([{ left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px', opacity: .85, borderRadius: '16px' }, { left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px', opacity: 0, borderRadius: '0px' }], { duration: dur || 380, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    an.onfinish = () => g.remove(); an.oncancel = () => g.remove();
  }
  function sharedInit() {
    D.addEventListener('click', (e) => { const c = e.target.closest && e.target.closest('.kpi'); if (c) { seCard = c; seRect = c.getBoundingClientRect(); seAt = Date.now(); } }, true);
    const dr = D.getElementById('drawer'); if (!dr) return; let was = dr.classList.contains('open');
    new MutationObserver(() => {
      const now = dr.classList.contains('open'); if (now === was) return; was = now;
      const w = Math.min(dr.offsetWidth || 560, innerWidth), box = { left: innerWidth - w, top: 0, width: w, height: innerHeight };
      if (now && seRect && Date.now() - seAt < 1500) ghost(seRect, box, 380);
      else if (!now && seCard && seCard.isConnected && Date.now() - seAt < 120e3) { const r = seCard.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) ghost(box, r, 300); }
    }).observe(dr, { attributes: true, attributeFilter: ['class'] });
  }
  // 🧲 micro-interactions: magnetic primary buttons + copy ✓
  function microInit() {
    if (REDUCE) return;
    if (matchMedia && matchMedia('(hover: hover)').matches) {
      D.addEventListener('mousemove', (e) => { const b = e.target.closest && e.target.closest('.btn.primary'); if (!b) return; const r = b.getBoundingClientRect(); b.style.transform = `translate(${((e.clientX - r.left) / r.width - .5) * 5}px, ${((e.clientY - r.top) / r.height - .5) * 4}px)`; }, { passive: true });
      D.addEventListener('mouseout', (e) => { const b = e.target.closest && e.target.closest('.btn.primary'); if (b && !(e.relatedTarget && b.contains(e.relatedTarget))) b.style.transform = ''; }, { passive: true });
    }
    D.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button.btn'); if (!b || b.dataset.cp) return; const t = b.textContent.trim();
      if (!/^(📋\s*)?Copy\b/i.test(t)) return; b.dataset.cp = '1'; setTimeout(() => { if (b.textContent.trim() !== t) { delete b.dataset.cp; return; } b.textContent = '✓ Copied'; b.classList.add('ux-copied'); setTimeout(() => { b.textContent = t; b.classList.remove('ux-copied'); delete b.dataset.cp; }, 1200); }, 30);
    });
  }
  // 🧭 sidebar rail (collapse) + recent pages + bento toggle
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } };
  function railTitles() { D.querySelectorAll('#nav .nav-item').forEach((a) => { if (!a.title) { const b = a.querySelector('.nav-text b'); if (b) a.title = b.textContent.trim(); } }); }
  function recentPaint() {
    const nav = D.getElementById('nav'); if (!nav) return; let box = D.getElementById('nav-recent');
    let list = []; try { list = JSON.parse(lsGet('ff_recent') || '[]'); } catch { list = []; }
    if (!list.length) { if (box) box.remove(); return; }
    if (!box) { box = D.createElement('div'); box.id = 'nav-recent'; box.className = 'nav-recent'; nav.parentNode.insertBefore(box, nav); }
    box.innerHTML = '<small>🕘 Recent</small>' + list.map((x) => `<a href="#/${FF.util.esc(x.id)}">${FF.util.esc(x.label)}</a>`).join('');
  }
  function recentPush() {
    const id = (location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] || '').trim(); if (!id || id === 'home') return;
    const a = D.querySelector(`#nav .nav-item[data-page="${id}"] .nav-text b`); const label = a ? a.textContent.trim() : ''; if (!label) return;
    let list = []; try { list = JSON.parse(lsGet('ff_recent') || '[]'); } catch { list = []; }
    list = [{ id, label }].concat(list.filter((x) => x.id !== id)).slice(0, 4); lsSet('ff_recent', JSON.stringify(list)); recentPaint();
  }
  function railInit() {
    const root = D.documentElement; if (lsGet('ff_rail') === '1') root.classList.add('ff-rail');
    if (lsGet('ff_bento') !== '0') root.classList.add('ff-bento');
    const brand = D.querySelector('.sidebar .brand'); if (brand && !D.getElementById('rail-toggle')) {
      const b = D.createElement('button'); b.id = 'rail-toggle'; b.type = 'button'; b.className = 'rail-toggle'; b.title = 'Sidebar chhota / bada';
      const paint = () => { b.textContent = root.classList.contains('ff-rail') ? '›' : '‹'; }; paint();
      b.addEventListener('click', () => { root.classList.toggle('ff-rail'); lsSet('ff_rail', root.classList.contains('ff-rail') ? '1' : '0'); paint(); railTitles(); }); brand.appendChild(b);
    }
    const nav = D.getElementById('nav'); if (nav) new MutationObserver(() => { railTitles(); recentPush(); }).observe(nav, { childList: true, subtree: true });
    railTitles(); recentPaint();
  }
  // ---- observer ---------------------------------------------------------------------------------
  let q = [], raf = 0;
  function flush() {
    raf = 0; const m = mainEl(); if (!m) return; const nodes = q; q = [];
    nodes.forEach((n) => { if (n.isConnected) { paintStatus(n); paintEmpty(n); stagger(n); countUp(n); barGrow(n); heroExtras(n); morph(n); reveal(n); miniBars(n); profileTabs(n); } });
    dockVis(); progDone();
  }
  function init() {
    if (!D.body) return; buildDock();
    const m = mainEl(); if (!m) { setTimeout(init, 300); return; }
    new MutationObserver((recs) => { recs.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1) q.push(n); })); if (!raf) raf = requestAnimationFrame(flush); }).observe(m, { childList: true, subtree: true });
    window.addEventListener('hashchange', () => { setMode(false); progStart(); pageTrans(); setTimeout(recentPush, 600); }); headerScroll(); acInit(); railInit(); sharedInit(); microInit();
    q.push(m); flush();
  }
  FF.motion = { setMode, print: actPrint, confetti, chime };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})(window.FF);
