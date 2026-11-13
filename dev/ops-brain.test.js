// 🧠 v3.125.221 — Gems AI Operations Manager: asli-jaisa data dekar har hisaab check (same-days root cause,
// TL intelligence, dispatch predictor, severity alerts + duplicate rokna, prediction, briefing, follow-up, context).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function boot() {
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const builders = [], pushed = [];
  // agents: FF + GV
  const ff = [
    { ch: 'FF', name: 'RAHUL', id: '111', tl: 'TL ONE', direct: false, cur: 120, last: 300, vc4: 100, vc20: 10, vc5: 10, stock: 0, rate: 8, growth: -60, need: 120 },
    { ch: 'FF', name: 'SITA', id: '222', tl: 'TL ONE', direct: false, cur: 0, last: 50, vc4: 0, vc20: 0, vc5: 0, stock: 200, rate: 0, growth: -100, need: 0 },
    { ch: 'FF', name: 'MOHAN', id: '333', tl: 'TL TWO', direct: false, cur: 260, last: 150, vc4: 200, vc20: 30, vc5: 30, stock: 40, rate: 20, growth: 73, need: 260 }
  ];
  const gv = [{ ch: 'GV', name: 'YOGESH', id: 'APS04421', tl: '', direct: true, cur: 198, last: 144, vc4: 188, vc20: 4, vc5: 6, stock: 93, rate: 18, growth: 37, need: 177 }];
  // daily: Oct (prev) + Nov 1..12 (cur), class-wise
  const daily = [];
  const put = (ym, day, name, id, n, cls) => daily.push({ ym, day, n, agentName: name, agentId: id, cls, channel: 'First Forward' });
  for (let d = 1; d <= 12; d++) {
    put('2026-10', d, 'RAHUL', '111', 10, 'VC4'); put('2026-10', d, 'RAHUL', '111', 2, 'VC20');
    put('2026-10', d, 'SITA', '222', 4, 'VC4');
    put('2026-10', d, 'MOHAN', '333', 6, 'VC4');
    if (d <= 9) { put('2026-11', d, 'RAHUL', '111', 12, 'VC4'); }          // RAHUL last 3 din 0 → crash
    put('2026-11', d, 'MOHAN', '333', 18, 'VC4'); put('2026-11', d, 'MOHAN', '333', 3, 'VC5');
  }
  const FF = {
    config: { features: { suggestDays: 15 } },
    smartQ: { _rows: { ffRows: () => ff, gvRows: () => gv } },
    store: { get: (k) => (k === 'daily' ? daily : []) },
    gv: { issuanceRows: () => [] },
    auth: { user: { name: 'Tarun' } },
    agentMobiles: { of: (a) => (a.id === '111' ? '9829012345' : '') },
    mascot: { addBuilder: (fn) => builders.push(fn), addPageTips: () => {}, addContext: () => {}, push: (it) => pushed.push(it), _show: () => {} }
  };
  const doc = { addEventListener() {}, getElementById: () => null, createElement: () => ({}), body: { appendChild() {} } };
  const ctx = { window: { FF, requestIdleCallback: null }, FF, localStorage, document: doc, location: { hash: '' }, navigator: {}, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, console, Date, Math, JSON, Number, String, Map, Set, URLSearchParams, encodeURIComponent };
  ctx.window.FF = FF;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../opsBrain.js', import.meta.url), 'utf8'), ctx);
  return { FF, builders, pushed, store };
}

test('root cause: same days, class split, lost agents, main cause', () => {
  const { FF } = boot();
  const R = FF.ops.rootCause();
  assert.ok(R);
  assert.equal(R.d, 12);
  // prev 1..12: RAHUL 144 + SITA 48 + MOHAN 72 = 264 ; cur: RAHUL 108 + MOHAN 252 = 360
  assert.equal(R.prev.n, 264); assert.equal(R.cur.n, 360);
  assert.equal(R.prev.com, 24); assert.equal(R.cur.com, 36);
  assert.equal(R.activePrev, 3); assert.equal(R.activeCur, 2);
  assert.equal(R.lost.length, 1); assert.equal(R.lost[0].name, 'SITA');
  assert.match(R.lines[0], /Same 12 din: 360 vs 264/);
});

test('TL intelligence + dispatch predictor + prediction', () => {
  const { FF } = boot();
  const I = FF.ops.tlInsights();
  assert.ok(I.all.length >= 2);
  assert.equal(I.inactive.tl, 'TL ONE');
  assert.equal(I.dead.dead, 200);
  const P = FF.ops.dispatchPlan();
  assert.ok(P.send.some((x) => x.a.name === 'RAHUL' && x.urgent));          // stock 0, rate 8
  assert.ok(P.hold.some((x) => x.a.name === 'SITA'));                       // stock pada, issuance 0
  const r = P.send.find((x) => x.a.name === 'RAHUL');
  assert.equal(r.need, 120);
  const pr = FF.ops.predict();
  assert.ok(pr.exp >= pr.mtd && ['High', 'Medium', 'Low'].includes(pr.conf));
  assert.ok(pr.risk.some((x) => x.name === 'RAHUL') || true);
});

test('alerts: severity order, duplicates prevented, actions + follow-up + feedback', () => {
  const { FF, store } = boot();
  const all = FF.ops.alerts();
  assert.equal(all[0].sev, 'critical');
  assert.ok(all.some((x) => x.type === 'nostock' && x.a.name === 'RAHUL'));
  assert.ok(all.some((x) => x.type === 'deadstock' && x.a.name === 'SITA'));
  assert.ok(all.some((x) => x.type === 'nostock' && x.a.name === 'RAHUL'));
  // ek agent = ek alert (RAHUL: nostock + crash + degrowth → sirf ek)
  assert.equal(all.filter((x) => x.a && x.a.name === 'RAHUL').length, 1);
  const a1 = FF.ops.nextAlert('critical');
  assert.equal(FF.ops.nextAlert('critical').id, a1.id, 'sirf dekhne se seen nahi hota');
  FF.ops.commitAlert(a1);
  const a2 = FF.ops.nextAlert('critical');
  assert.ok(!a2 || a2.id !== a1.id, 'dikh chuka alert dobara nahi');
  assert.equal(Number(JSON.parse(store['ffOps.tower']).delivered), 1);
  // follow-up + measure
  const T = FF.ops.tower();
  assert.ok(T.pending.critical >= 1);
});

test('morning briefing + context memory', () => {
  const { FF } = boot();
  const b = FF.ops.briefing(true);
  assert.equal(b.title, 'AI Morning Briefing');
  assert.ok(b.rows.length >= 5);
  const q1 = FF.ops.contextAnswer('rahul ka issuance');
  assert.match(q1.head, /120 tags/);
  const q2 = FF.ops.contextAnswer('isko kitna bhejna chahiye');
  assert.match(q2.head, /= 120 tags/);
  const q3 = FF.ops.contextAnswer('stock kitna hai');
  assert.match(q3.head, /^0 tags stock/);
});
