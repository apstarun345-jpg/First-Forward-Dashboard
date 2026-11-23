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
    setTimeout(greet, 9000); setInterval(greet, 10 * 60e3);
  }
  FF.wow = { scanEvent: (detail) => window.dispatchEvent(new CustomEvent('ff-scan', { detail })) };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})(window.FF);
