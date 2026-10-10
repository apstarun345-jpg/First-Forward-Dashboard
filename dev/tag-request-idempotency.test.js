import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startMockAppsScript } from './mock-apps-script.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'test-secret-0123456789abcdef';

async function startServer(dir, mockUrl) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', RENDER: '', APPS_SCRIPT_ALLOW_LOCAL: '1', APPS_SCRIPT_URL: mockUrl, APPS_SCRIPT_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      logs += d;
      const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/);
      if (m && m[1] !== '0') resolve(`http://127.0.0.1:${m[1]}`);
    });
    child.on('exit', (code) => reject(new Error(`Server exited ${code}: ${logs}`)));
  });
  const base = await Promise.race([ready, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error(`startup timeout: ${logs}`)), 10000); t.unref(); })]);
  return { child, base, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}
async function jsonCall(base, route, method = 'GET', body, cookie = '', ip = '') {
  const headers = { 'Content-Type': 'application/json', cookie, 'X-Forwarded-Proto': 'https' };
  if (ip) headers['X-Forwarded-For'] = ip;
  const res = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { res, json, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const agent = (qty) => ({
  agentId: '99887766',
  agentName: 'Idempotency Test Agent',
  channel: 'ff',
  mobile: '9812345678',
  address: '99, Idempotency Road, Jaipur',
  pincode: '302016',
  rows: [{ cls: 'VC7', requested: qty, approved: qty }]
});

test('Tag Request: retry replays the same batch, preserves employee token, and rejects changed payload', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-tag-idem-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const submissionId = 'idem_test_submission_key_20261010';
    const body = { employee: { name: 'Idempotency QA', office: 'Jaipur office' }, submissionId, agents: [agent(4)] };

    const first = await jsonCall(server.base, '/api/public/tag-request', 'POST', body, '', '10.20.0.1');
    assert.equal(first.res.status, 201, JSON.stringify(first.json));
    assert.ok(first.json.requests && first.json.requests[0] && first.json.requests[0].id, 'first request ID returned');
    assert.ok(first.json.employeeToken, 'first employee history token returned');
    assert.equal(first.json.request.submissionId, undefined, 'internal retry key must not leak in response');
    assert.equal(first.json.request.submissionFingerprint, undefined, 'internal fingerprint must not leak in response');

    const retry = await jsonCall(server.base, '/api/public/tag-request', 'POST', body, '', '10.20.0.2');
    assert.equal(retry.res.status, 201, JSON.stringify(retry.json));
    assert.equal(retry.json.requests[0].id, first.json.requests[0].id, 'retry returns the original request ID');
    assert.equal(retry.json.employeeToken, first.json.employeeToken, 'retry preserves the original employee history token');

    const changed = await jsonCall(server.base, '/api/public/tag-request', 'POST', {
      ...body, agents: [agent(5)]
    }, '', '10.20.0.3');
    assert.equal(changed.res.status, 409, 'same key with changed quantity must be rejected');

    const login = await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' });
    assert.equal(login.res.status, 200, JSON.stringify(login.json));
    const list = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, login.cookie);
    assert.equal(list.res.status, 200, JSON.stringify(list.json));
    assert.equal(list.json.requests.length, 1, 'retry and changed payload must not create extra requests');
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
