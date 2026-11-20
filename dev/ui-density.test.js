// dev/ui-density.test.js — verifies table density, text/table overlap safeguards, and NPCI badges
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('UI Density & Table Overlap safeguards in index.html, styles.css & app.js', async () => {
  const indexHtml = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const stylesCss = await fs.readFile(path.join(ROOT, 'styles.css'), 'utf8');
  const appJs = await fs.readFile(path.join(ROOT, 'app.js'), 'utf8');

  // 1. index.html contains density toggle
  assert.ok(indexHtml.includes('id="density-toggle"'), 'index.html must have #density-toggle button');
  assert.ok(indexHtml.includes('data-label="Density"'), 'density-toggle must have data-label="Density"');

  // 2. styles.css contains density variables and compact overrides
  assert.ok(stylesCss.includes('--tbl-pad-y'), 'styles.css must declare --tbl-pad-y');
  assert.ok(stylesCss.includes('--tbl-pad-x'), 'styles.css must declare --tbl-pad-x');
  assert.ok(stylesCss.includes('--tbl-fz'), 'styles.css must declare --tbl-fz');
  assert.ok(stylesCss.includes('data-table-density="compact"'), 'styles.css must declare compact density state');

  // 3. Text and table overlap safeguards
  assert.ok(stylesCss.includes('text-overflow: ellipsis'), 'styles.css must guard text overflow with ellipsis');
  assert.ok(stylesCss.includes('font-variant-numeric: tabular-nums'), 'styles.css must format numbers with tabular-nums');
  assert.ok(stylesCss.includes('overflow-x: auto'), 'styles.css must guard table overflow with overflow-x: auto');

  // 4. Official NPCI FASTag class badges
  ['vc4', 'vc5', 'vc6', 'vc7', 'vc12', 'vc16', 'vc20', 'vc5p'].forEach((vc) => {
    assert.ok(stylesCss.includes(`.badge-vc.${vc}`), `styles.css must declare official badge for ${vc}`);
  });

  // 5. app.js contains density controls and wiring
  assert.ok(appJs.includes('function tableDensity('), 'app.js must declare tableDensity()');
  assert.ok(appJs.includes('function setTableDensity('), 'app.js must declare setTableDensity()');
  assert.ok(appJs.includes('function toggleTableDensity('), 'app.js must declare toggleTableDensity()');
  assert.ok(appJs.includes('#density-toggle'), 'app.js must wire #density-toggle');

  // 6. Ensure setTableDensity never selects document.documentElement with unqualified [data-table-density]
  assert.ok(!appJs.includes("querySelectorAll('[data-table-density]')"), 'must not query unqualified [data-table-density] which matches document.documentElement and erases DOM');
});
