import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const tr = rd('tagRequest.js'), app = rd('app.js'), ms = rd('masterSearch.js'), boot = rd('ui-boot.js'), css = rd('dev/styles-full.css');

test('Tag Request: phone card view + swipe approve/dispatch (admin, cards only)', () => {
  assert.match(tr, /const cardsOn = \(\) =>/);
  assert.match(tr, /applyCardMode\(\);\n    updateSelUi\(\)/, 'card mode re-applied on every table render');
  assert.match(tr, /dx > 90 \? 'approved' : dx < -90 \? 'dispatched' : ''/);
  assert.match(tr, /if \(!isAdmin\(\) \|\| !wrap\.classList\.contains\('tr-cards'\)/);
  assert.match(tr, /Pehle Approve karo/);
  assert.match(css, /\.tr-req-wrap\.tr-cards tr\.tr-req-row \{ display: grid/);
  assert.match(css, /td\.tr-m \{ display: none; \}/, 'heavy stock/issuance cells hidden until opened');
});
test('Theme: light → dark → auto (system) cycle; boot honours auto', () => {
  assert.match(app, /\{ light: 'dark', dark: 'auto', auto: 'light' \}/);
  assert.match(app, /prefers-color-scheme: dark/);
  assert.match(boot, /explicitTheme === 'auto'/);
});
test('Bottom nav shows Requests for users with Tag Request access', () => {
  assert.match(app, /id: 'tagRequest', icon: 'clipboard', label: 'Requests'/);
});
test('Search: recent + pinned list on focus', () => {
  assert.match(ms, /const RKEY = 'ff_ms_recent'/);
  assert.match(ms, /data-ms-pin/);
  assert.match(css, /\.ms-recent \{ position: absolute/);
});
test('Shortcuts sheet (?) and success feedback (vibrate, optional sound)', () => {
  assert.match(app, /U\.feedback = function feedback/);
  assert.match(app, /function openShortcutsSheet\(\)/);
  assert.match(app, /localStorage\.getItem\('ff_sound'\) !== '1'/);
  assert.match(tr, /U\.feedback\('done'\)|U\.feedback\(fail \? 'warn' : 'done'\)/);
});
