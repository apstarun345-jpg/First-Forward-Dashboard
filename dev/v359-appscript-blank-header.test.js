import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gs = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8');
test('blank-header column with data no longer blocks tag request sheet entry', () => {
  assert.doesNotMatch(gs, /header khaali hai lekin data hai/);
  assert.match(gs, /oldHeader\[col\] = 'Column ' \+ letter/);
});
