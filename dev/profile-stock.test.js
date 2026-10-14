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

test('class-wise chart: every class (VC4 · VC20 · VC5 …) with stock vs need and a verdict', () => {
  const pr = Object.assign(tl(), { classes: [
    { cls: 'VC4', cur: 20, last: 10, stock: 100 },     // rate 2/day → need 30 · stock 100 ≥ 60 → HIGH
    { cls: 'VC20', cur: 0, last: 0, stock: 50 },        // stock but no issuance → DEAD
    { cls: 'VC5', cur: 10, last: 5, stock: 5 },         // rate 1/day → need 15 · short 10 → REQUIRED
    { cls: 'VC9', cur: 0, last: 0, stock: 0 }           // nothing at all → not drawn
  ] });
  const an = PS.analyze(pr);
  assert.deepEqual(an.classChart.map((r) => r.label), ['VC4', 'VC20', 'VC5'], 'sorted by stock, empty classes dropped');
  assert.deepEqual(an.classChart.map((r) => r.verdict), ['high', 'dead', 'required']);
  assert.equal(an.classChart[0].need, 30); assert.equal(an.classChart[2].diff, -10);
  const h = PS.html(pr);
  assert.equal((h.match(/<svg class="ps-svg"/g) || []).length, 1, 'real SVG column chart');
  assert.equal((h.match(/class="ps-col"/g) || []).length, 3 + 3 + 2 - 1, 'stock / issued / need columns only where the value is non-zero');
  assert.equal((h.match(/class="ps-cls-row"/g) || []).length, 3, 'one table row per class');
  assert.equal((h.match(/class="ps-share"/g) || []).length, 1, 'stock share (donut when charts are loaded, bar otherwise)');
  assert.equal((h.match(/data-ps-cls=/g) || []).length, 4, 'sort by stock / issuance / most short / class order');
  assert.match(h, /data-ps-geom="42,/);
  const svg = PS._colsSvg(an.classChart);
  assert.ok(svg.svg.includes('VC4') && svg.svg.includes('VC20') && svg.svg.includes('VC5'));
  const tip = PS._tipHtml(an.classChart[2], 155, an);
  assert.match(tip, /VC5/); assert.match(tip, /Short 10/); assert.match(tip, /15 days/);
});

test('health bar + rebalance plan: spare tags are matched to short agents before fresh dispatch', () => {
  const an = PS.analyze(tl());
  assert.deepEqual(an.health, { required: 2, high: 1, dead: 1, ok: 1 });
  const r = an.reb;
  assert.equal(r.short, 70);
  assert.equal(r.covered, 70);
  assert.equal(r.remaining, 0);
  assert.equal(r.moves[0].from.name, 'High Stocker');
  assert.deepEqual(r.moves.map((m) => [m.to.name, m.qty]).sort(), [['No Stock', 30], ['Short Agent', 40]]);
  assert.ok(r.spare >= 144, 'spare = all tags above need (agents + TL own)');
  const h = PS.html(tl());
  assert.ok(h.includes('Rebalance plan') && h.includes('data-ps-reb-csv') && h.includes('ps-health'));
  const csv = PS.rebCsv(tl(), PS.analyze(tl()));
  assert.equal(csv.rows.length, r.moves.length + 2, 'moves + total + still-to-dispatch');
  assert.match(csv.name, /rebalance-plan/);
});

test('rebalance: nothing spare → fresh dispatch is shown, nobody short → nothing to rebalance', () => {
  const only = [row('Short A', 'S1', 0, 0, 30)];
  const noSpare = { kind: 'ff-tl', ch: 'ff', name: 'TL Two', id: 'T2', agents: only, dispatch: { days: 15 }, stock: { total: 0 }, tlStock: {}, totals: {} };
  const an = PS.analyze(noSpare);
  assert.equal(an.reb.covered, 0); assert.equal(an.reb.remaining, 45);
  assert.match(PS.html(noSpare), /have to be dispatched fresh/);
  const fine = { kind: 'ff-tl', ch: 'ff', name: 'TL Three', id: 'T3', agents: [row('Fine', 'F1', 25, 0, 15)], dispatch: { days: 15 }, stock: { total: 25 }, tlStock: {}, totals: {} };
  assert.match(PS.html(fine), /nothing to rebalance/);
});

test('total stock CSV: TL = TL own + every agent × class columns + TOTAL; agent = one row per class + TOTAL', () => {
  const withClasses = agents.map((a, i) => Object.assign({}, a, { classStock: { VC4: a.stockVc4, VC5: i === 0 ? 7 : 0 } }));
  const self = Object.assign({}, selfAgent, { classStock: { VC4: 7 } });
  const pr = Object.assign(tl(), { agents: withClasses, selfAgent: self });
  const c = PS.totalCsv(pr, PS.analyze(pr));
  assert.deepEqual(c.head.slice(0, 7), ['Agent', 'Agent ID', 'Role', 'Mobile', 'Priority', 'Stock VC4', 'Stock VC5']);
  assert.equal(c.rows.length, 5 + 1 + 1, 'TL own + 5 agents + TOTAL');
  assert.equal(c.rows[0][0], 'TL One'); assert.equal(c.rows[0][2], 'TL own');
  const total = c.rows[c.rows.length - 1];
  assert.equal(total[0], 'TOTAL');
  assert.equal(total[5], 7 + 100 + 5 + 0 + 50 + 25, 'VC4 column total');
  assert.equal(total[6], 7, 'VC5 column total');
  assert.match(c.name, /^tl-one-total-stock-\d{4}-\d{2}-\d{2}\.csv$/);

  const agent = { kind: 'ff-agent', ch: 'ff', name: 'Solo', id: 'S9', priority: 'High', stock: { vc4: 8, comm: 0, total: 8 }, totals: { curTotal: 10 },
    dispatch: { days: 15, sugVc4: 7, sugComm: 0, sugVc4Gross: 15, sugCommGross: 0 },
    classes: [{ cls: 'VC20', cur: 0, last: 2, stock: 3 }, { cls: 'VC4', cur: 10, last: 4, stock: 5 }] };
  const a = PS.totalCsv(agent, PS.analyze(agent));
  assert.deepEqual(a.rows.map((r) => r[2]), ['VC4', 'VC20', '2 classes'], 'classes in VC order, then the total row');
  assert.equal(a.rows[2][3], 8, 'TOTAL uses the profile stock total');
});
