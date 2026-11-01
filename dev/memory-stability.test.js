// Free 512 MB instance: stop the restart / cache-wipe loop that made sheets fail to load.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const server = read('server.js');
const pkg = JSON.parse(read('package.json'));

test('start script limits malloc arenas and young-generation size', () => {
  assert.match(pkg.scripts.start, /MALLOC_ARENA_MAX=2/);
  assert.match(pkg.scripts.start, /--max-semi-space-size=8/);
  assert.match(pkg.scripts.start, /--expose-gc/);
});

test('soft memory trim runs gc first and keeps the gviz cache unless RSS stays high', () => {
  assert.match(server, /MEM_CACHE_TRIM_MB/);
  assert.match(server, /function softTrim\(opts\)/);
  assert.match(server, /gc only \(cache kept\)/);
  assert.match(server, /function memBreakdown\(\)/);
});

test('boot warm-ups are staggered behind the first user loads', () => {
  assert.match(server, /stockAgeIndex\(false\)[^\n]*45e3/);
  assert.match(server, /warmDelays = \[150e3, 4 \* 60e3, 8 \* 60e3\]/);
  assert.match(server, /gvAgentCommission\(\)\.catch\(\(\) => \{\}\), 120e3\)/);
  assert.match(server, /warmPersonalLinks\(\)\.catch\(\(\) => \{\}\), 10 \* 60e3\)/);
});
