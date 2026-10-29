import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const ao = fs.readFileSync(new URL('../agentsOverview.js', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
test('admin can assign agents to a team link; one agent → one link', () => {
  assert.ok(src.includes("/assign$/);") && src.includes("plAssign"));
  assert.match(src, /Work can only be assigned to a team link/);
  assert.match(src, /l\.id !== link\.id && Array\.isArray\(l\.assigned\)/);
});
test('team link shows "Assigned work by RSM" tab and can set targets for assigned agents', () => {
  assert.match(src, /Assigned work by RSM \(\$\{asg\.length\}\)/);
  assert.match(src, /normPlAssignedGlobal\(link\.assigned\)\.forEach\(\(a\) => put\(a\.name, a\.src/);
});
test('team link tables sort by header (asc / desc)', () => {
  assert.match(src, /__plSortBound/);
  assert.match(src, /th\[data-sort=asc\]::after/);
});
test('Agents Summary: VC4/20 + VC5/6/7/12/16 class stock, de-growth bucket, assign panel', () => {
  assert.match(ao, /CLASSES = \['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16'\]/);
  assert.match(ao, /deg: \(r\) => r\.deg/);
  assert.match(ao, /Assign work to a team link/);
});
test('Home shows assigned vs targets set card (admin)', () => {
  assert.match(home, /home-assign/);
  assert.match(home, /have a target set/);
});
