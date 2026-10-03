// ⏪ v3.48 — "purani settings / users / passwords wapas lao" regression tests.
// Scenario: sheet me data save tha → phir sheet/APP_STORAGE defaults (1 admin) se overwrite ho gaya
// (naye Apps Script deploy / nayi sheet ke baad yahi hota hai). Recovery se sab wapas milna chahiye.
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

const pw = (password, salt = 'salt1') => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;

async function startServer(env) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '0', RENDER: '', APPS_SCRIPT_ALLOW_LOCAL: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', (d) => { log += d; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Startup timeout: ' + log)); }, 25000);
    child.stdout.on('data', (d) => { log += d; const m = log.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Exited ${code}: ${log}`)); });
  });
  return { base, log: () => log, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}
function client(base) {
  let cookie = '';
  return {
    async call(route, method = 'GET', body) {
      const res = await fetch(base + route, { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const json = await res.json().catch(() => ({}));
      if (method === 'POST' && route === '/api/auth/login' && res.ok) cookie = (res.headers.get('set-cookie') || '').split(';')[0];
      return { res, json };
    },
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; }
  };
}

test('sheet history: overwrite ke baad bhi purani save milti hai aur users + passwords wapas aa jaate hain', async () => {
  const mock = await startMockAppsScript({ secret: SECRET });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-rec-'));
  let server;
  try {
    // 1) Pehle server: 2 users + settings, phin Google Sheet (APP_STORAGE) me copy.
    const users = [
      { username: 'owner', name: 'Owner', role: 'admin', approved: true, permissions: [], password: pw('owner-pass'), createdAt: new Date().toISOString() },
      { username: 'agent1', name: 'Field Agent', role: 'user', approved: true, permissions: ['home'], password: pw('agent-pass'), createdAt: new Date().toISOString() }
    ];
    await fs.writeFile(path.join(dir, 'users.json'), JSON.stringify(users));
    server = await startServer({ DATA_DIR: dir, STORAGE_BACKEND: 'files', APPS_SCRIPT_URL: '', ADMIN_USER: '', ADMIN_PASSWORD: '' });
    let c = client(server.base);
    assert.equal((await c.call('/api/auth/login', 'POST', { username: 'owner', password: 'owner-pass' })).res.status, 200);
    assert.equal((await c.call('/api/settings', 'PUT', { settings: { brand: 'Purani Setting' } })).res.status, 200);
    assert.equal((await c.call('/api/storage/migrate', 'POST', { url: mock.url, secret: SECRET })).res.status, 200);
    await server.stop();

    // 2) Loss: kisi ne sheet ke APP_STORAGE ko defaults (sirf 1 admin) se overwrite kar diya.
    const writer = new AppsScriptStore({ url: mock.url, secret: SECRET, batchDelay: 5, wait: async () => {} });
    await writer.save('users', [{ username: 'admin', name: 'Admin', role: 'admin', approved: true, permissions: [], password: pw('admin123'), mustChangePassword: true, createdAt: new Date().toISOString() }]);
    await writer.save('settings', { appName: 'Default App' });
    await writer.flush();

    // 3) Naya deploy: sirf 1 user dikhta hai (yahi problem thi).
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-rec-empty-'));
    server = await startServer({ DATA_DIR: empty, STORAGE_BACKEND: '', APPS_SCRIPT_URL: mock.url, APPS_SCRIPT_SECRET: SECRET, ADMIN_USER: '', ADMIN_PASSWORD: '' });
    c = client(server.base);
    assert.equal((await c.call('/api/health')).json.users, 1, 'sheet me ab sirf 1 (default) user hai');
    assert.equal((await c.call('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' })).res.status, 200);

    // 4) ⏪ Recovery: purani save dhoondo.
    const hist = await c.call('/api/storage/history');
    assert.equal(hist.res.status, 200, JSON.stringify(hist.json));
    const good = (hist.json.snapshots || []).find((s) => s.users === 2);
    assert.ok(good, `2 users wali purani save milni chahiye: ${JSON.stringify(hist.json.snapshots)}`);
    assert.match(good.appName || 'First Forward', /./);
    assert.ok(good.usernames.includes('agent1'), 'usernames preview me purane users dikhte hain');

    // 5) Restore (merge) — purane users + settings + passwords wapas.
    const restored = await c.call('/api/storage/history/restore', 'POST', { at: good.at, usersMode: 'merge', withSettings: true });
    assert.equal(restored.res.status, 200, JSON.stringify(restored.json));
    assert.equal(restored.json.restored.usersAdded, 2, 'owner + agent1 dono wapas add hue');
    assert.equal(restored.json.restored.settingsRestored, true);
    assert.equal((await c.call('/api/health')).json.users, 3, '2 purane users + current admin (lockout guard)');

    // 6) Purana password ab kaam karta hai (password hash bhi wapas aaya).
    const c2 = client(server.base);
    assert.equal((await c2.call('/api/auth/login', 'POST', { username: 'agent1', password: 'agent-pass' })).res.status, 200, 'purana password wapas kaam kare');
    const me = await c2.call('/api/auth/me');
    assert.equal(me.json.settings.brand, 'Purani Setting', 'purani settings wapas aa gayin');

    // 7) Purani sheet se bhi data la sakte hain (alag Apps Script URL) — replace mode me bhi admin safe.
    const old = await startMockAppsScript({ secret: SECRET, spreadsheet: 'Old Sheet' });
    try {
      const oldStore = new AppsScriptStore({ url: old.url, secret: SECRET, batchDelay: 5, wait: async () => {} });
      await oldStore.save('users', [
        { username: 'tl1', name: 'TL One', role: 'user', approved: true, permissions: ['home'], password: pw('tl-pass'), createdAt: new Date().toISOString() },
        { username: 'tl2', name: 'TL Two', role: 'user', approved: true, permissions: ['home'], password: pw('tl2-pass'), createdAt: new Date().toISOString() }
      ]);
      await oldStore.save('settings', { appName: 'Old Sheet App' });
      await oldStore.flush();
      const preview = await c.call('/api/storage/pull', 'POST', { url: old.url, secret: SECRET });
      assert.equal(preview.res.status, 200, JSON.stringify(preview.json));
      assert.equal(preview.json.preview.users, 2, 'doosri sheet ka preview dikhta hai');
      assert.equal(preview.json.preview.appName, 'Old Sheet App');
      const imported = await c.call('/api/storage/pull', 'POST', { url: old.url, secret: SECRET, mode: 'import', usersMode: 'replace', withSettings: false });
      assert.equal(imported.res.status, 200, JSON.stringify(imported.json));
      assert.equal(imported.json.restored.usersAdded, 2);
      const after = await c.call('/api/users');
      const names = (after.json.users || []).map((u) => u.username).sort();
      assert.deepEqual(names, ['admin', 'owner', 'tl1', 'tl2'], 'replace me bhi current admin accounts lockout se bache rahe');
    } finally { await old.close(); }

    await server.stop();
    await fs.rm(empty, { recursive: true, force: true });
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('recovery endpoints admin-only hain aur full backup download hota hai', async () => {
  const mock = await startMockAppsScript({ secret: SECRET });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-rec2-'));
  let server;
  try {
    await fs.writeFile(path.join(dir, 'users.json'), JSON.stringify([
      { username: 'owner', name: 'Owner', role: 'admin', approved: true, permissions: [], password: pw('owner-pass'), createdAt: new Date().toISOString() }
    ]));
    server = await startServer({ DATA_DIR: dir, STORAGE_BACKEND: 'files', APPS_SCRIPT_URL: '', ADMIN_USER: '', ADMIN_PASSWORD: '' });
    const c = client(server.base);
    assert.equal((await c.call('/api/auth/login', 'POST', { username: 'owner', password: 'owner-pass' })).res.status, 200);
    // admin: full backup (users + settings + sessions) milta hai
    const backup = await c.call('/api/storage/backup');
    assert.equal(backup.res.status, 200);
    assert.equal(backup.json.app, 'first-forward-dashboard');
    assert.equal(Array.isArray(backup.json.users), true);
    assert.match(String(backup.res.headers.get('content-disposition') || ''), /attachment/);
    // admin: disk scan
    const scan = await c.call('/api/storage/scan');
    assert.equal(scan.res.status, 200);
    assert.ok(Array.isArray(scan.json.sources));
    // non-admin: sab blocked
    await c.call('/api/users', 'POST', { username: 'plain', name: 'Plain', password: 'plain-pass', role: 'user' });
    const c2 = client(server.base);
    assert.equal((await c2.call('/api/auth/login', 'POST', { username: 'plain', password: 'plain-pass' })).res.status, 200);
    for (const route of ['/api/storage/history', '/api/storage/scan', '/api/storage/backup']) assert.equal((await c2.call(route)).res.status, 403, `${route} admin-only`);
    assert.equal((await c2.call('/api/storage/history/restore', 'POST', { at: 'x' })).res.status, 403);
    assert.equal((await c2.call('/api/storage/pull', 'POST', { url: mock.url, secret: SECRET })).res.status, 403);
    assert.equal((await c2.call('/api/storage/import', 'POST', { payload: { users: [] } })).res.status, 403);
    await server.stop();
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('purana Code.gs (history action nahi) — clear error, chup-chaap fail nahi', async () => {
  const http = await import('node:http');
  const records = {}; // purana Code.gs: read/write to hai, par 'history' action nahi
  const old = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch { /* ignore */ }
      let out;
      if (body.secret !== SECRET) out = { ok: false, error: 'unauthorized (secret mismatch)' };
      else if (body.action === 'ping') out = { ok: true, tab: 'APP_STORAGE', spreadsheet: 'Old Code Sheet' };
      else if (body.action === 'read') out = { ok: true, records };
      else if (body.action === 'write') { Object.assign(records, body.records || {}); out = { ok: true, savedAt: new Date().toISOString(), kinds: Object.keys(body.records || {}) }; }
      else out = { ok: false, error: 'unknown action' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => old.listen(0, '127.0.0.1', r));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-rec3-'));
  let server;
  try {
    server = await startServer({ DATA_DIR: dir, STORAGE_BACKEND: '', APPS_SCRIPT_URL: `http://127.0.0.1:${old.address().port}/macros/s/old/exec`, APPS_SCRIPT_SECRET: SECRET, ADMIN_USER: '', ADMIN_PASSWORD: '' });
    const c = client(server.base);
    assert.equal((await c.call('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' })).res.status, 200);
    const hist = await c.call('/api/storage/history');
    assert.equal(hist.res.status, 400, 'purane Code.gs par saaf 400 + Hindi message');
    assert.match(hist.json.error, /Code\.gs deploy nahi hua|history action missing/);
    // boot-time hint (20s) fail hone par bhi health me wajah dikhe — "pending" par atki rahe to admin ko kuch samajh nahi aata
    let rec = null;
    for (let i = 0; i < 20 && !rec; i++) { await new Promise((r) => setTimeout(r, 1500)); const h = await c.call('/api/health'); if (h.json.storage && h.json.storage.recoverable && h.json.storage.recoverable.error) rec = h.json.storage.recoverable; }
    assert.ok(rec && /Code\.gs|history action/.test(rec.error), `health me error dikhe: ${JSON.stringify(rec)}`);
    await server.stop();
  } finally {
    if (server) await server.stop();
    old.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
