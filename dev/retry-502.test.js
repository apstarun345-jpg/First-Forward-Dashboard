import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const a = fs.readFileSync(new URL('../auth.js', import.meta.url), 'utf8');
test('502 retry covers dispatch-status and barcode lookups, ~2 min window', () => {
  assert.match(a, /dispatch-status/);
  assert.match(a, /barcode-lookup/);
  const m = /RETRY_WAITS = \[([^\]]+)\]/.exec(a);
  const sum = m[1].split(',').map(Number).reduce((x, y) => x + y, 0);
  assert.ok(sum >= 100000, 'retry window ' + sum);
});
