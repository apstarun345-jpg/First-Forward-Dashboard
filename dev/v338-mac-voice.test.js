/* 🔊 v3.38 — macOS Chrome voice regression.

   Chrome (Windows/macOS) me `speechSynthesis.cancel()` ke TURANT baad `speak()` ki gayi utterance
   chup-chaap gir jaati hai — na onstart, na onend, na onerror. Mobile Chrome par ye race aksar
   nahi dikhti, isliye symptom "Mac par awaaz nahi aati, phone par aa rahi hai" hota tha.

   Ye test lock karta hai:
     • jab pehle se kuch bol raha ho (ya queue me ho) → cancel ke baad speak DEFER hoti hai,
     • defer kiye bina speak karne par (purana behaviour) utterance drop hoti hai,
     • speak() ke baad watchdog + retry phir bhi kaam karte hain (koi hang nahi). */
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

const fakeEl = () => ({
  children: [], style: {}, dataset: {}, hidden: false, textContent: '', title: '', className: '',
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {}, removeEventListener() {}, appendChild(c) { this.children.push(c); return c; },
  remove() {}, getBoundingClientRect: () => ({ top: 0, bottom: 40, left: 0, right: 100 }),
  querySelector: () => null, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; }
});
globalThis.document = {
  hidden: false, body: { appendChild() {} },
  createElement: () => fakeEl(), getElementById: () => null,
  addEventListener() {}, removeEventListener() {}, querySelector: () => null
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

/** Chrome-macOS jaisa fake: cancel() ke baad SYNCHRONOUS speak() = utterance drop. */
const synth = {
  voices: [{ name: 'Alex', lang: 'en-US' }],
  speaking: true,           // pehle se kuch queue me hai
  pending: true,
  paused: false,
  dropped: 0,
  resumeCalls: 0,
  getVoices() { return this.voices; },
  cancel() { this.speaking = false; this.pending = false; this._justCancelled = true; setTimeout(() => { this._justCancelled = false; }, 0); },
  resume() { this.resumeCalls++; this.paused = false; },
  speak(u) {
    if (this._justCancelled) {         // ← asli Chrome bug: sync speak after cancel = chup-chaap gayab
      this.dropped++;
      this._justCancelled = false;
      return;                          // na onend, na onerror
    }
    this._justCancelled = false;
    this.speaking = true;
    setTimeout(() => u.onend && u.onend(), 0);
  },
  addEventListener() {}, removeEventListener() {}
};
globalThis.window.speechSynthesis = synth;
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1; this.onend = null; this.onerror = null; }
};

globalThis.FF = {
  util: {
    clean: (v) => String(v == null ? '' : v).trim(),
    voicePrefs: () => ({}),
    voiceProfile: () => null,
    matchVoice: (voices) => voices[0] || null,
    dateKey: () => '2026-10-02', fmt: (n) => String(n), esc: (s) => String(s),
    $: () => null, h: () => fakeEl(), toast: () => {}
  },
  config: { eir: { sheet: 'EIR', agentName: 'L', gvName: 'AX', masterId: 'AU', tlName: 'BA', tagId: 'A', date: 'AA', gvMasterId: '5845036', gvChannelTl: 'ApnaPayment Pvt. Ltd.' }, gv: { master: { agentName: 'B', uniqueId: 'A', date: 'P' } }, gvSheetId: 'gv-sheet', features: {} },
  assistant: { getLang: () => 'hi' },
  data: {
    cellText: (c) => (c && c.v != null ? String(c.v) : ''),
    cellNumber: (c) => (c && c.v != null ? Number(c) : null),
    query: async () => ({ rows: [[]] })
  }
};
require(path.join(ROOT, 'officeBell.js'));
const bell = globalThis.FF.officeBell;
const tick = (ms = 12) => new Promise((r) => setTimeout(r, ms));

test('cancel ke turant baad speak karne par utterance drop hoti hai (purana bug)', async () => {
  const u = new globalThis.SpeechSynthesisUtterance('drop hone wali line');
  let ended = false;
  u.onend = () => { ended = true; };
  synth.cancel();
  synth.speak(u);
  await tick(20);
  assert.equal(ended, false, 'sync speak after cancel kabhi end nahi hoti');
  assert.equal(synth.dropped, 1);
});

test('office Bell queue me hone par bhi bolta hai — speak cancel ke baad defer hoti hai', async () => {
  synth.dropped = 0;
  synth.speaking = true; synth.pending = true;
  const ok = await bell.speakAnnounce('Rahul ne paanch naye tags issue kiye.', 5);
  assert.equal(ok, true, 'awaaz chali (utterance drop nahi hui)');
  assert.equal(synth.dropped, 0, 'cancel → speak race se utterance nahi giri');
  assert.ok(synth.resumeCalls > 0, 'paused synthesis resume kiya');
  assert.equal(bell.lastError, '');
});

test('kuch na bol raha ho to seedha speak (faltu delay nahi)', async () => {
  synth.speaking = false; synth.pending = false;
  const t0 = Date.now();
  const ok = await bell.speakAnnounce('Priya ne teen naye tags issue kiye.', 3);
  assert.equal(ok, true);
  assert.ok(Date.now() - t0 < 60, 'jab queue khaali ho tab announce turant');
});
