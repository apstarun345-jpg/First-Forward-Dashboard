/* 🧠 AI Analyst v3.125.599 — TL roll-up, growth status, inactive (group), stock cover */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'aiAnalyst.js'), 'utf8');
function load() {
  const FF = { util: { esc: (s) => String(s), clean: (v) => String(v == null ? '' : v).trim(), fmt: (n) => String(n), $: () => null }, model: {}, store: {}, gv: {}, charts: {}, config: {}, pages: {} };
  new Function('window', 'FF', src)({ FF }, FF);
  return FF.aiAnalyst;
}
test('statusOf: growth / stable / de-growth / high de-growth / new / lost', () => {
  const { statusOf } = load();
  assert.equal(statusOf(120, 100, 120).k, 'growth');
  assert.equal(statusOf(100, 100, 102).k, 'stable');
  assert.equal(statusOf(80, 100, 85).k, 'degrowth');
  assert.equal(statusOf(50, 100, 60).k, 'high');
  assert.equal(statusOf(0, 100, 0, 0, 0).k, 'inact1');
  assert.equal(statusOf(0, 0, 0, 7, 0).k, 'inact2');
  assert.equal(statusOf(0, 0, 0, 0, 3).k, 'inact3');
  assert.equal(statusOf(1, 100, 1).k, 'high');
  assert.equal(statusOf(10, 0, 10).k, 'new');
});
test('entitiesOf: TL = uski team ka total; direct alag; ek agent inactive ho to TL inactive nahi', () => {
  const { entitiesOf } = load();
  const rows = [
    { name: 'TL Raj', id: '1', tl: 'TL Raj', direct: false, cur: 10, last: 8, proj: 10, stock: 5, inact: 0, repl: 1, chassis: 0, wrong: 2 },
    { name: 'A1', id: '2', tl: 'TL Raj', direct: false, cur: 0, last: 5, proj: 0, stock: 20, inact: 40, repl: 0, chassis: 1, wrong: 0 },
    { name: 'Dir X', id: '3', tl: '', direct: true, cur: 0, last: 9, proj: 0, stock: 30, inact: 12, repl: 0, chassis: 0, wrong: 0 }
  ];
  const a = { channels: { ff: { hasStock: true, day: 10, d: { rows } }, gv: null } };
  const e = entitiesOf(a), tl = e.find((x) => x.type === 'tl'), d = e.find((x) => x.type === 'direct');
  assert.equal(e.length, 2);
  assert.equal(tl.name, 'TL Raj'); assert.equal(tl.cur, 10); assert.equal(tl.last, 13); assert.equal(tl.stock, 25);
  assert.equal(tl.inact, 0, 'TL ka ek agent 40 din inactive par TL khud active hai');
  assert.equal(tl.repl, 1); assert.equal(tl.chassis, 1); assert.equal(tl.wrong, 2);
  assert.equal(d.name, 'Dir X'); assert.equal(d.inact, 12); assert.equal(d.st, 'inact1');
  assert.ok(tl.cover > 0 && tl.cover < 30);
});
test('UI: koi TL-agent row nahi, 4 tables, source markers', () => {
  assert.match(src, /r\.channel !== 'GV Partner'/);
  assert.match(src, /function openDrill/);
  assert.match(src, /data-drill/);
  for (const id of ['s-growth', 's-quality', 's-inactive', 's-stock']) assert.ok(src.includes(id), id);
});

test('promoteTls: jo naam kisi aur ke TL ke roop me aata hai wo direct nahi, TL hai', () => {
  const { promoteTls } = load();
  const people = [
    { name: 'Hemal', tl: '', direct: true }, { name: 'A1', tl: 'Hemal', direct: false }, { name: 'Solo', tl: '', direct: true }
  ];
  promoteTls(people);
  assert.equal(people[0].direct, false); assert.equal(people[0].tl, 'Hemal');
  assert.equal(people[2].direct, true);
});
test('filter state localStorage me yaad rehta hai + cache se turant render', () => {
  assert.match(src, /localStorage\.setItem\(UIKEY/);
  assert.match(src, /localStorage\.getItem\(UIKEY/);
  assert.match(src, /AX\.a && AX\.key === key/);
});
