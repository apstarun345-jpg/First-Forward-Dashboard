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
  .sc-grp{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
  .sc-grp em{font-style:normal;font-weight:800;font-size:11.5px;color:#64748b;text-transform:uppercase}
  a.sc-pill{text-decoration:none;transition:transform .12s,box-shadow .12s}a.sc-pill:hover{transform:translateY(-1px);box-shadow:0 3px 10px rgba(0,0,0,.15)}
  .sc-pill i{font-style:normal;opacity:.7}
  .sc-alerts-h{cursor:pointer;user-select:none}.sc-alerts-h .chev{margin-left:auto;transition:transform .2s;color:#b91c1c}
  .sc-alerts.collapsed .sc-alerts-body{display:none}.sc-alerts.collapsed .sc-alerts-h{margin:0}.sc-alerts.collapsed .chev{transform:rotate(-90deg)}
  .sc-seg .ch{font-weight:800;font-size:13px;min-width:78px}
  .sc-seg.gv .ch{color:#15803d}.sc-seg.ff .ch{color:#1d4ed8}
  .sc-pill{display:inline-flex;align-items:baseline;gap:6px;padding:4px 11px;border-radius:999px;font-weight:700;font-size:12px}
  .sc-pill b{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums}
  .sc-pill.hi{background:#fee2e2;color:#b91c1c}.sc-pill.md{background:#ffedd5;color:#c2410c}
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

  .sc-cmp{border:1px solid rgba(99,102,241,.35);border-top:4px solid #6366f1;border-radius:14px;background:color-mix(in srgb,#6366f1 5%,var(--card,#fff));overflow:hidden}
  .sc-cmp-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px}
  .sc-cmp-h .t{font-weight:800;font-size:13px;color:#4338ca;text-transform:uppercase;letter-spacing:.03em;flex:0 0 auto}
  .sc-cmp-h .t small{font-weight:600;text-transform:none;letter-spacing:0;color:var(--muted,#64748b);margin-left:6px}
  .sc-cmp-p{display:inline-flex;align-items:baseline;gap:5px;padding:3px 10px;border-radius:999px;font-weight:700;font-size:12px;background:#e0e7ff;color:#3730a3;text-decoration:none}
  .sc-cmp-p b{font-size:15px;font-variant-numeric:tabular-nums}
  .sc-cmp-p.new{background:#dbeafe;color:#1e40af}.sc-cmp-p.pend{background:#ffedd5;color:#c2410c}.sc-cmp-p.bad{background:#fee2e2;color:#b91c1c}.sc-cmp-p.ded{background:#dcfce7;color:#166534}.sc-cmp-p.mail{background:#fef3c7;color:#92400e}
  .sc-cmp-l{display:flex;flex-direction:column;border-top:1px solid rgba(99,102,241,.2)}
  .sc-ce{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 14px;text-decoration:none;color:inherit}
  .sc-ce:hover{background:rgba(99,102,241,.07)}.sc-ce + .sc-ce{border-top:1px dashed rgba(99,102,241,.22)}
  .sc-ce .ic{font-size:18px;text-align:center}
  .sc-ce b{font-size:13px}.sc-ce p{margin:1px 0 0;font-size:11.5px;color:var(--muted,#64748b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sc-ce .rt{display:flex;flex-direction:column;align-items:flex-end;gap:3px;white-space:nowrap}
  .sc-ce time{font-size:11px;color:var(--muted,#64748b)}
  .sc-mb{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
  .sc-mb.sent{background:#dcfce7;color:#166534}.sc-mb.fail{background:#fee2e2;color:#b91c1c}.sc-mb.queued{background:#fef3c7;color:#92400e}.sc-mb.off,.sc-mb.norule{background:#e2e8f0;color:#475569}
  .sc-st{display:inline-block;padding:1px 7px;border-radius:6px;font-size:10.5px;font-weight:800;margin-left:4px}
  .sc-st.pend{background:#ffedd5;color:#c2410c}.sc-st.bank{background:#dcfce7;color:#166534}.sc-st.team,.sc-st.me{background:#e0e7ff;color:#3730a3}
  .sc-cmp-more{display:block;padding:6px 14px;font-size:12px;font-weight:700;color:#4338ca;text-decoration:none;border-top:1px dashed rgba(99,102,241,.22)}
  .sc-cmp-empty{padding:8px 14px 12px;font-size:12.5px;color:var(--muted,#64748b)}
  html[data-theme="dark"] .sc-cmp-p,html[data-theme="dark"] .sc-mb,html[data-theme="dark"] .sc-st{filter:brightness(.92)}
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
      if (direct) acc(A, id, { id, name: r.agentName || id, tl: '', kind: 'agent' }, k, n);   // sirf Direct agents (TL ke agents nahi)
      else acc(T, norm(r.tlName), { id: r.tlId || '', name: r.tlName, kind: 'tl' }, k, n);
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
      // Sirf Direct agents + TLs (TL ke agents alag se nahi ginte)
      const agents = P.collectAgents();
      const direct = agents.filter((a) => a.direct).map((r) => P.withCalc(r, 'total'));
      const tls = (P.collectTls ? P.collectTls(agents) : []).filter((t) => !t.direct).map((r) => P.withCalc(r, 'total'));
      const z = () => ({ High: 0, Medium: 0 });
      const c = { gv: { direct: z(), tl: z() }, ff: { direct: z(), tl: z() } };
      const put = (list, kind) => list.forEach((r) => { const k = r.ch === 'gv' ? 'gv' : 'ff'; if (c[k][kind][r.priority] !== undefined) c[k][kind][r.priority]++; });
      put(direct, 'direct'); put(tls, 'tl');
      return c;
    } catch { return null; }
  }

  function dispatchHtml(c) {
    const can = FF.auth && FF.auth.can && FF.auth.can('dispatchPlan');
    const link = (ch, prio, kind, n, label) => {
      const inner = `<b>${n}</b> ${label}`;
      const cls = `sc-pill ${prio === 'High' ? 'hi' : 'md'}`;
      if (!can) return `<span class="${cls}">${inner}</span>`;
      const q = kind === 'direct' ? 'view=agents&type=direct' : 'view=tls&type=managed';
      return `<a class="${cls}" href="#/dispatchPlan?reset=1&channel=${ch}&${q}&priority=${prio}" title="Dispatch Planner · ${ch.toUpperCase()} · ${prio} · ${label}">${inner} <i>›</i></a>`;
    };
    const seg = (ch, label, icon) => {
      const v = c[ch];
      const grp = (prio) => `<span class="sc-grp"><em>${prio}</em>${link(ch, prio, 'direct', v.direct[prio], 'Direct')}${link(ch, prio, 'tl', v.tl[prio], 'TLs')}</span>`;
      return `<div class="sc-seg ${ch}"><span class="ch">${icon} ${label}</span>${grp('High')}${grp('Medium')}</div>`;
    };
    return `<div class="sc-chip"><div class="sc-chip-t">🎯 Dispatch priority</div>${seg('gv', 'GV', '🟩')}${seg('ff', 'FF', '🟦')}</div>`;
  }

  function alertsHtml(list) {
    if (!list.length) return '<div class="sc-ok">✅ Koi agent / TL achanak down nahi hua</div>';
    const top = list.slice(0, MAX_ALERTS);
    const collapsed = (() => { try { return localStorage.getItem('ff_sc_alerts_collapsed') === '1'; } catch { return false; } })();
    const row = (x) => {
      const href = `#/masterSearch?q=${encodeURIComponent(x.name)}${x.id ? `&id=${encodeURIComponent(x.id)}` : ''}&ch=${x.ch === 'gv' ? 'gv' : 'ff'}`;
      const chn = x.ch === 'gv' ? '🟩 GV' : '🟦 FF';
      return `<a class="sc-al" href="${href}" title="${esc(x.name)} · Master Search me kholo">
        <span class="ic">${x.kind === 'tl' ? '🏬' : '🧑‍💼'}</span>
        <div><b>${x.kind === 'tl' ? 'TL ' : ''}${esc(x.name)}</b><p>${chn} · pichhle ${BASE} din avg ${x.baseAvg.toFixed(1)}/din → last ${RECENT} din ${x.recAvg.toFixed(1)}/din · ~${x.lost} tags kam${x.kind === 'agent' && x.tl ? ` · TL ${esc(x.tl)}` : ''}</p></div>
        <span class="pc">▼ ${x.drop}%</span></a>`;
    };
    return `<div class="sc-alerts${collapsed ? ' collapsed' : ''}"><div class="sc-alerts-h" data-sc-toggle title="Collapse / expand"><span class="sc-dot"></span>Sudden drop · ${list.length} ${list.length === 1 ? 'alert' : 'alerts'} <small style="font-weight:600;color:#64748b">Direct agents + TLs</small><span class="chev">▾</span></div><div class="sc-alerts-body">${top.map(row).join('')}${list.length > top.length ? `<div class="sc-more">+ ${list.length - top.length} aur — Anomaly Detective / Performance me dekho</div>` : ''}</div></div>`;
  }

  function shell(dispHtml, alerts, note) {
    return `<div class="sc-wrap"><div class="sc-head"><b>🧠 Smart Notification Center</b><small>${esc(note || '')}</small></div>${dispHtml}${alerts}</div>`;
  }

  const bound = new WeakSet();
  let cache = null;   // {at, html} — Home baar-baar paint kare to dobara calculate nahi
  /** Home ke #home-smart me mount (har paint par dobara safe). */
  async function mount(el) {
    if (!el) return;
    css();
    if (!bound.has(el)) {
      bound.add(el);
      el.addEventListener('click', (e) => {
        const h = e.target.closest('[data-sc-toggle]'); if (!h) return;
        const box = h.closest('.sc-alerts'); const c = box.classList.toggle('collapsed');
        try { localStorage.setItem('ff_sc_alerts_collapsed', c ? '1' : '0'); } catch { /* ignore */ }
        cache = null;
      });
    }
    if (cache && Date.now() - cache.at < 60e3) { el.innerHTML = cache.html; payMount(el); cmpMount(el); return; }
    el.innerHTML = shell('<div class="sc-chip"><div class="sc-chip-t">🎯 Dispatch priority</div><div class="sc-seg"><span class="dim small">load ho raha hai…</span></div></div>', '', 'data load ho raha hai…');
    try { await Promise.allSettled([G && G.need && G.need('master'), S && S.need && S.need('daily')]); } catch { /* ignore */ }
    const alerts = alertsHtml(alertsAll());
    const counts = await dispatchCounts();
    const html = shell(counts ? dispatchHtml(counts) : '', alerts, 'GV + FF · live');
    if (counts) cache = { at: Date.now(), html };
    if (el.isConnected) { el.innerHTML = html; payMount(el); cmpMount(el); }
  }
  /** 💰 v3.125.254 — FNF payout status chips (Hold / Account details missing / Processing / Negative / Paid …).
   *  Sirf admin / payout permission. Click = rangeen table + CSV (payslip.js). */
  async function payMount(el) {
    try {
      if (!(FF.auth && (FF.auth.isAdmin() || FF.auth.can('payout')))) return;
      const wrap = el.querySelector('.sc-wrap'); if (!wrap || wrap.querySelector('.sc-pay')) return;
      if (!FF.payslip && FF.lazy && FF.lazy.inject) await FF.lazy.inject('payslip');
      if (!FF.payslip || !FF.payslip.payStatus) return;
      const d = await FF.payslip.payStatus();
      if (!d || !el.isConnected || wrap.querySelector('.sc-pay')) return;
      const host = document.createElement('div'); host.innerHTML = FF.payslip.payChipHtml(d);
      const chip = host.firstElementChild; if (!chip) return;
      const first = wrap.querySelector('.sc-chip');
      if (first && first.nextSibling) wrap.insertBefore(chip, first.nextSibling); else wrap.appendChild(chip);
      chip.addEventListener('click', (e) => { const b = e.target.closest('[data-pay-st]'); if (b) FF.payslip.openPayStatus(b.dataset.paySt, d.tab); });
    } catch { /* optional */ }
  }


  /** 📨 v3.125.456 — Agents Complaints: mail aate hi, bank ne paisa kaata (status), aur GV ki complaint par alert mail gayi ya nahi. */
  const CMP = { at: 0, d: null, seen: 0, timer: 0, busy: false };
  const ago = (ms) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60e3)); return m < 1 ? 'abhi' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} ghante` : `${Math.round(m / 1440)} din`; };
  const clock = (ms) => { try { return new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return ''; } };
  const stCls = (s) => (/^pending/i.test(s) ? 'pend' : /bank/i.test(s) ? 'bank' : /team/i.test(s) ? 'team' : 'me');
  function mailBadge(m) {
    if (!m) return '';
    const t = { sent: `✉️ Mail gayi · ${clock(m.at)}`, fail: '✉️ Mail fail — dobara try', queued: '✉️ Mail jaane wali hai', off: '✉️ Mail band (Settings)', norule: '✉️ Mail rule nahi' }[m.s] || '';
    return t ? `<span class="sc-mb ${m.s}" ${m.err ? `title="${esc(m.err)}"` : ''}>${t}</span>` : '';
  }
  let cmpOpen = false, cmpToggleBound = false;
  function cmpHtml(d) {
    const st = d.stats || {}, ev = d.events || [];
    const pill = (cls, n, label) => `<span class="sc-cmp-p ${cls}"><b>${U.fmt(n)}</b> ${label}</span>`;
    const pills = [pill('new', st.newToday || 0, 'aaj nayi'), pill('pend', st.pending || 0, `pending${st.pendingGv ? ` (GV ${st.pendingGv})` : ''}`), st.breach ? pill('bad', st.breach, 'TAT cross') : '',
      st.dedToday ? `<span class="sc-cmp-p ded"><b>${U.fmt(st.dedToday)}</b> bank deduct aaj · ₹${U.fmt(Math.round(st.dedAmt || 0))}</span>` : '', st.mailBad ? pill('bad', st.mailBad, 'mail fail') : ''].filter(Boolean).join('');
    const row = (e) => {
      const who = `${esc(e.agent || 'Agent ?')}${e.tl ? ` <small class="dim">· TL ${esc(e.tl)}</small>` : ''}`;
      const ch = e.gv ? '🟩 GV' : '🟦 FF';
      const line = e.t === 'deduct'
        ? `Bank ne <b>₹${U.fmt(Math.round(e.amount || 0))}</b> kaat liya${e.note ? ` · ${esc(e.note)}` : ''}`
        : `Nayi complaint aayi${e.vrn ? ` · ${esc(e.vrn)}` : ''}${e.desc ? ` · ${esc(e.desc)}` : ''}`;
      return `<a class="sc-ce" href="#/complaints" title="Agents Complaints Summary kholo"><span class="ic">${e.t === 'deduct' ? '💸' : '🆕'}</span>
        <div><b>${who}</b> <span class="sc-st ${stCls(e.status)}">${esc(e.status)}</span><p>${ch} · Case ${esc(e.caseNo)} · ${line}</p></div>
        <div class="rt"><time>${ago(e.at)} pehle</time>${mailBadge(e.mail)}</div></a>`;
    };
    // v3.125.502 — Home par sirf 2 complaints; baaki arrow (▾) dabane par khulti hain (khula/band yaad rehta hai)
    const FIRST = 2, shown = ev.slice(0, FIRST), rest = ev.slice(FIRST, 12);
    if (!cmpToggleBound) { cmpToggleBound = true; document.addEventListener('toggle', (e) => { const t = e.target; if (t && t.classList && t.classList.contains('sc-cmp-fold')) cmpOpen = !!t.open; }, true); }
    const body = shown.length ? `<div class="sc-cmp-l">${shown.map(row).join('')}${rest.length ? `<details class="sc-cmp-fold"${cmpOpen ? ' open' : ''}><summary><span class="ar">▾</span> ${rest.length} aur complaints${ev.length > 12 ? ` (kul ${ev.length})` : ''}</summary><div class="sc-cmp-fold-in">${rest.map(row).join('')}<a class="sc-cmp-more" href="#/complaints">poori list ›</a></div></details>` : `<a class="sc-cmp-more" href="#/complaints">poori list ›</a>`}</div>` : '<div class="sc-cmp-empty">Pichhle 48 ghante me koi nayi complaint ya bank deduction nahi.</div>';
    return `<div class="sc-cmp"><div class="sc-cmp-h"><span class="t">📨 Complaints <small>${d.ready ? 'live' : 'Gmail se aa rahi hain…'}${d.error ? ' · ⚠️ ' + esc(String(d.error).slice(0, 60)) : ''}</small></span>${pills}</div>${body}</div>`;
  }
  function cmpAnnounce(d) {
    try {
      const last = Number(localStorage.getItem('ff_cmp_seen') || 0), fresh = (d.events || []).filter((e) => e.at > last);
      const top = Math.max(0, ...(d.events || []).map((e) => e.at)); if (top) localStorage.setItem('ff_cmp_seen', String(Math.max(top, last)));
      if (!last || !fresh.length || !(FF.mascot && FF.mascot.push)) return;   // pehli baar sirf seen set; baad me naye par robot bolega
      fresh.slice(0, 3).forEach((e) => FF.mascot.push({ key: `cmp:${e.t}:${e.caseNo}`, grp: 'cmp', fast: true, view: 'big', q: '#/complaints', mood: e.t === 'deduct' ? 'happy' : 'alert', icon: e.t === 'deduct' ? '💸' : '📨',
        title: e.t === 'deduct' ? 'Bank ne paisa kaat liya' : 'Nayi complaint mail aayi', head: `${e.agent || 'Agent'}${e.tl ? ` (TL ${e.tl})` : ''} · Case ${e.caseNo}${e.t === 'deduct' ? ` · ₹${Math.round(e.amount || 0)}` : ''}`,
        rows: [{ name: e.agent || '', sub: `${e.gv ? 'GV' : 'FF'} · ${e.status}`, val: e.mail ? (e.mail.s === 'sent' ? 'Mail gayi' : e.mail.s === 'fail' ? 'Mail fail' : '') : '' }] }));
    } catch { /* optional */ }
  }
  async function cmpMount(el) {
    try {
      if (!(FF.auth && (FF.auth.isAdmin() || FF.auth.can('complaints')))) return;
      const paint = (d) => {
        if (!d || !el.isConnected) return;
        const wrap = el.querySelector('.sc-wrap'); if (!wrap) return;
        const host = document.createElement('div'); host.innerHTML = cmpHtml(d); const node = host.firstElementChild;
        const old = wrap.querySelector('.sc-cmp'); if (old) old.replaceWith(node);
        else { const anchor = wrap.querySelector('.sc-pay') || wrap.querySelector('.sc-chip'); if (anchor && anchor.nextSibling) wrap.insertBefore(node, anchor.nextSibling); else wrap.appendChild(node); }
      };
      if (CMP.d && Date.now() - CMP.at < 60e3) paint(CMP.d);
      const pull = async () => {
        if (CMP.busy) return; CMP.busy = true;
        try { const d = await FF.auth.api('/api/complaints/live'); if (d && d.ok) { CMP.d = d; CMP.at = Date.now(); const e2 = document.getElementById('home-smart'); paint(d); if (e2 && e2 !== el) cmpMount.last = e2; cmpAnnounce(d); } } catch { /* optional */ } finally { CMP.busy = false; }
      };
      if (!CMP.d || Date.now() - CMP.at >= 60e3) await pull();
      clearInterval(CMP.timer); CMP.timer = setInterval(() => { const cur = document.getElementById('home-smart'); if (!cur || !cur.isConnected || document.hidden) return; cmpMount(cur); }, 90e3);
      if (CMP.timer && CMP.timer.unref) CMP.timer.unref();
    } catch { /* optional */ }
  }

  FF.smartCenter = { mount, suddenDown, alertsAll, dispatchCounts, _cfg: { RECENT, BASE, DROP, MIN_AGENT, MIN_TL } };
})(window.FF);
