// 🛰️ v3.125.264 — GV API Report: clickable boxes (Chassis / Replacement / Wrong VRN alag) + file name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function boot() {
  const FF = { util: { esc: (s) => String(s), dateKey: () => '2026-11-14' }, pages: {}, auth: { can: () => true } };
  const ctx = { window: { FF }, FF, console, Date, Number, String, Set, Map, Math, JSON };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../gvApiReport.js', import.meta.url), 'utf8'), ctx);
  return FF.pages.gvApiReport._test;
}
const R = (o) => ({ id: '1', agent: 'RAM', supId: 'T1', supName: 'TL ONE', cls: 'VC4', status: 'issued', vrnSt: '', commission: 10, amount: 100, day: '2026-11-10', added: '2026-11-10 10:00:00', time: '10:00:00', ...o });

test('boxes filter the right records', () => {
  const T = boot();
  T.st.rows = [R({}), R({ status: 'Replacement' }), R({ vrnSt: 'chassis', cls: 'VC20' }), R({ vrnSt: 'wrong', cls: 'VC5+' }), R({ id: '2', agent: 'SHYAM', commission: null })];
  const all = T.filtered();
  const n = (k) => { T.st.box = k; return T.boxed(all).length; };
  assert.equal(n('total'), 5); assert.equal(n('repl'), 1); assert.equal(n('issuance'), 4);
  assert.equal(n('chassis'), 1); assert.equal(n('wrong'), 1); assert.equal(n('VC4'), 3); assert.equal(n('comm'), 4);
  T.st.box = '';
  const html = T.viewSummary(all);
  for (const k of ['total', 'repl', 'chassis', 'wrong', 'VC4', 'agents']) assert.ok(html.includes(`data-gar-box="${k}"`), k);
});

test('file name = agent name - box label', () => {
  const T = boot();
  T.st.rows = [R({}), R({ id: '2', agent: 'SHYAM' })];
  T.st.f.agentId = '1'; T.st.box = 'chassis';
  assert.equal(T.fileBase(T.filtered()), 'RAM - Chassis');
  T.st.f.agentId = ''; T.st.box = 'repl';
  assert.equal(T.fileBase(T.filtered()), 'All agents - Replacement');
  T.st.f.tl = 'tl one'; T.st.box = ''; T.st.tab = 'summary';
  assert.equal(T.fileBase(T.filtered()), 'TL ONE - Total tags');
});
