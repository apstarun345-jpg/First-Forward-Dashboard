/* v3.125.449 — ux2: view transitions · spotlight · global Undo (Ctrl+Z). CSS-only parts ux2.css me. */
(function (W) {
  'use strict';
  const D = document, H = D.documentElement;
  W.FF = W.FF || {};
  const off = () => H.classList.contains('ff-no-anim');
  const lowEnd = () => { try { return (navigator.deviceMemory && navigator.deviceMemory < 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 3); } catch { return false; } };

  /* (3) View Transitions — sidebar / link click par #main smooth badle */
  function vt() {
    if (!D.startViewTransition || lowEnd()) return;
    D.addEventListener('click', (e) => {
      if (off() || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = e.target.closest && e.target.closest('a[href^="#/"]'); if (!a) return;
      if (a.getAttribute('href') === location.hash) return;
      const main = D.getElementById('main'); if (!main) return;
      let changed = false;
      const mo = new MutationObserver(() => { changed = true; });
      mo.observe(main, { childList: true });
      try {
        const t = D.startViewTransition(() => new Promise((res) => {
          const t0 = Date.now();
          (function wait() { if (changed || Date.now() - t0 > 450) { mo.disconnect(); res(); } else setTimeout(wait, 30); })();
        }));
        t.finished.catch(() => {}); t.ready && t.ready.catch(() => {});
      } catch { mo.disconnect(); }
    }, true);
  }

  /* (9) Spotlight — cursor ke saath roshni (sirf mouse, cards/rows par) */
  function spot() {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches || lowEnd()) return;
    const s = D.createElement('div'); s.id = 'ux2-spot'; D.body.appendChild(s);
    let x = 0, y = 0, on = false, raf = 0;
    const SEL = '.kpi, .card, .pb-card, .trs-card, .pb-tbl tr, .tbl tr';
    const paint = () => { raf = 0; s.style.transform = `translate3d(${x}px,${y}px,0)`; s.classList.toggle('on', on); };
    D.addEventListener('pointermove', (e) => {
      if (off() || e.pointerType !== 'mouse') return;
      x = e.clientX; y = e.clientY; on = !!(e.target.closest && e.target.closest(SEL));
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    D.addEventListener('pointerleave', () => { on = false; if (!raf) raf = requestAnimationFrame(paint); });
  }

  /* (7) Undo — FF.undo.offer('Scan hata diya', fn) ; Ctrl+Z se bhi */
  const U = { stack: [], el: null, tm: 0 };
  function hide() { clearTimeout(U.tm); if (U.el) { U.el.remove(); U.el = null; } }
  U.offer = function (label, fn, ms) {
    if (typeof fn !== 'function') return;
    ms = ms || 8000;
    U.stack.push({ label, fn, at: Date.now(), ms }); if (U.stack.length > 5) U.stack.shift();
    hide();
    const el = D.createElement('div'); el.className = 'ux2-undo'; el.setAttribute('role', 'status');
    el.innerHTML = `<span></span><button type="button">↩ Undo</button><kbd>Ctrl+Z</kbd><i style="animation-duration:${ms}ms"></i>`;
    el.firstChild.textContent = label; el.querySelector('button').addEventListener('click', () => U.run());
    D.body.appendChild(el); U.el = el; U.tm = setTimeout(hide, ms);
  };
  U.run = function () {
    const it = U.stack.pop(); if (!it || Date.now() - it.at > it.ms + 20000) { hide(); return false; }
    hide();
    try { Promise.resolve(it.fn()).catch(() => {}); } catch { /* */ }
    return true;
  };
  W.FF.undo = U;
  D.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || (e.key || '').toLowerCase() !== 'z') return;
    const t = e.target; if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName || ''))) return;
    if (U.stack.length && U.run()) e.preventDefault();
  });

  const init = () => { vt(); spot(); };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})(window);
