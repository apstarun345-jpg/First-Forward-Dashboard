/* GV Partner pages: 🚀 GV Dashboard · 📈 GV Trend · 📦 GV Stock · 🏆 GV Performance
   All four read from FF.gv (GV Master issuance · Tag Assignment stock · GV REPORT performance) and
   follow the same look & behaviour as the First Forward pages (KPIs, charts, quick-find, pivots,
   Excel/CSV export, WhatsApp/Email share, agent profile drawer). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, D = FF.data, G = FF.gv, C = FF.charts;
  const esc = U.esc;

  // ---- shared bits -------------------------------------------------------------------------------
  const kpi = (cls, title, icon, value, foot, tip) => `<div class="kpi ${cls}" ${tip ? `data-tip="${esc(tip)}"` : ''}><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  const card = (title, body, opts) => `<section class="card ${(opts && opts.cls) || ''}"><div class="card-head"><h3>${title}</h3>${opts && opts.right ? `<div class="card-right">${opts.right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const head = (icon, title, sub, actions) => `<div class="page-head"><div><h1>${icon} ${esc(title)}</h1><p class="sub">${sub}</p></div><div class="head-actions">${actions || ''}<button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>`;
  const miniKpi = (label, value, foot, cls) => `<div class="mini-kpi ${cls || ''}"><span class="mini-label">${esc(label)}</span><span class="mini-value">${value}</span>${foot ? `<span class="mini-foot">${foot}</span>` : ''}</div>`;
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
    const [masterR, reportR] = await Promise.allSettled([G.need('master'), G.need('report')]);
    if (!root.isConnected) return;
    if (masterR.status !== 'fulfilled') { body.innerHTML = U.errorBox(masterR.reason, 'data-action="refresh"'); return; }
    const report = reportR.status === 'fulfilled' ? reportR.value : [];
    const stockClass = G.get('stockClass') || [], stockTl = G.get('stockTl') || [], stockAgent = G.get('stockAgent') || [];

    const latest = G.latestDate();
    if (!latest) { body.innerHTML = `<div class="empty-state">😶 GV Master me koi date nahi mili.<br><small class="dim">Settings → Data source me GV tab/column mapping check karo.</small></div>`; return; }
    const cur = U.ymKey(latest);
    const last = U.prevMonthKey(cur);
    const curS = G.summary(cur), lastS = G.summary(last), lastMtd = G.summary(last, latest.getDate());
    const curSeries = G.dailySeries(cur), lastSeries = G.dailySeries(last);
    const today = curSeries.totals[latest.getDate() - 1] || 0;
    const prevDay = latest.getDate() > 1 ? curSeries.totals[latest.getDate() - 2] : 0;
    const monthsList = G.months();

    // stock (Tag Assignment)
    const stockTotal = U.sum(stockClass, (r) => r.n);
    const stockVc4 = U.sum(stockClass.filter((r) => r.group === 'VC4'), (r) => r.n);
    const stockComm = stockTotal - stockVc4;
    const topTlStock = stockTl.filter((r) => r.tlName !== 'Unassigned');
    const perDay = curS.avgPerDay || 0;

    // report-derived
    const highPrio = report.filter((r) => /high/i.test(r.priority)).length;
    const inactive = report.filter((r) => /inactive/i.test(r.agentStatus)).length;
    const reportStock = U.sum(report, (r) => r.stockTotal);

    const lm = U.labelYM(last), cm = U.labelYM(cur);
    const kpis = [
      kpi('g1', `Today · ${U.labelDate(latest)} (${U.weekday(latest)})`, '⚡', U.fmt(today), `${U.deltaHtml(U.growth(today, prevDay), { decimals: 0 })} vs previous day (${U.fmt(prevDay)})`),
      kpi('g2', `MTD Issuance · ${cm}`, '🏷️', U.fmt(curS.total), `${U.deltaHtml(U.growth(curS.total, lastMtd.total))} vs ${lm} same period (${U.fmt(lastMtd.total)})`),
      kpi('g3', 'VC4 (Payable) · MTD', '🚗', U.fmt(curS.vc4), `${U.fmtPct(U.pctOf(curS.vc4, curS.total), 0)} share · ${U.deltaHtml(U.growth(curS.vc4, lastMtd.vc4))} vs ${lm}`),
      kpi('g4', 'Commercial (NVC4) · MTD', '🚚', U.fmt(curS.comm), `VC20 <b>${U.fmt(curS.vc20)}</b> · VC5+ <b>${U.fmt(curS.vc5p)}</b> · ${U.deltaHtml(U.growth(curS.comm, lastMtd.comm))}`),
      kpi('g5', 'Avg / Day · MTD', '📅', U.fmt(curS.avgPerDay), `${lm}: ${U.fmt(lastS.avgPerDay)} / day · ${curS.activeDays} active days`),
      kpi('g6', `Projected Month-End · ${cm}`, '🎯', U.fmt(curS.projected), `${U.deltaHtml(U.growth(curS.projected, lastS.total))} vs ${lm} full (${U.fmt(lastS.total)})`),
      kpi('g7', 'Replacements · MTD', '🔁', U.fmt(curS.replacement), `${U.fmtPct(U.pctOf(curS.replacement, curS.total))} of total · VRN ${U.fmt(curS.vrn)} · Chassis ${U.fmt(curS.chassis)}`),
      kpi('g8', 'Active Agents · MTD', '🧑‍💼', U.fmt(curS.activeAgents), `${U.fmt(curS.activeTls)} TLs active · ${lastS.activeAgents} last month`),
      kpi('g9', 'GV Stock in Field', '📦', U.fmt(stockTotal), `VC4 <b>${U.fmt(stockVc4)}</b> · Commercial <b>${U.fmt(stockComm)}</b>${perDay ? ` · ${U.fmt(stockTotal / perDay)} days cover` : ''}`),
      kpi('g10', 'High Dispatch Priority', '🔺', report.length ? U.fmt(highPrio) : '—', report.length ? `GV REPORT agents jinko dispatch chahiye · Inactive <b>${U.fmt(inactive)}</b>` : 'GV REPORT load nahi hua'),
      kpi('g11', 'Commission · MTD', '💰', U.fmt(curS.commission), `Amount <b>${U.fmt(curS.amount)}</b> · avg ₹${U.fmt(curS.total ? curS.commission / curS.total : 0)} / tag`),
      kpi('g12', 'Report Stock (GV REPORT)', '🏬', report.length ? U.fmt(reportStock) : '—', report.length ? `${U.fmtPct(U.pctOf(U.sum(report, (r) => r.stockVc4), reportStock), 0)} VC4 · ${U.fmt(report.length)} agents` : '—')
    ];

    const dayLabels = curSeries.days.map(String);
    const lineChart = C.lines({
      labels: dayLabels, tipLabels: curSeries.days.map((d) => `Day ${d}`), height: 250, series: [
        { name: cm, values: curSeries.totals.map((v, i) => (i < latest.getDate() ? v : null)), color: C.COLORS.current },
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
    const topAgents = agentsCur.slice(0, topN).map((a, i) => ({ label: a.agentName, sub: a.tlName, value: a.total, compare: agentsLast.get(a.agentId) || 0, color: C.PALETTE[(i + 2) % C.PALETTE.length], attr: `data-link="#/gvPerformance?q=${encodeURIComponent(a.agentName)}"` }));
    const stockByClass = C.donut({ items: stockClass.map((r) => ({ label: r.cls, value: r.n })), subtitle: 'in stock' });
    const stockTlBars = C.hbars({ items: topTlStock.slice(0, topN).map((t, i) => ({ label: t.tlName, value: t.n, color: C.PALETTE[(i + 4) % C.PALETTE.length], attr: `data-link="#/gvStock?tl=${encodeURIComponent(t.tlName)}"`, })), valueLabel: 'Stock' });

    // recent 14 days
    const recent = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(latest); d.setDate(d.getDate() - i);
      const ym = U.ymKey(d), day = d.getDate();
      const dayRows = G.rows().filter((r) => r.ym === ym && r.day === day);
      recent.push({ d, total: dayRows.length, vc4: dayRows.filter((r) => r.group === 'VC4').length, comm: dayRows.filter((r) => r.group !== 'VC4').length, repl: dayRows.filter((r) => /replacement/i.test(r.status)).length, agents: new Set(dayRows.map((r) => r.agentId)).size });
    }
    const recentRows = recent.map((r, i) => `<tr><td>${U.labelDate(r.d)} <span class="dim">${U.weekday(r.d)}</span></td><td class="num"><b>${U.fmt(r.total)}</b></td><td class="num">${U.fmt(r.vc4)}</td><td class="num">${U.fmt(r.comm)}</td><td class="num">${U.fmt(r.repl)}</td><td class="num">${U.fmt(r.agents)}</td><td>${recent[i + 1] ? U.deltaHtml(U.growth(r.total, recent[i + 1].total), { decimals: 0 }) : '—'}</td></tr>`);

    // weekday pattern (last 8 weeks)
    const cutoff = new Date(latest); cutoff.setDate(cutoff.getDate() - 55);
    const wdSum = new Array(7).fill(0), wdDays = Array.from({ length: 7 }, () => new Set());
    for (const r of G.rows()) { if (!r.date || r.date < cutoff) continue; wdSum[r.date.getDay()] += 1; wdDays[r.date.getDay()].add(U.dateKey(r.date)); }
    const wdOrder = [1, 2, 3, 4, 5, 6, 0];
    const weekdayChart = C.bars({ labels: wdOrder.map((i) => U.DAYS[i]), height: 190, series: [{ name: 'Avg / day', values: wdOrder.map((i) => (wdDays[i].size ? Math.round(wdSum[i] / wdDays[i].size) : 0)), color: '#0d9488' }] });

    const cmpRow = (label, a, b) => `<tr><td>${label}</td><td class="num"><b>${U.fmt(a)}</b></td><td class="num">${U.fmt(b)}</td><td class="num">${U.deltaHtml(U.growth(a, b), { decimals: 0 })}</td></tr>`;
    const vc4Comm = `<div class="grid g-2" style="margin-bottom:0"><div>${C.bars({ labels: ['VC4', 'VC20', 'VC5+', 'Commercial'], height: 200, series: [{ name: `${lm} (same period)`, values: [lastMtd.vc4, lastMtd.vc20, lastMtd.vc5p, lastMtd.comm], color: '#99f6e4' }, { name: `${cm} MTD`, values: [curS.vc4, curS.vc20, curS.vc5p, curS.comm], color: '#0d9488' }], legendAlways: true })}</div>
      <table class="tbl compact"><thead><tr><th></th><th class="num">${cm} MTD</th><th class="num">${lm} same period</th><th class="num">Growth</th></tr></thead><tbody>${cmpRow('VC4', curS.vc4, lastMtd.vc4)}${cmpRow('VC20', curS.vc20, lastMtd.vc20)}${cmpRow('VC5+', curS.vc5p, lastMtd.vc5p)}${cmpRow('<b>Commercial (VC20 + VC5+)</b>', curS.comm, lastMtd.comm)}${cmpRow('<b>Total</b>', curS.total, lastMtd.total)}</tbody></table></div>`;

    body.innerHTML = `
      <div class="kpi-grid">${kpis.join('')}</div>
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
        ${card('🏬 Top TLs by GV Stock', stockTlBars)}
        ${card('📆 Weekday Pattern <span class="dim">(avg/day, last 8 weeks)</span>', weekdayChart)}
      </div>
      <div class="grid g-2">
        ${card('🕒 Last 14 Days', tableHtml(['Date', 'Total', 'VC4', 'Comm', 'Repl', 'Agents', 'vs prev'], recentRows, 1))}
        ${card('🔺 Dispatch / Status Watch <span class="dim">(GV REPORT)</span>', tableHtml(['Agent', 'TL', 'Stock', 'MTD', 'Priority', 'Status'],
          report.slice().sort((a, b) => (b.suggestedDispatch || 0) - (a.suggestedDispatch || 0)).slice(0, 12).map((r) => `<tr data-link="#/gvPerformance?q=${encodeURIComponent(r.agentName)}"><td><b>${esc(r.agentName)}</b></td><td>${esc(r.tlName)}</td><td class="num">${U.fmt(r.stockTotal)}</td><td class="num">${U.fmt(r.curTotal)}</td><td>${esc(r.priority || '—')}</td><td>${esc(r.agentStatus || '—')}</td></tr>`), 2))}
      </div>
      <p class="foot-note">Source: GV Partner sheet — GV Master (issuance) · Tag Assignment (stock) · GV REPORT (performance) · ${stockAgent.length} agents in stock · Loaded ${U.timeLabel(G.loadedAt || D.lastLoadAt)} · Data sirf ↻ ya browser refresh par update hota hai</p>`;
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
    tl: { label: 'TL', fn: (r) => r.tlName || 'Direct' },
    agent: { label: 'Agent', fn: (r) => r.agentName }
  };
  const MODES = [['daily', '📅 Daily'], ['weekly', '🗓️ Weekly'], ['monthly', '📆 Monthly'], ['compare', '⚖️ Last vs Current']];

  async function renderTrend(root, params, ctx) {
    const p = params || {};
    const mode = MODES.some((m) => m[0] === p.mode) ? p.mode : 'daily';
    const dimKey = DIMS[p.dim] ? p.dim : (mode === 'compare' ? 'total' : 'class');
    root.innerHTML = head('📈', 'GV Trend', 'GV Master issuance — daily · weekly · monthly · last vs current', '') + `<div id="gvt-controls"></div><div id="gvt-body">${U.spinner('GV trend aggregate ho raha hai…')}</div>`;
    const body = U.$('#gvt-body', root), controls = U.$('#gvt-controls', root);
    try { await G.need('master'); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;

    let rows = G.rows();
    const tl = p.tl || '', agent = p.agent || '';
    if (tl) rows = rows.filter((r) => norm(r.tlName) === norm(tl));
    if (agent) rows = rows.filter((r) => norm(r.agentName) === norm(agent));
    const monthsList = U.uniq(rows.map((r) => r.ym).filter(Boolean)).sort();
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
      onPick: (it) => FF.app.updateParams(it.kind === 'tl' ? { tl: it.value, agent: '' } : { agent: it.value, tl: '' }),
      onEnter: (q) => { if (!q) { FF.app.updateParams({ agent: '', tl: '' }); return; } const hit = people.agents.find((a) => norm(a.name).includes(norm(q))); if (hit) FF.app.updateParams({ agent: hit.name, tl: '' }); else U.toast('Koi GV agent match nahi hua', 'err'); }
    });

    if (!rows.length) { body.innerHTML = `<div class="empty-state">😶 Is filter ke liye GV issuance data nahi mila.<br><button class="btn" data-action="clear-filters">Clear filters</button></div>`; return; }

    const dimKeys = (list) => {
      const present = U.uniq(list.map(dim.fn));
      if (dimKey === 'agent' || dimKey === 'tl') return U.topEntries(U.groupSum(list, dim.fn, () => 1), 10).map((e) => e[0]);
      if (dim.order) return dim.order.filter((k) => present.includes(k)).concat(present.filter((k) => !dim.order.includes(k)));
      return U.topEntries(U.groupSum(list, dim.fn, () => 1), 8).map((e) => e[0]);
    };
    const keys = dimKeys(rows);
    const bucketize = (list, keyFn) => {
      const map = new Map();
      for (const r of list) {
        const b = keyFn(r);
        if (!map.has(b)) map.set(b, new Map());
        const inner = map.get(b); const k = dim.fn(r);
        inner.set(k, (inner.get(k) || 0) + 1);
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
      const map = bucketize(rows, (r) => r.ym);
      const series = seriesFor(map, monthsList);
      html += card(`📆 Monthly (all months in GV Master) <span class="dim">${esc(dim.label)}</span>`, C.bars({ labels: monthsList.map((m) => U.labelYM(m)), series, height: 260, legendAlways: true }), { right: exportBtn('gv-trend-monthly') })
        + card('🔢 Monthly table', tableHtml(['Month', 'Total', ...keys, 'Avg / day'], monthsList.map((m) => { const tot = U.sum(series, (s) => s.values[monthsList.indexOf(m)] || 0); const daysIn = U.daysInMonth(m); return `<tr><td>${U.labelYM(m, true)}</td><td class="num"><b>${U.fmt(tot)}</b></td>${keys.map((k) => `<td class="num">${U.fmt((map.get(m) && map.get(m).get(k)) || 0)}</td>`).join('')}<td class="num">${U.fmt(tot / daysIn)}</td></tr>`; }), 1));
    } else {
      const lastKey = U.prevMonthKey(cur);
      const curS = G.summary(cur), lastS = G.summary(lastKey);
      const curMap = G.byDim(cur, dim.fn), lastMap = G.byDim(lastKey, dim.fn);
      const cmpKeys = U.uniq([...curMap.keys(), ...lastMap.keys()]);
      const daysInLast = Math.max(1, rows.filter((r) => r.ym === lastKey).reduce((m, r) => Math.max(m, r.day || 0), 0));
      const lastUpTo = rows.filter((r) => r.ym === lastKey && (r.day || 0) <= (curS.lastDay || 31)).length;
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
    if (p.tl) { stockSel = { tl: p.tl, agent: '' }; stockView = 'tl'; }
    else if (p.agent) { stockSel = { tl: '', agent: p.agent }; stockView = 'agent'; }
    else if (p.view && STOCK_VIEWS.some((v) => v[0] === p.view)) stockView = p.view;
    root.innerHTML = head('📦', 'GV Stock', 'Tag Assignment sheet — GV partner ka stock in field (VC4 vs Commercial)', `<a class="btn" href="#/gvPerformance">🏆 GV performance →</a>`)
      + `<div id="gvs-controls"></div><div id="gvs-body">${U.spinner('GV stock load ho raha hai…')}</div>`;
    const body = U.$('#gvs-body', root), controls = U.$('#gvs-controls', root);
    try { await Promise.all([G.need('stockClass'), G.need('stockTl')]); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
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
    U.suggest(findInput, {
      items: () => [...people.tls.sort((a, b) => b.n - a.n).map((t) => ({ kind: 'tl', kindLabel: 'GV TL', label: t.name, sub: `${U.fmtShort(t.n)} tags stock`, value: t.name })),
        ...people.agents.slice(0, 400).map((a) => ({ kind: 'agent', kindLabel: 'GV Agent', label: a.name, sub: `${a.tl || ''}${a.id ? ` · ${a.id}` : ''}`, value: a.name, id: a.id }))],
      onPick: (it) => { stockSel = it.kind === 'tl' ? { tl: it.value, agent: '' } : { agent: it.value, tl: '' }; stockView = it.kind === 'tl' ? 'tl' : 'agent'; FF.app.updateParams(it.kind === 'tl' ? { tl: it.value, agent: '', view: 'tl' } : { agent: it.value, tl: '', view: 'agent' }); }
    });

    const kpis = [
      kpi('g9', 'GV Stock in Field', '📦', U.fmt(total), `VC4 <b>${U.fmt(vc4)}</b> (${U.fmtPct(U.pctOf(vc4, total), 0)}) · Commercial <b>${U.fmt(comm)}</b>`),
      kpi('g12', 'Stock Days Cover', '⏳', perDay ? U.fmt(total / perDay) : '—', perDay ? `GV avg ${U.fmt(perDay)} tags/day par` : 'Issuance data load nahi hua'),
      kpi('g10', 'TLs with Stock', '👥', U.fmt(byTl.filter((r) => r.tlName !== 'Unassigned').length), `Unassigned: <b>${U.fmt((byTl.find((r) => r.tlName === 'Unassigned') || {}).n || 0)}</b>`),
      kpi('g8', 'Agents with Stock', '🧑‍💼', U.fmt(byAgent.length), `Avg <b>${U.fmt(byAgent.length ? total / byAgent.length : 0)}</b> tags / agent`),
      kpi('g3', 'Biggest Class', '🚗', classes.length ? classes.slice().sort((a, b) => (byClass.find((x) => x.cls === b).n) - (byClass.find((x) => x.cls === a).n))[0] : '—', classes.slice().sort((a, b) => (byClass.find((x) => x.cls === b).n) - (byClass.find((x) => x.cls === a).n)).slice(0, 3).map((c) => `${c} <b>${U.fmt(byClass.find((x) => x.cls === c).n)}</b>`).join(' · ')),
      kpi('g11', 'Top TL by Stock', '🏬', (byTl.find((r) => r.tlName !== 'Unassigned') || {}).tlName || '—', (byTl.find((r) => r.tlName !== 'Unassigned') || {}).n ? `${U.fmt(byTl.find((r) => r.tlName !== 'Unassigned').n)} tags` : '')
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
        return `<tr><td class="dim">${i + 1}</td><td><b>${esc(t.tlName)}</b></td><td class="num"><b>${U.fmt(t.n)}</b></td><td class="num">${U.fmt(tVc4)}</td><td class="num">${U.fmt(tComm)}</td><td class="num">${U.fmtPct(U.pctOf(t.n, total), 0)}</td><td><button class="btn small" data-link="#/gvStock?tl=${encodeURIComponent(t.tlName)}&view=tl">View →</button></td></tr>`;
      }), 2), { right: exportBtn('gv-stock-tl') })}
      ${card('🧑‍💼 Agent-wise GV Stock <span class="dim">(top 60)</span>', tableHtml(['#', 'Agent', 'TL', 'Stock', 'VC4', 'Comm'], byAgent.slice(0, 60).map((a, i) => {
        const cls = byAgentClass.filter((r) => norm(r.agentName) === norm(a.agentName));
        const aVc4 = U.sum(cls.filter((r) => r.group === 'VC4'), (r) => r.n);
        return `<tr><td class="dim">${i + 1}</td><td><b>${esc(a.agentName)}</b> <small class="dim">${esc(a.agentId)}</small></td><td>${esc(a.tlName || '—')}</td><td class="num"><b>${U.fmt(a.n)}</b></td><td class="num">${U.fmt(aVc4)}</td><td class="num">${U.fmt(a.n - aVc4)}</td></tr>`;
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
        const rep = (G.get('report') || []).find((r) => norm(r.agentName) === norm(a.agentName));
        return card(`🧑‍💼 ${esc(a.agentName)} <span class="dim">${esc(a.agentId)} · ${esc(a.tlName || '—')}</span>`, `
          <div class="grid g-4" style="margin-bottom:10px">${miniKpi('Stock', U.fmt(a.n))}${miniKpi('VC4', U.fmt(aVc4))}${miniKpi('Commercial', U.fmt(a.n - aVc4))}${rep ? miniKpi('MTD issuance (GV REPORT)', U.fmt(rep.curTotal)) : miniKpi('MTD issuance', '—')}</div>
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
        const tls = U.topEntries(U.groupSum(byTl.filter((r) => r.tlName !== 'Unassigned'), (r) => r.tlName, (r) => r.n), 15).map((e) => e[0]);
        return tableHtml(['TL', ...classes, 'Total'], tls.map((tl) => {
          const rowsFor = classRows.filter((r) => norm(r.tlName) === norm(tl));
          return `<tr><td><b>${esc(tl)}</b></td>${classes.map((c) => `<td class="num">${U.fmt(U.sum(rowsFor.filter((r) => r.cls === c), (r) => r.n))}</td>`).join('')}<td class="num"><b>${U.fmt(U.sum(rowsFor, (r) => r.n))}</b></td></tr>`;
        }), 1);
      })())}`;
    }

    body.innerHTML = `<div class="kpi-grid">${kpis.join('')}</div>${viewHtml}
      <p class="foot-note">Source: GV Partner sheet → <b>Tag Assignment</b> tab (${U.fmt(total)} tags in stock) · Aggregates Google se group-by queries me aate hain · Loaded ${U.timeLabel(G.loadedAt || D.lastLoadAt)}</p>`;
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
        const rows = D.textRows(t);
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
  const perf = { q: '', priority: '', status: '', tl: '', sort: { key: 'curTotal', dir: 'desc' }, page: 1 };
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

  function filteredReport() {
    const q = norm(perf.q);
    return (G.get('report') || []).filter((r) => {
      if (q && !(norm(r.agentName).includes(q) || norm(r.agentId).includes(q) || norm(r.tlName).includes(q))) return false;
      if (perf.priority && !new RegExp(perf.priority, 'i').test(r.priority)) return false;
      if (perf.status === 'active' && /inactive/i.test(r.agentStatus)) return false;
      if (perf.status === 'inactive' && !/inactive/i.test(r.agentStatus)) return false;
      if (perf.tl && norm(r.tlName) !== norm(perf.tl)) return false;
      return true;
    }).sort((a, b) => {
      const k = perf.sort.key, d = perf.sort.dir === 'asc' ? 1 : -1;
      const A = a[k], B = b[k];
      if (typeof A === 'number' || typeof B === 'number') return ((A || 0) - (B || 0)) * d;
      return String(A || '').localeCompare(String(B || '')) * d;
    });
  }

  function agentDrawer(r) {
    const clsRows = Object.entries(r.curByClass).filter(([, v]) => v > 0);
    const stockRows = Object.entries(r.stockByClass).filter(([, v]) => v > 0);
    const body = `
      <div class="grid g-3">${miniKpi('Stock (total)', U.fmt(r.stockTotal), `VC4 ${U.fmt(r.stockVc4)} · Comm ${U.fmt(r.stockComm)}`)}${miniKpi('MTD issuance', U.fmt(r.curTotal), `VC4 ${U.fmt(r.curVc4)} · Comm ${U.fmt(r.curComm)}`, 'g3')}${miniKpi('Last month', U.fmt(r.lastTotal), `VC4 ${U.fmt(r.lastVc4)} · Comm ${U.fmt(r.lastComm)}`)}</div>
      <div class="grid g-3" style="margin-top:10px">${miniKpi('Growth', U.deltaHtml(r.growth, { decimals: 0 }), `Today: ${U.fmt(r.todayIssued)}`)}${miniKpi('Active days (MTD)', U.fmt(r.curDays), `Last month: ${U.fmt(r.lastDays)}`)}${miniKpi('Runrate', U.fmt(r.runrate), `VC4 ${U.fmt(r.runrateVc4)} · Comm ${U.fmt(r.runrateComm)}`)}</div>
      <div class="grid g-2" style="margin-top:12px">
        <div>${card('🚗 MTD class split', clsRows.length ? C.bars({ labels: clsRows.map(([k]) => k), height: 180, series: [{ name: 'Issued', values: clsRows.map(([, v]) => v), color: '#0d9488' }], showValues: true }) : '<div class="empty">MTD data nahi</div>')}</div>
        <div>${card('📦 Stock by class', stockRows.length ? C.donut({ items: stockRows.map(([k, v]) => ({ label: k, value: v })), subtitle: 'stock' }) : '<div class="empty">Stock nahi</div>')}</div>
      </div>
      ${card('📄 Full GV REPORT row', `<div class="table-wrap" style="max-height:340px"><table class="tbl compact"><thead><tr><th>#</th><th>Column</th><th>Value</th></tr></thead><tbody>${r.raw.map((v, i) => v === '' ? '' : `<tr><td class="dim">${U.colLetter(i)}</td><td>${esc((G.REPORT_COLS_LABELS && G.REPORT_COLS_LABELS[i]) || '')}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`)}
      <div class="btn-row" style="margin-top:10px">${shareBtn(`${r.agentName} (${r.tlName}) — GV stock ${U.fmt(r.stockTotal)} · MTD ${U.fmt(r.curTotal)} · last month ${U.fmt(r.lastTotal)} · growth ${r.growth === null ? '—' : `${r.growth}%`} · priority ${r.priority || '—'}`, `GV Partner report · ${r.agentName}`)}</div>`;
    FF.app.openDrawer({
      kicker: 'GV Partner · GV REPORT', title: r.agentName,
      sub: `<span class="dim">${esc(r.agentId)} · ${esc(r.tlName)}${r.mobile && FF.auth.can('contacts') ? ` · 📞 <a href="tel:${esc(r.mobile)}">${esc(r.mobile)}</a>` : ''}</span>`,
      body, actions: `<a class="btn small" href="#/gvStock?agent=${encodeURIComponent(r.agentName)}&view=agent">📦 GV stock →</a>`
    });
  }

  async function renderPerformance(root, params) {
    const p = params || {};
    if (p.q !== undefined) perf.q = p.q;
    if (p.tl !== undefined) perf.tl = p.tl;
    if (p.priority !== undefined) perf.priority = p.priority;
    root.innerHTML = head('🏆', 'GV Performance', 'GV REPORT — GV partner agents & TLs (stock · last month · current month · runrate)', `<a class="btn" href="#/compare">⚖️ GV vs First Forward</a>`)
      + `<div id="gvp-body">${U.spinner('GV REPORT load ho raha hai…')}</div>`;
    const body = U.$('#gvp-body', root);
    try { await G.need('report'); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    const all = G.get('report') || [];
    const rerender = () => renderPerformance(root, params);
    if (!all.length) { body.innerHTML = `<div class="empty-state">😶 GV REPORT me koi row nahi mili.<br><small class="dim">Settings → Data source → GV Partner me tab naam / gid check karo.</small></div>`; return; }
    const list = filteredReport();
    const pageSize = 50;
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    if (perf.page > pages) perf.page = pages;
    const pageRows = list.slice((perf.page - 1) * pageSize, perf.page * pageSize);
    const tlGroups = new Map();
    for (const r of all) {
      const k = r.tlName || 'Direct';
      if (!tlGroups.has(k)) tlGroups.set(k, { tlName: k, tlId: r.tlId, agents: 0, stock: 0, stockVc4: 0, last: 0, cur: 0, curVc4: 0, high: 0, inactive: 0 });
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
    const chips = [['', 'All'], ['high', '🔺 High priority'], ['medium', '🟡 Medium'], ['low', '🟢 Low']];
    const statusChips = [['', 'All'], ['active', 'Active'], ['inactive', 'Inactive']];

    const sortTh = (key, label, num) => `<th class="${num ? 'num' : ''} sortable ${perf.sort.key === key ? 'sorted' : ''}" data-sort="${key}">${esc(label)}${perf.sort.key === key ? `<i>${perf.sort.dir === 'asc' ? '▲' : '▼'}</i>` : ''}</th>`;
    const tableRows = pageRows.map((r) => `<tr class="clickable" data-agent="${esc(r.agentName)}">
      <td><b>${esc(r.agentName)}</b><br><small class="dim">${esc(r.agentId)}</small></td>
      <td>${esc(r.tlName)}</td>
      <td class="num">${U.fmt(r.stockTotal)}</td><td class="num">${U.fmt(r.stockVc4)}</td><td class="num">${U.fmt(r.stockComm)}</td>
      <td class="num">${U.fmt(r.lastTotal)}</td><td class="num"><b>${U.fmt(r.curTotal)}</b></td><td class="num">${U.fmt(r.curVc4)}</td>
      <td class="num">${U.deltaHtml(r.growth, { decimals: 0 })}</td><td class="num">${U.fmt(r.todayIssued)}</td><td class="num">${U.fmt(r.curDays)}</td>
      <td class="num">${U.fmt(r.expected)}</td><td class="num">${U.fmt(r.runrate)}</td><td>${badge(r.priority)}</td><td>${badge(r.agentStatus)}</td></tr>`).join('');

    body.innerHTML = `
      <div class="kpi-grid">
        ${kpi('g8', 'GV Agents (REPORT)', '🧑‍💼', U.fmt(totals.agents), `${tls.length} TLs · ${U.fmt(totals.growing)} growing agents`)}
        ${kpi('g9', 'GV Stock (REPORT)', '📦', U.fmt(totals.stock), `VC4 <b>${U.fmt(totals.stockVc4)}</b> · Comm <b>${U.fmt(totals.stock - totals.stockVc4)}</b>`)}
        ${kpi('g3', 'MTD Issuance', '🏷️', U.fmt(totals.cur), `VC4 <b>${U.fmt(totals.curVc4)}</b> · ${U.deltaHtml(U.growth(totals.cur, totals.last), { decimals: 0 })} vs last month (${U.fmt(totals.last)})`)}
        ${kpi('g1', 'Today Issued', '⚡', U.fmt(totals.today), 'GV REPORT ka "Today Issued" column')}
        ${kpi('g10', 'High Priority', '🔺', U.fmt(totals.high), `Inactive agents: <b>${U.fmt(totals.inactive)}</b>`)}
        ${kpi('g11', 'Avg Stock / Agent', '🏬', U.fmt(totals.agents ? totals.stock / totals.agents : 0), 'GV REPORT stock column')}
      </div>
      <div class="card controls">
        <div class="ctrl-row">
          <label>Quick find <span class="finder-input"><input class="input" id="gvp-q" placeholder="GV agent / TL / ID type karo → dropdown" value="${esc(perf.q)}"></span></label>
          <label>TL <select id="gvp-tl"><option value="">All TLs</option>${tls.map((t) => `<option value="${esc(t.tlName)}" ${norm(t.tlName) === norm(perf.tl) ? 'selected' : ''}>${esc(t.tlName)} (${t.agents})</option>`).join('')}</select></label>
          <span class="chip-row">${chips.map(([k, l]) => `<button class="chip ${perf.priority === k ? 'on' : ''}" data-priority="${k}">${l}</button>`).join('')}</span>
          <span class="chip-row">${statusChips.map(([k, l]) => `<button class="chip ${perf.status === k ? 'on' : ''}" data-status="${k}">${l}</button>`).join('')}</span>
          ${perf.q || perf.tl || perf.priority || perf.status ? '<button class="btn small" id="gvp-clear">✕ Clear filters</button>' : ''}
          <span class="ctrl-note">${U.fmt(list.length)} agents</span>
          ${exportBtn('gv-performance')}
        </div>
      </div>
      <div class="grid g-2">
        ${card(`⭐ Top GV agents · MTD`, C.hbars({ items: list.slice(0, 12).map((r, i) => ({ label: r.agentName, sub: r.tlName, value: r.curTotal, compare: r.lastTotal, color: C.PALETTE[i % C.PALETTE.length], attr: `data-agent="${esc(r.agentName)}"` })), compareLabel: 'Last month', valueLabel: 'MTD' }))}
        ${card(`🏅 GV TL rollup`, C.hbars({ items: tls.slice(0, 12).map((t, i) => ({ label: t.tlName, sub: `${t.agents} agents · stock ${U.fmtShort(t.stock)}`, value: t.cur, compare: t.last, color: C.PALETTE[(i + 3) % C.PALETTE.length] })), compareLabel: 'Last month', valueLabel: 'MTD' }))}
      </div>
      ${card('📋 GV agents', `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent</th><th>TL</th>${PERF_COLS.slice(2).map((c) => sortTh(c.key, c.label, c.num)).join('')}</tr></thead><tbody>${tableRows || `<tr><td colspan="15" class="empty">Koi agent match nahi hua</td></tr>`}</tbody></table></div>
        <div class="pager"><button class="btn small" data-gvp-pg="prev" ${perf.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${perf.page} / ${U.fmt(pages)}</span><button class="btn small" data-gvp-pg="next" ${perf.page >= pages ? 'disabled' : ''}>Next ›</button></div>`, { right: `${FF.auth.can('share') ? `<button class="btn small" data-share="wa" data-text="${esc(`GV Partner MTD ${U.fmt(totals.cur)} tags · stock ${U.fmt(totals.stock)} · ${tls.length} TLs`)}">🟢 Share</button>` : ''}` })}
      ${card('👥 GV TL-wise summary', tableHtml(['#', 'TL', 'Agents', 'Stock', 'Stock VC4', 'Last month', 'MTD', 'MTD VC4', 'High prio', 'Inactive'], tls.map((t, i) => `<tr data-link="#/gvPerformance?tl=${encodeURIComponent(t.tlName)}"><td class="dim">${i + 1}</td><td><b>${esc(t.tlName)}</b></td><td class="num">${U.fmt(t.agents)}</td><td class="num">${U.fmt(t.stock)}</td><td class="num">${U.fmt(t.stockVc4)}</td><td class="num">${U.fmt(t.last)}</td><td class="num"><b>${U.fmt(t.cur)}</b></td><td class="num">${U.fmt(t.curVc4)}</td><td class="num">${U.fmt(t.high)}</td><td class="num">${U.fmt(t.inactive)}</td></tr>`), 2), { right: exportBtn('gv-tl-summary') })}
      <p class="foot-note">Source: GV Partner sheet → <b>GV REPORT</b> tab (agent-wise) · ${U.fmt(all.length)} agents · Loaded ${U.timeLabel(G.loadedAt || D.lastLoadAt)}</p>`;

    // interactions
    const q = U.$('#gvp-q', body);
    U.suggest(q, { items: () => all.map((r) => ({ kind: 'agent', kindLabel: 'GV Agent', label: r.agentName, sub: `${r.tlName} · MTD ${U.fmt(r.curTotal)}`, value: r.agentName })), onPick: (it) => { perf.q = it.value; perf.page = 1; rerender(); }, onEnter: (v) => { perf.q = v; perf.page = 1; rerender(); } });
    U.$('#gvp-tl', body).addEventListener('change', (e) => { perf.tl = e.target.value; perf.page = 1; rerender(); });
    const clr = U.$('#gvp-clear', body);
    if (clr) clr.addEventListener('click', () => { perf.q = ''; perf.tl = ''; perf.priority = ''; perf.status = ''; perf.page = 1; rerender(); });
    body.addEventListener('click', (e) => {
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
  }

  FF.pages.gvDashboard = { title: 'GV Partner Dashboard', render: renderDashboard };
  FF.pages.gvTrend = { title: 'GV Trend', render: renderTrend };
  FF.pages.gvStock = { title: 'GV Stock', render: renderStock };
  FF.pages.gvPerformance = { title: 'GV Performance', render: renderPerformance };
})(window.FF);
