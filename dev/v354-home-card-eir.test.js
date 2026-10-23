/* Home month KPI cards = EIR only (GV = master ID 5845036 rows), never EIR + GV Master.
   Every card opens its drawer in EIR-only mode (eir=1), the FF/GV split under a card adds up to the card,
   and Expected / Run Rate / Expected Today open their own forecast views. */
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
const U = FF.util, M = FF.model;

const now = new Date();
const tk = U.dateKey(now);
const curYm = U.ymKey(now), prevYm = U.prevMonthKey(curYm);
const row = (key, channel, group, n, extra = {}) => ({ key, d: U.fromDateKey(key), date: U.fromDateKey(key), ym: key.slice(0, 7), day: Number(key.slice(8)), channel, cls: group === 'VC5+' ? 'VC5' : group, group, n, type: 'ISSUANCE', vrnType: '', ...extra });

test('Home month cards: FF + GV split under each card adds up to the card, forecast cards carry a forecast view spec', () => {
  const d1 = `${curYm}-01`, d2 = `${curYm}-02`;
  const prevRows = [row(`${prevYm}-01`, 'First Forward', 'VC4', 6), row(`${prevYm}-01`, 'GV Partner', 'VC20', 4)];
  const rows = [row(d1, 'First Forward', 'VC4', 10), row(d2, 'First Forward', 'VC20', 3), row(d1, 'GV Partner', 'VC4', 5), row(tk, 'GV Partner', 'VC5+', 7), ...prevRows];
  const sf = { rows, ff: rows.filter((r) => r.channel !== 'GV Partner'), gv: rows.filter((r) => r.channel === 'GV Partner') };
  const sc = M.summary(rows, curYm);
  const ctx = { curKey: curYm, prevKey: prevYm, observedDay: Math.max(1, now.getDate() - 1), compareDay: Math.max(1, now.getDate() - 1), daysInMonth: U.daysInMonth(curYm), receivedDate: new Date(now - 864e5) };
  const html = FF.pages.home.monthKpiHtml(ctx, sf, { liveToday: true }, sc, rows);
  const cardOf = (title) => { const m = html.split('<div class="kpi ').find((c) => c.includes(`data-kpi-title="${title}`)); assert.ok(m, `${title} card`); return m; };
  const mtd = cardOf(`${U.labelYM(curYm, true)} total (MTD)`);
  const ffN = Number((mtd.match(/🟦 FF <b>([\d,]+)<\/b>/) || [])[1].replace(/,/g, '')), gvN = Number((mtd.match(/🟩 GV <b>([\d,]+)<\/b>/) || [])[1].replace(/,/g, ''));
  assert.equal(ffN + gvN, sc.total, 'FF + GV footer = card ka total (aaj ke live GV samet)');
  const specs = [...html.matchAll(/data-kpi="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.equal(specs.length, 11, 'month cards (incl. Wrong VRN)');
  specs.forEach((sp) => assert.match(sp, /(^|&)eir=1(&|$)/, `EIR-only drawer: ${sp}`));
  assert.ok(!/GV Master/i.test(html), 'card header GV Master ka naam nahi (EIR only)');
  const exp = cardOf('Expected in');
  assert.match(exp, /data-kpi="src=both&amp;scope=range&amp;from=[\d-]+&amp;to=[\d-]+&amp;view=expected&amp;eir=1"/);
  assert.match(exp, /data-kpi-value="Expected \d+"/, 'drawer ki 📌 line me saaf value');
  const run = cardOf('Run Rate');
  assert.match(run, /view=runrate/);
  assert.match(run, /data-kpi-value="[\d.,]+ \/ day"/);
});

test('Expected Today comes from EIR GV rows: last 4 same-weekday days and their average', () => {
  const wd = now.getDay();
  const sameWd = (back) => { const d = new Date(now); d.setDate(d.getDate() - back); return U.dateKey(d); };
  const days = [7, 14, 21, 28].map(sameWd);
  const eir = [row(days[0], 'GV Partner', 'VC4', 10), row(days[1], 'GV Partner', 'VC4', 20), row(days[2], 'GV Partner', 'VC4', 30), row(days[3], 'GV Partner', 'VC4', 40),
    row(sameWd(1), 'GV Partner', 'VC4', 99), row(tk, 'GV Partner', 'VC4', 5), row(days[0], 'First Forward', 'VC4', 500)];   // dusra weekday, aaj, FF → average me nahi
  const r = FF.pages.home.eirWeekdays(tk, eir);
  assert.deepEqual(r.keys, days.slice().sort(), 'sirf aaj ke weekday wale 4 din');
  assert.equal(r.expected, 25, '(10+20+30+40) ÷ 4');
  assert.equal(U.fromDateKey(r.keys[0]).getDay(), wd);
  assert.equal(FF.pages.home.eirWeekdays(tk, []), null, 'EIR rows nahi → purana feed');
});

test('Home streams never add the GV Master ledger (EIR + live only, as before)', () => {
  const past = `${prevYm}-10`;
  const eir = [row(past, 'GV Partner', 'VC4', 2), row(tk, 'GV Partner', 'VC4', 1)];
  FF.gv = { need: async () => [], get: (k) => (k === 'master' ? [{}] : []), issuanceRows: () => [row(past, 'GV Partner', 'VC20', 700)], loadedAt: null };
  const st = FF.pages.home.streams(eir, [row(tk, 'GV Partner', 'VC4', 4)], true);
  assert.equal(st.gv.filter((r) => r.key === past).reduce((n, r) => n + r.n, 0), 2, 'purane din sirf EIR');
  FF.gv = { need: async () => [], get: () => [], loadedAt: null };
});

test('Dashboard issuance cards also drill in EIR-only mode; Avg / Day and Projected open the forecast drawers', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
  assert.match(src, /specs\[4\] = `src=both&scope=range&from=\$\{monthFirst\}&to=\$\{latestK\}&view=runrate`/);
  assert.match(src, /specs\[5\] = `src=both&scope=range&from=\$\{monthFirst\}&to=\$\{latestK\}&view=expected`/);
  assert.match(src, /scope=\(day\|mtd\|range\)[\s\S]{0,120}&eir=1/);
  assert.match(src, /M\.eirOnlyDaily\(dailyR\.value\)/, 'Dashboard daily = pristine EIR rows');
});
