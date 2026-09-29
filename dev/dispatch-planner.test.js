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
U.runRateDays = () => 28;   // aaj 29 tareekh → 29 − 1 = 28 din
FF.config.features.suggestDays = 25;

const A = (o) => ({ week: [0, 0, 0, 0, 0, 0, 0], curVc4: 0, curNvc4: 0, curTotal: 0, lastVc4: 0, lastNvc4: 0, lastTotal: 0, stockVc4: 0, stockNvc4: 0, stockTotal: 0, tlExcluded: false, agentStatus: 'Active', ...o });
const ffAgents = [
  A({ name: 'Ravi Kumar', agentId: 'R1', tlName: 'TL One', tlId: 'T1', priority: 'High', curVc4: 280, curNvc4: 0, curTotal: 280, lastVc4: 200, lastTotal: 200, stockVc4: 100, stockTotal: 100, tlStockVc4: 300, tlStockTotal: 300, tlPriority: 'Medium' }),
  A({ name: 'Sita Devi', agentId: 'R2', tlName: 'TL One', tlId: 'T1', priority: 'Low', curVc4: 56, curTotal: 56, lastVc4: 90, lastTotal: 90, stockVc4: 500, stockTotal: 500, tlStockVc4: 300, tlStockTotal: 300, tlPriority: 'Medium' }),
  A({ name: 'Direct Dev', agentId: 'D1', tlName: 'APS', agentPriority: 'Medium', priority: 'Medium', tlExcluded: true, curVc4: 84, curTotal: 84, stockVc4: 10, stockTotal: 10 }),
  A({ name: 'Source Review', agentId: 'D2', tlName: 'APS', agentPriority: 'Review soon', priority: 'High', tlExcluded: true, curVc4: 40, curTotal: 40 })
];
const gvRows = [
  { agentId: 'G1', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'GV TL', priority: 'High', stockVc4: 0, stockComm: 0, stockTotal: 0, curVc4: 140, curComm: 28, curTotal: 168, lastVc4: 100, lastComm: 20, lastTotal: 120, agentStatus: 'Active' },
  { agentId: 'G2', agentName: 'GV Free', tlId: '', tlName: '', priority: 'Low', stockVc4: 5, stockComm: 0, stockTotal: 5, curVc4: 28, curComm: 0, curTotal: 28, lastVc4: 0, lastComm: 0, lastTotal: 0 }
];
FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => ffAgents } };
FF.gv.enabled = () => true; FF.gv.need = async () => gvRows; FF.gv.get = (k) => (k === 'report' ? gvRows : []);
require(path.join(ROOT, 'directAgents.js'));
require(path.join(ROOT, 'dispatchPlanner.js'));
const DP = FF.dispatchPlanner;

const rows = () => DP.collectAgents().map((r) => DP.withCalc(r, 'total'));

test('agents from FF + GV in one shape, direct flag + priority normalised', () => {
  const list = DP.collectAgents();
  assert.equal(list.length, 6);
  assert.equal(list.filter((r) => r.ch === 'ff').length, 4); assert.equal(list.filter((r) => r.ch === 'gv').length, 2);
  assert.equal(list.filter((r) => r.direct).length, 3, 'FF APS + GV no-TL');
  assert.equal(list.find((r) => r.name === 'GV Free').priority, 'Low');
  assert.equal(list.find((r) => r.name === 'Source Review').priority, 'Review soon', 'unknown source label is preserved instead of being called Low');
});

test('run-rate = issued ÷ (today−1); required = rate × settings days; with / w/o stock; cover', () => {
  const r = rows().find((x) => x.name === 'Ravi Kumar');
  assert.equal(r.rate, 10);                 // 280 ÷ 28
  assert.equal(r.required, 250);            // 10 × 25
  assert.equal(r.gross, 250); assert.equal(r.net, 150);   // 250 − stock 100
  assert.equal(r.cover, 10);                // 100 ÷ 10
  const s = rows().find((x) => x.name === 'Sita Devi');
  assert.equal(s.net, 0, 'stock 500 already covers'); assert.equal(s.action.t, '✅ Covered');
  const g = rows().find((x) => x.name === 'GV Ramesh');
  assert.equal(g.rate, 6); assert.equal(g.net, 150); assert.equal(g.cover, 0);
});

test('tag basis VC4 / Commercial / total', () => {
  const g = DP.collectAgents().find((x) => x.name === 'GV Ramesh');
  assert.equal(DP.withCalc(g, 'vc4').rate, 5); assert.equal(DP.withCalc(g, 'comm').rate, 1);
  assert.equal(DP.withCalc(g, 'total').required, 150);
});

test('direct agents: tags for High/Medium, none for Low', () => {
  const d = rows().find((x) => x.name === 'Direct Dev');
  assert.equal(d.direct, true); assert.equal(d.tagged, true); assert.match(d.action.t, /Tags/);
  const f = rows().find((x) => x.name === 'GV Free');
  assert.equal(f.tagged, false); assert.equal(f.action.t, 'No dispatch');
  const raw = rows().find((x) => x.name === 'Source Review');
  assert.equal(raw.priority, 'Review soon'); assert.equal(raw.tagged, false, 'unmapped source priority must not imply High/Medium tag need');
});

test('TL-wise rows: TL stock from sheet, direct group per channel, priority', () => {
  const agents = DP.collectAgents();
  const tls = DP.collectTls(agents).map((t) => DP.withCalc(t, 'total'));
  const one = tls.find((t) => t.name === 'TL One');
  assert.equal(one.agents, 2); assert.equal(one.curV, 336); assert.equal(one.rate, 12);
  assert.equal(one.stockV, 300, 'TL stock (sheet) not agent sum');
  assert.equal(one.net, 0); assert.equal(one.required, 300);
  assert.equal(one.priority, 'Medium');
  assert.equal(tls.filter((t) => t.direct).length, 2, 'FF + GV direct groups');
  const gvTl = tls.find((t) => t.ch === 'gv' && !t.direct);
  assert.equal(gvTl.name, 'GV TL');
  assert.equal(gvTl.priority, '', 'GV TL priority is not present in the source report, so do not infer it from agents');
});

test('filters + sort + totals', () => {
  const all = rows();
  DP.state.ch = 'ff'; DP.state.type = 'managed'; DP.state.prio = 'all'; DP.state.need = 'all'; DP.state.tl = ''; DP.state.q = '';
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name).sort(), ['Ravi Kumar', 'Sita Devi']);
  DP.state.type = 'all'; DP.state.prio = 'Medium';
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name), ['Direct Dev']);
  DP.state.ch = 'all'; DP.state.prio = 'all'; DP.state.need = 'need';
  const need = DP.sortRows(all.filter((r) => DP.passes(r)), { key: 'net', dir: 'desc' });
  assert.deepEqual(need.map((r) => r.name).sort(), ['GV Ramesh', 'Ravi Kumar']);
  const t = DP.agg(need);
  assert.equal(t.net, 300); assert.equal(t.gross, 400);
  const byCover = DP.sortRows([...all, { ...all[0], name: 'Idle', cover: null }], { key: 'cover', dir: 'asc' });
  assert.equal(byCover[0].name, 'GV Ramesh'); assert.equal(byCover[byCover.length - 1].cover, null);
  DP.state.need = 'all'; DP.state.q = 'gv f';
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name), ['GV Free']);
  DP.state.q = '';
});

test('table html: sortable headers, clickable rows, formula columns', () => {
  const list = DP.sortRows(rows(), { key: 'net', dir: 'desc' });
  const html = DP.tableHtml(list, 'agents');
  for (const s of ['data-dp-sort="net"', 'data-dp-sort="cover"', 'data-dp-open="', 'WITH stock', 'W/O stock', 'Last month', 'This month', '÷ 28 din', 'rate × 25 din', 'data-dp-tl="ff|TL One"']) assert.ok(html.includes(s), s);
  assert.doesNotMatch(html, /NaN|undefined/);
  assert.match(DP.kpiHtml(DP.agg(list), 'agents'), /data-dp-kpi="net"/);
});
