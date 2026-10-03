/* Regression for TL attribution: GV Master R (GV TL ID) is the counting key; C is only a
   crosswalk/audit ID. Hemalbhai's 332/28 profile figures must match both clicked detail sets,
   even when the report/EIR path offers conflicting 670/55 rollups. */
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
['config', 'util', 'data', 'model', 'store', 'charts', 'gv'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;
FF.auth = { can: () => true, settings: {}, isAdmin: () => true };
FF.store.get = () => [];
FF.store.need = async () => [];
require(path.join(ROOT, 'masterProfile.js'));
require(path.join(ROOT, 'kpiDetail.js'));

const TL = { name: 'Hemalbhai Bhavsar', reportId: 'SUP-C-OLD', gvTlId: 'GV-TL-R' };
const AGENT = { id: 'AG001', name: 'Ravi Agent' };
const currentYm = U.ymKey(new Date());
const lastYm = U.prevMonthKey(currentYm);
const dateFor = (ym, day = 5) => {
  const [year, month] = ym.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const cell = (value) => ({ v: value, f: value instanceof Date ? value.toISOString() : String(value ?? '') });

function gvMasterRow(date, index, cls) {
  const row = Array.from({ length: 24 }, () => null);
  const put = (column, value) => { row[column] = cell(value); };
  put(0, AGENT.id); put(1, AGENT.name); put(2, TL.reportId); put(3, TL.name);
  put(4, `VRN${index}`); put(5, cls.replace(/^VC/, '')); put(6, cls.replace(/^VC/, ''));
  put(7, `SER-${index}`); put(8, `TAG-${index}`); put(9, 100); put(10, 'Customer'); put(11, `PROD-${index}`);
  put(12, 5); put(13, 'ISSUANCE'); put(14, 'Completed'); put(15, date); put(16, '10:00');
  put(17, TL.gvTlId); // GV Master column R is deliberately different from C.
  put(20, cls === 'VC4' ? 'CAR/JEEP/VAN' : 'COMMERCIAL');
  return row;
}
function gvReportRow() {
  const row = Array.from({ length: 52 }, () => null);
  const put = (key, value) => { row[FF.gv.REPORT_COLS[key]] = cell(value); };
  put('agentId', AGENT.id); put('agentName', AGENT.name); put('tlId', TL.reportId); put('tlName', TL.name);
  put('stockVc4', 10); put('stockComm', 3); put('stockTotal', 13);
  // Deliberately conflicting agent rollups; Master R rows should replace these for GV TL issuance.
  put('lastVc4', 670); put('lastComm', 0); put('lastTotal', 670);
  put('curVc4', 55); put('curComm', 0); put('curTotal', 55);
  put('tlStockVc4', 10); put('tlStockComm', 3); put('tlStockTotal', 13);
  put('tlLastVc4', 311); put('tlLastComm', 21); put('tlLastTotal', 332);
  put('tlCurVc4', 25); put('tlCurComm', 3); put('tlCurTotal', 28);
  return row;
}

function makeMasterRows() {
  const rows = [];
  for (let i = 1; i <= 332; i++) rows.push(gvMasterRow(dateFor(lastYm), `LM-${i}`, i <= 311 ? 'VC4' : 'VC20'));
  for (let i = 1; i <= 28; i++) rows.push(gvMasterRow(dateFor(currentYm), `CM-${i}`, i <= 25 ? 'VC4' : 'VC20'));
  return rows;
}

test('GV TL headline and click detail both use GV Master column R when C and R differ', async () => {
  const originalQuery = FF.data.query;
  let legacyRollupCalls = 0;
  const legacyConflict = [
    { key: `${lastYm}-10`, ym: lastYm, day: 10, cls: 'VC4', group: 'VC4', type: 'ISSUANCE', channel: 'GV Partner', agentId: AGENT.id, agentName: AGENT.name, tlId: TL.reportId, tlName: TL.name, n: 670 },
    { key: `${currentYm}-01`, ym: currentYm, day: 1, cls: 'VC4', group: 'VC4', type: 'ISSUANCE', channel: 'GV Partner', agentId: AGENT.id, agentName: AGENT.name, tlId: TL.reportId, tlName: TL.name, n: 55 }
  ];
  FF.gv.reset();
  FF.data.query = async (sheetName) => {
    if (sheetName === 'GV Master') return { cols: [], rows: makeMasterRows() };
    if (sheetName === 'GV REPORT') return { cols: [], rows: [gvReportRow()] };
    if (sheetName === 'Tag Assignment') return { cols: [], rows: [] };
    throw new Error(`Unexpected test sheet query: ${sheetName}`);
  };
  FF.gv.issuanceRows = () => { legacyRollupCalls++; return legacyConflict; };
  try {
    const loadedMaster = await FF.gv.need('master', { only: true });
    assert.equal(loadedMaster.length, 360);
    assert.equal(loadedMaster[0].supervisorId, TL.reportId, 'column C is preserved for identity crosswalk/audit');
    assert.equal(loadedMaster[0].gvTlId, TL.gvTlId, 'column R is retained explicitly');
    assert.equal(loadedMaster[0].tlId, TL.gvTlId, 'canonical TL attribution comes from R, not C');
    assert.equal(FF.gv.masterTlIdentity(TL.reportId, TL.name), TL.gvTlId, 'old/report ID resolves to the unique GV Master R ID');
    assert.equal(FF.gv.tlIssuanceRows(TL.reportId, TL.name).length, 360, 'crosswalk selects rows that are then attributed by R');
    assert.equal(FF.gv.tlIssuanceRows(TL.reportId, '').length, 360, 'column C only resolves to a unique R ID; it is not the row filter');
    assert.equal(FF.gv.tlIssuanceRows('NOT-A-TL', ''), null, 'unmatched ID is explicit so caller can use its fallback source');

    const person = { kind: 'gv-tl', name: TL.name, id: TL.reportId, sub: TL.reportId, tlSet: new Set(), classMap: new Map(), bars: new Set() };
    const profile = await FF.masterProfile.build(person);
    assert.equal(profile.id, TL.gvTlId, 'profile exposes GV Master R as the canonical TL ID');
    assert.deepEqual([profile.totals.lastVc4, profile.totals.lastComm, profile.totals.lastTotal], [311, 21, 332]);
    assert.deepEqual([profile.totals.curVc4, profile.totals.curComm, profile.totals.curTotal], [25, 3, 28]);
    assert.deepEqual([profile.groupBins.last.VC4, profile.groupBins.last.VC20, profile.groupBins.last.total], [311, 21, 332]);
    assert.deepEqual([profile.groupBins.cur.VC4, profile.groupBins.cur.VC20, profile.groupBins.cur.total], [25, 3, 28]);
    assert.equal(profile.issuanceSources.last, 'GV Master · GV TL ID');
    assert.equal(profile.issuanceSources.cur, 'GV Master · GV TL ID');
    assert.match(FF.masterProfile.issuanceCardsHtml(profile), /column R.*EIR grouped totals are not added again/);
    assert.deepEqual([profile.agents[0].last, profile.agents[0].cur], [332, 28], 'member totals come from the same R-filtered rows');
    assert.equal(legacyRollupCalls, 0, 'GV EIR rollup is not added to the Master TL total');

    const lastDetail = await FF.kpiDetail._issuanceDetail({ src: 'gv', scope: 'month', ym: lastYm, tl: TL.name, tlId: TL.gvTlId, title: 'Last month' });
    const currentDetail = await FF.kpiDetail._issuanceDetail({ src: 'gv', scope: 'mtd', ym: currentYm, tl: TL.name, tlId: TL.gvTlId, title: 'This month' });
    assert.match(lastDetail.sub, /<b>332<\/b> tags/, 'the displayed 332 click returns 332');
    assert.match(lastDetail.body, /GV Master TL-ID calculation · no duplicate EIR add/);
    assert.match(lastDetail.body, /GV Master <b>GV TL ID column \(R\)<\/b>: <b>332<\/b>/);
    assert.match(lastDetail.body, /clicked tag rows: <b>332<\/b>/);
    assert.match(currentDetail.sub, /<b>28<\/b> tags/, 'the displayed 28 click returns 28');
    assert.match(currentDetail.body, /GV Master <b>GV TL ID column \(R\)<\/b>: <b>28<\/b>/);
    assert.match(currentDetail.body, /clicked tag rows: <b>28<\/b>/);
    assert.equal(legacyRollupCalls, 0, 'TL drill-down also bypasses the conflicting 670/55 EIR rollup');

    const nestedAgent = await FF.kpiDetail._agentDetail({
      src: 'gv', scope: 'month', ym: lastYm, tl: TL.name, tlId: TL.gvTlId,
      agent: AGENT.name, agentId: AGENT.id, title: `${AGENT.name} · last month`
    });
    assert.match(nestedAgent.sub, /<b>332<\/b> tags/, 'the TL-scoped agent detail stays on the same Master R slice');
    assert.match(nestedAgent.body, /<div class="kd-big">332 <small>tags<\/small><\/div>/);
    assert.doesNotMatch(nestedAgent.body, /GV REPORT agent snapshot/, 'global agent REPORT snapshot does not override parent-scoped Master detail');
  } finally {
    FF.data.query = originalQuery;
    FF.gv.reset();
  }
});
