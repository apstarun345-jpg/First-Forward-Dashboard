// 🛰️ v3.125.303 — NPCI engine: rate gate (429 se seekhna), chalta run save + restart ke baad resume, sheet fail par history safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNpciEngine, createRateGate, mergeRows, readRateHeaders } from '../npci-engine.js';

const quiet = { log() {}, warn() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const okBody = (v) => JSON.stringify([{ STATUS: 'Success', APIRESPMSG: 'ok', NPCIVehicleDetails: [{ TAGID: `T${v}`, REGNUMBER: 'RJ14AB1234', npci_ExcCode: 'Active', TAGSTATUS: 'A' }] }]);
const resp = (status, txt, headers = {}) => ({ status, text: async () => txt, headers: { get: (k) => headers[k.toLowerCase()] || null } });

/** Mock API: `limit` requests per `windowMs` (sliding), upar 429. latency ms. */
function mockApi({ limit = 1e9, windowMs = 1000, latency = 5 } = {}) {
  const hits = []; const st = { calls: 0, n429: 0, maxInflight: 0, inflight: 0 };
  const fetch = async (url, init) => {
    st.calls++; st.inflight++; st.maxInflight = Math.max(st.maxInflight, st.inflight);
    try {
      const now = Date.now(); while (hits.length && now - hits[0] > windowMs) hits.shift();
      await sleep(latency);
      if (hits.length >= limit) { st.n429++; return resp(429, '{"error":"too many"}'); }
      hits.push(now);
      const b = JSON.parse(init.body); const v = b.tagId || b.vrn;
      if (v.startsWith('NF')) return resp(200, JSON.stringify([{ STATUS: 'Failure', APIRESPMSG: 'Unregistered.' }]));
      return resp(200, okBody(v));
    } finally { st.inflight--; }
  };
  return { fetch, st };
}
const tmp = () => mkdtempSync(path.join(tmpdir(), 'npci-'));
async function waitDone(eng, id, ms = 20000) { const t0 = Date.now(); for (;;) { const j = eng.jobs.get(id); if (j && j.done) return j; if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(20); } }

test('mergeRows: same input replace, naya aakhir me, idempotent', () => {
  const a = mergeRows([{ input: 'A', v: 1 }, { input: 'B', v: 1 }], [{ input: 'B', v: 2 }, { input: 'C', v: 2 }]);
  assert.deepEqual(a.map((r) => `${r.input}${r.v}`), ['A1', 'B2', 'C2']);
  assert.deepEqual(mergeRows(a, [{ input: 'C', v: 2 }]).length, 3);
});

test('rate gate: 429 par chhat seekhta hai, rate kam karta hai, dobara upar jaata hai', () => {
  const g = createRateGate({ rate: 10 });
  g.on429(0);
  assert.equal(g.ceil, 10); assert.equal(g.rate, 6);
  assert.ok(g.pauseUntil > Date.now());
  for (let i = 0; i < 200; i++) g.onOk(1000);
  assert.ok(g.rate <= g.ceil * 0.9 + 1e-9 && g.rate > 6, `rate ${g.rate} chhat ${g.ceil}`);
  assert.ok(g.maxConc() >= Math.floor(g.rate), 'latency 1s par concurrency ≈ rate');
});

test('v304 gate: kat se pehle nikli calls ke 429 dobara rate nahi kaatte; lagataar 429 me rate ek hi baar katta hai', () => {
  const g = createRateGate({ rate: 10 });
  const oldStart = Date.now() - 500;
  g.on429(0, Date.now());
  assert.equal(g.rate, 6);
  g.on429(0, oldStart);                      // kat se pehle bheji thi
  assert.equal(g.rate, 6, 'stale 429 = koi kat nahi');
  g.on429(0, Date.now() + 1);                // nayi, par episode chal raha (beech me koi OK nahi)
  assert.equal(g.rate, 6, 'ek episode = ek kat');
  assert.ok(g.pauseUntil - Date.now() > 1500, 'lagataar 429 = ruk lamba');
  g.onOk(500);
  g.on429(0, Date.now() + 2);                // OK ke baad naya episode
  assert.ok(g.rate < 6);
});

test('v304 gate: concurrency probe ke baad 429 = sirf concurrency −1, speed same', () => {
  const g = createRateGate({ rate: 3, concCap: 3 });
  g.active = 3; g.calls = 500;
  for (let i = 0; i < 100; i++) g.onOk(1000);
  assert.equal(g.concCap, 4, 'poori bhari thi → +1 probe');
  const r0 = g.rate; g.active = 4;
  g.on429(0, Date.now());
  assert.equal(g.concCap, 3); assert.equal(g.rate, r0, 'speed nahi kati'); assert.ok(g.pauseUntil <= Date.now(), 'ruk nahi');
});

test('v304: API rate-limit headers padhta hai (remaining 0 = reset tak ruk, policy = pakki chhat)', () => {
  const H = (o) => (k) => (k in o ? o[k] : null);
  assert.deepEqual(readRateHeaders(H({ 'ratelimit-limit': '100', 'ratelimit-remaining': '0', 'ratelimit-reset': '7', 'ratelimit-policy': '100;w=60' })), { limit: 100, remaining: 0, resetSec: 7, windowSec: 60 });
  assert.equal(readRateHeaders(H({ 'x-ratelimit-remaining': '5' })).remaining, 5);
  assert.equal(readRateHeaders(H({})), null);
  const g = createRateGate({ rate: 10 });
  g.onHeaders(readRateHeaders(H({ 'ratelimit-remaining': '0', 'ratelimit-reset': '3', 'ratelimit-policy': '120;w=60' })));
  assert.ok(g.pauseUntil - Date.now() > 2500, 'reset tak ruk');
  assert.equal(g.hardCeil, 2);
  for (let i = 0; i < 50; i++) g.onOk(300);
  assert.ok(g.rate <= 2 * 0.97 + 1e-9, `policy se upar nahi: ${g.rate}`);
  assert.ok(g.stats().hdr, 'diagnosis ke liye headers stats me');
});

test('bulk: 300 items, API limit 40/s — sab check, koi fail nahi, history me save', async () => {
  const dir = tmp();
  try {
    const api = mockApi({ limit: 40, windowMs: 1000, latency: 30 });
    const eng = createNpciEngine({ dataDir: dir, fetch: api.fetch, log: quiet, gate: { rate: 20 } });
    const items = Array.from({ length: 300 }, (_, i) => (i % 50 === 7 ? `NF${1000 + i}XX` : `RJ14AB${String(1000 + i)}`));
    const j = await eng.startJob({ owner: 'tarun', items });
    // job shuru hote hi history me "chal raha"
    let L = await eng.listRuns('tarun', { autoResume: false });
    assert.equal(L.runs[0].id, j.runId); assert.equal(L.runs[0].running, true);
    await waitDone(eng, j.id);
    const job = eng.jobs.get(j.id);
    assert.equal(job.rows.length, 300);
    assert.equal(job.rows.filter((r) => r.retry).length, 0, '429 user ko fail nahi dikhna chahiye');
    L = await eng.listRuns('tarun', { autoResume: false });
    assert.equal(L.runs[0].running, false); assert.equal(L.runs[0].checked, 300);
    assert.equal(L.runs[0].sum.notFound, 6); assert.equal(L.runs[0].sum.found, 294);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pichhli 5 + chalta: 7 runs ke baad 5 bachte hain', async () => {
  const dir = tmp();
  try {
    const api = mockApi({ latency: 1 });
    const eng = createNpciEngine({ dataDir: dir, fetch: api.fetch, log: quiet, gate: { rate: 200 } });
    for (let n = 0; n < 7; n++) { const j = await eng.startJob({ owner: 'u', items: [`RJ14AB${1000 + n}`, `RJ14AC${1000 + n}`] }); await waitDone(eng, j.id); }
    const L = await eng.listRuns('u', { autoResume: false });
    assert.equal(L.runs.length, 5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('server restart: chalta run disk par checkpoint → naya server page khulte hi bache hue resume karta hai', async () => {
  const dir = tmp();
  try {
    const slow = mockApi({ latency: 40 });
    const eng1 = createNpciEngine({ dataDir: dir, fetch: slow.fetch, log: quiet, checkpointMs: 60, gate: { rate: 50, maxConc: 4 } });
    const items = Array.from({ length: 120 }, (_, i) => `RJ14AB${1000 + i}`);
    const j = await eng1.startJob({ owner: 'tarun', items });
    await sleep(500);   // kuch checkpoint ho jaayen
    const job1 = eng1.jobs.get(j.id);
    assert.ok(job1.rows.length > 5 && job1.rows.length < 120, `beech me: ${job1.rows.length}`);
    // "crash": purana engine chhod do (uske workers ko rok do taaki aage disk par na likhe)
    await eng1._flush('tarun'); eng1._kill();
    await sleep(120);
    const api2 = mockApi({ latency: 2 });
    const eng2 = createNpciEngine({ dataDir: dir, fetch: api2.fetch, log: quiet, gate: { rate: 200 } });
    const L = await eng2.listRuns('tarun');
    assert.equal(L.resumed, true, 'adhoora run apne aap resume');
    assert.equal(L.active.runId, j.runId);
    assert.ok(L.active.total < 120, 'sirf bache hue dobara');
    await waitDone(eng2, L.active.id);
    const run = await eng2.getRun('tarun', j.runId);
    assert.equal(run.checked, 120); assert.equal(run.running, false);
    assert.equal(new Set(run.rows.map((r) => r.input)).size, 120);
    const L2 = await eng2.listRuns('tarun');
    assert.equal(L2.runs.length, 1); assert.equal(L2.resumed, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Ruko dabaya to auto-resume nahi, par manual resume se bache hue', async () => {
  const dir = tmp();
  try {
    const api = mockApi({ latency: 20 });
    const eng = createNpciEngine({ dataDir: dir, fetch: api.fetch, log: quiet, gate: { rate: 50, maxConc: 2 } });
    const items = Array.from({ length: 60 }, (_, i) => `RJ14AB${1000 + i}`);
    const j = await eng.startJob({ owner: 'u', items });
    await sleep(150); eng.stopJob(j.id, 'u'); await waitDone(eng, j.id);
    let L = await eng.listRuns('u');
    assert.equal(L.resumed, false); assert.equal(L.runs[0].stopped, true); assert.ok(L.runs[0].left > 0);
    const r = await eng.startJob({ owner: 'u', resume: j.runId });
    await waitDone(eng, r.id);
    L = await eng.listRuns('u');
    assert.equal(L.runs[0].checked, 60); assert.equal(L.runs[0].left, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sheet load fail → history overwrite nahi hoti; sheet theek hote hi purani + nayi dono', async () => {
  const dir = tmp();
  try {
    const old = [{ id: 'aaaaaaaaaaaaaaaa', at: 1000, total: 1, checked: 1, rows: [{ input: 'OLD1234', kind: 'VRN', ok: true, records: [] }], sum: {} }];
    const zlib = await import('node:zlib');
    const body = zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, runs: old }))).toString('base64');
    let down = true; const writes = [];
    const store = { call: async (action, args) => {
      if (down) throw new Error('Apps Script timeout');
      if (action === 'readrange' && args.columns[0] === 'B') return { rows: [[JSON.stringify({ u: 'D' })]] };
      if (action === 'readrange') return { rows: [[JSON.stringify({ kind: 'npciRuns', n: 1 })], [body]] };
      if (action === 'writecells') { writes.push(args); return { ok: true }; }
      return {};
    } };
    const api = mockApi({ latency: 1 });
    const eng = createNpciEngine({ dataDir: dir, fetch: api.fetch, log: quiet, store, gate: { rate: 200 } });
    const j = await eng.startJob({ owner: 'u', items: ['RJ14AB1000'] });
    await waitDone(eng, j.id); await sleep(50);
    assert.equal(writes.filter((w) => w.column === 'D').length, 0, 'sheet down — purani history overwrite nahi');
    down = false;
    eng.mem.get('u').staleAt = 0;
    await eng.listRuns('u');   // background sync
    await sleep(100);
    const L = await eng.listRuns('u');
    assert.deepEqual(L.runs.map((r) => r.id).sort(), [j.runId, 'aaaaaaaaaaaaaaaa'].sort());
    assert.equal(L.stale, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
