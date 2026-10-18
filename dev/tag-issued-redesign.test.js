/* v198 — GV & FF Tag Issued redesign: date shortcuts, previous-period logic, KPI structure */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'tagIssued.js'), 'utf8');

function load() {
  const U = {
    esc: (s) => String(s), pad2: (n) => String(n).padStart(2, '0'),
    dateKey: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    labelDate: (d) => String(d), growth: (c, p) => (p ? ((c - p) / Math.abs(p)) * 100 : null)
  };
  const ctx = { FF: { util: U, model: {}, store: {}, gv: {}, charts: {}, filters: null }, localStorage: {}, location: {}, history: {} };
  ctx.window = ctx;
  vm.runInNewContext(src, ctx);
  return ctx.FF.pages.tagIssued._test;
}
const T = load();
const at = (y, m, d) => new Date(y, m - 1, d);

test('presets: today / yesterday / last7 / thisMonth / lastMonth', () => {
  const now = at(2026, 10, 18);
  assert.equal(JSON.stringify(T.presetRange('today', now)), JSON.stringify(['2026-10-18', '2026-10-18']));
  assert.equal(JSON.stringify(T.presetRange('yesterday', now)), JSON.stringify(['2026-10-17', '2026-10-17']));
  assert.equal(JSON.stringify(T.presetRange('last7', now)), JSON.stringify(['2026-10-12', '2026-10-18']));
  assert.equal(JSON.stringify(T.presetRange('last30', now)), JSON.stringify(['2026-09-19', '2026-10-18']));
  assert.equal(JSON.stringify(T.presetRange('thisMonth', now)), JSON.stringify(['2026-10-01', '2026-10-18']));
  assert.equal(JSON.stringify(T.presetRange('lastMonth', now)), JSON.stringify(['2026-09-01', '2026-09-30']));
  assert.equal(JSON.stringify(T.presetRange('thisWeek', now)), JSON.stringify(['2026-10-12', '2026-10-18'])); // Sunday → Monday start
  assert.equal(T.detectPreset('2026-10-12', '2026-10-18', now), 'last7');
  assert.equal(T.detectPreset('2026-10-03', '2026-10-09', now), 'custom');
});

test('previous period: equal length, month-aligned for month ranges', () => {
  assert.equal(JSON.stringify(T.prevRange('2026-10-12', '2026-10-18')), JSON.stringify(['2026-10-05', '2026-10-11']));
  assert.equal(JSON.stringify(T.prevRange('2026-10-18', '2026-10-18')), JSON.stringify(['2026-10-17', '2026-10-17']));
  assert.equal(JSON.stringify(T.prevRange('2026-10-01', '2026-10-18')), JSON.stringify(['2026-09-01', '2026-09-18']));
  assert.equal(JSON.stringify(T.prevRange('2026-03-01', '2026-03-31')), JSON.stringify(['2026-02-01', '2026-02-28']));
  assert.equal(T.prevRange('2026-10-19', '2026-10-18'), null);
});

test('scan sums VC4 / VC20 / VC5+ / commercial and per-day totals inside the range only', () => {
  const rows = [
    { key: '2026-10-10', group: 'VC4', cls: 'VC4', n: 5 }, { key: '2026-10-10', group: 'VC20', cls: 'VC20', n: 2 },
    { key: '2026-10-11', group: 'VC5+', cls: 'VC5', n: 3, type: 'REPLACEMENT' }, { key: '2026-10-12', group: 'VC4', cls: 'VC4', n: 99 }
  ];
  const r = T.scan(rows, '2026-10-10', '2026-10-11');
  assert.equal(r.total, 10); assert.equal(r.vc4, 5); assert.equal(r.vc20, 2); assert.equal(r.vc5p, 3);
  assert.equal(r.comm, 5); assert.equal(r.replacement, 3); assert.equal(r.byDay.get('2026-10-10').total, 7);
});

test('page source: shortcuts, five KPI cards, share, charts and insights are wired', () => {
  for (const id of ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth']) assert.match(src, new RegExp(`\\['${id}'`));
  for (const k of ["key: 'total'", "key: 'vc4'", "key: 'vc20'", "key: 'vc5p'", "key: 'comm'"]) assert.ok(src.includes(k), k);
  for (const needle of ['tix-split', 'tix-row ff', 'verdictHtml', 'C.donut(', 'C.lines(', 'C.bars(', 'C.hbars(', 'insightsHtml', 'h2hTable', 'FF T+1']) assert.ok(src.includes(needle) || src.includes(needle.replace('tix-row ff', 'tix-row ${cls}')), needle);
  assert.match(src, /FF\.pages\.tagIssued = \{ title: 'GV & FF Tag Issued', render \}/);
});

test('GV totals come from the EIR sheet (master ID 5845036 rows); top agents from GV Master', () => {
  assert.match(src, /const gvRows = dailyRows\.filter\(\(r\) => r\.channel === 'GV Partner'\)/, 'GV totals = EIR daily rows');
  assert.match(src, /gvMasterRows = masterReady/, 'GV Master sirf agents/teams ke liye');
  assert.match(src, /rows\.gvMasterRows\.forEach/, 'top agents GV Master se');
  assert.ok(!/masterTodayRows/.test(src), 'GV Master ka today override totals me nahi');
  assert.match(src, /&eir=1'/, 'drill bhi EIR rows kholta hai (count match)');
});

test('GV pending (EIR T+1) is trimmed to the latest EIR date for like-for-like growth', () => {
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date(); const y = new Date(now); y.setDate(y.getDate() - 1); const old = new Date(now); old.setDate(old.getDate() - 20);
  const today = key(now), yest = key(y);
  const rows = { ffRows: [], gvRows: [{ key: yest, group: 'VC4', cls: 'VC4', n: 4 }], gvLatest: yest };
  const m = T.buildModel(rows, today, today);
  assert.equal(m.gvPending, true); assert.equal(m.gvComparable, false, 'sirf aaj: GV kal aayega');
  const w = T.buildModel(rows, key(old), today);
  assert.equal(w.gvPending, true); assert.equal(w.gvComparable, true); assert.equal(w.gvTo, yest);
  const past = T.buildModel(rows, key(old), key(old));
  assert.equal(past.gvPending, false, 'purani date trim nahi hoti');
});
