// The English dictionary and the stylesheet are split into core + per-page chunks by dev/shard-i18n.js and
// dev/split-css.js. These tests make sure the generated files stay in sync with their full sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('English dictionary: core + chunks == dev/i18n-en-full.json', () => {
  const full = JSON.parse(read('dev/i18n-en-full.json'));
  const merged = {};
  const files = ['i18n-en.js', ...fs.readdirSync(ROOT).filter((f) => /^i18n-en-.+\.js$/.test(f))];
  for (const f of files) {
    const sandbox = { window: {} };
    sandbox.window.window = sandbox.window;
    sandbox.window.FF = { i18n: { extend: (_l, d) => Object.assign(merged, d) } };
    vm.runInNewContext(read(f), sandbox);
  }
  assert.equal(Object.keys(merged).length, Object.keys(full).length, 'same number of phrases — run: node dev/shard-i18n.js');
  for (const [k, v] of Object.entries(full)) assert.equal(merged[k], v, `phrase intact: ${k.slice(0, 60)}`);
});

test('Stylesheet: core + chunks contain every rule of dev/styles-full.css', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = (s) => new Set((strip(s).match(/[^{}]+\{[^{}]*\}/g) || []).map((r) => r.replace(/\s+/g, ' ').trim()));
  const parts = read('styles.css') + fs.readdirSync(ROOT).filter((f) => /^styles-.+\.css$/.test(f)).map(read).join('\n');
  const a = rules(read('dev/styles-full.css')); const b = rules(parts);
  for (const r of a) assert.ok(b.has(r), `rule present after split: ${r.slice(0, 80)} — run: node dev/split-css.js`);
});
