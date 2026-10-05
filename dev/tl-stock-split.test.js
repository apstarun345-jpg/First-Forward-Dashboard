/* 🧮 v3.40 — TL ka stock double count hone se rokna + "TL ke paas (own)" vs "agents ke paas" ka split.
   Do asli-sheet patterns cover karte hain:
   1) TL ki APNI stock rows (StockDataa / Tag Assignment) + uski REPORT row → own ek hi baar jude.
   2) TL ki REPORT row poore team ka ROLLUP rakhti hai (aur detail me uski koi row nahi) → tab bhi TL
      total = sheet ka total, own = total − agents (200 jaisa phoola hua number nahi).
   GV ka case: 'Stock Agent' rows class-less hote hain — unhe 'Commercial' bana kar upar se report ka
   VC4 ADD karne se class total phool jaata tha (100 → 120). */
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
globalThis.location = { hash: '#/ffAgentSummary', href: '' };
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

const perfAgent = (o) => ({ week: [1, 2, 3, 0, 0, 1, 2], curVc4: 0, curNvc4: 0, curTotal: 0, lastVc4: 0, lastNvc4: 0, lastTotal: 0, stockVc4: 0, stockNvc4: 0, stockTotal: 0, tlExcluded: false, agentStatus: 'Active', lastActive: 'Today', ...o });

/** FF fixture — agents Ravi 50 + Priya 30, TL One ka apna 40 → TL total 120 (sheet ka TL column bhi 120).
 *  `rollupOwnRow: true` me TL ki REPORT row team ka rollup (120) ho jaati hai aur StockDataa me uski
 *  apni rows hata dete hain — asli sheets ka wo doosra pattern. */
function ffFixture(opts = {}) {
  const rollup = !!opts.rollupOwnRow;
  const agents = [
    perfAgent({ name: 'Ravi Kumar', agentId: 'R101', id: 'R101', tlName: 'TL One', tlId: 'T1', tlMobile: '9000000009', mobile: '9000000001', priority: 'High', stockVc4: 40, stockNvc4: 10, stockTotal: 50, curVc4: 100, curNvc4: 20, curTotal: 120, lastVc4: 80, lastNvc4: 20, lastTotal: 100, tlStockVc4: 90, tlStockNvc4: 30, tlStockTotal: 120, tlPriority: 'High' }),
    perfAgent({ name: 'Priya Sharma', agentId: 'R102', id: 'R102', tlName: 'TL One', tlId: 'T1', tlMobile: '9000000009', mobile: '9000000002', priority: 'Low', stockVc4: 20, stockNvc4: 10, stockTotal: 30, curVc4: 40, curNvc4: 10, curTotal: 50, lastVc4: 30, lastNvc4: 10, lastTotal: 40, tlStockVc4: 90, tlStockNvc4: 30, tlStockTotal: 120 }),
    // TL ki APNI row — sheet me TL bhi usi ki team ki ek "agent" row hota hai
    perfAgent({
      name: 'TL One', agentId: 'R100', id: 'R100', tlName: 'TL One', tlId: 'T1', mobile: '9000000000', priority: 'Medium',
      stockVc4: rollup ? 90 : 30, stockNvc4: rollup ? 30 : 10, stockTotal: rollup ? 120 : 40,
      curVc4: 60, curNvc4: 10, curTotal: 70, lastVc4: 50, lastNvc4: 10, lastTotal: 60,
      tlStockVc4: 90, tlStockNvc4: 30, tlStockTotal: 120
    })
  ];
  const stockAgents = [
    { agentId: 'R101', agentName: 'Ravi Kumar', tlId: 'T1', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 40 },
    { agentId: 'R101', agentName: 'Ravi Kumar', tlId: 'T1', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 },
    { agentId: 'R102', agentName: 'Priya Sharma', tlId: 'T1', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 20 },
    { agentId: 'R102', agentName: 'Priya Sharma', tlId: 'T1', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 },
    ...(rollup ? [] : [
      { agentId: 'R100', agentName: 'TL One', tlId: 'T1', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 30 },
      { agentId: 'R100', agentName: 'TL One', tlId: 'T1', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 }
    ])
  ];
  const agentClass = [
    { ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 100 },
    { ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 20 },
    { ym, channel: 'First Forward', name: 'Priya Sharma', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 40 },
    { ym, channel: 'First Forward', name: 'Priya Sharma', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 },
    { ym, channel: 'First Forward', name: 'TL One', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 60 },
    { ym, channel: 'First Forward', name: 'TL One', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 }
  ];
  return { agents, stockAgents, agentClass };
}
/** GV fixture — agents 30 + 40, TL One 30 → TL total 100; GV ki stock rows class-less (agent × TL) hain. */
function gvFixture() {
  return {
    report: [
      { agentId: 'G001', agentName: 'GV Ramesh', mobile: '9111111111', tlId: 'GT1', tlName: 'GV TL', priority: 'High', stockVc4: 20, stockComm: 10, stockTotal: 30, stockByClass: { VC4: 20, VC20: 10 }, curDays: 15, curVc4: 60, curComm: 10, curTotal: 70, lastVc4: 40, lastComm: 10, lastTotal: 50, tlStockVc4: 60, tlStockComm: 40, tlStockTotal: 100 },
      { agentId: 'G002', agentName: 'GV Suresh', mobile: '9222222222', tlId: 'GT1', tlName: 'GV TL', priority: 'Low', stockVc4: 20, stockComm: 20, stockTotal: 40, stockByClass: { VC4: 20, VC20: 20 }, curDays: 15, curVc4: 30, curComm: 10, curTotal: 40, lastVc4: 30, lastComm: 10, lastTotal: 40, tlStockVc4: 60, tlStockComm: 40, tlStockTotal: 100 },
      // TL ki apni row: alag agent code (self-supervised "Direct" nahi) — sheet me aisa hi hota hai
      { agentId: 'G999', agentName: 'GV TL', mobile: '9333333333', tlId: 'GT1', tlName: 'GV TL', priority: 'Medium', stockVc4: 20, stockComm: 10, stockTotal: 30, stockByClass: { VC4: 20, VC20: 10 }, curDays: 15, curVc4: 20, curComm: 10, curTotal: 30, lastVc4: 20, lastComm: 0, lastTotal: 20, tlStockVc4: 60, tlStockComm: 40, tlStockTotal: 100 }
    ],
    stockAgent: [
      { agentId: 'G001', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'GV TL', n: 30 },
      { agentId: 'G002', agentName: 'GV Suresh', tlId: 'GT1', tlName: 'GV TL', n: 40 },
      { agentId: 'G999', agentName: 'GV TL', tlId: 'GT1', tlName: 'GV TL', n: 30 }
    ],
    stockAgentClass: [
      { agentName: 'GV Ramesh', cls: 'VC4', n: 20 }, { agentName: 'GV Ramesh', cls: 'Commercial', n: 10 },
      { agentName: 'GV Suresh', cls: 'VC4', n: 20 }, { agentName: 'GV Suresh', cls: 'Commercial', n: 20 },
      { agentName: 'GV TL', cls: 'VC4', n: 20 }, { agentName: 'GV TL', cls: 'Commercial', n: 10 }
    ]
  };
}
const person = (kind, name, sub = '') => ({ kind, name, sub, tlSet: new Set(), classMap: new Map(), bars: new Set() });

/** Ek fresh module graph (har test apna data set karta hai — caches / store leak na hon). */
function mount({ ff, gv } = {}) {
  const data = { agentClass: [], agents: [], stockAgents: [], daily: [], ...ff };
  const gvData = { report: [], stockAgent: [], stockAgentClass: [], stockTl: [], ...gv };
  FF.store.need = async (k) => data[k] || [];
  FF.store.get = (k) => (k in data ? data[k] : []);
  FF.gv.need = async () => [];
  FF.gv.get = (k) => (k in gvData ? gvData[k] : []);
  FF.gv.rows = () => []; FF.gv.enabled = () => true; FF.gv.issuanceRows = () => []; FF.gv.masterRows = () => [];
  FF.auth = { can: () => true, settings: {}, isAdmin: () => true };
  FF.pages = {
    performance: { ensureLoaded: async () => {}, agents: () => data.agents || [], daysElapsed: () => 15, dayLabels: () => ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
    gvPerformance: { sourceRows: () => gvData.report, ensureLoaded: async () => {} }
  };
  delete require.cache[require.resolve(path.join(ROOT, 'masterProfile.js'))];
  require(path.join(ROOT, 'masterProfile.js'));
  delete require.cache[require.resolve(path.join(ROOT, 'kpiDetail.js'))];
  require(path.join(ROOT, 'kpiDetail.js'));
  FF.masterProfile.invalidate();
  return { MP: FF.masterProfile };
}

const sumStock = (pr) => (pr.classes || []).reduce((x, r) => x + r.stock, 0);

// ---------------------------------------------------------------------------------------------------------
test('FF TL: TL ka apna stock ek hi baar judta hai — own 40 + agents 80 = 120', async () => {
  const { MP } = mount({ ff: ffFixture() });
  const pr = await MP.build(person('ff-tl', 'TL One', 'T1'));
  assert.deepEqual([pr.stock.vc4, pr.stock.comm, pr.stock.total], [90, 30, 120], 'TL total = sheet ka 120 (phoola hua 200 nahi)');
  assert.deepEqual([pr.tlStock.own.total, pr.tlStock.agents.total, pr.tlStock.total], [40, 80, 120]);
  assert.equal(pr.tlStock.own.total + pr.tlStock.agents.total, pr.stock.total, 'own + agents hamesha = TL total');
  assert.equal(sumStock(pr), pr.stock.total, 'class table ka jod bhi TL total se match kare');
  assert.equal(pr.stockSplit.ownFrom, 'detail', 'TL ki apni stock rows se own aaya');
  assert.equal(pr.stockSplit.rollupOwnRow, false);
});

test('FF TL: TL ki REPORT row team ka rollup ho to bhi total 120 (200 nahi)', async () => {
  const { MP } = mount({ ff: ffFixture({ rollupOwnRow: true }) });
  const pr = await MP.build(person('ff-tl', 'TL One', 'T1'));
  assert.deepEqual([pr.stock.vc4, pr.stock.comm, pr.stock.total], [90, 30, 120], 'rollup row alag se add nahi hoti');
  assert.deepEqual([pr.tlStock.own.total, pr.tlStock.agents.total], [40, 80], 'own = sheet total − agents');
  assert.equal(pr.stockSplit.rollupOwnRow, true, 'rollup pattern pehchana gaya');
  assert.equal(pr.stockSplit.ownFrom, 'snapshot-team');
});

test('FF TL: TL apni agents ki list me "agent" nahi ginta (agentCount 2, TL row alag)', async () => {
  const { MP } = mount({ ff: ffFixture() });
  const pr = await MP.build(person('ff-tl', 'TL One', 'T1'));
  assert.equal(pr.agentCount, 2, 'TL khud apna agent nahi');
  assert.deepEqual(pr.agents.map((a) => a.name), ['Ravi Kumar', 'Priya Sharma']);
  assert.equal(pr.selfAgent.name, 'TL One', 'TL ki apni row alag field me milti hai');
  assert.equal(pr.selfAgent.isSelf, true);
  assert.equal(pr.selfAgent.stockTotal, 40);
  assert.equal(pr.teamSize, 3, 'sheet me 3 rows thin (2 agents + TL)');
});

test('GV TL: class-less Stock Agent rows se VC4 dubara nahi judta (100, not 120)', async () => {
  const { MP } = mount({ gv: gvFixture() });
  const pr = await MP.build(person('gv-tl', 'GV TL', 'GT1'));
  assert.deepEqual([pr.stock.vc4, pr.stock.comm, pr.stock.total], [60, 40, 100], 'GV sheet ke TL columns se match');
  assert.deepEqual([pr.tlStock.own.total, pr.tlStock.agents.total], [30, 70]);
  assert.equal(pr.agentCount, 2, 'GV TL bhi apni list me agent nahi');
  assert.deepEqual(pr.agents.map((a) => a.name).sort(), ['GV Ramesh', 'GV Suresh']);
  // GV convention: 'agentName === tlName' wali row self-supervised hoti hai; keep it as TL own,
  // not as a managed agent. Its issuance is part of the repeated GV REPORT TL snapshot.
  assert.equal(pr.selfAgent.name, 'GV TL', 'self-supervised GV REPORT row is retained as TL own');
  assert.equal(pr.selfAgent.cur, 30, 'TL own issuance row stays separate from the two managed agents');
  assert.equal(sumStock(pr), 100, 'GV class table bhi 100 par reconcile');
  const html = FF.masterProfile.html(pr);
  assert.match(html, /ke paas \(TL own\)/, 'row na bhi ho to footer composition se reconcile karta hai');
  assert.match(html, /= TL TOTAL \(own \+ agents\)/);
  assert.match(html, /TL ke agents · 2/, 'sirf do managed agents count hote hain; TL own row alag hai');
});

test('drawer / exports: TL ki row agents ke table me alag dikhti hai + footer reconcile karta hai', async () => {
  const { MP } = mount({ ff: ffFixture() });
  const pr = await MP.build(person('ff-tl', 'TL One', 'T1'));
  const html = MP.html(pr);
  assert.match(html, /TL ke agents · 2/, 'header me sirf agents gine jaate hain');
  assert.match(html, /mp-selfrow/, 'TL ki apni row highlight hui hai');
  assert.match(html, /TL · apna stock/);
  assert.match(html, /Agents total \(2\)/);
  assert.match(html, /= TL TOTAL \(own \+ agents\)/);
  assert.match(html, /class="mp-part own"[^>]*data-kpi="src=ff&amp;scope=stock&amp;tl=TL%20One&amp;part=own"[^>]*>Own 40<\/span>/, 'KPI ka own chip');
  assert.match(html, /part=team"[^>]*>agents 80</, 'KPI ka agents chip');
  assert.match(html, /scope=people&amp;tl=TL%20One&amp;self=0/, 'Agents count click → wahi list (TL row ke bina)');
  assert.match(html, /Stock ka hisaab/, 'hisaab ka note (kahan se aaya number)');
  const csv = MP.csvRows(pr);
  assert.ok(csv.some((row) => row[0] === '= TL TOTAL'), 'CSV me reconcile row');
  assert.ok(csv.some((row) => /^👤 TL One \(TL ka apna stock/.test(String(row[0]))), 'CSV me TL ki row marked');
  assert.ok(csv.some((row) => row[0] === 'AGENTS TOTAL'), 'CSV me agents ka alag total');
  assert.match(MP.waText(pr), /TL ke paas \(own\) 40 \+ agents ke paas 80 = TL total 120/);
  assert.match(MP.waText(pr), /👤 TL One — TL ka apna stock/);
});

test('agent profile ka "TL stock" bhi same composition dikhata hai (total 120, own 40, agents 80)', async () => {
  const { MP } = mount({ ff: ffFixture() });
  const pr = await MP.build(person('ff-agent', 'Ravi Kumar', 'R101'));
  assert.deepEqual([pr.stock.total, pr.stock.vc4, pr.stock.comm], [50, 40, 10], 'agent ka apna stock');
  assert.deepEqual([pr.tlStock.total, pr.tlStock.own.total, pr.tlStock.agents.total], [120, 40, 80]);
  const html = MP.html(pr);
  assert.match(html, /Own 40<\/span> \+ <span class="mp-part team"[^>]*part=team"[^>]*>agents 80</);
});

test('Agent/TL Summary page (agentSummary.js): Team Agents card + exports bhi reconcile karte hain', async () => {
  const { MP } = mount({ ff: ffFixture() });
  delete require.cache[require.resolve(path.join(ROOT, 'agentSummary.js'))];
  require(path.join(ROOT, 'agentSummary.js'));
  const AS = FF.agentSummary;
  assert.ok(AS, 'agentSummary FF.agentSummary export ke saath load hua');
  const r = await AS.buildReport({ kind: 'ff-tl', name: 'TL One', id: 'T1' }, { age: false });
  assert.equal(r.p.agents.length, 2, 'summary page ke agents me TL ki row nahi');
  assert.equal(r.p.selfAgent.name, 'TL One');
  assert.equal(r.p.totals.stockTotal, 120, 'summary ka stock KPI = TL total (double count nahi)');
  const html = AS.reportHtml(r);
  assert.match(html, /Team Agents \(2\)/);
  assert.match(html, /Agents total \(2\)/);
  assert.match(html, /= TL TOTAL \(own \+ agents\)/);
  assert.match(html, /TL ke paas 40<\/span> \+ <span class="mp-part team"[^>]*part=team"[^>]*>agents 80</, 'stock KPI par clickable split chips');
  assert.match(html, /mp-selfrow/);
  assert.match(AS.reportText(r), /TL ke paas \(own\) 40 \+ agents ke paas 80 = TL total 120/);
  const csv = AS.reportCsv(r);
  assert.ok(csv.some((row) => row[0] === '= TL TOTAL (own + agents)'), 'summary CSV me reconcile row');
  assert.ok(csv.some((row) => String(row[0] || '').startsWith('👤 TL One (TL')), 'summary CSV me TL ki own row marked');
});

test('KPI drawer: TL card ka number == drawer ka number (GV TL filter + FF own/team parts)', async () => {
  const gv = gvFixture();
  // doosra TL jaan-boojh kar bhar ke rakha hai — agar TL filter lagna chhoot jaaye to drawer me poora
  // company stock (600) dikh jaayega, card par 100 (v3.39 se pehle ka actual bug)
  gv.report.push({ agentId: 'G100', agentName: 'Other Agent', tlId: 'GT2', tlName: 'Other TL', stockVc4: 250, stockComm: 250, stockTotal: 500, curDays: 15, curVc4: 10, curComm: 10, curTotal: 20, lastVc4: 0, lastComm: 0, lastTotal: 0 });
  gv.stockAgent.push({ agentId: 'G100', agentName: 'Other Agent', tlId: 'GT2', tlName: 'Other TL', n: 500 });
  gv.stockAgentClass.push({ agentName: 'Other Agent', cls: 'VC4', n: 250 }, { agentName: 'Other Agent', cls: 'Commercial', n: 250 });
  mount({ ff: ffFixture(), gv });
  const K = FF.kpiDetail;
  assert.ok(K && K._stockDetail, 'kpiDetail drawer test ke liye ready');
  const gvDrawer = await K._stockDetail({ src: 'gv', scope: 'stock', tl: 'GV TL' });
  assert.match(gvDrawer.sub, /100/, 'GV TL drawer = 100 tags (poora company stock 600 nahi)');
  const own = await K._stockDetail({ src: 'ff', scope: 'stock', tl: 'TL One', part: 'own' });
  const team = await K._stockDetail({ src: 'ff', scope: 'stock', tl: 'TL One', part: 'team' });
  const all = await K._stockDetail({ src: 'ff', scope: 'stock', tl: 'TL One' });
  assert.match(own.sub, /40/, 'part=own → sirf TL ke paas (40)');
  assert.match(team.sub, /80/, 'part=team → sirf agents ke paas (80)');
  assert.match(all.sub, /120/, 'bina part → TL total (120)');
  assert.ok(!/Ravi Kumar/.test(own.body), 'own drawer me agent ki row nahi');
  assert.ok(/Ravi Kumar/.test(team.body), 'team drawer me agents ki rows hain');
  assert.ok(!/TL One · TL One/.test(team.body), 'team drawer me TL ki apni row nahi');
  assert.ok(/TL One · TL One/.test(own.body), 'own drawer me TL ki apni row dikhti hai');
});

test('people drawer: TL ke Agents card par click = wahi agents (TL ki apni row count me nahi)', async () => {
  mount({ ff: ffFixture() });
  const K = FF.kpiDetail;
  const withoutTl = await K._peopleDetail({ src: 'ff', scope: 'people', tl: 'TL One', self: '0', sort: 'stock' });
  const withTl = await K._peopleDetail({ src: 'ff', scope: 'people', tl: 'TL One', self: '1', sort: 'stock' });
  assert.equal((withoutTl.body.match(/data-kd-agent="/g) || []).length, 2, 'agents list me 2 rows (TL khud nahi)');
  assert.match(withoutTl.body, /Agents total [(]2 agents[)]/);
  assert.match(withoutTl.body, /= TL TOTAL — agents 80 \+ TL ka apna stock 40/, 'drawer ke neeche bhi reconcile footer');
  assert.equal((withTl.body.match(/data-kd-agent="/g) || []).length, 3, 'self=1 par TL ki row bhi dikhti hai');
});
