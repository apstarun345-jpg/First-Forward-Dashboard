/* 📅 T-1 BASIS (v3.20) — FF ka REPORT kal ka data laata hai, isliye run-rate / suggested dispatch /
   growth % / month-end projection sab "jis din tak ka data aaya hai" (report day) par ginne chahiye.

   Covered: U.reportBasis · U.projectMonthEnd · U.dispatchCalc(elapsed) ·
            masterProfile TL growth % + T-1 projection · master search kundli snapshot. */
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
const ym = U.ymKey(new Date());
const prev = U.prevMonthKey(ym);

// REPORT tab ka "Performance In 7 Days" header — d7 = jis din tak ka data aaya.
const DAY = 9;                                     // e.g. 9 tareekh tak ka data
const labels = ['3/Sep', '4/Sep', '5/Sep', '6/Sep', '7/Sep', '8/Sep', `${DAY}/Sep`];
FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => agents, daysElapsed: () => DAY, dayLabels: () => labels } };

const perfAgent = (o) => ({ week: [1, 2, 3, 0, 0, 1, 2], curVc4: 0, curNvc4: 0, curTotal: 0, lastVc4: 0, lastNvc4: 0, lastTotal: 0, stockVc4: 0, stockNvc4: 0, stockTotal: 0, tlExcluded: false, agentStatus: 'Active', lastActive: 'Today', ...o });
const agents = [
  perfAgent({ name: 'Ravi Kumar', agentId: 'R101', tlName: 'TL One', tlId: 'T1', priority: 'High', stockVc4: 10, stockNvc4: 4, stockTotal: 14, curVc4: 90, curNvc4: 30, curTotal: 120, lastVc4: 60, lastNvc4: 20, lastTotal: 80, avgVc4: 6, avgNvc4: 2, growth: '▲ +15%', curProjected: 360, tlStockVc4: 50, tlStockNvc4: 20, tlStockTotal: 70, tlPriority: 'High', tlCurVc4: 400, tlCurNvc4: 150, tlCurTotal: 550, tlLastTotal: 500, tlGrowth: '▼ -4%', tlProjected: 600, tlStockAlert: '🟢 Stock OK' }),
  perfAgent({ name: 'Priya Sharma', agentId: '9876543210', tlName: 'TL One', tlId: 'T1', priority: 'Low', stockVc4: 40, stockNvc4: 16, stockTotal: 56, curVc4: 30, curTotal: 30, avgVc4: 2, growth: '▲ +3%', tlStockVc4: 50, tlStockNvc4: 20, tlStockTotal: 70, tlCurVc4: 400, tlCurNvc4: 150, tlCurTotal: 550, tlLastTotal: 500, tlGrowth: '▼ -4%' })
];
const data = {
  agentClass: [{ ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 90 }],
  agents: [{ ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', n: 120 }],
  stockAgents: [{ agentId: 'R101', agentName: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 10 }]
};
FF.store.need = async (k) => data[k] || []; FF.store.get = (k) => data[k];
FF.gv.need = async () => []; FF.gv.get = () => []; FF.gv.rows = () => []; FF.gv.enabled = () => false;
FF.auth = { can: () => true, settings: {} };
require(path.join(ROOT, 'masterProfile.js'));
const MP = FF.masterProfile;
const person = (kind, name, sub) => ({ kind, name, sub: sub || '', tlSet: new Set(), classMap: new Map(), bars: new Set() });

test('reportBasis: REPORT ke last day ko divisor banata hai + date/label deta hai', () => {
  const b = U.reportBasis({ force: true });
  assert.equal(b.days, DAY, 'divisor = report day (T-1)');
  assert.equal(b.fromReport, true, 'REPORT header se padha');
  assert.equal(b.day, DAY);
  assert.match(b.label, /^\d{4}-\d{2}-\d{2} \(/);
  assert.match(b.key, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(b.sheetLabel, `${DAY}/Sep`, 'sheet ka raw header bhi rakha (debug/label ke liye)');
});

test('reportBasis: aaj ka adhoora data kabhi count nahi hota (sheet aaj se aage na jaaye)', () => {
  const today = new Date().getDate();
  if (today <= DAY) return;                       // sheet pehle hi T-1 hai — cap ka koi case nahi
  FF.pages.performance.daysElapsed = () => today;  // sheet me aaj aa gaya
  const b = U.reportBasis({ force: true });
  assert.equal(b.day, U.runRateDays(), 'aaj se cap ho gaya');
  assert.equal(b.days, U.runRateDays());
  assert.equal(b.capped, true);
  FF.pages.performance.daysElapsed = () => DAY;
  assert.equal(U.reportBasis({ force: true }).days, DAY);
});

test('reportBasis: REPORT load nahi hua to site default (aaj − 1)', () => {
  const saved = FF.pages.performance;
  FF.pages.performance = { ensureLoaded: async () => {}, agents: () => agents, daysElapsed: () => null, dayLabels: () => [] };
  const b = U.reportBasis({ force: true });
  assert.equal(b.days, U.runRateDays());
  assert.equal(b.fromReport, false);
  FF.pages.performance = saved;
  assert.equal(U.reportBasis({ force: true }).days, DAY, 'wapas aane par real day');
});

test('projectMonthEnd: T-1 run-rate × is month ke din', () => {
  const days = U.daysInMonth(ym);
  assert.equal(U.projectMonthEnd(550, DAY, ym), Math.round((550 / DAY) * days));
  assert.equal(U.projectMonthEnd(0, DAY, ym), 0, '0 issue → 0 projection');
  assert.equal(U.projectMonthEnd(120, DAY, ym), Math.round((120 / DAY) * days));
});

test('dispatchCalc: explicit elapsed (T-1) se rate/required/net/gross', () => {
  const c = U.dispatchCalc({ cur: 120, last: 80, stock: 14, days: 15, elapsed: DAY });
  assert.equal(c.elapsed, DAY);
  assert.equal(c.rate, 120 / DAY);
  assert.equal(c.required, Math.ceil((120 / DAY) * 15));
  assert.equal(c.gross, c.required);
  assert.equal(c.net, Math.max(0, Math.ceil((120 / DAY) * 15 - 14)));
  assert.equal(c.cover, (14 / (120 / DAY)));
  // days=0 / invalid elapsed pe site default (aaj − 1) — purana behaviour safe rehta hai
  const d = U.dispatchCalc({ cur: 120, stock: 0 });
  assert.equal(d.elapsed, U.runRateDays());
});

test('TL profile: growth % REPORT se + month-end expected + basis', async () => {
  const pr = await MP.build(person('ff-tl', 'TL One'));
  assert.equal(pr.found, true);
  // 📈 sheet ka apna TL growth % (▼ -4%) — sign sahi parse hona chahiye
  assert.equal(pr.growthNum, -4, '▼ prefix se negative');
  assert.equal(pr.growth, '▼ -4%');
  assert.ok(pr.projT1, 'projT1 missing');
  assert.equal(pr.projT1.days, DAY, 'FF basis = kal tak ka din');
  assert.equal(pr.projT1.num, -4);
  // totals = 2 agents × (cur 120 + 30) = 300; projection = round(300 / DAY × monthDays)
  assert.equal(pr.totals.curTotal, 150);
  assert.equal(pr.projT1.total, U.projectMonthEnd(150, DAY, ym));
  // run-rate/dispatch bhi usi divisor par
  assert.equal(pr.calc.total.elapsed, DAY, 'dispatch calc bhi same basis par');
});

test('TL profile drawer HTML: growth %, till-date, expected section', async () => {
  const pr = await MP.build(person('ff-tl', 'TL One'));
  const h = MP.html(pr);
  assert.match(h, /Growth % &amp; month-end expected/);
  assert.match(h, /Expected month-end/);
  assert.match(h, /Data till/);
  assert.match(h, /Aage kitne din bache/);
  assert.match(h, /aaj ka data kal aata hai/, 'simple bhasha me basis');
  assert.match(h, /pct neg/, 'negative growth laal dikhna chahiye');
  assert.ok(!/undefined|NaN/.test(h), 'undefined/NaN nahi aana chahiye');
  assert.ok(!/T-1/.test(h), 'UI me "T-1" jaisa technical shabd nahi hona chahiye');
});

test('channelBasis: FF = kal tak ka data · GV = live aaj', () => {
  const ff = U.channelBasis('ff', { force: true });
  assert.equal(ff.live, false, 'FF live nahi');
  assert.equal(ff.days, Math.min(DAY, U.runRateDays()));
  const gv = U.channelBasis('gv', { force: true });
  assert.equal(gv.live, true, 'GV live hai');
  assert.equal(gv.days, new Date().getDate(), 'GV aaj ka din gin-ta hai');
  assert.equal(gv.back, 0);
  // GV profile bhi live basis use kare
  const gvP = MP.quick({ kind: 'gv-agent', name: 'Koi', sub: '' });
  assert.equal(gvP, null, 'GV data fixture me nahi hai — skip');
});

test('basisText: dono channels ke liye simple bhasha (technical shabd nahi)', () => {
  const ff = U.basisText('ff', U.channelBasis('ff', { force: true }));
  const gv = U.basisText('gv', U.channelBasis('gv', { force: true }));
  assert.match(ff, /Data till/);
  assert.match(ff, /aaj ka data kal aata hai/);
  assert.match(gv, /Live data/);
  assert.ok(!/T-1/.test(ff) && !/T-1/.test(gv), '"T-1" shabd na aaye');
});

test('agent profile: growth % + expected month-end + dispatch basis', async () => {
  const pr = await MP.build(person('ff-agent', 'Ravi Kumar', 'R101'));
  assert.equal(pr.growthNum, 15, '▲ +15% → 15');
  assert.equal(pr.projT1.days, DAY);
  assert.equal(pr.projT1.total, U.projectMonthEnd(120, DAY, ym));
  assert.equal(pr.calc.vc4.elapsed, DAY);
  // Sheet ka projected purane ("aaj") basis par hota hai — T-1 recompute alag number deta hai, dono dikhne chahiye.
  assert.equal(pr.projT1.sheet, 360, 'sheet ka projected as-is');
  assert.notEqual(pr.projT1.total, pr.projT1.sheet, 'T-1 projection sheet se alag hai');
  const h = MP.html(pr);
  assert.ok(h.includes('Expected month-end'), 'expected month-end section');
  assert.ok(!/T-1/.test(h), 'UI me "T-1" shabd nahi');
});

test('master search quick snapshot (kundli) me growth + projection aa jata hai', () => {
  const q = MP.quick(person('ff-tl', 'TL One'));
  assert.ok(q, 'quick snapshot nahi bana');
  assert.equal(q.growthNum, -4);
  assert.equal(q.projT1.days, DAY);
  assert.equal(q.projT1.num, -4);
  assert.ok(q.projT1.total > 0);
});

test('WhatsApp / CSV export me growth + basis + projection shamil', async () => {
  const pr = await MP.build(person('ff-tl', 'TL One'));
  const wa = MP.waText(pr);
  assert.match(wa, /Growth:/);
  assert.match(wa, /-4\.0%/);
  assert.match(wa, /expected month-end/);
  assert.ok(!/T-1/.test(wa), 'WhatsApp text me "T-1" nahi');
  const csv = MP.csvRows(pr);
  const flat = csv.map((r) => r.join('|')).join('\n');
  assert.match(flat, /Growth % \(REPORT\)/);
  assert.match(flat, /Data till \(run-rate basis\)/);
  assert.match(flat, /Expected month-end/);
});
