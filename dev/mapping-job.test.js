/* ⚡ v194 — Background mapping job: retries, ambiguous-409, sheet done row-by-row, cancel, retryOf, one-running-per-owner. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMappingJobs } from '../mapping-job.js';

const gate = { acquire: async () => {}, release() {}, good() {}, throttle() {}, snapshot: () => ({ limit: 8, active: 0, queued: 0, throttled: 0 }) };
const res = (status, json, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[String(k).toLowerCase()] || null }, text: async () => JSON.stringify(json) });
function make(plan, extra = {}) {
  const seen = new Map(); const writes = [];
  const jobs = createMappingJobs({
    gate, normalizeVcType: (v) => (/^\d+$/.test(String(v)) ? 'VC' + v : String(v)), getApiUrl: () => 'http://x/inv', getSecret: () => 's',
    sheetIdFrom: (v) => v, log: () => {},
    makeSheetStore: () => ({ call: async (action, p) => { if (extra.sheetFail && extra.sheetFail()) throw new Error('sheet down'); writes.push(...p.writes.map((w) => w.row)); return { written: p.writes.length }; } }),
    fetchImpl: async (url, init) => { const sno = JSON.parse(init.body).sno; const n = (seen.get(sno) || 0) + 1; seen.set(sno, n); return plan(sno, n); },
    tuning: { attemptTimeoutMs: 500, attempts: 3, roundWaits: [20, 20], workers: 6, retryWorkers: 3, flushMs: 20 }
  });
  return { jobs, seen, writes };
}
const row = (i, sheetRow) => ({ tagId: 'T' + i, serialNo: 'S' + i, vcType: '4', agentId: 'A' + i, sheetRow });
const key = (i) => `T${i},S${i},VC4,A${i}`;
async function finish(jobs, job) { for (let i = 0; i < 400 && job.status !== 'done'; i++) await new Promise((r) => setTimeout(r, 15)); assert.equal(job.status, 'done'); return jobs.snapshot(job, 0); }

test('transient failures retried in-attempt and in rounds; real conflict fails once; ambiguous timeout then "already" = success', async () => {
  const { jobs, seen } = make((sno, n) => {
    if (sno === key(1)) return n < 3 ? res(429, { message: 'slow' }, { 'retry-after': '0' }) : res(200, { success: true });
    if (sno === key(2)) return n < 5 ? res(502, {}) : res(200, { success: true });      // 3 attempts fail in pass 1, succeeds in a retry round
    if (sno === key(3)) return n === 1 ? res(503, {}) : res(409, { message: 'Tag already mapped' });
    if (sno === key(4)) return res(409, { message: 'Tag not available' });
    return res(200, { success: true });
  });
  const job = jobs.create({ owner: 'o', rows: [1, 2, 3, 4, 5].map((i) => row(i)) });
  const snap = await finish(jobs, job);
  assert.equal(snap.okCount, 4); assert.equal(snap.failed, 1);
  assert.equal(seen.get(key(4)), 1, 'permanent conflict not hammered');
  assert.ok(snap.round >= 1, 'a retry round ran');
  assert.ok(snap.events.some((e) => e.k === 'T3' && e.s === 1 && /Pehle se mapped/.test(e.m)));
  assert.match(snap.reasons[0][0], /Conflict/);
});

test('sheet done is written row-by-row, only when ALL tags of a sheet row are mapped', async () => {
  const { jobs, writes } = make((sno) => (sno === key(3) ? res(409, { message: 'Tag not available' }) : res(200, { success: true })));
  // sheet row 10 → tags 1,2 ; sheet row 11 → tags 3,4 (3 fails)
  const rows = [row(1, 10), row(2, 10), row(3, 11), row(4, 11)];
  const job = jobs.create({ owner: 'o', rows, sheet: { spreadsheetId: 'sid', tab: 'T', column: 'D', doneText: 'done' }, sheetPlan: { 10: 2, 11: 2 } });
  const snap = await finish(jobs, job);
  assert.deepEqual(writes.sort(), [10]);
  assert.equal(snap.sheet.written, 1); assert.equal(snap.sheet.enabled, true);
});

test('sheet write failure keeps rows pending and is reported', async () => {
  let fail = true;
  const { jobs, writes } = make(() => res(200, { success: true }), { sheetFail: () => fail });
  const job = jobs.create({ owner: 'o', rows: [row(1, 5)], sheet: { spreadsheetId: 'sid', tab: 'T', column: 'D', doneText: 'done' }, sheetPlan: { 5: 1 } });
  await new Promise((r) => setTimeout(r, 120));
  fail = false;
  const snap = await finish(jobs, job);
  assert.deepEqual(writes, [5]); assert.equal(snap.sheet.pending, 0);
});

test('one running job per owner; retryOf maps only failed rows; cancel stops', async () => {
  let release; const gateOpen = new Promise((r) => { release = r; });
  const { jobs } = make(async (sno, n) => { await gateOpen; return n === 1 && sno === key(2) ? res(409, { message: 'Tag not available' }) : res(200, { success: true }); });
  const job = jobs.create({ owner: 'o', rows: [row(1), row(2)] });
  assert.throws(() => jobs.create({ owner: 'o', rows: [row(3)] }), (e) => e.code === 'RUNNING' && e.runningId === job.id);
  release();
  const snap = await finish(jobs, job);
  assert.equal(snap.failed, 1);
  const job2 = jobs.create({ owner: 'o', retryOf: job.id });
  assert.equal(job2.total, 1);
  const snap2 = await finish(jobs, job2);
  assert.equal(snap2.okCount, 1, 'second attempt succeeds');
  assert.throws(() => jobs.create({ owner: 'other', retryOf: job.id }), (e) => e.code === 'GONE');
  const job3 = jobs.create({ owner: 'o', rows: [row(7), row(8), row(9)] });
  jobs.cancel(job3);
  const s3 = await finish(jobs, job3);
  assert.equal(s3.cancelled, true);
});

test('snapshot events cursor only returns new events', async () => {
  const { jobs } = make(() => res(200, { success: true }));
  const job = jobs.create({ owner: 'o', rows: [row(1), row(2), row(3)] });
  const snap = await finish(jobs, job);
  assert.equal(snap.events.length, 3);
  const again = jobs.snapshot(job, snap.next);
  assert.equal(again.events.length, 0);
});
