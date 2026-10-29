import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createDuplicateBarcodeCollector } from '../duplicate-barcode.js';
import { buildStockAgeIndex, followupAgeByAgent } from '../stock-age.js';

test('duplicate audit groups same-sheet rows including blank tag IDs and all GV statuses, preserving source text', () => {
  const ff = createDuplicateBarcodeCollector();
  [
    { barcode: '00608116-00101.0', tagId: '' },
    { barcode: '60811600101', tagId: 'T1' },
    { barcode: '60811600102', tagId: 'T2' },
    { barcode: 'BARCODE' }, { barcode: 'NOT ASSIGNED' }, { barcode: 'x1' }, { barcode: '0' }
  ].forEach((r) => ff.add(r));
  const f = ff.finish();
  assert.equal(f.duplicateBarcodes, 1); assert.equal(f.duplicateRows, 2); assert.equal(f.ignored, 4);
  assert.equal(f.groups[0].rows[0].tagId, '');
  const gv = createDuplicateBarcodeCollector();
  gv.add({ barcode: '60811600101', status: 'IN STOCK' });
  assert.equal(gv.finish().duplicateBarcodes, 0, 'a barcode once in each sheet is not a duplicate');
  gv.add({ barcode: '6.0811600101e10', status: 'ISSUED' });
  assert.deepEqual(gv.finish().groups[0].rows.map((r) => r.status), ['IN STOCK', 'ISSUED']);
});

test('follow-up ageing includes only assigned in-stock GV and keeps unknown dates separate', () => {
  const idx = buildStockAgeIndex({ todayDay: 20000,
    ffRows: [{ tagId: 'FF', barcode: '100', agentId: '1', agentName: 'A', agentDate: '2024-01-01' }, { tagId: 'UNK', barcode: '101', agentId: '1', agentName: 'A' }],
    gvRows: [
      { tagId: 'G1', serial: '200', agentId: 'G1', agentName: 'GV One', status: 'AVAILABLE', date: '2024-01-01' },
      { tagId: 'G2', serial: '201', agentId: 'G1', agentName: 'GV One', status: 'ISSUED', date: '2024-01-01' },
      { tagId: 'G3', serial: '202', agentId: 'Not Assigned', agentName: 'Not Assigned', status: 'AVAILABLE', date: '2024-01-01' },
      { tagId: '', serial: '203', agentId: 'G1', agentName: 'GV One', status: 'AVAILABLE' }
    ] });
  const ff = followupAgeByAgent(idx, 'ff');
  assert.equal(ff[0].age90, 1); assert.equal(ff[0].unknown, 1);
  const gv = followupAgeByAgent(idx, 'gv');
  assert.equal(gv.length, 1); assert.equal(gv[0].age90, 1); assert.equal(gv[0].unknown, 1);
});

test('agent follow-up prioritizes inactivity and old stock; target is projected; unrelated IDs do not match', () => {
  const source = fs.readFileSync(new URL('../agentsOverview.js', import.meta.url), 'utf8');
  const FF = { pages: {}, util: { clean: (v) => String(v ?? '').trim(), esc: String, fmt: String, runRateDays: () => 10 }, config: {} };
  vm.runInNewContext(source, { FF, window: { FF }, console, Date });
  const result = FF.agentsOverview.followupRows([
    { ch: 'ff', name: 'A', id: '1', stock: 20, status: 'in2', cur: 0, last: 0 },
    { ch: 'gv', name: 'B', id: 'G1', stock: 5, status: 'active', cur: 1, last: 5, deg: true, proj: 3 },
    { ch: 'gv', name: 'C', id: 'DIFFERENT', stock: 3, status: 'active', cur: 2, last: 0 }
  ], { ff: [{ id: '1', name: 'A', age90: 7, known: 10, unknown: 10 }], gv: [{ id: 'OTHER', name: 'C', age90: 2, known: 2, unknown: 0 }] }, [{ key: 'gv|B', ym: '2026-10', target: 10 }], '2026-10', 0);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'A'); assert.equal(result[0].priority, 'High');
  assert.ok(result[0].reasons.includes('Stock aged 90+ days'));
  assert.ok(result[1].reasons.includes('Below target pace'));
  assert.equal(result[1].age, null, 'missing age is not reported as zero');
  const low = FF.agentsOverview.followupRows([{ ch: 'ff', name: 'Low', id: '2', stock: 5, status: 'active', cur: 5, last: 0 }], {}, [], '2026-10', 5);
  assert.equal(low.length, 1); assert.ok(low[0].reasons.some((x) => x.includes('Low issuance')));
  assert.equal(FF.agentsOverview.followupRows([{ ch: 'ff', name: 'Low', id: '2', stock: 5, status: 'active', cur: 5, last: 0 }], {}, [], '2026-10', 1).length, 0);
});
