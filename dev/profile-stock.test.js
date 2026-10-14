/* 📦 profileStock — stock health: required / out of stock / high / dead / excess, top-10 lists, stock-vs-need chart.
   Pure logic with stubbed agent rows. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.document = { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false, body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true }, addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
['config', 'util'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;

U.runRateDays = () => 10;                          // 10 days of data this month → rate = issued / 10
FF.config.features = Object.assign({}, FF.config.features, { suggestDays: 15 });
FF.masterProfile = { groupBinsFor: () => null };   // → VC4 / Commercial fallback rows
require(path.join(ROOT, 'profileStock.js'));
const PS = FF.profileStock;
const need = (cur) => Math.ceil((cur / 10) * 15);
const row = (name, id, stockVc4, stockComm, cur) => {
  const gross = need(cur), vc4 = stockVc4 + stockComm;
  return { name, id, mobile: '98', priority: 'High', status: '', isSelf: false, stockVc4, stockComm, stockTotal: vc4, cur,
    sugVc4: Math.max(0, gross - stockVc4), sugComm: 0, sugVc4Gross: gross, sugCommGross: 0 };
};
const agents = [
  row('High Stocker', 'A1', 100, 0, 10),     // rate 1/day → need 15 · stock 100 ≥ 30 → HIGH, excess 85
  row('Short Agent', 'B1', 5, 0, 30),        // rate 3/day → need 45 · short 40 → REQUIRED
  row('No Stock', 'C1', 0, 0, 20),           // issuing, zero stock → OUT OF STOCK + REQUIRED
  row('Idle Holder', 'D1', 50, 0, 0),        // stock but no issuance → DEAD
  row('Fine Agent', 'E1', 25, 0, 15)         // need 23 · stock 25 → BALANCED
];
const selfAgent = Object.assign(row('TL One', 'T1', 7, 0, 0), { isSelf: true });
const tl = () => ({ kind: 'ff-tl', ch: 'ff', channel: 'First Forward', name: 'TL One', id: 'T1', agents, selfAgent, stock: { vc4: 187, comm: 0, total: 187 },
  tlStock: { own: { total: 7 }, agents: { total: 180 } }, dispatch: { days: 15 }, totals: { curTotal: 75, curVc4: 75, curComm: 0 } });

test('buckets: required / out of stock / high / dead / balanced (TL own row stays out of the counts)', () => {
  const an = PS.analyze(tl());
  assert.equal(an.team.length, 5);
  assert.deepEqual(an.team.filter((a) => a.high).map((a) => a.name), ['High Stocker']);
  assert.deepEqual(an.team.filter((a) => a.required).map((a) => a.name).sort(), ['No Stock', 'Short Agent']);
  assert.deepEqual(an.team.filter((a) => a.oos).map((a) => a.name), ['No Stock']);
  assert.deepEqual(an.team.filter((a) => a.dead).map((a) => a.name), ['Idle Holder']);
  assert.deepEqual(an.team.filter((a) => a.balanced).map((a) => a.name), ['Fine Agent']);
  assert.equal(an.counts.required, 2); assert.equal(an.counts.high, 1); assert.equal(an.counts.dead, 1); assert.equal(an.counts.ok, 1);
  assert.equal(an.self.isSelf, true);
});

test('numbers: need = run-rate × days, required = need − stock, excess above need, cover days', () => {
  const an = PS.analyze(tl());
  const by = (n) => an.team.find((a) => a.name === n);
  assert.equal(by('High Stocker').need, 15); assert.equal(by('High Stocker').excess, 85); assert.equal(Math.round(by('High Stocker').cover), 100);
  assert.equal(by('Short Agent').req, 40); assert.equal(by('No Stock').req, 30);
  assert.equal(by('Idle Holder').excess, 50); assert.equal(by('Idle Holder').cover, null);
  assert.equal(an.sums.req, 70, 'tags needed after stock');
  assert.equal(an.sums.deadStock, 50);
  assert.equal(an.sums.total, 187);
  assert.equal(an.sums.own, 7);
  assert.ok(an.sums.cover > 0);
});

test('html: boxes, panel list, top-10 and the stock-vs-need chart render', () => {
  const pr = tl();
  const h = PS.html(pr);
  for (const t of ['Total stock', 'Stock required', 'Out of stock', 'High stock', 'Dead stock', 'Excess tags', 'Balanced', 'Team cover', 'Top 10 by stock health', 'Stock vs need', 'Agent-wise stock vs need', 'Class-wise']) assert.ok(h.includes(t), t);
  assert.equal((h.match(/data-ps-box=/g) || []).length, 7, 'seven clickable boxes (cover is a static box)');
  assert.ok(h.includes('ps-need'), 'need tick drawn');
  assert.ok(h.includes('data-ps-panel'));
});

test('agent profile: 4 boxes (status · stock · cover · required), no team list', () => {
  const agent = { kind: 'ff-agent', ch: 'ff', channel: 'First Forward', name: 'Short Agent', id: 'B1', priority: 'High', stock: { vc4: 5, comm: 0, total: 5 },
    totals: { curTotal: 30, curVc4: 30, curComm: 0 }, dispatch: { days: 15, sugVc4: 40, sugComm: 0, sugVc4Gross: 45, sugCommGross: 0 } };
  const h = PS.html(agent);
  assert.equal((h.match(/class="pi-box static/g) || []).length, 4);
  assert.ok(h.includes('Stock required') && h.includes('Required') && h.includes('Cover'));
  assert.ok(!h.includes('data-ps-box') && !h.includes('Top 10'));
  const direct = Object.assign({}, agent, { direct: true, tagRequired: false, priority: 'Low' });
  assert.ok(PS.html(direct).includes('No dispatch'), 'direct low-priority agents are not asked for tags');
});

test('TL without rows shows a note instead of fake zeros', () => {
  const h = PS.html({ kind: 'ff-tl', ch: 'ff', name: 'Empty TL', id: 'E', agents: [], dispatch: { days: 15 }, stock: {}, tlStock: {} });
  assert.match(h, /No agent rows for this TL yet/);
});
