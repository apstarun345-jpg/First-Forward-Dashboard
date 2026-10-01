/* 🎉 WOW engine (v3.10) — levels, badges, stats, challenges, crystal ball, celebration guard.
   Pure-logic regression lock (DOM pages smoke me cover hoti hain). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};

require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'model.js'));
require(path.join(ROOT, 'wow.js'));

const FF = globalThis.FF;
const W = FF.wow, U = FF.util;
const ym = U.ymKey(new Date());
const prevYm = U.prevMonthKey(ym);

test('levels — XP thresholds, names aur progress', () => {
  assert.equal(W.levelFor(0).name, 'Rookie');
  assert.equal(W.levelFor(99).name, 'Rookie');
  assert.equal(W.levelFor(100).name, 'Apprentice');
  assert.equal(W.levelFor(10000).name, 'Tag Titan');
  assert.equal(W.levelFor(999999).next, null);
  const mid = W.levelFor(200); // Apprentice 100–300
  assert.ok(mid.progress > 0 && mid.progress < 1);
  assert.equal(mid.need, 200);
});

test('buildStats — badges, streak, challenges, GV channel rows ignore', () => {
  const agents = [
    { ym, channel: 'First Forward', name: 'Ravi', tlName: 'TL1', n: 60, id: 'R1' },
    { ym: prevYm, channel: 'First Forward', name: 'Ravi', tlName: 'TL1', n: 5 },
    { ym, channel: 'First Forward', name: 'Priya', tlName: 'TL1', n: 130 },
    { ym, channel: 'GV Partner', name: 'GhostGV', n: 99 }
  ];
  const agentClass = [{ ym, channel: 'First Forward', name: 'Ravi', group: 'VC4', n: 40 }];
  const today = new Date();
  const gv = [];
  for (let i = 0; i < 7; i++) { const d = new Date(today); d.setDate(d.getDate() - i); gv.push({ ym: U.ymKey(d), date: d, agentName: 'Ravi', tlName: 'TL1' }); }
  const stats = W.buildStats(agents, agentClass, gv, ym);
  const ravi = stats.find((s) => s.name === 'Ravi');
  const priya = stats.find((s) => s.name === 'Priya');
  assert.ok(ravi && priya);
  assert.equal(ravi.ffCur, 60);
  const gvInMonth = gv.filter((r) => r.ym === ym).length;   // 1 tareekh ko 7 me se sirf 1 din is mahine ka
  assert.ok(ravi.gvCur >= Math.min(6, gvInMonth), `gvCur ${ravi.gvCur} — is mahine ke ${gvInMonth} GV din`);
  assert.equal(ravi.cur, ravi.ffCur + ravi.gvCur);
  assert.ok(ravi.streakDays >= 7, `streak ${ravi.streakDays} >= 7 chahiye`);
  assert.ok(ravi.badges.some((b) => b.id === 'streak'), 'Streak Master badge missing');
  assert.ok(ravi.badges.some((b) => b.id === 'vc4king'), 'VC4 Specialist badge missing');
  assert.ok(priya.badges.some((b) => b.id === 'century'), 'Century Club badge missing');
  assert.ok(!stats.some((s) => s.name === 'GhostGV'), 'GV-channel EIR row alag agent ban gaya');
  assert.equal(stats[0].rank, 1);
  assert.ok(ravi.challenges.find((c) => c.id === 'streak').done, '7-din streak challenge done hona chahiye (6d gv + boundary)');
  assert.ok(ravi.xp >= ravi.total, 'XP me badge bonus judna chahiye');
});

test('celebrateOnce — ek hi key par sirf ek celebration (localStorage guard)', () => {
  assert.equal(W.celebrateOnce('unit-test-key', 'x'), true);
  assert.equal(W.celebrateOnce('unit-test-key', 'x'), false);
  assert.equal(W.celebrateOnce('unit-test-key-2', 'y'), true);
});

test('crystal — projection sanity + record watch filter', () => {
  const rows = [];
  const now = new Date();
  for (let d = 1; d <= now.getDate(); d++) rows.push({ ym, key: `${ym}-${String(d).padStart(2, '0')}`, day: d, channel: 'First Forward', n: 10 });
  const stats = [
    { key: 'a', name: 'A', cur: 80, bestPast: 70, recordPace: true },
    { key: 'b', name: 'B', cur: 5, bestPast: 50, recordPace: false }
  ];
  const cr = W.crystal(rows, stats, ym);
  assert.ok(cr.ffProj >= 100, `ffProj ${cr.ffProj} >= 100 chahiye`);
  assert.ok(cr.ffConf > 0 && cr.ffConf <= 97);
  assert.equal(cr.recordWatch.length, 1);
  assert.equal(cr.recordWatch[0].name, 'A');
});

test('badges — Comeback + Fast Riser conditions', () => {
  const agents = [
    { ym, channel: 'First Forward', name: 'Back', tlName: '', n: 25 },
    { ym, channel: 'First Forward', name: 'Riser', tlName: '', n: 30 },
    { ym: prevYm, channel: 'First Forward', name: 'Riser', tlName: '', n: 12 }
  ];
  const stats = W.buildStats(agents, [], [], ym);
  const back = stats.find((s) => s.name === 'Back');
  const riser = stats.find((s) => s.name === 'Riser');
  assert.ok(back.badges.some((b) => b.id === 'comeback'), 'Comeback Kid badge missing');
  assert.ok(riser.badges.some((b) => b.id === 'riser'), 'Fast Riser badge missing');
});

test('pages registered — arena / fame / warRoom', () => {
  assert.ok(FF.pages.arena && typeof FF.pages.arena.render === 'function');
  assert.ok(FF.pages.fame && typeof FF.pages.fame.render === 'function');
  assert.ok(FF.pages.warRoom && typeof FF.pages.warRoom.render === 'function');
});
