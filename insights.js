/* Professional intelligence layer: commission analytics, verified dual-channel identity,
   stock forecasting, data-quality checks, management cockpit and collaborative workspace. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, D = FF.data, S = FF.store, G = FF.gv, M = FF.model, C = FF.charts;
  const esc = U.esc, clean = U.clean;
  const mem = { details: null, detailsPromise: null, cross: null, quality: null, workspace: null, workspacePromise: null, workspaceVersion: 0, forecastHistory: null, forecastHistoryPromise: null, payout: null, payoutPromise: null };

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
  // Colourful KPI card. `tone` = 'g1'…'g12' → vivid gradient (same palette as the main dashboard),
  // 'good' / 'bad' → compact coloured accent. `icon` optional emoji chip (only with gradient tones).
  const metric = (label, value, foot, tone, icon) => {
    const vivid = /^g(?:[1-9]|1[0-2])$/.test(String(tone || ''));
    return `<div class="ins-metric ${vivid ? '' : (tone || '')}"${vivid ? ` data-tone="${tone}"` : ''}>${vivid && icon ? `<span class="ins-metric-icon" aria-hidden="true">${icon}</span>` : ''}<small>${esc(label)}</small><b>${value}</b><span>${foot || '&nbsp;'}</span></div>`;
  };
  // Vivid KPI row: takes [{ label, value, foot, tone, icon }] and renders colourful cards.
  const vividMetrics = (cards, extraClass) => `<div class="ins-metrics ${extraClass || ''}">${cards.map((c) => metric(c.label, c.value, c.foot, c.tone, c.icon)).join('')}</div>`;
  /** Readable number inside a KPI / table cell with the unit in small type. */
  const unitNum = (value, unit) => `${value}${unit ? ` <small>${esc(unit)}</small>` : ''}`;
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
  /** Shared modal table (metric details, findings samples, heading maps…). */
  function openInsDialog(root, title, headers, rows, note) {
    const old = root.querySelector('#metric-detail-dialog'); if (old) old.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'metric-detail-dialog'; dialog.className = 'ins-detail-dialog';
    const cell = (v) => { const text = String(v ?? '—'); return text.length > 400 ? `${text.slice(0, 400)}…` : text; };
    dialog.innerHTML = `<div class="card-head"><h3>${esc(title)}</h3><button class="btn small" data-close>Close</button></div><p class="dim small">${esc(note || '')} · ${U.fmt(rows.length)} rows${rows.length > 500 ? ' · first 500 shown' : ''}</p><div class="table-wrap"><table class="data-table ins-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 500).map((r) => `<tr>${r.map((v) => `<td>${esc(cell(v))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}">No rows available</td></tr>`}</tbody></table></div>`;
    root.append(dialog);
    const close = dialog.querySelector('[data-close]'); if (close) close.onclick = () => dialog.close();
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    return dialog;
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
  // The REPORT tab is the user's own sheet, so the commission source can be a *column letter*
  // (e.g. BZ) or a *heading name* (e.g. "Commission Rate") written in Settings → Data source.
  // Both are matched here; anything unclear is reported instead of silently guessing.
  const COMMISSION_HEADING_RE = /\bcomm(?:iss?ion|ision)?s?\b|\bcomm\.|\bpayout\b|\bearn(?:ed|ing|ings)?\b|\bincentive\b|\broyalty\b|\u20b9/i;
  const RATE_HEADING_RE = /(\brate\b|%|percent|per\s*tag|per\s*card|\bslab\b|\u20b9\s*\/\s*tag)/i;
  const AMOUNT_HEADING_RE = /(amount|amt|value|earned|earning|payout|payable|receivable|total|net|sum|inr|rs\.?)/i;
  const FF_COMMISSION_FIELDS = [['rateCol', 'Commission rate'], ['earnedCol', 'Earned commission'], ['categoryCol', 'Agent category'], ['dateCol', 'Commission date']];

  async function ffCommissionData() {
    await FF.pages.performance.ensureLoaded();
    const mapping = FF.config.ffCommission || {};
    /** One gviz table → REPORT ke section/sub-heading + commission-like columns. */
    const buildHeads = (tbl) => {
      let rws = tbl.rows || [];
      // Production gviz: REPORT ki row 1 (sections) column labels me chali jaati hai aur rows row 2
      // se shuru hote hain. 2-header REPORT me (section, sub) ka alignment theek rakhne ke liye wahi
      // labels row wapas prepend karo — warna "Commission Rate" (AB2) section ki jagah data row me
      // dhoondhi jaati thi. Mock/local tables (labels khali) par koi change nahi hota.
      const colLabels = (tbl.cols || []).map((c) => ({ v: clean((c && c.label) || '') }));
      const labelsAreSections = (tbl.cols || []).some((c) => /agent profile/i.test(c.label || '')) || (tbl.headers || 0) > 0;
      const rowsAlreadyHeaded = (rws[0] || []).some((cell) => /agent profile/i.test(D.cellText(cell)));
      if (labelsAreSections && !rowsAlreadyHeaded) rws = [colLabels, ...rws];
      // Header kahin aur ho (manual range row 2 se shuru) to 'Agent Profile' row tak trim karo.
      let startIdx = -1;
      for (let i = 0; i < Math.min(rws.length, 6); i++) if ((rws[i] || []).some((cell) => /agent profile/i.test(D.cellText(cell)))) { startIdx = i; break; }
      if (startIdx > 0) rws = rws.slice(startIdx);
      const sectionRaw = (rws[0] || []).map((c) => D.cellText(c));
      const subRaw = (rws[1] || []).map((c) => D.cellText(c));
      const width = Math.max(sectionRaw.length, subRaw.length, (tbl.cols || []).length);
      const section = []; let carry = '';
      for (let i = 0; i < width; i++) { if (clean(sectionRaw[i])) carry = clean(sectionRaw[i]); section[i] = carry; }
      const hdrs = Array.from({ length: width }, (_, i) => {
        const sec = clean(section[i]), sub = clean(subRaw[i]), col = clean(tbl.cols && tbl.cols[i] && tbl.cols[i].label);
        return { index: i, letter: U.colLetter(i), section: sec, sub, col, sectionOwn: clean(sectionRaw[i]), label: [sec, sub, col].filter(Boolean).join(' · '), own: clean(sectionRaw[i]) || sub };
      });
      return { rows: rws, headers: hdrs, width, candidates: hdrs.filter((h) => COMMISSION_HEADING_RE.test(h.label) || /\u20b9/.test(h.label)) };
    };
    /** Config me likhi value (letter ya heading) fetched columns me mili ya nahi. */
    const nameInHeads = (hdrs, value) => {
      const v = clean(value).toLowerCase(); if (!v) return true;
      const letter = clean(value).toUpperCase(); const isLetter = /^[A-Z]{1,3}$/.test(letter);
      return hdrs.some((h) => clean(h.label).toLowerCase().includes(v) || clean(h.sub).toLowerCase() === v || clean(h.section).toLowerCase() === v || clean(h.col).toLowerCase() === v || (isLetter && h.letter === letter && U.colIndex(letter) === h.index));
    };
    const trimTrailingEmpty = (tbl, b) => {
      // Wide range se aayi khaali columns hata do — warna heading map me 30-40 blank rows dikhte hain.
      const isEmptyAt = (idx) => {
        const h = b.headers[idx];
        if (h && (clean(h.sectionOwn) || clean(h.sub) || clean(h.col))) return false;
        for (let r = 2; r < b.rows.length; r++) {
          const row = b.rows[r]; if (!row) continue;
          const cell = row[idx]; if (cell !== undefined && cell !== null && cell !== '' && clean(D.cellText(cell))) return false;
        }
        return true;
      };
      let w = b.width;
      while (w > 1 && isEmptyAt(w - 1)) w--;
      if (w === b.width) return b;
      return { rows: b.rows, headers: b.headers.slice(0, w), width: w, candidates: b.candidates.filter((h) => h.index < w) };
    };
    const narrowTable = await S.need('report');
    let table = narrowTable;
    let built = buildHeads(table);
    const narrowWidth = built.width;
    // Kabhi REPORT ka range Settings me chhota set hota hai, ya commission column sheet me sabse right me
    // hota hai — aise me thoda zyada width dobara maang kar dekho, warna column chup-chaap chhoot jaata hai.
    const configuredAbsent = () => ['rateCol', 'earnedCol', 'categoryCol', 'dateCol'].some((k) => clean(mapping[k]) && !nameInHeads(built.headers, mapping[k]));
    if (!built.candidates.length || configuredAbsent()) {
      const cfg = (FF.config.sheetByName && FF.config.sheetByName('REPORT')) || null;
      const sheetName = (cfg && cfg.tab) || (FF.config.report && FF.config.report.sheet) || 'REPORT';
      const gid = (cfg && cfg.gid) || (FF.config.report && FF.config.report.gid) || '';
      const base = Math.max(built.width, 60);
      for (const extra of [24, 72]) {
        if (built.candidates.length && !configuredAbsent()) break;
        try {
          // fresh nahi: repeat open par cache se instantly mile (↻ refresh khud cache clear karta hai).
          const wide = await D.query(sheetName, '', { gid, range: `A1:${U.colLetter(base + extra - 1)}` });
          if (!wide || !wide.rows || !wide.rows.length) break;
          const alt = trimTrailingEmpty({ rows: wide.rows, rowCount: wide.rows.length }, buildHeads(wide));
          if (alt.candidates.length > built.candidates.length || alt.width > built.width) { table = wide; built = alt; }
          if (built.candidates.length) break;
        } catch (err) { break; /* wide fetch optional hai — mile hue table se hi aage badho */ }
      }
    }
    const rows = built.rows;
    const headers = built.headers;
    const width = built.width;
    const candidates = built.candidates;
    /** Configured value → heading. Accepts a column letter (BZ) or a heading name ("Commission Rate"). */
    // Heading naam ka matching whitespace/case-insensitive hai — "Earned   Commission" aur
    // "earned commission" dono ek hi heading pakadte hain (sheet ke headings me extra spaces common hain).
    const normKey = (text) => clean(text).replace(/\s+/g, ' ').trim().toLowerCase();
    const findByName = (value) => {
      const v = normKey(value); if (!v) return null;
      const has = (text) => normKey(text).includes(v);
      const letter = clean(value).toUpperCase();
      const eq = (h, key) => normKey(h[key]) === v;
      return (v.length >= 3 ? headers.find((h) => has(h.label) || has(h.sub) || has(h.col)) : null)
        || headers.find((h) => eq(h, 'label'))
        || headers.find((h) => eq(h, 'sub'))
        || headers.find((h) => eq(h, 'section'))
        || headers.find((h) => eq(h, 'col'))
        || headers.find((h) => clean(h.letter) === letter && /^[A-Z]{1,3}$/.test(letter))
        || null;
    };
    const mapped = (value, label) => {
      const raw = clean(value); if (!raw) return null;
      if (/^[A-Za-z]{1,3}$/.test(raw)) {
        const col = raw.toUpperCase(), index = U.colIndex(col);
        const found = headers[index] || headers.find((h) => h.letter === col);
        if (found) return { ...found, configured: true, via: 'letter', configuredRaw: raw };
        return { index: -1, letter: col, section: 'Configured mapping', sub: label, col: '', own: label, label: `${label} · configured ${col} (column REPORT me nahi mila)`, configured: true, via: 'letter', configuredRaw: raw, missing: true };
      }
      const found = findByName(raw);
      if (found) return { ...found, configured: true, via: 'name', configuredRaw: raw };
      return { index: -1, letter: '', section: 'Configured mapping', sub: label, col: '', own: label, label: `${label} · configured "${raw}" (ye heading REPORT me nahi mili)`, configured: true, via: 'name', configuredRaw: raw, missing: true };
    };
    const configRate = mapped(mapping.rateCol, 'Commission rate');
    const configAmount = mapped(mapping.earnedCol, 'Earned commission');
    const configCategory = mapped(mapping.categoryCol, 'Agent category');
    const configDate = mapped(mapping.dateCol, 'Commission date');
    // ---- rate / earned column chunav ------------------------------------------------------------------
    // REPORT me heading 2 rows me hoti hai: row 1 = section ("Commission (FF)"), row 2 = asli heading
    // ("Commission Rate"). Isliye row-2 heading ko sabse zyada weight milta hai, phir gviz ka column
    // label, phir row-1 section. Do columns ka naam ek jaisa ho to jisme values zyada hain wahi jeetta hai
    // (numericRatio), aur rate/earned dono ek hi column par claim na kar sake iske liye pair search hoti hai.
    const RATE_ROLE_RES = [/commission\s*(rate|%)/i, /comm\.?\s*(rate|%)/i, /^rate$/i, /^%$|percent/i, /rate\s*\/\s*tag/i, /per\s*tag/i];
    const AMOUNT_ROLE_RES = [/earned\s*commission/i, /^earned$/i, /commission\s*(amount|payable|payout|value)/i, /^payout$/i, /^incentive$/i, /commission\s*amount/i];
    const sampleRatio = (h) => {
      if (!h || h.index < 0) return 0;
      let filled = 0, numeric = 0;
      for (let r = 2; r < Math.min(rows.length, 160); r++) {
        const raw = clean(D.cellText((rows[r] || [])[h.index]));
        if (!raw) continue;
        filled++;
        if (validValue(U.num(raw))) numeric++;
      }
      return filled ? numeric / filled : 0;
    };
    const roleScore = (h, role) => {
      if (!h || h.index < 0) return -Infinity;
      const words = role === 'rate' ? RATE_ROLE_RES : AMOUNT_ROLE_RES;
      const sub = clean(h.sub), own = clean(h.sectionOwn), sec = clean(h.section), col = clean(h.col), label = clean(h.label);
      const hit = (text) => !!text && words.some((re) => re.test(text));
      const generic = role === 'rate' ? RATE_HEADING_RE.test(label) : (!RATE_HEADING_RE.test(label) && AMOUNT_HEADING_RE.test(label));
      const wrongSide = role === 'rate' ? (AMOUNT_ROLE_RES.some((re) => re.test(label)) && !RATE_ROLE_RES.some((re) => re.test(label))) : RATE_ROLE_RES.some((re) => re.test(label));
      let score = 0;
      if (hit(sub)) score += 100;            // row 2 heading exact role naam
      if (hit(col)) score += 70;
      if (hit(own) || hit(sec)) score += 55;
      if (hit(label)) score += 40;
      if (generic) score += 15;
      if (wrongSide) score -= 45;
      if (h.commissionLike) score += 10;
      score += Math.round(sampleRatio(h) * 20); // jisme values hain wahi preferred
      return score;
    };
    const pickPair = () => {
      const pool = candidates.filter((h) => h && h.index >= 0);
      if (!pool.length) return { rate: null, amount: null };
      if (pool.length === 1) {
        const only = pool[0];
        return roleScore(only, 'rate') >= roleScore(only, 'amount') ? { rate: only, amount: null } : { rate: null, amount: only };
      }
      let best = null;
      for (const a of pool) for (const b of pool) {
        if (a.index === b.index) continue;
        const total = roleScore(a, 'rate') + roleScore(b, 'amount');
        if (!best || total > best.total) best = { total, rate: a, amount: b };
      }
      // Ek hi commission-like column ho (ya pair ka score bura ho) to jo mile usko uske role me rakho.
      if (best && best.total <= 0) { const only = pool[0]; return roleScore(only, 'rate') >= roleScore(only, 'amount') ? { rate: only, amount: null } : { rate: null, amount: only }; }
      return best || { rate: null, amount: null };
    };
    const pair = pickPair();
    let rateCol = (configRate && !configRate.missing ? configRate : null) || pair.rate || configRate || null;
    let amountCol = (configAmount && !configAmount.missing ? configAmount : null) || pair.amount || configAmount || null;
    // Sheet me commission rate column AB (AB2 heading) me likha ho aur koi bhi heading match na ho —
    // phir bhi AB (index 27) me numeric rate values hon to usi ko rate column maano (screenshot-verified).
    if (!rateCol && headers[27] && sampleRatio(headers[27]) >= 0.15) {
      rateCol = { ...headers[27], via: 'ab-fallback', fallback: true };
    }
    if (rateCol && amountCol && rateCol.index === amountCol.index) {
      const other = candidates.find((h) => h.index !== rateCol.index && roleScore(h, 'amount') > -Infinity);
      amountCol = configAmount && !configAmount.missing ? amountCol : (other || null);
      if (rateCol.index === (amountCol && amountCol.index)) rateCol = null;
    }
    const categoryCol = (configCategory && !configCategory.missing ? configCategory : null) || headers.find((h) => /(agent\s*(category|type)|business\s*category|channel|segment|network|payout\s*type)/i.test(h.label) && !/(tag|vehicle|vrn|serial)/i.test(h.label)) || null;
    const dateCol = (configDate && !configDate.missing ? configDate : null) || headers.find((h) => /^(date|period|month|report date|commission date|payout date)$/i.test(clean(h.sub || h.label))) || null;
    // Rate ka unit heading se aur actual values se dono tarah verify hota hai — "2%" wali rate ko
    // per-tag maan kar galat payout calculate karna kabhi nahi chahiye.
    const rateSamples = rateCol && rateCol.index >= 0 ? rows.slice(2, 80).map((r) => clean(D.cellText(r[rateCol.index]))).filter(Boolean) : [];
    const percentSamples = rateSamples.filter((v) => /%/.test(v)).length;
    const rateIsPercent = !!(rateCol && !rateCol.missing && ((percentSamples > 0 && percentSamples >= rateSamples.length / 2) || (/(%|percent)/i.test(rateCol.label) && !/\u20b9/.test(rateCol.label))));
    const agents = FF.pages.performance.agents().map((a) => {
      const cell = (col) => (col && col.index >= 0 ? clean(a.raw[col.index]) : '');
      const rateRaw = cell(rateCol), amountRaw = cell(amountCol), dateRaw = cell(dateCol);
      const date = dateRaw ? U.parseDate(dateRaw) : null;
      const rateValue = U.num(rateRaw);
      const earned = U.num(amountRaw);
      const tags = Number(a.curTotal || 0);
      // Rate × tags sirf tab dikhaya jata hai jab rate per-tag lage aur sheet me earned amount na ho.
      const computed = (!rateIsPercent && validValue(rateValue) && rateValue > 0 && tags > 0) ? rateValue * tags : null;
      // Column table ke andar mila lekin row (agent) ke raw cells range se bahar hain → Settings me
      // REPORT ka range chhota set hai, values ke liye range bada karna padega.
      const outOfRange = !!(rateCol && rateCol.index >= 0 && rateCol.index >= narrowWidth && (!a.raw || a.raw[rateCol.index] === undefined));
      return { ...a, segment: segmentOf(a), rateRaw, rateValue, amountRaw, earned, computed, outOfRange, sourceCategory: cell(categoryCol), dateRaw, date };
    });
    const warnings = FF_COMMISSION_FIELDS.map(([key, label]) => {
      const raw = clean(mapping[key]); if (!raw) return null;
      const resolved = { rateCol: configRate, earnedCol: configAmount, categoryCol: configCategory, dateCol: configDate }[key];
      return resolved && !resolved.missing ? null : { key, label, value: raw, message: `Settings me set "${raw}" REPORT me nahi mila — isliye auto-detection use ho rahi hai.` };
    }).filter(Boolean);
    const populatedAmount = agents.filter((a) => validValue(a.earned)).length;
    const populatedRate = agents.filter((a) => validValue(a.rateValue)).length;
    const headingRoles = new Map();
    [[rateCol, 'Commission rate'], [amountCol, 'Earned commission'], [categoryCol, 'Agent category'], [dateCol, 'Commission date']].forEach(([h, role]) => { if (h && h.index >= 0) headingRoles.set(h.index, role); });
    const headingRows = headers.map((h) => ({ ...h, role: headingRoles.get(h.index) || '', commissionLike: COMMISSION_HEADING_RE.test(h.label) || /\u20b9/.test(h.label), configured: [configRate, configAmount, configCategory, configDate].some((c) => c && c.index === h.index) }));
    const outOfRange = agents.filter((a) => a.outOfRange).length;
    const needsWiderRange = table !== narrowTable && outOfRange > 0 && outOfRange >= agents.length / 2;
    return { table, headers: headingRows, candidates, rateCol, amountCol, categoryCol, dateCol, agents, warnings, rateIsPercent, configRate, configAmount, populatedAmount, populatedRate, lastColLetter: U.colLetter(Math.max(0, width - 1)), narrowWidth, wideUsed: table !== narrowTable, needsWiderRange, outOfRange, map: mapping };
  }

  // ---- FF payout sheet · class-wise commission rate + penalty -------------------------------------
  // FF Google Sheet ki "payout" tab (Settings → Data source se naam/columns badal sakte hain).
  // Har class ka ₹ commission rate aur penalty yahin se padha jaata hai; expected commission isi se
  // banta hai (REPORT ki AB2 "Commission Rate" alag, sheet-reported rate hai).
  const payoutClassToken = (raw) => {
    const t = clean(raw).toUpperCase().replace(/[^A-Z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || /^(NA|N A|TOTAL|GRAND TOTAL|SLAB|PARTICULARS|ITEM|DESCRIPTION)$/.test(t)) return null;
    const group = (exact) => (exact === 'VC4' ? 'VC4' : exact === 'VC20' ? 'VC20' : 'VC5+');
    const make = (exact) => ({ exact, group: group(exact) });
    if (/\bVC?5\s*\+|5\s*AND\s*ABOVE|5\s*PLUS|ABOVE\s*5/.test(t)) return make('VC5+');
    if (/\bN\s*V\s*C\s*4\b|COMMERCI|HEAVY\s*VEHICLE|\bCV\b/.test(t)) return make('VC5+');
    const num = t.match(/\b(?:VC|CLASS)?\s*(\d{1,2})\b/);
    if (num) {
      const n = Number(num[1]);
      if (n === 4) return make('VC4');
      if (n === 20) return make('VC20');
      if ([5, 6, 7, 12, 16].includes(n)) return make(`VC${n}`);
    }
    if (/CAR|JEEP|VAN|\bLMV\b|TAXI|PASSENGER/.test(t)) return make('VC4');
    if (/\bLCV\b|LIGHT\s*COMM/.test(t)) return make('VC20');
    if (/\bBUS\b|2\s*AXLE/.test(t)) return make('VC5');
    if (/HCM|\bEME\b|SPECIAL/.test(t)) return make('VC16');
    if (/7\s*\+?\s*AXLE|MULTI\s*AXLE/.test(t)) return make('VC12');
    if (/\bTRUCK\b|6\s*AXLE/.test(t)) return make('VC6');
    if (/4\s*-?\s*6\s*AXLE/.test(t)) return make('VC7');
    return null;
  };
  const payoutPenaltyLabel = (label) => {
    const t = clean(label).toUpperCase().replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (/WRONG\s*VRN|VRN\s*WRONG|GALAT\s*VRN/.test(t)) return 'wrong-vrn';
    if (/REPLAC|REISSUE/.test(t)) return 'replacement';
    if (/CHASSIS/.test(t)) return 'chassis';
    if (/PENALT|FINE|DEDUCT|CUT|CHARGE|LOSS|WRONG/.test(t)) return t.slice(0, 60);
    return '';
  };
  async function loadPayoutRates(fresh) {
    if (mem.payout && !fresh) return mem.payout;
    if (mem.payoutPromise && !fresh) return mem.payoutPromise;
    const cfg = FF.config.ffPayout || {};
    const tabName = clean(cfg.sheet) || 'payout';
    mem.payoutPromise = (async () => {
      let table;
      try {
        // limit 150: rates sheet chhoti hoti hai — fallback par bhi koi bada tab download nahi hota.
        table = await D.query(tabName, 'select * limit 150', { gid: clean(cfg.gid) || '' });
      } catch (err) {
        return { found: false, tab: tabName, rows: [], penaltyRows: [], byClass: new Map(), byGroup: new Map(), error: err.message || 'Payout tab load nahi hui' };
      }
      const labels = (table.cols || []).map((c) => clean((c && c.label) || ''));
      const bodyRows = D.textRows(table);
      const mat = [labels, ...bodyRows.slice(0, 60)];
      const RE = { cls: /class|vehicle|category|segment/i, label: /particular|description|item|detail|slab|type|name|fee|charge/i, rate: /comm|rate|payout|earning|incentive|royalt|₹|\brs\b|per\s*tag|amount/i, penalty: /penalt|fine|deduct|cut|loss|charge/i, note: /note|remark|comment/i };
      let hIdx = -1, roles = null;
      for (let i = 0; i < mat.length; i++) {
        const row = mat[i] || [];
        const role = { label: -1, cls: -1, rate: -1, penalty: -1, note: -1 };
        row.forEach((cell, ci) => {
          const t = clean(cell);
          if (!t || t.length > 60) return;
          const isPenalty = RE.penalty.test(t);
          if (RE.cls.test(t) && role.cls < 0) role.cls = ci;
          if (RE.rate.test(t) && !isPenalty && role.rate < 0) role.rate = ci;
          if (isPenalty && role.penalty < 0) role.penalty = ci;
          if (RE.label.test(t) && !RE.cls.test(t) && !RE.rate.test(t) && role.label < 0) role.label = ci;
          if (RE.note.test(t) && role.note < 0) role.note = ci;
        });
        if (role.cls >= 0 && (role.rate >= 0 || role.penalty >= 0)) { hIdx = i; roles = role; break; }
      }
      if (hIdx < 0) return { found: false, tab: tabName, rows: [], penaltyRows: [], byClass: new Map(), byGroup: new Map(), error: 'Payout tab me class + commission/penalty columns nahi mile (structure recognize nahi hua — Settings me column mapping set karein)' };
      const numVal = (v) => { const raw = clean(v); if (!raw) return { value: null, percent: false }; return { value: U.num(raw), percent: /%/.test(raw) }; };
      const rows = [], penaltyRows = [], byClass = new Map(), byGroup = new Map();
      const colLetter = (i) => U.colLetter(i);
      mat.slice(hIdx + 1).forEach((row) => {
        const label = roles.label >= 0 ? clean(row[roles.label]) : '';
        const clsRaw = roles.cls >= 0 ? clean(row[roles.cls]) : '';
        const rateRaw = roles.rate >= 0 ? clean(row[roles.rate]) : '';
        const penRaw = roles.penalty >= 0 ? clean(row[roles.penalty]) : '';
        const note = roles.note >= 0 ? clean(row[roles.note]) : '';
        const rate = numVal(rateRaw), penalty = numVal(penRaw);
        const token = payoutClassToken(clsRaw || label);
        const penKey = payoutPenaltyLabel([label, clsRaw].join(' '));
        if (token) {
          const rec = { label: label || clsRaw, cls: clsRaw, exact: token.exact, group: token.group, rate: rate.value, ratePercent: rate.percent, penalty: penalty.value, note, raw: row };
          rows.push(rec);
          if (!byClass.has(rec.exact) || (!validValue(byClass.get(rec.exact).rate) && validValue(rec.rate))) byClass.set(rec.exact, rec);
          if (rec.exact === rec.group && (!byGroup.has(rec.group) || (!validValue(byGroup.get(rec.group).rate) && validValue(rec.rate)))) byGroup.set(rec.group, rec);
        } else if (penKey && (validValue(rate.value) || validValue(penalty.value))) {
          penaltyRows.push({ key: penKey, label: label || clsRaw, rate: rate.value, penalty: penalty.value, note, raw: row });
        } else if (label && (validValue(rate.value) || validValue(penalty.value)) && /penalt|fine|deduct|wrong|charge|cut/i.test(label)) {
          penaltyRows.push({ key: penKey || clean(label).toLowerCase().slice(0, 40), label, rate: rate.value, penalty: penalty.value, note, raw: row });
        }
      });
      const headers = labels.map((l, i) => ({ letter: colLetter(i), label: l, role: Object.entries(roles).find(([, v]) => v === i)?.[0] || '' }));
      const found = rows.length > 0 || penaltyRows.length > 0;
      return { found, tab: tabName, headers, rows, penaltyRows, byClass, byGroup, headerRow: hIdx + 1, error: found ? '' : 'Payout tab me koi rate row nahi mili' };
    })().catch((err) => ({ found: false, tab: tabName, rows: [], penaltyRows: [], byClass: new Map(), byGroup: new Map(), error: err.message || 'Payout tab parse nahi hui' }));
    const out = await mem.payoutPromise;
    mem.payout = out;
    mem.payoutPromise = null;
    return out;
  }
  /** Payout-sheet rate for one exact class — exact row pehle, phir group (VC5+) rate. */
  function payoutRateOf(payout, exact) {
    const e = payout.byClass && payout.byClass.get(exact);
    if (e && validValue(e.rate)) return e.rate;
    const g = payout.byGroup && payout.byGroup.get(exact === 'VC4' ? 'VC4' : exact === 'VC20' ? 'VC20' : 'VC5+');
    return g && validValue(g.rate) ? g.rate : null;
  }
  /**
   * Agent ka expected commission = class-wise counts × payout-sheet rates − penalty lines.
   * Counts: REPORT curVc4 + curC1..C5 (VC5/VC6/VC7/VC12/VC16); VC20 EIR bins (curBins) se,
   * warna (NVC4 − VC5+ exact classes) se derive hota hai. Kabhi average nahi — sirf exact sums.
   */
  function payoutBreakdown(agent, payout) {
    const bins = agent.curBins || null;
    const exacts = { VC4: Math.round(agent.curVc4 || 0), VC5: Math.round(agent.curC1 || 0), VC6: Math.round(agent.curC2 || 0), VC7: Math.round(agent.curC3 || 0), VC12: Math.round(agent.curC4 || 0), VC16: Math.round(agent.curC5 || 0) };
    const exactSum5p = exacts.VC5 + exacts.VC6 + exacts.VC7 + exacts.VC12 + exacts.VC16;
    const vc20Count = bins ? Math.round(bins.VC20 || 0) : Math.max(0, Math.round((agent.curNvc4 || 0) - exactSum5p));
    const extra5p = bins ? Math.max(0, Math.round((bins['VC5+'] || 0) - exactSum5p)) : 0;
    const lines = [], missing = [];
    const add = (cls, n, rate) => { if (!n) return; if (!validValue(rate)) { missing.push(cls); return; } lines.push({ cls, n, rate, amount: n * rate }); };
    add('VC4', exacts.VC4, payoutRateOf(payout, 'VC4'));
    add('VC20', vc20Count, payoutRateOf(payout, 'VC20'));
    ['VC5', 'VC6', 'VC7', 'VC12', 'VC16'].forEach((c) => add(c, exacts[c], payoutRateOf(payout, c)));
    if (extra5p) add('VC5+ (other)', extra5p, payoutRateOf(payout, 'VC5+'));
    const gross = lines.reduce((n, l) => n + l.amount, 0);
    const penaltyLines = [];
    (payout.penaltyRows || []).forEach((p) => {
      const rate = validValue(p.penalty) ? p.penalty : (validValue(p.rate) ? p.rate : null);
      if (!validValue(rate)) return;
      if (p.key === 'wrong-vrn' || /wrong\s*vrn/i.test(p.label || '')) {
        const n = Math.round(agent.wrongVrn || 0);
        if (n) penaltyLines.push({ label: p.label || 'Wrong VRN', n, rate, amount: n * rate });
      }
    });
    const penalty = penaltyLines.reduce((n, l) => n + l.amount, 0);
    return { lines, gross, penaltyLines, penalty, expected: lines.length ? gross - penalty : null, missing, complete: lines.length > 0 && !missing.length };
  }
  /** "Payout vs sheet" cell — expected − (earned ya rate × tags). */
  function payoutDiffCell(r) {
    const c = r.payoutCalc;
    const base = validValue(r.earned) ? r.earned : (validValue(r.computed) ? r.computed : null);
    if (!c || c.expected === null || !validValue(base)) return '<span class="dim">—</span>';
    const diff = c.expected - base;
    return statusPill(`${diff > 0 ? '+' : ''}${money(diff, 2)}`, Math.abs(diff) <= 1 ? 'green' : diff > 0 ? 'amber' : 'red');
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
      mapAdd(map, key, () => ({ key, label: key.includes('|') ? key.split('|')[1] || key.split('|')[0] : key, id: key.includes('|') ? key.split('|')[0] : '', agentLabel: r.agentName || r.agentId || 'Unknown agent', tlName: r.tlName || '', classLabel: r.cls || 'NA', issuances: 0, uniqueTags: 0, tagSet: new Set(), amount: 0, commission: 0, commissionRows: 0, commissionPopulatedRows: 0, agents: new Set(), classes: {}, direct: 0, managed: 0 }), (o) => {
        o.issuances++; o.amount += r.amount || 0; o.commission += r.commission || 0; o.commissionRows++; if (r.commissionHasValue === true) o.commissionPopulatedRows++; o.agents.add(r.agentId || r.agentName); o.tagSet.add(normBarcode(r.tagId || r.serial || '') || `#${o.issuances}`);
        o.classes[r.cls || 'NA'] = (o.classes[r.cls || 'NA'] || 0) + 1;
        if (directAgent(r)) o.direct++; else o.managed++;
      });
    });
    let out = [...map.values()].map((o) => ({ ...o, agentCount: o.agents.size, uniqueTags: o.tagSet.size, commissionComplete: o.commissionRows > 0 && o.commissionRows === o.commissionPopulatedRows, perTag: (o.commissionPopulatedRows || o.issuances) ? o.commission / (o.commissionPopulatedRows || o.issuances) : 0, avgAmount: o.issuances ? o.amount / o.issuances : 0, effectiveRate: ratePct(o.commission, o.amount) }));
    if (group === 'weekday') { const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Invalid date']; out.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label)); }
    else if (group === 'day') out.sort((a, b) => b.label.localeCompare(a.label));
    else out.sort((a, b) => b.commission - a.commission || b.issuances - a.issuances);
    return out;
  }

  /**
   * Agent × class commission matrix — har agent ke liye VC4 / VC20 / VC5+ ka commission ALAG
   * (exact sum). Koi blended average nahi; VC5+ ke andar exact class (VC5/VC6/…) split bhi.
   * Unique tags = distinct tag/serial count (duplicate sheet rows pakadne ke liye).
   * Rate (₹/tag) = sheet commission column se: sum(commission) ÷ jis row me value hai (paid rows).
   */
  function gvClassMatrix(rows) {
    const blank = () => ({ tags: 0, paid: 0, unique: 0, amount: 0, commission: 0, rate: null, tagSet: new Set() });
    const map = new Map();
    rows.forEach((r) => {
      const key = `${r.agentId || ''}|${r.agentName || 'Unknown agent'}`;
      const g = r.group || (G.classGroup ? G.classGroup(r.cls) : r.cls) || 'NA';
      const slot = ['VC4', 'VC20', 'VC5+'].includes(g) ? g : 'VC5+';
      mapAdd(map, key, () => ({ label: r.agentName || r.agentId || 'Unknown agent', id: r.agentId || '', tlName: r.tlName || '', VC4: blank(), VC20: blank(), 'VC5+': blank(), exact: {}, totalCommission: 0, totalPaid: 0, totalTags: 0, rate: null }), (o) => {
        const s = o[slot];
        s.tags++; s.amount += r.amount || 0; s.commission += r.commission || 0;
        if (r.commissionHasValue === true) { s.paid++; o.totalPaid++; }
        s.tagSet.add(normBarcode(r.tagId || r.serial || '') || `#${s.tags}`);
        o.totalCommission += r.commission || 0; o.totalTags++;
        const cls = r.cls || 'NA';
        const e = o.exact[cls] || (o.exact[cls] = { tags: 0, paid: 0, commission: 0, rate: null });
        e.tags++; e.commission += r.commission || 0;
        if (r.commissionHasValue === true) e.paid++;
      });
    });
    return [...map.values()].map((o) => {
      ['VC4', 'VC20', 'VC5+'].forEach((g) => { o[g].unique = o[g].tagSet.size; delete o[g].tagSet; o[g].rate = o[g].paid > 0 ? o[g].commission / o[g].paid : null; });
      Object.values(o.exact).forEach((v) => { v.rate = v.paid > 0 ? v.commission / v.paid : null; });
      o.rate = o.totalPaid > 0 ? o.totalCommission / o.totalPaid : null;
      o.vc5Exact = Object.entries(o.exact).filter(([cls]) => cls !== 'VC4' && cls !== 'VC20').sort((a, b) => b[1].commission - a[1].commission || b[1].tags - a[1].tags);
      return o;
    }).sort((a, b) => b.totalCommission - a.totalCommission || b.totalTags - a.totalTags);
  }

  // ---- GV commission · separate board per vehicle class (VC4 / VC20 / VC5+) ----------------------
  // Class group GV Master ke `group` field se aata hai (VC4 · VC20 · VC5+), isliye VC5/VC12/VC16
  // sab "VC5+" board me aate hain aur exact class breakdown board ke andar dikhta hai.
  const GV_CLASS_BOARDS = [
    { key: 'VC4', tone: 'vc4', icon: '🚗', title: 'VC4 · Car / Jeep', note: 'Payable VC4 tags' },
    { key: 'VC20', tone: 'vc20', icon: '🚚', title: 'VC20 · Light commercial', note: 'VC20 commercial tags' },
    { key: 'VC5+', tone: 'vc5p', icon: '🚛', title: 'VC5+ · Commercial (VC5, VC12, VC16…)', note: 'Bulk commercial tags' }
  ];
  const classBoardId = (key) => `gvc-class-${String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase()}`;
  const GV_CLASS_HEADERS = ['#', 'Agent', 'Agent ID', 'TL / Direct', 'Tags', 'Amount', 'Commission', 'Commission / tag', 'Effective rate %', 'Share of class %'];

  function gvClassBoard(def, rows, totals) {
    const agents = aggregateGv(rows, 'agent');
    const amount = sum(rows, (r) => r.amount);
    const commission = sum(rows, (r) => r.commission);
    const populated = rows.filter((r) => r.commissionHasValue === true).length;
    const share = totals.commission ? (commission / totals.commission) * 100 : 0;
    const perTag = rows.length ? commission / rows.length : 0;
    const exact = [...new Set(rows.map((r) => r.cls).filter(Boolean))].sort();
    const uniqueAll = new Set(rows.map((r) => normBarcode(r.tagId || r.serial || '')).filter(Boolean)).size || rows.length;
    const csvId = classBoardId(def.key);
    const head = `<div class="board-head"><span class="board-icon">${def.icon}</span><div><h3>${esc(def.title)}</h3><div class="board-sub">${esc(def.note)}${exact.length ? ` · sheet classes: ${esc(exact.join(', '))}` : ''}</div></div><div class="board-stats">
      <div><small>Tags (unique)</small><b>${U.fmt(rows.length)}${uniqueAll !== rows.length ? ` <small class="dim">/ ${U.fmt(uniqueAll)}</small>` : ''}</b></div>
      <div><small>Agents</small><b>${U.fmt(agents.length)}</b></div>
      <div><small>Commission (sum)</small><b>${money(commission, 2)}</b></div>
      <div><small>₹ / tag (avg)</small><b>${money(perTag, 2)}</b></div>
      <div><small>Share</small><b>${share.toFixed(1)}%</b></div>
    </div></div>`;
    if (!rows.length) return `<div class="class-board tone-${def.tone}">${head}<div class="board-body">${empty(`${def.title} · koi row nahi`, 'Selected period / network filter me is class ka koi issuance nahi hai.')}</div></div>`;
    const body = agents.map((r, i) => {
      const rowClass = r.issuances >= 3 && r.perTag <= 0 ? ' class="dup-row"' : '';
      return `<tr${rowClass}><td>${i + 1}</td><td><b class="agent-link" data-agent360="${esc(r.agentLabel || r.label)}" data-agent360-id="${esc(r.id || '')}" title="Agent 360 kholo">${esc(r.agentLabel || r.label)}</b>${directAgent(r) ? `<small>Direct agent</small>` : ''}</td><td>${esc(r.id || '—')}</td><td>${esc(r.tlName || 'Direct / Unmapped')}</td><td class="num"><span class="tag-count">${U.fmt(r.issuances)}</span></td><td class="num">${money(r.amount, 2)}</td><td class="num"><b>${money(r.commission, 2)}</b></td><td class="num">${money(r.perTag, 2)}</td><td class="num">${r.effectiveRate.toFixed(2)}%</td><td class="num">${commission ? ((r.commission / commission) * 100).toFixed(1) : '0.0'}%</td></tr>`;
    }).join('');
    const foot = `<tr class="row-total"><td colspan="4">Class total · ${esc(def.key)}</td><td class="num">${U.fmt(rows.length)}</td><td class="num">${money(amount, 2)}</td><td class="num">${money(commission, 2)}</td><td class="num">${money(perTag, 2)}</td><td class="num">${ratePct(commission, amount).toFixed(2)}%</td><td class="num">100.0%</td></tr>`;
    return `<div class="class-board tone-${def.tone}">${head}<div class="board-body">
      <div class="board-actions"><button class="btn small" id="${csvId}-csv">⬇ ${esc(def.key)} agent CSV</button><span class="dim small">${U.fmt(populated)}/${U.fmt(rows.length)} rows me sheet commission value present hai${populated < rows.length ? ' · baki rows blank (dashboard koi rate guess nahi karta)' : ''}</span></div>
      <div class="table-wrap"><table class="data-table ins-table" id="${csvId}-table"><thead><tr>${GV_CLASS_HEADERS.map((h, i) => `<th${i > 3 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>
    </div></div>`;
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
    const classTotals = { amount: totalAmount, commission: totalCommission, count: filtered.length };
    const boards = GV_CLASS_BOARDS.map((def) => ({ def, rows: filtered.filter((r) => (r.group || (G.classGroup ? G.classGroup(r.cls) : r.cls)) === def.key) }));
    const boardRowsFor = (def) => boards.find((b) => b.def.key === def.key) || { def, rows: [] };
    const matrix = gvClassMatrix(filtered);
    const gvGroupCommission = { VC4: sum(filtered.filter((r) => (r.group || (G.classGroup ? G.classGroup(r.cls) : r.cls)) === 'VC4'), (r) => r.commission), VC20: sum(filtered.filter((r) => (r.group || (G.classGroup ? G.classGroup(r.cls) : r.cls)) === 'VC20'), (r) => r.commission), 'VC5+': sum(filtered.filter((r) => !['VC4', 'VC20'].includes(r.group || (G.classGroup ? G.classGroup(r.cls) : r.cls))), (r) => r.commission) };
    const gvUniqueTotal = new Set(filtered.map((r) => normBarcode(r.tagId || r.serial || '')).filter(Boolean)).size;
    // Class-wise ₹/tag rate — GV Master commission column se (sum ÷ rows jisme value hai).
    const gvClassGroupOf = (r) => r.group || (G.classGroup ? G.classGroup(r.cls) : r.cls);
    const gvRateFor = (key) => {
      const list = filtered.filter((r) => (key === 'VC5+' ? !['VC4', 'VC20'].includes(gvClassGroupOf(r)) : gvClassGroupOf(r) === key));
      const paid = list.filter((r) => r.commissionHasValue === true).length;
      return paid ? sum(list, (r) => r.commission) / paid : null;
    };
    const gvRateHtml = (key) => { const rt = gvRateFor(key); return rt !== null ? `<small class="rate-line">${money(rt, 2)} / tag</small>` : '<small class="dim">rate —</small>'; };
    const classList = [...new Set(filtered.map((r) => r.cls || 'NA'))].map((cls) => {
      const list = filtered.filter((r) => (r.cls || 'NA') === cls);
      const top = aggregateGv(list, 'agent')[0];
      return { cls, group: G.classGroup ? G.classGroup(cls) : cls, tags: list.length, amount: sum(list, (r) => r.amount), commission: sum(list, (r) => r.commission), agents: new Set(list.map((r) => r.agentId)).size, top: top ? top.agentLabel : '—' };
    }).sort((a, b) => b.commission - a.commission || b.tags - a.tags);
    const actions = `${exportButtons('gvc-export')} ${printButton}`;
    root.innerHTML = head('₹', 'GV Commission Intelligence', 'GV Master se exact amount, issuance aur commission · VC4 / VC20 / VC5+ har class ka alag board, agent, TL/direct, date aur weekday analysis', actions) + `
      <div class="source-row">${sourceChip('GV Master', `${U.fmt(master.length)} parsed rows`)}<span class="dim small">No assumed rates — displayed earnings are the sheet's commission values.</span></div>
      <div class="ins-filters">
        <label>Period<select class="select" data-param="period">${[['today','Today'],['7','Last 7 days'],['15','Last 15 days'],['30','Last 30 days'],['month','Month'],['custom','Custom range']].map(([v,l]) => `<option value="${v}" ${v === period ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${period === 'custom' ? `<form id="gvc-date-range" class="ins-search"><input class="input" type="date" name="from" value="${esc(params.from||'')}"><input class="input" type="date" name="to" value="${esc(params.to||'')}"><button class="btn">Apply range</button></form>` : ''}
        ${period === 'month' ? `<label>Month<select class="select" data-param="month">${months.slice().reverse().map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(U.labelYM(m))}</option>`).join('')}</select></label>` : ''}
        <label>Breakdown<select class="select" data-param="group">${[['agent','Agent'],['tl','TL / Direct'],['class','Vehicle class'],['agentClass','Agent × class'],['weekday','Weekday'],['day','Date']].map(([v,l]) => `<option value="${v}" ${v === group ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Network<select class="select" data-param="segment"><option value="all">All</option><option value="direct" ${segment === 'direct' ? 'selected' : ''}>Direct Agents</option><option value="managed" ${segment === 'managed' ? 'selected' : ''}>TL-managed</option></select></label>
        <form id="gvc-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="Agent, TL, ID, class…"><button class="btn">Search</button></form>
      </div>
      ${vividMetrics([
        { label: 'Tag issuances', value: U.fmt(filtered.length), foot: `${U.fmt(new Set(filtered.map((r) => r.agentId)).size)} agents · ${activeDays ? (filtered.length / activeDays).toFixed(1) : '0'} / active day`, tone: 'g1', icon: '🏷️' },
        { label: 'Transaction amount', value: money(totalAmount), foot: `${money(filtered.length ? totalAmount / filtered.length : 0, 2)} / tag`, tone: 'g3', icon: '💳' },
        { label: 'Earned commission (exact sum)', value: money(totalCommission, 2), foot: `VC4 ${money(gvGroupCommission.VC4, 2)} · VC20 ${money(gvGroupCommission.VC20, 2)} · VC5+ ${money(gvGroupCommission['VC5+'], 2)} — koi average nahi`, tone: 'g5', icon: '💰' },
        { label: 'Effective commission rate', value: `${ratePct(totalCommission, totalAmount).toFixed(2)}%`, foot: 'Commission ÷ amount · descriptive, not an assumed tariff', tone: 'g8', icon: '📈' },
        { label: 'Class commission (VC4 / VC20 / VC5+)', value: `${money(gvGroupCommission.VC4, 0)} <small>/ ${money(gvGroupCommission.VC20, 0)} / ${money(gvGroupCommission['VC5+'], 0)}</small>`, foot: boards.map((b) => `${b.def.key} ${U.fmt(b.rows.length)} tags${(() => { const u = new Set(b.rows.map((r) => normBarcode(r.tagId || r.serial || '')).filter(Boolean)).size; return u && u !== b.rows.length ? ` (${U.fmt(u)} unique)` : ''; })()}`).join(' · '), tone: 'g6', icon: '🚗' },
        { label: 'Class commission variance flags', value: U.fmt(commissionAnomalies.length), foot: '±30% vs class median · min 3 tags per agent', tone: commissionAnomalies.length ? 'g7' : 'g9', icon: '🚨' }
      ])}
      <div class="card"><div class="card-head"><h3>🧮 Agent × class commission · VC4 / VC20 / VC5+ alag</h3><span class="dim small">Commission = sheet ka exact sum · <b>₹/tag rate = GV Master commission column se</b> (class-wise)${gvUniqueTotal && gvUniqueTotal !== filtered.length ? ` · ${U.fmt(filtered.length)} rows me ${U.fmt(gvUniqueTotal)} unique tags` : ''}</span><button class="btn small" id="gvc-matrix-csv">⬇ Matrix CSV</button></div>
        <div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-violet">Agent</th><th class="tone-violet">TL / Direct</th><th class="tone-violet num">VC4 tags</th><th class="tone-violet num">VC4 commission · rate</th><th class="tone-violet num">VC20 tags</th><th class="tone-violet num">VC20 commission · rate</th><th class="tone-violet num">VC5+ tags</th><th class="tone-violet num">VC5+ commission · rate</th><th class="tone-violet">VC5+ · exact class split</th><th class="tone-violet num">Total commission</th></tr></thead><tbody>
        ${matrix.map((m) => {
          const cell = (g) => `<td class="num">${U.fmt(m[g].tags)}${m[g].unique && m[g].unique !== m[g].tags ? `<small class="dim">${U.fmt(m[g].unique)} unique</small>` : ''}</td><td class="num"><b>${money(m[g].commission, 2)}</b>${m[g].rate !== null && m[g].rate !== undefined ? `<small class="rate-line">${money(m[g].rate, 2)} / tag</small>` : '<small class="dim">rate —</small>'}</td>`;
          return `<tr><td><b class="agent-link" data-agent360="${esc(m.label)}" data-agent360-id="${esc(m.id || '')}" title="Agent 360 kholo">${esc(m.label)}</b><small>${esc(m.id || '')}</small></td><td>${esc(m.tlName || 'Direct / Unmapped')}</td>${cell('VC4')}${cell('VC20')}${cell('VC5+')}<td class="small">${m.vc5Exact.length ? esc(m.vc5Exact.map(([cls, v]) => `${cls} ${money(v.commission, 0)}${v.rate !== null && v.rate !== undefined ? ` · ${money(v.rate, 1)}/tag` : ''}`).join(' · ')) : '<span class="dim">—</span>'}</td><td class="num"><b>${money(m.totalCommission, 2)}</b>${m.rate !== null && m.rate !== undefined ? `<small class="rate-line">${money(m.rate, 2)} / tag</small>` : ''}</td></tr>`;
        }).join('') || `<tr><td colspan="10">${empty('No matching rows', 'Filters change karke dekhein.')}</td></tr>`}
        </tbody>${matrix.length ? `<tfoot><tr class="row-total"><td colspan="2">Total · ${U.fmt(matrix.length)} agents</td><td class="num">${U.fmt(sum(matrix, (m) => m.VC4.tags))}</td><td class="num">${money(gvGroupCommission.VC4, 2)}${gvRateHtml('VC4')}</td><td class="num">${U.fmt(sum(matrix, (m) => m.VC20.tags))}</td><td class="num">${money(gvGroupCommission.VC20, 2)}${gvRateHtml('VC20')}</td><td class="num">${U.fmt(sum(matrix, (m) => m['VC5+'].tags))}</td><td class="num">${money(gvGroupCommission['VC5+'], 2)}${gvRateHtml('VC5+')}</td><td></td><td class="num">${money(totalCommission, 2)}</td></tr></tfoot>` : ''}</table></div>
      </div>
      <div class="card"><div class="card-head"><h3>🗂️ Class-wise commission summary</h3><span class="dim small">Exact sheet classes · selected period</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-slate">Vehicle class</th><th class="tone-slate">Board</th><th class="tone-slate num">Tags</th><th class="tone-slate num">Agents</th><th class="tone-slate num">Amount</th><th class="tone-slate num">Commission</th><th class="tone-slate num">₹ / tag</th><th class="tone-slate num">Effective rate</th><th class="tone-slate">Top agent</th></tr></thead><tbody>${classList.map((c) => `<tr><td><b>${esc(c.cls)}</b></td><td>${statusPill(c.group, c.group === 'VC4' ? 'blue' : c.group === 'VC20' ? 'amber' : '')}</td><td class="num">${U.fmt(c.tags)}</td><td class="num">${U.fmt(c.agents)}</td><td class="num">${money(c.amount, 2)}</td><td class="num"><b>${money(c.commission, 2)}</b></td><td class="num">${money(c.tags ? c.commission / c.tags : 0, 2)}</td><td class="num">${ratePct(c.commission, c.amount).toFixed(2)}%</td><td>${esc(c.top)}</td></tr>`).join('') || `<tr><td colspan="9">${empty('No commission rows', 'Filters change karke dekhein.')}</td></tr>`}</tbody><tfoot><tr class="row-total"><td colspan="2">All classes</td><td class="num">${U.fmt(filtered.length)}</td><td class="num">${U.fmt(new Set(filtered.map((r) => r.agentId)).size)}</td><td class="num">${money(totalAmount, 2)}</td><td class="num">${money(totalCommission, 2)}</td><td class="num">${money(filtered.length ? totalCommission / filtered.length : 0, 2)}</td><td class="num">${ratePct(totalCommission, totalAmount).toFixed(2)}%</td><td></td></tr></tfoot></table></div></div>
      <div class="card-head" style="padding:2px 2px 10px"><h3 style="margin:0">🚦 Class boards · agent-wise commission</h3><span class="dim small">VC4, VC20 aur VC5+ ka apna alag table · har board ka apna CSV</span></div>
      ${boards.map((b) => gvClassBoard(b.def, b.rows, classTotals)).join('')}
      <div class="split-cards">
        <div class="card"><div class="card-head"><h3>Direct Agents</h3>${statusPill(`${U.fmt(direct.length)} tags`, 'blue')}</div><div class="ins-big">${money(sum(direct, (r) => r.commission), 2)}</div><p class="dim">${U.fmt(new Set(direct.map((r) => r.agentId)).size)} agents · ${money(sum(direct, (r) => r.amount))} amount</p></div>
        <div class="card"><div class="card-head"><h3>TL-managed Agents</h3>${statusPill(`${U.fmt(managed.length)} tags`, 'green')}</div><div class="ins-big">${money(sum(managed, (r) => r.commission), 2)}</div><p class="dim">${U.fmt(new Set(managed.map((r) => r.agentId)).size)} agents · ${money(sum(managed, (r) => r.amount))} amount</p></div>
      </div>
      <div class="card slab-review"><div class="card-head"><h3>GV slab payout reconciliation · agent-wise</h3>${!FF.config.commissionSlabs || !FF.config.commissionSlabs.enabled ? statusPill('Slab comparison off', 'amber') : statusPill(`${U.fmt(gvSlabMismatches.length)} payout differences · ${U.fmt(gvSlabMissingActual)} agents missing actual`, gvSlabMismatches.length ? 'red' : 'green')}<button class="btn small" id="gvc-slab-csv">⬇ Slab detail CSV</button></div><p class="dim small">Selected-period agent issuance chooses the configured GV band. Expected payout = configured rate logic; compares only with commission actually present in GV Master.</p>${FF.config.commissionSlabs && FF.config.commissionSlabs.enabled ? `<div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Agent</th><th>TL</th><th>Tags</th><th>Slab / rate</th><th>Expected</th><th>Actual sheet commission</th><th>Actual − expected</th><th>Status</th></tr></thead><tbody>${gvSlabResults.filter((r)=>r.status!=='Matches slab').sort((a,b)=>Math.abs(b.variance||0)-Math.abs(a.variance||0)).map((r)=>`<tr><td><b>${esc(r.name)}</b><small>${esc(r.id)}</small></td><td>${esc(r.tl)}</td><td>${U.fmt(r.count)}</td><td>${esc(r.tier)}${r.rate!==undefined?` · ${money(r.rate,2)}/tag`:''}</td><td>${r.expected===null?'Rate not configured':money(r.expected,2)}</td><td>${r.actual===null?'Unavailable':money(r.actual,2)}</td><td>${r.variance===null?'—':`${r.variance>0?'+':''}${money(r.variance,2)}`}</td><td>${statusPill(r.status,r.status==='Less actual than slab'?'red':r.status==='More actual than slab'?'amber':'')}</td></tr>`).join('') || `<tr><td colspan="8">${empty('No slab differences', 'All comparable GV agent payouts match the configured expected amount.')}</td></tr>`}</tbody></table></div>` : `<div class="mapping-state"><b>Slab comparison is off.</b><span>Settings → Data source → Commission slabs me GV rates enter karein, phir comparison enable karein.</span></div>`}</div>
      <div class="card variance-card"><div class="card-head"><h3>Commission review · agent vs same-class benchmark</h3><button class="btn small" id="gvc-variance-csv">⬇ Variance CSV</button><span class="dim small">${classMedians.size ? 'Observed data only · not an official tariff' : 'Need at least 3 agents with 3+ tags in a class for peer baseline'}</span></div><p class="dim small">Flags agents whose observed commission per tag differs by at least 30% from the same-class median. This is a review signal—not proof of underpayment or an assumed commission rate.</p><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Agent</th><th>TL</th><th>Class</th><th>Tags</th><th>Observed / tag</th><th>Class median / tag</th><th>Difference</th><th>Peer variance amount</th></tr></thead><tbody>${commissionAnomalies.map((r)=>`<tr><td><b>${esc(r.agentLabel)}</b><small>${esc(r.id || '')}</small></td><td>${esc(r.tlName || 'Direct / Unmapped')}</td><td><b>${esc(r.classLabel)}</b></td><td>${U.fmt(r.issuances)}</td><td>${money(r.perTag,2)}</td><td>${money(r.benchmark,2)}</td><td>${statusPill(`${r.deviationPct>0?'+':''}${r.deviationPct.toFixed(1)}%`,r.deviationPct<0?'red':'amber')}</td><td>${money(r.varianceAmount,2)}</td></tr>`).join('') || `<tr><td colspan="8">${empty('No class-based variance flags', 'More class-agent samples may be needed. No reference tariff has been assumed.')}</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>${esc(group === 'weekday' ? 'Monday–Sunday commission pattern' : group === 'day' ? 'Day-wise commission' : `${group[0].toUpperCase() + group.slice(1)}-wise commission`)}</h3><span class="dim small">${U.fmt(grouped.length)} rows</span></div>
        <div class="table-wrap"><table class="data-table ins-table" id="gvc-table"><thead><tr>${group === 'agentClass' ? '<th>Agent</th><th>Vehicle class</th>' : `<th>${group === 'agent' ? 'Agent' : group === 'tl' ? 'TL / Direct' : group === 'class' ? 'Class' : group === 'weekday' ? 'Weekday' : 'Date'}</th>`}<th>Issuance</th><th>Amount</th><th>Commission</th><th>Commission / tag</th><th>Effective rate</th>${group === 'agentClass' ? '' : '<th>Class mix</th>'}</tr></thead><tbody>
        ${grouped.map((r) => `<tr>${group === 'agentClass' ? `<td><b class="agent-link" data-agent360="${esc(r.agentLabel)}" data-agent360-id="${esc(r.id || '')}" title="Agent 360 kholo">${esc(r.agentLabel)}</b><small>${esc(r.id || '')}</small></td><td><b>${esc(r.classLabel)}</b></td>` : `<td><b>${esc(group === 'day' ? dateText(`${r.label}T00:00:00`) : r.label)}</b>${r.id ? `<small>${esc(r.id)}</small>` : ''}</td>`}<td>${U.fmt(r.issuances)}</td><td>${money(r.amount, 2)}</td><td><b>${money(r.commission, 2)}</b></td><td>${money(r.perTag, 2)}</td><td>${r.effectiveRate.toFixed(2)}%</td>${group === 'agentClass' ? '' : `<td class="small">${esc(classMix(r.classes))}</td>`}</tr>`).join('') || `<tr><td colspan="${group === 'agentClass' ? 6 : 7}">${empty('No matching rows', 'Filters change karke dekhein.')}</td></tr>`}
        </tbody></table></div></div>`;
    U.$('#gvc-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    const gvClassRows = (list) => aggregateGv(list, 'agent').map((r, i) => [i + 1, r.agentLabel || r.label, r.id || '', r.tlName || 'Direct / Unmapped', r.issuances, r.amount, r.commission, r.perTag, r.effectiveRate, sum(list, (x) => x.commission) ? (r.commission / sum(list, (x) => x.commission)) * 100 : 0]);
    boards.forEach(({ def, rows: list }) => {
      const btn = U.$(`#${classBoardId(def.key)}-csv`, root);
      if (btn) btn.addEventListener('click', () => U.downloadCsv(`gv-${def.key.replace(/\+/g, 'plus')}-commission-agents-${U.stamp()}.csv`, GV_CLASS_HEADERS, gvClassRows(list)));
    });
    const rangeForm = U.$('#gvc-date-range', root); if (rangeForm) rangeForm.addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(rangeForm); FF.app.updateParams({ period:'custom', from:f.get('from')||'', to:f.get('to')||'' }); });
    bindExports(root, 'gvc-export', `gv-commission-${month}-${U.stamp()}`, 'GV Commission', ['Group','Agent','Agent ID','Vehicle class','Issuance','Amount','Commission','Commission per tag','Effective rate %','Class mix'], grouped.map((r) => [group,r.agentLabel,r.id,r.classLabel,r.issuances,r.amount,r.commission,r.perTag,r.effectiveRate,classMix(r.classes)]), [
      { name: 'Class Summary', header: ['Vehicle class','Board','Tags','Agents','Amount','Commission','Commission per tag','Effective rate %','Top agent'], rows: classList.map((c) => [c.cls, c.group, c.tags, c.agents, c.amount, c.commission, c.tags ? c.commission / c.tags : 0, ratePct(c.commission, c.amount), c.top]) },
      ...boards.filter((b) => b.rows.length).map(({ def, rows: list }) => ({ name: `GV ${def.key} agents`.slice(0, 31), header: GV_CLASS_HEADERS, rows: gvClassRows(list) })),
      { name: 'Class Variance Review', header: ['Agent','Agent ID','TL','Class','Tags','Observed commission/tag','Class median/tag','Deviation %','Peer variance amount'], rows: commissionAnomalies.map((r) => [r.agentLabel,r.id,r.tlName,r.classLabel,r.issuances,r.perTag,r.benchmark,r.deviationPct,r.varianceAmount]) }
    ]);
    const matrixCsv = U.$('#gvc-matrix-csv', root);
    if (matrixCsv) matrixCsv.addEventListener('click', () => U.downloadCsv(`gv-agent-class-commission-${U.stamp()}.csv`,
      ['Agent', 'Agent ID', 'TL / Direct', 'VC4 tags', 'VC4 unique tags', 'VC4 commission', 'VC4 rate (₹/tag)', 'VC20 tags', 'VC20 unique tags', 'VC20 commission', 'VC20 rate (₹/tag)', 'VC5+ tags', 'VC5+ unique tags', 'VC5+ commission', 'VC5+ rate (₹/tag)', 'VC5+ exact classes', 'Total commission', 'Overall rate (₹/tag)'],
      matrix.map((m) => [m.label, m.id || '', m.tlName || 'Direct / Unmapped', m.VC4.tags, m.VC4.unique, m.VC4.commission, m.VC4.rate ?? '', m.VC20.tags, m.VC20.unique, m.VC20.commission, m.VC20.rate ?? '', m['VC5+'].tags, m['VC5+'].unique, m['VC5+'].commission, m['VC5+'].rate ?? '', m.vc5Exact.map(([cls, v]) => `${cls}: ${v.tags} tags / ${v.commission}${v.rate !== null && v.rate !== undefined ? ` (${v.rate}/tag)` : ''}`).join(' | '), m.totalCommission, m.rate ?? ''])));
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
  const FF_AGENT_HEADERS = ['Agent ID', 'Agent', 'Network', 'TL / Direct', 'Current issuance', 'Commission rate (sheet)', 'Earned commission (sheet)', 'Rate × tags (computed)', 'Labeled rate?', 'Commission date'];
  const FF_HEADING_HEADERS = ['Column', 'Section (row 1)', 'Heading (row 2)', 'Detected as', 'Commission-like', 'Configured'];

  /** Admin one-click mapping: REPORT me jo heading mili usi ko rate / earned / category / date set karo. */
  async function saveCommissionMapping(root, patch, label) {
    try {
      const out = await FF.auth.api('/api/settings', 'PUT', { settings: { ffCommission: patch } });
      if (FF.auth.applySettings && out && out.settings) FF.auth.applySettings(out.settings);
      U.toast(`${label} save ho gaya ✓ — dashboard refresh ho raha hai`, 'ok');
      reset();
      if (FF.app.renderCurrent) FF.app.renderCurrent(); else window.location.reload();
    } catch (err) { U.toast(err.message || 'Mapping save nahi hui', 'err'); }
  }

  async function renderFfCommission(root, params) {
    const data = await ffCommissionData();
    const payout = await loadPayoutRates();
    const segment = ['all', 'direct', 'managed', 'other'].includes(params.segment) ? params.segment : 'all';
    const period = ['today','7','15','30','month','all','custom'].includes(String(params.period)) ? String(params.period) : 'month';
    const showAllHeadings = params.headings === 'all';
    const q = clean(params.q).toLowerCase();
    const now = new Date(); now.setHours(23,59,59,999); const from = new Date(now); from.setHours(0,0,0,0); if (['7','15','30'].includes(period)) from.setDate(from.getDate()-(Number(period)-1));
    const customFrom = params.from ? U.parseDate(params.from) : null, customTo = params.to ? U.parseDate(params.to) : null; if (customTo) customTo.setHours(23,59,59,999);
    const rows = data.agents.filter((r) => (segment === 'direct' ? r.segment === 'Direct Agent' : segment === 'managed' ? r.segment === 'TL-managed' : segment === 'other' ? r.segment === 'Other / unmapped' : true) && (!data.dateCol || period === 'all' || (period === 'custom' ? r.date && customFrom && customTo && r.date >= customFrom && r.date <= customTo : (period === 'month' ? r.date && U.ymKey(r.date) === U.ymKey(now) : r.date && r.date >= from && r.date <= now))) && (!q || [r.name, r.agentId, r.tlName, r.tlId, r.sourceCategory, r.rateRaw, r.amountRaw].join(' ').toLowerCase().includes(q)));
    // Payout-sheet class rates se expected commission (exact sums — koi average nahi).
    rows.forEach((r) => { r.payoutCalc = payout.found ? payoutBreakdown(r, payout) : null; });
    const payoutExpectedTotal = payout.found ? sum(rows, (r) => (r.payoutCalc && r.payoutCalc.expected !== null ? r.payoutCalc.expected : 0)) : null;
    const ffSlabResults = slabVarianceRows(rows, 'ff', (r) => r.curTotal, (r) => r.earned, (r) => r.name, (r) => r.agentId, (r) => r.tlName);
    const ffSlabMismatches = ffSlabResults.filter((r) => r.variance !== null && Math.abs(r.variance) > 0.01);
    const rateFound = !!(data.rateCol && !data.rateCol.missing);
    const amountFound = !!(data.amountCol && !data.amountCol.missing);
    const available = rateFound || amountFound;
    const earnedRows = rows.filter((r) => validValue(r.earned));
    const earned = sum(earnedRows, (r) => r.earned);
    const computedRows = rows.filter((r) => validValue(r.computed));
    const computedTotal = sum(computedRows, (r) => r.computed);
    const rateValues = rows.map((r) => r.rateValue).filter((v) => validValue(v)).sort((a, b) => a - b);
    const rateMin = rateValues.length ? rateValues[0] : null, rateMax = rateValues.length ? rateValues[rateValues.length - 1] : null;
    const headline = amountFound ? money(earned, 2) : rateFound ? money(computedTotal, 2) : 'Unavailable';
    const headlineFoot = amountFound ? `${earnedRows.length}/${rows.length} rows me sheet earned value` : rateFound ? `Computed · ${data.rateIsPercent ? 'rate is % — base amount chahiye' : 'rate × current issuance'}` : 'No commission heading detected in REPORT';
    const segments = ['Direct Agent', 'TL-managed', 'Other / unmapped'].map((label) => { const list = data.agents.filter((r) => r.segment === label); return { label, count: list.length, issuance: sum(list, (r) => r.curTotal), earned: sum(list.filter((r) => validValue(r.earned)), (r) => r.earned), computed: sum(list.filter((r) => validValue(r.computed)), (r) => r.computed), withEarned: list.filter((r) => validValue(r.earned)).length }; });
    const realCategories = data.categoryCol && !data.categoryCol.missing ? [...new Set(data.agents.map((r) => r.sourceCategory || 'Blank').filter(Boolean))].map((label) => { const list = data.agents.filter((r) => (r.sourceCategory || 'Blank') === label); return { label, count: list.length, issuance: sum(list, (r) => r.curTotal), earned: sum(list.filter((r) => validValue(r.earned)), (r) => r.earned) }; }).sort((a,b) => b.earned - a.earned || b.issuance - a.issuance) : [];
    // TL-wise rollup — kis TL ke agents ka commission kitna bana (Direct agents alag group me).
    const tlMap = new Map();
    rows.forEach((r) => {
      const key = r.segment === 'Direct Agent' ? 'Direct agents (koi TL nahi)' : (r.tlName || 'TL naam blank');
      if (!tlMap.has(key)) tlMap.set(key, { label: key, agents: 0, issuance: 0, earned: 0, earnedRows: 0, computed: 0, computedRows: 0, direct: r.segment === 'Direct Agent', top: null });
      const x = tlMap.get(key);
      x.agents++; x.issuance += Number(r.curTotal || 0);
      if (validValue(r.earned)) { x.earned += r.earned; x.earnedRows++; }
      if (validValue(r.computed)) { x.computed += r.computed; x.computedRows++; }
      const own = validValue(r.earned) ? r.earned : (validValue(r.computed) ? r.computed : 0);
      if (!x.top || own > x.top.amount) x.top = { name: r.name, amount: own };
    });
    const tlRows = [...tlMap.values()].sort((a, b) => (b.earned + b.computed) - (a.earned + a.computed) || b.issuance - a.issuance);
    const headingList = data.headers.filter((h) => showAllHeadings || h.role || h.commissionLike || h.configured);
    const canMap = !!(FF.auth && FF.auth.isAdmin && FF.auth.isAdmin());
    const mappingButtons = (h) => canMap ? `<div class="btn-row">${[['rate', 'rate'], ['earned', 'earned'], ['category', 'category'], ['date', 'date']].map(([role, text]) => `<button class="btn tiny" data-use-col="${esc(h.letter)}" data-use-role="${role}" title="REPORT column ${esc(h.letter)} ko ${text} mapping me set karo">${text === 'rate' ? '₹ Rate' : text === 'earned' ? '₹ Earned' : text === 'category' ? 'Category' : 'Date'}</button>`).join('')}</div>` : '';
    root.innerHTML = head('₹', 'First Forward Commission Intelligence', 'REPORT sheet ka reported rate + earned commission · Direct Agents aur TL-managed agents alag · column auto-detect (letter ya heading naam)', `<button class="btn small" id="ffc-fresh-top">🔄 Fresh sync</button> ${exportButtons('ffc-export')} ${printButton}`) + `
      <div class="source-row">${sourceChip('FF REPORT', `${U.fmt(data.agents.length)} agent rows · ${U.fmt(data.headers.length)} columns (A–${esc(data.lastColLetter)})`)}${rateFound ? sourceChip(`Rate · ${data.rateCol.letter}`, data.rateCol.label) : statusPill('Rate column not detected', 'amber')}${amountFound ? sourceChip(`Earned · ${data.amountCol.letter}`, data.amountCol.label) : statusPill('Earned-amount column not detected', 'amber')}${data.candidates.length ? sourceChip(`${U.fmt(data.candidates.length)} commission-like headings`, data.candidates.map((c) => `${c.letter} ${c.label}`).join(' | ')) : ''}</div>
      ${data.warnings.length ? `<div class="mapping-state warn"><div class="mapping-icon">⚠️</div><div><h3>Settings me diya gaya column naam REPORT me nahi mila</h3>${data.warnings.map((w) => `<p><b>${esc(w.label)}</b> = “${esc(w.value)}” → ${esc(w.message)}</p>`).join('')}<small>Neeche <b>🔍 REPORT commission column finder</b> me apni heading dekho aur ek click me sahi column set kar do (ya Settings → Data source me letter/naam likho).</small></div></div>` : ''}
      ${data.needsWiderRange ? `<div class="mapping-state warn"><div class="mapping-icon">↔️</div><div><h3>Commission column mil gaya, par REPORT ka fetch range chhota hai</h3><p>Column <b>${esc(data.rateCol ? data.rateCol.letter : '')}</b> sheet ke right side me hai, lekin Settings me REPORT ka range sirf <b>${U.fmt(data.narrowWidth)}</b> columns tak set hai — isliye ${U.fmt(data.outOfRange)} agents ke rate / earned values load nahi ho pa rahe (headings dikh rahi hain, values nahi).</p><div class="btn-row"><button class="btn primary" id="ffc-fix-range">🔧 REPORT range poora karo (one click)</button><a class="btn" href="#/settings?tab=sources">Settings → 🗂️ Sheets &amp; tabs</a></div></div></div>` : ''}
      ${!available ? `<div class="mapping-state warn"><div class="mapping-icon">⚠️</div><div><h3>Is REPORT snapshot me koi commission / rate heading nahi mili</h3><p>Columns A:${esc(data.lastColLetter)} poore scan hue (${U.fmt(data.headers.length)} columns). Dashboard kisi bhi guessed rate se payout calculate nahi karta. Agar aapne abhi sheet me <b>“Commission Rate”</b> column add kiya hai, to pehle <b>fresh sync</b> karo — Google/proxy ka purana snapshot hold kar raha ho sakta hai.</p><div class="btn-row"><button class="btn primary" id="ffc-fresh">🔄 REPORT fresh sync (Google se naya data)</button><a class="btn" href="#/settings?tab=sources">Settings → column mapping</a></div><small>Sync ke baad bhi heading na dikhe to neeche list se sahi column ek click me set kar do (Settings → Data source → <b>FF REPORT commission column</b>).</small></div></div>` : ''}
      <div class="card compact-card commission-selfcheck"><div class="card-head"><h3>✅ Commission source self-check</h3><span class="dim small">2-header REPORT: row 1 = section, row 2 = heading</span>${available && (data.populatedRate || data.populatedAmount) ? statusPill('Values mil rahi hain', 'green') : available ? statusPill('Column mila, values khali', 'amber') : statusPill('Column nahi mila', 'red')}</div>
        <div class="check-grid">
          <div class="${rateFound ? 'ok' : 'bad'}"><small>Rate column (row 2 heading)</small><b>${rateFound ? `${esc(data.rateCol.letter)} · ${esc(data.rateCol.sub || data.rateCol.col || data.rateCol.section)}` : 'Nahi mila'}</b><span>${rateFound ? `${U.fmt(data.populatedRate)} / ${U.fmt(data.agents.length)} agents me rate value` : 'Settings me letter (BZ) ya heading naam (Commission Rate) likho'}</span></div>
          <div class="${amountFound ? 'ok' : 'warn'}"><small>Earned column</small><b>${amountFound ? `${esc(data.amountCol.letter)} · ${esc(data.amountCol.sub || data.amountCol.col || data.amountCol.section)}` : 'Nahi mila'}</b><span>${amountFound ? `${U.fmt(data.populatedAmount)} rows me earned value` : 'Blank earned ko dashboard guess nahi karta'}</span></div>
          <div class="${rateFound && !data.rateIsPercent ? 'ok' : 'warn'}"><small>Rate ka unit</small><b>${rateFound ? (data.rateIsPercent ? 'Percent (%)' : '₹ per tag') : '—'}</b><span>${rateFound && data.rateIsPercent ? 'Percent rate se payout nahi banaya jaata (base amount chahiye)' : 'Rate × issuance = computed commission'}</span></div>
          <div class="${data.needsWiderRange ? 'bad' : 'ok'}"><small>Fetch range</small><b>${data.needsWiderRange ? 'Chhota hai' : `Theek hai (A–${esc(data.lastColLetter)})`}</b><span>${data.needsWiderRange ? `${U.fmt(data.outOfRange)} agents ke values range ke bahar — one-click fix upar hai` : `${U.fmt(data.headers.length)} columns scan hue`}</span></div>
        </div></div>
      <div class="card payout-card"><div class="card-head"><h3>📋 Payout sheet · class-wise rates &amp; penalties</h3>${payout.found ? statusPill(`${U.fmt(payout.rows.length)} rate rows · tab “${esc(payout.tab)}”`, 'green') : statusPill('Payout tab recognize nahi hui', 'amber')}<button class="btn small" id="ffc-payout-csv">⬇ Rates CSV</button></div>
        ${payout.found ? `
          <p class="dim small">FF Google Sheet ki <b>${esc(payout.tab)}</b> tab se exact class rates · expected commission = <b>class-wise counts × rate − penalty lines</b> (koi average nahi, sirf exact sums). VC20 count EIR bins se ya (NVC4 − VC5/6/7/12/16) se aata hai.</p>
          <div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-teal">Particulars</th><th class="tone-teal">Class</th><th class="tone-teal">Group</th><th class="tone-teal num">Commission ₹ / tag</th><th class="tone-teal num">Penalty ₹</th><th class="tone-teal">Note</th></tr></thead><tbody>
            ${payout.rows.map((p) => `<tr><td>${esc(p.label || p.cls)}</td><td><code class="col-code">${esc(p.cls || p.exact)}</code></td><td>${statusPill(p.group, p.group === 'VC4' ? 'blue' : p.group === 'VC20' ? 'amber' : '')}</td><td class="num"><b>${validValue(p.rate) ? money(p.rate, 2) : '<span class="dim">—</span>'}${p.ratePercent ? ' <small>% basis</small>' : ''}</b></td><td class="num">${validValue(p.penalty) ? money(p.penalty, 2) : '<span class="dim">—</span>'}</td><td class="small dim">${esc(p.note || '')}</td></tr>`).join('')}
            ${payout.penaltyRows.map((p) => `<tr><td>⚖️ ${esc(p.label)}</td><td><code class="col-code">penalty</code></td><td>—</td><td class="num">${validValue(p.rate) ? money(p.rate, 2) : '<span class="dim">—</span>'}</td><td class="num"><b>${validValue(p.penalty) ? money(p.penalty, 2) : '<span class="dim">—</span>'}</b></td><td class="small dim">${esc(p.note || 'Wrong VRN / replacement jaisi penalty line')}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="split-cards"><div class="card"><div class="card-head"><h3>Expected commission · payout rates</h3>${statusPill('Selected agents', 'blue')}</div><div class="ins-big">${money(payoutExpectedTotal, 2)}</div><p class="dim small">${U.fmt(rows.length)} agents · gross ${money(sum(rows, (r) => (r.payoutCalc ? r.payoutCalc.gross : 0)), 2)} − penalties ${money(sum(rows, (r) => (r.payoutCalc ? r.payoutCalc.penalty : 0)), 2)}</p></div>
          <div class="card"><div class="card-head"><h3>Sheet AB rate × tags</h3>${statusPill('REPORT rate', 'amber')}</div><div class="ins-big">${rateFound ? money(computedTotal, 2) : '—'}</div><p class="dim small">${rateFound ? `${esc(data.rateCol.letter)} · ${esc(data.rateCol.sub || data.rateCol.section || '')}` : 'REPORT me rate column detect nahi hua'}</p></div></div>
        ` : `<div class="mapping-state"><div class="mapping-icon">🧾</div><div><b>“${esc(payout.tab)}” tab se class rates load nahi hue</b><span>${esc(payout.error || 'Sheet me payout tab honi chahiye jisme class, commission rate aur penalty columns ho.')}</span><small>Settings → Data source → <b>FF payout sheet</b> me tab ka exact naam/columns set karo (default naam: <code>payout</code>). Jab tak rates nahi milte, dashboard guessed payout calculate nahi karta.</small></div></div>`}
      </div>
      <div id="ffc-tools"></div>
      <div class="ins-filters">
        ${data.dateCol ? `<label>Period<select class="select" data-param="period">${[['today','Today'],['7','Last 7 days'],['15','Last 15 days'],['30','Last 30 days'],['month','This month'],['custom','Custom range'],['all','All dates']].map(([v,l])=>`<option value="${v}" ${v===period?'selected':''}>${l}</option>`).join('')}</select></label>${period==='custom'?`<form id="ffc-date-range" class="ins-search"><input class="input" type="date" name="from" value="${esc(params.from||'')}"><input class="input" type="date" name="to" value="${esc(params.to||'')}"><button class="btn">Apply range</button></form>`:''}` : ''}
        <label>Network<select class="select" data-param="segment"><option value="all">All categories</option><option value="direct" ${segment === 'direct' ? 'selected' : ''}>Direct Agents</option><option value="managed" ${segment === 'managed' ? 'selected' : ''}>TL-managed</option><option value="other" ${segment === 'other' ? 'selected' : ''}>Other / unmapped</option></select></label>
        <label>Heading map<select class="select" data-param="headings"><option value="commission" ${!showAllHeadings ? 'selected' : ''}>Commission columns + used</option><option value="all" ${showAllHeadings ? 'selected' : ''}>All ${U.fmt(data.headers.length)} REPORT columns</option></select></label>
        <form id="ffc-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="Agent, ID, TL, rate…"><button class="btn">Search</button></form>
      </div>
      ${vividMetrics([
        { label: 'Matched agents', value: U.fmt(rows.length), foot: `${U.fmt(sum(rows, (r) => r.curTotal))} REPORT issuance`, tone: 'g1', icon: '🧑‍💼' },
        { label: amountFound ? 'Reported earned commission' : 'Computed commission', value: headline, foot: headlineFoot, tone: 'g5', icon: '💰' },
        { label: 'Commission rate source', value: rateFound ? esc(data.rateCol.letter) : '—', foot: rateFound ? `${esc(data.rateCol.sub || data.rateCol.section || data.rateCol.label).slice(0, 60)}${data.rateIsPercent ? ' · % basis' : ''}` : 'Settings me letter ya heading naam likho', tone: rateFound ? 'g3' : 'g4', icon: '📈' },
        { label: 'Rate range in sheet', value: rateMin === null ? '—' : `${U.fmt(rateMin, 2)} <small>–</small> ${U.fmt(rateMax, 2)}`, foot: rateFound ? `${U.fmt(data.populatedRate)} agents me value · unit ${data.rateIsPercent ? 'percent %' : '₹ per tag (jukar)'}` : 'No rate values loaded', tone: 'g6', icon: '🔢' },
        { label: 'Rows with earned value', value: `${U.fmt(data.populatedAmount)} <small>/ ${U.fmt(data.agents.length)}</small>`, foot: amountFound ? `Total ${money(earned, 2)} · blank rows guess nahi kiye jaate` : 'Earned column add karo (Settings → heading picker)', tone: 'g8', icon: '✅' },
        { label: 'Slab payout differences', value: !(FF.config.commissionSlabs && FF.config.commissionSlabs.enabled) ? 'Off' : !amountFound ? 'No actual column' : U.fmt(ffSlabMismatches.length), foot: FF.config.commissionSlabs && FF.config.commissionSlabs.enabled ? (amountFound ? 'Actual FF REPORT payout vs configured slab' : 'Map earned-commission column in Settings') : 'Set FF/GV slab rates in Settings', tone: ffSlabMismatches.length ? 'g7' : 'g9', icon: '⚖️' }
      ])}
      <div class="card"><div class="card-head"><h3>🔍 REPORT commission column finder</h3><span class="dim small">${U.fmt(headingList.length)} columns ${showAllHeadings ? '' : '· commission-like + mapped'} · click karke mapping set karo</span><button class="btn small" id="ffc-heading-csv">⬇ Heading map CSV</button></div>
        <p class="dim small">Ye table REPORT ke <b>row 1 + row 2</b> headings ko exact column letter ke saath dikhata hai. Green row = is column ko dashboard use kar raha hai. “Commission-like” = heading me commission / rate / payout / earning / incentive / ₹ jaisa koi word hai. ${canMap ? 'Admin ke liye har row me ek click ka mapping button hai — dabate hi setting save hoti hai.' : 'Mapping badalne ke liye admin access chahiye.'}</p>
        <div class="table-wrap heading-map"><table class="data-table ins-table"><thead><tr><th class="tone-violet">Column</th><th class="tone-violet">Section (row 1)</th><th class="tone-violet">Heading (row 2)</th><th class="tone-violet">Detected as</th><th class="tone-violet">Commission-like</th><th class="tone-violet">Configured</th>${canMap ? '<th class="tone-violet">Set mapping</th>' : ''}</tr></thead><tbody>${headingList.map((h) => `<tr class="${h.role ? 'col-used' : ''}"><td><code class="col-code">${esc(h.letter)}</code></td><td>${esc(h.section || h.own || '—')}</td><td><b>${esc(h.sub || h.col || '—')}</b></td><td>${h.role ? statusPill(h.role, 'green') : h.commissionLike ? statusPill('Commission-like', 'amber') : '<span class="dim">—</span>'}</td><td>${h.commissionLike ? '✔' : '<span class="dim">—</span>'}</td><td>${h.configured ? statusPill('Settings', 'blue') : '<span class="dim">—</span>'}</td>${canMap ? `<td>${mappingButtons(h)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${canMap ? 7 : 6}">${showAllHeadings ? 'REPORT table khali hai' : empty('Koi commission-like heading nahi mili', 'Dropdown se “All REPORT columns” chuno aur poori heading list dekho.')}</td></tr>`}</tbody></table></div>
      </div>
      <div class="split-cards">${segments.map((s) => `<div class="card"><div class="card-head"><h3>${esc(s.label)}</h3>${statusPill(`${U.fmt(s.count)} agents`, s.label === 'Direct Agent' ? 'blue' : s.label === 'TL-managed' ? 'green' : 'amber')}</div><div class="ins-big">${amountFound ? money(s.earned, 2) : s.computed ? money(s.computed, 2) : '—'}</div><p class="dim">${U.fmt(s.issuance)} issuance · ${U.fmt(s.withEarned)} rows me sheet earned value${!amountFound && s.computed ? ` · computed ${money(s.computed, 2)}` : ''}</p></div>`).join('')}</div>
      ${realCategories.length ? `<div class="card compact-card"><div class="card-head"><h3>Additional categories found in REPORT</h3><span class="dim small">${esc(data.categoryCol.label)}</span></div><div class="category-strip">${realCategories.map((c) => `<div><b>${esc(c.label)}</b><span>${U.fmt(c.count)} agents · ${U.fmt(c.issuance)} issued</span><strong>${amountFound ? money(c.earned,2) : '—'}</strong></div>`).join('')}</div></div>` : ''}
      <div class="card"><div class="card-head"><h3>Agent-wise commission</h3><span class="dim small">Sheet values + (जब earned blank ho) rate × issuance computed column</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-blue">Agent</th><th class="tone-blue">Network</th>${realCategories.length ? '<th class="tone-blue">Sheet category</th>' : ''}<th class="tone-blue">TL / Direct</th><th class="tone-blue num">Issuance</th><th class="tone-blue num">Rate (sheet)</th><th class="tone-blue num">Earned (sheet)</th><th class="tone-blue num">Rate × tags</th>${payout.found ? '<th class="tone-blue num">Payout expected</th><th class="tone-blue num">Payout vs sheet</th>' : ''}</tr></thead><tbody>
        ${rows.map((r) => `<tr><td><b class="agent-link" data-agent360="${esc(r.name || r.agentId)}" data-agent360-id="${esc(r.agentId || '')}" title="Agent 360 kholo">${esc(r.name || r.agentId)}</b><small>${esc(r.agentId || '')}</small></td><td>${statusPill(r.segment, r.segment === 'Direct Agent' ? 'blue' : r.segment === 'TL-managed' ? 'green' : '')}</td>${realCategories.length ? `<td>${esc(r.sourceCategory || '—')}</td>` : ''}<td>${esc(r.segment === 'Direct Agent' ? 'Direct' : r.tlName || '—')}</td><td class="num">${U.fmt(r.curTotal || 0)}</td><td class="num">${rateFound && validValue(r.rateValue) ? esc(r.rateRaw || U.fmt(r.rateValue, 2)) : '<span class="dim">—</span>'}</td><td class="num">${amountFound && validValue(r.earned) ? `<b>${money(r.earned, 2)}</b>` : '<span class="dim">blank</span>'}</td><td class="num">${validValue(r.computed) ? `<b>${money(r.computed, 2)}</b>` : '<span class="dim">—</span>'}</td>${payout.found ? `<td class="num">${r.payoutCalc && r.payoutCalc.expected !== null ? `<b>${money(r.payoutCalc.expected, 2)}</b>${r.payoutCalc.missing.length ? `<small class="dim">rate missing: ${esc(r.payoutCalc.missing.join(', '))}</small>` : ''}` : '<span class="dim">—</span>'}</td><td class="num">${payoutDiffCell(r)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${(realCategories.length ? 8 : 7) + (payout.found ? 2 : 0)}">${empty('No agents match', 'Search ya filter change karo.')}</td></tr>`}
      </tbody>${rows.length ? `<tfoot><tr class="row-total"><td colspan="${realCategories.length ? 4 : 3}">Total · ${U.fmt(rows.length)} agents</td><td class="num">${U.fmt(sum(rows, (r) => r.curTotal))}</td><td class="num">${rateFound ? `${U.fmt(rateMin, 2)}–${U.fmt(rateMax, 2)}` : '—'}</td><td class="num">${amountFound ? money(earned, 2) : '—'}</td><td class="num">${validValue(computedTotal) && computedRows.length ? money(computedTotal, 2) : '—'}</td>${payout.found ? `<td class="num"><b>${money(payoutExpectedTotal, 2)}</b></td><td></td>` : ''}</tr></tfoot>` : ''}</table></div></div>
      <div class="card"><div class="card-head"><h3>TL-wise commission rollup</h3><span class="dim small">${U.fmt(tlRows.length)} TL / groups · selected period</span><button class="btn small" id="ffc-tl-csv">⬇ TL rollup CSV</button></div>
        <div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-teal">TL / group</th><th class="tone-teal num">Agents</th><th class="tone-teal num">Issuance</th><th class="tone-teal num">Earned (sheet)</th><th class="tone-teal num">Rate × tags</th><th class="tone-teal num">Total commission</th><th class="tone-teal num">₹ / tag</th><th class="tone-teal">Top agent</th></tr></thead><tbody>
          ${tlRows.map((t) => { const total = amountFound ? t.earned + (t.earnedRows ? 0 : t.computed) : t.computed; const rowsWithValue = amountFound ? t.earnedRows : t.computedRows; return `<tr class="${t.direct ? 'dup-row' : ''}"><td><b>${esc(t.label)}</b></td><td class="num">${U.fmt(t.agents)}</td><td class="num">${U.fmt(t.issuance)}</td><td class="num">${t.earnedRows ? money(t.earned, 2) : '<span class="dim">—</span>'}</td><td class="num">${t.computedRows ? money(t.computed, 2) : '<span class="dim">—</span>'}</td><td class="num"><b>${rowsWithValue ? money(total, 2) : '—'}</b></td><td class="num">${t.issuance && rowsWithValue ? money(total / t.issuance, 2) : '—'}</td><td>${t.top && t.top.amount ? `${esc(t.top.name)} <small>${money(t.top.amount, 2)}</small>` : '<span class="dim">—</span>'}</td></tr>`; }).join('') || `<tr><td colspan="8">${empty('No TL rows', 'Selected filters me koi agent nahi mila.')}</td></tr>`}
        </tbody></table></div></div>
      <div class="card slab-review"><div class="card-head"><h3>FF slab payout reconciliation · agent-wise</h3>${!FF.config.commissionSlabs || !FF.config.commissionSlabs.enabled ? statusPill('Slab comparison off', 'amber') : statusPill(`${U.fmt(ffSlabMismatches.length)} payout differences`, ffSlabMismatches.length ? 'red' : 'green')}<button class="btn small" id="ffc-slab-csv">⬇ Slab detail CSV</button></div><p class="dim small">Selected-period REPORT issuance chooses the configured FF band. Expected payout compares with the earned-commission column only; no missing source values are inferred.</p>${FF.config.commissionSlabs && FF.config.commissionSlabs.enabled ? `<div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-amber">Agent</th><th class="tone-amber">TL</th><th class="tone-amber num">Tags</th><th class="tone-amber">Slab / rate</th><th class="tone-amber num">Expected</th><th class="tone-amber num">Actual REPORT payout</th><th class="tone-amber num">Actual − expected</th><th class="tone-amber">Status</th></tr></thead><tbody>${ffSlabResults.filter((r)=>r.status!=='Matches slab').sort((a,b)=>Math.abs(b.variance||0)-Math.abs(a.variance||0)).map((r)=>`<tr><td><b>${esc(r.name)}</b><small>${esc(r.id)}</small></td><td>${esc(r.tl)}</td><td class="num">${U.fmt(r.count)}</td><td>${esc(r.tier)}${r.rate!==undefined?` · ${money(r.rate,2)}/tag`:''}</td><td class="num">${r.expected===null?'Rate not configured':money(r.expected,2)}</td><td class="num">${r.actual===null?'Unavailable':money(r.actual,2)}</td><td class="num">${r.variance===null?'—':`${r.variance>0?'+':''}${money(r.variance,2)}`}</td><td>${statusPill(r.status,r.status==='Less actual than slab'?'red':r.status==='More actual than slab'?'amber':'')}</td></tr>`).join('') || `<tr><td colspan="8">${empty('No slab differences', 'No FF agents have comparable actual payouts and configured slab rates for this period.')}</td></tr>`}</tbody></table></div>` : `<div class="mapping-state"><b>Slab comparison is off.</b><span>Settings → Data source → Commission slabs me FF rates enter karein, phir comparison enable karein.</span></div>`}</div>`;
    U.$('#ffc-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    const rangeForm = U.$('#ffc-date-range', root); if (rangeForm) rangeForm.addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(rangeForm); FF.app.updateParams({ period:'custom', from:f.get('from') || '', to:f.get('to') || '' }); });
    root.querySelectorAll('[data-use-col]').forEach((btn) => btn.addEventListener('click', () => {
      const role = btn.dataset.useRole, col = btn.dataset.useCol;
      const key = role === 'rate' ? 'rateCol' : role === 'earned' ? 'earnedCol' : role === 'category' ? 'categoryCol' : 'dateCol';
      const label = role === 'rate' ? 'Commission rate' : role === 'earned' ? 'Earned commission' : role === 'category' ? 'Agent category' : 'Commission date';
      const clear = (data.map[key] || '').toUpperCase() === col.toUpperCase();
      saveCommissionMapping(root, { [key]: clear ? '' : col }, `${label} → ${clear ? 'cleared' : col}`);
    }));
    const freshSync = (btn) => U.withButtonBusy(btn, async () => {
      if (!FF.app || !FF.app.refresh) throw new Error('Refresh engine available nahi hai');
      await FF.app.refresh(); // fresh=1 → server cache bypass + REPORT dobara load + page re-render
    }, 'Google se fresh data…');
    ['#ffc-fresh', '#ffc-fresh-top'].forEach((sel) => { const b = U.$(sel, root); if (b) b.addEventListener('click', () => freshSync(b)); });
    const fixRange = U.$('#ffc-fix-range', root);
    if (fixRange) fixRange.addEventListener('click', () => U.withButtonBusy(fixRange, async () => {
      const tabs = (FF.config.allTabs ? FF.config.allTabs() : FF.config.tabs || []).map((t) => ({ ...t }));
      const rep = tabs.find((t) => t.id === 'REPORT');
      if (!rep) throw new Error('REPORT tab config nahi mili');
      rep.range = ''; rep.startCol = 'A'; rep.startRow = '1'; rep.endCol = ''; rep.endRow = '';
      const out = await FF.auth.api('/api/settings', 'PUT', { settings: { tabs } });
      if (FF.auth.applySettings && out && out.settings) FF.auth.applySettings(out.settings);
      U.toast('REPORT ka range poora kar diya ✓ — naya data load ho raha hai', 'ok');
      reset();
      if (FF.store && FF.store.reset) { FF.store.reset(); await FF.store.preload(true); }
      if (FF.app.renderCurrent) FF.app.renderCurrent(); else window.location.reload();
    }, 'Range update ho raha hai…'));
    const headingRows = data.headers.map((h) => [h.letter, h.section, h.sub, h.role || '', h.commissionLike ? 'YES' : 'NO', h.configured ? 'YES' : 'NO']);
    const headingCsv = U.$('#ffc-heading-csv', root);
    if (headingCsv) headingCsv.addEventListener('click', () => U.downloadCsv(`ff-report-commission-headings-${U.stamp()}.csv`, FF_HEADING_HEADERS, headingRows));
    const exportRows = rows.map((r) => [r.agentId, r.name, r.segment, r.sourceCategory, r.tlName, r.curTotal, r.rateRaw, r.earned, r.computed]);
    const tlHeaders = ['TL / group', 'Type', 'Agents', 'Issuance', 'Earned (sheet)', 'Rate × tags', 'Total commission', 'Rows with earned value', 'Rows with computed value', 'Top agent', 'Top agent commission'];
    const tlCsvRows = tlRows.map((t) => { const total = amountFound ? t.earned + (t.earnedRows ? 0 : t.computed) : t.computed; return [t.label, t.direct ? 'Direct agents' : 'TL-managed', t.agents, t.issuance, t.earned, t.computed, total, t.earnedRows, t.computedRows, t.top ? t.top.name : '', t.top ? t.top.amount : '']; });
    bindExports(root, 'ffc-export', `ff-commission-${U.stamp()}`, 'FF Commission', FF_AGENT_HEADERS, rows.map((r) => [r.agentId, r.name, r.segment, r.tlName, r.curTotal, r.rateRaw, r.earned, r.computed, rateFound ? (r.rateRaw ? 'sheet' : '') : '', r.dateRaw]), [
      { name: 'REPORT Heading Map', header: FF_HEADING_HEADERS, rows: headingRows },
      { name: 'TL Rollup', header: tlHeaders, rows: tlCsvRows },
      { name: 'Slab Reconciliation', header: ['Agent','Agent ID','TL','Tags','Slab','Model','Expected payout','Actual payout','Actual minus expected','Status'], rows: ffSlabResults.map((r) => [r.name,r.id,r.tl,r.count,r.tier,r.model,r.expected,r.actual,r.variance,r.status]) },
      ...(payout.found ? [
        { name: 'Payout Rates', header: ['Particulars','Class','Group','Commission per tag','Penalty','Note'], rows: [...payout.rows.map((p) => [p.label, p.cls, p.group, validValue(p.rate) ? p.rate : '', validValue(p.penalty) ? p.penalty : '', p.note]), ...payout.penaltyRows.map((p) => [p.label, 'penalty', '', validValue(p.rate) ? p.rate : '', validValue(p.penalty) ? p.penalty : '', p.note])] },
        { name: 'Payout Expected', header: ['Agent','Agent ID','TL','VC4 ₹','VC20 ₹','VC5+ ₹','Gross','Penalty','Expected'], rows: rows.map((r) => { const c = r.payoutCalc || {}; const g = {}; (c.lines || []).forEach((l) => { const k = l.cls.indexOf('VC4') === 0 ? 'VC4' : l.cls.indexOf('VC20') === 0 ? 'VC20' : 'VC5+'; g[k] = (g[k] || 0) + l.amount; }); return [r.name, r.agentId, r.tlName, g.VC4 ?? '', g.VC20 ?? '', g['VC5+'] ?? '', c.gross ?? '', c.penalty ?? '', c.expected ?? '']; }) }
      ] : [])
    ]);
    const ffSlabHeaders = ['Agent','Agent ID','TL','Tags','Slab','Model','Expected payout','Actual payout','Actual minus expected','Status'];
    const ffSlabRows = ffSlabResults.map((r) => [r.name,r.id,r.tl,r.count,r.tier,r.model,r.expected,r.actual,r.variance,r.status]);
    const ffSlabCsv = U.$('#ffc-slab-csv', root); if (ffSlabCsv) ffSlabCsv.addEventListener('click', () => U.downloadCsv(`ff-slab-reconciliation-${U.stamp()}.csv`, ffSlabHeaders, ffSlabRows));
    const tlCsv = U.$('#ffc-tl-csv', root); if (tlCsv) tlCsv.addEventListener('click', () => U.downloadCsv(`ff-commission-tl-rollup-${U.stamp()}.csv`, tlHeaders, tlCsvRows));
    const payoutCsv = U.$('#ffc-payout-csv', root); if (payoutCsv) payoutCsv.addEventListener('click', () => U.downloadCsv(`ff-payout-class-rates-${U.stamp()}.csv`, ['Particulars','Class','Group','Commission per tag','Penalty','Note'], [...payout.rows.map((p) => [p.label, p.cls, p.group, validValue(p.rate) ? p.rate : '', validValue(p.penalty) ? p.penalty : '', p.note]), ...payout.penaltyRows.map((p) => [p.label, 'penalty', '', validValue(p.rate) ? p.rate : '', validValue(p.penalty) ? p.penalty : '', p.note])]));
    // Payout reconciliation + commission alerts (cockpit.js) — FF commission page ke andar hi render hote hain.
    if (FF.cockpit && FF.cockpit.mountFfTools) FF.cockpit.mountFfTools(root).catch(() => {});
    bindMetricDetails(root, 'FF REPORT', FF_AGENT_HEADERS, rows.map((r) => [r.agentId, r.name, r.segment, r.tlName, r.curTotal, r.rateRaw, r.earned, r.computed, r.rateRaw ? 'sheet' : '', r.dateRaw]), {
      'Slab payout differences': { title: 'FF actual-vs-slab by agent', headers: ffSlabHeaders, rows: ffSlabRows },
      'Reported earned commission': { title: 'Rows with a sheet earned-commission value', headers: FF_AGENT_HEADERS, rows: exportRows.filter((r) => validValue(r[7])).map((r) => [r[0], r[1], r[2], r[4], r[5], r[6], r[7], r[8], 'sheet', '']) },
      'Computed commission': { title: 'Rate × current issuance (no sheet payout)', headers: FF_AGENT_HEADERS, rows: exportRows.filter((r) => validValue(r[8])).map((r) => [r[0], r[1], r[2], r[4], r[5], r[6], r[7], r[8], 'computed', '']) },
      'Commission rate source': { title: 'REPORT heading map', headers: FF_HEADING_HEADERS, rows: headingRows },
      'Rate range in sheet': { title: 'Agent-wise sheet rate', headers: FF_AGENT_HEADERS, rows: exportRows.map((r) => [r[0], r[1], r[2], r[4], r[5], r[6], r[7], r[8], '', '']) },
      'Rows with earned value': { title: 'Sheet earned-commission rows', headers: FF_AGENT_HEADERS, rows: exportRows.map((r) => [r[0], r[1], r[2], r[4], r[5], r[6], r[7], r[8], '', '']) }
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

  // ---- Cross-channel · dual (double-mapped) agents -------------------------------------------------
  // Ek hi physical tag do jagah map ho jaye to wo "double mapped" hai. Do verified signals use hote hain:
  // (1) StockDataa barcode ↔ Tag Assignment serial, (2) FF REPORT "GV ID Found" ↔ GV unique ID.
  const DUAL_AGENT_HEADERS = ['FF Agent', 'FF Agent ID', 'FF TL', 'FF tags issued (current month)', 'FF stock tags', 'GV Agent', 'GV Agent ID', 'GV TL', 'GV tags issued (month)', 'GV stock tags', 'Shared barcodes', 'Evidence', 'Confidence', 'GV commission', 'FF class mix', 'GV class mix'];
  const DUAL_BARCODE_HEADERS = ['Barcode · FF', 'GV serial', 'Double-mapped?', 'Why double-mapped', 'FF Agent ID', 'FF Agent', 'FF TL', 'FF Class', 'FF barcode allocation date', 'FF agent allocation date', 'GV Agent ID', 'GV Agent', 'GV TL', 'GV Class', 'GV allocation date', 'FF rows', 'FF distinct owners', 'GV rows', 'GV distinct owners', 'Agent pair resolution'];

  const barcodeOwnerKey = (kind, b) => normId(kind === 'ff' ? b.ffId : b.gvId) || `N:${normName(kind === 'ff' ? b.ffAgent : b.gvAgent)}`;

  async function renderDualChannel(root, params) {
    const data = await buildCross();
    const q = clean(params.q).toLowerCase(), method = ['all','barcode','gv-id','both'].includes(params.method) ? params.method : 'all';
    const onlyDouble = params.dup === 'double';
    const rows = data.rows.filter((r) => (!q || [r.ff.name,r.ff.id,r.gv.name,r.gv.id,r.ff.tlName,r.gv.tlName].join(' ').toLowerCase().includes(q)) && (method === 'all' || method === 'both' ? (method === 'all' || r.methods.length > 1) : r.methods.includes(method)));
    const barcodeRows = (data.barcodeAudit || []).filter((b) => (!q || [b.ff && b.ff.name,b.ff && b.ff.id,b.ff && b.ff.tlName,b.gv && b.gv.name,b.gv && b.gv.id,b.gv && b.gv.tlName, b.ffBarcode, b.gvSerial].join(' ').toLowerCase().includes(q)) && (method === 'all' || method === 'barcode' || (method === 'both' ? b.methods.length > 1 : b.methods.includes(method)))).map((b) => ({ ...b, ffAgent: b.ff && (b.ff.name || b.ff.id) || b.ffAgentName, ffId: b.ff && b.ff.id || b.ffAgentId, ffTl: b.ff && b.ff.tlName || b.ffTlName || '', gvAgent: b.gv && (b.gv.name || b.gv.id) || b.gvAgentName, gvId: b.gv && b.gv.id || b.gvAgentId, gvTl: b.gv && b.gv.tlName || b.gvTlName || '' }));
    // ---- double-mapping flags: repeated inside a source, owner change, ya FF ↔ GV owner alag ----
    const flaggedBarcodeRows = barcodeRows.map((b) => {
      const ffDup = b.ffOccurrences > 1 || b.ffOwnerCount > 1;
      const gvDup = b.gvOccurrences > 1 || b.gvOwnerCount > 1;
      const crossOwner = barcodeOwnerKey('ff', b) !== barcodeOwnerKey('gv', b);
      const reasons = [ffDup ? 'FF me ek se zyada rows/owners' : '', gvDup ? 'GV me ek se zyada rows/owners' : '', crossOwner ? 'FF aur GV me alag agent' : ''].filter(Boolean);
      return { ...b, ffDup, gvDup, crossOwner, doubleMapped: reasons.length > 0, reasons };
    });
    const doubleRows = flaggedBarcodeRows.filter((b) => b.doubleMapped);
    const matchedRows = flaggedBarcodeRows.filter((b) => !b.doubleMapped);
    const duplicateBarcodeRows = flaggedBarcodeRows.filter((b) => b.ffDup || b.gvDup);
    const todayKey = U.dateKey(new Date());
    const allocatedToday = (value) => { const date = value ? U.parseDate(value) : null; return !!(date && U.dateKey(date) === todayKey); };
    const dailyDuplicateRows = duplicateBarcodeRows.filter((b) => allocatedToday(b.ffBarcodeAllocatedAt) || allocatedToday(b.ffAgentAllocatedAt) || allocatedToday(b.gvAllocatedAt));
    const gvAllocationDateMapped = !!(FF.config.gv && FF.config.gv.assignment && FF.config.gv.assignment.allocatedAt);
    const ffIssue = sum(rows, (r) => r.ffIssuance), gvIssue = sum(rows, (r) => r.gvIssuance), ffStock = sum(rows, (r) => r.ffStock), gvStock = sum(rows, (r) => r.gvStock);
    const doubleAgents = new Set(doubleRows.flatMap((b) => [b.ffId || b.ffAgent, b.gvId || b.gvAgent]).filter(Boolean)).size;
    const tlSummary = new Map(); rows.forEach((r) => {
      const key = `${r.ff.tlName || 'Direct / Unmapped'} ↔ ${r.gv.tlName || 'Direct / Unmapped'}`;
      if (!tlSummary.has(key)) tlSummary.set(key, { label: key, agentRows: [], agents: 0, ff: 0, gv: 0, ffStock: 0, gvStock: 0, commission: 0, amount: 0, barcodes: 0 });
      const x = tlSummary.get(key); x.agents++; x.agentRows.push(r); x.ff += r.ffIssuance; x.gv += r.gvIssuance; x.ffStock += r.ffStock; x.gvStock += r.gvStock; x.commission += r.commission; x.amount += r.amount; x.barcodes += r.barcodeCount;
    });
    const netIssuance = gvIssue - ffIssue, netStock = gvStock - ffStock;
    const doubleRowHtml = (b) => `<tr class="${b.doubleMapped ? 'dup-row' : ''}"><td><b>${esc(b.ffBarcode)}</b><small>GV serial: ${esc(b.gvSerial || '—')}</small></td><td>${b.doubleMapped ? statusPill('YES · review', 'red') : statusPill('Matched once', 'green')}</td><td class="wrap">${b.reasons.length ? esc(b.reasons.join(' · ')) : '<span class="dim">Same owner, one row per channel</span>'}</td><td><b>${esc(b.ffAgent || '—')}</b><small>${esc(b.ffId || '')} · TL ${esc(b.ffTl || 'Direct / Unmapped')} · ${esc(b.ffClass || '—')}</small></td><td><b>${esc(b.gvAgent || '—')}</b><small>${esc(b.gvId || '')} · TL ${esc(b.gvTl || 'Direct / Unmapped')} · ${esc(b.gvClass || '—')}</small></td><td class="num">${U.fmt(b.ffOccurrences)} / ${U.fmt(b.ffOwnerCount)}</td><td class="num">${U.fmt(b.gvOccurrences)} / ${U.fmt(b.gvOwnerCount)}</td><td>${b.verified ? statusPill('Resolved pair', 'green') : statusPill('Ambiguous pair · review', 'red')}</td></tr>`;
    root.innerHTML = head('🔗', 'Cross Channel · Dual-Agent Intelligence', 'Verified joins only: normalized barcode (StockDataa ↔ Tag Assignment) and/or FF “GV ID Found” ↔ GV unique ID · name-only guesses never used', `<button class="btn primary" id="cross-double-csv">⬇ Double-mapped barcodes CSV</button> ${exportButtons('cross-export')} ${printButton}`) + `
      <div class="source-row">${sourceChip('StockDataa', `${U.fmt(data.scanned.ffStock)} barcode rows`)}${sourceChip('Tag Assignment', `${U.fmt(data.scanned.gvAssignment)} serial rows`)}${sourceChip('FF REPORT', `${U.fmt(data.scanned.ffAgents)} identities`)}${sourceChip('GV Master', `${U.fmt(data.scanned.gvAgents)} identities`)}<span class="dim small">Double-mapped = ek hi tag 2 jagah (cross-channel owner change ya ek hi source me repeat)</span></div>
      ${data.truncated && (data.truncated.stock || data.truncated.assignment) ? `<div class="mapping-state warn"><b>Detailed identity scan reached the 250,000-row safety cap.</b><span>Results are explicitly partial; archive old assignment rows or narrow the source tab.</span></div>` : ''}
      ${vividMetrics([
        { label: 'Dual (verified) agents', value: U.fmt(rows.length), foot: `${U.fmt(rows.filter((r) => r.methods.length > 1).length)} verified by both signals`, tone: 'g6', icon: '🔗' },
        { label: 'Double-mapped barcodes', value: U.fmt(doubleRows.length), foot: `${U.fmt(doubleAgents)} agents involved · ${U.fmt(matchedRows.length)} tags cleanly matched`, tone: doubleRows.length ? 'g7' : 'g9', icon: '🚨' },
        { label: 'FF tags · matched agents', value: U.fmt(ffIssue), foot: `${U.fmt(ffStock)} tags stock me (First Forward)`, tone: 'g1', icon: '🟦' },
        { label: 'GV tags · matched agents', value: U.fmt(gvIssue), foot: `${U.fmt(gvStock)} tags stock me (GV Partner)`, tone: 'g5', icon: '🟩' },
        { label: 'Combined footprint', value: U.fmt(ffIssue + gvIssue), foot: `${U.fmt(ffStock + gvStock)} stock · gap GV − FF ${netIssuance > 0 ? '+' : ''}${U.fmt(netIssuance)}`, tone: 'g3', icon: '📊' },
        { label: 'Shared / matched barcodes', value: U.fmt(barcodeRows.length), foot: `Repeated rows: ${U.fmt(duplicateBarcodeRows.length)} · today (allocation date): ${U.fmt(dailyDuplicateRows.length)}`, tone: 'g4', icon: '🧾' }
      ])}
      <div class="ins-filters">
        <label>Evidence<select class="select" data-param="method"><option value="all">All verified matches</option><option value="both" ${method === 'both' ? 'selected' : ''}>Both signals</option><option value="barcode" ${method === 'barcode' ? 'selected' : ''}>Barcode</option><option value="gv-id" ${method === 'gv-id' ? 'selected' : ''}>GV unique ID</option></select></label>
        <label>Barcode list<select class="select" data-param="dup"><option value="all">All shared barcodes</option><option value="double" ${onlyDouble ? 'selected' : ''}>Only double-mapped</option></select></label>
        <form id="cross-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="FF/GV agent, ID, TL ya barcode…"><button class="btn">Search</button></form>
      </div>
      ${data.ambiguousIds || data.ambiguousPairs ? `<div class="mapping-state"><b>${U.fmt(data.ambiguousIds + data.ambiguousPairs)} ambiguous identities were not auto-joined.</b><span>${U.fmt(data.ambiguousIds)} non-unique GV IDs · ${U.fmt(data.ambiguousPairs)} conflicting barcode owners. Corroboration is required to prevent false overlap.</span></div>` : ''}
      ${!data.rows.length ? `<div class="mapping-state warn"><div class="mapping-icon">🔎</div><div><h3>No verified overlap in the loaded snapshot</h3><p>The join completed, but no normalized StockDataa barcode matched Tag Assignment serial and no unique “GV ID Found” matched exactly one GV identity. No name-based records were added.</p></div></div>` : ''}
      <div class="card"><div class="card-head"><h3>🚨 Double-mapped barcodes · same tag do jagah</h3>${doubleRows.length ? statusPill(`${U.fmt(doubleRows.length)} review required`, 'red') : statusPill('Koi double mapping nahi mili', 'green')}<div class="btn-row"><button class="btn primary" id="cross-double-csv-2">⬇ Double-mapped barcodes CSV</button><button class="btn small" id="cross-barcode-csv">⬇ Saari shared barcodes CSV</button></div></div>
        <p class="dim small">Rows jahan (a) FF aur GV me <b>alag agent</b> hai, ya (b) ek hi source me wahi barcode <b>ek se zyada rows/owners</b> me hai. Yehi "double map" cases hote hain jinme tag pehle verify karna chahiye. Allocation dates ke saath poori list CSV me milti hai.</p>
        <div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-rose">Barcode (FF) ↔ Serial (GV)</th><th class="tone-rose">Double-mapped?</th><th class="tone-rose">Why</th><th class="tone-rose">FF agent · TL · class</th><th class="tone-rose">GV agent · TL · class</th><th class="tone-rose num">FF rows / owners</th><th class="tone-rose num">GV rows / owners</th><th class="tone-rose">Agent pair</th></tr></thead><tbody>${doubleRows.slice(0, 150).map(doubleRowHtml).join('') || `<tr><td colspan="8">${empty('No double-mapped barcode', 'Har shared barcode ka FF aur GV owner same hai aur dono sources me ek hi row hai. 👍')}</td></tr>`}</tbody></table></div>
        ${doubleRows.length > 150 ? `<p class="dim small">Preview me pehli 150 rows — <b>⬇ Double-mapped barcodes CSV</b> me poori list (${U.fmt(doubleRows.length)} rows) hai.</p>` : ''}
      </div>
      <div class="split-cards"><div class="card"><div class="card-head"><h3>Channel-wise summary</h3></div><div class="summary-grid"><div><small>FF tags issued</small><b>${U.fmt(ffIssue)}</b></div><div><small>GV tags issued</small><b>${U.fmt(gvIssue)}</b></div><div><small>FF stock tags</small><b>${U.fmt(ffStock)}</b></div><div><small>GV stock tags</small><b>${U.fmt(gvStock)}</b></div></div></div><div class="card"><div class="card-head"><h3>Combined commercial summary</h3></div><div class="summary-grid"><div><small>Total issuance</small><b>${U.fmt(ffIssue + gvIssue)}</b></div><div><small>Total stock</small><b>${U.fmt(ffStock + gvStock)}</b></div><div><small>GV amount</small><b>${money(sum(rows, (r) => r.amount))}</b></div><div><small>GV commission</small><b>${money(sum(rows, (r) => r.commission), 2)}</b></div></div></div></div>
      <div class="card"><div class="card-head"><h3>👥 Dual agents · agent naam, TL naam aur dono channel ke tags</h3><span class="dim small">${U.fmt(rows.length)} verified pairs · GV month ${esc(U.labelYM(data.month))}</span></div>
        <div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-violet">FF agent</th><th class="tone-violet">FF TL</th><th class="tone-violet num">FF tags</th><th class="tone-violet num">FF stock</th><th class="tone-violet">GV agent</th><th class="tone-violet">GV TL</th><th class="tone-violet num">GV tags</th><th class="tone-violet num">GV stock</th><th class="tone-violet num">Shared barcodes</th><th class="tone-violet">Evidence</th><th class="tone-violet num">GV commission</th><th class="tone-violet">Class mix · FF / GV</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><b class="agent-link" data-agent360="${esc(r.ff.name || r.ff.id)}" data-agent360-id="${esc(r.ff.id || '')}" title="Agent 360 kholo">${esc(r.ff.name || r.ff.id)}</b><small>${esc(r.ff.id || '')} · ${esc(r.segment)}</small></td><td>${esc(r.ff.tlName || 'Direct / Unmapped')}</td><td class="num"><span class="tag-count">${U.fmt(r.ffIssuance)}</span></td><td class="num">${U.fmt(r.ffStock)}</td><td><b class="agent-link" data-agent360="${esc(r.gv.name || r.gv.id)}" data-agent360-id="${esc(r.gv.id || '')}" title="Agent 360 kholo">${esc(r.gv.name || r.gv.id)}</b><small>${esc(r.gv.id || '')}</small></td><td>${esc(r.gv.tlName || 'Direct / Unmapped')}</td><td class="num"><span class="tag-count">${U.fmt(r.gvIssuance)}</span></td><td class="num">${U.fmt(r.gvStock)}</td><td class="num"><b>${U.fmt(r.barcodeCount)}</b>${r.barcodes.size ? `<small>${esc([...r.barcodes].slice(0, 2).join(', '))}${r.barcodes.size > 2 ? '…' : ''}</small>` : ''}</td><td>${statusPill(r.confidence, r.methods.length > 1 ? 'green' : 'blue')}<small>${esc(r.methods.join(' + '))}</small></td><td class="num">${money(r.commission, 2)}</td><td class="tiny-mix">${esc(classMix(r.ffClasses))}<small>GV: ${esc(classMix(r.gvClasses))}</small></td></tr>`).join('') || `<tr><td colspan="12">${empty('No matching verified agents', 'Evidence/search filter change karke dekhein.')}</td></tr>`}
      </tbody><tfoot><tr class="row-total"><td colspan="2">Total · ${U.fmt(rows.length)} dual agents</td><td class="num">${U.fmt(ffIssue)}</td><td class="num">${U.fmt(ffStock)}</td><td colspan="2"></td><td class="num">${U.fmt(gvIssue)}</td><td class="num">${U.fmt(gvStock)}</td><td class="num">${U.fmt(sum(rows, (r) => r.barcodeCount))}</td><td colspan="2" class="num">${money(sum(rows, (r) => r.commission), 2)}</td><td></td></tr></tfoot></table></div></div>
      <div class="card"><div class="card-head"><h3>TL-wise matched-channel comparison</h3><span class="dim small">GV − FF gaps · matched identities only</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-blue">FF TL ↔ GV TL</th><th class="tone-blue num">Agents</th><th class="tone-blue num">Shared barcodes</th><th class="tone-blue num">FF issuance</th><th class="tone-blue num">GV issuance</th><th class="tone-blue num">Issuance gap</th><th class="tone-blue num">FF stock</th><th class="tone-blue num">GV stock</th><th class="tone-blue num">Stock gap</th><th class="tone-blue num">GV commission</th><th class="tone-blue">Agent drill-down</th></tr></thead><tbody>${[...tlSummary.values()].sort((a,b)=>b.ff+b.gv-a.ff-a.gv).map((t)=>`<tr><td><b>${esc(t.label)}</b></td><td class="num">${U.fmt(t.agents)}</td><td class="num">${U.fmt(t.barcodes)}</td><td class="num">${U.fmt(t.ff)}</td><td class="num">${U.fmt(t.gv)}</td><td class="num"><b>${t.gv-t.ff>0?'+':''}${U.fmt(t.gv-t.ff)}</b></td><td class="num">${U.fmt(t.ffStock)}</td><td class="num">${U.fmt(t.gvStock)}</td><td class="num"><b>${t.gvStock-t.ffStock>0?'+':''}${U.fmt(t.gvStock-t.ffStock)}</b></td><td class="num">${money(t.commission,2)}</td><td><details class="tl-drill"><summary>Show ${U.fmt(t.agents)} agents</summary><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>FF Agent / ID</th><th>GV Agent / ID</th><th>Evidence</th><th>Barcodes</th><th>FF tags / stock</th><th>GV tags / stock</th><th>GV commission</th></tr></thead><tbody>${t.agentRows.slice(0,20).map((r)=>`<tr><td><b>${esc(r.ff.name||r.ff.id)}</b><small>${esc(r.ff.id||'')} · ${esc(r.ff.tlName||'Direct / Unmapped')}</small></td><td><b>${esc(r.gv.name||r.gv.id)}</b><small>${esc(r.gv.id||'')} · ${esc(r.gv.tlName||'Direct / Unmapped')}</small></td><td>${esc(r.methods.join(' + '))}</td><td>${U.fmt(r.barcodeCount)}</td><td>${U.fmt(r.ffIssuance)} / ${U.fmt(r.ffStock)}</td><td>${U.fmt(r.gvIssuance)} / ${U.fmt(r.gvStock)}</td><td>${money(r.commission,2)}</td></tr>`).join('')}</tbody></table></div>${t.agents>20?`<small class="dim">Showing first 20 of ${U.fmt(t.agents)} agent pairs; use the full Dual Channel CSV for all rows.</small>`:''}</details></td></tr>`).join('') || `<tr><td colspan="11">No TL overlap data</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>Barcode overlap audit · exact FF ↔ GV matches</h3><span class="dim small">${U.fmt(onlyDouble ? doubleRows.length : barcodeRows.length)} rows ${onlyDouble ? '· only double-mapped' : `· ${U.fmt(doubleRows.length)} double-mapped`}</span></div><p class="dim small">“Repeated in FF/GV” means the normalized barcode occurs more than once in that source; owner count highlights assignment across multiple agents. Today’s review uses allocation dates. ${gvAllocationDateMapped ? 'GV allocation-date mapping is active.' : 'GV assignment date is not mapped; configure it in Settings → Data source → Tag Assignment allocation-date column for complete daily coverage.'} Preview is capped for smooth loading.</p><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-slate">Barcode (FF) ↔ Serial (GV)</th><th class="tone-slate">Double-mapped?</th><th class="tone-slate">Why</th><th class="tone-slate">FF agent · TL · class</th><th class="tone-slate">GV agent · TL · class</th><th class="tone-slate num">FF rows / owners</th><th class="tone-slate num">GV rows / owners</th><th class="tone-slate">Agent pair</th></tr></thead><tbody>${(onlyDouble ? doubleRows : flaggedBarcodeRows).slice(0, 300).map(doubleRowHtml).join('') || `<tr><td colspan="8">No exact barcode join found for this filter.</td></tr>`}</tbody></table></div>${(onlyDouble ? doubleRows : flaggedBarcodeRows).length > 300 ? `<p class="dim small">Showing first 300 of ${U.fmt((onlyDouble ? doubleRows : flaggedBarcodeRows).length)} matched barcodes; use the CSV buttons for the full list.</p>` : ''}</div>`;
    U.$('#cross-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    const doubleExportRows = (list) => list.map((b) => [b.ffBarcode, b.gvSerial, b.doubleMapped ? 'YES' : 'NO', b.reasons.join(' · '), b.ffId, b.ffAgent, b.ffTl, b.ffClass, b.ffBarcodeAllocatedAt, b.ffAgentAllocatedAt, b.gvId, b.gvAgent, b.gvTl, b.gvClass, b.gvAllocatedAt, b.ffOccurrences, b.ffOwnerCount, b.gvOccurrences, b.gvOwnerCount, b.verified ? 'Resolved' : 'Ambiguous - review']);
    const allBarcodeRows = doubleExportRows(flaggedBarcodeRows);
    const doubleCsvRows = doubleExportRows(doubleRows);
    const downloadDouble = () => {
      U.downloadCsv(`dual-channel-double-mapped-barcodes-${U.dateKey(new Date())}.csv`, DUAL_BARCODE_HEADERS, doubleCsvRows);
      if (!doubleCsvRows.length) U.toast('Is snapshot me koi double-mapped barcode nahi mila — CSV sirf header ke saath download hui', 'warn');
    };
    ['#cross-double-csv', '#cross-double-csv-2'].forEach((sel) => { const btn = U.$(sel, root); if (btn) btn.addEventListener('click', downloadDouble); });
    const barcodeCsv = U.$('#cross-barcode-csv', root); if (barcodeCsv) barcodeCsv.addEventListener('click', () => U.downloadCsv(`dual-channel-barcodes-${U.stamp()}.csv`, DUAL_BARCODE_HEADERS, allBarcodeRows));
    const agentExportRows = rows.map((r) => [r.ff.name, r.ff.id, r.ff.tlName || 'Direct / Unmapped', r.ffIssuance, r.ffStock, r.gv.name, r.gv.id, r.gv.tlName || 'Direct / Unmapped', r.gvIssuance, r.gvStock, r.barcodeCount, r.methods.join(' + '), r.confidence, r.commission, classMix(r.ffClasses), classMix(r.gvClasses)]);
    bindExports(root, 'cross-export', `dual-channel-${U.stamp()}`, 'Dual Agents', DUAL_AGENT_HEADERS, agentExportRows, [
      { name: 'Double-Mapped Barcodes', header: DUAL_BARCODE_HEADERS, rows: doubleCsvRows.length ? doubleCsvRows : allBarcodeRows },
      { name: 'All Shared Barcodes', header: DUAL_BARCODE_HEADERS, rows: allBarcodeRows }
    ]);
    const fullCrossHeaders = DUAL_AGENT_HEADERS;
    const barcodeReviewHeaders = DUAL_BARCODE_HEADERS;
    const barcodeReviewDetailRows = doubleExportRows(duplicateBarcodeRows);
    const dailyReviewRows = doubleExportRows(dailyDuplicateRows);
    bindMetricDetails(root, 'Dual-channel agent summary', fullCrossHeaders, agentExportRows, {
      'Dual (verified) agents': { title: 'Verified FF ↔ GV agent pairs', headers: fullCrossHeaders, rows: agentExportRows },
      'Double-mapped barcodes': { title: `${U.fmt(doubleRows.length)} double-mapped barcode rows`, headers: barcodeReviewHeaders, rows: doubleCsvRows },
      'FF tags · matched agents': { title: 'First Forward tags of matched agents', headers: fullCrossHeaders, rows: agentExportRows },
      'GV tags · matched agents': { title: 'GV Partner tags of matched agents', headers: fullCrossHeaders, rows: agentExportRows },
      'Combined footprint': { title: 'Combined channel footprint by matched agent', headers: fullCrossHeaders, rows: agentExportRows },
      'Shared / matched barcodes': { title: 'Every shared barcode with mapping flags', headers: barcodeReviewHeaders, rows: allBarcodeRows },
      'Matched FF issuance': { title: 'First Forward side of matched agents', headers: fullCrossHeaders, rows: agentExportRows },
      'Matched GV issuance': { title: 'GV Partner side of matched agents', headers: fullCrossHeaders, rows: agentExportRows },
      'Net issuance gap · GV − FF': { title: 'GV minus FF per matched agent', headers: fullCrossHeaders, rows: agentExportRows },
      'Barcode review flags': { title: 'Repeated or multi-owner matched barcodes', headers: barcodeReviewHeaders, rows: barcodeReviewDetailRows },
      'Today’s duplicate review': { title: `Duplicate barcode assignments dated ${todayKey}`, headers: barcodeReviewHeaders, rows: dailyReviewRows }
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
    const [gvReport, eirAgents] = await Promise.all([G.need('report'), S.need('agents')]);
    const multiplier = 1 + (growthPct / 100);
    const make = (channel, id, name, tlName, stock, baseRate) => {
      const rate = Math.max(0, Number(baseRate) || 0) * multiplier;
      const safety = Math.ceil(rate * safetyDays);
      const need = (days) => Math.max(0, Math.ceil(rate * days) + safety - stock);
      const stockDays = rate > 0 ? stock / rate : Infinity;
      const outDate = Number.isFinite(stockDays) ? new Date(Date.now() + Math.max(0, stockDays) * 864e5) : null;
      return { channel, id, name, tlName, stock, baseRate: Number(baseRate) || 0, rate, safety, stockDays, outDate, need7: need(7), need15: need(15), need30: need(30), risk: rate <= 0 ? 'No run-rate' : stockDays <= 3 ? 'Critical' : stockDays <= 7 ? 'High' : stockDays <= 15 ? 'Medium' : 'Covered' };
    };
    // EIR channel split: master ID 5845036 (configurable) = GV Partner rows. FF demand rate me wo
    // issuance nahi aana chahiye — warna GV Master ke against double count hota (dual-channel agents).
    const ffIssu = new Map(), allIssu = new Map();
    const yms = (eirAgents || []).map((r) => r.ym).filter(Boolean).sort();
    const curYm = yms.includes(U.ymKey(new Date())) ? U.ymKey(new Date()) : (yms.at(-1) || '');
    (eirAgents || []).forEach((r) => {
      if (curYm && r.ym !== curYm) return;
      const k = normName(r.name);
      allIssu.set(k, (allIssu.get(k) || 0) + (Number(r.n) || 0));
      if (r.channel === 'First Forward') ffIssu.set(k, (ffIssu.get(k) || 0) + (Number(r.n) || 0));
    });
    const ff = FF.pages.performance.agents().filter((a) => a.name || a.agentId).filter((a) => {
      const k = normName(a.name), all = allIssu.get(k) || 0;
      return !(all > 0 && (ffIssu.get(k) || 0) === 0); // poori issuance GV channel ki hai → GV side me already
    }).map((a) => {
      const k = normName(a.name);
      const all = allIssu.get(k) || 0, ffN = ffIssu.get(k) || 0;
      const base = a.avgTotal || (a.activeDays ? (a.curTotal || 0) / a.activeDays : 0);
      return make('First Forward', a.agentId || a.id, a.name, a.tlName, a.stockTotal || 0, all > 0 ? base * (ffN / all) : base);
    });
    const gv = gvReport.map((a) => make('GV Partner', a.agentId, a.agentName, a.tlName, a.stockTotal || 0, a.runrate || (a.curDays ? a.curTotal / a.curDays : 0)));
    return [...ff, ...gv].sort((a, b) => a.stockDays - b.stockDays || b.rate - a.rate);
  }

  const FORECAST_RISK_ORDER = ['Critical', 'High', 'Medium', 'Covered', 'No run-rate'];
  const FORECAST_RISK_TONE = { Critical: 'critical', High: 'high', Medium: 'medium', Covered: 'covered', 'No run-rate': 'norate' };
  const FORECAST_RISK_PILL = { Critical: 'red', High: 'amber', Medium: 'amber', Covered: 'green', 'No run-rate': '' };
  const FORECAST_AGENT_HEADERS = ['Channel', 'Agent ID', 'Agent', 'TL', 'Stock', 'Base daily rate', 'Scenario daily rate', 'Stock days', 'Stock-out date', 'Risk', 'Safety units', 'Need 7 days', 'Need 15 days', 'Need 30 days'];
  const rowRiskClass = (risk) => risk === 'Critical' ? ' class="risk-critical"' : risk === 'High' ? ' class="risk-high"' : risk === 'Medium' ? ' class="risk-medium"' : '';

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
    const count = (list, rk) => list.filter((r) => r.risk === rk).length;
    const critical = all.filter((r) => r.stockDays <= 7 && r.rate > 0);
    const required7 = sum(all, (r) => r.need7), required15 = sum(all, (r) => r.need15), required30 = sum(all, (r) => r.need30);
    const totalStock = sum(rows, (r) => r.stock), totalRate = sum(rows, (r) => r.rate);
    const avgCover = totalRate > 0 ? totalStock / totalRate : Infinity;
    const ffRows = all.filter((r) => r.channel === 'First Forward'), gvRows = all.filter((r) => r.channel === 'GV Partner');
    // 🚨 jaldi dispatch chahiye: pehle Critical/High, phir 7-din ki need ke hisaab se.
    const urgent = all.filter((r) => r.rate > 0 && (r.risk === 'Critical' || r.risk === 'High' || r.need7 > 0))
      .sort((a, b) => (FORECAST_RISK_ORDER.indexOf(a.risk) - FORECAST_RISK_ORDER.indexOf(b.risk)) || b.need7 - a.need7 || b.rate - a.rate).slice(0, 25);
    // TL rollup
    const tlMap = new Map();
    rows.forEach((r) => {
      const key = `${r.channel}|${clean(r.tlName) || 'Direct / Unmapped'}`;
      if (!tlMap.has(key)) tlMap.set(key, { channel: r.channel, tlName: clean(r.tlName) || 'Direct / Unmapped', agents: 0, active: 0, stock: 0, rate: 0, safety: 0, need7: 0, need15: 0, need30: 0, risks: {} });
      const o = tlMap.get(key);
      o.agents++; if (r.rate > 0) o.active++; o.stock += r.stock; o.rate += r.rate; o.safety += r.safety;
      o.need7 += r.need7; o.need15 += r.need15; o.need30 += r.need30;
      o.risks[r.risk] = (o.risks[r.risk] || 0) + 1;
    });
    const tlRows = [...tlMap.values()].map((o) => {
      o.coverDays = o.rate > 0 ? o.stock / o.rate : Infinity;
      o.worst = FORECAST_RISK_ORDER.find((rk) => o.risks[rk]) || 'Covered';
      return o;
    }).sort((a, b) => FORECAST_RISK_ORDER.indexOf(a.worst) - FORECAST_RISK_ORDER.indexOf(b.worst) || b.need15 - a.need15);
    const channelRows = ['First Forward', 'GV Partner'].map((ch) => {
      const list = all.filter((r) => r.channel === ch);
      const stock = sum(list, (r) => r.stock), rate = sum(list, (r) => r.rate);
      return { channel: ch, agents: list.length, active: list.filter((r) => r.rate > 0).length, stock, rate, coverDays: rate > 0 ? stock / rate : Infinity, need7: sum(list, (r) => r.need7), need15: sum(list, (r) => r.need15), need30: sum(list, (r) => r.need30), critical: count(list, 'Critical'), high: count(list, 'High'), noRate: count(list, 'No run-rate') };
    });
    const coverText = Number.isFinite(avgCover) ? `${avgCover.toFixed(1)} days` : 'No consumption';
    root.innerHTML = head('🔭', 'Stock Forecasting', 'Sheet run-rate based stock-out projection · 7/15/30-day need · safety stock · what-if scenario', `${exportButtons('forecast-export')} ${printButton}`) + forecastTabs('projection') + `
      <div class="whatif"><div><b>What-if demand scenario</b><span>Run-rate change <strong id="growth-out">${growth >= 0 ? '+' : ''}${growth}%</strong></span><input id="growth-range" type="range" min="-50" max="150" step="5" value="${growth}"></div><div><b>Safety stock</b><span><strong id="safety-out">${safetyDays}</strong> demand days</span><input id="safety-range" type="range" min="0" max="30" step="1" value="${safetyDays}"></div><button class="btn primary" id="apply-scenario">Apply scenario</button></div>
      ${vividMetrics([
        { label: 'Stock-out within 7 days', value: U.fmt(critical.length), foot: `${U.fmt(ffRows.filter((r) => r.stockDays <= 7 && r.rate > 0).length)} FF · ${U.fmt(gvRows.filter((r) => r.stockDays <= 7 && r.rate > 0).length)} GV`, tone: critical.length ? 'g7' : 'g9', icon: '🚨' },
        { label: '7-day replenishment need', value: U.fmt(required7), foot: `Includes ${safetyDays} safety days`, tone: 'g4', icon: '🚚' },
        { label: '15-day replenishment need', value: U.fmt(required15), foot: `Demand ${growth >= 0 ? '+' : ''}${growth}%`, tone: 'g3', icon: '📦' },
        { label: '30-day replenishment need', value: U.fmt(required30), foot: 'Net of current stock', tone: 'g1', icon: '🗓️' },
        { label: 'Field stock (filtered)', value: U.fmt(totalStock), foot: `${U.fmt(totalRate.toFixed(1))} tags / day adjusted demand`, tone: 'g5', icon: '🏬' },
        { label: 'Average cover', value: coverText, foot: `${U.fmt(rows.length)} agents · ${U.fmt(rows.filter((r) => r.rate > 0).length)} with run-rate`, tone: 'g6', icon: '📊' }
      ])}
      <div class="risk-strip">${FORECAST_RISK_ORDER.map((rk) => { const n = count(rows, rk); return `<div class="risk-chip ${FORECAST_RISK_TONE[rk]}"><small>${rk}</small><b>${U.fmt(n)}</b><span>${all.length ? ((n / all.length) * 100).toFixed(0) : 0}% of ${U.fmt(all.length)} agents · need 7d ${U.fmt(sum(rows.filter((r) => r.risk === rk), (r) => r.need7))}</span></div>`; }).join('')}</div>
      <div class="ins-filters"><label>Channel<select class="select" data-param="channel"><option value="all">Both channels</option><option value="ff" ${channel === 'ff' ? 'selected' : ''}>First Forward</option><option value="gv" ${channel === 'gv' ? 'selected' : ''}>GV Partner</option></select></label><label>Risk<select class="select" data-param="risk">${['all','Critical','High','Medium','Covered','No run-rate'].map((v) => `<option value="${v}" ${v === risk ? 'selected' : ''}>${v === 'all' ? 'All risk levels' : v}</option>`).join('')}</select></label><form id="forecast-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="Agent, ID or TL…"><button class="btn">Search</button></form></div>
      <div class="card"><div class="card-head"><h3>🚨 Urgent dispatch list · top ${U.fmt(urgent.length)}</h3><span class="dim small">Critical + High risk aur positive 7-day need · pehle yahi dispatch karo</span><button class="btn small" id="forecast-urgent-csv">⬇ Urgent list CSV</button></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-rose">#</th><th class="tone-rose">Agent</th><th class="tone-rose">Channel</th><th class="tone-rose">TL</th><th class="tone-rose num">Stock</th><th class="tone-rose num">Demand / day</th><th class="tone-rose num">Cover days</th><th class="tone-rose">Stock-out</th><th class="tone-rose num">Need 7d</th><th class="tone-rose num">Need 15d</th><th class="tone-rose">Risk</th></tr></thead><tbody>${urgent.map((r, i) => `<tr${rowRiskClass(r.risk)}><td>${i + 1}</td><td><b class="agent-link" data-agent360="${esc(r.name || r.id)}" data-agent360-id="${esc(r.id || '')}" title="Agent 360 kholo">${esc(r.name || r.id || '')}</b><small>${esc(r.id || '')}</small></td><td>${statusPill(r.channel, r.channel === 'GV Partner' ? 'green' : 'blue')}</td><td>${esc(r.tlName || 'Direct / Unmapped')}</td><td class="num">${U.fmt(r.stock)}</td><td class="num">${r.rate.toFixed(1)}</td><td class="num"><b>${Number.isFinite(r.stockDays) ? r.stockDays.toFixed(1) : '—'}</b></td><td>${r.outDate ? dateText(r.outDate) : '—'}</td><td class="num"><b>${U.fmt(r.need7)}</b></td><td class="num">${U.fmt(r.need15)}</td><td>${statusPill(r.risk, FORECAST_RISK_PILL[r.risk])}</td></tr>`).join('') || `<tr><td colspan="11">${empty('Koi urgent dispatch nahi', 'Har filtered agent ka stock current run-rate ke liye kaafi hai.')}</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>🏢 Channel summary</h3><span class="dim small">FF demand = sirf First Forward channel ki issuance (GV rows · ID 5845036 exclude) — GV side alag GV Master se · double count nahi</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-teal">Channel</th><th class="tone-teal num">Agents</th><th class="tone-teal num">With run-rate</th><th class="tone-teal num">Stock</th><th class="tone-teal num">Demand / day</th><th class="tone-teal num">Cover days</th><th class="tone-teal num">Need 7d</th><th class="tone-teal num">Need 15d</th><th class="tone-teal num">Need 30d</th><th class="tone-teal num">Critical</th><th class="tone-teal num">High</th><th class="tone-teal num">No run-rate</th></tr></thead><tbody>${channelRows.map((c) => `<tr><td><b>${esc(c.channel)}</b></td><td class="num">${U.fmt(c.agents)}</td><td class="num">${U.fmt(c.active)}</td><td class="num">${U.fmt(c.stock)}</td><td class="num">${c.rate.toFixed(1)}</td><td class="num">${Number.isFinite(c.coverDays) ? c.coverDays.toFixed(1) : '—'}</td><td class="num">${U.fmt(c.need7)}</td><td class="num">${U.fmt(c.need15)}</td><td class="num">${U.fmt(c.need30)}</td><td class="num">${U.fmt(c.critical)}</td><td class="num">${U.fmt(c.high)}</td><td class="num">${U.fmt(c.noRate)}</td></tr>`).join('')}</tbody><tfoot><tr class="row-total"><td>Both channels</td><td class="num">${U.fmt(sum(channelRows, (c) => c.agents))}</td><td class="num">${U.fmt(sum(channelRows, (c) => c.active))}</td><td class="num">${U.fmt(sum(channelRows, (c) => c.stock))}</td><td class="num">${U.fmt(sum(channelRows, (c) => c.rate).toFixed(1))}</td><td class="num">${Number.isFinite(avgCover) ? avgCover.toFixed(1) : '—'}</td><td class="num">${U.fmt(required7)}</td><td class="num">${U.fmt(required15)}</td><td class="num">${U.fmt(required30)}</td><td class="num">${U.fmt(count(all, 'Critical'))}</td><td class="num">${U.fmt(count(all, 'High'))}</td><td class="num">${U.fmt(count(all, 'No run-rate'))}</td></tr></tfoot></table></div></div>
      <div class="card"><div class="card-head"><h3>👥 TL-wise replenishment rollup</h3><span class="dim small">${U.fmt(tlRows.length)} TL / direct groups · worst risk first</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-violet">TL / Direct</th><th class="tone-violet">Channel</th><th class="tone-violet num">Agents</th><th class="tone-violet num">Active</th><th class="tone-violet num">Stock</th><th class="tone-violet num">Demand / day</th><th class="tone-violet num">Cover days</th><th class="tone-violet num">Need 7d</th><th class="tone-violet num">Need 15d</th><th class="tone-violet num">Need 30d</th><th class="tone-violet">Worst risk</th><th class="tone-violet">Risk mix</th></tr></thead><tbody>${tlRows.map((t) => `<tr${rowRiskClass(t.worst)}><td><b>${esc(t.tlName)}</b></td><td>${statusPill(t.channel, t.channel === 'GV Partner' ? 'green' : 'blue')}</td><td class="num">${U.fmt(t.agents)}</td><td class="num">${U.fmt(t.active)}</td><td class="num">${U.fmt(t.stock)}</td><td class="num">${t.rate.toFixed(1)}</td><td class="num"><b>${Number.isFinite(t.coverDays) ? t.coverDays.toFixed(1) : '—'}</b></td><td class="num">${U.fmt(t.need7)}</td><td class="num">${U.fmt(t.need15)}</td><td class="num">${U.fmt(t.need30)}</td><td>${statusPill(t.worst, FORECAST_RISK_PILL[t.worst])}</td><td class="small">${FORECAST_RISK_ORDER.filter((rk) => t.risks[rk]).map((rk) => `${rk} ${U.fmt(t.risks[rk])}`).join(' · ')}</td></tr>`).join('') || `<tr><td colspan="12">${empty('No TL rows', 'Filter change karke dekhein.')}</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>Agent-level requirement forecast</h3><span class="dim small">Recommendation only · no dispatch approval workflow</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-blue">Agent</th><th class="tone-blue">Channel</th><th class="tone-blue num">Stock</th><th class="tone-blue num">Adjusted / day</th><th class="tone-blue num">Stock cover</th><th class="tone-blue">Projected stock-out</th><th class="tone-blue num">Safety units</th><th class="tone-blue num">Need · 7d</th><th class="tone-blue num">Need · 15d</th><th class="tone-blue num">Need · 30d</th></tr></thead><tbody>
        ${rows.map((r) => `<tr${rowRiskClass(r.risk)}><td><b class="agent-link" data-agent360="${esc(r.name || r.id)}" data-agent360-id="${esc(r.id || '')}" title="Agent 360 kholo">${esc(r.name || r.id)}</b><small>${esc(r.id || '')} · ${esc(r.tlName || 'Direct')}</small></td><td>${statusPill(r.channel, r.channel === 'GV Partner' ? 'green' : 'blue')}</td><td class="num">${U.fmt(r.stock)}</td><td class="num">${r.rate.toFixed(1)}<small>base ${r.baseRate.toFixed(1)}</small></td><td class="num">${statusPill(Number.isFinite(r.stockDays) ? `${r.stockDays.toFixed(1)} days` : 'No consumption', FORECAST_RISK_PILL[r.risk])}<small>${esc(r.risk)}</small></td><td>${r.outDate ? dateText(r.outDate) : '—'}</td><td class="num">${U.fmt(r.safety)}</td><td class="num"><b>${U.fmt(r.need7)}</b></td><td class="num">${U.fmt(r.need15)}</td><td class="num">${U.fmt(r.need30)}</td></tr>`).join('') || `<tr><td colspan="10">${empty('No forecast rows', 'Filter change karein ya source history badhne dein.')}</td></tr>`}
      </tbody></table></div></div>`;
    const gr = U.$('#growth-range', root), sr = U.$('#safety-range', root);
    gr.addEventListener('input', () => { U.$('#growth-out', root).textContent = `${Number(gr.value) >= 0 ? '+' : ''}${gr.value}%`; });
    sr.addEventListener('input', () => { U.$('#safety-out', root).textContent = sr.value; });
    U.$('#apply-scenario', root).addEventListener('click', () => FF.app.updateParams({ growth: gr.value, safety: sr.value }));
    U.$('#forecast-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    const forecastRowsExport = (list) => list.map((r) => [r.channel,r.id,r.name,r.tlName,r.stock,r.baseRate,r.rate,Number.isFinite(r.stockDays)?r.stockDays:'',r.outDate?U.dateKey(r.outDate):'',r.risk,r.safety,r.need7,r.need15,r.need30]);
    bindExports(root, 'forecast-export', `stock-forecast-${U.stamp()}`, 'Stock Forecast', FORECAST_AGENT_HEADERS, forecastRowsExport(rows), [
      { name: 'Urgent Dispatch', header: FORECAST_AGENT_HEADERS, rows: forecastRowsExport(urgent) },
      { name: 'TL Rollup', header: ['Channel','TL','Agents','Active','Stock','Demand per day','Cover days','Need 7d','Need 15d','Need 30d','Worst risk','Risk mix'], rows: tlRows.map((t) => [t.channel, t.tlName, t.agents, t.active, t.stock, t.rate, Number.isFinite(t.coverDays) ? t.coverDays : '', t.need7, t.need15, t.need30, t.worst, FORECAST_RISK_ORDER.filter((rk) => t.risks[rk]).map((rk) => `${rk} ${t.risks[rk]}`).join(' | ')]) },
      { name: 'Channel Summary', header: ['Channel','Agents','With run-rate','Stock','Demand per day','Cover days','Need 7d','Need 15d','Need 30d','Critical','High','No run-rate'], rows: channelRows.map((c) => [c.channel, c.agents, c.active, c.stock, c.rate, Number.isFinite(c.coverDays) ? c.coverDays : '', c.need7, c.need15, c.need30, c.critical, c.high, c.noRate]) }
    ]);
    const urgentCsv = U.$('#forecast-urgent-csv', root);
    if (urgentCsv) urgentCsv.addEventListener('click', () => U.downloadCsv(`stock-urgent-dispatch-${U.stamp()}.csv`, FORECAST_AGENT_HEADERS, forecastRowsExport(urgent)));
    bindMetricDetails(root, 'Stock forecast', FORECAST_AGENT_HEADERS, forecastRowsExport(rows), {
      'Stock-out within 7 days': { title: 'Agents with ≤ 7 days cover', headers: FORECAST_AGENT_HEADERS, rows: forecastRowsExport(all.filter((r) => r.stockDays <= 7 && r.rate > 0)) },
      '7-day replenishment need': { title: 'Agents needing stock in 7 days', headers: FORECAST_AGENT_HEADERS, rows: forecastRowsExport(all.filter((r) => r.need7 > 0)) },
      '15-day replenishment need': { title: 'Agents needing stock in 15 days', headers: FORECAST_AGENT_HEADERS, rows: forecastRowsExport(all.filter((r) => r.need15 > 0)) },
      '30-day replenishment need': { title: 'Agents needing stock in 30 days', headers: FORECAST_AGENT_HEADERS, rows: forecastRowsExport(all.filter((r) => r.need30 > 0)) },
      'Average cover': { title: 'Agent-wise cover days', headers: FORECAST_AGENT_HEADERS, rows: forecastRowsExport(all) }
    });
  }

  // ---- data quality -----------------------------------------------------------------------------
  const duplicateGroups = (rows, fn) => { const m = new Map(); rows.forEach((r) => { const k = fn(r); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return [...m.entries()].filter(([, list]) => list.length > 1); };
  async function qualityIssues() {
    if (mem.quality) return mem.quality;
    const [details, master, gvReport, daily] = await Promise.all([loadDetails(false), G.need('master'), G.need('report'), S.need('daily')]);
    await FF.pages.performance.ensureLoaded();
    const ffReport = FF.pages.performance.agents();
    const issues = [];
    const checks = [];
    let checksRun = 0;
    // `add()` har check ke liye call hoti hai (count 0 bhi) — isse "kitne checks pass hue" nikalta hai.
    const add = (severity, category, source, title, count, samples, action, sampleLabel) => {
      checksRun++;
      const list = (samples || []).map((s) => (typeof s === 'string' ? s : String(s == null ? '' : s)));
      checks.push({ severity, category, source, title, count: count || 0, sampleTotal: list.length, action, sampleLabel: sampleLabel || 'Detail' });
      if (count) issues.push({ severity, category, source, title, count, samples: list.slice(0, 300), sampleTotal: list.length, action, sampleLabel: sampleLabel || 'Detail' });
    };
    const dup = [
      ['GV Master tag IDs', duplicateGroups(details.rawMaster, (r) => normBarcode(r.tagId))],
      ['GV Master serials', duplicateGroups(details.rawMaster, (r) => normBarcode(r.serial))],
      ['Tag Assignment tag IDs', duplicateGroups(details.assignment, (r) => normBarcode(r.tagId))],
      ['Tag Assignment serials', duplicateGroups(details.assignment, (r) => normBarcode(r.serial))],
      ['StockDataa tag IDs', duplicateGroups(details.stock, (r) => normBarcode(r.tagId))],
      ['StockDataa barcodes', duplicateGroups(details.stock, (r) => normBarcode(r.barcode))]
    ];
    dup.forEach(([label, groups]) => add('high', 'Duplicates', label.split(' ')[0] === 'GV' ? 'GV Master' : label.startsWith('Tag') ? 'Tag Assignment' : 'StockDataa', `Duplicate ${label}`, groups.length, groups.map(([k, list]) => `${k} × ${list.length}${list.length <= 6 ? ` (${list.map((r) => r.agentName || r.agentId || 'unassigned').join(', ')})` : ''}`), 'Keep one authoritative row or verify legitimate reissue.', 'Duplicate value · occurrences · owners'));
    const directGvIds = new Set(master.filter(directAgent).map((r) => normId(r.agentId)).filter(Boolean));
    const directFfIds = new Set(ffReport.filter(directAgent).map((r) => normId(r.agentId || r.id)).filter(Boolean));
    const masterMissingId = details.rawMaster.filter((r) => !clean(r.agentId));
    const masterMissingTl = details.rawMaster.filter((r) => clean(r.agentId) && !clean(r.tlId) && !clean(r.tlName) && !directGvIds.has(normId(r.agentId)));
    const assignMissingAgent = details.assignment.filter((r) => !clean(r.agentId) || !clean(r.agentName));
    const assignMissingTl = details.assignment.filter((r) => !clean(r.tlId) && !clean(r.tlName) && !directGvIds.has(normId(r.agentId)));
    const stockMissingAgent = details.stock.filter((r) => !clean(r.agentId) || !clean(r.agentName));
    const stockMissingTl = details.stock.filter((r) => !clean(r.tlName) && !directFfIds.has(normId(r.agentId)));
    add('high','Missing identity','GV Master','GV Master rows without agent ID',masterMissingId.length,masterMissingId.map((r) => r.tagId || r.serial),'Populate the configured UNIQUE_ID field.','Tag / serial');
    add('medium','Missing TL','GV Master','GV Master rows without TL/direct identity',masterMissingTl.length,masterMissingTl.map((r) => `${r.agentId} ${r.agentName}`),'Set TL fields or an explicit Direct marker.','Agent ID · agent name');
    add('high','Unassigned stock','Tag Assignment','GV stock without complete agent assignment',assignMissingAgent.length,assignMissingAgent.map((r) => r.tagId || r.serial),'Assign agent ID and name before field movement.','Tag / serial');
    add('medium','Missing TL','Tag Assignment','GV stock without TL/direct identity',assignMissingTl.length,assignMissingTl.map((r) => `${r.agentId} ${r.agentName}`),'Set supervisor or explicit Direct marker.','Agent ID · agent name');
    add('high','Unassigned stock','StockDataa','FF stock without complete agent assignment',stockMissingAgent.length,stockMissingAgent.map((r) => r.tagId || r.barcode),'Populate agent ID and agent name.','Tag / barcode');
    add('medium','Missing TL','StockDataa','FF stock without TL/direct identity',stockMissingTl.length,stockMissingTl.map((r) => `${r.agentId} ${r.agentName}`),'Set TL Name or Direct marker.','Agent ID · agent name');
    const ffReportMissingTl = ffReport.filter((r) => !directAgent(r) && !clean(r.tlId) && !clean(r.tlName));
    const gvReportMissingTl = gvReport.filter((r) => !directAgent(r) && !clean(r.tlId) && !clean(r.tlName));
    add('high','Missing TL','FF REPORT','FF REPORT agents without TL/direct identity',ffReportMissingTl.length,ffReportMissingTl.map((r) => `${r.agentId} ${r.name}`),'Populate TL ID/name or explicit Direct category.','Agent ID · agent name');
    add('high','Missing TL','GV REPORT','GV REPORT agents without TL/direct identity',gvReportMissingTl.length,gvReportMissingTl.map((r) => `${r.agentId} ${r.agentName}`),'Populate supervisor ID/name or explicit Direct category.','Agent ID · agent name');
    const invalidDates = details.rawMaster.filter((r) => clean(r.rawDate) && !r.date);
    const blankDates = details.rawMaster.filter((r) => !clean(r.rawDate));
    const invalidStockDates = details.stock.filter((r) => (clean(r.agentAllocatedAt) && !U.parseDateTime(r.agentAllocatedAt)) || (clean(r.bcAllocatedAt) && !U.parseDateTime(r.bcAllocatedAt)));
    add('high','Invalid dates','GV Master','GV Master invalid issuance dates',invalidDates.length,invalidDates.map((r) => `${r.tagId}: ${r.rawDate}`),'Use a true Google Sheets date value.','Tag: raw date value');
    add('medium','Invalid dates','GV Master','GV Master blank issuance dates',blankDates.length,blankDates.map((r) => r.tagId || r.serial),'Populate issuance date.','Tag / serial');
    add('medium','Invalid dates','StockDataa','Invalid BC/agent allocation timestamps',invalidStockDates.length,invalidStockDates.map((r) => `${r.tagId}: ${r.agentAllocatedAt || r.bcAllocatedAt}`),'Use a recognized date-time value in allocation columns.','Tag: raw timestamp');
    const gvAssignmentIds = new Set(details.assignment.map((r) => normId(r.agentId)).filter(Boolean));
    const gvMasterIds = new Set(master.map((r) => normId(r.agentId)).filter(Boolean));
    const gvReportIds = new Set(gvReport.map((r) => normId(r.agentId)).filter(Boolean));
    const ffStockIds = new Set(details.stock.map((r) => normId(r.agentId)).filter(Boolean));
    const ffMissingStock = ffReport.filter((r) => normId(r.agentId) && !ffStockIds.has(normId(r.agentId)));
    const masterNotAssigned = [...gvMasterIds].filter((id) => !gvAssignmentIds.has(id));
    const reportNotAssigned = [...gvReportIds].filter((id) => !gvAssignmentIds.has(id));
    const knownGvUnique = new Set([...details.assignment.map((r) => normId(r.gvUniqueId)), ...details.rawMaster.map((r) => normId(r.gvUniqueId))].filter(Boolean));
    const badFfGvIds = ffReport.filter((r) => { const id = normId(r.gvIdFound); return id && !/^(NOTFOUND|NA|NONE)$/.test(id) && !knownGvUnique.has(id); });
    add('medium','Cross-sheet mismatch','FF REPORT ↔ StockDataa','REPORT agents absent from StockDataa assignment',ffMissingStock.length,ffMissingStock.map((r) => `${r.agentId} ${r.name}`),'Verify ID format or confirm zero-stock state.','Agent ID · agent name');
    add('high','Cross-sheet mismatch','FF REPORT ↔ GV identity','“GV ID Found” values absent from GV Master/Tag Assignment',badFfGvIds.length,badFfGvIds.map((r) => `${r.agentId}: ${r.gvIdFound}`),'Correct the GV unique ID; do not substitute an agent name.','Agent ID: GV ID Found');
    add('medium','Cross-sheet mismatch','GV Master ↔ Tag Assignment','Issuing GV agents absent from Tag Assignment',masterNotAssigned.length,masterNotAssigned,'Normalize agent IDs across GV tabs.','Agent ID');
    add('medium','Cross-sheet mismatch','GV REPORT ↔ Tag Assignment','GV REPORT agents absent from Tag Assignment',reportNotAssigned.length,reportNotAssigned,'Normalize agent IDs or confirm zero-stock state.','Agent ID');
    const latestGv = master.reduce((d, r) => r.date && (!d || r.date > d) ? r.date : d, null);
    const latestFf = M.latestDate(daily);
    const age = (d) => d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 864e5)) : 999;
    if (age(latestFf) > 2) add(age(latestFf) > 7 ? 'high' : 'medium','Stale data','EIR',`First Forward issuance is ${age(latestFf)} days stale`,1,[latestFf ? U.dateKey(latestFf) : 'No valid date'],'Refresh source or check EIR date mapping.','Latest date');
    if (age(latestGv) > 2) add(age(latestGv) > 7 ? 'high' : 'medium','Stale data','GV Master',`GV issuance is ${age(latestGv)} days stale`,1,[latestGv ? U.dateKey(latestGv) : 'No valid date'],'Refresh source or check GV Master date mapping.','Latest date');
    if (details.truncated && (details.truncated.stock || details.truncated.assignment)) add('high','Scan coverage','Detailed loaders','Raw detail scan hit the 250,000-row safety cap',1,[details.truncated.stock ? 'StockDataa capped' : '', details.truncated.assignment ? 'Tag Assignment capped' : ''].filter(Boolean),'Archive old rows or split the source so every detail row can be validated.','Source');
    const severityRank = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => (severityRank[a.severity] - severityRank[b.severity]) || b.count - a.count);
    const bySource = new Map();
    checks.forEach((c) => { const key = c.source; if (!bySource.has(key)) bySource.set(key, { source: key, checks: 0, findings: 0, high: 0, records: 0 }); const o = bySource.get(key); o.checks++; if (c.count) { o.findings++; o.records += c.count; if (c.severity === 'high') o.high++; } });
    const categories = [...new Set(checks.map((c) => c.category))].sort();
    const categoryRows = categories.map((cat) => { const list = checks.filter((c) => c.category === cat); const found = list.filter((c) => c.count); return { category: cat, checks: list.length, findings: found.length, records: sum(found, (c) => c.count), high: found.filter((c) => c.severity === 'high').length }; });
    mem.quality = {
      issues, checks, checksRun, passed: checksRun - issues.length, categoryRows,
      sources: [...bySource.values()].sort((a, b) => b.records - a.records || b.findings - a.findings),
      scanned: { stock: details.stock.length, assignment: details.assignment.length, master: details.rawMaster.length, ffReport: ffReport.length, gvReport: gvReport.length },
      latestFf, latestGv, checkedAt: new Date()
    };
    return mem.quality;
  }

  async function renderDataQuality(root, params) {
    const data = await qualityIssues();
    const severity = ['all','high','medium','low'].includes(params.severity) ? params.severity : 'all';
    const category = clean(params.category || 'all');
    const sourceFilter = clean(params.source || 'all');
    const q = clean(params.q).toLowerCase();
    const categories = [...new Set(data.checks.map((i) => i.category))].sort();
    const sources = [...new Set(data.checks.map((i) => i.source))].sort();
    const rows = data.issues.filter((i) => (severity === 'all' || i.severity === severity) && (category === 'all' || i.category === category) && (sourceFilter === 'all' || i.source === sourceFilter) && (!q || [i.title, i.source, i.category, i.action, i.samples.join(' ')].join(' ').toLowerCase().includes(q)));
    const high = data.issues.filter((i) => i.severity === 'high'), affected = sum(data.issues, (i) => i.count);
    const dayAge = (d) => (d ? `${Math.max(0, Math.floor((Date.now() - d.getTime()) / 864e5))} din purana` : 'koi valid date nahi');
    const sampleRows = rows.flatMap((i) => i.samples.slice(0, 60).map((s, idx) => [i.severity, i.category, i.source, i.title, i.sampleLabel, s, idx + 1]));
    const findingHeaders = ['Severity', 'Category', 'Source', 'Finding', 'Records', 'Samples'];
    const sampleHeaders = ['Severity', 'Category', 'Source', 'Finding', 'Sample field', 'Sample value', '#'];
    const dqSourceTone = (i) => `c${(i % 6) + 1}`;
    root.innerHTML = head('🧪', 'Data Quality Center', 'Duplicates · missing identities/TLs · unassigned stock · invalid/stale dates · cross-sheet mismatches — har check ka table, samples aur recommended correction', `${exportButtons('dq-export')} ${printButton}`) + `
      <div class="source-row">${Object.entries(data.scanned).map(([k,n]) => sourceChip(k, `${U.fmt(n)} rows scanned`)).join('')}<span class="dim small">Checked ${esc(dateTimeText(data.checkedAt))}</span></div>
      ${vividMetrics([
        { label: 'Findings', value: U.fmt(data.issues.length), foot: `${U.fmt(data.checksRun)} checks run · ${U.fmt(data.passed)} clean`, tone: data.issues.length ? 'g4' : 'g9', icon: '🔍' },
        { label: 'High severity', value: U.fmt(high.length), foot: `${U.fmt(data.issues.filter((i) => i.severity === 'medium').length)} medium · ${U.fmt(data.issues.filter((i) => i.severity === 'low').length)} low`, tone: high.length ? 'g2' : 'g9', icon: '🚨' },
        { label: 'Affected records / keys', value: U.fmt(affected), foot: 'Counts can overlap across checks', tone: 'g6', icon: '🧾' },
        { label: 'Checks passed', value: `${U.fmt(data.passed)} <small>/ ${U.fmt(data.checksRun)}</small>`, foot: data.checksRun ? `${((data.passed / data.checksRun) * 100).toFixed(1)}% clean` : 'No checks executed', tone: 'g5', icon: '✅' },
        { label: 'Latest FF data', value: data.latestFf ? dateText(data.latestFf) : '—', foot: dayAge(data.latestFf), tone: 'g1', icon: '🟦' },
        { label: 'Latest GV data', value: data.latestGv ? dateText(data.latestGv) : '—', foot: dayAge(data.latestGv), tone: 'g3', icon: '🟩' }
      ])}
      <div class="dq-source-grid">${data.sources.map((s, i) => `<div class="dq-source-card ${dqSourceTone(i)}"><b>${esc(s.source)}</b><small>${U.fmt(s.checks)} checks · ${U.fmt(s.findings)} findings</small><div class="dq-counts"><span>${s.high ? statusPill(`${U.fmt(s.high)} high`, 'red') : statusPill('No high severity', 'green')}</span><span>${statusPill(`${U.fmt(s.records)} records`, s.records ? 'amber' : '')}</span></div></div>`).join('') || '<div class="dq-source-card"><b>No source scanned</b><small>Mount a sheet tab to run checks.</small></div>'}</div>
      ${!data.issues.length ? `<div class="mapping-state success"><div class="mapping-icon">✓</div><div><h3>No issues found by the configured checks</h3><p>All scanned source rows passed the current validation rules (${U.fmt(data.checksRun)} checks).</p></div></div>` : ''}
      <div class="card"><div class="card-head"><h3>📋 Category-wise check summary</h3><span class="dim small">${U.fmt(data.categoryRows.length)} categories</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-teal">Category</th><th class="tone-teal num">Checks run</th><th class="tone-teal num">Findings</th><th class="tone-teal num">High severity</th><th class="tone-teal num">Affected records</th><th class="tone-teal">Status</th></tr></thead><tbody>${data.categoryRows.map((c) => `<tr><td><b>${esc(c.category)}</b></td><td class="num">${U.fmt(c.checks)}</td><td class="num">${U.fmt(c.findings)}</td><td class="num">${U.fmt(c.high)}</td><td class="num">${U.fmt(c.records)}</td><td>${c.findings ? statusPill(`${U.fmt(c.findings)} checks flagged`, c.high ? 'red' : 'amber') : statusPill('Clean', 'green')}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="ins-filters">
        <label>Severity<select class="select" data-param="severity"><option value="all">All severities</option>${['high','medium','low'].map((v) => `<option value="${v}" ${v === severity ? 'selected' : ''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></label>
        <label>Category<select class="select" data-param="category"><option value="all">All categories</option>${categories.map((v) => `<option value="${esc(v)}" ${v === category ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Source<select class="select" data-param="source"><option value="all">All sources</option>${sources.map((v) => `<option value="${esc(v)}" ${v === sourceFilter ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <form id="dq-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="Finding, source ya sample value…"><button class="btn">Search</button></form>
      </div>
      <div class="card"><div class="card-head"><h3>🚩 Findings table</h3><span class="dim small">${U.fmt(rows.length)} of ${U.fmt(data.issues.length)} findings · row click karke samples dekho</span><button class="btn small" id="dq-findings-csv">⬇ Findings CSV</button></div><div class="table-wrap"><table class="data-table ins-table" id="dq-findings"><thead><tr><th class="tone-rose">Severity</th><th class="tone-rose">Category</th><th class="tone-rose">Source</th><th class="tone-rose">Finding</th><th class="tone-rose num">Records</th><th class="tone-rose">Sample preview</th><th class="tone-rose">Recommended correction</th></tr></thead><tbody>${rows.map((i, idx) => `<tr class="finding-row sev-${i.severity}" data-finding="${idx}" data-sev="${i.severity}"><td><span class="sev-pill ${i.severity}">${i.severity === 'high' ? '● High' : i.severity === 'medium' ? '◆ Medium' : '○ Low'}</span></td><td>${esc(i.category)}</td><td>${esc(i.source)}</td><td><b>${esc(i.title)}</b><small>${U.fmt(i.count)} records · ${U.fmt(i.sampleTotal)} sample${i.sampleTotal === 1 ? '' : 's'} available</small></td><td class="num"><b>${U.fmt(i.count)}</b></td><td class="wrap"><div class="sample-chips">${i.samples.slice(0, 4).map((s) => `<code title="${esc(s)}">${esc(s.length > 42 ? `${s.slice(0, 42)}…` : s)}</code>`).join('')}${i.sampleTotal > 4 ? `<code>+${U.fmt(i.sampleTotal - 4)} more</code>` : ''}</div></td><td class="wrap">${esc(i.action)}</td></tr>`).join('') || `<tr><td colspan="7">${empty('No findings match these filters', 'Try another severity, category or source.')}</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>🔎 Sample rows · har finding ka data</h3><span class="dim small">${U.fmt(sampleRows.length)} sample rows ${sampleRows.length >= 200 ? '(capped — full list CSV/Excel me)' : ''}</span><button class="btn small" id="dq-samples-csv">⬇ Sample rows CSV</button></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-slate">Severity</th><th class="tone-slate">Category</th><th class="tone-slate">Source</th><th class="tone-slate">Finding</th><th class="tone-slate">Sample field</th><th class="tone-slate">Sample value</th></tr></thead><tbody>${sampleRows.slice(0, 200).map((r) => `<tr><td><span class="sev-pill ${r[0]}">${r[0]}</span></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td><td class="wrap"><code>${esc(r[5])}</code></td></tr>`).join('') || `<tr><td colspan="6">No sample rows for this filter.</td></tr>`}</tbody></table></div></div>`;
    const search = U.$('#dq-search', root);
    if (search) search.addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    root.querySelectorAll('.finding-row').forEach((tr) => tr.addEventListener('click', () => {
      const item = rows[Number(tr.dataset.finding)];
      if (!item) return;
      openInsDialog(root, `${item.title} · samples`, ['#', item.sampleLabel || 'Sample', 'Source'], item.samples.map((s, i) => [i + 1, s, item.source]), `${item.severity.toUpperCase()} · ${U.fmt(item.count)} affected records · ${U.fmt(item.sampleTotal)} samples · ${item.action}`);
    }));
    const findingExport = rows.map((i) => [i.severity, i.category, i.source, i.title, i.count, i.sampleTotal, i.samples.slice(0, 25).join(' | '), i.action]);
    const sampleExport = rows.flatMap((i) => i.samples.map((s, idx) => [i.severity, i.category, i.source, i.title, i.sampleLabel, s, idx + 1]));
    bindExports(root, 'dq-export', `data-quality-${U.stamp()}`, 'Data Quality', ['Severity','Category','Source','Finding','Count','Sample total','Samples','Recommended correction'], findingExport, [
      { name: 'Sample Rows', header: sampleHeaders, rows: sampleExport },
      { name: 'Check Summary', header: ['Category','Checks run','Findings','High severity','Affected records','Status'], rows: data.categoryRows.map((c) => [c.category, c.checks, c.findings, c.high, c.records, c.findings ? 'Flagged' : 'Clean']) },
      { name: 'Source Health', header: ['Source','Checks run','Findings','High severity','Affected records'], rows: data.sources.map((s) => [s.source, s.checks, s.findings, s.high, s.records]) }
    ]);
    const findingsCsv = U.$('#dq-findings-csv', root); if (findingsCsv) findingsCsv.addEventListener('click', () => U.downloadCsv(`data-quality-findings-${U.stamp()}.csv`, ['Severity','Category','Source','Finding','Count','Sample total','Samples','Recommended correction'], findingExport));
    const samplesCsv = U.$('#dq-samples-csv', root); if (samplesCsv) samplesCsv.addEventListener('click', () => U.downloadCsv(`data-quality-samples-${U.stamp()}.csv`, sampleHeaders, sampleExport));
    bindMetricDetails(root, 'Data quality', findingHeaders, findingExport, {
      'High severity': { title: 'High-severity findings', headers: findingHeaders, rows: findingExport.filter((r) => r[0] === 'high') },
      'Findings': { title: 'All findings', headers: findingHeaders, rows: findingExport },
      'Affected records / keys': { title: 'Affected records per finding', headers: findingHeaders, rows: findingExport }
    });
  }

  // ---- executive cockpit -----------------------------------------------------------------------
  async function renderExecutive(root) {
    const [daily, stockAgents, gvMaster, gvStockClass, gvReport] = await Promise.all([S.need('daily'), S.need('stockAgents'), G.need('master'), G.need('stockClass'), G.need('report')]);
    await FF.pages.performance.ensureLoaded();
    const ffMonths = M.months(daily), ffMonth = ffMonths.at(-1) || U.ymKey(new Date()), gvMonth = latestMonth(gvMaster);
    // FF side = sirf First Forward channel. EIR me GV Partner ke rows master ID 5845036 (configurable)
    // rakhte hain — unhe FF totals se exclude kiye bina FF + GV combined me double count hota hai.
    const ff = M.summary(daily, ffMonth, null, 'First Forward'), gv = G.summary(gvMonth);
    const gvRowsInEir = M.summary(daily, ffMonth).gv || 0;
    const ffLast = M.summary(daily, U.prevMonthKey(ffMonth), Math.min(ff.lastDay || 31, U.daysInMonth(U.prevMonthKey(ffMonth))), 'First Forward');
    const gvLast = G.summary(U.prevMonthKey(gvMonth), Math.min(gv.lastDay || 31, U.daysInMonth(U.prevMonthKey(gvMonth))));
    const ffStock = sum(stockAgents, (r) => r.n), gvStock = sum(gvStockClass, (r) => r.n);
    const ffAgents = FF.pages.performance.agents(), lowFf = ffAgents.filter((a) => (a.stockTotal || 0) > 0 && (a.avgTotal || 0) > 0 && (a.stockTotal / a.avgTotal) <= 7).length;
    const lowGv = gvReport.filter((a) => (a.stockTotal || 0) > 0 && (a.runrate || 0) > 0 && (a.stockTotal / a.runrate) <= 7).length;
    const gvRows = gvMaster.filter((r) => r.ym === gvMonth), commission = sum(gvRows, (r) => r.commission), amount = sum(gvRows, (r) => r.amount);
    // FF commission: pehle sheet earned amount; column na ho to REPORT rate × current issuance se
    // calculate karo (rate hai to "Unavailable" dikhana galat hai).
    let ffCommission = null, ffCommissionSrc = 'Rate/earned heading REPORT me nahi mili — Settings → FF REPORT commission column';
    try {
      const c = await ffCommissionData();
      const ownValue = (a) => (validValue(a.earned) ? a.earned : (validValue(a.computed) ? a.computed : null));
      const withVal = (c.agents || []).filter((a) => ownValue(a) !== null);
      if (withVal.length) {
        ffCommission = sum(withVal, ownValue);
        const earnedN = withVal.filter((a) => validValue(a.earned)).length;
        ffCommissionSrc = earnedN === withVal.length
          ? `REPORT earned amount · ${earnedN}/${c.agents.length} rows`
          : c.rateCol && !c.rateCol.missing && !c.rateIsPercent
            ? `Earned ${earnedN} + rate × tags (col ${c.rateCol.letter}) · ${withVal.length}/${c.agents.length} agents`
            : `Earned ${earnedN} + computed · ${withVal.length}/${c.agents.length} agents`;
      } else if (c.rateCol && !c.rateCol.missing) {
        ffCommissionSrc = c.rateIsPercent ? `Rate ${c.rateCol.letter} percent (%) hai — base amount chahiye` : `Rate ${c.rateCol.letter} mila par values khali — REPORT range / fresh sync check karo`;
      }
    } catch { /* source optional */ }
    const today = new Date(); today.setHours(0,0,0,0); const start = new Date(today); start.setDate(start.getDate() - 13);
    const labels = [], ffVals = [], gvVals = [];
    for (let i = 0; i < 14; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const k = U.dateKey(d); labels.push(d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})); ffVals.push(sum(daily.filter((r) => r.key === k && r.channel === 'First Forward'), (r) => r.n)); gvVals.push(gvMaster.filter((r) => r.date && U.dateKey(r.date) === k).length); }
    const top = aggregateGv(gvRows, 'agent').slice(0, 7);
    root.innerHTML = head('🧭','Management Executive Cockpit','One-screen business pulse · issuance, growth, stock cover, earnings and management exceptions', `${exportButtons('exec-export')} ${printButton}`) + `
      <div class="cockpit-banner"><div><small>Combined month-to-date issuance</small><strong>${U.fmt(ff.total + gv.total)}</strong><span>${esc(U.labelYM(ffMonth))} FF + ${esc(U.labelYM(gvMonth))} GV · FF se GV rows (ID ${esc(FF.config.eir.gvMasterId || '5845036')}) exclude — ${U.fmt(gvRowsInEir)} EIR rows double count nahi</span></div><div class="cockpit-split"><span>First Forward <b>${U.fmt(ff.total)}</b> ${U.deltaHtml(U.growth(ff.total,ffLast.total),{decimals:0})}</span><span>GV Partner <b>${U.fmt(gv.total)}</b> ${U.deltaHtml(U.growth(gv.total,gvLast.total),{decimals:0})}</span></div></div>
      <div class="ins-metrics">${metric('Projected month-end', U.fmt(ff.projected + gv.projected), `FF ${U.fmt(ff.projected)} · GV ${U.fmt(gv.projected)}`)}${metric('Combined field stock', U.fmt(ffStock + gvStock), `FF ${U.fmt(ffStock)} · GV ${U.fmt(gvStock)}`)}${metric('GV earned commission', money(commission,2), `${money(amount)} transaction amount`, 'good')}${metric('FF commission', ffCommission === null ? 'Unavailable' : money(ffCommission,2), esc(ffCommissionSrc), ffCommission === null ? '' : 'good')}</div>
      <div class="cockpit-grid"><div class="card span2"><div class="card-head"><h3>14-day channel pulse</h3><span class="dim small">Sheet-recorded issuances</span></div>${C.bars({labels,series:[{name:'First Forward',values:ffVals},{name:'GV Partner',values:gvVals}],height:230,showValues:false})}</div><div class="card"><div class="card-head"><h3>Management focus</h3></div><a class="focus-row ${lowFf+lowGv?'risk':''}" href="#/forecast?risk=High"><span>Stock cover ≤ 7 days</span><b>${U.fmt(lowFf+lowGv)}</b><small>FF ${lowFf} · GV ${lowGv}</small></a><a class="focus-row" href="#/dataQuality"><span>Run data quality checks</span><b>Open</b><small>Six source families</small></a><a class="focus-row" href="#/dualChannel"><span>Verified dual-channel agents</span><b>Review</b><small>Barcode + unique-ID evidence</small></a><a class="focus-row" href="#/followups?status=open"><span>Agent/TL follow-ups</span><b>Open</b><small>Owner and due-date timeline</small></a></div></div>
      <div class="split-cards"><div class="card"><div class="card-head"><h3>Channel operating summary</h3></div><div class="exec-channel"><div><b>First Forward</b><span>${U.fmt(ff.total)} issued · ${U.fmt(ffStock)} stock</span><small>${U.fmt(ff.vc4)} VC4 · ${U.fmt(ff.comm)} commercial · ${ff.activeDays} active days</small></div><div><b>GV Partner</b><span>${U.fmt(gv.total)} issued · ${U.fmt(gvStock)} stock</span><small>${U.fmt(gv.vc4)} VC4 · ${U.fmt(gv.comm)} commercial · ${gv.activeAgents} agents</small></div></div></div><div class="card"><div class="card-head"><h3>Top GV commission contributors</h3><a href="#/gvCommission">Full analysis →</a></div>${C.hbars({items:top.map((r)=>({label:r.label,sub:`${r.issuances} tags`,value:r.commission})),format:(v)=>money(v,0),valueLabel:'Commission'})}</div></div>`;
    bindExports(root, 'exec-export', `executive-cockpit-${U.stamp()}`, 'Executive Summary', ['Metric','First Forward','GV Partner','Combined'], [
      ['Month-to-date issuance',ff.total,gv.total,ff.total+gv.total],['Projected month-end',ff.projected,gv.projected,ff.projected+gv.projected],['Field stock',ffStock,gvStock,ffStock+gvStock],['VC4 issuance',ff.vc4,gv.vc4,ff.vc4+gv.vc4],['Commercial issuance',ff.comm,gv.comm,ff.comm+gv.comm],['Stock cover ≤ 7 days',lowFf,lowGv,lowFf+lowGv],['FF commission (earned / rate × tags)',ffCommission===null?'Unavailable':ffCommission,commission,ffCommission===null?'Partial · GV only':ffCommission+commission]
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

  function reset() { mem.details = null; mem.detailsPromise = null; mem.cross = null; mem.quality = null; mem.workspaceVersion++; mem.workspace = null; mem.workspacePromise = null; mem.forecastHistory = null; mem.forecastHistoryPromise = null; mem.payout = null; mem.payoutPromise = null; }

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
  // Page chrome helpers shared with cockpit.js (v3.8) so naye pages bilkul same look rakhein.
  const UI_KIT = { head, sourceChip, printButton, exportButtons, bindExports, vividMetrics, metric, statusPill, empty, money, validValue, clean, sum, normId, normName, segmentOf };
  FF.insights = { reset, loadDetails, buildCross, ffCommissionData, ffPayoutRates: loadPayoutRates, payoutExpected: payoutBreakdown, qualityIssues, forecastAccuracy, stockBalanceReconciliation, commissionSlabExpected: slabExpected, openInsDialog, forecastRows, slabVariance: slabVarianceRows, ui: UI_KIT };
})(window.FF);
