/* 🔍 Global search palette — Ctrl / ⌘ + K (ya topbar 🔍 button).
   Ek box me: pages, sheets, agents, TLs — type karo → Enter → seedha kholo.
   Data FF.store ke loaded suggestions se aata hai (koi extra query nahi). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  let backdrop = null, input = null, listEl = null;
  let results = [], active = 0;

  const norm = (s) => String(s || '').toLowerCase().trim();

  function pool() {
    const items = [];
    // Pages (jiske paas permission hai wahi)
    (FF.app && FF.app.PAGES ? FF.app.PAGES : []).forEach((p) => {
      if (FF.auth.can(p.perm)) items.push({ group: 'Pages', icon: p.icon || '📄', label: p.label, sub: p.desc || '', href: `#/${p.id}` });
    });
    if (FF.auth.user) items.push({ group: 'Pages', icon: '⚙️', label: 'Settings', sub: 'Branding · users · access · notifications', href: '#/settings' });
    // Sheets tabs
    (FF.config.tabs || []).forEach((t) => {
      if (t && t.enabled !== false && FF.auth.can(`sheet:${t.id}`)) items.push({ group: 'Sheets', icon: t.icon || '📄', label: t.id, sub: t.desc || 'Sheet', href: `#/sheet/${encodeURIComponent(t.id)}` });
    });
    // Agents + TLs (store ke shared suggestions se — loaded data hi)
    let sugg = [];
    try { sugg = FF.store && FF.store.suggestions ? FF.store.suggestions({ agents: true, tls: true }) : []; } catch { sugg = []; }
    sugg.forEach((s) => {
      if (s.kind === 'agent') items.push({ group: 'Agents', icon: '🧑‍💼', label: s.label, sub: s.sub || '', href: `#/stock?agent=${encodeURIComponent(s.value)}`, kw: s.keywords || '' });
      else if (s.kind === 'tl') items.push({ group: 'TLs', icon: '👥', label: s.label, sub: s.sub || '', href: `#/stock?tl=${encodeURIComponent(s.value)}` });
    });
    return items;
  }

  function search(q) {
    const nq = norm(q);
    const all = pool();
    const score = (it) => {
      if (!nq) return 0;
      const l = norm(it.label);
      if (l === nq) return -2;
      if (l.startsWith(nq)) return -1;
      if (l.includes(nq) || norm(it.sub).includes(nq) || norm(it.kw).includes(nq)) return 0;
      return 1; // miss
    };
    const scored = all.map((it) => ({ it, s: score(it) })).filter((x) => x.s < 0 || (x.s === 0 && nq) || !nq);
    scored.sort((a, b) => a.s - b.s);
    // Group-wise cap: q khali ho to har group se top; warna total top 24.
    if (!nq) {
      const caps = { Pages: 8, Sheets: 6, Agents: 8, TLs: 6 };
      const seen = {};
      return scored.map((x) => x.it).filter((it) => { seen[it.group] = (seen[it.group] || 0) + 1; return seen[it.group] <= (caps[it.group] || 6); });
    }
    return scored.slice(0, 24).map((x) => x.it);
  }

  function draw(q) {
    results = search(q);
    active = 0;
    if (!results.length) {
      listEl.innerHTML = `<div class="palette-empty">"${esc(q)}" ke liye kuch nahi mila.<br><small>Agent, TL, page ya sheet naam try karo.</small></div>`;
      return;
    }
    let html = '', lastGroup = '';
    results.forEach((it, i) => {
      if (it.group !== lastGroup) { html += `<div class="palette-group">${esc(it.group)}</div>`; lastGroup = it.group; }
      html += `<button type="button" class="palette-item ${i === active ? 'active' : ''}" data-pi="${i}"><span class="palette-ico">${it.icon}</span><span class="palette-txt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
    });
    listEl.innerHTML = html;
  }

  function move(delta) {
    if (!results.length) return;
    active = (active + delta + results.length) % results.length;
    [...listEl.querySelectorAll('.palette-item')].forEach((el) => el.classList.toggle('active', Number(el.dataset.pi) === active));
    const el = listEl.querySelector(`.palette-item[data-pi="${active}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function go(index) {
    const it = results[index !== undefined && index >= 0 ? index : active];
    if (!it) return;
    close();
    if (location.hash === it.href) { FF.app.renderCurrent && FF.app.renderCurrent(); } else location.hash = it.href;
  }

  function ensure() {
    if (backdrop) return;
    backdrop = U.h(`<div class="palette-backdrop" id="palette-backdrop" hidden>
      <div class="palette-box" role="dialog" aria-label="Global search">
        <div class="palette-input-row"><span class="palette-search-ico">🔍</span><input class="palette-input" id="palette-input" placeholder="Agent, TL, page, sheet… (Ctrl / ⌘ + K)" autocomplete="off" spellcheck="false"><kbd class="palette-kbd">Esc</kbd></div>
        <div class="palette-list" id="palette-list"></div>
        <div class="palette-foot"><span><kbd>↑↓</kbd> move · <kbd>Enter</kbd> open</span><span>Pages · Sheets · Agents · TLs</span></div>
      </div></div>`);
    document.body.appendChild(backdrop);
    input = U.$('#palette-input', backdrop);
    listEl = U.$('#palette-list', backdrop);
    input.addEventListener('input', () => draw(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) { close(); return; }
      const item = e.target.closest && e.target.closest('[data-pi]');
      if (item) go(Number(item.dataset.pi));
    });
  }

  function open() {
    if (!FF.auth.user) return; // login screen par search ki zaroorat nahi
    ensure();
    backdrop.hidden = false;
    input.value = '';
    draw('');
    try { input.focus(); } catch { /* ignore */ }
  }
  function close() { if (backdrop) backdrop.hidden = true; }
  function toggle() { if (!backdrop || backdrop.hidden) open(); else close(); }

  // Global shortcut + topbar button
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'k') { e.preventDefault(); toggle(); }
  });
  const btn = U.$('#global-search-btn');
  if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); toggle(); });

  FF.palette = { open, close, toggle };
})(window.FF);
