/* ✨ wow.js (v3.125.446) — visual polish: KPI live-change glow, 3D Godown (stock ageing), cursor aurora, mascot scan reactions + subah ka greeting.
   Sab kuch Settings → "Animations band" (html.ff-no-anim) aur coarse/low-end device par apne aap halka ya band ho jaata hai. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const D = document, H = D.documentElement;
  const off = () => H.classList.contains('ff-no-anim');
  const fine = () => { try { return matchMedia('(pointer:fine)').matches; } catch { return false; } };
  const lowEnd = () => { try { return (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2); } catch { return false; } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

  /* (KPI 3D tilt pehle se ui-motion.js me hai — dobara nahi) */

  /* ---- 2 · live change glow: KPI ka number badle to ek baar chamak ---- */
  function bumpScan() {
    if (off() || D.hidden) return;
    D.querySelectorAll('.kpi-value').forEach((el) => {
      const t = (el.textContent || '').trim(); const first = el.dataset.wowAt;
      if (!first) { el.dataset.wowAt = String(Date.now()); el.dataset.wowLast = t; return; }
      if (Date.now() - Number(first) < 2500) { el.dataset.wowLast = t; return; }   // odometer ghoom raha hai
      if (t && t !== el.dataset.wowLast && /\d/.test(t)) { el.dataset.wowLast = t; const c = el.closest('.kpi'); if (c) { c.classList.remove('wow-bump'); void c.offsetWidth; c.classList.add('wow-bump'); setTimeout(() => c.classList.remove('wow-bump'), 1600); } }
    });
  }

  /* ---- 3 · cursor aurora (parallax glow) ---- */
  function auroraInit() {
    if (!fine() || lowEnd()) return;
    let raf = 0, px = 0.5, py = 0.2;
    D.addEventListener('pointermove', (e) => { px = e.clientX / innerWidth; py = e.clientY / innerHeight; if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (off()) return; H.style.setProperty('--wow-x', (px * 100).toFixed(1) + '%'); H.style.setProperty('--wow-y', (py * 100).toFixed(1) + '%'); }); }, { passive: true });
    H.classList.add('wow-aurora');
  }

  /* ---- 4 · 🏭 3D Godown: stock ageing (FF / GV × VC4 / Commercial × age) ---- */
  const AGE_COL = ['#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444'];
  const gd = { ch: 'ff', data: null, rx: -24, ry: -38, drag: null, auto: true, raf: 0, el: null };
  function buckets(o, row) {   // o.t = [vc4, comm], o.c[row] = [>=th0, >=th1, ...] (cumulative "itne din se purana")
    const t = o.t[row] || 0, c = o.c[row] || [];
    const a = [t - (c[0] || 0), (c[0] || 0) - (c[1] || 0), (c[1] || 0) - (c[2] || 0), (c[2] || 0) - (c[3] || 0), c[3] || 0];
    return a.map((x) => Math.max(0, x));
  }
  function godownHtml() {
    const j = gd.data, th = j.thresholds || [30, 90, 150, 180], o = (j[gd.ch] || {}).all;
    if (!o) return '<div class="wow-gd-empty">Is channel ka stock data nahi mila</div>';
    const labels = [`0–${th[0]}d`, `${th[0]}–${th[1]}d`, `${th[1]}–${th[2]}d`, `${th[2]}–${th[3]}d`, `${th[3]}d+`];
    const rows = [buckets(o, 0), buckets(o, 1)], names = ['VC4 (car/jeep)', 'Commercial'];
    const max = Math.max(1, ...rows.flat()), HMAX = 190;
    const cell = 74, gap = 18, W = 5 * cell + 4 * gap, Dp = 2 * cell + gap;
    let boxes = '';
    rows.forEach((r, ri) => r.forEach((v, ci) => {
      const h = Math.max(6, Math.round(Math.sqrt(v / max) * HMAX)), x = ci * (cell + gap), z = ri * (cell + gap);
      const lab = v >= max * 0.08 ? fmt(v) : '';
      boxes += `<div class="wow-box" style="--x:${x}px;--z:${z}px;--h:${h}px;--c:${AGE_COL[ci]};--d:${(ri * 5 + ci) * 55}ms" data-tip="${esc(names[ri])} · ${esc(labels[ci])}: ${fmt(v)}"><i class="f t"></i><i class="f fr">${lab}</i><i class="f bk"></i><i class="f rt"></i><i class="f lf"></i></div>`;
    }));
    const old = rows.flat().filter((_, i) => i % 5 >= 2).reduce((a, b) => a + b, 0), tot = (o.t[0] || 0) + (o.t[1] || 0);
    return `<div class="wow-gd-scene"><div class="wow-gd-world" data-gd-world style="width:${W}px;height:${Dp}px;transform-origin:${W / 2}px 0 ${Dp / 2}px;transform:rotateX(${gd.rx}deg) rotateY(${gd.ry}deg)"><div class="wow-gd-floor" style="width:${W + 40}px;height:${Dp + 40}px"></div>${boxes}</div></div>
      <div class="wow-gd-legend">${labels.map((l, i) => `<span><i style="background:${AGE_COL[i]}"></i>${esc(l)}</span>`).join('')}</div>
      <div class="wow-gd-sum"><div><small>Total stock</small><b>${fmt(tot)}</b></div><div><small>VC4</small><b>${fmt(o.t[0])}</b></div><div><small>Commercial</small><b>${fmt(o.t[1])}</b></div><div class="${old / Math.max(1, tot) > 0.3 ? 'bad' : ''}"><small>90 din se purana</small><b>${fmt(old)} <em>${Math.round(old / Math.max(1, tot) * 100)}%</em></b></div></div>`;
  }
  function godownPaint() {
    if (!gd.el) return; const body = gd.el.querySelector('[data-gd-body]');
    body.innerHTML = godownHtml();
    gd.el.querySelectorAll('[data-gd-ch]').forEach((b) => b.classList.toggle('on', b.dataset.gdCh === gd.ch));
  }
  async function godownLoad(fresh) {
    const body = gd.el.querySelector('[data-gd-body]'); body.innerHTML = '<div class="wow-gd-empty"><span class="wow-sk" style="width:60%"></span><span class="wow-sk" style="width:40%"></span><br>Godown ka data aa raha hai…</div>';
    for (let i = 0; i < 12 && gd.el; i++) {
      try {
        const r = await fetch('/api/stock-age' + (fresh ? '?fresh=1' : ''), { credentials: 'same-origin', cache: 'no-store' }); const j = await r.json();
        if (j && j.ff && j.ff.all) { gd.data = j; godownPaint(); return; }
      } catch { /* retry */ }
      await new Promise((ok) => setTimeout(ok, 2500));
    }
    if (gd.el) body.innerHTML = '<div class="wow-gd-empty">Stock abhi load nahi hua — thodi der baad dobara kholo.</div>';
  }
  function godownSpin() {
    cancelAnimationFrame(gd.raf);
    const tick = () => { if (!gd.el) return; if (gd.auto && !gd.drag && !off()) { gd.ry += 0.18; const w = gd.el.querySelector('[data-gd-world]'); if (w) w.style.transform = `rotateX(${gd.rx}deg) rotateY(${gd.ry}deg)`; } gd.raf = requestAnimationFrame(tick); };
    gd.raf = requestAnimationFrame(tick);
  }
  function godown() {
    if (gd.el) return;
    const el = D.createElement('div'); el.className = 'wow-gd'; gd.el = el; gd.auto = !off();
    el.innerHTML = `<div class="wow-gd-card" role="dialog" aria-label="3D Godown"><div class="wow-gd-head"><b>🏭 3D Godown — stock ageing</b><span class="wow-gd-tabs"><button data-gd-ch="ff" class="on">First Forward</button><button data-gd-ch="gv">GV Partner</button></span><button class="wow-gd-x" data-gd-close aria-label="Band karo">✕</button></div><div class="wow-gd-hint">Ghumane ke liye drag karo · box ki unchai = stock · hara = naya, laal = purana</div><div data-gd-body></div><div class="wow-gd-tip" data-gd-tip hidden></div></div>`;
    D.body.appendChild(el);
    const close = () => { cancelAnimationFrame(gd.raf); el.remove(); gd.el = null; D.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); }; D.addEventListener('keydown', onKey);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-gd-close]')) close(); const c = e.target.closest('[data-gd-ch]'); if (c) { gd.ch = c.dataset.gdCh; godownPaint(); } });
    const sc = () => el.querySelector('.wow-gd-scene');
    el.addEventListener('pointerdown', (e) => { if (!e.target.closest('.wow-gd-scene')) return; gd.drag = { x: e.clientX, y: e.clientY }; gd.auto = false; try { e.target.setPointerCapture(e.pointerId); } catch { /* */ } });
    el.addEventListener('pointermove', (e) => {
      const tip = el.querySelector('[data-gd-tip]'), b = e.target.closest ? e.target.closest('.wow-box') : null;
      if (b) { tip.hidden = false; tip.textContent = b.dataset.tip; const r = el.querySelector('.wow-gd-card').getBoundingClientRect(); tip.style.left = Math.min(r.width - 220, Math.max(8, e.clientX - r.left + 12)) + 'px'; tip.style.top = (e.clientY - r.top + 14) + 'px'; } else tip.hidden = true;
      if (!gd.drag) return; gd.ry += (e.clientX - gd.drag.x) * 0.5; gd.rx = Math.max(-70, Math.min(-8, gd.rx - (e.clientY - gd.drag.y) * 0.3)); gd.drag = { x: e.clientX, y: e.clientY };
      const w = el.querySelector('[data-gd-world]'); if (w) w.style.transform = `rotateX(${gd.rx}deg) rotateY(${gd.ry}deg)`;
    });
    const up = () => { gd.drag = null; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    void sc; godownLoad(false); godownSpin();
  }
  /** Home / Stock par chhota "🏭 3D Godown" button. */
  function launcher() {
    let b = D.getElementById('wow-gd-btn');
    const route = (location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] || 'home');
    const show = ['home', 'dashboard', 'stock', 'stockReport', 'gvStock'].includes(route) && !!D.querySelector('#main .page, #main .kpi-grid') && !D.body.classList.contains('public-form') && !!(FF.auth && FF.auth.user);
    if (!show) { if (b) b.hidden = true; return; }
    if (!b) { b = D.createElement('button'); b.id = 'wow-gd-btn'; b.className = 'wow-gd-btn'; b.type = 'button'; b.innerHTML = '🏭 <span>3D Godown</span>'; b.title = 'Stock ageing 3D me dekho'; b.onclick = godown; D.body.appendChild(b); }
    b.hidden = false;
  }

  /* ---- 5 · mascot reactions (scan) + subah ka greeting ---- */
  const sc = { n: 0, bad: 0 };
  function push(it) { try { if (FF.mascot && FF.mascot.push) FF.mascot.push({ fast: true, view: 'big', q: '', ...it }); } catch { /* optional */ } }
  window.addEventListener('ff-scan', (e) => {
    const d = (e && e.detail) || {}; sc.n++;
    if (d.kind === 'iss' || d.kind === 'nf') {
      sc.bad++;
      push({ key: `wow:bad:${Date.now()}`, grp: 'wow-scan', mood: 'sad', icon: d.kind === 'iss' ? '⛔' : '❓', title: d.kind === 'iss' ? 'Ye tag pehle hi issue ho chuka hai' : 'Ye barcode stock me nahi mila', head: d.code || '', big: d.kind === 'iss' ? '⛔' : '❓', rows: [{ name: 'Barcode', val: d.code || '', sub: d.agent || '', tone: 'down' }], say: d.kind === 'iss' ? 'अरे! यह टैग पहले ही इश्यू हो चुका है।' : 'यह बारकोड स्टॉक में नहीं मिला।' });
    } else if (sc.n > 0 && sc.n % 25 === 0) {
      push({ key: `wow:ms:${sc.n}:${Date.now()}`, grp: 'wow-scan', mood: 'excited', icon: '🎉', title: `${sc.n} scan ho gaye!`, head: sc.bad ? `${sc.bad} galat the` : 'ek bhi galat nahi', big: String(sc.n), rows: [{ name: 'Scan', val: String(sc.n), sub: sc.bad ? `${sc.bad} galat` : 'sab sahi', tone: 'up' }], say: `शाबाश! ${sc.n} स्कैन हो गए।` });
      try { if (FF.ux && FF.ux.confetti) FF.ux.confetti(); } catch { /* optional */ }
    }
  });
  function greet() {
    try {
      const k = 'ff_wow_greet', today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(k) === today || !(FF.mascot && FF.mascot.push) || !(FF.auth && FF.auth.user)) return;
      const h = new Date(Date.now() + 19800e3).getUTCHours(); if (h < 6 || h > 14) return;
      const m = /MTD ([\d,]+)/.exec(D.title), t = /([\d,]+) tags today/.exec(D.title);
      const name = String(FF.auth.user.name || FF.auth.user.username || '').split(' ')[0];
      localStorage.setItem(k, today);
      push({ key: `wow:greet:${today}`, grp: 'wow-greet', mood: 'happy', icon: '☀️', title: `Good morning${name ? ' ' + name : ''}!`, head: m ? `Is mahine ab tak ${m[1]} tags` : 'Aaj ka din shandar banate hain', big: t ? t[1] : '☀️', rows: [{ name: 'Aaj ke tags', val: t ? t[1] : '—', sub: 'abhi tak', tone: 'up' }, { name: 'Is mahine (MTD)', val: m ? m[1] : '—', sub: '', tone: 'up' }], say: `सुप्रभात ${name}! ${m ? 'इस महीने अब तक ' + m[1] + ' टैग्स हो चुके हैं।' : 'आज का दिन शानदार बनाते हैं।'}` });
    } catch { /* optional */ }
  }

  function init() {
    auroraInit();
    setInterval(bumpScan, 4000);
    window.addEventListener('hashchange', () => setTimeout(launcher, 500));
    setInterval(launcher, 5000); setTimeout(launcher, 1500);
    setTimeout(greet, 9000); setInterval(greet, 10 * 60e3);
  }
  FF.wow = { godown, scanEvent: (detail) => window.dispatchEvent(new CustomEvent('ff-scan', { detail })) };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})(window.FF);
