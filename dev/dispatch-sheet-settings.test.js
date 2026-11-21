import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
test('dispatch sheet: tab name supported server-side', () => {
  const s = r('server.js');
  assert.match(s, /const ledgerRef = \(src\)/);
  assert.match(s, /const ledgerSetSheet = \(qp, src\)/);
  assert.match(s, /String\(v\.tab \|\| ''\)\.trim\(\)/);
  assert.match(s, /v\.tab = String\(v\.tab\)\.trim\(\)/);
  assert.match(s, /ff1: \{ enabled: false/);
});
test('dispatch sheet: settings card with FF + GV tab fields', () => {
  const t = r('settings.js');
  assert.match(t, /Dispatch sheet · FF \+ GV/);
  assert.match(t, /data-ldg-tab/);
  assert.match(t, /row\('ff1', 'FF dispatch sheet'\)/);
  assert.match(t, /row\('gv3', 'GV dispatch sheet'\)/);
});
