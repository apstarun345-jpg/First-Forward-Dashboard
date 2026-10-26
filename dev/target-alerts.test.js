/* v3.101 — Home "Target updates": achieved + no-improvement alerts from saved targets. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { documentElement: { dataset: {}, style: {} }, body: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {} }) };
globalThis.addEventListener = () => {};
['config', 'util', 'targetAlerts'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const TA = globalThis.FF.targetAlerts;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 36e5).toISOString();
const t = (key, extra) => ({ key, ym: '2026-10', source: 'ff', agent: key.split('|')[1], target: 50, at: hoursAgo(30), ...extra });

test('achieved: issuance >= target; active goal achieved once issuance starts', () => {
  const cur = new Map([['ff|A', 55], ['ff|B', 10], ['ff|C', 3], ['ff|D', 0]]);
  const out = TA.evaluate([t('ff|A'), t('ff|B', { baseCur: 0 }), t('ff|C', { target: 0, goal: 'active' }), t('ff|D', { target: 0, goal: 'active' })], cur, '2026-10', NOW);
  const kind = (k) => (out.find((x) => x.key === k) || {}).kind;
  assert.equal(kind('ff|A'), 'achieved');
  assert.equal(kind('ff|B'), undefined, 'progress hua, target abhi baaki → alert nahi');
  assert.equal(kind('ff|C'), 'achieved');
  assert.equal(kind('ff|D'), 'stuck', 'active goal, abhi bhi 0');
  assert.equal(out[0].kind, 'achieved', 'achieved pehle');
});

test('no improvement: 0 progress since target set (>=6h); recent set or progress → no alert', () => {
  const cur = new Map([['ff|A', 0], ['ff|B', 12], ['ff|C', 0], ['ff|D', 0]]);
  const out = TA.evaluate([
    t('ff|A'),                                   // legacy (no baseCur), cur 0 → stuck
    t('ff|B', { baseCur: 12 }),                  // same as base → stuck
    t('ff|C', { at: hoursAgo(2) }),              // abhi set hua → alert nahi
    t('ff|D', { ym: '2026-09' })                 // purana month → ignore
  ], cur, '2026-10', NOW);
  assert.deepEqual(out.map((x) => [x.key, x.kind]).sort(), [['ff|A', 'stuck'], ['ff|B', 'stuck']]);
});

test('class-only targets use the class sum; dismissed id is per-day for stuck', () => {
  const out = TA.evaluate([t('ff|A', { target: 0, classTargets: { vc4: 20, vc20: 10, vc5p: 0 } })], new Map([['ff|A', 30]]), '2026-10', NOW);
  assert.equal(out[0].kind, 'achieved'); assert.equal(out[0].target, 30);
  const stuck = TA.evaluate([t('ff|Z')], new Map(), '2026-10', NOW)[0];
  assert.match(TA._alertId(stuck), /stuck\|2026-10\|ff\|Z\|50\|\|\d{4}-\d{2}-\d{2}$/);
});
