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

test('🔁 Dual channel — FF TL ApnaPayment => ghost, review flag nahi', () => {
  const src = read('insights.js');
  assert.match(src, /isGvChannelTl\(ffTl\)/);
  assert.match(src, /const isGvChannelTl/);
});

test('⚡ Cross Channel — heavy detail tables lazy, redesign hook, TL ghost on Master Stock', () => {
  assert.match(read('compare.js'), /buildKpiDetails/);
  assert.match(read('insights.js'), /buildMsSets/);
  assert.match(read('insights.js'), /isGvChannelTl\(f\.tlName\)/);
  assert.match(read('app.js'), /dataset\.cc = '1'/);
  assert.match(read('newAgents.js'), /collectCache/);
  assert.match(read('dev/styles-full.css'), /body\[data-cc\] \.ins-metrics/);
});

test('🔢 Barcode har jagah 6-3-7 — DOM safety net + CSV', () => {
  assert.match(read('ui-plus.js'), /FF\.dashBarcodes/);
  assert.match(read('util.js'), /\$1-\$2-\$3/);
});

test('🧠 AI Business Analyst — page registered everywhere', () => {
  assert.match(read('app.js'), /id: 'aiAnalyst'/);
  assert.match(read('lazy.js'), /aiAnalyst: \[/);
  assert.match(read('server.js'), /key: 'aiAnalyst'/);
  assert.match(read('home.js'), /#\/aiAnalyst/);
  assert.match(read('aiAnalyst.js'), /FF\.pages\.aiAnalyst/);
});

test('🧠 AI Analyst — FF/GV master-ID separation + clickable drill', () => {
  const src = read('aiAnalyst.js');
  assert.match(src, /r\.channel !== 'GV Partner'/);
  assert.match(src, /function openDrill/);
  assert.match(src, /data-drill/);
});

test('🏷️ Tag Request label — Deliver To + sender sirf naam, Req/Emp/TL meta aur #ID nahi', () => {
  const src = read('tagRequest.js');
  assert.doesNotMatch(src, /Req #\$\{/);
  assert.doesNotMatch(src, /Emp: \$\{/);
  assert.doesNotMatch(src, /<span class="lbl-id">/);
  assert.match(src, /FROM: Name - \$\{f\.name\}`/);
  assert.doesNotMatch(src, /\(RECEIVER\)|\(SENDER\)/);
});

test('📗 FASTag Mapping — Sheet pending finder: agent/class wise + single/group/all map', () => {
  const src = read('fastagMapping.js');
  assert.match(src, /function pendingModel/);
  assert.match(src, /id="fm-gs-pending"/);
  assert.match(src, /data-fm-pm-all/);
  assert.match(src, /data-fm-pm-agent/);
  assert.match(src, /data-fm-pm-class/);
  assert.match(src, /data-fm-pm-one/);
  assert.match(src, /id="fm-pending"/);
});
