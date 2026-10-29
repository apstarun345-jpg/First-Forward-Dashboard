import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const dr = fs.readFileSync(new URL('../dispatch-report.js', import.meta.url), 'utf8');
const srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
test('agent mobile is never sliced from a long agent ID', () => {
  assert.doesNotMatch(dr, /idc\.slice\(-10\)/);
  assert.match(dr, /\[6-9\]\\d\{9\}/);
  assert.match(srv, /\/\^\[6-9\]\\d\{9\}\$\/\.test\(String\(id \|\| ''\)\.trim\(\)\)/);
});
