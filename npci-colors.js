/* v3.125.393 — npci-colors.js: jahan bhi sirf "VC4 / VC20 / VC5+ / VC12 / Class 7" jaisa label dikhe, use NPCI FASTag colour de (data-vc + npci-chip). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const RE = /^(?:vc|class|cls)\s*-?\s*(4|5\s*\+|5p|5plus|5|6|7|12|15|16|20)$/i;
  const SEL = 'td, th, span, b, strong, small, em, i, button, a, label, .chip, .badge, option';
  const SKIP = /(^|\s)(badge-vc|pb-badge-vc|dsp-pill|cg-|npci-)/;
  const key = (m) => { const v = m.replace(/\s+/g, '').toLowerCase(); return v === '5+' || v === '5p' || v === '5plus' ? 'vc5p' : 'vc' + v; };
  let q = [], raf = 0;
  function scan(root) {
    let list; try { list = root.querySelectorAll ? root.querySelectorAll(SEL) : []; } catch { return; }
    const nodes = root.matches && root.matches(SEL) ? [root, ...list] : [...list];
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.hasAttribute('data-vc') || el.children.length > 0) continue;
      const t = el.textContent; if (!t || t.length > 9) continue;
      const m = RE.exec(t.trim()); if (!m) continue;
      el.setAttribute('data-vc', key(m[1]));
      if (el.tagName === 'TD' || el.tagName === 'TH') el.classList.add('npci-cell');
      else if (!SKIP.test(el.className || '') && el.tagName !== 'OPTION') el.classList.add('npci-chip');
    }
  }
  function flush() { raf = 0; const n = q; q = []; for (const r of n) if (r.isConnected) scan(r); }
  function init() {
    if (!document.body) return;
    new MutationObserver((recs) => { for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1) q.push(n); if (q.length && !raf) raf = requestAnimationFrame(flush); }).observe(document.body, { childList: true, subtree: true });
    scan(document.body);
  }
  FF.npci = { scan, key };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.FF);
