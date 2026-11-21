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
  for (const k of ['paintStatus', 'paintEmpty', 'progStart', 'wakeShow', 'actCsv', 'actWa', 'actPrint']) assert.match(js, new RegExp(k));
  for (const k of ['td.ux-st', 'uxDraw', '#ux-wake', '#ux-bar', '@media print']) assert.ok(css.includes(k), k);
  assert.ok(!/prefers-reduced-motion/.test(css + js), 'ui-motion must not obey OS reduce motion');
});
