/* 🔎 perfWatch — segments (growth / de-growth / inactive / 2 months / priority / stock), filters, sort, totals. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load() {
  const listeners = {};
  const host = { innerHTML: '', addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); }, querySelector() { return null; } };
  const doc = { getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const U = { esc, fmt: (n) => Number(n || 0).toLocaleString('en-IN'), deltaHtml: (g) => `<span>${g}%</span>`, debounce: (f) => f, downloadCsv(name, header, rows) { U.csv = { name, header, rows }; }, stamp: () => '2026-10-22', toast() {} };
  const ctx = { window: {}, document: doc, FF: null };
  ctx.window.FF = ctx.FF = { util: U, auth: { can: () => true } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'perfWatch.js'), 'utf8'), { ...ctx, window: ctx.window, document: doc });
  return { FF: ctx.window.FF, host, listeners, U };
}
const R = (n, o) => ({ n, id: `ID-${n}`, tl: 'TL A', direct: false, last: 0, cur: 0, g: null, recent: 0, stock: 100, pri: 'Low', inact: 0, run: 1, ref: n, ...o });
const rows = [
  R('Grow', { last: 10, cur: 14, g: 40, inact: 0 }),
  R('HiGrow', { last: 10, cur: 30, g: 200, inact: 1 }),
  R('Flat', { last: 10, cur: 10, g: 0 }),
  R('Drop', { last: 20, cur: 15, g: -25, pri: 'Low', stock: 12, inact: 4 }),
  R('HiDrop', { last: 20, cur: 5, g: -75, pri: 'Low', stock: 2, inact: 9 }),
  R('Quiet', { last: 8, cur: 0, g: null, inact: 99, stock: 0 }),
  R('Dead', { last: 0, cur: 0, g: null, inact: 99, stock: 0 }),
  R('NewOne', { last: 0, cur: 6, g: null }),
  R('Direct', { last: 5, cur: 5, g: 0, direct: true, tl: '', pri: 'Low', stock: 2 })
];
const count = (html, id) => Number((html.match(new RegExp(`data-pw-seg="${id}"[^>]*><small>[^<]*</small><b>(\\d+)</b>`)) || [])[1]);

test('perfWatch: every segment counts the right agents', () => {
  const { FF, host } = load();
  FF.perfWatch.mount(host, { ch: 'gv', days: 10, rows, months: { cur: '2026-10', last: '2026-09' }, onAgent() {}, onTl() {} });
  const h = host.innerHTML;
  const exp = { all: 9, growing: 2, hiGrow: 2, flat: 2, deGrow: 2, hiDe: 2, new: 1, noMonth: 2, quiet: 1, in2m: 1, in3: 4, in7: 3, in15: 2, pHigh: 2, pMed: 1, dispatch: 2, zeroStock: 2, direct: 1 };
  for (const [id, n] of Object.entries(exp)) assert.equal(count(h, id), n, `segment ${id}`);
  assert.match(h, /Performance watchlist/); assert.match(h, /Top 10 · MTD issuance/); assert.match(h, /Top 10 · biggest drop/);
  assert.match(h, /Total \(9\)/, 'totals row for all agents');
});

test('perfWatch: clicking a segment shows its full list; CSV exports that list', () => {
  const { FF, host, listeners, U } = load();
  FF.perfWatch.mount(host, { ch: 'ff', rows, months: { cur: '2026-10', last: '2026-09' }, onAgent() {}, onTl() {} });
  const click = (el) => listeners.click.forEach((f) => f({ target: { closest: (sel) => (el[sel] ? el.node : null) } }));
  const segBtn = { '[data-pw-seg]': true, node: { dataset: { pwSeg: 'in2m' } } };
  click(segBtn);
  assert.match(host.innerHTML, /Inactive 2 months/);
  assert.match(host.innerHTML, /Total \(1\)/);
  const tbody = (h) => h.split('<tbody>')[1].split('</tbody>')[0];
  assert.ok(tbody(host.innerHTML).includes('Dead') && !tbody(host.innerHTML).includes('>Grow<'), 'only the 2-month-inactive agent is listed');
  click({ '[data-pw-seg]': true, node: { dataset: { pwSeg: 'hiDe' } } });
  assert.ok(tbody(host.innerHTML).includes('HiDrop') && tbody(host.innerHTML).includes('>Drop<') && !tbody(host.innerHTML).includes('>Grow<'), 'threshold 25%: −25% and −75%');
  click({ '[data-pw-csv]': true, node: {} });
  assert.equal(U.csv.rows.length, 2); assert.equal(U.csv.rows[0][0], 'Drop'); assert.match(U.csv.name, /^ff-watchlist-hiDe-/);
});

test('perfWatch: top lists follow the selection (Direct agents → no TL agents anywhere)', () => {
  const { FF, host, listeners } = load();
  FF.perfWatch.mount(host, { ch: 'ff', rows, allCount: 20, months: { cur: '2026-10', last: '2026-09' }, onAgent() {}, onTl() {} });
  assert.match(host.innerHTML, /page filters on · 20 total/);
  listeners.click.forEach((f) => f({ target: { closest: (sel) => (sel === '[data-pw-seg]' ? { dataset: { pwSeg: 'direct' } } : null) } }));
  const h = host.innerHTML;
  assert.match(h, /within: Direct agents \(1 agents\)/);
  const tops = h.split('class="pw-top"')[1];
  assert.ok(tops.includes('Direct') && !tops.includes('Grow') && !tops.includes('HiDrop') && !tops.includes('TL A'), 'top lists only contain direct agents');
  // TL dropdown = Direct agents
  const { FF: FF2, host: host2, listeners: l2 } = load();
  FF2.perfWatch.mount(host2, { ch: 'gv', rows, months: { cur: '2026-10', last: '2026-09' }, onAgent() {}, onTl() {} });
  l2.change.forEach((f) => f({ target: { matches: (s) => s === '[data-pw-tl]', value: '__direct__' } }));
  const body = host2.innerHTML.split('<tbody>')[1].split('</tbody>')[0];
  assert.ok(body.includes('Direct') && !body.includes('TL A') && !body.includes('>Grow<'));
  assert.ok(!host2.innerHTML.split('class="pw-top"')[1].includes('TL A'));
});

test('perfWatch: priority comes from stock cover (not the sheet label); TL list is limited to the segment', () => {
  const { FF, host, listeners } = load();
  FF.perfWatch.mount(host, { ch: 'ff', days: 10, rows: [R('A', { cur: 50, stock: 10, pri: 'Low', tl: 'TL One' }), R('B', { cur: 50, stock: 1000, pri: 'High', tl: 'TL Two' }), R('D', { cur: 5, stock: 5, direct: true, tl: '' })], months: { cur: '2026-10', last: '2026-09' }, onAgent() {}, onTl() {} });
  assert.equal(count(host.innerHTML, 'pHigh'), 1, 'A: cover 2 days = High; B sheet-High but cover 200 = Low');
  listeners.click.forEach((f) => f({ target: { closest: (sel) => (sel === '[data-pw-seg]' ? { dataset: { pwSeg: 'pHigh' } } : null) } }));
  const sel = host.innerHTML.split('data-pw-tl><option')[1].split('</select>')[0];
  assert.ok(sel.includes('TL One') && !sel.includes('TL Two'), 'TL select only has TLs of this segment');
  listeners.click.forEach((f) => f({ target: { closest: (sel2) => (sel2 === '[data-pw-seg]' ? { dataset: { pwSeg: 'direct' } } : null) } }));
  assert.ok(!host.innerHTML.includes('TL One') && !host.innerHTML.includes('TL Two') && !host.innerHTML.includes('data-pw-tl><option'), 'Direct segment lists no TL names');
});
