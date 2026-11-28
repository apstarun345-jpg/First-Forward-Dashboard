import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
test('v621: re-approving a request never clears the sheet marker (no duplicate sheet entry)', () => {
  assert.doesNotMatch(srv, /delete row\.sheetApprovalSync/);
  assert.match(srv, /prev !== 'approved'\) toSheet\.push\(row\)/);
  assert.match(srv, /Duplicate entry rok di gayi/);   // central guard in pushTagRequestsToSheet
});
