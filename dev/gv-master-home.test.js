import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('GV Master truth mapping stays authoritative', () => {
  const gv = read('gv.js');
  const truth = read('gvTruth.js');
  const profile = read('masterProfile.js');
  const search = read('masterSearch.js');
  const server = read('server.js');
  const home = read('home.js');
  const index = read('index.html');

  assert.match(gv, /const tlId = supervisorId \|\| gvTlId/);
  assert.match(gv, /masterTlIds/);
  assert.match(truth, /r\.tlId, r\.supervisorId, r\.gvTlId/);
  assert.match(profile, /A=UNIQUE_ID/);
  assert.match(profile, /GV Master is authoritative for GV agent issuance/);
  assert.match(profile, /Tag Assignment is authoritative for stock/);
  assert.match(search, /Exact agent\/TL ID match wins/);
  assert.match(server, /function gvMasterRawTodayFallback/);
  assert.match(server, /cfg\.date \|\| pick\('date'\)/);
  assert.match(home, /All Commercial · VC20 \+ VC5\+/);
  assert.match(home, /Expected this month/);
  assert.match(index, /homeKpiFix\.css/);

  // Guard against the earlier accidental partial-file overwrite.
  assert.ok(server.split('\n').length > 6000, 'server.js unexpectedly truncated');
  assert.ok(profile.split('\n').length > 2000, 'masterProfile.js unexpectedly truncated');
  assert.ok(search.split('\n').length > 1100, 'masterSearch.js unexpectedly truncated');
});
