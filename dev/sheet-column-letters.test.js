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

const requestBody = () => ({
  note: 'sheet sync test',
  rows: [
    { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC4', last: 40, cur: 25, stock: 3, cover: 1.4, priority: 'High', growth: -37.5, sugNet: 22, sugGross: 25, approved: 25, remark: 'urgent' },
    { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC6', last: 5, cur: 4, stock: 0, cover: 0, priority: 'High', growth: -20, sugNet: 4, sugGross: 4, approved: 4, remark: '' },
    { agentId: '2002', agentName: 'Priya Verma', tl: 'TL Two', channel: 'gv', cls: 'VC4', last: 10, cur: 12, stock: 8, cover: 5, priority: 'Medium', growth: 20, sugNet: 6, sugGross: 9, approved: 9, remark: '' }
  ],
  tls: [{ name: 'TL One', channel: 'ff', stockVc4: 12, curVc4: 60, lastVc4: 80, priority: 'High', reqApproved: 29, agents: 2, sugNet: 28, sugGross: 31, cover: 1.4 }]
});


test('sheet entry: admin maps fields to column letters; entry sends exact positions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-colletters-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const admin = (await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).cookie;
    const dup = await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', { config: { columnMap: { date: 'A', agent: 'a' } } }, admin);
    assert.equal(dup.res.status, 400, 'same letter twice is rejected');
    const bad = await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', { config: { columnMap: { date: '1' } } }, admin);
    assert.equal(bad.res.status, 400, 'invalid letter is rejected');
    const put = await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', { config: { enabled: true, tab: 'Letters', rowMode: 'class', columnMap: { approved: 'F', date: 'a', agent: 'C' } } }, admin);
    assert.equal(put.res.status, 200, JSON.stringify(put.json));
    assert.deepEqual(put.json.config.columnMap, { approved: 'F', date: 'A', agent: 'C' });
    assert.deepEqual(put.json.config.columns, ['date', 'agent', 'approved'], 'columns follow letter order');
    const created = await jsonCall(server.base, '/api/tag-requests', 'POST', requestBody(), admin);
    assert.equal(created.res.status, 201, JSON.stringify(created.json));
    await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(created.json.request.id)}`, 'PUT', { status: 'approved' }, admin);
    await sleep(1300);
    const tab = mock.appends.find((t) => t.tab === 'Letters');
    assert.ok(tab, 'entry reached the Letters tab');
    assert.deepEqual(tab.positions, [0, 2, 5], 'Date→A, Agent→C, Approved→F');
    assert.deepEqual(tab.header, ['Date', 'Agent', 'Approved qty']);
    assert.equal(tab.rows.length, 3);
    assert.equal(tab.rows[0][1], 'Rahul Sharma');
    assert.equal(tab.rows[0][2], 25);
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
