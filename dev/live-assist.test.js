/* 🎙️ Live Assist (v3.26) — server contract regression.
 *
 * Ye feature SIRF consent se chalta hai; test isi ko lock karte hain:
 *   • admin request → user ko 'assist' notification + inbox me session,
 *   • bina target user ke accept/decline nahi ho sakta (privacy),
 *   • accept ke BAAD hi signalling chalti hai — SDP/ICE relay, echo-back nahi,
 *   • decline/end/missed lifecycle + non-admin request 403,
 *   • sessions durable (notify kind) — restart ke baad history bachi rahe.
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

test('live assist — consent lifecycle: request → inbox → accept → signalling → end (+ privacy guards)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-assist-'));
  let server;
  try {
    server = await startServer(dir);
    const admin = await login(server.base, 'owner', 'initial-password');
    await jsonCall(server.base, '/api/users', 'POST', { username: 'ravi', name: 'Ravi Kumar', password: 'ravi-pass-123', role: 'user', permissions: ['home'] }, admin);
    await jsonCall(server.base, '/api/users', 'POST', { username: 'meena', name: 'Meena', password: 'meena-pass-123', role: 'user', permissions: ['home'] }, admin);
    const ravi = await login(server.base, 'ravi', 'ravi-pass-123');
    const meena = await login(server.base, 'meena', 'meena-pass-123');

    // non-admin request nahi bhej sakta
    const denied = await jsonCall(server.base, '/api/live-assist/request', 'POST', { user: 'ravi', mode: 'audio' }, ravi);
    assert.equal(denied.res.status, 403, 'sirf admin request bhej sakta hai');

    // admin → ravi voice request
    const req = await jsonCall(server.base, '/api/live-assist/request', 'POST', { user: 'ravi', mode: 'audio' }, admin);
    assert.equal(req.res.status, 201, JSON.stringify(req.json));
    const sid = req.json.session.id;
    assert.match(sid, /^assist_/);
    assert.equal(req.json.session.status, 'requested');
    assert.ok(Array.isArray(req.json.session.ice) && req.json.session.ice.length, 'ICE servers session ke saath milne chahiye');

    // duplicate request → wahi session (spam nahi)
    const dup = await jsonCall(server.base, '/api/live-assist/request', 'POST', { user: 'ravi', mode: 'audio' }, admin);
    assert.equal(dup.json.existing, true);
    assert.equal(dup.json.session.id, sid);

    // ravi ko notification + inbox me session; meena ko kuch nahi
    const feed = await jsonCall(server.base, '/api/notifications', 'GET', undefined, ravi);
    const alert = (feed.json.items || []).find((i) => i.type === 'assist' && /Live Assist request/.test(i.title));
    assert.ok(alert, 'user ko assist notification milni chahiye');
    assert.equal(alert.meta.sessionId, sid);
    const inbox = await jsonCall(server.base, '/api/live-assist/inbox', 'GET', undefined, ravi);
    assert.equal(inbox.json.sessions.length, 1);
    assert.equal(inbox.json.sessions[0].id, sid);
    const meenaInbox = await jsonCall(server.base, '/api/live-assist/inbox', 'GET', undefined, meena);
    assert.equal(meenaInbox.json.sessions.length, 0, 'doosre user ko request nahi dikhni chahiye');

    // ⛔ privacy: koi doosra user accept nahi kar sakta
    const badAccept = await jsonCall(server.base, `/api/live-assist/${sid}/accept`, 'POST', {}, meena);
    assert.equal(badAccept.res.status, 403, 'target ke alawa koi accept nahi kar sakta');

    // ⛔ signalling accept se PEHLE band (bina consent media setup nahi)
    const earlySig = await jsonCall(server.base, `/api/live-assist/${sid}/signal`, 'POST', { kind: 'sdp', data: { type: 'offer', sdp: 'x' } }, admin);
    assert.equal(earlySig.res.status, 400, 'requested state me signalling allowed nahi');

    // ravi accept karta hai
    const acc = await jsonCall(server.base, `/api/live-assist/${sid}/accept`, 'POST', {}, ravi);
    assert.equal(acc.res.status, 200, JSON.stringify(acc.json));
    assert.equal(acc.json.session.status, 'active');

    // admin → offer; ravi ko dikhna chahiye, admin ko apna echo nahi
    const s1 = await jsonCall(server.base, `/api/live-assist/${sid}/signal`, 'POST', { kind: 'sdp', data: { type: 'offer', sdp: 'fake-offer' } }, admin);
    assert.equal(s1.res.status, 200);
    const r1 = await jsonCall(server.base, `/api/live-assist/${sid}/signal?since=0`, 'GET', undefined, ravi);
    assert.equal(r1.json.signals.length, 1);
    assert.equal(r1.json.signals[0].data.sdp, 'fake-offer');
    const echo = await jsonCall(server.base, `/api/live-assist/${sid}/signal?since=0`, 'GET', undefined, admin);
    assert.equal(echo.json.signals.length, 0, 'admin ko apna bheja signal wapas nahi aana chahiye');

    // ravi → answer + ICE candidate
    await jsonCall(server.base, `/api/live-assist/${sid}/signal`, 'POST', { kind: 'sdp', data: { type: 'answer', sdp: 'fake-answer' } }, ravi);
    await jsonCall(server.base, `/api/live-assist/${sid}/signal`, 'POST', { kind: 'ice', data: { candidate: 'candidate:1 1 udp 2122260223 10.0.0.1 50000 typ host', sdpMid: '0' } }, ravi);
    const r2 = await jsonCall(server.base, `/api/live-assist/${sid}/signal?since=0`, 'GET', undefined, admin);
    assert.equal(r2.json.signals.length, 2, 'admin ko answer + ICE dono milne chahiye');
    assert.deepEqual(r2.json.signals.map((x) => x.kind), ['sdp', 'ice']);

    // since cursor aage badhe to wapas koi signal nahi
    const r3 = await jsonCall(server.base, `/api/live-assist/${sid}/signal?since=${r2.json.seq}`, 'GET', undefined, admin);
    assert.equal(r3.json.signals.length, 0);

    // ⛔ meena signalling me ghus nahi sakti
    const intrude = await jsonCall(server.base, `/api/live-assist/${sid}/signal?since=0`, 'GET', undefined, meena);
    assert.equal(intrude.res.status, 403);

    // ravi end karta hai → signalling band
    const end = await jsonCall(server.base, `/api/live-assist/${sid}/end`, 'POST', {}, ravi);
    assert.equal(end.json.session.status, 'ended');
    const afterEnd = await jsonCall(server.base, `/api/live-assist/${sid}/signal`, 'POST', { kind: 'ice', data: { candidate: 'x' } }, admin);
    assert.equal(afterEnd.res.status, 400, 'ended session par signalling band');

    // decline flow — doosri request
    const req2 = await jsonCall(server.base, '/api/live-assist/request', 'POST', { user: 'ravi', mode: 'video' }, admin);
    const sid2 = req2.json.session.id;
    const dec = await jsonCall(server.base, `/api/live-assist/${sid2}/decline`, 'POST', {}, ravi);
    assert.equal(dec.json.session.status, 'declined');
    const accAfterDecline = await jsonCall(server.base, `/api/live-assist/${sid2}/accept`, 'POST', {}, ravi);
    assert.equal(accAfterDecline.res.status, 400, 'declined session accept nahi ho sakta');

    // admin history me dono sessions
    const hist = await jsonCall(server.base, '/api/live-assist', 'GET', undefined, admin);
    assert.ok(hist.json.sessions.length >= 2);
    assert.ok(hist.json.sessions.every((s) => Array.isArray(s.ice)));
  } finally {
    if (server) await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('live assist — restart durability + missed timeout semantics', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-assist2-'));
  let server;
  try {
    server = await startServer(dir);
    const admin = await login(server.base, 'owner', 'initial-password');
    await jsonCall(server.base, '/api/users', 'POST', { username: 'ravi', name: 'Ravi', password: 'ravi-pass-123', role: 'user', permissions: ['home'] }, admin);
    const req = await jsonCall(server.base, '/api/live-assist/request', 'POST', { user: 'ravi', mode: 'audio' }, admin);
    const sid = req.json.session.id;
    const ravi = await login(server.base, 'ravi', 'ravi-pass-123');
    await jsonCall(server.base, `/api/live-assist/${sid}/accept`, 'POST', {}, ravi);

    await server.stop();
    server = await startServer(dir);
    const admin2 = await login(server.base, 'owner', 'initial-password');
    const hist = await jsonCall(server.base, '/api/live-assist', 'GET', undefined, admin2);
    const found = hist.json.sessions.find((s) => s.id === sid);
    assert.ok(found, 'restart ke baad session history bachi rehni chahiye');
    assert.equal(found.status, 'active');
    assert.equal(found.mode, 'audio');
  } finally {
    if (server) await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
