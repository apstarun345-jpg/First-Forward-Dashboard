import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const home = readFileSync(path.join(ROOT, 'home.js'), 'utf8');

test('duplicate warning also covers recently DISPATCHED requests (7 days), pending/approved stay 30 days', () => {
  assert.match(srv, /status !== 'pending' && status !== 'approved' && status !== 'dispatched'\) continue;/);
  assert.match(srv, /\(status === 'dispatched' \? 7 : 30\) \* 24 \* 3600e3/);
});
test("Home 'Today's work' shows late, to-dispatch and sheet-failed counts", () => {
  assert.match(home, /const summarize = \(list\) =>/);
  assert.match(home, /waiting 2\+ days/);
  assert.match(home, /approved — dispatch pending/);
  assert.match(home, /Google Sheet entry failed — resend/);
  assert.match(home, /paint\(summarize\(list\)\)/);
  assert.match(home, /FF\.auth\.can\('fastagMapping'\)/);
});
