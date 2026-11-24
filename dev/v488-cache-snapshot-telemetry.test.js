import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
test('gviz cache survives restarts via Sheet snapshot (free plan has no disk)', () => {
  assert.match(S, /async function gvizSnapSave\(\)/);
  assert.match(S, /async function gvizSnapLoad\(\)/);
  assert.match(S, /durSave\(GVIZ_SNAP_TAB, 'gviz'/);
  assert.match(S, /static fromGz\(o\)/);
  assert.match(S, /setTimeout\(\(\) => \{ gvizSnapLoad\(\)/);
});
test('packed gzip entries round-trip through base64 snapshot rows', () => {
  const body = 'google.visualization.Query.setResponse(' + JSON.stringify({ rows: Array.from({ length: 500 }, (_, i) => i) }) + ');';
  const gz = zlib.gzipSync(body);
  const back = Buffer.from(gz.toString('base64'), 'base64');
  assert.equal(zlib.gunzipSync(back).toString('utf8'), body);
});
test('client telemetry: errors + page timings endpoint and admin panel', () => {
  assert.match(S, /p === '\/api\/client-telemetry' && method === 'POST'/);
  assert.match(S, /p === '\/api\/admin\/client-health' && method === 'GET'/);
  const A = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(A, /FF\.telemetry = \{ page:/);
  assert.match(A, /FF\.telemetry\.page\(page,/);
  const st = fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8');
  assert.match(st, /async function fillClientHealth\(body\)/);
});
