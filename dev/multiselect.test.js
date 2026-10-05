/* 🔠 v3.18 — MULTIPLE SELECTION regression.
   Lock karta hai:
     • U.asValueSet — string / array / Set / 'all' / '' sab ek jaise normalise hote hain,
     • U.valueSetLabel — 1, 2 aur 3+ values ka readable label,
     • Dispatch Planner filters ab multi-select hain (FF + GV ek saath, High + Medium ek saath),
     • purane single-string state values abhi bhi kaam karte hain (back-compat),
     • chips me multiple selected pills par aria-pressed="true" aata hai,
     • row picks (✅) toggle/clear + selected rows ka CSV/summary source,
     • filters localStorage me save/load hote hain. */
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
  createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null, remove() {} }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
};
['config', 'util', 'model', 'gv', 'store', 'charts'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;
U.runRateDays = () => 28;
FF.config.features.suggestDays = 25;

// ---- U.asValueSet / U.valueSetLabel ---------------------------------------------------------------
test('asValueSet normalises string / array / Set / "all" / empty', () => {
  assert.deepEqual([...U.asValueSet('ff')], ['ff']);
  assert.deepEqual([...U.asValueSet('all')], [], '"all" means no restriction');
  assert.deepEqual([...U.asValueSet('')], []);
  assert.deepEqual([...U.asValueSet(null)], []);
  assert.deepEqual([...U.asValueSet(['ff', 'gv'])].sort(), ['ff', 'gv']);
  assert.deepEqual([...U.asValueSet(new Set(['High']))], ['High']);
  assert.deepEqual([...U.asValueSet(['all', 'High'])], ['High'], '"all" inside a list is dropped');
});

test('valueSetLabel reads well for 1, 2 and 3+ values', () => {
  const opts = [{ value: 'High', label: '🔴 High' }, { value: 'Medium', label: '🟠 Medium' }, { value: 'Low', label: '🟢 Low' }];
  assert.equal(U.valueSetLabel([], opts, 'All priorities'), 'All priorities');
  assert.equal(U.valueSetLabel(['High'], opts), '🔴 High');
  assert.equal(U.valueSetLabel(['High', 'Medium'], opts), '🔴 High + 🟠 Medium');
  assert.equal(U.valueSetLabel(['High', 'Medium', 'Low'], opts), '🔴 High +2');
});

// ---- mock data for the planner --------------------------------------------------------------------
const A = (o) => ({ week: [0, 0, 0, 0, 0, 0, 0], curVc4: 0, curNvc4: 0, curTotal: 0, lastVc4: 0, lastNvc4: 0, lastTotal: 0, stockVc4: 0, stockNvc4: 0, stockTotal: 0, tlExcluded: false, agentStatus: 'Active', ...o });
const ffAgents = [
  A({ name: 'Ravi Kumar', agentId: 'R1', tlName: 'TL One', tlId: 'T1', priority: 'High', curVc4: 280, curTotal: 280, lastVc4: 200, lastTotal: 200, stockVc4: 100, stockTotal: 100, tlStockVc4: 300, tlStockTotal: 300 }),
  A({ name: 'Sita Devi', agentId: 'R2', tlName: 'TL One', tlId: 'T1', priority: 'Low', curVc4: 56, curTotal: 56, lastVc4: 90, lastTotal: 90, stockVc4: 500, stockTotal: 500, tlStockVc4: 300, tlStockTotal: 300 }),
  A({ name: 'Direct Dev', agentId: 'D1', tlName: 'APS', agentPriority: 'Medium', priority: 'Medium', tlExcluded: true, curVc4: 84, curTotal: 84, stockVc4: 10, stockTotal: 10 })
];
const gvRows = [
  { agentId: 'G1', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'GV TL', priority: 'High', stockVc4: 0, stockComm: 0, stockTotal: 0, curVc4: 140, curComm: 28, curTotal: 168, lastVc4: 100, lastComm: 20, lastTotal: 120, agentStatus: 'Active' },
  { agentId: 'G2', agentName: 'GV Free', tlId: '', tlName: '', priority: 'Low', stockVc4: 5, stockComm: 0, stockTotal: 5, curVc4: 28, curTotal: 28, lastVc4: 0, lastTotal: 0 }
];
FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => ffAgents } };
FF.gv.enabled = () => true; FF.gv.need = async () => gvRows; FF.gv.get = (k) => (k === 'report' ? gvRows : []);
require(path.join(ROOT, 'directAgents.js'));
require(path.join(ROOT, 'dispatchPlanner.js'));
const DP = FF.dispatchPlanner;

const reset = () => {
  DP.state.ch = new Set(); DP.state.type = new Set(); DP.state.prio = new Set(); DP.state.need = new Set();
  DP.state.tl = []; DP.state.q = ''; DP.state.basis = 'total';
};
const rows = () => { reset(); return DP.collectAgents().map((r) => DP.withCalc(r, 'total')); };

// ---- multi-select filtering -----------------------------------------------------------------------
test('multiple channels can be selected at once (FF + GV)', () => {
  const all = rows();
  DP.state.ch = new Set(['ff']);
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name).sort(), ['Direct Dev', 'Ravi Kumar', 'Sita Devi']);
  DP.state.ch = new Set(['ff', 'gv']);
  assert.equal(all.filter((r) => DP.passes(r)).length, 5, 'dono channel ek saath');
  DP.state.ch = new Set();
  assert.equal(all.filter((r) => DP.passes(r)).length, 5, 'khaali set = All');
});

test('multiple priorities combine with OR, not AND', () => {
  const all = rows();
  DP.state.prio = new Set(['High']);
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name).sort(), ['GV Ramesh', 'Ravi Kumar']);
  DP.state.prio = new Set(['High', 'Medium']);
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name).sort(), ['Direct Dev', 'GV Ramesh', 'Ravi Kumar']);
  DP.state.prio = new Set(['High', 'Medium', 'Low']);
  assert.equal(all.filter((r) => DP.passes(r)).length, 5);
});

test('two dims combine with AND while values inside a dim are OR', () => {
  const all = rows();
  DP.state.ch = new Set(['gv']); DP.state.prio = new Set(['High', 'Low']);
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name).sort(), ['GV Free', 'GV Ramesh']);
  DP.state.prio = new Set(['High']);
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name), ['GV Ramesh']);
});

test('back-compat: old single string filter values still work', () => {
  const all = rows();
  DP.state.ch = 'ff'; DP.state.type = 'managed'; DP.state.prio = 'all'; DP.state.need = 'all'; DP.state.tl = '';
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name).sort(), ['Ravi Kumar', 'Sita Devi']);
});

test('multiple TLs can be selected at once', () => {
  const all = rows();
  DP.state.tl = ['TL One'];
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name).sort(), ['Ravi Kumar', 'Sita Devi']);
  DP.state.tl = ['TL One', 'GV TL'];
  assert.deepEqual(all.filter((r) => DP.passes(r)).map((r) => r.name).sort(), ['GV Ramesh', 'Ravi Kumar', 'Sita Devi']);
});

test('channelLabel + filterOptions describe the multi-selection', () => {
  reset();
  assert.equal(DP.channelLabel(), 'FF + GV');
  DP.state.ch = new Set(['ff']);
  assert.equal(DP.channelLabel(), 'First Forward');
  DP.state.ch = new Set(['ff', 'gv']);
  assert.equal(DP.channelLabel(), 'First Forward + GV Partner');
  const all = rows();
  reset();
  const prio = DP.filterOptions('prio', all);
  assert.deepEqual(prio.map((o) => o.value), ['High', 'Medium', 'Low', 'other']);
  assert.equal(prio.find((o) => o.value === 'High').count, 2);
  assert.deepEqual(DP.filterOptions('basis', all), [], 'single-select dims have no multi options');
});

test('chips html marks every selected pill as pressed', () => {
  const all = rows();
  reset();
  DP.state.prio = new Set(['High', 'Medium']);
  const html = DP.chipsHtml(all);
  assert.match(html, /data-dp-f="prio:High" aria-pressed="true"/);
  assert.match(html, /data-dp-f="prio:Medium" aria-pressed="true"/);
  assert.match(html, /data-dp-f="prio:Low" aria-pressed="false"/);
  assert.match(html, /data-dp-f="prio:all" aria-pressed="false"/);
  assert.match(html, /\+2 selected/, 'multi badge dikhna chahiye');
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('table rows carry a pick checkbox and the footer keeps its column count', () => {
  const list = DP.sortRows(rows(), { key: 'net', dir: 'desc' });
  const html = DP.tableHtml(list, 'agents');
  assert.match(html, /data-dp-pick-all/);
  assert.match(html, /data-dp-pick="a0"/);
  const headCells = (html.match(/<th[\s>]/g) || []).length;
  const footRow = (html.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0];
  // colspan="N" wale cell ko N columns maano, baaki har <td> ek.
  let footCount = 0;
  for (const m of footRow.matchAll(/<td(?:\s[^>]*)?>/g)) footCount += Number((m[0].match(/colspan="(\d+)"/) || [0, 1])[1]);
  assert.equal(headCells, 15, 'pick + # + 13 data columns including class-wise stock mix');
  assert.equal(footCount, headCells, 'footer ka span header ke columns se match kare');
  const bodyRow = (html.match(/<tbody>[\s\S]*?<\/tbody>/) || [''])[0].split('</tr>')[0];
  assert.equal((bodyRow.match(/<td[\s>]/g) || []).length, headCells, 'har body row me bhi utne hi cells');
});

test('row picks toggle and clear', () => {
  DP.clearPicks();
  assert.equal(DP.pickedCount, 0);
  assert.equal(DP.togglePick('a0'), true);
  assert.equal(DP.togglePick('a1'), true);
  assert.equal(DP.togglePick('a0'), false, 'dobara click par unselect');
  assert.equal(DP.pickedCount, 1);
  assert.ok(DP.picked.has('a1'));
  DP.clearPicks();
  assert.equal(DP.pickedCount, 0);
});

test('filters persist to localStorage and come back', () => {
  reset();
  DP.state.ch = new Set(['gv']); DP.state.prio = new Set(['High', 'Medium']); DP.state.tl = ['GV TL'];
  DP.state.view = 'tls'; DP.state.basis = 'vc4'; DP.state.q = 'ramesh';
  DP.saveState();
  reset();
  DP.state.view = 'agents';
  assert.equal(DP.pickedCount, 0);
  DP.loadState();
  assert.deepEqual([...DP.state.ch], ['gv']);
  assert.deepEqual([...DP.state.prio].sort(), ['High', 'Medium']);
  assert.deepEqual(DP.state.tl, ['GV TL']);
  assert.equal(DP.state.view, 'tls');
  assert.equal(DP.state.basis, 'vc4');
  assert.equal(DP.state.q, 'ramesh');
  ls.delete('ff-dispatch-planner-state');
});
