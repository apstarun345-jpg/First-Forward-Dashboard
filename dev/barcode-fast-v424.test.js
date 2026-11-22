import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const bc = fs.readFileSync(new URL('../barcodeChecker.js', import.meta.url), 'utf8');
const sv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
test('barcode checker paints stock before EIR and caches EIR', () => {
  assert.match(bc, /EIR_CACHE/);
  assert.match(bc, /early\(build\(new Map\(\)\)\)/g);
  assert.match(bc, /checkRange\(first, last, isHex\(tag\) \? tag : '', earlyPaint\)/);
  assert.match(bc, /checkMulti\(list, earlyPaint\)/);
});
test('server has 504 guard returning retryable 503', () => {
  assert.match(sv, /504-guard/);
  assert.match(sv, /retryAfterMs: 3000/);
});
test('dispatch lookup serves stale cache / ready index instantly', () => {
  assert.match(sv, /stale-while-revalidate/);
  assert.match(sv, /mode: 'index', at: new Date\(ledgerState\.at\)/);
});
test('dispatch ledger pack: nightly durable save + boot load + live fallback for misses', () => {
  assert.match(sv, /CACHE_LEDGER/);
  assert.match(sv, /ledgerPackNightly\(\)/);
  assert.match(sv, /ledgerPackLoad\(\)\.catch/);
  assert.match(sv, /ledgerDirect\(ml\)/);
});
