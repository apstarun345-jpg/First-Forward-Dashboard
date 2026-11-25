/* v3.125.493 — dispatch barcode list: server cache + prewarm + client prefetch (click par instant). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
test('server: dispatch-status result cache + prewarm from dispatch-by', () => {
  const s = read('server.js');
  assert.match(s, /async function dspStatusCompute\(ch, ranges\)/);
  assert.match(s, /async function dspStatusCached\(ch, ranges\)/);
  assert.match(s, /const payload = await dspStatusCached\(ch, ranges\);/);
  assert.match(s, /dspPrewarm\(ch, dates\);/);
});
test('client: last dispatch barcode list prefetched before click', () => {
  assert.match(read('masterSearch.js'), /if \(i === 0\) setTimeout\(\(\) => \{ if \(box\.isConnected\) dspStatusOf\(list\[0\]\)/);
});
