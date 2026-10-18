import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const home = readFileSync(path.join(ROOT, 'home.js'), 'utf8');

test('duplicate warning: pichhle 7 din me kisi bhi status ki request = repeat; pending/approved 30 din tak active (v206)', () => {
  assert.match(srv, /const recent7 = !t \|\| nowMs - t <= 7 \* DAY;/);
  assert.match(srv, /if \(status !== 'pending' && status !== 'approved'\) continue;/);
  assert.match(srv, /nowMs - t > 30 \* DAY/);
});
test("Home 'Today's work' shows late, to-dispatch and sheet-failed counts", () => {
  assert.match(home, /const summarize = \(list\) =>/);
  assert.match(home, /waiting 2\+ days/);
  assert.match(home, /approved — dispatch pending/);
  assert.match(home, /Google Sheet entry failed — resend/);
  assert.match(home, /paint\(summarize\(list\)\)/);
  assert.match(home, /FF\.auth\.can\('fastagMapping'\)/);
});
