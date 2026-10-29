import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const a = src.indexOf('    var cal = holder && holder.querySelector(\'#pl-activity-calendar\');');
const b = src.indexOf('  // Scoped search + Dispatch priority', a);
assert.ok(a > 0 && b > a);
const code = src.slice(a, b);
function fake(attrs = {}) { return { attrs, hidden: false, disabled: false, classList: { toggle() {} }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; }, closest(sel) { return sel === '[data-cal-grid]' ? this.grid : null; } }; }
test('calendar interaction changes month and reveals only the selected date details', () => {
  const current = fake({ 'data-cal-month': '2026-10' }), prev = fake({ 'data-cal-month': '2026-09' });
  const day1 = fake({ 'data-cal-day': '2026-09-02' }), day2 = fake({ 'data-cal-day': '2026-09-03' });
  const detail1 = fake({ 'data-cal-detail': '2026-09-02' }), detail2 = fake({ 'data-cal-detail': '2026-09-03' }), placeholder = fake();
  const grid1 = fake({ 'data-cal-grid': '2026-10' }), grid2 = fake({ 'data-cal-grid': '2026-09' });
  grid2.querySelectorAll = (sel) => sel === '[data-cal-day]' ? [day1, day2] : [detail1, detail2];
  grid2.querySelector = () => placeholder; day1.grid = grid2; day2.grid = grid2;
  const cal = { handler: null, addEventListener(_, fn) { this.handler = fn; }, contains: () => true, querySelectorAll: (sel) => sel === '[data-cal-month]' ? [current, prev] : [grid1, grid2] };
  new Function('holder', code)({ querySelector: () => cal });
  cal.handler({ target: { closest: (sel) => sel === '[data-cal-month]' ? prev : null } });
  assert.equal(grid1.hidden, true); assert.equal(grid2.hidden, false); assert.equal(prev.attrs['aria-pressed'], 'true');
  cal.handler({ target: { closest: (sel) => sel === '[data-cal-day]' ? day1 : null } });
  assert.equal(day1.attrs['aria-pressed'], 'true'); assert.equal(day2.attrs['aria-pressed'], 'false');
  assert.equal(detail1.hidden, false); assert.equal(detail2.hidden, true); assert.equal(placeholder.hidden, true);
  day2.disabled = true;
  cal.handler({ target: { closest: (sel) => sel === '[data-cal-day]' ? day2 : null } });
  assert.equal(detail1.hidden, false, 'disabled date does not change the selected result');
});
