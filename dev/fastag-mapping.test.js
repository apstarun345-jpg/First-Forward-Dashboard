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
  assert.match(lazy, /fastagMapping: \['fastagMapping', 'masterSearch'\]/);
  assert.match(page, /FF\.pages\.fastagMapping = \{ title: 'FASTag Mapping', render, normalizeVcType \}/);
  assert.match(pkg, /fastagMapping/);
  assert.match(server, /key: 'fastagMapping', label: 'GV Partner · FASTag Mapping \(admin-only API mapping\)'/);
});

test('Mapping API ko VC type hamesha canonical "VC<number>" form me jaata hai (StockDataa plain 4/5/12 bhi)', async () => {
  const [page, server] = await Promise.all([read('fastagMapping.js'), read('server.js')]);
  // Server side — /api/fastag-mapping/map payload banate waqt normalize kare (stale cached
  // client ya CSV upload kuch bhi bheje, apnapayment API ko VC4… jaisa hi jaaye).
  assert.match(server, /function normalizeVcType\(value\)/);
  assert.match(server, /vcType: normalizeVcType\(row && row\.vcType\)/);
  // Client side — StockDataa read par aur API send dono jagah same normalizer.
  assert.match(page, /stock\.vcType = normalizeVcType\(stock\.vcType\)/);
  assert.match(page, /vcType: normalizeVcType\(r\.vcType\)/);
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
  assert.match(page, /stockQuery\(tq, \{[\s\S]{0,140}fresh: true, timeoutMs: STOCK_LOOKUP_TIMEOUT_MS, retries: 0, directFirst: true/);
  assert.match(page, /const variants = \[make\(false, batch\), make\(true, batch\)\]/);
  assert.match(page, /queryRows\(tq\)\.then/);
  assert.match(page, /queryField\('tagId', tagIds(?:, tick)?\)/);
  assert.match(page, /queryField\('barcode', barcodes(?:, tick)?\)/);
  assert.match(page, /Range upload mein barcode series StockDataa se expand hogi/);
  assert.match(page, /TAG_ID, BARCODE aur TAG_CLASS auto-fill honge/);
  assert.match(page, /if \(!value \|\| !agentId\)/);
});

test('StockDataa select sirf needed columns (A–K) tak — patli sheet par NO_COLUMN auto-shrink retry', async () => {
  const page = await read('fastagMapping.js');
  // Regression v3.70.5: hardcoded "select A,…,K,L,M" 11-column StockDataa par gviz
  // "Invalid query: NO_COLUMN: L" deti thi — poora lookup fail ho jaata tha.
  assert.doesNotMatch(page, /select A,B,C,D,E,F,G,H,I,J,K,L,M/);
  assert.doesNotMatch(page, /select A,B,C,D,E,F,G,H,I,J,K where/);
  assert.match(page, /function selectClause\(\)/);
  assert.match(page, /make = \(numeric, vals\) => selectClause\(\) \+ ' where '/);
  assert.match(page, /const tq = selectClause\(\) \+ ' where ' \+ field \+ ' is not null limit '/);
  assert.match(page, /stockQuery\(selectClause\(\) \+ ' where D is not null limit '/);
  assert.match(page, /const fastSelect = \(\) => selectClause\(\) \+ ' where ';/);
  assert.match(page, /async function stockQuery\(tq, opts\)/);
  assert.match(page, /NO_COLUMN:\\s\*\(\[A-Z\]\)/);
  assert.match(page, /stockColumnCap = Math\.min\(stockColumnCap, missingIdx\)/);
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
  assert.match(page, /queryField\('barcode', barcodes(?:, tick)?\)[\s\S]*?queryField\('tagId', tagIds(?:, tick)?\)/);
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
