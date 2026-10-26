/* TL names in the tag-request/dispatch table are clickable and open Master Search. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('tag request: TL name is a link that opens Master Search', async () => {
  const src = await fs.readFile(new URL('../tagRequest.js', import.meta.url), 'utf8');
  assert.match(src, /function tlLink\(/);
  assert.match(src, /data-tr-tlgo=/);
  assert.match(src, /TL \$\{tlLink\(ag\.tl\)\}/, 'dispatch table agent cell uses the link');
  assert.match(src, /FF\.masterSearch\.openSearchPage\(name\)/);
  const css = await fs.readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.tr-tl-link/);
});
