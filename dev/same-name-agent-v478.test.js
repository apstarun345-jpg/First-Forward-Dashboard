import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { hash: '#/home', href: '' };
globalThis.document = { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false,
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true }, addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
['config', 'util', 'data', 'model', 'store', 'charts', 'gv', 'gvTruth'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF; const U = FF.util;
FF.auth = { can: () => true, settings: {}, isAdmin: () => true };
FF.store.get = () => []; FF.store.need = async () => [];
require(path.join(ROOT, 'masterProfile.js'));
const ym = U.ymKey(new Date());
const d = new Date(); d.setDate(Math.max(1, d.getDate() - 2));
const master = [1,2,3,4,5].map((i) => ({ agentId: 'APS023113', agentName: 'SUSHIL KUMAR', tlId: 'APS020013', supervisorId: 'APS020013', tlName: 'RUDRA ENTERPRISES', cls: 'VC4', group: 'VC4', date: d, key: U.dateKey(d), ym, day: d.getDate(), tagId: 'T' + i, vrn: 'V' + i, n: 1 }));
const stockAgent = [
  { agentId: 'APS023113', agentName: 'SUSHIL KUMAR', tlId: 'APS020013', tlName: 'RUDRA ENTERPRISES', n: 28, nAll: 28, byStatus: {} },
  { agentId: 'APS111', agentName: 'Sushil Kumar', tlId: 'APS015349', tlName: 'Varsha Kanwar', n: 10, nAll: 10, byStatus: {} },
  { agentId: 'APS018799', agentName: 'Sushil Kumar', tlId: '', tlName: 'Direct', n: 19, nAll: 19, byStatus: {} }];
const data = { master, stockAgent, report: [], stockAgentClass: [], stockTl: [], stockTlClass: [] };
FF.gv.get = (k) => data[k] || [];
FF.gv.need = async (k) => data[k] || [];
FF.gv.rows = () => master; FF.gv.masterRows = () => master;
test('APS111', async () => {
  const pr = await FF.masterProfile.build({ kind: 'gv-agent', name: 'Sushil Kumar', sub: 'APS111', tlSet: new Set(), classMap: new Map(), bars: new Set() });
  console.log(JSON.stringify({ id: pr.id, tl: pr.tl, stock: pr.stock, totals: pr.totals }));
  assert.equal(pr.id, 'APS111');
  assert.equal(pr.stock.total, 10);
  assert.equal(pr.totals.curTotal, 0);
});
test('summary flow APS111', async () => {
  require(path.join(ROOT, 'agentSummary.js'));
  const A = FF.agentSummary;
  const list = await A.loadPeople('gv');
  const sk = list.filter((p) => /sushil/i.test(p.name));
  console.log('LIST', JSON.stringify(sk.map((p) => [p.kind, p.id, p.tl, p.stock, p.cur])));
  const person = list.find((p) => p.id === 'APS111');
  const rep = await A.buildReport(person, { age: false });
  console.log('REP', JSON.stringify({ id: rep.p.id, tl: rep.p.tlName, stock: rep.p.totals.stockTotal, cur: rep.p.totals.curTotal }));
  assert.equal(rep.p.id, 'APS111');
  assert.equal(rep.p.totals.stockTotal, 10);
  assert.equal(rep.p.totals.curTotal, 0);
});
