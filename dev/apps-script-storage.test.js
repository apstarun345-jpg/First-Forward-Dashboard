import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startMockAppsScript } from './mock-apps-script.js';

process.env.APPS_SCRIPT_ALLOW_LOCAL = '1';
const { AppsScriptStore } = await import('../apps-script-storage.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'test-secret-0123456789-abcdef';

test('Apps Script store: redirect-follow, batching, encryption, wrong secret and URL guard', async () => {
  const mock = await startMockAppsScript({ secret: SECRET });
  try {
    const store = new AppsScriptStore({ url: mock.url, secret: SECRET, batchDelay: 5, wait: async () => {} });
    assert.equal((await store.ping()).spreadsheet, 'Mock Sheet');
    assert.equal(await store.read(), null, 'empty sheet → null (first run)');
    const users = [{ username: 'owner', name: 'Private Owner', password: 'salt:hash' }];
    const settings = { brand: 'Private Brand', theme: { accent: '#123456' } };
    await Promise.all([store.save('users', users), store.save('settings', settings)]);
    assert.equal(mock.calls.filter((c) => c.action === 'write').length, 1, 'nearby saves batched into one call');
    const raw = JSON.stringify(mock.records);
    for (const secret of ['Private Owner', 'Private Brand', 'salt:hash', '#123456']) assert.ok(!raw.includes(secret), `${secret} must be encrypted`);
    const again = await new AppsScriptStore({ url: mock.url, secret: SECRET }).read();
    assert.deepEqual(again.users, users); assert.deepEqual(again.settings, settings);
    await assert.rejects(new AppsScriptStore({ url: mock.url, secret: 'another-secret-value-123' }).read(), /unauthorized/);
    mock.failWrites(2);
    await store.save('settings', { brand: 'Retried' });
    assert.equal((await store.read()).settings.brand, 'Retried', '503 is retried');
    assert.throws(() => new AppsScriptStore({ url: 'https://evil.example.com/exec', secret: SECRET }), /script\.google\.com/);
    assert.throws(() => new AppsScriptStore({ url: mock.url, secret: 'short' }), /16 characters/);
  } finally { await mock.close(); }
});

async function startServer(env) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '0', RENDER: '', APPS_SCRIPT_ALLOW_LOCAL: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', (d) => { log += d; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Startup timeout: ' + log)); }, 20000);
    child.stdout.on('data', (d) => { log += d; const m = log.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Exited ${code}: ${log}`)); });
  });
  return { base, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

test('in-app wizard: test + migrate, then restart on EMPTY disk keeps users & settings (Render redeploy)', async () => {
  const mock = await startMockAppsScript({ secret: SECRET });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-as-'));
  let server;
  try {
    const salt = 'salt1';
    const users = [{ username: 'owner', name: 'Owner', role: 'admin', approved: true, password: `${salt}:${crypto.scryptSync('owner-password', salt, 64).toString('hex')}`, permissions: [] }];
    await fs.writeFile(path.join(dir, 'users.json'), JSON.stringify(users));
    server = await startServer({ DATA_DIR: dir, STORAGE_BACKEND: 'files', APPS_SCRIPT_URL: '', ADMIN_USER: '', ADMIN_PASSWORD: '' });
    let cookie = '';
    const call = async (route, method = 'GET', body) => {
      const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { res, json: await res.json().catch(() => ({})) };
    };
    const login = await call('/api/auth/login', 'POST', { username: 'owner', password: 'owner-password' });
    assert.equal(login.res.status, 200); cookie = login.res.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/api/settings', 'PUT', { settings: { brand: 'Before Cloud' } })).res.status, 200);
    const code = await call('/api/storage/apps-script');
    assert.match(code.json.code, /PASTE_A_LONG_RANDOM_SECRET_HERE/);
    assert.equal((await call('/api/storage/test', 'POST', { url: mock.url, secret: 'wrong-secret-wrong-secret' })).res.status, 502);
    const t = await call('/api/storage/test', 'POST', { url: mock.url, secret: SECRET });
    assert.equal(t.json.ok, true); assert.equal(t.json.hasData, false);
    const mig = await call('/api/storage/migrate', 'POST', { url: mock.url, secret: SECRET });
    assert.equal(mig.res.status, 200, JSON.stringify(mig.json)); assert.equal(mig.json.users, 1);
    assert.equal((await call('/api/storage/migrate', 'POST', { url: mock.url, secret: SECRET })).res.status, 409, 'never overwrites silently');
    await server.stop();

    // Render redeploy: brand-new empty disk + the two env variables.
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-as-empty-'));
    const env = { DATA_DIR: empty, STORAGE_BACKEND: '', APPS_SCRIPT_URL: mock.url, APPS_SCRIPT_SECRET: SECRET, ADMIN_USER: '', ADMIN_PASSWORD: '', RENDER: 'true' };
    server = await startServer(env);
    const me = await call('/api/auth/me');
    assert.equal(me.res.status, 200, 'session cookie survived'); assert.equal(me.json.settings.brand, 'Before Cloud');
    assert.equal((await call('/api/settings', 'PUT', { settings: { brand: 'After Cloud' } })).res.status, 200);
    const health = (await call('/api/health')).json;
    assert.equal(health.storage.backend, 'appsscript'); assert.equal(health.storage.durable, true); assert.equal(health.storage.warning, null);
    await server.stop();
    await fs.rm(empty, { recursive: true, force: true });
    const empty2 = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-as-empty-'));
    server = await startServer({ ...env, DATA_DIR: empty2 });
    assert.equal((await call('/api/auth/me')).json.settings.brand, 'After Cloud');
    assert.ok(!JSON.stringify(mock.records).includes('After Cloud'), 'stored encrypted');
    await fs.rm(empty2, { recursive: true, force: true });
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
