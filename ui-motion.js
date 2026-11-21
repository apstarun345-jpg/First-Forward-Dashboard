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
  function stagger(root) {
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
    denApply(denGet()); set3d(get3d()); tiltInit();
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
  // ---- observer ---------------------------------------------------------------------------------
  let q = [], raf = 0;
  function flush() {
    raf = 0; const m = mainEl(); if (!m) return; const nodes = q; q = [];
    nodes.forEach((n) => { if (n.isConnected) { paintStatus(n); paintEmpty(n); stagger(n); } });
    dockVis(); progDone();
  }
  function init() {
    if (!D.body) return; buildDock();
    const m = mainEl(); if (!m) { setTimeout(init, 300); return; }
    new MutationObserver((recs) => { recs.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1) q.push(n); })); if (!raf) raf = requestAnimationFrame(flush); }).observe(m, { childList: true, subtree: true });
    window.addEventListener('hashchange', () => { setMode(false); progStart(); });
    q.push(m); flush();
  }
  FF.motion = { setMode, print: actPrint };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})(window.FF);
