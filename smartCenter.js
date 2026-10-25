/* 🧠 Smart Notification Center (v3.94) — Home · Today's work.
   GV data se khud calculate: low stock agents · dispatch priority (High/Medium) · inactive agents/TLs · down agents/TLs.
   Har category ek tile (count + severity); click = popup list (search, severity filter, CSV). Naya critical aaye to toast. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, G = FF.gv;
  const esc = U.esc;
  const SEEN_KEY = 'ff_smart_seen', TOAST_KEY = 'ff_smart_toast';
  const DISPATCH_DAYS = 25;      // Dispatch need basis (Master search jaisa)
  const LOW_STOCK = 25;          // itne ya kam tag = low stock
  const DROP_PCT = 40;           // same-din ke hisaab se itna gira = "down"
  let memo = null, memoKey = '';

  const CSS = `
  .sc-wrap{padding:6px 16px 16px}
  .sc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:6px 0 10px}
  .sc-head small{color:var(--muted,#64748b)}
  .sc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
  .sc-tile{position:relative;text-align:left;font:inherit;cursor:pointer;border:1px solid var(--tc-b);border-top:4px solid var(--tc);border-radius:14px;padding:11px 13px;background:var(--tc-bg);color:inherit;display:flex;flex-direction:column;gap:3px;min-width:0;transition:transform .15s,box-shadow .15s}
  .sc-tile:hover{transform:translateY(-2px);box-shadow:0 8px 20px var(--tc-b)}
  .sc-tile .t{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;color:var(--tc-d)}
  .sc-tile .n{font-size:28px;font-weight:800;line-height:1.1;color:var(--tc-d);font-variant-numeric:tabular-nums}
  .sc-tile .s{font-size:12px;color:#475569;overflow-wrap:anywhere}
  .sc-tile .new{position:absolute;top:8px;right:10px;font-size:10px;font-weight:800;background:#ef4444;color:#fff;border-radius:999px;padding:1px 7px}
  .sc-tile.zero{opacity:.8}.sc-tile.zero .n{color:#16a34a}
  .sc-red{--tc:#ef4444;--tc-d:#b91c1c;--tc-b:rgba(239,68,68,.28);--tc-bg:color-mix(in srgb,#ef4444 7%,var(--card,#fff))}
  .sc-amber{--tc:#f59e0b;--tc-d:#b45309;--tc-b:rgba(245,158,11,.3);--tc-bg:color-mix(in srgb,#f59e0b 8%,var(--card,#fff))}
  .sc-blue{--tc:#3b82f6;--tc-d:#1d4ed8;--tc-b:rgba(59,130,246,.28);--tc-bg:color-mix(in srgb,#3b82f6 7%,var(--card,#fff))}
  .sc-violet{--tc:#8b5cf6;--tc-d:#6d28d9;--tc-b:rgba(139,92,246,.28);--tc-bg:color-mix(in srgb,#8b5cf6 7%,var(--card,#fff))}
  .sc-pop-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 10px}
  .sc-pop-bar .input{max-width:240px}
  .sc-seg{display:inline-flex;padding:3px;border-radius:999px;background:rgba(100,116,139,.16)}
  .sc-seg button{border:0;background:transparent;font:inherit;font-size:12.5px;font-weight:700;padding:5px 12px;border-radius:999px;cursor:pointer;color:inherit}
  .sc-seg button.on{background:#4f46e5;color:#fff}
  .sc-list{display:flex;flex-direction:column;gap:8px}
  .sc-item{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(148,163,184,.3);border-left:4px solid var(--sev);border-radius:12px;background:var(--card,#fff);text-decoration:none;color:inherit}
  .sc-item:hover{background:rgba(99,102,241,.05)}
  .sc-item.high{--sev:#ef4444}.sc-item.med{--sev:#f59e0b}.sc-item.low{--sev:#3b82f6}
  .sc-ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(100,116,139,.12);font-size:16px}
  .sc-item b{display:block;font-size:13.5px;overflow-wrap:anywhere}
  .sc-item p{margin:2px 0 0;font-size:12px;color:#64748b;overflow-wrap:anywhere}
  .sc-sev{font-size:10.5px;font-weight:800;border-radius:999px;padding:2px 9px;white-space:nowrap}
  .sc-sev.high{background:#fee2e2;color:#b91c1c}.sc-sev.med{background:#ffedd5;color:#c2410c}.sc-sev.low{background:#dbeafe;color:#1d4ed8}
  .sc-more{text-align:center;margin:12px 0}
  html[data-theme="dark"] .sc-tile .s{color:#cbd5e1}
  `;
  function css() {
    if (document.getElementById('sc-css')) return;
    const s = document.createElement('style'); s.id = 'sc-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v);
  const norm = (v) => String(v || '').trim().toUpperCase();
  const num = (v) => Number(v) || 0;
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);

  function compute() {
    const rows = (G.issuanceRows && G.issuanceRows()) || [];
    const report = (G.get && G.get('report')) || [];
    const latest = G.latestDate && G.latestDate();
    if (!isDate(latest)) return null;
    const key = `${rows.length}|${report.length}|${U.dateKey(latest)}`;
    if (memo && memoKey === key) return memo;
    const thr = (FF.config && FF.config.thresholds) || {};
    const inactiveDays = num(thr.inactiveDays) || 3;
    const cm = U.ymKey(latest), lm = U.ymKey(new Date(latest.getFullYear(), latest.getMonth() - 1, 1));
    const day = latest.getDate();
    const A = new Map();
    const get = (id, r) => {
      let a = A.get(id);
      if (!a) { a = { id, name: r.agentName || id, tl: r.tlName || '', tlId: r.tlId || '', cur: 0, last: 0, lastFull: 0, lastDate: null }; A.set(id, a); }
      if (!a.tl && r.tlName) a.tl = r.tlName;
      if (!a.tlId && r.tlId) a.tlId = r.tlId;
      return a;
    };
    rows.forEach((r) => {
      const id = norm(r.agentId) || norm(r.agentName); if (!id) return;
      const n = num(r.n) || 1;
      if (r.ym !== cm && r.ym !== lm) return;
      const a = get(id, r);
      const d = r.date || r.d;
      if (r.ym === cm && (!r.day || r.day <= day)) a.cur += n;
      if (r.ym === lm) { a.lastFull += n; if (!r.day || r.day <= day) a.last += n; }
      if (isDate(d) && (!a.lastDate || d > a.lastDate)) a.lastDate = d;
    });
    const rep = new Map();
    report.forEach((r) => { const id = norm(r.agentId) || norm(r.agentName); if (id) rep.set(id, r); });
    rep.forEach((r, id) => { const a = get(id, r); if (!a.name || a.name === id) a.name = r.agentName || a.name; if (!a.tl && r.tlName) a.tl = r.tlName; if (!a.tlId && r.tlId) a.tlId = r.tlId; });
    const direct = (a) => !a.tl || /^(direct|—|aps)$/i.test(a.tl) || (FF.config && FF.config.isDirectAgent && FF.config.isDirectAgent({ agentId: a.id, agentName: a.name, tlId: a.tlId, tlName: a.tl, channel: 'GV Partner' }, 'gv'));
    const low = [], disp = [], inactA = [], downA = [];
    const T = new Map();
    A.forEach((a) => {
      const r = rep.get(a.id) || {};
      const stock = num(r.stockTotal);
      const rate = day ? a.cur / day : 0;
      const cover = rate > 0 ? stock / rate : null;
      const isDirect = direct(a);
      const ago = a.lastDate ? daysBetween(a.lastDate, latest) : null;
      const base = { id: a.id, name: a.name, tl: isDirect ? 'Direct' : a.tl, tlId: a.tlId, direct: isDirect, stock, rate, cover, cur: a.cur, last: a.last };
      const hasHistory = a.cur > 0 || a.lastFull > 0;
      // 📦 low stock
      if (hasHistory && report.length && stock <= LOW_STOCK && (rate > 0 || a.lastFull > 0)) {
        low.push({ ...base, sev: stock === 0 ? 'high' : stock <= 10 ? 'high' : 'med',
          title: a.name, text: `${stock === 0 ? 'Stock ZERO' : `Stock ${stock}`} · run-rate ${rate.toFixed(1)}/day${cover != null ? ` · ~${Math.round(cover)} din chalega` : ''}`, tag: `${a.id}${isDirect ? ' · Direct' : ` · TL ${a.tl || '—'}`}` });
      }
      // 🎯 dispatch priority (cover-based: High < coverRed, Medium < coverOrange)
      if (rate > 0 && cover != null) {
        const red = num(thr.coverRed) || 7, orange = num(thr.coverOrange) || 15;
        const prio = cover < red ? 'High' : cover < orange ? 'Medium' : 'Low';
        if (prio !== 'Low') {
          const need = Math.max(0, Math.ceil(rate * DISPATCH_DAYS) - stock);
          disp.push({ ...base, sev: prio === 'High' ? 'high' : 'med', prio, need,
            title: a.name, text: `${prio} priority · cover ${cover.toFixed(1)} din · stock ${stock} · ${isDirect ? '🏷️ tag chahiye (Direct — stock dispatch nahi)' : `dispatch need ${need}`}`, tag: `${a.id}${isDirect ? ' · Direct' : ` · TL ${a.tl || '—'}`}` });
        }
      }
      // 😴 inactive
      if (hasHistory && ago != null && ago >= inactiveDays) {
        inactA.push({ ...base, ago, sev: ago >= 7 ? 'high' : 'med', title: a.name,
          text: `${ago} din se koi tag issue nahi · last ${a.lastDate ? U.dateKey(a.lastDate) : '—'} · ${cm}: ${a.cur} · pichhle mahine: ${a.lastFull}`, tag: `${a.id}${isDirect ? ' · Direct' : ` · TL ${a.tl || '—'}`}` });
      }
      // 📉 down
      if (a.last >= 10) {
        const drop = Math.round((1 - a.cur / a.last) * 100);
        if (drop >= DROP_PCT) downA.push({ ...base, drop, sev: drop >= 60 ? 'high' : 'med', title: a.name,
          text: `${cm} ${a.cur} vs pichhle mahine same din tak ${a.last} · ▼ ${drop}%`, tag: `${a.id}${isDirect ? ' · Direct' : ` · TL ${a.tl || '—'}`}` });
      }
      if (!isDirect && a.tl) {
        const t = T.get(a.tl) || { name: a.tl, id: a.tlId, cur: 0, last: 0, lastFull: 0, lastDate: null, agents: 0 };
        t.cur += a.cur; t.last += a.last; t.lastFull += a.lastFull; t.agents++;
        if (a.lastDate && (!t.lastDate || a.lastDate > t.lastDate)) t.lastDate = a.lastDate;
        T.set(a.tl, t);
      }
    });
    const inactT = [], downT = [];
    T.forEach((t) => {
      const ago = t.lastDate ? daysBetween(t.lastDate, latest) : null;
      if ((t.cur > 0 || t.lastFull > 0) && ago != null && ago >= inactiveDays) {
        inactT.push({ id: t.id, name: t.name, sev: ago >= 7 ? 'high' : 'med', title: `TL ${t.name}`, text: `Poori team me ${ago} din se koi issuance nahi · ${t.agents} agents`, tag: t.id || 'TL' });
      }
      if (t.last >= 20) {
        const drop = Math.round((1 - t.cur / t.last) * 100);
        if (drop >= DROP_PCT) downT.push({ id: t.id, name: t.name, drop, sev: drop >= 60 ? 'high' : 'med', title: `TL ${t.name}`, text: `${cm} ${t.cur} vs pichhle mahine same din tak ${t.last} · ▼ ${drop}% · ${t.agents} agents`, tag: t.id || 'TL' });
      }
    });
    const by = (f) => (a, b) => f(b) - f(a);
    const sevN = (x) => (x.sev === 'high' ? 2 : 1);
    low.sort((a, b) => sevN(b) - sevN(a) || b.rate - a.rate);
    disp.sort((a, b) => sevN(b) - sevN(a) || (a.cover || 0) - (b.cover || 0));
    inactA.sort(by((x) => x.ago)); inactT.sort(by((x) => sevN(x)));
    downA.sort(by((x) => x.drop)); downT.sort(by((x) => x.drop));
    memo = { cm, lm, day, inactiveDays, cats: [
      { id: 'low', icon: '📦', title: 'Low stock agents', tone: 'red', sub: `stock ≤ ${LOW_STOCK} tags`, items: low },
      { id: 'disp', icon: '🎯', title: 'Dispatch priority', tone: 'amber', sub: 'High + Medium (cover)', items: disp },
      { id: 'inactA', icon: '😴', title: 'Inactive agents', tone: 'violet', sub: `${inactiveDays}+ din koi tag nahi`, items: inactA },
      { id: 'inactT', icon: '🏬', title: 'Inactive TLs', tone: 'violet', sub: 'poori team shant', items: inactT },
      { id: 'downA', icon: '📉', title: 'Down agents', tone: 'blue', sub: `${DROP_PCT}%+ gire (same din tak)`, items: downA },
      { id: 'downT', icon: '🔻', title: 'Down TLs', tone: 'blue', sub: `${DROP_PCT}%+ gire (same din tak)`, items: downT }
    ] };
    memoKey = key;
    return memo;
  }

  function seen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; } }
  function setSeen(id, n) { try { const s = seen(); s[id] = n; localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

  function tilesHtml(m) {
    const sn = seen();
    const crit = m.cats.reduce((n, c) => n + c.items.filter((x) => x.sev === 'high').length, 0);
    const total = m.cats.reduce((n, c) => n + c.items.length, 0);
    return `<div class="sc-wrap"><div class="sc-head"><b>🧠 Smart Notification Center</b><small>${total ? `${crit} critical · ${total} total` : '✅ Sab theek'} · data ${esc(m.cm)} · ${m.day} din tak</small></div>
      <div class="sc-grid">${m.cats.map((c) => {
        const hi = c.items.filter((x) => x.sev === 'high').length, isNew = c.items.length > (sn[c.id] === undefined ? Infinity : sn[c.id]);
        return `<button type="button" class="sc-tile sc-${c.tone}${c.items.length ? '' : ' zero'}" data-sc="${c.id}">
          ${isNew && c.items.length ? '<span class="new">NEW</span>' : ''}
          <span class="t">${c.icon} ${esc(c.title)}</span><span class="n">${c.items.length ? U.fmt(c.items.length) : '0 ✓'}</span>
          <span class="s">${c.items.length ? `${hi ? `🔴 ${hi} critical · ` : ''}${esc(c.sub)}` : esc(c.sub)}</span></button>`;
      }).join('')}</div></div>`;
  }

  function listHtml(c, st) {
    const q = st.q.trim().toLowerCase();
    const list = c.items.filter((x) => (st.sev === 'all' || x.sev === st.sev) && (!q || `${x.title} ${x.text} ${x.tag}`.toLowerCase().includes(q)));
    const shown = list.slice(0, st.shown);
    const sevLabel = { high: 'Critical', med: 'Medium', low: 'Info' };
    return `<div class="sc-list">${shown.length ? shown.map((x) => `<a class="sc-item ${x.sev}" href="#/gvPerformance?q=${encodeURIComponent(x.name || x.title)}" data-sc-go>
        <span class="sc-ic">${c.icon}</span><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p><p>${esc(x.tag)}</p></div><span class="sc-sev ${x.sev}">${sevLabel[x.sev]}</span></a>`).join('') : '<div class="empty">Kuch nahi mila ✓</div>'}</div>
      ${list.length > shown.length ? `<div class="sc-more"><button class="btn" data-sc-more>⬇ Aur dikhao (${shown.length}/${list.length})</button></div>` : ''}`;
  }

  function openCat(id) {
    const m = compute(); if (!m) return;
    const c = m.cats.find((x) => x.id === id); if (!c) return;
    setSeen(id, c.items.length);
    const st = { q: '', sev: 'all', shown: 60 };
    const hostId = 'sc-pop-host';
    const hi = c.items.filter((x) => x.sev === 'high').length;
    FF.app.openDrawer({
      wide: true, kicker: '🧠 Smart Notification Center', title: `${c.icon} ${c.title} · ${c.items.length}`,
      sub: `${c.sub} · ${hi} critical · data ${m.cm} (${m.day} din tak)`,
      body: `<div class="sc-pop-bar"><input class="input" id="sc-q" placeholder="🔍 Naam / ID / TL"><span class="sc-seg">${[['all', 'All'], ['high', 'Critical'], ['med', 'Medium']].map(([k, l]) => `<button data-sc-sev="${k}" class="${k === 'all' ? 'on' : ''}">${l}</button>`).join('')}</span>${FF.auth.can('export') ? '<button class="btn small" data-sc-csv>⬇ CSV</button>' : ''}</div><div id="${hostId}"></div>`
    });
    const host = U.$('#' + hostId); if (!host) return;
    const paint = () => { host.innerHTML = listHtml(c, st); };
    paint();
    const body = host.parentElement;
    const qi = U.$('#sc-q', body);
    if (qi) qi.addEventListener('input', () => { st.q = qi.value; st.shown = 60; paint(); });
    body.addEventListener('click', (e) => {
      const sv = e.target.closest('[data-sc-sev]');
      if (sv) { st.sev = sv.dataset.scSev; st.shown = 60; body.querySelectorAll('[data-sc-sev]').forEach((b) => b.classList.toggle('on', b === sv)); paint(); return; }
      if (e.target.closest('[data-sc-more]')) { st.shown += 60; paint(); return; }
      if (e.target.closest('[data-sc-go]')) { if (FF.app.closeDrawer) FF.app.closeDrawer(); return; }
      if (e.target.closest('[data-sc-csv]')) {
        U.downloadCsv(`smart-${c.id}-${U.stamp ? U.stamp() : Date.now()}.csv`, ['ID', 'Name', 'TL', 'Severity', 'Detail'],
          c.items.map((x) => [x.id || '', x.name || x.title, x.tl || '', x.sev, x.text]));
      }
    });
    const root = document.getElementById('home-smart'); if (root) paintInto(root, true);
  }

  function toastOnce(m) {
    const crit = m.cats.reduce((n, c) => n + c.items.filter((x) => x.sev === 'high').length, 0);
    if (!crit) return;
    const k = `${U.dateKey(new Date())}|${crit}`;
    try { if (sessionStorage.getItem(TOAST_KEY) === k) return; sessionStorage.setItem(TOAST_KEY, k); } catch { /* ignore */ }
    const top = m.cats.filter((c) => c.items.some((x) => x.sev === 'high')).slice(0, 3).map((c) => `${c.icon} ${c.items.filter((x) => x.sev === 'high').length} ${c.title}`).join(' · ');
    U.toast(`🧠 ${crit} critical alerts — ${top}`, 'warn');
  }

  function paintInto(el, quiet) {
    css();
    const m = compute();
    if (!m) { el.innerHTML = `<div class="sc-wrap"><div class="sc-head"><b>🧠 Smart Notification Center</b><small>data load ho raha hai…</small></div></div>`; return; }
    el.innerHTML = tilesHtml(m);
    if (!quiet) toastOnce(m);
  }

  const bound = new WeakSet();
  /** Home ke #home-smart me mount (har paint par dobara safe). */
  async function mount(el) {
    if (!el || !G) return;
    css();
    if (!bound.has(el)) {
      bound.add(el);
      el.addEventListener('click', (e) => { const t = e.target.closest('[data-sc]'); if (t) openCat(t.dataset.sc); });
    }
    paintInto(el, true);
    try { await Promise.allSettled([G.need('master'), G.need('report'), FF.store && FF.store.need ? FF.store.need('daily') : null]); } catch { /* ignore */ }
    if (el.isConnected) paintInto(el, false);
  }

  FF.smartCenter = { mount, compute, openCat, _cfg: { LOW_STOCK, DROP_PCT, DISPATCH_DAYS } };
})(window.FF);
