import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
test('profile pack: nightly server snapshot + endpoint', () => {
  const s = r('server.js');
  assert.match(s, /CACHE_PROFILE/);
  assert.match(s, /function profilePackNightly/);
  assert.match(s, /p === '\/api\/profile-pack' && method === 'GET'/);
  assert.match(s, /\/api\/profile-pack\/warm/);
});
test('master search: instant address from pack + hero section', () => {
  const m = r('masterSearch.js');
  assert.match(m, /function addrPackFind/);
  assert.match(m, /profileInfoFor/);
  assert.match(m, /bindHero/);
  const p = r('profileInsights.js');
  assert.match(p, /function heroHtml/);
  assert.match(p, /full month/);
  assert.match(p, /VC4 rate with max issuance/);
  assert.match(p, /Account details/);
  const pay = r('payslip.js');
  assert.match(pay, /async function infoFor/);
});
