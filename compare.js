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

  async function render(root, params) {
    root.innerHTML = `<div class="page-head"><div><h1>⚖️ GV vs First Forward</h1><p class="sub">Dono sources ka comparison — GV Partner (GV Master · Tag Assignment · GV REPORT) vs First Forward (EIR · StockDataa · REPORT). FF side me GV master ID <b>${esc(FF.config.eir.gvMasterId || '5845036')}</b> pehle exclude hota hai.</p></div>
      <div class="head-actions"><a class="btn" href="#/gvDashboard">🚀 GV dashboard</a><a class="btn" href="#/dashboard">📊 FF dashboard</a><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div class="card controls" id="cmp-controls"><span class="dim small">📅 Month range load ho rahi hai…</span></div>
      <div id="cmp-body">${U.spinner('Dono sources ka data load ho raha hai…')}</div>`;
    const body = U.$('#cmp-body', root);
    if (!FF.auth.user) return;

    const [dailyR, agentsR, stockR, masterR, reportR, gvStockR] = await Promise.allSettled([
      S.need('daily'), S.need('agents'), S.need('stock'), G.need('master'), G.need('report'), G.need('stockClass')
    ]);
    if (!root.isConnected) return;

    const daily = dailyR.status === 'fulfilled' ? dailyR.value : null;
    // EIR contains both streams.  5845036 is the GV master ID in the FF EIR, so the
    // comparison must use only rows classified as First Forward; otherwise GV is counted twice.
    const ffDaily = daily ? daily.filter((r) => r.channel !== 'GV Partner') : null;
    const agents = agentsR.status === 'fulfilled' ? agentsR.value : [];
    const ffAgents = agents.filter((a) => a.channel !== 'GV Partner');
    const ffStock = stockR.status === 'fulfilled' ? stockR.value : [];
    const report = reportR.status === 'fulfilled' ? reportR.value : [];
    const gvStockClass = gvStockR.status === 'fulfilled' ? gvStockR.value : [];
    if (!daily && masterR.status !== 'fulfilled') {
      body.innerHTML = U.errorBox(dailyR.reason || masterR.reason, 'data-action="refresh"');
      return;
    }

    const ffLatest = ffDaily ? M.latestDate(ffDaily) : null;
    const gvLatest = masterR.status === 'fulfilled' ? G.latestDate() : null;
    const latest = ffLatest && gvLatest ? (ffLatest > gvLatest ? ffLatest : gvLatest) : (ffLatest || gvLatest);
    const latestYM = latest ? U.ymKey(latest) : null;
    // ---- 📅 month range picker: koi bhi do months choose karke compare karo ----
    const months = U.uniq([...(ffDaily ? M.months(ffDaily) : []), ...(masterR.status === 'fulfilled' ? G.months() : [])]).sort();
    const cur = months.includes(params.monthA) ? params.monthA : latestYM; // Month A (main)
    const last = months.includes(params.monthB) ? params.monthB : (cur ? U.prevMonthKey(cur) : null); // Month B (compare)
    const isCurrent = !!cur && cur === latestYM;
    const day = isCurrent && latest ? latest.getDate() : (cur ? U.daysInMonth(cur) : 31);
    const controls = U.$('#cmp-controls', root);
    if (controls) {
      const opt = (sel) => months.slice().reverse().map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${U.labelYM(m, true)}</option>`).join('');
      controls.innerHTML = months.length ? `<div class="ctrl-row"><label>📅 Month A <select class="input" id="cmp-a">${opt(cur)}</select></label><span class="dim">vs</span><label>Month B <select class="input" id="cmp-b">${opt(last)}</select></label><button class="btn small" id="cmp-swap">⇄ Swap</button><span class="dim small">${isCurrent ? 'Month A current month hai → MTD numbers dikhte hain' : 'Dono selected months ke full numbers compare ho rahe hain'}</span></div>` : '<span class="dim small">Koi month data nahi mila.</span>';
      if (months.length) {
        const reload = () => FF.app.navigate('compare', { monthA: U.$('#cmp-a', controls).value, monthB: U.$('#cmp-b', controls).value });
        U.$('#cmp-a', controls).addEventListener('change', reload);
        U.$('#cmp-b', controls).addEventListener('change', reload);
        U.$('#cmp-swap', controls).addEventListener('click', () => FF.app.navigate('compare', { monthA: last, monthB: cur }));
      }
    }

    const ffCur = ffDaily && cur ? M.summary(ffDaily, cur) : null;
    const ffLastMtd = ffDaily && last ? M.summary(ffDaily, last, day) : null;
    const gvCur = masterR.status === 'fulfilled' && cur ? G.summary(cur) : null;
    const gvLastMtd = masterR.status === 'fulfilled' && last ? G.summary(last, day) : null;

    const ffStockTotal = U.sum(ffStock, (r) => r.n);
    const ffStockVc4 = U.sum(ffStock.filter((r) => r.group === 'VC4'), (r) => r.n);
    const gvStockTotal = U.sum(gvStockClass, (r) => r.n);
    const gvStockVc4 = U.sum(gvStockClass.filter((r) => r.group === 'VC4'), (r) => r.n);

    const ffAgentsCur = new Set(ffAgents.filter((a) => a.ym === cur).map((a) => a.key)).size;
    const gvAgentsCur = gvCur ? gvCur.activeAgents : 0;
    const gvToday = (() => { if (!isCurrent || !masterR.status || masterR.status !== 'fulfilled' || !latest) return null; return G.rows().filter((r) => r.day === latest.getDate() && r.ym === cur).length; })();
    const ffToday = isCurrent && ffDaily && latest ? (M.dailySeries(ffDaily, cur).totals[latest.getDate() - 1] || 0) : null;

    // ---------- KPIs -------------------------------------------------------------------------
    const ffShare = ffToday !== null && gvToday !== null && (ffToday + gvToday) ? (gvToday / (ffToday + gvToday)) * 100 : 0;
    // v3.8.3: KPI cards ab vivid + clickable hain — click karo to full FF-vs-GV data dialog khulta hai.
    const LBL = {
      issuance: `${isCurrent ? 'MTD Issuance' : 'Issuance'} · ${U.labelYM(cur)}`,
      today: isCurrent ? `Today · ${latest ? U.labelDate(latest) : '—'}` : 'Latest day',
      vc4: `VC4 (Payable) · ${U.labelYM(cur)}`,
      comm: `Commercial (NVC4) · ${U.labelYM(cur)}`,
      avg: `Avg / Day · ${U.labelYM(cur)}`,
      proj: isCurrent ? 'Projected Month-End' : `Full Month · ${U.labelYM(cur)}`,
      agents: `Active Agents · ${U.labelYM(cur)}`,
      stock: 'Stock in Field',
      cover: 'Stock Days Cover',
      repl: `Replacements · ${U.labelYM(cur)}`,
      high: 'GV REPORT · High Priority'
    };
    const kpiDefs = [
      { tone: 'g2', icon: '🏷️', label: LBL.issuance, value: `${U.fmt(ffCur ? ffCur.total : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.total : 0)}`, foot: `First Forward vs GV Partner · GV share <b>${U.fmtPct(U.pctOf(gvCur ? gvCur.total : 0, (ffCur ? ffCur.total : 0) + (gvCur ? gvCur.total : 0)), 0)}</b>` },
      { tone: 'g1', icon: '⚡', label: LBL.today, value: ffToday === null || gvToday === null ? '<span class="dim">— (sirf current month ke liye)</span>' : `${U.fmt(ffToday)} <small>vs</small> ${U.fmt(gvToday)}`, foot: isCurrent ? `GV share of today: <b>${U.fmtPct(ffShare, 0)}</b>` : 'Month A current nahi hai — upar se current month chuno' },
      { tone: 'g3', icon: '🚗', label: LBL.vc4, value: `${U.fmt(ffCur ? ffCur.vc4 : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.vc4 : 0)}`, foot: `FF share ${U.fmtPct(U.pctOf(ffCur ? ffCur.vc4 : 0, ffCur ? ffCur.total : 0), 0)} · GV share ${U.fmtPct(U.pctOf(gvCur ? gvCur.vc4 : 0, gvCur ? gvCur.total : 0), 0)}` },
      { tone: 'g4', icon: '🚚', label: LBL.comm, value: `${U.fmt(ffCur ? ffCur.comm : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.comm : 0)}`, foot: `FF share ${U.fmtPct(U.pctOf(ffCur ? ffCur.comm : 0, ffCur ? ffCur.total : 0), 0)} · GV share ${U.fmtPct(U.pctOf(gvCur ? gvCur.comm : 0, gvCur ? gvCur.total : 0), 0)}` },
      { tone: 'g5', icon: '📅', label: LBL.avg, value: `${U.fmt(ffCur ? ffCur.avgPerDay : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.avgPerDay : 0)}`, foot: `FF active days ${ffCur ? ffCur.activeDays : 0} · GV ${gvCur ? gvCur.activeDays : 0}` },
      { tone: 'g6', icon: '🎯', label: LBL.proj, value: `${U.fmt(ffCur ? (isCurrent ? ffCur.projected : ffCur.total) : 0)} <small>vs</small> ${U.fmt(gvCur ? (isCurrent ? gvCur.projected : gvCur.total) : 0)}`, foot: `vs ${U.labelYM(last)} full: FF ${U.deltaHtml(U.growth(ffCur ? (isCurrent ? ffCur.projected : ffCur.total) : 0, ffLastMtd ? M.summary(ffDaily, last).total : 0), { decimals: 0 })} · GV ${U.deltaHtml(U.growth(gvCur ? (isCurrent ? gvCur.projected : gvCur.total) : 0, gvLastMtd ? G.summary(last).total : 0), { decimals: 0 })}` },
      { tone: 'g8', icon: '🧑‍💼', label: LBL.agents, value: `${U.fmt(ffAgentsCur)} <small>vs</small> ${U.fmt(gvAgentsCur)}`, foot: `Avg tags / agent: FF ${U.fmt(ffAgentsCur ? (ffCur ? ffCur.total : 0) / ffAgentsCur : 0)} · GV ${U.fmt(gvAgentsCur ? (gvCur ? gvCur.total : 0) / gvAgentsCur : 0)}` },
      { tone: 'g9', icon: '📦', label: LBL.stock, value: `${U.fmt(ffStockTotal)} <small>vs</small> ${U.fmt(gvStockTotal)}`, foot: `FF VC4 ${U.fmt(ffStockVc4)} (${U.fmtPct(U.pctOf(ffStockVc4, ffStockTotal), 0)}) · GV VC4 ${U.fmt(gvStockVc4)} (${U.fmtPct(U.pctOf(gvStockVc4, gvStockTotal), 0)})` },
      { tone: 'g12', icon: '⏳', label: LBL.cover, value: `${ffCur && ffCur.avgPerDay ? U.fmt(ffStockTotal / ffCur.avgPerDay) : '—'} <small>vs</small> ${gvCur && gvCur.avgPerDay ? U.fmt(gvStockTotal / gvCur.avgPerDay) : '—'}`, foot: 'Current runrate par kitne din ka stock' },
      { tone: 'g7', icon: '🔁', label: LBL.repl, value: `${U.fmt(ffCur ? ffCur.replacement : 0)} <small>vs</small> ${U.fmt(gvCur ? gvCur.replacement : 0)}`, foot: `Share of total: FF ${U.fmtPct(U.pctOf(ffCur ? ffCur.replacement : 0, ffCur ? ffCur.total : 0), 1)} · GV ${U.fmtPct(U.pctOf(gvCur ? gvCur.replacement : 0, gvCur ? gvCur.total : 0), 1)}` },
      { tone: 'g10', icon: '🔺', label: LBL.high, value: U.fmt(report.filter((r) => /high/i.test(r.priority)).length), foot: report.length ? `Inactive agents: <b>${U.fmt(report.filter((r) => /inactive/i.test(r.agentStatus)).length)}</b> · Total GV agents in REPORT: ${U.fmt(report.length)}` : 'GV REPORT load nahi hua' }
    ];

    // ---------- charts -----------------------------------------------------------------------
    const cmpLine = (() => {
      if (!cur) return '';
      const ffS = ffDaily ? M.dailySeries(ffDaily, cur) : null;
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
      const ffMonths = ffDaily ? M.months(ffDaily) : [];
      const gvMonths = masterR.status === 'fulfilled' ? G.months() : [];
      const months = U.uniq([...ffMonths, ...gvMonths]).sort();
      if (!months.length) return '';
      const ffSums = months.map((m) => (ffDaily ? M.summary(ffDaily, m).total : 0));
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
      row(`<b>${U.labelYM(cur)} issuance</b>`, ffCur ? ffCur.total : 0, gvCur ? gvCur.total : 0, isCurrent ? `Current month, ${day} din (MTD)` : 'Full month'),
      row('· VC4 (payable)', ffCur ? ffCur.vc4 : 0, gvCur ? gvCur.vc4 : 0, 'VC4 class'),
      row('· VC20', ffCur ? ffCur.vc20 : 0, gvCur ? gvCur.vc20 : 0, 'VC20 class'),
      row('· VC5+', ffCur ? ffCur.vc5p : 0, gvCur ? gvCur.vc5p : 0, 'VC5, VC6, VC7, VC12, VC16'),
      row('· Commercial (NVC4)', ffCur ? ffCur.comm : 0, gvCur ? gvCur.comm : 0, 'VC20 + VC5+'),
      row('Issuance (new)', ffCur ? ffCur.issuance : 0, gvCur ? gvCur.issuance : 0, 'Status = issuance / completed'),
      row('Replacement', ffCur ? ffCur.replacement : 0, gvCur ? gvCur.replacement : 0, 'Replacement tags'),
      row(`${U.labelYM(last)} (full)`, ffDaily && last ? M.summary(ffDaily, last).total : 0, masterR.status === 'fulfilled' && last ? G.summary(last).total : 0, U.labelYM(last, true)),
      row(`${U.labelYM(last)} (same period)`, ffLastMtd ? ffLastMtd.total : 0, gvLastMtd ? gvLastMtd.total : 0, `day 1-${day}`),
      row(`Avg / day (${U.labelYM(cur)})`, ffCur ? ffCur.avgPerDay : 0, gvCur ? gvCur.avgPerDay : 0, isCurrent ? 'MTD / days elapsed' : 'full month / days'),
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
      if (ffG !== null && gvG !== null) insight.push(`Same period growth — First Forward ${U.pctHtml(ffG, { decimals: 0 })}, GV Partner ${U.pctHtml(gvG, { decimals: 0 })}.`);
      const ffVc4Share = U.pctOf(ffCur.vc4, ffCur.total), gvVc4Share = U.pctOf(gvCur.vc4, gvCur.total);
      insight.push(`VC4 mix — FF <b>${U.fmtPct(ffVc4Share, 0)}</b> vs GV <b>${U.fmtPct(gvVc4Share, 0)}</b> (${gvVc4Share > ffVc4Share ? 'GV ka payable mix behtar' : 'FF ka payable mix behtar'}).`);
      const ffCover = ffCur.avgPerDay ? ffStockTotal / ffCur.avgPerDay : 0;
      const gvCover = gvCur.avgPerDay ? gvStockTotal / gvCur.avgPerDay : 0;
      insight.push(`Stock cover — FF <b>${U.fmt(ffCover)} din</b>, GV <b>${U.fmt(gvCover)} din</b> (${gvCover < ffCover ? 'GV ko dispatch jaldi chahiye' : 'FF ko dispatch jaldi chahiye'}).`);
      if (report.length) insight.push(`GV REPORT me <b>${U.fmt(report.filter((r) => /high/i.test(r.priority)).length)}</b> agents high dispatch priority par hain aur <b>${U.fmt(report.filter((r) => /inactive/i.test(r.agentStatus)).length)}</b> inactive hain.`);
    }

    const topFF = U.topEntries(U.groupSum(ffAgents.filter((a) => a.ym === cur), (a) => a.name, (a) => a.n), 8);
    const topGV = (() => { if (masterR.status !== 'fulfilled' || !cur) return []; return G.agentRollup(cur).slice(0, 8).map((a) => [a.agentName, a.total]); })();

    // ---- KPI click detail data (v3.8.3) -----------------------------------------------------------
    const VS_HEADERS = ['Period', 'First Forward', 'GV Partner', 'GV share'];
    const vsRow = (label, ff, gv) => [label, U.fmt(ff), U.fmt(gv), U.fmtPct(U.pctOf(gv, ff + gv), 1)];
    const allMonths = U.uniq([...(ffDaily ? M.months(ffDaily) : []), ...(masterR.status === 'fulfilled' ? G.months() : [])]).sort().reverse();
    const monthRows = (field) => allMonths.map((m) => {
      const f = ffDaily ? M.summary(ffDaily, m) : null;
      const g = masterR.status === 'fulfilled' ? G.summary(m) : null;
      return vsRow(U.labelYM(m), f ? f[field] : 0, g ? g[field] : 0);
    });
    const dailyRows = (() => {
      if (!cur) return [];
      const ffS = ffDaily ? M.dailySeries(ffDaily, cur) : null;
      const gvS = masterR.status === 'fulfilled' ? G.dailySeries(cur) : null;
      const days = Math.max(ffS ? ffS.totals.length : 0, gvS ? gvS.totals.length : 0);
      const out = [];
      for (let i = 0; i < days; i++) out.push(vsRow(`Day ${i + 1}`, ffS ? (ffS.totals[i] || 0) : 0, gvS ? (gvS.totals[i] || 0) : 0));
      return out.reverse();
    })();
    const stockRows = (() => {
      const clsNum = (c) => parseInt(String(c).replace(/\D/g, ''), 10) || 999;
      const classes = U.uniq([...ffStock.map((r) => r.cls), ...gvStockClass.map((r) => r.cls)]).sort((a, b) => clsNum(a) - clsNum(b));
      return classes.map((c) => {
        const f = U.sum(ffStock.filter((r) => r.cls === c), (r) => r.n);
        const g = U.sum(gvStockClass.filter((r) => r.cls === c), (r) => r.n);
        return vsRow(c, f, g);
      }).concat([vsRow('Total', ffStockTotal, gvStockTotal)]);
    })();
    const highRows = report.filter((r) => /high/i.test(r.priority)).map((r) => [r.agentName, r.agentId, FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : r.tlName, r.priority, r.agentStatus, U.fmt(r.stockTotal)]);
    const kpiDetails = {
      [LBL.issuance]: { title: 'Month-wise issuance · FF vs GV', headers: VS_HEADERS, rows: monthRows('total') },
      [LBL.today]: { title: `${U.labelYM(cur)} daily FF vs GV`, headers: VS_HEADERS, rows: dailyRows },
      [LBL.vc4]: { title: 'Month-wise VC4 · FF vs GV', headers: VS_HEADERS, rows: monthRows('vc4') },
      [LBL.comm]: { title: 'Month-wise Commercial · FF vs GV', headers: VS_HEADERS, rows: monthRows('comm') },
      [LBL.avg]: { title: 'Daily run-rate detail', stats: [`FF: ${U.fmt(ffCur ? ffCur.total : 0)} tags ÷ ${ffCur ? ffCur.activeDays : 0} active days`, `GV: ${U.fmt(gvCur ? gvCur.total : 0)} tags ÷ ${gvCur ? gvCur.activeDays : 0} active days`], headers: VS_HEADERS, rows: dailyRows },
      [LBL.proj]: { title: 'Projection vs last month', headers: VS_HEADERS, rows: monthRows('total') },
      [LBL.agents]: { title: 'Top agents MTD · FF vs GV', headers: ['Channel', 'Agent', 'MTD tags'], rows: [...topFF.map(([n, v]) => ['First Forward', n, U.fmt(v)]), ...topGV.map(([n, v]) => ['GV Partner', n, U.fmt(v)])] },
      [LBL.stock]: { title: 'Class-wise field stock · FF vs GV', headers: VS_HEADERS, rows: stockRows },
      [LBL.cover]: { title: 'Stock cover days', stats: [`FF: ${U.fmt(ffStockTotal)} stock ÷ ${U.fmt(ffCur ? ffCur.avgPerDay : 0)}/day = ${ffCur && ffCur.avgPerDay ? U.fmt(ffStockTotal / ffCur.avgPerDay) : '—'} din`, `GV: ${U.fmt(gvStockTotal)} stock ÷ ${U.fmt(gvCur ? gvCur.avgPerDay : 0)}/day = ${gvCur && gvCur.avgPerDay ? U.fmt(gvStockTotal / gvCur.avgPerDay) : '—'} din`], headers: VS_HEADERS, rows: stockRows },
      [LBL.repl]: { title: 'Month-wise replacements · FF vs GV', headers: VS_HEADERS, rows: monthRows('replacement') },
      [LBL.high]: { title: `${highRows.length} high-priority GV agents`, headers: ['Agent', 'Agent ID', 'TL', 'Priority', 'Status', 'Stock'], rows: highRows }
    };

    body.innerHTML = `
      ${FF.insights.ui.vividMetrics(kpiDefs)}
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
      <p class="foot-note">Sources: First Forward → EIR (issuance; GV master ID ${esc(FF.config.eir.gvMasterId || '5845036')} excluded), StockDataa (stock), REPORT (performance) · GV Partner → GV Master, Tag Assignment, GV REPORT · Latest date ${latest ? U.labelDate(latest, true) : '—'} · Loaded ${U.timeLabel(S.loadedAt || G.loadedAt)}</p>`;
    FF.insights.ui.bindMetricDetails(body, 'GV vs First Forward · full data', [], [], kpiDetails);
    C.mount(body);
  }

  FF.pages.compare = { title: 'GV vs First Forward', render };
})(window.FF);
