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
  assert.match(fn, /i \+= 200/);
  assert.match(fn, /\/api\/tag-requests\/bulk-status/);
  assert.match(fn, /progressUi\(/);
  assert.match(fn, /state\.sel\.clear\(\)/);
  assert.match(src, /op === 'dispatch'\) bulkSetStatus\('dispatched'\)/);
  assert.match(src, /op === 'apply-status'/);
});

test('progress card shows "n / total" and server has a single-save bulk endpoint', () => {
  assert.match(src, /function progressUi\(title, total, delayMs\)/);
  assert.match(src, /<b>\$\{fmt\(shown\)\}<\/b> \/ \$\{fmt\(total\)\}/);
  const server = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const ep = server.slice(server.indexOf("p === '/api/tag-requests/bulk-status'"));
  assert.match(ep, /user\.role !== 'admin'/);
  const epBlock = ep.slice(0, ep.indexOf('tagReqPath'));
  assert.equal((epBlock.match(/persistBackground\('notify'\)/g) || []).length, 1, 'one storage save for the whole bulk call, in the background');
  assert.doesNotMatch(epBlock, /await persist\('notify'\)\n    \/\/ 📗/);
});

test('single status change is instant: no progress card, optimistic row flip', () => {
  const fn = src.slice(src.indexOf('function setStatus(dr, status, btn)'), src.indexOf('/** Full-screen progress card'));
  assert.doesNotMatch(fn, /progressUi\(/);
  assert.match(fn, /putRequest\(dr\.req, \{ status \}\)/);
  const server = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /every\(\(k\) => k === 'status'\)\) persistBackground\('notify'\)/);
});
