import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; const __dirname = fileURLToPath(new URL('.', import.meta.url));
const css = fs.readFileSync(__dirname + '/../ux2.css', 'utf8'), js = fs.readFileSync(__dirname + '/../ux2.js', 'utf8'), idx = fs.readFileSync(__dirname + '/../index.html', 'utf8'), tr = fs.readFileSync(__dirname + '/../tagRequest.js', 'utf8');
test('ux2 wired in index', () => { assert.match(idx, /ux2\.css\?v=2/); assert.match(idx, /ux2\.js\?v=1/); });
test('css features gated + opt-out', () => {
  assert.match(css, /container: ux2main \/ inline-size/); assert.match(css, /@supports \(animation-timeline: view\(\)\)/);
  assert.match(css, /@property --ux2-a/); assert.match(css, /view-transition-name: ux2-main/); assert.match(css, /ff-no-anim/);
});
test('js: view transition, spotlight, undo', () => {
  assert.match(js, /startViewTransition/); assert.match(js, /ux2-spot/); assert.match(js, /FF\.undo|W\.FF\.undo/); assert.match(js, /key|ctrlKey/);
  new Function('window', 'document', 'matchMedia', 'navigator', js.replace(/\}\)\(window\);\s*$/, '})(window);')); // parses
});
test('tag request delete offers undo', () => { assert.match(tr, /undo\.offer\('Scan hata diya'/); });
