/* Bulk Tag Status — targeted VRN / Tag ID / Barcode lookup across FF and GV sources.
   This page deliberately queries only rows matching the pasted identifiers; it does not download
   the entire EIR, StockDataa, GV Master or Tag Assignment sheet into the page. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';

  const U = FF.util || {};
  const D = FF.data || {};
  const PAGE_TITLE = 'Bulk Tag Status';
  const MAX_RECORDS = 250;
  const QUERY_CHUNK = 25;
  const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
  const state = {
    root: null, results: [], filter: 'all', query: '', busy: false,
    fresh: true, selectedFile: '', lastCheckedAt: '', warnings: [],
    parsedCount: 0, errors: {}, queryGeneration: 0
  };

  const esc = (v) => typeof U.esc === 'function'
    ? U.esc(String(v == null ? '' : v))
    : String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (v) => String(v == null ? '' : v).replace(/^\uFEFF/, '').trim();
  const normId = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normHeader = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const validCol = (v) => /^[A-Z]{1,3}$/i.test(String(v || '').trim());
  const uniq = (a) => [...new Set((a || []).filter(Boolean))];
  const chunks = (a, size) => {
    const out = [];
    for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
    return out;
  };
  const col = (key, fallback) => {
    const v = clean(key || fallback || '').toUpperCase();
    return validCol(v) ? v : '';
  };
  const valAt = (row, letters) => {
    const out = {};
    const labels = uniq(letters.map((x) => x.col));
    letters.forEach((x) => {
      const idx = labels.indexOf(x.col);
      out[x.key] = idx >= 0 ? clean(D.cellText ? D.cellText(row[idx]) : row[idx]) : '';
    });
    return out;
  };
  const dateRank = (v) => {
    const d = U.parseDate ? U.parseDate(v) : null;
    if (d instanceof Date && !isNaN(d.getTime())) return d.getTime();
    const n = Date.parse(v || '');
    return Number.isFinite(n) ? n : 0;
  };
  const dateLabel = (v) => clean(v) || '—';
  const sourceText = (v) => clean(v) || '—';
  const rowSignature = (src, r) => [
    src, normId(r.tagId), normId(r.vrn), normId(r.barcode || r.serial),
    normId(r.agentId), normId(r.agentName), normId(r.date), normId(r.status)
  ].join('|');
  const rowKeys = (r) => uniq([r.tagId, r.vrn, r.regNumber, r.barcode, r.serial].map(normId).filter(Boolean));
  function cleanInputValue(value) {
    return clean(value).replace(/^\s*(?:vehicle\s*(?:no|number|registration)?|registration|reg(?:istration)?\s*(?:no|number)?|vrn|tag\s*id|tagid|barcode|serial(?:\s*(?:no|number))?)\s*[:=\-]\s*/i, '').trim();
  }
  function headerKind(value) {
    const h = normHeader(value);
    if (!h) return '';
    if (/\b(vrn|vehicle no|vehicle number|vehicle reg no|vehicle reg number|vehicle registration|registration no|registration number|reg no|reg number|registration mark|number plate|license plate|licence plate)\b/.test(h)) return 'VRN';
    if (/\b(tag id|tagid|fastag id|fastag tag|tag number|tag no)\b/.test(h)) return 'Tag ID';
    if (/\b(barcode|bar code|serial|serial no|serial number|sno|barcode no)\b/.test(h)) return 'Barcode';
    return '';
  }
  function guessKind(value) {
    const v = normId(value);
    if (/^(?:[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$/.test(v)) return 'VRN';
    return 'Identifier';
  }
  function parseDelimited(text, delimiter) {
    const input = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (ch === '"') {
        if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (!quoted && ch === delimiter) {
        row.push(cell); cell = '';
      } else if (!quoted && (ch === '\n' || ch === '\r')) {
        if (ch === '\r' && input[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((x) => clean(x)) || !rows.length) rows.push(row);
    return rows.map((r) => r.map((x) => clean(x)));
  }
  function detectDelimiter(text) {
    const first = String(text || '').split(/\r?\n/).find((x) => clean(x)) || '';
    if (first.includes('\t')) return '\t';
    if (first.includes(',')) return ',';
    if (first.includes(';')) return ';';
    return '\t';
  }
  function matrixToRecords(matrix) {
    const rows = Array.isArray(matrix) ? matrix : [];
    const nonEmpty = rows.filter((r) => Array.isArray(r) && r.some((c) => clean(c)));
    if (!nonEmpty.length) return { records: [], headers: [], headerFound: false };
    const first = nonEmpty[0].map(clean);
    const types = first.map(headerKind);
    const recognized = types.filter(Boolean).length;
    const headerFound = recognized >= 1;
    const records = [];
    if (headerFound) {
      const columns = first.map((name, i) => ({ name: name || ('Column ' + (i + 1)), kind: types[i] }));
      for (let i = 1; i < nonEmpty.length; i++) {
        const row = nonEmpty[i];
        const fields = [];
        columns.forEach((c, ci) => {
          if (!c.kind) return;
          const value = cleanInputValue(row[ci] || '');
          if (value) fields.push({ kind: c.kind, value });
        });
        if (fields.length) records.push({ line: i + 1, fields });
      }
    } else {
      let line = 0;
      nonEmpty.forEach((row) => row.forEach((v) => {
        const value = cleanInputValue(v);
        if (value) records.push({ line: ++line, fields: [{ kind: guessKind(value), value }] });
      }));
    }
    return { records, headers: headerFound ? columnsToHeaders(first, types) : [], headerFound };
  }
  function columnsToHeaders(first, types) {
    return first.map((name, i) => types[i] ? name : '').filter(Boolean);
  }
  function parseInputText(text) {
    const raw = String(text || '').trim();
    if (!raw) return { records: [], headers: [], headerFound: false };
    const delimiter = detectDelimiter(raw);
    return matrixToRecords(parseDelimited(raw, delimiter));
  }
  function matrixToTsv(matrix) {
    return (matrix || []).map((row) => (row || []).map((v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  }

  async function unzipXlsx(file) {
    if (!file || !file.arrayBuffer) throw new Error('Excel file read nahi ho payi.');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('File 12 MB se badi hai. Chhoti file upload karein.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const min = Math.max(0, bytes.length - 65558);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Valid .xlsx ZIP structure nahi mili. CSV file try karein.');
    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);
    const files = new Map();
    const td = new TextDecoder('utf-8');
    const inflateRaw = async (data) => {
      if (typeof DecompressionStream === 'undefined') throw new Error('Is browser mein .xlsx decompression support nahi hai. Excel ko CSV UTF-8 mein Save As karke upload karein.');
      let stream;
      try { stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
      catch (e) { throw new Error('Excel compression unsupported hai. Excel ko CSV UTF-8 mein Save As karke upload karein.'); }
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
    for (let n = 0; n < count; n++) {
      if (view.getUint32(at, true) !== 0x02014b50) throw new Error('Excel ZIP directory invalid hai.');
      const method = view.getUint16(at + 10, true);
      const compSize = view.getUint32(at + 20, true);
      const nameLen = view.getUint16(at + 28, true);
      const extraLen = view.getUint16(at + 30, true);
      const commentLen = view.getUint16(at + 32, true);
      const localOffset = view.getUint32(at + 42, true);
      const name = td.decode(bytes.subarray(at + 46, at + 46 + nameLen));
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const comp = bytes.subarray(start, start + compSize);
      let data;
      if (method === 0) data = comp;
      else if (method === 8) data = await inflateRaw(comp);
      else { at += 46 + nameLen + extraLen + commentLen; continue; }
      files.set(name, td.decode(data));
      at += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }
  function parseXml(text) {
    if (typeof DOMParser === 'undefined') throw new Error('Browser XML parser available nahi hai.');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Excel workbook XML invalid hai.');
    return doc;
  }
  function cellRefColumn(ref) {
    const letters = String(ref || '').replace(/[0-9].*$/, '').toUpperCase();
    let n = 0;
    for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
    return Math.max(0, n - 1);
  }

  // Preserve leading zeroes where Excel stored an identifier as a number with a zero mask.
  // This only formats simple identifier masks; dates, percentages and decimals stay untouched.
  function restoreFormattedIdentifier(value, formatCode) {
    const raw = String(value == null ? '' : value);
    const format = String(formatCode || '').split(';')[0];
    if (!/^\d+$/.test(raw) || !format || /[dDyYhHsS%]|[Ee][+-]?0/.test(format)) return raw;
    const mask = format.replace(/"[^"]*"/g, '').replace(/\\(.)/g, '$1').replace(/[_*]./g, '').split('.')[0];
    if (!mask.includes('0') || /[#?]/.test(mask) || !/^[0 .\-()/]+$/.test(mask)) return raw;
    const width = (mask.match(/0/g) || []).length;
    if (width <= raw.length) return raw;
    const digits = raw.padStart(width, '0');
    let pos = 0;
    return mask.replace(/0/g, () => digits[pos++] || '0');
  }

  async function readXlsxMatrix(file) {
    const zip = await unzipXlsx(file);
    const wb = zip.get('xl/workbook.xml');
    const rels = zip.get('xl/_rels/workbook.xml.rels');
    if (!wb || !rels) throw new Error('Excel workbook.xml nahi mila.');
    const wdoc = parseXml(wb), rdoc = parseXml(rels);
    const firstSheet = wdoc.getElementsByTagName('sheet')[0];
    if (!firstSheet) throw new Error('Excel workbook mein koi sheet nahi hai.');
    const relId = firstSheet.getAttribute('r:id') || firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = '';
    [...rdoc.getElementsByTagName('Relationship')].forEach((r) => {
      if (r.getAttribute('Id') === relId) target = r.getAttribute('Target') || '';
    });
    if (!target) throw new Error('Excel ki first worksheet link nahi mili.');
    const sheetPath = target[0] === '/' ? target.slice(1) : ('xl/' + target).replace(/\/+/g, '/');
    const sheetText = zip.get(sheetPath) || zip.get(sheetPath.replace(/^xl\/xl\//, 'xl/'));
    if (!sheetText) throw new Error('Excel ki first worksheet data nahi mili.');
    const ssText = zip.get('xl/sharedStrings.xml') || '';
    const shared = [];
    const styleFormats = [];
    const stylesText = zip.get('xl/styles.xml') || '';
    if (stylesText) {
      const stylesDoc = parseXml(stylesText);
      const customFormats = new Map();
      [...stylesDoc.getElementsByTagName('numFmt')].forEach((nf) => {
        customFormats.set(Number(nf.getAttribute('numFmtId')), nf.getAttribute('formatCode') || '');
      });
      const cellXfs = stylesDoc.getElementsByTagName('cellXfs')[0];
      if (cellXfs) [...cellXfs.getElementsByTagName('xf')].forEach((xf) => {
        styleFormats.push(customFormats.get(Number(xf.getAttribute('numFmtId'))) || '');
      });
    }
    if (ssText) {
      const sdoc = parseXml(ssText);
      [...sdoc.getElementsByTagName('si')].forEach((si) => {
        shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent || '').join(''));
      });
    }
    const doc = parseXml(sheetText);
    const sheetData = doc.getElementsByTagName('sheetData')[0];
    if (!sheetData) throw new Error('Excel worksheet khaali hai.');
    const out = [];
    const xmlRows = [...sheetData.getElementsByTagName('row')];
    if (xmlRows.length > 5001) throw new Error('Excel file mein 5,000 se zyada rows hain. File ko chhote batches mein split karein.');
    xmlRows.forEach((rowNode) => {
      const row = [];
      [...rowNode.getElementsByTagName('c')].forEach((cell) => {
        const i = cellRefColumn(cell.getAttribute('r'));
        const type = cell.getAttribute('t') || '';
        const vNode = cell.getElementsByTagName('v')[0];
        let value = vNode ? (vNode.textContent || '') : '';
        if (type === 's') value = shared[Number(value)] || '';
        else if (type === 'inlineStr') value = [...cell.getElementsByTagName('t')].map((t) => t.textContent || '').join('');
        else if (type === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
        else if (!type) value = restoreFormattedIdentifier(value, styleFormats[Number(cell.getAttribute('s') || 0)] || '');
        row[i] = String(value == null ? '' : value);
      });
      out.push(row.map((x) => x == null ? '' : x));
    });
    return out;
  }

  function sourceSpecs() {
    const cfg = FF.config || {};
    const e = cfg.eir || {}, s = cfg.stock || {}, gv = cfg.gv || {};
    const gm = gv.master || {}, a = gv.assignment || {};
    const make = (key, sheet, definitions, matchKeys, gid) => {
      const defs = definitions.map((d) => ({ key: d.key, col: col(d.col) })).filter((d) => d.col);
      const cols = uniq(defs.map((d) => d.col));
      return {
        key, sheet, gid: gid || '', defs, cols, matchKeys,
        mapRow: (raw) => {
          const row = valAt(raw, defs);
          row.source = key;
          row._keys = uniq(matchKeys.map((k) => normId(row[k])).filter(Boolean));
          row._signature = rowSignature(key, row);
          return row;
        }
      };
    };
    const stockSheet = (cfg.stock && cfg.stock.sheet) || 'StockDataa';
    const gvMasterTab = 'GV Master';
    const gvAssignTab = 'Tag Assignment';
    return [
      make('eir', e.sheet || 'EIR', [
        { key: 'tagId', col: e.tagId }, { key: 'vrn', col: e.vrn }, { key: 'regNumber', col: e.regNumber },
        { key: 'cls', col: e.cls }, { key: 'tagType', col: e.type }, { key: 'status', col: e.status },
        { key: 'date', col: e.date }, { key: 'agentId', col: e.agentId }, { key: 'agentName', col: e.agentName },
        { key: 'tlId', col: e.tlId }, { key: 'tlName', col: e.tlName }
      ], ['tagId', 'vrn', 'regNumber'], (cfg.tabBy && cfg.tabBy('EIR') || {}).gid),
      make('ffStock', stockSheet, [
        { key: 'stockId', col: s.id }, { key: 'name', col: s.name }, { key: 'tagId', col: s.tagId },
        { key: 'barcode', col: s.barcode }, { key: 'cls', col: s.cls }, { key: 'tagType', col: s.tagType },
        { key: 'bcAllocatedAt', col: s.bcAllocatedAt }, { key: 'agentId', col: s.agentId },
        { key: 'agentName', col: s.agentName }, { key: 'agentAllocatedAt', col: s.agentAllocatedAt },
        { key: 'tlName', col: s.tlName }
      ], ['tagId', 'barcode'], (cfg.tabBy && cfg.tabBy('StockDataa') || {}).gid),
      make('gvMaster', gvMasterTab, [
        { key: 'tagId', col: gm.tagId }, { key: 'serial', col: gm.serial }, { key: 'vrn', col: gm.vrn },
        { key: 'cls', col: gm.vClass }, { key: 'cch', col: gm.cch }, { key: 'tagType', col: gm.tagType },
        { key: 'status', col: gm.status }, { key: 'date', col: gm.date }, { key: 'agentId', col: gm.uniqueId },
        { key: 'agentName', col: gm.agentName }, { key: 'tlId', col: gm.gvTlId || gm.tlId }, { key: 'tlName', col: gm.tlName },
        { key: 'gvId', col: gm.gvUniqueId }, { key: 'gvName', col: gm.gvUniqueName }
      ], ['tagId', 'serial', 'vrn'], gm.gid || (cfg.tabBy && cfg.tabBy('GV Master') || {}).gid),
      make('gvStock', gvAssignTab, [
        { key: 'cls', col: a.cls }, { key: 'tagId', col: a.tagId }, { key: 'serial', col: a.serial },
        { key: 'status', col: a.status }, { key: 'agentId', col: a.agentId }, { key: 'agentName', col: a.agentName },
        { key: 'tlId', col: a.tlId }, { key: 'tlName', col: a.tlName }, { key: 'gvId', col: a.gvUniqueId },
        { key: 'gvName', col: a.gvUniqueName }, { key: 'allocatedAt', col: a.allocatedAt }
      ], ['tagId', 'serial'], a.gid || (cfg.tabBy && cfg.tabBy('Tag Assignment') || {}).gid)
    ];
  }
  function candidateTokens(records) {
    const out = [];
    const seen = new Set();
    (records || []).forEach((r) => (r.fields || []).forEach((f) => {
      const raw = cleanInputValue(f.value);
      const normalized = normId(raw);
      if (!normalized || normalized.length < 4) return;
      [raw.toUpperCase(), normalized].forEach((t) => {
        const x = clean(t);
        const key = normId(x) + '|' + x;
        if (x && !seen.has(key)) { seen.add(key); out.push(x); }
      });
    }));
    return out;
  }
  function makeWhere(spec, tokens) {
    const terms = [];
    spec.matchKeys.forEach((key) => {
      const def = spec.defs.find((d) => d.key === key);
      if (!def) return;
      tokens.forEach((t) => terms.push(def.col + ' = ' + (D.lit ? D.lit(t) : ('"' + t.replace(/"/g, '') + '"'))));
    });
    return uniq(terms);
  }
  function stockOwner(r) {
    // GV unique-id/name fields can be partner metadata; only an actual Agent ID/name or allocation
    // timestamp classifies inventory as allocated. This avoids labelling ordinary GV stock as issued.
    return !!(clean(r.agentId) || clean(r.agentName) || clean(r.agentAllocatedAt) || clean(r.allocatedAt));
  }
  function hasOutStatus(value) {
    const v = clean(value).toUpperCase();
    return ['ISSUE', 'ISSUED', 'SOLD', 'DISPATCH', 'DELIVER', 'RETURN', 'CANCEL', 'DEAD', 'BLOCK', 'LOST', 'DAMAGE', 'REPLAC', 'VOID', 'EXPIRE', 'CLOSED', 'INACTIVE'].some((x) => v.includes(x));
  }
  function uniqueSourceRows(rows) {
    const m = new Map();
    (rows || []).forEach((r) => { if (r && r._signature && !m.has(r._signature)) m.set(r._signature, r); });
    return [...m.values()];
  }
  function matchedRows(record, rows) {
    const wanted = new Set((record.fields || []).map((f) => normId(f.value)).filter(Boolean));
    return (rows || []).filter((r) => (r._keys || rowKeys(r)).some((k) => wanted.has(k)));
  }
  function className(r) { return clean(r.cls || r.cch); }
  function identifierSummary(r) {
    const parts = [];
    if (r.vrn || r.regNumber) parts.push('VRN ' + (r.vrn || r.regNumber));
    if (r.tagId) parts.push('Tag ID ' + r.tagId);
    if (r.barcode || r.serial) parts.push('Barcode/Serial ' + (r.barcode || r.serial));
    return parts.join(' · ');
  }
  function detailSummary(source, rows) {
    const label = { eir: 'FF EIR', ffStock: 'StockDataa', gvMaster: 'GV Master', gvStock: 'Tag Assignment' }[source] || source;
    const out = [];
    (rows || []).slice(0, 3).forEach((r) => {
      const id = [r.vrn || r.regNumber, r.tagId, r.barcode || r.serial].filter(Boolean).join(' / ');
      const who = r.agentName || r.agentId ? ' · ' + (r.agentName || r.agentId) : '';
      const cls = className(r) ? ' · ' + className(r) : '';
      const dt = r.date || r.agentAllocatedAt || r.bcAllocatedAt || r.allocatedAt;
      out.push(label + ': ' + (id || 'matching row') + who + cls + (dt ? ' · ' + dt : ''));
    });
    if ((rows || []).length > 3) out.push(label + ': +' + (rows.length - 3) + ' more matching rows');
    return out;
  }
  function resolveStatus(record, sourceData, sourceFailures) {
    const matches = {
      eir: matchedRows(record, sourceData.eir || []),
      ffStock: matchedRows(record, sourceData.ffStock || []),
      gvMaster: matchedRows(record, sourceData.gvMaster || []),
      gvStock: matchedRows(record, sourceData.gvStock || [])
    };
    const inputKeys = new Set((record.fields || []).map((f) => normId(f.value)).filter(Boolean));
    const incompleteSources = Object.keys(sourceFailures || {}).filter((source) => {
      const set = sourceFailures[source];
      return set && [...inputKeys].some((k) => set.has(k));
    });
    let code = '', label = '', note = '';
    const gvIssued = matches.gvMaster.length > 0;
    const ffIssued = matches.eir.length > 0;
    const ffStock = matches.ffStock;
    const gvStock = matches.gvStock;
    if (gvIssued && ffIssued) {
      code = 'multi-issued'; label = 'GV + FF records'; note = 'Same identifier dono issuance sources mein mila. Duplicate/cross-channel record ko verify karein.';
    } else if (gvIssued && (matches.ffStock.length > 0 || matches.gvStock.length > 0)) {
      code = 'multi-stock'; label = 'GV issued + inventory overlap'; note = 'GV issuance ke saath kisi inventory source mein bhi match mila. Tag identity aur live stock location verify karein.';
    } else if (ffIssued && (matches.ffStock.length > 0 || matches.gvStock.length > 0)) {
      code = 'multi-stock'; label = 'FF issued + inventory overlap'; note = 'FF issuance ke saath kisi inventory source mein bhi match mila. Duplicate/stale inventory record verify karein.';
    } else if (gvIssued) {
      code = 'gv-issued'; label = 'GV ISSUED'; note = 'GV Master issuance record mila.';
    } else if (ffIssued) {
      code = 'ff-issued'; label = 'FF ISSUED'; note = 'EIR issuance record mila.';
    } else {
      const ffOwned = ffStock.filter(stockOwner);
      const ffFree = ffStock.filter((r) => !stockOwner(r));
      const gvOut = gvStock.filter((r) => hasOutStatus(r.status));
      const gvCurrent = gvStock.filter((r) => !hasOutStatus(r.status));
      const gvOwned = gvCurrent.filter(stockOwner);
      const gvFree = gvCurrent.filter((r) => !stockOwner(r));
      const cats = [];
      if (ffOwned.length) cats.push({ code: 'ff-allocated', label: 'FF allocated stock', rows: ffOwned });
      if (ffFree.length) cats.push({ code: 'ff-stock', label: 'FF stock', rows: ffFree });
      if (gvOwned.length) cats.push({ code: 'gv-allocated', label: 'GV allocated stock', rows: gvOwned });
      if (gvFree.length) cats.push({ code: 'gv-stock', label: 'GV stock', rows: gvFree });
      if (gvOut.length) cats.push({ code: 'gv-status-review', label: 'GV status OUT — verify', rows: gvOut });
      if (cats.length > 1) {
        code = 'multi-stock'; label = 'Multiple stock records';
        note = 'Identifier ek se zyada inventory category mein mila. Source details compare karein.';
      } else if (gvOut.length) {
        code = 'gv-status-review'; label = 'GV status OUT — verify';
        note = 'Tag Assignment mein OUT/dispatch/return status mila, lekin GV Master issuance record nahi mila.';
      } else if (gvOwned.length) {
        code = 'gv-allocated'; label = 'GV allocated stock';
        note = 'Tag Assignment mein agent/allocation details hain; GV Master issuance match nahi mila.';
      } else if (gvFree.length) {
        code = 'gv-stock'; label = 'GV stock';
        note = 'Tag Assignment mein mila; GV Master issuance match nahi mila.';
      } else if (ffOwned.length) {
        code = 'ff-allocated'; label = 'FF allocated stock';
        note = 'StockDataa mein agent/allocation details hain; FF EIR issuance match nahi mila.';
      } else if (ffFree.length) {
        code = 'ff-stock'; label = 'FF stock';
        note = 'StockDataa mein tag/barcode hai aur agent allocation blank hai.';
      } else if (incompleteSources.length) {
        code = 'incomplete'; label = 'Incomplete — retry';
        note = 'Kuch source queries fail hui: ' + incompleteSources.join(', ') + '. Is result ko Not Found na samjhein.';
      } else {
        code = 'not-found'; label = 'Not found';
        note = 'In chaaron sources mein exact VRN / Tag ID / Barcode match nahi mila.';
      }
    }
    const details = []
      .concat(detailSummary('gvMaster', matches.gvMaster))
      .concat(detailSummary('eir', matches.eir))
      .concat(detailSummary('gvStock', matches.gvStock))
      .concat(detailSummary('ffStock', matches.ffStock));
    const allRows = [...matches.gvMaster, ...matches.eir, ...matches.gvStock, ...matches.ffStock];
    const preferred = (matches.gvMaster[0] || matches.eir[0] || matches.gvStock[0] || matches.ffStock[0] || {});
    const first = (a) => (a && a.length ? a[0] : null);
    const tags = uniq(allRows.map((r) => clean(r.tagId)).filter(Boolean));
    const barcodes = uniq(allRows.map((r) => clean(r.barcode || r.serial)).filter(Boolean));
    const vrns = uniq(allRows.map((r) => clean(r.vrn || r.regNumber)).filter(Boolean));
    const classes = uniq(allRows.map(className).filter(Boolean));
    const owners = uniq(allRows.map((r) => clean(r.agentName || r.agentId)).filter(Boolean));
    const tls = uniq(allRows.map((r) => clean(r.tlName || r.tlId)).filter(Boolean));
    const dates = allRows.map((r) => clean(r.date || r.agentAllocatedAt || r.bcAllocatedAt || r.allocatedAt)).filter(Boolean).sort((a, b) => dateRank(b) - dateRank(a));
    const rawStatuses = uniq(allRows.map((r) => clean(r.status)).filter(Boolean));
    const matchedSources = [];
    if (matches.gvMaster.length) matchedSources.push('GV Master');
    if (matches.eir.length) matchedSources.push('FF EIR');
    if (matches.gvStock.length) matchedSources.push('Tag Assignment');
    if (matches.ffStock.length) matchedSources.push('StockDataa');
    if (incompleteSources.length && code !== 'not-found') note += ' · Incomplete sources: ' + incompleteSources.join(', ');
    return {
      key: record.fields.map((f) => normId(f.value)).filter(Boolean).join('|'),
      line: record.line, inputs: record.fields.map((f) => f.kind + ': ' + f.value).join(' · '),
      inputType: record.fields.map((f) => f.kind).join(' / '),
      statusCode: code, status: label, note,
      sources: matchedSources.join(', ') || (incompleteSources.join(', ') ? 'Check incomplete' : '—'),
      vrn: vrns.join(', ') || '—', tagId: tags.join(', ') || '—', barcode: barcodes.join(', ') || '—',
      cls: classes.join(', ') || '—', agent: owners.join(', ') || '—', tl: tls.join(', ') || '—',
      date: first(dates) || '—', rawStatus: rawStatuses.join(', ') || '—',
      details, matchedCount: allRows.length, incompleteSources
    };
  }
  function makeQuery(spec, tokens) {
    const where = makeWhere(spec, tokens);
    if (!where.length) return '';
    return 'select ' + spec.cols.join(',') + ' where ' + where.join(' or ') + ' limit 5000';
  }
  function paintProgress(root, text, percent) {
    if (!root || state.root !== root) return;
    const label = root.querySelector('#bts-progress-label');
    const bar = root.querySelector('#bts-progress-fill');
    const wrap = root.querySelector('#bts-progress');
    if (label) label.textContent = text || '';
    if (bar) bar.style.width = Math.max(0, Math.min(100, Number(percent) || 0)) + '%';
    if (wrap) wrap.hidden = !text;
  }
  function showToast(message, kind) {
    if (U && U.toast) U.toast(message, kind || 'info');
  }
  async function checkStatus(root) {
    if (state.busy) return;
    const input = root.querySelector('#bts-paste');
    const parsed = parseInputText(input ? input.value : '');
    if (!parsed.records.length) { showToast('VRN / Tag ID / Barcode paste karein ya Excel upload karein.', 'warn'); return; }
    if (parsed.records.length > MAX_RECORDS) {
      showToast('Ek batch mein maximum ' + MAX_RECORDS + ' input rows check ho sakti hain. File ko chhote batches mein split karein.', 'warn');
      return;
    }
    const valid = parsed.records.filter((r) => (r.fields || []).some((f) => normId(f.value).length >= 4));
    if (!valid.length) { showToast('Koi valid identifier nahi mila. Har identifier kam se kam 4 letters/numbers ka hona chahiye.', 'warn'); return; }
    const generation = ++state.queryGeneration;
    state.busy = true; state.errors = {}; state.results = [];
    state.query = input ? input.value : '';
    state.fresh = !!(root.querySelector('#bts-fresh') || {}).checked;
    state.warnings = [];
    const checkBtn = root.querySelector('#bts-check');
    if (checkBtn) { checkBtn.disabled = true; checkBtn.textContent = '⏳ Checking…'; }
    const resultHost = root.querySelector('#bts-results');
    if (resultHost) resultHost.innerHTML = '<div class="bts-empty"><span class="bts-spin"></span><b>Status check chal raha hai…</b><small>VRN, Tag ID aur Barcode ko FF + GV sources se match kiya ja raha hai.</small></div>';
    const specs = sourceSpecs();
    const tokenList = candidateTokens(valid);
    const sourceData = { eir: [], ffStock: [], gvMaster: [], gvStock: [] };
    const signatures = { eir: new Set(), ffStock: new Set(), gvMaster: new Set(), gvStock: new Set() };
    const sourceFailures = { eir: new Set(), ffStock: new Set(), gvMaster: new Set(), gvStock: new Set() };
    const sourceFailureMessages = {};
    const batches = chunks(tokenList, QUERY_CHUNK);
    try {
      for (let bi = 0; bi < batches.length; bi++) {
        if (generation !== state.queryGeneration) return;
        const batch = batches[bi];
        const percent = Math.round((bi / Math.max(1, batches.length)) * 90);
        paintProgress(root, 'Source query ' + (bi + 1) + ' / ' + batches.length + ' · ' + batch.length + ' identifiers', percent);
        const jobs = specs.map(async (spec) => {
          const tq = makeQuery(spec, batch);
          if (!tq || !spec.cols.length || !spec.defs.length) {
            batch.forEach((t) => sourceFailures[spec.key].add(normId(t)));
            sourceFailureMessages[spec.key] = 'Column mapping missing/invalid in Settings for ' + spec.sheet;
            return { key: spec.key, error: sourceFailureMessages[spec.key] };
          }
          try {
            const table = await D.query(spec.sheet, tq, {
              gid: spec.gid,
              fresh: state.fresh
            });
            const rows = (table.rows || []).map((r) => spec.mapRow(r));
            rows.forEach((r) => {
              if (signatures[spec.key].has(r._signature)) return;
              signatures[spec.key].add(r._signature);
              sourceData[spec.key].push(r);
            });
            if (rows.length >= 5000) state.warnings.push(spec.sheet + ' result 5,000 row limit tak pahunch gaya; kuch matches truncate ho sakte hain.');
            return { key: spec.key, rows };
          } catch (err) {
            batch.forEach((t) => sourceFailures[spec.key].add(normId(t)));
            sourceFailureMessages[spec.key] = clean(err && err.message || err);
            return { key: spec.key, error: sourceFailureMessages[spec.key] };
          }
        });
        const done = await Promise.all(jobs);
        if (done.some((x) => x.error)) {
          const errs = done.filter((x) => x.error).map((x) => specs.find((s) => s.key === x.key).sheet + ': ' + x.error);
          state.warnings.push(...errs);
        }
        paintProgress(root, 'Checked batch ' + (bi + 1) + ' / ' + batches.length, Math.round(((bi + 1) / Math.max(1, batches.length)) * 90));
      }
      if (generation !== state.queryGeneration) return;
      state.results = valid.map((record) => resolveStatus(record, sourceData, sourceFailures));
      state.lastCheckedAt = new Date().toISOString();
      state.parsedCount = valid.length;
      state.errors = sourceFailureMessages;
      state.filter = 'all';
      paintProgress(root, 'Status checked · ' + valid.length + ' records', 100);
      renderResults(root);
      showToast('✅ ' + valid.length + ' identifiers ka status check ho gaya.', 'ok');
    } catch (err) {
      showToast('Status check fail: ' + clean(err && err.message || err), 'err');
    } finally {
      if (generation === state.queryGeneration) {
        state.busy = false;
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = '🔍 Check Status'; }
      }
    }
  }
  function statCardsHtml(results) {
    const r = results || [];
    const count = (pred) => r.filter(pred).length;
    const cards = [
      { label: 'Total checked', value: r.length, tone: 'blue', note: 'Input rows' },
      { label: 'GV issued', value: count((x) => x.statusCode === 'gv-issued'), tone: 'green', note: 'GV Master matches' },
      { label: 'FF issued', value: count((x) => x.statusCode === 'ff-issued'), tone: 'indigo', note: 'EIR matches' },
      { label: 'Stock', value: count((x) => ['ff-stock', 'gv-stock'].includes(x.statusCode)), tone: 'teal', note: 'Available stock' },
      { label: 'Review / Other', value: count((x) => ['multi-issued', 'multi-stock', 'incomplete', 'ff-allocated', 'gv-allocated', 'gv-status-review'].includes(x.statusCode)), tone: 'amber', note: 'Check details' },
      { label: 'Not found', value: count((x) => x.statusCode === 'not-found'), tone: 'gray', note: 'No exact match' }
    ];
    return cards.map((c) => '<div class="bts-kpi bts-' + c.tone + '"><span>' + esc(c.label) + '</span><b>' + c.value + '</b><small>' + esc(c.note) + '</small></div>').join('');
  }
  function statusBadge(r) {
    const tone = {
      'gv-issued': 'green', 'ff-issued': 'blue', 'ff-stock': 'teal', 'gv-stock': 'teal',
      'ff-allocated': 'amber', 'gv-allocated': 'amber', 'gv-status-review': 'red',
      'multi-issued': 'red', 'multi-stock': 'amber', 'incomplete': 'amber', 'not-found': 'gray'
    }[r.statusCode] || 'gray';
    return '<span class="bts-badge bts-badge-' + tone + '">' + esc(r.status) + '</span>';
  }
  function currentResults() {
    if (state.filter === 'all') return state.results;
    if (state.filter === 'stock') return state.results.filter((r) => ['ff-stock', 'gv-stock', 'ff-allocated', 'gv-allocated'].includes(r.statusCode));
    if (state.filter === 'review') return state.results.filter((r) => ['multi-issued', 'multi-stock', 'incomplete', 'gv-status-review'].includes(r.statusCode));
    return state.results.filter((r) => r.statusCode === state.filter);
  }
  function renderResults(root) {
    if (!root || state.root !== root) return;
    const stats = root.querySelector('#bts-kpis');
    if (stats) stats.innerHTML = statCardsHtml(state.results);
    const host = root.querySelector('#bts-results');
    if (!host) return;
    const results = currentResults();
    const warnings = state.warnings.length
      ? '<div class="bts-warnings"><b>⚠️ Source warning</b><ul>' + uniq(state.warnings).slice(0, 8).map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' + (state.warnings.length > 8 ? '<small>+' + (state.warnings.length - 8) + ' additional warnings</small>' : '') + '</div>'
      : '';
    const rows = results.map((r, idx) => {
      const detail = r.details.length ? r.details.map(esc).join('<br>') : '—';
      return '<tr><td class="bts-num">' + r.line + '</td><td><b>' + esc(r.inputs) + '</b><small class="bts-muted">' + esc(r.inputType) + '</small></td><td>' + statusBadge(r) + '<small class="bts-muted">' + esc(r.note) + '</small></td><td>' + esc(r.sources) + '<small class="bts-muted">' + esc(r.date) + '</small></td><td class="mono">' + esc(r.vrn) + '</td><td class="mono">' + esc(r.tagId) + '</td><td class="mono">' + esc(r.barcode) + '</td><td>' + esc(r.cls) + '</td><td>' + esc(r.agent) + '<small class="bts-muted">' + esc(r.tl) + '</small></td><td>' + esc(r.rawStatus) + '</td><td class="bts-detail">' + detail + '</td></tr>';
    }).join('');
    host.innerHTML = warnings + (results.length
      ? '<div class="bts-table-wrap"><table class="tbl bts-table"><thead><tr><th>#</th><th>Input</th><th>Status / Note</th><th>Matched source / Date</th><th>VRN</th><th>Tag ID</th><th>Barcode / Serial</th><th>Class</th><th>Agent / TL</th><th>Raw status</th><th>Matched row details</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="bts-result-foot">Showing ' + results.length + ' / ' + state.results.length + ' results · Checked ' + esc(state.lastCheckedAt ? new Date(state.lastCheckedAt).toLocaleString() : '—') + '</div>'
      : '<div class="bts-empty">Is filter mein koi result nahi hai.</div>');
    const csv = root.querySelector('#bts-export-csv');
    const xlsx = root.querySelector('#bts-export-xlsx');
    if (csv) csv.disabled = !state.results.length;
    if (xlsx) xlsx.disabled = !state.results.length;
    const filter = root.querySelector('#bts-filter');
    if (filter) filter.value = state.filter;
  }
  const EXPORT_HEADERS = ['Input','Input Type','Status','Note','Matched Sources','VRN','Tag ID','Barcode / Serial','Class','Agent','TL','Date','Raw Status','Matched Row Details'];
  function exportRows() {
    return currentResults().map((r) => [
      r.inputs, r.inputType, r.status, r.note, r.sources, r.vrn, r.tagId, r.barcode,
      r.cls, r.agent, r.tl, r.date, r.rawStatus, r.details.join(' | ')
    ]);
  }
  function downloadCsv() {
    const rows = [EXPORT_HEADERS, ...exportRows()];
    const csv = rows.map((row) => row.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'Bulk-Tag-Status.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function downloadXlsx() {
    if (!FF.xlsx || !FF.xlsx.download) { showToast('Excel export module available nahi.', 'err'); return; }
    FF.xlsx.download('Bulk-Tag-Status', [{ name: 'Status Results', header: EXPORT_HEADERS, rows: exportRows() }]);
  }
  function sampleHtml() {
    return '<div class="bts-sample"><b>Sample input</b><code>RJ14AB1234</code><code>FASTAG12345678</code><code>34161FA82032001</code><small>Ek identifier per line, ya Excel columns: VRN · Tag ID · Barcode. Header row se columns ko accurately map kiya jaata hai.</small></div>';
  }
  function render(root) {
    installStyles();
    state.root = root;
    root.innerHTML = '<div class="bts-page">'
      + '<section class="bts-hero"><div class="bts-hero-icon">🔎</div><div class="bts-hero-copy"><span class="bts-eyebrow">MANAGEMENT TOOL</span><h1>Bulk Tag Status</h1><p>Vehicle number, Tag ID ya barcode paste/upload karke pata karein ki tag <b>GV</b> se issue hua, <b>First Forward</b> se issue hua, ya stock mein hai.</p></div><div class="bts-hero-chip">FF + GV · Exact lookup</div></section>'
      + '<div class="bts-kpis" id="bts-kpis">' + statCardsHtml(state.results) + '</div>'
      + '<section class="card bts-input-card"><div class="card-head"><h3>📥 Bulk input</h3><span class="dim small">Maximum ' + MAX_RECORDS + ' input rows per check</span></div>'
      + '<div class="card-body"><div class="bts-input-grid"><div class="bts-paste-col"><label for="bts-paste"><b>Paste identifiers / Excel table</b></label><textarea id="bts-paste" class="input bts-textarea" rows="8" placeholder="RJ14AB1234&#10;TAGID12345678&#10;34161FA82032001">' + esc(state.query || '') + '</textarea><div class="bts-input-hint">One per line is easiest. Excel se copy kiya hua table bhi paste kar sakte hain; headers <b>VRN</b>, <b>Tag ID</b>, <b>Barcode</b> hon to columns identify ho jaate hain.</div></div>'
      + '<div class="bts-upload-col"><div class="bts-upload-box"><div class="bts-upload-icon">📊</div><b>Excel / CSV upload</b><span>Supported: .xlsx, .csv, .txt · first worksheet</span><label class="btn bts-upload-btn" for="bts-file">Choose file</label><input type="file" id="bts-file" accept=".xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><div id="bts-file-info" class="bts-file-info">' + esc(state.selectedFile || 'No file selected') + '</div><button type="button" class="btn small" id="bts-template">⬇ Download Excel template</button></div>' + sampleHtml() + '</div></div>'
      + '<div class="bts-controls"><label class="bts-fresh"><input type="checkbox" id="bts-fresh" ' + (state.fresh ? 'checked' : '') + '> <span><b>Fresh source check</b><small>Cache bypass · latest Google Sheet result (may take longer)</small></span></label><button type="button" class="btn primary bts-check-btn" id="bts-check"' + (state.busy ? ' disabled' : '') + '>🔍 Check Status</button><button type="button" class="btn" id="bts-clear">Clear</button></div>'
      + '<div class="bts-progress" id="bts-progress" hidden><div class="bts-progress-track"><span id="bts-progress-fill"></span></div><small id="bts-progress-label"></small></div></div></section>'
      + '<section class="card bts-results-card"><div class="card-head"><div><h3>📋 Status results</h3><p class="dim small">Issue register ko priority di jaati hai. Inventory aur issuance dono milne par match details bhi dikhengi.</p></div><div class="bts-export-actions"><select id="bts-filter" class="input bts-filter"><option value="all">All results</option><option value="gv-issued">GV issued</option><option value="ff-issued">FF issued</option><option value="stock">Stock / allocated</option><option value="review">Multiple / Review</option><option value="not-found">Not found</option><option value="incomplete">Incomplete query</option></select><button type="button" class="btn small" id="bts-export-csv" disabled>⬇ CSV</button><button type="button" class="btn small" id="bts-export-xlsx" disabled>⬇ Excel</button></div></div><div class="card-body" id="bts-results">' + (state.results.length ? '' : '<div class="bts-empty"><span class="bts-empty-icon">🔍</span><b>No status check yet</b><small>Paste values or upload an Excel file, then press Check Status.</small></div>') + '</div></section>'
      + '<div class="bts-footnote">Data sources: <b>EIR</b> (FF issuance), <b>StockDataa</b> (FF inventory), <b>GV Master</b> (GV issuance), <b>Tag Assignment</b> (GV inventory). “Not found” tabhi dikhega jab sab source queries successful hon.</div>'
      + '</div>';
    bind(root);
    renderResults(root);
  }
  function bind(root) {
    const check = root.querySelector('#bts-check');
    if (check) check.addEventListener('click', () => checkStatus(root));
    const paste = root.querySelector('#bts-paste');
    if (paste) paste.addEventListener('input', () => { state.query = paste.value; });
    const filter = root.querySelector('#bts-filter');
    if (filter) filter.addEventListener('change', () => { state.filter = filter.value || 'all'; renderResults(root); });
    const fresh = root.querySelector('#bts-fresh');
    if (fresh) fresh.addEventListener('change', () => { state.fresh = !!fresh.checked; });
    const clear = root.querySelector('#bts-clear');
    if (clear) clear.addEventListener('click', () => {
      state.queryGeneration++; state.busy = false; state.query = ''; state.results = []; state.warnings = []; state.errors = {}; state.selectedFile = ''; state.filter = 'all';
      if (paste) paste.value = '';
      const file = root.querySelector('#bts-file'); if (file) file.value = '';
      const info = root.querySelector('#bts-file-info'); if (info) info.textContent = 'No file selected';
      const checkBtn = root.querySelector('#bts-check'); if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = '🔍 Check Status'; }
      paintProgress(root, '', 0); renderResults(root);
    });
    const file = root.querySelector('#bts-file');
    if (file) file.addEventListener('change', async () => {
      const selected = file.files && file.files[0];
      if (!selected) return;
      const info = root.querySelector('#bts-file-info');
      if (info) info.textContent = 'Reading ' + selected.name + '…';
      try {
        let matrix;
        const name = selected.name.toLowerCase();
        if (selected.size > MAX_UPLOAD_BYTES) throw new Error('File 12 MB se badi hai. Chhoti file upload karein.');
        if (name.endsWith('.xlsx')) matrix = await readXlsxMatrix(selected);
        else {
          const text = await selected.text();
          matrix = parseDelimited(text, detectDelimiter(text));
        }
        if (!matrix.length) throw new Error('File mein data nahi mila.');
        if (matrix.length > 5001) throw new Error('5,000 se zyada rows hain. Chhote batches mein split karein.');
        const tsv = matrixToTsv(matrix);
        if (paste) { paste.value = tsv; state.query = tsv; }
        state.selectedFile = selected.name;
        if (info) info.textContent = selected.name + ' · ' + Math.max(0, matrix.length - 1) + ' data rows loaded';
        showToast('📄 File read ho gayi. Preview check karke Check Status dabayein.', 'ok');
      } catch (err) {
        if (info) info.textContent = 'Upload error';
        showToast('Excel upload fail: ' + clean(err && err.message || err), 'err');
      }
    });
    const template = root.querySelector('#bts-template');
    if (template) template.addEventListener('click', () => {
      if (FF.xlsx && FF.xlsx.download) FF.xlsx.download('Bulk-Tag-Status-Template', [{ name: 'Input', header: ['VRN', 'Tag ID', 'Barcode'], rows: [['RJ14AB1234', 'TAGID12345678', '34161FA82032001']] }]);
      else showToast('Excel template module available nahi.', 'err');
    });
    const csv = root.querySelector('#bts-export-csv');
    if (csv) csv.addEventListener('click', downloadCsv);
    const xlsx = root.querySelector('#bts-export-xlsx');
    if (xlsx) xlsx.addEventListener('click', downloadXlsx);
  }

  function installStyles() {
    if (document.getElementById('bts-style')) return;
    const style = document.createElement('style');
    style.id = 'bts-style';
    style.textContent = [
      '.bts-page{display:grid;gap:16px;min-width:0;color:var(--ink,#172033)}',
      '.bts-hero{display:flex;align-items:center;gap:16px;padding:22px 24px;border:1px solid var(--line,#dce2ee);border-radius:22px;background:linear-gradient(125deg,#eef2ff 0%,#f8fbff 52%,#ecfeff 100%);box-shadow:0 12px 32px rgba(30,41,59,.06);min-width:0}',
      '.bts-hero-icon{width:58px;height:58px;flex:0 0 58px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(140deg,#4338ca,#0f766e);color:#fff;font-size:30px;box-shadow:0 8px 20px rgba(67,56,202,.2)}',
      '.bts-hero-copy{min-width:0;flex:1}.bts-eyebrow{font-size:11px;font-weight:900;letter-spacing:.14em;color:#4f46e5}.bts-hero h1{margin:3px 0 5px;font-size:clamp(23px,2.2vw,31px);letter-spacing:-.03em}.bts-hero p{margin:0;line-height:1.55;color:#46536b;max-width:820px}',
      '.bts-hero-chip{border:1px solid #c7d2fe;background:rgba(255,255,255,.75);padding:9px 12px;border-radius:999px;font-size:12px;font-weight:800;color:#3730a3;white-space:nowrap}',
      '.bts-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.bts-kpi{min-width:0;padding:14px 15px;border:1px solid var(--line,#e2e8f0);border-radius:16px;background:var(--card,#fff);display:grid;gap:5px}.bts-kpi span{font-size:12px;font-weight:800;color:var(--muted,#64748b)}.bts-kpi b{font-size:27px;line-height:1.1;letter-spacing:-.04em;color:#172033;font-variant-numeric:tabular-nums}.bts-kpi small{font-size:11px;color:var(--muted,#64748b)}',
      '.bts-blue{border-top:3px solid #2563eb}.bts-green{border-top:3px solid #16a34a}.bts-indigo{border-top:3px solid #6366f1}.bts-teal{border-top:3px solid #0d9488}.bts-amber{border-top:3px solid #d97706}.bts-gray{border-top:3px solid #94a3b8}',
      '.bts-input-card .card-body,.bts-results-card .card-body{padding:18px}.bts-input-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(270px,1fr);gap:18px}.bts-paste-col,.bts-upload-col{min-width:0;display:grid;align-content:start;gap:8px}.bts-paste-col label{font-size:14px}.bts-textarea{width:100%;min-height:190px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;line-height:1.65;white-space:pre;overflow:auto;border-radius:13px;padding:13px}.bts-input-hint{font-size:12px;color:var(--muted,#64748b);line-height:1.5}',
      '.bts-upload-box{display:grid;justify-items:center;text-align:center;gap:8px;border:1.5px dashed #a5b4fc;background:#f8faff;border-radius:16px;padding:18px 14px}.bts-upload-icon{font-size:30px}.bts-upload-box>b{font-size:15px}.bts-upload-box>span{font-size:12px;color:#64748b}.bts-upload-btn{cursor:pointer;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe}.bts-upload-box input[type=file]{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.bts-file-info{font-size:12px;color:#475569;max-width:100%;overflow-wrap:anywhere}.bts-sample{display:grid;gap:5px;padding:11px 12px;border:1px solid var(--line,#e2e8f0);border-radius:13px;background:var(--soft,#f8fafc)}.bts-sample b{font-size:12px}.bts-sample code{font-size:12px;color:#3730a3}.bts-sample small{font-size:11px;line-height:1.45;color:#64748b}',
      '.bts-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--line,#e2e8f0)}.bts-fresh{display:flex;align-items:flex-start;gap:8px;flex:1;min-width:240px;font-size:12px}.bts-fresh input{margin-top:3px}.bts-fresh span{display:grid;gap:3px}.bts-fresh small{color:var(--muted,#64748b);font-weight:400}.bts-check-btn{min-width:155px;min-height:42px}.bts-progress{margin-top:15px;display:grid;gap:7px}.bts-progress[hidden]{display:none}.bts-progress-track{height:7px;border-radius:999px;background:#e2e8f0;overflow:hidden}.bts-progress-track span{display:block;width:0;height:100%;background:linear-gradient(90deg,#4f46e5,#0d9488);transition:width .2s}.bts-progress small{font-size:12px;color:#64748b}',
      '.bts-export-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.bts-filter{width:auto;min-width:148px}.bts-table-wrap{width:100%;overflow:auto;border:1px solid var(--line,#e2e8f0);border-radius:12px;max-height:70vh}.bts-table{min-width:1450px;margin:0}.bts-table th{position:sticky;top:0;z-index:2;white-space:nowrap;background:var(--table-head,#f1f5f9)}.bts-table td{vertical-align:top;max-width:270px;overflow-wrap:anywhere}.bts-table td small{display:block;line-height:1.4}.bts-table .bts-num{color:#64748b;font-variant-numeric:tabular-nums}.bts-table .bts-detail{min-width:260px;font-size:11px;line-height:1.55}.bts-muted{font-size:11px!important;color:var(--muted,#64748b);margin-top:4px}.bts-badge{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;font-size:11px;line-height:1.25;font-weight:900;white-space:normal;max-width:200px}.bts-badge-green{background:#dcfce7;color:#166534}.bts-badge-blue{background:#dbeafe;color:#1d4ed8}.bts-badge-teal{background:#ccfbf1;color:#115e59}.bts-badge-amber{background:#fef3c7;color:#92400e}.bts-badge-red{background:#fee2e2;color:#991b1b}.bts-badge-gray{background:#e2e8f0;color:#334155}.bts-empty{min-height:155px;display:grid;place-content:center;justify-items:center;text-align:center;gap:8px;color:#64748b;padding:20px}.bts-empty b{color:var(--ink,#172033);font-size:15px}.bts-empty small{max-width:440px;line-height:1.5}.bts-empty-icon{font-size:30px}.bts-spin{width:24px;height:24px;border:3px solid #c7d2fe;border-top-color:#4f46e5;border-radius:50%;animation:bts-spin 1s linear infinite}@keyframes bts-spin{to{transform:rotate(360deg)}}',
      '.bts-warnings{padding:11px 13px;margin-bottom:12px;border-radius:12px;border:1px solid #fcd34d;background:#fffbeb;color:#854d0e;font-size:12px}.bts-warnings ul{margin:7px 0 0;padding-left:19px}.bts-warnings li{margin:3px 0}.bts-result-foot,.bts-footnote{font-size:12px;color:var(--muted,#64748b);line-height:1.55;padding:8px 2px}.bts-footnote{padding:0 4px}.bts-results-card .card-head{gap:12px;flex-wrap:wrap}',
      '@media(max-width:1100px){.bts-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.bts-input-grid{grid-template-columns:minmax(0,1fr) minmax(240px,.8fr)}}',
      '@media(max-width:700px){.bts-hero{align-items:flex-start;flex-wrap:wrap;padding:17px;border-radius:17px}.bts-hero-icon{width:46px;height:46px;flex-basis:46px;font-size:24px}.bts-hero-copy{flex-basis:calc(100% - 70px)}.bts-hero-chip{margin-left:61px}.bts-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.bts-kpi{padding:11px}.bts-kpi b{font-size:23px}.bts-input-grid{grid-template-columns:minmax(0,1fr)}.bts-controls{align-items:stretch}.bts-fresh{flex-basis:100%}.bts-check-btn,.bts-controls>.btn{flex:1}.bts-export-actions{width:100%}.bts-filter{flex:1;min-width:120px}.bts-table-wrap{max-height:65vh}.bts-input-card .card-body,.bts-results-card .card-body{padding:12px}}',
      '@media(prefers-reduced-motion:reduce){.bts-progress-track span,.bts-spin{animation:none;transition:none}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  FF.pages = FF.pages || {};
  FF.pages.bulkTagStatus = { title: PAGE_TITLE, render };
  FF.bulkTagStatus = {
    normalizeId: normId, parseInputText, parseDelimited, matrixToRecords,
    resolveStatus,
    get maxRecords() { return MAX_RECORDS; },
    get state() { return state; },
    _test: { normId, headerKind, parseInputText, matrixToRecords, resolveStatus, stockOwner, hasOutStatus, restoreFormattedIdentifier }
  };
})(window.FF);
