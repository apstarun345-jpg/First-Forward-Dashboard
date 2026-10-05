/* Web push regression tests.

   Covers the "mobile notification panel me alert nahi aata, app ke andar bell me aata hai" bug:
   the VAPID keypair lived in DATA_DIR only. On Render the app stores users/settings/notifications
   in the durable Apps Script sheet, but DATA_DIR is the CONTAINER disk — wiped on every deploy and
   every free-tier spin-down. So each restart minted a new VAPID key while the stored browser
   subscriptions still pointed at the old applicationServerKey. The push service then rejects every
   message (403) and, because deliverPush() treated 403 as "keep the subscription", nothing was
   logged and the client never re-subscribed → OS panel silent forever, in-app polling still fine.

   The mock push service below behaves like FCM: it verifies the VAPID JWT against the key the
   subscription was created with (403 on mismatch) and decrypts the RFC 8291 aes128gcm body. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startMockAppsScript } from './mock-apps-script.js';

process.env.APPS_SCRIPT_ALLOW_LOCAL = '1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'test-secret-0123456789-abcdef';

// ---- VAPID key helpers --------------------------------------------------------------------------
// Browsers demand the RAW 65-byte uncompressed P-256 point (0x04 || X || Y) as applicationServerKey.
// Purana server SPKI DER (91 bytes) deta tha — Chrome usse "The provided applicationServerKey is not
// valid" bol ke reject karta tha. Server ab hamesha raw point serve karta hai.
function rawPointOf(publicKeyObject) {
  const jwk = publicKeyObject.export({ format: 'jwk' }); // EC public JWK me x/y hote hain
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
}
/** KeyObject banao — chahe 65-byte raw point ho ya 91-byte SPKI DER (legacy). */
function pubKeyFromAny(b64) {
  const raw = Buffer.from(b64, 'base64url');
  if (raw.length === 65 && raw[0] === 4) {
    return crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33, 65).toString('base64url') }, format: 'jwk' });
  }
  return crypto.createPublicKey({ key: raw, format: 'der', type: 'spki' });
}

// ---- RFC 8291 helpers (client side of the encryption the server performs) -----------------------
function hkdf(salt, ikm, info, len) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  let t = Buffer.alloc(0), out = Buffer.alloc(0), i = 1;
  while (out.length < len) {
    t = crypto.createHmac('sha256', prk).update(Buffer.concat([t, Buffer.from(info), Buffer.from([i])])).digest();
    out = Buffer.concat([out, t]); i++;
  }
  return out.subarray(0, len);
}
/** Browser-like UA key material: P-256 keypair + 16-byte auth secret. */
function makeUA() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const priv = ecdh.getPrivateKey();
  return { privateKey: Buffer.concat([Buffer.alloc(32 - priv.length), priv]), publicKey: ecdh.getPublicKey(), authSecret: crypto.randomBytes(16) };
}
function decryptPush(body, ua) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const serverPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(ua.privateKey);
  const shared = ecdh.computeSecret(serverPub);
  const ikm = hkdf(ua.authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), ua.publicKey, serverPub]), 32);
  const cek = hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12);
  const tag = ct.subarray(ct.length - 16);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(tag);
  let plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let i = plain.length - 1;
  while (i >= 0 && plain[i] === 0) i--;
  assert.equal(plain[i], 2, 'final record delimiter (0x02) missing');
  return JSON.parse(plain.subarray(0, i).toString('utf8'));
}

// ---- mock push service (FCM-like) ---------------------------------------------------------------
function startMockPushService() {
  const state = { expectedKey: null, ua: null, deliveries: [], failWith: 0, failError: '', legacyOnly: false };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const rec = { url: req.url, ttl: req.headers.ttl, urgency: req.headers.urgency, encoding: req.headers['content-encoding'], auth: req.headers.authorization || '', cryptoKey: req.headers['crypto-key'] || '', status: 0, payload: null, error: null };
      state.deliveries.push(rec);
      const reject = (status, error) => { rec.status = status; rec.error = error; res.writeHead(status); return res.end(error); };
      if (state.failWith) return reject(state.failWith, state.failError || 'forced');
      /* FCM-faithful VAPID parsing:
           RFC 8292 (modern) → Authorization: vapid t=<jwt>, k=<public key>
           draft-01 (legacy) → Authorization: WebPush <jwt>  +  Crypto-Key: p256ecdsa=<public key>
         Legacy scheme me Crypto-Key missing ho to FCM exactly ye bhejta hai:
           403 permission denied: crypto-key header had no public application server key specified
         (wahi bug jisne phone ka notification panel hamesha silent rakha) */
      let jwt = null, sentKey = null, scheme = null;
      const vapidM = /^vapid\s+t=([^,\s]+)\s*,\s*k=([^,\s]+)\s*$/i.exec(req.headers.authorization || '');
      const legacyM = /^WebPush\s+(\S+)\s*$/i.exec(req.headers.authorization || '');
      if (vapidM) { scheme = 'vapid'; jwt = vapidM[1]; sentKey = vapidM[2]; }
      else if (legacyM) {
        scheme = 'legacy'; jwt = legacyM[1];
        const ck = /(?:^|,)\s*p256ecdsa=([^,\s]+)/i.exec(req.headers['crypto-key'] || '');
        if (!ck) return reject(403, 'permission denied: crypto-key header had no public application server key specified');
        sentKey = ck[1];
      } else return reject(401, 'no VAPID JWT');
      rec.scheme = scheme; rec.sentKey = sentKey;
      if (state.legacyOnly && scheme !== 'legacy') return reject(403, 'permission denied: unsupported authorization scheme');
      // Subscription kis applicationServerKey se bani thi — wahi key request me honi chahiye.
      if (state.expectedKey && sentKey !== state.expectedKey) return reject(403, 'permission denied: the JWT public key does not match the application server key of the subscription');
      const [h, p, s2] = jwt.split('.');
      let verified = false;
      try {
        const pub = pubKeyFromAny(sentKey);
        verified = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s2, 'base64url'));
        const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
        rec.aud = claims.aud; rec.sub = claims.sub;
        if (!/^(mailto:|https:)/.test(String(claims.sub))) return reject(403, 'invalid JWT: sub claim must be a mailto: or https: URI');
        if (/localhost|\.local$/i.test(String(claims.sub))) return reject(403, 'BadJwtToken: sub claim looks like a localhost address');
        if (claims.exp && claims.exp * 1000 < Date.now()) return reject(403, 'invalid JWT: expired');
      } catch (err) { rec.error = `jwt: ${err.message}`; }
      if (!verified) return reject(403, rec.error || 'invalid JWT signature');
      try { rec.payload = decryptPush(body, state.ua); } catch (err) { rec.status = 400; rec.error = `decrypt: ${err.message}`; res.writeHead(400); return res.end(); }
      rec.status = 201;
      res.writeHead(201); res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({ ...state, state, origin: `http://127.0.0.1:${port}`, url: (id) => `http://127.0.0.1:${port}/wp/${id}`, close: () => new Promise((r) => server.close(r)) });
  }));
}

// ---- server harness (cloud storage + throwaway container disk, like Render) ----------------------
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('web push survives a Render redeploy: VAPID key stays stable and deliveries keep verifying', async () => {
  const mock = await startMockAppsScript({ secret: SECRET });
  const push = await startMockPushService();
  const containerDisk1 = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-push-disk1-'));
  let server;
  try {
    const cloud = { STORAGE_BACKEND: '', APPS_SCRIPT_URL: mock.url, APPS_SCRIPT_SECRET: SECRET, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'owner-password', RENDER: 'true', GVIZ_BASE: '' };
    server = await startServer({ ...cloud, DATA_DIR: containerDisk1 });
    let cookie = '';
    const call = async (route, method = 'GET', body) => {
      const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { res, json: await res.json().catch(() => ({})) };
    };
    cookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'owner-password' })).res.headers.get('set-cookie').split(';')[0];

    const vapid1 = (await call('/api/push/vapid')).json.publicKey;
    assert.ok(vapid1, 'server must expose a VAPID public key');
    // Browser-ready format: 65-byte uncompressed P-256 point (0x04 || X || Y), SPKI DER NAHI.
    const vapid1Bytes = Buffer.from(vapid1, 'base64url');
    assert.equal(vapid1Bytes.length, 65, `applicationServerKey 65-byte raw point hona chahiye, mila ${vapid1Bytes.length} bytes — Chrome ise reject karega`);
    assert.equal(vapid1Bytes[0], 4, 'uncompressed EC point 0x04 se shuru hona chahiye');

    // "Browser" subscribes with that key — exactly like notifications.js setupPush() does.
    const ua = makeUA();
    push.state.ua = ua;
    push.state.expectedKey = vapid1;
    const subscription = { endpoint: push.url('device-1'), keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } };
    assert.equal((await call('/api/push/subscribe', 'POST', { subscription })).res.status, 200);

    // An admin-visible event → pushFanout → real HTTP delivery to the push service.
    await call('/api/activity', 'POST', { type: 'settings', details: 'push test 1' });
    for (let i = 0; i < 40 && !push.state.deliveries.length; i++) await sleep(50);
    assert.equal(push.state.deliveries.length, 1, 'first notification must reach the push service');
    const first = push.state.deliveries[0];
    assert.equal(first.status, 201, `push service rejected the message: ${first.error}`);
    assert.equal(first.encoding, 'aes128gcm');
    assert.match(first.payload.title, /Settings update/i);

    // Render redeploy / free-tier spin-up: brand-new container disk, durable sheet store intact.
    await server.stop();
    const containerDisk2 = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-push-disk2-'));
    server = await startServer({ ...cloud, DATA_DIR: containerDisk2 });

    const vapid2 = (await call('/api/push/vapid')).json.publicKey;
    assert.equal(vapid2, vapid1, 'VAPID key must survive a redeploy — a new key invalidates every stored subscription');
    const status = (await call('/api/push/status')).json;
    assert.equal(status.subs, 1, 'subscription must still be registered after the redeploy');

    push.state.deliveries.length = 0;
    await call('/api/activity', 'POST', { type: 'settings', details: 'push test 2' });
    for (let i = 0; i < 40 && !push.state.deliveries.length; i++) await sleep(50);
    assert.equal(push.state.deliveries.length, 1, 'notification after redeploy must still be delivered');
    const second = push.state.deliveries[0];
    assert.equal(second.status, 201, `post-redeploy push was rejected (phone panel would stay silent): ${second.error}`);
    assert.ok(Number(second.ttl) >= 86400, `TTL ${second.ttl}s is too short — offline/dozing phones drop the alert; use >= 24h`);
    await fs.rm(containerDisk2, { recursive: true, force: true });
  } finally {
    if (server) await server.stop();
    await push.close(); await mock.close();
    await fs.rm(containerDisk1, { recursive: true, force: true });
  }
});

test('VAPID_* env vars in the standard web-push tool format (32-byte scalar) work end-to-end', async () => {
  // Render env me operator sabse zyada `npx web-push generate-vapid-keys` ka output paste karta hai:
  // publicKey = 65-byte raw point (base64url), privateKey = 32-byte raw scalar (base64url).
  // Server ko dono accept karke browser-ready key serve karni chahiye aur deliveries verify honi chahiye.
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  let d = ecdh.getPrivateKey(); if (d.length < 32) d = Buffer.concat([Buffer.alloc(32 - d.length), d]);
  const envPub = ecdh.getPublicKey().toString('base64url');      // web-push tool publicKey
  const envPriv = d.toString('base64url');                        // web-push tool privateKey (43 chars)
  const kpJwk = ecdh.getPublicKey();
  const expectedPub = Buffer.concat([Buffer.from([4]), kpJwk.subarray(1, 65)]).toString('base64url');

  const mock = await startMockAppsScript({ secret: SECRET });
  const push = await startMockPushService();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-push-env-'));
  let server;
  try {
    server = await startServer({ STORAGE_BACKEND: '', APPS_SCRIPT_URL: mock.url, APPS_SCRIPT_SECRET: SECRET, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'owner-password', RENDER: 'true', GVIZ_BASE: '', DATA_DIR: dir, VAPID_PUBLIC_KEY: envPub, VAPID_PRIVATE_KEY: envPriv });
    const cookie = (await (await fetch(server.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'owner-password' }) })).headers.get('set-cookie')).split(';')[0];
    const call = (route, method = 'GET', body) => fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((r) => r.json());

    const vapid = (await call('/api/push/vapid')).publicKey;
    assert.equal(vapid, expectedPub, 'env keypair ka raw 65-byte point serve hona chahiye');
    const health = await call('/api/health');
    assert.equal(health.push.enabled, true);
    assert.equal(health.push.keySource, 'env', 'keySource env hona chahiye');

    const ua = makeUA();
    push.state.ua = ua;
    push.state.expectedKey = vapid;
    const sub = { subscription: { endpoint: push.url('env-device'), keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } } };
    await fetch(server.base + '/api/push/subscribe', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    await fetch(server.base + '/api/activity', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'settings', details: 'env key test' }) });
    for (let i = 0; i < 40 && !push.state.deliveries.length; i++) await sleep(50);
    assert.equal(push.state.deliveries.length, 1, 'env-key push deliver honi chahiye');
    assert.equal(push.state.deliveries[0].status, 201, `push service ne reject kiya: ${push.state.deliveries[0].error}`);
  } finally {
    if (server) await server.stop();
    await push.close(); await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a subscription signed with a rotated key is reported and dropped so the phone re-subscribes', async () => {
  const mock = await startMockAppsScript({ secret: SECRET });
  const push = await startMockPushService();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-push-stale-'));
  let server;
  try {
    server = await startServer({ STORAGE_BACKEND: '', APPS_SCRIPT_URL: mock.url, APPS_SCRIPT_SECRET: SECRET, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'owner-password', DATA_DIR: dir, RENDER: 'true' });
    let cookie = '';
    const call = async (route, method = 'GET', body) => {
      const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { res, json: await res.json().catch(() => ({})) };
    };
    cookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'owner-password' })).res.headers.get('set-cookie').split(';')[0];
    const ua = makeUA();
    push.state.ua = ua;
    await call('/api/push/subscribe', 'POST', { subscription: { endpoint: push.url('device-2'), keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } } });
    // Pretend the push service knows a DIFFERENT app server key for that subscription (rotated VAPID).
    push.state.expectedKey = rawPointOf(crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey);

    await call('/api/activity', 'POST', { type: 'settings', details: 'stale key test' });
    for (let i = 0; i < 40 && !push.state.deliveries.length; i++) await sleep(50);
    assert.equal(push.state.deliveries[0].status, 403, 'mock should reject the mismatched VAPID key');
    for (let i = 0; i < 40; i++) { const s = (await call('/api/push/status')).json; if (s.subs === 0) break; await sleep(50); }
    const status = (await call('/api/push/status')).json;
    assert.equal(status.subs, 0, 'a subscription the push service refuses (403) must be removed so the client re-subscribes');
    assert.equal(status.lastError.status, 403, 'the failure must be visible for diagnostics instead of failing silently');
    assert.match(server.log(), /push delivery failed/i, 'failed deliveries must be logged');

    // Restore the service's expected key BEFORE the new subscription is visible. Background
    // notifications may fan out immediately after subscribe, so setting it afterwards races them.
    push.state.expectedKey = (await call('/api/push/vapid')).json.publicKey;
    const reSub = await call('/api/push/subscribe', 'POST', { subscription: { endpoint: push.url('device-3'), keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } } });
    assert.equal(reSub.res.status, 200, `re-subscribe accepted — ${JSON.stringify(reSub.json)}`);
    // Let any in-flight background delivery finish before measuring the explicit self-test.
    await sleep(100);
    push.state.deliveries.length = 0;
    const out = await call('/api/push/test', 'POST', {});
    assert.equal(out.res.status, 200);
    assert.equal(out.json.delivered, 1, JSON.stringify(out.json));
    assert.equal(out.json.results[0].status, 201);
    assert.equal(push.state.deliveries.length, 1);
    assert.match(push.state.deliveries[0].payload.title, /test/i);
  } finally {
    if (server) await server.stop();
    await push.close(); await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---- client side: notifications.js must notice a changed VAPID key and re-subscribe -------------
function loadNotifications({ serverKey, existingKey, permission = 'granted', grantOnAsk, pwa = false, ios = false, popup = null, role = 'admin' }) {
  const calls = [];
  const ua = makeUA();
  const b64ToBytes = (str) => { const pad = '='.repeat((4 - (str.length % 4)) % 4); const b = Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64'); return new Uint8Array(b); };
  const makeSub = (key) => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/device',
    options: { userVisibleOnly: true, applicationServerKey: b64ToBytes(key).buffer },
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/device', keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } }),
    unsubscribe: async () => { calls.push('unsubscribe'); state.currentSub = null; return true; }
  });
  const state = { currentSub: existingKey ? makeSub(existingKey) : null, posted: [], prefsSaved: [] };
  const pushManager = {
    getSubscription: async () => state.currentSub,
    subscribe: async (opts) => {
      calls.push('subscribe');
      state.subscribedWith = Buffer.from(new Uint8Array(opts.applicationServerKey)).toString('base64url');
      state.currentSub = makeSub(state.subscribedWith);
      return state.currentSub;
    }
  };
  const reg = { pushManager, scope: 'https://app.test/', active: {}, showNotification: async () => {} };
  const sandbox = {
    console, atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, setInterval, clearInterval, PushManager: class {}, ServiceWorkerRegistration: class {},
    URL, URLSearchParams, Promise, Date, Math, JSON, Number, String, Array, Object, Buffer,
    location: { search: '', hash: '#/home', href: 'https://app.test/#/home' },
    localStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => m.set(String(k), String(v)), removeItem: (k) => m.delete(String(k)) }; })(),
    document: { visibilityState: 'visible', title: 'x', addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null },
    matchMedia: (q) => ({ matches: !!pwa && /standalone|fullscreen/.test(String(q)), addEventListener() {} }),
    // Real browser jaisa: prompt ke baad Notification.permission khud update hota hai.
    Notification: (() => {
      let perm = permission;
      return { get permission() { return perm; }, requestPermission: async () => { perm = grantOnAsk === undefined ? permission : grantOnAsk; return perm; } };
    })(),
    navigator: { userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' : 'Android Chrome', serviceWorker: { ready: Promise.resolve(reg), getRegistration: async () => reg, register: async () => reg }, vibrate: () => true, onLine: true, permissions: { query: async () => ({ state: permission, addEventListener() {} }) } }
  };
  // Real iOS Safari (bina "Add to Home Screen") me serviceWorker / PushManager hote hi nahi —
  // isliye wahan push support ka pata lagane wala check bhi false aana chahiye.
  if (ios && !pwa) { delete sandbox.PushManager; delete sandbox.navigator.serviceWorker; }
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  sandbox.FF = {
    config: {},
    util: { $: (sel) => (sel === '#notification-pop' && popup ? popup : (sel === '#notification-btn' ? null : null)), toast: (m, k) => calls.push(`toast:${k}`), esc: (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])), timeLabel: () => 'now' },
    auth: {
      user: { username: role === 'user' ? 'staff' : 'owner', role, notifyAccess: true },
      api: async (route, method, body) => {
        calls.push(`${method || 'GET'} ${route}`);
        if (route === '/api/push/vapid') return { publicKey: serverKey };
        if (route === '/api/push/subscribe') { state.posted.push(body.subscription); return { ok: true }; }
        if (route === '/api/notifications/prefs' && method === 'PUT') { state.prefsSaved.push((body && body.prefs) || {}); return { ok: true, prefs: body.prefs }; }
        if (route === '/api/push/status') return { ok: true, subs: state.posted.length || 1, publicKey: serverKey };
        return { ok: true };
      }
    }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(ROOT, 'notifications.js'), 'utf8'), ctx, { filename: 'notifications.js' });
  return { FF: sandbox.FF, calls, state };
}

test('client re-subscribes when the server VAPID key changed, and reuses a matching subscription', async () => {
  const staleKey = rawPointOf(crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey);
  const freshKey = rawPointOf(crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey);

  const rotated = loadNotifications({ serverKey: freshKey, existingKey: staleKey });
  assert.equal(await rotated.FF.notifications.setupPush(true), true, `setupPush failed: ${rotated.FF.notifications.state.pushError}`);
  assert.ok(rotated.calls.includes('unsubscribe'), 'a subscription made with an old VAPID key must be dropped');
  assert.ok(rotated.calls.includes('subscribe'), 'and re-created with the current key');
  assert.equal(rotated.state.subscribedWith, freshKey);
  assert.equal(rotated.state.posted.length, 1, 'the fresh subscription must be sent to the server');

  const matching = loadNotifications({ serverKey: freshKey, existingKey: freshKey });
  assert.equal(await matching.FF.notifications.setupPush(true), true, `setupPush failed: ${matching.FF.notifications.state.pushError}`);
  assert.ok(!matching.calls.includes('subscribe'), 'a subscription with the right key must not be churned');
  assert.equal(matching.state.posted.length, 1, 'it is still re-registered with the server (endpoint can rotate)');
});

test('client heals a legacy SPKI-DER VAPID key instead of crashing subscribe()', async () => {
  // Purane server build ka bug: /api/push/vapid se 91-byte SPKI DER aata tha aur Chrome
  // pushManager.subscribe() par "The provided applicationServerKey is not valid" phenkta tha.
  // Client ab raw 65-byte point nikaal ke subscribe karta hai.
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spkiKey = kp.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const rawKey = rawPointOf(kp.publicKey);
  assert.equal(Buffer.from(spkiKey, 'base64url').length, 91, 'sanity: SPKI DER is 91 bytes, not browser-ready');

  const healed = loadNotifications({ serverKey: spkiKey, existingKey: null });
  assert.equal(await healed.FF.notifications.setupPush(true), true, `setupPush failed: ${healed.FF.notifications.state.pushError}`);
  assert.equal(healed.state.subscribedWith, rawKey, 'subscribe() ko raw 65-byte point milna chahiye (Chrome-compatible)');
  assert.equal(healed.state.posted.length, 1, 'healed subscription server par register honi chahiye');

  // Agar existing subscription isi key se bani hai (raw point), to SPKI server key ke baawajood churn nahi hona chahiye.
  const reuse = loadNotifications({ serverKey: spkiKey, existingKey: rawKey });
  assert.equal(await reuse.FF.notifications.setupPush(true), true, `setupPush failed: ${reuse.FF.notifications.state.pushError}`);
  assert.ok(!reuse.calls.includes('subscribe'), 'matching raw-point subscription ko dobara nahi banana chahiye');
});

// ---- 🧹 bell panel UI: sirf ek Notifications ON/OFF switch (+ monthly) ----------------------------
test('bell panel me sirf Notifications ON/OFF + monthly switch hai — panel test / push test / warnings hata diye', async () => {
  const key = rawPointOf(crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey);
  const mkPopup = () => { const el = { hidden: true, _html: '' }; Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: (v) => { el._html = String(v); } }); return el; };

  // 1) Android Chrome, permission abhi maangi nahi gayi → switch + ek line hint (koi debug card nahi)
  const pop1 = mkPopup();
  const a = loadNotifications({ serverKey: key, permission: 'default', popup: pop1 });
  a.FF.notifications.state.items = [];
  a.FF.notifications.render();
  assert.match(pop1.innerHTML, /data-notify-switch="master"/, 'master ON/OFF switch har haal me dikhna chahiye');
  assert.match(pop1.innerHTML, /data-notify-switch="monthly"/, 'monthly report ka switch bhi chahiye');
  assert.doesNotMatch(pop1.innerHTML, /data-notify-panel-test/, '📳 Panel test button panel se hata diya');
  assert.doesNotMatch(pop1.innerHTML, /data-notify-push-test/, '🛰 Server push test button panel se hata diya');
  assert.doesNotMatch(pop1.innerHTML, /data-notify-enable/, 'purana "Mobile notifications on karo" card hata diya');
  assert.doesNotMatch(pop1.innerHTML, /Notification preferences/, 'per-type preference list ab Settings me hai');
  assert.doesNotMatch(pop1.innerHTML, /data-notify-test/, '🔊 Test button bhi panel se gaya');
  assert.equal((pop1.innerHTML.match(/notify-line/g) || []).length, 1, 'ek se zyada warning line nahi honi chahiye');

  // 2) iOS Safari, PWA installed nahi → install ka lecture nahi, sirf switch
  const pop2 = mkPopup();
  const b = loadNotifications({ serverKey: key, permission: 'default', popup: pop2, ios: true });
  b.FF.notifications.render();
  assert.match(pop2.innerHTML, /data-notify-switch="master"/);
  assert.match(pop2.innerHTML, /Add to Home Screen/, 'iOS par install ke bina push possible nahi — ek line ka hint zaroori hai');
  assert.doesNotMatch(pop2.innerHTML, /notification-enable|notify-push-actions/, 'bade enable/test cards nahi chahiye');
  assert.equal((pop2.innerHTML.match(/notify-line/g) || []).length, 1);

  // 3) permission denied → ek chhoti line (technical dump nahi)
  const pop3 = mkPopup();
  const c = loadNotifications({ serverKey: key, permission: 'denied', popup: pop3 });
  c.FF.notifications.state.pushStatus = { subs: 0, lastError: { status: 403, error: 'permission denied: crypto-key header had no public application server key specified' } };
  c.FF.notifications.render();
  assert.match(pop3.innerHTML, /block/i, 'blocked permission ki ek saaf line chahiye');
  assert.doesNotMatch(pop3.innerHTML, /crypto-key header/i, 'push service ka raw error user ko nahi dikhana');
  assert.equal((pop3.innerHTML.match(/notify-line/g) || []).length, 1);

  // 4) admin ko server-side config problem ka ishara mile (silent failure nahi) — normal user ko nahi
  const pop4 = mkPopup();
  const d = loadNotifications({ serverKey: key, permission: 'granted', popup: pop4 });
  d.FF.notifications.state.pushOn = true;
  d.FF.notifications.state.pushStatus = { subs: 1, configError: { status: 403, error: 'permission denied: crypto-key header had no public application server key specified' } };
  d.FF.notifications.render();
  assert.match(pop4.innerHTML, /Push diagnostics/, 'admin ko Settings ke diagnostics ki taraf bhejo');

  const pop5 = mkPopup();
  const e = loadNotifications({ serverKey: key, permission: 'granted', popup: pop5, role: 'user' });
  e.FF.notifications.state.pushOn = true;
  e.FF.notifications.state.pushStatus = { subs: 1, configError: { status: 403, error: 'crypto-key header had no public application server key specified' } };
  e.FF.notifications.render();
  assert.doesNotMatch(pop5.innerHTML, /crypto-key|Push diagnostics/, 'normal user ko server internals nahi dikhne chahiye');

  // 5) master OFF → switch off, monthly disabled, ek line note
  const pop6 = mkPopup();
  const f = loadNotifications({ serverKey: key, permission: 'granted', popup: pop6 });
  f.FF.notifications.state.prefs.enabled = false;
  f.FF.notifications.render();
  assert.match(pop6.innerHTML, /class="ff-switch " role="switch" aria-checked="false"/, 'master switch OFF dikhe');
  assert.match(pop6.innerHTML, /OFF — koi alert nahi/);
  assert.match(pop6.innerHTML, /disabled[^>]*data-notify-switch="monthly"/, 'master OFF me monthly switch disabled');
});

test('master switch: ON → permission + push subscribe, OFF → unsubscribe + koi alert nahi', async () => {
  const key = rawPointOf(crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey);
  const c = loadNotifications({ serverKey: key, permission: 'default', grantOnAsk: 'granted' });
  const N = c.FF.notifications;

  assert.equal(await N.setEnabled(true), true, 'permission milne par setEnabled(true) succeed hona chahiye');
  assert.ok(c.calls.includes('subscribe'), 'ON karte hi web push subscribe honi chahiye');
  assert.equal(c.state.posted.length, 1, 'nayi subscription server par register honi chahiye');
  assert.equal(N.prefs.enabled, true);
  assert.equal(N.state.pushOn, true);
  const saved = c.state.prefsSaved[c.state.prefsSaved.length - 1] || {};
  assert.equal(saved.enabled, true, 'preference server par save honi chahiye (dusra device bhi sync rahe)');
  assert.ok(c.calls.includes('PUT /api/notifications/prefs'));

  await N.setEnabled(false);
  assert.ok(c.calls.includes('unsubscribe'), 'OFF karte hi push subscription hat jaani chahiye');
  assert.equal(N.prefs.enabled, false);
  assert.equal(N.state.pushOn, false);
  assert.equal((c.state.prefsSaved[c.state.prefsSaved.length - 1] || {}).enabled, false);

  c.calls.length = 0;
  await N.browserAlert({ type: 'info', title: 'hello', body: 'x', meta: {} });
  assert.ok(!c.calls.some((x) => x.startsWith('toast:')), 'master OFF me koi in-app toast nahi aana chahiye');
});

test('permission sirf ek hi baar khud maangi jaati hai (baar-baar prompt nahi)', async () => {
  const key = rawPointOf(crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey);
  const c = loadNotifications({ serverKey: key, permission: 'default', grantOnAsk: 'granted' });
  const N = c.FF.notifications;
  assert.equal(N.maybeAskPermission(), true, 'pehli baar permission maangni chahiye');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(c.state.posted.length, 1, 'permission milte hi subscription server par chali jaani chahiye');
  assert.equal(N.maybeAskPermission(), false, 'doosri baar prompt nahi (user pareshan na ho)');

  // Master OFF ho to permission bhi nahi maangni chahiye.
  const d = loadNotifications({ serverKey: key, permission: 'default', grantOnAsk: 'granted' });
  d.FF.notifications.state.prefs.enabled = false;
  assert.equal(d.FF.notifications.maybeAskPermission(), false);
});

test('server-side config error (FCM crypto-key 403) subscription KO DROP NAHI karta', async () => {
  // Ye wahi haalat hai jisne phone ka panel hamesha silent rakha: push service 403 deti thi aur
  // server use "dead subscription" maan kar delete kar deta tha → client "permission granted par
  // subscription active nahi" loop me phans jaata tha.
  const mock = await startMockAppsScript({ secret: SECRET });
  const push = await startMockPushService();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-push-cfg-'));
  let server;
  try {
    server = await startServer({ STORAGE_BACKEND: '', APPS_SCRIPT_URL: mock.url, APPS_SCRIPT_SECRET: SECRET, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'owner-password', RENDER: 'true', DATA_DIR: dir });
    let cookie = '';
    const call = async (route, method = 'GET', body) => {
      const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { res, json: await res.json().catch(() => ({})) };
    };
    cookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'owner-password' })).res.headers.get('set-cookie').split(';')[0];
    const vapid = (await call('/api/push/vapid')).json.publicKey;
    const ua = makeUA();
    push.state.ua = ua;
    push.state.expectedKey = vapid;
    await call('/api/push/subscribe', 'POST', { subscription: { endpoint: push.url('cfg-device'), keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } } });

    // Delivery modern RFC 8292 scheme se honi chahiye: Authorization: vapid t=…, k=<public key>
    push.state.failWith = 403;
    push.state.failError = 'permission denied: crypto-key header had no public application server key specified';
    await call('/api/activity', 'POST', { type: 'settings', details: 'config error test' });
    for (let i = 0; i < 40 && !push.state.deliveries.length; i++) await sleep(50);
    assert.equal(push.state.deliveries[0].status, 403);
    await sleep(300);
    const status = (await call('/api/push/status')).json;
    assert.equal(status.subs, 1, 'server ki config problem me user ki subscription delete nahi honi chahiye');
    assert.ok(status.configError, 'config error surface hona chahiye (silent failure nahi)');
    assert.match(status.configError.error, /crypto-key/);
    const health = (await call('/api/health')).json;
    assert.match(health.push.warning, /crypto-key|reject/, 'admin ko /api/health par warning dikhni chahiye');
    assert.equal(health.push.selfTest.ok, true, 'VAPID self-test pass hona chahiye');
    assert.equal(health.push.scheme, 'vapid');
    assert.match(health.push.subject, /^mailto:/);

    // Config theek hote hi (failWith hataya) wahi subscription deliver ho jaati hai — re-subscribe ki zaroorat nahi.
    push.state.failWith = 0; push.state.failError = '';
    push.state.deliveries.length = 0;
    await call('/api/activity', 'POST', { type: 'settings', details: 'recovered' });
    for (let i = 0; i < 40 && !push.state.deliveries.length; i++) await sleep(50);
    assert.equal(push.state.deliveries[0].status, 201, `recovery ke baad delivery chahiye: ${push.state.deliveries[0].error}`);
    assert.equal(push.state.deliveries[0].scheme, 'vapid', 'delivery RFC 8292 vapid scheme se honi chahiye');
    assert.match(push.state.deliveries[0].auth, /^vapid t=[^,]+, k=/);
    assert.equal(push.state.deliveries[0].sentKey, vapid, 'public key Authorization header me honi chahiye');
    assert.equal(push.state.deliveries[0].cryptoKey, '', 'aes128gcm ke saath Crypto-Key header ki zaroorat nahi');
  } finally {
    if (server) await server.stop();
    await push.close(); await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('legacy-only push service (WebPush + Crypto-Key) par automatic fallback chalta hai', async () => {
  const mock = await startMockAppsScript({ secret: SECRET });
  const push = await startMockPushService();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-push-legacy-'));
  let server;
  try {
    server = await startServer({ STORAGE_BACKEND: '', APPS_SCRIPT_URL: mock.url, APPS_SCRIPT_SECRET: SECRET, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'owner-password', RENDER: 'true', DATA_DIR: dir });
    let cookie = '';
    const call = async (route, method = 'GET', body) => {
      const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { res, json: await res.json().catch(() => ({})) };
    };
    cookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'owner-password' })).res.headers.get('set-cookie').split(';')[0];
    const vapid = (await call('/api/push/vapid')).json.publicKey;
    const ua = makeUA();
    push.state.ua = ua;
    push.state.expectedKey = vapid;
    push.state.legacyOnly = true; // purani push service: sirf WebPush + Crypto-Key samajhti hai
    await call('/api/push/subscribe', 'POST', { subscription: { endpoint: push.url('legacy-device'), keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } } });
    const out = await call('/api/push/test', 'POST', {});
    assert.equal(out.json.delivered, 1, JSON.stringify(out.json));
    const ok = push.state.deliveries.find((d) => d.status === 201);
    assert.ok(ok, 'legacy scheme par delivery honi chahiye');
    assert.equal(ok.scheme, 'legacy');
    assert.match(ok.cryptoKey, /^p256ecdsa=/, 'legacy scheme me Crypto-Key: p256ecdsa=<key> bhejna zaroori hai');
    assert.match(ok.auth, /^WebPush /);
    assert.equal((await call('/api/health')).json.push.scheme, 'legacy', 'kaam karne wala scheme yaad rehna chahiye');
  } finally {
    if (server) await server.stop();
    await push.close(); await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('master switch OFF wale user ko server push fan-out nahi karta', async () => {
  const mock = await startMockAppsScript({ secret: SECRET });
  const push = await startMockPushService();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-push-off-'));
  let server;
  try {
    server = await startServer({ STORAGE_BACKEND: '', APPS_SCRIPT_URL: mock.url, APPS_SCRIPT_SECRET: SECRET, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'owner-password', RENDER: 'true', DATA_DIR: dir });
    let cookie = '';
    const call = async (route, method = 'GET', body) => {
      const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { res, json: await res.json().catch(() => ({})) };
    };
    cookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'owner-password' })).res.headers.get('set-cookie').split(';')[0];
    const vapid = (await call('/api/push/vapid')).json.publicKey;
    const ua = makeUA();
    push.state.ua = ua;
    push.state.expectedKey = vapid;
    await call('/api/push/subscribe', 'POST', { subscription: { endpoint: push.url('off-device'), keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } } });

    await call('/api/activity', 'POST', { type: 'settings', details: 'on test' });
    for (let i = 0; i < 40 && !push.state.deliveries.length; i++) await sleep(50);
    assert.equal(push.state.deliveries.length, 1, 'switch ON me push aani chahiye');

    assert.equal((await call('/api/notifications/prefs', 'PUT', { prefs: { enabled: false } })).json.prefs.enabled, false);
    assert.equal((await call('/api/push/status')).json.enabled, false);
    push.state.deliveries.length = 0;
    await call('/api/activity', 'POST', { type: 'settings', details: 'off test' });
    await sleep(600);
    assert.equal(push.state.deliveries.length, 0, '🔕 Notifications OFF hone par koi push nahi jaani chahiye');
    // Feed me entry phir bhi banti hai (history), sirf alert band hota hai.
    const feed = (await call('/api/notifications')).json;
    assert.ok(Array.isArray(feed.items), 'feed kaam karta rahe');
  } finally {
    if (server) await server.stop();
    await push.close(); await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('GV Master edit webhook detects the live snapshot and fans out a real phone push', async () => {
  const push = await startMockPushService();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-gv-push-'));
  const nowIst = new Date(Date.now() + 5.5 * 3600e3);
  const dateCell = `Date(${nowIst.getUTCFullYear()},${nowIst.getUTCMonth()},${nowIst.getUTCDate()})`;
  const gvRows = [{ date: dateCell, cls: '4', tag: 'gv-tag-1', status: 'Active', type: 'Regular' }];
  const columnLabels = Array.from({ length: 21 }, () => '');
  columnLabels[6] = 'CCH'; columnLabels[8] = 'TAG_ID'; columnLabels[13] = 'STATUS';
  columnLabels[15] = 'ISSUE_DATE'; columnLabels[20] = 'TAG_TYPE';
  const gviz = http.createServer((req, res) => {
    const tq = new URL(req.url, 'http://localhost').searchParams.get('tq') || '';
    let table;
    if (tq === 'select * limit 1') {
      table = { cols: columnLabels.map((label, i) => ({ id: `C${i}`, label })), rows: [] };
    } else if (/^select P, G, (?:F, )?I, N, U/i.test(tq)) {
      const hasVClass = /^select P, G, F, I, N, U/i.test(tq);
      const values = (row) => [{ v: row.date }, { v: row.cls }, ...(hasVClass ? [{ v: row.vClass || '' }] : []), { v: row.tag }, { v: row.status }, { v: row.type }];
      table = { cols: (hasVClass ? ['P', 'G', 'F', 'I', 'N', 'U'] : ['P', 'G', 'I', 'N', 'U']).map((id) => ({ id })), rows: gvRows.map((row) => ({ c: values(row) })) };
    } else if (/select P, G, (?:F, )?count\(I\)/i.test(tq)) {
      const totals = new Map();
      gvRows.forEach((row) => totals.set(row.cls, (totals.get(row.cls) || 0) + 1));
      table = { cols: [{ id: 'P' }, { id: 'G' }, { id: 'count-I', type: 'number' }], rows: [...totals].map(([cls, n]) => ({ c: [{ v: dateCell }, { v: cls }, { v: n }] })) };
    } else {
      table = { cols: [{ id: 'date' }, { id: 'class' }, { id: 'master' }, { id: 'count', type: 'number' }], rows: [] };
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table })});`);
  });
  gviz.listen(0, '127.0.0.1');
  await once(gviz, 'listening');
  let server;
  try {
    server = await startServer({
      STORAGE_BACKEND: 'files', DATA_DIR: dir, GVIZ_BASE: `http://127.0.0.1:${gviz.address().port}`,
      APPS_SCRIPT_SECRET: SECRET, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'owner-password'
    });
    let cookie = '';
    const call = async (route, method = 'GET', body) => {
      const res = await fetch(server.base + route, {
        method, headers: { cookie, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      return { res, json: await res.json().catch(() => ({})) };
    };
    cookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'owner-password' })).res.headers.get('set-cookie').split(';')[0];
    const vapid = (await call('/api/push/vapid')).json.publicKey;
    push.state.ua = makeUA();
    push.state.expectedKey = vapid;
    const sub = { endpoint: push.url('gv-device'), keys: { p256dh: push.state.ua.publicKey.toString('base64url'), auth: push.state.ua.authSecret.toString('base64url') } };
    assert.equal((await call('/api/push/subscribe', 'POST', { subscription: sub })).res.status, 200);

    const route = '/api/push/sheet-update';
    const invalid = await call(route, 'POST', { secret: 'wrong-secret', spreadsheetId: '1LkYX746lGZQKhl5ueoKe3kYOo4SNtu47p5-jkVNUiBA', sheet: 'GV Master' });
    assert.equal(invalid.res.status, 401, 'unauthorized Apps Script webhook must be rejected');
    const wrongBook = await call(route, 'POST', { secret: SECRET, spreadsheetId: 'another-book', sheet: 'GV Master' });
    assert.equal(wrongBook.res.status, 403, 'only the configured GV source spreadsheet may trigger checks');
    const otherTab = await call(route, 'POST', { secret: SECRET, spreadsheetId: '1LkYX746lGZQKhl5ueoKe3kYOo4SNtu47p5-jkVNUiBA', sheet: 'Tag Assignment' });
    assert.equal(otherTab.json.ignored, true, 'unrelated tabs are ignored');

    const sheetEdit = { secret: SECRET, spreadsheetId: '1LkYX746lGZQKhl5ueoKe3kYOo4SNtu47p5-jkVNUiBA', sheet: 'GV Master', range: 'P2' };
    const baseline = await call(route, 'POST', sheetEdit);
    assert.equal(baseline.res.status, 200);
    assert.deepEqual(baseline.json.checked, ['gv']);
    assert.deepEqual(baseline.json.changed, [], 'first snapshot establishes a baseline without a false alert');

    gvRows.push({ date: dateCell, cls: '20', tag: 'gv-tag-2', status: 'Active', type: 'Regular' });
    const update = await call(route, 'POST', sheetEdit);
    assert.equal(update.res.status, 200);
    assert.deepEqual(update.json.changed, ['gv'], 'the edit-triggered fresh GV Master read must detect the +1');
    for (let i = 0; i < 40 && !push.state.deliveries.length; i++) await sleep(50);
    assert.equal(push.state.deliveries.length, 1, 'reportUpdate fan-out must send a phone Web Push');
    const delivered = push.state.deliveries[0];
    assert.equal(delivered.status, 201, `push service rejected the GV alert: ${delivered.error}`);
    assert.match(delivered.payload.title, /GV Partner report update/);
    assert.match(delivered.payload.body, /\+1 tags/);
    assert.equal(delivered.payload.type, 'report');

    const feed = await call('/api/notifications');
    assert.ok(feed.json.items.some((item) => item.type === 'report' && item.meta.source === 'gv'), 'the same detected change remains in the in-app notification feed');
    const status = (await call('/api/push/status')).json;
    assert.equal(status.reportWatcher.gv.snapshot.total, 2, 'admin diagnostics expose the latest GV Master snapshot');
    assert.ok(status.reportWatcher.gv.checkedAt, 'admin diagnostics confirm the server-side GV check ran');
    assert.equal(status.lastOk.status, 201, 'admin diagnostics confirm the phone push transport succeeded');
  } finally {
    if (server) await server.stop();
    await push.close();
    await new Promise((resolve) => gviz.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
