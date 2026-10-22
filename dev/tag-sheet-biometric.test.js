/* 🔤 Sheet direct entry by COLUMN LETTER (Date → A, Agent → C …) instead of drag order. */
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


const agentsBody = (itemName, withQty) => ({
  itemName, serialNumber: 'SN-1234', deviceName: 'Mantra MFS100', materialDescription: 'Cable',
  employee: { name: 'Emp One' }, note: 'bio test',
  agents: [{ agentId: '1001', name: 'Rahul Sharma', mobile: '9876543210', address: 'House 1 Street 2 Area', pincode: '110001', channel: 'ff', tl: 'TL One',
    rows: withQty ? [{ cls: 'VC4', approved: 5, requested: 5, last: 1, cur: 1, stock: 1 }] : [] }]
});

for (const [label, item, qty] of [['biometric only', 'Biomatric Device', false], ['fastag + biometric', 'FASTag + Biomatric Device', true]]) {
  test(`sheet entry: ${label} reaches the mapped Biometric columns`, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-bio-'));
    const mock = await startMockAppsScript({ secret: SECRET });
    let server;
    try {
      server = await startServer(dir, mock.url);
      const admin = (await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).cookie;
      const put = await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', { config: { enabled: true, tab: 'Bio', rowMode: 'agent-class-gap', columnMap: { date: 'A', agent: 'B', cls: 'C', approved: 'D', itemName: 'E', serialNumber: 'F', deviceName: 'G', materialDescription: 'H' } } }, admin);
      assert.equal(put.res.status, 200, JSON.stringify(put.json));
      const created = await jsonCall(server.base, '/api/tag-requests', 'POST', agentsBody(item, qty), admin);
      assert.equal(created.res.status, 201, JSON.stringify(created.json));
      const ap = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(created.json.request.id)}`, 'PUT', { status: 'approved' }, admin);
      await sleep(1500);
      const tab = mock.appends.find((t) => t.tab === 'Bio');
      assert.ok(tab, 'entry reached the Bio tab ' + JSON.stringify(ap.json).slice(0, 300));
      assert.equal(tab.rows.length >= 1, true);
      const row = tab.rows.find((r) => r.some((c) => c === 'SN-1234'));
      assert.ok(row, 'serial number written ' + JSON.stringify(tab.rows));
      assert.ok(row.includes('Mantra MFS100') && row.includes('Rahul Sharma'));
      assert.deepEqual(tab.positions, [0, 1, 2, 3, 4, 5, 6, 7]);
    } finally {
      if (server) await server.stop();
      await mock.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
