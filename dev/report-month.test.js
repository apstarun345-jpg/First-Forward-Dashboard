/* v3.125.28 — "Current month" = report date (today − 1): 1 Nov → October everywhere. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { hash: '#/home', href: '' };
globalThis.document = { documentElement: { dataset: {}, style: { setProperty() {} } }, hidden: false, body: { appendChild() {}, classList: { add() {}, remove() {} } }, addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} }), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
['config', 'util'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const U = globalThis.FF.util;

test('reportYm: 1st of the month is still the previous month; 2nd is the new month', () => {
  assert.equal(U.reportYm(new Date(2026, 10, 1, 9, 21)), '2026-10');
  assert.equal(U.reportYm(new Date(2026, 10, 2, 0, 5)), '2026-11');
  assert.equal(U.reportYm(new Date(2026, 0, 1)), '2025-12');
});

test('GV basis on the 1st uses the full previous month', () => {
  const b = U.channelBasis('gv', { now: new Date(2026, 10, 1, 10) });
  assert.equal(b.ym, '2026-10');
  assert.equal(b.days, 31);
});

test('no page derives the current month from today directly any more', () => {
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js') && !['util.js', 'server.js', 'sw.js'].includes(f));
  const bad = files.filter((f) => /ymKey\(new Date\(\)\)/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(bad, []);
  assert.match(fs.readFileSync(path.join(ROOT, 'home.js'), 'utf8'), /const curKey = U\.reportYm\(TODAY\(\)\)/);
});

test('v3.125.33: tvcClass — CCH → TVC, VC4 / VC20 alag', () => {
  const t = U.tvcClass;
  assert.equal(t('VC4'), 'VC4'); assert.equal(t('VC20'), 'VC20'); assert.equal(t('4'), 'VC4');
  assert.equal(t('VC10'), 'VC7'); assert.equal(t('VC13'), 'VC12'); assert.equal(t('VC14'), 'VC12');
  assert.equal(t('VC11'), 'VC6'); assert.equal(t('VC8'), 'VC6'); assert.equal(t('VC9'), 'VC5'); assert.equal(t('VC17'), 'VC16');
  assert.equal(t('vc 7'), 'VC7'); assert.equal(t('NA'), 'NA');
});
