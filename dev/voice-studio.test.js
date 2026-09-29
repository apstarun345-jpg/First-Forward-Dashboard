/* 🎛 Voice Studio + advanced assistant intents — regression lock.
   Locks karta hai:
     • U.resamplePcm / U.analyzePcm — synthetic sine se pitch (Hz), gender aur TTS pitch/rate
       mapping sahi aati hai (male 110Hz vs female 200Hz),
     • U.setVoiceProfile / U.voiceProfile — "Meri awaaz" profile localStorage me persist hoti
       hai (pitch/rate apply) aur clear par wapas default,
     • U.matchVoice — chosen voice URI sabse pehle, phir language, phir profile-gender hint,
     • assistant answer engine — kal/week totals, VC4 vs commercial class mix, growth vs
       last month, agent list, help, 🧠 context memory ("Rahul ka issuance" → "iska stock")
       aur "full summary" card. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ---- minimal browser globals ----
const ls = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};

require(path.join(ROOT, 'util.js'));
const FF = globalThis.FF;
const U = FF.util;
const ym = U.ymKey(new Date());
const today = U.dateKey(new Date());
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return U.dateKey(d); })();
const twoDaysAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 2); return U.dateKey(d); })();

// ---- synthetic PCM helpers ----
function sinePcm(hz, seconds, sampleRate, amp = 0.4) {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

// ---- mock dashboard data (assistant.js se pehle set) ----
const daily = [
  { key: today, ym, channel: 'First Forward', n: 15, vrnType: 'CHASSIS', type: 'REGULAR' },
  { key: yesterday, ym, channel: 'First Forward', n: 5, vrnType: 'REGULAR', type: 'REGULAR' },
  { key: twoDaysAgo, ym, channel: 'First Forward', n: 7, vrnType: 'CHASSIS', type: 'REPLACEMENT' }
];
const agents = [{ ym, channel: 'First Forward', name: 'Rahul Sharma', n: 40 }];
const stockAgents = [{ agentName: 'Rahul Sharma', n: 7, group: 'VC4' }];
const agentClass = [
  { ym, channel: 'First Forward', name: 'Rahul Sharma', n: 3, vrnType: 'Chassis', group: 'VC4' },
  { ym, channel: 'First Forward', name: 'Rahul Sharma', n: 2, vrnType: 'REGULAR', group: 'VC4' },
  { ym, channel: 'First Forward', name: 'Rahul Sharma', n: 4, vrnType: 'REGULAR', group: 'VC20' }
];
const gvMaster = [
  { ym, agentName: 'Rahul Sharma', date: new Date(), commission: 270, tagType: 'CHASSIS', group: 'VC4' },
  { ym, agentName: 'Rahul Sharma', date: new Date(`${yesterday}T10:00:00`), commission: 100, tagType: 'REGULAR', group: 'VC20' },
  { ym, agentName: 'Rahul Sharma', date: new Date(`${yesterday}T11:00:00`), commission: 90, tagType: 'REGULAR', group: 'VC20' }
];
const gvStock = [{ agentName: 'Rahul Sharma', n: 2 }];
FF.store = { need: async (k) => ({ daily, agents, stockAgents, agentClass }[k] || []) };
FF.gv = { need: async (k) => (k === 'master' ? gvMaster : gvStock) };

require(path.join(ROOT, 'assistant.js'));
const A = FF.assistant;

// ================= voice profile DSP =================
test('resamplePcm — 16kHz → 8kHz half length, 8kHz input unchanged', () => {
  const src = sinePcm(150, 1, 16000);
  const out = U.resamplePcm(src, 16000, 8000);
  assert.ok(Math.abs(out.length - 8000) <= 4, `~8000 samples chahiye, mile ${out.length}`);
  const same = U.resamplePcm(src, 16000, 22050);
  assert.equal(same.length, src.length); // upsample/eq-rate par copy
});

test('analyzePcm — female 200Hz sine: hz≈200, gender female, pitch≈1.0', () => {
  const res = U.analyzePcm(sinePcm(200, 2.5, 8000), 8000);
  assert.equal(res.ok, true);
  assert.ok(Math.abs(res.hz - 200) <= 12, `hz ${res.hz} 200 ke kareeb hona chahiye`);
  assert.equal(res.gender, 'female');
  assert.ok(Math.abs(res.pitch - 1) <= 0.1, `pitch ${res.pitch} ~1.0`);
  assert.ok(res.pitch >= 0.5 && res.pitch <= 1.6, 'pitch TTS range me');
  assert.ok(res.rate >= 0.75 && res.rate <= 1.4, 'rate TTS range me');
  assert.ok(res.seconds > 2);
});

test('analyzePcm — male 110Hz sine: hz≈110, gender male, pitch<0.7', () => {
  const res = U.analyzePcm(sinePcm(110, 2.5, 8000), 8000);
  assert.equal(res.ok, true);
  assert.ok(Math.abs(res.hz - 110) <= 10, `hz ${res.hz} 110 ke kareeb hona chahiye`);
  assert.equal(res.gender, 'male');
  assert.ok(res.pitch < 0.7, `pitch ${res.pitch} deep hona chahiye`);
});

test('analyzePcm — silence/chhota sample par friendly error', () => {
  const tiny = U.analyzePcm(sinePcm(200, 0.2, 8000), 8000);
  assert.equal(tiny.ok, false);
  assert.match(tiny.reason, /chhota|awaaz/);
  const silent = U.analyzePcm(new Float32Array(8000 * 2), 8000);
  assert.equal(silent.ok, false);
  assert.match(silent.reason, /awaaz nahi mili/);
});

test('setVoiceProfile — apply par pitch/rate prefs me, clear par default', () => {
  U.setVoiceProfile({ hz: 182, pitch: 0.95, rate: 1.1, gender: 'female', brightness: 800, syllPerSec: 4.2, seconds: 9, name: 'Meri awaaz' });
  const p = U.voicePrefs();
  assert.equal(p.pitch, 0.95);
  assert.equal(p.rate, 1.1);
  const prof = U.voiceProfile();
  assert.ok(prof, 'profile milni chahiye');
  assert.equal(prof.name, 'Meri awaaz');
  assert.equal(prof.gender, 'female');
  assert.ok(prof.at > 0);
  // out-of-range values clamp hote hain
  U.setVoiceProfile({ hz: 100, pitch: 9, rate: -2, gender: 'male', name: 'X' });
  const p2 = U.voicePrefs();
  assert.equal(p2.pitch, 1.6);
  assert.equal(p2.rate, 0.75);
  U.setVoiceProfile(null);
  assert.equal(U.voiceProfile(), null);
  assert.equal(U.voicePrefs().pitch, 0);
  assert.equal(U.voicePrefs().rate, 0);
});

test('matchVoice — chosen URI first, phir profile gender hint', () => {
  const voices = [
    { name: 'Ravi Male', lang: 'hi-IN', voiceURI: 'u-ravi' },
    { name: 'Kalpana Female', lang: 'hi-IN', voiceURI: 'u-kal' },
    { name: 'Google US English', lang: 'en-US', voiceURI: 'u-en' }
  ];
  U.setVoicePrefs({ hi: '', en: '' });
  U.setVoiceProfile({ hz: 200, pitch: 1, rate: 1, gender: 'female', name: 'Meri awaaz' });
  const v1 = U.matchVoice(voices, 'hi', U.voiceProfile());
  assert.equal(v1.voiceURI, 'u-kal', 'female profile ko female voice chahiye');
  U.setVoicePrefs({ hi: 'u-ravi' });
  const v2 = U.matchVoice(voices, 'hi', U.voiceProfile());
  assert.equal(v2.voiceURI, 'u-ravi', 'user ki chosen voice sabse pehle');
  U.setVoicePrefs({ en: 'u-en' });
  const v3 = U.matchVoice(voices, 'en', U.voiceProfile());
  assert.equal(v3.voiceURI, 'u-en');
  U.setVoiceProfile(null);
});

// ================= advanced answer engine =================
test('help — poora command menu', async () => {
  const a = await A.answer('help');
  assert.match(a, /pooch sakte hain/);
  assert.match(a, /chassis/);
});

test('kal ka total — yesterday FF+GV', async () => {
  const a = await A.answer('kal ka total');
  assert.match(a, /Kal \(/);
  assert.match(a, /FF 5/);
  assert.match(a, /GV 2/);
  assert.match(a, /7<\/b> tags|7 tags/);
});

test('week ka total — last 7 days', async () => {
  const a = await A.answer('week ka total');
  assert.match(a, /7 din/);
  assert.match(a, /FF 27/); // 15 + 5 + 7
  assert.match(a, /GV 3/);
});

test('VC4 vs commercial — class mix split', async () => {
  const a = await A.answer('vc4 vs commercial');
  assert.match(a, /class mix/);
  assert.match(a, /VC4 5/); // FF agentClass: 3 + 2
  assert.match(a, /commercial 4/); // FF: 4 (VC20 row)
});

test('growth vs last month — comparison + %', async () => {
  const a = await A.answer('growth vs last month');
  assert.match(a, /Growth/);
  assert.match(a, /is month vs/);
});

test('agent list — top names FF + GV', async () => {
  const a = await A.answer('agent list');
  assert.match(a, /Top agents/);
  assert.match(a, /Rahul Sharma/);
});

test('🧠 context memory — "rahul ka issuance" ke baad "iska stock" Rahul ka', async () => {
  const a1 = await A.answer('rahul ka issuance');
  assert.match(a1, /Rahul Sharma/);
  const a2 = await A.answer('iska stock');
  assert.match(a2, /Rahul Sharma ke paas stock/);
  assert.match(a2, /FF 7/);
  assert.match(a2, /GV 2/);
});

test('rahul ka full summary — combined 360 card', async () => {
  const a = await A.answer('rahul ka full summary');
  assert.match(a, /Rahul Sharma/);
  assert.match(a, /full summary/);
  assert.match(a, /Issuance/);
  assert.match(a, /Stock/);
  assert.match(a, /commission/i);
});

test('data freshness — latest FF/GV dates', async () => {
  const a = await A.answer('data kab update hua');
  assert.match(a, /freshness/i);
  assert.match(a, new RegExp(today));
});

test('agent-wise wrong VRN + replacement (context se bhi)', async () => {
  const a1 = await A.answer('rahul ke wrong VRN kitne');
  assert.match(a1, /Rahul Sharma ke Wrong VRN/);
  const a2 = await A.answer('iska replacement kitne');
  assert.match(a2, /Rahul Sharma ke replacement tags/);
});

test('pichhle locked answers ab bhi same hain (regression)', async () => {
  A.setLang('hi');
  const stock = await A.answer('stock kya hai');
  assert.match(stock, /Total field stock/);
  assert.match(stock, /combined 9/);
  const todayA = await A.answer('aaj ka rahul ka issuance');
  assert.match(todayA, /aaj GV 1 tags/);
  assert.match(todayA, /month-to-date 40/);
  A.setLang('en');
  const hello = await A.answer('hello');
  assert.match(hello, /Hello! 🙏 I am your dashboard assistant/);
  A.setLang('hi');
});
