// v3.125.371 — sheet-atki alert + backup-sync-ruka alert (source locks).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('backup snapshot pull time yaad rakhta hai aur alert reset karta hai', () => {
  assert.match(src, /ws\.backupLastPullAt = new Date\(\)\.toISOString\(\); ws\.backupAlertAt = ''/);
});
test('backup 36h stale alert (6h check, ek alert)', () => {
  assert.match(src, /\|\| ws\.backupAlertAt\) return;/);
  assert.match(src, /Backup site ka sync ruka hua hai/);
});
test('sheet entry 30 min se atki ho to admin alert, 6h throttle', () => {
  assert.match(src, /now - ts\(r\.updatedAt \|\| r\.at\) > 30 \* 60e3/);
  assert.match(src, /__tagSheetStuckAlertAt \|\| 0\) > 6 \* 3600e3/);
  assert.match(src, /Google Sheet entry atki hai/);
});
