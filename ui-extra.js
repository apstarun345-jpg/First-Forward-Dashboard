/* ✨ ui-extra.js (v213) — halke UI upgrades, sab ek MutationObserver se (rAF-batched, sirf naye nodes):
   • KPI count-up (0 → value, ek baar)        • Home sticky summary bar (scroll par)
   • Mobile: filters bottom-sheet me          • Agent initials avatar (Tag Request, Master profile)
   • ⭐ Pinned agents (Master profile → Home)   • Empty state par ↻ Refresh button
   Reduce-motion / ff-no-anim par animations skip. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const H = document.documentElement;
  const noAnim = () => H.classList.contains('ff-no-anim') || H.classList.contains('a11y-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const mobile = () => H.classList.contains('mobile-ui') || (window.matchMedia && matchMedia('(max-width: 760px)').matches);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private */ } } };

  const css = `
.ux-av{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;font-size:11px;font-weight:800;color:#fff;margin-right:7px;vertical-align:middle;flex:none;letter-spacing:.02em;box-shadow:0 1px 3px rgba(0,0,0,.18)}
.ux-av.lg{width:40px;height:40px;font-size:15px}
.ux-sticky{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 62px);transform:translate(-50%,-140%);opacity:0;pointer-events:none;transition:transform .25s ease,opacity .2s ease;z-index:900;display:flex;gap:6px;padding:6px 8px;border-radius:14px;background:var(--card,#fff);box-shadow:0 8px 24px rgba(15,23,42,.18);transition:transform .28s cubic-bezier(.2,.8,.2,1);max-width:calc(100vw - 24px);overflow-x:auto;scrollbar-width:none}
.ux-sticky.on{transform:translate(-50%,0);opacity:1;pointer-events:auto}
.ux-sticky a{display:flex;flex-direction:column;min-width:78px;padding:3px 9px;border-radius:10px;text-decoration:none;color:inherit;white-space:nowrap}
.ux-sticky a:hover{background:rgba(99,102,241,.08)}
.ux-sticky small{font-size:10.5px;opacity:.7;font-weight:600;max-width:110px;overflow:hidden;text-overflow:ellipsis}.ux-sticky b{font-size:15px}
.ux-fbtn{display:none}
html.mobile-ui .ux-fbtn{display:inline-flex;align-items:center;gap:6px;margin:6px 0}
html.mobile-ui .ux-fsheet:not(.open){display:none!important}
html.mobile-ui .ux-fsheet.open{position:fixed!important;left:0;right:0;bottom:0;z-index:1300;margin:0!important;max-height:78vh;overflow:auto;display:flex!important;flex-wrap:wrap;gap:10px;padding:18px 16px calc(16px + env(safe-area-inset-bottom,0px));background:var(--card,#fff);border-radius:18px 18px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:uxUp .26s cubic-bezier(.2,.8,.2,1)}
html.mobile-ui .ux-fsheet.open>*{flex:1 1 100%;max-width:100%}
.ux-fback{position:fixed;inset:0;z-index:1299;background:rgba(2,6,23,.45);animation:uxFade .2s}
.ux-fdone{flex:1 1 100%!important}
@keyframes uxUp{from{transform:translateY(100%)}}@keyframes uxFade{from{opacity:0}}
.ux-pin{margin-left:8px}
.ux-favs{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}
.ux-favs a{display:inline-flex;align-items:center;padding:4px 10px 4px 4px;border-radius:99px;background:var(--card,#fff);box-shadow:0 1px 4px rgba(15,23,42,.1);text-decoration:none;color:inherit;font-weight:700;font-size:13px}
.ux-favs a .ux-av{width:24px;height:24px;margin-right:6px}`;
  const st = document.createElement('style'); st.id = 'ui-extra-css'; st.textContent = css; document.head.appendChild(st);

  // ---- 🎨 initials avatar ------------------------------------------------------------------------
  function hue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function initials(name) {
    const w = String(name || '').replace(/[^A-Za-zऀ-ॿ ]/g, ' ').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  }
  function avatar(name, big) {
    const n = String(name || '').trim();
    return `<span class="ux-av${big ? ' lg' : ''}" aria-hidden="true" style="background:hsl(${hue(n.toLowerCase())} 62% 46%)">${esc(initials(n))}</span>`;
  }
  if (FF.util) FF.util.avatar = avatar;

  // ---- ⭐ pinned agents ------------------------------------------------------------------------------
  const FAV_KEY = 'ff_fav_agents';
  const favs = () => { try { const a = JSON.parse(LS.get(FAV_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const saveFavs = (a) => LS.set(FAV_KEY, JSON.stringify(a.slice(0, 12)));
  
  // ---- 🔢 count-up --------------------------------------------------------------------------------
  const lastVal = new Map();   // dobara render par 0 se nahi — pichhli value se nayi value tak (same ho to animation nahi)
  function countUp(el) {
    if (el.__ux) return; el.__ux = 1;
    if (noAnim()) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !/\d/.test(node.nodeValue)) node = walker.nextNode();
    if (!node) return;
    const raw = node.nodeValue, m = raw.match(/^(\D*)([\d,]+)(\D*)$/);
    if (!m) return;   // decimal / % / range — jaisa hai waisa
    const target = Number(m[2].replace(/,/g, ''));
    if (!Number.isFinite(target) || target < 10) return;
    const kpi = el.closest('.kpi'); const key = (location.hash.split('?')[0]) + '|' + ((kpi && kpi.dataset.kpiTitle) || '');
    const from = lastVal.has(key) ? lastVal.get(key) : 0; lastVal.set(key, target);
    if (from === target) return;
    const comma = m[2].includes(',');
    const f = (n) => (comma ? n.toLocaleString('en-IN') : String(n));
    const t0 = performance.now(), dur = Math.min(900, 450 + Math.log10(target) * 90);
    const tick = (now) => {
      if (!node.isConnected) return;
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      node.nodeValue = m[1] + f(Math.round(from + (target - from) * e)) + m[3];
      if (k < 1) requestAnimationFrame(tick); else node.nodeValue = raw;
    };
    node.nodeValue = m[1] + f(from) + m[3];
    requestAnimationFrame(tick);
  }

  // ---- 📌 home sticky bar ---------------------------------------------------------------------------
  let stickyBar = null, sTick = 0, sShown = false;
  const isHome = () => /^#\/(home)?$|^$/.test(location.hash.split('?')[0]);
  function stickyCheck() {
    sTick = 0;
    const grid = isHome() ? document.querySelector('#main .kpi-grid') : null;
    const show = !!grid && grid.getBoundingClientRect().bottom < 40;
    if (show && !stickyBar) { stickyBar = document.createElement('nav'); stickyBar.className = 'ux-sticky'; stickyBar.setAttribute('aria-label', 'Quick summary'); document.body.appendChild(stickyBar);
      stickyBar.addEventListener('click', (e) => { if (e.target.closest('[data-ux-go]')) { e.preventDefault(); const g = document.querySelector('#main .kpi-grid'); if (g) g.scrollIntoView({ behavior: noAnim() ? 'auto' : 'smooth', block: 'start' }); } }); }
    if (show && !sShown) {
      const k = [...grid.querySelectorAll('.kpi')].slice(0, 5);
      stickyBar.innerHTML = k.map((x) => { const t = x.querySelector('.kpi-title'), v = x.querySelector('.kpi-value'); return `<a href="#" data-ux-go><small>${esc(t ? t.textContent.trim() : '')}</small><b>${esc(v ? v.textContent.trim() : '')}</b></a>`; }).join('');
    }
    // v232 — topbar ki asli height ke neeche dikhao (lamba topbar / banner ho to bhi kata na ho)
    if (stickyBar && show) {
      const tb = document.querySelector('.topbar');
      const r = tb ? tb.getBoundingClientRect() : null;
      const top = r && r.bottom > 0 ? Math.round(r.bottom + 8) : 12;
      stickyBar.style.top = `${top}px`;
    }
    if (stickyBar && show !== sShown) stickyBar.classList.toggle('on', show);
    sShown = show;
  }
  const onScroll = () => { if (!sTick) sTick = requestAnimationFrame(stickyCheck); };
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('hashchange', () => { sShown = false; if (stickyBar) stickyBar.classList.remove('on'); });

  // ---- 📱 filters bottom sheet ---------------------------------------------------------------------
  const FILTER_SEL = '.ins-filters,.dispatch-filter-bar,.home-exp-filter,.tr-req-filter,.notify-filter-bar,.notify-center-filters,.tr-emp-filters';
  function sheetify(bar) {
    if (bar.__uxSheet || bar.querySelectorAll('input,select').length < 3) return;
    bar.__uxSheet = 1;
    bar.classList.add('ux-fsheet');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn small ux-fbtn'; btn.textContent = '⚙️ Filters';
    bar.parentNode.insertBefore(btn, bar);
    let back = null;
    const done = document.createElement('button');
    done.type = 'button'; done.className = 'btn primary ux-fdone'; done.textContent = '✓ Done';
    const close = () => { bar.classList.remove('open'); if (back) { back.remove(); back = null; } if (done.parentNode) done.remove(); };
    btn.addEventListener('click', () => {
      back = document.createElement('div'); back.className = 'ux-fback'; back.addEventListener('click', close);
      document.body.appendChild(back); bar.appendChild(done); bar.classList.add('open');
    });
    done.addEventListener('click', close);
    window.addEventListener('hashchange', close);
  }

  // ---- 🔍 scan (sirf naye nodes) -------------------------------------------------------------------
  function enhance(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.kpi-value').forEach(countUp);
    if (root.classList && root.classList.contains('kpi-value')) countUp(root);
    if (mobile()) root.querySelectorAll(FILTER_SEL).forEach(sheetify);
    root.querySelectorAll('.tr-c-agent > b:first-child').forEach((b) => { if (b.__ux) return; b.__ux = 1; b.insertAdjacentHTML('beforebegin', avatar(b.textContent)); });
    root.querySelectorAll('.mp-head').forEach((head) => {
      if (head.__ux) return; head.__ux = 1;
      const nb = head.querySelector('.mp-id > b'); const name = nb ? nb.textContent.trim() : ''; if (!name) return;
      const av = head.querySelector('.ms-avatar');
      if (av) { av.textContent = initials(name); av.style.background = `hsl(${hue(name.toLowerCase())} 62% 46%)`; av.style.color = '#fff'; }
      const on = () => favs().some((f) => f.name.toLowerCase() === name.toLowerCase());
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ux-pin';
      const paint = () => { b.textContent = on() ? '⭐ Pinned' : '☆ Pin'; b.title = on() ? 'Home se hatao' : 'Home par pin karo'; };
      paint();
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        let a = favs();
        if (on()) a = a.filter((f) => f.name.toLowerCase() !== name.toLowerCase());
        else a.unshift({ name, hash: location.hash });
        saveFavs(a); paint();
        try { FF.util.toast(on() ? `⭐ ${name} home par pin ho gaya` : 'Pin hata diya', 'ok'); } catch { /* ignore */ }
      });
      nb.after(b);
    });
    root.querySelectorAll('.empty-state').forEach((el) => {
      if (el.__ux || el.querySelector('button,a')) return; el.__ux = 1;
      el.insertAdjacentHTML('beforeend', '<button type="button" class="btn small ux-empty-act">↻ Refresh</button>');
      el.lastElementChild.addEventListener('click', () => { try { if (FF.app && FF.app.refresh) FF.app.refresh(); else location.reload(); } catch { location.reload(); } });
    });
    const hero = root.querySelector && root.querySelector('#home-fresh-alert');
    if (hero && !document.getElementById('ux-favs')) {
      const a = favs();
      if (a.length) hero.insertAdjacentHTML('afterend', `<div class="ux-favs" id="ux-favs"><b class="dim small">⭐ Pinned:</b>${a.map((f) => `<a href="${esc(f.hash || `#/masterSearch?q=${encodeURIComponent(f.name)}`)}">${avatar(f.name)}${esc(f.name)}</a>`).join('')}</div>`);
    }
  }
  let pending = [], raf = 0;
  const flush = () => { raf = 0; const list = pending; pending = []; list.forEach((n) => { if (n.isConnected) enhance(n); }); };
  function start() {
    const main = document.getElementById('main') || document.body;
    enhance(main);
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) pending.push(n);
      if (pending.length && !raf) raf = requestAnimationFrame(flush);
    }).observe(main, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.FF);
