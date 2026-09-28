import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startServer(dir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', RENDER: '' },
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

async function login(base, username, password) {
  const out = await jsonCall(base, '/api/auth/login', 'POST', { username, password });
  assert.equal(out.res.status, 200, JSON.stringify(out.json));
  assert.match(out.cookie, /^ff_sid=/);
  return out.cookie;
}

test('saved views and follow-up notes are permission-safe and durable across restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-workspace-'));
  let server;
  try {
    server = await startServer(dir);
    const admin = await login(server.base, 'owner', 'initial-password');
    const badMap = await jsonCall(server.base, '/api/settings', 'PUT', { settings: { ffCommission: { rateCol: 'x'.repeat(90) } } }, admin);
    assert.equal(badMap.res.status, 400, '90-character mapping reject hona chahiye');
    const goodMap = await jsonCall(server.base, '/api/settings', 'PUT', { settings: { ffCommission: { rateCol: 'bz', earnedCol: 'CA', categoryCol: '' } } }, admin);
    assert.equal(goodMap.res.status, 200);
    assert.equal(goodMap.json.settings.ffCommission.rateCol, 'BZ');
    const namedMap = await jsonCall(server.base, '/api/settings', 'PUT', { settings: { ffCommission: { earnedCol: 'Earned Commission', categoryCol: 'Commission Rate' } } }, admin);
    assert.equal(namedMap.res.status, 200, JSON.stringify(namedMap.json));
    assert.equal(namedMap.json.settings.ffCommission.earnedCol, 'Earned Commission');
    assert.equal(namedMap.json.settings.ffCommission.categoryCol, 'Commission Rate');
    const resetMap = await jsonCall(server.base, '/api/settings', 'PUT', { settings: { ffCommission: { rateCol: 'BZ', earnedCol: 'CA', categoryCol: '' } } }, admin);
    assert.equal(resetMap.res.status, 200);
    const view = await jsonCall(server.base, '/api/workspace/views', 'POST', { title: 'High-risk stock', route: '#/forecast?risk=High', shared: true }, admin);
    assert.equal(view.res.status, 201, JSON.stringify(view.json));
    const note = await jsonCall(server.base, '/api/workspace/notes', 'POST', { entityType: 'agent', entityKey: 'A-1', entityName: 'Agent One', channel: 'both', text: 'Call before Friday', priority: 'high', status: 'open' }, admin);
    assert.equal(note.res.status, 201, JSON.stringify(note.json));
    const done = await jsonCall(server.base, `/api/workspace/notes/${note.json.note.id}`, 'PATCH', { status: 'done', timelineNote: 'Confirmed' }, admin);
    assert.equal(done.res.status, 200);
    assert.equal(done.json.note.status, 'done');
    assert.ok(done.json.note.timeline.some((e) => e.action === 'status:done'));

    const user = await jsonCall(server.base, '/api/users', 'POST', { username: 'viewer', name: 'Viewer', password: 'memberpass', approved: true, permissions: [] }, admin);
    assert.equal(user.res.status, 200, JSON.stringify(user.json));
    const member = await login(server.base, 'viewer', 'memberpass');
    const hidden = await jsonCall(server.base, '/api/workspace', 'GET', undefined, member);
    assert.equal(hidden.res.status, 200);
    assert.deepEqual(hidden.json.views, []);
    assert.deepEqual(hidden.json.notes, []);
    assert.equal((await jsonCall(server.base, '/api/workspace/views', 'POST', { title: 'No', route: '#/home' }, member)).res.status, 403);
    assert.equal((await jsonCall(server.base, '/api/workspace/notes', 'POST', { entityName: 'No', text: 'No' }, member)).res.status, 403);

    await server.stop(); server = await startServer(dir);
    const admin2 = await login(server.base, 'owner', 'initial-password');
    const restored = await jsonCall(server.base, '/api/workspace', 'GET', undefined, admin2);
    assert.equal(restored.res.status, 200);
    assert.ok(restored.json.views.some((v) => v.id === view.json.view.id && v.route.includes('risk=High')));
    assert.ok(restored.json.notes.some((n) => n.id === note.json.note.id && n.status === 'done'));
  } finally {
    if (server) await server.stop().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
});
