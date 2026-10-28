import test from 'node:test';
import assert from 'node:assert/strict';
import { gvOnlySummary, mapRows } from '../stock-age.js';

const mkIndex = () => ({
  at: 1,
  ff: { raw: [['T1', '1001', 'VC4', 0, 'A', '9', 'TL'], ['T2', '1002', 'VC5', 0, 'A', '9', 'TL']] },
  mapGv: { tags: new Map([['T1', ['g', '1', 't']], ['T3', ['g', '1', 't']], ['T4', ['g', '1', 't']], ['T5', ['g', '1', 't']]]), bcs: new Map() },
  gv: { raw: [
    ['T1', '1001', 'VC4', 0, 'g', '1', 't', 5],      // in FF stock by tag
    ['T3', '9003', 'VC4', 0, 'g', '1', 't', 5],      // GV only
    ['T4', '9004', 'VC5', 0, 'g', '1', 't', 5],      // GV only
    ['T5', '1002', 'VC5', 0, 'g', '1', 't', 5],      // FF has same barcode -> not GV only
    ['T6', '9006', 'VC4', 0, 'g', '1', 't', 5]       // not assigned -> ignored
  ] }
});

test('gv-only summary counts assigned GV tags missing from FF stock (tag or barcode)', () => {
  const s = gvOnlySummary(mkIndex());
  assert.equal(s.total, 2);
  assert.deepEqual(s.rows.map((r) => [r.cls, r.n]), [['VC4', 1], ['VC5', 1]]);
});

test('mapRows gvonly lists same tags, class filter works', () => {
  const idx = mkIndex();
  assert.equal(mapRows(idx, { bucket: 'gvonly' }).length, 2);
  const r = mapRows(idx, { bucket: 'gvonly', cls: 'VC5' });
  assert.equal(r.length, 1); assert.equal(r[0].tagId, 'T4');
});

test('GV tag present in FF StockDataa (even parked/office) is not counted; absent ones get Not In FF Stock', () => {
  const idx = mkIndex();
  idx.ff.raw.push(['T3', '9003', 'VC4', 0, '', '', '']);   // parked in FF raw -> present
  const s = gvOnlySummary(idx);
  assert.equal(s.total, 1); assert.equal(s.notIn, 1); assert.equal(s.office, 0);
  const rows = mapRows(idx, { bucket: 'gvonly' });
  assert.equal(rows[0].tagId, 'T4'); assert.equal(rows[0].remark, 'Not In FF Stock');
});
