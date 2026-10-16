import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('Agent/TL Summary: FF report uses cached build, stale picks ignored, retry wired', () => {
  const ui = read('summaryUI.js');
  assert.match(ui, /buildReportCached \|\| FF\.agentSummary\.buildReport/);
  assert.match(ui, /const seq = \+\+pickSeq/);
  assert.match(ui, /seq !== pickSeq/);
  assert.match(ui, /closest\('\[data-gs-retry\]'\)/);
  assert.match(read('agentSummary.js'), /FF\.agentSummary = \{[^}]*buildReportCached/);
});

test('ui-plus: density, offline bar, copy are present and loaded', () => {
  const js = read('ui-plus.js');
  assert.match(js, /ff_density/);
  assert.match(js, /ff-offline-bar/);
  assert.match(js, /data-copy/);
  assert.match(read('index.html'), /ui-plus\.js/);
  assert.match(read('dev/styles-full.css'), /html\[data-density="compact"\]/);
});

test('Tag Request: draft autosave + copy buttons; search filter chips', () => {
  const tr = read('tagRequest.js');
  assert.match(tr, /function saveDraftNow/);
  assert.match(tr, /function restoreDraft/);
  assert.equal((tr.match(/clearDraft\(\)/g) || []).length >= 3, true);
  assert.match(tr, /data-copy="\$\{esc\(c\.mobile\)\}"/);
  const ms = read('masterSearch.js');
  assert.match(ms, /CHIP_FILTERS/);
  assert.match(ms, /suggestItemsRaw/);
});
