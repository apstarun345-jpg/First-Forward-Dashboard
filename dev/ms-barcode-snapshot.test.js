/* v3.125.40 — browser snapshot: barcode / tag turant, bina network. */
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
import { createStockAgeBuilder, snapshotLine } from '../stock-age.js';

test('snapshot search answers instantly without any query', async () => {
  const b = createStockAgeBuilder({ compact: true });
  b.addFf([{ tagId: '34161FA820328EE84F1DEF20', barcode: '608116-039-0585593', cls: 'VC4' }, { tagId: '34161FA8AAAA0001', barcode: '608116-011-0558357', cls: 'VC16', agentName: 'RAJENDRA CHOURE', agentId: 'R1', tl: 'T1' }]);
  b.addGv([{ tagId: '34161FA8AAAA0001', serial: '608116-011-0558357', cls: 'VC16', agentName: 'G AGENT', agentId: 'G9', tlName: 'GT' }]);
  const idx = b.finish();
  const lines = [];
  idx.ff.each((r) => lines.push(snapshotLine('ff', r)));
  idx.gv.each((r) => lines.push(snapshotLine('gv', r)));
  const S = FF.masterSearch._snap;
  assert.ok(S.use(`#at\t${Date.now()}\n${lines.join('\n')}\n`));
  let calls = 0;
  FF.data.query = async () => { calls++; return { rows: [], cols: [] }; };
  FF.store.state.data = { agents: [], stockAgents: [], daily: [], agentClass: [], stock: [], status: [], report: [] };
  await FF.masterSearch.buildLight().catch(() => {});
  const r = FF.masterSearch.search('608116-011-0558357');
  assert.equal(r.livePending, false);
  const t = r.tags.find((x) => x.key === '6081160110558357');
  assert.ok(t && t.ff[0].agentName === 'RAJENDRA CHOURE' && t.gv[0].agentName === 'G AGENT');
  assert.ok(FF.masterSearch.search('34161FA820328EE84F1DEF20').tags.length === 1, 'tag ID search');
  assert.ok(FF.masterSearch.search('0585593').tags.length === 1, 'partial digits');
  await new Promise((res) => setTimeout(res, 5));
  assert.equal(calls, 0, 'no sheet query on local hit');
});
