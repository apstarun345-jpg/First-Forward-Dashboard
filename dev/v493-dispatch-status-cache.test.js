/* v3.125.493 — dispatch barcode list: server cache + prewarm + client prefetch (click par instant). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
test('server: dispatch-status result cache + prewarm from dispatch-by', () => {
  const s = read('server.js');
  assert.match(s, /async function dspStatusCompute\(ch, ranges, onLate\)/);
  assert.match(s, /async function dspStatusCached\(ch, ranges\)/);
  assert.match(s, /const payload = await dspStatusCached\(ch, ranges\);/);
  assert.match(s, /dspPrewarm\(ch, dates\);/);
});
test('client: last dispatch barcode list prefetched before click', () => {
  assert.match(read('masterSearch.js'), /if \(i === 0\) setTimeout\(\(\) => \{ if \(box\.isConnected\) dspStatusOf\(list\[0\]\)/);
});

test('server: sab agents ka last-dispatch list raat / subah 8 baje / naye stock index par pehle se', () => {
  const s = read('server.js');
  assert.match(s, /async function dspWarmAll\(reason\)/);
  assert.match(s, /hr >= 8 && DSP_WARM\.day !== day/);
  assert.match(s, /setInterval\(\(\) => dspWarmTick\(\), 5 \* 60e3\)/);
  assert.match(s, /zlib\.gzipSync\(JSON\.stringify\(o\)\)/);
});

test('v495: list 2.5 s me (Tag ID enrichment bounded) + client partial par save nahi', () => {
  const s = read('server.js');
  assert.match(s, /async function dspEnrichBounded\(out, ranges, onLate\)/);
  assert.match(s, /partial: !full2/);
  assert.match(read('masterSearch.js'), /if \(res\.partial\) \{ setTimeout\(\(\) => dspStCache\.delete\(key\), 12e3\); return rows; \}/);
});
