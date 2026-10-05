/* 🔊 v3.18 — Office Bell VOICE FIX regression.
   Chrome/Edge autoplay policy ki wajah se naye tags ki awaaz kabhi aati hi nahi thi.
   Ye test lock karta hai:
     • speak() browser ke "not-allowed" error par resolve(false) karta hai aur lastError set karta hai,
     • unlock() ke baad wahi speak succeed karta hai,
     • tab background / bina unlock ke announcement queue me jaata hai aur flush par bolta hai,
     • prefs (min tags, FF/GV, ting, mute) defaults ke saath aate hain aur save hote hain,
     • announcement log localStorage me likha jaata hai. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;

const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };

// ---- fake DOM (sirf utna jitna officeBell chhuta hai) ----
const made = [];
const fakeEl = () => {
  const el = {
    children: [], style: {}, dataset: {}, hidden: false, textContent: '', title: '', className: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {}, appendChild(c) { this.children.push(c); return c; },
    remove() {}, getBoundingClientRect: () => ({ top: 0, bottom: 40, left: 0, right: 100 }),
    querySelector: () => null, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; }
  };
  made.push(el);
  return el;
};
globalThis.document = {
  hidden: false, body: { appendChild() {} },
  createElement: () => fakeEl(), getElementById: () => null,
  addEventListener() {}, removeEventListener() {}, querySelector: () => null
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

// ---- fake speech synthesis: pehli baar "not-allowed", unlock ke baad success ----
let allowSpeak = false;
let assistantLang = 'hi', resumeCalls = 0, systemVoices = [];
const spoken = [], utterances = [];
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1; this.onend = null; this.onerror = null; }
};
globalThis.window.speechSynthesis = {
  getVoices: () => systemVoices,
  speaking: false, pending: false, paused: true,
  cancel() {},
  resume() { resumeCalls++; this.paused = false; },
  speak(u) {
    spoken.push(u.text); utterances.push(u);
    if (!allowSpeak) { setTimeout(() => u.onerror && u.onerror({ error: 'not-allowed' }), 0); return; }
    setTimeout(() => u.onend && u.onend(), 0);
  }
};

globalThis.FF = {
  util: {
    clean: (v) => String(v === null || v === undefined ? '' : v).trim(),
    voicePrefs: () => ({ rate: 1.12, pitch: 0.91 }),
    voiceProfile: () => ({ gender: 'female' }),
    matchVoice: (voices, lang) => voices.find((v) => String(v.lang || '').toLowerCase().startsWith(lang)) || voices[0] || null,
    dateKey: () => '2026-09-29',
    fmt: (n) => String(n),
    esc: (s) => String(s),
    $: () => null,
    h: () => fakeEl(),
    toast: () => {}
  },
  config: {
    eir: { sheet: 'EIR', agentName: 'L', gvName: 'AX', masterId: 'AU', tlName: 'BA', tagId: 'A', date: 'AA', gvMasterId: '5845036', gvChannelTl: 'ApnaPayment Pvt. Ltd.' },
    gv: { master: { agentName: 'B', uniqueId: 'A', date: 'P' } },
    gvSheetId: 'gv-sheet',
    features: {}
  },
  assistant: { getLang: () => assistantLang }
};
const cell = (v) => ({ v });
const table = (rows) => ({ rows: rows.map((r) => r.map(cell)) });
globalThis.FF.data = {
  cellText: (c) => (c && c.v !== undefined && c.v !== null ? String(c.v) : ''),
  cellNumber: (c) => (c && c.v !== undefined && c.v !== null ? Number(c.v) : null),
  query: async (sheet) => (sheet === 'EIR'
    ? table([['FF Agent', '', '', 'Team FF', 4]])
    : table([['GV Agent', 'G1', 3]]))
};
require(path.join(ROOT, 'officeBell.js'));
const bell = globalThis.FF.officeBell;
const tick = (ms = 12) => new Promise((r) => setTimeout(r, ms));

test('prefs come with safe defaults and persist', () => {
  const p = bell.prefs();
  assert.equal(p.minTags, 1);
  assert.equal(p.ff, true);
  assert.equal(p.gv, true);
  assert.equal(p.ting, true);
  bell.setPrefs({ minTags: 5, gv: false });
  assert.equal(bell.prefs().minTags, 5);
  assert.equal(bell.prefs().gv, false);
  assert.equal(bell.prefs().ff, true, 'baaki keys default par rehti hain');
  assert.equal(JSON.parse(ls.get('ff-office-bell-prefs')).minTags, 5);
  bell.setPrefs({ minTags: 1, gv: true });
});

test('speak fails loudly (not silently) while the browser blocks autoplay', async () => {
  allowSpeak = false;
  const ok = await bell.speakAnnounce('Rahul ne 5 naye tags issue kiye.', 5);
  assert.equal(ok, false, 'blocked speak ko success mat maano');
  assert.equal(bell.lastError, 'not-allowed', 'error reason surface hona chahiye');
  assert.equal(bell.unlocked, false);
});

test('unlock() releases the browser lock and the same announcement then speaks', async () => {
  allowSpeak = true;
  bell.unlock('retry');
  await tick();
  assert.equal(bell.unlocked, true, 'unlock ke baad flag set');
  const ok = await bell.speakAnnounce('Rahul ne 5 naye tags issue kiye.', 5);
  assert.equal(ok, true, 'unlock ke baad voice chalti hai');
  assert.ok(spoken.some((t) => /Rahul ne 5 naye tags/.test(t)), 'utterance speech synthesis tak pahunchi');
});

test('Mac-style voice recovery resumes paused speech and uses the installed system voice/preferences', async () => {
  allowSpeak = true;
  assistantLang = 'en';
  const voice = { name: 'Alex', lang: 'en-US', voiceURI: 'com.apple.voice.enhanced.en-US.Alex' };
  systemVoices = [voice];
  const before = resumeCalls;
  const ok = await bell.speakAnnounce('Mac voice recovery test.', 1);
  assert.equal(ok, true);
  assert.ok(resumeCalls > before, 'paused SpeechSynthesis ko resume kiya');
  const u = utterances.at(-1);
  assert.equal(u.voice, voice, 'available macOS voice selected');
  assert.equal(u.lang, 'en-US');
  assert.equal(u.rate, 1.12, 'saved speech rate applied');
  assert.equal(u.pitch, 0.91, 'saved pitch applied');
  systemVoices = [];
  assistantLang = 'hi';
});

test('announcements made while the tab is hidden are queued, then spoken when it is visible', async () => {
  document.hidden = true;
  spoken.length = 0;
  bell.queueAnnounce('Rahul ne 2 naye tags issue kiye.', 2);
  bell.queueAnnounce('Priya ne 3 naye tags issue kiye.', 3);
  assert.equal(bell.pending, 2, 'dono khabar queue me');
  bell.flushPending();
  assert.equal(bell.pending, 2, 'tab hidden hai — abhi mat bolo');

  document.hidden = false;
  bell.flushPending();
  assert.equal(bell.pending, 0, 'flush ke baad queue khali');
  await tick();
  assert.ok(spoken.some((t) => /2 updates me 5 naye tags/.test(t)), `combined announcement boli: ${JSON.stringify(spoken)}`);
});

test('announcement text still names the channel and the agent', () => {
  assert.match(bell.announceText([{ ch: 'FF', agent: 'Ravi Kumar', n: 4 }], 4), /Ravi.*First Forward/);
  assert.match(bell.announceText([{ ch: 'GV', agent: 'Priya Sharma', n: 3 }], 3), /Priya.*GV Partner/);
});

test('announcement log records the burst', () => {
  bell.logAdd({ at: Date.now(), ff: 3, gv: 0, total: 3, who: 'Ravi (3)' });
  const log = bell.logList();
  assert.equal(log.length, 1);
  assert.equal(log[0].total, 3);
  assert.equal(log[0].who, 'Ravi (3)');
  bell.logAdd({ at: Date.now(), ff: 0, gv: 2, total: 2, who: 'GV Agent (2)' });
  assert.equal(bell.logList().length, 2);
  assert.equal(bell.logList()[0].total, 2, 'nayi khabar sabse upar');
  ls.delete('ff-office-bell-log');
});
