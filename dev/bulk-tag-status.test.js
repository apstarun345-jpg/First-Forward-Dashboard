import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = await fs.readFile(path.join(ROOT, 'bulkTagStatus.js'), 'utf8');
const FF = {
  util: {
    esc: (v) => String(v == null ? '' : v),
    parseDate: () => null
  },
  data: {},
  config: {},
  pages: {}
};
const context = { window: { FF }, console };
vm.runInNewContext(code, context, { filename: 'bulkTagStatus.js' });
const BTS = FF.bulkTagStatus._test;

test('Bulk Tag Status parses header-based VRN / Tag ID / Barcode tables', () => {
  const parsed = BTS.parseInputText([
    'VRN\tTag ID\tBarcode',
    'RJ14 AB 1234\tTAG-00001234\t34161FA82032001',
    'RJ14CD5678\tTAG-00005678\t34161FA82032002'
  ].join('\n'));
  assert.equal(parsed.headerFound, true);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].fields.length, 3);
  assert.equal(parsed.records[0].fields[0].kind, 'VRN');
  assert.equal(parsed.records[0].fields[0].value, 'RJ14 AB 1234');
  assert.equal(parsed.records[0].fields[1].kind, 'Tag ID');
  assert.equal(parsed.records[0].fields[2].kind, 'Barcode');
});

test('Bulk Tag Status parses newline-separated identifiers without a header', () => {
  const parsed = BTS.parseInputText('RJ14 AB 1234\nTAG-00001234\n34161FA82032001');
  assert.equal(parsed.headerFound, false);
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.records[0].fields[0].kind, 'VRN');
  assert.equal(parsed.records[1].fields[0].value, 'TAG-00001234');
  assert.equal(parsed.records[2].fields[0].value, '34161FA82032001');
  assert.equal(BTS.normId(' RJ14 AB-1234 '), 'RJ14AB1234');
});

test('Bulk Tag Status resolves a First Forward EIR issuance', () => {
  const record = { line: 1, fields: [{ kind: 'VRN', value: 'RJ14AB1234' }] };
  const data = {
    eir: [{ _keys: ['RJ14AB1234'], tagId: 'FF-TAG-1', vrn: 'RJ14AB1234', cls: 'VC4', status: 'ISSUED', date: '2026-10-08', agentId: 'F100', agentName: 'FF Agent', tlName: 'FF TL' }],
    ffStock: [], gvMaster: [], gvStock: []
  };
  const out = BTS.resolveStatus(record, data, {});
  assert.equal(out.statusCode, 'ff-issued');
  assert.equal(out.status, 'FF ISSUED');
  assert.equal(out.agent, 'FF Agent');
  assert.equal(out.sources, 'FF EIR');
});

test('Bulk Tag Status resolves a GV Master issuance and flags cross-source stock overlap', () => {
  const record = { line: 1, fields: [{ kind: 'Tag ID', value: 'TAG123456' }] };
  const data = {
    eir: [],
    ffStock: [],
    gvMaster: [{ _keys: ['TAG123456'], tagId: 'TAG123456', serial: 'SER123456', vrn: 'RJ14AB1234', status: 'ISSUANCE', agentName: 'GV Agent', cls: 'VC5', date: '2026-10-08' }],
    gvStock: []
  };
  assert.equal(BTS.resolveStatus(record, data, {}).statusCode, 'gv-issued');

  data.ffStock.push({ _keys: ['TAG123456'], tagId: 'TAG123456', barcode: 'BAR123456', cls: 'VC5' });
  const conflict = BTS.resolveStatus(record, data, {});
  assert.equal(conflict.statusCode, 'multi-stock');
  assert.match(conflict.status, /overlap/i);
});

test('Bulk Tag Status distinguishes inventory-only tags from Not Found', () => {
  const stockRecord = { line: 1, fields: [{ kind: 'Barcode', value: '34161FA82032001' }] };
  const stockData = {
    eir: [], gvMaster: [], gvStock: [],
    ffStock: [{ _keys: ['34161FA82032001'], tagId: 'FF-10', barcode: '34161FA82032001', cls: 'VC4' }]
  };
  assert.equal(BTS.resolveStatus(stockRecord, stockData, {}).statusCode, 'ff-stock');

  const missing = BTS.resolveStatus(stockRecord, { eir: [], ffStock: [], gvMaster: [], gvStock: [] }, {});
  assert.equal(missing.statusCode, 'not-found');

  const incomplete = BTS.resolveStatus(stockRecord, { eir: [], ffStock: [], gvMaster: [], gvStock: [] }, {
    eir: new Set(['34161FA82032001'])
  });
  assert.equal(incomplete.statusCode, 'incomplete');
});

test('Bulk Tag Status treats GV out-of-stock statuses as review, not available stock', () => {
  const record = { line: 1, fields: [{ kind: 'Barcode', value: 'GV-SERIAL-1' }] };
  const out = BTS.resolveStatus(record, {
    eir: [], ffStock: [], gvMaster: [],
    gvStock: [{ _keys: ['GV-SERIAL-1'], serial: 'GV-SERIAL-1', status: 'RETURNED', cls: 'VC4' }]
  }, {});
  assert.equal(out.statusCode, 'gv-status-review');
});
