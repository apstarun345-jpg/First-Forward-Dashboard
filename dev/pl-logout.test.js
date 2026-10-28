import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
test('personal link has Logout button and ?logout=1 route', () => {
  assert.match(src, /🚪 Logout<\/a>/);
  assert.doesNotMatch(src, /🔒 Lock<\/button>/);
  assert.match(src, /urlQ\.get\('logout'\) === '1'/);
  assert.match(src, /\?logout=1/);
});
test('header decoration cannot swallow clicks on the Logout button', () => {
  assert.match(src, /\.pb-wrap \.pb-head::after\{pointer-events:none;/);
  assert.match(src, /\.pb-wrap \.pb-head>\.pb-btn[^}]*z-index:2/);
});
test('personal link issuance donuts only show VC4/5/6/7/12/16', () => {
  assert.match(src, /var ISS_CLS = \['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16'\]/);
  assert.match(src, /PL_ISS_CLS = \['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16'\]/);
});
