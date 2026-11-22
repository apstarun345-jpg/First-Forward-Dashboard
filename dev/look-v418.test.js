import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const d = fileURLToPath(new URL('..', import.meta.url));
test('v418 hooks', () => {
  const m = fs.readFileSync(d + 'ui-motion.js', 'utf8'), h = fs.readFileSync(d + 'home.js', 'utf8');
  assert.ok(m.includes('heroExtras') && m.includes('ux-ac') && m.includes('ff_sound') && m.includes('chime'));
  assert.ok(h.includes("FF.motion.chime('alert')") && h.includes("FF.motion.chime('win')"));
});
