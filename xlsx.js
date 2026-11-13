/* Minimal .xlsx writer (no dependencies): multiple sheets, numbers + strings, bold header row, column widths.
   FF.xlsx.download('file.xlsx', [{ name: 'Summary', header: [...], rows: [[...]] }, ...]) */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;

  // ---- CRC32 (for the zip) ----
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  const enc = new TextEncoder();

  /** Build a ZIP (store method) from [{ name, data: Uint8Array }]. */
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---- XLSX ----
  const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  function colName(i) { return U.colLetter(i); }
  /** Excel serial number (days since 1899-12-30) + time as fraction — real date cells, not text. */
  function excelSerial(d) {
    const base = Date.UTC(1899, 11, 30);
    return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - base) / 86400000
      + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
  }
  const hasTime = (d) => !!(d.getHours() || d.getMinutes() || d.getSeconds());
  function cellXml(value, r, c, style) {
    const ref = `${colName(c)}${r}`;
    if (value === null || value === undefined || value === '') return '';
    if (value instanceof Date && !isNaN(value)) return `<c r="${ref}" s="${hasTime(value) ? 3 : 2}"><v>${excelSerial(value).toFixed(6)}</v></c>`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
    if (typeof value === 'boolean') return `<c r="${ref}" t="b"${style ? ` s="${style}"` : ''}><v>${value ? 1 : 0}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
  }
  /* 🎨 v3.125.98 — optional named styles (sheet.styleOf(rowIdx, colIdx, value) / sheet.headStyleOf(colIdx) → name).
     Ids 0-3 built-in (normal, header, date, datetime). Fill colours ARGB. */
  const FILL = ['FFFEF3C7', 'FFDCFCE7', 'FFEFF6FF', 'FFFDF2F8', 'FFE5E7EB', 'FF1F2937', 'FF0F766E', 'FFB45309', 'FFF3F4F6', 'FF1D4ED8', 'FFECFDF5', 'FFFEF2F2', 'FFF5F3FF', 'FFF8FAFC', 'FF7C3AED', 'FFEDE9FE', 'FFEA580C', 'FFFFEDD5', 'FFE0E7FF', 'FFDC2626', 'FF16A34A', 'FF2563EB', 'FF0D9488', 'FF475569', 'FFD97706'];
  const FILLID = (argb) => 3 + FILL.indexOf(argb);   // 0 none, 1 gray125, 2 header indigo
  // fonts: 0 normal, 1 bold white, 2 bold, 3 bold green, 4 bold red, 5 gray, 6 bold dark
  const NAMED = {
    num:        { font: 0, fill: 0, fmt: 3 },
    total:      { font: 2, fill: FILLID('FFFEF3C7'), fmt: 3 },     // Total column — amber tint
    monTotal:   { font: 6, fill: FILLID('FFDCFCE7'), fmt: 3 },     // month Total — green tint
    monA:       { font: 0, fill: FILLID('FFEFF6FF'), fmt: 3 },     // month class cols (alternate tints)
    monB:       { font: 0, fill: FILLID('FFFDF2F8'), fmt: 3 },
    rowTotal:   { font: 2, fill: FILLID('FFE5E7EB'), fmt: 3 },
    rowGrand:   { font: 1, fill: FILLID('FF1F2937'), fmt: 3 },
    up:         { font: 3, fill: FILLID('FFECFDF5'), fmt: 0 },
    down:       { font: 4, fill: FILLID('FFFEF2F2'), fmt: 0 },
    flat:       { font: 5, fill: 0, fmt: 0 },
    pct:        { font: 0, fill: 0, fmt: 0 },
    prev:       { font: 5, fill: FILLID('FFF3F4F6'), fmt: 3 },
    hMonth:     { font: 1, fill: FILLID('FF0F766E'), fmt: 0 },
    hTotal:     { font: 1, fill: FILLID('FFB45309'), fmt: 0 },
    hPerf:      { font: 1, fill: FILLID('FF1D4ED8'), fmt: 0 },
    hPrev:      { font: 1, fill: FILLID('FF1F2937'), fmt: 0 },
    label:      { font: 2, fill: FILLID('FFF5F3FF'), fmt: 0 },
    zeb:        { font: 0, fill: FILLID('FFF8FAFC'), fmt: 0 },     // zebra (har doosri row)
    zebNum:     { font: 0, fill: FILLID('FFF8FAFC'), fmt: 3 },
    cls:        { font: 0, fill: FILLID('FFEDE9FE'), fmt: 3 },     // class columns (VC4, VC20 …)
    hCls:       { font: 1, fill: FILLID('FF7C3AED'), fmt: 0 },
    hAge:       { font: 1, fill: FILLID('FFEA580C'), fmt: 0 },
    age:        { font: 0, fill: FILLID('FFFFEDD5'), fmt: 3 },
    section:    { font: 2, fill: FILLID('FFE0E7FF'), fmt: 0 },      // Summary ke "🟦 First Forward · Agent" jaise section rows
    // 💰 v3.125.239 — payout Excel (APN format, rangeen)
    hRed:   { font: 1, fill: FILLID('FFDC2626'), fmt: 0 }, hGreen: { font: 1, fill: FILLID('FF16A34A'), fmt: 0 }, hBlue: { font: 1, fill: FILLID('FF2563EB'), fmt: 0 },
    hTeal:  { font: 1, fill: FILLID('FF0D9488'), fmt: 0 }, hSlate: { font: 1, fill: FILLID('FF475569'), fmt: 0 }, hAmber: { font: 1, fill: FILLID('FFD97706'), fmt: 0 }, hPurple: { font: 1, fill: FILLID('FF7C3AED'), fmt: 0 },
    amt:    { font: 0, fill: 0, fmt: 4 }, zebAmt: { font: 0, fill: FILLID('FFF8FAFC'), fmt: 4 }, totAmt: { font: 2, fill: FILLID('FFE5E7EB'), fmt: 4 },
    inact:  { font: 4, fill: FILLID('FFFEF2F2'), fmt: 0 }, inactNum: { font: 4, fill: FILLID('FFFEF2F2'), fmt: 3 }, inactAmt: { font: 4, fill: FILLID('FFFEF2F2'), fmt: 4 },
    newSt: { font: 7, fill: 0, fmt: 0 }, pUp: { font: 3, fill: FILLID('FFECFDF5'), fmt: 10 }, pDown: { font: 4, fill: FILLID('FFFEF2F2'), fmt: 10 }, pFlat: { font: 5, fill: 0, fmt: 10 }, curRow: { font: 2, fill: FILLID('FFE0E7FF'), fmt: 0 }, curNum: { font: 2, fill: FILLID('FFE0E7FF'), fmt: 3 }, zebNew: { font: 7, fill: FILLID('FFF8FAFC'), fmt: 0 },
    gAmt:   { font: 3, fill: FILLID('FFECFDF5'), fmt: 4 }, rAmt: { font: 4, fill: FILLID('FFFEF2F2'), fmt: 4 }, pAmt: { font: 6, fill: FILLID('FFEDE9FE'), fmt: 4 }
  };
  /* 🎨 v3.125.116 — har download rangeen: jis sheet ne apne styles nahi diye unhe auto-style
     (header colour column ke type se, TOTAL / GRAND TOTAL rows, Total column, class columns, % / growth ▲▼, zebra rows). */
  const RX_CLS = /^(vc ?\d+|vc5\+|vc ?20\+?|vc4)$/i;
  const RX_TOT = /^(total|grand total|kul|sum)\b|\btotal$/i;
  const RX_PCT = /(%|growth|change|vs |perf|diff)/i;
  const RX_PREV = /^(prev|last|pichhl)/i;
 const RX_AGE = /^age\b|ageing|mahin|months? ?\+|^date nahi/i;
  const RX_CLSV = /^(class|tag class|vc type|vehicle class|cls)$/i;
  const RX_ID = /(\bid\b|mobile|phone|barcode|serial|pincode|\bpin\b|\bcode\b|tag ?id|vrn|chassis no|\bno\.?$|number|rank|year|^#$|^s\.? ?no)/i;
  function autoStyle(sheet) {
    if (!sheet || sheet.plain || typeof sheet.styleOf === 'function' || typeof sheet.headStyleOf === 'function') return sheet;
    const H = (sheet.header || []).map((h) => String(h == null ? '' : h).trim());
    if (!H.length) return sheet;
    const kind = H.map((h) => (RX_ID.test(h) ? 'id' : RX_CLSV.test(h) ? 'cls' : RX_AGE.test(h) ? 'age' : RX_CLS.test(h) ? 'cls' : RX_TOT.test(h) ? 'tot' : RX_PCT.test(h) ? 'pct' : RX_PREV.test(h) ? 'prev' : ''));
    const labelOf = (row) => row.slice(0, 4).map((v) => String(v == null ? '' : v)).join(' ');
    sheet.headStyleOf = (c) => ({ cls: 'hCls', tot: 'hTotal', pct: 'hPerf', prev: 'hPrev', age: 'hAge' }[kind[c]] || '');
    sheet.styleOf = (ri, c, v) => {
      const row = sheet.rows[ri] || [];
      const lab = labelOf(row);
      if (/GRAND TOTAL/i.test(lab)) return 'rowGrand';
      if (/(^|\s)(TOTAL|Total|SUBTOTAL|Kul)(\b|\s|·|:)/.test(lab)) return 'rowTotal';
      if (/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(String(row[0] || '')) && row.filter((x) => x !== '' && x != null).length <= 2) return 'section';
      const k = kind[c];
      if (k === 'pct') { const n = typeof v === 'number' ? v : parseFloat(String(v || '').replace(/[^\d.-]/g, '')); if (/▲|up/i.test(String(v))) return 'up'; if (/▼|down/i.test(String(v))) return 'down'; if (Number.isFinite(n) && v !== '') return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'; return ''; }
      if (k === 'tot') return 'total';
      if (k === 'cls') return 'cls';
      if (k === 'age') return 'age';
      if (k === 'prev') return 'prev';
      const z = ri % 2 === 1;
      if (k === 'id') return z ? 'zeb' : '';   // IDs / mobile / barcode par 1,234 wala comma nahi
      return typeof v === 'number' ? (z ? 'zebNum' : 'num') : (z ? 'zeb' : '');
    };
    return sheet;
  }
  const NAMED_KEYS = Object.keys(NAMED);
  const styleId = (name) => { const i = NAMED_KEYS.indexOf(name); return i < 0 ? 0 : 4 + i; };
  function sheetXml(sheet) {
    const header = sheet.header || [];
    const rows = sheet.rows || [];
    const cellLen = (v) => (v instanceof Date ? (hasTime(v) ? 16 : 10) : String(v).length);
    const widths = header.map((hd, i) => { let w = String(hd).length; for (let r = 0; r < Math.min(rows.length, 300); r++) { const v = rows[r][i]; if (v !== null && v !== undefined) w = Math.max(w, cellLen(v)); } return Math.min(48, Math.max(8, w + 2)); });
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    let body = '';
    let r = 1;
    const hs = typeof sheet.headStyleOf === 'function' ? sheet.headStyleOf : null;
    const cs = typeof sheet.styleOf === 'function' ? sheet.styleOf : null;
    if (header.length) { body += `<row r="${r}">${header.map((v, c) => cellXml(v, r, c, (hs && hs(c, v)) ? styleId(hs(c, v)) : 1)).join('')}</row>`; r++; }
    rows.forEach((row, ri) => {
      // styled rows: khaali cells bhi fill ho (total row poori rangeen dikhe)
      body += `<row r="${r}">${row.map((v, c) => { const st = cs ? cs(ri, c, v) : ''; const id = st ? styleId(st) : 0; if (id && (v === "" || v === null || v === undefined) && /^(row|inact|tot)/.test(st)) return `<c r="${colName(c)}${r}" s="${id}"/>`; return cellXml(v, r, c, id); }).join('')}</row>`;
      r++;
    });
    const lastCol = colName(Math.max(0, header.length - 1));
    const dim = `A1:${lastCol}${Math.max(1, r - 1)}`;
    // filterRows: limit the header auto-filter to the first N rows (e.g. pivot only, excluding
    // the Report/Scope/Generated meta rows appended below). Defaults to the whole sheet.
    const filterEnd = header.length ? Math.max(2, Math.min(Number(sheet.filterRows) || r - 1, r - 1)) : 0;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0"${header.length ? '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>' : '/>'}</sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData>${filterEnd ? `<autoFilter ref="A1:${lastCol}${filterEnd}"/>` : ''}</worksheet>`;
  }
  const safeName = (n, i) => (String(n || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`);

  function stylesXml() {
    const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>', '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
      '<font><b/><sz val="11"/><name val="Calibri"/></font>', '<font><b/><sz val="11"/><color rgb="FF15803D"/><name val="Calibri"/></font>',
      '<font><b/><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/></font>', '<font><sz val="11"/><color rgb="FF6B7280"/><name val="Calibri"/></font>',
      '<font><b/><sz val="11"/><color rgb="FF14532D"/><name val="Calibri"/></font>', '<font><b/><sz val="11"/><color rgb="FF1D4ED8"/><name val="Calibri"/></font>'];
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill>',
      ...FILL.map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`)];
    const xf = (font, fill, fmt) => `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${fill > 2 ? 1 : 0}" xfId="0"${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${fmt ? ' applyNumberFormat="1"' : ''}${fill > 2 ? ' applyBorder="1"' : ''}/>`;
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>', '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
      ...NAMED_KEYS.map((k) => xf(NAMED[k].font, NAMED[k].fill, NAMED[k].fmt))];
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\/mm\\/yyyy"/><numFmt numFmtId="165" formatCode="dd\\/mm\\/yyyy\\ hh:mm"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE5E7EB"/></left><right style="thin"><color rgb="FFE5E7EB"/></right><top style="thin"><color rgb="FFE5E7EB"/></top><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
  /** sheets: [{ name, header: [], rows: [[]] }] */
  function build(sheets) {
    (sheets || []).forEach(autoStyle);
    const names = []; sheets.forEach((s, i) => { let n = safeName(s.name, i); let k = 2; while (names.includes(n)) n = `${n.slice(0, 28)} ${k++}`; names.push(n); });
    const files = [
      { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
      { name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
      { name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
      { name: 'xl/styles.xml', data: enc.encode(stylesXml()) }
    ];
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) }));
    return zip(files);
  }
  function download(filename, sheets) { U.downloadBlob(filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`, build(sheets)); }

  FF.xlsx = { build, download, zip };
})(window.FF);
