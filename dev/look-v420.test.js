import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const d = fileURLToPath(new URL('..', import.meta.url)); const r = (f) => fs.readFileSync(d + f, 'utf8');
test('v420 look studio wiring', () => {
  const i = r('index.html'); assert.ok(i.includes('look.css') && i.includes('look.js'));
  assert.ok(r('janitor.js').includes('"ff_look"'));
  assert.ok(r('server.js').includes("'.woff2': 'font/woff2'"));
  ['inter', 'poppins', 'manrope', 'hind'].forEach((f) => { for (const w of ['400', '600']) assert.ok(fs.existsSync(`${d}fonts/${f}-latin-${w}-normal.woff2`), f + w); });
  assert.ok(r('charts.js').includes('ff-c-smooth') && r('ui-motion.js').includes('home-look'));
});
