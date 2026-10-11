import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(ROOT, 'fastagMapping.js'), 'utf8');

function makePage(stockClass = 'VC20') {
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
  assert.ok(queryLog.some((q) => /where D >= "8900000000123456" and D <= "8900000000123456"/i.test(q.tq)), 'range lookup tries a narrow interval predicate first');
});

test('FASTag Mapping tries the bounded barcode interval before expensive pagination', async () => {
  const { root, selectors, FF, queryLog } = makePage();
  const originalQuery = FF.data.query;
  FF.data.query = async (sheet, tq, opts) => {
    if (/where D >=/.test(tq)) { queryLog.push({ tq, range: opts?.range }); return { cols: [], rows: [] }; }
    if (/where D is not null limit 5000 offset 0/i.test(tq)) {
      assert.equal(opts.timeoutMs, 16000, 'fallback query has a bounded but realistic timeout');
      assert.equal(opts.fresh, true, 'fallback does not reuse stale cached pages');
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
  assert.ok(queryLog.some((q) => /where D >=/.test(q.tq)), 'narrow interval query was attempted first');
});

test('FASTag Mapping accepts formatted numeric barcode identifiers', async () => {
  const { root, selectors } = makePage();
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8,900,000,000,123,456';
  selectors.get('#fm-agent-id').value = 'TARGET-FORMATTED';
  await click(root, 'fm-add-single');
  await click(root, 'fm-lookup');
  const html = selectors.get('#fm-results').innerHTML;
  assert.match(html, /TAG-12345/);
  assert.match(html, /TARGET-FORMATTED/);
});

test('FASTag Mapping Lookup button picks up typed barcode + Agent ID without a separate Add-to-queue click', async () => {
  const { root, selectors, queryLog } = makePage();
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000123456';
  selectors.get('#fm-agent-id').value = 'TYPED-TARGET-42';
  await click(root, 'fm-lookup');
  const html = selectors.get('#fm-results').innerHTML;
  assert.match(html, /TAG-12345/, 'typed identifier was auto-queued and looked up');
  assert.match(html, /TYPED-TARGET-42/);
  assert.ok(queryLog.length > 0, 'gviz lookup actually ran');
});

test('FASTag Mapping keeps typed range inputs usable when Lookup is clicked directly', async () => {
  const { root, selectors, queryLog } = makePage();
  selectors.get('#fm-first').value = '8900000000123456';
  selectors.get('#fm-last').value = '8900000000123456';
  selectors.get('#fm-range-agent').value = 'TYPED-RANGE-7';
  await click(root, 'fm-lookup');
  const html = selectors.get('#fm-results').innerHTML;
  assert.match(html, /TAG-12345/, 'typed range was auto-queued and expanded');
  assert.match(html, /TYPED-RANGE-7/);
  assert.ok(queryLog.some((q) => /where D >=/.test(q.tq)), 'range query used the bounded interval path');
});

test('FASTag Mapping restores the lookup queue after a failed query so retry works without re-entering inputs', async () => {
  const { root, selectors, FF, queryLog } = makePage();
  const originalQuery = FF.data.query;
  let failuresRemaining = 2;
  FF.data.query = async (sheet, tq, opts) => {
    // Numeric and quoted equality are attempted in parallel; fail both first-attempt calls.
    if (failuresRemaining > 0) { failuresRemaining--; const err = new Error('upstream timeout'); err.name = 'Error'; throw err; }
    return originalQuery(sheet, tq, opts);
  };
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000123456';
  selectors.get('#fm-agent-id').value = 'RETRY-TARGET';
  await click(root, 'fm-lookup');
  assert.match(selectors.get('#fm-message').textContent, /Lookup fail/, 'first attempt reports the failure');
  assert.match(selectors.get('#fm-message').textContent, /queue me wapas aa gaye/, 'user is told inputs were restored');
  await click(root, 'fm-lookup');
  const html = selectors.get('#fm-results').innerHTML;
  assert.match(html, /TAG-12345/, 'second attempt retries from the restored queue');
  assert.match(html, /RETRY-TARGET/);
  assert.ok(queryLog.length >= 2, 'queries ran on both attempts');
});


test('FASTag Mapping continues barcode fallback when the data source returns partial pages', async () => {
  const { root, selectors, FF, queryLog } = makePage();
  const originalQuery = FF.data.query;
  const labels = ['STOCK_ID','INVENTORY_NAME','TAG_ID','BARCODE','TAG_CLASS','TAG_TYPE','BARCODE_ALLOCATED_AT','AGENT_ID','AGENT_NAME','AGENT_ALLOCATED_AT','TL_NAME','EXTRA_L','EXTRA_M'];
  const cols = labels.map((label, i) => ({ id: 'ABCDEFGHIJKLM'[i], label, type: 'string' }));
  const makeTable = (rows) => ({
    cols,
    rows: rows.map((values) => values.map((v) => v == null ? null : ({ v: String(v), f: String(v) })))
  });
  const distractors = [0, 1, 2].map((i) => [
    'STOCK-' + i, 'Distractor', 'DUMMY-' + i, '700000000000000' + i, '4', 'RFID', '',
    'OLD-AGENT', 'Old Agent', '', 'TL Test', '', ''
  ]);
  const target = [
    'STOCK-1', 'Test tag', 'TAG-12345', '8900000000123456', '16', 'RFID',
    '2026-10-01', 'OLD-AGENT', 'Old Agent', '2026-10-01', 'TL Test', '', ''
  ];
  FF.data.query = async (sheet, tq, opts = {}) => {
    queryLog.push({ tq, range: opts.range, fresh: opts.fresh, directFirst: opts.directFirst });
    // Simulate both exact predicates silently missing the barcode.
    if (/where\s+D\s*=/.test(tq)) return makeTable([]);
    const page = tq.match(/where\s+D\s+is\s+not\s+null\s+limit\s+(\d+)\s+offset\s+(\d+)/i);
    if (page) {
      assert.equal(opts.fresh, true, 'fallback bypasses stale cached pages after an exact miss');
      assert.equal(opts.directFirst, true, 'fallback attempts Google directly with a short timeout');
      const offset = Number(page[2]);
      // Pretend the backend caps the first response at three rows, below the requested limit.
      return offset === 0 ? makeTable(distractors) : (offset === 3 ? makeTable([target]) : makeTable([]));
    }
    return originalQuery(sheet, tq, opts);
  };
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000123456';
  selectors.get('#fm-agent-id').value = 'TARGET-PAGED';
  await click(root, 'fm-lookup');
  const html = selectors.get('#fm-results').innerHTML;
  assert.match(html, /TAG-12345/, 'target row on a later partial page should be found');
  assert.match(html, /VC16/, 'numeric class should still be normalized');
  assert.ok(queryLog.some((q) => /offset 3/i.test(q.tq)), 'scan advances by the actual short page size');
});

test('FASTag Mapping repeats a known barcode from the in-session index without another Sheets request', async () => {
  const { root, selectors, queryLog } = makePage();
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000123456';
  selectors.get('#fm-agent-id').value = 'CACHE-TARGET-1';
  await click(root, 'fm-lookup');
  const countAfterFirst = queryLog.length;
  assert.match(selectors.get('#fm-results').innerHTML, /TAG-12345/);
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000123456';
  selectors.get('#fm-agent-id').value = 'CACHE-TARGET-2';
  await click(root, 'fm-lookup');
  assert.match(selectors.get('#fm-results').innerHTML, /CACHE-TARGET-2/);
  assert.equal(queryLog.length, countAfterFirst, 'same barcode lookup should use the local cache');
});

test('FASTag Mapping normalizes numeric StockDataa vehicle classes to VC-prefixed values', async () => {
  const { root, selectors } = makePage('16');
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000123456';
  selectors.get('#fm-agent-id').value = 'TARGET-VC16';
  await click(root, 'fm-lookup');
  assert.match(selectors.get('#fm-results').innerHTML, /VC16/, 'numeric TAG_CLASS 16 is normalized to VC16');
});

test('FASTag lookup bypasses stale empty-query cache and allows enough proxy response time', async () => {
  const { root, selectors, queryLog } = makePage();
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000123456';
  selectors.get('#fm-agent-id').value = 'FRESH-TARGET';
  await click(root, 'fm-lookup');
  assert.match(selectors.get('#fm-results').innerHTML, /TAG-12345/);
  assert.ok(queryLog.some((q) => /where D =/.test(q.tq) && q.fresh === true), 'exact stock lookup bypasses stale browser/proxy cache');
  assert.ok(queryLog.some((q) => /where D =/.test(q.tq) && q.timeoutMs === 14000), 'exact lookup uses a bounded but realistic timeout');
});

test('Quick Map preserves the actual StockDataa error instead of replacing it with a generic warning', async () => {
  const { root, selectors, FF } = makePage();
  FF.data.query = async (sheet, tq) => {
    if (/where\\s+D\\s*=/.test(tq)) throw new Error('upstream timeout');
    return { cols: [], rows: [] };
  };
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000123456';
  selectors.get('#fm-agent-id').value = 'ERROR-TARGET';
  await click(root, 'fm-quick-map');
  assert.match(selectors.get('#fm-message').textContent, /Lookup fail: StockDataa lookup timeout/i);
  assert.doesNotMatch(selectors.get('#fm-message').textContent, /Quick Map ruk gaya/);
});

test('Quick Map names the missing StockDataa field when the record exists but class is blank', async () => {
  const { root, selectors } = makePage('');
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000123456';
  selectors.get('#fm-agent-id').value = 'MISSING-CLASS';
  await click(root, 'fm-quick-map');
  assert.match(selectors.get('#fm-message').textContent, /TAG_CLASS \/ VC Type \(column E\)/);
  assert.doesNotMatch(selectors.get('#fm-message').textContent, /Quick Map ruk gaya/);
});
