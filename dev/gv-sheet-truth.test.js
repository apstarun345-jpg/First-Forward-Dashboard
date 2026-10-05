/* 🧾 GV sheet-first guard — TL APS011919 ka asli GV REPORT data:
   site par pehle "last month 440" dikhta tha (tag-ledger ka jod), jabki GV REPORT sheet me 332 hai.
   Ye test wahi row-level data daal kar poori chain check karta hai — parser → overlay → 360 profile
   → drawer HTML (TL ID-wise stock, VC4 · VC20 · VC5+). */
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
globalThis.location = { hash: '#/home', href: '' };
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false,
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true },
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
};
['config', 'util', 'data', 'model', 'gv', 'store', 'charts'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;
const ym = U.ymKey(new Date());
const prev = U.prevMonthKey(ym);

/** GV REPORT (10 Sep fetch) — TL APS011919 ka poora team, columns A..AZ jaisa sheet me hai. */
const TL = { id: 'APS011919', name: 'Hemalbhai Bhavsar', stockVc4: 657, stockComm: 397, stockTotal: 1054, lastVc4: 311, lastComm: 21, lastTotal: 332, curVc4: 25, curComm: 2, curTotal: 27 };
const TEAM = [
  ['Taga Ram', 'APS013659', 162, 13, 175, 7, 0, 7, 5, 0, 5],
  ['KAWARA RAM', 'APS04505', 107, 29, 136, 81, 0, 81, 6, 0, 6],
  ['Dharma Ram Godara', 'APS016706', 44, 9, 53, 0, 0, 0, 0, 0, 0],
  ['Shreeshail Vadageri', 'APS018154', 15, 1, 16, 26, 0, 26, 2, 0, 2],
  ['Hemalbhai Bhavsar', 'APS011919', 329, 345, 674, 197, 21, 218, 12, 2, 14]
];
const cell = (v) => (v === null || v === undefined ? null : { v, f: String(v) });
function sheetRow([name, id, svc4, scomm, stotal, lvc4, lcomm, ltotal, cvc4, ccomm, ctotal]) {
  const r = Array(52).fill(null);
  const put = (key, v) => { r[FF.gv.REPORT_COLS[key]] = cell(v); };
  put('agentName', name); put('agentId', id); put('tlId', TL.id); put('tlName', TL.name);
  put('stockVc4', svc4); put('stockComm', scomm); put('stockTotal', stotal);
  put('lastVc4', lvc4); put('lastComm', lcomm); put('lastTotal', ltotal); put('lastDays', 30);
  put('curVc4', cvc4); put('curComm', ccomm); put('curTotal', ctotal); put('curDays', 3);
  put('tlStockVc4', TL.stockVc4); put('tlStockComm', TL.stockComm); put('tlStockTotal', TL.stockTotal);
  put('tlLastVc4', TL.lastVc4); put('tlLastComm', TL.lastComm); put('tlLastTotal', TL.lastTotal);
  put('tlCurVc4', TL.curVc4); put('tlCurComm', TL.curComm); put('tlCurTotal', TL.curTotal);
  return r;
}
const tag = (month, name, id, cls, day, n) => ({
  key: `${month}-${String(day).padStart(2, '0')}`, ym: month, day, cls, group: FF.model.classGroup(cls),
  type: 'ISSUANCE', status: 'ISSUANCE', channel: 'GV Partner', agentId: id, agentName: name, tlId: TL.id, tlName: TL.name, n: n || 1
});
/** Tag-ledger (EIR / GV Master) — isme previous month ka jod 440 hai (user ko yahi farq dikha tha). */
function ledgerRows() {
  const rows = [];
  let left = 440, day = 0;
  while (left > 0) {
    const n = Math.min(40, left), who = TEAM[day % TEAM.length];
    rows.push(tag(prev, who[0], who[1], day % 3 === 0 ? 'VC20' : 'VC4', (day % 27) + 1, n));
    left -= n; day++;
  }
  rows.push(
    tag(ym, TEAM[0][0], TEAM[0][1], 'VC4', 1, 5), tag(ym, TEAM[1][0], TEAM[1][1], 'VC4', 2, 6),
    tag(ym, TEAM[3][0], TEAM[3][1], 'VC4', 3, 2), tag(ym, TEAM[3][0], TEAM[3][1], 'VC4', 4, 6),
    tag(ym, TEAM[4][0], TEAM[4][1], 'VC4', 5, 12), tag(ym, TEAM[4][0], TEAM[4][1], 'VC20', 6, 2)
  );
  return rows;
}
const LEDGER = ledgerRows();
const ledgerTotal = (month) => LEDGER.filter((r) => r.ym === month).reduce((n, r) => n + r.n, 0);

FF.store.get = () => [];
FF.store.need = async () => [];
FF.auth = { can: () => true, settings: {}, isAdmin: () => true };
FF.pages = Object.assign(FF.pages || {}, { performance: { ensureLoaded: async () => {}, agents: () => [], daysElapsed: () => 3, dayLabels: () => [] } });
['masterProfile', 'agentBoard', 'kpiDetail', 'gvpages'].forEach((m) => require(path.join(ROOT, `${m}.js`)));

async function bootReport() {
  const query = FF.data.query;
  FF.data.query = async () => ({ rows: TEAM.map(sheetRow), cols: [] });
  FF.gv.reset();
  await FF.gv.need('report', { only: true });
  FF.data.query = query;
  const data = FF.gv.state.data || {};
  data.master = []; data.stockAgent = []; data.stockTl = []; data.stockAgentClass = [];
  FF.gv.state.data = data;
  const base = FF.gv.get.bind(FF.gv);
  FF.gv.get = (key) => (key === 'report' ? base('report') : (data[key] || []));
  FF.gv.issuanceRows = () => LEDGER;
  FF.store.get = (k) => (data[k] || []);
  FF.store.need = async (k) => (data[k] || []);
  if (FF.masterProfile && FF.masterProfile.invalidate) FF.masterProfile.invalidate();
  return FF.gv.get('report');
}

test('GV REPORT blank-vs-zero: sheet ke bhare hue month cells authoritative hain', async () => {
  assert.equal(ledgerTotal(prev), 440, 'fixture me ledger ka jod 440 hai (jo site par galat dikh raha tha)');
  const report = await bootReport();
  assert.equal(report.length, 5);
  report.forEach((r) => {
    assert.equal(r.tlId, TL.id);
    assert.equal(r.lastAvailable, true, 'last month ke cells bhare hue hain');
    assert.equal(r.curAvailable, true);
    assert.equal(r.tlLastAvailable, true, 'TL snapshot cells bhare hue hain');
    assert.equal(r.tlCurAvailable, true);
    assert.equal(r.tlStockAvailable, true);
  });
});

test('sheet-first: 440 wala tag-ledger GV REPORT ke 332 ko override nahi karta (overlay + TL row)', async () => {
  await bootReport();
  const over = FF.pages.gvPerformance._overlay(FF.gv.get('report'));
  const team = over.filter((r) => r.tlId === TL.id);
  assert.equal(team.length, 5);
  team.forEach((r) => {
    assert.equal(r.tlLastVc4, 311, 'TL last month VC4 = sheet');
    assert.equal(r.tlLastComm, 21);
    assert.equal(r.tlLastTotal, 332, 'TL last month total = sheet ka 332, ledger ka 440 nahi');
    assert.equal(r.tlCurVc4, 25);
    assert.equal(r.tlCurTotal, 27, 'TL current month = sheet ka 27');
  });
  const self = over.find((r) => r.agentId === TL.id);
  assert.equal(self.lastTotal, 218, 'TL ki apni row ka last month bhi sheet se');
  assert.equal(self.curTotal, 14);
});

test('GV TL 360 profile: totals + stock sheet ke barabar (332 / 27 / 1054) aur group bins 3-way', async () => {
  await bootReport();
  const MP = FF.masterProfile;
  const pr = await MP.build({ kind: 'gv-tl', name: TL.name, id: TL.id, sub: TL.id, tlSet: new Set(), classMap: new Map(), bars: new Set() });
  assert.equal(pr.totals.lastTotal, 332, 'TL last month = GV REPORT sheet (440 nahi)');
  assert.equal(pr.totals.lastVc4, 311);
  assert.equal(pr.totals.lastComm, 21);
  assert.equal(pr.totals.curTotal, 27, 'TL current month = sheet');
  assert.equal(pr.totals.curVc4, 25);
  assert.equal(pr.stock.total, 1054, 'TL ka stock = GV REPORT "TL Total Stock" (own + agents)');
  assert.equal(pr.stock.vc4, 657);
  assert.equal(pr.stock.comm, 397);
  assert.deepEqual([pr.tlStock.own.total, pr.tlStock.agents.total], [674, 380], 'own 674 + agents 380 = 1054 (double count nahi)');
  assert.equal(pr.groupBins.last.VC4, 311, 'last month VC4 sheet se');
  assert.equal(pr.groupBins.last.total, 332);
  assert.equal(pr.groupBins.last.source, 'GV REPORT sheet');
  assert.equal(pr.groupBins.last.ledger.total, 440, 'ledger ka jod note ke liye available rehta hai');
  assert.equal(pr.groupBins.cur.VC4, 25);
  assert.equal(pr.groupBins.cur.total, 27);
  assert.deepEqual([pr.groupBins.cur.VC4, pr.groupBins.cur.VC20, pr.groupBins.cur['VC5+']], [25, 2, 0], 'current month ka batwara sheet ke class columns se');
  assert.deepEqual([pr.groupBins.stock.VC4, pr.groupBins.stock['VC5+'], pr.groupBins.stock.total], [657, 397, 1054]);
});

test('drawer: TL ID-wise stock neeche, har agent alag + clickable, VC4 · VC20 · VC5+ table', async () => {
  await bootReport();
  const MP = FF.masterProfile;
  const pr = await MP.build({ kind: 'gv-tl', name: TL.name, id: TL.id, sub: TL.id, tlSet: new Set(), classMap: new Map(), bars: new Set() });
  const html = MP.html(pr);
  assert.match(html, /mp-group-tbl/, 'VC4 · VC20 · VC5+ summary table');
  assert.match(html, /data-mp-sec="tlstock"/, 'TL ID-wise stock section');
  assert.match(html, /🆔 TL ID-wise stock/);
  assert.ok(html.includes('APS011919'), 'TL ID ke saath stock');
  assert.match(html, /Stock VC4<\/th><th class="num">Stock Comm<\/th><th class="num">Stock total/, 'per-agent stock columns');
  for (const [, id] of TEAM) assert.ok(html.includes(id), `${id} ki row drawer me`);
  assert.match(html, /scope=stock&amp;agent=[^&]*&amp;agentId=APS011919/, 'stock cell clickable (us ID ka stock)');
  assert.match(html, /= TL TOTAL · 🆔 APS011919/, 'footer me TL ID ke saath total');
  assert.ok(html.includes(U.fmt(1054)), 'TL stock total 1,054 drawer me');
  assert.match(html, /data-mp-go="tlstock"/);
  // 🧾 class-wise table ka Total bhi sheet ka (440 ledger jod sirf note me) — warna drawer me do total dikhte the
  assert.match(html, /Total <small class="dim">\(sheet\)<\/small><\/td><td class="num">332<\/td><td class="num">27<\/td>/);
  assert.match(html, /Class rows tag-ledger \(EIR \/ GV Master\) se aate hain/);
  assert.match(html, /Last: sheet <b>332<\/b> vs tag ledger <b>440<\/b> \(Δ \+108\)/);
});

let board;
test('agent board (GV Performance ka 360): wahi sheet numbers + TL ID-wise stock bottom me', async () => {
  await bootReport();
  board = FF.agentBoard.sections({ kind: 'gv-tl', name: TL.name, sub: TL.id });
  const html = board.html;
  assert.match(html, /Class group · VC4 · VC20 · VC5\+/);
  assert.match(html, /TL ID-wise stock · APS011919/);
  assert.ok(html.includes(U.fmt(1054)), 'TL stock total 1,054 board me');
  assert.match(html, /data-kpi="src=gv&amp;channel=gv&amp;scope=stock&amp;agent=[^"]*agentId=APS011919/, 'stock cells clickable');
  const idxGroup = html.indexOf('Class group'), idxStock = html.indexOf('TL ID-wise stock');
  assert.ok(idxGroup > -1 && idxStock > idxGroup, 'stock block group table ke baad / neeche aata hai');
});

test('kpiDetail drill-down: Hemalbhai Bhavsar ke drawer me Last month (332) ya This month (27/28) click karne par wahi exact number + explanation aata hai', async () => {
  await bootReport();
  const KD = FF.kpiDetail;
  // 1) Last month = 332 (chahe ym diya ho ya Home kundli strip jaisa ym="" khaali ho)
  const lastDrill = await KD._issuanceDetail({ src: 'gv', channel: 'gv', scope: 'month', ym: prev, tl: TL.name, tlId: TL.id, title: `${TL.name} · Last month` });
  assert.match(lastDrill.sub, /<b>332<\/b> tags/, 'Last month drill sub me 332');
  assert.match(lastDrill.body, /<div class="kd-big">332 <small>tags<\/small><\/div>/, 'Last month hero big number = 332 (670 ya 440 nahi)');
  assert.match(lastDrill.body, /GV REPORT TL snapshot: <b>332<\/b> \(VC4 <b>311<\/b> · Commercial <b>21<\/b>\)/);
  assert.match(lastDrill.body, /GV Master \/ EIR detail: <b>440<\/b> · Difference: <b>\+108<\/b>/);
  assert.match(lastDrill.body, /Hemalbhai Bhavsar \(TL own\) <b>218<\/b>/);
  assert.match(lastDrill.body, /KAWARA RAM <b>81<\/b>/);

  // Empty ym="" (Home strip / peopleTableHtml regression guard)
  const lastNoYm = await KD._issuanceDetail({ src: 'gv', channel: 'gv', scope: 'month', ym: '', tl: TL.name, tlId: TL.id, title: `${TL.name} · Last month` });
  assert.match(lastNoYm.body, /<div class="kd-big">332 <small>tags<\/small><\/div>/, 'scope=month&ym= bhi Last month 332 hi khole (Current month par fall-through nahi)');

  // 2) This month = 27 (aur cardValue="28" jab aaj ka 1 live tag jud kar 28 ho)
  const curDrill = await KD._issuanceDetail({ src: 'gv', channel: 'gv', scope: 'mtd', ym, tl: TL.name, tlId: TL.id, title: `${TL.name} · Current month` });
  assert.match(curDrill.sub, /<b>27<\/b> tags/, 'Current month drill sub me 27');
  assert.match(curDrill.body, /<div class="kd-big">27 <small>tags<\/small><\/div>/, 'Current month hero big number = 27 (55 nahi)');
  assert.match(curDrill.body, /<b>332<\/b><\/small><\/div><\/div>/, 'Current month ke vs comparison me bhi Last month = 332 dikhe (670 nahi)');

  // 3) Class/group filtered click (VC4 = 311, Comm = 21)
  const vc4Drill = await KD._issuanceDetail({ src: 'gv', channel: 'gv', scope: 'month', ym: prev, tl: TL.name, tlId: TL.id, f: 'vc4', title: `${TL.name} · VC4` });
  assert.match(vc4Drill.body, /<div class="kd-big">311 <small>tags<\/small><\/div>/, 'VC4 click par 311');
  const commDrill = await KD._issuanceDetail({ src: 'gv', channel: 'gv', scope: 'month', ym: prev, tl: TL.name, tlId: TL.id, f: 'comm', title: `${TL.name} · Commercial` });
  assert.match(commDrill.body, /<div class="kd-big">21 <small>tags<\/small><\/div>/, 'Commercial click par 21');

  // 4) Agent row click (KAWARA RAM = 81, Hemalbhai Bhavsar own = 218)
  const agDrill = await KD._agentDetail({ src: 'gv', channel: 'gv', scope: 'month', ym: prev, agent: 'KAWARA RAM', agentId: 'APS04505', title: 'KAWARA RAM · Last month' });
  assert.match(agDrill.body, /<div class="kd-big">81 <small>tags<\/small><\/div>/, 'Agent Last month click par wahi 81 dikhe');
  assert.match(agDrill.body, /GV REPORT agent snapshot: <b>81<\/b>/);
});
