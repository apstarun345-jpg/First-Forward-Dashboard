import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const ms = fs.readFileSync(new URL('../masterSearch.js', import.meta.url), 'utf8');
test('Last dispatch: endpoint reads the stock-sheet ledger by agent / TL name or ID', () => {
  assert.match(server, /p === '\/api\/dispatch-by' && method === 'POST'/);
  assert.match(server, /ledgerIndex\(false\)/);
  assert.match(server, /for \(const e of mine\) entries\[src\.ch\]\.push\(e\)/, 'fresh ledger load must fill the index');
});
test('Last dispatch: Master Search chip shows date + class-wise counts and opens a drawer', () => {
  assert.match(ms, /Last dispatch/);
  assert.match(ms, /\/api\/dispatch-by/);
  assert.match(ms, /\$\{dispBoxHtml\(pr, isTl, ch\)\}/);
  assert.match(ms, /fillDispBoxes\(host\)/);
  assert.match(ms, /data-msp-disp-box/);
});
