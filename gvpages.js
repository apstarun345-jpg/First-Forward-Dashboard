/* GV Partner pages: 🚀 GV Dashboard · 📈 GV Trend · 📦 GV Stock · 🏆 GV Performance
   All four read from FF.gv (GV Master issuance · Tag Assignment stock · GV REPORT performance) and
   follow the same look & behaviour as the First Forward pages (KPIs, charts, quick-find, pivots,
   Excel/CSV export, WhatsApp/Email share, agent profile drawer). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, D = FF.data, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;

  // ---- shared bits -------------------------------------------------------------------------------
  let gvsrLast = [];   // GV Stock Report ki abhi dikh rahi (filtered) rows — tiles ke drill-down ke liye
  /** KPI card + exact drill spec (v3.31) — number par click = wahi data. */
  const kpiS = (cls, title, icon, value, foot, spec) => kpi(cls, title, icon, value, foot).replace('<div class="kpi ', `<div data-kpi="${esc(spec)}" class="kpi `);
  const kpi = (cls, title, icon, value, foot, tip) => `<div class="kpi ${cls}" ${tip ? `data-tip="${esc(tip)}"` : ''}><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  const card = (title, body, opts) => `<section class="card ${(opts && opts.cls) || ''}"><div class="card-head"><h3>${title}</h3>${opts && opts.right ? `<div class="card-right">${opts.right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const head = (icon, title, sub, actions) => `<div class="page-head"><div><h1>${icon} ${esc(title)}</h1><p class="sub">${sub}</p></div><div class="head-actions">${actions || ''}<button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>`;
  const drillAttr = (spec) => `data-kpi="${esc(new URLSearchParams(Object.entries(spec).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString())}" title="Click to open detail"`;
  const miniKpi = (label, value, foot, cls, drill) => {
    const scope = (drill && drill.scope) || (/stock|inventory/i.test(label) ? 'stock' : /agents?/i.test(label) ? 'agents' : /today/i.test(label) ? 'day' : 'mtd');
    const params = new URLSearchParams({ src: 'gv', scope });
    Object.entries(drill || {}).forEach(([key, val]) => { if (key !== 'scope' && val !== undefined && val !== '') params.set(key, val); });
    return `<div class="mini-kpi ${cls || ''}" data-kpi="${esc(params.toString())}" data-kpi-title="${esc(label)}" title="Click to open ${esc(label)} breakdown"><span class="mini-label">${esc(label)}</span><span class="mini-value">${value}</span>${foot ? `<span class="mini-foot">${foot}</span>` : ''}</div>`;
  };
  const tableHtml = (header, rows, numericFrom) => `<div class="table-wrap"><table class="tbl compact"><thead><tr>${header.map((h, i) => `<th class="${i >= numericFrom ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${header.length}" class="empty">No data</td></tr>`}</tbody></table></div>`;
  const norm = (s) => U.clean(s).toUpperCase().replace(/\s+/g, ' ');
  const gvName = () => (FF.config.brand && /first forward/i.test(FF.config.brand) ? 'GV Partner' : 'GV Partner');
  function exportBtn(name) { return FF.auth.can('export') ? `<button class="btn" data-action="export" data-name="${esc(name)}">⬇ CSV</button>` : ''; }
  function shareBtn(text, subject) {
    if (!FF.auth.can('share')) return '';
    return `<button class="btn small" data-share="wa" data-text="${esc(text)}">🟢 WhatsApp</button><button class="btn small" data-share="mail" data-subject="${esc(subject || 'GV Partner report')}" data-text="${esc(text)}">✉️ Email</button><button class="btn small" data-share="copy" data-text="${esc(text)}">📋 Copy</button>`;
  }
  function stockCover(n, perDay) { return perDay ? n / perDay : null; }

  // ================================================================================================
  // 🚀 GV Partner Dashboard
  // ================================================================================================
  async function renderDashboard(root, params, ctx) {
    const fresh = !!(ctx && ctx.fresh);
    root.innerHTML = head('🚀', 'GV Partner Dashboard', 'GV Master issuance · Tag Assignment stock · GV REPORT performance — alag GV section', `<a class="btn" href="#/compare">⚖️ GV vs First Forward</a>`)
      + `<div id="gvd-body">${U.spinner('GV data load ho raha hai… (GV Master + Tag Assignment + GV REPORT)')}</div>`;
    const body = U.$('#gvd-body', root);
    const [eirR, masterR, reportR, agentClassR] = await Promise.allSettled([S.need('daily'), G.need('master'), G.need('report'), S.need('agentClass')]);
    if (!root.isConnected) return;
    if (masterR.status !== 'fulfilled') { body.innerHTML = U.errorBox(masterR.reason, 'data-action="refresh"'); return; }
    // GV REPORT remains the operational priority/stock source; every issuance field is overlaid
    // from the canonical EIR rows once the daily ledger is ready.
    const reportRaw = reportR.status === 'fulfilled' ? reportR.value : [];
    const report = overlayGvReportWithEir(reportRaw);
    const stockClass = G.get('stockClass') || [], stockTl = G.get('stockTl') || [], stockAgent = G.get('stockAgent') || [];

    const latest = G.latestDate();
    if (!latest) { body.innerHTML = `<div class="empty-state">😶 GV Master me koi date nahi mili.<br><small class="dim">Settings → Data source me GV tab/column mapping check karo.</small></div>`; return; }
    const todayDate = new Date();
    const cur = U.ymKey(todayDate);
    const last = U.prevMonthKey(cur);
    const curS = G.summary(cur), lastS = G.summary(last), lastMtd = G.summary(last, todayDate.getDate());
    const curSeries = G.dailySeries(cur), lastSeries = G.dailySeries(last);
    const today = curSeries.totals[todayDate.getDate() - 1] || 0;
    const prevDay = todayDate.getDate() > 1 ? curSeries.totals[todayDate.getDate() - 2] : 0;
    const monthsList = G.months();

    // stock (Tag Assignment)
    const stockTotal = U.sum(stockClass, (r) => r.n);
    const stockVc4 = U.sum(stockClass.filter((r) => r.group === 'VC4'), (r) => r.n);
    const stockComm = stockTotal - stockVc4;
    const directStock = stockTl.filter((r) => r.directAgent === true || FF.config.isDirectAgent(r, 'gv'));
    const topTlStock = stockTl.filter((r) => r.tlName !== 'Unassigned' && r.directAgent !== true && FF.config.isRealTl(r.tlName));
    const perDay = curS.avgPerDay || 0;

    // report-derived
    const highPrio = report.filter((r) => /high/i.test(r.priority)).length;
    const inactive = report.filter((r) => /inactive/i.test(r.agentStatus)).length;
    const reportStock = U.sum(report, (r) => r.stockTotal);

    const lm = U.labelYM(last), cm = U.labelYM(cur);
    const kpis = [
      kpi('g1', `Today · ${U.labelDate(todayDate)} (${U.weekday(todayDate)})`, '⚡', U.fmt(today), `${U.deltaHtml(U.growth(today, prevDay), { decimals: 0 })} vs previous day (${U.fmt(prevDay)})`),
      kpi('g2', `MTD Issuance · ${cm}`, '🏷️', U.fmt(curS.total), `${U.deltaHtml(U.growth(curS.total, lastMtd.total))} vs ${lm} same period (${U.fmt(lastMtd.total)})`),
      kpi('g3', 'VC4 (Payable) · MTD', '🚗', U.fmt(curS.vc4), `${U.fmtPct(U.pctOf(curS.vc4, curS.total), 0)} share · ${U.deltaHtml(U.growth(curS.vc4, lastMtd.vc4))} vs ${lm}`),
      kpi('g4', 'Commercial (NVC4) · MTD', '🚚', U.fmt(curS.comm), `VC20 <b>${U.fmt(curS.vc20)}</b> · VC5+ <b>${U.fmt(curS.vc5p)}</b> · ${U.deltaHtml(U.growth(curS.comm, lastMtd.comm))}`),
      kpi('g5', 'Avg / Day · MTD', '📅', U.fmt(curS.avgPerDay), `${lm}: ${U.fmt(lastS.avgPerDay)} / day · ${curS.activeDays} active days`),
      kpi('g6', `Projected Month-End · ${cm}`, '🎯', U.fmt(curS.projected), `${U.deltaHtml(U.growth(curS.projected, lastS.total))} vs ${lm} full (${U.fmt(lastS.total)})`),
      kpi('g7', 'Replacements · MTD', '🔁', U.fmt(curS.replacement), `${U.fmtPct(U.pctOf(curS.replacement, curS.total))} of total · VRN ${U.fmt(curS.vrn)} · Chassis ${U.fmt(curS.chassis)}`),
      kpi('g8', 'Active Agents · MTD', '🧑‍💼', U.fmt(curS.activeAgents), `${U.fmt(curS.activeTls)} TLs active · 🚫 <b>${U.fmt(curS.directAgents || 0)}</b> direct (no TL) · ${lastS.activeAgents} last month`),
      kpi('g9', 'GV Stock in Field', '📦', U.fmt(stockTotal), `VC4 <b>${U.fmt(stockVc4)}</b> · Commercial <b>${U.fmt(stockComm)}</b>${perDay ? ` · ${U.fmt(stockTotal / perDay)} days cover` : ''}`),
      kpi('g10', 'High Dispatch Priority', '🔺', report.length ? U.fmt(highPrio) : '—', report.length ? `GV REPORT agents jinko dispatch chahiye · Inactive <b>${U.fmt(inactive)}</b>` : 'GV REPORT load nahi hua'),
      kpi('g11', 'Commission · MTD', '💰', U.fmt(curS.commission), `Amount <b>${U.fmt(curS.amount)}</b> · class sum: VC4 <b>₹${U.fmt(curS.commissionVc4 || 0)}</b> · VC20 <b>₹${U.fmt(curS.commissionVc20 || 0)}</b> · VC5+ <b>₹${U.fmt(curS.commissionVc5p || 0)}</b>`),
      kpi('g12', 'Report Stock (GV REPORT)', '🏬', report.length ? U.fmt(reportStock) : '—', report.length ? `${U.fmtPct(U.pctOf(U.sum(report, (r) => r.stockVc4), reportStock), 0)} VC4 · ${U.fmt(report.length)} agents` : '—')
    ];

    {
      const latestK = U.dateKey(todayDate);
      // v3.31: High priority → wahi agents ki list · REPORT stock → REPORT agents (stock ka jod = card)
      const specs = [`src=gv&scope=day&date=${latestK}`, `src=gv&scope=mtd&ym=${cur}`, `src=gv&scope=mtd&ym=${cur}&f=vc4`, `src=gv&scope=mtd&ym=${cur}&f=comm`, `src=gv&scope=mtd&ym=${cur}`, `src=gv&scope=mtd&ym=${cur}`, `src=gv&scope=mtd&ym=${cur}&f=repl`, `src=gv&scope=agents&ym=${cur}`, 'src=gv&scope=stock', 'src=gv&scope=people&level=High', `src=gv&scope=mtd&ym=${cur}`, 'src=gv&scope=people&sort=stock'];
      kpis.forEach((html, i) => { if (specs[i]) kpis[i] = html.replace('<div class="kpi ', `<div data-kpi="${esc(specs[i])}" class="kpi `); });
    }
    const dayLabels = curSeries.days.map(String);
    const lineChart = C.lines({
      labels: dayLabels, tipLabels: curSeries.days.map((d) => `Day ${d}`), height: 250, series: [
        { name: cm, values: curSeries.totals.map((v, i) => (i < todayDate.getDate() ? v : null)), color: C.COLORS.current },
        { name: lm, values: lastSeries.totals.slice(0, curSeries.days.length), color: C.COLORS.last, dash: true, area: false }
      ]
    });
    const classDonut = C.donut({ items: [{ label: 'VC4', value: curS.vc4 }, { label: 'VC20', value: curS.vc20 }, { label: 'VC5+', value: curS.vc5p }], subtitle: 'MTD total' });
    const sums = monthsList.map((m) => G.summary(m));
    const monthLabels = monthsList.map((m) => U.labelYM(m));
    const monthlyClass = C.bars({ labels: monthLabels, height: 200, series: [
      { name: 'VC4', values: sums.map((s) => s.vc4) }, { name: 'VC20', values: sums.map((s) => s.vc20) }, { name: 'VC5+', values: sums.map((s) => s.vc5p) }] });
    const monthlyType = C.bars({ labels: monthLabels, height: 200, series: [
      { name: 'Issuance', values: sums.map((s) => s.issuance), color: '#10b981' }, { name: 'Replacement', values: sums.map((s) => s.replacement), color: '#f59e0b' }] });
    const monthlyTag = C.bars({ labels: monthLabels, height: 200, series: [
      { name: 'VRN', values: sums.map((s) => s.vrn) }, { name: 'Chassis', values: sums.map((s) => s.chassis) }] });

    const topN = FF.config.thresholds.topN || 10;
    const tlsCur = G.tlRollup(cur), tlsLast = new Map(G.tlRollup(last).map((t) => [t.tlName, t.total]));
    const agentsCur = G.agentRollup(cur), agentsLast = new Map(G.agentRollup(last).map((a) => [a.agentId, a.total]));
    const topTls = tlsCur.slice(0, topN).map((t, i) => ({ label: t.tlName, sub: `${t.agentCount} agents`, value: t.total, compare: tlsLast.get(t.tlName) || 0, color: C.PALETTE[i % C.PALETTE.length], attr: `data-link="#/gvPerformance?tl=${encodeURIComponent(t.tlName)}"` }));
    if (curS.directAgents) topTls.push({ label: '🚫 Direct Agents (no TL)', sub: `${curS.directAgents} agents · TL ID + Name blank`, value: G.directRollup(cur).reduce((n, r) => n + r.total, 0), compare: G.directRollup(last).reduce((n, r) => n + r.total, 0), color: '#f59e0b', attr: 'data-link="#/directAgents"' });
    const topAgents = agentsCur.slice(0, topN).map((a, i) => ({ label: a.agentName, sub: a.directAgent === true ? '🚫 Direct (no TL)' : a.tlName, value: a.total, compare: agentsLast.get(a.agentId) || 0, color: C.PALETTE[(i + 2) % C.PALETTE.length], attr: `data-link="#/gvPerformance?q=${encodeURIComponent(a.agentName)}"` }));
    const stockByClass = C.donut({ items: stockClass.map((r) => ({ label: r.cls, value: r.n })), subtitle: 'in stock' });
    const stockTlBars = C.hbars({ items: [
      ...topTlStock.slice(0, topN).map((t, i) => ({ label: t.tlName, value: t.n, color: C.PALETTE[(i + 4) % C.PALETTE.length], attr: `data-link="#/gvStock?tl=${encodeURIComponent(t.tlName)}"` })),
      ...(directStock.length ? [{ label: '🚫 Direct Agents (no TL)', value: U.sum(directStock, (t) => t.n), color: '#f59e0b', attr: 'data-link="#/directAgents"' }] : [])
    ], valueLabel: 'Stock' });

    // recent 14 days
    const recent = [];
    const issuance = G.issuanceRows ? G.issuanceRows() : G.rows();
    const rowCount = (list, predicate) => U.sum(list.filter(predicate || (() => true)), (r) => Number(r.n) || 1);
    for (let i = 0; i < 14; i++) {
      const d = new Date(todayDate); d.setDate(d.getDate() - i);
      const ym = U.ymKey(d), day = d.getDate();
      const dayRows = issuance.filter((r) => r.ym === ym && r.day === day);
      recent.push({ d, total: rowCount(dayRows), vc4: rowCount(dayRows, (r) => r.group === 'VC4'), comm: rowCount(dayRows, (r) => r.group !== 'VC4'), repl: rowCount(dayRows, (r) => /replacement/i.test(r.status || r.type || '')), agents: new Set(dayRows.map((r) => r.agentId || r.agentName).filter(Boolean)).size });
    }
    const recentRows = recent.map((r, i) => `<tr><td>${U.labelDate(r.d)} <span class="dim">${U.weekday(r.d)}</span></td><td class="num"><b>${U.fmt(r.total)}</b></td><td class="num">${U.fmt(r.vc4)}</td><td class="num">${U.fmt(r.comm)}</td><td class="num">${U.fmt(r.repl)}</td><td class="num">${U.fmt(r.agents)}</td><td>${recent[i + 1] ? U.deltaHtml(U.growth(r.total, recent[i + 1].total), { decimals: 0 }) : '—'}</td></tr>`);

    // weekday pattern (last 8 weeks)
    const cutoff = new Date(todayDate); cutoff.setDate(cutoff.getDate() - 55);
    const wdSum = new Array(7).fill(0), wdDays = Array.from({ length: 7 }, () => new Set());
    for (const r of issuance) { if (!r.date || r.date < cutoff) continue; wdSum[r.date.getDay()] += Number(r.n) || 1; wdDays[r.date.getDay()].add(U.dateKey(r.date)); }
    const wdOrder = [1, 2, 3, 4, 5, 6, 0];
    const weekdayChart = C.bars({ labels: wdOrder.map((i) => U.DAYS[i]), height: 190, series: [{ name: 'Avg / day', values: wdOrder.map((i) => (wdDays[i].size ? Math.round(wdSum[i] / wdDays[i].size) : 0)), color: '#0d9488' }] });

    const cmpRow = (label, a, b) => `<tr><td>${label}</td><td class="num"><b>${U.fmt(a)}</b></td><td class="num">${U.fmt(b)}</td><td class="num">${U.deltaHtml(U.growth(a, b), { decimals: 0 })}</td></tr>`;
    const vc4Comm = `<div class="grid g-2" style="margin-bottom:0"><div>${C.bars({ labels: ['VC4', 'VC20', 'VC5+', 'All Comm'], height: 200, series: [{ name: `${lm} (same period)`, values: [lastMtd.vc4, lastMtd.vc20, lastMtd.vc5p, lastMtd.comm], color: '#99f6e4' }, { name: `${cm} MTD`, values: [curS.vc4, curS.vc20, curS.vc5p, curS.comm], color: '#0d9488' }], legendAlways: true })}</div>
      <table class="tbl compact"><thead><tr><th></th><th class="num">${cm} MTD</th><th class="num">${lm} same period</th><th class="num">Growth</th></tr></thead><tbody>${cmpRow('VC4', curS.vc4, lastMtd.vc4)}${cmpRow('VC20', curS.vc20, lastMtd.vc20)}${cmpRow('VC5+', curS.vc5p, lastMtd.vc5p)}${cmpRow('<b>Commercial (VC20 + VC5+)</b>', curS.comm, lastMtd.comm)}${cmpRow('<b>Total</b>', curS.total, lastMtd.total)}</tbody></table></div>`;

    // 🎯 Suggested dispatch plan — Direct/APS agents are visible on demand but never receive stock.
    const dispatchPlan = (() => {
      if (FF.config.feat && FF.config.feat('dispatchPlan') === false) return '';
      if (!report.length) return '';
      const days = Number(FF.config.features && FF.config.features.suggestDays) || 15;
      const scope = ['eligible', 'tag', 'direct', 'all'].includes(params && params.dispatch) ? params.dispatch : 'eligible';
      const all = report
        .filter((r) => /high/i.test(r.priority || '') || /medium/i.test(r.priority || ''))
        .map((r) => {
          const daily = U.runRate(r.curVc4 || 0, 'gv'); // run-rate = issued ÷ (aaj − 1) — GV sheet jaisa
          const cover = daily > 0 && r.stockVc4 != null ? r.stockVc4 / daily : null;
          const direct = FF.config.isDirectAgent(r, 'gv');
          const calculated = Math.max(0, Math.ceil(daily * days - (r.stockVc4 || 0)));
          const gross = Math.max(0, Math.ceil(daily * days)); // bina stock ghataye — run-rate need
          // Direct agents ko stock dispatch nahi — par High/Medium priority ko TAG chahiye (qty zero nahi, alag option).
          return { r, sug: calculated, gross, cover, daily, direct };
        })
        .sort((a, b) => (a.direct - b.direct) || (a.cover ?? 9999) - (b.cover ?? 9999));
      if (!all.length) return '';
      const counts = { all: all.length, direct: all.filter((x) => x.direct).length, tag: all.filter((x) => x.direct).length, eligible: all.filter((x) => !x.direct && x.sug > 0).length };
      const rows = (scope === 'direct' || scope === 'tag' ? all.filter((x) => x.direct) : scope === 'all' ? all : all.filter((x) => !x.direct && x.sug > 0)).slice(0, 60);
      const coverTd = (c) => (c == null ? '<span class="dim">—</span>' : `<span class="count ${c < 7 ? 'red' : c < 15 ? 'amber' : ''}">${U.fmt(c)}</span>`);
      const filters = `<div class="dispatch-filter-bar"><span><b>Dispatch eligibility:</b> Direct (no TL) agents ko stock dispatch nahi — par <b>High/Medium priority ko 🏷️ TAG chahiye</b> (alag option)</span><div class="dispatch-scope" role="group" aria-label="GV dispatch eligibility filter"><button class="btn small ${scope === 'eligible' ? 'primary' : ''}" data-param="dispatch" data-value="eligible">📦 Need stock <b>${U.fmt(counts.eligible)}</b></button><button class="btn small direct-filter ${scope === 'tag' ? 'primary' : ''}" data-param="dispatch" data-value="tag" title="Direct agents jinki priority High/Medium hai — unhe tags chahiye">🏷️ Direct · High/Medium · Tag required <b>${U.fmt(counts.tag)}</b></button><button class="btn small direct-filter ${scope === 'direct' ? 'primary' : ''}" data-param="dispatch" data-value="direct">🚫 Direct Agents · all <b>${U.fmt(counts.direct)}</b></button><button class="btn small ${scope === 'all' ? 'primary' : ''}" data-param="dispatch" data-value="all">All priority <b>${U.fmt(counts.all)}</b></button></div></div>`;
      const table = rows.length ? `<div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th>TL / class</th><th>Priority</th><th>Dispatch status</th><th class="num">VC4 stock</th><th class="num">Run-rate VC4/day</th><th class="num">Cover (din)</th><th class="num">Suggested qty 🎯<br><small class="dim">stock − · w/o stock</small></th></tr></thead><tbody>${rows.map(({ r, sug, gross, cover, daily, direct }) => `<tr class="${direct ? 'dispatch-direct' : ''}" data-link="#/gvPerformance?q=${encodeURIComponent(r.agentName)}"><td><b>${esc(r.agentName)}</b></td><td>${direct ? '<b>Direct Agent</b><small class="cell-sub">no TL · tags only</small>' : esc(r.tlName)}</td><td>${badge(r.priority)}</td><td>${direct ? '<span class="tag warn">🏷️ Tag required</span>' : '<span class="tag warn">Dispatch required</span>'}</td><td class="num">${U.fmt(r.stockVc4)}</td><td class="num">${U.fmt(daily, true)}</td><td class="num">${coverTd(cover)}</td><td class="num">${direct ? `<b class="sug-chip direct">🏷️ ${U.fmt(sug)} tags</b>${U.suggestMode() === 'both' ? `<span class="sug-wo">w/o stock <b>${U.fmt(gross)}</b></span>` : ''}` : U.sugCell(sug, gross)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state compact">${scope === 'direct' || scope === 'tag' ? 'Koi High/Medium Direct Agent nahi mila.' : 'Current priority list me dispatch stock ki zarurat nahi.'}</div>`;
      return filters + card('🎯 Suggested dispatch plan · High + Medium priority', `${table}<div class="dim small" style="margin-top:8px">🏷️ Direct = stock nahi, High/Medium priority ho to tags chahiye · 🎯 <b>Stock ke baad</b> = run-rate × ${days} − stock (run-rate = issue ÷ (aaj − 1) din) · <b>Bina stock</b> = run-rate × ${days} din · cover = VC4 stock ÷ run-rate</div>`, { cls: 'dispatch-plan', right: `<span class="dim">target ${days} din</span>${FF.auth.can('export') ? ` <button class="btn small" data-action="export" data-name="gv-suggested-dispatch-${scope}">⬇ CSV</button>` : ''}` });
    })();
    body.innerHTML = `
      <div class="kpi-grid">${kpis.join('')}</div>
      ${dispatchPlan}
      <div class="grid g-2-1">
        ${card(`📈 GV Daily Issuance · ${cm} <span class="dim">vs</span> ${lm}`, lineChart, { right: `<a class="btn small" href="#/gvTrend?mode=compare">Full GV trend →</a>` })}
        ${card('🍩 GV Class Mix · MTD', classDonut)}
      </div>
      ${card(`⚖️ GV · VC4 vs Commercial · ${cm} MTD <span class="dim">vs</span> ${lm} (same period)`, vc4Comm, { right: `<a class="btn small" href="#/gvPerformance">Agent-wise →</a>` })}
      <div class="grid g-3">
        ${card('🗓️ GV Monthly Issuance by Class', monthlyClass)}
        ${card('🔁 Issuance vs Replacement', monthlyType)}
        ${card('🔖 VRN vs Chassis', monthlyTag)}
      </div>
      <div class="grid g-2">
        ${card(`🏅 Top ${topN} GV TLs · ${cm} <span class="dim">(ghost bar = ${lm})</span>`, C.hbars({ items: topTls, compareLabel: lm, valueLabel: cm }))}
        ${card(`⭐ Top ${topN} GV Agents · ${cm}`, C.hbars({ items: topAgents, compareLabel: lm, valueLabel: cm }))}
      </div>
      <div class="grid g-3">
        ${card('📦 GV Stock by Class <span class="dim">(Tag Assignment)</span>', stockByClass, { right: `<a class="btn small" href="#/gvStock">GV stock →</a>` })}
        ${card('🏬 Top TLs by GV Stock <span class="dim">(+ 🚫 direct agents)</span>', stockTlBars)}
        ${card('📆 Weekday Pattern <span class="dim">(avg/day, last 8 weeks)</span>', weekdayChart)}
      </div>
      <div class="grid g-2">
        ${card('🕒 Last 14 Days', tableHtml(['Date', 'Total', 'VC4', 'Comm', 'Repl', 'Agents', 'vs prev'], recentRows, 1))}
        ${card('🔺 Dispatch / Status Watch <span class="dim">(priority from GV REPORT · issuance from EIR)</span>', tableHtml(['Agent', 'TL', 'Stock', 'MTD', 'Priority', 'Status'],
          report.slice().sort((a, b) => (b.suggestedDispatch || 0) - (a.suggestedDispatch || 0)).slice(0, 12).map((r) => `<tr data-link="#/gvPerformance?q=${encodeURIComponent(r.agentName)}"><td><b>${esc(r.agentName)}</b></td><td>${FF.config.isDirectAgent(r, 'gv') ? '<b>Direct Agent</b>' : esc(r.tlName)}</td><td class="num">${U.fmt(r.stockTotal)}</td><td class="num">${U.fmt(r.curTotal)}</td><td>${esc(r.priority || '—')}</td><td>${esc(r.agentStatus || '—')}</td></tr>`), 2))}
      </div>
      <p class="foot-note">Source: issuance counts = EIR (GV rows classified by master ID ${esc(FF.config.eir.gvMasterId || '5845036')}) · Tag Assignment (stock) · GV REPORT (priority/status) · ${stockAgent.length} agents in stock · Loaded ${U.timeLabel(G.loadedAt || D.lastLoadAt)} · Data sirf ↻ ya browser refresh par update hota hai</p>`;
    C.mount(body);
  }

  // ================================================================================================
  // 📈 GV Trend
  // ================================================================================================
  const DIMS = {
    total: { label: 'Total', fn: () => 'Total' },
    class: { label: 'Class (VC4 / VC20 / VC5+)', fn: (r) => r.group, order: ['VC4', 'VC20', 'VC5+'] },
    status: { label: 'Issuance vs Replacement', fn: (r) => (/replacement/i.test(r.status) ? 'Replacement' : 'Issuance'), order: ['Issuance', 'Replacement'] },
    vrn: { label: 'VRN vs Chassis', fn: (r) => (/chassis/i.test(r.tagType) ? 'Chassis' : 'VRN'), order: ['VRN', 'Chassis'] },
    tl: { label: 'TL', fn: (r) => (FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : (r.tlName || 'Unassigned')) },
    agent: { label: 'Agent', fn: (r) => r.agentName }
  };
  const MODES = [['daily', '📅 Daily'], ['weekly', '🗓️ Weekly'], ['monthly', '📆 Monthly'], ['compare', '⚖️ Last vs Current']];

  async function renderTrend(root, params, ctx) {
    const p = params || {};
    const mode = MODES.some((m) => m[0] === p.mode) ? p.mode : 'daily';
    const dimKey = DIMS[p.dim] ? p.dim : (mode === 'compare' ? 'total' : 'class');
    root.innerHTML = head('📈', 'GV Trend', 'GV Master issuance — daily · weekly · monthly · last vs current', '') + `<div id="gvt-controls"></div><div id="gvt-body">${U.spinner('GV trend aggregate ho raha hai…')}</div>`;
    const body = U.$('#gvt-body', root), controls = U.$('#gvt-controls', root);
    try { await Promise.all([S.need('daily'), S.need('agentClass'), G.need('master'), G.need('report').catch(() => [])]); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;

    let rows = G.issuanceRows ? G.issuanceRows() : G.rows();
    const tl = p.tl || '', agent = p.agent || '';
    if (tl) rows = rows.filter((r) => norm(r.tlName) === norm(tl));
    if (agent) rows = rows.filter((r) => norm(r.agentName) === norm(agent));
    const monthsList = U.uniq([...rows.map((r) => r.ym), ...(!tl && !agent && G.months ? G.months() : [])].filter(Boolean)).sort();
    const latest = rows.reduce((acc, r) => (!acc || (r.date && r.date > acc) ? r.date : acc), null);
    const cur = monthsList.includes(p.month) ? p.month : (latest ? U.ymKey(latest) : monthsList[monthsList.length - 1]);
    const dim = DIMS[dimKey];
    const filterLabel = agent ? `Agent: ${agent}` : tl ? `TL: ${tl}` : 'All GV agents';

    // controls
    const people = G.people();
    controls.innerHTML = `<div class="card controls"><div class="seg">${MODES.map(([k, l]) => `<button class="seg-btn ${k === mode ? 'on' : ''}" data-param="mode" data-value="${k}">${l}</button>`).join('')}</div>
      <div class="ctrl-row">
        ${mode === 'daily' ? `<label>Month <select data-param="month">${monthsList.map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${U.labelYM(m, true)}</option>`).join('')}</select></label>` : ''}
        <label>Breakdown <select data-param="dim">${Object.entries(DIMS).map(([k, d]) => `<option value="${k}" ${k === dimKey ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></label>
        <label>TL <select data-param="tl"><option value="">All TLs</option>${people.tls.sort((a, b) => b.n - a.n).map((t) => `<option value="${esc(t.name)}" ${norm(t.name) === norm(tl) ? 'selected' : ''}>${esc(t.name)} (${U.fmtShort(t.n)})</option>`).join('')}</select></label>
        <label>Find <span class="finder-input small"><input class="input" id="gvt-find" placeholder="GV agent / TL naam type karo → select" value="${esc(agent)}"></span></label>
        ${tl || agent ? '<button class="btn small" data-action="clear-filters">✕ Clear filters</button>' : ''}
        <span class="ctrl-note">${esc(filterLabel)}</span>
      </div></div>`;
    const findInput = U.$('#gvt-find', controls);
    U.suggest(findInput, {
      items: () => [...people.tls.sort((a, b) => b.n - a.n).map((t) => ({ kind: 'tl', kindLabel: 'GV TL', label: t.name, sub: `${U.fmtShort(t.n)} tags`, value: t.name })),
        ...people.agents.slice(0, 400).map((a) => ({ kind: 'agent', kindLabel: 'GV Agent', label: a.name, sub: a.tl || a.id, value: a.name }))],
      onPick: (it) => { if (it.value && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('GV Trend Find', it.value); FF.app.updateParams(it.kind === 'tl' ? { tl: it.value, agent: '' } : { agent: it.value, tl: '' }); },
      onEnter: (q) => { if (!q) { FF.app.updateParams({ agent: '', tl: '' }); return; } if (q && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('GV Trend Find', q); const hit = people.agents.find((a) => norm(a.name).includes(norm(q))); if (hit) FF.app.updateParams({ agent: hit.name, tl: '' }); else U.toast('Koi GV agent match nahi hua', 'err'); }
    });

    if (!rows.length && !monthsList.length) { body.innerHTML = `<div class="empty-state">😶 Is filter ke liye GV issuance data nahi mila.<br><button class="btn" data-action="clear-filters">Clear filters</button></div>`; return; }

    const dimKeys = (list) => {
      const present = U.uniq([
        ...list.map(dim.fn),
        ...(!tl && !agent ? monthsList.flatMap((m) => [...G.byDim(m, dim.fn).keys()]) : [])
      ]);
      if (dimKey === 'agent' || dimKey === 'tl') return U.topEntries(U.groupSum(list, dim.fn, (r) => Number(r.n) || 1), 10).map((e) => e[0]);
      if (dim.order) return dim.order.filter((k) => present.includes(k)).concat(present.filter((k) => !dim.order.includes(k)));
      return U.topEntries(U.groupSum(list, dim.fn, (r) => Number(r.n) || 1), 8).map((e) => e[0]);
    };
    const keys = dimKeys(rows);
    const bucketize = (list, keyFn) => {
      const map = new Map();
      for (const r of list) {
        const b = keyFn(r);
        if (!map.has(b)) map.set(b, new Map());
        const inner = map.get(b); const k = dim.fn(r);
        inner.set(k, (inner.get(k) || 0) + (Number(r.n) || 1));
      }
      return map;
    };
    const seriesFor = (map, buckets) => keys.map((k) => ({ name: k, values: buckets.map((b) => (map.get(b) && map.get(b).get(k)) || 0) }));

    let html = '';
    if (mode === 'daily') {
      const days = U.daysInMonth(cur);
      const dayRows = rows.filter((r) => r.ym === cur);
      const buckets = Array.from({ length: days }, (_, i) => i + 1);
      const map = bucketize(dayRows, (r) => r.day);
      const series = seriesFor(map, buckets);
      const tips = buckets.map((d) => `<b>${U.labelYM(cur, true)} · day ${d}</b><br>${series.map((s) => `<i style="background:${s.color || ''}"></i>${esc(s.name)}: <b>${s.values[d - 1] || 0}</b>`).join('<br>')}<br>Total: <b>${U.fmt(U.sum(series, (s) => s.values[d - 1] || 0))}</b>`);
      const totals = buckets.map((_, i) => U.sum(series, (s) => s.values[i]));
      html += card(`📅 Daily · ${U.labelYM(cur, true)} <span class="dim">${esc(dim.label)}</span>`, C.bars({ labels: buckets.map(String), series, height: 260, tips, tipsAlways: true }), { right: exportBtn('gv-trend-daily') })
 + card('🔢 Daily table', tableHtml(['Day', 'Total', ...keys], buckets.map((d, i) => `<tr><td>Day ${d}</td><td class="num"><b>${U.fmt(totals[i])}</b></td>${keys.map((k) => `<td class="num">${U.fmt((map.get(d) && map.get(d).get(k)) || 0)}</td>`).join('')}</tr>`), 1));
    } else if (mode === 'weekly') {
      const weeks = G.weekly(cur);
      const buckets = weeks.map((w) => U.dateKey(w.start));
      const map = bucketize(rows.filter((r) => r.ym === cur), (r) => U.dateKey(U.weekStart(r.date)));
      const series = seriesFor(map, buckets);
      html += card(`🗓️ Weekly · ${U.labelYM(cur, true)} <span class="dim">${esc(dim.label)}</span>`, C.bars({ labels: weeks.map((w) => U.labelDate(w.start)), series, height: 240 }), { right: exportBtn('gv-trend-weekly') })
        + card('🔢 Weekly table', tableHtml(['Week starting', 'Total', ...keys], weeks.map((w) => { const k = U.dateKey(w.start); const tot = U.sum(series, (s) => s.values[buckets.indexOf(k)] || 0); return `<tr><td>${U.labelDate(w.start, true)}</td><td class="num"><b>${U.fmt(tot)}</b></td>${keys.map((kk) => `<td class="num">${U.fmt((map.get(k) && map.get(k).get(kk)) || 0)}</td>`).join('')}</tr>`; }), 1));
    } else if (mode === 'monthly') {
      const map = !tl && !agent ? new Map(monthsList.map((m) => [m, G.byDim(m, dim.fn)])) : bucketize(rows, (r) => r.ym);
      const series = seriesFor(map, monthsList);
      html += card(`📆 Monthly (all months in GV Master & Report) <span class="dim">${esc(dim.label)}</span>`, C.bars({ labels: monthsList.map((m) => U.labelYM(m)), series, height: 260, legendAlways: true }), { right: exportBtn('gv-trend-monthly') })
        + card('🔢 Monthly table', tableHtml(['Month', 'Total', ...keys, 'Avg / day'], monthsList.map((m) => { const tot = U.sum(series, (s) => s.values[monthsList.indexOf(m)] || 0); const daysIn = U.daysInMonth(m); return `<tr><td>${U.labelYM(m, true)}</td><td class="num"><b>${U.fmt(tot)}</b></td>${keys.map((k) => `<td class="num">${U.fmt((map.get(m) && map.get(m).get(k)) || 0)}</td>`).join('')}<td class="num">${U.fmt(tot / daysIn)}</td></tr>`; }), 1));
    } else {
      const lastKey = U.prevMonthKey(cur);
      const curS = G.summary(cur), lastS = G.summary(lastKey);
      const curMap = G.byDim(cur, dim.fn), lastMap = G.byDim(lastKey, dim.fn);
      const cmpKeys = U.uniq([...curMap.keys(), ...lastMap.keys()]);
      const daysInLast = Math.max(1, rows.filter((r) => r.ym === lastKey).reduce((m, r) => Math.max(m, r.day || 0), 0) || U.daysInMonth(lastKey));
      const lastRowsUpTo = U.sum(rows.filter((r) => r.ym === lastKey && (r.day || 0) <= (curS.lastDay || 31)), (r) => Number(r.n) || 1);
      const lastUpTo = lastRowsUpTo || Math.round(lastS.total * (Math.min(curS.lastDay || 31, daysInLast) / daysInLast));
      html += card(`⚖️ Last vs Current · ${U.labelYM(cur, true)} <span class="dim">${esc(dim.label)}</span>`, C.bars({ labels: cmpKeys, height: 240, series: [{ name: U.labelYM(lastKey, true), values: cmpKeys.map((k) => lastMap.get(k) || 0), color: '#99f6e4' }, { name: U.labelYM(cur, true), values: cmpKeys.map((k) => curMap.get(k) || 0), color: '#0d9488' }], legendAlways: true }), { right: exportBtn('gv-trend-compare') })
        + card('🔢 Comparison table', tableHtml(['Breakdown', `${U.labelYM(lastKey, true)} (full)`, `${U.labelYM(lastKey, true)} (day 1-${curS.lastDay || 31})`, `${U.labelYM(cur, true)} MTD`, 'Growth'], cmpKeys.map((k) => {
          const prevFull = lastMap.get(k) || 0;
          const prevMtd = Math.round(prevFull * (Math.min(curS.lastDay || 31, daysInLast) / daysInLast));
          const now = curMap.get(k) || 0;
          return `<tr><td>${esc(k)}</td><td class="num">${U.fmt(prevFull)}</td><td class="num dim">${U.fmt(prevMtd)}</td><td class="num"><b>${U.fmt(now)}</b></td><td class="num">${U.deltaHtml(U.growth(now, prevMtd), { decimals: 0 })}</td></tr>`;
        }).concat(`<tr class="total"><td><b>Total</b></td><td class="num"><b>${U.fmt(lastS.total)}</b></td><td class="num dim"><b>${U.fmt(lastUpTo)}</b></td><td class="num"><b>${U.fmt(curS.total)}</b></td><td class="num">${U.deltaHtml(U.growth(curS.total, lastUpTo), { decimals: 0 })}</td></tr>`), 1));
    }
    body.innerHTML = html;
    C.mount(body);
  }

  // ================================================================================================
  // 📦 GV Stock (Tag Assignment)
  // ================================================================================================
  const STOCK_VIEWS = [['overview', '📊 Overview'], ['tl', '👥 TL-wise'], ['agent', '🧑‍💼 Agent-wise'], ['class', '🚗 Class-wise']];
  let stockView = 'overview';
  let stockSel = { tl: '', agent: '' };

  async function renderStock(root, params) {
    const p = params || {};
    const explicitView = p.view && STOCK_VIEWS.some((v) => v[0] === p.view) ? p.view : '';
    if (explicitView) {
      stockView = explicitView;
      stockSel = explicitView === 'tl' && p.tl ? { tl: p.tl, agent: '' }
        : explicitView === 'agent' && p.agent ? { tl: '', agent: p.agent }
          : { tl: '', agent: '' };
    } else if (p.tl) { stockSel = { tl: p.tl, agent: '' }; stockView = 'tl'; }
    else if (p.agent) { stockSel = { tl: '', agent: p.agent }; stockView = 'agent'; }
    else { stockView = 'overview'; stockSel = { tl: '', agent: '' }; }
    root.innerHTML = head('📦', 'GV Stock', 'Tag Assignment sheet — GV partner ka stock in field (VC4 vs Commercial)', `<a class="btn" href="#/gvPerformance">🏆 GV performance →</a>`)
      + `<div id="gvs-controls"></div><div id="gvs-body">${U.spinner('GV stock load ho raha hai…')}</div>`;
    const body = U.$('#gvs-body', root), controls = U.$('#gvs-controls', root);
    try { await Promise.all(['stockClass', 'stockTl', 'stockTlClass', 'stockAgent', 'stockAgentClass'].map((key) => G.need(key)).concat([S.need('daily'), S.need('agents'), S.need('agentClass'), G.need('report')])); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    const byClass = G.get('stockClass') || [], byTl = G.get('stockTl') || [], byTlClass = G.get('stockTlClass') || [], byAgent = G.get('stockAgent') || [], byAgentClass = G.get('stockAgentClass') || [];
    const total = U.sum(byClass, (r) => r.n), vc4 = U.sum(byClass.filter((r) => r.group === 'VC4'), (r) => r.n), comm = total - vc4;
    const classes = U.uniq(byClass.map((r) => r.cls)).sort((a, b) => G.clsNum(a) - G.clsNum(b));
    const latest = G.latestDate();
    const perDay = latest ? G.summary(U.ymKey(latest)).avgPerDay : 0;
    const people = G.people();

    controls.innerHTML = `<div class="card controls"><div class="seg">${STOCK_VIEWS.map(([k, l]) => `<button class="seg-btn ${k === stockView ? 'on' : ''}" data-param="view" data-value="${k}">${l}</button>`).join('')}</div>
      <div class="ctrl-row">
        <label>Find <span class="finder-input"><input class="input" id="gvs-find" placeholder="GV agent / TL naam ya ID type karo → dropdown se select" value="${esc(stockSel.agent || stockSel.tl)}"></span></label>
        ${stockSel.agent || stockSel.tl ? `<button class="btn small" data-param="view" data-value="overview">✕ Clear</button><span class="ctrl-note">${esc(stockSel.agent ? `Agent: ${stockSel.agent}` : `TL: ${stockSel.tl}`)}</span>` : '<span class="ctrl-note">Sab GV stock ek jagah</span>'}
      </div></div>`;
    const findInput = U.$('#gvs-find', controls);
    const findItems = () => [...people.tls.slice().sort((a, b) => b.n - a.n).map((t) => ({ kind: 'tl', kindLabel: 'GV TL', label: t.name, sub: `${U.fmtShort(t.n)} tags stock`, value: t.name })),
      ...people.agents.map((a) => ({ kind: 'agent', kindLabel: a.direct ? 'GV Direct Agent' : 'GV Agent', label: a.name, sub: `${a.direct ? 'Direct Agent (no TL)' : (a.tl || '')}${a.id ? ` · ${a.id}` : ''}`, keywords: `${a.id || ''} ${a.tl || ''} direct`, value: a.name, id: a.id, direct: a.direct }))];
    const pickStockResult = (it) => {
      if (it.value && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('GV Stock Find', it.value);
      stockSel = it.kind === 'tl' ? { tl: it.value, agent: '' } : { agent: it.value, tl: '' };
      stockView = it.kind === 'tl' ? 'tl' : 'agent';
      FF.app.updateParams(it.kind === 'tl' ? { tl: it.value, agent: '', view: 'tl' } : { agent: it.value, tl: '', view: 'agent' });
    };
    U.suggest(findInput, {
      items: findItems,
      max: 16,
      onPick: pickStockResult,
      onEnter: (query) => {
        const q = norm(query);
        if (!q) return U.toast('Agent / TL naam ya ID type karo', 'err');
        const items = findItems();
        const hit = items.find((it) => norm(it.label) === q || norm(it.id) === q)
          || items.find((it) => norm(`${it.label} ${it.id || ''} ${it.keywords || ''}`).includes(q));
        if (hit) pickStockResult(hit); else U.toast('GV agent / TL match nahi mila — naam ya ID check karo', 'err');
      }
    });

    const kpis = [
      kpi('g9', 'GV Stock in Field', '📦', U.fmt(total), `VC4 <b>${U.fmt(vc4)}</b> (${U.fmtPct(U.pctOf(vc4, total), 0)}) · Commercial <b>${U.fmt(comm)}</b>`),
      kpi('g12', 'Stock Days Cover', '⏳', perDay ? U.fmt(total / perDay) : '—', perDay ? `GV avg ${U.fmt(perDay)} tags/day par` : 'Issuance data load nahi hua'),
      kpi('g10', 'TLs with Stock', '👥', U.fmt(byTl.filter((r) => FF.config.isRealTl(r.tlName) && r.directAgent !== true).length), `🚫 Direct agents (no TL): <b>${U.fmt((byTl.filter((r) => !FF.config.isRealTl(r.tlName) || r.directAgent === true).reduce((a, r) => a + r.n, 0)))}</b> tags`),
      kpi('g8', 'Agents with Stock', '🧑‍💼', U.fmt(byAgent.length), `Avg <b>${U.fmt(byAgent.length ? total / byAgent.length : 0)}</b> tags / agent`),
      kpi('g3', 'Biggest Class', '🚗', classes.length ? classes.slice().sort((a, b) => (byClass.find((x) => x.cls === b).n) - (byClass.find((x) => x.cls === a).n))[0] : '—', classes.slice().sort((a, b) => (byClass.find((x) => x.cls === b).n) - (byClass.find((x) => x.cls === a).n)).slice(0, 3).map((c) => `${c} <b>${U.fmt(byClass.find((x) => x.cls === c).n)}</b>`).join(' · ')),
      kpi('g11', 'Top TL by Stock', '🏬', (byTl.find((r) => FF.config.isRealTl(r.tlName) && r.directAgent !== true) || {}).tlName || '—', (byTl.find((r) => FF.config.isRealTl(r.tlName) && r.directAgent !== true) || {}).n ? `${U.fmt(byTl.find((r) => FF.config.isRealTl(r.tlName) && r.directAgent !== true).n)} tags` : '')
    ];

    let viewHtml = '';
    if (stockView === 'overview') {
      viewHtml = `<div class="grid g-2">
        ${card('🍩 Stock by Class', C.donut({ items: byClass.map((r) => ({ label: r.cls, value: r.n })), subtitle: 'in stock' }))}
        ${card('⚖️ VC4 vs Commercial', `<div class="grid g-2" style="margin-bottom:0"><div>${C.bars({ labels: ['VC4', 'Commercial'], height: 200, series: [{ name: 'Stock', values: [vc4, comm], color: '#0d9488' }], showValues: true })}</div><div>${tableHtml(['Class', 'Stock', 'Share'], byClass.map((r) => `<tr><td>${esc(r.cls)} <span class="dim">${esc(r.group)}</span></td><td class="num"><b>${U.fmt(r.n)}</b></td><td class="num">${U.fmtPct(U.pctOf(r.n, total), 0)}</td></tr>`), 1)}</div></div>`)}
      </div>
      ${card('🏬 TL-wise GV Stock', tableHtml(['#', 'TL', 'Stock', 'VC4', 'Commercial', 'Share', ''], byTl.slice(0, 60).map((t, i) => {
        const cls = byTlClass.filter((r) => norm(r.tlName) === norm(t.tlName));
        const tVc4 = U.sum(cls.filter((r) => r.group === 'VC4'), (r) => r.n), tComm = U.sum(cls, (r) => r.n) - tVc4;
        return `<tr><td class="dim">${i + 1}</td><td><b>${!FF.config.isRealTl(t.tlName) || t.directAgent === true ? '🚫 Direct Agents (no TL)' : esc(t.tlName)}</b></td><td class="num"><b>${U.fmt(t.n)}</b></td><td class="num">${U.fmt(tVc4)}</td><td class="num">${U.fmt(tComm)}</td><td class="num">${U.fmtPct(U.pctOf(t.n, total), 0)}</td><td><button class="btn small" data-link="#/gvStock?tl=${encodeURIComponent(t.tlName)}&view=tl">View →</button></td></tr>`;
      }), 2), { right: exportBtn('gv-stock-tl') })}
      ${card('🧑‍💼 Agent-wise GV Stock <span class="dim">(top 60)</span>', tableHtml(['#', 'Agent', 'TL', 'Stock', 'VC4', 'Comm'], byAgent.slice(0, 60).map((a, i) => {
        const cls = byAgentClass.filter((r) => norm(r.agentName) === norm(a.agentName));
        const aVc4 = U.sum(cls.filter((r) => r.group === 'VC4'), (r) => r.n);
        return `<tr><td class="dim">${i + 1}</td><td><b>${esc(a.agentName)}</b> <small class="dim">${esc(a.agentId)}</small></td><td>${a.direct ? '<b class="direct-chip">🚫 Direct (no TL)</b>' : esc(a.tlName || '—')}</td><td class="num"><b>${U.fmt(a.n)}</b></td><td class="num">${U.fmt(aVc4)}</td><td class="num">${U.fmt(a.n - aVc4)}</td></tr>`;
      }), 3), { right: exportBtn('gv-stock-agents') })}`;
    } else if (stockView === 'tl') {
      const tlRows = byTl.filter((r) => !stockSel.tl || norm(r.tlName) === norm(stockSel.tl));
      viewHtml = tlRows.slice(0, 40).map((t) => {
        const classRows = byTlClass.filter((r) => norm(r.tlName) === norm(t.tlName));
        const agentRows = byAgent.filter((a) => norm(a.tlName) === norm(t.tlName));
        const tVc4 = U.sum(classRows.filter((r) => r.group === 'VC4'), (r) => r.n);
        return card(`👥 ${esc(t.tlName)} <span class="dim">· ${U.fmt(t.n)} tags · ${agentRows.length} agents</span>`, `
          <div class="grid g-3" style="margin-bottom:10px">${miniKpi('VC4', U.fmt(tVc4))}${miniKpi('Commercial', U.fmt(t.n - tVc4))}${miniKpi('Share of GV stock', U.fmtPct(U.pctOf(t.n, total), 0))}</div>
          ${C.bars({ labels: classes, height: 180, series: [{ name: 'Stock', values: classes.map((c) => U.sum(classRows.filter((r) => r.cls === c), (r) => r.n)), color: '#0d9488' }], showValues: true })}
          ${tableHtml(['Agent', 'ID', 'Stock', 'VC4', 'Comm'], agentRows.slice(0, 30).map((a) => {
            const cls = byAgentClass.filter((r) => norm(r.agentName) === norm(a.agentName));
            const aVc4 = U.sum(cls.filter((r) => r.group === 'VC4'), (r) => r.n);
            return `<tr><td><b>${esc(a.agentName)}</b></td><td class="dim">${esc(a.agentId)}</td><td class="num">${U.fmt(a.n)}</td><td class="num">${U.fmt(aVc4)}</td><td class="num">${U.fmt(a.n - aVc4)}</td></tr>`;
          }), 2)}`, { cls: 'gv-card' });
      }).join('') || `<div class="empty-state">Koi TL match nahi hua.</div>`;
    } else if (stockView === 'agent') {
      const list = byAgent.filter((a) => !stockSel.agent || norm(a.agentName) === norm(stockSel.agent) || a.agentId === stockSel.agent);
      viewHtml = list.slice(0, 40).map((a) => {
        const cls = byAgentClass.filter((r) => norm(r.agentName) === norm(a.agentName));
        const aVc4 = U.sum(cls.filter((r) => r.group === 'VC4'), (r) => r.n);
        const rep = overlayGvReportWithEir(G.get('report') || []).find((r) => norm(r.agentName) === norm(a.agentName));
        return card(`🧑‍💼 ${esc(a.agentName)} <span class="dim">${esc(a.agentId)} · ${esc(a.tlName || '—')}</span>`, `
          <div class="grid g-4" style="margin-bottom:10px">${miniKpi('Stock', U.fmt(a.n))}${miniKpi('VC4', U.fmt(aVc4))}${miniKpi('Commercial', U.fmt(a.n - aVc4))}${rep ? miniKpi('MTD issuance (EIR)', U.fmt(rep.curTotal)) : miniKpi('MTD issuance', '—')}</div>
          ${C.bars({ labels: classes, height: 180, series: [{ name: 'Stock', values: classes.map((c) => U.sum(cls.filter((r) => r.cls === c), (r) => r.n)), color: '#0d9488' }], showValues: true })}
          ${rep ? `<div class="grid g-3">${miniKpi('Last month', U.fmt(rep.lastTotal))}${miniKpi('MTD', U.fmt(rep.curTotal))}${miniKpi('Growth', U.deltaHtml(rep.growth, { decimals: 0 }))}</div>` : ''}
          <div class="btn-row" style="margin-top:8px">${FF.auth.can('export') ? `<button class="btn small" data-gv-rows="agent" data-name="${esc(a.agentName)}">⬇ In-stock tags (CSV)</button>` : ''}${FF.auth.can('export') ? `<button class="btn small" data-gv-rows="agent-xlsx" data-name="${esc(a.agentName)}">⬇ Excel</button>` : ''}${FF.auth.can('performance') || FF.auth.can('gvPerformance') ? `<a class="btn small" href="#/gvPerformance?q=${encodeURIComponent(a.agentName)}">🏆 GV profile →</a>` : ''}</div>`, { cls: 'gv-card' });
      }).join('') || `<div class="empty-state">Koi GV agent match nahi hua — dropdown se select karo.</div>`;
    } else {
      const classRows = byTlClass;
      viewHtml = `${card('🚗 GV Stock by Class <span class="dim">(TL split)</span>', tableHtml(['Class', 'Group', 'Stock', 'Share', 'Top TL'], classes.map((c) => {
        const rowsForClass = classRows.filter((r) => r.cls === c);
        const top = U.topEntries(U.groupSum(rowsForClass, (r) => r.tlName || 'Unassigned', (r) => r.n), 1)[0];
        return `<tr><td><b>${esc(c)}</b></td><td>${esc(G.classGroup(c))}</td><td class="num"><b>${U.fmt(U.sum(rowsForClass, (r) => r.n))}</b></td><td class="num">${U.fmtPct(U.pctOf(U.sum(rowsForClass, (r) => r.n), total), 0)}</td><td>${top ? `${esc(top[0])} <span class="dim">(${U.fmt(top[1])})</span>` : '—'}</td></tr>`;
      }), 2), { right: exportBtn('gv-stock-class') })}
      ${card('🔠 Class × TL matrix', (() => {
        const tls = U.topEntries(U.groupSum(byTl.filter((r) => FF.config.isRealTl(r.tlName) && r.directAgent !== true), (r) => r.tlName, (r) => r.n), 15).map((e) => e[0]);
        return tableHtml(['TL', ...classes, 'Total'], tls.map((tl) => {
          const rowsFor = classRows.filter((r) => norm(r.tlName) === norm(tl));
          return `<tr><td><b>${esc(tl)}</b></td>${classes.map((c) => `<td class="num">${U.fmt(U.sum(rowsFor.filter((r) => r.cls === c), (r) => r.n))}</td>`).join('')}<td class="num"><b>${U.fmt(U.sum(rowsFor, (r) => r.n))}</b></td></tr>`;
        }), 1);
      })())}`;
    }

    body.innerHTML = `<div class="kpi-grid">${kpis.join('')}</div>${viewHtml}
      <p class="foot-note">Issuance KPIs = EIR; stock source: GV Partner sheet → <b>Tag Assignment</b> tab (${U.fmt(total)} tags in stock) · Aggregates Google se group-by queries me aate hain · Loaded ${U.timeLabel(G.loadedAt || D.lastLoadAt)}</p>`;
    C.mount(body);

    // raw in-stock rows export (agent / TL) — on demand, Google se page-wise
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gv-rows]');
      if (!b) return;
      if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
      const a = FF.config.gv.assignment;
      const name = b.dataset.name;
      const kind = b.dataset.gvRows;
      const isTl = kind === 'tl' || kind === 'tl-xlsx';
      b.disabled = true; const label = b.textContent; b.textContent = '⏳ loading…';
      try {
        const tq = `select ${a.cls}, ${a.tagId}, ${a.serial}, ${a.status}, ${a.agentId}, ${a.agentName}, ${a.tlName} where lower(${isTl ? a.tlName : a.agentName}) = ${D.lit(name.toLowerCase())} limit 5000`;
        const t = await D.query('Tag Assignment', tq, {});
        const header = t.cols.map((c) => c.label || c.id);
        const bcCol = header.findIndex((h) => /barcode|serial/i.test(String(h || '')));
        const rows = D.textRows(t).map((r) => (bcCol >= 0 ? r.map((v, i) => (i === bcCol ? U.barcode(v) : v)) : r));
        const slug = `${isTl ? 'tl' : 'agent'}-${U.slug(name)}-gv-stock`;
        if (kind.endsWith('xlsx')) FF.xlsx.download(`${slug}.xlsx`, [{ name: isTl ? 'TL stock' : 'Agent stock', header, rows: rows.map((r) => r.map((v) => (/^-?\d+(\.\d+)?$/.test(v) && v.length < 15 ? Number(v) : v))) }]);
        else U.downloadCsv(`${slug}-${U.stamp()}.csv`, header, rows);
        U.toast(`${U.fmt(rows.length)} rows download ✓`, 'ok');
      } catch (err) { U.toast(err.message, 'err'); }
      b.disabled = false; b.textContent = label;
    });
  }

  // ================================================================================================
  // 🏆 GV Performance (GV REPORT)
  // ================================================================================================
  const perf = { view: 'overview', q: '', priority: '', status: '', growth: '', stock: '', tl: '', sourceRows: null, sort: { key: 'curTotal', dir: 'desc' }, page: 1 };
  const PERF_COLS = [
    { key: 'agentName', label: 'Agent', num: false }, { key: 'tlName', label: 'TL', num: false },
    { key: 'stockTotal', label: 'Stock', num: true }, { key: 'stockVc4', label: 'Stock VC4', num: true }, { key: 'stockComm', label: 'Stock Comm', num: true },
    { key: 'lastTotal', label: 'Last month', num: true }, { key: 'curTotal', label: 'MTD', num: true }, { key: 'curVc4', label: 'MTD VC4', num: true },
    { key: 'growth', label: 'Growth', num: true }, { key: 'todayIssued', label: 'Today', num: true }, { key: 'curDays', label: 'Active days', num: true },
    { key: 'expected', label: 'Expected', num: true }, { key: 'runrate', label: 'Runrate', num: true }, { key: 'priority', label: 'Priority', num: false }, { key: 'agentStatus', label: 'Status', num: false }
  ];
  function tone(text) {
    const t = U.clean(text);
    if (!t) return 'gray';
    if (/🚀|🟢|▲/.test(t)) return 'green';
    if (/🟡/.test(t)) return 'amber';
    if (/🔴|🔻|▼/.test(t)) return 'red';
    if (/inactive|de-?growth|high|critical/i.test(t)) return 'red';
    if (/medium|slight/i.test(t)) return 'amber';
    if (/growth|active|low|ok/i.test(t)) return 'green';
    return 'gray';
  }
  const badge = (text) => { const t = U.clean(text); return t ? `<span class="badge ${tone(t)}">${esc(t.replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '') || t)}</span>` : '<span class="dim">—</span>'; };

  function overlayGvReportWithEir(report) {
    const latest = G.latestDate && G.latestDate();
    if (!latest || !G.issuanceRows) return report;
    // Report totals must use the current calendar day, not the last date found in the sheet.
    // Otherwise a delayed/empty day silently makes the previous source day appear as "Today".
    const now = new Date();
    const currentYm = U.ymKey(now), previousYm = U.prevMonthKey(currentYm);
    const issuance = G.issuanceRows();
    const current = G.agentRollup(currentYm) || [], previous = G.agentRollup(previousYm) || [];
    const byKey = (list) => {
      const map = new Map();
      list.forEach((a) => [a.agentId, a.agentName].filter(Boolean).forEach((key) => map.set(norm(key), a)));
      return map;
    };
    const curMap = byKey(current), prevMap = byKey(previous);
    const tlMap = (list) => new Map((list || []).map((t) => [norm(t.tlName), t]));
    const curTl = tlMap(G.tlRollup(currentYm)), prevTl = tlMap(G.tlRollup(previousYm));
    const match = (map, r) => map.get(norm(r.agentId)) || map.get(norm(r.agentName));

    // Index once rather than scanning every daily aggregate for every report agent. This cuts the
    // overlay from O(agents × EIR rows) to O(agents + EIR rows), and union-by-object avoids counting
    // one aggregate twice when both the ID and name match.
    const index = (keyFn) => {
      const out = new Map();
      for (const row of issuance) {
        const bucket = keyFn(row);
        if (!bucket) continue;
        let people = out.get(bucket);
        if (!people) out.set(bucket, people = new Map());
        for (const key of [row.agentId, row.agentName].filter(Boolean)) {
          const id = norm(key);
          if (!people.has(id)) people.set(id, []);
          people.get(id).push(row);
        }
      }
      return out;
    };
    const monthIndex = index((r) => r.ym);
    const dayIndex = index((r) => U.dateKey(r.date || r.d));
    const rowsFor = (idx, bucket, r) => {
      const people = idx.get(bucket);
      if (!people) return [];
      const found = new Set();
      for (const key of [r.agentId, r.agentName].filter(Boolean)) (people.get(norm(key)) || []).forEach((row) => found.add(row));
      return [...found];
    };
    const count = (list, fn) => U.sum((fn ? list.filter(fn) : list), (x) => Number(x.n) || 1);
    // 📐 v3.31 — GV run-rate sheet jaisa: is month ka issue ÷ (aaj − 1), min 1 (U.runRateDays 'gv').
    const lastDay = Math.max(1, Number(U.runRateDays(undefined, 'gv')) || now.getDate());
    const expected = (n) => lastDay ? Math.max(n, Math.round((n / lastDay) * U.daysInMonth(currentYm))) : n;
    const todayKey = U.dateKey(now);
    /** Rows (EIR history + GV Master ka LIVE aaj) se totals — drill-down bhi yahi rows padhta hai. Pehle
        MTD EIR rollup (kal tak) se aata tha → 1 tareekh ko "MTD 0" par "Today 34". */
    const fromRows = (rows) => {
      const o = { total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, byClass: {} };
      rows.forEach((x) => { const n = Number(x.n) || 1; o.total += n; if (x.group === 'VC4') o.vc4 += n; else { o.comm += n; if (x.group === 'VC20') o.vc20 += n; else o.vc5p += n; } if (x.cls) o.byClass[x.cls] = (o.byClass[x.cls] || 0) + n; });
      return o;
    };
    return report.map((r) => {
      const currentRows = rowsFor(monthIndex, currentYm, r), lastRows = rowsFor(monthIndex, previousYm, r), todayRows = rowsFor(dayIndex, todayKey, r);
      const curRoll = match(curMap, r), prevRoll = match(prevMap, r);
      const curLive = fromRows(currentRows), prevLive = fromRows(lastRows);
      const cur = curLive.total || !curRoll ? curLive : curRoll;
      const prev = prevLive.total || !prevRoll ? prevLive : prevRoll;
      const eirToday = count(todayRows);
      // GV REPORT's own Today Issued is a recovery source when EIR has not yet exposed that
      // agent's live day row; EIR stays authoritative whenever its count is present.
      const todayIssued = eirToday || Number(r.todayIssued) || 0;
      const curDays = Math.max(Number(r.curDays) || 0, new Set(currentRows.map((x) => U.dateKey(x.date || x.d)).filter(Boolean)).size);
      const lastDays = Math.max(Number(r.lastDays) || 0, new Set(lastRows.map((x) => U.dateKey(x.date || x.d)).filter(Boolean)).size);
      const curChassis = count(currentRows, (x) => /chassis/i.test(x.tagType || x.vrnType || '')) || Number(r.chassis) || 0;
      const curReplace = count(currentRows, (x) => /replacement/i.test(x.status || x.type || '')) || Number(r.replace) || 0;
      const tlName = r.tlName || 'Direct';
      const tlCur = curTl.get(norm(tlName)) || {};
      const tlPrev = prevTl.get(norm(tlName)) || {};
      const curVc4 = Math.max(Number(r.curVc4) || 0, cur.vc4 || 0);
      const curComm = Math.max(Number(r.curComm) || 0, cur.comm || 0);
      const curTotal = Math.max(Number(r.curTotal) || 0, cur.total || 0, curVc4 + curComm);
      const lastVc4 = Math.max(Number(r.lastVc4) || 0, prev.vc4 || 0);
      const lastComm = Math.max(Number(r.lastComm) || 0, prev.comm || 0);
      const lastTotal = Math.max(Number(r.lastTotal) || 0, prev.total || 0, lastVc4 + lastComm);
      const curByClass = { ...(r.curByClass || {}) };
      Object.entries(cur.byClass || {}).forEach(([cls, n]) => { curByClass[cls] = Math.max(curByClass[cls] || 0, n); });
      const lastByClass = { ...(r.lastByClass || {}) };
      Object.entries(prev.byClass || {}).forEach(([cls, n]) => { lastByClass[cls] = Math.max(lastByClass[cls] || 0, n); });
      if (lastVc4 > (lastByClass.VC4 || 0)) lastByClass.VC4 = lastVc4;
      const sumLastCommByClass = Object.entries(lastByClass).filter(([k]) => k !== 'VC4').reduce((s, [, n]) => s + (Number(n) || 0), 0);
      if (lastComm > sumLastCommByClass) lastByClass['VC5+'] = (lastByClass['VC5+'] || 0) + (lastComm - sumLastCommByClass);
      const finalGrowth = U.growth(curTotal, lastTotal);
      return { ...r,
        lastDays, lastVc4, lastComm, lastTotal, lastByClass,
        curDays, replace: curReplace, chassis: curChassis, curVc4, curComm, curTotal, curByClass,
        todayIssued, todayIssuedSource: eirToday ? 'EIR' : (todayIssued ? 'GV REPORT' : 'EIR + GV REPORT'), expected: expected(curTotal),
        runrateVc4: lastDay ? curVc4 / lastDay : 0, runrateComm: lastDay ? curComm / lastDay : 0,
        runrate: lastDay ? curTotal / lastDay : 0, growth: finalGrowth !== null ? finalGrowth : r.growth,
        tlLastVc4: Math.max(Number(r.tlLastVc4) || 0, tlPrev.vc4 || 0),
        tlLastComm: Math.max(Number(r.tlLastComm) || 0, tlPrev.comm || 0),
        tlLastTotal: Math.max(Number(r.tlLastTotal) || 0, tlPrev.total || 0),
        tlCurVc4: Math.max(Number(r.tlCurVc4) || 0, tlCur.vc4 || 0),
        tlCurComm: Math.max(Number(r.tlCurComm) || 0, tlCur.comm || 0),
        tlCurTotal: Math.max(Number(r.tlCurTotal) || 0, tlCur.total || 0),
        eirIssuance: true
      };
    });
  }

  function filteredReport() {
    const q = norm(perf.q);
    return (perf.sourceRows || G.get('report') || []).filter((r) => {
      if (q && !(norm(r.agentName).includes(q) || norm(r.agentId).includes(q) || norm(r.tlName).includes(q))) return false;
      if (perf.priority && !new RegExp(perf.priority, 'i').test(r.priority)) return false;
      if (perf.status === 'active' && /inactive/i.test(r.agentStatus)) return false;
      if (perf.status === 'inactive' && !/inactive/i.test(r.agentStatus)) return false;
      if (perf.growth === 'up' && !(Number(r.growth) > 0)) return false;
      if (perf.growth === 'down' && !(Number(r.growth) < 0)) return false;
      if (perf.growth === 'flat' && Number(r.growth) !== 0) return false;
      if (perf.stock === 'zero' && Number(r.stockTotal) !== 0) return false;
      if (perf.stock === 'direct' && !FF.config.isDirectAgent(r, 'gv')) return false;
      if (perf.stock === 'need' && (FF.config.isDirectAgent(r, 'gv') || !(/high|medium/i.test(r.priority || '')))) return false;
      if (perf.tl === '__direct__') { if (!FF.config.isDirectAgent(r, 'gv')) return false; }
      else if (perf.tl && norm(r.tlName) !== norm(perf.tl)) return false;
      return true;
    }).sort((a, b) => {
      const k = perf.sort.key, d = perf.sort.dir === 'asc' ? 1 : -1;
      const A = a[k], B = b[k];
      if (typeof A === 'number' || typeof B === 'number') return ((A || 0) - (B || 0)) * d;
      return String(A || '').localeCompare(String(B || '')) * d;
    });
  }

  function gvTodayClassBreakdown(agent) {
    const today = U.dateKey(new Date());
    const source = G.issuanceRows ? G.issuanceRows() : [];
    const rows = source.filter((r) => r.date && U.dateKey(r.date) === today
      && ((agent.agentId && r.agentId && norm(r.agentId) === norm(agent.agentId)) || norm(r.agentName) === norm(agent.agentName)));
    const byClass = new Map();
    for (const r of rows) {
      const cls = r.cls || 'Unknown class';
      const n = Number(r.n) || 1;
      const item = byClass.get(cls) || { total: 0, issuance: 0, replacement: 0, detail: new Map() };
      item.total += n;
      const replacement = /replacement/i.test(r.status || r.type || '');
      item[replacement ? 'replacement' : 'issuance'] += n;
      const detail = `${replacement ? 'REPLACEMENT' : 'ISSUANCE'} · ${r.tagType || r.vrnType || 'tag type not set'}`;
      item.detail.set(detail, (item.detail.get(detail) || 0) + n);
      byClass.set(cls, item);
    }
    const total = [...byClass.values()].reduce((n, v) => n + v.total, 0);
    if (!byClass.size) return `<div class="dsec"><h4>🏅 EIR source-date class-wise tags · ${esc(today)}</h4><p class="dim small">EIR me is GV agent ke liye source date par koi issuance row nahi mili.</p></div>`;
    const rowsHtml = [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([cls, v]) => `<tr class="clickable" ${drillAttr({ src: 'gv', scope: 'day', date: today, agent: agent.agentName, agentId: agent.agentId || '', channel: 'gv', cls })}><td><b>${esc(cls)}</b></td><td class="num"><b>${U.fmt(v.total)}</b></td><td class="num">${U.fmt(v.issuance)}</td><td class="num">${U.fmt(v.replacement)}</td><td>${[...v.detail.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => `<span class="today-tag-detail">${esc(label)} · <b>${U.fmt(n)}</b></span>`).join(' ')}</td></tr>`).join('');
    return `<div class="dsec"><h4>🏅 EIR source-date class-wise tags · ${esc(today)} <span class="count green">${U.fmt(total)}</span></h4><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">Tags</th><th class="num">Issuance</th><th class="num">Replacement</th><th>Tag type</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div>`;
  }
  async function agentDrawer(r) {
    await G.need('master').catch(() => []);
    const currentYm = U.ymKey(new Date()), previousYm = U.prevMonthKey(currentYm);
    const profileDrill = (scope, ym) => ({ scope, ym: ym || '', agent: r.agentName, agentId: r.agentId || '', channel: 'gv' });
    const clsRows = Object.entries(r.curByClass || {}).filter(([, v]) => v > 0);
    const lastClsRows = Object.entries(r.lastByClass || {}).filter(([, v]) => v > 0);
    if (!lastClsRows.length && (r.lastVc4 > 0 || r.lastComm > 0)) {
      if (r.lastVc4 > 0) lastClsRows.push(['VC4', r.lastVc4]);
      if (r.lastComm > 0) lastClsRows.push(['Commercial (VC5+)', r.lastComm]);
    }
    const stockRows = Object.entries(r.stockByClass || {}).filter(([, v]) => v > 0);
    const allClsKeys = [...new Set([...clsRows.map(([k]) => k), ...lastClsRows.map(([k]) => k), ...stockRows.map(([k]) => k)])];
    const cmpTable = allClsKeys.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">Last (${esc(previousYm)})</th><th class="num">MTD (${esc(currentYm)})</th><th class="num">Stock</th></tr></thead><tbody>
      ${allClsKeys.map((k) => {
        const lVal = (r.lastByClass && r.lastByClass[k]) || (k === 'VC4' ? r.lastVc4 : 0) || 0;
        const cVal = (r.curByClass && r.curByClass[k]) || 0;
        const sVal = (r.stockByClass && r.stockByClass[k]) || 0;
        return `<tr class="clickable" ${drillAttr({ src: 'gv', scope: cVal > 0 ? 'mtd' : 'month', ym: cVal > 0 ? currentYm : previousYm, agent: r.agentName, agentId: r.agentId || '', channel: 'gv', cls: k })}><td><b>${esc(k)}</b></td><td class="num">${U.fmt(lVal)}</td><td class="num"><b>${U.fmt(cVal)}</b></td><td class="num">${U.fmt(sVal)}</td></tr>`;
      }).join('')}
      </tbody><tfoot><tr class="row-total"><td>Grand Total</td><td class="num">${U.fmt(r.lastTotal)}</td><td class="num">${U.fmt(r.curTotal)}</td><td class="num">${U.fmt(r.stockTotal)}</td></tr></tfoot></table></div>` : '<div class="empty">Class-wise data nahi</div>';
    const body = `
      <div class="grid g-3">${miniKpi('Stock (total)', U.fmt(r.stockTotal), `VC4 ${U.fmt(r.stockVc4)} · Comm ${U.fmt(r.stockComm)}`, '', { scope: 'stock', agent: r.agentName, agentId: r.agentId || '', channel: 'gv' })}${miniKpi('MTD issuance', U.fmt(r.curTotal), `VC4 ${U.fmt(r.curVc4)} · Comm ${U.fmt(r.curComm)}`, 'g3', profileDrill('mtd', currentYm))}${miniKpi('Last month', U.fmt(r.lastTotal), `VC4 ${U.fmt(r.lastVc4)} · Comm ${U.fmt(r.lastComm)}`, '', profileDrill('month', previousYm))}</div>
      <div class="grid g-3" style="margin-top:10px">${miniKpi('Growth', U.deltaHtml(r.growth, { decimals: 0 }), `Today: ${U.fmt(r.todayIssued)}`, '', profileDrill('mtd', currentYm))}${miniKpi('Active days (MTD)', U.fmt(r.curDays), `Last month: ${U.fmt(r.lastDays)}`, '', profileDrill('mtd', currentYm))}${miniKpi('Runrate', U.fmt(r.runrate), `VC4 ${U.fmt(r.runrateVc4)} · Comm ${U.fmt(r.runrateComm)}`, '', profileDrill('mtd', currentYm))}</div>
      <div class="grid g-2" style="margin-top:12px">
        <div>${card('🚗 MTD class split', clsRows.length ? C.bars({ labels: clsRows.map(([k]) => k), height: 180, series: [{ name: 'Issued', values: clsRows.map(([, v]) => v), color: '#0d9488' }], showValues: true, onClickAttr: (i) => drillAttr({ src: 'gv', scope: 'mtd', ym: currentYm, agent: r.agentName, agentId: r.agentId || '', channel: 'gv', cls: clsRows[i][0] }) }) : '<div class="empty">MTD data nahi</div>')}</div>
        <div>${card(`📅 Last month (${esc(previousYm)}) class split`, lastClsRows.length ? C.bars({ labels: lastClsRows.map(([k]) => k), height: 180, series: [{ name: 'Last month', values: lastClsRows.map(([, v]) => v), color: '#6366f1' }], showValues: true, onClickAttr: (i) => drillAttr({ src: 'gv', scope: 'month', ym: previousYm, agent: r.agentName, agentId: r.agentId || '', channel: 'gv', cls: lastClsRows[i][0] }) }) : '<div class="empty">Last month data nahi</div>')}</div>
      </div>
      <div class="grid g-2" style="margin-top:12px">
        <div>${card('📊 Class-wise Last vs MTD & Stock', cmpTable)}</div>
        <div>${card('📦 Stock by class', stockRows.length ? C.donut({ items: stockRows.map(([k, v]) => ({ label: k, value: v, attr: drillAttr({ src: 'gv', scope: 'stock', agent: r.agentName, agentId: r.agentId || '', channel: 'gv', cls: k }) })), subtitle: 'stock' }) : '<div class="empty">Stock nahi</div>')}</div>
      </div>
      ${gvTodayClassBreakdown(r)}
      ${card('📄 Full GV REPORT row', `<div class="table-wrap" style="max-height:340px"><table class="tbl compact"><thead><tr><th>#</th><th>Column</th><th>Value</th></tr></thead><tbody>${r.raw.map((v, i) => v === '' ? '' : `<tr><td class="dim">${U.colLetter(i)}</td><td>${esc((G.REPORT_COLS_LABELS && G.REPORT_COLS_LABELS[i]) || '')}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`)}
      <div class="btn-row" style="margin-top:10px">${shareBtn(`${r.agentName} (${r.tlName}) — GV stock ${U.fmt(r.stockTotal)} · MTD ${U.fmt(r.curTotal)} · last month ${U.fmt(r.lastTotal)} · growth ${r.growth === null ? '—' : `${r.growth}%`} · priority ${r.priority || '—'}`, `GV Partner report · ${r.agentName}`)}</div>`;
    FF.app.openDrawer({
      kicker: 'GV Partner · GV REPORT', title: r.agentName,
      sub: `<span class="dim">${esc(r.agentId)} · ${esc(FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : r.tlName)}${r.mobile && FF.auth.can('contacts') ? ` · 📞 <a href="tel:${esc(r.mobile)}">${esc(r.mobile)}</a>` : ''}</span>`,
      body, actions: `<button class="btn small" data-drawer-csv="${esc(r.agentName)}">⬇ CSV</button><button class="btn small primary" data-drawer-pdf="${esc(r.agentName)}">📄 PDF</button><a class="btn small" href="#/gvStock?agent=${encodeURIComponent(r.agentName)}&view=agent">📦 GV stock →</a>`,
      age: { kind: 'agent', key: r.agentId || r.agentName, keys: [r.agentName], ch: 'gv', title: r.agentName }
    });
  }

  async function renderPerformance(root, params) {
    const p = params || {};
    if (p.q !== undefined) perf.q = p.q;
    if (p.tl !== undefined) perf.tl = p.tl;
    if (p.priority !== undefined) perf.priority = p.priority;
    if (p.status !== undefined) perf.status = p.status;
    if (p.growth !== undefined) perf.growth = p.growth;
    if (p.stock !== undefined) perf.stock = p.stock;
    if (p.view && ['overview', 'agents', 'tls', 'alerts'].includes(p.view)) perf.view = p.view;
    const reportActions = `<a class="btn" href="#/gvStockReport">📋 GV Stock Report</a>${FF.auth.can('share') ? '<button class="btn" data-gvp-action="wa">🟢 WhatsApp report</button><button class="btn" data-gvp-action="mail">✉️ Email</button>' : ''}${FF.auth.can('export') ? '<button class="btn" data-gvp-action="xlsx">⬇ Excel</button><button class="btn" data-gvp-action="csv">CSV</button>' : ''}<a class="btn" href="#/compare">⚖️ Compare</a>`;
    root.innerHTML = head('🏆', 'GV Performance', 'GV REPORT — GV partner agents & TLs (stock · last month · current month · runrate)', reportActions)
      + `<div id="gvp-body">${U.spinner('GV REPORT load ho raha hai…')}</div>`;
    const body = U.$('#gvp-body', root);
    try { await Promise.all([G.need('report'), S.need('daily'), S.need('agents'), S.need('agentClass'), S.need('agentDailyClass')]); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    const all = overlayGvReportWithEir(G.get('report') || []);
    perf.sourceRows = all;
    // Re-render from local filter state. Reusing the original URL params here used to restore stale
    // q/tl values immediately after Clear or after choosing another suggestion.
    const rerender = () => renderPerformance(root, { view: perf.view });
    if (!all.length) { body.innerHTML = `<div class="empty-state">😶 GV REPORT me koi row nahi mili.<br><small class="dim">Settings → Data source → GV Partner me tab naam / gid check karo.</small></div>`; return; }
    const list = filteredReport();
    const pageSize = 50;
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    if (perf.page > pages) perf.page = pages;
    const pageRows = list.slice((perf.page - 1) * pageSize, perf.page * pageSize);
    const gvDirectCount = all.filter((r) => FF.config.isDirectAgent(r, 'gv')).length;
    const allTlOptions = [...U.groupSum(all.filter((r) => !FF.config.isDirectAgent(r, 'gv')), (r) => r.tlName, () => 1).entries()]
      .filter(([name]) => FF.config.isRealTl(name)).sort((a, b) => a[0].localeCompare(b[0]));
    const tlGroups = new Map();
    for (const r of list) {
      const direct = FF.config.isDirectAgent(r, 'gv');
      const k = direct ? `🚫 ${FF.config.directLabel(r, 'gv')}` : (r.tlName || 'TL (blank)');
      if (!tlGroups.has(k)) tlGroups.set(k, { tlName: k, tlId: direct ? '__direct__' : r.tlId, agents: 0, stock: 0, stockVc4: 0, last: 0, cur: 0, curVc4: 0, high: 0, inactive: 0 });
      const t = tlGroups.get(k);
      t.agents += 1; t.stock += r.stockTotal; t.stockVc4 += r.stockVc4; t.last += r.lastTotal; t.cur += r.curTotal; t.curVc4 += r.curVc4;
      if (/high/i.test(r.priority)) t.high += 1;
      if (/inactive/i.test(r.agentStatus)) t.inactive += 1;
    }
    const tls = [...tlGroups.values()].sort((a, b) => b.cur - a.cur);
    const totals = {
      agents: all.length, stock: U.sum(all, (r) => r.stockTotal), stockVc4: U.sum(all, (r) => r.stockVc4),
      last: U.sum(all, (r) => r.lastTotal), cur: U.sum(all, (r) => r.curTotal), curVc4: U.sum(all, (r) => r.curVc4),
      today: U.sum(all, (r) => r.todayIssued), high: all.filter((r) => /high/i.test(r.priority)).length,
      inactive: all.filter((r) => /inactive/i.test(r.agentStatus)).length,
      growing: all.filter((r) => (r.growth || 0) > 0).length
    };
    const chips = [['', 'All priority'], ['high', '🔺 High'], ['medium', '🟡 Medium'], ['low', '🟢 Low']];
    const statusChips = [['', 'All status'], ['active', 'Active'], ['inactive', 'Inactive']];
    const growthChips = [['', 'Any growth'], ['up', '↗ Growing'], ['down', '↘ De-growth'], ['flat', '→ Flat']];
    const stockChips = [['', 'All stock'], ['need', '📦 Dispatch need'], ['direct', '🚫 Direct Agents · no TL'], ['zero', '0 stock']];

    const sortTh = (key, label, num) => `<th class="${num ? 'num' : ''} sortable ${perf.sort.key === key ? 'sorted' : ''}" data-sort="${key}">${esc(label)}${perf.sort.key === key ? `<i>${perf.sort.dir === 'asc' ? '▲' : '▼'}</i>` : ''}</th>`;
    const tableRows = pageRows.map((r) => `<tr class="clickable" data-agent="${esc(r.agentName)}">
      <td><b>${esc(r.agentName)}</b><br><small class="dim">${esc(r.agentId)}</small></td>
      <td>${FF.config.isDirectAgent(r, 'gv') ? `<b class="direct-chip">🚫 ${esc(FF.config.directLabel(r, 'gv'))}</b>` : esc(r.tlName)}</td>
      <td class="num">${U.fmt(r.stockTotal)}</td><td class="num">${U.fmt(r.stockVc4)}</td><td class="num">${U.fmt(r.stockComm)}</td>
      <td class="num">${U.fmt(r.lastTotal)}</td><td class="num"><b>${U.fmt(r.curTotal)}</b></td><td class="num">${U.fmt(r.curVc4)}</td>
      <td class="num">${U.deltaHtml(r.growth, { decimals: 0 })}</td><td class="num" title="Today count source: ${esc(r.todayIssuedSource || 'GV REPORT / EIR')}">${U.fmt(r.todayIssued)}</td><td class="num">${U.fmt(r.curDays)}</td>
      <td class="num">${U.fmt(r.expected)}</td><td class="num">${U.fmt(r.runrate)}</td><td>${badge(r.priority)}</td><td>${badge(r.agentStatus)}</td></tr>`).join('');
    const alertList = list.filter((r) => /high|medium/i.test(r.priority || '') || /inactive/i.test(r.agentStatus || '') || Number(r.stockTotal) === 0 || Number(r.growth) < 0);
    const directCount = list.filter((r) => FF.config.isDirectAgent(r, 'gv')).length;
    const attentionRows = alertList.slice(0, 150).map((r) => `<tr class="clickable ${FF.config.isDirectAgent(r, 'gv') ? 'dispatch-direct' : ''}" data-agent="${esc(r.agentName)}"><td><b>${esc(r.agentName)}</b><small class="cell-sub">${esc(r.agentId)}</small></td><td>${FF.config.isDirectAgent(r, 'gv') ? '<b>Direct Agent</b>' : esc(r.tlName)}</td><td>${badge(r.priority)}</td><td>${badge(r.agentStatus)}</td><td class="num">${U.fmt(r.stockTotal)}</td><td class="num">${U.deltaHtml(r.growth, { decimals: 0 })}</td><td>${FF.config.isDirectAgent(r, 'gv') ? '<span class="tag ok">No dispatch</span>' : /high|medium/i.test(r.priority || '') ? '<span class="tag warn">Review dispatch</span>' : '<span class="dim">Review</span>'}</td></tr>`).join('');

    body.innerHTML = `
      <div class="kpi-grid">
        ${kpiS('g8', 'GV Agents (REPORT)', '🧑‍💼', U.fmt(totals.agents), `${tls.length} TLs · ${U.fmt(gvDirectCount)} direct (no TL) · ${U.fmt(totals.growing)} growing`, 'src=gv&scope=list&list=gvp.all')}
        ${kpiS('g9', 'GV Stock (REPORT)', '📦', U.fmt(totals.stock), `VC4 <b>${U.fmt(totals.stockVc4)}</b> · Comm <b>${U.fmt(totals.stock - totals.stockVc4)}</b>`, 'src=gv&scope=list&list=gvp.stock')}
        ${kpiS('g3', 'MTD Issuance', '🏷️', U.fmt(totals.cur), `VC4 <b>${U.fmt(totals.curVc4)}</b> · ${U.deltaHtml(U.growth(totals.cur, totals.last), { decimals: 0 })} vs last month (${U.fmt(totals.last)})`, `src=gv&scope=mtd&ym=${U.ymKey(new Date())}`)}
        ${kpiS('g1', 'Today Issued', '⚡', U.fmt(totals.today), 'GV Master (live) / GV REPORT "Today Issued"', `src=gv&scope=day&date=${U.dateKey(new Date())}`)}
        ${kpiS('g10', 'High Priority', '🔺', U.fmt(totals.high), `Inactive agents: <b>${U.fmt(totals.inactive)}</b>`, 'src=gv&scope=list&list=gvp.high')}
        ${kpiS('g11', 'Avg Stock / Agent', '🏬', U.fmt(totals.agents ? totals.stock / totals.agents : 0), 'GV REPORT stock column', 'src=gv&scope=list&list=gvp.stock')}
      </div>
      <div class="card controls">
        <div class="seg" id="gvp-tabs">${[['overview', '🏠 Overview'], ['agents', '🧑‍💼 Agents'], ['tls', '👥 TLs'], ['alerts', '🚨 Alerts']].map(([k, l]) => `<button class="seg-btn ${perf.view === k ? 'on' : ''}" data-gvp-view="${k}">${l}</button>`).join('')}</div>
        <div class="ctrl-row">
          <label>Quick find <span class="finder-input"><input class="input" id="gvp-q" placeholder="GV agent / TL / ID type karo → Enter" value="${esc(perf.q)}"></span></label>
          <label>TL <select id="gvp-tl"><option value="">All TLs</option>${gvDirectCount ? `<option value="__direct__" ${perf.tl === '__direct__' ? 'selected' : ''}>🚫 Direct Agents · no TL (${gvDirectCount})</option>` : ''}${allTlOptions.map(([name, count]) => `<option value="${esc(name)}" ${norm(name) === norm(perf.tl) ? 'selected' : ''}>${esc(name)} (${count})</option>`).join('')}</select></label>
          <span class="chip-row">${chips.map(([k, l]) => `<button class="chip ${perf.priority === k ? 'on' : ''}" data-priority="${k}">${l}</button>`).join('')}</span>
          <span class="chip-row">${statusChips.map(([k, l]) => `<button class="chip ${perf.status === k ? 'on' : ''}" data-status="${k}">${l}</button>`).join('')}</span>
          <label>Growth <select id="gvp-growth">${growthChips.map(([k, l]) => `<option value="${k}" ${perf.growth === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Stock / dispatch <select id="gvp-stock">${stockChips.map(([k, l]) => `<option value="${k}" ${perf.stock === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${perf.q || perf.tl || perf.priority || perf.status || perf.growth || perf.stock ? '<button class="btn small" id="gvp-clear">✕ Clear filters</button>' : ''}
          <span class="ctrl-note"><b>${U.fmt(list.length)}</b> / ${U.fmt(all.length)} agents</span>
        </div>
      </div>
      <div class="gvp-view" ${perf.view !== 'overview' ? 'hidden' : ''}><div class="grid g-2">
        ${card(`⭐ Top GV agents · MTD`, C.hbars({ items: list.slice(0, 12).map((r, i) => ({ label: r.agentName, sub: FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : r.tlName, value: r.curTotal, compare: r.lastTotal, color: C.PALETTE[i % C.PALETTE.length], attr: `data-agent="${esc(r.agentName)}"` })), compareLabel: 'Last month', valueLabel: 'MTD' }))}
        ${card(`🏅 GV TL rollup`, C.hbars({ items: tls.slice(0, 12).map((t, i) => ({ label: t.tlName, sub: `${t.agents} agents · stock ${U.fmtShort(t.stock)}`, value: t.cur, compare: t.last, color: C.PALETTE[(i + 3) % C.PALETTE.length] })), compareLabel: 'Last month', valueLabel: 'MTD' }))}
      </div></div>
      <div class="gvp-view" ${perf.view !== 'agents' ? 'hidden' : ''}>${card('📋 GV agents', `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent</th><th>TL</th>${PERF_COLS.slice(2).map((c) => sortTh(c.key, c.label, c.num)).join('')}</tr></thead><tbody>${tableRows || `<tr><td colspan="15" class="empty">Koi agent match nahi hua</td></tr>`}</tbody></table></div>
        <div class="pager"><button class="btn small" data-gvp-pg="prev" ${perf.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${perf.page} / ${U.fmt(pages)}</span><button class="btn small" data-gvp-pg="next" ${perf.page >= pages ? 'disabled' : ''}>Next ›</button></div>`, { right: `${FF.auth.can('share') ? `<button class="btn small" data-share="wa" data-text="${esc(`GV Partner MTD ${U.fmt(totals.cur)} tags · stock ${U.fmt(totals.stock)} · ${tls.length} TLs`)}">🟢 Share</button>` : ''}` })}</div>
      <div class="gvp-view" ${perf.view !== 'tls' ? 'hidden' : ''}>${card('👥 GV TL-wise summary', tableHtml(['#', 'TL', 'Agents', 'Stock', 'Stock VC4', 'Last month', 'MTD', 'MTD VC4', 'High prio', 'Inactive'], tls.map((t, i) => `<tr data-link="${t.tlId === '__direct__' ? '#/directAgents' : `#/gvPerformance?tl=${encodeURIComponent(t.tlName)}`}"><td class="dim">${i + 1}</td><td><b>${esc(t.tlName)}</b></td><td class="num">${U.fmt(t.agents)}</td><td class="num">${U.fmt(t.stock)}</td><td class="num">${U.fmt(t.stockVc4)}</td><td class="num">${U.fmt(t.last)}</td><td class="num"><b>${U.fmt(t.cur)}</b></td><td class="num">${U.fmt(t.curVc4)}</td><td class="num">${U.fmt(t.high)}</td><td class="num">${U.fmt(t.inactive)}</td></tr>`), 2), { right: exportBtn('gv-tl-summary') })}</div>
      <div class="gvp-view" ${perf.view !== 'alerts' ? 'hidden' : ''}>
        <div class="mini-grid">${miniKpi('Attention list', U.fmt(alertList.length), 'priority / inactive / zero-stock / de-growth', 'c4', { scope: 'list', list: 'gvp.f.attention' })}${miniKpi('High priority', U.fmt(list.filter((r) => /high/i.test(r.priority || '')).length), 'dispatch review', 'c6', { scope: 'list', list: 'gvp.f.high' })}${miniKpi('Inactive', U.fmt(list.filter((r) => /inactive/i.test(r.agentStatus || '')).length), 'follow-up', 'c2', { scope: 'list', list: 'gvp.f.inactive' })}${miniKpi('Direct agents', U.fmt(directCount), 'stock dispatch not required', 'c3', { scope: 'list', list: 'gvp.f.direct' })}</div>
        ${card('🚨 GV attention & dispatch watch', `<div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th>TL / class</th><th>Priority</th><th>Status</th><th class="num">Stock</th><th class="num">Growth</th><th>Action</th></tr></thead><tbody>${attentionRows || '<tr><td colspan="7" class="empty">Current filters me koi alert nahi.</td></tr>'}</tbody></table></div>`, { right: `<span class="dim">${U.fmt(alertList.length)} rows</span>` })}
      </div>
      <p class="foot-note">Source: GV Partner sheet → <b>GV REPORT</b> tab (agent-wise) · ${U.fmt(all.length)} agents · Loaded ${U.timeLabel(G.loadedAt || D.lastLoadAt)}</p>`;

    const summaryText = () => {
      const top = list.slice().sort((a, b) => b.curTotal - a.curTotal).slice(0, 5);
      return [`*GV Partner Performance Report*`, `Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}${list.length !== all.length ? ' · filtered view' : ''}`, '', `MTD issuance: *${U.fmt(totals.cur)}* (VC4 ${U.fmt(totals.curVc4)})`, `Last month: ${U.fmt(totals.last)} · Growth ${totals.last ? U.fmtSigned(U.growth(totals.cur, totals.last), 0) : '—'}`, `Today: ${U.fmt(totals.today)}`, `Stock: *${U.fmt(totals.stock)}* (VC4 ${U.fmt(totals.stockVc4)})`, `Agents: ${U.fmt(totals.agents)} · TLs: ${U.fmt(tls.length)}`, `High priority: ${U.fmt(totals.high)} · Inactive: ${U.fmt(totals.inactive)}`, '', '*Top agents (MTD)*', ...top.map((r, i) => `${i + 1}. ${r.agentName} — ${U.fmt(r.curTotal)} · ${r.tlName}`), '', 'Generated by First Forward & GV Partner Dashboard'].join('\n');
    };
    U.$$('[data-gvp-action]', root).forEach((button) => button.addEventListener('click', async () => {
      const action = button.dataset.gvpAction;
      if (action === 'wa') {
        const text = summaryText(); await U.copyText(text); window.open(U.waLink(text, FF.config.contacts.teamWhatsapp), '_blank', 'noopener'); U.toast('GV report copied — WhatsApp khul raha hai', 'ok'); return;
      }
      if (action === 'mail') { location.href = U.mailLink('GV Partner performance report', summaryText(), FF.config.contacts.teamEmail); return; }
      const header = PERF_COLS.map((c) => c.label);
      const cell = (r, c) => (c.key === 'tlName' && FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : (r[c.key] == null ? '' : r[c.key]));
      const rows = list.map((r) => PERF_COLS.map((c) => cell(r, c)));
      if (action === 'csv') { U.downloadCsv(`gv-performance-${U.stamp()}.csv`, header, rows); U.toast(`${U.fmt(rows.length)} GV agents CSV ready`, 'ok'); return; }
      if (action === 'xlsx') {
        const tlHeader = ['TL', 'Agents', 'Stock', 'Stock VC4', 'Last month', 'MTD', 'MTD VC4', 'High priority', 'Inactive'];
        const tlRows = tls.map((t) => [t.tlName, t.agents, t.stock, t.stockVc4, t.last, t.cur, t.curVc4, t.high, t.inactive]);
        FF.xlsx.download(`gv-performance-${U.stamp()}.xlsx`, [
          { name: 'Summary', header: ['Metric', 'Value'], rows: [['Agents', totals.agents], ['TLs', tls.length], ['Stock', totals.stock], ['Stock VC4', totals.stockVc4], ['MTD', totals.cur], ['Last month', totals.last], ['Today', totals.today], ['High priority', totals.high], ['Inactive', totals.inactive]] },
          { name: 'Agents', header, rows }, { name: 'TL Summary', header: tlHeader, rows: tlRows }
        ]);
        U.toast('GV Performance Excel ready', 'ok');
      }
    }));

    // interactions
    const q = U.$('#gvp-q', body);
    U.suggest(q, {
      items: () => all.map((r) => ({ kind: 'agent', kindLabel: 'GV Agent', label: r.agentName, sub: `${r.tlName} · MTD ${U.fmt(r.curTotal)}`, value: r.agentName })),
      onPick: (it) => {
        if (it.value && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('GV Performance', it.value);
        perf.q = it.value; perf.page = 1; rerender();
      },
      onEnter: (v) => {
        if (v && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('GV Performance', v);
        perf.q = v; perf.page = 1; rerender();
      }
    });
    U.$('#gvp-tl', body).addEventListener('change', (e) => { perf.tl = e.target.value; perf.page = 1; rerender(); });
    U.$('#gvp-growth', body).addEventListener('change', (e) => { perf.growth = e.target.value; perf.page = 1; rerender(); });
    U.$('#gvp-stock', body).addEventListener('change', (e) => { perf.stock = e.target.value; perf.page = 1; rerender(); });
    const clr = U.$('#gvp-clear', body);
    if (clr) clr.addEventListener('click', () => { perf.q = ''; perf.tl = ''; perf.priority = ''; perf.status = ''; perf.growth = ''; perf.stock = ''; perf.page = 1; rerender(); });
    body.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-gvp-view]');
      if (tab) { perf.view = tab.dataset.gvpView; perf.page = 1; history.replaceState(null, '', `#/gvPerformance?view=${perf.view}`); rerender(); return; }
      const chip = e.target.closest('[data-priority]');
      if (chip) { perf.priority = chip.dataset.priority; perf.page = 1; rerender(); return; }
      const st = e.target.closest('[data-status]');
      if (st) { perf.status = st.dataset.status; perf.page = 1; rerender(); return; }
      const pgb = e.target.closest('[data-gvp-pg]');
      if (pgb) { perf.page += pgb.dataset.gvpPg === 'next' ? 1 : -1; rerender(); return; }
      const th = e.target.closest('th.sortable');
      if (th) { const k = th.dataset.sort; if (perf.sort.key === k) perf.sort.dir = perf.sort.dir === 'asc' ? 'desc' : 'asc'; else { perf.sort.key = k; perf.sort.dir = 'desc'; } rerender(); return; }
      const row = e.target.closest('tr[data-agent]');
      if (row) { const r = all.find((x) => x.agentName === row.dataset.agent); if (r) agentDrawer(r); }
    });
    if (p.q) {
      const hit = all.find((r) => norm(r.agentName) === norm(p.q)) || all.find((r) => norm(r.agentName).includes(norm(p.q)));
      if (hit) setTimeout(() => { if (root.isConnected) agentDrawer(hit); }, 60);
    }
  }


  // ================================================================================================
  // 📋 GV Stock Report — GV REPORT stock depth + Tag Assignment source reconciliation
  // ================================================================================================
  const stockReportState = { view: 'agents', q: '', tl: '', cls: '', dispatch: '', page: 1, pageSize: 75 };

  async function renderStockReport(root, params) {
    const p = params || {};
    if (p.view && ['agents', 'tls', 'classes', 'dispatch'].includes(p.view)) stockReportState.view = p.view;
    if (p.q !== undefined) stockReportState.q = p.q;
    if (p.tl !== undefined) stockReportState.tl = p.tl;
    if (p.cls !== undefined) stockReportState.cls = p.cls;
    if (p.dispatch !== undefined) stockReportState.dispatch = p.dispatch;
    const topActions = `<a class="btn" href="#/gvStock">📦 GV Stock</a><a class="btn" href="#/gvPerformance">🏆 Performance</a>${FF.auth.can('share') ? '<button class="btn" data-gvsr-action="wa">🟢 WhatsApp</button><button class="btn" data-gvsr-action="mail">✉️ Email</button>' : ''}${FF.auth.can('export') ? '<button class="btn" data-gvsr-action="xlsx">⬇ Excel</button><button class="btn" data-gvsr-action="csv">CSV</button>' : ''}`;
    root.innerHTML = head('📋', 'GV Stock Report', 'GV REPORT agent inventory + Tag Assignment reconciliation · dispatch-ready analysis', topActions)
      + `<div id="gvsr-body">${U.spinner('GV stock report load ho raha hai…')}</div>`;
    const body = U.$('#gvsr-body', root);
    try { await Promise.all(['report', 'stockClass', 'stockTl', 'stockAgent', 'stockAgentClass'].map((key) => G.need(key))); }
    catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    const all = G.get('report') || [];
    if (!all.length) { body.innerHTML = '<div class="empty-state">GV REPORT me stock rows nahi mili.</div>'; return; }
    const assignmentClass = G.get('stockClass') || [];
    const assignmentTotal = U.sum(assignmentClass, (r) => r.n);
    const classNames = U.uniq(all.flatMap((r) => Object.keys(r.stockByClass || {}))).sort((a, b) => G.clsNum(a) - G.clsNum(b));
    const gvDirectList = all.filter((r) => FF.config.isDirectAgent(r, 'gv'));
    const tlNames = U.uniq(all.filter((r) => !FF.config.isDirectAgent(r, 'gv')).map((r) => r.tlName))
      .filter((name) => FF.config.isRealTl(name)).sort((a, b) => a.localeCompare(b));
    const qn = norm(stockReportState.q);
    const filtered = all.filter((r) => {
      const direct = FF.config.isDirectAgent(r, 'gv');
      if (qn && !norm(`${r.agentName} ${r.agentId} ${r.tlName} ${r.mobile || ''}`).includes(qn)) return false;
      if (stockReportState.tl === '__direct__') { if (!direct) return false; }
      else if (stockReportState.tl && norm(r.tlName) !== norm(stockReportState.tl)) return false;
      if (stockReportState.cls && Number((r.stockByClass || {})[stockReportState.cls] || 0) <= 0) return false;
      if (stockReportState.dispatch === 'direct' && !direct) return false;
      if (stockReportState.dispatch === 'directTag' && !(direct && /high|medium/i.test(r.priority || ''))) return false;
      if (stockReportState.dispatch === 'need' && (direct || !/high|medium/i.test(r.priority || ''))) return false;
      if (stockReportState.dispatch === 'zero' && Number(r.stockTotal) !== 0) return false;
      return true;
    }).sort((a, b) => b.stockTotal - a.stockTotal || a.agentName.localeCompare(b.agentName));
    const totals = { stock: U.sum(filtered, (r) => r.stockTotal), vc4: U.sum(filtered, (r) => r.stockVc4), comm: U.sum(filtered, (r) => r.stockComm), direct: filtered.filter((r) => FF.config.isDirectAgent(r, 'gv')).length, directTag: filtered.filter((r) => FF.config.isDirectAgent(r, 'gv') && /high|medium/i.test(r.priority || '')).length };
    totals.need = filtered.filter((r) => !FF.config.isDirectAgent(r, 'gv') && /high|medium/i.test(r.priority || '')).length;
    const tlMap = new Map();
    for (const r of filtered) {
      const name = FF.config.isDirectAgent(r, 'gv') ? '🚫 Direct Agents (no TL)' : (r.tlName || 'TL (blank)');
      if (!tlMap.has(name)) tlMap.set(name, { name, agents: 0, stock: 0, vc4: 0, comm: 0, high: 0, zero: 0 });
      const t = tlMap.get(name); t.agents += 1; t.stock += r.stockTotal; t.vc4 += r.stockVc4; t.comm += r.stockComm;
      if (/high/i.test(r.priority || '')) t.high += 1; if (!r.stockTotal) t.zero += 1;
    }
    const tls = [...tlMap.values()].sort((a, b) => b.stock - a.stock);
    const classes = classNames.map((name) => ({ name, stock: U.sum(filtered, (r) => Number((r.stockByClass || {})[name] || 0)) })).filter((r) => r.stock > 0);
    const days = Number(FF.config.features && FF.config.features.suggestDays) || 15;
    const dispatch = filtered.filter((r) => /high|medium/i.test(r.priority || '') || FF.config.isDirectAgent(r, 'gv')).map((r) => {
      const direct = FF.config.isDirectAgent(r, 'gv'), daily = U.runRate(r.curVc4, 'gv');
      const calculated = Math.max(0, Math.ceil(daily * days - r.stockVc4));
      const gross = Math.max(0, Math.ceil(daily * days)); // bina stock ghataye
      return { r, direct, daily, suggested: calculated, gross, cover: daily > 0 ? r.stockVc4 / daily : null, tag: direct && /high|medium/i.test(r.priority || '') };
    }).sort((a, b) => (a.direct - b.direct) || (a.cover ?? 9999) - (b.cover ?? 9999));
    const pages = Math.max(1, Math.ceil(filtered.length / stockReportState.pageSize));
    stockReportState.page = Math.min(pages, Math.max(1, stockReportState.page));
    const pageRows = filtered.slice((stockReportState.page - 1) * stockReportState.pageSize, stockReportState.page * stockReportState.pageSize);
    const discrepancy = totals.stock - assignmentTotal;
    const rerender = () => renderStockReport(root, { view: stockReportState.view });
    const controls = `<div class="card controls"><div class="seg">${[['agents', '🧑‍💼 Agents'], ['tls', '👥 TLs'], ['classes', '🚗 Classes'], ['dispatch', '🎯 Dispatch / Direct']].map(([key, label]) => `<button class="seg-btn ${stockReportState.view === key ? 'on' : ''}" data-gvsr-view="${key}">${label}</button>`).join('')}</div><div class="ctrl-row">
      <label>Find <input class="input" id="gvsr-q" placeholder="Agent / TL / ID / mobile" value="${esc(stockReportState.q)}"></label>
      <label>TL <select id="gvsr-tl"><option value="">All TLs</option>${gvDirectList.length ? `<option value="__direct__" ${stockReportState.tl === '__direct__' ? 'selected' : ''}>🚫 Direct Agents · no TL (${gvDirectList.length})</option>` : ''}${tlNames.map((name) => `<option value="${esc(name)}" ${norm(name) === norm(stockReportState.tl) ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
      <label>Class <select id="gvsr-cls"><option value="">All classes</option>${classNames.map((name) => `<option value="${esc(name)}" ${name === stockReportState.cls ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
      <label>Dispatch <select id="gvsr-dispatch"><option value="">All agents</option><option value="need" ${stockReportState.dispatch === 'need' ? 'selected' : ''}>📦 Dispatch need</option><option value="directTag" ${stockReportState.dispatch === 'directTag' ? 'selected' : ''}>🏷️ Direct · High/Medium · tag required</option><option value="direct" ${stockReportState.dispatch === 'direct' ? 'selected' : ''}>🚫 Direct · all</option><option value="zero" ${stockReportState.dispatch === 'zero' ? 'selected' : ''}>0 stock</option></select></label>
      ${stockReportState.q || stockReportState.tl || stockReportState.cls || stockReportState.dispatch ? '<button class="btn small" id="gvsr-clear">✕ Clear</button>' : ''}<span class="ctrl-note"><b>${U.fmt(filtered.length)}</b> / ${U.fmt(all.length)} agents</span></div></div>`;
    const agentRows = pageRows.map((r) => `<tr class="clickable ${FF.config.isDirectAgent(r, 'gv') ? 'dispatch-direct' : ''}" data-gvsr-agent="${esc(r.agentName)}"><td><b>${esc(r.agentName)}</b><small class="cell-sub">${esc(r.agentId)}</small></td><td>${FF.config.isDirectAgent(r, 'gv') ? '<b>Direct Agent</b><small class="cell-sub">No dispatch</small>' : esc(r.tlName)}</td>${classNames.map((name) => `<td class="num">${U.fmt((r.stockByClass || {})[name] || 0)}</td>`).join('')}<td class="num"><b>${U.fmt(r.stockTotal)}</b></td><td class="num">${U.fmt(r.curVc4)}</td><td>${badge(r.priority)}</td><td>${FF.config.isDirectAgent(r, 'gv') ? '<span class="tag ok">Not required</span>' : /high|medium/i.test(r.priority || '') ? '<span class="tag warn">Review</span>' : '<span class="dim">—</span>'}</td></tr>`).join('');
    const agentTable = card('📋 Agent inventory detail', `<div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th>TL / class</th>${classNames.map((name) => `<th class="num">${esc(name)}</th>`).join('')}<th class="num">Total</th><th class="num">MTD VC4</th><th>Priority</th><th>Dispatch</th></tr></thead><tbody>${agentRows || `<tr><td colspan="${classNames.length + 7}" class="empty">No matching agents</td></tr>`}</tbody></table></div><div class="pager"><button class="btn small" data-gvsr-page="prev" ${stockReportState.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${stockReportState.page} / ${pages}</span><button class="btn small" data-gvsr-page="next" ${stockReportState.page >= pages ? 'disabled' : ''}>Next ›</button></div>`);
    const tlTable = card('👥 TL stock rollup', tableHtml(['#', 'TL / class', 'Agents', 'VC4', 'Commercial', 'Total stock', 'High priority', 'Zero stock'], tls.map((t, i) => `<tr class="${/Direct Agents/.test(t.name) ? 'direct-row' : ''}"><td class="dim">${i + 1}</td><td><b>${esc(t.name)}</b></td><td class="num">${U.fmt(t.agents)}</td><td class="num">${U.fmt(t.vc4)}</td><td class="num">${U.fmt(t.comm)}</td><td class="num"><b>${U.fmt(t.stock)}</b></td><td class="num">${U.fmt(t.high)}</td><td class="num">${U.fmt(t.zero)}</td></tr>`), 2));
    const classView = `<div class="grid g-2">${card('🍩 GV REPORT stock mix', C.donut({ items: classes.map((r) => ({ label: r.name, value: r.stock })), subtitle: 'report stock' }))}${card('📊 Class totals', tableHtml(['Class', 'GV REPORT stock', 'Share'], classes.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td class="num">${U.fmt(r.stock)}</td><td class="num">${U.fmtPct(U.pctOf(r.stock, totals.stock), 1)}</td></tr>`), 1))}</div>${card('🔎 Source reconciliation', `<div class="reconcile-grid"><div><span>GV REPORT (current filters)</span><b>${U.fmt(totals.stock)}</b></div><div><span>Tag Assignment (all in-stock tags)</span><b>${U.fmt(assignmentTotal)}</b></div><div class="${discrepancy ? 'warn' : 'ok'}"><span>Difference</span><b>${discrepancy > 0 ? '+' : ''}${U.fmt(discrepancy)}</b></div></div><p class="dim small">Filters GV REPORT side par apply hote hain; Tag Assignment figure poora operational source total hai. Difference reconciliation cue hai, error ka automatic proof nahi.</p>`)} `;
    // Dispatch view ab do alag hisso me hai: (1) jinhe stock chahiye — dispatch plan,
    // (2) Direct/APS agents ki ALAG list — inko kabhi stock dispatch nahi hota.
    const dispatchNeed = dispatch.filter((d) => !d.direct);
    const directAgents = filtered.filter((r) => FF.config.isDirectAgent(r, 'gv')).sort((a, b) => b.stockTotal - a.stockTotal);
    const dispatchRows = dispatchNeed.slice(0, 200).map(({ r, daily, suggested, gross, cover }) => `<tr class="clickable" data-gvsr-agent="${esc(r.agentName)}"><td><b>${esc(r.agentName)}</b><small class="cell-sub">${esc(r.agentId)}</small></td><td>${esc(r.tlName)}</td><td>${badge(r.priority)}</td><td class="num">${U.fmt(r.stockVc4)}</td><td class="num">${U.fmt(daily, true)}</td><td class="num">${cover == null ? '—' : U.fmt(cover, true)}</td><td>${U.sugCell(suggested, gross)}</td></tr>`).join('');
    const totalSuggested = U.sum(dispatchNeed, (d) => d.suggested);
    const totalSuggestedGross = U.sum(dispatchNeed, (d) => d.gross);
    // 🏷️ Direct + High/Medium priority = stock nahi, par TAG chahiye → apni alag list (suggested tags ke saath)
    const directTagList = dispatch.filter((d) => d.tag).sort((a, b) => (a.cover ?? 9999) - (b.cover ?? 9999));
    const directTagRows = directTagList.slice(0, 200).map(({ r, daily, suggested, gross, cover }) => `<tr class="clickable dispatch-direct" data-gvsr-agent="${esc(r.agentName)}"><td><b>${esc(r.agentName)}</b><small class="cell-sub">${esc(r.agentId)}${r.mobile && FF.auth.can('contacts') ? ` · ${esc(r.mobile)}` : ''}</small></td><td><b>Direct Agent</b><small class="cell-sub">${esc(FF.direct ? FF.direct.reason(r, 'gv') : 'TL ID + TL Name blank')}</small></td><td>${badge(r.priority)}</td><td class="num">${U.fmt(r.stockVc4)}<small class="cell-sub">total ${U.fmt(r.stockTotal)}</small></td><td class="num">${U.fmt(daily, true)}</td><td class="num">${cover == null ? '—' : U.fmt(cover, true)}</td><td><span class="tag warn">🏷️ Tag required</span> <b class="sug-chip direct">🏷️ ${U.fmt(suggested)} tags</b>${U.suggestMode() === 'both' ? `<span class="sug-wo">w/o stock <b>${U.fmt(gross)}</b></span>` : ''}</td></tr>`).join('');
    const directOther = directAgents.filter((r) => !/high|medium/i.test(r.priority || ''));
    const directRowsHtml = directOther.slice(0, 200).map((r) => `<tr class="clickable dispatch-direct" data-gvsr-agent="${esc(r.agentName)}"><td><b>${esc(r.agentName)}</b><small class="cell-sub">${esc(r.agentId)}</small></td><td><b>Direct Agent</b><small class="cell-sub">${esc(FF.direct ? FF.direct.reason(r, 'gv') : 'TL ID + TL Name blank')}</small></td><td>${badge(r.priority)}</td><td>${badge(r.agentStatus || 'active')}</td><td class="num">${U.fmt(r.stockTotal)}</td><td class="num">${U.fmt(r.curVc4)}</td><td><span class="tag ok">No dispatch required</span></td></tr>`).join('');
    const dispatchView = `<div class="dispatch-filter-bar"><span><b>Dispatch plan me sirf TL-managed agents · Direct agents alag: High/Medium ko 🏷️ tag chahiye, baaki ko kuch nahi</b></span><span class="btn-row"><button class="btn small direct-filter" data-gvsr-directtag="1">🏷️ Direct · High/Medium · Tag required · ${U.fmt(totals.directTag)}</button><button class="btn small direct-filter" data-gvsr-direct="1">🚫 Direct filter · ${U.fmt(totals.direct)}</button></span></div>
      <div class="grid g-2">
      ${card('📦 GV Dispatch plan — stock chahiye', `<div class="dispatch-mini"><span>Agents needing stock <b>${U.fmt(dispatchNeed.length)}</b></span><span>Total (stock −) <b>${U.fmt(totalSuggested)}</b></span><span>Total bina stock <b>${U.fmt(totalSuggestedGross)}</b></span><span>Target cover <b>${days} din</b></span></div><div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th>TL / class</th><th>Priority</th><th class="num">VC4 stock</th><th class="num">Run-rate VC4/day</th><th class="num">Cover</th><th>Suggested qty 🎯<br><small class="dim">stock − · w/o stock</small></th></tr></thead><tbody>${dispatchRows || '<tr><td colspan="7" class="empty">Current filters me dispatch ki zarurat nahi.</td></tr>'}</tbody></table></div><p class="dim small"><b>Stock ke baad</b> = run-rate × ${days} − stock (run-rate = issue ÷ (aaj − 1) din) · <b>w/o stock</b> = bina stock ghataye (run-rate × ${days}) · Direct agents yahan nahi aate — unki alag list side me hai.</p>`)}
      ${card('🏷️ Direct Agents · High/Medium — TAG required', `<div class="dispatch-mini"><span>Direct agents needing tags <b>${U.fmt(directTagList.length)}</b></span><span>Suggested tags <b>${U.fmt(U.sum(directTagList, (d) => d.suggested))}</b></span><span>Target cover <b>${days} din</b></span></div><div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th>Type</th><th>Priority</th><th class="num">VC4 stock</th><th class="num">Run-rate VC4/day</th><th class="num">Cover</th><th>Tag dispatch 🏷️</th></tr></thead><tbody>${directTagRows || '<tr><td colspan="7" class="empty">Current filters me koi High/Medium Direct agent nahi.</td></tr>'}</tbody></table></div><p class="dim small">Direct (no TL) agents ko stock box nahi jaata, par jinki priority <b>High/Medium</b> hai unhe <b>tags chahiye</b> — suggested tags = run-rate × ${days} − stock (run-rate = issue ÷ (aaj − 1) din).</p>`)}
      </div>
      ${card('🚫 Other Direct Agents — no dispatch', `<div class="dispatch-mini"><span>Direct agents (Low / no priority) <b>${U.fmt(directOther.length)}</b></span><span>Inka stock <b>${U.fmt(U.sum(directOther, (r) => r.stockTotal))}</b></span><span>MTD VC4 <b>${U.fmt(U.sum(directOther, (r) => r.curVc4))}</b></span></div><div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th>Type</th><th>Priority</th><th>Status</th><th class="num">Total stock</th><th class="num">MTD VC4</th><th>Dispatch</th></tr></thead><tbody>${directRowsHtml || '<tr><td colspan="7" class="empty">Current filters me aur koi Direct agent nahi.</td></tr>'}</tbody></table></div><p class="dim small">Low priority direct agents ko abhi kuch dispatch nahi hota — sirf visibility ke liye alag rakha hai.</p>`)}`;
    gvsrLast = filtered; // 📋 v3.31 — tiles ke drill-down isi filtered list se (card = list)
    body.innerHTML = `${FF.direct ? FF.direct.ruleBanner('gv') : ''}<div class="kpi-grid six">${kpiS('g9', 'GV REPORT Stock', '📦', U.fmt(totals.stock), `${U.fmt(filtered.length)} filtered agents`, 'src=gv&scope=list&list=gvsr.stock')}${kpiS('g3', 'VC4 Stock', '🚗', U.fmt(totals.vc4), `${U.fmtPct(U.pctOf(totals.vc4, totals.stock), 0)} of report stock`, 'src=gv&scope=list&list=gvsr.vc4')}${kpiS('g8', 'Commercial Stock', '🏷️', U.fmt(totals.comm), `${U.fmtPct(U.pctOf(totals.comm, totals.stock), 0)} of report stock`, 'src=gv&scope=list&list=gvsr.comm')}${kpiS('g12', 'Tag Assignment', '🔗', U.fmt(assignmentTotal), `source difference ${discrepancy > 0 ? '+' : ''}${U.fmt(discrepancy)}`, 'src=gv&scope=stock')}${kpiS('g10', 'Dispatch Review', '🎯', U.fmt(totals.need), 'High + Medium, Direct excluded', 'src=gv&scope=list&list=gvsr.need')}${kpiS('g5', 'Direct Agents (no TL)', '🚫', U.fmt(totals.direct), `${U.fmt(totals.directTag)} High/Medium need 🏷️ tags · rest no dispatch`, 'src=gv&scope=list&list=gvsr.direct')}</div>${controls}<div class="gvsr-view">${stockReportState.view === 'agents' ? agentTable : stockReportState.view === 'tls' ? tlTable : stockReportState.view === 'classes' ? classView : dispatchView}</div><p class="foot-note">Sources: <b>GV REPORT</b> + <b>Tag Assignment</b> · Report agents ${U.fmt(all.length)} · Loaded ${U.timeLabel(G.loadedAt || D.lastLoadAt)}</p>`;
    C.mount(body);
    const summary = () => [`*GV Stock Report*`, `Agents: ${U.fmt(filtered.length)} / ${U.fmt(all.length)}`, `GV REPORT stock: *${U.fmt(totals.stock)}* (VC4 ${U.fmt(totals.vc4)} · Commercial ${U.fmt(totals.comm)})`, `Tag Assignment stock: ${U.fmt(assignmentTotal)} · Difference ${discrepancy > 0 ? '+' : ''}${U.fmt(discrepancy)}`, `Dispatch review: ${U.fmt(totals.need)} · Direct/no-dispatch: ${U.fmt(totals.direct)}`, '', ...tls.slice(0, 5).map((t, i) => `${i + 1}. ${t.name} — ${U.fmt(t.stock)} stock`), '', 'Generated by First Forward & GV Partner Dashboard'].join('\n');
    U.$$('[data-gvsr-action]', root).forEach((button) => button.addEventListener('click', async () => {
      const action = button.dataset.gvsrAction;
      if (action === 'wa') { const text = summary(); await U.copyText(text); window.open(U.waLink(text, FF.config.contacts.teamWhatsapp), '_blank', 'noopener'); U.toast('GV Stock Report copied', 'ok'); return; }
      if (action === 'mail') { location.href = U.mailLink('GV Stock Report', summary(), FF.config.contacts.teamEmail); return; }
      const header = ['Agent ID', 'Agent', 'TL / class', ...classNames, 'VC4', 'Commercial', 'Total', 'Priority', 'Dispatch status'];
      const rows = filtered.map((r) => [r.agentId, r.agentName, FF.config.isDirectAgent(r, 'gv') ? 'Direct Agent' : r.tlName, ...classNames.map((name) => Number((r.stockByClass || {})[name] || 0)), r.stockVc4, r.stockComm, r.stockTotal, r.priority, FF.config.isDirectAgent(r, 'gv') ? (/high|medium/i.test(r.priority || '') ? 'Tag required' : 'No dispatch') : /high|medium/i.test(r.priority || '') ? 'Review' : '']);
      if (action === 'csv') { U.downloadCsv(`gv-stock-report-${U.stamp()}.csv`, header, rows); U.toast('GV Stock CSV ready', 'ok'); return; }
      if (action === 'xlsx') { FF.xlsx.download(`gv-stock-report-${U.stamp()}.xlsx`, [{ name: 'Summary', header: ['Metric', 'Value'], rows: [['Agents', filtered.length], ['GV REPORT stock', totals.stock], ['VC4', totals.vc4], ['Commercial', totals.comm], ['Tag Assignment', assignmentTotal], ['Difference', discrepancy], ['Dispatch review', totals.need], ['Direct agents', totals.direct]] }, { name: 'Agents', header, rows }, { name: 'TL Summary', header: ['TL', 'Agents', 'VC4', 'Commercial', 'Total', 'High priority', 'Zero stock'], rows: tls.map((t) => [t.name, t.agents, t.vc4, t.comm, t.stock, t.high, t.zero]) }, { name: 'Classes', header: ['Class', 'Stock'], rows: classes.map((r) => [r.name, r.stock]) }, { name: 'Dispatch', header: ['Agent', 'TL / class', 'Priority', 'VC4 stock', 'Run-rate VC4/day', 'Cover', 'Suggested (stock −)', 'Suggested (bina stock)', 'Status'], rows: dispatch.map((d) => [d.r.agentName, d.direct ? 'Direct Agent' : d.r.tlName, d.r.priority, d.r.stockVc4, d.daily, d.cover == null ? '' : d.cover, d.suggested, d.gross, d.direct ? (d.tag ? 'Tag required' : 'No dispatch') : 'Review']) }]); U.toast('GV Stock Report Excel ready', 'ok'); }
    }));
    const find = U.$('#gvsr-q', body);
    U.suggest(find, { items: () => all.map((r) => ({ kind: 'agent', kindLabel: FF.config.isDirectAgent(r, 'gv') ? 'Direct Agent' : 'GV Agent', label: r.agentName, sub: `${r.tlName} · stock ${U.fmt(r.stockTotal)}`, keywords: `${r.agentId} ${r.mobile || ''}` })), onPick: (it) => { stockReportState.q = it.label; stockReportState.page = 1; rerender(); }, onEnter: (value) => { stockReportState.q = value; stockReportState.page = 1; rerender(); } });
    [['gvsr-tl', 'tl'], ['gvsr-cls', 'cls'], ['gvsr-dispatch', 'dispatch']].forEach(([id, key]) => U.$(`#${id}`, body).addEventListener('change', (e) => { stockReportState[key] = e.target.value; stockReportState.page = 1; rerender(); }));
    const clear = U.$('#gvsr-clear', body); if (clear) clear.addEventListener('click', () => { Object.assign(stockReportState, { q: '', tl: '', cls: '', dispatch: '', page: 1 }); rerender(); });
    body.addEventListener('click', (e) => {
      const view = e.target.closest('[data-gvsr-view]'); if (view) { stockReportState.view = view.dataset.gvsrView; stockReportState.page = 1; history.replaceState(null, '', `#/gvStockReport?view=${stockReportState.view}`); rerender(); return; }
      const pg = e.target.closest('[data-gvsr-page]'); if (pg) { stockReportState.page += pg.dataset.gvsrPage === 'next' ? 1 : -1; rerender(); return; }
      const direct = e.target.closest('[data-gvsr-direct]'); if (direct) { stockReportState.dispatch = 'direct'; stockReportState.page = 1; rerender(); return; }
      const directTag = e.target.closest('[data-gvsr-directtag]'); if (directTag) { stockReportState.dispatch = 'directTag'; stockReportState.page = 1; rerender(); return; }
      const row = e.target.closest('[data-gvsr-agent]'); if (row) { const r = all.find((item) => item.agentName === row.dataset.gvsrAgent); if (r) agentDrawer(r); }
    });
  }

  FF.pages.gvDashboard = { title: 'GV Partner Dashboard', render: renderDashboard };
  FF.pages.gvTrend = { title: 'GV Trend', render: renderTrend };
  FF.pages.gvStock = { title: 'GV Stock', render: renderStock };
  FF.pages.gvStockReport = { title: 'GV Stock Report', render: renderStockReport };
  // 📋 v3.31 — GV Performance ke numbers ki exact lists (kpiDetail.registerList)
  if (FF.kpiDetail && FF.kpiDetail.registerList) {
    const pname = (v) => esc(String(v || '').replace(/^[^\p{L}\p{N}]+/u, '') || '—');
    const cols = () => [['Agent', (r) => `<b>${esc(r.agentName)}</b> <small class="dim">${esc(r.agentId || '')}</small>`], ['TL', (r) => (FF.config.isDirectAgent(r, 'gv') ? `🚫 ${esc(FF.config.directLabel(r, 'gv'))}` : esc(r.tlName || '—'))], ['Priority', (r) => pname(r.priority)], ['Status', (r) => pname(r.agentStatus)], ['Last month', (r) => U.fmt(r.lastTotal), 1], ['MTD', (r) => `<b>${U.fmt(r.curTotal)}</b>`, 1], ['Today', (r) => U.fmt(r.todayIssued), 1], ['Stock', (r) => U.fmt(r.stockTotal), 1]];
    const all = () => (perf.sourceRows && perf.sourceRows.length ? perf.sourceRows : overlayGvReportWithEir(G.get('report') || []));
    const filtered = () => (perf.sourceRows && perf.sourceRows.length ? filteredReport() : all());
    const make = (name, rowsFn, kicker, sortKey) => FF.kpiDetail.registerList(name, () => {
      const rows = [...rowsFn()].sort((a, b) => (Number(b[sortKey || 'curTotal']) || 0) - (Number(a[sortKey || 'curTotal']) || 0));
      return { kicker, unit: 'agents', rows, columns: cols(), agent: (r) => ({ name: r.agentName, id: r.agentId, ch: 'gv' }),
        headline: sortKey === 'stockTotal' ? { value: U.sum(rows, (r) => r.stockTotal), unit: 'tags stock' } : null,
        sub: `MTD <b>${U.fmt(U.sum(rows, (r) => r.curTotal))}</b> · last month <b>${U.fmt(U.sum(rows, (r) => r.lastTotal))}</b> · stock <b>${U.fmt(U.sum(rows, (r) => r.stockTotal))}</b> (VC4 ${U.fmt(U.sum(rows, (r) => r.stockVc4))})`,
        subShort: `stock ${U.fmt(U.sum(rows, (r) => r.stockTotal))}` };
    });
    const srMake = (name, filt, kicker, field) => FF.kpiDetail.registerList(name, () => {
      const rows = (gvsrLast || []).filter(filt).sort((a, b) => (Number(b[field || 'stockTotal']) || 0) - (Number(a[field || 'stockTotal']) || 0));
      return { kicker, unit: 'agents', rows, columns: cols(), agent: (r) => ({ name: r.agentName, id: r.agentId, ch: 'gv' }),
        headline: field ? { value: U.sum(rows, (r) => Number(r[field]) || 0), unit: field === 'stockVc4' ? 'tags VC4 stock' : field === 'stockComm' ? 'tags commercial stock' : 'tags stock' } : null,
        sub: `Stock <b>${U.fmt(U.sum(rows, (r) => r.stockTotal))}</b> · VC4 <b>${U.fmt(U.sum(rows, (r) => r.stockVc4))}</b> · Commercial <b>${U.fmt(U.sum(rows, (r) => r.stockComm))}</b>` };
    });
    srMake('gvsr.stock', () => true, 'GV Stock Report · REPORT stock', 'stockTotal');
    srMake('gvsr.vc4', (r) => Number(r.stockVc4) > 0, 'GV Stock Report · VC4 stock', 'stockVc4');
    srMake('gvsr.comm', (r) => Number(r.stockComm) > 0, 'GV Stock Report · Commercial stock', 'stockComm');
    srMake('gvsr.need', (r) => !FF.config.isDirectAgent(r, 'gv') && /high|medium/i.test(r.priority || ''), 'GV Stock Report · dispatch review');
    srMake('gvsr.direct', (r) => FF.config.isDirectAgent(r, 'gv'), 'GV Stock Report · direct agents');
    make('gvp.all', all, 'GV REPORT · all agents');
    make('gvp.stock', all, 'GV REPORT · stock', 'stockTotal');
    make('gvp.high', () => all().filter((r) => /high/i.test(r.priority || '')), 'GV REPORT · High priority');
    make('gvp.f.attention', () => filtered().filter((r) => /high|medium/i.test(r.priority || '') || /inactive/i.test(r.agentStatus || '') || Number(r.stockTotal) === 0 || Number(r.growth) < 0), 'GV · attention list');
    make('gvp.f.high', () => filtered().filter((r) => /high/i.test(r.priority || '')), 'GV · High priority (filtered)');
    make('gvp.f.inactive', () => filtered().filter((r) => /inactive/i.test(r.agentStatus || '')), 'GV · Inactive (filtered)');
    make('gvp.f.direct', () => filtered().filter((r) => FF.config.isDirectAgent(r, 'gv')), 'GV · Direct agents (filtered)');
  }
  FF.pages.gvPerformance = { title: 'GV Performance', render: renderPerformance, sourceRows: () => perf.sourceRows || null };
})(window.FF);
