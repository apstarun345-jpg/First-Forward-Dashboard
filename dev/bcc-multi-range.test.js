import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.FF = globalThis.FF || { pages: {} };
FF.pages = FF.pages || {};
FF.util = FF.util || { esc: (x) => String(x), fmt: (x) => String(x) };
FF.i18n = FF.i18n || { extend() {}, t: (x) => x };
require(path.join(ROOT, 'barcodeChecker.js'));
test('multi list expands "A to B" and "A se B" ranges and skips junk words', () => {
  const p = FF.barcodeChecker.parseMulti('608116-039-0775894 to\n608116-039-0775898\nVc6\n608116-040-0173978 se 608116-040-0173976\n608116-039-0775895');
  assert.equal(p.errors.length, 0);
  assert.deepEqual([...p], ['608116-039-0775894', '608116-039-0775895', '608116-039-0775896', '608116-039-0775897', '608116-039-0775898', '608116-040-0173976', '608116-040-0173977', '608116-040-0173978']);
});
test('too large range reports an error', () => {
  const p = FF.barcodeChecker.parseMulti('608116-039-0000001 to 608116-039-0900000');
  assert.equal(p.length, 0); assert.equal(p.errors.length, 1);
});
