/* v3.125.51 — login se pehle default columns se bana dataset, settings aate hi sahi columns se dobara. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { hash: '#/home', href: '' };
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false,
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true },
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
};
['config', 'util', 'data', 'model', 'gv', 'store'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;

FF.pages = FF.pages || {};

test('datasets built before settings are rebuilt with the real column letters', async () => {
  const seen = [];
  FF.data.query = async (sheet, tq) => { seen.push(tq); return { cols: [], rows: [] }; };
  FF.gv.enabled = () => false;
  await FF.store.need('daily', { only: true });
  assert.ok(seen.some((q) => /\bBA\b/.test(q)), 'pehle default TL column BA');
  FF.config.apply({ eir: { ...FF.config.eir, tlName: 'AW' } });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(seen.some((q) => /\bAW, count/.test(q) || /AU, AW,/.test(q)), 'settings ke baad AW se dobara: ' + seen.slice(-1)[0]);
});
