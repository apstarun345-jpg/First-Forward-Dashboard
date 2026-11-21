import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
test('NPCI FASTag colours: VC4 violet, VC5 orange, VC6 yellow, VC7 green, VC12 pink, VC15 blue, VC16 black', () => {
  const css = r('npci-colors.css');
  for (const [k, v] of [['4', '#7c3aed'], ['5', '#f97316'], ['6', '#eab308'], ['7', '#16a34a'], ['12', '#ec4899'], ['15', '#2563eb'], ['16', '#1f2937']]) assert.ok(css.includes(`--npci-${k}: ${v}`), k);
  assert.match(r('index.html'), /npci-colors\.css/); assert.match(r('index.html'), /npci-colors\.js/);
  const ch = r('charts.js'); assert.match(ch, /VC4: '#7c3aed'/); assert.match(ch, /VC16: '#1f2937'/);
});

test('gradient vc tiles: npci-chip label stays visible', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../npci-colors.css', import.meta.url), 'utf8');
  assert.match(css, /\.msp-vc3 \.npci-chip[^}]*background: transparent/);
});

test('VC16 chip text always light', () => {
  assert.match(r('npci-colors.css'), /npci-chip\[data-vc="vc16"\][^}]*color: #f9fafb !important/);
});

test('unusual tiles: unit/CTA/icon readable on gradient', () => {
  assert.match(r('npci-colors.css'), /ua-kpi-card \.ua-kpi-cta[^}]*color: rgba\(255, 255, 255/);
});
