/* FASTag Mapping — StockDataa lookup + secure server-side mapping API + CSV export. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, D = FF.data;
  const API_STATUS = '/api/fastag-mapping/status';
  const API_MAP = '/api/fastag-mapping/map';
  const MAX_INPUTS = 2500;
  const MAX_RESULTS = 20000;
  const API_LOOKUP = '/api/fastag-mapping/lookup';
  const API_INDEX_STATUS = '/api/fastag-mapping/index-status';
  const API_SHEET_READ = '/api/fastag-mapping/sheet/read';
  const API_SHEET_MARK = '/api/fastag-mapping/sheet/mark';
  // v3.72 — live counters ke liye chhote batches: 25-row batch har 1-3 s me complete hota hai,
  // isliye "kitne mapping ho gaye" screen par lagataar badhta dikhta hai (pehle 100-row batch
  // me ek-ek jump aata tha).
  const MAP_BATCH = 25, MAP_PARALLEL = 3, SHOW_STEP = 300;
  const LOOKUP_CHUNK = 400;         // server StockDataa lookup ek saath itne items (chhote chunk = live count)
  const LOOKUP_PARALLEL = 2;
  const INDEX_POLL_MS = 2500;       // StockDataa index status itni der me refresh
  const PROGRESS_STYLE_ID = 'fm-progress-styles';
  const SHEET_CFG_KEY = 'ffFmSheetCfg';
  let nextId = 1;
  const state = { items: [], rows: [], configured: false, busy: false, root: null, showLimit: 300, sheetCtx: null, index: null, indexAt: 0, rateLimited: false };
  // ── 📊 Live progress (v3.72) ────────────────────────────────────────────────────────────────────
  // Sheet read / StockDataa lookup / mapping — teeno phases ka live counter (kitne ho gaye,
  // kitne bache, success/failed, %, ETA) screen par lagataar update hota rehta hai.
  const prog = { phase: '', title: '', total: 0, done: 0, ok: 0, failed: 0, detail: '', note: '', startedAt: 0, endedAt: 0, retry: '', retryAction: '', rateSec: 0 };
  const progTimers = { tick: null, index: null };
  const canInterval = () => typeof setInterval === 'function' && typeof clearInterval === 'function';
  const later = (fn, ms) => (typeof setTimeout === 'function' ? setTimeout(fn, ms) : 0);
  const num = (v) => (typeof U.fmt === 'function' ? U.fmt(Number(v) || 0) : String(Number(v) || 0));
  // Small session-local index: repeated Quick Map / barcode lookups should not hit Sheets again.
  const stockByBarcode = new Map();
  const stockByTagId = new Map();
  const stockRangeCache = new Map();
  const STOCK_LOOKUP_CACHE_MAX = 50000;
  const STOCK_RANGE_CACHE_MAX = 100;
  // A negative gviz response should not hide a newly-added StockDataa row for the cache TTL.
  const STOCK_LOOKUP_TIMEOUT_MS = 14000;
  const STOCK_PAGE_TIMEOUT_MS = 16000;
  const esc = (v) => U.esc(String(v == null ? '' : v));
  const clean = (v) => String(v == null ? '' : v).replace(/\u00a0/g, ' ').trim();
  // ── live progress helpers ───────────────────────────────────────────────────────────────────────
  function ensureProgressStyles() {
    if (typeof document === 'undefined' || !document.head || !document.createElement || document.getElementById(PROGRESS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PROGRESS_STYLE_ID;
    style.textContent = [
      '.fm-progress{margin:0 0 10px;padding:12px 14px;border:1px solid var(--line,#dbe3ef);border-radius:14px;background:linear-gradient(135deg,rgba(79,70,229,.08),rgba(14,165,233,.06))}',
      '.fm-progress[hidden]{display:none}',
      '.fm-prog-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px}',
      '.fm-prog-head b{font-size:14px}',
      '.fm-prog-pill{margin-left:auto;padding:2px 9px;border-radius:99px;background:rgba(79,70,229,.12);font-weight:800;font-size:11.5px;color:var(--brand,#4f46e5)}',
      '.fm-prog-pill+.fm-prog-pill{margin-left:0}',
      '.fm-prog-track{position:relative;height:9px;margin:10px 0 8px;border-radius:99px;background:#e9edf6;overflow:hidden}',
      '.fm-prog-track>i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--brand,#4f46e5),var(--brand-2,#ec4899));transition:width .35s ease}',
      '.fm-prog-nums{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;font-weight:650;color:var(--muted,#64748b)}',
      '.fm-prog-nums b{color:var(--text,#0f172a)}',
      '.fm-prog-nums .ok b{color:#047857}.fm-prog-nums .bad b{color:#b91c1c}',
      '.fm-prog-note{margin-top:7px;font-size:12px;color:var(--muted,#64748b)}',
      '.fm-prog-note.warn{color:#b45309;font-weight:700}',
      '.fm-prog-retry{margin-top:9px}',
      '.fm-prog-live{display:inline-block;width:7px;height:7px;border-radius:99px;background:#22c55e;margin-right:5px;animation:fmProgPulse 1.1s ease-in-out infinite}',
      '@keyframes fmProgPulse{0%,100%{opacity:1}50%{opacity:.25}}'
    ].join('');
    document.head.appendChild(style);
  }
  const pctOf = (done, total) => (!total ? 0 : Math.max(0, Math.min(100, Math.round((done / total) * 100))));
  function fmtDur(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
    return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }
  function renderProgress() {
    const host = state.root ? U.$('#fm-progress', state.root) : null;
    if (!host) return;
    if (!prog.phase) { if (host.style) host.style.display = 'none'; host.innerHTML = ''; return; }
    if (host.style) host.style.display = '';
    const active = !prog.endedAt;
    const elapsed = Math.max(0, ((prog.endedAt || Date.now()) - prog.startedAt) / 1000);
    const rate = elapsed > 1 ? prog.done / elapsed : 0;
    const percent = pctOf(prog.done, prog.total);
    const remain = active && rate > 0.03 && prog.total > prog.done ? (prog.total - prog.done) / rate : 0;
    const parts = [];
    parts.push('<div class="fm-prog-head">' + (active ? '<span class="fm-prog-live"></span>' : '') + '<b>' + esc(prog.title || 'Progress') + '</b>' +
      '<span class="fm-prog-pill">' + esc(prog.done + (prog.total ? ' / ' + prog.total : '')) + ' rows</span>' +
      '<span class="fm-prog-pill">' + percent + '%</span></div>');
    parts.push('<div class="fm-prog-track"><i style="width:' + percent + '%"></i></div>');
    parts.push('<div class="fm-prog-nums">' +
      '<span class="ok">✅ Mapped / done <b>' + num(prog.ok) + '</b></span>' +
      '<span class="bad">❌ Failed <b>' + num(prog.failed) + '</b></span>' +
      (prog.total ? '<span>⏳ Bachhe <b>' + num(Math.max(0, prog.total - prog.done)) + '</b></span>' : '') +
      '<span>⏱ ' + fmtDur(elapsed) + (remain ? ' · ETA ~' + fmtDur(remain) : '') + '</span>' +
      (rate > 0.03 ? '<span>⚡ ' + rate.toFixed(1) + '/s</span>' : '') + '</div>');
    if (prog.detail) parts.push('<div class="fm-prog-note">' + esc(prog.detail) + '</div>');
    if (prog.rateSec) parts.push('<div class="fm-prog-note warn">⏳ Google rate limit — ' + fmtDur(prog.rateSec) + ' me apne aap retry hoga (purana cache data dikh raha hai).</div>');
    if (prog.note) parts.push('<div class="fm-prog-note">' + esc(prog.note) + '</div>');
    if (prog.retry) parts.push('<div class="btn-row fm-prog-retry"><button class="btn small" id="fm-retry" type="button">🔁 ' + esc(prog.retry) + '</button></div>');
    host.innerHTML = parts.join('');
  }
  function startProgTimer() {
    if (!canInterval() || progTimers.tick) return;
    progTimers.tick = setInterval(() => { if (prog.endedAt) stopProgTimer(); else renderProgress(); }, 1000);
  }
  function stopProgTimer() {
    if (progTimers.tick && typeof clearInterval === 'function') clearInterval(progTimers.tick);
    progTimers.tick = null;
  }
  function progressStart(phase, title, total, detail) {
    ensureProgressStyles();
    stopProgTimer();
    Object.assign(prog, { phase, title, total: Math.max(0, Number(total) || 0), done: 0, ok: 0, failed: 0, detail: detail || '', note: '', startedAt: Date.now(), endedAt: 0, retry: '', retryAction: '', rateSec: 0 });
    startProgTimer();
    renderProgress();
  }
  function progressSet(patch) { if (!prog.phase) return; Object.assign(prog, patch || {}); renderProgress(); }
  function progressReset() {
    stopProgTimer();
    Object.assign(prog, { phase: '', title: '', total: 0, done: 0, ok: 0, failed: 0, detail: '', note: '', startedAt: 0, endedAt: 0, retry: '', retryAction: '', rateSec: 0 });
    renderProgress();
  }
  function progressEnd(note) {
    if (!prog.phase) return;
    prog.endedAt = prog.endedAt || Date.now();
    prog.retry = ''; prog.retryAction = '';
    if (note) prog.note = note;
    prog.rateSec = 0;
    stopProgTimer();
    renderProgress();
  }
  function progressFail(message, retryLabel, retryAction) {
    if (!prog.phase) progressStart('idle', 'Error', 0, '');
    prog.endedAt = Date.now();
    prog.detail = String(message || '').slice(0, 400);
    prog.retry = retryLabel || '';
    prog.retryAction = retryAction || '';
    stopProgTimer();
    renderProgress();
  }
  /** Rate limit (Google 429) abhi active hai? — heavy scans is dauran rok dete hain. */
  const rateLimitActive = () => !!(FF.data && typeof FF.data.rateLimitStatus === 'function' && FF.data.rateLimitStatus().active);
  const rateLimitSecs = () => (FF.data && typeof FF.data.rateLimitStatus === 'function' ? FF.data.rateLimitStatus().blockedSec : 0);
  function rateLimitError() {
    const e = new Error('Google Sheets ne rate limit kar diya (429 Too Many Requests). ' + (rateLimitSecs() ? '~' + rateLimitSecs() + 's me retry hoga. ' : '') + 'Server ka StockDataa index ready hone par lookup turant ho jaayega — thodi der baad "🔁 Dobara try" dabayein.');
    e.rateLimited = true;
    return e;
  }
  const norm = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  const cols = () => {
    const s = FF.config.stock || {};
    return { id: s.id || 'A', name: s.name || 'B', tagId: s.tagId || 'C', barcode: s.barcode || 'D', cls: s.cls || 'E', tagType: s.tagType || 'F', bcAllocatedAt: s.bcAllocatedAt || 'G', agentId: s.agentId || 'H', agentName: s.agentName || 'I', agentAllocatedAt: s.agentAllocatedAt || 'J', tlName: s.tlName || 'K' };
  };
  const colIndex = (col) => String(col).toUpperCase().split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function parseCsv(text, delimiter) {
    const out = [], row = []; let cell = '', quoted = false;
    const input = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (quoted) {
        if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false; else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && input[i + 1] === '\n') i++;
        row.push(cell); cell = ''; if (row.some((x) => clean(x))) out.push(row.splice(0));
      } else cell += ch;
    }
    row.push(cell); if (row.some((x) => clean(x))) out.push(row); return out;
  }
  function xmlText(s) {
    return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  }
  async function readZipEntry(buffer, wanted) {
    const v = new DataView(buffer); let eocd = -1;
    for (let i = Math.max(0, buffer.byteLength - 65557); i <= buffer.byteLength - 22; i++) if (v.getUint32(i, true) === 0x06054b50) eocd = i;
    if (eocd < 0) throw new Error('XLSX ZIP index nahi mila.');
    const count = v.getUint16(eocd + 10, true), start = v.getUint32(eocd + 16, true);
    let p = start; const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true), name = decoder.decode(new Uint8Array(buffer, p + 46, nameLen));
      if (name === wanted) {
        const startData = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        const bytes = new Uint8Array(buffer, startData, size);
        if (method === 0) return decoder.decode(bytes);
        if (method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('Is browser me XLSX compression supported nahi. File ko CSV me save karke upload karein.');
        return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return '';
  }
  function xlsxMatrix(xml, shared) {
    const matrix = []; const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g; let rm;
    while ((rm = rowRe.exec(xml))) {
      const arr = []; const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g; let cm;
      while ((cm = cellRe.exec(rm[1]))) {
        const ref = (cm[1].match(/\br="([A-Z]+)\d+"/i) || [])[1] || '', idx = colIndex(ref);
        const type = (cm[1].match(/\bt="([^"]+)"/) || [])[1] || ''; let value = '';
        if (type === 'inlineStr') value = [...cm[2].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1])).join('');
        else { const vm = cm[2].match(/<v>([\s\S]*?)<\/v>/); value = vm ? xmlText(vm[1]) : ''; if (type === 's') value = shared[Number(value)] || ''; }
        if (idx >= 0) arr[idx] = value;
      }
      matrix.push(arr.map((x) => x == null ? '' : String(x)));
    }
    return matrix;
  }
  async function parseXlsx(file) {
    const buffer = await file.arrayBuffer();
    const workbook = await readZipEntry(buffer, 'xl/workbook.xml');
    const rels = await readZipEntry(buffer, 'xl/_rels/workbook.xml.rels');
    let target = 'xl/worksheets/sheet1.xml';
    const rid = (workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || [])[1];
    if (rid && rels) {
      const re = /<Relationship\b([^>]*)\/?>/g; let m;
      while ((m = re.exec(rels))) {
        const id = (m[1].match(/\bId="([^"]+)"/) || [])[1], relTarget = (m[1].match(/\bTarget="([^"]+)"/) || [])[1];
        if (id === rid && relTarget) { const targetPath = relTarget.replace(/^\//, ''); target = targetPath.startsWith('xl/') ? targetPath : 'xl/' + targetPath.replace(/^\.\//, ''); break; }
      }
    }
    const sheetXml = await readZipEntry(buffer, target);
    if (!sheetXml) throw new Error('XLSX ki first worksheet nahi mili.');
    const sharedXml = await readZipEntry(buffer, 'xl/sharedStrings.xml'), shared = [];
    if (sharedXml) { const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g; let m; while ((m = re.exec(sharedXml))) shared.push([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xmlText(x[1])).join('')); }
    return xlsxMatrix(sheetXml, shared);
  }
  const ALIASES = {
    first: ['firstbarcode', 'startbarcode', 'frombarcode', 'barcodefrom', 'startserial', 'firstserial', 'from'],
    last: ['lastbarcode', 'endbarcode', 'tobarcode', 'barcodeto', 'endserial', 'lastserial', 'to'],
    barcode: ['barcode', 'barcodeno', 'barcodenumber', 'barcodeid', 'tagbarcode', 'barcodevalue', 'tagbarcodeid'],
    serialNo: ['serialno', 'serialnumber', 'serial', 'serialid'],
    tagId: ['tagid', 'tagidnumber', 'tagnumber', 'tagnumber', 'fastagid', 'fastagtagid', 'tagno', 'tagnumberid', 'tag_id'],
    vcType: ['vctype', 'tagclass', 'tag_class', 'vehicletyp', 'vehicletype', 'vehicleclass', 'vehicleclasstype', 'classtype', 'vclass', 'vcclass', 'classvctype', 'class', 'classofvehicle'],
    agentId: ['agentid', 'agentcode', 'employeeid', 'mappedagentid', 'newagentid', 'allocatedagentid', 'allottedagentid', 'agentidnumber']
  };
  function headerMap(header) {
    const h = header.map(norm), found = {};
    for (const key of Object.keys(ALIASES)) { const idx = h.findIndex((v) => ALIASES[key].includes(v)); if (idx >= 0) found[key] = idx; }
    return found;
  }
  function parsedItems(matrix, filename) {
    if (!matrix.length) return { items: [], invalid: 0 };
    const hm = headerMap(matrix[0]), hasHeader = Object.keys(hm).length > 0, rows = hasHeader ? matrix.slice(1) : matrix, out = [];
    let invalid = 0;
    for (const r of rows) {
      const get = (k, fallback) => hm[k] !== undefined ? clean(r[hm[k]]) : (fallback === undefined ? '' : clean(r[fallback]));
      const first = get('first'), last = get('last'), tagId = get('tagId', hasHeader ? undefined : -1);
      const barcode = get('barcode', hasHeader ? undefined : 0);
      const serialNo = get('serialNo', hasHeader ? undefined : -1);
      const agentId = get('agentId', hasHeader ? undefined : 1);
      if (first && last) {
        if (!agentId) { invalid++; continue; }
        out.push({ id: nextId++, type: 'range', first, last, agentId, source: filename || 'Upload', selected: true });
      } else if (tagId || serialNo || barcode) {
        // Template has exactly tagId, serialNo, vcType, agentId. serialNo acts as the
        // lookup key when tagId is blank; VC type is always re-read from StockDataa.
        if (!agentId) { invalid++; continue; }
        out.push({ id: nextId++, type: tagId ? 'tagId' : 'barcode', tagId, barcode: barcode || serialNo, serialNo, agentId, source: filename || 'Upload', selected: true });
      } else if (r.some((x) => clean(x))) invalid++;
    }
    return { items: out, invalid };
  }
  function isDigitKey(v) { return /^\d+$/.test(clean(v)); }
  function compareBarcode(a, b) {
    const rawX = clean(a), rawY = clean(b);
    const x = rawX.replace(/[,\s-]/g, ''), y = rawY.replace(/[,\s-]/g, '');
    if (isDigitKey(x) && isDigitKey(y)) { const xx = BigInt(x), yy = BigInt(y); return xx < yy ? -1 : (xx > yy ? 1 : 0); }
    return rawX.localeCompare(rawY, undefined, { numeric: true, sensitivity: 'base' });
  }
  function literal(v, numeric) {
    const s = clean(v);
    if (numeric && isDigitKey(s) && !(s.length > 1 && s[0] === '0')) return s;
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  const STOCK_LETTERS = 'ABCDEFGHIJKLM'.split('');
  const fallbackSchema = () => {
    const s = cols();
    return {
      letters: STOCK_LETTERS,
      index: {
        id: colIndex(s.id), name: colIndex(s.name),
        tagId: colIndex('C'), barcode: colIndex('D'), serialNo: colIndex('D'),
        vcType: colIndex('E'), tagType: colIndex(s.tagType), barcodeAllocatedAt: colIndex(s.bcAllocatedAt),
        agentId: colIndex(s.agentId), agentName: colIndex(s.agentName),
        agentAllocatedAt: colIndex(s.agentAllocatedAt), tlName: colIndex(s.tlName)
      },
      labels: []
    };
  };
  // Project StockDataa configuration defines TAG_ID=C, BARCODE=D, TAG_CLASS=E.
  // Reuse that known mapping instead of spending another round-trip on a header-only query;
  // the previous header probe was also timing out before the actual lookup could start.
  async function stockSchema() {
    const fallback = fallbackSchema();
    fallback.index.tagId = colIndex('C');
    fallback.index.barcode = colIndex('D');
    fallback.index.serialNo = colIndex('D');
    fallback.index.vcType = colIndex('E');
    return fallback;
  }
  // Expand scientific notation without routing through Number(), which can round long IDs.
  function expandIdentifierNumber(value) {
    const raw = clean(value);
    const m = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
    if (!m) return raw;
    const sign = m[1] || '', whole = m[2], frac = m[3] || '', exponent = Number(m[4]);
    const digits = whole + frac;
    const decimalAt = whole.length + exponent;
    if (decimalAt <= 0) return sign + '0.' + '0'.repeat(Math.min(1000, -decimalAt)) + digits;
    if (decimalAt >= digits.length) return sign + digits + '0'.repeat(Math.min(1000, decimalAt - digits.length));
    return sign + digits.slice(0, decimalAt) + '.' + digits.slice(decimalAt);
  }
  function tableCellText(cell, col, key) {
    if (!cell) return '';
    // Identifiers must come from the underlying cell value, not its display format:
    // cell.f may be "8,900,000,000,123,456" or "8.9E+15", breaking exact matches/API payloads.
    if (key === 'tagId' || key === 'barcode' || key === 'serialNo') {
      const display = clean(cell.f);
      // A formatted digit string may intentionally preserve leading zeroes; remove grouping commas only.
      if (/^\d[\d,]*$/.test(display)) return display.replace(/,/g, '');
      if (cell.v !== null && cell.v !== undefined && clean(cell.v) !== '') {
        const raw = clean(cell.v);
        if (typeof cell.v === 'number' || /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(raw)) {
          return expandIdentifierNumber(raw);
        }
        return raw;
      }
      return display;
    }
    return clean(D.cellText(cell, col));
  }
  function rememberStockRows(rows) {
    for (const row of rows || []) {
      for (const key of [row.barcode, row.serialNo]) {
        const k = idKey(key);
        if (k) { stockByBarcode.delete(k); stockByBarcode.set(k, row); }
      }
      const tagKey = idKey(row.tagId);
      if (tagKey) { stockByTagId.delete(tagKey); stockByTagId.set(tagKey, row); }
    }
    for (const index of [stockByBarcode, stockByTagId]) {
      while (index.size > STOCK_LOOKUP_CACHE_MAX) index.delete(index.keys().next().value);
    }
  }
  function stockRows(table, schema) {
    const ix = schema && schema.index ? schema.index : fallbackSchema().index;
    const rows = (table.rows || []).map((row) => {
      const val = (key) => tableCellText(row[ix[key]], table.cols && table.cols[ix[key]], key);
      const stock = {
        stockRowId: val('id'), inventoryName: val('name'), tagId: val('tagId'), barcode: val('barcode'), serialNo: val('serialNo') || val('barcode'),
        vcType: val('vcType'), tagType: val('tagType'), barcodeAllocatedAt: val('barcodeAllocatedAt'), stockAgentId: val('agentId'),
        stockAgentName: val('agentName'), agentAllocatedAt: val('agentAllocatedAt'), tlName: val('tlName')
      };
      stock.vcType = normalizeVcType(stock.vcType);
      return stock;
    }).filter((r) => r.tagId || r.barcode || r.serialNo);
    rememberStockRows(rows);
    return rows;
  }
  function normalizeVcType(value) {
    let raw = clean(value).toUpperCase().replace(/\s+/g, '');
    if (!raw) return '';
    // StockDataa TAG_CLASS me "4 / 16 / VC4 / vc-4 / Class 4 / 4.0" kuch bhi aa sakta hai.
    // Mapping API (VC4, VC5, VC6, VC7, VC12, VC15, VC16) sirf canonical "VC<number>" leti hai.
    raw = raw.replace(/\.0+$/, '').replace(/[^A-Z0-9]/g, ''); // "4.0" → "4" · "VC-4" → "VC4"
    const m = raw.match(/^(?:TAG|VEHICLE)?CLASS(?:VC)?(\d{1,3})$/) || raw.match(/^VC(\d{1,3})$/);
    if (m) return 'VC' + Number(m[1]); // "CLASS4" / "VC04" jaise spellings bhi canonical
    if (/^\d+$/.test(raw)) return 'VC' + Number(raw); // sheet ka plain number → "VC" + digit
    return raw; // kuch aur ho to API khud bata degi — pehle jaisa behaviour
  }
  const idKey = (v) => expandIdentifierNumber(clean(v)).replace(/[\s,\u00a0-]/g, '').toLowerCase();
  // gviz rule: sheet ke existing columns se aage ke letters select karne par "Invalid query:
  // NO_COLUMN: X" aata hai (StockDataa sheet ab patli ho chuki hai — purani hardcoded
  // "select A..L,M" isliye fail hoti thi). Isliye:
  //  1) select hamesha schema ke needed letters (config: id..tlName → A..K) tak hi banao;
  //  2) phir bhi NO_COLUMN aaye to select-list us column tak chhoti karke ek retry (auto-shrink).
  let stockColumnCap = STOCK_LETTERS.length; // NO_COLUMN aane par ghata jaata hai
  function selectClause() {
    const needed = Math.max(...Object.values(fallbackSchema().index)) + 1; // config ka max letter (K → 11)
    const n = Math.max(1, Math.min(stockColumnCap, needed, STOCK_LETTERS.length));
    return 'select ' + STOCK_LETTERS.slice(0, n).join(',');
  }
  /** D.query + NO_COLUMN auto-shrink retry — sheet jitni patli hai utne hi columns select honge. */
  async function stockQuery(tq, opts) {
    try {
      return await D.query('StockDataa', tq, opts);
    } catch (err) {
      const m = String((err && (err.message || err)) || '').match(/NO_COLUMN:\s*([A-Z])/i);
      if (!m) throw err;
      const missingIdx = m[1].toUpperCase().charCodeAt(0) - 65; // 0-based column index
      if (missingIdx < 1) throw err; // column A hi gayab — sheet/data galat hai
      // Ye letter bheji gayi query ke select me tha? (Concurrent sibling query cap pehle hi
      // chhota sakti hai — apne tq me letter tha to bhi rebuild karke retry sahi hai.)
      const selectPart = (String(tq).match(/^select\s+([A-Z](?:\s*,\s*[A-Z])*)\s+where\s/i) || [])[1] || '';
      const inSelect = new RegExp('(?:^|,)\\s*' + m[1] + '\\s*(?:,|$)', 'i').test(selectPart);
      if (!inSelect && missingIdx >= stockColumnCap) throw err;
      stockColumnCap = Math.min(stockColumnCap, missingIdx); // is column aur aage ke letters ab nahi
      const rebuilt = tq.replace(/^select\s+[A-Z](?:\s*,\s*[A-Z])*\s+where\s/i, selectClause() + ' where ');
      if (rebuilt === tq) throw err;
      return D.query('StockDataa', rebuilt, opts);
    }
  }
  async function queryField(fieldName, values, tick) {
    const unique = [...new Set(values.map(clean).filter(Boolean))];
    if (!unique.length) return [];
    const schema = await stockSchema(), fieldIndex = schema.index[fieldName], field = schema.letters[fieldIndex] || cols()[fieldName];
    if (!field) throw new Error('StockDataa me ' + fieldName + ' column resolve nahi hua.');

    const index = fieldName === 'tagId' ? stockByTagId : stockByBarcode;
    const matchesValue = (row, value) => idKey(fieldName === 'tagId' ? row.tagId : row.barcode) === idKey(value);
    const found = new Map();
    // Instant path for rows found earlier in this session.
    for (const value of unique) {
      const hit = index.get(idKey(value));
      if (hit && matchesValue(hit, value)) found.set(idKey(hit.tagId) + '|' + idKey(hit.barcode), hit);
    }
    const pending = unique.filter((value) => ![...found.values()].some((row) => matchesValue(row, value)));
    if (!pending.length) return [...found.values()];

    const batches = [];
    for (const numeric of [true, false]) {
      const typedValues = pending.filter((value) => isDigitKey(value) === numeric);
      for (let i = 0; i < typedValues.length; i += 15) batches.push({ values: typedValues.slice(i, i + 15), numeric });
    }
    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, batches.length) }, async () => {
      while (cursor < batches.length) {
        const work = batches[cursor++], batch = work.values;
        const make = (numeric, vals) => selectClause() + ' where ' + vals.map((x) => field + ' = ' + literal(x, numeric)).join(' or ');
        const queryRows = async (tq) => {
          // Google ne rate limit kiya ho to aur queries bharna ulta nuksaan hai — saaf message ke saath ruk jao.
          if (rateLimitActive()) throw rateLimitError();
          const table = await stockQuery(tq, {
            fresh: true, timeoutMs: STOCK_LOOKUP_TIMEOUT_MS, retries: 0, directFirst: true
          });
          return stockRows(table, schema);
        };

        let rows = [];
        if (work.numeric) {
          // Launch text + numeric variants together, but resolve as soon as every requested
          // identifier in this batch has a match. One slow sibling request won't delay Quick Map.
          rows = await new Promise((resolve, reject) => {
            const variants = [make(false, batch), make(true, batch)];
            let settled = 0, successful = 0, done = false;
            const failures = [], matches = new Map();
            const finish = (value) => { if (!done) { done = true; resolve(value); } };
            variants.forEach((tq) => {
              queryRows(tq).then((resultRows) => {
                if (done) return;
                successful++;
                for (const row of resultRows) {
                  const sourceValue = fieldName === 'tagId' ? row.tagId : row.barcode;
                  if (batch.some((value) => idKey(value) === idKey(sourceValue))) {
                    matches.set(idKey(row.tagId) + '|' + idKey(row.barcode), row);
                  }
                }
                if (batch.every((value) => [...matches.values()].some((row) => matchesValue(row, value)))) {
                  finish([...matches.values()]);
                  return;
                }
                settled++;
                if (settled === variants.length) finish([...matches.values()]);
              }).catch((err) => {
                if (done) return;
                failures.push(err);
                settled++;
                if (settled === variants.length) {
                  if (successful) finish([...matches.values()]);
                  else {
                    const first = failures[0];
                    reject(new Error(isLookupTimeout(first)
                      ? 'StockDataa lookup timeout. Network/source slow hai; same lookup cache se dobara try karein.'
                      : 'StockDataa lookup failed: ' + String(first && (first.message || first) || 'Google Sheets query error')));
                  }
                }
              });
            });
          });
        } else {
          rows = await queryRows(make(false, batch));
        }
        for (const row of rows) {
          const sourceValue = fieldName === 'tagId' ? row.tagId : row.barcode;
          if (!batch.some((value) => idKey(value) === idKey(sourceValue))) continue;
          found.set(idKey(row.tagId) + '|' + idKey(row.barcode), row);
        }
        if (tick) tick(batch.length);   // live progress: ye batch (up to 15 identifiers) ho gaya
      }
    });
    await Promise.all(workers);

    // Last-resort scan only when both exact barcode formats returned no row.
    // Cached rows make a second request for the same barcode memory-only.
    if (fieldName === 'barcode') {
      const unresolved = () => pending.filter((value) =>
        ![...found.values()].some((row) => matchesValue(row, value))
      );
      const PAGE_SIZE = 5000, HARD_CAP = 250000, PARALLEL_PAGES = 4;
      let offset = 0, finished = false, previousPageFingerprint = '';
      const fetchPage = async (start) => {
        if (rateLimitActive()) throw rateLimitError();   // scan aadha-adhura chhod kar saaf message do
        const tq = selectClause() + ' where ' + field + ' is not null limit ' + PAGE_SIZE + ' offset ' + start;
        try {
          return await stockQuery(tq, {
            fresh: true, timeoutMs: STOCK_PAGE_TIMEOUT_MS, retries: 0, directFirst: true
          });
        } catch (err) {
          if (err && err.rateLimited) throw err;
          throw new Error('StockDataa BARCODE scan failed near row ' + (start + 1) + ': ' + String(err && (err.message || err) || 'Google Sheets query error'));
        }
      };
      const processPage = (table) => {
        const pageRows = table.rows || [];
        const rows = stockRows(table, schema);
        const pageFingerprint = rows.map((row) => idKey(row.stockRowId) || (idKey(row.tagId) + '|' + idKey(row.barcode))).join(',');
        if (pageRows.length && pageFingerprint && pageFingerprint === previousPageFingerprint) {
          throw new Error('StockDataa barcode pagination ne same page repeat kiya; lookup ko rok diya gaya.');
        }
        if (pageRows.length) previousPageFingerprint = pageFingerprint;
        for (const row of rows) {
          if (!unresolved().some((value) => matchesValue(row, value))) continue;
          found.set(idKey(row.tagId) + '|' + idKey(row.barcode), row);
        }
        return pageRows.length;
      };
      const firstTable = await fetchPage(0);
      const firstCount = processPage(firstTable);
      offset = firstCount < PAGE_SIZE ? firstCount : PAGE_SIZE;
      finished = firstCount === 0;
      while (offset < HARD_CAP && !finished && unresolved().length) {
        const starts = Array.from({ length: PARALLEL_PAGES }, (_, i) => offset + PAGE_SIZE * i).filter((start) => start < HARD_CAP);
        const pages = await Promise.all(starts.map((start) => fetchPage(start)));
        let advanceTo = offset;
        for (let i = 0; i < pages.length; i++) {
          const count = processPage(pages[i]);
          if (!count) { finished = true; break; }
          advanceTo = starts[i] + PAGE_SIZE;
          if (!unresolved().length) break;
          if (count < PAGE_SIZE) { advanceTo = starts[i] + count; break; }
        }
        if (advanceTo <= offset && !finished && unresolved().length) throw new Error('StockDataa barcode scan offset aage nahi badha.');
        offset = advanceTo;
      }
      if (offset >= HARD_CAP && unresolved().length) {
        throw new Error('StockDataa mein 250,000 rows scan ho chuki hain. Exact match ke liye chhoti barcode range dein.');
      }
    }
    return [...found.values()];
  }
  function isLookupTimeout(err) {
    return /abort|timed?\s*out|timeout|HTTP 502|HTTP 503|fetch failed|upstream/i.test(String(err && (err.message || err)));
  }
  function dedupeStockRows(rows) {
    const unique = new Map();
    (rows || []).forEach((row) => unique.set(idKey(row.tagId) + '|' + idKey(row.barcode), row));
    return [...unique.values()];
  }
  async function queryRange(from, to) {
    const schema = await stockSchema();
    const normalizeBoundary = (value) => {
      const raw = clean(value);
      return /^[\d,\s-]+$/.test(raw) ? raw.replace(/[,\s-]/g, '') : raw;
    };
    from = normalizeBoundary(from);
    to = normalizeBoundary(to);
    if (compareBarcode(from, to) > 0) throw new Error('First barcode last se bada hai.');
    const cacheKey = idKey(from) + '|' + idKey(to);
    if (stockRangeCache.has(cacheKey)) return stockRangeCache.get(cacheKey).slice();
    if (idKey(from) === idKey(to)) {
      const cached = stockByBarcode.get(idKey(from));
      if (cached) {
        stockRangeCache.set(cacheKey, [cached]);
        return [cached];
      }
    }
    const rememberRange = (rows) => {
      stockRangeCache.delete(cacheKey);
      stockRangeCache.set(cacheKey, rows.slice());
      while (stockRangeCache.size > STOCK_RANGE_CACHE_MAX) stockRangeCache.delete(stockRangeCache.keys().next().value);
      return rows;
    };

    // Fast path: ask Google for the requested barcode interval directly instead of reading
    // up to 250k stock rows. Query numeric/text variants concurrently to handle mixed typing.
    const fastSelect = () => selectClause() + ' where ';
    const variants = [];
    variants.push(fastSelect() + 'D >= ' + literal(from, false) + ' and D <= ' + literal(to, false) + ' limit ' + (MAX_RESULTS + 1));
    if (isDigitKey(from) && isDigitKey(to) && !(from.length > 1 && from[0] === '0') && !(to.length > 1 && to[0] === '0')) {
      variants.push(fastSelect() + 'D >= ' + literal(from, true) + ' and D <= ' + literal(to, true) + ' limit ' + (MAX_RESULTS + 1));
    }
    // Run text + numeric interval predicates concurrently. Mixed-type barcode cells can
    // appear in either result, so merge BOTH completed responses before returning; this avoids
    // a fast partial response silently omitting rows from the other storage type.
    const fastResults = await Promise.all(variants.map(async (tq) => {
      try {
        const table = await stockQuery(tq, {
          timeoutMs: 4500, directTimeoutMs: 1800, retries: 0, directFirst: true
        });
        return stockRows(table, schema);
      } catch {
        // Preserve the bounded paged fallback if both optimized predicates cannot find rows.
        return [];
      }
    }));
    const fastDedupe = new Map();
    for (const rows of fastResults) {
      for (const row of rows) {
        if (!row.barcode || compareBarcode(row.barcode, from) < 0 || compareBarcode(row.barcode, to) > 0) continue;
        fastDedupe.set(idKey(row.tagId) + '|' + idKey(row.barcode), row);
      }
    }
    if (fastDedupe.size) return rememberRange([...fastDedupe.values()]);
    // If the bounded range query returns nothing, fall back to paged local comparison for
    // mixed-type/text-stored IDs. Exact lookup/cached session index should handle most singles.
    // Multiple range pages are fetched in parallel, stopping as soon as pages are empty.
    const PAGE_SIZE = 5000, HARD_CAP = 250000, PARALLEL_PAGES = 4;
    const matched = new Map();
    let offset = 0, finished = false, previousPageFingerprint = '';
    const fetchPage = async (start) => {
      if (rateLimitActive()) throw rateLimitError();
      try {
        return await stockQuery(selectClause() + ' where D is not null limit ' + PAGE_SIZE + ' offset ' + start, {
          timeoutMs: 4500, directTimeoutMs: 1800, retries: 0, directFirst: true
        });
      } catch (err) {
        if (err && err.rateLimited) throw err;
        throw new Error('StockDataa paged barcode lookup failed near row ' + (start + 1) + ': ' + String(err && (err.message || err) || 'Google Sheets query error'));
      }
    };
    const processPage = (table, start) => {
      const pageRows = table.rows || [];
      const rows = stockRows(table, schema);
      const fingerprint = rows.map((row) => idKey(row.stockRowId) || (idKey(row.tagId) + '|' + idKey(row.barcode))).join(',');
      if (pageRows.length && fingerprint && fingerprint === previousPageFingerprint) {
        throw new Error('StockDataa paging ne same page repeat kiya; lookup ko rok diya gaya.');
      }
      if (pageRows.length) previousPageFingerprint = fingerprint;
      for (const row of rows) {
        if (row.barcode && compareBarcode(row.barcode, from) >= 0 && compareBarcode(row.barcode, to) <= 0) {
          matched.set(idKey(row.tagId) + '|' + idKey(row.barcode), row);
        }
      }
      return pageRows.length;
    };
    const firstCount = processPage(await fetchPage(0), 0);
    offset = firstCount < PAGE_SIZE ? firstCount : PAGE_SIZE;
    finished = firstCount === 0;
    while (offset < HARD_CAP && !finished && matched.size <= MAX_RESULTS) {
      const starts = Array.from({ length: PARALLEL_PAGES }, (_, i) => offset + PAGE_SIZE * i).filter((start) => start < HARD_CAP);
      const pages = await Promise.all(starts.map((start) => fetchPage(start)));
      let advanceTo = offset;
      for (let i = 0; i < pages.length; i++) {
        const count = processPage(pages[i], starts[i]);
        if (!count) { finished = true; break; }
        advanceTo = starts[i] + PAGE_SIZE;
        if (matched.size > MAX_RESULTS) break;
        if (count < PAGE_SIZE) { advanceTo = starts[i] + count; break; }
      }
      if (advanceTo <= offset && !finished) throw new Error('StockDataa range scan offset aage nahi badha.');
      offset = advanceTo;
    }
    if (offset >= HARD_CAP && matched.size === 0) {
      throw new Error('StockDataa mein 250,000 rows scan ho chuki hain. Barcode range / source verify karein.');
    }
    const result = [...matched.values()];
    // Cache only complete scans; never cache a partially scanned range as complete.
    if (finished && matched.size <= MAX_RESULTS) return rememberRange(result);
    if (finished && matched.size <= MAX_RESULTS) return rememberRange(result);
    return result;
  }
  function addResult(item, stock, matchedBy) {
    const row = Object.assign({ id: nextId++, source: item.source || 'Manual', request: item.type === 'range' ? item.first + ' – ' + item.last : (item.tagId || item.barcode || item.serialNo || ''),
      agentId: clean(item.agentId), sheetRow: item.sheetRow, stock: stock || {}, matchedBy: matchedBy || '', selected: true, mapped: false, apiStatus: '', message: '',
      status: stock ? 'Ready to review' : 'Not found in StockDataa' }, stock || {});
    row.stock = stock || {}; row.agentId = clean(item.agentId);
    row.mapped = false; row.apiStatus = ''; row.message = '';
    row.status = !stock ? 'Not found in StockDataa' : (!row.tagId ? 'Missing tag ID' : (!row.serialNo ? 'Missing serial number / barcode' : (!row.vcType ? 'Missing VC type' : (!row.agentId ? 'Missing agent ID' : 'Ready to map'))));
    state.rows.push(row); return row;
  }
  function setStatus(message, kind) { const el = U.$('#fm-message', state.root); if (el) { el.className = 'notice ' + (kind || 'info'); el.textContent = message; } syncSteps(); }
  // 🧭 v3.79 — 4-step header (Add tags → Lookup → Review → Map): which step is next + live counts.
  function syncSteps() {
    try {
      const root = state.root;
      if (!root || typeof root.querySelectorAll !== 'function') return;
      const steps = root.querySelectorAll('[data-fm-step]');
      if (!steps || !steps.length) return;
      const queued = state.items.length, rows = state.rows.length;
      let ready = 0, done = 0, review = 0;
      for (const r of state.rows) { if (r.mapped) done++; else if (rowReady(r)) ready++; else if (!String(r.status || '').startsWith('Duplicate')) review++; }
      const phase = prog && prog.phase && !prog.endedAt ? prog.phase : '';
      let active = 1;
      if (state.busy) active = phase === 'map' ? 4 : 2;
      else if (queued) active = 2;
      else if (rows && ready) active = 4;
      else if (rows && done && !ready) active = 5;
      else if (rows) active = 3;
      steps.forEach((li) => {
        const n = Number(li.getAttribute('data-fm-step'));
        li.classList.toggle('done', n < active);
        li.classList.toggle('active', n === active);
      });
      const note = (n, text) => { const el = root.querySelector('#fm-step-' + n + '-note'); if (el) el.textContent = text; };
      note(1, queued ? U.fmt(queued) + ' in queue' : (rows ? 'Add more anytime' : 'Queue empty'));
      note(2, state.busy && active === 2 ? 'Looking up…' : (queued ? 'Click “Lookup StockDataa”' : (rows ? U.fmt(rows) + ' rows found' : 'Find tags in StockDataa')));
      note(3, rows ? (review ? U.fmt(review) + ' need review' : 'All rows look OK') : 'Check agent & class');
      note(4, state.busy && active === 4 ? 'Mapping…' : (done ? U.fmt(done) + ' mapped' + (ready ? ' · ' + U.fmt(ready) + ' ready' : '') : (ready ? U.fmt(ready) + ' ready to map' : 'Send to mapping API')));
      const qc = root.querySelector('#fm-queue-count');
      if (qc) { qc.className = 'badge ' + (queued ? 'amber' : 'gray'); qc.textContent = queued ? U.fmt(queued) + ' in queue' : 'Queue empty'; }
      const lookBtn = root.querySelector('#fm-lookup');
      if (lookBtn && lookBtn.classList) lookBtn.classList.toggle('primary', active === 2);
    } catch (_) { /* header is cosmetic — never block mapping */ }
  }
  const FM_TAB_KEY = 'ff_fm_tab';
  function showTab(name, remember) {
    const root = state.root;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const panes = root.querySelectorAll('[data-fm-pane]');
    if (!panes || !panes.length) return;
    const valid = ['single', 'range', 'file', 'sheet'];
    const tab = valid.includes(name) ? name : 'single';
    panes.forEach((p) => { p.hidden = p.getAttribute('data-fm-pane') !== tab; });
    root.querySelectorAll('[data-fm-tab]').forEach((b) => {
      const on = b.getAttribute('data-fm-tab') === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (remember) { try { localStorage.setItem(FM_TAB_KEY, tab); } catch (_) { /* private mode */ } }
  }
  // ── 🗂️ StockDataa index status (server side) — "sheet load nahi ho rahi" ki jagah live sthiti ────
  function renderIndexChip() {
    const chip = state.root ? U.$('#fm-index-status', state.root) : null;
    if (!chip) return;
    const ix = state.index || {};
    const build = ix.build || {};
    const rows = Number(ix.rows) || Number(build.rows) || 0;
    let text = '', cls = 'badge gray';
    if (state.rateLimited) {
      cls = 'badge amber';
      text = '⏳ Google rate limit' + (ix.cooldownSec ? ' · ' + ix.cooldownSec + 's' : '') + (rows ? ' · index ' + num(rows) + ' rows' : '');
    } else if (ix.building || (build.pages && !ix.ready)) {
      cls = 'badge amber';
      text = '⏳ StockDataa index ban raha hai… ' + num(build.rows || rows) + ' rows' + (build.pages ? ' · ' + num(build.pages) + ' pages' : '');
    } else if (ix.ready) {
      cls = 'badge green';
      text = '✅ StockDataa index ready · ' + num(rows) + ' rows' + (ix.ageSec != null ? ' · ' + fmtDur(ix.ageSec) + ' purana' : '');
    } else if (ix.error) {
      cls = 'badge amber';
      text = '⚠️ StockDataa index: ' + String(ix.error).slice(0, 90);
    } else {
      text = 'StockDataa index status…';
    }
    chip.className = cls;
    chip.textContent = text;
  }
  async function refreshIndexStatus(fresh) {
    if (typeof fetch !== 'function') return null;
    try {
      const res = await fetch(API_INDEX_STATUS + (fresh ? '?fresh=1' : ''), { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'FF-Dashboard' } });
      if (!res || !res.ok) return null;
      const json = await res.json().catch(() => null);
      if (!json || json.ok === false) return null;
      state.index = json; state.indexAt = Date.now(); state.rateLimited = !!json.rateLimited;
      renderIndexChip();
      if (json.rateLimited && prog.phase && !prog.endedAt) progressSet({ rateSec: Number(json.cooldownSec) || 0 });
      else if (prog.rateSec) progressSet({ rateSec: 0 });
      return json;
    } catch (_) { return null; }
  }
  function stopIndexWatch() {
    if (progTimers.index && typeof clearInterval === 'function') clearInterval(progTimers.index);
    progTimers.index = null;
  }
  /** Jab tak index ready na ho (ya kaam chal raha ho) har 2.5 s, warna 20 s me ek nazar. */
  function startIndexWatch() {
    stopIndexWatch();
    refreshIndexStatus(false);
    if (!canInterval()) return;
    progTimers.index = setInterval(() => {
      // Page badal gaya / render hone se pehle nikal gaya → poll band (server par bina kaam requests nahi).
      if (state.root && typeof state.root.isConnected === 'boolean' && !state.root.isConnected) { stopIndexWatch(); return; }
      const ix = state.index || {};
      const building = ix.building || !ix.ready;
      if (!building && !state.busy && Date.now() - state.indexAt > 20000) return;
      refreshIndexStatus(false);
    }, INDEX_POLL_MS);
  }
  const rowReady = (r) => r.stock && r.tagId && r.serialNo && r.vcType && r.agentId && !String(r.status || '').startsWith('Duplicate') && !r.mapped;
  function renderTable() {
    const host = U.$('#fm-results', state.root), summary = U.$('#fm-summary', state.root);
    if (!host || !summary) return;
    let ready = 0, done = 0;
    for (const r of state.rows) { if (r.mapped) done++; else if (rowReady(r)) ready++; }
    summary.innerHTML = '<div class="grid g-4"><div class="card"><div class="card-body"><small>Rows</small><h2>' + U.fmt(state.rows.length) + '</h2></div></div><div class="card"><div class="card-body"><small>Ready to map</small><h2>' + U.fmt(ready) + '</h2></div></div><div class="card"><div class="card-body"><small>Mapped successfully</small><h2>' + U.fmt(done) + '</h2></div></div><div class="card"><div class="card-body"><small>Needs review</small><h2>' + U.fmt(state.rows.length - ready - done) + '</h2></div></div></div>' + reportHtml();
    if (!state.rows.length) { host.innerHTML = '<div class="empty-state">Add tags in step 1, then click “Lookup StockDataa”.</div>'; syncSteps(); return; }
    const limit = Math.max(SHOW_STEP, state.showLimit || SHOW_STEP), shown = state.rows.slice(0, limit);
    const body = shown.map((r, i) => {
      const disabled = !r.stock || !r.tagId || !r.serialNo || !r.vcType || !r.agentId || String(r.status || '').startsWith('Duplicate') || r.mapped;
      return '<tr><td><input type="checkbox" data-fm-select="' + i + '"' + (r.selected ? ' checked' : '') + (disabled ? ' disabled' : '') + '></td><td>' + esc(r.sheetRow ? r.sheetRow : '') + '</td><td>' + esc(dashBar(r.barcode)) + '</td><td>' + esc(r.tagId) + '</td><td>' + esc(r.serialNo) + '</td><td>' + esc(r.vcType) + '</td><td>' + esc(r.stockAgentId) + '</td><td><input class="input fm-agent-edit" data-fm-agent="' + i + '" value="' + esc(r.agentId) + '" placeholder="Agent ID"' + (r.mapped ? ' disabled' : '') + '></td><td>' + esc(r.stockAgentName) + '</td><td>' + esc(r.tlName) + '</td><td><span class="badge ' + (r.mapped ? 'green' : (disabled ? 'amber' : 'gray')) + '">' + esc(r.apiStatus || r.status) + '</span><small class="dim fm-status-msg">' + esc(r.message) + '</small></td><td><button class="btn small" data-fm-remove="' + i + '"' + (state.busy ? ' disabled' : '') + '>Remove</button></td></tr>';
    }).join('');
    const more = state.rows.length > limit ? '<div class="btn-row" style="margin-top:8px"><span class="dim small">Pehli ' + U.fmt(limit) + ' / ' + U.fmt(state.rows.length) + ' rows dikh rahi hain (mapping + CSV me sab rows shamil hain).</span><button class="btn small" id="fm-more">Aur dikhao</button></div>' : '';
    host.innerHTML = '<div class="table-wrap"><table class="tbl compact"><thead><tr><th><input type="checkbox" id="fm-select-all" aria-label="Select ready rows"></th><th>Sheet row</th><th>Barcode</th><th>Tag ID</th><th>Serial No</th><th>VC Type</th><th>Stock Agent ID</th><th>Agent ID to map</th><th>Agent name</th><th>TL</th><th>Mapping status</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>' + more;
    syncSteps();
  }

  // ===== 📊 Mapping report (v3.80) — agent × class counts, not-found list, cannot-map sheet =====
  const isDupSkipped = (r) => String(r.status || '').startsWith('Duplicate skipped');
  const isNotFound = (r) => r.status === 'Not found in StockDataa' || !r.stock || !Object.keys(r.stock).length;
  /** 16-digit barcode ko sheet jaisa dikhao: 608116-011-0558293 (sirf display — lookup / API / CSV me raw digits). */
  function dashBar(v) { const t = String(v == null ? '' : v).trim(); return /^\d{16}$/.test(t) ? t.slice(0, 6) + '-' + t.slice(6, 9) + '-' + t.slice(9) : t; }
  const rowAgent = (r) => clean(r.agentId) || '(Agent ID missing)';
  function reportModel() {
    const rows = state.rows.filter((r) => !isDupSkipped(r));
    const classes = new Set();
    const byAgent = new Map();
    const agentOf = (id) => { if (!byAgent.has(id)) byAgent.set(id, { agentId: id, name: '', tl: '', cls: new Map(), found: 0, notFound: 0, mapped: 0, blocked: 0 }); return byAgent.get(id); };
    const notFound = [], cannotMap = [];
    rows.forEach((r) => {
      const a = agentOf(rowAgent(r));
      if (isNotFound(r)) {
        a.notFound++; notFound.push(r);
      } else {
        a.found++;
        const c = clean(r.vcType) || '(no class)'; classes.add(c); a.cls.set(c, (a.cls.get(c) || 0) + 1);
        if (!a.name && r.stockAgentName) a.name = r.stockAgentName;
        if (!a.tl && r.tlName) a.tl = r.tlName;
        if (r.mapped) a.mapped++;
      }
      if (!r.mapped && (!rowReady(r) || r.apiStatus)) { a.blocked++; cannotMap.push(r); }
    });
    const classList = [...classes].sort();
    const agents = [...byAgent.values()].sort((x, y) => (y.found + y.notFound) - (x.found + x.notFound) || x.agentId.localeCompare(y.agentId));
    return { rows, classList, agents, notFound, cannotMap };
  }
  const reasonOf = (r) => clean(r.apiStatus && !r.mapped ? (r.apiStatus + (r.message ? ' — ' + r.message : '')) : (r.status + (r.message ? ' — ' + r.message : '')));
  function reportHtml() {
    if (!state.rows.length) return '';
    const m = reportModel();
    const th = m.classList.map((c) => '<th class="num">' + esc(c) + '</th>').join('');
    const tot = { found: 0, notFound: 0, cls: new Map() };
    const body = m.agents.map((a) => {
      tot.found += a.found; tot.notFound += a.notFound;
      return '<tr><td><b>' + esc(a.agentId) + '</b></td><td>' + esc(a.name) + '</td><td>' + esc(a.tl) + '</td>' + m.classList.map((c) => { const n = a.cls.get(c) || 0; tot.cls.set(c, (tot.cls.get(c) || 0) + n); return '<td class="num">' + (n ? num(n) : '–') + '</td>'; }).join('') + '<td class="num"><b>' + num(a.found) + '</b></td><td class="num">' + (a.notFound ? '<span class="badge red">' + num(a.notFound) + '</span>' : '–') + '</td><td class="num">' + num(a.mapped) + '</td></tr>';
    }).join('');
    const foot = '<tr class="fm-rep-total"><td colspan="3"><b>TOTAL</b></td>' + m.classList.map((c) => '<td class="num"><b>' + num(tot.cls.get(c) || 0) + '</b></td>').join('') + '<td class="num"><b>' + num(tot.found) + '</b></td><td class="num"><b>' + num(tot.notFound) + '</b></td><td class="num"><b>' + num(m.agents.reduce((n, a) => n + a.mapped, 0)) + '</b></td></tr>';
    const nfRows = m.notFound.slice(0, 300).map((r) => '<tr><td>' + esc(dashBar(r.request || r.barcode || r.tagId)) + '</td><td><b>' + esc(rowAgent(r)) + '</b></td><td>' + esc(r.sheetRow || '') + '</td></tr>').join('');
    const cmRows = m.cannotMap.slice(0, 300).map((r) => '<tr><td>' + esc(dashBar(r.barcode || r.request)) + '</td><td>' + esc(r.tagId) + '</td><td>' + esc(r.vcType) + '</td><td><b>' + esc(rowAgent(r)) + '</b></td><td>' + esc(r.sheetRow || '') + '</td><td>' + esc(reasonOf(r)) + '</td></tr>').join('');
    return '<section class="card fm-report" id="fm-report"><div class="card-head"><div><h3>📊 Mapping report</h3><p class="dim small">Agent ID ke hisaab se class-wise barcode count · jo nahi mile unki list · jo map nahi ho sakte unki alag sheet.</p></div><div class="head-actions"><button class="btn small primary" id="fm-report-xlsx" type="button">⬇ Report Excel (3 sheets)</button><button class="btn small" id="fm-report-csv" type="button">⬇ Cannot-map CSV</button></div></div><div class="card-body">' +
      '<div class="fm-rep-grid"><div class="fm-rep-main"><h4>Agent × Class</h4><div class="table-wrap"><table class="tbl compact fm-rep-tbl"><thead><tr><th>Agent ID</th><th>Agent</th><th>TL</th>' + th + '<th class="num">Total found</th><th class="num">Not found</th><th class="num">Mapped</th></tr></thead><tbody>' + body + foot + '</tbody></table></div></div>' +
      '<div class="fm-rep-side"><h4>❌ Nahi mile <span class="badge ' + (m.notFound.length ? 'red' : 'green') + '">' + num(m.notFound.length) + '</span></h4>' + (m.notFound.length ? '<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Barcode / Tag</th><th>Agent ID</th><th>Sheet row</th></tr></thead><tbody>' + nfRows + '</tbody></table></div>' + (m.notFound.length > 300 ? '<small class="dim">Pehli 300 dikh rahi hain — Excel me sab hain.</small>' : '') : '<p class="dim small">Sab barcode StockDataa me mile ✅</p>') + '</div></div>' +
      '<h4 style="margin-top:14px">🚫 Mapping nahi ho sakti <span class="badge ' + (m.cannotMap.length ? 'amber' : 'green') + '">' + num(m.cannotMap.length) + '</span></h4>' + (m.cannotMap.length ? '<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Barcode</th><th>Tag ID</th><th>Class</th><th>Agent ID</th><th>Sheet row</th><th>Reason</th></tr></thead><tbody>' + cmRows + '</tbody></table></div>' + (m.cannotMap.length > 300 ? '<small class="dim">Pehli 300 dikh rahi hain — Excel me sab hain.</small>' : '') : '<p class="dim small">Koi row blocked nahi ✅</p>') +
      '</div></section>';
  }
  function reportSheets() {
    const m = reportModel();
    const sumHeader = ['Agent ID', 'Agent', 'TL'].concat(m.classList, ['Total found', 'Not found', 'Mapped']);
    const sumRows = m.agents.map((a) => [a.agentId, a.name, a.tl].concat(m.classList.map((c) => a.cls.get(c) || 0), [a.found, a.notFound, a.mapped]));
    sumRows.push(['TOTAL', '', ''].concat(m.classList.map((c) => m.agents.reduce((n, a) => n + (a.cls.get(c) || 0), 0)), [m.agents.reduce((n, a) => n + a.found, 0), m.agents.reduce((n, a) => n + a.notFound, 0), m.agents.reduce((n, a) => n + a.mapped, 0)]));
    const nfHeader = ['Barcode / Tag ID', 'Agent ID', 'Sheet row', 'Source', 'Reason'];
    const nfRows = m.notFound.map((r) => [r.request || r.barcode || r.tagId || '', rowAgent(r), r.sheetRow || '', r.source || '', reasonOf(r)]);
    const cmHeader = ['Sheet row', 'Request', 'Barcode', 'Tag ID', 'Serial No', 'VC Type', 'Tag Type', 'Stock Agent ID', 'Agent ID to map', 'Agent Name', 'TL', 'Inventory', 'Barcode Allocated At', 'Agent Allocated At', 'Matched By', 'Reason'];
    const cmRows = m.cannotMap.map((r) => [r.sheetRow || '', r.request || '', r.barcode || '', r.tagId || '', r.serialNo || '', r.vcType || '', r.tagType || '', r.stockAgentId || '', r.agentId || '', r.stockAgentName || '', r.tlName || '', r.inventoryName || '', r.barcodeAllocatedAt || '', r.agentAllocatedAt || '', r.matchedBy || '', reasonOf(r)]);
    return { summary: { name: 'Agent x Class', header: sumHeader, rows: sumRows }, notFound: { name: 'Not Found', header: nfHeader, rows: nfRows }, cannot: { name: 'Cannot Map', header: cmHeader, rows: cmRows } };
  }
  function reportDownload(kind) {
    if (!state.rows.length) { setStatus('Pehle lookup chalao — tabhi report banegi.', 'warn'); return; }
    const sh = reportSheets();
    if (kind === 'csv') { saveCsvFile('fastag-cannot-map-' + U.stamp() + '.csv', sh.cannot.header, sh.cannot.rows); return; }
    if (FF.xlsx && FF.xlsx.download) { FF.xlsx.download('fastag-mapping-report-' + U.stamp() + '.xlsx', [sh.summary, sh.notFound, sh.cannot]); return; }
    saveCsvFile('fastag-cannot-map-' + U.stamp() + '.csv', sh.cannot.header, sh.cannot.rows);
  }
  function checkDuplicates() {
    const byTag = new Map();
    state.rows.forEach((r) => { if (!r.tagId) return; const k = r.tagId.toUpperCase(); if (!byTag.has(k)) byTag.set(k, []); byTag.get(k).push(r); });
    byTag.forEach((rows) => {
      const targets = new Set(rows.map((r) => clean(r.agentId).toUpperCase()).filter(Boolean));
      if (rows.length > 1 && targets.size > 1) rows.forEach((r) => { r.status = 'Duplicate conflict — same Tag ID has different Agent IDs'; r.selected = false; });
      else if (rows.length > 1) rows.slice(1).forEach((r) => { r.status = 'Duplicate skipped — already listed'; r.selected = false; });
    });
  }
  /** v3.71 — lookup server par: StockDataa ka cached index (ms me). Purane server (404) par legacy path. */
  async function serverLookup(waiting, fresh) {
    const legacy = (msg) => Object.assign(new Error(msg), { legacy: true });
    if (typeof fetch !== 'function') throw legacy('fetch unavailable');
    const res = await fetch(API_LOOKUP, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FF-Dashboard' },
      body: JSON.stringify({ fresh: !!fresh, items: waiting.map((x) => ({ type: x.type, barcode: x.barcode || x.serialNo || '', tagId: x.tagId || '', first: x.first || '', last: x.last || '' })) }) });
    if (!res || res.status === undefined || res.status === 404 || res.status === 405) throw legacy('server lookup API missing');
    let json = {}; try { json = await res.json(); } catch (_) {}
    if (res.status === 429 || json.rateLimited) throw rateLimitError();
    if (!res.ok || !Array.isArray(json.results)) throw new Error(json.error || ('Lookup API HTTP ' + res.status));
    return json;
  }
  /** v3.72 — server lookup chhote chunks me: screen par live count badhta rehta hai aur ek chunk
   *  fail hone par baaki kaam bhi nahi girta (index warm hone par retry turant hota hai). */
  async function serverLookupChunks(waiting, fresh, onTick) {
    const chunks = [];
    for (let i = 0; i < waiting.length; i += LOOKUP_CHUNK) chunks.push({ start: i, items: waiting.slice(i, i + LOOKUP_CHUNK) });
    const results = new Array(waiting.length);
    let done = 0, cursor = 0, firstError = null, legacyErr = null, meta = null;
    const workers = Array.from({ length: Math.max(1, Math.min(LOOKUP_PARALLEL, chunks.length)) }, async () => {
      while (cursor < chunks.length) {
        const chunk = chunks[cursor++];
        try {
          const out = await serverLookup(chunk.items, fresh);
          meta = meta || out.meta || null;
          (out.results || []).forEach((r, j) => {
            const at = chunk.start + (r && r.index != null ? Number(r.index) : j);
            if (at >= 0 && at < results.length) results[at] = r;
          });
        } catch (err) {
          if (err && err.legacy) { legacyErr = err; return; }
          if (!firstError) firstError = err;
          chunk.items.forEach((_, j) => { results[chunk.start + j] = { index: chunk.start + j, rows: [] }; });
        }
        done += chunk.items.length;
        if (onTick) onTick(Math.min(done, waiting.length));
      }
    });
    await Promise.all(workers);
    if (legacyErr) throw legacyErr;
    if (firstError) throw firstError;
    return { results, meta };
  }
  const requestLabel = (item) => item.type === 'range' ? item.first + ' – ' + item.last : (item.tagId || item.barcode || item.serialNo || '');
  async function lookup() {
    if (state.busy) return false;
    // Typed quick inputs ko Lookup click par khud queue me le lo — naye user sirf barcode +
    // Agent ID daal kar "🔎 Lookup StockDataa" dabata hai aur "Add to queue" bhool jaata hai.
    // Add-to-queue / Quick map already fields clear kar dete hai, isliye yahan kabhi duplicate nahi hoga.
    const typedValue = clean(U.$('#fm-identifier', state.root).value);
    const typedAgent = clean(U.$('#fm-agent-id', state.root).value);
    const typedFirst = clean(U.$('#fm-first', state.root).value);
    const typedLast = clean(U.$('#fm-last', state.root).value);
    const typedRangeAgent = clean(U.$('#fm-range-agent', state.root).value);
    if (typedValue && typedAgent) {
      const kind = U.$('#fm-kind', state.root).value === 'tagId' ? 'tagId' : 'barcode';
      state.items.push({ id: nextId++, type: kind, barcode: kind === 'barcode' ? typedValue : '', serialNo: kind === 'barcode' ? typedValue : '', tagId: kind === 'tagId' ? typedValue : '', agentId: typedAgent, source: 'Manual', selected: true });
      U.$('#fm-identifier', state.root).value = '';
    }
    if (typedFirst && typedLast && typedRangeAgent) {
      if (compareBarcode(typedFirst, typedLast) > 0) { setStatus('First barcode, last barcode se bada nahi ho sakta.', 'warn'); return false; }
      state.items.push({ id: nextId++, type: 'range', first: typedFirst, last: typedLast, agentId: typedRangeAgent, source: 'Manual range', selected: true });
      U.$('#fm-first', state.root).value = ''; U.$('#fm-last', state.root).value = '';
    }
    if (!state.items.length) {
      if (typedFirst || typedLast || typedRangeAgent) { setStatus('Barcode range ke liye First barcode, Last barcode aur target Agent ID teeno required hain.', 'warn'); return false; }
      if (typedValue || typedAgent) { setStatus('Barcode/Tag ID aur target Agent ID dono required hain.', 'warn'); return false; }
      setStatus('Pehle file upload karein ya barcode / Tag ID add karein.', 'warn'); return false;
    }
    const waiting = state.items.splice(0);
    if (waiting.length > MAX_INPUTS) { state.items.unshift.apply(state.items, waiting); setStatus('Ek baar me maximum ' + MAX_INPUTS + ' input selectors allowed hain.', 'warn'); return false; }
    state.busy = true; setStatus('StockDataa se matching details lookup ho rahi hain…', 'info');
    progressStart('lookup', '🔎 StockDataa lookup', waiting.length, 'Server ke StockDataa index se exact match dhoondha ja raha hai…');
    const rowsBefore = state.rows.length;
    const old = U.$('#fm-lookup', state.root), mapBtn = U.$('#fm-map', state.root); if (old) old.disabled = true; if (mapBtn) mapBtn.disabled = true;
    try {
      let srv = null;
      try {
        srv = await serverLookupChunks(waiting, false, (doneCount) => progressSet({
          done: doneCount,
          detail: 'StockDataa index lookup: ' + doneCount + ' / ' + waiting.length + ' identifiers check ho gaye'
        }));
      } catch (err) { if (!err.legacy) throw err; }
      if (srv) {
        waiting.forEach((item, i) => {
          const r = srv.results[i] || { rows: [] };
          if (r.error) item._lookupError = r.error; else item._srvRows = r.rows || [];
        });
      } else {
        progressSet({ detail: 'Server index available nahi — client fallback scan chal raha hai (thodi der lag sakti hai)…' });
      }
      const barcodes = srv ? [] : waiting.flatMap((x) => x.type === 'range' ? [] : [x.barcode || x.serialNo].filter(Boolean));
      const tagIds = srv ? [] : waiting.flatMap((x) => x.tagId ? [x.tagId] : []);
      // serialNo is a payload field, not a separate StockDataa lookup column: it is BARCODE.
      // Query each physical StockDataa column only once to reduce Google Sheets request time.
      let lookupTicks = 0;
      const tick = (n) => {
        lookupTicks += Math.max(0, Number(n) || 0);
        progressSet({ done: Math.min(waiting.length, lookupTicks), detail: 'Client fallback scan: ' + num(lookupTicks) + ' / ' + num(waiting.length) + ' identifiers' });
      };
      const found = await Promise.all([
        queryField('barcode', barcodes, tick),
        queryField('tagId', tagIds, tick)
      ]);
      const byBarcode = found[0], byTag = found[1];
      const ranges = srv ? [] : waiting.filter((x) => x.type === 'range');
      let rangeCursor = 0;
      const rangeWorkers = Array.from({ length: Math.min(3, ranges.length) }, async () => {
        while (rangeCursor < ranges.length) {
          const item = ranges[rangeCursor++];
          try { item._rangeRows = await queryRange(item.first, item.last); }
          catch (err) { item._lookupError = err.message || String(err); if (err && err.rateLimited) { ranges.length = 0; } }
          tick(1);
        }
      });
      await Promise.all(rangeWorkers);
      for (const item of waiting) {
        if (item._lookupError) { state.rows.push({ id: nextId++, source: item.source, request: requestLabel(item), selected: false, status: 'Lookup error', message: item._lookupError, stock: {}, agentId: '', sheetRow: item.sheetRow }); continue; }
        let candidates = [];
        if (item._srvRows) candidates = item._srvRows;
        else if (item.type === 'range') {
          if (compareBarcode(item.first, item.last) > 0) { state.rows.push({ id: nextId++, source: item.source, request: item.first + ' – ' + item.last, selected: false, status: 'Invalid barcode range', message: 'First barcode last se bada hai.', stock: {}, agentId: '', sheetRow: item.sheetRow }); continue; }
          candidates = (item._rangeRows || []).filter((r) => compareBarcode(r.barcode, item.first) >= 0 && compareBarcode(r.barcode, item.last) <= 0);
        } else {
          const tagMatches = item.tagId ? byTag.filter((r) => idKey(r.tagId) === idKey(item.tagId)) : [];
          const barcodeKey = item.barcode || item.serialNo || '';
          const valueMatches = barcodeKey
            ? byBarcode.filter((r) => idKey(r.barcode) === idKey(barcodeKey) || idKey(r.serialNo) === idKey(barcodeKey))
            : [];
          const dedup = new Map();
          (tagMatches.length ? tagMatches : valueMatches).forEach((r) => dedup.set(idKey(r.tagId) + '|' + idKey(r.barcode) + '|' + idKey(r.serialNo), r));
          candidates = [...dedup.values()];
          // When both are given, prefer exact identifier pair only if it matches a real StockDataa row.
          if (tagMatches.length && barcodeKey) {
            // Both identifiers supplied means they must point to the same StockDataa row.
            candidates = candidates.filter((r) => idKey(r.barcode) === idKey(barcodeKey) || idKey(r.serialNo) === idKey(barcodeKey));
          }
        }
        if (!candidates.length) { addResult(item, null, item.type); continue; }
        if (state.rows.length + candidates.length > MAX_RESULTS) { state.rows.push({ id: nextId++, source: item.source, request: item.type === 'range' ? item.first + ' – ' + item.last : (item.tagId || item.barcode || ''), selected: false, status: 'Result limit reached', message: 'Ek lookup me maximum ' + MAX_RESULTS + ' matched tags. Range ko chhote parts me divide karein.', stock: {}, agentId: '', sheetRow: item.sheetRow }); continue; }
        for (const stock of candidates) addResult(item, stock, item.type === 'range' ? 'Barcode range' : (item.tagId ? 'Tag ID' : 'Barcode'));
      }
      checkDuplicates(); renderTable();
      const good = state.rows.filter((r) => r.stock && r.tagId && r.serialNo && r.vcType && r.agentId && !r.status.startsWith('Duplicate') && !r.mapped).length;
      const notFound = state.rows.slice(rowsBefore).filter((r) => r.status === 'Not found in StockDataa').length;
      progressSet({ done: waiting.length, total: waiting.length, ok: state.rows.slice(rowsBefore).filter((r) => r.stock && r.tagId).length, failed: notFound + state.rows.slice(rowsBefore).filter((r) => r.status === 'Lookup error').length });
      progressEnd('Lookup complete — ' + num(good) + ' row ready to map' + (notFound ? ' · ' + num(notFound) + ' StockDataa me nahi mili' : '') + '. Ab Agent ID / VC type review karke "🚀 Map ready rows" dabayein.');
      setStatus('Lookup complete: ' + good + ' row ready. Mapping se pehle Agent ID aur VC type review karein.', good ? 'success' : 'warn');
      return true;
    } catch (err) {
      // Query fail hone par queue wapas daal do — nahi to user dubara Lookup dabaye to
      // "Pehle file upload karein" dikhega aur retry me hi inputs gayab ho jaate the.
      if (state.rows.length === rowsBefore) state.items = waiting.concat(state.items);
      progressFail((err.message || String(err)) + (state.items.length ? ' · Inputs queue me wapas aa gaye.' : ''), 'Dobara try karo', 'lookup');
      setStatus('Lookup fail: ' + (err.message || err) + (state.items.length ? ' Inputs queue me wapas aa gaye — dobara Lookup dabayein.' : ''), 'error');
      return false;
    }
    finally { state.busy = false; if (old) old.disabled = false; if (mapBtn) mapBtn.disabled = !state.configured; syncSteps(); }
  }
  async function quickMap() {
    if (state.busy) return;
    const value = clean(U.$('#fm-identifier', state.root).value).replace(/(\d)-(?=\d)/g, '$1');
    const kind = U.$('#fm-kind', state.root).value;
    const agentId = clean(U.$('#fm-agent-id', state.root).value);
    if (!value || !agentId) { setStatus('Barcode/Tag ID aur target Agent ID dono required hain.', 'warn'); return; }
    const previous = new Map(state.rows.map((r) => [r.id, r.selected]));
    const oldIds = new Set(state.rows.map((r) => r.id));
    state.items.push({ id: nextId++, type: kind, barcode: kind === 'barcode' ? value : '', tagId: kind === 'tagId' ? value : '', agentId, source: 'Quick Map', selected: true });
    U.$('#fm-identifier', state.root).value = '';
    const lookupOk = await lookup();
    // Preserve the actual query/timeout message instead of replacing it with a generic warning.
    if (lookupOk === false) {
      state.rows.forEach((r) => { if (previous.has(r.id)) r.selected = previous.get(r.id); });
      renderTable();
      return;
    }
    const added = state.rows.filter((r) => !oldIds.has(r.id));
    const ready = added.filter((r) => r.stock && r.tagId && r.serialNo && r.vcType && r.agentId && !r.status.startsWith('Duplicate'));
    if (!ready.length) {
      state.rows.forEach((r) => { if (previous.has(r.id)) r.selected = previous.get(r.id); });
      renderTable();
      const failed = added.find((r) => !r.stock || !Object.keys(r.stock || {}).length || r.status === 'Not found in StockDataa') || added[0];
      if (failed && (!failed.stock || !Object.keys(failed.stock || {}).length || failed.status === 'Not found in StockDataa')) {
        setStatus('Quick Map: ' + (kind === 'tagId' ? 'Tag ID' : 'Barcode') + ' "' + value +
          '" ka exact StockDataa match nahi mila. Fresh lookup aur fallback scan chala; value, StockDataa tab aur barcode column verify karein. Queue me input bacha hai—Lookup StockDataa se retry kar sakte hain.', 'warn');
      } else if (failed && failed.stock) {
        const missing = [];
        if (!failed.tagId) missing.push('TAG_ID (column C)');
        if (!failed.serialNo) missing.push('BARCODE / Serial No (column D)');
        if (!failed.vcType) missing.push('TAG_CLASS / VC Type (column E)');
        if (!failed.agentId) missing.push('target Agent ID');
        setStatus('StockDataa row mil gayi, par required mapping field blank/invalid hai: ' + (missing.join(', ') || failed.status) +
          '. Table me row check karein; external mapping call nahi ki gayi.', 'warn');
      } else {
        setStatus('Quick Map ko ready row nahi mili. Neeche lookup status aur row detail check karein; mapping request send nahi hui.', 'warn');
      }
      return;
    }
    state.rows.forEach((r) => { r.selected = ready.includes(r); });
    renderTable();
    await mapReady();
    state.rows.forEach((r) => { if (previous.has(r.id)) r.selected = previous.get(r.id); });
    renderTable();
  }
  async function mapReady() {
    if (!state.configured) { setStatus('Mapping API secret configured nahi hai. Render me GV_TAG_MAPPING_SECRET set karein; lookup/CSV abhi bhi use kar sakte hain.', 'warn'); return; }
    if (state.busy) return;
    const ready = state.rows.filter((r) => r.selected && r.stock && r.tagId && r.serialNo && r.vcType && r.agentId && !r.status.startsWith('Duplicate') && !r.mapped);
    if (!ready.length) { setStatus('Koi selected, complete row ready nahi hai. Pehle lookup karein aur Agent ID verify karein.', 'warn'); return; }
    if (!confirm('StockDataa se verify ki gayi ' + ready.length + ' mapping(s) external API par bhejni hain?')) return;
    state.busy = true; setStatus('Mapping API call chal rahi hai… please page band na karein.', 'info');
    progressStart('map', '🚀 Mapping API', ready.length, 'Har ' + MAP_BATCH + '-row batch ka result aate hi live counters update hote hain…');
    const mapBtn = U.$('#fm-map', state.root); if (mapBtn) mapBtn.disabled = true;
    let success = 0, failed = 0, doneCount = 0, batchesDone = 0, fatal = null;   // catch me bhi chahiye
    try {
      const batches = [];
      for (let i = 0; i < ready.length; i += MAP_BATCH) batches.push(ready.slice(i, i + MAP_BATCH));
      const totalBatches = batches.length;
      let next = 0;
      const runBatch = async (batch) => {
        const res = await fetch(API_MAP, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FF-Dashboard' }, body: JSON.stringify({ rows: batch.map((r) => ({ tagId: r.tagId, serialNo: r.serialNo, vcType: normalizeVcType(r.vcType), agentId: r.agentId })) }) });
        let json = {}; try { json = await res.json(); } catch (_) {}
        if (res.status === 429 || json.rateLimited) throw Object.assign(new Error(json.error || 'Mapping API rate limit (429).'), { rateLimited: true });
        if (!res.ok || !Array.isArray(json.results)) throw new Error(json.error || ('Mapping API HTTP ' + res.status));
        json.results.forEach((out, j) => {
          const r = batch[out.index == null ? j : out.index]; if (!r) return;
          r.apiStatus = out.status || (out.success ? 'Success' : 'Failed'); r.message = out.message || ''; r.mapped = !!out.success;
          r.retryable = !out.success && !!out.retryable;
          r.status = out.success ? 'Mapped successfully' : 'Mapping failed'; if (out.success) success++; else failed++;
        });
        doneCount += batch.length; batchesDone++;
        // 📊 Live counters — har 25-row batch ke baad screen par turant update.
        progressSet({
          done: Math.min(doneCount, ready.length), ok: success, failed,
          detail: 'Batch ' + batchesDone + ' / ' + totalBatches + ' ho gaya — last batch me ' + batch.filter((r) => r.mapped).length + ' success, ' + batch.filter((r) => !r.mapped).length + ' fail. Bheja ja raha hai: ' + Math.min(MAP_PARALLEL, totalBatches - batchesDone) + ' row-batch(es) parallel.'
        });
        setStatus('Progress ' + Math.min(doneCount, ready.length) + '/' + ready.length + ' · Success ' + success + ' · Failed ' + failed, 'info');
      };
      // MAP_PARALLEL batches ek saath (har batch me server 10 rows parallel) — pehle ek-ek karke chalte the.
      const pool = Array.from({ length: Math.min(MAP_PARALLEL, batches.length) }, async () => {
        while (next < batches.length && !fatal) {
          const batch = batches[next++];
          try { await runBatch(batch); }
          catch (err) {
            // Rate limit par poori run band nahi — rows retryable rehti hain aur neeche retry pass
            // me dobara bheji jaati hain (baaki batches chalti rehti hain).
            if (err && err.rateLimited) {
              batch.forEach((r) => {
                if (r.mapped) return;
                r.retryable = true; r.status = 'Mapping failed';
                r.apiStatus = 'Rate limited'; r.message = err.message || 'Mapping API rate limit';
              });
              doneCount += batch.length; batchesDone++;
              failed += batch.filter((r) => !r.mapped).length;
              progressSet({ done: Math.min(doneCount, ready.length), failed, detail: '⚠️ Mapping API ne rate limit kiya — ye ' + batch.length + ' rows retry pass me dobara bheji jaayengi.' });
              setStatus('Progress ' + Math.min(doneCount, ready.length) + '/' + ready.length + ' · Success ' + success + ' · Failed ' + failed, 'info');
              await new Promise((r2) => setTimeout(r2, 700));
              continue;
            }
            fatal = err;
          }
        }
      });
      await Promise.all(pool);
      if (fatal) throw fatal;
      // 🔁 Retry pass: sirf woh rows jo rate limit / network / 5xx ki wajah se fail hui (mapped rows chhoote nahi).
      const retryRows = ready.filter((r) => !r.mapped && r.retryable);
      if (retryRows.length) {
        progressSet({ detail: '🔁 Retry pass: ' + num(retryRows.length) + ' row dobara bheji jaa rahi hain…' });
        const retryBatches = [];
        for (let i = 0; i < retryRows.length; i += MAP_BATCH) retryBatches.push(retryRows.slice(i, i + MAP_BATCH));
        let retryNext = 0;
        const retryPool = Array.from({ length: Math.min(2, retryBatches.length) }, async () => {
          while (retryNext < retryBatches.length) {
            const batch = retryBatches[retryNext++];
            const res = await fetch(API_MAP, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FF-Dashboard' }, body: JSON.stringify({ rows: batch.map((r) => ({ tagId: r.tagId, serialNo: r.serialNo, vcType: normalizeVcType(r.vcType), agentId: r.agentId })) }) });
            let json = {}; try { json = await res.json(); } catch (_) {}
            if (!res.ok || !Array.isArray(json.results)) continue;
            json.results.forEach((out, j) => {
              const r = batch[out.index == null ? j : out.index]; if (!r) return;
              if (out.success && !r.mapped) { r.mapped = true; success++; failed = Math.max(0, failed - 1); }
              if (out.success) { r.apiStatus = out.status || 'Success'; r.message = out.message || ''; r.status = 'Mapped successfully'; r.retryable = false; }
            });
            progressSet({ ok: success, failed, detail: '🔁 Retry pass chal raha hai… ab tak ' + num(success) + ' mapped, ' + num(failed) + ' failed.' });
          }
        });
        await Promise.all(retryPool);
      }
      let sheetNote = '';
      if (state.sheetCtx && state.sheetCtx.colDone) progressSet({ title: '📗 Sheet me "done" likha jaa raha hai', detail: 'Mapped rows ke Done column me "' + state.sheetCtx.doneText + '" likha jaa raha hai…' });
      try { const w = await markSheetDone(); if (w != null) sheetNote = ' · Sheet me "' + state.sheetCtx.doneText + '" likha: ' + w + ' row'; }
      catch (err) { sheetNote = ' · ⚠ Sheet me done nahi likha ja saka: ' + (err.message || err); }
      progressSet({ done: ready.length, ok: success, failed });
      progressEnd('✅ Mapping complete — ' + num(success) + ' mapped, ' + num(failed) + ' failed' + sheetNote + '. Full CSV download kar sakte hain.');
      setStatus('Mapping complete. Success: ' + success + ' · Failed: ' + failed + sheetNote + '. Full CSV download kar sakte hain.', (failed || /⚠/.test(sheetNote)) ? 'warn' : 'success');
    } catch (err) {
      // Jo rows map ho chuki hain unka "done" phir bhi sheet me likh do.
      try { await markSheetDone(); } catch (_) { /* original error dikhana zyada zaroori */ }
      progressFail('Mapping request fail: ' + (err.message || err) + ' · ' + num(success) + ' rows map ho chuki hain (table/CSV me dikhti hain).', 'Adhoori rows dobara try karo', 'map');
      setStatus('Mapping request fail: ' + (err.message || err) + '. Result table se CSV download kar sakte hain.', 'error');
    }
    finally { state.busy = false; if (mapBtn) mapBtn.disabled = !state.configured; renderTable(); }
  }
  // ===== 📗 Google Sheet se mapping (v3.71) =====
  const gs = (id) => { const el = U.$('#fm-gs-' + id, state.root); return el ? clean(el.value) : ''; };
  const colLetterOk = (v) => /^[A-Za-z]{1,3}$/.test(clean(v));
  function saveSheetCfg() {
    try { const cfg = {}; ['link', 'tab', 'start', 'mode', 'first', 'last', 'barcode', 'agent', 'done', 'donetext'].forEach((k) => { cfg[k] = gs(k); }); localStorage.setItem(SHEET_CFG_KEY, JSON.stringify(cfg)); } catch (_) { /* private mode */ }
  }
  function restoreSheetCfg(root) {
    try {
      const cfg = JSON.parse(localStorage.getItem(SHEET_CFG_KEY) || '{}');
      Object.keys(cfg).forEach((k) => { const el = U.$('#fm-gs-' + k, root); if (el && cfg[k] != null) el.value = cfg[k]; });
    } catch (_) { /* first time */ }
    syncSheetMode(root);
  }
  function syncSheetMode(root) {
    const mode = (U.$('#fm-gs-mode', root) || {}).value || 'range';
    const show = (id, on) => { const el = U.$('#fm-gs-' + id + '-wrap', root); if (el && el.style) el.style.display = on ? '' : 'none'; };
    show('first', mode === 'range'); show('last', mode === 'range'); show('barcode', mode !== 'range');
  }
  /** Sheet read → queue items → lookup. auto=true: ready rows turant map bhi karo (+ done likho). */
  async function sheetRun(auto) {
    if (state.busy) return;
    const link = gs('link'), tab = gs('tab'), mode = gs('mode') || 'range';
    const startRow = Math.max(1, Number(gs('start')) || 2), doneText = gs('donetext') || 'done';
    const colFirst = gs('first').toUpperCase(), colLast = gs('last').toUpperCase(), colBarcode = gs('barcode').toUpperCase(), colAgent = gs('agent').toUpperCase(), colDone = gs('done').toUpperCase();
    if (!link || !tab) { setStatus('Google Sheet ka link aur tab name dono dein.', 'warn'); return; }
    if (!colLetterOk(colAgent)) { setStatus('Agent ID column letter dein (jaise C).', 'warn'); return; }
    if (mode === 'range' && (!colLetterOk(colFirst) || !colLetterOk(colLast))) { setStatus('First barcode aur Last barcode column letters dein (jaise A aur B).', 'warn'); return; }
    if (mode !== 'range' && !colLetterOk(colBarcode)) { setStatus('Barcode / Tag ID column letter dein.', 'warn'); return; }
    if (colDone && !colLetterOk(colDone)) { setStatus('Done column letter galat hai (jaise D).', 'warn'); return; }
    saveSheetCfg();
    const columns = (mode === 'range' ? [colFirst, colLast] : [colBarcode]).concat([colAgent]).concat(colDone ? [colDone] : []);
    state.busy = true; setStatus('Google Sheet se rows padh raha hoon…', 'info');
    progressStart('sheet', '📗 Google Sheet read', 0, 'Apps Script se rows aa rahi hain (sheet: ' + tab + ')…');
    let items = [], skippedDone = 0, invalid = 0, blank = 0;
    try {
      const res = await fetch(API_SHEET_READ, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FF-Dashboard' }, body: JSON.stringify({ sheet: link, tab, startRow, columns }) });
      let json = {}; try { json = await res.json(); } catch (_) {}
      if (!res.ok || !Array.isArray(json.rows)) throw new Error(json.error || ('Sheet read HTTP ' + res.status));
      const nVal = mode === 'range' ? 2 : 1;
      json.rows.forEach((r, i) => {
        const rowNo = (json.startRow || startRow) + i, v = r.map(clean);
        const agentId = v[nVal], doneVal = colDone ? v[nVal + 1] : '';
        if (!v.slice(0, nVal + 1).some(Boolean)) { blank++; return; }
        if (doneVal && doneVal.toLowerCase() === doneText.toLowerCase()) { skippedDone++; return; }
        if (!agentId) { invalid++; return; }
        if (mode === 'range') {
          if (!v[0] || !v[1]) { invalid++; return; }
          items.push({ id: nextId++, type: 'range', first: v[0], last: v[1], agentId, source: 'Sheet row ' + rowNo, sheetRow: rowNo, selected: true });
        } else {
          if (!v[0]) { invalid++; return; }
          const isTag = mode === 'tagId';
          items.push({ id: nextId++, type: isTag ? 'tagId' : 'barcode', tagId: isTag ? v[0] : '', barcode: isTag ? '' : v[0], serialNo: isTag ? '' : v[0], agentId, source: 'Sheet row ' + rowNo, sheetRow: rowNo, selected: true });
        }
      });
    } catch (err) {
      state.busy = false;
      progressFail('Google Sheet read fail: ' + (err.message || err) + ' · Sheet shared hai? Apps Script me naya Code.gs deploy hai?', 'Sheet dobara load karo', 'sheet');
      setStatus('Google Sheet read fail: ' + (err.message || err), 'error');
      return;
    }
    state.busy = false;
    if (!items.length) {
      progressEnd('Sheet me map karne layak naya row nahi mila' + (skippedDone ? ' (' + skippedDone + ' row pehle se "' + doneText + '" hain)' : '') + (invalid ? ' · ' + invalid + ' row me barcode/Agent ID blank' : '') + '.');
      setStatus('Sheet me map karne layak naya row nahi mila' + (skippedDone ? ' (' + skippedDone + ' row pehle se "' + doneText + '" hain)' : '') + (invalid ? ' · ' + invalid + ' row me barcode/Agent ID blank' : '') + '.', 'warn');
      return;
    }
    if (items.length > MAX_INPUTS) { setStatus('Ek baar me maximum ' + MAX_INPUTS + ' sheet rows. Start row badal kar baaki alag run karein (abhi ' + items.length + ' mili).', 'warn'); return; }
    state.sheetCtx = { link, tab, colDone, doneText, marked: new Set(), auto: !!auto };
    state.items.push.apply(state.items, items);
    const note = items.length + ' sheet rows queue me' + (skippedDone ? ' · ' + skippedDone + ' pehle se done skip' : '') + (invalid ? ' · ' + invalid + ' invalid skip' : '') + '.';
    progressSet({ total: items.length, detail: note + ' StockDataa lookup chal raha hai…' });
    setStatus(note + ' StockDataa lookup chal raha hai…', 'info');
    const ok = await lookup();
    if (ok === false) return;
    if (!auto) { setStatus(note + ' Lookup complete — review karke "🚀 Map ready rows" dabayein; mapping ke baad done sheet me likh diya jayega.', 'success'); return; }
    state.rows.forEach((r) => { r.selected = !!(r.sheetRow && rowReady(r)); });
    renderTable();
    await mapReady();
  }
  /** Mapping ke baad: jis sheet row ke SAARE tags map ho gaye uske done column me "done" likho. */
  async function markSheetDone() {
    const ctx = state.sheetCtx;
    if (!ctx || !ctx.colDone) return null;
    const bySheetRow = new Map();
    for (const r of state.rows) {
      if (!r.sheetRow || String(r.status || '').startsWith('Duplicate skipped')) continue;
      const e = bySheetRow.get(r.sheetRow) || { total: 0, ok: 0 };
      e.total++; if (r.mapped) e.ok++;
      bySheetRow.set(r.sheetRow, e);
    }
    const writes = [];
    bySheetRow.forEach((e, row) => { if (e.total && e.ok === e.total && !ctx.marked.has(row)) writes.push({ row, value: ctx.doneText }); });
    if (!writes.length) return 0;
    const res = await fetch(API_SHEET_MARK, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FF-Dashboard' }, body: JSON.stringify({ sheet: ctx.link, tab: ctx.tab, column: ctx.colDone, writes }) });
    let json = {}; try { json = await res.json(); } catch (_) {}
    if (!res.ok || !json.ok) throw new Error(json.error || ('Sheet write HTTP ' + res.status));
    writes.forEach((w) => ctx.marked.add(w.row));
    return writes.length;
  }
  function downloadCsv() {
    const headers = ['Request','Source','StockDataa Row ID','Inventory Name','Barcode','Tag ID','Serial No','VC Type','Tag Type','Barcode Allocated At','Stock Agent ID','Agent ID Mapped','Agent Name','TL Name','Agent Allocated At','Matched By','Selected','API Status','Message'];
    const rows = state.rows.map((r) => [r.request || '',r.source || '',r.stockRowId || '',r.inventoryName || '',r.barcode || '',r.tagId || '',r.serialNo || '',r.vcType || '',r.tagType || '',r.barcodeAllocatedAt || '',r.stockAgentId || '',r.agentId || '',r.stockAgentName || '',r.tlName || '',r.agentAllocatedAt || '',r.matchedBy || '',r.selected ? 'YES' : 'NO',r.apiStatus || r.status || '',r.message || '']);
    if (U.downloadCsv) U.downloadCsv('fastag-mapping-' + U.stamp() + '.csv', headers, rows);
    else { const text = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'fastag-mapping-' + Date.now() + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function saveCsvFile(filename, headers, rows) {
    const text = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text + '\r\n'], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function templateCsv() {
    // Exact API payload shape. Class/Tag ID are filled from StockDataa during lookup.
    saveCsvFile('fastag-mapping-template.csv', ['tagId', 'serialNo', 'vcType', 'agentId'], []);
  }
  function barcodeTemplate(kind) {
    // Alag-alag barcode: A = barcode, B = agentId. Barcode text rehta hai (Excel me 8.9E+15 nahi banta).
    const headers = ['barcode', 'agentId'];
    if (kind === 'xlsx' && FF.xlsx && FF.xlsx.download) { FF.xlsx.download('fastag-barcode-agent-template.xlsx', [{ name: 'Barcode Agent', header: headers, rows: [] }]); return; }
    saveCsvFile('fastag-barcode-agent-template.csv', headers, []);
  }
  function rangeTemplateCsv() {
    // Input helper for bulk expansion: one row = first barcode + last barcode + target agent.
    saveCsvFile('fastag-range-template.csv', ['firstBarcode', 'lastBarcode', 'agentId'], []);
  }
  function apiCsv() {
    const rows = state.rows
      .filter((r) => r.stock && r.tagId && r.serialNo && r.vcType && r.agentId && !String(r.status || '').startsWith('Duplicate'))
      .map((r) => [r.tagId, r.serialNo, r.vcType, r.agentId]);
    saveCsvFile('fastag-mapping-api-rows-' + U.stamp() + '.csv', ['tagId', 'serialNo', 'vcType', 'agentId'], rows);
    setStatus('API CSV ready: ' + rows.length + ' valid rows · 4 columns only.', rows.length ? 'success' : 'warn');
  }
  function render(root) {
    state.root = root;
    root.innerHTML = '<div class="page-head"><div><h1>🧭 FASTag Mapping</h1><p class="sub">GV Partner · StockDataa se Tag ID, Serial/Barcode, VC Type aur Agent details fetch karke securely map karein.</p></div><div class="head-actions"><span id="fm-index-status" class="badge gray">StockDataa index status…</span><button class="btn small" id="fm-index-refresh" title="StockDataa index dobara banao (ape ke aap 5 min me refresh hota rehta hai)">🔄 Index refresh</button><span id="fm-api-status" class="badge amber">Mapping API status checking…</span></div></div>' +
      // v3.79 — 4-step flow: 1 Add tags (tabs) → 2 Lookup → 3 Review → 4 Map. All input IDs are unchanged.
      '<ol class="fm-steps" id="fm-steps" aria-label="Mapping steps">' +
        '<li class="fm-step" data-fm-step="1"><span class="fm-step-dot">1</span><span class="fm-step-tx"><b>Add tags</b><small id="fm-step-1-note">Queue empty</small></span></li>' +
        '<li class="fm-step" data-fm-step="2"><span class="fm-step-dot">2</span><span class="fm-step-tx"><b>Lookup</b><small id="fm-step-2-note">Find tags in StockDataa</small></span></li>' +
        '<li class="fm-step" data-fm-step="3"><span class="fm-step-dot">3</span><span class="fm-step-tx"><b>Review</b><small id="fm-step-3-note">Check agent &amp; class</small></span></li>' +
        '<li class="fm-step" data-fm-step="4"><span class="fm-step-dot">4</span><span class="fm-step-tx"><b>Map</b><small id="fm-step-4-note">Send to mapping API</small></span></li>' +
      '</ol>' +
      '<section class="card fm-add-card" id="fm-step-add"><div class="card-head"><div><h3><span class="fm-step-no">1</span> Add tags</h3><p class="dim small">Pick a method. You can mix methods — everything goes into one queue.</p></div><div class="card-right"><span class="badge gray" id="fm-queue-count">Queue empty</span></div></div>' +
        '<div class="fm-tabs" role="tablist">' +
          '<button type="button" class="fm-tab" role="tab" data-fm-tab="single">⌨️ Single<span class="fm-tab-long"> barcode / Tag ID</span></button>' +
          '<button type="button" class="fm-tab" role="tab" data-fm-tab="range">↔️ <span class="fm-tab-long">Barcode </span>Range</button>' +
          '<button type="button" class="fm-tab" role="tab" data-fm-tab="file">📂 File<span class="fm-tab-long"> upload</span></button>' +
          '<button type="button" class="fm-tab" role="tab" data-fm-tab="sheet">📗 <span class="fm-tab-long">Google </span>Sheet</button>' +
        '</div><div class="card-body">' +
        '<div class="fm-pane" data-fm-pane="single"><div class="grid g-3 fm-fields"><div><label>Lookup by</label><select id="fm-kind" class="input"><option value="barcode">Barcode / Serial No</option><option value="tagId">Tag ID</option></select></div><div><label>Barcode / Tag ID</label><input class="input" id="fm-identifier" placeholder="Barcode ya Tag ID enter karein"></div><div><label>Target Agent ID (required)</label><input class="input" id="fm-agent-id" placeholder="Jis Agent ID se map karna hai"></div></div><div class="btn-row"><button class="btn" id="fm-add-single">Add to queue</button><button class="btn primary" id="fm-quick-map">⚡ Quick map</button></div></div>' +
        '<div class="fm-pane" data-fm-pane="range" hidden><div class="grid g-3"><div><label>First barcode</label><input class="input" id="fm-first" placeholder="Start barcode"></div><div><label>Last barcode</label><input class="input" id="fm-last" placeholder="End barcode"></div><div><label>Target Agent ID (required)</label><input class="input" id="fm-range-agent" placeholder="Jis Agent ID se map karna hai"></div></div><button class="btn" id="fm-add-range">Add range</button></div>' +
        '<div class="fm-pane" data-fm-pane="file" hidden><div class="btn-row fm-templates"><button class="btn small" id="fm-template">⬇ 4-column API template</button><button class="btn small" id="fm-range-template">⬇ Range input template</button><button class="btn small" id="fm-bc-template-xlsx">⬇ Alag-alag barcode · Excel</button><button class="btn small" id="fm-bc-template">⬇ Alag-alag barcode · CSV</button></div><p class="dim small">API template: tagId, serialNo, vcType, agentId. Range template: firstBarcode, lastBarcode, agentId. <b>Alag-alag barcode template:</b> A column me barcode, B column me Agent ID (header: barcode, agentId) — har barcode StockDataa me dhoondh kar uske Agent ID se map hoga; header na ho tab bhi A=barcode, B=Agent ID mana jata hai. Range upload mein barcode series StockDataa se expand hogi; TAG_ID, BARCODE aur TAG_CLASS auto-fill honge.</p><input class="input" id="fm-file" type="file" accept=".csv,.tsv,.txt,.xlsx"><div id="fm-file-note" class="dim small">No file selected.</div><button class="btn primary" id="fm-upload-add">Add file rows</button></div>' +
        '<div class="fm-pane" data-fm-pane="sheet" hidden><p class="dim small">Sheet ka link, tab aur columns chuno — rows padhkar StockDataa se match hongi, map hongi, aur jo row poori map ho jaye uske <b>Done</b> column me "done" likh diya jayega. Pehle se "done" wali rows skip hoti hain.</p>' +
        '<div class="grid g-3"><div><label>Google Sheet link / ID</label><input class="input" id="fm-gs-link" placeholder="https://docs.google.com/spreadsheets/d/…"></div><div><label>Tab name</label><input class="input" id="fm-gs-tab" placeholder="Sheet1"></div><div><label>Data kis row se shuru (header ke baad)</label><input class="input" id="fm-gs-start" type="number" min="1" value="2"></div></div>' +
        '<div class="grid g-3"><div><label>Mapping type</label><select class="input" id="fm-gs-mode"><option value="range">Barcode range (First + Last)</option><option value="barcode">Alag-alag Barcode</option><option value="tagId">Alag-alag Tag ID</option></select></div>' +
        '<div id="fm-gs-first-wrap"><label>First barcode column</label><input class="input" id="fm-gs-first" maxlength="3" placeholder="A" value="A"></div><div id="fm-gs-last-wrap"><label>Last barcode column</label><input class="input" id="fm-gs-last" maxlength="3" placeholder="B" value="B"></div><div id="fm-gs-barcode-wrap" style="display:none"><label>Barcode / Tag ID column</label><input class="input" id="fm-gs-barcode" maxlength="3" placeholder="A" value="A"></div></div>' +
        '<div class="grid g-3"><div><label>Agent ID column</label><input class="input" id="fm-gs-agent" maxlength="3" placeholder="C" value="C"></div><div><label>Done likhne wala column</label><input class="input" id="fm-gs-done" maxlength="3" placeholder="D" value="D"></div><div><label>Done me kya likhna hai</label><input class="input" id="fm-gs-donetext" placeholder="done" value="done"></div></div>' +
        '<div class="btn-row"><button class="btn" id="fm-gs-load">📥 Sheet se load + lookup</button><button class="btn primary" id="fm-gs-auto">⚡ Turant map karo + done likho</button></div><p class="dim small">Pehli baar: Apps Script me naya <code>Code.gs</code> (v3.71) paste karke New version deploy karein, aur sheet ko us Google account ke saath Editor share karein jisse Apps Script chalta hai.</p></div>' +
      '</div></section>' +
      '<section class="card fm-queue-card"><div class="card-head"><div><h3><span class="fm-step-no">2–4</span> Lookup, review &amp; map</h3><p class="dim small">Lookup ke baad preview/review karein. Target Agent ID edit kar sakte hain; API call sirf selected complete rows par hoga.</p></div><div class="head-actions"><button class="btn" id="fm-lookup">🔎 Lookup StockDataa</button><button class="btn primary" id="fm-map" disabled>🚀 Map ready rows</button><button class="btn" id="fm-api-csv">⬇ API CSV · 4 columns</button><button class="btn" id="fm-csv">⬇ Full details CSV</button><button class="btn" id="fm-clear">Clear</button></div></div><div class="card-body"><div id="fm-progress" class="fm-progress" hidden></div><div id="fm-message" class="notice info">API status check ho raha hai…</div><div id="fm-summary"></div><div id="fm-results"><div class="empty-state">Add tags in step 1, then click “Lookup StockDataa”.</div></div></div></section>';
    state.items = []; state.rows = []; state.busy = false; state.sheetCtx = null; state.showLimit = SHOW_STEP;
    state.index = null; state.indexAt = 0; state.rateLimited = false;
    ensureProgressStyles();
    progressReset();   // naya render = saaf panel (purane run ka status leak na ho)
    const status = U.$('#fm-api-status', root);
    fetch(API_STATUS, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'FF-Dashboard' } }).then((r) => r.json()).then((j) => {
      state.configured = !!j.configured;
      if (status) { status.className = 'badge ' + (state.configured ? 'green' : 'amber'); status.textContent = state.configured ? 'Mapping API configured' : 'API secret missing in Render'; }
      const mapButton = U.$('#fm-map', root); if (mapButton) mapButton.disabled = !state.configured;
      if (j && j.index) { state.index = Object.assign({}, j.index, { cooldownSec: j.cooldownSec }); state.indexAt = Date.now(); state.rateLimited = !!j.rateLimited; renderIndexChip(); }
      setStatus(state.configured ? 'Ready. Upload file ya manual barcode / Tag ID add karein.' : 'API key configure nahi hai. Render environment me GV_TAG_MAPPING_SECRET set karne ke baad mapping enabled hogi; secret browser/GitHub me save nahi hota.', state.configured ? 'success' : 'warn');
    }).catch(() => { if (status) status.textContent = 'API status unavailable'; setStatus('API status verify nahi ho paya. Login/session aur server status check karein.', 'warn'); });
    // 🗂️ Index pehle se ban chuka hai ya ban raha hai — yeh live dikhta rehta hai (aur garam na ho to
    // abhi bana lo, taaki pehla lookup Google ke intezaar me na atke).
    // ⌨️ v3.78 — barcode type karte hi suggestions (Master Search ke barcode index se). Pick → barcode box me bhar jata hai,
    // aur status me agent / TL / class dikhta hai. Target Agent ID khud nahi bharta (wo naya agent hai).
    try {
      const barBox = U.$('#fm-identifier', root);
      const kindSel = U.$('#fm-kind', root);
      if (barBox && U.suggest && FF.masterSearch && FF.masterSearch.barcodeSuggest) {
        // Fallback: the Master Search index can miss a barcode that IS in StockDataa (unassigned / not yet indexed / index
        // still building). For a full-looking barcode ask the same server StockDataa index the real lookup uses (exact match).
        const srvHits = new Map(); // key → { state: 'loading'|'found'|'none'|'error', rows, at, msg }
        let srvTimer = null;
        const bcKey = (v) => String(v == null ? '' : v).replace(/[\s,\u00a0-]/g, '');
        const srvFetchOne = (k) => {
          srvHits.set(k, { state: 'loading', rows: [], at: Date.now() });
          serverLookup([{ type: 'barcode', barcode: k }], false).then((out) => {
            const rows = (out && out.results && out.results[0] && out.results[0].rows) || [];
            srvHits.set(k, { state: rows.length ? 'found' : 'none', rows, at: Date.now() });
          }).catch((err) => {
            srvHits.set(k, { state: 'error', rows: [], at: Date.now(), msg: (err && err.message) || 'Lookup failed' });
          }).then(() => { try { if (barBox.isConnected && bcKey(barBox.value) === k && sugRef) sugRef.refresh(); } catch { /* ignore */ } });
        };
        const srvFallbackItems = () => {
          const k = bcKey(barBox.value);
          if (k.length < 8) return null;
          let h = srvHits.get(k);
          if (h && h.state !== 'loading' && Date.now() - h.at > 30000) { srvHits.delete(k); h = null; }
          if (!h) {
            if (srvTimer) clearTimeout(srvTimer);
            srvTimer = setTimeout(() => { if (barBox.isConnected && bcKey(barBox.value) === k && !srvHits.has(k)) srvFetchOne(k); }, 450);
            return [{ none: true, kind: 'cls', kindLabel: 'StockDataa', label: '🔎 Checking StockDataa…', sub: 'not in the quick index — asking the server', value: barBox.value, _pending: true }];
          }
          if (h.state === 'loading') return [{ none: true, kind: 'cls', kindLabel: 'StockDataa', label: '🔎 Checking StockDataa…', sub: 'not in the quick index — asking the server', value: barBox.value, _pending: true }];
          if (h.state === 'found') {
            return h.rows.slice(0, 12).map((row) => {
              const it = { barcode: row.barcode || k, tagId: row.tagId || '', agentId: row.stockAgentId || '', agentName: row.stockAgentName || '', tlName: row.tlName || '', cls: row.vcType || '' };
              return { kind: 'barcode', kindLabel: 'Stock', label: it.barcode, sub: [it.tagId ? 'Tag ' + it.tagId : '', it.agentName ? 'Agent ' + it.agentName : 'Unassigned', it.tlName ? 'TL ' + it.tlName : '', it.cls ? 'Class ' + it.cls : ''].filter(Boolean).join(' · '), value: it.barcode, inputValue: dashBar(it.barcode), _item: it };
            });
          }
          if (h.state === 'error') return [{ none: true, kind: 'cls', kindLabel: 'StockDataa', label: '⚠️ Could not check StockDataa', sub: h.msg || 'try “Add to queue” — it runs the full lookup', value: barBox.value, _pending: true }];
          return null; // 'none' → normal "No match"
        };
        let sugRef = null;
        const sug = U.suggest(barBox, {
          min: 3, max: 12,
          items: () => {
            if (!kindSel || kindSel.value !== 'barcode') return [];
            const r = FF.masterSearch.barcodeSuggest(barBox.value, 12);
            if (!r.items.length) { const fb = srvFallbackItems(); if (fb) return fb; }
            if (r.pending) return [{ none: true, kind: 'cls', kindLabel: 'Index', label: '⏳ Barcode index is being built…', sub: 'suggestions will appear shortly', value: barBox.value, _pending: true }];
            return r.items.map((it) => ({
              kind: 'barcode', kindLabel: it.channel === 'GV' ? 'GV' : 'FF', label: dashBar(it.barcode),
              sub: [it.tagId ? 'Tag ' + it.tagId : '', (it.agentName || it.agentId) ? 'Agent ' + [it.agentName, it.agentId ? '(' + it.agentId + ')' : ''].filter(Boolean).join(' ') : (it.tlName ? 'Agent — (TL stock)' : ''), it.tlName ? 'TL ' + it.tlName : '', it.cls ? 'Class ' + it.cls : ''].filter(Boolean).join(' · ') || 'StockDataa row',
              value: it.barcode, inputValue: it.barcode, _item: it
            }));
          },
          onPick: (it) => {
            if (!it || it.none || it._pending || !it._item) return;
            barBox.value = dashBar(it._item.barcode);
            const i = it._item;
            setStatus(`Barcode ${dashBar(i.barcode)} · Tag ${i.tagId || '—'} · ${i.agentName || 'agent —'}${i.tlName ? ' (TL ' + i.tlName + ')' : ''}${i.cls ? ' · ' + i.cls : ''}. Enter the target Agent ID and click “Add to queue”.`, 'info');
            const agentBox = U.$('#fm-agent-id', root); if (agentBox) agentBox.focus();
          },
          onEnter: () => {}
        });
        sugRef = sug;
        if (sug && sug.refresh && FF.masterSearch.onIndexReady) FF.masterSearch.onIndexReady(() => { try { if (barBox.isConnected && document.activeElement === barBox) sug.refresh(); } catch { /* ignore */ } });
        if (FF.masterSearch.warmFull) { try { FF.masterSearch.warmFull(); } catch { /* ignore */ } }
      }
    } catch (err) { console.warn('fastag barcode suggest:', err && err.message); }
    startIndexWatch();
    { let saved = ''; try { saved = localStorage.getItem(FM_TAB_KEY) || ''; } catch (_) { saved = ''; } showTab(saved || 'single', false); }
    syncSteps();
    later(() => {
      const ix = state.index || {};
      if (!ix.ready && !ix.building) refreshIndexStatus(true);
    }, 1200);
    root.addEventListener('click', async (event) => {
      const target = event.target.closest('button'); if (!target) return;
      if (target.dataset && target.dataset.fmTab) { showTab(target.dataset.fmTab, true); return; }
      if (target.id === 'fm-template') return templateCsv();
      if (target.id === 'fm-range-template') return rangeTemplateCsv();
      if (target.id === 'fm-bc-template') return barcodeTemplate('csv');
      if (target.id === 'fm-bc-template-xlsx') return barcodeTemplate('xlsx');
      if (target.id === 'fm-api-csv') return apiCsv();
      if (target.id === 'fm-retry') {
        const action = prog.retryAction;
        prog.retry = ''; prog.retryAction = '';
        renderProgress();
        if (action === 'sheet') return sheetRun(false);
        if (action === 'map') return mapReady();
        if (!state.items.length) { setStatus('Queue khaali hai — pehle file / sheet se rows load karein.', 'warn'); return; }
        return lookup();
      }
      if (target.id === 'fm-index-refresh') {
        if (state.busy) { setStatus('Ek kaam chal raha hai — ruk kar index refresh karein.', 'warn'); return; }
        setStatus('StockDataa index dobara ban raha hai (peeche-pardey) — status upar badge me live dikhega.', 'info');
        return refreshIndexStatus(true);
      }
      if (target.id === 'fm-upload-add') {
        const file = U.$('#fm-file', root).files[0];
        if (!file) { setStatus('Pehle file choose karein.', 'warn'); return; }
        try {
          let matrix;
          if (/\.xlsx$/i.test(file.name)) matrix = await parseXlsx(file);
          else { const text = await file.text(); const delimiter = file.name.toLowerCase().endsWith('.tsv') ? '\t' : (text.split(/\r?\n/)[0].includes('\t') && !text.split(/\r?\n/)[0].includes(',') ? '\t' : ','); matrix = parseCsv(text, delimiter); }
          const parsed = parsedItems(matrix, file.name);
          const items = parsed.items;
          if (!items.length) { setStatus('Valid input nahi mila. Har row me Tag ID ya Serial No/Barcode aur Agent ID required hai.', 'warn'); return; }
          if (state.items.length + items.length > MAX_INPUTS) { setStatus('Maximum ' + MAX_INPUTS + ' input selectors allowed.', 'warn'); return; }
          state.items.push.apply(state.items, items); U.$('#fm-file-note', root).textContent = file.name + ' · ' + items.length + ' input rows added' + (parsed.invalid ? ' · ' + parsed.invalid + ' invalid rows skipped' : '') + '.';
          setStatus(items.length + ' input rows queue me add hue' + (parsed.invalid ? '; ' + parsed.invalid + ' rows skip hue (identifier/Agent ID missing).' : '') + '. Lookup button dabayein.', parsed.invalid ? 'warn' : 'success');
        } catch (err) { setStatus('File read error: ' + (err.message || err), 'error'); }
        return;
      }
      if (target.id === 'fm-gs-load') return sheetRun(false);
      if (target.id === 'fm-gs-auto') return sheetRun(true);
      if (target.id === 'fm-more') { state.showLimit = (state.showLimit || SHOW_STEP) + 500; renderTable(); return; }
      if (target.id === 'fm-quick-map') return quickMap();
      if (target.id === 'fm-add-single') {
        const value = clean(U.$('#fm-identifier', root).value).replace(/(\d)-(?=\d)/g, '$1'), kind = U.$('#fm-kind', root).value, agentId = clean(U.$('#fm-agent-id', root).value);
        if (!value || !agentId) { setStatus('Barcode/Tag ID aur target Agent ID dono required hain.', 'warn'); return; }
        state.items.push({ id: nextId++, type: kind, barcode: kind === 'barcode' ? value : '', serialNo: kind === 'barcode' ? value : '', tagId: kind === 'tagId' ? value : '', agentId, source: 'Manual', selected: true });
        U.$('#fm-identifier', root).value = ''; setStatus('Manual selector added. Lookup karein.', 'success'); return;
      }
      if (target.id === 'fm-add-range') {
        const first = clean(U.$('#fm-first', root).value), last = clean(U.$('#fm-last', root).value);
        const rangeAgent = clean(U.$('#fm-range-agent', root).value);
        if (!first || !last || !rangeAgent) { setStatus('First barcode, Last barcode aur target Agent ID teeno required hain.', 'warn'); return; }
        if (compareBarcode(first, last) > 0) { setStatus('First barcode, last barcode se bada nahi ho sakta.', 'warn'); return; }
        state.items.push({ id: nextId++, type: 'range', first, last, agentId: rangeAgent, source: 'Manual range', selected: true });
        U.$('#fm-first', root).value = ''; U.$('#fm-last', root).value = ''; setStatus('Barcode range added. Lookup karein.', 'success'); return;
      }
      if (target.id === 'fm-lookup') return lookup();
      if (target.id === 'fm-map') return mapReady();
      if (target.id === 'fm-csv') return downloadCsv();
      if (target.id === 'fm-report-xlsx') return reportDownload('xlsx');
      if (target.id === 'fm-report-csv') return reportDownload('csv');
      if (target.id === 'fm-clear') { if (state.busy) return; state.items = []; state.rows = []; state.sheetCtx = null; state.showLimit = SHOW_STEP; renderTable(); setStatus('Queue clear ho gayi.', 'info'); return; }
      if (target.id === 'fm-select-all') { const checks = state.root.querySelectorAll('[data-fm-select]'); checks.forEach((cb) => { const r = state.rows[Number(cb.dataset.fmSelect)]; if (r && !cb.disabled) r.selected = target.checked; }); renderTable(); return; }
      if (target.hasAttribute('data-fm-remove')) { const idx = Number(target.dataset.fmRemove); if (!state.busy && Number.isInteger(idx)) { state.rows.splice(idx, 1); renderTable(); } }
    });
    root.addEventListener('change', (event) => {
      const t = event.target;
      if (t.id === 'fm-gs-mode') { syncSheetMode(root); saveSheetCfg(); return; }
      if (t.id === 'fm-select-all') {
        const checks = state.root.querySelectorAll('[data-fm-select]');
        checks.forEach((cb) => { const row = state.rows[Number(cb.dataset.fmSelect)]; if (row && !cb.disabled) row.selected = t.checked; });
        renderTable(); return;
      }
      if (t.matches('[data-fm-select]')) { const row = state.rows[Number(t.dataset.fmSelect)]; if (row) row.selected = t.checked; return; }
      if (t.matches('[data-fm-agent]')) {
        const row = state.rows[Number(t.dataset.fmAgent)];
        if (row && !row.mapped) { row.agentId = clean(t.value); row.status = !row.stock ? row.status : (!row.tagId ? 'Missing tag ID' : (!row.serialNo ? 'Missing serial number / barcode' : (!row.vcType ? 'Missing VC type' : (!row.agentId ? 'Missing agent ID' : 'Ready to map')))); renderTable(); }
      }
    });
    restoreSheetCfg(root);
    renderTable();
  }
  // normalizeVcType bhi expose hai — tests + doosre pages (bulk tag status) same rule use karein.
  FF.pages.fastagMapping = { title: 'FASTag Mapping', render, normalizeVcType };
})(window.FF);
