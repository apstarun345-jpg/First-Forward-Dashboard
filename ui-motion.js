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
  // ---- 10 · server waking banner ---------------------------------------------------------------
  let inflight = 0, wakeT = 0, wake = null;
  function wakeShow() {
    if (!wake) { wake = D.createElement('div'); wake.id = 'ux-wake'; wake.innerHTML = '<b>😴 Server jaag raha hai…</b>Free server so jata hai — 20–40 sec lagenge, data apne aap aa jayega.<i></i>'; D.body.appendChild(wake); }
    wake.classList.add('on');
  }
  function wakeHide() { clearTimeout(wakeT); if (wake) wake.classList.remove('on'); }
  const _fetch = window.fetch;
  if (typeof _fetch === 'function') {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const mine = /^\/api\//.test(url) || url.indexOf(location.origin + '/api/') === 0;
      if (!mine) return _fetch.apply(this, arguments);
      inflight++; if (inflight === 1) { clearTimeout(wakeT); wakeT = setTimeout(wakeShow, 6000); }
      const done = () => { inflight = Math.max(0, inflight - 1); if (!inflight) wakeHide(); };
      const p = _fetch.apply(this, arguments);
      p.then(done, done);
      return p;
    };
  }
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
    dock.classList.toggle('on', has && !login);
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
