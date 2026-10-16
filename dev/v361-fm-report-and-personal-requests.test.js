import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fm = readFileSync(path.join(ROOT, 'fastagMapping.js'), 'utf8');
const srv = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const set = readFileSync(path.join(ROOT, 'settings.js'), 'utf8');

test('FASTag Mapping report: agent x class counts, not-found list, cannot-map sheet', () => {
  assert.match(fm, /function reportModel\(\)/);
  assert.match(fm, /a\.cls\.set\(c, \(a\.cls\.get\(c\) \|\| 0\) \+ 1\)/, 'class-wise count per agent');
  assert.match(fm, /Total found/);
  assert.match(fm, /Nahi mile/);
  assert.match(fm, /Mapping nahi ho sakti/);
  assert.match(fm, /FF\.xlsx\.download\('fastag-mapping-report-/);
  assert.match(fm, /\[sh\.summary, sh\.notFound, sh\.cannot\]/, 'three sheets');
  assert.match(fm, /Reason'\]/, 'cannot-map sheet carries the reason');
  assert.match(fm, /\+ reportHtml\(\);/, 'report renders with the summary');
  assert.match(fm, /fm-report-xlsx/);
});
test('Duplicate-skipped rows are not counted as failures', () => {
  assert.match(fm, /const rows = state\.rows\.filter\(\(r\) => !isDupSkipped\(r\)\)/);
});
test('Personal agent/TL page gets an own "My Tag Requests" section (opt-in per link)', () => {
  assert.match(srv, /PL_ALL_SECTIONS = \[[^\]]*'requests'/);
  assert.match(srv, /function personalRequestsHtml\(link\)/);
  assert.match(srv, /norm\(x\.agentName \|\| x\.name\) === me/, 'agent sees only own rows');
  assert.match(srv, /data-pl-pane=\\"requests\\"|data-pl-pane="requests"/);
  assert.match(set, /key: 'requests'/);
});
