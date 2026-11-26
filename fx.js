/* v3.125.511 — button ripple: .btn / .icon-btn click par halki lehar (delegated, ek hi listener). ff-no-anim me band. */
(function () {
  'use strict';
  document.addEventListener('pointerdown', (e) => {
    try {
      const b = e.target && e.target.closest && e.target.closest('.btn, .icon-btn');
      if (!b || b.disabled || b.matches('.notification-btn, .user-btn') || b.querySelector('[class*="count"], [class*="badge"]') || document.documentElement.classList.contains('ff-no-anim')) return;
      const r = b.getBoundingClientRect(); if (!r.width) return;
      const d = Math.max(r.width, r.height) * 2;
      const s = document.createElement('span'); s.className = 'fx-rip';
      s.style.width = s.style.height = `${d}px`; s.style.left = `${e.clientX - r.left - d / 2}px`; s.style.top = `${e.clientY - r.top - d / 2}px`;
      const cs = getComputedStyle(b), prevPos = b.style.position, prevOv = b.style.overflow;
      if (cs.position === 'static') b.style.position = 'relative';
      b.style.overflow = 'hidden';
      b.appendChild(s);
      setTimeout(() => { s.remove(); b.style.position = prevPos; b.style.overflow = prevOv; }, 600);
    } catch { /* cosmetic */ }
  }, { passive: true });
})();

/* v3.125.511 — KPI shine: har .kpi / .hs-box par halki chamak ki patti (har ~6 s). Pseudo-elements use nahi hote (wo pehle se bhare hain), isliye ek <i class="kpi-shine"> inject hota hai. */
(function () {
  'use strict';
  const SEL = '.kpi, .hs-box, .gv-live-card';
  let q = false;
  function add() {
    q = false;
    try {
      document.querySelectorAll(SEL).forEach((k, i) => {
        if (k.__shine || k.querySelector(':scope > .kpi-shine')) { k.__shine = 1; return; }
        k.__shine = 1;
        const s = document.createElement('i'); s.className = 'kpi-shine'; s.setAttribute('aria-hidden', 'true');
        s.style.animationDelay = `${(i % 6) * 0.7}s`;
        if (getComputedStyle(k).position === 'static') k.style.position = 'relative';
        k.appendChild(s);
      });
    } catch { /* cosmetic */ }
  }
  function sched() { if (q) return; q = true; (window.requestIdleCallback || ((f) => setTimeout(f, 150)))(add, { timeout: 600 }); }
  const start = () => { sched(); new MutationObserver(sched).observe(document.body, { childList: true, subtree: true }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

/* v3.125.522 — click se pehle hi page ka code prefetch: nav/link par pointer aate hi FF.lazy.ensure(page). Click par page turant ready. */
(function () {
  'use strict';
  const seen = new Set();
  function prefetch(e) {
    try {
      const a = e.target && e.target.closest && e.target.closest('a[href^="#/"], [data-page]');
      if (!a || !window.FF || !FF.lazy || typeof FF.lazy.ensure !== 'function') return;
      const raw = a.getAttribute('data-page') || (a.getAttribute('href') || '').replace(/^#\//, '').split(/[/?]/)[0];
      if (!raw || seen.has(raw)) return;
      seen.add(raw);
      Promise.resolve(FF.lazy.ensure(raw)).catch(() => { seen.delete(raw); });
    } catch { /* prefetch optional */ }
  }
  document.addEventListener('pointerover', prefetch, { passive: true, capture: true });
  document.addEventListener('touchstart', prefetch, { passive: true, capture: true });
})();
