import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../tagIssued.js', import.meta.url), 'utf8');
function load() {
  const U = { clean: (v) => String(v == null ? '' : v).trim(), fmt: (n) => String(n), dateKey: (d) => d, ymKey: () => '', growth: (a, b) => (b ? ((a - b) / b) * 100 : null), spinner: () => '', pctOf: (a, b) => (b ? (a / b) * 100 : null) };
  const FF = { pages: {}, util: U, config: { directLabel: (a) => 'Direct', isDirectAgent: (a) => /direct/i.test(a.tlName || '') }, store: {}, gv: {}, model: {}, charts: {} };
  const win = { FF, localStorage: { getItem: () => null, setItem() {} }, document: {} };
  win.window = win;
  vm.runInNewContext(src, win);
  return FF.pages.tagIssued._test;
}

test('agent report: pivot, TL vs direct split, sort, performance %', () => {
  const t = load();
  const m = { from: '2026-10-26', to: '2026-10-26', ffTo: '2026-10-26', gvTo: '2026-10-26', prevFfRange: ['2026-10-25', '2026-10-25'], prevGvRange: ['2026-10-25', '2026-10-25'] };
  const r = (o) => ({ n: 1, cls: 'VC4', group: 'VC4', ...o });
  const rows = [
    ...Array(5).fill(0).map(() => r({ channel: 'GV Partner', id: 'G1', name: 'Gv One', tlId: 'T1', tlName: 'TL A', dateKey: '2026-10-26' })),
    ...Array(2).fill(0).map(() => r({ channel: 'GV Partner', id: 'G1', name: 'Gv One', tlId: 'T1', tlName: 'TL A', dateKey: '2026-10-25' })),
    ...Array(3).fill(0).map(() => r({ channel: 'GV Partner', id: 'G2', name: 'Gv Two', tlId: '', tlName: 'Direct', dateKey: '2026-10-26', cls: 'VC20', group: 'VC20' })),
    ...Array(9).fill(0).map(() => r({ channel: 'First Forward', id: 'F1', name: 'Ff One', tlId: 'T9', tlName: 'TL B', dateKey: '2026-10-26', cls: 'VC6', group: 'VC5+' })),
    r({ channel: 'First Forward', id: 'F1', name: 'Ff One', tlId: 'T9', tlName: 'TL B', dateKey: '2026-10-20' })   // outside both periods
  ];
  const gv = t.buildAgentReport(rows, m, 'gv');
  assert.equal(gv.list.length, 2); assert.equal(gv.grandTotal, 8);
  assert.equal(gv.list[0].name, 'Gv One'); assert.equal(gv.list[0].total, 5); assert.equal(gv.list[0].prev, 2); assert.equal(gv.list[0].perf, 150);
  assert.equal(gv.list[1].direct, true); assert.equal(gv.list[1].vc20, 3); assert.equal(gv.list[1].perf, null);
  const both = t.buildAgentReport(rows, m, 'both');
  assert.equal(JSON.stringify(both.list.map((o) => o.name)), JSON.stringify(['Ff One', 'Gv One', 'Gv Two']), 'highest → lowest across channels');
  assert.equal(both.list[0].vc5, 9); assert.equal(both.grandTotal, 17);
  const sheets = t.reportSheets(both, m, 'both');
  assert.equal(sheets.map((s) => s.name).join('|'), 'Pivot (TL wise)|TL Agents|Direct Agents|Info');
  assert.equal(sheets[1].rows.length, 3, 'two TL agents + total row');
  assert.equal(sheets[2].rows.length, 2, 'one direct agent + total row');
  assert.equal(sheets[0].rows.at(-1)[9], 17, 'pivot grand total');
  const csv = t.reportCsv(both);
  assert.equal(csv.head[5], 'Type'); assert.equal(csv.rows.length, 3); assert.equal(csv.rows[2][5], 'Direct agent');
  assert.ok(['Agent ID', 'Agent Name', 'TL Name', 'TL ID', 'Channel', 'VC4', 'VC20', 'VC5+', 'Total'].every((h) => csv.head.includes(h)));
});

test('Tag Issued toolbar has the Report dropdown with GV / FF / GV+FF', () => {
  assert.match(src, /id="ti-report-btn"/);
  for (const label of ['GV Report', 'First Forward Report', 'GV + FF Report']) assert.ok(src.includes(label), label);
});
