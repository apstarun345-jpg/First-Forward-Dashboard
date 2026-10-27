/* 📅 Personal link search: daily issuance chart (stacked VC4 / VC20 / VC5+, total on top, class split on hover). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function build(D) {
  const a = src.indexOf('var DCOL = [');
  const b = src.indexOf('function bindDaily');
  assert.ok(a > 0 && b > a, 'chart code present');
  const body = src.slice(a, b);
  // eslint-disable-next-line no-new-func
  return new Function('D', 'nf', body + '; return dailyChart;')(D, (n) => String(n));
}

test('daily chart renders a bar + total label per day and a class legend', () => {
  const chart = build({ issue: true, ym: '2026-10', td: 5 });
  const html = chart({ dd: { 1: [1, 0, 1], 3: [2, 1, 0], 5: [0, 0, 4] } });
  assert.equal((html.match(/class="pl-dd-bar"/g) || []).length, 5);
  assert.match(html, /class="pl-dd-tot"[^>]*>2</); // day 1 total
  assert.match(html, /class="pl-dd-tot"[^>]*>3</); // day 3 total
  assert.match(html, /class="pl-dd-tot"[^>]*>4</); // day 5 total
  assert.match(html, /VC4/); assert.match(html, /VC20/); assert.match(html, /VC5\+/);
  assert.match(html, /Total 9/);
});

test('daily chart shows an empty state and hides when issuance is off', () => {
  assert.match(build({ issue: true, ym: '2026-10', td: 3 })({}), /No issuance this month yet/);
  assert.equal(build({ issue: false, ym: '2026-10', td: 3 })({ dd: { 1: [1, 0, 0] } }), '');
});

test('server embeds per-agent daily class data (dd) and wires the chart into the search result', () => {
  assert.match(src, /async function personalAgentDailyRows/);
  assert.match(src, /p\.dd = dd/);
  assert.match(src, /donuts\(it\) \+ dailyChart\(it\)/);
  assert.match(src, /td: Number\(dateKeyNow\(\)\.slice\(8, 10\)\)/);
});

test('personal link search matches agent ID too and shows the ID next to the name', () => {
  assert.match(src, /it\._s = norm\(it\.n \+ ' ' \+ \(it\.i \|\| ''\)\)/);
  assert.match(src, /it\._s\.indexOf\(t\)/);
  assert.match(src, /for \(const \[k8, p\] of peopleMap\)/);
  assert.match(src, /by name or agent ID/);
});
