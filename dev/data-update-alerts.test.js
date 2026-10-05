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
  assert.match(src, /REPORT_CHECK_INTERVALS = Object\.freeze\(\{ ff: 150e3, gv: 15e3 \}\)/, 'GV watcher runs every 15s while FF remains throttled');
  assert.match(src, /gvTodayFeed\(!!force\)/, 'GV alert snapshot uses the same live GV Master feed as Home');
  assert.match(src, /setInterval\(\(\) => checkReports\(false\)\.catch\(\(\) => \{\}\), 15e3\)/, 'closed-app server poll stays alive');
  assert.match(src, /providerChanged = source === 'gv'/, 'old EIR-based GV snapshots are safely re-baselined');
});

test('GV header resolution ignores bare column-letter IDs without weakening real heading matches', async () => {
  const src = await fs.readFile(path.join(ROOT, 'server.js'), 'utf8');
  const normalizeStart = src.indexOf('function normalizeServerHeading(v) {');
  const start = src.indexOf('function serverHeaderMatches(label, want) {', normalizeStart);
  const end = src.indexOf('\n}', start) + 2;
  assert.ok(normalizeStart >= 0 && start > normalizeStart && end > start, 'safe header matcher exists');
  const matches = new Function(`${src.slice(normalizeStart, end)}; return serverHeaderMatches;`)();
  assert.equal(matches('A', 'DATE'), false, 'bare column A is not mistaken for a DATE header');
  assert.equal(matches('C', 'CCH'), false, 'bare column C is not mistaken for CCH');
  assert.equal(matches('Issue Date', 'DATE'), true, 'a real multi-word date header still matches');
  assert.equal(matches('Tag ID Number', 'TAG_ID'), true, 'specific GV tag-ID header still matches');
});

test('snapshotDelta compares new-day counts to zero and does not alert on an empty date rollover', async () => {
  const src = await fs.readFile(path.join(ROOT, 'server.js'), 'utf8');
  const start = src.indexOf('function snapshotDelta(prev, next) {');
  const end = src.indexOf('\nfunction deltaText(delta) {', start);
  assert.ok(start >= 0 && end > start, 'server snapshot delta helper exists');
  const delta = new Function(`${src.slice(start, end)}; return snapshotDelta;`)();
  assert.equal(delta(
    { date: '2026-10-04', total: 12, classes: { VC4: 12 } },
    { date: '2026-10-05', total: 0, classes: {} }
  ).changed, false, 'midnight zero baseline is not a data-change notification');
  assert.deepEqual(delta(
    { date: '2026-10-04', total: 12, classes: { VC4: 12 } },
    { date: '2026-10-05', total: 2, classes: { VC20: 2 } }
  ), { total: 2, classes: { VC20: 2 }, changed: true }, 'new-day count is +2, not -10 vs yesterday');
  assert.deepEqual(delta(
    { date: '2026-10-05', total: 3, classes: { VC4: 2, VC20: 1 } },
    { date: '2026-10-05', total: 3, classes: { VC4: 1, VC20: 2 } }
  ), { total: 0, classes: { VC4: -1, VC20: 1 }, changed: true }, 'class corrections still notify at same total');
});

test('localAlert — office bell ka voiceOn BOOLEAN GETTER ho to bhi voice chalti hai (v3.24 fix)', () => {
  // 🐞 Asli bug: officeBell.js me `get voiceOn()` boolean deta hai, function nahi. notifications.js
  // purana code `bell.voiceOn ? bell.voiceOn() : true` chalta tha → "bell.voiceOn is not a function"
  // TypeError poore localAlert ko maar deta tha — notification aati thi par **koi voice nahi** aati
  // thi (UI render tak nahi pahunchta tha). Ab teeno shapes chalti hain.
  spoken.length = 0; queued.length = 0;
  const real = FF.officeBell;
  const getterBell = {
    unlocked: true,
    get voiceOn() { return true; },            // ← asli officeBell.js jaisa
    isVoiceOn: () => true,
    get lastSpokeAt() { return 0; },
    prefs: () => ({ muteUntil: 0 }),
    logList: () => [],
    speakAnnounce: (text) => { spoken.push(text); return Promise.resolve(true); },
    queueAnnounce: (text) => { queued.push(text); }
  };
  FF.officeBell = getterBell;
  const last = N.state.items[N.state.items.length - 1];
  if (last) last.createdAt = new Date(Date.now() - 120e3).toISOString();
  const item = N.localAlert({ type: 'report', title: '📊 Data update', body: 'total badha', voiceText: 'Data update! 30 tags ho gaye.' });
  assert.ok(item && item.local, 'voiceOn getter ke bawajood alert bani (throw nahi hua)');
  assert.deepEqual(spoken, ['Data update! 30 tags ho gaye.'], 'getter bell par bhi bola');
  // voiceOn() call nahi hona chahiye — getter/boolean aur function dono kaam karein
  FF.officeBell = { ...real, voiceOn: () => true };     // function shape (test stubs / purane builds)
  spoken.length = 0;
  const l2 = N.state.items[N.state.items.length - 1];
  if (l2) l2.createdAt = new Date(Date.now() - 120e3).toISOString();
  N.localAlert({ type: 'report', title: '📊 Data update', body: 'x', voiceText: 'function shape bhi' });
  assert.deepEqual(spoken, ['function shape bhi'], 'function shape bhi chalti hai');
  FF.officeBell = { ...real, voiceOn: false };          // boolean property
  spoken.length = 0; queued.length = 0;
  const l3 = N.state.items[N.state.items.length - 1];
  if (l3) l3.createdAt = new Date(Date.now() - 120e3).toISOString();
  N.localAlert({ type: 'report', title: '📊 Data update', body: 'x', voiceText: 'voice OFF' });
  assert.deepEqual(spoken, [], 'voice OFF par nahi bolta');
  assert.deepEqual(queued, [], 'voice OFF par queue bhi nahi');
  FF.officeBell = real;
});

test('localAlert — speak me error aaye to bhi notification alive rehti hai (voice UI ko na maare)', () => {
  spoken.length = 0;
  const real = FF.officeBell;
  FF.officeBell = {
    unlocked: true, voiceOn: () => true, prefs: () => ({ muteUntil: 0 }), logList: () => [],
    speakAnnounce: () => { throw new Error('speech boom'); },
    queueAnnounce: () => { throw new Error('queue boom'); }
  };
  const before = N.state.items.length;
  const last = N.state.items[N.state.items.length - 1];
  if (last) last.createdAt = new Date(Date.now() - 120e3).toISOString();
  const item = N.localAlert({ type: 'report', title: '📊 Data update', body: 'x', voiceText: 'yeh fail hoga' });
  assert.ok(item && item.local, 'throw ke bawajood item bana');
  assert.equal(N.state.items.length, before + 1, 'item list me add hua');
  assert.ok(toasts.some((t) => /Data update/.test(t.msg)), 'toast phir bhi aaya');
  FF.officeBell = real;
});

test('officeBell poll ke notification meta me class-wise snapshot/delta (drawer data)', async () => {
  const src = await fs.readFile(path.join(ROOT, 'officeBell.js'), 'utf8');
  assert.match(src, /ffClasses/, 'FF class-wise map notification me jaata hai');
  assert.match(src, /gvClasses/, 'GV class-wise map notification me jaata hai');
  assert.match(src, /delta: \{ total: totalNew, classes: deltaClasses \}/, 'delta object shape');
  assert.match(src, /snapshot: \{ date: today/, 'aaj ka snapshot');
  assert.match(src, /previous: \{ date: today/, 'pichhla snapshot (pehle → ab)');
  assert.match(src, /select [^`]*\$\{e\.cls\}/, 'EIR query me class column');
});
