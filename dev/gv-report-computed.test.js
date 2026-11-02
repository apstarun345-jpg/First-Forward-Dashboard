/* v3.125.46 — GV agent report site khud banati hai: Tag Assignment (agent/TL/stock) + GV Master (issuance). */
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
const U = FF.util;

test('GV report rows come from Tag Assignment + GV Master (no GV REPORT tab)', async () => {
  const rd = U.reportDate(); const cur = U.ymKey(rd);
  const lastD = new Date(rd.getFullYear(), rd.getMonth() - 1, 10);
  const sheets = [];
  FF.data.query = async (sheet, sql) => {
    sheets.push(sheet);
    if (sheet === 'Tag Assignment' && /limit/.test(sql)) return { cols: ['VEHICLE_CLASS', 'TAG_ID', 'SERIAL_NUMBER', 'TAG_STATUS', 'AGENT_ID', 'AGENT_NAME', 'SUPERVISOR_ID', 'SUPERVISOR_NAME'].map((label) => ({ label })), rows: [] };
    if (sheet === 'Tag Assignment') {
      const row = (id, name, tid, tn, cls, st, n) => [id, name, tid, tn, cls, st, n].map((v) => ({ v }));
      return { cols: [], rows: [
        row('APS1', 'Ravi', 'TL9', 'Kamal', 'VC4', 'In Stock', 3),
        row('APS1', 'Ravi', 'TL9', 'Kamal', 'VC7', 'In Stock', 2),
        row('APS1', 'Ravi', 'TL9', 'Kamal', 'VC4', 'Issued', 50),
        row('Not Assigned', ' ', '', ' ', 'VC4', 'In Stock', 999),
        row('APS2', 'Sita', '', ' ', 'VC4', 'In Stock', 40)
      ] };
    }
    throw new Error('unexpected sheet ' + sheet);
  };
  const mk = (d, id, cch) => ({ date: d, ym: U.ymKey(d), agentId: id, agentName: id === 'APS1' ? 'Ravi' : 'Sita', tlId: id === 'APS1' ? 'TL9' : '', tlName: id === 'APS1' ? 'Kamal' : 'Direct', cch, cls: cch, status: 'Issuance' });
  FF.gv.state.data.master = [mk(rd, 'APS1', 'VC4'), mk(rd, 'APS1', 'VC7'), mk(lastD, 'APS1', 'VC4'), mk(lastD, 'APS2', 'VC4')];
  const rows = await FF.gv.need('report', { only: true });
  assert.ok(!sheets.includes('GV REPORT'), 'GV REPORT tab nahi padha');
  const ravi = rows.find((r) => r.agentId === 'APS1'), sita = rows.find((r) => r.agentId === 'APS2');
  assert.equal(rows.length, 2, 'Not Assigned skip');
  assert.equal(ravi.stockTotal, 5); assert.equal(ravi.stockVc4, 3); assert.equal(ravi.stockByClass.VC7, 2);
  assert.equal(ravi.tlName, 'Kamal'); assert.equal(ravi.tlId, 'TL9');
  assert.equal(ravi.curTotal, 2); assert.equal(ravi.curVc4, 1); assert.equal(ravi.curByClass.VC7, 1); assert.equal(ravi.lastTotal, 1);
  assert.equal(ravi.reportYm, cur);
  assert.equal(ravi.tlStockTotal, 5);
  assert.ok(/High|Medium|Low/.test(ravi.priority));
  assert.equal(sita.directAgent, true); assert.equal(sita.curTotal, 0); assert.equal(sita.lastTotal, 1);
  assert.equal(sita.priority, '🟢 Low');
  assert.equal(ravi.raw.length, Object.keys(FF.gv.REPORT_COLS).length);
});
