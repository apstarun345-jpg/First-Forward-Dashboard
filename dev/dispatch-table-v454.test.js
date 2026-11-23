import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const d = fileURLToPath(new URL('..', import.meta.url)); const rd = (f) => fs.readFileSync(d + f, 'utf8');
test('last dispatch = date x class table (Dispatched | Issued | In stock)', () => {
  const m = rd('masterSearch.js');
  assert.match(m, /function dispTableHtml/); assert.match(m, /<th class="n">Dispatched<\/th><th class="n">Issued<\/th><th class="n">In stock<\/th>/); assert.match(m, /function dtbFill/);
  assert.match(m, /data-dsp-open="\$\{i\}\|\$\{name\}\|\$\{esc\(key\)\}"/); assert.doesNotMatch(m, /class="dsp-list"/);
  assert.match(rd('styles.css'), /\.dtb-wrap/);
});
test('3D godown + profile Overview/Account tabs removed', () => {
  const w = rd('wow.js'); assert.doesNotMatch(w, /function godown/); assert.doesNotMatch(w, /wow-gd-btn/); assert.doesNotMatch(rd('wow.css'), /wow-gd|wow-box/);
  assert.match(rd('ui-motion.js'), /function profileTabs\(root\) \{\n\s+return;/);
});
