import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FF = { util: { esc: (v) => String(v ?? ''), MONTHS: [] }, config: {}, pages: {}, auth: { can: () => true } };
const sandbox = {
  window: { FF }, FF, console, Map, Set, URLSearchParams, Date,
  document: { addEventListener() {} },
  location: { hash: '#/masterSearch' }
};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'kpiDetail.js'), 'utf8'), sandbox, { filename: 'kpiDetail.js' });

const rows = [
  { group: 'VC4', cls: 'VC4', channel: 'First Forward', type: 'ISSUANCE', vrnType: 'New' },
  { group: 'VC20', cls: 'VC20', channel: 'First Forward', type: 'ISSUANCE', vrnType: 'New' },
  { group: 'VC5+', cls: 'VC5', channel: 'GV Partner', type: 'ISSUANCE', vrnType: 'New' }
];

test('master-profile group drill-down returns only the exact VC4 or commercial records', () => {
  const matches = FF.kpiDetail._rowMatchesSpec;
  assert.deepEqual(rows.filter((r) => matches(r, { group: 'VC4' })).map((r) => r.cls), ['VC4']);
  assert.deepEqual(rows.filter((r) => matches(r, { group: 'COMM' })).map((r) => r.cls), ['VC20', 'VC5']);
  assert.equal(matches(rows[0], { group: 'COMM' }), false);
});
