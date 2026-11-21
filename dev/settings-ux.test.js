import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
test('Settings design system + permissions UI + quick-jump are wired', () => {
  const html = r('index.html'), js = r('settings-ux.js'), css = r('settings-ux.css');
  assert.match(html, /settings-ux\.css/); assert.match(html, /settings-ux\.js/);
  for (const k of ['pmx-bar', 'pmx-meter', 'splitLabel', 'set-suggest', 'dataset.sens', 'data-g']) assert.ok(js.includes(k), k);
  for (const k of ['.page-settings .set-group', '.pmx-gh', 'appearance: none', '#set-suggest']) assert.ok(css.includes(k), k);
});
test('presence/live-screen keep working when bell (notifyAccess) is off', () => {
  const n = r('notifications.js');
  assert.match(n, /const acc = hasAccess\(\)/);
  assert.ok(!/if \(!hasAccess\(\)\) \{ state\.started = true; return; \}/.test(n), 'start() must not return early for bell-off users');
  assert.match(n, /state\.presenceTimer = setInterval/);
});
test('robot keeps each user\'s activity separate', () => {
  assert.match(r('mascot.js'), /x\.meta && \(x\.meta\.username \|\| x\.meta\.publicSessionId\)/);
});
