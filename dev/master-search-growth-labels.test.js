import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../masterSearch.js', import.meta.url), 'utf8');

test('Master Search Growth card separates comparable MTD from expected month-end growth', () => {
  assert.match(source, /const growthNum = .*pr\.growthNum/);
  assert.match(source, /const projectedGrowthNum = .*p1\.projectedGrowth/);
  assert.match(source, /MTD vs \$\{esc\(previousMonthLabel\)\} · same days/);
  assert.match(source, /Expected vs \$\{esc\(previousMonthLabel\)\} full month/);
  assert.match(source, /MTD: \$\{currentMonthLabel\} 1–\$\{day\} = \$\{U\.fmt\(p1\.comparableCurrent\)\} vs \$\{prevLabel\} 1–\$\{day\} = \$\{U\.fmt\(p1\.comparableLast\)\}/);
  assert.match(source, /Month-end forecast: \$\{U\.fmt\(expected\)\} vs \$\{prevLabel\} full month: \$\{U\.fmt\(previousFull\)\}/);
  assert.doesNotMatch(source, /const growth2Sub =/);
});
