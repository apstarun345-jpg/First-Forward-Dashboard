import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('Barcode Checker has class-verify mode wired (select, judge, flash, counts, persist)', () => {
  const s = fs.readFileSync(path.join(ROOT, 'barcodeChecker.js'), 'utf8');
  assert.match(s, /data-scan-want/);
  assert.match(s, /function vmJudge\(r\)/);
  assert.match(s, /rows\.forEach\(\(r, i\) => \{ r\._i = i; vmJudge\(r\); \}\)/);
  assert.match(s, /ff_bcc_vm/);
  assert.match(s, /scan\.vmDone\.get\(key\) !== scan\.want/, 'beep/flash only once per barcode per class');
  const c = fs.readFileSync(path.join(ROOT, 'revamp.css'), 'utf8');
  assert.match(c, /\.bcc-vm-flash\.bad/);
});
