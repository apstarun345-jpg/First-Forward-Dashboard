/* Home issuance explorer: multi-select filters, cross-channel class totals and date presets. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'model.js'));
const chartCalls = [];
const FF = globalThis.FF;
FF.charts = {
  bars: (opts) => { chartCalls.push(opts); return `<div class="test-bars">${opts.labels.join('|')}</div>`; },
  mount() {}
};
FF.store = { need: async () => [], get: () => [], loadedAt: null };
FF.gv = { need: async () => [], get: () => [], loadedAt: null };
require(path.join(ROOT, 'home.js'));
const explorer = globalThis.FF.pages.home.explorer;
const U = globalThis.FF.util;
const today = new Date();
const ym = U.ymKey(today);
const currentKey = `${ym}-02`;
const priorKey = `${ym}-01`;
const previousMonthKey = `${U.prevMonthKey(ym)}-28`;
const rows = [
  { key: currentKey, channel: 'First Forward', type: 'ISSUANCE', vrnType: 'REGULAR', group: 'VC4', n: 4 },
  { key: currentKey, channel: 'GV Partner', type: 'REPLACEMENT', vrnType: 'CHASSIS', group: 'VC20', n: 2 },
  { key: priorKey, channel: 'GV Partner', type: 'ISSUANCE', tagType: 'CHASSIS', group: 'VC5+', n: 3 },
  { key: priorKey, channel: 'First Forward', type: 'REPLACEMENT', vrnType: 'REGULAR', group: 'VC5+', n: 5 },
  { key: priorKey, channel: 'First Forward', type: 'REPLACEMENT', vrnType: 'CHASSIS', group: 'VC20', n: 7 },
  { key: previousMonthKey, channel: 'GV Partner', type: 'REPLACEMENT', vrnType: 'CHASSIS', group: 'VC4', n: 9 }
];
const monthFilters = { from: `${ym}-01`, to: `${ym}-${String(U.daysInMonth(ym)).padStart(2, '0')}` };

test('Home explorer combines FF + GV and reports VC4 / VC20 / VC5+ counts', () => {
  const filtered = explorer.filterRows(rows, monthFilters, ['ff', 'gv']);
  const totals = explorer.totals(filtered);
  assert.equal(totals.total, 21);
  assert.deepEqual(totals.byClass, { VC4: 4, VC20: 9, 'VC5+': 8 });
  assert.deepEqual(totals.byChannel.ff, { VC4: 4, VC20: 7, 'VC5+': 5 });
  assert.deepEqual(totals.byChannel.gv, { VC4: 0, VC20: 2, 'VC5+': 3 });
});

test('multi-select channel/type/class filters combine across dimensions without double-counting', () => {
  const filtered = explorer.filterRows(rows, {
    ...monthFilters,
    channels: new Set(['gv']),
    types: new Set(['replacement', 'chassis']),
    classes: new Set(['VC20', 'VC5+'])
  }, ['ff', 'gv']);
  assert.equal(filtered.length, 2, 'a chassis replacement matching both type selections remains one row');
  assert.equal(explorer.totals(filtered).total, 5);
  assert.deepEqual(explorer.totals(filtered).byClass, { VC4: 0, VC20: 2, 'VC5+': 3 });
});

test('date bounds and account channel access are enforced even when All channels is selected', () => {
  const filtered = explorer.filterRows(rows, { ...monthFilters, channels: new Set() }, ['ff']);
  assert.equal(filtered.length, 3);
  assert.equal(explorer.totals(filtered).total, 16);
  assert.ok(filtered.every((row) => row.channel === 'First Forward'));
  assert.equal(explorer.filterRows(rows, { from: currentKey, to: currentKey }, ['ff', 'gv']).length, 2);
});

test('bar-chart UI exposes the requested filters and sends per-channel class counts to the chart', () => {
  chartCalls.length = 0;
  explorer.state.from = monthFilters.from; explorer.state.to = monthFilters.to;
  explorer.state.channels.clear(); explorer.state.types.clear(); explorer.state.classes.clear();
  const html = explorer.html(rows, ['ff', 'gv']);
  assert.match(html, /data-home-exp-filter="channels:ff"/);
  assert.match(html, /data-home-exp-filter="channels:gv"/);
  assert.match(html, /data-home-exp-filter="types:replacement"/);
  assert.match(html, /data-home-exp-filter="types:chassis"/);
  assert.match(html, /data-home-exp-filter="classes:VC4"/);
  assert.match(html, /data-home-exp-filter="classes:VC20"/);
  assert.match(html, /data-home-exp-filter="classes:VC5\+"/);
  assert.match(html, /type="date"/);
  assert.match(html, /data-home-exp-range="last-month"/);
  assert.match(html, /VC4/); assert.match(html, /VC20/); assert.match(html, /VC5\+/);
  assert.equal(chartCalls.length, 1);
  assert.deepEqual(chartCalls[0].labels, ['VC4', 'VC20', 'VC5+']);
  assert.deepEqual(chartCalls[0].series.map((series) => series.values), [[4, 7, 5], [0, 2, 3]]);
});

test('saved All dates range remains unbounded after a reload', () => {
  explorer.state.from = ''; explorer.state.to = '';
  explorer.state.channels.add('gv'); explorer.state.types.add('replacement');
  explorer.saveFilters();
  const restored = explorer.loadFilters();
  assert.equal(restored.from, ''); assert.equal(restored.to, '');
  assert.deepEqual([...restored.channels], ['gv']);
  assert.deepEqual([...restored.types], ['replacement']);
});

test('date presets handle month boundaries and inclusive 30-day range', () => {
  const anchor = new Date(2026, 2, 1);
  assert.deepEqual(explorer.rangePreset('last-month', anchor), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(explorer.rangePreset('30d', anchor), { from: '2026-01-31', to: '2026-03-01' });
  assert.deepEqual(explorer.rangePreset('all', anchor), { from: '', to: '' });
});

test('class totals sirf accessible channel ka split dikhate hain (permission leak nahi)', () => {
  chartCalls.length = 0;
  explorer.state.from = monthFilters.from; explorer.state.to = monthFilters.to;
  explorer.state.channels.clear(); explorer.state.types.clear(); explorer.state.classes.clear();
  const onlyFf = explorer.html(rows, ['ff']);
  assert.match(onlyFf, /<small>FF 4<\/small>/);          // VC4: FF 4 (GV 0 chhupa)
  assert.doesNotMatch(onlyFf, /FF 4 · GV/);
  const onlyGv = explorer.html(rows, ['gv']);
  assert.match(onlyGv, /<small>GV 2<\/small>/);          // VC20: GV 2
  assert.doesNotMatch(onlyGv, /<small>[^<]*FF [\d,]/);
});
