import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../barcodeChecker.js', import.meta.url), 'utf8').replace('  FF.barcodeChecker = {', '  FF.testDuplicate = { dupScan, dupPaint, dupCsv, dup };\n  FF.barcodeChecker = {');

test('duplicate checker scans only the selected source, displays every duplicate row and downloads filtered CSV safely', async () => {
  const calls = [], downloads = [];
  const out = { innerHTML: '' };
  const root = { isConnected: true, querySelector: (sel) => sel === '[data-dup-out]' ? out : null };
  const FF = { pages: {}, util: { esc: (v) => String(v ?? ''), fmt: String, stamp: () => 'test', spinner: () => 'loading', downloadBlob: (name, blob) => downloads.push({ name, blob }) },
    auth: { can: () => true, api: async (url) => { calls.push(url); return { sheet: 'Tag Assignment', at: 'now', duplicateBarcodes: 1, duplicateRows: 2, scanned: 3, groups: [{ key: '123', count: 2, rows: [{ barcode: '00123', tagId: 'T1', agentName: '=danger', cls: 'VC4' }, { barcode: '123', tagId: 'T2', agentName: 'Other', cls: 'VC4' }] }] }; } } };
  vm.runInNewContext(src, { window: { FF }, FF, Blob, setTimeout, clearTimeout, console });
  await FF.testDuplicate.dupScan(root, 'gv');
  assert.deepEqual(calls, ['/api/duplicate-barcodes?source=gv&fresh=1']);
  assert.match(out.innerHTML, /00123/); assert.match(out.innerHTML, /T2/); assert.match(out.innerHTML, /2 rows/);
  FF.testDuplicate.dup.q = 'danger';
  FF.testDuplicate.dupCsv();
  assert.match(downloads[0].name, /duplicate-barcodes-gv/);
  const csv = await downloads[0].blob.text();
  assert.match(csv, /"00123"/); assert.match(csv, /"'=danger"/); assert.doesNotMatch(csv, /T2/);
});
