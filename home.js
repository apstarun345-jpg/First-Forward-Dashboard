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
    const [dailyR, stockR, gvMasterR, gvStockR, agentsR, agentClassR] = await Promise.allSettled([
      canFf ? S.need('daily') : Promise.reject(new Error('skip')),
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
      for (const a of agents) if (a.channel === 'First Forward' && a.ym === curKey && a.tlName) tlMap.set(a.tlName, (tlMap.get(a.tlName) || 0) + a.n);
      for (const a of gvRoll) if (a.tlName && a.tlName !== 'Direct') tlMap.set(a.tlName, (tlMap.get(a.tlName) || 0) + a.total);
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
