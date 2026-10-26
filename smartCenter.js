/* 🧠 Smart Notification Center (v3.95) — Home · Today's work.
   Sirf do cheezein, saaf aur professional:
   1) 🎯 Dispatch priority — GV aur FF alag (High · Medium count). Click = Dispatch Planner (us channel ka).
   2) ⚠️ Sudden drop alerts — koi agent / TL achanak down ho to Home par highlighted dikhta rahe (jab tak down hai).
   Counts Dispatch Planner ke wahi rows/formula se aate hain (FF.dispatchPlanner), isliye dono jagah same number. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, G = FF.gv, S = FF.store;
  const esc = U.esc;
  const RECENT = 3, BASE = 14;          // recent 3 din vs pichhle 14 din
  const DROP = 0.6;                     // 60%+ gira = sudden down
  const MIN_AGENT = 3, MIN_TL = 10;     // baseline tags/din (isse kam wale noise hain)
  const MAX_ALERTS = 8;

  const CSS = `
  .sc-wrap{padding:6px 16px 16px;display:flex;flex-direction:column;gap:12px}
  .sc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .sc-head small{color:var(--muted,#64748b)}
  .sc-chip{display:flex;align-items:stretch;flex-wrap:wrap;border:1px solid rgba(245,158,11,.4);border-top:4px solid #f59e0b;border-radius:14px;background:color-mix(in srgb,#f59e0b 7%,var(--card,#fff));overflow:hidden}
  .sc-chip-t{display:flex;align-items:center;gap:8px;padding:12px 16px;font-weight:800;font-size:13px;color:#b45309;text-transform:uppercase;letter-spacing:.03em;flex:1 1 170px}
  .sc-seg{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 16px;border-left:1px solid rgba(245,158,11,.3);text-decoration:none;color:inherit;flex:2 1 260px;transition:background .15s}
  a.sc-seg:hover{background:rgba(245,158,11,.1)}
  .sc-seg .ch{font-weight:800;font-size:13px;min-width:78px}
  .sc-seg.gv .ch{color:#15803d}.sc-seg.ff .ch{color:#1d4ed8}
  .sc-pill{display:inline-flex;align-items:baseline;gap:6px;padding:4px 11px;border-radius:999px;font-weight:700;font-size:12px}
  .sc-pill b{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums}
  .sc-pill.hi{background:#fee2e2;color:#b91c1c}.sc-pill.md{background:#ffedd5;color:#c2410c}
  .sc-seg .go{margin-left:auto;color:#b45309;font-weight:800}
  .sc-alerts{border:1px solid rgba(239,68,68,.4);border-left:5px solid #ef4444;border-radius:14px;background:color-mix(in srgb,#ef4444 6%,var(--card,#fff));padding:10px 14px}
  .sc-alerts-h{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13px;color:#b91c1c;margin:0 0 8px}
  .sc-dot{width:9px;height:9px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 0 rgba(239,68,68,.6);animation:scPulse 1.6s infinite}
  @keyframes scPulse{70%{box-shadow:0 0 0 9px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
  .sc-al{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 10px;border-radius:10px;text-decoration:none;color:inherit}
  .sc-al:hover{background:rgba(239,68,68,.08)}
  .sc-al + .sc-al{border-top:1px dashed rgba(239,68,68,.25)}
  .sc-al .ic{font-size:18px;text-align:center}
  .sc-al b{display:block;font-size:13.5px;overflow-wrap:anywhere}
  .sc-al p{margin:1px 0 0;font-size:12px;color:#64748b;overflow-wrap:anywhere}
  .sc-al .pc{font-weight:800;font-size:13px;color:#b91c1c;background:#fee2e2;border-radius:999px;padding:2px 10px;white-space:nowrap}
  .sc-ok{font-size:12.5px;color:#15803d;font-weight:600}
  .sc-more{font-size:12px;color:#64748b;margin:6px 0 0}
  html[data-theme="dark"] .sc-al p{color:#94a3b8}
  `;
  function css() {
    if (document.getElementById('sc-css')) return;
    const s = document.createElement('style'); s.id = 'sc-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  const norm = (v) => String(v || '').trim().toUpperCase();
  const num = (v) => Number(v) || 0;
  const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v);
  const dayNo = (d) => Math.floor(d.getTime() / 86400000) - d.getTimezoneOffset() / 1440;

  /**
   * Sudden drop: recent (RECENT din) ka avg/din, pichhle BASE din ke avg/din se DROP% se zyada kam.
   * rows = [{agentId, agentName, tlId, tlName, date, n}] ; latest = data ki aakhri tareekh (live aaj ho to uska adhura din skip).
   */
  function suddenDown(rows, latest, opts) {
    const o = { channel: '', live: false, ...(opts || {}) };
    if (!isDate(latest)) return [];
    const end = dayNo(latest) - (o.live ? 1 : 0);              // recent window ka aakhri din
    const rStart = end - RECENT + 1, bStart = rStart - BASE;
    const A = new Map(), T = new Map();
    const acc = (map, id, meta, k, n) => { let x = map.get(id); if (!x) { x = { ...meta, recent: 0, base: 0 }; map.set(id, x); } x[k] += n; };
    rows.forEach((r) => {
      const d = r.date || r.d; if (!isDate(d)) return;
      const dn = dayNo(d);
      const k = dn >= rStart && dn <= end ? 'recent' : dn >= bStart && dn < rStart ? 'base' : '';
      if (!k) return;
      const n = num(r.n) || 1;
      const id = norm(r.agentId) || norm(r.agentName); if (!id) return;
      const direct = !r.tlName || /^(direct|—)$/i.test(r.tlName);
      acc(A, id, { id, name: r.agentName || id, tl: direct ? '' : r.tlName, kind: 'agent' }, k, n);
      if (!direct) acc(T, norm(r.tlName), { id: r.tlId || '', name: r.tlName, kind: 'tl' }, k, n);
    });
    const out = [];
    const judge = (x, minBase) => {
      const baseAvg = x.base / BASE, recAvg = x.recent / RECENT;
      if (baseAvg < minBase) return;
      const drop = 1 - recAvg / baseAvg;
      if (drop >= DROP) out.push({ ...x, ch: o.channel, baseAvg, recAvg, drop: Math.round(drop * 100), lost: Math.round((baseAvg - recAvg) * RECENT) });
    };
    A.forEach((x) => judge(x, MIN_AGENT));
    T.forEach((x) => judge(x, MIN_TL));
    return out;
  }

  function alertsAll() {
    const out = [];
    try {
      const gl = G && G.latestDate && G.latestDate();
      out.push(...suddenDown((G && G.issuanceRows && G.issuanceRows()) || [], gl, { channel: 'gv', live: isDate(gl) && U.dateKey(gl) === U.dateKey(new Date()) }));
    } catch { /* ignore */ }
    try {
      const daily = ((S && S.get && S.get('daily')) || []).filter((r) => r.channel === 'First Forward');
      const fl = FF.model && FF.model.latestDate ? FF.model.latestDate(daily) : null;
      out.push(...suddenDown(daily.map((r) => ({ ...r, date: r.d || r.date })), fl, { channel: 'ff' }));
    } catch { /* ignore */ }
    return out.sort((a, b) => (b.kind === 'tl') - (a.kind === 'tl') || b.lost - a.lost);
  }

  /** Dispatch Planner ke wahi rows se High / Medium count (channel-wise). */
  async function dispatchCounts() {
    const L = FF.lazy;
    if (L && L.ensure && !(FF.dispatchPlanner && FF.pages.performance)) { try { await L.ensure('dispatchPlan'); } catch { /* ignore */ } }
    const P = FF.dispatchPlanner; if (!P || !P.collectAgents || !P.withCalc) return null;
    try {
      const jobs = [];
      if (FF.pages.performance && FF.pages.performance.ensureLoaded) jobs.push(FF.pages.performance.ensureLoaded());
      if (S && S.need) { jobs.push(S.need('daily')); jobs.push(S.need('agentClass')); }
      if (G && G.need) jobs.push(G.need('report'));
      await Promise.allSettled(jobs);
      const rows = P.collectAgents().map((r) => P.withCalc(r, 'total'));
      const c = { gv: { High: 0, Medium: 0 }, ff: { High: 0, Medium: 0 } };
      rows.forEach((r) => { const k = r.ch === 'gv' ? 'gv' : 'ff'; if (c[k][r.priority] !== undefined) c[k][r.priority]++; });
      return c;
    } catch { return null; }
  }

  function dispatchHtml(c) {
    const can = FF.auth && FF.auth.can && FF.auth.can('dispatchPlan');
    const seg = (ch, label, icon) => {
      const v = c[ch];
      const inner = `<span class="ch">${icon} ${label}</span><span class="sc-pill hi">High <b>${v.High}</b></span><span class="sc-pill md">Medium <b>${v.Medium}</b></span>${can ? '<span class="go">→</span>' : ''}`;
      return can ? `<a class="sc-seg ${ch}" href="#/dispatchPlan?channel=${ch}&priority=High,Medium" title="Dispatch Planner · ${label} · High + Medium">${inner}</a>` : `<div class="sc-seg ${ch}">${inner}</div>`;
    };
    return `<div class="sc-chip"><div class="sc-chip-t">🎯 Dispatch priority</div>${seg('gv', 'GV', '🟩')}${seg('ff', 'FF', '🟦')}</div>`;
  }

  function alertsHtml(list) {
    if (!list.length) return '<div class="sc-ok">✅ Koi agent / TL achanak down nahi hua</div>';
    const top = list.slice(0, MAX_ALERTS);
    const row = (x) => {
      const page = x.ch === 'gv' ? 'gvPerformance' : 'performance';
      const chn = x.ch === 'gv' ? '🟩 GV' : '🟦 FF';
      return `<a class="sc-al" href="#/${page}?q=${encodeURIComponent(x.name)}" title="${esc(x.name)} · profile kholo">
        <span class="ic">${x.kind === 'tl' ? '🏬' : '🧑‍💼'}</span>
        <div><b>${x.kind === 'tl' ? 'TL ' : ''}${esc(x.name)}</b><p>${chn} · pichhle ${BASE} din avg ${x.baseAvg.toFixed(1)}/din → last ${RECENT} din ${x.recAvg.toFixed(1)}/din · ~${x.lost} tags kam${x.kind === 'agent' && x.tl ? ` · TL ${esc(x.tl)}` : ''}</p></div>
        <span class="pc">▼ ${x.drop}%</span></a>`;
    };
    return `<div class="sc-alerts"><div class="sc-alerts-h"><span class="sc-dot"></span>Sudden drop · ${list.length} ${list.length === 1 ? 'alert' : 'alerts'}</div>${top.map(row).join('')}${list.length > top.length ? `<div class="sc-more">+ ${list.length - top.length} aur — Anomaly Detective / Performance me dekho</div>` : ''}</div>`;
  }

  function shell(dispHtml, alerts, note) {
    return `<div class="sc-wrap"><div class="sc-head"><b>🧠 Smart Notification Center</b><small>${esc(note || '')}</small></div>${dispHtml}${alerts}</div>`;
  }

  let cache = null;   // {at, html} — Home baar-baar paint kare to dobara calculate nahi
  /** Home ke #home-smart me mount (har paint par dobara safe). */
  async function mount(el) {
    if (!el) return;
    css();
    if (cache && Date.now() - cache.at < 60e3) { el.innerHTML = cache.html; return; }
    el.innerHTML = shell('<div class="sc-chip"><div class="sc-chip-t">🎯 Dispatch priority</div><div class="sc-seg"><span class="dim small">load ho raha hai…</span></div></div>', '', 'data load ho raha hai…');
    try { await Promise.allSettled([G && G.need && G.need('master'), S && S.need && S.need('daily')]); } catch { /* ignore */ }
    const alerts = alertsHtml(alertsAll());
    const counts = await dispatchCounts();
    const html = shell(counts ? dispatchHtml(counts) : '', alerts, 'GV + FF · live');
    if (counts) cache = { at: Date.now(), html };
    if (el.isConnected) el.innerHTML = html;
  }

  FF.smartCenter = { mount, suddenDown, alertsAll, dispatchCounts, _cfg: { RECENT, BASE, DROP, MIN_AGENT, MIN_TL } };
})(window.FF);
