/* v3.125.497 — (1) storage banner sirf 5 min lagataar fail par; (2) Tag Issued header me today-live strip. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
test('server: banner gating (storageFailAt + 5 min)', () => {
  const s = read('server.js');
  assert.match(s, /const storageFailAt = new Map\(\)/);
  assert.match(s, /STORAGE_BANNER_AFTER_MS/);
  assert.match(s, /if \(!storageFailures\.has\(kind\)\) storageFailAt\.set\(kind, Date\.now\(\)\)/);
  assert.match(s, /Date\.now\(\) - \(storageFailAt\.get\(k\) \|\| 0\) > STORAGE_BANNER_AFTER_MS/);
});
test('tagIssued: header ke andar today-live strip (alag card nahi)', () => {
  const t = read('tagIssued.js');
  assert.match(t, /<div class="tix-live" id="ti-live" hidden><\/div>\s*\n\s*<div class="head-actions">/);
  assert.match(t, /function paintLive\(\) \{/);
  assert.match(t, /try \{ paintLive\(\); startLive\(\); \} catch \(e\)/);
  assert.match(read('look.css'), /\.tix-live \{/);
});

test('v501: header live = Home wala source (G.gvToday + server feed), 20 s auto-refresh', () => {
  const t = read('tagIssued.js');
  assert.match(t, /G\.gvToday\(\)/);
  assert.match(t, /FF\.data\.gvToday\(\)/);
  assert.match(t, /G\.syncApiToday\(\)/);
  assert.match(t, /setInterval\(\(\) => \{ if \(!root\.isConnected\)[^}]*\}[^}]*liveTick\(\); \}, 20000\)/);
});
