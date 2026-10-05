/* ⚡ v3.39 — Agent / TL Summary ka "Loading…" bahut der (GV me ~15 s freeze) isliye atakta tha ki har TL ke `quick()` par
   poora stock / issuance rollup dobara chalta tha (TL × rows, rows × agents). Ab:
     • FF `tlStockComposition` row-indexes use karta hai,
     • GV `issuanceRows()` ek data-version par ek hi baar compute hota hai (adapter ke `inputsKey` se),
     • GV team / agent rows ek index se aati hain (sheet ka order wahi),
     • `FF.gv.latestDate()` memoized hai.
   Ye test (1) awkward id / naam wale GV rows par EXACT numbers lock karta hai (hand se nikaale), (2) memo kab invalidate hota hai,
   (3) bade data par quadratic wapas na aaye (generous time budget). */
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
U.runRateDays = () => 15;
FF.auth = { can: () => true, settings: {} };
require(path.join(ROOT, 'masterProfile.js'));
const MP = FF.masterProfile;

const now = new Date();
const ym = U.ymKey(now), prev = U.prevMonthKey(ym);
const dayOf = (ymKey, d) => { const [y, m] = ymKey.split('-').map(Number); return new Date(y, m - 1, d); };
const person = (kind, name, sub) => ({ kind, name, sub: sub || '', tlSet: new Set(), classMap: new Map(), bars: new Set() });
const perfAgent = (o) => ({ week: [1, 2, 3, 0, 0, 1, 2], curVc4: 0, curNvc4: 0, curTotal: 0, lastVc4: 0, lastNvc4: 0, lastTotal: 0, stockVc4: 0, stockNvc4: 0, stockTotal: 0, tlExcluded: false, agentStatus: 'Active', lastActive: 'Today', ...o });

/** GV world: EIR (store.daily) + GV REPORT + stock. Sirf PICHHLE mahine ke EIR rows → aaj ki date par result nirbhar nahi. */
function gvWorld({ eir, report, extraMaster = [] }) {
  const daily = eir.map((r) => {
    const date = dayOf(prev, r.day || 5);
    return { channel: 'GV Partner', d: date, key: U.dateKey(date), ym: prev, day: r.day || 5, cls: r.cls, group: r.cls === 'VC4' ? 'VC4' : 'VC20', type: 'ISSUANCE', vrnType: 'VRN', agentId: r.id, agentName: r.name, tlId: r.tlId || '', tlName: r.tlName || '', n: r.n };
  });
  const stockAgent = report.map((r) => ({ agentId: r.agentId, agentName: r.agentName, tlId: r.tlId, tlName: r.tlName, n: r.stockTotal || 0 }));
  const storeData = { daily, agentClass: [], agents: [], stockAgents: [] };
  FF.store.need = async (k) => storeData[k] || [];
  FF.store.get = (k) => storeData[k];
  FF.gv.state.data = { master: extraMaster, report, stockAgent, stockAgentClass: [] };
  FF.gv.need = async (k) => FF.gv.state.data[k];
  FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => [], daysElapsed: () => 15, dayLabels: () => ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } };
  MP.invalidate();
  return { daily, storeData };
}
const gvRep = (agentId, agentName, tlId, tlName, o = {}) => ({ agentId, agentName, mobile: '', tlId, tlName, priority: 'Low', stockVc4: 1, stockComm: 0, stockTotal: 1, stockByClass: { VC4: 1 }, curVc4: 0, curComm: 0, curTotal: 0, lastVc4: 0, lastComm: 0, lastTotal: 0, ...o });

// Awkward GV fixture — expected numbers hand-computed (sheet order / rules: sameGvAgent = id decides only when BOTH sides have an id;
// otherwise normalised name decides).
const GV_EIR = [
  { id: 'G001', name: 'Asha Verma', cls: 'VC4', n: 2, tlId: 'GT1', tlName: 'GV TL Alpha' },        // Asha (id match, case-insensitive vs report 'g001')
  { id: '', name: 'ASHA  VERMA', cls: 'VC4', n: 6, tlId: 'GT1', tlName: 'GV TL Alpha' },           // row id nahi → naam (spaces/case normalise) → Asha
  { id: 'G003', name: 'Chetan Rao', cls: 'VC20', n: 3, tlId: 'GT1', tlName: 'GV TL Alpha' },       // Chetan (id)
  { id: '', name: 'Bhanu Singh', cls: 'VC4', n: 1, tlId: 'GT1', tlName: 'GV TL Alpha' },           // Bhanu (id-less agent → naam)
  { id: 'G777', name: 'Bhanu Singh', cls: 'VC5', n: 5, tlId: 'GT1', tlName: 'GV TL Alpha' },       // id-less agent: row ki id ignore, naam same → Bhanu
  { id: 'G999', name: 'Stranger', cls: 'VC4', n: 7, tlId: 'GT2', tlName: 'GV TL Beta' },           // doosre TL ka agent
  { id: 'G003', name: 'Different Name', cls: 'VC4', n: 4, tlId: 'GT1', tlName: 'GV TL Alpha' },    // id equal → naam alag ho tab bhi Chetan
  { id: 'G001', name: 'Chetan Rao', cls: 'VC20', n: 11, tlId: 'GT1', tlName: 'GV TL Alpha' }       // dono taraf id hai (G001 ≠ G003) → Asha, Chetan nahi (naam same hone par bhi)
];
const GV_REPORT = [
  gvRep('g001', 'Asha Verma', 'GT1', 'GV TL Alpha'),
  gvRep('', 'Bhanu Singh', 'GT1', 'GV TL Alpha'),
  gvRep('G003', 'Chetan Rao', 'GT1', 'GV TL Alpha'),
  gvRep('G999', 'Stranger', 'GT2', 'GV TL Beta')
];

test('GV TL profile: awkward id / naam wale EIR rows par team + agent totals EXACT (index == purana filter)', () => {
  gvWorld({ eir: GV_EIR, report: GV_REPORT });
  const tl = MP.quick(person('gv-tl', 'GV TL Alpha', 'GT1'));
  assert.ok(tl, 'TL profile mila');
  // Asha 2 + 6 + 11 = 19 (VC4 8 · comm 11) · Bhanu 1 + 5 = 6 (VC4 1 · comm 5) · Chetan 3 + 4 = 7 (VC4 4 · comm 3) → team 32 (VC4 13 · comm 19)
  assert.equal(tl.totals.lastTotal, 32, 'team issuance last month');
  assert.equal(tl.totals.lastVc4, 13);
  assert.equal(tl.totals.lastComm, 19);
  const byName = Object.fromEntries(tl.agents.map((a) => [a.name, a]));
  assert.equal(byName['Asha Verma'].last, 19, 'Asha');
  assert.equal(byName['Bhanu Singh'].last, 6, 'Bhanu (id-less)');
  assert.equal(byName['Chetan Rao'].last, 7, 'Chetan — Asha ki row (G001) nahi jodi');
  const beta = MP.quick(person('gv-tl', 'GV TL Beta', 'GT2'));
  assert.equal(beta.totals.lastTotal, 7, 'Stranger ke 7, Alpha ke rows nahi');
  // Agent profile ka rule alag hai: naam YA exact id (case-sensitive). Asha ki report id 'g001' (chhota) hai, EIR row 'G001' —
  // isliye id se row 8 nahi judti, sirf naam wale rows: 2 + 6.
  const asha = MP.quick(person('gv-agent', 'Asha Verma', 'G001'));
  assert.equal(asha.totals.lastTotal, 8, 'agent profile: naam wale rows (2 + 6); id case alag → row 8 nahi');
  // Chetan: naam (rows 3 + 8 = 3 + 11) YA id G003 (rows 3 + 7 = 3 + 4) → 3 + 4 + 11
  const chetan = MP.quick(person('gv-agent', 'Chetan Rao', 'G003'));
  assert.equal(chetan.totals.lastTotal, 18, 'agent profile: naam ya exact id');
  const nobody = MP.quick(person('gv-agent', 'Nobody Here', 'G404'));
  assert.ok(!nobody || !nobody.totals || !nobody.totals.lastTotal, 'anjaan agent ke 0');
});

test('GV issuanceRows ek data-version par ek hi baar compute hota hai; data badle to dobara', () => {
  const { daily } = gvWorld({ eir: GV_EIR, report: GV_REPORT });
  const real = FF.gv.issuanceRows;
  assert.equal(typeof real.inputsKey, 'function', 'real adapter apna inputsKey batata hai');
  let calls = 0;
  const counting = () => { calls++; return real(); };
  counting.inputsKey = real.inputsKey;
  FF.gv.issuanceRows = counting;
  try {
    MP.invalidate();
    MP.quick(person('gv-tl', 'GV TL Alpha', 'GT1'));
    MP.quick(person('gv-tl', 'GV TL Beta', 'GT2'));
    MP.quick(person('gv-agent', 'Asha Verma', 'G001'));
    MP.quick(person('gv-agent', 'Stranger', 'G999'));
    assert.equal(calls, 1, 'chaar profiles, ek rollup');
    // naya EIR row (store ka array wahi, len badli) → memo invalid
    const extraDate = dayOf(prev, 9);
    daily.push({ channel: 'GV Partner', d: extraDate, key: U.dateKey(extraDate), ym: prev, day: 9, cls: 'VC4', group: 'VC4', type: 'ISSUANCE', vrnType: 'VRN', agentId: 'G999', agentName: 'Stranger', tlId: 'GT2', tlName: 'GV TL Beta', n: 3 });
    MP.invalidate();
    const beta = MP.quick(person('gv-tl', 'GV TL Beta', 'GT2'));
    assert.equal(calls, 2, 'data badla → dobara compute');
    assert.equal(beta.totals.lastTotal, 10, 'naya row (3) bhi gina: 7 + 3');
    // inputsKey ke bina stub adapter kabhi cache nahi hota (host / tests ke fake adapters safe)
    let stubCalls = 0;
    const stub = () => { stubCalls++; return real(); };
    FF.gv.issuanceRows = stub;
    MP.invalidate();
    MP.quick(person('gv-tl', 'GV TL Alpha', 'GT1'));
    MP.quick(person('gv-tl', 'GV TL Beta', 'GT2'));
    assert.ok(stubCalls >= 2, 'stub har baar call hota hai (cache nahi)');
  } finally { FF.gv.issuanceRows = real; }
});

test('FF.gv.latestDate memoized hai par data ke saath badalta hai', () => {
  const { daily } = gvWorld({ eir: GV_EIR, report: GV_REPORT });
  const realLatest = FF.model.latestDate;
  let calls = 0;
  FF.model.latestDate = (rows) => { calls++; return realLatest(rows); };
  try {
    const a = FF.gv.latestDate(), b = FF.gv.latestDate(), c = FF.gv.latestDate();
    assert.equal(calls, 1, 'teen call, ek compute');
    assert.equal(U.dateKey(a), U.dateKey(dayOf(prev, 5)), 'sabse naya GV EIR din = prev month ka 5');
    assert.equal(a, b); assert.equal(b, c);
    // usi array me ek aur (naya din) row → memo invalid, naya latest
    const d = dayOf(prev, 20);
    daily.push({ channel: 'GV Partner', d, key: U.dateKey(d), ym: prev, day: 20, cls: 'VC4', group: 'VC4', type: 'ISSUANCE', vrnType: 'VRN', agentId: 'G001', agentName: 'Asha Verma', tlId: 'GT1', tlName: 'GV TL Alpha', n: 1 });
    const fresh = FF.gv.latestDate();
    assert.equal(U.dateKey(fresh), U.dateKey(dayOf(prev, 20)), 'naya din dikhta hai (stale memo nahi)');
    assert.equal(fresh.getTime(), realLatest(FF.gv.liveDailyRows()).getTime(), 'memo == bina cache ka result');
    // Settings me GV channel-TL naam badle (rows ki attribution badalti hai) → memo invalid, stale jawab nahi
    const before = calls;
    FF.gv.latestDate();
    assert.equal(calls, before, 'data wahi → memo hit');
    const hadEir = Object.prototype.hasOwnProperty.call(FF.config, 'eir'), prevEir = FF.config.eir;
    FF.config.eir = { ...(prevEir || {}), gvChannelTl: 'Some Other Channel Pvt. Ltd.' };
    try {
      FF.gv.latestDate();
      assert.equal(calls, before + 1, 'gvChannelTl setting badli → dobara compute');
    } finally { if (hadEir) FF.config.eir = prevEir; else delete FF.config.eir; }
  } finally { FF.model.latestDate = realLatest; }
});

// ---- scale guards — generous time budgets (purana code yahan 10 s+ leta tha; ab ek second se kam) --------------------------------
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

test('GV: 120 TL × 1500 agent × ~45k EIR rows — sab TL quick() ek second ke aas-paas (budget 8 s), numbers sahi', () => {
  const rnd = rng(77), ri = (n) => Math.floor(rnd() * n);
  const TLN = 120, AGN = 1500;
  const report = [], eir = [], expected = new Map();
  for (let i = 0; i < AGN; i++) {
    const tlIdx = i % TLN, tlName = `GV TL ${tlIdx}`, tlId = `GT${tlIdx}`;
    const noId = i % 29 === 7;
    const a = { id: noId ? '' : `G${i}`, name: `GV Agent ${i}` };
    report.push(gvRep(a.id, a.name, tlId, tlName, { stockTotal: 2, stockVc4: 1, stockComm: 1 }));
    const k = 20 + ri(20);
    for (let j = 0; j < k; j++) {
      const n = 1 + ri(3);
      eir.push({ id: a.id, name: a.name, cls: j % 4 === 0 ? 'VC20' : 'VC4', n, day: 1 + (j % 25), tlId, tlName });
      expected.set(tlId, (expected.get(tlId) || 0) + n);
    }
  }
  gvWorld({ eir, report });
  const t0 = Date.now();
  for (let t = 0; t < TLN; t++) {
    const q = MP.quick(person('gv-tl', `GV TL ${t}`, `GT${t}`));
    assert.equal(q.totals.lastTotal, expected.get(`GT${t}`), `TL ${t} ka last-month issuance`);
  }
  const ms = Date.now() - t0;
  assert.ok(ms < 8000, `GV TL quick() ×${TLN} ne ${ms} ms liye — quadratic scan wapas aaya?`);
});

test('FF: 300 TL × 3000 agent × 40k stock rows — TL stock composition indexed (budget 8 s), team + own stock sahi', () => {
  const TLN = 300, PER = 10;
  const agents = [], stockAgents = [];
  const expected = new Map();
  for (let t = 0; t < TLN; t++) {
    const tlName = `TL ${t}`, tlId = `T${t}`;
    let team = 0;
    for (let k = 0; k < PER; k++) {
      const i = t * PER + k;
      const vc4 = 3 + (i % 5), comm = i % 3;
      agents.push(perfAgent({ name: `Agent ${i}`, agentId: `A${i}`, id: `A${i}`, tlName, tlId, tlMobile: '9000000000', stockVc4: vc4, stockNvc4: comm, stockTotal: vc4 + comm }));
      stockAgents.push({ agentId: `A${i}`, agentName: `Agent ${i}`, tlId, tlName, cls: 'VC4', group: 'VC4', n: vc4 });
      if (comm) stockAgents.push({ agentId: `A${i}`, agentName: `Agent ${i}`, tlId, tlName, cls: 'VC20', group: 'VC20', n: comm });
      team += vc4 + comm;
    }
    // TL ka apna stock (apni hi identity me) — team stock me nahi, par TL total me judta hai
    const own = 2 + (t % 4);
    stockAgents.push({ agentId: tlId, agentName: tlName, tlId, tlName, cls: 'VC4', group: 'VC4', n: own });
    expected.set(tlName, { team, own });
  }
  // filler: 25k aur rows (doosre TLs ke agents ki extra class rows) — rows ka size TL-count se guna na ho
  for (let f = 0; f < 25000; f++) {
    const i = f % (TLN * PER), t = Math.floor(i / PER);
    stockAgents.push({ agentId: `A${i}`, agentName: `Agent ${i}`, tlId: `T${t}`, tlName: `TL ${t}`, cls: 'VC5', group: 'VC5+', n: 0 });
  }
  const storeData = { daily: [], agentClass: [], agents: [], stockAgents };
  FF.store.need = async (k) => storeData[k] || [];
  FF.store.get = (k) => storeData[k];
  FF.gv.state.data = { master: [], report: [], stockAgent: [], stockAgentClass: [] };
  FF.gv.need = async (k) => FF.gv.state.data[k];
  FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => agents, daysElapsed: () => 15, dayLabels: () => ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } };
  MP.invalidate();
  const t0 = Date.now();
  for (let t = 0; t < TLN; t++) {
    const q = MP.quick(person('ff-tl', `TL ${t}`, `T${t}`));
    const want = expected.get(`TL ${t}`);
    assert.equal(q.stock.total, want.team + want.own, `TL ${t}: team ${want.team} + own ${want.own}`);
    assert.equal(q.tlStock && q.tlStock.own ? q.tlStock.own.total : want.own, want.own, `TL ${t} own stock`);
  }
  const ms = Date.now() - t0;
  assert.ok(ms < 8000, `FF TL quick() ×${TLN} ne ${ms} ms liye — TL × rows scan wapas aaya?`);
});
