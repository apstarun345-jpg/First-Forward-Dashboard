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
  const state = { expectedKey: null, ua: null, deliveries: [], failWith: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const rec = { url: req.url, ttl: req.headers.ttl, urgency: req.headers.urgency, encoding: req.headers['content-encoding'], status: 0, payload: null, error: null };
      state.deliveries.push(rec);
      if (state.failWith) { rec.status = state.failWith; rec.error = 'forced'; res.writeHead(state.failWith); return res.end(); }
      const m = /^WebPush (.+)$/.exec(req.headers.authorization || '');
      if (!m) { rec.status = 401; rec.error = 'no VAPID JWT'; res.writeHead(401); return res.end(); }
      const [h, p, s] = m[1].split('.');
      let verified = false;
      try {
        const pub = crypto.createPublicKey({ key: Buffer.from(state.expectedKey, 'base64url'), format: 'der', type: 'spki' });
        verified = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
        rec.aud = JSON.parse(Buffer.from(p, 'base64url').toString()).aud;
      } catch (err) { rec.error = `jwt: ${err.message}`; }
      // FCM rejects a JWT that is not signed by the key the subscription was created with.
      if (!verified) { rec.status = 403; rec.error = rec.error || 'VAPID signature does not match the subscription applicationServerKey'; res.writeHead(403); return res.end(); }
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
    push.state.expectedKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');

    await call('/api/activity', 'POST', { type: 'settings', details: 'stale key test' });
    for (let i = 0; i < 40 && !push.state.deliveries.length; i++) await sleep(50);
    assert.equal(push.state.deliveries[0].status, 403, 'mock should reject the mismatched VAPID key');
    for (let i = 0; i < 40; i++) { const s = (await call('/api/push/status')).json; if (s.subs === 0) break; await sleep(50); }
    const status = (await call('/api/push/status')).json;
    assert.equal(status.subs, 0, 'a subscription the push service refuses (403) must be removed so the client re-subscribes');
    assert.equal(status.lastError.status, 403, 'the failure must be visible for diagnostics instead of failing silently');
    assert.match(server.log(), /push delivery failed/i, 'failed deliveries must be logged');

    // Self-test endpoint: reports per-device delivery results instead of guessing.
    await call('/api/push/subscribe', 'POST', { subscription: { endpoint: push.url('device-3'), keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } } });
    push.state.expectedKey = (await call('/api/push/vapid')).json.publicKey;
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
function loadNotifications({ serverKey, existingKey, permission = 'granted', pwa = false, ios = false, popup = null }) {
  const calls = [];
  const ua = makeUA();
  const b64ToBytes = (str) => { const pad = '='.repeat((4 - (str.length % 4)) % 4); const b = Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64'); return new Uint8Array(b); };
  const makeSub = (key) => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/device',
    options: { userVisibleOnly: true, applicationServerKey: b64ToBytes(key).buffer },
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/device', keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } }),
    unsubscribe: async () => { calls.push('unsubscribe'); state.currentSub = null; return true; }
  });
  const state = { currentSub: existingKey ? makeSub(existingKey) : null, posted: [] };
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
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { visibilityState: 'visible', title: 'x', addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null },
    matchMedia: (q) => ({ matches: !!pwa && /standalone|fullscreen/.test(String(q)), addEventListener() {} }),
    Notification: { permission, requestPermission: async () => permission },
    navigator: { userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' : 'Android Chrome', serviceWorker: { ready: Promise.resolve(reg), getRegistration: async () => reg, register: async () => reg }, vibrate: () => true, onLine: true, permissions: { query: async () => ({ state: permission, addEventListener() {} }) } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  sandbox.FF = {
    config: {},
    util: { $: (sel) => (sel === '#notification-pop' && popup ? popup : (sel === '#notification-btn' ? null : null)), toast: (m, k) => calls.push(`toast:${k}`), esc: (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])), timeLabel: () => 'now' },
    auth: {
      user: { username: 'owner', role: 'admin', notifyAccess: true },
      api: async (route, method, body) => {
        calls.push(`${method || 'GET'} ${route}`);
        if (route === '/api/push/vapid') return { publicKey: serverKey };
        if (route === '/api/push/subscribe') { state.posted.push(body.subscription); return { ok: true }; }
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
  const staleKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const freshKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');

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

test('bell panel always offers a way to turn on OS-panel notifications (mobile, PWA not installed)', async () => {
  const key = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const mkPopup = () => { const el = { hidden: true, _html: '' }; Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: (v) => { el._html = String(v); } }); return el; };

  // Android Chrome, app installed NAHI hai, permission abhi maangi nahi gayi.
  // Purana code yahan sirf "install app" hint dikhata tha — enable button reachable hi nahi tha.
  const pop1 = mkPopup();
  const a = loadNotifications({ serverKey: key, permission: 'default', popup: pop1 });
  a.FF.notifications.state.items = [];
  a.FF.notifications.render();
  assert.match(pop1.innerHTML, /data-notify-enable/, 'permission maangne ka button har haal me dikhna chahiye');
  assert.match(pop1.innerHTML, /Mobile notifications on karo/);

  // iOS Safari, PWA installed nahi → install hint + button dono.
  const pop2 = mkPopup();
  const b = loadNotifications({ serverKey: key, permission: 'default', popup: pop2, ios: true });
  b.FF.notifications.render();
  assert.match(pop2.innerHTML, /data-notify-enable/);
  assert.match(pop2.innerHTML, /Add to Home Screen/);

  // Permission granted but subscription dead (VAPID rotate / server ne drop ki) → retry + diagnostics.
  const pop3 = mkPopup();
  const c = loadNotifications({ serverKey: key, permission: 'granted', existingKey: null, popup: pop3 });
  c.FF.notifications.state.pushOn = false;
  c.FF.notifications.state.pushError = 'server par VAPID key nahi';
  c.FF.notifications.state.pushStatus = { subs: 0, lastError: { status: 403, error: 'invalid VAPID key' } };
  c.FF.notifications.render();
  assert.match(pop3.innerHTML, /data-notify-enable/, 'granted-but-broken state me retry button chahiye');
  assert.match(pop3.innerHTML, /403/, 'failure ka status user ko dikhna chahiye (silent nahi)');

  // Push ON → status + dono test buttons.
  const pop4 = mkPopup();
  const d = loadNotifications({ serverKey: key, permission: 'granted', existingKey: key, popup: pop4 });
  d.FF.notifications.state.pushOn = true;
  d.FF.notifications.state.pushDevices = 2;
  d.FF.notifications.state.pushStatus = { subs: 2, lastOk: { at: new Date().toISOString(), status: 201 } };
  d.FF.notifications.render();
  assert.match(pop4.innerHTML, /push ON/);
  assert.match(pop4.innerHTML, /data-notify-panel-test/);
  assert.match(pop4.innerHTML, /data-notify-push-test/);
  assert.match(pop4.innerHTML, /2 device registered/);
});
