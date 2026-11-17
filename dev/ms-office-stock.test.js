import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('master search tagStatus marks office stock', () => {
  const s = fs.readFileSync(new URL('../masterSearch.js', import.meta.url), 'utf8');
  assert.match(s, /OFFICE STOCK/);
  assert.match(s, /tg-office/);
  assert.match(s, /PLACEHOLDER_RX/, 'Not Assigned placeholder is not a holder');
});
