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

test('ID aliases (Sheet4): Assistant / Agent ID → New Agent ID; ambiguous or real New IDs untouched', () => {
  const A = FF.aliases;
  A._build([
    { a: '1000001', b: '555001', m: '777001', n: 'Agent One', tid: 'T1', tn: 'TL One' },
    { a: '1000002', b: '', m: '777002', n: 'Agent Two' },
    { a: '1000003', b: '', m: '777002', n: 'Agent Three' },          // same assistant under two agents → ambiguous
    { a: '1000004', b: '555004', m: '1000001', n: 'Agent Four' }     // assistant id equals another agent's New ID
  ]);
  assert.equal(A.resolve('777001').to, '1000001');
  assert.equal(A.resolve('777001').kind, 'Assistant ID');
  assert.equal(A.resolve(' 555001 ').kind, 'Agent ID');
  assert.equal(A.map('777001'), '1000001');
  assert.equal(A.map('777002'), '777002', 'ambiguous assistant → rewrite nahi');
  assert.equal(A.map('1000001'), '1000001', 'real New ID par rewrite nahi');
  assert.equal(A.map('Agent One'), 'Agent One', 'naam par rewrite nahi');
  assert.equal(A.map('123'), '123', 'chhota text nahi');
  assert.deepEqual(A.of('1000001').assist, ['777001']);
  assert.equal(A.of('1000001').agentId, '555001');
  assert.match(A.chipsHtml('1000001'), /Assistant ID[\s\S]*777001/);
});
