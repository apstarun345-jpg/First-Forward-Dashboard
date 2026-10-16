/* Tag Request table: every header/cell column has its own <col> (Item Name used to be missing → all later widths shifted
   one column, squeezing the class chips in Stock / Current so they overlapped). Hidden columns hide their <col> too. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tr = readFileSync(path.join(ROOT, 'tagRequest.js'), 'utf8');
const app = readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const css = readFileSync(path.join(ROOT, 'dev/styles-full.css'), 'utf8');

test('admin colgroup has a col for Item Name (same number of cols as header cells)', () => {
  const cg = tr.slice(tr.indexOf('<colgroup>'), tr.indexOf('</colgroup>'));
  assert.match(cg, /tr-col-courier"><col class="tr-col-item-name"/);
  const colCount = (cg.match(/<col /g) || []).length;           // admin build: includes the 2 conditional-courier cols as one literal
  assert.equal(colCount, 20, 'sel,date,employee,agent,contact,courier,item,3 stock,5 issuance,suggest,requested,total,status,actions (admin literals)');
  assert.match(css, /col\.tr-col-item-name \{ width: 130px; \}/);
});

test('column chooser hides the matching <col> and the class grid wraps instead of overlapping', () => {
  assert.match(app, /> colgroup > :nth-child\(\$\{i \+ 1\}\)/);
  assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(58px, 1fr\)\)/);
});
