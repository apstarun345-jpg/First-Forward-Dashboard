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
          <a class="btn" href="#/tagIssued">🏷️ Tag Issued →</a>
        </div>
      </div>
      <div id="home-body">${U.spinner('Highlights load ho rahe hain — GV & FF charts…')}</div>`;

    const body = U.$('#home-body', root);
    const quick = U.$('#home-quick', root);

    // Background: ensure data
    const [dailyR, stockR, gvMasterR, gvStockR] = await Promise.allSettled([
      canFf ? S.need('daily') : Promise.reject(new Error('skip')),
      canFf ? S.need('stock') : Promise.reject(new Error('skip')),
      canGv ? G.need('master') : Promise.reject(new Error('skip')),
      canGv ? G.need('stockClass') : Promise.reject(new Error('skip'))
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

    const cards = [];

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
          gvVals.push(G.rows().filter(r=>r.ym===ym && r.day===day).length);
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

    if (!cards.length) {
      body.innerHTML = `<div class="empty-state">Data load nahi hua — ↻ Refresh dabao</div>`;
    } else {
      body.innerHTML = `${cards.join('')}<p class="foot-note">Highlights — GV & FF charts ke dwara · Data ${U.timeLabel(S.loadedAt||G.loadedAt||Date.now())} · Background me all sheets preload ho rahe hain for instant open</p>`;
    }
    C.mount(body);
    updateSync();
    // cleanup on page leave
    const obs = new MutationObserver(() => { if (!document.body.contains(root)) { clearInterval(syncPoll); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  FF.pages.home = { title: 'Home', render };
})(window.FF);
