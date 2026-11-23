import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const d = fileURLToPath(new URL('..', import.meta.url)); const rd = (f) => fs.readFileSync(d + f, 'utf8');
test('ticker wired', () => { const i = rd('index.html'); assert.match(i, /ux4\.css/); assert.match(i, /ux4\.js/); });
test('ticker uses feed + scan-log limit, admin only, dismissable', () => {
  const j = rd('ux4.js'); assert.match(j, /api\/robot\/feed/); assert.match(j, /api\/scan-log\?limit=12/); assert.match(j, /role === 'admin'/); assert.match(j, /ff_ticker_off/);
  assert.match(rd('server.js'), /searchParams\.get\('limit'\)/);
});
test('css opt-out', () => { const c = rd('ux4.css'); assert.match(c, /ff-no-anim/); assert.match(c, /@media print/); });
