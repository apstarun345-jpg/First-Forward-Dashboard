/* Home page: "Hello <name> 👋" greeting, quick stats from both sources, shortcuts and access summary.
   Shown right after login (and the landing page whenever the user has the `home` permission). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;

  const AUDIT = [
    { id: 'dashboard', perm: 'dashboard', icon: '📊', label: 'First Forward · Dashboard', desc: 'KPIs, class mix, VC4 vs Commercial', group: 'First Forward' },
    { id: 'trend', perm: 'trend', icon: '📈', label: 'First Forward · Trend', desc: 'Daily · weekly · monthly trend', group: 'First Forward' },
    { id: 'performance', perm: 'performance', icon: '🏆', label: 'First Forward · Performance', desc: 'Agent & TL performance (REPORT)', group: 'First Forward' },
    { id: 'stock', perm: 'stock', icon: '📦', label: 'First Forward · Stock', desc: 'StockDataa search & pivot', group: 'First Forward' },
    { id: 'gvDashboard', perm: 'gvDashboard', icon: '🚀', label: 'GV Partner Dashboard', desc: 'GV issuance · stock · performance', group: 'GV Partner' },
    { id: 'gvTrend', perm: 'gvTrend', icon: '📈', label: 'GV Trend', desc: 'GV Master daily / monthly trend', group: 'GV Partner' },
    { id: 'gvPerformance', perm: 'gvPerformance', icon: '🏆', label: 'GV Performance', desc: 'GV agent & TL performance', group: 'GV Partner' },
    { id: 'gvStock', perm: 'gvStock', icon: '📦', label: 'GV Stock', desc: 'Tag Assignment stock search', group: 'GV Partner' },
    { id: 'compare', perm: 'compare', icon: '⚖️', label: 'GV vs First Forward', desc: 'Side-by-side comparison', group: 'GV Partner' }
  ];
  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Good night';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }
  const kpi = (cls, title, icon, value, foot) => `<div class="kpi ${cls}"><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  const card = (title, body, right) => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;

  async function render(root) {
    const u = FF.auth.user || {};
    const avatar = u.avatar ? `<img class="home-avatar" src="${esc(u.avatar)}" alt="">` : `<div class="home-avatar mono-logo">${esc((u.name || u.username || 'U').slice(0, 1).toUpperCase())}</div>`;
    const links = AUDIT.filter((a) => FF.auth.can(a.perm));
    const canFf = FF.auth.can('dashboard') || FF.auth.can('trend') || FF.auth.can('stock') || FF.auth.can('performance');
    const canGv = FF.auth.can('gvDashboard') || FF.auth.can('gvTrend') || FF.auth.can('gvStock') || FF.auth.can('gvPerformance');

    root.innerHTML = `<div class="home-hero">
        <div class="home-hero-main">
          ${avatar}
          <div>
            <h1>Hello <span class="home-name">${esc(u.name || u.username || 'there')}</span> 👋</h1>
            <p class="sub">${esc(greeting())}! Aap ${u.role === 'admin' ? '<b>👑 Admin</b>' : 'user'} ho${u.email ? ` · ${esc(u.email)}` : ''}${u.lastLoginAt ? ` · last login ${U.timeLabel(new Date(u.lastLoginAt).getTime())}` : ''}</p>
            <div class="chip-row">${links.slice(0, 6).map((a) => `<a class="chip link" href="#/${a.id}">${a.icon} ${esc(a.label)}</a>`).join('')}</div>
          </div>
        </div>
        <div class="home-hero-side">
          <div class="home-stat"><span class="dim">Data loaded</span><b>${S.loadedAt || G.loadedAt ? U.timeLabel(S.loadedAt || G.loadedAt) : '—'}</b></div>
          <div class="home-stat"><span class="dim">Pages aapke paas</span><b>${links.length}</b></div>
          <button class="btn primary" data-action="refresh">↻ Refresh data</button>
        </div>
      </div>
      <div id="home-body">${U.spinner('Aapka overview ban raha hai…')}</div>`;

    const body = U.$('#home-body', root);
    const [dailyR, stockR, gvMasterR] = await Promise.allSettled([
      canFf ? S.need('daily') : Promise.reject(new Error('skip')),
      canFf ? S.need('stock') : Promise.reject(new Error('skip')),
      canGv ? G.need('master') : Promise.reject(new Error('skip'))
    ]);
    if (!root.isConnected) return;

    const cards = [];
    // ---- First Forward snapshot
    if (dailyR.status === 'fulfilled') {
      const daily = dailyR.value;
      const latest = M.latestDate(daily);
      const cur = latest ? U.ymKey(latest) : null;
      const curS = cur ? M.summary(daily, cur) : null;
      const lastMtd = cur ? M.summary(daily, U.prevMonthKey(cur), curS.lastDay) : null;
      const stock = stockR.status === 'fulfilled' ? stockR.value : null;
      const stockTotal = stock ? U.sum(stock, (r) => r.n) : null;
      const line = cur ? C.lines({ labels: M.dailySeries(daily, cur).days.map(String), height: 190, series: [
        { name: U.labelYM(cur), values: M.dailySeries(daily, cur).totals.map((v, i) => (i < latest.getDate() ? v : null)), color: '#6366f1' },
        { name: U.labelYM(U.prevMonthKey(cur)), values: M.dailySeries(daily, U.prevMonthKey(cur)).totals.slice(0, M.dailySeries(daily, cur).days.length), color: '#c7d2fe', dash: true, area: false }
      ] }) : '';
      cards.push(card('📊 First Forward <span class="dim">· EIR + StockDataa</span>', `
        <div class="kpi-grid mini">${[
          kpi('g2', `MTD · ${U.labelYM(cur)}`, '🏷️', U.fmt(curS.total), `${U.deltaHtml(U.growth(curS.total, lastMtd.total))} vs last month same period`),
          kpi('g3', 'VC4 · MTD', '🚗', U.fmt(curS.vc4), `${U.fmtPct(U.pctOf(curS.vc4, curS.total), 0)} share · Commercial <b>${U.fmt(curS.comm)}</b>`),
          kpi('g9', 'Stock in field', '📦', stockTotal === null ? '—' : U.fmt(stockTotal), 'StockDataa tab')
        ].join('')}</div>${line}`, `<a class="btn small" href="#/dashboard">Dashboard →</a>`));
    } else if (canFf) {
      cards.push(card('📊 First Forward', U.errorBox(dailyR.reason, 'data-action="refresh"')));
    }
    // ---- GV Partner snapshot
    if (gvMasterR.status === 'fulfilled') {
      const latest = G.latestDate();
      const cur = latest ? U.ymKey(latest) : null;
      const curS = cur ? G.summary(cur) : null;
      const lastMtd = cur ? G.summary(U.prevMonthKey(cur), latest.getDate()) : null;
      const stockClass = G.get('stockClass') || [];
      const stockTotal = stockClass.length ? U.sum(stockClass, (r) => r.n) : null;
      const line = cur ? (() => {
        const cs = G.dailySeries(cur), ls = G.dailySeries(U.prevMonthKey(cur));
        return C.lines({ labels: cs.days.map(String), height: 190, series: [
          { name: U.labelYM(cur), values: cs.totals.map((v, i) => (i < latest.getDate() ? v : null)), color: '#0d9488' },
          { name: U.labelYM(U.prevMonthKey(cur)), values: ls.totals.slice(0, cs.days.length), color: '#99f6e4', dash: true, area: false }
        ] });
      })() : '';
      cards.push(card('🚀 GV Partner <span class="dim">· GV Master + Tag Assignment</span>', `
        <div class="kpi-grid mini">${[
          kpi('g2', `MTD · ${U.labelYM(cur)}`, '🏷️', U.fmt(curS.total), `${U.deltaHtml(U.growth(curS.total, lastMtd.total))} vs last month same period`),
          kpi('g3', 'VC4 · MTD', '🚗', U.fmt(curS.vc4), `${U.fmtPct(U.pctOf(curS.vc4, curS.total), 0)} share · Commercial <b>${U.fmt(curS.comm)}</b>`),
          kpi('g9', 'GV stock in field', '📦', stockTotal === null ? '—' : U.fmt(stockTotal), 'Tag Assignment tab')
        ].join('')}</div>${line}`, `<a class="btn small" href="#/gvDashboard">GV dashboard →</a>`));
    } else if (canGv) {
      cards.push(card('🚀 GV Partner', U.errorBox(gvMasterR.reason, 'data-action="refresh"')));
    }
    // ---- shortcuts / access
    const groups = ['First Forward', 'GV Partner'];
    cards.push(card('🔗 Shortcuts', groups.map((g) => {
      const items = AUDIT.filter((a) => a.group === g && FF.auth.can(a.perm));
      if (!items.length) return '';
      return `<div class="home-group"><div class="home-group-title">${esc(g)}</div><div class="home-links">${items.map((a) => `<a class="home-link" href="#/${a.id}"><span class="home-link-icon">${a.icon}</span><span><b>${esc(a.label)}</b><small>${esc(a.desc)}</small></span></a>`).join('')}</div></div>`;
    }).join('') + (FF.auth.can('compare') ? '<div class="home-links"><a class="home-link wide" href="#/compare"><span class="home-link-icon">⚖️</span><span><b>GV vs First Forward</b><small>Dono ka side-by-side comparison — issuance, stock, agents</small></span></a></div>' : ''), ''));
    cards.push(card('🛡️ Aapka access', `<div class="perm-grid">${(FF.auth.permissions || []).map((p) => `<div class="perm ${FF.auth.can(p.key) ? 'yes' : 'no'}"><span>${FF.auth.can(p.key) ? '✅' : '⛔'}</span><b>${esc(p.label)}</b><small class="dim">${esc(p.group)}</small></div>`).join('')}</div>
      ${FF.auth.isAdmin() ? '<p class="dim small">Admin ke paas sab access hai — kaun kya dekh sakta hai wo Settings → Access matrix me set karo.</p>' : '<p class="dim small">Koi cheez chahiye? Admin se permission maango.</p>'}`));

    body.innerHTML = `<div class="grid g-2">${cards.slice(0, 2).join('')}</div>${cards.slice(2).join('')}
      <p class="foot-note">Data sirf ↻ button ya browser reload par update hota hai · Last load ${U.timeLabel(S.loadedAt || G.loadedAt || Date.now())}</p>`;
    C.mount(body);
  }

  FF.pages.home = { title: 'Home', render };
})(window.FF);
