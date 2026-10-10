/* FASTag Mapping — StockDataa lookup + secure server-side mapping API + CSV export. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, D = FF.data;
  const API_STATUS = '/api/fastag-mapping/status';
  const API_MAP = '/api/fastag-mapping/map';
  const MAX_INPUTS = 2500;
  let nextId = 1;
  const state = { items: [], rows: [], configured: false, busy: false, root: null };
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
    barcode: ['barcode', 'serialno', 'serialnumber', 'serial', 'barcodeid'],
    tagId: ['tagid', 'tag', 'tagnumber', 'fastagid'],
    agentId: ['agentid', 'agentcode', 'employeeid', 'mappedagentid', 'newagentid']
  };
  function headerMap(header) {
    const h = header.map(norm), found = {};
    for (const key of Object.keys(ALIASES)) { const idx = h.findIndex((v) => ALIASES[key].includes(v)); if (idx >= 0) found[key] = idx; }
    return found;
  }
  function parsedItems(matrix, filename) {
    if (!matrix.length) return [];
    const hm = headerMap(matrix[0]), hasHeader = Object.keys(hm).length > 0, rows = hasHeader ? matrix.slice(1) : matrix, out = [];
    for (const r of rows) {
      const get = (k, fallback) => hm[k] !== undefined ? clean(r[hm[k]]) : (fallback === undefined ? '' : clean(r[fallback]));
      const first = get('first'), last = get('last'), tagId = get('tagId', hasHeader ? undefined : -1), barcode = get('barcode', hasHeader ? undefined : 0), agentId = get('agentId', hasHeader ? undefined : 1);
      if (first && last) out.push({ id: nextId++, type: 'range', first, last, agentId, source: filename || 'Upload', selected: true });
      else if (tagId || barcode) out.push({ id: nextId++, type: tagId ? 'tagId' : 'barcode', tagId, barcode, agentId, source: filename || 'Upload', selected: true });
    }
    return out;
  }
  function isDigitKey(v) { return /^\d+$/.test(clean(v)); }
  function literal(v, numeric) {
    const s = clean(v);
    if (numeric && isDigitKey(s) && !(s.length > 1 && s[0] === '0')) return s;
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  function stockRows(table) {
    return D.textRows(table).map((r) => ({
      stockRowId: clean(r[0]), inventoryName: clean(r[1]), tagId: clean(r[2]), barcode: clean(r[3]), serialNo: clean(r[3]),
      vcType: clean(r[4]), tagType: clean(r[5]), barcodeAllocatedAt: clean(r[6]), stockAgentId: clean(r[7]), stockAgentName: clean(r[8]),
      agentAllocatedAt: clean(r[9]), tlName: clean(r[10])
    })).filter((r) => r.tagId || r.barcode);
  }
  async function queryField(field, values, numeric) {
    const unique = [...new Set(values.map(clean).filter(Boolean))]; if (!unique.length) return [];
    const found = new Map();
    for (let i = 0; i < unique.length; i += 20) {
      const batch = unique.slice(i, i + 20), make = (num) => 'select A,B,C,D,E,F,G,H,I,J,K where ' + batch.map((x) => field + ' = ' + literal(x, num)).join(' or ');
      let table;
      try { table = await D.query('StockDataa', make(!!numeric), { timeoutMs: 40000 }); }
      catch (firstError) {
        try { table = await D.query('StockDataa', make(!numeric), { timeoutMs: 40000, retries: 0 }); }
        catch (secondError) { throw new Error('StockDataa lookup failed: ' + (secondError.message || firstError.message)); }
      }
      stockRows(table).forEach((r) => { const k = r.tagId + '|' + r.barcode; if (!found.has(k)) found.set(k, r); });
    }
    return [...found.values()];
  }
  async function queryRange(from, to) {
    const c = cols(), numeric = isDigitKey(from) && isDigitKey(to);
    const make = (num) => 'select A,B,C,D,E,F,G,H,I,J,K where ' + c.barcode + ' >= ' + literal(from, num) + ' and ' + c.barcode + ' <= ' + literal(to, num);
    let table;
    try { table = await D.query('StockDataa', make(numeric), { timeoutMs: 50000 }); }
    catch (firstError) { try { table = await D.query('StockDataa', make(!numeric), { timeoutMs: 50000, retries: 0 }); } catch (secondError) { throw new Error('Barcode range query failed: ' + (secondError.message || firstError.message)); } }
    return stockRows(table);
  }
  function addResult(item, stock, matchedBy) {
    const row = Object.assign({ id: nextId++, source: item.source || 'Manual', request: item.type === 'range' ? item.first + ' – ' + item.last : (item.tagId || item.barcode || ''),
      agentId: clean(item.agentId) || (stock && stock.stockAgentId) || '', stock: stock || {}, matchedBy: matchedBy || '', selected: true, mapped: false, apiStatus: '', message: '',
      status: stock ? 'Ready to review' : 'Not found in StockDataa' }, stock || {});
    row.stock = stock || {}; row.agentId = clean(item.agentId) || (stock && stock.stockAgentId) || '';
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
    const waiting = state.items.splice(0);
    if (!waiting.length) { setStatus('Pehle file upload karein ya barcode / Tag ID add karein.', 'warn'); return; }
    if (waiting.length > MAX_INPUTS) { state.items.unshift.apply(state.items, waiting); setStatus('Ek baar me maximum ' + MAX_INPUTS + ' input selectors allowed hain.', 'warn'); return; }
    state.busy = true; setStatus('StockDataa se matching details lookup ho rahi hain…', 'info');
    const old = U.$('#fm-lookup', state.root), mapBtn = U.$('#fm-map', state.root); if (old) old.disabled = true; if (mapBtn) mapBtn.disabled = true;
    try {
      const barcodes = waiting.flatMap((x) => x.type === 'range' ? [] : [x.barcode].filter(Boolean));
      const tagIds = waiting.flatMap((x) => x.tagId ? [x.tagId] : []);
      const found = await Promise.all([queryField(cols().barcode, barcodes, true), queryField(cols().tagId, tagIds, false)]);
      const byBarcode = found[0], byTag = found[1];
      for (const item of waiting.filter((x) => x.type === 'range')) { try { item._rangeRows = await queryRange(item.first, item.last); } catch (err) { item._lookupError = err.message || String(err); } }
      for (const item of waiting) {
        if (item._lookupError) { state.rows.push({ id: nextId++, source: item.source, request: item.first + ' – ' + item.last, selected: false, status: 'Lookup error', message: item._lookupError, stock: {}, agentId: '' }); continue; }
        let candidates = [];
        if (item.type === 'range') {
          if (clean(item.first) > clean(item.last)) { state.rows.push({ id: nextId++, source: item.source, request: item.first + ' – ' + item.last, selected: false, status: 'Invalid barcode range', message: 'First barcode last se bada hai.', stock: {}, agentId: '' }); continue; }
          candidates = (item._rangeRows || []).filter((r) => clean(r.barcode) >= clean(item.first) && clean(r.barcode) <= clean(item.last));
        } else if (item.tagId) candidates = byTag.filter((r) => r.tagId === item.tagId);
        else if (item.barcode) candidates = byBarcode.filter((r) => r.barcode === item.barcode);
        if (item.tagId && item.barcode) candidates = candidates.filter((r) => r.barcode === item.barcode);
        if (!candidates.length) { addResult(item, null, item.type); continue; }
        for (const stock of candidates) addResult(item, stock, item.type === 'range' ? 'Barcode range' : (item.tagId ? 'Tag ID' : 'Barcode'));
      }
      checkDuplicates(); renderTable();
      const good = state.rows.filter((r) => r.stock && r.tagId && r.serialNo && r.vcType && r.agentId && !r.status.startsWith('Duplicate') && !r.mapped).length;
      setStatus('Lookup complete: ' + good + ' row ready. Mapping se pehle Agent ID aur VC type review karein.', good ? 'success' : 'warn');
    } catch (err) { setStatus('Lookup fail: ' + (err.message || err), 'error'); }
    finally { state.busy = false; if (old) old.disabled = false; if (mapBtn) mapBtn.disabled = false; }
  }
  async function quickMap() {
    if (state.busy) return;
    const value = clean(U.$('#fm-identifier', state.root).value);
    const kind = U.$('#fm-kind', state.root).value;
    const agentId = clean(U.$('#fm-agent-id', state.root).value);
    if (!value) { setStatus('Barcode ya Tag ID required hai.', 'warn'); return; }
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
        const res = await fetch(API_MAP, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FF-Dashboard' }, body: JSON.stringify({ rows: batch.map((r) => ({ tagId: r.tagId, serialNo: r.serialNo, vcType: r.vcType, agentId: r.agentId })) }) });
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
    finally { state.busy = false; if (mapBtn) mapBtn.disabled = false; renderTable(); }
  }
  function downloadCsv() {
    const headers = ['Request','Source','StockDataa Row ID','Inventory Name','Barcode','Tag ID','Serial No','VC Type','Tag Type','Barcode Allocated At','Stock Agent ID','Agent ID Mapped','Agent Name','TL Name','Agent Allocated At','Matched By','Selected','API Status','Message'];
    const rows = state.rows.map((r) => [r.request || '',r.source || '',r.stockRowId || '',r.inventoryName || '',r.barcode || '',r.tagId || '',r.serialNo || '',r.vcType || '',r.tagType || '',r.barcodeAllocatedAt || '',r.stockAgentId || '',r.agentId || '',r.stockAgentName || '',r.tlName || '',r.agentAllocatedAt || '',r.matchedBy || '',r.selected ? 'YES' : 'NO',r.apiStatus || r.status || '',r.message || '']);
    if (U.downloadCsv) U.downloadCsv('fastag-mapping-' + U.stamp() + '.csv', headers, rows);
    else { const text = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'fastag-mapping-' + Date.now() + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function templateCsv() {
    const headers = ['firstBarcode','lastBarcode','barcode','tagId','serialNo','agentId'];
    const rows = [['8900000000000001','8900000000000010','','','','TARGET_AGENT_ID'],['','','8900000000000025','','','TARGET_AGENT_ID'],['','','','TAG_ID_HERE','','TARGET_AGENT_ID'],['','','','','SERIAL_OR_BARCODE','TARGET_AGENT_ID']];
    const text = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'fastag-mapping-template.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function render(root) {
    state.root = root;
    root.innerHTML = '<div class="page-head"><div><h1>🧭 FASTag Mapping</h1><p class="sub">GV Partner · StockDataa se Tag ID, Serial/Barcode, VC Type aur Agent details fetch karke securely map karein.</p></div><div class="head-actions"><span id="fm-api-status" class="badge amber">Mapping API status checking…</span></div></div>' +
      '<div class="grid g-2"><section class="card"><div class="card-head"><h3>📂 Upload mapping file</h3><button class="btn small" id="fm-template">⬇ CSV template</button></div><div class="card-body"><p class="dim small">CSV, TSV, TXT ya Excel .xlsx file upload karein. Header names firstBarcode, lastBarcode, barcode, tagId, serialNo, agentId ho sakte hain. First + last barcode dene par range expand hogi.</p><input class="input" id="fm-file" type="file" accept=".csv,.tsv,.txt,.xlsx"><div id="fm-file-note" class="dim small">No file selected.</div><button class="btn primary" id="fm-upload-add">Add file rows</button></div></section>' +
      '<section class="card"><div class="card-head"><h3>⌨️ Quick mapping</h3></div><div class="card-body"><label>Lookup by</label><select id="fm-kind" class="input"><option value="barcode">Barcode / Serial No</option><option value="tagId">Tag ID</option></select><label>Barcode / Tag ID</label><input class="input" id="fm-identifier" placeholder="Barcode ya Tag ID enter karein"><label>Agent ID to map (optional)</label><input class="input" id="fm-agent-id" placeholder="Blank = StockDataa Agent ID use hoga"><div class="btn-row"><button class="btn" id="fm-add-single">Add to queue</button><button class="btn primary" id="fm-quick-map">⚡ Quick map</button></div><hr><h4>Barcode range</h4><div class="grid g-3"><div><label>First barcode</label><input class="input" id="fm-first" placeholder="Start barcode"></div><div><label>Last barcode</label><input class="input" id="fm-last" placeholder="End barcode"></div><div><label>Agent ID (optional)</label><input class="input" id="fm-range-agent" placeholder="Target Agent ID"></div></div><button class="btn" id="fm-add-range">Add range</button></div></section></div>' +
      '<section class="card"><div class="card-head"><div><h3>🔎 StockDataa lookup & mapping queue</h3><p class="dim small">Lookup ke baad preview/review karein. Target Agent ID edit kar sakte hain; API call sirf selected complete rows par hoga.</p></div><div class="head-actions"><button class="btn" id="fm-lookup">🔎 Lookup StockDataa</button><button class="btn primary" id="fm-map">🚀 Map ready rows</button><button class="btn" id="fm-csv">⬇ Full details CSV</button><button class="btn" id="fm-clear">Clear</button></div></div><div class="card-body"><div id="fm-message" class="notice info">API status check ho raha hai…</div><div id="fm-summary"></div><div id="fm-results"><div class="empty-state">Upload a file or add a barcode / Tag ID above to start.</div></div></div></section>';
    state.items = []; state.rows = []; state.busy = false;
    const status = U.$('#fm-api-status', root);
    fetch(API_STATUS, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'FF-Dashboard' } }).then((r) => r.json()).then((j) => {
      state.configured = !!j.configured;
      if (status) { status.className = 'badge ' + (state.configured ? 'green' : 'amber'); status.textContent = state.configured ? 'Mapping API configured' : 'API secret missing in Render'; }
      setStatus(state.configured ? 'Ready. Upload file ya manual barcode / Tag ID add karein.' : 'API key configure nahi hai. Render environment me GV_TAG_MAPPING_SECRET set karne ke baad mapping enabled hogi; secret browser/GitHub me save nahi hota.', state.configured ? 'success' : 'warn');
    }).catch(() => { if (status) status.textContent = 'API status unavailable'; setStatus('API status verify nahi ho paya. Login/session aur server status check karein.', 'warn'); });
    root.addEventListener('click', async (event) => {
      const target = event.target.closest('button'); if (!target) return;
      if (target.id === 'fm-template') return templateCsv();
      if (target.id === 'fm-upload-add') {
        const file = U.$('#fm-file', root).files[0];
        if (!file) { setStatus('Pehle file choose karein.', 'warn'); return; }
        try {
          let matrix;
          if (/\.xlsx$/i.test(file.name)) matrix = await parseXlsx(file);
          else { const text = await file.text(); const delimiter = file.name.toLowerCase().endsWith('.tsv') ? '\t' : (text.split(/\r?\n/)[0].includes('\t') && !text.split(/\r?\n/)[0].includes(',') ? '\t' : ','); matrix = parseCsv(text, delimiter); }
          const items = parsedItems(matrix, file.name);
          if (!items.length) { setStatus('File me valid barcode, Tag ID ya first/last barcode range columns nahi mile.', 'warn'); return; }
          if (state.items.length + items.length > MAX_INPUTS) { setStatus('Maximum ' + MAX_INPUTS + ' input selectors allowed.', 'warn'); return; }
          state.items.push.apply(state.items, items); U.$('#fm-file-note', root).textContent = file.name + ' · ' + items.length + ' input rows added.';
          setStatus(items.length + ' input rows queue me add hue. Lookup button dabayein.', 'success');
        } catch (err) { setStatus('File read error: ' + (err.message || err), 'error'); }
        return;
      }
      if (target.id === 'fm-quick-map') return quickMap();
      if (target.id === 'fm-add-single') {
        const value = clean(U.$('#fm-identifier', root).value), kind = U.$('#fm-kind', root).value, agentId = clean(U.$('#fm-agent-id', root).value);
        if (!value) { setStatus('Barcode ya Tag ID required hai.', 'warn'); return; }
        state.items.push({ id: nextId++, type: kind, barcode: kind === 'barcode' ? value : '', tagId: kind === 'tagId' ? value : '', agentId, source: 'Manual', selected: true });
        U.$('#fm-identifier', root).value = ''; setStatus('Manual selector added. Lookup karein.', 'success'); return;
      }
      if (target.id === 'fm-add-range') {
        const first = clean(U.$('#fm-first', root).value), last = clean(U.$('#fm-last', root).value);
        if (!first || !last) { setStatus('First aur Last barcode dono required hain.', 'warn'); return; }
        if (first > last) { setStatus('First barcode, last barcode se bada nahi ho sakta.', 'warn'); return; }
        state.items.push({ id: nextId++, type: 'range', first, last, agentId: clean(U.$('#fm-range-agent', root).value), source: 'Manual range', selected: true });
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
