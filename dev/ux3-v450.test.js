import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const d = fileURLToPath(new URL('..', import.meta.url)); const rd = (f) => fs.readFileSync(d + f, 'utf8');
const css = rd('ux3.css'), js = rd('ux3.js'), idx = rd('index.html');
test('ux3 wired', () => { assert.match(idx, /ux3\.css\?v=1/); assert.match(idx, /ux3\.js\?v=3/); });
test('features present', () => {
  for (const k of ['charts', 'rings', 'flips', 'magnet', 'tabs', 'glare', 'tick', 'bad', 'truck']) assert.match(js, new RegExp('function ' + k));
  assert.match(js, /ff-scan/); assert.match(js, /vibrate/); assert.match(js, /chime/);
  for (const k of ['ux3-ink', 'ux3-glare', 'ux3-flipper', 'ux3-tick', 'ux3-shake', 'ux3-flash', 'ux3-truck', 'ux3-prog', '@property --p', 'ff-no-anim']) assert.ok(css.includes(k), k);
});
test('dispatch flag + loader bar', () => { assert.match(rd('tagRequest.js'), /dispatch: !!it\.info\.dispatch/); assert.match(rd('kpiDetail.js'), /ux3-prog/); });
