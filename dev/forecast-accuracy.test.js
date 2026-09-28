import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dateKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shift = (value, days) => { const d = new Date(value); d.setDate(d.getDate() + days); return d; };

test('forecast backtest uses preceding run-rate, exact holdout actuals, WAPE/bias and zero-history penalties', async () => {
  const latest = new Date(2026, 2, 31);
  const history = [];
  const add = (id, name, dayOffset, n) => history.push({
    channel: 'First Forward', id, name, tlName: 'TL One', dateKey: dateKey(shift(latest, dayOffset)), cls: 'VC4', group: 'VC4', n
  });

  // 28-day training window: A consumes 2/day and C consumes 1/day.
  for (let offset = -34; offset <= -7; offset++) { add('A-1', 'Agent A', offset, 2); add('C-1', 'Agent C', offset, 1); }
  // 7-day holdout: A rises to 3/day; new Agent B has no training history; C stops consuming.
  for (let offset = -6; offset <= 0; offset++) { add('A-1', 'Agent A', offset, 3); add('B-1', 'Agent B', offset, 1); }

  const clean = (value) => String(value ?? '').trim();
  const context = {
    console, Date, Math, Number, String, Array, Object, Map, Set, Promise, Intl,
    window: null,
    FF: {
      pages: {},
      util: { clean, esc: clean, dateKey, fmt: String, stamp: () => 'test' },
      data: {},
      store: { need: async (name) => name === 'daily' ? [{ d: latest }] : [] },
      gv: { need: async () => [], latestDate: () => null },
      model: { latestDate: () => latest, loadRangePeople: async () => history },
      charts: {},
      config: {}
    }
  };
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'insights.js'), 'utf8'), vm.createContext(context), { filename: 'insights.js' });

  const result = await context.FF.insights.forecastAccuracy(28);
  const sample = result.horizons[7].ff;
  assert.ok(sample);
  assert.equal(sample.observedDays, 28);
  assert.equal(sample.fullTraining, true);
  assert.equal(sample.agents, 3);
  assert.equal(sample.predicted, 21);
  assert.equal(sample.actual, 28);
  assert.equal(sample.absoluteError, 21); // agent-allocation WAPE, not only aggregate-volume error
  assert.equal(sample.wape, 75);
  assert.equal(sample.accuracy, 25);
  assert.equal(sample.bias, -25);
  assert.equal(sample.mae, 7);

  const a = sample.rows.find((row) => row.id === 'A-1');
  const b = sample.rows.find((row) => row.id === 'B-1');
  const c = sample.rows.find((row) => row.id === 'C-1');
  assert.equal(a.training, 56);
  assert.equal(a.predicted, 14);
  assert.equal(a.actual, 21);
  assert.equal(a.biasUnits, -7);
  assert.ok(Math.abs(a.accuracy - 66.6666666667) < 1e-6);
  assert.equal(b.training, 0);
  assert.equal(b.predicted, 0);
  assert.equal(b.actual, 7);
  assert.equal(b.accuracy, 0, 'new agent with no training history must not appear accurate');
  assert.equal(b.confidence, 'Low');
  assert.equal(c.actual, 0);
  assert.equal(c.predicted, 7);
  assert.equal(c.accuracy, 0, 'forecast consumption with zero actual must score zero');
});
