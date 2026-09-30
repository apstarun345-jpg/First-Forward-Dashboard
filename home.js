/* Home page — source-aware FF T+1 (GV live) summaries + progressive paint.
   • GV issuance stays live; First Forward EIR issuance is reported T+1.
   • KPI click opens the complete agent/class/tag drill-down. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const F = () => FF.filters;
  const esc = U.esc;

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }
  const kpi = (cls, title, icon, value, foot, spec) => `<div class="kpi ${cls}"${spec ? ` data-kpi="${esc(spec)}"` : ''} data-kpi-title="${esc(title)}"><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  const card = (title, body, right) => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</section>`;

  /** Read this page's own URL filters; no cross-page saved filter state is applied. */
  function fx() { return (FF.filters ? FF.filters.current() : { period: 'month', from: '', to: '', channel: '', tl: '', agent: '', cls: '', active: [], isDefault: true, label: '', month: '' }); }
  /** daily rows → filter-aware streams. */
  function streams(daily) {
    const f = fx();
    const rows = FF.filters ? FF.filters.issuance(daily, { src: 'both', filters: f }) : (daily || []);
    const ff = rows.filter((r) => r.channel !== 'GV Partner');
    const gv = rows.filter((r) => r.channel === 'GV Partner');
    return { rows, ff, gv };
  }

  async function render(root) {
    const u = FF.auth.user || {};
    const f = fx();
    const avatar = u.avatar ? `<img class="home-avatar" src="${esc(u.avatar)}" alt="">` : `<div class="home-avatar mono-logo">${esc((u.name || u.username || 'U').slice(0, 1).toUpperCase())}</div>`;
    const canFf = FF.auth.can('dashboard') || FF.auth.can('trend') || FF.auth.can('stock') || FF.auth.can('performance');
    const canGv = FF.auth.can('gvDashboard') || FF.auth.can('gvTrend') || FF.auth.can('gvStock') || FF.auth.can('gvPerformance');

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
    syncPoll = setInterval(updateSync, 2000);

    root.innerHTML = `<div class="home-hero v2">
        <div class="home-hero-main">
          ${avatar}
          <div>
            <h1>${esc(greeting())}, <span class="home-name">${esc(u.name || u.username || 'there')}</span> 👋</h1>
            <p class="sub">Aaj ka highlights — GV &amp; First Forward ka live chart overview</p>
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
      <div id="home-gv-live"></div>
      <div id="home-body">${U.spinner('Highlights load ho rahe hain — GV &amp; FF charts…')}</div>`;

    const body = U.$('#home-body', root);
    const quick = U.$('#home-quick', root);

    // ---- data (parallel, har section apne data par khud paint hota hai — blank screen nahi) ------
    // ⚡ Pehla paint: chhota /api/today feed (server par cached) — bade datasets ka intezaar nahi.
    const feedP = (canFf || canGv) ? FF.data.today().catch(() => null) : Promise.resolve(null);
    feedP.then((feed) => {
      if (feed) FF.homeFeed = feed;   // FF aaj ka live EIR count (T+1 note ke saath dikhane ke liye)
      if (!feed || !root.isConnected || !quick || quick.dataset.final === '1' || quick.innerHTML) return;
      const gvN = feed.gv ? feed.gv.total : 0, ffN = feed.ff ? feed.ff.total : 0;
      const ffNote = feed.ff && (feed.ff.throughYesterday || !ffN) ? ' <small>· T+1 (kal)</small>' : '';
      quick.innerHTML = `<div class="chip-row"><span class="chip on" title="GV Master sheet se live">🟩 GV aaj (GV Master · live) <b>${U.fmt(gvN)}</b></span><span class="chip" title="EIR sheet">🟦 FF aaj (EIR) <b>${U.fmt(ffN)}</b>${ffNote}</span><span class="chip dim">⚡ live feed ${feed.gv && feed.gv.cached ? '(cached)' : ''}</span></div>`;
      if (quick.parentNode) quick.parentNode.dataset.feed = '1';
    }).catch(() => {});
    const dailyP = (canFf || canGv) ? S.need('daily').catch(() => null) : Promise.resolve(null);
    const stockP = canFf ? S.need('stock').catch(() => null) : Promise.resolve(null);
    const gvStockP = canGv ? G.need('stockClass').catch(() => null) : Promise.resolve(null);
    const agentsP = S.need('agents').catch(() => null);
    const agentClassP = S.need('agentClass').catch(() => null);
    const masterP = canGv ? G.need('master').catch(() => null) : Promise.resolve(null);

    const daily = await dailyP;
    if (!root.isConnected) return;
    const st = streams(daily || []);
    const ffLatest = M.latestDate(st.ff);
    const gvLatest = M.latestDate(st.gv);
    const fCur = f;
    const curKey = f.month || U.ymKey(ffLatest || gvLatest || new Date());

    // FF side: only rows up to the FF-reported date count (T+1). GV side: live.
    const ffSum = M.summary(st.ff, curKey);
    const gvSum = M.summary(st.gv, curKey);
    const ffPrev = M.summary(st.ff, U.prevMonthKey(curKey), ffSum.lastDay || undefined);
    const gvPrev = M.summary(st.gv, U.prevMonthKey(curKey), gvSum.lastDay || undefined);
    const todayK = U.dateKey(new Date());
    const ffToday = U.sum(st.ff.filter((r) => r.key === todayK), (r) => r.n);
    // 🟩 GV aaj = GV MASTER sheet (live). EIR se nahi — kyunki GV ka aaj ka data wahi live hota hai.
    const gvLive = (G && typeof G.gvToday === 'function') ? G.gvToday() : null;
    const gvMasterReady = !!(gvLive && gvLive.loaded);
    const gvToday = gvMasterReady ? gvLive.total : U.sum(st.gv.filter((r) => r.key === todayK), (r) => r.n);
    const gvTodayRows = gvMasterReady ? gvLive.rows : st.gv.filter((r) => r.key === todayK);
    const ffPendingToday = FF.filters ? FF.filters.isFfPending(todayK) : false;

    // ---- quick chips (filters ke saath) ----------------------------------------------------------
    if (quick) {
      quick.dataset.final = '1';
      const items = [];
      items.push(`<span class="chip ${ffPendingToday ? '' : 'on'}">🟦 FF ${esc(U.labelYM(curKey, true))} <b>${U.fmt(ffSum.total)}</b> ${U.deltaHtml(U.growth(ffSum.total, ffPrev.total))}</span>`);
      items.push(`<span class="chip on">🟩 GV ${esc(U.labelYM(curKey, true))} <b>${U.fmt(gvSum.total)}</b> ${U.deltaHtml(U.growth(gvSum.total, gvPrev.total))}</span>`);
      items.push(`<span class="chip on" title="GV Master sheet se live">🟩 GV aaj (GV Master · live) <b>${U.fmt(gvToday)}</b></span>`);
      const ffLiveNote = ffPendingToday && FF.homeFeed && FF.homeFeed.ff && FF.homeFeed.ff.total > 0 ? ` <small>· EIR me abhi ${U.fmt(FF.homeFeed.ff.total)}</small>` : '';
      items.push(`<span class="chip ${ffPendingToday ? '' : 'on'}" title="First Forward aaj = EIR sheet (T+1)">🟦 FF aaj <b>${U.fmt(ffToday)}</b>${ffPendingToday ? ' <small>· kal aayega</small>' : ''}${ffLiveNote}</span>`);
      if (f.active.length) items.push(`<span class="chip">🧭 ${esc(f.active.map((a) => a.label).join(' · '))}</span>`);
      quick.innerHTML = `<div class="chip-row">${items.join('')}</div>`;
    }

    // ---- today at a glance (fast path: sirf daily chahiye) ---------------------------------------
    const glance = U.$('#today-glance', root);
    if (glance) {
      const loadedAt = S.loadedAt || G.loadedAt || FF.data.lastLoadAt;
      const age = loadedAt ? Math.max(0, Date.now() - new Date(loadedAt).getTime()) : Infinity;
      const freshness = age < 2 * 3600e3 ? 'fresh' : age < 8 * 3600e3 ? 'aging' : 'stale';
      const freshnessText = loadedAt ? `${U.timeLabel(loadedAt)} · ${freshness === 'fresh' ? 'fresh snapshot' : freshness === 'aging' ? 'refresh recommended' : 'stale — refresh now'}` : 'No snapshot yet';
      const pulseTotal = gvToday + ffToday;
      const sourceDate = [ffLatest, gvLatest].filter(Boolean).sort((a, b) => b - a)[0];
      const issues = [];
      if (FF.preloader && FF.preloader.state && FF.preloader.state.errors.length) issues.push({ icon: '⚠️', label: `${FF.preloader.state.errors.length} sheet(s) need retry`, href: '#/settings?tab=data' });
      if (!pulseTotal) issues.push({ icon: '🟡', label: 'No issuance in the latest source date', href: '#/tagIssued' });
      if (!issues.length) issues.push({ icon: '✅', label: 'No immediate blocker in the loaded snapshot', href: '#/performance' });
      const ffLiveTotal = (FF.homeFeed && FF.homeFeed.ff && FF.homeFeed.ff.total) || 0;
      const ffNote = ffPendingToday ? `<span class="home-ff-pending">(T+1 — kal aayega${ffLiveTotal ? ` · EIR me abhi ${U.fmt(ffLiveTotal)} rows` : ''})</span>` : '';
      glance.innerHTML = `<section class="card glance-card"><div class="card-head"><div><h2>Today at a glance</h2><p class="sub">Aaj ka pulse · ${esc(f.isDefault ? 'poora data' : f.active.map((a) => a.label).join(' · '))} · action-required items</p></div><div class="glance-fresh ${freshness}" title="Last successful data load">◉ ${esc(freshnessText)}</div></div><div class="glance-grid">
        <div class="glance-pulse" data-kpi="src=both&scope=day&date=${esc(todayK)}" data-kpi-title="Aaj ka pulse">
          <span class="glance-eyebrow">AAJ · ${esc(U.labelDate(new Date(), true))}</span>
          <strong>${U.fmt(pulseTotal)}</strong>
          <span>tags aaj (GV Master live + FF ${ffPendingToday ? '0 — kal aayega' : U.fmt(ffToday)})</span>
          <div class="glance-breakdown"><b>🟩 GV ${U.fmt(gvToday)} <small>GV Master · live</small></b><b>🟦 FF ${U.fmt(ffToday)} ${ffNote}</b></div>
        </div>
        <div class="glance-kpis">
          <div data-kpi="src=ff&scope=mtd&ym=${esc(curKey)}" data-kpi-title="FF MTD"><small>🟦 FF MTD</small><b>${U.fmt(ffSum.total)}</b><span>${U.deltaHtml(U.growth(ffSum.total, ffPrev.total))} vs last same · ${esc(U.labelYM(curKey, true))}</span></div>
          <div data-kpi="src=gv&scope=mtd&ym=${esc(curKey)}" data-kpi-title="GV MTD"><small>🟩 GV MTD</small><b>${U.fmt(gvSum.total)}</b><span>${U.deltaHtml(U.growth(gvSum.total, gvPrev.total))} vs last same</span></div>
          <div data-kpi="src=both&scope=mtd&ym=${esc(curKey)}" data-kpi-title="Combined MTD"><small>Combined MTD</small><b>${U.fmt(ffSum.total + gvSum.total)}</b><span>FF + GV · ${esc(U.labelYM(curKey, true))}</span></div>
        </div>
        <div class="glance-actions"><h3>Action required <span>${issues.length}</span></h3>${issues.map((x) => `<a href="${x.href}"><span>${x.icon}</span><b>${esc(x.label)}</b><span>→</span></a>`).join('')}</div>
        <div class="glance-highlights"><h3>Top issuing agents · ${esc(U.labelYM(curKey, true))}</h3><div id="home-top-agents">${U.spinner('Agents…')}</div></div>
      </div><div class="glance-footer"><span>${esc(sourceDate ? `Source latest date ${U.labelDate(sourceDate, true)}` : '')} · 🟩 GV aaj <b>GV Master sheet</b> se (live${gvMasterReady ? '' : ' · load ho raha hai'}) · 🟦 FF aaj <b>EIR</b> se (T+1)</span><button class="btn small" data-action="focus-mode">🎯 Focus mode</button><button class="btn small" data-action="notifications">🔔 Notifications</button></div></section>`;
      const topMount = U.$('#home-top-agents', glance);
      if (topMount) {
        const byAgent = new Map();
        st.rows.forEach((r) => { const k = r.agentName || r.agentId || '—'; const cur = byAgent.get(k) || { n: 0, gv: false }; cur.n += r.n; cur.gv = cur.gv || r.channel === 'GV Partner'; byAgent.set(k, cur); });
        const top = [...byAgent.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 5);
        topMount.innerHTML = top.length
          ? top.map(([name, v], i) => `<a href="#/performance?agent=${encodeURIComponent(name)}" class="glance-agent" data-kpi="src=${v.gv ? 'gv' : 'ff'}&scope=mtd&ym=${esc(curKey)}&f=${v.gv ? 'gv' : 'ff'}" data-kpi-title="${esc(name)}"><span class="rank">${i + 1}</span><b>${esc(name)}</b><span class="tag ${v.gv ? 'gv' : 'ff'}">${v.gv ? 'GV' : 'FF'}</span><strong>${U.fmt(v.n)}</strong></a>`).join('')
          : '<p class="dim small">Is filter me koi issuance nahi mili.</p>';
      }
    }

    // ---- 🟩 GV · AAJ KA LIVE (fast path) ---------------------------------------------------------
    const gvLiveCard = U.$('#home-gv-live', root);
    if (gvLiveCard) {
      const gvRows = st.gv;
      const tk = todayK;
      // Aaj ki rows = GV Master sheet (jab load ho chuki ho), warna EIR fallback.
      const todayRows = gvTodayRows;
      const sum = (fn) => U.sum(todayRows.filter(fn), (r) => Number(r.n) || 1);
      const gvAajTotal = U.sum(todayRows, (r) => Number(r.n) || 1);
      const wd = new Date().getDay();
      const byDay = new Map();
      for (const r of gvRows) { if (!r.date || r.date.getDay() !== wd) continue; if (r.key === tk) continue; byDay.set(r.key, (byDay.get(r.key) || 0) + (Number(r.n) || 1)); }
      const last4 = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 4);
      const runRate = last4.length ? Math.round(last4.reduce((n, [, v]) => n + v, 0) / last4.length) : null;
      const hoursGone = Math.max(1, (Date.now() - new Date().setHours(0, 0, 0, 0)) / 3600000);
      const paceProj = gvAajTotal > 0 ? Math.round((gvAajTotal / hoursGone) * 24) : null;
      gvLiveCard.innerHTML = `<section class="card gv-aaj"><div class="card-head"><h3>🟩 GV · Aaj ka live <span class="dim">· ${esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))} · GV Master sheet se</span></h3>
        <div class="card-right dim">kisi bhi card par click karo → agent-wise poora detail khulega</div></div><div class="card-body">
        <div class="kpi-grid mini gv-aaj-grid">${[
          kpi('g11', 'Aaj Total (GV live)', '🏷️', U.fmt(gvAajTotal), runRate != null ? `expected ${U.fmt(runRate)} · pace ${paceProj != null ? U.fmt(paceProj) : '—'}` : 'aaj ka GV total', `src=gv&scope=day&date=${tk}`),
          kpi('g3', 'VC4 tags', '🚗', U.fmt(sum((r) => r.group === 'VC4')), gvAajTotal ? `${U.fmtPct(U.pctOf(sum((r) => r.group === 'VC4'), gvAajTotal), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc4`),
          kpi('g8', 'VC20 tags', '🛻', U.fmt(sum((r) => r.group === 'VC20')), gvAajTotal ? `${U.fmtPct(U.pctOf(sum((r) => r.group === 'VC20'), gvAajTotal), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc20`),
          kpi('g6', 'VC5+ tags', '🚚', U.fmt(sum((r) => r.group === 'VC5+')), gvAajTotal ? `${U.fmtPct(U.pctOf(sum((r) => r.group === 'VC5+'), gvAajTotal), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc5p`),
          kpi('g4', 'Commercial (VC20+VC5+)', '💼', U.fmt(sum((r) => r.group !== 'VC4')), gvAajTotal ? `${U.fmtPct(U.pctOf(sum((r) => r.group !== 'VC4'), gvAajTotal), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=comm`),
          kpi('g7', 'Chassis tags', '🔧', U.fmt(sum((r) => /chassis/i.test(r.tagType || r.vrnType || ''))), gvAajTotal ? `${U.fmtPct(U.pctOf(sum((r) => /chassis/i.test(r.tagType || r.vrnType || '')), gvAajTotal), 0)} of today` : '—', `src=gv&scope=day&date=${tk}&f=chassis`),
          kpi('g5', 'Replacement tags', '🔁', U.fmt(sum((r) => /replacement/i.test(r.status || r.type || ''))), gvAajTotal ? `${U.fmtPct(U.pctOf(sum((r) => /replacement/i.test(r.status || r.type || '')), gvAajTotal), 0)} of today` : '—', `src=gv&scope=day&date=${tk}&f=repl`),
          kpi('g1', 'Aaj ki Rate', '⚡', paceProj != null ? U.fmt(paceProj) : U.fmt(gvAajTotal), paceProj != null ? `${U.fmt(gvAajTotal)} ab tak · ${Math.round(hoursGone)}h ke pace par day-end` : 'aaj ka GV rate', `src=gv&scope=day&date=${tk}`),
          kpi('g2', 'Expected Today', '🎯', runRate != null ? U.fmt(runRate) : '—', runRate != null ? `pichhle ${last4.length} same-weekday avg` : 'history kam hai', `src=gv&scope=day&date=${tk}`)
        ].join('')}</div>
        <p class="dim small">🟩 <b>GV aaj ka number GV Master sheet se</b> (live, ${esc(U.timeLabel(S.loadedAt || G.loadedAt) || 'abhi')}) · 🟦 FF ka data <b>EIR</b> se T+1 aata hai (aaj ka kal) — isliye FF aaj <b>0</b> ginega, kal se dono. Expected = pichhle 4 same-weekday ka run-rate · kisi bhi card par click → kis agent ne lagaye, GV ya FF.</p>
      </div></section>`;
    }

    // ---- baaki cards (agents + stock aane par) ----------------------------------------------------
    const [stockR, gvStockR, agentsR, agentClassR, masterR] = await Promise.all([stockP, gvStockP, agentsP, agentClassP, masterP]);
    if (!root.isConnected) return;
    const ffStockRows = stockR ? (FF.filters ? FF.filters.stock(stockR, { src: 'ff' }) : stockR) : null;
    const ffStockTotal = ffStockRows ? U.sum(ffStockRows, (r) => r.n) : null;
    const gvStockTotal = gvStockR ? U.sum(gvStockR, (r) => r.n) : null;
    const cards = [];

    // 📅 EIR-authoritative month-end expectations (filters ke saath)
    if (st.rows.length && (ffLatest || gvLatest)) {
      const observedDay = Math.max(ffSum.lastDay || 0, gvSum.lastDay || 0) || new Date().getDate();
      const monthDays = U.daysInMonth(curKey);
      const expected = (actual) => observedDay > 0 ? Math.max(actual, Math.round((actual / observedDay) * monthDays)) : actual;
      const expectation = (value) => `${U.fmt(value)} <small class="kpi-expect">/ ${U.fmt(expected(value))}</small>`;
      const combined = M.summary(st.rows, curKey);
      cards.push(`<section class="card home-expected"><div class="card-head"><div><h3>📅 ${esc(U.labelYM(curKey, true))} · EIR issuance pace</h3><p class="sub">Actual so far / expected month-end · ${esc(f.label)} · through day ${observedDay}</p></div><div class="card-right dim">${U.fmt(combined.total)} tags</div></div><div class="card-body"><div class="kpi-grid mini expected-kpi-grid">
        ${kpi('g3', 'VC4 · Actual / Expected', '🚗', expectation(combined.vc4), `actual ${U.fmt(combined.vc4)} · expected ${U.fmt(expected(combined.vc4))}`, `src=both&scope=mtd&ym=${curKey}&f=vc4`)}
        ${kpi('g8', 'VC20 · Actual / Expected', '🛻', expectation(combined.vc20), `actual ${U.fmt(combined.vc20)} · expected ${U.fmt(expected(combined.vc20))}`, `src=both&scope=mtd&ym=${curKey}&f=vc20`)}
        ${kpi('g6', 'VC5+ · Actual / Expected', '🚚', expectation(combined.vc5p), `actual ${U.fmt(combined.vc5p)} · expected ${U.fmt(expected(combined.vc5p))}`, `src=both&scope=mtd&ym=${curKey}&f=vc5p`)}
        ${kpi('g4', 'All Commercial · Actual / Expected', '💼', expectation(combined.comm), `actual ${U.fmt(combined.comm)} · expected ${U.fmt(expected(combined.comm))}`, `src=both&scope=mtd&ym=${curKey}&f=comm`)}
      </div></div></section>`);
    }

    // FF Highlight
    if (st.ff.length && ffLatest) {
      const curSeries = M.dailySeries(st.ff, curKey);
      const lastSeries = M.dailySeries(st.ff, U.prevMonthKey(curKey));
      const line = C.lines({
        labels: curSeries.days.map(String),
        height: 210,
        series: [
          { name: U.labelYM(curKey), values: curSeries.totals.map((v, i) => i < ffLatest.getDate() ? v : null), color: '#6366f1' },
          { name: U.labelYM(U.prevMonthKey(curKey)), values: lastSeries.totals.slice(0, curSeries.days.length), color: '#c7d2fe', dash: true, area: false }
        ]
      });
      const donut = C.donut({ items: [{ label: 'VC4', value: ffSum.vc4 }, { label: 'VC20', value: ffSum.vc20 }, { label: 'VC5+', value: ffSum.vc5p }], subtitle: 'MTD' });
      cards.push(`<div class="grid g-2-1">
        ${card(`🟦 First Forward · ${U.labelYM(curKey)} <span class="dim">MTD ${U.fmt(ffSum.total)} · VC4 ${U.fmtPct(U.pctOf(ffSum.vc4, ffSum.total), 0)}${ffPendingToday ? ' · aaj 0 (T+1)' : ''}</span>`, `
          <div class="kpi-grid mini">${[
            kpi('g2', 'MTD', '🏷️', U.fmt(ffSum.total), `${U.deltaHtml(U.growth(ffSum.total, ffPrev.total))} vs last same`, `src=ff&scope=mtd&ym=${curKey}&f=ff`),
            kpi('g3', 'VC4', '🚗', U.fmt(ffSum.vc4), `${U.fmtPct(U.pctOf(ffSum.vc4, ffSum.total), 0)} share`, `src=ff&scope=mtd&ym=${curKey}&f=ff,vc4`),
            kpi('g9', 'Stock', '📦', ffStockTotal !== null ? U.fmt(ffStockTotal) : '—', ffSum.avgPerDay ? `${U.fmt(ffStockTotal / ffSum.avgPerDay)} days cover` : '', 'src=ff&scope=stock')
          ].join('')}</div>
          ${line}
        `, `<a class="btn small" href="#/dashboard">📊 Dashboard →</a>`)}
        ${card('🍩 FF Class Mix', donut, `<a class="btn small" href="#/trend">Trend →</a>`)}
      </div>`);
    }

    // GV Highlight
    if (st.gv.length && gvLatest) {
      const cs = M.dailySeries(st.gv, curKey), ls = M.dailySeries(st.gv, U.prevMonthKey(curKey));
      const line = C.lines({
        labels: cs.days.map(String),
        height: 210,
        series: [
          { name: U.labelYM(curKey), values: cs.totals.map((v, i) => i < (gvLatest.getDate() + 1) ? v : null), color: '#0d9488' },
          { name: U.labelYM(U.prevMonthKey(curKey)), values: ls.totals.slice(0, cs.days.length), color: '#99f6e4', dash: true, area: false }
        ]
      });
      const donut = C.donut({ items: [{ label: 'VC4', value: gvSum.vc4 }, { label: 'VC20', value: gvSum.vc20 }, { label: 'VC5+', value: gvSum.vc5p }], subtitle: 'MTD' });
      cards.push(`<div class="grid g-2-1">
        ${card(`🟩 GV Partner · ${U.labelYM(curKey)} <span class="dim">MTD ${U.fmt(gvSum.total)} · aaj live ${U.fmt(gvToday)}</span>`, `
          <div class="kpi-grid mini">${[
            kpi('g2', 'MTD', '🏷️', U.fmt(gvSum.total), `${U.deltaHtml(U.growth(gvSum.total, gvPrev.total))} vs last same`, `src=gv&scope=mtd&ym=${curKey}`),
            kpi('g3', 'VC4', '🚗', U.fmt(gvSum.vc4), `${U.fmtPct(U.pctOf(gvSum.vc4, gvSum.total), 0)} share`, `src=gv&scope=mtd&ym=${curKey}&f=vc4`),
            kpi('g9', 'Stock', '📦', gvStockTotal !== null ? U.fmt(gvStockTotal) : '—', gvSum.avgPerDay ? `${U.fmt(gvStockTotal / gvSum.avgPerDay)} days cover` : '', 'src=gv&scope=stock')
          ].join('')}</div>
          ${line}
        `, `<a class="btn small" href="#/gvDashboard">🚀 GV Dashboard →</a>`)}
        ${card('🍩 GV Class Mix', donut, `<a class="btn small" href="#/gvTrend">GV Trend →</a>`)}
      </div>`);
    }

    // Combined comparison highlight
    if (ffSum.total || gvSum.total) {
      const cmp = C.bars({
        labels: ['VC4', 'VC20', 'VC5+', 'Commercial', 'Total'],
        height: 220,
        series: [
          { name: 'First Forward', values: [ffSum.vc4, ffSum.vc20, ffSum.vc5p, ffSum.comm, ffSum.total], color: '#6366f1' },
          { name: 'GV Partner', values: [gvSum.vc4, gvSum.vc20, gvSum.vc5p, gvSum.comm, gvSum.total], color: '#0d9488' }
        ],
        legendAlways: true
      });
      cards.push(card(`⚖️ GV vs FF · ${U.labelYM(curKey)} MTD <span class="dim">${esc(f.label)}</span>`, `
        <div class="grid g-2" style="margin-bottom:0">
          <div>${cmp}</div>
          <div>
            <div class="kpi-grid mini" style="grid-template-columns:1fr 1fr">
              ${kpi('g6', 'FF Projected', '🎯', U.fmt(ffSum.projected), `${U.deltaHtml(U.growth(ffSum.projected, M.summary(st.ff, U.prevMonthKey(curKey)).total))} vs last full`, `src=ff&scope=mtd&ym=${curKey}&f=ff`)}
              ${kpi('g6', 'GV Projected', '🎯', U.fmt(gvSum.projected), `${U.deltaHtml(U.growth(gvSum.projected, M.summary(st.gv, U.prevMonthKey(curKey)).total))} vs last full`, `src=gv&scope=mtd&ym=${curKey}`)}
            </div>
            <div style="margin-top:10px">
              <b>Insights:</b>
              <ul class="insight-list">
                <li>GV share <b>${U.fmtPct(U.pctOf(gvSum.total, ffSum.total + gvSum.total), 0)}</b> — FF ${U.fmt(ffSum.total)} vs GV ${U.fmt(gvSum.total)}</li>
                <li>VC4 mix — FF ${U.fmtPct(U.pctOf(ffSum.vc4, ffSum.total), 0)} vs GV ${U.fmtPct(U.pctOf(gvSum.vc4, gvSum.total), 0)}</li>
                ${ffPendingToday ? `<li>🔁 FF issuance T+1 hai — aaj ka FF data kal aayega, isliye aaj FF = <b>0</b> aur GV live dikh raha hai.</li>` : ''}
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
      const curKey2 = curKey;
      const lastKey = U.prevMonthKey(curKey2);
      const badges = [];
      const badge = (emoji, title, name, sub, link) => name ? `<a class="champ" href="${link || '#/performance'}" title="${esc(title)}"><span class="champ-emoji">${emoji}</span><span class="champ-body"><b>${esc(name)}</b><small>${esc(title)}${sub ? ` · ${esc(sub)}` : ''}</small></span></a>` : '';
      const agents = Array.isArray(agentsR) ? agentsR : [];
      const ffCurMap = new Map(), ffLastMap = new Map();
      for (const a of agents) {
        if (a.channel !== 'First Forward') continue;
        if (a.ym === curKey2) ffCurMap.set(a.name, (ffCurMap.get(a.name) || 0) + a.n);
        if (a.ym === lastKey) ffLastMap.set(a.name, (ffLastMap.get(a.name) || 0) + a.n);
      }
      const gvRoll = G.agentRollup ? G.agentRollup(curKey2).filter((a) => !f.tl || FF.filters.nameHit(a.tlName, f.tl)).filter((a) => !f.agent || FF.filters.nameHit(a.agentName, f.agent)) : [];
      const gvLastRoll = G.agentRollup ? G.agentRollup(lastKey) : [];
      const gvLastMap = new Map(gvLastRoll.map((a) => [a.agentName, a.total]));
      const ffTop = [...ffCurMap.entries()].sort((a, b) => b[1] - a[1])[0];
      if (ffTop) badges.push(badge('🥇', 'FF Top Issuer', ffTop[0], `${U.fmt(ffTop[1])} tags · ${U.labelYM(curKey2)}`, '#/performance'));
      if (gvRoll.length) badges.push(badge('👑', 'GV Top Issuer', gvRoll[0].agentName, `${U.fmt(gvRoll[0].total)} tags · ${U.labelYM(curKey2)}`, '#/gvPerformance'));
      const vc4Map = new Map();
      if (Array.isArray(agentClassR)) {
        for (const r of agentClassR) if (r.ym === curKey2 && r.group === 'VC4') vc4Map.set(`FF · ${r.name}`, (vc4Map.get(`FF · ${r.name}`) || 0) + r.n);
      }
      for (const a of gvRoll) if (a.vc4) vc4Map.set(`GV · ${a.agentName}`, (vc4Map.get(`GV · ${a.agentName}`) || 0) + a.vc4);
      const vc4King = [...vc4Map.entries()].sort((a, b) => b[1] - a[1])[0];
      if (vc4King && vc4King[1]) badges.push(badge('🚗', 'VC4 King', vc4King[0], `${U.fmt(vc4King[1])} VC4 tags`, '#/tagIssued'));
      let grower = null;
      for (const [name, cur] of ffCurMap) { const last = ffLastMap.get(name) || 0; if (last >= 10 && cur > last) { const g = ((cur - last) / last) * 100; if (!grower || g > grower.g) grower = { name: `FF · ${name}`, g, cur }; } }
      for (const a of gvRoll) { const last = gvLastMap.get(a.agentName) || 0; if (last >= 10 && a.total > last) { const g = ((a.total - last) / last) * 100; if (!grower || g > grower.g) grower = { name: `GV · ${a.agentName}`, g, cur: a.total }; } }
      if (grower) badges.push(badge('🚀', 'Fastest Grower', grower.name, `+${Math.round(grower.g)}% (${U.fmt(grower.cur)} tags)`, '#/trend'));
      const tlMap = new Map();
      for (const a of agents) if (a.channel === 'First Forward' && a.ym === curKey2 && a.tlName && FF.config.isRealTl(a.tlName)) tlMap.set(a.tlName, (tlMap.get(a.tlName) || 0) + a.n);
      for (const a of gvRoll) if (a.tlName && FF.config.isRealTl(a.tlName) && a.directAgent !== true) tlMap.set(a.tlName, (tlMap.get(a.tlName) || 0) + a.total);
      const topTl = [...tlMap.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topTl) badges.push(badge('🧑‍💼', 'Top TL', topTl[0], `${U.fmt(topTl[1])} tags team`, '#/targets?tab=tl'));
      if (badges.length) {
        cards.push(card(`🏆 Champions of ${esc(U.labelYM(curKey2, true))} <span class="dim">· gamification — FF + GV combined</span>`,
          `<div class="champ-grid">${badges.join('')}</div>
           <p class="dim small">Ye badges live data se bante hain. Kisi bhi champion par click karo → uski poori detail.</p>`,
          `<a class="btn small" href="#/targets?tab=tl">👥 TL rollup →</a>`));
      }
    }

    // Last 14 days trend (filters ke saath)
    if (st.rows.length) {
      const days = [];
      const ffVals = [];
      const gvVals = [];
      const anchor = new Date();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(anchor); d.setDate(d.getDate() - i);
        const key = U.dateKey(d);
        days.push(U.labelDate(d));
        ffVals.push(U.sum(st.ff.filter((r) => r.key === key), (r) => r.n));
        gvVals.push(U.sum(st.gv.filter((r) => r.key === key), (r) => r.n));
      }
      cards.push(card('📈 Last 14 Days Trend <span class="dim">FF (T+1) vs GV (live) · current month</span>', C.lines({
        labels: days,
        height: 230,
        series: [
          { name: 'First Forward', values: ffVals, color: '#6366f1' },
          { name: 'GV Partner', values: gvVals, color: '#0d9488' }
        ]
      }), ''));
    }

    // 📅 memory lane (wowzone) — optional
    if (FF.wowzone) {
      try {
        const memories = await FF.wowzone.memoryLane();
        const memCard = FF.wowzone.memoryLaneCard(memories);
        if (memCard) cards.push(memCard);
      } catch { /* memory lane optional */ }
    }
    if (!root.isConnected) return;

    if (!cards.length) {
      body.innerHTML = `<div class="empty-state">Is filter me koi data nahi mila — 🧭 filter reset karo ya ↻ Refresh dabao.</div>`;
    } else {
      body.innerHTML = `${cards.join('')}<p class="foot-note">Highlights — GV &amp; FF charts ke dwara · ${esc(f.label)} · Data ${U.timeLabel(S.loadedAt || G.loadedAt || Date.now())} · 🟩 GV aaj = GV Master sheet (live) · 🟦 FF aaj = EIR (T+1) · Background me saare sheets preload ho rahe hain</p>`;
    }
    C.mount(body);

    const searchMount = U.$('#home-search', root);
    if (searchMount && FF.masterSearch) { try { FF.masterSearch.mountHome(searchMount); } catch { /* search optional */ } }
    const morningBtn = U.$('#home-morning-card', root);
    if (morningBtn) morningBtn.addEventListener('click', () => { if (FF.morningCard) FF.morningCard.generate(root); });
    updateSync();
    const obs = new MutationObserver(() => { if (!document.body.contains(root)) { clearInterval(syncPoll); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  FF.pages.home = { title: 'Home', render };
})(window.FF);
