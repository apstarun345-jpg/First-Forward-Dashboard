/* v3.98 — 🆕 NEW Agent tag: shared helper (Tag Request + Master Search + Agent Summary). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { documentElement: { dataset: {}, style: {}, setAttribute() {}, removeAttribute() {} }, body: { classList: { add() {}, remove() {} } }, readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };
globalThis.addEventListener = () => {};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4 };
document.createTreeWalker = () => ({ nextNode: () => null });
const FF = (globalThis.FF = globalThis.FF || {});
require(path.join(ROOT, 'ui-plus.js'));

test('NEW Agent tag: ID / digits / name match, per channel, TL-safe', async () => {
  FF.newAgents = { collect: async () => ({ ff: { rows: [{ id: '123456', name: 'Fresh Agent', isNew: true }, { id: '999999', name: 'Old Agent', isNew: false }] }, gv: { rows: [{ id: 'APS012345', name: 'Gv Fresh', isNew: true }] } }) };
  const T = FF.newAgentTag;
  assert.equal(T.isNew('ff', '123456', 'x'), false, 'ready() se pehle false');
  assert.equal(await T.ready(), true);
  assert.equal(T.isNew('ff', '123456', ''), true);
  assert.equal(T.isNew('gv', 'APS012345', ''), true);
  assert.equal(T.isNew('gv', '012345', ''), true, 'digits-only ID (Tag Request) bhi match');
  assert.equal(T.isNew('ff', '999999', 'Old Agent'), false);
  assert.equal(T.isNew('gv', '123456', ''), false, 'channel alag → match nahi');
  assert.equal(T.isNew('', '123456', ''), true, 'channel unknown → dono dekho');
  assert.equal(T.isNew('ff', '', 'fresh  agent'), true, 'ID na ho to naam se');
  assert.equal(T.isNew('ff', '999999', 'Fresh Agent'), false, 'ID hai to naam se override nahi');
  assert.match(T.html('ff', '123456', ''), /NEW Agent/);
  assert.equal(T.html('ff', '999999', ''), '');
});
