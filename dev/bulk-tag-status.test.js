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
    parseDate: (v) => {
      if (v && typeof v.getTime === 'function') return v;
      if (typeof v === 'string' && /^Date\(/.test(v)) {
        const m = v.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
        if (m) return new Date(Number(m[1]), Number(m[2]), Number(m[3]));
      }
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T00:00:00');
      return null;
    },
    dateKey: (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
    labelDate: (d) => d.toISOString().slice(0, 10)
  },
  data: {
    cellText: (cell) => !cell || cell.v === null || cell.v === undefined ? '' : (cell.f !== undefined ? String(cell.f) : String(cell.v)),
    cellDate: (cell) => cell && cell.v && typeof cell.v.getTime === 'function' ? cell.v : null
  },
  config: {},
  pages: {}
};
const context = { window: { FF }, console };
vm.runInNewContext(code, context, { filename: 'bulkTagStatus.js' });
const BTS = FF.bulkTagStatus._test;


test('Bulk Tag Status audit counts unique blank-issuer Tag IDs by date and excludes IDs found in GV Master', () => {
  const cell = (v, f) => v === null || v === undefined ? { v: null } : { v, ...(f === undefined ? {} : { f }) };
  const cols = [
    { label: 'TAG_ID' }, { label: 'ISSUE_DATE', type: 'date' }, { label: 'TAG_ISSUING_AGENT_ID' }
  ];
  const rows = [
    [cell('T100'), cell('Date(2026,9,9)', '2026-10-09'), cell(null)],
    [cell('T100'), cell('Date(2026,9,9)', '2026-10-09'), cell(null)],
    [cell('T200'), cell('Date(2026,9,9)', '2026-10-09'), cell(null)],
    [cell('T300'), cell('Date(2026,9,8)', '2026-10-08'), cell('FF001')],
    [cell(null), cell('Date(2026,9,9)', '2026-10-09'), cell(null)],
    [cell('T400'), cell(null), cell(null)]
  ];
  const built = BTS.buildAuditGroups(rows, new Set(['T200']), 0, 1, 2, cols);
  const dated = built.groups.find((g) => g.key === '2026-10-09');
  const noDate = built.groups.find((g) => g.key === '__NO_DATE__');
  assert.equal(dated.count, 1);
  assert.equal(dated.eirRows, 2);
  assert.equal(dated.normalizedIds.length, 1);
  assert.equal(dated.normalizedIds[0], 'T100');
  assert.equal(noDate.count, 1);
  assert.equal(built.eirBlankRows, 5);
  assert.equal(built.skippedNoTagId, 1);
});

test('Bulk Tag Status locates the exact TAG_ISSUING_AGENT_ID header', () => {
  const cols = [{ label: 'TAG_ID' }, { label: 'Tag Issuing Agent Id' }, { label: 'ISSUE_DATE' }];
  assert.equal(BTS.headerIndex(cols, ['TAG_ISSUING_AGENT_ID']), 1);
});

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

test('Bulk Tag Status preserves leading zeroes from simple Excel number masks', () => {
  assert.equal(BTS.restoreFormattedIdentifier('1234', '00000000'), '00001234');
  assert.equal(BTS.restoreFormattedIdentifier('1234', '00-0000'), '00-1234');
  assert.equal(BTS.restoreFormattedIdentifier('20261009', 'dd/mm/yyyy'), '20261009');
  assert.equal(BTS.headerKind('Vehicle Reg No'), 'VRN');
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
    gvStock: [{ _keys: ['GVSERIAL1'], serial: 'GV-SERIAL-1', status: 'RETURNED', cls: 'VC4' }]
  }, {});
  assert.equal(out.statusCode, 'gv-status-review');
});
