/* 🗓️ serverDate() — /api/today ka "GV aaj live" feed sheet ke date cell ko sab formats me samajhna chahiye.
   Regression: pehle sirf gviz ka `Date(y,m,d)` aur ISO `yyyy-mm-dd` chalta tha. Jis GV Master sheet me
   date column text (03-10-2026 / 3-Oct-2026) hai, wahan har row skip ho jaati thi → Home par GV aaj 0
   dikhta tha (asli bug: "GV ka aaj ka live data nahi dikh raha"). Ye test wahi formats pin karta hai. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const start = src.indexOf('const SERVER_MONTHS');
const end = src.indexOf('function serverNumber', start);
assert.ok(start > -1 && end > start, 'server.js me SERVER_MONTHS + serverDate mila');
const serverDate = new Function(`${src.slice(start, end)}; return serverDate;`)();

test('serverDate: gviz Date(y,m,d) — mahina 0-based', () => {
  assert.equal(serverDate('Date(2026,9,3)'), '2026-10-03');
  assert.equal(serverDate('Date(2026,11,31,0,0,0)'), '2026-12-31');
  assert.equal(serverDate('Date(2026,0,1)'), '2026-01-01');
});

test('serverDate: ISO (date + time)', () => {
  assert.equal(serverDate('2026-10-03'), '2026-10-03');
  assert.equal(serverDate('2026-10-03T09:15:00Z'), '2026-10-03');
  assert.equal(serverDate('2026-1-5'), '2026-01-05');
});

test('serverDate: dd-mm-yyyy / dd/mm/yyyy (Indian) + mm/dd tolerance', () => {
  assert.equal(serverDate('03-10-2026'), '2026-10-03');
  assert.equal(serverDate('3/10/2026'), '2026-10-03');
  assert.equal(serverDate('03/10/26'), '2026-10-03');
  assert.equal(serverDate('10/03/2026'), '2026-03-10', 'dono 12 se chhote → din pehle (Indian)');
  assert.equal(serverDate('12/25/2026'), '2026-12-25', 'mo > 12 → mm/dd samjho');
  assert.equal(serverDate('03-10-2026 14:05'), '2026-10-03');
});

test('serverDate: dd-Mon-yyyy · dd Mon yyyy · Mon dd, yyyy', () => {
  assert.equal(serverDate('3-Oct-2026'), '2026-10-03');
  assert.equal(serverDate('03 Oct 2026'), '2026-10-03');
  assert.equal(serverDate('3-Oct-26'), '2026-10-03');
  assert.equal(serverDate('October 3, 2026'), '2026-10-03');
  assert.equal(serverDate('Oct 03 2026'), '2026-10-03');
});

test('serverDate: khaali / bekaar value → empty (row skip)', () => {
  assert.equal(serverDate(''), '');
  assert.equal(serverDate(null), '');
  assert.equal(serverDate(undefined), '');
  assert.equal(serverDate('hello'), '');
  assert.equal(serverDate('0'), '');
});
