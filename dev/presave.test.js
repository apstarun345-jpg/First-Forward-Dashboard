import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const s = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
test('presave: hot urls saved + warmed on boot', () => {
  assert.match(s, /function hotWarm\(|async function hotWarm/);
  assert.match(s, /hotWarm\('boot'\)/);
  assert.match(s, /db\.settings\.hotUrls = /);
});
test('presave: issued register durable snapshot', () => {
  assert.match(s, /CACHE_ISSUED/);
  assert.match(s, /ibSnapSave\(\)\.catch/);
  assert.match(s, /ibSnapLoad\(\)\.catch/);
});
test('gv live delta: offset query + periodic full refresh', () => {
  assert.match(s, /GV_DELTA_FULL_MS/);
  assert.match(s, /offset \$\{dBase\.rows\.length\}/);
  assert.match(s, /'\+delta'|\+delta/);
});
test('robot brain boot retry + gc after warm', () => {
  assert.match(s, /robotBrain\.retried/);
  assert.match(s, /global\.gc\(\)/);
});
