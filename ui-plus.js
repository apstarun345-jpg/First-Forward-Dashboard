/* ui-plus.js — small, dependency-free UI helpers (v161)
 *  • Density switch (Comfortable / Compact) — topbar button, saved per device
 *  • Offline banner — shows when internet drops, auto-refreshes data when it returns
 *  • Click-to-copy — any [data-copy] button and long IDs/barcodes in drill tables
 */
(function (FF) {
  'use strict';
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
  };
  const toast = (m, t) => { try { if (FF.util && FF.util.toast) FF.util.toast(m, t || 'ok'); } catch { /* ignore */ } };

  // ---- density -------------------------------------------------------------------------------------
  function density() { return LS.get('ff_density') === 'compact' ? 'compact' : 'comfortable'; }
  function applyDensity(v) {
    if (v === 'compact') document.documentElement.setAttribute('data-density', 'compact');
    else document.documentElement.removeAttribute('data-density');
    const b = document.getElementById('density-toggle');
    if (b) { b.textContent = v === 'compact' ? '▤' : '▦'; b.title = v === 'compact' ? 'Compact view (click: Comfortable)' : 'Comfortable view (click: Compact)'; b.setAttribute('aria-pressed', String(v === 'compact')); }
  }
  function mountDensityButton() {
    if (document.getElementById('density-toggle')) return;
    const theme = document.getElementById('theme-toggle');
    if (!theme || !theme.parentNode) return;
    const b = document.createElement('button');
    b.className = 'icon-btn'; b.id = 'density-toggle'; b.type = 'button';
    b.setAttribute('data-top-secondary', '1'); b.setAttribute('aria-label', 'Compact / Comfortable view');
    b.addEventListener('click', () => {
      const next = density() === 'compact' ? 'comfortable' : 'compact';
      LS.set('ff_density', next); applyDensity(next);
      toast(next === 'compact' ? '▤ Compact view — zyada data ek screen par' : '▦ Comfortable view', 'ok');
    });
    theme.parentNode.insertBefore(b, theme);
    applyDensity(density());
  }

  // ---- offline bar ---------------------------------------------------------------------------------
  function bar() {
    let el = document.getElementById('ff-offline-bar');
    if (!el) { el = document.createElement('div'); el.id = 'ff-offline-bar'; el.setAttribute('role', 'status'); el.hidden = true; document.body.appendChild(el); }
    return el;
  }
  let hideTimer = 0;
  function goOffline() {
    clearTimeout(hideTimer);
    const el = bar(); el.className = ''; el.hidden = false;
    el.textContent = '📴 Internet nahi hai — last loaded data dikh raha hai. Wapas aate hi data apne aap refresh hoga.';
  }
  function goOnline() {
    const el = bar(); if (el.hidden) return;
    el.className = 'back'; el.textContent = '🌐 Internet wapas aa gaya — data refresh ho raha hai…';
    try { if (FF.app && FF.app.refresh) Promise.resolve(FF.app.refresh()).catch(() => {}); } catch { /* ignore */ }
    clearTimeout(hideTimer); hideTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }
  window.addEventListener('offline', goOffline);
  window.addEventListener('online', goOnline);

  // ---- copy ----------------------------------------------------------------------------------------
  async function copy(text) {
    text = String(text == null ? '' : text); if (!text) return false;
    try { if (FF.util && FF.util.copyText) { await FF.util.copyText(text); return true; } } catch { /* fall through */ }
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }
  document.addEventListener('click', async (e) => {
    const t = e.target.closest && e.target.closest('[data-copy]');
    if (t) {
      e.preventDefault(); e.stopPropagation();
      const ok = await copy(t.getAttribute('data-copy'));
      if (ok) { t.classList.add('done'); setTimeout(() => t.classList.remove('done'), 900); toast('📋 Copy ho gaya: ' + String(t.getAttribute('data-copy')).slice(0, 40), 'ok'); }
      else toast('Copy nahi hua — manually select karke copy karein', 'warn');
      return;
    }
    const td = e.target.closest && e.target.closest('.gs-drawer-table td.mono');
    if (td) {
      const v = (td.textContent || '').trim();
      if (v.length >= 8 && !/\s/.test(v) && await copy(v)) toast('📋 Copy ho gaya: ' + v.slice(0, 40), 'ok');
    }
  }, true);
  // Mark copyable cells (for cursor) as drawers open
  new MutationObserver((list) => {
    for (const m of list) m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      n.querySelectorAll && n.querySelectorAll('.gs-drawer-table td.mono').forEach((td) => { const v = (td.textContent || '').trim(); if (v.length >= 8 && !/\s/.test(v)) td.setAttribute('data-copyable', '1'); });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  function boot() { applyDensity(density()); mountDensityButton(); if (typeof navigator !== 'undefined' && navigator.onLine === false) goOffline(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('ff:data-loaded', mountDensityButton, { once: true });
  FF.uiPlus = { density, applyDensity, copy, goOffline, goOnline };
})(window.FF = window.FF || {});
