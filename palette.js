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

  // ---- 🤖 Sawal-jawab box (features.askBox) — "aaj ka VC4?", "Rahul ka MTD", "stock kitna?" -----
  let askLoading = false;
  const QUESTION_WORDS = /(aaj|kal|today|yesterday|mtd|is month|yeh month|yahi month|pichhla|last month|7 din|week|hafte|din ka|din ki|total|vc4|commercial|comm\b|\bgv\b|\bff\b|stock|cover|replacement|chassis|active agent|kitna|kitne|kya|kaise|how much|what|bata|dikh)/;
  function askItems(q) {
    if (FF.config.feat && FF.config.feat('askBox') === false) return [];
    const n = norm(q);
    if (n.length < 3 || !QUESTION_WORDS.test(n)) return [];
    const daily = FF.store.get('daily');
    const agents = FF.store.get('agents');
    if (!daily || !daily.length) {
      if (!askLoading && FF.store.need) {
        askLoading = true;
        FF.store.need('daily').catch(() => {}).finally(() => {
          askLoading = false;
          if (input && document.activeElement === input) draw(input.value);
        });
      }
      return [{ group: '🤖 Jawab', icon: '⏳', label: 'Data load ho raha hai…', sub: 'dobara type karo', answer: null }];
    }
    const pad = (x) => String(x).padStart(2, '0');
    const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    // latest date (data ke hisaab se, aaj nahi)
    let latest = null;
    for (const r of daily) if (!latest || r.key > latest) latest = r.key;
    const latestD = latest ? new Date(`${latest}T00:00:00`) : new Date();
    const isAgentAsk = /(ka|ke|ki)\s+(mtd|total|issuance|issue|target|kya|kitna|pichhla|last|growth|performance)/.test(n) || /ka total/.test(n);
    // ---- entity: query me kisi agent/TL ka naam? (suggestions se) ----
    let entity = null;
    if (isAgentAsk && FF.store.suggestions) {
      try {
        const ppl = FF.store.suggestions({ agents: true, tls: true });
        for (const s of ppl) {
          const full = norm(s.value || s.label);
          if (full && n.includes(full)) { if (!entity || full.length > entity.full.length) entity = { ...s, full, kind: s.kind }; }
        }
        if (!entity) {
          for (const s of ppl) {
            const words = norm(s.label).split(/\s+/).filter((w) => w.length >= 4);
            if (words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(n))) {
              const full = norm(s.value || s.label);
              if (!entity || full.length > entity.full.length) entity = { ...s, full, kind: s.kind };
            }
          }
        }
      } catch { /* suggestions not ready */ }
    }
    if (entity) {
      const target = norm(entity.value || entity.label);
      const match = (r) => norm(r.name) === target;
      const rows = agents || [];
      const curYm = latest.slice(0, 7);
      const pm = new Date(`${curYm}-01T00:00:00`); pm.setMonth(pm.getMonth() - 1);
      const prevYm = `${pm.getFullYear()}-${pad(pm.getMonth() + 1)}`;
      let mtd = 0, prev = 0, tl = '';
      for (const r of rows) {
        if (!match(r)) continue;
        if (!tl && r.tlName) tl = r.tlName;
        if (r.ym === curYm) mtd += r.n || 0;
        if (r.ym === prevYm) prev += r.n || 0;
      }
      const growth = prev ? Math.round(((mtd - prev) / prev) * 100) : null;
      return [{
        group: '🤖 Jawab', icon: entity.kind === 'tl' ? '👥' : '🧑‍💼',
        label: `${entity.label}: ${U.fmt(mtd)} tags MTD`,
        sub: `${curYm} · pichhle mahine ${U.fmt(prev)}${growth !== null ? ` · ${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}%` : ''}${tl && entity.kind !== 'tl' ? ` · TL ${tl}` : ''}`,
        answer: `${entity.label} — MTD ${mtd} tags (${curYm}), pichhle mahine ${prev}${growth !== null ? `, growth ${growth >= 0 ? '+' : ''}${growth}%` : ''}.`
      }];
    }
    // ---- period decide karo ----
    const period = /(pichhla|last)\s*(month|mahina)/.test(n) ? 'prevMonth'
      : /(7 din|last 7|hafte|week)/.test(n) ? 'week7'
      : /(kal|yesterday)/.test(n) && !/(is|yeh|yahi)\s*hafte/.test(n) ? 'yesterday'
      : /(aaj|today)/.test(n) ? 'today'
      : 'mtd';
    const ymCur = latest.slice(0, 7);
    const pmD = new Date(`${ymCur}-01T00:00:00`); pmD.setMonth(pmD.getMonth() - 1);
    const ymPrev = `${pmD.getFullYear()}-${pad(pmD.getMonth() + 1)}`;
    const pick = () => {
      if (period === 'today') return { rows: daily.filter((r) => r.key === latest), label: `aaj (${latest})` };
      if (period === 'yesterday') { const y = key(new Date(latestD.getTime() - 86400e3)); return { rows: daily.filter((r) => r.key === y), label: `kal (${y})` }; }
      if (period === 'week7') {
        const set = new Set();
        for (let i = 0; i < 7; i++) set.add(key(new Date(latestD.getTime() - i * 86400e3)));
        return { rows: daily.filter((r) => set.has(r.key)), label: `last 7 din (${latest} tak)` };
      }
      if (period === 'prevMonth') return { rows: daily.filter((r) => r.ym === ymPrev), label: `pichhla mahina (${ymPrev})` };
      return { rows: daily.filter((r) => r.ym === ymCur), label: `is mahine ka MTD (${ymCur})` };
    };
    const { rows, label } = pick();
    const sum = (f) => rows.reduce((a, r) => a + (f(r) ? r.n : 0), 0);
    const metric = /\bvc4\b/.test(n) ? 'vc4'
      : /(commercial|comm\b)/.test(n) ? 'comm'
      : /\bgv\b|gadivan/.test(n) ? 'gv'
      : /\bff\b|first forward/.test(n) ? 'ff'
      : /replacement/.test(n) ? 'repl'
      : /chassis/.test(n) ? 'chassis'
      : /stock/.test(n) ? 'stock'
      : /cover/.test(n) ? 'cover'
      : 'total';
    const stock = FF.store.get('stock');
    if (metric === 'stock' || metric === 'cover') {
      const st = (stock || []).reduce((a, r) => a + (r.n || 0), 0);
      const vc4 = (stock || []).filter((r) => r.group === 'VC4').reduce((a, r) => a + (r.n || 0), 0);
      if (metric === 'stock') return [{ group: '🤖 Jawab', icon: '📦', label: `Stock: ${U.fmt(st)} tags`, sub: `VC4 ${U.fmt(vc4)} · Commercial ${U.fmt(st - vc4)}${stock && stock.length ? '' : ' (stock abhi load nahi hua)'}`, answer: `Stock in field: ${st} tags (VC4 ${vc4}, commercial ${st - vc4}).` }];
      const mtdVc4 = daily.filter((r) => r.ym === ymCur && r.group === 'VC4').reduce((a, r) => a + r.n, 0);
      const elapsed = Number(latest.slice(8, 10));
      const cover = mtdVc4 && elapsed ? (vc4 / (mtdVc4 / elapsed)) : 0;
      return [{ group: '🤖 Jawab', icon: '📈', label: `VC4 cover: ${cover ? cover.toFixed(1) : '—'} din`, sub: `stock VC4 ${U.fmt(vc4)} ÷ avg ${elapsed} din me ${U.fmt(mtdVc4)}/din`, answer: `VC4 cover ≈ ${cover.toFixed(1)} din (stock ${vc4}, MTD issued ${mtdVc4}).` }];
    }
    let n2 = 0, sub2 = '';
    if (metric === 'vc4') n2 = sum((r) => r.group === 'VC4');
    else if (metric === 'comm') n2 = sum((r) => r.group !== 'VC4');
    else if (metric === 'gv') n2 = sum((r) => /gv/i.test(r.channel || ''));
    else if (metric === 'ff') n2 = sum((r) => /first/i.test(r.channel || ''));
    else if (metric === 'repl') n2 = sum((r) => r.type === 'REPLACEMENT');
    else if (metric === 'chassis') n2 = sum((r) => r.type === 'CHASSIS');
    else n2 = sum(() => true);
    const metricName = { vc4: 'VC4', comm: 'Commercial', gv: 'GV', ff: 'FF', repl: 'Replacement', chassis: 'Chassis', total: 'Total issued' }[metric];
    const vc4v = sum((r) => r.group === 'VC4');
    sub2 = metric === 'total' ? `VC4 ${U.fmt(vc4v)} · Commercial ${U.fmt(n2 - vc4v)} · ${rows.length} rows` : label;
    return [{ group: '🤖 Jawab', icon: '🤖', label: `${metricName} — ${label}: ${U.fmt(n2)} tags`, sub: sub2, answer: `${metricName} ${label}: ${n2} tags.` }];
  }

  function pool() {
    const items = [];
    // Common commands are searchable alongside pages and people — Ctrl/⌘+K is a command center,
    // not only a navigation list.
    items.push(
      { group: 'Commands', icon: '🎯', label: 'Toggle Focus mode', sub: 'Distraction-free KPI / management view', command: 'focus' },
      { group: 'Commands', icon: '♿', label: 'Accessibility mode', sub: 'Large text · high contrast · reduced motion', command: 'a11y' },
      { group: 'Commands', icon: '↕', label: 'Toggle table density', sub: 'Compact or comfortable rows', command: 'density' },
      { group: 'Commands', icon: '🔔', label: 'Open notification center', sub: 'Unread alerts, actions and preferences', command: 'notifications' },
      { group: 'Commands', icon: '🎨', label: 'Open theme packs', sub: 'Readable presets with saved preference', command: 'themes' },
      { group: 'Commands', icon: '↻', label: 'Refresh data', sub: 'Sync the latest available snapshot', command: 'refresh' },
      { group: 'Commands', icon: '⬇️', label: 'Install / add to home screen', sub: 'Use the PWA install prompt', command: 'install' },
      { group: 'Commands', icon: '⌕', label: 'Reset current report filters', sub: 'Clear this page’s date, channel, TL, agent and class filters', command: 'clearFilters' }
    );
    // Pages (jiske paas permission hai wahi)
    (FF.app && FF.app.PAGES ? FF.app.PAGES : []).forEach((p) => {
      const adminOk = !p.adminOnly || (FF.auth.isAdmin ? FF.auth.isAdmin() : (FF.auth.user && FF.auth.user.role === 'admin')); // 👁 preview-aware
      const featOk = !p.feat || !FF.config.features || FF.config.features[p.feat] !== false;
      if (FF.auth.can(p.perm) && adminOk && featOk) items.push({ group: 'Pages', icon: p.icon || '📄', label: p.label, sub: p.desc || '', href: `#/${p.id}` });
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
    const askItem = nq ? askItems(nq) : [];
    // Group-wise cap: q khali ho to har group se top; warna total top 24.
    if (!nq) {
      const caps = { Commands: 10, Pages: 8, Sheets: 6, Agents: 8, TLs: 6, Dates: 6, Recent: 6 };
      const seen = {};
      return scored.map((x) => x.it).filter((it) => { seen[it.group] = (seen[it.group] || 0) + 1; return seen[it.group] <= (caps[it.group] || 6); });
    }
    // 🔎 Master search (v3.11) — barcode / tag ID / GV ID / kisi bhi naam ki POORI kundli.
    const master = nq ? masterItems(q) : [];
    return [...master, ...askItem, ...calcItem, ...scored.slice(0, 24).map((x) => x.it)];
  }

  /** Master search (FF + GV barcode register) ke results — Ctrl+K se seedha kundli panel. */
  function masterItems(q) {
    const out = [];
    const MS = FF.masterSearch;
    if (!MS) return out;
    const val = String(q || '').trim();
    if (val.length < 2) return out;
    try {
      const res = MS.search(val);
      (res.tags || []).slice(0, 4).forEach((t) => {
        const f = t.ff[0] || {}, g = t.gv[0] || {};
        out.push({ group: '🔎 Master search', icon: '🏷️', label: t.key, sub: [f.agentName ? `FF ${f.agentName}` : '', g.agentName ? `GV ${g.agentName}` : '', f.cls || g.cls || ''].filter(Boolean).join(' · ') || 'barcode / tag', master: t.key });
      });
      (res.ids || []).slice(0, 3).forEach((v) => out.push({ group: '🔎 Master search', icon: '🆔', label: v.id, sub: `${v.name || ''}${v.tl ? ` · TL ${v.tl}` : ''}`.trim(), master: v.id }));
      const people = (res.people || []).slice(0, 3);
      people.forEach((person) => out.push({ group: '🔎 Master search', icon: '🧑‍💼', label: person.name, sub: `${[...person.tlSet].slice(0, 1).join('') || 'Direct'} · kundli + tags kholo`, master: person.name }));
      // Always offer the full-search escape hatch
      out.push({ group: '🔎 Master search', icon: '🔎', label: `“${val}” ki poori kundli kholo`, sub: 'Barcode · tag ID · agent · TL · GV ID — sab sections ek panel me', master: val });
    } catch { /* master search optional */ }
    return out.slice(0, 8);
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
    if (it.answer) { U.copyText(String(it.answer)).then(() => U.toast('📋 Jawab copy ho gaya', 'ok')).catch(() => {}); return; }
    if (it.notif) { if (FF.liveView && FF.liveView.openNotification) FF.liveView.openNotification(it.notif); return; }
    if (it.master !== undefined) { if (FF.masterSearch) FF.masterSearch.openPanel(it.master); return; }
    if (it.command) {
      if (it.command === 'focus') { const on = FF.app && FF.app.focusMode ? FF.app.focusMode() : false; U.toast(on ? '🎯 Focus mode ON' : 'Focus mode OFF', 'ok'); }
      else if (it.command === 'a11y') { if (FF.app && FF.app.openAccessibility) FF.app.openAccessibility(); }
      else if (it.command === 'density') { const next = FF.app && FF.app.tableDensity && FF.app.tableDensity() === 'compact' ? 'comfortable' : 'compact'; if (FF.app && FF.app.setTableDensity) FF.app.setTableDensity(next); FF.app.renderCurrent && FF.app.renderCurrent(); U.toast(`Table density: ${next}`, 'ok'); }
      else if (it.command === 'notifications') { if (FF.notifications) FF.notifications.toggle(true); }
      else if (it.command === 'themes') { const b = U.$('#theme-pack-btn'); if (b) b.click(); else U.toast('Theme packs topbar me available hain', 'info'); }
      else if (it.command === 'refresh') { if (FF.app && FF.app.refresh) FF.app.refresh(); }
      else if (it.command === 'install') { if (FF.app && FF.app.promptInstall) FF.app.promptInstall(); }
      else if (it.command === 'clearFilters') { if (FF.app && FF.app.clearGlobalFilters) FF.app.clearGlobalFilters(); else if (FF.app && FF.app.updateParams) FF.app.updateParams({ period: '', channel: '', ch: '', tl: '', agent: '', cls: '' }); U.toast('Current report filters reset', 'ok'); }
      return;
    }
    if (location.hash === it.href) { FF.app.renderCurrent && FF.app.renderCurrent(); } else location.hash = it.href;
  }

  function ensure() {
    if (backdrop) return;
    backdrop = U.h(`<div class="palette-backdrop" id="palette-backdrop" hidden>
      <div class="palette-box" role="dialog" aria-label="Global search">
        <div class="palette-input-row"><span class="palette-search-ico">🔍</span><input class="palette-input" id="palette-input" placeholder="Agent, TL, barcode, tag ID, GV ID, page… (Ctrl / ⌘ + K)" autocomplete="off" spellcheck="false"><kbd class="palette-kbd">Esc</kbd></div>
        <div class="palette-list" id="palette-list"></div>
        <div class="palette-foot"><span><kbd>↑↓</kbd> move · <kbd>Enter</kbd> open</span><span>Pages · Agents · TLs · Barcode / Tag ID · Dates · calc</span></div>
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
