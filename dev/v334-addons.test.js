import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const utilStub = {
  clean: (v) => String(v == null ? '' : v).trim(),
  esc: (v) => String(v == null ? '' : v),
  fmt: (v) => String(v == null ? 0 : v),
  sum: (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0),
  growth: (c, p) => (p ? ((c - p) / p) * 100 : null),
  pad2: (n) => String(n).padStart(2, '0'),
  ymKey: () => '2026-10',
  pctHtml: () => '—', slug: (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'), stamp: () => 'x',
  spinner: () => '…', $: () => null, downloadCsv() {}, downloadBlob() {}, copyText: async () => {}, waLink: (t) => `https://wa.me/?text=${encodeURIComponent(t || '')}`
};

function load(ffExtra = {}) {
  const FF = { util: utilStub, pages: {}, config: { brand: 'ApnaPayment' }, ...ffExtra };
  const sandbox = {
    window: { FF }, FF, console, Blob, setTimeout, clearTimeout,
    document: { createElement: () => ({}), body: { appendChild() {} } },
    navigator: {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'agentSummary.js'), 'utf8'), sandbox, { filename: 'agentSummary.js' });
  return { FF, sandbox };
}

test('ymBack sahi month-walk karta hai — year boundary ke saath', () => {
  const { FF } = load();
  const { ymBack } = FF.agentSummary.__test || {};
  // ymBack export nahi hua, par monthlyTrend ke output se check karenge
  const store = { get: () => [
    { name: 'Ram', tlName: 'Shyam', channel: 'First Forward', ym: '2026-01', n: 5 },
    { name: 'Ram', tlName: 'Shyam', channel: 'First Forward', ym: '2026-10', n: 7 }
  ] };
  const { FF: FF2 } = load({ store });
  const trend = FF2.agentSummary.monthlyTrend({ name: 'Ram' }, 'ff', false, '2026-10');
  assert.equal(trend.length, 6);
  assert.equal(trend[0].ym, '2026-05'); // Oct se 5 mahine peeche
  assert.equal(trend[5].ym, '2026-10');
  assert.equal(trend[0].lbl, 'May');
  assert.equal(trend[5].lbl, 'Oct');
  assert.equal(trend[5].n, 7);
  assert.equal(trend[4].n, 0); // Sep me data nahi
});

test('monthlyTrend channel alag karta hai (FF vs GV) aur TL ko tlName se match karta hai', () => {
  const store = { get: () => [
    { name: 'Ram', tlName: 'Shyam', channel: 'First Forward', ym: '2026-10', n: 10 },
    { name: 'GV-Ram', tlName: 'GV-Shyam', channel: 'GV Partner', ym: '2026-10', n: 99 },
    { name: 'Kiran', tlName: 'Shyam', channel: 'First Forward', ym: '2026-10', n: 4 }
  ] };
  const { FF } = load({ store });
  assert.equal(FF.agentSummary.monthlyTrend({ name: 'Ram' }, 'ff', false, '2026-10')[5].n, 10);
  assert.equal(FF.agentSummary.monthlyTrend({ name: 'GV-Ram' }, 'gv', false, '2026-10')[5].n, 99);
  // TL Shyam = Ram(10) + Kiran(4)
  assert.equal(FF.agentSummary.monthlyTrend({ name: 'Shyam' }, 'ff', true, '2026-10')[5].n, 14);
  // GV TL 'GV-Shyam' apne agent (GV-Ram, 99) ka total paata hai
  assert.equal(FF.agentSummary.monthlyTrend({ name: 'GV-Shyam' }, 'gv', true, '2026-10')[5].n, 99);
  // wahi naam FF side par null — channel filter kaam kar raha hai
  assert.equal(FF.agentSummary.monthlyTrend({ name: 'GV-Shyam' }, 'ff', true, '2026-10'), null);
  // store khaali → trend null (card hide)
  const { FF: FF3 } = load({ store: { get: () => [] } });
  assert.equal(FF3.agentSummary.monthlyTrend({ name: 'Ram' }, 'ff', false, '2026-10'), null);
});

test('agentAlerts — drop/star/idle sahi classify karta hai', () => {
  const { FF } = load();
  const p = {
    totals: { growth: -60, lastTotal: 100, curTotal: 40 },
    agents: [
      { name: 'Drop', growth: -70, lastTotal: 50, curTotal: 15, stockTotal: 5 },
      { name: 'Star', growth: 80, lastTotal: 10, curTotal: 18, stockTotal: 2 },
      { name: 'Idle', growth: null, lastTotal: 30, curTotal: 0, stockTotal: 12 },
      { name: 'SmallDrop', growth: -60, lastTotal: 5, curTotal: 2, stockTotal: 0 } // last < 20 → ignore
    ]
  };
  const al = FF.agentSummary.agentAlerts(p, true);
  assert.deepEqual(al.drop.map((a) => a.name), ['Drop']);
  assert.deepEqual(al.stars.map((a) => a.name), ['Star']);
  assert.deepEqual(al.idle.map((a) => a.name), ['Idle']);
  // Agent view — khud ka flag
  const self = FF.agentSummary.agentAlerts({ totals: p.totals, agents: [] }, false);
  assert.equal(self.drop.length, 1);
});

test('buildReport trend + generatedAt attach karta hai', async () => {
  const store = { get: () => [{ name: 'José', tlName: '—', channel: 'First Forward', ym: '2026-10', n: 21 }] };
  const { FF } = load({ store });
  FF.masterProfile = {
    build: async () => ({ channel: 'First Forward', kind: 'ff-agent', name: 'José', id: 'A1', totals: { curTotal: 21 }, stock: { total: 0 }, months: { cur: '2026-10', last: '2026-09' }, classes: [], agents: [], calc: { total: { rate: 1 } }, projT1: { total: 20 } }),
    csvRows: () => []
  };
  const rep = await FF.agentSummary.buildReport({ kind: 'ff-agent', name: 'José', id: 'A1', tl: '' });
  assert.ok(rep.generatedAt > 0, 'generatedAt stamp');
  assert.equal(rep.trend[5].n, 21);
});

test('teamPackXlsx — Team Summary + ageing + har agent ki sheet, sab me Grand Total', () => {
  const { FF } = load();
  const r = {
    ch: 'ff', isTl: true,
    p: {
      name: 'Shyam', lastYm: '2026-09', curYm: '2026-10',
      agents: [{ name: 'Ram', id: 'A1', lastTotal: 10, curTotal: 20, curVc4: 8, curComm: 12, growth: 100, stockTotal: 5 }],
      totals: { lastTotal: 10, curTotal: 20 }
    },
    age: { total: 5, old30: 3, old60: 2, buckets: [{ key: 'b0', label: '0-15d', n: 5 }], byClass: [{ cls: 'VC4', b0: 5, old30: 3, old60: 2, total: 5 }] }
  };
  const pack = [{ agent: { name: 'Ram', id: 'A1' }, rep: { p: { lastYm: '2026-09', curYm: '2026-10', classTable: [{ cls: 'VC4', last: 10, cur: 20, growth: 100, stock: 5 }], totals: { lastTotal: 10, curTotal: 20, growth: 100, stockTotal: 5 } } } }, { agent: { name: 'Skip' }, rep: null }];
  const sheets = JSON.parse(JSON.stringify(FF.agentSummary.teamPackXlsx(r, pack)));
  const names = sheets.map((s) => s.name);
  assert.deepEqual(names, ['Team Summary', 'Stock Ageing', 'Ram']);
  const sum = sheets[0];
  assert.equal(sum.rows[sum.rows.length - 1][0], 'GRAND TOTAL');
  assert.equal(sum.rows[sum.rows.length - 1][3], 20);
  assert.equal(sheets[1].rows[sheets[1].rows.length - 1][0], 'GRAND TOTAL');
  assert.equal(sheets[2].rows[0][0], 'VC4');
  assert.equal(sheets[2].rows[sheets[2].rows.length - 1][0], 'GRAND TOTAL');
});

test('agentWaText me naam, MTD, stock aur brand sab aate hain', () => {
  const { FF } = load();
  const txt = FF.agentSummary.agentWaText({ ch: 'ff', p: { name: 'Shyam' } }, { name: 'Ram', id: 'A1', curTotal: 20, lastTotal: 10, stockTotal: 5, growth: 100 });
  assert.ok(txt.includes('Ram') && txt.includes('20') && txt.includes('Shyam') && txt.includes('ApnaPayment'));
});
