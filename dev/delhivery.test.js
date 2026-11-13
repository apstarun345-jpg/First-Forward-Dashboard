// 🚚 v3.125.258 — Delhivery Tracking page helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function boot() {
  const FF = { util: { esc: (s) => String(s), spinner: () => '' }, pages: {} };
  const ctx = { window: { FF }, FF, console, Date, Number, String, Set, Map };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../delhivery.js', import.meta.url), 'utf8'), ctx);
  return FF.pages.delhivery._test;
}

test('pincode + AWB parsing (comma / space / newline, dedupe)', () => {
  const T = boot();
  assert.deepEqual([...T.splitPins('302001, 110001\n302001 4000 400001')], ['302001', '110001', '400001']);
  assert.deepEqual([...T.splitAwbs('1234567890123, 98765432101 ;1234567890123')], ['1234567890123', '98765432101']);
});

test('status tone', () => {
  const T = boot();
  assert.equal(T.statusTone({ status: 'Delivered', statusType: 'DL' })[0], 'green');
  assert.equal(T.statusTone({ status: 'In Transit', statusType: 'UD' })[0], 'blue');
  assert.equal(T.statusTone({ status: 'RTO', statusType: 'RT' })[0], 'orange');
  assert.equal(T.statusTone({ status: 'Undelivered' })[0], 'red');
  assert.equal(T.statusTone({ awb: 'X', notFound: true })[0], 'gray');
});
