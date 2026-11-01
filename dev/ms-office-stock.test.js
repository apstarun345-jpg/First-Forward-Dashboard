import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('master search tagStatus marks office stock', () => {
  const s = fs.readFileSync(new URL('../masterSearch.js', import.meta.url), 'utf8');
  assert.match(s, /OFFICE STOCK/);
  assert.match(s, /ms-office-row/);
});
