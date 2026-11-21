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
