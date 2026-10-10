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
    'firstBarcode', 'lastBarcode', 'tagId', 'serialNo', 'agentId',
    "D.query('StockDataa'", "vcType: val('vcType')", "stockAgentId: val('agentId')",
    'fm-quick-map', 'fastag-mapping-template.csv', 'Full details CSV',
    'Mapped successfully', 'Duplicate conflict'
  ]) assert.ok(page.includes(required), 'missing feature: ' + required);
  assert.match(page, /accept="\.csv,\.tsv,\.txt,\.xlsx"/);
});

test('FASTag Mapping template is exactly the requested four columns; lookup tries text and numeric matches', async () => {
  const page = await read('fastagMapping.js');
  assert.match(page, /const headers = \['tagId', 'serialNo', 'vcType', 'agentId'\]/);
  assert.match(page, /D\.query\('StockDataa', make\(true\)/);
  assert.match(page, /D\.query\('StockDataa', make\(false\)/);
  assert.match(page, /queryField\('tagId', tagIds\)/);
  assert.match(page, /queryField\('barcode', barcodes\)/);
  assert.match(page, /Har row me tagId ya serialNo\/barcode aur agentId dein/);
  assert.match(page, /vcType StockDataa se auto-fetch hoga/);
  assert.match(page, /if \(!value \|\| !agentId\)/);
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
