/* Agent/TL Summary: the "All agents — issuance" board sits BELOW the report, and a TL search filters it to that TL's agents. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('issuance board is rendered after the report body', async () => {
  const ui = await fs.readFile(new URL('../summaryUI.js', import.meta.url), 'utf8');
  assert.ok(ui.indexOf('id="gs-body"') > 0 && ui.indexOf('id="gs-issue-board"') > ui.indexOf('id="gs-body"'), 'board comes after #gs-body');
  assert.match(ui, /FF\.issueBoard\.setTl\(ch, \/tl\$\/\.test\(String\(person\.kind/, 'picking a TL filters the board');
  assert.match(ui, /FF\.issueBoard\.setTl\(ch, ''\)/, 'board resets on page open');
});

test('issue board: TL filter + clear button', async () => {
  const src = await fs.readFile(new URL('../agentSummary.js', import.meta.url), 'utf8');
  assert.match(src, /if \(st\.tl\) \{ const tk = norm\(st\.tl\); list = list\.filter\(/, 'rows filtered by TL before totals');
  assert.match(src, /data-ib-cleartl/, 'show-all button');
  assert.match(src, /FF\.issueBoard = \{ mount: mountIssueBoard, setTl: setIssueBoardTl \}/);
});
