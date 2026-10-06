import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.location = { hash: '#/gvAgentSummary', href: '' };
globalThis.document = { addEventListener() {}, removeEventListener() {}, querySelector: () => null };
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'util.js'));
const FF = globalThis.FF;
require(path.join(ROOT, 'agentSummary.js'));

function setupGv() {
  const report = [
    { agentId: 'G1', agentName: 'GV Known', tlId: 'T1', tlName: 'GV Team', curTotal: 4, lastTotal: 2, stockTotal: 999 },
    { agentId: 'G2', agentName: 'GV Unknown', tlId: 'T1', tlName: 'GV Team', curTotal: 3, lastTotal: 1, stockTotal: 777 }
  ];
  const data = {
    report,
    stockAgent: [
      { agentId: 'G1', agentName: 'GV Known', tlId: 'T1', tlName: 'GV Team', n: 7 },
      { agentId: 'G2', agentName: 'GV Unknown', tlId: 'T1', tlName: 'GV Team', n: 9 }
    ],
    stockTl: [{ tlId: 'T1', tlName: 'GV Team', n: 11 }],
    stockAgentClass: [], stockTlClass: [], master: []
  };
  FF.gv = {
    need: async (key) => data[key] || [],
    get: (key) => data[key],
    issuanceRows: () => []
  };
  FF.gvTruth = {
    stockFor: ({ kind, name }) => {
      if (kind === 'gv-agent' && name === 'GV Known') return { authoritative: true, total: 7, vc4: 4, comm: 3, classAvailable: true };
      if (kind === 'gv-tl' && name === 'GV Team') return { authoritative: true, total: 11, vc4: 6, comm: 5, classAvailable: true };
      return { authoritative: false, total: 0, vc4: null, comm: null, classAvailable: false };
    }
  };
  FF.pages = { gvPerformance: { sourceRows: () => report, rows: () => report } };
  FF.store = { get: () => [], need: async () => [] };
  FF.masterProfile = { loadFor: async () => {}, quick: () => null };
}

test('GV Agent/TL Summary list takes stock only from Tag Assignment truth and preserves unavailable stock', async () => {
  setupGv();
  const list = await FF.agentSummary.loadPeople('gv');
  const known = list.find((p) => p.kind === 'gv-agent' && p.name === 'GV Known');
  const unknown = list.find((p) => p.kind === 'gv-agent' && p.name === 'GV Unknown');
  const tl = list.find((p) => p.kind === 'gv-tl' && p.name === 'GV Team');

  assert.equal(known.stock, 7, 'GV REPORT snapshot (999) must not replace Tag Assignment stock');
  assert.equal(known.stockAvailable, true);
  assert.equal(known.stockClassAvailable, true);
  assert.equal(unknown.stock, null, 'unavailable Tag Assignment stock must not be coerced to zero or use the report snapshot');
  assert.equal(unknown.stockAvailable, false);
  assert.equal(tl.stock, 11, 'TL stock comes from Tag Assignment truth');
  assert.equal(tl.stockAvailable, true);
});

test('GV Summary profile/export presentation keeps unavailable stock as an em dash, never zero', async () => {
  const raw = {
    kind: 'gv-agent', channel: 'GV Partner', ch: 'gv', name: 'GV Unknown', id: 'G2', found: true,
    stockAvailable: false, stockClassAvailable: false, stockSource: 'Tag Assignment unavailable',
    stock: { total: 0, vc4: 0, comm: 0 },
    totals: { curVc4: 3, curComm: 2, curTotal: 5, lastVc4: 2, lastComm: 1, lastTotal: 3 },
    months: { cur: '2026-10', last: '2026-09' },
    classes: [{ cls: 'VC4', cur: 3, last: 2, stock: 0 }],
    agents: [], tlStock: { has: false }, dispatch: { sugVc4: 0, sugComm: 0 }, calc: null,
    priority: 'Low', tl: { name: 'GV Team', id: 'T1' }
  };
  FF.masterProfile = { build: async () => raw, csvRows: (p) => [['Stock', p.stock.total]] };
  FF.pages = { gvPerformance: { sourceRows: () => [] } };
  FF.store = { get: () => [], need: async () => [] };
  FF.gv = { issuanceRows: () => [] };

  const report = await FF.agentSummary.buildReport({ kind: 'gv-agent', name: 'GV Unknown', id: 'G2' }, { age: false });
  assert.equal(report.p.stockAvailable, false);
  assert.equal(report.p.totals.stockTotal, null);
  assert.equal(report.p.totals.stockVc4, null);
  assert.equal(report.p.classTable[0].stock, null);
  const text = FF.agentSummary.reportText(report);
  assert.match(text, /Stock in Hand: \*—\*/);
  assert.match(text, /VC4 \/ Commercial split unavailable/);
  const html = FF.agentSummary.reportHtml(report);
  assert.match(html, /Tag Assignment unavailable/);
  assert.match(html, /<div class="kpi-value">—<\/div>/, 'the stock KPI visibly shows unavailable');
  assert.doesNotMatch(html, /data-kpi="src=gv&scope=stock&agent=GV%20Unknown/, 'unavailable stock does not open a zero-valued detail');
  assert.match(html, /<td class="num">—<\/td><\/tr>/, 'class stock cell is an em dash, not zero');
});
