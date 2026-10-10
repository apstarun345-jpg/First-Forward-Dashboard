import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFile(path.join(ROOT, name), 'utf8');

test('FASTag Mapping is registered under GV Partner and loads lazily', async () => {
  const [app, lazy, page, server, pkg] = await Promise.all([
    read('app.js'), read('lazy.js'), read('fastagMapping.js'), read('server.js'), read('package.json')
  ]);
  assert.match(app, /id: 'fastagMapping'[\s\S]{0,220}group: 'GV Partner', adminOnly: true/);
  assert.match(lazy, /fastagMapping: \['fastagMapping'\]/);
  assert.match(page, /FF\.pages\.fastagMapping = \{ title: 'FASTag Mapping', render \}/);
  assert.match(pkg, /fastagMapping/);
  assert.match(server, /key: 'fastagMapping', label: 'GV Partner · FASTag Mapping \(admin-only API mapping\)'/);
});

test('FASTag Mapping supports barcode ranges, multiple identifiers, StockDataa fields and full CSV', async () => {
  const page = await read('fastagMapping.js');
  for (const required of [
    'firstbarcode', 'lastbarcode', 'tagId', 'serialNo', 'agentId',
    "D.query('StockDataa'", "vcType: val('vcType')", "stockAgentId: val('agentId')",
    'fm-quick-map', 'fastag-mapping-template.csv', 'Full details CSV',
    'Mapped successfully', 'Duplicate conflict'
  ]) assert.ok(page.includes(required), 'missing feature: ' + required);
  assert.match(page, /accept="\.csv,\.tsv,\.txt,\.xlsx"/);
});

test('FASTag Mapping template is exactly the requested four columns; lookup tries text and numeric matches', async () => {
  const page = await read('fastagMapping.js');
  assert.match(page, /saveCsvFile\('fastag-mapping-template\.csv', \['tagId', 'serialNo', 'vcType', 'agentId'\]/);
  assert.match(page, /const schema = await stockSchema\(\)/);
  assert.match(page, /D\.query\('StockDataa', tq, \{ timeoutMs: 55000, directTimeoutMs: 12000, retries: 0, directFirst: true \}\)/);
  assert.match(page, /queryRows\(make\(work\.numeric, batch\)\)/);
  assert.match(page, /queryRows\(make\(!work\.numeric, missing\)\)/);
  assert.match(page, /queryField\('tagId', tagIds\)/);
  assert.match(page, /queryField\('barcode', barcodes\)/);
  assert.match(page, /Range upload mein barcode series StockDataa se expand hogi/);
  assert.match(page, /TAG_ID, BARCODE aur TAG_CLASS auto-fill honge/);
  assert.match(page, /if \(!value \|\| !agentId\)/);
});

test('StockDataa column mapping uses TAG_ID, BARCODE and TAG_CLASS; separate range upload + API CSV schemas', async () => {
  const page = await read('fastagMapping.js');
  assert.match(page, /tagId: \['tagid'[\s\S]*?\]/);
  assert.match(page, /barcode: \['barcode'[\s\S]*?\]/);
  assert.match(page, /vcType: \['vctype', 'tagclass'/);
  assert.match(page, /fallback\.index\.serialNo = colIndex\('D'\)/);
  assert.match(page, /fallback\.index\.vcType = colIndex\('E'\)/);
  assert.match(page, /saveCsvFile\('fastag-mapping-template\.csv', \['tagId', 'serialNo', 'vcType', 'agentId'\]/);
  assert.match(page, /saveCsvFile\('fastag-range-template\.csv', \['firstBarcode', 'lastBarcode', 'agentId'\]/);
  assert.match(page, /saveCsvFile\('fastag-mapping-api-rows-/);
  assert.match(page, /\['tagId', 'serialNo', 'vcType', 'agentId'\], rows/);
  assert.match(page, /queryField\('barcode', barcodes\)[\s\S]*?queryField\('tagId', tagIds\)/);
  assert.match(page, /Array\.from\(\{ length: Math\.min\(3, batches\.length\) \}/);
});

test('FASTag Mapping write API is authenticated/admin-only and never embeds its secret in frontend', async () => {
  const server = await read('server.js');
  const page = await read('fastagMapping.js');
  assert.match(server, /\/api\/fastag-mapping\/status/);
  assert.match(server, /\/api\/fastag-mapping\/map/);
  assert.match(server, /process\.env\.GV_TAG_MAPPING_SECRET/);
  assert.match(server, /'X-Secret-Key': secret/);
  assert.match(server, /JSON\.stringify\(\{ bank_id: 1, sno:/);
  assert.match(server, /requireAdmin\(user\)/);
  assert.doesNotMatch(page, /X-Secret-Key|GV@Secure/);
});
