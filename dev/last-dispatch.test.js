import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const ms = fs.readFileSync(new URL('../masterSearch.js', import.meta.url), 'utf8');
test('Last dispatch: endpoint reads the stock-sheet ledger by agent / TL name or ID', () => {
  assert.match(server, /p === '\/api\/dispatch-by' && method === 'POST'/);
  assert.match(server, /ledgerAggregate\(false\)/, 'dispatch-by reads the small aggregate, not the full row index');
  assert.doesNotMatch(server.slice(server.indexOf("p === '/api/dispatch-by'"), server.indexOf("p === '/api/dispatch-by'") + 2500), /ledgerIndex\(/, 'no full-index build on the Master Search path (memory)');
  assert.match(server, /for \(const e of mine\) entries\[src\.ch\]\.push\(e\)/, 'barcode index path keeps its rows');
});
test('Last dispatch: Master Search chip shows date + class-wise counts and opens a drawer', () => {
  assert.match(ms, /Last dispatch/);
  assert.match(ms, /\/api\/dispatch-by/);
  assert.match(ms, /\$\{dispBoxHtml\(pr, isTl, ch\)\}/);
  assert.match(ms, /fillDispBoxes\(host\)/);
  assert.match(ms, /data-msp-disp-box/);
});
