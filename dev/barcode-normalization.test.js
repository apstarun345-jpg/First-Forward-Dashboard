import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(ROOT, 'data.js'), 'utf8');

function loadData() {
  const FF = {
    config: { sheetByName: () => null, sheetId: '', gvSheetId: '', directFallback: false, proxyPath: '' },
    util: { parseDate: () => null, labelDate: () => '' }
  };
  const window = { FF };
  window.window = window;
  const sandbox = { window, URLSearchParams, URL, setTimeout, clearTimeout, AbortController, fetch: async () => { throw new Error('fetch not used by these tests'); }, CustomEvent: class CustomEvent {} };
  vm.runInNewContext(source, sandbox, { filename: 'data.js' });
  return window.FF.data;
}

test('identifier cell text strips sheet display commas while preserving barcode digits', () => {
  const D = loadData();
  assert.equal(D.cellText({ v: 8900000000123456, f: '8,900,000,000,123,456' }, { label: 'BARCODE' }), '8900000000123456');
  assert.equal(D.cellText({ v: '8900000000123456', f: '8.9E+15' }, { label: 'TAG_ID' }), '8900000000123456');
  assert.equal(D.cellText({ v: '0000012345', f: '0000012345' }, { label: 'SERIAL_NO' }), '0000012345');
  assert.equal(D.cellText({ v: '6.081160110558601E+15', f: '6.08E+15' }, { label: 'BARCODE' }), '6081160110558601');
});

test('identifier formatting is column-aware; ordinary numeric amount formatting is unchanged', () => {
  const D = loadData();
  assert.equal(D.isIdentifierColumn({ label: 'TAG_ID' }), true);
  assert.equal(D.isIdentifierColumn({ label: 'BARCODE' }), true);
  assert.equal(D.isIdentifierColumn({ label: 'AMOUNT' }), false);
  assert.equal(D.cellText({ v: 12000, f: '12,000' }, { label: 'AMOUNT' }), '12,000');
});

test('D.textRows normalizes BARCODE and TAG_ID columns in EIR/StockDataa grids', () => {
  const D = loadData();
  const table = {
    cols: [{ label: 'TAG_ID' }, { label: 'BARCODE' }, { label: 'TAG_CLASS' }],
    rows: [[
      { v: '8900000000123456', f: '8.9E+15' },
      { v: 6081160110558601, f: '608116-011-0558601' },
      { v: 'VC20', f: 'VC20' }
    ]]
  };
  assert.deepEqual(JSON.parse(JSON.stringify(D.textRows(table))), [['8900000000123456', '6081160110558601', 'VC20']]);
});
