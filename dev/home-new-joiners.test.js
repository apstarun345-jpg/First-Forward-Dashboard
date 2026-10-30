/* Home's animated list uses the shared new-agent rule and only permitted EIR channels. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
['config', 'util', 'model', 'newAgents'].forEach((name) => require(path.join(root, `${name}.js`)));
const FF = globalThis.FF;
FF.store = { need: async () => [], get: () => [], refresh: async () => {}, error: () => null };
FF.gv = {}; FF.charts = {};
require(path.join(root, 'home.js'));
const J = FF.pages.home.joiners;
const analyze = FF.newAgents.analyze;
const row = (channel, id, name, ym, n) => ({ channel, id, name, ym, n });
const rows = [
  row('First Forward', 'OLD', 'Old agent', '2026-02', 3),
  row('First Forward', 'OLD', 'Old agent', '2026-10', 50),
  row('First Forward', 'NEW1', 'Nisha', '2026-09', 7),
  row('First Forward', 'NEW1', 'Nisha', '2026-10', 3),
  row('First Forward', 'NEW1', 'Nisha', '2026-10', 2),
  row('First Forward', 'NEW2', '<New & Co>', '2026-10', 11),
  row('GV Partner', 'BASE', 'GV base', '2026-02', 1),
  row('GV Partner', 'GV1', 'GV New', '2026-10', 4),
  row('First Forward', '0', 'Unknown', '2026-10', 400),
  row('First Forward', 'FUTURE', 'Future', '2026-11', 80)
];

test('new joiner list reuses first-observed-month rule and shows current calendar month counts', () => {
  const out = J.data(rows, ['ff', 'gv'], analyze, '2026-10');
  assert.deepEqual(out.rows.map((r) => [r.ch, r.id, r.curN, r.firstYm]), [
    ['ff', 'NEW2', 11, '2026-10'], ['gv', 'GV1', 4, '2026-10'], ['ff', 'NEW1', 5, '2026-09']
  ]);
  assert.equal(out.currentYm, '2026-10');
  const advanced = J.data(rows, ['ff'], analyze, '2027-01');
  assert.equal(advanced.rows.length, 0, 'old latest dataset month is not treated as the current month');
});

test('first month of available data is excluded, channel permissions filter before analysis', () => {
  const out = J.data(rows, ['gv'], analyze, '2026-10');
  assert.deepEqual(out.rows.map((r) => r.id), ['GV1']);
  const limited = J.data([row('First Forward', 'A', 'First', '2026-09', 2), row('First Forward', 'B', 'Second', '2026-10', 3)], ['ff'], analyze, '2026-10');
  assert.deepEqual(limited.rows.map((r) => r.id), ['B']);
  assert.match(J.html(limited, false), /limited EIR history/);
  const can = (...perms) => ({ can: (p) => perms.includes(p) });
  assert.deepEqual(J.channels(can('stock', 'home')), [], 'stock alone does not grant issuance lists');
  assert.deepEqual(J.channels(can('dashboard')), ['ff']);
  assert.deepEqual(J.channels(can('gvTrend')), ['gv']);
  assert.deepEqual(J.channels(can('performance', 'gvPerformance')), ['ff', 'gv']);
});

test('ticker is escaped, has pause control, exposes full list and describes EIR limitations', () => {
  const out = J.data(rows, ['ff', 'gv'], analyze, '2026-10');
  const html = J.html(out, true);
  assert.match(html, /&lt;New &amp; Co&gt;/); assert.doesNotMatch(html, /<New & Co>/);
  assert.match(html, /data-hj-pause/); assert.match(html, /aria-hidden="true"/);
  assert.match(html, /<details/); assert.match(html, /View full list · 3 agents/);
  assert.match(html, /NEW1/); assert.match(html, /NEW2/); assert.match(html, /GV1/);
  assert.match(html, /first available data month is excluded/i);
  assert.match(html, /GV Master live is not included/); assert.match(html, /last available snapshot/);
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /@keyframes hj-scroll/); assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.hj-card\[data-paused="true"\]/);
});

test('loading and failure do not display zero; retry recovers and animation can pause', async () => {
  const el = { isConnected: true, innerHTML: '', addEventListener(_type, fn) { this.click = fn; } };
  let fail = true, refreshed = false;
  FF.store.need = async () => { if (fail) throw new Error('Network error'); return rows; };
  FF.store.refresh = async (keys) => { assert.deepEqual(keys, ['agents']); refreshed = true; fail = false; };
  J.mount(el, ['ff']);
  assert.match(el.innerHTML, /Loading EIR agent history/);
  await new Promise((r) => setImmediate(r));
  assert.match(el.innerHTML, /could not be loaded/); assert.doesNotMatch(el.innerHTML, /No qualifying/);
  el.click({ target: { closest: (sel) => sel === '[data-hj-retry]' ? {} : null } });
  await new Promise((r) => setImmediate(r));
  assert.ok(refreshed); assert.match(el.innerHTML, /View full list/);
  const attrs = {}, card = { setAttribute: (k, v) => { attrs[k] = v; } };
  const btn = { getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; }, closest: () => card, textContent: '' };
  el.click({ target: { closest: (sel) => sel === '[data-hj-pause]' ? btn : null } });
  assert.equal(attrs['aria-pressed'], 'true'); assert.equal(attrs['data-paused'], 'true');
  assert.match(btn.textContent, /Resume/);
  el.click({ target: { closest: (sel) => sel === '[data-hj-pause]' ? btn : null } });
  assert.equal(attrs['aria-pressed'], 'false'); assert.equal(attrs['data-paused'], 'false');
});
