/* 👂 Wake word ("Hey Gems") matching + 🎙 robust voice capture — regression lock.
   Lock karta hai:
     • U.wakeWordMatch — exact substring, token-wise fuzzy (ASR misheards), negative cases,
       Devanagari transcripts, empty/short words,
     • U.analyzeVoiceCapture — recording ka RAW PCM direct analyse hota hai (decode-free path),
       upload-style { blob } par analyzeVoiceBlob fallback,
     • U.startVoiceCapture — bina mic support ke friendly error throw hota hai. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const ls = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};

require(path.join(ROOT, 'util.js'));
const U = globalThis.FF.util;

// ================= wake word matching =================
test('wakeWordMatch — exact "Hey Gems" transcript match', () => {
  assert.equal(U.wakeWordMatch('Hey Gems', 'Hey Gems'), true);
  assert.equal(U.wakeWordMatch('hey gems aaj ka total batao', 'Hey Gems'), true);
  assert.equal(U.wakeWordMatch('  HEY   GEMS!  ', 'Hey Gems'), true);
});

test('wakeWordMatch — fuzzy ASR misheards tolerate hote hain', () => {
  assert.equal(U.wakeWordMatch('hey jems', 'Hey Gems'), true);       // gems → jems (1 edit)
  assert.equal(U.wakeWordMatch('he gems', 'Hey Gems'), true);        // hey → he (1 deletion)
  assert.equal(U.wakeWordMatch('hey gem stock kya hai', 'Hey Gems'), true); // gems → gem (1 deletion)
  assert.equal(U.wakeWordMatch('हे जेम्स', 'Hey Gems'), false);     // Devanagari ≠ latin tokens (fuzzy nahi)
  assert.equal(U.wakeWordMatch('हे जेम्स', 'हे जेम्स'), true);      // Devanagari exact chalega
  assert.equal(U.wakeWordMatch('हे जेम्स क्या हाल है', 'हे जेम्स'), true);
});

test('wakeWordMatch — negatives: galat word match nahi hota', () => {
  assert.equal(U.wakeWordMatch('hey google', 'Hey Gems'), false);
  assert.equal(U.wakeWordMatch('gems', 'Hey Gems'), false); // sirf ek token — dono chahiye
  assert.equal(U.wakeWordMatch('aaj ka total', 'Hey Gems'), false);
  assert.equal(U.wakeWordMatch('', 'Hey Gems'), false);
  assert.equal(U.wakeWordMatch('hey gems', ''), false);
  assert.equal(U.wakeWordMatch(null, 'Hey Gems'), false);
});

test('wakeNorm — punctuation/space normalize, letters+numbers intact', () => {
  assert.equal(U.wakeNorm('  Hey,  GEMS!!  '), 'hey gems');
  assert.equal(U.wakeNorm('FF-5845036'), 'ff 5845036');
});

// ================= voice capture analysis =================
function sinePcm(hz, seconds, sampleRate, amp = 0.4) {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

test('analyzeVoiceCapture — recording PCM direct analyse (decode-free)', async () => {
  const res = await U.analyzeVoiceCapture({ pcm: sinePcm(110, 2.5, 48000), sampleRate: 48000, seconds: 2.5 });
  assert.equal(res.ok, true);
  assert.ok(Math.abs(res.hz - 110) <= 12, `hz ${res.hz} ~110 (male deep) — 48kHz mic capture resample ho kar analyse hua`);
  assert.equal(res.gender, 'male');
  assert.ok(res.pitch >= 0.5 && res.pitch <= 1.6);
});

test('analyzeVoiceCapture — khali capture par friendly error', async () => {
  await assert.rejects(() => U.analyzeVoiceCapture({}), /dobara|nahi/i);
});

test('startVoiceCapture — node/no-mic env me friendly error (silent fail nahi)', async () => {
  await assert.rejects(() => U.startVoiceCapture(), /support|HTTPS|secure/i);
});

// ================= voice profile via capture (end-to-end numbers) =================
test('setVoiceProfile — capture analysis ka pitch/rate prefs me apply', async () => {
  const res = await U.analyzeVoiceCapture({ pcm: sinePcm(200, 2.5, 16000), sampleRate: 16000, seconds: 2.5 });
  assert.equal(res.ok, true);
  res.name = 'Test awaaz';
  U.setVoiceProfile(res);
  const p = U.voicePrefs();
  assert.ok(p.profile && p.profile.name === 'Test awaaz');
  assert.ok(p.pitch > 0 && p.rate > 0);
  U.setVoiceProfile(null);
  assert.equal(U.voiceProfile(), null);
});
