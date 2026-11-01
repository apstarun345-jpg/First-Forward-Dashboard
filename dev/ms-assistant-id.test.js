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
FF.pages = FF.pages || {};
require(path.join(ROOT, 'masterSearch.js'));

test('assistant ID shared by two agents shows both agents in Master Search', async () => {
  FF.data.query = async () => ({ rows: [], cols: [] });
  FF.store.state.data = { agents: [], stockAgents: [], daily: [], agentClass: [], stock: [], status: [], report: [] };
  await FF.masterSearch.buildLight().catch(() => {});
  const rows = [
    { a: '611333590466171733', b: '44214277', m: '442145787', n: 'Parmar us', tn: 'UMESH SHARMA' },
    { a: '617144150302679477', b: '44934126', m: '442145787', n: 'BHUWAN BHASKER PANDEY', tn: 'UMESH SHARMA' }
  ];
  FF.aliases = { map: (q) => q, hits: (q) => (String(q) === '442145787' ? rows.map((r) => ({ to: r.a, row: r, kind: 'Assistant ID' })) : []) };
  const r = FF.masterSearch.search('442145787');
  const names = r.ids.filter((v) => v.via === 'Assistant ID').map((v) => v.name).sort();
  assert.deepEqual(names, ['BHUWAN BHASKER PANDEY', 'Parmar us']);
  const items = FF.masterSearch.suggestItems('442145787');
  assert.ok(items.some((i) => /Parmar us/.test(i.label)) && items.some((i) => /BHUWAN/.test(i.label)));
});
