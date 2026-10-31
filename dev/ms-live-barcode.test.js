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

test('server gviz gate lets small limit queries jump the queue; live lookup uses the proxy', () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /function gvizPriority\(url\)/);
  assert.match(server, /await gvizAcquire\(gvizPriority\(url\)\)/);
  assert.match(server, /if \(priority\) gvizGate\.queue\.unshift\(resolve\)/);
  const ms = fs.readFileSync(path.join(ROOT, 'masterSearch.js'), 'utf8');
  assert.match(ms, /limit 40`, \{ timeoutMs: 40000 \}/);
});

test('barcode + tag ID of the same tag collapse into ONE result row (barcode key wins)', async () => {
  const s = FF.config.stock, a = FF.config.gv.assignment;
  const colsOf = (sql) => sql.replace(/^select\s+/i, '').split(/\s+where\s+/i)[0].split(',').map((x) => x.trim());
  const sqls = [];
  FF.data.query = async (sheet, sql) => {
    sqls.push({ sheet, sql });
    const cols = colsOf(sql);
    const map = sheet === 'Tag Assignment'
      ? { [a.serial]: '608116-039-0550696', [a.tagId]: '34161FA820328EE84F0CE500', [a.agentName]: 'SOMANANDA DASH', [a.tlName]: 'SOMANANDA DASH' }
      : { [s.barcode]: '608116-039-0550696', [s.tagId]: '34161FA820328EE84F0CE500', [s.agentName]: 'Ravi', [s.tlName]: 'TL One' };
    return { rows: [cols.map((c) => ({ v: map[c] || '' }))], cols: cols.map((id) => ({ id })) };
  };
  FF.masterSearch.search('608116-039-0550696');
  // dashed barcode → only barcode/serial column, no EIR scan
  assert.ok(sqls.every((q) => [...q.sql.split(' where ')[1].matchAll(/lower\((\w+)\)/g)].every((m) => m[1] === s.barcode || m[1] === a.serial)), 'only barcode/serial column scanned');
  assert.ok(!sqls.some((q) => q.sheet === (FF.config.eir.sheet || 'EIR')), 'EIR skipped for barcode input');
  await new Promise((r) => setTimeout(r, 30));
  const res = FF.masterSearch.search('608116-039-0550696');
  assert.equal(res.tags.length, 1, 'one row per tag');
  assert.equal(res.tags[0].key, '6081160390550696');
  assert.equal(res.tags[0].ff.length, 1); assert.equal(res.tags[0].gv.length, 1);
  const dd = FF.masterSearch.suggestItems('608116-039-0550696').find((i) => i.barcode);
  assert.match(dd.sub, /Tag 34161FA820328EE84F0CE500/);
  assert.match(dd.sub, /GV SOMANANDA DASH \(TL SOMANANDA DASH\)/);
});

test('v3.125.16: no auto barcode register on page load; API read retries; boxes auto-retry', () => {
  const fs = require('node:fs');
  const ms = fs.readFileSync(path.join(ROOT, 'masterSearch.js'), 'utf8');
  const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  assert.match(ms, /if \(!\(opts && opts\.barcodes\)\) return;/);
  assert.match(ms, /warmFull\(\{ barcodes: true \}\)/);
  assert.match(ms, /function autoRetryBox\(box, flag, fill, host\)/);
  assert.match(ms, /autoRetryBox\(box, '__kycDone'/);
  assert.match(ms, /autoRetryBox\(box, '__dispDone'/);
  assert.match(auth, /st === 502 \|\| st === 503 \|\| st === 504/);
  assert.match(auth, /READ_POSTS = .*dispatch-by/);
});
