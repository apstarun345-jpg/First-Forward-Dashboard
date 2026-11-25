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
