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
  .ta-more{margin:6px 0 0 38px}
  /* ✨ animations — professional, subtle; all off under prefers-reduced-motion */
  .ta-card{position:relative;overflow:hidden}
  .ta-card::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,#16a34a,#22d3ee,#facc15,#16a34a);background-size:300% 100%;animation:ta-flow 4s linear infinite}
  .ta-card.warn-only::before{background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b);background-size:200% 100%}
  .ta-live{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#16a34a}
  .ta-live::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 0 0 currentColor;animation:ta-ping 1.8s ease-out infinite}
  .ta-card.warn-only .ta-live{color:#d97706}
  .ta-ticker{flex:1 1 220px;min-width:0;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:linear-gradient(90deg,#15803d,#0891b2,#15803d);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ta-shimmer 3.5s linear infinite,ta-in .5s ease both}
  .ta-card.warn-only .ta-ticker{background-image:linear-gradient(90deg,#b45309,#f59e0b,#b45309)}
  .ta-row{position:relative;overflow:hidden;animation:ta-in .45s ease both}
  .ta-row.ok::after{content:"";position:absolute;top:0;bottom:0;width:60px;left:-80px;background:linear-gradient(100deg,transparent,rgba(255,255,255,.65),transparent);animation:ta-sweep 3.6s ease-in-out infinite;pointer-events:none}
  .ta-row.ok .ta-ic{animation:ta-trophy 2.4s ease-in-out infinite;filter:drop-shadow(0 0 6px rgba(250,204,21,.8))}
  .ta-row.wait .ta-ic{display:inline-block;transform-origin:50% 10%;animation:ta-swing 2.6s ease-in-out infinite}
  .ta-tag.ok{animation:ta-glow 2s ease-in-out infinite}.ta-tag.wait{animation:ta-blink 1.6s ease-in-out infinite}
  .ta-bar{height:6px;border-radius:999px;background:rgba(100,116,139,.18);margin-top:6px;overflow:hidden;max-width:340px}
  .ta-bar i{display:block;height:100%;width:var(--w);border-radius:999px;background:linear-gradient(90deg,#22c55e,#16a34a);animation:ta-fill 1.1s cubic-bezier(.2,.8,.2,1) both}
  .ta-row.wait .ta-bar i{background:repeating-linear-gradient(45deg,#f59e0b 0 8px,#fbbf24 8px 16px);background-size:22px 22px;animation:ta-fill 1.1s cubic-bezier(.2,.8,.2,1) both,ta-stripes 1s linear infinite}
  .ta-pct{font-size:11px;font-weight:800;margin-left:8px;color:#15803d}.ta-row.wait .ta-pct{color:#b45309}
  .ta-confetti{position:absolute;left:0;right:0;top:0;height:0;pointer-events:none}
  .ta-confetti i{position:absolute;top:4px;width:7px;height:11px;border-radius:2px;opacity:0;animation:ta-conf 1.9s ease-out forwards}
  @keyframes ta-flow{to{background-position:300% 0}}
  @keyframes ta-ping{0%{box-shadow:0 0 0 0 rgba(22,163,74,.55)}80%,100%{box-shadow:0 0 0 8px rgba(22,163,74,0)}}
  @keyframes ta-shimmer{to{background-position:-200% 0}}
  @keyframes ta-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  @keyframes ta-sweep{0%,55%{left:-80px}100%{left:110%}}
  @keyframes ta-trophy{0%,100%{transform:translateY(0) rotate(0)}30%{transform:translateY(-4px) rotate(-8deg)}60%{transform:translateY(0) rotate(8deg)}}
  @keyframes ta-swing{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(12deg)}}
  @keyframes ta-glow{0%,100%{box-shadow:0 0 0 0 rgba(22,163,74,.0)}50%{box-shadow:0 0 0 4px rgba(22,163,74,.18)}}
  @keyframes ta-blink{0%,100%{opacity:1}50%{opacity:.55}}
  @keyframes ta-fill{from{width:0}to{width:var(--w)}}
  @keyframes ta-stripes{to{background-position:22px 0}}
  @keyframes ta-conf{0%{opacity:1;transform:translate(0,0) rotate(0)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--r))}}
  @media (prefers-reduced-motion:reduce){.ta-card::before,.ta-live::before,.ta-ticker,.ta-row,.ta-row::after,.ta-row .ta-ic,.ta-tag,.ta-bar i,.ta-confetti i{animation:none!important}.ta-confetti{display:none}}`;
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
    const pct = !a.activeGoal && a.target > 0 ? Math.round(a.cur / a.target * 100) : (ok ? 100 : 0);
    const bar = a.activeGoal && ok ? '' : `<div class="ta-bar" title="${pct}% of target"><i style="--w:${Math.min(100, Math.max(3, pct))}%"></i></div>`;
    return `<div class="ta-row ${ok ? 'ok' : 'wait'}" data-ta="${esc(alertId(a))}"><span class="ta-ic">${ok ? '🏆' : '⏳'}</span>
      <div class="ta-main"><a class="ta-name" href="${link}" title="Open in Master Search">${esc(a.name)}</a>${ch}<span class="ta-tag ${ok ? 'ok' : 'wait'}">${ok ? 'Achieved' : 'No progress'}</span><small>${text}${a.tl && a.tl !== '—' ? ` · TL ${esc(a.tl)}` : ''}${bar ? `<span class="ta-pct">${pct}%</span>` : ''}</small>${bar}</div>
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
      <div class="ta-head" data-ta-toggle><h3>🎯 Target updates</h3><span class="ta-live">LIVE</span>${nOk ? `<span class="ta-pill ok">🏆 Achieved <b>${nOk}</b></span>` : ''}${nWait ? `<span class="ta-pill wait">⏸️ No improvement <b>${nWait}</b></span>` : ''}<span class="ta-ticker" data-ta-ticker></span><span class="chev">▾</span></div>
      <div class="ta-confetti" aria-hidden="true"></div>
      <div class="ta-body">${shown.map(rowHtml).join('')}${list.length > shown.length ? `<div class="ta-more"><button type="button" class="btn small" data-ta-all>Show all ${list.length}</button></div>` : ''}</div></section>`;
  }
  function tickerMsgs(list) {
    return list.map((a) => (a.kind === 'achieved'
      ? (a.activeGoal ? `⚡ ${a.name} is now active — keep it going!` : `🎉 ${a.name} achieved the target — ${U.fmt(a.cur)} / ${U.fmt(a.target)}`)
      : `⏳ ${a.name} — no progress yet since the target was set`));
  }
  function startTicker(host, list) {
    if (host.__taTimer) { clearInterval(host.__taTimer); host.__taTimer = null; }
    const msgs = tickerMsgs(list), el = host.querySelector('[data-ta-ticker]');
    if (!el || !msgs.length) return;
    let i = 0;
    const show = () => { if (!host.isConnected || !host.contains(el)) { clearInterval(host.__taTimer); return; } el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; el.textContent = msgs[i % msgs.length]; i++; };
    show();
    if (msgs.length > 1) host.__taTimer = setInterval(show, 3800);
  }
  function celebrate(host) {
    const box = host.querySelector('.ta-confetti'); if (!box || host.__taCelebrated) return;
    host.__taCelebrated = true;
    const cols = ['#16a34a', '#facc15', '#22d3ee', '#f472b6', '#6366f1', '#f97316'];
    for (let n = 0; n < 26; n++) {
      const c = document.createElement('i');
      c.style.left = (8 + Math.random() * 84) + '%'; c.style.background = cols[n % cols.length];
      c.style.setProperty('--dx', ((Math.random() - 0.5) * 140).toFixed(0) + 'px'); c.style.setProperty('--dy', (50 + Math.random() * 90).toFixed(0) + 'px'); c.style.setProperty('--r', ((Math.random() - 0.5) * 540).toFixed(0) + 'deg');
      c.style.animationDelay = (Math.random() * 0.35).toFixed(2) + 's';
      box.appendChild(c);
    }
    setTimeout(() => { try { box.innerHTML = ''; } catch { /* ignore */ } }, 2600);
  }
  async function mount(host) {
    if (!host) return;
    if (!host.__taBound) {
      host.__taBound = true;
      host.addEventListener('click', (e) => {
        const x = e.target.closest('[data-ta-x]');
        if (x) { e.preventDefault(); const row = x.closest('[data-ta]'); const set = dismissed(); set.add(row.dataset.ta); saveDismissed(set); if (cache.data) { paint(host, cache.data); startTicker(host, cache.data.alerts.filter((a) => !dismissed().has(alertId(a)))); } return; }
        if (e.target.closest('[data-ta-all]')) { host.__showAll = true; if (cache.data) { paint(host, cache.data); startTicker(host, cache.data.alerts.filter((a) => !dismissed().has(alertId(a)))); } return; }
        const t = e.target.closest('[data-ta-toggle]');
        if (t) { const card = t.closest('.ta-card'); card.classList.toggle('collapsed'); try { localStorage.setItem('ff_ta_collapsed', card.classList.contains('collapsed') ? '1' : '0'); } catch { /* ignore */ } }
      });
    }
    try { paint(host, await data()); const l = (cache.data && cache.data.alerts || []).filter((a) => !dismissed().has(alertId(a))); startTicker(host, l); if (l.some((a) => a.kind === 'achieved')) celebrate(host); } catch (err) { host.innerHTML = ''; console.warn('target alerts:', err && err.message); }
  }
  FF.targetAlerts = { mount, evaluate, invalidate, _alertId: alertId };
})(window.FF);
