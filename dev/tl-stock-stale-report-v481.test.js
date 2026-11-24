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
const FF = globalThis.FF; const U = FF.util;
const A = [["41124287","585254508209149676","ARYAN FST",77,240,317],["41124525","585255659545579526","YOGESH NAGAR FST",4,0,4],["41152063","585658373127575276","RINKU FST",9,0,9],["41835845","590901069333155846","GAURAV APS",4,34,38],["41151292","585654054839930886","SONUKHAN FST",23,20,43],["42533131","596681796008061511","VISHAL FST",22,4,26]];
const agents = A.map(([agentId, id, name, v, c, t]) => ({ agentId, id, name, tlId: 'APN0ARYAN', tlName: 'ARYAN', stockVc4: v, stockNvc4: c, stockTotal: t, tlStockVc4: 90, tlStockNvc4: 347, tlStockTotal: 437, curVc4: 0, curNvc4: 0, curTotal: 0, lastVc4: 0, lastNvc4: 0, lastTotal: 0, tlExcluded: false, week: [0,0,0,0,0,0,0] }));
const stockAgents = [];
const add = (id, name, cls, n) => stockAgents.push({ agentId: id, agentName: name, tlName: 'ARYAN', cls, group: cls === 'VC4' ? 'VC4' : 'VC5+', n });
add('585254508209149676','ARYAN FST','VC12',52); add('585254508209149676','ARYAN FST','VC16',9); add('585254508209149676','ARYAN FST','VC4',77); add('585254508209149676','ARYAN FST','VC5',55); add('585254508209149676','ARYAN FST','VC6',91); add('585254508209149676','ARYAN FST','VC7',140);
add('585255659545579526','YOGESH NAGAR FST','VC4',4); add('585658373127575276','RINKU FST','VC4',9);
add('590901069333155846','GAURAV APS','VC4',4); add('590901069333155846','GAURAV APS','VC6',6); add('590901069333155846','GAURAV APS','VC7',18); add('590901069333155846','GAURAV APS','VC5',10);
add('585654054839930886','SONUKHAN FST','VC4',23); add('585654054839930886','SONUKHAN FST','VC12',2); add('585654054839930886','SONUKHAN FST','VC16',6); add('585654054839930886','SONUKHAN FST','VC5',12);
add('596681796008061511','VISHAL FST','VC4',22); add('596681796008061511','VISHAL FST','VC5',4);
const data = { agentClass: [], agents: [], stockAgents, daily: [] };
FF.store.need = async (k) => data[k] || []; FF.store.get = (k) => data[k];
FF.gv.need = async () => []; FF.gv.get = () => []; FF.gv.rows = () => [];
FF.auth = { can: () => true, settings: {} };
FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => agents, daysElapsed: () => 15, dayLabels: () => ['a','b','c','d','e','f','g'] } };
require(path.join(ROOT, 'masterProfile.js'));
const pr = FF.masterProfile.buildNow({ kind: 'ff-tl', name: 'ARYAN', sub: '', tlSet: new Set(), classMap: new Map(), bars: new Set() });
test('FF TL stock classes come from StockDataa even when REPORT stock is stale (no fake Other/Commercial)', () => {
  const cls = Object.fromEntries(pr.classes.map((c) => [c.cls, c.stock]));
  assert.equal(pr.stock.total, 544);
  assert.deepEqual([cls.VC4, cls.VC5, cls.VC6, cls.VC7, cls.VC12, cls.VC16], [139, 81, 97, 158, 54, 15]);
  assert.equal(cls.COMMERCIAL || 0, 0);
});
