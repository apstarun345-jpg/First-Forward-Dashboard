import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- minimal browser stubs -----------------------------------------------------------------------
const ctxStub = {
  fillStyle: '#000', textBaseline: 'alphabetic', font: '10px x',
  fillRect() {}, fillText() {}, measureText: () => ({ width: 10 }),
  beginPath() {}, rect() {}, fill() {}, roundRect() {}, save() {}, restore() {}
};
const makeCanvas = () => ({
  width: 0, height: 0,
  getContext: () => ctxStub,
  toDataURL: () => 'data:image/jpeg;base64,' + Buffer.alloc(2048, 7).toString('base64')
});

const utilStub = {
  clean: (v) => String(v == null ? '' : v).trim(),
  esc: (v) => String(v == null ? '' : v),
  fmt: (v) => String(v == null ? 0 : v),
  sum: (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0),
  growth: (c, p) => (p ? ((c - p) / p) * 100 : null),
  pctHtml: () => '—', slug: (s) => String(s || ''), stamp: () => 'x',
  spinner: () => '…', $: () => null, downloadCsv() {}, downloadBlob() {}, copyText: async () => {}, waLink: () => ''
};

function load(file, util = {}, ffExtra = {}) {
  const FF = { util, pages: {}, config: {}, ...ffExtra };
  const sandbox = {
    window: { FF }, FF, console, Blob, atob, Uint8Array, setTimeout, clearTimeout,
    TextEncoder, TextDecoder, requestAnimationFrame: (f) => f(),
    document: { createElement: () => makeCanvas(), body: { appendChild() {} } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    navigator: {}, File: class { constructor() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  return { FF, sandbox };
}

// ---- pdf.js — legacy + new doc() API --------------------------------------------------------------
const pdf = load('pdf.js', utilStub);

test('legacy pdf doc() API — section / table({headers,foot}) / footer / finish→Blob — PDF banata hai', async () => {
  const { FF } = pdf;
  const doc = FF.pdf.doc({ title: 'FF · Agent Summary', subtitle: 'José Alvarez (ID: FF-ID_1045)', right: '01/10/2026' });
  doc.kpis([
    { label: 'This Month', value: '123', sub: 'VC4 1 · Comm 2', color: '#2563eb' },
    { label: 'Stock', value: '45', color: '#0891b2' }
  ]);
  doc.section('Class-wise Issuance (Sep vs Oct) & Stock in Hand');
  doc.table({
    headers: ['Class', 'Last Month', 'Current (MTD)', 'Stock in Hand'],
    align: ['left', 'right', 'right', 'right'],
    rows: [['VC4', '1', '2', '3'], ['Comm', '4', '5', '6']],
    foot: ['GRAND TOTAL', '5', '7', '9']
  });
  doc.footer('ApnaPayment · First Forward · Grand Total');
  const blob = doc.finish();
  assert.ok(blob instanceof Blob, 'finish() ab Blob deta hai');
  const text = await blob.text();
  assert.ok(text.startsWith('%PDF-1.4'), 'PDF magic header');
  assert.ok(blob.size > 1000, 'PDF me image data hai');
});

test('new pdf doc() API (columns/rows + title chaining) ab bhi waise ka waisa kaam karta hai', async () => {
  const { FF } = pdf;
  const doc = FF.pdf.doc({});
  doc.title('T', 'sub').heading('H').kpis([{ label: 'A', value: '1' }]);
  doc.table([{ h: 'Col A', align: 'left' }, { h: 'Col B', align: 'right' }], [['x', '1'], ['y', '2']], { boldLast: true });
  doc.text('done');
  const blob = doc.finish('footer text');
  assert.ok(blob instanceof Blob);
  assert.ok((await blob.text()).startsWith('%PDF-1.4'));
});

// ---- agentSummary.js — reportXlsx / reportJson ----------------------------------------------------
const mockProfile = {
  channel: 'First Forward', kind: 'ff-agent', name: 'José Alvarez', id: 'FF-ID_1045',
  priority: 'High', mobile: '9876543210',
  totals: { curTotal: 10, curVc4: 4, curComm: 6, lastTotal: 5, lastVc4: 2, lastComm: 3, growth: 100 },
  stock: { vc4: 1, comm: 2, total: 3 },
  months: { cur: '2026-10', last: '2026-09' },
  classes: [{ cls: 'VC4', last: 2, cur: 4, stock: 1 }, { cls: 'Comm', last: 3, cur: 6, stock: 2 }],
  agents: [],
  calc: { total: { rate: 2 } }, projT1: { total: 20 }
};

test('reportXlsx multi-sheet workbook banata hai — Summary / Class-wise + Grand Total rows', async () => {
  const { FF } = load('agentSummary.js', utilStub);
  FF.masterProfile = {
    build: async () => mockProfile,
    csvRows: () => [['Name', 'José Alvarez']]
  };
  const report = await FF.agentSummary.buildReport({ kind: 'ff-agent', name: 'José Alvarez', id: 'FF-ID_1045', tl: '' });
  const sheets = FF.agentSummary.reportXlsx(report);
  const names = sheets.map((s) => s.name);
  assert.ok(names.includes('Summary'), 'Summary sheet');
  assert.ok(names.includes('Class-wise'), 'Class-wise sheet');
  const cls = sheets.find((s) => s.name === 'Class-wise');
  assert.deepEqual(JSON.parse(JSON.stringify(cls.rows[cls.rows.length - 1])), ['GRAND TOTAL', 5, 10, 100, 3]);
  const sum = sheets.find((s) => s.name === 'Summary');
  assert.deepEqual(JSON.parse(JSON.stringify(sum.header)), ['Field', 'Value']);
  assert.ok(sum.rows.some((r) => r[0] === 'Stock in Hand' && r[1] === 3));
  assert.ok(FF.agentSummary.reportJson(report).includes('"generatedAt"'), 'JSON payload');
});

test('reportXlsx sheets se FF.xlsx.build valid Excel Blob banata hai', () => {
  const { FF } = load('xlsx.js', { ...utilStub, colLetter: (i) => String.fromCharCode(65 + i) });
  const sheets = [
    { name: 'Summary', header: ['Field', 'Value'], rows: [['MTD', 10]] },
    { name: 'Class-wise', header: ['Class', 'MTD'], rows: [['VC4', 4], ['GRAND TOTAL', 4]] }
  ];
  const blob = FF.xlsx.build(sheets);
  assert.ok(blob instanceof Blob && blob.size > 400, 'xlsx zip blob');
});
