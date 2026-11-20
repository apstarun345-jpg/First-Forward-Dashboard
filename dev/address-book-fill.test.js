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



test('address book — tag request edit + search KPI', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-ab-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const admin = (await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).cookie;
    const ag = (n, id, mob, addr, pin) => ({ agentId: id, agentName: n, tl: 'TL One', channel: 'ff', mobile: mob, address: addr, pincode: pin, rows: [{ cls: 'VC4', requested: 5, approved: 5 }] });
    const c = await jsonCall(server.base, '/api/tag-requests', 'POST', { employee: { name: 'Emp' }, agents: [ag('Punam Chand', '29606271', '', 'Courier office Rau circle Indore', ''), ag('Rahul Sahu', '32603407', '8305115480', 'Rahul Tea Stall Korba Chhattisgarh 495445', '495445')] }, admin);
    assert.equal(c.res.status, 201, JSON.stringify(c.json));
    const s1 = await jsonCall(server.base, '/api/address-book?q=Punam%20Chand%0ARahul%20Sahu%0AGhost%20Person&fields=name', 'GET', undefined, admin);
    assert.equal(s1.res.status, 200, JSON.stringify(s1.json));
    assert.ok(s1.json.skpi, 'search KPI');
    assert.equal(s1.json.skpi.total, 2);
    assert.equal(s1.json.skpi.noMobile, 1);
    assert.equal(s1.json.skpi.noPin, 1);
    assert.equal(s1.json.skpi.terms, 3);
    assert.equal(s1.json.skpi.found, 2);
    const nom = await jsonCall(server.base, '/api/address-book?q=Punam%20Chand%0ARahul%20Sahu&fields=name&kf=nomobile', 'GET', undefined, admin);
    assert.equal(nom.json.rows.length, 1);
    const row = nom.json.rows[0];
    assert.equal(row.src, 'Tag request');
    const ed = await jsonCall(server.base, '/api/address-book/save', 'POST', { key: row.key, name: row.name, id: row.id, tl: row.tl, channel: row.channel, mobile: '8625819929', address: 'Courier office IF1136 Rau circle Indore 452012', pincode: '' }, admin);
    assert.equal(ed.res.status, 200, JSON.stringify(ed.json));
    const s2 = await jsonCall(server.base, '/api/address-book?q=Punam%20Chand&fields=name', 'GET', undefined, admin);
    assert.equal(s2.json.rows[0].mobile, '8625819929');
    assert.equal(s2.json.rows[0].pincode, '452012', 'pincode address se');
    assert.equal(s2.json.skpi.noMobile, 0);
    const all = await jsonCall(server.base, '/api/address-book', 'GET', undefined, admin);
    assert.equal(all.json.skpi, null, 'bina search skpi nahi');
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
