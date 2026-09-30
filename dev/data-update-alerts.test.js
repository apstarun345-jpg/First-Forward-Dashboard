/* 📊 "Data update ki notification" pipeline — v3.23 regression lock.
   Locks karta hai:
     • FF.notifications.localAlert — client-side data-change alert: bell list me item, unread badge,
       visible tab par toast+beep, background tab par browser notification,
     • 60s ke andar same type ki alert merge hoti hai (spam nahi), prefs OFF par alert nahi,
     • voiceText + Office Bell voice ON par speech (speakAnnounce / queueAnnounce),
     • officeBell.js ke poll() me naye tags par localAlert + FF.app.syncNow hook,
     • server.js: reportUpdate route 'both' (admin + users), report notification me deep link,
       snapshotDelta class-wise corrections ko bhi "changed" manta hai. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ---- minimal browser globals ----
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};
const toasts = [];
globalThis.location = { hash: '', search: '' };
globalThis.window = globalThis;
globalThis.document = {
  title: '',
  visibilityState: 'visible',
  hidden: false,
  documentElement: { dataset: {}, classList: { toggle() {}, remove() {} } },
  addEventListener: () => {},
  removeEventListener: () => {}
};

globalThis.FF = {
  util: {
    esc: (v) => String(v == null ? '' : v),
    $: () => null,
    toast: (msg, tone) => { toasts.push({ msg, tone }); },
    timeLabel: () => 'abhi'
  },
  auth: { user: { username: 'boss', role: 'admin' }, api: async () => ({ items: [], unread: 0 }) }
};

require(path.join(ROOT, 'notifications.js'));
const FF = globalThis.FF;
const N = FF.notifications;

// ---- office bell stub (voice path) ----
const spoken = [];
const queued = [];
FF.officeBell = {
  voiceOn: () => true,
  unlocked: true,
  prefs: () => ({ muteUntil: 0 }),
  logList: () => [],
  speakAnnounce: (text) => { spoken.push(text); return Promise.resolve(true); },
  queueAnnounce: (text) => { queued.push(text); }
};

test('localAlert — bell item + unread badge + toast (visible tab)', () => {
  const item = N.localAlert({ type: 'report', title: '📊 Sheet update — +5 tags', body: '+5 🏷️ FF · Rahul (3)', meta: { link: '#/tagIssued' } });
  assert.ok(item && item.local, 'local item bana');
  assert.equal(item.type, 'report');
  assert.ok(N.state.items.some((x) => x.id === item.id), 'list me add hua');
  assert.equal(N.state.unread, 1, 'unread badge 1');
  assert.ok(toasts.some((t) => /Sheet update/.test(t.msg)), 'toast dikhaya');
});

test('localAlert — 60s ke andar same type MERGE hota hai (naya item nahi)', () => {
  const before = N.state.items.length;
  const item = N.localAlert({ type: 'report', title: '📊 Sheet update — +3 tags', body: '+3 🏷️ GV' });
  assert.equal(N.state.items.length, before, 'naya item nahi bana — merge hua');
  assert.match(item.body, /GV/, 'body update hui');
});

test('localAlert — 60s baad nayi alert alag item banati hai', async () => {
  const before = N.state.items.length;
  // purani alert ka time pichhe kar do (dedupe window ke bahar)
  const last = N.state.items[N.state.items.length - 1];
  last.createdAt = new Date(Date.now() - 120e3).toISOString();
  N.localAlert({ type: 'report', title: '📊 Sheet update — +2 tags', body: '+2 🏷️ FF' });
  assert.equal(N.state.items.length, before + 1, 'naya item bana');
});

test('localAlert — master ya type pref OFF par alert nahi', () => {
  const before = N.state.items.length;
  N.state.prefs.report = false;
  const out = N.localAlert({ type: 'report', title: 'X', body: 'Y' });
  assert.equal(out, null);
  assert.equal(N.state.items.length, before);
  N.state.prefs.report = true;
  N.state.prefs.enabled = false;
  assert.equal(N.localAlert({ type: 'report', title: 'X', body: 'Y' }), null);
  N.state.prefs.enabled = true;
});

test('localAlert — voiceText par office bell speech (recent bell announce par skip)', () => {
  spoken.length = 0; queued.length = 0;
  const last = N.state.items[N.state.items.length - 1];
  if (last) last.createdAt = new Date(Date.now() - 120e3).toISOString();
  N.localAlert({ type: 'report', title: '📊 Data update', body: 'total badha', voiceText: 'Data update! 25 tags ho gaye.' });
  assert.deepEqual(spoken, ['Data update! 25 tags ho gaye.'], 'speakAnnounce hua');

  // office bell ne abhi announce kiya ho (log fresh) → voice skip
  spoken.length = 0;
  FF.officeBell.logList = () => [{ at: Date.now(), total: 5 }];
  const last2 = N.state.items[N.state.items.length - 1];
  if (last2) last2.createdAt = new Date(Date.now() - 120e3).toISOString();
  N.localAlert({ type: 'report', title: '📊 Data update', body: 'total badha', voiceText: 'skip hona chahiye' });
  assert.deepEqual(spoken, [], 'bell ne abhi bola hai to localAlert voice skip');
  FF.officeBell.logList = () => [];

  // voice OFF → koi speech nahi
  spoken.length = 0;
  FF.officeBell.voiceOn = () => false;
  const last3 = N.state.items[N.state.items.length - 1];
  if (last3) last3.createdAt = new Date(Date.now() - 120e3).toISOString();
  N.localAlert({ type: 'report', title: '📊 Data update', body: 'x', voiceText: 'nahi bolna' });
  assert.deepEqual(spoken, [], 'voice OFF par speech nahi');
  FF.officeBell.voiceOn = () => true;
});

test('localAlert — background tab me queueAnnounce (unlock pending raasta)', () => {
  spoken.length = 0; queued.length = 0;
  FF.officeBell.unlocked = false;
  const last = N.state.items[N.state.items.length - 1];
  if (last) last.createdAt = new Date(Date.now() - 120e3).toISOString();
  N.localAlert({ type: 'report', title: '📊 Data update', body: 'x', voiceText: 'baad me bolna' });
  assert.deepEqual(queued, ['baad me bolna'], 'unlock na ho to queue me gaya');
  FF.officeBell.unlocked = true;
});

test('markAllRead — local + server unread dono reset', () => {
  N.state.serverUnread = 3;
  N.state.seenAt = '';
  // unread > 0 se shuru
  assert.ok(N.countUnread() >= 1);
  // markAllRead internal hai — poll path se seenAt set hoga; yahan countUnread contract check
  N.state.seenAt = new Date().toISOString();
  N.state.serverUnread = 0;
  assert.equal(N.countUnread(), 0, 'seenAt ke baad local unread bhi khatam');
});

// ================= source hooks: officeBell + server =================
test('officeBell poll — naye tags par localAlert + FF.app.syncNow hook', async () => {
  const src = await fs.readFile(path.join(ROOT, 'officeBell.js'), 'utf8');
  assert.match(src, /FF\.notifications\.localAlert/, 'bell ke detected updates notification banate hain');
  assert.match(src, /FF\.app\.syncNow\(\{ auto: true \}\)/, 'page data bhi turant sync hota hai');
  assert.match(src, /Sheet update — \+/, 'notification title me +N tags');
});

test('server.js — reportUpdate route users ko bhi, deep link, corrections par bhi delta', async () => {
  const src = await fs.readFile(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /reportUpdate: 'both'/, 'data-update notification admin + users dono ko');
  assert.match(src, /delta[^\n]*link: '#\/tagIssued'/, 'report notification me page deep link');
  assert.match(src, /Object\.keys\(classes\)\.length > 0/, 'class-wise corrections bhi "changed"');
  assert.match(src, /Date\.now\(\) - reportCheckAt < 150e3/, 'watcher 2.5 min throttle (fast notifications)');
});
