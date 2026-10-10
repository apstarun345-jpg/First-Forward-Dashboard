/* Home KPI contract: Commercial = VC20 + VC5+, with last-month actual and current-month projection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'model.js'));
const FF = globalThis.FF;
FF.store = { need: async () => [], get: () => [], loadedAt: null };
FF.gv = { need: async () => [], get: () => [], loadedAt: null };
FF.charts = { mount() {} };
require(path.join(ROOT, 'home.js'));

const U = FF.util;
const M = FF.model;

test('Home shows a clickable All Commercial KPI with last-month actual and current-month expected total', () => {
  const now = new Date();
  const curYm = U.ymKey(now), prevYm = U.prevMonthKey(curYm);
  const today = U.dateKey(now);
  const previousDay = `${prevYm}-01`;
  const currentRows = [
    { key: today, ym: curYm, day: now.getDate(), channel: 'First Forward', cls: 'VC20', group: 'VC20', n: 4, type: 'ISSUANCE' },
    { key: today, ym: curYm, day: now.getDate(), channel: 'GV Partner', cls: 'VC5', group: 'VC5+', n: 6, type: 'ISSUANCE' }
  ];
  const lastRows = [
    { key: previousDay, ym: prevYm, day: 1, channel: 'First Forward', cls: 'VC20', group: 'VC20', n: 5, type: 'ISSUANCE' },
    { key: previousDay, ym: prevYm, day: 1, channel: 'GV Partner', cls: 'VC5', group: 'VC5+', n: 8, type: 'ISSUANCE' }
  ];
  const ctx = { curKey: curYm, prevKey: prevYm, observedDay: now.getDate(), daysInMonth: U.daysInMonth(curYm) };
  const sc = M.summary(currentRows, curYm);
  const html = FF.pages.home.monthKpiHtml(ctx, { rows: currentRows, ff: currentRows.filter((r) => r.channel !== 'GV Partner'), gv: currentRows.filter((r) => r.channel === 'GV Partner') }, { liveToday: true }, sc, lastRows);
  const expected = Math.round((10 / now.getDate()) * U.daysInMonth(curYm));

  assert.match(html, /All Commercial · VC20 \+ VC5\+/);
  assert.match(html, /data-kpi="src=both&amp;scope=mtd&amp;ym=[^&]+&amp;f=comm"/, 'card drills into current-month Commercial');
  assert.match(html, /Last month full <b>13<\/b>/, 'full prior-month Commercial shown');
  assert.match(html, new RegExp(`Expected this month <b>${expected}<\/b>`), 'Commercial expected month-end shown');
  assert.match(html, /data-kpi-value|kpi-value/);
});

test('Home replaces partial same-day EIR GV with the live GV Master feed, without double counting', () => {
  const now = new Date();
  const key = U.dateKey(now);
  const eir = [
    { key, ym: U.ymKey(now), day: now.getDate(), channel: 'GV Partner', group: 'VC20', cls: 'VC20', n: 2 },
    { key, ym: U.ymKey(now), day: now.getDate(), channel: 'First Forward', group: 'VC4', cls: 'VC4', n: 3 }
  ];
  const feedRows = FF.pages.home.liveRowsFromFeed({ date: key, total: 10, classes: { VC20: 4, 'VC5+': 6 } });
  const stream = FF.pages.home.streams(eir, feedRows, true);
  assert.equal(stream.gvLiveAdded, true);
  assert.equal(stream.ff.reduce((n, row) => n + row.n, 0), 3, 'First Forward stays unchanged');
  assert.equal(stream.gv.reduce((n, row) => n + row.n, 0), 10, 'partial EIR GV 2 replaced by live Master total 10');
});
test('Home FF/GV MTD split uses the same one-day-lag cutoff as the month total', () => {
  const now = new Date();
  const curYm = U.ymKey(now), prevYm = U.prevMonthKey(curYm);
  const observedDay = Math.max(1, now.getDate() - 1);
  const futureDay = Math.min(U.daysInMonth(curYm), observedDay + 1);
  const dayKey = curYm + '-' + String(observedDay).padStart(2, '0');
  const futureKey = curYm + '-' + String(futureDay).padStart(2, '0');
  const currentRows = [
    { key: dayKey, ym: curYm, day: observedDay, channel: 'First Forward', cls: 'VC4', group: 'VC4', n: 4, type: 'ISSUANCE' },
    { key: dayKey, ym: curYm, day: observedDay, channel: 'GV Partner', cls: 'VC20', group: 'VC20', n: 6, type: 'ISSUANCE' },
    { key: futureKey, ym: curYm, day: futureDay, channel: 'First Forward', cls: 'VC4', group: 'VC4', n: 100, type: 'ISSUANCE' }
  ];
  const ctx = { curKey: curYm, prevKey: prevYm, observedDay, compareDay: observedDay, daysInMonth: U.daysInMonth(curYm) };
  const sf = { rows: currentRows, ff: currentRows.filter((r) => r.channel !== 'GV Partner'), gv: currentRows.filter((r) => r.channel === 'GV Partner') };
  const html = FF.pages.home.monthKpiHtml(ctx, sf, { liveToday: true }, M.summary(currentRows, curYm), []);
  assert.match(html, /GV <b>6<\/b>/, 'GV split matches the 6 eligible GV tags');
  assert.match(html, /First Forward <b>4<\/b>/, 'future-dated 100 FF tags do not inflate the displayed split');
  assert.match(html, /total \(MTD\)/);
});
