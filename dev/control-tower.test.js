import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('operations control tower wiring is present', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const lazy = fs.readFileSync(new URL('../lazy.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../controlTower.js', import.meta.url), 'utf8');

  assert.match(server, /p === '\/api\/control-tower'/);
  assert.match(server, /resolveGvServerColumns/);
  assert.match(server, /Google Sheets serial date/);
  assert.match(app, /id: 'controlTower'/);
  assert.match(lazy, /controlTower: \['controlTower'\]/);
  assert.match(page, /Operations Control Tower/);
  assert.match(page, /Snapshot Compare/);
  assert.match(page, /What Changed/);
  assert.match(page, /Action Center/);
});
