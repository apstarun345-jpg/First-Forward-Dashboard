/* Web + installed app must show the Master Search / profile UI at the SAME type scale.
   The phone / native-shell layers inflate small text globally; one late block in mobile-fix.css pins the profile
   (.msp-* .mp-* .pi-* .ps-*) sizes for both. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('mobile-fix.css pins one shared profile type scale (web + app)', () => {
  const css = read('mobile-fix.css');
  const at = css.indexOf('Profile / Master Search type scale');
  assert.ok(at > 0, 'parity block present');
  const block = css.slice(at);
  for (const v of ['--pf-label', '--pf-meta', '--pf-body', '--pf-tab', '--pf-head']) assert.ok(block.includes(v), `${v} defined`);
  assert.ok(!block.includes('html.mobile-ui'), 'block must not be limited to mobile — it applies to web too');
  assert.ok(block.includes('html :is(.main, #drawer)'), 'id inside :is() outranks native-shell #drawer / .main rules');
  for (const sel of ['.mp-tab', '.pi-box em', '.ps-val small', '.msp-kpi-card .card-head h3', '.pi-seg button', '.mp-actions .btn']) assert.ok(block.includes(sel), `${sel} covered`);
  assert.ok(/mobile-fix\.css\?v=(\d+)/.test(read('index.html')), 'index.html versions mobile-fix.css');
});

test('profile tabs fit on a phone as an equal-width grid (no cut-off "Stock & d…")', () => {
  const css = read('dev/styles-full.css');
  const m = css.match(/@media \(max-width: 640px\) \{\s*\.mp-toolbar \{[\s\S]*?\n\}/);
  assert.ok(m, 'phone block for the profile toolbar');
  assert.match(m[0], /\.mp-nav \{[^}]*display: grid/);
  assert.match(m[0], /\.mp-tab \{[^}]*white-space: normal/);
  assert.ok(!/\.mp-nav \{[^}]*overflow-x: auto/.test(m[0]), 'tabs no longer scroll sideways');
});
