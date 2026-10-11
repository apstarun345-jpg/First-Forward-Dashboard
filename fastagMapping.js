/* FASTag Mapping — StockDataa lookup + secure server-side mapping API + CSV export. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, D = FF.data;
  const API_STATUS = '/api/fastag-mapping/status';
  const API_MAP = '/api/fastag-mapping/map';
  const MAX_INPUTS = 2500;
  const MAX_RESULTS = 3000;
  let nextId = 1;
  const state = { items: [], rows: [], configured: false, busy: false, root: null };
  // Small session-local index: repeated Quick Map / barcode lookups should not hit Sheets again.
  const stockByBarcode = new Map();
  const stockByTagId = new Map();
  const STOCK_LOOKUP_CACHE_MAX = 50000;
  const esc = (v) => U.esc(String(v == null ? '' : v));
  const clean = (v) => String(v == null ? '' : v).replace(/\u00a0/g, ' ').trim();
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
    const raw = clean(value).toUpperCase().replace(/\s+/g, '');
    if (!raw) return '';
    // StockDataa may contain 4/16 as a number or VC4/VC16 as text.
    // The mapping API accepts canonical VC-prefixed values.
    if (/^\d+$/.test(raw)) return 'VC' + raw;
    if (/^VC\d+$/.test(raw)) return raw;
    return raw;
  }
  const idKey = (v) => expandIdentifierNumber(clean(v)).replace(/[\s,\u00a0-]/g, '').toLowerCase();
  async function queryField(fieldName, values) {
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
        const make = (numeric, vals) => 'select A,B,C,D,E,F,G,H,I,J,K,L,M where ' + vals.map((x) => field + ' = ' + literal(x, numeric)).join(' or ');
        const queryRows = async (tq) => {
          const table = await D.query('StockDataa', tq, {
            timeoutMs: 4500, directTimeoutMs: 1800, retries: 0, directFirst: true
          });
          return stockRows(table, schema);
        };

        let rows = [];
        if (work.numeric) {
          // Numeric + quoted-text equality in parallel. Previously the text fallback waited
          // for the numeric request to time out first, doubling the delay for common barcodes.
          const attempts = await Promise.allSettled([
            queryRows(make(true, batch)),
            queryRows(make(false, batch))
          ]);
          const failures = attempts.filter((attempt) => attempt.status === 'rejected');
          rows = attempts.filter((attempt) => attempt.status === 'fulfilled').flatMap((attempt) => attempt.value);
          if (!attempts.some((attempt) => attempt.status === 'fulfilled') && failures.length) {
            const err = failures[0].reason;
            throw new Error(isLookupTimeout(err)
              ? 'StockDataa lookup timeout. Network/source slow hai; same lookup cache se dobara try karein.'
              : 'StockDataa lookup failed: ' + String(err && (err.message || err) || 'Google Sheets query error'));
          }
        } else {
          rows = await queryRows(make(false, batch));
        }
        for (const row of rows) {
          const sourceValue = fieldName === 'tagId' ? row.tagId : row.barcode;
          if (!batch.some((value) => idKey(value) === idKey(sourceValue))) continue;
          found.set(idKey(row.tagId) + '|' + idKey(row.barcode), row);
        }
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
        const tq = 'select A,B,C,D,E,F,G,H,I,J,K where ' + field + ' is not null limit ' + PAGE_SIZE + ' offset ' + start;
        try {
          return await D.query('StockDataa', tq, {
            timeoutMs: 4500, directTimeoutMs: 1800, retries: 0, directFirst: true
          });
        } catch (err) {
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

    // Fast path: ask Google for the requested barcode interval directly instead of reading
    // up to 250k stock rows. Query numeric/text variants concurrently to handle mixed typing.
    const fastSelect = 'select A,B,C,D,E,F,G,H,I,J,K where ';
    const variants = [];
    variants.push(fastSelect + 'D >= ' + literal(from, false) + ' and D <= ' + literal(to, false) + ' limit ' + (MAX_RESULTS + 1));
    if (isDigitKey(from) && isDigitKey(to) && !(from.length > 1 && from[0] === '0') && !(to.length > 1 && to[0] === '0')) {
      variants.push(fastSelect + 'D >= ' + literal(from, true) + ' and D <= ' + literal(to, true) + ' limit ' + (MAX_RESULTS + 1));
    }
    const fastAttempts = await Promise.allSettled(variants.map((tq) => D.query('StockDataa', tq, {
      timeoutMs: 4500, directTimeoutMs: 1800, retries: 0, directFirst: true
    })));
    const fastRows = [];
    let fastError = null;
    for (const attempt of fastAttempts) {
      if (attempt.status === 'rejected') { if (!fastError) fastError = attempt.reason; continue; }
      for (const row of stockRows(attempt.value, schema)) {
        if (row.barcode && compareBarcode(row.barcode, from) >= 0 && compareBarcode(row.barcode, to) <= 0) fastRows.push(row);
      }
    }
    const fastDedupe = new Map();
    for (const row of fastRows) fastDedupe.set(idKey(row.tagId) + '|' + idKey(row.barcode), row);
    if (fastDedupe.size) return [...fastDedupe.values()];
    // If the bounded range query returns nothing, fall back to paged local comparison for
    // mixed-type/text-stored IDs. Exact lookup/cached session index should handle most singles.
    // Multiple range pages are fetched in parallel, stopping as soon as pages are empty.
    const PAGE_SIZE = 5000, HARD_CAP = 250000, PARALLEL_PAGES = 4;
    const selected = 'select A,B,C,D,E,F,G,H,I,J,K where D is not null';
    const matched = new Map();
    let offset = 0, finished = false, previousPageFingerprint = '';
    const fetchPage = async (start) => {
      try {
        return await D.query('StockDataa', selected + ' limit ' + PAGE_SIZE + ' offset ' + start, {
          timeoutMs: 4500, directTimeoutMs: 1800, retries: 0, directFirst: true
        });
      } catch (err) {
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
    if (!matched.size && fastError && isLookupTimeout(fastError) && finished) {
      // Keep the useful "not found" outcome when the fallback was able to fully finish.
    }
    return [...matched.values()];
  }
  function addResult(item, stock, matchedBy) {
    const row = Object.assign({ id: nextId++, source: item.source || 'Manual', request: item.type === 'range' ? item.first + ' – ' + item.last : (item.tagId || item.barcode || item.serialNo || ''),
      agentId: clean(item.agentId), stock: stock || {}, matchedBy: matchedBy || '', selected: true, mapped: false, apiStatus: '', message: '',
      status: stock ? 'Ready to review' : 'Not found in StockDataa' }, stock || {});
    row.stock = stock || {}; row.agentId = clean(item.agentId);
    row.mapped = false; row.apiStatus = ''; row.message = '';
    row.status = !stock ? 'Not found in StockDataa' : (!row.tagId ? 'Missing tag ID' : (!row.serialNo ? 'Missing serial number / barcode' : (!row.vcType ? 'Missing VC type' : (!row.agentId ? 'Missing agent ID' : 'Ready to map'))));
    state.rows.push(row); return row;
  }
  function setStatus(message, kind) { const el = U.$('#fm-message', state.root); if (el) { el.className = 'notice ' + (kind || 'info'); el.textContent = message; } }
  function renderTable() {
    const host = U.$('#fm-results', state.root), summary = U.$('#fm-summary', state.root);
    if (!host || !summary) return;
    const ready = state.rows.filter((r) => r.stock && r.tagId && r.serialNo && r.vcType && r.agentId && !r.status.startsWith('Duplicate') && !r.mapped).length;
    const done = state.rows.filter((r) => r.mapped).length;
    summary.innerHTML = '<div class="grid g-4"><div class="card"><div class="card-body"><small>Rows</small><h2>' + U.fmt(state.rows.length) + '</h2></div></div><div class="card"><div class="card-body"><small>Ready to map</small><h2>' + U.fmt(ready) + '</h2></div></div><div class="card"><div class="card-body"><small>Mapped successfully</small><h2>' + U.fmt(done) + '</h2></div></div><div class="card"><div class="card-body"><small>Needs review</small><h2>' + U.fmt(state.rows.length - ready - done) + '</h2></div></div></div>';
    if (!state.rows.length) { host.innerHTML = '<div class="empty-state">Upload a file or add a barcode / Tag ID above to start.</div>'; return; }
    const body = state.rows.map((r, i) => {
      const disabled = !r.stock || !r.tagId || !r.serialNo || !r.vcType || !r.agentId || r.status.startsWith('Duplicate') || r.mapped;
      return '<tr><td><input type="checkbox" data-fm-select="' + i + '"' + (r.selected ? ' checked' : '') + (disabled ? ' disabled' : '') + '></td><td>' + esc(r.barcode) + '</td><td>' + esc(r.tagId) + '</td><td>' + esc(r.serialNo) + '</td><td>' + esc(r.vcType) + '</td><td>' + esc(r.stockAgentId) + '</td><td><input class="input fm-agent-edit" data-fm-agent="' + i + '" value="' + esc(r.agentId) + '" placeholder="Agent ID"' + (r.mapped ? ' disabled' : '') + '></td><td>' + esc(r.stockAgentName) + '</td><td>' + esc(r.tlName) + '</td><td><span class="badge ' + (r.mapped ? 'green' : (disabled ? 'amber' : 'gray')) + '">' + esc(r.apiStatus || r.status) + '</span><small class="dim fm-status-msg">' + esc(r.message) + '</small></td><td><button class="btn small" data-fm-remove="' + i + '"' + (state.busy ? ' disabled' : '') + '>Remove</button></td></tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table class="tbl compact"><thead><tr><th><input type="checkbox" id="fm-select-all" aria-label="Select ready rows"></th><th>Barcode</th><th>Tag ID</th><th>Serial No</th><th>VC Type</th><th>Stock Agent ID</th><th>Agent ID to map</th><th>Agent name</th><th>TL</th><th>Mapping status</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>';
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
  async function lookup() {
    if (state.busy) return;
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
      if (compareBarcode(typedFirst, typedLast) > 0) { setStatus('First barcode, last barcode se bada nahi ho sakta.', 'warn'); return; }
      state.items.push({ id: nextId++, type: 'range', first: typedFirst, last: typedLast, agentId: typedRangeAgent, source: 'Manual range', selected: true });
      U.$('#fm-first', state.root).value = ''; U.$('#fm-last', state.root).value = '';
    }
    if (!state.items.length) {
      if (typedFirst || typedLast || typedRangeAgent) { setStatus('Barcode range ke liye First barcode, Last barcode aur target Agent ID teeno required hain.', 'warn'); return; }
      if (typedValue || typedAgent) { setStatus('Barcode/Tag ID aur target Agent ID dono required hain.', 'warn'); return; }
      setStatus('Pehle file upload karein ya barcode / Tag ID add karein.', 'warn'); return;
    }
    const waiting = state.items.splice(0);
    if (waiting.length > MAX_INPUTS) { state.items.unshift.apply(state.items, waiting); setStatus('Ek baar me maximum ' + MAX_INPUTS + ' input selectors allowed hain.', 'warn'); return; }
    state.busy = true; setStatus('StockDataa se matching details lookup ho rahi hain…', 'info');
    const rowsBefore = state.rows.length;
    const old = U.$('#fm-lookup', state.root), mapBtn = U.$('#fm-map', state.root); if (old) old.disabled = true; if (mapBtn) mapBtn.disabled = true;
    try {
      const barcodes = waiting.flatMap((x) => x.type === 'range' ? [] : [x.barcode || x.serialNo].filter(Boolean));
      const tagIds = waiting.flatMap((x) => x.tagId ? [x.tagId] : []);
      // serialNo is a payload field, not a separate StockDataa lookup column: it is BARCODE.
      // Query each physical StockDataa column only once to reduce Google Sheets request time.
      const found = await Promise.all([
        queryField('barcode', barcodes),
        queryField('tagId', tagIds)
      ]);
      const byBarcode = found[0], byTag = found[1];
      const ranges = waiting.filter((x) => x.type === 'range');
      let rangeCursor = 0;
      const rangeWorkers = Array.from({ length: Math.min(3, ranges.length) }, async () => {
        while (rangeCursor < ranges.length) {
          const item = ranges[rangeCursor++];
          try { item._rangeRows = await queryRange(item.first, item.last); }
          catch (err) { item._lookupError = err.message || String(err); }
        }
      });
      await Promise.all(rangeWorkers);
      for (const item of waiting) {
        if (item._lookupError) { state.rows.push({ id: nextId++, source: item.source, request: item.first + ' – ' + item.last, selected: false, status: 'Lookup error', message: item._lookupError, stock: {}, agentId: '' }); continue; }
        let candidates = [];
        if (item.type === 'range') {
          if (compareBarcode(item.first, item.last) > 0) { state.rows.push({ id: nextId++, source: item.source, request: item.first + ' – ' + item.last, selected: false, status: 'Invalid barcode range', message: 'First barcode last se bada hai.', stock: {}, agentId: '' }); continue; }
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
        if (state.rows.length + candidates.length > MAX_RESULTS) { state.rows.push({ id: nextId++, source: item.source, request: item.type === 'range' ? item.first + ' – ' + item.last : (item.tagId || item.barcode || ''), selected: false, status: 'Result limit reached', message: 'Ek lookup me maximum ' + MAX_RESULTS + ' matched tags. Range ko chhote parts me divide karein.', stock: {}, agentId: '' }); continue; }
        for (const stock of candidates) addResult(item, stock, item.type === 'range' ? 'Barcode range' : (item.tagId ? 'Tag ID' : 'Barcode'));
      }
      checkDuplicates(); renderTable();
      const good = state.rows.filter((r) => r.stock && r.tagId && r.serialNo && r.vcType && r.agentId && !r.status.startsWith('Duplicate') && !r.mapped).length;
      setStatus('Lookup complete: ' + good + ' row ready. Mapping se pehle Agent ID aur VC type review karein.', good ? 'success' : 'warn');
    } catch (err) {
      // Query fail hone par queue wapas daal do — nahi to user dubara Lookup dabaye to
      // "Pehle file upload karein" dikhega aur retry me hi inputs gayab ho jaate the.
      if (state.rows.length === rowsBefore) state.items = waiting.concat(state.items);
      setStatus('Lookup fail: ' + (err.message || err) + (state.items.length ? ' Inputs queue me wapas aa gaye — dobara Lookup dabayein.' : ''), 'error');
    }
    finally { state.busy = false; if (old) old.disabled = false; if (mapBtn) mapBtn.disabled = !state.configured; }
  }
  async function quickMap() {
    if (state.busy) return;
    const value = clean(U.$('#fm-identifier', state.root).value);
    const kind = U.$('#fm-kind', state.root).value;
    const agentId = clean(U.$('#fm-agent-id', state.root).value);
    if (!value || !agentId) { setStatus('Barcode/Tag ID aur target Agent ID dono required hain.', 'warn'); return; }
    const previous = new Map(state.rows.map((r) => [r.id, r.selected]));
    const oldIds = new Set(state.rows.map((r) => r.id));
    state.items.push({ id: nextId++, type: kind, barcode: kind === 'barcode' ? value : '', tagId: kind === 'tagId' ? value : '', agentId, source: 'Quick Map', selected: true });
    U.$('#fm-identifier', state.root).value = '';
    await lookup();
    const added = state.rows.filter((r) => !oldIds.has(r.id));
    const ready = added.filter((r) => r.stock && r.tagId && r.serialNo && r.vcType && r.agentId && !r.status.startsWith('Duplicate'));
    if (!ready.length) {
      state.rows.forEach((r) => { if (previous.has(r.id)) r.selected = previous.get(r.id); });
      renderTable(); setStatus('Quick Map ruk gaya: StockDataa record ya required mapping detail nahi mili. Row check karein.', 'warn'); return;
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
    const mapBtn = U.$('#fm-map', state.root); if (mapBtn) mapBtn.disabled = true;
    try {
      let success = 0, failed = 0;
      for (let i = 0; i < ready.length; i += 100) {
        const batch = ready.slice(i, i + 100);
        const res = await fetch(API_MAP, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FF-Dashboard' }, body: JSON.stringify({ rows: batch.map((r) => ({ tagId: r.tagId, serialNo: r.serialNo, vcType: normalizeVcType(r.vcType), agentId: r.agentId })) }) });
        let json = {}; try { json = await res.json(); } catch (_) {}
        if (!res.ok || !Array.isArray(json.results)) throw new Error(json.error || ('Mapping API HTTP ' + res.status));
        json.results.forEach((out, j) => {
          const r = batch[out.index == null ? j : out.index]; if (!r) return;
          r.apiStatus = out.status || (out.success ? 'Success' : 'Failed'); r.message = out.message || ''; r.mapped = !!out.success;
          r.status = out.success ? 'Mapped successfully' : 'Mapping failed'; if (out.success) success++; else failed++;
        });
        renderTable(); setStatus('Progress ' + Math.min(i + batch.length, ready.length) + '/' + ready.length + ' · Success ' + success + ' · Failed ' + failed, 'info');
      }
      setStatus('Mapping complete. Success: ' + success + ' · Failed: ' + failed + '. Full CSV download kar sakte hain.', failed ? 'warn' : 'success');
    } catch (err) { setStatus('Mapping request fail: ' + (err.message || err) + '. Result table se CSV download kar sakte hain.', 'error'); }
    finally { state.busy = false; if (mapBtn) mapBtn.disabled = !state.configured; renderTable(); }
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
    root.innerHTML = '<div class="page-head"><div><h1>🧭 FASTag Mapping</h1><p class="sub">GV Partner · StockDataa se Tag ID, Serial/Barcode, VC Type aur Agent details fetch karke securely map karein.</p></div><div class="head-actions"><span id="fm-api-status" class="badge amber">Mapping API status checking…</span></div></div>' +
      '<div class="grid g-2"><section class="card"><div class="card-head"><h3>📂 Upload mapping file</h3><div class="head-actions"><button class="btn small" id="fm-template">⬇ 4-column API template</button><button class="btn small" id="fm-range-template">⬇ Range input template</button></div></div><div class="card-body"><p class="dim small">API template: tagId, serialNo, vcType, agentId. Range template: firstBarcode, lastBarcode, agentId. Range upload mein barcode series StockDataa se expand hogi; TAG_ID, BARCODE aur TAG_CLASS auto-fill honge.</p><input class="input" id="fm-file" type="file" accept=".csv,.tsv,.txt,.xlsx"><div id="fm-file-note" class="dim small">No file selected.</div><button class="btn primary" id="fm-upload-add">Add file rows</button></div></section>' +
      '<section class="card"><div class="card-head"><h3>⌨️ Quick mapping</h3></div><div class="card-body"><label>Lookup by</label><select id="fm-kind" class="input"><option value="barcode">Barcode / Serial No</option><option value="tagId">Tag ID</option></select><label>Barcode / Tag ID</label><input class="input" id="fm-identifier" placeholder="Barcode ya Tag ID enter karein"><label>Target Agent ID (required)</label><input class="input" id="fm-agent-id" placeholder="Jis Agent ID se map karna hai"><div class="btn-row"><button class="btn" id="fm-add-single">Add to queue</button><button class="btn primary" id="fm-quick-map">⚡ Quick map</button></div><hr><h4>Barcode range</h4><div class="grid g-3"><div><label>First barcode</label><input class="input" id="fm-first" placeholder="Start barcode"></div><div><label>Last barcode</label><input class="input" id="fm-last" placeholder="End barcode"></div><div><label>Target Agent ID (required)</label><input class="input" id="fm-range-agent" placeholder="Jis Agent ID se map karna hai"></div></div><button class="btn" id="fm-add-range">Add range</button></div></section></div>' +
      '<section class="card"><div class="card-head"><div><h3>🔎 StockDataa lookup & mapping queue</h3><p class="dim small">Lookup ke baad preview/review karein. Target Agent ID edit kar sakte hain; API call sirf selected complete rows par hoga.</p></div><div class="head-actions"><button class="btn" id="fm-lookup">🔎 Lookup StockDataa</button><button class="btn primary" id="fm-map" disabled>🚀 Map ready rows</button><button class="btn" id="fm-api-csv">⬇ API CSV · 4 columns</button><button class="btn" id="fm-csv">⬇ Full details CSV</button><button class="btn" id="fm-clear">Clear</button></div></div><div class="card-body"><div id="fm-message" class="notice info">API status check ho raha hai…</div><div id="fm-summary"></div><div id="fm-results"><div class="empty-state">Upload a file or add a barcode / Tag ID above to start.</div></div></div></section>';
    state.items = []; state.rows = []; state.busy = false;
    const status = U.$('#fm-api-status', root);
    fetch(API_STATUS, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'FF-Dashboard' } }).then((r) => r.json()).then((j) => {
      state.configured = !!j.configured;
      if (status) { status.className = 'badge ' + (state.configured ? 'green' : 'amber'); status.textContent = state.configured ? 'Mapping API configured' : 'API secret missing in Render'; }
      const mapButton = U.$('#fm-map', root); if (mapButton) mapButton.disabled = !state.configured;
      setStatus(state.configured ? 'Ready. Upload file ya manual barcode / Tag ID add karein.' : 'API key configure nahi hai. Render environment me GV_TAG_MAPPING_SECRET set karne ke baad mapping enabled hogi; secret browser/GitHub me save nahi hota.', state.configured ? 'success' : 'warn');
    }).catch(() => { if (status) status.textContent = 'API status unavailable'; setStatus('API status verify nahi ho paya. Login/session aur server status check karein.', 'warn'); });
    root.addEventListener('click', async (event) => {
      const target = event.target.closest('button'); if (!target) return;
      if (target.id === 'fm-template') return templateCsv();
      if (target.id === 'fm-range-template') return rangeTemplateCsv();
      if (target.id === 'fm-api-csv') return apiCsv();
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
      if (target.id === 'fm-quick-map') return quickMap();
      if (target.id === 'fm-add-single') {
        const value = clean(U.$('#fm-identifier', root).value), kind = U.$('#fm-kind', root).value, agentId = clean(U.$('#fm-agent-id', root).value);
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
      if (target.id === 'fm-clear') { if (state.busy) return; state.items = []; state.rows = []; renderTable(); setStatus('Queue clear ho gayi.', 'info'); return; }
      if (target.id === 'fm-select-all') { const checks = state.root.querySelectorAll('[data-fm-select]'); checks.forEach((cb) => { const r = state.rows[Number(cb.dataset.fmSelect)]; if (r && !cb.disabled) r.selected = target.checked; }); renderTable(); return; }
      if (target.hasAttribute('data-fm-remove')) { const idx = Number(target.dataset.fmRemove); if (!state.busy && Number.isInteger(idx)) { state.rows.splice(idx, 1); renderTable(); } }
    });
    root.addEventListener('change', (event) => {
      const t = event.target;
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
    renderTable();
  }
  FF.pages.fastagMapping = { title: 'FASTag Mapping', render };
})(window.FF);
