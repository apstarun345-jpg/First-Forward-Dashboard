/* Dashboard page: KPI cards + charts from EIR (issuance), StockDataa (inventory) and tag status. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  let voiceText = '';
  const U = FF.util, M = FF.model, C = FF.charts, S = FF.store;
  const esc = U.esc;
  const excl = (name) => FF.config.isExcludedTl(name);

  function kpi(cls, title, icon, value, foot, tip, spark) {
    return `<div class="kpi ${cls}" ${tip ? `data-tip="${esc(tip)}"` : ''}><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}${spark || ''}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  }
  function card(title, body, opts) {
    const o = opts || {};
    return `<section class="card ${o.cls || ''}"><div class="card-head"><h3>${title}</h3>${o.right ? `<div class="card-right">${o.right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  }
  function sectionError(title, err) { return card(title, U.errorBox(err)); }

  // ---- 🧮 multi-sheet Excel bundle: poora workspace ek file me ----
  async function exportBundle(btn) {
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    btn.disabled = true; const label = btn.textContent; btn.textContent = '⏳ Bundle ban raha hai…';
    try {
      const daily = await S.need('daily');
      const [stock, stockAgents, report] = await Promise.all([
        S.need('stock').catch(() => []), S.need('stockAgents').catch(() => []), S.need('report').catch(() => null)
      ]);
      let gvMonthsData = null;
      try { if (FF.gv && FF.gv.enabled && FF.gv.enabled()) { await FF.gv.need('master'); gvMonthsData = FF.gv.months(); } } catch { /* GV optional */ }
      const latest = M.latestDate(daily);
      const cur = latest ? U.ymKey(latest) : '';
      const months = M.months(daily);
      const monthly = months.map((m) => { const s = M.summary(daily, m); return [U.labelYM(m, true), s.total, s.vc4, s.vc20, s.vc5p, s.comm, s.replacement, s.activeDays, Math.round(s.avgPerDay), s.projected]; });
      const series = cur ? M.dailySeries(daily, cur) : null;
      const dailyRows = series ? series.days.map((d, i) => { const ymd = daily.filter((r) => r.ym === cur && r.day === d); return [d, series.totals[i] || 0, U.sum(ymd.filter((r) => r.group === 'VC4'), (r) => r.n), U.sum(ymd.filter((r) => r.group !== 'VC4'), (r) => r.n), U.sum(ymd.filter((r) => r.type === 'REPLACEMENT'), (r) => r.n)]; }) : [];
      const classes = U.uniq(stock.map((r) => r.cls)).sort();
      const tls = U.uniq(stock.map((r) => r.tlName));
      const stockTlRows = tls.map((t) => [t, ...classes.map((c) => U.sum(stock.filter((r) => r.tlName === t && r.cls === c), (r) => r.n)), U.sum(stock.filter((r) => r.tlName === t && r.group === 'VC4'), (r) => r.n), U.sum(stock.filter((r) => r.tlName === t), (r) => r.n)]);
      const agMap = new Map();
      for (const r of stockAgents) { const k = `${r.agentName}|${r.tlName}`; const o = agMap.get(k) || { name: r.agentName, tl: r.tlName, vc4: 0, comm: 0, total: 0 }; o.total += r.n; if (r.group === 'VC4') o.vc4 += r.n; else o.comm += r.n; agMap.set(k, o); }
      const agentStockRows = [...agMap.values()].sort((a, b) => b.total - a.total).map((a) => [a.name, a.tl, a.vc4, a.comm, a.total]);
      const gvMonthly = gvMonthsData ? gvMonthsData.map((m) => { const s = FF.gv.summary(m); return [U.labelYM(m, true), s.total, s.vc4, s.comm, s.replacement, s.activeAgents, Math.round(s.avgPerDay)]; }) : null;
      const sheets = [
        { name: 'Summary', filterRows: 7, header: ['Metric', 'Value'], rows: [
          ['Report', `${FF.config.brand} · Full Excel bundle`], ['Generated', new Date().toLocaleString('en-IN')],
          ['Latest date', latest ? U.labelDate(latest, true) : '—'], ['Current month', cur ? U.labelYM(cur, true) : '—'],
          ['MTD total', cur ? M.summary(daily, cur).total : 0], ['Stock tags', U.sum(stock, (r) => r.n)],
          ['Sheets', 'Monthly · Daily · Stock by TL · Agent stock · REPORT' + (gvMonthly ? ' · GV monthly' : '')]
        ] },
        { name: 'Monthly issuance', header: ['Month', 'Total', 'VC4', 'VC20', 'VC5+', 'Commercial', 'Replacement', 'Active days', 'Avg/day', 'Projected'], rows: monthly },
        { name: `Daily ${cur}`, header: ['Day', 'Total', 'VC4', 'Commercial', 'Replacement'], rows: dailyRows },
        { name: 'Stock by TL', header: ['TL', ...classes, 'VC4', 'Total'], rows: stockTlRows },
        { name: 'Agent stock', header: ['Agent', 'TL', 'VC4', 'Commercial', 'Total'], rows: agentStockRows }
      ];
      if (report && report.cols && report.rows) sheets.push({ name: 'REPORT sheet', header: report.cols.map((c, i) => c.label || U.colLetter(i)), rows: FF.data.textRows(report).slice(0, 5000) });
      if (gvMonthly) sheets.push({ name: 'GV monthly', header: ['Month', 'Total', 'VC4', 'Commercial', 'Replacement', 'Active agents', 'Avg/day'], rows: gvMonthly });
      FF.xlsx.download(`workspace-bundle-${U.stamp()}.xlsx`, sheets);
      U.toast(`Bundle ready · ${sheets.length} sheets ✓`, 'ok');
      if (FF.notifications && FF.notifications.logClick) FF.notifications.logClick('Excel Bundle', `${sheets.length} sheets`);
    } catch (err) { console.error(err); U.toast(`Bundle fail: ${err.message}`, 'err'); }
    btn.disabled = false; btn.textContent = label;
  }

  async function render(root) {
    const shareOn = !FF.config.feat || FF.config.feat('share') !== false;
    const voiceOn = !FF.config.feat || FF.config.feat('voiceSummary') !== false;
    root.innerHTML = `<div class="page-head"><div><h1>📊 Dashboard</h1><p class="sub">Summary · EIR issuance + StockDataa inventory · VC4 vs Commercial</p></div>
      <div class="head-actions">${shareOn ? '<button class="btn" id="db-wa" title="Current numbers WhatsApp par bhejo">📤 WhatsApp</button>' : ''}${voiceOn ? '<button class="btn" id="db-voice" title="Aaj ke numbers Hindi me bol kar sunao (browser TTS) — dobara click = band">🔊 Suno</button>' : ''}<button class="btn" id="db-bundle" title="Monthly + Daily + Stock + REPORT + GV — sab ek xlsx me">⬇ Excel bundle</button><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div id="db-targetbar"></div>
      <div id="db-body">${U.spinner('Data load ho raha hai… (pehli baar 5-10 sec lag sakte hain)')}</div>`;
    const bundleBtn = U.$('#db-bundle', root);
    if (bundleBtn) bundleBtn.addEventListener('click', () => exportBundle(bundleBtn));
    // 🗣️ Voice summary (features.voiceSummary) — speechSynthesis, koi server call nahi
    const voiceBtn = U.$('#db-voice', root);
    if (voiceBtn) voiceBtn.addEventListener('click', () => {
      if (!('speechSynthesis' in window)) return U.toast('Is browser/OS me voice supported nahi hai', 'err');
      if (window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); voiceBtn.classList.remove('on'); return; }
      if (!voiceText) return U.toast('Data abhi load ho raha hai — thodi der baad', 'warn');
      const u = new SpeechSynthesisUtterance(voiceText);
      const vs = window.speechSynthesis.getVoices() || [];
      const v = vs.find((x) => /^hi/i.test(x.lang)) || vs.find((x) => /en-IN/i.test(x.lang)) || vs.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.lang = (v && v.lang) || 'hi-IN';
      u.rate = 1.03;
      u.onend = () => voiceBtn.classList.remove('on');
      voiceBtn.classList.add('on');
      window.speechSynthesis.speak(u);
    });

    // 🎯 Target progress bar (Features → targetBar) + 📤 WhatsApp share — server MTD + targets se.
    let shareCtx = '';
    let stockShare = null;
    (async () => {
      try {
        const wantBar = !FF.config.feat || FF.config.feat('targetBar') !== false;
        const wantShare = !FF.config.feat || FF.config.feat('share') !== false;
        if (!wantBar && !wantShare) return;
        const sh = await FF.auth.api('/api/stock-history');
        const st = (FF.auth.settings) || {};
        const ist = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const ym = `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}`;
        const targets = Array.isArray(st.targets) ? st.targets : [];
        const totalTarget = targets.filter((t) => t && t.ym === ym && Number(t.target) > 0).reduce((a, t) => a + Number(t.target), 0);
        const mtd = (sh && sh.mtd) || {};
        const achieved = (Number(mtd.ff) || 0) + (Number(mtd.gv) || 0);
        shareCtx = `\n🏷️ MTD: ${U.fmt(achieved)} tags${mtd.days ? ` (${mtd.days} din)` : ''}${totalTarget ? ` · 🎯 Target: ${U.fmt(totalTarget)}` : ''}`;
        if (!wantBar || !totalTarget) return;
        const day = ist.getDate();
        const daysInMonth = new Date(ist.getFullYear(), ist.getMonth() + 1, 0).getDate();
        const expected = totalTarget * (day / daysInMonth);
        const pct = totalTarget > 0 ? Math.round((achieved / totalTarget) * 100) : 0;
        const pace = achieved >= expected ? '🟢 pace theek hai' : achieved >= expected * 0.6 ? '🟡 thoda peeche hai' : '🔴 40%+ peeche';
        const daysLeft = daysInMonth - day;
        const needPerDay = daysLeft > 0 && achieved < totalTarget ? Math.ceil((totalTarget - achieved) / daysLeft) : 0;
        const fill = Math.max(2, Math.min(100, pct));
        const tone = achieved >= expected ? 'ok' : achieved >= expected * 0.6 ? 'mid' : 'bad';
        const box = U.$('#db-targetbar', root);
        if (box) {
          box.innerHTML = `<a class="target-bar ${tone}" href="#/targets" title="Targets page — agent-wise target do / progress dekho">
            <span class="tb-ico">🎯</span>
            <span class="tb-main"><span class="tb-line"><b>Target ${U.labelYM ? U.labelYM(ym) : ym}</b> · <b>${U.fmt(achieved)}</b> / ${U.fmt(totalTarget)} (${pct}%) · day ${day}/${daysInMonth} <span class="tb-status">${pace}</span></span>
            <span class="tb-track"><span class="tb-fill" style="width:${fill}%"></span></span></span>
            <span class="tb-right dim small">${needPerDay ? `≈ ${U.fmt(needPerDay)}/din chahiye · ` : ''}${daysLeft} din baaki →</span></a>`;
        }
      } catch { /* target bar optional */ }
    })();
    const waBtn = U.$('#db-wa', root);
    if (waBtn) waBtn.addEventListener('click', () => {
      const text = `📊 ${FF.config.brand} Dashboard · ${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}\n${shareCtx || ''}${stockShare ? `\n📦 Stock: ${U.fmt(stockShare.total)} (VC4 ${U.fmt(stockShare.vc4)})` : ''}`;
      FF.app.shareWhatsApp(text);
    });

    const [dailyR, agentsR, statusR, stockR, stockAgentsR] = await Promise.allSettled([S.need('daily'), S.need('agents'), S.need('status'), S.need('stock'), S.need('stockAgents')]);
    if (!root.isConnected) return;
    const body = U.$('#db-body', root);
    if (dailyR.status !== 'fulfilled') {
      body.innerHTML = U.errorBox(dailyR.reason, 'data-action="refresh"');
      return;
    }
    const daily = dailyR.value;
    const agents = agentsR.status === 'fulfilled' ? agentsR.value : null;
    const status = statusR.status === 'fulfilled' ? statusR.value : null;
    const stock = stockR.status === 'fulfilled' ? stockR.value : null;
    const stockAgents = stockAgentsR.status === 'fulfilled' ? stockAgentsR.value : null;
    if (stock) stockShare = { total: U.sum(stock, (r) => r.n), vc4: U.sum(stock.filter((r) => r.group === 'VC4'), (r) => r.n) };

    const monthsList = M.months(daily);
    const latest = M.latestDate(daily);
    if (!latest) { body.innerHTML = U.errorBox(new Error('EIR sheet me koi ISSUE_DATE nahi mili.')); return; }
    const cur = U.ymKey(latest);
    const last = U.prevMonthKey(cur);
    const curS = M.summary(daily, cur);
    const lastFull = M.summary(daily, last);
    const lastMtd = M.summary(daily, last, curS.lastDay);
    const curSeries = M.dailySeries(daily, cur);
    const lastSeries = M.dailySeries(daily, last);
    const todayN = curSeries.totals[latest.getDate() - 1] || 0;
    const prevDayN = latest.getDate() > 1 ? curSeries.totals[latest.getDate() - 2] : (lastSeries.totals[lastSeries.totals.length - 1] || 0);

    // agents
    let activeCur = 0, activeLast = 0, ffAgents = 0, gvAgents = 0;
    const tlCur = new Map(), tlLast = new Map(), agCur = new Map(), agMeta = new Map();
    if (agents) {
      const setCur = new Set(), setLast = new Set();
      for (const a of agents) {
        if (a.ym === cur) { setCur.add(a.key); agCur.set(a.key, (agCur.get(a.key) || 0) + a.n); agMeta.set(a.key, a); if (!excl(a.tlName)) tlCur.set(a.tlName, (tlCur.get(a.tlName) || 0) + a.n); }
        if (a.ym === last) { setLast.add(a.key); if (!excl(a.tlName)) tlLast.set(a.tlName, (tlLast.get(a.tlName) || 0) + a.n); }
      }
      activeCur = setCur.size; activeLast = setLast.size;
      for (const k of setCur) ffAgents += agMeta.get(k).channel === 'First Forward' ? 1 : 0;
      gvAgents = activeCur - ffAgents;
    }
    // stock
    const stockTotal = stock ? U.sum(stock, (r) => r.n) : null;
    const stockVc4 = stock ? U.sum(stock.filter((r) => r.group === 'VC4'), (r) => r.n) : null;
    const stockComm = stock ? stockTotal - stockVc4 : null;
    // status
    const statusCur = status ? status.filter((s) => s.ym === cur) : [];
    const statusTotal = U.sum(statusCur, (s) => s.n);
    const hotlisted = U.sum(statusCur.filter((s) => /HOTLIST/i.test(s.status)), (s) => s.n);
    const activated = U.sum(statusCur.filter((s) => s.status === 'ACTIVATED'), (s) => s.n);

    const lm = U.labelYM(last), cm = U.labelYM(cur);
    // 📈 KPI sparklines (v3.11) — har KPI card ke andar chhota trend; series jahan available hai.
    const sparkOf = (vals) => (FF.wowzone && FF.wowzone.sparkline ? FF.wowzone.sparkline(vals, { w: 96, h: 26 }) : '');
    const mtdDays = curSeries.totals.slice(0, latest.getDate());
    const cum = []; mtdDays.reduce((a, v) => { const n = a + (v || 0); cum.push(n); return n; }, 0);
    const monthlyTotals = monthsList.map((m) => M.summary(daily, m).total);
    const monthlyVc4 = monthsList.map((m) => M.summary(daily, m).vc4);
    const monthlyComm = monthsList.map((m) => M.summary(daily, m).comm);
    const avgSeries = monthsList.map((m) => Math.round(M.summary(daily, m).avgPerDay || 0));
    const replSeries = monthsList.map((m) => M.summary(daily, m).replacement);
    const kpis = [
      kpi('g1', `Latest Day · ${U.labelDate(latest)} (${U.weekday(latest)})`, '⚡', U.fmt(todayN), `${U.deltaHtml(U.growth(todayN, prevDayN), { decimals: 0 })} vs previous day (${U.fmt(prevDayN)})`, null, sparkOf(mtdDays)),
      kpi('g2', `MTD Issuance · ${cm}`, '🏷️', U.fmt(curS.total), `${U.deltaHtml(U.growth(curS.total, lastMtd.total))} vs ${lm} same period (${U.fmt(lastMtd.total)})`, null, sparkOf(cum)),
      kpi('g3', 'VC4 (Payable) · MTD', '🚗', U.fmt(curS.vc4), `${U.fmtPct(U.pctOf(curS.vc4, curS.total), 0)} share · ${U.deltaHtml(U.growth(curS.vc4, lastMtd.vc4))} vs ${lm}`, null, sparkOf(monthlyVc4)),
      kpi('g4', 'Commercial (NVC4) · MTD', '🚚', U.fmt(curS.comm), `VC20 <b>${U.fmt(curS.vc20)}</b> · VC5+ <b>${U.fmt(curS.vc5p)}</b> · ${U.deltaHtml(U.growth(curS.comm, lastMtd.comm))}`, null, sparkOf(monthlyComm)),
      kpi('g5', 'Avg / Day · MTD', '📅', U.fmt(curS.avgPerDay), `${lm}: ${U.fmt(lastFull.avgPerDay)} / day · ${curS.activeDays} active days`, null, sparkOf(avgSeries)),
      kpi('g6', `Projected Month-End · ${cm}`, '🎯', U.fmt(curS.projected), `${U.deltaHtml(U.growth(curS.projected, lastFull.total))} vs ${lm} full (${U.fmt(lastFull.total)})`, null, sparkOf(monthlyTotals)),
      kpi('g7', 'Replacements · MTD', '🔁', U.fmt(curS.replacement), `${U.fmtPct(U.pctOf(curS.replacement, curS.total))} of total · ${U.deltaHtml(U.growth(curS.replacement, lastMtd.replacement))} vs ${lm}`, null, sparkOf(replSeries)),
      kpi('g8', 'Chassis / Wrong VRN · MTD', '🧩', `${U.fmt(curS.chassis)} <small>/ ${U.fmt(curS.wrongVrn)}</small>`, `Chassis ${U.fmtPct(U.pctOf(curS.chassis, curS.total))} · Wrong VRN ${U.fmtPct(U.pctOf(curS.wrongVrn, curS.total), 2)}`),
      kpi('g9', 'Stock in Field', '📦', stock ? U.fmt(stockTotal) : '—', stock ? `VC4 <b>${U.fmt(stockVc4)}</b> · Commercial <b>${U.fmt(stockComm)}</b> · ${curS.avgPerDay ? `${U.fmt(stockTotal / curS.avgPerDay)} days cover` : ''}` : 'StockDataa load nahi hua'),
      kpi('g10', 'Active Agents · MTD', '🧑‍💼', agents ? U.fmt(activeCur) : '—', agents ? `FF <b>${U.fmt(ffAgents)}</b> · GV <b>${U.fmt(gvAgents)}</b> · ${U.deltaHtml(U.growth(activeCur, activeLast), { decimals: 0 })} vs ${lm} (${U.fmt(activeLast)})` : 'Agent data load nahi hua'),
      kpi('g11', 'GV Partner Share · MTD', '🤝', U.fmtPct(U.pctOf(curS.gv, curS.total), 0), `GV <b>${U.fmt(curS.gv)}</b> · First Forward <b>${U.fmt(curS.ff)}</b>`),
      kpi('g12', 'Activated / Hotlisted · MTD', '✅', status ? `${U.fmtPct(U.pctOf(activated, statusTotal), 0)} <small>/ ${U.fmtPct(U.pctOf(hotlisted, statusTotal))}</small>` : '—', status ? `Activated <b>${U.fmt(activated)}</b> · Hotlisted <b>${U.fmt(hotlisted)}</b>` : 'Status data load nahi hua')
    ];

    // 🗓 Same-day-last-week (Features → weekCompare): latest data din vs usi weekday ka pichhla haf
    if (!FF.config.feat || FF.config.feat('weekCompare') !== false) {
      const prevW = new Date(latest); prevW.setDate(prevW.getDate() - 7);
      const sumDay = (dt) => U.sum(daily.filter((r) => r.d && r.d.getFullYear() === dt.getFullYear() && r.d.getMonth() === dt.getMonth() && r.d.getDate() === dt.getDate()), (r) => r.n);
      const wdN = sumDay(latest), wlN = sumDay(prevW);
      kpis.push(kpi('g13', `🗓 ${U.weekday(latest)} vs last week`, '🗓', U.fmt(wdN), `${U.deltaHtml(U.growth(wdN, wlN), { decimals: 0 })} vs ${U.labelDate(prevW)} (${U.fmt(wlN)}) · same weekday`));
    }

    // KPI drill-down specs (click any card → full breakdown, see kpiDetail.js)
    const latestK = U.dateKey(latest);
    const specs = [`src=ff&scope=day&date=${latestK}`, `src=ff&scope=mtd&ym=${cur}`, `src=ff&scope=mtd&ym=${cur}&f=vc4`, `src=ff&scope=mtd&ym=${cur}&f=comm`, `src=ff&scope=mtd&ym=${cur}`, `src=ff&scope=mtd&ym=${cur}`, `src=ff&scope=mtd&ym=${cur}&f=repl`, `src=ff&scope=mtd&ym=${cur}&f=chassis`, 'src=ff&scope=stock', `src=ff&scope=agents&ym=${cur}`, `src=ff&scope=mtd&ym=${cur}`, `src=ff&scope=status&ym=${cur}`];
    kpis.forEach((html, i) => { if (specs[i]) kpis[i] = html.replace('<div class="kpi ', `<div data-kpi="${esc(specs[i])}" class="kpi `); });

    // charts data
    const dayLabels = curSeries.days.map(String);
    const lastVals = lastSeries.totals.slice(0, curSeries.days.length).map((v, i) => (i < lastSeries.totals.length ? v : null));
    const curVals = curSeries.totals.map((v, i) => (i < latest.getDate() ? v : null));
    const lineChart = C.lines({ labels: dayLabels, tipLabels: curSeries.days.map((d) => `Day ${d}`), height: 250, series: [
      { name: cm, values: curVals, color: C.COLORS.current },
      { name: lm, values: lastVals, color: C.COLORS.last, dash: true, area: false }
    ] });
    const classDonut = C.donut({ items: [
      { label: 'VC4', value: curS.vc4 }, { label: 'VC20', value: curS.vc20 }, { label: 'VC5+', value: curS.vc5p }
    ], subtitle: 'MTD total' });

    const monthLabels = monthsList.map((m) => U.labelYM(m));
    const sums = monthsList.map((m) => M.summary(daily, m));
    const monthlyClass = C.bars({ labels: monthLabels, height: 200, series: [
      { name: 'VC4', values: sums.map((s) => s.vc4) }, { name: 'VC20', values: sums.map((s) => s.vc20) }, { name: 'VC5+', values: sums.map((s) => s.vc5p) }
    ] });
    const monthlyType = C.bars({ labels: monthLabels, height: 200, series: [
      { name: 'ISSUANCE', values: sums.map((s) => s.issuance) }, { name: 'REPLACEMENT', values: sums.map((s) => s.replacement) }
    ] });
    const monthlyChannel = C.bars({ labels: monthLabels, height: 200, series: [
      { name: 'First Forward', values: sums.map((s) => s.ff) }, { name: 'GV Partner', values: sums.map((s) => s.gv) }
    ] });

    const topN = FF.config.thresholds.topN || 10;
    const topTls = U.topEntries(tlCur, topN).map(([name, v], i) => ({ label: name, value: v, compare: tlLast.get(name) || 0, color: C.PALETTE[i % C.PALETTE.length], attr: `data-link="#/performance?view=tls&tl=${encodeURIComponent(name)}"` }));
    const topAgents = U.topEntries(agCur, topN).map(([key, v], i) => { const a = agMeta.get(key); return { label: a.name, sub: `${a.channel === 'GV Partner' ? 'GV · ' : ''}${excl(a.tlName) ? 'Direct' : a.tlName}`, value: v, color: a.channel === 'GV Partner' ? C.COLORS['GV Partner'] : C.PALETTE[i % C.PALETTE.length], attr: `data-link="#/performance?q=${encodeURIComponent(a.name)}"` }; });
    // VC4 vs Commercial comparison (MTD vs last month same period / full)
    const cmpRow = (label, a, b) => `<tr><td>${label}</td><td class="num"><b>${U.fmt(a)}</b></td><td class="num">${U.fmt(b)}</td><td class="num">${U.deltaHtml(U.growth(a, b), { decimals: 0 })}</td></tr>`;
    const vc4Comm = `<div class="grid g-2" style="margin-bottom:0"><div>${C.bars({ labels: ['VC4', 'VC20', 'VC5+', 'Commercial'], height: 200, series: [{ name: `${lm} (same period)`, values: [lastMtd.vc4, lastMtd.vc20, lastMtd.vc5p, lastMtd.comm], color: '#c7d2fe' }, { name: `${cm} MTD`, values: [curS.vc4, curS.vc20, curS.vc5p, curS.comm], color: '#6366f1' }], legendAlways: true })}</div>
      <table class="tbl compact"><thead><tr><th></th><th class="num">${cm} MTD</th><th class="num">${lm} same period</th><th class="num">Growth</th></tr></thead><tbody>${cmpRow('VC4', curS.vc4, lastMtd.vc4)}${cmpRow('VC20', curS.vc20, lastMtd.vc20)}${cmpRow('VC5+', curS.vc5p, lastMtd.vc5p)}${cmpRow('<b>Commercial (VC20 + VC5+)</b>', curS.comm, lastMtd.comm)}${cmpRow('<b>Total</b>', curS.total, lastMtd.total)}<tr><td>VC4 share</td><td class="num">${U.fmtPct(U.pctOf(curS.vc4, curS.total), 0)}</td><td class="num">${U.fmtPct(U.pctOf(lastMtd.vc4, lastMtd.total), 0)}</td><td></td></tr>${stock ? `<tr><td>Stock in field</td><td class="num">VC4 <b>${U.fmt(stockVc4)}</b></td><td class="num">Comm <b>${U.fmt(stockComm)}</b></td><td class="num dim">${curS.activeDays ? `${U.fmt(stockVc4 / (curS.vc4 / curS.activeDays))} / ${curS.comm ? U.fmt(stockComm / (curS.comm / curS.activeDays)) : '—'} days` : ''}</td></tr>` : ''}</tbody></table></div>`;

    let stockByClass = '', stockTls = '';
    if (stock) {
      const byCls = M.byDim(stock.map((r) => ({ ...r, ym: cur })), null, (r) => r.cls);
      const order = [...byCls.keys()].sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 999) - (parseInt(b.replace(/\D/g, ''), 10) || 999));
      stockByClass = C.bars({ labels: order, height: 190, series: [{ name: 'Stock', values: order.map((k) => byCls.get(k)), color: '#14b8a6' }] });
      const tlStock = U.groupSum(stock, (r) => r.tlName, (r) => r.n);
      for (const k of [...tlStock.keys()]) if (excl(k)) tlStock.delete(k);
      stockTls = C.hbars({ items: U.topEntries(tlStock, topN).map(([name, v], i) => ({ label: name, value: v, color: C.PALETTE[(i + 3) % C.PALETTE.length], sub: `VC4 ${U.fmt(U.sum(stock.filter((r) => r.tlName === name && r.group === 'VC4'), (r) => r.n))} · Comm ${U.fmt(U.sum(stock.filter((r) => r.tlName === name && r.group !== 'VC4'), (r) => r.n))}`, attr: `data-link="#/stock?tl=${encodeURIComponent(name)}"` })), valueLabel: 'Stock' });
    }
    const statusDonut = status ? C.donut({ items: U.topEntries(U.groupSum(statusCur, (s) => s.status, (s) => s.n), 7).map(([label, value]) => ({ label, value })), subtitle: 'tags MTD' }) : '';
    const vrnDonut = C.donut({ items: U.topEntries(M.byDim(daily, cur, (r) => r.vrnType || 'Other'), 6).map(([label, value]) => ({ label, value })), subtitle: 'VRN type MTD' });

    // weekday pattern (last 8 weeks)
    const cutoff = new Date(latest); cutoff.setDate(cutoff.getDate() - 55);
    const wdSum = new Array(7).fill(0), wdDays = Array.from({ length: 7 }, () => new Set());
    for (const r of daily) { if (r.d < cutoff) continue; wdSum[r.d.getDay()] += r.n; wdDays[r.d.getDay()].add(r.key); }
    const wdOrder = [1, 2, 3, 4, 5, 6, 0];
    const weekdayChart = C.bars({ labels: wdOrder.map((i) => U.DAYS[i]), height: 190, series: [{ name: 'Avg / day', values: wdOrder.map((i) => (wdDays[i].size ? Math.round(wdSum[i] / wdDays[i].size) : 0)), color: '#8b5cf6' }] });

    // last 14 days table
    const recent = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(latest); d.setDate(d.getDate() - i);
      const ym = U.ymKey(d), day = d.getDate();
      const rows = daily.filter((r) => r.ym === ym && r.day === day);
      const t = U.sum(rows, (r) => r.n);
      recent.push({ d, total: t, vc4: U.sum(rows.filter((r) => r.group === 'VC4'), (r) => r.n), comm: U.sum(rows.filter((r) => r.group !== 'VC4'), (r) => r.n), repl: U.sum(rows.filter((r) => r.type === 'REPLACEMENT'), (r) => r.n), gv: U.sum(rows.filter((r) => r.channel === 'GV Partner'), (r) => r.n) });
    }
    const recentRows = recent.map((r, i) => {
      const prev = recent[i + 1];
      return `<tr><td>${U.labelDate(r.d)} <span class="dim">${U.weekday(r.d)}</span></td><td class="num"><b>${U.fmt(r.total)}</b></td><td class="num">${U.fmt(r.vc4)}</td><td class="num">${U.fmt(r.comm)}</td><td class="num">${U.fmt(r.repl)}</td><td class="num">${U.fmt(r.gv)}</td><td>${prev ? U.deltaHtml(U.growth(r.total, prev.total), { decimals: 0 }) : '—'}</td></tr>`;
    }).join('');

    // ---- 🚨 Low VC4 stock alerts: cover (VC4 stock ÷ avg daily issuance) red threshold se kam ----
    let lowStockHtml = '', lowStockKey = '';
    if (stockAgents && agents) {
      const t = FF.config.thresholds;
      const normK = (s) => String(s || '').trim().toUpperCase();
      const agIssued = new Map();
      for (const ag of agents) { if (ag.ym !== cur) continue; agIssued.set(normK(ag.name), (agIssued.get(normK(ag.name)) || 0) + ag.n); }
      const agVc4 = new Map(), agTl = new Map();
      for (const r of stockAgents) {
        const k = normK(r.agentName); if (!k) continue;
        if (r.group === 'VC4') agVc4.set(k, (agVc4.get(k) || 0) + r.n);
        if (r.tlName && !agTl.has(k)) agTl.set(k, r.tlName);
      }
      const critical = [];
      for (const [k, vc4] of agVc4) {
        if (vc4 <= 0) continue;
        const iss = agIssued.get(k) || 0;
        const perDay = curS.lastDay ? iss / curS.lastDay : 0;
        if (!perDay) continue;
        const cover = vc4 / perDay;
        if (cover < t.coverRed) critical.push({ name: k, vc4, iss, cover, tl: agTl.get(k) || '—' });
      }
      critical.sort((x, y) => x.cover - y.cover);
      lowStockKey = `${cur}|${critical.slice(0, 25).map((c) => `${c.name}:${Math.round(c.cover)}`).join(',')}`;
      let dismissed = ''; try { dismissed = localStorage.getItem('ff_lowstock_dismissed') || ''; } catch {}
      if (critical.length && dismissed !== lowStockKey) {
        lowStockHtml = `<section class="card low-stock"><div class="card-head"><h3>🚨 Low VC4 stock alert <span class="dim">· ${critical.length} agents ka cover ${t.coverRed} din se kam</span></h3><div class="card-right"><a class="btn small primary" href="#/stock">📦 Stock page →</a><button class="btn small" id="ls-dismiss" title="Data change hone par alert wapas aayega">✕ Dismiss</button></div></div>
        <div class="card-body"><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent</th><th>TL</th><th class="num">VC4 stock</th><th class="num">MTD issued</th><th class="num">Cover (din)</th></tr></thead><tbody>${critical.slice(0, 8).map((c) => `<tr class="clickable" data-ls-agent="${esc(c.name)}"><td><b>${esc(c.name)}</b></td><td>${esc(FF.config.isExcludedTl(c.tl) ? 'Direct' : c.tl)}</td><td class="num">${U.fmt(c.vc4)}</td><td class="num">${U.fmt(c.iss)}</td><td class="num"><span class="badge red">🔴 ${U.fmt(c.cover, 1)}</span></td></tr>`).join('')}</tbody></table></div>
        <p class="dim small">Cover = VC4 stock ÷ avg daily issuance (MTD). In agents ko dispatch priority do — row click karke agent ka stock dekho. ${critical.length > 8 ? `(+${critical.length - 8} aur)` : ''}</p></div></section>`;
      }
    }

    // 🗣️ Voice summary text (features.voiceSummary — 🔊 button isi ko bolta hai)
    voiceText = [
      `Namaste. ${FF.config.brand} dashboard update.`,
      `${U.labelYM(cur, true)} me kul ${curS.total} tags issue hue — VC4 ${curS.vc4}, commercial ${curS.comm}.`,
      `${U.labelDate(latest)} ko ${todayN} tags.`,
      stockTotal != null ? `Stock field me ${stockTotal} tags, jisme VC4 stock ${stockVc4} hai.` : ''
    ].filter(Boolean).join(' ');

    body.innerHTML = `
      ${lowStockHtml}
      <div class="kpi-grid">${kpis.join('')}</div>
      <div class="grid g-2-1">
        ${card(`📈 Daily Issuance · ${cm} <span class="dim">vs</span> ${lm}`, lineChart, { right: `<a class="btn small" href="#/trend?mode=compare">Full trend →</a>` })}
        ${card('🍩 Class Mix · MTD', classDonut)}
      </div>
      ${card(`⚖️ VC4 vs Commercial · ${cm} MTD <span class="dim">vs</span> ${lm} (same period)`, vc4Comm, { right: `<a class="btn small" href="#/performance">Agent-wise →</a>` })}
      <div class="grid g-3">
        ${card('🗓️ Monthly Issuance by Class', monthlyClass)}
        ${card('🔁 Issuance vs Replacement', monthlyType)}
        ${card('🤝 First Forward vs GV Partner', monthlyChannel)}
      </div>
      <div class="grid g-2">
        ${agents ? card(`🏅 Top ${topN} TLs · ${cm} <span class="dim">(ghost bar = ${lm} · APS excluded)</span>`, C.hbars({ items: topTls, compareLabel: lm, valueLabel: cm })) : sectionError('Top TLs', agentsR.reason)}
        ${agents ? card(`⭐ Top ${topN} Agents · ${cm}`, C.hbars({ items: topAgents, valueLabel: cm })) : sectionError('Top Agents', agentsR.reason)}
      </div>
      <div class="grid g-3">
        ${stock ? card('📦 Stock by Class (StockDataa)', stockByClass) : sectionError('Stock by Class', stockR.reason)}
        ${stock ? card('🏬 Top TLs by Stock', stockTls) : sectionError('Top TLs by Stock', stockR.reason)}
        ${status ? card('🚦 Tag Status · MTD', statusDonut) : sectionError('Tag Status', statusR.reason)}
      </div>
      <div class="grid g-3">
        ${card('📆 Weekday Pattern <span class="dim">(avg/day, last 8 weeks)</span>', weekdayChart)}
        ${card('🔖 VRN Type · MTD', vrnDonut)}
        ${card('🕒 Last 14 Days', `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Date</th><th class="num">Total</th><th class="num">VC4</th><th class="num">Comm</th><th class="num">Repl</th><th class="num">GV</th><th>vs prev</th></tr></thead><tbody>${recentRows}</tbody></table></div>`)}
      </div>
      <p class="foot-note">Source: EIR (issuance log) · StockDataa (inventory) · Loaded ${U.timeLabel(S.loadedAt || FF.data.lastLoadAt)} · Months in data: ${monthLabels.join(', ')} · Data sirf ↻ ya browser refresh par update hota hai</p>`;
    C.mount(body);
    const lsDismiss = U.$('#ls-dismiss', body);
    if (lsDismiss) lsDismiss.addEventListener('click', () => { try { localStorage.setItem('ff_lowstock_dismissed', lowStockKey); } catch {} const c = lsDismiss.closest('.card'); if (c) c.remove(); });
    body.addEventListener('click', (e) => {
      const r = e.target.closest('[data-ls-agent]');
      if (r) FF.app.navigate('stock', { agent: r.dataset.lsAgent });
    });
  }

  FF.pages.dashboard = { title: 'Dashboard', render };
})(window.FF);
