/* 🎯 Target updates (v3.101) — Home, top, highlighted.
   Admin ne jin agents ko target (ya "Active" goal) diya hai unki live status:
     🏆 Achieved        — issuance >= target (Active goal: issuance shuru ho gayi)
     ⏸️ No improvement  — target set karne ke baad (>= 6h) bhi progress 0 (issuance wahi ka wahi)
   Data: settings.targets (Targets page) + FF.store 'agents' (FF EIR) + FF.gv agentRollup (GV Master).
   Dismiss (✕) per alert localStorage me yaad rehta hai; "no improvement" roz wapas aata hai jab tak progress na ho. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, G = FF.gv, S = FF.store;
  const esc = U.esc;
  const MIN_HOURS = 6;      // target set hone ke itne ghante baad hi "no improvement" bolenge
  const MAX_SHOW = 6;
  const LS_KEY = 'ff_ta_dismissed';
  let cache = { at: 0, data: null, promise: null };

  const CSS = `
  .ta-card{border:1px solid rgba(22,163,74,.35);border-left:6px solid #16a34a;background:linear-gradient(90deg,color-mix(in srgb,#16a34a 8%,var(--card,#fff)),var(--card,#fff) 55%);padding:12px 14px;margin-bottom:14px}
  .ta-card.warn-only{border-color:rgba(245,158,11,.45);border-left-color:#f59e0b;background:linear-gradient(90deg,color-mix(in srgb,#f59e0b 9%,var(--card,#fff)),var(--card,#fff) 55%)}
  .ta-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;cursor:pointer;user-select:none}
  .ta-head h3{margin:0;font-size:14px}
  .ta-pill{display:inline-flex;align-items:baseline;gap:5px;padding:2px 10px;border-radius:999px;font-weight:800;font-size:12px}
  .ta-pill b{font-size:15px;font-variant-numeric:tabular-nums}.ta-pill.ok{background:#dcfce7;color:#15803d}.ta-pill.wait{background:#fef3c7;color:#b45309}
  .ta-head .chev{margin-left:auto;color:var(--muted,#64748b);transition:transform .2s}
  .ta-card.collapsed .ta-body{display:none}.ta-card.collapsed .chev{transform:rotate(-90deg)}
  .ta-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 8px;border-radius:10px}
  .ta-row + .ta-row{border-top:1px dashed rgba(100,116,139,.25)}
  .ta-row:hover{background:rgba(100,116,139,.07)}
  .ta-ic{font-size:20px;text-align:center}
  .ta-main{min-width:0}.ta-main a.ta-name{font-weight:800;color:inherit;text-decoration:none;border-bottom:1px dashed currentColor}
  .ta-main small{display:block;color:var(--muted,#64748b);font-size:12px;margin-top:1px}
  .ta-tag{display:inline-block;margin-left:6px;padding:0 8px;border-radius:999px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
  .ta-tag.ok{background:#dcfce7;color:#15803d}.ta-tag.wait{background:#fef3c7;color:#b45309}.ta-tag.gv{background:#dcfce7;color:#166534}.ta-tag.ff{background:#dbeafe;color:#1d4ed8}
  .ta-act{display:flex;gap:6px;align-items:center}.ta-act .btn{padding:2px 9px;font-size:12px}
  .ta-more{margin:6px 0 0 38px}`;
  function ensureCss() { if (document.getElementById('ta-css')) return; const st = document.createElement('style'); st.id = 'ta-css'; st.textContent = CSS; document.head.appendChild(st); }

  const norm = (s) => U.clean(s).toUpperCase().replace(/\s+/g, ' ');
  const keyOf = (source, name) => `${source}|${norm(name)}`;
  const dismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch { return new Set(); } };
  const saveDismissed = (set) => { try { localStorage.setItem(LS_KEY, JSON.stringify([...set].slice(-400))); } catch { /* ignore */ } };
  const dayKey = () => U.dateKey(new Date());

  /** Pure: targets + current issuance → alerts. cur = Map(key → issuance), now = ms. */
  function evaluate(targets, curByKey, ym, now) {
    const out = [];
    (targets || []).forEach((t) => {
      if (!t || t.ym !== ym || !t.key) return;
      const classSum = t.classTargets ? Object.values(t.classTargets).reduce((a, v) => a + (Number(v) || 0), 0) : 0;
      const target = Number(t.target) > 0 ? Number(t.target) : classSum;
      const activeGoal = t.goal === 'active' && !(Number(t.target) > 0);
      if (!target && !activeGoal) return;
      const cur = Number(curByKey.get(t.key)) || 0;
      const base = t.baseCur === undefined || t.baseCur === null ? 0 : Number(t.baseCur) || 0;
      const setAt = Date.parse(t.at || '') || 0;
      const hours = setAt ? (now - setAt) / 36e5 : 0;
      const src = t.source === 'gv' ? 'gv' : 'ff';
      const base0 = { key: t.key, name: t.agent || String(t.key).split('|')[1] || '', source: src, tl: t.tl || '', target, activeGoal, cur, base, setAt, hours, ym };
      const achieved = activeGoal ? cur > 0 : cur >= target;
      if (achieved) out.push({ ...base0, kind: 'achieved' });
      else if (hours >= MIN_HOURS && cur - base <= 0) out.push({ ...base0, kind: 'stuck' });
    });
    out.sort((a, b) => (a.kind === b.kind ? b.hours - a.hours : a.kind === 'achieved' ? -1 : 1));
    return out;
  }

  async function compute() {
    const settings = (FF.auth && FF.auth.settings) || {};
    const targets = (settings.targets || []).filter((t) => t && t.ym && t.key);
    if (!targets.length) return { alerts: [], ym: '' };
    const [agentsR] = await Promise.allSettled([S.need('agents'), S.need('daily'), G && G.enabled && G.enabled() ? G.need('master') : Promise.resolve([])]);
    const agents = agentsR.status === 'fulfilled' ? agentsR.value : [];
    let latest = null;
    try { const d = FF.model && FF.model.latestDate ? FF.model.latestDate(S.get('daily') || []) : null; const g = G && G.enabled && G.enabled() ? G.latestDate() : null; latest = d && g ? (d > g ? d : g) : (d || g); } catch { /* ignore */ }
    const ym = latest ? U.ymKey(latest) : U.ymKey(new Date());
    const cur = new Map();
    for (const a of agents) { if (a.channel !== 'First Forward' || a.ym !== ym) continue; const k = keyOf('ff', a.name); cur.set(k, (cur.get(k) || 0) + (Number(a.n) || 0)); }
    try { if (G && G.enabled && G.enabled()) G.agentRollup(ym).forEach((a) => cur.set(keyOf('gv', a.agentName), Number(a.total) || 0)); } catch { /* ignore */ }
    return { alerts: evaluate(targets, cur, ym, Date.now()), ym };
  }
  function data() {
    if (cache.data && Date.now() - cache.at < 60e3) return Promise.resolve(cache.data);
    if (!cache.promise) cache.promise = compute().then((d) => { cache = { at: Date.now(), data: d, promise: null }; return d; }).catch((e) => { cache.promise = null; throw e; });
    return cache.promise;
  }
  const invalidate = () => { cache = { at: 0, data: null, promise: null }; };

  const alertId = (a) => `${a.kind}|${a.ym}|${a.key}|${a.target}|${a.activeGoal ? 'A' : ''}${a.kind === 'stuck' ? '|' + dayKey() : ''}`;
  const ago = (h) => (h >= 48 ? `${Math.floor(h / 24)}d ago` : h >= 24 ? '1d ago' : `${Math.max(1, Math.floor(h))}h ago`);
  const goal = (a) => (a.activeGoal ? '⚡ Active goal' : `target ${U.fmt(a.target)}`);
  function rowHtml(a) {
    const link = `#/masterSearch?q=${encodeURIComponent(a.name)}&ch=${a.source}`;
    const ch = `<span class="ta-tag ${a.source}">${a.source === 'gv' ? 'GV' : 'FF'}</span>`;
    const ok = a.kind === 'achieved';
    const text = ok
      ? (a.activeGoal ? `Now active — issued <b>${U.fmt(a.cur)}</b> this month` : `Achieved <b>${U.fmt(a.cur)}</b> / ${U.fmt(a.target)} · ${goal(a)}`)
      : `No improvement — ${goal(a)} · set ${a.setAt ? ago(a.hours) : 'earlier'} · issued <b>${U.fmt(Math.max(0, a.cur - a.base))}</b> since (this month ${U.fmt(a.cur)})`;
    return `<div class="ta-row" data-ta="${esc(alertId(a))}"><span class="ta-ic">${ok ? '🏆' : '⏸️'}</span>
      <div class="ta-main"><a class="ta-name" href="${link}" title="Open in Master Search">${esc(a.name)}</a>${ch}<span class="ta-tag ${ok ? 'ok' : 'wait'}">${ok ? 'Achieved' : 'No progress'}</span><small>${text}${a.tl && a.tl !== '—' ? ` · TL ${esc(a.tl)}` : ''}</small></div>
      <div class="ta-act"><a class="btn small" href="#/targets?month=${esc(a.ym)}" title="Open Targets">🎯</a><button type="button" class="btn small" data-ta-x title="Dismiss">✕</button></div></div>`;
  }
  function paint(host, d) {
    const hide = dismissed();
    const list = (d.alerts || []).filter((a) => !hide.has(alertId(a)));
    if (!list.length) { host.innerHTML = ''; return; }
    ensureCss();
    const nOk = list.filter((a) => a.kind === 'achieved').length, nWait = list.length - nOk;
    let collapsed = false; try { collapsed = localStorage.getItem('ff_ta_collapsed') === '1'; } catch { /* ignore */ }
    const showAll = host.__showAll;
    const shown = showAll ? list : list.slice(0, MAX_SHOW);
    host.innerHTML = `<section class="card ta-card${nOk ? '' : ' warn-only'}${collapsed ? ' collapsed' : ''}">
      <div class="ta-head" data-ta-toggle><h3>🎯 Target updates</h3>${nOk ? `<span class="ta-pill ok">🏆 Achieved <b>${nOk}</b></span>` : ''}${nWait ? `<span class="ta-pill wait">⏸️ No improvement <b>${nWait}</b></span>` : ''}<span class="chev">▾</span></div>
      <div class="ta-body">${shown.map(rowHtml).join('')}${list.length > shown.length ? `<div class="ta-more"><button type="button" class="btn small" data-ta-all>Show all ${list.length}</button></div>` : ''}</div></section>`;
  }
  async function mount(host) {
    if (!host) return;
    if (!host.__taBound) {
      host.__taBound = true;
      host.addEventListener('click', (e) => {
        const x = e.target.closest('[data-ta-x]');
        if (x) { e.preventDefault(); const row = x.closest('[data-ta]'); const set = dismissed(); set.add(row.dataset.ta); saveDismissed(set); if (cache.data) paint(host, cache.data); return; }
        if (e.target.closest('[data-ta-all]')) { host.__showAll = true; if (cache.data) paint(host, cache.data); return; }
        const t = e.target.closest('[data-ta-toggle]');
        if (t) { const card = t.closest('.ta-card'); card.classList.toggle('collapsed'); try { localStorage.setItem('ff_ta_collapsed', card.classList.contains('collapsed') ? '1' : '0'); } catch { /* ignore */ } }
      });
    }
    try { paint(host, await data()); } catch (err) { host.innerHTML = ''; console.warn('target alerts:', err && err.message); }
  }
  FF.targetAlerts = { mount, evaluate, invalidate, _alertId: alertId };
})(window.FF);
