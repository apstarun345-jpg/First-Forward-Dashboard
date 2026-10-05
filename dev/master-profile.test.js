/* 🧾 v3.13 — master search rich profile (mobile, TL, stock, priority, suggested qty, class-wise issuance,
   TL totals) + Direct High/Medium "tag required" rules. Pure logic; DOM smoke lives in smoke.js. */
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
U.runRateDays = () => 15; // run-rate = issued ÷ (today − 1): test me fixed 15 din
const ym = U.ymKey(new Date());
const prev = U.prevMonthKey(ym);

const perfAgent = (o) => ({ week: [1, 2, 3, 0, 0, 1, 2], curVc4: 0, curNvc4: 0, curTotal: 0, lastVc4: 0, lastNvc4: 0, lastTotal: 0, stockVc4: 0, stockNvc4: 0, stockTotal: 0, tlExcluded: false, agentStatus: 'Active', lastActive: 'Today', ...o });
const agents = [
  perfAgent({ name: 'Ravi Kumar', agentId: 'R101', id: 'R101', tlName: 'TL One', tlId: 'T1', tlMobile: '9000000001', priority: 'High', stockVc4: 10, stockNvc4: 4, stockTotal: 14, curVc4: 90, curNvc4: 30, curTotal: 120, lastVc4: 60, lastNvc4: 20, lastTotal: 80, avgVc4: 6, avgNvc4: 2, tlStockVc4: 50, tlStockNvc4: 20, tlStockTotal: 70, tlPriority: 'High' }),
  perfAgent({ name: 'Priya Sharma', agentId: '9876543210', id: '9876543210', tlName: 'TL One', tlId: 'T1', tlMobile: '9000000001', priority: 'Low', stockVc4: 40, stockNvc4: 16, stockTotal: 56, curVc4: 30, curTotal: 30, avgVc4: 2, avgNvc4: 0, tlStockVc4: 50, tlStockNvc4: 20, tlStockTotal: 70 }),
  perfAgent({ name: 'Direct Dev', agentId: 'D909', id: 'D909', tlName: 'APS', tlId: '', priority: 'High', tlExcluded: true, stockVc4: 3, stockTotal: 3, curVc4: 45, curTotal: 45, avgVc4: 3 }),
  perfAgent({ name: 'Direct Low', agentId: 'D910', id: 'D910', tlName: 'APS', priority: 'Low', tlExcluded: true, stockVc4: 30, stockTotal: 30, curVc4: 3, curTotal: 3, avgVc4: 0.2 })
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
  // The TL also holds stock under their own agent identity; it is not in the agent REPORT rollup.
  { agentId: 'T1', agentName: 'TL One', tlId: 'T1', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 5 },
  { agentId: 'T1', agentName: 'TL One', tlId: 'T1', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 3 }
];
const gvReport = [
  { agentId: 'G001', agentName: 'GV Ramesh', mobile: '9111111111', tlId: 'GT1', tlName: 'GV TL', priority: 'High', stockVc4: 5, stockComm: 1, stockTotal: 6, stockByClass: { VC4: 5 }, curDays: 10, curVc4: 100, curComm: 10, curTotal: 110, lastVc4: 50, lastComm: 5, lastTotal: 55, suggestedDispatch: 0, tlStockVc4: 25, tlStockComm: 5, tlStockTotal: 30, curByClass: { VC4: 100 } },
  { agentId: 'G002', agentName: 'GV Direct', mobile: '9222222222', tlId: '', tlName: 'Direct', priority: 'Medium', stockVc4: 2, stockComm: 0, stockTotal: 2, stockByClass: { VC4: 2 }, curDays: 10, curVc4: 40, curComm: 0, curTotal: 40, lastVc4: 0, lastComm: 0, lastTotal: 0, suggestedDispatch: 7 },
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
const master = [{ ym, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC4', group: 'VC4' }, { ym, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC20', group: 'VC20' }, { ym: prev, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC4', group: 'VC4' }];
const data = { agentClass, agents: [], stockAgents };
FF.store.need = async (k) => data[k] || []; FF.store.get = (k) => data[k];
FF.gv.need = async () => []; FF.gv.get = (k) => (k === 'report' ? gvReport : k === 'stockAgent' ? gvStockAgents : k === 'stockAgentClass' ? gvStockAgentClass : []); FF.gv.rows = () => master; FF.gv.enabled = () => true;
FF.auth = { can: () => true, settings: {} };
FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => agents, daysElapsed: () => 15, dayLabels: () => ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } };
require(path.join(ROOT, 'masterProfile.js'));
const MP = FF.masterProfile;
const person = (kind, name, sub) => ({ kind, name, sub: sub || '', tlSet: new Set(), classMap: new Map(), bars: new Set() });

test('FF agent profile: mobile fallback, stock, TL stock, priority, suggested qty', async () => {
  const pr = await MP.build(person('ff-agent', 'Ravi Kumar', 'R101'));
  assert.equal(pr.found, true);
  assert.equal(pr.priority, 'High');
  assert.equal(pr.stock.total, 14); assert.equal(pr.tlStock.total, 78);
  assert.deepEqual([pr.tlStock.own.total, pr.tlStock.agents.total], [8, 70]);
  assert.equal(pr.tl.name, 'TL One'); assert.equal(pr.tl.mobile, '9000000001');
  // suggested = ceil(avg × 15 − stock): VC4 6×15−10 = 80 ; Comm 2×15−4 = 26
  assert.equal(pr.dispatch.sugVc4, 80); assert.equal(pr.dispatch.sugComm, 26);
  assert.equal(pr.tagRequired, false);
  const pri = await MP.build(person('ff-agent', 'Priya Sharma'));
  assert.equal(pri.mobile, '9876543210', '10-digit agent ID = mobile fallback');
  assert.equal(pri.dispatch.sugVc4, 0, 'stock already covers 15 days');
});

test('class-wise issuance table: last month, this month, stock', async () => {
  const pr = await MP.build(person('ff-agent', 'Ravi Kumar', 'R101'));
  const vc4 = pr.classes.find((r) => r.cls === 'VC4'), vc20 = pr.classes.find((r) => r.cls === 'VC20');
  assert.deepEqual([vc4.last, vc4.cur, vc4.stock], [60, 90, 10]);
  assert.deepEqual([vc20.last, vc20.cur, vc20.stock], [20, 30, 4]);
  const html = MP.html(pr);
  assert.match(html, /Issuance class-wise/); assert.match(html, /mp-kpis/); assert.match(html, /Class-wise issuance/);
  // v3.44 — summary ab VC4 · VC20 · VC5+ teen alag rows me (Commercial ek row me nahi chhupta).
  assert.match(html, /mp-group-tbl/);
  for (const label of ['VC4', 'VC20', 'VC5+']) assert.ok(html.includes(`<b>${label}</b>`), `${label} group row missing`);
  assert.match(html, /Total<\/b><\/td><td class="num"><b>80<\/b><\/td><td class="num"><b>120<\/b>/);
});

test('Direct + High/Medium = TAG REQUIRED (FF and GV); Low = no dispatch', async () => {
  const ffHigh = await MP.build(person('ff-agent', 'Direct Dev', 'D909'));
  assert.equal(ffHigh.direct, true); assert.equal(ffHigh.tagRequired, true);
  assert.equal(ffHigh.dispatch.sugVc4, 42, '3×15−3 = 42 tags');
  assert.match(MP.html(ffHigh), /TAG REQUIRED/);
  const ffLow = await MP.build(person('ff-agent', 'Direct Low', 'D910'));
  assert.equal(ffLow.tagRequired, false); assert.match(MP.html(ffLow), /No dispatch/);
  const gvMed = await MP.build(person('gv-agent', 'GV Direct', 'G002'));
  assert.equal(gvMed.direct, true); assert.equal(gvMed.tagRequired, true);
  assert.equal(gvMed.dispatch.sugVc4, 38, 'formula: 40 ÷ 15 × 15 − stock 2 (sheet qty ab use nahi hoti)');
  assert.equal(MP.suggest(4, 10), 50);
});

test('TL profile: totals, class sums, TL-level vs agent-wise suggestion, agents table + charts', async () => {
  const pr = await MP.build(person('ff-tl', 'TL One'));
  assert.equal(pr.agentCount, 2, 'direct agents TL me count nahi hote');
  assert.equal(pr.totals.curTotal, 150); assert.equal(pr.totals.lastTotal, 80);
  assert.equal(pr.stock.total, 78, 'TL own stock is added to the 70 agent stock');
  assert.equal(pr.classes.reduce((sum, r) => sum + r.stock, 0), 78, 'class rows reconcile with displayed TL stock');
  assert.deepEqual([pr.tlStock.own.total, pr.tlStock.agents.total], [8, 70]);
  assert.equal(pr.dispatch.sumAgentVc4, 80 + 0);
  const html = MP.html(pr);
  assert.match(html, /TL ke agents/); assert.match(html, /Agent-wise issuance/); assert.match(html, /data-mp-agent="Ravi Kumar"/);
  // v3.40 — "Own 8 + agents 70" ab do clickable chips hai (har chip ki drawer me sirf wahi hissa khulta hai)
  assert.match(html, /class="mp-part own"[^>]*part=own"[^>]*>Own 8<\/span> \+ <span class="mp-part team"[^>]*part=team"[^>]*>agents 70<\/span>/);
  assert.ok(/part=own/.test(html) && /part=team/.test(html), 'own / agents chips ka drill-down alag');
  assert.match(html, /= TL TOTAL \(own \+ agents\)/, 'agents table ka footer reconcile karta hai (double count nahi)');
  const csv = MP.csvRows(pr); assert.ok(csv.length > 20);
  assert.ok(csv.some((row) => /^TL own stock/.test(row[0]) && row[1] === 8));
  assert.ok(csv.some((row) => row[0] === '= TL TOTAL'), 'CSV me bhi own + agents = TL total row');
  assert.match(MP.waText(pr), /TL One/); assert.match(MP.waText(pr), /TL ke paas 8 \+ agents ke paas 70/);
});

test('GV agent + GV TL profiles', async () => {
  const a = await MP.build(person('gv-agent', 'GV Ramesh', 'G001'));
  assert.equal(a.mobile, '9111111111'); assert.equal(a.tlStock.total, 34);
  assert.deepEqual([a.tlStock.own.total, a.tlStock.agents.total], [4, 30]);
  assert.equal(a.dispatch.sugVc4, 95, 'run-rate 100/15 × 15 − stock 5');
  const c = a.classes.find((r) => r.cls === 'VC20'); assert.equal(c.cur, 1);
  const tl = await MP.build(person('gv-tl', 'GV TL'));
  assert.equal(tl.agentCount, 2); assert.equal(tl.totals.curTotal, 120);
  assert.equal(tl.stock.total, 34);
  assert.equal(tl.classes.reduce((sum, r) => sum + r.stock, 0), 34, 'GV class stock reconciles with own plus agent stock');
  assert.deepEqual([tl.tlStock.own.total, tl.tlStock.agents.total], [4, 30]);
});

test('GV TL keeps the REPORT floor when agent stock details are partial', async () => {
  const priorGet = FF.gv.get;
  FF.gv.get = (key) => key === 'report' ? gvReport
    : key === 'stockAgent' ? gvStockAgents.filter((r) => r.agentId === 'G001' || r.agentId === 'GT1')
      : key === 'stockAgentClass' ? gvStockAgentClass.filter((r) => r.agentName === 'GV Ramesh' || r.agentName === 'GV TL') : [];
  try {
    const tl = await MP.build(person('gv-tl', 'GV TL'));
    assert.equal(tl.stock.total, 34, 'partial tag detail must not lower agent report 30 + TL own 4');
    assert.equal(tl.classes.reduce((sum, r) => sum + r.stock, 0), 34);
  } finally {
    FF.gv.get = priorGet;
    await MP.loadFor({ kind: 'gv-tl' });
  }
});

test('quick snapshot + contacts gate + unsupported kinds', async () => {
  await MP.load();
  const q = MP.quick(person('ff-agent', 'Ravi Kumar', 'R101'));
  assert.equal(q.priority, 'High'); assert.equal(q.stock.total, 14); assert.equal(q.tlStock.total, 78);
  assert.equal(MP.supports(person('gv-id', 'x')), false);
  FF.auth.can = (k) => k !== 'contacts';
  assert.doesNotMatch(MP.html(await MP.build(person('gv-agent', 'GV Ramesh', 'G001'))), /9111111111/);
  assert.ok(!MP.csvRows(await MP.build(person('gv-agent', 'GV Ramesh', 'G001'))).some((r) => r[1] === '9111111111'));
});

test('dispatch calculation block: run-rate = issue ÷ (today−1), required, with / w/o stock, cover', async () => {
  const pr = await MP.build(person('ff-agent', 'Ravi Kumar', 'R101'));
  const t = pr.calc.total;
  assert.equal(t.elapsed, 15); assert.equal(t.rate, 8);              // 120 ÷ 15
  assert.equal(t.required, 120);                                     // 8 × 15 din
  assert.equal(t.net, 106); assert.equal(t.gross, 120);              // 120 − stock 14
  assert.ok(Math.abs(t.cover - 14 / 8) < 1e-9);
  assert.equal(pr.calc.vc4.net, 80); assert.equal(pr.calc.comm.net, 26);
  const html = MP.html(pr);
  assert.match(html, /Dispatch calculation/); assert.match(html, /With stock dispatch/); assert.match(html, /W\/o stock dispatch/);
  assert.match(MP.waText(pr), /Run-rate 8\/day/);
  const tl = await MP.build(person('ff-tl', 'TL One'));
  assert.equal(tl.calc.total.rate, 10); assert.equal(tl.calc.total.net, 72, 'TL: 150 ÷ 15 × 15 − TL own + agent stock 78');
});

test('GV EIR month totals replace stale REPORT snapshots in agent, TL, light summary and class detail', async () => {
  const priorRows = FF.gv.rows;
  const priorIssuance = FF.gv.issuanceRows;
  const eirRows = [
    { ym, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC4', n: 12 },
    { ym, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC20', n: 3 },
    { ym, agentId: 'G003', agentName: 'GV Low', tlName: 'GV TL', cls: 'VC4', n: 2 },
    { ym: prev, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC4', n: 8 },
    { ym: prev, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC20', n: 2 },
    { ym: prev, agentId: 'G003', agentName: 'GV Low', tlName: 'GV TL', cls: 'VC4', n: 1 }
  ];
  FF.gv.rows = FF.gv.masterRows;
  FF.gv.issuanceRows = () => eirRows;
  try {
    const a = await MP.build(person('gv-agent', 'GV Ramesh', 'G001'));
    assert.deepEqual([a.totals.curVc4, a.totals.curComm, a.totals.curTotal], [12, 3, 15]);
    assert.deepEqual([a.totals.lastVc4, a.totals.lastComm, a.totals.lastTotal], [8, 2, 10]);
    assert.deepEqual([a.classes.find((r) => r.cls === 'VC4').cur, a.classes.find((r) => r.cls === 'VC20').cur], [12, 3]);

    const tl = await MP.build(person('gv-tl', 'GV TL'));
    assert.deepEqual([tl.totals.curVc4, tl.totals.curComm, tl.totals.curTotal], [14, 3, 17]);
    assert.deepEqual([tl.totals.lastVc4, tl.totals.lastComm, tl.totals.lastTotal], [9, 2, 11]);
    assert.equal(tl.agents.reduce((sum, r) => sum + r.cur, 0), 17, 'agent rows and TL summary use the same EIR snapshot');
    assert.equal(tl.classes.reduce((sum, r) => sum + r.cur, 0), 17, 'class details and TL summary use the same EIR snapshot');
    assert.equal(MP.quick(person('gv-tl', 'GV TL')).totals.curTotal, 17, 'search suggestion snapshot must be corrected too');
  } finally {
    FF.gv.rows = priorRows;
    FF.gv.issuanceRows = priorIssuance;
  }
});

test('GV keeps calendar-month labels and surfaces the full previous-month issuance when current month has no EIR rows', async () => {
  const priorRows = FF.gv.rows;
  const priorIssuance = FF.gv.issuanceRows;
  const eirRows = [
    { ym: prev, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC4', n: 8 },
    { ym: prev, agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC20', n: 2 },
    { ym: prev, agentId: 'G003', agentName: 'GV Low', tlName: 'GV TL', cls: 'VC4', n: 1 }
  ];
  FF.gv.rows = FF.gv.masterRows;
  FF.gv.issuanceRows = () => eirRows;
  try {
    const agent = await MP.build(person('gv-agent', 'GV Ramesh', 'G001'));
    assert.deepEqual([agent.months.cur, agent.months.last], [ym, prev], 'GV follows the calendar month even before its first row arrives');
    assert.deepEqual([agent.totals.lastVc4, agent.totals.lastComm, agent.totals.lastTotal], [8, 2, 10]);
    assert.equal(agent.classes.find((r) => r.cls === 'VC4').last, 8);
    const tl = await MP.build(person('gv-tl', 'GV TL'));
    assert.deepEqual([tl.months.cur, tl.months.last], [ym, prev]);
    assert.deepEqual([tl.totals.lastVc4, tl.totals.lastComm, tl.totals.lastTotal], [9, 2, 11]);
    assert.equal(tl.agents.reduce((sum, row) => sum + row.last, 0), 11, 'previous-month totals match the TL agent rows');
  } finally {
    FF.gv.rows = priorRows;
    FF.gv.issuanceRows = priorIssuance;
  }
});
