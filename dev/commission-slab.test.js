import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(ROOT, 'insights.js'), 'utf8');
function loadSlab(config) {
  const app = { config: { commissionSlabs: config }, pages: {}, util: { esc: (v) => String(v ?? ''), clean: (v) => String(v ?? '').trim() } };
  vm.runInNewContext(source, { window: { FF: app }, FF: app, console, Date, Map, Set, Promise, Intl, Math, Number, String, Object, Array, RegExp });
  return app.insights.commissionSlabExpected;
}
const bands = [
  { min: 1, max: 50, rate: 2 },
  { min: 51, max: 100, rate: 3 },
  { min: 101, max: 150, rate: 4 },
  { min: 151, max: 250, rate: 5 },
  { min: 251, max: null, rate: 6 }
];

test('agent-tier slabs apply selected tier rate to every tag in the period', () => {
  const calculate = loadSlab({ enabled: true, model: 'agentTier', channels: { ff: bands, gv: bands } });
  assert.equal(calculate(50, 'ff').expected, 100);
  assert.equal(calculate(51, 'gv').expected, 153);
  assert.equal(calculate(250, 'ff').expected, 1250);
  assert.equal(calculate(251, 'gv').expected, 1506);
  assert.equal(calculate(0, 'ff').expected, 0);
});

test('marginal slabs only price tags in the bands they reach and report missing rates', () => {
  const calculate = loadSlab({ enabled: true, model: 'marginal', channels: { ff: bands, gv: bands.map((x) => ({ ...x })) } });
  assert.equal(calculate(51, 'ff').expected, 103);
  assert.equal(calculate(151, 'gv').expected, 455);
  const missing = bands.map((x) => ({ ...x })); missing[1].rate = '';
  assert.equal(loadSlab({ enabled: true, model: 'marginal', channels: { ff: missing } })(51, 'ff').expected, null);
  assert.equal(loadSlab({ enabled: false, model: 'agentTier', channels: { ff: bands } })(75, 'ff').expected, null);
});
