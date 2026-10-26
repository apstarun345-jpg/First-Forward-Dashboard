// v3.95 — Smart Notification Center: sudden-drop detector (agent + TL).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'smartCenter.js'), 'utf8');

function load() {
  const U = { esc: (s) => String(s ?? ''), dateKey: (x) => x.toISOString().slice(0, 10) };
  const FF = { util: U, gv: {}, store: {}, auth: { can: () => true } };
  vm.runInNewContext(src, { window: { FF }, FF, document: { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) } });
  return FF.smartCenter;
}
const day = (n) => new Date(2026, 9, n);   // Oct n
const row = (id, tl, n, d) => ({ agentId: id, agentName: 'Agent ' + id, tlName: tl, tlId: tl ? 'T' + tl : '', n, date: day(d) });

test('agent + TL that suddenly drop are flagged; steady and tiny ones are not', () => {
  const rows = [];
  for (let d = 4; d <= 17; d++) { rows.push(row('D1', '', 5, d)); rows.push(row('A1', 'Alpha', 5, d)); rows.push(row('A2', 'Alpha', 6, d)); rows.push(row('S1', 'Beta', 5, d)); rows.push(row('N1', 'Gamma', 1, d)); }
  for (let d = 18; d <= 20; d++) { rows.push(row('S1', 'Beta', 5, d)); rows.push(row('A2', 'Alpha', 1, d)); } // D1 + A1 gone, A2 dips hard, S1 steady
  const out = load().suddenDown(rows, day(20), { channel: 'gv' });
  const names = out.map((x) => `${x.kind}:${x.name}`);
  assert.ok(names.includes('agent:Agent D1'));         // Direct agent flagged
  assert.ok(!names.includes('agent:Agent A1'));        // TL ke agents alag se nahi
  assert.ok(!names.includes('agent:Agent A2'));
  assert.ok(names.includes('tl:Alpha'));
  assert.ok(!names.includes('agent:Agent S1'));
  assert.ok(!names.includes('tl:Beta'));
  assert.ok(!names.some((n) => n.includes('N1')));          // 1/day baseline = noise
  assert.equal(out.find((x) => x.name === 'Agent D1').drop, 100);
});

test('live today is skipped so an incomplete day does not look like a drop', () => {
  const rows = [];
  for (let d = 4; d <= 19; d++) rows.push(row('A1', '', 5, d));
  rows.push(row('A1', '', 0.1, 20));                    // today only just started
  const out = load().suddenDown(rows, day(20), { channel: 'gv', live: true });
  assert.equal(out.filter((x) => x.kind === 'agent').length, 0);
});
