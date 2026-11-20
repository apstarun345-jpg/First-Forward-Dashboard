/* 📗 Tag Request → Google Sheet sync (v3.25) regression.
 *
 * Contract lock (server.js + google-apps-script/Code.gs 'appendrows'):
 *   • admin GET/PUT /api/tag-request-sheet — config durable (notify kind),
 *   • Pending submit never appends to Tag Requests sheet,
 *   • first transition to Approved appends exactly once; Dispatched/status edits do not append,
 *   • manual push is limited to approved requests and blocks duplicates,
 *   • rowMode agent/request — aggregation sahi, columns config ke hisaab se.
 */
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


const reqBody = () => ({
  note: 'gv split test',
  rows: [
    { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC4', last: 40, cur: 25, stock: 3, cover: 1.4, priority: 'High', growth: -37.5, sugNet: 12, sugGross: 15, approved: 25, requested: 25 },
    { agentId: '2002', agentName: 'Priya Verma', tl: 'TL Two', channel: 'gv', cls: 'VC4', last: 10, cur: 12, stock: 8, cover: 5, priority: 'Medium', growth: 20, sugNet: 6, sugGross: 9, approved: 9, requested: 9 }
  ],
  tls: []
});

test('tag request sheet — GV ke liye alag sheet/tab/columns', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-tagsheet-gv-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const admin = (await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).cookie;
    const cfg0 = await jsonCall(server.base, '/api/tag-request-sheet', 'GET', undefined, admin);
    assert.equal(cfg0.json.gvConfig.separate, false, 'GV separate default OFF');

    // FF config + GV separate OFF → dono rows FF tab me
    await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', { config: { enabled: true, tab: 'FF Tab', rowMode: 'class', columnMap: { agent: 'A', cls: 'B', approved: 'C' } } }, admin);
    let c = await jsonCall(server.base, '/api/tag-requests', 'POST', reqBody(), admin);
    await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(c.json.request.id)}`, 'PUT', { status: 'approved' }, admin);
    await sleep(1300);
    const ffTab = () => mock.appends.find((t) => t.tab === 'FF Tab');
    assert.equal(ffTab().rows.length, 2, 'separate OFF: FF + GV dono ek hi (FF) tab me');

    // GV separate ON: alag sheet id + tab + columns
    const put = await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', { gv: { separate: true, enabled: true, sheetLink: 'https://docs.google.com/spreadsheets/d/GVSHEETID1234567890abcdef/edit', tab: 'GV Tab', rowMode: 'class', columnMap: { cls: 'A', agent: 'C', approved: 'E' } } }, admin);
    assert.equal(put.res.status, 200, JSON.stringify(put.json));
    assert.equal(put.json.gvConfig.separate, true);
    assert.equal(put.json.gvConfig.tab, 'GV Tab');
    assert.equal(put.json.config.tab, 'FF Tab', 'FF config GV save se nahi badli');
    c = await jsonCall(server.base, '/api/tag-requests', 'POST', reqBody(), admin);
    await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(c.json.request.id)}`, 'PUT', { status: 'approved' }, admin);
    await sleep(1800);
    assert.equal(ffTab().rows.length, 3, 'FF row FF tab me (+1)');
    assert.equal(ffTab().rows[2][0], 'Rahul Sharma');
    const gvTab = mock.appends.find((t) => t.tab === 'GV Tab');
    assert.ok(gvTab, `GV Tab banna chahiye — got ${JSON.stringify(mock.appends.map((t) => t.tab))}`);
    assert.equal(gvTab.spreadsheetId, 'GVSHEETID1234567890abcdef', 'GV rows GV wali alag sheet me');
    assert.equal(gvTab.rows.length, 1, 'GV tab me sirf GV row');
    assert.equal(gvTab.rows[0].filter((x) => x !== '' && x != null).includes('Priya Verma'), true);

    // FF save GV config ko nahi todta, aur GV OFF karne par GV rows nahi jati
    await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', { gv: { enabled: false } }, admin);
    c = await jsonCall(server.base, '/api/tag-requests', 'POST', reqBody(), admin);
    await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(c.json.request.id)}`, 'PUT', { status: 'approved' }, admin);
    await sleep(1500);
    assert.equal(ffTab().rows.length, 4, 'GV OFF hone par bhi FF part jata hai');
    assert.equal(gvTab.rows.length, 1, 'GV sync OFF: GV tab me nayi row nahi');
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
