/* Home Robot Updates must hand off actionable cards to the complete SmartQ table. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const mascot = await fs.readFile(path.join(ROOT, 'mascot.js'), 'utf8');
const smartQ = await fs.readFile(path.join(ROOT, 'smartQ.js'), 'utf8');

test('Robot update cards open the complete scrollable list with CSV', () => {
  assert.match(mascot, /function openFullRobotList\(it\)/);
  assert.match(mascot, /FF\.smartQ\.open\(query, 'all'\)/);
  assert.match(mascot, /data-rf-full=/);
  assert.match(mascot, /data-rf-list=/);
  assert.match(mascot, /Puri list · CSV/);
  // SmartQ's all mode is the one used by the hand-off and has CSV download support.
  assert.match(smartQ, /n === 'all' \|\| n === 0 \|\| n === Infinity/);
  assert.match(smartQ, /data-sq-csv/);
  assert.match(smartQ, /CSV/);
});
