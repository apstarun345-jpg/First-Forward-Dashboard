import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../kpiDetail.js', import.meta.url), 'utf8');
test('KPI class-wise tables fold CCH classes into TVC (VC4/20, VC5, VC6, VC7, VC12, VC16)', () => {
  const start = src.indexOf('  const classKey ='), end = src.indexOf('const tvcCls');
  const body = src.slice(start, src.indexOf('\n', end));
  const FF = { config: { tvcGroups: [{ tvc: '4', cch: ['VC4', 'VC20'] }, { tvc: '5', cch: ['VC5', 'VC9'] }, { tvc: '6', cch: ['VC8', 'VC11'] }, { tvc: '7', cch: ['VC7', 'VC10'] }, { tvc: '12', cch: ['VC12', 'VC13', 'VC14'] }, { tvc: '16', cch: ['VC16', 'VC17'] }] } };
  const fn = new Function('FF', `${body}; return { tvcOf, tvcCls };`)(FF);
  assert.equal(fn.tvcOf('VC10'), 'VC7'); assert.equal(fn.tvcOf('VC11'), 'VC6'); assert.equal(fn.tvcOf('VC20'), 'VC4/20'); assert.equal(fn.tvcOf('13'), 'VC12');
  assert.equal(fn.tvcCls('VC7'), 'VC7,VC10');
  assert.match(src, /const byCls = tally\(inRange, \(r\) => tvcOf\(r\.cls\)\)/);
  assert.match(src, /const byClass = tally\(cur, \(r\) => tvcOf\(r\.cls\)\)/);
});
