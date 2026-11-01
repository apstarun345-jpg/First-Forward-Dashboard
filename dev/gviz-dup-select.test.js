/* v3.125.29 — "Invalid query: COLUMN_ONLY_ONCE: L": plain select ke duplicate columns client par dedupe + expand. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../data.js', import.meta.url), 'utf8');
const body = /function dedupeSelect[\s\S]*?\n  \}\n  function expandTable[\s\S]*?\n  \}\n/.exec(src)[0];
const { dedupeSelect, expandTable } = new Function(`${body}; return { dedupeSelect, expandTable };`)();

test('duplicate plain columns are sent once and expanded back in order', () => {
  const d = dedupeSelect("select AA, A, L, J, L, AW where toDate(AA) >= date '2026-10-01' order by AA desc limit 60000");
  assert.equal(d.tq, "select AA, A, L, J, AW where toDate(AA) >= date '2026-10-01' order by AA desc limit 60000");
  assert.deepEqual(d.pos, [0, 1, 2, 3, 2, 4]);
  const t = expandTable({ rows: [['d', 't', 'name', 'id', 'gv']] }, d.pos);
  assert.deepEqual(t.rows[0], ['d', 't', 'name', 'id', 'name', 'gv']);
});

test('no-op for unique columns, group by (server handles) and functions', () => {
  assert.equal(dedupeSelect('select A, B where A is not null'), null);
  assert.equal(dedupeSelect('select A, count(B) group by A'), null);
  assert.equal(dedupeSelect('select A, A, count(B) group by A, A'), null);
  assert.equal(dedupeSelect('select lower(A), A'), null);
});
