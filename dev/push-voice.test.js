/* 🔊 v3.36 — CLOSED-APP VOICE regression (pushVoice.js).

   Kya lock karte hain:
     • app band hone ke dauraan push aaye → sw.js job queue karta hai → app khulte hi `flush()`
       wahi line bolta hai aur queue se hata deta hai (voice catch-up),
     • live push (tab khula/background) par bhi wahi raasta chalta hai,
     • saare switches ka respect: master OFF / sound OFF / voice pref OFF → kuch nahi bolta,
     • shared device: dusre username ki job us user ke liye queue me hi rehti hai,
     • autoplay block hone par job delete NAHI hoti + user ko tap karne ka nudge milta hai,
     • test() se demo line boli jaati hai (Settings ka 🔊 Closed-app voice test button). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tick = (ms = 12) => new Promise((r) => setTimeout(r, ms));
/** Condition true hone tak (max ms) intezaar — flush apni line bolne me time leta hai. */
const waitFor = async (cond, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await tick(80); }
  return !!cond();
};

// ---- fake browser -------------------------------------------------------------------------------
const ls = new Map();
const handlers = {};
const cacheStore = new Map();          // sw.js + page ek hi Cache Storage share karte hain
const VOICE_KEY = '/__ff_voice__/pending';
const spoken = [];
const toasts = [];
let speakWorks = true;
let noteVoicedCalls = 0;

globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.document = {
  hidden: false, visibilityState: 'visible', readyState: 'complete',
  addEventListener: (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); },
  removeEventListener: () => {},
  querySelector: () => null
};
let swMessageHandler = null;
// Node 22 me `navigator` getter-only global hai — defineProperty se replace karo.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, writable: true,
  value: {
    serviceWorker: {
      controller: { postMessage() {} },
      addEventListener: (type, fn) => { if (type === 'message') swMessageHandler = fn; }
    }
  }
});
globalThis.caches = {
  async open() {
    return {
      async put(req, res) { cacheStore.set(String(req), await res.text()); },
      async match(req) { const body = cacheStore.get(String(req)); return body === undefined ? undefined : { json: async () => JSON.parse(body) }; }
    };
  }
};
const seed = (jobs) => cacheStore.set(VOICE_KEY, JSON.stringify(jobs));
const queueNow = () => JSON.parse(cacheStore.get(VOICE_KEY) || '[]');

globalThis.FF = {
  util: { toast: (msg, kind) => toasts.push({ msg, kind }) },
  config: {},
  auth: { user: { username: 'owner' } },
  notifications: {
    prefs: { enabled: true, sound: true, voice: true },
    noteVoiced: () => { noteVoicedCalls++; }
  },
  officeBell: {
    unlocked: true,
    lastSpokeAt: 0,
    speakAnnounce: async (text) => { if (!speakWorks) return false; spoken.push(text); return true; },
    queueAnnounce: (text) => { spoken.push(`queued:${text}`); },
    unlock: () => true,
    isVoiceOn: () => true,
    prefs: () => ({ muteUntil: 0 })
  }
};
require(path.join(ROOT, 'pushVoice.js'));
const V = globalThis.FF.pushVoice;

test('app band hone ke dauraan aaye alerts app khulte hi bole jaate hain (catch-up)', async () => {
  seed([
    { id: 'a1', at: Date.now(), text: 'Cover alert. VC4 me sirf teen din bache hain.', type: 'alert', user: 'owner' },
    { id: 'a2', at: Date.now(), text: 'Naya signup aaya hai.', type: 'signup', user: 'owner' }
  ]);
  const spokenCount = await V.flush('test');
  assert.equal(spokenCount, 2, 'dono lines bolni chahiye');
  assert.match(spoken[0], /Cover alert/);
  assert.match(spoken[1], /Naya signup/);
  assert.equal(queueNow().length, 0, 'bolne ke baad queue khali');
  assert.ok(noteVoicedCalls >= 2, 'poll wale duplicate-guard ko bataya gaya (wahi khabar dobara na bole)');
});

test('shared device: dusre user ki job uske liye queue me hi rehti hai', async () => {
  await tick(950); // flush ka minimum gap
  seed([{ id: 'b1', at: Date.now(), text: 'Mera alert.', type: 'alert', user: 'someone-else' }]);
  const n = await V.flush('test');
  assert.equal(n, 0, 'doosre user ki line nahi bolni');
  assert.equal(spoken.length, 2, 'koi nayi utterance nahi');
  assert.equal(queueNow().length, 1, 'job queue me safe rehti hai');
  seed([]);
});

test('switches: master / sound / voice pref OFF ya Office Bell voice OFF → koi awaaz nahi', async () => {
  await tick(950);
  seed([{ id: 'c1', at: Date.now(), text: 'Ye nahi bolna.', type: 'alert', user: 'owner' }]);
  FF.notifications.prefs = { enabled: true, sound: true, voice: false };
  assert.equal(await V.flush('test'), 0, 'voice pref OFF');
  FF.notifications.prefs = { enabled: false, sound: true, voice: true };
  assert.equal(await V.flush('test'), 0, 'master switch OFF');
  FF.notifications.prefs = { enabled: true, sound: false, voice: true };
  assert.equal(await V.flush('test'), 0, 'sound OFF');
  FF.notifications.prefs = { enabled: true, sound: true, voice: true };
  FF.officeBell.isVoiceOn = () => false;
  assert.equal(await V.flush('test'), 0, 'Office Bell voice OFF');
  FF.officeBell.isVoiceOn = () => true;
  assert.equal(queueNow().length, 1, 'blocked flush ke baad bhi job queue me hai');
  seed([]);
});

test('autoplay block hone par job delete nahi hoti + tap karne ka nudge milta hai', async () => {
  await tick(950);
  speakWorks = false;
  toasts.length = 0;
  seed([{ id: 'd1', at: Date.now(), text: 'Blocked line.', type: 'alert', user: 'owner' }]);
  const n = await V.flush('test');
  assert.equal(n, 0);
  assert.equal(queueNow().length, 1, 'unlock hone par dobara try hoga — job bekaar nahi jaani chahiye');
  assert.ok(toasts.some((t) => /tap karo/.test(t.msg)), `nudge toast chahiye — got ${JSON.stringify(toasts)}`);
  speakWorks = true;
  // Gesture (tap) par dobara flush chalna chahiye — yahin asli unlock hota hai.
  await tick(950);
  document.hidden = false;
  for (const fn of handlers.pointerdown || []) fn({});
  await tick(400);
  assert.equal(queueNow().length, 0, 'tap ke baad line bol kar queue saaf');
  assert.ok(spoken.some((t) => /Blocked line/.test(t)));
});

test('live push message (tab background me khula) par bhi turant flush hota hai', async () => {
  await tick(950);
  seed([{ id: 'e1', at: Date.now(), text: 'Live push line.', type: 'report', user: 'owner' }]);
  // pushVoice.js ne navigator.serviceWorker par listener lagaya hai — use fire karo.
  assert.ok(swMessageHandler, 'SW message listener bind hona chahiye');
  swMessageHandler({ data: { type: 'ff-speak-push', item: { id: 'e1', text: 'Live push line.', user: 'owner' } } });
  await waitFor(() => spoken.some((t) => /Live push line/.test(t)));
  assert.ok(spoken.some((t) => /Live push line/.test(t)), 'live push par bhi awaaz');
  await waitFor(() => queueNow().length === 0);
  assert.equal(queueNow().length, 0);
});

test('test() demo line bolta hai aur local switch off karne par kuch nahi', async () => {
  spoken.length = 0;
  const ok = await V.test();
  assert.equal(ok, true);
  assert.ok(spoken.some((t) => /Test alert/.test(t)));
  assert.equal(V.setLocalOn(false), false);
  assert.equal(V.isOn(), false, 'local switch OFF hone par voice nahi');
  V.setLocalOn(true);
});
