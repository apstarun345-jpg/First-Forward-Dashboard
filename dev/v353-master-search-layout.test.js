/* 🗂️ Master Search — one proper layout (hero → KPI cards → pulse line → tabs); nothing shown twice. Static guards. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('masterSearch.js never calls an undefined bare $$ (channel chip click used to throw)', () => {
  assert.ok(!/(^|[^.\w$])\$\$\(/m.test(read('masterSearch.js')));
});

test('the 3-box "today snapshot" is one slim pulse line; trend card is hidden once a profile is open', () => {
  const src = read('masterSearch.js');
  assert.ok(!src.includes('msp-today'));
  assert.match(src, /data-msp-pulse="gv"/); assert.match(src, /data-msp-pulse="ff"/);
  assert.match(src, /if \(trendEl\) trendEl\.hidden = true;/);
  assert.match(src, /if \(trendEl\) trendEl\.hidden = false;/);
});

test('profile html: embedded (page) and drawer variants drop the repeated header / growth / KPI strip', () => {
  const src = read('masterProfile.js');
  assert.match(src, /const embedded = !!\(opts && opts\.embedded\)/);
  assert.match(src, /const drawer = !!\(opts && opts\.drawer\)/);
  assert.match(src, /\$\{embedded \? '' : growthCell\(pr\)\}/);
  assert.match(src, /slot\.innerHTML = html\(profile, \{ drawer: true \}\)/);
  assert.match(read('searchReport.js'), /renderInto\(pane, g\[t\], \{ embedded: true \}\)/);
});

test('KPI cards sit in a 5-column grid (10 cards → 5 + 5) and the specificity beats the generic .mp-kpis rule', () => {
  const css = read('dev/styles-full.css');
  assert.match(css, /\.mp-kpis\.msp-kpis \{ grid-template-columns: repeat\(5, minmax\(0, 1fr\)\); \}/);
});
