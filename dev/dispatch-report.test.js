/* Gviz-shape fixtures matching dev/mock-gviz.js + the configured REPORT ranges/columns. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFfDispatchRows, loadGvDispatchRows } from '../dispatch-report.js';

const cell = (v) => v === '' || v === null || v === undefined ? null : { v };
const gvizRow = (values) => ({ c: values.map(cell) });
const blankRow = () => Array(80).fill('');
const FF_H1 = blankRow(), FF_H2 = blankRow();
const section = (start, title, columns) => { FF_H1[start] = title; columns.forEach((name, i) => { FF_H2[start + i] = name; }); };
section(0, 'Agent Profile Details', ['Agent ID', 'ID', 'Name']);
section(3, "TL's Master Data", ['GV ID Found', 'TL ID', 'Mo. Number', 'TL Name']);
section(7, 'Agent Inventory Summary', ['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16', 'Total', 'NVC4']);
section(15, 'Fastag Dispatch Details (VC4)', ['Stock Days', 'Projected', 'Priority Level', 'Stock Alert']);
section(19, "TL's Stock Details", ['VC4', 'NVC4', 'Total']);
section(22, 'Performance In - Aug', ['Active Days', 'VC4', 'NVC4', 'Total']);
section(26, 'Performance In - Sep', ['Wrong VRN', 'X', 'VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16', 'NVC4', 'Total']);
section(40, 'Agents Performance Status', ['Last vs Current', 'Last Active', 'Agent Status']);
section(65, 'Agent Wise', ['Daily Avg', 'Stock Days', 'Priority Level']);
const ffManaged = blankRow();
Object.assign(ffManaged, { 0: 'F100', 1: '100', 2: 'Asha FF', 4: 'T10', 6: 'Team Ten', 7: 100, 13: 120, 14: 20, 17: '🟡 Medium', 19: 250, 20: 80, 21: 330, 23: 140, 24: 20, 25: 160, 28: 280, 34: 30, 35: 310, 42: 'Active', 67: '🔴 High' });
const ffDirect = blankRow();
Object.assign(ffDirect, { 0: 'F200', 1: '200', 2: 'Direct FF', 6: 'APS', 7: 4, 13: 4, 14: 0, 17: '🔴 High', 23: 0, 24: 0, 25: 0, 28: 56, 34: 0, 35: 56, 42: 'Active', 67: '🟢 Low' });
const ffMaster = blankRow();
Object.assign(ffMaster, { 0: '5845036', 1: '5845036', 2: 'APNA PAYEMENT', 4: '5845036', 6: 'ApnaPayment Pvt. Ltd.', 35: 999 });
const FF_COLS = FF_H1.map((_, i) => ({ id: String.fromCharCode(65 + (i % 26)), label: '', type: 'string' }));
const FF_RAW = { cols: FF_COLS, rows: [FF_H1, FF_H2, ffMaster, ffManaged, ffDirect].map(gvizRow) };
const FF_PARSED = { cols: FF_H1.map((label, i) => ({ ...FF_COLS[i], label })), parsedNumHeaders: 1, rows: [FF_H2, ffMaster, ffManaged, ffDirect].map(gvizRow) };
const settings = { direct: { enabled: true, ffTlNames: ['APS'], gvNoTl: true, gvSelfSupervised: true, labelFf: 'Direct Agent (APS)', labelGv: 'Direct Agent (no TL)' }, excludeTls: ['APS'] };

test('FF REPORT parser maps section headings to the same source columns and drops the master aggregate', () => {
  const rows = loadFfDispatchRows(FF_RAW, settings);
  assert.equal(rows.length, 2);
  const asha = rows.find((r) => r.agentId === 'F100');
  assert.ok(asha);
  assert.equal(asha.name, 'Asha FF');
  assert.equal(asha.tlName, 'Team Ten');
  assert.equal(asha.priority, '🔴 High');
  assert.equal(asha.tlPriority, '🟡 Medium');
  assert.equal(asha.cur.vc4, 280);
  assert.equal(asha.cur.comm, 30);
  assert.equal(asha.cur.total, 310);
  assert.equal(asha.last.total, 160);
  assert.equal(asha.stock.total, 120);
  assert.equal(asha.tlStock.total, 330);
  assert.equal(asha.direct, false);
  const direct = rows.find((r) => r.agentId === 'F200');
  assert.equal(direct.direct, true);
  assert.equal(direct.directLabel, 'Direct Agent (APS)');
  assert.equal(direct.priority, '🟢 Low');
});

test('FF parser handles Gviz column labels that have consumed report row 1 without shifting data', () => {
  const rows = loadFfDispatchRows(FF_PARSED, settings);
  assert.deepEqual(rows.map((r) => r.agentId), ['F100', 'F200']);
  assert.equal(rows[0].cur.total, 310);
  assert.equal(rows[1].direct, true);
});

test('GV REPORT A4:AZ fixture matches gv.js REPORT_COLS, including priority, totals and no-TL flag', () => {
  const managed = Array(52).fill('');
  Object.assign(managed, { 1: 'G100', 2: 'Asha GV', 3: 'GT10', 4: 'GV Team Ten', 7: 90, 11: 120, 12: 30, 15: '🔴 High', 16: 180, 17: 50, 18: 230, 20: 70, 21: 20, 22: 90, 24: 'Active', 30: 140, 36: 28, 37: 168, 51: 'SUP-10' });
  const direct = Array(52).fill('');
  Object.assign(direct, { 1: 'G200', 2: 'Direct GV', 7: 5, 11: 5, 12: 0, 15: 'Review soon', 22: 0, 24: 'Active', 30: 28, 36: 0, 37: 28 });
  // GV range A4:AZ consumes row 4 as column labels; table.rows begins at row 5.
  const rows = loadGvDispatchRows({ cols: Array.from({ length: 52 }, (_, i) => ({ id: `C${i}`, label: '', type: 'string' })), rows: [gvizRow(managed), gvizRow(direct)] }, settings);
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.agentId === 'G100');
  assert.equal(a.priority, '🔴 High');
  assert.equal(a.tlName, 'GV Team Ten');
  assert.equal(a.tlId, 'GT10', 'the report TL ID column wins when populated');
  assert.deepEqual(a.cur, { vc4: 140, comm: 28, total: 168 });
  assert.deepEqual(a.last, { vc4: 70, comm: 20, total: 90 });
  assert.deepEqual(a.stock, { vc4: 90, comm: 30, total: 120 });
  assert.deepEqual(a.tlStock, { vc4: 180, comm: 50, total: 230 });
  assert.equal(a.direct, false);
  const d = rows.find((r) => r.agentId === 'G200');
  assert.equal(d.direct, true);
  assert.equal(d.directLabel, 'Direct Agent (no TL)');
  assert.equal(d.priority, 'Review soon', 'unknown sheet priority stays verbatim');
});

test('dispatch direct classification respects configurable TL placeholders and self-supervised setting', () => {
  const withPlaceholder = { ...settings, directPlaceholderTls: ['Field Support'] };
  const ff = blankRow(); Object.assign(ff, { 0: 'F300', 2: 'Placeholder FF', 6: 'Field Support', 28: 20, 35: 20 });
  assert.equal(loadFfDispatchRows({ cols: FF_COLS, rows: [FF_H1, FF_H2, ff].map(gvizRow) }, withPlaceholder)[0].direct, true);
  const self = Array(52).fill(''); Object.assign(self, { 1: 'G300', 2: 'Self GV', 3: 'G300', 4: 'Self GV', 15: '🟢 Low' });
  assert.equal(loadGvDispatchRows({ rows: [gvizRow(self)] }, settings)[0].direct, true);
  assert.equal(loadGvDispatchRows({ rows: [gvizRow(self)] }, { ...settings, direct: { ...settings.direct, gvSelfSupervised: false } })[0].direct, false);
});
