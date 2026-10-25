// v3.94 — Smart Notification Center: categories computed from GV issuance + GV REPORT stock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'smartCenter.js'), 'utf8');

const d = (y, m, day) => new Date(y, m - 1, day);
const row = (agentId, name, tl, ym, day, n) => ({ agentId, agentName: name, tlName: tl, tlId: tl ? 'T' + tl : '', ym, day, n, date: d(+ym.slice(0, 4), +ym.slice(5), day) });

function load(rows, report) {
  const U = { esc: (s) => String(s ?? ''), ymKey: (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`, dateKey: (x) => x.toISOString().slice(0, 10), fmt: (n) => String(n), toast() {}, $: () => null };
  const FF = { util: U, config: { thresholds: { coverRed: 7, coverOrange: 15, inactiveDays: 3 }, isDirectAgent: () => false }, auth: { can: () => true }, app: {},
    gv: { issuanceRows: () => rows, get: () => report, latestDate: () => d(2026, 10, 20), need: async () => [] }, store: { need: async () => [] } };
  const ctx = { window: { FF }, FF, document: { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) }, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(src, ctx);
  return FF.smartCenter;
}

test('low stock, dispatch priority, inactive and down are detected', () => {
  const rows = [];
  for (let i = 1; i <= 20; i++) rows.push(row('A1', 'Fast Agent', 'Alpha', '2026-10', i, 5)); // 100 so far, rate 5/day
  for (let i = 1; i <= 20; i++) rows.push(row('A2', 'Slow Agent', 'Alpha', '2026-09', i, 5)); // last month 100
  rows.push(row('A2', 'Slow Agent', 'Alpha', '2026-10', 5, 10)); // this month 10, last used 15 days ago
  const report = [{ agentId: 'A1', agentName: 'Fast Agent', tlName: 'Alpha', tlId: 'TAlpha', stockTotal: 20 }, { agentId: 'A2', agentName: 'Slow Agent', tlName: 'Alpha', stockTotal: 500 }];
  const m = load(rows, report).compute();
  const cat = (id) => m.cats.find((c) => c.id === id).items;
  assert.equal(cat('low').length, 1);
  assert.equal(cat('low')[0].id, 'A1');
  assert.equal(cat('disp')[0].prio, 'High');          // 20 / 5 = 4 days cover
  assert.equal(cat('disp')[0].need, 105);              // ceil(5*25) - 20
  assert.equal(cat('inactA')[0].id, 'A2');
  assert.equal(cat('downA')[0].id, 'A2');              // 10 vs 100 → down
  assert.equal(cat('inactT').length, 0);               // A1 is active so the TL is not inactive
});

test('whole-TL inactive and down detection', () => {
  const rows = [];
  for (let i = 1; i <= 20; i++) rows.push(row('B1', 'B One', 'Beta', '2026-09', i, 5));
  rows.push(row('B1', 'B One', 'Beta', '2026-10', 2, 3));
  const m = load(rows, []).compute();
  assert.equal(m.cats.find((c) => c.id === 'inactT').items[0].name, 'Beta');
  assert.equal(m.cats.find((c) => c.id === 'downT').items[0].name, 'Beta');
});
