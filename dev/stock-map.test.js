import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockAgeBuilder } from '../stock-age.js';

test('stock mapping buckets: FF / GV / GV+FF / Office; GV not-assigned ignored', () => {
  const b = createStockAgeBuilder({ todayDay: 20000 });
  b.addFf([
    { tagId: 'T1', barcode: '111', cls: '4', agentId: '101', agentName: 'A', tl: 'TL1' },      // FF only
    { tagId: 'T2', barcode: '222', cls: '4', agentId: '102', agentName: 'B', tl: 'TL1' },      // FF + GV
    { tagId: 'T3', barcode: '333', cls: '4', agentId: '', agentName: '', tl: '' },             // GV only (by barcode)
    { tagId: 'T4', barcode: '444', cls: '5', agentId: '', agentName: '', tl: '' },             // GV not-assigned → Office
    { tagId: 'T5', barcode: '555', cls: '5', agentId: '5845036', agentName: 'Master', tl: 'X' } // parked → Office
  ]);
  b.addGv([
    { tagId: 'T2', serial: '999', cls: '4', status: 'IN', agentId: 'G1', agentName: 'g' },
    { tagId: 'ZZ', serial: '333', cls: '4', status: 'IN', agentId: 'G2', agentName: 'g2' },
    { tagId: 'T4', serial: '444', cls: '5', status: 'IN', agentId: 'Not Assigned', agentName: '' }
  ]);
  const m = b.finish().map;
  assert.deepEqual({ ff: m.total.ff, gv: m.total.gv, both: m.total.both, office: m.total.office, total: m.total.total }, { ff: 1, gv: 1, both: 1, office: 2, total: 5 });
  assert.equal(m.gv.notAssigned, 1);
});

test('mapRows: bucket + class filter, GV issued/out status not mapped', async () => {
  const { mapRows } = await import('../stock-age.js');
  const b = createStockAgeBuilder({ todayDay: 20000, gvOutWords: ['ISSUED'] });
  b.addFf([
    { tagId: 'A', barcode: '1', cls: '4', agentId: '', agentName: '', tl: '' },
    { tagId: 'B', barcode: '2', cls: '5', agentId: '', agentName: '', tl: '' }
  ]);
  b.addGv([{ tagId: 'A', serial: '1', cls: '4', status: 'ISSUED', agentId: 'G1', agentName: 'g' }, { tagId: 'B', serial: '2', cls: '5', status: 'IN STOCK', agentId: 'G2', agentName: 'g2' }]);
  const idx = b.finish();
  assert.equal(mapRows(idx, { bucket: 'office' }).length, 1);   // A: issued → office
  assert.equal(mapRows(idx, { bucket: 'gv', cls: 'VC5' }).length, 1);
  assert.equal(mapRows(idx, { bucket: 'all' }).length, 2);
});
