import test from 'node:test';
import assert from 'node:assert/strict';
import { personalActivityCalendar } from '../personal-calendar.js';

const detail = (html, day) => (html.match(new RegExp(`<div class="pl-cal-detail" data-cal-detail="${day}" hidden>(.*?)</div></div>`)) || [])[1] || '';

test('calendar shows scoped day totals, class split, zero days and excludes incomplete/future days', () => {
  const html = personalActivityCalendar([
    { date: '2026-10-10', cls: 'VC4', n: 3 }, { date: '2026-10-10', cls: 'VC4', n: 2 },
    { date: '2026-10-10', cls: 'VC20', n: 4 }, { date: '2026-10-10', cls: 'VC6', n: 7 },
    { date: '2026-09-02', cls: 'VC4', n: 11 },
    { date: '2026-10-29', cls: 'VC4', n: 999 }, { date: '2026-11-01', cls: 'VC4', n: 888 },
    { date: '2026-10-32', cls: 'VC4', n: 9999 }
  ], '2026-10-29');
  assert.match(html, /October 2026<\/b> · 16 tags · 1 active day/);
  assert.match(html, /September 2026<\/b> · 11 tags · 1 active day/);
  const d = detail(html, '2026-10-10');
  assert.match(d, /16 tags/); assert.match(d, /VC4 <b>5<\/b>/); assert.match(d, /VC20 <b>4<\/b>/); assert.match(d, /VC5\+ <b>7<\/b>/);
  assert.match(detail(html, '2026-10-11'), /No issuance recorded/);
  assert.match(html, /data-cal-day="2026-10-29"[^>]*disabled/);
  assert.doesNotMatch(html, /data-cal-detail="2026-10-29"/);
  assert.doesNotMatch(html, /9999|888/);
  assert.match(html, /data-cal-month="2026-09" aria-pressed="false"/);
});

test('month boundaries, leap years and no completed day are calculated in UTC/IST date keys', () => {
  const html = personalActivityCalendar([{ date: '2024-02-29', cls: 'VC20', n: 2 }], '2024-03-01');
  assert.match(html, /February 2024<\/b> · 2 tags · 1 active day/);
  assert.match(html, /data-cal-day="2024-02-29"/);
  assert.match(html, /data-cal-day="2024-03-01"[^>]*disabled/);
  assert.doesNotMatch(html, /data-cal-detail="2024-03-01"/);
  assert.throws(() => personalActivityCalendar([], '2024-02-30'));
});
