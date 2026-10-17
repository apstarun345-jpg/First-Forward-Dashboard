/* ⚡ v193 — Mapping API resilience: flaky upstream (429 + Retry-After, 502, timeout-then-"already mapped") par server
   rows ko retry karta hai, adaptive gate throttle hota hai, kabhi poora batch nahi girta, 70s deadline se pehle jawab. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeApi(plan) {
  const seen = new Map(); const log = [];
  let active = 0, peak = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      active++; peak = Math.max(peak, active);
      const { sno } = JSON.parse(body || '{}');
      const key = String(sno);
      const n = (seen.get(key) || 0) + 1; seen.set(key, n); log.push(key);
      const act = plan(key, n);
      await new Promise((r) => setTimeout(r, act.delay || 5));
      active--;
      if (act.hang) return; // never answers (client aborts)
      res.writeHead(act.status || 200, { 'Content-Type': 'application/json', ...(act.headers || {}) });
      res.end(JSON.stringify(act.json || { success: true, message: 'ok' }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, log, seen, peak: () => peak, url: `http://127.0.0.1:${server.address().port}/inv` })));
}

async function startApp(apiUrl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-mr-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', RENDER: '', STOCK_AGE_WARM: '0', GV_TAG_MAPPING_SECRET: 'test-secret', FF_MAPPING_API_URL: apiUrl },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });
  const base = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`startup timeout ${logs}`)), 20000);
    child.stdout.on('data', (d) => { logs += d; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); } });
  });
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ username: 'owner', password: 'initial-password' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const post = async (p, body) => {
    const res = await fetch(`${base}${p}`, { method: 'POST', headers: { cookie, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', 'X-Requested-With': 'FF-Dashboard' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const stop = async () => { child.kill('SIGTERM'); await once(child, 'exit').catch(() => {}); };
  return { post, stop };
}
const row = (i) => ({ tagId: `T${i}`, serialNo: `S${i}`, vcType: '4', agentId: `A${i}` });
const key = (i) => `T${i},S${i},VC4,A${i}`;

test('transient failures (429 Retry-After, 502, timeout-then-already-mapped) are retried server-side; permanent 409 fails once', async () => {
  const api = await makeApi((k, n) => {
    if (k === key(1)) return n < 3 ? { status: 429, headers: { 'Retry-After': '1' }, json: { message: 'slow down' } } : {};
    if (k === key(2)) return n < 2 ? { status: 502, json: { message: 'bad gateway' } } : {};
    if (k === key(3)) return n === 1 ? { status: 503, json: {} } : { status: 409, json: { message: 'Tag already mapped to agent' } };
    if (k === key(4)) return { status: 409, json: { message: 'Tag not available' } };
    return {};
  });
  const app = await startApp(api.url);
  try {
    const out = await app.post('/api/fastag-mapping/map', { rows: [1, 2, 3, 4, 5, 6].map(row) });
    assert.equal(out.status, 200);
    const r = out.json.results;
    assert.equal(r[0].success, true, '429 twice then ok → success');
    assert.equal(r[1].success, true, '502 then ok → success');
    assert.equal(r[2].success, true, '503 (ambiguous) then "already mapped" → counted as success');
    assert.match(r[2].message, /Pehle se mapped/);
    assert.equal(r[3].success, false, 'real conflict stays failed');
    assert.equal(r[3].retryable, false, 'conflict is not retryable');
    assert.equal(api.seen.get(key(4)), 1, 'permanent failure is not hammered');
    assert.equal(r[4].success && r[5].success, true);
    assert.equal(out.json.success, 5);
    assert.ok(out.json.speed && out.json.speed.limit >= 2, 'speed snapshot returned');
  } finally { await app.stop(); api.server.close(); api.server.closeAllConnections?.(); }
});

test('adaptive gate: concurrency to the mapping API never exceeds its limit and a big batch finishes', async () => {
  const api = await makeApi(() => ({ delay: 20 }));
  const app = await startApp(api.url);
  try {
    const rows = Array.from({ length: 60 }, (_, i) => row(100 + i));
    const out = await app.post('/api/fastag-mapping/map', { rows: rows.slice(0, 60) });
    assert.equal(out.status, 200);
    assert.equal(out.json.success, 60, 'all 60 mapped');
    assert.ok(api.peak() <= 14, 'peak concurrency stays within the gate max (' + api.peak() + ')');
  } finally { await app.stop(); api.server.close(); api.server.closeAllConnections?.(); }
});
