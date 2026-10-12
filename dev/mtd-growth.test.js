/* 📈 Growth = is mahine 1..kal vs pichhle mahine ke SAME din (1..kal). Rows na milen to REPORT ka % (-100% bug) nahi,
   run-rate/day vs pichhle mahine avg/day. ID ".0" suffix se rows miss nahi honi chahiye. */
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
['config', 'util', 'model', 'store', 'charts', 'gv'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;
FF.auth = { can: () => true, settings: {} };
require(path.join(ROOT, 'masterProfile.js'));
const MP = FF.masterProfile;

const now = new Date();
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
const ym = U.ymKey(yesterday), prev = U.prevMonthKey(ym), day = yesterday.getDate();
const dayOf = (k, d) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const row = (k, d, n, agentId = '8142005') => { const date = dayOf(k, d); return { channel: 'First Forward', d: date, date, key: U.dateKey(date), ym: k, day: d, cls: 'VC4', group: 'VC4', type: 'ISSUANCE', vrnType: 'VRN', agentId, agentName: 'Test Agent', tlId: 'T1', tlName: 'TL AMAN', n }; };
const withDaily = (rows) => { FF.store.get = (k) => (k === 'daily' ? rows : []); };
const agent = { kind: 'ff-agent', name: 'Test Agent', id: '8142005.0' };   // sheet ID ".0" ke saath

test('MTD growth: 1..kal vs pichhle mahine ke 1..kal, ID ".0" suffix ke bawajood rows milti hain', () => {
  // prev month: din 1..kal = 40, uske baad (din > kal) 192 aur — poora mahina 232 (isse growth kabhi nahi nikalni)
  // is mahine 1..kal = 105 → +162.5%
  const rows = [row(prev, 1, 40), row(prev, Math.min(28, day + 1), 192), row(ym, 1, 105)];
  withDaily(rows);
  const c = MP._comparableMtdGrowth(agent, 'ff');
  assert.equal(c.current, 105);
  assert.equal(c.last, day >= 28 ? 232 : 40, 'sirf same-din tak ka last month');
  if (day < 28) assert.ok(Math.abs(c.growth - 162.5) < 0.01, 'growth ' + c.growth);
});

test('rows na milen to REPORT sheet ka -100% nahi — run-rate vs pichhle mahine avg/day', () => {
  withDaily([]);
  const o = { kind: 'ff-agent', name: 'Nobody', id: 'X1', growth: '▼ -100%' };
  const t = { curTotal: 105, lastTotal: 232 };
  const g = MP._growthBlock(o, t, ym, 'ff');
  assert.notEqual(Math.round(g.num), -100, 'sheet -100% use nahi hona chahiye');
  assert.equal(g.basis.growthSource, 'runrate');
  const el = g.basis.growthElapsed, pd = U.daysInMonth(prev);
  const want = ((105 / el) / (232 / pd) - 1) * 100;
  assert.ok(Math.abs(g.num - want) < 0.01, `${g.num} vs ${want}`);
});

test('pichhle mahine ka data hi 0 ho to growth null (jhooth nahi)', () => {
  withDaily([]);
  const g = MP._growthBlock({ kind: 'ff-agent', name: 'New', id: 'N1' }, { curTotal: 10, lastTotal: 0 }, ym, 'ff');
  assert.equal(g.num, null);
});
