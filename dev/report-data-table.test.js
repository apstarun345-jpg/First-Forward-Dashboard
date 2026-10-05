/* 📊 v3.43 — REPORT data table (shared): reportDataRow + peopleTableHtml.
   User rule: Home search, FF Summary aur GV Summary — teeno jagah numbers SAME hone chahiye
   (agent, TL, stock, total issuance, last month) aur sab REPORT / GV REPORT tabs se.
   Yahan wo guarantee test hoti hai: table row numbers == MP.build() profile numbers,
   TL rows = own + agents rollup, footer double-count nahi karta. */
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
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false,
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true },
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
};
['config', 'util', 'model', 'gv', 'store', 'charts'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;
U.runRateDays = () => 15;
const ym = U.ymKey(new Date());
const prev = U.prevMonthKey(ym);

const perfAgent = (o) => ({ week: [0, 0, 0, 0, 0, 0, 0], curVc4: 0, curNvc4: 0, curTotal: 0, lastVc4: 0, lastNvc4: 0, lastTotal: 0, stockVc4: 0, stockNvc4: 0, stockTotal: 0, tlExcluded: false, agentStatus: 'Active', lastActive: 'Today', ...o });
const agents = [
  perfAgent({ name: 'Ravi Kumar', agentId: 'R101', id: 'R101', tlName: 'TL One', tlId: 'T1', tlMobile: '9000000001', priority: 'High', stockVc4: 10, stockNvc4: 4, stockTotal: 14, curVc4: 90, curNvc4: 30, curTotal: 120, lastVc4: 60, lastNvc4: 20, lastTotal: 80, tlStockVc4: 50, tlStockNvc4: 20, tlStockTotal: 70 }),
  perfAgent({ name: 'Priya Sharma', agentId: '9876543210', id: '9876543210', tlName: 'TL One', tlId: 'T1', priority: 'Low', stockVc4: 40, stockNvc4: 16, stockTotal: 56, curVc4: 30, curTotal: 30, lastVc4: 0, lastTotal: 0, tlStockVc4: 50, tlStockNvc4: 20, tlStockTotal: 70 })
];
const agentClass = [
  { ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 90 },
  { ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 30 },
  { ym: prev, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 60 },
  { ym: prev, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 20 },
  { ym, channel: 'First Forward', name: 'Priya Sharma', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 30 }
];
const stockAgents = [
  { agentId: 'R101', agentName: 'Ravi Kumar', tlId: 'T1', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 10 },
  { agentId: 'R101', agentName: 'Ravi Kumar', tlId: 'T1', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 4 },
  { agentId: 'T1', agentName: 'TL One', tlId: 'T1', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 5 },
  { agentId: 'T1', agentName: 'TL One', tlId: 'T1', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 3 }
];
const gvReport = [
  { agentId: 'G001', agentName: 'GV Ramesh', mobile: '9111111111', tlId: 'GT1', tlName: 'GV TL', priority: 'High', stockVc4: 5, stockComm: 1, stockTotal: 6, stockByClass: { VC4: 5 }, curDays: 10, curVc4: 100, curComm: 10, curTotal: 110, lastVc4: 50, lastComm: 5, lastTotal: 55, suggestedDispatch: 0, tlStockVc4: 25, tlStockComm: 5, tlStockTotal: 30, curByClass: { VC4: 100 } },
  { agentId: 'G003', agentName: 'GV Low', mobile: '', tlId: 'GT1', tlName: 'GV TL', priority: 'Low', stockVc4: 20, stockComm: 4, stockTotal: 24, stockByClass: { VC4: 20 }, curDays: 10, curVc4: 10, curComm: 0, curTotal: 10, lastVc4: 5, lastComm: 0, lastTotal: 5, suggestedDispatch: 0, tlStockVc4: 25, tlStockComm: 5, tlStockTotal: 30 }
];
const gvStockAgents = [
  { agentId: 'G001', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'GV TL', n: 6 },
  { agentId: 'G003', agentName: 'GV Low', tlId: 'GT1', tlName: 'GV TL', n: 24 },
  { agentId: 'GT1', agentName: 'GV TL', tlId: 'GT1', tlName: 'GV TL', n: 4 }
];
const gvStockAgentClass = [
  { agentName: 'GV Ramesh', cls: 'VC4', n: 5 }, { agentName: 'GV Ramesh', cls: 'Commercial', n: 1 },
  { agentName: 'GV Low', cls: 'VC4', n: 20 }, { agentName: 'GV Low', cls: 'Commercial', n: 4 },
  { agentName: 'GV TL', cls: 'VC4', n: 4 }
];
const master = [
  { ym, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC4', group: 'VC4' },
  { ym: prev, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC4', group: 'VC4' }
];
const data = { agentClass, agents: [], stockAgents };
FF.store.need = async (k) => data[k] || []; FF.store.get = (k) => data[k];
FF.gv.need = async () => []; FF.gv.get = (k) => (k === 'report' ? gvReport : k === 'stockAgent' ? gvStockAgents : k === 'stockAgentClass' ? gvStockAgentClass : []); FF.gv.rows = () => master; FF.gv.enabled = () => true;
FF.auth = { can: () => true, settings: {} };
FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => agents, daysElapsed: () => 15, dayLabels: () => [] } };
require(path.join(ROOT, 'masterProfile.js'));
const MP = FF.masterProfile;
const person = (kind, name, id) => ({ kind, name, id: id || '', sub: id || '', tlSet: new Set(), classMap: new Map(), bars: new Set() });

test('reportDataRow — FF agent ke numbers == build() profile (same-numbers rule)', async () => {
  await MP.load();
  const pr = await MP.build(person('ff-agent', 'Ravi Kumar', 'R101'));
  const row = MP.reportDataRow({ kind: 'ff-agent', name: 'Ravi Kumar', id: 'R101' });
  assert.equal(row.found, true);
  assert.equal(row.ch, 'ff'); assert.equal(row.isTl, false);
  assert.equal(row.tlName, 'TL One'); assert.equal(row.tlId, 'T1');
  assert.equal(row.stock, pr.stock.total);
  assert.equal(row.cur, pr.totals.curTotal);
  assert.equal(row.last, pr.totals.lastTotal);
  assert.equal(row.cur, 120); assert.equal(row.last, 80); assert.equal(row.stock, 14);
});

test('reportDataRow — FF TL row = own + agents rollup (total issuance with TL / stock same)', async () => {
  const pr = await MP.build(person('ff-tl', 'TL One', 'T1'));
  const row = MP.reportDataRow({ kind: 'ff-tl', name: 'TL One', id: 'T1' });
  assert.equal(row.isTl, true);
  assert.equal(row.cur, pr.totals.curTotal, 'TL total issuance = summary KPI jaisa');
  assert.equal(row.stock, pr.stock.total, 'TL stock = summary KPI jaisa');
  assert.equal(row.cur, 150, 'agents 120 + 30 + TL own');
  assert.equal(row.stock, 78, 'own 8 + agents 70');
  assert.equal(row.ownStock, 8); assert.equal(row.agentsStock, 70);
});

test('reportDataRow — GV agent + GV TL bhi GV REPORT se, build() ke same numbers', async () => {
  const aBuild = await MP.build(person('gv-agent', 'GV Ramesh', 'G001'));
  const aRow = MP.reportDataRow({ kind: 'gv-agent', name: 'GV Ramesh', id: 'G001' });
  assert.equal(aRow.ch, 'gv');
  assert.equal(aRow.cur, aBuild.totals.curTotal);
  assert.equal(aRow.last, aBuild.totals.lastTotal);
  assert.equal(aRow.stock, aBuild.stock.total);
  assert.equal(aRow.tlName, 'GV TL');
  const tBuild = await MP.build(person('gv-tl', 'GV TL', 'GT1'));
  const tRow = MP.reportDataRow({ kind: 'gv-tl', name: 'GV TL', id: 'GT1' });
  assert.equal(tRow.isTl, true);
  assert.equal(tRow.cur, tBuild.totals.curTotal, 'GV TL bhi own + agents rollup');
  assert.equal(tRow.stock, tBuild.stock.total);
});

test('reportDataRow — REPORT me na ho to fallback numbers, found:false', () => {
  const row = MP.reportDataRow({ kind: 'ff-agent', name: 'Ghost Agent' }, { cur: 7, last: 3, stock: 2, tlName: 'TL One' });
  assert.equal(row.found, false);
  assert.equal(row.cur, 7); assert.equal(row.last, 3); assert.equal(row.stock, 2);
  assert.equal(row.tlName, 'TL One');
});

test('peopleTableHtml — columns, rows, drill specs, TL rollup text, agents-only footer', () => {
  const rows = [
    MP.reportDataRow({ kind: 'ff-agent', name: 'Ravi Kumar', id: 'R101' }),
    MP.reportDataRow({ kind: 'ff-agent', name: 'Priya Sharma', id: '9876543210' }),
    MP.reportDataRow({ kind: 'ff-tl', name: 'TL One', id: 'T1' })
  ];
  const html = MP.peopleTableHtml(rows, { id: 'test-mppt', chips: '<button data-mppt-chip="all">All</button>' });
  // User ke required columns: Agent · TL · Stock · Total Issuance · Last Month (+ Growth)
  for (const h of ['Agent / TL', '👥 TL', '📦 Stock', '🏷️ Total Issuance', '📅 Last Month', '📈 Growth']) {
    assert.ok(html.includes(h), `header "${h}" missing`);
  }
  assert.ok(html.includes('data-mppt-filter'), 'table filter input');
  assert.ok(html.includes('data-mppt-chip="all"'), 'filter chips');
  // rows: data-mppt-row + kind + search + data-kpi drill (scope=stock / scope=mtd / scope=month)
  assert.ok(html.includes('data-mppt-row="ff-agent|Ravi%20Kumar|R101"'), 'row encode round-trip');
  assert.ok(/data-kpi="src=ff(&amp;|&)scope=stock(&amp;|&)agent=Ravi%20Kumar(&amp;|&)agentId=R101"/.test(html), 'agent stock drill spec');
  assert.ok(/data-kpi="src=ff(&amp;|&)scope=stock(&amp;|&)tl=TL%20One"/.test(html), 'TL stock drill spec');
  assert.ok(/data-kpi="src=ff(&amp;|&)scope=mtd/.test(html) && /data-kpi="src=ff(&amp;|&)scope=month/.test(html), 'issuance drill specs');
  // TL row = own + agents text
  assert.ok(html.includes('own 8 + agents 70'), 'TL rollup text');
  // footer: agents-only sums (TL row ke jod se double count nahi)
  assert.ok(html.includes('GRAND TOTAL'), 'footer label');
  const foot = html.slice(html.indexOf('<tfoot>'));
  assert.ok(foot.includes('>70<'), 'footer stock = 14 + 56 (TL ka 78 nahi)');
  assert.ok(foot.includes('>150<'), 'footer MTD = 120 + 30 (TL rollup dobara nahi)');
  assert.ok(foot.includes('>80<'), 'footer last month = 80 + 0');
});

test('peopleTableHtml — bade list par "Aur dikhao" (limit) + TL row highlight class', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ kind: 'ff-agent', name: `Agent ${i}`, id: `A${i}`, ch: 'ff', isTl: false, stock: i, cur: i, last: 0, growth: null, stockVc4: 0, stockComm: 0, curVc4: 0, curComm: 0, lastVc4: 0, lastComm: 0, tlName: 'TL One', tlLabel: 'TL One', found: false }));
  const html = MP.peopleTableHtml(many, { id: 'big', limit: 10, footer: false });
  assert.ok(html.includes('data-mppt-more'), 'more button');
  assert.ok(html.includes('mppt-rest'), 'hidden rest rows');
  const tlRow = MP.peopleTableHtml([{ ...many[0], kind: 'ff-tl', isTl: true, name: 'TL One', ownStock: 5, agentsStock: 6, agentCount: 2 }], { id: 'tl' });
  assert.ok(tlRow.includes('mp-tlrow'), 'TL row ko alag highlight class');
});

test('personFromRow — dataset round-trip (kind | name | id)', () => {
  const tr = { dataset: { mpptRow: `ff-agent|Ravi%20Kumar|R101` } };
  const el = { closest: () => tr };
  const p = MP.personFromRow(el);
  assert.equal(p.kind, 'ff-agent');
  assert.equal(p.name, 'Ravi Kumar');
  assert.equal(p.id, 'R101');
  assert.equal(p.sub, 'R101');
  // quick() isi person object par chal jaana chahiye (kind/name/sub enough hain)
  const q = MP.quick(p);
  assert.ok(q && q.found, 'personFromRow output quick() ke kaam ka hai');
  assert.equal(q.stock.total, 14);
});

test('agentSummary.list numbers bhi reportDataRow se same (fallback path)', async () => {
  delete require.cache[require.resolve(path.join(ROOT, 'agentSummary.js'))];
  require(path.join(ROOT, 'agentSummary.js'));
  const AS = FF.agentSummary;
  const list = await AS.loadPeople('ff');
  const ravi = list.find((p) => p.name === 'Ravi Kumar');
  assert.ok(ravi, 'loadPeople me Ravi Kumar');
  const row = MP.reportDataRow(ravi, { cur: ravi.cur, last: ravi.last, stock: ravi.stock, tlName: ravi.tl });
  assert.equal(row.cur, 120, 'summary list ka MTD == report data table ka MTD');
  assert.equal(row.last, 80);
  assert.equal(row.stock, 14);
  const tl = list.find((p) => p.kind === 'ff-tl' && p.name === 'TL One');
  const tlRow = MP.reportDataRow(tl, { cur: tl.cur, last: tl.last, stock: tl.stock });
  assert.equal(tlRow.cur, 150, 'TL list row bhi rollup ke same numbers');
  assert.equal(tlRow.stock, 78);
});
