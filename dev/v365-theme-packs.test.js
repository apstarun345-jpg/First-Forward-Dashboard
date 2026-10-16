import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const meta = JSON.parse(read('theme-packs.json'));
const keys = Object.keys(meta);

test('every theme pack has CSS (vars, KPI palette, chart palette) in themes.css', () => {
  const css = read('themes.css');
  assert.ok(keys.includes('navy'), 'Navy & White pack must exist');
  for (const k of keys) {
    assert.match(css, new RegExp(`html\\[data-theme-pack="${k}"\\] \\{`), k + ' vars block');
    assert.match(css, new RegExp(`html\\[data-theme-pack="${k}"\\] \\.g13 \\{`), k + ' KPI palette');
  }
  assert.equal((css.match(/--chart-pal:/g) || []).length, keys.length);
});

test('ui-boot applies pack + mode before paint and knows every pack', () => {
  const boot = read('ui-boot.js');
  for (const k of keys) assert.match(boot, new RegExp(`${k}: '${meta[k].mode}'`), 'ui-boot mode for ' + k);
  assert.match(boot, /ff_theme_pack/);
  assert.match(boot, /ff_brand_cache/);
  assert.match(read('index.html'), /themes\.css/);
});

test('wowzone picker lists every pack and branding is cached for early paint', () => {
  const wz = read('wowzone.js');
  for (const k of keys) assert.match(wz, new RegExp(`\\n    ${k}: \\{ name:`), 'picker has ' + k);
  const au = read('auth.js');
  assert.match(au, /ff_brand_cache/);
  assert.match(au, /!document\.documentElement\.dataset\.themePack/);
  assert.match(read('charts.js'), /syncPackPalette/);
});

test('FASTag Mapping shows 16-digit barcodes sheet-style with dashes (display only)', () => {
  const fm = read('fastagMapping.js');
  assert.match(fm, /function dashBar/);
  assert.match(fm, /label: dashBar\(it\.barcode\)/);
  assert.match(fm, /inputValue: dashBar\(it\.barcode\)/);
  assert.match(fm, /value: it\.barcode,/, 'raw digits stay in value for lookup');
});
