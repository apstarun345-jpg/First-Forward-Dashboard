/* 🔄 v3.39 — Summary / Master Search / drawers par stock "hamesha loading" nahi:
   • U.within / U.breathe (hard deadline + UI ko saans),
   • FF.stockAge: server `pending` par poll, `compute(scope, { waitMs })` kabhi latakta nahi,
   • Agent / TL Summary: ageing report ka rasta nahi rokti (`age: false`) aur ageing na aaye to saaf state + Retry,
   • KPI stock drawer: ek slow dataset poore drawer ko nahi rokta (notice + Retry),
   • Master Search: slow dataset ke bina bhi index/dropdown chalta hai, dataset aate hi judta hai,
   • Master profile (kundli / drawer): deadline par partial profile, baaki data aate hi onLate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { hash: '#/masterSearch', href: '' };
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false,
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true },
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
};
['config', 'util', 'model', 'store', 'charts', 'gv', 'stockAge', 'kpiDetail', 'masterProfile', 'masterSearch'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;
U.runRateDays = () => 15;
FF.auth = { api: async () => ({}), can: () => true, settings: {}, isAdmin: () => true, user: { username: 'u', name: 'U' } };
const SA = FF.stockAge;
const never = () => new Promise(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realSetTimeout = globalThis.setTimeout;
/** poll-sleep (1–8 s) ko chhota karo taaki test tez rahe — chhote waits (U.within deadlines) jaise the waise. */
const fastPolls = (on) => { globalThis.setTimeout = on ? (fn, ms, ...a) => realSetTimeout(fn, ms >= 500 ? 2 : ms, ...a) : realSetTimeout; };

// ---------------------------------------------------------------------------------------------------------
test('U.within: value, deadline, reject — kabhi latakta / throw nahi karta', async () => {
  assert.equal(await U.within(never(), 25, 'late'), 'late', 'deadline par fallback');
  assert.equal(await U.within(Promise.resolve('ok'), 200, 'late'), 'ok', 'time par value');
  assert.equal(await U.within(Promise.reject(new Error('boom')), 200, 'late'), 'late', 'reject par bhi fallback (throw nahi)');
  assert.equal(await U.within((async () => { await sleep(10); return 7; })(), 300, 0), 7);
  assert.equal(await U.within(5, 25, 0), 5, 'non-promise value pass-through');
  const slow = (async () => { await sleep(60); return 'slow'; })();
  assert.equal(await U.within(slow, 10, null), null);
  assert.equal(await slow, 'slow', 'underlying kaam peeche chalta rehta hai');
  let order = '';
  const keepAlive = setTimeout(() => {}, 2000);   // breathe ka MessageChannel port unref hai (Node me process ko rokta nahi) — test ko zinda rakho
  const a = U.breathe().then(() => { order += 'a'; }), b = U.breathe().then(() => { order += 'b'; });
  await Promise.all([a, b]);
  clearTimeout(keepAlive);
  assert.equal(order, 'ab', 'breathe resolve hota hai (FIFO)');
});

// ---------------------------------------------------------------------------------------------------------
const AGE_SUMMARY = (ffTotal = 3) => ({
  ok: true, at: new Date().toISOString(), today: '2026-10-01', thresholds: [30, 90, 150, 180], months: [1, 3, 5, 6],
  ff: { total: ffTotal, unknown: 0, rows: ffTotal, matched: 0, own: 0, all: { n: 'First Forward', id: '', tl: '', t: [ffTotal, 0], u: [0, 0], c: [[0, 0, 0, 0], [0, 0, 0, 0]], o: [0, 0], a: [0, 0] }, field: null, parked: null, agents: {}, tls: {} },
  gv: { total: 2, unknown: 0, rows: 2, matched: 0, own: 0, all: { n: 'GV', id: '', tl: '', t: [2, 0], u: [0, 0], c: [[0, 0, 0, 0], [0, 0, 0, 0]], o: [0, 0], a: [0, 0] }, field: null, parked: null, agents: {}, tls: {} }
});

test('stockAge.compute(waitMs): index kabhi na aaye to bhi null (spinner nahi)', async () => {
  FF.auth.api = () => never();
  const t0 = Date.now();
  const res = await SA.compute({ kind: 'agent', key: 'Ravi Kumar', ch: 'ff' }, { waitMs: 40 });
  assert.equal(res, null, 'null → caller "ban rahi hai / Retry" dikhata hai');
  assert.ok(Date.now() - t0 < 1500, 'deadline ke aas-paas laut aaya');
  assert.equal(SA.status().ready, false);
  assert.equal(SA.status().loading, true, 'status batata hai ki load chal raha hai');
});

test('stockAge.ready: server `pending` de to poll karta hai (fresh=1 sirf pehli koshish), ready hote hi index', async () => {
  const urls = [], building = [];
  let hits = 0;
  FF.auth.api = async (u) => {
    urls.push(u);
    if (u.startsWith('/api/stock-age?') || u === '/api/stock-age') {
      hits++;
      building.push(SA.status().building);
      return hits < 3 ? { ok: true, pending: true, retryAfterMs: 1 } : AGE_SUMMARY(3);
    }
    return { ok: true, rows: [], total: 0 };
  };
  fastPolls(true);
  let idx;
  try { idx = await SA.ready(true); } finally { fastPolls(false); }
  assert.equal(hits, 3, 'do pending + ek summary');
  assert.deepEqual(urls.slice(0, 3), ['/api/stock-age?fresh=1', '/api/stock-age', '/api/stock-age'], 'force → fresh sirf pehli request par');
  assert.deepEqual(building, [false, true, true], 'pending milte hi status().building = true');
  assert.ok(idx && idx.total === 5, 'FF 3 + GV 2');
  const st = SA.status();
  assert.equal(st.ready, true); assert.equal(st.building, false); assert.equal(st.loading, false);
});

test('stockAge.compute(waitMs): tags endpoint latke ya pending de to null; theek ho to buckets', async () => {
  // index ready hai (upar ka test) — ab sirf tags call
  FF.auth.api = async (u) => (u.startsWith('/api/stock-age/tags') ? never() : AGE_SUMMARY());
  fastPolls(true);
  try {
    assert.equal(await SA.compute({ kind: 'agent', key: 'Ravi Kumar', ch: 'ff' }, { waitMs: 30 }), null, 'tags hang → null');
    FF.auth.api = async () => ({ ok: true, pending: true, rows: [] });
    assert.equal(await SA.compute({ kind: 'agent', key: 'Ravi Kumar', ch: 'ff' }, { waitMs: 30 }), null, 'tags pending → null');
  } finally { fastPolls(false); }
  FF.auth.api = async () => ({ ok: true, total: 3, rows: [{ cls: 'VC4', age: 10, tagId: 'a' }, { cls: 'VC4', age: 45, tagId: 'b' }, { cls: 'VC20', age: 200, tagId: 'c' }] });
  const res = await SA.compute({ kind: 'agent', key: 'Ravi Kumar', ch: 'ff' }, { waitMs: 500 });
  const age = res && (res.ff || res.gv);
  assert.ok(age, 'ageing mili');
  assert.equal(age.total, 3); assert.equal(age.old30, 2, '45 aur 200 din');
  assert.equal(await SA.compute({ kind: 'field', ch: 'ff' }, { waitMs: 30 }), null, 'sirf agent / tl scope');
});

// ---------------------------------------------------------------------------------------------------------
// agentSummary.js — vm sandbox (jaise baaki summary tests)
const utilStub = {
  clean: (v) => String(v == null ? '' : v).trim(), esc: (v) => String(v == null ? '' : v), fmt: (v) => String(v == null ? 0 : v),
  sum: (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0), growth: (c, p) => (p ? ((c - p) / p) * 100 : null),
  pctHtml: () => '—', pad2: (n) => String(n).padStart(2, '0'), slug: (s) => String(s || ''), stamp: () => 'x',
  spinner: () => '…', $: () => null, downloadCsv() {}, downloadBlob() {}, copyText: async () => {}, waLink: () => ''
};
const mockProfile = {
  channel: 'First Forward', kind: 'ff-agent', name: 'José Alvarez', id: 'FF-ID_1045', priority: 'High', mobile: '9876543210',
  totals: { curTotal: 10, curVc4: 4, curComm: 6, lastTotal: 5, lastVc4: 2, lastComm: 3, growth: 100 },
  stock: { vc4: 1, comm: 2, total: 3 }, months: { cur: '2026-10', last: '2026-09' },
  classes: [{ cls: 'VC4', last: 2, cur: 4, stock: 1 }, { cls: 'Comm', last: 3, cur: 6, stock: 2 }],
  agents: [], calc: { total: { rate: 2 } }, projT1: { total: 20 }
};
function loadSummary(stockAge) {
  const ff = { util: utilStub, pages: {}, config: {}, ...(stockAge ? { stockAge } : {}) };
  const sandbox = {
    window: { FF: ff }, FF: ff, console, Blob, atob, Uint8Array, setTimeout, clearTimeout, TextEncoder, TextDecoder,
    document: { createElement: () => ({}), body: { appendChild() {} } }, navigator: {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'agentSummary.js'), 'utf8'), sandbox, { filename: 'agentSummary.js' });
  ff.masterProfile = { build: async () => mockProfile, csvRows: () => [] };
  return ff;
}
const PERSON = { kind: 'ff-agent', name: 'José Alvarez', id: 'FF-ID_1045', tl: '' };
const AGE = { total: 3, old30: 2, old60: 1, buckets: [{ key: 'b1', label: '0–30d', n: 1 }, { key: 'b30', label: '30+d', n: 1 }, { key: 'b90', label: '90+d', n: 1 }, { key: 'b150', label: '150+d', n: 0 }, { key: 'b180', label: '180+d', n: 0 }], byClass: [{ cls: 'VC4', b1: 1, b30: 1, b90: 1, b150: 0, b180: 0, total: 3, old30: 2, old60: 1 }] };

test('Summary: age:false → report turant (ageing ka intezaar nahi), compute bulaya hi nahi jaata', async () => {
  let called = 0;
  const ff = loadSummary({ compute: () => { called++; return never(); }, status: () => ({ building: false, error: '' }) });
  const rep = await Promise.race([ff.agentSummary.buildReport(PERSON, { age: false }), sleep(1500).then(() => 'HUNG')]);
  assert.notEqual(rep, 'HUNG', 'buildReport ageing par nahi atka');
  assert.equal(called, 0);
  assert.equal(rep.ageState, 'idle'); assert.equal(rep.age, null);
  assert.equal(rep.p.stock.total, 3, 'stock in hand report me hai');
  const html = ff.agentSummary.reportHtml(rep);
  assert.ok(!/koi pending stock ageing nahi/.test(html), 'ageing aayi nahi to "koi ageing nahi 🎉" jhooth nahi dikhate');
});

test('Summary: default buildReport (exports / Team Pack) ageing ka intezaar karta hai par bounded; waitMs pass hota hai', async () => {
  const seen = [];
  const ff = loadSummary({ compute: async (scope, opts) => { seen.push({ scope, opts }); return { ff: AGE }; }, status: () => ({ building: false, error: '' }) });
  const rep = await ff.agentSummary.buildReport(PERSON);
  assert.equal(rep.ageState, 'ready'); assert.equal(rep.age.total, 3);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].scope.kind, 'agent'); assert.equal(seen[0].scope.key, 'FF-ID_1045');
  assert.equal(seen[0].opts.waitMs, 60000, 'default hard limit 60 s — infinite nahi');
  await ff.agentSummary.buildReport(PERSON, { ageWaitMs: 77 });
  assert.equal(seen[1].opts.waitMs, 77);
  assert.ok(/Stock Ageing · 3 tags/.test(ff.agentSummary.reportHtml(rep)));
});

test('Summary: ageing na aaye to state saaf — building / failed / unavailable, Retry ke saath; sach me khaali ho to hi 🎉', async () => {
  const mk = async (stockAge) => { const ff = loadSummary(stockAge); const rep = await ff.agentSummary.buildReport(PERSON); return { rep, html: ff.agentSummary.reportHtml(rep) }; };
  const building = await mk({ compute: async () => null, status: () => ({ building: true, error: '' }) });
  assert.equal(building.rep.ageState, 'building');
  assert.ok(/data-as-age-retry/.test(building.html) && /index bana raha/.test(building.html));
  assert.ok(!/koi pending stock ageing nahi/.test(building.html));
  const failed = await mk({ compute: async () => { throw new Error('server down'); }, status: () => ({ building: false, error: 'x' }) });
  assert.equal(failed.rep.ageState, 'failed', 'compute reject → throw nahi, failed');
  assert.ok(/data-as-age-retry/.test(failed.html) && /load nahi hui/.test(failed.html));
  const missing = await mk(null);
  assert.equal(missing.rep.ageState, 'unavailable');
  assert.ok(/available nahi/.test(missing.html) && !/koi pending stock ageing nahi/.test(missing.html));
  const empty = await mk({ compute: async () => ({ ff: { ...AGE, total: 0, old30: 0, old60: 0, byClass: [] } }), status: () => ({ building: false, error: '' }) });
  assert.equal(empty.rep.ageState, 'ready');
  assert.ok(/koi pending stock ageing nahi/.test(empty.html), 'sach me 0 ageing → hi 🎉');
});

// ---------------------------------------------------------------------------------------------------------
test('KPI stock drawer: slow dataset poore drawer ko nahi rokta — jo aaya wo dikhta hai + notice + Retry', async () => {
  const KD = FF.kpiDetail;
  assert.equal(typeof KD._stockDetail, 'function');
  const prevLimits = { ...KD._limits };
  KD._limits.stock = 40; KD._limits.types = 20;
  const stock = [{ cls: 'VC4', group: 'VC4', tlName: 'TL One', n: 10 }, { cls: 'VC20', group: 'VC20', tlName: 'TL One', n: 4 }];
  const agentRows = [{ agentId: 'R101', agentName: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 10 }];
  const data = { stock, stockAgents: agentRows, stockTypes: [] };
  const need = (k) => Promise.resolve(data[k]);
  const origNeed = FF.store.need, origGet = FF.store.get;
  FF.store.get = () => undefined;
  try {
    // 1) sab aa jaye → koi notice nahi
    FF.store.need = need;
    const ok = await KD._stockDetail({ src: 'ff', title: 'Stock in field' });
    assert.ok(!/kd-notice/.test(ok.body), 'sab data aaya → notice nahi');
    assert.match(ok.sub, /14/, 'total 14 tags');
    // 2) stockAgents hang → drawer phir bhi class-wise stock (stock dataset) ke saath, notice me kaun sa missing
    FF.store.need = (k) => (k === 'stockAgents' ? never() : need(k));
    const t0 = Date.now();
    const part = await KD._stockDetail({ src: 'ff', title: 'Stock in field' });
    assert.ok(Date.now() - t0 < 1500, 'deadline par drawer bana');
    assert.match(part.body, /kd-notice/); assert.match(part.body, /agent-wise stock/); assert.match(part.body, /data-kd-retry/);
    assert.match(part.body, /TL One/, 'class × TL stock se table dikha');
    assert.match(part.sub, /14/);
    // 3) optional stockTypes hang / fail → notice nahi (sirf Tag type table optional hai)
    FF.store.need = (k) => (k === 'stockTypes' ? never() : need(k));
    const optional = await KD._stockDetail({ src: 'ff', title: 'Stock in field' });
    assert.ok(!/kd-notice/.test(optional.body), 'optional dataset ka notice nahi');
    // 4) GV: ek dataset hang → label wala notice
    const origG = { need: FF.gv.need, get: FF.gv.get };
    FF.gv.get = () => undefined;
    FF.gv.need = (k) => (k === 'stockClass' ? Promise.resolve([{ cls: 'VC4', group: 'VC4', n: 6 }]) : k === 'stockTl' ? never() : Promise.resolve([]));
    try {
      const gv = await KD._stockDetail({ src: 'gv', title: 'GV stock' });
      assert.match(gv.body, /kd-notice/); assert.match(gv.body, /GV TL-wise stock/);
      assert.match(gv.sub, /6/);
    } finally { FF.gv.need = origG.need; FF.gv.get = origG.get; }
  } finally {
    FF.store.need = origNeed; FF.store.get = origGet; Object.assign(KD._limits, prevLimits);
  }
});

// ---------------------------------------------------------------------------------------------------------
const MS = FF.masterSearch;
const ym = U.ymKey(new Date());
test('Master Search: ek slow dataset search ko nahi rokta — baaki se index, dataset aate hi judta + listeners ko khabar', async () => {
  const prevLimit = MS._limits.lightSoftMs;
  MS._limits.lightSoftMs = 40;
  let release;
  const lateStock = new Promise((r) => { release = r; });
  const agents = [{ ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', id: 'R101', n: 6 }];
  const stockAgents = [{ agentId: 'L900', agentName: 'Late Stock Person', tlName: 'TL Late', cls: 'VC4', group: 'VC4', n: 9 }];
  const store = { agents, daily: [], agentClass: [], stockAgents };
  const origNeed = FF.store.need, origGet = FF.store.get, origGv = { need: FF.gv.need, get: FF.gv.get, rows: FF.gv.rows, issuance: FF.gv.issuanceRows }, origPages = FF.pages;
  FF.store.need = (k) => (k === 'stockAgents' ? lateStock.then(() => stockAgents) : Promise.resolve(store[k] || []));
  FF.store.get = (k) => store[k];
  FF.gv.need = async () => []; FF.gv.get = () => []; FF.gv.rows = () => []; FF.gv.issuanceRows = () => [];
  FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => [] } };
  MS.invalidate();
  try {
    let refreshed = 0;
    const off = MS.onIndexReady(() => { refreshed++; });
    const t0 = Date.now();
    const idx = await MS.buildLight();
    assert.ok(Date.now() - t0 < 1500, 'slow dataset ke bina index bana (6 s ka intezaar nahi — test me 40 ms)');
    assert.ok(idx.people.size > 0 && MS.search('Ravi').people.some((p) => p.name === 'Ravi Kumar'), 'baaki datasets se search chalti hai');
    assert.equal(MS.search('Late Stock').people.length, 0, 'abhi stockAgents nahi aaya');
    assert.equal(idx.partial, true, 'index partial flag');
    const before = refreshed;
    release();
    for (let i = 0; i < 60 && !MS.search('Late Stock').people.length; i++) await sleep(20);
    assert.ok(MS.search('Late Stock').people.some((p) => p.name === 'Late Stock Person'), 'dataset aate hi index me juda');
    assert.ok(refreshed > before, 'dropdown refresh ke liye onIndexReady listeners ko khabar mili');
    assert.equal(idx.partial, false);
    off();
  } finally {
    FF.store.need = origNeed; FF.store.get = origGet; FF.gv.need = origGv.need; FF.gv.get = origGv.get; FF.gv.rows = origGv.rows; FF.gv.issuanceRows = origGv.issuance; FF.pages = origPages;
    MS._limits.lightSoftMs = prevLimit; MS.invalidate();
  }
});

// ---------------------------------------------------------------------------------------------------------
test('Master profile (kundli / drawer): deadline par partial profile turant, baaki data aate hi onLate se poora', async () => {
  const MP = FF.masterProfile;
  const prevLimit = MP._limits.openSoftMs;
  MP._limits.openSoftMs = 40;
  const perfAgent = (o) => ({ week: [1, 2, 3, 0, 0, 1, 2], curVc4: 4, curNvc4: 2, curTotal: 6, lastVc4: 2, lastNvc4: 1, lastTotal: 3, stockVc4: 7, stockNvc4: 3, stockTotal: 10, tlExcluded: false, agentStatus: 'Active', lastActive: 'Today', priority: 'High', ...o });
  const agents = [perfAgent({ name: 'Ravi Kumar', agentId: 'R101', id: 'R101', tlName: 'TL One', tlId: 'T1', tlMobile: '9000000001' })];
  const store = { daily: [], agentClass: [], agents: [], stockAgents: [{ agentId: 'R101', agentName: 'Ravi Kumar', tlId: 'T1', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 7 }] };
  let release;
  const gate = new Promise((r) => { release = r; });
  const origNeed = FF.store.need, origGet = FF.store.get, origPages = FF.pages;
  FF.store.need = (k) => (k === 'stockAgents' ? gate.then(() => store.stockAgents) : Promise.resolve(store[k] || []));
  FF.store.get = (k) => (k === 'stockAgents' ? undefined : store[k]);
  FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => agents, daysElapsed: () => 15, dayLabels: () => ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } };
  MP.invalidate();
  try {
    let late = null;
    const person = { kind: 'ff-agent', name: 'Ravi Kumar', sub: 'R101', tlSet: new Set(), classMap: new Map(), bars: new Set() };
    const t0 = Date.now();
    const pr = await MP._buildSoon(person, (p) => { late = p; });
    assert.ok(Date.now() - t0 < 1500, 'drawer 12 s (test me 40 ms) se zyada nahi rukta');
    assert.equal(pr.found, true, 'REPORT se profile mil gayi');
    assert.equal(pr.partial, true, 'partial flag → UI "baaki data aa raha hai" dikha sakti hai');
    assert.equal(late, null);
    release();
    for (let i = 0; i < 60 && !late; i++) await sleep(20);
    assert.ok(late, 'data aate hi onLate se poora profile');
    assert.ok(!late.partial, 'ab partial nahi');
    assert.equal(late.found, true);
  } finally {
    FF.store.need = origNeed; FF.store.get = origGet; FF.pages = origPages; MP._limits.openSoftMs = prevLimit; MP.invalidate();
  }
});
