import test from 'node:test';
import assert from 'node:assert/strict';
import { createMappingStock, sheetIdFrom, idKey, compareBarcode } from '../mapping-stock.js';

const L = { id: 'A', name: 'B', tagId: 'C', barcode: 'D', cls: 'E', tagType: 'F', bcAt: 'G', agentId: 'H', agentName: 'I', agentAt: 'J', tl: 'K' };
const LETTERS = 'ABCDEFGHIJK'.split('');
const cell = (v) => (v == null || v === '' ? null : { v, f: String(v) });
const gvizRow = (arr) => ({ c: arr.map(cell) });
const mk = (n, extra = {}) => ['S' + n, 'inv', 'T' + n, String(8900000000000000 + n), '4', 'RFID', '', 'OLD', 'Old', '', 'TL', ...[]].map((v, i) => extra[i] ?? v);

function makeStock(allRows, { pageSize = 5000, onBuild } = {}) {
  let builds = 0, now = 1_000_000;
  const store = createMappingStock({
    getConfig: () => ({ sheetId: 'x', sheet: 'StockDataa', letters: L }),
    loadPages: async (_id, _sheet, _letters, _where, onPage) => {
      builds++; if (onBuild) onBuild(builds);
      const rows = typeof allRows === 'function' ? allRows(builds) : allRows;
      for (let i = 0; i < rows.length; i += pageSize) await onPage(rows.slice(i, i + pageSize).map(gvizRow), (l) => LETTERS.indexOf(l));
    },
    normalizeVcType: (v) => 'VC' + String(v).replace(/\D/g, ''),
    now: () => now
  });
  return { store, builds: () => builds, tick: (ms) => { now += ms; } };
}

test('range / barcode / tag lookup over >5000 rows (the old "near row 5001" failure) is instant and exact', async () => {
  const rows = Array.from({ length: 30000 }, (_, i) => mk(i + 1));
  const { store } = makeStock(rows);
  const first = String(8900000000000000 + 12000), last = String(8900000000000000 + 12009);
  const { results } = await store.lookup([
    { type: 'range', first, last },
    { type: 'barcode', barcode: String(8900000000000000 + 29999) },
    { type: 'tagId', tagId: 'T7' },
    { type: 'barcode', barcode: 'does-not-exist' }
  ]);
  assert.equal(results[0].rows.length, 10);
  assert.equal(results[0].rows[0].barcode, first);
  assert.equal(results[0].rows[0].vcType, 'VC4');
  assert.equal(results[1].rows[0].tagId, 'T29999');
  assert.equal(results[2].rows[0].barcode, String(8900000000000007));
  assert.equal(results[3].rows.length, 0);
});

test('different formats: spaces, commas, scientific notation, leading zeros', async () => {
  const rows = [mk(1, { 3: '0001234567' }), mk(2, { 3: '1234568' })];
  const { store } = makeStock(rows);
  const { results } = await store.lookup([
    { type: 'barcode', barcode: '1234567' },            // Excel ne leading zero hata diya
    { type: 'barcode', barcode: '0001234568' },         // sheet me zero nahi
    { type: 'barcode', barcode: ' 1,234,568 ' },
    { type: 'range', first: '1234567', last: '1234568' }
  ]);
  assert.equal(results[0].rows.length, 1);
  assert.equal(results[1].rows.length, 1);
  assert.equal(results[2].rows.length, 1);
  assert.equal(results[3].rows.length, 2);
  assert.equal(idKey('8.9E+15'), '8900000000000000');
});

test('range validation: first > last and oversized ranges return an error, not a crash', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => mk(i + 1));
  const { store } = makeStock(rows);
  const bad = await store.lookup([{ type: 'range', first: '9', last: '1' }]);
  assert.match(bad.results[0].error, /bada/);
  const small = createMappingStock({ getConfig: () => ({ sheetId: 'x', sheet: 'S', letters: L }), maxPerRange: 5,
    loadPages: async (_a, _b, _c, _d, onPage) => onPage(rows.map(gvizRow), (l) => LETTERS.indexOf(l)) });
  const big = await small.lookup([{ type: 'range', first: String(8900000000000001), last: String(8900000000000050) }]);
  assert.match(big.results[0].error, /max 5/);
});

test('miss triggers ONE fresh rebuild after minRefresh (new row added to the sheet); fresh hits do not rebuild', async () => {
  let data = [mk(1)];
  const { store, builds, tick } = makeStock(() => data);
  await store.lookup([{ type: 'tagId', tagId: 'T1' }]);
  assert.equal(builds(), 1);
  data = [mk(1), mk(2)];
  let r = await store.lookup([{ type: 'tagId', tagId: 'T2' }]);   // index abhi bana hai → refresh nahi
  assert.equal(r.results[0].rows.length, 0);
  tick(30_000);
  r = await store.lookup([{ type: 'tagId', tagId: 'T2' }]);       // purana + miss → refresh
  assert.equal(r.results[0].rows.length, 1);
  assert.equal(builds(), 2);
  r = await store.lookup([{ type: 'tagId', tagId: 'T1' }]);       // hit → koi rebuild nahi
  assert.equal(builds(), 2);
});

test('a failed rebuild keeps serving the previous index; first-build failure surfaces a clear error', async () => {
  let fail = false;
  const store = createMappingStock({ getConfig: () => ({ sheetId: 'x', sheet: 'S', letters: L }),
    loadPages: async (_a, _b, _c, _d, onPage) => { if (fail) throw new Error('Google 500'); await onPage([mk(1)].map(gvizRow), (l) => LETTERS.indexOf(l)); } });
  await store.lookup([{ type: 'tagId', tagId: 'T1' }]);
  fail = true;
  const out = await store.lookup([{ type: 'tagId', tagId: 'T1' }], { fresh: true }).catch((e) => e);
  assert.ok(out instanceof Error);
  const cold = createMappingStock({ getConfig: () => ({ sheetId: 'x', sheet: 'S', letters: L }), loadPages: async () => { throw new Error('Google 500'); } });
  await assert.rejects(() => cold.lookup([{ type: 'barcode', barcode: '1' }]), /Google 500/);
});

test('250k rows: index builds + 2,500 mixed lookups well under a second', async () => {
  const rows = Array.from({ length: 250000 }, (_, i) => mk(i + 1));
  const { store } = makeStock(rows, { pageSize: 25000 });
  const t0 = performance.now();
  await store.ensure();
  const items = Array.from({ length: 2500 }, (_, i) => (i % 2 ? { type: 'barcode', barcode: String(8900000000000000 + i * 90 + 1) } : { type: 'range', first: String(8900000000000000 + i * 90 + 1), last: String(8900000000000000 + i * 90 + 20) }));
  const { results } = await store.lookup(items);
  assert.ok(results.every((r) => r.rows.length >= 1));
  assert.ok(performance.now() - t0 < 5000, 'took ' + (performance.now() - t0));
});

test('helpers: sheet link parsing and barcode compare', () => {
  assert.equal(sheetIdFrom('https://docs.google.com/spreadsheets/d/13eyCSDnXysQM-nWymBE5yPeKw8fnbVCY-hCTqJSPUsM/edit#gid=0'), '13eyCSDnXysQM-nWymBE5yPeKw8fnbVCY-hCTqJSPUsM');
  assert.equal(sheetIdFrom('13eyCSDnXysQM-nWymBE5yPeKw8fnbVCY-hCTqJSPUsM'), '13eyCSDnXysQM-nWymBE5yPeKw8fnbVCY-hCTqJSPUsM');
  assert.equal(sheetIdFrom('not a link'), '');
  assert.equal(compareBarcode('0099', '100'), -1);
});
