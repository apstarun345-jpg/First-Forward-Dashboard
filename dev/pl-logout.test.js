import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
test('personal link has Logout button and ?logout=1 route', () => {
  assert.match(src, /🚪 Logout<\/button>/);
  assert.doesNotMatch(src, /🔒 Lock<\/button>/);
  assert.match(src, /urlQ\.get\('logout'\) === '1'/);
  assert.match(src, /\?logout=1/);
});
