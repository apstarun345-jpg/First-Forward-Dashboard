import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gs = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8');
test('Tag Request appendrows tolerates blank-header legacy columns (proven v3.62 logic)', () => {
  assert.doesNotMatch(gs, /header khaali hai lekin data hai/);
  assert.match(gs, /Preserve legacy blank-header columns at the far right/);
  assert.match(gs, /function reorderExistingTagSheetColumns_/);
  assert.doesNotMatch(gs, /function alignTagRequestSheetColumns_/);
});
test('Code.gs never hard-codes the app secret', () => {
  assert.doesNotMatch(gs, /instantrccard/);
});
