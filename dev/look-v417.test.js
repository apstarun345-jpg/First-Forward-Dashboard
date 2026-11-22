import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const d = fileURLToPath(new URL('..', import.meta.url));
test('v417 look hooks', () => {
  const r = (f) => fs.readFileSync(d + f, 'utf8');
  assert.ok(r('themes.css').includes('data-theme-pack="aurora"') && r('themes.css').includes('data-theme-pack="rose"'));
  assert.ok(r('ui-boot.js').includes('aurora') && r('wowzone.js').includes('aurora'));
  assert.ok(r('ui-motion.js').includes('confetti') && r('ui-motion.js').includes('pageTrans') && r('ui-motion.js').includes('ff-scrolled'));
  assert.ok(r('home.js').includes('medal') && r('home.js').includes('hs-rec'));
});
