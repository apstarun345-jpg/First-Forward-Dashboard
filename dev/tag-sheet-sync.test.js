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

const requestBody = () => ({
  note: 'sheet sync test',
  rows: [
    { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC4', last: 40, cur: 25, stock: 3, cover: 1.4, priority: 'High', growth: -37.5, sugNet: 22, sugGross: 25, approved: 25, remark: 'urgent' },
    { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC6', last: 5, cur: 4, stock: 0, cover: 0, priority: 'High', growth: -20, sugNet: 4, sugGross: 4, approved: 4, remark: '' },
    { agentId: '2002', agentName: 'Priya Verma', tl: 'TL Two', channel: 'gv', cls: 'VC4', last: 10, cur: 12, stock: 8, cover: 5, priority: 'Medium', growth: 20, sugNet: 6, sugGross: 9, approved: 9, remark: '' }
  ],
  tls: [{ name: 'TL One', channel: 'ff', stockVc4: 12, curVc4: 60, lastVc4: 80, priority: 'High', reqApproved: 29, agents: 2, sugNet: 28, sugGross: 31, cover: 1.4 }]
});

test('tag request sheet sync — config, auto append on submit/status, manual push, row modes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-tagsheet-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const login = await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' });
    const admin = login.cookie;

    // 1) default config + connected (mock Apps Script URL set hai)
    const cfg0 = await jsonCall(server.base, '/api/tag-request-sheet', 'GET', undefined, admin);
    assert.equal(cfg0.res.status, 200, JSON.stringify(cfg0.json));
    assert.equal(cfg0.json.config.enabled, false);
    assert.equal(cfg0.json.connected, true, 'Apps Script URL configured hote hi connected dikhna chahiye');
    assert.ok(cfg0.json.fields.approved, 'fields list me approved column hona chahiye');

    // non-admin ko 403
    await jsonCall(server.base, '/api/users', 'POST', { username: 'member', name: 'Member', password: 'member-pass-1', role: 'user', permissions: ['home', 'tagRequest'] }, admin);
    const member = (await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'member', password: 'member-pass-1' })).cookie;
    const denied = await jsonCall(server.base, '/api/tag-request-sheet', 'GET', undefined, member);
    assert.equal(denied.res.status, 403, 'sheet config sirf admin ke liye hai');

    // 2) config save — enable + custom tab + column subset + rowMode class
    const put = await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', {
      config: { enabled: true, tab: 'Tag Dispatch', onSubmit: true, onStatus: true, rowMode: 'class', columns: ['date', 'by', 'agent', 'tl', 'cls', 'approved', 'status'] }
    }, admin);
    assert.equal(put.res.status, 200, JSON.stringify(put.json));
    assert.equal(put.json.config.tab, 'Tag Dispatch');
    assert.equal(put.json.config.onSubmit, false, 'Pending submit par sheet sync forcibly OFF hai');
    assert.equal(put.json.config.onStatus, true, 'Approval transition sync enabled hai');
    assert.deepEqual(put.json.config.columns, ['date', 'by', 'agent', 'tl', 'cls', 'approved', 'status']);

    // 3) connection test
    const tst = await jsonCall(server.base, '/api/tag-request-sheet/test', 'POST', {}, admin);
    assert.equal(tst.res.status, 200, JSON.stringify(tst.json));
    assert.equal(tst.json.ok, true);

    // 4) Pending submission must not create any Google Sheet rows.
    const created = await jsonCall(server.base, '/api/tag-requests', 'POST', requestBody(), admin);
    assert.equal(created.res.status, 201, JSON.stringify(created.json));
    const reqId = created.json.request.id;
    await sleep(700);
    let tab = mock.appends.find((t) => t.tab === 'Tag Dispatch');
    assert.equal(tab ? tab.rows.length : 0, 0, 'Pending submit par koi Sheet rows nahi');

    // 5) Pending → Approved: exactly one append (3 class rows).
    await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(reqId)}`, 'PUT', { status: 'approved' }, admin);
    await sleep(1200);
    tab = mock.appends.find((t) => t.tab === 'Tag Dispatch');
    assert.ok(tab, `sheet me "Tag Dispatch" tab banana chahiye — got ${JSON.stringify(mock.appends.map((t) => t.tab))}`);
    assert.deepEqual(tab.header, ['Date', 'By', 'Agent', 'TL', 'Tag Class', 'Approved qty', 'Status']);
    assert.equal(tab.rows.length, 3, 'approval par har agent × class ki alag row');
    assert.deepEqual(tab.rows[0].slice(2, 5), ['Rahul Sharma', 'TL One', 'VC4']);
    assert.equal(tab.rows[0][5], 25);

    // 6) Manual duplicate push while still Approved is blocked.
    const manual = await jsonCall(server.base, '/api/tag-request-sheet/push', 'POST', { id: reqId }, admin);
    assert.equal(manual.res.status, 409, JSON.stringify(manual.json));
    assert.equal(tab.rows.length, 3, 'manual push duplicate ko rokta hai');

    // 7) Approved → Dispatched does not append the same request again.
    await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(reqId)}`, 'PUT', { status: 'dispatched' }, admin);
    await sleep(900);
    tab = mock.appends.find((t) => t.tab === 'Tag Dispatch');
    assert.equal(tab.rows.length, 3, 'Dispatched par second entry nahi honi chahiye');

    // 8) Request row mode also waits for approval and writes only one aggregate row.
    await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', { config: { rowMode: 'request', columns: ['by', 'agent', 'cls', 'approved'] } }, admin);
    const created2 = await jsonCall(server.base, '/api/tag-requests', 'POST', requestBody(), admin);
    assert.equal(created2.res.status, 201, JSON.stringify(created2.json));
    const reqId2 = created2.json.request.id;
    await sleep(700);
    tab = mock.appends.find((t) => t.tab === 'Tag Dispatch');
    assert.equal(tab.rows.length, 3, 'nayi request Pending rehti hai, Sheet unchanged');
    await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(reqId2)}`, 'PUT', { status: 'approved' }, admin);
    await sleep(1200);
    tab = mock.appends.find((t) => t.tab === 'Tag Dispatch');
    assert.equal(tab.rows.length, 4, 'request mode approval par ek total row');
    assert.equal(tab.rows[3][3], 38, 'total approved = 25 + 4 + 9');

    // 9) Sync OFF means even approval cannot append.
    await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', { config: { enabled: false } }, admin);
    const created3 = await jsonCall(server.base, '/api/tag-requests', 'POST', requestBody(), admin);
    assert.equal(created3.res.status, 201, JSON.stringify(created3.json));
    const reqId3 = created3.json.request.id;
    await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(reqId3)}`, 'PUT', { status: 'approved' }, admin);
    await sleep(900);
    tab = mock.appends.find((t) => t.tab === 'Tag Dispatch');
    assert.equal(tab.rows.length, 4, 'sync OFF me approval par bhi rows nahi aani chahiye');

    // 10) Manual push while OFF returns a clear error.
    const offPush = await jsonCall(server.base, '/api/tag-request-sheet/push', 'POST', { id: reqId2 }, admin);
    assert.equal(offPush.res.status, 400, 'sync OFF par manual push reject hona chahiye');
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
