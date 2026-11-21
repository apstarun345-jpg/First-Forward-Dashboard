import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
test('office-dispatched: server endpoint + builder', () => {
  const s = r('server.js');
  assert.match(s, /\/api\/office-dispatched/);
  assert.match(s, /async function buildOfficeDispatched/);
  assert.match(s, /dispatchFor\(index, o\.barcode\)/);
  assert.match(s, /not\\s\*assign/);
});
test('office-dispatched: home box + drawer', () => {
  const h = r('home.js');
  assert.match(h, /id="hm-offdisp"/);
  assert.match(h, /mountOffDisp\(stockMount\)/);
  assert.match(h, /function openOffDispDrawer/);
});
test('office-dispatched: bad ledger ranges are ignored', () => {
  const s = r('server.js');
  assert.match(s, /const sane = \(h\) =>/);
  assert.match(s, /Math\.abs\(size - qty\) > 5/);
  assert.match(s, /pending\|cancel\|return/);
});

test('v411: nightly snapshot + chunked drawer + vc16 cell', async () => {
  const fs = await import('node:fs');
  const s = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(s, /OD_SNAP_TAB = 'CACHE_OFFDISP'/);
  assert.match(s, /function officeDispatchedNightly/);
  assert.match(s, /ff2: \{ enabled: true, tab: 'Sheet11'/);
  const h = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
  assert.match(h, /od-shown/);
  assert.doesNotMatch(h, /slice\(0, 1500\)/);
  const c = fs.readFileSync(new URL('../npci-colors.css', import.meta.url), 'utf8');
  assert.match(c, /td\.npci-cell\[data-vc="vc16"\]/);
});
