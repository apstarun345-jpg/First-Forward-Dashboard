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

test('agent report: GV Master details remain visible and EIR difference is an explicit reconciliation row', () => {
  const t = load();
  const m = { from: '2026-10-26', to: '2026-10-26', prevFfRange: ['2026-10-25', '2026-10-25'], prevGvRange: ['2026-10-25', '2026-10-25'], ff: { total: 10 }, gv: { total: 8 } };
  const gvRow = (o) => ({ date: o.d, group: o.group || 'VC4', cls: o.cls || 'VC4', agentId: o.id, agentName: o.name, tlName: o.tl || '', tlId: o.tlId || '' });
  const rawGvMaster = [
    ...Array(5).fill(0).map(() => gvRow({ d: '2026-10-26', id: 'G1', name: 'Gv One', tl: 'TL A', tlId: 'T1' })),
    ...Array(2).fill(0).map(() => gvRow({ d: '2026-10-25', id: 'G1', name: 'Gv One', tl: 'TL A', tlId: 'T1' })),
    ...Array(3).fill(0).map(() => ({ ...gvRow({ d: '2026-10-26', id: 'G2', name: 'Gv Two' }), group: 'VC20' })),
    ...Array(12).fill(0).map(() => gvRow({ d: '2026-10-26', id: 'MASTER-ONLY', name: 'Master Only Agent' }))
  ];
  const dailyRows = [
    { channel: 'First Forward', agentId: 'F1', agentName: 'Ff One', key: '2026-10-26', group: 'VC5+', n: 9 },
    { channel: 'First Forward', agentId: 'F2', agentName: 'Ff Two', key: '2026-10-26', group: 'VC4', n: 1 },
    { channel: 'First Forward', agentId: 'F2', agentName: 'Ff Two', key: '2026-10-25', group: 'VC4', n: 4 },
    { channel: 'GV Partner', agentId: 'G1', agentName: 'Gv One', tlName: 'TL A', tlId: 'T1', key: '2026-10-26', group: 'VC4', n: 5 },
    { channel: 'GV Partner', agentId: 'G1', agentName: 'Gv One', tlName: 'TL A', tlId: 'T1', key: '2026-10-25', group: 'VC4', n: 2 },
    { channel: 'GV Partner', agentId: 'G2', agentName: 'Gv Two', key: '2026-10-26', group: 'VC20', n: 3 }
  ];
  const dir = { ff: (id) => (id === 'F1' ? { name: 'Ff One', tlName: 'TL B', tlId: 'T9', mobile: '9000000001' } : null), gv: (id) => (id === 'G1' ? '9000000002' : '') };
  const inputs = t.reportInputs({ dailyRows, rawGvMaster }, dir);
  const both = t.buildAgentReport(inputs, m, 'both');
  const byName = (name) => both.list.find((o) => o.name === name);
  assert.ok(byName('Gv One'), 'GV Master agent row must remain visible');
  assert.ok(byName('Gv Two'), 'GV direct agent row must remain visible');
  assert.ok(byName('Master Only Agent'), 'GV Master row-level detail must remain visible for audit');
  assert.equal(byName('Gv One').total, 5);
  assert.equal(byName('Gv One').prev, 2);
  assert.equal(byName('Gv One').mobile, '9000000002');
  assert.equal(byName('Gv Two').total, 3);
  assert.equal(byName('Ff One').total, 9);
  assert.equal(byName('Ff One').tlName, 'TL B');
  assert.equal(byName('Ff Two').perf, -75);
  const recon = both.list.find((o) => o.sourceAdjustment);
  assert.ok(recon, 'visible reconciliation row must be created');
  assert.equal(recon.total, -12, 'Master has 12 more VC4 rows than EIR for this day');
  assert.equal(both.chTot.ff, 10);
  assert.equal(both.chTot.gv, 8);
  assert.equal(both.grandTotal, 18);
  assert.equal(t.reportSheets(both, m, 'both')[0].rows.at(-1)[8], 18);
  const gvOnly = t.reportSheets(t.buildAgentReport(inputs, m, 'gv'), m, 'gv');
  assert.equal(gvOnly[0].name, 'TLs (GV)');
  assert.equal(gvOnly[0].rows.at(-1)[8], 8);
  const csv = t.reportCsv(both);
  assert.ok(csv.head.includes('Type'));
  assert.ok(csv.rows.some((row) => row[csv.head.indexOf('Type')] === 'Source reconciliation'));
});


test('GV EIR rows without agent identity still appear as an unassigned reconciliation row', () => {
  const t = load();
  const m = { from: '2026-10-26', to: '2026-10-26', prevGvRange: null };
  const dailyRows = [{ channel: 'GV Partner', agentId: '', agentName: '', key: '2026-10-26', group: 'VC4', n: 7 }];
  const inputs = t.reportInputs({ dailyRows, rawGvMaster: [] }, { ff: () => null, gv: () => '' });
  const rep = t.buildAgentReport(inputs, m, 'gv');
  assert.equal(rep.chTot.gv, 7);
  assert.equal(rep.grandTotal, 7);
  assert.ok(rep.list[0].sourceAdjustment);
  assert.equal(rep.list[0].name, 'GV source reconciliation · VC4');
  assert.equal(rep.list[0].total, 7);
});

test('Tag Issued toolbar has the Report dropdown with GV / FF / GV+FF', () => {
  assert.match(src, /id="ti-report-btn"/);
  for (const label of ['GV Report', 'First Forward Report', 'GV + FF Report']) assert.ok(src.includes(label), label);
});

test('Report chips after Custom open the same report on screen', () => {
  assert.match(src, /data-rep-view="\$\{k\}"/);
  assert.match(src, /function openReportView\(which\)/);
  assert.match(src, /if \(rv\) \{ openReportView\(rv\.dataset\.repView\); return; \}/);
  assert.match(src, /async function makeReport\(which\)/);
});

test('agent report: custom multi-month range adds month-wise VC4 / VC20 / VC5+ columns + summary sheet', () => {
  const t = load();
  const m = { from: '2026-09-01', to: '2026-11-03', prevFfRange: null, prevGvRange: null, ff: { total: 0 }, gv: { total: 0 } };
  const dailyRows = [
    { channel: 'First Forward', agentId: 'F1', agentName: 'Ff One', key: '2026-09-10', group: 'VC4', n: 5 },
    { channel: 'First Forward', agentId: 'F1', agentName: 'Ff One', key: '2026-10-10', group: 'VC20', n: 2 },
    { channel: 'First Forward', agentId: 'F1', agentName: 'Ff One', key: '2026-11-02', group: 'VC5+', n: 1 }
  ];
  const dir = { ff: () => ({ name: 'Ff One', tlName: 'TL B', tlId: 'T9' }), gv: () => '' };
  const rep = t.buildAgentReport(t.reportInputs({ dailyRows, rawGvMaster: [] }, dir), m, 'ff');
  assert.equal(JSON.stringify(rep.months), JSON.stringify(['2026-09', '2026-10', '2026-11']));
  const sheets = t.reportSheets(rep, m, 'ff');
  assert.equal(sheets[0].name, 'Month-wise summary');
  assert.equal(JSON.stringify(sheets[0].rows[0].slice(2, 7)), JSON.stringify(['FF', 5, 0, 0, 5]));
  const tl = sheets[1];
  assert.ok(tl.header.includes('Sep 26 VC4') && tl.header.includes('Nov 26 Total'));
  const i = tl.header.indexOf('Oct 26 VC20'); assert.equal(tl.rows[0][i], 2);
  assert.ok(tl.header.includes('Oct 26 vs Sep 26 %'));   // Nov partial → last two full months compared
  assert.equal(tl.rows[0][tl.header.indexOf('Oct 26 vs Sep 26 %')], -60);
  assert.equal(typeof tl.styleOf, 'function');
  const csv = t.reportCsv(rep); assert.equal(csv.rows[0][csv.head.indexOf('Nov 26 VC5+')], 1);
});
