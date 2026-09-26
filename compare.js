/* ⚖️ GV vs First Forward — side-by-side comparison page.
   Left side: First Forward (EIR issuance + StockDataa stock + REPORT performance)
   Right side: GV Partner (GV Master issuance + Tag Assignment stock + GV REPORT performance) */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;

  const kpi = (cls, title, icon, value, foot) => `<div class="kpi ${cls}"><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  const card = (title, body, right) => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const row = (label, ff, gv, note) => {
    const share = (ff + gv) ? (gv / (ff + gv)) * 100 : 0;
    const leader = !ff && !gv ? '<span class="dim">—</span>'
      : ff === gv ? '<span class="badge gray">Tie</span>'
      : (ff > gv ? `<span class="badge indigo">First Forward ${U.fmtPct((ff / (ff + gv)) * 100, 0)}</span>` : `<span class="badge teal">GV ${U.fmtPct(share, 0)}</span>`);
    return `<tr><td>${label}</td><td class="num"><b>${U.fmt(ff)}</b></td><td class="num"><b>${U.fmt(gv)}</b></td><td class="num">${U.fmtPct(share, 1)}</td><td>${leader}</td><td class="dim">${note || ''}</td></tr>`;
  };
  const tableHtml = (header, rows) => `<div class="table-wrap"><table class="tbl compact"><thead><tr>${header.map((h, i) => `<th class="${i >= 1 && i <= 4 ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

  async function render(root) {
    root.innerHTML = `<div class="page-head"><div><h1>⚖️ GV vs First Forward</h1><p class="sub">Dono sources ka comparison — GV Partner (GV Master · Tag Assignment · GV REPORT) vs First Forward (EIR · StockDataa · REPORT)</p></div>
      <div class="head-actions"><a class="btn" href="#/gvDashboard">🚀 GV dashboard</a><a class="btn" href="#/dashboard">📊 FF dashboard</a><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div id="cmp-body">${U.spinner('Dono sources ka data load ho raha hai…')}</div>`;
    const body = U.$('#cmp-body', root);
    if (!FF.auth.user) return;

    const [dailyR, agentsR, stockR, masterR, reportR, gvStockR] = await Promise.allSettled([
      S.need('daily'), S.need('agents'), S.need('stock'), G.need('master'), G.need('report'), G.need('stockClass')
    ]);
    if (!root.isConnected) return;

    const daily = dailyR.status === 'fulfilled' ? dailyR.value : null;
    const agents = agentsR.status === 'fulfilled' ? agentsR.value : [];
    const ffStock = stockR.status === 'fulfilled' ? stockR.value : [];
    const report = reportR.status === 'fulfilled' ? reportR.value : [];
    const gvStockClass = gvStockR.status === 'fulfilled' ? gvStockR.value : [];
    if (!daily && masterR.status !== 'fulfilled') {
      body.innerHTML = U.errorBox(dailyR.reason || masterR.reason, 'data-action="refresh"');
      return;
    }

    const ffLatest = daily ? M.latestDate(daily) : null;
    const gvLatest = masterR.status === 'fulfilled' ? G.latestDate() : null;
    const latest = ffLatest && gvLatest ? (ffLatest > gvLatest ? ffLatest : gvLatest) : (ffLatest || gvLatest);
    const cur = latest ? U.ymKey(latest) : null;
    const last = cur ? U.prevMonthKey(cur) : null;
    const day = latest ? latest.getDate() : 31;

    const ffCur = daily && cur ? M.summary(daily, cur) : null;
    const ffLastMtd = daily && last ? M.summary(daily, last, day) : null;
    const gvCur = masterR.status === 'fulfilled' && cur ? G.summary(cur) : null;
    const gvLastMtd = masterR.status === 'fulfilled' && last ? G.summary(last, day) : null;

    const ffStockTotal = U.sum(ffStock, (r) => r.n);
    const ffStockVc4 = U.sum(ffStock.filter((r) => r.group === 'VC4'), (r) => r.n);
    const gvStockTotal = U.sum(gvStockClass, (r) => r.n);
    const gvStockVc4 = U.sum(gvStockClass.filter((r) => r.group === 'VC4'), (r) => r.n);

    const ffAgentsCur = new Set(agents.filter((a) => a.ym === cur).map((a) => a.key)).size;
    const gvAgentsCur = gvCur ? gvCur.activeAgents : 0;
    const gvToday = (() => { if (!masterR.status || masterR.status !== 'fulfilled' || !latest) return 0; return G.rows().filter((r) => r.day === latest.getDate() && r.ym === cur).length; })();
    const ffToday = daily && latest ? (M.dailySeries(daily, cur).totals[latest.getDate() - 1] || 0) : 0;

    // ---------- KPIs -------------------------------------------------------------------------
    const ffShare = (ffToday + gvToday) ? (gvToday / (ffToday + gvToday)) * 100 : 0;
    const kpis = [
      kpi('g2', `MTD Issuance · ${U.labelYM(cur)}`, '🏷️', `${U.fmt(ffCur ? ffCur.total : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.total : 0)}`, `First Forward vs GV Partner · GV share <b>${U.fmtPct(U.pctOf(gvCur ? gvCur.total : 0, (ffCur ? ffCur.total : 0) + (gvCur ? gvCur.total : 0)), 0)}</b>`),
      kpi('g1', `Today · ${latest ? U.labelDate(latest) : '—'}`, '⚡', `${U.fmt(ffToday)} <small>vs</small> ${U.fmt(gvToday)}`, `GV share of today: <b>${U.fmtPct(ffShare, 0)}</b>`),
      kpi('g3', 'VC4 (Payable) · MTD', '🚗', `${U.fmt(ffCur ? ffCur.vc4 : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.vc4 : 0)}`, `FF share ${U.fmtPct(U.pctOf(ffCur ? ffCur.vc4 : 0, ffCur ? ffCur.total : 0), 0)} · GV share ${U.fmtPct(U.pctOf(gvCur ? gvCur.vc4 : 0, gvCur ? gvCur.total : 0), 0)}`),
      kpi('g4', 'Commercial (NVC4) · MTD', '🚚', `${U.fmt(ffCur ? ffCur.comm : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.comm : 0)}`, `FF share ${U.fmtPct(U.pctOf(ffCur ? ffCur.comm : 0, ffCur ? ffCur.total : 0), 0)} · GV share ${U.fmtPct(U.pctOf(gvCur ? gvCur.comm : 0, gvCur ? gvCur.total : 0), 0)}`),
      kpi('g5', 'Avg / Day · MTD', '📅', `${U.fmt(ffCur ? ffCur.avgPerDay : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.avgPerDay : 0)}`, `FF active days ${ffCur ? ffCur.activeDays : 0} · GV ${gvCur ? gvCur.activeDays : 0}`),
      kpi('g6', `Projected Month-End`, '🎯', `${U.fmt(ffCur ? ffCur.projected : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.projected : 0)}`, `vs last month full: FF ${U.deltaHtml(U.growth(ffCur ? ffCur.projected : 0, ffLastMtd ? M.summary(daily, last).total : 0), { decimals: 0 })} · GV ${U.deltaHtml(U.growth(gvCur ? gvCur.projected : 0, gvLastMtd ? G.summary(last).total : 0), { decimals: 0 })}`),
      kpi('g8', 'Active Agents · MTD', '🧑‍💼', `${U.fmt(ffAgentsCur)} <small>vs</small> ${U.fmt(gvAgentsCur)}`, `Avg tags / agent: FF ${U.fmt(ffAgentsCur ? (ffCur ? ffCur.total : 0) / ffAgentsCur : 0)} · GV ${U.fmt(gvAgentsCur ? (gvCur ? gvCur.total : 0) / gvAgentsCur : 0)}`),
      kpi('g9', 'Stock in Field', '📦', `${U.fmt(ffStockTotal)} <small>vs</small> ${U.fmt(gvStockTotal)}`, `FF VC4 ${U.fmt(ffStockVc4)} (${U.fmtPct(U.pctOf(ffStockVc4, ffStockTotal), 0)}) · GV VC4 ${U.fmt(gvStockVc4)} (${U.fmtPct(U.pctOf(gvStockVc4, gvStockTotal), 0)})`),
      kpi('g12', 'Stock Days Cover', '⏳', `${ffCur && ffCur.avgPerDay ? U.fmt(ffStockTotal / ffCur.avgPerDay) : '—'} <small>vs</small> ${gvCur && gvCur.avgPerDay ? U.fmt(gvStockTotal / gvCur.avgPerDay) : '—'}`, 'Current runrate par kitne din ka stock'),
      kpi('g7', 'Replacements · MTD', '🔁', `${U.fmt(ffCur ? ffCur.replacement : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.replacement : 0)}`, `Share of total: FF ${U.fmtPct(U.pctOf(ffCur ? ffCur.replacement : 0, ffCur ? ffCur.total : 0), 1)} · GV ${U.fmtPct(U.pctOf(gvCur ? gvCur.replacement : 0, gvCur ? gvCur.total : 0), 1)}`),
      kpi('g10', 'GV REPORT · High Priority', '🔺', U.fmt(report.filter((r) => /high/i.test(r.priority)).length), report.length ? `Inactive agents: <b>${U.fmt(report.filter((r) => /inactive/i.test(r.agentStatus)).length)}</b> · Total GV agents in REPORT: ${U.fmt(report.length)}` : 'GV REPORT load nahi hua')
    ];

    // ---------- charts -----------------------------------------------------------------------
    const cmpLine = (() => {
      if (!cur) return '';
      const ffS = daily ? M.dailySeries(daily, cur) : null;
      const gvS = masterR.status === 'fulfilled' ? G.dailySeries(cur) : null;
      if (!ffS && !gvS) return '';
      const labels = ffS ? ffS.days.map(String) : gvS.days.map(String);
      const upto = latest.getDate();
      const series = [];
      if (ffS) series.push({ name: 'First Forward', values: ffS.totals.map((v, i) => (i < upto ? v : null)), color: '#6366f1' });
      if (gvS) series.push({ name: 'GV Partner', values: gvS.totals.map((v, i) => (i < upto ? v : null)), color: '#0d9488' });
      return C.lines({ labels, height: 260, series, tipLabels: labels.map((d) => `Day ${d}`) });
    })();

    const classCompare = (() => {
      const classes = ['VC4', 'VC20', 'VC5+', 'Commercial', 'Total'];
      const ffVals = classes.map((c) => (c === 'Commercial' ? (ffCur ? ffCur.comm : 0) : c === 'Total' ? (ffCur ? ffCur.total : 0) : (ffCur ? (c === 'VC4' ? ffCur.vc4 : c === 'VC20' ? ffCur.vc20 : ffCur.vc5p) : 0)));
      const gvVals = classes.map((c) => (c === 'Commercial' ? (gvCur ? gvCur.comm : 0) : c === 'Total' ? (gvCur ? gvCur.total : 0) : (gvCur ? (c === 'VC4' ? gvCur.vc4 : c === 'VC20' ? gvCur.vc20 : gvCur.vc5p) : 0)));
      return C.bars({ labels: classes, height: 230, series: [{ name: 'First Forward', values: ffVals, color: '#6366f1' }, { name: 'GV Partner', values: gvVals, color: '#0d9488' }], legendAlways: true });
    })();

    const monthlyCompare = (() => {
      const ffMonths = daily ? M.months(daily) : [];
      const gvMonths = masterR.status === 'fulfilled' ? G.months() : [];
      const months = U.uniq([...ffMonths, ...gvMonths]).sort();
      if (!months.length) return '';
      const ffSums = months.map((m) => (daily ? M.summary(daily, m).total : 0));
      const gvSums = months.map((m) => (masterR.status === 'fulfilled' ? G.summary(m).total : 0));
      return C.bars({ labels: months.map((m) => U.labelYM(m)), height: 230, series: [{ name: 'First Forward', values: ffSums, color: '#6366f1' }, { name: 'GV Partner', values: gvSums, color: '#0d9488' }], legendAlways: true });
    })();

    const stockCompare = (() => {
      const ffClasses = U.topEntries(U.groupSum(ffStock, (r) => r.cls, (r) => r.n), 8).map((e) => e[0]);
      const gvClasses = U.topEntries(U.groupSum(gvStockClass, (r) => r.cls, (r) => r.n), 8).map((e) => e[0]);
      const clsNum = (c) => parseInt(String(c).replace(/\D/g, ''), 10) || 999;
      const classes = U.uniq([...ffClasses, ...gvClasses]).sort((a, b) => clsNum(a) - clsNum(b));
      return C.bars({ labels: classes, height: 230, series: [
        { name: 'First Forward stock', values: classes.map((c) => U.sum(ffStock.filter((r) => r.cls === c), (r) => r.n)), color: '#6366f1' },
        { name: 'GV stock', values: classes.map((c) => U.sum(gvStockClass.filter((r) => r.cls === c), (r) => r.n)), color: '#0d9488' }
      ], legendAlways: true });
    })();

    // ---------- tables ----------------------------------------------------------------------
    const totalsRows = [
      row('<b>MTD issuance</b>', ffCur ? ffCur.total : 0, gvCur ? gvCur.total : 0, 'Current month, ' + day + ' din'),
      row('· VC4 (payable)', ffCur ? ffCur.vc4 : 0, gvCur ? gvCur.vc4 : 0, 'VC4 class'),
      row('· VC20', ffCur ? ffCur.vc20 : 0, gvCur ? gvCur.vc20 : 0, 'VC20 class'),
      row('· VC5+', ffCur ? ffCur.vc5p : 0, gvCur ? gvCur.vc5p : 0, 'VC5, VC6, VC7, VC12, VC16'),
      row('· Commercial (NVC4)', ffCur ? ffCur.comm : 0, gvCur ? gvCur.comm : 0, 'VC20 + VC5+'),
      row('Issuance (new)', ffCur ? ffCur.issuance : 0, gvCur ? gvCur.issuance : 0, 'Status = issuance / completed'),
      row('Replacement', ffCur ? ffCur.replacement : 0, gvCur ? gvCur.replacement : 0, 'Replacement tags'),
      row('Last month (full)', daily && last ? M.summary(daily, last).total : 0, masterR.status === 'fulfilled' && last ? G.summary(last).total : 0, U.labelYM(last, true)),
      row('Last month (same period)', ffLastMtd ? ffLastMtd.total : 0, gvLastMtd ? gvLastMtd.total : 0, `day 1-${day}`),
      row('Avg / day (MTD)', ffCur ? ffCur.avgPerDay : 0, gvCur ? gvCur.avgPerDay : 0, 'MTD / days elapsed'),
      row('Projected month-end', ffCur ? ffCur.projected : 0, gvCur ? gvCur.projected : 0, 'Current runrate se'),
      row('Active agents', ffAgentsCur, gvAgentsCur, 'Issuance karte agents'),
      row('<b>Stock in field</b>', ffStockTotal, gvStockTotal, 'StockDataa vs Tag Assignment'),
      row('· VC4 stock', ffStockVc4, gvStockVc4, 'Payable class'),
      row('· Commercial stock', ffStockTotal - ffStockVc4, gvStockTotal - gvStockVc4, 'NVC4 total')
    ];

    const insight = [];
    if (ffCur && gvCur) {
      const gvShare = U.pctOf(gvCur.total, ffCur.total + gvCur.total);
      insight.push(`GV Partner ka MTD share <b>${U.fmtPct(gvShare, 0)}</b> hai (GV ${U.fmt(gvCur.total)} vs FF ${U.fmt(ffCur.total)}).`);
      const ffG = U.growth(ffCur.total, ffLastMtd ? ffLastMtd.total : 0);
      const gvG = U.growth(gvCur.total, gvLastMtd ? gvLastMtd.total : 0);
      if (ffG !== null && gvG !== null) insight.push(`Same period growth — First Forward <b>${U.fmtSigned(ffG, 0)}%</b>, GV Partner <b>${U.fmtSigned(gvG, 0)}%</b>.`);
      const ffVc4Share = U.pctOf(ffCur.vc4, ffCur.total), gvVc4Share = U.pctOf(gvCur.vc4, gvCur.total);
      insight.push(`VC4 mix — FF <b>${U.fmtPct(ffVc4Share, 0)}</b> vs GV <b>${U.fmtPct(gvVc4Share, 0)}</b> (${gvVc4Share > ffVc4Share ? 'GV ka payable mix behtar' : 'FF ka payable mix behtar'}).`);
      const ffCover = ffCur.avgPerDay ? ffStockTotal / ffCur.avgPerDay : 0;
      const gvCover = gvCur.avgPerDay ? gvStockTotal / gvCur.avgPerDay : 0;
      insight.push(`Stock cover — FF <b>${U.fmt(ffCover)} din</b>, GV <b>${U.fmt(gvCover)} din</b> (${gvCover < ffCover ? 'GV ko dispatch jaldi chahiye' : 'FF ko dispatch jaldi chahiye'}).`);
      if (report.length) insight.push(`GV REPORT me <b>${U.fmt(report.filter((r) => /high/i.test(r.priority)).length)}</b> agents high dispatch priority par hain aur <b>${U.fmt(report.filter((r) => /inactive/i.test(r.agentStatus)).length)}</b> inactive hain.`);
    }

    const topFF = U.topEntries(U.groupSum(agents.filter((a) => a.ym === cur), (a) => a.name, (a) => a.n), 8);
    const topGV = (() => { if (masterR.status !== 'fulfilled' || !cur) return []; return G.agentRollup(cur).slice(0, 8).map((a) => [a.agentName, a.total]); })();

    body.innerHTML = `
      <div class="kpi-grid">${kpis.join('')}</div>
      ${card('💡 Insights', `<ul class="insight-list">${insight.map((i) => `<li>${i}</li>`).join('')}</ul>`)}
      <div class="grid g-2">
        ${card(`📈 Daily issuance · ${U.labelYM(cur)} <span class="dim">(FF vs GV)</span>`, cmpLine)}
        ${card(`⚖️ MTD by class · ${U.labelYM(cur)}`, classCompare)}
      </div>
      ${card('🔢 Head-to-head numbers', tableHtml(['Metric', 'First Forward', 'GV Partner', 'GV share', 'Leader', 'Note'], totalsRows), '<a class="btn small" href="#/stock">FF stock →</a> <a class="btn small" href="#/gvStock">GV stock →</a>')}
      <div class="grid g-2">
        ${card('📆 Monthly issuance · FF vs GV', monthlyCompare)}
        ${card('📦 Stock by class · FF vs GV', stockCompare)}
      </div>
      <div class="grid g-2">
        ${card('⭐ Top agents · First Forward (MTD)', C.hbars({ items: topFF.map(([name, v], i) => ({ label: name, value: v, color: C.PALETTE[i % C.PALETTE.length], attr: `data-link="#/performance?q=${encodeURIComponent(name)}"` })), valueLabel: 'MTD' }))}
        ${card('⭐ Top agents · GV Partner (MTD)', C.hbars({ items: topGV.map(([name, v], i) => ({ label: name, value: v, color: C.PALETTE[(i + 4) % C.PALETTE.length], attr: `data-link="#/gvPerformance?q=${encodeURIComponent(name)}"` })), valueLabel: 'MTD' }))}
      </div>
      <p class="foot-note">Sources: First Forward → EIR (issuance), StockDataa (stock), REPORT (performance) · GV Partner → GV Master, Tag Assignment, GV REPORT · Latest date ${latest ? U.labelDate(latest, true) : '—'} · Loaded ${U.timeLabel(S.loadedAt || G.loadedAt)}</p>`;
    C.mount(body);
  }

  FF.pages.compare = { title: 'GV vs First Forward', render };
})(window.FF);
