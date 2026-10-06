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
    return { name: getName(r) || getId(r) || 'Unknown agent', id: getId(r) || '', tl: FF.config.isDirectAgent && FF.config.isDirectAgent(r, channel) ? FF.config.directLabel(r, channel) : (getTl(r) || 'Direct / Unmapped'), count, actual, ...calc, variance, status: variance === null ? (calc.expected === null ? 'Rate not configured' : 'Actual payout unavailable') : Math.abs(variance) <= 0.01 ? 'Matches slab' : variance > 0 ? 'More actual than slab' : 'Less actual than slab' };
  });
  const latestMonth = (rows) => [...new Set((rows || []).map((r) => r.ym).filter(Boolean))].sort().pop() || U.ymKey(new Date());
  const directAgent = (row) => {
    const r = row || {};
    if (FF.config.isDirectAgent) {
      const ch = /first forward|^ff$/i.test(String(r.channel || r.source || '')) ? 'ff' : 'gv';
      if (FF.config.isDirectAgent(r, ch)) return true;
    }
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
  // Cards bindMetricDetails se clickable banti hain (has-detail class) → tap pill "Full data ↗".
  const metric = (label, value, foot, tone, icon) => {
    const vivid = /^g(?:[1-9]|1[0-2])$/.test(String(tone || ''));
    return `<div class="ins-metric ${vivid ? '' : (tone || '')}"${vivid ? ` data-tone="${tone}"` : ''}>${vivid && icon ? `<span class="ins-metric-icon" aria-hidden="true">${icon}</span>` : ''}<small>${esc(label)}</small><b>${value}</b><span>${foot || '&nbsp;'}</span><span class="ins-metric-tap" aria-hidden="true">🔎 Full data ↗</span></div>`;
  };
  // Vivid KPI row: takes [{ label, value, foot, tone, icon }] and renders colourful cards.
  const vividMetrics = (cards, extraClass) => `<div class="ins-metrics ${extraClass || ''}">${cards.map((c) => metric(c.label, c.value, c.foot, c.tone, c.icon)).join('')}</div>`;
  /** Readable number inside a KPI / table cell with the unit in small type. */
  const csvButton = (id, text) => `<button class="btn" id="${id}">⬇ ${esc(text || 'CSV')}</button>`;
  const exportButtons = (base) => `${csvButton(`${base}-csv`, 'CSV')}<button class="btn" id="${base}-xlsx">⬇ Excel</button>`;
  const printButton = '<button class="btn" onclick="window.print()">🖨 PDF / Print</button>';
  function bindMetricDetails(root, title, headers, rows, detailSets) {
    root.querySelectorAll('.ins-metrics .ins-metric').forEach((el) => {
      el.dataset.metricDetail = el.querySelector('small')?.textContent || 'Metric';
      el.classList.add('has-detail');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `${el.dataset.metricDetail}; click to view full data`);
      const open = () => {
        const old = root.querySelector('#metric-detail-dialog'); if (old) old.remove();
        const chosen = detailSets && detailSets[el.dataset.metricDetail] || {};
        const detailRows = chosen.rows || rows, detailHeaders = chosen.headers || headers, detailTitle = chosen.title || title;
        const stats = Array.isArray(chosen.stats) ? chosen.stats : [];
        const PAGE = 500;
        let shown = PAGE, current = detailRows;
        const bodyFor = (list, n) => list.slice(0, n || PAGE).map((r) => `<tr>${r.map((v) => `<td>${esc(v ?? '—')}</td>`).join('')}</tr>`).join('') || '';
        const dialog = document.createElement('dialog'); dialog.id = 'metric-detail-dialog'; dialog.className = 'ins-detail-dialog';
        dialog.innerHTML = `<div class="card-head"><h3>${esc(el.dataset.metricDetail)} · ${esc(detailTitle)}</h3><button class="btn small" data-close>Close</button></div>
          <div class="detail-stats">${stats.map((s) => `<span class="ins-pill">${esc(s)}</span>`).join('')}<span class="ins-pill">${U.fmt(detailRows.length)} total rows</span><span class="ins-pill" data-shown-pill></span></div>
          <div class="detail-toolbar"><input type="search" data-filter placeholder="Is table me search karo — naam, ID, TL, number…"><button class="btn small" data-csv>⬇ CSV</button></div>
          <div class="table-wrap"><table class="data-table ins-table"><thead><tr>${detailHeaders.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody data-body>${bodyFor(detailRows)}</tbody></table></div>
          <div class="detail-more" data-more hidden><button class="btn small" data-more-btn>⬇ Aur 500 dikhao</button> <button class="btn small" data-all-btn>Sab dikhao</button></div>
          <div class="detail-empty" data-none hidden>Is search se koi row nahi mili — filter hata ke dekho.</div>`;
        root.append(dialog);
        const filter = dialog.querySelector('[data-filter]');
        const paint = () => {
          dialog.querySelector('[data-body]').innerHTML = bodyFor(current, shown) || `<tr><td colspan="${detailHeaders.length}">No rows</td></tr>`;
          dialog.querySelector('[data-none]').hidden = current.length > 0;
          dialog.querySelector('[data-more]').hidden = current.length <= shown;
          dialog.querySelector('[data-shown-pill]').textContent = `${U.fmt(Math.min(shown, current.length))} / ${U.fmt(current.length)} dikh rahi`;
        };
        paint();
        filter.addEventListener('input', () => {
          const q = filter.value.trim().toLowerCase();
          current = q ? detailRows.filter((r) => (r || []).join(' ').toLowerCase().includes(q)) : detailRows;
          shown = PAGE; paint();
        });
        dialog.querySelector('[data-more-btn]').addEventListener('click', () => { shown += PAGE; paint(); });
        dialog.querySelector('[data-all-btn]').addEventListener('click', () => { shown = current.length; paint(); });
        dialog.querySelector('[data-csv]').addEventListener('click', () => U.downloadCsv(`${U.slug(el.dataset.metricDetail || 'metric')}-${U.stamp()}.csv`, detailHeaders, current));
        dialog.querySelector('[data-close]').onclick = () => dialog.close();
        dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
        if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
        filter.focus();
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
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

  async function ffCommissionData(fresh) {
    // v3.8.3: page instant open ho — pehli baar ke baar report analysis cache se aati hai.
    if (mem.ffComm && !fresh) return mem.ffComm;
    if (mem.ffCommPromise && !fresh) return mem.ffCommPromise;
    mem.ffCommPromise = (async () => {
      const out = await buildFfCommissionData();
      mem.ffComm = out; mem.ffCommPromise = null;
      return out;
    })();
    return mem.ffCommPromise;
  }

  async function buildFfCommissionData() {
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

  // ---- GV commission intelligence ---------------------------------------------------------------
  // GV Master remains the operational/commission register. Issuance quantities are attached from
  // the canonical EIR daily ledger so every tag count on this page is EIR-authoritative without
  // changing the exact sheet commission sums.
  const gvIssuanceN = (row) => Object.prototype.hasOwnProperty.call(row || {}, 'issuanceN')
    ? Math.max(0, Number(row.issuanceN) || 0)
    : Math.max(0, Number(row && row.n) || 1);


  /**
   * Agent × class commission matrix — har agent ke liye VC4 / VC20 / VC5+ ka commission ALAG
   * (exact sum). Koi blended average nahi; VC5+ ke andar exact class (VC5/VC6/…) split bhi.
   * Unique tags = distinct tag/serial count (duplicate sheet rows pakadne ke liye).
   * Rate (₹/tag) = sheet commission column se: sum(commission) ÷ jis row me value hai (paid rows).
   */

  // ---- GV personal commission · exact agent ID + exact vehicle class -------------------------------
  // This is intentionally separate from the existing VC4 / VC20 / VC5+ boards. The boards are
  // descriptive rollups; this table is the payout view requested by the user. VC4 defaults to
  // the exact current-month GV Master commission value for the same agent ID + VC4 row. No
  // cross-agent median, blended average, cut, or uplift is used.
  const GV_PERSONAL_CLASSES = ['VC4', 'VC20', 'VC5', 'VC6', 'VC7', 'VC12'];
  const gvPersonalSettings = () => {
    const saved = FF.config.gvCommissionRates || {};
    const defaults = { VC4: { source: 'master', rate: '' }, VC20: { source: 'manual', rate: '' }, VC5: { source: 'manual', rate: '' }, VC6: { source: 'manual', rate: '' }, VC7: { source: 'manual', rate: '' }, VC12: { source: 'manual', rate: '' } };
    const classes = {};
    GV_PERSONAL_CLASSES.forEach((cls) => {
      const item = { ...(defaults[cls] || {}), ...((saved.classes && saved.classes[cls]) || {}) };
      classes[cls] = { source: item.source === 'manual' ? 'manual' : (cls === 'VC4' ? 'master' : (item.source === 'master' ? 'master' : 'manual')), rate: item.rate === '' || item.rate === null || item.rate === undefined ? '' : Number(item.rate) };
    });
    return { enabled: saved.enabled !== false, currentMonthOnly: saved.currentMonthOnly !== false, classes };
  };
  const gvPersonalClassOf = (row) => {
    const cls = G.normClass ? G.normClass(row && row.cls) : clean(row && row.cls).toUpperCase().replace(/\s+/g, '');
    return GV_PERSONAL_CLASSES.includes(cls) ? cls : '';
  };
  function buildGvPersonalCommission(masterRows, monthOverride, issuanceRows) {
    const month = clean(monthOverride) || U.ymKey(new Date());
    const settings = gvPersonalSettings();
    const scoped = (masterRows || []).filter((r) => !month || r.ym === month);
    // The public helper is also used by lightweight integrations that predate the EIR adapter.
    // An omitted third argument means "no canonical adapter supplied"; the live page always
    // passes an array from G.issuanceRows(), including an intentionally empty EIR result.
    const canonical = Array.isArray(issuanceRows) ? issuanceRows.filter((r) => !month || r.ym === month) : scoped;
    const people = new Map();
    const ensurePerson = (r) => {
      const agentId = clean(r.agentId), agentName = clean(r.agentName) || agentId;
      const key = normId(agentId) || `N:${normName(agentName)}`;
      if (!key) return null;
      if (!people.has(key)) people.set(key, { agentId, agentName, tlName: clean(r.tlName) || 'Direct', tlId: clean(r.tlId), directAgent: false, classes: {} });
      const person = people.get(key);
      if (!person.agentId && agentId) person.agentId = agentId;
      if (!person.agentName && agentName) person.agentName = agentName;
      if (!person.tlName && r.tlName) person.tlName = clean(r.tlName);
      return person;
    };
    scoped.forEach((r) => {
      const cls = gvPersonalClassOf(r);
      if (!cls) return;
      // Agent ID is the primary key by design. Name is only a safe fallback for malformed rows
      // that have no ID; it can never merge two different IDs.
      const person = ensurePerson(r);
      if (!person) return;
      const current = person.classes[cls] || { cls, tags: 0, paidRows: 0, sheetCommission: 0, rateValues: new Map(), sourceRows: 0 };
      current.sourceRows += 1;
      const rawCommission = r.commission;
      // gv.js preserves an explicit commissionHasValue=false when the source cell is blank;
      // do not reinterpret its normalized zero as a real rate. Test fixtures without the flag
      // remain backward-compatible and are treated as numeric source values.
      const hasValue = gvRowHasCommission(r);
      if (hasValue) {
        const value = Number(rawCommission) || 0;
        current.paidRows += 1; current.sheetCommission += value;
        const rateKey = value.toFixed(8);
        current.rateValues.set(rateKey, (current.rateValues.get(rateKey) || 0) + 1);
      }
      person.classes[cls] = current;
      person.directAgent = person.directAgent || !!r.directAgent || directAgent(r);
    });
    // Tags come only from EIR. GV Master rows above contribute commission/operational fields,
    // while this pass supplies quantity-aware class counts (including aggregated EIR rows).
    canonical.forEach((r) => {
      const cls = gvPersonalClassOf(r);
      if (!cls) return;
      const person = ensurePerson(r);
      if (!person) return;
      const current = person.classes[cls] || { cls, tags: 0, paidRows: 0, sheetCommission: 0, rateValues: new Map(), sourceRows: 0 };
      current.tags += Math.max(0, Number(r.n) || 1);
      person.classes[cls] = current;
      person.directAgent = person.directAgent || !!r.directAgent || directAgent(r);
    });
    const agents = [...people.values()].map((person) => {
      const classes = {};
      let personalCommission = 0, sheetCommission = 0, hasPersonal = false, hasSheet = false;
      const missing = [];
      GV_PERSONAL_CLASSES.forEach((cls) => {
        const raw = person.classes[cls] || { cls, tags: 0, paidRows: 0, sheetCommission: 0, rateValues: new Map(), sourceRows: 0 };
        const setting = settings.classes[cls];
        const rateList = [...raw.rateValues.keys()].map(Number);
        const mixed = rateList.length > 1;
        const masterRate = rateList.length === 1 ? rateList[0] : null;
        let amount = null, rate = null, source = 'Not configured', status = raw.tags ? 'Rate missing' : 'No tags';
        const sheetAmount = raw.paidRows ? raw.sheetCommission : null;
        if (sheetAmount !== null) { sheetCommission += sheetAmount; hasSheet = true; }
        if (settings.enabled !== false && setting.source === 'master') {
          // Master mode is a row-faithful source. If a class has mixed rates, show the exact
          // row sum and label it mixed rather than replacing it with an average.
          if (sheetAmount !== null) { amount = sheetAmount; hasPersonal = true; }
          rate = masterRate;
          source = mixed ? 'GV Master · mixed rows' : sheetAmount !== null ? 'GV Master · exact row rate' : 'GV Master · commission blank';
          status = !raw.tags ? 'No tags' : !raw.paidRows ? 'Commission blank in GV Master' : mixed ? 'Mixed rates · exact sum' : 'Matched agent ID + class';
        } else if (settings.enabled !== false && setting.source === 'manual' && Number.isFinite(Number(setting.rate)) && setting.rate !== '') {
          rate = Number(setting.rate); amount = raw.tags * rate; hasPersonal = true;
          source = 'Manual setting'; status = raw.tags ? 'Configured' : 'No tags';
        } else if (settings.enabled === false) {
          status = raw.tags ? 'Personal table off' : 'No tags';
        }
        if (raw.tags && amount === null) missing.push(cls);
        if (amount !== null) personalCommission += amount;
        classes[cls] = {
          cls, tags: raw.tags, paidRows: raw.paidRows, sheetCommission: sheetAmount, rate, masterRate,
          personalCommission: amount, source, status, mixed, complete: raw.tags === 0 || (raw.paidRows === raw.tags && amount !== null)
        };
      });
      const directRow = { agentId: person.agentId, agentName: person.agentName, tlId: person.tlId, tlName: person.tlName, channel: 'GV Partner' };
      return {
        agentId: person.agentId, agentName: person.agentName, tlId: person.tlId, tlName: person.directAgent ? 'Direct' : person.tlName,
        directAgent: person.directAgent || directAgent(directRow), classes, personalCommission: hasPersonal ? personalCommission : null,
        sheetCommission: hasSheet ? sheetCommission : null, missingClasses: missing, complete: missing.length === 0, month
      };
    }).sort((a, b) => (Number(b.personalCommission) || 0) - (Number(a.personalCommission) || 0) || (Number(b.sheetCommission) || 0) - (Number(a.sheetCommission) || 0) || String(a.agentName).localeCompare(String(b.agentName)));
    const byId = new Map(); agents.forEach((a) => { if (a.agentId) byId.set(normId(a.agentId), a); });
    const totals = { agents: agents.length, tags: 0, personalCommission: 0, sheetCommission: 0, configuredClasses: {}, missingRates: 0 };
    GV_PERSONAL_CLASSES.forEach((cls) => { totals.configuredClasses[cls] = { tags: 0, personalCommission: 0, sheetCommission: 0, rateSource: settings.classes[cls].source }; });
    agents.forEach((a) => GV_PERSONAL_CLASSES.forEach((cls) => { const c = a.classes[cls]; totals.tags += c.tags; totals.configuredClasses[cls].tags += c.tags; if (c.personalCommission !== null) { totals.personalCommission += c.personalCommission; totals.configuredClasses[cls].personalCommission += c.personalCommission; } if (c.sheetCommission !== null) { totals.sheetCommission += c.sheetCommission; totals.configuredClasses[cls].sheetCommission += c.sheetCommission; } if (c.tags && c.personalCommission === null) totals.missingRates += 1; }));
    return { month, settings, agents, byId, totals, source: 'GV Master' };
  }
  const gvRowHasCommission = (row) => row && (row.commissionHasValue === true || (row.commissionHasValue === undefined && row.commission !== null && row.commission !== undefined && row.commission !== '' && Number.isFinite(Number(row.commission))));
  const gvPersonalRowValue = (row, settings) => {
    const cls = gvPersonalClassOf(row);
    if (!cls || !settings || settings.enabled === false) return { cls, amount: null, source: 'Personal table off' };
    const setting = settings.classes[cls] || {};
    if (setting.source === 'master') return { cls, amount: gvRowHasCommission(row) ? (Number(row.commission) || 0) : null, source: 'GV Master' };
    if (setting.source === 'manual' && setting.rate !== '' && Number.isFinite(Number(setting.rate))) return { cls, amount: Number(setting.rate), source: 'Manual setting' };
    return { cls, amount: null, source: 'Rate not set' };
  };
  async function gvPersonalCommission(monthOverride) {
    const [master] = await Promise.all([G.need('master'), S.need('daily').catch(() => [])]);
    return buildGvPersonalCommission(master, monthOverride, G.issuanceRows ? G.issuanceRows() : undefined);
  }

  // Add-on analytics for the current personal payout view. They intentionally keep two values
  // visible: GV Master exact commission and the configured personal amount. Manual rates must never
  // overwrite the source amount silently, so unresolved rows stay null and are counted.
  function gvCommissionDailyTrend(rows, settings) {
    const map = new Map();
    (rows || []).forEach((row) => {
      const date = row && row.date instanceof Date ? row.date : (U.parseDate ? U.parseDate(row && row.date) : null);
      if (!date || !Number.isFinite(date.getTime())) return;
      const key = U.dateKey(date);
      if (!map.has(key)) map.set(key, { key, date, tags: 0, agents: new Set(), sheetCommission: 0, personalCommission: 0, personalRows: 0, unresolvedRows: 0, classes: {} });
      const day = map.get(key);
      const n = gvIssuanceN(row);
      day.tags += n; day.agents.add(normId(row.agentId) || normName(row.agentName) || 'UNKNOWN');
      const cls = gvPersonalClassOf(row) || row.cls || 'NA'; day.classes[cls] = (day.classes[cls] || 0) + n;
      if (gvRowHasCommission(row)) day.sheetCommission += Number(row.commission) || 0;
      const personal = gvPersonalRowValue(row, settings || gvPersonalSettings());
      if (personal.amount === null) day.unresolvedRows += 1;
      else { day.personalRows += 1; day.personalCommission += personal.amount; }
    });
    const out = [...map.values()].sort((a, b) => a.date - b.date).map((day) => ({ ...day, agents: day.agents.size, personalCommission: day.personalRows ? day.personalCommission : null, classMix: classMix(day.classes) }));
    return { days: out, totals: { days: out.length, tags: sum(out, (r) => r.tags), agents: new Set((rows || []).map((r) => normId(r.agentId) || normName(r.agentName)).filter(Boolean)).size, sheetCommission: sum(out, (r) => r.sheetCommission), personalCommission: sum(out, (r) => r.personalCommission), unresolvedRows: sum(out, (r) => r.unresolvedRows) } };
  }
  function gvCommissionTlSummary(agents) {
    const map = new Map();
    (agents || []).forEach((agent) => {
      const direct = !!agent.directAgent;
      const label = direct ? 'Direct Agents' : (clean(agent.tlName) || (clean(agent.tlId) ? `TL ${clean(agent.tlId)}` : 'Direct / Unmapped'));
      const key = direct ? 'DIRECT' : (normId(agent.tlId) ? `ID:${normId(agent.tlId)}` : `NAME:${normName(label) || 'UNMAPPED'}`);
      if (!map.has(key)) map.set(key, { key, label, agents: 0, tags: 0, pricedTags: 0, personalCommission: 0, hasPersonal: false, sheetCommission: 0, hasSheet: false, missingAgents: 0, classes: {}, topAgent: null });
      const group = map.get(key); group.agents += 1;
      const personal = agent.personalCommission === null || agent.personalCommission === undefined ? null : Number(agent.personalCommission);
      const sheet = agent.sheetCommission === null || agent.sheetCommission === undefined ? null : Number(agent.sheetCommission);
      if (personal !== null && Number.isFinite(personal)) { group.personalCommission += personal; group.hasPersonal = true; }
      if (sheet !== null && Number.isFinite(sheet)) { group.sheetCommission += sheet; group.hasSheet = true; }
      if (agent.missingClasses && agent.missingClasses.length) group.missingAgents += 1;
      GV_PERSONAL_CLASSES.forEach((cls) => { const cell = agent.classes && agent.classes[cls]; const tags = Number(cell && cell.tags) || 0; group.tags += tags; group.classes[cls] = (group.classes[cls] || 0) + tags; const priced = cell && String(cell.source || '').startsWith('GV Master') ? Math.min(tags, Number(cell.paidRows) || 0) : (tags && cell && cell.personalCommission !== null && cell.personalCommission !== undefined ? tags : 0); group.pricedTags += priced; });
      if (personal !== null && Number.isFinite(personal) && (!group.topAgent || personal > group.topAgent.amount)) group.topAgent = { name: agent.agentName || agent.agentId || 'Unknown agent', id: agent.agentId || '', amount: personal };
    });
    return [...map.values()].map((group) => ({ ...group, personalCommission: group.hasPersonal ? group.personalCommission : null, sheetCommission: group.hasSheet ? group.sheetCommission : null, coveragePct: group.tags ? (group.pricedTags / group.tags) * 100 : 0, difference: group.hasPersonal && group.hasSheet ? group.personalCommission - group.sheetCommission : null, classMix: classMix(group.classes) })).sort((a, b) => (Number(b.personalCommission) || 0) - (Number(a.personalCommission) || 0) || (Number(b.sheetCommission) || 0) - (Number(a.sheetCommission) || 0) || b.tags - a.tags || a.label.localeCompare(b.label));
  }
  function gvCommissionAgentRanking(agents) {
    const rows = (agents || []).map((agent) => {
      let tags = 0, pricedTags = 0, classCount = 0;
      GV_PERSONAL_CLASSES.forEach((cls) => { const cell = agent.classes && agent.classes[cls]; const n = Number(cell && cell.tags) || 0; tags += n; if (n) classCount += 1; const priced = cell && String(cell.source || '').startsWith('GV Master') ? Math.min(n, Number(cell.paidRows) || 0) : (n && cell && cell.personalCommission !== null && cell.personalCommission !== undefined ? n : 0); pricedTags += priced; });
      const personal = agent.personalCommission === null || agent.personalCommission === undefined ? null : Number(agent.personalCommission);
      const sheet = agent.sheetCommission === null || agent.sheetCommission === undefined ? null : Number(agent.sheetCommission);
      const coveragePct = tags ? (pricedTags / tags) * 100 : 0;
      return { agentId: agent.agentId || '', agentName: agent.agentName || agent.agentId || 'Unknown agent', tlName: agent.directAgent ? 'Direct Agents' : (agent.tlName || 'Direct / Unmapped'), directAgent: !!agent.directAgent, tags, classCount, pricedTags, personalCommission: personal, sheetCommission: sheet, coveragePct, personalRate: personal !== null && pricedTags ? personal / pricedTags : null, exactRate: sheet !== null && tags ? sheet / tags : null, missingClasses: agent.missingClasses || [], status: agent.missingClasses && agent.missingClasses.length ? `Partial · ${agent.missingClasses.join(', ')}` : coveragePct < 100 ? `Partial · ${coveragePct.toFixed(0)}% source coverage` : 'Complete' };
    }).sort((a, b) => (a.personalCommission === null) - (b.personalCommission === null) || (Number(b.personalCommission) || 0) - (Number(a.personalCommission) || 0) || b.tags - a.tags || a.agentName.localeCompare(b.agentName));
    let payoutRank = 0;
    return rows.map((row, index) => ({ ...row, rank: index + 1, payoutRank: row.personalCommission === null ? null : ++payoutRank }));
  }


  // ---- GV commission · separate board per vehicle class (VC4 / VC20 / VC5+) ----------------------
  // Class group GV Master ke `group` field se aata hai (VC4 · VC20 · VC5+), isliye VC5/VC12/VC16
  // sab "VC5+" board me aate hain aur exact class breakdown board ke andar dikhta hai.
  const personalRate = (value) => value === null || value === undefined ? '—' : money(value, 4);



  // ---- FF reported commission ------------------------------------------------------------------

  /** Admin one-click mapping: REPORT me jo heading mili usi ko rate / earned / category / date set karo. */


  // ---- verified dual-channel identity ------------------------------------------------------------
  async function buildCross() {
    if (mem.cross) return mem.cross;
    const [details, master] = await Promise.all([loadDetails(false), G.need('master'), S.need('daily').catch(() => [])]);
    const issuance = G.issuanceRows ? G.issuanceRows() : [];
    const [gvStock, ffStock] = await Promise.all([G.need('stockAgent'), S.need('stockAgents')]);
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

    const month = latestMonth(issuance);
    const gvMonth = issuance.filter((r) => r.ym === month);
    const gvOperationalMonth = master.filter((r) => r.ym === month);
    const gvAgg = new Map();
    gvMonth.forEach((r) => mapAdd(gvAgg, gvKey(r.agentId, r.agentName), () => ({ issuance: 0, amount: 0, commission: 0, classes: {} }), (o) => { const n = Math.max(0, Number(r.n) || 1); o.issuance += n; o.classes[r.cls || 'NA'] = (o.classes[r.cls || 'NA'] || 0) + n; }));
    // Exact transaction amount/commission stays on GV Master; it is not used for issuance count.
    gvOperationalMonth.forEach((r) => mapAdd(gvAgg, gvKey(r.agentId, r.agentName), () => ({ issuance: 0, amount: 0, commission: 0, classes: {} }), (o) => { o.amount += r.amount || 0; o.commission += r.commission || 0; }));
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
  // 👻 Ghost holders — double-mapping me count nahi hote:
  //  FF side "APNA PAYEMENT" / master ID 5845036 = GV channel ka stock jo FF StockDataa me parked hai,
  //  GV side "NOT ASSIGNED" / blank ID = abhi kisi agent ko diya hi nahi gaya.
  const GHOST_ID_RE = /^(NOT\s*ASSIGNED|NOTASSIGNED|UNASSIGNED|NA|N\/A|NONE|NO\s*ID|-|—)$/i;
  const isGvMasterFfHolder = (name, id) => {
    if (normId(id) === normId(FF.config.eir.gvMasterId || '5845036')) return true;
    return /^apna\s*pay/i.test(clean(name));
  };
  const isUnassignedGvHolder = (name, id) => {
    const i = clean(id), n = clean(name);
    if (!i && !n) return true;
    return GHOST_ID_RE.test(i) || /^not\s*assigned/i.test(`${i} ${n}`);
  };

  async function renderDualChannel(root, params) {
    const data = await buildCross();
    const q = clean(params.q).toLowerCase(), method = ['all','barcode','gv-id','both'].includes(params.method) ? params.method : 'all';
    const onlyDouble = params.dup === 'double';
    const rows = data.rows.filter((r) => (!q || [r.ff.name,r.ff.id,r.gv.name,r.gv.id,r.ff.tlName,r.gv.tlName].join(' ').toLowerCase().includes(q)) && (method === 'all' || method === 'both' ? (method === 'all' || r.methods.length > 1) : r.methods.includes(method)));
    const barcodeRows = (data.barcodeAudit || []).filter((b) => (!q || [b.ff && b.ff.name,b.ff && b.ff.id,b.ff && b.ff.tlName,b.gv && b.gv.name,b.gv && b.gv.id,b.gv && b.gv.tlName, b.ffBarcode, b.gvSerial].join(' ').toLowerCase().includes(q)) && (method === 'all' || method === 'barcode' || (method === 'both' ? b.methods.length > 1 : b.methods.includes(method)))).map((b) => ({ ...b, ffAgent: b.ff && (b.ff.name || b.ff.id) || b.ffAgentName, ffId: b.ff && b.ff.id || b.ffAgentId, ffTl: b.ff && b.ff.tlName || b.ffTlName || '', gvAgent: b.gv && (b.gv.name || b.gv.id) || b.gvAgentName, gvId: b.gv && b.gv.id || b.gvAgentId, gvTl: b.gv && b.gv.tlName || b.gvTlName || '' }));
    // ---- double-mapping flags: repeated inside a source, owner change, ya FF ↔ GV owner alag ----
    // Rule (v3.8.3): barcode "double" TAB HI hai jab FF holder Apna Payment (GV master) NAHI hai
    // aur GV side ke paas not-assigned ke alawa ek asli ID hai. Ghost-holder matches = normal flow.
    const flaggedBarcodeRows = barcodeRows.map((b) => {
      const ffDup = b.ffOccurrences > 1 || b.ffOwnerCount > 1;
      const gvDup = b.gvOccurrences > 1 || b.gvOwnerCount > 1;
      const crossOwner = barcodeOwnerKey('ff', b) !== barcodeOwnerKey('gv', b);
      const ffGhost = isGvMasterFfHolder(b.ffAgent, b.ffId);
      const gvGhost = isUnassignedGvHolder(b.gvAgent, b.gvId);
      if (ffGhost || gvGhost) {
        const reasons = [ffGhost ? 'FF side GV master (Apna Payment) — GV channel stock, double count nahi' : '', gvGhost ? 'GV side not-assigned/blank — abhi kisi agent ke paas nahi' : ''].filter(Boolean);
        return { ...b, ffDup, gvDup, crossOwner, ffGhost, gvGhost, ghost: true, doubleMapped: false, reasons };
      }
      const reasons = [ffDup ? 'FF me ek se zyada rows/owners' : '', gvDup ? 'GV me ek se zyada rows/owners' : '', crossOwner ? 'FF aur GV me alag agent' : ''].filter(Boolean);
      return { ...b, ffDup, gvDup, crossOwner, ffGhost, gvGhost, ghost: false, doubleMapped: reasons.length > 0, reasons };
    });
    const doubleRows = flaggedBarcodeRows.filter((b) => b.doubleMapped);
    const ghostRows = flaggedBarcodeRows.filter((b) => b.ghost);
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
    const doubleRowHtml = (b) => `<tr class="${b.doubleMapped ? 'dup-row' : ''}"><td><b>${esc(U.barcode(b.ffBarcode))}</b><small>GV serial: ${esc(U.barcode(b.gvSerial) || '—')}</small></td><td>${b.doubleMapped ? statusPill('YES · review', 'red') : statusPill('Matched once', 'green')}</td><td class="wrap">${b.reasons.length ? esc(b.reasons.join(' · ')) : '<span class="dim">Same owner, one row per channel</span>'}</td><td><b>${esc(b.ffAgent || '—')}</b><small>${esc(b.ffId || '')} · TL ${esc(b.ffTl || 'Direct / Unmapped')} · ${esc(b.ffClass || '—')}</small></td><td><b>${esc(b.gvAgent || '—')}</b><small>${esc(b.gvId || '')} · TL ${esc(b.gvTl || 'Direct / Unmapped')} · ${esc(b.gvClass || '—')}</small></td><td class="num">${U.fmt(b.ffOccurrences)} / ${U.fmt(b.ffOwnerCount)}</td><td class="num">${U.fmt(b.gvOccurrences)} / ${U.fmt(b.gvOwnerCount)}</td><td>${b.verified ? statusPill('Resolved pair', 'green') : statusPill('Ambiguous pair · review', 'red')}</td></tr>`;
    root.innerHTML = head('🔗', 'Cross Channel · Dual-Agent Intelligence', 'Verified joins only: normalized barcode (StockDataa ↔ Tag Assignment) and/or FF “GV ID Found” ↔ GV unique ID · name-only guesses never used', `<button class="btn primary" id="cross-double-csv">⬇ Double-mapped barcodes CSV</button> ${exportButtons('cross-export')} ${printButton}`) + `
      <div class="source-row">${sourceChip('StockDataa', `${U.fmt(data.scanned.ffStock)} barcode rows`)}${sourceChip('Tag Assignment', `${U.fmt(data.scanned.gvAssignment)} serial rows`)}${sourceChip('FF REPORT', `${U.fmt(data.scanned.ffAgents)} identities`)}${sourceChip('GV Master', `${U.fmt(data.scanned.gvAgents)} identities`)}<span class="dim small">Double-mapped = ek hi tag 2 jagah (cross-channel owner change ya ek hi source me repeat)</span></div>
      ${data.truncated && (data.truncated.stock || data.truncated.assignment) ? `<div class="mapping-state warn"><b>Detailed identity scan reached the 250,000-row safety cap.</b><span>Results are explicitly partial; archive old assignment rows or narrow the source tab.</span></div>` : ''}
      ${vividMetrics([
        { label: 'Dual (verified) agents', value: U.fmt(rows.length), foot: `${U.fmt(rows.filter((r) => r.methods.length > 1).length)} verified by both signals`, tone: 'g6', icon: '🔗' },
        { label: 'Double-mapped barcodes', value: U.fmt(doubleRows.length), foot: `${U.fmt(doubleAgents)} agents involved · ${U.fmt(matchedRows.length)} clean · ${U.fmt(ghostRows.length)} ghost-holder ignore (Apna Payment / not-assigned)`, tone: doubleRows.length ? 'g7' : 'g9', icon: '🚨' },
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
      <div class="card card-danger"><div class="card-head"><h3>🚨 Double-mapped barcodes · same tag do jagah</h3>${doubleRows.length ? statusPill(`${U.fmt(doubleRows.length)} review required`, 'red') : statusPill('Koi double mapping nahi mili', 'green')}<div class="btn-row"><button class="btn primary" id="cross-double-csv-2">⬇ Double-mapped barcodes CSV</button><button class="btn small" id="cross-barcode-csv">⬇ Saari shared barcodes CSV</button></div></div>
        <p class="dim small">Rows jahan (a) FF aur GV me <b>alag agent</b> hai, ya (b) ek hi source me wahi barcode <b>ek se zyada rows/owners</b> me hai. Yehi "double map" cases hote hain jinme tag pehle verify karna chahiye. Allocation dates ke saath poori list CSV me milti hai. <b>Exclude rule:</b> FF side <b>Apna Payment / master ID ${esc(FF.config.eir.gvMasterId || '5845036')}</b> holder aur GV side <b>not-assigned / blank ID</b> matches double nahi maane jaate — wo normal channel flow hai (${U.fmt(ghostRows.length)} aise matches ignore hue).</p>
        <div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-rose">Barcode (FF) ↔ Serial (GV)</th><th class="tone-rose">Double-mapped?</th><th class="tone-rose">Why</th><th class="tone-rose">FF agent · TL · class</th><th class="tone-rose">GV agent · TL · class</th><th class="tone-rose num">FF rows / owners</th><th class="tone-rose num">GV rows / owners</th><th class="tone-rose">Agent pair</th></tr></thead><tbody>${doubleRows.slice(0, 150).map(doubleRowHtml).join('') || `<tr><td colspan="8">${empty('No double-mapped barcode', 'Har shared barcode ka FF aur GV owner same hai aur dono sources me ek hi row hai. 👍')}</td></tr>`}</tbody></table></div>
        ${doubleRows.length > 150 ? `<p class="dim small">Preview me pehli 150 rows — <b>⬇ Double-mapped barcodes CSV</b> me poori list (${U.fmt(doubleRows.length)} rows) hai.</p>` : ''}
      </div>
      <div class="split-cards"><div class="card card-primary"><div class="card-head"><h3>Channel-wise summary</h3></div><div class="summary-grid"><div><small>FF tags issued</small><b>${U.fmt(ffIssue)}</b></div><div><small>GV tags issued</small><b>${U.fmt(gvIssue)}</b></div><div><small>FF stock tags</small><b>${U.fmt(ffStock)}</b></div><div><small>GV stock tags</small><b>${U.fmt(gvStock)}</b></div></div></div><div class="card card-success"><div class="card-head"><h3>Combined commercial summary</h3></div><div class="summary-grid"><div><small>Total issuance</small><b>${U.fmt(ffIssue + gvIssue)}</b></div><div><small>Total stock</small><b>${U.fmt(ffStock + gvStock)}</b></div><div><small>GV amount</small><b>${money(sum(rows, (r) => r.amount))}</b></div><div><small>GV commission</small><b>${money(sum(rows, (r) => r.commission), 2)}</b></div></div></div></div>
      <div class="card card-violet"><div class="card-head"><h3>👥 Dual agents · agent naam, TL naam aur dono channel ke tags</h3><span class="dim small">${U.fmt(rows.length)} verified pairs · GV month ${esc(U.labelYM(data.month))}</span></div>
        <div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-violet">FF agent</th><th class="tone-violet">FF TL</th><th class="tone-violet num">FF tags</th><th class="tone-violet num">FF stock</th><th class="tone-violet">GV agent</th><th class="tone-violet">GV TL</th><th class="tone-violet num">GV tags</th><th class="tone-violet num">GV stock</th><th class="tone-violet num">Shared barcodes</th><th class="tone-violet">Evidence</th><th class="tone-violet num">GV commission</th><th class="tone-violet">Class mix · FF / GV</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><b class="agent-link" data-agent360="${esc(r.ff.name || r.ff.id)}" data-agent360-id="${esc(r.ff.id || '')}" title="Agent 360 kholo">${esc(r.ff.name || r.ff.id)}</b><small>${esc(r.ff.id || '')} · ${esc(r.segment)}</small></td><td>${esc(r.ff.tlName || 'Direct / Unmapped')}</td><td class="num"><span class="tag-count">${U.fmt(r.ffIssuance)}</span></td><td class="num">${U.fmt(r.ffStock)}</td><td><b class="agent-link" data-agent360="${esc(r.gv.name || r.gv.id)}" data-agent360-id="${esc(r.gv.id || '')}" title="Agent 360 kholo">${esc(r.gv.name || r.gv.id)}</b><small>${esc(r.gv.id || '')}</small></td><td>${esc(r.gv.tlName || 'Direct / Unmapped')}</td><td class="num"><span class="tag-count">${U.fmt(r.gvIssuance)}</span></td><td class="num">${U.fmt(r.gvStock)}</td><td class="num"><b>${U.fmt(r.barcodeCount)}</b>${r.barcodes.size ? `<small>${esc([...r.barcodes].slice(0, 2).map((b) => U.barcode(b)).join(', '))}${r.barcodes.size > 2 ? '…' : ''}</small>` : ''}</td><td>${statusPill(r.confidence, r.methods.length > 1 ? 'green' : 'blue')}<small>${esc(r.methods.join(' + '))}</small></td><td class="num">${money(r.commission, 2)}</td><td class="tiny-mix">${esc(classMix(r.ffClasses))}<small>GV: ${esc(classMix(r.gvClasses))}</small></td></tr>`).join('') || `<tr><td colspan="12">${empty('No matching verified agents', 'Evidence/search filter change karke dekhein.')}</td></tr>`}
      </tbody><tfoot><tr class="row-total"><td colspan="2">Total · ${U.fmt(rows.length)} dual agents</td><td class="num">${U.fmt(ffIssue)}</td><td class="num">${U.fmt(ffStock)}</td><td colspan="2"></td><td class="num">${U.fmt(gvIssue)}</td><td class="num">${U.fmt(gvStock)}</td><td class="num">${U.fmt(sum(rows, (r) => r.barcodeCount))}</td><td colspan="2" class="num">${money(sum(rows, (r) => r.commission), 2)}</td><td></td></tr></tfoot></table></div></div>
      <div class="card card-info"><div class="card-head"><h3>TL-wise matched-channel comparison</h3><span class="dim small">GV − FF gaps · matched identities only</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-blue">FF TL ↔ GV TL</th><th class="tone-blue num">Agents</th><th class="tone-blue num">Shared barcodes</th><th class="tone-blue num">FF issuance</th><th class="tone-blue num">GV issuance</th><th class="tone-blue num">Issuance gap</th><th class="tone-blue num">FF stock</th><th class="tone-blue num">GV stock</th><th class="tone-blue num">Stock gap</th><th class="tone-blue num">GV commission</th><th class="tone-blue">Agent drill-down</th></tr></thead><tbody>${[...tlSummary.values()].sort((a,b)=>b.ff+b.gv-a.ff-a.gv).map((t)=>`<tr><td><b>${esc(t.label)}</b></td><td class="num">${U.fmt(t.agents)}</td><td class="num">${U.fmt(t.barcodes)}</td><td class="num">${U.fmt(t.ff)}</td><td class="num">${U.fmt(t.gv)}</td><td class="num"><b>${t.gv-t.ff>0?'+':''}${U.fmt(t.gv-t.ff)}</b></td><td class="num">${U.fmt(t.ffStock)}</td><td class="num">${U.fmt(t.gvStock)}</td><td class="num"><b>${t.gvStock-t.ffStock>0?'+':''}${U.fmt(t.gvStock-t.ffStock)}</b></td><td class="num">${money(t.commission,2)}</td><td><details class="tl-drill"><summary>Show ${U.fmt(t.agents)} agents</summary><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>FF Agent / ID</th><th>GV Agent / ID</th><th>Evidence</th><th>Barcodes</th><th>FF tags / stock</th><th>GV tags / stock</th><th>GV commission</th></tr></thead><tbody>${t.agentRows.slice(0,20).map((r)=>`<tr><td><b>${esc(r.ff.name||r.ff.id)}</b><small>${esc(r.ff.id||'')} · ${esc(r.ff.tlName||'Direct / Unmapped')}</small></td><td><b>${esc(r.gv.name||r.gv.id)}</b><small>${esc(r.gv.id||'')} · ${esc(r.gv.tlName||'Direct / Unmapped')}</small></td><td>${esc(r.methods.join(' + '))}</td><td>${U.fmt(r.barcodeCount)}</td><td>${U.fmt(r.ffIssuance)} / ${U.fmt(r.ffStock)}</td><td>${U.fmt(r.gvIssuance)} / ${U.fmt(r.gvStock)}</td><td>${money(r.commission,2)}</td></tr>`).join('')}</tbody></table></div>${t.agents>20?`<small class="dim">Showing first 20 of ${U.fmt(t.agents)} agent pairs; use the full Dual Channel CSV for all rows.</small>`:''}</details></td></tr>`).join('') || `<tr><td colspan="11">No TL overlap data</td></tr>`}</tbody></table></div></div>
      <div class="card card-warning"><div class="card-head"><h3>Barcode overlap audit · exact FF ↔ GV matches</h3><span class="dim small">${U.fmt(onlyDouble ? doubleRows.length : barcodeRows.length)} rows ${onlyDouble ? '· only double-mapped' : `· ${U.fmt(doubleRows.length)} double-mapped`}</span></div><p class="dim small">“Repeated in FF/GV” means the normalized barcode occurs more than once in that source; owner count highlights assignment across multiple agents. Today’s review uses allocation dates. ${gvAllocationDateMapped ? 'GV allocation-date mapping is active.' : 'GV assignment date is not mapped; configure it in Settings → Data source → Tag Assignment allocation-date column for complete daily coverage.'} Preview is capped for smooth loading.</p><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-slate">Barcode (FF) ↔ Serial (GV)</th><th class="tone-slate">Double-mapped?</th><th class="tone-slate">Why</th><th class="tone-slate">FF agent · TL · class</th><th class="tone-slate">GV agent · TL · class</th><th class="tone-slate num">FF rows / owners</th><th class="tone-slate num">GV rows / owners</th><th class="tone-slate">Agent pair</th></tr></thead><tbody>${(onlyDouble ? doubleRows : flaggedBarcodeRows).slice(0, 300).map(doubleRowHtml).join('') || `<tr><td colspan="8">No exact barcode join found for this filter.</td></tr>`}</tbody></table></div>${(onlyDouble ? doubleRows : flaggedBarcodeRows).length > 300 ? `<p class="dim small">Showing first 300 of ${U.fmt((onlyDouble ? doubleRows : flaggedBarcodeRows).length)} matched barcodes; use the CSV buttons for the full list.</p>` : ''}</div>`;
    U.$('#cross-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    // Barcode display/export me dash wala format (608116-011-0558601) — matching normalized hi rehti hai.
    const doubleExportRows = (list) => list.map((b) => [U.barcode(b.ffBarcode), U.barcode(b.gvSerial), b.doubleMapped ? 'YES' : 'NO', b.reasons.join(' · '), b.ffId, b.ffAgent, b.ffTl, b.ffClass, b.ffBarcodeAllocatedAt, b.ffAgentAllocatedAt, b.gvId, b.gvAgent, b.gvTl, b.gvClass, b.gvAllocatedAt, b.ffOccurrences, b.ffOwnerCount, b.gvOccurrences, b.gvOwnerCount, b.verified ? 'Resolved' : 'Ambiguous - review']);
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
      'Double-mapped barcodes': { title: `${U.fmt(doubleRows.length)} double-mapped barcode rows`, headers: barcodeReviewHeaders, rows: doubleCsvRows, stats: [`${U.fmt(ghostRows.length)} ghost-holder matches ignore hue (FF Apna Payment / GV not-assigned)`, 'Sirf asli agent ↔ asli agent conflicts double maane gaye'] },
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
      const latestFf = M.latestDate(daily.filter((r) => r.channel !== 'GV Partner')), latestGv = G.latestDate ? G.latestDate() : M.latestDate(daily.filter((r) => r.channel === 'GV Partner'));
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
      const gv = daily.filter((r) => r.channel === 'GV Partner' && r.date && (!gvFrom || r.date >= gvFrom) && (!latestGv || r.date <= latestGv)).map((r) => ({
        channel: 'GV Partner', id: r.agentId, name: r.agentName, tlName: r.tlName, dateKey: U.dateKey(r.date),
        date: dayDate(r.date), cls: r.cls || 'NA', group: r.group || '', n: Number(r.n) || 1
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

  // ---------- Master Stock: barcode / agent / TL / GV-name / GV-TL search + StockDataa ↔ Tag Assignment reconciliation ----------
  async function getMasterIndex() {
    const details = await FF.insights.loadDetails();
    if (mem.masterIndex && mem.masterIndex.src === details) return mem.masterIndex;
    const byKey = new Map();
    const entry = (k) => { let e = byKey.get(k); if (!e) { e = { ff: [], gv: [] }; byKey.set(k, e); } return e; };
    const people = new Map(); // nameLower -> { kind, name, rows, tlNames:Set, classes:Map }
    const person = (kind, name, tlName, cls) => {
      const k = `${kind}:${normName(name)}`;
      let p = people.get(k);
      if (!p) { p = { kind, name: clean(name), tlNames: new Set(), classes: new Map(), bars: new Set() }; people.set(k, p); }
      if (clean(tlName)) p.tlNames.add(normName(tlName));
      if (clean(cls)) p.classes.set(clean(cls), (p.classes.get(clean(cls)) || 0) + 1);
      return p;
    };
    details.stock.forEach((r) => {
      const k = normBarcode(r.barcode || r.tagId); if (!k) return;
      const e = entry(k);
      if (!e.ff.some((x) => x.barcode === k && normId(x.agentId) === normId(r.agentId))) e.ff.push({ barcode: k, agentId: clean(r.agentId), agentName: clean(r.agentName), tlName: clean(r.tlName), cls: clean(r.cls), bcAllocatedAt: r.bcAllocatedAt, agentAllocatedAt: r.agentAllocatedAt });
      const p = person('ff-agent', r.agentName || r.agentId, r.tlName, r.cls); p.bars.add(k); p.last = dateText(r.agentAllocatedAt || r.bcAllocatedAt) !== '—' ? dateText(r.agentAllocatedAt || r.bcAllocatedAt) : p.last;
      if (clean(r.tlName)) { const t = person('ff-tl', r.tlName, '', r.cls); t.bars.add(k); }
    });
    details.assignment.forEach((r) => {
      const k = normBarcode(r.serial || r.tagId); if (!k) return;
      const e = entry(k);
      if (!e.gv.some((x) => x.barcode === k && normId(x.gvId) === normId(r.gvUniqueId))) e.gv.push({ barcode: k, agentId: clean(r.agentId), agentName: clean(r.agentName), tlName: clean(r.tlName), cls: clean(r.cls), gvId: clean(r.gvUniqueId), gvName: clean(r.gvUniqueName), allocatedAt: r.allocatedAt });
      const p = person('gv-agent', r.agentName || r.agentId, r.tlName, r.cls); p.bars.add(k); p.last = dateText(r.allocatedAt) !== '—' ? dateText(r.allocatedAt) : p.last;
      if (clean(r.tlName)) { const t = person('gv-tl', r.tlName, '', r.cls); t.bars.add(k); }
      if (clean(r.gvUniqueName)) { const g = person('gv-id', r.gvUniqueName, '', r.cls); g.bars.add(k); g.sub = clean(r.gvUniqueId); }
    });
    const ffSet = new Set([...byKey.keys()].filter((k) => byKey.get(k).ff.length));
    const gvSet = new Set([...byKey.keys()].filter((k) => byKey.get(k).gv.length));
    const bothSet = new Set([...ffSet].filter((k) => gvSet.has(k)));
    const gvOnly = [...gvSet].filter((k) => !ffSet.has(k)).map((k) => byKey.get(k).gv[0]);
    const ffOnly = [...ffSet].filter((k) => !gvSet.has(k)).map((k) => byKey.get(k).ff[0]);
    const mismatch = [];
    bothSet.forEach((k) => {
      const e = byKey.get(k);
      const ffH = e.ff.map((r) => r.agentName || r.agentId).sort()[0] || '';
      const gvH = e.gv.map((r) => r.agentName || r.agentId).sort()[0] || '';
      if (normName(ffH) !== normName(gvH) && !isGvMasterFfHolder(ffH, '') && !isUnassignedGvHolder(gvH, '')) mismatch.push({ barcode: U.barcode(k), ff: ffH, gv: gvH, cls: (e.ff[0] && e.ff[0].cls) || (e.gv[0] && e.gv[0].cls) || '' });
    });
    // Aged stock alert (v3.8.3): kitna FF stock kitne din se ek hi jagah pada hai.
    const aged30 = [], aged60 = [];
    details.stock.forEach((r) => {
      const d = U.parseDate(r.agentAllocatedAt || r.bcAllocatedAt || '');
      if (!d) return;
      const age = Math.floor((Date.now() - d.getTime()) / 864e5);
      if (age >= 60) aged60.push({ barcode: U.barcode(r.barcode || r.tagId), agent: r.agentName || r.agentId || '', tl: r.tlName || '', cls: r.cls || '', allocated: dateText(r.agentAllocatedAt || r.bcAllocatedAt), age });
      else if (age >= 30) aged30.push({ barcode: U.barcode(r.barcode || r.tagId), agent: r.agentName || r.agentId || '', tl: r.tlName || '', cls: r.cls || '', allocated: dateText(r.agentAllocatedAt || r.bcAllocatedAt), age });
    });
    aged30.sort((a, b) => b.age - a.age); aged60.sort((a, b) => b.age - a.age);
    mem.masterIndex = { src: details, byKey, people, ffSet, gvSet, bothSet, gvOnly, ffOnly, mismatch, aged30, aged60, stock: details.stock, assignment: details.assignment };
    return mem.masterIndex;
  }

  async function renderMasterStock(root, params) {
    const idx = await getMasterIndex();
    if (!idx.stock.length && !idx.assignment.length) { root.innerHTML = head('🗄️', 'Master Stock', 'FF StockDataa + GV Tag Assignment ka combined register'); return; }
    const q = clean(params.q);
    const nq = normBarcode(q);
    const ql = clean(q).toLowerCase();
    const clsFilter = ['all', 'VC4', 'VC20', 'VC5+'].includes(params.cls) ? params.cls : 'all';

    // ---- search results ----
    let tagHits = [], peopleHits = [];
    if (q) {
      if (nq && nq.length >= 4) {
        idx.byKey.forEach((e, k) => { if (k === nq || k.startsWith(nq)) tagHits.push({ key: k, ...e }); });
        tagHits.sort((a, b) => a.key.length - b.key.length).splice(200);
      }
      if (ql && ql.length >= 2) {
        idx.people.forEach((p) => {
          if (normName(p.name).includes(ql) || (p.sub && clean(p.sub).toLowerCase().includes(ql))) peopleHits.push(p);
        });
        peopleHits.sort((a, b) => b.bars.size - a.bars.size).splice(100);
      }
    }

    const classes = ['VC4', 'VC20', 'VC5+'];
    const ffByCls = classes.map((c) => idx.stock.filter((r) => clean(r.cls) === c).length);
    const gvByCls = classes.map((c) => idx.assignment.filter((r) => clean(r.cls) === c).length);
    const gvOnlyHolders = {};
    idx.gvOnly.forEach((r) => { const k = r.agentName || r.agentId || '?'; gvOnlyHolders[k] = (gvOnlyHolders[k] || 0) + 1; });
    const gvOnlyTop = Object.entries(gvOnlyHolders).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const gvOnlyCsv = idx.gvOnly.map((r) => [r.barcode, r.gvName || '', r.gvId || '', r.agentName || r.agentId || '', r.tlName || '', r.cls || '', dateText(r.allocatedAt)]);
    const ffOnlyCsv = idx.ffOnly.map((r) => [r.barcode, r.agentName || r.agentId || '', r.tlName || '', r.cls || '', dateText(r.agentAllocatedAt || r.bcAllocatedAt)]);
    const mismatchCsv = idx.mismatch.map((r) => [r.barcode, r.ff, r.gv, r.cls]);
    const inCls = (c) => clsFilter === 'all' || c === clsFilter;

    const holderRows = (kind) => [...idx.people.values()].filter((p) => p.kind === kind && p.bars.size).sort((a, b) => b.bars.size - a.bars.size);
    const holderTable = (kind) => holderRows(kind).map((p) => [p.name, [...p.tlNames].slice(0, 3).join(', ') || '—', p.bars.size, [...p.classes.entries()].map(([c, n]) => `${c}: ${n}`).join(' · '), p.last || '—']);
    let ageSum = 0, ageKnown = 0;
    idx.stock.forEach((r) => { const d = U.parseDate(r.agentAllocatedAt || r.bcAllocatedAt || ''); if (d) { ageSum += Math.max(0, Math.floor((Date.now() - d.getTime()) / 864e5)); ageKnown++; } });
    const avgAge = ageKnown ? Math.round(ageSum / ageKnown) : 0;
    const metrics = [
      { label: 'StockDataa unique barcodes', value: U.fmt(idx.ffSet.size), foot: `${U.fmt(idx.stock.length)} FF rows loaded`, tone: 'g2', icon: '📦' },
      { label: 'Tag Assignment unique serials', value: U.fmt(idx.gvSet.size), foot: `${U.fmt(idx.assignment.length)} GV rows loaded`, tone: 'g6', icon: '📋' },
      { label: 'Matched in both', value: U.fmt(idx.bothSet.size), foot: `${U.fmtPct(idx.gvSet.size ? (idx.bothSet.size / idx.gvSet.size) * 100 : 0)} of Tag Assignment`, tone: 'g9', icon: '🤝' },
      { label: 'Tag Assignment NOT in StockDataa', value: U.fmt(idx.gvOnly.length), foot: 'GV-only barcodes — StockDataa me missing', tone: idx.gvOnly.length ? 'g7' : 'g9', icon: '🚨' },
      { label: 'StockDataa only', value: U.fmt(idx.ffOnly.length), foot: 'Tag Assignment me nahi mile', tone: 'g5', icon: '📮' },
      { label: 'Owner mismatch (both)', value: U.fmt(idx.mismatch.length), foot: 'dono me hai par holder alag (ghost excluded)', tone: idx.mismatch.length ? 'g8' : 'g9', icon: '⚖️' },
      { label: 'Top GV-only holder', value: esc(gvOnlyTop[0] ? gvOnlyTop[0][0] : '—'), foot: gvOnlyTop[0] ? `${U.fmt(gvOnlyTop[0][1])} GV-only tags · sabse zyada missing stock isi ke paas` : 'koi GV-only tag nahi', tone: 'g11', icon: '👤' },
      { label: 'Aged stock · 60+ din', value: U.fmt(idx.aged60.length), foot: idx.aged60.length ? `sabse purana ${idx.aged60[0].age} din · ${idx.aged60[0].agent}` : 'koi 60+ din purana stock nahi', tone: idx.aged60.length ? 'g7' : 'g9', icon: '⏰' },
      { label: 'Aged stock · 30–60 din', value: U.fmt(idx.aged30.length), foot: 'aging watch — dispatch/return review karo', tone: idx.aged30.length ? 'g8' : 'g9', icon: '🕒' },
      { label: 'FF agents holding stock', value: U.fmt(holderRows('ff-agent').length), foot: `${U.fmt(holderRows('ff-tl').length)} FF TLs · click → agent-wise stock`, tone: 'g1', icon: '🟦' },
      { label: 'GV agents holding stock', value: U.fmt(holderRows('gv-agent').length), foot: `${U.fmt(holderRows('gv-tl').length)} GV TLs · click → agent-wise stock`, tone: 'g3', icon: '🟩' },
      { label: 'Match rate', value: U.fmtPct(idx.gvSet.size ? (idx.bothSet.size / idx.gvSet.size) * 100 : 0), foot: `${U.fmt(idx.bothSet.size - idx.mismatch.length)} barcodes me holder bhi same`, tone: 'g10', icon: '🎯' },
      { label: 'Avg FF stock age', value: `${U.fmt(avgAge)} <small>din</small>`, foot: `${U.fmt(ageKnown)} tags ki allocation date mili`, tone: avgAge >= 45 ? 'g7' : 'g4', icon: '⏳' },
    ];

    root.innerHTML = head('🗄️', 'Master Stock', 'Barcode, agent, TL, GV name ya GV TL type karo — FF StockDataa + GV Tag Assignment dono ki total information ek saath. Ghost holders (Apna Payment / not-assigned) normal flow maane jaate hain.') + `
      <section class="ms-hero"><span class="ms-hero-ico">🗄️</span><div><h2>Master Stock — poora register ek jagah</h2><p>Kisi bhi rang-birange card par click karo → poora data (search + CSV + sab rows) khulega.</p></div>
        <div class="ms-hero-stats"><span><b>${U.fmt(idx.ffSet.size)}</b>FF barcodes</span><span><b>${U.fmt(idx.gvSet.size)}</b>GV serials</span><span><b>${U.fmt(idx.gvOnly.length)}</b>GV-only</span></div></section>
      <section class="card">
        <form id="ms-form" style="display:flex;gap:10px;flex-wrap:wrap">
          <input name="q" class="input" style="flex:1;min-width:220px" value="${esc(q)}" placeholder="🔍 Barcode / agent / TL / GV name / GV TL..." autocomplete="off">
          <select name="cls" class="input" style="width:110px">${['all', ...classes].map((c) => `<option value="${c}"${c === clsFilter ? ' selected' : ''}>${c === 'all' ? 'All class' : c}</option>`).join('')}</select>
          <button type="submit" class="btn primary">Search</button>
          ${q ? '<button type="button" class="btn" id="ms-clear">Clear</button>' : ''}
        </form>
      </section>
      ${vividMetrics(metrics)}
      ${q ? `<section class="card">
        <div class="card-head"><h3>🔍 Search: “${esc(q)}”</h3><span class="dim small">${tagHits.length} tag · ${peopleHits.length} person matches</span></div>
        ${tagHits.length ? `<div class="table-wrap"><table><thead><tr><th>Barcode</th><th>FF agent</th><th>FF TL</th><th>GV agent</th><th>GV TL</th><th>GV unique</th><th>Class</th><th>Status</th></tr></thead><tbody>${tagHits.map((t) => {
          const f = t.ff[0], g = t.gv[0];
          const status = f && g ? (normName(f.agentName || f.agentId) === normName(g.agentName || g.agentId) ? statusPill('Matched', 'green') : isGvMasterFfHolder(f.agentName, '') ? statusPill('GV flow · Apna Payment', 'blue') : statusPill('Owner alag', 'amber')) : g ? statusPill('GV-only · StockDataa missing', 'red') : statusPill('FF-only', 'amber');
          return `<tr><td><b>${esc(t.key)}</b></td><td>${esc(f ? `${f.agentName || f.agentId}` : '—')}</td><td>${esc(f && f.tlName || '—')}</td><td>${esc(g ? `${g.agentName || g.agentId}` : '—')}</td><td>${esc(g && g.tlName || '—')}</td><td>${esc(g ? `${g.gvName || ''} ${g.gvId ? `(${g.gvId})` : ''}` : '—')}</td><td>${esc((f && f.cls) || (g && g.cls) || '—')}</td><td>${status}</td></tr>`;
        }).join('')}</tbody></table></div>` : ''}
        ${peopleHits.length ? `<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Person</th><th>Role</th><th>Unique barcodes${clsFilter !== 'all' ? ` (${clsFilter})` : ''}</th><th>Class split</th><th>TL(s)</th><th>Last allocation</th></tr></thead><tbody>${peopleHits.filter((p) => clsFilter === 'all' || p.classes.has(clsFilter)).map((p) => {
          const role = { 'ff-agent': 'FF Agent', 'gv-agent': 'GV Agent', 'ff-tl': 'FF TL', 'gv-tl': 'GV TL', 'gv-id': 'GV Unique ID' }[p.kind] || p.kind;
          return `<tr><td><b>${esc(p.name)}</b>${p.sub ? ` <span class="dim small">(${esc(p.sub)})</span>` : ''}</td><td>${role}</td><td><b>${U.fmt(p.bars.size)}</b></td><td>${[...p.classes.entries()].map(([c, n]) => `${c}: ${U.fmt(n)}`).join(' · ') || '—'}</td><td>${esc([...p.tlNames].slice(0, 3).join(', ')) || '—'}</td><td>${esc(p.last || '—')}</td></tr>`;
        }).join('')}</tbody></table></div>` : ''}
        ${!tagHits.length && !peopleHits.length ? '<div class="empty">Koi match nahi mila — spelling ya ID check karo.</div>' : ''}
      </section>` : ''}
      <section class="split-cards">
        <div class="card">
          <div class="card-head"><h3>Barcode overlap — StockDataa ↔ Tag Assignment</h3></div>
          ${C.donut({ items: [{ label: 'Dono me', value: idx.bothSet.size, color: '#34d399' }, { label: 'Sirf StockDataa', value: idx.ffOnly.length, color: '#60a5fa' }, { label: 'Sirf Tag Assignment', value: idx.gvOnly.length, color: '#fb7185' }], size: 190, subtitle: 'unique barcodes', format: (v) => U.fmt(v) })}
        </div>
        <div class="card">
          <div class="card-head"><h3>Class-wise tags: FF StockDataa vs Tag Assignment</h3></div>
          ${C.bars({ labels: classes.filter((c) => inCls(c)), series: [
            { name: 'FF StockDataa', values: classes.filter((c) => inCls(c)).map((c) => ffByCls[classes.indexOf(c)]) },
            { name: 'Tag Assignment', values: classes.filter((c) => inCls(c)).map((c) => gvByCls[classes.indexOf(c)]) },
          ], height: 210, format: (v) => U.fmt(v) })}
        </div>
      </section>
      <section class="split-cards">
        <div class="card">
          <div class="card-head"><h3>🚨 GV-only tags ke top holders (StockDataa me missing)</h3></div>
          ${C.hbars({ items: gvOnlyTop.map(([label, value]) => ({ label, value, sub: 'GV-only tags' })), valueLabel: 'Tags', format: (v) => U.fmt(v) })}
        </div>
        <div class="card">
          <div class="card-head"><h3>⚖️ Owner mismatch — dono source me hai, holder alag</h3></div>
          <div class="table-wrap"><table><thead><tr><th>Barcode</th><th>FF holder</th><th>GV holder</th><th>Class</th></tr></thead><tbody>${(idx.mismatch.slice(0, 12).map((m) => `<tr><td><b>${esc(m.barcode)}</b></td><td>${esc(m.ff)}</td><td>${esc(m.gv)}</td><td>${esc(m.cls)}</td></tr>`)).join('')}</tbody></table></div>
          ${idx.mismatch.length > 12 ? `<p class="dim small">Top 12 dikhe — poori list card click karke kholo.</p>` : ''}
        </div>
      </section>`;

    const ffSummaryCsv = [...idx.ffSet].map((k) => { const f = idx.byKey.get(k).ff[0]; return [k, f.agentName || f.agentId || '', f.tlName || '', f.cls || '', idx.gvSet.has(k) ? 'Both' : 'FF only']; });
    const gvSummaryCsv = [...idx.gvSet].map((k) => { const g = idx.byKey.get(k).gv[0]; return [k, g.gvName || '', g.gvId || '', g.agentName || g.agentId || '', g.tlName || '', g.cls || '', idx.ffSet.has(k) ? 'Both' : 'GV only']; });
    const bothCsv = [...idx.bothSet].map((k) => { const e = idx.byKey.get(k); const f = e.ff[0], g = e.gv[0]; const same = normName(f.agentName || f.agentId) === normName(g.agentName || g.agentId); return [k, f.agentName || f.agentId || '', g.agentName || g.agentId || '', f.cls || g.cls || '', same ? 'Same holder' : 'Holder alag']; });
    const personCsv = peopleHits.map((p) => [p.name, { 'ff-agent': 'FF Agent', 'gv-agent': 'GV Agent', 'ff-tl': 'FF TL', 'gv-tl': 'GV TL', 'gv-id': 'GV Unique ID' }[p.kind] || p.kind, p.bars.size, [...p.classes.entries()].map(([c, n]) => `${c}: ${n}`).join(' · '), [...p.tlNames].join(', '), p.last || '']);
    bindMetricDetails(root, 'Master stock reconciliation', [], [], {
      'StockDataa unique barcodes': { title: 'FF StockDataa me unique barcodes', headers: ['Barcode', 'FF agent', 'FF TL', 'Class', 'Source'], rows: ffSummaryCsv, stats: [`${U.fmt(idx.stock.length)} FF rows`, `${U.fmt(idx.bothSet.size)} Tag Assignment se match`, `${U.fmt(idx.ffOnly.length)} sirf FF me`] },
      'Tag Assignment unique serials': { title: 'Tag Assignment me unique serials', headers: ['Serial', 'GV unique', 'GV ID', 'GV agent', 'GV TL', 'Class', 'Source'], rows: gvSummaryCsv, stats: [`${U.fmt(idx.assignment.length)} GV rows`, `${U.fmt(idx.bothSet.size)} StockDataa me bhi hai`, `${U.fmt(idx.gvOnly.length)} StockDataa me missing`] },
      'Matched in both': { title: `${U.fmt(idx.bothSet.size)} barcodes dono source me`, headers: ['Barcode', 'FF holder', 'GV holder', 'Class', 'Status'], rows: bothCsv, stats: [`${U.fmt(idx.mismatch.length)} me holder alag hai`, `${U.fmt(idx.bothSet.size - idx.mismatch.length)} me holder same`] },
      'Tag Assignment NOT in StockDataa': { title: `${U.fmt(idx.gvOnly.length)} GV-only barcodes`, headers: ['Barcode', 'GV unique', 'GV ID', 'GV agent', 'GV TL', 'Class', 'Allocated'], rows: gvOnlyCsv },
      'StockDataa only': { title: `${U.fmt(idx.ffOnly.length)} FF-only barcodes`, headers: ['Barcode', 'FF agent', 'FF TL', 'Class', 'Allocated'], rows: ffOnlyCsv },
      'Owner mismatch (both)': { title: `${U.fmt(idx.mismatch.length)} holder mismatch`, headers: ['Barcode', 'FF holder', 'GV holder', 'Class'], rows: mismatchCsv, stats: ['Ghost holders (Apna Payment / not-assigned) mismatch me count nahi hote'] },
      'Top GV-only holder': { title: 'GV-only tags ke top holders', headers: ['Holder', 'GV-only tags'], rows: gvOnlyTop.map(([label, value]) => [label, value]) },
      'Aged stock · 60+ din': { title: `${U.fmt(idx.aged60.length)} tags 60+ din se parked`, headers: ['Barcode', 'Agent', 'TL', 'Class', 'Allocated', 'Age (din)'], rows: idx.aged60.map((r) => [r.barcode, r.agent, r.tl, r.cls, r.allocated, r.age]), stats: ['Allocation date StockDataa ke agent/bc allocated columns se', 'Inka dispatch ya return review karo'] },
      'FF agents holding stock': { title: 'FF agent-wise stock (StockDataa)', headers: ['Agent', 'TL', 'Tags', 'Class split', 'Last allocation'], rows: holderTable('ff-agent'), stats: [`${U.fmt(holderRows('ff-agent').length)} agents`, `${U.fmt(U.sum(holderRows('ff-agent'), (p) => p.bars.size))} tags`] },
      'GV agents holding stock': { title: 'GV agent-wise stock (Tag Assignment)', headers: ['Agent', 'TL', 'Tags', 'Class split', 'Last allocation'], rows: holderTable('gv-agent'), stats: [`${U.fmt(holderRows('gv-agent').length)} agents`, `${U.fmt(U.sum(holderRows('gv-agent'), (p) => p.bars.size))} tags`] },
      'Match rate': { title: 'Tag Assignment barcodes jo StockDataa me bhi hain', headers: ['Barcode', 'FF holder', 'GV holder', 'Class', 'Status'], rows: bothCsv, stats: [`${U.fmt(idx.bothSet.size)} matched`, `${U.fmt(idx.gvOnly.length)} GV-only`] },
      'Avg FF stock age': { title: 'Sabse purana FF stock', headers: ['Barcode', 'Agent', 'TL', 'Class', 'Allocated', 'Age (din)'], rows: [...idx.aged60, ...idx.aged30].map((r) => [r.barcode, r.agent, r.tl, r.cls, r.allocated, r.age]), stats: [`Average ${U.fmt(avgAge)} din`, '30+ din purane tags'] },
      'Aged stock · 30–60 din': { title: `${U.fmt(idx.aged30.length)} tags 30–60 din se parked`, headers: ['Barcode', 'Agent', 'TL', 'Class', 'Allocated', 'Age (din)'], rows: idx.aged30.map((r) => [r.barcode, r.agent, r.tl, r.cls, r.allocated, r.age]) },
    });

    root.querySelector('#ms-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      FF.app.updateParams({ q: fd.get('q') || '', cls: fd.get('cls') || 'all' });
    });
    root.querySelector('#ms-form').addEventListener('change', (ev) => {
      if (ev.target && ev.target.name === 'cls') { const fd = new FormData(ev.target.form); FF.app.updateParams({ q: fd.get('q') || '', cls: fd.get('cls') || 'all' }); }
    });
    const clearBtn = root.querySelector('#ms-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => FF.app.updateParams({ q: '', cls: 'all' }));
  }

  async function forecastRows(growthPct, safetyDays) {
    await FF.pages.performance.ensureLoaded();
    const [gvReport, eirAgents] = await Promise.all([G.need('report'), S.need('agents')]);
    await S.need('daily').catch(() => []);
    const gvIssuance = G.issuanceRows ? G.issuanceRows() : [];
    const latestGv = G.latestDate && G.latestDate();
    const gvMonth = latestGv ? U.ymKey(latestGv) : U.ymKey(new Date());
    const gvEir = new Map();
    gvIssuance.forEach((r) => {
      if (!r.ym || r.ym !== gvMonth) return;
      const key = normId(r.agentId) || `N:${normName(r.agentName)}`;
      const row = gvEir.get(key) || { total: 0, days: new Set() };
      row.total += Number(r.n) || 1; if (r.date) row.days.add(U.dateKey(r.date));
      gvEir.set(key, row);
    });
    const multiplier = 1 + (growthPct / 100);
    const make = (channel, id, name, tlName, stock, baseRate, extra) => {
      const rate = Math.max(0, Number(baseRate) || 0) * multiplier;
      const safety = Math.ceil(rate * safetyDays);
      const need = (days) => Math.max(0, Math.ceil(rate * days) + safety - stock);
      const stockDays = rate > 0 ? stock / rate : Infinity;
      const outDate = Number.isFinite(stockDays) ? new Date(Date.now() + Math.max(0, stockDays) * 864e5) : null;
      return { channel, id, name, tlName, stock, baseRate: Number(baseRate) || 0, rate, safety, stockDays, outDate, need7: need(7), need15: need(15), need30: need(30), risk: rate <= 0 ? 'No run-rate' : stockDays <= 3 ? 'Critical' : stockDays <= 7 ? 'High' : stockDays <= 15 ? 'Medium' : 'Covered', ...(extra || {}) };
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
      // (a) poori issuance GV channel ki hai → GV side me already; (b) GV-parked StockDataa holder
      // (Apna Payment / master ID) ka stock GV register me ginta hai — FF me dobara nahi.
      if (isGvMasterFfHolder(a.name, a.agentId || a.id)) return false;
      return !(all > 0 && (ffIssu.get(k) || 0) === 0);
    }).map((a) => {
      const k = normName(a.name);
      const all = allIssu.get(k) || 0, ffN = ffIssu.get(k) || 0;
      const base = a.avgTotal || (a.activeDays ? (a.curTotal || 0) / a.activeDays : 0);
      const direct = FF.config.isDirectAgent(a, 'ff');
      return make('First Forward', a.agentId || a.id, a.name, a.tlName, a.stockTotal || 0, all > 0 ? base * (ffN / all) : base, { direct, directReason: direct ? (FF.direct ? FF.direct.reason(a, 'ff') : 'FF direct agent') : '' });
    });
    // 🧍 Direct agents (GV: TL ID + TL Name blank) — forecast me dikhte hain, dispatch-exempt hote hain.
    // GV REPORT contributes stock/priority identity only; demand rate is always the current-month
    // EIR total divided by its EIR active days. An agent present only in REPORT therefore has 0 rate.
    const gv = gvReport.map((a) => {
      const direct = FF.config.isDirectAgent(a, 'gv');
      const key = normId(a.agentId) || `N:${normName(a.agentName)}`;
      const eir = gvEir.get(key) || { total: 0, days: new Set() };
      const baseRate = eir.days.size ? eir.total / eir.days.size : 0;
      return make('GV Partner', a.agentId, a.agentName, a.tlName, a.stockTotal || 0, baseRate, { direct, directReason: direct ? (FF.direct ? FF.direct.reason(a, 'gv') : 'GV direct agent') : '' });
    });
    return [...ff, ...gv].sort((a, b) => a.stockDays - b.stockDays || b.rate - a.rate);
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
      <div class="card card-teal"><div class="card-head"><h3>📋 Category-wise check summary</h3><span class="dim small">${U.fmt(data.categoryRows.length)} categories</span></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-teal">Category</th><th class="tone-teal num">Checks run</th><th class="tone-teal num">Findings</th><th class="tone-teal num">High severity</th><th class="tone-teal num">Affected records</th><th class="tone-teal">Status</th></tr></thead><tbody>${data.categoryRows.map((c) => `<tr><td><b>${esc(c.category)}</b></td><td class="num">${U.fmt(c.checks)}</td><td class="num">${U.fmt(c.findings)}</td><td class="num">${U.fmt(c.high)}</td><td class="num">${U.fmt(c.records)}</td><td>${c.findings ? statusPill(`${U.fmt(c.findings)} checks flagged`, c.high ? 'red' : 'amber') : statusPill('Clean', 'green')}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="ins-filters">
        <label>Severity<select class="select" data-param="severity"><option value="all">All severities</option>${['high','medium','low'].map((v) => `<option value="${v}" ${v === severity ? 'selected' : ''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></label>
        <label>Category<select class="select" data-param="category"><option value="all">All categories</option>${categories.map((v) => `<option value="${esc(v)}" ${v === category ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Source<select class="select" data-param="source"><option value="all">All sources</option>${sources.map((v) => `<option value="${esc(v)}" ${v === sourceFilter ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <form id="dq-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="Finding, source ya sample value…"><button class="btn">Search</button></form>
      </div>
      <div class="card card-danger"><div class="card-head"><h3>🚩 Findings table</h3><span class="dim small">${U.fmt(rows.length)} of ${U.fmt(data.issues.length)} findings · row click karke samples dekho</span><button class="btn small" id="dq-findings-csv">⬇ Findings CSV</button></div><div class="table-wrap"><table class="data-table ins-table" id="dq-findings"><thead><tr><th class="tone-rose">Severity</th><th class="tone-rose">Category</th><th class="tone-rose">Source</th><th class="tone-rose">Finding</th><th class="tone-rose num">Records</th><th class="tone-rose">Sample preview</th><th class="tone-rose">Recommended correction</th></tr></thead><tbody>${rows.map((i, idx) => `<tr class="finding-row sev-${i.severity}" data-finding="${idx}" data-sev="${i.severity}"><td><span class="sev-pill ${i.severity}">${i.severity === 'high' ? '● High' : i.severity === 'medium' ? '◆ Medium' : '○ Low'}</span></td><td>${esc(i.category)}</td><td>${esc(i.source)}</td><td><b>${esc(i.title)}</b><small>${U.fmt(i.count)} records · ${U.fmt(i.sampleTotal)} sample${i.sampleTotal === 1 ? '' : 's'} available</small></td><td class="num"><b>${U.fmt(i.count)}</b></td><td class="wrap"><div class="sample-chips">${i.samples.slice(0, 4).map((s) => `<code title="${esc(s)}">${esc(s.length > 42 ? `${s.slice(0, 42)}…` : s)}</code>`).join('')}${i.sampleTotal > 4 ? `<code>+${U.fmt(i.sampleTotal - 4)} more</code>` : ''}</div></td><td class="wrap">${esc(i.action)}</td></tr>`).join('') || `<tr><td colspan="7">${empty('No findings match these filters', 'Try another severity, category or source.')}</td></tr>`}</tbody></table></div></div>
      <div class="card card-info"><div class="card-head"><h3>🔎 Sample rows · har finding ka data</h3><span class="dim small">${U.fmt(sampleRows.length)} sample rows ${sampleRows.length >= 200 ? '(capped — full list CSV/Excel me)' : ''}</span><button class="btn small" id="dq-samples-csv">⬇ Sample rows CSV</button></div><div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-slate">Severity</th><th class="tone-slate">Category</th><th class="tone-slate">Source</th><th class="tone-slate">Finding</th><th class="tone-slate">Sample field</th><th class="tone-slate">Sample value</th></tr></thead><tbody>${sampleRows.slice(0, 200).map((r) => `<tr><td><span class="sev-pill ${r[0]}">${r[0]}</span></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td><td class="wrap"><code>${esc(r[5])}</code></td></tr>`).join('') || `<tr><td colspan="6">No sample rows for this filter.</td></tr>`}</tbody></table></div></div>`;
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
    const sourceHealthHeaders = ['Source', 'Checks run', 'Findings', 'High severity', 'Affected records'];
    const sourceHealthRows = data.sources.map((s) => [s.source, s.checks, s.findings, s.high, s.records]);
    bindMetricDetails(root, 'Data quality', findingHeaders, findingExport, {
      'High severity': { title: 'High-severity findings', headers: findingHeaders, rows: findingExport.filter((r) => r[0] === 'high') },
      'Findings': { title: 'All findings', headers: findingHeaders, rows: findingExport, stats: [`${U.fmt(high.length)} high · ${U.fmt(data.issues.filter((i) => i.severity === 'medium').length)} medium · ${U.fmt(data.issues.filter((i) => i.severity === 'low').length)} low`] },
      'Affected records / keys': { title: 'Affected records per finding', headers: findingHeaders, rows: findingExport, stats: [`Total ${U.fmt(affected)} affected keys (checks ke beech overlap possible)`] },
      'Checks passed': { title: 'Source-wise check health', headers: sourceHealthHeaders, rows: sourceHealthRows, stats: [`${U.fmt(data.passed)}/${U.fmt(data.checksRun)} checks clean (${data.checksRun ? ((data.passed / data.checksRun) * 100).toFixed(1) : 0}%)`] },
      'Latest FF data': { title: 'First Forward sources', headers: sourceHealthHeaders, rows: sourceHealthRows.filter((r) => !/GV|Tag Assignment/i.test(String(r[0]))), stats: [data.latestFf ? `Latest FF record ${dateText(data.latestFf)} (${dayAge(data.latestFf)})` : 'FF data nahi mila'] },
      'Latest GV data': { title: 'GV Partner sources', headers: sourceHealthHeaders, rows: sourceHealthRows.filter((r) => /GV|Tag Assignment/i.test(String(r[0]))), stats: [data.latestGv ? `Latest GV record ${dateText(data.latestGv)} (${dayAge(data.latestGv)})` : 'GV data nahi mila'] }
    });
  }


  // ---- FASTag Champions--------------------------------------------------
  // Top agents/TLs by VC4, Commercial, Chassis, Replacement, Wrong VRN — FF + GV.
  // Data sources (sab preloaded, koi extra query nahi → fast):
  //   FF → S.need('agentClass') EIR agent×class×type×vrnType rows (channel 'First Forward' only,
  //        GV rows / master-ID 5845036 yahin se exclude hote hain — double count nahi)
  //   GV → G.need('master') GV Master rows (cls/group + tagType chassis + status replacement)
  async function renderFastagChampions(root, params) {
    const [agentClass, ffAgentsRaw] = await Promise.all([S.need('agentClass'), S.need('agents')]);
    await S.need('daily').catch(() => []);
    const issuance = G.issuanceRows ? G.issuanceRows() : [];
    const months = [...new Set([...(agentClass || []).map((r) => r.ym), ...issuance.map((r) => r.ym)].filter(Boolean))].sort();
    const month = months.includes(params.month) ? params.month : (months.at(-1) || U.ymKey(new Date()));
    const scope = ['all', 'ff', 'gv'].includes(params.scope) ? params.scope : 'all';
    const topN = Math.max(1, Math.min(50, Number(params.top) || 10));
    const q = clean(params.q).toLowerCase();
    const certStore = new Map(); // 🏆 board → certificate metadata (top-3 PDF)
    // FF agent-class rows me agentId nahi hota — REPORT/EIR agents store se naam→ID map banao.
    const ffIdByName = new Map((ffAgentsRaw || []).filter((r) => r.channel === 'First Forward').map((r) => [normName(r.name), r.id || r.name]));
    const ffRows = (agentClass || []).filter((r) => r.ym === month && r.channel === 'First Forward').map((r) => ({ ...r, agentId: ffIdByName.get(normName(r.name)) || '' }));
    const gvRows = issuance.filter((r) => r.ym === month);

    // ---- classification helpers (FF = EIR vrnType/type; GV = tagType/status) ----
    const isChassis = (r) => /chassis/i.test(r.vrnType || r.tagType || '');
    const isWrongVrn = (r) => /wrong/i.test(r.vrnType || '');
    const isReplacement = (r) => /replacement/i.test(r.type || r.status || '');
    const isVc4Row = (r) => (r.group || M.classGroup(r.cls)) === 'VC4';

    // ---- month-scoped rows per channel (FF/GV identity conflict-free: FF = channelOf 'First Forward') ----
    const scopeRows = (ch) => (scope === 'ff' ? (ch === 'ff' ? ffRows : []) : scope === 'gv' ? (ch === 'gv' ? gvRows : []) : (ch === 'ff' ? ffRows : gvRows));

    // ---- generic ranker: full aggregation first, THEN sort + slice (category boards never truncated early) ----
    const aggregate = (rows, keyOf, nameOf, channel) => {
      const map = new Map();
      for (const r of rows) {
        const name = nameOf(r);
        if (!name) continue;
        if (q && ![name, String(r.agentId || ''), r.tlName || ''].join(' ').toLowerCase().includes(q)) continue;
        const key = keyOf(r);
        // 🧍 Direct agent ko uske TL naam se nahi, direct label se dikhao (FF: APS · GV: blank TL).
        const tlLabel = FF.config.isDirectAgent(r, channel) ? FF.config.directLabel(r, channel) : (clean(r.tlName) || 'Unknown TL');
        if (!map.has(key)) map.set(key, { key, name, id: clean(r.agentId || '') || '', tlName: tlLabel, total: 0, vc4: 0, commercial: 0, chassis: 0, replacement: 0, wrongVrn: 0 });
        const o = map.get(key);
        o.total += Number(r.n) || 1;
        if (isVc4Row(r)) o.vc4 += Number(r.n) || 1; else o.commercial += Number(r.n) || 1;
        if (isChassis(r)) o.chassis += Number(r.n) || 1;
        if (isReplacement(r)) o.replacement += Number(r.n) || 1;
        if (isWrongVrn(r)) o.wrongVrn += Number(r.n) || 1;
      }
      return map;
    };
    const board = (map, metric) => [...map.values()].filter((r) => r[metric] > 0).sort((a, b) => b[metric] - a[metric] || b.total - a.total || a.name.localeCompare(b.name)).slice(0, topN);

    const med = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span class="dim">${i + 1}</span>`;
    const CHAMP_HEADERS = ['Rank', 'Agent', 'ID', 'TL', 'Total', 'VC4', 'Comm', 'Chassis', 'Repl', 'Wrong VRN'];
    const championTable = (title, icon, variant, rows, certKey) => {
      if (!rows.length) return `<div class="card ${variant}"><div class="card-head"><h3>${icon} ${esc(title)}</h3>${statusPill('No data', 'amber')}</div><div class="card-body empty">${empty('Is period me koi row nahi', 'Month/channel change karke dekhein.')}</div></div>`;
      return `<div class="card ${variant}"><div class="card-head"><h3>${icon} ${esc(title)}</h3><span class="dim small">Top ${U.fmt(rows.length)} · ${esc(U.labelYM(month))}</span>${certKey ? `<button class="btn small" data-cert="${esc(certKey)}" title="Top-3 champion certificates (print → Save as PDF)">🏅 Certificates</button>` : ''}</div>
        <div class="table-wrap"><table class="data-table ins-table"><thead><tr>${CHAMP_HEADERS.map((h, i) => `<th${i >= 4 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((r, i) => `<tr${i < 3 ? ' class="champ-top"' : ''}><td>${med(i)}</td><td><b>${esc(r.name)}</b>${r.id ? `<small>${esc(r.id)}</small>` : ''}</td><td>${esc(r.id || '—')}</td><td>${esc(r.tlName || '—')}</td><td class="num"><b>${U.fmt(r.total)}</b></td><td class="num">${U.fmt(r.vc4)}</td><td class="num">${U.fmt(r.commercial)}</td><td class="num">${U.fmt(r.chassis)}</td><td class="num">${U.fmt(r.replacement)}</td><td class="num">${U.fmt(r.wrongVrn)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    };

    const boards = [];
    const def = (key, label, icon, variant) => ({ key, label, icon, variant });
    const agentDefs = [
      def('total', 'Top Agents — Total Issuance', '🏆', 'card-primary'),
      def('vc4', 'Top Agents — VC4 (Car/Jeep)', '🚗', 'card-info'),
      def('commercial', 'Top Agents — Commercial (VC20/VC5+)', '📦', 'card-warning'),
      def('chassis', 'Top Agents — Chassis', '🚛', 'card-violet'),
      def('replacement', 'Top Agents — Replacement', '🔄', 'card-teal'),
      def('wrongVrn', 'Top Agents — Wrong VRN', '❌', 'card-danger')
    ];
    const tlDefs = [
      def('total', 'Top TLs — Total Issuance', '👥', 'card-success'),
      def('vc4', 'Top TLs — VC4', '🚗', 'card-info'),
      def('commercial', 'Top TLs — Commercial', '📦', 'card-warning')
    ];
    const csvRows = [];
    for (const d of agentDefs) {
      const ffBoard = board(aggregate(scopeRows('ff'), (r) => `FF|${clean(r.name)}`, (r) => clean(r.name), 'ff'), d.key);
      const gvBoard = board(aggregate(scopeRows('gv'), (r) => `GV|${clean(r.agentId)}|${clean(r.agentName)}`, (r) => clean(r.agentName) || clean(r.agentId), 'gv'), d.key);
      certStore.set(`ff|${d.key}`, { rows: ffBoard, category: d.label, channel: 'First Forward', metric: d.key, isTl: false });
      certStore.set(`gv|${d.key}`, { rows: gvBoard, category: d.label, channel: 'GV Partner', metric: d.key, isTl: false });
      boards.push(championTable(`${d.label} · First Forward`, d.icon, d.variant, ffBoard, d.key));
      boards.push(championTable(`${d.label} · GV Partner`, d.icon, d.variant === 'card-primary' ? 'card-success' : d.variant, gvBoard, d.key));
      ffBoard.forEach((r, i) => csvRows.push([`FF · ${d.label}`, i + 1, r.name, r.id, r.tlName, r.total, r.vc4, r.commercial, r.chassis, r.replacement, r.wrongVrn]));
      gvBoard.forEach((r, i) => csvRows.push([`GV · ${d.label}`, i + 1, r.name, r.id, r.tlName, r.total, r.vc4, r.commercial, r.chassis, r.replacement, r.wrongVrn]));
    }
    for (const d of tlDefs) {
      // 🧍 TL board me direct agents ek labelled "Direct pool" row banate hain — kisi asli TL me nahi ghulte.
      const tlPool = (row, channel) => (FF.config.isDirectAgent(row, channel)
        ? `🚫 ${FF.config.directLabel(row, channel)} (Direct pool)`
        : (clean(row.tlName) || 'Unknown TL'));
      const ffBoard = board(aggregate(scopeRows('ff'), (r) => `FF-TL|${tlPool(r, 'ff')}`, (r) => tlPool(r, 'ff'), 'ff'), d.key);
      const gvBoard = board(aggregate(scopeRows('gv'), (r) => `GV-TL|${tlPool(r, 'gv')}`, (r) => tlPool(r, 'gv'), 'gv'), d.key);
      certStore.set(`fftl|${d.key}`, { rows: ffBoard, category: d.label, channel: 'First Forward', metric: d.key, isTl: true });
      certStore.set(`gvtl|${d.key}`, { rows: gvBoard, category: d.label, channel: 'GV Partner', metric: d.key, isTl: true });
      boards.push(championTable(`${d.label} · First Forward`, d.icon, d.variant, ffBoard, d.key));
      boards.push(championTable(`${d.label} · GV Partner`, d.icon, d.variant, gvBoard, d.key));
      ffBoard.forEach((r, i) => csvRows.push([`FF TL · ${d.label}`, i + 1, r.name, '', '', r.total, r.vc4, r.commercial, r.chassis, r.replacement, r.wrongVrn]));
      gvBoard.forEach((r, i) => csvRows.push([`GV TL · ${d.label}`, i + 1, r.name, '', '', r.total, r.vc4, r.commercial, r.chassis, r.replacement, r.wrongVrn]));
    }

    const sumAgg = (rows) => rows.reduce((n, r) => n + (Number(r.n) || 1), 0);
    const ffAll = sumAgg(ffRows), gvAll = sumAgg(gvRows);
    const bins = (rows) => ({
      vc4: rows.filter(isVc4Row).reduce((n, r) => n + (Number(r.n) || 1), 0),
      comm: rows.filter((r) => !isVc4Row(r)).reduce((n, r) => n + (Number(r.n) || 1), 0),
      chassis: rows.filter(isChassis).reduce((n, r) => n + (Number(r.n) || 1), 0),
      repl: rows.filter(isReplacement).reduce((n, r) => n + (Number(r.n) || 1), 0),
      wrong: rows.filter(isWrongVrn).reduce((n, r) => n + (Number(r.n) || 1), 0)
    });
    const fb = bins(scopeRows('ff')), gb = bins(scopeRows('gv'));
    // 🏆 Top-3 champion certificates — print dialog me "Save as PDF" chun kar official PDF banao.
    const certPages = (keys) => {
      const brand = (FF.config && FF.config.brand) || 'First Forward';
      const pages = [];
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
        const meta = certStore.get(k);
        if (meta && meta.rows.length) FF.certificates.topRows(meta.rows, meta.metric, 3).forEach((c) => pages.push(FF.certificates.page({ ...c, category: meta.category, channel: meta.channel, monthLabel: U.labelYM(month), brand, isTl: meta.isTl })));
      });
      return pages;
    };
    const printCerts = (keys) => {
      const pages = certPages(keys);
      if (!pages.length) { U.toast('Is scope me winner data nahi — channel/month badal kar try karo.', 'warn'); return; }
      if (FF.certificates.print(FF.certificates.doc(pages, `Champions ${U.labelYM(month)}`)) === null) U.toast('Print window block hua — popup allow karke retry karo.', 'err');
    };
    const actions = `${exportButtons('fastag-export')} ${printButton} <button class="btn" id="cert-winners" title="FF + GV total-issuance ke top-3 certificates">🏅 Winners PDF</button>`;
    root.innerHTML = head('🏆', 'FASTag Champions', 'Top agents & TLs — VC4, Commercial, Chassis, Replacement, Wrong VRN · FF + GV · month-wise hall of fame', actions) + `
      <div class="source-row">${sourceChip('FF EIR agent-class', `${U.fmt(ffRows.length)} agent rows`)}${sourceChip('GV EIR issuance', `${U.fmt(sum(gvRows, (r) => r.n))} quantity units · master ID ${esc(FF.config.eir.gvMasterId || '5845036')}`)}<span class="dim small">All issuance counts EIR se · Chassis = VRN/Tag type "chassis" · Wrong VRN = FF VRN type "wrong"</span></div>
      <div class="ins-filters">
        <label>Month<select class="select" data-param="month">${months.slice().reverse().map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(U.labelYM(m))}</option>`).join('')}</select></label>
        <label>Channel<select class="select" data-param="scope"><option value="all" ${scope === 'all' ? 'selected' : ''}>FF + GV</option><option value="ff" ${scope === 'ff' ? 'selected' : ''}>First Forward</option><option value="gv" ${scope === 'gv' ? 'selected' : ''}>GV Partner</option></select></label>
        <label>Top N<input class="input" type="number" min="1" max="50" data-param="top" value="${topN}" style="width:80px"></label>
        <form id="fc-search" class="ins-search"><input class="input" name="q" value="${esc(params.q || '')}" placeholder="Agent / TL / ID…"><button class="btn">Search</button></form>
      </div>
      ${vividMetrics([
        { label: 'FF issuance (month)', value: U.fmt(ffAll), foot: `VC4 ${U.fmt(fb.vc4)} · Comm ${U.fmt(fb.comm)}`, tone: 'g1', icon: '🟦' },
        { label: 'GV issuance (month)', value: U.fmt(gvAll), foot: `VC4 ${U.fmt(gb.vc4)} · Comm ${U.fmt(gb.comm)}`, tone: 'g5', icon: '🟩' },
        { label: 'Chassis tags', value: `${U.fmt(fb.chassis)} <small>/ ${U.fmt(gb.chassis)}</small>`, foot: 'FF / GV · VRN–Tag type match', tone: 'g6', icon: '🚛' },
        { label: 'Replacement tags', value: `${U.fmt(fb.repl)} <small>/ ${U.fmt(gb.repl)}</small>`, foot: 'FF / GV · type/status match', tone: 'g3', icon: '🔄' },
        { label: 'Wrong VRN tags', value: `${U.fmt(fb.wrong)} <small>/ ${U.fmt(gb.wrong)}</small>`, foot: 'FF VRN type me "wrong"', tone: 'g7', icon: '❌' },
        { label: 'Champion boards', value: U.fmt(boards.length), foot: `${topN} deep · medals top 3`, tone: 'g4', icon: '🏆' }
      ])}
      <div class="grid g-2">${boards.join('')}</div>
      <div class="method-card"><b>Methodology</b><span>Boards month granularity par hain (EIR agent-class store). FF agents = sirf First Forward channel rows (GV master-ID rows exclude — GV side alag GV Master se, double count nahi). VC4 = class VC4; Commercial = VC20 + VC5+; Chassis = VRN/Tag type me "chassis"; Replacement = type/status me "replacement"; Wrong VRN = FF VRN type me "wrong" (GV Master me wrong-VRN flag nahi hai). Category boards poori month ke aggregate se rank hote hain — pehle top-10 total lo uske baad filter nahi.</span></div>`;

    U.$('#fc-search', root).addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(e.currentTarget).get('q') || '' }); });
    U.$('#cert-winners', root).addEventListener('click', () => printCerts(['ff|total', 'gv|total']));
    U.$$('[data-cert]', root).forEach((b) => b.addEventListener('click', () => printCerts(b.dataset.cert)));
    bindExports(root, 'fastag-export', `fastag-champions-${month}-${U.stamp()}`, 'FASTag Champions', ['Category', 'Rank', 'Name', 'ID', 'TL', 'Total', 'VC4', 'Commercial', 'Chassis', 'Replacement', 'Wrong VRN'], csvRows);
    // 🖱 KPI cards clickable — click = us metric ka POORA data (top-N board nahi, saare agents).
    const CH_HEADERS = ['Channel', 'Agent', 'ID', 'TL', 'Total', 'VC4', 'Commercial', 'Chassis', 'Replacement', 'Wrong VRN'];
    const toChRows = (list, channel) => list.map((r) => [channel, r.name, r.id || '—', r.tlName || 'Direct', r.total, r.vc4, r.commercial, r.chassis, r.replacement, r.wrongVrn]);
    const allAgg = (ch) => [...aggregate(scopeRows(ch), ch === 'ff' ? (r) => `FF|${clean(r.name)}` : (r) => `GV|${clean(r.agentId)}|${clean(r.agentName)}`, ch === 'ff' ? (r) => clean(r.name) : (r) => clean(r.agentName) || clean(r.agentId)).values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const ffAllAgg = allAgg('ff'), gvAllAgg = allAgg('gv');
    const withMetric = (list, key) => list.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key] || b.total - a.total || a.name.localeCompare(b.name));
    const catRows = (key) => [...toChRows(withMetric(ffAllAgg, key), 'First Forward'), ...toChRows(withMetric(gvAllAgg, key), 'GV Partner')];
    const boardRows = [];
    certStore.forEach((meta) => {
      meta.rows.forEach((r, i) => boardRows.push([meta.category, meta.channel, meta.isTl ? 'TL' : 'Agent', i + 1, r.name, r.id || '—', r.tlName || 'Direct', U.fmt(r[meta.metric] ?? r.total), U.fmt(r.total)]));
    });
    bindMetricDetails(root, `FASTag Champions · ${U.labelYM(month)}`, CH_HEADERS, [...toChRows(ffAllAgg, 'First Forward'), ...toChRows(gvAllAgg, 'GV Partner')], {
      'FF issuance (month)': { title: 'First Forward — saare agents', headers: CH_HEADERS, rows: toChRows(ffAllAgg, 'First Forward'), stats: [`${U.fmt(ffAllAgg.length)} agents · ${esc(U.labelYM(month))}`, `Scope: ${scope === 'all' ? 'FF + GV' : scope === 'ff' ? 'First Forward' : 'GV Partner'}`] },
      'GV issuance (month)': { title: 'GV Partner — saare agents', headers: CH_HEADERS, rows: toChRows(gvAllAgg, 'GV Partner'), stats: [`${U.fmt(gvAllAgg.length)} agents · ${esc(U.labelYM(month))}`] },
      'Chassis tags': { title: 'Agent-wise chassis tags (FF + GV)', headers: CH_HEADERS, rows: catRows('chassis'), stats: [`FF ${U.fmt(fb.chassis)} · GV ${U.fmt(gb.chassis)}`, 'VRN/Tag type me "chassis"'] },
      'Replacement tags': { title: 'Agent-wise replacement tags (FF + GV)', headers: CH_HEADERS, rows: catRows('replacement'), stats: [`FF ${U.fmt(fb.repl)} · GV ${U.fmt(gb.repl)}`, 'type/status me "replacement"'] },
      'Wrong VRN tags': { title: 'Agent-wise Wrong VRN tags', headers: CH_HEADERS, rows: catRows('wrongVrn'), stats: [`FF ${U.fmt(fb.wrong)} · GV ${U.fmt(gb.wrong)}`, 'FF VRN type me "wrong"'] },
      'Champion boards': { title: 'Har board ka poora ranked data', headers: ['Board', 'Channel', 'Level', 'Rank', 'Name', 'ID', 'TL', 'Metric value', 'Total'], rows: boardRows, stats: [`${U.fmt(boards.length)} boards · top ${topN} deep`] }
    });
  }

  function reset() { mem.details = null; mem.detailsPromise = null; mem.masterIndex = null; mem.ffComm = null; mem.ffCommPromise = null; mem.cross = null; mem.quality = null; mem.workspaceVersion++; mem.workspace = null; mem.workspacePromise = null; mem.forecastHistory = null; mem.forecastHistoryPromise = null; mem.payout = null; mem.payoutPromise = null; }

  // 🧹 v3.62 — executive / gvCommission / ffCommission / forecast / savedViews / reportStudio /
  // followups pages retire ho gayi hain (app.js RETIRED_PAGES unhe safe page par bhejta hai), isliye
  // unke renderer + registration yahan se hata diye gaye. Sirf live pages register hoti hain.
  FF.pages.dualChannel = { title: 'Dual-channel Agents', render: renderDualChannel };
  FF.pages.masterStock = { title: 'Master Stock', render: renderMasterStock };
  FF.pages.dataQuality = { title: 'Data Quality', render: renderDataQuality };
  FF.pages.fastagChampions = { title: 'FASTag Champions', render: renderFastagChampions };
  // v3.8.3: FF.data.clearCache() ho (fresh sync / smoke) to commission analysis cache bhi invalidate ho.
  if (FF.data && typeof FF.data.clearCache === 'function' && !FF.data.clearCache.__insightsWrapped) {
    const origClear = FF.data.clearCache;
    const wrappedClear = function (...args) { mem.ffComm = null; mem.ffCommPromise = null; return origClear.apply(this, args); };
    wrappedClear.__insightsWrapped = true;
    FF.data.clearCache = wrappedClear;
  }

  // Page chrome helpers shared with cockpit.js (v3.8) so naye pages bilkul same look rakhein.
  const UI_KIT = { head, sourceChip, printButton, exportButtons, bindExports, vividMetrics, metric, statusPill, empty, money, validValue, clean, sum, normId, normName, segmentOf, bindMetricDetails, openInsDialog };
  FF.insights = { reset, loadDetails, buildCross, ffCommissionData, ffPayoutRates: loadPayoutRates, payoutExpected: payoutBreakdown, gvPersonalCommission, gvPersonalCommissionFromRows: buildGvPersonalCommission, gvCommissionDailyTrend, gvCommissionTlSummary, gvCommissionAgentRanking, qualityIssues, forecastAccuracy, stockBalanceReconciliation, commissionSlabExpected: slabExpected, openInsDialog, forecastRows, slabVariance: slabVarianceRows, ui: UI_KIT };
})(window.FF);
