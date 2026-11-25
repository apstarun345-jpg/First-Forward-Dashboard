/* v3.125.502 — Home complaints (2 + arrow), Master Search instant profile shell, faster page skeleton, slow-click telemetry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
test('home complaints: sirf 2 dikhte, baaki <details> arrow me', () => {
  const s = read('smartCenter.js');
  assert.match(s, /const FIRST = 2, shown = ev\.slice\(0, FIRST\), rest = ev\.slice\(FIRST, 12\)/);
  assert.match(s, /<details class="sc-cmp-fold"/);
});
test('master search: profile shell turant + next paint', () => {
  const s = read('masterSearch.js');
  assert.match(s, /const profileShell = \(nm\) =>/);
  assert.match(s, /out\.innerHTML = profileShell\(q\);\s*\n\s*(?:try \{ await buildLight\(\); \} catch \{[^}]*\}|\/\/[^\n]*\n\s*if \(!state\.light\) buildLight\(\)\.catch\(\(\) => \{\}\);)/);   // v515: selected suggestion no longer waits for buildLight
  assert.match(s, /await nextPaint\(\);/);
});
test('app: skeleton 40 ms + slow click telemetry', () => {
  const s = read('app.js');
  assert.match(s, /\}, 40\);   \/\/ v3\.125\.502/);
  assert.match(s, /durationThreshold: 250/);
});
