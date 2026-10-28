/* 🔄 Update toast needs sw.js CACHE_NAME to change on every release; 🔐 personal-link sessions survive restarts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('sw.js CACHE_NAME carries the package version (bump both on every release → "new version" toast fires)', () => {
  const v = JSON.parse(read('package.json')).version;
  const cache = (read('sw.js').match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  assert.equal(cache, `apnapayment-v${v}`);
});

test('personal link sessions are signed (stateless) so a deploy/restart does not log viewers out', () => {
  const src = read('server.js');
  assert.match(src, /function plVerifySigned/);
  assert.match(src, /const value = `\$\{head\}\.\$\{plSessionMac/);
  assert.match(src, /if \(value\.startsWith\('v2\.'\)\) return plVerifySigned\(value, link\)/);
  assert.match(src, /l\.revokedAt = Date\.now\(\)/);
});
