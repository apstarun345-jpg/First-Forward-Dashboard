/* Professional intelligence layer: commission analytics, verified dual-channel identity,
   stock forecasting, data-quality checks, management cockpit and collaborative workspace. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, D = FF.data, S = FF.store, G = FF.gv, M = FF.model, C = FF.charts;
  const esc = U.esc, clean = U.clean;
  const mem = { details: null, detailsPromise: null, cross: null, quality: null, workspace: null, workspacePromise: null, workspaceVersion: 0, forecastHistory: null, forecastHistoryPromise: null };

  const head = (icon, title, sub, actions) => `<div class="page-head"><div><h1>${icon} ${esc(title)}</h1><p class="sub">${sub}</p></div><div class="head-actions">${actions || ''}<button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>`;
  const money = (value, digits) => Number(value || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: digits === undefined ? 0 : digits });
  const ratePct = (num, den) => den ? (num / den) * 100 : 0;
  const normId = (value) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normName = (value) => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const normBarcode = (value) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const validValue = (v) => v !== null && v !== undefined && v !== '';
  const sum = (rows, fn) => rows.reduce((n, row) => n + (Number(fn(row)) || 0), 0);
  const mapAdd = (map, key, init, apply) => { if (!map.has(key)) map.set(key, init()); const row = map.get(key); apply(row); return row; };
  const classMix = (obj) => Object.entries(obj || {}).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${U.fmt(n)}`).join(' · ') || '—';
  const defaultSlabs = [{ min: 1, max: 50, rate: '' }, { min: 51, max: 100, rate: '' }, { min: 101, max: 150, rate: '' }, { min: 151, max: 250, rate: '' }, { min: 251, max: null, rate: '' }];
  function slabExpected(count, channel) {
    const settings = FF.config.commissionSlabs || {}, n = Math.max(0, Math.floor(Number(count) || 0));
    if (!settings.enabled) return { expected: null, tier: 'Disabled', model: settings.model || 'agentTier' };
    if (!n) return { expected: 0, tier: '0 tags', model: settings.model || 'agentTier' };
    const model = settings.model === 'marginal' ? 'marginal' : 'agentTier';
    const bands = settings.channels && settings.channels[channel] || defaultSlabs;
    const bandLabel = (b) => b.max === null ? `${b.min}+` : `${b.min}–${b.max}`;
    if (model === 'agentTier') {
      const band = bands.find((b) => n >= Number(b.min) && (b.max === null || n <= Number(b.max)));
      if (!band || band.rate === '' || band.rate === null || band.rate === undefined || !Number.isFinite(Number(band.rate))) return { expected: null, tier: band ? bandLabel(band) : 'No slab', model };
      return { expected: n * Number(band.rate), tier: bandLabel(band), rate: Number(band.rate), model };
    }
    let expected = 0, missing = [], applied = [];
    bands.forEach((b) => {
      const upper = b.max === null ? n : Math.min(n, Number(b.max));
      const qty = Math.max(0, upper - Number(b.min) + 1);
      if (!qty) return;
      if (b.rate === '' || b.rate === null || b.rate === undefined || !Number.isFinite(Number(b.rate))) missing.push(bandLabel(b));
      else { expected += qty * Number(b.rate); applied.push(`${bandLabel(b)} × ${qty}`); }
    });
    return { expected: missing.length ? null : expected, tier: applied.join(', ') || (missing.length ? `Rate missing: ${missing.join(', ')}` : '—'), missing, model };
  }
  const slabVarianceRows = (items, channel, getCount, getActual, getName, getId, getTl) => items.map((r) => {
    const count = Number(getCount(r)) || 0, actualRaw = getActual(r), actual = actualRaw === null || actualRaw === undefined || actualRaw === '' ? null : Number(actualRaw), calc = slabExpected(count, channel);
    const variance = actual !== null && calc.expected !== null ? actual - calc.expected : null;
    return { name: getName(r) || getId(r) || 'Unknown agent', id: getId(r) || '', tl: getTl(r) || 'Direct / Unmapped', count, actual, ...calc, variance, status: variance === null ? (calc.expected === null ? 'Rate not configured' : 'Actual payout unavailable') : Math.abs(variance) <= 0.01 ? 'Matches slab' : variance > 0 ? 'More actual than slab' : 'Less actual than slab' };
  });
  const latestMonth = (rows) => [...new Set((rows || []).map((r) => r.ym).filter(Boolean))].sort().pop() || U.ymKey(new Date());
  const directAgent = (row) => {
    const r = row || {};
    if (FF.config.isDirectAgent && FF.config.isDirectAgent(r)) return true;
    const aid = normId(r.agentId || r.id), tid = normId(r.tlId || r.supervisorId);
    const an = normName(r.agentName || r.name), tn = normName(r.tlName || r.tl);
    // GV Master represents a direct agent as its own supervisor; require both identity fields to
    // agree so a coincidental same numeric ID cannot collapse a real TL relationship.
    return !!(aid && tid && aid === tid && an && tn && an === tn);
  };
  const segmentOf = (row) => directAgent(row) ? 'Direct Agent' : (clean(row && (row.tlName || row.tlId)) && !/^(-|—|NA|N\/A|UNKNOWN)$/i.test(clean(row.tlName || row.tlId)) ? 'TL-managed' : 'Other / unmapped');
  const dateText = (value) => { const d = value instanceof Date ? value : new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; };
  const dateTimeText = (value) => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; };
  const dayMs = 864e5;
  const dayDate = (value) => { const d = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`); d.setHours(0, 0, 0, 0); return d; };
  const shiftDay = (value, count) => { const d = dayDate(value); d.setDate(d.getDate() + count); return d; };
  const calendarDays = (from, to) => Math.max(0, Math.round((dayDate(to) - dayDate(from)) / dayMs) + 1);
  const statusPill = (text, tone) => `<span class="ins-pill ${tone || ''}">${esc(text)}</span>`;
  const empty = (title, body) => `<div class="ins-empty"><b>${esc(title)}</b><p>${esc(body || '')}</p></div>`;
  const sourceChip = (name, detail) => `<span class="source-chip" title="${esc(detail || '')}">✓ ${esc(name)}</span>`;
  const metric = (label, value, foot, tone) => `<div class="ins-metric ${tone || ''}"><small>${esc(label)}</small><b>${value}</b><span>${foot || '&nbsp;'}</span></div>`;
  const csvButton = (id, text) => `<button class="btn" id="${id}">⬇ ${esc(text || 'CSV')}</button>`;
  const exportButtons = (base) => `${csvButton(`${base}-csv`, 'CSV')}<button class="btn" id="${base}-xlsx">⬇ Excel</button>`;
  const printButton = '<button class="btn" onclick="window.print()">🖨 PDF / Print</button>';
  function bindMetricDetails(root, title, headers, rows, detailSets) {
    root.querySelectorAll('.ins-metrics .ins-metric').forEach((el) => { el.dataset.metricDetail = el.querySelector('small')?.textContent || 'Metric'; el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.setAttribute('aria-label', `${el.dataset.metricDetail}; click to view rows`); const open = () => {
      const old = root.querySelector('#metric-detail-dialog'); if (old) old.remove();
      const chosen = detailSets && detailSets[el.dataset.metricDetail] || {};
      const detailRows = chosen.rows || rows, detailHeaders = chosen.headers || headers, detailTitle = chosen.title || title;
      const body = detailRows.slice(0, 500).map((r) => `<tr>${r.map((v) => `<td>${esc(v ?? '—')}</td>`).join('')}</tr>`).join('');
      const dialog = document.createElement('dialog'); dialog.id = 'metric-detail-dialog'; dialog.className = 'ins-detail-dialog';
      dialog.innerHTML = `<div class="card-head"><h3>${esc(el.dataset.metricDetail)} · ${esc(detailTitle)}</h3><button class="btn small" data-close>Close</button></div><p class="dim small">${U.fmt(detailRows.length)} matching rows${detailRows.length > 500 ? ' · first 500 shown' : ''}</p><div class="table-wrap"><table class="data-table ins-table"><thead><tr>${detailHeaders.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${detailHeaders.length}">No detail rows available</td></tr>`}</tbody></table></div>`;
      root.append(dialog); dialog.querySelector('[data-close]').onclick = () => dialog.close(); dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); dialog.showModal();
    }; el.addEventListener('click', open); el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }); });
  }
  function bindExports(root, base, filename, sheetName, header, rows, extraSheets) {
    const csv = U.$(`#${base}-csv`, root), xlsx = U.$(`#${base}-xlsx`, root);
    if (csv) csv.addEventListener('click', () => U.downloadCsv(`${filename}.csv`, header, rows));
    if (xlsx) xlsx.addEventListener('click', () => FF.xlsx.download(`${filename}.xlsx`, [{ name: sheetName, header, rows }, ...((extraSheets || []).filter(Boolean))]));
  }

  function colGet(row, letter) {
    const i = letter ? U.colIndex(letter) : -1;
    return i >= 0 ? D.cellText(row[i]) : '';
  }

  // ---- detailed rows used only by cross-channel and quality pages -------------------------------
  async function querySelectedRows(sheet, columns, whereColumn, fresh) {
    const rows = [], pageSize = 25000, hardCap = 250000, pageBatch = 3;
    const fetchPage = (offset) => D.query(sheet, `select ${columns.join(', ')} where ${whereColumn} is not null limit ${pageSize} offset ${offset}`, { fresh: !!fresh });
    let offset = 0;
    while (offset < hardCap) {
      // Fetch the first page alone, then overlap the next small page batch. Large detail scans
      // finish in fewer network round trips without pulling whole inventory tabs into the UI.
      const first = await fetchPage(offset);
      rows.push(...first.rows);
      if (first.rows.length < pageSize) return { rows, truncated: false };
      offset += pageSize;
      if (offset >= hardCap) break;
      const offsets = Array.from({ length: Math.min(pageBatch, Math.ceil((hardCap - offset) / pageSize)) }, (_, i) => offset + i * pageSize);
      const pages = await Promise.all(offsets.map(fetchPage));
      for (let i = 0; i < pages.length; i++) {
        rows.push(...pages[i].rows);
        offset = offsets[i] + pageSize;
        if (pages[i].rows.length < pageSize) return { rows, truncated: false };
      }
    }
    return { rows, truncated: rows.length >= hardCap };
  }
  async function loadDetails(fresh) {
    if (mem.details && !fresh) return mem.details;
    if (mem.detailsPromise && !fresh) return mem.detailsPromise;
    const s = FF.config.stock || {}, a = (FF.config.gv && FF.config.gv.assignment) || {}, gm = (FF.config.gv && FF.config.gv.master) || {};
    const stockCols = [s.barcode, s.tagId, s.agentId, s.agentName, s.tlName, s.cls, s.agentAllocatedAt, s.bcAllocatedAt].filter(Boolean);
    const assignCols = [...new Set([a.serial, a.tagId, a.agentId, a.agentName, a.tlId, a.tlName, a.cls, a.gvUniqueId, a.gvUniqueName, a.allocatedAt].filter(Boolean))];
    mem.detailsPromise = Promise.all([
      querySelectedRows(s.sheet || 'StockDataa', stockCols, s.tagId || s.barcode, fresh),
      querySelectedRows('Tag Assignment', assignCols, a.tagId || a.serial, fresh),
      D.query('GV Master', '', { fresh: !!fresh })
    ]).then(([stockResult, assignmentResult, masterTable]) => {
      const stock = stockResult.rows.map((r) => {
        const o = {}; stockCols.forEach((col, i) => { o[col] = D.cellText(r[i]); });
        return { barcode: clean(o[s.barcode]), tagId: clean(o[s.tagId]), agentId: clean(o[s.agentId]), agentName: clean(o[s.agentName]), tlName: clean(o[s.tlName]), cls: G.normClass ? G.normClass(o[s.cls]) : clean(o[s.cls]), agentAllocatedAt: clean(o[s.agentAllocatedAt]), bcAllocatedAt: clean(o[s.bcAllocatedAt]) };
      }).filter((r) => r.barcode || r.tagId);
      const assignment = assignmentResult.rows.map((r) => {
        const o = {}; assignCols.forEach((col, i) => { o[col] = D.cellText(r[i]); });
        return { serial: clean(o[a.serial]), tagId: clean(o[a.tagId]), agentId: clean(o[a.agentId]), agentName: clean(o[a.agentName]), tlId: clean(o[a.tlId]), tlName: clean(o[a.tlName]), cls: G.normClass ? G.normClass(o[a.cls]) : clean(o[a.cls]), gvUniqueId: clean(o[a.gvUniqueId]), gvUniqueName: clean(o[a.gvUniqueName]), allocatedAt: a.allocatedAt ? clean(o[a.allocatedAt]) : '' };
      }).filter((r) => r.serial || r.tagId);
      const rawMaster = masterTable.rows.map((r) => ({
        agentId: colGet(r, gm.uniqueId), agentName: colGet(r, gm.agentName), tlId: colGet(r, gm.tlId), tlName: colGet(r, gm.tlName),
        tagId: colGet(r, gm.tagId), serial: colGet(r, gm.serial), rawDate: colGet(r, gm.date), date: D.cellDate(r[gm.date ? U.colIndex(gm.date) : -1]),
        gvUniqueId: colGet(r, gm.gvUniqueId), gvUniqueName: colGet(r, gm.gvUniqueName)
      })).filter((r) => Object.values(r).some(Boolean));
      mem.details = { stock, assignment, rawMaster, truncated: { stock: stockResult.truncated, assignment: assignmentResult.truncated }, loadedAt: Date.now() };
      mem.detailsPromise = null;
      return mem.details;
    }).catch((err) => { mem.detailsPromise = null; throw err; });
    return mem.detailsPromise;
  }

  // ---- REPORT dynamic heading discovery ----------------------------------------------------------
  async function ffCommissionData() {
    await FF.pages.performance.ensureLoaded();
    const table = await S.need('report');
    const rows = table.rows || [];
    const sectionRaw = (rows[0] || []).map((c) => D.cellText(c));
    const subRaw = (rows[1] || []).map((c) => D.cellText(c));
    const width = Math.max(sectionRaw.length, subRaw.length, (table.cols || []).length);
    const section = []; let carry = '';
    for (let i = 0; i < width; i++) { if (clean(sectionRaw[i])) carry = clean(sectionRaw[i]); section[i] = carry; }
    const headers = Array.from({ length: width }, (_, i) => ({
      index: i, letter: U.colLetter(i), section: section[i] || '', sub: clean(subRaw[i]), col: clean(table.cols && table.cols[i] && table.cols[i].label),
      get label() { return [this.section, this.sub, this.col].filter(Boolean).join(' · '); }
    }));
    const keyword = /(commission|\bcomm(?:\.|\b)|payout|earning|incentive)/i;
    const candidates = headers.filter((h) => keyword.test(h.label));
    const mapping = FF.config.ffCommission || {};
    const mapped = (letter, label) => {
      const col = clean(letter).toUpperCase(); if (!/^[A-Z]{1,3}$/.test(col)) return null;
      const index = U.colIndex(col), found = headers[index];
      return found ? { ...found, label: `${found.label || label} · configured ${col}`, configured: true } : { index, letter: col, section: 'Configured mapping', sub: label, col: '', label: `${label} · configured ${col}`, configured: true };
    };
    const rateCol = mapped(mapping.rateCol, 'Commission rate') || candidates.find((h) => /(rate|percentage|percent|%|per\s*tag)/i.test(h.label)) || null;
    const amountCol = mapped(mapping.earnedCol, 'Earned commission') || candidates.find((h) => !/(rate|percentage|percent|%|per\s*tag)/i.test(h.label) && /(earned|earning|amount|payable|payout|total|commission|\bcomm(?:\.|\b))/i.test(h.label)) || null;
    const categoryCol = mapped(mapping.categoryCol, 'Agent category') || headers.find((h) => /(agent\s*(category|type)|business\s*category|channel|segment)/i.test(h.label) && !/(tag|vehicle|vrn)/i.test(h.label)) || null;
    const dateCol = mapped(mapping.dateCol, 'Commission date') || headers.find((h) => /^(date|period|month|report date|commission date)$/i.test(h.label.trim())) || null;
    const agents = FF.pages.performance.agents().map((a) => {
      const rateRaw = rateCol ? clean(a.raw[rateCol.index]) : '';
      const amountRaw = amountCol ? clean(a.raw[amountCol.index]) : '';
      const dateRaw = dateCol ? clean(a.raw[dateCol.index]) : ''; const date = dateRaw ? U.parseDate(dateRaw) : null;
      return { ...a, segment: segmentOf(a), rateRaw, rateValue: U.num(rateRaw), amountRaw, earned: U.num(amountRaw), sourceCategory: categoryCol ? clean(a.raw[categoryCol.index]) : '', dateRaw, date };
    });
    return { table, headers, candidates, rateCol, amountCol, categoryCol, dateCol, agents };
  }

  // ---- GV commission intelligence ---------------------------------------------------------------
  function aggregateGv(rows, group) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const keyFn = {
      agent: (r) => `${r.agentId}|${r.agentName}`,
      tl: (r) => `${r.tlId}|${r.tlName || 'Direct'}`,
      class: (r) => r.cls || 'NA',
      agentClass: (r) => `${r.agentId || ''}|${r.agentName || 'Unknown agent'}|${r.cls || 'NA'}`,
      weekday: (r) => r.date ? days[r.date.getDay()] : 'Invalid date',
      day: (r) => r.date ? U.dateKey(r.date) : 'Invalid date'
    }[group] || ((r) => `${r.agentId}|${r.agentName}`);
    const map = new Map();
    rows.forEach((r) => {
      const key = keyFn(r);
      mapAdd(map, key, () => ({ key, label: key.includes('|') ? key.split('|')[1] || key.split('|')[0] : key, id: key.includes('|') ? key.split('|')[0] : '', agentLabel: r.agentName || r.agentId || 'Unknown agent', tlName: r.tlName || '', classLabel: r.cls || 'NA', issuances: 0, amount: 0, commission: 0, commissionRows: 0, commissionPopulatedRows: 0, agents: new Set(), classes: {}, direct: 0, managed: 0 }), (o) => {
        o.issuances++; o.amount += r.amount || 0; o.commission += r.commission || 0; o.commissionRows++; if (r.commissionHasValue === true) o.commissionPopulatedRows++; o.agents.add(r.agentId || r.agentName);
        o.classes[r.cls || 'NA'] = (o.classes[r.cls || 'NA'] || 0) + 1;
        if (directAgent(r)) o.direct++; else o.managed++;
      });
    });
    let out = [...map.values()].map((o) => ({ ...o, agentCount: o.agents.size, commissionComplete: o.commissionRows > 0 && o.commissionRows === o.commissionPopulatedRows, perTag: o.issuances ? o.commission / o.issuances : 0, avgAmount: o.issuances ? o.amount / o.issuances : 0, effectiveRate: ratePct(o.commission, o.amount) }));
    if (group === 'weekday') { const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Invalid date']; out.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label)); }
    else if (group === 'day') out.sort((a, b) => b.label.localeCompare(a.label));
    else out.sort((a, b) => b.commission - a.commission || b.issuances - a.issuances);
    return out;
  }

  async function renderGvCommission(root, params) {
    const master = await G.need('master');
    const months = G.months ? G.months() : [...new Set(master.map((r) => r.ym))].sort();
    const month = months.includes(params.month) ? params.month : (months.at(-1) || U.ymKey(new Date()));
    const period = ['today', '7', '15', '30', 'month', 'custom'].includes(String(params.period)) ? String(params.period) : 'month';
    const group = ['agent', 'tl', 'class', 'weekday', 'day', 'agentClass'].includes(params.group) ? params.group : 'agentClass';
    const segment = ['all', 'direct', 'managed'].includes(params.segment) ? params.segment : 'all';
    const q = clean(params.q).toLowerCase();
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const from = new Date(today); from.setHours(0, 0, 0, 0); if (['7','15','30'].includes(period)) from.setDate(from.getDate() - (Number(period) - 1));
    const customFrom = params.from ? U.parseDate(params.from) : null, customTo = params.to ? U.parseDate(params.to) : null; if (customTo) customTo.setHours(23,59,59,999);
    const base = master.filter((r) => period === 'month' ? r.ym === month : period === 'custom' ? (r.date && customFrom && customTo && r.date >= customFrom && r.date <= customTo) : (r.date && r.date >= from && r.date <= today));
    const filtered = base.filter((r) => (segment === 'direct' ? directAgent(r) : segment === 'managed' ? !directAgent(r) : true) && (!q || [r.agentId, r.agentName, r.tlId, r.tlName, r.cls, r.tagId].join(' ').toLowerCase().includes(q)));
    const grouped = aggregateGv(filtered, group);
    const agentClassGroups = aggregateGv(filtered, 'agentClass');
    const med = (values) => { const sorted = values.slice().sort((a,b)=>a-b); if (!sorted.length) return 0; const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
    const classBenchmarks = new Map();
    agentClassGroups.filter((r) => r.issuances >= 3 && r.perTag > 0).forEach((r) => { if (!classBenchmarks.has(r.classLabel)) classBenchmarks.set(r.classLabel, []); classBenchmarks.get(r.classLabel).push(r.perTag); });
    const classMedians = new Map([...classBenchmarks].filter(([, values]) => values.length >= 3).map(([cls, values]) => [cls, med(values)]));
    const commissionAnomalies = agentClassGroups.map((r) => { const benchmark = classMedians.get(r.classLabel) || 0; const deviationPct = benchmark ? ((r.perTag - benchmark) / benchmark) * 100 : 0; return { ...r, benchmark, deviationPct, varianceAmount: (r.perTag - benchmark) * r.issuances }; }).filter((r) => r.issuances >= 3 && r.benchmark > 0 && Math.abs(r.deviationPct) >= 30).sort((a,b)=>Math.abs(b.deviationPct)-Math.abs(a.deviationPct));
    const gvAgentAgg = aggregateGv(filtered, 'agent');
    const gvSlabResults = slabVarianceRows(gvAgentAgg, 'gv', (r) => r.issuances, (r) => r.commissionComplete ? r.commission : null, (r) => r.agentLabel || r.label, (r) => r.id, (r) => r.tlName);
    const gvSlabMismatches = gvSlabResults.filter((r) => r.variance !== null && Math.abs(r.variance) > 0.01);
    const gvSlabMissingActual = gvSlabResults.filter((r) => r.count > 0 && r.actual === null).length;
    const totalAmount = sum(filtered, (r) => r.amount), totalCommission = sum(filtered, (r) => r.commission);
    const activeDays = new Set(filtered.filter((r) => r.date).map((r) => U.dateKey(r.date))).size;
    const direct = filtered.filter(directAgent), managed = filtered.filter((r) => !directAgent(r));
    const actions = `${exportButtons('gvc-export')} ${printButton}`;
    root.innerHTML = head('₹', 'GV Commission Intelligence', 'GV Master se exact amount, issuance aur commission · agent, TL/direct, class, date aur weekday analysis', actions) + `
      <div class="source-row">${sourceChip('GV Master', `${U.fmt(master.length)} parsed rows`)}<span class="dim small">No assumed rates — displayed earnings are the sheet's commission values.</span></div>
      <div class="ins-filters">
        <label>Period<select class="select" data-param="period">${[['today','Today'],['7','Last 7 days'],['15','Last 15 days'],['30','Last 30 days'],['month','Month'],['custom','Custom range']].map(([v,l]) => `<option value="${v}" ${v === period ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${period === 'custom' ? `<form id="gvc-date-range" class="ins-search"><input class="input" type="date" name="from" value="${esc(params.from||'')}"><input class="input" type="date" name="to" value="${esc(params.to||'')}"><button class="btn">Apply range</button></form>` : ''}
        ${period === 'month' ? `<label>Month<select class="select" data-param="month">${months.slice().reverse().map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(U.labelYM(m))}</option>`).join('')}</select></label>` : ''}
        <label>Breakdown<select class="select" data-param="group">${[['agent','Agent'],['tl','TL / Direct'],['class','Vehicle class'],['agentClass','Agent × class'],['weekday','Weekday'],['day','Date']].map(([v,l]) => `<option value="${v}" ${v === group ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Network<select class="select" data-param="segment"><option value="all">All</option><option value="direct" ${segment === 'direct' ? 'selected' : ''}>Direct Agents</option><option value="managed" ${segment === 'managed' ? 'selected' : ''}>TL-managed</option></select></label>
        <form id="gvc-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="Agent, TL, ID, class…"><button class="btn">Search</button></form>
      </div>
      <div class="ins-metrics">
        ${metric('Tag issuances', U.fmt(filtered.length), `${U.fmt(new Set(filtered.map((r) => r.agentId)).size)} agents · ${activeDays ? (filtered.length / activeDays).toFixed(1) : '0'} / active day`)}
        ${metric('Transaction amount', money(totalAmount), `${money(filtered.length ? totalAmount / filtered.length : 0, 2)} / tag`)}
        ${metric('Earned commission', money(totalCommission, 2), `${money(filtered.length ? totalCommission / filtered.length : 0, 2)} / tag`, 'good')}
        ${metric('Effective commission rate', `${ratePct(totalCommission, totalAmount).toFixed(2)}%`, 'Commission ÷ amount · descriptive, not an assumed tariff')}
        ${metric('Class commission variance flags', U.fmt(commissionAnomalies.length), '±30% vs class median · min 3 tags per agent', commissionAnomalies.length ? 'bad' : 'good')}
        ${metric('Slab payout differences', FF.config.commissionSlabs && FF.config.commissionSlabs.enabled ? U.fmt(gvSlabMismatches.length) : 'Off', FF.config.commissionSlabs && FF.config.commissionSlabs.enabled ? `Actual GV payout vs slab · ${U.fmt(gvSlabMissingActual)} agents missing complete payout` : 'Set FF/GV slab rates in Settings', gvSlabMismatches.length ? 'bad' : '')}
      </div>
      <div class="split-cards">
        <div class="card"><div class="card-head"><h3>Direct Agents</h3>${statusPill(`${U.fmt(direct.length)} tags`, 'blue')}</div><div class="ins-big">${money(sum(direct, (r) => r.commission), 2)}</div><p class="dim">${U.fmt(new Set(direct.map((r) => r.agentId)).size)} agents · ${money(sum(direct, (r) => r.amount))} amount</p></div>
        <div class="card"><div class="card-head"><h3>TL-managed Agents</h3>${statusPill(`${U.fmt(managed.length)} tags`, 'green')}</div><div class="ins-big">${money(sum(managed, (r) => r.commission), 2)}</div><p class="dim">${U.fmt(new Set(managed.map((r) => r.agentId)).size)} agents · ${money(sum(managed, (r) => r.amount))} amount</p></div>
      </div>
      <div class="card slab-review"><div class="card-head"><h3>GV slab payout reconciliation · agent-wise</h3><button class="btn small" id="gvc-slab-csv">⬇ Slab detail CSV</button></div><p class="dim small">Selected-period agent issuance chooses the configured GV band. Expected payout = configured rate logic; compares only with commission actually present in GV Master.</p>${FF.config.commissionSlabs && FF.config.commissionSlabs.enabled ? `<div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Agent</th><th>TL</th><th>Tags</th><th>Slab / rate</th><th>Expected</th><th>Actual sheet commission</th><th>Actual − expected</th><th>Status</th></tr></thead><tbody>${gvSlabResults.filter((r)=>r.status!=='Matches slab').sort((a,b)=>Math.abs(b.variance||0)-Math.abs(a.variance||0)).map((r)=>`<tr><td><b>${esc(r.name)}</b><small>${esc(r.id)}</small></td><td>${esc(r.tl)}</td><td>${U.fmt(r.count)}</td><td>${esc(r.tier)}${r.rate!==undefined?` · ${money(r.rate,2)}/tag`:''}</td><td>${r.expected===null?'Rate not configured':money(r.expected,2)}</td><td>${r.actual===null?'Unavailable':money(r.actual,2)}</td><td>${r.variance===null?'—':`${r.variance>0?'+':''}${money(r.variance,2)}`}</td><td>${statusPill(r.status,r.status==='Less actual than slab'?'red':r.status==='More actual than slab'?'amber':'')}</td></tr>`).join('') || `<tr><td colspan="8">${empty('No slab differences', 'All comparable GV agent payouts match the configured expected amount.')}</td></tr>`}</tbody></table></div>` : `<div class="mapping-state"><b>Slab comparison is off.</b><span>Settings → Data source → Commission slabs me GV rates enter karein, phir comparison enable karein.</span></div>`}</div>
      <div class="card variance-card"><div class="card-head"><h3>Commission review · agent vs same-class benchmark</h3><button class="btn small" id="gvc-variance-csv">⬇ Variance CSV</button><span class="dim small">${classMedians.size ? 'Observed data only · not an official tariff' : 'Need at least 3 agents with 3+ tags in a class for peer baseline'}</span></div><p class="dim small">Flags agents whose observed commission per tag differs by at least 30% from the same-class median. This is a review signal—not proof of underpayment or an assumed commission rate.</p><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Agent</th><th>TL</th><th>Class</th><th>Tags</th><th>Observed / tag</th><th>Class median / tag</th><th>Difference</th><th>Peer variance amount</th></tr></thead><tbody>${commissionAnomalies.map((r)=>`<tr><td><b>${esc(r.agentLabel)}</b><small>${esc(r.id || '')}</small></td><td>${esc(r.tlName || 'Direct / Unmapped')}</td><td><b>${esc(r.classLabel)}</b></td><td>${U.fmt(r.issuances)}</td><td>${money(r.perTag,2)}</td><td>${money(r.benchmark,2)}</td><td>${statusPill(`${r.deviationPct>0?'+':''}${r.deviationPct.toFixed(1)}%`,r.deviationPct<0?'red':'amber')}</td><td>${money(r.varianceAmount,2)}</td></tr>`).join('') || `<tr><td colspan="8">${empty('No class-based variance flags', 'More class-agent samples may be needed. No reference tariff has been assumed.')}</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>${esc(group === 'weekday' ? 'Monday–Sunday commission pattern' : group === 'day' ? 'Day-wise commission' : `${group[0].toUpperCase() + group.slice(1)}-wise commission`)}</h3><span class="dim small">${U.fmt(grouped.length)} rows</span></div>
        <div class="table-wrap"><table class="data-table ins-table" id="gvc-table"><thead><tr>${group === 'agentClass' ? '<th>Agent</th><th>Vehicle class</th>' : `<th>${group === 'agent' ? 'Agent' : group === 'tl' ? 'TL / Direct' : group === 'class' ? 'Class' : group === 'weekday' ? 'Weekday' : 'Date'}</th>`}<th>Issuance</th><th>Amount</th><th>Commission</th><th>Commission / tag</th><th>Effective rate</th>${group === 'agentClass' ? '' : '<th>Class mix</th>'}</tr></thead><tbody>
        ${grouped.map((r) => `<tr>${group === 'agentClass' ? `<td><b>${esc(r.agentLabel)}</b><small>${esc(r.id || '')}</small></td><td><b>${esc(r.classLabel)}</b></td>` : `<td><b>${esc(group === 'day' ? dateText(`${r.label}T00:00:00`) : r.label)}</b>${r.id ? `<small>${esc(r.id)}</small>` : ''}</td>`}<td>${U.fmt(r.issuances)}</td><td>${money(r.amount, 2)}</td><td><b>${money(r.commission, 2)}</b></td><td>${money(r.perTag, 2)}</td><td>${r.effectiveRate.toFixed(2)}%</td>${group === 'agentClass' ? '' : `<td class="small">${esc(classMix(r.classes))}</td>`}</tr>`).join('') || `<tr><td colspan="${group === 'agentClass' ? 6 : 7}">${empty('No matching rows', 'Filters change karke dekhein.')}</td></tr>`}
        </tbody></table></div></div>`;
    U.$('#gvc-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    const rangeForm = U.$('#gvc-date-range', root); if (rangeForm) rangeForm.addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(rangeForm); FF.app.updateParams({ period:'custom', from:f.get('from')||'', to:f.get('to')||'' }); });
    bindExports(root, 'gvc-export', `gv-commission-${month}-${U.stamp()}`, 'GV Commission', ['Group','Agent','Agent ID','Vehicle class','Issuance','Amount','Commission','Commission per tag','Effective rate %','Class mix'], grouped.map((r) => [group,r.agentLabel,r.id,r.classLabel,r.issuances,r.amount,r.commission,r.perTag,r.effectiveRate,classMix(r.classes)]), [{ name: 'Class Variance Review', header: ['Agent','Agent ID','TL','Class','Tags','Observed commission/tag','Class median/tag','Deviation %','Peer variance amount'], rows: commissionAnomalies.map((r) => [r.agentLabel,r.id,r.tlName,r.classLabel,r.issuances,r.perTag,r.benchmark,r.deviationPct,r.varianceAmount]) }]);
    const varianceCsv = U.$('#gvc-variance-csv', root); if (varianceCsv) varianceCsv.addEventListener('click', () => U.downloadCsv(`gv-class-commission-review-${U.stamp()}.csv`, ['Agent','Agent ID','TL','Class','Tags','Observed commission/tag','Class median/tag','Deviation %','Peer variance amount'], commissionAnomalies.map((r) => [r.agentLabel,r.id,r.tlName,r.classLabel,r.issuances,r.perTag,r.benchmark,r.deviationPct,r.varianceAmount])));
    const gvSlabHeaders = ['Agent','Agent ID','TL','Tags','Slab','Model','Expected payout','Actual payout','Actual minus expected','Status'];
    const gvSlabExportRows = gvSlabResults.map((r) => [r.name,r.id,r.tl,r.count,r.tier,r.model,r.expected,r.actual,r.variance,r.status]);
    const gvSlabCsv = U.$('#gvc-slab-csv', root); if (gvSlabCsv) gvSlabCsv.addEventListener('click', () => U.downloadCsv(`gv-slab-reconciliation-${U.stamp()}.csv`, gvSlabHeaders, gvSlabExportRows));
    bindMetricDetails(root, period === 'month' ? U.labelYM(month) : `Last ${period === 'today' ? '1' : period} day(s)`, ['Date','Agent','Agent ID','TL','Class','Barcode','Amount','Commission'], filtered.map((r) => [r.date ? U.dateKey(r.date) : '',r.agentName,r.agentId,r.tlName,r.cls,r.tagId,r.amount,r.commission]), {
      'Class commission variance flags': { title: 'Same-class commission peer review', headers: ['Agent','Agent ID','TL','Class','Tags','Observed commission/tag','Class median/tag','Deviation %','Peer variance amount'], rows: commissionAnomalies.map((r) => [r.agentLabel,r.id,r.tlName,r.classLabel,r.issuances,r.perTag,r.benchmark,r.deviationPct,r.varianceAmount]) },
      'Slab payout differences': { title: 'GV actual-vs-slab by agent', headers: gvSlabHeaders, rows: gvSlabExportRows }
    });
  }

  // ---- FF reported commission ------------------------------------------------------------------
  async function renderFfCommission(root, params) {
    const data = await ffCommissionData();
    const segment = ['all', 'direct', 'managed', 'other'].includes(params.segment) ? params.segment : 'all';
    const period = ['today','7','15','30','month','all','custom'].includes(String(params.period)) ? String(params.period) : 'month';
    const q = clean(params.q).toLowerCase();
    const now = new Date(); now.setHours(23,59,59,999); const from = new Date(now); from.setHours(0,0,0,0); if (['7','15','30'].includes(period)) from.setDate(from.getDate()-(Number(period)-1));
    const customFrom = params.from ? U.parseDate(params.from) : null, customTo = params.to ? U.parseDate(params.to) : null; if (customTo) customTo.setHours(23,59,59,999);
    const rows = data.agents.filter((r) => (segment === 'direct' ? r.segment === 'Direct Agent' : segment === 'managed' ? r.segment === 'TL-managed' : segment === 'other' ? r.segment === 'Other / unmapped' : true) && (!data.dateCol || period === 'all' || (period === 'custom' ? r.date && customFrom && customTo && r.date >= customFrom && r.date <= customTo : (period === 'month' ? r.date && U.ymKey(r.date) === U.ymKey(now) : r.date && r.date >= from && r.date <= now))) && (!q || [r.name, r.agentId, r.tlName, r.tlId, r.sourceCategory].join(' ').toLowerCase().includes(q)));
    const ffSlabResults = slabVarianceRows(rows, 'ff', (r) => r.curTotal, (r) => r.earned, (r) => r.name, (r) => r.agentId, (r) => r.tlName);
    const ffSlabMismatches = ffSlabResults.filter((r) => r.variance !== null && Math.abs(r.variance) > 0.01);
    const available = !!(data.rateCol || data.amountCol);
    const earnedRows = rows.filter((r) => r.earned !== null && r.earned !== undefined);
    const earned = sum(earnedRows, (r) => r.earned);
    const segments = ['Direct Agent', 'TL-managed', 'Other / unmapped'].map((label) => { const list = data.agents.filter((r) => r.segment === label); return { label, count: list.length, issuance: sum(list, (r) => r.curTotal), earned: sum(list.filter((r) => validValue(r.earned)), (r) => r.earned), withEarned: list.filter((r) => validValue(r.earned)).length }; });
    const realCategories = data.categoryCol ? [...new Set(data.agents.map((r) => r.sourceCategory || 'Blank').filter(Boolean))].map((label) => { const list = data.agents.filter((r) => (r.sourceCategory || 'Blank') === label); return { label, count: list.length, issuance: sum(list, (r) => r.curTotal), earned: sum(list.filter((r) => validValue(r.earned)), (r) => r.earned) }; }).sort((a,b) => b.earned - a.earned || b.issuance - a.issuance) : [];
    root.innerHTML = head('₹', 'First Forward Commission Intelligence', 'REPORT sheet ke reported rate aur earned commission · Direct Agents aur TL-managed agents alag', `${exportButtons('ffc-export')} ${printButton}`) + `
      <div class="source-row">${sourceChip('FF REPORT', `${U.fmt(data.agents.length)} agent rows`)}${data.rateCol ? sourceChip(`Rate · ${data.rateCol.letter}`, data.rateCol.label) : ''}${data.amountCol ? sourceChip(`Earned · ${data.amountCol.letter}`, data.amountCol.label) : ''}</div>
      ${!available ? `<div class="mapping-state warn"><div class="mapping-icon">⚠️</div><div><h3>Commission source is not available in this REPORT snapshot</h3><p>Columns A:${U.colLetter(data.headers.length - 1)} were inspected dynamically, but no commission/rate/payout heading was found. The dashboard will not multiply issuance by a guessed rate. When the production heading is present it is picked up automatically.</p><small>Accepted heading patterns include “Commission Rate”, “Earned Commission”, “Commission Amount”, “Payout” and “Incentive”.</small></div></div>` : ''}
      <div class="ins-filters">
        ${data.dateCol ? `<label>Period<select class="select" data-param="period">${[['today','Today'],['7','Last 7 days'],['15','Last 15 days'],['30','Last 30 days'],['month','This month'],['custom','Custom range'],['all','All dates']].map(([v,l])=>`<option value="${v}" ${v===period?'selected':''}>${l}</option>`).join('')}</select></label>${period==='custom'?`<form id="ffc-date-range" class="ins-search"><input class="input" type="date" name="from" value="${esc(params.from||'')}"><input class="input" type="date" name="to" value="${esc(params.to||'')}"><button class="btn">Apply range</button></form>`:''}` : ''}
        <label>Network<select class="select" data-param="segment"><option value="all">All categories</option><option value="direct" ${segment === 'direct' ? 'selected' : ''}>Direct Agents</option><option value="managed" ${segment === 'managed' ? 'selected' : ''}>TL-managed</option><option value="other" ${segment === 'other' ? 'selected' : ''}>Other / unmapped</option></select></label>
        <form id="ffc-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="Agent, ID, TL, category…"><button class="btn">Search</button></form>
      </div>
      <div class="ins-metrics">
        ${metric('Agents', U.fmt(rows.length), `${U.fmt(sum(rows, (r) => r.curTotal))} REPORT issuance`)}
        ${metric('Reported earned commission', data.amountCol ? money(earned, 2) : 'Unavailable', data.amountCol ? `${earnedRows.length}/${rows.length} rows populated` : 'No earned-amount column detected', data.amountCol ? 'good' : '')}
        ${metric('Rate source', data.rateCol ? esc(data.rateCol.letter) : 'Unavailable', data.rateCol ? esc(data.rateCol.sub || data.rateCol.section) : 'No rate column detected')}
        ${metric('Additional sheet category', data.categoryCol ? esc(data.categoryCol.sub || data.categoryCol.letter) : 'None found', data.categoryCol ? `Column ${esc(data.categoryCol.letter)}` : 'Direct/TL split uses verified TL fields')}
        ${metric('Slab payout differences', !(FF.config.commissionSlabs && FF.config.commissionSlabs.enabled) ? 'Off' : !data.amountCol ? 'No actual column' : U.fmt(ffSlabMismatches.length), FF.config.commissionSlabs && FF.config.commissionSlabs.enabled ? (data.amountCol ? 'Actual FF REPORT payout vs configured slab' : 'Map earned-commission column in Settings') : 'Set FF/GV slab rates in Settings', ffSlabMismatches.length ? 'bad' : '')}
      </div>
      <div class="segment-summary">${segments.map((s) => `<div><b>${esc(s.label)}</b><span>${U.fmt(s.count)} agents · ${U.fmt(s.issuance)} issued</span><strong>${data.amountCol ? money(s.earned, 2) : 'Source unavailable'}</strong></div>`).join('')}</div>
      ${realCategories.length ? `<div class="card compact-card"><div class="card-head"><h3>Additional categories found in REPORT</h3><span class="dim small">${esc(data.categoryCol.label)}</span></div><div class="category-strip">${realCategories.map((c) => `<div><b>${esc(c.label)}</b><span>${U.fmt(c.count)} agents · ${U.fmt(c.issuance)} issued</span><strong>${data.amountCol ? money(c.earned,2) : '—'}</strong></div>`).join('')}</div></div>` : ''}
      <div class="card slab-review"><div class="card-head"><h3>FF slab payout reconciliation · agent-wise</h3><button class="btn small" id="ffc-slab-csv">⬇ Slab detail CSV</button></div><p class="dim small">Selected-period REPORT issuance chooses the configured FF band. Expected payout compares with the earned-commission column only; no missing source values are inferred.</p>${FF.config.commissionSlabs && FF.config.commissionSlabs.enabled ? `<div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Agent</th><th>TL</th><th>Tags</th><th>Slab / rate</th><th>Expected</th><th>Actual REPORT payout</th><th>Actual − expected</th><th>Status</th></tr></thead><tbody>${ffSlabResults.filter((r)=>r.status!=='Matches slab').sort((a,b)=>Math.abs(b.variance||0)-Math.abs(a.variance||0)).map((r)=>`<tr><td><b>${esc(r.name)}</b><small>${esc(r.id)}</small></td><td>${esc(r.tl)}</td><td>${U.fmt(r.count)}</td><td>${esc(r.tier)}${r.rate!==undefined?` · ${money(r.rate,2)}/tag`:''}</td><td>${r.expected===null?'Rate not configured':money(r.expected,2)}</td><td>${r.actual===null?'Unavailable':money(r.actual,2)}</td><td>${r.variance===null?'—':`${r.variance>0?'+':''}${money(r.variance,2)}`}</td><td>${statusPill(r.status,r.status==='Less actual than slab'?'red':r.status==='More actual than slab'?'amber':'')}</td></tr>`).join('') || `<tr><td colspan="8">${empty('No slab differences', 'No FF agents have comparable actual payouts and configured slab rates for this period.')}</td></tr>`}</tbody></table></div>` : `<div class="mapping-state"><b>Slab comparison is off.</b><span>Settings → Data source → Commission slabs me FF rates enter karein, phir comparison enable karein.</span></div>`}</div>
      <div class="card"><div class="card-head"><h3>Agent-wise reported commission</h3><span class="dim small">Sheet values only · no derived payout</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Agent</th><th>Network</th>${data.categoryCol ? '<th>Sheet category</th>' : ''}<th>TL</th><th>Current issuance</th><th>Commission rate</th><th>Earned commission</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><b>${esc(r.name || r.agentId)}</b><small>${esc(r.agentId || '')}</small></td><td>${statusPill(r.segment, r.segment === 'Direct Agent' ? 'blue' : r.segment === 'TL-managed' ? 'green' : '')}</td>${data.categoryCol ? `<td>${esc(r.sourceCategory || '—')}</td>` : ''}<td>${esc(r.segment === 'Direct Agent' ? 'Direct' : r.tlName || '—')}</td><td>${U.fmt(r.curTotal || 0)}</td><td>${data.rateCol ? esc(r.rateRaw || '—') : '<span class="dim">Unavailable</span>'}</td><td>${data.amountCol && validValue(r.earned) ? `<b>${money(r.earned, 2)}</b>` : '<span class="dim">Unavailable</span>'}</td></tr>`).join('') || `<tr><td colspan="7">${empty('No agents match', '')}</td></tr>`}
      </tbody></table></div></div>`;
    U.$('#ffc-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    const rangeForm = U.$('#ffc-date-range', root); if (rangeForm) rangeForm.addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(rangeForm); FF.app.updateParams({ period:'custom', from:f.get('from') || '', to:f.get('to') || '' }); });
    bindExports(root, 'ffc-export', `ff-commission-${U.stamp()}`, 'FF Commission', ['Agent ID','Agent','Network','Sheet category','TL','Current issuance','Commission rate (reported)','Earned commission (reported)'], rows.map((r) => [r.agentId,r.name,r.segment,r.sourceCategory,r.tlName,r.curTotal,r.rateRaw,r.earned]), [{ name: 'Slab Reconciliation', header: ['Agent','Agent ID','TL','Tags','Slab','Model','Expected payout','Actual payout','Actual minus expected','Status'], rows: ffSlabResults.map((r) => [r.name,r.id,r.tl,r.count,r.tier,r.model,r.expected,r.actual,r.variance,r.status]) }]);
    const ffSlabHeaders = ['Agent','Agent ID','TL','Tags','Slab','Model','Expected payout','Actual payout','Actual minus expected','Status'];
    const ffSlabRows = ffSlabResults.map((r) => [r.name,r.id,r.tl,r.count,r.tier,r.model,r.expected,r.actual,r.variance,r.status]);
    const ffSlabCsv = U.$('#ffc-slab-csv', root); if (ffSlabCsv) ffSlabCsv.addEventListener('click', () => U.downloadCsv(`ff-slab-reconciliation-${U.stamp()}.csv`, ffSlabHeaders, ffSlabRows));
    bindMetricDetails(root, 'FF REPORT', ['Agent ID','Agent','Network','Category','TL','Issuance','Rate','Earned'], rows.map((r) => [r.agentId,r.name,r.segment,r.sourceCategory,r.tlName,r.curTotal,r.rateRaw,r.earned]), {
      'Slab payout differences': { title: 'FF actual-vs-slab by agent', headers: ffSlabHeaders, rows: ffSlabRows }
    });
  }

  // ---- verified dual-channel identity ------------------------------------------------------------
  async function buildCross() {
    if (mem.cross) return mem.cross;
    const [details, master, gvStock, ffStock] = await Promise.all([loadDetails(false), G.need('master'), G.need('stockAgent'), S.need('stockAgents')]);
    await FF.pages.performance.ensureLoaded();
    const ffReport = FF.pages.performance.agents();
    const ffPeople = new Map(), gvPeople = new Map();
    const ffKey = (id, name) => normId(id) || `N:${normName(name)}`;
    const gvKey = (id, name) => normId(id) || `N:${normName(name)}`;
    ffReport.forEach((a) => ffPeople.set(ffKey(a.agentId || a.id, a.name), { id: a.agentId || a.id, name: a.name, tlName: a.tlName, report: a }));
    details.stock.forEach((r) => { const k = ffKey(r.agentId, r.agentName); if (!ffPeople.has(k)) ffPeople.set(k, { id: r.agentId, name: r.agentName || r.agentId, tlName: r.tlName, report: null }); });
    master.forEach((r) => { const k = gvKey(r.agentId, r.agentName); if (!gvPeople.has(k)) gvPeople.set(k, { id: r.agentId, name: r.agentName || r.agentId, tlName: r.tlName }); });
    details.assignment.forEach((r) => { const k = gvKey(r.agentId, r.agentName); if (!gvPeople.has(k)) gvPeople.set(k, { id: r.agentId, name: r.agentName || r.agentId, tlName: r.tlName }); });

    const assignmentByBarcode = new Map();
    const ffBarcodeOccurrences = new Map(), gvBarcodeOccurrences = new Map();
    const countBarcode = (map, key, owner) => { if (!key) return; const x = map.get(key) || { count: 0, owners: new Set() }; x.count++; if (owner) x.owners.add(owner); map.set(key, x); };
    details.assignment.forEach((r) => { const k = normBarcode(r.serial); if (!k) return; if (!assignmentByBarcode.has(k)) assignmentByBarcode.set(k, []); assignmentByBarcode.get(k).push(r); countBarcode(gvBarcodeOccurrences, k, gvKey(r.agentId, r.agentName)); });
    details.stock.forEach((r) => countBarcode(ffBarcodeOccurrences, normBarcode(r.barcode), ffKey(r.agentId, r.agentName)));
    const pairs = new Map();
    function addPair(fk, gk, method, detail) {
      if (!fk || !gk || !ffPeople.has(fk) || !gvPeople.has(gk)) return;
      const pk = `${fk}→${gk}`;
      if (!pairs.has(pk)) pairs.set(pk, { ffKey: fk, gvKey: gk, methods: new Set(), barcodeCount: 0, barcodes: new Set(), barcodeDetails: new Map(), idValue: '', evidence: [] });
      const p = pairs.get(pk); p.methods.add(method); if (method === 'barcode' && detail) { const barcodeKey = normBarcode(typeof detail === 'string' ? detail : detail.ffBarcode); p.barcodes.add(String(typeof detail === 'string' ? detail : detail.ffBarcode)); if (detail && typeof detail === 'object' && barcodeKey) p.barcodeDetails.set(barcodeKey, { ...(p.barcodeDetails.get(barcodeKey) || {}), ...detail, normalizedBarcode: barcodeKey }); p.barcodeCount = p.barcodeDetails.size || p.barcodes.size; } if (method === 'gv-id') p.idValue = detail || p.idValue; if (p.evidence.length < 5 && detail) p.evidence.push(typeof detail === 'string' ? detail : detail.ffBarcode);
    }
    details.stock.forEach((r) => {
      const barcode = normBarcode(r.barcode); if (!barcode) return;
      const matches = assignmentByBarcode.get(barcode) || [];
      const fk = ffKey(r.agentId, r.agentName);
      matches.forEach((g) => {
        const gk = gvKey(g.agentId, g.agentName), ffCount = ffBarcodeOccurrences.get(barcode), gvCount = gvBarcodeOccurrences.get(barcode);
        addPair(fk, gk, 'barcode', {
          ffBarcode: r.barcode, gvSerial: g.serial, ffAgentId: r.agentId, ffAgentName: r.agentName, ffTlName: r.tlName, ffClass: r.cls, ffBarcodeAllocatedAt: r.bcAllocatedAt || '', ffAgentAllocatedAt: r.agentAllocatedAt || '',
          gvAgentId: g.agentId, gvAgentName: g.agentName, gvTlName: g.tlName, gvClass: g.cls, gvAllocatedAt: g.allocatedAt || '',
          ffOccurrences: ffCount ? ffCount.count : 1, gvOccurrences: gvCount ? gvCount.count : 1,
          ffOwnerCount: ffCount ? ffCount.owners.size : 1, gvOwnerCount: gvCount ? gvCount.owners.size : 1
        });
      });
    });

    const gvUnique = new Map();
    function indexGvId(id, gk) { const k = normId(id); if (!k || /^(NOTFOUND|NA|NONE)$/.test(k)) return; if (!gvUnique.has(k)) gvUnique.set(k, new Set()); gvUnique.get(k).add(gk); }
    master.forEach((r) => indexGvId(r.gvUniqueId, gvKey(r.agentId, r.agentName)));
    details.assignment.forEach((r) => indexGvId(r.gvUniqueId, gvKey(r.agentId, r.agentName)));
    let ambiguousIds = 0;
    ffReport.forEach((a) => {
      const id = normId(a.gvIdFound); if (!id || /^(NOTFOUND|NA|NONE)$/.test(id)) return;
      const candidates = [...(gvUnique.get(id) || [])];
      const fk = ffKey(a.agentId || a.id, a.name);
      if (candidates.length === 1) addPair(fk, candidates[0], 'gv-id', a.gvIdFound);
      else if (candidates.length > 1) {
        const existing = [...pairs.values()].filter((p) => p.ffKey === fk && candidates.includes(p.gvKey));
        if (existing.length === 1) addPair(fk, existing[0].gvKey, 'gv-id', a.gvIdFound); else ambiguousIds++;
      }
    });

    const month = latestMonth(master);
    const gvMonth = master.filter((r) => r.ym === month);
    const gvAgg = new Map();
    gvMonth.forEach((r) => mapAdd(gvAgg, gvKey(r.agentId, r.agentName), () => ({ issuance: 0, amount: 0, commission: 0, classes: {} }), (o) => { o.issuance++; o.amount += r.amount || 0; o.commission += r.commission || 0; o.classes[r.cls || 'NA'] = (o.classes[r.cls || 'NA'] || 0) + 1; }));
    const gvStockAgg = new Map();
    details.assignment.forEach((r) => mapAdd(gvStockAgg, gvKey(r.agentId, r.agentName), () => ({ n: 0, classes: {} }), (o) => { o.n++; o.classes[r.cls || 'NA'] = (o.classes[r.cls || 'NA'] || 0) + 1; }));
    (gvStock || []).forEach((r) => { const k = gvKey(r.agentId, r.agentName); if (!gvStockAgg.has(k)) gvStockAgg.set(k, { n: r.n || 0, classes: {} }); });
    const ffStockAgg = new Map();
    details.stock.forEach((r) => mapAdd(ffStockAgg, ffKey(r.agentId, r.agentName), () => ({ n: 0, classes: {} }), (o) => { o.n++; o.classes[r.cls || 'NA'] = (o.classes[r.cls || 'NA'] || 0) + 1; }));
    (ffStock || []).forEach((r) => { const k = ffKey(r.agentId, r.agentName); if (!ffStockAgg.has(k)) ffStockAgg.set(k, { n: r.n || 0, classes: {} }); });

    // Resolve one FF identity to one GV identity. Conflicting barcode ownership is withheld unless
    // exactly one candidate is corroborated by the unique-ID signal.
    const byFf = new Map();
    [...pairs.values()].forEach((p) => { if (!byFf.has(p.ffKey)) byFf.set(p.ffKey, []); byFf.get(p.ffKey).push(p); });
    const resolvedPairs = []; let ambiguousPairs = 0;
    byFf.forEach((list) => {
      if (list.length === 1) { resolvedPairs.push(list[0]); return; }
      const corroborated = list.filter((p) => p.methods.has('barcode') && p.methods.has('gv-id'));
      if (corroborated.length === 1) resolvedPairs.push(corroborated[0]); else ambiguousPairs++;
    });
    const resolvedSet = new Set(resolvedPairs);
    const barcodeAudit = [...pairs.values()].flatMap((p) => [...p.barcodeDetails.values()].map((b) => ({ ...b, ffKey: p.ffKey, gvKey: p.gvKey, methods: [...p.methods], verified: resolvedSet.has(p), ff: ffPeople.get(p.ffKey), gv: gvPeople.get(p.gvKey) })));
    const rows = resolvedPairs.map((p) => {
      const ff = ffPeople.get(p.ffKey), gv = gvPeople.get(p.gvKey), ga = gvAgg.get(p.gvKey) || { issuance: 0, amount: 0, commission: 0, classes: {} };
      const gs = gvStockAgg.get(p.gvKey) || { n: 0, classes: {} }, fs = ffStockAgg.get(p.ffKey) || { n: 0, classes: {} };
      const methods = [...p.methods];
      const confidence = methods.length > 1 ? 'Very high · 2 signals' : methods[0] === 'gv-id' ? 'High · unique ID' : p.barcodeCount > 1 ? `High · ${p.barcodeCount} barcodes` : 'Verified · barcode';
      return { ...p, ff, gv, methods, confidence, ffIssuance: ff.report ? ff.report.curTotal || 0 : 0, gvIssuance: ga.issuance, ffStock: fs.n, gvStock: gs.n, ffClasses: fs.classes, gvClasses: gs.classes, amount: ga.amount, commission: ga.commission, segment: segmentOf(ff.report || ff) };
    }).sort((a, b) => (b.ffIssuance + b.gvIssuance) - (a.ffIssuance + a.gvIssuance));
    mem.cross = { rows, barcodeAudit, month, scanned: { ffStock: details.stock.length, gvAssignment: details.assignment.length, ffAgents: ffPeople.size, gvAgents: gvPeople.size }, truncated: details.truncated, ambiguousIds, ambiguousPairs };
    return mem.cross;
  }

  async function renderDualChannel(root, params) {
    const data = await buildCross();
    const q = clean(params.q).toLowerCase(), method = ['all','barcode','gv-id','both'].includes(params.method) ? params.method : 'all';
    const rows = data.rows.filter((r) => (!q || [r.ff.name,r.ff.id,r.gv.name,r.gv.id,r.ff.tlName,r.gv.tlName].join(' ').toLowerCase().includes(q)) && (method === 'all' || method === 'both' ? (method === 'all' || r.methods.length > 1) : r.methods.includes(method)));
    const barcodeRows = (data.barcodeAudit || []).filter((b) => (!q || [b.ff && b.ff.name,b.ff && b.ff.id,b.ff && b.ff.tlName,b.gv && b.gv.name,b.gv && b.gv.id,b.gv && b.gv.tlName].join(' ').toLowerCase().includes(q)) && (method === 'all' || method === 'barcode' || (method === 'both' ? b.methods.length > 1 : b.methods.includes(method)))).map((b) => ({ ...b, ffAgent: b.ff && (b.ff.name || b.ff.id) || b.ffAgentName, ffId: b.ff && b.ff.id || b.ffAgentId, ffTl: b.ff && b.ff.tlName || b.ffTlName || '', gvAgent: b.gv && (b.gv.name || b.gv.id) || b.gvAgentName, gvId: b.gv && b.gv.id || b.gvAgentId, gvTl: b.gv && b.gv.tlName || b.gvTlName || '' }));
    const duplicateBarcodeRows = barcodeRows.filter((b) => b.ffOccurrences > 1 || b.ffOwnerCount > 1 || b.gvOccurrences > 1 || b.gvOwnerCount > 1);
    const todayKey = U.dateKey(new Date());
    const allocatedToday = (value) => { const date = value ? U.parseDate(value) : null; return !!(date && U.dateKey(date) === todayKey); };
    const dailyDuplicateRows = duplicateBarcodeRows.filter((b) => allocatedToday(b.ffBarcodeAllocatedAt) || allocatedToday(b.ffAgentAllocatedAt) || allocatedToday(b.gvAllocatedAt));
    const gvAllocationDateMapped = !!(FF.config.gv && FF.config.gv.assignment && FF.config.gv.assignment.allocatedAt);
    const ffIssue = sum(rows, (r) => r.ffIssuance), gvIssue = sum(rows, (r) => r.gvIssuance), ffStock = sum(rows, (r) => r.ffStock), gvStock = sum(rows, (r) => r.gvStock);
    const tlSummary = new Map(); rows.forEach((r) => {
      const key = `${r.ff.tlName || 'Direct / Unmapped'} ↔ ${r.gv.tlName || 'Direct / Unmapped'}`;
      if (!tlSummary.has(key)) tlSummary.set(key, { label: key, agentRows: [], agents: 0, ff: 0, gv: 0, ffStock: 0, gvStock: 0, commission: 0, amount: 0, barcodes: 0 });
      const x = tlSummary.get(key); x.agents++; x.agentRows.push(r); x.ff += r.ffIssuance; x.gv += r.gvIssuance; x.ffStock += r.ffStock; x.gvStock += r.gvStock; x.commission += r.commission; x.amount += r.amount; x.barcodes += r.barcodeCount;
    });
    const netIssuance = gvIssue - ffIssue, netStock = gvStock - ffStock;
    root.innerHTML = head('🔗', 'Dual-channel Agent Intelligence', 'Only verified joins: normalized barcode match and/or FF “GV ID Found” ↔ GV unique ID · name-only guesses are never used', `${exportButtons('cross-export')}<button class="btn" id="cross-barcode-csv">⬇ Barcode detail CSV</button> ${printButton}`) + `
      <div class="source-row">${sourceChip('StockDataa', `${U.fmt(data.scanned.ffStock)} barcode rows`)}${sourceChip('Tag Assignment', `${U.fmt(data.scanned.gvAssignment)} serial rows`)}${sourceChip('FF REPORT', `${U.fmt(data.scanned.ffAgents)} identities`)}${sourceChip('GV Master', `${U.fmt(data.scanned.gvAgents)} identities`)}</div>
      ${data.truncated && (data.truncated.stock || data.truncated.assignment) ? `<div class="mapping-state warn"><b>Detailed identity scan reached the 250,000-row safety cap.</b><span>Results are explicitly partial; archive old assignment rows or narrow the source tab.</span></div>` : ''}
      <div class="ins-filters"><label>Evidence<select class="select" data-param="method"><option value="all">All verified matches</option><option value="both" ${method === 'both' ? 'selected' : ''}>Both signals</option><option value="barcode" ${method === 'barcode' ? 'selected' : ''}>Barcode</option><option value="gv-id" ${method === 'gv-id' ? 'selected' : ''}>GV unique ID</option></select></label><form id="cross-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="FF/GV agent, ID or TL…"><button class="btn">Search</button></form></div>
      <div class="ins-metrics">
        ${metric('Verified overlapping agents', U.fmt(rows.length), `${rows.filter((r) => r.methods.length > 1).length} verified by both signals`, 'good')}
        ${metric('Matched FF issuance', U.fmt(ffIssue), `${U.fmt(ffStock)} matched-agent stock · current REPORT`)}
        ${metric('Matched GV issuance', U.fmt(gvIssue), `${U.fmt(gvStock)} matched-agent stock · ${esc(U.labelYM(data.month))}`)}
        ${metric('Combined footprint', U.fmt(ffIssue + gvIssue), `${U.fmt(ffStock + gvStock)} matched-agent stock`)}
        ${metric('Net issuance gap · GV − FF', `${netIssuance > 0 ? '+' : ''}${U.fmt(netIssuance)}`, `Stock gap GV − FF: ${netStock > 0 ? '+' : ''}${U.fmt(netStock)}`)}
        ${metric('Barcode review flags', U.fmt(duplicateBarcodeRows.length), 'Repeated barcode or assigned to multiple owners', duplicateBarcodeRows.length ? 'bad' : 'good')}
        ${metric('Today’s duplicate review', U.fmt(dailyDuplicateRows.length), gvAllocationDateMapped ? 'FF/GV allocation dates · assigned today' : 'Set GV allocation-date column for full daily coverage', dailyDuplicateRows.length ? 'bad' : 'good')}
      </div>
      ${data.ambiguousIds || data.ambiguousPairs ? `<div class="mapping-state"><b>${U.fmt(data.ambiguousIds + data.ambiguousPairs)} ambiguous identities were not auto-joined.</b><span>${U.fmt(data.ambiguousIds)} non-unique GV IDs · ${U.fmt(data.ambiguousPairs)} conflicting barcode owners. Corroboration is required to prevent false overlap.</span></div>` : ''}
      ${!data.rows.length ? `<div class="mapping-state warn"><div class="mapping-icon">🔎</div><div><h3>No verified overlap in the loaded snapshot</h3><p>The join completed, but no normalized StockDataa barcode matched Tag Assignment serial and no unique “GV ID Found” matched exactly one GV identity. No name-based records were added.</p></div></div>` : ''}
      <div class="split-cards"><div class="card"><div class="card-head"><h3>Channel-wise summary</h3></div><div class="summary-grid"><div><small>FF issuance</small><b>${U.fmt(ffIssue)}</b></div><div><small>GV issuance</small><b>${U.fmt(gvIssue)}</b></div><div><small>FF stock</small><b>${U.fmt(ffStock)}</b></div><div><small>GV stock</small><b>${U.fmt(gvStock)}</b></div></div></div><div class="card"><div class="card-head"><h3>Combined commercial summary</h3></div><div class="summary-grid"><div><small>Total issuance</small><b>${U.fmt(ffIssue + gvIssue)}</b></div><div><small>Total stock</small><b>${U.fmt(ffStock + gvStock)}</b></div><div><small>GV amount</small><b>${money(sum(rows, (r) => r.amount))}</b></div><div><small>GV commission</small><b>${money(sum(rows, (r) => r.commission), 2)}</b></div></div></div></div>
      <div class="card"><div class="card-head"><h3>TL-wise matched-channel comparison</h3><span class="dim small">GV − FF gaps · matched identities only</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>FF TL ↔ GV TL</th><th>Agents</th><th>Shared barcodes</th><th>FF issuance</th><th>GV issuance</th><th>Issuance gap</th><th>FF stock</th><th>GV stock</th><th>Stock gap</th><th>GV commission</th><th>Agent drill-down</th></tr></thead><tbody>${[...tlSummary.values()].sort((a,b)=>b.ff+b.gv-a.ff-a.gv).map((t)=>`<tr><td><b>${esc(t.label)}</b></td><td>${U.fmt(t.agents)}</td><td>${U.fmt(t.barcodes)}</td><td>${U.fmt(t.ff)}</td><td>${U.fmt(t.gv)}</td><td><b>${t.gv-t.ff>0?'+':''}${U.fmt(t.gv-t.ff)}</b></td><td>${U.fmt(t.ffStock)}</td><td>${U.fmt(t.gvStock)}</td><td><b>${t.gvStock-t.ffStock>0?'+':''}${U.fmt(t.gvStock-t.ffStock)}</b></td><td>${money(t.commission,2)}</td><td><details class="tl-drill"><summary>Show ${U.fmt(t.agents)} agents</summary><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>FF Agent / ID</th><th>GV Agent / ID</th><th>Evidence</th><th>Barcodes</th><th>FF tags / stock</th><th>GV tags / stock</th><th>GV commission</th></tr></thead><tbody>${t.agentRows.slice(0,20).map((r)=>`<tr><td><b>${esc(r.ff.name||r.ff.id)}</b><small>${esc(r.ff.id||'')} · ${esc(r.ff.tlName||'Direct / Unmapped')}</small></td><td><b>${esc(r.gv.name||r.gv.id)}</b><small>${esc(r.gv.id||'')} · ${esc(r.gv.tlName||'Direct / Unmapped')}</small></td><td>${esc(r.methods.join(' + '))}</td><td>${U.fmt(r.barcodeCount)}</td><td>${U.fmt(r.ffIssuance)} / ${U.fmt(r.ffStock)}</td><td>${U.fmt(r.gvIssuance)} / ${U.fmt(r.gvStock)}</td><td>${money(r.commission,2)}</td></tr>`).join('')}</tbody></table></div>${t.agents>20?`<small class="dim">Showing first 20 of ${U.fmt(t.agents)} agent pairs; use the full Dual Channel CSV for all rows.</small>`:''}</details></td></tr>`).join('') || `<tr><td colspan="11">No TL overlap data</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>Barcode overlap audit · exact FF ↔ GV matches</h3><span class="dim small">${U.fmt(barcodeRows.length)} shared barcode records · CSV contains all rows</span></div><p class="dim small">“Repeated in FF/GV” means the normalized barcode occurs more than once in that source; owner count highlights assignment across multiple agents. Today’s review uses allocation dates. ${gvAllocationDateMapped ? 'GV allocation-date mapping is active.' : 'GV assignment date is not mapped; configure it in Settings → Data source → Tag Assignment allocation-date column for complete daily coverage.'} Preview is capped for smooth loading.</p><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Barcode (FF) ↔ Serial (GV)</th><th>FF agent · TL · class</th><th>GV agent · TL · class</th><th>FF repeats / owners</th><th>GV repeats / owners</th><th>Audit</th><th>Agent pair</th></tr></thead><tbody>${barcodeRows.slice(0,300).map((b)=>{const ffDup=b.ffOccurrences>1||b.ffOwnerCount>1, gvDup=b.gvOccurrences>1||b.gvOwnerCount>1; return `<tr><td><b>${esc(b.ffBarcode)}</b><small>GV serial: ${esc(b.gvSerial || '—')}</small></td><td>${esc(b.ffAgent)}<small>${esc(b.ffId)} · ${esc(b.ffTl || 'Direct / Unmapped')} · ${esc(b.ffClass || '—')} · barcode alloc: ${esc(b.ffBarcodeAllocatedAt ? dateText(b.ffBarcodeAllocatedAt) : '—')} · agent alloc: ${esc(b.ffAgentAllocatedAt ? dateText(b.ffAgentAllocatedAt) : '—')}</small></td><td>${esc(b.gvAgent)}<small>${esc(b.gvId)} · ${esc(b.gvTl || 'Direct / Unmapped')} · ${esc(b.gvClass || '—')} · alloc: ${esc(b.gvAllocatedAt ? dateText(b.gvAllocatedAt) : 'date not mapped')}</small></td><td>${U.fmt(b.ffOccurrences)} / ${U.fmt(b.ffOwnerCount)}</td><td>${U.fmt(b.gvOccurrences)} / ${U.fmt(b.gvOwnerCount)}</td><td>${ffDup||gvDup?statusPill(`Repeated${ffDup?' · FF':''}${gvDup?' · GV':''}`,'amber'):statusPill('One row per source','green')}</td><td>${b.verified?statusPill('Resolved pair','green'):statusPill('Ambiguous owner · review','red')}</td></tr>`;}).join('') || `<tr><td colspan="7">No exact barcode join found for this filter.</td></tr>`}</tbody></table></div>${barcodeRows.length>300?`<p class="dim small">Showing first 300 of ${U.fmt(barcodeRows.length)} matched barcodes; use Barcode detail CSV for the full list.</p>`:''}</div>
      <div class="card"><div class="card-head"><h3>Verified agents active in both channels</h3><span class="dim small">${U.fmt(rows.length)} shown</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>First Forward identity</th><th>GV identity</th><th>Evidence</th><th>Shared barcodes</th><th>FF issuance</th><th>GV issuance</th><th>FF stock</th><th>GV stock</th><th>Total footprint</th><th>Class mix · FF</th><th>Class mix · GV</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><b>${esc(r.ff.name || r.ff.id)}</b><small>${esc(r.ff.id || '')} · TL: ${esc(r.ff.tlName || 'Direct / Unmapped')} · ${esc(r.segment)}</small></td><td><b>${esc(r.gv.name || r.gv.id)}</b><small>${esc(r.gv.id || '')} · TL: ${esc(r.gv.tlName || 'Direct / Unmapped')}</small></td><td>${statusPill(r.confidence, r.methods.length > 1 ? 'green' : 'blue')}<small>${esc(r.methods.join(' + '))}</small></td><td><b>${U.fmt(r.barcodeCount)}</b>${r.barcodes.size ? `<small title="${esc([...r.barcodes].join(', '))}">${esc([...r.barcodes].slice(0,3).join(', '))}${r.barcodes.size>3?'…':''}</small>` : '<small>—</small>'}</td><td>${U.fmt(r.ffIssuance)}</td><td>${U.fmt(r.gvIssuance)}</td><td>${U.fmt(r.ffStock)}</td><td>${U.fmt(r.gvStock)}</td><td><b>${U.fmt(r.ffIssuance + r.gvIssuance)}</b><small>${U.fmt(r.ffStock + r.gvStock)} stock</small></td><td class="small">${esc(classMix(r.ffClasses))}</td><td class="small">${esc(classMix(r.gvClasses))}</td></tr>`).join('') || `<tr><td colspan="11">${empty('No matching verified agents', 'Evidence/search filter change karke dekhein.')}</td></tr>`}
      </tbody></table></div></div>`;
    U.$('#cross-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    const barcodeHeaders = ['Barcode · FF','Serial · GV','FF Agent ID','FF Agent','FF TL','FF Class','FF barcode allocation date','FF agent allocation date','GV Agent ID','GV Agent','GV TL','GV Class','GV allocation date','FF source occurrences','FF distinct owners','GV source occurrences','GV distinct owners','Repeated in FF','Repeated in GV','Agent pair resolution'];
    const barcodeExportRows = barcodeRows.map((b) => [b.ffBarcode,b.gvSerial,b.ffId,b.ffAgent,b.ffTl,b.ffClass,b.ffBarcodeAllocatedAt,b.ffAgentAllocatedAt,b.gvId,b.gvAgent,b.gvTl,b.gvClass,b.gvAllocatedAt,b.ffOccurrences,b.ffOwnerCount,b.gvOccurrences,b.gvOwnerCount,b.ffOccurrences>1||b.ffOwnerCount>1?'YES':'NO',b.gvOccurrences>1||b.gvOwnerCount>1?'YES':'NO',b.verified?'Resolved':'Ambiguous - review']);
    bindExports(root, 'cross-export', `dual-channel-${U.stamp()}`, 'Dual Channel', ['FF Agent ID','FF Agent','FF TL','GV Agent ID','GV Agent','GV TL','Evidence','Confidence','Shared barcode count','Shared barcodes','FF Issuance','GV Issuance','Combined Issuance','FF Stock','GV Stock','Combined Stock','FF Class Mix','GV Class Mix','GV Amount','GV Commission'], rows.map((r) => [r.ff.id,r.ff.name,r.ff.tlName,r.gv.id,r.gv.name,r.gv.tlName,r.methods.join('+'),r.confidence,r.barcodeCount,[...r.barcodes].join(' | '),r.ffIssuance,r.gvIssuance,r.ffIssuance+r.gvIssuance,r.ffStock,r.gvStock,r.ffStock+r.gvStock,classMix(r.ffClasses),classMix(r.gvClasses),r.amount,r.commission]), [{ name: 'Barcode Details', header: barcodeHeaders, rows: barcodeExportRows }]);
    const barcodeCsv = U.$('#cross-barcode-csv', root); if (barcodeCsv) barcodeCsv.addEventListener('click', () => U.downloadCsv(`dual-channel-barcodes-${U.stamp()}.csv`, barcodeHeaders, barcodeExportRows));
    const fullCrossHeaders = ['FF Agent','FF ID','FF TL','GV Agent','GV ID','GV TL','Join evidence','Shared barcodes','FF issuance','GV issuance','Combined issuance','FF stock','GV stock','Combined stock','FF classes','GV classes','GV amount','GV commission'];
    const barcodeReviewHeaders = ['FF barcode','GV serial','FF agent','FF ID','FF TL','FF class','FF barcode allocation date','FF agent allocation date','GV agent','GV ID','GV TL','GV class','GV allocation date','FF repeats','FF owners','GV repeats','GV owners','Resolved pair'];
    const barcodeReviewDetailRows = duplicateBarcodeRows.map((b) => [b.ffBarcode,b.gvSerial,b.ffAgent,b.ffId,b.ffTl,b.ffClass,b.ffBarcodeAllocatedAt,b.ffAgentAllocatedAt,b.gvAgent,b.gvId,b.gvTl,b.gvClass,b.gvAllocatedAt,b.ffOccurrences,b.ffOwnerCount,b.gvOccurrences,b.gvOwnerCount,b.verified?'Resolved':'Ambiguous - review']);
    const fullCrossRows = rows.map((r) => [r.ff.name,r.ff.id,r.ff.tlName || 'Direct / Unmapped',r.gv.name,r.gv.id,r.gv.tlName || 'Direct / Unmapped',r.methods.join(' + '),[...r.barcodes].join(' | '),r.ffIssuance,r.gvIssuance,r.ffIssuance+r.gvIssuance,r.ffStock,r.gvStock,r.ffStock+r.gvStock,classMix(r.ffClasses),classMix(r.gvClasses),r.amount,r.commission]);
    const ffOnlyHeaders = ['FF Agent','FF ID','FF TL','Issuance','Stock','Classes'];
    const gvOnlyHeaders = ['GV Agent','GV ID','GV TL','Issuance','Stock','Classes','Transaction amount','Commission'];
    bindMetricDetails(root, 'Dual-channel agent summary', fullCrossHeaders, fullCrossRows, {
      'Verified overlapping agents': { title: 'Verified FF ↔ GV pairs', headers: fullCrossHeaders, rows: fullCrossRows },
      'Matched FF issuance': { title: 'First Forward side of matched agents', headers: ffOnlyHeaders, rows: rows.map((r) => [r.ff.name,r.ff.id,r.ff.tlName || 'Direct / Unmapped',r.ffIssuance,r.ffStock,classMix(r.ffClasses)]) },
      'Matched GV issuance': { title: 'GV Partner side of matched agents', headers: gvOnlyHeaders, rows: rows.map((r) => [r.gv.name,r.gv.id,r.gv.tlName || 'Direct / Unmapped',r.gvIssuance,r.gvStock,classMix(r.gvClasses),r.amount,r.commission]) },
      'Combined footprint': { title: 'Combined channel footprint by matched agent', headers: fullCrossHeaders, rows: fullCrossRows },
      'Net issuance gap · GV − FF': { title: 'GV minus FF per matched agent', headers: fullCrossHeaders, rows: fullCrossRows },
      'Barcode review flags': { title: 'Repeated or multi-owner matched barcodes', headers: barcodeReviewHeaders, rows: barcodeReviewDetailRows },
      'Today’s duplicate review': { title: `Duplicate barcode assignments dated ${todayKey}`, headers: barcodeReviewHeaders, rows: dailyDuplicateRows.map((b) => [b.ffBarcode,b.gvSerial,b.ffAgent,b.ffId,b.ffTl,b.ffClass,b.ffBarcodeAllocatedAt,b.ffAgentAllocatedAt,b.gvAgent,b.gvId,b.gvTl,b.gvClass,b.gvAllocatedAt,b.ffOccurrences,b.ffOwnerCount,b.gvOccurrences,b.gvOwnerCount,b.verified?'Resolved':'Ambiguous - review']) }
    });
  }

  // ---- stock forecasting + historical accuracy backtest -----------------------------------------
  const forecastTabs = (view) => `<div class="forecast-tabs seg" role="tablist"><a class="seg-btn ${view !== 'accuracy' && view !== 'balance' ? 'on' : ''}" href="#/forecast" role="tab" aria-selected="${view !== 'accuracy' && view !== 'balance'}">🔭 Live projection</a><a class="seg-btn ${view === 'accuracy' ? 'on' : ''}" href="#/forecast?view=accuracy" role="tab" aria-selected="${view === 'accuracy'}">🎯 Forecast accuracy</a><a class="seg-btn ${view === 'balance' ? 'on' : ''}" href="#/forecast?view=balance" role="tab" aria-selected="${view === 'balance'}">⚖️ Stock balance</a></div>`;
  async function loadForecastHistory() {
    if (mem.forecastHistory) return mem.forecastHistory;
    if (mem.forecastHistoryPromise) return mem.forecastHistoryPromise;
    mem.forecastHistoryPromise = (async () => {
      const [dailyResult, masterResult] = await Promise.allSettled([S.need('daily'), G.need('master')]);
      const sourceErrors = [];
      const daily = dailyResult.status === 'fulfilled' ? dailyResult.value : [];
      const master = masterResult.status === 'fulfilled' ? masterResult.value : [];
      if (dailyResult.status === 'rejected') sourceErrors.push({ source: 'FF EIR', message: dailyResult.reason && dailyResult.reason.message || 'Daily source failed' });
      if (masterResult.status === 'rejected') sourceErrors.push({ source: 'GV Master', message: masterResult.reason && masterResult.reason.message || 'GV source failed' });
      if (dailyResult.status === 'rejected' && masterResult.status === 'rejected') throw new Error('FF EIR aur GV Master history load nahi ho saki.');
      const latestFf = M.latestDate(daily), latestGv = master.length ? (G.latestDate ? G.latestDate() : master.reduce((d, r) => r.date && (!d || r.date > d) ? r.date : d, null)) : null;
      const historyDays = 120;
      let ff = [];
      if (latestFf) {
        const from = U.dateKey(shiftDay(latestFf, -(historyDays - 1))), to = U.dateKey(latestFf);
        try {
          ff = (await M.loadRangePeople(from, to)).filter((r) => r.channel === 'First Forward').map((r) => ({
            channel: 'First Forward', id: r.id, name: r.name, tlName: r.tlName, dateKey: r.dateKey,
            date: dayDate(r.dateKey), cls: r.cls || 'NA', group: r.group || '', n: Number(r.n) || 0
          }));
        } catch (err) { sourceErrors.push({ source: 'FF historical range', message: err.message || 'Range query failed' }); }
      }
      const gvFrom = latestGv ? shiftDay(latestGv, -(historyDays - 1)) : null;
      const gv = master.filter((r) => r.date && (!gvFrom || r.date >= gvFrom) && (!latestGv || r.date <= latestGv)).map((r) => ({
        channel: 'GV Partner', id: r.agentId, name: r.agentName, tlName: r.tlName, dateKey: U.dateKey(r.date),
        date: dayDate(r.date), cls: r.cls || 'NA', group: r.group || '', n: 1
      }));
      const earliest = (rows) => rows.reduce((d, r) => !d || r.date < d ? r.date : d, null);
      mem.forecastHistory = { ff, gv, latestFf, latestGv, earliestFf: earliest(ff), earliestGv: earliest(gv), historyDays, sourceErrors };
      mem.forecastHistoryPromise = null;
      return mem.forecastHistory;
    })().catch((err) => { mem.forecastHistoryPromise = null; throw err; });
    return mem.forecastHistoryPromise;
  }
  const forecastAccuracyScore = (predicted, actual) => actual > 0 ? Math.max(0, 100 - (Math.abs(predicted - actual) / actual) * 100) : (predicted > 0 ? 0 : null);
  function accuracyMetrics(rows) {
    const predicted = sum(rows, (r) => r.predicted), actual = sum(rows, (r) => r.actual), absoluteError = sum(rows, (r) => r.absoluteError);
    const wape = actual > 0 ? (absoluteError / actual) * 100 : (predicted > 0 ? 100 : 0);
    return { predicted, actual, absoluteError, wape, accuracy: Math.max(0, 100 - wape), bias: actual > 0 ? ((predicted - actual) / actual) * 100 : null, mae: rows.length ? absoluteError / rows.length : 0, agents: rows.length };
  }
  function evaluateForecastWindow(sourceRows, channel, latestDate, earliestDate, horizon, lookback, offset) {
    if (!latestDate || !earliestDate) return null;
    const end = shiftDay(latestDate, -(offset * horizon));
    const actualStart = shiftDay(end, -(horizon - 1));
    const trainingEnd = shiftDay(actualStart, -1), requestedTrainingStart = shiftDay(trainingEnd, -(lookback - 1));
    const observedStart = requestedTrainingStart < earliestDate ? dayDate(earliestDate) : requestedTrainingStart;
    const observedDays = observedStart <= trainingEnd ? calendarDays(observedStart, trainingEnd) : 0;
    if (observedDays < Math.min(7, lookback) || actualStart < earliestDate) return null;
    const people = new Map(), classes = new Map();
    const personKey = (r) => normId(r.id) || `N:${normName(r.name)}`;
    sourceRows.forEach((r) => {
      if (r.date < observedStart || r.date > end) return;
      const inTraining = r.date <= trainingEnd, inActual = r.date >= actualStart;
      if (!inTraining && !inActual) return;
      const key = personKey(r);
      mapAdd(people, key, () => ({ key, channel, id: r.id, name: r.name || r.id || 'Unknown', tlName: r.tlName || 'Direct', training: 0, actual: 0 }), (o) => {
        if (inTraining) o.training += r.n; else if (inActual) o.actual += r.n;
        if (!o.name && r.name) o.name = r.name;
        if ((!o.tlName || o.tlName === 'Direct') && r.tlName) o.tlName = r.tlName;
      });
      const cls = r.cls || 'NA';
      mapAdd(classes, cls, () => ({ cls, training: 0, actual: 0 }), (o) => { if (inTraining) o.training += r.n; else if (inActual) o.actual += r.n; });
    });
    const rows = [...people.values()].map((r) => {
      const dailyRate = r.training / observedDays, predicted = dailyRate * horizon, absoluteError = Math.abs(predicted - r.actual);
      const accuracy = forecastAccuracyScore(predicted, r.actual);
      const confidence = observedDays >= lookback && r.training >= 10 ? 'High' : observedDays >= lookback && r.training > 0 ? 'Medium' : 'Low';
      return { ...r, trainingDays: observedDays, dailyRate, predicted, absoluteError, biasUnits: predicted - r.actual, accuracy, confidence, direction: Math.abs(predicted - r.actual) < 0.5 ? 'On target' : predicted > r.actual ? 'Over forecast' : 'Under forecast' };
    }).filter((r) => r.predicted > 0 || r.actual > 0).sort((a, b) => b.absoluteError - a.absoluteError || b.actual - a.actual);
    if (!rows.length) return null;
    const classRows = [...classes.values()].map((r) => { const predicted = (r.training / observedDays) * horizon, absoluteError = Math.abs(predicted - r.actual); return { ...r, predicted, absoluteError, accuracy: forecastAccuracyScore(predicted, r.actual) }; }).filter((r) => r.predicted > 0 || r.actual > 0).sort((a, b) => b.actual - a.actual);
    return { channel, horizon, lookback, offset, rows, classes: classRows, observedDays, fullTraining: observedDays >= lookback, trainingStart: observedStart, trainingEnd, actualStart, end, ...accuracyMetrics(rows) };
  }
  function combineForecastWindows(windows, horizon, lookback, offset) {
    const valid = windows.filter(Boolean); if (!valid.length) return null;
    const rows = valid.flatMap((w) => w.rows), cls = new Map();
    valid.forEach((w) => w.classes.forEach((r) => mapAdd(cls, r.cls, () => ({ cls: r.cls, training: 0, actual: 0, predicted: 0, absoluteError: 0 }), (o) => { o.training += r.training; o.actual += r.actual; o.predicted += r.predicted; })));
    const classes = [...cls.values()].map((r) => ({ ...r, absoluteError: Math.abs(r.predicted - r.actual), accuracy: forecastAccuracyScore(r.predicted, r.actual) })).sort((a, b) => b.actual - a.actual);
    return { channel: 'Both channels', horizon, lookback, offset, rows, classes, sources: valid, observedDays: Math.min(...valid.map((w) => w.observedDays)), fullTraining: valid.every((w) => w.fullTraining), actualStart: new Date(Math.min(...valid.map((w) => w.actualStart.getTime()))), end: new Date(Math.max(...valid.map((w) => w.end.getTime()))), ...accuracyMetrics(rows) };
  }
  async function forecastAccuracy(lookback) {
    const history = await loadForecastHistory(), horizons = [7, 15, 30], result = { history, lookback, horizons: {} };
    horizons.forEach((horizon) => {
      const ffWindows = [], gvWindows = [], combinedWindows = [];
      for (let offset = 0; offset < 6; offset++) {
        const ff = evaluateForecastWindow(history.ff, 'First Forward', history.latestFf, history.earliestFf, horizon, lookback, offset);
        const gv = evaluateForecastWindow(history.gv, 'GV Partner', history.latestGv, history.earliestGv, horizon, lookback, offset);
        if (ff) ffWindows.push(ff); if (gv) gvWindows.push(gv);
        const combined = combineForecastWindows([ff, gv], horizon, lookback, offset); if (combined) combinedWindows.push(combined);
      }
      result.horizons[horizon] = { ffWindows, gvWindows, combinedWindows, ff: ffWindows[0] || null, gv: gvWindows[0] || null, combined: combinedWindows[0] || null };
    });
    return result;
  }
  const pointStock = (point, channel) => {
    if (!point) return null;
    if (channel === 'First Forward') {
      if (Object.hasOwn(point, 'ff')) return point.ff && typeof point.ff === 'object' ? point.ff : null;
      if (Object.hasOwn(point, 'total')) return { total: Number(point.total) || 0, vc4: Number(point.vc4) || 0, comm: Number(point.comm) || 0, classes: point.classes || {} };
    }
    if (channel === 'GV Partner' && point.gv && typeof point.gv === 'object') return point.gv;
    return null;
  };
  function evaluateStockBalanceChannel(sourceRows, stockPoints, movementData, channel, horizon, lookback) {
    const sourceLatest = sourceRows.reduce((d, r) => !d || r.date > d ? r.date : d, null);
    const sourceEarliest = sourceRows.reduce((d, r) => !d || r.date < d ? r.date : d, null);
    const snapshots = (stockPoints || []).map((p) => ({ ...p, dateObj: dayDate(p.date), stock: pointStock(p, channel) }))
      .filter((p) => p.stock && Number.isFinite(Number(p.stock.total)) && (!sourceLatest || p.dateObj <= sourceLatest)).sort((a, b) => a.dateObj - b.dateObj);
    const unavailable = (reason) => ({ ok: false, channel, reason, snapshots: snapshots.length });
    if (snapshots.length < 2) return unavailable(`Kam se kam 2 ${channel} daily stock snapshots chahiye (${snapshots.length} available).`);
    if (!sourceLatest || !sourceEarliest) return unavailable(`${channel} issuance history available nahi hai.`);
    const closing = snapshots[snapshots.length - 1], targetOpening = shiftDay(closing.dateObj, -horizon);
    const candidates = snapshots.filter((p) => p.dateObj <= targetOpening);
    if (!candidates.length) return unavailable(`${horizon}-day opening snapshot abhi available nahi hai.`);
    const opening = candidates[candidates.length - 1], intervalDays = Math.round((closing.dateObj - opening.dateObj) / dayMs);
    if (intervalDays < 1) return unavailable('Opening aur closing snapshot alag dates ke nahi hain.');
    const fitDays = Math.abs(Math.round((targetOpening - opening.dateObj) / dayMs));
    const trainingEnd = opening.dateObj, requestedTrainingStart = shiftDay(trainingEnd, -(lookback - 1));
    const observedStart = requestedTrainingStart < sourceEarliest ? dayDate(sourceEarliest) : requestedTrainingStart;
    const observedDays = observedStart <= trainingEnd ? calendarDays(observedStart, trainingEnd) : 0;
    if (observedDays < Math.min(7, lookback)) return unavailable(`${lookback}-day forecast baseline ke liye enough issuance history nahi hai.`);
    const inRange = (r, from, to, inclusiveFrom) => (inclusiveFrom ? r.date >= from : r.date > from) && r.date <= to;
    const training = sum(sourceRows.filter((r) => inRange(r, observedStart, trainingEnd, true)), (r) => r.n);
    const predictedConsumption = (training / observedDays) * intervalDays;
    const actualConsumption = sum(sourceRows.filter((r) => inRange(r, opening.dateObj, closing.dateObj, false)), (r) => r.n);
    const ledgerConfigured = !!(movementData && movementData.configured && !movementData.error);
    const movements = ledgerConfigured ? (movementData.rows || []).filter((r) => r.channel === channel && r.date > opening.dateObj && r.date <= closing.dateObj) : [];
    const movementIn = sum(movements.filter((r) => r.impact > 0), (r) => r.impact);
    const movementOut = sum(movements.filter((r) => r.impact < 0), (r) => Math.abs(r.impact));
    const internalTransfer = sum(movements.filter((r) => r.impact === 0), (r) => Math.abs(r.quantity));
    const netMovement = movementIn - movementOut;
    const openingStock = Number(opening.stock.total) || 0, actualClosing = Number(closing.stock.total) || 0;
    const projectedClosing = openingStock + netMovement - predictedConsumption;
    const expectedClosingFromActual = openingStock + netMovement - actualConsumption;
    const impliedNetMovement = actualClosing - openingStock + actualConsumption;
    const unexplainedVariance = impliedNetMovement - netMovement;
    const closingError = projectedClosing - actualClosing;
    const consumptionError = predictedConsumption - actualConsumption;
    return { ok: true, channel, horizon, lookback, intervalDays, fitDays, openingDate: opening.dateObj, closingDate: closing.dateObj,
      openingStock, actualClosing, projectedClosing, expectedClosingFromActual, closingError, closingAccuracy: forecastAccuracyScore(projectedClosing, actualClosing) ?? 0,
      predictedConsumption, actualConsumption, consumptionError, consumptionAccuracy: forecastAccuracyScore(predictedConsumption, actualConsumption) ?? 0,
      movementIn, movementOut, internalTransfer, netMovement, impliedNetMovement, unexplainedVariance, movements, ledgerConfigured,
      observedDays, fullTraining: observedDays >= lookback, trainingStart: observedStart, trainingEnd, snapshots: snapshots.length,
      openingCapturedAt: opening.capturedAt || null, closingCapturedAt: closing.capturedAt || null };
  }
  function combineStockBalances(results) {
    const valid = results.filter((r) => r && r.ok);
    if (!valid.length) return null;
    const total = (key) => sum(valid, (r) => r[key]);
    const projectedClosing = total('projectedClosing'), actualClosing = total('actualClosing');
    const predictedConsumption = total('predictedConsumption'), actualConsumption = total('actualConsumption');
    const mixedPeriods = valid.some((r) => r.openingDate.getTime() !== valid[0].openingDate.getTime() || r.closingDate.getTime() !== valid[0].closingDate.getTime());
    return { ok: true, channel: valid.map((r) => r.channel).join(' + '), sources: valid, mixedPeriods, horizon: valid[0].horizon, lookback: valid[0].lookback,
      intervalDays: Math.max(...valid.map((r) => r.intervalDays)), fitDays: Math.max(...valid.map((r) => r.fitDays)),
      openingDate: new Date(Math.min(...valid.map((r) => r.openingDate.getTime()))), closingDate: new Date(Math.max(...valid.map((r) => r.closingDate.getTime()))),
      openingStock: total('openingStock'), actualClosing, projectedClosing, expectedClosingFromActual: total('expectedClosingFromActual'),
      closingError: projectedClosing - actualClosing, closingAccuracy: forecastAccuracyScore(projectedClosing, actualClosing) ?? 0,
      predictedConsumption, actualConsumption, consumptionError: predictedConsumption - actualConsumption, consumptionAccuracy: forecastAccuracyScore(predictedConsumption, actualConsumption) ?? 0,
      movementIn: total('movementIn'), movementOut: total('movementOut'), internalTransfer: total('internalTransfer'), netMovement: total('netMovement'),
      impliedNetMovement: total('impliedNetMovement'), unexplainedVariance: total('unexplainedVariance'), movements: valid.flatMap((r) => r.movements),
      ledgerConfigured: valid.every((r) => r.ledgerConfigured), observedDays: Math.min(...valid.map((r) => r.observedDays)), fullTraining: valid.every((r) => r.fullTraining), snapshots: Math.min(...valid.map((r) => r.snapshots)) };
  }
  function stockBalanceReconciliation(history, stockPoints, movementData, horizon, lookback) {
    const ff = evaluateStockBalanceChannel(history.ff || [], stockPoints || [], movementData || {}, 'First Forward', horizon, lookback);
    const gv = evaluateStockBalanceChannel(history.gv || [], stockPoints || [], movementData || {}, 'GV Partner', horizon, lookback);
    return { ff, gv, combined: combineStockBalances([ff, gv]) };
  }
  async function renderStockBalance(root, params) {
    const horizon = [7, 15, 30].includes(Number(params.horizon)) ? Number(params.horizon) : 7;
    const lookback = [14, 28].includes(Number(params.lookback)) ? Number(params.lookback) : 28;
    const channel = ['all', 'ff', 'gv'].includes(params.channel) ? params.channel : 'all';
    const [history, stockHistory] = await Promise.all([loadForecastHistory(), FF.auth.api('/api/stock-history')]);
    const points = (stockHistory && stockHistory.points) || [];
    const rangeFrom = points.length ? points[0].date : U.dateKey(shiftDay(new Date(), -119));
    const rangeTo = points.length ? points[points.length - 1].date : U.dateKey(new Date());
    let movementData;
    try { movementData = await M.loadStockMovements(rangeFrom, rangeTo); }
    catch (err) { movementData = { configured: true, rows: [], invalid: [], error: err.message || 'Movement ledger load failed' }; }
    const result = stockBalanceReconciliation(history, points, movementData, horizon, lookback);
    const current = channel === 'ff' ? (result.ff.ok ? result.ff : null) : channel === 'gv' ? (result.gv.ok ? result.gv : null) : result.combined;
    const channelResults = channel === 'ff' ? [result.ff] : channel === 'gv' ? [result.gv] : [result.ff, result.gv];
    const validChannels = channelResults.filter((r) => r.ok);
    const recentMovements = (movementData.rows || []).filter((r) => channel === 'all' || channel === 'ff' ? (channel === 'all' || r.channel === 'First Forward') : r.channel === 'GV Partner').slice().sort((a,b)=>b.date-a.date).slice(0,50);
    const ledgerState = movementData.error ? 'error' : movementData.configured ? 'connected' : 'not-configured';
    const ledgerPanel = ledgerState === 'connected'
      ? `<div class="mapping-state success"><div class="mapping-icon">🔗</div><div><h3>Movement ledger connected · ${esc(movementData.source || FF.config.stockMovement.sheet)}</h3><p>${U.fmt(movementData.rows.length)} valid movements · ${U.fmt(movementData.invalid.length)} invalid rows. IN/OUT/ADJUSTMENT closing-stock equation me use hote hain; internal TRANSFER net zero hai.</p></div></div>`
      : ledgerState === 'error'
        ? `<div class="mapping-state warn"><div class="mapping-icon">⚠️</div><div><h3>Movement ledger load nahi hui</h3><p>${esc(movementData.error)} · Result recorded movement ko zero maan kar provisional hai.</p><a href="#/settings?tab=data">Mapping check karein →</a></div></div>`
        : `<div class="mapping-state warn"><div class="mapping-icon">🔌</div><div><h3>Exact inward / transfer ledger abhi connect nahi hai</h3><p>Projection me recorded movement zero hai. Dashboard observed closing se <b>implied net movement</b> dikhata hai, lekin use actual inward claim nahi karta.</p><a href="#/settings?tab=data">Settings → Data source me connect karein →</a></div></div>`;
    const metricTone = current && current.closingAccuracy >= 90 ? 'good' : current && current.closingAccuracy < 70 ? 'bad' : '';
    root.innerHTML = head('⚖️', 'Stock Balance Reconciliation', 'Opening stock + recorded movements − forecast consumption = projected closing · compared with observed daily stock snapshot', `${exportButtons('balance-export')} ${printButton}`) + forecastTabs('balance') + `
      <div class="source-row">${sourceChip('Daily stock snapshots', `${U.fmt(points.length)} dates · FF + GV where available`)}${sourceChip('Exact consumption', 'FF EIR + GV Master')}${movementData.configured && !movementData.error ? sourceChip('Movement ledger', `${U.fmt(movementData.rows.length)} valid rows`) : statusPill('Movement ledger optional','amber')}${(history.sourceErrors||[]).map((e)=>statusPill(`${e.source} unavailable`,'red')).join('')}</div>
      <div class="ins-filters"><label>Balance horizon<select class="select" data-param="horizon">${[7,15,30].map((v)=>`<option value="${v}" ${v===horizon?'selected':''}>${v} days</option>`).join('')}</select></label><label>Forecast baseline<select class="select" data-param="lookback"><option value="14" ${lookback===14?'selected':''}>Previous 14 days</option><option value="28" ${lookback===28?'selected':''}>Previous 28 days</option></select></label><label>Channel<select class="select" data-param="channel"><option value="all">Both channels</option><option value="ff" ${channel==='ff'?'selected':''}>First Forward</option><option value="gv" ${channel==='gv'?'selected':''}>GV Partner</option></select></label></div>
      ${ledgerPanel}
      ${current ? `<div class="ins-metrics">${metric('Closing-stock accuracy', `${current.closingAccuracy.toFixed(1)}%`, `${current.ledgerConfigured?'Ledger-reconciled':'Provisional'} · error ${current.closingError>=0?'+':''}${U.fmt(current.closingError,1)}`,metricTone)}${metric('Projected closing', U.fmt(current.projectedClosing,1), `Opening ${U.fmt(current.openingStock)} + net movement ${current.netMovement>=0?'+':''}${U.fmt(current.netMovement)} − forecast ${U.fmt(current.predictedConsumption,1)}`)}${metric('Observed actual closing', U.fmt(current.actualClosing), current.mixedPeriods?'Channel-specific closing dates':`${dateText(current.closingDate)} daily snapshot`)}${metric('Unexplained variance', `${current.unexplainedVariance>=0?'+':''}${U.fmt(current.unexplainedVariance,1)}`, current.ledgerConfigured?'Observed − movement-reconciled expected':'Implied net movement (ledger absent)',Math.abs(current.unexplainedVariance)<1?'good':Math.abs(current.unexplainedVariance)>10?'bad':'')}</div>
        <div class="balance-equation"><span><small>Opening stock</small><b>${U.fmt(current.openingStock)}</b></span><i>+</i><span><small>Recorded net movement</small><b>${current.netMovement>=0?'+':''}${U.fmt(current.netMovement)}</b></span><i>−</i><span><small>Predicted consumption</small><b>${U.fmt(current.predictedConsumption,1)}</b></span><i>=</i><span class="primary"><small>Projected closing</small><b>${U.fmt(current.projectedClosing,1)}</b></span><i>vs</i><span class="actual"><small>Actual closing</small><b>${U.fmt(current.actualClosing)}</b></span></div>` : `<div class="mapping-state warn"><div class="mapping-icon">⌛</div><div><h3>Completed stock-balance window abhi available nahi hai</h3><p>Daily closing compare karne ke liye selected horizon se separated opening/closing snapshots aur preceding issuance history chahiye.</p></div></div>`}
      <div class="split-cards">${channelResults.map((r)=>r.ok?`<div class="card balance-channel"><div class="card-head"><h3>${esc(r.channel)}</h3>${statusPill(`${r.closingAccuracy.toFixed(1)}% closing accuracy`,r.closingAccuracy>=90?'green':r.closingAccuracy<70?'red':'amber')}</div><div class="balance-period">${dateText(r.openingDate)} → ${dateText(r.closingDate)} · ${r.intervalDays} observed days${r.fitDays?` · target opening se ${r.fitDays}d gap`:''}</div><div class="summary-grid"><div><small>Opening → actual close</small><b>${U.fmt(r.openingStock)} → ${U.fmt(r.actualClosing)}</b></div><div><small>Forecast vs actual use</small><b>${U.fmt(r.predictedConsumption,1)} / ${U.fmt(r.actualConsumption)}</b></div><div><small>Recorded in / out</small><b>+${U.fmt(r.movementIn)} / −${U.fmt(r.movementOut)}</b></div><div><small>Implied net movement</small><b>${r.impliedNetMovement>=0?'+':''}${U.fmt(r.impliedNetMovement,1)}</b></div></div><p class="dim small">${r.snapshots} snapshots available · training ${r.observedDays}/${lookback} days · ${r.ledgerConfigured?'exact ledger applied':'movement unrecorded/provisional'}</p></div>`:`<div class="card balance-channel unavailable"><div class="card-head"><h3>${esc(r.channel)}</h3>${statusPill('Not ready','amber')}</div>${empty('Balance window unavailable',r.reason)}</div>`).join('')}</div>
      ${validChannels.length?`<div class="card"><div class="card-head"><h3>Channel reconciliation detail</h3><span class="dim small">Closing error = projected closing − observed closing</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Channel / period</th><th>Opening</th><th>Movement in</th><th>Movement out</th><th>Net movement</th><th>Forecast use</th><th>Actual use</th><th>Projected close</th><th>Actual close</th><th>Closing error</th><th>Unexplained</th><th>Accuracy</th></tr></thead><tbody>${validChannels.map((r)=>`<tr><td><b>${esc(r.channel)}</b><small>${dateText(r.openingDate)} → ${dateText(r.closingDate)} · ${r.intervalDays}d</small></td><td>${U.fmt(r.openingStock)}</td><td>+${U.fmt(r.movementIn)}</td><td>−${U.fmt(r.movementOut)}</td><td>${r.netMovement>=0?'+':''}${U.fmt(r.netMovement)}</td><td>${U.fmt(r.predictedConsumption,1)}</td><td>${U.fmt(r.actualConsumption)}</td><td><b>${U.fmt(r.projectedClosing,1)}</b></td><td><b>${U.fmt(r.actualClosing)}</b></td><td>${r.closingError>=0?'+':''}${U.fmt(r.closingError,1)}</td><td>${r.unexplainedVariance>=0?'+':''}${U.fmt(r.unexplainedVariance,1)}</td><td>${statusPill(`${r.closingAccuracy.toFixed(1)}%`,r.closingAccuracy>=90?'green':r.closingAccuracy<70?'red':'amber')}</td></tr>`).join('')}</tbody></table></div></div>`:''}
      <div class="card"><div class="card-head"><h3>Movement ledger rows</h3><span class="dim small">${movementData.configured?`${U.fmt(recentMovements.length)} recent valid · ${U.fmt(movementData.invalid.length)} invalid`:'Connect the optional ledger for exact movements'}</span></div>${recentMovements.length?`<div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Date</th><th>Channel</th><th>Type</th><th>Quantity</th><th>Stock impact</th><th>Class</th><th>From → To</th><th>Reference</th></tr></thead><tbody>${recentMovements.map((r)=>`<tr><td>${dateText(r.date)}</td><td>${esc(r.channel)}</td><td>${statusPill(r.type,r.impact>0?'green':r.impact<0?'red':'blue')}</td><td>${U.fmt(r.quantity)}</td><td><b>${r.impact>=0?'+':''}${U.fmt(r.impact)}</b></td><td>${esc(r.cls)}</td><td>${esc(r.from||'—')} → ${esc(r.to||'—')}</td><td>${esc(r.reference||'—')}<small>${esc(r.note||'')}</small></td></tr>`).join('')}</tbody></table></div>`:empty('No valid movement rows in snapshot range',movementData.configured?'Date/channel/type/quantity mapping aur selected period check karein.':'Settings → Data source se Stock Movements tab connect karein.')}</div>
      <div class="method-card"><b>Balance methodology</b><span>Daily snapshots server ka last changed stock count hain. Consumption exact EIR/GV Master issuance/replacement hai. Forecast selected opening snapshot se pehle ke ${lookback} calendar days ka run-rate use karta hai. Ledger connected ho to IN/OUT/signed ADJUSTMENT apply hota hai; internal TRANSFER net zero. <b>Unexplained variance = observed closing − (opening + recorded net movement − actual consumption)</b>. Ledger absent ho to implied movement sirf residual estimate hai, actual inward nahi.</span></div>`;
    bindExports(root, 'balance-export', `stock-balance-${horizon}d-${U.stamp()}`, 'Stock Balance', ['Channel','Opening date','Closing date','Observed days','Opening stock','Movement in','Movement out','Internal transfer','Net movement','Predicted consumption','Actual consumption','Projected closing','Actual closing','Closing error','Closing accuracy %','Implied net movement','Unexplained variance','Ledger reconciled','Training days'], validChannels.map((r)=>[r.channel,U.dateKey(r.openingDate),U.dateKey(r.closingDate),r.intervalDays,r.openingStock,r.movementIn,r.movementOut,r.internalTransfer,r.netMovement,r.predictedConsumption,r.actualConsumption,r.projectedClosing,r.actualClosing,r.closingError,r.closingAccuracy,r.impliedNetMovement,r.unexplainedVariance,r.ledgerConfigured?'Yes':'No',r.observedDays]), recentMovements.length ? [{ name: 'Movements', header: ['Date','Channel','Type','Quantity','Signed stock impact','Class','From','To','Reference','Note'], rows: recentMovements.map((r)=>[r.dateKey,r.channel,r.type,r.quantity,r.impact,r.cls,r.from,r.to,r.reference,r.note]) }] : []);
  }

  async function renderForecastAccuracy(root, params) {
    const horizon = [7, 15, 30].includes(Number(params.horizon)) ? Number(params.horizon) : 7;
    const lookback = [14, 28].includes(Number(params.lookback)) ? Number(params.lookback) : 28;
    const channel = ['all', 'ff', 'gv'].includes(params.channel) ? params.channel : 'all';
    const q = clean(params.q).toLowerCase(), data = await forecastAccuracy(lookback), bucket = data.horizons[horizon];
    const current = channel === 'ff' ? bucket.ff : channel === 'gv' ? bucket.gv : bucket.combined;
    const trend = channel === 'ff' ? bucket.ffWindows : channel === 'gv' ? bucket.gvWindows : bucket.combinedWindows;
    const allRows = current ? current.rows : [];
    const rows = allRows.filter((r) => !q || [r.name, r.id, r.tlName, r.channel].join(' ').toLowerCase().includes(q));
    const biasText = !current || current.bias === null ? '—' : `${current.bias >= 0 ? '+' : ''}${current.bias.toFixed(1)}%`;
    const biasFoot = !current || current.bias === null ? 'Actual consumption unavailable' : current.bias > 2 ? 'Over-forecasting' : current.bias < -2 ? 'Under-forecasting' : 'Near-neutral forecast';
    const horizonCards = [7, 15, 30].map((h) => channel === 'ff' ? data.horizons[h].ff : channel === 'gv' ? data.horizons[h].gv : data.horizons[h].combined).filter(Boolean);
    const channelCards = current && channel === 'all' ? [bucket.ff, bucket.gv].filter(Boolean) : [];
    const coverageSources = current ? (current.sources || [current]) : [];
    const trendChronological = trend.slice().reverse();
    root.innerHTML = head('🎯', 'Forecast Accuracy', 'Rolling historical backtest: predicted stock consumption vs actual tag issuance/replacement · no saved prediction history required', `${exportButtons('accuracy-export')} ${printButton}`) + forecastTabs('accuracy') + `
      <div class="source-row">${sourceChip('FF EIR', `${U.fmt(data.history.ff.length)} exact daily agent groups`)}${sourceChip('GV Master', `${U.fmt(data.history.gv.length)} issuance rows`)}${data.history.sourceErrors.map((e)=>statusPill(`${e.source} unavailable`,'red')).join('')}<span class="dim small">Consumption proxy = tags issued/replaced; stock transfers are not treated as consumption.</span></div>
      <div class="ins-filters"><label>Test horizon<select class="select" data-param="horizon">${[7,15,30].map((v) => `<option value="${v}" ${v === horizon ? 'selected' : ''}>${v} days</option>`).join('')}</select></label><label>Training window<select class="select" data-param="lookback"><option value="14" ${lookback === 14 ? 'selected' : ''}>Previous 14 days</option><option value="28" ${lookback === 28 ? 'selected' : ''}>Previous 28 days</option></select></label><label>Channel<select class="select" data-param="channel"><option value="all">Both channels</option><option value="ff" ${channel === 'ff' ? 'selected' : ''}>First Forward</option><option value="gv" ${channel === 'gv' ? 'selected' : ''}>GV Partner</option></select></label><form id="accuracy-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="Agent, ID or TL…"><button class="btn">Search</button></form></div>
      ${current ? `<div class="ins-metrics">${metric('Forecast accuracy', `${current.accuracy.toFixed(1)}%`, `WAPE ${current.wape.toFixed(1)}% · ${horizon}-day holdout`, current.accuracy >= 80 ? 'good' : current.accuracy < 60 ? 'bad' : '')}${metric('Predicted consumption', U.fmt(current.predicted, 1), `${lookback}-day baseline`)}${metric('Actual consumption', U.fmt(current.actual), `${dateText(current.actualStart)} → ${dateText(current.end)}`)}${metric('Forecast bias', biasText, biasFoot, current.bias !== null && Math.abs(current.bias) <= 10 ? 'good' : '')}</div><div class="accuracy-coverage"><div><small>Evaluated sample</small><b>${U.fmt(current.agents)} agents</b><span>${U.fmt(current.absoluteError,1)} total absolute error · ${current.mae.toFixed(1)} MAE/agent</span></div><div><small>Training coverage</small><b>${current.fullTraining ? 'Complete' : 'Partial'} · ${current.observedDays}/${lookback} days</b><span>${coverageSources.map((s)=>`${s.channel}: ${dateText(s.trainingStart)}–${dateText(s.trainingEnd)}`).join(' · ')}</span></div><div><small>Tracking depth</small><b>${U.fmt(trend.length)} completed windows</b><span>Up to 120 source days · zero-history agents score 0%, never 100%</span></div></div>` : `<div class="mapping-state warn"><div class="mapping-icon">⌛</div><div><h3>${data.history.sourceErrors.length ? 'Historical source poori tarah available nahi hai' : 'Backtest ke liye enough history nahi hai'}</h3><p>${esc(data.history.sourceErrors.length ? data.history.sourceErrors.map((e)=>`${e.source}: ${e.message}`).join(' · ') : `Selected ${lookback}-day training + ${horizon}-day actual window source data me complete nahi mila. Chhota horizon/lookback try karein.`)}</p></div></div>`}
      ${horizonCards.length ? `<div class="accuracy-horizons">${horizonCards.map((r) => `<a class="${r.horizon === horizon ? 'active' : ''}" href="#/forecast?view=accuracy&horizon=${r.horizon}&lookback=${lookback}&channel=${channel}"><small>${r.horizon}-day model</small><b>${r.accuracy.toFixed(1)}%</b><span>${U.fmt(r.predicted,1)} predicted · ${U.fmt(r.actual)} actual</span></a>`).join('')}</div>` : ''}
      ${channelCards.length ? `<div class="split-cards">${channelCards.map((r) => `<div class="card"><div class="card-head"><h3>${esc(r.channel)}</h3>${statusPill(`${r.accuracy.toFixed(1)}% accuracy`,r.accuracy>=80?'green':r.accuracy<60?'red':'amber')}</div><div class="summary-grid"><div><small>Predicted</small><b>${U.fmt(r.predicted,1)}</b></div><div><small>Actual</small><b>${U.fmt(r.actual)}</b></div><div><small>WAPE</small><b>${r.wape.toFixed(1)}%</b></div><div><small>Bias</small><b>${r.bias===null?'—':`${r.bias>=0?'+':''}${r.bias.toFixed(1)}%`}</b></div></div></div>`).join('')}</div>` : ''}
      ${trendChronological.length ? `<div class="card"><div class="card-head"><h3>Accuracy tracking across completed test windows</h3><span class="dim small">Newest window is on the right · non-overlapping ${horizon}-day holdouts</span></div>${C.bars({labels:trendChronological.map((r)=>dateText(r.end).replace(/\s\d{4}$/,'')),series:[{name:'Predicted',values:trendChronological.map((r)=>r.predicted),color:'#6366f1'},{name:'Actual',values:trendChronological.map((r)=>r.actual),color:'#10b981'}],height:230,showValues:true})}<div class="accuracy-track">${trendChronological.map((r)=>`<span title="WAPE ${r.wape.toFixed(1)}%"><i style="width:${Math.max(2,r.accuracy)}%"></i><b>${r.accuracy.toFixed(0)}%</b></span>`).join('')}</div></div>` : ''}
      ${current && current.classes.length ? `<div class="card"><div class="card-head"><h3>Vehicle-class accuracy</h3><span class="dim small">Selected channel and horizon</span></div><div class="accuracy-classes">${current.classes.map((r) => `<div><b>${esc(r.cls)}</b><span>${U.fmt(r.predicted,1)} predicted · ${U.fmt(r.actual)} actual</span><strong>${r.accuracy.toFixed(1)}%</strong></div>`).join('')}</div></div>` : ''}
      <div class="card"><div class="card-head"><h3>Agent-wise predicted vs actual consumption</h3><span class="dim small">${U.fmt(rows.length)} agents · highest absolute error first</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Agent</th><th>Channel</th><th>Training issuance</th><th>Baseline / day</th><th>Predicted</th><th>Actual</th><th>Absolute error</th><th>Bias units</th><th>Accuracy</th><th>Direction</th><th>Confidence</th></tr></thead><tbody>${rows.map((r) => `<tr><td><b>${esc(r.name || r.id)}</b><small>${esc(r.id || '')} · ${esc(r.tlName || 'Direct')}</small></td><td>${statusPill(r.channel,r.channel==='GV Partner'?'green':'blue')}</td><td>${U.fmt(r.training)}</td><td>${r.dailyRate.toFixed(2)}</td><td>${U.fmt(r.predicted,1)}</td><td><b>${U.fmt(r.actual)}</b></td><td>${U.fmt(r.absoluteError,1)}</td><td><b class="accuracy-bias ${r.biasUnits > 0 ? 'over' : r.biasUnits < 0 ? 'under' : ''}">${r.biasUnits >= 0 ? '+' : ''}${U.fmt(r.biasUnits,1)}</b></td><td>${statusPill(`${r.accuracy.toFixed(1)}%`,r.accuracy>=80?'green':r.accuracy<60?'red':'amber')}</td><td>${esc(r.direction)}</td><td>${statusPill(r.confidence,r.confidence==='High'?'green':r.confidence==='Low'?'red':'amber')}</td></tr>`).join('') || `<tr><td colspan="11">${empty(current ? 'No agents match' : 'No completed backtest','Filter change karein ya source history badhne dein.')}</td></tr>`}</tbody></table></div></div>
      <div class="method-card"><b>Methodology</b><span>Har test window ke immediately pehle ke ${lookback} calendar days ka agent-wise daily run-rate nikala gaya, phir ${horizon} days ke liye predict karke exact subsequent issuance/replacement se compare kiya. Headline accuracy = max(0, 100 − WAPE). Positive bias over-forecast aur negative bias under-forecast dikhata hai.</span></div>`;
    U.$('#accuracy-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    bindExports(root, 'accuracy-export', `forecast-accuracy-${horizon}d-${U.stamp()}`, 'Forecast Accuracy', ['Channel','Agent ID','Agent','TL','Training issuance','Daily baseline','Predicted consumption','Actual consumption','Absolute error','Bias units','Accuracy %','Direction','Confidence','Training days','Horizon days'], rows.map((r) => [r.channel,r.id,r.name,r.tlName,r.training,r.dailyRate,r.predicted,r.actual,r.absoluteError,r.biasUnits,r.accuracy,r.direction,r.confidence,r.trainingDays,horizon]));
  }
  async function forecastRows(growthPct, safetyDays) {
    await FF.pages.performance.ensureLoaded();
    const gvReport = await G.need('report');
    const multiplier = 1 + (growthPct / 100);
    const make = (channel, id, name, tlName, stock, baseRate) => {
      const rate = Math.max(0, Number(baseRate) || 0) * multiplier;
      const safety = Math.ceil(rate * safetyDays);
      const need = (days) => Math.max(0, Math.ceil(rate * days) + safety - stock);
      const stockDays = rate > 0 ? stock / rate : Infinity;
      const outDate = Number.isFinite(stockDays) ? new Date(Date.now() + Math.max(0, stockDays) * 864e5) : null;
      return { channel, id, name, tlName, stock, baseRate: Number(baseRate) || 0, rate, safety, stockDays, outDate, need7: need(7), need15: need(15), need30: need(30), risk: rate <= 0 ? 'No run-rate' : stockDays <= 3 ? 'Critical' : stockDays <= 7 ? 'High' : stockDays <= 15 ? 'Medium' : 'Covered' };
    };
    const ff = FF.pages.performance.agents().filter((a) => a.name || a.agentId).map((a) => make('First Forward', a.agentId || a.id, a.name, a.tlName, a.stockTotal || 0, a.avgTotal || (a.activeDays ? (a.curTotal || 0) / a.activeDays : 0)));
    const gv = gvReport.map((a) => make('GV Partner', a.agentId, a.agentName, a.tlName, a.stockTotal || 0, a.runrate || (a.curDays ? a.curTotal / a.curDays : 0)));
    return [...ff, ...gv].sort((a, b) => a.stockDays - b.stockDays || b.rate - a.rate);
  }

  async function renderForecast(root, params) {
    if (params.view === 'accuracy') return renderForecastAccuracy(root, params);
    if (params.view === 'balance') return renderStockBalance(root, params);
    const growthNum = Number(params.growth), safetyNum = Number(params.safety);
    const growth = Math.max(-50, Math.min(150, Number.isFinite(growthNum) ? growthNum : 0));
    const safetyDays = Math.max(0, Math.min(30, params.safety !== undefined && Number.isFinite(safetyNum) ? safetyNum : 5));
    const channel = ['all','ff','gv'].includes(params.channel) ? params.channel : 'all';
    const risk = ['all','Critical','High','Medium','Covered','No run-rate'].includes(params.risk) ? params.risk : 'all';
    const q = clean(params.q).toLowerCase();
    const all = await forecastRows(growth, safetyDays);
    const rows = all.filter((r) => (channel === 'ff' ? r.channel === 'First Forward' : channel === 'gv' ? r.channel === 'GV Partner' : true) && (risk === 'all' || r.risk === risk) && (!q || [r.id,r.name,r.tlName].join(' ').toLowerCase().includes(q)));
    const critical = all.filter((r) => r.stockDays <= 7 && r.rate > 0), required7 = sum(all, (r) => r.need7), required15 = sum(all, (r) => r.need15), required30 = sum(all, (r) => r.need30);
    root.innerHTML = head('🔭', 'Stock Forecasting', 'Sheet run-rate based stock-out projection · 7/15/30-day need · safety stock · what-if scenario', `${exportButtons('forecast-export')} ${printButton}`) + forecastTabs('projection') + `
      <div class="whatif"><div><b>What-if demand scenario</b><span>Run-rate change <strong id="growth-out">${growth >= 0 ? '+' : ''}${growth}%</strong></span><input id="growth-range" type="range" min="-50" max="150" step="5" value="${growth}"></div><div><b>Safety stock</b><span><strong id="safety-out">${safetyDays}</strong> demand days</span><input id="safety-range" type="range" min="0" max="30" step="1" value="${safetyDays}"></div><button class="btn primary" id="apply-scenario">Apply scenario</button></div>
      <div class="ins-metrics">${metric('Stock-out within 7 days', U.fmt(critical.length), 'Across both channels', critical.length ? 'bad' : 'good')}${metric('7-day replenishment need', U.fmt(required7), `Includes ${safetyDays} safety days`)}${metric('15-day replenishment need', U.fmt(required15), `Demand ${growth >= 0 ? '+' : ''}${growth}%`)}${metric('30-day replenishment need', U.fmt(required30), 'Net of current stock')}</div>
      <div class="ins-filters"><label>Channel<select class="select" data-param="channel"><option value="all">Both channels</option><option value="ff" ${channel === 'ff' ? 'selected' : ''}>First Forward</option><option value="gv" ${channel === 'gv' ? 'selected' : ''}>GV Partner</option></select></label><label>Risk<select class="select" data-param="risk">${['all','Critical','High','Medium','Covered','No run-rate'].map((v) => `<option value="${v}" ${v === risk ? 'selected' : ''}>${v === 'all' ? 'All risk levels' : v}</option>`).join('')}</select></label><form id="forecast-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="Agent, ID or TL…"><button class="btn">Search</button></form></div>
      <div class="card"><div class="card-head"><h3>Agent-level requirement forecast</h3><span class="dim small">Recommendation only · no dispatch approval workflow</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Agent</th><th>Channel</th><th>Stock</th><th>Adjusted / day</th><th>Stock cover</th><th>Projected stock-out</th><th>Safety units</th><th>Need · 7d</th><th>Need · 15d</th><th>Need · 30d</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><b>${esc(r.name || r.id)}</b><small>${esc(r.id || '')} · ${esc(r.tlName || 'Direct')}</small></td><td>${statusPill(r.channel, r.channel === 'GV Partner' ? 'green' : 'blue')}</td><td>${U.fmt(r.stock)}</td><td>${r.rate.toFixed(1)}<small>base ${r.baseRate.toFixed(1)}</small></td><td>${statusPill(Number.isFinite(r.stockDays) ? `${r.stockDays.toFixed(1)} days` : 'No consumption', r.risk === 'Critical' ? 'red' : r.risk === 'High' ? 'amber' : r.risk === 'Covered' ? 'green' : '')}<small>${esc(r.risk)}</small></td><td>${r.outDate ? dateText(r.outDate) : '—'}</td><td>${U.fmt(r.safety)}</td><td><b>${U.fmt(r.need7)}</b></td><td>${U.fmt(r.need15)}</td><td>${U.fmt(r.need30)}</td></tr>`).join('') || `<tr><td colspan="10">${empty('No forecast rows', '')}</td></tr>`}
      </tbody></table></div></div>`;
    const gr = U.$('#growth-range', root), sr = U.$('#safety-range', root);
    gr.addEventListener('input', () => { U.$('#growth-out', root).textContent = `${Number(gr.value) >= 0 ? '+' : ''}${gr.value}%`; });
    sr.addEventListener('input', () => { U.$('#safety-out', root).textContent = sr.value; });
    U.$('#apply-scenario', root).addEventListener('click', () => FF.app.updateParams({ growth: gr.value, safety: sr.value }));
    U.$('#forecast-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    bindExports(root, 'forecast-export', `stock-forecast-${U.stamp()}`, 'Stock Forecast', ['Channel','Agent ID','Agent','TL','Stock','Base daily rate','Scenario daily rate','Stock days','Stock-out date','Risk','Safety units','Need 7 days','Need 15 days','Need 30 days'], rows.map((r) => [r.channel,r.id,r.name,r.tlName,r.stock,r.baseRate,r.rate,Number.isFinite(r.stockDays)?r.stockDays:'',r.outDate?U.dateKey(r.outDate):'',r.risk,r.safety,r.need7,r.need15,r.need30]));
  }

  // ---- data quality -----------------------------------------------------------------------------
  const duplicateGroups = (rows, fn) => { const m = new Map(); rows.forEach((r) => { const k = fn(r); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return [...m.entries()].filter(([, list]) => list.length > 1); };
  async function qualityIssues() {
    if (mem.quality) return mem.quality;
    const [details, master, gvReport, daily] = await Promise.all([loadDetails(false), G.need('master'), G.need('report'), S.need('daily')]);
    await FF.pages.performance.ensureLoaded();
    const ffReport = FF.pages.performance.agents();
    const issues = [];
    const add = (severity, category, source, title, count, samples, action) => { if (count) issues.push({ severity, category, source, title, count, samples: (samples || []).slice(0, 8), action }); };
    const dup = [
      ['GV Master tag IDs', duplicateGroups(details.rawMaster, (r) => normBarcode(r.tagId))],
      ['GV Master serials', duplicateGroups(details.rawMaster, (r) => normBarcode(r.serial))],
      ['Tag Assignment tag IDs', duplicateGroups(details.assignment, (r) => normBarcode(r.tagId))],
      ['Tag Assignment serials', duplicateGroups(details.assignment, (r) => normBarcode(r.serial))],
      ['StockDataa tag IDs', duplicateGroups(details.stock, (r) => normBarcode(r.tagId))],
      ['StockDataa barcodes', duplicateGroups(details.stock, (r) => normBarcode(r.barcode))]
    ];
    dup.forEach(([label, groups]) => add('high', 'Duplicates', label.split(' ')[0] === 'GV' ? 'GV Master' : label.startsWith('Tag') ? 'Tag Assignment' : 'StockDataa', `Duplicate ${label}`, groups.length, groups.map(([k, list]) => `${k} × ${list.length}`), 'Keep one authoritative row or verify legitimate reissue.'));
    const directGvIds = new Set(master.filter(directAgent).map((r) => normId(r.agentId)).filter(Boolean));
    const directFfIds = new Set(ffReport.filter(directAgent).map((r) => normId(r.agentId || r.id)).filter(Boolean));
    const masterMissingId = details.rawMaster.filter((r) => !clean(r.agentId));
    const masterMissingTl = details.rawMaster.filter((r) => clean(r.agentId) && !clean(r.tlId) && !clean(r.tlName) && !directGvIds.has(normId(r.agentId)));
    const assignMissingAgent = details.assignment.filter((r) => !clean(r.agentId) || !clean(r.agentName));
    const assignMissingTl = details.assignment.filter((r) => !clean(r.tlId) && !clean(r.tlName) && !directGvIds.has(normId(r.agentId)));
    const stockMissingAgent = details.stock.filter((r) => !clean(r.agentId) || !clean(r.agentName));
    const stockMissingTl = details.stock.filter((r) => !clean(r.tlName) && !directFfIds.has(normId(r.agentId)));
    add('high','Missing identity','GV Master','GV Master rows without agent ID',masterMissingId.length,masterMissingId.map((r) => r.tagId || r.serial),'Populate the configured UNIQUE_ID field.');
    add('medium','Missing TL','GV Master','GV Master rows without TL/direct identity',masterMissingTl.length,masterMissingTl.map((r) => `${r.agentId} ${r.agentName}`),'Set TL fields or an explicit Direct marker.');
    add('high','Unassigned stock','Tag Assignment','GV stock without complete agent assignment',assignMissingAgent.length,assignMissingAgent.map((r) => r.tagId || r.serial),'Assign agent ID and name before field movement.');
    add('medium','Missing TL','Tag Assignment','GV stock without TL/direct identity',assignMissingTl.length,assignMissingTl.map((r) => `${r.agentId} ${r.agentName}`),'Set supervisor or explicit Direct marker.');
    add('high','Unassigned stock','StockDataa','FF stock without complete agent assignment',stockMissingAgent.length,stockMissingAgent.map((r) => r.tagId || r.barcode),'Populate agent ID and agent name.');
    add('medium','Missing TL','StockDataa','FF stock without TL/direct identity',stockMissingTl.length,stockMissingTl.map((r) => `${r.agentId} ${r.agentName}`),'Set TL Name or Direct marker.');
    const ffReportMissingTl = ffReport.filter((r) => !directAgent(r) && !clean(r.tlId) && !clean(r.tlName));
    const gvReportMissingTl = gvReport.filter((r) => !directAgent(r) && !clean(r.tlId) && !clean(r.tlName));
    add('high','Missing TL','FF REPORT','FF REPORT agents without TL/direct identity',ffReportMissingTl.length,ffReportMissingTl.map((r) => `${r.agentId} ${r.name}`),'Populate TL ID/name or explicit Direct category.');
    add('high','Missing TL','GV REPORT','GV REPORT agents without TL/direct identity',gvReportMissingTl.length,gvReportMissingTl.map((r) => `${r.agentId} ${r.agentName}`),'Populate supervisor ID/name or explicit Direct category.');
    const invalidDates = details.rawMaster.filter((r) => clean(r.rawDate) && !r.date);
    const blankDates = details.rawMaster.filter((r) => !clean(r.rawDate));
    const invalidStockDates = details.stock.filter((r) => (clean(r.agentAllocatedAt) && !U.parseDateTime(r.agentAllocatedAt)) || (clean(r.bcAllocatedAt) && !U.parseDateTime(r.bcAllocatedAt)));
    add('high','Invalid dates','GV Master','GV Master invalid issuance dates',invalidDates.length,invalidDates.map((r) => `${r.tagId}: ${r.rawDate}`),'Use a true Google Sheets date value.');
    add('medium','Invalid dates','GV Master','GV Master blank issuance dates',blankDates.length,blankDates.map((r) => r.tagId || r.serial),'Populate issuance date.');
    add('medium','Invalid dates','StockDataa','Invalid BC/agent allocation timestamps',invalidStockDates.length,invalidStockDates.map((r) => `${r.tagId}: ${r.agentAllocatedAt || r.bcAllocatedAt}`),'Use a recognized date-time value in allocation columns.');
    const gvAssignmentIds = new Set(details.assignment.map((r) => normId(r.agentId)).filter(Boolean));
    const gvMasterIds = new Set(master.map((r) => normId(r.agentId)).filter(Boolean));
    const gvReportIds = new Set(gvReport.map((r) => normId(r.agentId)).filter(Boolean));
    const ffStockIds = new Set(details.stock.map((r) => normId(r.agentId)).filter(Boolean));
    const ffMissingStock = ffReport.filter((r) => normId(r.agentId) && !ffStockIds.has(normId(r.agentId)));
    const masterNotAssigned = [...gvMasterIds].filter((id) => !gvAssignmentIds.has(id));
    const reportNotAssigned = [...gvReportIds].filter((id) => !gvAssignmentIds.has(id));
    const knownGvUnique = new Set([...details.assignment.map((r) => normId(r.gvUniqueId)), ...details.rawMaster.map((r) => normId(r.gvUniqueId))].filter(Boolean));
    const badFfGvIds = ffReport.filter((r) => { const id = normId(r.gvIdFound); return id && !/^(NOTFOUND|NA|NONE)$/.test(id) && !knownGvUnique.has(id); });
    add('medium','Cross-sheet mismatch','FF REPORT ↔ StockDataa','REPORT agents absent from StockDataa assignment',ffMissingStock.length,ffMissingStock.map((r) => `${r.agentId} ${r.name}`),'Verify ID format or confirm zero-stock state.');
    add('high','Cross-sheet mismatch','FF REPORT ↔ GV identity','“GV ID Found” values absent from GV Master/Tag Assignment',badFfGvIds.length,badFfGvIds.map((r) => `${r.agentId}: ${r.gvIdFound}`),'Correct the GV unique ID; do not substitute an agent name.');
    add('medium','Cross-sheet mismatch','GV Master ↔ Tag Assignment','Issuing GV agents absent from Tag Assignment',masterNotAssigned.length,masterNotAssigned,'Normalize agent IDs across GV tabs.');
    add('medium','Cross-sheet mismatch','GV REPORT ↔ Tag Assignment','GV REPORT agents absent from Tag Assignment',reportNotAssigned.length,reportNotAssigned,'Normalize agent IDs or confirm zero-stock state.');
    const latestGv = master.reduce((d, r) => r.date && (!d || r.date > d) ? r.date : d, null);
    const latestFf = M.latestDate(daily);
    const age = (d) => d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 864e5)) : 999;
    if (age(latestFf) > 2) add(age(latestFf) > 7 ? 'high' : 'medium','Stale data','EIR',`First Forward issuance is ${age(latestFf)} days stale`,1,[latestFf ? U.dateKey(latestFf) : 'No valid date'],'Refresh source or check EIR date mapping.');
    if (age(latestGv) > 2) add(age(latestGv) > 7 ? 'high' : 'medium','Stale data','GV Master',`GV issuance is ${age(latestGv)} days stale`,1,[latestGv ? U.dateKey(latestGv) : 'No valid date'],'Refresh source or check GV Master date mapping.');
    if (details.truncated && (details.truncated.stock || details.truncated.assignment)) add('high','Scan coverage','Detailed loaders','Raw detail scan hit the 250,000-row safety cap',1,[details.truncated.stock ? 'StockDataa capped' : '', details.truncated.assignment ? 'Tag Assignment capped' : ''].filter(Boolean),'Archive old rows or split the source so every detail row can be validated.');
    issues.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - ({ high: 0, medium: 1, low: 2 }[b.severity]) || b.count - a.count));
    mem.quality = { issues, scanned: { stock: details.stock.length, assignment: details.assignment.length, master: details.rawMaster.length, ffReport: ffReport.length, gvReport: gvReport.length }, latestFf, latestGv, checkedAt: new Date() };
    return mem.quality;
  }

  async function renderDataQuality(root, params) {
    const data = await qualityIssues();
    const severity = ['all','high','medium','low'].includes(params.severity) ? params.severity : 'all';
    const category = clean(params.category || 'all');
    const categories = [...new Set(data.issues.map((i) => i.category))].sort();
    const rows = data.issues.filter((i) => (severity === 'all' || i.severity === severity) && (category === 'all' || i.category === category));
    const high = data.issues.filter((i) => i.severity === 'high'), affected = sum(data.issues, (i) => i.count);
    root.innerHTML = head('🧪', 'Data Quality Center', 'Duplicates · missing identities/TLs · unassigned stock · invalid/stale dates · cross-sheet mismatches', `${exportButtons('dq-export')} ${printButton}`) + `
      <div class="source-row">${Object.entries(data.scanned).map(([k,n]) => sourceChip(k, `${U.fmt(n)} rows scanned`)).join('')}<span class="dim small">Checked ${esc(dateTimeText(data.checkedAt))}</span></div>
      <div class="ins-metrics">${metric('Quality checks with findings', U.fmt(data.issues.length), `${U.fmt(high.length)} high-severity` , high.length ? 'bad' : 'good')}${metric('Affected records / keys', U.fmt(affected), 'Counts can overlap across checks')}${metric('Latest FF data', data.latestFf ? dateText(data.latestFf) : 'Unavailable', data.latestFf ? `${Math.max(0,Math.floor((Date.now()-data.latestFf.getTime())/864e5))} day age` : 'No valid date')}${metric('Latest GV data', data.latestGv ? dateText(data.latestGv) : 'Unavailable', data.latestGv ? `${Math.max(0,Math.floor((Date.now()-data.latestGv.getTime())/864e5))} day age` : 'No valid date')}</div>
      <div class="ins-filters"><label>Severity<select class="select" data-param="severity"><option value="all">All severities</option>${['high','medium','low'].map((v) => `<option value="${v}" ${v === severity ? 'selected' : ''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></label><label>Category<select class="select" data-param="category"><option value="all">All categories</option>${categories.map((v) => `<option value="${esc(v)}" ${v === category ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label></div>
      ${!data.issues.length ? `<div class="mapping-state success"><div class="mapping-icon">✓</div><div><h3>No issues found by the configured checks</h3><p>All scanned source rows passed the current validation rules.</p></div></div>` : ''}
      <div class="quality-list">${rows.map((i) => `<details class="quality-item ${i.severity}" ${i.severity === 'high' ? 'open' : ''}><summary><span class="quality-sev">${i.severity === 'high' ? '●' : i.severity === 'medium' ? '◆' : '○'} ${esc(i.severity)}</span><span><b>${esc(i.title)}</b><small>${esc(i.source)} · ${esc(i.category)}</small></span><strong>${U.fmt(i.count)}</strong></summary><div class="quality-body"><p><b>Recommended correction:</b> ${esc(i.action)}</p>${i.samples.length ? `<div class="sample-list">${i.samples.map((s) => `<code>${esc(s)}</code>`).join('')}</div>` : ''}</div></details>`).join('') || empty('No issues match these filters','Try another severity or category.')}</div>`;
    bindExports(root, 'dq-export', `data-quality-${U.stamp()}`, 'Data Quality', ['Severity','Category','Source','Finding','Count','Samples','Recommended correction'], rows.map((i) => [i.severity,i.category,i.source,i.title,i.count,i.samples.join(' | '),i.action]));
  }

  // ---- executive cockpit -----------------------------------------------------------------------
  async function renderExecutive(root) {
    const [daily, stockAgents, gvMaster, gvStockClass, gvReport] = await Promise.all([S.need('daily'), S.need('stockAgents'), G.need('master'), G.need('stockClass'), G.need('report')]);
    await FF.pages.performance.ensureLoaded();
    const ffMonths = M.months(daily), ffMonth = ffMonths.at(-1) || U.ymKey(new Date()), gvMonth = latestMonth(gvMaster);
    const ff = M.summary(daily, ffMonth), gv = G.summary(gvMonth);
    const ffLast = M.summary(daily, U.prevMonthKey(ffMonth), Math.min(ff.lastDay || 31, U.daysInMonth(U.prevMonthKey(ffMonth))));
    const gvLast = G.summary(U.prevMonthKey(gvMonth), Math.min(gv.lastDay || 31, U.daysInMonth(U.prevMonthKey(gvMonth))));
    const ffStock = sum(stockAgents, (r) => r.n), gvStock = sum(gvStockClass, (r) => r.n);
    const ffAgents = FF.pages.performance.agents(), lowFf = ffAgents.filter((a) => (a.stockTotal || 0) > 0 && (a.avgTotal || 0) > 0 && (a.stockTotal / a.avgTotal) <= 7).length;
    const lowGv = gvReport.filter((a) => (a.stockTotal || 0) > 0 && (a.runrate || 0) > 0 && (a.stockTotal / a.runrate) <= 7).length;
    const gvRows = gvMaster.filter((r) => r.ym === gvMonth), commission = sum(gvRows, (r) => r.commission), amount = sum(gvRows, (r) => r.amount);
    let ffCommission = null; try { const c = await ffCommissionData(); if (c.amountCol) ffCommission = sum(c.agents.filter((a) => validValue(a.earned)), (a) => a.earned); } catch { /* source optional */ }
    const today = new Date(); today.setHours(0,0,0,0); const start = new Date(today); start.setDate(start.getDate() - 13);
    const labels = [], ffVals = [], gvVals = [];
    for (let i = 0; i < 14; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const k = U.dateKey(d); labels.push(d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})); ffVals.push(sum(daily.filter((r) => r.key === k && r.channel === 'First Forward'), (r) => r.n)); gvVals.push(gvMaster.filter((r) => r.date && U.dateKey(r.date) === k).length); }
    const top = aggregateGv(gvRows, 'agent').slice(0, 7);
    root.innerHTML = head('🧭','Management Executive Cockpit','One-screen business pulse · issuance, growth, stock cover, earnings and management exceptions', `${exportButtons('exec-export')} ${printButton}`) + `
      <div class="cockpit-banner"><div><small>Combined month-to-date issuance</small><strong>${U.fmt(ff.total + gv.total)}</strong><span>${esc(U.labelYM(ffMonth))} FF + ${esc(U.labelYM(gvMonth))} GV</span></div><div class="cockpit-split"><span>First Forward <b>${U.fmt(ff.total)}</b> ${U.deltaHtml(U.growth(ff.total,ffLast.total),{decimals:0})}</span><span>GV Partner <b>${U.fmt(gv.total)}</b> ${U.deltaHtml(U.growth(gv.total,gvLast.total),{decimals:0})}</span></div></div>
      <div class="ins-metrics">${metric('Projected month-end', U.fmt(ff.projected + gv.projected), `FF ${U.fmt(ff.projected)} · GV ${U.fmt(gv.projected)}`)}${metric('Combined field stock', U.fmt(ffStock + gvStock), `FF ${U.fmt(ffStock)} · GV ${U.fmt(gvStock)}`)}${metric('GV earned commission', money(commission,2), `${money(amount)} transaction amount`, 'good')}${metric('FF reported commission', ffCommission === null ? 'Unavailable' : money(ffCommission,2), ffCommission === null ? 'No commission heading in loaded REPORT' : 'REPORT earned amount')}</div>
      <div class="cockpit-grid"><div class="card span2"><div class="card-head"><h3>14-day channel pulse</h3><span class="dim small">Sheet-recorded issuances</span></div>${C.bars({labels,series:[{name:'First Forward',values:ffVals},{name:'GV Partner',values:gvVals}],height:230,showValues:false})}</div><div class="card"><div class="card-head"><h3>Management focus</h3></div><a class="focus-row ${lowFf+lowGv?'risk':''}" href="#/forecast?risk=High"><span>Stock cover ≤ 7 days</span><b>${U.fmt(lowFf+lowGv)}</b><small>FF ${lowFf} · GV ${lowGv}</small></a><a class="focus-row" href="#/dataQuality"><span>Run data quality checks</span><b>Open</b><small>Six source families</small></a><a class="focus-row" href="#/dualChannel"><span>Verified dual-channel agents</span><b>Review</b><small>Barcode + unique-ID evidence</small></a><a class="focus-row" href="#/followups?status=open"><span>Agent/TL follow-ups</span><b>Open</b><small>Owner and due-date timeline</small></a></div></div>
      <div class="split-cards"><div class="card"><div class="card-head"><h3>Channel operating summary</h3></div><div class="exec-channel"><div><b>First Forward</b><span>${U.fmt(ff.total)} issued · ${U.fmt(ffStock)} stock</span><small>${U.fmt(ff.vc4)} VC4 · ${U.fmt(ff.comm)} commercial · ${ff.activeDays} active days</small></div><div><b>GV Partner</b><span>${U.fmt(gv.total)} issued · ${U.fmt(gvStock)} stock</span><small>${U.fmt(gv.vc4)} VC4 · ${U.fmt(gv.comm)} commercial · ${gv.activeAgents} agents</small></div></div></div><div class="card"><div class="card-head"><h3>Top GV commission contributors</h3><a href="#/gvCommission">Full analysis →</a></div>${C.hbars({items:top.map((r)=>({label:r.label,sub:`${r.issuances} tags`,value:r.commission})),format:(v)=>money(v,0),valueLabel:'Commission'})}</div></div>`;
    bindExports(root, 'exec-export', `executive-cockpit-${U.stamp()}`, 'Executive Summary', ['Metric','First Forward','GV Partner','Combined'], [
      ['Month-to-date issuance',ff.total,gv.total,ff.total+gv.total],['Projected month-end',ff.projected,gv.projected,ff.projected+gv.projected],['Field stock',ffStock,gvStock,ffStock+gvStock],['VC4 issuance',ff.vc4,gv.vc4,ff.vc4+gv.vc4],['Commercial issuance',ff.comm,gv.comm,ff.comm+gv.comm],['Stock cover ≤ 7 days',lowFf,lowGv,lowFf+lowGv],['Reported commission',ffCommission===null?'Unavailable':ffCommission,commission,ffCommission===null?'Partial · GV only':ffCommission+commission]
    ]);
  }

  // ---- saved views + report studio ---------------------------------------------------------------
  async function workspace(force) {
    if (mem.workspace && !force) return mem.workspace;
    if (mem.workspacePromise && !force) return mem.workspacePromise;
    const version = mem.workspaceVersion;
    const pending = FF.auth.api('/api/workspace').then((data) => { if (version === mem.workspaceVersion) mem.workspace = data; return data; }).finally(() => { if (mem.workspacePromise === pending) mem.workspacePromise = null; });
    mem.workspacePromise = pending;
    return pending;
  }
  function shareUrl(route) { return `${location.origin}${location.pathname}${route}`; }
  function openSave() {
    if (!FF.auth.can('savedViews')) return U.toast('Saved views permission nahi hai', 'err');
    const route = location.hash && location.hash.startsWith('#/') ? location.hash : '#/home';
    const def = FF.app.PAGES.find((p) => p.id === FF.app.current.page);
    FF.app.openDrawer({ kicker: 'Reusable workspace', title: 'Save current filtered view', sub: 'Current route, tabs and filters exactly preserve honge.', body: `<form id="save-view-form" class="ins-form"><label>View name<input class="input" name="title" maxlength="100" required value="${esc(def ? def.label : 'My view')}"></label><label>Description<textarea class="input" name="description" maxlength="240" rows="3" placeholder="Team ke liye optional context"></textarea></label><label>Filter link<input class="input mono-input" name="route" readonly value="${esc(route)}"></label><label class="check"><input type="checkbox" name="shared"> Share with all dashboard users</label><button class="btn primary" type="submit">⭐ Save view</button></form>` });
    const form = U.$('#save-view-form');
    form.addEventListener('submit', async (e) => { e.preventDefault(); const fd = new FormData(form); const btn = form.querySelector('button'); U.setButtonBusy(btn,true,'Saving…'); try { await FF.auth.api('/api/workspace/views','POST',{title:fd.get('title'),description:fd.get('description'),route:fd.get('route'),shared:fd.get('shared')==='on'}); mem.workspace=null; FF.app.closeDrawer(); U.toast('View saved ✓','ok'); if (FF.app.current.page==='savedViews') FF.app.renderCurrent(); } catch(err){U.toast(err.message,'err');} finally { U.setButtonBusy(btn,false); } });
  }

  async function renderSavedViews(root) {
    const data = await workspace(false);
    const views = (data.views || []).slice().sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    root.innerHTML = head('⭐','Saved Views','Reusable filtered dashboard links · personal or shared with the team', '<button class="btn primary" id="new-view">＋ Save current view</button>') + `
      <div class="view-help"><b>Shareable filters are built in.</b><span>Har saved view exact <code>#/page?filter=value</code> route rakhta hai. Link copy karke WhatsApp/email me bhej sakte hain; receiver ke permissions still apply.</span></div>
      <div class="saved-grid">${views.map((v) => `<article class="saved-card"><div class="saved-icon">${v.shared?'👥':'⭐'}</div><div><h3>${esc(v.title)}</h3><p>${esc(v.description || 'No description')}</p><code>${esc(v.route)}</code><small>${v.shared?'Shared':'Personal'} · ${esc(v.ownerUser && v.ownerUser.name || v.owner)} · ${esc(dateTimeText(v.updatedAt))}</small></div><div class="saved-actions"><a class="btn small primary" href="${esc(v.route)}">Open</a><button class="btn small" data-copy-view="${esc(v.id)}">🔗 Copy</button>${v.owner === FF.auth.user.username || FF.auth.isAdmin() ? `<button class="btn small danger" data-delete-view="${esc(v.id)}">Delete</button>`:''}</div></article>`).join('') || empty('No saved views yet','Kisi filtered page par top-bar ☆ dabakar first view save karein.')}</div>`;
    U.$('#new-view',root).addEventListener('click',openSave);
    root.onclick = async (e)=>{ const copy=e.target.closest('[data-copy-view]'); if(copy){const v=views.find(x=>x.id===copy.dataset.copyView); if(v){await U.copyText(shareUrl(v.route)); U.toast('Shareable link copied ✓','ok');} return;} const del=e.target.closest('[data-delete-view]'); if(del&&confirm('Is saved view ko delete karein?')){try{await FF.auth.api(`/api/workspace/views/${encodeURIComponent(del.dataset.deleteView)}`,'DELETE');mem.workspace=null;renderSavedViews(root);}catch(err){U.toast(err.message,'err');}} };
  }

  async function renderReportStudio(root) {
    const f = FF.config.features || {}, email = (FF.auth.settings && FF.auth.settings.email) || {};
    const reports = [['executive','Executive Cockpit'],['gvCommission','GV Commission Intelligence'],['ffCommission','FF Commission Intelligence'],['dualChannel','Dual-channel Agents'],['forecast','Stock Forecast & Balance'],['dataQuality','Data Quality Center']];
    root.innerHTML = head('🗓️','Professional Report Studio','Open, export, print/PDF, share and deliver scheduled management reports','') + `
      <div class="ins-metrics">${metric('Daily HTML + CSV email',f.emailReport===true?'Active':'Off',`At ${Number(f.emailReportHour??21)}:00 IST`,f.emailReport===true?'good':'')}${metric('Weekly management digest',f.weeklyEmail===true?'Active':'Off',`Monday ${Number(f.weeklyEmailHour??9)}:00 IST`,f.weeklyEmail===true?'good':'')}${metric('Recipients',email.to?esc(String(email.to).split(',').length):'Not configured',email.to?esc(email.to):'Settings → SMTP')}${metric('Delivery engine',email.host?'SMTP configured':'SMTP required',email.host?esc(email.host):'Configure host/user/app password')}</div>
      <div class="report-studio-grid"><div class="card"><div class="card-head"><h3>Build / export now</h3></div><div class="ins-form"><label>Report<select class="select" id="studio-report">${reports.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select></label><div class="button-row"><button class="btn primary" id="studio-open">Open report</button><button class="btn" id="studio-copy">🔗 Copy share link</button><button class="btn" id="studio-print">🖨 PDF / Print</button></div><p class="dim small">CSV/Excel buttons selected report ke header me available hain. PDF uses the browser's print-to-PDF so charts and management cards stay visual.</p></div></div>
      <div class="card"><div class="card-head"><h3>Scheduled delivery</h3>${FF.auth.isAdmin()?statusPill('Admin controls','blue'):statusPill('View only')}</div><div class="schedule-controls"><label class="check"><input type="checkbox" id="schedule-daily" ${f.emailReport===true?'checked':''} ${FF.auth.isAdmin()?'':'disabled'}> <span><b>Daily professional report</b><small>HTML summary + CSV attachment</small></span></label><label>Hour (IST)<input class="input" id="schedule-daily-hour" type="number" min="0" max="23" value="${Number(f.emailReportHour??21)}" ${FF.auth.isAdmin()?'':'disabled'}></label><label class="check"><input type="checkbox" id="schedule-weekly" ${f.weeklyEmail===true?'checked':''} ${FF.auth.isAdmin()?'':'disabled'}> <span><b>Weekly management digest</b><small>Every Monday · FF + GV summary and stock</small></span></label><label>Hour (IST)<input class="input" id="schedule-weekly-hour" type="number" min="0" max="23" value="${Number(f.weeklyEmailHour??9)}" ${FF.auth.isAdmin()?'':'disabled'}></label>${FF.auth.isAdmin()?'<button class="btn primary" id="schedule-save">Save schedule</button>':''}<a class="btn" href="#/settings">SMTP & recipients settings</a></div></div></div>
      <div class="card"><div class="card-head"><h3>Delivery tests</h3><span class="dim small">Admin only · sends immediately to configured recipients</span></div><div class="button-row"><button class="btn" id="send-daily" ${FF.auth.isAdmin()?'':'disabled'}>📧 Send daily report now</button><button class="btn" id="send-weekly" ${FF.auth.isAdmin()?'':'disabled'}>📬 Send weekly digest now</button><button class="btn" id="share-wa">💬 Share selected report on WhatsApp</button></div><div id="studio-msg" class="dim small"></div></div>`;
    const studioHeaders = ['Setting','Current value','Details'];
    const dailyStudio = [['Daily delivery',f.emailReport===true?'Active':'Off',`Every day at ${Number(f.emailReportHour??21)}:00 IST · HTML summary + CSV attachment`]];
    const weeklyStudio = [['Weekly delivery',f.weeklyEmail===true?'Active':'Off',`Every Monday at ${Number(f.weeklyEmailHour??9)}:00 IST · FF + GV management summary`]];
    const recipientStudio = [['Recipients',email.to||'Not configured','Configure in Settings → email/SMTP; card shows recipient count when configured']];
    const engineStudio = [['SMTP delivery engine',email.host||'Not configured',email.host?'SMTP host is configured; credentials are not shown here.':'Configure SMTP in Settings before scheduling delivery.']];
    bindMetricDetails(root, 'Report Studio setup', studioHeaders, [...dailyStudio,...weeklyStudio,...recipientStudio,...engineStudio], {
      'Daily HTML + CSV email': { title: 'Daily report schedule', headers: studioHeaders, rows: dailyStudio },
      'Weekly management digest': { title: 'Weekly digest schedule', headers: studioHeaders, rows: weeklyStudio },
      Recipients: { title: 'Email recipients', headers: studioHeaders, rows: recipientStudio },
      'Delivery engine': { title: 'SMTP configuration status', headers: studioHeaders, rows: engineStudio }
    });
    const selected=()=>U.$('#studio-report',root).value;
    U.$('#studio-open',root).addEventListener('click',()=>FF.app.navigate(selected()));
    U.$('#studio-copy',root).addEventListener('click',async()=>{await U.copyText(shareUrl(`#/${selected()}`));U.toast('Report link copied ✓','ok');});
    U.$('#studio-print',root).addEventListener('click',()=>{FF.app.navigate(selected());setTimeout(()=>window.print(),1500);});
    U.$('#share-wa',root).addEventListener('click',()=>FF.app.shareWhatsApp(`${FF.config.brand} · ${reports.find(r=>r[0]===selected())[1]}\n${shareUrl(`#/${selected()}`)}`));
    if(FF.auth.isAdmin()){
      U.$('#schedule-save',root).addEventListener('click',async(e)=>{const b=e.currentTarget;U.setButtonBusy(b,true,'Saving…');try{const patch={emailReport:U.$('#schedule-daily',root).checked,emailReportHour:Math.max(0,Math.min(23,Number(U.$('#schedule-daily-hour',root).value)||0)),weeklyEmail:U.$('#schedule-weekly',root).checked,weeklyEmailHour:Math.max(0,Math.min(23,Number(U.$('#schedule-weekly-hour',root).value)||0))};const out=await FF.auth.api('/api/settings','PUT',{settings:{features:patch}});FF.auth.applySettings(out.settings);U.toast('Report schedule saved ✓','ok');}catch(err){U.toast(err.message,'err');}finally{U.setButtonBusy(b,false);}});
      const send=async(path,btn)=>{U.setButtonBusy(btn,true,'Sending…');try{const out=await FF.auth.api(path,'POST',{});U.$('#studio-msg',root).textContent=out.detail||'Sent ✓';U.toast('Report email sent ✓','ok');}catch(err){U.toast(err.message,'err');}finally{U.setButtonBusy(btn,false);}};
      U.$('#send-daily',root).addEventListener('click',(e)=>send('/api/notifications/report-email',e.currentTarget));
      U.$('#send-weekly',root).addEventListener('click',(e)=>send('/api/notifications/weekly-email',e.currentTarget));
    }
  }

  // ---- notes / follow-up timeline ---------------------------------------------------------------
  async function renderFollowups(root, params) {
    const data = await workspace(false), all = data.notes || [];
    const status = ['all','open','waiting','done'].includes(params.status) ? params.status : 'all';
    const q = clean(params.q).toLowerCase();
    const notes = all.filter((n)=>(status==='all'||n.status===status)&&(!q||[n.entityName,n.entityKey,n.text,n.assignee,n.channel].join(' ').toLowerCase().includes(q))).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const now=Date.now(), overdue=all.filter((n)=>n.status!=='done'&&n.dueAt&&Date.parse(n.dueAt)<now).length;
    root.innerHTML=head('📝','Agent & TL Notes','Collaborative follow-up timeline · owner, priority, due date and status history','<button class="btn primary" id="note-new">＋ Add follow-up</button>')+`
      <div class="ins-metrics">${metric('Open',U.fmt(all.filter(n=>n.status==='open').length),'Needs follow-up')}${metric('Waiting',U.fmt(all.filter(n=>n.status==='waiting').length),'External/team response')}${metric('Overdue',U.fmt(overdue),'Open items past due',overdue?'bad':'good')}${metric('Completed',U.fmt(all.filter(n=>n.status==='done').length),'Closed timeline items','good')}</div>
      <div class="ins-filters"><label>Status<select class="select" data-param="status">${['all','open','waiting','done'].map(v=>`<option value="${v}" ${v===status?'selected':''}>${v==='all'?'All statuses':v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></label><form id="notes-search" class="ins-search"><input class="input" name="q" value="${esc(params.q||'')}" placeholder="Agent, TL, owner or note…"><button class="btn">Search</button></form></div>
      <div class="timeline-list">${notes.map(n=>{const isOver=n.status!=='done'&&n.dueAt&&Date.parse(n.dueAt)<now;return `<article class="timeline-card ${n.status} ${isOver?'overdue':''}" data-note-id="${esc(n.id)}"><div class="timeline-dot"></div><div class="timeline-main"><div class="timeline-head"><div><b>${esc(n.entityName)}</b>${statusPill(n.entityType.toUpperCase(),n.channel==='gv'?'green':'blue')}${statusPill(n.status,n.status==='done'?'green':isOver?'red':n.status==='waiting'?'amber':'blue')}</div><small>${esc(dateTimeText(n.updatedAt))}</small></div><p>${esc(n.text)}</p><div class="timeline-meta"><span>📍 ${esc(n.channel==='both'?'GV + FF':n.channel.toUpperCase())}</span><span>👤 ${esc(n.assignee||n.createdByUser&&n.createdByUser.name||'Unassigned')}</span><span>⚑ ${esc(n.priority)}</span><span>📅 ${n.dueAt?dateText(n.dueAt):'No due date'}${isOver?' · overdue':''}</span></div><div class="button-row"><button class="btn small" data-note-open="${esc(n.id)}">Timeline</button>${n.status!=='done'?`<button class="btn small primary" data-note-status="done" data-id="${esc(n.id)}">Mark done</button>`:`<button class="btn small" data-note-status="open" data-id="${esc(n.id)}">Reopen</button>`}</div></div></article>`;}).join('')||empty('No follow-ups match','Add an agent/TL note or change filters.')}</div>`;
    const noteHeaders = ['Agent / TL','Type','Channel','Status','Priority','Owner','Due date','Last updated','Note'];
    const noteRows = (items) => items.map((n) => [n.entityName,n.entityType,n.channel,n.status,n.priority,n.assignee || n.createdByUser && n.createdByUser.name || 'Unassigned',n.dueAt ? dateText(n.dueAt) : '—',dateTimeText(n.updatedAt),n.text]);
    bindMetricDetails(root, 'Follow-up summary', noteHeaders, noteRows(all), {
      Open: { title: 'Open follow-ups', headers: noteHeaders, rows: noteRows(all.filter((n) => n.status === 'open')) },
      Waiting: { title: 'Waiting follow-ups', headers: noteHeaders, rows: noteRows(all.filter((n) => n.status === 'waiting')) },
      Overdue: { title: 'Overdue follow-ups', headers: noteHeaders, rows: noteRows(all.filter((n) => n.status !== 'done' && n.dueAt && Date.parse(n.dueAt) < now)) },
      Completed: { title: 'Completed follow-ups', headers: noteHeaders, rows: noteRows(all.filter((n) => n.status === 'done')) }
    });
    U.$('#notes-search',root).addEventListener('submit',(e)=>{e.preventDefault();FF.app.updateParams({q:new FormData(e.currentTarget).get('q')||''});});
    const openForm=()=>{FF.app.openDrawer({kicker:'Follow-up',title:'Add agent / TL note',sub:'This becomes a shared timeline item for permitted users.',body:`<form id="note-form" class="ins-form"><label>Entity type<select class="select" name="entityType"><option value="agent">Agent</option><option value="tl">Team Leader</option><option value="general">General</option></select></label><label>Agent / TL name<input class="input" name="entityName" required maxlength="120" placeholder="Searchable name or ID"></label><label>Channel<select class="select" name="channel"><option value="both">GV + First Forward</option><option value="ff">First Forward</option><option value="gv">GV Partner</option></select></label><label>Note<textarea class="input" name="text" rows="5" maxlength="4000" required placeholder="Context, promised action, next step…"></textarea></label><div class="form-grid"><label>Priority<select class="select" name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></label><label>Due date<input class="input" type="date" name="dueAt"></label></div><label>Owner / assignee<input class="input" name="assignee" maxlength="80" value="${esc(FF.auth.user.name||FF.auth.user.username)}"></label><button class="btn primary" type="submit">Save follow-up</button></form>`});const form=U.$('#note-form');form.addEventListener('submit',async(e)=>{e.preventDefault();const fd=Object.fromEntries(new FormData(form));fd.entityKey=fd.entityName;fd.dueAt=fd.dueAt?`${fd.dueAt}T18:00:00+05:30`:null;const b=form.querySelector('button');U.setButtonBusy(b,true,'Saving…');try{await FF.auth.api('/api/workspace/notes','POST',fd);mem.workspace=null;FF.app.closeDrawer();renderFollowups(root,params);U.toast('Follow-up saved ✓','ok');}catch(err){U.toast(err.message,'err');}finally{U.setButtonBusy(b,false);}});};
    U.$('#note-new',root).addEventListener('click',openForm);
    root.onclick = async(e)=>{const sb=e.target.closest('[data-note-status]');if(sb){U.setButtonBusy(sb,true,'Saving…');try{await FF.auth.api(`/api/workspace/notes/${encodeURIComponent(sb.dataset.id)}`,'PATCH',{status:sb.dataset.noteStatus});mem.workspace=null;renderFollowups(root,params);}catch(err){U.toast(err.message,'err');}return;}const ob=e.target.closest('[data-note-open]');if(ob){const n=all.find(x=>x.id===ob.dataset.noteOpen);if(!n)return;FF.app.openDrawer({kicker:`${n.entityType} · ${n.channel}`,title:n.entityName,sub:`${n.status} · ${n.priority} priority`,actions:n.createdBy===FF.auth.user.username||FF.auth.isAdmin()?`<button class="btn small danger" id="note-delete">Delete</button>`:'',body:`<div class="note-full">${esc(n.text)}</div><h3 class="drawer-section-title">Timeline</h3><div class="note-history">${(n.timeline||[]).slice().reverse().map(t=>`<div><i></i><p><b>${esc(t.action)}</b><span>${esc(t.by)} · ${esc(dateTimeText(t.at))}</span>${t.detail?`<small>${esc(t.detail)}</small>`:''}</p></div>`).join('')}</div>`});const del=U.$('#note-delete');if(del)del.onclick=async()=>{if(!confirm('Is note ko permanently delete karein?'))return;try{await FF.auth.api(`/api/workspace/notes/${encodeURIComponent(n.id)}`,'DELETE');mem.workspace=null;FF.app.closeDrawer();renderFollowups(root,params);}catch(err){U.toast(err.message,'err');}};}};
  }

  function reset() { mem.details = null; mem.detailsPromise = null; mem.cross = null; mem.quality = null; mem.workspaceVersion++; mem.workspace = null; mem.workspacePromise = null; mem.forecastHistory = null; mem.forecastHistoryPromise = null; }

  FF.pages.executive = { title: 'Executive Cockpit', render: renderExecutive };
  FF.pages.gvCommission = { title: 'GV Commission', render: renderGvCommission };
  FF.pages.ffCommission = { title: 'FF Commission', render: renderFfCommission };
  FF.pages.dualChannel = { title: 'Dual-channel Agents', render: renderDualChannel };
  FF.pages.forecast = { title: 'Stock Forecast', render: renderForecast };
  FF.pages.dataQuality = { title: 'Data Quality', render: renderDataQuality };
  FF.pages.savedViews = { title: 'Saved Views', render: renderSavedViews };
  FF.pages.reportStudio = { title: 'Report Studio', render: renderReportStudio };
  FF.pages.followups = { title: 'Notes & Follow-ups', render: renderFollowups };
  FF.workspace = { openSave, load: workspace, reset };
  FF.insights = { reset, loadDetails, buildCross, ffCommissionData, qualityIssues, forecastAccuracy, stockBalanceReconciliation, commissionSlabExpected: slabExpected };
})(window.FF);
