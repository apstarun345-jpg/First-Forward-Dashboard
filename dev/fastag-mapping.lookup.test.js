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
  const table = (rows) => ({ cols, rows: rows.map((r) => r.map(cell)) });
  const D = {
    async query(sheet, tq, opts = {}) {
      assert.equal(sheet, 'StockDataa');
      queryLog.push({ tq, range: opts.range });
      if (opts.range === 'A1:M2') return table([]);
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
