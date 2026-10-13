/* 🎨 v3.75 UI refresh — wiring + the specific bugs it fixes (diagnosis sweep me mile the). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFile(path.join(ROOT, f), 'utf8');

test('ui-refresh.css loads after mobile-fix and before the native shell', async () => {
  const idx = await read('index.html');
  const at = (s) => idx.indexOf(s);
  assert.ok(at('ui-refresh.css') > at('mobile-fix.css') && at('ui-refresh.css') < at('native-shell.css'));
});

test('KPI cards stay colourful: every gN has a 3-stop palette and the gradient uses it', async () => {
  const css = await read('ui-refresh.css');
  for (let i = 1; i <= 13; i++) assert.match(css, new RegExp(`\\.g${i}\\s+\\{ --k1: #[0-9a-f]{6}; --k2: #[0-9a-f]{6}; --k3: #[0-9a-f]{6};`), `g${i}`);
  assert.match(css, /linear-gradient\(140deg, var\(--k1/);
});

test('layout + readability fixes from the diagnosis', async () => {
  const css = await read('ui-refresh.css');
  assert.match(css, /\.metric-grid \{ display: grid;/, 'Direct/New Agents KPI cards were full-width');
  assert.match(css, /overflow-wrap: break-word !important/, 'table columns no longer break letter-by-letter');
  assert.match(css, /\.chip\.on \.count \{ background: rgba\(67, 56, 202, \.14\); color: #3730a3; \}/, 'selected chip count was white on light');
  const styles = await read('dev/styles-full.css');
  assert.doesNotMatch(styles, /:has\(#tr-body\)/, 'Trend also uses #tr-body — Tag Request light-mode rules must not leak into Trend');
  assert.match(styles, /\.main:has\(\.page-tagRequest\)/);
});
