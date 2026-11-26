import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const cli = fs.readFileSync(new URL('../tagRequest.js', import.meta.url), 'utf8');
test('series number: ensureTagReqNos present, wired on store + list + merge', () => {
  assert.match(srv, /function ensureTagReqNos\(\)/);
  assert.ok((srv.match(/ensureTagReqNos\(\)/g) || []).length >= 4);
  assert.match(srv, /no: r\.no \|\| null/);
});
test('ensureTagReqNos logic: old ones 1..N by time, new one next', () => {
  const m = srv.match(/function ensureTagReqNos\(\) \{[\s\S]*?\n\}/)[0];
  const w = { tagRequests: [{ id: '9000', at: '2026-02-01' }, { id: '1234', at: '2026-01-01' }, { id: '5000', at: '2026-03-01' }] };
  const f = new Function('workspaceStore', m + '; return ensureTagReqNos;')(() => w);
  assert.equal(f(), true);
  assert.deepEqual(w.tagRequests.map((r) => r.no), [2, 1, 3]);
  w.tagRequests.push({ id: '1111', at: '2026-04-01' }); f();
  assert.equal(w.tagRequests[3].no, 4); assert.equal(f(), false);
});
test('client shows series number', () => { assert.match(cli, /r\.no \|\| r\.id/); });
