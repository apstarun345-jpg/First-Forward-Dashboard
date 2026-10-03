/* Trend page: daily / weekly / monthly / last-vs-current comparison, with breakdowns and TL / agent filters. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, C = FF.charts, S = FF.store;
  const esc = U.esc;
  const DIMS = {
    total: { label: 'Total', fn: () => 'Total' },
    class: { label: 'Class (VC4 / VC20 / VC5+)', fn: (r) => r.group, order: ['VC4', 'VC20', 'VC5+'] },
    type: { label: 'Issuance vs Replacement', fn: (r) => r.type, order: ['ISSUANCE', 'REPLACEMENT'] },
    channel: { label: 'First Forward vs GV Partner', fn: (r) => r.channel, order: ['First Forward', 'GV Partner'] },
    vrn: { label: 'VRN Type', fn: (r) => r.vrnType || 'Other' }
  };
  const MODES = [['daily', '📅 Daily'], ['weekly', '🗓️ Weekly'], ['monthly', '📆 Monthly'], ['compare', '⚖️ Last vs Current'], ['expected', '🎯 Expected this month']];
  /** 🎯 Expected this month — run-rate × month ke din, class-wise + replacement ke bina.
      Data basis: FF = kal tak ka data (aaj ka data kal aata hai) · GV = live aaj. */
  function expectedRows(rows, ym, ch) {
    const b = (U.channelBasis ? U.channelBasis(ch || 'ff', { force: true }) : (U.reportBasis ? U.reportBasis() : { days: U.runRateDays(), shortLabel: '' }));
    // Expected numerator must use only report-available days. GV live rows for today
    // are still shown elsewhere, but must never inflate the month-end projection.
    const cur = rows.filter((r) => r.ym === ym && Number(r.day) <= Math.max(1, b.days));
    const days = Math.max(1, b.days);
    const monthDays = U.daysInMonth(ym);
    const left = Math.max(0, monthDays - days);
    const sum = (list, fn) => U.sum(list, fn);
    const mk = (label, list) => {
      const curN = sum(list, (r) => r.n);
      const rate = curN / days;
      return {
        label, cur: curN, rate,
        expected: Math.round(rate * monthDays),
        pending: Math.round(rate * left),
        vrnDays: left ? Math.round((left / days) * curN) : 0
      };
    };
    const byGroup = (g) => cur.filter((r) => r.group === g);
    const noRepl = (list) => list.filter((r) => r.type !== 'REPLACEMENT');
    const v4 = mk('VC4 (payable)', byGroup('VC4'));
    const v20 = mk('VC20', byGroup('VC20'));
    const v5p = mk('VC5+', byGroup('VC5+'));
    const comm = mk('All Commercial (VC20 + VC5+)', [...byGroup('VC20'), ...byGroup('VC5+')]);
    const repl = mk('Replacement', cur.filter((r) => r.type === 'REPLACEMENT'));
    const commNoRepl = mk('Commercial · bina replacement', noRepl([...byGroup('VC20'), ...byGroup('VC5+')]));
    const v4NoRepl = mk('VC4 · bina replacement', noRepl(byGroup('VC4')));
    const total = mk('Total (all tags)', cur);
    const totalNoRepl = mk('Total · bina replacement', noRepl(cur));
    return { basis: b, days, monthDays, left, rows: [v4, v20, v5p, comm, v4NoRepl, commNoRepl, repl, total, totalNoRepl] };
  }

  function dimKeys(rows, dim) {
    const present = U.uniq(rows.map(dim.fn));
    if (dim.order) return dim.order.filter((k) => present.includes(k)).concat(present.filter((k) => !dim.order.includes(k)));
    const sums = U.groupSum(rows, dim.fn, (r) => r.n);
    return U.topEntries(sums, 8).map((e) => e[0]);
  }
  function tableHtml(header, rows, numericFrom) {
    return `<div class="table-wrap"><table class="tbl"><thead><tr>${header.map((h, i) => `<th class="${i >= numericFrom ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i >= numericFrom ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function kpiMini(label, value, foot, cls) {
    return `<div class="mini-kpi ${cls || ''}"><span class="mini-label">${esc(label)}</span><span class="mini-value">${value}</span>${foot ? `<span class="mini-foot">${foot}</span>` : ''}</div>`;
  }

  async function render(root, params, ctx) {
    const fresh = !!(ctx && ctx.fresh);
    const p = params || {};
    const mode = MODES.some((m) => m[0] === p.mode) ? p.mode : 'daily';
    const dimKey = DIMS[p.dim] ? p.dim : (mode === 'compare' || mode === 'expected' ? 'total' : 'class');
    const filter = { tl: p.tl || '', agent: p.agent || '' };
    const ffDirectNames = (FF.config.directRules().ffTlNames || ['APS']).filter(Boolean);
    const isDirectTlFilter = !!filter.tl && ffDirectNames.some((n) => n.toUpperCase() === String(filter.tl).toUpperCase());
    const filterLabel = filter.agent ? `Agent: ${filter.agent}` : isDirectTlFilter ? `🚫 Direct Agents (${filter.tl}) — TL-managed nahi` : filter.tl ? `TL: ${filter.tl}` : 'All agents';

    const shareOn = !FF.config.feat || FF.config.feat('share') !== false;
    root.innerHTML = `<div class="page-head"><div><h1>📈 Trend</h1><p class="sub">Daily · Weekly · Monthly · Last vs Current · Expected this month — EIR issuance log</p></div>
      <div class="head-actions">${shareOn ? '<button class="btn" id="tr-wa" title="Trend summary WhatsApp par bhejo">📤 WhatsApp</button>' : ''}<button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div id="tr-controls"></div><div id="tr-body">${U.spinner('Trend data aggregate ho raha hai…')}</div>`;

    // All-agents daily is preloaded; a TL / agent drill-down is one small aggregated query (cached on the server).
    const [dailyR, agentsR] = await Promise.allSettled([filter.tl || filter.agent ? M.loadDaily(filter, { fresh }) : S.need('daily'), S.need('agents')]);
    if (!root.isConnected) return;
    const body = U.$('#tr-body', root);
    const controls = U.$('#tr-controls', root);
    const agents = agentsR.status === 'fulfilled' ? agentsR.value : [];

    // ---- controls ---------------------------------------------------------------
    const tlVolume = U.groupSum(agents.filter((a) => !FF.config.isExcludedTl(a.tlName)), (a) => a.tlName, (a) => a.n);
    const tlOptions = U.topEntries(tlVolume).map(([name, v]) => `<option value="${esc(name)}" ${name === filter.tl ? 'selected' : ''}>${esc(name)} (${U.fmtShort(v)})</option>`).join('');
    // 🧍 Direct agents ka apna filter — FF rule: TL Name APS (configured names se).
    const directVol = U.sum(agents.filter((a) => FF.config.isExcludedTl(a.tlName)), (a) => a.n);
    const directOptions = directVol ? ffDirectNames.map((n) => `<option value="${esc(n)}" ${String(filter.tl).toUpperCase() === n.toUpperCase() ? 'selected' : ''}>🚫 Direct Agents · ${esc(n)} (${U.fmtShort(directVol)})</option>`).join('') : '';
    const agentVol = U.groupSum(agents, (a) => a.name, (a) => a.n);
    const agentTl = new Map(); agents.forEach((a) => { if (!agentTl.has(a.name)) agentTl.set(a.name, FF.config.isExcludedTl(a.tlName) ? FF.config.directLabel(a, 'ff') : a.tlName); });
    const allDaily = dailyR.status === 'fulfilled' ? dailyR.value : [];
    const monthsList = M.months(allDaily);
    const waBtn = U.$('#tr-wa', root);
    if (waBtn) waBtn.addEventListener('click', () => {
      const cm = monthsList[monthsList.length - 1];
      const s = cm ? M.summary(allDaily, cm) : null;
      const text = `📈 ${FF.config.brand} Trend · ${mode === 'daily' ? 'Daily' : mode === 'weekly' ? 'Weekly' : mode === 'monthly' ? 'Monthly' : 'Compare'}${filterLabel !== 'All agents' ? ` · ${filterLabel}` : ''}\n${s ? `${U.labelYM(cm, true)}: ${U.fmt(s.total)} tags · avg ${U.fmt(s.avgPerDay)}/din${s.projected ? ` · projected ${U.fmt(s.projected)}` : ''}` : ''}\n📅 ${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
      FF.app.shareWhatsApp(text);
    });
    const latest = M.latestDate(allDaily);
    const curMonth = monthsList.includes(p.month) ? p.month : (latest ? U.ymKey(latest) : monthsList[monthsList.length - 1]);
    controls.innerHTML = `<div class="card controls"><div class="seg">${MODES.map(([k, l]) => `<button class="seg-btn ${k === mode ? 'on' : ''}" data-param="mode" data-value="${k}">${l}</button>`).join('')}</div>
      <div class="ctrl-row">
        ${mode === 'daily' ? `<label>Month <select data-param="month">${monthsList.map((m) => `<option value="${m}" ${m === curMonth ? 'selected' : ''}>${U.labelYM(m, true)}</option>`).join('')}</select></label>` : ''}
        <label>Breakdown <select data-param="dim">${Object.entries(DIMS).map(([k, d]) => `<option value="${k}" ${k === dimKey ? 'selected' : ''}>${d.label}</option>`).join('')}</select></label>
        <label>TL <select data-param="tl"><option value="">All TLs</option>${directOptions}${tlOptions}</select></label>
        <label>Find <span class="finder-input small"><input class="input" id="tr-find" placeholder="Agent / TL naam type karo → select" value="${esc(filter.agent)}"></span></label>
        ${filter.tl || filter.agent ? `<button class="btn small" data-action="clear-filters">✕ Clear filters</button>` : ''}
        <span class="ctrl-note">${esc(filterLabel)}</span>
      </div></div>`;

    const findInput = U.$('#tr-find', controls);
    U.suggest(findInput, {
      items: () => [...U.topEntries(tlVolume).map(([name, v]) => ({ kind: 'tl', kindLabel: 'TL', label: name, sub: `${U.fmtShort(v)} tags`, value: name })), ...U.topEntries(agentVol).map(([name, v]) => ({ kind: 'agent', kindLabel: 'Agent', label: name, sub: `${agentTl.get(name) || ''} · ${U.fmtShort(v)} tags`, value: name }))],
      onPick: (it) => { if (it.value && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('Trend Find', it.value); FF.app.updateParams(it.kind === 'tl' ? { tl: it.value, agent: '' } : { agent: it.value, tl: '' }); },
      onEnter: (q) => { if (!q) { FF.app.updateParams({ agent: '', tl: '' }); return; } if (FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('Trend Find', q); const hit = [...agentVol.keys()].find((n) => n.toUpperCase() === q.toUpperCase()) || [...agentVol.keys()].find((n) => n.toUpperCase().includes(q.toUpperCase())); if (hit) FF.app.updateParams({ agent: hit, tl: '' }); else U.toast('Koi agent match nahi hua', 'err'); }
    });
    if (dailyR.status !== 'fulfilled') { body.innerHTML = U.errorBox(dailyR.reason, 'data-action="refresh"'); return; }
    if (!allDaily.length) { body.innerHTML = `<div class="empty-state">😶 Is filter ke liye koi issuance data nahi mila.<br><button class="btn" data-action="clear-filters">Clear filters</button></div>`; return; }
    const dim = DIMS[dimKey];
    const keys = dimKeys(allDaily, dim);
    const seriesFor = (bucketsMap, bucketKeys) => keys.map((k) => ({ name: k, values: bucketKeys.map((b) => (bucketsMap.get(b) && bucketsMap.get(b).get(k)) || 0) }));

    let html = '';
    if (mode === 'daily') {
      const s = M.dailySeries(allDaily, curMonth, dim.fn);
      const sum = M.summary(allDaily, curMonth);
      const lastM = U.prevMonthKey(curMonth);
      const lastS = M.dailySeries(allDaily, lastM);
      const lastMtd = M.summary(allDaily, lastM, sum.lastDay);
      const upto = curMonth === (latest ? U.ymKey(latest) : curMonth) ? latest.getDate() : s.days.length;
      const labels = s.labels.slice(0, upto);
      const series = keys.map((k) => ({ name: k, values: (s.dims.get(k) || []).slice(0, upto) }));
      const best = s.totals.reduce((acc, v, i) => (v > acc.v ? { v, i } : acc), { v: 0, i: -1 });
      html += `<div class="mini-grid">
        ${kpiMini(`${U.labelYM(curMonth)} total`, U.fmt(sum.total), `${sum.activeDays} active days`, 'c1')}
        ${kpiMini('Avg / day', U.fmt(sum.avgPerDay), `Best day: ${best.i >= 0 ? `${best.i + 1} ${U.MONTHS[U.ymParts(curMonth).m - 1]} (${U.fmt(best.v)})` : '—'}`, 'c2')}
        ${kpiMini('vs last month (same period)', U.deltaHtml(U.growth(sum.total, lastMtd.total)), `${U.labelYM(lastM)} till day ${sum.lastDay}: ${U.fmt(lastMtd.total)}`, 'c3')}
        ${kpiMini('Projected month-end', U.fmt(sum.projected), `Days in month: ${sum.daysInMonth}`, 'c4')}
      </div>`;
      html += `<section class="card"><div class="card-head"><h3>Daily issuance · ${U.labelYM(curMonth, true)} · by ${esc(dim.label)}</h3></div><div class="card-body">${C.bars({ labels, tipLabels: labels.map((d) => `${d} ${U.MONTHS[U.ymParts(curMonth).m - 1]} (${U.weekday(s.dates[d - 1])})`), series, height: 260, showValues: labels.length <= 31, highlight: best.i })}</div></section>`;
      let cum = 0;
      const rows = s.days.slice(0, upto).map((d, i) => {
        const t = s.totals[i]; cum += t;
        const prev = i > 0 ? s.totals[i - 1] : null;
        const lastSame = lastS.totals[i] !== undefined ? lastS.totals[i] : null;
        return [`${U.pad2(d)} ${U.MONTHS[U.ymParts(curMonth).m - 1]} <span class="dim">${U.weekday(s.dates[i])}</span>`, ...keys.map((k) => U.fmt((s.dims.get(k) || [])[i] || 0)), `<b>${U.fmt(t)}</b>`, U.fmt(cum), prev === null ? '—' : U.deltaHtml(U.growth(t, prev), { decimals: 0 }), lastSame === null ? '—' : `${U.fmt(lastSame)} ${U.deltaHtml(U.growth(t, lastSame), { decimals: 0 })}`];
      }).reverse();
      html += `<section class="card"><div class="card-head"><h3>Day-wise table</h3><div class="card-right"><button class="btn small" data-action="export" data-name="trend-daily-${curMonth}">⬇ CSV</button></div></div><div class="card-body">${tableHtml(['Date', ...keys, 'Total', 'Cumulative', 'vs prev day', `Same day ${U.labelYM(lastM)}`], rows, 1)}</div></section>`;
    } else if (mode === 'weekly') {
      const buckets = new Map();
      for (const r of allDaily) {
        const wk = U.dateKey(U.weekStart(r.d));
        if (!buckets.has(wk)) buckets.set(wk, new Map());
        const b = buckets.get(wk); const k = dim.fn(r);
        b.set(k, (b.get(k) || 0) + r.n); b.set('__total', (b.get('__total') || 0) + r.n);
        b.set('__days', (b.get('__days') || new Set()).add(r.key));
      }
      const wkKeys = [...buckets.keys()].sort();
      const labels = wkKeys.map((k) => U.labelDateKey(k));
      const series = seriesFor(buckets, wkKeys);
      html += `<section class="card"><div class="card-head"><h3>Weekly issuance (Mon–Sun) · by ${esc(dim.label)}</h3></div><div class="card-body">${C.bars({ labels, tipLabels: labels.map((l) => `Week of ${l}`), series, height: 260 })}</div></section>`;
      const rows = wkKeys.map((k, i) => {
        const b = buckets.get(k); const t = b.get('__total'); const prev = i > 0 ? buckets.get(wkKeys[i - 1]).get('__total') : null;
        const end = U.fromDateKey(k); end.setDate(end.getDate() + 6);
        return [`${U.labelDateKey(k)} – ${U.labelDate(end)}`, ...keys.map((kk) => U.fmt(b.get(kk) || 0)), `<b>${U.fmt(t)}</b>`, U.fmt(t / b.get('__days').size), `${b.get('__days').size}`, prev === null ? '—' : U.deltaHtml(U.growth(t, prev), { decimals: 0 })];
      }).reverse();
      html += `<section class="card"><div class="card-head"><h3>Week-wise table</h3><div class="card-right"><button class="btn small" data-action="export" data-name="trend-weekly">⬇ CSV</button></div></div><div class="card-body">${tableHtml(['Week', ...keys, 'Total', 'Avg / day', 'Days', 'vs prev week'], rows, 1)}</div></section>`;
    } else if (mode === 'monthly') {
      const buckets = new Map();
      for (const r of allDaily) {
        if (!buckets.has(r.ym)) buckets.set(r.ym, new Map());
        const b = buckets.get(r.ym); const k = dim.fn(r);
        b.set(k, (b.get(k) || 0) + r.n);
      }
      const labels = monthsList.map((m) => U.labelYM(m));
      const series = seriesFor(buckets, monthsList);
      const sums = monthsList.map((m) => M.summary(allDaily, m));
      html += `<div class="mini-grid">${sums.slice(-3).map((s, i) => kpiMini(U.labelYM(s.ym, true), U.fmt(s.total), `${s.activeDays} days · ${U.fmt(s.avgPerDay)}/day${i > 0 || sums.length > 3 ? ` · ${U.deltaHtml(U.growth(s.total, (sums[sums.indexOf(s) - 1] || {}).total || null), { decimals: 0 })} MoM` : ''}`, `c${(i % 4) + 1}`)).join('')}</div>`;
      html += `<section class="card"><div class="card-head"><h3>Monthly issuance · by ${esc(dim.label)}</h3></div><div class="card-body">${C.bars({ labels, series, height: 260, legendAlways: true })}</div></section>`;
      const rows = sums.map((s, i) => {
        const prev = sums[i - 1];
        return [`<b>${U.labelYM(s.ym, true)}</b>`, ...keys.map((k) => U.fmt(buckets.get(s.ym).get(k) || 0)), `<b>${U.fmt(s.total)}</b>`, `${s.activeDays}`, U.fmt(s.avgPerDay), U.fmt(s.replacement), U.fmt(s.chassis), prev ? U.deltaHtml(U.growth(s.total, prev.total)) : '—', prev ? U.deltaHtml(U.growth(s.avgPerDay, prev.avgPerDay)) : '—'];
      }).reverse();
      html += `<section class="card"><div class="card-head"><h3>Month-wise table</h3><div class="card-right"><button class="btn small" data-action="export" data-name="trend-monthly">⬇ CSV</button></div></div><div class="card-body">${tableHtml(['Month', ...keys, 'Total', 'Active days', 'Avg / day', 'Replacement', 'Chassis', 'MoM total', 'MoM avg/day'], rows, 1)}</div></section>`;
    } else if (mode === 'expected') {
      // 🎯 Expected this month — run-rate ke hisaab se, class-wise + replacement ke bina.
      // Data basis alag hai: FF = kal tak (aaj ka data kal aata hai) · GV = live aaj.
      const curYm = latest ? U.ymKey(latest) : monthsList[monthsList.length - 1];
      const lastYm = U.prevMonthKey(curYm);
      const chOpts = [['', '🔵 Both channels'], ['ff', '🟦 First Forward'], ['gv', '🟩 GV Partner']];
      html += `<div class="card controls"><div class="ctrl-row"><label>Channel <select data-param="ch">${chOpts.map(([v, l]) => `<option value="${v}" ${v === (p.ch || '') ? 'selected' : ''}>${l}</option>`).join('')}</select></label><span class="ctrl-note">${esc(filterLabel)}</span></div></div>`;
      const wanted = (p.ch || '') === 'ff' ? ['First Forward'] : (p.ch || '') === 'gv' ? ['GV Partner'] : ['First Forward', 'GV Partner'];
      for (const chName of wanted) {
        const key = chName === 'GV Partner' ? 'gv' : 'ff';
        const ex = expectedRows(allDaily.filter((r) => r.channel === chName), curYm, key);
        const lastRows = allDaily.filter((r) => r.channel === chName && r.ym === lastYm);
        const lastSum = M.summary(lastRows, lastYm);
        const t = ex.rows[ex.rows.length - 1];
        const comm = ex.rows.find((r) => r.label.indexOf('All Commercial') === 0) || { cur: 0, expected: 0 };
        html += `<div class="mini-grid">
          ${kpiMini(`${chName} · expected month-end`, U.fmt(t.expected), `${U.fmt(t.rate, true)}/day × ${ex.monthDays} din`, 'c1')}
          ${kpiMini('Issued ab tak', U.fmt(t.cur), `${ex.left} din bache hain`, 'c2')}
          ${kpiMini('Aage aur kitna', U.fmt(t.pending), `run-rate ${U.fmt(t.rate, true)}/day`, 'c3')}
          ${kpiMini('Expected vs last month', U.deltaHtml(U.growth(t.expected, lastSum.total), { decimals: 0 }), `${U.labelYM(lastYm)} full: ${U.fmt(lastSum.total)}`, 'c4')}
        </div>
        <section class="card"><div class="card-head"><h3>🎯 Expected this month · ${esc(chName)}</h3><div class="card-right dim">${esc(U.basisText(key, ex.basis))} · ${ex.days}/${ex.monthDays} din</div></div>
        <div class="card-body">${C.bars({ labels: ex.rows.filter((r) => r.label.indexOf('bina replacement') === -1).map((r) => r.label), height: 230, showValues: true, series: [{ name: 'Issued ab tak', values: ex.rows.filter((r) => r.label.indexOf('bina replacement') === -1).map((r) => r.cur), color: '#c7d2fe' }, { name: 'Expected month-end', values: ex.rows.filter((r) => r.label.indexOf('bina replacement') === -1).map((r) => r.expected), color: '#6366f1' }], legendAlways: true })}</div></section>
        <section class="card"><div class="card-head"><h3>Class-wise expected · ${esc(U.labelYM(curYm, true))}</h3><div class="card-right"><button class="btn small" data-action="export" data-name="expected-${key}-${curYm}">⬇ CSV</button></div></div>
        <div class="card-body">${tableHtml(['Class', 'Issued ab tak', 'Run-rate / day', `Expected month-end`, 'Aage aur kitna', 'Share'], ex.rows.map((r) => [`<b>${esc(r.label)}</b>`, U.fmt(r.cur), U.fmt(r.rate, true), `<b>${U.fmt(r.expected)}</b>`, U.fmt(r.pending), U.pctOf(r.cur, t.cur) === null ? '—' : U.fmtPct(U.pctOf(r.cur, t.cur), 0)]), 1)}</div></section>
        <section class="card"><div class="card-head"><h3>🧾 Replacement ke bina (clean commercial)</h3><div class="card-right dim">Replacement tags minus karke</div></div>
        <div class="card-body">${tableHtml(['Class', 'Issued ab tak', 'Run-rate / day', 'Expected month-end', 'Replacement alag'], ex.rows.filter((r) => r.label.indexOf('bina replacement') !== -1).map((r) => [`<b>${esc(r.label)}</b>`, U.fmt(r.cur), U.fmt(r.rate, true), `<b>${U.fmt(r.expected)}</b>`, r.label.indexOf('Commercial') === 0 ? U.fmt((ex.rows.find((x) => x.label === 'Replacement') || {}).cur || 0) : '—']), 1)}</div></section>`;
      }
      html += `<section class="card"><div class="card-body dim small">📅 <b>Data basis</b> — First Forward ka report <b>kal ka data</b> laata hai, isliye uska run-rate ${U.fmt(U.channelBasis('ff', { force: true }).days)} din par hai. GV ka data <b>live</b> chalta hai (aaj ka), isliye uska run-rate aaj ke ${U.fmt(U.channelBasis('gv', { force: true }).days)} din par. Expected = run-rate × is month ke ${U.fmt(U.daysInMonth(curYm))} din.</div></section>`;
    } else {
      // compare: last vs current month
      const cur = latest ? U.ymKey(latest) : monthsList[monthsList.length - 1];
      const last = U.prevMonthKey(cur);
      const cs = M.dailySeries(allDaily, cur), ls = M.dailySeries(allDaily, last);
      const curSum = M.summary(allDaily, cur), lastFull = M.summary(allDaily, last), lastMtd = M.summary(allDaily, last, curSum.lastDay);
      const n = Math.max(cs.days.length, ls.days.length);
      const labels = Array.from({ length: n }, (_, i) => String(i + 1));
      const curVals = labels.map((_, i) => (i < curSum.lastDay ? cs.totals[i] || 0 : null));
      const lastVals = labels.map((_, i) => (i < ls.totals.length ? ls.totals[i] : null));
      let cc = 0, lc = 0;
      const curCum = curVals.map((v) => (v === null ? null : (cc += v)));
      const lastCum = lastVals.map((v) => (v === null ? null : (lc += v)));
      const cm = U.labelYM(cur), lm = U.labelYM(last);
      html += `<div class="mini-grid">
        ${kpiMini(`${cm} · MTD (till day ${curSum.lastDay})`, U.fmt(curSum.total), `${U.fmt(curSum.avgPerDay)} / day`, 'c1')}
        ${kpiMini(`${lm} · same period`, U.fmt(lastMtd.total), `${U.fmt(lastMtd.avgPerDay)} / day`, 'c2')}
        ${kpiMini('Growth (same period)', U.deltaHtml(U.growth(curSum.total, lastMtd.total)), `${curSum.total - lastMtd.total > 0 ? '+' : ''}${U.fmt(curSum.total - lastMtd.total)} tags`, 'c3')}
        ${kpiMini(`${lm} · full month`, U.fmt(lastFull.total), `${lastFull.activeDays} days`, 'c4')}
        ${kpiMini(`${cm} · projected`, U.fmt(curSum.projected), U.deltaHtml(U.growth(curSum.projected, lastFull.total)), 'c5')}
        ${kpiMini('Need / day to beat last month', curSum.lastDay < curSum.daysInMonth ? U.fmt(Math.max(0, (lastFull.total - curSum.total) / (curSum.daysInMonth - curSum.lastDay))) : '—', `${curSum.daysInMonth - curSum.lastDay} days left`, 'c6')}
      </div>`;
      html += `<div class="grid g-2">
        <section class="card"><div class="card-head"><h3>Daily · ${cm} vs ${lm}</h3></div><div class="card-body">${C.lines({ labels, tipLabels: labels.map((d) => `Day ${d}`), height: 250, series: [{ name: cm, values: curVals, color: C.COLORS.current }, { name: lm, values: lastVals, color: C.COLORS.last, dash: true, area: false }] })}</div></section>
        <section class="card"><div class="card-head"><h3>Cumulative · ${cm} vs ${lm}</h3></div><div class="card-body">${C.lines({ labels, tipLabels: labels.map((d) => `Till day ${d}`), height: 250, series: [{ name: cm, values: curCum, color: '#10b981' }, { name: lm, values: lastCum, color: '#f97316', dash: true, area: false }] })}</div></section>
      </div>`;
      // breakdown comparison
      const curBy = M.byDim(allDaily, cur, dim.fn), lastBy = M.byDim(allDaily.filter((r) => r.day <= curSum.lastDay), last, dim.fn);
      const bkeys = dimKey === 'total' ? ['VC4', 'VC20', 'VC5+'] : keys;
      const bCur = dimKey === 'total' ? M.byDim(allDaily, cur, (r) => r.group) : curBy;
      const bLast = dimKey === 'total' ? M.byDim(allDaily.filter((r) => r.day <= curSum.lastDay), last, (r) => r.group) : lastBy;
      html += `<div class="grid g-2">
        <section class="card"><div class="card-head"><h3>${dimKey === 'total' ? 'Class' : esc(dim.label)} · ${cm} vs ${lm} (same period)</h3></div><div class="card-body">${C.hbars({ items: bkeys.map((k, i) => ({ label: k, value: bCur.get(k) || 0, compare: bLast.get(k) || 0, color: C.color(k, i) })), valueLabel: cm, compareLabel: `${lm} (same period)` })}</div></section>
        <section class="card"><div class="card-head"><h3>Day-of-month table</h3><div class="card-right"><button class="btn small" data-action="export" data-name="trend-compare">⬇ CSV</button></div></div><div class="card-body">${tableHtml(['Day', cm, lm, 'Diff', 'Δ %', `Cum ${cm}`, `Cum ${lm}`], labels.map((d, i) => [d, curVals[i] === null ? '—' : `<b>${U.fmt(curVals[i])}</b>`, lastVals[i] === null ? '—' : U.fmt(lastVals[i]), curVals[i] === null || lastVals[i] === null ? '—' : `${curVals[i] - lastVals[i] > 0 ? '+' : ''}${U.fmt(curVals[i] - lastVals[i])}`, curVals[i] === null || lastVals[i] === null ? '—' : U.deltaHtml(U.growth(curVals[i], lastVals[i]), { decimals: 0 }), curCum[i] === null ? '—' : U.fmt(curCum[i]), lastCum[i] === null ? '—' : U.fmt(lastCum[i])]), 1)}</div></section>
      </div>`;
    }
    body.innerHTML = html + `<p class="foot-note">Filter: ${esc(filterLabel)} · Rows aggregated by Google (gviz) · Loaded ${U.timeLabel(S.loadedAt || FF.data.lastLoadAt)}</p>`;
    if (mode === 'expected') {
      const want = new Set((p.ch || '') === 'ff' ? ['ff'] : (p.ch || '') === 'gv' ? ['gv'] : ['ff', 'gv']);
      const exRows = [];
      for (const chName of ['First Forward', 'GV Partner']) {
        const key = chName === 'GV Partner' ? 'gv' : 'ff';
        if (!want.has(key)) continue;
        const ex = expectedRows(allDaily.filter((r) => r.channel === chName), latest ? U.ymKey(latest) : monthsList[monthsList.length - 1], key);
        for (const r of ex.rows) exRows.push([chName, U.basisText(key, ex.basis), r.label, r.cur, Number(r.rate.toFixed(2)), r.expected, r.pending]);
      }
      body.__expected = exRows;
      controls.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action="export"]');
        if (!b || !b.dataset.name || b.dataset.name.indexOf('expected-') !== 0) return;
        U.downloadCsv(`${b.dataset.name}-${U.stamp()}.csv`, ['Channel', 'Data basis', 'Class', 'Issued ab tak', 'Run-rate / day', 'Expected month-end', 'Aage aur kitna'], exRows);
      });
    }
    C.mount(body);
  }

  FF.pages.trend = { title: 'Trend', render };
})(window.FF);
