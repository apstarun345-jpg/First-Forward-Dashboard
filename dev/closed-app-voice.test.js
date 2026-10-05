/* 🔊 v3.36 — "App/web band ho tab bhi voice + text" server regression.

   Lock karte hain:
     • har push payload me `voice` (bolne layak saaf line), `speak`, `user` aur unread `badge` jaate hain
       — app band hone par OS panel text+sound dikhata hai aur ye line voice catch-up ke liye queue hoti hai,
     • notification ke actions ('Kholo' / 'Theek hai') important types ke saath jaate hain,
     • voice pref OFF karne par **text push phir bhi** jaata hai, sirf awaaz band hoti hai
       (pref ko push rokne ka bahana nahi banna chahiye),
     • payload me emoji/symbols nahi hote (Web Speech unhe "blue square" bol deta hai). */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- RFC 8291 client-side (server jis key se encrypt karta hai, usi se decrypt karo) -------------
function hkdf(salt, ikm, info, len) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  let t = Buffer.alloc(0), out = Buffer.alloc(0), i = 1;
  while (out.length < len) {
    t = crypto.createHmac('sha256', prk).update(Buffer.concat([t, Buffer.from(info), Buffer.from([i])])).digest();
    out = Buffer.concat([out, t]); i++;
  }
  return out.subarray(0, len);
}
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
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let i = plain.length - 1;
  while (i >= 0 && plain[i] === 0) i--;
  return JSON.parse(plain.subarray(0, i).toString('utf8'));
}

/** Push service ka simple capture (kisi bhi VAPID key ko 201 milta hai — yahan delivery nahi, payload test hai). */
function startMockPush() {
  const state = { deliveries: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rec = { url: req.url, body: Buffer.concat(chunks), status: 201, payload: null, error: null, at: Date.now() };
      try { rec.payload = decryptPush(rec.body, state.ua); } catch (err) { rec.error = err.message; }
      state.deliveries.push(rec);
      res.writeHead(201); res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({
      state, origin: `http://127.0.0.1:${server.address().port}`,
      url: (id) => `http://127.0.0.1:${server.address().port}/wp/${id}`,
      close: () => new Promise((r) => server.close(r))
    });
  }));
}

async function startServer(dir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', RENDER: '', GVIZ_BASE: 'https://docs.google.com' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stderr.on('data', (d) => { log += d; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Startup timeout: ' + log)); }, 25000);
    child.stdout.on('data', (d) => {
      log += d;
      const m = log.match(/http:\/\/0\.0\.0\.0:(\d+)/);
      if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Exited ${code}: ${log}`)); });
  });
  return { base, log: () => log, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}
const waitForPush = async (push, n = 1, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && push.state.deliveries.length < n) await sleep(50);
  return push.state.deliveries.length >= n;
};
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

test('push me voice line + badge jaate hain; voice pref OFF par text push phir bhi aata hai', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-voice-'));
  const push = await startMockPush();
  let server;
  try {
    server = await startServer(dir);
    let cookie = '';
    const call = async (route, method = 'GET', body) => {
      const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { res, json: await res.json().catch(() => ({})) };
    };
    cookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).res.headers.get('set-cookie').split(';')[0];

    // Default prefs: voice ON.
    const prefs = (await call('/api/notifications/prefs')).json.prefs;
    assert.equal(prefs.voice, true, 'voice pref default ON hona chahiye (warna voice kabhi aayegi hi nahi)');

    const ua = makeUA();
    push.state.ua = ua;
    await call('/api/push/subscribe', 'POST', { subscription: { endpoint: push.url('device-voice'), keys: { p256dh: ua.publicKey.toString('base64url'), auth: ua.authSecret.toString('base64url') } } });

    // 1) Server push test → payload me voice + badge + user
    const out = await call('/api/push/test', 'POST', {});
    assert.equal(out.res.status, 200, JSON.stringify(out.json));
    assert.ok(await waitForPush(push, 1), 'test push deliver honi chahiye');
    const first = push.state.deliveries[0];
    assert.equal(first.status, 201, `mock push 201 deta hai — got ${first.error}`);
    const p1 = first.payload;
    assert.match(p1.title, /Test push/i);
    assert.equal(p1.speak, true, 'voice pref ON hone par speak:true');
    assert.ok(p1.voice && p1.voice.length > 10, `bolne wali line chahiye — got ${JSON.stringify(p1.voice)}`);
    assert.ok(!EMOJI.test(p1.voice), `voice line me emoji nahi hone chahiye: ${p1.voice}`);
    assert.equal(p1.user, 'owner', 'shared device par sahi user ke liye voice');
    assert.equal(typeof p1.badge, 'number', 'unread badge number');
    assert.match(p1.lang, /^hi/, 'Hindi voice line ke liye lang');

    // 2) Ek asli notification (signup) bhi voice + actions ke saath jaani chahiye
    push.state.deliveries.length = 0;
    await fetch(server.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'voicecheck', name: 'Voice Check', email: 'vc@example.test', password: 'voice-pass-1' }) });
    assert.ok(await waitForPush(push, 1), 'signup notification admin tak push honi chahiye');
    const p2 = push.state.deliveries.find((d) => d.payload && d.payload.type === 'signup').payload;
    assert.ok(p2, 'signup push mili');
    assert.equal(p2.speak, true);
    assert.match(p2.voice, /Voice Check|signup/i, `voice line me khabar honi chahiye: ${p2.voice}`);
    assert.ok(Array.isArray(p2.actions) && p2.actions.some((a) => a.action === 'dismiss'), 'actions me "Theek hai" hona chahiye');
    assert.ok(Number(p2.badge) >= 1, 'naye notification par badge badhta hai');

    // 3) voice OFF → sirf awaaz band, text push chalu (pref push rokne ka bahana nahi)
    push.state.deliveries.length = 0;
    const saved = (await call('/api/notifications/prefs', 'PUT', { prefs: { voice: false } })).json;
    assert.equal(saved.prefs.voice, false);
    await sleep(5100); // /api/push/test ka 5s rate-limit
    const out2 = await call('/api/push/test', 'POST', {});
    assert.equal(out2.res.status, 200, JSON.stringify(out2.json));
    assert.ok(await waitForPush(push, 1), 'voice OFF ke baad bhi text push aani chahiye');
    const p3 = push.state.deliveries[0].payload;
    assert.equal(p3.speak, false);
    assert.equal(p3.voice, '', 'voice OFF par koi bolne wali line nahi');
    assert.ok(p3.title && p3.body, 'text notification phir bhi poori jaati hai');
  } finally {
    if (server) await server.stop();
    await push.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
