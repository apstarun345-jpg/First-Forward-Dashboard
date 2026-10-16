import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
test('re-approving a request clears sheet markers so the entry is written again (single + bulk)', () => {
  assert.match(srv, /prevStatus !== 'approved' && tagSheetConfig\(\)\.enabled\) \{[\s\S]{0,300}delete row\.sheetApprovalSync; delete row\.sheetSync;/);
  assert.match(srv, /prev !== 'approved'\) \{ delete row\.sheetApprovalSync; delete row\.sheetSync; toSheet\.push\(row\)/);
});
