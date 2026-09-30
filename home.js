/* Home page v2 — No access/shortcuts, only main highlights via GV & FF charts */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }
  const kpi = (cls, title, icon, value, foot, spec) => `<div class="kpi ${cls}"${spec ? ` data-kpi="${esc(spec)}"` : ''}><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  const card = (title, body, right) => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;

  async function render(root) {
    const u = FF.auth.user || {};
    const avatar = u.avatar ? `<img class="home-avatar" src="${esc(u.avatar)}" alt="">` : `<div class="home-avatar mono-logo">${esc((u.name || u.username || 'U').slice(0, 1).toUpperCase())}</div>`;
    const canFf = FF.auth.can('dashboard') || FF.auth.can('trend') || FF.auth.can('stock') || FF.auth.can('performance');
    const canGv = FF.auth.can('gvDashboard') || FF.auth.can('gvTrend') || FF.auth.can('gvStock') || FF.auth.can('gvPerformance');

    // Poll sync status
    let syncPoll = null;
    const updateSync = () => {
      const el = document.getElementById('home-sync');
      if (!root.isConnected) { clearInterval(syncPoll); return; }
      const loaded = U.$('#home-loaded', root);
      if (loaded && (S.loadedAt || G.loadedAt)) loaded.textContent = U.timeLabel(S.loadedAt || G.loadedAt);
      if (!el) return;
      if (FF.preloader && FF.preloader.done) { el.textContent = 'All sheets ready ✓'; el.className = 'sync-fast'; }
      else if (FF.preloader && FF.preloader.running) { const p = FF.preloader.state.progress; el.textContent = `Preloading ${p.loaded}/${p.total}…`; }
      else if (FF.preloader && FF.preloader.state.errors.length) { el.textContent = 'Some sheets unavailable · retry ↻'; }
      else { el.textContent = 'Background sync…'; }
    };
    syncPoll = setInterval(updateSync, 1200);

    root.innerHTML = `<div class="home-hero v2">
        <div class="home-hero-main">
          ${avatar}
          <div>
            <h1>${esc(greeting())}, <span class="home-name">${esc(u.name || u.username || 'there')}</span> 👋</h1>
            <p class="sub">Aaj ka highlights — GV & First Forward ka live chart overview</p>
            <div class="home-quick-stats" id="home-quick"></div>
          </div>
        </div>
        <div class="home-hero-side">
          <div class="home-stat"><span class="dim">Data loaded</span><b id="home-loaded">${S.loadedAt || G.loadedAt ? U.timeLabel(S.loadedAt || G.loadedAt) : '—'}</b></div>
          <div class="home-stat"><span class="dim">Sync</span><b id="home-sync">${FF.preloader && FF.preloader.done ? 'All sheets ready ✓' : 'Background sync…'}</b></div>
          <button class="btn primary" data-action="refresh">↻ Refresh</button>
          <button class="btn" id="home-morning-card" title="Boss ke liye WhatsApp Good-Morning card (PNG)">📲 Morning Card</button>
          <a class="btn" href="#/tagIssued">🏷️ Tag Issued →</a>
        </div>
      </div>
      <div id="home-search"></div>
      <div id="today-glance" class="today-glance" aria-live="polite"></div>
      <div id="home-body">${U.spinner('Highlights load ho rahe hain — GV & FF charts…')}</div>`;

    const body = U.$('#home-body', root);
    const quick = U.$('#home-quick', root);

    // Background: ensure data
    const [dailyR, stockR, gvMasterR, gvStockR, agentsR, agentClassR] = await Promise.allSettled([
      (canFf || canGv) ? S.need('daily') : Promise.reject(new Error('skip')),
      canFf ? S.need('stock') : Promise.reject(new Error('skip')),
      canGv ? G.need('master') : Promise.reject(new Error('skip')),
      canGv ? G.need('stockClass') : Promise.reject(new Error('skip')),
      S.need('agents'), S.need('agentClass')
    ]);
    if (!root.isConnected) return;

    let ffDaily = null, ffLatest = null, ffCur = null, ffLast = null, ffStockTotal = null;
    if (dailyR.status === 'fulfilled') {
      ffDaily = dailyR.value;
      ffLatest = M.latestDate(ffDaily);
      if (ffLatest) {
        const curKey = U.ymKey(ffLatest);
        ffCur = M.summary(ffDaily.filter(r=>r.channel!=='GV Partner'), curKey);
        ffLast = M.summary(ffDaily.filter(r=>r.channel!=='GV Partner'), U.prevMonthKey(curKey), ffCur.lastDay);
        if (stockR.status === 'fulfilled') ffStockTotal = U.sum(stockR.value, r=>r.n);
      }
    }
    let gvLatest = null, gvCur = null, gvLastMtd = null, gvStockTotal = null;
    if (gvMasterR.status === 'fulfilled') {
      gvLatest = G.latestDate();
      if (gvLatest) {
        const curKey = U.ymKey(gvLatest);
        gvCur = G.summary(curKey);
        gvLastMtd = G.summary(U.prevMonthKey(curKey), gvLatest.getDate());
        if (gvStockR.status === 'fulfilled') gvStockTotal = U.sum(gvStockR.value, r=>r.n);
      }
    }

    if (quick) {
      const items = [];
      if (ffCur) items.push(`<span class="chip on">🟦 FF MTD <b>${U.fmt(ffCur.total)}</b> ${U.deltaHtml(U.growth(ffCur.total, ffLast.total))}</span>`);
      if (gvCur) items.push(`<span class="chip on">🟩 GV MTD <b>${U.fmt(gvCur.total)}</b> ${U.deltaHtml(U.growth(gvCur.total, gvLastMtd.total))}</span>`);
      if (ffStockTotal!==null) items.push(`<span class="chip">📦 FF Stock <b>${U.fmt(ffStockTotal)}</b></span>`);
      if (gvStockTotal!==null) items.push(`<span class="chip">📦 GV Stock <b>${U.fmt(gvStockTotal)}</b></span>`);
      quick.innerHTML = `<div class="chip-row">${items.join('')}</div>`;
    }

    // Dashboard 2.0: one decision surface before the long-form charts. It is intentionally
    // source-labelled so management can see what is live, what needs action, and when it was loaded.
    const glance = U.$('#today-glance', root);
    if (glance) {
      const ffRows = ffDaily || [];
      const ffDay = ffLatest ? U.dateKey(ffLatest) : '';
      const gvDay = gvLatest ? U.dateKey(gvLatest) : '';
      const ffToday = ffDay ? U.sum(ffRows.filter((r) => r.key === ffDay && r.channel !== 'GV Partner'), (r) => r.n) : 0;
      const gvRows = G.issuanceRows ? G.issuanceRows() : (G.rows ? G.rows() : []);
      const gvToday = gvDay ? U.sum(gvRows.filter((r) => r.date && U.dateKey(r.date) === gvDay), (r) => Number(r.n) || 1) : 0;
      const pulseTotal = ffToday + gvToday;
      const monthKey = U.ymKey(ffLatest || gvLatest || new Date());
      const agentRows = agentsR.status === 'fulfilled' ? agentsR.value.filter((r) => r.ym === monthKey) : [];
      const activeAgents = new Set(agentRows.filter((r) => Number(r.n) > 0).map((r) => r.name)).size;
      const directAgents = new Set(agentRows.filter((r) => Number(r.n) > 0 && FF.config.isExcludedTl(r.tlName)).map((r) => r.name)).size;
      const sourceDate = [ffLatest, gvLatest].filter(Boolean).sort((a, b) => b - a)[0];
      const loadedAt = S.loadedAt || G.loadedAt || FF.data.lastLoadAt;
      const age = loadedAt ? Math.max(0, Date.now() - new Date(loadedAt).getTime()) : Infinity;
      const freshness = age < 2 * 3600e3 ? 'fresh' : age < 8 * 3600e3 ? 'aging' : 'stale';
      const freshnessText = loadedAt ? `${U.timeLabel(loadedAt)} · ${freshness === 'fresh' ? 'fresh snapshot' : freshness === 'aging' ? 'refresh recommended' : 'stale — refresh now'}` : 'No snapshot yet';
      const issues = [];
      if (FF.preloader && FF.preloader.state && FF.preloader.state.errors.length) issues.push({ icon: '⚠️', label: `${FF.preloader.state.errors.length} sheet(s) need retry`, href: '#/settings?tab=data' });
      if (!pulseTotal) issues.push({ icon: '🟡', label: 'No issuance in the latest source date', href: '#/tagIssued' });
      if (ffStockTotal === 0 || gvStockTotal === 0) issues.push({ icon: '📦', label: 'Stock snapshot is empty or unavailable', href: '#/stock' });
      if (!issues.length) issues.push({ icon: '✅', label: 'No immediate blocker in the loaded snapshot', href: '#/performance' });
      const topMap = new Map();
      agentRows.forEach((r) => topMap.set(r.name, (topMap.get(r.name) || 0) + (Number(r.n) || 0)));
      const top = [...topMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      glance.innerHTML = `<section class="card glance-card"><div class="card-head"><div><h2>Today at a glance</h2><p class="sub">Aaj ka pulse · action-required items · performance highlights</p></div><div class="glance-fresh ${freshness}" title="Last successful data load">◉ ${esc(freshnessText)}</div></div><div class="glance-grid">
        <div class="glance-pulse"><span class="glance-eyebrow">LATEST SOURCE DATE · ${esc(sourceDate ? U.labelDate(sourceDate, true) : '—')}</span><strong>${U.fmt(pulseTotal)}</strong><span>tags across today’s FF + GV pulse</span><div class="glance-breakdown"><b>🟦 FF ${U.fmt(ffToday)}</b><b>🟩 GV ${U.fmt(gvToday)}</b></div></div>
        <div class="glance-kpis"><div><small>Active agents</small><b>${U.fmt(activeAgents)}</b><span>${U.fmt(directAgents)} direct · distinguishable</span></div><div><small>MTD context</small><b>${U.fmt((ffCur ? ffCur.total : 0) + (gvCur ? gvCur.total : 0))}</b><span>FF + GV · ${esc(U.labelYM(monthKey, true))}</span></div><div><small>Data freshness</small><b>${loadedAt ? U.timeLabel(loadedAt) : '—'}</b><span>↻ refresh to verify</span></div></div>
        <div class="glance-actions"><h3>Action required <span>${issues.length}</span></h3>${issues.map((x) => `<a href="${x.href}"><span>${x.icon}</span><b>${esc(x.label)}</b><span>→</span></a>`).join('')}</div>
        <div class="glance-highlights"><h3>Performance highlights</h3>${top.length ? top.map(([name, n], i) => `<a href="#/performance?agent=${encodeURIComponent(name)}"><span class="rank">${i + 1}</span><b>${esc(name)}</b><strong>${U.fmt(n)}</strong></a>`).join('') : '<p class="dim small">Agent performance data abhi load ho raha hai.</p>'}</div>
      </div><div class="glance-footer"><span>Source-aware pulse · direct agents stay separate from TL-managed agents.</span><button class="btn small" data-action="focus-mode">🎯 Focus mode</button><button class="btn small" data-action="notifications">🔔 Notifications</button></div></section>`;
    }

    const cards = [];

    // 📅 EIR-authoritative month-end expectations. One shared current-month summary powers all
    // four cards; expected values are calculated from observed EIR days, never hardcoded.
    if (ffDaily && (ffLatest || gvLatest)) {
      const homeLatest = [ffLatest, gvLatest].filter(Boolean).sort((a, b) => b - a)[0];
      const homeMonth = U.ymKey(homeLatest);
      const homeS = M.summary(ffDaily, homeMonth);
      const observedDay = homeS.lastDay || homeLatest.getDate();
      const monthDays = U.daysInMonth(homeMonth);
      const expected = (actual) => observedDay > 0 ? Math.max(actual, Math.round((actual / observedDay) * monthDays)) : actual;
      const expectation = (label, value) => `${U.fmt(value)} <small class="kpi-expect">/ ${U.fmt(expected(value))}</small>`;
      cards.push(`<section class="card home-expected"><div class="card-head"><div><h3>📅 This month · EIR issuance pace</h3><p class="sub">Actual so far / expected month-end · FF + GV combined from EIR</p></div><div class="card-right dim">${esc(U.labelYM(homeMonth, true))} · through day ${observedDay}</div></div><div class="card-body"><div class="kpi-grid mini expected-kpi-grid">
        ${kpi('g3', 'VC4 · Actual / Expected', '🚗', expectation('VC4', homeS.vc4), `EIR actual ${U.fmt(homeS.vc4)} · expected month-end ${U.fmt(expected(homeS.vc4))}`, `src=both&scope=mtd&f=vc4`)}
        ${kpi('g8', 'VC20 · Actual / Expected', '🛻', expectation('VC20', homeS.vc20), `EIR actual ${U.fmt(homeS.vc20)} · expected month-end ${U.fmt(expected(homeS.vc20))}`, `src=both&scope=mtd&f=vc20`)}
        ${kpi('g6', 'VC5+ · Actual / Expected', '🚚', expectation('VC5+', homeS.vc5p), `EIR actual ${U.fmt(homeS.vc5p)} · expected month-end ${U.fmt(expected(homeS.vc5p))}`, `src=both&scope=mtd&f=vc5p`)}
        ${kpi('g4', 'All Commercial · Actual / Expected', '💼', expectation('Commercial', homeS.comm), `EIR actual ${U.fmt(homeS.comm)} · expected month-end ${U.fmt(expected(homeS.comm))}`, `src=both&scope=mtd&f=commercial`)}
      </div></div></section>`);
    }

    // 🟩 GV · AAJ KA LIVE — class/type-wise KPI cards + Expected Today (run-rate) — click → full detail
    if (gvMasterR.status === 'fulfilled' && G.rows) {
      const gvAll = G.issuanceRows ? G.issuanceRows() : G.rows();
      const sourceNow = gvLatest || new Date();
      const now = sourceNow;
      const tk = U.dateKey(sourceNow);
      const todayRows = gvAll.filter((r) => r.date && U.dateKey(r.date) === tk);
      const countRows = (list, fn) => U.sum(list.filter(fn), (r) => Number(r.n) || 1);
      const sum = (fn) => countRows(todayRows, fn);
      const gvAajTotal = U.sum(todayRows, (r) => Number(r.n) || 1);
      const gvAajVc4 = sum((r) => r.group === 'VC4');
      const gvAajVc20 = sum((r) => r.group === 'VC20');
      const gvAajVc5p = sum((r) => r.group === 'VC5+');
      const gvAajChassis = sum((r) => /chassis/i.test(r.tagType || r.vrnType || ''));
      const gvAajRepl = sum((r) => /replacement/i.test(r.status || r.type || ''));
      // Pichhle same 4 week-days ki EIR run-rate (isi weekday ka average) → Expected today
      const wd = sourceNow.getDay();
      const byDay = new Map();
      for (const r of gvAll) { if (!r.date || r.date.getDay() !== wd) continue; const k = U.dateKey(r.date); if (k === tk) continue; byDay.set(k, (byDay.get(k) || 0) + (Number(r.n) || 1)); }
      const last4 = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 4);
      const runRate = last4.length ? Math.round(last4.reduce((n, [, v]) => n + v, 0) / last4.length) : null;
      // Aaj ki rate (pace) se projection — abhi tak jitna hua, din ke bache hue hisaab se
      const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
      const hoursGone = Math.max(1, (now - dayStart) / 3600000);
      const paceProj = gvAajTotal > 0 ? Math.round((gvAajTotal / hoursGone) * 24) : null;
      const expectFoot = runRate != null ? `pichhle ${last4.length} same-weekday avg` : 'history kam hai';
      const paceFoot = paceProj != null ? `aaj ki rate se · abhi ${U.fmt(gvAajTotal)} ho chuka` : 'abhi issuance nahi hui';
      cards.push(`<section class="card gv-aaj"><div class="card-head"><h3>🟩 GV · Aaj ka live <span class="dim">· ${esc(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))}</span></h3>
        <div class="card-right dim">kisi bhi card par click karo → poora detail khulega</div></div><div class="card-body">
        <div class="kpi-grid mini gv-aaj-grid">${[
          kpi('g11', 'Aaj Total', '🏷️', U.fmt(gvAajTotal), runRate != null ? `expected ${U.fmt(runRate)} · pace ${paceProj != null ? U.fmt(paceProj) : '—'}` : 'aaj ka GV total', `src=gv&scope=day&date=${tk}`),
          kpi('g3', 'VC4 tags', '🚗', U.fmt(gvAajVc4), gvAajTotal ? `${U.fmtPct(U.pctOf(gvAajVc4, gvAajTotal), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc4`),
          kpi('g8', 'VC20 tags', '🛻', U.fmt(gvAajVc20), gvAajTotal ? `${U.fmtPct(U.pctOf(gvAajVc20, gvAajTotal), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc20`),
          kpi('g6', 'VC5+ tags', '🚚', U.fmt(gvAajVc5p), gvAajTotal ? `${U.fmtPct(U.pctOf(gvAajVc5p, gvAajTotal), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc5p`),
          kpi('g4', 'Chassis tags', '🔧', U.fmt(gvAajChassis), gvAajTotal ? `${U.fmtPct(U.pctOf(gvAajChassis, gvAajTotal), 0)} of today` : '—', `src=gv&scope=day&date=${tk}&f=chassis`),
          kpi('g7', 'Replacement tags', '🔁', U.fmt(gvAajRepl), gvAajTotal ? `${U.fmtPct(U.pctOf(gvAajRepl, gvAajTotal), 0)} of today` : '—', `src=gv&scope=day&date=${tk}&f=repl`),
          kpi('g5', 'Expected Today', '🎯', runRate != null ? U.fmt(runRate) : '—', expectFoot, `src=gv&scope=day&date=${tk}`),
          kpi('g10', 'Aaj ki Rate (pace)', '⚡', paceProj != null ? U.fmt(paceProj) : '—', paceFoot, `src=gv&scope=day&date=${tk}`)
        ].join('')}</div>
        <p class="dim small">Expected = pichhle 4 same-weekday ki run-rate · Pace = abhi tak ki speed se din ke end tak ka andaza · ↻ se fresh hota hai</p>
      </div></section>`);
    }

    // FF Highlight
    if (ffDaily && ffLatest) {
      const curKey = U.ymKey(ffLatest);
      const curSeries = M.dailySeries(ffDaily.filter(r=>r.channel!=='GV Partner'), curKey);
      const lastSeries = M.dailySeries(ffDaily.filter(r=>r.channel!=='GV Partner'), U.prevMonthKey(curKey));
      const line = C.lines({
        labels: curSeries.days.map(String),
        height: 210,
        series: [
          { name: U.labelYM(curKey), values: curSeries.totals.map((v,i)=> i < ffLatest.getDate() ? v : null), color: '#6366f1' },
          { name: U.labelYM(U.prevMonthKey(curKey)), values: lastSeries.totals.slice(0, curSeries.days.length), color: '#c7d2fe', dash: true, area: false }
        ]
      });
      const donut = C.donut({ items: [{ label: 'VC4', value: ffCur.vc4 }, { label: 'VC20', value: ffCur.vc20 }, { label: 'VC5+', value: ffCur.vc5p }], subtitle: 'MTD' });
      cards.push(`<div class="grid g-2-1">
        ${card(`🟦 First Forward · ${U.labelYM(curKey)} <span class="dim">MTD ${U.fmt(ffCur.total)} · VC4 ${U.fmtPct(U.pctOf(ffCur.vc4, ffCur.total),0)}</span>`, `
          <div class="kpi-grid mini">${[
            kpi('g2', `MTD`, '🏷️', U.fmt(ffCur.total), `${U.deltaHtml(U.growth(ffCur.total, ffLast.total))} vs last same`, 'src=ff&scope=mtd&f=ff'),
            kpi('g3', 'VC4', '🚗', U.fmt(ffCur.vc4), `${U.fmtPct(U.pctOf(ffCur.vc4, ffCur.total),0)} share`, 'src=ff&scope=mtd&f=ff,vc4'),
            kpi('g9', 'Stock', '📦', ffStockTotal!==null?U.fmt(ffStockTotal):'—', ffCur.avgPerDay?`${U.fmt(ffStockTotal/ffCur.avgPerDay)} days cover`:'', 'src=ff&scope=stock' )
          ].join('')}</div>
          ${line}
        `, `<a class="btn small" href="#/dashboard">📊 Dashboard →</a>`)}
        ${card('🍩 FF Class Mix', donut, `<a class="btn small" href="#/trend">Trend →</a>`)}
      </div>`);
    }

    // GV Highlight
    if (gvLatest && gvCur) {
      const curKey = U.ymKey(gvLatest);
      const cs = G.dailySeries(curKey), ls = G.dailySeries(U.prevMonthKey(curKey));
      const line = C.lines({
        labels: cs.days.map(String),
        height: 210,
        series: [
          { name: U.labelYM(curKey), values: cs.totals.map((v,i)=> i < gvLatest.getDate() ? v : null), color: '#0d9488' },
          { name: U.labelYM(U.prevMonthKey(curKey)), values: ls.totals.slice(0, cs.days.length), color: '#99f6e4', dash: true, area: false }
        ]
      });
      const donut = C.donut({ items: [{ label: 'VC4', value: gvCur.vc4 }, { label: 'VC20', value: gvCur.vc20 }, { label: 'VC5+', value: gvCur.vc5p }], subtitle: 'MTD' });
      cards.push(`<div class="grid g-2-1">
        ${card(`🟩 GV Partner · ${U.labelYM(curKey)} <span class="dim">MTD ${U.fmt(gvCur.total)} · VC4 ${U.fmtPct(U.pctOf(gvCur.vc4, gvCur.total),0)}</span>`, `
          <div class="kpi-grid mini">${[
            kpi('g2', `MTD`, '🏷️', U.fmt(gvCur.total), `${U.deltaHtml(U.growth(gvCur.total, gvLastMtd.total))} vs last same`, 'src=gv&scope=mtd'),
            kpi('g3', 'VC4', '🚗', U.fmt(gvCur.vc4), `${U.fmtPct(U.pctOf(gvCur.vc4, gvCur.total),0)} share`, 'src=gv&scope=mtd&f=vc4'),
            kpi('g9', 'Stock', '📦', gvStockTotal!==null?U.fmt(gvStockTotal):'—', gvCur.avgPerDay?`${U.fmt(gvStockTotal/gvCur.avgPerDay)} days cover`:'', 'src=gv&scope=stock' )
          ].join('')}</div>
          ${line}
        `, `<a class="btn small" href="#/gvDashboard">🚀 GV Dashboard →</a>`)}
        ${card('🍩 GV Class Mix', donut, `<a class="btn small" href="#/gvTrend">GV Trend →</a>`)}
      </div>`);
    }

    // Combined comparison highlight
    if (ffCur && gvCur) {
      const cmp = C.bars({
        labels: ['VC4','VC20','VC5+','Commercial','Total'],
        height: 220,
        series: [
          { name: 'First Forward', values: [ffCur.vc4, ffCur.vc20, ffCur.vc5p, ffCur.comm, ffCur.total], color: '#6366f1' },
          { name: 'GV Partner', values: [gvCur.vc4, gvCur.vc20, gvCur.vc5p, gvCur.comm, gvCur.total], color: '#0d9488' }
        ],
        legendAlways: true
      });
      cards.push(card(`⚖️ GV vs FF · ${U.labelYM(U.ymKey(ffLatest||gvLatest))} MTD <span class="dim">VC4 vs Commercial</span>`, `
        <div class="grid g-2" style="margin-bottom:0">
          <div>${cmp}</div>
          <div>
            <div class="kpi-grid mini" style="grid-template-columns:1fr 1fr">
              ${kpi('g6', 'FF Projected', '🎯', U.fmt(ffCur.projected), `${U.deltaHtml(U.growth(ffCur.projected, M.summary(ffDaily, U.prevMonthKey(U.ymKey(ffLatest))).total))} vs last full`, 'src=ff&scope=mtd&f=ff')}
              ${kpi('g6', 'GV Projected', '🎯', U.fmt(gvCur.projected), `${U.deltaHtml(U.growth(gvCur.projected, G.summary(U.prevMonthKey(U.ymKey(gvLatest))).total))} vs last full`, 'src=gv&scope=mtd')}
            </div>
            <div style="margin-top:10px">
              <b>Insights:</b>
              <ul class="insight-list">
                <li>GV share <b>${U.fmtPct(U.pctOf(gvCur.total, ffCur.total+gvCur.total),0)}</b> — FF ${U.fmt(ffCur.total)} vs GV ${U.fmt(gvCur.total)}</li>
                <li>VC4 mix — FF ${U.fmtPct(U.pctOf(ffCur.vc4, ffCur.total),0)} vs GV ${U.fmtPct(U.pctOf(gvCur.vc4, gvCur.total),0)}</li>
                <li>Stock cover — FF ${ffCur.avgPerDay?U.fmt(ffStockTotal/ffCur.avgPerDay):'—'} days vs GV ${gvCur.avgPerDay?U.fmt(gvStockTotal/gvCur.avgPerDay):'—'} days</li>
              </ul>
              <div class="btn-row" style="margin-top:10px"><a class="btn small primary" href="#/tagIssued">🏷️ Tag Issued detailed →</a><a class="btn small" href="#/compare">⚖️ Full comparison →</a></div>
            </div>
          </div>
        </div>
      `, ''));
    }

    // 🏆 Gamification — is mahine ke achievers
    {
      const norm = (s) => U.clean(s).toUpperCase().replace(/\s+/g, ' ');
      const keyOf = (source, name) => `${source}|${norm(name)}`;
      const curKey = ffLatest ? U.ymKey(ffLatest) : (gvLatest ? U.ymKey(gvLatest) : '');
      const lastKey = curKey ? U.prevMonthKey(curKey) : '';
      const badges = [];
      const badge = (emoji, title, name, sub, link) => {
        if (!name) return '';
        return `<a class="champ" href="${link || '#/performance'}" title="${esc(title)}"><span class="champ-emoji">${emoji}</span><span class="champ-body"><b>${esc(name)}</b><small>${esc(title)}${sub ? ` · ${esc(sub)}` : ''}</small></span></a>`;
      };
      // FF + GV current month agent maps
      const agents = agentsR.status === 'fulfilled' ? agentsR.value : [];
      const ffCurMap = new Map(), ffLastMap = new Map();
      for (const a of agents) {
        if (a.channel !== 'First Forward') continue;
        if (a.ym === curKey) ffCurMap.set(a.name, (ffCurMap.get(a.name) || 0) + a.n);
        if (a.ym === lastKey) ffLastMap.set(a.name, (ffLastMap.get(a.name) || 0) + a.n);
      }
      const gvRoll = gvMasterR.status === 'fulfilled' && curKey ? G.agentRollup(curKey) : [];
      const gvLastRoll = gvMasterR.status === 'fulfilled' && lastKey ? G.agentRollup(lastKey) : [];
      const gvLastMap = new Map(gvLastRoll.map((a) => [a.agentName, a.total]));
      // 1) FF top issuer
      const ffTop = [...ffCurMap.entries()].sort((a, b) => b[1] - a[1])[0];
      if (ffTop) badges.push(badge('🥇', 'FF Top Issuer', ffTop[0], `${U.fmt(ffTop[1])} tags · ${U.labelYM(curKey)}`, '#/performance'));
      // 2) GV top issuer
      if (gvRoll.length) badges.push(badge('👑', 'GV Top Issuer', gvRoll[0].agentName, `${U.fmt(gvRoll[0].total)} tags · ${U.labelYM(curKey)}`, '#/gvPerformance'));
      // 3) VC4 King — jo sabse zyada VC4 tags laya (FF agentClass + GV rollup combined)
      const vc4Map = new Map();
      if (agentClassR.status === 'fulfilled') {
        for (const r of agentClassR.value) if (r.ym === curKey && r.group === 'VC4') vc4Map.set(`FF · ${r.name}`, (vc4Map.get(`FF · ${r.name}`) || 0) + r.n);
      }
      for (const a of gvRoll) if (a.vc4) vc4Map.set(`GV · ${a.agentName}`, (vc4Map.get(`GV · ${a.agentName}`) || 0) + a.vc4);
      const vc4King = [...vc4Map.entries()].sort((a, b) => b[1] - a[1])[0];
      if (vc4King && vc4King[1]) badges.push(badge('🚗', 'VC4 King', vc4King[0], `${U.fmt(vc4King[1])} VC4 tags`, '#/tagIssued'));
      // 4) Fastest grower — last vs current, minimum base 10 tags
      let grower = null;
      for (const [name, cur] of ffCurMap) { const last = ffLastMap.get(name) || 0; if (last >= 10 && cur > last) { const g = ((cur - last) / last) * 100; if (!grower || g > grower.g) grower = { name: `FF · ${name}`, g, cur }; } }
      for (const a of gvRoll) { const last = gvLastMap.get(a.agentName) || 0; if (last >= 10 && a.total > last) { const g = ((a.total - last) / last) * 100; if (!grower || g > grower.g) grower = { name: `GV · ${a.agentName}`, g, cur: a.total }; } }
      if (grower) badges.push(badge('🚀', 'Fastest Grower', grower.name, `+${Math.round(grower.g)}% (${U.fmt(grower.cur)} tags)`, '#/trend'));
      // 5) Top TL (FF + GV combined issuance)
      const tlMap = new Map();
      for (const a of agents) if (a.channel === 'First Forward' && a.ym === curKey && a.tlName && FF.config.isRealTl(a.tlName)) tlMap.set(a.tlName, (tlMap.get(a.tlName) || 0) + a.n);
      for (const a of gvRoll) if (a.tlName && FF.config.isRealTl(a.tlName) && a.directAgent !== true) tlMap.set(a.tlName, (tlMap.get(a.tlName) || 0) + a.total);
      const topTl = [...tlMap.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topTl) badges.push(badge('🧑‍💼', 'Top TL', topTl[0], `${U.fmt(topTl[1])} tags team`, '#/targets?tab=tl'));
      // 6) Target achievers — settings.targets me se current month
      const tg = ((FF.auth.settings && FF.auth.settings.targets) || []).filter((t) => t && t.ym === curKey && Number(t.target) > 0);
      if (tg.length) {
        let done = 0, stars = [];
        for (const t of tg) {
          const nm = (t.agent || t.key.split('|')[1] || '').trim();
          const actual = t.key.startsWith('gv|') ? ((gvRoll.find((a) => norm(a.agentName) === norm(nm)) || {}).total || 0) : (ffCurMap.get(nm) || [...ffCurMap.entries()].find(([k]) => norm(k) === norm(nm)) || [0, 0])[1];
          if (actual >= Number(t.target)) { done++; stars.push({ name: nm, p: Math.round((actual / Number(t.target)) * 100) }); }
        }
        stars.sort((a, b) => b.p - a.p);
        badges.push(badge('🎯', 'Targets Achieved', `${done}/${tg.length} agents`, stars.length ? `🌟 ${stars[0].name} (${stars[0].p}%)` : 'koi nahi — push karo!', '#/targets?tab=achieve'));
      }
      if (badges.length) {
        cards.push(card(`🏆 Champions of ${curKey ? U.labelYM(curKey) : 'this month'} <span class="dim">· gamification — FF + GV combined</span>`,
          `<div class="champ-grid">${badges.join('')}</div>
           <p class="dim small">Ye badges har mahine ke live data se bante hain. 🎯 Targets page par jao aur apne agents ko targets do — agle mahine inke naam champions me dikhenge. <a href="#/targets">Targets →</a></p>`,
          `<a class="btn small" href="#/targets?tab=tl">👥 TL rollup →</a>`));
      }
    }

    // Last 14 days trend
    if (ffDaily && ffLatest) {
      const days = [];
      const ffVals = [];
      const gvVals = [];
      for (let i=13;i>=0;i--) {
        const d = new Date(ffLatest); d.setDate(d.getDate()-i);
        const ym = U.ymKey(d);
        const day = d.getDate();
        const f = ffDaily.filter(r=>r.ym===ym && r.day===day);
        days.push(U.labelDate(d));
        ffVals.push(U.sum(f.filter(r=>r.channel!=='GV Partner'), r=>r.n));
        if (gvLatest) {
          const gvDayRows = (G.issuanceRows ? G.issuanceRows() : G.rows()).filter(r=>r.ym===ym && r.day===day);
          gvVals.push(U.sum(gvDayRows, r => Number(r.n) || 1));
        }
      }
      cards.push(card(`📈 Last 14 Days Trend <span class="dim">FF vs GV</span>`, C.lines({
        labels: days,
        height: 230,
        series: [
          { name: 'First Forward', values: ffVals, color: '#6366f1' },
          { name: 'GV Partner', values: gvVals, color: '#0d9488' }
        ]
      }), ''));
    }

    // 📅 Aaj ka din — pichhle mahine / saal ki memories (wowzone)
    if (FF.wowzone) {
      try {
        const memories = await FF.wowzone.memoryLane();
        const memCard = FF.wowzone.memoryLaneCard(memories);
        if (memCard) cards.push(memCard);
      } catch { /* memory lane optional */ }
    }
    if (!root.isConnected) return;

    if (!cards.length) {
      body.innerHTML = `<div class="empty-state">Data load nahi hua — ↻ Refresh dabao</div>`;
    } else {
      body.innerHTML = `${cards.join('')}<p class="foot-note">Highlights — GV & FF charts ke dwara · Data ${U.timeLabel(S.loadedAt||G.loadedAt||Date.now())} · Background me all sheets preload ho rahe hain for instant open</p>`;
    }
    C.mount(body);
    // 🔎 Master search panel — naam, TL, ID, GV ID, barcode, tag ID sab kuch yahin se
    const searchMount = U.$('#home-search', root);
    if (searchMount && FF.masterSearch) { try { FF.masterSearch.mountHome(searchMount); } catch { /* search optional */ } }
    const morningBtn = U.$('#home-morning-card', root);
    if (morningBtn) morningBtn.addEventListener('click', () => { if (FF.morningCard) FF.morningCard.generate(root); });
    updateSync();
    // cleanup on page leave
    const obs = new MutationObserver(() => { if (!document.body.contains(root)) { clearInterval(syncPoll); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  FF.pages.home = { title: 'Home', render };
})(window.FF);
