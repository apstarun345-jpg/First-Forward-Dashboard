/* 🎙 Voice assistant — language toggle (Hinglish ⇄ English), voice prefs (localStorage) aur
   🏆 champion certificate builders ka regression lock.

   Lock karta hai:
     • U.voicePrefs()/setVoicePrefs — ek hi 'ff-voice-prefs' store (settings ↔ assistant sync),
     • assistant default HINGLISH hai; setLang('en') ke baad answers English me aate hain,
     • agent-wise answers dono bhasha me sahi figure dete hain (mock FF/GV data),
     • certificates.topRows — poore ranked board se top-3, medals + ranks sahi,
     • certificate page me agent ka naam ESCAPED hota hai (HTML-injection safe),
     • doc() har certificate ko alag A4-landscape page banata hai. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ---- minimal browser globals (assistant waitAuth node me chupchap exit karta hai) ----
const ls = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};

require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'certificates.js'));

const FF = globalThis.FF;
const U = FF.util;
const ym = U.ymKey(new Date());
const today = U.dateKey(new Date());

// ---- mock data (assistant.js se pehle set — module load par capture ho jata hai) ----
const daily = [{ key: today, ym, channel: 'First Forward', n: 15, vrnType: 'CHASSIS', type: 'REGULAR' }];
const agents = [{ ym, channel: 'First Forward', name: 'Rahul Sharma', n: 40 }];
const stockAgents = [{ agentName: 'Rahul Sharma', n: 7, group: 'VC4' }];
const agentClass = [{ ym, channel: 'First Forward', name: 'Rahul Sharma', n: 3, vrnType: 'Chassis' }];
const gvMaster = [{ ym, agentName: 'Rahul Sharma', date: new Date(), commission: 270, tagType: 'CHASSIS' }];
const gvStock = [{ agentName: 'Rahul Sharma', n: 2 }];
FF.store = { need: async (k) => ({ daily, agents, stockAgents, agentClass }[k] || []) };
FF.gv = { need: async (k) => (k === 'master' ? gvMaster : gvStock) };

require(path.join(ROOT, 'assistant.js'));
const A = FF.assistant;

test('voice prefs — default khali, set karne par localStorage me persist', () => {
  assert.deepEqual(U.voicePrefs(), {});
  U.setVoicePrefs({ rate: 0.9, hi: 'test-voice-uri' });
  assert.equal(U.voicePrefs().rate, 0.9);
  assert.equal(U.voicePrefs().hi, 'test-voice-uri');
  assert.equal(JSON.parse(ls.get('ff-voice-prefs')).hi, 'test-voice-uri');
});

test('assistant default HINGLISH — total stock answer FF+GV combined', async () => {
  assert.equal(A.getLang(), 'hi');
  const a = await A.answer('stock kya hai');
  assert.match(a, /Total field stock/);
  assert.match(a, /FF 7/);
  assert.match(a, /GV 2/);
  assert.match(a, /combined 9/);
});

test('agent-wise issuance Hinglish me — "aaj ka rahul ka issuance"', async () => {
  const a = await A.answer('aaj ka rahul ka issuance');
  assert.match(a, /Rahul Sharma/);
  assert.match(a, /aaj GV 1 tags/);
  assert.match(a, /month-to-date 40/);
});

test('setLang(en) — answers English me + persistence', async () => {
  A.setLang('en');
  assert.equal(U.voicePrefs().lang, 'en');
  const hello = await A.answer('hello');
  assert.match(hello, /Hello! 🙏 I am your dashboard assistant/);
  const stock = await A.answer("what is the stock");
  assert.match(stock, /Total field stock/);
  const rahul = await A.answer("rahul's issuance today");
  assert.match(rahul, /today GV 1 tags/);
  assert.match(rahul, /month-to-date is 40 tags/);
});

test('setLang(hi) — wapas Hinglish', async () => {
  A.setLang('hi');
  const hello = await A.answer('namaste');
  assert.match(hello, /Namaste! 🙏 Main dashboard assistant hoon/);
});

test('certificates.topRows — ranked board se top-3, medals + values', () => {
  const rows = [
    { name: 'A', total: 5 }, { name: 'B', total: 9 }, { name: 'C', total: 1 }, { name: 'D', total: 7 }
  ];
  const top = FF.certificates.topRows(rows, 'total', 3);
  assert.deepEqual(top.map((t) => t.name), ['B', 'D', 'A']);
  assert.deepEqual(top.map((t) => t.rank), [1, 2, 3]);
  assert.deepEqual(top.map((t) => t.medal), ['🥇', '🥈', '🥉']);
  assert.deepEqual(top.map((t) => t.title), ['CHAMPION', 'RUNNER-UP', '2nd RUNNER-UP']);
  assert.deepEqual(top.map((t) => t.value), [9, 7, 5]);
  // category metric (jaise vc4) pass ho to wahi value certificate me jaye
  const vc4 = FF.certificates.topRows([{ name: 'X', total: 50, vc4: 12 }, { name: 'Y', total: 40, vc4: 30 }], 'vc4', 3);
  assert.deepEqual(vc4.map((t) => t.value), [30, 12]);
});

test('certificate page — brand, rank line, month aur XSS-safe naam', () => {
  const page = FF.certificates.page({ name: 'Rahul <b>Sharma</b>', id: 'FF12', tl: 'Direct', rank: 1, value: 1234, category: 'Top Agents — Total Issuance', channel: 'First Forward', monthLabel: 'Sep 2026', brand: 'First Forward', isTl: false });
  assert.match(page, /Certificate of Achievement/);
  assert.match(page, /Rahul &lt;b&gt;Sharma&lt;\/b&gt;/);
  assert.match(page, /RANK #1 — CHAMPION/);
  assert.match(page, /First Forward/);
  assert.match(page, /1,234/);
  assert.match(page, /Sep 2026/);
  assert.doesNotMatch(page, /<script>/);
});

test('certificate doc — A4 landscape CSS + ek page per certificate', () => {
  const pages = [FF.certificates.page({ name: 'B', rank: 1, value: 9, category: 'Total', channel: 'FF', monthLabel: 'Sep 2026', brand: 'First Forward' }), FF.certificates.page({ name: 'D', rank: 2, value: 7, category: 'Total', channel: 'FF', monthLabel: 'Sep 2026', brand: 'First Forward' })];
  const doc = FF.certificates.doc(pages, 'Champions Sep 2026');
  assert.match(doc, /@page \{ size: A4 landscape; margin: 0; \}/);
  assert.match(doc, /Champions Sep 2026/);
  assert.equal((doc.match(/<section class="cert">/g) || []).length, 2);
});
