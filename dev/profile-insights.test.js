/* 📈 profileInsights — team-health buckets (active / inactive this month / 2 months / 2+ months), de-growth,
   high growth, top-10 per class and the day-wise series. Pure logic with stubbed issuance rows. */
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
U.runRateDays = () => 10;   // 10 days of data this month
const now = new Date();
const cur = U.ymKey(now), last = U.prevMonthKey(cur), p2 = U.prevMonthKey(last), p3 = U.prevMonthKey(p2);
const d = (ym, day) => `${ym}-${String(day).padStart(2, '0')}`;
const row = (ym, day, who, group, n = 1) => ({ key: d(ym, day), ym, agentId: who.id, agentName: who.name, group, n });
const A = { id: 'A1', name: 'Active Grower' }, B = { id: 'B1', name: 'Active Slower' }, C = { id: 'C1', name: 'Quit Last Month' };
const D = { id: 'D1', name: 'Quit Two Months' }, E = { id: 'E1', name: 'Gone Long' }, F = { id: 'F1', name: 'Never Issued' };
const rows = [
  row(cur, 1, A, 'VC4', 10), row(cur, 2, A, 'VC20', 5), row(cur, 3, A, 'VC5+', 5), row(last, 2, A, 'VC4', 8),       // 20 vs 8 same days → +150%
  row(cur, 2, B, 'VC4', 3), row(last, 3, B, 'VC4', 10),                                                              // 3 vs 10 → −70%
  row(last, 5, C, 'VC4', 4), row(p2, 5, C, 'VC4', 4),
  row(p2, 6, D, 'VC20', 2),
  row(p3, 6, E, 'VC5+', 2)
];
FF.masterProfile = { insightRows: () => rows };
FF.store = { get: (k) => (k === 'daily' ? [1] : []) };
require(path.join(ROOT, 'profileInsights.js'));
const PI = FF.profileInsights;
const roster = [A, B, C, D, E, F].map((x) => ({ name: x.name, id: x.id, mobile: '98', status: '', priority: '' }));
const pr = () => ({ kind: 'ff-tl', ch: 'ff', channel: 'First Forward', name: 'TL One', id: 'T1', agents: roster, selfAgent: null });

test('buckets: active / inactive this month / 2 months / 2+ months', () => {
  const an = PI.analyze(pr());
  assert.equal(an.counts.all, 6);
  assert.equal(an.counts.active, 2);
  assert.equal(an.counts.inactive, 4);
  assert.equal(an.counts.in0, 1);   // C: issued last month, nothing this month
  assert.equal(an.counts.in2, 1);   // D: last issued 2 months ago
  assert.equal(an.counts.in3, 2);   // E (3 months ago) + F (never)
});

test('growth compares the same days of last month; de-growth and high growth boxes', () => {
  const an = PI.analyze(pr());
  const byName = Object.fromEntries(an.team.map((a) => [a.name, a]));
  const cut = Math.min(10, U.daysInMonth(last));
  assert.equal(an.cutDay, cut);
  assert.ok(byName['Active Grower'].growth > 100);
  assert.ok(byName['Active Slower'].growth < 0);
  assert.equal(an.counts.high, 1);
  assert.equal(an.counts.degrowth, 1);
});

test('day-wise series, class split and run-rate', () => {
  const an = PI.analyze(pr());
  const day1 = an.days[0], day2 = an.days[1];
  assert.equal(day1.VC4, 10); assert.equal(day1.t, 10);
  assert.equal(day2.VC20, 5); assert.equal(day2.VC4, 3);
  assert.equal(an.monthTot.cur.t, 23);
  assert.ok(Math.abs(an.rate.t - 2.3) < 1e-9);
  assert.ok(Math.abs(an.rate.VC4 - 1.3) < 1e-9);
  assert.ok(Math.abs(an.days[1].rate.t - (10 + 8) / 2) < 1e-9);   // cumulative run-rate till day 2
});

test('html: boxes, top-10 and chart render; tooltip lists class split', () => {
  const h = PI.html(pr());
  for (const t of ['Total agents', 'Inactive 2+ months', 'High growth', 'Top 10 agents by class', 'pi-svg', 'Day-wise issuance']) assert.ok(h.includes(t), t);
  const an = PI.analyze(pr());
  const tip = PI._tipHtml(an, an.days[0]);
  assert.match(tip, /VC4/); assert.match(tip, /VC20/); assert.match(tip, /VC5\+/); assert.match(tip, /\/day/);
});

test('agent profile shows activity boxes and no team list', () => {
  const agent = { kind: 'ff-agent', ch: 'ff', channel: 'First Forward', name: A.name, id: A.id, tl: { name: 'TL One' } };
  FF.masterProfile = { insightRows: () => rows.filter((r) => r.agentId === 'A1') };
  const h = PI.html(agent);
  assert.ok(h.includes('Activity &amp; run-rate'));
  assert.ok(!h.includes('data-pi-box'));
  assert.ok(h.includes('Active this month'));
  // Issued / last month / growth live in the KPI cards of the same view → only status · active days · best day are boxed here
  assert.equal((h.match(/class="pi-box static/g) || []).length, 3);
  for (const t of ['Status', 'Active days', 'Best day']) assert.ok(h.includes(t), t);
  assert.ok(!/<small>Last month/.test(h) && !/<small>Growth</.test(h) && !/<small>Run-rate</.test(h), 'no repeated KPI boxes');
  FF.masterProfile = { insightRows: () => rows };
});

test('chart card carries a collapsed day-wise table (replaces the old trend card) with CSV', () => {
  const h = PI.html(pr());
  assert.match(h, /<details class="pi-days"><summary>[^<]*Day-wise table/);
  assert.match(h, /data-pi-days-csv/);
  const an = PI.analyze(pr());
  const body = h.slice(h.indexOf('pi-days-tbl'));
  assert.ok(body.includes('row-total'), 'total row');
  assert.equal((body.match(/<tr/g) || []).length, an.days.filter((x) => x.day <= an.elapsed || x.t > 0).length + 2, 'one row per day + header + total');
});

test('shows a loading note instead of fake zeros while issuance rows are missing', () => {
  FF.masterProfile = { insightRows: () => [] };
  FF.store = { get: () => [] };
  const h = PI.html({ ...pr(), name: 'Other TL' });
  assert.match(h, /still loading/);
  assert.ok(!h.includes('data-pi-box'));
});
