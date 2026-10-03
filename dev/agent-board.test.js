/* 🧑‍💼 v3.42 — Agent / TL 360 board (agentBoard.js): GV + FF dono ka EK hi drawer format.

   Lock karta hai (user ki list):
     1. upar status + TL (naam · ID · mobile)
     2. last month issuance + current month (MTD) + growth + suggested dispatch
     3. TL ka last/MTD/growth/stock/dispatch (TL ke saath)
     4. class-wise: agent ke saath TL ke numbers (last · MTD · stock), total = KPI
     5. TL ke SAARE agents ka issuance + stock — own + agents = TL total (double count nahi)
     6. agent × class stock matrix + per-agent dispatch
     7. har number/cell clickable (data-kpi drill), har naam clickable (nested board)
     8. PDF / CSV / WhatsApp / Copy actions + share text me TL + agents
   Fixtures asli sheet ke patterns par (GV: GV Master rows; FF: StockDataa rows). */
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
globalThis.location = { hash: '#/gvPerformance', href: '' };
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
const lastYm = U.prevMonthKey(ym);

// ---- fixtures ----------------------------------------------------------------------------------------------
const perfAgent = (o) => ({ week: [1, 2, 3, 0, 0, 1, 2], curDays: 15, curVc4: 0, curNvc4: 0, curTotal: 0, lastVc4: 0, lastNvc4: 0, lastTotal: 0, stockVc4: 0, stockNvc4: 0, stockTotal: 0, tlExcluded: false, agentStatus: 'Active', lastActive: 'Today', growthNum: 20, priority: 'Low', ...o });
function ffFixture() {
  return {
    agents: [
      perfAgent({ name: 'Ravi Kumar', agentId: 'R101', id: 'R101', tlName: 'TL One', tlId: 'T1', tlMobile: '9000000009', mobile: '9000000001', priority: 'High', stockVc4: 40, stockNvc4: 10, stockTotal: 50, curVc4: 100, curNvc4: 20, curTotal: 120, lastVc4: 80, lastNvc4: 20, lastTotal: 100 }),
      perfAgent({ name: 'Priya Sharma', agentId: 'R102', id: 'R102', tlName: 'TL One', tlId: 'T1', tlMobile: '9000000009', mobile: '9000000002', stockVc4: 20, stockNvc4: 10, stockTotal: 30, curVc4: 40, curNvc4: 10, curTotal: 50, lastVc4: 30, lastNvc4: 10, lastTotal: 40 }),
      perfAgent({ name: 'TL One', agentId: 'R100', id: 'R100', tlName: 'TL One', tlId: 'T1', mobile: '9000000000', priority: 'Medium', stockVc4: 30, stockNvc4: 10, stockTotal: 40, curVc4: 60, curNvc4: 10, curTotal: 70, lastVc4: 50, lastNvc4: 10, lastTotal: 60 })
    ],
    stockAgents: [
      { agentId: 'R101', agentName: 'Ravi Kumar', tlId: 'T1', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 40 },
      { agentId: 'R101', agentName: 'Ravi Kumar', tlId: 'T1', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 },
      { agentId: 'R102', agentName: 'Priya Sharma', tlId: 'T1', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 20 },
      { agentId: 'R102', agentName: 'Priya Sharma', tlId: 'T1', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 },
      { agentId: 'R100', agentName: 'TL One', tlId: 'T1', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 30 },
      { agentId: 'R100', agentName: 'TL One', tlId: 'T1', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 }
    ],
    agentClass: [
      { ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 100 },
      { ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 20 },
      { ym, channel: 'First Forward', name: 'Priya Sharma', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 40 },
      { ym, channel: 'First Forward', name: 'Priya Sharma', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 },
      { ym, channel: 'First Forward', name: 'TL One', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 60 },
      { ym, channel: 'First Forward', name: 'TL One', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 },
      { ym: lastYm, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 80 },
      { ym: lastYm, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 20 },
      { ym: lastYm, channel: 'First Forward', name: 'Priya Sharma', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 30 },
      { ym: lastYm, channel: 'First Forward', name: 'Priya Sharma', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 },
      { ym: lastYm, channel: 'First Forward', name: 'TL One', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 50 },
      { ym: lastYm, channel: 'First Forward', name: 'TL One', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 10 }
    ]
  };
}
function gvMaster(agent, perMonth) {
  const rows = [];
  const add = (key, cls, n) => { for (let i = 0; i < n; i++) rows.push({ ym: key, agentId: agent.id, agentName: agent.name, tlId: 'GT1', tlName: 'GV TL', cls, group: /^VC4$/.test(cls) ? 'VC4' : 'VC5+', status: 'Issuance', tagType: 'VRN', n: 1, channel: 'GV Partner' }); };
  Object.entries(perMonth.last || {}).forEach(([cls, n]) => add(lastYm, cls, n));
  Object.entries(perMonth.cur || {}).forEach(([cls, n]) => add(ym, cls, n));
  return rows;
}
function gvFixture() {
  const G1 = { id: 'G001', name: 'GV Ramesh' }, G2 = { id: 'G002', name: 'GV Suresh' }, TL = { id: 'G999', name: 'GV TL' };
  const cur1 = { VC4: 1, VC20: 1 }, last1 = { VC4: 2, VC20: 1 };
  const cur2 = { VC4: 2 }, last2 = { VC4: 1, VC20: 1 };
  const curT = { VC4: 3 }, lastT = { VC4: 4 };
  const sum = (...maps) => maps.reduce((o, m) => { Object.entries(m).forEach(([k, v]) => { o[k] = (o[k] || 0) + v; }); return o; }, {});
  const tot = (m) => Object.values(m).reduce((n, v) => n + v, 0);
  const vc4Of = (m) => m.VC4 || 0;
  const tlCur = sum(cur1, cur2, curT), tlLast = sum(last1, last2, lastT);
  const rep = (p, cur, last, stock) => ({
    agentId: p.id, agentName: p.name, mobile: p.mobile || '', tlId: 'GT1', tlName: 'GV TL', tlMobile: '9000000009',
    priority: p.priority || 'Low', agentStatus: p.status || 'Active Today', growth: 0,
    stockVc4: stock.VC4 || 0, stockComm: stock.OTHER || 0, stockTotal: tot(stock), stockByClass: stock,
    curDays: 15, curVc4: vc4Of(cur), curComm: tot(cur) - vc4Of(cur), curTotal: tot(cur), curByClass: cur,
    lastDays: 12, lastVc4: vc4Of(last), lastComm: tot(last) - vc4Of(last), lastTotal: tot(last), lastByClass: last,
    tlStockVc4: 60, tlStockComm: 40, tlStockTotal: 100,
    tlLastVc4: vc4Of(tlLast), tlLastComm: tot(tlLast) - vc4Of(tlLast), tlLastTotal: tot(tlLast),
    tlCurVc4: vc4Of(tlCur), tlCurComm: tot(tlCur) - vc4Of(tlCur), tlCurTotal: tot(tlCur),
    minRequired: 4, suggestedDispatch: 2
  });
  return {
    report: [
      rep({ ...G1, priority: 'High' }, cur1, last1, { VC4: 20, VC20: 10 }),
      rep(G2, cur2, last2, { VC4: 20, VC20: 20 }),
      rep({ ...TL, priority: 'Medium' }, curT, lastT, { VC4: 20, VC20: 10 })
    ],
    stockAgent: [
      { agentId: 'G001', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'GV TL', n: 30 },
      { agentId: 'G002', agentName: 'GV Suresh', tlId: 'GT1', tlName: 'GV TL', n: 40 },
      { agentId: 'G999', agentName: 'GV TL', tlId: 'GT1', tlName: 'GV TL', n: 30 }
    ],
    stockAgentClass: [
      { agentId: 'G001', agentName: 'GV Ramesh', cls: 'VC4', n: 20 }, { agentId: 'G001', agentName: 'GV Ramesh', cls: 'VC20', n: 10 },
      { agentId: 'G002', agentName: 'GV Suresh', cls: 'VC4', n: 20 }, { agentId: 'G002', agentName: 'GV Suresh', cls: 'VC20', n: 20 },
      { agentId: 'G999', agentName: 'GV TL', cls: 'VC4', n: 20 }, { agentId: 'G999', agentName: 'GV TL', cls: 'VC20', n: 10 }
    ],
    master: [...gvMaster(G1, { cur: cur1, last: last1 }), ...gvMaster(G2, { cur: cur2, last: last2 }), ...gvMaster(TL, { cur: curT, last: lastT })]
  };
}
const person = (kind, name, sub = '') => ({ kind, name, sub });

function mount({ ff, gv } = {}) {
  const data = { agentClass: [], agents: [], stockAgents: [], daily: [], ...ff };
  const gvData = { report: [], stockAgent: [], stockAgentClass: [], stockTl: [], master: [], ...gv };
  FF.store.need = async (k) => data[k] || [];
  FF.store.get = (k) => (k in data ? data[k] : []);
  FF.gv.need = async () => [];
  FF.gv.get = (k) => (k in gvData ? gvData[k] : []);
  FF.gv.rows = () => gvData.master || [];
  FF.gv.issuanceRows = () => [];
  FF.gv.enabled = () => true;
  FF.auth = { can: () => true, settings: {}, isAdmin: () => true, user: { name: 'Tester', username: 't' } };
  FF.config.contacts = { teamWhatsapp: '9999999999', teamEmail: 'x@y.z' };
  FF.pages = {
    performance: { ensureLoaded: async () => {}, agents: () => data.agents || [], daysElapsed: () => 15, dayLabels: () => ['1', '2', '3', '4', '5', '6', '7'] },
    gvPerformance: { sourceRows: () => gvData.report, ensureLoaded: async () => {} }
  };
  for (const f of ['masterProfile', 'kpiDetail', 'agentBoard']) delete require.cache[require.resolve(path.join(ROOT, `${f}.js`))];
  ['masterProfile', 'kpiDetail', 'agentBoard'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
  FF.masterProfile.invalidate();
  return { AB: FF.agentBoard, MP: FF.masterProfile };
}

const sumOf = (rows, k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);

// ---------------------------------------------------------------------------------------------------------
test('GV agent board: hero + TL bar (naam · ID · mobile) aur TL ka poora block', () => {
  const { AB } = mount({ gv: gvFixture() });
  const s = AB.sections(person('gv-agent', 'GV Ramesh', 'G001'));
  assert.ok(!s.missing, 'GV agent mila');
  assert.match(s.hero, /GV Ramesh/);
  assert.match(s.hero, /Active/, 'status badge');
  assert.match(s.hero, /ab-tlbar/, 'TL strip');
  ['GV TL', 'GT1', '9000000009'].forEach((t) => assert.match(s.hero, new RegExp(t), `TL ${t}`));
  assert.match(s.hero, /data-ab-open="GV TL"/, 'TL par click = TL 360');
  assert.match(s.tlBlock, /TL last month/);
  assert.match(s.tlBlock, /TL current month/);
  assert.match(s.tlBlock, /TL stock \(total\)/);
});

test('GV agent board: class-wise me agent + TL dono, aur total = KPI ka number', () => {
  const { AB } = mount({ gv: gvFixture() });
  const s = AB.sections(person('gv-agent', 'GV Ramesh', 'G001'));
  assert.match(s.classBlock, /Agent · GV Ramesh|Agent · GV Ramesh/);
  assert.match(s.classBlock, /TL · GV TL/, 'TL columns');
  assert.equal(sumOf(s.row.classes, 'cur'), s.row.cur.total, 'class MTD jod == KPI MTD');
  assert.equal(sumOf(s.row.classes, 'last'), s.row.last.total, 'class last jod == KPI last');
  assert.equal(sumOf(s.row.classes, 'stock'), s.row.stock.total, 'class stock jod == KPI stock');
  assert.equal(s.tlRow.stock.total, sumOf(s.tlRow.classes, 'stock'), 'TL class stock jod == TL stock KPI');
});

test('GV agent board: TL ke SAARE agents ka issuance + stock, own alag, own + agents = TL total', () => {
  const { AB } = mount({ gv: gvFixture() });
  const s = AB.sections(person('gv-agent', 'GV Ramesh', 'G001'));
  assert.equal(s.team.agents.length, 2, 'TL ke 2 agents (GV TL ki apni row alag)');
  ['GV Suresh'].forEach((n) => assert.match(s.teamBlock, new RegExp(n)));
  assert.match(s.teamBlock, /Agents total \(2\)/);
  assert.match(s.teamBlock, /= TL TOTAL/);
  assert.match(s.teamBlock, /ab-ownrow/, 'TL ke apne (own) row');
  assert.match(s.teamBlock, /data-ab-open="GV Suresh"/, 'har agent row nested board');
  assert.match(s.teamBlock, /Stock VC4/, 'per-agent stock column');
  assert.match(s.teamBlock, />40</, 'agent ka stock (VC4 20 + VC20 20) table me');
  assert.match(s.teamBlock, /ab-cellclick/, 'stock cells clickable');
  const agentsStock = sumOf(s.team.agents, 'stockTotal') + (s.team.own ? s.team.own.stockTotal : 0);
  assert.equal(agentsStock, s.tlRow.stock.total, 'agents + own = TL total stock');
  assert.equal(sumOf(s.team.agents, 'curTotal') + (s.team.own ? s.team.own.curTotal : 0), s.tlRow.cur.total, 'agents + own = TL MTD');
  assert.match(s.matrixBlock, /Agent × Class stock matrix/, 'agent × class matrix');
  assert.match(s.dispatchBlock, /Kis agent ko kitna dispatch chahiye/);
});

test('GV TL board: TL ke apne KPIs + agents table + matrix (agent drawer jaisa format)', () => {
  const { AB } = mount({ gv: gvFixture() });
  const s = AB.sections(person('gv-tl', 'GV TL', 'GT1'));
  assert.equal(s.isTl, true);
  assert.match(s.kpis, /TL Last month/);
  assert.match(s.kpis, /TL Current month/);
  assert.match(s.kpis, /TL ke agents/);
  assert.equal(s.team.agents.length, 2, 'TL ki apni row agents me nahi');
  assert.match(s.teamBlock, /GV Suresh/);
  assert.equal(s.tlRow.cur.total, sumOf(s.team.agents, 'curTotal') + (s.team.own ? s.team.own.curTotal : 0), 'TL MTD = agents + own');
  // v3.44 — GV TL ke liye bhi group table (VC4 · VC20 · VC5+) + TL ID-wise stock (har ID alag, clickable)
  assert.match(s.groupBlock, /Class group · VC4 · VC20 · VC5\+/);
  assert.match(s.stockIdBlock, /TL ID-wise stock · GT1/);
  assert.match(s.stockIdBlock, /Stock VC4<\/th><th class="num">Stock Comm<\/th><th class="num">Stock total/);
  assert.match(s.stockIdBlock, /data-ab-open="GV Suresh"/, 'har agent row se nested board khulta hai');
  assert.match(s.stockIdBlock, /agentId=G002/, 'stock cell par us ID ka drill');
  assert.match(s.stockIdBlock, /= TL TOTAL · 🆔 GT1/, 'TL ID ke saath total');
});

test('FF agent board: wahi sections + TL naam/ID/mobile (channel parity)', () => {
  const { AB } = mount({ ff: ffFixture() });
  const s = AB.sections(person('ff-agent', 'Ravi Kumar', 'R101'));
  assert.ok(!s.missing);
  assert.match(s.hero, /ab-tlbar/); assert.match(s.hero, /TL One/); assert.match(s.hero, /T1/); assert.match(s.hero, /9000000009/);
  assert.match(s.kpis, /Last month/); assert.match(s.kpis, /Current month/); assert.match(s.kpis, /Growth/); assert.match(s.kpis, /Suggested dispatch/);
  assert.match(s.classBlock, /TL · TL One/);
  assert.equal(s.team.agents.length, 2);
  assert.match(s.teamBlock, /Agents total \(2\)/); assert.match(s.teamBlock, /= TL TOTAL/);
  assert.equal(sumOf(s.row.classes, 'cur'), s.row.cur.total, 'FF class jod == KPI');
  assert.equal(sumOf(s.row.classes, 'stock'), s.row.stock.total, 'FF class stock jod == KPI');
});

test('FF TL board: TL ka apna stock (own) alag, own + agents = TL total (double count nahi)', () => {
  const { AB } = mount({ ff: ffFixture() });
  const s = AB.sections(person('ff-tl', 'TL One', 'T1'));
  assert.equal(s.isTl, true);
  assert.equal(s.team.own.name, 'TL One');
  assert.equal(s.team.own.stockTotal, 40, 'TL ki apni stock rows');
  assert.equal(sumOf(s.team.agents, 'stockTotal'), 80);
  assert.equal(s.team.own.stockTotal + sumOf(s.team.agents, 'stockTotal'), s.tlRow.stock.total, 'own + agents = TL total');
  assert.match(s.teamBlock, /ab-ownrow/);
  assert.match(s.matrixBlock, /Ravi Kumar/);
  // v3.44 — FF par bhi wahi do sections (channel parity): group table + TL ID-wise stock
  assert.match(s.groupBlock, /Class group · VC4 · VC20 · VC5\+[\s\S]*?TL One/);
  assert.match(s.stockIdBlock, /TL ID-wise stock · T1/);
  assert.match(s.stockIdBlock, /= TL TOTAL · 🆔 T1/);
});

test('dono channel: har KPI / cell clickable (data-kpi drill) + koi undefined/NaN nahi', () => {
  const gv = mount({ gv: gvFixture() });
  const gvs = gv.AB.sections(person('gv-agent', 'GV Ramesh', 'G001'));
  const ff = mount({ ff: ffFixture() });
  const ffs = ff.AB.sections(person('ff-agent', 'Ravi Kumar', 'R101'));
  for (const [label, s, ch] of [['gv', gvs, 'gv'], ['ff', ffs, 'ff']]) {
    assert.ok(!/undefined|NaN|\[object Object\]/.test(s.html), `${label}: koi undefined/NaN nahi`);
    const drills = [...s.html.matchAll(/data-kpi="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(drills.length >= 20, `${label}: kaafi drill targets (${drills.length})`);
    assert.ok(drills.every((d) => /src=(gv|ff)/.test(d) && /scope=/.test(d)), `${label}: har drill me src + scope`);
    assert.ok(drills.every((d) => !/channel=|&channel=/.test(d) || d.includes(`channel=${ch}`)), `${label}: channel sahi`);
    const opens = [...s.html.matchAll(/data-ab-open="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(opens.length >= 3 && opens.every(Boolean), `${label}: nested open targets`);
  }
});

test('board drawer: wide + TL sub + WhatsApp/CSV/PDF actions, share text me TL + agents', async () => {
  const { AB } = mount({ gv: gvFixture() });
  let opened = null;
  FF.app = { openDrawer: (o) => { opened = o; return true; } };
  await AB.open(person('gv-agent', 'GV Ramesh', 'G001'));
  assert.ok(opened, 'drawer khula');
  assert.equal(opened.wide, true, 'wide drawer');
  assert.match(opened.kicker, /360/, 'kicker me 360');
  assert.match(opened.sub, /GT1/, 'sub me TL ID');
  assert.match(opened.sub, /9000000009/, 'sub me TL mobile');
  assert.match(opened.body, /ab-hero/); assert.match(opened.body, /ab-class/); assert.match(opened.body, /ab-team/);
  assert.match(opened.actions, /data-ab-share/, 'WhatsApp share');
  assert.match(opened.actions, /data-ab-copy/, 'copy');
  const text = AB.shareText(person('gv-agent', 'GV Ramesh', 'G001'));
  ['GV Ramesh', 'GV TL', 'Last month', 'Current month', 'Suggested dispatch', 'Stock', 'GV Suresh'].forEach((t) => assert.ok(text.includes(t), `share text me "${t}"`));
});

test('direct agent (TL nahi): TL bar nahi, par board phir bhi poora', () => {
  const gv = gvFixture();
  gv.report.push({ agentId: 'G777', agentName: 'GV Direct', mobile: '9000000777', tlId: '', tlName: 'Direct', priority: 'High', agentStatus: 'Inactive', stockVc4: 0, stockComm: 0, stockTotal: 0, stockByClass: {}, curVc4: 0, curComm: 0, curTotal: 0, curByClass: {}, lastVc4: 5, lastComm: 0, lastTotal: 5, lastByClass: { VC4: 5 } });
  const { AB } = mount({ gv });
  const s = AB.sections(person('gv-agent', 'GV Direct', 'G777'));
  assert.ok(!s.missing);
  assert.ok(!/ab-tlbar/.test(s.hero), 'direct par TL bar nahi');
  assert.match(s.kpis, /Suggested dispatch/, 'dispatch KPI phir bhi hai');
  assert.match(s.hero, /Direct/i, 'direct label');
});

// ---- wiring (index.html + sw.js + lazy.js + package.json) ---------------------------------------------------
test('wiring: agentBoard.js load hota hai (index + sw) aur cache bust v68 / v76 hai', async () => {
  const fs = await import('node:fs');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const lazy = fs.readFileSync(path.join(ROOT, 'lazy.js'), 'utf8');
  const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  assert.ok(idx.includes('agentBoard.js?v=70'), 'index.html me agentBoard');
  assert.ok(idx.indexOf('performance.js') < idx.indexOf('agentBoard.js'), 'performance ke baad load');
  assert.ok(idx.indexOf('agentBoard.js') < idx.indexOf('masterProfile.js'), 'masterProfile se pehle load');
  assert.ok(sw.includes('./agentBoard.js?v=70'), 'sw ASSETS me agentBoard');
  assert.match(sw, /CACHE_NAME = 'apnapayment-v77'/);
  assert.match(lazy, /return m \? m\[1\] : '70'/);
  assert.match(pkg, /agentBoard/);
});
