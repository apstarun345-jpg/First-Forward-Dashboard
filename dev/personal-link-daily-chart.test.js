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
  assert.match(src, /p\.dd = r7\.o/);
  assert.match(src, /var rest = donuts\(it\) \+ dailyChart\(it\)/);
  assert.match(src, /td: Number\(dateKeyNow\(\)\.slice\(8, 10\)\)/);
});

test('personal link search matches agent ID too and shows the ID next to the name', () => {
  assert.match(src, /it\._s = norm\(it\.n \+ ' ' \+ \(it\.i \|\| ''\)\)/);
  assert.match(src, /it\._s\.indexOf\(t\)/);
  assert.match(src, /for \(const \[k8, p\] of peopleMap\)/);
  assert.match(src, /by name or agent ID/);
});

test('unified agent grid: ID, mobile, last/this month, growth, stock, class stock + issuance, last active, target', () => {
  const a = src.indexOf('    var GC = [[');
  const b = src.indexOf('    // 🎯 set / change / clear an agent target');
  assert.ok(a > 0 && b > a);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sumC = (it, names) => { const r = [0, 0, 0, 0]; names.forEach((n) => { const x = (it.c && it.c[n]) || [0, 0, 0, 0]; for (let i = 0; i < 4; i++) r[i] += x[i]; }); return r; };
  // eslint-disable-next-line no-new-func
  const grid = new Function('D', 'MON', 'sumC', 'nf', 'esc', 'norm', 'chBadge', 'prBadge', 'overall', 'B3', src.slice(a, b) + '; return agentGrid;')(
    { issue: true, stock: true, today: '2026-10-28', tgOk: true, ym: '2026-10' }, MON, sumC, (n) => String(n || 0), (x) => String(x), (x) => String(x).toLowerCase(), () => '', () => '', () => ({}), ['VC4', 'VC20', 'VC5']);
  const html = grid('t', [
    { n: 'Sumit Dixit', i: 'APS016090', mo: '9876543210', c: { VC4: [0, 0, 40, 0], VC20: [0, 0, 15, 0], VC5: [0, 0, 16, 0], VC12: [0, 0, 13, 0] }, st: 116, l: 32, m: 12, lp: 8, la: '2026-10-27', d: 0, tg: 25, tl2: 1 },
    { n: 'Old Agent', i: 'APS000001', c: {}, st: 0, l: 5, m: 0, lp: 5, la: '2026-10-10', d: 0, tg: 'A', tl2: 1 },
    { n: 'No Target', i: 'APS000002', c: {}, st: 0, l: 0, m: 0, lp: 0, d: 0 }
  ], {});
  for (const h of ['Agent ID', 'Mobile', 'Last month', 'This month', 'Growth %', 'Last active', 'Target', 'VC4/20 stock', 'VC5 stock', 'VC6 stock', 'VC7 stock', 'VC12 stock', 'VC16 stock', 'VC4/20 issued', 'VC16 issued']) assert.ok(html.includes(h), h);
  assert.match(html, /APS016090/); assert.match(html, /tel:9876543210/);
  assert.match(html, /Yesterday/); assert.match(html, /18 days ago/);
  assert.match(html, /▲ \+50%/); assert.match(html, /▼ -100%/);
  assert.match(html, /⚡ Active/); assert.match(html, /48%/);          // 12 / 25
  assert.match(html, /data-tg="No Target"/);                             // can set a target
  assert.match(html, /<td><b>55<\/b>|>55</);                              // VC4 + VC20 stock together
});

test('admin Home: team-link targets are grouped per link with set / achieved counts', async () => {
  const code = fs.readFileSync(path.join(ROOT, 'targetAlerts.js'), 'utf8');
  const FF = { util: { esc: (x) => x, clean: (x) => String(x || '').trim(), dateKey: () => '', fmt: (n) => String(n), ymKey: () => '' } };
  // eslint-disable-next-line no-new-func
  new Function('window', code)({ FF });
  const cur = new Map([['ff|A ONE', 12], ['gv|B TWO', 0], ['ff|C THREE', 3]]);
  const out = FF.targetAlerts.linkSummary([
    { key: 'ff|A ONE', ym: '2026-10', via: 'link', linkId: 'L1', linkName: 'Varsha Team', agent: 'A ONE', target: 10, source: 'ff' },
    { key: 'gv|B TWO', ym: '2026-10', via: 'link', linkId: 'L1', linkName: 'Varsha Team', agent: 'B TWO', goal: 'active', target: 0, source: 'gv' },
    { key: 'ff|C THREE', ym: '2026-10', via: 'link', linkId: 'L2', linkName: 'Other', agent: 'C THREE', target: 5, source: 'ff' },
    { key: 'ff|D', ym: '2026-10', by: 'admin', agent: 'D', target: 5 }
  ], cur, '2026-10');
  assert.deepEqual(out.map((g) => [g.linkName, g.set, g.achieved]), [['Varsha Team', 2, 1], ['Other', 1, 0]]);
  assert.match(code, /data-ta-link/); assert.match(code, /Team link targets/);
});
