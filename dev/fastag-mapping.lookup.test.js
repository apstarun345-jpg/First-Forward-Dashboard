import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(ROOT, 'fastagMapping.js'), 'utf8');

function makePage() {
  const labels = ['STOCK_ID','INVENTORY_NAME','TAG_ID','BARCODE','TAG_CLASS','TAG_TYPE','BARCODE_ALLOCATED_AT','AGENT_ID','AGENT_NAME','AGENT_ALLOCATED_AT','TL_NAME','EXTRA_L','EXTRA_M'];
  const letters = 'ABCDEFGHIJKLM'.split('');
  const stock = ['STOCK-1','Test tag','TAG-12345','8900000000123456','VC20','RFID','2026-10-01','OLD-AGENT','Old Agent','2026-10-01','TL Test','',''];
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
      queryLog.push({ tq, range: opts.range });
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
    '#fm-kind','#fm-identifier','#fm-agent-id','#fm-first','#fm-last','#fm-range-agent','#fm-file','#fm-file-note']) {
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
    window: { FF }, fetch: async () => ({ json: async () => ({ configured: false }) }),
    confirm: () => false, setTimeout, clearTimeout, Blob, URL, TextEncoder, TextDecoder, DataView,
    Uint8Array, Response, DecompressionStream, BigInt, console
  };
  vm.runInNewContext(source, sandbox, { filename: 'fastagMapping.js' });
  FF.pages.fastagMapping.render(root);
  return { root, selectors, FF, queryLog };
}
async function click(root, id) {
  await root.handlers.click({ target: { closest: () => ({ id }) } });
}

test('FASTag Mapping finds a text-stored barcode even when numeric gviz equality silently returns zero rows', async () => {
  const { root, selectors, queryLog } = makePage();
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000123456';
  selectors.get('#fm-agent-id').value = 'TARGET-77';
  await click(root, 'fm-add-single');
  await click(root, 'fm-lookup');
  const html = selectors.get('#fm-results').innerHTML;
  assert.match(html, /TAG-12345/);
  assert.match(html, /VC20/);
  assert.match(html, /8900000000123456/, 'raw barcode stays unformatted for matching/API payload');
  assert.match(html, /TARGET-77/);
  assert.ok(queryLog.some((q) => /where D = 8900000000123456/.test(q.tq)), 'numeric query attempted');
  assert.ok(queryLog.some((q) => /where D = "8900000000123456"/.test(q.tq)), 'quoted string fallback attempted');
});

test('FASTag Mapping looks up Tag ID separately and never silently uses the stock Agent ID as target', async () => {
  const { root, selectors } = makePage();
  selectors.get('#fm-kind').value = 'tagId';
  selectors.get('#fm-identifier').value = 'TAG-12345';
  selectors.get('#fm-agent-id').value = 'TARGET-88';
  await click(root, 'fm-add-single');
  await click(root, 'fm-lookup');
  const html = selectors.get('#fm-results').innerHTML;
  assert.match(html, /TAG-12345/);
  assert.match(html, /VC20/);
  assert.match(html, /TARGET-88/);
  assert.doesNotMatch(html, /value="OLD-AGENT"/);
});
test('FASTag Mapping expands first/last barcode from StockDataa and applies the supplied Agent ID to every matched row', async () => {
  const { root, selectors, queryLog } = makePage();
  selectors.get('#fm-first').value = '8900000000123456';
  selectors.get('#fm-last').value = '8900000000123456';
  selectors.get('#fm-range-agent').value = 'RANGE-TARGET-99';
  await click(root, 'fm-add-range');
  await click(root, 'fm-lookup');
  const html = selectors.get('#fm-results').innerHTML;
  assert.match(html, /TAG-12345/);
  assert.match(html, /VC20/);
  assert.match(html, /RANGE-TARGET-99/);
  assert.ok(queryLog.some((q) => /where D is not null limit 5000 offset 0/i.test(q.tq)), 'range lookup scans StockDataa in bounded pages rather than using a slow range predicate');
});

test('FASTag Mapping paginates StockDataa and completes a numeric barcode range without a broad-query timeout', async () => {
  const { root, selectors, FF, queryLog } = makePage();
  const originalQuery = FF.data.query;
  FF.data.query = async (sheet, tq, opts) => {
    if (/where D is not null limit 5000 offset 0/i.test(tq)) {
      assert.equal(opts.timeoutMs, 55000, 'bounded page query has an explicit timeout');
    }
    return originalQuery(sheet, tq, opts);
  };
  selectors.get('#fm-first').value = '8900000000123451';
  selectors.get('#fm-last').value = '8900000000123461';
  selectors.get('#fm-range-agent').value = 'AUTO-SPLIT-AGENT';
  await click(root, 'fm-add-range');
  await click(root, 'fm-lookup');
  const html = selectors.get('#fm-results').innerHTML;
  assert.match(html, /TAG-12345/);
  assert.match(html, /AUTO-SPLIT-AGENT/);
  assert.ok(queryLog.some((q) => /where D is not null limit 5000 offset 0/i.test(q.tq)), 'bounded page scan was issued');
});
