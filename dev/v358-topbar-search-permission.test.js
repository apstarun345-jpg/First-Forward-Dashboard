import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ms = fs.readFileSync(path.join(__dirname, '..', 'masterSearch.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
test('top-bar search is gated by masterSearch permission', () => {
  assert.match(ms, /function mountTopbar[\s\S]{0,300}FF\.auth\.can\('masterSearch'\)/);
  assert.match(app, /function mountSearchTopbar[\s\S]{0,400}FF\.auth\.can\('masterSearch'\)/);
});
