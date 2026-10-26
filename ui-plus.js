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


  // ---- 🔢 Barcode har jagah 6-3-7 (608116-039-0744090): safety net — jo screen/dialog/table raw 16-digit dikhaye use bhi dash me badal do.
  const BAR_RE = /(^|[^\d-])(6\d{5})(\d{3})(\d{7})(?![\d-])/g;
  const SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE|PRE|NOSCRIPT|SELECT|OPTION)$/;
  function dashNode(root) {
    if (!root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
      const pe = n.parentNode; if (!pe || SKIP.test(pe.nodeName) || (pe.isContentEditable)) return NodeFilter.FILTER_REJECT;
      return /\d{16}/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    } });
    const list = []; while (w.nextNode()) list.push(w.currentNode);
    list.forEach((n) => { const v = n.nodeValue.replace(BAR_RE, '$1$2-$3-$4'); if (v !== n.nodeValue) n.nodeValue = v; });
  }
  let barQueue = new Set(), barRaf = 0;
  function flushBars() { barRaf = 0; const q = barQueue; barQueue = new Set(); q.forEach((n) => { if (n.isConnected) dashNode(n); }); }
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') { if (m.target.parentNode && /\d{16}/.test(m.target.nodeValue)) barQueue.add(m.target.parentNode); }
      else m.addedNodes.forEach((n) => { if (n.nodeType === 1) barQueue.add(n); else if (n.nodeType === 3 && n.parentNode) barQueue.add(n.parentNode); });
    }
    if (barQueue.size && !barRaf) barRaf = requestAnimationFrame(flushBars);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  FF.dashBarcodes = dashNode;

  function boot() { dashNode(document.body); applyDensity(density()); mountDensityButton(); if (typeof navigator !== 'undefined' && navigator.onLine === false) goOffline(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('ff:data-loaded', mountDensityButton, { once: true });

  // ---- 🆕 NEW Agent tag (v3.98) — Tag Request + Master Search + Agent Summary me ek hi logic ------------
  // "New" = New Agents page wali definition (pehli issuance is + pichhle month me). Data lazy load hota hai.
  const NewAgent = (function () {
    let idx = null, loading = null;
    const alnum = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const digs = (v) => String(v == null ? '' : v).replace(/\D/g, '');
    const nm = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    function build(data) {
      const set = new Set();
      ['ff', 'gv'].forEach((ch) => {
        const part = data && data[ch];
        ((part && part.rows) || []).forEach((r) => {
          if (!r.isNew) return;
          if (r.id) { set.add(`${ch}|i:${alnum(r.id)}`); const d = digs(r.id); if (d.length >= 4) set.add(`${ch}|d:${d}`); }
          if (r.name) set.add(`${ch}|n:${nm(r.name)}`);
        });
      });
      idx = set;
    }
    /** Data ready karo (ek baar). Resolve → true jab index bana. */
    function ready() {
      if (idx) return Promise.resolve(true);
      if (loading) return loading;
      loading = Promise.resolve()
        .then(() => (FF.newAgents ? null : (FF.lazy && FF.lazy.need ? FF.lazy.need('newAgents') : null)))
        .then(() => (FF.newAgents && FF.newAgents.collect ? FF.newAgents.collect(2) : null))
        .then((d) => { if (d) build(d); return !!idx; })
        .catch(() => false)
        .then((ok) => { loading = null; return ok; });
      return loading;
    }
    /** Sync check — ready() se pehle false. ch '' ho to dono channel dekhta hai. */
    function isNew(ch, id, name) {
      if (!idx) return false;
      const chs = ch === 'gv' || ch === 'ff' ? [ch] : ['ff', 'gv'];
      const a = alnum(id), d = digs(id);
      return chs.some((c) => (a && idx.has(`${c}|i:${a}`)) || (d.length >= 4 && idx.has(`${c}|d:${d}`)) || (!a && name && idx.has(`${c}|n:${nm(name)}`)));
    }
    const tag = () => '<span class="new-agent-tag" title="Naya agent — pehli issuance haal hi me shuru hui">NEW Agent</span>';
    /** HTML tag (ya '') — sirf agents ke liye. */
    function html(ch, id, name) { return isNew(ch, id, name) ? tag() : ''; }
    /** root ke andar [data-new-agent="ch|id|name"] slots me tag bharo (ready hone ke baad). */
    function paint(root) {
      return ready().then((ok) => {
        if (!ok || !root || !root.querySelectorAll) return;
        root.querySelectorAll('[data-new-agent]').forEach((el) => {
          const [ch, id, name] = String(el.getAttribute('data-new-agent') || '').split('|');
          el.innerHTML = html(ch, id, name);
        });
      });
    }
    return { ready, isNew, html, paint };
  })();
  FF.newAgentTag = NewAgent;
  FF.uiPlus = { density, applyDensity, copy, goOffline, goOnline };
})(window.FF = window.FF || {});
