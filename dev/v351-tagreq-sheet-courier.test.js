/* 🧩🚚 v3.60 — Tag Request sheet grouped agent classes + courier naam.
 *
 *   • Sheet default = rowMode 'agent-class-gap' (har agent ki class rows saath, beech me 1 blank spacer row)
 *     aur compact column set jisme 'courier' bhi hai.
 *   • Purani (v1) config ek baar migrate hoti hai — class-wise lambi sheet apne aap chhoti ho jaati hai.
 *   • 🚚 Courier: request ke saath save, list me dikhta hai, admin badal sakta hai, sheet me column.
 *   • Employee link (/api/public/tag-request) courier list expose karta hai.
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

const rows = () => ([
  { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC4', last: 40, cur: 25, stock: 3, suggestNet: 22, sugGross: 25, approved: 25 },
  { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC6', last: 5, cur: 4, stock: 0, suggestNet: 4, sugGross: 4, approved: 4 },
  { agentId: '2002', agentName: 'Priya Verma', tl: 'TL Two', channel: 'gv', cls: 'VC4', last: 10, cur: 12, stock: 8, suggestNet: 6, sugGross: 9, approved: 9 }
]);

test('v3.51 — sheet ek agent = ek chhoti row (classes merged) + 🚚 courier column', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-v351-sheet-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const admin = (await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).cookie;

    // 1) default config hi chhota hai — agent mode + compact columns (+ courier)
    const cfg = await jsonCall(server.base, '/api/tag-request-sheet', 'GET', undefined, admin);
    assert.equal(cfg.res.status, 200, JSON.stringify(cfg.json));
    assert.equal(cfg.json.config.rowMode, 'agent-class-gap', 'default ab agent class rows + blank spacer hai');
    assert.equal(cfg.json.config.v, 6, 'Item Name sheet-column migration version');
    assert.equal(cfg.json.config.onSubmit, false, 'submit par sheet entry OFF');
    assert.equal(cfg.json.config.onStatus, true, 'approval sync enabled');
    assert.ok(cfg.json.config.columns.includes('cls'), 'classes cell');
    assert.ok(cfg.json.config.columns.includes('courier'), '🚚 courier column');
    assert.ok(cfg.json.config.columns.includes('itemName'), '📦 Item Name column');
    assert.equal(cfg.json.fields.itemName, 'Item Name');
    assert.ok(!cfg.json.config.columns.includes('remark'), 'lambi purani columns default me nahi');
    assert.equal(cfg.json.fields.courier, 'Courier');

    // 2) employee link par courier list + toggle
    const pub = await jsonCall(server.base, '/api/public/tag-request');
    assert.equal(pub.json.config.askCourier, true);
    assert.deepEqual(pub.json.config.couriers, ['Delhivery', 'DTDC'], 'default courier naam');

    // 3) config ON (agent mode) → request bhejo courier ke saath
    await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', {
      config: { enabled: true, tab: 'Tag Dispatch', onSubmit: true, onStatus: false, rowMode: 'agent', columns: ['agent', 'cls', 'approved', 'courier'] }
    }, admin);
    const created = await jsonCall(server.base, '/api/tag-requests', 'POST', { note: 'v3.70.2', courier: 'DTDC', itemName: 'Matarial', rows: rows() }, admin);
    assert.equal(created.res.status, 201, JSON.stringify(created.json));
    await sleep(700);
    assert.equal(mock.appends.length, 0, 'Pending submission par sheet append nahi');

    // Admin approval only: sheet me sirf 2 rows (Rahul ek + Priya ek).
    const reqId = created.json.request && created.json.request.id;
    const approved = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(reqId)}`, 'PUT', { status: 'approved' }, admin);
    assert.equal(approved.res.status, 200, JSON.stringify(approved.json));
    await sleep(1300);
    const tab = mock.appends.find((t) => t.tab === 'Tag Dispatch');
    assert.ok(tab, 'approval ke baad sheet push hui');
    assert.deepEqual(tab.header, ['Agent', 'Tag Class', 'Approved qty', 'Courier']);
    assert.equal(tab.rows.length, 2, 'ek agent = ek row (pehle 3 rows ban rahi thi)');
    assert.deepEqual(tab.rows[0], ['Rahul Sharma', 'VC4 25 · VC6 4', 29, 'DTDC']);
    assert.deepEqual(tab.rows[1], ['Priya Verma', 'VC4 9', 9, 'DTDC']);

    // 5) admin list me courier dikhta hai + admin badal sakta hai
    const list = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin);
    const found = list.json.requests.find((r) => r.id === reqId);
    assert.ok(found, 'request list me mili');
    assert.equal(found.courier, 'DTDC');
    assert.equal(found.itemName, 'Matarial', 'Item Name saved with request');
    const upd = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(reqId)}`, 'PUT', { courier: 'Delhivery', itemName: 'Biomatric Device' }, admin);
    assert.equal(upd.json.request.courier, 'Delhivery', 'admin courier badal sakta hai');
    assert.equal(upd.json.request.itemName, 'Biomatric Device', 'admin Item Name badal sakta hai');
    const upd2 = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(reqId)}`, 'PUT', { courier: '' }, admin);
    assert.ok(!upd2.json.request.courier, 'courier hata bhi sakta hai');

    // 6) legacy (v1) config ek hi baar migrate hoti hai — class mode + lambe columns se chhota set
    const cfg2 = await jsonCall(server.base, '/api/tag-request-sheet', 'GET', undefined, admin);
    assert.equal(cfg2.json.config.rowMode, 'agent-class-gap');
  } finally {
    if (server) await server.stop();
    await mock.close();
  }
});

test('v3.51 — purani (v1) class-wise config ek baar me chhote agent-mode par migrate hoti hai', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-v351-migrate-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  // v1 jaisi purani config pehle se DATA_DIR me daal do (jaise live site par padi hai).
  await fs.writeFile(path.join(dir, 'notifications.json'), JSON.stringify({
    items: [], watch: {},
    workspace: {
      tagRequests: [],
      tagRequestSheet: {
        enabled: false, tab: 'Tag Requests', sheetLink: '', spreadsheetId: '', onSubmit: true, onStatus: true, rowMode: 'class',
        columns: ['date', 'time', 'by', 'agentId', 'agent', 'agentMobile', 'agentAddress', 'agentPincode', 'tl', 'channel', 'cls', 'stock', 'cur', 'priority', 'approved', 'remark', 'status']
      }
    }
  }, null, 2), 'utf8');
  let server;
  try {
    server = await startServer(dir, mock.url);
    const admin = (await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).cookie;
    const cfg = await jsonCall(server.base, '/api/tag-request-sheet', 'GET', undefined, admin);
    assert.equal(cfg.json.config.rowMode, 'agent-class-gap', 'legacy config uses the current agent-group layout');
    assert.equal(cfg.json.config.v, 6, 'Item Name sheet-column migration migrated');
    assert.equal(cfg.json.config.onSubmit, false);
    assert.equal(cfg.json.config.onStatus, true);
    assert.ok(cfg.json.config.columns.includes('courier'), 'naya compact column set');
    assert.ok(!cfg.json.config.columns.includes('remark'), 'purani lambi columns hata di');
  } finally {
    if (server) await server.stop();
    await mock.close();
  }
});
