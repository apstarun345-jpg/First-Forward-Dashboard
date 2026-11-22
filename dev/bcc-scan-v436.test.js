import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const bc = fs.readFileSync(new URL('../barcodeChecker.js', import.meta.url), 'utf8');
test('scan tab wiring', () => {
  assert.match(bc, /data-bcc-tab="scan"/);
  assert.match(bc, /data-scan="cam"/);
  assert.match(bc, /BarcodeDetector/);
  assert.match(bc, /vendor\/zxing\.min\.js/);
  assert.match(bc, /ff_bcc_scan/);
  assert.match(bc, /hashchange/);   // camera doosre page par band
});
test('vendor zxing present and janitor knows scan keys', () => {
  assert.ok(fs.statSync(new URL('../vendor/zxing.min.js', import.meta.url)).size > 100000);
  const j = fs.readFileSync(new URL('../janitor.js', import.meta.url), 'utf8');
  assert.match(j, /"ff_bcc_scan"/); assert.match(j, /"ff_bcc_scan_snd"/);
});
test('scanAdd dedupes and queues (vm)', () => {
  const store = {};
  const el = () => ({ addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], classList: { toggle() {} } });
  const ctx = { window: null, document: { addEventListener() {}, hidden: false, createElement: el, head: { appendChild() {} }, querySelector: () => null }, navigator: {}, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {}, location: { hash: '' }, console, BigInt, Map, Set, JSON, Date, Math, Promise };
  ctx.window = ctx; ctx.addEventListener = () => {};
  ctx.FF = { util: { esc: (s) => String(s), fmt: (n) => String(n), $: () => null, toast() {} }, pages: {}, auth: {}, data: { dispatchLookup: async () => ({ map: new Map() }) }, config: { eir: {} } };
  vm.createContext(ctx); vm.runInContext(bc, ctx);
  const B = ctx.FF.barcodeChecker;
  assert.equal(B.scanAdd('608116-032-1004431'), true);
  assert.equal(B.scanAdd('6081160321004431'), false);   // dash ke bina bhi duplicate
  assert.equal(B.scanText('608116-032-1004432\n608116-032-1004433').n, 2);
  assert.equal(B._scan.order.length, 3);
  assert.equal(B._scan.queue.length, 3);
});
