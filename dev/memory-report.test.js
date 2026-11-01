/* v3.125.31 — admin memory report + smaller brotli window. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const s = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
test('admin memory report and brotli window', () => {
  assert.match(s, /p === '\/api\/admin\/memory' && method === 'GET'\) \{\s*requireAdmin\(user\);/);
  assert.match(s, /const BR_LGWIN = Math\.min\(24, Math\.max\(10, Number\(process\.env\.BR_LGWIN\) \|\| 18\)\);/);
  assert.equal((s.match(/BROTLI_PARAM_LGWIN\]: BR_LGWIN/g) || []).length, 3);
});
