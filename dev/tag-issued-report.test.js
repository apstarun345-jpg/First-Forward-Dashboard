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

test('agent report: GV from GV Master, FF TL from REPORT, TLs + direct sheets, performance', () => {
  const t = load();
  const m = { from: '2026-10-26', to: '2026-10-26', prevFfRange: ['2026-10-25', '2026-10-25'], prevGvRange: ['2026-10-25', '2026-10-25'], ff: { total: 10 }, gv: { total: 8 } };
  const gvRow = (o) => ({ date: o.d, group: 'VC4', cls: 'VC4', agentId: o.id, agentName: o.name, tlName: o.tl || '', tlId: o.tlId || '' });
  const rawGvMaster = [
    ...Array(5).fill(0).map(() => gvRow({ d: '2026-10-26', id: 'G1', name: 'Gv One', tl: 'TL A', tlId: 'T1' })),
    ...Array(2).fill(0).map(() => gvRow({ d: '2026-10-25', id: 'G1', name: 'Gv One', tl: 'TL A', tlId: 'T1' })),
    ...Array(3).fill(0).map(() => ({ ...gvRow({ d: '2026-10-26', id: 'G2', name: 'Gv Two' }), group: 'VC20' }))
  ];
  const dailyRows = [
    { channel: 'First Forward', agentId: 'F1', agentName: 'Ff One', key: '2026-10-26', group: 'VC5+', n: 9 },
    { channel: 'First Forward', agentId: 'F2', agentName: 'Ff Two', key: '2026-10-26', group: 'VC4', n: 1 },
    { channel: 'First Forward', agentId: 'F2', agentName: 'Ff Two', key: '2026-10-25', group: 'VC4', n: 4 },
    { channel: 'GV Partner', agentId: '', agentName: '', key: '2026-10-26', group: 'VC4', n: 8 }   // EIR GV rows are not used for agent detail
  ];
  const dir = { ff: (id) => (id === 'F1' ? { name: 'Ff One', tlName: 'TL B', tlId: 'T9', mobile: '9000000001' } : null), gv: (id) => (id === 'G1' ? '9000000002' : '') };
  const inputs = t.reportInputs({ dailyRows, rawGvMaster }, dir);
  const both = t.buildAgentReport(inputs, m, 'both');
  assert.equal(JSON.stringify(both.list.map((o) => o.name)), JSON.stringify(['Ff One', 'Gv One', 'Gv Two', 'Ff Two']));
  const f1 = both.list[0]; assert.equal(f1.tlName, 'TL B'); assert.equal(f1.direct, false); assert.equal(f1.mobile, '9000000001'); assert.equal(f1.vc5, 9);
  const g1 = both.list[1]; assert.equal(g1.perf, 150); assert.equal(g1.status, '▲ Up'); assert.equal(g1.mobile, '9000000002');
  assert.equal(both.list[2].direct, true); assert.equal(both.list[2].status, '★ New');
  const f2 = both.list[3]; assert.equal(f2.direct, true); assert.equal(f2.perf, -75); assert.equal(f2.status, '▼ Down');
  assert.equal(both.chTot.ff, 10); assert.equal(both.chTot.gv, 8);
  const sheets = t.reportSheets(both, m, 'both');
  assert.equal(sheets.map((s) => s.name).join('|'), 'TLs (GV + FF)|Direct Agents (GV + FF)|Agents under TLs (GV + FF)|Info');
  const tls = sheets[0].rows;
  assert.equal(tls[0][2], 'TL B'); assert.equal(tls[0][8], 9); assert.equal(tls[1][2], 'TL A'); assert.equal(tls[1][3], 'GV');
  assert.equal(tls.at(-1)[2], 'GRAND TOTAL'); assert.equal(tls.at(-1)[8], 18);
  const direct = sheets[1].rows;
  assert.equal(direct.length, 3, 'GV + FF direct agents combined + total');
  assert.equal(direct[0][2], 'Gv Two'); assert.equal(direct[1][2], 'Ff Two'); assert.equal(direct[2][2], 'TOTAL · direct agents'); assert.equal(direct[2][10], 4);
  const gvOnly = t.reportSheets(t.buildAgentReport(inputs, m, 'gv'), m, 'gv');
  assert.equal(gvOnly[0].name, 'TLs (GV)'); assert.equal(gvOnly[0].rows[0][2], 'TL A');
  const csv = t.reportCsv(both);
  assert.equal(csv.head[3], 'Mobile'); assert.equal(csv.head[6], 'Type'); assert.ok(csv.head.includes('Performance'));
});

test('Tag Issued toolbar has the Report dropdown with GV / FF / GV+FF', () => {
  assert.match(src, /id="ti-report-btn"/);
  for (const label of ['GV Report', 'First Forward Report', 'GV + FF Report']) assert.ok(src.includes(label), label);
});
