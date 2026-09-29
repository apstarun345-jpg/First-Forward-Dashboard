/* 🌅🗣 Concierge — login greeting + Alexa-style chit-chat engine ka regression lock.
   Locks karta hai:
     • greetingWord — time-aware (Good morning / afternoon / evening / night),
     • greetingText — "<wish> <name>! Kaise ho aap?" (Hinglish + English),
     • chit-chat: "kaise ho", "main theek hu", "shukriya", "bye", "tum kaun ho",
       "good morning", "time kya hua", "briefing do", "dobara sunao", short casual catch,
     • metric-aware tops: "top vc4 agents" VC4 se rank karta hai, "top gv agents" GV side,
     • 🧠 pichhle locked data answers bilkul same (regression). */
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
const FF = globalThis.FF;
const U = FF.util;
const ym = U.ymKey(new Date());
const today = U.dateKey(new Date());
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return U.dateKey(d); })();

const daily = [{ key: today, ym, channel: 'First Forward', n: 15, vrnType: 'CHASSIS', type: 'REGULAR' }, { key: yesterday, ym, channel: 'First Forward', n: 8, vrnType: 'WRONG', type: 'REGULAR' }];
const agents = [{ ym, channel: 'First Forward', name: 'Rahul Sharma', n: 40 }, { ym, channel: 'First Forward', name: 'Priya Verma', n: 25 }];
const stockAgents = [{ agentName: 'Rahul Sharma', n: 7, group: 'VC4' }];
const agentClass = [
  { ym, channel: 'First Forward', name: 'Rahul Sharma', n: 6, vrnType: 'REGULAR', group: 'VC4' },
  { ym, channel: 'First Forward', name: 'Rahul Sharma', n: 1, vrnType: 'REGULAR', group: 'VC20' },
  { ym, channel: 'First Forward', name: 'Priya Verma', n: 2, vrnType: 'REGULAR', group: 'VC4' },
  { ym, channel: 'First Forward', name: 'Priya Verma', n: 1, vrnType: 'WRONG', group: 'VC20' }
];
const gvMaster = [
  { ym, agentName: 'Rahul Sharma', date: new Date(), commission: 270, tagType: 'CHASSIS', group: 'VC4' },
  { ym, agentName: 'Priya Verma', date: new Date(), commission: 150, tagType: 'REGULAR', group: 'VC20' }
];
const gvStock = [{ agentName: 'Rahul Sharma', n: 2 }];
FF.store = { need: async (k) => ({ daily, agents, stockAgents, agentClass }[k] || []) };
FF.gv = { need: async (k) => (k === 'master' ? gvMaster : gvStock) };

require(path.join(ROOT, 'assistant.js'));
const A = FF.assistant;

// ================= greeting =================
test('greetingWord — time-aware wish', () => {
  assert.equal(A.greetingWord(new Date(2026, 8, 29, 0, 30)), 'Good night');
  assert.equal(A.greetingWord(new Date(2026, 8, 29, 9, 15)), 'Good morning');
  assert.equal(A.greetingWord(new Date(2026, 8, 29, 14, 0)), 'Good afternoon');
  assert.equal(A.greetingWord(new Date(2026, 8, 29, 19, 45)), 'Good evening');
  assert.equal(A.greetingWord(new Date(2026, 8, 29, 22, 10)), 'Good night');
});

test('greetingText — name ke saath "Kaise ho aap?" (Hinglish)', () => {
  const g = A.greetingText('Tarun Kumawat', new Date(2026, 8, 29, 9, 0));
  assert.match(g, /Good morning Tarun Kumawat!/);
  assert.match(g, /Kaise ho aap\?/);
  A.setLang('en');
  const ge = A.greetingText('Tarun Kumawat', new Date(2026, 8, 29, 9, 0));
  assert.match(ge, /Good morning Tarun Kumawat!/);
  assert.match(ge, /How are you\?/);
  A.setLang('hi');
});

// ================= Alexa-style chit-chat =================
test('"kaise ho" — friendly + "kya janna chahte ho" prompt', async () => {
  const a = await A.answer('kaise ho');
  assert.match(a, /badhiya/);
  assert.match(a, /janna chahte ho/);
  assert.match(a, /Top VC4/);
});

test('"main theek hu" — follow-up conversation', async () => {
  const a = await A.answer('main theek hu');
  assert.match(a, /Achha sun kar/);
  assert.match(a, /kya batau/);
});

test('"shukriya" / "bye" — courtesy replies', async () => {
  assert.match(await A.answer('shukriya'), /swagat/);
  const bye = await A.answer('bye');
  assert.match(bye, /Bye bye/);
  assert.match(bye, /Dhyan rakhiye/);
});

test('"tum kaun ho" — identity', async () => {
  const a = await A.answer('tum kaun ho');
  assert.match(a, /Dashboard Assistant/);
});

test('"good morning" — wish back + suggestions', async () => {
  const a = await A.answer('good morning');
  assert.match(a, /Good (morning|afternoon|evening|night)!/);
  assert.match(a, /Kaise ho aap|janna/);
});

test('"time kya hua" — current time + date', async () => {
  const a = await A.answer('time kya hua');
  assert.match(a, /ho rahe hain|:\d\d/);
});

test('"briefing do" — Alexa-style daily brief (totals + stock + top + wrong VRN)', async () => {
  const a = await A.answer('briefing do');
  assert.match(a, /briefing/i);
  assert.match(a, /tags/);
  assert.match(a, /stock/i);
  assert.match(a, /top agent/i);
  assert.match(a, /wrong VRN/i);
});

test('"dobara sunao" — repeat prompt', async () => {
  const a = await A.answer('dobara sunao');
  assert.match(a, /Zaroor|phir se|dobara/i);
});

test('short casual input ("acha") — friendly catch, rude error nahi', async () => {
  const a = await A.answer('acha');
  assert.match(a, /theek hai/i);
  assert.doesNotMatch(a, /samajh nahi aaya/);
});

// ================= metric-aware tops =================
test('"top vc4 agents" — VC4 count se rank (Rahul 6 > Priya 2)', async () => {
  const a = await A.answer('top vc4 agents');
  assert.match(a, /VC4 ke hisaab se/);
  const rIdx = a.indexOf('Rahul Sharma'), pIdx = a.indexOf('Priya Verma');
  assert.ok(rIdx >= 0 && pIdx >= 0 && rIdx < pIdx, `Rahul pehle aana chahiye: ${a}`);
  assert.match(a, /Rahul Sharma — 6/);
});

test('"top gv agents" — GV side top-3', async () => {
  const a = await A.answer('top gv agents');
  assert.match(a, /GV Partner ke top 3/);
  assert.match(a, /Rahul Sharma/);
});

test('"top chassis agents" — chassis metric', async () => {
  const a = await A.answer('top chassis agents');
  assert.match(a, /chassis ke hisaab se/);
});

// ================= regression — locked data answers unchanged =================
test('locked data answers ab bhi same (regression)', async () => {
  const stock = await A.answer('stock kya hai');
  assert.match(stock, /Total field stock/);
  assert.match(stock, /combined 9/);
  const todayA = await A.answer('aaj ka rahul ka issuance');
  assert.match(todayA, /aaj GV 1 tags/);
  assert.match(todayA, /month-to-date 40/);
  const help = await A.answer('help');
  assert.match(help, /pooch sakte hain/);
  const hello = await A.answer('namaste');
  assert.match(hello, /Namaste! 🙏 Main dashboard assistant hoon/);
  const kala = await A.answer('kal ka total');
  assert.match(kala, /FF 8/);
  const inc = await A.answer('rahul ka full summary');
  assert.match(inc, /full summary/);
});
