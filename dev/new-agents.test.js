/* 🆕 v3.14 — New agents + TL change detection (FF month-level, GV date-level). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { documentElement: { dataset: {}, style: {} }, body: { classList: { add() {}, remove() {} } }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }) };
globalThis.addEventListener = () => {};
['config', 'util', 'model', 'gv', 'store', 'charts', 'newAgents'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const NA = FF.newAgents;
FF.auth = { can: () => true };

const row = (id, name, ym, n, tlName, tlId, date) => ({ id, name, ym, n, tlName, tlId, date });
const find = (res, id) => res.rows.find((r) => r.id === id);

test('tlKeyOf: placeholders / APS / blank → direct (""), GV TL id fallback', () => {
  assert.equal(NA.tlKeyOf('AJAY SINGH', 'T1', 'ff'), 'AJAY SINGH');
  assert.equal(NA.tlKeyOf('APS', '', 'ff'), '');
  assert.equal(NA.tlKeyOf('—', '', 'ff'), '');
  assert.equal(NA.tlKeyOf('', 'G77', 'gv'), 'TL G77');
  assert.equal(NA.tlKeyOf('', 'G77', 'ff'), '');
});

test('new agents: first month in period (data-start month is NOT new)', () => {
  const items = [
    row('A1', 'Old Agent', '2026-05', 5, 'TL One'), row('A1', 'Old Agent', '2026-06', 5, 'TL One'), row('A1', 'Old Agent', '2026-08', 5, 'TL One'),
    row('N1', 'Fresh Agent', '2026-08', 3, 'TL One'), row('N1', 'Fresh Agent', '2026-09', 8, 'TL One'),
    row('N2', 'Very New', '2026-09', 2, 'TL Two'),
    row('E1', 'Earlier New', '2026-06', 4, 'TL Two'), row('E1', 'Earlier New', '2026-09', 4, 'TL Two')
  ];
  let res = NA.analyze(items, { ch: 'ff', months: 2 });
  assert.equal(res.curYm, '2026-09');
  assert.equal(find(res, 'A1').isNew, false, 'data-start month agent nahi count hota');
  assert.equal(find(res, 'N1').isNew, true); assert.equal(find(res, 'N2').isNew, true);
  assert.equal(find(res, 'E1').isNew, false, 'June ka agent 2-month period me nahi');
  res = NA.analyze(items, { ch: 'ff', months: 1 });
  assert.equal(find(res, 'N1').isNew, false); assert.equal(find(res, 'N2').isNew, true);
  res = NA.analyze(items, { ch: 'ff', months: 6 });
  assert.equal(find(res, 'E1').isNew, true);
  assert.equal(find(res, 'N1').curN, 8); assert.equal(find(res, 'N1').lastN, 3);
});

test('TL change / removed / added events', () => {
  const items = [
    row('X', 'Moved', '2026-07', 5, 'TL One'), row('X', 'Moved', '2026-08', 5, 'TL One'), row('X', 'Moved', '2026-09', 5, 'TL Two'),
    row('Y', 'Lost TL', '2026-07', 5, 'TL One'), row('Y', 'Lost TL', '2026-09', 5, 'APS'),
    row('Z', 'Got TL', '2026-07', 5, 'APS'), row('Z', 'Got TL', '2026-09', 5, 'TL Two'),
    row('S', 'Steady', '2026-07', 5, 'TL One'), row('S', 'Steady', '2026-09', 5, 'TL One'),
    row('D', 'Always direct', '2026-07', 5, 'APS'), row('D', 'Always direct', '2026-09', 5, '—'),
    row('O', 'Old move', '2026-01', 5, 'TL One'), row('O', 'Old move', '2026-02', 5, 'TL Two'), row('O', 'Old move', '2026-09', 5, 'TL Two')
  ];
  const res = NA.analyze(items, { ch: 'ff', months: 2 });
  assert.deepEqual([find(res, 'X').ev.kind, find(res, 'X').ev.from, find(res, 'X').ev.to], ['changed', 'TL One', 'TL Two']);
  assert.equal(find(res, 'Y').ev.kind, 'removed'); assert.equal(find(res, 'Y').ev.to, '');
  assert.equal(find(res, 'Z').ev.kind, 'added');
  assert.equal(find(res, 'S').ev, null); assert.equal(find(res, 'D').ev, null);
  assert.equal(find(res, 'O').ev, null, 'purana change period ke bahar');
  assert.equal(NA.analyze(items, { ch: 'ff', months: 12 }).rows.find((r) => r.id === 'O').ev.kind, 'changed');
});

test('GV: date-level — mid-month TL change picks the latest TL; first date kept', () => {
  const d = (s) => new Date(s);
  const items = [
    row('G1', 'GV Mover', '2026-08', 1, 'GV TL A', 'A', d('2026-08-10')), row('G1', 'GV Mover', '2026-09', 1, 'GV TL A', 'A', d('2026-09-02')),
    row('G1', 'GV Mover', '2026-09', 1, '', '', d('2026-09-20')), row('G1', 'GV Mover', '2026-09', 1, '', '', d('2026-09-21')),
    row('G2', 'GV New', '2026-09', 1, '', '', d('2026-09-15')), row('G2', 'GV New', '2026-09', 1, '', '', d('2026-09-16')),
    row('G0', 'Base', '2026-07', 1, 'GV TL A', 'A', d('2026-07-01'))
  ];
  const res = NA.analyze(items, { ch: 'gv', months: 2 });
  const g1 = find(res, 'G1'); assert.equal(g1.ev.kind, 'removed'); assert.equal(g1.ev.from, 'GV TL A'); assert.equal(g1.curTl, '');
  const g2 = find(res, 'G2'); assert.equal(g2.isNew, true); assert.equal(new Date(g2.firstDate).toISOString().slice(0, 10), '2026-09-15');
});

test('page wiring: route, permission, script, service worker', async () => {
  const fs = await import('node:fs/promises');
  const [app, server, index, sw, pkg, lazy] = await Promise.all(['app.js', 'server.js', 'index.html', 'sw.js', 'package.json', 'lazy.js'].map((f) => fs.readFile(path.join(ROOT, f), 'utf8')));
  // ⚡ newAgents lazy module hai — module reference index.html (eager) ya lazy.js (on-demand) me hota hai.
  assert.match(app, /id: 'newAgents'/); assert.match(server, /key: 'newAgents'/); assert.match(index + lazy, /newAgents\.js|['"]newAgents['"]/); assert.match(sw, /newAgents|CACHE_NAME/); assert.match(pkg, /newAgents app/);
  assert.equal(typeof FF.pages.newAgents.render, 'function');
});
