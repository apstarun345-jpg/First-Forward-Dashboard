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

  assert.match(gv, /const tlId = gvTlId \|\| supervisorId/);
  assert.match(gv, /masterTlIds/);
  assert.match(gv, /configuredGroup/);
  assert.match(truth, /r\.tlId, r\.supervisorId, r\.gvTlId/);
  assert.match(profile, /A=UNIQUE_ID/);
  assert.match(profile, /GV Master is authoritative for GV agent issuance/);
  assert.match(profile, /Tag Assignment is authoritative for stock/);
  assert.match(search, /Exact agent\/TL ID match wins/);
  assert.match(search, /suppressFalseFfMatches/);
  assert.match(search, /lightSoftMs: 1500/);
  assert.match(read('searchReport.js'), /Same-name FF\/GV merge only when a real ID links both records/);
  assert.match(server, /function gvMasterRawTodayFallback/);
  assert.match(server, /async function gvTodayFeed/);
  assert.match(server, /classMapVersion/);
  assert.match(server, /fallbackClassCol: resolved\.vClass, classMap: settings\.gvClassCch/);
  assert.match(server, /\/api\/gv-today/);
  assert.match(server, /cfg\.date \|\| pick\('date'\)/);
  assert.match(home, /All Commercial · VC20 \+ VC5\+/);
  assert.match(home, /Expected this month/);
  assert.match(home, /ffIssuanceLagDays/);
  assert.match(home, /reportedSc/);
  assert.match(home, /aaj exclude/);
  assert.match(home, /reported din/);
  assert.match(home, /FF\.data\.gvToday/);
  assert.match(home, /AAJ KA LIVE|Aaj ka live/);
  assert.match(home, /function feedMatchesCurrentClassMap/);
  assert.match(home, /if \(!feedMatchesCurrentClassMap\(quick\.gv\)\) return/);
  assert.match(index, /homeKpiFix\.css/);
  assert.match(profile, /todayKpiHtml/);
  assert.match(profile, /todayTeamRows/);
  assert.match(gv, /liveTodayRows\.forEach/);

  // Guard against the earlier accidental partial-file overwrite.
  assert.ok(server.split('\n').length > 6000, 'server.js unexpectedly truncated');
  assert.ok(profile.split('\n').length > 2000, 'masterProfile.js unexpectedly truncated');
  assert.ok(search.split('\n').length > 1100, 'masterSearch.js unexpectedly truncated');
});
