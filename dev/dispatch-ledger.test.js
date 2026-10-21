import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBarcode, rowToEntry, buildLedgerIndex, lookupBarcode, dispatchFor, LAYOUT_LETTERS } from '../dispatch-ledger.js';

test('parseBarcode: dashed / plain / junk', () => {
  assert.deepEqual(parseBarcode('608116-039-0541048'), { pfx: '608116039', n: 541048 });
  assert.deepEqual(parseBarcode('6081160390541048'), { pfx: '608116039', n: 541048 });
  assert.equal(parseBarcode('abc'), null);
  assert.equal(parseBarcode(''), null);
});

test('rowToEntry: FF vs GV column layouts, bad end → QNT approx', () => {
  const ff = ['2026-10-01', 'Ravi', 'A1', '4', '50', '608116-039-0541000', '608116-039-0541049', '', '50', 'Done', '', ''];
  const e = rowToEntry(ff, 'ff', 'ff', 7);
  assert.equal(e.agent, 'Ravi'); assert.equal(e.lo, 541000); assert.equal(e.hi, 541049); assert.equal(e.cls, 'VC4'); assert.ok(!e.approx);
  const gv = ['2026-10-02', 'G9', 'Sita', '99999', 'VC5', '10', '608116-039-0600000', '608116-040-0000009', '', '', '', ''];
  const g = rowToEntry(gv, 'gv', 'gv', 3);
  assert.equal(g.agent, 'Sita'); assert.equal(g.agentId, 'G9'); assert.equal(g.hi, 600009); assert.equal(g.approx, true);
  assert.equal(rowToEntry(['x'], 'ff', 'ff', 1), null);
  assert.equal(LAYOUT_LETTERS('gv').length, 11);
});

test('lookup: overlapping ranges, latest date first, per-channel', () => {
  const mk = (d, a, lo, hi, ch = 'ff') => ({ ch, row: lo, pfx: 'P', lo, hi, date: d, agent: a, agentId: '', cls: 'VC4', qty: hi - lo + 1, first: '', last: '', status: '', note: '' });
  const ff = buildLedgerIndex([mk('2026-01-01', 'Old', 1, 1000), mk('2026-02-01', 'New', 100, 200), mk('2026-03-01', 'Far', 5000, 5100)]);
  const gv = buildLedgerIndex([mk('2026-02-05', 'GVguy', 150, 160, 'gv')]);
  const hit = lookupBarcode(ff, '000P000000150'.replace('P', '')); // not parseable prefix → []
  assert.deepEqual(hit, []);
  const idx = { byPfx: new Map([['608116039', ff.byPfx.get('P')]]) };
  const gidx = { byPfx: new Map([['608116039', gv.byPfx.get('P')]]) };
  const r = dispatchFor({ ff: idx, gv: gidx }, '608116-039-0000150');
  assert.equal(r.ffCount, 2); assert.equal(r.ff[0].agent, 'New'); assert.equal(r.ff[1].agent, 'Old');
  assert.equal(r.gvCount, 1); assert.equal(r.gv[0].agent, 'GVguy');
  assert.equal(dispatchFor({ ff: idx, gv: gidx }, '608116-039-0003000').ffCount, 0);
  assert.equal(dispatchFor({ ff: idx, gv: gidx }, '608116-039-0005050').ff[0].agent, 'Far');
});
