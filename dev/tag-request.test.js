/* 🏷️ IDFC Agents Tag Request (v3.24) regression.
 *
 * Ye test server-side contract lock karta hai (client page tagRequest.js isi par chalti hai):
 *   • form submit  → POST /api/tag-requests (rows + TL rollup save, total khud nikalta hai),
 *   • admin feed   → type 'request' notification + route key + deep link (prefs me ON hona chahiye),
 *   • admin action → PUT status / qty edit (total re-calculate), DELETE,
 *   • permission   → sirf granted users, user ko sirf apni requests,
 *   • durability   → restart ke baad bhi requests bachi rehti hain ('notify' kind me store hoti hain —
 *                    koi naya storage kind nahi, isliye Apps Script redeploy ki zaroorat nahi).
 */
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
  return out.cookie;
}

const requestBody = () => ({
  note: 'urgent — kal dispatch chahiye',
  rows: [
    { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC4', last: 40, cur: 25, stock: 3, cover: 1.4, priority: 'High', growth: -37.5, sugNet: 22, sugGross: 25, approved: 25, remark: 'urgent' },
    { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC6', last: 5, cur: 4, stock: 0, cover: 0, priority: 'High', growth: -20, sugNet: 4, sugGross: 4, approved: 4, remark: '' }
  ],
  tls: [{ name: 'TL One', channel: 'ff', stockVc4: 12, curVc4: 60, lastVc4: 80, priority: 'High', reqApproved: 29, agents: 3, sugNet: 28, sugGross: 31, cover: 1.4 }]
});

test('tag request — submit, admin feed, edit, permissions aur restart ke baad durability', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-tagreq-'));
  let server;
  try {
    server = await startServer(dir);
    const admin = await login(server.base, 'owner', 'initial-password');

    // khaali state
    const empty = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin);
    assert.equal(empty.res.status, 200, JSON.stringify(empty.json));
    assert.deepEqual(empty.json.requests, []);
    assert.equal(empty.json.admin, true);

    // 1) submit — total khud nikalna chahiye (25 + 4 = 29), note + TL rollup save
    const created = await jsonCall(server.base, '/api/tag-requests', 'POST', requestBody(), admin);
    assert.equal(created.res.status, 201, JSON.stringify(created.json));
    const req = created.json.request;
    assert.match(req.id, /^\d{4}$/);
    assert.equal(req.status, 'pending');
    assert.equal(req.total, 29, 'total = approved qty ka sum');
    assert.equal(req.rows.length, 2);
    assert.equal(req.tls.length, 1);
    assert.equal(req.tls[0].sugNet, 28, 'TL suggested qty (stock ke baad) bhi save honi chahiye');
    assert.equal(req.tls[0].sugGross, 31, 'TL suggested qty (w/o stock) bhi save honi chahiye');
    assert.equal(req.rows[0].growth, -37.5, 'growth level row me save hota hai');
    assert.equal(req.rows[0].cover, 1.4, 'cover days row me save hota hai');
    assert.equal(req.note, 'urgent — kal dispatch chahiye');

    // 2) admin feed — 'request' type ka notification + route + deep link
    const feed = await jsonCall(server.base, '/api/notifications', 'GET', undefined, admin);
    const alert = (feed.json.items || []).find((i) => i.type === 'request' && /Tag request/.test(i.title));
    assert.ok(alert, `admin feed me request notification chahiye — got ${JSON.stringify((feed.json.items || []).map((i) => i.type))}`);
    assert.equal(alert.routeKey, 'tagRequest');
    assert.equal(alert.meta.requestId, req.id);
    assert.match(String(alert.meta.link), /^#\/tagRequest/);
    assert.equal(alert.meta.total, 29);

    // 3) admin edit — qty badlo + status set karo → total re-calculate
    const id = encodeURIComponent(req.id);
    const updated = await jsonCall(server.base, `/api/tag-requests/${id}`, 'PUT', {
      rows: [{ ...requestBody().rows[0], approved: 30, remark: 'ok' }, { ...requestBody().rows[1], approved: 5 }],
      status: 'approved', adminNote: '2 box kal'
    }, admin);
    assert.equal(updated.res.status, 200, JSON.stringify(updated.json));
    assert.equal(updated.json.request.status, 'approved');
    assert.equal(updated.json.request.total, 35);
    assert.equal(updated.json.request.rows[0].approved, 30);
    assert.equal(updated.json.request.rows[0].remark, 'ok');
    assert.equal(updated.json.request.adminNote, '2 box kal');

    // 4) permissions — bina grant wale user ko 403, granted user ko sirf apni requests
    await jsonCall(server.base, '/api/users', 'POST', { username: 'member', name: 'Staff Member', password: 'member-pass-1', role: 'user', permissions: ['home'] }, admin);
    await jsonCall(server.base, '/api/users', 'POST', { username: 'requester', name: 'Requester', password: 'requester-pass-1', role: 'user', permissions: ['home', 'tagRequest', 'export'] }, admin);
    const noPerm = await login(server.base, 'member', 'member-pass-1');
    const denied = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, noPerm);
    assert.equal(denied.res.status, 403);
    const deniedPost = await jsonCall(server.base, '/api/tag-requests', 'POST', requestBody(), noPerm);
    assert.equal(deniedPost.res.status, 403, 'bina permission submit nahi hona chahiye');

    const requester = await login(server.base, 'requester', 'requester-pass-1');
    const own = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, requester);
    assert.equal(own.res.status, 200);
    assert.deepEqual(own.json.requests, [], 'naya user sirf apni requests dekhta hai');
    assert.equal(own.json.admin, false);
    const second = await jsonCall(server.base, '/api/tag-requests', 'POST', { ...requestBody(), note: 'user request' }, requester);
    assert.equal(second.res.status, 201, JSON.stringify(second.json));
    const ownAfter = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, requester);
    assert.equal(ownAfter.json.requests.length, 1, 'user ko apni request dikhni chahiye');
    const adminAfter = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin);
    assert.equal(adminAfter.json.requests.length, 2, 'admin ko dono dikhni chahiye');
    const requesterAlert = await jsonCall(server.base, '/api/notifications', 'GET', undefined, requester);
    assert.ok((requesterAlert.json.items || []).some((i) => i.type === 'request' && /bhej di gayi/.test(i.title)), 'requester ko confirmation notification chahiye');

    // 5) restart → requests durable (notify kind ke andar save hoti hain)
    await server.stop();
    server = await startServer(dir);
    const admin2 = await login(server.base, 'owner', 'initial-password');
    const persisted = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin2);
    assert.equal(persisted.json.requests.length, 2, 'restart ke baad requests bachi rehni chahiye');
    const first = persisted.json.requests.find((r) => r.id === req.id);
    assert.ok(first, 'pehli request restart ke baad bhi milni chahiye');
    assert.equal(first.status, 'approved');
    assert.equal(first.total, 35);

    // 6) delete
    const del = await jsonCall(server.base, `/api/tag-requests/${id}`, 'DELETE', undefined, admin2);
    assert.equal(del.res.status, 200);
    const afterDel = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin2);
    assert.equal(afterDel.json.requests.length, 1);
  } finally {
    if (server) await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('tag request — validation (khaali / zero qty) aur default notify pref ON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-tagreq2-'));
  let server;
  try {
    server = await startServer(dir);
    const admin = await login(server.base, 'owner', 'initial-password');
    const noRows = await jsonCall(server.base, '/api/tag-requests', 'POST', { rows: [] }, admin);
    assert.equal(noRows.res.status, 400, 'khaali rows reject honi chahiye');
    const zero = await jsonCall(server.base, '/api/tag-requests', 'POST', { rows: [{ ...requestBody().rows[0], approved: 0 }] }, admin);
    assert.equal(zero.res.status, 400, '0 qty wali request nahi jaani chahiye');
    const badStatus = await jsonCall(server.base, '/api/tag-requests/does-not-exist', 'PUT', { status: 'nope' }, admin);
    assert.equal(badStatus.res.status, 404, 'missing request par 404');
    // 'request' type default me ON — warna admin feed se ye notification silently gir jaati hai
    const prefs = await jsonCall(server.base, '/api/notifications/prefs', 'GET', undefined, admin);
    const defaults = (prefs.json && (prefs.json.defaults || prefs.json.prefs)) || {};
    assert.notEqual(defaults.request, false, "'request' notification default me ON hona chahiye");
  } finally {
    if (server) await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
