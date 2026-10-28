import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../masterSearch.js', import.meta.url), 'utf8');
test('Master Search hero shows ID / TL / mobile details strip', () => {
  assert.match(src, /id="msp-det"/);
  assert.match(src, /const paintDet = /);
  assert.match(src, /'TL mobile'/);
  assert.match(src, /FF\.auth\.can\('contacts'\)/);
});
