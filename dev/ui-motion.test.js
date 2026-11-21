import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
test('OS reduce-motion no longer kills site effects (only Settings toggle does)', () => {
  for (const f of ['styles.css', 'ui-extra.js', 'ux-fast.css', 'ui-refresh.css', 'targetAlerts.js']) {
    const t = r(f);
    assert.ok(!/prefers-reduced-motion:\s*reduce\)(?!\s*and\s*\(min-width:\s*99999px)/.test(t), f + ' still obeys OS reduce motion');
  }
});
test('ui-motion is loaded and covers items 6-12', () => {
  const html = r('index.html'), js = r('ui-motion.js'), css = r('ui-motion.css');
  assert.match(html, /ui-motion\.css/); assert.match(html, /ui-motion\.js/);
  for (const k of ['paintStatus', 'paintEmpty', 'progStart', 'actCsv', 'actWa', 'actPrint']) assert.match(js, new RegExp(k));
  for (const k of ['td.ux-st', 'uxDraw', '#ux-bar', '@media print']) assert.ok(css.includes(k), k);
  assert.ok(!/prefers-reduced-motion/.test(css + js), 'ui-motion must not obey OS reduce motion');
});
test('row density control', () => { assert.match(r('ui-motion.js'), /ff_ux_den/); assert.match(r('ui-motion.css'), /data-ux-den="compact"/); });
test('3D design system: tokens, components, branding, toggle', () => {
  const css = r('ui-3d.css'), js = r('ui-motion.js'), html = r('index.html');
  assert.match(html, /ui-3d\.css/);
  for (const k of ['--d-e1', '--d-e4', 'body .kpi', 'body .btn', '.brand-logo', '.sidebar', '.table-wrap']) assert.ok(css.includes(k), k);
  assert.ok(!/prefers-reduced-motion/.test(css));
  assert.match(js, /ff_ux_3d/); assert.match(js, /tiltInit/);
});
test('dock sirf admin ko dikhta hai', () => { assert.match(r('ui-motion.js'), /FF\.auth\.isAdmin\(\)/); });
