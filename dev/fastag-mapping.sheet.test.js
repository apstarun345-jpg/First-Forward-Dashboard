import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(ROOT, 'fastagMapping.js'), 'utf8');

function makePage(stockClass = 'VC20', fetchImpl) {
  const labels = ['STOCK_ID','INVENTORY_NAME','TAG_ID','BARCODE','TAG_CLASS','TAG_TYPE','BARCODE_ALLOCATED_AT','AGENT_ID','AGENT_NAME','AGENT_ALLOCATED_AT','TL_NAME','EXTRA_L','EXTRA_M'];
  const letters = 'ABCDEFGHIJKLM'.split('');
  const stock = ['STOCK-1','Test tag','TAG-12345','8900000000123456',String(stockClass),'RFID','2026-10-01','OLD-AGENT','Old Agent','2026-10-01','TL Test','',''];
  const cols = labels.map((label, i) => ({ id: letters[i], label, type: 'string' }));
  const queryLog = [];
  const cell = (v) => v == null ? null : ({ v, f: String(v) });
  const table = (rows) => ({ cols, rows: rows.map((r) => r.map((v, i) => {
    const c = cell(v);
    // Simulate Google Sheets returning a numeric raw value plus a formatted display value.
    if (i === 3 && /^\d{13,}$/.test(String(v ?? ''))) {
      c.v = Number(v);
      c.f = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    return c;
  })) });
  const D = {
    async query(sheet, tq, opts = {}) {
      assert.equal(sheet, 'StockDataa');
      queryLog.push({ tq, range: opts.range, fresh: opts.fresh, timeoutMs: opts.timeoutMs });
      if (opts.range === 'A1:M2') return table([]);
      const page = tq.match(/where\s+D\s+is\s+not\s+null\s+limit\s+(\d+)\s+offset\s+(\d+)/i);
      if (page) return Number(page[2]) === 0 ? table([stock]) : table([]);
      const range = tq.match(/where\s+([A-M])\s*>=\s*(?:"([^"]*)"|(\d+))\s+and\s+([A-M])\s*<=\s*(?:"([^"]*)"|(\d+))/i);
      if (range) {
        const letter = range[1].toUpperCase();
        const from = range[2] !== undefined ? range[2] : range[3];
        const to = range[5] !== undefined ? range[5] : range[6];
        const value = String(stock[letters.indexOf(letter)] ?? '');
        // Simulate a numeric range query silently missing text-formatted barcode values.
        if (letter === 'D' && range[2] === undefined) return table([]);
        const compare = (a, b) => /^\d+$/.test(a) && /^\d+$/.test(b)
          ? (BigInt(a) < BigInt(b) ? -1 : (BigInt(a) > BigInt(b) ? 1 : 0))
          : a.localeCompare(b, undefined, { numeric: true });
        return table(compare(value, from) >= 0 && compare(value, to) <= 0 ? [stock] : []);
      }
      const where = tq.match(/where\s+([A-M])\s*=\s*(?:"([^"]*)"|(\d+))/i);
      if (!where) return table([]);
      const letter = where[1].toUpperCase();
      const queryValue = where[2] !== undefined ? where[2] : where[3];
      const col = letters.indexOf(letter);
      // Simulate StockDataa storing barcodes as text: numeric query returns an empty
      // result without an error, while the quoted-string query matches the same row.
      const isQuoted = where[2] !== undefined;
      if (letter === 'D' && !isQuoted && /^\d+$/.test(queryValue)) return table([]);
      const match = String(stock[col] ?? '').toLowerCase() === String(queryValue).toLowerCase();
      return table(match ? [stock] : []);
    },
    cellText(c) { return c && c.v != null ? String(c.v) : ''; },
    textRows(t) { return (t.rows || []).map((row) => t.cols.map((col, i) => {
      const value = row[i];
      return value && value.v != null ? (value.f != null ? String(value.f) : String(value.v)) : '';
    })); }
  };
  const selectors = new Map();
  const fakeNode = () => ({ value: '', innerHTML: '', textContent: '', className: '', disabled: false, files: [], checked: false });
  // The fake page does not parse root.innerHTML like a browser, so pre-create inputs that the UI binds by ID.
  for (const sel of ['#fm-api-status','#fm-message','#fm-summary','#fm-results','#fm-lookup','#fm-map',
    '#fm-gs-link','#fm-gs-tab','#fm-gs-start','#fm-gs-mode','#fm-gs-first','#fm-gs-last','#fm-gs-barcode','#fm-gs-agent','#fm-gs-done','#fm-gs-donetext','#fm-kind','#fm-identifier','#fm-agent-id','#fm-first','#fm-last','#fm-range-agent','#fm-file','#fm-file-note']) {
    selectors.set(sel, fakeNode());
  }
  const root = {
    innerHTML: '',
    handlers: {},
    querySelector(sel) { if (!selectors.has(sel)) selectors.set(sel, fakeNode()); return selectors.get(sel); },
    querySelectorAll() { return []; },
    addEventListener(type, cb) { this.handlers[type] = cb; }
  };
  const U = {
    $: (sel, r) => r.querySelector(sel),
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    fmt: (v) => Number(v || 0).toLocaleString('en-IN'),
    stamp: () => 'test'
  };
  const FF = {
    util: U,
    data: D,
    config: { stock: { id:'A', name:'B', tagId:'C', barcode:'D', cls:'E', tagType:'F', bcAllocatedAt:'G', agentId:'H', agentName:'I', agentAllocatedAt:'J', tlName:'K' } },
    pages: {}
  };
  const sandbox = {
    window: { FF }, fetch: fetchImpl || (async () => ({ json: async () => ({ configured: false }) })),
    confirm: () => true, setTimeout, clearTimeout, Blob, URL, TextEncoder, TextDecoder, DataView,
    Uint8Array, Response, DecompressionStream, BigInt, console
  };
  vm.runInNewContext(source, sandbox, { filename: 'fastagMapping.js' });
  FF.pages.fastagMapping.render(root);
  return { root, selectors, FF, queryLog };
}

async function click(root, id) { await root.handlers.click({ target: { closest: () => ({ id }) } }); }
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const stockRow = (n) => ({ stockRowId: 'S' + n, inventoryName: 'inv', tagId: 'TAG' + n, barcode: String(8900000000000000 + n), serialNo: String(8900000000000000 + n), vcType: 'VC4', tagType: 'RFID', barcodeAllocatedAt: '', stockAgentId: '', stockAgentName: '', agentAllocatedAt: '', tlName: 'TL' });

test('Google Sheet flow: reads rows, server-side lookup (no gviz paging), maps, writes "done" only for fully-mapped rows, skips already-done rows', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body });
    if (url.endsWith('/status')) return jsonRes(200, { configured: true });
    if (url.endsWith('/sheet/read')) return jsonRes(200, { ok: true, startRow: 2, rows: [
      ['8900000000000001', '8900000000000003', 'AG1', ''],     // row 2 → 3 tags
      ['8900000000000010', '8900000000000011', 'AG2', 'done'], // row 3 → already done, skip
      ['8900000000099999', '8900000000099999', 'AG3', ''],     // row 4 → not in stock → not done
      ['', '', '', '']                                         // blank
    ] });
    if (url.endsWith('/lookup')) return jsonRes(200, { ok: true, results: body.items.map((it, index) => ({ index, rows: it.first === '8900000000000001' ? [1, 2, 3].map(stockRow) : [] })) });
    if (url.endsWith('/map')) return jsonRes(200, { ok: true, results: body.rows.map((r, index) => ({ index, success: true, status: 'Success' })) });
    if (url.endsWith('/sheet/mark')) return jsonRes(200, { ok: true, written: body.writes.length });
    return jsonRes(404, {});
  };
  const { root, selectors } = makePage('VC4', fetchImpl);
  await new Promise((r) => setTimeout(r, 5));
  const set = (id, v) => { selectors.get('#fm-gs-' + id).value = v; };
  set('link', 'https://docs.google.com/spreadsheets/d/13eyCSDnXysQM-nWymBE5yPeKw8fnbVCY-hCTqJSPUsM/edit');
  set('tab', 'Sheet1'); set('start', '2'); set('mode', 'range'); set('first', 'A'); set('last', 'B'); set('agent', 'C'); set('done', 'D'); set('donetext', 'done');
  await click(root, 'fm-gs-auto');
  const lookup = calls.find((c) => c.url.endsWith('/lookup'));
  assert.equal(lookup.body.items.length, 2, 'already-done + blank rows are not looked up');
  assert.ok(!calls.some((c) => /gviz/.test(c.url)), 'no browser-side gviz paging');
  const mark = calls.find((c) => c.url.endsWith('/sheet/mark'));
  assert.deepEqual(mark.body.writes, [{ row: 2, value: 'done' }]);
  assert.equal(mark.body.column, 'D');
  const map = calls.find((c) => c.url.endsWith('/map'));
  assert.equal(map.body.rows.length, 3);
  assert.equal(map.body.rows[0].agentId, 'AG1');
});
