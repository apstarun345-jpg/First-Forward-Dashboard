/* Home month KPI cards: card number == click drawer number.
   GV rows of the cards come from the same ledger the drawer uses (gv.issuanceRows), the FF/GV split under a card
   adds up to the card, and Expected / Run Rate cards open their own forecast view. */
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

test('Home streams: GV past days come from the drawer ledger (EIR + GV Master supplement), today stays the live rows', () => {
  const past = `${prevYm}-10`;
  const eir = [row(past, 'GV Partner', 'VC4', 2), row(past, 'First Forward', 'VC4', 5), row(tk, 'GV Partner', 'VC4', 1)];
  const ledger = [row(past, 'GV Partner', 'VC4', 2), row(past, 'GV Partner', 'VC20', 7, { agentName: 'ONLY IN MASTER' }), row(tk, 'GV Partner', 'VC4', 99)];
  FF.gv = { need: async () => [], get: (k) => (k === 'master' ? [{}] : []), issuanceRows: () => ledger, loadedAt: null };
  const live = [row(tk, 'GV Partner', 'VC4', 4)];
  const st = FF.pages.home.streams(eir, live, true);
  const sum = (rows) => rows.reduce((n, r) => n + r.n, 0);
  assert.equal(sum(st.gv.filter((r) => r.key === past)), 9, 'purane din: EIR 2 + sirf-Master wale 7 (drawer jaisa)');
  assert.equal(sum(st.gv.filter((r) => r.key === tk)), 4, 'aaj: live rows (ledger ka aaj wala 99 nahi)');
  assert.equal(sum(st.ff), 5, 'FF badla nahi');
  // GV Master load nahi hua → purana store-only data
  FF.gv = { need: async () => [], get: () => null, issuanceRows: () => ledger, loadedAt: null };
  const st2 = FF.pages.home.streams(eir, live, true);
  assert.equal(sum(st2.gv.filter((r) => r.key === past)), 2, 'master ready nahi → EIR hi');
  FF.gv = { need: async () => [], get: () => [], loadedAt: null };
});

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
  const exp = cardOf('Expected in');
  assert.match(exp, /data-kpi="src=both&amp;scope=range&amp;from=[\d-]+&amp;to=[\d-]+&amp;view=expected"/);
  assert.match(exp, /data-kpi-value="Expected \d+"/, 'drawer ki 📌 line me saaf value');
  const run = cardOf('Run Rate');
  assert.match(run, /view=runrate/);
  assert.match(run, /data-kpi-value="[\d.,]+ \/ day"/);
});

test('Expected Today comes from the same GV ledger the drawer reads: last 4 same-weekday days and their average', () => {
  const wd = now.getDay();
  const sameWd = (back) => { const d = new Date(now); d.setDate(d.getDate() - back); return U.dateKey(d); };
  const days = [7, 14, 21, 28].map(sameWd);
  const ledger = [row(days[0], 'GV Partner', 'VC4', 10), row(days[1], 'GV Partner', 'VC4', 20), row(days[2], 'GV Partner', 'VC4', 30), row(days[3], 'GV Partner', 'VC4', 40),
    row(sameWd(1), 'GV Partner', 'VC4', 99), row(tk, 'GV Partner', 'VC4', 5)];   // dusra weekday + aaj → average me nahi
  FF.gv = { need: async () => [], get: (k) => (k === 'master' ? [{}] : []), issuanceRows: () => ledger, loadedAt: null };
  const r = FF.pages.home.ledgerWeekdays(tk);
  assert.deepEqual(r.keys, days.slice().sort(), 'sirf aaj ke weekday wale 4 din');
  assert.equal(r.expected, 25, '(10+20+30+40) ÷ 4');
  assert.equal(U.fromDateKey(r.keys[0]).getDay(), wd);
  FF.gv = { need: async () => [], get: () => null, issuanceRows: () => ledger, loadedAt: null };
  assert.equal(FF.pages.home.ledgerWeekdays(tk), null, 'GV Master load nahi → purana feed');
  FF.gv = { need: async () => [], get: () => [], loadedAt: null };
});
