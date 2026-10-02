/* Service worker push tests — sw.js ko ek fake ServiceWorkerGlobalScope me chalakar verify karta hai:
   push payload → OS notification, notification click → sahi app URL (pehle '/sw.js#/targets' ban jaata tha),
   pushsubscriptionchange → re-subscribe + server ko report, aur session na ho to stash (page baad me flush). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://dashboard.test';

class FakeRequest { constructor(url) { this.url = String(url); } }
class FakeResponse {
  constructor(body, init = {}) { this._body = body === undefined ? '' : String(body); this.status = init.status || 200; this.ok = this.status >= 200 && this.status < 300; this.headers = new Map(Object.entries(init.headers || {})); }
  async json() { return JSON.parse(this._body); }
  async text() { return this._body; }
  clone() { return new FakeResponse(this._body, { status: this.status, headers: Object.fromEntries(this.headers) }); }
}
function fakeCaches() {
  const store = new Map();
  const api = {
    store,
    async open(name) {
      if (!store.has(name)) {
        const entries = new Map();
        store.set(name, {
          entries,
          async put(req, res) { entries.set(new FakeRequest(req).url, res); },
          async match(req) { return entries.get(new FakeRequest(req).url) || undefined; },
          async delete(req) { return entries.delete(new FakeRequest(req).url); },
          async addAll(urls) { for (const u of urls) entries.set(new FakeRequest(u).url, new FakeResponse('cached')); },
          async keys() { return [...entries.keys()]; }
        });
      }
      return store.get(name);
    },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
    async match(req) { for (const c of store.values()) { const hit = await c.match(req); if (hit) return hit; } return undefined; }
  };
  return api;
}
function fakeClient(url) {
  return { url, focused: false, navigated: null, async focus() { this.focused = true; return this; }, async navigate(u) { this.navigated = String(u); return this; } };
}
/** sw.js ko load karke uska fake global scope + event dispatch helpers deta hai. */
function loadSW({ vapidKey = 'BVGV0cGxpY2l0LWtleS1mb3ItdGVzdGluZy0xMjM0NTY3ODkw', subscribeFails = false, vapidStatus = 200, subscribeStatus = 200 } = {}) {
  const listeners = new Map();
  const shown = [];
  const opened = [];
  const requests = [];
  const clients = [];
  let subscription = null;
  const subObj = (key) => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
    options: { userVisibleOnly: true, applicationServerKey: keyToBytes(key) },
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/device-1', keys: { p256dh: 'cHVi', auth: 'YXV0aA' } }),
    unsubscribe: async () => { subscription = null; requests.push('unsubscribe'); return true; }
  });
  function keyToBytes(k) {
    // 65-byte uncompressed P-256 point ki tarah behave kare (length + per-byte compare ke liye)
    const src = Buffer.from(String(k), 'utf8');
    const out = Buffer.alloc(65);
    for (let i = 0; i < 65; i++) out[i] = src[i % src.length];
    return new Uint8Array(out);
  }
  const pushManager = {
    async getSubscription() { return subscription; },
    async subscribe(opts) {
      if (subscribeFails) throw new Error('NotAllowedError: push subscribe blocked');
      requests.push('subscribe');
      subscription = subObj(Buffer.from(new Uint8Array(opts.applicationServerKey)).toString('base64'));
      return subscription;
    }
  };
  const registration = {
    scope: `${ORIGIN}/`,
    pushManager,
    async showNotification(title, options) { shown.push({ title, options }); },
    get waiting() { return null; },
    get installing() { return null; },
    get active() { return { postMessage() {} }; },
    addEventListener() {}
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON, URL, URLSearchParams,
    Number, String, Array, Object, Buffer, Uint8Array, Map, Set, Error, RegExp, TextEncoder, TextDecoder,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    Request: FakeRequest, Response: FakeResponse, Headers: Map, AbortSignal: { timeout: () => ({}) },
    caches: fakeCaches(),
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener() {},
    skipWaiting: async () => { requests.push('skipWaiting'); },
    fetch: async (url, opts = {}) => {
      const u = String(url);
      requests.push(`${opts.method || 'GET'} ${u}`);
      if (u.includes('/api/push/vapid')) return vapidStatus === 200 ? new FakeResponse(JSON.stringify({ publicKey: vapidKey }), { status: 200 }) : new FakeResponse('{"error":"Login required"}', { status: vapidStatus });
      if (u.includes('/api/push/subscribe')) return subscribeStatus === 200 ? new FakeResponse('{"ok":true}', { status: 200 }) : new FakeResponse('{"error":"Login required"}', { status: subscribeStatus });
      return new FakeResponse('asset', { status: 200 });
    },
    location: { href: `${ORIGIN}/sw.js`, origin: ORIGIN, pathname: '/sw.js', protocol: 'https:' },
    registration,
    clients: {
      async matchAll() { return clients; },
      async openWindow(url) { const c = fakeClient(String(url)); opened.push(c); return c; },
      async claim() { requests.push('claim'); },
      async get(id) { return clients.find((c) => c.url === id) || null; }
    }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx, { filename: 'sw.js' });
  const fire = async (type, event) => {
    const fns = listeners.get(type) || [];
    const waits = [];
    const ev = { ...event, waitUntil: (p) => waits.push(p) };
    for (const fn of fns) await fn.call(sandbox, ev);
    await Promise.allSettled(waits);
    return ev;
  };
  return { fire, shown, opened, requests, clients, registration, sandbox, hasListener: (t) => (listeners.get(t) || []).length > 0, setSubscription: (k) => { subscription = subObj(k); }, getSubscription: () => subscription, caches: sandbox.caches };
}

test('push event shows an OS-panel notification with vibration, sound-off support and a deep link', async () => {
  const sw = loadSW();
  await sw.fire('push', { data: { json: () => ({ title: '📊 FF report update', body: '27 Sep: +42 tags', tag: 'report', link: '#/targets?month=2026-09', sound: true, persist: true }) } });
  assert.equal(sw.shown.length, 1, 'har push par notification dikhna zaroori hai (Chrome requirement)');
  const n = sw.shown[0];
  assert.equal(n.title, '📊 FF report update');
  assert.equal(n.options.body, '27 Sep: +42 tags');
  assert.deepEqual([...n.options.vibrate], [200, 100, 200]); // cross-realm array
  assert.equal(n.options.requireInteraction, true);
  assert.equal(n.options.data.link, '#/targets?month=2026-09');

  // sound:false → vibration nahi
  await sw.fire('push', { data: { json: () => ({ title: 'silent one', body: 'x', sound: false }) } });
  assert.equal(sw.shown[1].options.vibrate, undefined);
  // Kharab/empty payload par bhi notification (warna Chrome future push rok deta hai)
  await sw.fire('push', { data: null });
  assert.ok(sw.shown[2].title.length > 0);
  await sw.fire('push', { data: { json: () => { throw new Error('bad json'); } } });
  assert.ok(sw.shown[3].title.length > 0);
});

test('notification click opens the app route, not /sw.js', async () => {
  const sw = loadSW();
  await sw.fire('push', { data: { json: () => ({ title: 't', body: 'b', link: '#/targets?month=2026-09&tab=targets' }) } });
  const close = () => {};
  // App band: koi client nahi → openWindow app root + hash par hona chahiye
  await sw.fire('notificationclick', { notification: { close, data: { link: '#/targets?month=2026-09&tab=targets' } } });
  assert.equal(sw.opened.length, 1);
  assert.equal(sw.opened[0].url, `${ORIGIN}/#/targets?month=2026-09&tab=targets`, 'click par app khulni chahiye, sw.js nahi');

  // App khuli hai: wahi client focus + navigate
  const existing = fakeClient(`${ORIGIN}/#/home`);
  sw.clients.push(existing);
  await sw.fire('notificationclick', { notification: { close, data: { link: '#/gvDashboard' } } });
  assert.equal(existing.navigated, `${ORIGIN}/#/gvDashboard`);
  assert.equal(existing.focused, true);
});

test('v3.36 voice: push ki bolne wali line queue hoti hai aur khuli app ko turant milti hai', async () => {
  const sw = loadSW();
  const heard = [];
  sw.clients.push({ url: `${ORIGIN}/#/home`, postMessage: (m) => heard.push(m), focus() {}, navigate() {} });
  await sw.fire('push', {
    data: {
      json: () => ({
        id: 'n1', title: '🔴 Cover alert', body: 'VC4 sirf 3 din', tag: 'alert', link: '#/stock',
        voice: 'Cover alert. VC4 me sirf teen din bache hain.', speak: true, sound: true, tone: 'alert',
        badge: 4, persist: true, user: 'owner', lang: 'hi-IN',
        actions: [{ action: 'open', title: 'Kholo' }, { action: 'dismiss', title: 'Theek hai' }]
      })
    }
  });
  assert.equal(sw.shown.length, 1, 'notification turant dikhni chahiye (app band ho tab bhi text)');
  const n = sw.shown[0];
  assert.equal(n.options.data.voice, 'Cover alert. VC4 me sirf teen din bache hain.');
  assert.equal(n.options.requireInteraction, true);
  assert.equal(n.options.lang, 'hi-IN');
  assert.deepEqual([...n.options.vibrate], [250, 70, 250], 'alert tone ka vibration pattern');
  assert.equal(n.options.actions.length, 2, 'Kholo / Theek hai actions panel me jaate hain');
  assert.equal(heard.length, 1, 'khuli hui app ko live voice message jaana chahiye');
  assert.equal(heard[0].type, 'ff-speak-push');
  assert.match(heard[0].item.text, /Cover alert/);
  assert.equal(heard[0].item.user, 'owner', 'shared device par dusre user ko ye line nahi bolni');
  // App band ho to bhi line queue me rehti hai — app khulte hi pushVoice.js ise bolta hai.
  const queued = await sw.caches.open('ff-voice-v1').then((c) => c.match('/__ff_voice__/pending').then((r) => (r ? r.json() : [])));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].id, 'n1');

  // Page ne bol kar suna diya → ack par job queue se hat jaati hai.
  await sw.fire('message', { data: { type: 'ff-voice-ack', id: 'n1' } });
  const after = await sw.caches.open('ff-voice-v1').then((c) => c.match('/__ff_voice__/pending').then((r) => (r ? r.json() : [])));
  assert.equal(after.length, 0, 'ack ke baad job queue me nahi rehni chahiye');

  // "Theek hai" action = user ne dekh liya → voice catch-up queue se bhi hata do.
  await sw.fire('push', { data: { json: () => ({ id: 'n2', title: 't', voice: 'line', speak: true }) } });
  await sw.fire('notificationclick', { action: 'dismiss', notification: { close() {}, data: { id: 'n2', link: '' } } });
  assert.equal(sw.opened.length, 0, 'dismiss par app window nahi khulni chahiye');
  const afterDismiss = await sw.caches.open('ff-voice-v1').then((c) => c.match('/__ff_voice__/pending').then((r) => (r ? r.json() : [])));
  assert.equal(afterDismiss.length, 0);
});

test('v3.36 voice: speak:false / sound off par koi voice job nahi banti, badge bhi set hota hai', async () => {
  const sw = loadSW();
  const badges = [];
  sw.sandbox.navigator = { setAppBadge: async (n) => badges.push(n), clearAppBadge: async () => badges.push(0) };
  await sw.fire('push', { data: { json: () => ({ id: 'silent', title: 't', body: 'b', voice: 'ye nahi bolna', speak: false, badge: 3 }) } });
  await sw.fire('push', { data: { json: () => ({ id: 'nom', title: 't2', body: 'b2', speak: true, voice: '', badge: 5 }) } });
  const queued = await sw.caches.open('ff-voice-v1').then((c) => c.match('/__ff_voice__/pending').then((r) => (r ? r.json() : [])));
  assert.equal(queued.length, 0, 'speak:false ya khali voice par queue me kuch nahi jaata');
  assert.deepEqual(badges, [3, 5], 'app icon badge setAppBadge se update hota hai');
  assert.equal(sw.shown.length, 2, 'text notification phir bhi dikhni chahiye');
});

test('pushsubscriptionchange re-subscribes with the current VAPID key and reports to the server', async () => {
  const sw = loadSW();
  sw.setSubscription('old-rotated-key-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  await sw.fire('pushsubscriptionchange', {});
  assert.ok(sw.requests.includes('unsubscribe'), 'purani (dead) subscription hatao');
  assert.ok(sw.requests.includes('subscribe'), 'nayi subscription current key se banao');
  assert.ok(sw.requests.some((r) => r.startsWith('POST') && r.includes('/api/push/subscribe')), 'server ko nayi subscription bhejo');
  assert.equal(sw.getSubscription().endpoint, 'https://fcm.googleapis.com/fcm/send/device-1');
});

test('pushsubscriptionchange stashes the subscription when the server POST is not authorised', async () => {
  const sw = loadSW({ subscribeStatus: 401 });
  await sw.fire('pushsubscriptionchange', {});
  const stashed = await sw.caches.match(new FakeRequest('/__ff_push_stash__/pending'));
  assert.ok(stashed, 'session expire hone par subscription stash honi chahiye (warna push hamesha ke liye dead)');
  const payload = await stashed.json();
  assert.ok(payload.subscription.endpoint, 'stash me subscription honi chahiye');

  // Page khulte hi flush → server ko chali jaati hai
  const sw2 = loadSW({});
  await sw2.caches.open('ff-push-stash-v1').then((c) => c.put(new FakeRequest('/__ff_push_stash__/pending'), new FakeResponse(JSON.stringify(payload))));
  await sw2.fire('message', { data: { type: 'ff-push-flush' } });
  assert.ok(sw2.requests.some((r) => r.startsWith('POST') && r.includes('/api/push/subscribe')), 'stashed subscription server ko bheji gayi');
  assert.equal(await sw2.caches.match(new FakeRequest('/__ff_push_stash__/pending')), undefined, 'flush ke baad stash saaf');
});

test('pushsubscriptionchange without a session (no VAPID key) fails quietly instead of crashing', async () => {
  const sw = loadSW({ vapidStatus: 401 });
  await sw.fire('pushsubscriptionchange', {});
  assert.ok(!sw.requests.includes('subscribe'), 'bina key ke subscribe nahi hona chahiye');
  assert.equal(await sw.caches.match(new FakeRequest('/__ff_push_stash__/pending')), undefined);
});

test('message handler: local panel test and forced re-subscribe', async () => {
  const sw = loadSW();
  await sw.fire('message', { data: { type: 'ff-local-test' } });
  assert.equal(sw.shown.length, 1, 'panel test turant OS notification dikhaye');
  assert.match(sw.shown[0].title, /Test/i);
  sw.requests.length = 0;
  await sw.fire('message', { data: { type: 'ff-push-resubscribe', reason: 'manual' } });
  assert.ok(sw.requests.includes('subscribe'), 'manual re-subscribe kaam kare');
});

test('install + activate cache the app shell and clean old caches', async () => {
  const sw = loadSW();
  await sw.fire('install', {});
  assert.ok(sw.requests.includes('skipWaiting'), 'naya SW turant activate ho (push fixes ka wait na karna pade)');
  await sw.caches.open('apnapayment-v9').then((c) => c.put(new FakeRequest('/x'), new FakeResponse('old')));
  await sw.fire('activate', {});
  assert.equal(await sw.caches.keys().then((k) => k.includes('apnapayment-v9')), false, 'purana cache delete');
  assert.ok(sw.requests.includes('claim'));
});
