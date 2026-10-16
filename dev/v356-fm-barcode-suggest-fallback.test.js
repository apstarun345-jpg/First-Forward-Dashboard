/* FASTag Mapping barcode box: when the Master Search index has no hit, ask the server StockDataa index (exact match)
   instead of showing a bare "No match". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'fastagMapping.js'), 'utf8');

test('barcode suggest falls back to the server StockDataa lookup (debounced, cached, hyphen-safe)', () => {
  assert.match(src, /const srvHits = new Map\(\)/);
  assert.match(src, /serverLookup\(\[\{ type: 'barcode', barcode: k \}\], false\)/);
  assert.match(src, /replace\(\/\[\\s,\\u00a0-\]\/g, ''\)/, 'dashes/spaces stripped before the exact lookup');
  assert.match(src, /setTimeout\(\(\) => \{ if \(barBox\.isConnected/);
  assert.match(src, /if \(!r\.items\.length\) \{ const fb = srvFallbackItems\(\)/);
  assert.match(src, /Checking StockDataa/);
  assert.match(src, /sugRef = sug;/);
});
