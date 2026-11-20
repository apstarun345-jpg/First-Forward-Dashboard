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

async function jsonCall(base, route, method = 'GET', body, cookie = '') {
  const res = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', cookie, 'X-Forwarded-Proto': 'https' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { res, json, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));



test('master search — agent-extras: requests + notes (permission-wise)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-extras-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const admin = (await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).cookie;
    const anon = await jsonCall(server.base, '/api/master/agent-extras?name=Rahul%20Sharma');
    assert.equal(anon.res.status, 401);
    const e0 = await jsonCall(server.base, '/api/master/agent-extras?name=Rahul%20Sharma&id=1001', 'GET', undefined, admin);
    assert.equal(e0.res.status, 200);
    assert.equal(e0.json.requests.total, 0);
    const mk = (n, id, mob, ch) => ({ agentId: id, agentName: n, tl: 'TL One', channel: ch, mobile: mob, address: '12, Gandhi Nagar, Jaipur', pincode: '302015', rows: [{ cls: 'VC4', requested: 10, approved: 10 }, { cls: 'VC5', requested: 4, approved: 4 }] });
    const c1 = await jsonCall(server.base, '/api/tag-requests', 'POST', { employee: { name: 'Emp' }, agents: [mk('Rahul Sharma', '1001', '9876500001', 'ff'), mk('Priya Verma', '2002', '9876500002', 'gv')] }, admin);
    assert.equal(c1.res.status, 201, JSON.stringify(c1.json));
    const byId = await jsonCall(server.base, '/api/master/agent-extras?name=Nobody&id=1001', 'GET', undefined, admin);
    assert.equal(byId.json.requests.total, 1, 'ID se match');
    assert.equal(byId.json.requests.rows[0].total, 14);
    assert.deepEqual(byId.json.requests.rows[0].classes.map((x) => x.cls), ['VC4', 'VC5']);
    const byName = await jsonCall(server.base, '/api/master/agent-extras?name=priya%20%20verma', 'GET', undefined, admin);
    assert.equal(byName.json.requests.total, 1, 'naam se match (case/space)');
    const byMob = await jsonCall(server.base, '/api/master/agent-extras?name=X&mobile=%2B91%2098765%2000001', 'GET', undefined, admin);
    assert.equal(byMob.json.requests.total, 1, 'mobile se match');
    const none = await jsonCall(server.base, '/api/master/agent-extras?name=Ghost&id=9', 'GET', undefined, admin);
    assert.equal(none.json.requests.total, 0, 'chhoti ID se false match nahi');
    // notes
    const n = await jsonCall(server.base, '/api/workspace/notes', 'POST', { entityName: 'Rahul Sharma', text: 'Kal call karna hai', entityType: 'agent' }, admin);
    assert.equal(n.res.status, 201);
    const e2 = await jsonCall(server.base, '/api/master/agent-extras?name=Rahul%20Sharma&id=1001', 'GET', undefined, admin);
    assert.equal(e2.json.notes.total, 1);
    assert.match(e2.json.notes.rows[0].text, /call/);
    assert.ok(e2.json.complaints, 'admin ko complaints key milti hai');
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
