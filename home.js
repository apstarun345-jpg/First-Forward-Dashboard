/* Home page — "GV aaj live" + month KPI cards (EIR) + charts + GV/FF stock.
   • 🟩 GV aaj ka number pehle /api/today (server par GV Master ki chhoti grouped query) se aata hai,
     phir GV Master dataset load hone par usi snapshot se enrich ho jaata hai — bada full-tab download
     kabhi Home ko block nahi karta.
   • 🧾 Saara issuance EIR (First Forward sheet) se: GV channel = master ID 5845036, baaki FF.
     GV ka AAJ ka data EIR me nahi hota (T+1) — isliye aaj sirf GV Master sheet se aata hai.
   • 📦 Stock: FF = StockDataa, GV = Tag Assignment.
   • ❌ Home par master search nahi — Management → Master Search ka alag page hai.
   Sources are always spelled out under every card. */
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
  const kpi = (cls, title, icon, value, foot, spec) => `<div class="kpi ${cls}"${spec ? ` data-kpi="${esc(spec)}"` : ''} data-kpi-title="${esc(title)}" role="button" tabindex="0"><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  const card = (title, body, right) => `<section class="card"><div class="card-head"><div><h3>${title}</h3></div>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const dayKey = (d) => U.dateKey(d);
  const TODAY = () => new Date();
  const todayK = () => dayKey(TODAY());
  const sumN = (rows, fn) => U.sum(rows || [], fn || ((r) => Number(r.n) || 0));
  /** "+12% vs last" (green) / "−8% vs last" (red) — kabhi bhi null ho to "—". */
  const momChip = (cur, last, label) => {
    const g = U.growth(cur, last);
    if (g === null || g === undefined || !Number.isFinite(g)) return `<span class="dim">${esc(label || 'last month')}: ${U.fmt(last || 0)}</span>`;
    return `<span class="dim">${esc(label || 'last month')} <b>${U.fmt(last)}</b></span> · <span class="pct-inline ${g > 0 ? 'pos' : g < 0 ? 'neg' : 'flat'}">${g > 0 ? '▲' : g < 0 ? '▼' : '•'} ${Math.abs(g).toFixed(0)}%</span>`;
  };
  const splitFoot = (ff, gv) => `<span class="hm-split"><span class="ff">🟦 FF <b>${U.fmt(ff)}</b></span><span class="gv">🟩 GV <b>${U.fmt(gv)}</b></span></span>`;

  /** month key + observed day — FF (EIR) T+1 hai, GV live — isliye aaj tak ka din count hota hai. */
  function monthContext(rows) {
    const curKey = U.ymKey(TODAY());
    const prevKey = U.prevMonthKey(curKey);
    const observedDay = Math.max(1, TODAY().getDate());
    const daysInMonth = U.daysInMonth(curKey);
    return { curKey, prevKey, observedDay, daysInMonth };
  }

  /** Convert the small server feed's class totals into month-summary rows until full GV Master loads. */
  function liveRowsFromFeed(live) {
    if (!live) return null;
    const key = live.date || todayK();
    const d = U.fromDateKey(key);
    const classes = live.classes && Object.keys(live.classes).length ? live.classes : {
      VC4: live.vc4 || 0, VC20: live.vc20 || 0, 'VC5+': live.vc5p || 0
    };
    return Object.entries(classes).map(([cls, quantity]) => ({
      key, date: d, d, ym: key.slice(0, 7), day: Number(key.slice(8, 10)) || d.getDate(),
      cls, group: M.classGroup(cls), type: 'ISSUANCE', vrnType: '', channel: 'GV Partner',
      n: Math.max(0, Number(quantity) || 0), live: true, source: 'gv-today-feed'
    })).filter((row) => row.n > 0);
  }
  /** Today's GV Master/live-feed rows replace today's EIR GV rows (never add a partial duplicate). */
  function streams(daily, gvTodayRows, replaceGvToday) {
    let rows = (daily || []).slice();
    const tk = todayK();
    const replace = !!replaceGvToday && Array.isArray(gvTodayRows);
    if (replace) rows = rows.filter((r) => !(r.channel === 'GV Partner' && r.key === tk));
    const added = replace ? gvTodayRows.length : 0;
    if (added) rows.push(...gvTodayRows);
    return {
      rows,
      gvLiveAdded: replace,
      ff: rows.filter((r) => r.channel !== 'GV Partner'),
      gv: rows.filter((r) => r.channel === 'GV Partner')
    };
  }

  // ---------------------------------------------------------------- cards
  function gvLiveHtml(live) {
    const tk = todayK();
    const pace = live.pace;
    const expected = live.expected;
    const sourceNote = live.source === 'master'
      ? 'GV Master sheet (live, abhi load hua)'
      : `GV Master sheet (live${live.stale ? ' · stale fallback' : live.cached ? ' · recent cache' : ''}, server feed)`;
    const cards = [
      kpi('g11', 'Aaj Total (GV live)', '🏷️', U.fmt(live.total),
        `${expected != null ? `expected <b>${U.fmt(expected)}</b> · ` : ''}pace ${pace != null ? U.fmt(pace) : '—'} day-end`,
        `src=gv&scope=day&date=${tk}`),
      kpi('g3', 'VC4', '🚗', U.fmt(live.vc4), live.total ? `${U.fmtPct(U.pctOf(live.vc4, live.total), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc4`),
      kpi('g8', 'VC20', '🛻', U.fmt(live.vc20), live.total ? `${U.fmtPct(U.pctOf(live.vc20, live.total), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc20`),
      kpi('g6', 'VC5+', '🚚', U.fmt(live.vc5p), live.total ? `${U.fmtPct(U.pctOf(live.vc5p, live.total), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc5p`),
      kpi('g5', 'Replacement', '🔁', U.fmt(live.replacement), live.total ? `${U.fmtPct(U.pctOf(live.replacement, live.total), 0)} of today` : '—', `src=gv&scope=day&date=${tk}&f=repl`),
      kpi('g7', 'Chassis', '🔧', U.fmt(live.chassis), live.total ? `${U.fmtPct(U.pctOf(live.chassis, live.total), 0)} of today` : '—', `src=gv&scope=day&date=${tk}&f=chassis`),
      kpi('g2', 'Expected Today', '🎯', expected != null ? U.fmt(expected) : '—',
        live.weekdayNote ? esc(live.weekdayNote) : 'pichhle same-weekday ka average',
        `src=gv&scope=day&date=${tk}`)
    ];
    const errorNote = live.error
      ? `<p class="hm-warn">⚠️ GV live feed error: ${esc(live.error)}. Connection / sheet mapping check karo; GV Master refresh hote hi snapshot update hoga.</p>`
      : '';
    const zeroNote = live.total === 0 && !live.error
      ? `<p class="hm-warn">⚠️ Aaj ki rows abhi GV Master sheet me nahi aayi (ya sirf naye tags bank feed me pending hain) — sheet me aate hi ye number apne aap update ho jayega. ↻ Refresh bhi daba sakte ho.</p>`
      : '';
    return card(`🟩 GV · Aaj ka live <span class="dim">· ${esc(U.labelDate(TODAY(), true))} (${esc(U.weekday(TODAY()))}) · ${esc(sourceNote)}</span>`,
      `<div class="kpi-grid mini gv-aaj-grid">${cards.join('')}</div>
       ${errorNote}${zeroNote}
       <p class="dim small" style="margin:10px 0 0">🎯 <b>Expected Today</b> = pichhle 4 same-weekday ka average (pichhla mahina bhi shaamil)${live.weekdayNote ? ` — ${esc(live.weekdayNote)}` : ''}. ⚡ Pace = ab tak ke tags ÷ ab tak ke ghante × 24. Har card par click → kis agent/TL ne lagaye, tag-level rows.</p>`,
      `<a class="btn small" href="#/gvDashboard">🚀 GV Dashboard →</a>`);
  }

  function monthKpiHtml(ctx, sf, sg, sc, lastRows) {
    const { curKey, prevKey, observedDay, daysInMonth } = ctx;
    const lastSum = M.summary(lastRows, prevKey, observedDay, '');
    const lastFull = M.summary(lastRows, prevKey);
    const lastTotalFull = lastFull.total;
    const rate = observedDay ? sc.total / observedDay : 0;
    const commercialRate = observedDay ? sc.comm / observedDay : 0;
    const expected = Math.round(rate * daysInMonth);
    const expectedCommercial = Math.round(commercialRate * daysInMonth);
    const lastExpected = lastSum.total ? Math.round((lastSum.total / Math.min(observedDay, U.daysInMonth(prevKey))) * U.daysInMonth(prevKey)) : 0;
    // Kal ka issuance (last complete day) + pichhle mahine ka wahi tareekh
    const y = new Date(TODAY()); y.setDate(y.getDate() - 1);
    const yKey = dayKey(y);
    const yDay = y.getDate();
    const lastDayNow = sumN(sf.rows.filter((r) => r.key === yKey));
    const lastDayPrev = sumN(lastRows.filter((r) => r.ym === prevKey && r.day === Math.min(yDay, U.daysInMonth(prevKey))));
    const yFf = sumN(sf.ff.filter((r) => r.key === yKey));
    const yGv = sumN(sf.gv.filter((r) => r.key === yKey));
    const monthLabel = U.labelYM(curKey, true);
    const prevLabel = U.labelYM(prevKey, true);
    const cards = [
      kpi('g9', `Last day · ${U.labelDate(y)}`, '🗓️', U.fmt(lastDayNow),
        `${momChip(lastDayNow, lastDayPrev, `${prevLabel} ${Math.min(yDay, U.daysInMonth(prevKey))}`)}<br>${splitFoot(yFf, yGv)}`,
        `src=both&scope=day&date=${yKey}`),
      kpi('g1', `${monthLabel} total (MTD)`, '🏷️', U.fmt(sc.total),
        `${momChip(sc.total, lastSum.total, `${prevLabel} ${observedDay} din`)}<br>${splitFoot(sf.ff ? M.summary(sf.ff, curKey).total : 0, sf.gv ? M.summary(sf.gv, curKey).total : 0)}`,
        `src=both&scope=mtd&ym=${curKey}`),
      kpi('g3', 'VC4', '🚗', U.fmt(sc.vc4), `${momChip(sc.vc4, lastSum.vc4)}<br>${splitFoot(M.summary(sf.ff, curKey).vc4, M.summary(sf.gv, curKey).vc4)}`, `src=both&scope=mtd&ym=${curKey}&f=vc4`),
      kpi('g8', 'VC20', '🛻', U.fmt(sc.vc20), `${momChip(sc.vc20, lastSum.vc20)}<br>${splitFoot(M.summary(sf.ff, curKey).vc20, M.summary(sf.gv, curKey).vc20)}`, `src=both&scope=mtd&ym=${curKey}&f=vc20`),
      kpi('g6', 'VC5+', '🚚', U.fmt(sc.vc5p), `${momChip(sc.vc5p, lastSum.vc5p)}<br>${splitFoot(M.summary(sf.ff, curKey).vc5p, M.summary(sf.gv, curKey).vc5p)}`, `src=both&scope=mtd&ym=${curKey}&f=vc5p`),
      kpi('g12', 'All Commercial · VC20 + VC5+', '🚛', U.fmt(sc.comm), `${momChip(sc.comm, lastSum.comm, `${prevLabel} · same ${Math.min(observedDay, U.daysInMonth(prevKey))} din`)}<br>Last month full <b>${U.fmt(lastFull.comm)}</b> · Expected this month <b>${U.fmt(expectedCommercial)}</b>`, `src=both&scope=mtd&ym=${curKey}&f=comm`),
      kpi('g5', 'Replacement', '🔁', U.fmt(sc.replacement), `${momChip(sc.replacement, lastSum.replacement)}<br>${splitFoot(M.summary(sf.ff, curKey).replacement, M.summary(sf.gv, curKey).replacement)}`, `src=both&scope=mtd&ym=${curKey}&f=repl`),
      kpi('g7', 'Chassis', '🔧', U.fmt(sc.chassis), `${momChip(sc.chassis, lastSum.chassis)}<br>${splitFoot(M.summary(sf.ff, curKey).chassis, M.summary(sf.gv, curKey).chassis)}`, `src=both&scope=mtd&ym=${curKey}&f=chassis`),
      kpi('g2', `Expected in ${U.labelYM(curKey)}`, '🎯', U.fmt(expected),
        `run-rate <b>${U.fmt(rate, true)}</b>/din · ${observedDay}/${daysInMonth} din<br><span class="dim">last month full <b>${U.fmt(lastTotalFull)}</b> · expected <b>${U.fmt(lastExpected)}</b></span>`,
        `src=both&scope=mtd&ym=${curKey}`)
    ];
    return card(`📅 ${esc(monthLabel)} · KPI cards <span class="dim">· issuance EIR se (GV = master ID ${esc(FF.config.eir.gvMasterId || '5845036')}, baaki FF)${sg.liveToday ? ' · GV aaj GV Master se live' : ''} · har card ke andar last month vs current month + %</span>`,
      `<div class="kpi-grid mini hm-month-grid">${cards.join('')}</div>`,
      `<a class="btn small" href="#/tagIssued?period=month">🏷️ Tag Issued →</a><a class="btn small" href="#/trend">📈 Trend →</a>`);
  }

  // ---------------------------------------------------------------- charts
  function monthCharts(ctx, sf, sc, lastRows, gvLive) {
    const { curKey, prevKey, observedDay } = ctx;
    const cur = M.dailySeries(sf.rows, curKey);
    const prev = M.dailySeries(lastRows, prevKey);
    const labels = cur.days.length ? cur.days.map(String) : ['1'];
    const curVals = cur.totals;
    const prevVals = prev.totals.slice(0, labels.length);
    const line = C.lines({
      labels,
      height: 230,
      series: [
        { name: `${U.labelYM(curKey)} (is mahine)`, values: curVals, color: '#6366f1' },
        { name: `${U.labelYM(prevKey)} (last month)`, values: prevVals, color: '#c7d2fe', dash: true, area: false }
      ]
    });
    const lastSum = M.summary(lastRows, prevKey, observedDay, '');
    const cmp = C.bars({
      labels: ['VC4', 'VC20', 'VC5+', 'Replacement', 'Chassis'],
      height: 210,
      series: [
        { name: U.labelYM(curKey), values: [sc.vc4, sc.vc20, sc.vc5p, sc.replacement, sc.chassis], color: '#6366f1' },
        { name: `${U.labelYM(prevKey)} (till day ${observedDay})`, values: [lastSum.vc4, lastSum.vc20, lastSum.vc5p, lastSum.replacement, lastSum.chassis], color: '#0d9488' }
      ],
      legendAlways: true
    });
    const donut = C.donut({ items: [{ label: 'VC4', value: sc.vc4 }, { label: 'VC20', value: sc.vc20 }, { label: 'VC5+', value: sc.vc5p }], subtitle: U.labelYM(curKey, true) });
    // same-weekday run-rate (GV) — Expected Today ka basis
    const wdSeries = gvLive && gvLive.weekdayBars ? gvLive.weekdayBars : null;
    const wdChart = wdSeries && wdSeries.labels.length
      ? C.bars({ labels: wdSeries.labels, height: 190, series: [{ name: 'GV same-weekday', values: wdSeries.values, color: '#0d9488' }] })
      : '';
    return `<div class="grid g-2">
        ${card(`📈 ${esc(U.labelYM(curKey, true))} vs ${esc(U.labelYM(prevKey, true))} <span class="dim">· daily issuance (FF + GV, EIR)</span>`, line, '')}
        ${card('🍩 Class mix (MTD)', donut, '')}
      </div>
      <div class="grid g-2">
        ${card('📊 Month-to-date · last vs current', cmp, '')}
        ${wdChart ? card(`🎯 GV same-weekday run-rate <span class="dim">· Expected Today isi se</span>`, wdChart, '') : ''}
      </div>`;
  }

  function stockHtml(ffStock, gvStock, sf) {
    const ff = ffStock || { total: 0, vc4: 0, comm: 0, rows: [] };
    const gv = gvStock || { total: 0, vc4: 0, comm: 0, rows: [] };
    const ffRate = M.summary(sf.ff, U.ymKey(TODAY())).avgPerDay || 0;
    const gvRate = M.summary(sf.gv, U.ymKey(TODAY())).avgPerDay || 0;
    const cover = (total, rate) => (rate > 0 ? U.fmt(total / rate, true) : '—');
    const bars = C.bars({
      labels: ['VC4', 'Commercial'],
      height: 190,
      series: [
        { name: 'First Forward · StockDataa', values: [ff.vc4, ff.comm], color: '#6366f1' },
        { name: 'GV Partner · Tag Assignment', values: [gv.vc4, gv.comm], color: '#0d9488' }
      ],
      legendAlways: true
    });
    const ffDonut = C.donut({ items: [{ label: 'VC4', value: ff.vc4 }, { label: 'Commercial', value: ff.comm }], subtitle: 'FF stock' });
    const gvDonut = C.donut({ items: [{ label: 'VC4', value: gv.vc4 }, { label: 'Commercial', value: gv.comm }], subtitle: 'GV stock' });
    const topList = (rows, cls) => {
      const list = (rows || []).slice(0, 5);
      if (!list.length) return '<p class="dim small">Koi stock row nahi mili.</p>';
      return `<div class="hm-toplist">${list.map((r, i) => `<div class="hm-toprow"><span class="rank">${i + 1}</span><b>${esc(r.name)}</b><span class="tag ${cls}">${cls === 'gv' ? 'GV' : 'FF'}</span><strong>${U.fmt(r.n)}</strong></div>`).join('')}</div>`;
    };
    return `<div class="kpi-grid mini hm-stock-grid">
        ${kpi('g1', 'First Forward · Stock in field', '📦', U.fmt(ff.total), `VC4 <b>${U.fmt(ff.vc4)}</b> · Comm <b>${U.fmt(ff.comm)}</b> · cover <b>${esc(cover(ff.total, ffRate))}</b> din`, 'src=ff&scope=stock')}
        ${kpi('g2', 'GV Partner · Stock in field', '📦', U.fmt(gv.total), `VC4 <b>${U.fmt(gv.vc4)}</b> · Comm <b>${U.fmt(gv.comm)}</b> · cover <b>${esc(cover(gv.total, gvRate))}</b> din`, 'src=gv&scope=stock')}
      </div>
      <div class="grid g-2" style="margin-top:12px">
        ${card('📊 Stock · FF vs GV <span class="dim">(class-wise)</span>', bars, '')}
        ${card('🍩 Stock split', `<div class="hm-donuts">${ffDonut}${gvDonut}</div>`, '')}
      </div>
      <div class="grid g-2">
        ${card('🟦 First Forward · top stock holders <span class="dim">· StockDataa</span>', topList(ff.rows, 'ff'), '<a class="btn small" href="#/stock">📦 Stock →</a>')}
        ${card('🟩 GV Partner · top stock holders <span class="dim">· Tag Assignment</span>', topList(gv.rows, 'gv'), '<a class="btn small" href="#/gvStock">📦 GV Stock →</a>')}
      </div>`;
  }

  // ---------------------------------------------------------------- render
  async function render(root) {
    const u = FF.auth.user || {};
    const avatar = u.avatar ? `<img class="home-avatar" src="${esc(u.avatar)}" alt="">` : `<div class="home-avatar mono-logo">${esc((u.name || u.username || 'U').slice(0, 1).toUpperCase())}</div>`;
    const canFf = FF.auth.can('dashboard') || FF.auth.can('trend') || FF.auth.can('stock') || FF.auth.can('performance');
    const canGv = FF.auth.can('gvDashboard') || FF.auth.can('gvTrend') || FF.auth.can('gvStock') || FF.auth.can('gvPerformance');

    root.innerHTML = `<div class="home-hero v2">
        <div class="home-hero-main">
          ${avatar}
          <div>
            <h1>${esc(greeting())}, <span class="home-name">${esc(u.name || u.username || 'there')}</span> 👋</h1>
            <p class="sub">GV ka aaj ka live data · ${esc(U.labelYM(U.ymKey(TODAY()), true))} ke KPI cards · charts · GV &amp; FF stock</p>
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
      <div id="home-gv-live">${U.spinner('GV aaj ka live data aaya ja raha hai…')}</div>
      <div id="home-month">${U.spinner('EIR se month KPI cards ban rahe hain…')}</div>
      <div id="home-charts">${U.spinner('Charts…')}</div>
      <div id="home-stock">${U.spinner('Stock (StockDataa + Tag Assignment)…')}</div>
      <p class="foot-note">🟩 GV aaj = <b>GV Master sheet</b> (live) · 🧾 Issuance history = <b>EIR</b> (GV = master ID ${esc(FF.config.eir.gvMasterId || '5845036')}, baaki FF) · 📦 Stock = <b>StockDataa</b> (FF) + <b>Tag Assignment</b> (GV) · 🟦 FF ka issuance T+1 aata hai · Master search ab Management → 🔎 Master Search me hai.</p>`;

    const quick = U.$('#home-quick', root);
    if (quick) quick.innerHTML = `<div class="chip-row"><span class="chip on">🟩 GV aaj · GV Master (live)</span><span class="chip">🧾 EIR: FF + GV history</span><span class="chip dim">📦 Stock: StockDataa + Tag Assignment</span></div>`;

    const gvLiveMount = U.$('#home-gv-live', root);
    const monthMount = U.$('#home-month', root);
    const chartMount = U.$('#home-charts', root);
    const stockMount = U.$('#home-stock', root);

    // ⚡ Home first paint: GV-only today endpoint is intentionally separate from the heavier
    // FF+GV history feed. This makes "AAJ KA LIVE" visible even when 30-day history is slow.
    const liveP = canGv
      ? FF.data.gvToday().catch((err) => ({ requestError: err && err.message ? err.message : 'GV today feed request failed' }))
      : Promise.resolve(null);
    const feedP = (canFf || canGv)
      ? FF.data.today().catch((err) => ({ requestError: err && err.message ? err.message : 'today feed request failed' }))
      : Promise.resolve(null);
    const dailyP = (canFf || canGv) ? S.need('daily').catch(() => null) : Promise.resolve(null);
    const stockP = canFf ? S.need('stock').catch(() => null) : Promise.resolve(null);
    const gvStockP = canGv ? G.need('stockClass').catch(() => null) : Promise.resolve(null);
    const gvMasterP = canGv ? G.need('master').catch(() => null) : Promise.resolve(null);

    // Repaint kit (GV Master load hone par month cards dobara banti hain — aaj ke live rows ke saath).
    const ui = { ready: false, sf: null, ctx: null, sc: null, wdBars: null, liveToday: false };
    let liveFromFeed = null;
    let feedLiveRows = [];
    let liveRows = [];
    let liveSourceReady = false;

    let liveState = {
      total: 0, vc4: 0, vc20: 0, vc5p: 0, replacement: 0, chassis: 0,
      expected: null, pace: null, cached: false, stale: false,
      error: canGv ? 'GV aaj ka live data aa raha hai…' : '',
      source: 'feed', liveToday: false
    };

    let wdBars = null;
    const hoursGone = Math.max(1, (Date.now() - new Date().setHours(0, 0, 0, 0)) / 3600000);

    function applyHistoryFeed(feed) {
      if (!feed) return;
      const historyLive = feed.gv || null;
      if (historyLive && !liveFromFeed) {
        liveFromFeed = { ...historyLive, cached: !!(historyLive.cached || feed.cached), stale: !!historyLive.stale };
        feedLiveRows = liveRowsFromFeed(liveFromFeed);
        if (!liveSourceReady) liveRows = feedLiveRows || [];
      }
      const series = (historyLive && historyLive.series) || {};
      const tk = todayK(), wd = TODAY().getDay();
      const keys = Object.keys(series).filter((k) => k < tk).sort().reverse()
        .filter((k) => U.fromDateKey(k).getDay() === wd).slice(0, 4).reverse();
      wdBars = keys.length ? { labels: keys.map((k) => U.labelDateKey(k)), values: keys.map((k) => series[k]) } : null;
      ui.wdBars = wdBars;
      if (historyLive) {
        liveState = {
          ...liveState,
          expected: historyLive.expected != null ? historyLive.expected : liveState.expected,
          cached: !!(historyLive.cached || feed.cached),
          stale: !!historyLive.stale,
          error: historyLive.total === undefined ? liveState.error : ''
        };
      }
      paintLive();
      if (ui.ready && liveRows.length) {
        const st2 = streams(ui.sf.rows, liveRows, liveSourceReady);
        ui.sf = { rows: st2.rows, ff: st2.ff, gv: st2.gv };
        ui.sc = M.summary(st2.rows, ui.ctx.curKey);
        ui.liveToday = st2.gvLiveAdded;
        paintMonth();
        paintCharts();
      }
    }

    function paintLive() {
      if (!gvLiveMount || !gvLiveMount.isConnected) return;
      const pace = liveState.total > 0 ? Math.round((liveState.total / hoursGone) * 24) : null;
      liveState.pace = pace;
      const wdNote = wdBars ? `pichhle ${wdBars.labels.length} same-weekday (${wdBars.labels.map((l) => `${l} = ${U.fmt(wdBars.values[wdBars.labels.indexOf(l)])}`).join(' · ')}) ka average` : '';
      gvLiveMount.innerHTML = gvLiveHtml({ ...liveState, pace, weekdayNote: wdNote, weekdayBars: wdBars });
    }
    // 🧩 Merge fix: yeh teen painter main me call hote the par define nahi the (Home render
    //    ReferenceError: paintMonth is not defined → poore KPI cards gayab). Base v3.47 se wapas.
    function paintMonth() {
      if (!monthMount || !monthMount.isConnected || !ui.ready) return;
      monthMount.innerHTML = monthKpiHtml(ui.ctx, ui.sf, { liveToday: ui.liveToday }, ui.sc, ui.sf.rows);
    }
    function paintCharts() {
      if (!chartMount || !chartMount.isConnected || !ui.ready) return;
      chartMount.innerHTML = monthCharts(ui.ctx, ui.sf, ui.sc, ui.sf.rows, { weekdayBars: ui.wdBars });
      C.mount(chartMount);
    }
    function paintAll() { paintLive(); paintMonth(); paintCharts(); }

    // 🟢 First visible live source: only GV Master + today, no FF/history wait.
    paintLive();
    liveP.then((quick) => {
      if (!quick || !quick.gv) {
        liveState = { ...liveState, error: quick && quick.requestError ? quick.requestError : 'GV today live feed unavailable.' };
        paintLive();
        return;
      }
      liveFromFeed = { ...quick.gv, cached: !!(quick.gv.cached || quick.cached), stale: !!quick.gv.stale };
      feedLiveRows = liveRowsFromFeed(liveFromFeed);
      liveRows = feedLiveRows || [];
      liveSourceReady = true;
      liveState = {
        ...liveState,
        total: Number(liveFromFeed.total) || 0,
        vc4: Number(liveFromFeed.vc4) || 0,
        vc20: Number(liveFromFeed.vc20) || 0,
        vc5p: Number(liveFromFeed.vc5p) || 0,
        replacement: Number(liveFromFeed.replacement) || 0,
        chassis: Number(liveFromFeed.chassis) || 0,
        expected: liveFromFeed.expected ?? null,
        cached: !!liveFromFeed.cached,
        stale: !!liveFromFeed.stale,
        error: '',
        source: 'feed', liveToday: true
      };
      paintLive();
      if (ui.ready) {
        const st2 = streams(ui.sf.rows, liveRows, true);
        ui.sf = { rows: st2.rows, ff: st2.ff, gv: st2.gv };
        ui.sc = M.summary(st2.rows, ui.ctx.curKey);
        ui.liveToday = true;
        paintMonth();
        paintCharts();
      }
    }).catch((err) => {
      liveState = { ...liveState, error: err && err.message ? err.message : 'GV today feed failed.' };
      paintLive();
    });

    // 30-day history is background only — it supplies Expected Today / same-weekday bars and
    // must never delay the initial GV live card.
    feedP.then(applyHistoryFeed).catch(() => {});

    // GV Master load hone par usi snapshot se aaj ka poora detail (replacement/chassis/agent-wise)
    gvMasterP.then((ok) => {
      const masterError = (G.error && G.error('master')) || '';
      if (!ok || masterError || !G.gvToday) {
        if (!liveFromFeed && canGv) liveState = { ...liveState, error: masterError || 'GV Master sheet load failed.' };
        paintLive();
        return;
      }
      const snap = G.gvToday();
      if (!snap || !snap.loaded) {
        if (!liveFromFeed && canGv) liveState = { ...liveState, error: 'GV Master snapshot load nahi hua.' };
        paintLive();
        return;
      }
      // Incomplete client snapshot ko server ke full live total par prefer na karo.
      // Server class totals interim month rows ke liye kaam karte hain; full Master replaces them here.
      const feedTotal = liveFromFeed ? Number(liveFromFeed.total) || 0 : 0;
      const useSnap = snap.total >= feedTotal || !liveFromFeed;
      liveRows = useSnap ? (snap.rows || []) : (feedLiveRows || []);
      liveSourceReady = true;
      liveState = useSnap ? {
        ...liveState,
        total: snap.total, vc4: snap.vc4, vc20: snap.vc20, vc5p: snap.vc5p,
        replacement: snap.replacement, chassis: snap.chassis,
        error: '', stale: false, source: 'master', liveToday: true
      } : { ...liveState, error: '', liveToday: true };
      if (ui.ready) {
        // `st` is the already-built stream object, so pass its rows (not the wrapper) back in.
        const st2 = streams(st.rows, liveRows, liveSourceReady);
        ui.sf = { rows: st2.rows, ff: st2.ff, gv: st2.gv };
        ui.sc = M.summary(st2.rows, ui.ctx.curKey);
        ui.liveToday = st2.gvLiveAdded;
        paintAll();
      } else paintLive();
    }).catch((err) => {
      if (!liveFromFeed && canGv) liveState = { ...liveState, error: err && err.message ? err.message : 'GV Master load failed.' };
      paintLive();
    });

    const daily = await dailyP;
    if (!root.isConnected) return;
    const st = streams(daily || [], liveRows, liveSourceReady);
    const ctx = monthContext(st.rows);
    const sf = { rows: st.rows, ff: st.ff, gv: st.gv };
    const sc = M.summary(st.rows, ctx.curKey);
    ui.ready = true; ui.sf = sf; ui.ctx = ctx; ui.sc = sc; ui.liveToday = st.gvLiveAdded;
    paintMonth();
    paintCharts();
    if (!st.rows.length) {
      if (chartMount) chartMount.innerHTML = `<div class="card"><div class="card-body empty">Is mahine ka koi issuance row nahi mila — ↻ Refresh dabao ya Settings → Data source check karo.</div></div>`;
    }

    // ---- 📦 Stock (FF = StockDataa · GV = Tag Assignment) ----------------------------------------
    const [stockR, gvStockR] = await Promise.all([stockP, gvStockP]);
    if (!root.isConnected || !stockMount) return;
    const ffStockRows = stockR ? (F() ? F().stock(stockR, { src: 'ff' }) : stockR) : [];
    const ffStock = {
      total: sumN(ffStockRows),
      vc4: sumN(ffStockRows.filter((r) => r.group === 'VC4')),
      comm: sumN(ffStockRows.filter((r) => r.group !== 'VC4')),
      rows: (() => {
        const byTl = new Map();
        for (const r of ffStockRows) byTl.set(r.tlName || '—', (byTl.get(r.tlName || '—') || 0) + (Number(r.n) || 0));
        return [...byTl.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
      })()
    };
    const gvStockRows = gvStockR || [];
    const gvStock = {
      total: sumN(gvStockRows),
      vc4: sumN(gvStockRows.filter((r) => r.group === 'VC4')),
      comm: sumN(gvStockRows.filter((r) => r.group !== 'VC4')),
      rows: []
    };
    stockMount.innerHTML = stockHtml(ffStock, gvStock, sf);
    // GV agent-wise stock (agar permission/load ho to) — top holders
    if (canGv) {
      G.need('stockAgent').then((rows) => {
        if (!rows || !stockMount.isConnected) return;
        const top = [...rows].sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, 5).map((r) => ({ name: r.agentName || r.agentId || '—', n: r.n }));
        const host = stockMount.querySelectorAll('.hm-toplist')[1];
        if (host && top.length) host.innerHTML = top.map((r, i) => `<div class="hm-toprow"><span class="rank">${i + 1}</span><b>${esc(r.name)}</b><span class="tag gv">GV</span><strong>${U.fmt(r.n)}</strong></div>`).join('');
      }).catch(() => {});
    }

    const morningBtn = U.$('#home-morning-card', root);
    if (morningBtn) morningBtn.addEventListener('click', () => { if (FF.morningCard) FF.morningCard.generate(root); });

    // Sync pill — chhota live status
    const syncPoll = setInterval(() => {
      const el = U.$('#home-sync', root);
      const loaded = U.$('#home-loaded', root);
      if (!root.isConnected) { clearInterval(syncPoll); return; }
      if (loaded) loaded.textContent = U.timeLabel(S.loadedAt || G.loadedAt || Date.now());
      if (!el) return;
      if (FF.preloader && FF.preloader.done) { el.textContent = 'All sheets ready ✓'; el.className = 'sync-fast'; }
      else if (FF.preloader && FF.preloader.running) { const p = FF.preloader.state.progress; el.textContent = `Preloading ${p.loaded}/${p.total}…`; }
      else if (FF.preloader && FF.preloader.state.errors.length) { el.textContent = 'Some sheets unavailable · retry ↻'; }
      else el.textContent = 'Background sync…';
    }, 2500);
    const obs = new MutationObserver(() => { if (!document.body.contains(root)) { clearInterval(syncPoll); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  FF.pages.home = { title: 'Home', render, monthKpiHtml, streams, liveRowsFromFeed };
})(window.FF);
