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
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  /** Quick calculator: "12*340+5" → result item (Enter = copy). Sirf digits/operators allow. */
  function calcResult(q) {
    const s = String(q || '').trim();
    if (s.length < 2 || !/^[\d\s+\-*/().%]+$/.test(s) || !/[+\-*/]/.test(s)) return null;
    try {
      const v = Function('"use strict";return (' + s.replace(/%/g, '/100') + ')')();
      if (typeof v === 'number' && isFinite(v)) return Math.round(v * 100) / 100;
    } catch { /* not a sum */ }
    return null;
  }

  function pool() {
    const items = [];
    // Pages (jiske paas permission hai wahi)
    (FF.app && FF.app.PAGES ? FF.app.PAGES : []).forEach((p) => {
      if (FF.auth.can(p.perm)) items.push({ group: 'Pages', icon: p.icon || '📄', label: p.label, sub: p.desc || '', href: `#/${p.id}` });
    });
    if (FF.auth.user) items.push({ group: 'Pages', icon: '⚙️', label: 'Settings', sub: 'Branding · users · access · notifications · features', href: '#/settings' });
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
    // 📅 Date shortcuts → Range Report (from/to seedha khulta hai)
    if (FF.auth.can('tagIssued')) {
      const now = new Date();
      const today = dk(now);
      const yest = dk(new Date(now.getTime() - 86400e3));
      const weekStart = dk(new Date(now.getTime() - (((now.getDay() + 6) % 7)) * 86400e3));
      const wsMs = new Date(`${weekStart}T00:00:00`).getTime();
      const lastWeekEnd = dk(new Date(wsMs - 86400e3));
      const lastWeekStart = dk(new Date(wsMs - 7 * 86400e3));
      const monthStart = `${today.slice(0, 8)}01`;
      const pm = new Date(now.getFullYear(), now.getMonth(), 0);
      const prevStart = `${pm.getFullYear()}-${pad(pm.getMonth() + 1)}-01`;
      const prevEnd = `${pm.getFullYear()}-${pad(pm.getMonth() + 1)}-${pad(pm.getDate())}`;
      const mk = (label, sub, from, to) => items.push({ group: 'Dates', icon: '📅', label, sub, href: `#/rangeReport?from=${from}&to=${to}` });
      mk('Aaj ki range report', `Aaj · ${today}`, today, today);
      mk('Kal (pichhla din) report', `Kal · ${yest}`, yest, yest);
      mk('Is hafte ka report', `Som → Aaj · ${weekStart} → ${today}`, weekStart, today);
      mk('Pichhle hafte ka report', `${lastWeekStart} → ${lastWeekEnd}`, lastWeekStart, lastWeekEnd);
      mk('Is mahine ka report', `1 → Aaj · ${monthStart} → ${today}`, monthStart, today);
      mk('Pichhle mahine ka report', `${prevStart} → ${prevEnd}`, prevStart, prevEnd);
    }
    // 🕘 Recent notifications (data → drawer/redirect)
    try {
      const itemsN = (FF.notifications && FF.notifications.state && FF.notifications.state.items) || [];
      itemsN.slice(-6).reverse().forEach((it) => items.push({ group: 'Recent', icon: it.type === 'alert' ? '🔴' : it.type === 'digest' ? '🌅' : '🔔', label: it.title, sub: String(it.body || '').slice(0, 90), notif: it }));
    } catch { /* notifications not loaded */ }
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
    // Calculator: "12*340" jaisa query ho to result sabse upar.
    const res = nq ? calcResult(nq) : null;
    const calcItem = res === null ? [] : [{ group: 'Calculate', icon: '🧮', label: `= ${U.fmt(res)}`, sub: 'Enter dabao → copy ho jayega', calc: res }];
    // Group-wise cap: q khali ho to har group se top; warna total top 24.
    if (!nq) {
      const caps = { Pages: 8, Sheets: 6, Agents: 8, TLs: 6, Dates: 6, Recent: 6 };
      const seen = {};
      return scored.map((x) => x.it).filter((it) => { seen[it.group] = (seen[it.group] || 0) + 1; return seen[it.group] <= (caps[it.group] || 6); });
    }
    return [...calcItem, ...scored.slice(0, 24).map((x) => x.it)];
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
    if (it.calc !== undefined && it.calc !== null) { U.copyText(String(it.calc)).then(() => U.toast(`Copied: ${it.calc}`, 'ok')).catch(() => {}); return; }
    if (it.notif) { if (FF.liveView && FF.liveView.openNotification) FF.liveView.openNotification(it.notif); return; }
    if (location.hash === it.href) { FF.app.renderCurrent && FF.app.renderCurrent(); } else location.hash = it.href;
  }

  function ensure() {
    if (backdrop) return;
    backdrop = U.h(`<div class="palette-backdrop" id="palette-backdrop" hidden>
      <div class="palette-box" role="dialog" aria-label="Global search">
        <div class="palette-input-row"><span class="palette-search-ico">🔍</span><input class="palette-input" id="palette-input" placeholder="Agent, TL, page, sheet… (Ctrl / ⌘ + K)" autocomplete="off" spellcheck="false"><kbd class="palette-kbd">Esc</kbd></div>
        <div class="palette-list" id="palette-list"></div>
        <div class="palette-foot"><span><kbd>↑↓</kbd> move · <kbd>Enter</kbd> open</span><span>Pages · Sheets · Agents · TLs · Dates · calc</span></div>
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
    if (FF.config.feat && FF.config.feat('search') === false) { U.toast('Global search band hai — Settings → 🎛 Features se ON karo', 'warn'); return; }
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
