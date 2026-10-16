/* Tag Request: admin can select many requests and set Approved / Dispatched / Rejected / Pending in one go. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'tagRequest.js'), 'utf8');

test('bulk toolbar (admin only): Approve, Dispatch, status select + Apply', () => {
  assert.match(src, /isAdmin\(\) \? `<span class="tr-bulk-status"/);
  for (const op of ['approve', 'dispatch', 'apply-status']) assert.match(src, new RegExp(`data-tr-bulk="${op}"`));
  assert.match(src, /data-tr-bulk-status/);
  assert.match(src, /STATUS_KEYS\.map\(\(k\) => `<option value="\$\{k\}"/);
});

test('bulkSetStatus: admin guard, skips same-status rows, confirms, batches PUTs, clears selection', () => {
  const fn = src.slice(src.indexOf('async function bulkSetStatus'), src.indexOf('const bulkApprove'));
  assert.match(fn, /if \(!isAdmin\(\)\)/);
  assert.match(fn, /\(r\.status \|\| 'pending'\) !== status/);
  assert.match(fn, /window\.confirm/);
  assert.match(fn, /i \+= 6/);
  assert.match(fn, /putRequest\(r, \{ status \}\)/);
  assert.match(fn, /state\.sel\.clear\(\)/);
  assert.match(src, /op === 'dispatch'\) bulkSetStatus\('dispatched'\)/);
  assert.match(src, /op === 'apply-status'/);
});
