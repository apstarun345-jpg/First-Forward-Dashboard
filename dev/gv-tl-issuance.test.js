/* GV REPORT TL issuance snapshots, blank/zero semantics, Home issuance cards, and drill reconciliation. */
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

const cell = (value) => value === null || value === undefined ? null : { v: value, f: String(value) };

test('GV REPORT parser retains explicit zero and distinguishes it from a blank TL snapshot', async () => {
  const query = FF.data.query;
  const row = Array(52).fill(null);
  const put = (key, value) => { row[FF.gv.REPORT_COLS[key]] = cell(value); };
  put('agentId', 'G100'); put('agentName', 'Agent One'); put('tlId', 'T100'); put('tlName', 'TL One');
  put('tlCurVc4', 0); put('tlCurComm', 2); put('tlCurTotal', 2);
  // All last-month TL fields are blank, not zero: this period should fall back to the ledger.
  FF.data.query = async () => ({ rows: [row], cols: [] });
  FF.gv.reset();
  try {
    const [report] = await FF.gv.need('report', { only: true });
    assert.equal(report.tlCurAvailable, true);
    assert.deepEqual([report.tlCurVc4, report.tlCurComm, report.tlCurTotal], [0, 2, 2], 'a real zero survives parsing');
    assert.equal(report.tlLastAvailable, false);
    assert.deepEqual([report.tlLastVc4, report.tlLastComm, report.tlLastTotal], [null, null, null], 'blank stays unavailable');
  } finally {
    FF.data.query = query;
    FF.gv.reset();
  }
});

test('GV TL profile uses deduplicated GV REPORT totals; colored cards show ledger class groups and projections', async () => {
  const stock = { daily: [], agentClass: [], agents: [], stockAgents: [] };
  FF.store.get = (key) => stock[key] || [];
  FF.store.need = async (key) => stock[key] || [];
  FF.auth = { can: () => true, settings: {}, isAdmin: () => true };
  FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => [], daysElapsed: () => 15, dayLabels: () => [] } };

  const reports = [
    { agentId: 'G101', agentName: 'Agent One', tlId: 'T100', tlName: 'TL One', priority: 'High', stockVc4: 2, stockComm: 1, stockTotal: 3,
      curVc4: 8, curComm: 2, curTotal: 10, lastVc4: 5, lastComm: 1, lastTotal: 6,
      tlCurVc4: 14, tlCurComm: 3, tlCurTotal: 17, tlCurAvailable: true, tlLastVc4: 7, tlLastComm: 4, tlLastTotal: 11, tlLastAvailable: true },
    { agentId: 'G102', agentName: 'Agent Two', tlId: 'T100', tlName: 'TL One', priority: 'Low', stockVc4: 1, stockComm: 1, stockTotal: 2,
      curVc4: 4, curComm: 1, curTotal: 5, lastVc4: 2, lastComm: 2, lastTotal: 4,
      tlCurVc4: 14, tlCurComm: 3, tlCurTotal: 17, tlCurAvailable: true, tlLastVc4: 7, tlLastComm: 4, tlLastTotal: 11, tlLastAvailable: true }
  ];
  const tag = (month, agentId, agentName, cls, day) => ({
    key: `${month}-${String(day).padStart(2, '0')}`, ym: month, day, cls, group: FF.model.classGroup(cls),
    type: 'ISSUANCE', status: 'ISSUANCE', channel: 'GV Partner', agentId, agentName, tlId: 'T100', tlName: 'TL One', n: 1
  });
  const ledger = [
    tag(ym, 'G101', 'Agent One', 'VC4', 1), tag(ym, 'G101', 'Agent One', 'VC4', 2), tag(ym, 'G101', 'Agent One', 'VC4', 3), tag(ym, 'G101', 'Agent One', 'VC4', 4),
    tag(ym, 'G101', 'Agent One', 'VC4', 5), tag(ym, 'G101', 'Agent One', 'VC4', 6), tag(ym, 'G101', 'Agent One', 'VC4', 7), tag(ym, 'G101', 'Agent One', 'VC4', 8),
    tag(ym, 'G101', 'Agent One', 'VC20', 9), tag(ym, 'G101', 'Agent One', 'VC20', 10),
    tag(ym, 'G102', 'Agent Two', 'VC4', 11), tag(ym, 'G102', 'Agent Two', 'VC4', 12), tag(ym, 'G102', 'Agent Two', 'VC4', 13), tag(ym, 'G102', 'Agent Two', 'VC4', 14),
    tag(ym, 'G102', 'Agent Two', 'VC20', 15),
    tag(prev, 'G101', 'Agent One', 'VC4', 1), tag(prev, 'G101', 'Agent One', 'VC4', 2), tag(prev, 'G101', 'Agent One', 'VC4', 3), tag(prev, 'G101', 'Agent One', 'VC4', 4), tag(prev, 'G101', 'Agent One', 'VC4', 5),
    tag(prev, 'G101', 'Agent One', 'VC20', 6), tag(prev, 'G102', 'Agent Two', 'VC4', 7), tag(prev, 'G102', 'Agent Two', 'VC4', 8), tag(prev, 'G102', 'Agent Two', 'VC20', 9), tag(prev, 'G102', 'Agent Two', 'VC20', 10), tag(prev, 'G102', 'Agent Two', 'VC20', 11)
  ];
  const gvData = { report: reports, master: [], stockAgent: [], stockTl: [], stockAgentClass: [] };
  FF.gv.state.data = gvData;
  FF.gv.get = (key) => gvData[key];
  FF.gv.issuanceRows = () => ledger;

  delete require.cache[require.resolve(path.join(ROOT, 'masterProfile.js'))];
  require(path.join(ROOT, 'masterProfile.js'));
  const MP = FF.masterProfile;
  const person = { kind: 'gv-tl', name: 'TL One', id: 'T100', sub: 'T100', tlSet: new Set(), classMap: new Map(), bars: new Set() };
  const profile = await MP.build(person);
  assert.deepEqual([profile.totals.curVc4, profile.totals.curComm, profile.totals.curTotal], [14, 3, 17], 'GV REPORT current-month TL snapshot wins over the lower tag-ledger sum');
  assert.deepEqual([profile.totals.lastVc4, profile.totals.lastComm, profile.totals.lastTotal], [7, 4, 11], 'GV REPORT last-month TL snapshot is used');
  assert.deepEqual([profile.classBins.cur.VC4, profile.classBins.cur.VC20, profile.classBins.cur['VC5+']], [12, 3, 0], 'class breakdown stays sourced from tag ledger');
  assert.deepEqual([profile.classBins.last.VC4, profile.classBins.last.VC20, profile.classBins.last['VC5+']], [7, 4, 0]);
  assert.equal(profile.classes.reduce((sum, row) => sum + row.cur, 0), 15, 'detailed class rows are not padded to hide the snapshot gap');
  assert.equal(profile.issuanceSources.cur, 'GV REPORT · TL Current Month Issuance');
  assert.equal(profile.issuanceSources.classes, 'GV Master / EIR');
  assert.equal(profile.issuanceSources.stock, 'GV REPORT TL stock snapshot / Tag Assignment');

  const row = MP.reportDataRow(person);
  assert.equal(row.cur, 17, 'Home search uses the same TL snapshot as profile');
  assert.equal(row.last, 11);
  assert.equal(row.issuance.current.expected, U.projectMonthEnd(17, row.issuance.runRateDays, ym));
  const cards = MP.issuanceCardsHtml(row.issuance);
  for (const label of ['Last month', 'Current month', 'VC4', 'VC20', 'VC5+', 'Expected in month']) assert.ok(cards.includes(label), `${label} card / projection missing`);
  assert.match(cards, /GV REPORT[^<]*TL Current Month Issuance/);
  assert.match(cards, /stock: <b>GV REPORT TL stock snapshot \/ Tag Assignment<\/b>/);
  assert.match(cards, /Current: 17 report vs 15 ledger \(Δ -2\)/, 'Home card discloses the exact TL-snapshot / ledger difference');
  assert.match(cards, /data-kpi="src=gv&amp;scope=mtd/);
  assert.match(cards, /f=vc20/);

  delete require.cache[require.resolve(path.join(ROOT, 'kpiDetail.js'))];
  require(path.join(ROOT, 'kpiDetail.js'));
  const drill = await FF.kpiDetail._issuanceDetail({ src: 'gv', scope: 'mtd', ym, tl: 'TL One', tlId: 'T100', title: 'Current month' });
  assert.match(drill.body, /GV REPORT ↔ tag-ledger reconciliation/);
  assert.match(drill.body, /GV REPORT TL snapshot: <b>17<\/b>/);
  assert.match(drill.body, /GV Master \/ EIR detail: <b>15<\/b>/);
  assert.match(drill.body, /Difference: <b>-2<\/b>/);
});
