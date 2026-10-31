/* v3.125.11 — Master Search: barcode register ban raha ho tab bhi typed barcode live sheet-query se milna chahiye. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { hash: '#/home', href: '' };
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false,
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true },
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
};
['config', 'util', 'data', 'model', 'gv', 'store'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
FF.pages = FF.pages || {};
require(path.join(ROOT, 'masterSearch.js'));

test('live barcode lookup finds a tag before the full register is loaded', async () => {
  const s = FF.config.stock;
  const colsOf = (sql) => sql.replace(/^select\s+/i, '').split(/\s+where\s+/i)[0].split(',').map((x) => x.trim());
  const queries = [];
  FF.data.query = async (sheet, sql) => {
    queries.push({ sheet, sql });
    if (sheet !== (s.sheet || 'StockDataa')) return { rows: [], cols: [] };
    const cols = colsOf(sql);
    const row = cols.map((c) => ({ v: c === s.barcode ? '34161FA82032AAAA' : c === s.tagId ? '34161FA82032AAAA' : c === s.agentName ? 'Ravi Kumar' : c === s.agentId ? 'R101' : c === s.tlName ? 'TL One' : '' }));
    return { rows: [row], cols: cols.map((id) => ({ id })) };
  };
  FF.store.state.data = { agents: [], stockAgents: [], daily: [], agentClass: [], stock: [], status: [], report: [] };
  await FF.masterSearch.buildLight().catch(() => {});
  const first = FF.masterSearch.search('34161FA82032');
  assert.equal(first.heavy, false);
  assert.ok(queries.length >= 1, 'live queries were fired');
  assert.ok(queries.every((q) => /lower\(\w+\) contains '34161fa82032'/.test(q.sql)), 'contains filter on lowercase needle');
  assert.ok(queries.every((q) => /limit 40/.test(q.sql)));
  await new Promise((r) => setTimeout(r, 30));
  const second = FF.masterSearch.search('34161FA82032');
  const n = queries.length; FF.masterSearch.search('34161FA82032');
  assert.equal(queries.length, n, 'cached per query');
  assert.ok(second.tags.some((t) => t.key === '34161FA82032AAAA' && t.ff.some((x) => x.agentName === 'Ravi Kumar')), 'live hit merged into tags');
});

test('live lookup also searches the dashed barcode form (608116-011-0558357)', () => {
  const sqls = [];
  FF.data.query = async (sheet, sql) => { sqls.push(sql); return { rows: [], cols: [] }; };
  FF.masterSearch.search('608116-011-0558357');
  assert.ok(sqls.length >= 1);
  assert.ok(sqls.some((q) => q.includes("contains '608116-011-0558357'")), 'raw dashed needle');
  assert.ok(sqls.some((q) => q.includes("contains '6081160110558357'")), 'digits-only needle');
});
