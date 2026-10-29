import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../agentsOverview.js', import.meta.url), 'utf8');
function boot(perf, gvStock, gvReport, roll) {
  const U = { esc: (s) => String(s), clean: (s) => String(s == null ? '' : s).trim(), fmt: (n) => String(n), sum: (a, f) => a.reduce((s, x) => s + f(x), 0), ymKey: () => '2026-10', stamp: () => 'x', spinner: () => '', errorBox: () => '' };
  const FF = {
    util: U, pages: { performance: { ensureLoaded: async () => {}, agents: () => perf } },
    config: { isDirectAgent: (r) => /APS/i.test(r.tlName || '') || r.directAgent === true },
    store: { need: async (k) => (k === 'stockAgents' ? [{ agentId: '3', agentName: 'C', cls: 'VC4', n: 20 }, { agentId: '3', agentName: 'C', cls: 'VC20', n: 10 }] : []) }, kpiDetail: { registerList() {} }, auth: { can: () => true },
    gv: { need: async (k) => (k === 'stockAgent' ? gvStock : k === 'stockAgentClass' ? [{ agentId: 'G1', agentName: 'G One', cls: 'VC12', n: 4 }] : gvReport), latestDate: () => new Date(2026, 9, 28), agentRollup: (ym) => roll[ym] || [] }
  };
  const win = { FF }; win.window = win;
  vm.runInNewContext(code, { window: win, FF, Date, console });
  return win.FF;
}
test('agents summary: direct/TL × active/inactive buckets, stock-only', async () => {
  const perf = [
    { agentId: '1', name: 'A', tlName: 'APS', stockTotal: 10, curTotal: 5, lastTotal: 0 },      // direct active
    { agentId: '2', name: 'B', tlName: 'APS', stockTotal: 20, curTotal: 0, lastTotal: 3 },      // direct inactive this month
    { agentId: '3', name: 'C', tlName: 'T1', tlId: 't1', stockTotal: 30, curTotal: 0, lastTotal: 0 }, // managed inactive 2m
    { agentId: '4', name: 'D', tlName: 'T1', tlId: 't1', stockTotal: 40, curTotal: 2, lastTotal: 2 }, // managed active
    { agentId: '5845036', name: 'APNA PAYMENT', tlName: 'APS', stockTotal: 999, curTotal: 0, lastTotal: 0 },
    { agentId: '5', name: 'E', tlName: 'T2', stockTotal: 0, curTotal: 9, lastTotal: 9 }              // no stock → excluded
  ];
  const gvStock = [{ agentId: 'Not Assigned', agentName: 'Not Assigned', n: 500 }, { agentId: 'G1', agentName: 'G One', tlName: '', tlId: '', n: 7 }, { agentId: 'G1', agentName: 'G One', n: 3 }, { agentId: 'G2', agentName: 'G Two', tlName: 'GT', tlId: 'gt', n: 5, directAgent: false }];
  const FFx = boot(perf, gvStock, [], { '2026-10': [{ agentId: 'G2', total: 4 }], '2026-09': [{ agentId: 'G1', total: 6 }] });
  const AO = FFx.agentsOverview;
  await AO.load(true);
  const ff = AO.stat('ff');
  assert.equal(ff.all.n, 4); assert.equal(ff.all.stock, 100);
  assert.equal(ff.direct.n, 2); assert.equal(ff['d.active'].n, 1); assert.equal(ff['d.in1'].stock, 20); assert.equal(ff['d.in2'].n, 0);
  assert.equal(ff.managed.n, 2); assert.equal(ff['m.in2'].stock, 30); assert.equal(ff['m.active'].n, 1);
  assert.equal(ff.tls.n, 1); assert.equal(ff.inactive.stock, 50);
  const gv = AO.stat('gv');
  assert.equal(gv.all.n, 2); assert.equal(gv.all.stock, 15, 'Not Assigned excluded');
  assert.equal(gv.in1.n, 1, 'G1 issued last month only'); assert.equal(gv.active.n, 1);
  assert.equal(AO.stat('both').all.n, 6);
  assert.equal(AO.listFor('both', 'in2').length, 1);
  const c = AO.listFor('ff', 'm.in2')[0]; assert.equal(c.cls.VC4, 30, 'VC20 folds into VC4/20');
  assert.equal(AO.listFor('gv', 'in1')[0].cls.VC12, 4);
  assert.equal(AO.listFor('gv', 'm.active').length, 1, 'TL agent stays TL-managed');
  assert.equal(AO.listFor('gv', 'd.in2').length, 0, 'TL agents never in Direct inactive 2 months');
});

test('GV: last month from REPORT when EIR has no previous month', async () => {
  const gvStock = [{ agentId: 'G1', agentName: 'G One', tlName: '', tlId: '', n: 5, directAgent: true }, { agentId: 'G2', agentName: 'G Two', tlName: 'GT', tlId: 'gt', n: 5 }, { agentId: 'G3', agentName: 'G Three', tlName: 'GT', tlId: 'gt', n: 5 }];
  const rep = [{ agentId: 'G1', agentName: 'G One', curTotal: 0, lastTotal: 8 }, { agentId: 'G2', agentName: 'G Two', curTotal: 0, lastTotal: 0 }, { agentId: 'G3', agentName: 'G Three', curTotal: 0, lastTotal: 3 }];
  const AO = boot([], gvStock, rep, { '2026-10': [{ agentId: 'G9', total: 1 }] }).agentsOverview;
  await AO.load(true);
  assert.equal(JSON.stringify(AO.listFor('gv', 'd.in1').map((r) => r.id)), JSON.stringify(['G1']));
  assert.equal(JSON.stringify(AO.listFor('gv', 'm.in1').map((r) => r.id)), JSON.stringify(['G3']));
  assert.equal(JSON.stringify(AO.listFor('gv', 'm.in2').map((r) => r.id)), JSON.stringify(['G2']));
  assert.equal(AO.listFor('gv', 'd.in2').length, 0);
});
